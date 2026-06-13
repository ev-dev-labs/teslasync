namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The content seam the <c>TourOverlay</c> shared surface binds through (P1/S8). The web <c>TourOverlay</c> is a
/// presentational element whose state — the active step, its measured target rect and the step index / count — is
/// owned by the <c>useTour</c> hook in the parent (web/src/hooks/useTour.ts), which decides when a tour is running
/// and advances it. This seam is the native analogue of that owner-held state: it exposes the current
/// <see cref="TourSnapshot"/> to render (or null when no tour is running, which collapses the overlay) and raises
/// <see cref="Changed"/> whenever that moves, so the view never owns or fetches tour state itself. The production /
/// host binding is <see cref="StaticTourOverlaySource"/>, which the owner drives in response to the surface's
/// next / back / skip requests; the same type stands in for headless hosts and unit tests.
/// </summary>
public interface ITourOverlaySource
{
    /// <summary>The active-tour state to render, or null when no tour is running (the overlay collapses).</summary>
    TourSnapshot? Current { get; }

    /// <summary>Raised whenever <see cref="Current"/> changes; may be raised from a background thread.</summary>
    event EventHandler? Changed;
}

/// <summary>
/// An <see cref="ITourOverlaySource"/> with an explicit, caller-set snapshot — the host entry point and the
/// headless / unit-test default. The owner assigns the resolved snapshot (the web <c>useTour</c> state) through
/// <see cref="Set"/>, which moves it and raises <see cref="Changed"/> so the overlay re-projects and animates in;
/// assigning null (or calling <see cref="Clear"/>) collapses it. This is the native analogue of the web parent
/// re-rendering <c>TourOverlay</c> with the next step's props, or unmounting it when the tour ends.
/// </summary>
public sealed class StaticTourOverlaySource : ITourOverlaySource
{
    private TourSnapshot? _current;

    /// <summary>Creates a source over an initial snapshot (null = start collapsed, no tour running).</summary>
    /// <param name="current">The initial snapshot to render, or null for no tour.</param>
    public StaticTourOverlaySource(TourSnapshot? current = null) => _current = current;

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public TourSnapshot? Current => _current;

    /// <summary>Move the rendered snapshot (or null to collapse) and raise <see cref="Changed"/>.</summary>
    /// <param name="snapshot">The new snapshot to render, or null for no tour.</param>
    public void Set(TourSnapshot? snapshot)
    {
        _current = snapshot;
        Changed?.Invoke(this, EventArgs.Empty);
    }

    /// <summary>Collapse the overlay by clearing the snapshot (the web parent ending the tour).</summary>
    public void Clear() => Set(null);
}
