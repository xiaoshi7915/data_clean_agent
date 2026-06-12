import { existsSync } from "node:fs";
import path from "node:path";
import { env } from "../lib/env";

/** 上传目录在存储中的相对前缀（便于跨环境迁移） */
export const UPLOAD_RELATIVE_PREFIX = "uploads";

/**
 * 将绝对或历史路径规范为仅存文件名（basename）。
 * 兼容旧数据中来自开发机的绝对路径。
 */
export function normalizeStoredUploadPath(storedPath: string): string {
  if (!storedPath?.trim()) return "";
  const base = path.basename(storedPath.replace(/\\/g, "/"));
  return base;
}

/**
 * 保存到数据库时使用的相对路径：uploads/<basename>
 */
export function toStoredUploadPath(absolutePath: string): string {
  const base = normalizeStoredUploadPath(absolutePath);
  if (!base) return "";
  return `${UPLOAD_RELATIVE_PREFIX}/${base}`;
}

/**
 * 运行时将存储路径解析为当前环境的绝对路径。
 * 优先使用 UPLOAD_DIR，仅取 basename 拼接，避免容器内外路径不一致。
 */
export function resolveUploadPath(storedPath: string): string {
  const base = normalizeStoredUploadPath(storedPath);
  if (!base) {
    throw new Error("文件路径无效，请重新上传文件。");
  }
  return path.join(env.uploadDir, base);
}

/**
 * 解析并校验文件存在；缺失时给出可操作的错误提示。
 */
export function resolveExistingUploadPath(storedPath: string): string {
  const resolved = resolveUploadPath(storedPath);
  if (!existsSync(resolved)) {
    const name = path.basename(resolved);
    throw new Error(
      `上传文件不存在（${name}）。当前运行环境无法访问历史绝对路径，请在当前环境重新上传该文件后再探查。`
    );
  }
  return resolved;
}
