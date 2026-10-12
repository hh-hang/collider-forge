import type { Plugin } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface CacheEntry {
    directory: string;
    base: string;
    variants: Map<string, string>;
    obsolete: Set<string>;
    users: number;
    released: boolean;
}

interface Progress { stage: string; message: string; percent?: number }

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cachePrefix = "3dgs-collider-cache-";
const cacheRoot = path.resolve(os.tmpdir());

async function removeCache(entry: CacheEntry): Promise<void> {
    // Only delete directories created by this server directly under TEMP.
    const directory = path.resolve(entry.directory);
    if (path.dirname(directory) !== cacheRoot || !path.basename(directory).startsWith(cachePrefix)) {
        throw new Error("Invalid reconstruction cache directory");
    }
    await fs.rm(directory, { recursive: true, force: true });
}

function readBody(req: IncomingMessage, onProgress: (received: number) => void): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let received = 0;
        req.on("data", (data) => {
            const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
            chunks.push(chunk);
            received += chunk.length;
            onProgress(received);
        });
        req.on("end", () => resolve(Buffer.concat(chunks)));
        req.on("aborted", () => reject(new Error("Upload cancelled")));
        req.on("error", reject);
    });
}

function runExe(exe: string, args: string[], signal: AbortSignal, onOutput: (text: string) => void) {
    return new Promise<{ code: number; log: string }>((resolve) => {
        const child = spawn(exe, args, { cwd: path.dirname(exe), windowsHide: true, signal });
        let log = "";
        const output = (data: Buffer) => { const text = data.toString(); log += text; onOutput(text); };
        child.stdout.on("data", output);
        child.stderr.on("data", output);
        child.on("error", (error) => { log += error.message; });
        child.on("close", (code) => resolve({ code: code ?? -1, log }));
    });
}

export function threeDgsColliderApi(): Plugin {
    const caches = new Map<string, CacheEntry>();
    const progressClients = new Map<string, Set<ServerResponse>>();
    const publish = (id: string | null, progress: Progress) => {
        if (!id) return;
        for (const client of progressClients.get(id) ?? []) {
            client.write(`data: ${JSON.stringify(progress)}\n\n`);
        }
    };
    const release = (id: string) => {
        const entry = caches.get(id);
        if (!entry) return;
        caches.delete(id);
        entry.released = true;
        if (entry.users === 0) void removeCache(entry).catch(() => undefined);
    };

    return {
        name: "3dgs-collider-api",
        configureServer(server) {
            server.httpServer?.once("close", () => {
                for (const id of caches.keys()) release(id);
            });
            server.middlewares.use(async (req, res, next) => {
                const url = new URL(req.url ?? "/", "http://localhost");
                const base = "/api/3dgs-collider";
                const generate = url.pathname === base;
                const isPostprocess = url.pathname === `${base}/postprocess`;
                const deleteCache = url.pathname === `${base}/cache`;
                const progress = url.pathname === `${base}/progress`;
                if (!generate && !isPostprocess && !deleteCache && !progress) return next();

                res.setHeader("Access-Control-Allow-Origin", "*");
                if (req.method === "OPTIONS") {
                    res.setHeader("Access-Control-Allow-Methods", "POST, DELETE, GET, OPTIONS");
                    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
                    res.statusCode = 204;
                    res.end();
                    return;
                }
                if (progress) {
                    const id = url.searchParams.get("id") ?? "";
                    if (req.method !== "GET" || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) {
                        res.statusCode = 400;
                        res.end("invalid progress request");
                        return;
                    }
                    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
                    res.setHeader("Cache-Control", "no-cache, no-transform");
                    res.setHeader("Connection", "keep-alive");
                    res.flushHeaders();
                    const clients = progressClients.get(id) ?? new Set<ServerResponse>();
                    progressClients.set(id, clients);
                    clients.add(res);
                    res.write(`data: ${JSON.stringify({ stage: "ready", message: "Ready" })}\n\n`);
                    const heartbeat = setInterval(() => res.write(": keep-alive\n\n"), 15_000);
                    req.on("close", () => {
                        clearInterval(heartbeat);
                        clients.delete(res);
                        if (clients.size === 0) progressClients.delete(id);
                    });
                    return;
                }
                if (deleteCache) {
                    if (req.method !== "DELETE") { res.statusCode = 405; res.end("DELETE only"); return; }
                    release(url.searchParams.get("cacheId") ?? "");
                    res.statusCode = 204;
                    res.end();
                    return;
                }
                if (req.method !== "POST") { res.statusCode = 405; res.end("POST only"); return; }

                const id = url.searchParams.get("id");
                const controller = new AbortController();
                res.on("close", () => { if (!res.writableEnded) controller.abort(); });
                let entry: CacheEntry | null = null;
                let cacheId = "";
                let temporaryOutput: string | null = null;
                let registered = false;
                try {
                    const exe = process.env.THREEDGS_COLLIDER_EXE?.trim() ||
                        path.join(repository, "tools/3dgs-collider/build/Release/3dgs_collider.exe");
                    try { await fs.access(exe); } catch {
                        res.statusCode = 503;
                        res.end(`3dgs_collider.exe not found at ${exe}`);
                        return;
                    }
                    let output: string;
                    let args: string[] | null = null;
                    let hit = false;
                    let key = "";
                    if (generate) {
                        const depth = Number(url.searchParams.get("depth") ?? "9");
                        if (!Number.isInteger(depth) || depth < 6 || depth > 10) {
                            res.statusCode = 400; res.end("depth must be an integer in [6, 10]"); return;
                        }
                        const total = Number(req.headers["content-length"]);
                        let lastPercent = -1;
                        publish(id, { stage: "upload", message: "Uploading PLY…", percent: 0 });
                        const body = await readBody(req, (received) => {
                            if (!Number.isFinite(total) || total <= 0) return;
                            const percent = Math.min(100, Math.round(100 * received / total));
                            if (percent < lastPercent + 2 && percent !== 100) return;
                            lastPercent = percent;
                            publish(id, { stage: "upload", message: `Uploading PLY… ${percent}%`, percent });
                        });
                        if (body.subarray(0, 3).toString("ascii").toLowerCase() !== "ply") {
                            res.statusCode = 400; res.end("Send raw .ply bytes"); return;
                        }
                        if (controller.signal.aborted) return;
                        const directory = await fs.mkdtemp(path.join(cacheRoot, cachePrefix));
                        entry = { directory, base: path.join(directory, "base.glb"), variants: new Map(), obsolete: new Set(), users: 1, released: false };
                        cacheId = randomUUID();
                        const input = path.join(directory, "input.ply");
                        await fs.writeFile(input, body);
                        output = entry.base;
                        // Generation always returns the unfiltered Poisson baseline.
                        args = [input, output, String(depth), "--cache-dir", directory];
                    } else {
                        cacheId = url.searchParams.get("cacheId") ?? "";
                        entry = caches.get(cacheId) ?? null;
                        if (!entry) {
                            res.statusCode = 410;
                            res.end("Cached reconstruction is unavailable. Generate a new collider.");
                            return;
                        }
                        ++entry.users;
                        registered = true;
                        const trim = url.searchParams.get("trimUnsupported") ?? "false";
                        const clean = url.searchParams.get("removeSmallComponents") ?? "false";
                        const countRaw = url.searchParams.get("minComponentTriangles") ?? "100";
                        const count = Number(countRaw);
                        if (!["true", "false"].includes(trim) || !["true", "false"].includes(clean) ||
                            !Number.isInteger(count) || count < 0 || count > 2147483647 ||
                            !countRaw.trim()) {
                            res.statusCode = 400; res.end("Invalid post-processing options"); return;
                        }
                        key = `${trim}:${clean}:${clean === "true" ? count : 0}`;
                        const existing = entry.variants.get(key);
                        if ((trim === "false" && clean === "false") || existing) {
                            output = existing ?? entry.base;
                            hit = true;
                        } else {
                            output = path.join(entry.directory, `variant-${randomUUID()}.glb`);
                            temporaryOutput = output;
                            args = ["--postprocess-cache", entry.directory, output,
                                ...(trim === "true" ? ["--trim-unsupported"] : []),
                                ...(clean === "true" ? ["--remove-small-components", "--min-component-triangles", String(count)] : [])];
                        }
                    }

                    if (args) {
                        const stages = [
                            ["Cleaning point cloud", "clean", "Cleaning point cloud…"],
                            ["Estimating normals", "normals", "Estimating normals…"],
                            ["Orienting normals", "orient", "Orienting normals…"],
                            ["Running Poisson", "poisson", "Running Poisson reconstruction…"],
                            ["Caching original", "cache", "Saving original collider…"],
                            ["Trimming unsupported", "trim", "Trimming unsupported surfaces…"],
                            ["Removing small components", "components", "Removing small components…"],
                            ["Output mesh:", "finalize", "Finalizing mesh…"],
                        ];
                        let log = "", last = -1;
                        const result = await runExe(exe, args, controller.signal, (text) => {
                            log += text;
                            for (let i = last + 1; i < stages.length; ++i) {
                                if (log.includes(stages[i][0])) {
                                    last = i;
                                    publish(id, { stage: stages[i][1], message: stages[i][2] });
                                }
                            }
                        });
                        if (controller.signal.aborted) return;
                        if (result.code !== 0) throw new Error(`3dgs_collider failed (${result.code}):\n${result.log}`);
                    }
                    const glb = await fs.readFile(output);
                    if (controller.signal.aborted) return;
                    if (entry.released) {
                        res.statusCode = 410;
                        res.end("Cached reconstruction was released. Generate a new collider.");
                        return;
                    }
                    if (generate) { caches.set(cacheId, entry); registered = true; }
                    else if (temporaryOutput) {
                        const previous = entry.variants.get(key);
                        entry.variants.set(key, output);
                        temporaryOutput = null;
                        if (previous) entry.obsolete.add(previous);
                        if (entry.variants.size > 8) {
                            const oldest = entry.variants.keys().next().value!;
                            const file = entry.variants.get(oldest)!;
                            entry.variants.delete(oldest);
                            entry.obsolete.add(file);
                        }
                    }
                    publish(id, { stage: "result", message: "Loading collider preview…" });
                    res.setHeader("Content-Type", "model/gltf-binary");
                    res.setHeader("Content-Length", glb.length);
                    res.setHeader("X-Collider-Cache-Id", cacheId);
                    res.setHeader("X-Collider-Cache-Hit", String(hit));
                    res.setHeader("Access-Control-Expose-Headers", "X-Collider-Cache-Id, X-Collider-Cache-Hit");
                    res.end(glb);
                } catch (error) {
                    if (!res.destroyed) {
                        publish(id, { stage: "error", message: "Collider processing failed" });
                        res.statusCode = 500;
                        res.end((error as Error).message);
                    }
                } finally {
                    if (temporaryOutput) await fs.unlink(temporaryOutput).catch(() => undefined);
                    if (entry) {
                        --entry.users;
                        if (!registered || (entry.released && entry.users === 0)) {
                            await removeCache(entry).catch(() => undefined);
                        } else if (entry.users === 0) {
                            const obsolete = [...entry.obsolete];
                            entry.obsolete.clear();
                            await Promise.all(obsolete.map((file) => fs.unlink(file).catch(() => undefined)));
                        }
                    }
                }
            });
        },
    };
}
