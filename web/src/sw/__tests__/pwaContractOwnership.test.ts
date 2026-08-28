/**
 * Parser contract for `scripts/check-pwa-contract.mjs`'s ownership check.
 *
 * The gate that guarantees the browser-offline announcement happens exactly
 * once is only as trustworthy as its ability to SEE every mount. Two earlier
 * versions were fail-open:
 *
 *  1. it asked two yes/no questions ("does ReloadPrompt mount it?", "does
 *     Layout not?"), so a mount added to any third file was invisible; then
 *  2. the whole-tree count that replaced it used a hand-rolled scanner that
 *     stripped string literals by tracking quote characters. Two constructs
 *     carry quotes without being string literals — raw JSX text
 *     (`<p>You're offline</p>`) and a regex literal (`/['"]/`) — and either
 *     desynchronised the scanner, deleting every mount that followed. In THIS
 *     corpus the real-world instances are all regex literals: three charging
 *     pages ended with an unbalanced quote state, so appended duplicates were
 *     reported as clean.
 *
 * The counter now parses with the TypeScript compiler (`ScriptKind.TSX`) and
 * matches exact `JsxSelfClosingElement` / `JsxOpeningElement` tag identifiers.
 * These cases pin that parse — both hazards synthetically, and the real
 * corpus through an AST-measured census plus a sentinel sweep — so the gate's
 * verdict means something.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import {
  countComponentMounts,
  findComponentMounts,
  isNonProductionSourceFile,
  listProductionSourceFiles,
  // @ts-expect-error — plain ESM build script, no type declarations.
} from '../../../scripts/check-pwa-contract.mjs';

const WEB_ROOT = join(__dirname, '..', '..', '..');
const SRC_ROOT = join(WEB_ROOT, 'src');

const count = (source: string, name = 'OfflineBanner', file = 'input.tsx'): number =>
  countComponentMounts(source, name, file) as number;

/** One valid, uniquely-named mount appended by the sentinel sweep. */
const PROBE_SOURCE = '\nexport const __Probe = () => <OfflineBanner />\n';

/**
 * A cache key distinct from every real file, re-used across sweep iterations
 * so the probe never evicts a memoised production AST and only one extra AST
 * is resident at a time.
 */
const PROBE_FILE = '__sentinel_probe__.tsx';

// ── Hazard census, measured on the AST rather than guessed from text ────────
//
// An earlier version of this file counted the two hazards with plain text
// regexes over the whole file. Those matched overwhelmingly inside COMMENTS
// (including this file's own prose about the hazards) and inside string
// literals, so the resulting `> 50` corpus thresholds were false evidence:
// they measured documentation, not syntax.
//
// The real question is whether the corpus contains quote-bearing `JsxText`
// and `RegularExpressionLiteral` NODES, which only the parser can answer.

const QUOTE_CHARS = /['"`]/;

interface HazardCensus {
  quoteBearingJsxText: string[];
  quoteBearingRegexLiteral: string[];
}

function hasQuoteBearingNodes(
  source: string,
  fileName: string,
): { jsxText: boolean; regexLiteral: boolean } {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    ts.ScriptKind.TSX,
  );

  let jsxText = false;
  let regexLiteral = false;
  const visit = (node: ts.Node): void => {
    if (!jsxText && ts.isJsxText(node) && QUOTE_CHARS.test(node.text)) jsxText = true;
    if (
      !regexLiteral
      && ts.isRegularExpressionLiteral(node)
      && QUOTE_CHARS.test(node.text)
    ) {
      regexLiteral = true;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);

  return { jsxText, regexLiteral };
}

let censusCache: HazardCensus | null = null;

/** Production `.tsx` files that really contain each hazard node type. */
function hazardCensus(): HazardCensus {
  if (censusCache !== null) return censusCache;

  const quoteBearingJsxText: string[] = [];
  const quoteBearingRegexLiteral: string[] = [];

  for (const file of (listProductionSourceFiles(SRC_ROOT) as string[]).filter((f) =>
    f.endsWith('.tsx'),
  )) {
    const { jsxText, regexLiteral } = hasQuoteBearingNodes(
      readFileSync(file, 'utf8'),
      file,
    );
    if (jsxText) quoteBearingJsxText.push(file);
    if (regexLiteral) quoteBearingRegexLiteral.push(file);
  }

  censusCache = { quoteBearingJsxText, quoteBearingRegexLiteral };
  return censusCache;
}

/**
 * The two constructs that made the previous scanner fail OPEN. Each asserts
 * that the mount AFTER the hazard is still seen.
 */
describe('fail-open regressions — hazards that used to swallow real mounts', () => {
  it('sees a mount after an apostrophe in raw JSX text', () => {
    const source = `
      export const A = () => (
        <div>
          <p>You're offline</p>
          <OfflineBanner />
        </div>
      )
    `;
    expect(count(source)).toBe(1);
  });

  it.each([
    ["don't", "<p>We don't cache mutations</p>"],
    ["it's", '<span>Showing what it&apos;s got — it\'s cached</span>'],
    ['double quote in text', '<p>The "offline" state</p>'],
    ['unmatched apostrophe', "<p>Owners' vehicles</p>"],
  ])('sees a mount after %s in JSX text', (_label, markup) => {
    const source = `export const A = () => (<div>${markup}<OfflineBanner /></div>)`;
    expect(count(source)).toBe(1);
  });

  it('sees TWO appended mounts after a JSX apostrophe — the duplicate the gate exists to catch', () => {
    const source = `
      export const C = () => (
        <>
          <p>It's fine</p>
          <OfflineBanner />
          <OfflineBanner />
        </>
      )
    `;
    expect(count(source)).toBe(2);
  });

  it('sees a mount after a regex literal containing quotes', () => {
    const source = `
      const quoted = /['"]/
      export const B = () => <OfflineBanner />
    `;
    expect(count(source)).toBe(1);
  });

  it('sees a mount after a regex containing a slash-slash sequence', () => {
    const source = String.raw`
      const proto = /^https?:\/\//
      export const B = () => <OfflineBanner />
    `;
    expect(count(source)).toBe(1);
  });

  it('sees a mount after a division expression that looks like a regex', () => {
    const source = `
      const ratio = width / height / 2
      export const B = () => <OfflineBanner />
    `;
    expect(count(source)).toBe(1);
  });
});

describe('constructs that must NOT count as mounts', () => {
  it('ignores line comments', () => {
    expect(count('// <OfflineBanner /> lives in the app-root host\nexport const x = 1')).toBe(0);
  });

  it('ignores block and JSDoc comments', () => {
    const source = `
      /* <OfflineBanner /> used to live here */
      /**
       * See <OfflineBanner /> in ReloadPrompt.tsx.
       */
      export const x = 1
    `;
    expect(count(source)).toBe(0);
  });

  it('ignores a mount inside a JSX comment expression', () => {
    const source = 'export const A = () => (<div>{/* <OfflineBanner /> */}</div>)';
    expect(count(source)).toBe(0);
  });

  it.each([
    ["single-quoted string", "const a = '<OfflineBanner />'"],
    ['double-quoted string', 'const b = "<OfflineBanner />"'],
    ['template literal', 'const c = `<OfflineBanner />`'],
    ['template with substitution', 'const d = `${x}<OfflineBanner />${y}`'],
    ['test assertion string', 'expect(html).toContain("<OfflineBanner")'],
  ])('ignores a %s', (_label, source) => {
    expect(count(source)).toBe(0);
  });

  it('ignores imports and re-exports', () => {
    expect(count("import { OfflineBanner } from './OfflineBanner'")).toBe(0);
    expect(count("export { OfflineBanner } from './OfflineBanner'")).toBe(0);
    expect(count('export { OfflineBanner }')).toBe(0);
  });

  it('ignores type positions and bare identifiers', () => {
    const source = `
      const C: typeof OfflineBanner = OfflineBanner
      type P = React.ComponentProps<typeof OfflineBanner>
      const el = createElement(OfflineBanner)
    `;
    expect(count(source)).toBe(0);
  });

  it('ignores a closing tag on its own', () => {
    expect(count('export const A = () => (<div></OfflineBanner></div>)')).toBe(0);
  });
});

describe('tag-name resolution', () => {
  it('counts a self-closing mount', () => {
    expect(count('export const A = () => <OfflineBanner />')).toBe(1);
  });

  it('counts a mount with props spread across lines', () => {
    const source = `
      export const A = () => (
        <OfflineBanner
          presentation="screen-reader-only"
        />
      )
    `;
    expect(count(source)).toBe(1);
  });

  it('counts a paired tag exactly once', () => {
    expect(count('export const A = () => <OfflineBanner>x</OfflineBanner>')).toBe(1);
  });

  it('counts each mount in a fragment', () => {
    expect(count('export const A = () => (<><OfflineBanner /><OfflineBanner /></>)')).toBe(2);
  });

  it('counts a mount nested inside another element', () => {
    const source = 'export const A = () => (<Layout><Slot><OfflineBanner /></Slot></Layout>)';
    expect(count(source)).toBe(1);
  });

  it('does not count a prefix collision', () => {
    const source = 'export const A = () => (<><OfflineBannerHost /><OfflineBanner2 /></>)';
    expect(count(source)).toBe(0);
  });

  it('does not count a member expression tag', () => {
    // `<Feedback.OfflineBanner />` is a different component reference; the
    // contract is about the bare identifier this codebase imports.
    const source = 'export const A = () => <Feedback.OfflineBanner />';
    expect(count(source)).toBe(0);
  });

  it('does not count a namespaced tag', () => {
    const source = 'export const A = () => <svg:OfflineBanner />';
    expect(count(source)).toBe(0);
  });

  it('does not treat a type assertion in a .ts file as JSX', () => {
    // In .ts, `<X>value` is a type assertion, not a mount.
    expect(count('const v = <OfflineBanner>unknownValue', 'OfflineBanner', 'x.ts')).toBe(0);
  });

  it('parses modern TSX syntax without giving up', () => {
    const source = `
      export const A = ({ items }: { items: string[] }) => (
        <>
          {items?.map((i) => <OfflineBanner key={i} />) ?? null}
          {cond ? <OfflineBanner /> : null}
        </>
      )
    `;
    expect(count(source)).toBe(2);
  });
});

describe('isNonProductionSourceFile', () => {
  it.each([
    'components/feedback/__tests__/ReloadPrompt.test.tsx',
    'components/feedback/OfflineBanner.test.tsx',
    'features/x/Something.spec.tsx',
    'test/visuallyHiddenContract.tsx',
    'components/__mocks__/Thing.tsx',
    'test-setup.ts',
  ])('excludes %s', (path) => {
    expect(isNonProductionSourceFile(path)).toBe(true);
  });

  it.each([
    'main.tsx',
    'App.tsx',
    'components/feedback/ReloadPrompt.tsx',
    'components/feedback/OfflineBanner.tsx',
    'components/layout/Layout.tsx',
  ])('includes %s', (path) => {
    expect(isNonProductionSourceFile(path)).toBe(false);
  });
});

describe('real source tree', () => {
  it('finds exactly one production mount of <OfflineBanner>, in the app-root host', () => {
    expect(findComponentMounts(SRC_ROOT, 'OfflineBanner')).toEqual([
      { file: 'src/components/feedback/ReloadPrompt.tsx', count: 1 },
    ]);
  });

  it('finds exactly one production mount of <ReloadPrompt>, in main.tsx', () => {
    // Checking only *inside* main.tsx was the second fail-open gap: a second
    // host anywhere else duplicates every live region and lifecycle
    // subscription while main.tsx still reads as correct.
    expect(findComponentMounts(SRC_ROOT, 'ReloadPrompt')).toEqual([
      { file: 'src/main.tsx', count: 1 },
    ]);
  });

  it('does not count a component definition file as a mount of itself', () => {
    const bannerFiles = (
      findComponentMounts(SRC_ROOT, 'OfflineBanner') as Array<{ file: string }>
    ).map((m) => m.file);
    const hostFiles = (
      findComponentMounts(SRC_ROOT, 'ReloadPrompt') as Array<{ file: string }>
    ).map((m) => m.file);

    // Defining a component is not mounting it. (ReloadPrompt.tsx legitimately
    // appears in the OfflineBanner list — it is the one place that mounts it.)
    expect(bannerFiles).not.toContain('src/components/feedback/OfflineBanner.tsx');
    expect(hostFiles).not.toContain('src/components/feedback/ReloadPrompt.tsx');
  });

  it('walks the production tree while skipping tests and fixtures', () => {
    const files = listProductionSourceFiles(SRC_ROOT) as string[];

    expect(files.some((f) => f.includes('.test.'))).toBe(false);
    expect(files.some((f) => f.includes('__tests__'))).toBe(false);
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((f) => f.endsWith('main.tsx'))).toBe(true);
    expect(files.some((f) => f.endsWith('App.tsx'))).toBe(true);
  });

  /**
   * Sentinel sweep over the whole production corpus.
   *
   * The previous version of this case asserted `Number.isInteger(n)`, which is
   * true of `0` — exactly the value the broken scanner returned for a file
   * whose mounts it had swallowed. It could never have failed, and so it never
   * would have caught the shipped defect.
   *
   * The sweep instead appends ONE known-valid mount to every production `.tsx`
   * and requires the count to rise by exactly one.
   *
   * Measured discrimination (not a guess — see the report for the run): under
   * the deleted scanner this sweep reports 3 mismatches out of 1,863 files,
   * where the appended probe is swallowed entirely (`base 0 → probed 0`).
   * Only files whose quote desync is still *open* at EOF fail an
   * end-of-file probe; the mid-file hazards that swallow a mount in the middle
   * of a component are covered exhaustively by the synthetic cases at the top
   * of this file. Three real files failing is enough to make the sweep a
   * genuine discriminator rather than a tautology.
   *
   * The probe is parsed under its own cache key so it never evicts the real
   * file's memoised AST, and that single key is re-used across iterations so
   * only one extra AST is resident at a time. Measured at ~3.4 s for 1,863
   * files.
   */
  it('sentinel sweep: appending one mount to any production TSX raises its count by exactly one', () => {
    const files = (listProductionSourceFiles(SRC_ROOT) as string[]).filter((f) =>
      f.endsWith('.tsx'),
    );
    expect(files.length).toBeGreaterThan(500);

    const mismatches: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const base = count(source, 'OfflineBanner', file);
      const probed = count(source + PROBE_SOURCE, 'OfflineBanner', PROBE_FILE);

      if (probed !== base + 1) {
        mismatches.push(
          `${relative(WEB_ROOT, file)} — base ${base}, after probe ${probed} (expected ${base + 1})`,
        );
      }
    }

    expect(mismatches).toEqual([]);
  });

  /**
   * Corpus representativeness, measured on the AST.
   *
   * Thresholds are deliberately "nonzero" rather than pinned counts: the exact
   * numbers today are 2 quote-bearing `JsxText` files and 4 quote-bearing
   * `RegularExpressionLiteral` files, and pinning those would break on any
   * unrelated edit. Nonzero is the property that matters — it is what makes
   * the sentinel sweep a test of the hazard rather than of a benign corpus.
   *
   * Note what is NOT claimed: there are currently **zero** apostrophe-bearing
   * `JsxText` nodes anywhere in production source. The apostrophe hazard is
   * real as a language construct and is covered by the synthetic cases above,
   * but this corpus does not exercise it — the real-world instances are all
   * regex literals.
   */
  it('the corpus contains the hazard NODE types, so the sweep is not vacuous', () => {
    const { quoteBearingJsxText, quoteBearingRegexLiteral } = hazardCensus();

    expect(quoteBearingJsxText.length).toBeGreaterThan(0);
    expect(quoteBearingRegexLiteral.length).toBeGreaterThan(0);
  });

  describe('the census measures syntax, not prose', () => {
    // The regression this guards: a text regex counted the word "regex" and
    // the phrase `<p>You're offline</p>` wherever they appeared — including
    // in this file's own comments — and reported hundreds of "hazard" files.
    it('ignores quotes inside comments', () => {
      const source = `
        // a comment with 'quotes' and /['"]/ in it
        /** JSDoc with "quotes" and <p>You're offline</p> */
        export const A = () => <div>plain</div>
      `;
      expect(hasQuoteBearingNodes(source, 'x.tsx')).toEqual({
        jsxText: false,
        regexLiteral: false,
      });
    });

    it('ignores quotes inside string and template literals', () => {
      const source = `
        const a = "he said 'hi'"
        const b = \`nested "quotes"\`
        export const A = () => <div>{a}{b}</div>
      `;
      expect(hasQuoteBearingNodes(source, 'x.tsx')).toEqual({
        jsxText: false,
        regexLiteral: false,
      });
    });

    it('detects a genuine quote-bearing JsxText node', () => {
      const source = `export const A = () => <p>The "offline" state</p>`;
      expect(hasQuoteBearingNodes(source, 'x.tsx').jsxText).toBe(true);
    });

    it('detects a genuine quote-bearing regex literal', () => {
      const source = `const q = /['"]/\nexport const A = () => <div />`;
      expect(hasQuoteBearingNodes(source, 'x.tsx').regexLiteral).toBe(true);
    });

    it('does not mistake a division expression for a regex literal', () => {
      const source = `const r = a / b / c\nexport const A = () => <div />`;
      expect(hasQuoteBearingNodes(source, 'x.tsx').regexLiteral).toBe(false);
    });
  });

  it('sees a probe appended to every file that really carries a hazard node', () => {
    const { quoteBearingJsxText, quoteBearingRegexLiteral } = hazardCensus();
    const hazardFiles = [
      ...new Set([...quoteBearingJsxText, ...quoteBearingRegexLiteral]),
    ];
    expect(hazardFiles.length).toBeGreaterThan(0);

    for (const file of hazardFiles) {
      const source = readFileSync(file, 'utf8');
      const base = count(source, 'OfflineBanner', file);
      expect(
        count(source + PROBE_SOURCE, 'OfflineBanner', PROBE_FILE),
        `${relative(WEB_ROOT, file)} swallowed the probe`,
      ).toBe(base + 1);
    }
  });

  it('sentinel sweep holds for the real files the deleted scanner actually swallowed', () => {
    // Empirically identified by re-running the sweep against the deleted
    // scanner. All three carry a quote-bearing REGEX LITERAL (not an
    // apostrophe — there are none in JsxText anywhere) that left the scanner's
    // quote state unbalanced at EOF, so an appended probe was consumed and the
    // gate reported clean (`base 0 → probed 0`). Pinned by name so the
    // regression stays addressable if the parser is ever swapped again.
    const swallowedByOldScanner = [
      join(SRC_ROOT, 'features', 'charging', 'pages', 'TeslaChargingHistoryPage.tsx'),
      join(SRC_ROOT, 'features', 'charging', 'pages', 'TeslaChargingSessionsMap.tsx'),
      join(SRC_ROOT, 'features', 'charging', 'pages', 'TeslaChargingSessionsPage.tsx'),
    ];

    for (const file of swallowedByOldScanner) {
      const source = readFileSync(file, 'utf8');
      // The cause, asserted rather than assumed.
      expect(hasQuoteBearingNodes(source, file).regexLiteral).toBe(true);

      const base = count(source, 'OfflineBanner', file);
      expect(base).toBe(0);
      expect(count(source + PROBE_SOURCE, 'OfflineBanner', PROBE_FILE)).toBe(1);
    }
  });
});

/**
 * Mutation cases. Each is a defect an earlier version of the gate passed;
 * they run against synthetic sources so the real tree is never touched.
 */
describe('mutation coverage — defects the gate must reject', () => {
  it('detects a second <OfflineBanner> in an unrelated third file', () => {
    const newShell = `
      import { OfflineBanner } from '@/components/feedback'
      export function KioskShell() {
        return <div><OfflineBanner /></div>
      }
    `;
    expect(count(newShell)).toBe(1);
  });

  it('detects a duplicate appended after a JSX apostrophe in a real-shaped file', () => {
    const realShaped = `
      export function Card() {
        return (
          <section>
            <h2>You're offline</h2>
            <p>We'll retry when you reconnect.</p>
          </section>
        )
      }

      export const __Duplicate = () => <OfflineBanner />
    `;
    expect(count(realShaped)).toBe(1);
  });

  it('detects the root host being deleted from main.tsx (import survives)', () => {
    const mainWithoutHost = `
      import ReloadPrompt from './components/feedback/ReloadPrompt'
      ReactDOM.createRoot(el).render(<App />)
    `;
    expect(count(mainWithoutHost, 'ReloadPrompt')).toBe(0);
  });

  it('detects a second <ReloadPrompt /> host added to App.tsx', () => {
    const appWithHost = `
      export default function App() {
        return (
          <>
            <ContextMenuRoot />
            <ReloadPrompt />
            <Routes />
          </>
        )
      }
    `;
    expect(count(appWithHost, 'ReloadPrompt')).toBe(1);
  });

  it('detects a duplicated root host in one file', () => {
    expect(count('export const A = () => (<><ReloadPrompt /><ReloadPrompt /></>)', 'ReloadPrompt')).toBe(2);
  });

  it('is not satisfied by a commented-out mount', () => {
    const commentedOut = `
      export function Host() {
        // <OfflineBanner />
        return null
      }
    `;
    expect(count(commentedOut)).toBe(0);
  });
});
