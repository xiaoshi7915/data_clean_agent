import type {
  CleaningRule,
  SQLGenerationResult,
  SQLStep,
  DatabaseDialect,
  SQLGenerationOptions,
} from "@contracts/types";
import { mysqlDialect } from "../../engine/sql/mysqlDialect";
import { postgresDialect } from "../../engine/sql/postgresDialect";
import { resolveRuleVariant } from "./analysisService";
import { buildRowCountValidationSql } from "./sqlGenerationMetrics";
import {
  buildDictMapCaseSql,
  buildDictMapRejectWhereSql,
  resolveFieldDictMap,
  resolveUnmatchedStrategy,
} from "../lib/dictMapRules";
import { buildValidateExpressionSql, buildValidateRejectWhereSql } from "../lib/validateRuleSql";
import { buildDateIsoSql, resolveSourceFormats } from "../lib/dateFormatRules";
import { buildFilterKeepWhereSql } from "../lib/filterRules";
import {
  buildHalfwidthSql,
  buildStripCharsSql,
  buildSubstringSql,
  buildFullwidthNormalizeSql,
  type FullwidthCharPair,
  type StripCharClass,
} from "../lib/textFormatRules";
import {
  buildProblemTableCreateSql,
  problemTableName,
} from "../lib/problemRecords";
import {
  buildEntityValidateSql,
  buildNumericValidateSql,
  buildPartitionDedupPartitionCols,
} from "../lib/advancedRuleHelpers";

export function cleanedTableName(tableName: string): string {
  return `${tableName}_cleaned`;
}

/** 探查基于样本时在生成 SQL 顶部写入说明注释 */
export function buildExplorationSamplingSqlHeader(options: SQLGenerationOptions): string {
  const lines: string[] = [];
  if (options.explorationSampleBased) {
    lines.push(
      `-- 清洗规则基于抽样探查（${options.explorationSampleSize ?? "N/A"} 行样本）推导；以下 INSERT SELECT 仍对源表/文件全量执行。`
    );
  }
  if (options.explorationRowCountApproximate) {
    lines.push("-- 探查阶段行数为 catalog/文件估算值，未执行精确 COUNT(*)。");
  }
  if (lines.length === 0) return "";
  return `${lines.join("\n")}\n\n`;
}

function finalizeConsolidatedSql(steps: SQLStep[], options: SQLGenerationOptions): string {
  const body = buildConsolidatedCleaningSql(steps);
  const header = buildExplorationSamplingSqlHeader(options);
  return header ? `${header}${body}` : body;
}

/** 合并主清洗 SQL：CREATE TABLE（及衍生列 ALTER）+ INSERT SELECT */
export function buildConsolidatedCleaningSql(steps: SQLStep[]): string {
  const createOutputStep = steps.find(
    (s) => s.operationType === "CREATE" && s.name.includes("清洗输出表")
  );
  const alterSteps = steps.filter(
    (s) => s.operationType === "CREATE" && s.name.includes("衍生列")
  );
  const insertStep = steps.find(
    (s) =>
      s.operationType === "INSERT" &&
      !s.name.includes("问题记录") &&
      !s.name.includes("备份")
  );

  const parts: string[] = [];
  if (createOutputStep?.sql) parts.push(createOutputStep.sql.trim());
  for (const alter of alterSteps) {
    if (alter.sql?.trim()) parts.push(alter.sql.trim());
  }
  if (insertStep?.sql) parts.push(insertStep.sql.trim());

  if (parts.length === 0) return "";
  return parts.map((p) => (p.endsWith(";") ? p : `${p};`)).join("\n\n");
}

export function generateCleaningSQL(
  rules: CleaningRule[],
  dialect: DatabaseDialect,
  tableName: string,
  databaseName: string,
  columns: string[] = [],
  options: SQLGenerationOptions = {}
): SQLGenerationResult {
  const confirmedRules = rules
    .filter((r) => r.status === "confirmed")
    .map(resolveRuleVariant);
  const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
  const backupTableName = `${tableName}_backup_${timestamp}`;
  const outputTableName = cleanedTableName(tableName);

  if (confirmedRules.length === 0) {
    return generatePassthroughSQL(
      dialect,
      tableName,
      databaseName,
      backupTableName,
      outputTableName,
      options
    );
  }

  const allColumns = resolveColumns(columns, confirmedRules);
  const orderColumn = findOrderColumn(allColumns, confirmedRules);
  const fullRowDedup = confirmedRules.some(
    (r) => r.action === "dedup" && (r.field === "*" || r.parameters.scope === "full_row")
  );
  const columnDedupRule = confirmedRules.find(
    (r) => r.action === "dedup" && r.field !== "*" && r.parameters.scope !== "full_row"
  );
  const dedupKeep = (columnDedupRule?.parameters.keep as string) ||
    (confirmedRules.find((r) => r.action === "dedup")?.parameters.keep as string) ||
    "first";

  const insertSelectSql = buildConsolidatedInsertSelect(
    confirmedRules,
    dialect,
    tableName,
    outputTableName,
    allColumns,
    orderColumn,
    fullRowDedup,
    columnDedupRule,
    dedupKeep,
    options.sourceWhereClause
  );

  const steps: SQLStep[] = [];
  let stepNum = 0;

  steps.push({
    stepNumber: stepNum++,
    name: "创建备份表",
    operationType: "CREATE",
    sql: generateBackupSQL(dialect, tableName, backupTableName),
    affectedRows: 0,
    estimatedTime: "< 1s",
    riskLevel: "low",
    rollbackSql: `DROP TABLE IF EXISTS ${quoteTable(backupTableName, dialect)};`,
  });

  const splitRules = confirmedRules.filter((r) => r.action === "split");
  const splitTargets = splitRules
    .map((r) => r.parameters.targetColumn as string)
    .filter((t): t is string => !!t && !allColumns.includes(t));

  steps.push({
    stepNumber: stepNum++,
    name: "创建清洗输出表结构",
    operationType: "CREATE",
    sql: generateCreateLikeSQL(dialect, tableName, outputTableName),
    affectedRows: 0,
    estimatedTime: "< 1s",
    riskLevel: "low",
    rollbackSql: `DROP TABLE IF EXISTS ${quoteTable(outputTableName, dialect)};`,
  });

  if (splitTargets.length > 0) {
    const alterSql = splitTargets
      .map(
        (col) =>
          `ALTER TABLE ${quoteTable(outputTableName, dialect)} ADD COLUMN ${quoteColumn(col, dialect)} VARCHAR(255);`
      )
      .join("\n");
    steps.push({
      stepNumber: stepNum++,
      name: "添加衍生列",
      operationType: "CREATE",
      sql: alterSql,
      affectedRows: 0,
      estimatedTime: "< 1s",
      riskLevel: "low",
    });
  }

  steps.push({
    stepNumber: stepNum++,
    name: "执行清洗（单条 INSERT SELECT）",
    operationType: "INSERT",
    sql: insertSelectSql,
    affectedRows: confirmedRules.reduce((sum, r) => sum + (r.affectedRows || 0), 0),
    estimatedTime: "< 10s",
    riskLevel: confirmedRules.some((r) => r.action === "dedup" || r.action === "remove") ? "high" : "medium",
    rollbackSql: `TRUNCATE TABLE ${quoteTable(outputTableName, dialect)};`,
  });

  steps.push({
    stepNumber: stepNum,
    name: "验证清洗结果",
    operationType: "SELECT",
    sql: `${buildRowCountValidationSql(outputTableName, dialect)};`,
    affectedRows: 0,
    estimatedTime: "< 1s",
    riskLevel: "low",
  });

  const errTable = problemTableName(tableName);
  const shouldEmitProblem =
    options.emitProblemTable !== false &&
    confirmedRules.some(
      (r) =>
        r.parameters.emitToProblemTable === true ||
        r.parameters.invalidAction === "reject" ||
        r.parameters.unmatchedStrategy === "reject"
    );

  if (shouldEmitProblem) {
    stepNum += 1;
    steps.push({
      stepNumber: stepNum,
      name: "创建问题表",
      operationType: "CREATE",
      sql: buildProblemTableCreateSql(tableName, dialect),
      affectedRows: 0,
      estimatedTime: "< 1s",
      riskLevel: "low",
      rollbackSql: `DROP TABLE IF EXISTS ${quoteTable(errTable, dialect)};`,
    });
    const problemInsertSql = buildProblemRecordsInsertSql(
      confirmedRules,
      dialect,
      tableName,
      allColumns,
      options.sourceWhereClause
    );
    if (problemInsertSql) {
      stepNum += 1;
      steps.push({
        stepNumber: stepNum,
        name: "写入问题记录",
        operationType: "INSERT",
        sql: problemInsertSql,
        affectedRows: 0,
        estimatedTime: "< 10s",
        riskLevel: "medium",
      });
    }
  }

  const consolidatedSql = finalizeConsolidatedSql(steps, options);

  const totalAffectedRows = confirmedRules.reduce((sum, r) => sum + (r.affectedRows || 0), 0);

  return {
    targetDialect: dialect,
    targetTable: outputTableName,
    targetDatabase: databaseName,
    steps,
    consolidatedSql,
    backupSql: generateBackupSQL(dialect, tableName, backupTableName),
    rollbackSql: generateRollbackSQL(dialect, outputTableName, backupTableName),
    totalAffectedRows,
    problemTableName: shouldEmitProblem ? errTable : undefined,
  };
}

function generatePassthroughSQL(
  dialect: DatabaseDialect,
  tableName: string,
  databaseName: string,
  backupTableName: string,
  outputTableName: string,
  options: SQLGenerationOptions = {}
): SQLGenerationResult {
  const quotedSource = quoteTable(tableName, dialect);
  const quotedOutput = quoteTable(outputTableName, dialect);
  const insertSql = `INSERT INTO ${quotedOutput}\nSELECT * FROM ${quotedSource};`;

  const steps: SQLStep[] = [
    {
      stepNumber: 0,
      name: "创建备份表",
      operationType: "CREATE",
      sql: generateBackupSQL(dialect, tableName, backupTableName),
      affectedRows: 0,
      estimatedTime: "< 1s",
      riskLevel: "low",
      rollbackSql: `DROP TABLE IF EXISTS ${quoteTable(backupTableName, dialect)};`,
    },
    {
      stepNumber: 1,
      name: "创建清洗输出表结构",
      operationType: "CREATE",
      sql: generateCreateLikeSQL(dialect, tableName, outputTableName),
      affectedRows: 0,
      estimatedTime: "< 1s",
      riskLevel: "low",
      rollbackSql: `DROP TABLE IF EXISTS ${quotedOutput};`,
    },
    {
      stepNumber: 2,
      name: "复制数据到清洗表（无规则直通）",
      operationType: "INSERT",
      sql: insertSql,
      affectedRows: 0,
      estimatedTime: "< 10s",
      riskLevel: "low",
      rollbackSql: `TRUNCATE TABLE ${quotedOutput};`,
    },
    {
      stepNumber: 3,
      name: "验证清洗结果",
      operationType: "SELECT",
      sql: `${buildRowCountValidationSql(outputTableName, dialect)};`,
      affectedRows: 0,
      estimatedTime: "< 1s",
      riskLevel: "low",
    },
  ];

  const consolidatedSql = finalizeConsolidatedSql(steps, options);

  return {
    targetDialect: dialect,
    targetTable: outputTableName,
    targetDatabase: databaseName,
    steps,
    consolidatedSql,
    backupSql: generateBackupSQL(dialect, tableName, backupTableName),
    rollbackSql: generateRollbackSQL(dialect, outputTableName, backupTableName),
    totalAffectedRows: 0,
  };
}

function resolveColumns(columns: string[], rules: CleaningRule[]): string[] {
  if (columns.length > 0) return columns;
  const fromRules = new Set<string>();
  for (const rule of rules) {
    if (rule.field && rule.field !== "*") {
      fromRules.add(rule.field);
    }
  }
  return fromRules.size > 0 ? Array.from(fromRules) : ["*"];
}

function findOrderColumn(columns: string[], rules: CleaningRule[] = []): string {
  const dedupRule = rules.find((r) => r.action === "dedup");
  const tsCol = dedupRule?.parameters.orderColumn as string | undefined;
  if (tsCol && columns.includes(tsCol)) return tsCol;

  const timeCol = columns.find((c) =>
    /time|date|created|updated|timestamp/i.test(c)
  );
  if (timeCol) return timeCol;

  const idCol = columns.find((c) => c.toLowerCase() === "id");
  if (idCol) return idCol;
  const idLike = columns.find((c) => c.toLowerCase().endsWith("_id"));
  if (idLike) return idLike;
  return columns[0] || "id";
}

function buildConsolidatedInsertSelect(
  rules: CleaningRule[],
  dialect: DatabaseDialect,
  sourceTable: string,
  outputTable: string,
  columns: string[],
  orderColumn: string,
  fullRowDedup: boolean,
  columnDedupRule?: CleaningRule,
  dedupKeep: string = "first",
  sourceWhereClause?: string
): string {
  const quotedSource = quoteTable(sourceTable, dialect);
  const quotedOutput = quoteTable(outputTable, dialect);
  const removeRules = rules.filter((r) => r.action === "remove");
  const splitRules = rules.filter((r) => r.action === "split");

  const outputColumns: string[] = [...columns];
  for (const split of splitRules) {
    const target = split.parameters.targetColumn as string | undefined;
    if (target && !outputColumns.includes(target)) {
      outputColumns.push(target);
    }
  }

  const selectExprs = outputColumns.map((col) => {
    const splitRule = splitRules.find((r) => r.parameters.targetColumn === col);
    if (splitRule) {
      return buildSplitExpression(splitRule, dialect);
    }
    const colRules = rules.filter(
      (r) =>
        ruleAppliesToColumn(r, col) &&
        r.action !== "split" &&
        r.action !== "dedup" &&
        r.action !== "remove"
    );
    const expr = buildTransformedExpression(col, colRules, dialect, orderColumn);
    return `${expr} AS ${quoteColumn(col, dialect)}`;
  });

  const whereClauses = removeRules.map((r) => {
    const col = quoteColumn(r.field, dialect);
    if (r.parameters.condition === "IS EMPTY") {
      return `(${col} IS NOT NULL AND ${col} <> '')`;
    }
    return `${col} IS NOT NULL`;
  });

  // reject 策略：校验/码表未匹配行从结果集中排除
  for (const rule of rules) {
    if (rule.action !== "standardize") continue;
    const col = quoteColumn(rule.field, dialect);
    const expr = `src.${col}`;
    const filterWhere = buildFilterKeepWhereSql(rule, expr, dialect);
    if (filterWhere) {
      whereClauses.push(filterWhere);
      continue;
    }
    const rejectWhere = buildValidateRejectWhereSql(rule, expr, dialect);
    if (rejectWhere) {
      whereClauses.push(rejectWhere);
      continue;
    }
    const type = rule.parameters.type as string | undefined;
    if (type === "dictMap" || type === "fk_reference" || rule.parameters.fromCodeTable) {
      const dictMap = resolveFieldDictMap(rule.parameters, rule.field);
      if (
        resolveUnmatchedStrategy(rule.parameters) === "reject" &&
        Object.keys(dictMap).length > 0
      ) {
        const whitelist = rule.parameters.whitelist as string[] | undefined;
        whereClauses.push(buildDictMapRejectWhereSql(expr, dictMap, whitelist));
      }
    }
  }

  if (sourceWhereClause && sourceWhereClause.trim()) {
    whereClauses.unshift(`(${sourceWhereClause.trim()})`);
  }

  const partitionCols = fullRowDedup
    ? columns.map((c) => quoteColumn(c, dialect))
    : columnDedupRule
    ? buildPartitionDedupPartitionCols(columnDedupRule, columns, columnDedupRule.field).map((c) =>
        quoteColumn(c, dialect)
      )
    : [];

  const innerSelect = buildInnerSelect(
    dialect,
    quotedSource,
    columns,
    orderColumn,
    partitionCols,
    whereClauses,
    fullRowDedup || !!columnDedupRule,
    dedupKeep
  );

  const insertCols = outputColumns.map((c) => quoteColumn(c, dialect)).join(", ");
  const selectList = selectExprs.join(",\n       ");

  if (fullRowDedup || columnDedupRule) {
    return `INSERT INTO ${quotedOutput} (${insertCols})\nSELECT ${selectList}\nFROM (\n${indentSql(innerSelect, 2)}\n) AS src\nWHERE src._dedup_rn = 1;`;
  }

  return `INSERT INTO ${quotedOutput} (${insertCols})\nSELECT ${selectList}\nFROM (\n${indentSql(innerSelect, 2)}\n) AS src;`;
}

function buildInnerSelect(
  dialect: DatabaseDialect,
  quotedSource: string,
  columns: string[],
  orderColumn: string,
  partitionCols: string[],
  whereClauses: string[],
  needsDedup: boolean,
  dedupKeep: string = "first"
): string {
  const whereSql = whereClauses.length > 0 ? `\n  WHERE ${whereClauses.join("\n    AND ")}` : "";
  const quotedOrder = quoteColumn(orderColumn, dialect);
  const orderDir = dedupKeep === "last" ? "DESC" : "ASC";

  if (!needsDedup) {
    const colList = columns.map((c) => quoteColumn(c, dialect)).join(", ");
    return `SELECT ${colList}\n  FROM ${quotedSource} AS src${whereSql}`;
  }

  if (dialect === "mysql" || dialect === "postgresql" || dialect === "sqlserver") {
    const colList = columns.map((c) => quoteColumn(c, dialect)).join(", ");
    const partitionBy = partitionCols.join(", ");
    return `SELECT ${colList},\n         ROW_NUMBER() OVER (PARTITION BY ${partitionBy} ORDER BY ${quotedOrder} ${orderDir}) AS _dedup_rn\n  FROM ${quotedSource} AS src${whereSql}`;
  }

  const groupBy = partitionCols.join(", ");
  const colList = columns.map((c) => `src.${quoteColumn(c, dialect)}`).join(", ");
  const extraWhere = whereSql ? whereSql.replace("WHERE", "AND") : "";
  return `SELECT ${colList},\n         1 AS _dedup_rn\n  FROM ${quotedSource} AS src\n  INNER JOIN (\n    SELECT MIN(rowid) AS _keep_rowid, ${groupBy}\n    FROM ${quotedSource}\n    GROUP BY ${groupBy}\n  ) AS dedup ON src.rowid = dedup._keep_rowid${extraWhere}`;
}

function ruleAppliesToColumn(rule: CleaningRule, column: string): boolean {
  if (rule.field === column) return true;
  const fields = rule.parameters.fields as string[] | undefined;
  return Array.isArray(fields) && fields.includes(column);
}

function buildTransformedExpression(
  column: string,
  rules: CleaningRule[],
  dialect: DatabaseDialect,
  orderColumn: string
): string {
  const quoted = quoteColumn(column, dialect);
  let expr = `src.${quoted}`;

  for (const rule of rules) {
    switch (rule.action) {
      case "fill_null":
        expr = buildFillNullExpression(expr, rule, dialect, orderColumn);
        break;
      case "format":
        expr = applyFormatExpression(expr, rule, dialect);
        break;
      case "standardize":
        expr = applyStandardizeExpression(expr, rule, dialect, column, orderColumn);
        break;
      case "convert_type":
        expr = `CAST(${expr} AS ${rule.parameters.targetType || "VARCHAR(255)"})`;
        break;
      case "truncate":
        expr = `LEFT(${expr}, ${rule.parameters.maxLength || 255})`;
        break;
      case "merge":
        expr = buildMergeExpression(expr, rule, dialect);
        break;
      default:
        break;
    }
  }

  return expr;
}

function buildRunningPartitionExpr(nullishExpr: string, orderCol: string, direction: "asc" | "desc"): string {
  const orderDir = direction === "desc" ? "DESC" : "ASC";
  return `SUM(CASE WHEN ${nullishExpr} IS NOT NULL AND CAST(${nullishExpr} AS CHAR) <> '' THEN 1 ELSE 0 END) OVER (ORDER BY ${orderCol} ${orderDir} ROWS UNBOUNDED PRECEDING)`;
}

function buildFfillExpression(
  nullishExpr: string,
  orderColumn: string,
  dialect: DatabaseDialect
): string {
  const quotedOrder = `src.${quoteColumn(orderColumn, dialect)}`;
  const partitionExpr = buildRunningPartitionExpr(nullishExpr, quotedOrder, "asc");
  if (dialect === "sqlite") {
    return `COALESCE(${nullishExpr}, LAG(${nullishExpr}) OVER (ORDER BY ${quotedOrder}))`;
  }
  return `COALESCE(${nullishExpr}, FIRST_VALUE(${nullishExpr}) OVER (PARTITION BY ${partitionExpr} ORDER BY ${quotedOrder} ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW))`;
}

function buildBfillExpression(
  nullishExpr: string,
  orderColumn: string,
  dialect: DatabaseDialect
): string {
  const quotedOrder = `src.${quoteColumn(orderColumn, dialect)}`;
  const partitionExpr = buildRunningPartitionExpr(nullishExpr, quotedOrder, "desc");
  if (dialect === "sqlite") {
    return `COALESCE(${nullishExpr}, LEAD(${nullishExpr}) OVER (ORDER BY ${quotedOrder}))`;
  }
  return `COALESCE(${nullishExpr}, FIRST_VALUE(${nullishExpr}) OVER (PARTITION BY ${partitionExpr} ORDER BY ${quotedOrder} DESC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW))`;
}

function buildFillNullExpression(
  expr: string,
  rule: CleaningRule,
  dialect: DatabaseDialect,
  orderColumn: string
): string {
  const strategy = (rule.parameters.strategy as string) || "fixed";
  const nullishExpr =
    rule.parameters.treatEmptyAsNull === true
      ? `NULLIF(NULLIF(${expr}, ''), ' ')`
      : expr;

  switch (strategy) {
    case "ffill":
      return buildFfillExpression(nullishExpr, orderColumn, dialect);
    case "bfill":
      return buildBfillExpression(nullishExpr, orderColumn, dialect);
    case "mean":
      if (dialect === "sqlite") {
        return `COALESCE(${nullishExpr}, (SELECT AVG(CAST(${nullishExpr} AS REAL)) FROM src))`;
      }
      return `COALESCE(${nullishExpr}, AVG(CAST(${nullishExpr} AS DECIMAL(18,4))) OVER ())`;
    case "variable": {
      const varName =
        (rule.parameters.variableName as string) ||
        (rule.parameters.fillValue as string) ||
        rule.field;
      const placeholder = varName.startsWith("${") ? varName : `\${${varName}}`;
      return `COALESCE(${nullishExpr}, '${placeholder.replace(/'/g, "''")}')`;
    }
    case "default":
    case "fixed":
    default: {
      const fillVal = rule.parameters.fillValue ?? "UNKNOWN";
      if (rule.parameters.replaceAll === true) {
        return formatValue(fillVal);
      }
      return `COALESCE(${nullishExpr}, ${formatValue(fillVal)})`;
    }
  }
}

function applyFormatExpression(expr: string, rule: CleaningRule, dialect: DatabaseDialect): string {
  const pattern = rule.parameters.pattern as string | undefined;
  const replacement = rule.parameters.replacement;
  if (pattern && replacement !== undefined && replacement !== null) {
    const escapedPattern = String(pattern).replace(/'/g, "''");
    const escapedReplacement = String(replacement).replace(/'/g, "''");
    if (dialect === "mysql") {
      return `REGEXP_REPLACE(${expr}, '${escapedPattern}', '${escapedReplacement}')`;
    }
    return `REGEXP_REPLACE(${expr}, '${escapedPattern}', '${escapedReplacement}', 'g')`;
  }

  const format = rule.parameters.format as string;
  switch (format) {
    case "TRIM":
      return `TRIM(${expr})`;
    case "UPPER":
      return `UPPER(${expr})`;
    case "LOWER":
      return `LOWER(${expr})`;
    case "PHONE":
      if (dialect === "mysql") {
        return `REGEXP_REPLACE(${expr}, '[^0-9]', '')`;
      }
      return `REGEXP_REPLACE(${expr}, '[^0-9]', '', 'g')`;
    case "DATE_ISO": {
      const sourceFormats = resolveSourceFormats(rule.parameters);
      return buildDateIsoSql(expr, sourceFormats, dialect);
    }
    case "HALFWIDTH":
      return buildHalfwidthSql(expr);
    case "strip_chars": {
      const classes = (rule.parameters.charClasses as StripCharClass[] | undefined) ?? ["digit"];
      return buildStripCharsSql(expr, classes);
    }
    case "substring": {
      const start = (rule.parameters.start as number) ?? 1;
      const end = rule.parameters.end as number | undefined;
      return buildSubstringSql(expr, start, end);
    }
    case "COLLAPSE_WS":
      if (dialect === "mysql") {
        return `REGEXP_REPLACE(TRIM(${expr}), '[[:space:]]+', ' ')`;
      }
      return `REGEXP_REPLACE(TRIM(${expr}), '\\s+', ' ', 'g')`;
    case "STRIP_HTML":
      return `REGEXP_REPLACE(${expr}, '<[^>]+>', '')`;
    case "FULLWIDTH": {
      const pairs = rule.parameters.detectedPairs as FullwidthCharPair[] | undefined;
      return buildFullwidthNormalizeSql(expr, pairs);
    }
    default:
      return `TRIM(${expr})`;
  }
}

function buildCrossFieldSql(
  expr: string,
  rule: CleaningRule,
  dialect: DatabaseDialect,
  column: string
): string | null {
  const fields = rule.parameters.fields as string[] | undefined;
  if (!fields || fields.length < 2) return null;
  const [fieldA, fieldB] = fields;
  if (column !== fieldB && column !== fieldA) return null;

  const quotedA = `src.${quoteColumn(fieldA, dialect)}`;
  const quotedB = `src.${quoteColumn(fieldB, dialect)}`;
  const op = String(rule.parameters.operator ?? "<");
  const invalidAction = rule.parameters.action === "flag" ? "flag" : "null";
  const condition = `${quotedA} ${op} ${quotedB}`;

  const targetExpr = column === fieldB ? expr : quotedA;
  if (invalidAction === "flag") {
    return `CASE WHEN NOT (${condition}) THEN CONCAT(CAST(${targetExpr} AS CHAR), '[CROSS_FIELD_INVALID]') ELSE ${targetExpr} END`;
  }
  return `CASE WHEN NOT (${condition}) THEN NULL ELSE ${targetExpr} END`;
}

function applyStandardizeExpression(
  expr: string,
  rule: CleaningRule,
  dialect: DatabaseDialect,
  column: string,
  orderColumn: string
): string {
  if (rule.parameters.type === "mice_impute") {
    return expr;
  }

  if (rule.parameters.type === "duplicate_timestamp") {
    if (dialect === "mysql" || dialect === "postgresql" || dialect === "sqlserver") {
      return `CASE WHEN COUNT(${expr}) OVER (PARTITION BY ${expr}) > 1 THEN CONCAT(CAST(${expr} AS CHAR), '[DUPLICATE_TIMESTAMP]') ELSE ${expr} END`;
    }
    return expr;
  }

  if (rule.parameters.type === "state_transition") {
    const transitions = rule.parameters.allowedTransitions as
      | Record<string, string[]>
      | undefined;
    const quotedOrder = `src.${quoteColumn(orderColumn, dialect)}`;
    if (transitions && (dialect === "mysql" || dialect === "postgresql" || dialect === "sqlserver")) {
      const prevExpr = `LOWER(TRIM(LAG(${expr}) OVER (ORDER BY ${quotedOrder})))`;
      const currExpr = `LOWER(TRIM(${expr}))`;
      const invalidChecks: string[] = [];
      for (const [fromState, toStates] of Object.entries(transitions)) {
        const allowed = toStates.map((s) => `'${s.toLowerCase().replace(/'/g, "''")}'`).join(", ");
        if (allowed.length > 0) {
          invalidChecks.push(
            `(${prevExpr} = '${fromState.toLowerCase().replace(/'/g, "''")}' AND ${currExpr} NOT IN (${allowed}))`
          );
        }
      }
      if (invalidChecks.length > 0) {
        const invalidCond = invalidChecks.join(" OR ");
        return `CASE WHEN ${prevExpr} IS NOT NULL AND (${invalidCond}) THEN CONCAT(CAST(${expr} AS CHAR), '[INVALID_STATE_TRANSITION]') ELSE ${expr} END`;
      }
    }
    return expr;
  }

  if (rule.parameters.type === "placeholder_null") {
    const placeholders = (rule.parameters.placeholders as string[] | undefined) ?? [
      "N/A",
      "NA",
      "--",
      "999",
      "NaN",
    ];
    const checks = placeholders
      .map((p) => `UPPER(TRIM(${expr})) = '${String(p).replace(/'/g, "''").toUpperCase()}'`)
      .join(" OR ");
    return `CASE WHEN ${checks} THEN NULL ELSE ${expr} END`;
  }

  if (
    rule.parameters.type === "age_clamp" ||
    rule.parameters.type === "outlier_iqr" ||
    rule.parameters.type === "outlier_zscore" ||
    rule.parameters.type === "winsorize" ||
    rule.parameters.type === "range_validate"
  ) {
    const min = rule.parameters.min ?? 0;
    const max = rule.parameters.max ?? 150;
    const cond = `CAST(${expr} AS SIGNED) >= ${min} AND CAST(${expr} AS SIGNED) <= ${max}`;
    if (rule.parameters.type === "range_validate") {
      const wrapped = buildValidateExpressionSql(rule, expr, dialect);
      if (wrapped) return wrapped;
    }
    return `CASE WHEN ${cond} THEN ${expr} ELSE NULL END`;
  }

  if (rule.parameters.type === "length_validate") {
    const wrapped = buildValidateExpressionSql(rule, expr, dialect);
    if (wrapped) return wrapped;
    const expected = (rule.parameters.expectedLength as number) ?? 11;
    return `CASE WHEN CHAR_LENGTH(TRIM(${expr})) = ${expected} THEN ${expr} ELSE NULL END`;
  }

  if (rule.parameters.type === "regex_validate") {
    const wrapped = buildValidateExpressionSql(rule, expr, dialect);
    if (wrapped) return wrapped;
    const pattern = String(rule.parameters.pattern ?? ".*").replace(/'/g, "''");
    return `CASE WHEN ${expr} REGEXP '${pattern}' THEN ${expr} ELSE NULL END`;
  }

  if (rule.parameters.type === "id_card_transform") {
    const wrapped = buildValidateExpressionSql(rule, expr, dialect);
    if (wrapped) return wrapped;
  }

  const numericSql = buildNumericValidateSql(rule, expr);
  if (numericSql) return numericSql;

  const entitySql = buildEntityValidateSql(rule, expr, dialect);
  if (entitySql) return entitySql;

  if (rule.parameters.type === "length_range") {
    const wrapped = buildValidateExpressionSql(rule, expr, dialect);
    if (wrapped) return wrapped;
    const min = rule.parameters.minLength as number | undefined;
    const max = rule.parameters.maxLength as number | undefined;
    const trimmed = dialect === "postgresql" ? `TRIM(${expr}::text)` : `TRIM(${expr})`;
    const parts: string[] = [];
    if (min !== undefined) parts.push(`CHAR_LENGTH(${trimmed}) >= ${min}`);
    if (max !== undefined) parts.push(`CHAR_LENGTH(${trimmed}) <= ${max}`);
    if (parts.length > 0) {
      return `CASE WHEN ${parts.join(" AND ")} THEN ${expr} ELSE NULL END`;
    }
  }

  if (rule.parameters.type === "custom_expression") {
    // P2-R6 defer：仅透传原值，表达式模板待 sandbox 实现
    return expr;
  }

  if (rule.parameters.type === "cross_field") {
    const crossExpr = buildCrossFieldSql(expr, rule, dialect, column);
    if (crossExpr) return crossExpr;
  }

  if (rule.parameters.type === "encoding_detect") {
    if (dialect === "mysql") {
      return `CASE WHEN ${expr} REGEXP '[ÃÂâ€ï¿½]' THEN CONCAT(CAST(${expr} AS CHAR), '[ENCODING_ERROR]') ELSE CONVERT(${expr} USING utf8mb4) END`;
    }
    return `CASE WHEN ${expr} ~ '[ÃÂâ€ï¿½]' THEN CONCAT(CAST(${expr} AS CHAR), '[ENCODING_ERROR]') ELSE ${expr} END`;
  }

  if (rule.parameters.type === "encoding_fix") {
    if (dialect === "mysql") {
      return `CONVERT(CAST(CONVERT(${expr} USING latin1) AS BINARY) USING utf8mb4)`;
    }
    return expr;
  }

  if (rule.parameters.type === "timezone_normalize") {
    const targetTz = String(rule.parameters.targetTimezone ?? "UTC");
    if (dialect === "mysql") {
      return `CONVERT_TZ(${expr}, @@session.time_zone, '+00:00')`;
    }
    if (dialect === "postgresql") {
      return `(${expr} AT TIME ZONE 'UTC' AT TIME ZONE '${targetTz.replace(/'/g, "''")}')`;
    }
    return expr;
  }

  if (
    rule.parameters.type === "fk_reference" ||
    rule.parameters.type === "dictMap" ||
    rule.parameters.fromCodeTable
  ) {
    const dictMap = resolveFieldDictMap(rule.parameters, column);
    if (dictMap && Object.keys(dictMap).length > 0) {
      const strategy = resolveUnmatchedStrategy(rule.parameters);
      const whitelist = rule.parameters.whitelist as string[] | undefined;
      const customValue = rule.parameters.customUnmatchedValue as string | undefined;
      return buildDictMapCaseSql(expr, dictMap, strategy, whitelist, customValue);
    }

    if (rule.parameters.type === "fk_reference") {
      const allowed = rule.parameters.allowedValues as string[] | undefined;
      if (allowed && allowed.length > 0) {
        const inList = allowed.map((v) => `'${String(v).replace(/'/g, "''")}'`).join(", ");
        return `CASE WHEN ${expr} IS NULL OR TRIM(${expr}) = '' THEN NULL WHEN ${expr} IN (${inList}) THEN ${expr} ELSE NULL END`;
      }

      const dictTable = rule.parameters.dictTable as string | undefined;
      if (dictTable) {
        const quotedDict = quoteTable(dictTable, dialect);
        const codeCol = quoteColumn(
          (rule.parameters.dictCodeColumn as string) || "code",
          dialect
        );
        const nameCol = quoteColumn(
          (rule.parameters.dictNameColumn as string) || "name",
          dialect
        );
        return `COALESCE((SELECT ${nameCol} FROM ${quotedDict} d WHERE d.${codeCol} = ${expr} LIMIT 1), ${expr})`;
      }
    }

    return `CASE WHEN ${expr} IS NULL OR TRIM(${expr}) = '' THEN NULL ELSE ${expr} END`;
  }

  if (rule.parameters.type === "email_validate") {
    const wrapped = buildValidateExpressionSql(rule, expr, dialect);
    if (wrapped) return wrapped;
    return `CASE WHEN ${expr} REGEXP '^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$' THEN ${expr} ELSE NULL END`;
  }

  if (rule.parameters.type === "phone_validate") {
    const wrapped = buildValidateExpressionSql(rule, expr, dialect);
    if (wrapped) return wrapped;
    const cleaned = `REGEXP_REPLACE(${expr}, '[^0-9]', '')`;
    return `CASE WHEN CHAR_LENGTH(${cleaned}) BETWEEN 7 AND 15 THEN ${cleaned} ELSE NULL END`;
  }

  if (rule.parameters.dictionary && rule.parameters.mapping) {
    const mapping = rule.parameters.mapping as Record<string, string>;
    const cases = Object.entries(mapping)
      .map(
        ([k, v]) =>
          `WHEN LOWER(TRIM(${expr})) = '${k.replace(/'/g, "''")}' THEN '${String(v).replace(/'/g, "''")}'`
      )
      .join("\n           ");
    return `CASE ${cases}\n           ELSE ${expr} END`;
  }

  if (rule.parameters.case === "lower") {
    return `LOWER(TRIM(${expr}))`;
  }

  return `LOWER(${expr})`;
}

function buildSplitExpression(rule: CleaningRule, dialect: DatabaseDialect): string {
  const sourceCol = quoteColumn(rule.field, dialect);
  const targetCol = quoteColumn((rule.parameters.targetColumn as string) || `${rule.field}_domain`, dialect);
  const part = rule.parameters.part as string;

  if (part === "derived_mapping") {
    return `src.${sourceCol} AS ${targetCol}`;
  }

  if (part === "domain") {
    if (dialect === "mysql") {
      return `SUBSTRING_INDEX(src.${sourceCol}, '@', -1) AS ${targetCol}`;
    }
    return `SPLIT_PART(src.${sourceCol}, '@', 2) AS ${targetCol}`;
  }

  return `src.${sourceCol} AS ${targetCol}`;
}

function buildMergeExpression(
  expr: string,
  rule: CleaningRule,
  dialect: DatabaseDialect
): string {
  const sourceFields = (rule.parameters.sourceFields as string[] | undefined)?.filter(Boolean);
  if (!sourceFields || sourceFields.length < 2) {
    return expr;
  }
  const separator = String(rule.parameters.separator ?? "");
  const parts = sourceFields.map(
    (f) => `COALESCE(CAST(src.${quoteColumn(f, dialect)} AS CHAR), '')`
  );
  if (separator) {
    if (dialect === "mysql") {
      return mysqlDialect.concatWs(separator, parts);
    }
    const escapedSep = separator.replace(/'/g, "''");
    return `CONCAT_WS('${escapedSep}', ${parts.join(", ")})`;
  }
  if (dialect === "mysql") {
    return mysqlDialect.concat(parts);
  }
  return `CONCAT(${parts.join(", ")})`;
}

function indentSql(sql: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return sql
    .split("\n")
    .map((line) => pad + line)
    .join("\n");
}

function generateCreateLikeSQL(dialect: DatabaseDialect, sourceTable: string, targetTable: string): string {
  switch (dialect) {
    case "mysql":
      return mysqlDialect.createTableLikeSql(sourceTable, targetTable);
    case "postgresql":
      return postgresDialect.createTableLikeSql(sourceTable, targetTable);
    case "sqlserver":
      return `SELECT * INTO ${quoteTable(targetTable, dialect)}\nFROM ${quoteTable(sourceTable, dialect)}\nWHERE 1 = 0;`;
    case "sqlite":
      return `CREATE TABLE ${quoteTable(targetTable, dialect)} AS\nSELECT * FROM ${quoteTable(sourceTable, dialect)} WHERE 1 = 0;`;
    default:
      return `CREATE TABLE ${quoteTable(targetTable, dialect)} AS\nSELECT * FROM ${quoteTable(sourceTable, dialect)} WHERE 1 = 0;`;
  }
}

function quoteTable(table: string, dialect: DatabaseDialect): string {
  switch (dialect) {
    case "mysql":
      return mysqlDialect.quoteTable(table);
    case "postgresql":
      return postgresDialect.quoteTable(table);
    case "sqlserver":
      return `[${table}]`;
    case "sqlite":
      return `"${table}"`;
    case "oracle":
      return `"${table.toUpperCase()}"`;
    default:
      return table;
  }
}

function quoteColumn(column: string, dialect: DatabaseDialect): string {
  switch (dialect) {
    case "mysql":
      return mysqlDialect.quoteIdentifier(column);
    case "postgresql":
      return postgresDialect.quoteIdentifier(column);
    case "sqlserver":
      return `[${column}]`;
    case "sqlite":
      return `"${column}"`;
    case "oracle":
      return `"${column.toUpperCase()}"`;
    default:
      return column;
  }
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "string") {
    const upper = value.toUpperCase();
    if (upper === "NULL") return "NULL";
    if (["NOW()", "CURRENT_TIMESTAMP", "CURRENT_DATE", "CURRENT_TIME"].includes(upper)) {
      return upper === "CURRENT_TIMESTAMP" ? "CURRENT_TIMESTAMP" : upper;
    }
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

function generateBackupSQL(dialect: DatabaseDialect, tableName: string, backupName: string): string {
  switch (dialect) {
    case "mysql":
      return mysqlDialect.createBackupSql(tableName, backupName);
    case "postgresql":
      return postgresDialect.createBackupSql(tableName, backupName);
    case "sqlserver":
      return `SELECT * INTO [${backupName}]\nFROM [${tableName}];`;
    case "sqlite":
      return `CREATE TABLE "${backupName}" AS\nSELECT * FROM "${tableName}";`;
    case "oracle":
      return `CREATE TABLE "${backupName.toUpperCase()}" AS\nSELECT * FROM "${tableName.toUpperCase()}";`;
    default:
      return `CREATE TABLE ${backupName} AS\nSELECT * FROM ${tableName};`;
  }
}

function generateRollbackSQL(dialect: DatabaseDialect, tableName: string, backupName: string): string {
  const qt = (t: string) => quoteTable(t, dialect);
  return `-- 完全回滚方案（谨慎使用）\n-- 1. 清空清洗后的表\nTRUNCATE TABLE ${qt(tableName)};\n\n-- 2. 从备份恢复\nINSERT INTO ${qt(tableName)}\nSELECT * FROM ${qt(backupName)};`;
}

/** 生成问题表 INSERT（各 reject 规则 UNION） */
function buildProblemRecordsInsertSql(
  rules: CleaningRule[],
  dialect: DatabaseDialect,
  sourceTable: string,
  _columns: string[],
  sourceWhereClause?: string
): string | null {
  const errTable = quoteTable(problemTableName(sourceTable), dialect);
  const quotedSource = quoteTable(sourceTable, dialect);
  const inserts: string[] = [];

  for (const rule of rules) {
    if (rule.action !== "standardize") continue;
    const col = quoteColumn(rule.field, dialect);
    const expr = `${col}`;
    const filterWhere = buildFilterKeepWhereSql(rule, expr, dialect);
    const validateWhere = buildValidateRejectWhereSql(rule, expr, dialect);
    const keepWhere = filterWhere ?? validateWhere;
    if (!keepWhere) continue;

    // 非空且不满足保留条件 → 问题行
    const rejectCond = `(NOT (${keepWhere}))`;
    const ruleName = String(rule.name ?? rule.id).replace(/'/g, "''");
    const errType = String(rule.parameters.type ?? "VALIDATE").replace(/'/g, "''");
    const baseWhere = sourceWhereClause?.trim()
      ? `WHERE (${sourceWhereClause.trim()}) AND ${rejectCond}`
      : `WHERE ${rejectCond}`;

    inserts.push(
      `INSERT INTO ${errTable} (err_field, err_data, err_rule_name, err_type)\nSELECT '${rule.field.replace(/'/g, "''")}', CAST(${expr} AS CHAR), '${ruleName}', '${errType}'\nFROM ${quotedSource}\n${baseWhere}`
    );
  }

  if (inserts.length === 0) return null;
  return inserts.join(";\n\n");
}

export function validateSQL(sql: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (/DROP\s+TABLE/i.test(sql) && !sql.includes("_backup_")) {
    errors.push("检测到 DROP TABLE 操作，不允许删除非备份表");
  }

  if (/TRUNCATE\s+TABLE/i.test(sql)) {
    errors.push("检测到 TRUNCATE TABLE 操作，已拦截");
  }

  if (/DELETE\s+FROM\s+\w+\s*;?\s*$/i.test(sql) && !/WHERE/i.test(sql)) {
    errors.push("检测到 DELETE 语句缺少 WHERE 子句，已拦截");
  }

  if (/ALTER\s+TABLE\s+\w+\s+DROP\s+COLUMN/i.test(sql)) {
    errors.push("检测到删除列操作，需要用户二次确认");
  }

  if (!sql.trim().endsWith(";") && sql.includes(";")) {
    errors.push("SQL语句应该以分号结尾");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function isDangerousOperation(sql: string): boolean {
  const dangerous = [
    /DROP\s+TABLE(?!\s+\w+_backup_)/i,
    /TRUNCATE\s+TABLE/i,
    /DELETE\s+FROM\s+\w+\s*;?\s*$/i,
    /ALTER\s+TABLE\s+\w+\s+DROP\s+COLUMN/i,
  ];

  return dangerous.some((pattern) => pattern.test(sql));
}
