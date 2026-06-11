import { createHmac, timingSafeEqual } from "node:crypto";
import { TRPCError } from "@trpc/server";

/** 获取 webhook HMAC 密钥（优先 WEBHOOK_HMAC_SECRET，否则回退 APP_SECRET） */
export function getWebhookHmacSecret(): string {
  const dedicated = process.env.WEBHOOK_HMAC_SECRET?.trim();
  if (dedicated) return dedicated;
  return process.env.APP_SECRET?.trim() ?? "";
}

/** 对 canonical JSON 载荷计算 HMAC-SHA256 签名（hex，带 sha256= 前缀） */
export function signWebhookPayload(payload: string): string {
  const secret = getWebhookHmacSecret();
  if (!secret) return "";
  const digest = createHmac("sha256", secret).update(payload, "utf8").digest("hex");
  return `sha256=${digest}`;
}

/** 校验 X-Signature 请求头（timing-safe） */
export function verifyWebhookSignature(payload: string, signatureHeader: string | null): boolean {
  const secret = getWebhookHmacSecret();
  if (!secret) {
    // 未配置密钥时跳过签名校验（开发环境）
    return true;
  }
  if (!signatureHeader?.trim()) return false;

  const expected = signWebhookPayload(payload);
  const received = signatureHeader.trim();

  try {
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(received, "utf8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** verificationResult 入参 canonical JSON（与外部调度器签名约定一致） */
export function canonicalVerificationPayload(input: {
  runId: string;
  status: string;
  details?: string;
}): string {
  return JSON.stringify({
    runId: input.runId,
    status: input.status,
    details: input.details ?? undefined,
  });
}

/** tRPC mutation 用：校验 webhook 签名，失败抛 FORBIDDEN */
export function assertWebhookSignature(
  req: Request,
  input: { runId: string; status: string; details?: string }
): void {
  const secret = getWebhookHmacSecret();
  if (!secret) return;

  const payload = canonicalVerificationPayload(input);
  const signature = req.headers.get("x-signature");
  if (!verifyWebhookSignature(payload, signature)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "无效的 X-Signature：webhook 载荷 HMAC 校验失败",
    });
  }
}
