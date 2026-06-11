import { z } from "zod";
import { createRouter, publicQuery, protectedQuery, protectedMutation } from "../middleware";
import {
  exportSessionContractYaml,
  exportSessionContractJson,
  importContractToSession,
  getSessionContractYaml,
  loadContractFromDbRules,
} from "../services/contractService";

export const contractRouter = createRouter({
  /** 导出会话规则为 YAML 契约 */
  exportYaml: protectedQuery
    .input(z.object({ sessionId: z.string() }))
    .query(async ({ input }) => {
      const yaml = await exportSessionContractYaml(input.sessionId);
      if (!yaml) {
        return { success: false, error: "会话不存在或无规则", yaml: null };
      }
      return { success: true, yaml };
    }),

  /** 导出会话规则为 JSON 契约 */
  exportJson: protectedQuery
    .input(z.object({ sessionId: z.string() }))
    .query(async ({ input }) => {
      const json = await exportSessionContractJson(input.sessionId);
      if (!json) {
        return { success: false, error: "会话不存在或无规则", json: null };
      }
      return { success: true, json };
    }),

  /** 从 DB 规则 round-trip 重建契约对象 */
  fromDbRules: publicQuery
    .input(z.object({ sessionId: z.string() }))
    .query(async ({ input }) => {
      const contract = await loadContractFromDbRules(input.sessionId);
      return { success: !!contract, contract };
    }),

  /** 读取会话缓存的 contract_yaml */
  getCachedYaml: publicQuery
    .input(z.object({ sessionId: z.string() }))
    .query(async ({ input }) => {
      const yaml = await getSessionContractYaml(input.sessionId);
      return { yaml };
    }),

  /** 导入 YAML/JSON 契约并写回 cleaning_rules */
  importContract: protectedMutation
    .input(
      z.object({
        sessionId: z.string(),
        source: z.string().min(1),
        format: z.enum(["json", "yaml", "auto"]).optional().default("auto"),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const rules = await importContractToSession(input.sessionId, input.source, input.format);
        return { success: true, ruleCount: rules.length, rules };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message, ruleCount: 0, rules: [] };
      }
    }),
});
