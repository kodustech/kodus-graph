// src/shared/logger.ts
export const log = {
    info(msg: string, ctx?: Record<string, unknown>): void {
        process.stderr.write(`[INFO] ${msg}${ctx ? ` ${JSON.stringify(ctx)}` : ''}\n`);
    },
    debug(msg: string, ctx?: Record<string, unknown>): void {
        if (process.env.KODUS_GRAPH_DEBUG) {
            process.stderr.write(`[DEBUG] ${msg}${ctx ? ` ${JSON.stringify(ctx)}` : ''}\n`);
        }
    },
    warn(msg: string, ctx?: Record<string, unknown>): void {
        process.stderr.write(`[WARN] ${msg}${ctx ? ` ${JSON.stringify(ctx)}` : ''}\n`);
    },
    error(msg: string, ctx?: Record<string, unknown>): void {
        process.stderr.write(`[ERROR] ${msg}${ctx ? ` ${JSON.stringify(ctx)}` : ''}\n`);
    },
};
