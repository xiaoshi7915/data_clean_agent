import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "./env";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const ENCRYPTED_PREFIX = "enc:v1:";

/** 从 APP_SECRET 派生 AES-256 密钥 */
function deriveKey(): Buffer {
  return createHash("sha256").update(env.appSecret).digest();
}

/** 判断存储值是否为加密格式 */
export function isEncryptedCredential(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(ENCRYPTED_PREFIX);
}

/** 加密数据库密码（空值原样返回） */
export function encryptCredential(plaintext: string): string {
  if (!plaintext) return plaintext;
  if (isEncryptedCredential(plaintext)) return plaintext;

  const key = deriveKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENCRYPTED_PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

/**
 * 解密数据库密码。
 * 解密失败时按明文兼容（历史数据），供上层在下次保存时重新加密。
 */
export function decryptCredential(stored: string | null | undefined): string {
  if (!stored) return "";
  if (!isEncryptedCredential(stored)) return stored;

  const payload = stored.slice(ENCRYPTED_PREFIX.length);
  const [ivB64, tagB64, dataB64] = payload.split(":");
  if (!ivB64 || !tagB64 || !dataB64) return stored;

  try {
    const key = deriveKey();
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch {
    return stored;
  }
}

/** 写入 DB 前统一加密；已是密文则跳过 */
export function encryptCredentialForStorage(password: string | null | undefined): string | null {
  if (!password) return null;
  return encryptCredential(password);
}
