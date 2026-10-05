import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

const page = readFileSync(new URL('../../pages/TrueCostPage.tsx', import.meta.url), 'utf8');
const slot = readFileSync(new URL('./TrueCostLayoutSlot.tsx', import.meta.url), 'utf8');
const originalLedger = readFileSync(new URL('../true-cost/TrueCostFixedLedger.tsx', import.meta.url), 'utf8');
const ledger = readFileSync(new URL('./TrueCostFixedLedger.tsx', import.meta.url), 'utf8');
const columnsSource = readFileSync(new URL('./TrueCostLedgerColumns.tsx', import.meta.url), 'utf8');
const formSource = readFileSync(new URL('./TrueCostLedgerForm.tsx', import.meta.url), 'utf8');

function parse(source: string) {
  return ts.createSourceFile('source.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

const normalizeLayoutWhitespace = (text: string) => text.replace(/\s+/g, ' ').trim();

function nodes(source: string, predicate: (node: ts.Node) => boolean) {
  const result: ts.Node[] = [];
  const walk = (node: ts.Node) => {
    if (predicate(node)) result.push(node);
    ts.forEachChild(node, walk);
  };
  walk(parse(source));
  return result;
}

const sectionNames = [
  'TrueCostEvidenceLedger', 'TrueCostSourceScopeLedger',
  'TrueCostBoundaryDisclosure', 'TrueCostSavingsEnvelope', 'TrueCostFixedLedger',
  'TrueCostCumulativeChart', 'TrueCostMonthlyCostChart', 'TrueCostMonthlyDeltaChart',
  'TrueCostEnergyCostTrend', 'TrueCostPerDistanceChart', 'TrueCostMonthlyDirectory',
  'TrueCostAssumptionsLedger', 'TrueCostTemporalCoverage', 'TrueCostBreakEven',
  'TrueCostSensitivityMatrix', 'TrueCostAccountingIdentities', 'TrueCostMethodology',
];

describe('True Cost modernization source preservation', () => {
  it('retains all 17 specialist sections once in source order, not behind a data gate', () => {
    const sections = nodes(page, node =>
      ts.isJsxSelfClosingElement(node) && sectionNames.includes(node.tagName.getText()),
    ) as ts.JsxSelfClosingElement[];
    expect(sections.map(node => node.tagName.getText())).toEqual(sectionNames);
    expect(sections.filter(node => node.attributes.properties.some(ts.isJsxSpreadAttribute))).toHaveLength(16);
    expect(page).not.toMatch(/\{\s*(?:query\.)?data\s*&&|empty=\{/);
    expect(page).toContain('totalKm={query.data?.total_km ?? 0}');
    expect(page).toContain('totalChargingCost={query.data?.total_charging_cost ?? 0}');
  });

  it('keeps vehicle scope, raw aggregate analysis and query state separate from presentation', () => {
    expect(page).toContain('useCostBreakdown(vehicleIdString)');
    expect(page).toContain('analyzeTrueCost(query.data), [query.data]');
    expect(page).toContain('trueCostQueryState(query, vehicleId != null, retry)');
    expect(page).toContain('query={vehicleId != null ? query : undefined}');
    expect(page).toContain('<AITCONarration {...narrationProps} />');
    expect(page).toContain('const narrationProps = { vehicleId: vehicleId ?? undefined }');
    expect(page).not.toMatch(/RangePicker|DateRangeFilter|VehicleSelect|fetch\(|useEffect\(/);
  });

  it('has one shared measured grid, no extra canvas cap, provider or packer', () => {
    const grids = nodes(page, node =>
      ts.isJsxSelfClosingElement(node) && node.tagName.getText() === 'CardGrid',
    );
    expect(grids).toHaveLength(1);
    expect(page).toContain('<PageLayout');
    expect(page).toContain('<Section');
    expect(slot).toContain('useCardPlacement()');
    expect(slot).toContain("cn('min-w-0', placement?.className)");
    expect(page + slot).not.toMatch(/max-w-|mx-auto|ResizeObserver|createContext|packCardRows|window\.innerWidth/);
    expect(slot).toContain('<FadeIn delay={delay} className="min-w-0">');
  });

  it('retains all ledger calculations, categories, form state, validation and mutation bodies exactly', () => {
    const beforeReturn = (source: string) => {
      const declaration = parse(source).statements.find(statement =>
        ts.isFunctionDeclaration(statement) && statement.name?.text === 'TrueCostFixedLedger',
      ) as ts.FunctionDeclaration;
      const printer = ts.createPrinter({ removeComments: true });
      return declaration.body!.statements
        .filter(statement => !ts.isReturnStatement(statement))
        .filter(statement => !/^\s*const (fatalError|refreshError|columns) =/.test(statement.getText()))
        .map(statement => printer.printNode(ts.EmitHint.Unspecified, statement, parse(source)));
    };
    expect(beforeReturn(ledger)).toEqual(beforeReturn(originalLedger));
    expect(ledger).toContain('tableId="analytics:tco-fixed-ledger"');
    expect(ledger).toContain("mobileColumns={['incurred_on', 'category', 'amount']}");
    expect(ledger).toContain('onConfirm={handleDelete}');
    expect(ledger).toContain('onCancel={() => setPendingDelete(null)}');
  });

  it('extracts every column renderer and filter without changing the table contract', () => {
    const originalFactory = nodes(originalLedger, node =>
      ts.isArrowFunction(node) && ts.isArrayLiteralExpression(node.body),
    )[0] as ts.ArrowFunction;
    const helper = parse(columnsSource).statements.find(statement =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === 'makeTrueCostLedgerColumns',
    ) as ts.FunctionDeclaration;
    const extracted = (helper.body!.statements[0] as ts.ReturnStatement).expression!;
    const printer = ts.createPrinter({ removeComments: true });
    expect(normalizeLayoutWhitespace(printer.printNode(ts.EmitHint.Unspecified, extracted, parse(columnsSource))))
      .toEqual(normalizeLayoutWhitespace(printer.printNode(ts.EmitHint.Unspecified, originalFactory.body, parse(originalLedger))));
    expect(ledger).toContain('() => makeTrueCostLedgerColumns(t, formatCurrency, setPendingDelete)');
    expect(ledger).toContain('[t, formatCurrency]');
  });

  it('only replaces the ledger body for a no-data fatal error, not a retained refresh error', () => {
    expect(ledger).toContain('const fatalError = isError && data === undefined;');
    expect(ledger).toContain('const refreshError = isError && data !== undefined;');
    expect(ledger).toContain('{isLoading && data === undefined ? (');
    expect(ledger).toContain(') : fatalError ? (');
    expect(ledger).toContain('{refreshError && (');
    expect(ledger).not.toContain(') : isError ? (');
  });

  it('extracts the full controlled form without changing any field constraints or events', () => {
    const formNode = (source: string) => nodes(source, node =>
      ts.isJsxElement(node) && node.openingElement.attributes.getText()
        .includes('grid grid-cols-2 gap-3 sm:grid-cols-5'),
    )[0];
    const printer = ts.createPrinter({ removeComments: true });
    const original = printer.printNode(ts.EmitHint.Unspecified, formNode(originalLedger), parse(originalLedger))
      .replaceAll('CATEGORIES', 'categories')
      .replaceAll('addMutation.isPending', 'isPending')
      .replaceAll('handleAdd', 'onAdd');
    expect(normalizeLayoutWhitespace(printer.printNode(ts.EmitHint.Unspecified, formNode(formSource), parse(formSource))))
      .toEqual(normalizeLayoutWhitespace(original));
    expect(ledger).toContain('categories={CATEGORIES}');
    expect(ledger).toContain('canSubmit={canSubmit}');
    expect(ledger).toContain('isPending={addMutation.isPending}');
    expect(ledger).toContain('onAdd={handleAdd}');
  });
});
