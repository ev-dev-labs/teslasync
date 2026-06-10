using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Driving;

/// <summary>
/// The native WinUI 3 <c>SOCRouteChart</c> feature surface — a parity port of
/// <c>web/src/features/driving/components/SOCRouteChart.tsx</c>. The web component is a pure presentational
/// child (its only hook is <c>useTranslation</c>): given a planned trip's <c>socCurve</c>, its
/// <c>chargeStops</c> and the <c>minArrivalSOC</c> threshold it renders a <c>ChartContainer</c> wrapping an
/// <c>AreaChart</c> of battery state-of-charge along the route, a red horizontal "min arrival" reference line
/// and a blue vertical reference line per charge stop. This surface reproduces that area chart with the native
/// <see cref="TsAreaChart"/> (the SOC curve plus the reference <see cref="SOCRouteChartDisplay.Annotations"/>),
/// the axis titles the web source places inside the plot, and the accessible <c>Distance</c> / <c>SOC %</c>
/// fallback table the web <c>dataColumns</c> declare. Assign a <see cref="Model"/> and the surface renders
/// exactly one of the projected states — <see cref="SOCRouteChartState.Loading"/> (chart skeleton),
/// <see cref="SOCRouteChartState.Error"/> (a <c>QueryError</c> with a retry affordance),
/// <see cref="SOCRouteChartState.Empty"/> (the friendly "plan a trip" surface), or the chart itself for
/// <see cref="SOCRouteChartState.Ready"/> / <see cref="SOCRouteChartState.Stale"/> /
/// <see cref="SOCRouteChartState.Offline"/> (the stale and offline snapshots adding a freshness chip). The view
/// never performs HTTP; all branch selection, rounding, stop-matching and label resolution happen in the
/// WinUI-free <see cref="SOCRouteChartProjection"/>. Every string resolves through the i18n facade and every
/// region carries a Narrator name.
/// </summary>
public sealed partial class SOCRouteChart : ContentControl
{
    private const double ChartHeight = 300; // web ResponsiveContainer height={300}
    private const double YAxisTitleWidth = 22;
    private const double AxisFontSize = 11;
    private const int TableRowsPerPage = 12;

    private readonly ILocalizer _localizer;
    private readonly SOCRouteChartDiagnostics _diagnostics;

    private SOCRouteChartModel _model;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="SOCRouteChartModel.Pending"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public SOCRouteChart(
        ILocalizer localizer,
        SOCRouteChartModel? model = null,
        SOCRouteChartDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? SOCRouteChartModel.Pending;
        _diagnostics = diagnostics ?? new SOCRouteChartDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>Raised when the user invokes retry from the error surface; the host re-runs the plan.</summary>
    public event EventHandler? RetryRequested;

    /// <summary>The canonical diagnostics slug this surface registers under (<c>SOCRouteChart</c>).</summary>
    public static string Slug => SOCRouteChartRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public SOCRouteChartModel Model
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
        SOCRouteChartDisplay display = SOCRouteChartProjection.Project(_model, _localizer);

        UIElement surface = display.State switch
        {
            SOCRouteChartState.Loading => BuildLoading(display),
            SOCRouteChartState.Error => BuildError(display),
            SOCRouteChartState.Empty => BuildEmpty(display),
            _ => BuildChart(display),
        };

        AutomationProperties.SetName(this, display.AutomationName);
        Content = surface;
    }

    // ── Loading (web ChartContainer spinner) ────────────────────────────────────────────────────────
    private static TsGlassPanel BuildLoading(SOCRouteChartDisplay display)
    {
        var stack = new StackPanel { Spacing = 12 };
        stack.Children.Add(BuildHeader(display));
        stack.Children.Add(new TsChartSkeleton());

        var box = Box(stack, display.AutomationName);
        LiveRegion.Configure(box);
        LiveRegion.Announce(box);
        return box;
    }

    // ── Error (web QueryError equivalent with a retry affordance) ────────────────────────────────────
    private TsGlassPanel BuildError(SOCRouteChartDisplay display)
    {
        var stack = new StackPanel { Spacing = 12 };
        stack.Children.Add(BuildHeader(display));

        var error = new TsQueryError
        {
            Message = display.ErrorMessage,
            ActionText = display.RetryLabel,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += (_, _) => RetryRequested?.Invoke(this, EventArgs.Empty);
        stack.Children.Add(error);

        return Box(stack, display.AutomationName);
    }

    // ── Empty (web `tripPlanner.socChart.empty` → friendly empty state) ──────────────────────────────
    private static TsGlassPanel BuildEmpty(SOCRouteChartDisplay display)
    {
        var stack = new StackPanel { Spacing = 12 };
        stack.Children.Add(BuildHeader(display));
        stack.Children.Add(new TsEmptyState
        {
            Message = display.EmptyMessage,
            VerticalAlignment = VerticalAlignment.Center,
        });

        return Box(stack, display.AutomationName);
    }

    // ── Ready / Stale / Offline (web fall-through: the AreaChart + reference lines + accessible table) ─
    private static TsGlassPanel BuildChart(SOCRouteChartDisplay display)
    {
        var stack = new StackPanel { Spacing = 12 };
        stack.Children.Add(BuildHeader(display));
        stack.Children.Add(BuildPlot(display));
        stack.Children.Add(BuildTable(display));

        return Box(stack, display.AutomationName);
    }

    // web `<ChartContainer title=...>` heading, with the stale / offline freshness chip on the trailing edge.
    private static Grid BuildHeader(SOCRouteChartDisplay display)
    {
        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var title = new PanelTitle { Value = display.Title, VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(title, 0);
        grid.Children.Add(title);

        if (display.FreshnessChip is { } chipText)
        {
            TsBadge chip = BuildChip(display.State, chipText);
            Grid.SetColumn(chip, 1);
            grid.Children.Add(chip);
        }

        return grid;
    }

    // The stale / offline freshness chip: a tokenized status badge whose tone tells a freshness from an offline
    // snapshot apart, with a leading status dot and a Narrator name.
    private static TsBadge BuildChip(SOCRouteChartState state, string text)
    {
        var badge = new TsBadge
        {
            Status = state == SOCRouteChartState.Offline ? StatusKind.Danger : StatusKind.Warning,
            Dot = true,
            Content = text,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(badge, text);
        return badge;
    }

    /// <summary>
    /// The battery state-of-charge area plot — the native analogue of the web recharts <c>AreaChart</c>. The
    /// single SOC area series is laid out between the web's inside axis titles (the rotated <c>SOC %</c> label
    /// on the left and the <c>km</c> distance label at the bottom-right), and the projected reference
    /// <see cref="SOCRouteChartDisplay.Annotations"/> (the horizontal min-arrival threshold and a vertical line
    /// per charge stop) are overlaid by the chart. The chart carries the aria-label as its Narrator name; the
    /// axis titles are decorative (their content is already spoken through the table).
    /// </summary>
    private static Grid BuildPlot(SOCRouteChartDisplay display)
    {
        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(YAxisTitleWidth) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

        Border yTitle = BuildYAxisTitle(display.AxisYTitle);
        Grid.SetRow(yTitle, 0);
        Grid.SetColumn(yTitle, 0);
        grid.Children.Add(yTitle);

        var chart = new TsAreaChart
        {
            Series = [display.Series],
            Annotations = display.Annotations,
            ShowLegend = false,
            IncludeZero = true,
            Title = display.Title,
            MinHeight = ChartHeight,
        };
        AutomationProperties.SetName(chart, display.AriaLabel);
        Grid.SetRow(chart, 0);
        Grid.SetColumn(chart, 1);
        grid.Children.Add(chart);

        var xTitle = new TextBlock
        {
            Text = display.AxisXTitle,
            FontSize = AxisFontSize,
            Foreground = DisplayTokens.TextMuted,
            HorizontalAlignment = HorizontalAlignment.Right,
            Margin = new Thickness(0, 4, 0, 0),
        };
        AutomationProperties.SetAccessibilityView(xTitle, AccessibilityView.Raw);
        Grid.SetRow(xTitle, 1);
        Grid.SetColumn(xTitle, 1);
        grid.Children.Add(xTitle);

        return grid;
    }

    private static Border BuildYAxisTitle(string text)
    {
        var label = new TextBlock
        {
            Text = text,
            FontSize = AxisFontSize,
            Foreground = DisplayTokens.TextMuted,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            TextWrapping = TextWrapping.NoWrap,
            RenderTransformOrigin = new Windows.Foundation.Point(0.5, 0.5),
            RenderTransform = new RotateTransform { Angle = -90 },
        };
        AutomationProperties.SetAccessibilityView(label, AccessibilityView.Raw);

        return new Border
        {
            Width = YAxisTitleWidth,
            Child = label,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
    }

    // The web ChartContainer's accessible fallback table (dataColumns Distance / SOC %), under a native
    // Expander so the precise per-sample figures stay one toggle away from the visual curve.
    private static Expander BuildTable(SOCRouteChartDisplay display)
    {
        var columns = new List<TsDataColumn>(2)
        {
            new() { Key = SOCRouteChartProjection.DistanceKey, Header = display.DistanceColumnLabel, IsNumeric = true },
            new() { Key = SOCRouteChartProjection.SocKey, Header = display.SocColumnLabel, IsNumeric = true },
        };

        var rows = new List<TsDataRow>(display.Rows.Count);
        foreach (SOCRouteChartRow row in display.Rows)
        {
            rows.Add(new TsDataRow(
                row.RowKey,
                new Dictionary<string, object?>(StringComparer.Ordinal)
                {
                    [SOCRouteChartProjection.DistanceKey] = row.Distance,
                    [SOCRouteChartProjection.SocKey] = row.Soc,
                }));
        }

        var table = new TsDataTable
        {
            Columns = columns,
            Rows = rows,
            PageSize = TableRowsPerPage,
            Selectable = false,
            EmptyMessage = display.EmptyMessage,
        };

        var expander = new Expander
        {
            Header = display.DataTableLabel,
            Content = table,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
        };
        AutomationProperties.SetName(expander, display.DataTableLabel);
        return expander;
    }

    private static TsGlassPanel Box(UIElement content, string automationName)
    {
        var panel = new TsGlassPanel { Padding = new Thickness(16), Content = content };
        AutomationProperties.SetName(panel, automationName);
        return panel;
    }
}
