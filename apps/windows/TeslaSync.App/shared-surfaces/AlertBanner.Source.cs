namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The content seam the <c>AlertBanner</c> shared surface binds through (P1/S8). The web <c>AlertBanner</c> is a
/// presentational primitive whose content is owned by its parent — a page or feature that decides, from app state,
/// whether a persistent inline notice should be shown (e.g. "Tesla connection expired — reconnect", "Vehicle is
/// offline", a beta-feature notice). This seam is the native analogue of that parent-owned state: it exposes the
/// current <see cref="AlertBannerModel"/> to display (or null when there is no alert, which collapses the banner)
/// and raises <see cref="Changed"/> whenever that moves, so the view never fetches or owns content itself. The
/// production / host binding is <see cref="StaticAlertBannerSource"/>, which the owning page drives by assigning the
/// resolved model; the same type stands in for headless hosts and unit tests.
/// </summary>
public interface IAlertBannerSource
{
    /// <summary>The alert to display, or null when there is no alert (the banner collapses).</summary>
    AlertBannerModel? Current { get; }

    /// <summary>Raised whenever <see cref="Current"/> changes; may be raised from a background thread.</summary>
    event EventHandler? Changed;
}

/// <summary>
/// An <see cref="IAlertBannerSource"/> with an explicit, caller-set alert — the host entry point and the headless /
/// unit-test default. The owning page assigns the resolved model (the web props) through <see cref="Set"/>, which
/// moves the alert and raises <see cref="Changed"/> so the banner re-projects and animates in; assigning null (or
/// calling <see cref="Clear"/>) collapses it. This is the native analogue of a React parent re-rendering the
/// <c>AlertBanner</c> with new props, or removing it entirely.
/// </summary>
public sealed class StaticAlertBannerSource : IAlertBannerSource
{
    private AlertBannerModel? _current;

    /// <summary>Creates a source over an initial alert (null = start collapsed).</summary>
    /// <param name="current">The initial alert to display, or null for no alert.</param>
    public StaticAlertBannerSource(AlertBannerModel? current = null) => _current = current;

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public AlertBannerModel? Current => _current;

    /// <summary>Move the displayed alert (or null to collapse) and raise <see cref="Changed"/>.</summary>
    /// <param name="model">The new alert to display, or null for no alert.</param>
    public void Set(AlertBannerModel? model)
    {
        _current = model;
        Changed?.Invoke(this, EventArgs.Empty);
    }

    /// <summary>Collapse the banner by clearing the displayed alert (web parent removing the element).</summary>
    public void Clear() => Set(null);
}
