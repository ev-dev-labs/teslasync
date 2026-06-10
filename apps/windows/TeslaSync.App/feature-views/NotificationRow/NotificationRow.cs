using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using Windows.Foundation;

namespace TeslaSync.App.FeatureViews.Notifications;

/// <summary>
/// The native WinUI 3 <c>NotificationRow</c> feature surface — a parity port of
/// web/src/features/notifications/components/NotificationRow.tsx. It is a pure presentational control: assign a
/// <see cref="Model"/> (the web <c>log</c> + optional <c>rule</c> / <c>vehicle</c> + <c>selected</c> props plus
/// the parent-supplied lifecycle status) and it renders one of the contract's states —
/// <see cref="NotificationRowState.Loading"/> (skeleton row chrome while the inbox query is in flight),
/// <see cref="NotificationRowState.Empty"/> (a friendly empty state when there is no notification),
/// <see cref="NotificationRowState.Error"/> (a retriable <see cref="TsQueryError"/>), or the populated inbox row
/// (<see cref="NotificationRowState.Ready"/> / <see cref="NotificationRowState.Stale"/> /
/// <see cref="NotificationRowState.Offline"/>) — the row the web renders: a selection
/// <see cref="TsCheckbox"/>, a <see cref="TsSeverityBadge"/> (the severity, no icon), the
/// <see cref="TsDateTime"/> timestamp, the optional vehicle and rule meta chips, the title (bolder when unread)
/// and the message, plus the per-row mark-read / mark-unread / archive / restore actions and the drill-through
/// "View context" affordance. Unread rows get a left-edge accent bar and a stronger background, exactly like the
/// web. A stale / offline snapshot layers a freshness chip onto the cached row. The hosting inbox wires the
/// actions through the <see cref="SelectionToggled"/>, <see cref="ActivateRequested"/>,
/// <see cref="MarkReadRequested"/>, <see cref="MarkUnreadRequested"/>, <see cref="ArchiveRequested"/>,
/// <see cref="UnarchiveRequested"/> and <see cref="ViewContextRequested"/> events (the native analogue of the web
/// callbacks) so the row stays reusable. The view never performs HTTP; all branch selection, label resolution,
/// severity tinting, vehicle-name fallback and drill-through composition happen in the WinUI-free
/// <see cref="NotificationRowProjection"/>. Entrances fade through <see cref="TsFadeIn"/> (honouring
/// reduce-motion), every string resolves through the i18n facade, decorative glyphs are hidden from Narrator, and
/// the surface carries a single composed Narrator name in every state.
/// </summary>
public sealed partial class NotificationRow : ContentControl
{
    private const double RowGap = 12;             // web gap-3
    private const double PaddingH = 12;           // web px-3
    private const double PaddingV = 10;           // web py-2.5
    private const double RowCornerRadius = 8;     // web rounded-lg
    private const double UnreadAccentThickness = 3; // web border-l-2 accent (heavier so it reads as the left bar)
    private const double TitleFontSize = 14;      // web text-sm
    private const double MetaFontSize = 12;       // web text-xs
    private const double MessageFontSize = 12;    // web text-xs
    private const double MetaSpacing = 8;         // web gap-2
    private const double ActionSpacing = 4;       // web gap-1
    private const double DrillIconFontSize = 12;  // web h-3 w-3
    private const double ChipFontSize = 11;       // web Badge size="sm"
    private const double UnreadTintOpacity = 0.05; // web bg-white/[0.03]
    private const int FadeDelayMs = 60;            // gentle entrance for the inbox row
    private const string EmptyGlyph = "\uE715";    // Segoe Fluent Mail — the "no notifications" empty state

    private readonly ILocalizer _localizer;
    private readonly NotificationRowDiagnostics _diagnostics;

    private NotificationRowModel _model;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, the notification to render, and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through (the <c>useTranslation</c> seam).</param>
    /// <param name="model">The initial render model; defaults to <see cref="NotificationRowModel.Loading"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public NotificationRow(
        ILocalizer localizer,
        NotificationRowModel? model = null,
        NotificationRowDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? NotificationRowModel.Loading();
        _diagnostics = diagnostics ?? new NotificationRowDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>Raised when the selection checkbox is toggled (web <c>onSelectionChange</c>); the argument is the new checked state.</summary>
    public event EventHandler<bool>? SelectionToggled;

    /// <summary>Raised when the row body is activated by click or keyboard (web <c>onActivate</c>).</summary>
    public event RoutedEventHandler? ActivateRequested;

    /// <summary>Raised when the mark-read action is activated (web <c>onMarkRead</c>).</summary>
    public event RoutedEventHandler? MarkReadRequested;

    /// <summary>Raised when the mark-unread action is activated (web <c>onMarkUnread</c>).</summary>
    public event RoutedEventHandler? MarkUnreadRequested;

    /// <summary>Raised when the archive action is activated (web <c>onArchive</c>).</summary>
    public event RoutedEventHandler? ArchiveRequested;

    /// <summary>Raised when the restore action is activated (web <c>onUnarchive</c>).</summary>
    public event RoutedEventHandler? UnarchiveRequested;

    /// <summary>Raised when the drill-through "View context" affordance is activated (the web drill-through <c>Link</c>). Read <see cref="Model"/>'s drill href for the target.</summary>
    public event RoutedEventHandler? ViewContextRequested;

    /// <summary>Raised when the error surface's retry affordance is invoked (the host re-runs the query).</summary>
    public event EventHandler? RetryRequested;

    /// <summary>The canonical diagnostics slug this surface registers under (<c>NotificationRow</c>).</summary>
    public static string Slug => NotificationRowRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public NotificationRowModel Model
    {
        get => _model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _model = value;
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
        NotificationRowDisplay display = NotificationRowProjection.Project(_model, _localizer);
        AutomationProperties.SetName(this, display.AutomationName);

        Content = display.State switch
        {
            NotificationRowState.Loading => BuildLoading(display),
            NotificationRowState.Empty => BuildEmpty(display),
            NotificationRowState.Error => BuildError(display),
            _ => BuildRow(display),
        };
    }

    // ── Ready / Stale / Offline (the web inbox row) ────────────────────────────────────────────────────────
    private TsFadeIn BuildRow(NotificationRowDisplay display)
    {
        var grid = new Grid { ColumnSpacing = RowGap };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var checkbox = BuildCheckbox(display);
        Grid.SetColumn(checkbox, 0);
        grid.Children.Add(checkbox);

        var body = BuildBody(display);
        Grid.SetColumn(body, 1);
        grid.Children.Add(body);

        var actions = BuildActions(display);
        Grid.SetColumn(actions, 2);
        grid.Children.Add(actions);

        // web: unread rows add a left-edge accent bar (border-l-cyan-400) and a slightly stronger background.
        Brush accent = DisplayTokens.Accent;
        var row = new Border
        {
            Padding = new Thickness(PaddingH, PaddingV, PaddingH, PaddingV),
            CornerRadius = new CornerRadius(RowCornerRadius),
            BorderThickness = display.IsUnread
                ? new Thickness(UnreadAccentThickness, 1, 1, 1)
                : new Thickness(1),
            BorderBrush = display.IsUnread ? accent : DisplayTokens.Border,
            Background = display.IsUnread ? Tint(accent, UnreadTintOpacity) : DisplayTokens.Surface,
            Child = grid,
        };

        return new TsFadeIn { DelayMs = FadeDelayMs, Content = row };
    }

    private TsCheckbox BuildCheckbox(NotificationRowDisplay display)
    {
        var checkbox = new TsCheckbox
        {
            IsChecked = display.Selected,
            MinWidth = 0,
            VerticalAlignment = VerticalAlignment.Top,
            Margin = new Thickness(0, 2, 0, 0),
        };
        AutomationProperties.SetName(checkbox, display.SelectLabel);
        checkbox.Checked += OnSelectionChanged;
        checkbox.Unchecked += OnSelectionChanged;
        return checkbox;
    }

    // Web: clicking the row body (not a control) activates it; Enter / Space do the same. A Subtle button gives
    // keyboard activation and a Narrator name for free, while the checkbox / actions own their own clicks.
    private TsButton BuildBody(NotificationRowDisplay display)
    {
        var column = new StackPanel { Spacing = 4, HorizontalAlignment = HorizontalAlignment.Stretch };
        column.Children.Add(BuildMeta(display));
        column.Children.Add(BuildTitle(display));
        if (display.HasMessage)
        {
            column.Children.Add(BuildMessage(display));
        }

        var button = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            Content = column,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Left,
            Padding = new Thickness(4),
        };
        AutomationProperties.SetName(button, display.AutomationName);
        button.Click += OnActivateClick;
        return button;
    }

    // Web `flex flex-wrap items-center gap-2`: the severity badge, the timestamp, and the vehicle / rule chips.
    private static WrapRow BuildMeta(NotificationRowDisplay display)
    {
        var wrap = new WrapRow
        {
            HorizontalSpacing = MetaSpacing,
            VerticalSpacing = 4,
            VerticalAlignment = VerticalAlignment.Center,
        };

        // web: <SeverityBadge severity size="sm" showIcon={false}>{severity}</SeverityBadge>.
        wrap.Children.Add(new TsSeverityBadge
        {
            Severity = display.Severity,
            ShowIcon = false,
            Label = display.Severity,
            VerticalAlignment = VerticalAlignment.Center,
        });

        // web: <DateTime value={log.created_at} in={tzMode} />.
        wrap.Children.Add(new TsDateTime
        {
            Value = display.CreatedAt,
            Variant = DateTimeVariant.Full,
            VerticalAlignment = VerticalAlignment.Center,
        });

        // web: vehicle && <span>· {vehicle.display_name || `#${vehicle.id}`}</span>.
        if (display.ShowVehicle)
        {
            wrap.Children.Add(MetaText(string.Concat("· ", display.VehicleName)));
        }

        // web: rule?.name && <span>· {rule.name}</span>.
        if (display.ShowRuleName)
        {
            wrap.Children.Add(MetaText(string.Concat("· ", display.RuleName)));
        }

        // Native freshness chip for the stale / offline snapshot (the cached row stays visible beneath it).
        if (display.ShowFreshnessChip)
        {
            var chip = new TsBadge
            {
                Status = display.FreshnessChipStatus,
                Content = new TextBlock { Text = display.FreshnessChipText, FontSize = ChipFontSize },
                VerticalAlignment = VerticalAlignment.Center,
            };
            AutomationProperties.SetName(chip, display.FreshnessChipText);
            wrap.Children.Add(chip);
        }

        return wrap;
    }

    private static TextBlock MetaText(string text) => new()
    {
        Text = text,
        FontSize = MetaFontSize,
        Foreground = DisplayTokens.TextMuted,
        TextTrimming = TextTrimming.CharacterEllipsis,
        VerticalAlignment = VerticalAlignment.Center,
    };

    // web: <span className={isRead ? 'text-secondary' : 'font-medium text-primary'}>{log.title}</span>.
    private static TextBlock BuildTitle(NotificationRowDisplay display) => new()
    {
        Text = display.Title,
        FontSize = TitleFontSize,
        FontWeight = display.IsRead ? FontWeights.Normal : FontWeights.Medium,
        Foreground = display.IsRead ? DisplayTokens.TextSecondary : DisplayTokens.TextPrimary,
        TextTrimming = TextTrimming.CharacterEllipsis,
        TextWrapping = TextWrapping.NoWrap,
    };

    // web: log.message && <p className="line-clamp-1 text-xs text-muted">{log.message}</p>.
    private static TextBlock BuildMessage(NotificationRowDisplay display) => new()
    {
        Text = display.Message,
        FontSize = MessageFontSize,
        Foreground = DisplayTokens.TextMuted,
        TextTrimming = TextTrimming.CharacterEllipsis,
        TextWrapping = TextWrapping.NoWrap,
        Margin = new Thickness(0, 2, 0, 0),
    };

    // Web `flex shrink-0 items-center gap-1`: the per-row mark-read / mark-unread / archive / restore actions
    // and the drill-through link. (The web hides these until hover; on desktop they stay visible so keyboard and
    // Narrator users reach them.)
    private WrapRow BuildActions(NotificationRowDisplay display)
    {
        var wrap = new WrapRow
        {
            HorizontalSpacing = ActionSpacing,
            VerticalSpacing = 4,
            VerticalAlignment = VerticalAlignment.Top,
            HorizontalAlignment = HorizontalAlignment.Right,
        };

        if (display.ShowMarkRead)
        {
            wrap.Children.Add(IconAction(
                NotificationRowRegistration.MarkReadGlyph, display.MarkReadLabel, OnMarkReadClick));
        }

        if (display.ShowMarkUnread)
        {
            wrap.Children.Add(IconAction(
                NotificationRowRegistration.MarkUnreadGlyph, display.MarkUnreadLabel, OnMarkUnreadClick));
        }

        if (display.ShowArchive)
        {
            wrap.Children.Add(IconAction(
                NotificationRowRegistration.ArchiveGlyph, display.ArchiveLabel, OnArchiveClick));
        }

        if (display.ShowUnarchive)
        {
            wrap.Children.Add(IconAction(
                NotificationRowRegistration.UnarchiveGlyph, display.UnarchiveLabel, OnUnarchiveClick));
        }

        if (display.HasDrill)
        {
            wrap.Children.Add(BuildDrillLink(display));
        }

        return wrap;
    }

    private static TsButton IconAction(string glyph, string label, RoutedEventHandler handler)
    {
        var button = new TsButton
        {
            Variant = ButtonVariant.Icon,
            Size = ControlSize.Small,
            IconGlyph = glyph,
        };
        AutomationProperties.SetName(button, label);
        ToolTipService.SetToolTip(button, label);
        button.Click += handler;
        return button;
    }

    // Web: the inline drill-through <Link>{t('alerts.viewContext')} <ChevronRight/></Link>.
    private TsButton BuildDrillLink(NotificationRowDisplay display)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 4,
            VerticalAlignment = VerticalAlignment.Center,
        };
        row.Children.Add(new TextBlock
        {
            Text = display.ViewContextLabel,
            FontSize = ChipFontSize,
            FontWeight = FontWeights.Medium,
            VerticalAlignment = VerticalAlignment.Center,
        });
        var chevron = new FontIcon
        {
            Glyph = NotificationRowRegistration.DrillGlyph,
            FontSize = DrillIconFontSize,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(chevron, AccessibilityView.Raw);
        row.Children.Add(chevron);

        var button = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            Content = row,
        };
        AutomationProperties.SetName(button, display.ViewContextLabel);
        button.Click += OnViewContextClick;
        return button;
    }

    // ── Loading (the inbox is still fetching this row) ─────────────────────────────────────────────────────
    private static TsFadeIn BuildLoading(NotificationRowDisplay display)
    {
        var grid = new Grid { ColumnSpacing = RowGap };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var box = new TsSkeleton { BlockWidth = 16, BlockHeight = 16, Radius = 4, VerticalAlignment = VerticalAlignment.Top };
        Grid.SetColumn(box, 0);
        grid.Children.Add(box);

        var lines = new StackPanel { Spacing = 6 };
        lines.Children.Add(new TsSkeleton { BlockWidth = 140, BlockHeight = 10, Radius = 6 });
        lines.Children.Add(new TsSkeleton { BlockWidth = 220, BlockHeight = 12, Radius = 6 });
        lines.Children.Add(new TsSkeleton { BlockWidth = 180, BlockHeight = 10, Radius = 6 });
        Grid.SetColumn(lines, 1);
        grid.Children.Add(lines);

        var row = new Border
        {
            Padding = new Thickness(PaddingH, PaddingV, PaddingH, PaddingV),
            CornerRadius = new CornerRadius(RowCornerRadius),
            BorderThickness = new Thickness(1),
            BorderBrush = DisplayTokens.Border,
            Background = DisplayTokens.Surface,
            Child = grid,
        };

        LiveRegion.Configure(row);
        LiveRegion.Announce(row);
        AutomationProperties.SetName(row, display.LoadingLabel);
        return new TsFadeIn { DelayMs = FadeDelayMs, Content = row };
    }

    // ── Empty (no notification to render) ──────────────────────────────────────────────────────────────────
    private static TsFadeIn BuildEmpty(NotificationRowDisplay display)
    {
        var empty = new TsEmptyState
        {
            IconGlyph = EmptyGlyph,
            Message = display.EmptyMessage,
        };
        return new TsFadeIn { DelayMs = FadeDelayMs, Content = empty };
    }

    // ── Error (web QueryError equivalent with a retry affordance) ──────────────────────────────────────────
    private TsFadeIn BuildError(NotificationRowDisplay display)
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

    private void OnSelectionChanged(object sender, RoutedEventArgs e) =>
        SelectionToggled?.Invoke(this, ((TsCheckbox)sender).IsChecked == true);

    private void OnActivateClick(object sender, RoutedEventArgs e) => ActivateRequested?.Invoke(this, e);

    private void OnMarkReadClick(object sender, RoutedEventArgs e) => MarkReadRequested?.Invoke(this, e);

    private void OnMarkUnreadClick(object sender, RoutedEventArgs e) => MarkUnreadRequested?.Invoke(this, e);

    private void OnArchiveClick(object sender, RoutedEventArgs e) => ArchiveRequested?.Invoke(this, e);

    private void OnUnarchiveClick(object sender, RoutedEventArgs e) => UnarchiveRequested?.Invoke(this, e);

    private void OnViewContextClick(object sender, RoutedEventArgs e) => ViewContextRequested?.Invoke(this, e);

    private void OnRetryInvoked(object? sender, EventArgs e) => RetryRequested?.Invoke(this, EventArgs.Empty);

    // A token brush at reduced opacity for the unread row tint — the web `bg-white/[0.03]` fill. The shared
    // token brush instance is never mutated; a fresh brush carries the reduced opacity.
    private static Brush Tint(Brush brush, double opacity) =>
        brush is SolidColorBrush solid ? new SolidColorBrush(solid.Color) { Opacity = opacity } : brush;

    /// <summary>
    /// A minimal flow panel that lays its children left to right and wraps to a new row when the next child would
    /// overflow — the native analogue of the web row's <c>flex-wrap</c> meta / action bars, so the row never clips
    /// its chips and actions on a narrow surface.
    /// </summary>
    private sealed partial class WrapRow : Panel
    {
        /// <summary>Horizontal gap between items on a line.</summary>
        public double HorizontalSpacing { get; set; }

        /// <summary>Vertical gap between wrapped lines.</summary>
        public double VerticalSpacing { get; set; }

        protected override Size MeasureOverride(Size availableSize)
        {
            double maxWidth = double.IsNaN(availableSize.Width) || double.IsInfinity(availableSize.Width)
                ? double.PositiveInfinity
                : availableSize.Width;

            double rowWidth = 0;
            double rowHeight = 0;
            double totalHeight = 0;
            double widest = 0;

            foreach (var child in Children)
            {
                child.Measure(new Size(double.PositiveInfinity, double.PositiveInfinity));
                var desired = child.DesiredSize;

                if (rowWidth > 0 && rowWidth + HorizontalSpacing + desired.Width > maxWidth)
                {
                    widest = Math.Max(widest, rowWidth);
                    totalHeight += rowHeight + VerticalSpacing;
                    rowWidth = desired.Width;
                    rowHeight = desired.Height;
                }
                else
                {
                    rowWidth += (rowWidth > 0 ? HorizontalSpacing : 0) + desired.Width;
                    rowHeight = Math.Max(rowHeight, desired.Height);
                }
            }

            widest = Math.Max(widest, rowWidth);
            totalHeight += rowHeight;

            double measuredWidth = double.IsInfinity(maxWidth) ? widest : maxWidth;
            return new Size(measuredWidth, totalHeight);
        }

        protected override Size ArrangeOverride(Size finalSize)
        {
            double x = 0;
            double y = 0;
            double rowHeight = 0;

            foreach (var child in Children)
            {
                var desired = child.DesiredSize;
                if (x > 0 && x + HorizontalSpacing + desired.Width > finalSize.Width)
                {
                    x = 0;
                    y += rowHeight + VerticalSpacing;
                    rowHeight = 0;
                }

                if (x > 0)
                {
                    x += HorizontalSpacing;
                }

                child.Arrange(new Rect(x, y, desired.Width, desired.Height));
                x += desired.Width;
                rowHeight = Math.Max(rowHeight, desired.Height);
            }

            return finalSize;
        }
    }
}
