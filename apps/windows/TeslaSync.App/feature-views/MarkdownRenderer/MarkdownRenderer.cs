using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Documents;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;
using Windows.UI.Text;

namespace TeslaSync.App.FeatureViews.Chatbot;

/// <summary>
/// The native WinUI 3 <c>MarkdownRenderer</c> feature surface — a parity port of
/// web/src/features/system/components/chatbot/MarkdownRenderer.tsx. The web component renders an assistant chat
/// reply as sanitized markdown: it lazy-loads react-markdown + remark-gfm behind <c>React.lazy</c> /
/// <c>Suspense</c> (the fallback shows the raw text with line breaks preserved) and renders headings, paragraphs,
/// lists, fenced code (delegated to <c>CodeBlock</c>), GFM tables, links (opened in a new tab with
/// <c>rel="noopener noreferrer"</c>) and inline formatting — never executing embedded raw HTML, because
/// <c>rehype-raw</c> is deliberately not enabled. This surface reproduces that composition with native
/// primitives: assign a <see cref="Model"/> (the web <c>children</c> string plus the host-supplied lifecycle
/// status) and it renders one of the contract's states — <see cref="MarkdownRendererState.Loading"/> (the
/// Suspense fallback: the raw reply, line breaks preserved), <see cref="MarkdownRendererState.Empty"/> (a
/// friendly empty state, never a blank box), <see cref="MarkdownRendererState.Error"/> (a retriable
/// <see cref="TsQueryError"/>), or the rendered document (<see cref="MarkdownRendererState.Ready"/> /
/// <see cref="MarkdownRendererState.Stale"/> / <see cref="MarkdownRendererState.Offline"/>, the last two layering
/// a freshness chip). The view never performs HTTP; all branch selection and markdown parsing happen in the
/// WinUI-free <see cref="MarkdownParser"/> / <see cref="MarkdownRendererProjection"/>. The surface and each link
/// carry a Narrator name, every label resolves through the i18n facade, and — like the web source, which adds no
/// animation — the surface is static, so the reduced-motion setting is honoured by construction. A failed
/// snapshot's retry affordance raises <see cref="RetryRequested"/> for the host to act on (the host owns the
/// message lifecycle).
/// </summary>
public sealed partial class MarkdownRenderer : ContentControl
{
    private const double BlockSpacing = 8;            // web prose-chat space-y-1 plus per-element margins
    private const double ListMarkerGap = 8;           // web pl-5 indent / marker gap
    private const double ListItemSpacing = 2;         // web space-y-0.5 between list rows
    private const double BodyFontSize = 14;           // web text-sm prose body
    private const double CodeFontSize = 13;           // web inline / block monospace
    private const double Heading1FontSize = 16;       // web h1 text-base
    private const double Heading2FontSize = 14;       // web h2 text-sm
    private const double CodeBlockPadding = 12;
    private const double CodeBlockHeaderHeight = 32;
    private const double CellPaddingX = 8;            // web th/td px-2
    private const double CellPaddingY = 4;            // web th/td py-1
    private const double ChipPaddingX = 8;
    private const double ChipPaddingY = 2;
    private const double QuoteBarWidth = 3;
    private const double QuoteInnerGap = 10;
    private const ushort HeadingWeight = 600;         // web font-semibold

    private readonly ILocalizer _localizer;
    private readonly MarkdownRendererDiagnostics _diagnostics;

    private MarkdownRendererModel _model;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="MarkdownRendererModel.Empty()"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public MarkdownRenderer(
        ILocalizer localizer,
        MarkdownRendererModel? model = null,
        MarkdownRendererDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? MarkdownRendererModel.Empty();
        _diagnostics = diagnostics ?? new MarkdownRendererDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>Raised when the error surface's retry affordance is invoked (the host re-runs the request).</summary>
    public event EventHandler? RetryRequested;

    /// <summary>The canonical diagnostics slug this surface registers under (<c>MarkdownRenderer</c>).</summary>
    public static string Slug => MarkdownRendererRegistration.Slug;

    /// <summary>The render model; reassigning re-parses and re-renders the surface.</summary>
    public MarkdownRendererModel Model
    {
        get => _model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _model = value;
            Render();
        }
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new MarkdownRendererAutomationPeer(this);

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_opened)
        {
            return;
        }

        _opened = true;
        _diagnostics.RecordViewOpened();
    }

    private void Render()
    {
        MarkdownRendererDisplay display = MarkdownRendererProjection.Project(_model, _localizer);
        AutomationProperties.SetName(this, display.AutomationName);

        Content = display.State switch
        {
            MarkdownRendererState.Loading => BuildLoading(display),
            MarkdownRendererState.Empty => BuildEmpty(display),
            MarkdownRendererState.Error => BuildError(display),
            _ => BuildContent(display),
        };
    }

    // ── Loading: the web <Suspense fallback={<p className="whitespace-pre-wrap">{children}</p>}> ─────────────
    private static TextBlock BuildLoading(MarkdownRendererDisplay display)
    {
        var text = new TextBlock
        {
            Text = display.FallbackText,
            FontSize = BodyFontSize,
            Foreground = DisplayTokens.TextSecondary,
            TextWrapping = TextWrapping.Wrap,         // web whitespace-pre-wrap keeps wraps + explicit breaks
            IsTextSelectionEnabled = true,
        };
        LiveRegion.Configure(text);
        LiveRegion.Announce(text);
        AutomationProperties.SetName(text, display.AutomationName);
        return text;
    }

    // ── Empty: a friendly empty state, never a blank box ───────────────────────────────────────────────────
    private static TsEmptyState BuildEmpty(MarkdownRendererDisplay display)
    {
        var empty = new TsEmptyState
        {
            IconGlyph = MarkdownRendererRegistration.EmptyGlyph,
            Title = display.EmptyTitle,
            Message = display.EmptyMessage,
        };
        AutomationProperties.SetName(empty, display.AutomationName);
        return empty;
    }

    // ── Error: the web QueryError equivalent with a retry affordance ───────────────────────────────────────
    private TsQueryError BuildError(MarkdownRendererDisplay display)
    {
        var error = new TsQueryError
        {
            Title = display.ErrorTitle,
            Message = display.ErrorMessage,
            ActionText = display.RetryLabel,
        };
        error.ActionInvoked += OnRetryInvoked;
        AutomationProperties.SetName(error, display.ErrorTitle);
        return error;
    }

    private void OnRetryInvoked(object? sender, EventArgs e) => RetryRequested?.Invoke(this, EventArgs.Empty);

    // ── Ready / Stale / Offline: the rendered markdown document (web prose-chat), optional freshness chip ──
    private StackPanel BuildContent(MarkdownRendererDisplay display)
    {
        var column = new StackPanel { Spacing = BlockSpacing };

        if (display.ShowFreshnessChip)
        {
            column.Children.Add(BuildFreshnessChip(display));
        }

        foreach (MarkdownBlock block in display.Document.Blocks)
        {
            column.Children.Add(BuildBlock(block, display));
        }

        AutomationProperties.SetName(column, display.AutomationName);
        return column;
    }

    private static Border BuildFreshnessChip(MarkdownRendererDisplay display)
    {
        var label = new TextBlock
        {
            Text = display.FreshnessChipText,
            FontSize = 12,
            Foreground = display.IsOffline ? DisplayTokens.Accent : DisplayTokens.TextSecondary,
        };

        var chip = new Border
        {
            Child = label,
            Background = DisplayTokens.Surface,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            CornerRadius = DisplayTokens.Radius("TsRadiusPill", 9999),
            Padding = new Thickness(ChipPaddingX, ChipPaddingY, ChipPaddingX, ChipPaddingY),
            HorizontalAlignment = HorizontalAlignment.Left,
        };
        AutomationProperties.SetName(chip, display.FreshnessChipText);
        return chip;
    }

    private FrameworkElement BuildBlock(MarkdownBlock block, MarkdownRendererDisplay display) => block switch
    {
        MarkdownHeading heading => BuildHeading(heading),
        MarkdownParagraph paragraph => BuildParagraph(paragraph.Inlines, display),
        MarkdownList list => BuildList(list, display),
        MarkdownCodeBlock code => BuildCodeBlock(code, display),
        MarkdownTable table => BuildTable(table, display),
        MarkdownBlockQuote quote => BuildBlockQuote(quote, display),
        MarkdownThematicBreak => BuildThematicBreak(),
        _ => BuildParagraph(MarkdownInline.None, display),
    };

    private RichTextBlock BuildHeading(MarkdownHeading heading)
    {
        var rich = NewRichTextBlock();
        rich.FontSize = heading.Level <= 1 ? Heading1FontSize : Heading2FontSize;
        rich.FontWeight = new FontWeight { Weight = HeadingWeight };
        rich.Foreground = DisplayTokens.TextPrimary;

        var paragraph = new Paragraph();
        AddInlines(paragraph.Inlines, heading.Inlines, strike: false);
        rich.Blocks.Add(paragraph);
        return rich;
    }

    private RichTextBlock BuildParagraph(IReadOnlyList<MarkdownInline> inlines, MarkdownRendererDisplay display)
    {
        var rich = NewRichTextBlock();
        var paragraph = new Paragraph();
        AddInlines(paragraph.Inlines, inlines, strike: false, display);
        rich.Blocks.Add(paragraph);
        return rich;
    }

    private StackPanel BuildList(MarkdownList list, MarkdownRendererDisplay display)
    {
        var stack = new StackPanel { Spacing = ListItemSpacing };
        int ordinal = list.Start;

        foreach (MarkdownListItem item in list.Items)
        {
            string marker = list.Ordered
                ? string.Concat(ordinal.ToString(System.Globalization.CultureInfo.CurrentCulture), ".")
                : "\u2022"; // web list-disc bullet
            stack.Children.Add(BuildListRow(marker, item.Inlines, display));
            ordinal++;
        }

        return stack;
    }

    private Grid BuildListRow(string marker, IReadOnlyList<MarkdownInline> inlines, MarkdownRendererDisplay display)
    {
        var row = new Grid { ColumnSpacing = ListMarkerGap };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var bullet = new TextBlock
        {
            Text = marker,
            FontSize = BodyFontSize,
            Foreground = DisplayTokens.TextSecondary,
            VerticalAlignment = VerticalAlignment.Top,
        };
        AutomationProperties.SetAccessibilityView(bullet, AccessibilityView.Raw);
        Grid.SetColumn(bullet, 0);
        row.Children.Add(bullet);

        RichTextBlock content = BuildParagraph(inlines, display);
        Grid.SetColumn(content, 1);
        row.Children.Add(content);
        return row;
    }

    private static Border BuildCodeBlock(MarkdownCodeBlock code, MarkdownRendererDisplay display)
    {
        var layout = new StackPanel();

        var header = new Grid { Height = CodeBlockHeaderHeight };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var language = new TextBlock
        {
            Text = code.Language ?? string.Empty,
            FontSize = 12,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(CodeBlockPadding, 0, 0, 0),
        };
        Grid.SetColumn(language, 0);
        header.Children.Add(language);

        var copy = new TsCopyButton
        {
            ValueToCopy = code.Code,
            CopyLabel = display.CopyLabel,
            CopiedLabel = display.CopiedLabel,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(0, 0, CellPaddingX, 0),
        };
        AutomationProperties.SetName(copy, display.CopyLabel);
        Grid.SetColumn(copy, 1);
        header.Children.Add(copy);

        layout.Children.Add(header);

        var codeText = new TextBlock
        {
            Text = code.Code,
            FontFamily = MonoFontFamily(),
            FontSize = CodeFontSize,
            Foreground = DisplayTokens.TextPrimary,
            IsTextSelectionEnabled = true,
            TextWrapping = TextWrapping.NoWrap,
            Padding = new Thickness(CodeBlockPadding, 0, CodeBlockPadding, CodeBlockPadding),
        };

        var scroller = new ScrollViewer
        {
            Content = codeText,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Disabled,
            HorizontalScrollMode = ScrollMode.Auto,
        };
        layout.Children.Add(scroller);

        var border = new Border
        {
            Child = layout,
            Background = DisplayTokens.Surface,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            CornerRadius = DisplayTokens.Radius("TsRadiusSm", 8),
        };
        AutomationProperties.SetName(border, code.Code);
        return border;
    }

    private Border BuildTable(MarkdownTable table, MarkdownRendererDisplay display)
    {
        int columnCount = Math.Max(table.Header.Count, MaxRowWidth(table));
        var grid = new Grid();
        for (int c = 0; c < columnCount; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        }

        int rowIndex = 0;
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        AddTableCells(grid, table.Header, rowIndex, columnCount, display, header: true);
        rowIndex++;

        foreach (MarkdownTableRow row in table.Rows)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            AddTableCells(grid, row.Cells, rowIndex, columnCount, display, header: false);
            rowIndex++;
        }

        var scroller = new ScrollViewer
        {
            Content = grid,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Disabled,
            HorizontalScrollMode = ScrollMode.Auto,
        };

        return new Border
        {
            Child = scroller,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1, 1, 0, 0),
            CornerRadius = DisplayTokens.Radius("TsRadiusSm", 8),
        };
    }

    private void AddTableCells(
        Grid grid,
        IReadOnlyList<MarkdownTableCell> cells,
        int rowIndex,
        int columnCount,
        MarkdownRendererDisplay display,
        bool header)
    {
        for (int c = 0; c < columnCount; c++)
        {
            MarkdownTableCell? cell = c < cells.Count ? cells[c] : null;

            RichTextBlock content = BuildParagraph(cell?.Inlines ?? MarkdownInline.None, display);
            if (header)
            {
                content.FontWeight = new FontWeight { Weight = HeadingWeight };
                content.Foreground = DisplayTokens.TextPrimary;
            }

            content.TextAlignment = (cell?.Alignment ?? MarkdownColumnAlignment.None) switch
            {
                MarkdownColumnAlignment.Center => TextAlignment.Center,
                MarkdownColumnAlignment.Right => TextAlignment.Right,
                _ => TextAlignment.Left,
            };

            var cellBorder = new Border
            {
                Child = content,
                BorderBrush = DisplayTokens.Border,
                BorderThickness = new Thickness(0, 0, 1, 1),
                Padding = new Thickness(CellPaddingX, CellPaddingY, CellPaddingX, CellPaddingY),
                Background = header ? DisplayTokens.Surface : null,
            };
            Grid.SetColumn(cellBorder, c);
            Grid.SetRow(cellBorder, rowIndex);
            grid.Children.Add(cellBorder);
        }
    }

    private Grid BuildBlockQuote(MarkdownBlockQuote quote, MarkdownRendererDisplay display)
    {
        var grid = new Grid { ColumnSpacing = QuoteInnerGap };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var bar = new Border
        {
            Width = QuoteBarWidth,
            Background = DisplayTokens.Accent,
            CornerRadius = DisplayTokens.Radius("TsRadiusPill", 9999),
        };
        Grid.SetColumn(bar, 0);
        grid.Children.Add(bar);

        RichTextBlock content = BuildParagraph(quote.Inlines, display);
        content.Foreground = DisplayTokens.TextSecondary;
        Grid.SetColumn(content, 1);
        grid.Children.Add(content);
        return grid;
    }

    private static Border BuildThematicBreak() => new()
    {
        Height = 1,
        Background = DisplayTokens.Border,
        Margin = new Thickness(0, 4, 0, 4),
    };

    private static RichTextBlock NewRichTextBlock() => new()
    {
        FontSize = BodyFontSize,
        Foreground = DisplayTokens.TextPrimary,
        IsTextSelectionEnabled = true,
        TextWrapping = TextWrapping.Wrap,
    };

    private void AddInlines(
        InlineCollection target,
        IReadOnlyList<MarkdownInline> inlines,
        bool strike,
        MarkdownRendererDisplay? display = null)
    {
        foreach (MarkdownInline inline in inlines)
        {
            switch (inline.Kind)
            {
                case MarkdownInlineKind.Text:
                    target.Add(MakeRun(inline.Text, mono: false, strike));
                    break;

                case MarkdownInlineKind.CodeSpan:
                    target.Add(MakeRun(inline.Text, mono: true, strike, DisplayTokens.Accent));
                    break;

                case MarkdownInlineKind.LineBreak:
                    target.Add(new LineBreak());
                    break;

                case MarkdownInlineKind.Strong:
                    var bold = new Bold();
                    AddInlines(bold.Inlines, inline.Children, strike, display);
                    target.Add(bold);
                    break;

                case MarkdownInlineKind.Emphasis:
                    var italic = new Italic();
                    AddInlines(italic.Inlines, inline.Children, strike, display);
                    target.Add(italic);
                    break;

                case MarkdownInlineKind.Strikethrough:
                    var span = new Span();
                    AddInlines(span.Inlines, inline.Children, strike: true, display);
                    target.Add(span);
                    break;

                case MarkdownInlineKind.Link:
                    target.Add(BuildLink(inline, strike, display));
                    break;

                default:
                    target.Add(MakeRun(inline.Text, mono: false, strike));
                    break;
            }
        }
    }

    private Inline BuildLink(MarkdownInline link, bool strike, MarkdownRendererDisplay? display)
    {
        // Only navigate for absolute http(s) URIs; anything else renders as styled text so we never throw and
        // never become a redirect vector (mirrors the web rel="noopener noreferrer" intent).
        bool navigable = Uri.TryCreate(link.Href, UriKind.Absolute, out Uri? uri) &&
            (uri!.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps);

        if (!navigable)
        {
            var fallback = new Span { Foreground = DisplayTokens.Accent };
            AddInlines(fallback.Inlines, link.Children, strike, display);
            return fallback;
        }

        var hyperlink = new Hyperlink
        {
            NavigateUri = uri,
            Foreground = DisplayTokens.Accent,
        };
        AddInlines(hyperlink.Inlines, link.Children, strike, display);

        string label = MarkdownRendererProjection.FlattenText(
            new MarkdownDocument(new MarkdownBlock[] { new MarkdownParagraph(link.Children) }));
        string accessibleName = display is null
            ? label
            : string.Concat(label, ". ", display.LinkOpensHint);
        AutomationProperties.SetName(hyperlink, accessibleName);
        return hyperlink;
    }

    private static Run MakeRun(string text, bool mono, bool strike, Brush? foreground = null)
    {
        var run = new Run { Text = text };
        if (mono)
        {
            run.FontFamily = MonoFontFamily();
            run.FontSize = CodeFontSize;
        }

        if (foreground is not null)
        {
            run.Foreground = foreground;
        }

        if (strike)
        {
            run.TextDecorations = TextDecorations.Strikethrough;
        }

        return run;
    }

    private static FontFamily MonoFontFamily()
    {
        if (Application.Current?.Resources is { } res &&
            res.TryGetValue("TsTypeFontFamilyMono", out object? value) && value is FontFamily family)
        {
            return family;
        }

        return new FontFamily("Consolas");
    }

    private static int MaxRowWidth(MarkdownTable table)
    {
        int max = 0;
        foreach (MarkdownTableRow row in table.Rows)
        {
            max = Math.Max(max, row.Cells.Count);
        }

        return max;
    }

    private sealed class MarkdownRendererAutomationPeer(MarkdownRenderer owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
