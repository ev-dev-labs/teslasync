import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';
import { auditFile, createFrameResolver } from '../audit-chart-frame.mjs';

const root = mkdtempSync(path.join(tmpdir(), 'teslasync-chart-frame-'));
const sourceRoot = path.join(root, 'src');
const script = fileURLToPath(new URL('../audit-chart-frame.mjs', import.meta.url));
const write = (name, source) => {
  const file = path.join(sourceRoot, name);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, source);
  return file;
};
write('components/charts/ChartContainer.tsx', 'export const ChartContainer = forwardRef(({ children }, ref) => <figure ref={ref}>{children}</figure>);');
write('components/charts/EmbeddedChart.tsx', 'export function EmbeddedChart({ children }) { return <figure>{children}</figure>; }');
write('components/charts/index.ts', 'export { ChartContainer } from "./ChartContainer"; export { EmbeddedChart } from "./EmbeddedChart";');
after(() => rmSync(root, { recursive: true }));

function audit(name, source) {
  const file = write(`features/${name}.tsx`, source);
  return auditFile(file, createFrameResolver(sourceRoot));
}

test('the command exits non-zero when a raw chart bypasses its frame', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'teslasync-chart-frame-cli-'));
  try {
    const features = path.join(directory, 'src', 'features');
    mkdirSync(features, { recursive: true });
    writeFileSync(path.join(features, 'Raw.tsx'), 'const chart = <ResponsiveContainer><LineChart /></ResponsiveContainer>;');
    const result = spawnSync(process.execPath, [script], { cwd: directory, encoding: 'utf8' });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /raw feature charts/);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test('recognizes an aliased canonical frame through its category barrel', () => {
  const result = audit('direct', `
    import { ChartContainer as Frame } from '@/components/charts';
    export function Page() { return <Frame><ResponsiveContainer /></Frame>; }
  `);
  assert.equal(result.framed, 1);
  assert.equal(result.offenders.length, 0);
});

test('proves nested adapters through re-exports and rest-prop forwarding', () => {
  write('components/layout/ChartCard.tsx', `
    import { EmbeddedChart } from '@/components/charts';
    export function ChartCard({ children, ...props }) {
      return <section><EmbeddedChart {...props}>{children}</EmbeddedChart></section>;
    }
  `);
  write('components/layout/index.ts', 'export { ChartCard as Card } from "./ChartCard";');
  write('features/Trend.tsx', `
    import { Card } from '@/components/layout';
    export function Trend({ loading, ...chart }) {
      if (loading) return <section>Loading</section>;
      return <Card {...chart} />;
    }
  `);
  const result = audit('adapter', `
    import { Trend } from './Trend';
    export function Page() { return <Trend>{() => <ResponsiveContainer />}</Trend>; }
  `);
  assert.equal(result.framed, 1);
  assert.equal(result.offenders.length, 0);
});

test('recognizes explicit props.children and children attribute forwarding', () => {
  write('features/Explicit.tsx', `
    import { ChartContainer } from '@/components/charts';
    export function Explicit(props) { return <ChartContainer children={props.children} />; }
  `);
  const result = audit('explicitCaller', `
    import { Explicit } from './Explicit';
    export function Page() { return <Explicit><ResponsiveContainer /></Explicit>; }
  `);
  assert.equal(result.framed, 1);
});

test('does not accept a spoofed canonical component name', () => {
  const result = audit('spoof', `
    function ChartContainer({ children }) { return <div>{children}</div>; }
    export function Page() { return <ChartContainer><ResponsiveContainer /></ChartContainer>; }
  `);
  assert.equal(result.framed, 0);
  assert.equal(result.offenders.length, 1);
});

test('does not let an unrelated framed sibling conceal raw forwarded children', () => {
  write('features/Misleading.tsx', `
    import { ChartContainer } from '@/components/charts';
    export function Misleading({ children }) {
      return <><ChartContainer><span>Other chart</span></ChartContainer><div>{children}</div></>;
    }
  `);
  const result = audit('misleadingCaller', `
    import { Misleading } from './Misleading';
    export function Page() { return <Misleading><ResponsiveContainer /></Misleading>; }
  `);
  assert.equal(result.framed, 0);
  assert.equal(result.offenders.length, 1);
});

test('rejects adapters that duplicate children outside their real frame', () => {
  write('features/Duplicate.tsx', `
    import { EmbeddedChart } from '@/components/charts';
    export function Duplicate({ children }) {
      return <><EmbeddedChart>{children}</EmbeddedChart><div>{children}</div></>;
    }
  `);
  const result = audit('duplicateCaller', `
    import { Duplicate } from './Duplicate';
    export function Page() { return <Duplicate><ResponsiveContainer /></Duplicate>; }
  `);
  assert.equal(result.framed, 0);
});

test('does not treat props without children as child forwarding', () => {
  write('features/Dropped.tsx', `
    import { ChartContainer } from '@/components/charts';
    export function Dropped({ children, ...props }) { return <ChartContainer {...props} />; }
  `);
  const result = audit('droppedCaller', `
    import { Dropped } from './Dropped';
    export function Page() { return <Dropped><ResponsiveContainer /></Dropped>; }
  `);
  assert.equal(result.framed, 0);
});

test('does not certify an adapter from an unused nested helper', () => {
  write('features/Unused.tsx', `
    import { ChartContainer } from '@/components/charts';
    export function Unused({ children }) {
      const helper = () => <ChartContainer>{children}</ChartContainer>;
      return <section>Unrelated content</section>;
    }
  `);
  const result = audit('unusedCaller', `
    import { Unused } from './Unused';
    export function Page() { return <Unused><ResponsiveContainer /></Unused>; }
  `);
  assert.equal(result.framed, 0);
});

test('rejects cyclic re-exports without overflowing the resolver', () => {
  write('features/cycleA.ts', 'export { Frame } from "./cycleB";');
  write('features/cycleB.ts', 'export { Frame } from "./cycleA";');
  const result = audit('cycle', `
    import { Frame } from './cycleA';
    export function Page() { return <Frame><ResponsiveContainer /></Frame>; }
  `);
  assert.equal(result.framed, 0);
});
