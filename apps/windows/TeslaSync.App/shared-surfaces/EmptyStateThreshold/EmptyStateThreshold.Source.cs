namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The state-holder seam the <c>EmptyStateThreshold</c> surface binds through (P1/S8) — the native analogue of
/// the props the web <c>&lt;EmptyStateThreshold&gt;</c> receives (web/src/components/feedback/EmptyStateThreshold.tsx).
/// It exposes the current <see cref="EmptyStateThresholdInput"/> (the counts, labels and slot flags) and raises
/// <see cref="Changed"/> whenever those inputs are reassigned — the analogue of the parent re-rendering with new
/// props. The view never reads a query or performs HTTP itself; it binds to this seam and observes the bound
/// view-model. <see cref="StaticEmptyStateThresholdSource"/> is the in-memory holder a page (or a test) pushes the
/// resolved props into.
/// </summary>
public interface IEmptyStateThresholdSource
{
    /// <summary>The current inputs (counts, labels, slot flags); never null.</summary>
    EmptyStateThresholdInput Current { get; }

    /// <summary>Raised whenever <see cref="Current"/> changes; may be raised from a background thread.</summary>
    event EventHandler? Changed;
}

/// <summary>
/// An <see cref="IEmptyStateThresholdSource"/> with an explicit, caller-set input — the canonical holder a page
/// pushes the resolved props into and the headless / unit-test default. It mirrors a parent passing fresh props to
/// the web component: <see cref="Set"/> replaces the whole input, <see cref="SetCounts"/> moves just the current /
/// threshold pair (e.g. when a new session lands), each raising <see cref="Changed"/> so the bound view-model
/// re-projects. A null assignment falls back to a safe default so the view-model never dereferences null.
/// </summary>
public sealed class StaticEmptyStateThresholdSource : IEmptyStateThresholdSource
{
    private EmptyStateThresholdInput _current;

    /// <summary>Creates an empty source (zero counts, no label) — the parameterless headless default.</summary>
    public StaticEmptyStateThresholdSource()
        : this(new EmptyStateThresholdInput())
    {
    }

    /// <summary>Creates a source seeded with an initial input.</summary>
    /// <param name="current">The initial inputs (a null falls back to the default input).</param>
    public StaticEmptyStateThresholdSource(EmptyStateThresholdInput current) =>
        _current = current ?? new EmptyStateThresholdInput();

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public EmptyStateThresholdInput Current => _current;

    /// <summary>Replace the whole input (a null falls back to the default input) and notify.</summary>
    /// <param name="input">The new inputs.</param>
    public void Set(EmptyStateThresholdInput input)
    {
        _current = input ?? new EmptyStateThresholdInput();
        Changed?.Invoke(this, EventArgs.Empty);
    }

    /// <summary>
    /// Move just the current / threshold counts, keeping every other input — the analogue of the parent passing a
    /// fresh <c>currentCount</c> as more items accrue while the labels stay put.
    /// </summary>
    /// <param name="currentCount">How many items the user currently has (web <c>currentCount</c>).</param>
    /// <param name="threshold">The minimum items required (web <c>threshold</c>).</param>
    public void SetCounts(int currentCount, int threshold)
    {
        _current = _current with { CurrentCount = currentCount, Threshold = threshold };
        Changed?.Invoke(this, EventArgs.Empty);
    }
}
