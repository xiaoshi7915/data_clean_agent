import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getUploadPath } from "./dataSourceService";
import {
  resolveExistingUploadPath,
  resolveUploadPath,
  toStoredUploadPath,
} from "./uploadPathService";
import { getDb } from "../queries/connection";
import { fileUploads } from "@db/schema";
import type { FileType } from "@contracts/types";

/** 与 boot.ts bodyLimit 一致的上传大小上限（50MB） */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/** 上传文件类型：数据文件 / 码表 / 数据标准 */
export type UploadKind = "data_file" | "code_table" | "data_standard";

export interface SavedUploadMeta {
  filePath: string;
  fileType: FileType | "yaml" | "yml" | "json" | "csv";
  fileName: string;
  fileSize: number;
  uploadKind: UploadKind;
}

/** 根据文件名与可选 kind 推断上传类型 */
export function detectUploadKind(fileName: string, kindHint?: string): UploadKind {
  const hint = kindHint?.toLowerCase();
  if (hint === "code_table" || hint === "码表") return "code_table";
  if (hint === "data_standard" || hint === "数据标准") return "data_standard";

  const lower = fileName.toLowerCase();
  if (/码表|codetable|code_table|dict|mapping/.test(lower)) return "code_table";
  if (/标准|standard|spec/.test(lower) && /\.(yaml|yml|json)$/.test(lower)) {
    return "data_standard";
  }
  return "data_file";
}

export async function saveUploadedFile(
  sessionId: string | undefined,
  file: File,
  options?: { uploadKind?: UploadKind }
): Promise<SavedUploadMeta> {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`文件过大，最大允许 ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB`);
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const fileName = file.name;
  const fileSize = file.size;
  const fileExt = path.extname(fileName).toLowerCase().replace(".", "");
  const absolutePath = getUploadPath(fileName);
  const filePath = toStoredUploadPath(absolutePath);

  writeFileSync(absolutePath, buffer);

  // Map extension to FileType
  const fileTypeMap: Record<string, FileType> = {
    csv: "csv",
    json: "json",
    xml: "xml",
    xlsx: "xlsx",
    xls: "xlsx",
  };
  const fileType = fileTypeMap[fileExt] || "csv";

  const uploadKind = options?.uploadKind ?? detectUploadKind(fileName);

  // Save to DB
  const db = getDb();
  await db.insert(fileUploads).values({
    sessionId: sessionId || null,
    fileName,
    fileSize,
    fileType,
    filePath,
    encoding: "utf-8",
  });

  return { filePath, fileType, fileName, fileSize, uploadKind };
}

export async function getUploadedFile(storedPath: string): Promise<Buffer> {
  return readFileSync(resolveExistingUploadPath(storedPath));
}

export async function cleanupUploadedFile(storedPath: string): Promise<void> {
  try {
    const absolutePath = resolveUploadPath(storedPath);
    if (existsSync(absolutePath)) {
      unlinkSync(absolutePath);
    }
  } catch {
    // Ignore cleanup errors
  }
}
