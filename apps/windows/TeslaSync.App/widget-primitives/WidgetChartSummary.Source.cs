namespace TeslaSync.App.WidgetPrimitives;

/// <summary>
/// The state-holder seam the WidgetChartSummary primitive binds through (P1/S8) — the native analogue of the props
/// the web <c>&lt;WidgetChartSummary&gt;</c> receives from its parent widget
/// (web/src/features/dashboard/widgets/shared/WidgetChartSummary.tsx). It exposes the current
/// <see cref="WidgetChartSummaryInput"/> (the stats, the compact flag, the empty message / icon glyph and the
/// <c>isEmpty</c> flag) and raises <see cref="Changed"/> whenever those inputs are reassigned — the analogue of the
/// parent widget re-rendering with new props as its query data resolves. The view never reads a query or performs
/// HTTP itself; it binds to this seam and observes the bound view-model.
/// <see cref="StaticWidgetChartSummarySource"/> is the in-memory holder a parent widget (or a test) pushes the
/// resolved props into.
/// </summary>
public interface IWidgetChartSummarySource
{
    /// <summary>The current inputs (stats, compact, empty message / glyph, isEmpty); never null.</summary>
    WidgetChartSummaryInput Current { get; }

    /// <summary>Raised whenever <see cref="Current"/> changes; may be raised from a background thread.</summary>
    event EventHandler? Changed;
}

/// <summary>
/// An <see cref="IWidgetChartSummarySource"/> with an explicit, caller-set input — the canonical holder a parent
/// widget pushes the resolved props into and the headless / unit-test default. It mirrors a parent passing fresh
/// props to the web component: <see cref="Set"/> replaces the whole input, <see cref="SetStats"/> swaps just the
/// stat figures (e.g. as a query resolves), and <see cref="SetEmpty"/> toggles just the empty flag, each raising
/// <see cref="Changed"/> so the bound view-model re-projects. A null assignment falls back to a safe default so the
/// view-model never dereferences null.
/// </summary>
public sealed class StaticWidgetChartSummarySource : IWidgetChartSummarySource
{
    private WidgetChartSummaryInput _current;

    /// <summary>Creates an empty source (no stats, not compact, not empty) — the parameterless headless default.</summary>
    public StaticWidgetChartSummarySource()
        : this(new WidgetChartSummaryInput())
    {
    }

    /// <summary>Creates a source seeded with an initial input.</summary>
    /// <param name="current">The initial inputs (a null falls back to the default input).</param>
    public StaticWidgetChartSummarySource(WidgetChartSummaryInput current) =>
        _current = current ?? new WidgetChartSummaryInput();

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public WidgetChartSummaryInput Current => _current;

    /// <summary>Replace the whole input (a null falls back to the default input) and notify.</summary>
    /// <param name="input">The new inputs.</param>
    public void Set(WidgetChartSummaryInput input)
    {
        _current = input ?? new WidgetChartSummaryInput();
        Changed?.Invoke(this, EventArgs.Empty);
    }

    /// <summary>
    /// Swap just the stat figures, keeping every other input — the analogue of the parent passing fresh
    /// <c>stats</c> as a query resolves while the compact / empty flags stay put.
    /// </summary>
    /// <param name="stats">The new stat figures (a null falls back to an empty list).</param>
    public void SetStats(IReadOnlyList<ChartSummaryStat> stats)
    {
        _current = _current with { Stats = stats ?? Array.Empty<ChartSummaryStat>() };
        Changed?.Invoke(this, EventArgs.Empty);
    }

    /// <summary>
    /// Toggle just the <c>isEmpty</c> flag, keeping every other input — the analogue of the parent flipping the
    /// component into / out of the shared empty state as its data appears or clears.
    /// </summary>
    /// <param name="isEmpty">Whether the empty state is shown (web <c>isEmpty</c>).</param>
    public void SetEmpty(bool isEmpty)
    {
        _current = _current with { IsEmpty = isEmpty };
        Changed?.Invoke(this, EventArgs.Empty);
    }
}
