import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const files = ['src/codex-micro-renderer-bridge.ts', 'src/native-runtime-contract.ts', 'src/renderer-observation.ts'];
const [bridge, contract, snapshot] = files.map(path => readFileSync(path, 'utf8'));
assert.ok(bridge.split('\n').length <= 3500, 'transport bridge must remain below 3500 lines');
const bridgeAst = ts.createSourceFile(files[0], bridge, ts.ScriptTarget.Latest, true);
const declarations = bridgeAst.statements.filter(ts.isVariableStatement).flatMap(n => [...n.declarationList.declarations]);
const observation = declarations.find(n => ts.isIdentifier(n.name) && n.name.text === 'SNAPSHOT_EXPRESSION')?.initializer;
assert.ok(observation && ts.isCallExpression(observation), 'observation is constructed by the extracted factory');
assert.ok(ts.isIdentifier(observation.expression) && observation.expression.text === 'createRendererObservationExpression');
assert.equal(observation.arguments.length, 1);
assert.equal(observation.arguments[0].getText(bridgeAst), 'INPUT_ONLY_DEVICE_STATE');
assert.ok(bridgeAst.statements.some(n => ts.isImportDeclaration(n)
  && n.moduleSpecifier.text === './renderer-observation.js'
  && n.importClause?.namedBindings && ts.isNamedImports(n.importClause.namedBindings)
  && n.importClause.namedBindings.elements.some(e => e.name.text === 'createRendererObservationExpression')));
assert.ok(!declarations.some(n => ts.isIdentifier(n.name) && n.name.text.startsWith('CURRENT_')), 'version pins belong to the contract module');
for (const [index, text] of [contract, snapshot].entries()) {
  const ast = ts.createSourceFile(files[index + 1], text, ts.ScriptTarget.Latest, true);
  for (const statement of ast.statements) {
    if (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) {
      const dependency = statement.moduleSpecifier?.text ?? '';
      assert.ok(!/codex-micro-renderer-bridge|controller|^ws$|^node:/.test(dependency), 'leaf modules must not depend on connection or controller');
      if (index === 0) assert.ok(statement.importClause?.isTypeOnly, 'runtime contract has only type imports');
    }
  }
}
console.log('renderer boundaries: PASS');
