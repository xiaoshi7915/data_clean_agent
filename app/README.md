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
| PostgreSQL / SQLite / SQL Server / Oracle | 🔜 即将支持 | 🔜 | — |
| CSV / JSON / XML / XLSX | ✅ | — | ✅ |

## 环境变量

复制 `.env.example` 为 `.env` 并填写：

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | 应用元数据库（MySQL），如 `mysql://user:pass@localhost:3306/data_clean_agent` |
| `APP_ID` | 应用 ID（预留） |
| `APP_SECRET` | API Bearer 令牌；生产环境必填。所有 tRPC **mutation** 需 `Authorization: Bearer <APP_SECRET>` |
| `VITE_APP_SECRET` | 前端开发用，与 `APP_SECRET` 相同以便 mutation 通过鉴权 |
| `UPLOAD_DIR` | 上传目录，默认 `./uploads` |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | OpenAI 兼容 LLM（对话编排） |

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
npm test                 # vitest run
```

## 清洗契约（Phase 1）

规则可导出为 YAML/JSON 契约，并通过 tRPC 往返：

- `contract.exportYaml` / `contract.exportJson` — 从会话规则导出
- `contract.importContract` — 导入契约写回 `cleaning_rules` 与 `contract_yaml`
- Schema：`contracts/cleaning-contract.schema.ts`
- 解析器：`contracts/contractParser.ts`

## 目录结构

```
app/
├── api/           # Hono + tRPC 后端
├── contracts/     # 共享类型、契约 Schema、数据源能力声明
├── db/            # Drizzle schema 与 migrations
├── docs/          # 架构与路线图
└── src/           # React 前端
```

## 相关文档

- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) — 模块职责与 Mermaid 图
- [docs/ROADMAP_TASKS.md](./docs/ROADMAP_TASKS.md) — 功能路线图
- [docs/CLEANING_RULES_CATALOG.md](./docs/CLEANING_RULES_CATALOG.md) — 清洗规则目录
