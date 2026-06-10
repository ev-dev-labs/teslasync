using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Driving;

/// <summary>
/// The native WinUI 3 <c>SocChart</c> feature surface — a parity port of
/// <c>web/src/features/driving/components/drive-detail/SocChart.tsx</c>. The web component is a pure
/// presentational child of the Drive-Detail page: given that page's <c>chartData</c> it wraps a recharts
/// <c>AreaChart</c> of battery state-of-charge over the drive's elapsed time in a <c>ChartContainer</c>
/// (a single emerald <c>#10b981</c> area with a 0–100 Y axis and the time on X), drawing a friendly
/// "No telemetry data available" empty surface when there are one or fewer samples. The chart also participates
/// in the page's cross-chart cursor synchronisation (the web <c>useSyncedCursor</c> /
/// <c>useSyncedReferenceLineX</c> hooks); the native surface binds that through the shared
/// <see cref="ChartCursorSyncGroup"/> state holder via <see cref="AttachCursorSync"/>. This surface reproduces
/// that area chart with the native <see cref="TsAreaChart"/> wrapped in a <see cref="TsFadeIn"/> +
/// <see cref="TsGlassPanel"/> (the web <c>FadeIn</c> + <c>ChartContainer</c> chrome) and, because the native
/// feature-view renders the full P2 state matrix the page drives, adds a loading skeleton, an explicit retry
/// surface on hard failure, plus stale and offline freshness chips. Per the web source's
/// <c>chart-a11y:no-table</c> directive (a dense per-sample trace whose start/end SOC is read from the drive
/// summary tiles) there is deliberately no accessible data table — the chart's aria-label carries the
/// accessible representation. Assign a <see cref="Model"/> and the surface renders exactly one of the projected
/// states. The view never performs HTTP; all branch selection and label resolution happen in the WinUI-free
/// <see cref="SocChartProjection"/>. Every string resolves through the i18n facade and every region carries a
/// Narrator name.
/// </summary>
public sealed partial class SocChart : ContentControl
{
    private const double ChartHeight = 220; // web ChartContainer height={220}
    private const double RootSpacing = 12;
    private const double PanelPadding = 16;

    private readonly ILocalizer _localizer;
    private readonly SocChartDiagnostics _diagnostics;
    private readonly TsFadeIn _fade = new();

    // Web parity: the SOC AreaChart is created once and reused across model pushes so the cross-chart
    // cursor-sync subscription (AttachCursorSync) is wired exactly once — re-creating the chart per render
    // would re-subscribe and leak the prior chart to the sync group. Only its Series are re-bound on render.
    private readonly TsAreaChart _chart = new()
    {
        ShowLegend = false, // web AreaChart renders no <Legend>; the single SOC series needs none
        IncludeZero = true, // web YAxis domain={[0, 100]} — the Y domain is anchored at zero
        MinHeight = ChartHeight,
    };

    private SocChartModel _model;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="SocChartModel.Pending"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public SocChart(
        ILocalizer localizer,
        SocChartModel? model = null,
        SocChartDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? SocChartModel.Pending;
        _diagnostics = diagnostics ?? new SocChartDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Content = _fade;
        Loaded += OnLoaded;
        Render();
    }

    /// <summary>Raised when the user invokes retry from the error surface; the host re-runs the drive read.</summary>
    public event EventHandler? RetryRequested;

    /// <summary>The canonical diagnostics slug this surface registers under (<c>SocChart</c>).</summary>
    public static string Slug => SocChartRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public SocChartModel Model
    {
        get => _model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _model = value;
            Render();
        }
    }

    /// <summary>
    /// Binds the cross-chart cursor-sync state holder (the web <c>useSyncedCursor</c> /
    /// <c>useSyncedReferenceLineX</c> group) so this chart's cursor moves together with the Drive-Detail page's
    /// other per-sample charts. Call once after construction; the underlying chart is reused across renders so
    /// the subscription is wired exactly once.
    /// </summary>
    /// <param name="group">The shared cursor-sync group every synchronised chart on the page subscribes to.</param>
    public void AttachCursorSync(ChartCursorSyncGroup group)
    {
        ArgumentNullException.ThrowIfNull(group);
        _chart.AttachCursorSync(group);
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
        SocChartDisplay display = SocChartProjection.Project(_model, _localizer);

        UIElement surface = display.State switch
        {
            SocChartState.Loading => BuildLoading(display),
            SocChartState.Error => BuildError(display),
            SocChartState.Empty => BuildEmpty(display),
            _ => BuildChart(display),
        };

        AutomationProperties.SetName(this, display.AutomationName);
        _fade.Content = surface;
    }

    // ── Loading (web ChartContainer spinner) ────────────────────────────────────────────────────────
    private static TsGlassPanel BuildLoading(SocChartDisplay display)
    {
        var stack = new StackPanel { Spacing = RootSpacing };
        stack.Children.Add(BuildHeader(display));
        stack.Children.Add(new TsChartSkeleton { MinHeight = ChartHeight });

        TsGlassPanel box = Box(stack, display.AutomationName);
        LiveRegion.Configure(box);
        LiveRegion.Announce(box);
        return box;
    }

    // ── Error (web QueryError equivalent with a retry affordance) ────────────────────────────────────
    private TsGlassPanel BuildError(SocChartDisplay display)
    {
        var stack = new StackPanel { Spacing = RootSpacing };
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

    // ── Empty (web `driveDetail.noChartData` → friendly "No telemetry data available" state) ──────────
    private static TsGlassPanel BuildEmpty(SocChartDisplay display)
    {
        var stack = new StackPanel { Spacing = RootSpacing };
        stack.Children.Add(BuildHeader(display));
        stack.Children.Add(new TsEmptyState
        {
            Message = display.EmptyMessage,
            VerticalAlignment = VerticalAlignment.Center,
        });

        return Box(stack, display.AutomationName);
    }

    // ── Ready / Stale / Offline (web fall-through: the AreaChart, plus a freshness chip when degraded) ─
    private TsGlassPanel BuildChart(SocChartDisplay display)
    {
        _chart.Series = [display.Series];
        _chart.Title = display.AriaLabel; // seeds the chart's spoken accessibility summary
        AutomationProperties.SetName(_chart, display.AriaLabel);
        DetachFromParent(_chart);

        var stack = new StackPanel { Spacing = RootSpacing };
        stack.Children.Add(BuildHeader(display));
        stack.Children.Add(_chart);

        return Box(stack, display.AutomationName);
    }

    // web `<ChartContainer title=...>` heading, with the stale / offline freshness chip on the trailing edge.
    private static Grid BuildHeader(SocChartDisplay display)
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

    // The stale / offline freshness chip: a tokenized status badge whose tone tells a stale snapshot from an
    // offline one apart, with a leading status dot and a Narrator name.
    private static TsBadge BuildChip(SocChartState state, string text)
    {
        var badge = new TsBadge
        {
            Status = state == SocChartState.Offline ? StatusKind.Danger : StatusKind.Warning,
            Dot = true,
            Content = text,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(badge, text);
        return badge;
    }

    private static void DetachFromParent(FrameworkElement element)
    {
        if (element.Parent is Panel panel)
        {
            panel.Children.Remove(element);
        }
    }

    private static TsGlassPanel Box(UIElement content, string automationName)
    {
        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = content };
        AutomationProperties.SetName(panel, automationName);
        return panel;
    }
}
