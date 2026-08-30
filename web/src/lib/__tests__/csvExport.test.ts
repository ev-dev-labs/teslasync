import { describe, it, expect } from 'vitest';
import {
  escapeCell,
  toCSV,
  objectsToCSV,
  defaultExportFilename,
  type CsvColumn,
} from '../csvExport';

describe('escapeCell', () => {
  it('returns empty string for null/undefined', () => {
    expect(escapeCell(null)).toBe('');
    expect(escapeCell(undefined)).toBe('');
  });

  it('passes through plain strings', () => {
    expect(escapeCell('hello')).toBe('hello');
  });

  it('quotes strings with commas', () => {
    expect(escapeCell('a,b')).toBe('"a,b"');
  });

  it('quotes strings with double quotes and doubles them', () => {
    expect(escapeCell('say "hi"')).toBe('"say ""hi"""');
  });

  it('quotes strings with newlines', () => {
    expect(escapeCell('line1\nline2')).toBe('"line1\nline2"');
    expect(escapeCell('line1\r\nline2')).toBe('"line1\r\nline2"');
  });

  it('quotes leading/trailing whitespace', () => {
    expect(escapeCell(' trimmed ')).toBe('" trimmed "');
  });

  it('neutralizes spreadsheet formula injection', () => {
    expect(escapeCell('=HYPERLINK("https://attacker.invalid")')).toBe(`"'=HYPERLINK(""https://attacker.invalid"")"`);
    expect(escapeCell('  +SUM(1,1)')).toBe(`"'  +SUM(1,1)"`);
    expect(escapeCell(-12)).toBe('-12');
  });

  it('serializes numbers and booleans', () => {
    expect(escapeCell(42)).toBe('42');
    expect(escapeCell(3.14)).toBe('3.14');
    expect(escapeCell(true)).toBe('true');
    expect(escapeCell(false)).toBe('false');
  });

  it('JSON-encodes objects and arrays', () => {
    expect(escapeCell({ a: 1 })).toBe('"{""a"":1}"');
    expect(escapeCell([1, 2, 3])).toBe('"[1,2,3]"');
  });
});

describe('toCSV', () => {
  interface Row { id: number; name: string; battery?: number | null }

  const cols: CsvColumn<Row>[] = [
    { key: 'id', header: 'ID' },
    { key: 'name', header: 'Name' },
    { key: 'battery', header: 'Battery %' },
  ];

  it('writes header on empty input', () => {
    expect(toCSV<Row>([], cols)).toBe('ID,Name,Battery %');
  });

  it('writes header + rows with CRLF separator', () => {
    const rows: Row[] = [
      { id: 1, name: 'Model 3', battery: 75 },
      { id: 2, name: 'Model Y', battery: null },
    ];
    expect(toCSV(rows, cols)).toBe('ID,Name,Battery %\r\n1,Model 3,75\r\n2,Model Y,');
  });

  it('uses accessor when provided', () => {
    const rows: Row[] = [{ id: 1, name: 'M3', battery: 80 }];
    const customCols: CsvColumn<Row>[] = [
      { key: 'id' },
      { key: 'label', accessor: (r) => `${r.name} (${r.battery}%)` },
    ];
    expect(toCSV(rows, customCols)).toBe('id,label\r\n1,M3 (80%)');
  });

  it('falls back to key as header when header missing', () => {
    expect(toCSV<Row>([], [{ key: 'name' }])).toBe('name');
  });
});

describe('objectsToCSV', () => {
  it('builds union of keys preserving insertion order', () => {
    const rows = [
      { a: 1, b: 2 },
      { b: 3, c: 4 },
    ];
    expect(objectsToCSV(rows)).toBe('a,b,c\r\n1,2,\r\n,3,4');
  });

  it('handles empty rows', () => {
    expect(objectsToCSV([])).toBe('');
  });
});

describe('defaultExportFilename', () => {
  it('formats prefix-YYYY-MM-DD', () => {
    const d = new Date(2026, 4, 1); // Local-timezone May 1, 2026
    expect(defaultExportFilename('drives', d)).toBe('drives-2026-05-01');
  });

  it('zero-pads single-digit months and days', () => {
    const d = new Date(2026, 0, 9);
    expect(defaultExportFilename('charging', d)).toBe('charging-2026-01-09');
  });
});
