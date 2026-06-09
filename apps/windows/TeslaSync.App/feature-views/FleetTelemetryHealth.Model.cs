using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// Null-tolerant <see cref="JsonElement"/> readers for the Fleet Telemetry health surface. Every getter
/// returns a nullable / fallback rather than throwing so a partial or schema-drifted row from
/// <c>GET /tesla/fleet-telemetry/error-vins</c> / <c>/errors</c> never aborts the parse (web parity: the
/// React hooks tolerate undefined fields and render the em-dash). Kept private to the surface and free of
/// WinUI types so the parse is unit-tested without a UI host.
/// </summary>
internal static class FleetTelemetryHealthJson
{
    /// <summary>The string value of <paramref name="name"/>, or null when absent / not a JSON string.</summary>
    public static string? GetString(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object
        && obj.TryGetProperty(name, out var prop)
        && prop.ValueKind == JsonValueKind.String
            ? prop.GetString()
            : null;

    /// <summary>The integer value of <paramref name="name"/>, tolerating a numeric or numeric-string field.</summary>
    public static long? GetLong(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var prop))
        {
            return null;
        }

        return prop.ValueKind switch
        {
            JsonValueKind.Number when prop.TryGetInt64(out var n) => n,
            JsonValueKind.String when long.TryParse(prop.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var s) => s,
            _ => null,
        };
    }

    /// <summary>The boolean value of <paramref name="name"/>, or null when absent / not a JSON boolean.</summary>
    public static bool? GetBool(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object
        && obj.TryGetProperty(name, out var prop)
        && prop.ValueKind is JsonValueKind.True or JsonValueKind.False
            ? prop.GetBoolean()
            : null;

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
/// One row from <c>GET /tesla/fleet-telemetry/error-vins</c> — the native analogue of the web
/// <c>FleetTelemetryErrorVIN</c> shape (web/src/api/hooks/useTelemetry.ts). Field names mirror the Go API's
/// snake_case JSON tags; parsing is null-tolerant so a partial row never throws. Raw timestamp strings are
/// kept and parsed on demand (web parity — the web passes them straight to <c>TimeStamp</c>).
/// </summary>
public sealed record FleetTelemetryErrorVin(
    long Id,
    string Vin,
    bool Active,
    string? FirstSeenAt,
    string? LastSeenAt,
    string? ResolvedAt)
{
    /// <summary>The parsed first-seen instant, or null when absent / unparseable.</summary>
    public DateTimeOffset? FirstSeen => FleetTelemetryHealthJson.TryParseTimestamp(FirstSeenAt);

    /// <summary>The parsed last-seen instant, or null when absent / unparseable.</summary>
    public DateTimeOffset? LastSeen => FleetTelemetryHealthJson.TryParseTimestamp(LastSeenAt);

    /// <summary>Parse a <c>GET /tesla/fleet-telemetry/error-vins</c> JSON array into a tolerant list.</summary>
    public static IReadOnlyList<FleetTelemetryErrorVin> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<FleetTelemetryErrorVin>();
        }

        var list = new List<FleetTelemetryErrorVin>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Project a single error-VIN JSON object into a <see cref="FleetTelemetryErrorVin"/>.</summary>
    public static FleetTelemetryErrorVin FromJson(JsonElement obj) => new(
        Id: FleetTelemetryHealthJson.GetLong(obj, "id") ?? 0,
        Vin: FleetTelemetryHealthJson.GetString(obj, "vin") ?? string.Empty,
        Active: FleetTelemetryHealthJson.GetBool(obj, "active") ?? false,
        FirstSeenAt: FleetTelemetryHealthJson.GetString(obj, "first_seen_at"),
        LastSeenAt: FleetTelemetryHealthJson.GetString(obj, "last_seen_at"),
        ResolvedAt: FleetTelemetryHealthJson.GetString(obj, "resolved_at"));
}

/// <summary>
/// One row from <c>GET /tesla/fleet-telemetry/errors</c> — the native analogue of the web
/// <c>FleetTelemetryError</c> shape (web/src/api/hooks/useTelemetry.ts). Field names mirror the Go API's
/// snake_case JSON tags; parsing is null-tolerant. The display timestamp is the raw <c>reported_at</c>
/// (web parity — the web binds <c>TimeStamp value={r.reported_at}</c>).
/// </summary>
public sealed record FleetTelemetryError(
    long Id,
    string Vin,
    string? ErrorCode,
    string? ErrorMessage,
    string? ReportedAt,
    string? TeslaUpdatedAt,
    string? FetchedAt)
{
    /// <summary>The parsed reported-at instant, or null when absent / unparseable.</summary>
    public DateTimeOffset? Reported => FleetTelemetryHealthJson.TryParseTimestamp(ReportedAt);

    /// <summary>Parse a <c>GET /tesla/fleet-telemetry/errors</c> JSON array into a tolerant list.</summary>
    public static IReadOnlyList<FleetTelemetryError> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<FleetTelemetryError>();
        }

        var list = new List<FleetTelemetryError>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Project a single error JSON object into a <see cref="FleetTelemetryError"/>.</summary>
    public static FleetTelemetryError FromJson(JsonElement obj) => new(
        Id: FleetTelemetryHealthJson.GetLong(obj, "id") ?? 0,
        Vin: FleetTelemetryHealthJson.GetString(obj, "vin") ?? string.Empty,
        ErrorCode: FleetTelemetryHealthJson.GetString(obj, "error_code"),
        ErrorMessage: FleetTelemetryHealthJson.GetString(obj, "error_message"),
        ReportedAt: FleetTelemetryHealthJson.GetString(obj, "reported_at"),
        TeslaUpdatedAt: FleetTelemetryHealthJson.GetString(obj, "tesla_updated_at"),
        FetchedAt: FleetTelemetryHealthJson.GetString(obj, "fetched_at"));
}

/// <summary>
/// The lifecycle state one section (Error VINs or Error Log) of the Fleet Telemetry health surface can be
/// in. Every branch maps onto a visible surface — none is ever hidden (engineering rule #6). The web shows
/// <c>Skeleton → DataTable | empty text</c> per section; the native surface additionally renders an explicit
/// <c>error</c> (retry) and <c>offline</c> branch (a strict superset of the web that satisfies the prompt's
/// mandated state set).
/// </summary>
public enum FleetTelemetrySectionState
{
    /// <summary>First fetch with nothing cached — render the skeleton.</summary>
    Loading,

    /// <summary>A fresh (network or non-stale cache) result with rows to show.</summary>
    Loaded,

    /// <summary>The read resolved with no rows — the friendly empty text.</summary>
    Empty,

    /// <summary>The read failed and no cached rows exist — the retry affordance.</summary>
    Error,

    /// <summary>A cached result older than the freshness window — rows plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but cached rows remain — rows plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// One projected, render-ready Error-VIN row — the native analogue of a <c>vinColumns</c> row in
/// web/src/features/admin/components/devtools/FleetTelemetryHealth.tsx. Holds the VIN, the formatted
/// first/last-seen strings (absolute) plus their relative tooltips, the &lt; 24 h "recent" flag the web
/// uses to colour <c>last_seen</c> (rose when recent, amber otherwise), and a Narrator name. Pure data.
/// </summary>
public sealed record FleetTelemetryErrorVinRow(
    string Vin,
    string FirstSeenText,
    string FirstSeenTooltip,
    string LastSeenText,
    string LastSeenTooltip,
    bool LastSeenIsRecent,
    string AutomationName);

/// <summary>
/// One projected, render-ready Error-Log row — the native analogue of an <c>errorColumns</c> row in
/// web/src/features/admin/components/devtools/FleetTelemetryHealth.tsx. Holds the VIN, the optional error
/// code (rendered as a danger badge or an em-dash), the message (em-dash when absent), the formatted
/// reported-at string plus its relative tooltip, the &lt; 24 h "recent" flag the web uses to colour
/// <c>reported_at</c>, and a Narrator name. Pure data.
/// </summary>
public sealed record FleetTelemetryErrorRow(
    string Vin,
    string? ErrorCode,
    bool HasErrorCode,
    string Message,
    string ReportedAtText,
    string ReportedAtTooltip,
    bool ReportedAtIsRecent,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the Error-VINs card — the native analogue of the
/// <c>vinList</c> + count badge in web/src/features/admin/components/devtools/FleetTelemetryHealth.tsx.
/// <see cref="Count"/> mirrors the web <c>vinList.length</c> the count badge shows (NOT the active-only
/// count), and <see cref="HasRows"/> reproduces the web <c>vinList.length &gt; 0</c> table/empty gate.
/// </summary>
public sealed record FleetTelemetryErrorVinsDisplay(
    int Count,
    string CountBadgeText,
    StatusKind CountStatus,
    bool HasRows,
    IReadOnlyList<FleetTelemetryErrorVinRow> Rows)
{
    /// <summary>An empty display (no error VINs) — the projection fallback.</summary>
    public static FleetTelemetryErrorVinsDisplay Empty { get; } = new(
        0, string.Empty, StatusKind.Success, false, Array.Empty<FleetTelemetryErrorVinRow>());
}

/// <summary>
/// The fully projected, render-ready view of the Error-Log card — the native analogue of the
/// <c>errorList</c> in web/src/features/admin/components/devtools/FleetTelemetryHealth.tsx.
/// <see cref="HasRows"/> reproduces the web <c>errorList.length &gt; 0</c> table/empty gate.
/// </summary>
public sealed record FleetTelemetryErrorsDisplay(
    bool HasRows,
    IReadOnlyList<FleetTelemetryErrorRow> Rows)
{
    /// <summary>An empty display (no errors) — the projection fallback.</summary>
    public static FleetTelemetryErrorsDisplay Empty { get; } = new(false, Array.Empty<FleetTelemetryErrorRow>());
}

/// <summary>
/// Pure projection from the parsed error-VIN / error lists to the display models — the native port of the
/// <c>vinColumns</c>/<c>errorColumns</c> render functions, the <c>isRecent</c> 24-hour boundary and the
/// count-badge variant in web/src/features/admin/components/devtools/FleetTelemetryHealth.tsx. <c>now</c> is
/// injected so the "recent" boundary and the relative tooltips are unit-tested deterministically; every
/// label resolves through the i18n facade. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class FleetTelemetryHealthProjection
{
    /// <summary>Fluent glyph for the Error-VINs card header (web red <c>AlertTriangle</c>).</summary>
    public const string ErrorVinsGlyph = "\uE7BA"; // Warning triangle

    /// <summary>Fluent glyph for the Error-Log card header (web amber <c>AlertCircle</c>).</summary>
    public const string ErrorLogGlyph = "\uEA39"; // ErrorBadge — circular alert

    /// <summary>Em-dash placeholder for absent strings (web parity '—').</summary>
    public const string EmDash = "\u2014";

    // web: isRecent = (Date.now() - new Date(dateStr)) < 24h
    private static readonly TimeSpan RecentWindow = TimeSpan.FromHours(24);

    /// <summary>Project the error-VIN list for the Error-VINs card using the i18n facade.</summary>
    public static FleetTelemetryErrorVinsDisplay ProjectVins(
        IReadOnlyList<FleetTelemetryErrorVin> vins,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(vins);
        ArgumentNullException.ThrowIfNull(localizer);

        // web: <Badge variant={vinList.length > 0 ? 'danger' : 'success'}>{vinList.length} {affected}</Badge>
        int count = vins.Count;
        StatusKind status = count > 0 ? StatusKind.Danger : StatusKind.Success;
        string affected = localizer.GetString("devtools.health.affectedVehicles", "affected");
        string countBadge = string.Format(CultureInfo.CurrentCulture, "{0} {1}", count, affected);

        var rows = new List<FleetTelemetryErrorVinRow>(vins.Count);
        foreach (var v in vins)
        {
            DateTimeOffset? first = v.FirstSeen;
            DateTimeOffset? last = v.LastSeen;
            bool lastRecent = last is { } ls && now - ls < RecentWindow;

            rows.Add(new FleetTelemetryErrorVinRow(
                Vin: v.Vin,
                FirstSeenText: Absolute(first, now),
                FirstSeenTooltip: Relative(first, now),
                LastSeenText: Absolute(last, now),
                LastSeenTooltip: Relative(last, now),
                LastSeenIsRecent: lastRecent,
                AutomationName: VinAutomationName(v, first, last, now, localizer)));
        }

        return new FleetTelemetryErrorVinsDisplay(count, countBadge, status, rows.Count > 0, rows);
    }

    /// <summary>Project the error list for the Error-Log card using the i18n facade.</summary>
    public static FleetTelemetryErrorsDisplay ProjectErrors(
        IReadOnlyList<FleetTelemetryError> errors,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(errors);
        ArgumentNullException.ThrowIfNull(localizer);

        var rows = new List<FleetTelemetryErrorRow>(errors.Count);
        foreach (var e in errors)
        {
            bool hasCode = !string.IsNullOrEmpty(e.ErrorCode);
            DateTimeOffset? reported = e.Reported;
            bool reportedRecent = reported is { } r && now - r < RecentWindow;
            string message = string.IsNullOrEmpty(e.ErrorMessage) ? EmDash : e.ErrorMessage!;

            rows.Add(new FleetTelemetryErrorRow(
                Vin: e.Vin,
                ErrorCode: hasCode ? e.ErrorCode : null,
                HasErrorCode: hasCode,
                Message: message,
                ReportedAtText: Absolute(reported, now),
                ReportedAtTooltip: Relative(reported, now),
                ReportedAtIsRecent: reportedRecent,
                AutomationName: ErrorAutomationName(e, hasCode, message, reported, now, localizer)));
        }

        return new FleetTelemetryErrorsDisplay(rows.Count > 0, rows);
    }

    private static string Absolute(DateTimeOffset? value, DateTimeOffset now) =>
        DateTimeFormatting.Format(value, DateTimeVariant.Full, now);

    private static string Relative(DateTimeOffset? value, DateTimeOffset now) =>
        DateTimeFormatting.Format(value, DateTimeVariant.Relative, now);

    private static string VinAutomationName(
        FleetTelemetryErrorVin vin,
        DateTimeOffset? first,
        DateTimeOffset? last,
        DateTimeOffset now,
        ILocalizer localizer)
    {
        string firstLabel = localizer.GetString("devtools.health.firstSeen", "First Seen");
        string lastLabel = localizer.GetString("devtools.health.lastSeen", "Last Seen");
        return string.Format(
            CultureInfo.CurrentCulture,
            "{0}, {1}: {2}, {3}: {4}",
            vin.Vin,
            firstLabel,
            Absolute(first, now),
            lastLabel,
            Absolute(last, now));
    }

    private static string ErrorAutomationName(
        FleetTelemetryError error,
        bool hasCode,
        string message,
        DateTimeOffset? reported,
        DateTimeOffset now,
        ILocalizer localizer)
    {
        string codeLabel = localizer.GetString("devtools.health.errorCode", "Error Code");
        string reportedLabel = localizer.GetString("devtools.health.reportedAt", "Reported At");
        string code = hasCode ? error.ErrorCode! : EmDash;
        return string.Format(
            CultureInfo.CurrentCulture,
            "{0}, {1}: {2}, {3}, {4}: {5}",
            error.Vin,
            codeLabel,
            code,
            message,
            reportedLabel,
            Absolute(reported, now));
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions to typed
/// <c>RepositoryResult&lt;IReadOnlyList&lt;…&gt;&gt;</c> for the two Fleet-Telemetry reads, preserving the
/// cache-then-network status/freshness while parsing the snake_case payload (the native analogue of the web
/// hooks' typed query results). A loaded-but-empty array collapses to <see cref="LoadStatus.Empty"/> so the
/// section renders its empty state. Pure — unit-tested without a network or cache.
/// </summary>
public static class FleetTelemetryHealthResultMapper
{
    /// <summary>Map a raw error-VINs emission to a typed list result.</summary>
    public static RepositoryResult<IReadOnlyList<FleetTelemetryErrorVin>> MapVins(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);
        return Map(raw, FleetTelemetryErrorVin.ParseList);
    }

    /// <summary>Map a raw errors emission to a typed list result.</summary>
    public static RepositoryResult<IReadOnlyList<FleetTelemetryError>> MapErrors(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);
        return Map(raw, FleetTelemetryError.ParseList);
    }

    private static RepositoryResult<IReadOnlyList<T>> Map<T>(
        RepositoryResult<JsonElement> raw,
        Func<JsonElement, IReadOnlyList<T>> parse)
    {
        switch (raw.Status)
        {
            case LoadStatus.Loading:
                return RepositoryResult<IReadOnlyList<T>>.Loading();

            case LoadStatus.Empty:
                return RepositoryResult<IReadOnlyList<T>>.Empty(raw.FetchedAt);

            case LoadStatus.Error:
                return RepositoryResult<IReadOnlyList<T>>.Failure(
                    raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error"));
        }

        var rows = parse(raw.Value);
        var fetchedAt = raw.FetchedAt ?? DateTimeOffset.UtcNow;

        return raw.Status switch
        {
            LoadStatus.Cached => RepositoryResult<IReadOnlyList<T>>.Cached(rows, fetchedAt, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<IReadOnlyList<T>>.Refreshing(rows, fetchedAt, raw.IsStale),
            LoadStatus.Offline => RepositoryResult<IReadOnlyList<T>>.OfflineCached(
                rows, fetchedAt, raw.Error ?? new RepositoryError(RepositoryErrorKind.Network, "Offline")),
            _ when rows.Count == 0 => RepositoryResult<IReadOnlyList<T>>.Empty(fetchedAt),
            _ => RepositoryResult<IReadOnlyList<T>>.Loaded(rows, fetchedAt),
        };
    }
}

/// <summary>
/// Canonical registry metadata for the Fleet Telemetry health surface — the native mirror of the web
/// devtools tool (web/src/features/admin/components/devtools/FleetTelemetryHealth.tsx). Centralises the
/// stable id, the diagnostics slug, and the localized card titles/descriptions so the view and the
/// view-model stay free of literal copy.
/// </summary>
public static class FleetTelemetryHealthRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "fleet-telemetry-health";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "FleetTelemetryHealth";

    /// <summary>Localized Error-VINs card title (web <c>devtools.health.errorVinsTitle</c>).</summary>
    public static string ErrorVinsTitle(ILocalizer localizer) =>
        Require(localizer).GetString("devtools.health.errorVinsTitle", "Error VINs");

    /// <summary>Localized Error-VINs card description (web <c>devtools.health.errorVinsDesc</c>).</summary>
    public static string ErrorVinsDescription(ILocalizer localizer) =>
        Require(localizer).GetString(
            "devtools.health.errorVinsDesc", "Vehicles with fleet telemetry configuration errors");

    /// <summary>Localized Error-Log card title (web <c>devtools.health.errorLogTitle</c>).</summary>
    public static string ErrorLogTitle(ILocalizer localizer) =>
        Require(localizer).GetString("devtools.health.errorLogTitle", "Error Log");

    /// <summary>Localized Error-Log card description (web <c>devtools.health.errorLogDesc</c>).</summary>
    public static string ErrorLogDescription(ILocalizer localizer) =>
        Require(localizer).GetString("devtools.health.errorLogDesc", "Detailed fleet telemetry error history");

    private static ILocalizer Require(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer;
    }
}

/// <summary>
/// PII-safe diagnostics for the Fleet Telemetry health surface (P1/S11 diagnostics contract). Records only
/// the operational <c>view.opened</c> event with the surface slug — never a VIN, error code or error
/// message — so a diagnostics line can never leak which vehicle or fault was involved. Thread-safe.
/// </summary>
public sealed class FleetTelemetryHealthDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public FleetTelemetryHealthDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=FleetTelemetryHealth</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={FleetTelemetryHealthRegistration.Slug}");
    }
}
