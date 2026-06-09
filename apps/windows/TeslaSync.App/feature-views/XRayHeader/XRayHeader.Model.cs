using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// Null-tolerant <see cref="JsonElement"/> readers for the Ingest X-Ray header surface. Every getter
/// returns a nullable / fallback rather than throwing so a partial or schema-drifted body from
/// <c>GET /system/ingest-xray/{vehicleID}</c> never aborts the parse (web parity: the React component
/// reads <c>data?.total_samples ?? 0</c> and tolerates an undefined response). Kept private to the surface
/// and free of WinUI types so the parse is unit-tested without a UI host.
/// </summary>
internal static class XRayHeaderJson
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
}

/// <summary>
/// The rolling time window an operator selects for the X-Ray — the native analogue of the web
/// <c>IngestXRayWindow</c> string-literal union (<c>'5m' | '15m' | '1h' | '6h' | '24h'</c>). Modelled as an
/// enum so the wire value, the i18n label key and the fallback copy all resolve through
/// <see cref="IngestXRayWindows"/> without stringly-typed drift.
/// </summary>
public enum IngestXRayWindow
{
    /// <summary>Five minutes (<c>5m</c>).</summary>
    M5,

    /// <summary>Fifteen minutes (<c>15m</c>).</summary>
    M15,

    /// <summary>One hour (<c>1h</c>) — the web page default.</summary>
    H1,

    /// <summary>Six hours (<c>6h</c>).</summary>
    H6,

    /// <summary>Twenty-four hours (<c>24h</c>).</summary>
    H24,
}

/// <summary>
/// The bucket granularity for the X-Ray request — the native analogue of the web <c>IngestXRayBucket</c>
/// string-literal union (<c>'30s' | '1m' | '5m' | '15m' | '1h'</c>). The header surface does not render the
/// buckets, but the value is part of the request the page composes, so it is carried for request fidelity.
/// </summary>
public enum IngestXRayBucket
{
    /// <summary>Thirty seconds (<c>30s</c>).</summary>
    S30,

    /// <summary>One minute (<c>1m</c>) — the web page default.</summary>
    M1,

    /// <summary>Five minutes (<c>5m</c>).</summary>
    M5,

    /// <summary>Fifteen minutes (<c>15m</c>).</summary>
    M15,

    /// <summary>One hour (<c>1h</c>).</summary>
    H1,
}

/// <summary>
/// Wire / i18n mapping for <see cref="IngestXRayWindow"/>. <see cref="Wire"/> is the exact server literal the
/// API validates (anything else is a 400); <see cref="LabelKey"/> / <see cref="LabelFallback"/> reproduce the
/// web <c>t(`admin.xray.windowLabel.${windowSel}`, WINDOW_LABEL[windowSel])</c> lookup so the Window stat
/// always reads as a self-explanatory summary.
/// </summary>
public static class IngestXRayWindows
{
    /// <summary>The server wire literal for <paramref name="window"/> (web <c>IngestXRayWindow</c> value).</summary>
    public static string Wire(IngestXRayWindow window) => window switch
    {
        IngestXRayWindow.M5 => "5m",
        IngestXRayWindow.M15 => "15m",
        IngestXRayWindow.H1 => "1h",
        IngestXRayWindow.H6 => "6h",
        IngestXRayWindow.H24 => "24h",
        _ => "1h",
    };

    /// <summary>The i18n key for the window label (web <c>admin.xray.windowLabel.{wire}</c>).</summary>
    public static string LabelKey(IngestXRayWindow window) => "admin.xray.windowLabel." + Wire(window);

    /// <summary>The English fallback for the window label (web <c>WINDOW_LABEL</c> map).</summary>
    public static string LabelFallback(IngestXRayWindow window) => window switch
    {
        IngestXRayWindow.M5 => "5 minutes",
        IngestXRayWindow.M15 => "15 minutes",
        IngestXRayWindow.H1 => "1 hour",
        IngestXRayWindow.H6 => "6 hours",
        IngestXRayWindow.H24 => "24 hours",
        _ => "1 hour",
    };

    /// <summary>Parse a server wire literal back to a window, defaulting to <see cref="IngestXRayWindow.H1"/>.</summary>
    public static IngestXRayWindow FromWire(string? wire) => wire switch
    {
        "5m" => IngestXRayWindow.M5,
        "15m" => IngestXRayWindow.M15,
        "1h" => IngestXRayWindow.H1,
        "6h" => IngestXRayWindow.H6,
        "24h" => IngestXRayWindow.H24,
        _ => IngestXRayWindow.H1,
    };
}

/// <summary>Wire mapping for <see cref="IngestXRayBucket"/> — the exact server literal the API validates.</summary>
public static class IngestXRayBuckets
{
    /// <summary>The server wire literal for <paramref name="bucket"/> (web <c>IngestXRayBucket</c> value).</summary>
    public static string Wire(IngestXRayBucket bucket) => bucket switch
    {
        IngestXRayBucket.S30 => "30s",
        IngestXRayBucket.M1 => "1m",
        IngestXRayBucket.M5 => "5m",
        IngestXRayBucket.M15 => "15m",
        IngestXRayBucket.H1 => "1h",
        _ => "1m",
    };
}

/// <summary>
/// The header-relevant slice of <c>GET /system/ingest-xray/{vehicleID}</c> — the native analogue of the web
/// <c>IngestXRayResponse</c> fields the strip reads (<c>total_samples</c>, <c>unique_fields</c>, plus the
/// echoed <c>window</c>/<c>bucket</c>/<c>generated_at</c>). Field names mirror the Go API's snake_case JSON
/// tags; parsing is null-tolerant so a partial body never throws. Pure data — no WinUI types.
/// </summary>
public sealed record IngestXRaySummary(
    long TotalSamples,
    long UniqueFields,
    string Window,
    string Bucket,
    string? GeneratedAt)
{
    /// <summary>An all-zero summary (the parse fallback for an absent / non-object body).</summary>
    public static IngestXRaySummary Empty { get; } = new(0, 0, string.Empty, string.Empty, null);

    /// <summary>Project an ingest-xray JSON object into a tolerant <see cref="IngestXRaySummary"/>.</summary>
    public static IngestXRaySummary FromJson(JsonElement obj)
    {
        if (obj.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        return new IngestXRaySummary(
            TotalSamples: XRayHeaderJson.GetLong(obj, "total_samples") ?? 0,
            UniqueFields: XRayHeaderJson.GetLong(obj, "unique_fields") ?? 0,
            Window: XRayHeaderJson.GetString(obj, "window") ?? string.Empty,
            Bucket: XRayHeaderJson.GetString(obj, "bucket") ?? string.Empty,
            GeneratedAt: XRayHeaderJson.GetString(obj, "generated_at"));
    }
}

/// <summary>
/// The lifecycle state the X-Ray header strip can be in. Every branch maps onto a visible surface — none is
/// ever hidden (engineering rule #6). The web component itself renders only <c>loading</c> ('—') versus a
/// populated value (its parent page owns error/offline/empty); the self-contained native surface renders an
/// explicit <c>Empty</c>, <c>Stale</c>, <c>Offline</c> and <c>Error</c> (retry) branch too — a strict
/// superset of the web that satisfies the prompt's mandated state set.
/// </summary>
public enum XRayHeaderState
{
    /// <summary>First fetch with nothing cached — the stat values read '—'.</summary>
    Loading,

    /// <summary>A fresh (network or non-stale cache) result with sample counts to show.</summary>
    Ready,

    /// <summary>The read resolved with zero samples / no vehicle — the cards plus a friendly hint.</summary>
    Empty,

    /// <summary>A cached result older than the freshness window — values plus a stale chip (auto-refreshing).</summary>
    Stale,

    /// <summary>The network failed but cached values remain — values plus an offline chip.</summary>
    Offline,

    /// <summary>The read failed and no cached value exists — '—' plus a retry affordance.</summary>
    Error,
}

/// <summary>
/// The fully projected, render-ready values for the three stat cards — the native analogue of the web
/// <c>XRayHeader</c> render output. <see cref="SamplesValue"/> / <see cref="FieldsValue"/> are pre-formatted
/// (grouped integers or the em-dash); <see cref="WindowValue"/> is the localized window label. Pure data.
/// </summary>
public sealed record XRayHeaderDisplay(string SamplesValue, string FieldsValue, string WindowValue);

/// <summary>
/// Pure projection from a parsed <see cref="IngestXRaySummary"/> (and the selected window) to the three
/// render-ready stat values — the native port of the web <c>fmtInt(data?.total_samples ?? 0)</c> /
/// <c>fmtInt(data?.unique_fields ?? 0)</c> / window-label render. A null summary (no value yet, or a hard
/// failure with no cache) yields the em-dash exactly like the web <c>loading ? '—' : …</c> gate. Every label
/// resolves through the i18n facade. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class XRayHeaderProjection
{
    /// <summary>Em-dash fallback for an absent value (web parity '—').</summary>
    public const string EmDash = "\u2014";

    /// <summary>Project the three stat values for <paramref name="summary"/> under <paramref name="window"/>.</summary>
    public static XRayHeaderDisplay Project(IngestXRaySummary? summary, IngestXRayWindow window, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        string samples = summary is null ? EmDash : FormatInt(summary.TotalSamples);
        string fields = summary is null ? EmDash : FormatInt(summary.UniqueFields);
        return new XRayHeaderDisplay(samples, fields, WindowLabel(window, localizer));
    }

    /// <summary>The localized window label (web <c>t(admin.xray.windowLabel.{w}, WINDOW_LABEL[w])</c>).</summary>
    public static string WindowLabel(IngestXRayWindow window, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(IngestXRayWindows.LabelKey(window), IngestXRayWindows.LabelFallback(window));
    }

    /// <summary>Format an integer with en-US grouping — the native port of the web <c>fmtInt</c>.</summary>
    public static string FormatInt(long value) => NumberFormatting.Format(value, null, 0);
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions to typed
/// <c>RepositoryResult&lt;IngestXRaySummary&gt;</c>, preserving the cache-then-network status/freshness while
/// parsing the snake_case payload (the native analogue of the web hook's typed query result). The ingest
/// X-Ray endpoint always returns a populated object even for a zero-sample window, so the mapper never
/// collapses a content body to empty — the zero-sample "empty" treatment is decided by the view-model from
/// <see cref="IngestXRaySummary.TotalSamples"/>. Pure — unit-tested without a network or cache.
/// </summary>
public static class XRayHeaderResultMapper
{
    /// <summary>Map a raw ingest-xray emission to a typed summary result.</summary>
    public static RepositoryResult<IngestXRaySummary> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        switch (raw.Status)
        {
            case LoadStatus.Loading:
                return RepositoryResult<IngestXRaySummary>.Loading();

            case LoadStatus.Empty:
                return RepositoryResult<IngestXRaySummary>.Empty(raw.FetchedAt);

            case LoadStatus.Error:
                return RepositoryResult<IngestXRaySummary>.Failure(
                    raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error"));
        }

        var summary = IngestXRaySummary.FromJson(raw.Value);
        var fetchedAt = raw.FetchedAt ?? DateTimeOffset.UtcNow;

        return raw.Status switch
        {
            LoadStatus.Cached => RepositoryResult<IngestXRaySummary>.Cached(summary, fetchedAt, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<IngestXRaySummary>.Refreshing(summary, fetchedAt, raw.IsStale),
            LoadStatus.Offline => RepositoryResult<IngestXRaySummary>.OfflineCached(
                summary, fetchedAt, raw.Error ?? new RepositoryError(RepositoryErrorKind.Network, "Offline")),
            _ => RepositoryResult<IngestXRaySummary>.Loaded(summary, fetchedAt),
        };
    }
}

/// <summary>
/// Canonical registry metadata for the Ingest X-Ray header surface — the native mirror of the web component
/// (web/src/features/admin/components/ingest-xray/XRayHeader.tsx). Centralises the stable id, the diagnostics
/// slug, the three Segoe Fluent glyphs standing in for the web Lucide icons, the request default, and the
/// localized copy so the view and view-model stay free of literal strings.
/// </summary>
public static class XRayHeaderRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "ingest-xray-header";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "XRayHeader";

    /// <summary>Segoe Fluent "Health" glyph — the native stand-in for the web Lucide <c>Activity</c> icon.</summary>
    public const string SamplesGlyph = "\uE9D9";

    /// <summary>Segoe Fluent "MapLayers" glyph — the native stand-in for the web Lucide <c>Layers</c> icon.</summary>
    public const string FieldsGlyph = "\uE81E";

    /// <summary>Segoe Fluent "Stopwatch" glyph — the native stand-in for the web Lucide <c>Clock</c> icon.</summary>
    public const string WindowGlyph = "\uE916";

    /// <summary>The default <c>fields</c> row cap the page requests (web <c>limit: 100</c>).</summary>
    public const int DefaultLimit = 100;

    /// <summary>"Total samples" stat label (web <c>admin.xray.stats.samples</c>).</summary>
    public static string SamplesLabel(ILocalizer localizer) =>
        Require(localizer).GetString("admin.xray.stats.samples", "Total samples");

    /// <summary>"within selected window" stat sub-label (web <c>admin.xray.stats.samplesSub</c>).</summary>
    public static string SamplesSublabel(ILocalizer localizer) =>
        Require(localizer).GetString("admin.xray.stats.samplesSub", "within selected window");

    /// <summary>"Distinct fields" stat label (web <c>admin.xray.stats.fields</c>).</summary>
    public static string FieldsLabel(ILocalizer localizer) =>
        Require(localizer).GetString("admin.xray.stats.fields", "Distinct fields");

    /// <summary>"unique signal names" stat sub-label (web <c>admin.xray.stats.fieldsSub</c>).</summary>
    public static string FieldsSublabel(ILocalizer localizer) =>
        Require(localizer).GetString("admin.xray.stats.fieldsSub", "unique signal names");

    /// <summary>"Window" stat label (web <c>admin.xray.stats.window</c>).</summary>
    public static string WindowTitle(ILocalizer localizer) =>
        Require(localizer).GetString("admin.xray.stats.window", "Window");

    /// <summary>"observation horizon" stat sub-label (web <c>admin.xray.stats.windowSub</c>).</summary>
    public static string WindowSublabel(ILocalizer localizer) =>
        Require(localizer).GetString("admin.xray.stats.windowSub", "observation horizon");

    /// <summary>Stale freshness chip label (native superset; the web parent owns freshness).</summary>
    public static string StaleLabel(ILocalizer localizer) =>
        Require(localizer).GetString("admin.xray.status.stale", "Stale");

    /// <summary>Offline freshness chip label (native superset).</summary>
    public static string OfflineLabel(ILocalizer localizer) =>
        Require(localizer).GetString("admin.xray.status.offline", "Offline");

    /// <summary>Retry affordance label for the hard-error branch (native superset).</summary>
    public static string RetryLabel(ILocalizer localizer) =>
        Require(localizer).GetString("admin.xray.status.retry", "Retry");

    /// <summary>Hard-error message (native superset; web parent renders QueryError).</summary>
    public static string ErrorText(ILocalizer localizer) =>
        Require(localizer).GetString("admin.xray.status.error", "Couldn't load ingest X-Ray");

    /// <summary>Offline message shown alongside the cached values (native superset).</summary>
    public static string OfflineText(ILocalizer localizer) =>
        Require(localizer).GetString(
            "admin.xray.status.offlineMessage", "You're offline — showing the last cached X-Ray");

    /// <summary>Loading announcement (reuses the existing <c>admin.xray.fields.loading</c> key).</summary>
    public static string LoadingLabel(ILocalizer localizer) =>
        Require(localizer).GetString("admin.xray.fields.loading", "Loading\u2026");

    /// <summary>Zero-sample empty hint (reuses the existing <c>admin.xray.fields.empty</c> key).</summary>
    public static string EmptyHint(ILocalizer localizer) =>
        Require(localizer).GetString(
            "admin.xray.fields.empty",
            "No samples in this window. Try widening the window or confirm the vehicle is publishing.");

    private static ILocalizer Require(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer;
    }
}

/// <summary>
/// PII-safe diagnostics for the Ingest X-Ray header surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a vehicle id, count or any operator
/// data — so a diagnostics line can never leak telemetry. Thread-safe.
/// </summary>
public sealed class XRayHeaderDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional operational-only line sink (no user data is ever passed).</param>
    public XRayHeaderDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=XRayHeader</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={XRayHeaderRegistration.Slug}");
    }
}
