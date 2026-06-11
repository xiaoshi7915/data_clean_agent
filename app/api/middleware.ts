import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { assertAuthenticated } from "./lib/auth";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const createRouter = t.router;

/** 公开只读过程（health、session 查询等） */
export const publicQuery = t.procedure;

/** 需 Authorization: Bearer APP_SECRET 的变更类过程 */
export const protectedMutation = t.procedure.use(({ ctx, next }) => {
  assertAuthenticated(ctx.req);
  return next({ ctx });
});
