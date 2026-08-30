/**
 * MarkdownRenderer — behavioural + hardening tests.
 *
 * `MarkdownRenderer` lazy-loads the real `react-markdown` + `remark-gfm`
 * bundle behind `React.lazy`, so this suite drives the REAL parser (no
 * network is involved — the markdown → HTML transform is pure) and asserts
 * the security-critical + presentational contract of every custom element
 * renderer the component registers:
 *
 *   1. Suspense fallback — the raw source is shown verbatim with whitespace
 *      preserved while the chunk loads, then swapped for parsed markdown.
 *      (This MUST be the first test: `React.lazy` caches the resolved chunk
 *      on the shared module-level lazy object, so the fallback is only
 *      observable on the very first render in the file.)
 *   2. Headings (h1/h2/h3), links (new-tab + `rel="noopener noreferrer"`
 *      hardening against reverse-tabnabbing), inline vs fenced code, lists
 *      (ul/ol), and GFM tables (which also proves remark-gfm is wired).
 *   3. Fenced code delegates to <CodeBlock> — language tag, single <pre>
 *      (the react-markdown <pre> is collapsed to a fragment), and a working
 *      copy-to-clipboard affordance.
 *   4. Security — a malicious assistant reply with raw <script>/<img onerror>
 *      is escaped to text, never mounted as live DOM (no rehype-raw).
 *   5. Null-safety — a null/undefined/empty source renders an empty surface
 *      instead of throwing.
 *
 * user-event is intentionally not a dependency of this repo, so the one
 * interaction (copy) goes through fireEvent, matching the sibling suites.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

import { MarkdownRenderer } from './MarkdownRenderer';

const MARKDOWN_LOAD_TIMEOUT_MS = 30_000;

/**
 * Render markdown and wait for the lazy `react-markdown` chunk to mount. The
 * resolved output lives inside the `.prose-chat` wrapper (the Suspense
 * fallback replaces that whole wrapper, so its presence marks resolution).
 */
async function renderMarkdown(source: string) {
  const utils = render(<MarkdownRenderer>{source}</MarkdownRenderer>);
  await waitFor(
    () =>
      expect(utils.container.querySelector('.prose-chat')).toBeInTheDocument(),
    { timeout: MARKDOWN_LOAD_TIMEOUT_MS },
  );
  return utils;
}

describe('MarkdownRenderer', () => {
  // ── loading state ────────────────────────────────────────────────────────
  // Runs first, before the shared lazy chunk resolves, so the fallback path
  // is actually exercised.
  it('shows the raw source verbatim while the markdown chunk loads, then swaps in parsed markdown', async () => {
    const { container } = render(
      <MarkdownRenderer>{'**bold**\nsecond line'}</MarkdownRenderer>,
    );

    // Fallback: raw markdown syntax is shown un-parsed, and the newline is
    // preserved by `whitespace-pre-wrap` (readability on slow connections).
    const fallback = container.querySelector('p.whitespace-pre-wrap');
    expect(fallback).not.toBeNull();
    expect(fallback?.textContent).toBe('**bold**\nsecond line');

    // Once the chunk resolves, the fallback is replaced by parsed markdown:
    // the `**` markers are gone and a real <strong> element exists.
    await waitFor(
      () => expect(container.querySelector('strong')).toBeInTheDocument(),
      { timeout: MARKDOWN_LOAD_TIMEOUT_MS },
    );
    expect(container.querySelector('strong')).toHaveTextContent('bold');
    expect(container.querySelector('p.whitespace-pre-wrap')).toBeNull();
  });

  // ── headings ─────────────────────────────────────────────────────────────
  it('renders h1/h2/h3 markdown as real, role-exposed heading elements', async () => {
    await renderMarkdown('# Title One\n\n## Title Two\n\n### Title Three');

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Title One');
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Title Two');
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Title Three');
  });

  // ── links (security hardening) ───────────────────────────────────────────
  it('opens links in a new tab with rel="noopener noreferrer" to block reverse-tabnabbing', async () => {
    await renderMarkdown('See the [Docs](https://example.com/guide) page.');

    const link = screen.getByRole('link', { name: 'Docs' });
    expect(link).toHaveAttribute('href', 'https://example.com/guide');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  // ── inline code ──────────────────────────────────────────────────────────
  it('renders inline code as a bare <code> without the CodeBlock chrome', async () => {
    const { container } = await renderMarkdown('Run `npm run dev` to start.');

    const inline = screen.getByText('npm run dev');
    expect(inline.tagName).toBe('CODE');
    // Inline code must NOT be promoted to a CodeBlock (no <pre>, no copy button).
    expect(container.querySelector('pre')).toBeNull();
    expect(container.querySelector('button')).toBeNull();
  });

  // ── fenced code → CodeBlock ──────────────────────────────────────────────
  it('routes fenced code to <CodeBlock> with the language tag, a single <pre>, and a working copy button', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    const { container } = await renderMarkdown('```ts\nconst a = 1;\n```');

    // Language hint extracted from the `language-ts` class.
    expect(screen.getByText('ts')).toBeInTheDocument();
    // The fenced code content is present...
    expect(container.textContent).toContain('const a = 1;');
    // ...inside exactly one <pre> (react-markdown's wrapping <pre> is collapsed
    // to a fragment so CodeBlock's own <pre> is the only one).
    expect(container.querySelectorAll('pre')).toHaveLength(1);

    // Copy affordance: icon-only button carries an accessible label and copies
    // the trailing-newline-trimmed source to the clipboard.
    const copyButton = within(container).getByRole('button', { name: 'Copy' });
    fireEvent.click(copyButton);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('const a = 1;'));
  });

  // ── lists ────────────────────────────────────────────────────────────────
  it('renders bullet and numbered markdown as styled <ul>/<ol> lists', async () => {
    const { container } = await renderMarkdown(
      '- one\n- two\n\n1. first\n2. second',
    );

    const bulleted = container.querySelector('ul.list-disc');
    const numbered = container.querySelector('ol.list-decimal');
    expect(bulleted).not.toBeNull();
    expect(numbered).not.toBeNull();
    expect(within(bulleted as HTMLElement).getAllByRole('listitem')).toHaveLength(2);
    expect(within(numbered as HTMLElement).getAllByRole('listitem')).toHaveLength(2);
  });

  // ── GFM tables ───────────────────────────────────────────────────────────
  it('renders GFM tables with header + body cells (proves remark-gfm is active)', async () => {
    await renderMarkdown('| Metric | Value |\n| ------ | ----- |\n| Range | 300 |');

    const table = screen.getByRole('table');
    expect(table).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Metric' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Value' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Range' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '300' })).toBeInTheDocument();
  });

  // ── security: raw HTML must not execute ──────────────────────────────────
  it('escapes raw HTML in the source instead of mounting live DOM (no rehype-raw)', async () => {
    const { container } = await renderMarkdown(
      'Hi <script>alert(1)</script> <img src=x onerror="steal()"> there',
    );

    // Neither the script nor the img is mounted as a live element...
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    // ...the payload is rendered as inert, escaped text.
    expect(container.textContent).toContain('<script>alert(1)</script>');
    expect(container.textContent).toContain('there');
  });

  // ── null-safety ──────────────────────────────────────────────────────────
  it('renders an empty surface (no throw) when given null / undefined / empty source', async () => {
    // Empty string.
    const empty = await renderMarkdown('');
    expect(empty.container.querySelector('.prose-chat')).toBeInTheDocument();

    // undefined slipping through the `string` contract from a JS caller.
    const undef = render(
      // @ts-expect-error — deliberately violating the prop type to prove the guard.
      <MarkdownRenderer>{undefined}</MarkdownRenderer>,
    );
    await waitFor(() =>
      expect(undef.container.querySelector('.prose-chat')).toBeInTheDocument(),
    );
    expect(undef.container.querySelector('.prose-chat')?.textContent).toBe('');

    // null slipping through.
    const nul = render(
      // @ts-expect-error — deliberately violating the prop type to prove the guard.
      <MarkdownRenderer>{null}</MarkdownRenderer>,
    );
    await waitFor(() =>
      expect(nul.container.querySelector('.prose-chat')).toBeInTheDocument(),
    );
    expect(nul.container.querySelector('.prose-chat')?.textContent).toBe('');
  });
});
