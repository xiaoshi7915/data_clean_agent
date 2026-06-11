"""
Airflow DAG 片段 — 由 DataClean Agent 生成
表: {{table_name}}
会话: {{session_id}}
"""
from airflow import DAG
from airflow.operators.bash import BashOperator
from datetime import datetime, timedelta

default_args = {
    "owner": "data-clean-agent",
    "depends_on_past": False,
    "retries": 1,
    "retry_delay": timedelta(minutes=5),
}

with DAG(
    dag_id="dca_clean_{{table_name}}",
    default_args=default_args,
    schedule_interval="{{schedule_cron}}",
    start_date=datetime(2024, 1, 1),
    catchup=False,
    tags=["data-clean-agent"],
) as dag:
    run_cleaning_sql = BashOperator(
        task_id="run_cleaning_sql",
        bash_command="mysql -h $DB_HOST -u $DB_USER -p$DB_PASS $DB_NAME < cleaning.sql",
    )
    run_soda_scan = BashOperator(
        task_id="run_soda_scan",
        bash_command="soda scan -d soda/configuration.yml soda/checks.yml",
    )
    webhook_callback = BashOperator(
        task_id="webhook_callback",
        bash_command='curl -X POST "{{webhook_url}}" -H "Authorization: Bearer $DCA_TOKEN" -d \'{"runId":"{{run_id}}","status":"pass"}\'',
    )
    run_cleaning_sql >> run_soda_scan >> webhook_callback
