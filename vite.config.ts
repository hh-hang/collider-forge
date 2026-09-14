import { defineConfig, type Plugin } from "vite";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { IncomingMessage } from "node:http";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveColliderExe(): string | null {
    const fromEnv = process.env.THREEDGS_COLLIDER_EXE?.trim();
    if (fromEnv) return fromEnv;
    const local = path.join(
        __dirname,
        "tools",
        "3dgs-collider",
        "build",
        "Release",
        "3dgs_collider.exe"
    );
    return local;
}

function readBody(req: IncomingMessage): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        req.on("end", () => resolve(Buffer.concat(chunks)));
        req.on("error", reject);
    });
}

function runExe(exe: string, args: string[], cwd: string): Promise<{ code: number; log: string }> {
    return new Promise((resolve) => {
        const child = spawn(exe, args, { cwd, windowsHide: true });
        let log = "";
        child.stdout.on("data", (d) => {
            log += d.toString();
        });
        child.stderr.on("data", (d) => {
            log += d.toString();
        });
        child.on("error", (err) => {
            resolve({ code: -1, log: log + String(err) });
        });
        child.on("close", (code) => {
            resolve({ code: code ?? -1, log });
        });
    });
}

// 仅开发环境使用：POST /api/3dgs-collider?depth=9，请求体为原始 .ply 字节，返回 .glb
function threeDgsColliderApi(): Plugin {
    return {
        name: "3dgs-collider-api",
        configureServer(server) {
            server.middlewares.use(async (req, res, next) => {
                if (!req.url || !req.url.startsWith("/api/3dgs-collider")) return next();

                if (req.method === "OPTIONS") {
                    res.statusCode = 204;
                    res.setHeader("Access-Control-Allow-Origin", "*");
                    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
                    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
                    res.end();
                    return;
                }

                if (req.method !== "POST") {
                    res.statusCode = 405;
                    res.end("POST only");
                    return;
                }

                try {
                    const url = new URL(req.url, "http://localhost");
                    const depthRaw = url.searchParams.get("depth") ?? "9";
                    const depth = Number.parseInt(depthRaw, 10);
                    if (!Number.isFinite(depth) || depth < 6 || depth > 10) {
                        res.statusCode = 400;
                        res.end("depth must be an integer in [6, 10]");
                        return;
                    }

                    const exe = resolveColliderExe();
                    if (!exe) {
                        res.statusCode = 500;
                        res.end("3dgs_collider.exe path not configured");
                        return;
                    }
                    try {
                        await fs.access(exe);
                    } catch {
                        res.statusCode = 503;
                        res.end(
                            `3dgs_collider.exe not found at ${exe}. Build tools/3dgs-collider first (see tools/3dgs-collider/README.md).`
                        );
                        return;
                    }

                    const body = await readBody(req);
                    if (!body.length) {
                        res.statusCode = 400;
                        res.end("empty body: send raw .ply bytes");
                        return;
                    }

                    // 简单检查文件头：PLY 文件以 "ply" 开头
                    const head = body.subarray(0, 3).toString("ascii").toLowerCase();
                    if (head !== "ply") {
                        res.statusCode = 400;
                        res.end("Only .ply input is supported");
                        return;
                    }

                    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "3dgs-collider-"));
                    const inPly = path.join(tmp, "input.ply");
                    const outGlb = path.join(tmp, "collision.glb");
                    await fs.writeFile(inPly, body);

                    const result = await runExe(exe, [inPly, outGlb, String(depth)], path.dirname(exe));
                    if (result.code !== 0) {
                        res.statusCode = 500;
                        res.setHeader("Content-Type", "text/plain; charset=utf-8");
                        res.end(`3dgs_collider failed (${result.code}):\n${result.log}`);
                        await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
                        return;
                    }

                    const glb = await fs.readFile(outGlb);
                    res.statusCode = 200;
                    res.setHeader("Content-Type", "model/gltf-binary");
                    res.setHeader("Content-Length", String(glb.length));
                    res.setHeader("Access-Control-Allow-Origin", "*");
                    res.end(glb);

                    await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
                } catch (err) {
                    res.statusCode = 500;
                    res.end(`server error: ${(err as Error).message}`);
                }
            });
        },
    };
}

// 开发期通配跨域代理: 把 /proxy/<完整URL> 在服务端转发,绕过浏览器同源限制
function corsProxy(): Plugin {
    return {
        name: "cors-proxy",
        configureServer(server) {
            server.middlewares.use((req: IncomingMessage & { url?: string }, res, next) => {
                if (!req.url || !req.url.startsWith("/proxy/")) return next();

                let target = req.url.slice("/proxy/".length);
                target = target.replace(/^(https?:\/)([^/])/, "$1/$2");

                let parsed: URL;
                try {
                    parsed = new URL(target);
                } catch {
                    res.statusCode = 400;
                    res.end(`代理目标地址无效: ${target}`);
                    return;
                }

                const doRequest = parsed.protocol === "https:" ? httpsRequest : httpRequest;
                const upstream = doRequest(
                    parsed,
                    { method: req.method, headers: { ...req.headers, host: parsed.host } },
                    (proxyRes: IncomingMessage) => {
                        res.statusCode = proxyRes.statusCode || 502;
                        for (const [k, v] of Object.entries(proxyRes.headers)) {
                            if (v !== undefined) res.setHeader(k, v as string | string[]);
                        }
                        res.setHeader("Access-Control-Allow-Origin", "*");
                        proxyRes.pipe(res);
                    }
                );

                upstream.on("error", (err: Error) => {
                    res.statusCode = 502;
                    res.end(`代理请求失败: ${err.message}`);
                });

                req.pipe(upstream);
                return;
            });
        },
    };
}

export default defineConfig({
    plugins: [corsProxy(), threeDgsColliderApi()],
    server: {
        port: 5174,
        open: true,
    },
});
