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

namespace TeslaSync.App.FeatureViews.Charging;

/// <summary>
/// The native WinUI 3 <c>SessionCurveChart</c> feature surface — a parity port of
/// <c>web/src/features/charging/components/charging-curve/SessionCurveChart.tsx</c>. The web component is a
/// pure presentational child (its only hook is <c>useTranslation</c>): given a session's Power-vs-SOC
/// <c>curveData</c> it renders a <c>ChartContainer</c> wrapping an accent <c>AreaChart</c>. This surface
/// reproduces that area chart with the native <see cref="TsAreaChart"/>, the axis titles the web source
/// places inside the plot, and the accessible <c>SOC %</c> / <c>Power (kW)</c> fallback table the web
/// <c>dataColumns</c> declare. Assign a <see cref="Model"/> and the surface renders exactly one of the
/// projected states — <see cref="SessionCurveChartState.Loading"/> (chart skeleton),
/// <see cref="SessionCurveChartState.Error"/> (a <c>QueryError</c> with a retry affordance),
/// <see cref="SessionCurveChartState.Empty"/> (a friendly empty surface), or the chart itself for
/// <see cref="SessionCurveChartState.Ready"/> / <see cref="SessionCurveChartState.Stale"/> /
/// <see cref="SessionCurveChartState.Offline"/> (the stale and offline snapshots adding a freshness chip).
/// The view never performs HTTP; all branch selection, rounding and label resolution happen in the
/// WinUI-free <see cref="SessionCurveChartProjection"/>. Every string resolves through the i18n facade and
/// every region carries a Narrator name.
/// </summary>
public sealed partial class SessionCurveChart : ContentControl
{
    private const double ChartHeight = 320;
    private const double YAxisTitleWidth = 22;
    private const double AxisFontSize = 11;
    private const int TableRowsPerPage = 12;

    private readonly ILocalizer _localizer;
    private readonly SessionCurveChartDiagnostics _diagnostics;

    private SessionCurveChartModel _model;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="SessionCurveChartModel.Pending"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public SessionCurveChart(
        ILocalizer localizer,
        SessionCurveChartModel? model = null,
        SessionCurveChartDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? SessionCurveChartModel.Pending;
        _diagnostics = diagnostics ?? new SessionCurveChartDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>Raised when the user invokes retry from the error surface; the host re-runs the load.</summary>
    public event EventHandler? RetryRequested;

    /// <summary>The canonical diagnostics slug this surface registers under (<c>SessionCurveChart</c>).</summary>
    public static string Slug => SessionCurveChartRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public SessionCurveChartModel Model
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
        SessionCurveChartDisplay display = SessionCurveChartProjection.Project(_model, _localizer);

        UIElement surface = display.State switch
        {
            SessionCurveChartState.Loading => BuildLoading(display),
            SessionCurveChartState.Error => BuildError(display),
            SessionCurveChartState.Empty => BuildEmpty(display),
            _ => BuildChart(display),
        };

        AutomationProperties.SetName(this, display.AutomationName);
        Content = surface;
    }

    // ── Loading (web ChartContainer spinner) ────────────────────────────────────────────────────────
    private static TsGlassPanel BuildLoading(SessionCurveChartDisplay display)
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
    private TsGlassPanel BuildError(SessionCurveChartDisplay display)
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

    // ── Empty (web `chart.noData` → friendly empty state) ───────────────────────────────────────────
    private static TsGlassPanel BuildEmpty(SessionCurveChartDisplay display)
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

    // ── Ready / Stale / Offline (web fall-through: the AreaChart + accessible data table) ────────────
    private static TsGlassPanel BuildChart(SessionCurveChartDisplay display)
    {
        var stack = new StackPanel { Spacing = 12 };
        stack.Children.Add(BuildHeader(display));
        stack.Children.Add(BuildPlot(display));
        stack.Children.Add(BuildTable(display));

        return Box(stack, display.AutomationName);
    }

    private static Grid BuildHeader(SessionCurveChartDisplay display)
    {
        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var titles = new StackPanel { Spacing = 2 };
        titles.Children.Add(new PanelTitle { Value = display.Title });
        titles.Children.Add(new Caption { Value = display.Subtitle });
        Grid.SetColumn(titles, 0);
        grid.Children.Add(titles);

        if (display.FreshnessChip is { } chipText)
        {
            TsBadge chip = BuildChip(display.State, chipText);
            Grid.SetColumn(chip, 1);
            grid.Children.Add(chip);
        }

        return grid;
    }

    // The stale / offline freshness chip (web stale/offline chip): a tokenized status badge whose tone tells
    // a freshness from an offline snapshot apart, with a leading status dot and a Narrator name.
    private static TsBadge BuildChip(SessionCurveChartState state, string text)
    {
        var badge = new TsBadge
        {
            Status = state == SessionCurveChartState.Offline ? StatusKind.Danger : StatusKind.Warning,
            Dot = true,
            Content = text,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(badge, text);
        return badge;
    }

    /// <summary>
    /// The accent Power-vs-SOC plot — the native analogue of the web recharts <c>AreaChart</c>. The single
    /// area series is laid out between the web's inside axis titles: the rotated <c>Power (kW)</c> label on
    /// the left and the <c>SOC (%)</c> label at the bottom-right. The chart carries the aria-label as its
    /// Narrator name; the axis titles are decorative (their content is already spoken through the table).
    /// </summary>
    private static Grid BuildPlot(SessionCurveChartDisplay display)
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
            ShowLegend = false,
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

    // The web ChartContainer's accessible fallback table (dataColumns SOC % / Power (kW)), under a native
    // Expander so the precise per-sample figures stay one toggle away from the visual curve.
    private static Expander BuildTable(SessionCurveChartDisplay display)
    {
        var columns = new List<TsDataColumn>(2)
        {
            new() { Key = SessionCurveChartProjection.SocKey, Header = display.SocColumnLabel, IsNumeric = true },
            new() { Key = SessionCurveChartProjection.PowerKey, Header = display.PowerColumnLabel, IsNumeric = true },
        };

        var rows = new List<TsDataRow>(display.Rows.Count);
        foreach (SessionCurveChartRow row in display.Rows)
        {
            rows.Add(new TsDataRow(
                row.RowKey,
                new Dictionary<string, object?>(StringComparer.Ordinal)
                {
                    [SessionCurveChartProjection.SocKey] = row.Soc,
                    [SessionCurveChartProjection.PowerKey] = row.Power,
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
