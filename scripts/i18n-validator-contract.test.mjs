import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isProductionSource, scanTranslationCalls, resolvesCall } from './i18n-validate-keys.mjs';

const hookImport = "import { useTranslation } from 'react-i18next';";
const require = createRequire(new URL('../web/package.json', import.meta.url));
const i18next = require('i18next');

test('production selection excludes test/spec/mock/fixture/story/setup sources, not similarly named features', () => {
  for (const file of ['src/a.test.tsx', 'src/a.spec.js', 'src/__tests__/a.ts', 'src/__mocks__/a.ts',
    'src/fixtures/a.tsx', 'src/a.stories.tsx', 'src/test-setup.ts', 'src/a.d.ts']) {
    assert.equal(isProductionSource(file), false, file);
  }
  for (const file of ['src/feature.tsx', 'src/testing/Panel.tsx', 'src/Latest.ts', 'src\\feature.jsx']) {
    assert.equal(isProductionSource(file), true, file);
  }
});

test('comments, strings, unrelated local calls and lexical shadows are not translations', () => {
  const calls = scanTranslationCalls(`${hookImport}
    const { t } = useTranslation();
    // t('comment.missing')
    /* t('block.missing') */
    const example = "t('string.missing')";
    t('production.missing', 'Real gap');
    function other() { const t = (key) => key; t('not.translation'); }
    function named() { function t(key) { return key; } t('also.not.translation'); }
    const service = { t: (value) => value }; service.t('service.not.translation');
    class Child extends Base { method() { super.method(); } }
  `, 'F:\\project\\src\\Panel.tsx');
  assert.deepEqual(calls.map(({ key }) => key), ['production.missing']);
  assert.equal(calls[0].binding, 'translation');
});

test('recognizes imported hook aliases, tuple binding, translator aliases, i18next and typed helpers', () => {
  const calls = scanTranslationCalls(`
    import { useTranslation as useCopy } from 'react-i18next';
    import i18next, { t as translate, type TFunction } from 'i18next';
    import localI18n from '@/i18n';
    const { t: copy } = useCopy('dashboard');
    const [tuple] = useCopy();
    const alias = copy;
    copy('copy.key'); tuple('tuple.key'); alias('alias.key');
    translate('import.key'); i18next.t('instance.key'); localI18n.t('local.key');
    function helper(copy: TFunction) { return copy('helper.key'); }
    useCopy().t('direct.key');
  `);
  assert.deepEqual(calls.map(({ key }) => key),
    ['copy.key', 'tuple.key', 'alias.key', 'import.key', 'instance.key', 'local.key', 'helper.key', 'direct.key']);
  assert.ok(calls.every(({ binding }) => binding === 'translation'));
});

test('multiline literals decode escapes and preserve positional and options defaultValue, including empty strings', () => {
  const calls = scanTranslationCalls(`${hookImport}
    const { t } = useTranslation();
    t(
      'multiline.key',
      { nested: { n: 1 }, defaultValue: 'Hello\\nworld', count: n }
    );
    t(\`template.key\`, \`Two
lines\`);
    t('empty.key', '');
    t('escaped.key', 'It\\'s ready');
    t(\`dynamic.\${id}\`, 'Not static');
  `);
  assert.deepEqual(calls.map(({ key, fallback }) => [key, fallback]), [
    ['multiline.key', 'Hello\nworld'], ['template.key', 'Two\nlines'],
    ['empty.key', ''], ['escaped.key', "It's ready"],
  ]);
  assert.equal(calls[0].count, 'dynamic');
});

test('unproven helper bindings stay visible and strict instead of being assumed false positives', () => {
  const [call] = scanTranslationCalls("function helper(t) { return t('real.gap', 'Gap'); }");
  assert.equal(call.binding, 'unresolved');
  assert.equal(resolvesCall(new Set(), call.key, call), false);
});

test('local wrappers around genuine translation bindings retain strict missing-key references', () => {
  const calls = scanTranslationCalls(`
    import i18n from 'i18next';
    const t = (key, fallback) => i18n.t(key, fallback);
    t('wrapper.missing', 'Missing wrapper copy');
    const adapter = { t };
    adapter.t('adapter.missing', 'Missing adapter copy');
  `);
  assert.equal(calls[0].key, 'wrapper.missing');
  assert.equal(calls[0].binding, 'translation');
  assert.equal(calls[1].key, 'adapter.missing');
  assert.equal(calls[1].binding, 'translation');
});

test('fixed translations in wrappers do not turn caller record ids into keys', () => {
  const calls = scanTranslationCalls(`${hookImport}
    const { t } = useTranslation();
    function getLabel(id) { return t('fixed.key', 'Fixed'); }
    getLabel('record.id');
    const selectSection = (id) => sections.find(section => section.id === id)?.label
      ?? t('section.fallback', 'Section');
    selectSection('overview');
    const title = (fallback) => t('fixed.title', fallback);
    title('Turn signal');
    const noParameter = () => t(runtimeKey);
    noParameter('extra.record.id');
  `);
  assert.deepEqual(calls.map(({ key }) => key), ['fixed.key', 'section.fallback', 'fixed.title']);
});

test('forwarded wrappers use actual translation fallback positions, not caller second argument', () => {
  const calls = scanTranslationCalls(`
    import i18n from 'i18next';
    const copy = (key, recordId, fallback) => i18n.t(key, fallback);
    copy('forwarded.key', 'record.id', 'Actual fallback');
    const fixedDefault = (key, recordId) => i18n.t(key, 'Fixed fallback');
    fixedDefault('fixedDefault.key', 'not a fallback');
    const optionDefault = (key, recordId, fallback) => i18n.t(key, { defaultValue: fallback });
    optionDefault('option.key', 'record.id', 'Options fallback');
    const alias = copy;
    alias('alias.key', 'record.id', 'Alias fallback');
  `);
  assert.deepEqual(calls.map(({ key, fallback }) => [key, fallback]), [
    ['forwarded.key', 'Actual fallback'], ['fixedDefault.key', 'Fixed fallback'],
    ['option.key', 'Options fallback'], ['alias.key', 'Alias fallback'],
  ]);
  assert.ok(calls.every((call) => resolvesCall(new Set(), call.key, call) === false));
});

test('plural contract requires count and every reachable English category, not arbitrary suffixed siblings', () => {
  const scan = (options = '') => scanTranslationCalls(`${hookImport}
    const { t } = useTranslation(); t('items', 'Items'${options});`)[0];
  const peers = new Set(['items_one', 'items_other']);
  assert.equal(resolvesCall(peers, 'items', scan()), false);
  assert.equal(resolvesCall(peers, 'items', scan(', { count: n }')), true);
  assert.equal(resolvesCall(new Set(['items_other']), 'items', scan(', { count: n }')), false);
  assert.equal(resolvesCall(new Set(['items_one']), 'items', scan(', { count: 1 }')), true);
  assert.equal(resolvesCall(new Set(['items_other']), 'items', scan(', { count: 2 }')), true);
  assert.equal(resolvesCall(new Set(['items_description']), 'items', scan(', { count: n }')), false);
  assert.equal(resolvesCall(peers, 'items', scan(', options')), false);
  assert.equal(resolvesCall(peers, 'items', scan(', { ...options, count: n }')), false);
  assert.equal(resolvesCall(new Set(['items']), 'items', scan(', { count: n }')), true);
  assert.equal(resolvesCall(new Set(['items_zero']), 'items', scan(', { count: 0 }')), true);
  assert.equal(resolvesCall(new Set(['items_zero']), 'items', scan(', { count: n }')), false);
});

test('ordinal and context plural peers are resolved without making incomplete ordinal sets pass', () => {
  const [call] = scanTranslationCalls(`${hookImport}
    const { t } = useTranslation(); t('rank', { count: n, ordinal: true, context: 'driver' });`);
  const peers = new Set(['one', 'two', 'few', 'other'].map((suffix) => `rank_driver_ordinal_${suffix}`));
  assert.equal(resolvesCall(peers, 'rank', call), true);
  peers.delete('rank_driver_ordinal_few');
  assert.equal(resolvesCall(peers, 'rank', call), false);
});

test('forwarded shorthand options, count, defaults and chained adapters use caller values', () => {
  const calls = scanTranslationCalls(`
    import i18n from 'i18next';
    const copy = (key, count, defaultValue = 'Default copy') =>
      i18n.t(key, { count, defaultValue });
    copy('items', 1);
    copy('empty', 2, '');
    const adapter = { copy(key, n, fallback) { return copy(key, n, fallback); } };
    adapter.copy('adapter.items', 2, 'Adapter copy');
    const outer = (key, n, fallback) => adapter.copy(key, n, fallback);
    outer('outer.items', 1, 'Outer copy');
    const withOptions = (key, ignored, options) => i18n.t(key, options);
    withOptions('options.items', 'record.id', { count: 2, defaultValue: 'Option copy' });
  `);
  assert.deepEqual(calls.map(({ key, fallback, count, dynamicOptions }) =>
    [key, fallback, count, dynamicOptions]), [
    ['items', 'Default copy', 1, false],
    ['empty', '', 2, false],
    ['adapter.items', 'Adapter copy', 2, false],
    ['outer.items', 'Outer copy', 1, false],
    ['options.items', 'Option copy', 2, false],
  ]);
  assert.equal(resolvesCall(new Set(['items_one']), 'items', calls[0]), true);
  assert.ok(calls.every((call) => !resolvesCall(new Set(), call.key, call)));
});

test('lexical parameter identity and fixed-key object methods do not invent caller keys', () => {
  const calls = scanTranslationCalls(`${hookImport}
    const { t } = useTranslation();
    const labels = { getLabel(id) { return t('fixed.object', 'Fixed object'); } };
    labels.getLabel('record.id');
    function getLabel(key) {
      function inner(key) { return t(key, 'Inner'); }
      return inner('fixed.inner');
    }
    getLabel('not.forwarded');
    const fixed = (key) => t('fixed.constant', key);
    const alias = fixed;
    alias('not.a.key');
  `);
  assert.deepEqual(calls.map(({ key }) => key), ['fixed.object', 'fixed.inner', 'fixed.constant']);
});

test('hook namespace is not a dotted prefix and colon lookup retains strict actual misses', () => {
  const calls = scanTranslationCalls(`${hookImport}
    const { t: copy } = useTranslation('dashboard');
    copy('layout.deleteMessage', 'Delete');
    copy('dashboard.layout.deleteMessage', 'Delete');
    copy('common:unknown', 'Unknown');
    copy('common:common.unknown', 'Unknown');
    copy('maps.animatedMarker.label', { ns: 'translation', defaultValue: 'Map' });
  `);
  const defined = new Set(['dashboard.layout.deleteMessage', 'common.unknown', 'maps.animatedMarker.label']);
  assert.deepEqual(calls.map((call) => resolvesCall(defined, call.key, call)),
    [false, true, false, true, true]);
  assert.equal(calls[2].key, 'common:unknown');
  // A colon-containing catalog leaf cannot answer the stripped runtime key.
  assert.equal(resolvesCall(new Set(['common:unknown']), calls[2].key, calls[2]), false);
  assert.equal(resolvesCall(new Set(['unknown']), calls[2].key, calls[2]), true);
});

test('namespace lookup agrees with installed i18next translation fallback, without live catalog reads', async () => {
  const engine = i18next.createInstance();
  await engine.init({
    lng: 'en', fallbackLng: 'en', fallbackNS: 'translation', initImmediate: false,
    resources: { en: { translation: {
      dashboard: { layout: { deleteMessage: 'Delete' } },
      common: { unknown: 'Unknown' }, items_one: 'One', items_other: 'Many',
    } } },
  });
  const calls = scanTranslationCalls(`${hookImport}
    const { t } = useTranslation('dashboard');
    t('layout.deleteMessage', 'Delete');
    t('dashboard.layout.deleteMessage', 'Delete');
    t('common:unknown', 'Unknown');
    t('common:common.unknown', 'Unknown');
    t('common:items', { count: 2 });
  `);
  const defined = new Set(['dashboard.layout.deleteMessage', 'common.unknown', 'items_one', 'items_other']);
  for (const call of calls) {
    const options = { ns: 'dashboard', ...(call.count === null ? {} : { count: call.count }) };
    assert.equal(resolvesCall(defined, call.key, call), engine.exists(call.key, options), call.key);
  }
});

const guardedFixture = (declarations, expression) => `${hookImport}
  const { t } = useTranslation();
  function render() {
    ${declarations}
    return ${expression};
  }`;
const updatesCall = (options = "count: updateCount") =>
  `t('updates', { defaultValue: '{{count}} updates', ${options} })`;

test('guarded const array-length snapshots require only reachable English cardinal peers', () => {
  for (const expression of [
    `updateCount > 1 && ${updatesCall()}`,
    `(updateCount > 1) && \` · \${${updatesCall()}}\``,
    `enabled && (updateCount > 1 && ${updatesCall()})`,
    `updateCount > 1 && (enabled ? ${updatesCall()} : null)`,
  ]) {
    const [call] = scanTranslationCalls(guardedFixture('const updates = []; const updateCount = updates.length;', expression));
    assert.deepEqual(call.countDomain, { greaterThan: 1, numeric: true }, expression);
    assert.equal(call.count, 'dynamic');
    assert.equal(call.fallback, '{{count}} updates');
    assert.equal(resolvesCall(new Set(['updates_other']), call.key, call), true, expression);
    assert.equal(resolvesCall(new Set(['updates_one']), call.key, call), false, expression);
    assert.equal(resolvesCall(new Set(), call.key, call), false, expression);
  }
  const [shorthand] = scanTranslationCalls(guardedFixture(
    'const count = [].length;',
    `count > 1 && ${updatesCall('count')}`));
  assert.deepEqual(shorthand.countDomain, { greaterThan: 1, numeric: true });
  assert.equal(resolvesCall(new Set(['updates_other']), shorthand.key, shorthand), true);
});

test('unguarded, mismatched, weaker, equality, OR and deferred guards stay strict', () => {
  const declarations = 'const updates = []; const updateCount = updates.length; const otherCount = [].length;';
  const expressions = [
    updatesCall(),
    `otherCount > 1 && ${updatesCall()}`,
    `updateCount >= 1 && ${updatesCall()}`,
    `updateCount === 1 && ${updatesCall()}`,
    `updateCount == 2 && ${updatesCall()}`,
    `updateCount > 1 || ${updatesCall()}`,
    `(updateCount > 1 || enabled) && ${updatesCall()}`,
    `(updateCount > 1 && enabled) && ${updatesCall()}`,
    `updateCount > 1 && (() => ${updatesCall()})`,
    `updateCount > 1 && ((updateCount) => ${updatesCall()})(1)`,
  ];
  for (const expression of expressions) {
    const [call] = scanTranslationCalls(guardedFixture(declarations, expression));
    assert.equal(call.countDomain, undefined, expression);
    assert.equal(resolvesCall(new Set(['updates_other']), call.key, call), false, expression);
    assert.equal(resolvesCall(new Set(['updates_one', 'updates_other']), call.key, call), true, expression);
  }
});

test('nonnumeric, unknown, cast and shadowed collection origins cannot prove numeric counts', () => {
  const declarations = [
    'const updateCount = "2";',
    'const updateCount = runtimeCount;',
    'const updates = { length: 1.1 }; const updateCount = updates.length;',
    'const updates = runtimeUpdates; const updateCount = (updates ?? []).length;',
    'const updates = runtimeUpdates as string[]; const updateCount = updates.length;',
    'const updates = []; const updateCount = updates.length / 2;',
    'const updates = []; { const updates = { length: 1.1 }; const updateCount = updates.length;',
  ];
  for (const declaration of declarations) {
    const closing = declaration.includes('{ const updates') ? '}' : '';
    const [call] = scanTranslationCalls(guardedFixture(declaration,
      `updateCount > 1 && ${updatesCall()}; ${closing}`));
    assert.equal(call.countDomain, undefined, declaration);
    assert.equal(resolvesCall(new Set(['updates_other']), call.key, call), false, declaration);
  }
});

test('mutable counts, reassignment, collection writes and aliases invalidate the narrow proof', () => {
  const declarations = [
    'const updates = []; let updateCount = updates.length;',
    'let updates = []; const updateCount = updates.length;',
    'const updates = []; const updateCount = updates.length; updateCount = 1;',
    'const updates = []; const updateCount = updates.length; updateCount++;',
    'const updates = []; const updateCount = updates.length; [updateCount] = [1];',
    'const updates = []; const updateCount = updates.length; updates.length = 1.1;',
    'const updates = []; const updateCount = updates.length; updates[0] = 1;',
    'const updates = []; const updateCount = updates.length; updates.push(1);',
    'const updates = []; const updateCount = updates.length; const alias = updates; alias.length = 1.1;',
    'const updates = []; const updateCount = updates.length; mutate(updates);',
    'const updates = []; const updateCount = updates.length; function later() { updateCount = 1; }',
  ];
  for (const declaration of declarations) {
    const [call] = scanTranslationCalls(guardedFixture(declaration, `updateCount > 1 && ${updatesCall()}`));
    assert.equal(call.countDomain, undefined, declaration);
    assert.equal(resolvesCall(new Set(['updates_other']), call.key, call), false, declaration);
  }
  const [between] = scanTranslationCalls(guardedFixture(
    'const updateCount = [].length;',
    `updateCount > 1 && (updateCount = 1, ${updatesCall()})`));
  assert.equal(between.countDomain, undefined);
});

test('ordinal, context, language, spread and duplicate-count options cannot use cardinal reachability', () => {
  for (const options of [
    'count: updateCount, ordinal: true',
    'count: updateCount, ordinal: runtimeOrdinal',
    'count: updateCount, context: "driver"',
    'count: updateCount, context: runtimeContext',
    'count: updateCount, lng: "fr"',
    'count: updateCount, lngs: ["fr"]',
    'count: updateCount, ...options',
    'count: updateCount, count: runtimeCount',
    'count: updateCount, [optionName]: runtimeCount',
  ]) {
    const [call] = scanTranslationCalls(guardedFixture(
      'const updateCount = [].length;', `updateCount > 1 && ${updatesCall(options)}`));
    assert.equal(call.countDomain, undefined, options);
    assert.equal(resolvesCall(new Set(['updates_other']), call.key, call), false, options);
  }
  const [ambiguous] = scanTranslationCalls(guardedFixture('const updateCount = [].length;',
    `updateCount > 1 && t('updates', { count: updateCount }, { count: runtimeCount })`));
  assert.equal(ambiguous.countDomain, undefined);
  assert.equal(resolvesCall(new Set(['updates_other']), ambiguous.key, ambiguous), false);
});

test('typed array map member lengths reproduce the actual caller pattern without key/path exemptions', () => {
  const fixture = `${hookImport}
    import { useMemo } from 'react';
    interface Record { updates: string[] }
    const { t } = useTranslation();
    const records = useMemo<Record[]>(() => source ?? [], [source]);
    records.map((record) => {
      const updateCount = (record.updates ?? []).length;
      return updateCount > 1 && ${updatesCall()};
    });
  `;
  const [call] = scanTranslationCalls(fixture);
  assert.deepEqual(call.countDomain, { greaterThan: 1, numeric: true });
  assert.equal(resolvesCall(new Set(['updates_other']), call.key, call), true);
  for (const negative of [
    fixture.replace('updates: string[]', 'updates: { length: number }'),
    fixture.replace('const updateCount', 'record.updates = []; const updateCount'),
    fixture.replace('const updateCount', 'record = otherRecord; const updateCount'),
    fixture.replace('const updateCount', 'const alias = record; const updateCount'),
    fixture.replace('const updateCount', 'const record = { updates: { length: 1.1 } }; const updateCount'),
    fixture.replace('records.map((record) => {',
      'records.map((outer) => { const record = { updates: { length: 1.1 } };'),
  ]) {
    const [unsafe] = scanTranslationCalls(negative);
    assert.equal(unsafe.countDomain, undefined, negative);
    assert.equal(resolvesCall(new Set(['updates_other']), unsafe.key, unsafe), false);
  }
});

test('unchanged IncidentsCard call resolves only other and installed English runtime hides 0/1, renders 2/3', async () => {
  const callerURL = new URL('../web/src/features/system/components/status/IncidentsCard.tsx', import.meta.url);
  const source = fs.readFileSync(callerURL, 'utf8');
  const key = 'systemStatus.incidents.updateCount';
  const call = scanTranslationCalls(source, fileURLToPath(callerURL)).find((entry) => entry.key === key);
  assert.ok(call);
  assert.deepEqual(call.countDomain, { greaterThan: 1, numeric: true });
  assert.equal(call.count, 'dynamic');
  assert.equal(call.fallback, '{{count}} updates');
  assert.equal(resolvesCall(new Set([`${key}_other`]), key, call), true);
  assert.equal(resolvesCall(new Set([`${key}_one`]), key, call), false);
  const engine = i18next.createInstance();
  await engine.init({
    lng: 'en', fallbackLng: 'en', initImmediate: false,
    resources: { en: { translation: { systemStatus: { incidents: { updateCount_other: '{{count}} updates' } } } } },
  });
  // Execute the unchanged guard expression, not a replacement production caller.
  const expression = source.split(/\r?\n/).find((line) => line.includes(`t('${key}'`)).trim().slice(1, -1);
  const render = new Function('updateCount', 't', `return ${expression};`);
  const executions = [];
  const translate = (...args) => { executions.push(args[1].count); return engine.t(...args); };
  assert.equal(render(0, translate), false);
  assert.equal(render(1, translate), false);
  assert.equal(render(2, translate), ' · 2 updates');
  assert.equal(render(3, translate), ' · 3 updates');
  assert.deepEqual(executions, [2, 3]);
  assert.equal(engine.services.pluralResolver.getSuffix('en', 1.1), '_other');
  assert.equal(engine.exists(key, { count: 1.1 }), true);
  assert.equal(engine.exists(key, { count: 2 }), true);
  assert.equal(engine.exists(key, { count: 3 }), true);
});

test('guarded cardinal lookup retains colon namespace stripping and shorthand semantics', () => {
  const [call] = scanTranslationCalls(`${hookImport}
    const { t } = useTranslation();
    const updates = [];
    const count = updates.length;
    count > 1 && t('common:updates', { count, defaultValue: '{{count}} updates' });
  `);
  assert.deepEqual(call.countDomain, { greaterThan: 1, numeric: true });
  assert.equal(call.fallback, '{{count}} updates');
  assert.equal(call.count, 'dynamic');
  assert.equal(resolvesCall(new Set(['updates_other']), call.key, call), true);
  assert.equal(resolvesCall(new Set(['common:updates_other']), call.key, call), false);
});

test('proven fractional numbers above one select English cardinal other, not ordinal or other-language categories', () => {
  const rules = new Intl.PluralRules('en');
  assert.equal(rules.select(1), 'one');
  for (const count of [1.1, 1.5, 2, 3, 21]) {
    assert.equal(rules.select(count), 'other');
    const [call] = scanTranslationCalls(guardedFixture(
      `const updateCount = ${count};`, `updateCount > 1 && ${updatesCall()}`));
    assert.deepEqual(call.countDomain, { greaterThan: 1, numeric: true });
    assert.equal(resolvesCall(new Set(['updates_other']), call.key, call), true);
  }
  const ordinal = new Intl.PluralRules('en', { type: 'ordinal' });
  assert.equal(ordinal.select(2), 'two');
  assert.equal(ordinal.select(3), 'few');
  assert.equal(ordinal.select(21), 'one');
  const [call] = scanTranslationCalls(guardedFixture(
    'const updateCount = 21;', `updateCount > 1 && ${updatesCall('count: updateCount, ordinal: true')}`));
  assert.equal(call.countDomain, undefined);
  assert.equal(resolvesCall(new Set(['updates_ordinal_other']), call.key, call), false);
});
