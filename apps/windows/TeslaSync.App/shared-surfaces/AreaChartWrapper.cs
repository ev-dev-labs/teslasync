using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces.AreaChartWrapperSurface;

/// <summary>
/// The native WinUI 3 <c>AreaChartWrapper</c> shared surface — a parity port of
/// <c>web/src/components/charts/AreaChartWrapper.tsx</c>. The web component is a pure presentational,
/// chrome-free wrapper: a full-width <c>div</c> hosting a recharts <c>ResponsiveContainer</c>/<c>AreaChart</c>
/// that draws one soft gradient <c>&lt;Area&gt;</c> per <c>SeriesConfig</c> over a <c>CartesianGrid</c> with
/// X/Y axes and a dark tooltip mapping each series' <c>key</c> to its <c>label</c> — no title, no panel and
/// no legend of its own. This surface reproduces that chart with the shared <see cref="TsAreaChart"/>
/// primitive (the native cartesian area renderer) hosted in a bare full-width container, and — because the
/// native shared surface renders the full P2 state matrix its consumers drive around the web component —
/// adds a loading skeleton, an explicit retry surface on hard failure, and stale / offline freshness chips,
/// so the chart never collapses to a blank box. Assign a <see cref="Model"/> and the surface renders exactly
/// one of the projected states. The view never performs HTTP; all branch selection, series mapping and label
/// resolution happen in the WinUI-free <see cref="AreaChartWrapperProjection"/>. Every string resolves
/// through the i18n facade and every region carries a Narrator name. The chart has no animation, so the
/// reduced-motion preference is honoured by construction (only the loading skeleton pulses, and it suppresses
/// its own shimmer under reduced motion).
/// </summary>
public sealed partial class AreaChartWrapper : ContentControl
{
    private const double ChipMargin = 12;

    private readonly ILocalizer _localizer;
    private readonly AreaChartWrapperDiagnostics _diagnostics;

    // Web parity: the AreaChart is created once and reused across model pushes; only its Series and Height
    // are re-bound on render. ShowLegend is false because the web AreaChartWrapper renders no <Legend>
    // (series are distinguished by colour and the tooltip); IncludeZero anchors the area fill at a zero
    // baseline, the conventional area-chart reading.
    private readonly TsAreaChart _chart = new()
    {
        ShowLegend = false,
        IncludeZero = true,
        HorizontalAlignment = HorizontalAlignment.Stretch,
        VerticalAlignment = VerticalAlignment.Stretch,
    };

    private AreaChartWrapperModel _model;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="AreaChartWrapperModel.Empty"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public AreaChartWrapper(
        ILocalizer localizer,
        AreaChartWrapperModel? model = null,
        AreaChartWrapperDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? AreaChartWrapperModel.Empty;
        _diagnostics = diagnostics ?? new AreaChartWrapperDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>Raised when the user invokes retry from the error surface; the host re-runs the read.</summary>
    public event EventHandler? RetryRequested;

    /// <summary>The canonical diagnostics slug this surface registers under (<c>AreaChartWrapper</c>).</summary>
    public static string Slug => AreaChartWrapperRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public AreaChartWrapperModel Model
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
        AreaChartWrapperDisplay display = AreaChartWrapperProjection.Project(_model, _localizer);

        UIElement surface = display.State switch
        {
            AreaChartWrapperState.Loading => BuildLoading(display),
            AreaChartWrapperState.Error => BuildError(display),
            AreaChartWrapperState.Empty => BuildEmpty(display),
            _ => BuildChart(display),
        };

        AutomationProperties.SetName(this, display.AutomationName);
        Content = surface;
    }

    // ── Loading (the web chart area before its consumer's data resolves) ─────────────────────────────
    private static TsChartSkeleton BuildLoading(AreaChartWrapperDisplay display) =>
        new() { MinHeight = display.Height };

    // ── Error (the QueryError equivalent the consuming surface shows on hard failure, with retry) ────
    private TsQueryError BuildError(AreaChartWrapperDisplay display)
    {
        var error = new TsQueryError
        {
            Title = display.ErrorTitle,
            Message = display.ErrorMessage,
            ActionText = display.RetryLabel,
            MinHeight = display.Height,
        };
        error.ActionInvoked += (_, _) => RetryRequested?.Invoke(this, EventArgs.Empty);
        return error;
    }

    // ── Empty (no rows / no series → friendly empty surface, never a blank box) ──────────────────────
    private static TsEmptyState BuildEmpty(AreaChartWrapperDisplay display) =>
        new()
        {
            Message = display.EmptyMessage,
            MinHeight = display.Height,
        };

    // ── Ready / Stale / Offline (the web AreaChart, plus a freshness chip when the snapshot is degraded) ─
    private Grid BuildChart(AreaChartWrapperDisplay display)
    {
        _chart.Series = display.Series;
        _chart.Height = display.Height;
        AutomationProperties.SetName(_chart, display.AriaLabel);
        DetachFromParent(_chart);

        // Web parity: a full-width container hosting the chart (the web `<div className="w-full">`); the
        // freshness chip is overlaid in the same cell so the chrome-free chart keeps its full width.
        var grid = new Grid { HorizontalAlignment = HorizontalAlignment.Stretch };
        grid.Children.Add(_chart);

        if (display.FreshnessChip is { } chipText)
        {
            TsBadge chip = BuildChip(display.State, chipText);
            grid.Children.Add(chip);
        }

        return grid;
    }

    // The stale / offline freshness chip: a tokenized status badge whose tone tells a stale snapshot from an
    // offline one apart, with a leading status dot and a Narrator name, pinned to the chart's top-right.
    private static TsBadge BuildChip(AreaChartWrapperState state, string text)
    {
        var badge = new TsBadge
        {
            Status = state == AreaChartWrapperState.Offline ? StatusKind.Danger : StatusKind.Warning,
            Dot = true,
            Content = text,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Top,
            Margin = new Thickness(0, ChipMargin, ChipMargin, 0),
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
}
