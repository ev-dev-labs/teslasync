import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import repair from './__fixtures__/native-source-repair-preservation.json';
import appDesign from './__fixtures__/app-design-preservation.json';
import runtimeV9 from './__fixtures__/runtime-v9-preservation.json';
import previewOverlay from './__fixtures__/preview-overlay-invoker-preservation.json';
import catalog from './en.json';
import { producerProjection } from './producer-projection';
import {
  actualRepairSource as source, nativeRepairPredecessor, restoreNativeSourceRepair,
} from './verified-native-source-repair-contract';
import { restoreAppDesignSource } from './verified-widget-implementation-contract';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const tooltip = 'web/src/components/ui/Tooltip.tsx';
const barrel = 'web/src/components/ui/index.ts';
const shell = 'web/src/features/dashboard/widgets/WidgetShell.tsx';
const fleet = 'web/src/features/vehicles/pages/VehicleListPage.tsx';
const status = 'web/src/features/vehicles/components/FleetSourceStatus.tsx';
const inbox = 'web/src/features/notifications/components/InboxBody.tsx';
const tree = (file: string, text: string) =>
  ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function nodes(text: string): ts.Node[] {
  const found: ts.Node[] = [];
  function visit(node: ts.Node) {
    found.push(node);
    ts.forEachChild(node, visit);
  }
  visit(tree('source.tsx', text));
  return found;
}
const initializer = (text: string, name: string) => {
  const found = nodes(text).filter(ts.isVariableDeclaration)
    .filter(node => node.name.getText() === name);
  expect(found, name + ': unique initializer').toHaveLength(1);
  return found[0].initializer!;
};
const calls = (file: string, text: string) => producerProjection(file, text).calls.map(call => call.call);

describe('exact e1fb native source repair successor (not native certification)', () => {
  it.each(repair.sources)('pins actual source and restores the complete predecessor: $file', patch => {
    const current = source(patch.file);
    const previous = restoreNativeSourceRepair(patch.file, current);
    expect(hash(current)).toBe(patch.after);
    expect(hash(previous)).toBe(patch.before);
    expect(nativeRepairPredecessor(patch.file)).toBe(previous);
    if (![fleet, inbox, status].includes(patch.file)) {
      expect(producerProjection(patch.file, current)).toEqual(producerProjection(patch.file, previous));
    }
    // Historical approvals are not an alternate accepted shipping endpoint.
    for (const changed of [previous, current + '\n', current.slice(1)]) {
      expect(() => restoreNativeSourceRepair(patch.file, changed)).toThrow();
    }
    for (const hunk of patch.hunks) {
      expect(current.slice(hunk.start, hunk.start + hunk.new.length)).toBe(hunk.new);
      const changed = current.slice(0, hunk.start) + hunk.old + current.slice(hunk.start + hunk.new.length);
      expect(() => restoreNativeSourceRepair(patch.file, changed)).toThrow();
    }
    expect(source(patch.file)).toBe(current);
  });

  it('links all emitted predecessors to verified V33/V35 receipts, never fabricating an index map', () => {
    expect(repair.sources).toHaveLength(33);
    expect(new Set(repair.sources.map(patch => patch.file)).size).toBe(33);
    expect(repair.predecessorCommit).toBe('e1fb8a5d04713a92a7fae541432faede536a8e35');
    const emitted = repair.sources.filter(patch => patch.proof.map);
    expect(emitted).toHaveLength(31);
    for (const patch of emitted) {
      expect(patch.proof.sha256).toBe(patch.before);
      expect(patch.proof.mapSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(patch.proof.map).toContain(
        [fleet, inbox].includes(patch.file) ? 'candidate-dist-v35/assets/' : 'candidate-dist-v33/assets/');
    }
    const index = repair.sources.find(patch => patch.file === barrel)!;
    expect(index.proof.map).toBeUndefined();
    expect(index.proof.commit).toBe(repair.predecessorCommit);
    expect(previewOverlay.dependencies.find(entry => entry.file === barrel)?.sha256).toBe(index.before);
    for (const patch of repair.sources) {
      const endpoint = appDesign.sources.find(entry => entry.file === patch.file);
      if (endpoint) expect(patch.before).toBe(endpoint.after);
    }
    expect(repair.sources.find(patch => patch.file === tooltip)?.before)
      .toBe(runtimeV9.sources.find(patch => patch.file === tooltip)?.after);
  });

  it.each(repair.dependencies)('rejects changed or missing actual new dependency: $file', dependency => {
    for (const owner of [barrel, shell, fleet]) {
      const actual = source(owner);
      expect(() => restoreNativeSourceRepair(owner, actual, file =>
        source(file) + (file === dependency.file ? '\n// dependency mutation\n' : ''))).toThrow();
      expect(() => restoreNativeSourceRepair(owner, actual, file => {
        if (file === dependency.file) throw new Error('missing actual dependency');
        return source(file);
      })).toThrow();
    }
  });

  it.each(repair.dependencies)('rejects a stale dependency approval fingerprint: $file', dependency => {
    const saved = dependency.sha256;
    try {
      dependency.sha256 = '0'.repeat(64);
      expect(() => nativeRepairPredecessor(barrel)).toThrow('pinned exact native source repair');
    } finally {
      dependency.sha256 = saved;
    }
    expect(hash(nativeRepairPredecessor(barrel))).toBe(repair.sources.find(patch => patch.file === barrel)!.before);
  });

  it.each(repair.sources)('rejects every actual producer key/default/arity/options mutation: $file', patch => {
    const current = source(patch.file);
    const producers = nodes(current).filter(ts.isCallExpression).filter(node =>
      ts.isIdentifier(node.expression) && node.expression.text === 't'
      || ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 't');
    expect(producers).toHaveLength(patch.currentCallCount);
    for (const call of producers) {
      const operands = call.arguments.map(argument => argument.getText());
      const edits = [
        [operands[0] + " + '.changed'", ...operands.slice(1)],
        [operands[0], "'Changed fallback'", ...operands.slice(2)],
        operands.slice(0, 1),
        [...operands, '{ changedOption: true }'],
      ];
      for (const args of edits) {
        const changed = current.slice(0, call.getStart()) + call.expression.getText()
          + '(' + args.join(', ') + ')' + current.slice(call.getEnd());
        expect(() => restoreNativeSourceRepair(patch.file, changed)).toThrow();
      }
    }
    if (current.includes('useTranslation()')) {
      expect(() => restoreNativeSourceRepair(patch.file,
        current.replace('useTranslation()', "useTranslation('unapproved-native-namespace')"))).toThrow();
    }
  });

  it.each(repair.sources)('rejects fixture endpoint/hunk/projection/predecessor-proof mutation: $file', patch => {
    const actual = source(patch.file);
    function mutate(object: object, key: string, value: unknown) {
      const record = object as Record<string, unknown>;
      const saved = record[key];
      try {
        record[key] = value;
        expect(() => restoreNativeSourceRepair(patch.file, actual)).toThrow('pinned exact native source repair');
      } finally {
        record[key] = saved;
      }
    }
    for (const field of ['before', 'after', 'originalProjectionSha256', 'currentProjectionSha256']) {
      mutate(patch, field, '0'.repeat(64));
    }
    mutate(patch.hunks[0], 'start', patch.hunks[0].start + 1);
    mutate(patch.hunks[0], 'old', patch.hunks[0].old + '\n');
    mutate(patch.hunks[0], 'new', patch.hunks[0].new + '\n');
    mutate(patch.proof, patch.proof.map ? 'mapSha256' : 'kind', 'stale predecessor proof');
    expect(hash(restoreNativeSourceRepair(patch.file, actual))).toBe(patch.before);
  });

  it('is exact-path-only, preserves unrelated bytes, and never applies twice', () => {
    const text = "\uFEFF\r\n t('original.key', 'Default', { count: 0 })\u0000\r\n";
    for (const file of [tooltip + '/child', tooltip.toLowerCase(), tooltip.replace('.tsx', 'Other.tsx')]) {
      expect(restoreNativeSourceRepair(file, text)).toBe(text);
    }
    expect(() => restoreNativeSourceRepair(tooltip, nativeRepairPredecessor(tooltip))).toThrow();
    expect(() => restoreAppDesignSource(tooltip, source(tooltip) + '\n')).toThrow();
  });

  it('adds exactly the context export while retaining every prior public barrel export', () => {
    const exports = (text: string) => nodes(text).filter(ts.isExportSpecifier).map(node => node.getText());
    const previous = exports(nativeRepairPredecessor(barrel));
    const current = exports(source(barrel));
    expect(current.filter(entry => entry !== 'TooltipPortalContext')).toEqual(previous);
    expect(current.filter(entry => entry === 'TooltipPortalContext')).toHaveLength(1);
    expect(source(barrel).replace('TooltipPortalContext, ', '')).toBe(nativeRepairPredecessor(barrel));
    expect(source(shell)).toContain("import { HelpTooltip, PinButton, TooltipPortalContext } from '@/components/ui';");
    expect(source(shell)).not.toContain("from '@/components/ui/Tooltip'");
  });

  it('retains actual Tooltip public API, defaults, context, position, child/aria and Escape semantics', () => {
    const current = source(tooltip), previous = nativeRepairPredecessor(tooltip);
    const api = (text: string) => nodes(text).filter(ts.isInterfaceDeclaration)
      .find(node => node.name.text === 'TooltipProps')!.getText();
    const parameters = (text: string) => nodes(text).filter(ts.isFunctionDeclaration)
      .find(node => node.name?.text === 'Tooltip')!.parameters.map(node => node.getText());
    expect(api(current)).toBe(api(previous));
    expect(parameters(current)).toEqual(parameters(previous));
    for (const name of ['TooltipPortalContext', 'portal', 'inheritedPortal', 'updatePosition', 'enrichedChild']) {
      expect(initializer(current, name).getText()).toBe(initializer(previous, name).getText());
    }
    const escape = (text: string) => nodes(text).filter(ts.isCallExpression)
      .find(node => node.expression.getText() === 'useEffect' && node.getText().includes("event.key === 'Escape'"))!.getText();
    expect(escape(current)).toBe(escape(previous));
    const oldFocus = nodes(previous).filter(ts.isJsxAttribute).find(node => node.name.getText() === 'onFocus')!;
    const focusExpression = (oldFocus.initializer as ts.JsxExpression).expression as ts.ArrowFunction;
    const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
    const printBody = (arrow: ts.ArrowFunction) =>
      printer.printNode(ts.EmitHint.Unspecified, arrow.body, arrow.getSourceFile());
    expect(printBody(initializer(current, 'reveal') as ts.ArrowFunction)).toBe(printBody(focusExpression));
    expect(current).toContain('onFocus={reveal}');
    expect(current).toContain('hoveredRef.current = true;\n        reveal();');
    expect(current).toContain('import.meta.env.DEV && <TooltipTextSentry content={content} tooltipId={tooltipId} />');
    expect(current).toContain('<AppDesignPortal anchorRef={triggerRef}>{bubble}</AppDesignPortal>');
    expect(current).toContain('if (portal) setActive(hoveredRef.current || event.currentTarget.contains(event.relatedTarget));');
  });

  it('wraps only the exact original WidgetShell header, retaining body/focus/retry/children bytes', () => {
    const current = source(shell), previous = nativeRepairPredecessor(shell);
    const providers = nodes(current).filter(ts.isJsxElement)
      .filter(node => node.openingElement.tagName.getText() === 'TooltipPortalContext.Provider');
    expect(providers).toHaveLength(1);
    const provider = providers[0];
    expect(provider.openingElement.getText()).toBe('<TooltipPortalContext.Provider value>');
    const children = provider.children.filter(ts.isJsxElement);
    expect(children).toHaveLength(1);
    expect(children[0].openingElement.getText()).toContain('data-role="widget-shell-header"');
    expect(previous).toContain(children[0].getText());
    const body = current.slice(provider.getEnd());
    expect(body).toBe(previous.slice(previous.indexOf('\n      <div\n        data-testid="widget-body"')));
    expect(body).toContain('<WidgetTitleContext.Provider value={title}>{children}</WidgetTitleContext.Provider>');
  });

  it('explicitly conserves the Inbox calls with only the reviewed mounted-action gate successor', () => {
    const current = producerProjection(inbox, source(inbox));
    const previous = producerProjection(inbox, nativeRepairPredecessor(inbox));
    expect(current.bindings).toEqual(previous.bindings);
    expect(calls(inbox, source(inbox))).toEqual(calls(inbox, nativeRepairPredecessor(inbox)));
    const normalizeGate = (controls: string[]) => controls.map(control =>
      control === 'binary:&&:!archived && !isGrouped && unreadCount > 0'
        ? 'binary:&&:!archived && !isGrouped' : control);
    expect(previous.calls.map(call => ({ ...call, controls: normalizeGate(call.controls) }))).toEqual(current.calls);
    expect(previous.calls.filter(call => call.controls.includes('binary:&&:!archived && !isGrouped && unreadCount > 0')))
      .toHaveLength(2);
    expect(source(inbox)).toContain('disabled={bulkMarkReadMut.isPending || unreadCount === 0 || initialLoading}');
  });

  it('keeps real Fleet translation lineage, label aliases, data gates and all eleven resolved private calls', () => {
    const actual = source(status), page = source(fleet), previous = nativeRepairPredecessor(fleet);
    const original = calls(fleet, previous), retained = calls(fleet, page);
    const removed = [...original];
    for (const call of retained) {
      const occurrence = removed.indexOf(call);
      expect(occurrence, 'actual Fleet call remains an original producer: ' + call).toBeGreaterThanOrEqual(0);
      removed.splice(occurrence, 1);
    }
    expect(removed.sort()).toEqual([
      "t('pin.pinned', 'Pinned')", "t('pin.pinned', 'Pinned')",
      "t('common.unavailable', 'Unavailable')", "t('common.loading', 'Loading...')", "t('common.retry', 'Retry')",
    ].sort());
    const privateCalls = calls(status, actual);
    expect(privateCalls).toHaveLength(11);
    for (const call of removed.filter(call => !call.includes("'pin.pinned'"))) expect(privateCalls).toContain(call);
    // Two old title/aria translator occurrences become references to the SAME
    // real translated label, not fictitious duplicate producer invocations.
    expect(page).toContain("label={t('pin.pinned', 'Pinned')}");
    expect(actual).toContain('aria-label={label}');
    expect(actual).toContain("title={retainedWarning ? t('dataState.staleNamed.title', '{{label}} may be out of date', { label }) : label}");
    expect(actual).toContain('const { t } = useTranslation();');
    expect(actual).toContain("const retainedWarning = state.hasData && state.status !== 'ok';");
    expect(actual).toContain('const fetching = isFetching && !state.isRefreshBlocked;');
    expect(actual).toContain('const fatal = state.fatalError != null;');
    expect(actual).toContain('onClick={state.retry}');
    expect(page).toContain('reading={pinsState.hasData ? fmtNumber(vehiclePins.length, 0) : undefined}');
    const existingWarning = calls('warning.tsx', source('web/src/components/feedback/StaleRefreshWarning.tsx'));
    for (const call of nodes(actual).filter(ts.isCallExpression)
      .filter(node => ts.isIdentifier(node.expression) && node.expression.text === 't')) {
      const [key, fallback] = call.arguments;
      expect(ts.isStringLiteral(key) && ts.isStringLiteral(fallback)).toBe(true);
      const path = (key as ts.StringLiteral).text;
      const resolved = path.split('.').reduce<unknown>((value, segment) =>
        value && typeof value === 'object' ? (value as Record<string, unknown>)[segment] : undefined, catalog);
      expect(typeof resolved, path + ': real resolved catalog key').toBe('string');
      // The warning already uses uppercase Updating… over the lowercase
      // canonical resource. Preserve that existing fallback, do not edit copy.
      if (path === 'freshness.updating') {
        expect(existingWarning).toContain("t('freshness.updating', 'Updating…')");
        expect((fallback as ts.StringLiteral).text).toBe('Updating…');
        expect(resolved).toBe('updating…');
      } else expect((fallback as ts.StringLiteral).text).toBe(resolved);
    }
  });
});
