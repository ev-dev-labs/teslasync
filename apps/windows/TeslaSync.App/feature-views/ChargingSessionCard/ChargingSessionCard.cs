using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using Windows.Foundation;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>ChargingSessionCard</c> feature surface — a parity port of
/// <c>web/src/features/charging/components/ChargingSessionCard.tsx</c>. It is a presentational card: assign a
/// <see cref="Model"/> (the web <c>session</c> / <c>selected</c> / <c>anomaly</c> / <c>density</c> props, plus the
/// distance display context) and it renders exactly one of three branches —
/// <see cref="ChargingSessionCardState.Loading"/> (tokenized skeleton chrome while the parent list resolves),
/// <see cref="ChargingSessionCardState.Empty"/> (the card chrome over a friendly stand-in when no session
/// resolved, never a blank box) or <see cref="ChargingSessionCardState.Ready"/> (the web composition: the optional
/// selection checkbox + battery-friendly score badge, the header timestamp · duration + charger / energy / free /
/// anomaly badges, the single-endpoint charger location, and — at comfortable density — the battery delta and the
/// peak / average / duration / cost / cost-per-kWh / distance-gained metric chips). The panel is a tokenized
/// <see cref="TsGlassPanel"/> whose glow follows the web <c>ACCENT[cat]</c> (a Supercharger glows cyan, every other
/// category glows green); all branch selection, formatting, glow resolution and copy resolution happen in the
/// WinUI-free <see cref="ChargingSessionCardProjection"/>. Every string resolves through the i18n facade, the
/// decorative icons are hidden from Narrator, the selection checkbox carries its own Narrator label, and the
/// surface carries a composed Narrator name in each state.
/// </summary>
public sealed partial class ChargingSessionCard : ContentControl
{
    private const double PanelPadding = 14;       // web HistoryListRow p-3.5
    private const double ColumnSpacing = 12;      // gap between checkbox / score / body / chevron
    private const double RowSpacing = 6;          // gap between header / route / metrics rows
    private const double ChipSpacing = 8;         // horizontal gap inside the wrap rows
    private const double ChipRunSpacing = 6;      // vertical gap between wrapped runs
    private const double IconChipSpacing = 4;     // gap between a chip icon and its text
    private const double TimestampFontSize = 14;  // web text-sm
    private const double MetaFontSize = 11;       // web text-[11px] duration
    private const double BadgeFontSize = 11;      // web Badge size="sm"
    private const double MetricFontSize = 12;     // web text-xs metric row
    private const double MetricIconSize = 12;     // web h-3 w-3
    private const double LeadingIconSize = 14;
    private const double ChevronSize = 12;
    private const double SkeletonWidth = 220;

    private const string LocationGlyph = "\uE707";   // Segoe Fluent — location pin (web MapPin)
    private const string ChevronGlyph = "\uE76C";    // Segoe Fluent — ChevronRight (web row affordance)
    private const string DotSeparator = "\u00B7";    // web "·"

    private readonly ILocalizer _localizer;
    private readonly ChargingSessionCardDiagnostics _diagnostics;
    private readonly Action<long, bool>? _onToggleSelect;
    private readonly string? _currencySymbol;
    private readonly int _decimalPrecision;

    private ChargingSessionCardModel _model;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, the display context and diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="ChargingSessionCardModel.Pending"/>.</param>
    /// <param name="currencySymbol">The active currency symbol for the cost chips (default <c>$</c>).</param>
    /// <param name="decimalPrecision">The user's default decimal precision (default 2).</param>
    /// <param name="onToggleSelect">Invoked with <c>(sessionId, isSelected)</c> when the selection checkbox toggles.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public ChargingSessionCard(
        ILocalizer localizer,
        ChargingSessionCardModel? model = null,
        string? currencySymbol = null,
        int decimalPrecision = 2,
        Action<long, bool>? onToggleSelect = null,
        ChargingSessionCardDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? ChargingSessionCardModel.Pending;
        _currencySymbol = currencySymbol;
        _decimalPrecision = decimalPrecision;
        _onToggleSelect = onToggleSelect;
        _diagnostics = diagnostics ?? new ChargingSessionCardDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>ChargingSessionCard</c>).</summary>
    public static string Slug => ChargingSessionCardRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public ChargingSessionCardModel Model
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
        var display = ChargingSessionCardProjection.Project(_model, _localizer, _currencySymbol, _decimalPrecision);

        AutomationProperties.SetName(this, display.AutomationName);
        Content = display.State switch
        {
            ChargingSessionCardState.Loading => BuildLoading(display),
            ChargingSessionCardState.Empty => BuildEmpty(display),
            _ => BuildReady(display),
        };
    }

    // ── Ready (the web HistoryListRow composition) ───────────────────────────────────────────────────────
    private TsGlassPanel BuildReady(ChargingSessionCardDisplay display)
    {
        var grid = new Grid { ColumnSpacing = ColumnSpacing };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        if (display.Selectable)
        {
            var checkbox = BuildCheckbox(display);
            Grid.SetColumn(checkbox, 0);
            grid.Children.Add(checkbox);
        }

        if (display.HasScore)
        {
            var score = BuildScore(display);
            Grid.SetColumn(score, 1);
            grid.Children.Add(score);
        }

        var body = BuildBody(display);
        Grid.SetColumn(body, 2);
        grid.Children.Add(body);

        var chevron = DecorativeIcon(ChevronGlyph, ChevronSize, DisplayTokens.TextMuted);
        Grid.SetColumn(chevron, 3);
        grid.Children.Add(chevron);

        return GlassPanel(display.Glow, grid);
    }

    private TsCheckbox BuildCheckbox(ChargingSessionCardDisplay display)
    {
        var checkbox = new TsCheckbox
        {
            IsChecked = display.Selected,
            MinWidth = 0,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(checkbox, display.SelectLabel);

        long id = display.SessionId;
        checkbox.Checked += (_, _) => _onToggleSelect?.Invoke(id, true);
        checkbox.Unchecked += (_, _) => _onToggleSelect?.Invoke(id, false);
        return checkbox;
    }

    private static TsScoreBadge BuildScore(ChargingSessionCardDisplay display)
    {
        var score = new TsScoreBadge
        {
            Score = display.Score,
            VerticalAlignment = VerticalAlignment.Center,
        };

        // Override the badge's default "Grade X" name with the web card's battery-friendly aria label.
        AutomationProperties.SetName(score, display.ScoreAriaLabel);
        return score;
    }

    private static StackPanel BuildBody(ChargingSessionCardDisplay display)
    {
        var body = new StackPanel
        {
            Orientation = Orientation.Vertical,
            Spacing = RowSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };

        body.Children.Add(BuildHeader(display));
        body.Children.Add(BuildRoute(display));

        if (display.ShowMetrics)
        {
            body.Children.Add(BuildMetrics(display));
        }

        return body;
    }

    private static CardWrapPanel BuildHeader(ChargingSessionCardDisplay display)
    {
        var header = Wrap();

        header.Children.Add(new TextBlock
        {
            Text = display.StartedAtText,
            FontSize = TimestampFontSize,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
        });

        header.Children.Add(new TextBlock
        {
            Text = DotSeparator,
            FontSize = MetaFontSize,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        });

        header.Children.Add(new TextBlock
        {
            Text = display.DurationText,
            FontSize = MetaFontSize,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        });

        header.Children.Add(TextBadge(display.ChargerLabel, display.ChargerStatus));

        if (display.HasEnergyBadge)
        {
            header.Children.Add(TextBadge(display.EnergyBadgeText, StatusKind.Info));
        }

        if (display.HasFreeBadge)
        {
            header.Children.Add(IconBadge(
                ChargingSessionCardRegistration.SunGlyph, display.FreeLabel, StatusKind.Success));
        }

        if (display.HasAnomaly)
        {
            header.Children.Add(IconBadge(
                ChargingSessionCardRegistration.WarningGlyph, display.AnomalyMessage, StatusKind.Danger));
        }

        return header;
    }

    private static StackPanel BuildRoute(ChargingSessionCardDisplay display)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = IconChipSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };

        row.Children.Add(DecorativeIcon(LocationGlyph, MetricIconSize, DisplayTokens.Accent));
        row.Children.Add(new TextBlock
        {
            Text = display.RouteLabel,
            FontSize = MetricFontSize,
            Foreground = display.HasRoute ? DisplayTokens.TextSecondary : DisplayTokens.TextMuted,
            TextTrimming = TextTrimming.CharacterEllipsis,
            VerticalAlignment = VerticalAlignment.Center,
        });
        return row;
    }

    private static CardWrapPanel BuildMetrics(ChargingSessionCardDisplay display)
    {
        var metrics = Wrap();

        metrics.Children.Add(new TsBatteryDelta
        {
            StartPercent = display.BatteryStartPct ?? double.NaN,
            EndPercent = display.BatteryEndPct ?? double.NaN,
            VerticalAlignment = VerticalAlignment.Center,
        });

        foreach (var metric in display.Metrics)
        {
            metrics.Children.Add(BuildMetricChip(metric));
        }

        return metrics;
    }

    private static StackPanel BuildMetricChip(ChargingCardMetric metric)
    {
        var accent = DisplayTokens.Brush(metric.AccentBrushKey);
        var chip = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = IconChipSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };

        if (metric.Glyph is { } glyph)
        {
            chip.Children.Add(DecorativeIcon(glyph, MetricIconSize, accent));
        }

        chip.Children.Add(new TextBlock
        {
            Text = metric.Text,
            FontSize = MetricFontSize,
            Foreground = accent,
            VerticalAlignment = VerticalAlignment.Center,
        });
        return chip;
    }

    // ── Empty (resolved, no session — friendly stand-in, never a blank box) ──────────────────────────────
    private static TsGlassPanel BuildEmpty(ChargingSessionCardDisplay display)
    {
        var empty = new TsEmptyState
        {
            IconGlyph = ChargingSessionCardRegistration.ZapGlyph,
            Message = display.EmptyMessage,
        };

        var panel = GlassPanel(ChargingCardGlow.Green, empty);
        LiveRegion.Configure(empty);
        LiveRegion.Announce(empty);
        return panel;
    }

    // ── Loading (parent still resolving the session) ─────────────────────────────────────────────────────
    private static TsGlassPanel BuildLoading(ChargingSessionCardDisplay display)
    {
        var column = new StackPanel { Orientation = Orientation.Vertical, Spacing = RowSpacing };
        column.Children.Add(new TsSkeleton { BlockWidth = SkeletonWidth, BlockHeight = 16, Radius = 6 });
        column.Children.Add(new TsSkeleton { BlockWidth = SkeletonWidth * 0.6, BlockHeight = 12, Radius = 6 });
        column.Children.Add(new TsSkeleton { BlockWidth = SkeletonWidth * 0.85, BlockHeight = 12, Radius = 6 });

        var panel = GlassPanel(ChargingCardGlow.Green, column);
        AutomationProperties.SetName(column, display.LoadingLabel);
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return panel;
    }

    private static TsBadge TextBadge(string text, StatusKind status) => new()
    {
        Status = status,
        Content = text,
        FontSize = BadgeFontSize,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static TsBadge IconBadge(string glyph, string text, StatusKind status)
    {
        var accent = DisplayTokens.Brush(StatusResources.AccentBrushKey(status));
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = IconChipSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };
        row.Children.Add(DecorativeIcon(glyph, MetricIconSize, accent));
        row.Children.Add(new TextBlock
        {
            Text = text,
            FontSize = BadgeFontSize,
            Foreground = accent,
            VerticalAlignment = VerticalAlignment.Center,
        });

        return new TsBadge
        {
            Status = status,
            Content = row,
            FontSize = BadgeFontSize,
            VerticalAlignment = VerticalAlignment.Center,
        };
    }

    private static FontIcon DecorativeIcon(string glyph, double fontSize, Brush foreground)
    {
        var icon = new FontIcon
        {
            Glyph = glyph,
            FontSize = fontSize,
            Foreground = foreground,
            VerticalAlignment = VerticalAlignment.Center,
        };

        // Decorative — its meaning is carried by the adjacent text and the surface Narrator name.
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        return icon;
    }

    private static CardWrapPanel Wrap() => new()
    {
        HorizontalSpacing = ChipSpacing,
        VerticalSpacing = ChipRunSpacing,
    };

    private static TsGlassPanel GlassPanel(ChargingCardGlow glow, UIElement content) => new()
    {
        Glow = ToGlassGlow(glow),
        Padding = new Thickness(PanelPadding),
        Content = content,
    };

    private static GlassGlow ToGlassGlow(ChargingCardGlow glow) => glow switch
    {
        ChargingCardGlow.Cyan => GlassGlow.Cyan,
        _ => GlassGlow.Green,
    };

    /// <summary>
    /// A minimal left-to-right wrap panel for the header badge run and the metrics run — the native analogue of
    /// the web <c>flex flex-wrap</c> rows. Mirrors the established <c>ChipWrapPanel</c> pattern used by the
    /// dashboard widgets so badges of varying width flow onto a new run rather than clipping on a narrow card.
    /// </summary>
    private sealed partial class CardWrapPanel : Panel
    {
        /// <summary>Horizontal gap between items on a run.</summary>
        public double HorizontalSpacing { get; set; }

        /// <summary>Vertical gap between wrapped runs.</summary>
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
