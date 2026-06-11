using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// Null-tolerant <see cref="JsonElement"/> readers for the Service Health surface. Every getter returns a
/// nullable / fallback rather than throwing so a partial or schema-drifted body from
/// <c>GET /telemetry</c> never aborts the parse (web parity: the React component tolerates undefined fields
/// and renders the em-dash / zero fallback). Kept private to the surface and free of WinUI types so the parse
/// is unit-tested without a UI host.
/// </summary>
internal static class ServiceHealthJson
{
    /// <summary>The string value of <paramref name="name"/>, or null when absent / not a JSON string.</summary>
    public static string? GetString(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object
        && obj.TryGetProperty(name, out var prop)
        && prop.ValueKind == JsonValueKind.String
            ? prop.GetString()
            : null;

    /// <summary>
    /// The value of <paramref name="name"/> rendered as a string, tolerating either a JSON string or a JSON
    /// number (the Go handler emits <c>avg_signals_per_second</c> as a pre-formatted string, but a numeric
    /// payload is accepted defensively). Null when absent / another kind.
    /// </summary>
    public static string? GetStringOrNumber(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var prop))
        {
            return null;
        }

        return prop.ValueKind switch
        {
            JsonValueKind.String => prop.GetString(),
            JsonValueKind.Number => prop.GetRawText(),
            _ => null,
        };
    }

    /// <summary>The integer value of <paramref name="name"/>, tolerating a numeric or numeric-string field.</summary>
    public static long GetLong(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var prop))
        {
            return 0;
        }

        return prop.ValueKind switch
        {
            JsonValueKind.Number when prop.TryGetInt64(out var n) => n,
            JsonValueKind.Number when prop.TryGetDouble(out var d) => (long)d,
            JsonValueKind.String when long.TryParse(prop.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var s) => s,
            _ => 0,
        };
    }

    /// <summary>The double value of <paramref name="name"/>, tolerating a numeric or numeric-string field.</summary>
    public static double GetDouble(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var prop))
        {
            return 0;
        }

        return prop.ValueKind switch
        {
            JsonValueKind.Number when prop.TryGetDouble(out var n) => n,
            JsonValueKind.String when double.TryParse(prop.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var s) => s,
            _ => 0,
        };
    }

    /// <summary>The boolean value of <paramref name="name"/>, or false when absent / not a JSON boolean.</summary>
    public static bool GetBool(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object
        && obj.TryGetProperty(name, out var prop)
        && prop.ValueKind is JsonValueKind.True or JsonValueKind.False
        && prop.GetBoolean();

    /// <summary>The object value of <paramref name="name"/>, or the undefined element when absent / another kind.</summary>
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
/// One streaming-vehicle entry from <c>streaming_vehicles</c> in <c>GET /telemetry</c> — the native analogue
/// of the web <c>VehicleTelemetry</c> shape (web/src/types/telemetry.ts). Field names mirror the Go API's
/// snake_case JSON tags; parsing is null-tolerant so a partial row never throws. The raw <c>last_received</c>
/// string is kept and parsed on demand (web parity — the web passes it straight to <c>formatDateTime</c>).
/// </summary>
public sealed record ServiceHealthVehicle(
    string Vin,
    bool IsStreaming,
    long SignalCount,
    double SignalsPerSecond,
    double LatencyMs,
    string? LastReceivedAt)
{
    /// <summary>The parsed last-received instant, or null when absent / unparseable.</summary>
    public DateTimeOffset? LastReceived => ServiceHealthJson.TryParseTimestamp(LastReceivedAt);

    /// <summary>Project a single streaming-vehicle JSON object into a <see cref="ServiceHealthVehicle"/>.</summary>
    /// <param name="obj">The per-VIN entry object.</param>
    /// <param name="fallbackVin">The map key, used when the entry omits its own <c>vin</c> field.</param>
    public static ServiceHealthVehicle FromJson(JsonElement obj, string fallbackVin) => new(
        Vin: ServiceHealthJson.GetString(obj, "vin") ?? fallbackVin,
        IsStreaming: ServiceHealthJson.GetBool(obj, "is_streaming"),
        SignalCount: ServiceHealthJson.GetLong(obj, "signal_count"),
        SignalsPerSecond: ServiceHealthJson.GetDouble(obj, "signals_per_second"),
        LatencyMs: ServiceHealthJson.GetDouble(obj, "latency_ms"),
        LastReceivedAt: ServiceHealthJson.GetString(obj, "last_received"));
}

/// <summary>
/// The parsed <c>GET /telemetry</c> body — the native analogue of the web <c>TelemetryStatus</c> the
/// component reads (web/src/types/telemetry.ts plus the <c>enabled</c> / <c>mode</c> / <c>aggregate_stats</c>
/// fields the Go handler emits, see internal/api/telemetry/telemetry_handler.go). A present snapshot maps to
/// the web's truthy <c>data</c>; the cache-then-network engine collapses a non-object body to
/// <see cref="LoadStatus.Empty"/> so the section renders its "No telemetry data available" empty surface (web
/// <c>!data</c> branch). Pure data — unit-tested without a UI host.
/// </summary>
public sealed record ServiceHealthSnapshot(
    bool Enabled,
    string Mode,
    long TotalSignalsReceived,
    string? AvgSignalsPerSecond,
    IReadOnlyList<ServiceHealthVehicle> Vehicles)
{
    /// <summary>An empty snapshot (the projection fallback for the section-empty branch).</summary>
    public static ServiceHealthSnapshot Empty { get; } =
        new(false, string.Empty, 0, null, Array.Empty<ServiceHealthVehicle>());

    /// <summary>Number of vehicles currently streaming (web <c>vehicles.filter(v =&gt; v.is_streaming).length</c>).</summary>
    public int ActiveCount
    {
        get
        {
            int count = 0;
            foreach (var vehicle in Vehicles)
            {
                if (vehicle.IsStreaming)
                {
                    count++;
                }
            }

            return count;
        }
    }

    /// <summary>Project a <c>GET /telemetry</c> JSON object into a tolerant snapshot.</summary>
    public static ServiceHealthSnapshot FromJson(JsonElement obj)
    {
        if (obj.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        var aggregate = ServiceHealthJson.GetObject(obj, "aggregate_stats");

        return new ServiceHealthSnapshot(
            Enabled: ServiceHealthJson.GetBool(obj, "enabled"),
            Mode: ServiceHealthJson.GetString(obj, "mode") ?? string.Empty,
            TotalSignalsReceived: ServiceHealthJson.GetLong(aggregate, "total_signals_received"),
            AvgSignalsPerSecond: ServiceHealthJson.GetStringOrNumber(aggregate, "avg_signals_per_second"),
            Vehicles: ParseVehicles(ServiceHealthJson.GetObject(obj, "streaming_vehicles")));
    }

    private static IReadOnlyList<ServiceHealthVehicle> ParseVehicles(JsonElement streamingVehicles)
    {
        if (streamingVehicles.ValueKind != JsonValueKind.Object)
        {
            return Array.Empty<ServiceHealthVehicle>();
        }

        var list = new List<ServiceHealthVehicle>();
        foreach (var entry in streamingVehicles.EnumerateObject())
        {
            if (entry.Value.ValueKind == JsonValueKind.Object)
            {
                list.Add(ServiceHealthVehicle.FromJson(entry.Value, entry.Name));
            }
        }

        return list;
    }
}

/// <summary>
/// A single streaming-vehicle's signal count rendered for the vehicles table. Carries the grouped display
/// string (web <c>fmtInt</c>) yet sorts on the raw <see cref="Value"/> so the shared <c>TsDataTable</c>
/// column reproduces the web's numeric <c>sortable</c> behaviour without losing thousands grouping (the table
/// renders <see cref="object.ToString"/> and sorts via <see cref="IComparable"/>). Pure data.
/// </summary>
public readonly record struct SignalCountCell(long Value, string Display) : IComparable, IComparable<SignalCountCell>
{
    /// <summary>Order by the raw signal count.</summary>
    public int CompareTo(SignalCountCell other) => Value.CompareTo(other.Value);

    /// <inheritdoc />
    public int CompareTo(object? obj) => obj is SignalCountCell other ? CompareTo(other) : 1;

    /// <summary>The grouped display string shown in the cell.</summary>
    public override string ToString() => Display;

    /// <summary>Less-than over the raw signal count.</summary>
    public static bool operator <(SignalCountCell left, SignalCountCell right) => left.Value < right.Value;

    /// <summary>Greater-than over the raw signal count.</summary>
    public static bool operator >(SignalCountCell left, SignalCountCell right) => left.Value > right.Value;

    /// <summary>Less-than-or-equal over the raw signal count.</summary>
    public static bool operator <=(SignalCountCell left, SignalCountCell right) => left.Value <= right.Value;

    /// <summary>Greater-than-or-equal over the raw signal count.</summary>
    public static bool operator >=(SignalCountCell left, SignalCountCell right) => left.Value >= right.Value;
}

/// <summary>
/// One projected, render-ready vehicle row — the native analogue of a <c>vehicleColumns</c> row in
/// web/src/features/system/components/status/ServiceHealthSection.tsx. Holds the VIN, the localized streaming
/// status text + its semantic <see cref="StatusKind"/>, the grouped signal count (sortable), the formatted
/// signals/second and latency strings, the formatted last-received timestamp, and a Narrator name. Pure data.
/// </summary>
public sealed record ServiceHealthVehicleRow(
    string Vin,
    string StatusText,
    StatusKind StatusKind,
    SignalCountCell SignalCount,
    string SignalsPerSecondText,
    string LatencyText,
    string LastReceivedText,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the Service Health surface — the native analogue of everything
/// the web component resolves before returning JSX (the enabled / streaming header badges, the four metric
/// tiles, and the vehicles table rows). <see cref="HasVehicles"/> reproduces the web table/empty gate, and
/// the header badge fields mirror the web <c>data ? &lt;&gt;…&lt;/&gt; : undefined</c> render. Pure data.
/// </summary>
public sealed record ServiceHealthDisplay(
    bool EnabledFlag,
    string EnabledBadgeText,
    StatusKind EnabledBadgeStatus,
    int ActiveCount,
    string StreamingBadgeText,
    string ModeValue,
    string VehiclesConnectedValue,
    string TotalSignalsValue,
    string AvgSignalsValue,
    bool HasVehicles,
    IReadOnlyList<ServiceHealthVehicleRow> VehicleRows)
{
    /// <summary>An empty display (the projection fallback for the section-empty branch).</summary>
    public static ServiceHealthDisplay Empty { get; } = new(
        false,
        string.Empty,
        StatusKind.Neutral,
        0,
        string.Empty,
        string.Empty,
        "0",
        "0",
        "0",
        false,
        Array.Empty<ServiceHealthVehicleRow>());
}

/// <summary>
/// Pure projection from a parsed <see cref="ServiceHealthSnapshot"/> to its <see cref="ServiceHealthDisplay"/>
/// — the native port of the render functions in
/// web/src/features/system/components/status/ServiceHealthSection.tsx: the <c>enabled?'success':'neutral'</c>
/// header badge, the <c>{activeCount} streaming</c> info badge, the four <c>MetricCard</c> values
/// (<c>fmtInt</c> total signals, the <c>?? '0'</c> average), and the vehicle rows (<c>is_streaming</c> status
/// badge, <c>fmtInt</c> / <c>fmtNumber</c> formatting, <c>formatDateTime</c> last-received). <c>now</c> is
/// injected so the timestamp formatting is unit-tested deterministically; every label resolves through the
/// i18n facade. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class ServiceHealthProjection
{
    /// <summary>Project <paramref name="snapshot"/> into a render-ready display using the i18n facade.</summary>
    public static ServiceHealthDisplay Project(ServiceHealthSnapshot snapshot, ILocalizer localizer, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentNullException.ThrowIfNull(localizer);

        int active = snapshot.ActiveCount;
        string streaming = localizer.GetString(ServiceHealthCopy.StreamingSuffixKey, ServiceHealthCopy.StreamingSuffix);
        string enabledText = snapshot.Enabled
            ? localizer.GetString(ServiceHealthCopy.EnabledKey, ServiceHealthCopy.Enabled)
            : localizer.GetString(ServiceHealthCopy.DisabledKey, ServiceHealthCopy.Disabled);

        var rows = new List<ServiceHealthVehicleRow>(snapshot.Vehicles.Count);
        foreach (var vehicle in snapshot.Vehicles)
        {
            rows.Add(ProjectRow(vehicle, localizer, now));
        }

        return new ServiceHealthDisplay(
            EnabledFlag: snapshot.Enabled,
            EnabledBadgeText: enabledText,
            EnabledBadgeStatus: snapshot.Enabled ? StatusKind.Success : StatusKind.Neutral,
            ActiveCount: active,
            StreamingBadgeText: string.Format(CultureInfo.CurrentCulture, "{0} {1}", active, streaming),
            ModeValue: snapshot.Mode,
            VehiclesConnectedValue: active.ToString(CultureInfo.CurrentCulture),
            TotalSignalsValue: NumberFormatting.Format(snapshot.TotalSignalsReceived, null, 0),
            AvgSignalsValue: string.IsNullOrEmpty(snapshot.AvgSignalsPerSecond) ? "0" : snapshot.AvgSignalsPerSecond!,
            HasVehicles: rows.Count > 0,
            VehicleRows: rows);
    }

    private static ServiceHealthVehicleRow ProjectRow(ServiceHealthVehicle vehicle, ILocalizer localizer, DateTimeOffset now)
    {
        string statusText = vehicle.IsStreaming
            ? localizer.GetString(ServiceHealthCopy.StatusStreamingKey, ServiceHealthCopy.StatusStreaming)
            : localizer.GetString(ServiceHealthCopy.StatusIdleKey, ServiceHealthCopy.StatusIdle);

        string signalsText = NumberFormatting.Format(vehicle.SignalCount, null, 0);
        string perSecond = NumberFormatting.Format(vehicle.SignalsPerSecond, null, 1);
        string latency = string.Format(
            CultureInfo.CurrentCulture, "{0} ms", NumberFormatting.Format(vehicle.LatencyMs, null, 0));
        string lastReceived = DateTimeFormatting.Format(vehicle.LastReceived, DateTimeVariant.Full, now);

        string vin = string.IsNullOrEmpty(vehicle.Vin) ? DateTimeFormatting.DefaultEmptyDisplay : vehicle.Vin;

        return new ServiceHealthVehicleRow(
            Vin: vin,
            StatusText: statusText,
            StatusKind: vehicle.IsStreaming ? StatusKind.Success : StatusKind.Neutral,
            SignalCount: new SignalCountCell(vehicle.SignalCount, signalsText),
            SignalsPerSecondText: perSecond,
            LatencyText: latency,
            LastReceivedText: lastReceived,
            AutomationName: BuildRowAutomationName(vin, statusText, signalsText, perSecond, latency, lastReceived, localizer));
    }

    private static string BuildRowAutomationName(
        string vin,
        string statusText,
        string signalsText,
        string perSecond,
        string latency,
        string lastReceived,
        ILocalizer localizer)
    {
        string signalsLabel = localizer.GetString(ServiceHealthCopy.ColSignalsKey, ServiceHealthCopy.ColSignals);
        string perSecondLabel = localizer.GetString(ServiceHealthCopy.ColSignalsPerSecondKey, ServiceHealthCopy.ColSignalsPerSecond);
        string latencyLabel = localizer.GetString(ServiceHealthCopy.ColLatencyKey, ServiceHealthCopy.ColLatency);
        string lastReceivedLabel = localizer.GetString(ServiceHealthCopy.ColLastReceivedKey, ServiceHealthCopy.ColLastReceived);

        // Reading order matches the web row (VIN, status, then the formatted metrics).
        return string.Format(
            CultureInfo.CurrentCulture,
            "{0}, {1}, {2}: {3}, {4}: {5}, {6}: {7}, {8}: {9}",
            vin,
            statusText,
            signalsLabel,
            signalsText,
            perSecondLabel,
            perSecond,
            latencyLabel,
            latency,
            lastReceivedLabel,
            lastReceived);
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions to typed
/// <c>RepositoryResult&lt;ServiceHealthSnapshot&gt;</c>, preserving the cache-then-network status / freshness
/// while parsing the snake_case payload (the native analogue of the web hook's typed query result). A
/// non-object body has already been classified <see cref="LoadStatus.Empty"/> by the source's empty
/// predicate, so the section renders its empty surface. Pure — unit-tested without a network or cache.
/// </summary>
public static class ServiceHealthResultMapper
{
    /// <summary>Map a raw <c>GET /telemetry</c> emission to a typed snapshot result.</summary>
    public static RepositoryResult<ServiceHealthSnapshot> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        switch (raw.Status)
        {
            case LoadStatus.Loading:
                return RepositoryResult<ServiceHealthSnapshot>.Loading();

            case LoadStatus.Empty:
                return RepositoryResult<ServiceHealthSnapshot>.Empty(raw.FetchedAt);

            case LoadStatus.Error:
                return RepositoryResult<ServiceHealthSnapshot>.Failure(
                    raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error"));
        }

        var snapshot = ServiceHealthSnapshot.FromJson(raw.Value);
        var fetchedAt = raw.FetchedAt ?? DateTimeOffset.UtcNow;

        return raw.Status switch
        {
            LoadStatus.Cached => RepositoryResult<ServiceHealthSnapshot>.Cached(snapshot, fetchedAt, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<ServiceHealthSnapshot>.Refreshing(snapshot, fetchedAt, raw.IsStale),
            LoadStatus.Offline => RepositoryResult<ServiceHealthSnapshot>.OfflineCached(
                snapshot, fetchedAt, raw.Error ?? new RepositoryError(RepositoryErrorKind.Network, "Offline")),
            _ => RepositoryResult<ServiceHealthSnapshot>.Loaded(snapshot, fetchedAt),
        };
    }
}

/// <summary>
/// Canonical i18n keys + English fallbacks for the Service Health surface — every <c>t(...)</c> string in
/// web/src/features/system/components/status/ServiceHealthSection.tsx, mapped to a dotted
/// <c>featureView.serviceHealth.*</c> key whose fallback is the verbatim web copy (P1/S10 catalog parity).
/// Centralised so the view, view-model and projection share one keyed call site.
/// </summary>
public static class ServiceHealthCopy
{
    /// <summary>Accordion title key (web <c>t('Service Health')</c>).</summary>
    public const string TitleKey = "featureView.serviceHealth.title";

    /// <summary>Accordion title fallback.</summary>
    public const string Title = "Service Health";

    /// <summary>Accordion description key (web <c>t('Fleet Telemetry streaming status')</c>).</summary>
    public const string DescriptionKey = "featureView.serviceHealth.description";

    /// <summary>Accordion description fallback.</summary>
    public const string Description = "Fleet Telemetry streaming status";

    /// <summary>Enabled badge key (web <c>t('Enabled')</c>).</summary>
    public const string EnabledKey = "featureView.serviceHealth.enabled";

    /// <summary>Enabled badge fallback.</summary>
    public const string Enabled = "Enabled";

    /// <summary>Disabled badge key (web <c>t('Disabled')</c>).</summary>
    public const string DisabledKey = "featureView.serviceHealth.disabled";

    /// <summary>Disabled badge fallback.</summary>
    public const string Disabled = "Disabled";

    /// <summary>Streaming-count badge suffix key (web <c>t('streaming')</c>).</summary>
    public const string StreamingSuffixKey = "featureView.serviceHealth.streaming";

    /// <summary>Streaming-count badge suffix fallback.</summary>
    public const string StreamingSuffix = "streaming";

    /// <summary>Mode metric label key (web <c>t('Mode')</c>).</summary>
    public const string MetricModeKey = "featureView.serviceHealth.metric.mode";

    /// <summary>Mode metric label fallback.</summary>
    public const string MetricMode = "Mode";

    /// <summary>Vehicles-connected metric label key (web <c>t('Vehicles Connected')</c>).</summary>
    public const string MetricVehiclesConnectedKey = "featureView.serviceHealth.metric.vehiclesConnected";

    /// <summary>Vehicles-connected metric label fallback.</summary>
    public const string MetricVehiclesConnected = "Vehicles Connected";

    /// <summary>Total-signals metric label key (web <c>t('Total Signals')</c>).</summary>
    public const string MetricTotalSignalsKey = "featureView.serviceHealth.metric.totalSignals";

    /// <summary>Total-signals metric label fallback.</summary>
    public const string MetricTotalSignals = "Total Signals";

    /// <summary>Average-signals-per-second metric label key (web <c>t('Avg Signals/s')</c>).</summary>
    public const string MetricAvgSignalsKey = "featureView.serviceHealth.metric.avgSignals";

    /// <summary>Average-signals-per-second metric label fallback.</summary>
    public const string MetricAvgSignals = "Avg Signals/s";

    /// <summary>VIN column header key (web <c>t('VIN')</c>).</summary>
    public const string ColVinKey = "featureView.serviceHealth.col.vin";

    /// <summary>VIN column header fallback.</summary>
    public const string ColVin = "VIN";

    /// <summary>Status column header key (web <c>t('Status')</c>).</summary>
    public const string ColStatusKey = "featureView.serviceHealth.col.status";

    /// <summary>Status column header fallback.</summary>
    public const string ColStatus = "Status";

    /// <summary>Signals column header key (web <c>t('Signals')</c>).</summary>
    public const string ColSignalsKey = "featureView.serviceHealth.col.signals";

    /// <summary>Signals column header fallback.</summary>
    public const string ColSignals = "Signals";

    /// <summary>Signals/second column header key (web <c>t('Signals/s')</c>).</summary>
    public const string ColSignalsPerSecondKey = "featureView.serviceHealth.col.signalsPerSecond";

    /// <summary>Signals/second column header fallback.</summary>
    public const string ColSignalsPerSecond = "Signals/s";

    /// <summary>Latency column header key (web <c>t('Latency')</c>).</summary>
    public const string ColLatencyKey = "featureView.serviceHealth.col.latency";

    /// <summary>Latency column header fallback.</summary>
    public const string ColLatency = "Latency";

    /// <summary>Last-received column header key (web <c>t('Last Received')</c>).</summary>
    public const string ColLastReceivedKey = "featureView.serviceHealth.col.lastReceived";

    /// <summary>Last-received column header fallback.</summary>
    public const string ColLastReceived = "Last Received";

    /// <summary>Streaming row-status key (web <c>t('Streaming')</c>).</summary>
    public const string StatusStreamingKey = "featureView.serviceHealth.status.streaming";

    /// <summary>Streaming row-status fallback.</summary>
    public const string StatusStreaming = "Streaming";

    /// <summary>Idle row-status key (web <c>t('Idle')</c>).</summary>
    public const string StatusIdleKey = "featureView.serviceHealth.status.idle";

    /// <summary>Idle row-status fallback.</summary>
    public const string StatusIdle = "Idle";

    /// <summary>Section-empty message key (web <c>t('No telemetry data available')</c>).</summary>
    public const string NoDataKey = "featureView.serviceHealth.noData";

    /// <summary>Section-empty message fallback.</summary>
    public const string NoData = "No telemetry data available";

    /// <summary>Vehicles-table empty message key (web <c>t('No vehicles connected')</c>).</summary>
    public const string NoVehiclesKey = "featureView.serviceHealth.noVehicles";

    /// <summary>Vehicles-table empty message fallback.</summary>
    public const string NoVehicles = "No vehicles connected";

    /// <summary>Loading announcement key (native a11y live-region copy).</summary>
    public const string LoadingKey = "featureView.serviceHealth.loading";

    /// <summary>Loading announcement fallback.</summary>
    public const string Loading = "Loading service health";

    /// <summary>Retry affordance key (native error-state copy).</summary>
    public const string RetryKey = "featureView.serviceHealth.retry";

    /// <summary>Retry affordance fallback.</summary>
    public const string Retry = "Retry";

    /// <summary>Default hard-error message key (native error-state copy).</summary>
    public const string ErrorKey = "featureView.serviceHealth.error";

    /// <summary>Default hard-error message fallback.</summary>
    public const string Error = "Couldn't load service health";

    /// <summary>Offline message key (native offline-state copy).</summary>
    public const string OfflineKey = "featureView.serviceHealth.offline";

    /// <summary>Offline message fallback.</summary>
    public const string Offline = "You're offline — showing the last cached telemetry";

    /// <summary>Re-auth message key (native unauthorized-state copy).</summary>
    public const string AuthKey = "featureView.serviceHealth.auth";

    /// <summary>Re-auth message fallback.</summary>
    public const string Auth = "Sign in to view service health";
}

/// <summary>
/// Canonical registry metadata for the Service Health surface — the native mirror of the web component at
/// <c>web/src/features/system/components/status/ServiceHealthSection.tsx</c>. Holds the stable id, the
/// diagnostics slug, and the localized accordion title/description. UI-free so the metadata is asserted in
/// tests.
/// </summary>
public static class ServiceHealthRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "service-health-section";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "ServiceHealthSection";

    /// <summary>Localized accordion title (web <c>t('Service Health')</c>).</summary>
    public static string Title(ILocalizer localizer) =>
        Require(localizer).GetString(ServiceHealthCopy.TitleKey, ServiceHealthCopy.Title);

    /// <summary>Localized accordion description (web <c>t('Fleet Telemetry streaming status')</c>).</summary>
    public static string Description(ILocalizer localizer) =>
        Require(localizer).GetString(ServiceHealthCopy.DescriptionKey, ServiceHealthCopy.Description);

    private static ILocalizer Require(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer;
    }
}

/// <summary>
/// PII-safe diagnostics for the Service Health surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a VIN or any fleet value — so a
/// diagnostics line can never leak which vehicle was involved. Thread-safe.
/// </summary>
public sealed class ServiceHealthDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public ServiceHealthDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ServiceHealthSection</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={ServiceHealthRegistration.Slug}");
    }
}
