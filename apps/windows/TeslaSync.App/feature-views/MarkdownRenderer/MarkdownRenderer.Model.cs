using System.Globalization;
using System.Text;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Chatbot;

/// <summary>
/// The mutually-exclusive render branch of the <c>MarkdownRenderer</c> surface — the native union of the states
/// the P2 feature-view contract requires for the chatbot assistant-message renderer
/// (web/src/features/system/components/chatbot/MarkdownRenderer.tsx). The web component is a pure presentational
/// child: it takes the already-resolved assistant reply (<c>children: string</c>) and lazy-loads its
/// react-markdown engine behind <c>React.lazy</c> + <c>Suspense</c>, so the hosting chatbot owns the
/// message lifecycle (streaming, failure, cache freshness) and supplies the active state. The native surface
/// reproduces the full loading / ready / empty / error / stale / offline matrix the prompt mandates; every member
/// maps onto a visible surface (the rendered message, the Suspense-style raw-text fallback, an empty state, a
/// retry affordance or a freshness chip) and none is ever hidden behind a <c>{data &amp;&amp; …}</c> guard.
/// </summary>
public enum MarkdownRendererState
{
    /// <summary>The reply is still arriving — the web <c>Suspense</c> fallback (raw text, line breaks preserved).</summary>
    Loading,

    /// <summary>A resolved reply to render — the parsed markdown document (web fall-through).</summary>
    Ready,

    /// <summary>Resolved with no content — a friendly empty state, never a blank box.</summary>
    Empty,

    /// <summary>The reply failed with no usable content — a retriable error surface.</summary>
    Error,

    /// <summary>Showing a reply older than the freshness window — the message plus a stale chip.</summary>
    Stale,

    /// <summary>No connectivity — the last cached reply plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The kind of an inline span in a parsed markdown document — the native, WinUI-free enumeration of the inline
/// constructs the web <c>MarkdownRenderer</c> renders through react-markdown + remark-gfm (emphasis, strong,
/// inline code, links and GFM strikethrough), plus the hard line break. Keeping the inline shape as pure data
/// lets the parser be asserted headlessly, without a UI host.
/// </summary>
public enum MarkdownInlineKind
{
    /// <summary>Literal text.</summary>
    Text,

    /// <summary>Bold text (<c>**…**</c> / <c>__…__</c>).</summary>
    Strong,

    /// <summary>Italic text (<c>*…*</c> / <c>_…_</c>).</summary>
    Emphasis,

    /// <summary>Struck-through text (GFM <c>~~…~~</c>).</summary>
    Strikethrough,

    /// <summary>Inline monospace code (<c>`code`</c>) — never re-parsed for inner markup.</summary>
    CodeSpan,

    /// <summary>A hyperlink (<c>[text](url)</c>) — opens in the browser, like the web <c>target="_blank"</c>.</summary>
    Link,

    /// <summary>An explicit hard line break (a line ending in two or more spaces, or a backslash).</summary>
    LineBreak,
}

/// <summary>
/// One inline span of a parsed markdown document. A leaf (<see cref="MarkdownInlineKind.Text"/> /
/// <see cref="MarkdownInlineKind.CodeSpan"/> / <see cref="MarkdownInlineKind.LineBreak"/>) carries its literal
/// <see cref="Text"/>; a container (<see cref="MarkdownInlineKind.Strong"/> /
/// <see cref="MarkdownInlineKind.Emphasis"/> / <see cref="MarkdownInlineKind.Strikethrough"/> /
/// <see cref="MarkdownInlineKind.Link"/>) carries its already-parsed <see cref="Children"/>, and a link also
/// carries its <see cref="Href"/>. Pure data so the parser output is asserted without a UI host.
/// </summary>
/// <param name="Kind">The inline construct this span represents.</param>
/// <param name="Text">The literal text for a leaf span; empty for containers.</param>
/// <param name="Href">The link target for <see cref="MarkdownInlineKind.Link"/>; otherwise <see langword="null"/>.</param>
/// <param name="Children">The nested spans for a container; empty for a leaf.</param>
public sealed record MarkdownInline(
    MarkdownInlineKind Kind,
    string Text,
    string? Href,
    IReadOnlyList<MarkdownInline> Children)
{
    /// <summary>A shared empty span list (no per-leaf allocation).</summary>
    public static IReadOnlyList<MarkdownInline> None { get; } = Array.Empty<MarkdownInline>();

    /// <summary>A literal-text span.</summary>
    /// <param name="text">The literal text.</param>
    public static MarkdownInline FromText(string text) =>
        new(MarkdownInlineKind.Text, text, null, None);

    /// <summary>An inline monospace code span (never re-parsed).</summary>
    /// <param name="code">The verbatim code text.</param>
    public static MarkdownInline Code(string code) =>
        new(MarkdownInlineKind.CodeSpan, code, null, None);

    /// <summary>A hard line break.</summary>
    public static MarkdownInline Break() =>
        new(MarkdownInlineKind.LineBreak, string.Empty, null, None);

    /// <summary>A container span (strong / emphasis / strikethrough) over already-parsed children.</summary>
    /// <param name="kind">The container kind.</param>
    /// <param name="children">The nested spans.</param>
    public static MarkdownInline Container(MarkdownInlineKind kind, IReadOnlyList<MarkdownInline> children) =>
        new(kind, string.Empty, null, children);

    /// <summary>A hyperlink span over its parsed label children.</summary>
    /// <param name="href">The link target.</param>
    /// <param name="children">The parsed label spans.</param>
    public static MarkdownInline ToLink(string href, IReadOnlyList<MarkdownInline> children) =>
        new(MarkdownInlineKind.Link, string.Empty, href, children);
}

/// <summary>The horizontal alignment of a GFM table column (from the delimiter row's colons).</summary>
public enum MarkdownColumnAlignment
{
    /// <summary>No explicit alignment (<c>---</c>) — leading.</summary>
    None,

    /// <summary>Left-aligned (<c>:---</c>).</summary>
    Left,

    /// <summary>Centre-aligned (<c>:---:</c>).</summary>
    Center,

    /// <summary>Right-aligned (<c>---:</c>).</summary>
    Right,
}

/// <summary>The base of the parsed block hierarchy (paragraph, heading, list, code block, table, …).</summary>
public abstract record MarkdownBlock;

/// <summary>A paragraph block — the web default text run.</summary>
/// <param name="Inlines">The paragraph's inline spans.</param>
public sealed record MarkdownParagraph(IReadOnlyList<MarkdownInline> Inlines) : MarkdownBlock;

/// <summary>
/// An ATX heading block (<c>#</c>…<c>######</c>) — the web custom <c>h1</c> / <c>h2</c> / <c>h3</c> renderers
/// (deeper levels fall through to the same compact treatment).
/// </summary>
/// <param name="Level">The heading level, 1–6.</param>
/// <param name="Inlines">The heading's inline spans.</param>
public sealed record MarkdownHeading(int Level, IReadOnlyList<MarkdownInline> Inlines) : MarkdownBlock;

/// <summary>One list item (a single logical line of inline content).</summary>
/// <param name="Inlines">The item's inline spans.</param>
public sealed record MarkdownListItem(IReadOnlyList<MarkdownInline> Inlines);

/// <summary>
/// A bullet or ordered list block — the web custom <c>ul</c> (disc) / <c>ol</c> (decimal) renderers.
/// </summary>
/// <param name="Ordered">Whether the list is ordered (decimal) rather than a bullet list.</param>
/// <param name="Start">The first ordinal for an ordered list (web preserves the author's start number).</param>
/// <param name="Items">The list items in order.</param>
public sealed record MarkdownList(bool Ordered, int Start, IReadOnlyList<MarkdownListItem> Items) : MarkdownBlock;

/// <summary>
/// A fenced code block — the web delegates these to <c>CodeBlock</c> (a sibling chatbot surface) for its
/// language tag and copy-to-clipboard affordance; this surface reproduces that treatment inline (it may not
/// depend on the separate <c>CodeBlock</c> surface).
/// </summary>
/// <param name="Language">The fence's language hint (web <c>language-*</c> class), or <see langword="null"/>.</param>
/// <param name="Code">The verbatim code text (never markdown-parsed).</param>
public sealed record MarkdownCodeBlock(string? Language, string Code) : MarkdownBlock;

/// <summary>One table cell.</summary>
/// <param name="Inlines">The cell's inline spans.</param>
/// <param name="Alignment">The owning column's alignment.</param>
public sealed record MarkdownTableCell(IReadOnlyList<MarkdownInline> Inlines, MarkdownColumnAlignment Alignment);

/// <summary>One table body row.</summary>
/// <param name="Cells">The row's cells, left to right.</param>
public sealed record MarkdownTableRow(IReadOnlyList<MarkdownTableCell> Cells);

/// <summary>A GFM table block (remark-gfm) — the web custom <c>table</c> / <c>th</c> / <c>td</c> renderers.</summary>
/// <param name="Header">The header cells.</param>
/// <param name="Rows">The body rows.</param>
public sealed record MarkdownTable(
    IReadOnlyList<MarkdownTableCell> Header,
    IReadOnlyList<MarkdownTableRow> Rows) : MarkdownBlock;

/// <summary>A thematic break (<c>---</c> / <c>***</c> / <c>___</c>) — a horizontal rule.</summary>
public sealed record MarkdownThematicBreak : MarkdownBlock;

/// <summary>A block quote (<c>&gt; …</c>).</summary>
/// <param name="Inlines">The quote's inline spans.</param>
public sealed record MarkdownBlockQuote(IReadOnlyList<MarkdownInline> Inlines) : MarkdownBlock;

/// <summary>A fully parsed markdown document — the ordered block list the view renders.</summary>
/// <param name="Blocks">The document's blocks, in source order.</param>
public sealed record MarkdownDocument(IReadOnlyList<MarkdownBlock> Blocks)
{
    /// <summary>An empty document (no blocks).</summary>
    public static MarkdownDocument Empty { get; } = new(Array.Empty<MarkdownBlock>());

    /// <summary>True when the document has no renderable blocks.</summary>
    public bool IsEmpty => Blocks.Count == 0;
}

/// <summary>
/// The native markdown parser — the WinUI-free "data adapter" the prompt requires (raw assistant reply →
/// document projection). It reproduces the subset of CommonMark + remark-gfm the web
/// <c>MarkdownRenderer</c> actually renders (web/src/features/system/components/chatbot/MarkdownRenderer.tsx):
/// ATX headings, paragraphs, bullet / ordered lists, fenced code blocks, GFM tables, thematic breaks and block
/// quotes at the block level; strong, emphasis, GFM strikethrough, inline code and links at the inline level,
/// with backslash escapes and hard line breaks. Like the web component (react-markdown is safe-by-default and
/// <c>rehype-raw</c> is deliberately NOT enabled), the parser treats embedded raw HTML as literal text — a
/// <c>&lt;script&gt;</c> in the source is rendered escaped, never executed. Pure logic: unit-tested without a
/// UI host.
/// </summary>
public static class MarkdownParser
{
    private const int MaxHeadingLevel = 6;

    /// <summary>Parse a raw markdown string into its document model.</summary>
    /// <param name="source">The raw markdown (web <c>children</c>); <see langword="null"/> is treated as empty.</param>
    /// <returns>The parsed document; <see cref="MarkdownDocument.Empty"/> when the source has no content.</returns>
    public static MarkdownDocument Parse(string? source)
    {
        if (string.IsNullOrWhiteSpace(source))
        {
            return MarkdownDocument.Empty;
        }

        string[] lines = Normalize(source).Split('\n');
        var blocks = new List<MarkdownBlock>();
        int i = 0;

        while (i < lines.Length)
        {
            string line = lines[i];

            if (string.IsNullOrWhiteSpace(line))
            {
                i++;
                continue;
            }

            if (TryFencedCode(lines, ref i, out MarkdownCodeBlock? code))
            {
                blocks.Add(code!);
                continue;
            }

            string trimmed = line.TrimStart();

            if (IsThematicBreak(trimmed))
            {
                blocks.Add(new MarkdownThematicBreak());
                i++;
                continue;
            }

            if (TryHeading(trimmed, out MarkdownHeading? heading))
            {
                blocks.Add(heading!);
                i++;
                continue;
            }

            if (TryTable(lines, ref i, out MarkdownTable? table))
            {
                blocks.Add(table!);
                continue;
            }

            if (TryBlockQuote(lines, ref i, out MarkdownBlockQuote? quote))
            {
                blocks.Add(quote!);
                continue;
            }

            if (TryList(lines, ref i, out MarkdownList? list))
            {
                blocks.Add(list!);
                continue;
            }

            blocks.Add(ParseParagraph(lines, ref i));
        }

        return blocks.Count == 0 ? MarkdownDocument.Empty : new MarkdownDocument(blocks);
    }

    /// <summary>Parse a single run of inline markdown (exposed for headless inline-level assertions).</summary>
    /// <param name="text">The inline source; <see langword="null"/> yields no spans.</param>
    /// <returns>The parsed inline spans.</returns>
    public static IReadOnlyList<MarkdownInline> ParseInlines(string? text)
    {
        if (string.IsNullOrEmpty(text))
        {
            return MarkdownInline.None;
        }

        var result = new List<MarkdownInline>();
        var buffer = new StringBuilder();
        int i = 0;

        void FlushText()
        {
            if (buffer.Length > 0)
            {
                result.Add(MarkdownInline.FromText(buffer.ToString()));
                buffer.Clear();
            }
        }

        while (i < text.Length)
        {
            char c = text[i];

            if (c == '\\' && i + 1 < text.Length && IsEscapable(text[i + 1]))
            {
                buffer.Append(text[i + 1]);
                i += 2;
                continue;
            }

            if (c == '\n')
            {
                FlushText();
                result.Add(MarkdownInline.Break());
                i++;
                continue;
            }

            if (c == '`' && TryCodeSpan(text, i, out string codeText, out int afterCode))
            {
                FlushText();
                result.Add(MarkdownInline.Code(codeText));
                i = afterCode;
                continue;
            }

            if ((c == '*' || c == '_') && i + 1 < text.Length && text[i + 1] == c &&
                (c == '*' || IsUnderscoreBoundary(text, i)) &&
                TryDelimited(text, i, $"{c}{c}", out string strongInner, out int afterStrong))
            {
                FlushText();
                result.Add(MarkdownInline.Container(MarkdownInlineKind.Strong, ParseInlines(strongInner)));
                i = afterStrong;
                continue;
            }

            if (c == '~' && i + 1 < text.Length && text[i + 1] == '~' &&
                TryDelimited(text, i, "~~", out string strikeInner, out int afterStrike))
            {
                FlushText();
                result.Add(MarkdownInline.Container(MarkdownInlineKind.Strikethrough, ParseInlines(strikeInner)));
                i = afterStrike;
                continue;
            }

            if ((c == '*' || c == '_') &&
                (c == '*' || IsUnderscoreBoundary(text, i)) &&
                TryDelimited(text, i, c.ToString(), out string emInner, out int afterEm) &&
                emInner.Length > 0)
            {
                FlushText();
                result.Add(MarkdownInline.Container(MarkdownInlineKind.Emphasis, ParseInlines(emInner)));
                i = afterEm;
                continue;
            }

            if (c == '[' && TryLink(text, i, out string label, out string href, out int afterLink))
            {
                FlushText();
                result.Add(MarkdownInline.ToLink(href, ParseInlines(label)));
                i = afterLink;
                continue;
            }

            buffer.Append(c);
            i++;
        }

        FlushText();
        return result;
    }

    private static string Normalize(string source) =>
        source.Replace("\r\n", "\n", StringComparison.Ordinal).Replace('\r', '\n');

    // ── Block helpers ──────────────────────────────────────────────────────────────────────────────────────

    private static bool TryFencedCode(string[] lines, ref int i, out MarkdownCodeBlock? code)
    {
        code = null;
        string opener = lines[i].TrimStart();
        char fenceChar;
        if (opener.StartsWith("```", StringComparison.Ordinal))
        {
            fenceChar = '`';
        }
        else if (opener.StartsWith("~~~", StringComparison.Ordinal))
        {
            fenceChar = '~';
        }
        else
        {
            return false;
        }

        int fenceLength = 0;
        while (fenceLength < opener.Length && opener[fenceLength] == fenceChar)
        {
            fenceLength++;
        }

        string language = opener[fenceLength..].Trim();
        var body = new List<string>();
        int j = i + 1;

        // An unterminated fence still yields a code block (CommonMark closes it at end of input).
        while (j < lines.Length)
        {
            string candidate = lines[j].TrimStart();
            if (candidate.Length >= fenceLength && IsAll(candidate, fenceChar))
            {
                j++;
                break;
            }

            body.Add(lines[j]);
            j++;
        }

        i = j;
        code = new MarkdownCodeBlock(
            string.IsNullOrEmpty(language) ? null : language,
            string.Join('\n', body));
        return true;
    }

    private static bool IsThematicBreak(string trimmed)
    {
        if (trimmed.Length < 3)
        {
            return false;
        }

        char marker = trimmed[0];
        if (marker is not ('-' or '*' or '_'))
        {
            return false;
        }

        int count = 0;
        foreach (char c in trimmed)
        {
            if (c == marker)
            {
                count++;
            }
            else if (c != ' ' && c != '\t')
            {
                return false;
            }
        }

        return count >= 3;
    }

    private static bool TryHeading(string trimmed, out MarkdownHeading? heading)
    {
        heading = null;
        int level = 0;
        while (level < trimmed.Length && trimmed[level] == '#')
        {
            level++;
        }

        if (level == 0 || level > MaxHeadingLevel)
        {
            return false;
        }

        if (level >= trimmed.Length || trimmed[level] != ' ')
        {
            return false;
        }

        string content = trimmed[(level + 1)..].Trim();
        content = StripTrailingHashes(content);
        heading = new MarkdownHeading(level, ParseInlines(content));
        return true;
    }

    private static string StripTrailingHashes(string content)
    {
        int end = content.Length;
        while (end > 0 && content[end - 1] == '#')
        {
            end--;
        }

        if (end < content.Length && (end == 0 || content[end - 1] == ' '))
        {
            return content[..end].TrimEnd();
        }

        return content;
    }

    private static bool TryBlockQuote(string[] lines, ref int i, out MarkdownBlockQuote? quote)
    {
        quote = null;
        if (lines[i].TrimStart().Length == 0 || lines[i].TrimStart()[0] != '>')
        {
            return false;
        }

        var parts = new List<string>();
        int j = i;
        while (j < lines.Length)
        {
            string t = lines[j].TrimStart();
            if (t.Length == 0 || t[0] != '>')
            {
                break;
            }

            string inner = t[1..];
            if (inner.StartsWith(' '))
            {
                inner = inner[1..];
            }

            parts.Add(inner);
            j++;
        }

        i = j;
        quote = new MarkdownBlockQuote(ParseInlines(JoinSoft(parts)));
        return true;
    }

    private static bool TryList(string[] lines, ref int i, out MarkdownList? list)
    {
        list = null;
        if (!TryListMarker(lines[i], out bool ordered, out int start, out _))
        {
            return false;
        }

        var items = new List<MarkdownListItem>();
        int j = i;
        while (j < lines.Length)
        {
            if (string.IsNullOrWhiteSpace(lines[j]))
            {
                break;
            }

            if (!TryListMarker(lines[j], out bool itemOrdered, out _, out string content) || itemOrdered != ordered)
            {
                break;
            }

            items.Add(new MarkdownListItem(ParseInlines(content.Trim())));
            j++;
        }

        if (items.Count == 0)
        {
            return false;
        }

        i = j;
        list = new MarkdownList(ordered, start, items);
        return true;
    }

    private static bool TryListMarker(string line, out bool ordered, out int start, out string content)
    {
        ordered = false;
        start = 1;
        content = string.Empty;

        string trimmed = line.TrimStart();
        if (trimmed.Length < 2)
        {
            return false;
        }

        char first = trimmed[0];
        if ((first == '-' || first == '*' || first == '+') && trimmed[1] == ' ')
        {
            content = trimmed[2..];
            return true;
        }

        int digits = 0;
        while (digits < trimmed.Length && char.IsDigit(trimmed[digits]) && digits < 9)
        {
            digits++;
        }

        if (digits > 0 && digits < trimmed.Length &&
            (trimmed[digits] == '.' || trimmed[digits] == ')') &&
            digits + 1 < trimmed.Length && trimmed[digits + 1] == ' ')
        {
            ordered = true;
            start = int.Parse(trimmed[..digits], CultureInfo.InvariantCulture);
            content = trimmed[(digits + 2)..];
            return true;
        }

        return false;
    }

    private static bool TryTable(string[] lines, ref int i, out MarkdownTable? table)
    {
        table = null;
        if (i + 1 >= lines.Length)
        {
            return false;
        }

        if (!lines[i].Contains('|', StringComparison.Ordinal) || !IsTableDelimiter(lines[i + 1]))
        {
            return false;
        }

        List<MarkdownColumnAlignment> alignments = ParseAlignments(lines[i + 1]);
        List<string> headerCells = SplitTableRow(lines[i]);
        var header = new List<MarkdownTableCell>(headerCells.Count);
        for (int c = 0; c < headerCells.Count; c++)
        {
            header.Add(new MarkdownTableCell(ParseInlines(headerCells[c].Trim()), AlignmentAt(alignments, c)));
        }

        var rows = new List<MarkdownTableRow>();
        int j = i + 2;
        while (j < lines.Length && !string.IsNullOrWhiteSpace(lines[j]) &&
               lines[j].Contains('|', StringComparison.Ordinal))
        {
            List<string> rowCells = SplitTableRow(lines[j]);
            var cells = new List<MarkdownTableCell>(rowCells.Count);
            for (int c = 0; c < rowCells.Count; c++)
            {
                cells.Add(new MarkdownTableCell(ParseInlines(rowCells[c].Trim()), AlignmentAt(alignments, c)));
            }

            rows.Add(new MarkdownTableRow(cells));
            j++;
        }

        i = j;
        table = new MarkdownTable(header, rows);
        return true;
    }

    private static MarkdownColumnAlignment AlignmentAt(List<MarkdownColumnAlignment> alignments, int index) =>
        index < alignments.Count ? alignments[index] : MarkdownColumnAlignment.None;

    private static bool IsTableDelimiter(string line)
    {
        string trimmed = line.Trim();
        if (trimmed.Length == 0 || !trimmed.Contains('-', StringComparison.Ordinal))
        {
            return false;
        }

        foreach (char c in trimmed)
        {
            if (c is not ('|' or '-' or ':' or ' ' or '\t'))
            {
                return false;
            }
        }

        return true;
    }

    private static List<MarkdownColumnAlignment> ParseAlignments(string delimiterRow)
    {
        var result = new List<MarkdownColumnAlignment>();
        foreach (string raw in SplitTableRow(delimiterRow))
        {
            string spec = raw.Trim();
            bool left = spec.StartsWith(':');
            bool right = spec.EndsWith(':');
            result.Add((left, right) switch
            {
                (true, true) => MarkdownColumnAlignment.Center,
                (true, false) => MarkdownColumnAlignment.Left,
                (false, true) => MarkdownColumnAlignment.Right,
                _ => MarkdownColumnAlignment.None,
            });
        }

        return result;
    }

    private static List<string> SplitTableRow(string line)
    {
        string trimmed = line.Trim();
        if (trimmed.StartsWith('|'))
        {
            trimmed = trimmed[1..];
        }

        if (trimmed.EndsWith('|'))
        {
            trimmed = trimmed[..^1];
        }

        var cells = new List<string>();
        var current = new StringBuilder();
        for (int k = 0; k < trimmed.Length; k++)
        {
            char c = trimmed[k];
            if (c == '\\' && k + 1 < trimmed.Length && trimmed[k + 1] == '|')
            {
                current.Append('|');
                k++;
                continue;
            }

            if (c == '|')
            {
                cells.Add(current.ToString());
                current.Clear();
                continue;
            }

            current.Append(c);
        }

        cells.Add(current.ToString());
        return cells;
    }

    private static MarkdownParagraph ParseParagraph(string[] lines, ref int i)
    {
        var collected = new List<string>();
        while (i < lines.Length)
        {
            string line = lines[i];
            if (string.IsNullOrWhiteSpace(line))
            {
                break;
            }

            string trimmed = line.TrimStart();
            if (IsThematicBreak(trimmed) ||
                TryHeading(trimmed, out _) ||
                (trimmed.Length > 0 && trimmed[0] == '>') ||
                TryListMarker(line, out _, out _, out _) ||
                trimmed.StartsWith("```", StringComparison.Ordinal) ||
                trimmed.StartsWith("~~~", StringComparison.Ordinal))
            {
                if (collected.Count > 0)
                {
                    break;
                }
            }

            collected.Add(line);
            i++;
        }

        return new MarkdownParagraph(ParseInlines(JoinSoft(collected)));
    }

    // Join paragraph / quote lines: a line ending in two+ spaces (or a backslash) is a hard break ('\n');
    // every other soft wrap collapses to a single space, matching react-markdown's CommonMark rendering.
    private static string JoinSoft(List<string> lines)
    {
        var sb = new StringBuilder();
        for (int k = 0; k < lines.Count; k++)
        {
            string line = lines[k];
            bool hardBreak = line.EndsWith("  ", StringComparison.Ordinal) || line.EndsWith('\\');
            sb.Append(line.TrimEnd());
            if (hardBreak && sb.Length > 0 && sb[^1] == '\\')
            {
                sb.Length--;
            }

            if (k < lines.Count - 1)
            {
                sb.Append(hardBreak ? '\n' : ' ');
            }
        }

        return sb.ToString();
    }

    // ── Inline helpers ─────────────────────────────────────────────────────────────────────────────────────

    private static bool IsEscapable(char c) =>
        c is '\\' or '`' or '*' or '_' or '{' or '}' or '[' or ']' or '(' or ')'
            or '#' or '+' or '-' or '.' or '!' or '|' or '~' or '>' or '<' or '"';

    // CommonMark intraword rule for '_': an underscore flanked by an alphanumeric on its left does not open
    // emphasis, so identifiers such as snake_case_name stay literal (web react-markdown does not italicize them).
    private static bool IsUnderscoreBoundary(string text, int index) =>
        index == 0 || !char.IsLetterOrDigit(text[index - 1]);

    private static bool TryCodeSpan(string text, int start, out string code, out int afterEnd)
    {
        code = string.Empty;
        afterEnd = start;

        int tickLength = 0;
        while (start + tickLength < text.Length && text[start + tickLength] == '`')
        {
            tickLength++;
        }

        int contentStart = start + tickLength;
        int j = contentStart;
        while (j < text.Length)
        {
            if (text[j] == '`')
            {
                int run = 0;
                while (j + run < text.Length && text[j + run] == '`')
                {
                    run++;
                }

                if (run == tickLength)
                {
                    string inner = text[contentStart..j];
                    if (inner.Length > 2 && inner[0] == ' ' && inner[^1] == ' ' && inner.Trim().Length > 0)
                    {
                        inner = inner[1..^1];
                    }

                    code = inner;
                    afterEnd = j + run;
                    return true;
                }

                j += run;
                continue;
            }

            j++;
        }

        return false;
    }

    private static bool TryDelimited(string text, int start, string delimiter, out string inner, out int afterEnd)
    {
        inner = string.Empty;
        afterEnd = start;

        int contentStart = start + delimiter.Length;
        int j = contentStart;
        while (j <= text.Length - delimiter.Length)
        {
            if (text[j] == '\\')
            {
                j += 2;
                continue;
            }

            if (Matches(text, j, delimiter))
            {
                inner = text[contentStart..j];
                afterEnd = j + delimiter.Length;
                return true;
            }

            j++;
        }

        return false;
    }

    private static bool TryLink(string text, int start, out string label, out string href, out int afterEnd)
    {
        label = string.Empty;
        href = string.Empty;
        afterEnd = start;

        int depth = 0;
        int j = start;
        int labelEnd = -1;
        while (j < text.Length)
        {
            char c = text[j];
            if (c == '\\')
            {
                j += 2;
                continue;
            }

            if (c == '[')
            {
                depth++;
            }
            else if (c == ']')
            {
                depth--;
                if (depth == 0)
                {
                    labelEnd = j;
                    break;
                }
            }

            j++;
        }

        if (labelEnd < 0 || labelEnd + 1 >= text.Length || text[labelEnd + 1] != '(')
        {
            return false;
        }

        int urlStart = labelEnd + 2;
        int parenDepth = 1;
        int k = urlStart;
        while (k < text.Length)
        {
            char c = text[k];
            if (c == '\\')
            {
                k += 2;
                continue;
            }

            if (c == '(')
            {
                parenDepth++;
            }
            else if (c == ')')
            {
                parenDepth--;
                if (parenDepth == 0)
                {
                    break;
                }
            }

            k++;
        }

        if (k >= text.Length)
        {
            return false;
        }

        label = text[(start + 1)..labelEnd];
        string target = text[urlStart..k].Trim();
        href = ExtractHref(target);
        afterEnd = k + 1;
        return href.Length > 0;
    }

    private static string ExtractHref(string target)
    {
        if (target.StartsWith('<'))
        {
            int close = target.IndexOf('>', StringComparison.Ordinal);
            if (close >= 0)
            {
                return target[1..close].Trim();
            }
        }

        int space = target.IndexOf(' ', StringComparison.Ordinal);
        return space < 0 ? target : target[..space];
    }

    private static bool Matches(string text, int index, string token)
    {
        if (index + token.Length > text.Length)
        {
            return false;
        }

        for (int k = 0; k < token.Length; k++)
        {
            if (text[index + k] != token[k])
            {
                return false;
            }
        }

        return true;
    }

    private static bool IsAll(string text, char c)
    {
        foreach (char ch in text)
        {
            if (ch != c)
            {
                return false;
            }
        }

        return text.Length > 0;
    }
}

/// <summary>
/// The render-time data model the <c>MarkdownRenderer</c> view binds to — the native analogue of the web
/// component's single prop (<c>children: string</c>,
/// web/src/features/system/components/chatbot/MarkdownRenderer.tsx) plus the host-supplied lifecycle
/// <see cref="Status"/> and freshness flags. The view never fetches; the chatbot host fills this in (the native
/// P1/S8 seam). Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Status">The host-supplied lifecycle state.</param>
/// <param name="Markdown">The raw assistant reply (web <c>children</c>); empty when there is none.</param>
/// <param name="UpdatedAt">Last successful update timestamp surfaced in the freshness chip.</param>
/// <param name="IsFetching">True while a background refresh is in flight.</param>
/// <param name="ErrorMessage">Already-localized error message for the error / offline surfaces, when set.</param>
public sealed record MarkdownRendererModel(
    MarkdownRendererState Status,
    string Markdown,
    DateTimeOffset? UpdatedAt = null,
    bool IsFetching = false,
    string? ErrorMessage = null)
{
    /// <summary>The initial model: the reply is still arriving and no content is available yet.</summary>
    /// <param name="partial">Any partial text already streamed (web Suspense fallback shows it verbatim).</param>
    public static MarkdownRendererModel Loading(string? partial = null) =>
        new(MarkdownRendererState.Loading, partial ?? string.Empty);

    /// <summary>A resolved model carrying the assistant reply to render.</summary>
    /// <param name="markdown">The raw markdown reply.</param>
    /// <param name="updatedAt">The freshness timestamp.</param>
    /// <param name="isFetching">True while a background refresh is in flight.</param>
    public static MarkdownRendererModel Ready(string markdown, DateTimeOffset? updatedAt = null, bool isFetching = false)
    {
        ArgumentNullException.ThrowIfNull(markdown);
        return new(MarkdownRendererState.Ready, markdown, updatedAt, isFetching);
    }

    /// <summary>A resolved model with no content — the friendly empty state.</summary>
    public static MarkdownRendererModel Empty() =>
        new(MarkdownRendererState.Empty, string.Empty);

    /// <summary>A hard-failure model (no usable content) carrying an optional already-localized message.</summary>
    /// <param name="message">An already-localized error message, or null for the default copy.</param>
    public static MarkdownRendererModel Failed(string? message = null) =>
        new(MarkdownRendererState.Error, string.Empty, ErrorMessage: message);

    /// <summary>A stale snapshot (older than the freshness window) carrying the cached reply.</summary>
    /// <param name="markdown">The cached markdown reply.</param>
    /// <param name="updatedAt">The freshness timestamp.</param>
    public static MarkdownRendererModel Stale(string markdown, DateTimeOffset? updatedAt = null)
    {
        ArgumentNullException.ThrowIfNull(markdown);
        return new(MarkdownRendererState.Stale, markdown, updatedAt);
    }

    /// <summary>An offline snapshot (no connectivity) carrying the last cached reply.</summary>
    /// <param name="markdown">The cached markdown reply.</param>
    /// <param name="updatedAt">The freshness timestamp.</param>
    /// <param name="message">An already-localized offline message, or null for the default copy.</param>
    public static MarkdownRendererModel Offline(string markdown, DateTimeOffset? updatedAt = null, string? message = null)
    {
        ArgumentNullException.ThrowIfNull(markdown);
        return new(MarkdownRendererState.Offline, markdown, updatedAt, ErrorMessage: message);
    }
}

/// <summary>
/// The fully projected, render-ready view of an assistant message — the native analogue of everything the web
/// <c>MarkdownRenderer</c> renders. Holds the active <see cref="State"/>, the parsed <see cref="Document"/>
/// (for the content branches), the raw <see cref="FallbackText"/> the loading branch shows verbatim (the web
/// <c>Suspense</c> fallback), the freshness chip copy + tone (shown only for <see cref="MarkdownRendererState.Stale"/>
/// / <see cref="MarkdownRendererState.Offline"/>), the empty / error copy and retry label, the localized
/// code-block copy affordance labels, the accessible link suffix, the freshness timestamp + fetching flag, and
/// the surface <see cref="AutomationName"/>. Pure data so every branch is asserted headlessly.
/// </summary>
/// <param name="State">The resolved render branch.</param>
/// <param name="Document">The parsed markdown document for content branches; empty otherwise.</param>
/// <param name="FallbackText">The raw reply text the loading branch shows verbatim (web Suspense fallback).</param>
/// <param name="ShowFreshnessChip">Whether a stale / offline chip is shown beside the message.</param>
/// <param name="FreshnessChipText">Localized stale / offline chip text.</param>
/// <param name="IsOffline">Whether the freshness chip is the offline (danger) variant rather than stale (warning).</param>
/// <param name="EmptyTitle">Localized empty-state title (empty branch).</param>
/// <param name="EmptyMessage">Localized empty-state message (empty branch).</param>
/// <param name="ErrorTitle">Localized error heading (error branch).</param>
/// <param name="ErrorMessage">Localized error message (error branch).</param>
/// <param name="RetryLabel">Localized retry affordance label.</param>
/// <param name="CopyLabel">Localized code-block copy affordance idle label.</param>
/// <param name="CopiedLabel">Localized code-block copy affordance confirmation label.</param>
/// <param name="LinkOpensHint">Localized "opens in your browser" suffix appended to link accessible names.</param>
/// <param name="UpdatedAt">Last successful update timestamp surfaced in the freshness chip.</param>
/// <param name="IsFetching">True while a background refresh is in flight.</param>
/// <param name="AutomationName">The composed Narrator name for the surface.</param>
public sealed record MarkdownRendererDisplay(
    MarkdownRendererState State,
    MarkdownDocument Document,
    string FallbackText,
    bool ShowFreshnessChip,
    string FreshnessChipText,
    bool IsOffline,
    string EmptyTitle,
    string EmptyMessage,
    string ErrorTitle,
    string ErrorMessage,
    string RetryLabel,
    string CopyLabel,
    string CopiedLabel,
    string LinkOpensHint,
    DateTimeOffset? UpdatedAt,
    bool IsFetching,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="MarkdownRendererModel"/> to its <see cref="MarkdownRendererDisplay"/> — the
/// native port of web/src/features/system/components/chatbot/MarkdownRenderer.tsx. Branch precedence mirrors the
/// chatbot host's message lifecycle (loading → error → empty → freshness → ready); a resolved reply with no
/// content collapses to the empty branch (never a blank box), while a stale / offline snapshot keeps its parsed
/// content under a freshness chip. The content branches parse the reply through <see cref="MarkdownParser"/>;
/// the loading branch preserves the raw reply verbatim (the web <c>Suspense</c> fallback). Every label resolves
/// through the i18n facade. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class MarkdownRendererProjection
{
    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web prop plus lifecycle).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <returns>The render-ready display model.</returns>
    public static MarkdownRendererDisplay Project(MarkdownRendererModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        MarkdownRendererState state = SelectState(model);

        MarkdownDocument document = state is MarkdownRendererState.Ready
            or MarkdownRendererState.Stale
            or MarkdownRendererState.Offline
            ? MarkdownParser.Parse(model.Markdown)
            : MarkdownDocument.Empty;

        bool showChip = state is MarkdownRendererState.Stale or MarkdownRendererState.Offline;
        bool isOffline = state == MarkdownRendererState.Offline;
        string chipText = state switch
        {
            MarkdownRendererState.Offline => localizer.GetString(
                MarkdownRendererRegistration.OfflineKey, MarkdownRendererRegistration.OfflineFallback),
            MarkdownRendererState.Stale => localizer.GetString(
                MarkdownRendererRegistration.StaleKey, MarkdownRendererRegistration.StaleFallback),
            _ => string.Empty,
        };

        string emptyTitle = localizer.GetString(
            MarkdownRendererRegistration.EmptyTitleKey, MarkdownRendererRegistration.EmptyTitleFallback);
        string emptyMessage = localizer.GetString(
            MarkdownRendererRegistration.EmptyMessageKey, MarkdownRendererRegistration.EmptyMessageFallback);
        string errorTitle = localizer.GetString(
            MarkdownRendererRegistration.ErrorTitleKey, MarkdownRendererRegistration.ErrorTitleFallback);
        string errorMessage = string.IsNullOrWhiteSpace(model.ErrorMessage)
            ? localizer.GetString(MarkdownRendererRegistration.ErrorMessageKey, MarkdownRendererRegistration.ErrorMessageFallback)
            : model.ErrorMessage!;
        string retryLabel = localizer.GetString(
            MarkdownRendererRegistration.RetryKey, MarkdownRendererRegistration.RetryFallback);
        string copyLabel = localizer.GetString(
            MarkdownRendererRegistration.CopyKey, MarkdownRendererRegistration.CopyFallback);
        string copiedLabel = localizer.GetString(
            MarkdownRendererRegistration.CopiedKey, MarkdownRendererRegistration.CopiedFallback);
        string linkHint = localizer.GetString(
            MarkdownRendererRegistration.LinkOpensKey, MarkdownRendererRegistration.LinkOpensFallback);

        string automationName = BuildAutomationName(
            state, localizer, document, model.Markdown, chipText, emptyTitle, emptyMessage, errorTitle);

        return new MarkdownRendererDisplay(
            State: state,
            Document: document,
            FallbackText: model.Markdown,
            ShowFreshnessChip: showChip,
            FreshnessChipText: chipText,
            IsOffline: isOffline,
            EmptyTitle: emptyTitle,
            EmptyMessage: emptyMessage,
            ErrorTitle: errorTitle,
            ErrorMessage: errorMessage,
            RetryLabel: retryLabel,
            CopyLabel: copyLabel,
            CopiedLabel: copiedLabel,
            LinkOpensHint: linkHint,
            UpdatedAt: model.UpdatedAt,
            IsFetching: model.IsFetching,
            AutomationName: automationName);
    }

    /// <summary>
    /// The flattened plain-text reading of a document — every inline's text in order, blocks separated by a
    /// space. Used for the surface's accessible name so Narrator announces the message content, and reused by
    /// the parser's headless assertions.
    /// </summary>
    /// <param name="document">The parsed document.</param>
    /// <returns>The plain-text rendering.</returns>
    public static string FlattenText(MarkdownDocument document)
    {
        ArgumentNullException.ThrowIfNull(document);

        var sb = new StringBuilder();
        foreach (MarkdownBlock block in document.Blocks)
        {
            string text = FlattenBlock(block);
            if (text.Length == 0)
            {
                continue;
            }

            if (sb.Length > 0)
            {
                sb.Append(' ');
            }

            sb.Append(text);
        }

        return sb.ToString();
    }

    // Branch precedence from the chatbot host's message lifecycle. A "Ready" snapshot whose reply has no
    // renderable content collapses to the empty branch (never a blank box); a stale / offline snapshot keeps
    // its cached content under a freshness chip.
    private static MarkdownRendererState SelectState(MarkdownRendererModel model) => model.Status switch
    {
        MarkdownRendererState.Loading => MarkdownRendererState.Loading,
        MarkdownRendererState.Error => MarkdownRendererState.Error,
        MarkdownRendererState.Empty => MarkdownRendererState.Empty,
        MarkdownRendererState.Stale => MarkdownRendererState.Stale,
        MarkdownRendererState.Offline => MarkdownRendererState.Offline,
        _ => string.IsNullOrWhiteSpace(model.Markdown) || MarkdownParser.Parse(model.Markdown).IsEmpty
            ? MarkdownRendererState.Empty
            : MarkdownRendererState.Ready,
    };

    private static string BuildAutomationName(
        MarkdownRendererState state,
        ILocalizer localizer,
        MarkdownDocument document,
        string rawMarkdown,
        string chipText,
        string emptyTitle,
        string emptyMessage,
        string errorTitle)
    {
        string surface = localizer.GetString(
            MarkdownRendererRegistration.SurfaceNameKey, MarkdownRendererRegistration.SurfaceNameFallback);

        switch (state)
        {
            case MarkdownRendererState.Loading:
                string loading = localizer.GetString(
                    MarkdownRendererRegistration.LoadingKey, MarkdownRendererRegistration.LoadingFallback);
                string partial = rawMarkdown.Trim();
                return partial.Length == 0
                    ? string.Create(CultureInfo.CurrentCulture, $"{surface}. {loading}")
                    : string.Create(CultureInfo.CurrentCulture, $"{surface}. {loading}. {partial}");

            case MarkdownRendererState.Empty:
                return string.Create(CultureInfo.CurrentCulture, $"{surface}. {emptyTitle}. {emptyMessage}");

            case MarkdownRendererState.Error:
                return string.Create(CultureInfo.CurrentCulture, $"{surface}. {errorTitle}");

            default:
                string body = FlattenText(document);
                string baseName = body.Length == 0
                    ? surface
                    : string.Create(CultureInfo.CurrentCulture, $"{surface}. {body}");
                return chipText.Length == 0
                    ? baseName
                    : string.Create(CultureInfo.CurrentCulture, $"{baseName}. {chipText}");
        }
    }

    private static string FlattenBlock(MarkdownBlock block) => block switch
    {
        MarkdownParagraph p => FlattenInlines(p.Inlines),
        MarkdownHeading h => FlattenInlines(h.Inlines),
        MarkdownBlockQuote q => FlattenInlines(q.Inlines),
        MarkdownCodeBlock c => c.Code,
        MarkdownThematicBreak => string.Empty,
        MarkdownList list => FlattenList(list),
        MarkdownTable table => FlattenTable(table),
        _ => string.Empty,
    };

    private static string FlattenList(MarkdownList list)
    {
        var sb = new StringBuilder();
        foreach (MarkdownListItem item in list.Items)
        {
            if (sb.Length > 0)
            {
                sb.Append(' ');
            }

            sb.Append(FlattenInlines(item.Inlines));
        }

        return sb.ToString();
    }

    private static string FlattenTable(MarkdownTable table)
    {
        var sb = new StringBuilder();
        AppendCells(sb, table.Header);
        foreach (MarkdownTableRow row in table.Rows)
        {
            AppendCells(sb, row.Cells);
        }

        return sb.ToString();
    }

    private static void AppendCells(StringBuilder sb, IReadOnlyList<MarkdownTableCell> cells)
    {
        foreach (MarkdownTableCell cell in cells)
        {
            string text = FlattenInlines(cell.Inlines);
            if (text.Length == 0)
            {
                continue;
            }

            if (sb.Length > 0)
            {
                sb.Append(' ');
            }

            sb.Append(text);
        }
    }

    private static string FlattenInlines(IReadOnlyList<MarkdownInline> inlines)
    {
        var sb = new StringBuilder();
        foreach (MarkdownInline inline in inlines)
        {
            switch (inline.Kind)
            {
                case MarkdownInlineKind.Text:
                case MarkdownInlineKind.CodeSpan:
                    sb.Append(inline.Text);
                    break;
                case MarkdownInlineKind.LineBreak:
                    sb.Append(' ');
                    break;
                default:
                    sb.Append(FlattenInlines(inline.Children));
                    break;
            }
        }

        return sb.ToString();
    }
}

/// <summary>
/// Canonical metadata for the <c>MarkdownRenderer</c> feature surface — the native mirror of the web component at
/// <c>web/src/features/system/components/chatbot/MarkdownRenderer.tsx</c>. The web surface is anonymous (it renders
/// no labels of its own), so this holder pins the diagnostics slug, the Segoe Fluent glyphs standing in for the
/// surface's affordances (copy, empty message), and the i18n keys + English fallbacks for the native-only chrome
/// the platform contract requires (the Suspense-style loading announcement, the empty / error copy, the freshness
/// chips, the retry and copy affordance labels, the accessible link suffix and the surface name). UI-free so the
/// metadata is asserted headlessly.
/// </summary>
public static class MarkdownRendererRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "MarkdownRenderer";

    /// <summary>Segoe Fluent "Copy" glyph for the code-block copy affordance (matches the shared copy button).</summary>
    public const string CopyGlyph = "\uE8C8";

    /// <summary>Segoe Fluent "Message" glyph decorating the empty surface.</summary>
    public const string EmptyGlyph = "\uE8BD";

    /// <summary>i18n key for the surface's accessible name root (web doc: "an assistant chat message").</summary>
    public const string SurfaceNameKey = "chatbot.markdown.surfaceName";

    /// <summary>English fallback for <see cref="SurfaceNameKey"/>.</summary>
    public const string SurfaceNameFallback = "Assistant message";

    /// <summary>i18n key for the loading announcement (the web Suspense fallback has no label of its own).</summary>
    public const string LoadingKey = "common.loading";

    /// <summary>English fallback for <see cref="LoadingKey"/>.</summary>
    public const string LoadingFallback = "Loading";

    /// <summary>i18n key for the empty-state title.</summary>
    public const string EmptyTitleKey = "chatbot.markdown.empty.title";

    /// <summary>English fallback for <see cref="EmptyTitleKey"/>.</summary>
    public const string EmptyTitleFallback = "Nothing to display";

    /// <summary>i18n key for the empty-state message.</summary>
    public const string EmptyMessageKey = "chatbot.markdown.empty.message";

    /// <summary>English fallback for <see cref="EmptyMessageKey"/>.</summary>
    public const string EmptyMessageFallback = "This message has no content to render.";

    /// <summary>i18n key for the error heading (native-only — the web component has no error branch).</summary>
    public const string ErrorTitleKey = "chatbot.markdown.error.title";

    /// <summary>English fallback for <see cref="ErrorTitleKey"/>.</summary>
    public const string ErrorTitleFallback = "Couldn't render message";

    /// <summary>i18n key for the default error message.</summary>
    public const string ErrorMessageKey = "chatbot.markdown.error.message";

    /// <summary>English fallback for <see cref="ErrorMessageKey"/>.</summary>
    public const string ErrorMessageFallback = "We couldn't render this message. Please try again.";

    /// <summary>i18n key for the retry affordance label.</summary>
    public const string RetryKey = "common.retry";

    /// <summary>English fallback for <see cref="RetryKey"/>.</summary>
    public const string RetryFallback = "Retry";

    /// <summary>i18n key for the stale freshness chip.</summary>
    public const string StaleKey = "common.stale";

    /// <summary>English fallback for <see cref="StaleKey"/>.</summary>
    public const string StaleFallback = "Stale";

    /// <summary>i18n key for the offline freshness chip.</summary>
    public const string OfflineKey = "common.offline";

    /// <summary>English fallback for <see cref="OfflineKey"/>.</summary>
    public const string OfflineFallback = "Offline";

    /// <summary>i18n key for the code-block copy affordance idle label.</summary>
    public const string CopyKey = "common.copy";

    /// <summary>English fallback for <see cref="CopyKey"/>.</summary>
    public const string CopyFallback = "Copy";

    /// <summary>i18n key for the code-block copy affordance confirmation label.</summary>
    public const string CopiedKey = "common.copied";

    /// <summary>English fallback for <see cref="CopiedKey"/>.</summary>
    public const string CopiedFallback = "Copied";

    /// <summary>i18n key for the accessible "opens in your browser" suffix on links (web <c>target="_blank"</c>).</summary>
    public const string LinkOpensKey = "chatbot.markdown.linkOpensInBrowser";

    /// <summary>English fallback for <see cref="LinkOpensKey"/>.</summary>
    public const string LinkOpensFallback = "opens in your browser";
}

/// <summary>
/// PII-safe diagnostics for the <c>MarkdownRenderer</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never the assistant reply, a link target or any
/// message content — so a diagnostics line can never leak conversation data. Thread-safe.
/// </summary>
public sealed class MarkdownRendererDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">Optional sink invoked with each diagnostics line.</param>
    public MarkdownRendererDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=MarkdownRenderer</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={MarkdownRendererRegistration.Slug}");
    }
}
