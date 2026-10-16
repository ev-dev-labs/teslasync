/** Restore real provider context in locale tests masked by the global echo mock. */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

export function migrateProviderI18nTests(source, filename = 'provider.test.tsx') {
  const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const imports = tree.statements.filter(ts.isImportDeclaration);
  const named = declaration => declaration?.importClause?.namedBindings;
  const providerImport = imports.find(node => node.moduleSpecifier.text === 'react-i18next' &&
    named(node) && ts.isNamedImports(named(node)) && named(node).elements.some(element =>
      (element.propertyName ?? element.name).text === 'I18nextProvider'));
  const vitestImport = imports.find(node => node.moduleSpecifier.text === 'vitest' &&
    named(node) && ts.isNamedImports(named(node)));
  if (!providerImport || !vitestImport) return { output: source, changed: false };
  const provider = named(providerImport).elements.find(element =>
    (element.propertyName ?? element.name).text === 'I18nextProvider').name.text;
  let rendersProvider = false;
  let ownsTranslationMock = false;
  function inspect(node) {
    if (ts.isJsxOpeningElement(node) && node.tagName.getText(tree) === provider) rendersProvider = true;
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
      node.expression.expression.getText(tree) === 'vi' &&
      ['mock', 'unmock', 'doMock', 'doUnmock'].includes(node.expression.name.text) &&
      node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === 'react-i18next') {
      ownsTranslationMock = true;
    }
    ts.forEachChild(node, inspect);
  }
  inspect(tree);
  const bindings = named(vitestImport);
  if (!rendersProvider || ownsTranslationMock || bindings.elements.some(element => element.propertyName?.text === 'vi')) {
    return { output: source, changed: false };
  }
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const at = imports.at(-1).end;
  let output = source.slice(0, at) + `${newline}${newline}// Locale-provider regressions require the real context-aware hook.${newline}vi.unmock('react-i18next');` + source.slice(at);
  if (!bindings.elements.some(element => element.name.text === 'vi')) {
    const position = bindings.getStart(tree) + 1;
    output = output.slice(0, position) + ' vi,' + output.slice(position);
  }
  return { output, changed: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const files = args.filter(arg => arg !== '--write');
  let changed = 0;
  for (const file of files) {
    const result = migrateProviderI18nTests(fs.readFileSync(file, 'utf8'), file);
    if (!result.changed) continue;
    changed++;
    console.log(`${args.includes('--write') ? 'Migrated' : 'Would migrate'} ${file}`);
    if (args.includes('--write')) fs.writeFileSync(file, result.output);
  }
  console.log(`${changed} provider fixtures; ${args.includes('--write') ? 'write' : 'dry-run'}`);
}
