using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>ChartsRow</c> feature surface — a parity port of
/// web/src/features/charging/components/charging-list/ChartsRow.tsx. It is a presentational row: assign a
/// <see cref="Model"/> (the web <c>energyTrend</c> / <c>chargerBreakdown</c> / <c>costByType</c> props, plus
/// the parent's fetch flag) and it renders the web's responsive two-panel grid (<c>grid-cols-1
/// lg:grid-cols-2</c>) — each panel a <see cref="TsGlassPanel"/> entering through a <see cref="TsFadeIn"/>:
/// <list type="number">
/// <item>"Energy &amp; Cost Trend": a Calendar-accented header over the overlaid energy-area / cost-line
/// trend (the native analogue of the recharts <c>AreaChart</c>), with the categorical date range surfaced
/// beneath the plot.</item>
/// <item>"Charger Breakdown": a Plug-accented header over the connector-mix donut (<see cref="TsPieChart"/>,
/// the recharts <c>PieChart</c>) beside the per-type energy / cost / $-per-kWh rows.</item>
/// </list>
/// The view never performs HTTP; all branch selection, label resolution and formatting happen in the
/// WinUI-free <see cref="ChartsRowProjection"/>. It renders every state the input implies — skeleton chrome
/// while the parent fetches, a friendly empty state per panel (never a blank box), and the charts otherwise.
/// Entrances honour reduce-motion through <see cref="TsFadeIn"/>, every string resolves through the i18n
/// facade, and the surface, each panel, each chart and each cost row carry a Narrator name.
/// </summary>
public sealed partial class ChartsRow : ContentControl
{
    private const double TwoColumnMinWidth = 640; // web lg: breakpoint — two panels side by side above this
    private const double PanelPadding = 24;       // web p-6
    private const double PanelGap = 24;            // web gap-6
    private const double HeaderGlyphSize = 16;     // web h-4 w-4 lucide icon
    private const double TrendChartHeight = 208;   // web sm:h-52
    private const double PieSize = 180;            // web sm:h-48 w-48 (≈)
    private const double PieInnerRadiusRatio = 0.57; // web innerRadius 40 / outerRadius 70
    private const int EnergyFadeDelayMs = 100;     // web FadeIn delay={0.1}
    private const int ChargerFadeDelayMs = 150;    // web FadeIn delay={0.15}
    private const int CostSeriesColorIndex = 2;    // distinct brand-palette colour for the cost line

    private const string CalendarGlyph = "\uE787"; // Segoe Fluent — Calendar (web lucide Calendar)
    private const string PlugGlyph = "\uE945";     // Segoe Fluent — LightningBolt (web lucide Plug)
    private const string CyanAccentKey = "TsChartSpeedBrush";  // web text-neon-cyan accent
    private const string PurpleAccentKey = "TsChartPowerBrush"; // web text-neon-purple accent

    private readonly ILocalizer _localizer;
    private readonly ChartsRowDiagnostics _diagnostics;

    private ChartsRowModel _model;
    private bool _opened;
    private int _columns = 2;

    /// <summary>Creates the surface over its i18n facade, an initial model, and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="ChartsRowModel.Pending"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public ChartsRow(
        ILocalizer localizer,
        ChartsRowModel? model = null,
        ChartsRowDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? ChartsRowModel.Pending;
        _diagnostics = diagnostics ?? new ChartsRowDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Loaded += OnLoaded;
        SizeChanged += OnSizeChanged;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>ChartsRow</c>).</summary>
    public static string Slug => ChartsRowRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public ChartsRowModel Model
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

    private void OnSizeChanged(object sender, SizeChangedEventArgs e)
    {
        int desired = e.NewSize.Width >= TwoColumnMinWidth ? 2 : 1;
        if (desired != _columns)
        {
            _columns = desired;
            Render();
        }
    }

    private void Render()
    {
        var display = ChartsRowProjection.Project(_model, _localizer);
        AutomationProperties.SetName(this, display.AutomationName);

        Content = display.State == ChartsRowState.Loading
            ? BuildLoading(display)
            : BuildPanels(display);
    }

    // ── Loading (parent still fetching the sessions) ─────────────────────────────────────────────────────

    private Grid BuildLoading(ChartsRowDisplay display)
    {
        var grid = BuildResponsiveGrid(
            Fade(BuildLoadingPanel(), EnergyFadeDelayMs),
            Fade(BuildLoadingPanel(), ChargerFadeDelayMs));

        AutomationProperties.SetName(grid, display.LoadingLabel);
        LiveRegion.Configure(grid);
        LiveRegion.Announce(grid);
        return grid;
    }

    private static TsGlassPanel BuildLoadingPanel()
    {
        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(new TsSkeleton
        {
            BlockWidth = 180,
            BlockHeight = 18,
            ReduceMotion = MotionPreference.ReduceMotion,
        });
        column.Children.Add(new TsSkeleton
        {
            BlockHeight = TrendChartHeight,
            ReduceMotion = MotionPreference.ReduceMotion,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        });

        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
    }

    // ── Ready / Empty (both panels always render; each handles its own empty) ────────────────────────────

    private Grid BuildPanels(ChartsRowDisplay display)
    {
        var energy = Fade(BuildEnergyPanel(display.EnergyPanel), EnergyFadeDelayMs);
        var charger = Fade(BuildChargerPanel(display.ChargerPanel), ChargerFadeDelayMs);
        return BuildResponsiveGrid(energy, charger);
    }

    private static TsGlassPanel BuildEnergyPanel(ChartsRowEnergyPanel panel)
    {
        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(BuildHeader(panel.Title, CalendarGlyph, CyanAccentKey));
        column.Children.Add(panel.HasData ? BuildTrendBody(panel) : BuildEmptyBody(panel.EmptyMessage));

        var glass = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
        AutomationProperties.SetName(glass, panel.AutomationName);
        return glass;
    }

    private static StackPanel BuildTrendBody(ChartsRowEnergyPanel panel)
    {
        var energySeries = new ChartSeries(panel.EnergySeriesName, ToChartPoints(panel.EnergyPoints))
        {
            Kind = ChartSeriesKind.Area,
            Role = ChartRole.Energy, // web stroke #10b981 — the energy/battery green
        };
        var costSeries = new ChartSeries(panel.CostSeriesName, ToChartPoints(panel.CostPoints))
        {
            Kind = ChartSeriesKind.Line, // web cost is a dashed line over a transparent fill
            ColorIndex = CostSeriesColorIndex,
        };

        var chart = new TsComposedChart
        {
            Series = [energySeries, costSeries],
            ShowLegend = false, // web AreaChart has no <Legend>; series are distinguished by colour + tooltip
            ShowGrid = true,    // web {chartGrid}
            ShowAxes = true,    // web <YAxis> (value axis is meaningful)
            IncludeZero = true,
            Height = TrendChartHeight,
            Title = panel.Title,
        };
        AutomationProperties.SetName(chart, panel.ChartSummary);

        var body = new StackPanel { Spacing = 8 };
        body.Children.Add(chart);

        // The shared cartesian surface labels the x-axis numerically; the web x-axis is the date. Surface the
        // categorical date range beneath the plot so that context is never lost.
        var range = new Caption { Value = panel.DateRangeText, HorizontalAlignment = HorizontalAlignment.Center };
        AutomationProperties.SetAccessibilityView(range, AccessibilityView.Raw); // already in the chart summary
        body.Children.Add(range);
        return body;
    }

    private static TsGlassPanel BuildChargerPanel(ChartsRowChargerPanel panel)
    {
        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(BuildHeader(panel.Title, PlugGlyph, PurpleAccentKey));
        column.Children.Add(panel.HasData ? BuildChargerBody(panel) : BuildEmptyBody(panel.EmptyMessage));

        var glass = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
        AutomationProperties.SetName(glass, panel.AutomationName);
        return glass;
    }

    private static FrameworkElement BuildChargerBody(ChartsRowChargerPanel panel)
    {
        // No pie but rows present (or vice-versa): render only the half that has data, never an empty slot.
        if (!panel.HasPie)
        {
            return BuildCostList(panel.CostRows);
        }

        TsPieChart pie = BuildPie(panel);
        if (!panel.HasRows)
        {
            return pie;
        }

        var grid = new Grid { ColumnSpacing = PanelGap };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        Grid.SetColumn(pie, 0);
        var list = BuildCostList(panel.CostRows);
        list.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(list, 1);

        grid.Children.Add(pie);
        grid.Children.Add(list);
        return grid;
    }

    private static TsPieChart BuildPie(ChartsRowChargerPanel panel)
    {
        var values = new List<ChartPoint>(panel.Slices.Count);
        foreach (var slice in panel.Slices)
        {
            values.Add(new ChartPoint(0, slice.Value, slice.Name));
        }

        var pie = new TsPieChart
        {
            Values = values,
            InnerRadiusRatio = PieInnerRadiusRatio,
            Width = PieSize,
            Height = PieSize,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(pie, panel.ChartSummary);
        return pie;
    }

    private static StackPanel BuildCostList(IReadOnlyList<ChartsRowCostRow> rows)
    {
        var list = new StackPanel { Spacing = 12 }; // web space-y-3
        foreach (var row in rows)
        {
            list.Children.Add(BuildCostRow(row));
        }

        return list;
    }

    private static StackPanel BuildCostRow(ChartsRowCostRow row)
    {
        var item = new StackPanel { Spacing = 2 };

        // Top line (web text-sm): name (secondary) ←→ energy (primary, medium).
        var top = TwoColumnRow();
        top.Children.Add(InlineText(row.Name, BodyFontSize, DisplayTokens.TextSecondary, left: true));
        top.Children.Add(InlineText(row.EnergyText, BodyFontSize, DisplayTokens.TextPrimary, left: false, medium: true));

        // Bottom line (web text-xs, muted): "$cost total" ←→ "$perKwh/kWh".
        var bottom = TwoColumnRow();
        bottom.Children.Add(InlineText(row.CostText, CaptionFontSize, DisplayTokens.TextMuted, left: true));
        bottom.Children.Add(InlineText(row.PerKwhText, CaptionFontSize, DisplayTokens.TextMuted, left: false));

        item.Children.Add(top);
        item.Children.Add(bottom);
        AutomationProperties.SetName(item, row.AutomationName);
        return item;
    }

    private static Grid TwoColumnRow()
    {
        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        return grid;
    }

    private static TextBlock InlineText(string text, double fontSize, Brush foreground, bool left, bool medium = false)
    {
        var block = new TextBlock
        {
            Text = text,
            FontSize = fontSize,
            Foreground = foreground,
            HorizontalAlignment = left ? HorizontalAlignment.Left : HorizontalAlignment.Right,
            TextWrapping = TextWrapping.Wrap,
        };
        if (medium)
        {
            block.FontWeight = FontWeights.Medium;
        }

        Grid.SetColumn(block, left ? 0 : 1);
        return block;
    }

    // ── Shared chrome ────────────────────────────────────────────────────────────────────────────────────

    private static StackPanel BuildHeader(string title, string glyph, string accentBrushKey)
    {
        var header = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var icon = new FontIcon
        {
            Glyph = glyph,
            FontSize = HeaderGlyphSize,
            Foreground = DisplayTokens.Brush(accentBrushKey),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw); // decorative; title carries meaning

        header.Children.Add(icon);
        header.Children.Add(new PanelTitle { Value = title, VerticalAlignment = VerticalAlignment.Center });
        return header;
    }

    private static TsEmptyState BuildEmptyBody(string message) => new()
    {
        Message = message,
        VerticalAlignment = VerticalAlignment.Center,
        HorizontalAlignment = HorizontalAlignment.Center,
    };

    private static TsFadeIn Fade(FrameworkElement child, int delayMs) => new()
    {
        DelayMs = delayMs,
        Content = child,
        HorizontalAlignment = HorizontalAlignment.Stretch,
        VerticalAlignment = VerticalAlignment.Top,
    };

    private Grid BuildResponsiveGrid(FrameworkElement first, FrameworkElement second)
    {
        var grid = new Grid { ColumnSpacing = PanelGap, RowSpacing = PanelGap };

        if (_columns >= 2)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            Grid.SetColumn(first, 0);
            Grid.SetColumn(second, 1);
        }
        else
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            Grid.SetRow(first, 0);
            Grid.SetRow(second, 1);
        }

        grid.Children.Add(first);
        grid.Children.Add(second);
        return grid;
    }

    private static List<ChartPoint> ToChartPoints(IReadOnlyList<ChartsRowTrendPoint> points)
    {
        var result = new List<ChartPoint>(points.Count);
        foreach (var point in points)
        {
            result.Add(new ChartPoint(point.X, point.Value, point.DateLabel));
        }

        return result;
    }

    private static double BodyFontSize => TypographyTokens.Size("TsTypeBodyFontSize", 14);

    private static double CaptionFontSize => TypographyTokens.Size("TsTypeCaptionFontSize", 12);
}
