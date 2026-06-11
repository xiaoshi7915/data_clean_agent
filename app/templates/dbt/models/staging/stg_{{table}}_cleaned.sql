-- dbt staging model：由 DataClean Agent 自动生成
-- 源表: {{source_table}}
-- 生成时间: {{exported_at}}

{{ config(materialized='view') }}

SELECT *
FROM {{ source('raw', '{{source_table}}') }}
