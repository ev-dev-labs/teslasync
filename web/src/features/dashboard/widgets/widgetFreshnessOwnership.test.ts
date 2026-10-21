import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

it('only the shared widget header imports freshness indicators in dashboard bodies', () => {
  const root = join(process.cwd(), 'src/features/dashboard');
  const imports: string[] = [];
  function visit(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.name.endsWith('.tsx') && !entry.name.includes('.test.') && entry.name !== 'WidgetShell.tsx') {
        const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
        for (const statement of source.statements) {
          if (ts.isImportDeclaration(statement) && statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings)) {
            for (const specifier of statement.importClause.namedBindings.elements) {
              if (/^FreshnessDot(?:Auto)?$/.test((specifier.propertyName ?? specifier.name).text)) imports.push(`${entry.name}: ${specifier.name.text}`);
            }
          }
        }
      }
    }
  }
  visit(root);
  expect(imports).toEqual([]);
});
