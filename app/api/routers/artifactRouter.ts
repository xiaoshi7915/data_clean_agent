import { z } from "zod";
import { createRouter, protectedMutation, publicQuery } from "../middleware";
import { exportSessionArtifactBundle, buildArtifactBundle } from "../services/artifactService";
import { parseCleaningContract, contractToRules } from "@contracts/contractParser";
import { generateCleaningSQL } from "../services/sqlGenerationService";
import { env } from "../lib/env";

export const artifactRouter = createRouter({
  /** 运行时配置（SCRIPT_ONLY 等） */
  config: publicQuery.query(() => ({
    scriptOnly: env.scriptOnly,
    allowExecute: env.allowExecute,
  })),

  /** 导出脚本包（JSON 文件列表 + 内容，供 UI/CLI 下载） */
  exportBundle: protectedMutation
    .input(
      z.object({
        sessionId: z.string().optional(),
        contractYaml: z.string().optional(),
        contractJson: z.string().optional(),
        tableName: z.string().optional(),
        databaseName: z.string().optional(),
        dialect: z.enum(["mysql", "postgresql", "sqlite", "sqlserver", "oracle"]).optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        if (input.sessionId) {
          const bundle = await exportSessionArtifactBundle(input.sessionId);
          if (!bundle) {
            return {
              success: false,
              error: "会话不存在或尚未生成可导出的 SQL/规则",
              files: null,
              manifest: null,
            };
          }
          return { success: true, ...bundle, error: undefined };
        }

        const contractSource = input.contractYaml ?? input.contractJson;
        if (!contractSource) {
          return {
            success: false,
            error: "请提供 sessionId 或 contractYaml/contractJson",
            files: null,
            manifest: null,
          };
        }

        const format = input.contractYaml ? "yaml" : "json";
        const contract = parseCleaningContract(contractSource, format);
        const rules = contractToRules(contract);
        const tableName = input.tableName ?? contract.metadata?.tableName ?? "data";
        const databaseName =
          input.databaseName ?? contract.metadata?.databaseName ?? "default";
        const dialect = input.dialect ?? contract.metadata?.dialect ?? "mysql";

        const sqlResult = generateCleaningSQL(
          rules,
          dialect,
          tableName,
          databaseName,
          rules.map((r) => r.field).filter((f) => f !== "*")
        );

        const bundle = buildArtifactBundle({
          rules,
          sqlResult,
          dialect,
          tableName,
          databaseName,
          explorationDataset: `datasource/${databaseName}/default/${tableName}`,
        });

        return { success: true, ...bundle, error: undefined };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message, files: null, manifest: null };
      }
    }),
});
