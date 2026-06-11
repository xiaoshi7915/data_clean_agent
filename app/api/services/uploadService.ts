import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getUploadPath } from "./dataSourceService";
import { getDb } from "../queries/connection";
import { fileUploads } from "@db/schema";
import type { FileType } from "@contracts/types";

/** 与 boot.ts bodyLimit 一致的上传大小上限（50MB） */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export async function saveUploadedFile(
  sessionId: string | undefined,
  file: File
): Promise<{ filePath: string; fileType: FileType; fileName: string; fileSize: number }> {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`文件过大，最大允许 ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB`);
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const fileName = file.name;
  const fileSize = file.size;
  const fileExt = path.extname(fileName).toLowerCase().replace(".", "");
  const filePath = getUploadPath(fileName);

  writeFileSync(filePath, buffer);

  // Map extension to FileType
  const fileTypeMap: Record<string, FileType> = {
    csv: "csv",
    json: "json",
    xml: "xml",
    xlsx: "xlsx",
    xls: "xlsx",
  };
  const fileType = fileTypeMap[fileExt] || "csv";

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

  return { filePath, fileType, fileName, fileSize };
}

export async function getUploadedFile(filePath: string): Promise<Buffer> {
  return readFileSync(filePath);
}

export async function cleanupUploadedFile(filePath: string): Promise<void> {
  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  } catch {
    // Ignore cleanup errors
  }
}
