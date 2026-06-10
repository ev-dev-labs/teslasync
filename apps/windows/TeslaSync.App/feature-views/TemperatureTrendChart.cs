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
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>TemperatureTrendChart</c> feature surface — a parity port of
/// web/src/features/driving/components/drivetrain-health/TemperatureTrendChart.tsx. It is a pure presentational
/// control: assign a <see cref="Model"/> (the web <c>data: ChartDataPoint[]</c> prop plus the parent's fetch
/// flag) and a <see cref="Units"/> preference (the web <c>useUnits</c> result) and it renders exactly one of
/// three web-derived branches inside a translucent <see cref="TsGlassPanel"/> faded in with the web's 0.25s
/// delay — <see cref="TemperatureTrendChartState.Loading"/> (the title/subtitle header + skeleton chrome while
/// the parent fetches the recent-drive history), <see cref="TemperatureTrendChartState.Empty"/> (the header + a
/// friendly <c>chart.noData</c> empty state, the native stand-in for the web's pre-filtered
/// <c>data.length &lt;= 1 → return null</c> gate), or <see cref="TemperatureTrendChartState.Ready"/> (the
/// single-line outside-temperature trend chart — the native analogue of the recharts <c>LineChart</c> with its
/// dashed "Warm Zone" / "Freezing" threshold markers and built-in legend — plus an accessible data table
/// mirroring the web <c>ChartContainer</c> columns). The view never performs HTTP; all branch selection, unit
/// conversion, label resolution and formatting happen in the WinUI-free <see cref="TemperatureTrendChartProjection"/>.
/// Every string resolves through the i18n facade and every region carries a Narrator name.
/// </summary>
public sealed partial class TemperatureTrendChart : ContentControl
{
    // web ChartContainer height={300} / ResponsiveContainer height={300}.
    private const double ChartHeight = 300;

    // web <FadeIn delay={0.25}> — 0.25s expressed in milliseconds.
    private const int FadeInDelayMs = 250;

    // web ChartContainer padding (the shared glass panel renders at the p-6 / 24px inset).
    private const double PanelPadding = 24;

    private const double DataFontSize = 13;

    private readonly ILocalizer _localizer;
    private readonly TemperatureTrendChartDiagnostics _diagnostics;
    private readonly TsFadeIn _fade = new() { DelayMs = FadeInDelayMs };

    private UnitPref _units;
    private TemperatureTrendChartModel _model;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model + unit preference, and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="units">The user's display unit preference (web <c>useUnits</c>); defaults to metric when null.</param>
    /// <param name="model">The initial render model; defaults to <see cref="TemperatureTrendChartModel.Pending"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public TemperatureTrendChart(
        ILocalizer localizer,
        UnitPref? units = null,
        TemperatureTrendChartModel? model = null,
        TemperatureTrendChartDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _units = units ?? UnitPref.Metric;
        _model = model ?? TemperatureTrendChartModel.Pending;
        _diagnostics = diagnostics ?? new TemperatureTrendChartDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Content = _fade;
        Loaded += OnLoaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>TemperatureTrendChart</c>).</summary>
    public static string Slug => TemperatureTrendChartRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public TemperatureTrendChartModel Model
    {
        get => _model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _model = value;
            Render();
        }
    }

    /// <summary>The display unit preference (web <c>useUnits</c>); reassigning re-converts and re-renders the surface.</summary>
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
        TemperatureTrendChartDisplay display = TemperatureTrendChartProjection.Project(_model, _localizer, _units);

        UIElement surface = display.State switch
        {
            TemperatureTrendChartState.Loading => BuildLoading(display),
            TemperatureTrendChartState.Empty => BuildEmpty(display),
            _ => BuildReady(display),
        };

        AutomationProperties.SetName(this, display.AutomationName);
        _fade.Content = surface;
    }

    // ── Loading (parent still fetching the recent-drive history) ──────────────────────────────────────
    private static TsGlassPanel BuildLoading(TemperatureTrendChartDisplay display)
    {
        var stack = new StackPanel { Spacing = 16 };
        stack.Children.Add(BuildHeader(display));
        stack.Children.Add(new TsSkeleton { BlockHeight = ChartHeight, Radius = 10 });

        TsGlassPanel box = Box(stack, display.AutomationName);
        LiveRegion.Configure(box);
        LiveRegion.Announce(box);
        return box;
    }

    // ── Empty (web: parent filters nulls, then data.length <= 1 → return null) ────────────────────────
    private static TsGlassPanel BuildEmpty(TemperatureTrendChartDisplay display)
    {
        var stack = new StackPanel { Spacing = 16 };
        stack.Children.Add(BuildHeader(display));
        stack.Children.Add(new TsEmptyState
        {
            Message = display.EmptyMessage,
            VerticalAlignment = VerticalAlignment.Center,
        });

        return Box(stack, display.AutomationName);
    }

    // ── Ready (web fall-through: the ChartContainer header + the LineChart + the data table) ──────────
    private static TsGlassPanel BuildReady(TemperatureTrendChartDisplay display)
    {
        var stack = new StackPanel { Spacing = 16 };
        stack.Children.Add(BuildHeader(display));
        stack.Children.Add(BuildChart(display));
        stack.Children.Add(BuildDataTable(display));

        return Box(stack, display.AutomationName);
    }

    // web ChartContainer header: the section title with the muted subtitle beneath it.
    private static StackPanel BuildHeader(TemperatureTrendChartDisplay display)
    {
        var header = new StackPanel { Spacing = 2 };
        header.Children.Add(new PanelTitle { Value = display.Title });
        header.Children.Add(new Caption { Value = display.Subtitle });
        return header;
    }

    /// <summary>
    /// The single-line outside-temperature chart — the native analogue of the web recharts <c>LineChart</c>. The
    /// projection already converted every reading to the display unit, dropped the drives that did not record an
    /// outside temperature and coloured the line by semantic role; the two dashed threshold markers ride along
    /// as annotations and the shared legend names the line (the web <c>&lt;Legend /&gt;</c>).
    /// </summary>
    private static TsLineChart BuildChart(TemperatureTrendChartDisplay display)
    {
        var chart = new TsLineChart
        {
            Series = new[] { display.Series },
            Annotations = display.ReferenceLines,
            Title = display.Title,
            Height = ChartHeight,
            ShowLegend = true,
            IncludeZero = false,
        };
        AutomationProperties.SetName(chart, display.AriaLabel);
        return chart;
    }

    /// <summary>
    /// The accessible data table behind an expander — the native analogue of the web <c>ChartContainer</c>
    /// <c>dataColumns</c> / <c>data</c> tabular alternative for non-visual users. One header row of the
    /// (unit-suffixed) column labels plus one labelled row per drive, each carrying a spoken Narrator summary.
    /// </summary>
    private static Expander BuildDataTable(TemperatureTrendChartDisplay display)
    {
        var table = new StackPanel { Spacing = 4 };
        table.Children.Add(BuildRow(display.Columns.Date, display.Columns.Outside, header: true));

        foreach (TemperatureTrendTableRow row in display.Rows)
        {
            Grid line = BuildRow(row.Date, row.Outside, header: false);
            AutomationProperties.SetName(line, row.AutomationName);
            table.Children.Add(line);
        }

        var expander = new Expander
        {
            Header = display.AriaLabel,
            Content = table,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
        };
        AutomationProperties.SetName(expander, display.AriaLabel);
        return expander;
    }

    private static Grid BuildRow(string date, string outside, bool header)
    {
        var grid = new Grid { ColumnSpacing = 16 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1.6, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        Brush labelBrush = header ? DisplayTokens.TextMuted : DisplayTokens.TextSecondary;
        Brush valueBrush = header ? DisplayTokens.TextMuted : DisplayTokens.TextPrimary;
        AddCell(grid, date, 0, labelBrush);
        AddCell(grid, outside, 1, valueBrush);
        return grid;
    }

    private static void AddCell(Grid grid, string text, int column, Brush foreground)
    {
        var cell = new TextBlock
        {
            Text = text,
            FontSize = DataFontSize,
            Foreground = foreground,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        };
        AutomationProperties.SetAccessibilityView(cell, AccessibilityView.Raw);
        Grid.SetColumn(cell, column);
        grid.Children.Add(cell);
    }

    private static TsGlassPanel Box(UIElement content, string automationName)
    {
        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = content };
        AutomationProperties.SetName(panel, automationName);
        return panel;
    }
}
