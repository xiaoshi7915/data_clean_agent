import { createRouter, publicQuery } from "./middleware";
import { sessionRouter } from "./routers/sessionRouter";
import { exploreRouter } from "./routers/exploreRouter";
import { analyzeRouter } from "./routers/analyzeRouter";
import { rulesRouter } from "./routers/rulesRouter";
import { sqlRouter } from "./routers/sqlRouter";
import { executeRouter } from "./routers/executeRouter";
import { uploadRouter } from "./routers/uploadRouter";
import { chatRouter } from "./routers/chatRouter";
import { contractRouter } from "./routers/contractRouter";
import { artifactRouter } from "./routers/artifactRouter";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  session: sessionRouter,
  explore: exploreRouter,
  analyze: analyzeRouter,
  rules: rulesRouter,
  sql: sqlRouter,
  execute: executeRouter,
  upload: uploadRouter,
  chat: chatRouter,
  contract: contractRouter,
  artifact: artifactRouter,
});

export type AppRouter = typeof appRouter;
