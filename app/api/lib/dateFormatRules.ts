import type { DatabaseDialect } from "@contracts/types";

/** Java/风格日期格式 → MySQL STR_TO_DATE / PG to_timestamp 模板 */
export const DATE_SOURCE_FORMAT_TEMPLATES: Record<
  string,
  { mysql: string; pg: string; sample: RegExp }
> = {
  "yyyy-MM-dd": { mysql: "%Y-%m-%d", pg: "YYYY-MM-DD", sample: /^\d{4}-\d{2}-\d{2}$/ },
  "yyyy/MM/dd": { mysql: "%Y/%m/%d", pg: "YYYY/MM/DD", sample: /^\d{4}\/\d{2}\/\d{2}$/ },
  "dd-MM-yyyy": { mysql: "%d-%m-%Y", pg: "DD-MM-YYYY", sample: /^\d{2}-\d{2}-\d{4}$/ },
  "dd/MM/yyyy": { mysql: "%d/%m/%Y", pg: "DD/MM/DD", sample: /^\d{2}\/\d{2}\/\d{4}$/ },
  "yyyyMMdd": { mysql: "%Y%m%d", pg: "YYYYMMDD", sample: /^\d{8}$/ },
};

const DEFAULT_SOURCE_FORMATS = ["yyyy-MM-dd", "yyyy/MM/dd", "dd-MM-yyyy"];

/** 从样本值推断可能的源日期格式列表 */
export function detectSourceFormats(samples: string[]): string[] {
  const detected = new Set<string>();
  for (const raw of samples) {
    const v = raw.trim();
    if (!v) continue;
    for (const [name, tpl] of Object.entries(DATE_SOURCE_FORMAT_TEMPLATES)) {
      if (tpl.sample.test(v)) detected.add(name);
    }
  }
  if (detected.size === 0) return [...DEFAULT_SOURCE_FORMATS];
  return Array.from(detected);
}

/** 解析 sourceFormats 参数，缺省为常用格式 */
export function resolveSourceFormats(parameters: Record<string, unknown>): string[] {
  const fromParams = parameters.sourceFormats as string[] | undefined;
  if (Array.isArray(fromParams) && fromParams.length > 0) {
    return fromParams.filter((f) => DATE_SOURCE_FORMAT_TEMPLATES[f]);
  }
  return [...DEFAULT_SOURCE_FORMATS];
}

/** 文件路径：按多格式尝试解析为 ISO 日期 YYYY-MM-DD */
export function parseDateToIso(value: string, sourceFormats: string[]): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  for (const fmt of sourceFormats) {
    const tpl = DATE_SOURCE_FORMAT_TEMPLATES[fmt];
    if (!tpl?.sample.test(trimmed)) continue;
    const iso = parseByFormat(trimmed, fmt);
    if (iso) return iso;
  }

  const fallback = new Date(trimmed);
  if (!Number.isNaN(fallback.getTime())) {
    return fallback.toISOString().slice(0, 10);
  }
  return null;
}

function parseByFormat(value: string, fmt: string): string | null {
  switch (fmt) {
    case "yyyy-MM-dd":
      return value;
    case "yyyy/MM/dd": {
      const [y, m, d] = value.split("/");
      return y && m && d ? `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}` : null;
    }
    case "dd-MM-yyyy": {
      const [d, m, y] = value.split("-");
      return y && m && d ? `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}` : null;
    }
    case "dd/MM/yyyy": {
      const [d, m, y] = value.split("/");
      return y && m && d ? `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}` : null;
    }
    case "yyyyMMdd":
      return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
    default:
      return null;
  }
}

/** SQL：多源格式解析后输出 ISO 日期字符串 */
export function buildDateIsoSql(
  expr: string,
  sourceFormats: string[],
  dialect: DatabaseDialect
): string {
  const formats = sourceFormats.filter((f) => DATE_SOURCE_FORMAT_TEMPLATES[f]);
  const list = formats.length > 0 ? formats : DEFAULT_SOURCE_FORMATS;

  if (dialect === "mysql") {
    const attempts = list.map(
      (f) => `STR_TO_DATE(${expr}, '${DATE_SOURCE_FORMAT_TEMPLATES[f].mysql}')`
    );
    const parsed = attempts.length === 1 ? attempts[0] : `COALESCE(${attempts.join(", ")})`;
    return `DATE_FORMAT(${parsed}, '%Y-%m-%d')`;
  }

  if (dialect === "postgresql") {
    const attempts = list.map((f) => {
      const tpl = DATE_SOURCE_FORMAT_TEMPLATES[f].pg.replace(/'/g, "''");
      return `to_timestamp(${expr}::text, '${tpl}')`;
    });
    const parsed = attempts.length === 1 ? attempts[0] : `COALESCE(${attempts.join(", ")})`;
    return `to_char((${parsed})::date, 'YYYY-MM-DD')`;
  }

  return `CAST(${expr} AS DATE)`;
}
