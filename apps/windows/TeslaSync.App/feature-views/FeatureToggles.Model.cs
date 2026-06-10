using System.Globalization;
using System.Text.Encodings.Web;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Settings;

/// <summary>
/// Null-tolerant <see cref="JsonElement"/> helpers for the feature-toggles surface — the native analogue of
/// the loose <c>Record&lt;string, unknown&gt;</c> reads the web component performs over the Tesla feature
/// config (web/src/features/settings/components/FeatureToggles.tsx). Every helper tolerates a missing or
/// schema-drifted field rather than throwing, and reproduces the web JavaScript truthiness / <c>JSON.stringify</c>
/// rules exactly so the projection is unit-tested without a UI host.
/// </summary>
internal static class FeatureTogglesJson
{
    private static readonly JsonSerializerOptions CompactJson = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    /// <summary>The string value of <paramref name="name"/>, or null when absent / not a JSON string.</summary>
    public static string? GetString(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object
        && obj.TryGetProperty(name, out var prop)
        && prop.ValueKind == JsonValueKind.String
            ? prop.GetString()
            : null;

    /// <summary>
    /// JavaScript truthiness for a JSON value — the native port of the web <c>Boolean(enabled)</c>. Mirrors
    /// JS semantics exactly: <c>null</c>/undefined/false/empty-string/zero are falsy; every non-empty string,
    /// non-zero number, object and array is truthy.
    /// </summary>
    public static bool IsTruthy(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.Undefined => false,
        JsonValueKind.Null => false,
        JsonValueKind.False => false,
        JsonValueKind.True => true,
        JsonValueKind.String => value.GetString() is { Length: > 0 },
        JsonValueKind.Number => value.TryGetDouble(out var n) && n != 0,
        JsonValueKind.Object => true,
        JsonValueKind.Array => true,
        _ => false,
    };

    /// <summary>Compact JSON serialization of a value — the native port of the web <c>JSON.stringify(v)</c>.</summary>
    public static string Stringify(JsonElement value) => JsonSerializer.Serialize(value, CompactJson);

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
/// One projected feature-flag entry — the native analogue of an element of the web <c>featureEntries</c> memo
/// (web/src/features/settings/components/FeatureToggles.tsx). <see cref="Enabled"/> reproduces
/// <c>Boolean(isObj ? value.enabled : value)</c> and <see cref="Details"/> reproduces the web
/// <c>isObj ? Object.entries(value).filter(k !== 'enabled').map('k: ' + JSON.stringify(v)).join(', ') : null</c>
/// (null for a scalar value, a possibly-empty join for an object). Pure data — no WinUI types.
/// </summary>
public sealed record FeatureToggleEntry(string Key, bool Enabled, string? Details)
{
    /// <summary>Em-dash fallback for a scalar value's (null) detail cell (web <c>details ?? '\u2014'</c>).</summary>
    public const string EmDash = "\u2014";

    /// <summary>The display detail text — the raw join when present, otherwise the em-dash (web <c>?? '\u2014'</c>).</summary>
    public string DetailsText => Details ?? EmDash;

    /// <summary>
    /// Build an entry from a feature key and its raw JSON value, reproducing the web map exactly: an object
    /// value reads its <c>enabled</c> member (absent =&gt; falsy) and folds its remaining members into the
    /// detail string; a scalar value is itself the enabled flag and carries no detail.
    /// </summary>
    public static FeatureToggleEntry FromValue(string key, JsonElement value)
    {
        bool isObject = value.ValueKind == JsonValueKind.Object;
        JsonElement enabledElement = isObject
            ? value.TryGetProperty("enabled", out var enabledProp) ? enabledProp : default
            : value;

        bool enabled = FeatureTogglesJson.IsTruthy(enabledElement);
        string? details = isObject ? BuildDetails(value) : null;
        return new FeatureToggleEntry(key, enabled, details);
    }

    private static string BuildDetails(JsonElement obj)
    {
        var parts = new List<string>();
        foreach (var prop in obj.EnumerateObject())
        {
            if (string.Equals(prop.Name, "enabled", StringComparison.Ordinal))
            {
                continue;
            }

            parts.Add(string.Concat(prop.Name, ": ", FeatureTogglesJson.Stringify(prop.Value)));
        }

        return string.Join(", ", parts);
    }
}

/// <summary>
/// The parsed Tesla feature-config envelope — the native analogue of the web <c>TeslaConfigEnvelope</c>
/// (<c>{ data: Record&lt;string, unknown&gt;, fetched_at: string | null }</c>) returned by
/// <c>GET /tesla/user/feature-config</c>. Holds the server-stamped <see cref="FetchedAt"/> (rendered in the
/// "Synced {when}" caption) and the ordered <see cref="Entries"/>. Parsing is null-tolerant so a partial or
/// non-object body never throws. Pure data — unit-tested without a UI host.
/// </summary>
public sealed record FeatureConfigSnapshot(string? FetchedAt, IReadOnlyList<FeatureToggleEntry> Entries)
{
    /// <summary>An empty snapshot (no entries) — the parse / projection fallback.</summary>
    public static FeatureConfigSnapshot Empty { get; } = new(null, Array.Empty<FeatureToggleEntry>());

    /// <summary>The parsed server fetch instant, or null when absent / unparseable.</summary>
    public DateTimeOffset? FetchedAtInstant => FeatureTogglesJson.TryParseTimestamp(FetchedAt);

    /// <summary>Parse the feature-config envelope object into a tolerant snapshot.</summary>
    public static FeatureConfigSnapshot FromJson(JsonElement envelope)
    {
        if (envelope.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        string? fetchedAt = FeatureTogglesJson.GetString(envelope, "fetched_at");

        var entries = new List<FeatureToggleEntry>();
        if (envelope.TryGetProperty("data", out var data) && data.ValueKind == JsonValueKind.Object)
        {
            foreach (var prop in data.EnumerateObject())
            {
                entries.Add(FeatureToggleEntry.FromValue(prop.Name, prop.Value));
            }
        }

        return new FeatureConfigSnapshot(fetchedAt, entries);
    }
}

/// <summary>
/// The lifecycle state the feature-toggles surface can be in. Every branch maps onto a visible surface — none
/// is ever hidden (engineering rule #6). The web shows <c>table | empty text</c>; the native surface
/// additionally renders explicit <c>loading</c>, <c>error</c> (retry), <c>stale</c> and <c>offline</c>
/// branches — a strict superset of the web that satisfies the prompt's mandated state set.
/// </summary>
public enum FeatureTogglesState
{
    /// <summary>First fetch with nothing cached — render the skeleton table.</summary>
    Loading,

    /// <summary>A fresh (network or non-stale cache) result with entries to show.</summary>
    Loaded,

    /// <summary>The read resolved with no entries — the friendly empty text.</summary>
    Empty,

    /// <summary>The read failed and no cached entries exist — the retry affordance.</summary>
    Error,

    /// <summary>A cached result older than the freshness window — entries plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but cached entries remain — entries plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// One projected, render-ready table row — the native analogue of a <c>featureEntries.map</c> row in
/// web/src/features/settings/components/FeatureToggles.tsx. Holds the feature key, the localized
/// Enabled/Disabled status label and its token <see cref="StatusKind"/> (web <c>Badge variant</c>
/// success/neutral), the detail cell text and a Narrator name. Pure data so the projection is asserted
/// headlessly.
/// </summary>
public sealed record FeatureToggleRowDisplay(
    string Key,
    string KeyText,
    bool Enabled,
    string StatusLabel,
    StatusKind StatusKind,
    string DetailsText,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the table — the native analogue of the
/// <c>featureEntries.length &gt; 0 ? table : EmptyState</c> gate in
/// web/src/features/settings/components/FeatureToggles.tsx. <see cref="HasRows"/> reproduces the web length
/// check; the three localized column headers mirror the web <c>Feature</c> / <c>Status</c> / <c>Details</c>
/// columns. Pure data so every branch is asserted without a UI host.
/// </summary>
public sealed record FeatureTogglesDisplay(
    bool HasRows,
    IReadOnlyList<FeatureToggleRowDisplay> Rows,
    string FeatureHeader,
    string StatusHeader,
    string DetailsHeader)
{
    /// <summary>An empty display (no rows) — the projection fallback.</summary>
    public static FeatureTogglesDisplay Empty { get; } =
        new(false, Array.Empty<FeatureToggleRowDisplay>(), "Feature", "Status", "Details");
}

/// <summary>
/// Pure projection from the parsed entries to the render-ready table model — the native port of the
/// <c>featureEntries.map</c> render (the Enabled/Disabled badge label, the detail cell and the column
/// headers) plus the "Synced {when}" caption in web/src/features/settings/components/FeatureToggles.tsx.
/// Every label resolves through the i18n facade and <c>now</c> is injected so the caption is unit-tested
/// deterministically. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class FeatureTogglesProjection
{
    /// <summary>i18n key for the feature column header (web <c>featureConfig.feature</c>).</summary>
    public const string FeatureHeaderKey = "translation.featureConfig.feature";

    /// <summary>i18n key for the status column header (web <c>featureConfig.status</c>).</summary>
    public const string StatusHeaderKey = "translation.featureConfig.status";

    /// <summary>i18n key for the details column header (web <c>featureConfig.details</c>).</summary>
    public const string DetailsHeaderKey = "translation.featureConfig.details";

    /// <summary>i18n key for the enabled badge label (web <c>featureConfig.enabled</c>).</summary>
    public const string EnabledKey = "translation.featureConfig.enabled";

    /// <summary>i18n key for the disabled badge label (web <c>featureConfig.disabled</c>).</summary>
    public const string DisabledKey = "translation.featureConfig.disabled";

    /// <summary>i18n key for the "Synced" caption prefix (web <c>featureConfig.lastSynced</c>).</summary>
    public const string LastSyncedKey = "translation.featureConfig.lastSynced";

    /// <summary>Project the entry list into a render-ready table display using the i18n facade.</summary>
    public static FeatureTogglesDisplay Project(IReadOnlyList<FeatureToggleEntry> entries, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(entries);
        ArgumentNullException.ThrowIfNull(localizer);

        string featureHeader = localizer.GetString(FeatureHeaderKey, "Feature");
        string statusHeader = localizer.GetString(StatusHeaderKey, "Status");
        string detailsHeader = localizer.GetString(DetailsHeaderKey, "Details");
        string enabledLabel = localizer.GetString(EnabledKey, "Enabled");
        string disabledLabel = localizer.GetString(DisabledKey, "Disabled");

        var rows = new List<FeatureToggleRowDisplay>(entries.Count);
        foreach (var entry in entries)
        {
            string keyText = string.IsNullOrEmpty(entry.Key) ? FeatureToggleEntry.EmDash : entry.Key;
            string statusLabel = entry.Enabled ? enabledLabel : disabledLabel;
            StatusKind statusKind = entry.Enabled ? StatusKind.Success : StatusKind.Neutral;
            string detailsText = entry.DetailsText;

            string automationName = string.IsNullOrEmpty(entry.Details)
                ? string.Concat(keyText, ". ", statusLabel)
                : string.Concat(keyText, ". ", statusLabel, ". ", detailsText);

            rows.Add(new FeatureToggleRowDisplay(
                entry.Key,
                keyText,
                entry.Enabled,
                statusLabel,
                statusKind,
                detailsText,
                automationName));
        }

        return new FeatureTogglesDisplay(rows.Count > 0, rows, featureHeader, statusHeader, detailsHeader);
    }

    /// <summary>
    /// The "Synced {when}" caption — the native port of
    /// <c>{t('featureConfig.lastSynced')} {formatDateTime(fetched_at)}</c>. Returns null when no server fetch
    /// time is known (web parity: the caption is only rendered when <c>fetched_at</c> is present).
    /// </summary>
    public static string? LastSyncedLabel(DateTimeOffset? fetchedAt, ILocalizer localizer, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        if (fetchedAt is not { } instant)
        {
            return null;
        }

        string prefix = localizer.GetString(LastSyncedKey, "Synced");
        string formatted = DateTimeFormatting.Format(instant, DateTimeVariant.Full, now);
        return string.Concat(prefix, " ", formatted);
    }
}

/// <summary>
/// Maps a raw <c>GET /tesla/user/feature-config</c> emission (<c>RepositoryResult&lt;JsonElement&gt;</c>) to a
/// typed <c>RepositoryResult&lt;FeatureConfigSnapshot&gt;</c>, preserving the cache-then-network
/// status/freshness while parsing the snake_case envelope (the native analogue of the web hook's typed query
/// result). A value-bearing status always carries the parsed snapshot — even when its <c>data</c> object is
/// empty — so the header's "Synced {when}" caption survives an empty-config response, exactly as the web
/// header does; the body's empty state is derived downstream from the entry count, not from a lost payload.
/// Pure — unit-tested without a network or cache.
/// </summary>
public static class FeatureTogglesResultMapper
{
    /// <summary>Map a raw feature-config emission to a typed snapshot result.</summary>
    public static RepositoryResult<FeatureConfigSnapshot> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        switch (raw.Status)
        {
            case LoadStatus.Loading:
                return RepositoryResult<FeatureConfigSnapshot>.Loading();

            case LoadStatus.Empty:
                return RepositoryResult<FeatureConfigSnapshot>.Empty(raw.FetchedAt);

            case LoadStatus.Error:
                return RepositoryResult<FeatureConfigSnapshot>.Failure(
                    raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error"));
        }

        var snapshot = FeatureConfigSnapshot.FromJson(raw.Value);
        var fetchedAt = raw.FetchedAt ?? DateTimeOffset.UtcNow;

        return raw.Status switch
        {
            LoadStatus.Cached => RepositoryResult<FeatureConfigSnapshot>.Cached(snapshot, fetchedAt, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<FeatureConfigSnapshot>.Refreshing(snapshot, fetchedAt, raw.IsStale),
            LoadStatus.Offline => RepositoryResult<FeatureConfigSnapshot>.OfflineCached(
                snapshot, fetchedAt, raw.Error ?? new RepositoryError(RepositoryErrorKind.Network, "Offline")),
            _ => RepositoryResult<FeatureConfigSnapshot>.Loaded(snapshot, fetchedAt),
        };
    }
}

/// <summary>The severity of a feature-toggles toast — the native analogue of the web <c>toast.success</c> /
/// <c>toast.error</c> call sites in the refresh mutation.</summary>
public enum FeatureToggleToastKind
{
    /// <summary>The refresh succeeded (web <c>toast.success</c>).</summary>
    Success,

    /// <summary>The refresh failed (web <c>toast.error</c>).</summary>
    Error,
}

/// <summary>
/// A refresh-mutation toast request — the native analogue of the web
/// <c>toast.success(t('toast.featureConfigRefreshed'))</c> / <c>toast.error(t('toast.featureConfigFailed'),
/// err.message)</c> calls. The view-model raises it; the view forwards it to the host toast sink and announces
/// it for accessibility. Pure data so the localized payload is asserted headlessly.
/// </summary>
public sealed record FeatureToggleToast(FeatureToggleToastKind Kind, string Title, string? Description)
{
    /// <summary>i18n key for the success toast title (web <c>toast.featureConfigRefreshed</c>).</summary>
    public const string SuccessKey = "translation.toast.featureConfigRefreshed";

    /// <summary>i18n key for the failure toast title (web <c>toast.featureConfigFailed</c>).</summary>
    public const string FailureKey = "translation.toast.featureConfigFailed";

    /// <summary>Build the success toast (web <c>toast.success(t('toast.featureConfigRefreshed'))</c>).</summary>
    public static FeatureToggleToast Success(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return new FeatureToggleToast(
            FeatureToggleToastKind.Success,
            localizer.GetString(SuccessKey, "Feature config refreshed"),
            null);
    }

    /// <summary>
    /// Build the failure toast (web <c>toast.error(t('toast.featureConfigFailed'), err.message)</c>), carrying
    /// the privacy-safe repository error message as the description when one is available.
    /// </summary>
    public static FeatureToggleToast Failure(ILocalizer localizer, RepositoryError? error)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return new FeatureToggleToast(
            FeatureToggleToastKind.Error,
            localizer.GetString(FailureKey, "Failed to refresh feature config"),
            error?.Message);
    }
}

/// <summary>
/// The outcome of the feature-config refresh mutation — the native analogue of the web
/// <c>useRefreshTeslaFeatureConfig</c> mutation result. <see cref="Succeeded"/> drives the success-toast +
/// refetch vs. the error-toast branch; <see cref="Error"/> carries the classified failure for the toast
/// description. Pure data.
/// </summary>
public sealed record FeatureConfigRefreshOutcome(bool Succeeded, RepositoryError? Error)
{
    /// <summary>A successful refresh (web mutation <c>onSuccess</c>).</summary>
    public static FeatureConfigRefreshOutcome Success() => new(true, null);

    /// <summary>A failed refresh carrying the classified error (web mutation <c>onError</c>).</summary>
    public static FeatureConfigRefreshOutcome Failure(RepositoryError error) => new(false, error);
}

/// <summary>
/// Canonical registry metadata for the feature-toggles surface — the native mirror of the web settings
/// component (web/src/features/settings/components/FeatureToggles.tsx). Centralises the stable id, the
/// diagnostics slug, and the localized title/subtitle so the view and view-model stay free of literal copy.
/// </summary>
public static class FeatureTogglesRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "feature-toggles";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "FeatureToggles";

    /// <summary>i18n key for the panel title (web <c>featureConfig.title</c>).</summary>
    public const string TitleKey = "translation.featureConfig.title";

    /// <summary>i18n key for the panel subtitle (web <c>featureConfig.subtitle</c>).</summary>
    public const string SubtitleKey = "translation.featureConfig.subtitle";

    /// <summary>Localized panel title (web <c>featureConfig.title</c>).</summary>
    public static string Title(ILocalizer localizer) =>
        Require(localizer).GetString(TitleKey, "Feature Flags");

    /// <summary>Localized panel subtitle (web <c>featureConfig.subtitle</c>).</summary>
    public static string Subtitle(ILocalizer localizer) =>
        Require(localizer).GetString(SubtitleKey, "Tesla account feature configuration");

    private static ILocalizer Require(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer;
    }
}

/// <summary>
/// PII-safe diagnostics for the feature-toggles surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a feature key, value or detail — so a
/// diagnostics line can never leak which Tesla feature flags an operator inspected. Thread-safe.
/// </summary>
public sealed class FeatureTogglesDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public FeatureTogglesDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=FeatureToggles</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={FeatureTogglesRegistration.Slug}");
    }
}
