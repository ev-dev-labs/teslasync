using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using Windows.Foundation;

namespace TeslaSync.App.FeatureViews.Notifications;

/// <summary>
/// The native WinUI 3 <c>AlertCard</c> feature surface — a parity port of
/// web/src/features/notifications/components/AlertCard.tsx. It is a pure presentational control: assign a
/// <see cref="Model"/> (the web <c>alert</c> prop, narrowed to the fields the card reads, plus the
/// precomputed drill-through href) and it renders the web layout inside a tokenized <see cref="TsGlassPanel"/>
/// — a severity-tinted leading type-icon chip, a clickable title + message region (the web drill-through
/// <c>Link</c>, carrying the "View context" Narrator name), an unread <see cref="TsStatusDot"/>, and a
/// wrapping meta + action bar (relative time, the <see cref="TsSeverityBadge"/>, the humanised type, the
/// acknowledged <see cref="TsBadge"/>, the "View context" affordance and the audit-timeline / acknowledge /
/// reopen / mark-read actions). The hosting page wires the actions through the <see cref="ViewContextRequested"/>,
/// <see cref="OpenDetailRequested"/>, <see cref="AcknowledgeRequested"/>, <see cref="ReopenRequested"/> and
/// <see cref="MarkReadRequested"/> events — the native analogue of the web callbacks — so the card stays
/// reusable. The view never performs HTTP; all branch selection, label resolution and formatting happen in the
/// WinUI-free <see cref="AlertCardProjection"/> (so there is no fetch-driven loading / empty / error / stale /
/// offline branch to reproduce — the web component never fetches). The accent brush is the generated severity
/// design token, decorative glyphs are hidden from Narrator, every interactive element carries an accessible
/// name, and the surface carries a single composed Narrator name. Every label resolves through the i18n facade.
/// </summary>
public sealed partial class AlertCard : ContentControl
{
    private const double PanelPadding = 16;       // web p-4
    private const double ColumnGap = 16;          // web gap-4
    private const double TitleFontSize = 14;      // web text-sm
    private const double MessageFontSize = 12;    // web text-xs
    private const double MetaFontSize = 10;       // web text-[10px]
    private const double TypeIconFontSize = 16;   // web h-4 w-4
    private const double ChipPadding = 10;        // web p-2.5
    private const double ChipCornerRadius = 12;   // web rounded-xl
    private const double ClockIconFontSize = 10;  // web h-2.5 w-2.5
    private const double LinkIconFontSize = 12;   // web h-3 w-3
    private const double AckBadgeFontSize = 11;   // web Badge size="sm"
    private const double TintOpacity = 0.12;      // web bg tint (≈ /10)

    private readonly ILocalizer _localizer;
    private readonly AlertCardDiagnostics _diagnostics;

    private AlertCardModel _model;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, the alert to render, and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through (the <c>useTranslation</c> seam).</param>
    /// <param name="model">The alert to render (the web <c>alert</c> prop).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public AlertCard(
        ILocalizer localizer,
        AlertCardModel model,
        AlertCardDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(model);

        _localizer = localizer;
        _model = model;
        _diagnostics = diagnostics ?? new AlertCardDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>Raised when a "View context" affordance is activated (the web drill-through <c>Link</c>). Read <see cref="Model"/>'s <c>DrillHref</c> for the target.</summary>
    public event RoutedEventHandler? ViewContextRequested;

    /// <summary>Raised when the audit-timeline action is activated (the web <c>onOpenDetail</c>).</summary>
    public event RoutedEventHandler? OpenDetailRequested;

    /// <summary>Raised when the acknowledge action is activated (the web <c>onAcknowledge</c>).</summary>
    public event RoutedEventHandler? AcknowledgeRequested;

    /// <summary>Raised when the reopen action is activated (the web <c>onReopen</c>).</summary>
    public event RoutedEventHandler? ReopenRequested;

    /// <summary>Raised when the mark-read action is activated (the web <c>onMarkRead</c>).</summary>
    public event RoutedEventHandler? MarkReadRequested;

    /// <summary>The canonical diagnostics slug this surface registers under (<c>AlertCard</c>).</summary>
    public static string Slug => AlertCardRegistration.Slug;

    /// <summary>The alert this card renders; reassigning re-projects and re-renders the surface.</summary>
    public AlertCardModel Model
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
        var display = AlertCardProjection.Project(_model, _localizer, DateTimeOffset.Now);
        Brush accent = DisplayTokens.Brush(display.SeverityAccentBrushKey);

        // Web `flex items-start gap-4`: the leading type chip beside the flexible body column.
        var root = new Grid { ColumnSpacing = ColumnGap };
        root.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        root.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var chip = BuildIconChip(display.TypeGlyph, accent);
        Grid.SetColumn(chip, 0);
        root.Children.Add(chip);

        var body = BuildBody(display);
        Grid.SetColumn(body, 1);
        root.Children.Add(body);

        var panel = new TsGlassPanel
        {
            Padding = new Thickness(PanelPadding),
            Content = root,
        };

        // Web: unread alerts add the severity border (`tokens.border`) to the panel.
        if (display.IsUnread)
        {
            panel.BorderBrush = accent;
        }

        AutomationProperties.SetName(this, display.AutomationName);
        Content = panel;
    }

    // Web `rounded-xl p-2.5 ring-1` chip: `tokens.bg` fill, `tokens.border` ring, `tokens.fg` icon.
    private static Border BuildIconChip(string glyph, Brush accent)
    {
        var icon = new FontIcon
        {
            Glyph = glyph,
            FontSize = TypeIconFontSize,
            Foreground = accent,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        return new Border
        {
            Child = icon,
            Padding = new Thickness(ChipPadding),
            CornerRadius = new CornerRadius(ChipCornerRadius),
            BorderBrush = accent,
            BorderThickness = new Thickness(1),
            Background = Tint(accent, TintOpacity),
            VerticalAlignment = VerticalAlignment.Top,
        };
    }

    private StackPanel BuildBody(AlertCardDisplay display)
    {
        var stack = new StackPanel { Spacing = 8 };
        stack.Children.Add(BuildHeaderRow(display));
        stack.Children.Add(BuildMetaActionRow(display));
        return stack;
    }

    // Web `flex items-start justify-between gap-2`: the clickable title / message region and the unread dot.
    private Grid BuildHeaderRow(AlertCardDisplay display)
    {
        var grid = new Grid { ColumnSpacing = 8 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var titleRegion = BuildTitleRegion(display);
        Grid.SetColumn(titleRegion, 0);
        grid.Children.Add(titleRegion);

        if (display.IsUnread)
        {
            var dot = new TsStatusDot
            {
                Severity = display.Severity,
                VerticalAlignment = VerticalAlignment.Top,
                Margin = new Thickness(0, 6, 0, 0),
            };
            // Web: <StatusDot label={t('Unread')} /> — the dot announces the unread state.
            AutomationProperties.SetName(dot, display.UnreadLabel);
            Grid.SetColumn(dot, 1);
            grid.Children.Add(dot);
        }

        return grid;
    }

    // Web: the title + message wrapped in the drill-through <Link aria-label={t('alerts.viewContext')}>.
    private TsButton BuildTitleRegion(AlertCardDisplay display)
    {
        var column = new StackPanel { Spacing = 2, HorizontalAlignment = HorizontalAlignment.Stretch };
        column.Children.Add(new TextBlock
        {
            Text = display.Title,
            FontSize = TitleFontSize,
            FontWeight = FontWeights.Medium,
            Foreground = display.IsRead ? DisplayTokens.TextSecondary : DisplayTokens.TextPrimary,
            TextWrapping = TextWrapping.Wrap,
        });
        column.Children.Add(new TextBlock
        {
            Text = display.Message,
            FontSize = MessageFontSize,
            Foreground = DisplayTokens.TextMuted,
            TextWrapping = TextWrapping.Wrap,
            MaxLines = 2,
            TextTrimming = TextTrimming.CharacterEllipsis,
        });

        var button = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            Content = column,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Left,
            Padding = new Thickness(4),
        };
        AutomationProperties.SetName(button, display.ViewContextLabel);
        button.Click += OnViewContextClick;
        return button;
    }

    // Web `flex items-center gap-3 mt-2 flex-wrap`: meta chips on the left, the drill link + actions on the right.
    private Grid BuildMetaActionRow(AlertCardDisplay display)
    {
        var grid = new Grid { ColumnSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var meta = BuildMeta(display);
        Grid.SetColumn(meta, 0);
        grid.Children.Add(meta);

        var actions = BuildActions(display);
        Grid.SetColumn(actions, 1);
        grid.Children.Add(actions);

        return grid;
    }

    private static WrapRow BuildMeta(AlertCardDisplay display)
    {
        var wrap = new WrapRow
        {
            HorizontalSpacing = 12,
            VerticalSpacing = 6,
            VerticalAlignment = VerticalAlignment.Center,
        };

        // Web: <span><Clock/> {timeAgo}</span>.
        var timeRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 4,
            VerticalAlignment = VerticalAlignment.Center,
        };
        var clock = new FontIcon
        {
            Glyph = AlertCardRegistration.ClockGlyph,
            FontSize = ClockIconFontSize,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(clock, AccessibilityView.Raw);
        timeRow.Children.Add(clock);
        timeRow.Children.Add(new TextBlock
        {
            Text = display.TimeAgoText,
            FontSize = MetaFontSize,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        });
        wrap.Children.Add(timeRow);

        // Web: <SeverityBadge severity size="sm" showIcon={false}>{severity}</SeverityBadge>.
        wrap.Children.Add(new TsSeverityBadge
        {
            Severity = display.Severity,
            ShowIcon = false,
            Label = display.Severity,
            VerticalAlignment = VerticalAlignment.Center,
        });

        // Web: <span>{type.replace(/_/g, ' ')}</span>.
        wrap.Children.Add(new TextBlock
        {
            Text = display.TypeLabel,
            FontSize = MetaFontSize,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        });

        // Web: acknowledged alerts show a success <Badge> with the named / anonymous copy.
        if (display.AckBadgeText is { } ack)
        {
            wrap.Children.Add(new TsBadge
            {
                Status = StatusKind.Success,
                Content = new TextBlock { Text = ack, FontSize = AckBadgeFontSize },
                VerticalAlignment = VerticalAlignment.Center,
            });
        }

        return wrap;
    }

    private WrapRow BuildActions(AlertCardDisplay display)
    {
        var wrap = new WrapRow
        {
            HorizontalSpacing = 8,
            VerticalSpacing = 6,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Right,
        };

        wrap.Children.Add(BuildViewContextLink(display));

        // Web: <Button variant="ghost" icon={Bell}>{t('alerts.timeline.title')}</Button>.
        var audit = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            Text = display.AuditTimelineLabel,
            IconGlyph = AlertCardRegistration.AuditTimelineGlyph,
        };
        audit.Click += OnOpenDetailClick;
        wrap.Children.Add(audit);

        // Web: acknowledged -> ghost "Reopened" (refresh); otherwise ghost "Acknowledge" (check).
        var primary = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            Text = display.PrimaryActionLabel,
            IconGlyph = display.PrimaryActionIsReopen
                ? AlertCardRegistration.ReopenGlyph
                : AlertCardRegistration.AcknowledgeGlyph,
        };
        if (display.PrimaryActionIsReopen)
        {
            primary.Click += OnReopenClick;
        }
        else
        {
            primary.Click += OnAcknowledgeClick;
        }

        wrap.Children.Add(primary);

        // Web: unread alerts show a ghost "Mark read" (eye) action.
        if (display.ShowMarkRead)
        {
            var markRead = new TsButton
            {
                Variant = ButtonVariant.Subtle,
                Size = ControlSize.Small,
                Text = display.MarkReadLabel,
                IconGlyph = AlertCardRegistration.MarkReadGlyph,
            };
            markRead.Click += OnMarkReadClick;
            wrap.Children.Add(markRead);
        }

        return wrap;
    }

    // Web: the inline drill-through <Link>{t('alerts.viewContext')} <ChevronRight/></Link>.
    private TsButton BuildViewContextLink(AlertCardDisplay display)
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
            FontSize = AckBadgeFontSize,
            FontWeight = FontWeights.Medium,
            VerticalAlignment = VerticalAlignment.Center,
        });
        var chevron = new FontIcon
        {
            Glyph = AlertCardRegistration.NextGlyph,
            FontSize = LinkIconFontSize,
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

    private void OnViewContextClick(object sender, RoutedEventArgs e) => ViewContextRequested?.Invoke(this, e);

    private void OnOpenDetailClick(object sender, RoutedEventArgs e) => OpenDetailRequested?.Invoke(this, e);

    private void OnAcknowledgeClick(object sender, RoutedEventArgs e) => AcknowledgeRequested?.Invoke(this, e);

    private void OnReopenClick(object sender, RoutedEventArgs e) => ReopenRequested?.Invoke(this, e);

    private void OnMarkReadClick(object sender, RoutedEventArgs e) => MarkReadRequested?.Invoke(this, e);

    // A token brush at reduced opacity for the chip fill — the web `bg-{color}/10` tint. The shared token
    // brush instance is never mutated; a fresh brush carries the reduced opacity.
    private static Brush Tint(Brush brush, double opacity) =>
        brush is SolidColorBrush solid ? new SolidColorBrush(solid.Color) { Opacity = opacity } : brush;

    /// <summary>
    /// A minimal flow panel that lays its children left to right and wraps to a new row when the next child
    /// would overflow — the native analogue of the web meta / action bar's <c>flex-wrap</c>, so the card never
    /// clips its chips and actions on a narrow surface.
    /// </summary>
    private sealed partial class WrapRow : Panel
    {
        /// <summary>Horizontal gap between items on a row.</summary>
        public double HorizontalSpacing { get; set; }

        /// <summary>Vertical gap between wrapped rows.</summary>
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
