/** 命名实体校验（规则集子集） */

/** 统一社会信用代码（18 位）简化校验 */
export function isValidCreditCode(value: string): boolean {
  const v = value.trim().toUpperCase();
  if (!/^[0-9A-HJ-NPQRTUWXY]{2}\d{6}[0-9A-HJ-NPQRTUWXY]{10}$/.test(v)) return false;
  const weights = [1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28];
  const chars = "0123456789ABCDEFGHJKLMNPQRTUWXY";
  let sum = 0;
  for (let i = 0; i < 17; i += 1) {
    const idx = chars.indexOf(v[i]);
    if (idx < 0) return false;
    sum += idx * weights[i];
  }
  const check = 31 - (sum % 31);
  const expected = check === 31 ? "0" : chars[check];
  return v[17] === expected;
}

/** 固定电话（区号-号码，7-12 位数字） */
export function isValidLandline(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 12;
}

/** MAC 地址 */
export function isValidMac(value: string): boolean {
  return /^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/.test(value.trim());
}

/** IPv4 / IPv6 简化校验 */
export function isValidIp(value: string): boolean {
  const v = value.trim();
  const v4 = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (v4.test(v)) {
    return v.split(".").every((p) => {
      const n = Number(p);
      return n >= 0 && n <= 255;
    });
  }
  return /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/.test(v);
}

/** 经度 [-180, 180] */
export function isValidLongitude(value: string): boolean {
  const n = Number(value);
  return !Number.isNaN(n) && n >= -180 && n <= 180;
}

/** 纬度 [-90, 90] */
export function isValidLatitude(value: string): boolean {
  const n = Number(value);
  return !Number.isNaN(n) && n >= -90 && n <= 90;
}

export function isEntityValidatorPass(type: string, value: unknown): boolean {
  if (value === null || value === undefined || value === "") return true;
  const str = String(value);
  switch (type) {
    case "credit_code_validate":
      return isValidCreditCode(str);
    case "landline_validate":
      return isValidLandline(str);
    case "mac_validate":
      return isValidMac(str);
    case "ip_validate":
      return isValidIp(str);
    case "longitude_validate":
      return isValidLongitude(str);
    case "latitude_validate":
      return isValidLatitude(str);
    default:
      return true;
  }
}
