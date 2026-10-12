import { defineConfig, type Plugin } from "vite";
import { threeDgsColliderApi } from "./server/collider-api.ts";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { IncomingMessage } from "node:http";

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
