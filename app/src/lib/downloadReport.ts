/** 将 JSON 数据下载为本地文件 */
export function downloadJsonFile(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
  triggerDownload(blob, filename.endsWith(".json") ? filename : `${filename}.json`);
}

/** 将 base64 编码的 zip 二进制下载为本地 .zip 文件（导出脚本包） */
export function downloadZipFromBase64(base64: string, filename: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: "application/zip" });
  triggerDownload(blob, filename.endsWith(".zip") ? filename : `${filename}.zip`);
}

/** 将纯文本下载为本地文件（YAML / SQL 等） */
export function downloadTextFile(content: string, filename: string, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  triggerDownload(blob, filename);
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
