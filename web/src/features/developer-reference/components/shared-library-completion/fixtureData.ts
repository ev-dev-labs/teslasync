export const fixtureClipboardPayload = '{\n  "fixture_id": "prepared-evidence-0007",\n  "reading": null,\n  "measured_zero": 0,\n  "context": "Long prepared evidence identity retained exactly without clipboard normalization"\n}\n';

/** Prepared observations, not generated from a live clock or a production data source. */
export const completeChartRows = [
  { date: '2026-08-01', score: 0 },
  { date: '2026-08-02', score: 2 },
  { date: '2026-08-03', score: null },
  { date: '2026-08-04', score: 4 },
  { date: '2026-08-05', score: 3 },
  { date: '2026-08-06', score: 6 },
  { date: '2026-08-07', score: 5 },
  { date: '2026-08-08', score: 8 },
  { date: '2026-08-09', score: 7 },
  { date: '2026-08-10', score: 10 },
  { date: '2026-08-11', score: 9 },
  { date: '2026-08-12', score: 12 },
];

export const plottedChartRows = [0, 3, 7, 11].map(index => completeChartRows[index]);
export const loadedFixtureIds: Array<string | number> = ['fixture-a', 'fixture-b'];
