import { env } from "../api/lib/env";

/** SCRIPT_ONLY 模式下禁止真实写库时的 CLI 提示文案 */
export const SCRIPT_ONLY_EXECUTE_MESSAGE =
  "SCRIPT_ONLY 模式：禁止真实执行。请使用 --dry-run（默认）或设置 ALLOW_EXECUTE=true 后加 --force-execute";

/** 判断是否应拦截非 dry-run 的真实执行 */
export function isScriptOnlyExecuteBlocked(dryRun: boolean): boolean {
  return !dryRun && env.scriptOnly && !env.allowExecute;
}
