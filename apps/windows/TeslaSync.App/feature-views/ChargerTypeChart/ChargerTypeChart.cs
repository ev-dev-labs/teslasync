using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Shapes;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>ChargerTypeChart</c> feature surface — a parity port of
/// web/src/features/charging/components/charging-curve/ChargerTypeChart.tsx. It is a pure presentational
/// control: assign a <see cref="Model"/> (the web <c>sessions</c> prop) and it renders exactly one of three
/// web-derived branches — <see cref="ChargerTypeChartState.Loading"/> (title + skeleton chrome while the parent
/// resolves the sessions), <see cref="ChargerTypeChartState.Empty"/> (title + a friendly empty surface, the web
/// <c>chart.noData</c> message), or <see cref="ChargerTypeChartState.Ready"/> (the grouped average-power /
/// average-energy bars — the native analogue of the recharts <c>ComposedChart</c> via <see cref="TsBarChart"/> —
/// alongside the colour-keyed legend list the web lays out beneath the chart, where each charger category shows
/// its dot, name, and the "<c>{count} sessions · {avgDuration} min avg</c>" caption, plus the accessible Charger
/// Type / Sessions / Avg kW / Avg kWh / Avg minutes data table the web <c>ChartContainer</c> exposes as its
/// tabular fallback). The two bars carry the web <c>&lt;Bar&gt;</c> series names verbatim ("Avg Power",
/// "Avg Energy"); the web per-category <c>&lt;Cell&gt;</c> colour is reproduced on the legend dots through the
/// shared brand palette (the native cartesian surface tints bars per series, so the charger-category colour
/// identity lives on the legend the same way <c>ChargerTypeBreakdown</c> resolved it). The view never performs
/// HTTP; all branch selection, grouping, label resolution and formatting happen in the WinUI-free
/// <see cref="ChargerTypeChartProjection"/>. Every string resolves through the i18n facade and every region,
/// chart, legend row and table row carries a Narrator name.
/// </summary>
public sealed partial class ChargerTypeChart : ContentControl
{
    private const double ChartMinHeight = 280;   // web ResponsiveContainer height={280}
    private const double PanelPadding = 16;        // web ChartContainer padding
    private const double LegendDotSize = 8;        // web h-2 w-2
    private const double LegendFontSize = 12;      // web text-xs
    private const int RowsPerPage = 25;

    private readonly ILocalizer _localizer;
    private readonly ChargerTypeChartDiagnostics _diagnostics;
    private readonly int _decimalPrecision;

    private ChargerTypeChartModel _model;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, and (optional) diagnostics/precision.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="ChargerTypeChartModel.Pending"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    /// <param name="decimalPrecision">The user's display decimal precision (web <c>useSettings</c> global precision).</param>
    public ChargerTypeChart(
        ILocalizer localizer,
        ChargerTypeChartModel? model = null,
        ChargerTypeChartDiagnostics? diagnostics = null,
        int decimalPrecision = ChargerTypeChartRegistration.DefaultDecimalPrecision)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? ChargerTypeChartModel.Pending;
        _diagnostics = diagnostics ?? new ChargerTypeChartDiagnostics();
        _decimalPrecision = decimalPrecision;

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>ChargerTypeChart</c>).</summary>
    public static string Slug => ChargerTypeChartRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public ChargerTypeChartModel Model
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
        var display = ChargerTypeChartProjection.Project(_model, _localizer, _decimalPrecision);

        UIElement surface = display.State switch
        {
            ChargerTypeChartState.Loading => BuildLoading(display),
            ChargerTypeChartState.Empty => BuildEmpty(display),
            _ => BuildReady(display),
        };

        AutomationProperties.SetName(this, display.AutomationName);
        Content = surface;
    }

    // ── Loading (parent still resolving the sessions) ─────────────────────────────────────────────────
    private static TsGlassPanel BuildLoading(ChargerTypeChartDisplay display)
    {
        var stack = new StackPanel { Spacing = 12 };
        stack.Children.Add(BuildHeader(display));
        stack.Children.Add(new TsSkeleton
        {
            BlockHeight = ChartMinHeight,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        });

        var rows = new StackPanel { Spacing = 8 };
        for (int i = 0; i < 3; i++)
        {
            rows.Children.Add(new TsSkeleton { BlockHeight = LegendFontSize });
        }

        stack.Children.Add(rows);

        var box = Box(stack, display.AutomationName);
        LiveRegion.Configure(box);
        LiveRegion.Announce(box);
        return box;
    }

    // ── Empty (web `sessions.length === 0` → ChartContainer "No data available") ───────────────────────
    private static TsGlassPanel BuildEmpty(ChargerTypeChartDisplay display)
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

    // ── Ready (web fall-through: composed bars + per-type legend list + accessible table) ──────────────
    private static TsGlassPanel BuildReady(ChargerTypeChartDisplay display)
    {
        var stack = new StackPanel { Spacing = 12 };
        stack.Children.Add(BuildHeader(display));
        stack.Children.Add(BuildChart(display));
        stack.Children.Add(BuildLegend(display));
        stack.Children.Add(BuildTable(display));

        return Box(stack, display.AutomationName);
    }

    private static StackPanel BuildHeader(ChargerTypeChartDisplay display)
    {
        var header = new StackPanel { Spacing = 2 };
        header.Children.Add(new PanelTitle { Value = display.Title });
        header.Children.Add(new Caption { Value = display.Subtitle });
        AutomationProperties.SetName(header, display.Title);
        return header;
    }

    /// <summary>
    /// The grouped average-power / average-energy bars — the native analogue of the web recharts
    /// <c>&lt;ComposedChart&gt;</c> with its two <c>&lt;Bar&gt;</c> series (<c>dataKey="avgKw"</c> /
    /// <c>dataKey="avgKwh"</c>). The web renders the two values on independent left / right Y axes; the native
    /// cartesian surface shares one Y scale, so the precise per-category figures stay one toggle away in the
    /// accessible table and on each bar's tooltip. No series legend is drawn — the web <c>ComposedChart</c> has
    /// no <c>&lt;Legend&gt;</c>; the charger-category legend list renders beneath instead. The chart's Narrator
    /// name carries the aria label plus the per-type spoken summary.
    /// </summary>
    private static TsBarChart BuildChart(ChargerTypeChartDisplay display)
    {
        var chart = new TsBarChart
        {
            Series = display.Series,
            Title = display.Title,
            ShowLegend = false,    // web ComposedChart renders no <Legend>
            IncludeZero = true,    // bars rise from the zero baseline
            MinHeight = ChartMinHeight,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };
        AutomationProperties.SetName(chart, display.ChartSummary);
        return chart;
    }

    /// <summary>
    /// The per-charger-type legend list beneath the chart — the native analogue of the web
    /// <c>chargerTypeStats.map(...)</c> rows: a palette-tinted dot, the charger category name, and the
    /// right-aligned "<c>{count} sessions · {avgDuration} min avg</c>" caption. Each row carries the spoken
    /// summary as its Narrator name; the dot is decorative.
    /// </summary>
    private static StackPanel BuildLegend(ChargerTypeChartDisplay display)
    {
        var list = new StackPanel { Spacing = 4 };
        foreach (ChargerTypeChartSlice slice in display.Slices)
        {
            var row = new Grid();
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Auto) });

            var left = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Spacing = 6,
                VerticalAlignment = VerticalAlignment.Center,
            };

            var dot = new Ellipse
            {
                Width = LegendDotSize,
                Height = LegendDotSize,
                Fill = ChartBrushes.ForIndex(slice.ColorIndex),
                VerticalAlignment = VerticalAlignment.Center,
            };
            AutomationProperties.SetAccessibilityView(dot, AccessibilityView.Raw);

            left.Children.Add(dot);
            left.Children.Add(new TextBlock
            {
                Text = slice.Label,
                FontSize = LegendFontSize,
                Foreground = DisplayTokens.TextSecondary,
                VerticalAlignment = VerticalAlignment.Center,
                TextTrimming = TextTrimming.CharacterEllipsis,
            });
            Grid.SetColumn(left, 0);
            row.Children.Add(left);

            var caption = new TextBlock
            {
                Text = slice.LegendCaption,
                FontSize = LegendFontSize,
                Foreground = DisplayTokens.TextMuted,
                VerticalAlignment = VerticalAlignment.Center,
                TextAlignment = TextAlignment.Right,
            };
            Grid.SetColumn(caption, 1);
            row.Children.Add(caption);

            AutomationProperties.SetName(row, slice.AutomationName);
            list.Children.Add(row);
        }

        return list;
    }

    // The web ChartContainer's accessible fallback table (dataColumns Charger Type / Sessions / Avg kW / Avg kWh
    // / Avg minutes), under a native Expander so the precise per-type figures stay one toggle away from the bars.
    private static Expander BuildTable(ChargerTypeChartDisplay display)
    {
        var columns = new List<TsDataColumn>(display.Columns.Count);
        foreach (ChargerTypeChartColumn column in display.Columns)
        {
            columns.Add(new TsDataColumn
            {
                Key = column.Key,
                Header = column.Header,

                // The category column reads as text; every aggregate column right-aligns and sorts numerically.
                IsNumeric = !string.Equals(column.Key, ChargerTypeChartProjection.LabelKey, StringComparison.Ordinal),
            });
        }

        var rows = new List<TsDataRow>(display.Rows.Count);
        foreach (ChargerTypeChartRow row in display.Rows)
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
