using System.Globalization;
using System.Text;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive lifecycle branch of the <c>ChatMessageItem</c> surface — the native union of the states
/// the P2 feature-view contract requires for a single chat row
/// (web/src/features/system/components/chatbot/ChatMessageItem.tsx). The web component is a pure presentational
/// child: it takes one already-resolved <c>message</c> plus grouping / affordance props and performs no fetching,
/// so the parent chatbot page owns the conversation query lifecycle and supplies the active state. Every member
/// maps onto a visible surface; none is ever hidden behind a <c>{data &amp;&amp; …}</c> guard.
/// </summary>
public enum ChatMessageItemState
{
    /// <summary>The conversation query is in flight and this row has not resolved — skeleton bubble.</summary>
    Loading,

    /// <summary>A resolved message to render (the web fall-through) — the user / assistant bubble.</summary>
    Ready,

    /// <summary>Resolved with no renderable content — a friendly empty bubble, never a blank box.</summary>
    Empty,

    /// <summary>The conversation failed to load with no usable snapshot — a retriable error surface.</summary>
    Error,

    /// <summary>Showing a cached message older than the freshness window — the bubble plus a stale chip.</summary>
    Stale,

    /// <summary>No connectivity — the last cached message plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The author of a chat message — the native mirror of the web <c>message.role: 'user' | 'assistant'</c>
/// (web/src/api/types.ts <c>ChatMessage</c>). Drives bubble alignment, tint and which hover affordances appear.
/// </summary>
public enum ChatRole
{
    /// <summary>A message authored by the user (web <c>'user'</c>) — right-aligned, cyan tint.</summary>
    User,

    /// <summary>A message authored by the assistant (web <c>'assistant'</c>) — left-aligned, surface tint.</summary>
    Assistant,
}

/// <summary>The kind of an inline markdown span — the native subset of the web <c>MarkdownRenderer</c> element map.</summary>
public enum ChatMarkdownInlineKind
{
    /// <summary>Plain text run (a soft line break is carried as a run whose text is a single newline).</summary>
    Text,

    /// <summary>Strong emphasis (<c>**bold**</c> / <c>__bold__</c>).</summary>
    Bold,

    /// <summary>Emphasis (<c>*italic*</c> / <c>_italic_</c>).</summary>
    Italic,

    /// <summary>Inline code span (<c>`code`</c>) — rendered monospace, never re-parsed.</summary>
    Code,

    /// <summary>A link (<c>[text](href)</c>) — opens in a new tab, exactly like the web renderer.</summary>
    Link,
}

/// <summary>
/// One inline span within a markdown paragraph / heading / list item — the native, WinUI-free analogue of the
/// leaf nodes the web <c>react-markdown</c> tree produces. Pure data so the markdown adapter is unit-tested
/// without a XAML runtime.
/// </summary>
/// <param name="Kind">The span kind.</param>
/// <param name="Text">The literal text of the span (the visible label for a link).</param>
/// <param name="Href">The destination for a <see cref="ChatMarkdownInlineKind.Link"/>, otherwise null.</param>
public sealed record ChatMarkdownInline(ChatMarkdownInlineKind Kind, string Text, string? Href = null);

/// <summary>One item of a bullet / ordered markdown list — its already-parsed inline spans.</summary>
/// <param name="Inlines">The item's inline spans.</param>
public sealed record ChatMarkdownListItem(IReadOnlyList<ChatMarkdownInline> Inlines);

/// <summary>The kind of a top-level markdown block — the native subset of the web <c>MarkdownRenderer</c> block map.</summary>
public enum ChatMarkdownBlockKind
{
    /// <summary>A paragraph of inline spans (web <c>p</c>).</summary>
    Paragraph,

    /// <summary>A heading, level 1..3 (web <c>h1</c>/<c>h2</c>/<c>h3</c>); deeper levels clamp to 3.</summary>
    Heading,

    /// <summary>An unordered list (web <c>ul</c>).</summary>
    BulletList,

    /// <summary>An ordered list (web <c>ol</c>).</summary>
    OrderedList,

    /// <summary>A fenced code block (web fenced <c>code</c> → <c>CodeBlock</c>).</summary>
    CodeBlock,
}

/// <summary>
/// One top-level markdown block — the native, WinUI-free analogue of a child of the web
/// <c>react-markdown</c> root. Mirrors the element map the web <c>MarkdownRenderer</c> styles (paragraphs,
/// h1–h3 headings, unordered / ordered lists, inline + fenced code, links). Pure data so the markdown adapter
/// is asserted headlessly.
/// </summary>
/// <param name="Kind">The block kind.</param>
/// <param name="Inlines">Inline spans for a <see cref="ChatMarkdownBlockKind.Paragraph"/> / heading.</param>
/// <param name="Items">List items for a bullet / ordered list.</param>
/// <param name="HeadingLevel">Heading level 1..3 (only meaningful for a heading).</param>
/// <param name="OrderedStart">First ordinal of an ordered list (web <c>start</c>; defaults to 1).</param>
/// <param name="CodeText">Raw text of a fenced code block.</param>
/// <param name="CodeLanguage">Optional language hint of a fenced code block (web <c>language-go</c>).</param>
public sealed record ChatMarkdownBlock(
    ChatMarkdownBlockKind Kind,
    IReadOnlyList<ChatMarkdownInline> Inlines,
    IReadOnlyList<ChatMarkdownListItem> Items,
    int HeadingLevel = 0,
    int OrderedStart = 1,
    string? CodeText = null,
    string? CodeLanguage = null)
{
    /// <summary>Build a paragraph block from its inline spans.</summary>
    public static ChatMarkdownBlock Paragraph(IReadOnlyList<ChatMarkdownInline> inlines) =>
        new(ChatMarkdownBlockKind.Paragraph, inlines, Array.Empty<ChatMarkdownListItem>());

    /// <summary>Build a heading block (level clamped to 1..3) from its inline spans.</summary>
    public static ChatMarkdownBlock Heading(int level, IReadOnlyList<ChatMarkdownInline> inlines) =>
        new(ChatMarkdownBlockKind.Heading, inlines, Array.Empty<ChatMarkdownListItem>(), Math.Clamp(level, 1, 3));

    /// <summary>Build a bullet list block from its items.</summary>
    public static ChatMarkdownBlock Bullets(IReadOnlyList<ChatMarkdownListItem> items) =>
        new(ChatMarkdownBlockKind.BulletList, Array.Empty<ChatMarkdownInline>(), items);

    /// <summary>Build an ordered list block from its items and first ordinal.</summary>
    public static ChatMarkdownBlock Ordered(int start, IReadOnlyList<ChatMarkdownListItem> items) =>
        new(ChatMarkdownBlockKind.OrderedList, Array.Empty<ChatMarkdownInline>(), items, OrderedStart: Math.Max(1, start));

    /// <summary>Build a fenced code block from its raw text and optional language hint.</summary>
    public static ChatMarkdownBlock Code(string text, string? language) =>
        new(
            ChatMarkdownBlockKind.CodeBlock,
            Array.Empty<ChatMarkdownInline>(),
            Array.Empty<ChatMarkdownListItem>(),
            CodeText: text,
            CodeLanguage: string.IsNullOrWhiteSpace(language) ? null : language!.Trim());
}

/// <summary>
/// A deterministic, dependency-free markdown adapter — the native stand-in for the web chatbot
/// <c>MarkdownRenderer</c> (react-markdown + remark-gfm) used to render assistant replies. It reproduces the
/// element set the web renderer styles: paragraphs (with soft line breaks preserved), ATX headings (<c>#</c>..
/// <c>######</c>, clamped to h1–h3 like the web map), unordered (<c>-</c>/<c>*</c>/<c>+</c>) and ordered
/// (<c>1.</c>/<c>1)</c>) lists, fenced code blocks (with a language hint), and the inline spans bold / italic /
/// inline-code / links. Like the web renderer it is safe-by-default — raw HTML is never interpreted, it is
/// emitted as literal text. Pure and WinUI-free so the projection is unit-tested without a UI host.
/// </summary>
public static class ChatMarkdown
{
    private const int MaxHeadingHashes = 6;

    /// <summary>Parse markdown <paramref name="source"/> into the ordered block list the view renders.</summary>
    /// <param name="source">The raw markdown source (the assistant reply or its streamed prefix).</param>
    /// <returns>The parsed blocks; an empty list for null / whitespace input.</returns>
    public static IReadOnlyList<ChatMarkdownBlock> Parse(string? source)
    {
        var blocks = new List<ChatMarkdownBlock>();
        if (string.IsNullOrEmpty(source))
        {
            return blocks;
        }

        string[] lines = source.Replace("\r\n", "\n", StringComparison.Ordinal)
            .Replace('\r', '\n')
            .Split('\n');

        var paragraph = new List<string>();

        void FlushParagraph()
        {
            if (paragraph.Count == 0)
            {
                return;
            }

            var inlines = new List<ChatMarkdownInline>();
            for (int p = 0; p < paragraph.Count; p++)
            {
                if (p > 0)
                {
                    // Soft line break between wrapped lines of the same paragraph.
                    inlines.Add(new ChatMarkdownInline(ChatMarkdownInlineKind.Text, "\n"));
                }

                inlines.AddRange(ParseInlines(paragraph[p]));
            }

            blocks.Add(ChatMarkdownBlock.Paragraph(inlines));
            paragraph.Clear();
        }

        for (int i = 0; i < lines.Length; i++)
        {
            string line = lines[i];
            string trimmed = line.TrimStart();

            if (trimmed.StartsWith("```", StringComparison.Ordinal))
            {
                FlushParagraph();
                string language = trimmed[3..].Trim();
                var code = new List<string>();
                i++;
                while (i < lines.Length && !lines[i].TrimStart().StartsWith("```", StringComparison.Ordinal))
                {
                    code.Add(lines[i]);
                    i++;
                }

                blocks.Add(ChatMarkdownBlock.Code(string.Join("\n", code), language));
                continue;
            }

            if (string.IsNullOrWhiteSpace(line))
            {
                FlushParagraph();
                continue;
            }

            int headingLevel = HeadingLevel(trimmed);
            if (headingLevel > 0)
            {
                FlushParagraph();
                string text = trimmed[headingLevel..].Trim();
                blocks.Add(ChatMarkdownBlock.Heading(headingLevel, ParseInlines(text)));
                continue;
            }

            if (TryBulletItem(trimmed, out string bulletText))
            {
                FlushParagraph();
                var items = new List<ChatMarkdownListItem> { new(ParseInlines(bulletText)) };
                while (i + 1 < lines.Length && TryBulletItem(lines[i + 1].TrimStart(), out string nextText))
                {
                    items.Add(new ChatMarkdownListItem(ParseInlines(nextText)));
                    i++;
                }

                blocks.Add(ChatMarkdownBlock.Bullets(items));
                continue;
            }

            if (TryOrderedItem(trimmed, out int start, out string orderedText))
            {
                FlushParagraph();
                var items = new List<ChatMarkdownListItem> { new(ParseInlines(orderedText)) };
                while (i + 1 < lines.Length && TryOrderedItem(lines[i + 1].TrimStart(), out _, out string nextOrdered))
                {
                    items.Add(new ChatMarkdownListItem(ParseInlines(nextOrdered)));
                    i++;
                }

                blocks.Add(ChatMarkdownBlock.Ordered(start, items));
                continue;
            }

            paragraph.Add(line.Trim());
        }

        FlushParagraph();
        return blocks;
    }

    /// <summary>Parse a single line of markdown into its inline spans (bold / italic / code / link / text).</summary>
    /// <param name="text">The line text.</param>
    /// <returns>The ordered inline spans.</returns>
    public static IReadOnlyList<ChatMarkdownInline> ParseInlines(string text)
    {
        var spans = new List<ChatMarkdownInline>();
        if (string.IsNullOrEmpty(text))
        {
            return spans;
        }

        var buffer = new StringBuilder();

        void Flush()
        {
            if (buffer.Length > 0)
            {
                spans.Add(new ChatMarkdownInline(ChatMarkdownInlineKind.Text, buffer.ToString()));
                buffer.Clear();
            }
        }

        int i = 0;
        while (i < text.Length)
        {
            char c = text[i];

            if (c == '`')
            {
                int close = text.IndexOf('`', i + 1);
                if (close > i)
                {
                    Flush();
                    spans.Add(new ChatMarkdownInline(ChatMarkdownInlineKind.Code, text[(i + 1)..close]));
                    i = close + 1;
                    continue;
                }

                buffer.Append(c);
                i++;
                continue;
            }

            if (c == '[' && TryParseLink(text, i, out string label, out string href, out int linkEnd))
            {
                Flush();
                spans.Add(new ChatMarkdownInline(ChatMarkdownInlineKind.Link, label, href));
                i = linkEnd;
                continue;
            }

            if (c == '*' || c == '_')
            {
                if (i + 1 < text.Length && text[i + 1] == c)
                {
                    string delim = new(c, 2);
                    int close = text.IndexOf(delim, i + 2, StringComparison.Ordinal);
                    if (close > i + 1)
                    {
                        Flush();
                        spans.Add(new ChatMarkdownInline(ChatMarkdownInlineKind.Bold, text[(i + 2)..close]));
                        i = close + 2;
                        continue;
                    }

                    buffer.Append(delim);
                    i += 2;
                    continue;
                }
                else
                {
                    int close = text.IndexOf(c, i + 1);
                    if (close > i)
                    {
                        Flush();
                        spans.Add(new ChatMarkdownInline(ChatMarkdownInlineKind.Italic, text[(i + 1)..close]));
                        i = close + 1;
                        continue;
                    }

                    buffer.Append(c);
                    i++;
                    continue;
                }
            }

            buffer.Append(c);
            i++;
        }

        Flush();
        return spans;
    }

    private static int HeadingLevel(string trimmed)
    {
        int hashes = 0;
        while (hashes < trimmed.Length && hashes <= MaxHeadingHashes && trimmed[hashes] == '#')
        {
            hashes++;
        }

        if (hashes == 0 || hashes > MaxHeadingHashes)
        {
            return 0;
        }

        // A valid ATX heading requires whitespace (or end of line) after the hashes.
        return hashes < trimmed.Length && !char.IsWhiteSpace(trimmed[hashes]) ? 0 : hashes;
    }

    private static bool TryBulletItem(string trimmed, out string content)
    {
        content = string.Empty;
        if (trimmed.Length < 2)
        {
            return false;
        }

        char marker = trimmed[0];
        if ((marker == '-' || marker == '*' || marker == '+') && char.IsWhiteSpace(trimmed[1]))
        {
            content = trimmed[2..].Trim();
            return true;
        }

        return false;
    }

    private static bool TryOrderedItem(string trimmed, out int start, out string content)
    {
        start = 1;
        content = string.Empty;

        int digits = 0;
        while (digits < trimmed.Length && char.IsDigit(trimmed[digits]))
        {
            digits++;
        }

        if (digits == 0 || digits + 1 >= trimmed.Length)
        {
            return false;
        }

        char separator = trimmed[digits];
        if ((separator != '.' && separator != ')') || !char.IsWhiteSpace(trimmed[digits + 1]))
        {
            return false;
        }

        start = int.TryParse(trimmed[..digits], NumberStyles.Integer, CultureInfo.InvariantCulture, out int parsed)
            ? parsed
            : 1;
        content = trimmed[(digits + 2)..].Trim();
        return true;
    }

    private static bool TryParseLink(string text, int open, out string label, out string href, out int end)
    {
        label = string.Empty;
        href = string.Empty;
        end = open;

        int close = text.IndexOf(']', open + 1);
        if (close <= open || close + 1 >= text.Length || text[close + 1] != '(')
        {
            return false;
        }

        int hrefEnd = text.IndexOf(')', close + 2);
        if (hrefEnd <= close + 1)
        {
            return false;
        }

        label = text[(open + 1)..close];
        href = text[(close + 2)..hrefEnd].Trim();
        end = hrefEnd + 1;
        return true;
    }
}

/// <summary>
/// One chat message — the native analogue of the web <c>UIChatMessage</c>
/// (web/src/features/system/components/chatbot/ChatMessageItem.tsx), which extends the wire <c>ChatMessage</c>
/// (web/src/api/types.ts) with the UI-only streaming fields. Mirrors the web shape: <see cref="Role"/> is the
/// author, <see cref="Content"/> the canonical text (used for copy + as the edit seed), <see cref="CreatedAt"/>
/// the timestamp, <see cref="IsStreaming"/> gates the typewriter cursor and suppresses the action row, and
/// <see cref="StreamedText"/> is the partial reveal that falls back to <see cref="Content"/>. Pure data — no WinUI
/// types.
/// </summary>
/// <param name="Id">Stable message id (web <c>id</c>).</param>
/// <param name="Role">The author (web <c>role</c>).</param>
/// <param name="Content">The canonical message text (web <c>content</c>).</param>
/// <param name="CreatedAt">The message timestamp (web <c>created_at</c>), or null.</param>
/// <param name="IsStreaming">Whether the reply is mid-reveal (web <c>isStreaming</c>).</param>
/// <param name="StreamedText">The partial reveal during the typewriter animation (web <c>streamedText</c>).</param>
public sealed record ChatMessageData(
    string Id,
    ChatRole Role,
    string Content,
    DateTimeOffset? CreatedAt = null,
    bool IsStreaming = false,
    string? StreamedText = null)
{
    /// <summary>The text actually shown — the web <c>streamedText ?? content</c>.</summary>
    public string VisibleText => StreamedText ?? Content ?? string.Empty;
}

/// <summary>
/// The render-time data model the <c>ChatMessageItem</c> view binds to — the native analogue of the web
/// component's <c>message</c> + grouping / affordance props plus the parent-supplied lifecycle
/// <see cref="Status"/> and freshness flags. The view never performs HTTP; the parent chatbot state holder fills
/// this in (the native P1/S8 seam). Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Status">The parent-supplied lifecycle state.</param>
/// <param name="Message">The message to render, or null for the loading / empty / error states.</param>
/// <param name="IsLastAssistant">Last assistant reply in the list — gates the regenerate affordance (web prop).</param>
/// <param name="IsLastUser">Last user message in the list — gates the inline edit affordance (web prop).</param>
/// <param name="IsFirstInGroup">First of a same-role run — shows the avatar (web prop).</param>
/// <param name="IsLastInGroup">Last of a same-role run — shows the timestamp (web prop).</param>
/// <param name="ActionsDisabled">Suppress the whole action row while another reply streams (web prop).</param>
/// <param name="CanRegenerate">Whether the host wired a regenerate handler (web <c>onRegenerate</c> presence).</param>
/// <param name="CanEditAndResend">Whether the host wired an edit handler (web <c>onEditAndResend</c> presence).</param>
/// <param name="UpdatedAt">Last successful update timestamp surfaced in the freshness chip.</param>
/// <param name="IsFetching">True while a background refresh is in flight.</param>
/// <param name="ErrorMessage">Already-localized error message for the error / offline surfaces, when set.</param>
public sealed record ChatMessageItemModel(
    ChatMessageItemState Status,
    ChatMessageData? Message,
    bool IsLastAssistant = false,
    bool IsLastUser = false,
    bool IsFirstInGroup = true,
    bool IsLastInGroup = true,
    bool ActionsDisabled = false,
    bool CanRegenerate = false,
    bool CanEditAndResend = false,
    DateTimeOffset? UpdatedAt = null,
    bool IsFetching = false,
    string? ErrorMessage = null)
{
    /// <summary>The initial model: the conversation query is in flight and this row has not resolved.</summary>
    public static ChatMessageItemModel Loading() => new(ChatMessageItemState.Loading, null);

    /// <summary>A resolved model with no renderable message — the empty bubble.</summary>
    public static ChatMessageItemModel Empty() => new(ChatMessageItemState.Empty, null);

    /// <summary>A hard-failure model (no usable snapshot) carrying an optional already-localized message.</summary>
    /// <param name="message">An already-localized error message, or null for the default copy.</param>
    public static ChatMessageItemModel Failed(string? message = null) =>
        new(ChatMessageItemState.Error, null, ErrorMessage: message);

    /// <summary>A fresh resolved model carrying the message to render.</summary>
    /// <param name="message">The message.</param>
    /// <param name="isLastAssistant">Whether this is the last assistant reply.</param>
    /// <param name="isLastUser">Whether this is the last user message.</param>
    /// <param name="isFirstInGroup">Whether this row starts a same-role run.</param>
    /// <param name="isLastInGroup">Whether this row ends a same-role run.</param>
    /// <param name="actionsDisabled">Whether the whole action row is suppressed.</param>
    /// <param name="canRegenerate">Whether a regenerate handler is wired.</param>
    /// <param name="canEditAndResend">Whether an edit handler is wired.</param>
    /// <param name="updatedAt">The freshness timestamp.</param>
    /// <param name="isFetching">True while a background refresh is in flight.</param>
    public static ChatMessageItemModel Ready(
        ChatMessageData message,
        bool isLastAssistant = false,
        bool isLastUser = false,
        bool isFirstInGroup = true,
        bool isLastInGroup = true,
        bool actionsDisabled = false,
        bool canRegenerate = false,
        bool canEditAndResend = false,
        DateTimeOffset? updatedAt = null,
        bool isFetching = false)
    {
        ArgumentNullException.ThrowIfNull(message);
        return new(
            ChatMessageItemState.Ready,
            message,
            isLastAssistant,
            isLastUser,
            isFirstInGroup,
            isLastInGroup,
            actionsDisabled,
            canRegenerate,
            canEditAndResend,
            updatedAt,
            isFetching);
    }

    /// <summary>A stale snapshot (older than the freshness window) carrying the cached message.</summary>
    /// <param name="message">The cached message.</param>
    /// <param name="updatedAt">The freshness timestamp.</param>
    public static ChatMessageItemModel Stale(ChatMessageData message, DateTimeOffset? updatedAt = null)
    {
        ArgumentNullException.ThrowIfNull(message);
        return new(ChatMessageItemState.Stale, message, IsLastInGroup: true, UpdatedAt: updatedAt);
    }

    /// <summary>An offline snapshot (no connectivity) carrying the last cached message.</summary>
    /// <param name="message">The cached message.</param>
    /// <param name="updatedAt">The freshness timestamp.</param>
    /// <param name="message2">An already-localized offline message, or null for the default copy.</param>
    public static ChatMessageItemModel Offline(
        ChatMessageData message,
        DateTimeOffset? updatedAt = null,
        string? message2 = null)
    {
        ArgumentNullException.ThrowIfNull(message);
        return new(ChatMessageItemState.Offline, message, IsLastInGroup: true, UpdatedAt: updatedAt, ErrorMessage: message2);
    }
}

/// <summary>
/// The fully projected, render-ready view of one <c>ChatMessageItem</c> input — the native analogue of everything
/// the web component computes before returning JSX. Holds the resolved lifecycle <see cref="State"/>, the author
/// flags, the visibility gates the web derives (<see cref="ShowAvatar"/> / <see cref="ShowTimestamp"/> /
/// <see cref="ShowActions"/>), the visible / raw text, the parsed markdown for an assistant reply, the per-action
/// visibility + localized labels and Narrator aria-labels, the freshness chip + lifecycle copy, the freshness
/// metadata, and the composed surface <see cref="AutomationName"/>. Pure data so every branch is asserted
/// headlessly.
/// </summary>
public sealed record ChatMessageItemDisplay(
    ChatMessageItemState State,
    bool IsUser,
    bool IsStreaming,
    bool ShowAvatar,
    bool ShowTimestamp,
    bool ShowActions,
    bool ShowCopy,
    bool ShowRegenerate,
    bool ShowEdit,
    string VisibleText,
    string Content,
    string TimestampText,
    IReadOnlyList<ChatMarkdownBlock> MarkdownBlocks,
    string CopyAriaLabel,
    string RegenerateLabel,
    string RegenerateAriaLabel,
    string EditLabel,
    string EditAriaLabel,
    string CancelLabel,
    string SaveLabel,
    string EditMessageAriaLabel,
    bool ShowFreshnessChip,
    string FreshnessChipText,
    StatusKind FreshnessChipStatus,
    string EmptyMessage,
    string LoadingLabel,
    string ErrorTitle,
    string ErrorMessage,
    string RetryLabel,
    DateTimeOffset? UpdatedAt,
    bool IsFetching,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="ChatMessageItemModel"/> to its <see cref="ChatMessageItemDisplay"/> — the
/// native port of web/src/features/system/components/chatbot/ChatMessageItem.tsx. Branch precedence mirrors the
/// web parent's data lifecycle (loading → error → empty → freshness → ready); a snapshot whose message has no
/// renderable, non-streaming text collapses to a friendly empty bubble. The visibility gates reproduce the web
/// derivations verbatim — <c>showAvatar = isFirstInGroup</c>, <c>showTimestamp = isLastInGroup &amp;&amp;
/// !isStreaming</c>, <c>showActions = !isStreaming &amp;&amp; !actionsDisabled</c> (the view additionally hides
/// actions while its inline editor is open, exactly like the web <c>!editing</c> term) — and the per-action
/// visibility follows the web: copy on every content row, regenerate only on the last assistant reply when a
/// handler is wired, edit only on the last user message when a handler is wired. Assistant replies are parsed to
/// markdown blocks (the web <c>MarkdownRenderer</c>); user messages stay literal (the web <c>&lt;p&gt;</c>). No
/// WinUI types — unit-tested without a UI host.
/// </summary>
public static class ChatMessageItemProjection
{
    /// <summary>i18n key for the inline editor's Narrator label (web <c>chatbot.aria.editMessage</c>).</summary>
    public const string EditMessageAriaKey = "chatbot.aria.editMessage";

    /// <summary>English fallback for <see cref="EditMessageAriaKey"/>.</summary>
    public const string EditMessageAriaFallback = "Edit message";

    /// <summary>i18n key for the editor's cancel button (web <c>chatbot.actions.cancel</c>).</summary>
    public const string CancelKey = "chatbot.actions.cancel";

    /// <summary>English fallback for <see cref="CancelKey"/>.</summary>
    public const string CancelFallback = "Cancel";

    /// <summary>i18n key for the editor's save button (web <c>chatbot.actions.saveAndResend</c>).</summary>
    public const string SaveKey = "chatbot.actions.saveAndResend";

    /// <summary>English fallback for <see cref="SaveKey"/>.</summary>
    public const string SaveFallback = "Save & resend";

    /// <summary>i18n key for the copy affordance's Narrator label (web <c>chatbot.aria.copyMessage</c>).</summary>
    public const string CopyAriaKey = "chatbot.aria.copyMessage";

    /// <summary>English fallback for <see cref="CopyAriaKey"/>.</summary>
    public const string CopyAriaFallback = "Copy message";

    /// <summary>i18n key for the regenerate affordance's Narrator label (web <c>chatbot.aria.regenerate</c>).</summary>
    public const string RegenerateAriaKey = "chatbot.aria.regenerate";

    /// <summary>English fallback for <see cref="RegenerateAriaKey"/>.</summary>
    public const string RegenerateAriaFallback = "Regenerate response";

    /// <summary>i18n key for the regenerate affordance's label (web <c>chatbot.actions.regenerate</c>).</summary>
    public const string RegenerateKey = "chatbot.actions.regenerate";

    /// <summary>English fallback for <see cref="RegenerateKey"/>.</summary>
    public const string RegenerateFallback = "Regenerate";

    /// <summary>i18n key for the edit affordance's Narrator label (web <c>chatbot.aria.edit</c>).</summary>
    public const string EditAriaKey = "chatbot.aria.edit";

    /// <summary>English fallback for <see cref="EditAriaKey"/>.</summary>
    public const string EditAriaFallback = "Edit and resend";

    /// <summary>i18n key for the edit affordance's label (web <c>chatbot.actions.edit</c>).</summary>
    public const string EditKey = "chatbot.actions.edit";

    /// <summary>English fallback for <see cref="EditKey"/>.</summary>
    public const string EditFallback = "Edit";

    /// <summary>i18n key for the loading copy (the shared <c>common.loading</c> string).</summary>
    public const string LoadingKey = "common.loading";

    /// <summary>English fallback for <see cref="LoadingKey"/>.</summary>
    public const string LoadingFallback = "Loading...";

    /// <summary>i18n key for the empty-bubble copy (the shared <c>common.noData</c> string).</summary>
    public const string EmptyKey = "common.noData";

    /// <summary>English fallback for <see cref="EmptyKey"/>.</summary>
    public const string EmptyFallback = "No data available";

    /// <summary>i18n key for the error title (the shared <c>error.loadFailed</c> string).</summary>
    public const string ErrorTitleKey = "error.loadFailed";

    /// <summary>English fallback for <see cref="ErrorTitleKey"/>.</summary>
    public const string ErrorTitleFallback = "Failed to load data";

    /// <summary>i18n key for the default error body (the shared network message).</summary>
    public const string ErrorMessageKey = "error.network.message";

    /// <summary>English fallback for <see cref="ErrorMessageKey"/>.</summary>
    public const string ErrorMessageFallback = "Check your internet connection and try again.";

    /// <summary>i18n key for the retry affordance (the shared <c>common.retry</c> string).</summary>
    public const string RetryKey = "common.retry";

    /// <summary>English fallback for <see cref="RetryKey"/>.</summary>
    public const string RetryFallback = "Retry";

    /// <summary>i18n key for the offline chip (the shared <c>common.offline</c> string).</summary>
    public const string OfflineKey = "common.offline";

    /// <summary>English fallback for <see cref="OfflineKey"/>.</summary>
    public const string OfflineFallback = "Offline";

    /// <summary>i18n key for the stale chip (the shared <c>common.stale</c> string).</summary>
    public const string StaleKey = "common.stale";

    /// <summary>English fallback for <see cref="StaleKey"/>.</summary>
    public const string StaleFallback = "Stale";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web message + grouping props + lifecycle).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <returns>The render-ready display model.</returns>
    public static ChatMessageItemDisplay Project(ChatMessageItemModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        ChatMessageData? message = model.Message;
        bool isUser = message?.Role == ChatRole.User;
        bool isStreaming = message?.IsStreaming ?? false;
        string visibleText = message?.VisibleText ?? string.Empty;
        string content = message?.Content ?? string.Empty;

        ChatMessageItemState state = SelectState(model, visibleText, isStreaming);
        bool isContent = state is ChatMessageItemState.Ready or ChatMessageItemState.Stale or ChatMessageItemState.Offline;

        // web: showActions = !message.isStreaming && !actionsDisabled (&& !editing — the view owns the editing term).
        bool showActions = isContent && !isStreaming && !model.ActionsDisabled;
        bool showRegenerate = showActions && !isUser && model.IsLastAssistant && model.CanRegenerate;
        bool showEdit = showActions && isUser && model.IsLastUser && model.CanEditAndResend;

        IReadOnlyList<ChatMarkdownBlock> markdown = isContent && !isUser
            ? ChatMarkdown.Parse(visibleText)
            : Array.Empty<ChatMarkdownBlock>();

        string copyAria = localizer.GetString(CopyAriaKey, CopyAriaFallback);
        string regenerateLabel = localizer.GetString(RegenerateKey, RegenerateFallback);
        string regenerateAria = localizer.GetString(RegenerateAriaKey, RegenerateAriaFallback);
        string editLabel = localizer.GetString(EditKey, EditFallback);
        string editAria = localizer.GetString(EditAriaKey, EditAriaFallback);
        string cancelLabel = localizer.GetString(CancelKey, CancelFallback);
        string saveLabel = localizer.GetString(SaveKey, SaveFallback);
        string editMessageAria = localizer.GetString(EditMessageAriaKey, EditMessageAriaFallback);

        string loadingLabel = localizer.GetString(LoadingKey, LoadingFallback);
        string emptyMessage = localizer.GetString(EmptyKey, EmptyFallback);
        string errorTitle = localizer.GetString(ErrorTitleKey, ErrorTitleFallback);
        string errorMessage = string.IsNullOrWhiteSpace(model.ErrorMessage)
            ? localizer.GetString(ErrorMessageKey, ErrorMessageFallback)
            : model.ErrorMessage!;
        string retryLabel = localizer.GetString(RetryKey, RetryFallback);

        bool showChip = state is ChatMessageItemState.Stale or ChatMessageItemState.Offline;
        string chipText = state switch
        {
            ChatMessageItemState.Offline => localizer.GetString(OfflineKey, OfflineFallback),
            ChatMessageItemState.Stale => localizer.GetString(StaleKey, StaleFallback),
            _ => string.Empty,
        };
        StatusKind chipStatus = state == ChatMessageItemState.Offline ? StatusKind.Danger : StatusKind.Warning;

        // web formatTime(message.created_at) — absolute local clock time; em-dash for a null timestamp.
        string timestampText = DateTimeFormatting.Format(message?.CreatedAt, DateTimeVariant.Time, default);

        bool showTimestamp = isContent && model.IsLastInGroup && !isStreaming && message?.CreatedAt is not null;
        bool showAvatar = model.IsFirstInGroup;

        string automationName = BuildAutomationName(
            state, visibleText, showChip, chipText, emptyMessage, loadingLabel, errorTitle);

        return new ChatMessageItemDisplay(
            State: state,
            IsUser: isUser,
            IsStreaming: isStreaming,
            ShowAvatar: showAvatar,
            ShowTimestamp: showTimestamp,
            ShowActions: showActions,
            ShowCopy: showActions,
            ShowRegenerate: showRegenerate,
            ShowEdit: showEdit,
            VisibleText: visibleText,
            Content: content,
            TimestampText: timestampText,
            MarkdownBlocks: markdown,
            CopyAriaLabel: copyAria,
            RegenerateLabel: regenerateLabel,
            RegenerateAriaLabel: regenerateAria,
            EditLabel: editLabel,
            EditAriaLabel: editAria,
            CancelLabel: cancelLabel,
            SaveLabel: saveLabel,
            EditMessageAriaLabel: editMessageAria,
            ShowFreshnessChip: showChip,
            FreshnessChipText: chipText,
            FreshnessChipStatus: chipStatus,
            EmptyMessage: emptyMessage,
            LoadingLabel: loadingLabel,
            ErrorTitle: errorTitle,
            ErrorMessage: errorMessage,
            RetryLabel: retryLabel,
            UpdatedAt: model.UpdatedAt,
            IsFetching: model.IsFetching,
            AutomationName: automationName);
    }

    /// <summary>
    /// Whether a submitted edit is a no-op — the native port of the web guard
    /// <c>!trimmed || trimmed === message.content.trim()</c>: an empty draft, or one whose trimmed text equals the
    /// trimmed original, is discarded rather than resent.
    /// </summary>
    /// <param name="draft">The editor's current text.</param>
    /// <param name="original">The message's canonical content.</param>
    /// <returns>True when the edit should be cancelled instead of resent.</returns>
    public static bool IsNoOpEdit(string? draft, string? original)
    {
        string trimmed = (draft ?? string.Empty).Trim();
        return trimmed.Length == 0 || string.Equals(trimmed, (original ?? string.Empty).Trim(), StringComparison.Ordinal);
    }

    // Branch precedence from the web parent's data lifecycle. Loading / Error / Empty / Stale / Offline come from
    // the parent's classification; a fresh "Ready" snapshot (or a cached one) with no renderable, non-streaming
    // text has nothing to show and collapses to the friendly empty bubble.
    private static ChatMessageItemState SelectState(ChatMessageItemModel model, string visibleText, bool isStreaming) =>
        model.Status switch
        {
            ChatMessageItemState.Loading => ChatMessageItemState.Loading,
            ChatMessageItemState.Error => ChatMessageItemState.Error,
            ChatMessageItemState.Empty => ChatMessageItemState.Empty,
            ChatMessageItemState.Stale => model.Message is null ? ChatMessageItemState.Empty : ChatMessageItemState.Stale,
            ChatMessageItemState.Offline => model.Message is null
                ? ChatMessageItemState.Empty
                : ChatMessageItemState.Offline,
            _ => model.Message is null || (!isStreaming && string.IsNullOrWhiteSpace(visibleText))
                ? ChatMessageItemState.Empty
                : ChatMessageItemState.Ready,
        };

    private static string BuildAutomationName(
        ChatMessageItemState state,
        string visibleText,
        bool showChip,
        string chipText,
        string emptyMessage,
        string loadingLabel,
        string errorTitle)
    {
        switch (state)
        {
            case ChatMessageItemState.Loading:
                return loadingLabel;
            case ChatMessageItemState.Empty:
                return emptyMessage;
            case ChatMessageItemState.Error:
                return errorTitle;
            default:
                // The bubble reads its message text (the web surface has no explicit role announcement); the
                // freshness chip is spoken first for a cached row so its provenance is clear.
                var parts = new List<string>(2);
                if (showChip && !string.IsNullOrWhiteSpace(chipText))
                {
                    parts.Add(chipText);
                }

                string spoken = string.IsNullOrWhiteSpace(visibleText) ? emptyMessage : visibleText.Trim();
                parts.Add(spoken);
                return string.Join(". ", parts);
        }
    }
}

/// <summary>
/// The new text a host should resend when the user submits the inline editor — the native analogue of the web
/// <c>onEditAndResend(message, newText)</c> callback's second argument. The owning view raises this only after the
/// no-op guard (<see cref="ChatMessageItemProjection.IsNoOpEdit"/>) passes, so the carried text is always a real,
/// trimmed change.
/// </summary>
public sealed class ChatMessageEditRequestedEventArgs : EventArgs
{
    /// <summary>Creates the event payload over the trimmed, resend-ready text.</summary>
    /// <param name="newText">The edited message text to resend.</param>
    public ChatMessageEditRequestedEventArgs(string newText) => NewText = newText;

    /// <summary>The edited message text to resend (web <c>newText</c>).</summary>
    public string NewText { get; }
}

/// <summary>
/// PII-safe diagnostics for the <c>ChatMessageItem</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never the message content, role or timestamp — so
/// a diagnostics line can never leak conversation data. Thread-safe.
/// </summary>
public sealed class ChatMessageItemDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public ChatMessageItemDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ChatMessageItem</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(string.Create(
            CultureInfo.InvariantCulture, $"view.opened slug={ChatMessageItemRegistration.Slug}"));
    }
}

/// <summary>
/// Canonical metadata for the <c>ChatMessageItem</c> feature surface — the native mirror of the web component at
/// <c>web/src/features/system/components/chatbot/ChatMessageItem.tsx</c>. UI-free so the metadata is asserted in
/// tests.
/// </summary>
public static class ChatMessageItemRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "ChatMessageItem";
}
