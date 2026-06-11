import { readFileSync } from "node:fs";
import { parseCleaningContract, contractToRules } from "@contracts/contractParser";
import type { CleaningRule, DatabaseDialect } from "@contracts/types";

/** 解析 CLI 参数（--key value / --flag） */
export function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = { _: "" };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        out[key] = true;
      } else {
        out[key] = next;
        i++;
      }
    } else {
      positional.push(arg);
    }
  }
  out._ = positional.join(" ");
  return out;
}

export function resolveDialect(
  args: Record<string, string | boolean>,
  contractDialect?: DatabaseDialect
): DatabaseDialect {
  const fromArgs = args.type ? String(args.type) : undefined;
  return (fromArgs ?? contractDialect ?? "mysql") as DatabaseDialect;
}

export function defaultPortForDialect(dialect: DatabaseDialect): number {
  return dialect === "postgresql" ? 5432 : 3306;
}

export function loadContractRules(contractPath: string): {
  contract: ReturnType<typeof parseCleaningContract>;
  rules: CleaningRule[];
} {
  const source = readFileSync(contractPath, "utf8");
  const contract = parseCleaningContract(source, "auto");
  const rules = contractToRules(contract).map((rule) =>
    rule.status === "confirmed" ? rule : { ...rule, status: "confirmed" as const }
  );
  return { contract, rules };
}
