import { z } from "zod";
import { createRouter, protectedMutation } from "../middleware";
import { listDatabaseTables, testDatabaseConnection } from "../services/dataSourceService";
import { getDataSourceById } from "../services/dataSourceStoreService";
import { resolveDbConfigInput } from "../services/sessionCredentialService";
import { runSchemaAgent } from "../agents/schemaAgent";
import { validatePhaseTransition, PhaseValidationError, HistoricalRunWriteError } from "../services/phaseValidator";
import { persistExploration } from "../services/explorationPersistenceService";
import { resolveExistingUploadPath } from "../services/uploadPathService";

const dbConfigSchema = z.object({
  host: z.string(),
  port: z.number(),
  database: z.string(),
  username: z.string(),
  password: z.string(),
  schema: z.string().optional(),
});

export const exploreRouter = createRouter({
  testConnection: protectedMutation
    .input(
      z.object({
        config: dbConfigSchema,
        dbType: z.enum(["mysql", "postgresql", "sqlite", "sqlserver", "oracle"]).optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        await testDatabaseConnection(input.config, input.dbType ?? "mysql");
        return { success: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message };
      }
    }),

  testConnectionByDataSourceId: protectedMutation
    .input(z.object({ dataSourceId: z.string() }))
    .mutation(async ({ input }) => {
      try {
        const config = await getDataSourceById(input.dataSourceId);
        if (!config?.dbConfig) {
          return { success: false, error: "数据源不存在或缺少数据库配置" };
        }
        await testDatabaseConnection(config.dbConfig, config.type);
        return { success: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message };
      }
    }),

  listTables: protectedMutation
    .input(
      z.object({
        sessionId: z.string().optional(),
        config: dbConfigSchema,
        dbType: z.enum(["mysql", "postgresql", "sqlite", "sqlserver", "oracle"]).optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const resolvedConfig = await resolveDbConfigInput(input.sessionId, input.config);
        const tables = await listDatabaseTables(resolvedConfig, input.dbType ?? "mysql");
        return { success: true, tables };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message, tables: [] };
      }
    }),

  exploreDatabase: protectedMutation
    .input(
      z.object({
        sessionId: z.string(),
        runIndex: z.number().int().positive().optional(),
        config: z.object({
          host: z.string(),
          port: z.number(),
          database: z.string(),
          username: z.string(),
          password: z.string(),
          schema: z.string().optional(),
        }),
        tableName: z.string(),
        limit: z.number().optional().default(100),
        dbType: z.enum(["mysql", "postgresql", "sqlite", "sqlserver", "oracle"]).optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        await validatePhaseTransition(input.sessionId, "explore", input.runIndex);
        const resolvedConfig = await resolveDbConfigInput(input.sessionId, input.config);
        const agentResult = await runSchemaAgent({
          sessionId: input.sessionId,
          dataSource: {
            type: input.dbType ?? "mysql",
            name: input.tableName,
            dbConfig: resolvedConfig,
          },
          tableName: input.tableName,
          limit: input.limit,
        });
        if (!agentResult.success || !agentResult.data) {
          return {
            success: false,
            error: agentResult.error ?? "探查失败",
            result: null,
          };
        }
        const result = agentResult.data.exploration;

        await persistExploration(input.sessionId, result, {
          tableName: input.tableName,
          lastAction: "db_explored",
          sessionTitle: `${input.tableName} · 探查完成`,
        });

        return { success: true, result };
      } catch (error) {
        const message =
          error instanceof PhaseValidationError || error instanceof HistoricalRunWriteError
            ? error.message
            : error instanceof Error
            ? error.message
            : String(error);
        return { success: false, error: message, result: null };
      }
    }),

  exploreFile: protectedMutation
    .input(
      z.object({
        sessionId: z.string(),
        runIndex: z.number().int().positive().optional(),
        filePath: z.string(),
        fileType: z.enum(["csv", "json", "xml", "xlsx"]),
        previewRows: z.number().optional().default(100),
      })
    )
    .mutation(async ({ input }) => {
      try {
        await validatePhaseTransition(input.sessionId, "explore", input.runIndex);
        const resolvedPath = resolveExistingUploadPath(input.filePath);
        const fileName = resolvedPath.split("/").pop() ?? "file";
        const agentResult = await runSchemaAgent({
          sessionId: input.sessionId,
          dataSource: {
            type: input.fileType,
            name: fileName,
            fileConfig: {
              filePath: resolvedPath,
              fileType: input.fileType,
              fileName,
              fileSize: 0,
            },
          },
          tableName: fileName.replace(/\.[^.]+$/, "") || "data",
          limit: input.previewRows,
        });
        if (!agentResult.success || !agentResult.data) {
          return {
            success: false,
            error: agentResult.error ?? "文件探查失败",
            result: null,
          };
        }
        const result = agentResult.data.exploration;

        await persistExploration(input.sessionId, result, {
          lastAction: "file_explored",
        });

        return { success: true, result };
      } catch (error) {
        const message =
          error instanceof PhaseValidationError || error instanceof HistoricalRunWriteError
            ? error.message
            : error instanceof Error
            ? error.message
            : String(error);
        return { success: false, error: message, result: null };
      }
    }),
});
