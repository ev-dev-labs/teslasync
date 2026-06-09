using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>MonthlyCostChart</c> feature surface — a parity port of
/// web/src/features/charging/components/cost-analysis/MonthlyCostChart.tsx. It is a pure presentational control:
/// assign a <see cref="Model"/> (the web <c>data</c> + <c>vehicleId</c> props) and it renders exactly one of the
/// two web branches — <see cref="MonthlyCostChartState.Ready"/> (the web <c>&lt;AreaChart&gt;</c>: the cost area
/// on the brand palette's first colour via <see cref="TsAreaChart"/>, any container-supplied annotation
/// reference lines the web spreads with <c>renderAnnotationLines</c>, and the accessible Month / Cost data table
/// the web <c>ChartContainer</c> exposes as its tabular fallback) or <see cref="MonthlyCostChartState.Empty"/>
/// (the web "Not enough data" message). The title renders in BOTH branches so the panel is never a blank box.
/// The view never performs HTTP; all branch selection, label resolution and number formatting happen in the
/// WinUI-free <see cref="MonthlyCostChartProjection"/>. Every string resolves through the i18n facade and the
/// surface, the chart and each table row carry a Narrator name.
/// </summary>
public sealed partial class MonthlyCostChart : ContentControl
{
    private const double ChartMinHeight = 260;   // web ChartContainer height={260}
    private const double PanelPadding = 16;       // web ChartContainer padding
    private const int RowsPerPage = 20;

    private readonly ILocalizer _localizer;
    private readonly MonthlyCostChartDiagnostics _diagnostics;
    private readonly string? _currencySymbol;

    private MonthlyCostChartModel _model;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, and (optional) diagnostics/currency.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="MonthlyCostChartModel.Empty"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    /// <param name="currencySymbol">The currency symbol (web <c>settings.currency_symbol</c>; default "$").</param>
    public MonthlyCostChart(
        ILocalizer localizer,
        MonthlyCostChartModel? model = null,
        MonthlyCostChartDiagnostics? diagnostics = null,
        string? currencySymbol = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? MonthlyCostChartModel.Empty;
        _diagnostics = diagnostics ?? new MonthlyCostChartDiagnostics();
        _currencySymbol = currencySymbol;

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>MonthlyCostChart</c>).</summary>
    public static string Slug => MonthlyCostChartRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public MonthlyCostChartModel Model
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
        var display = MonthlyCostChartProjection.Project(_model, _localizer, _currencySymbol);

        UIElement surface = display.State switch
        {
            MonthlyCostChartState.Ready => BuildReady(display),
            _ => BuildEmpty(display),
        };

        AutomationProperties.SetName(this, display.AutomationName);
        Content = surface;
    }

    // ── Ready (web fall-through: cost area chart + annotation lines + accessible table) ───────────────────
    private static TsGlassPanel BuildReady(MonthlyCostChartDisplay display)
    {
        var stack = new StackPanel { Spacing = 12 };
        stack.Children.Add(BuildHeader(display));
        stack.Children.Add(BuildChart(display));
        stack.Children.Add(BuildTable(display));

        return Box(stack, display.AutomationName);
    }

    // ── Empty (web `data.length === 0` → "Not enough data") ──────────────────────────────────────────────
    private static TsGlassPanel BuildEmpty(MonthlyCostChartDisplay display)
    {
        var stack = new StackPanel { Spacing = 12 };
        stack.Children.Add(BuildHeader(display));
        stack.Children.Add(new TsEmptyState
        {
            Message = display.EmptyMessage,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        });

        return Box(stack, display.AutomationName);
    }

    private static StackPanel BuildHeader(MonthlyCostChartDisplay display)
    {
        var header = new StackPanel { Spacing = 2 };
        header.Children.Add(new PanelTitle { Value = display.Title });
        return header;
    }

    /// <summary>
    /// The cost area chart — the native analogue of the web recharts <c>&lt;AreaChart&gt;</c> with its single
    /// <c>&lt;Area dataKey="cost" stroke={palette[0]}&gt;</c>. The container-supplied annotation reference lines
    /// (web <c>renderAnnotationLines</c>) are passed through as the chart's annotations. No legend is drawn — the
    /// web <c>AreaChart</c> renders none. The chart's Narrator name carries the aria label plus the
    /// currency-formatted cost range (the spoken analogue of the web currency Y-axis).
    /// </summary>
    private static TsAreaChart BuildChart(MonthlyCostChartDisplay display)
    {
        var chart = new TsAreaChart
        {
            Series = display.Series,
            Annotations = display.Annotations,
            Title = display.Title,
            ShowLegend = false,    // web AreaChart renders no <Legend>
            IncludeZero = true,    // the area fills from the zero baseline
            MinHeight = ChartMinHeight,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };
        AutomationProperties.SetName(chart, display.ChartSummary);
        return chart;
    }

    // The web ChartContainer's accessible fallback table (dataColumns Month / Cost ($)), under a native Expander
    // so the precise per-month figures stay one toggle away from the visual chart.
    private static Expander BuildTable(MonthlyCostChartDisplay display)
    {
        var columns = new List<TsDataColumn>(display.Columns.Count);
        for (int i = 0; i < display.Columns.Count; i++)
        {
            MonthlyCostChartColumn column = display.Columns[i];
            columns.Add(new TsDataColumn
            {
                Key = column.Key,
                Header = column.Header,

                // The cost column right-aligns and sorts numerically; the month column reads as text.
                IsNumeric = column.Key == MonthlyCostChartProjection.CostKey,
            });
        }

        var rows = new List<TsDataRow>(display.Rows.Count);
        foreach (MonthlyCostChartRow row in display.Rows)
        {
            rows.Add(new TsDataRow(row.RowKey, ToValues(row.Cells)));
        }

        var table = new TsDataTable
        {
            Columns = columns,
            Rows = rows,
            PageSize = RowsPerPage,
            Selectable = false,
            EmptyMessage = display.EmptyMessage,
        };

        var expander = new Expander
        {
            Header = display.TableLabel,
            Content = table,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
        };
        AutomationProperties.SetName(expander, display.TableLabel);
        return expander;
    }

    private static TsGlassPanel Box(UIElement content, string automationName)
    {
        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = content };
        AutomationProperties.SetName(panel, automationName);
        AutomationProperties.SetAccessibilityView(panel, AccessibilityView.Content);
        return panel;
    }

    private static Dictionary<string, object?> ToValues(IReadOnlyDictionary<string, string> cells)
    {
        var values = new Dictionary<string, object?>(cells.Count, StringComparer.Ordinal);
        foreach (KeyValuePair<string, string> cell in cells)
        {
            values[cell.Key] = cell.Value;
        }

        return values;
    }
}
