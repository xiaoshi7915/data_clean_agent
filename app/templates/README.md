# 调度与质量校验模板（桩代码）

本目录下的 **Airflow DAG**、**Deequ Spark checks** 等文件仅为 **导出脚本包时的参考模板**，应用内 **不会自动执行** 这些调度任务。

| 路径 | 说明 |
|------|------|
| `airflow/dag_snippet.py` | Airflow DAG 片段示例，需复制到您的 Airflow 环境并按集群配置修改 |
| `deequ/spark_checks.py` | Deequ 质量校验示例，需在 Spark 集群上运行 |
| `dbt/` | dbt 模型模板，需配合 `dca export --include-dbt` 导出后在 dbt 项目中使用 |

实际执行路径：

1. 在 DataClean Agent 中导出 **脚本包**（`cleaning.sql` + `soda/checks.yml` + `manifest.json`）
2. 在本地或调度平台（Airflow / Cron / CI）运行 SQL 与 Soda
3. 通过 `runs.verificationResult` webhook 回传校验结果（需 `X-Signature` HMAC，见根目录 README）
