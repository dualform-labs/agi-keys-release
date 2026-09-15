import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import ts from "../packages/microplus/node_modules/typescript/lib/typescript.js";

const baselineCommit = process.argv[2] ?? "8d944f6";
const root = "packages/microplus/src/";
const files = ["controller.ts", "controller-display.ts"];

function sourceFile(path, text) {
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
}

function measure(path, text) {
  const ast = sourceFile(path, text);
  return {
    path: root + path,
    lines: text.split("\n").length - 1,
    bytes: Buffer.byteLength(text),
    topLevelStatements: ast.statements.length,
    exportedDeclarations: ast.statements.filter((statement) =>
      statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
    ).length,
  };
}

const baselineController = execFileSync("git", ["show", `${baselineCommit}:${root}controller.ts`], { encoding: "utf8" });
const candidate = files.map((file) => readFileSync(root + file, "utf8"));
const baseline = measure("controller.ts", baselineController);
const candidateMetrics = candidate.map((text, index) => measure(files[index], text));

console.log(JSON.stringify({
  method: "conventional manual extraction",
  baselineCommit,
  baseline,
  candidate: candidateMetrics,
  controllerLineReduction: baseline.lines - candidateMetrics[0].lines,
  controllerLineReductionPercent: +(100 * (baseline.lines - candidateMetrics[0].lines) / baseline.lines).toFixed(2),
  totalLineDelta: candidateMetrics.reduce((sum, item) => sum + item.lines, 0) - baseline.lines,
  controllerSha256: createHash("sha256").update(candidate[0]).digest("hex"),
  limitations: [
    "Module size and test timing are maintainability evidence, not proof of runtime speed or token savings.",
    "The baseline commit includes the Remesh refactor; this is a comparison of a conventional follow-up refactor against that state.",
  ],
}, null, 2));
