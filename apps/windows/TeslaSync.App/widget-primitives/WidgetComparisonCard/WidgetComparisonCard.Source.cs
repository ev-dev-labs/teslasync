using System.Collections.Generic;

namespace TeslaSync.App.WidgetPrimitives;

/// <summary>
/// The data seam the <see cref="WidgetComparisonCardViewModel"/> binds to (P1/S8 state-holder seam) — the native
/// analogue of the props the web <c>WidgetComparisonCard</c> receives from its parent widget
/// (web/src/features/dashboard/widgets/shared/WidgetComparisonCard.tsx). The web card is presentational and never
/// fetches; likewise this seam simply holds the resolved <see cref="Input"/> (the metric list and the compact
/// flag) and raises <see cref="Changed"/> when it is reassigned — the analogue of the parent re-rendering with
/// new props. The view never touches this seam or HTTP directly; it observes the view-model.
/// </summary>
public interface IWidgetComparisonCardSource
{
    /// <summary>The current presentational inputs; never null.</summary>
    WidgetComparisonCardInput Input { get; }

    /// <summary>Raised whenever the input changes.</summary>
    event EventHandler? Changed;
}

/// <summary>
/// The in-memory <see cref="IWidgetComparisonCardSource"/> — the canonical holder a parent widget (or a test)
/// pushes the card's presentational inputs into. It mirrors a parent passing fresh props to the web
/// <c>WidgetComparisonCard</c>: <see cref="SetInput"/> replaces the whole input, <see cref="SetMetrics"/> moves
/// just the metric list and <see cref="SetCompact"/> toggles the compact flag, each raising <see cref="Changed"/>
/// so the bound view-model re-projects. A null assignment falls back to a safe default so the view-model never
/// dereferences null.
/// </summary>
public sealed class WidgetComparisonCardSource : IWidgetComparisonCardSource
{
    private WidgetComparisonCardInput _input;

    /// <summary>Creates an empty source (no metrics, the full — non-compact — form).</summary>
    public WidgetComparisonCardSource()
        : this(new WidgetComparisonCardInput())
    {
    }

    /// <summary>Creates a source seeded with an initial input (a null falls back to the default input).</summary>
    /// <param name="input">The initial presentational inputs.</param>
    public WidgetComparisonCardSource(WidgetComparisonCardInput input) =>
        _input = input ?? new WidgetComparisonCardInput();

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public WidgetComparisonCardInput Input => _input;

    /// <summary>Replace the whole input (a null falls back to the default input) and notify.</summary>
    /// <param name="input">The new presentational inputs.</param>
    public void SetInput(WidgetComparisonCardInput input)
    {
        _input = input ?? new WidgetComparisonCardInput();
        RaiseChanged();
    }

    /// <summary>Move just the metric list, keeping the compact flag, and notify.</summary>
    /// <param name="metrics">The new metric list; a null falls back to an empty list.</param>
    public void SetMetrics(IReadOnlyList<ComparisonMetric> metrics)
    {
        _input = _input with { Metrics = metrics ?? Array.Empty<ComparisonMetric>() };
        RaiseChanged();
    }

    /// <summary>Toggle the compact flag (web <c>compact</c>), keeping the metric list, and notify.</summary>
    /// <param name="compact">Whether the card renders in its tighter compact form.</param>
    public void SetCompact(bool compact)
    {
        if (_input.Compact == compact)
        {
            return;
        }

        _input = _input with { Compact = compact };
        RaiseChanged();
    }

    private void RaiseChanged() => Changed?.Invoke(this, EventArgs.Empty);
}
