import {
  buildExportUrl,
  exportAsCSV,
  exportAsJSON,
  nativeUnavailableDownloadSink,
  serializeCSV,
  type DownloadPayload,
  type FileDownloadSink,
} from '../src/web-parity/lib/export';

describe('web-parity export — buildExportUrl', () => {
  it('builds URL with type and format', () => {
    expect(buildExportUrl('drives', 'csv')).toBe(
      '/api/v1/export/drives?format=csv',
    );
  });

  it('builds URL with json format', () => {
    expect(buildExportUrl('charging', 'json')).toBe(
      '/api/v1/export/charging?format=json',
    );
  });

  it('includes date filters when provided', () => {
    const url = buildExportUrl('drives', 'csv', {
      start: '2024-01-01',
      end: '2024-12-31',
    });
    expect(url).toContain('start=2024-01-01');
    expect(url).toContain('end=2024-12-31');
    expect(url).toContain('format=csv');
  });

  it('includes vehicle_id (snake_case) when provided', () => {
    expect(buildExportUrl('positions', 'json', {vehicleId: 42})).toContain(
      'vehicle_id=42',
    );
  });

  it('omits optional filters when not provided', () => {
    expect(buildExportUrl('drives', 'csv', {})).toBe(
      '/api/v1/export/drives?format=csv',
    );
  });
});

describe('web-parity export — serializeCSV', () => {
  it('returns null for empty data (web `if (!data.length) return`)', () => {
    expect(serializeCSV([])).toBeNull();
  });

  it('infers columns from the first row when none are given', () => {
    const csv = serializeCSV([
      {name: 'Alice', age: 25},
      {name: 'Bob', age: 30},
    ]);
    expect(csv).toBe('name,age\nAlice,25\nBob,30');
  });

  it('uses explicit column labels and order when provided', () => {
    const csv = serializeCSV(
      [{name: 'Alice', age: 25}],
      [
        {key: 'age', label: 'Age'},
        {key: 'name', label: 'Name'},
      ],
    );
    expect(csv).toBe('Age,Name\n25,Alice');
  });

  it('renders null/undefined cells as empty strings', () => {
    const csv = serializeCSV([{a: null, b: undefined, c: 1}]);
    expect(csv).toBe('a,b,c\n,,1');
  });

  it('quotes and escapes values containing comma, quote or newline', () => {
    const csv = serializeCSV([
      {note: 'a,b'},
      {note: 'say "hi"'},
      {note: 'line1\nline2'},
    ]);
    expect(csv).toBe('note\n"a,b"\n"say ""hi"""\n"line1\nline2"');
  });
});

describe('web-parity export — exportAsCSV', () => {
  it('is a no-op for empty data (payload null, reason empty)', () => {
    const result = exportAsCSV([], 'test.csv');
    expect(result.payload).toBeNull();
    expect(result.outcome).toEqual({downloaded: false, reason: 'empty'});
  });

  it('builds a csv payload with the web mime type and the default sink reports unavailable', () => {
    const result = exportAsCSV(
      [
        {name: 'Alice', age: 25},
        {name: 'Bob', age: 30},
      ],
      'test.csv',
    );
    expect(result.payload).toEqual({
      content: 'name,age\nAlice,25\nBob,30',
      filename: 'test.csv',
      mimeType: 'text/csv;charset=utf-8;',
    });
    expect(result.outcome).toEqual({
      downloaded: false,
      reason: 'unavailable',
    });
  });

  it('routes the serialised csv through a custom sink', () => {
    let captured: DownloadPayload | null = null;
    const sink: FileDownloadSink = payload => {
      captured = payload;
      return {downloaded: true};
    };

    const result = exportAsCSV([{a: 1}], 'data.csv', undefined, sink);
    expect(captured).toEqual(result.payload);
    expect(result.outcome).toEqual({downloaded: true});
  });
});

describe('web-parity export — exportAsJSON', () => {
  it('serialises with 2-space indentation and the application/json mime type', () => {
    const data = [{a: 1}];
    const result = exportAsJSON(data, 'test.json');
    expect(result.payload).toEqual({
      content: JSON.stringify(data, null, 2),
      filename: 'test.json',
      mimeType: 'application/json',
    });
    expect(result.outcome).toEqual({
      downloaded: false,
      reason: 'unavailable',
    });
  });

  it('routes the serialised json through a custom sink', () => {
    let captured: DownloadPayload | null = null;
    const sink: FileDownloadSink = payload => {
      captured = payload;
      return {downloaded: true};
    };

    const result = exportAsJSON([{a: 1}], 'data.json', sink);
    expect(captured).toEqual(result.payload);
    expect(result.outcome).toEqual({downloaded: true});
  });
});

describe('web-parity export — nativeUnavailableDownloadSink', () => {
  it('ignores the payload and stays unavailable (no DOM download in bare RN)', () => {
    expect(
      nativeUnavailableDownloadSink({
        content: 'x',
        filename: 'f.csv',
        mimeType: 'text/csv;charset=utf-8;',
      }),
    ).toEqual({downloaded: false, reason: 'unavailable'});
  });
});
