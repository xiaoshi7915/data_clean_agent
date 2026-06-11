# DataClean Agent — 数据清洗智能体

对话驱动的数据质量探查、规则确认与清洗脚本生成平台。支持 MySQL 数据库与 CSV/JSON/XML/XLSX 文件数据源。

**当前能力（2026-06）**：自然语言对话编排、多步 Agent 流水线、清洗契约 YAML 往返、脚本包导出（SQL + Soda + dbt + 调度模板）、外部校验 webhook 反馈回环、默认 SCRIPT_ONLY 安全模式。

## 架构概览

```
┌─────────────┐     tRPC/REST      ┌──────────────────────────────────────────┐
│  React UI   │ ◄──────────────► │  Hono API (api/boot.ts)                  │
│  (Vite)     │   Bearer Auth    │  session / explore / analyze / rules /   │
└─────────────┘                  │  sql / execute / contract / artifact /   │
                                 │  orchestrator / runs / chat              │
                                 └──────────────┬───────────────────────────┘
                                                │
                    ┌───────────────────────────┼───────────────────────────┐
                    ▼                           ▼                           ▼
             MySQL (元数据)              mysql2 (探查/执行)            uploads/ (文件)
             Drizzle ORM                 文件解析 (papaparse/xlsx)      本地清洗输出
```

详细模块说明、Mermaid 图与安全模型见 **[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)**。

## 清洗阶段（Phase Flow）

| 阶段 | 说明 |
|------|------|
| `explore` | 探查 Schema、采样、初步问题检测 |
| `analyze` | 质量评分与清洗规则推荐 |
| `confirm` | 用户逐条确认/跳过规则 |
| `generate` | 生成清洗 SQL 或文件清洗计划 |
| `execute` | 执行（含 dry-run）；SCRIPT_ONLY 下引导导出 |
| `retry` | 失败重试与手动修 SQL |

阶段转移由 `api/services/phaseValidator.ts` 服务端校验。并行存在 `orchestration_runs` 编排状态机（见架构文档 Phase C）。

## 数据源支持（诚实声明）

| 类型 | 探查 | SQL 执行 | 文件清洗 |
|------|:----:|:--------:|:--------:|
| **MySQL** | ✅ | ✅（需 `ALLOW_EXECUTE`） | — |
| **PostgreSQL** | ✅ | ✅（需 `ALLOW_EXECUTE`） | — |
| **SQLite** | ✅（`node:sqlite`，database 填文件路径） | ✅（需 `ALLOW_EXECUTE`） | — |
| **SQL Server** | ✅（`mssql` 驱动） | ✅（需 `ALLOW_EXECUTE`） | — |
| **Oracle** | ✅（`oracledb` thin 模式） | ✅（需 `ALLOW_EXECUTE`；无 EXPLAIN 校验） | — |
| CSV / JSON / XML / XLSX | ✅ | — | ✅ |

## 环境变量（完整列表）

复制 `.env.example` 为 `.env` 并填写：

| 变量 | 必填 | 说明 |
|------|:----:|------|
| `DATABASE_URL` | 生产必填 | 应用元数据库（MySQL），如 `mysql://user:pass@localhost:3306/data_clean_agent` |
| `APP_SECRET` | 生产必填 | API Bearer 令牌；mutation 及敏感 query 需 `Authorization: Bearer <APP_SECRET>` |
| `APP_ID` | 否 | 应用标识，写入启动日志前缀（可选） |
| `WEBHOOK_HMAC_SECRET` | 否 | 外部 webhook 签名密钥；未设置时回退 `APP_SECRET` |
| `VITE_APP_SECRET` | 开发推荐 | 前端与 `APP_SECRET` 相同，使 mutation 通过鉴权 |
| `UPLOAD_DIR` | 否 | 上传目录，默认 `./uploads` |
| `LLM_BASE_URL` | 否 | OpenAI 兼容 LLM 基址 |
| `LLM_API_KEY` | 否 | LLM API Key（勿提交到版本库） |
| `LLM_MODEL` | 否 | 模型名，默认 `MiniMax-M2.7` |
| `ALLOW_EXECUTE` | 否 | 设为 `true` 解除 SCRIPT_ONLY，允许真实写库（**默认不设置**） |
| `MAX_REPAIR_ROUNDS` | 否 | 外部校验失败后最大修复回环次数，默认 `3` |
| `NODE_ENV` | 否 | `production` 时强制校验 `APP_SECRET`、`DATABASE_URL` 等 |
| `PORT` | 否 | 服务端口，默认 `3000`（Docker 为 `29000`） |
| `NPM_REGISTRY` | 否 | Docker 构建时 npm 镜像，默认 `https://registry.npmmirror.com` |

> 开发环境若未设置 `APP_SECRET`，鉴权自动跳过。生产环境（`NODE_ENV=production`）必须配置 `APP_SECRET` 与 `DATABASE_URL`。

### SCRIPT_ONLY 模式（默认开启）

平台默认 **不对生产库写入**，仅导出可本地执行的脚本包：

| 行为 | SCRIPT_ONLY（默认） | `ALLOW_EXECUTE=true` |
|------|:-------------------:|:--------------------:|
| API `execute.run` dry-run | ✅ | ✅ |
| API `execute.run` 真实写库 | ❌ 403 | ✅ |
| UI「执行清洗」按钮 | 引导导出脚本包 | 显示真实执行 |
| UI「导出脚本包」 | ✅ | ✅ |
| CLI `dca execute` | 默认 `--dry-run` | 需 `--force-execute` |

**迁移说明**：现有开发/测试环境若需继续 UI/CLI 真实执行，在 `.env` 中添加 `ALLOW_EXECUTE=true` 并重启服务。

脚本包目录结构（`artifact.exportBundle` / `dca export --output DIR`）：

```
cleaning-bundle/
├── cleaning.sql           # 合并清洗 SQL
├── steps/01_*.sql         # 分步 SQL
├── contract.yaml          # 清洗契约
├── soda/checks.yml        # Soda Core 质量校验
├── manifest.json          # 元数据 + scheduling 配置
├── README.md              # 使用说明
├── dbt/                   # 可选 --include-dbt
└── scheduling/airflow/    # 可选 --include-scheduling
```

## 快速开始

```bash
cd app
cp .env.example .env
# 编辑 DATABASE_URL、LLM_* 等

npm install
npm run db:apply:004   # 已有数据的库：安全增量迁移（推荐）
# npm run db:push      # 仅空库/开发库

npm run dev            # Vite + Hono 开发服务器（默认 http://localhost:5173）
```

验证基线：

```bash
npm run check          # TypeScript 编译
npm test               # 174 条用例
```

## 测试

```bash
npm test                 # vitest run
npm run test:e2e         # Playwright 冒烟（需 dev 服务器或 PLAYWRIGHT_SKIP_SERVER=1）
npm run test:coverage    # 带 v8 覆盖率报告
```

覆盖范围包括：编排器持久化、artifact bundle、runs webhook、sodaRunner、密码脱敏（`dataSourceSanitizer`）、鉴权、限流、契约 round-trip、CLI 参数解析，以及 `PhaseIndicator`、`RulesToolbar`、`chatActionState` 等前端测试。

## 安全

| 措施 | 说明 |
|------|------|
| Bearer 鉴权 | `APP_SECRET` 配置后：mutation 必填；`session.getFull`、`contract.export*` 等敏感 query 同样校验 |
| 密码脱敏 | 下发客户端前 `sanitizeDataSourceForClient` 将密码替换为 `********` |
| 凭证解析 | `sessionCredentialService.resolveDbConfigInput` 在服务端合并真实密码 |
| 凭证加密 | `saved_data_sources.db_password` 使用 AES-256-GCM（`enc:v1:` 前缀） |
| 速率限制 | `chat.send`、`execute.run`、`POST /api/upload` 默认 **30 次/分钟** |
| 上传限制 | 单文件最大 **50MB**，超限返回 413 |
| SCRIPT_ONLY | 默认禁止生产库写操作 |
| 生产启动 | `NODE_ENV=production` 时缺失必填环境变量则启动失败 |

`ping` / 健康检查保持公开。

## CLI 命令

```bash
# 探查 MySQL 表
npm run dca -- explore --host 127.0.0.1 --port 3306 --database mydb --user root --password pass --table users

# 从契约编译 SQL
npm run dca -- compile --contract ./contract.yaml --table users --database mydb

# [已弃用] 编译并执行 — 请改用 export + 外部 Runner + webhook
npm run dca -- execute --contract ./contract.yaml --host 127.0.0.1 ...

# 导出脚本包到目录（推荐）
npm run dca -- export --contract ./contract.yaml --output ./cleaning-bundle
npm run dca -- export --session-id sess_xxx --output ./cleaning-bundle --include-dbt --include-scheduling
```

多步编排 API：`orchestrator.start` / `advance` / `status` / `listBySession`；外部校验回传：`runs.verificationResult`。

### 外部调度器 webhook 签名

`runs.verificationResult` 在配置 `WEBHOOK_HMAC_SECRET`（或 `APP_SECRET`）后，要求请求头：

```
X-Signature: sha256=<hex>
```

签名载荷为 **canonical JSON**（字段顺序固定）：

```json
{"runId":"run_xxx","status":"pass","details":"optional"}
```

示例（Node.js）：

```javascript
import { createHmac } from "node:crypto";

const payload = JSON.stringify({ runId: "run_abc", status: "pass", details: "all checks ok" });
const secret = process.env.WEBHOOK_HMAC_SECRET || process.env.APP_SECRET;
const signature = "sha256=" + createHmac("sha256", secret).update(payload, "utf8").digest("hex");

// tRPC POST /api/trpc/runs.verificationResult
// Headers: Authorization: Bearer <APP_SECRET>, X-Signature: <signature>
```

## Docker 部署

```bash
cd app
npm run docker:restart
# 等价于：docker compose down && docker compose build && docker compose up -d
# 国内/弱网：NPM_REGISTRY=https://registry.npmmirror.com npm run docker:build

# 镜像已存在、仅重启容器（跳过 rebuild）：
npm run docker:restart:fast
```

| 命令 | 说明 |
|------|------|
| `npm run docker:prod` | 构建并后台启动生产容器（端口 29000） |
| `npm run docker:dev` | dev profile：挂载源码 + Vite 热更新 |
| `npm run docker:build` | 仅重建镜像 |

生产 Docker 镜像基于 **Node 22**（SQLite 插件依赖内置 `node:sqlite`）。镜像不会自动感知宿主机代码变更，**每次更新代码后需重建并重启**。本地开发推荐 `npm run docker:dev` 或 `npm run dev`。

也可直接执行：`bash scripts/docker-restart.sh`

## 目录结构

```
app/
├── api/           # Hono + tRPC 后端
│   ├── agents/    # Schema/Quality/Repair/Verify/ScriptGen/Orchestrator/SodaRunner
│   ├── routers/   # 按领域拆分的路由
│   └── services/  # 业务服务层
├── cli/           # dca 命令行入口
├── contracts/     # 共享类型、契约 Schema、数据源能力声明
├── db/            # Drizzle schema 与 migrations
├── docs/          # 架构、路线图、规则目录
├── engine/        # 指标、SQL 方言、数据源插件
└── src/           # React 前端（hooks 已拆分）
```

## 问题清单（已知缺口）

| 优先级 | 问题 | 影响 |
|:------:|------|------|
| P2 | sodaRunner 未自动接入主流程，需外部 Runner 手动调用 | Phase F 闭环依赖运维配置 |
| P3 | 大文件（>50MB）上传被拒绝；超大 CSV 无流式采样探查 | 内存与上传体积受限，见 `uploadService` MAX_UPLOAD_BYTES（50MB） |

## 优化建议（按优先级）

1. **凭证轮换**：支持 `APP_SECRET` 轮换时的密码重加密 CLI 命令。
2. **PostgreSQL 增强**：扩展 PG 特有类型与性能优化。
3. **E2E 扩展**：Playwright 覆盖「连接 → 探查 → 分析 → 导出脚本包」完整路径。

## 开发计划（未来 2–3 个 Sprint）

| Sprint | 主题 | 交付物 |
|--------|------|--------|
| **Sprint 1** | 编排统一 + 安全 | ✅ chat 走 orchestrator；webhook HMAC；`human_confirm` 闸门 |
| **Sprint 2** | 可观测 + 测试 | ✅ 编排进度 UI；Playwright E2E 冒烟；PostgreSQL 文档对齐 |
| **Sprint 3** | 生产化 | 整库 batch pipeline；大文件采样；Airflow DAG 实装示例；Drizzle 迁移规范化 |

完整任务拆解见 **[docs/ROADMAP.md](./docs/ROADMAP.md)**。

## 相关文档

- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) — 模块职责、状态机、安全模型、Mermaid 图
- [docs/ROADMAP.md](./docs/ROADMAP.md) — 合并路线图（Sprint 计划 + 历史任务）
- [docs/ROADMAP_TASKS.md](./docs/ROADMAP_TASKS.md) — 历史任务清单（P0/P1 已完成）
- [docs/CLEANING_RULES_CATALOG.md](./docs/CLEANING_RULES_CATALOG.md) — 清洗规则目录
