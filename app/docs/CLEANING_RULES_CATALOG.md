# 清洗规则目录（九大类）

> 将用户数据质量分类映射到系统已实现的 `CleaningAction` 与规则 ID。

## I — 完整性（Missing Values）`integrity`

| 规则 ID | 检测/触发 | action | 说明 |
|---|---|---|---|
| P1-10 | 空值率 > 阈值 | `fill_null` / `remove` | 分组变体：删除行、固定值、均值、变量、NULL 字面量 |
| P1-11 | 样本含 N/A、--、999、NaN | `standardize` | `type: placeholder_null` |
| P1-12 | 时间序列列 | `fill_null` | `strategy: ffill` / `bfill` |
| P1-13 | 空字符串 | `fill_null` | `treatEmptyAsNull: true` |

## II — 准确性（Outliers）`accuracy`

| 规则 ID | 检测/触发 | action | 说明 |
|---|---|---|---|
| P1-4 | 数值列 IQR | `standardize` | `type: outlier_iqr` |
| P1-14 | 数值列 3σ | `standardize` | `type: outlier_zscore` |
| P1-15 | 数值列分位 | `standardize` | `type: winsorize`（1%/99% 截断） |

## III — 一致性（Consistency）`consistency`

| 规则 ID | 检测/触发 | action | 说明 |
|---|---|---|---|
| P1-2 | 日期格式混乱 | `format` | `format: DATE_ISO` |
| P1-3 | 手机/邮箱 | `format` / `standardize` | PHONE + validate |
| — | 性别/枚举 | `standardize` | 字典映射 / 小写 |
| P1-5 | 乱码/混合编码 | `standardize` | `type: encoding_detect` / `encoding_fix` |
| P1-7 | 日期/金额跨列 | `standardize` | `type: cross_field` + `fields` + `operator` |
| P1-8 | 姓名/地址多列 | `merge` | `sourceFields` + `separator` |
| P1-16 | 编码/状态列 | `standardize` | `type: fk_reference`（`allowedValues` / `dictMap`） |

## IV — 唯一性（Uniqueness）`uniqueness`

| 规则 ID | 检测/触发 | action | 说明 |
|---|---|---|---|
| — | 完全重复行 | `dedup` | `scope: full_row`, keep first |
| P1-1 | 有时间列 | `dedup` | `keep: last` + `orderColumn` |
| — | ID 列重复 | `dedup` | `scope: column` |

## V — 有效性（Validity）`validity`

| 规则 ID | 检测/触发 | action | 说明 |
|---|---|---|---|
| P1-17 | 手机号 | `standardize` | `length_validate` expectedLength=11 |
| P1-18 | 身份证 | `standardize` | `length_validate` expectedLength=18 |
| P1-19 | 列统计 min/max | `standardize` | `range_validate` |
| P1-20 | 状态枚举 | `standardize` | `regex_validate` |

## VI — 文本（Text）`text`

| 规则 ID | 检测/触发 | action | 说明 |
|---|---|---|---|
| — | 首尾空格 | `format` | TRIM |
| P1-21 | 连续空白 | `format` | `COLLAPSE_WS` |
| P1-22 | HTML 标签 | `format` | `STRIP_HTML` |
| P1-23 | 全角字符 | `format` | `FULLWIDTH` |
| P1-6 | 自定义 | `format` | `pattern` + `replacement` |

## VII — 文档 `document`

| 规则 ID | 检测/触发 | action | 说明 |
|---|---|---|---|
| P1-24 | 含时区偏移的时间列 | `standardize` | `type: timezone_normalize`（UTC 提示） |
| P1-24 | 时间序列重复时间戳 | `standardize` | `type: duplicate_timestamp`（文件行级） |
| P1-24 | 状态枚举有序样本 | `standardize` | `type: state_transition` + `allowedTransitions` |

## VIII — 骨架/高级 `skeleton`

| 规则 ID | action | recommended | 说明 |
|---|---|:---:|---|
| P1-25 | `fill_null` | false | MICE 多重插补（注册表 + UI「高级(未启用)」） |
| — | — | false | Isolation Forest / DBSCAN（注册表预留） |

## IX — 质量指标 `metrics`

| 能力 | 位置 | 说明 |
|---|---|---|
| 质量评分 | `analysisService.generateQualityReport` | completeness / validity / uniqueness 等 |
| 汇总摘要 | QualityReport.summary | 含平均空值率、重复行占比 |

## 自然语言批量操作

| 用户说法 | 服务端行为 |
|---|---|
| 「所有字段/全部字段 … 空值 … NULL」 | `expandBulkRuleUpdatesFromMessage` → 逐字段 `fill_null` + `fillValue: NULL` |

## 相关文件

- `api/services/cleaningActionRegistry.ts` — 动作注册与类别标签
- `api/services/analysisService.ts` — 规则推荐
- `api/services/sqlGenerationService.ts` — SQL 实现
- `api/services/fileCleaningService.ts` — 文件清洗实现
- `api/services/ruleIntentService.ts` — NL 规则修改与批量展开
