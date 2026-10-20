import assert from 'node:assert/strict';
import test from 'node:test';
import { migrateProviderI18nTests as migrate } from './migrate-provider-i18n-tests.mjs';

const fixture = `import { it } from 'vitest';
import { I18nextProvider } from 'react-i18next';
it('switches languages', () => render(<I18nextProvider i18n={locale}><Panel /></I18nextProvider>));`;

test('restores the real hook without changing locale resources or assertions', () => {
  const result = migrate(fixture);
  assert.equal(result.changed, true);
  assert.ok(result.output.includes("import { vi, it } from 'vitest'"));
  assert.ok(result.output.includes("vi.unmock('react-i18next');"));
  assert.ok(result.output.endsWith(fixture.split('\n').at(-1)));
  assert.equal(migrate(result.output).output, result.output);
});

test('preserves explicit translation mocks and existing real-hook opt-outs', () => {
  for (const method of ['mock', 'unmock', 'doMock', 'doUnmock']) {
    const source = `${fixture}\nvi.${method}('react-i18next', () => ({}));`;
    assert.equal(migrate(source).output, source);
  }
});

test('requires a rendered provider and preserves existing vi imports and aliases', () => {
  assert.equal(migrate(fixture.replace('<I18nextProvider i18n={locale}><Panel /></I18nextProvider>', '<Panel />')).changed, false);
  const existing = fixture.replace('{ it }', '{ it, vi }');
  assert.ok(migrate(existing).output.includes('{ it, vi }'));
  const aliased = fixture.replace('{ it }', '{ it, vi as vitest }');
  assert.equal(migrate(aliased).output, aliased);
});

test('retains CRLF and file-level documentation', () => {
  const source = '/** Locale contract. */\r\n' + fixture.replaceAll('\n', '\r\n');
  const result = migrate(source);
  assert.ok(result.output.startsWith('/** Locale contract. */\r\n'));
  assert.equal(result.output.replaceAll('\r\n', '').includes('\n'), false);
});
