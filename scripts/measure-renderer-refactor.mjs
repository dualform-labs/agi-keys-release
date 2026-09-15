// Read-only comparison: node scripts/measure-renderer-refactor.mjs [baseline-commit]
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import ts from '../packages/microplus/node_modules/typescript/lib/typescript.js';
const baselineCommit = process.argv[2] ?? '328decf';
const prefix = 'packages/microplus/src/';
const paths = ['codex-micro-renderer-bridge.ts', 'native-runtime-contract.ts', 'renderer-observation.ts'];
const original = execFileSync('git', ['show', `${baselineCommit}:${prefix}${paths[0]}`], { encoding: 'utf8' });
const parse = text => ts.createSourceFile('module.ts', text, ts.ScriptTarget.Latest, true);
const measure = (path, text) => ({ path: prefix + path, lines: text.split('\n').length - 1, bytes: Buffer.byteLength(text), topLevelStatements: parse(text).statements.length });
const classBody = text => parse(text).statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'CodexMicroRendererBridge').getText();
const candidate = paths.map(path => readFileSync(prefix + path, 'utf8'));
const baseline = measure(paths[0], original);
const modules = candidate.map((text, i) => measure(paths[i], text));
console.log(JSON.stringify({
  baselineCommit,
  baseline,
  candidate: modules,
  bridgeLineReduction: baseline.lines - modules[0].lines,
  bridgeLineReductionPercent: +(100 * (baseline.lines - modules[0].lines) / baseline.lines).toFixed(2),
  totalLineDelta: modules.reduce((sum, item) => sum + item.lines, 0) - baseline.lines,
  transportClassByteIdentical: classBody(original) === classBody(candidate[0]),
  transportClassSha256: createHash('sha256').update(classBody(original)).digest('hex'),
  limitations: ['Module size is a locality measurement, not a measured runtime or token improvement.'],
}, null, 2));
