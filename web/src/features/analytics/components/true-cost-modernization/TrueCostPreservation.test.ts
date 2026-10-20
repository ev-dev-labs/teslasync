import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

const readSource = (path: string) => readFileSync(resolve('src/features/analytics', path), 'utf8');
const page = readSource('pages/TrueCostPage.tsx');
const slot = readSource('components/true-cost-modernization/TrueCostLayoutSlot.tsx');
const originalLedger = readSource('components/true-cost/TrueCostFixedLedger.tsx');
const ledger = readSource('components/true-cost-modernization/TrueCostFixedLedger.tsx');
const columnsSource = readSource('components/true-cost-modernization/TrueCostLedgerColumns.tsx');
const formSource = readSource('components/true-cost-modernization/TrueCostLedgerForm.tsx');

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
    expect(page).toContain('aggregateState={state}');
    expect(page).toContain('totalKm={query.data?.total_km}');
    expect(page).toContain('totalChargingCost={query.data?.total_charging_cost}');
    expect(page).not.toContain('?? 0');
  });

  it('keeps vehicle scope, raw aggregate analysis and query state separate from presentation', () => {
    expect(page).toContain('useCostBreakdown(vehicleIdString)');
    expect(page).toContain('analyzeTrueCost(query.data), [query.data]');
    expect(page).toContain('trueCostQueryState(query, vehicleId != null, retry)');
    expect(page).toContain('query={vehicleId != null ? query : undefined}');
    expect(page).toContain('<AITCONarration {...narrationProps} />');
    expect(page).toContain('const narrationProps = { vehicleId: vehicleId ?? undefined }');
    expect(nodes(page, node =>
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))
      && ['RangePicker', 'DateRangeFilter', 'VehicleSelect'].includes(node.tagName.getText()),
    )).toEqual([]);
    expect(page).not.toMatch(/\bfetch\(|\buseEffect\(/);
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
    // Query + mutation wiring retained verbatim from the original ledger.
    expect(ledger).toContain('const ledgerQuery = useTcoLedger(vehicleId);');
    expect(ledger).toContain('const addMutation = useAddTcoLedgerEntry();');
    expect(ledger).toContain('const deleteMutation = useDeleteTcoLedgerEntry();');
    expect(ledger).toContain('const CATEGORIES: TcoLedgerCategory[] = [');
    expect(ledger).toContain("'payment', 'insurance', 'maintenance', 'service',");
    expect(ledger).toContain("'tires', 'accessories', 'depreciation', 'other',");
    // Controlled form state + defaults retained; per-entry currency added deliberately.
    expect(ledger).toContain("const [category, setCategory] = useState<TcoLedgerCategory>('insurance');");
    expect(ledger).toContain("const [amount, setAmount] = useState('');");
    expect(ledger).toContain("const [currency, setCurrency] = useState('USD');");
    expect(ledger).toContain('const [incurredOn, setIncurredOn] = useState(() => new Date().toISOString().slice(0, 10));');
    expect(ledger).toContain("const [note, setNote] = useState('');");
    expect(ledger).toContain('const [pendingDelete, setPendingDelete] = useState<{ vehicleId: number; id: number } | null>(null);');
    expect(ledger).toContain('const entries = data?.entries ?? [];');
    // Ledger + aggregate availability gate every derived total; unknown stays unknown.
    expect(ledger).toContain('const ledgerState = trueCostQueryState(ledgerQuery, vehicleId != null, () => { void refetch(); });');
    expect(ledger).toContain('const totals = ledgerState.enabled && ledgerState.hasData ? data?.totals : undefined;');
    expect(ledger).toContain('const aggregateAvailable = aggregateState.enabled && aggregateState.hasData;');
    expect(ledger).toContain('&& Number.isFinite(totalChargingCost) ? totalChargingCost : null;');
    expect(ledger).toContain('&& Number.isFinite(totalKm) && totalKm >= 0 ? totalKm : null;');
    expect(ledger).toContain('? chargingCost + fixedCost : null;');
    expect(ledger).toContain('? allInCost / displayDistance : null;');
    expect(ledger).toContain('const fixedCurrency = currencies.length === 1 && knownCurrency(currencies[0]) ? currencies[0] : null;');
    // Validation keeps the original amount/date rules and adds the currency rule.
    expect(ledger).toContain('const canSubmit = !!vehicleId && Number(amount) > 0 && knownCurrency(currency)');
    expect(ledger).toContain('&& /^\\d{4}-\\d{2}-\\d{2}$/.test(incurredOn);');
    // Mutation bodies keep the original payload, delete guard and reset behavior.
    expect(ledger).toContain('if (!canSubmit || !vehicleId) return;');
    expect(ledger).toContain('amount: Number(amount),');
    expect(ledger).toContain('note: note.trim() || undefined,');
    expect(ledger).toContain('if (!pendingDelete || pendingDelete.vehicleId !== vehicleId || deleteMutation.isPending) return;');
    expect(ledger).toContain('{ vehicleId: target.vehicleId, id: target.id },');
    expect(ledger).toContain('{ onSuccess: () => setPendingDelete((current) => current === target ? null : current) },');
    expect(ledger).toContain('tableId="analytics:tco-fixed-ledger"');
    expect(ledger).toContain('mobileColumns={columns.map((column) => column.key)}');
    expect(ledger).toContain('onConfirm={handleDelete}');
    expect(ledger).toContain('onCancel={() => setPendingDelete(null)}');
  });

  it('extracts every column renderer and filter without changing the table contract', () => {
    expect(columnsSource).toContain('export function makeTrueCostLedgerColumns(');
    expect(columnsSource).toContain('formatCurrency: (amount: number, currency: string) => string,');
    expect(columnsSource).toContain('setPendingDelete: (entry: TcoLedgerEntry) => void,');
    for (const key of ['incurred_on', 'category', 'amount', 'note', 'actions']) {
      expect(columnsSource).toContain(`key: '${key}'`);
    }
    expect(columnsSource).toContain("header: t('tco.ledger.date', 'Date')");
    expect(columnsSource).toContain("header: t('tco.ledger.category', 'Category')");
    expect(columnsSource).toContain("header: t('tco.ledger.amount', 'Amount')");
    expect(columnsSource).toContain("header: t('tco.ledger.note', 'Note')");
    expect(columnsSource).toContain('filterValue: (e) => e.incurred_on');
    expect(columnsSource).toContain('filterValue: (e) => e.category');
    expect(columnsSource).toContain('filterValue: (e) => `${e.currency}:${e.amount}`');
    expect(columnsSource).toContain('filterValueLabel: (_value, e) => ledgerCategoryLabel(e.category, t)');
    expect(columnsSource).toContain('filterValueLabel: (_value, e) => formatCurrency(e.amount, e.currency)');
    expect(columnsSource).toContain('{ledgerCategoryLabel(e.category, t)}');
    expect(columnsSource).toContain('{formatCurrency(e.amount, e.currency)}');
    expect(columnsSource).toContain("{e.note || '—'}");
    expect(columnsSource).toContain("aria-label={t('tco.ledger.delete', 'Delete entry')}");
    expect(columnsSource).toContain('onClick={() => setPendingDelete(e)}');
    expect(ledger).toContain('makeTrueCostLedgerColumns(t, formatCurrency, (entry) => {');
    expect(ledger).toContain('if (vehicleId != null && entry.vehicle_id === vehicleId) {');
    expect(ledger).toContain('setPendingDelete({ vehicleId, id: entry.id })');
    expect(ledger).toContain('[t, formatCurrency, vehicleId]');
    expect(ledger).toContain("if (column.key === 'note')");
    expect(ledger).toContain("if (column.key === 'actions')");
  });

  it('only replaces the ledger body for a no-data fatal error, not a retained refresh error', () => {
    expect(ledger).toContain('const fatalError = Boolean(ledgerState.error);');
    expect(ledger).toContain('const refreshError = Boolean(ledgerState.refreshError);');
    expect(ledger).toContain('{!ledgerState.enabled ? (');
    expect(ledger).toContain(') : ledgerState.isLoading ? (');
    expect(ledger).toContain(') : ledgerState.isPaused ? (');
    expect(ledger).toContain(') : fatalError ? (');
    expect(ledger).toContain(') : !ledgerState.hasData ? (');
    expect(ledger).toContain('{refreshError && (');
    expect(ledger).toContain('{ledgerState.refreshPaused && (');
    expect(ledger).toContain('The fixed-cost ledger refresh failed; the most recently loaded entries remain visible.');
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
      .replaceAll('handleAdd', 'onAdd')
      .replaceAll('label: c', 'label: ledgerCategoryLabel(c, t)');
    expect(formSource).toContain('label: ledgerCategoryLabel(c, t)');
    expect(normalizeLayoutWhitespace(printer.printNode(ts.EmitHint.Unspecified, formNode(formSource), parse(formSource))))
      .toEqual(normalizeLayoutWhitespace(original));
    expect(ledger).toContain('categories={CATEGORIES}');
    expect(ledger).toContain('canSubmit={canSubmit}');
    expect(ledger).toContain('isPending={addMutation.isPending}');
    expect(ledger).toContain('onAdd={handleAdd}');
  });
});
