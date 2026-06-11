/**
 * 自然语言字段别名 → 规范模式映射
 * 供 ruleIntentService 模糊匹配列名（如「手机号」→ phone/mobile 列）
 */
export const FIELD_ALIAS_GROUPS: Record<string, string[]> = {
  phone: [
    "手机号",
    "手机",
    "电话",
    "联系电话",
    "mobile",
    "phone",
    "cell",
    "telephone",
    "tel",
    "msisdn",
  ],
  email: ["邮箱", "邮件", "email", "e-mail", "e_mail", "mail"],
  name: ["姓名", "名字", "用户名", "name", "username", "full_name", "fullname"],
  id: ["身份证", "证件号", "idcard", "id_card", "identity"],
  address: ["地址", "住址", "address", "addr"],
  date: ["日期", "时间", "date", "time", "timestamp", "created", "updated"],
  status: ["状态", "state", "status"],
  amount: ["金额", "价格", "amount", "price", "money", "fee"],
};

/** 规范化字段/别名 token（小写、去分隔符） */
export function normalizeAliasToken(value: string): string {
  return value.toLowerCase().replace(/[\s_\-.]+/g, "");
}

/** 用户输入是否命中某别名组 */
export function getCanonicalFieldKey(query: string): string | undefined {
  const normalized = normalizeAliasToken(query);
  if (!normalized) return undefined;

  for (const [canonical, aliases] of Object.entries(FIELD_ALIAS_GROUPS)) {
    if (normalizeAliasToken(canonical) === normalized) return canonical;
    if (aliases.some((alias) => normalizeAliasToken(alias) === normalized)) {
      return canonical;
    }
  }
  return undefined;
}

/** 两个字段名是否属于同一别名组或互为包含 */
export function fieldMatchesAlias(query: string, fieldName: string): boolean {
  const q = normalizeAliasToken(query);
  const f = normalizeAliasToken(fieldName);
  if (!q || !f) return false;
  if (q === f || f.includes(q) || q.includes(f)) return true;

  const qKey = getCanonicalFieldKey(query);
  const fKey = getCanonicalFieldKey(fieldName);
  if (qKey && fKey && qKey === fKey) return true;

  if (qKey) {
    const aliases = FIELD_ALIAS_GROUPS[qKey] ?? [];
    if (aliases.some((alias) => normalizeAliasToken(alias) === f || f.includes(normalizeAliasToken(alias)))) {
      return true;
    }
  }

  if (fKey) {
    const aliases = FIELD_ALIAS_GROUPS[fKey] ?? [];
    if (aliases.some((alias) => normalizeAliasToken(alias) === q || q.includes(normalizeAliasToken(alias)))) {
      return true;
    }
  }

  return false;
}
