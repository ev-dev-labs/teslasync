import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const script = fileURLToPath(new URL('../audit-datatable-tableid.mjs', import.meta.url));

function audit(source) {
  const directory = mkdtempSync(join(tmpdir(), 'teslasync-tableid-'));
  try {
    const features = join(directory, 'src', 'features');
    mkdirSync(features, { recursive: true });
    writeFileSync(join(features, 'Fixture.tsx'), source);
    return spawnSync(process.execPath, [script], { cwd: directory, encoding: 'utf8' });
  } finally {
    rmSync(directory, { recursive: true });
  }
}

test('accepts generic tables with comments, apostrophes and nested TSX', () => {
  const result = audit(`
    const rows = [];
    const table = <DataTable<{ value: string }>
      // Preserve the source's fields; don't parse this comment as a string.
      tableId="example:records"
      columns={[{ render: row => <span>{row.value}</span> }]}
      mobile={{ title: row => \`Reading \${row.value}\` }}
      data={rows}
    />;
  `);
  assert.equal(result.status, 0, result.stderr);
});

test('rejects missing ids on both self-closing and paired generic tables', () => {
  const result = audit(`
    const first = <DataTable<{ value: string }> data={[]} />;
    const second = <DataTable data={[]}></DataTable>;
  `);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing required tableId \(2\)/);
  assert.match(result.stderr, /Fixture\.tsx:2/);
  assert.match(result.stderr, /Fixture\.tsx:3/);
});

test('does not mistake strings, comments or other component names for callers', () => {
  const result = audit(`
    // <DataTable data={[]} />
    const text = '<DataTable data={[]} />';
    const component = <DataTableColumnsMenu />;
  `);
  assert.equal(result.status, 0, result.stderr);
});

test('does not count an id in a comment, string prop or spread as an attribute', () => {
  const result = audit(`
    const first = <DataTable
      // tableId="not-an-attribute"
      message={'tableId="also-not-an-attribute"'}
      {...props}
    />;
  `);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing required tableId \(1\)/);
});

test('accepts an expression id and rejects malformed TSX rather than skipping it', () => {
  assert.equal(audit('const table = <DataTable tableId={id} data={[]} />;').status, 0);
  const malformed = audit('const table = <DataTable tableId="example:records" data={[]}');
  assert.equal(malformed.status, 1);
  assert.match(malformed.stderr, /invalid TSX/);
});
