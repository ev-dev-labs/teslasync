using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Analytics;

/// <summary>
/// The native WinUI 3 <c>BatteryTab</c> feature surface — a parity port of
/// web/src/features/analytics/components/analytics/BatteryTab.tsx. Assign a <see cref="Model"/> (the web
/// analytics <c>data.battery_trend</c>) and a <see cref="Units"/> preference and it renders exactly one of
/// the web branches: <see cref="BatteryTabState.Loading"/> (the hero-grid + chart skeleton chrome),
/// <see cref="BatteryTabState.Empty"/> (the web <c>trend.length === 0</c> EmptyState with the battery
/// glyph), or <see cref="BatteryTabState.Ready"/> (the five hero metric cards plus the Health Score
/// Timeline area chart, the Capacity and Range line charts, and the Degradation &amp; Cycles composed
/// chart). The view never performs HTTP; all branch selection, label resolution, unit conversion and
/// formatting happen in the WinUI-free <see cref="BatteryTabProjection"/>. Every string resolves through
/// the i18n facade and every region carries a Narrator name.
/// </summary>
public sealed partial class BatteryTab : ContentControl
{
    // Segoe Fluent Icons — Battery (the web <Battery/> lucide glyph), consistent with the battery widgets.
    private const string BatteryGlyph = "\uE83F";
    private const double TallChartHeight = 280;
    private const double WideChartHeight = 260;

    private readonly ILocalizer _localizer;
    private readonly BatteryTabDiagnostics _diagnostics;

    private BatteryTabModel _model;
    private UnitPref _units;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, unit preference, an initial model and diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="units">The user's unit preference applied at the display boundary.</param>
    /// <param name="model">The initial render model; defaults to <see cref="BatteryTabModel.Pending"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public BatteryTab(
        ILocalizer localizer,
        UnitPref units,
        BatteryTabModel? model = null,
        BatteryTabDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(units);

        _localizer = localizer;
        _units = units;
        _model = model ?? BatteryTabModel.Pending;
        _diagnostics = diagnostics ?? new BatteryTabDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>BatteryTab</c>).</summary>
    public static string Slug => BatteryTabRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public BatteryTabModel Model
    {
        get => _model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _model = value;
            Render();
        }
    }

    /// <summary>The unit preference; reassigning re-projects and re-renders the surface.</summary>
    public UnitPref Units
    {
        get => _units;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _units = value;
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
        var display = BatteryTabProjection.Project(_model, _localizer, _units);

        UIElement surface = display.State switch
        {
            BatteryTabState.Loading => BuildLoading(display),
            BatteryTabState.Empty => BuildEmpty(display),
            _ => BuildReady(display),
        };

        AutomationProperties.SetName(this, display.AutomationName);
        Content = surface;
    }

    // ── Loading: the hero-grid + chart skeleton chrome (web parent's loading state) ─────────────────
    private static StackPanel BuildLoading(BatteryTabDisplay display)
    {
        var stack = new StackPanel { Spacing = 16 };
        stack.Children.Add(new TsStatGridSkeleton(5));
        stack.Children.Add(new TsChartBlockSkeleton());
        stack.Children.Add(new TsChartBlockSkeleton());
        stack.Children.Add(new TsChartBlockSkeleton());

        AutomationProperties.SetName(stack, display.AutomationName);
        LiveRegion.Configure(stack);
        LiveRegion.Announce(stack);
        return stack;
    }

    // ── Empty: web `trend.length === 0` → EmptyState with the battery glyph ─────────────────────────
    private static TsGlassPanel BuildEmpty(BatteryTabDisplay display)
    {
        var empty = new TsEmptyState
        {
            Message = display.EmptyMessage,
            IconGlyph = BatteryGlyph,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var panel = new TsGlassPanel { Padding = new Thickness(24), Content = empty };
        AutomationProperties.SetName(panel, display.AutomationName);
        return panel;
    }

    // ── Ready: hero metric grid + four chart panels, wrapped in the FadeIn entrance (web layout) ────
    private static TsFadeIn BuildReady(BatteryTabDisplay display)
    {
        var stack = new StackPanel { Spacing = 16 };
        stack.Children.Add(BuildMetricGrid(display.Metrics));
        stack.Children.Add(BuildChartPanel(display.Charts[0], TallChartHeight));
        stack.Children.Add(BuildChartRow(display.Charts[1], display.Charts[2]));
        stack.Children.Add(BuildChartPanel(display.Charts[3], TallChartHeight));

        return new TsFadeIn { Content = stack };
    }

    // The web `grid-cols-2 md:grid-cols-3 lg:grid-cols-5` hero strip — one equal column per metric.
    private static Grid BuildMetricGrid(IReadOnlyList<BatteryMetricCard> metrics)
    {
        var grid = new Grid { ColumnSpacing = 12, RowSpacing = 12 };
        for (int i = 0; i < metrics.Count; i++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        for (int i = 0; i < metrics.Count; i++)
        {
            var metric = metrics[i];
            var card = new TsMetricCard
            {
                Label = metric.Label,
                Value = metric.Value,
                DeltaText = metric.Subtitle,
                AccentBrushKey = metric.AccentBrushKey,
            };

            // The card auto-names itself "label: value"; override with the unit-bearing projection name.
            AutomationProperties.SetName(card, metric.AutomationName);
            Grid.SetColumn(card, i);
            grid.Children.Add(card);
        }

        return grid;
    }

    // The web `grid-cols-1 lg:grid-cols-2` row holding the Capacity and Range trends side by side.
    private static Grid BuildChartRow(BatteryChartPanel left, BatteryChartPanel right)
    {
        var grid = new Grid { ColumnSpacing = 16 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var leftPanel = BuildChartPanel(left, WideChartHeight);
        var rightPanel = BuildChartPanel(right, WideChartHeight);
        Grid.SetColumn(leftPanel, 0);
        Grid.SetColumn(rightPanel, 1);
        grid.Children.Add(leftPanel);
        grid.Children.Add(rightPanel);
        return grid;
    }

    // One web `GlassPanel` → `SectionTitle` + chart. The legend is shown only for the composed
    // (multi-series) panel, mirroring the web source's single `<Legend/>` on Degradation & Cycles.
    private static TsGlassPanel BuildChartPanel(BatteryChartPanel panel, double chartHeight)
    {
        var stack = new StackPanel { Spacing = 8 };
        stack.Children.Add(new SectionTitle { Value = panel.Title });

        TsCartesianChart chart = panel.Kind switch
        {
            BatteryChartKind.Area => new TsAreaChart(),
            BatteryChartKind.Line => new TsLineChart(),
            _ => new TsComposedChart(),
        };
        chart.Title = panel.Title;
        chart.Series = panel.Series;
        chart.ShowLegend = panel.Series.Count > 1;
        chart.Height = chartHeight;
        stack.Children.Add(chart);

        var box = new TsGlassPanel { Padding = new Thickness(16), Content = stack };
        AutomationProperties.SetName(box, panel.AutomationName);
        return box;
    }
}
