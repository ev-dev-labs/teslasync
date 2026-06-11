using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// Null-tolerant <see cref="JsonElement"/> readers for the Telemetry Pipeline surface. Every getter returns
/// a nullable / fallback rather than throwing so a partial or schema-drifted row from <c>GET /telemetry/</c>
/// (web <c>useMQTTStatus</c>) or <c>GET /polling/status</c> (web <c>getPollingStatus</c>) never aborts the
/// parse — web parity, where the hooks tolerate undefined fields and render the em-dash. Both the camelCase
/// and snake_case spellings the Go API emits (e.g. <c>lastReceived</c> / <c>last_received</c>) are accepted.
/// Kept private to the surface and free of WinUI types so the parse is unit-tested without a UI host.
/// </summary>
internal static class TelemetryPipelineCardJson
{
    /// <summary>The string value of the first present alias, or null when absent / not a JSON string.</summary>
    public static string? GetString(JsonElement obj, params string[] names)
    {
        if (obj.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        foreach (var name in names)
        {
            if (obj.TryGetProperty(name, out var prop) && prop.ValueKind == JsonValueKind.String)
            {
                return prop.GetString();
            }
        }

        return null;
    }

    /// <summary>The double value of the first present alias, tolerating a numeric or numeric-string field.</summary>
    public static double? GetDouble(JsonElement obj, params string[] names)
    {
        if (obj.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        foreach (var name in names)
        {
            if (!obj.TryGetProperty(name, out var prop))
            {
                continue;
            }

            switch (prop.ValueKind)
            {
                case JsonValueKind.Number when prop.TryGetDouble(out var n):
                    return n;
                case JsonValueKind.String when double.TryParse(
                    prop.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var s):
                    return s;
            }
        }

        return null;
    }

    /// <summary>The long value of the first present alias, tolerating a numeric or numeric-string field.</summary>
    public static long? GetLong(JsonElement obj, params string[] names)
    {
        if (obj.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        foreach (var name in names)
        {
            if (!obj.TryGetProperty(name, out var prop))
            {
                continue;
            }

            switch (prop.ValueKind)
            {
                case JsonValueKind.Number when prop.TryGetInt64(out var n):
                    return n;
                case JsonValueKind.String when long.TryParse(
                    prop.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var s):
                    return s;
            }
        }

        return null;
    }

    /// <summary>The boolean value of the first present alias, or null when absent / not a JSON boolean.</summary>
    public static bool? GetBool(JsonElement obj, params string[] names)
    {
        if (obj.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        foreach (var name in names)
        {
            if (obj.TryGetProperty(name, out var prop) && prop.ValueKind is JsonValueKind.True or JsonValueKind.False)
            {
                return prop.GetBoolean();
            }
        }

        return null;
    }

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
/// The minimal vehicle projection the Telemetry Pipeline card consumes — the native analogue of the fields
/// the web component reads off its <c>vehicles</c> prop (web <c>Vehicle</c>: <c>id</c>, <c>vin</c>,
/// <c>display_name</c>, <c>state</c>). Supplied by the host page (it is a sub-page feature view), so the
/// card joins it against the live streaming/polling reads rather than fetching the fleet roster itself.
/// </summary>
public sealed record TelemetryPipelineVehicle(long Id, string Vin, string? DisplayName, string? State);

/// <summary>
/// One streaming vehicle from <c>GET /telemetry/</c> (web <c>VehicleTelemetry</c>). Field names accept the
/// camelCase and snake_case spellings the Go API emits. The raw <c>lastReceived</c> string is kept and
/// parsed on demand so the union age ladder can be computed deterministically against an injected clock.
/// </summary>
public sealed record TelemetryStreamVehicle(
    string Vin,
    string? LastReceivedAt,
    double? SignalsPerSecond,
    long? SignalCount)
{
    /// <summary>The parsed last-received instant, or null when absent / unparseable.</summary>
    public DateTimeOffset? LastReceived => TelemetryPipelineCardJson.TryParseTimestamp(LastReceivedAt);
}

/// <summary>
/// The Fleet Telemetry streaming snapshot from <c>GET /telemetry/</c> — the native analogue of the web
/// <c>TelemetryStatus</c> that <c>useMQTTStatus</c> normalises. <see cref="Connected"/> drives the broker
/// chip; <see cref="Vehicles"/> is the per-VIN stream map joined against the fleet roster. Parsing tolerates
/// the <c>vehicles</c> field arriving as either an object map keyed by VIN or an array (web parity — the
/// hook handles both), plus the legacy <c>streaming_vehicles</c> alias.
/// </summary>
public sealed record TelemetryStreamSnapshot(bool Connected, IReadOnlyList<TelemetryStreamVehicle> Vehicles)
{
    /// <summary>An empty snapshot (disconnected, no streaming vehicles) — the projection fallback.</summary>
    public static TelemetryStreamSnapshot Empty { get; } = new(false, Array.Empty<TelemetryStreamVehicle>());

    /// <summary>Parse a <c>GET /telemetry/</c> JSON object into a tolerant streaming snapshot.</summary>
    public static TelemetryStreamSnapshot ParseEnvelope(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        bool connected = TelemetryPipelineCardJson.GetBool(element, "connected") ?? false;
        var vehicles = new List<TelemetryStreamVehicle>();

        if (element.TryGetProperty("vehicles", out var vehiclesProp))
        {
            AppendVehicles(vehiclesProp, vehicles);
        }

        if (vehicles.Count == 0 && element.TryGetProperty("streaming_vehicles", out var streamingProp))
        {
            AppendVehicles(streamingProp, vehicles);
        }

        return new TelemetryStreamSnapshot(connected, vehicles);
    }

    private static void AppendVehicles(JsonElement node, List<TelemetryStreamVehicle> sink)
    {
        switch (node.ValueKind)
        {
            case JsonValueKind.Array:
                foreach (var item in node.EnumerateArray())
                {
                    if (item.ValueKind == JsonValueKind.Object)
                    {
                        sink.Add(FromJson(item, TelemetryPipelineCardJson.GetString(item, "vin") ?? string.Empty));
                    }
                }

                break;

            case JsonValueKind.Object:
                foreach (var member in node.EnumerateObject())
                {
                    if (member.Value.ValueKind == JsonValueKind.Object)
                    {
                        string vin = TelemetryPipelineCardJson.GetString(member.Value, "vin") ?? member.Name;
                        sink.Add(FromJson(member.Value, vin));
                    }
                }

                break;
        }
    }

    private static TelemetryStreamVehicle FromJson(JsonElement obj, string vin) => new(
        Vin: vin,
        LastReceivedAt: TelemetryPipelineCardJson.GetString(obj, "lastReceived", "last_received"),
        SignalsPerSecond: TelemetryPipelineCardJson.GetDouble(obj, "signalsPerSecond", "signals_per_second"),
        SignalCount: TelemetryPipelineCardJson.GetLong(obj, "signalCount", "signal_count"));
}

/// <summary>
/// One vehicle's polling state from <c>GET /polling/status</c> (web <c>VehiclePollingStatus</c>). Supplies
/// the battery readout and the next-scheduled-poll label, plus the last REST poll instant that unions with
/// the streaming last-seen to derive liveness. Field names mirror the Go API's snake_case JSON tags.
/// </summary>
public sealed record PollingVehicleStatus(
    string Vin,
    string? LastPollTime,
    string? NextPollAfter,
    double? BatteryLevel)
{
    /// <summary>The parsed last-poll instant, or null when absent / unparseable.</summary>
    public DateTimeOffset? LastPoll => TelemetryPipelineCardJson.TryParseTimestamp(LastPollTime);
}

/// <summary>
/// The polling-engine snapshot from <c>GET /polling/status</c> — the native analogue of the web
/// <c>PollEngineStatus</c>. <see cref="Enabled"/> drives the "polling engine off / disabled" chip and
/// defaults to <c>true</c> (web parity: <c>pollingStatus?.enabled !== false</c>, so an absent or failed
/// read is treated as enabled and shows no chip). <see cref="Vehicles"/> is the per-VIN polling map.
/// </summary>
public sealed record PollingEngineSnapshot(bool Enabled, IReadOnlyList<PollingVehicleStatus> Vehicles)
{
    /// <summary>An empty snapshot (engine treated as enabled, no polled vehicles) — the projection fallback.</summary>
    public static PollingEngineSnapshot Empty { get; } = new(true, Array.Empty<PollingVehicleStatus>());

    /// <summary>Parse a <c>GET /polling/status</c> JSON object into a tolerant polling snapshot.</summary>
    public static PollingEngineSnapshot ParseEnvelope(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        bool enabled = TelemetryPipelineCardJson.GetBool(element, "enabled") ?? true;
        var vehicles = new List<PollingVehicleStatus>();

        if (element.TryGetProperty("vehicles", out var vehiclesProp) && vehiclesProp.ValueKind == JsonValueKind.Object)
        {
            foreach (var member in vehiclesProp.EnumerateObject())
            {
                if (member.Value.ValueKind != JsonValueKind.Object)
                {
                    continue;
                }

                vehicles.Add(new PollingVehicleStatus(
                    Vin: member.Name,
                    LastPollTime: TelemetryPipelineCardJson.GetString(member.Value, "last_poll_time"),
                    NextPollAfter: TelemetryPipelineCardJson.GetString(member.Value, "next_poll_after"),
                    BatteryLevel: TelemetryPipelineCardJson.GetDouble(member.Value, "battery_level")));
            }
        }

        return new PollingEngineSnapshot(enabled, vehicles);
    }
}

/// <summary>The per-vehicle liveness bucket — the web <c>Liveness</c> union ('sending' | 'slow' | 'stale' | 'offline').</summary>
public enum TelemetryLiveness
{
    /// <summary>&lt; 5 min since the freshest signal — actively sending.</summary>
    Sending,

    /// <summary>5–30 min — slow / asleep cadence.</summary>
    Slow,

    /// <summary>&gt; 30 min — stale.</summary>
    Stale,

    /// <summary>No signal on either ingest path — offline.</summary>
    Offline,
}

/// <summary>Which ingest path produced the freshest last-seen — the web <c>LivenessSource</c>.</summary>
public enum TelemetryLivenessSource
{
    /// <summary>Fleet Telemetry streaming (MQTT) produced the freshest timestamp.</summary>
    Stream,

    /// <summary>The legacy REST polling engine produced the freshest timestamp.</summary>
    Poll,

    /// <summary>Neither path has a usable timestamp.</summary>
    None,
}

/// <summary>The derived liveness for one vehicle — bucket, source and the freshest last-seen instant.</summary>
public sealed record TelemetryLivenessResult(
    TelemetryLiveness Level,
    TelemetryLivenessSource Source,
    DateTimeOffset? LastSeen);

/// <summary>
/// Pure liveness derivation — the native port of the web <c>liveness()</c> function. Unions the two ingest
/// paths (last REST poll, last MQTT message), takes the freshest, and applies the age ladder
/// (&lt; 5 min sending, &lt; 30 min slow, else stale; no signal → offline). <c>now</c> is injected so the
/// boundary is unit-tested deterministically. No WinUI types.
/// </summary>
public static class TelemetryPipelineLiveness
{
    private const double SendingMaxMinutes = 5;
    private const double SlowMaxMinutes = 30;

    /// <summary>Derive liveness from the union of the last poll and last stream timestamps.</summary>
    public static TelemetryLivenessResult Evaluate(DateTimeOffset? lastPoll, DateTimeOffset? lastStream, DateTimeOffset now)
    {
        DateTimeOffset? lastSeen;
        TelemetryLivenessSource source;

        if (lastPoll is { } poll && lastStream is { } stream)
        {
            if (stream >= poll)
            {
                lastSeen = stream;
                source = TelemetryLivenessSource.Stream;
            }
            else
            {
                lastSeen = poll;
                source = TelemetryLivenessSource.Poll;
            }
        }
        else if (lastStream is { } streamOnly)
        {
            lastSeen = streamOnly;
            source = TelemetryLivenessSource.Stream;
        }
        else if (lastPoll is { } pollOnly)
        {
            lastSeen = pollOnly;
            source = TelemetryLivenessSource.Poll;
        }
        else
        {
            return new TelemetryLivenessResult(TelemetryLiveness.Offline, TelemetryLivenessSource.None, null);
        }

        double ageMinutes = (now - lastSeen.Value).TotalMinutes;
        TelemetryLiveness level = ageMinutes < SendingMaxMinutes
            ? TelemetryLiveness.Sending
            : ageMinutes < SlowMaxMinutes
                ? TelemetryLiveness.Slow
                : TelemetryLiveness.Stale;

        return new TelemetryLivenessResult(level, source, lastSeen);
    }
}

/// <summary>One cell of the fleet rollup grid (label + formatted value) — web parity for the five-up summary.</summary>
public sealed record FleetRollupCell(string Label, string Value);

/// <summary>One liveness summary chip (count + label + status) — web parity for the sub-header chips.</summary>
public sealed record LivenessSummaryChip(
    TelemetryLiveness Level,
    int Count,
    string Label,
    StatusKind Status,
    string AutomationName);

/// <summary>
/// The connectivity chip projection — the MQTT broker chip and the optional polling-engine chip. Mirrors the
/// web's "Fleet Telemetry connected" / "MQTT broker disconnected" and the informational "polling engine off
/// (streaming-only)" vs warning "polling engine disabled" logic.
/// </summary>
public sealed record TelemetryConnectivity(
    bool MqttConnected,
    string MqttLabel,
    StatusKind MqttStatus,
    bool ShowPollingChip,
    string PollingLabel,
    StatusKind PollingStatus);

/// <summary>
/// One projected, render-ready per-vehicle row — the native analogue of a list item in the web component.
/// Holds the name, the masked VIN tail, the normalised state label, the battery readout, the derived
/// liveness chip (label + source + status), the last-seen and next-poll relative strings, and a Narrator name.
/// </summary>
public sealed record TelemetryVehicleRow(
    long Id,
    string DisplayName,
    string VinTailText,
    string StateLabel,
    TelemetryLiveness Liveness,
    string LivenessLabel,
    StatusKind LivenessStatus,
    string? SourceLabel,
    int? BatteryPercent,
    StatusKind BatteryStatus,
    string LastSeenText,
    string? NextPollText,
    bool HasNextPoll,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the Telemetry Pipeline card — fleet rollup, liveness summary
/// chips, connectivity chips and the per-vehicle rows. <see cref="HasVehicles"/> reproduces the web
/// <c>list.length &gt; 0</c> gate that chooses the list vs the "no vehicles configured" empty state.
/// </summary>
public sealed record TelemetryPipelineDisplay(
    IReadOnlyList<FleetRollupCell> FleetCells,
    bool HasVehicles,
    IReadOnlyList<LivenessSummaryChip> LivenessChips,
    TelemetryConnectivity Connectivity,
    IReadOnlyList<TelemetryVehicleRow> VehicleRows)
{
    /// <summary>An empty display (no vehicles, disconnected) — the projection fallback.</summary>
    public static TelemetryPipelineDisplay Empty { get; } = new(
        Array.Empty<FleetRollupCell>(),
        false,
        Array.Empty<LivenessSummaryChip>(),
        new TelemetryConnectivity(false, string.Empty, StatusKind.Warning, false, string.Empty, StatusKind.Neutral),
        Array.Empty<TelemetryVehicleRow>());
}

/// <summary>
/// The overall card chrome state, driven by the PRIMARY streaming read and the vehicle roster. Every branch
/// maps onto a visible surface — none is hidden (engineering rule #6). The web renders content-then-degrade;
/// the native surface additionally renders explicit <c>Error</c> (retry), <c>Stale</c> and <c>Offline</c>
/// branches — the mandated state set, a strict superset of the web.
/// </summary>
public enum TelemetryPipelineState
{
    /// <summary>First streaming fetch with nothing cached — render the skeleton chrome.</summary>
    Loading,

    /// <summary>Fresh streaming status with a vehicle roster — the full card.</summary>
    Ready,

    /// <summary>The roster is empty — the friendly "no vehicles configured" empty state.</summary>
    Empty,

    /// <summary>The streaming read failed and nothing is cached — the retry affordance.</summary>
    Error,

    /// <summary>Cached streaming status older than the freshness window — content plus a stale chip.</summary>
    Stale,

    /// <summary>The streaming read failed but cached status remains — content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// Pure projection from the fleet roster + the streaming/polling snapshots to the render-ready display — the
/// native port of the web component's <c>counts</c> reducer, the per-vehicle row render, the liveness chips,
/// the connectivity chips and the relative-time labels. <c>now</c> is injected so the age ladder and relative
/// strings are unit-tested deterministically; every label resolves through the i18n facade. No WinUI types.
/// </summary>
public static class TelemetryPipelineProjection
{
    private const string MiddleDots = "\u00b7\u00b7\u00b7";
    private const string EmDash = "\u2014";

    /// <summary>Project the roster + live snapshots into the render-ready display.</summary>
    public static TelemetryPipelineDisplay Project(
        IReadOnlyList<TelemetryPipelineVehicle> vehicles,
        TelemetryStreamSnapshot? stream,
        PollingEngineSnapshot? polling,
        long positionCount,
        long drivesCount,
        long? chargingSessionsCount,
        long? signalLogCount,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(vehicles);
        ArgumentNullException.ThrowIfNull(localizer);

        var streamMap = BuildStreamMap(stream);
        var pollingMap = BuildPollingMap(polling);

        var cells = BuildFleetCells(vehicles.Count, positionCount, drivesCount, chargingSessionsCount, signalLogCount, localizer);
        var rows = BuildRows(vehicles, streamMap, pollingMap, localizer, now);
        var chips = BuildLivenessChips(vehicles, streamMap, pollingMap, localizer, now);
        var connectivity = BuildConnectivity(stream, polling, localizer);

        return new TelemetryPipelineDisplay(cells, vehicles.Count > 0, chips, connectivity, rows);
    }

    /// <summary>Format an integer count with grouping, or the em-dash for an absent value (web <c>fmtCount</c>).</summary>
    public static string FormatCount(long? value) =>
        value is { } v ? v.ToString("N0", CultureInfo.CurrentCulture) : EmDash;

    /// <summary>The masked VIN tail (last four characters), or '????' when absent (web <c>vinTail</c>).</summary>
    public static string VinTail(string? vin)
    {
        if (string.IsNullOrWhiteSpace(vin))
        {
            return "????";
        }

        var trimmed = vin.Trim();
        return trimmed.Length <= 4 ? trimmed : trimmed[^4..];
    }

    /// <summary>Localized liveness label (web 'sending' / 'slow' / 'stale' / 'offline').</summary>
    public static string LivenessLabel(TelemetryLiveness level, ILocalizer localizer) => level switch
    {
        TelemetryLiveness.Sending => localizer.GetString("telemetry.pipeline.liveness.sending", "sending"),
        TelemetryLiveness.Slow => localizer.GetString("telemetry.pipeline.liveness.slow", "slow"),
        TelemetryLiveness.Stale => localizer.GetString("telemetry.pipeline.liveness.stale", "stale"),
        _ => localizer.GetString("telemetry.pipeline.liveness.offline", "offline"),
    };

    /// <summary>Status accent for a liveness bucket (sending→success, slow→warning, stale→danger, offline→neutral).</summary>
    public static StatusKind LivenessStatus(TelemetryLiveness level) => level switch
    {
        TelemetryLiveness.Sending => StatusKind.Success,
        TelemetryLiveness.Slow => StatusKind.Warning,
        TelemetryLiveness.Stale => StatusKind.Danger,
        _ => StatusKind.Neutral,
    };

    /// <summary>Battery status accent (≥ 50% success, ≥ 20% warning, else danger) — web <c>batteryColor</c>.</summary>
    public static StatusKind BatteryStatus(int percent) => percent switch
    {
        >= 50 => StatusKind.Success,
        >= 20 => StatusKind.Warning,
        _ => StatusKind.Danger,
    };

    /// <summary>Localized, normalised vehicle-state label (web <c>vehicleStateBadge</c>).</summary>
    public static string VehicleStateLabel(string? state, ILocalizer localizer)
    {
        if (string.IsNullOrWhiteSpace(state))
        {
            return localizer.GetString("telemetry.pipeline.state.unknown", "unknown");
        }

        string s = state.Trim().ToLowerInvariant();
        return s switch
        {
            "online" => localizer.GetString("telemetry.pipeline.state.online", "online"),
            "driving" => localizer.GetString("telemetry.pipeline.state.driving", "driving"),
            "charging" => localizer.GetString("telemetry.pipeline.state.charging", "charging"),
            "asleep" or "sleeping" => localizer.GetString("telemetry.pipeline.state.asleep", "asleep"),
            "offline" => localizer.GetString("telemetry.pipeline.state.offline", "offline"),
            _ => s,
        };
    }

    /// <summary>
    /// Clock-skew-tolerant relative time (web <c>relativeTime</c>): "Ns ago" / "N min ago" / "Nh ago" /
    /// "Nd ago" (and the future "in …" variants), or the em-dash for an absent / unparseable instant.
    /// </summary>
    public static string RelativeTime(DateTimeOffset? value, DateTimeOffset now, ILocalizer localizer)
    {
        if (value is not { } instant)
        {
            return EmDash;
        }

        double diffMs = (now - instant).TotalMilliseconds;
        bool past = diffMs >= 0;
        double abs = Math.Abs(diffMs);

        long sec = (long)Math.Round(abs / 1000d, MidpointRounding.AwayFromZero);
        if (sec < 60)
        {
            return Format(past, "telemetry.pipeline.relative.secondsAgo", "{0}s ago", "telemetry.pipeline.relative.inSeconds", "in {0}s", sec, localizer);
        }

        long min = (long)Math.Round(sec / 60d, MidpointRounding.AwayFromZero);
        if (min < 60)
        {
            return Format(past, "telemetry.pipeline.relative.minutesAgo", "{0} min ago", "telemetry.pipeline.relative.inMinutes", "in {0} min", min, localizer);
        }

        long hr = (long)Math.Round(min / 60d, MidpointRounding.AwayFromZero);
        if (hr < 24)
        {
            return Format(past, "telemetry.pipeline.relative.hoursAgo", "{0}h ago", "telemetry.pipeline.relative.inHours", "in {0}h", hr, localizer);
        }

        long day = (long)Math.Round(hr / 24d, MidpointRounding.AwayFromZero);
        return Format(past, "telemetry.pipeline.relative.daysAgo", "{0}d ago", "telemetry.pipeline.relative.inDays", "in {0}d", day, localizer);
    }

    private static string Format(
        bool past,
        string pastKey,
        string pastFallback,
        string futureKey,
        string futureFallback,
        long value,
        ILocalizer localizer)
    {
        string template = past
            ? localizer.GetString(pastKey, pastFallback)
            : localizer.GetString(futureKey, futureFallback);
        return string.Format(CultureInfo.CurrentCulture, template, value);
    }

    private static Dictionary<string, TelemetryStreamVehicle> BuildStreamMap(TelemetryStreamSnapshot? stream)
    {
        var map = new Dictionary<string, TelemetryStreamVehicle>(StringComparer.Ordinal);
        if (stream is null)
        {
            return map;
        }

        foreach (var v in stream.Vehicles)
        {
            if (!string.IsNullOrEmpty(v.Vin))
            {
                map[v.Vin] = v;
            }
        }

        return map;
    }

    private static Dictionary<string, PollingVehicleStatus> BuildPollingMap(PollingEngineSnapshot? polling)
    {
        var map = new Dictionary<string, PollingVehicleStatus>(StringComparer.Ordinal);
        if (polling is null)
        {
            return map;
        }

        foreach (var v in polling.Vehicles)
        {
            if (!string.IsNullOrEmpty(v.Vin))
            {
                map[v.Vin] = v;
            }
        }

        return map;
    }

    private static FleetRollupCell[] BuildFleetCells(
        int vehicleCount,
        long positionCount,
        long drivesCount,
        long? chargingSessionsCount,
        long? signalLogCount,
        ILocalizer localizer)
    {
        string vehiclesValue = vehicleCount > 0
            ? string.Format(
                CultureInfo.CurrentCulture,
                localizer.GetString("telemetry.pipeline.vehiclesConnected", "{0} connected"),
                vehicleCount)
            : localizer.GetString("telemetry.pipeline.noneConfigured", "none configured");

        return new[]
        {
            new FleetRollupCell(localizer.GetString("telemetry.pipeline.vehicles", "Vehicles"), vehiclesValue),
            new FleetRollupCell(localizer.GetString("telemetry.pipeline.gpsPositions", "GPS positions"), FormatCount(positionCount)),
            new FleetRollupCell(localizer.GetString("telemetry.pipeline.drives", "Drives"), FormatCount(drivesCount)),
            new FleetRollupCell(localizer.GetString("telemetry.pipeline.chargingSessions", "Charging sessions"), FormatCount(chargingSessionsCount)),
            new FleetRollupCell(localizer.GetString("telemetry.pipeline.signalLog", "Signal log"), FormatCount(signalLogCount)),
        };
    }

    private static List<TelemetryVehicleRow> BuildRows(
        IReadOnlyList<TelemetryPipelineVehicle> vehicles,
        Dictionary<string, TelemetryStreamVehicle> streamMap,
        Dictionary<string, PollingVehicleStatus> pollingMap,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        var rows = new List<TelemetryVehicleRow>(vehicles.Count);
        foreach (var v in vehicles)
        {
            pollingMap.TryGetValue(v.Vin, out var ps);
            streamMap.TryGetValue(v.Vin, out var ss);

            var liveness = TelemetryPipelineLiveness.Evaluate(ps?.LastPoll, ss?.LastReceived, now);
            string livenessLabel = LivenessLabel(liveness.Level, localizer);
            StatusKind livenessStatus = LivenessStatus(liveness.Level);

            int? battery = ps?.BatteryLevel is { } b ? (int)Math.Round(b, MidpointRounding.AwayFromZero) : null;
            StatusKind batteryStatus = battery is { } pct ? BatteryStatus(pct) : StatusKind.Neutral;

            string displayName = !string.IsNullOrWhiteSpace(v.DisplayName)
                ? v.DisplayName!
                : string.Format(
                    CultureInfo.CurrentCulture,
                    localizer.GetString("telemetry.pipeline.vehicleFallbackName", "Vehicle {0}"),
                    v.Id);

            string vinTail = string.Format(
                CultureInfo.CurrentCulture,
                localizer.GetString("telemetry.pipeline.vinTail", "VIN {0}{1}"),
                MiddleDots,
                VinTail(v.Vin));

            string stateLabel = VehicleStateLabel(v.State, localizer);
            string? sourceLabel = liveness.Source switch
            {
                TelemetryLivenessSource.Stream => localizer.GetString("telemetry.pipeline.source.stream", "stream"),
                TelemetryLivenessSource.Poll => localizer.GetString("telemetry.pipeline.source.poll", "poll"),
                _ => null,
            };

            string lastSeenText = RelativeTime(liveness.LastSeen, now, localizer);
            bool hasNextPoll = ps?.LastPoll is not null && !string.IsNullOrWhiteSpace(ps.NextPollAfter);
            string? nextPollText = hasNextPoll
                ? RelativeTime(TelemetryPipelineCardJson.TryParseTimestamp(ps!.NextPollAfter), now, localizer)
                : null;

            rows.Add(new TelemetryVehicleRow(
                Id: v.Id,
                DisplayName: displayName,
                VinTailText: vinTail,
                StateLabel: stateLabel,
                Liveness: liveness.Level,
                LivenessLabel: livenessLabel,
                LivenessStatus: livenessStatus,
                SourceLabel: sourceLabel,
                BatteryPercent: battery,
                BatteryStatus: batteryStatus,
                LastSeenText: lastSeenText,
                NextPollText: nextPollText,
                HasNextPoll: hasNextPoll,
                AutomationName: RowAutomationName(displayName, stateLabel, livenessLabel, battery, lastSeenText, localizer)));
        }

        return rows;
    }

    private static IReadOnlyList<LivenessSummaryChip> BuildLivenessChips(
        IReadOnlyList<TelemetryPipelineVehicle> vehicles,
        Dictionary<string, TelemetryStreamVehicle> streamMap,
        Dictionary<string, PollingVehicleStatus> pollingMap,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        if (vehicles.Count == 0)
        {
            return Array.Empty<LivenessSummaryChip>();
        }

        var counts = new Dictionary<TelemetryLiveness, int>
        {
            [TelemetryLiveness.Sending] = 0,
            [TelemetryLiveness.Slow] = 0,
            [TelemetryLiveness.Stale] = 0,
            [TelemetryLiveness.Offline] = 0,
        };

        foreach (var v in vehicles)
        {
            pollingMap.TryGetValue(v.Vin, out var ps);
            streamMap.TryGetValue(v.Vin, out var ss);
            var liveness = TelemetryPipelineLiveness.Evaluate(ps?.LastPoll, ss?.LastReceived, now);
            counts[liveness.Level]++;
        }

        var order = new[] { TelemetryLiveness.Sending, TelemetryLiveness.Slow, TelemetryLiveness.Stale, TelemetryLiveness.Offline };
        var chips = new List<LivenessSummaryChip>();
        foreach (var level in order)
        {
            int count = counts[level];
            if (count == 0)
            {
                continue;
            }

            string label = LivenessLabel(level, localizer);
            string text = string.Format(CultureInfo.CurrentCulture, "{0} {1}", count, label);
            chips.Add(new LivenessSummaryChip(level, count, text, LivenessStatus(level), text));
        }

        return chips;
    }

    private static TelemetryConnectivity BuildConnectivity(
        TelemetryStreamSnapshot? stream,
        PollingEngineSnapshot? polling,
        ILocalizer localizer)
    {
        bool mqttConnected = stream?.Connected == true;
        string mqttLabel = mqttConnected
            ? localizer.GetString("telemetry.pipeline.mqttConnected", "Fleet Telemetry connected")
            : localizer.GetString("telemetry.pipeline.mqttDisconnected", "MQTT broker disconnected");
        StatusKind mqttStatus = mqttConnected ? StatusKind.Info : StatusKind.Warning;

        // web: pollingEnabled = pollingStatus?.enabled !== false; an absent read is treated as enabled (no chip).
        bool pollingEnabled = polling?.Enabled ?? true;
        bool showPollingChip = !pollingEnabled;
        string pollingLabel;
        StatusKind pollingStatus;
        if (mqttConnected)
        {
            pollingLabel = localizer.GetString("telemetry.pipeline.pollingOff", "polling engine off (streaming-only)");
            pollingStatus = StatusKind.Neutral;
        }
        else
        {
            pollingLabel = localizer.GetString("telemetry.pipeline.pollingDisabled", "polling engine disabled");
            pollingStatus = StatusKind.Warning;
        }

        return new TelemetryConnectivity(mqttConnected, mqttLabel, mqttStatus, showPollingChip, pollingLabel, pollingStatus);
    }

    private static string RowAutomationName(
        string displayName,
        string stateLabel,
        string livenessLabel,
        int? battery,
        string lastSeenText,
        ILocalizer localizer)
    {
        string batteryText = battery is { } pct
            ? string.Format(CultureInfo.CurrentCulture, "{0}%", pct)
            : EmDash;
        string lastSeenLabel = localizer.GetString("telemetry.pipeline.lastSeen", "last seen");
        string batteryLabel = localizer.GetString("telemetry.pipeline.battery", "battery");
        return string.Format(
            CultureInfo.CurrentCulture,
            "{0}, {1}, {2}, {3}: {4}, {5}: {6}",
            displayName,
            stateLabel,
            livenessLabel,
            batteryLabel,
            batteryText,
            lastSeenLabel,
            lastSeenText);
    }
}

/// <summary>
/// Canonical registry metadata for the Telemetry Pipeline surface — the native mirror of the web component
/// (web/src/features/system/components/status/TelemetryPipelineCard.tsx). Centralises the stable id, the
/// diagnostics slug and the surface's accessible name so the view and view-model stay free of literal copy.
/// </summary>
public static class TelemetryPipelineCardRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "telemetry-pipeline-card";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "TelemetryPipelineCard";

    /// <summary>Localized accessible name for the surface root.</summary>
    public static string AccessibleName(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("telemetry.pipeline.title", "Telemetry pipeline");
    }
}

/// <summary>
/// PII-safe diagnostics for the Telemetry Pipeline surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a VIN, vehicle name or battery value —
/// so a diagnostics line can never leak which vehicle was involved. Thread-safe.
/// </summary>
public sealed class TelemetryPipelineCardDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public TelemetryPipelineCardDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=TelemetryPipelineCard</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={TelemetryPipelineCardRegistration.Slug}");
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions to typed snapshot results for
/// the two live reads (streaming status, polling status), preserving the cache-then-network status/freshness
/// while parsing the payload. A loaded-but-empty body collapses to <see cref="LoadStatus.Empty"/>. Pure —
/// unit-tested without a network or cache.
/// </summary>
public static class TelemetryPipelineResultMapper
{
    /// <summary>Map a raw <c>GET /telemetry/</c> emission to a typed streaming-snapshot result.</summary>
    public static RepositoryResult<TelemetryStreamSnapshot> MapStreaming(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        // A disconnected snapshot (connected:false, no vehicles) is a meaningful, renderable state (it drives
        // the "MQTT broker disconnected" chip), so it is NOT collapsed to Empty — only a null/undefined body
        // (handled upstream by the engine's isEmpty predicate) yields Empty.
        return Map(raw, TelemetryStreamSnapshot.ParseEnvelope, static _ => false);
    }

    /// <summary>Map a raw <c>GET /polling/status</c> emission to a typed polling-snapshot result.</summary>
    public static RepositoryResult<PollingEngineSnapshot> MapPolling(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);
        return Map(raw, PollingEngineSnapshot.ParseEnvelope, static _ => false);
    }

    private static RepositoryResult<T> Map<T>(
        RepositoryResult<JsonElement> raw,
        Func<JsonElement, T> parse,
        Func<T, bool> isEmpty)
        where T : class
    {
        switch (raw.Status)
        {
            case LoadStatus.Loading:
                return RepositoryResult<T>.Loading();

            case LoadStatus.Empty:
                return RepositoryResult<T>.Empty(raw.FetchedAt);

            case LoadStatus.Error:
                return RepositoryResult<T>.Failure(
                    raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error"));
        }

        var value = parse(raw.Value);
        var fetchedAt = raw.FetchedAt ?? DateTimeOffset.UtcNow;

        return raw.Status switch
        {
            LoadStatus.Cached => RepositoryResult<T>.Cached(value, fetchedAt, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<T>.Refreshing(value, fetchedAt, raw.IsStale),
            LoadStatus.Offline => RepositoryResult<T>.OfflineCached(
                value, fetchedAt, raw.Error ?? new RepositoryError(RepositoryErrorKind.Network, "Offline")),
            _ when isEmpty(value) => RepositoryResult<T>.Empty(fetchedAt),
            _ => RepositoryResult<T>.Loaded(value, fetchedAt),
        };
    }
}
