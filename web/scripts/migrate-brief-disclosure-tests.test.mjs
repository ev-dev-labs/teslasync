import assert from 'node:assert/strict';
import test from 'node:test';
import { migrateBriefDisclosureTests as migrate, migrateMissingMetricTests } from './migrate-brief-disclosure-tests.mjs';

test('moves an exact status assertion and preserves the measured value assertion', () => {
  const source = `import { expect } from 'vitest';
expect(within(band).getByText('Retained evidence')).toBeInTheDocument();
expect(within(band).getByText('0.00 kWh')).toBeInTheDocument();`;
  const result = migrate(source);
  assert.equal(result.edits.length, 1);
  assert.match(result.output, /assertOperationalBriefDisclosure\(band, 'Retained evidence'\)/);
  assert.ok(result.output.includes("expect(within(band).getByText('0.00 kWh')).toBeInTheDocument();"));
  assert.equal(migrate(result.output).edits.length, 0);
});

test('preserves negative and substring matcher intent', () => {
  const result = migrate(`expect(within(brief()).queryByText('Returned evidence')).not.toBeInTheDocument();
expect(screen.getByTestId('summary')).not.toHaveTextContent('Retained source evidence');`);
  assert.equal(result.edits.length, 2);
  assert.match(result.output, /'Returned evidence', \{ absent: true \}/);
  assert.match(result.output, /'Retained source evidence', \{ absent: true, contains: true \}/);
});

test('leaves polling, existing drawer assertions and source notices for manual review', () => {
  const source = `await waitFor(() => expect(within(band).getByText('Retained evidence')).toBeInTheDocument());
expect(within(dialog).getByText('Retained evidence')).toBeInTheDocument();
expect(within(notice).getByText('Refresh paused')).toBeInTheDocument();`;
  const result = migrate(source);
  assert.equal(result.output, source);
  assert.equal(result.edits.length, 0);
  assert.equal(result.deferred.length, 3);
});

test('leaves unrelated text, query options, comments and test names untouched', () => {
  const source = `// expect(within(band).getByText('Retained evidence')).toBeInTheDocument();
it('Returned evidence', () => {
expect(within(band).getByText('Retained evidence', { selector: 'span' })).toBeInTheDocument();
expect(within(band).getByText('0')).toBeInTheDocument();
});`;
  assert.equal(migrate(source).output, source);
});

test('preserves CRLF, file docblocks and original test cases', () => {
  const source = `/** Contract. */\r\nimport { it } from 'vitest';\r\nit('keeps zero', () => {\r\nexpect(within(band).getByText('Returned evidence')).toBeInTheDocument();\r\n});\r\n`;
  const result = migrate(source);
  assert.ok(result.output.startsWith('/** Contract. */\r\nimport { assertOperationalBriefDisclosure }'));
  assert.ok(result.output.includes("it('keeps zero', () => {\r\n"));
  assert.equal(result.edits.length, 1);
});

test('defers generic source states and non-card scopes instead of changing their intent', () => {
  const source = `expect(within(chargingSourceRow()).getByText('Refreshing')).toBeInTheDocument();
expect(screen.getByRole('combobox')).toHaveTextContent('Refresh paused');
expect(within(source).getByText('Source unavailable')).toBeInTheDocument();`;
  const result = migrate(source);
  assert.equal(result.output, source);
  assert.equal(result.deferred.length, 3);
});

test('preserves non-rendering prop stubs but accepts wrappers around the real brief', () => {
  const assertion = "expect(within(brief).getByText('Retained evidence')).toBeInTheDocument();";
  const stub = `vi.mock('@/components/data-display', () => ({ OperationalBrief: props => <section>{props.statusLabel}</section> }));\n${assertion}`;
  assert.equal(migrate(stub).output, stub);
  assert.equal(migrate(stub).deferred.length, 1);
  const wrapper = `vi.mock('@/components/data-display', () => ({ OperationalBrief: props => <Actual.OperationalBrief {...props} /> }));\n${assertion}`;
  assert.equal(migrate(wrapper).edits.length, 1);
});

const valueReader = `function metricValue(region: HTMLElement, label: string) {
  const tile = within(region).getByText(label).closest('[data-operational-metric]');
  return tile?.querySelector('[data-operational-value]')?.textContent ?? '';
}`;

test('migrates unavailable values from proven DOM readers while preserving measured zero', () => {
  const source = `${valueReader}
expect(metricValue(kpiRegion(), 'Current SOH')).toBe('—');
expect(metricValue(kpiRegion(), 'Capacity')).toContain('—');
expect(metricValue(kpiRegion(), 'Cycles')).toBe('0');
expect(metricValue(kpiRegion(), 'Measured capacity')).not.toBe('—');`;
  const result = migrateMissingMetricTests(source);
  assert.equal(result.edits.length, 2);
  assert.match(result.output, /assertOperationalMetricUnavailable\(kpiRegion\(\), 'Current SOH'\)/);
  assert.ok(result.output.includes("expect(metricValue(kpiRegion(), 'Cycles')).toBe('0');"));
  assert.ok(result.output.includes("expect(metricValue(kpiRegion(), 'Measured capacity')).not.toBe('—');"));
  assert.equal(migrateMissingMetricTests(result.output).edits.length, 0);
});

test('does not rewrite arbitrary formatters, unproven selectors or polling assertions', () => {
  const source = `${valueReader}
expect(formatDuration(raw, 'h')).toBe('—');
await waitFor(() => expect(metricValue(band, 'Cycles')).toBe('—'));`;
  const result = migrateMissingMetricTests(source);
  assert.equal(result.output, source);
  assert.equal(result.deferred.length, 1);
});

test('adds the unavailable assertion to an existing utility import without duplication', () => {
  const source = `import { assertOperationalBriefDisclosure } from '@/test/operationalBriefAssertions';
${valueReader}
expect(metricValue(band, 'Capacity')).toBe('—');`;
  const result = migrateMissingMetricTests(source);
  assert.match(result.output, /import \{ assertOperationalMetricUnavailable, assertOperationalBriefDisclosure \}/);
  assert.equal(migrateMissingMetricTests(result.output).output, result.output);
});

test('moves only approved source contexts and preserves the at-least-one matcher', () => {
  const source = `expect(within(summary).getByText('Observed history window')).toBeInTheDocument();
expect(within(band).getAllByText('Built-in, admin-editable static 24-hour model').length).toBeGreaterThan(0);
expect(within(band).getByText('0.00 kWh')).toBeInTheDocument();`;
  assert.equal(migrate(source).edits.length, 0);
  const result = migrate(source, 'context.test.tsx', { contexts: true });
  assert.equal(result.edits.length, 2);
  assert.match(result.output, /'Observed history window', \{ region: 'drawer' \}/);
  assert.match(result.output, /allMatches: true, region: 'drawer'/);
  assert.ok(result.output.includes("expect(within(band).getByText('0.00 kWh')).toBeInTheDocument();"));
});

test('merges a new status helper with an existing unavailable helper import', () => {
  const source = `import { assertOperationalMetricUnavailable } from '@/test/operationalBriefAssertions';
expect(within(summary).getByText('Source available')).toBeInTheDocument();`;
  const result = migrate(source);
  assert.match(result.output, /import \{ assertOperationalBriefDisclosure, assertOperationalMetricUnavailable \}/);
  assert.equal(migrate(result.output).output, result.output);
});


test('resolves single-label readers only with a direct independent region', () => {
  for (const scope of ["kpiRegion()", "screen.getByRole('region', { name: 'Journey evidence and summary' })"]) {
    const reader = `function metricValue(label: string) {
      return within(${scope}).getByText(label).closest('[data-operational-metric]')
        ?.querySelector('[data-operational-value]')?.textContent ?? '';
    }`;
    const source = `${reader}
expect(metricValue('Capacity')).toBe('—');
expect(metricValue('Cycles')).toBe('0');
expect(metricValue('Measured')).not.toBe('—');`;
    const result = migrateMissingMetricTests(source);
    assert.equal(result.edits.length, 1);
    assert.ok(result.output.includes(`assertOperationalMetricUnavailable(${scope}, 'Capacity')`));
    assert.ok(result.output.includes("expect(metricValue('Cycles')).toBe('0');"));
    assert.ok(result.output.includes("expect(metricValue('Measured')).not.toBe('—');"));
    assert.equal(migrateMissingMetricTests(result.output).edits.length, 0);
  }
});

test('rejects label-dependent regions, local aliases, global queries and duplicate readers', () => {
  for (const scope of ["screen.getByRole('region', { name: label })", 'localRegion', 'findAnything()']) {
    const source = `function metricValue(label: string) {
      const localRegion = kpiRegion();
      return within(${scope}).getByText(label).closest('[data-operational-metric]')
        ?.querySelector('[data-operational-value]')?.textContent ?? '';
    }
expect(metricValue('Capacity')).toBe('—');`;
    assert.equal(migrateMissingMetricTests(source).output, source);
  }
  const duplicate = `${valueReader}\n${valueReader}\nexpect(metricValue(band, 'Capacity')).toBe('—');`;
  assert.equal(migrateMissingMetricTests(duplicate).output, duplicate);
  const global = `function metricValue(label: string) {
    return screen.getByText(label).closest('[data-operational-metric]')
      ?.querySelector('[data-operational-value]')?.textContent ?? '';
  }
expect(metricValue('Capacity')).toBe('—');`;
  assert.equal(migrateMissingMetricTests(global).output, global);
});
