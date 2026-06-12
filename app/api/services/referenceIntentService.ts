/** 检测对话中的码表/数据标准上传意图 */
export function detectReferenceUploadIntent(
  message: string
): { kind: "code_table" | "data_standard"; filePath: string } | null {
  const text = message.trim();
  const isCodeTable = /码表|code\s*table|字典映射|mapping/i.test(text);
  const isStandard = /数据标准|data\s*standard|标准规范/i.test(text);
  if (!isCodeTable && !isStandard) return null;

  // 匹配 uploads 路径或常见相对路径
  const pathMatch = text.match(
    /(?:uploads\/|[./\\])?[\w\-./\\]+\.(csv|json|yaml|yml)/i
  );
  if (!pathMatch) return null;

  const filePath = pathMatch[0].replace(/^\.[/\\]/, "");
  return {
    kind: isCodeTable ? "code_table" : "data_standard",
    filePath,
  };
}
