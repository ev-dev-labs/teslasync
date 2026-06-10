using System.Globalization;
using System.Text;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The single render state of the <see cref="LegacyAlertsRedirect"/> surface. The web source
/// (web/src/features/notifications/components/LegacyAlertsRedirect.tsx) renders nothing but a
/// <c>&lt;Navigate to={to} replace /&gt;</c>: it resolves the destination <b>synchronously</b> from the
/// current location and redirects. There is therefore deliberately <b>no</b> loading / empty / error /
/// stale / offline branch — the surface performs no network read, so there is nothing to load, fail, go
/// stale, or fall offline. The native surface still has to render something (a WinUI control cannot render
/// "nothing" the way a React component returning <c>&lt;Navigate&gt;</c> can), so it shows a brief,
/// accessible <see cref="Redirecting"/> affordance while the host performs the navigation.
/// </summary>
public enum LegacyAlertsRedirectState
{
    /// <summary>The destination is resolved; the surface is handing off to the host to navigate (web <c>&lt;Navigate&gt;</c>).</summary>
    Redirecting,
}

/// <summary>
/// One decoded query-string pair — the native analogue of a single <c>URLSearchParams</c> entry the web
/// component reads, forwards or drops. <see cref="Name"/> and <see cref="Value"/> are already
/// percent/<c>+</c>-decoded (web <c>URLSearchParams</c> exposes decoded strings). Pure data — no WinUI
/// types — so the parser and serializer are unit-tested without a UI host.
/// </summary>
/// <param name="Name">The decoded parameter name (web <c>key</c>).</param>
/// <param name="Value">The decoded parameter value (web <c>value</c>), empty when the pair had no <c>=</c>.</param>
public sealed record LegacyQueryParameter(string Name, string Value);

/// <summary>
/// The resolved redirect destination — the native analogue of the web component's computed <c>to</c>
/// string. <see cref="Tab"/> is the legacy <c>?tab=</c> value that selected the route (defaulting to
/// <c>alerts</c>), <see cref="Path"/> is the new canonical route, and <see cref="Query"/> is the forwarded
/// query string (the original params minus <c>tab</c>, re-serialized). Pure data so the resolver is
/// unit-tested headlessly.
/// </summary>
/// <param name="Tab">The legacy tab key that selected the route (web <c>params.get('tab') ?? 'alerts'</c>).</param>
/// <param name="Path">The canonical destination route (web <c>TAB_TO_ROUTE[tab]</c>).</param>
/// <param name="Query">The forwarded query string without a leading <c>?</c> (web <c>params.toString()</c> after deleting <c>tab</c>).</param>
public sealed record LegacyAlertsRedirectTarget(string Tab, string Path, string Query)
{
    /// <summary>True when forwarded query parameters remain (web truthy <c>qs</c>).</summary>
    public bool HasQuery => Query.Length > 0;

    /// <summary>
    /// The full destination location — the web <c>to</c>: <see cref="Path"/> with <c>?</c><see cref="Query"/>
    /// appended only when query params remain (web <c>qs ? `${target}?${qs}` : target</c>).
    /// </summary>
    public string Location => HasQuery ? $"{Path}?{Query}" : Path;
}

/// <summary>
/// Pure, UI-free resolver that maps a legacy <c>/alerts</c> location to its new Notifications route — the
/// native port of web/src/features/notifications/components/LegacyAlertsRedirect.tsx. It reproduces the web
/// component verbatim: read the <c>?tab=</c> parameter (default <c>alerts</c>), translate it to the new
/// path via <see cref="RouteForTab"/>, then forward every <b>other</b> query parameter (filter, q, page,
/// severity, vehicle_id, rule_id, …) so deep links from external systems and saved dashboards keep working.
/// The <c>tab</c> parameter is dropped because it is now encoded in the path. Query parsing and
/// serialization follow the WHATWG <c>application/x-www-form-urlencoded</c> rules so the round-trip matches
/// the browser <c>URLSearchParams</c> the web component uses.
/// </summary>
public static class LegacyAlertsRedirectResolver
{
    /// <summary>New Alerts route (web <c>TAB_TO_ROUTE.alerts</c> and the fallback target).</summary>
    public const string AlertsRoute = "/notifications/alerts";

    /// <summary>New Inbox route the legacy <c>history</c> tab maps to (web <c>TAB_TO_ROUTE.history</c>).</summary>
    public const string InboxRoute = "/notifications/inbox";

    /// <summary>New Quiet Hours route the legacy <c>preferences</c> tab maps to (web <c>TAB_TO_ROUTE.preferences</c>).</summary>
    public const string QuietHoursRoute = "/notifications/quiet-hours";

    /// <summary>The default tab when <c>?tab=</c> is absent (web <c>params.get('tab') ?? 'alerts'</c>).</summary>
    public const string DefaultTab = "alerts";

    /// <summary>The legacy query parameter that selected a tab and is stripped from the forwarded query.</summary>
    public const string TabParameterName = "tab";

    // Web TAB_TO_ROUTE. Ordinal lookup: the tab token is a fixed ASCII identifier, never localized.
    private static readonly Dictionary<string, string> TabRoutes =
        new(StringComparer.Ordinal)
        {
            [DefaultTab] = AlertsRoute,
            ["history"] = InboxRoute,
            ["preferences"] = QuietHoursRoute,
        };

    /// <summary>
    /// The canonical route for a legacy <paramref name="tab"/> — web <c>TAB_TO_ROUTE[tab] ?? '/notifications/alerts'</c>.
    /// An unknown or null tab falls back to <see cref="AlertsRoute"/>.
    /// </summary>
    public static string RouteForTab(string? tab) =>
        tab is not null && TabRoutes.TryGetValue(tab, out var route) ? route : AlertsRoute;

    /// <summary>
    /// Resolve a legacy location's <paramref name="search"/> string (the web <c>location.search</c>, with or
    /// without a leading <c>?</c>) into its redirect <see cref="LegacyAlertsRedirectTarget"/>. Mirrors the web
    /// component step for step: read <c>tab</c> (default <c>alerts</c>), drop every <c>tab</c> entry, map the
    /// tab to the new path, and re-serialize the remaining parameters in their original order.
    /// </summary>
    public static LegacyAlertsRedirectTarget Resolve(string? search)
    {
        var parameters = ParseQuery(search);

        // web: params.get('tab') ?? 'alerts' — the FIRST tab value, or null when absent (note: an empty
        // value like "?tab=" is "", not null, so it does not fall back to the default).
        string? tabValue = null;
        foreach (var parameter in parameters)
        {
            if (string.Equals(parameter.Name, TabParameterName, StringComparison.Ordinal))
            {
                tabValue = parameter.Value;
                break;
            }
        }

        string tab = tabValue ?? DefaultTab;

        // web: params.delete('tab') — strip EVERY tab entry; it is now encoded in the path.
        var forwarded = new List<LegacyQueryParameter>(parameters.Count);
        foreach (var parameter in parameters)
        {
            if (!string.Equals(parameter.Name, TabParameterName, StringComparison.Ordinal))
            {
                forwarded.Add(parameter);
            }
        }

        return new LegacyAlertsRedirectTarget(tab, RouteForTab(tab), SerializeQuery(forwarded));
    }

    /// <summary>
    /// Parse a query <paramref name="search"/> string into ordered, decoded pairs — the native port of
    /// <c>new URLSearchParams(location.search)</c>. A single leading <c>?</c> is stripped; pairs split on
    /// <c>&amp;</c> then on the first <c>=</c>; an entry with no <c>=</c> yields an empty value; <c>+</c> and
    /// percent escapes are decoded. Order and duplicate keys are preserved (the web component relies on both).
    /// </summary>
    public static IReadOnlyList<LegacyQueryParameter> ParseQuery(string? search)
    {
        var result = new List<LegacyQueryParameter>();
        if (string.IsNullOrEmpty(search))
        {
            return result;
        }

        string body = search[0] == '?' ? search[1..] : search;
        if (body.Length == 0)
        {
            return result;
        }

        foreach (var token in body.Split('&'))
        {
            if (token.Length == 0)
            {
                continue;
            }

            int equals = token.IndexOf('=');
            string rawName = equals < 0 ? token : token[..equals];
            string rawValue = equals < 0 ? string.Empty : token[(equals + 1)..];
            result.Add(new LegacyQueryParameter(Decode(rawName), Decode(rawValue)));
        }

        return result;
    }

    /// <summary>
    /// Serialize ordered pairs back into a query string — the native port of <c>URLSearchParams.toString()</c>.
    /// Names and values are encoded with the WHATWG <c>application/x-www-form-urlencoded</c> serializer
    /// (space becomes <c>+</c>; only <c>* - . _</c> and ASCII alphanumerics pass through literally; everything
    /// else becomes upper-case <c>%XX</c>). Returns an empty string when <paramref name="parameters"/> is empty.
    /// </summary>
    public static string SerializeQuery(IEnumerable<LegacyQueryParameter> parameters)
    {
        ArgumentNullException.ThrowIfNull(parameters);

        var builder = new StringBuilder();
        foreach (var parameter in parameters)
        {
            if (builder.Length > 0)
            {
                builder.Append('&');
            }

            builder.Append(Encode(parameter.Name));
            builder.Append('=');
            builder.Append(Encode(parameter.Value));
        }

        return builder.ToString();
    }

    // application/x-www-form-urlencoded decode: '+' is a space, then percent escapes are UTF-8 decoded.
    private static string Decode(string component) =>
        Uri.UnescapeDataString(component.Replace('+', ' '));

    // application/x-www-form-urlencoded byte serializer (WHATWG URL Standard).
    private static string Encode(string component)
    {
        var bytes = Encoding.UTF8.GetBytes(component);
        var builder = new StringBuilder(bytes.Length);
        foreach (var b in bytes)
        {
            if (b == 0x20)
            {
                builder.Append('+');
            }
            else if (b == 0x2A || b == 0x2D || b == 0x2E || b == 0x5F
                || (b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x5A) || (b >= 0x61 && b <= 0x7A))
            {
                builder.Append((char)b);
            }
            else
            {
                builder.Append('%');
                builder.Append(((int)b).ToString("X2", CultureInfo.InvariantCulture));
            }
        }

        return builder.ToString();
    }
}

/// <summary>
/// Canonical metadata for the Legacy Alerts redirect surface. The web component is a routing-only element
/// (no nav-pane footprint), so this carries just the diagnostics slug emitted with the <c>view.opened</c>
/// event (P1/S11).
/// </summary>
public static class LegacyAlertsRedirectRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "LegacyAlertsRedirect";
}

/// <summary>
/// PII-safe diagnostics for the Legacy Alerts redirect surface (P1/S11 diagnostics contract). Records only
/// the operational <c>view.opened</c> event with the surface slug — never the location, query string or any
/// forwarded parameter, because the legacy query can carry user-identifying values (vehicle_id, rule_id,
/// free-text search). Thread-safe.
/// </summary>
public sealed class LegacyAlertsRedirectDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public LegacyAlertsRedirectDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=LegacyAlertsRedirect</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={LegacyAlertsRedirectRegistration.Slug}");
    }
}
