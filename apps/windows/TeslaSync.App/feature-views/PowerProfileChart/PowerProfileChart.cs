using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
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
/// The native WinUI 3 <c>PowerProfileChart</c> feature surface — a parity port of
/// <c>web/src/features/driving/components/drive-detail/PowerProfileChart.tsx</c>. The web component is a pure
/// presentational child of the drive-detail page: given a drive's per-sample <c>chartData</c> and its
/// <c>stats</c> it renders a <c>ChartContainer</c> wrapping an amber power <c>AreaChart</c> over time with a
/// zero reference line, then a centred row of three summary figures (Max Power / Max Regen / Avg). This
/// surface reproduces that area chart with the native <see cref="TsAreaChart"/> (drawn with the platform Power
/// accent), the zero reference line, and the same summary row. Following the web source's
/// <c>chart-a11y:no-table</c> annotation the dense per-sample trace exposes no fallback data table; the summary
/// figures below carry the accessible reading instead, each with a Narrator name. Assign a <see cref="Model"/>
/// and the surface renders exactly one of the projected states — <see cref="PowerProfileChartState.Loading"/>
/// (chart skeleton), <see cref="PowerProfileChartState.Error"/> (a <c>QueryError</c> with a retry affordance),
/// <see cref="PowerProfileChartState.Empty"/> (the web "No telemetry data available" surface), or the chart
/// itself for <see cref="PowerProfileChartState.Ready"/> / <see cref="PowerProfileChartState.Stale"/> /
/// <see cref="PowerProfileChartState.Offline"/> (the stale and offline snapshots adding a freshness chip). A
/// shared <see cref="CursorSync"/> group lets the chart's cursor track sibling drive charts, the native
/// analogue of the web <c>useSyncedCursor</c> / <c>useSyncedReferenceLineX</c> hooks. The view never performs
/// HTTP; all branch selection, rounding and label resolution happen in the WinUI-free
/// <see cref="PowerProfileChartProjection"/>. Every string resolves through the i18n facade.
/// </summary>
public sealed partial class PowerProfileChart : ContentControl
{
    private const double ChartHeight = 220; // web ChartContainer height={220}
    private const int FadeInDelayMs = 0;     // web wraps the surface in <FadeIn> (default delay)
    private const double StatLabelFontSize = 12;
    private const double StatGap = 24;
    private const string ZeroReferenceId = "power-zero"; // web <ReferenceLine y={0} />

    private readonly ILocalizer _localizer;
    private readonly PowerProfileChartDiagnostics _diagnostics;
    private readonly TsFadeIn _fade = new() { DelayMs = FadeInDelayMs };

    private PowerProfileChartModel _model;
    private ChartCursorSyncGroup? _cursorSync;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="PowerProfileChartModel.Pending"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public PowerProfileChart(
        ILocalizer localizer,
        PowerProfileChartModel? model = null,
        PowerProfileChartDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? PowerProfileChartModel.Pending;
        _diagnostics = diagnostics ?? new PowerProfileChartDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        Content = _fade;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>Raised when the user invokes retry from the error surface; the host re-runs the load.</summary>
    public event EventHandler? RetryRequested;

    /// <summary>The canonical diagnostics slug this surface registers under (<c>PowerProfileChart</c>).</summary>
    public static string Slug => PowerProfileChartRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public PowerProfileChartModel Model
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
    /// Optional shared cursor-sync group (web <c>useSyncedCursor</c> / <c>useSyncedReferenceLineX</c>). When
    /// set, the chart's hover cursor and reference line track every sibling drive chart in the same group.
    /// </summary>
    public ChartCursorSyncGroup? CursorSync
    {
        get => _cursorSync;
        set
        {
            _cursorSync = value;
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
        PowerProfileChartDisplay display = PowerProfileChartProjection.Project(_model, _localizer);

        UIElement surface = display.State switch
        {
            PowerProfileChartState.Loading => BuildLoading(display),
            PowerProfileChartState.Error => BuildError(display),
            PowerProfileChartState.Empty => BuildEmpty(display),
            _ => BuildChart(display),
        };

        AutomationProperties.SetName(this, display.AutomationName);
        _fade.Content = surface;
    }

    // ── Loading (web ChartContainer spinner) ────────────────────────────────────────────────────────
    private static TsGlassPanel BuildLoading(PowerProfileChartDisplay display)
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
    private TsGlassPanel BuildError(PowerProfileChartDisplay display)
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

    // ── Empty (web `chartData.length > 1` fails → "No telemetry data available") ─────────────────────
    private static TsGlassPanel BuildEmpty(PowerProfileChartDisplay display)
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

    // ── Ready / Stale / Offline (web fall-through: the AreaChart + the summary stats row) ────────────
    private TsGlassPanel BuildChart(PowerProfileChartDisplay display)
    {
        var stack = new StackPanel { Spacing = 12 };
        stack.Children.Add(BuildHeader(display));
        stack.Children.Add(BuildPlot(display));
        stack.Children.Add(BuildStats(display));

        return Box(stack, display.AutomationName);
    }

    private static Grid BuildHeader(PowerProfileChartDisplay display)
    {
        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var title = new PanelTitle { Value = display.Title };
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

    // The stale / offline freshness chip (web stale/offline chip): a tokenized status badge whose tone tells a
    // freshness from an offline snapshot apart, with a leading status dot and a Narrator name.
    private static TsBadge BuildChip(PowerProfileChartState state, string text)
    {
        var badge = new TsBadge
        {
            Status = state == PowerProfileChartState.Offline ? StatusKind.Danger : StatusKind.Warning,
            Dot = true,
            Content = text,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(badge, text);
        return badge;
    }

    /// <summary>
    /// The amber power-over-time plot — the native analogue of the web recharts <c>AreaChart</c>. The single
    /// area series is drawn with the platform Power accent, a zero reference line marks the draw/regen
    /// boundary (web <c>&lt;ReferenceLine y={0} /&gt;</c>), and the shared <see cref="CursorSync"/> group (when
    /// present) keeps the cursor aligned with sibling drive charts. The chart carries the aria-label as its
    /// Narrator name.
    /// </summary>
    private TsAreaChart BuildPlot(PowerProfileChartDisplay display)
    {
        var chart = new TsAreaChart
        {
            Series = [display.Series],
            Annotations = [new ChartAnnotation(ZeroReferenceId, ChartAnnotationKind.HorizontalLine, 0)],
            ShowLegend = false,
            IncludeZero = true,
            Title = display.Title,
            MinHeight = ChartHeight,
        };
        AutomationProperties.SetName(chart, display.AriaLabel);

        if (_cursorSync is { } group)
        {
            chart.AttachCursorSync(group);
        }

        return chart;
    }

    // Web parity: the centred row of three summary figures below the chart (Max Power / Max Regen / Avg). The
    // web `chart-a11y:no-table` annotation opts the dense trace out of a fallback table, so this row carries
    // the accessible reading; each figure is a "label: value" Narrator name and the row is a group.
    private static StackPanel BuildStats(PowerProfileChartDisplay display)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = StatGap,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        foreach (PowerProfileStatItem stat in display.Stats)
        {
            row.Children.Add(BuildStat(stat));
        }

        AutomationProperties.SetName(row, display.AriaLabel);
        return row;
    }

    private static StackPanel BuildStat(PowerProfileStatItem stat)
    {
        var label = new TextBlock
        {
            Text = stat.Label + ":",
            FontSize = StatLabelFontSize,
            Foreground = DisplayTokens.TextSecondary,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var value = new TextBlock
        {
            Text = stat.Value,
            FontSize = StatLabelFontSize,
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
            Foreground = DisplayTokens.Brush(stat.ColorBrushKey),
            VerticalAlignment = VerticalAlignment.Center,
        };

        var entry = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4 };
        entry.Children.Add(label);
        entry.Children.Add(value);
        AutomationProperties.SetName(entry, stat.AutomationName);
        return entry;
    }

    private static TsGlassPanel Box(UIElement content, string automationName)
    {
        var panel = new TsGlassPanel { Padding = new Thickness(16), Content = content };
        AutomationProperties.SetName(panel, automationName);
        return panel;
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new PowerProfileChartAutomationPeer(this);

    private sealed class PowerProfileChartAutomationPeer(PowerProfileChart owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? PowerProfileChartRegistration.Name(((PowerProfileChart)Owner)._localizer)
                : name;
        }
    }
}
