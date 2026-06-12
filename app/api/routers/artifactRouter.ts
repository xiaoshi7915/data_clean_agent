import { z } from "zod";
import { createRouter, protectedMutation, publicQuery } from "../middleware";
import {
  exportSessionArtifactBundle,
  buildArtifactBundle,
  exportZip,
} from "../services/artifactService";
import { parseCleaningContract, contractToRules } from "@contracts/contractParser";
import { generateCleaningSQL } from "../services/sqlGenerationService";
import { env } from "../lib/env";

export const artifactRouter = createRouter({
  /** 运行时配置（SCRIPT_ONLY 等） */
  config: publicQuery.query(() => ({
    scriptOnly: env.scriptOnly,
    allowExecute: env.allowExecute,
  })),

  /** 导出脚本包（文件列表 + 内容；asZip=true 时额外返回 zipBase64 供 UI 下载） */
  exportBundle: protectedMutation
    .input(
      z.object({
        sessionId: z.string().optional(),
        contractYaml: z.string().optional(),
        contractJson: z.string().optional(),
        tableName: z.string().optional(),
        databaseName: z.string().optional(),
        dialect: z.enum(["mysql", "postgresql", "sqlite", "sqlserver", "oracle"]).optional(),
        includeDbt: z.boolean().optional(),
        includeScheduling: z.boolean().optional(),
        asZip: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const bundleOptions = {
          includeDbt: input.includeDbt,
          includeScheduling: input.includeScheduling,
        };

        if (input.sessionId) {
          const bundle = await exportSessionArtifactBundle(input.sessionId, bundleOptions);
          if (!bundle) {
            return {
              success: false,
              error: "会话不存在或尚未生成可导出的 SQL/规则",
              files: null,
              manifest: null,
              zipBase64: null,
            };
          }
          if (input.asZip) {
            const zipBuffer = await exportZip(bundle);
            return {
              success: true,
              ...bundle,
              zipBase64: zipBuffer.toString("base64"),
              error: undefined,
            };
          }
          return { success: true, ...bundle, zipBase64: null, error: undefined };
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
          options: bundleOptions,
        });

        if (input.asZip) {
          const zipBuffer = await exportZip(bundle);
          return {
            success: true,
            ...bundle,
            zipBase64: zipBuffer.toString("base64"),
            error: undefined,
          };
        }
        return { success: true, ...bundle, zipBase64: null, error: undefined };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message, files: null, manifest: null };
      }
    }),
});
