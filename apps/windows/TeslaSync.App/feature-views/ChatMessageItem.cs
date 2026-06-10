using System.Globalization;
using Microsoft.UI.Input;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Documents;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using Windows.System;
using Windows.UI.Core;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>ChatMessageItem</c> feature surface — a parity port of
/// web/src/features/system/components/chatbot/ChatMessageItem.tsx. It renders one chat row: assign a
/// <see cref="Model"/> (the web <c>message</c> plus the grouping / affordance props and the parent-supplied
/// lifecycle status) and it renders one of the contract's states — <see cref="ChatMessageItemState.Loading"/>
/// (a skeleton bubble while the conversation loads), <see cref="ChatMessageItemState.Empty"/> (a friendly empty
/// bubble when a message has no renderable content), <see cref="ChatMessageItemState.Error"/> (a retriable
/// <see cref="TsQueryError"/>), or the populated bubble (<see cref="ChatMessageItemState.Ready"/> /
/// <see cref="ChatMessageItemState.Stale"/> / <see cref="ChatMessageItemState.Offline"/>) — the row the web
/// renders: a role avatar (shown only at the start of a same-role run), a tinted bubble (cyan for the user,
/// surface for the assistant), the message body (literal text for a user message; rendered markdown for an
/// assistant reply, with a blinking cursor while streaming), an optional timestamp, and the hover-revealed action
/// row (copy on every message; regenerate on the last assistant reply; inline edit on the last user message). The
/// inline editor mirrors the web textarea exactly — Enter resends, Shift+Enter inserts a newline, Escape cancels,
/// and a no-op edit is discarded. The view never performs HTTP; all branch selection, markdown parsing, gate
/// derivation and copy resolution happen in the WinUI-free <see cref="ChatMessageItemProjection"/>. Entrances fade
/// through <see cref="TsFadeIn"/> (honouring reduce-motion), every string resolves through the i18n facade, the
/// avatar glyph and streaming cursor are hidden from Narrator, and the surface carries a Narrator name in every
/// state. Regenerate / edit / retry are surfaced to the host through <see cref="RegenerateRequested"/>,
/// <see cref="EditAndResendRequested"/> and <see cref="RetryRequested"/> (the parent owns the conversation).
/// </summary>
public sealed partial class ChatMessageItem : ContentControl
{
    private const double BubblePadding = 12;       // web px-4 py-3
    private const double BubbleCornerRadius = 16;  // web rounded-2xl
    private const double BubbleBorderThickness = 1;
    private const double BubbleMaxWidth = 560;      // web max-w-[70-90%], resolved for a fixed pane
    private const double RowSpacing = 12;           // web gap-3
    private const double StackSpacing = 8;          // web space-y-2
    private const double AvatarSize = 32;           // web Avatar size="md"
    private const double AvatarCornerRadius = 8;    // web shape="rounded"
    private const double CursorWidth = 2;
    private const double CursorHeight = 16;
    private const int FadeDelayMs = 60;
    private const double UserBubbleFillOpacity = 0.12;   // web bg-cyan-500/10
    private const double UserBubbleBorderOpacity = 0.35; // web border-cyan-500/20
    private const string BotGlyph = "\uE99A";   // Segoe Fluent — Robot (assistant)
    private const string UserGlyph = "\uE77B";  // Segoe Fluent — Contact (user)
    private const string EmptyGlyph = "\uE8BD"; // Segoe Fluent — Message
    private const string CopyGlyph = "\uE8C8";  // Segoe Fluent — Copy
    private const string RegenerateGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const string EditGlyph = "\uE70F";  // Segoe Fluent — Edit

    private readonly ILocalizer _localizer;
    private readonly ChatMessageItemDiagnostics _diagnostics;

    private ChatMessageItemModel _model;
    private bool _opened;
    private bool _editing;
    private string _draft = string.Empty;
    private string? _editingMessageId;

    /// <summary>Creates the surface over its i18n facade, an initial model, and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="ChatMessageItemModel.Loading"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public ChatMessageItem(
        ILocalizer localizer,
        ChatMessageItemModel? model = null,
        ChatMessageItemDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? ChatMessageItemModel.Loading();
        _diagnostics = diagnostics ?? new ChatMessageItemDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>Raised when the last assistant reply's regenerate affordance is invoked.</summary>
    public event EventHandler? RegenerateRequested;

    /// <summary>Raised when the inline editor submits a real (non-empty, changed) edit to resend.</summary>
    public event EventHandler<ChatMessageEditRequestedEventArgs>? EditAndResendRequested;

    /// <summary>Raised when the error surface's retry affordance is invoked (the host reloads the conversation).</summary>
    public event EventHandler? RetryRequested;

    /// <summary>The canonical diagnostics slug this surface registers under (<c>ChatMessageItem</c>).</summary>
    public static string Slug => ChatMessageItemRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public ChatMessageItemModel Model
    {
        get => _model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _model = value;

            // A new message resets any open inline editor so a stale draft never bleeds across rows.
            string? incomingId = value.Message?.Id;
            if (!string.Equals(incomingId, _editingMessageId, StringComparison.Ordinal))
            {
                _editing = false;
                _draft = string.Empty;
                _editingMessageId = null;
            }

            Render();
        }
    }

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
        ChatMessageItemDisplay display = ChatMessageItemProjection.Project(_model, _localizer);
        AutomationProperties.SetName(this, display.AutomationName);

        if (display.State is not (ChatMessageItemState.Ready or ChatMessageItemState.Stale or ChatMessageItemState.Offline))
        {
            _editing = false;
        }

        Content = display.State switch
        {
            ChatMessageItemState.Loading => BuildLoading(display),
            ChatMessageItemState.Empty => BuildEmpty(display),
            ChatMessageItemState.Error => BuildError(display),
            _ => BuildRow(display),
        };
    }

    // ── Ready / Stale / Offline (the web chat row) ────────────────────────────────────────────────────────
    private TsFadeIn BuildRow(ChatMessageItemDisplay display)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = RowSpacing,
            HorizontalAlignment = display.IsUser ? HorizontalAlignment.Right : HorizontalAlignment.Left,
        };

        Border avatar = BuildAvatar(display);
        Border bubble = BuildBubble(display);

        if (display.IsUser)
        {
            row.Children.Add(bubble);
            row.Children.Add(avatar);
        }
        else
        {
            row.Children.Add(avatar);
            row.Children.Add(bubble);
        }

        return new TsFadeIn { DelayMs = FadeDelayMs, Content = row };
    }

    private Border BuildBubble(ChatMessageItemDisplay display)
    {
        var column = new StackPanel { Spacing = StackSpacing };

        if (display.ShowFreshnessChip)
        {
            column.Children.Add(BuildChip(display));
        }

        if (_editing)
        {
            column.Children.Add(BuildEditor(display));
        }
        else
        {
            column.Children.Add(BuildBody(display));

            if (display.ShowTimestamp)
            {
                column.Children.Add(new Caption { Value = display.TimestampText });
            }

            if (display.ShowActions)
            {
                column.Children.Add(BuildActions(display));
            }
        }

        return new Border
        {
            Padding = new Thickness(BubblePadding),
            CornerRadius = new CornerRadius(BubbleCornerRadius),
            BorderThickness = new Thickness(BubbleBorderThickness),
            BorderBrush = display.IsUser ? TintBrush(StatusKind.Info, UserBubbleBorderOpacity) : DisplayTokens.Border,
            Background = display.IsUser ? TintBrush(StatusKind.Info, UserBubbleFillOpacity) : DisplayTokens.Surface,
            MaxWidth = BubbleMaxWidth,
            Child = column,
        };
    }

    private static FrameworkElement BuildBody(ChatMessageItemDisplay display)
    {
        if (display.IsUser)
        {
            // web: <p className="whitespace-pre-wrap ...">{visibleText}</p>
            return new TextBlock
            {
                Text = display.VisibleText,
                TextWrapping = TextWrapping.Wrap,
                IsTextSelectionEnabled = true,
                Foreground = DisplayTokens.TextPrimary,
            };
        }

        // web: <MarkdownRenderer>{visibleText}</MarkdownRenderer> {isStreaming && <cursor/>}
        var body = BuildMarkdown(display.MarkdownBlocks);
        if (display.IsStreaming)
        {
            body.Children.Add(BuildStreamingCursor());
        }

        return body;
    }

    // ── Inline editor (the web textarea + Cancel / Save&resend) ───────────────────────────────────────────
    private StackPanel BuildEditor(ChatMessageItemDisplay display)
    {
        var editorColumn = new StackPanel { Spacing = StackSpacing };

        var textarea = new TsTextarea
        {
            Text = _draft,
            MinHeight = 72,
            MinWidth = 280,
        };
        AutomationProperties.SetName(textarea, display.EditMessageAriaLabel);

        var cancel = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            IconGlyph = "\uE711", // Segoe Fluent — Cancel
            Text = display.CancelLabel,
        };
        AutomationProperties.SetName(cancel, display.CancelLabel);

        var save = new TsButton
        {
            Variant = ButtonVariant.Primary,
            Size = ControlSize.Small,
            IconGlyph = "\uE73E", // Segoe Fluent — CheckMark
            Text = display.SaveLabel,
            IsEnabled = !ChatMessageItemProjection.IsNoOpEdit(_draft, display.Content),
        };
        AutomationProperties.SetName(save, display.SaveLabel);

        textarea.TextChanged += (_, _) =>
        {
            _draft = textarea.Text;
            save.IsEnabled = !ChatMessageItemProjection.IsNoOpEdit(_draft, display.Content);
        };
        textarea.KeyDown += (_, e) => OnEditorKeyDown(e, display.Content);
        textarea.Loaded += (_, _) =>
        {
            textarea.Focus(FocusState.Programmatic);
            textarea.SelectionStart = textarea.Text.Length;
        };

        cancel.Click += (_, _) => CancelEdit();
        save.Click += (_, _) => SubmitEdit(display.Content);

        var buttons = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = StackSpacing,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        buttons.Children.Add(cancel);
        buttons.Children.Add(save);

        editorColumn.Children.Add(textarea);
        editorColumn.Children.Add(buttons);
        return editorColumn;
    }

    private void OnEditorKeyDown(KeyRoutedEventArgs e, string content)
    {
        switch (e.Key)
        {
            case VirtualKey.Enter when !IsShiftDown():
                e.Handled = true;
                SubmitEdit(content);
                break;
            case VirtualKey.Escape:
                e.Handled = true;
                CancelEdit();
                break;
            default:
                break;
        }
    }

    private static bool IsShiftDown() =>
        InputKeyboardSource.GetKeyStateForCurrentThread(VirtualKey.Shift).HasFlag(CoreVirtualKeyStates.Down);

    private void StartEdit(string content)
    {
        _draft = content;
        _editing = true;
        _editingMessageId = _model.Message?.Id;
        Render();
    }

    private void CancelEdit()
    {
        _editing = false;
        _draft = string.Empty;
        _editingMessageId = null;
        Render();
    }

    private void SubmitEdit(string content)
    {
        string trimmed = _draft.Trim();
        if (ChatMessageItemProjection.IsNoOpEdit(_draft, content))
        {
            CancelEdit();
            return;
        }

        _editing = false;
        _editingMessageId = null;
        EditAndResendRequested?.Invoke(this, new ChatMessageEditRequestedEventArgs(trimmed));
        Render();
    }

    // ── Action row (copy / regenerate / edit) ─────────────────────────────────────────────────────────────
    private StackPanel BuildActions(ChatMessageItemDisplay display)
    {
        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 4,
            HorizontalAlignment = display.IsUser ? HorizontalAlignment.Right : HorizontalAlignment.Left,
        };

        var copy = new TsCopyButton
        {
            ValueToCopy = display.Content,
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            IconGlyph = CopyGlyph,
        };
        AutomationProperties.SetName(copy, display.CopyAriaLabel);
        actions.Children.Add(copy);

        if (display.ShowRegenerate)
        {
            var regenerate = new TsButton
            {
                Variant = ButtonVariant.Subtle,
                Size = ControlSize.Small,
                IconGlyph = RegenerateGlyph,
                Text = display.RegenerateLabel,
            };
            AutomationProperties.SetName(regenerate, display.RegenerateAriaLabel);
            regenerate.Click += (_, _) => RegenerateRequested?.Invoke(this, EventArgs.Empty);
            actions.Children.Add(regenerate);
        }

        if (display.ShowEdit)
        {
            var edit = new TsButton
            {
                Variant = ButtonVariant.Subtle,
                Size = ControlSize.Small,
                IconGlyph = EditGlyph,
                Text = display.EditLabel,
            };
            AutomationProperties.SetName(edit, display.EditAriaLabel);
            edit.Click += (_, _) => StartEdit(display.Content);
            actions.Children.Add(edit);
        }

        return actions;
    }

    private static TsBadge BuildChip(ChatMessageItemDisplay display)
    {
        var badge = new TsBadge
        {
            Status = display.FreshnessChipStatus,
            Content = new TextBlock
            {
                Text = display.FreshnessChipText,
                FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 12),
            },
            HorizontalAlignment = HorizontalAlignment.Left,
        };
        AutomationProperties.SetName(badge, display.FreshnessChipText);
        return badge;
    }

    private static Border BuildAvatar(ChatMessageItemDisplay display)
    {
        var icon = new FontIcon
        {
            Glyph = display.IsUser ? UserGlyph : BotGlyph,
            FontSize = 16,
            Foreground = DisplayTokens.TextSecondary,
        };

        var avatar = new Border
        {
            Width = AvatarSize,
            Height = AvatarSize,
            CornerRadius = new CornerRadius(AvatarCornerRadius),
            Background = DisplayTokens.Surface,
            BorderThickness = new Thickness(BubbleBorderThickness),
            BorderBrush = DisplayTokens.Border,
            VerticalAlignment = VerticalAlignment.Top,
            Child = icon,
            // web: invisible (occupies space) for consecutive same-role messages.
            Opacity = display.ShowAvatar ? 1 : 0,
        };

        // Decorative — the bubble carries the spoken message text (web avatar glyph is aria-hidden).
        AutomationProperties.SetAccessibilityView(avatar, AccessibilityView.Raw);
        return avatar;
    }

    private static Border BuildStreamingCursor()
    {
        var cursor = new Border
        {
            Width = CursorWidth,
            Height = CursorHeight,
            Margin = new Thickness(2, 0, 0, 0),
            VerticalAlignment = VerticalAlignment.Bottom,
            Background = DisplayTokens.Accent,
        };

        AutomationProperties.SetAccessibilityView(cursor, AccessibilityView.Raw);

        // web: motion-safe:animate-pulse — a gentle blink, suppressed under reduce-motion.
        if (!MotionPreference.ReduceMotion)
        {
            PulseHelper.Attach(cursor);
        }

        return cursor;
    }

    // ── Markdown rendering (the web MarkdownRenderer element map) ──────────────────────────────────────────
    private static StackPanel BuildMarkdown(IReadOnlyList<ChatMarkdownBlock> blocks)
    {
        var stack = new StackPanel { Spacing = 4 };

        foreach (ChatMarkdownBlock block in blocks)
        {
            stack.Children.Add(block.Kind switch
            {
                ChatMarkdownBlockKind.Heading => BuildHeading(block),
                ChatMarkdownBlockKind.BulletList => BuildList(block, ordered: false),
                ChatMarkdownBlockKind.OrderedList => BuildList(block, ordered: true),
                ChatMarkdownBlockKind.CodeBlock => BuildCodeBlock(block),
                _ => BuildParagraph(block),
            });
        }

        return stack;
    }

    private static TextBlock BuildParagraph(ChatMarkdownBlock block)
    {
        var text = new TextBlock
        {
            TextWrapping = TextWrapping.Wrap,
            IsTextSelectionEnabled = true,
            Foreground = DisplayTokens.TextPrimary,
        };
        AppendInlines(text, block.Inlines);
        return text;
    }

    private static TextBlock BuildHeading(ChatMarkdownBlock block)
    {
        var text = new TextBlock
        {
            TextWrapping = TextWrapping.Wrap,
            IsTextSelectionEnabled = true,
            Foreground = DisplayTokens.TextPrimary,
            FontWeight = FontWeights.SemiBold,
            FontSize = block.HeadingLevel == 1 ? 16 : 14,
        };
        AppendInlines(text, block.Inlines);
        return text;
    }

    private static Grid BuildList(ChatMarkdownBlock block, bool ordered)
    {
        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        for (int i = 0; i < block.Items.Count; i++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

            var marker = new TextBlock
            {
                Text = ordered
                    ? (block.OrderedStart + i).ToString(CultureInfo.InvariantCulture) + "."
                    : "\u2022",
                Foreground = DisplayTokens.TextSecondary,
                Margin = new Thickness(0, 0, 8, 0),
                VerticalAlignment = VerticalAlignment.Top,
            };
            Grid.SetColumn(marker, 0);
            Grid.SetRow(marker, i);
            grid.Children.Add(marker);

            var item = new TextBlock
            {
                TextWrapping = TextWrapping.Wrap,
                IsTextSelectionEnabled = true,
                Foreground = DisplayTokens.TextPrimary,
            };
            AppendInlines(item, block.Items[i].Inlines);
            Grid.SetColumn(item, 1);
            Grid.SetRow(item, i);
            grid.Children.Add(item);
        }

        return grid;
    }

    private static Border BuildCodeBlock(ChatMarkdownBlock block)
    {
        var column = new StackPanel { Spacing = 4 };

        if (!string.IsNullOrEmpty(block.CodeLanguage))
        {
            column.Children.Add(new Caption { Value = block.CodeLanguage! });
        }

        column.Children.Add(new TextBlock
        {
            Text = block.CodeText ?? string.Empty,
            FontFamily = MonoFont(),
            TextWrapping = TextWrapping.Wrap,
            IsTextSelectionEnabled = true,
            Foreground = DisplayTokens.TextPrimary,
        });

        return new Border
        {
            Padding = new Thickness(8),
            CornerRadius = new CornerRadius(8),
            Background = DisplayTokens.Surface,
            BorderThickness = new Thickness(BubbleBorderThickness),
            BorderBrush = DisplayTokens.Border,
            Child = column,
        };
    }

    private static void AppendInlines(TextBlock target, IReadOnlyList<ChatMarkdownInline> inlines)
    {
        foreach (ChatMarkdownInline span in inlines)
        {
            switch (span.Kind)
            {
                case ChatMarkdownInlineKind.Text when span.Text == "\n":
                    target.Inlines.Add(new LineBreak());
                    break;
                case ChatMarkdownInlineKind.Bold:
                    target.Inlines.Add(new Run { Text = span.Text, FontWeight = FontWeights.SemiBold });
                    break;
                case ChatMarkdownInlineKind.Italic:
                    target.Inlines.Add(new Run { Text = span.Text, FontStyle = Windows.UI.Text.FontStyle.Italic });
                    break;
                case ChatMarkdownInlineKind.Code:
                    target.Inlines.Add(new Run
                    {
                        Text = span.Text,
                        FontFamily = MonoFont(),
                        Foreground = DisplayTokens.Accent,
                    });
                    break;
                case ChatMarkdownInlineKind.Link:
                    target.Inlines.Add(BuildHyperlink(span));
                    break;
                default:
                    target.Inlines.Add(new Run { Text = span.Text });
                    break;
            }
        }
    }

    private static Inline BuildHyperlink(ChatMarkdownInline span)
    {
        if (!string.IsNullOrWhiteSpace(span.Href)
            && Uri.TryCreate(span.Href, UriKind.Absolute, out Uri? uri))
        {
            var link = new Hyperlink { NavigateUri = uri };
            link.Inlines.Add(new Run { Text = span.Text });
            return link;
        }

        return new Run { Text = span.Text };
    }

    // ── Loading (skeleton bubble while the conversation loads) ────────────────────────────────────────────
    private static TsFadeIn BuildLoading(ChatMessageItemDisplay display)
    {
        var lines = new StackPanel { Spacing = StackSpacing };
        lines.Children.Add(new TsSkeleton { BlockWidth = 220, BlockHeight = 12, Radius = 6 });
        lines.Children.Add(new TsSkeleton { BlockWidth = 180, BlockHeight = 12, Radius = 6 });
        lines.Children.Add(new TsSkeleton { BlockWidth = 120, BlockHeight = 12, Radius = 6 });

        var bubble = new Border
        {
            Padding = new Thickness(BubblePadding),
            CornerRadius = new CornerRadius(BubbleCornerRadius),
            BorderThickness = new Thickness(BubbleBorderThickness),
            BorderBrush = DisplayTokens.Border,
            Background = DisplayTokens.Surface,
            MaxWidth = BubbleMaxWidth,
            HorizontalAlignment = HorizontalAlignment.Left,
            Child = lines,
        };

        LiveRegion.Configure(bubble);
        LiveRegion.Announce(bubble);
        AutomationProperties.SetName(bubble, display.LoadingLabel);
        return new TsFadeIn { DelayMs = FadeDelayMs, Content = bubble };
    }

    // ── Empty (a message with no renderable content) ──────────────────────────────────────────────────────
    private static TsFadeIn BuildEmpty(ChatMessageItemDisplay display)
    {
        var empty = new TsEmptyState
        {
            IconGlyph = EmptyGlyph,
            Message = display.EmptyMessage,
        };
        return new TsFadeIn { DelayMs = FadeDelayMs, Content = empty };
    }

    // ── Error (web QueryError equivalent with a retry affordance) ─────────────────────────────────────────
    private TsFadeIn BuildError(ChatMessageItemDisplay display)
    {
        var error = new TsQueryError
        {
            Title = display.ErrorTitle,
            Message = display.ErrorMessage,
            ActionText = display.RetryLabel,
        };
        error.ActionInvoked += OnRetryInvoked;
        return new TsFadeIn { DelayMs = FadeDelayMs, Content = error };
    }

    private void OnRetryInvoked(object? sender, EventArgs e) => RetryRequested?.Invoke(this, EventArgs.Empty);

    private static Brush TintBrush(StatusKind kind, double opacity)
    {
        Brush baseBrush = DisplayTokens.Brush(StatusResources.AccentBrushKey(kind));
        if (baseBrush is SolidColorBrush solid)
        {
            return new SolidColorBrush(solid.Color) { Opacity = opacity };
        }

        return baseBrush;
    }

    private static FontFamily MonoFont() => TypographyTokens.Mono ?? new FontFamily("Consolas");
}
