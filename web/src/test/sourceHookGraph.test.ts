import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { sourceHookCalls } from './sourceHookGraph';

const root = path.resolve(process.cwd(), 'src');
const feature = 'features/example';
const entry = `${feature}/pages/ExamplePage.tsx`;
const rangeModule = path.join(root, 'hooks', 'useRangeState.ts');
const rangeImport = "import { useRangeState } from '@/hooks/useRangeState';";

function fixture(files: Record<string, string>, options: { maxNodes?: number; maxDepth?: number } = {}) {
  const sources = new Map(Object.entries({
    'hooks/useRangeState.ts': 'export function useRangeState() {}',
    'hooks/useUrlState.ts': 'export function useUrlString() {}',
    ...files,
  }).map(([file, text]) => [path.resolve(root, file), text]));
  return sourceHookCalls(path.resolve(root, entry), {
    sourceRoot: root,
    readSource: (file) => sources.get(file),
    ...options,
  });
}

const hasRange = (calls: ReturnType<typeof fixture>) =>
  calls.some((call) => call.name === 'useRangeState' && call.module === rangeModule);

describe('sourceHookCalls', () => {
  it('recognizes actual direct hook calls, including generic calls', () => {
    expect(hasRange(fixture({
      [entry]: `${rangeImport} export default function ExamplePage() { useRangeState<string>(); }`,
    }))).toBe(true);
  });

  it('follows nested composed controllers through relative and @ imports with renamed bindings', () => {
    const calls = fixture({
      [entry]: `import { useController as controller } from '../hooks/useController';
        export default function ExamplePage() { controller(); }`,
      [`${feature}/hooks/useController.ts`]: `import { useFilters as filters } from '@/features/example/hooks/useFilters';
        export function useController() { filters(); }`,
      [`${feature}/hooks/useFilters.ts`]: `${rangeImport}
        import { useUrlString as url } from '@/hooks/useUrlState';
        export function useFilters() { useRangeState(); url('q'); }`,
    });
    expect(hasRange(calls)).toBe(true);
    expect(calls).toContainEqual({ name: 'useUrlString', module: path.join(root, 'hooks', 'useUrlState.ts') });
  });

  it('follows named hook re-exports and directory index resolution', () => {
    expect(hasRange(fixture({
      [entry]: `import { useController } from '../hooks';
        export default function ExamplePage() { useController(); }`,
      [`${feature}/hooks/index.ts`]: "export { useInner as useController } from './useInner';",
      [`${feature}/hooks/useInner.ts`]: `${rangeImport} export function useInner() { useRangeState(); }`,
    }))).toBe(true);
  });

  it('follows default controller imports and arrow-function exports', () => {
    expect(hasRange(fixture({
      [entry]: `import controller from '../hooks/useController';
        const ExamplePage = () => { controller(); }; export default ExamplePage;`,
      [`${feature}/hooks/useController.ts`]: `${rangeImport}
        const useController = () => { useRangeState(); }; export default useController;`,
    }))).toBe(true);
  });

  it('supports a named entry surface when it has no default export', () => {
    expect(hasRange(fixture({
      [entry]: `${rangeImport} export function ExamplePage() { useRangeState(); }`,
    }))).toBe(true);
  });

  it('follows locally invoked hooks but not unrelated local functions', () => {
    expect(hasRange(fixture({
      [entry]: `${rangeImport} function useController() { useRangeState(); }
        export default function ExamplePage() { useController(); }`,
    }))).toBe(true);
  });

  it('follows a rendered same-module page body without scanning unused bodies', () => {
    expect(hasRange(fixture({
      [entry]: `${rangeImport} function PageBody() { useRangeState(); return null; }
        export default function ExamplePage() { return <PageBody />; }`,
    }))).toBe(true);
    expect(hasRange(fixture({
      [entry]: `${rangeImport} function UnusedBody() { useRangeState(); return null; }
        export default function ExamplePage() { return <div />; }`,
    }))).toBe(false);
  });

  it('recognizes namespace hook bindings with renamed namespaces', () => {
    expect(hasRange(fixture({
      [entry]: `import * as controls from '../hooks/useController';
        export default function ExamplePage() { controls.useController(); }`,
      [`${feature}/hooks/useController.ts`]: `import * as range from '@/hooks/useRangeState';
        export function useController() { range.useRangeState(); }`,
    }))).toBe(true);
  });

  it('does not count unused direct or controller imports', () => {
    expect(hasRange(fixture({
      [entry]: `${rangeImport} import { useController } from '../hooks/useController';
        export default function ExamplePage() { return null; }`,
      [`${feature}/hooks/useController.ts`]: `${rangeImport} export function useController() { useRangeState(); }`,
    }))).toBe(false);
  });

  it('does not count comments, strings, template text, or a hook name reference', () => {
    expect(hasRange(fixture({
      [entry]: `${rangeImport} export default function ExamplePage() {
        // useRangeState();
        /* useRangeState(); */
        const text = "useRangeState()";
        const template = \`useRangeState()\`;
        return [text, template, useRangeState];
      }`,
    }))).toBe(false);
  });

  it('does not borrow calls from unrelated exports or module-level invocations', () => {
    expect(hasRange(fixture({
      [entry]: `import { useController } from '../hooks/useController';
        ${rangeImport} useRangeState();
        export function UnrelatedPage() { useRangeState(); }
        export default function ExamplePage() { useController(); }`,
      [`${feature}/hooks/useController.ts`]: `${rangeImport} useRangeState();
        export function useUnrelated() { useRangeState(); }
        export function useController() { return null; }`,
    }))).toBe(false);
    expect(hasRange(fixture({
      [entry]: `${rangeImport} export function ExamplePage() { useRangeState(); }
        export default function ActualEntry() { return null; }`,
    }))).toBe(false);
  });

  it('does not count uninvoked nested functions or callbacks', () => {
    expect(hasRange(fixture({
      [entry]: `${rangeImport} export default function ExamplePage() {
        function useUninvoked() { useRangeState(); }
        const callback = () => useRangeState();
        return [callback, useUninvoked];
      }`,
    }))).toBe(false);
  });

  it('resolves lexical bindings rather than counting shadowed imported hook names', () => {
    expect(hasRange(fixture({
      [entry]: `${rangeImport} export default function ExamplePage() {
        const useRangeState = () => null; useRangeState();
      }`,
    }))).toBe(false);
  });

  it('does not follow imported components, even when invoked as functions', () => {
    expect(hasRange(fixture({
      [entry]: `import { Panel } from '../components/Panel';
        export default function ExamplePage() { return Panel(); }`,
      [`${feature}/components/Panel.tsx`]: `${rangeImport} export function Panel() { useRangeState(); }`,
    }))).toBe(false);
    expect(hasRange(fixture({
      [entry]: `import { Panel } from '../components/Panel';
        export default function ExamplePage() { return <Panel />; }`,
      [`${feature}/components/Panel.tsx`]: `${rangeImport} export function Panel() { useRangeState(); }`,
    }))).toBe(false);
    expect(hasRange(fixture({
      [entry]: `import useController from '../components/Panel';
        export default function ExamplePage() { useController(); }`,
      [`${feature}/components/Panel.tsx`]: `${rangeImport} export default function Panel() { useRangeState(); }`,
    }))).toBe(false);
  });

  it('does not borrow range ownership from shared settings or other features', () => {
    expect(hasRange(fixture({
      [entry]: `import { useSettings } from '@/hooks/useSettings';
        import { useOther } from '@/features/other/hooks/useOther';
        export default function ExamplePage() { useSettings(); useOther(); }`,
      'hooks/useSettings.ts': `${rangeImport} export function useSettings() { useRangeState(); }`,
      'features/other/hooks/useOther.ts': `${rangeImport} export function useOther() { useRangeState(); }`,
    }))).toBe(false);
  });

  it('does not confuse unrelated object methods or type-only imports with hook bindings', () => {
    expect(hasRange(fixture({
      [entry]: `import type { useRangeState } from '@/hooks/useRangeState';
        export default function ExamplePage() {
          const object = { useRangeState: () => null }; object.useRangeState();
        }`,
    }))).toBe(false);
  });

  it('does not grant canonical authority to a same-named feature hook', () => {
    expect(hasRange(fixture({
      [entry]: `import { useRangeState } from '../hooks/fake';
        export default function ExamplePage() { useRangeState(); }`,
      [`${feature}/hooks/fake.ts`]: 'export function useRangeState() {}',
    }))).toBe(false);
  });

  it('terminates a hook cycle without inventing ownership', () => {
    expect(hasRange(fixture({
      [entry]: `import { useA } from '../hooks/useA'; export default function ExamplePage() { useA(); }`,
      [`${feature}/hooks/useA.ts`]: "import { useB } from './useB'; export function useA() { useB(); }",
      [`${feature}/hooks/useB.ts`]: "import { useA } from './useA'; export function useB() { useA(); }",
    }))).toBe(false);
  });

  it('finds real ownership inside a cycle and deduplicates repeated calls', () => {
    const calls = fixture({
      [entry]: `import { useA } from '../hooks/useA'; export default function ExamplePage() { useA(); useA(); }`,
      [`${feature}/hooks/useA.ts`]: "import { useB } from './useB'; export function useA() { useB(); }",
      [`${feature}/hooks/useB.ts`]: `${rangeImport}
        import { useA } from './useA'; export function useB() { useA(); useRangeState(); }`,
    });
    expect(hasRange(calls)).toBe(true);
    expect(calls.filter((call) => call.module === rangeModule)).toHaveLength(1);
  });

  it('fails closed when the graph exceeds its node or depth budget', () => {
    const files = {
      [entry]: `import { useA } from '../hooks/useA'; export default function ExamplePage() { useA(); }`,
      [`${feature}/hooks/useA.ts`]: `${rangeImport} export function useA() { useRangeState(); }`,
    };
    expect(() => fixture(files, { maxNodes: 1 })).toThrow('exceeds audit bounds');
    expect(() => fixture(files, { maxDepth: 0 })).toThrow('exceeds audit bounds');
  });
});
