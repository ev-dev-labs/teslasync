using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.ChargingCurve;

/// <summary>
/// The native WinUI 3 <c>YearlyTrendChart</c> feature surface — a parity port of
/// web/src/features/charging/components/charging-curve/YearlyTrendChart.tsx. It is a pure presentational
/// control: assign a <see cref="Model"/> (the web <c>yearlyTrend</c> prop) and it renders exactly one of the
/// two web branches — <see cref="YearlyTrendChartState.Ready"/> (the web <c>ComposedChart</c>: a DC-session
/// <see cref="Microsoft.UI.Xaml.Controls.Control"/> bar drawn behind the two charge-time lines via
/// <see cref="TsComposedChart"/>, the dual Minutes / Sessions axis captions, the interactive legend, and the
/// accessible Year / 10→80% / 20→80% / DC-Sessions data table the web <c>ChartContainer</c> exposes as its
/// tabular fallback) or <see cref="YearlyTrendChartState.Empty"/> (the web <c>EmptyState</c> with the activity
/// glyph and the <c>common.noData</c> message). The title + subtitle render in BOTH branches so the panel is
/// never a blank box. The view never performs HTTP; all branch selection, label resolution and number
/// formatting happen in the WinUI-free <see cref="YearlyTrendChartProjection"/>. Every string resolves through
/// the i18n facade and the surface, chart, each axis caption and each table row carry a Narrator name.
/// </summary>
public sealed partial class YearlyTrendChart : ContentControl
{
    private const double ChartMinHeight = 280;   // web ResponsiveContainer height={280}
    private const double PanelPadding = 16;       // web ChartContainer padding
    private const int RowsPerPage = 20;
    private const string ActivityGlyph = "\uE9D2"; // Segoe Fluent — activity / pulse (web lucide Activity)

    private readonly ILocalizer _localizer;
    private readonly YearlyTrendChartDiagnostics _diagnostics;

    private YearlyTrendChartModel _model;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="YearlyTrendChartModel.Empty"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public YearlyTrendChart(
        ILocalizer localizer,
        YearlyTrendChartModel? model = null,
        YearlyTrendChartDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? YearlyTrendChartModel.Empty;
        _diagnostics = diagnostics ?? new YearlyTrendChartDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>YearlyTrendChart</c>).</summary>
    public static string Slug => YearlyTrendChartRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public YearlyTrendChartModel Model
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
        var display = YearlyTrendChartProjection.Project(_model, _localizer);

        UIElement surface = display.State switch
        {
            YearlyTrendChartState.Ready => BuildReady(display),
            _ => BuildEmpty(display),
        };

        AutomationProperties.SetName(this, display.AutomationName);
        Content = surface;
    }

    // ── Ready (web fall-through: composed chart + dual-axis captions + legend + accessible table) ─────────
    private static TsGlassPanel BuildReady(YearlyTrendChartDisplay display)
    {
        var stack = new StackPanel { Spacing = 12 };
        stack.Children.Add(BuildHeader(display));
        stack.Children.Add(BuildChart(display));
        stack.Children.Add(BuildAxisCaptions(display));
        stack.Children.Add(BuildTable(display));

        return Box(stack, display.AutomationName);
    }

    // ── Empty (web `EmptyState` icon={Activity} message={t('common.noData')}) ─────────────────────────────
    private static TsGlassPanel BuildEmpty(YearlyTrendChartDisplay display)
    {
        var stack = new StackPanel { Spacing = 12 };
        stack.Children.Add(BuildHeader(display));
        stack.Children.Add(new TsEmptyState
        {
            IconGlyph = ActivityGlyph,
            Message = display.EmptyMessage,
            VerticalAlignment = VerticalAlignment.Center,
        });

        return Box(stack, display.AutomationName);
    }

    private static StackPanel BuildHeader(YearlyTrendChartDisplay display)
    {
        var header = new StackPanel { Spacing = 2 };
        header.Children.Add(new PanelTitle { Value = display.Title });
        header.Children.Add(new Caption { Value = display.Subtitle });
        return header;
    }

    /// <summary>
    /// The composed DC-session bar + charge-time lines — the native analogue of the web recharts
    /// <c>ComposedChart</c>. Each series keeps its own kind/colour/unit (set by the projection), so the bar
    /// draws behind the two lines exactly as the web renders them. The web's two separate Y axes collapse onto
    /// one shared scale (the native composed surface is single-axis); the per-axis meaning is preserved by the
    /// Minutes / Sessions captions beneath and by each series' unit in the tooltip + accessible summary.
    /// </summary>
    private static TsComposedChart BuildChart(YearlyTrendChartDisplay display)
    {
        var chart = new TsComposedChart
        {
            Series = display.Series,
            Title = display.Title,
            ShowLegend = true,       // web renders a legend below the ComposedChart
            IncludeZero = true,
            MinHeight = ChartMinHeight,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };
        AutomationProperties.SetName(chart, display.AriaLabel);
        return chart;
    }

    // The web's left ("Minutes", for the lines) and right ("Sessions", for the bar) Y-axis titles, surfaced as
    // a left/right caption row so the single-axis native chart still communicates what each series measures.
    private static Grid BuildAxisCaptions(YearlyTrendChartDisplay display)
    {
        var row = new Grid();
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var minutes = new Caption
        {
            Value = display.MinutesAxisLabel,
            HorizontalAlignment = HorizontalAlignment.Left,
        };
        AutomationProperties.SetName(minutes, display.MinutesAxisLabel);
        Grid.SetColumn(minutes, 0);

        var sessions = new Caption
        {
            Value = display.SessionsAxisLabel,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        AutomationProperties.SetName(sessions, display.SessionsAxisLabel);
        Grid.SetColumn(sessions, 1);

        row.Children.Add(minutes);
        row.Children.Add(sessions);
        return row;
    }

    // The web ChartContainer's accessible fallback table (dataColumns Year / 10→80% / 20→80% / DC Sessions),
    // under a native Expander so the precise per-year figures stay one toggle away from the visual chart.
    private static Expander BuildTable(YearlyTrendChartDisplay display)
    {
        var columns = new List<TsDataColumn>(display.Columns.Count);
        foreach (var column in display.Columns)
        {
            columns.Add(new TsDataColumn { Key = column.Key, Header = column.Header });
        }

        var rows = new List<TsDataRow>(display.Rows.Count);
        foreach (var row in display.Rows)
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
        foreach (var cell in cells)
        {
            values[cell.Key] = cell.Value;
        }

        return values;
    }
}
