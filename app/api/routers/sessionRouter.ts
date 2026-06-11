import { z } from "zod";
import { createRouter, publicQuery, protectedQuery, protectedMutation } from "../middleware";
import {
  createSession,
  getSession,
  getFullSession,
  updateSessionPhase,
  updateSessionTitle,
  updateSessionTargetTable,
  addMessage,
  listSessions,
  listSessionsByDataSource,
  deleteSession,
} from "../services/sessionService";
import {
  listSavedDataSources,
  getDataSourceById,
  updateDataSource,
  upsertDataSource,
} from "../services/dataSourceStoreService";
import { sanitizeDataSourceForClient } from "../lib/dataSourceSanitizer";

const dataSourceSchema = z.object({
  type: z.enum(["mysql", "postgresql", "sqlite", "sqlserver", "oracle", "csv", "json", "xml", "xlsx"]),
  name: z.string(),
  dbConfig: z
    .object({
      host: z.string(),
      port: z.number(),
      database: z.string(),
      username: z.string(),
      password: z.string(),
      schema: z.string().optional(),
    })
    .optional(),
  fileConfig: z
    .object({
      fileName: z.string(),
      fileSize: z.number(),
      fileType: z.enum(["csv", "json", "xml", "xlsx"]),
      filePath: z.string(),
      encoding: z.string().optional(),
      delimiter: z.string().optional(),
      hasHeader: z.boolean().optional(),
    })
    .optional(),
});

const messageSchema = z.object({
  id: z.string(),
  role: z.enum(["agent", "user", "system"]),
  phase: z.enum(["idle", "explore", "analyze", "confirm", "generate", "execute", "retry"]),
  content: z.string(),
  timestamp: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  actions: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        disabled: z.boolean().optional(),
        type: z.enum([
          "selectTable",
          "startExplore",
          "viewExplore",
          "startAnalysis",
          "viewQuality",
          "viewRules",
          "confirmAll",
          "generateSQL",
          "viewSQL",
          "runFullPipeline",
          "runAgentPlan",
          "updateRule",
          "skipRule",
          "confirmRule",
          "executeSQL",
          "dryRunSQL",
        ]),
      })
    )
    .optional(),
});

export const sessionRouter = createRouter({
  create: protectedMutation
    .input(
      z.object({
        dataSource: dataSourceSchema,
        targetTable: z.string().optional(),
        title: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const sessionId = await createSession(input.dataSource, input.targetTable, {
        title: input.title,
      });
      return { sessionId, success: true };
    }),

  saveDataSource: protectedMutation
    .input(z.object({ dataSource: dataSourceSchema }))
    .mutation(async ({ input }) => {
      const dataSourceId = await upsertDataSource(input.dataSource);
      return { success: true, dataSourceId };
    }),

  createFromDataSource: protectedMutation
    .input(z.object({ dataSourceId: z.string(), title: z.string().optional() }))
    .mutation(async ({ input }) => {
      const config = await import("../services/dataSourceStoreService").then((m) =>
        m.getDataSourceById(input.dataSourceId)
      );
      if (!config) {
        return { success: false, error: "数据源不存在", sessionId: null };
      }
      const sessionId = await createSession(config, undefined, {
        dataSourceId: input.dataSourceId,
        title: input.title,
        initialPhase: "explore",
      });
      return { sessionId, success: true };
    }),

  get: publicQuery
    .input(z.object({ sessionId: z.string() }))
    .query(async ({ input }) => {
      const session = await getSession(input.sessionId);
      return { session, found: !!session };
    }),

  getFull: protectedQuery
    .input(z.object({ sessionId: z.string() }))
    .query(async ({ input }) => {
      const session = await getFullSession(input.sessionId);
      return { session, found: !!session };
    }),

  updatePhase: protectedMutation
    .input(
      z.object({
        sessionId: z.string(),
        phase: z.enum(["idle", "explore", "analyze", "confirm", "generate", "execute", "retry"]),
        lastAction: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      await updateSessionPhase(input.sessionId, input.phase, input.lastAction);
      return { success: true };
    }),

  updateTitle: protectedMutation
    .input(z.object({ sessionId: z.string(), title: z.string() }))
    .mutation(async ({ input }) => {
      await updateSessionTitle(input.sessionId, input.title);
      return { success: true };
    }),

  updateTargetTable: protectedMutation
    .input(z.object({ sessionId: z.string(), targetTable: z.string() }))
    .mutation(async ({ input }) => {
      await updateSessionTargetTable(input.sessionId, input.targetTable);
      return { success: true };
    }),

  addMessage: protectedMutation
    .input(
      z.object({
        sessionId: z.string(),
        message: messageSchema,
      })
    )
    .mutation(async ({ input }) => {
      await addMessage(input.sessionId, input.message);
      return { success: true };
    }),

  list: publicQuery.query(async () => {
    const sessions = await listSessions();
    return { sessions };
  }),

  listByDataSource: publicQuery
    .input(z.object({ dataSourceId: z.string() }))
    .query(async ({ input }) => {
      const sessions = await listSessionsByDataSource(input.dataSourceId);
      return { sessions };
    }),

  listDataSources: publicQuery.query(async () => {
    const dataSources = await listSavedDataSources();
    return { dataSources };
  }),

  getDataSource: publicQuery
    .input(z.object({ dataSourceId: z.string() }))
    .query(async ({ input }) => {
      const config = await getDataSourceById(input.dataSourceId);
      return { found: !!config, config: sanitizeDataSourceForClient(config ?? undefined) };
    }),

  updateDataSource: protectedMutation
    .input(
      z.object({
        dataSourceId: z.string(),
        dataSource: dataSourceSchema,
      })
    )
    .mutation(async ({ input }) => {
      const updated = await updateDataSource(input.dataSourceId, input.dataSource);
      return { success: updated, error: updated ? undefined : "数据源不存在" };
    }),

  delete: protectedMutation
    .input(z.object({ sessionId: z.string() }))
    .mutation(async ({ input }) => {
      const deleted = await deleteSession(input.sessionId);
      return { success: deleted, error: deleted ? undefined : "会话不存在" };
    }),
});
