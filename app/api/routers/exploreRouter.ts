import { z } from "zod";
import { createRouter, protectedMutation } from "../middleware";
import { exploreDatabase, exploreFile, listDatabaseTables, testDatabaseConnection } from "../services/dataSourceService";
import { updateSessionPhase, updateSessionTargetTable, updateSessionTitle } from "../services/sessionService";
import { validatePhaseTransition, PhaseValidationError } from "../services/phaseValidator";
import { getDb } from "../queries/connection";
import { explorationResults } from "@db/schema";

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

  listTables: protectedMutation
    .input(
      z.object({
        config: dbConfigSchema,
        dbType: z.enum(["mysql", "postgresql", "sqlite", "sqlserver", "oracle"]).optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const tables = await listDatabaseTables(input.config, input.dbType ?? "mysql");
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
        await validatePhaseTransition(input.sessionId, "explore");
        const result = await exploreDatabase(
          input.sessionId,
          input.config,
          input.tableName,
          input.limit,
          input.dbType ?? "mysql"
        );

        // Save to DB
        const db = getDb();
        await db.insert(explorationResults).values({
          sessionId: input.sessionId,
          sourceType: result.sourceType,
          sourceName: result.sourceName,
          totalRows: result.totalRows,
          totalCols: result.totalCols,
          schema: result.schema,
          sampleData: result.sampleData,
          columnStats: result.columnStats,
          issues: result.issues,
        });

        await updateSessionPhase(input.sessionId, "explore", "db_explored");
        await updateSessionTargetTable(input.sessionId, input.tableName);
        await updateSessionTitle(
          input.sessionId,
          `${input.tableName} · 探查完成`
        );

        return { success: true, result };
      } catch (error) {
        const message =
          error instanceof PhaseValidationError
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
        filePath: z.string(),
        fileType: z.enum(["csv", "json", "xml", "xlsx"]),
        previewRows: z.number().optional().default(100),
      })
    )
    .mutation(async ({ input }) => {
      try {
        await validatePhaseTransition(input.sessionId, "explore");
        const result = await exploreFile(
          input.filePath,
          input.fileType,
          input.previewRows
        );

        // Save to DB
        const db = getDb();
        await db.insert(explorationResults).values({
          sessionId: input.sessionId,
          sourceType: result.sourceType,
          sourceName: result.sourceName,
          totalRows: result.totalRows,
          totalCols: result.totalCols,
          schema: result.schema,
          sampleData: result.sampleData,
          columnStats: result.columnStats,
          issues: result.issues,
        });

        await updateSessionPhase(input.sessionId, "explore", "file_explored");

        return { success: true, result };
      } catch (error) {
        const message =
          error instanceof PhaseValidationError
            ? error.message
            : error instanceof Error
            ? error.message
            : String(error);
        return { success: false, error: message, result: null };
      }
    }),
});
