/** 占位符空值列表（分析/文件/SQL 三通道统一） */
export const PLACEHOLDER_NULL_VALUES = [
  "N/A",
  "NA",
  "--",
  "999",
  "NaN",
  "null",
  "none",
  "",
] as const;

/** 小写归一化后的占位符集合，供文件清洗等路径 O(1) 查找 */
export const PLACEHOLDER_NULL_VALUE_SET = new Set(
  PLACEHOLDER_NULL_VALUES.map((v) => v.toLowerCase())
);

/** 判断字符串是否为常见占位空值 */
export function isPlaceholderNullValue(value: string): boolean {
  const trimmed = value.trim();
  return (
    PLACEHOLDER_NULL_VALUES.includes(trimmed as (typeof PLACEHOLDER_NULL_VALUES)[number]) ||
    PLACEHOLDER_NULL_VALUES.includes(trimmed.toUpperCase() as (typeof PLACEHOLDER_NULL_VALUES)[number]) ||
    PLACEHOLDER_NULL_VALUE_SET.has(trimmed.toLowerCase())
  );
}
