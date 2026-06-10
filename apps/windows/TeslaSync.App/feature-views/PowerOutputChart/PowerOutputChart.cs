using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Driving;

/// <summary>
/// The native WinUI 3 <c>PowerOutputChart</c> feature surface — a parity port of
/// <c>web/src/features/driving/components/drivetrain-health/PowerOutputChart.tsx</c>. The web component is a
/// pure presentational child of the drivetrain-health page: given the per-drive <c>data</c> (each carrying a
/// date plus peak / regen power) it renders a <c>ChartContainer</c> wrapping a dual <c>AreaChart</c> — a violet
/// peak-power area and a red regen-power area over time, a zero reference line, and an interactive
/// hidden-series legend wired to <c>useHiddenSeries</c> so a user can declutter to one trace — and exposes the
/// same series as an accessible data table (Date / Peak (kW) / Regen (kW)). This surface reproduces that with
/// the native <see cref="TsAreaChart"/> (the two areas drawn with the platform Power / Regen accents, the
/// chart's own legend carrying the hidden-series toggles), the zero reference line, and a tabular data view.
/// Assign a <see cref="Model"/> and the surface renders exactly one of the projected states —
/// <see cref="PowerOutputChartState.Loading"/> (chart skeleton), <see cref="PowerOutputChartState.Error"/> (a
/// <c>QueryError</c> with a retry affordance), <see cref="PowerOutputChartState.Empty"/> (the native stand-in
/// for the web <c>data.length &lt;= 1 → return null</c>), or the chart itself for
/// <see cref="PowerOutputChartState.Ready"/> / <see cref="PowerOutputChartState.Stale"/> /
/// <see cref="PowerOutputChartState.Offline"/> (the stale and offline snapshots adding a freshness chip). The
/// view never performs HTTP; all branch selection, rounding and label resolution happen in the WinUI-free
/// <see cref="PowerOutputChartProjection"/>. Every string resolves through the i18n facade.
/// </summary>
public sealed partial class PowerOutputChart : ContentControl
{
    private const double ChartHeight = 300; // web ChartContainer height={300}
    private const int FadeInDelayMs = 300;  // web wraps the surface in <FadeIn delay={0.3}>
    private const double TableMaxHeight = 240;
    private const double TableColumnSpacing = 16;
    private const double TableRowSpacing = 2;

    private readonly ILocalizer _localizer;
    private readonly PowerOutputChartDiagnostics _diagnostics;
    private readonly TsFadeIn _fade = new() { DelayMs = FadeInDelayMs };

    // The hidden-series state is the native analogue of the web useHiddenSeries('drivetrain-power-output')
    // hook. It is held on the surface (not rebuilt per render) so a user's legend toggles survive a model
    // update exactly as the web URL-persisted hidden set survives a data refresh.
    private readonly ChartLegendState _legendState = new();

    private PowerOutputChartModel _model;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="PowerOutputChartModel.Pending"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public PowerOutputChart(
        ILocalizer localizer,
        PowerOutputChartModel? model = null,
        PowerOutputChartDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? PowerOutputChartModel.Pending;
        _diagnostics = diagnostics ?? new PowerOutputChartDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        Content = _fade;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>Raised when the user invokes retry from the error surface; the host re-runs the load.</summary>
    public event EventHandler? RetryRequested;

    /// <summary>The canonical diagnostics slug this surface registers under (<c>PowerOutputChart</c>).</summary>
    public static string Slug => PowerOutputChartRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public PowerOutputChartModel Model
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
        PowerOutputChartDisplay display = PowerOutputChartProjection.Project(_model, _localizer);

        UIElement surface = display.State switch
        {
            PowerOutputChartState.Loading => BuildLoading(display),
            PowerOutputChartState.Error => BuildError(display),
            PowerOutputChartState.Empty => BuildEmpty(display),
            _ => BuildChart(display),
        };

        AutomationProperties.SetName(this, display.AutomationName);
        _fade.Content = surface;
    }

    // ── Loading (web ChartContainer spinner) ────────────────────────────────────────────────────────
    private static TsGlassPanel BuildLoading(PowerOutputChartDisplay display)
    {
        var stack = new StackPanel { Spacing = 12 };
        stack.Children.Add(BuildHeader(display));
        stack.Children.Add(new TsChartSkeleton());

        TsGlassPanel box = Box(stack, display.AutomationName);
        LiveRegion.Configure(box);
        LiveRegion.Announce(box);
        return box;
    }

    // ── Error (web QueryError equivalent with a retry affordance) ────────────────────────────────────
    private TsGlassPanel BuildError(PowerOutputChartDisplay display)
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

    // ── Empty (web `data.length > 1` fails → the web returns null; native shows a friendly empty state) ──
    private static TsGlassPanel BuildEmpty(PowerOutputChartDisplay display)
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

    // ── Ready / Stale / Offline (web fall-through: the dual AreaChart + the accessible data table) ────
    private TsGlassPanel BuildChart(PowerOutputChartDisplay display)
    {
        var stack = new StackPanel { Spacing = 12 };
        stack.Children.Add(BuildHeader(display));
        stack.Children.Add(BuildPlot(display));
        stack.Children.Add(BuildDataTableSection(display));

        return Box(stack, display.AutomationName);
    }

    private static Grid BuildHeader(PowerOutputChartDisplay display)
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

    // The stale / offline freshness chip (web stale/offline chip): a tokenized status badge whose tone tells a
    // freshness from an offline snapshot apart, with a leading status dot and a Narrator name.
    private static TsBadge BuildChip(PowerOutputChartState state, string text)
    {
        var badge = new TsBadge
        {
            Status = state == PowerOutputChartState.Offline ? StatusKind.Danger : StatusKind.Warning,
            Dot = true,
            Content = text,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(badge, text);
        return badge;
    }

    /// <summary>
    /// The dual peak / regen power plot — the native analogue of the web recharts <c>AreaChart</c>. The two
    /// area series are drawn with the platform Power / Regen accents, a zero reference line marks the
    /// draw/regen boundary (web <c>&lt;ReferenceLine y={0} /&gt;</c>), and the chart's own interactive legend
    /// carries the hidden-series toggles bound to the surface's persistent <see cref="ChartLegendState"/> — the
    /// native analogue of the web <c>useHiddenSeries</c> / <c>&lt;ChartLegend&gt;</c> pair. The chart carries
    /// the aria-label as its Narrator name.
    /// </summary>
    private TsAreaChart BuildPlot(PowerOutputChartDisplay display)
    {
        var chart = new TsAreaChart
        {
            Series = display.Series,
            Annotations = [new ChartAnnotation(PowerOutputChartProjection.ZeroReferenceId, ChartAnnotationKind.HorizontalLine, 0)],
            ShowLegend = true,
            IncludeZero = true,
            Title = display.AriaLabel,
            MinHeight = ChartHeight,
        };
        chart.LegendState = _legendState;
        AutomationProperties.SetName(chart, display.AriaLabel);
        return chart;
    }

    // Web parity: the ChartContainer's tabular accessible alternative (dataColumns + data). A keyboard-operable
    // toggle reveals the Date / Peak (kW) / Regen (kW) table; the table starts collapsed exactly as the web
    // data-view does.
    private static StackPanel BuildDataTableSection(PowerOutputChartDisplay display)
    {
        var section = new StackPanel { Spacing = 8 };

        Grid table = BuildTable(display);
        var scroller = new ScrollViewer
        {
            Content = table,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollMode = ScrollMode.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            MaxHeight = TableMaxHeight,
            Visibility = Visibility.Collapsed,
        };

        var toggle = new ToggleButton { Content = display.DataTableLabel };
        AutomationProperties.SetName(toggle, display.DataTableLabel);
        toggle.Checked += (_, _) => scroller.Visibility = Visibility.Visible;
        toggle.Unchecked += (_, _) => scroller.Visibility = Visibility.Collapsed;

        section.Children.Add(toggle);
        section.Children.Add(scroller);
        return section;
    }

    private static Grid BuildTable(PowerOutputChartDisplay display)
    {
        var grid = new Grid { ColumnSpacing = TableColumnSpacing, RowSpacing = TableRowSpacing };
        for (int c = 0; c < display.TableColumns.Count; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        }

        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        for (int c = 0; c < display.TableColumns.Count; c++)
        {
            var head = new Label { Value = display.TableColumns[c] };
            Grid.SetRow(head, 0);
            Grid.SetColumn(head, c);
            grid.Children.Add(head);
        }

        for (int r = 0; r < display.TableRows.Count; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            PowerOutputTableRow row = display.TableRows[r];

            // The date cell carries the whole row's spoken reading so Narrator announces each row as one
            // coherent "date, Peak: x, Regen: y" sentence; the numeric cells stay visible but are skipped in
            // item navigation to avoid a stuttered double reading.
            TextBlock dateCell = Cell(row.Date, DisplayTokens.TextMuted);
            AutomationProperties.SetName(dateCell, row.AutomationName);
            Grid.SetRow(dateCell, r + 1);
            Grid.SetColumn(dateCell, 0);
            grid.Children.Add(dateCell);

            TextBlock peakCell = Cell(row.Peak, DisplayTokens.TextPrimary);
            AutomationProperties.SetAccessibilityView(peakCell, AccessibilityView.Raw);
            Grid.SetRow(peakCell, r + 1);
            Grid.SetColumn(peakCell, 1);
            grid.Children.Add(peakCell);

            TextBlock regenCell = Cell(row.Regen, DisplayTokens.TextPrimary);
            AutomationProperties.SetAccessibilityView(regenCell, AccessibilityView.Raw);
            Grid.SetRow(regenCell, r + 1);
            Grid.SetColumn(regenCell, 2);
            grid.Children.Add(regenCell);
        }

        AutomationProperties.SetName(grid, display.AriaLabel);
        return grid;
    }

    private static TextBlock Cell(string text, Microsoft.UI.Xaml.Media.Brush foreground) => new()
    {
        Text = text,
        Foreground = foreground,
        FontSize = 12,
    };

    private static TsGlassPanel Box(UIElement content, string automationName)
    {
        var panel = new TsGlassPanel { Padding = new Thickness(16), Content = content };
        AutomationProperties.SetName(panel, automationName);
        return panel;
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new PowerOutputChartAutomationPeer(this);

    private sealed class PowerOutputChartAutomationPeer(PowerOutputChart owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? PowerOutputChartRegistration.Name(((PowerOutputChart)Owner)._localizer)
                : name;
        }
    }
}
