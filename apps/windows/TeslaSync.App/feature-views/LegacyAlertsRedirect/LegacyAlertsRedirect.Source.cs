namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The current shell location surfaced to the redirect — the native analogue of the object the web
/// <c>useLocation()</c> hook returns (web/src/features/notifications/components/LegacyAlertsRedirect.tsx
/// reads <c>location.search</c>). <see cref="Path"/> is the legacy path (<c>/alerts</c>) and
/// <see cref="Search"/> is the raw query string (with or without a leading <c>?</c>, exactly as React
/// Router's <c>location.search</c> provides it). Pure data — no WinUI types.
/// </summary>
/// <param name="Path">The current path (web <c>location.pathname</c>), e.g. <c>/alerts</c>.</param>
/// <param name="Search">The current raw query string (web <c>location.search</c>), e.g. <c>?tab=history</c>.</param>
public sealed record LegacyAlertsLocation(string Path, string Search)
{
    /// <summary>The empty location (no path, no query) — the headless / unit-test default.</summary>
    public static LegacyAlertsLocation Empty { get; } = new(string.Empty, string.Empty);
}

/// <summary>
/// The state-holder seam the <see cref="LegacyAlertsRedirectViewModel"/> binds to (P1/S8) — the native
/// analogue of the web <c>useLocation()</c> hook. It exposes the <see cref="Current"/> location and a
/// <see cref="Changed"/> signal so the surface re-resolves if the location changes before navigation (the
/// web hook re-renders on every location change). The view never reads navigation state directly; the
/// canonical <see cref="LegacyAlertsLocationSource"/> (or a test fake) drives this.
/// </summary>
public interface ILegacyAlertsLocationSource
{
    /// <summary>Raised whenever <see cref="Current"/> changes (the web <c>useLocation</c> re-render signal).</summary>
    event EventHandler? Changed;

    /// <summary>The current location whose <see cref="LegacyAlertsLocation.Search"/> drives the redirect.</summary>
    LegacyAlertsLocation Current { get; }
}

/// <summary>
/// The canonical <see cref="ILegacyAlertsLocationSource"/> — a small observable holder for the location the
/// redirect resolves against. It is constructed from the activation that landed on the legacy
/// <c>/alerts</c> route: a deep-link <see cref="Uri"/> (<see cref="FromUri"/>), a combined
/// <c>path?query</c> string (<see cref="FromLocation"/>), or a bare query string (<see cref="FromSearch"/>).
/// <see cref="Set"/> updates the location and raises <see cref="Changed"/> so a bound surface re-resolves,
/// exactly as React Router re-renders <c>useLocation</c> consumers on navigation. Headless, so the adapter
/// and its parsers are unit-tested without a UI host.
/// </summary>
public sealed class LegacyAlertsLocationSource : ILegacyAlertsLocationSource
{
    /// <summary>The legacy path this redirect handles (web route <c>/alerts</c>).</summary>
    public const string LegacyPath = "/alerts";

    private LegacyAlertsLocation _current;

    /// <summary>Creates the source over an initial <paramref name="location"/> (defaults to <see cref="LegacyAlertsLocation.Empty"/>).</summary>
    public LegacyAlertsLocationSource(LegacyAlertsLocation? location = null) =>
        _current = location ?? LegacyAlertsLocation.Empty;

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public LegacyAlertsLocation Current => _current;

    /// <summary>Replace the current location (web navigation to a new <c>useLocation</c> value) and raise <see cref="Changed"/>.</summary>
    public void Set(LegacyAlertsLocation location)
    {
        ArgumentNullException.ThrowIfNull(location);
        _current = location;
        Changed?.Invoke(this, EventArgs.Empty);
    }

    /// <summary>Create a source from a bare query <paramref name="search"/> string (the web <c>location.search</c>).</summary>
    public static LegacyAlertsLocationSource FromSearch(string? search) =>
        new(new LegacyAlertsLocation(LegacyPath, search ?? string.Empty));

    /// <summary>
    /// Create a source from a combined <paramref name="location"/> string (<c>path?query</c>), splitting on the
    /// first <c>?</c>. The leading <c>?</c> is retained on the query so it matches React Router's
    /// <c>location.search</c> shape.
    /// </summary>
    public static LegacyAlertsLocationSource FromLocation(string? location)
    {
        if (string.IsNullOrEmpty(location))
        {
            return new LegacyAlertsLocationSource(new LegacyAlertsLocation(LegacyPath, string.Empty));
        }

        int query = location.IndexOf('?');
        string path = query < 0 ? location : location[..query];
        string search = query < 0 ? string.Empty : location[query..];
        return new LegacyAlertsLocationSource(new LegacyAlertsLocation(path, search));
    }

    /// <summary>
    /// Create a source from a deep-link activation <paramref name="uri"/> (e.g.
    /// <c>teslasync://app/alerts?tab=history</c> or <c>https://host/alerts?tab=history</c>), taking the path
    /// and query directly from the URI. <see cref="Uri.Query"/> already includes the leading <c>?</c>.
    /// </summary>
    public static LegacyAlertsLocationSource FromUri(Uri uri)
    {
        ArgumentNullException.ThrowIfNull(uri);

        string path = uri.IsAbsoluteUri ? uri.AbsolutePath : uri.OriginalString;
        string search = uri.IsAbsoluteUri ? uri.Query : string.Empty;
        return new LegacyAlertsLocationSource(new LegacyAlertsLocation(path, search));
    }
}
