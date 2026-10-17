import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, '../../../../..');
const require = createRequire(resolve(web, 'package.json'));
const ts = require('typescript');
const page = readFileSync(resolve(web, 'src/features/analytics/pages/TimelinePage.tsx'), 'utf8');
const hooks = readFileSync(resolve(web, 'src/api/hooks/useTimelinePage.ts'), 'utf8');
const originalPath = process.env.TIMELINE_ORIGINAL_SOURCE;
const original = originalPath ? readFileSync(originalPath, 'utf8') : null;
const printer = ts.createPrinter({ removeComments: true });
const parse = text => ts.createSourceFile('TimelinePage.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const ast = parse(page);
const declarations = tree => {
  const found = new Map();
  const visit = node => {
    if ((ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node)) && node.name) {
      found.set(node.name.getText(tree), node);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return found;
};
const current = declarations(ast);
const print = (node, tree) => printer.printNode(ts.EmitHint.Unspecified, node, tree);
// Only the coordinated nullable-source display delta is normalized for the
// non-null baseline comparison. Raw filters/rows and all business math remain exact.
const normalizeKnownFromState = text => text
  .replaceAll("row.from_state == null ? 'neutral' : ", '')
  .replaceAll("row.from_state ?? '—'", 'row.from_state')
  .replaceAll("previewTransition.from_state ?? '—'", 'previewTransition.from_state');

test('canonical composition preserves original widths and cutoff without hiding tiny-state evidence', () => {
  let segmentsExpression;
  const visit = node => {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === 'CompositionRail') {
      const attribute = node.attributes.properties.find(prop =>
        ts.isJsxAttribute(prop) && prop.name.getText(ast) === 'segments');
      segmentsExpression = attribute.initializer.expression;
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(segmentsExpression, 'the real canonical rail is mounted');
  const formatter = current.get('formatDurationFromSeconds').getText(ast);
  const hours = current.get('formatHoursFromSeconds').getText(ast);
  const js = ts.transpileModule(`${hours}\n${formatter}\nconst segments = ${segmentsExpression.getText(ast)};`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = vm.createContext({
    summaryRows: [
      { state: 'driving', total_seconds: 9980, percentage: 99.1 },
      { state: 'offline', total_seconds: 20, percentage: 0.9 },
    ],
    totalSeconds: 10000,
    STATE_COLORS: { driving: '#10b981', offline: '#64748b' },
    fmtPercent: value => `${value}%`,
  });
  vm.runInContext(js, context);
  const segments = JSON.parse(vm.runInContext('JSON.stringify(segments)', context));
  assert.deepEqual(segments.map(segment => segment.widthPercent), [99.8, 0.2]);
  assert.deepEqual(segments.map(segment => segment.hideFromTrack), [false, true]);
  assert.deepEqual(segments.map(segment => segment.label), ['driving', 'offline']);
  assert.equal(segments[1].detail, '20s (0.9%)');
  assert.equal(segments[0].color, '#10b981');
});

test('malformed dwell widths cannot throw from the rail or become measured zero durations', () => {
  let condition;
  const visit = node => {
    if (ts.isConditionalExpression(node) && node.condition.getText(ast).startsWith('summaryRows.some')) {
      condition = node.condition.getText(ast);
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(condition, 'invalid geometry gets an evidence-preserving fallback before the rail');
  const context = vm.createContext({ summaryRows: [], totalSeconds: 100 });
  for (const seconds of [-1, 101, NaN, Infinity]) {
    context.summaryRows = [{ state: 'unknown', total_seconds: seconds }];
    assert.equal(vm.runInContext(condition, context), true);
  }
  context.summaryRows = [{ state: 'driving', total_seconds: 99.9 }, { state: 'offline', total_seconds: 0.1 }];
  assert.equal(vm.runInContext(condition, context), false);
  assert.match(page, /timeline\.invalidComposition/);
  assert.match(page, /Number\.isFinite\(row\.total_seconds\) && row\.total_seconds >= 0/);
});

test('all original business transforms and rounding functions remain AST-equivalent', { skip: !original }, () => {
  const baseline = parse(original);
  const before = declarations(baseline);
  for (const name of [
    'STATE_COLORS', 'STATE_BADGE',
    'formatHoursFromSeconds', 'formatDurationFromSeconds', 'transitionDuration',
    'transitions', 'dailyBreakdown', 'summaryByState', 'timeByState',
    'totalTransitions', 'drivingSec', 'chargingSec', 'idleSec', 'sleepingSec',
    'totalSeconds', 'previewDay', 'activeId', 'enabled',
  ]) {
    assert.ok(current.has(name), name);
    assert.equal(print(current.get(name), ast), print(before.get(name), baseline), name);
  }
});

test('specialist duration rollover and invalid successor behavior are preserved', () => {
  const functions = ['formatHoursFromSeconds', 'formatDurationFromSeconds', 'transitionDuration']
    .map(name => current.get(name).getText(ast)).join('\n');
  const js = ts.transpileModule(functions, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = vm.createContext({});
  vm.runInContext(js, context);
  assert.equal(vm.runInContext('formatHoursFromSeconds(3599)', context), '1h');
  assert.equal(vm.runInContext('formatHoursFromSeconds(7199)', context), '2h');
  assert.equal(vm.runInContext('formatDurationFromSeconds(59.6)', context), '1m');
  assert.equal(vm.runInContext('formatDurationFromSeconds(59.4)', context), '59s');
  assert.equal(vm.runInContext('formatHoursFromSeconds(0)', context), '0m');
  assert.equal(vm.runInContext('transitionDuration({ts:"invalid",next_ts:null})', context), '—');
  assert.equal(vm.runInContext('transitionDuration({ts:"2026-01-01T01:00:00Z",next_ts:"2026-01-01T00:00:00Z"})', context), '—');
  assert.equal(vm.runInContext('transitionDuration({ts:"2026-01-01T00:00:00Z",next_ts:"2026-01-01T01:00:00Z"})', context), '1h');
  vm.runInContext('Date.now = () => new Date("2026-01-01T02:00:00Z").getTime()', context);
  assert.equal(vm.runInContext('transitionDuration({ts:"2026-01-01T00:00:00Z",next_ts:null})', context), '2h');
});

test('record chronology, successor durations and UTC destination buckets are unchanged', () => {
  const rows = [
    { ts: '2026-01-02T00:30:00Z', from_state: 'online', to_state: 'driving', trigger_field: null, trigger_value: null },
    { ts: '2026-01-01T23:30:00Z', from_state: 'sleeping', to_state: 'online', trigger_field: 'wake', trigger_value: 'true' },
    { ts: '2026-01-01T20:00:00-05:00', from_state: 'driving', to_state: 'offline', trigger_field: null, trigger_value: null },
    { ts: '2026-01-02T02:00:00Z', from_state: 'offline', to_state: 'charging', trigger_field: null, trigger_value: null },
  ];
  const code = ['transitions', 'dailyBreakdown'].map(name => `const ${current.get(name).getText(ast)};`).join('\n');
  const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = vm.createContext({ transitionsRaw: rows, useMemo: callback => callback() });
  vm.runInContext(js, context);
  const results = JSON.parse(vm.runInContext('JSON.stringify({transitions,dailyBreakdown})', context));
  assert.deepEqual(results.transitions.map(row => row.index), [0, 1, 2, 3]);
  assert.deepEqual(results.transitions.map(row => row.to_state), ['online', 'driving', 'offline', 'charging']);
  assert.equal(results.transitions[0].next_ts, rows[0].ts);
  assert.equal(results.transitions[3].next_ts, null);
  assert.equal(results.transitions[0].trigger_value, 'true');
  assert.deepEqual(results.dailyBreakdown, [
    { day: '2026-01-01', driving: 0, charging: 0, idle: 1, sleeping: 0 },
    { day: '2026-01-02', driving: 1, charging: 1, idle: 0, sleeping: 1 },
  ]);
});

test('SI dwell math, raw source percentages and positive-time ordering remain unchanged', () => {
  const rows = [
    { state: 'driving', total_seconds: 3599, percentage: 31.4, transition_count: 2 },
    { state: 'charging', total_seconds: 7199, percentage: 61.1, transition_count: 3 },
    { state: 'online', total_seconds: 120, percentage: 1, transition_count: 4 },
    { state: 'parked', total_seconds: 60, percentage: 0.5, transition_count: 5 },
    { state: 'idle', total_seconds: 30, percentage: 0.25, transition_count: 6 },
    { state: 'asleep', total_seconds: 300, percentage: 2.5, transition_count: 7 },
    { state: 'sleeping', total_seconds: 240, percentage: 2, transition_count: 8 },
    { state: 'offline', total_seconds: 10, percentage: 0.08, transition_count: 9 },
    { state: 'unknown-source-state', total_seconds: 0, percentage: 0, transition_count: 1 },
  ];
  const names = ['STATE_COLORS', 'summaryByState', 'timeByState', 'totalTransitions', 'drivingSec', 'chargingSec', 'idleSec', 'sleepingSec'];
  const code = names.map(name => `const ${current.get(name).getText(ast)};`).join('\n');
  const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = vm.createContext({ summaryRows: rows, useMemo: callback => callback() });
  vm.runInContext(js, context);
  const results = JSON.parse(vm.runInContext('JSON.stringify({timeByState,totalTransitions,drivingSec,chargingSec,idleSec,sleepingSec})', context));
  assert.equal(results.totalTransitions, 45);
  assert.equal(results.drivingSec, 3599);
  assert.equal(results.chargingSec, 7199);
  assert.equal(results.idleSec, 210);
  assert.equal(results.sleepingSec, 550);
  assert.equal(results.timeByState[0].state, 'charging');
  assert.equal(results.timeByState[0].percentage, 61.1);
  assert.equal(results.timeByState.length, 8);
  assert.deepEqual(rows.map(row => row.total_seconds), [3599, 7199, 120, 60, 30, 300, 240, 10, 0]);
});

test('all six columns retain baseline contracts outside documented presentation guards', { skip: !original }, () => {
  const baseline = parse(original);
  const before = declarations(baseline);
  // Fresh acquisitions can already contain the coordinated nullable guard.
  // Exact identity is stronger than normalizing that guard for an older source.
  if (print(current.get('columns'), ast) === print(before.get('columns'), baseline)) {
    assert.equal(print(current.get('columns'), ast), print(before.get('columns'), baseline));
    return;
  }
  // Minimum touch target and nullable display guards are the only deltas.
  const normalize = value => normalizeKnownFromState(value)
    .replace(/\s+className="min-h-11"/g, '')
    // JSX indentation changes when its expression moves into a block return.
    .replace(/\n[ \t]+(?=\{row\.from_state\}|<\/Badge>)/g, '\n');
  // For known states, inline only the local binding and final return of the
  // explicitly guarded renderer. Null behavior is executed separately below.
  const transformed = ts.transform(current.get('columns'), [context => {
    const visit = node => {
      if (ts.isArrowFunction(node) && ts.isBlock(node.body)
        && node.body.statements[0]?.getText(ast) === 'const fromState = row.from_state;') {
        assert.equal(node.body.statements.length, 3);
        assert.ok(ts.isIfStatement(node.body.statements[1]));
        assert.equal(node.body.statements[1].expression.getText(ast), 'fromState == null');
        const knownReturn = node.body.statements[2];
        assert.ok(ts.isReturnStatement(knownReturn));
        const substitute = child => ts.isIdentifier(child) && child.text === 'fromState'
          ? ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier('row'), 'from_state')
          : ts.visitEachChild(child, substitute, context);
        return ts.factory.updateArrowFunction(node, node.modifiers, node.typeParameters,
          node.parameters, node.type, node.equalsGreaterThanToken,
          ts.visitNode(knownReturn.expression, substitute));
      }
      return ts.visitEachChild(node, visit, context);
    };
    return node => ts.visitNode(node, visit);
  }]);
  assert.equal(normalize(print(transformed.transformed[0], ast)), normalize(print(before.get('columns'), baseline)));
  transformed.dispose();
});

test('nullable from-state is display-only unknown, not a replacement raw state', () => {
  const code = `const ${current.get('STATE_BADGE').getText(ast)};\nconst ${current.get('columns').getText(ast)};`;
  const js = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
  let inspected;
  const context = vm.createContext({
    React: { createElement: (type, props, ...children) => ({ type, props, children }) },
    Badge: 'Badge', Button: 'Button', Text: 'Text', Caption: 'Caption',
    useMemo: callback => callback(),
    t: (_key, fallback, values) => fallback.replace(/\{\{(\w+)\}\}/g, (_match, key) => values?.[key] ?? ''),
    setPreviewTransition: row => { inspected = row; },
  });
  vm.runInContext(js, context);
  vm.runInContext('Object.defineProperty(STATE_BADGE, "null", { get() { throw new Error("Null badge lookup"); } })', context);
  const row = { from_state: null, to_state: 'online' };
  context.row = row;
  const badge = vm.runInContext('columns.find(c => c.key === "from_state").render(row)', context);
  assert.equal(badge.props.variant, 'neutral');
  assert.deepEqual(badge.children, ['—']);
  assert.equal(vm.runInContext('columns.find(c => c.key === "from_state").filterValue(row)', context), null);
  const action = vm.runInContext('columns.find(c => c.key === "actions").render(row)', context);
  assert.equal(action.props['aria-label'], 'Inspect transition — to online');
  action.props.onClick();
  assert.equal(inspected, row);
  assert.equal(row.from_state, null);
  context.row = { from_state: 'driving', to_state: 'charging' };
  const known = vm.runInContext('columns.find(c => c.key === "from_state").render(row)', context);
  assert.equal(known.props.variant, 'success');
  assert.deepEqual(known.children, ['driving']);
});

test('chart source columns and all four series are preserved exactly', { skip: !original }, () => {
  const extract = text => {
    const tree = parse(text);
    const columns = [];
    const bars = [];
    const visit = node => {
      if (ts.isJsxAttribute(node) && node.name.getText(tree) === 'dataColumns') columns.push(print(node, tree));
      if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(tree) === 'Bar') bars.push(print(node, tree));
      ts.forEachChild(node, visit);
    };
    visit(tree);
    return { columns, bars };
  };
  assert.deepEqual(extract(page), extract(original));
});

test('exact supplied query contracts are consumed without private observers', () => {
  for (const name of ['useTimelinePageTimeline', 'useTimelinePageSummary']) {
    assert.ok(page.includes(`${name}(activeId, startInstant, endInstantExclusive)`));
  }
  assert.ok(!page.includes('useQuery('));
  assert.ok(!page.includes('request<'));
  for (const root of ['vehicle-timeline', 'vehicle-summary']) {
    assert.ok(hooks.includes(`['${root}', activeId, startInstant, endInstantExclusive]`));
  }
  assert.ok(hooks.includes('vehicle_id=${activeId}&start=${encodeURIComponent(startInstant)}&end=${encodeURIComponent(endInstantExclusive)}'));
  assert.equal((hooks.match(/enabled: activeId !== ''/g) ?? []).length, 2);
  // MDC-002 requires forwarded cancellation, without a new observer policy.
  assert.equal((hooks.match(/queryFn: \(\{ signal \}\)/g) ?? []).length, 2);
  assert.equal((hooks.match(/\{ signal \},/g) ?? []).length, 2);
  for (const forbidden of ['select:', 'staleTime:', 'retry:', 'refetchInterval:', '/api/v1/']) {
    assert.ok(!hooks.includes(forbidden), forbidden);
  }
});

test('drawer and navigation retain baseline structure outside nullable display guards', { skip: !original }, () => {
  const extractDrawer = text => {
    const tree = parse(text);
    let drawer;
    const visit = node => {
      if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(tree) === 'EntityPreviewDrawer') drawer = node;
      ts.forEachChild(node, visit);
    };
    visit(tree);
    assert.ok(drawer);
    return print(drawer, tree);
  };
  const currentDrawer = extractDrawer(page);
  const originalDrawer = extractDrawer(original);
  assert.equal(currentDrawer === originalDrawer ? currentDrawer : normalizeKnownFromState(currentDrawer), originalDrawer);
});

test('all record, chart and preference identities stay source-backed', () => {
  for (const invariant of [
    'tableId="analytics:timeline-transitions"',
    "mobileColumns={['ts', 'from_state', 'to_state']}",
    'keyExtractor={(row) => row.index}',
    'chartKey="timeline-daily-breakdown"',
    "persistKey: 'timeline.range'",
    "defaultPresetId: '7d'",
    "date.toISOString().slice(0, 10)",
    "hiddenSeries?.isHidden('driving')",
    "hiddenSeries?.isHidden('charging')",
    "hiddenSeries?.isHidden('idle')",
    "hiddenSeries?.isHidden('sleeping')",
    'enableValueFilters', 'pagination',
    "key: 'trigger_value'",
    'onOpenRow: (row) => setPreviewTransition(row)',
  ]) assert.ok(page.includes(invariant), invariant);
  assert.equal((page.match(/<CardGrid\b/g) ?? []).length, 4);
  assert.equal((page.match(/<ChartCard\b/g) ?? []).length, 1);
  assert.equal((page.match(/<LayoutCard\b/g) ?? []).length, 3);
});

test('presentation source changes introduce no forbidden controls, libraries or unsafe casts', () => {
  for (const name of ['TimelineSource.tsx', 'TimelineSummary.tsx']) {
    const source = readFileSync(resolve(here, name), 'utf8');
    assert.ok(!/\bas any\b|<any>/.test(source));
    assert.ok(!/<(?:button|input|select|textarea|table)\b/.test(source));
    assert.ok(!/from ['"](?:recharts|react-leaflet|framer-motion)['"]/.test(source));
  }
});
