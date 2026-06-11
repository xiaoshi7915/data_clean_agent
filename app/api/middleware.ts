import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { assertAuthenticated } from "./lib/auth";
import { checkRateLimit, rateLimitKeyFromRequest, RateLimitError } from "./lib/rateLimit";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const createRouter = t.router;

/** 公开只读过程（health、ping 等） */
export const publicQuery = t.procedure;

/**
 * 敏感只读过程：生产或已配置 APP_SECRET 时要求 Bearer 鉴权
 * 开发环境且未配置 APP_SECRET 时放行
 */
export const protectedQuery = t.procedure.use(({ ctx, next }) => {
  const secret = process.env.APP_SECRET ?? "";
  if (secret) {
    assertAuthenticated(ctx.req);
  }
  return next({ ctx });
});

/** 需 Authorization: Bearer APP_SECRET 的变更类过程 */
export const protectedMutation = t.procedure.use(({ ctx, next }) => {
  assertAuthenticated(ctx.req);
  return next({ ctx });
});

function rateLimitMiddleware(scope: string, maxPerWindow = 30) {
  return t.middleware(({ ctx, next }) => {
    try {
      const key = rateLimitKeyFromRequest(ctx.req, scope);
      checkRateLimit(key, maxPerWindow);
    } catch (error) {
      if (error instanceof RateLimitError) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: error.message });
      }
      throw error;
    }
    return next();
  });
}

/** 带速率限制的变更类过程（默认 30 次/分钟） */
export function rateLimitedMutation(scope: string, maxPerWindow = 30) {
  return protectedMutation.use(rateLimitMiddleware(scope, maxPerWindow));
}
