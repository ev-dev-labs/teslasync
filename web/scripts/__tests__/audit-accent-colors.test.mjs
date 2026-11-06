import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../audit-accent-colors.mjs', import.meta.url));

function scan(files) {
  const root = mkdtempSync(join(tmpdir(), 'accent-audit-'));
  try {
    mkdirSync(join(root, 'src'));
    for (const [path, contents] of Object.entries(files)) {
      const file = join(root, 'src', path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, contents);
    }
    const result = spawnSync(process.execPath, [script, '--root', root], { encoding: 'utf8' });
    return { status: result.status, output: result.stdout + result.stderr };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('rejects fixed accent-like Tailwind classes including variants and legacy aliases', () => {
  for (const utility of ['bg-cyan-500', 'hover:text-sky-400', 'focus:ring-blue-500', 'border-teal-300', 'text-indigo-400', 'bg-neon-cyan/10', 'shadow-neon-cyan/10']) {
    const result = scan({ 'Example.tsx': `export const A = () => <div className="${utility}" />;` });
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /fixed color utility/);
  }
});

test('rejects hex and rgb accent literals in JSX and interactive CSS', () => {
  for (const [file, contents] of [
    ['Example.tsx', `export const A = () => <div style={{ color: '#06b6d4' }} />;`],
    ['Example.tsx', `export const A = () => <div className="shadow-[0_0_8px_rgba(34,211,238,0.5)]" />;`],
    ['Example.tsx', `const focusColor = '#3b82f6';`],
    ['Example.tsx', `const backgroundColor = '#06b6d4';`],
    ['Example.tsx', `const paint = '#06b6d4'; export const A = () => <div style={{ color: paint }} />;`],
    ['Example.tsx', `const paint = 'rgb(5% 70% 83%)';`],
    ['Example.tsx', `const paint = t('paint', '#06b6d4');`],
    ['Example.css', `.link:hover { color: rgb(56, 189, 248); }`],
    ['Example.css', `.link { color: rgb(5% 70% 83% / 0.5); }`],
    ['Example.css', `:root .selected { color: #3b82f6; }`],
    ['Example.css', `:root { --selected-color: #3b82f6; }`],
    ['../index.html', `<svg><path fill="#3b82f6"/></svg>`],
  ]) {
    const result = scan({ [file]: contents });
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /fixed accent color/);
  }
});

test('accepts shared accent and independent semantic status tokens', () => {
  const result = scan({
    'Example.tsx': `const example = t('color.example', 'Enter a color such as #3b82f6'); export const A = () => <div style={{ background: 'rgba(15,23,42,0.6)', color: '#10b981' }} className="bg-[var(--theme-primary)] text-[var(--theme-on-primary)] focus:ring-[var(--focus-ring)] text-[var(--semantic-info)] bg-[var(--semantic-danger-bg)]" />;`,
  });
  assert.equal(result.status, 0, result.output);
});

test('only token modules and test files are excluded, not suppression comments', () => {
  assert.equal(scan({ 'lib/colors.ts': `const primary = '#06b6d4';` }).status, 0);
  assert.equal(scan({ 'features/dashboard/lib/dashboardTokens.ts': `const series = '#06b6d4';` }).status, 0);
  assert.equal(scan({ 'Example.test.tsx': `const x = 'bg-blue-500';` }).status, 0);
  const result = scan({ 'Example.tsx': `// accent-audit-ignore\nexport const A = () => <div className="bg-blue-500" />;` });
  assert.equal(result.status, 1, result.output);
});
