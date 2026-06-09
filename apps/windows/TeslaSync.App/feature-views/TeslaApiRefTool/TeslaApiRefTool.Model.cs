using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// One Tesla Fleet API reference row — the native port of a <c>TESLA_ENDPOINTS</c> entry
/// (<c>web/src/features/admin/components/devtools/constants.ts</c>): an HTTP <see cref="Method"/>,
/// the request <see cref="Path"/> and a short human <see cref="Description"/>. These three values are
/// verbatim reference data, exactly as the web table renders them (the web does <b>not</b> route the
/// method/path/desc through <c>t()</c>), so they are intentionally not localized. The type is UI-free
/// so the catalog + filter contract is unit-tested without a XAML runtime.
/// </summary>
/// <param name="Method">The HTTP verb (e.g. <c>GET</c>, <c>POST</c>).</param>
/// <param name="Path">The request path template (e.g. <c>/api/1/vehicles/{id}/vehicle_data</c>).</param>
/// <param name="Description">The short endpoint description shown in the third column.</param>
public sealed record TeslaApiEndpoint(string Method, string Path, string Description)
{
    /// <summary>True when this is a read (<c>GET</c>) endpoint — the web <c>method === 'GET'</c> test.</summary>
    public bool IsGet => string.Equals(Method, "GET", StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// The chip status the method badge renders with — the native mirror of the web
    /// <c>variant={r.method === 'GET' ? 'info' : 'warning'}</c>: read verbs are informational, every
    /// write verb is a warning accent.
    /// </summary>
    public StatusKind MethodStatus => IsGet ? StatusKind.Info : StatusKind.Warning;

    /// <summary>
    /// True when <paramref name="query"/> is a case-insensitive substring of the method, path or
    /// description — the native port of the web filter predicate
    /// (<c>e.method/path/desc.toLowerCase().includes(q)</c>). The query is matched verbatim (the web
    /// only trims for the empty check, not for the match), so leading/trailing spaces are significant.
    /// </summary>
    public bool Matches(string query) =>
        Method.Contains(query, StringComparison.OrdinalIgnoreCase) ||
        Path.Contains(query, StringComparison.OrdinalIgnoreCase) ||
        Description.Contains(query, StringComparison.OrdinalIgnoreCase);
}

/// <summary>
/// The static Tesla Fleet API endpoint reference — the native port of the web <c>TESLA_ENDPOINTS</c>
/// constant. The list is fixed reference data (the tool performs no I/O); it is exposed as an
/// immutable projection so the view and the unit tests read the same source of truth.
/// </summary>
public static class TeslaApiEndpointCatalog
{
    /// <summary>The eleven reference endpoints, in web declaration order.</summary>
    public static IReadOnlyList<TeslaApiEndpoint> Endpoints { get; } =
    [
        new("GET", "/api/1/vehicles", "List vehicles"),
        new("GET", "/api/1/vehicles/{id}/vehicle_data", "Get vehicle data"),
        new("POST", "/api/1/vehicles/{id}/command/wake_up", "Wake up vehicle"),
        new("POST", "/api/1/vehicles/{id}/command/door_lock", "Lock doors"),
        new("POST", "/api/1/vehicles/{id}/command/door_unlock", "Unlock doors"),
        new("POST", "/api/1/vehicles/{id}/command/flash_lights", "Flash lights"),
        new("POST", "/api/1/vehicles/{id}/command/honk_horn", "Honk horn"),
        new("POST", "/api/1/vehicles/{id}/command/set_charge_limit", "Set charge limit"),
        new("POST", "/api/1/vehicles/{id}/command/charge_start", "Start charging"),
        new("POST", "/api/1/vehicles/{id}/command/charge_stop", "Stop charging"),
        new("GET", "/api/1/vehicles/{id}/nearby_charging_sites", "Nearby chargers"),
    ];
}

/// <summary>
/// Pure search adapter — the native port of the web component's <c>useMemo</c> filter
/// (<c>web/src/features/admin/components/devtools/tools/TeslaApiRefTool.tsx</c>). Reproduces the web
/// semantics exactly: an empty / whitespace-only query returns the whole catalog (web
/// <c>if (!search.trim()) return TESLA_ENDPOINTS</c>); otherwise the (un-trimmed) query is matched
/// case-insensitively against each endpoint's method, path and description. UI-free and deterministic
/// so it is fully unit-testable.
/// </summary>
public static class TeslaApiRefFilter
{
    /// <summary>Filter the default <see cref="TeslaApiEndpointCatalog.Endpoints"/> by <paramref name="query"/>.</summary>
    public static IReadOnlyList<TeslaApiEndpoint> Apply(string? query) =>
        Apply(query, TeslaApiEndpointCatalog.Endpoints);

    /// <summary>Filter <paramref name="source"/> by <paramref name="query"/>.</summary>
    public static IReadOnlyList<TeslaApiEndpoint> Apply(string? query, IReadOnlyList<TeslaApiEndpoint> source)
    {
        ArgumentNullException.ThrowIfNull(source);

        var raw = query ?? string.Empty;
        if (raw.Trim().Length == 0)
        {
            return source;
        }

        var matches = new List<TeslaApiEndpoint>(source.Count);
        foreach (var endpoint in source)
        {
            if (endpoint.Matches(raw))
            {
                matches.Add(endpoint);
            }
        }

        return matches;
    }
}

/// <summary>
/// The display state the Tesla API reference surface can be in — the honest union of the branches the
/// web source actually renders. The tool is a pure client-side reference (its only hook is
/// <c>useTranslation</c>; it performs no I/O over a static constant), so there is no loading / error /
/// stale / offline branch to reproduce: the only dynamic outcome is whether the current search filter
/// leaves any rows.
/// </summary>
public enum TeslaApiRefState
{
    /// <summary>The filter left at least one endpoint — the table renders rows.</summary>
    Populated,

    /// <summary>The filter matched nothing (web <c>DataTable</c> empty row) — a friendly empty state shows.</summary>
    Empty,
}

/// <summary>
/// Canonical identity + presentation metadata for the Tesla API reference surface — the native mirror
/// of the web devtools registry entry
/// (<c>{ id: 'tesla-api', icon: BookOpen, color: 'cyan', … }</c> in
/// <c>ClientUtilitiesSection.tsx</c>). Surfaced as constants so the values are asserted in unit tests
/// and consumed token-first by the view.
/// </summary>
public static class TeslaApiRefToolRegistration
{
    /// <summary>Stable surface id (web registry <c>id: 'tesla-api'</c>).</summary>
    public const string Id = "tesla-api";

    /// <summary>Surface category (the web devtools "client utilities" group).</summary>
    public const string Category = "devtools";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "TeslaApiRefTool";

    /// <summary>Persisted table id mirrored from the web <c>DataTable tableId="admin:tesla-api-ref"</c>.</summary>
    public const string TableId = "admin:tesla-api-ref";

    /// <summary>Segoe Fluent "Library" glyph — the house Segoe analogue of the web Lucide <c>BookOpen</c> icon.</summary>
    public const string IconGlyph = "\uE8F1";

    /// <summary>Accent name driving the icon chip (web <c>color: 'cyan'</c>); resolved by the shared ToolCard.</summary>
    public const string Accent = "cyan";

    /// <summary>Localized card title (web <c>t('Tesla Api Ref')</c>).</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("Tesla Api Ref", "Tesla Api Ref");
    }

    /// <summary>Localized card description (web <c>t('Tesla Api Ref Desc')</c>).</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("Tesla Api Ref Desc", "Tesla Api Ref Desc");
    }
}

/// <summary>
/// PII-safe diagnostics for the Tesla API reference surface (P1/S11 diagnostics contract). Records only
/// the operational <c>view.opened</c> event with the surface slug — never the search query or any row
/// content. Thread-safe.
/// </summary>
public sealed class TeslaApiRefToolDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public TeslaApiRefToolDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=TeslaApiRefTool</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={TeslaApiRefToolRegistration.Slug}");
    }
}
