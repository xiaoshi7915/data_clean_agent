import type { DatabaseDialect } from "@contracts/types";

/** GB 11643-1999 身份证校验位权重 */
const CHECK_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2] as const;

/** GB 11643-1999 校验码对照表 */
const CHECK_CODES = ["1", "0", "X", "9", "8", "7", "6", "5", "4", "3", "2"] as const;

/** 计算 17 位本体码的校验位 */
export function computeIdCardCheckDigit(id17: string): string {
  if (id17.length !== 17 || !/^\d{17}$/.test(id17)) {
    throw new Error("身份证本体码须为 17 位数字");
  }
  let sum = 0;
  for (let i = 0; i < 17; i += 1) {
    sum += Number(id17[i]) * CHECK_WEIGHTS[i];
  }
  return CHECK_CODES[sum % 11];
}

/** 校验 18 位身份证号（含校验位） */
export function isValidIdCard18(id18: string): boolean {
  const normalized = id18.trim().toUpperCase();
  if (!/^\d{17}[\dX]$/.test(normalized)) return false;
  return computeIdCardCheckDigit(normalized.slice(0, 17)) === normalized[17];
}

/** 15 位身份证号升 18 位（19 世纪出生默认补 19） */
export function transformIdCard15To18(id15: string): string | null {
  const trimmed = id15.trim();
  if (!/^\d{15}$/.test(trimmed)) return null;
  const base17 = `${trimmed.slice(0, 6)}19${trimmed.slice(6, 15)}`;
  return `${base17}${computeIdCardCheckDigit(base17)}`;
}

/** 统一转换：15 位升位，18 位校验并大写 X */
export function transformIdCard(value: string): string | null {
  const trimmed = value.trim();
  if (/^\d{15}$/.test(trimmed)) {
    return transformIdCard15To18(trimmed);
  }
  if (/^\d{17}[\dXx]$/.test(trimmed)) {
    const upper = trimmed.toUpperCase();
    return isValidIdCard18(upper) ? upper : null;
  }
  return null;
}

/** 检测样本是否含 15 位身份证格式 */
export function has15DigitIdCardSamples(samples: string[]): boolean {
  return samples.some((v) => /^\d{15}$/.test(String(v).trim()));
}

/** 构建 MySQL/PG 校验位 SQL 表达式（输入为 17 位字符串表达式） */
export function buildCheckDigitSql(base17Expr: string, dialect: DatabaseDialect): string {
  const terms = CHECK_WEIGHTS.map(
    (w, i) => `CAST(SUBSTRING(${base17Expr}, ${i + 1}, 1) AS SIGNED) * ${w}`
  ).join(" + ");
  const modExpr = `(${terms}) % 11`;
  const codes = CHECK_CODES.map((c) => `'${c}'`).join(", ");
  if (dialect === "postgresql") {
    return `(ARRAY[${codes}])[(${modExpr}) + 1]`;
  }
  return `ELT((${modExpr}) + 1, ${codes})`;
}

/** 构建 SQL：15 位升 18 位 + 18 位校验（无效时返回 NULL） */
export function buildIdCardTransformSql(expr: string, dialect: DatabaseDialect): string {
  const trimmed = dialect === "postgresql" ? `TRIM(${expr}::text)` : `TRIM(${expr})`;
  const len = `CHAR_LENGTH(${trimmed})`;
  const regex15 =
    dialect === "postgresql"
      ? `${trimmed} ~ '^[0-9]{15}$'`
      : `${trimmed} REGEXP '^[0-9]{15}$'`;
  const regex18 =
    dialect === "postgresql"
      ? `${trimmed} ~ '^[0-9]{17}[0-9Xx]$'`
      : `${trimmed} REGEXP '^[0-9]{17}[0-9Xx]$'`;

  // 15 位升位：前 6 位区划 + 19 + 原 7-15 位顺序码
  const base17From15 = `CONCAT(LEFT(${trimmed}, 6), '19', SUBSTRING(${trimmed}, 7, 9))`;
  const id18From15 = `CONCAT(${base17From15}, ${buildCheckDigitSql(base17From15, dialect)})`;

  const upper = `UPPER(${trimmed})`;
  const checkOk = `${buildCheckDigitSql(`SUBSTRING(${upper}, 1, 17)`, dialect)} = SUBSTRING(${upper}, 18, 1)`;

  return `CASE WHEN ${len} = 15 AND ${regex15} THEN ${id18From15} WHEN ${len} = 18 AND ${regex18} AND ${checkOk} THEN ${upper} ELSE NULL END`;
}
