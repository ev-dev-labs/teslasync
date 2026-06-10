using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// Null-tolerant <see cref="JsonElement"/> readers for the geocode-search payload behind the
/// <c>AddressInput</c> surface. Every getter returns a nullable / fallback rather than throwing so a partial
/// or schema-drifted row from <c>GET /geocode/search</c> never aborts the parse (web parity: the React
/// component reads <c>r.display_name</c> / <c>r.lat</c> / <c>r.lng</c> off a tolerant
/// <c>safeArray(results)</c>). Kept private to the surface and free of WinUI types so the parse is unit-tested
/// without a UI host.
/// </summary>
internal static class AddressInputJson
{
    /// <summary>The string value of <paramref name="name"/>, or null when absent / not a JSON string.</summary>
    public static string? GetString(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object
        && obj.TryGetProperty(name, out var prop)
        && prop.ValueKind == JsonValueKind.String
            ? prop.GetString()
            : null;

    /// <summary>The double value of <paramref name="name"/>, tolerating a numeric or numeric-string field.</summary>
    public static double? GetDouble(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var prop))
        {
            return null;
        }

        return prop.ValueKind switch
        {
            JsonValueKind.Number when prop.TryGetDouble(out var n) => n,
            JsonValueKind.String when double.TryParse(
                prop.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var s) => s,
            _ => null,
        };
    }
}

/// <summary>
/// One resolved geocode suggestion — the native analogue of the web <c>GeocodeResult</c>
/// (<c>display_name</c> / <c>lat</c> / <c>lng</c>). Field names mirror the Go API's snake_case JSON tags;
/// parsing is null-tolerant so a partial row never throws. Pure data — no WinUI types — so the projection is
/// unit-tested without a UI host.
/// </summary>
/// <param name="DisplayName">The human-readable address label (web <c>display_name</c>).</param>
/// <param name="Lat">Latitude in degrees (web <c>lat</c>).</param>
/// <param name="Lng">Longitude in degrees (web <c>lng</c>).</param>
public sealed record GeocodeSuggestion(string DisplayName, double Lat, double Lng)
{
    /// <summary>
    /// The stable option identity (web <c>getOptionKey = `${r.lat}-${r.lng}-${r.display_name}`</c>) used to
    /// de-duplicate suggestions and key the rendered rows.
    /// </summary>
    public string OptionKey => string.Create(
        CultureInfo.InvariantCulture, $"{Lat}-{Lng}-{DisplayName}");

    /// <summary>Project one geocode JSON object into a suggestion, or null when it carries no usable label.</summary>
    public static GeocodeSuggestion? FromJson(JsonElement obj)
    {
        if (obj.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        string label = AddressInputJson.GetString(obj, "display_name")?.Trim() ?? string.Empty;
        if (label.Length == 0)
        {
            return null;
        }

        return new GeocodeSuggestion(
            label,
            AddressInputJson.GetDouble(obj, "lat") ?? 0,
            AddressInputJson.GetDouble(obj, "lng") ?? 0);
    }
}

/// <summary>
/// Array helpers for the geocode-search response — the native analogue of the web hook's <c>safeArray</c>
/// <c>select</c>. Tolerates a non-array body (yields an empty list, never throws) so a schema-drifted response
/// degrades to "no matches" rather than crashing the input. Pure data — unit-tested headlessly.
/// </summary>
public static class GeocodeSuggestions
{
    /// <summary>Project a geocode-search JSON array into the ordered, label-bearing suggestions it carries.</summary>
    public static IReadOnlyList<GeocodeSuggestion> FromJsonArray(JsonElement array)
    {
        if (array.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<GeocodeSuggestion>();
        }

        var list = new List<GeocodeSuggestion>(array.GetArrayLength());
        foreach (var element in array.EnumerateArray())
        {
            if (GeocodeSuggestion.FromJson(element) is { } suggestion)
            {
                list.Add(suggestion);
            }
        }

        return list;
    }

    /// <summary>True when <paramref name="response"/> carries no suggestions (non-array or empty array).</summary>
    public static bool IsEmpty(JsonElement response) =>
        response.ValueKind != JsonValueKind.Array || response.GetArrayLength() == 0;
}

/// <summary>
/// A place chosen from the suggestions — the native analogue of the web <c>TripLocation</c>
/// (<c>{ lat, lng, name }</c>) the component hands to <c>onSelect</c>. Pure data — no WinUI types.
/// </summary>
/// <param name="Lat">Latitude in degrees (web <c>lat</c>).</param>
/// <param name="Lng">Longitude in degrees (web <c>lng</c>).</param>
/// <param name="Name">The resolved place label (web <c>name</c> = the suggestion's <c>display_name</c>).</param>
public sealed record AddressSelection(double Lat, double Lng, string Name);

/// <summary>
/// The mutually-exclusive surface state the <c>AddressInput</c> autocomplete can be in. The web component is a
/// thin wrapper over the shared <c>Combobox</c>, whose own render covers the resting field, the in-flight
/// <c>loading</c> spinner and the suggestion list; this self-contained native surface renders every one
/// explicitly — plus the <see cref="Empty"/> (no matches), <see cref="Stale"/>, <see cref="Offline"/> and
/// <see cref="Error"/> (retry) branches the cache-then-network data layer can produce — so no state is ever a
/// hidden surface (engineering rule #6).
/// </summary>
public enum AddressInputState
{
    /// <summary>Resting: the query is shorter than the minimum, so no search runs (web hook <c>enabled:false</c>).</summary>
    Idle,

    /// <summary>A first search is in flight with nothing cached yet — the spinner shows.</summary>
    Loading,

    /// <summary>Suggestions are available to choose from.</summary>
    Ready,

    /// <summary>The search resolved with no matching addresses — a friendly "no matches" note.</summary>
    Empty,

    /// <summary>Cached suggestions older than the freshness window — shown with a stale chip while refreshing.</summary>
    Stale,

    /// <summary>The network failed but cached suggestions remain — shown with an offline chip.</summary>
    Offline,

    /// <summary>The search failed with nothing cached — an inline error with a retry affordance.</summary>
    Error,
}

/// <summary>
/// Pure projection helpers for the <c>AddressInput</c> surface — the native port of the web component's
/// <c>Combobox</c> wiring (<c>getOptionLabel</c> / <c>getOptionKey</c> and the <c>debouncedQuery.length &gt;= 3</c>
/// gate). No WinUI types — unit-tested without a UI host.
/// </summary>
public static class AddressInputProjection
{
    /// <summary>The label rendered for a suggestion row (web <c>getOptionLabel = (r) =&gt; r.display_name</c>).</summary>
    public static string OptionLabel(GeocodeSuggestion suggestion)
    {
        ArgumentNullException.ThrowIfNull(suggestion);
        return suggestion.DisplayName;
    }

    /// <summary>The stable key for a suggestion row (web <c>getOptionKey</c>).</summary>
    public static string OptionKey(GeocodeSuggestion suggestion)
    {
        ArgumentNullException.ThrowIfNull(suggestion);
        return suggestion.OptionKey;
    }

    /// <summary>
    /// True once <paramref name="query"/> is long enough to search (web <c>debouncedQuery.length &gt;= 3</c>;
    /// trimmed here so a whitespace-only query never hits the geocoder).
    /// </summary>
    public static bool MeetsMinLength(string? query) =>
        (query?.Trim().Length ?? 0) >= AddressInputRegistration.MinQueryLength;
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions to typed
/// <c>RepositoryResult&lt;IReadOnlyList&lt;GeocodeSuggestion&gt;&gt;</c>, preserving the cache-then-network
/// status / freshness while parsing the snake_case array (the native analogue of the web hook's typed query
/// result). Pure — unit-tested without a network or cache.
/// </summary>
public static class AddressGeocodeResultMapper
{
    /// <summary>Map a raw geocode-search emission to a typed suggestion-list result.</summary>
    public static RepositoryResult<IReadOnlyList<GeocodeSuggestion>> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        switch (raw.Status)
        {
            case LoadStatus.Loading:
                return RepositoryResult<IReadOnlyList<GeocodeSuggestion>>.Loading();

            case LoadStatus.Empty:
                return RepositoryResult<IReadOnlyList<GeocodeSuggestion>>.Empty(raw.FetchedAt);

            case LoadStatus.Error:
                return RepositoryResult<IReadOnlyList<GeocodeSuggestion>>.Failure(
                    raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error"));
        }

        var suggestions = GeocodeSuggestions.FromJsonArray(raw.Value);
        var fetchedAt = raw.FetchedAt ?? DateTimeOffset.UtcNow;

        return raw.Status switch
        {
            LoadStatus.Cached =>
                RepositoryResult<IReadOnlyList<GeocodeSuggestion>>.Cached(suggestions, fetchedAt, raw.IsStale),
            LoadStatus.Refreshing =>
                RepositoryResult<IReadOnlyList<GeocodeSuggestion>>.Refreshing(suggestions, fetchedAt, raw.IsStale),
            LoadStatus.Offline => RepositoryResult<IReadOnlyList<GeocodeSuggestion>>.OfflineCached(
                suggestions, fetchedAt, raw.Error ?? new RepositoryError(RepositoryErrorKind.Network, "Offline")),
            _ => RepositoryResult<IReadOnlyList<GeocodeSuggestion>>.Loaded(suggestions, fetchedAt),
        };
    }
}

/// <summary>
/// Canonical registry metadata for the <c>AddressInput</c> surface — the native mirror of the web component
/// (web/src/features/driving/components/AddressInput.tsx). Centralises the stable id, the diagnostics slug, the
/// geocoder request defaults, the Segoe Fluent glyph standing in for the web Lucide <c>MapPin</c>, and the
/// localized copy. The single web-source i18n key (<c>addressInput.label</c> → "Address", present in the en
/// catalog as <c>translation.addressInput.label</c>) is resolved verbatim; the native-superset state copy
/// resolves to its English fallback when absent (the same precedent the sibling <c>TripPlannerMap</c> /
/// <c>XRayHeader</c> surfaces follow). UI-free so the metadata is asserted in tests.
/// </summary>
public static class AddressInputRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "address-input";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "AddressInput";

    /// <summary>Minimum query length before a geocode search runs (web <c>debouncedQuery.length &gt;= 3</c>).</summary>
    public const int MinQueryLength = 3;

    /// <summary>Debounce applied to typed input before a search runs, in ms (web <c>setTimeout(…, 400)</c>).</summary>
    public const int DebounceMilliseconds = 400;

    /// <summary>The suggestion cap requested (web <c>?limit=5</c> + <c>maxVisibleOptions={5}</c>).</summary>
    public const int DefaultLimit = 5;

    /// <summary>Segoe Fluent "MapPin" glyph — the native stand-in for the web Lucide <c>MapPin</c> icon.</summary>
    public const string MapPinGlyph = "\uE707";

    /// <summary>i18n key for the field label (web <c>t('addressInput.label', 'Address')</c>).</summary>
    public const string LabelKey = "addressInput.label";

    /// <summary>English fallback for the field label — verbatim from the web source.</summary>
    public const string LabelFallback = "Address";

    /// <summary>The field label (web <c>label ?? t('addressInput.label', 'Address')</c>).</summary>
    public static string LabelText(ILocalizer localizer) =>
        Require(localizer).GetString(LabelKey, LabelFallback);

    /// <summary>"Searching addresses…" in-flight announcement (native superset).</summary>
    public static string SearchingLabel(ILocalizer localizer) =>
        Require(localizer).GetString("addressInput.searching", "Searching addresses\u2026");

    /// <summary>"No matching addresses" empty-result hint (native superset).</summary>
    public static string NoMatchesLabel(ILocalizer localizer) =>
        Require(localizer).GetString("addressInput.noMatches", "No matching addresses");

    /// <summary>Hint shown until the query is long enough to search (native superset).</summary>
    public static string TypeMoreHint(ILocalizer localizer) =>
        Require(localizer).GetString("addressInput.typeMore", "Type at least 3 characters to search");

    /// <summary>Stale freshness chip label (native superset).</summary>
    public static string StaleLabel(ILocalizer localizer) =>
        Require(localizer).GetString("addressInput.stale", "Stale");

    /// <summary>Offline freshness chip label (native superset).</summary>
    public static string OfflineLabel(ILocalizer localizer) =>
        Require(localizer).GetString("addressInput.offline", "Offline");

    /// <summary>Retry affordance label for the hard-error branch (native superset).</summary>
    public static string RetryLabel(ILocalizer localizer) =>
        Require(localizer).GetString("addressInput.retry", "Retry");

    /// <summary>Hard-error message shown when the search fails with no cache (native superset).</summary>
    public static string ErrorText(ILocalizer localizer) =>
        Require(localizer).GetString("addressInput.error", "Couldn't search addresses");

    /// <summary>Offline message shown alongside the cached suggestions (native superset).</summary>
    public static string OfflineText(ILocalizer localizer) =>
        Require(localizer).GetString(
            "addressInput.offlineMessage", "You're offline \u2014 showing the last cached results");

    private static ILocalizer Require(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer;
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>AddressInput</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a typed query, address or coordinate — so
/// a diagnostics line can never leak what a user searched for. Thread-safe.
/// </summary>
public sealed class AddressInputDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional operational-only line sink (no user data is ever passed).</param>
    public AddressInputDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=AddressInput</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={AddressInputRegistration.Slug}");
    }
}
