# data_clean_agent

对话驱动的数据质量探查、规则确认与清洗执行平台。

主应用代码位于 [`app/`](./app/) 目录，详见 [app/README.md](./app/README.md)。

## 快速开始

```bash
cd app
cp .env.example .env
npm install
npm run db:apply:004   # 已有数据的库：安全增量迁移（推荐）
# npm run db:push      # 仅空库/开发库
npm run dev
```

## 当前能力摘要

- 自然语言对话编排（统一 `orchestrator`，含 `human_confirm` 闸门）
- MySQL / PostgreSQL 探查与 SQL 生成；CSV/JSON/XML/XLSX 文件探查与清洗
- 脚本包导出（SQL + Soda + dbt + 调度模板桩）
- 外部校验 webhook（HMAC 签名）与修复回环
- 默认 SCRIPT_ONLY 安全模式

路线图与任务清单：[app/docs/ROADMAP.md](./app/docs/ROADMAP.md) · [app/docs/ROADMAP_TASKS.md](./app/docs/ROADMAP_TASKS.md)
