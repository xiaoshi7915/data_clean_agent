# DataClean Agent — 产品路线图

> 合并 `ROADMAP_TASKS.md` 历史任务与 2026-06-11 代码审查结论。状态：`done` | `in-progress` | `todo`

---

## 已完成里程碑

| 阶段 | 内容 | 状态 |
|------|------|:----:|
| Phase A | 清洗契约 YAML 往返、规则引擎 P1 全量规则 | **done** |
| Phase B | 引擎层（metrics / dialect / plugin）、`dca` CLI | **done** |
| Phase C | `orchestrator` + `orchestration_runs` 持久化状态机 | **done** |
| Phase D | Artifact Bundle（zip、dbt、Airflow 桩、manifest） | **done** |
| Phase E | `runs.verificationResult` 外部 webhook | **done** |
| Phase F | `sodaRunner` + `verify_fail` → `quality_analyze` 反馈回环 | **done** |
| 安全 | 密码脱敏、`sessionCredentialService`、AES 凭证加密、限流 | **done** |
| SCRIPT_ONLY | 默认禁止写库；`ALLOW_EXECUTE` 显式解除 | **done** |
| Sprint 1 | Chat 编排统一、webhook HMAC、`human_confirm` 闸门 | **done** |
| Sprint 2 | 编排进度 UI、Playwright E2E 冒烟、PostgreSQL 文档对齐 | **done** |
| 测试 | vitest + Playwright；`npm run check` 通过 | **done** |
| 前端 | Hooks 拆分（`usePipeline` / `useChat` / `useRuleContract` 等） | **done** |

---

## Sprint 1（近期，约 2 周）— 编排统一与安全

| ID | 任务 | 状态 | 说明 |
|----|------|:----:|------|
| S1-1 | Chat 编排统一到 `orchestrator` | **done** | `chatRouter` 多步走 `handleMultiStepPlan`；`agentService.runAgentPlan` 已废弃 |
| S1-2 | `human_confirm` 闸门 | **done** | 一键流程在 `human_confirm` 暂停；需 `confirmAll` 后再生成 SQL |
| S1-3 | Webhook HMAC 签名 | **done** | `runs.verificationResult` 校验 `X-Signature` |
| S1-4 | `.env.example` 补全 | **done** | `WEBHOOK_HMAC_SECRET`、`MAX_REPAIR_ROUNDS`、`PORT` |
| S1-5 | 编排 API 文档示例 | **done** | curl / HMAC 样例写入 README |

**验收标准**

- [x] 用户说「一键流程」后，规则列表必须经过确认步骤
- [x] 伪造 webhook 无有效签名时被拒绝
- [x] 单一编排代码路径，`orchestration_runs` 为状态唯一来源

---

## Sprint 2（中期，约 2–3 周）— 可观测与质量

| ID | 任务 | 状态 | 说明 |
|----|------|:----:|------|
| S2-1 | 编排进度 UI | **done** | `OrchestratorProgress` + `orchestrator.listBySession` |
| S2-2 | Playwright E2E | **done** | 首页冒烟；`npm run test:e2e` |
| S2-3 | PostgreSQL 探查 MVP | **done** | README / DataSourcePanel 与 `dataSourceSupport.ts` 对齐 |
| S2-4 | 前端测试扩展 | todo | `ChatPanel`、`ExecutionPanel` script-only 分支 |
| S2-5 | 集成测试加强 | todo | tRPC router + 真实 DB mock 覆盖 orchestrator 全链路 |

**验收标准**

- [x] UI 可见当前编排 run 状态
- [x] CI 可跑通至少 1 条 E2E 冒烟
- [x] PostgreSQL 能力文档诚实标注

---

## Sprint 3（远期，约 3–4 周）— 生产化

| ID | 任务 | 状态 | 说明 |
|----|------|:----:|------|
| S3-1 | 整库 batch pipeline | todo | `batchPipelineService`：多表批量 SQL 生成 |
| S3-2 | 大文件策略 | todo | 采样探查、流式解析阈值（当前 50MB 硬限） |
| S3-3 | Airflow DAG 实装 | todo | 替换 scheduling 桩为可运行 DAG 示例 |
| S3-4 | 迁移规范化 | todo | drizzle migrate 替代手工 `db:apply:004` |
| S3-5 | `naturalLanguageAliases` | **done** | `contracts/naturalLanguageAliases.ts` + `ruleIntentService.fieldMatchesAlias` |
| S3-6 | APP_ID 用途或移除生产必填 | **done** | 降为可选，写入启动日志 |

---

## 技术债 backlog（持续）

| ID | 项 | 优先级 |
|----|-----|:------:|
| TD-1 | `dca execute` 移除或硬废弃警告 | P2 |
| TD-2 | sodaRunner 可选内嵌到 artifact 导出后自动试跑 | P3 |
| TD-3 | `APP_SECRET` 轮换 + 密码重加密工具 | P3 |
| TD-4 | 文件/DB 探查「完全重复行」检测对齐 | **done** | `detectFullyDuplicateRowsIssue` |
| TD-5 | MICE 等高级算法从骨架到可选启用 | P3 |
| TD-6 | Airflow/Deequ 模板说明 | **done** | `templates/README.md` |

---

## 与 ROADMAP_TASKS.md 的对照

| ROADMAP_TASKS 条目 | 当前状态 |
|-------------------|----------|
| P0 自然语言 Agent 编排 | **done**（已统一 orchestrator） |
| P1 扩展清洗规则引擎 | **done** |
| P1 naturalLanguageAliases | **done** |
| P2-2 文件/DB 完全重复行对齐 | **done** |
| P2-3 PostgreSQL 探查 | **done** |
| P2-4 测试体系 | **in-progress**（vitest + E2E 冒烟 done） |
| P2-6 安全加固 | **done**（webhook HMAC done） |
| P2-8 README / 架构文档 | **done** |

历史明细见 [ROADMAP_TASKS.md](./ROADMAP_TASKS.md).
