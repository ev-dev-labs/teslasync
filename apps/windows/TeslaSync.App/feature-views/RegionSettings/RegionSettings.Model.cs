using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Settings;

/// <summary>
/// Null-tolerant <see cref="JsonElement"/> readers for the Tesla region envelope. Every getter returns a
/// nullable / fallback rather than throwing so a partial or schema-drifted body from
/// <c>GET /tesla/user/region</c> never aborts the parse (web parity: <c>useTeslaUserRegion</c> tolerates
/// undefined fields and coalesces with the em-dash). Kept private to the surface and free of WinUI types so
/// the parse is unit-tested without a UI host.
/// </summary>
internal static class RegionSettingsJson
{
    /// <summary>The string value of <paramref name="name"/>, or null when absent / not a JSON string.</summary>
    public static string? GetString(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object
        && obj.TryGetProperty(name, out var prop)
        && prop.ValueKind == JsonValueKind.String
            ? prop.GetString()
            : null;

    /// <summary>The nested object property <paramref name="name"/>, or a default element when absent.</summary>
    public static JsonElement GetObject(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object
        && obj.TryGetProperty(name, out var prop)
        && prop.ValueKind == JsonValueKind.Object
            ? prop
            : default;

    /// <summary>Parse an ISO-8601 timestamp string to a UTC-normalised instant, or null when unparseable.</summary>
    public static DateTimeOffset? TryParseTimestamp(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            raw,
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var parsed)
            ? parsed
            : null;
    }
}

/// <summary>
/// One Tesla region configuration snapshot from <c>GET /tesla/user/region</c> — the native analogue of the web
/// <c>TeslaConfigEnvelope&lt;TeslaRegionData&gt;</c> (web/src/api/hooks/useUser.ts): the inner
/// <see cref="Region"/> + <see cref="FleetApiBaseUrl"/> (the envelope <c>data</c> object) and the envelope's
/// own <see cref="FetchedAt"/> sync time. Field names mirror the Go API's snake_case JSON tags; parsing is
/// null-tolerant so a partial body never throws. The raw <c>fetched_at</c> string is kept and parsed on demand
/// (web parity — the SPA passes it straight to <c>formatDateTime</c>). Pure data — unit-tested without a UI host.
/// </summary>
/// <param name="Region">The resolved Tesla account region code (web <c>data.region</c>), null when not yet known.</param>
/// <param name="FleetApiBaseUrl">The resolved Fleet API base URL (web <c>data.fleet_api_base_url</c>), nullable.</param>
/// <param name="FetchedAt">The raw envelope sync timestamp (web <c>fetched_at</c>), null when never synced.</param>
public sealed record RegionConfig(string? Region, string? FleetApiBaseUrl, string? FetchedAt)
{
    /// <summary>The "nothing known yet" snapshot used before the first successful read.</summary>
    public static readonly RegionConfig Empty = new(null, null, null);

    /// <summary>
    /// True when a non-empty region code is present — the web's <c>regionConfig?.data?.region</c> guard that
    /// selects the populated two-card layout over the empty surface.
    /// </summary>
    public bool HasRegion => !string.IsNullOrWhiteSpace(Region);

    /// <summary>True when the envelope carries a sync timestamp (web <c>regionConfig?.fetched_at</c> guard).</summary>
    public bool HasSyncTime => SyncedAt is not null;

    /// <summary>The parsed envelope sync instant, or null when absent / unparseable.</summary>
    public DateTimeOffset? SyncedAt => RegionSettingsJson.TryParseTimestamp(FetchedAt);

    /// <summary>
    /// Parse a region envelope. A non-object body (web parity: the query has no usable data) yields the
    /// <see cref="Empty"/> snapshot rather than throwing; a missing/garbled inner <c>data</c> object leaves the
    /// region/url null so the empty surface renders.
    /// </summary>
    public static RegionConfig FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        var data = RegionSettingsJson.GetObject(element, "data");
        string? region = data.ValueKind == JsonValueKind.Object ? RegionSettingsJson.GetString(data, "region") : null;
        string? url = data.ValueKind == JsonValueKind.Object
            ? RegionSettingsJson.GetString(data, "fleet_api_base_url")
            : null;
        string? fetchedAt = RegionSettingsJson.GetString(element, "fetched_at");
        return new RegionConfig(region, url, fetchedAt);
    }
}

/// <summary>
/// The top-level state the <c>RegionSettings</c> surface renders. Every value maps to a visible, non-collapsing
/// surface (no hidden panels): the panel header (icon, title, subtitle, refresh action) is always shown; the
/// value selects the body chrome. The web component renders only the populated (<see cref="Ready"/>) and the
/// <see cref="Empty"/> branches; the generic data states (<see cref="Loading"/> / <see cref="Error"/> /
/// <see cref="Stale"/> / <see cref="Offline"/>) are the native cache-then-network read's surfaces, reproduced
/// in full so a region never blanks out while loading, after a hard failure, or while showing cached data.
/// </summary>
public enum RegionSettingsSurfaceState
{
    /// <summary>The first region read is in flight and no cached value exists yet (skeleton chrome).</summary>
    Loading,

    /// <summary>A region is known — the populated two-card layout is shown.</summary>
    Ready,

    /// <summary>The read resolved with no region — the friendly "click Refresh" empty surface is shown.</summary>
    Empty,

    /// <summary>A hard failure (the read failed with no cache to fall back to) — an inline retry is shown.</summary>
    Error,

    /// <summary>A cached region is shown but is past the freshness window (still rendered, with a stale chip).</summary>
    Stale,

    /// <summary>The network is unreachable; a cached region (if any) is shown with an offline chip.</summary>
    Offline,
}

/// <summary>
/// The outcome of a "Refresh" mutation (<c>POST /tesla/user/region/refresh</c>) — the native analogue of the
/// web <c>useRefreshTeslaRegion</c> mutation result. On success the surface re-reads the region (web
/// <c>invalidateQueries</c> → refetch) and announces the success toast; on failure it carries the privacy-safe
/// <see cref="RepositoryError"/> for the failure toast. It never throws for an HTTP fault (web parity: the
/// mutation resolves to a toast, not an unhandled rejection).
/// </summary>
public sealed record RegionRefreshOutcome(bool Success, RepositoryError? Error)
{
    /// <summary>A successful refresh.</summary>
    public static RegionRefreshOutcome Ok() => new(true, null);

    /// <summary>A failed refresh carrying the classified error.</summary>
    public static RegionRefreshOutcome Fail(RepositoryError error) => new(false, error);
}

/// <summary>The kind of transient post-refresh notice (the native analogue of the web toast severity).</summary>
public enum RegionRefreshNoticeKind
{
    /// <summary>The refresh succeeded (web <c>toast.success</c>).</summary>
    Success,

    /// <summary>The refresh failed (web <c>toast.error</c>).</summary>
    Error,
}

/// <summary>
/// A transient post-refresh notice — the native analogue of the web in-app toast the component raises from the
/// mutation's <c>onSuccess</c> / <c>onError</c> callbacks. The view renders it as an assertive live-region line
/// (announced to Narrator) using the same <c>toast.region*</c> i18n keys, the desktop-idiomatic equivalent of a
/// transient toast. Pure data — unit-tested without a UI host.
/// </summary>
/// <param name="Kind">The notice severity (success / error).</param>
/// <param name="Message">The resolved, localized notice text.</param>
public sealed record RegionRefreshNotice(RegionRefreshNoticeKind Kind, string Message);

/// <summary>
/// Maps a raw <see cref="RepositoryResult{T}"/> of the region JSON envelope onto a typed
/// <see cref="RegionConfig"/> result, preserving the load status, fetch time, stale flag and the
/// <see cref="RepositoryError"/>. Pure — unit-tested without a UI host. The native analogue of the
/// pass-through the web <c>useQuery</c> does between the raw response and the component.
/// </summary>
public static class RegionResultMapper
{
    /// <summary>Project one raw region emission into a typed config result.</summary>
    public static RepositoryResult<RegionConfig> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<RegionConfig>.Loading(),
            LoadStatus.Empty => RepositoryResult<RegionConfig>.Empty(raw.FetchedAt),
            LoadStatus.Error => RepositoryResult<RegionConfig>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
            LoadStatus.Cached => RepositoryResult<RegionConfig>.Cached(
                Config(raw), raw.FetchedAt ?? default, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<RegionConfig>.Refreshing(
                Config(raw), raw.FetchedAt ?? default, raw.IsStale),
            LoadStatus.Offline => RepositoryResult<RegionConfig>.OfflineCached(
                Config(raw),
                raw.FetchedAt ?? default,
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Network, "Offline")),
            _ => RepositoryResult<RegionConfig>.Loaded(Config(raw), raw.FetchedAt ?? default),
        };
    }

    private static RegionConfig Config(RepositoryResult<JsonElement> raw) =>
        raw.HasValue ? RegionConfig.FromJson(raw.Value) : RegionConfig.Empty;
}

/// <summary>
/// Canonical registry metadata for the region-settings surface — the native mirror of the web settings
/// component (web/src/features/settings/components/RegionSettings.tsx). Centralises the stable id, the
/// diagnostics slug and every localized string, keyed exactly as the web <c>t(...)</c> calls (with the
/// <c>translation.</c> catalog prefix the WinUI resource bridge expects, the same convention the shipped
/// AIFeatureToggleList / UserImpersonateButton surfaces use) and the same English fallbacks, so the view and
/// view-model stay free of literal copy. Every fallback equals its <c>Strings/en/Resources.resw</c> value so a
/// headless <see cref="PassthroughLocalizer"/> renders identically to the app's resource bridge. UI-free so it
/// is asserted in tests without a XAML host.
/// </summary>
public static class RegionSettingsRegistration
{
    /// <summary>Stable surface id (web component name, kebab-cased).</summary>
    public const string Id = "region-settings";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "RegionSettings";

    /// <summary>Panel title (web <c>region.title</c>).</summary>
    public static string Title(ILocalizer localizer) =>
        Require(localizer).GetString("translation.region.title", "Region & API");

    /// <summary>Panel subtitle (web <c>region.subtitle</c>).</summary>
    public static string Subtitle(ILocalizer localizer) =>
        Require(localizer).GetString("translation.region.subtitle", "Tesla account region and Fleet API endpoint");

    /// <summary>"Synced" sync-time prefix (web <c>region.lastSynced</c>).</summary>
    public static string LastSynced(ILocalizer localizer) =>
        Require(localizer).GetString("translation.region.lastSynced", "Synced");

    /// <summary>Refresh button label (web <c>region.refresh</c>).</summary>
    public static string Refresh(ILocalizer localizer) =>
        Require(localizer).GetString("translation.region.refresh", "Refresh");

    /// <summary>"Region" card label (web <c>region.regionCode</c>).</summary>
    public static string RegionCode(ILocalizer localizer) =>
        Require(localizer).GetString("translation.region.regionCode", "Region");

    /// <summary>"Fleet API Base URL" card label (web <c>region.fleetApiUrl</c>).</summary>
    public static string FleetApiUrl(ILocalizer localizer) =>
        Require(localizer).GetString("translation.region.fleetApiUrl", "Fleet API Base URL");

    /// <summary>Empty-surface message (web <c>region.noData</c>).</summary>
    public static string NoData(ILocalizer localizer) =>
        Require(localizer).GetString(
            "translation.region.noData",
            "No region data yet. Click Refresh to fetch from Tesla.");

    /// <summary>Success toast copy after a refresh (web <c>toast.regionRefreshed</c>).</summary>
    public static string RefreshSucceeded(ILocalizer localizer) =>
        Require(localizer).GetString("translation.toast.regionRefreshed", "Region info refreshed");

    /// <summary>Failure toast copy after a refresh (web <c>toast.regionFailed</c>).</summary>
    public static string RefreshFailed(ILocalizer localizer) =>
        Require(localizer).GetString("translation.toast.regionFailed", "Failed to refresh region");

    /// <summary>Loading-chip caption while the first read is in flight (shared <c>common.loading</c>).</summary>
    public static string Loading(ILocalizer localizer) =>
        Require(localizer).GetString("translation.common.loading", "Loading...");

    /// <summary>Offline-chip caption when the network is unreachable (shared <c>common.offline</c>).</summary>
    public static string Offline(ILocalizer localizer) =>
        Require(localizer).GetString("translation.common.offline", "Offline");

    /// <summary>Retry affordance label for the error surface (shared <c>common.retry</c>).</summary>
    public static string Retry(ILocalizer localizer) =>
        Require(localizer).GetString("translation.common.retry", "Retry");

    /// <summary>Hard-failure message for the error surface (shared <c>error.loadFailed</c>).</summary>
    public static string LoadFailed(ILocalizer localizer) =>
        Require(localizer).GetString("translation.error.loadFailed", "Failed to load data");

    private static ILocalizer Require(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer;
    }
}

/// <summary>
/// PII-safe diagnostics for the region-settings surface (P1/S11 diagnostics contract). Records only the
/// operational counters with the surface slug — never the region code, the Fleet API URL or any account
/// detail — so a diagnostics line can never leak a user's Tesla account topology. Thread-safe.
/// </summary>
public sealed class RegionSettingsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;
    private long _refreshesRequested;
    private long _refreshesSucceeded;
    private long _refreshesFailed;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public RegionSettingsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Number of refresh actions requested.</summary>
    public long RefreshesRequested => Interlocked.Read(ref _refreshesRequested);

    /// <summary>Number of refresh actions that succeeded.</summary>
    public long RefreshesSucceeded => Interlocked.Read(ref _refreshesSucceeded);

    /// <summary>Number of refresh actions that failed.</summary>
    public long RefreshesFailed => Interlocked.Read(ref _refreshesFailed);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=RegionSettings</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={RegionSettingsRegistration.Slug}");
    }

    /// <summary>Record that a refresh was requested (no account detail is ever logged).</summary>
    public void RecordRefreshRequested()
    {
        Interlocked.Increment(ref _refreshesRequested);
        _sink?.Invoke($"region.refresh.requested slug={RegionSettingsRegistration.Slug}");
    }

    /// <summary>Record the resolution of a refresh (success/failure only — never account detail).</summary>
    public void RecordRefreshResolved(bool success)
    {
        if (success)
        {
            Interlocked.Increment(ref _refreshesSucceeded);
        }
        else
        {
            Interlocked.Increment(ref _refreshesFailed);
        }

        _sink?.Invoke(
            $"region.refresh.resolved slug={RegionSettingsRegistration.Slug} success={(success ? "true" : "false")}");
    }
}
