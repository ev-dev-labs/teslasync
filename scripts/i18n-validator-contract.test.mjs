import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
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
