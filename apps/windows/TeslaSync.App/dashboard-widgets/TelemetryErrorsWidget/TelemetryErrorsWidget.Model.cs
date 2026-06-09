using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets.TelemetryErrors;

/// <summary>
/// The lifecycle state a <see cref="TelemetryErrorsViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>TelemetryErrorsWidget</c>
/// renders through <c>WidgetShell</c>
/// (web/src/features/dashboard/widgets/TelemetryErrorsWidget.tsx). Every branch maps onto a visible
/// surface; none is ever hidden. The widget composes two reads — the Fleet Telemetry error-VIN list
/// (<c>useFleetTelemetryErrorVINs</c>) and the per-VIN error feed (<c>useFleetTelemetryErrors</c>) — so
/// <see cref="Loading"/> follows the web's combined <c>vinsLoading || errorsLoading</c> gate while the
/// header freshness (<see cref="Stale"/>/<see cref="Offline"/>/<see cref="Error"/>) tracks both reads,
/// exactly as the web wires <c>WidgetShell</c>'s <c>updatedAt</c>/<c>isFetching</c>/<c>isStale</c>/
/// <c>isError</c> to <c>Math.max(vinsUpdatedAt, errorsUpdatedAt)</c> and the OR-ed query flags.
/// </summary>
public enum TelemetryErrorsState
{
    /// <summary>Initial fetch with neither read resolved yet — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh snapshot (network or non-stale cache) with error data to show.</summary>
    Loaded,

    /// <summary>Both reads resolved but there are no error VINs and no errors — the empty state.</summary>
    Empty,

    /// <summary>Both reads failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// One row from <c>GET /tesla/fleet-telemetry/error-vins</c> (web <c>useFleetTelemetryErrorVINs</c>,
/// shape <c>FleetTelemetryErrorVIN</c> in web/src/api/hooks/useTelemetry.ts). Field names mirror the Go
/// API's snake_case JSON tags; parsing is null-tolerant so a partial row never throws. Timestamp strings
/// are kept raw (as the web does).
/// </summary>
public sealed record TelemetryErrorVin(
    long Id,
    string Vin,
    bool Active,
    string? FirstSeenAt,
    string? LastSeenAt,
    string? ResolvedAt)
{
    /// <summary>Parse a <c>GET /tesla/fleet-telemetry/error-vins</c> JSON array into a tolerant list.</summary>
    public static IReadOnlyList<TelemetryErrorVin> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<TelemetryErrorVin>();
        }

        var list = new List<TelemetryErrorVin>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Project a single error-VIN JSON object into a <see cref="TelemetryErrorVin"/>.</summary>
    public static TelemetryErrorVin FromJson(JsonElement obj) => new(
        Id: TelemetryJson.GetLong(obj, "id") ?? 0,
        Vin: TelemetryJson.GetString(obj, "vin") ?? string.Empty,
        Active: TelemetryJson.GetBool(obj, "active") ?? false,
        FirstSeenAt: TelemetryJson.GetString(obj, "first_seen_at"),
        LastSeenAt: TelemetryJson.GetString(obj, "last_seen_at"),
        ResolvedAt: TelemetryJson.GetString(obj, "resolved_at"));
}

/// <summary>
/// One row from <c>GET /tesla/fleet-telemetry/errors</c> (web <c>useFleetTelemetryErrors</c>, shape
/// <c>FleetTelemetryError</c> in web/src/api/hooks/useTelemetry.ts). Field names mirror the Go API's
/// snake_case JSON tags; parsing is null-tolerant. The display timestamp mirrors the web's
/// <c>reported_at ?? fetched_at</c> and is parsed on demand via <see cref="EffectiveTimestamp"/>.
/// </summary>
public sealed record TelemetryError(
    long Id,
    string Vin,
    string? ErrorCode,
    string? ErrorMessage,
    string? ReportedAt,
    string? TeslaUpdatedAt,
    string? FetchedAt)
{
    /// <summary>The raw display timestamp — web parity for <c>e.reported_at ?? e.fetched_at</c>.</summary>
    public string? EffectiveTimestampRaw => ReportedAt ?? FetchedAt;

    /// <summary>The parsed display instant, or <see langword="null"/> when absent/unparseable.</summary>
    public DateTimeOffset? EffectiveTimestamp => TelemetryJson.TryParseTimestamp(EffectiveTimestampRaw);

    /// <summary>Parse a <c>GET /tesla/fleet-telemetry/errors</c> JSON array into a tolerant list.</summary>
    public static IReadOnlyList<TelemetryError> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<TelemetryError>();
        }

        var list = new List<TelemetryError>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Project a single error JSON object into a <see cref="TelemetryError"/>.</summary>
    public static TelemetryError FromJson(JsonElement obj) => new(
        Id: TelemetryJson.GetLong(obj, "id") ?? 0,
        Vin: TelemetryJson.GetString(obj, "vin") ?? string.Empty,
        ErrorCode: TelemetryJson.GetString(obj, "error_code"),
        ErrorMessage: TelemetryJson.GetString(obj, "error_message"),
        ReportedAt: TelemetryJson.GetString(obj, "reported_at"),
        TeslaUpdatedAt: TelemetryJson.GetString(obj, "tesla_updated_at"),
        FetchedAt: TelemetryJson.GetString(obj, "fetched_at"));
}

/// <summary>
/// The merged read-model the widget renders — the error-VIN list plus the per-VIN error feed (the native
/// analogue of the web's <c>vinList</c> + <c>errorList</c>). <see cref="ActiveVinCount"/> mirrors
/// <c>vinList.filter(v =&gt; v.active).length</c> and <see cref="HasData"/> reproduces the web
/// <c>hasData = vinList.length &gt; 0 || errorList.length &gt; 0</c> gate. Pure data — no WinUI types — so
/// the projection is unit-tested without a UI host.
/// </summary>
public sealed record TelemetryErrorsSnapshot(
    IReadOnlyList<TelemetryErrorVin> Vins,
    IReadOnlyList<TelemetryError> Errors)
{
    /// <summary>An empty snapshot (neither read produced data) — the projection/parse fallback.</summary>
    public static TelemetryErrorsSnapshot Empty { get; } =
        new(Array.Empty<TelemetryErrorVin>(), Array.Empty<TelemetryError>());

    /// <summary>Count of VINs flagged active (web <c>vinList.filter(v =&gt; v.active).length</c>).</summary>
    public int ActiveVinCount => Vins.Count(v => v.Active);

    /// <summary>True when there is something to render (web <c>vinList.length &gt; 0 || errorList.length &gt; 0</c>).</summary>
    public bool HasData => Vins.Count > 0 || Errors.Count > 0;
}

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> plus the
/// <c>isCompact = size.cols &lt;= 1</c> logic in
/// web/src/features/dashboard/widgets/TelemetryErrorsWidget.tsx (the web gates compact on COLUMNS).
/// </summary>
public readonly record struct TelemetryErrorsSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×4).</summary>
    public static TelemetryErrorsSize Default => new(2, 4);

    /// <summary>True at a single column (web <c>isCompact = size.cols &lt;= 1</c>): the centred hero layout.</summary>
    public bool IsCompact => Cols <= 1;
}

/// <summary>
/// One projected, display-ready aggregated error row consumed by the WinUI view — the native analogue of
/// an entry in the web's <c>aggregated</c> <c>useMemo</c>
/// (web/src/features/dashboard/widgets/TelemetryErrorsWidget.tsx). Holds the VIN, the resolved (localized)
/// error code, the occurrence count and its formatted "×N" label, the last-seen instant + its relative
/// string, the &lt; 1 h "recent" flag, and a Narrator automation name. Pure data — no WinUI types.
/// </summary>
public sealed record TelemetryErrorEntry(
    string Vin,
    string ErrorCode,
    int Count,
    DateTimeOffset? LastSeen,
    bool IsRecent,
    string CountLabel,
    string LastSeenRelative,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the telemetry errors for one footprint — the native analogue
/// of the <c>statusBadge</c>/<c>statusLabel</c>/<c>activeVINCount</c>/<c>aggregated</c> computations in
/// web/src/features/dashboard/widgets/TelemetryErrorsWidget.tsx. Holds the compact-hero scalars, the
/// status chip, the header summary, and the aggregated error feed. Pure data so the projection is
/// unit-tested without a UI host.
/// </summary>
public sealed record TelemetryErrorsDisplay(
    bool HasData,
    bool IsCompact,
    int ActiveVinCount,
    string ActiveVinCountValue,
    StatusKind Status,
    string StatusLabel,
    string ActiveVinsSummary,
    string ErrorVinsLabel,
    bool HasEntries,
    IReadOnlyList<TelemetryErrorEntry> Entries,
    string NoErrorsMessage,
    string CompactAutomationName);

/// <summary>
/// Pure projection from a merged <see cref="TelemetryErrorsSnapshot"/> to the display model — the native
/// port of the <c>activeVINCount</c>, <c>statusBadge</c>/<c>statusLabel</c> and the <c>aggregated</c>
/// <c>useMemo</c> (group by VIN + error_code, newest-first by last_seen, with the &lt; 1 h "recent" tag)
/// in web/src/features/dashboard/widgets/TelemetryErrorsWidget.tsx. <c>now</c> is injected so the
/// relative-time tiers and the "recent" boundary are unit-tested deterministically. Every label resolves
/// through the i18n facade.
/// </summary>
public static class TelemetryErrorsProjection
{
    /// <summary>Fluent glyph for the surface header / empty state (web red <c>AlertCircle</c>).</summary>
    public const string HeaderGlyph = "\uEA39"; // ErrorBadge — circular alert badge

    private static readonly TimeSpan RecentWindow = TimeSpan.FromHours(1); // web ONE_HOUR_MS

    /// <summary>Project <paramref name="snapshot"/> for <paramref name="size"/> using the i18n facade.</summary>
    public static TelemetryErrorsDisplay Project(
        TelemetryErrorsSnapshot snapshot,
        TelemetryErrorsSize size,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentNullException.ThrowIfNull(localizer);

        int activeVinCount = snapshot.ActiveVinCount;

        // Web: statusBadge = activeVINCount > 0 ? 'danger' : 'success'; statusLabel mirrors it.
        StatusKind status = activeVinCount > 0 ? StatusKind.Danger : StatusKind.Success;
        string statusLabel = activeVinCount > 0
            ? localizer.GetString("widget.telemetryErrors.errors", "Errors")
            : localizer.GetString("widget.telemetryErrors.healthy", "Healthy");

        string activeVinCountValue = ScalarFormatters.FormatNumber(activeVinCount, 0);
        string activeVinsSummary = string.Format(
            CultureInfo.CurrentCulture,
            localizer.GetString("widget.telemetryErrors.activeVINs", "{0} VINs with errors"),
            activeVinCount);
        string errorVinsLabel = localizer.GetString("widget.telemetryErrors.errorVINs", "error VINs");
        string noErrorsMessage = localizer.GetString("widget.telemetryErrors.noErrors", "No errors recorded");
        string unknownCode = localizer.GetString("widget.telemetryErrors.unknown", "Unknown");
        string recentLabel = localizer.GetString("widget.telemetryErrors.recent", "recent");

        var entries = Aggregate(snapshot.Errors, unknownCode, recentLabel, localizer, now);

        string compactAutomationName = string.Format(
            CultureInfo.CurrentCulture, "{0} {1}, {2}", activeVinCountValue, errorVinsLabel, statusLabel);

        return new TelemetryErrorsDisplay(
            HasData: snapshot.HasData,
            IsCompact: size.IsCompact,
            ActiveVinCount: activeVinCount,
            ActiveVinCountValue: activeVinCountValue,
            Status: status,
            StatusLabel: statusLabel,
            ActiveVinsSummary: activeVinsSummary,
            ErrorVinsLabel: errorVinsLabel,
            HasEntries: entries.Count > 0,
            Entries: entries,
            NoErrorsMessage: noErrorsMessage,
            CompactAutomationName: compactAutomationName);
    }

    /// <summary>
    /// Aggregate errors by VIN + error_code, counting occurrences and tracking the newest last_seen, then
    /// order newest-first with last_seen-less rows sunk to the bottom — a 1:1 port of the web's
    /// <c>aggregated</c> Map build + sort. The grouping key uses the raw <c>error_code ?? 'unknown'</c>
    /// (the web's key), while the displayed code resolves the localized "Unknown".
    /// </summary>
    private static List<TelemetryErrorEntry> Aggregate(
        IReadOnlyList<TelemetryError> errors,
        string unknownCode,
        string recentLabel,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        var map = new Dictionary<string, Accumulator>(StringComparer.Ordinal);
        var order = new List<string>(errors.Count);

        foreach (var e in errors)
        {
            bool hasCode = !string.IsNullOrEmpty(e.ErrorCode);
            string keyCode = hasCode ? e.ErrorCode! : "unknown";
            string key = string.Concat(e.Vin, "::", keyCode);
            DateTimeOffset? ts = e.EffectiveTimestamp;

            if (map.TryGetValue(key, out var acc))
            {
                acc.Count += 1;
                if (ts is { } t && (acc.LastSeen is not { } current || t > current))
                {
                    acc.LastSeen = t;
                }
            }
            else
            {
                map[key] = new Accumulator
                {
                    Vin = e.Vin,
                    DisplayCode = hasCode ? e.ErrorCode! : unknownCode,
                    Count = 1,
                    LastSeen = ts,
                };
                order.Add(key);
            }
        }

        // Web sort: rows WITH last_seen newest-first; rows WITHOUT last_seen sink to the bottom. A stable
        // OrderByDescending on (LastSeen ?? MinValue) reproduces that exactly (null → MinValue → last;
        // equal keys keep insertion order, matching the web comparator's 0 return).
        var ordered = order
            .Select(k => map[k])
            .OrderByDescending(a => a.LastSeen ?? DateTimeOffset.MinValue)
            .ToList();

        var result = new List<TelemetryErrorEntry>(ordered.Count);
        foreach (var acc in ordered)
        {
            bool isRecent = acc.LastSeen is { } ls && now - ls < RecentWindow;
            string countLabel = string.Concat("\u00d7", ScalarFormatters.FormatNumber(acc.Count, 0));
            string relative = acc.LastSeen is { } seen
                ? DateTimeFormatting.Format(seen, DateTimeVariant.Relative, now)
                : DateTimeFormatting.DefaultEmptyDisplay;

            result.Add(new TelemetryErrorEntry(
                Vin: acc.Vin,
                ErrorCode: acc.DisplayCode,
                Count: acc.Count,
                LastSeen: acc.LastSeen,
                IsRecent: isRecent,
                CountLabel: countLabel,
                LastSeenRelative: relative,
                AutomationName: EntryAutomationName(acc, countLabel, relative, isRecent, recentLabel, localizer)));
        }

        return result;
    }

    private static string EntryAutomationName(
        Accumulator acc,
        string countLabel,
        string relative,
        bool isRecent,
        string recentLabel,
        ILocalizer localizer)
    {
        string vinLabel = localizer.GetString("widget.telemetryErrors.title", "Telemetry Errors");
        string baseName = string.Format(
            CultureInfo.CurrentCulture, "{0}: {1}, {2}, {3}", acc.Vin, acc.DisplayCode, countLabel, relative);
        string scoped = string.Format(CultureInfo.CurrentCulture, "{0} — {1}", vinLabel, baseName);
        return isRecent
            ? string.Format(CultureInfo.CurrentCulture, "{0} ({1})", scoped, recentLabel)
            : scoped;
    }

    private sealed class Accumulator
    {
        public required string Vin { get; init; }

        public required string DisplayCode { get; init; }

        public int Count { get; set; }

        public DateTimeOffset? LastSeen { get; set; }
    }
}

/// <summary>
/// Merges the engine's two raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions (the error-VIN list and
/// the error feed) into one parsed <c>RepositoryResult&lt;TelemetryErrorsSnapshot&gt;</c>, reproducing the
/// web <c>TelemetryErrorsWidget</c>'s composition: the combined loading gate
/// (<c>vinsLoading || errorsLoading</c>), the <c>hasData</c> empty gate, the OR-ed stale/offline freshness,
/// and the <c>Math.max(vinsUpdatedAt, errorsUpdatedAt)</c> freshness timestamp. A hard-failure retry
/// surface is added (both reads failed with no cache) so the surface honours the dashboard's mandated
/// error state. Kept pure so the combine contract is unit-tested without a network or cache.
/// </summary>
public static class TelemetryErrorsResultMapper
{
    /// <summary>Combine the latest <paramref name="vins"/> and <paramref name="errors"/> emissions.</summary>
    public static RepositoryResult<TelemetryErrorsSnapshot> Combine(
        RepositoryResult<JsonElement> vins,
        RepositoryResult<JsonElement> errors)
    {
        ArgumentNullException.ThrowIfNull(vins);
        ArgumentNullException.ThrowIfNull(errors);

        // Web: loading = vinsLoading || errorsLoading — skeleton until BOTH reads resolve once.
        if (vins.Status == LoadStatus.Loading || errors.Status == LoadStatus.Loading)
        {
            return RepositoryResult<TelemetryErrorsSnapshot>.Loading();
        }

        var vinList = HasContent(vins) ? TelemetryErrorVin.ParseList(vins.Value) : Array.Empty<TelemetryErrorVin>();
        var errorList = HasContent(errors) ? TelemetryError.ParseList(errors.Value) : Array.Empty<TelemetryError>();
        var snapshot = new TelemetryErrorsSnapshot(vinList, errorList);

        // A hard failure of BOTH reads with no cache to fall back to → the retry surface. (The web shows
        // the empty state + a red freshness chip here; the native family adds an explicit retry, a strict
        // superset that satisfies the dashboard's mandated error state.)
        if (vins.Status == LoadStatus.Error && errors.Status == LoadStatus.Error)
        {
            return RepositoryResult<TelemetryErrorsSnapshot>.Failure(
                vins.Error ?? errors.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Couldn't load telemetry errors"));
        }

        // Web: !hasData → empty state.
        if (!snapshot.HasData)
        {
            return RepositoryResult<TelemetryErrorsSnapshot>.Empty(MaxFetchedAt(vins, errors));
        }

        var fetchedAt = MaxFetchedAt(vins, errors) ?? DateTimeOffset.UtcNow;
        bool stale = vins.IsStale || errors.IsStale;                                   // web: vinsStale || errorsStale
        bool offline = vins.Status == LoadStatus.Offline || errors.Status == LoadStatus.Offline;
        bool refreshing = vins.Status == LoadStatus.Refreshing || errors.Status == LoadStatus.Refreshing;

        if (offline)
        {
            return RepositoryResult<TelemetryErrorsSnapshot>.OfflineCached(
                snapshot,
                fetchedAt,
                vins.Error ?? errors.Error ?? new RepositoryError(RepositoryErrorKind.Network, "A telemetry-error read is unavailable"));
        }

        if (refreshing)
        {
            return RepositoryResult<TelemetryErrorsSnapshot>.Refreshing(snapshot, fetchedAt, stale);
        }

        if (stale || vins.Status == LoadStatus.Cached || errors.Status == LoadStatus.Cached)
        {
            return RepositoryResult<TelemetryErrorsSnapshot>.Cached(snapshot, fetchedAt, stale);
        }

        return RepositoryResult<TelemetryErrorsSnapshot>.Loaded(snapshot, fetchedAt);
    }

    // Web parity: updatedAt = Math.max(vinsUpdatedAt ?? 0, errorsUpdatedAt ?? 0).
    private static DateTimeOffset? MaxFetchedAt(RepositoryResult<JsonElement> vins, RepositoryResult<JsonElement> errors)
    {
        var a = vins.FetchedAt;
        var b = errors.FetchedAt;
        if (a is null)
        {
            return b;
        }

        if (b is null)
        {
            return a;
        }

        return a.Value >= b.Value ? a : b;
    }

    // RepositoryResult<JsonElement>.HasValue is unreliable: default(JsonElement) is a non-null struct
    // (ValueKind=Undefined), so a bodyless read still reports HasValue=true. The value-bearing status is
    // therefore the source of truth for "this read produced a payload" (matching FleetStatsBar/DigitalTwin).
    private static bool HasContent(RepositoryResult<JsonElement> result) =>
        result.Status is LoadStatus.Cached or LoadStatus.Refreshing or LoadStatus.Loaded or LoadStatus.Offline;
}

/// <summary>
/// Tolerant <see cref="JsonElement"/> readers shared by the Fleet Telemetry DTOs — the same null-safe
/// snake_case extraction the web's <c>request&lt;T&gt;</c> + optional-field access provides. Numeric ids
/// tolerate string encodings; timestamps round-trip as UTC.
/// </summary>
internal static class TelemetryJson
{
    public static string? GetString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    public static long? GetLong(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetInt64(out var n) => n,
            JsonValueKind.String when long.TryParse(v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }

    public static bool? GetBool(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => null,
        };
    }

    public static DateTimeOffset? TryParseTimestamp(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            raw,
            CultureInfo.InvariantCulture,
            DateTimeStyles.RoundtripKind | DateTimeStyles.AssumeUniversal,
            out var parsed)
            ? parsed
            : null;
    }
}
