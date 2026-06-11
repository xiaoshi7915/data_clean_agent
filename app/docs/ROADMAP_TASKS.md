# 数据清洗智能体 — 开发路线图任务清单

> 基于项目审查报告（2026-06）拆分。状态：`done` | `in-progress` | `todo`

---

## P0 — 自然语言 Agent 编排（最高优先级）

| ID | 任务 | 状态 | 说明 |
|---|---|---|---|
| P0-1 | 后端 Agent Orchestrator (`agentService.ts`) | **done** | `parseAgentPlan` / `runAgentPlan` / `detectMultiIntent`；chatRouter 多步意图接线 |
| P0-2 | 结构化 LLM 输出 | **done** | `parseLlmJson` 支持 `ruleUpdates`；prompt 描述 JSON 格式 |
| P0-3 | 规则 NL 解析器 (`ruleIntentService.ts`) | **done** | `applyRuleUpdatesFromNL` 模糊匹配字段 + 持久化 |
| P0-4 | 扩展 ChatActionIntent | **done** | `runFullPipeline`, `runAgentPlan`, `updateRule`, `skipRule`, `confirmRule` |
| P0-5 | 接入 keywordFallback | **done** | `resolveChatResponse` LLM 失败/空响应时降级 |
| P0-6 | Session 状态机上移 | **done** | `phaseValidator.ts` 校验 explore/analyze/confirm/generate/execute |
| P0-7 | 对话驱动一键流 | **done** | NL 改规则后 `getFullSession` 刷新；`runAgentPlan` autoTrigger |

### P0 验收要点（本阶段）

- [x] 用户说「一键/全流程」→ `runFullPipeline` autoTrigger
- [x] LLM 返回 `ruleUpdates` → 服务端应用并返回 `ruleUpdatesApplied`
- [x] 前端收到 `ruleUpdatesApplied > 0` 时刷新规则列表
- [x] 多步编排（探查+分析+改规则+生成 一句话完成）→ `runAgentPlan`
- [x] 服务端禁止 analyze 前未 explore → `phaseValidator`

---

## P1 — 扩展清洗规则引擎

| ID | 规则/任务 | analysis | SQL | 文件 | 状态 |
|---|---|:---:|:---:|:---:|---|
| P1-1 | 去重策略扩展（keep last / 时间列） | **done** | **done** | **done** | `keep: last` + `orderColumn` |
| P1-2 | 日期格式标准化 | **done** | **done** | **done** | `DATE_ISO` / STR_TO_DATE |
| P1-3 | 邮箱/手机号校验 | **done** | **done** | **done** | `email_validate` / `phone_validate` |
| P1-4 | 异常值（IQR/Z-score） | **done** | **done** | **done** | IQR + Z-score 3σ + Winsorize |
| P1-5 | 编码/乱码检测 | **done** | **done** | **done** | `encoding_detect` / `encoding_fix` |
| P1-6 | 正则替换 format | **done** | **done** | **done** | `pattern`+`replacement` 分支 |
| P1-7 | 跨字段规则 | **done** | **done** | **done** | `cross_field` fields+operator |
| P1-8 | **merge 合并** | **done** | **done** | **done** | 分析推荐 + CONCAT / CONCAT_WS |
| P1-9 | **CleaningAction 注册表** | — | — | — | **done** | 九大类 `ruleCategory` |
| P1-10 | 批量 NULL 填充（NL） | **done** | **done** | **done** | `expandBulkRuleUpdatesFromMessage` |
| P1-11 | 占位符置空 N/A/--/999 | **done** | **done** | **done** | `placeholder_null` |
| P1-12 | 时间序列 ffill/bfill | **done** | **done** | **done** | FIRST_VALUE 窗口 / 文件逐行 |
| P1-13 | 空字符串→NULL | **done** | **done** | **done** | `treatEmptyAsNull` |
| P1-14 | Z-score 3σ 异常值 | **done** | **done** | **done** | `outlier_zscore` |
| P1-15 | Winsorize 1%/99% | **done** | **done** | **done** | `winsorize` |
| P1-16 | FK/字典码表校验 | **done** | **done** | **done** | `fk_reference` + dictMap / IN |
| P1-17 | 手机号 11 位长度 | **done** | **done** | **done** | `length_validate` |
| P1-18 | 身份证 18 位长度 | **done** | **done** | **done** | `length_validate` |
| P1-19 | 列统计范围校验 | **done** | **done** | **done** | `range_validate` |
| P1-20 | 正则枚举校验 | **done** | **done** | **done** | `regex_validate` |
| P1-21 | 空白折叠 TRIM+WS | **done** | **done** | **done** | `COLLAPSE_WS` |
| P1-22 | HTML 标签剥离 | **done** | **done** | **done** | `STRIP_HTML` |
| P1-23 | 全半角规范化 | **done** | **done** | **done** | SQL REPLACE 链 ０-９ / A-Z |
| P1-24 | 文档类规则 | **done** | partial | **done** | 时区/重复时间戳/状态机 |
| P1-25 | MICE 等高级算法 | **done** | — | — | 骨架 + UI「高级(未启用)」 |

### P1 联动

- [x] 批量「所有字段→NULL」NL 意图 → `ruleIntentService.expandBulkRuleUpdatesFromMessage`
- [x] LLM schema 模板泄漏修复 → `isTemplateOrPlaceholderMessage` + chatRouter 降级
- [ ] `naturalLanguageAliases` 供 ruleIntent 模糊匹配 → todo
- [x] merge / regex 在 SQL + 文件双路径实现（基础版）
- [x] P1-2~P1-4 分析推荐 + SQL/文件执行路径

---

## P2 — 整库批量、稳定性、生产化

| ID | 任务 | 状态 |
|---|---|---|
| P2-1 | 整库一键 SQL (`batchPipelineService`) | todo |
| P2-2 | 文件/DB 探查对齐（完全重复行） | todo |
| P2-3 | PostgreSQL 探查驱动 | todo |
| P2-4 | 测试体系（vitest 单测/集成） | **in-progress** | `ruleIntentService.test.ts` / `llmService.test.ts` |
| P2-5 | 迁移规范化 + 重跑清理旧记录 | todo |
| P2-6 | 安全加固（凭证加密、鉴权、限流） | todo |
| P2-7 | 大文件策略（采样/流式） | todo |
| P2-8 | 项目 README / 架构文档 | todo |

---

## 本 Session 交付摘要

| 文件 | 变更 |
|---|---|
| `api/services/agentService.ts` | **新建** 多步 NL 计划解析与执行 |
| `api/services/phaseValidator.ts` | **新建** 阶段转移校验 |
| `api/services/ruleIntentService.ts` | 语义填充值、`fixed` 策略切换、action 持久化 |
| `api/services/llmService.ts` | `runAgentPlan`、当前时间 prompt、expression fillValue |
| `api/services/analysisService.ts` | P1-2~P1-4 规则推荐 |
| `api/services/sqlGenerationService.ts` | NOW()/校验/异常值 SQL |
| `api/services/fileCleaningService.ts` | 对应文件清洗分支 |
| `api/routers/chatRouter.ts` | 多步 agent + ruleUpdates |
| `api/routers/*Router.ts` | phaseValidator 接入 |
| `src/components/rules/RulesPanel.tsx` | 固定值填充 Input（VariantSelector 分支） |
| `src/hooks/useCleaningSession.ts` | NL 更新后 getFullSession 刷新规则 |
| `api/services/*.test.ts` | vitest 单测 |

---

## 建议下一步

1. **P1-1** 去重 keep last / 时间列策略
2. **P2-1** 整库 batch pipeline
3. **P2-4** 集成测试（tRPC router + DB mock）
4. **naturalLanguageAliases** 供 ruleIntent 字段别名匹配
