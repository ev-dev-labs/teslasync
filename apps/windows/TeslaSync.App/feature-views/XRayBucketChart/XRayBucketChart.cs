using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.IngestXRay;

/// <summary>
/// The native WinUI 3 <c>XRayBucketChart</c> feature surface — a parity port of
/// web/src/features/admin/components/ingest-xray/XRayBucketChart.tsx. It is a pure presentational control:
/// assign a <see cref="Model"/> (the web <c>buckets</c> + <c>loading</c> props) and it renders exactly one
/// of the three web branches — <see cref="XRayBucketChartState.Loading"/> (title + skeleton chrome, the web
/// <c>ChartContainer</c> spinner), <see cref="XRayBucketChartState.Empty"/> (title + a friendly empty
/// state, the web <c>chart.noData</c> message), or <see cref="XRayBucketChartState.Ready"/> (the
/// time-labeled sample-count bar strip — the native analogue of the recharts <c>BarChart</c> whose bars
/// are tinted accent — plus the accessible Bucket/Samples data table the web <c>ChartContainer</c> exposes
/// as its tabular fallback). The view never performs HTTP; all branch selection, label resolution and
/// formatting happen in the WinUI-free <see cref="XRayBucketChartProjection"/>. Every string resolves
/// through the i18n facade and every region/bar carries a Narrator name.
/// </summary>
public sealed partial class XRayBucketChart : ContentControl
{
    private const double BarsAreaHeight = 200;
    private const int RowsPerPage = 12;

    private readonly ILocalizer _localizer;
    private readonly XRayBucketChartDiagnostics _diagnostics;
    private readonly Func<DateTimeOffset> _clock;

    private XRayBucketChartModel _model;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, and (optional) diagnostics/clock.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="XRayBucketChartModel.Pending"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    /// <param name="clock">Injectable clock for deterministic timestamp formatting in tests.</param>
    public XRayBucketChart(
        ILocalizer localizer,
        XRayBucketChartModel? model = null,
        XRayBucketChartDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? XRayBucketChartModel.Pending;
        _diagnostics = diagnostics ?? new XRayBucketChartDiagnostics();
        _clock = clock ?? (() => DateTimeOffset.Now);

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>XRayBucketChart</c>).</summary>
    public static string Slug => XRayBucketChartRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public XRayBucketChartModel Model
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
        var display = XRayBucketChartProjection.Project(_model, _localizer, _clock());

        UIElement surface = display.State switch
        {
            XRayBucketChartState.Loading => BuildLoading(display),
            XRayBucketChartState.Empty => BuildEmpty(display),
            _ => BuildReady(display),
        };

        AutomationProperties.SetName(this, display.AutomationName);
        Content = surface;
    }

    // ── Loading (web ChartContainer spinner) ────────────────────────────────────────────────────────
    private static TsGlassPanel BuildLoading(XRayBucketChartDisplay display)
    {
        var stack = new StackPanel { Spacing = 12 };
        stack.Children.Add(BuildHeader(display));
        stack.Children.Add(new TsSkeleton { BlockHeight = 180 });
        stack.Children.Add(new TsSkeleton { BlockHeight = 16 });

        var box = Box(stack, display.AutomationName);
        LiveRegion.Configure(box);
        LiveRegion.Announce(box);
        return box;
    }

    // ── Empty (web `empty` → EmptyState message={t('chart.noData')}) ─────────────────────────────────
    private static TsGlassPanel BuildEmpty(XRayBucketChartDisplay display)
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

    // ── Ready (web fall-through: the BarChart + accessible data table) ───────────────────────────────
    private static TsGlassPanel BuildReady(XRayBucketChartDisplay display)
    {
        var stack = new StackPanel { Spacing = 12 };
        stack.Children.Add(BuildHeader(display));
        stack.Children.Add(BuildBars(display));
        stack.Children.Add(BuildTable(display));

        return Box(stack, display.AutomationName);
    }

    private static StackPanel BuildHeader(XRayBucketChartDisplay display)
    {
        var header = new StackPanel { Spacing = 2 };
        header.Children.Add(new PanelTitle { Value = display.Title });
        header.Children.Add(new Caption { Value = display.Subtitle });
        return header;
    }

    /// <summary>
    /// The accent sample-count bar strip — the native analogue of the web recharts <c>BarChart</c>. Each
    /// bar's height is scaled to the projected <see cref="XRayBucketChartBar.HeightRatio"/> (0..1 of the
    /// tallest bucket) and filled with the accent design token; a thinned subset of bars shows its
    /// <c>formatTime</c> label beneath. Every bar carries a Narrator name with its full time + count.
    /// </summary>
    private static StackPanel BuildBars(XRayBucketChartDisplay display)
    {
        var bars = display.Bars;
        var chart = new StackPanel { Spacing = 4 };
        AutomationProperties.SetName(chart, display.AriaLabel);

        var barsArea = new Grid { Height = BarsAreaHeight, VerticalAlignment = VerticalAlignment.Bottom };
        var labelsRow = new Grid();
        for (int i = 0; i < bars.Count; i++)
        {
            barsArea.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            labelsRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        for (int i = 0; i < bars.Count; i++)
        {
            var bar = bars[i];

            var inner = new Grid();
            inner.RowDefinitions.Add(new RowDefinition { Height = new GridLength(Math.Max(0.0, 1 - bar.HeightRatio), GridUnitType.Star) });
            inner.RowDefinitions.Add(new RowDefinition { Height = new GridLength(Math.Max(0.0, bar.HeightRatio), GridUnitType.Star) });

            var fill = new Border
            {
                Background = DisplayTokens.Accent,
                CornerRadius = new CornerRadius(2, 2, 0, 0),
                Margin = new Thickness(2, 0, 2, 0),
                VerticalAlignment = VerticalAlignment.Stretch,
                MinHeight = bar.HeightRatio > 0 ? 2 : 0,
            };
            Grid.SetRow(fill, 1);
            inner.Children.Add(fill);

            Grid.SetColumn(inner, i);
            barsArea.Children.Add(inner);
            AutomationProperties.SetName(inner, bar.AutomationName);

            var lbl = new TextBlock
            {
                Text = bar.ShowLabel ? bar.TimeLabel : string.Empty,
                FontSize = 9,
                Foreground = DisplayTokens.TextMuted,
                HorizontalAlignment = HorizontalAlignment.Center,
                TextTrimming = TextTrimming.CharacterEllipsis,
                TextWrapping = TextWrapping.NoWrap,
            };
            AutomationProperties.SetAccessibilityView(lbl, AccessibilityView.Raw);
            Grid.SetColumn(lbl, i);
            labelsRow.Children.Add(lbl);
        }

        chart.Children.Add(barsArea);
        chart.Children.Add(labelsRow);
        return chart;
    }

    // The web ChartContainer's accessible fallback table (dataColumns Bucket/Samples), under a native
    // Expander so the precise per-bucket figures stay one toggle away from the visual bars.
    private static Expander BuildTable(XRayBucketChartDisplay display)
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
        var panel = new TsGlassPanel { Padding = new Thickness(16), Content = content };
        AutomationProperties.SetName(panel, automationName);
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
