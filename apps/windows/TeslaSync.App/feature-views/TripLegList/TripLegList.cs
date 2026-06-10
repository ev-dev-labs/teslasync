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
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>TripLegList</c> feature surface — a parity port of
/// <c>web/src/features/driving/components/TripLegList.tsx</c>. It is a pure presentational panel: assign a
/// <see cref="Model"/> (the web <c>legs</c> / <c>chargeStops</c> props plus the distance display context) and it
/// renders exactly one of two branches — <see cref="TripLegListState.Ready"/> (the web composition: the
/// "Route Breakdown" title above a stack of per-leg cards, each card showing a numbered badge, the map-pinned
/// <c>from → to</c> route and a four-up distance / duration / energy / battery metric grid, with a blue charging
/// stop card interleaved after every leg that has one) or <see cref="TripLegListState.Empty"/> (the title over a
/// friendly stand-in when no legs are bound, never a blank box). The panel is a tokenized <see cref="TsGlassPanel"/>;
/// each leg row enters through <see cref="TsFadeIn"/> (the web <c>FadeIn</c>, honouring the OS reduce-motion
/// setting). All branch selection, unit conversion, rounding, currency and copy resolution happen in the WinUI-free
/// <see cref="TripLegListProjection"/>. Every string resolves through the i18n facade, the decorative pin / arrow /
/// bolt / clock icons are hidden from Narrator, each leg and stop card carries its own composed Narrator name, and
/// the surface carries a Narrator name in each state.
/// </summary>
public sealed partial class TripLegList : ContentControl
{
    private const double PanelPadding = 24;        // web GlassPanel p-6
    private const double TitleGap = 16;            // web h3 mb-4
    private const double ListSpacing = 12;         // web space-y-3 between legs
    private const double LegCardPadding = 16;      // web leg card p-4
    private const double LegCardRadius = 8;        // web rounded-lg
    private const double LegRowSpacing = 12;       // web mb-3 between header and metrics
    private const double HeaderSpacing = 8;        // web gap-2 between badge and route
    private const double RouteSpacing = 4;         // web gap-1 inside the route line
    private const double MetricsSpacing = 12;      // web gap-3 between metric cells
    private const double MetricLabelSpacing = 2;   // web spacing between a metric label and its value
    private const double BadgeSize = 24;           // web h-6 w-6
    private const double PinIconSize = 14;         // web h-3.5 w-3.5
    private const double LabelFontSize = 12;       // web text-xs
    private const double ValueFontSize = 14;       // web text-sm
    private const double RouteFontSize = 14;       // web text-sm route line
    private const double AddressMaxWidth = 180;    // allows the truncation the web's `truncate` gives
    private const double StopRadius = 8;           // web rounded-lg
    private const double StopPadding = 12;         // web charge stop p-3
    private const double StopColumnSpacing = 8;    // web gap-2 between the bolt and the stop body
    private const double StopBodySpacing = 4;      // web spacing inside the stop body
    private const double StopMetricsSpacing = 16;  // web gap-x-4 between stop metrics
    private const double StopChipSpacing = 4;      // web gap-1 between the clock and its duration
    private const double StopIconSize = 16;        // web h-4 w-4 bolt
    private const double StopMetaIconSize = 12;    // web h-3 w-3 clock
    private const double StopFontSize = 14;        // web text-sm
    private const double RecommendedFontSize = 12; // web text-xs recommended note
    private const double FadeStepMs = 30;          // web delay={idx * 0.03}
    private const string EmptyGlyph = "\uE7C3";    // Segoe Fluent — empty document

    // Web semantic tints (success / danger / warning tokens) for the pins and SoC readouts.
    private const string StartBrushKey = "TsColorSuccessBrush";
    private const string EndBrushKey = "TsColorDangerBrush";
    private const string WarnBrushKey = "TsColorWarningBrush";
    private const string CostBrushKey = "TsColorSuccessBrush";

    // Web blue-500 charge-stop accent (border-blue-500/20, bg-blue-500/5, text-blue-300/400).
    private const string StopAccentBrushKey = "TsChartSpeedBrush";
    private const double StopBorderOpacity = 0.20;
    private const double StopFillOpacity = 0.05;
    private static readonly Windows.UI.Color StopAccentFallback = Windows.UI.Color.FromArgb(0xFF, 0x3B, 0x82, 0xF6);

    private readonly ILocalizer _localizer;
    private readonly TripLegListDiagnostics _diagnostics;
    private readonly string? _currencySymbol;
    private readonly int _decimalPrecision;

    private TripLegListModel _model;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, the display context and diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through (the <c>useTranslation</c> seam).</param>
    /// <param name="model">The initial render model; defaults to <see cref="TripLegListModel.Empty"/>.</param>
    /// <param name="currencySymbol">The active currency symbol for the cost text (default <c>$</c>).</param>
    /// <param name="decimalPrecision">The user's default decimal precision (default 2).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public TripLegList(
        ILocalizer localizer,
        TripLegListModel? model = null,
        string? currencySymbol = null,
        int decimalPrecision = 2,
        TripLegListDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? TripLegListModel.Empty;
        _currencySymbol = currencySymbol;
        _decimalPrecision = decimalPrecision;
        _diagnostics = diagnostics ?? new TripLegListDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>TripLegList</c>).</summary>
    public static string Slug => TripLegListRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public TripLegListModel Model
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
        var display = TripLegListProjection.Project(_model, _localizer, _currencySymbol, _decimalPrecision);

        AutomationProperties.SetName(this, display.AutomationName);
        Content = display.State == TripLegListState.Empty
            ? BuildEmpty(display)
            : BuildReady(display);
    }

    // ── Ready (the web GlassPanel > h3 + space-y-3 list composition) ─────────────────────────────────────
    private static TsGlassPanel BuildReady(TripLegListDisplay display)
    {
        var column = new StackPanel { Spacing = TitleGap };
        column.Children.Add(Title(display.Title));

        var list = new StackPanel { Spacing = ListSpacing };
        for (int i = 0; i < display.Items.Count; i++)
        {
            list.Children.Add(BuildLegRow(display.Items[i], i));
        }

        column.Children.Add(list);
        return Panel(column);
    }

    private static TsFadeIn BuildLegRow(TripLegItemDisplay item, int index)
    {
        var stack = new StackPanel { Spacing = 0 };
        stack.Children.Add(BuildLegCard(item));

        if (item.ChargeStop is { } stop)
        {
            stack.Children.Add(BuildChargeStop(stop));
        }

        return new TsFadeIn
        {
            DelayMs = (int)(index * FadeStepMs),
            Content = stack,
        };
    }

    private static Border BuildLegCard(TripLegItemDisplay item)
    {
        var body = new StackPanel { Spacing = LegRowSpacing };
        body.Children.Add(BuildLegHeader(item));
        body.Children.Add(BuildLegMetrics(item));

        var card = new Border
        {
            CornerRadius = new CornerRadius(LegCardRadius),
            BorderThickness = new Thickness(1),
            BorderBrush = DisplayTokens.Border,
            Background = DisplayTokens.Brush("TsColorSurfaceGlassBrush"),
            Padding = new Thickness(LegCardPadding),
            Child = body,
        };

        AutomationProperties.SetName(card, item.AutomationName);
        return card;
    }

    private static StackPanel BuildLegHeader(TripLegItemDisplay item)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = HeaderSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };

        row.Children.Add(BuildBadge(item.Index));

        var route = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = RouteSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };
        route.Children.Add(DecorativeIcon(TripLegListRegistration.MapPinGlyph, PinIconSize, DisplayTokens.Brush(StartBrushKey)));
        route.Children.Add(Address(item.FromLabel));
        route.Children.Add(DecorativeIcon(TripLegListRegistration.ArrowRightGlyph, LabelFontSize, DisplayTokens.TextMuted));
        route.Children.Add(DecorativeIcon(TripLegListRegistration.MapPinGlyph, PinIconSize, DisplayTokens.Brush(EndBrushKey)));
        route.Children.Add(Address(item.ToLabel));

        row.Children.Add(route);
        return row;
    }

    private static Border BuildBadge(string number)
    {
        var text = new TextBlock
        {
            Text = number,
            FontSize = LabelFontSize,
            FontWeight = FontWeights.Bold,
            Foreground = DisplayTokens.TextPrimary,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        return new Border
        {
            Width = BadgeSize,
            Height = BadgeSize,
            CornerRadius = new CornerRadius(BadgeSize / 2),
            Background = DisplayTokens.Border,
            Child = text,
            VerticalAlignment = VerticalAlignment.Center,
        };
    }

    private static TextBlock Address(string label) => new()
    {
        Text = label,
        FontSize = RouteFontSize,
        Foreground = DisplayTokens.TextSecondary,
        TextTrimming = TextTrimming.CharacterEllipsis,
        TextWrapping = TextWrapping.NoWrap,
        MaxWidth = AddressMaxWidth,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static Grid BuildLegMetrics(TripLegItemDisplay item)
    {
        var grid = new Grid { ColumnSpacing = MetricsSpacing };
        for (int i = 0; i < 4; i++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        var distance = Metric(item.DistanceLabel, ValueText(item.DistanceText));
        var duration = Metric(item.DurationLabel, ValueText(item.DurationText));
        var energy = Metric(item.EnergyLabel, ValueText(item.EnergyText));
        var battery = Metric(item.SocLabel, BuildBattery(item));

        Grid.SetColumn(distance, 0);
        Grid.SetColumn(duration, 1);
        Grid.SetColumn(energy, 2);
        Grid.SetColumn(battery, 3);
        grid.Children.Add(distance);
        grid.Children.Add(duration);
        grid.Children.Add(energy);
        grid.Children.Add(battery);
        return grid;
    }

    private static StackPanel Metric(string label, UIElement value)
    {
        var column = new StackPanel { Spacing = MetricLabelSpacing };
        column.Children.Add(new TextBlock
        {
            Text = label,
            FontSize = LabelFontSize,
            Foreground = DisplayTokens.TextMuted,
        });
        column.Children.Add(value);
        return column;
    }

    private static TextBlock ValueText(string value) => new()
    {
        Text = value,
        FontSize = ValueFontSize,
        FontWeight = FontWeights.Medium,
        Foreground = DisplayTokens.TextPrimary,
    };

    private static StackPanel BuildBattery(TripLegItemDisplay item)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = RouteSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };

        row.Children.Add(SocText(item.StartSocText, DisplayTokens.Brush(StartBrushKey)));
        row.Children.Add(SocText("\u2192", DisplayTokens.TextMuted));
        row.Children.Add(SocText(
            item.ArrivalSocText,
            DisplayTokens.Brush(item.ArrivalIsLow ? EndBrushKey : WarnBrushKey)));
        return row;
    }

    private static TextBlock SocText(string value, Brush foreground) => new()
    {
        Text = value,
        FontSize = ValueFontSize,
        FontWeight = FontWeights.Medium,
        Foreground = foreground,
        VerticalAlignment = VerticalAlignment.Center,
    };

    // ── Charge stop (web blue-500/20 card after the leg) ─────────────────────────────────────────────────
    private static Border BuildChargeStop(TripChargeStopDisplay stop)
    {
        var accent = ResolveStopAccent();

        var bolt = DecorativeIcon(TripLegListRegistration.ZapGlyph, StopIconSize, accent);
        bolt.VerticalAlignment = VerticalAlignment.Top;

        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = StopColumnSpacing,
        };
        row.Children.Add(bolt);
        row.Children.Add(BuildStopBody(stop, accent));

        var card = new Border
        {
            CornerRadius = new CornerRadius(StopRadius),
            BorderThickness = new Thickness(1),
            BorderBrush = Tint(accent, StopBorderOpacity),
            Background = Tint(accent, StopFillOpacity),
            Padding = new Thickness(StopPadding),
            Margin = new Thickness(12, 8, 0, 4),
            Child = row,
        };

        AutomationProperties.SetName(card, stop.AutomationName);
        return card;
    }

    private static StackPanel BuildStopBody(TripChargeStopDisplay stop, Brush accent)
    {
        var body = new StackPanel { Spacing = StopBodySpacing };

        body.Children.Add(new TextBlock
        {
            Text = stop.Name,
            FontSize = StopFontSize,
            FontWeight = FontWeights.Medium,
            Foreground = accent,
            TextWrapping = TextWrapping.Wrap,
        });

        body.Children.Add(BuildStopMetrics(stop));

        if (stop.IsRecommended)
        {
            body.Children.Add(new TextBlock
            {
                Text = stop.RecommendedText,
                FontSize = RecommendedFontSize,
                FontStyle = Windows.UI.Text.FontStyle.Italic,
                Foreground = DisplayTokens.TextMuted,
                TextWrapping = TextWrapping.Wrap,
            });
        }

        return body;
    }

    private static StackPanel BuildStopMetrics(TripChargeStopDisplay stop)
    {
        var metrics = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = StopMetricsSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var duration = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = StopChipSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };
        duration.Children.Add(DecorativeIcon(TripLegListRegistration.ClockGlyph, StopMetaIconSize, DisplayTokens.TextSecondary));
        duration.Children.Add(StopMeta(stop.DurationText, DisplayTokens.TextSecondary));
        metrics.Children.Add(duration);

        metrics.Children.Add(StopMeta(stop.SocRangeText, DisplayTokens.TextSecondary));
        metrics.Children.Add(StopMeta(stop.EnergyText, DisplayTokens.TextSecondary));
        metrics.Children.Add(StopMeta(stop.CostText, DisplayTokens.Brush(CostBrushKey)));
        return metrics;
    }

    private static TextBlock StopMeta(string value, Brush foreground) => new()
    {
        Text = value,
        FontSize = LabelFontSize,
        Foreground = foreground,
        VerticalAlignment = VerticalAlignment.Center,
    };

    // ── Empty (web legItems.length === 0 — friendly stand-in, never a blank box) ─────────────────────────
    private static TsGlassPanel BuildEmpty(TripLegListDisplay display)
    {
        var column = new StackPanel { Spacing = TitleGap };
        column.Children.Add(Title(display.Title));

        var empty = new TsEmptyState
        {
            IconGlyph = EmptyGlyph,
            Message = display.EmptyMessage,
        };
        column.Children.Add(empty);

        var panel = Panel(column);
        LiveRegion.Configure(empty);
        LiveRegion.Announce(empty);
        return panel;
    }

    private static SectionTitle Title(string text) => new() { Value = text };

    private static TsGlassPanel Panel(UIElement content) => new()
    {
        Padding = new Thickness(PanelPadding),
        Content = content,
    };

    private static SolidColorBrush ResolveStopAccent() => DisplayTokens.Brush(StopAccentBrushKey) switch
    {
        SolidColorBrush solid => solid,
        _ => new SolidColorBrush(StopAccentFallback),
    };

    private static SolidColorBrush Tint(Brush accent, double opacity)
    {
        var color = accent is SolidColorBrush solid ? solid.Color : StopAccentFallback;
        return new SolidColorBrush(color) { Opacity = opacity };
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

        // Decorative — its meaning is carried by the adjacent text and the card / surface Narrator names.
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        return icon;
    }
}
