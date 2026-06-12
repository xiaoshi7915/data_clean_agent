/** 全角字符检测范围：ASCII 可打印字符对应的全角区 + 全角空格 */
export const FULLWIDTH_CHAR_PATTERN = /[\uFF01-\uFF5E\u3000]/;

/** 全角 → 半角（FULLWIDTH 格式分支，文件清洗复用） */
export function fullwidthToHalfwidth(value: string): string {
  return value
    .replace(/\u3000/g, " ")
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

/** 半角 → 全角（HALFWIDTH 格式分支） */
export function halfwidthToFullwidth(value: string): string {
  return value.replace(/[\x21-\x7E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0xfee0));
}

export interface FullwidthCharPair {
  from: string;
  to: string;
}

/** 从样本值中提取实际出现的全角字符对，用于精简 SQL REPLACE 链 */
export function detectFullwidthPairs(samples: string[]): FullwidthCharPair[] {
  const seen = new Set<string>();
  const pairs: FullwidthCharPair[] = [];
  for (const sample of samples) {
    if (!sample) continue;
    if (sample.includes("\u3000") && !seen.has("\u3000")) {
      seen.add("\u3000");
      pairs.push({ from: "\u3000", to: " " });
    }
    for (const ch of sample) {
      const code = ch.charCodeAt(0);
      if (code >= 0xff01 && code <= 0xff5e && !seen.has(ch)) {
        seen.add(ch);
        pairs.push({ from: ch, to: String.fromCharCode(code - 0xfee0) });
      }
    }
  }
  return pairs;
}

function escapeSqlStringLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

/** 默认全角字母数字对（样本未携带 detectedPairs 时的兜底） */
function defaultFullwidthAlphanumericPairs(): FullwidthCharPair[] {
  const pairs: FullwidthCharPair[] = [{ from: "\u3000", to: " " }];
  for (let i = 0; i <= 9; i += 1) {
    pairs.push({
      from: String.fromCharCode(0xff10 + i),
      to: String.fromCharCode(48 + i),
    });
  }
  for (let i = 0; i < 26; i += 1) {
    pairs.push({
      from: String.fromCharCode(0xff21 + i),
      to: String.fromCharCode(65 + i),
    });
    pairs.push({
      from: String.fromCharCode(0xff41 + i),
      to: String.fromCharCode(97 + i),
    });
  }
  return pairs;
}

/** SQL：全角 → 半角；优先仅替换样本中检测到的字符对 */
export function buildFullwidthNormalizeSql(
  expr: string,
  pairs?: FullwidthCharPair[]
): string {
  const effectivePairs =
    pairs && pairs.length > 0 ? pairs : defaultFullwidthAlphanumericPairs();
  let result = expr;
  for (const { from, to } of effectivePairs) {
    result = `REPLACE(${result}, '${escapeSqlStringLiteral(from)}', '${escapeSqlStringLiteral(to)}')`;
  }
  return result;
}

export type StripCharClass = "digit" | "alpha" | "chinese" | "punct" | "space" | "symbol";

const STRIP_PATTERNS: Record<StripCharClass, RegExp> = {
  digit: /\d/g,
  alpha: /[A-Za-z]/g,
  chinese: /[\u4e00-\u9fff\u3400-\u4dbf]/g,
  punct: /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~，。！？；：""''（）【】]/g,
  space: /\s/g,
  symbol: /[^\w\u4e00-\u9fff\s]/g,
};

/** 去除指定字符类 */
export function stripCharClasses(value: string, classes: StripCharClass[]): string {
  let result = value;
  for (const cls of classes) {
    const pattern = STRIP_PATTERNS[cls];
    if (pattern) result = result.replace(pattern, "");
  }
  return result;
}

/** 按起止位置截取（1-based start，end 含首不含尾，缺省至末尾） */
export function substringRange(value: string, start: number, end?: number): string {
  const s = Math.max(1, start) - 1;
  if (end === undefined || end <= 0) return value.slice(s);
  return value.slice(s, end);
}

/** SQL：HALFWIDTH 半角转全角 */
export function buildHalfwidthSql(expr: string): string {
  let result = expr;
  for (let i = 0; i <= 9; i += 1) {
    result = `REPLACE(${result}, '${String.fromCharCode(48 + i)}', '${String.fromCharCode(0xff10 + i)}')`;
  }
  for (let i = 0; i < 26; i += 1) {
    const upper = String.fromCharCode(65 + i);
    const lower = String.fromCharCode(97 + i);
    const fwUpper = String.fromCharCode(0xff21 + i);
    const fwLower = String.fromCharCode(0xff41 + i);
    result = `REPLACE(${result}, '${upper}', '${fwUpper}')`;
    result = `REPLACE(${result}, '${lower}', '${fwLower}')`;
  }
  return result;
}

/** SQL：strip_chars */
export function buildStripCharsSql(expr: string, classes: StripCharClass[]): string {
  let result = expr;
  for (const cls of classes) {
    switch (cls) {
      case "digit":
        result = `REGEXP_REPLACE(${result}, '[0-9]', '')`;
        break;
      case "alpha":
        result = `REGEXP_REPLACE(${result}, '[A-Za-z]', '')`;
        break;
      case "chinese":
        result = `REGEXP_REPLACE(${result}, '[\\u4e00-\\u9fff]', '')`;
        break;
      case "punct":
        result = `REGEXP_REPLACE(${result}, '[[:punct:]]', '')`;
        break;
      case "space":
        result = `REGEXP_REPLACE(${result}, '[[:space:]]', '')`;
        break;
      case "symbol":
        result = `REGEXP_REPLACE(${result}, '[^[:alnum:][:space:]]', '')`;
        break;
      default:
        break;
    }
  }
  return result;
}

/** SQL：substring */
export function buildSubstringSql(expr: string, start: number, end?: number): string {
  const s = Math.max(1, start);
  if (end === undefined || end <= 0) {
    return `SUBSTRING(${expr}, ${s})`;
  }
  const len = Math.max(0, end - s + 1);
  return `SUBSTRING(${expr}, ${s}, ${len})`;
}
