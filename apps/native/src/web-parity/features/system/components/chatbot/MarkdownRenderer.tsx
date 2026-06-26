// Native parity port of
// web/src/features/system/components/chatbot/MarkdownRenderer.tsx.
//
// The web source renders an assistant chat message as sanitized markdown. It
// lazy-loads `react-markdown` + `remark-gfm` behind `React.lazy()` (so the
// chatbot bundle stays under the web bundle-size budget) and supplies a
// `components` map that re-styles code / pre / a / ul / ol / h1-h3 / table /
// th / td. While the lazy chunk loads, a `<Suspense>` fallback shows the raw
// text with `whitespace-pre-wrap`.
//
// None of that infrastructure exists in React Native:
//   * `react-markdown` + `remark-gfm` are DOM renderers (they emit HTML
//     elements through rehype) and are NOT in the apps/native dependency set —
//     importing them is forbidden by the conversion contract. The whole point
//     of the component (turn a markdown string into styled, sanitized content)
//     is reproduced here with a dependency-free, native-safe markdown renderer
//     built from React Native primitives + existing tokens, NOT an "unavailable"
//     stub. It supports the same constructs the web `components` map styled:
//     ATX headings (h1-h3), unordered/ordered lists, GFM pipe tables, links
//     (opened via `Linking.openURL`, the native analogue of
//     `target="_blank" rel="noopener noreferrer"`), fenced code blocks
//     (delegated to the inlined `CodeBlockView`), inline code, and `**bold**`
//     / `*italic*` / `~~strike~~` emphasis.
//   * `React.lazy` + `Suspense` + the bundle-split exist only because of the
//     browser bundle-size budget; Metro bundles the native app statically, so
//     the indirection collapses to a synchronous render. The fallback's
//     raw-text-readability intent is preserved for the empty/unparseable case.
//   * Sanitization parity is inherent: this renderer never interprets raw HTML
//     (there is no DOM, no `rehype-raw`), so an assistant reply containing
//     `<script>alert(1)</script>` renders as plain escaped text inside a
//     `<Text>` — exactly the web's safe-by-default guarantee.
//   * The sibling `./CodeBlock` web component (a `<pre><code>` with a language
//     tag header + shared `CopyButton`) is NOT imported (it is its own
//     conversion). Mirroring how sibling native ports inline the pieces they
//     need, a native `CodeBlockView` is inlined here. Its copy affordance maps
//     to a clipboard control gated behind a registerable writer — native parity
//     ships no clipboard module, so the control renders disabled until a host
//     registers one and never claims success without a real write.
//
// No DOM, no react-markdown/remark, no Recharts/Leaflet, and no web UI
// components are imported.

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { getSemanticIconDefinition } from '../../../../../components/icons/SemanticIcon';
import { AppText } from '../../../../../components/ui/AppText';
import { colors, spacing } from '../../../../../theme/tokens';

type NativeTFunction = (key: string, fallback: string) => string;

// Native parity ships no i18n runtime, so this returns the supplied fallback.
// The web `MarkdownRenderer` itself has no i18n strings; the only user-facing
// labels here are the inlined copy affordance's (the web `./CodeBlock` renders
// them through the shared `CopyButton`), kept behind the same key/fallback
// shape the sibling devtools ports use.
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

// ---------------------------------------------------------------------------
// Clipboard provider registry — mirrors the sibling devtools native ports
// (UrlEncoder / HashCalculator / BackendTool). The native build ships no
// clipboard module, so copy stays a no-op (and the affordance renders disabled)
// until a host registers a real writer. Exposing the setter keeps the
// affordance honest: it only flips to "Copied" after a write resolves.
// ---------------------------------------------------------------------------
type ClipboardWriter = (text: string) => Promise<void> | void;
let clipboardWriter: ClipboardWriter | null = null;

export function registerChatMarkdownClipboardWriter(
  writer: ClipboardWriter | null,
): () => void {
  clipboardWriter = writer;
  return () => {
    if (clipboardWriter === writer) {
      clipboardWriter = null;
    }
  };
}

// Repo-canonical native stand-ins for the lucide copy / check glyphs the shared
// web CopyButton swaps between (`Copy` -> `Check`). Resolved once at module
// scope.
const COPY_GLYPH = getSemanticIconDefinition('copy').glyph;
const COPIED_GLYPH = getSemanticIconDefinition('success').glyph;

// ---------------------------------------------------------------------------
// Block model + parser. A small, dependency-free CommonMark/GFM subset covering
// exactly the constructs the web `components` map re-styled.
// ---------------------------------------------------------------------------
type HeadingBlock = { type: 'heading'; level: 1 | 2 | 3; text: string };
type CodeFenceBlock = { type: 'code'; lang: string; text: string };
type ListBlock = { type: 'list'; ordered: boolean; items: string[] };
type TableBlock = { type: 'table'; header: string[]; rows: string[][] };
type ParagraphBlock = { type: 'paragraph'; text: string };
type MarkdownBlock =
  | HeadingBlock
  | CodeFenceBlock
  | ListBlock
  | TableBlock
  | ParagraphBlock;

const FENCE_RE = /^```\s*([\w-]*)\s*$/;
const FENCE_CLOSE_RE = /^```\s*$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const UL_RE = /^\s*[-*+]\s+(.*)$/;
const OL_RE = /^\s*\d+[.)]\s+(.*)$/;
const TABLE_DIVIDER_RE = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function splitTableRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) {
    s = s.slice(1);
  }
  if (s.endsWith('|')) {
    s = s.slice(0, -1);
  }
  return s.split('|').map((cell) => cell.trim());
}

function isTableStart(lines: string[], idx: number): boolean {
  return (
    idx + 1 < lines.length &&
    lines[idx].includes('|') &&
    TABLE_DIVIDER_RE.test(lines[idx + 1])
  );
}

function isBlockBoundary(lines: string[], idx: number): boolean {
  const line = lines[idx];
  return (
    line.trim() === '' ||
    FENCE_RE.test(line) ||
    HEADING_RE.test(line) ||
    UL_RE.test(line) ||
    OL_RE.test(line) ||
    isTableStart(lines, idx)
  );
}

function parseBlocks(source: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block — collapses the web <pre><code> + CodeBlock delegation.
    const fence = FENCE_RE.exec(line);
    if (fence) {
      const lang = fence[1] ?? '';
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE_CLOSE_RE.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1; // skip the closing fence (or run off the end)
      blocks.push({ type: 'code', lang, text: body.join('\n') });
      continue;
    }

    if (line.trim() === '') {
      i += 1;
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      const level = Math.min(heading[1].length, 3) as 1 | 2 | 3;
      blocks.push({ type: 'heading', level, text: heading[2].trim() });
      i += 1;
      continue;
    }

    if (isTableStart(lines, i)) {
      const header = splitTableRow(line);
      const rows: string[][] = [];
      i += 2; // skip the header row and the `---|---` divider
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(splitTableRow(lines[i]));
        i += 1;
      }
      blocks.push({ type: 'table', header, rows });
      continue;
    }

    if (UL_RE.test(line)) {
      const items: string[] = [];
      while (i < lines.length && UL_RE.test(lines[i])) {
        const m = UL_RE.exec(lines[i]);
        items.push((m ? m[1] : '').trim());
        i += 1;
      }
      blocks.push({ type: 'list', ordered: false, items });
      continue;
    }

    if (OL_RE.test(line)) {
      const items: string[] = [];
      while (i < lines.length && OL_RE.test(lines[i])) {
        const m = OL_RE.exec(lines[i]);
        items.push((m ? m[1] : '').trim());
        i += 1;
      }
      blocks.push({ type: 'list', ordered: true, items });
      continue;
    }

    // Paragraph — gather soft-wrapped lines until the next block boundary.
    // Single newlines collapse to a space, matching react-markdown's default
    // (no `remark-breaks`).
    const para: string[] = [];
    while (i < lines.length && !isBlockBoundary(lines, i)) {
      para.push(lines[i].trim());
      i += 1;
    }
    if (para.length > 0) {
      blocks.push({ type: 'paragraph', text: para.join(' ') });
    }
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// Inline parser. Supports inline code, links, bold, italic, and strikethrough
// — the inline marks an assistant reply realistically uses. Underscore-flanked
// emphasis is intentionally omitted to avoid falsely emphasising snake_case
// identifiers (a common case in a telemetry assistant); documented in sidecar.
// ---------------------------------------------------------------------------
type InlineKind = 'code' | 'link' | 'strong' | 'em' | 'del';
type InlinePattern = { kind: InlineKind; re: RegExp };

const INLINE_PATTERNS: InlinePattern[] = [
  { kind: 'code', re: /`([^`]+)`/ },
  { kind: 'link', re: /\[([^\]]+)\]\(\s*([^)\s]+)[^)]*\)/ },
  { kind: 'strong', re: /\*\*([^*]+)\*\*/ },
  { kind: 'del', re: /~~([^~]+)~~/ },
  { kind: 'em', re: /\*([^*]+)\*/ },
];

function openLink(url: string): void {
  // Native analogue of `target="_blank"`. Like the web <a>, it silently no-ops
  // when the platform cannot open the URL (the web surface shows no link error).
  void Linking.openURL(url).catch(() => {
    // Intentionally ignored.
  });
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  if (text === '') {
    return [];
  }

  let best: { pattern: InlinePattern; match: RegExpExecArray } | null = null;
  for (const pattern of INLINE_PATTERNS) {
    const match = pattern.re.exec(text);
    if (match !== null && (best === null || match.index < best.match.index)) {
      best = { pattern, match };
    }
  }

  if (best === null) {
    return [text];
  }

  const { pattern, match } = best;
  const nodes: ReactNode[] = [];
  const before = text.slice(0, match.index);
  if (before !== '') {
    nodes.push(before);
  }

  const inner = match[1];
  const key = `${keyPrefix}-${match.index}`;
  switch (pattern.kind) {
    case 'code':
      nodes.push(
        <Text key={key} style={styles.inlineCode}>
          {inner}
        </Text>,
      );
      break;
    case 'link':
      nodes.push(
        <Text
          accessibilityRole="link"
          key={key}
          onPress={() => openLink(match[2])}
          style={styles.link}>
          {inner}
        </Text>,
      );
      break;
    case 'strong':
      nodes.push(
        <Text key={key} style={styles.strong}>
          {renderInline(inner, `${key}s`)}
        </Text>,
      );
      break;
    case 'del':
      nodes.push(
        <Text key={key} style={styles.del}>
          {renderInline(inner, `${key}d`)}
        </Text>,
      );
      break;
    case 'em':
      nodes.push(
        <Text key={key} style={styles.em}>
          {renderInline(inner, `${key}e`)}
        </Text>,
      );
      break;
  }

  const after = text.slice(match.index + match[0].length);
  nodes.push(...renderInline(after, `${key}a`));
  return nodes;
}

// ---------------------------------------------------------------------------
// Native analogue of the web ./CodeBlock the markdown `code`/`pre` renderers
// delegate fenced code to: a bordered surface with an uppercase language-tag
// header + copy affordance, and a horizontally scrollable monospace body.
// ---------------------------------------------------------------------------
function CopyButton({ text }: { text: string }) {
  const t = useNativeTranslationFallback();
  const [copied, setCopied] = useState(false);
  const available = clipboardWriter !== null;

  const onPress = useCallback(() => {
    const writer = clipboardWriter;
    if (writer === null) {
      return;
    }
    void (async () => {
      try {
        await writer(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        // Swallow copy failures — the code text stays visible regardless.
      }
    })();
  }, [text]);

  const label = copied
    ? t('common.copyButton.copied', 'Copied')
    : t('common.copyButton.copy', 'Copy');

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled: !available }}
      disabled={!available}
      onPress={onPress}
      style={({ pressed }) => [
        styles.copyButton,
        pressed && available && styles.pressed,
      ]}>
      <Text
        style={[styles.copyGlyph, !available && styles.copyGlyphDisabled]}>
        {copied ? COPIED_GLYPH : COPY_GLYPH}
      </Text>
    </Pressable>
  );
}

function CodeBlockView({ lang, text }: { lang: string; text: string }) {
  const langLabel = lang.trim() || 'text';
  return (
    <View style={styles.codeBlock}>
      <View style={styles.codeHeader}>
        <Text style={styles.codeLang}>{langLabel}</Text>
        <CopyButton text={text} />
      </View>
      <ScrollView
        contentContainerStyle={styles.codeScrollContent}
        horizontal
        showsHorizontalScrollIndicator={false}>
        <Text style={styles.codeText}>{text}</Text>
      </ScrollView>
    </View>
  );
}

function TableView({
  header,
  rows,
  blockKey,
}: {
  header: string[];
  rows: string[][];
  blockKey: string;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.tableScroll}>
      <View style={styles.table}>
        <View style={styles.tableRow}>
          {header.map((cell, idx) => (
            <View
              key={`${blockKey}-th-${idx}`}
              style={[styles.tableCell, styles.tableHeaderCell]}>
              <AppText style={styles.tableHeaderText} weight="semibold">
                {renderInline(cell, `${blockKey}-th-${idx}`)}
              </AppText>
            </View>
          ))}
        </View>
        {rows.map((row, rIdx) => (
          <View key={`${blockKey}-tr-${rIdx}`} style={styles.tableRow}>
            {row.map((cell, cIdx) => (
              <View key={`${blockKey}-td-${rIdx}-${cIdx}`} style={styles.tableCell}>
                <AppText style={styles.tableCellText}>
                  {renderInline(cell, `${blockKey}-td-${rIdx}-${cIdx}`)}
                </AppText>
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function MarkdownBlockView({
  block,
  blockKey,
}: {
  block: MarkdownBlock;
  blockKey: string;
}) {
  switch (block.type) {
    case 'heading': {
      const headingStyle =
        block.level === 1
          ? styles.heading1
          : block.level === 2
          ? styles.heading2
          : styles.heading3;
      return (
        <AppText style={headingStyle} weight="semibold">
          {renderInline(block.text, `${blockKey}-h`)}
        </AppText>
      );
    }
    case 'code':
      return <CodeBlockView lang={block.lang} text={block.text} />;
    case 'list':
      return (
        <View style={styles.list}>
          {block.items.map((item, idx) => (
            <View key={`${blockKey}-li-${idx}`} style={styles.listItem}>
              <Text style={styles.listMarker}>
                {block.ordered ? `${idx + 1}.` : '\u2022'}
              </Text>
              <AppText style={styles.listItemText}>
                {renderInline(item, `${blockKey}-li-${idx}`)}
              </AppText>
            </View>
          ))}
        </View>
      );
    case 'table':
      return (
        <TableView header={block.header} rows={block.rows} blockKey={blockKey} />
      );
    case 'paragraph':
      return (
        <AppText style={styles.paragraph}>
          {renderInline(block.text, `${blockKey}-p`)}
        </AppText>
      );
  }
}

export interface MarkdownRendererProps {
  /** Raw markdown source. */
  children: string;
}

export function MarkdownRenderer({ children }: MarkdownRendererProps) {
  const source = children ?? '';
  const blocks = useMemo(() => parseBlocks(source), [source]);

  if (blocks.length === 0) {
    // Nothing parseable — mirror the web Suspense fallback's intent by showing
    // the raw text with line breaks preserved (RN <Text> keeps explicit "\n").
    return (
      <View style={styles.root}>
        <AppText style={styles.fallbackText}>{source}</AppText>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {blocks.map((block, idx) => (
        <MarkdownBlockView
          block={block}
          blockKey={`block-${idx}`}
          key={`block-${idx}`}
        />
      ))}
    </View>
  );
}

MarkdownRenderer.displayName = 'MarkdownRenderer';

const styles = StyleSheet.create({
  // web `relative rounded-lg border border-[var(--border-subtle)]
  // bg-[var(--surface-overlay)] my-2 overflow-hidden`.
  codeBlock: {
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    marginVertical: 8,
    overflow: 'hidden',
  },
  // web `flex items-center justify-between border-b ... px-3 py-1.5`.
  codeHeader: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  // web `font-mono` uppercase tracking-wider `text-[11px] text-secondary`.
  codeLang: {
    color: colors.textSecondary,
    fontFamily: 'monospace',
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  // web `<pre ... p-3>` padding around the horizontally scrollable code body.
  codeScrollContent: {
    padding: 12,
  },
  // web `text-xs leading-relaxed text-[var(--text-primary)] font-mono`.
  codeText: {
    color: colors.textPrimary,
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 19,
  },
  copyButton: {
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
  },
  copyGlyph: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  copyGlyphDisabled: {
    color: colors.textMuted,
  },
  del: {
    textDecorationLine: 'line-through',
  },
  em: {
    fontStyle: 'italic',
  },
  // web Suspense fallback `<p className="whitespace-pre-wrap">`.
  fallbackText: {
    color: colors.textPrimary,
    fontSize: 15,
    lineHeight: 22,
  },
  // web `h1: text-base font-semibold text-primary mt-3 mb-1`.
  heading1: {
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 22,
    marginBottom: 4,
    marginTop: 12,
  },
  // web `h2: text-sm font-semibold text-primary mt-2.5 mb-1`.
  heading2: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 4,
    marginTop: 10,
  },
  // web `h3: text-sm font-semibold text-primary mt-2 mb-1`.
  heading3: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 4,
    marginTop: 8,
  },
  // web inline `<code>`: `rounded bg-[var(--surface-2)] px-1 py-0.5
  // text-[0.85em] font-mono`.
  inlineCode: {
    backgroundColor: colors.surfaceRaised,
    color: colors.textPrimary,
    fontFamily: 'monospace',
    fontSize: 13,
  },
  // web `<a class="text-purple-300 underline ...">`.
  link: {
    color: colors.violet,
    textDecorationLine: 'underline',
  },
  // web `ul/ol: pl-5 my-1 space-y-0.5`.
  list: {
    gap: 2,
    marginVertical: 4,
  },
  listItem: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 6,
  },
  listItemText: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 15,
    lineHeight: 22,
  },
  listMarker: {
    color: colors.textSecondary,
    fontSize: 15,
    lineHeight: 22,
    minWidth: 16,
  },
  paragraph: {
    color: colors.textPrimary,
    fontSize: 15,
    lineHeight: 22,
  },
  pressed: {
    opacity: 0.7,
  },
  // web `prose-chat space-y-1` — vertical rhythm between blocks.
  root: {
    gap: spacing.xs,
  },
  strong: {
    fontWeight: '700',
  },
  // web `<table class="text-xs border-collapse border border-subtle">`.
  table: {
    borderColor: colors.border,
    borderLeftWidth: 1,
    borderTopWidth: 1,
  },
  // web `th/td: border border-subtle px-2 py-1`.
  tableCell: {
    borderBottomWidth: 1,
    borderColor: colors.border,
    borderRightWidth: 1,
    justifyContent: 'center',
    minWidth: 96,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  tableCellText: {
    color: colors.textPrimary,
    fontSize: 12,
    lineHeight: 18,
  },
  // web `th ... bg-[var(--surface-2)] text-left font-semibold`.
  tableHeaderCell: {
    backgroundColor: colors.surfaceRaised,
  },
  tableHeaderText: {
    color: colors.textPrimary,
    fontSize: 12,
    lineHeight: 18,
  },
  tableRow: {
    flexDirection: 'row',
  },
  // web `<div className="overflow-x-auto my-2">` wrapper around the table.
  tableScroll: {
    marginVertical: 8,
  },
});
