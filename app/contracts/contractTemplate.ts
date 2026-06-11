import { parseCleaningContract } from "./contractParser";

/** 可导入的最小有效清洗契约 YAML 模版（与 contract-template.yaml 同步） */
export const CONTRACT_TEMPLATE_YAML = `version: "1.0"
metadata:
  title: 清洗契约模版
  tableName: example_table
  dialect: mysql
rules:
  - id: rule_example_1
    index: 1
    name: 空值填充
    field: name
    action: fill_null
    strategy: 使用固定值填充空字段
    affectedRows: 0
    affectedPercent: 0
    parameters:
      strategy: fixed
      fillValue: UNKNOWN
    status: pending
  - id: rule_example_2
    index: 2
    name: 去除重复
    field: email
    action: dedup
    strategy: 按 email 字段去重，保留首条记录
    affectedRows: 0
    affectedPercent: 0
    parameters:
      keyFields:
        - email
    status: pending
`;

/** 校验模版可被契约解析器接受 */
export function assertContractTemplateValid(): void {
  parseCleaningContract(CONTRACT_TEMPLATE_YAML, "yaml");
}
