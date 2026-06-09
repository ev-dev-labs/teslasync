using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>CostPerKwhChart</c> feature surface — a parity port of
/// web/src/features/charging/components/cost-analysis/CostPerKwhChart.tsx. It is a pure presentational
/// control: assign a <see cref="Model"/> (the web <c>data: { date; costPerKwh }[]</c> prop plus the parent's
/// fetch flag) and it renders exactly one of three web-derived branches inside a translucent
/// <see cref="TsGlassPanel"/> — <see cref="CostPerKwhChartState.Loading"/> (the purple trend title +
/// skeleton chrome while the parent fetches the cost series), <see cref="CostPerKwhChartState.Empty"/> (the
/// title + a friendly <c>costAnalysis.charts.noData</c> empty state when there are no points to plot, the
/// web's <c>data.length === 0</c> branch), or <see cref="CostPerKwhChartState.Ready"/> (the blended-rate
/// trend <see cref="TsLineChart"/> — the native analogue of the recharts <c>LineChart</c> whose single
/// <c>costPerKwh</c> line is stroked from the third brand palette colour). The view never performs HTTP; all
/// branch selection, label resolution and currency formatting happen in the WinUI-free
/// <see cref="CostPerKwhChartProjection"/>. Every string resolves through the i18n facade and the surface
/// carries a Narrator name describing the plotted range.
/// </summary>
public sealed partial class CostPerKwhChart : ContentControl
{
    // web `<ResponsiveContainer height={260}>` (and the empty branch's `h-[260px]` box).
    private const double ChartHeight = 260;

    // Segoe Fluent "trending" glyph — the native analogue of the web `BarChart3` (lucide) header icon for a
    // "Cost per kWh Trend", matching the glyph convention used across the analytics widgets.
    private const string TrendChartGlyph = "\uE9D2";

    // web `stroke={palette[2]}` — the third (zero-based) categorical brand chart colour for the line.
    private const int LineColorIndex = 2;

    // The web header icon is `text-purple-400`; the Okabe-Ito reddish-purple brand chart colour
    // (TsChart07Brush, palette index 6) is the theme-aware token analogue, so the icon tints correctly
    // across light / dark / high-contrast rather than hard-coding a hex purple.
    private const int IconColorIndex = 6;

    // web `tickFormatter={(v) => formatCurrency(v, 2)}` — two-decimal value precision on the rate series.
    private const int CostDecimals = 2;

    private readonly ILocalizer _localizer;
    private readonly CostPerKwhChartDiagnostics _diagnostics;

    private CostPerKwhChartModel _model;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="CostPerKwhChartModel.Pending"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public CostPerKwhChart(
        ILocalizer localizer,
        CostPerKwhChartModel? model = null,
        CostPerKwhChartDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? CostPerKwhChartModel.Pending;
        _diagnostics = diagnostics ?? new CostPerKwhChartDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>CostPerKwhChart</c>).</summary>
    public static string Slug => CostPerKwhChartRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public CostPerKwhChartModel Model
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
        var display = CostPerKwhChartProjection.Project(_model, _localizer);

        UIElement surface = display.State switch
        {
            CostPerKwhChartState.Loading => BuildLoading(display),
            CostPerKwhChartState.Empty => BuildEmpty(display),
            _ => BuildReady(display),
        };

        AutomationProperties.SetName(this, display.AutomationName);
        Content = surface;
    }

    // ── Loading (parent still fetching the cost series) ──────────────────────────────────────────────
    private static TsGlassPanel BuildLoading(CostPerKwhChartDisplay display)
    {
        var stack = new StackPanel { Spacing = 16 };
        stack.Children.Add(BuildHeader(display));
        stack.Children.Add(new TsSkeleton { BlockHeight = ChartHeight, Radius = 10 });

        var box = Box(stack, display.AutomationName);
        LiveRegion.Configure(box);
        LiveRegion.Announce(box);
        return box;
    }

    // ── Empty (web: `data.length === 0`) ─────────────────────────────────────────────────────────────
    private static TsGlassPanel BuildEmpty(CostPerKwhChartDisplay display)
    {
        var stack = new StackPanel { Spacing = 16 };
        stack.Children.Add(BuildHeader(display));
        stack.Children.Add(new TsEmptyState
        {
            IconGlyph = TrendChartGlyph,
            Message = display.EmptyMessage,
            MinHeight = ChartHeight,
            VerticalAlignment = VerticalAlignment.Center,
        });

        return Box(stack, display.AutomationName);
    }

    // ── Ready (web fall-through: the GlassPanel header + the LineChart) ───────────────────────────────
    private static TsGlassPanel BuildReady(CostPerKwhChartDisplay display)
    {
        var stack = new StackPanel { Spacing = 16 };
        stack.Children.Add(BuildHeader(display));
        stack.Children.Add(BuildChart(display));

        return Box(stack, display.AutomationName);
    }

    // web `<h3 className="... flex items-center gap-2 ...">` — the purple BarChart3 icon + the title.
    private static StackPanel BuildHeader(CostPerKwhChartDisplay display)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };

        var icon = new FontIcon
        {
            Glyph = TrendChartGlyph,
            FontSize = 16,
            Foreground = DisplayTokens.Brush(ChartPalette.KeyForIndex(IconColorIndex)),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        row.Children.Add(icon);
        row.Children.Add(new PanelTitle { Value = display.Title, VerticalAlignment = VerticalAlignment.Center });
        return row;
    }

    /// <summary>
    /// The blended cost-per-kWh trend line — the native analogue of the web recharts <c>LineChart</c>. The
    /// single series carries the "$/kWh" rate label (the web <c>Line name</c>), is stroked from the third
    /// brand palette colour (the web <c>stroke={palette[2]}</c>), and rounds its values to two decimals (the
    /// web <c>formatCurrency(v, 2)</c> value precision). Each projected point plots its ordinal index on the
    /// numeric x-domain with the period label carried into the cursor tooltip (the web
    /// <c>XAxis dataKey="date"</c>); the value-anchored-at-zero domain mirrors the web's currency axis.
    /// </summary>
    private static TsLineChart BuildChart(CostPerKwhChartDisplay display)
    {
        var points = new List<ChartPoint>(display.Points.Count);
        foreach (var point in display.Points)
        {
            points.Add(new ChartPoint(point.Index, point.CostPerKwh, point.DateLabel));
        }

        var series = new[]
        {
            new ChartSeries(display.RateLabel, points)
            {
                Kind = ChartSeriesKind.Line,
                ColorIndex = LineColorIndex,
                Decimals = CostDecimals,
            },
        };

        var chart = new TsLineChart
        {
            Series = series,
            Title = display.Title,
            Height = ChartHeight,
            ShowLegend = false,
            IncludeZero = true,
        };
        AutomationProperties.SetName(chart, display.AutomationName);
        return chart;
    }

    private static TsGlassPanel Box(UIElement content, string automationName)
    {
        var panel = new TsGlassPanel { Padding = new Thickness(16), Content = content }; // web p-4
        AutomationProperties.SetName(panel, automationName);
        return panel;
    }
}
