# DataClean Agent — 数据清洗智能体

对话驱动的数据质量探查、规则确认与清洗执行平台。支持 MySQL 数据库与 CSV/JSON/XML/XLSX 文件数据源。

## 架构概览

```
┌─────────────┐     tRPC/REST      ┌──────────────────────────────────┐
│  React UI   │ ◄──────────────► │  Hono API (api/boot.ts)          │
│  (Vite)     │   Bearer Auth    │  session / explore / analyze /   │
└─────────────┘                  │  rules / sql / execute / contract  │
                                 └──────────────┬───────────────────┘
                                                │
                    ┌───────────────────────────┼───────────────────────────┐
                    ▼                           ▼                           ▼
             MySQL (元数据)              mysql2 (探查/执行)            uploads/ (文件)
             Drizzle ORM                 文件解析 (papaparse/xlsx)      本地清洗输出
```

详细模块说明见 [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)。

## 清洗阶段（Phase Flow）

| 阶段 | 说明 |
|------|------|
| `explore` | 探查 Schema、采样、初步问题检测 |
| `analyze` | 质量评分与清洗规则推荐 |
| `confirm` | 用户逐条确认/跳过规则 |
| `generate` | 生成清洗 SQL 或文件清洗计划 |
| `execute` | 执行（含 dry-run） |
| `retry` | 失败重试与手动修 SQL |

阶段转移由 `api/services/phaseValidator.ts` 服务端校验。

## 数据源支持（诚实声明）

| 类型 | 探查 | SQL 执行 | 文件清洗 |
|------|:----:|:--------:|:--------:|
| **MySQL** | ✅ | ✅ | — |
| **PostgreSQL** | ✅ | ✅ | — |
| SQLite / SQL Server / Oracle | 🔜 即将支持 | 🔜 | — |
| CSV / JSON / XML / XLSX | ✅ | — | ✅ |

## 环境变量

复制 `.env.example` 为 `.env` 并填写：

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | 应用元数据库（MySQL），如 `mysql://user:pass@localhost:3306/data_clean_agent` |
| `APP_ID` | 应用 ID（预留） |
| `APP_SECRET` | API Bearer 令牌；生产环境必填。所有 tRPC **mutation** 需 `Authorization: Bearer <APP_SECRET>`；敏感 **query**（`session.getFull`、`contract.exportYaml/Json`）在配置 `APP_SECRET` 后同样需鉴权 |
| `VITE_APP_SECRET` | 前端开发用，与 `APP_SECRET` 相同以便 mutation 通过鉴权 |
| `UPLOAD_DIR` | 上传目录，默认 `./uploads` |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | OpenAI 兼容 LLM（对话编排） |
| `ALLOW_EXECUTE` | 设为 `true` 时解除 SCRIPT_ONLY，允许真实 execute（**默认不设置 = 脚本-only**） |

### SCRIPT_ONLY 模式（默认开启）

平台默认 **不对生产库写入**，仅导出可本地执行的脚本包：

| 行为 | SCRIPT_ONLY（默认） | `ALLOW_EXECUTE=true` |
|------|:-------------------:|:--------------------:|
| API `execute.run` dry-run | ✅ | ✅ |
| API `execute.run` 真实写库 | ❌ 403 | ✅ |
| UI「执行清洗」按钮 | 隐藏 | 显示 |
| UI「导出脚本包」 | ✅ | ✅ |
| CLI `dca execute` | 默认 `--dry-run` | 需 `--force-execute` |

**迁移说明**：现有开发/测试环境若需继续 UI/CLI 真实执行，在 `.env` 中添加 `ALLOW_EXECUTE=true` 并重启服务。

脚本包目录结构（`artifact.exportBundle` / `dca export`）：

```
cleaning-bundle/
├── cleaning.sql      # 合并清洗 SQL
├── steps/            # 分步 SQL
├── contract.yaml     # 清洗契约
├── soda/checks.yml   # Soda Core 质量校验
└── manifest.json     # 元数据与文件清单
```

> 开发环境若未设置 `APP_SECRET`，鉴权自动跳过。生产环境必须配置。

## 本地开发

```bash
cd app
cp .env.example .env
# 编辑 DATABASE_URL 等

npm install
npm run db:push          # 或手动执行 db/migrations/*.sql
npm run dev              # Vite + Hono 开发服务器
```

## 测试

```bash
npm test                 # vitest run（API / 引擎 / 契约 / CLI / 前端组件）
npm run test:coverage    # 带 v8 覆盖率报告
```

覆盖范围包括：`agentService`、`executionService`、`sessionService`、契约 round-trip、tRPC 路由集成、CLI 参数解析，以及 `PhaseIndicator`、`RulesToolbar` 等前端组件测试。

## 安全

| 措施 | 说明 |
|------|------|
| Bearer 鉴权 | `APP_SECRET` 配置后：所有 mutation 必填；`session.getFull`、`contract.exportYaml/Json` 等敏感 query 同样校验 |
| 速率限制 | `chat.send`、`execute.run`、`POST /api/upload` 默认 **30 次/分钟**（按 IP 或 Bearer 前缀区分） |
| 上传限制 | 单文件最大 **50MB**（与 Hono `bodyLimit` 一致），超限返回 413 |
| 生产启动 | `NODE_ENV=production` 时 `env.ts` 要求 `APP_SECRET`、`DATABASE_URL` 等必填，缺失则启动失败 |

`ping` / 健康检查保持公开。

## 清洗契约（Phase 1）

规则可导出为 YAML/JSON 契约，并通过 tRPC 往返：

- `contract.exportYaml` / `contract.exportJson` — 从会话规则导出
- `contract.importContract` — 导入契约写回 `cleaning_rules` 与 `contract_yaml`
- **UI**：规则面板 →「导出 YAML」「导出 JSON」「导入契约」（文件或粘贴）
- Schema：`contracts/cleaning-contract.schema.ts`
- 解析器：`contracts/contractParser.ts`

## 引擎与 CLI（Phase 2–3 基础）

| 模块 | 路径 | 说明 |
|------|------|------|
| 指标注册表 | `engine/metrics/` | row_count、null_count 等，resolve 去重 |
| SQL 方言 | `engine/sql/` | `MysqlDialect`，供 `sqlGenerationService` 复用 |
| 数据源插件 | `engine/datasource/` | `MysqlDataSourcePlugin`；`postgresPlugin` 骨架 |
| SQL 执行器 | `engine/execution/` | `runSqlSteps` 供 API 与 CLI 复用 |
| CLI | `cli/index.ts` | `npm run dca -- <command>` |

```bash
# 探查 MySQL 表
npm run dca -- explore --host 127.0.0.1 --port 3306 --database mydb --user root --password pass --table users

# 从契约编译 SQL
npm run dca -- compile --contract ./contract.yaml --table users --database mydb

# 编译并执行清洗 SQL（默认 dry-run；真实写库需 ALLOW_EXECUTE=true 且 --force-execute）
npm run dca -- execute --contract ./contract.yaml --host 127.0.0.1 --port 3306 --database mydb --user root --password pass --table users

# 导出脚本包到目录
npm run dca -- export --contract ./contract.yaml --out ./cleaning-bundle
npm run dca -- export --session-id sess_xxx --out ./cleaning-bundle
```

## 代码更新后重启服务

生产 Docker 镜像不会自动感知宿主机代码变更，**每次更新代码后需重建并重启**：

```bash
cd app
npm run docker:restart
# 等价于：docker compose down && docker compose build && docker compose up -d
# 国内/弱网可指定镜像：NPM_REGISTRY=https://registry.npmmirror.com npm run docker:build

# 镜像已存在、仅重启容器（跳过 rebuild，解决 npm ETIMEDOUT 反复构建）：
npm run docker:restart:fast
```

仅重建镜像：

```bash
npm run docker:build
npm run docker:prod
```

本地开发若希望改代码后自动热更新，使用 **dev profile**（挂载源码 + `npm run dev`）：

```bash
npm run docker:dev
# 等价于：docker compose --profile dev up app-dev
```

也可直接执行脚本：`bash scripts/docker-restart.sh`

## 目录结构

```
app/
├── api/           # Hono + tRPC 后端
│   └── agents/    # Schema/Quality/Repair/Verify/ScriptGen Agent + Orchestrator
├── cli/           # dca 命令行入口
├── contracts/     # 共享类型、契约 Schema、数据源能力声明
├── db/            # Drizzle schema 与 migrations
├── docs/          # 架构与路线图
├── engine/        # 指标、SQL 方言、数据源插件
└── src/           # React 前端
```

## 相关文档

- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) — 模块职责与 Mermaid 图
- [docs/ROADMAP_TASKS.md](./docs/ROADMAP_TASKS.md) — 功能路线图
- [docs/CLEANING_RULES_CATALOG.md](./docs/CLEANING_RULES_CATALOG.md) — 清洗规则目录
