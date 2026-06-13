using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Telemetry;

/// <summary>
/// The mutually-exclusive top-level data state the <c>MQTTInspectorPage</c> surface renders — the native summary of
/// the three web data states the page declares (web/src/features/telemetry/pages/MQTTInspectorPage.tsx, route
/// <c>/mqtt-inspector</c>). The web page runs a single live query (<c>useMQTTStatus</c> → <c>GET /telemetry</c>) and
/// renders loading skeletons, the populated panels, or the "broker status not available" empty state. The failure
/// branch (web <c>error &amp;&amp; !status</c>) is an overlay banner, not a separate full-screen state, so it is
/// surfaced through <see cref="MqttInspectorDisplay.ShowErrorBanner"/> rather than a fourth enum member.
/// </summary>
public enum MqttInspectorState
{
    /// <summary>The first live read is in flight with nothing resolved yet (web <c>isLoading</c>).</summary>
    Loading,

    /// <summary>The read resolved but the broker reported no usable status (web <c>!status</c>).</summary>
    Empty,

    /// <summary>The broker status resolved — every panel renders (web <c>status</c> truthy).</summary>
    Success,
}

/// <summary>
/// One streaming vehicle row — the native mirror of the web <c>VehicleTelemetry</c> entry the
/// <c>useMQTTStatus</c> hook normalises (web/src/types/telemetry.ts). Field access tolerates the dual
/// snake_case / camelCase wire shape the hook accepts; <see cref="LastReceived"/> is parsed lazily so a missing
/// or malformed timestamp degrades to the stale branch rather than throwing. Pure data.
/// </summary>
public sealed record MqttVehicleRow(
    string Vin,
    string? State,
    long SignalCount,
    long BatchCount,
    double? SignalsPerSecond,
    string? LastReceivedAt)
{
    /// <summary>The parsed last-received instant, or null when absent / unparseable.</summary>
    public DateTimeOffset? LastReceived => MqttInspectorJson.TryParseTimestamp(LastReceivedAt);

    /// <summary>True when no signal has been received within the staleness window (web <c>STALE_THRESHOLD</c>).</summary>
    public bool IsStale(DateTimeOffset now) =>
        LastReceived is not { } received ||
        (now - received).TotalSeconds > MqttInspectorRegistration.StaleThresholdSeconds;

    /// <summary>Read one streaming vehicle from a JSON object, tolerating the snake_case / camelCase aliases.</summary>
    public static MqttVehicleRow FromJson(JsonElement o, string vin) => new(
        Vin: vin,
        State: MqttInspectorJson.Str(o, "state"),
        SignalCount: MqttInspectorJson.Long(o, "signalCount", "signal_count") ?? 0,
        BatchCount: MqttInspectorJson.Long(o, "batchCount", "batch_count") ?? 0,
        SignalsPerSecond: MqttInspectorJson.Double(o, "signalsPerSecond", "signals_per_second"),
        LastReceivedAt: MqttInspectorJson.Str(o, "lastReceived", "last_received"));
}

/// <summary>
/// The Fleet Telemetry broker snapshot from <c>GET /telemetry</c> — the native analogue of the web
/// <c>TelemetryStatus</c> that <c>useMQTTStatus</c> normalises. Parsing tolerates the <c>vehicles</c> field
/// arriving as either an object map keyed by VIN or an array (web parity — the hook handles both), the legacy
/// <c>streaming_vehicles</c> alias and the <c>uptime_seconds</c> snake_case alias. <see cref="HasStatus"/> mirrors
/// the web <c>status</c> truthiness that gates the connection panel between its populated and empty branches.
/// </summary>
public sealed record MqttStatusSnapshot(
    bool HasStatus,
    bool Connected,
    string? Broker,
    double? UptimeSeconds,
    IReadOnlyList<string> Topics,
    IReadOnlyList<MqttVehicleRow> Vehicles)
{
    /// <summary>An absent snapshot (no broker status) — the projection's empty-state fallback.</summary>
    public static MqttStatusSnapshot Empty { get; } =
        new(false, false, null, null, Array.Empty<string>(), Array.Empty<MqttVehicleRow>());

    /// <summary>Total signals streamed across every vehicle (web <c>totalSignals</c>).</summary>
    public long TotalSignals
    {
        get
        {
            long sum = 0;
            foreach (var v in Vehicles)
            {
                sum += v.SignalCount;
            }

            return sum;
        }
    }

    /// <summary>Total batches streamed across every vehicle (web <c>totalBatches</c>).</summary>
    public long TotalBatches
    {
        get
        {
            long sum = 0;
            foreach (var v in Vehicles)
            {
                sum += v.BatchCount;
            }

            return sum;
        }
    }

    /// <summary>Aggregate signals-per-second across every vehicle (web <c>totalRate</c>).</summary>
    public double TotalRate
    {
        get
        {
            double sum = 0;
            foreach (var v in Vehicles)
            {
                sum += v.SignalsPerSecond ?? 0;
            }

            return sum;
        }
    }

    /// <summary>Parse a <c>GET /telemetry</c> JSON object into a tolerant broker snapshot.</summary>
    public static MqttStatusSnapshot FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        bool connected = MqttInspectorJson.Bool(element, "connected") ?? false;
        string? broker = MqttInspectorJson.Str(element, "broker");
        double? uptime = MqttInspectorJson.Double(element, "uptimeSeconds", "uptime_seconds");
        var topics = MqttInspectorJson.StringArray(element, "topics");

        var vehicles = new List<MqttVehicleRow>();
        if (element.TryGetProperty("vehicles", out var vehiclesProp))
        {
            AppendVehicles(vehiclesProp, vehicles);
        }

        if (vehicles.Count == 0 && element.TryGetProperty("streaming_vehicles", out var streamingProp))
        {
            AppendVehicles(streamingProp, vehicles);
        }

        return new MqttStatusSnapshot(true, connected, broker, uptime, topics, vehicles);
    }

    private static void AppendVehicles(JsonElement node, List<MqttVehicleRow> sink)
    {
        switch (node.ValueKind)
        {
            case JsonValueKind.Array:
                foreach (var item in node.EnumerateArray())
                {
                    if (item.ValueKind == JsonValueKind.Object)
                    {
                        sink.Add(MqttVehicleRow.FromJson(item, MqttInspectorJson.Str(item, "vin") ?? string.Empty));
                    }
                }

                break;

            case JsonValueKind.Object:
                foreach (var member in node.EnumerateObject())
                {
                    if (member.Value.ValueKind == JsonValueKind.Object)
                    {
                        string vin = MqttInspectorJson.Str(member.Value, "vin") ?? member.Name;
                        sink.Add(MqttVehicleRow.FromJson(member.Value, vin));
                    }
                }

                break;
        }
    }
}

/// <summary>One sampled throughput datum (web <c>ThroughputPoint</c>): the formatted sample time and the per-tick signal delta.</summary>
public sealed record ThroughputPoint(string Time, double Signals);

/// <summary>One summary stat card (web <c>StatCard</c>): the localized label, the formatted value and the leading glyph.</summary>
public sealed record MqttStatCardDisplay(string Label, string Value, string Glyph);

/// <summary>
/// One render-ready vehicle-breakdown row (web <c>buildVehicleColumns</c> cells). Every cell is pre-formatted and
/// the two status chips carry their resolved <see cref="StatusKind"/> so the view is a thin renderer.
/// </summary>
public sealed record MqttVehicleRowDisplay(
    string Vin,
    bool HasState,
    string StateText,
    StatusKind StateStatus,
    string SignalsText,
    string BatchesText,
    string SigPerSecText,
    string LastReceivedText,
    bool IsStale,
    string StatusText,
    StatusKind StatusStatus,
    string AutomationName);

/// <summary>
/// The fully-projected, render-ready content the <c>MQTTInspectorPage</c> view binds to. Every visible string is
/// pre-resolved and every panel's branch (populated / empty / loading) is pre-selected so the WinUI view performs no
/// formatting, branching or i18n of its own.
/// </summary>
public sealed record MqttInspectorDisplay(
    MqttInspectorState State,
    string Title,
    string Subtitle,
    string RefreshIntervalText,
    bool Connected,
    string ConnectionText,
    StatusKind ConnectionStatus,
    bool ShowErrorBanner,
    string ErrorBannerTitle,
    string ErrorBannerMessage,
    IReadOnlyList<MqttStatCardDisplay> StatCards,
    bool HasStatus,
    bool ShowBroker,
    string BrokerLabel,
    string BrokerValue,
    bool ShowUptime,
    string UptimeLabel,
    string UptimeValue,
    string TopicPatternsLabel,
    bool HasTopics,
    IReadOnlyList<string> Topics,
    string NoTopicsMessage,
    string NoStatusMessage,
    string SignalThroughputTitle,
    string SignalsSeriesName,
    bool ChartReady,
    ChartSeries? ThroughputSeries,
    string CollectingDataMessage,
    string ChartAriaLabel,
    string VehicleBreakdownTitle,
    bool ShowVehicleCount,
    string VehicleCountText,
    bool ShowStaleCount,
    string StaleCountText,
    bool VehiclesLoading,
    IReadOnlyList<MqttVehicleRowDisplay> VehicleRows,
    string NoVehiclesMessage,
    string VinHeader,
    string StateHeader,
    string SignalsHeader,
    string BatchesHeader,
    string SigPerSecHeader,
    string LastReceivedHeader,
    string StatusHeader,
    string AutomationName)
{
    /// <summary>A resolved empty display (used as the view-model's pre-load seed).</summary>
    public static MqttInspectorDisplay Empty { get; } = MqttInspectorProjection.Project(
        MqttInspectorModel.Initial, PassthroughLocalizer.Instance, DateTimeOffset.UnixEpoch);
}

/// <summary>The raw inputs the <see cref="MqttInspectorProjection"/> folds into a <see cref="MqttInspectorDisplay"/>.</summary>
public sealed record MqttInspectorModel(
    bool Loading,
    bool HasError,
    string? ErrorDetail,
    MqttStatusSnapshot Status,
    IReadOnlyList<ThroughputPoint> Throughput)
{
    /// <summary>The pre-load model — loading, no status, no throughput history yet.</summary>
    public static MqttInspectorModel Initial { get; } =
        new(true, false, null, MqttStatusSnapshot.Empty, Array.Empty<ThroughputPoint>());
}

/// <summary>
/// The Microsoft.UI-free projection that turns a <see cref="MqttInspectorModel"/> into the render-ready
/// <see cref="MqttInspectorDisplay"/> — the native port of the web page's render body
/// (web/src/features/telemetry/pages/MQTTInspectorPage.tsx). It resolves every label through the
/// <see cref="ILocalizer"/> facade using the exact web key names, formats counts through
/// <see cref="NumberFormatting"/> (web <c>fmtInt</c> / <c>fmtNumber</c>) and timestamps through
/// <see cref="DateTimeFormatting"/> (web <c>formatRelative</c>), and pre-selects each panel's branch.
/// </summary>
public static class MqttInspectorProjection
{
    private const string EmDash = "\u2014";
    private const string StreamGlyph = "\uEC05"; // Segoe Fluent — NetworkTower (web <Radio/> streaming icon)

    /// <summary>Project the live model into the render-ready display.</summary>
    /// <param name="model">The raw broker status + throughput history.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="now">The reference instant for staleness + relative timestamps.</param>
    public static MqttInspectorDisplay Project(MqttInspectorModel model, ILocalizer localizer, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        var status = model.Status ?? MqttStatusSnapshot.Empty;
        var throughput = model.Throughput ?? Array.Empty<ThroughputPoint>();
        bool hasStatus = status.HasStatus;

        // web: `isLoading` shows the em-dash fallbacks only while the first read has no data yet.
        bool showLoadingDash = model.Loading && !hasStatus;
        var vehicles = status.Vehicles;

        MqttInspectorState state = showLoadingDash
            ? MqttInspectorState.Loading
            : hasStatus ? MqttInspectorState.Success : MqttInspectorState.Empty;

        // -- Chrome -------------------------------------------------------------------
        string title = localizer.GetString("mqtt.title", "MQTT Inspector");
        string subtitle = localizer.GetString("mqtt.subtitle", "MQTT connection status and streaming telemetry");
        string refreshInterval = localizer.GetString("mqtt.refreshInterval", "Refreshes every 5s");

        bool connected = status.Connected;
        string connectedText = localizer.GetString("mqtt.connected", "Connected");
        string disconnectedText = localizer.GetString("mqtt.disconnected", "Disconnected");
        string connectionText = connected ? connectedText : disconnectedText;
        StatusKind connectionStatus = connected ? StatusKind.Success : StatusKind.Danger;

        // -- Error banner (web `error && !status`) ------------------------------------
        bool showErrorBanner = model.HasError && !hasStatus;
        string errorTitle = localizer.GetString("mqtt.fetchError", "Unable to load MQTT status");
        string errorMessage = model.ErrorDetail ?? string.Empty;

        // -- Summary stat cards -------------------------------------------------------
        string streamingVehiclesLabel = localizer.GetString("mqtt.streamingVehicles", "Streaming Vehicles");
        string totalSignalsLabel = localizer.GetString("mqtt.totalSignals", "Total Signals");
        string totalBatchesLabel = localizer.GetString("mqtt.totalBatches", "Total Batches");
        string signalsPerSecLabel = localizer.GetString("mqtt.signalsPerSec", "Signals / sec");

        var statCards = new[]
        {
            new MqttStatCardDisplay(streamingVehiclesLabel, showLoadingDash ? EmDash : FmtInt(vehicles.Count), StreamGlyph),
            new MqttStatCardDisplay(totalSignalsLabel, showLoadingDash ? EmDash : FmtInt(status.TotalSignals), StreamGlyph),
            new MqttStatCardDisplay(totalBatchesLabel, showLoadingDash ? EmDash : FmtInt(status.TotalBatches), StreamGlyph),
            new MqttStatCardDisplay(signalsPerSecLabel, showLoadingDash ? EmDash : FmtNumber(status.TotalRate), StreamGlyph),
        };

        // -- Connection info ----------------------------------------------------------
        string brokerLabel = localizer.GetString("mqtt.broker", "Broker");
        bool showBroker = hasStatus && !string.IsNullOrEmpty(status.Broker);
        string brokerValue = status.Broker ?? string.Empty;

        string uptimeLabel = localizer.GetString("mqtt.uptime", "Uptime");
        bool showUptime = hasStatus && status.UptimeSeconds is not null;
        string uptimeValue = status.UptimeSeconds is { } up ? FormatUptime(up) : EmDash;

        string topicPatternsLabel = localizer.GetString("mqtt.topicPatterns", "Topic Patterns");
        bool hasTopics = hasStatus && status.Topics.Count > 0;
        string noTopicsMessage = localizer.GetString("mqtt.noTopics", "No MQTT topics detected");
        string noStatusMessage = localizer.GetString("mqtt.noStatus", "MQTT broker status not available");

        // -- Throughput chart ---------------------------------------------------------
        string signalThroughputTitle = localizer.GetString("mqtt.signalThroughput", "Signal Throughput");
        string signalsSeriesName = localizer.GetString("mqtt.signals", "Signals");
        string collectingMessage = localizer.GetString("mqtt.collectingData", "Collecting throughput data\u2026");
        bool chartReady = throughput.Count > 2;
        ChartSeries? throughputSeries = chartReady ? BuildThroughputSeries(signalsSeriesName, throughput) : null;

        // -- Vehicle breakdown --------------------------------------------------------
        string vehicleBreakdownTitle = localizer.GetString("mqtt.vehicleBreakdown", "Vehicle Breakdown");
        string vehiclesWord = localizer.GetString("mqtt.vehicles", "vehicles");
        string staleWord = localizer.GetString("mqtt.stale", "Stale");
        string liveWord = localizer.GetString("mqtt.live", "Live");

        bool showVehicleCount = vehicles.Count > 0;
        string vehicleCountText = string.Create(CultureInfo.CurrentCulture, $"{vehicles.Count} {vehiclesWord}");

        int staleCount = 0;
        foreach (var v in vehicles)
        {
            if (v.IsStale(now))
            {
                staleCount++;
            }
        }

        bool showStaleCount = staleCount > 0;
        string staleCountText = string.Create(CultureInfo.CurrentCulture, $"{staleCount} {staleWord}");

        bool vehiclesLoading = showLoadingDash;
        var rows = BuildVehicleRows(vehicles, now, localizer, staleWord, liveWord);
        string noVehiclesMessage = localizer.GetString("mqtt.noVehicles", "No vehicles currently streaming");

        // -- Column headers -----------------------------------------------------------
        string vinHeader = localizer.GetString("mqtt.vin", "VIN");
        string stateHeader = localizer.GetString("mqtt.state", "State");
        string signalsHeader = localizer.GetString("mqtt.signals", "Signals");
        string batchesHeader = localizer.GetString("mqtt.batches", "Batches");
        string sigPerSecHeader = localizer.GetString("mqtt.sigPerSec", "Sig/sec");
        string lastReceivedHeader = localizer.GetString("mqtt.lastReceived", "Last Received");
        string statusHeader = localizer.GetString("mqtt.status", "Status");

        string automationName = string.Create(CultureInfo.CurrentCulture, $"{title}. {subtitle}");

        return new MqttInspectorDisplay(
            State: state,
            Title: title,
            Subtitle: subtitle,
            RefreshIntervalText: refreshInterval,
            Connected: connected,
            ConnectionText: connectionText,
            ConnectionStatus: connectionStatus,
            ShowErrorBanner: showErrorBanner,
            ErrorBannerTitle: errorTitle,
            ErrorBannerMessage: errorMessage,
            StatCards: statCards,
            HasStatus: hasStatus,
            ShowBroker: showBroker,
            BrokerLabel: brokerLabel,
            BrokerValue: brokerValue,
            ShowUptime: showUptime,
            UptimeLabel: uptimeLabel,
            UptimeValue: uptimeValue,
            TopicPatternsLabel: topicPatternsLabel,
            HasTopics: hasTopics,
            Topics: status.Topics,
            NoTopicsMessage: noTopicsMessage,
            NoStatusMessage: noStatusMessage,
            SignalThroughputTitle: signalThroughputTitle,
            SignalsSeriesName: signalsSeriesName,
            ChartReady: chartReady,
            ThroughputSeries: throughputSeries,
            CollectingDataMessage: collectingMessage,
            ChartAriaLabel: signalThroughputTitle,
            VehicleBreakdownTitle: vehicleBreakdownTitle,
            ShowVehicleCount: showVehicleCount,
            VehicleCountText: vehicleCountText,
            ShowStaleCount: showStaleCount,
            StaleCountText: staleCountText,
            VehiclesLoading: vehiclesLoading,
            VehicleRows: rows,
            NoVehiclesMessage: noVehiclesMessage,
            VinHeader: vinHeader,
            StateHeader: stateHeader,
            SignalsHeader: signalsHeader,
            BatchesHeader: batchesHeader,
            SigPerSecHeader: sigPerSecHeader,
            LastReceivedHeader: lastReceivedHeader,
            StatusHeader: statusHeader,
            AutomationName: automationName);
    }

    private static IReadOnlyList<MqttVehicleRowDisplay> BuildVehicleRows(
        IReadOnlyList<MqttVehicleRow> vehicles,
        DateTimeOffset now,
        ILocalizer localizer,
        string staleWord,
        string liveWord)
    {
        if (vehicles.Count == 0)
        {
            return Array.Empty<MqttVehicleRowDisplay>();
        }

        string signalsWord = localizer.GetString("mqtt.signals", "Signals");
        var rows = new List<MqttVehicleRowDisplay>(vehicles.Count);
        foreach (var v in vehicles)
        {
            bool hasState = !string.IsNullOrEmpty(v.State);
            bool online = string.Equals(v.State, "online", StringComparison.OrdinalIgnoreCase);
            bool isStale = v.IsStale(now);

            string sigPerSec = v.SignalsPerSecond is { } rate ? FmtNumber(rate) : EmDash;
            string lastReceived = v.LastReceived is { } received
                ? DateTimeFormatting.Format(received, DateTimeVariant.Relative, now)
                : EmDash;
            string statusText = isStale ? staleWord : liveWord;

            string automation = string.Create(
                CultureInfo.CurrentCulture,
                $"{v.Vin}, {(hasState ? v.State : EmDash)}, {FmtInt(v.SignalCount)} {signalsWord}, {statusText}");

            rows.Add(new MqttVehicleRowDisplay(
                Vin: v.Vin,
                HasState: hasState,
                StateText: hasState ? v.State! : EmDash,
                StateStatus: online ? StatusKind.Success : StatusKind.Neutral,
                SignalsText: FmtInt(v.SignalCount),
                BatchesText: FmtInt(v.BatchCount),
                SigPerSecText: sigPerSec,
                LastReceivedText: lastReceived,
                IsStale: isStale,
                StatusText: statusText,
                StatusStatus: isStale ? StatusKind.Warning : StatusKind.Success,
                AutomationName: automation));
        }

        return rows;
    }

    private static ChartSeries BuildThroughputSeries(string name, IReadOnlyList<ThroughputPoint> throughput)
    {
        var points = new List<ChartPoint>(throughput.Count);
        for (int i = 0; i < throughput.Count; i++)
        {
            points.Add(new ChartPoint(i, throughput[i].Signals, throughput[i].Time));
        }

        return new ChartSeries(name, points) { Kind = ChartSeriesKind.Area, ColorIndex = 0 };
    }

    // web formatUptime: < 1h -> "Nm"; otherwise "Hh Mm" with the minutes part rounded (web fmtInt).
    private static string FormatUptime(double seconds)
    {
        if (seconds < 3600)
        {
            return string.Create(CultureInfo.CurrentCulture, $"{Math.Floor(seconds / 60):0}m");
        }

        double hours = Math.Floor(seconds / 3600);
        double minutes = (seconds % 3600) / 60;
        return string.Create(CultureInfo.CurrentCulture, $"{hours:0}h {FmtInt(minutes)}m");
    }

    private static string FmtInt(double value) => NumberFormatting.Format(value, null, 0);

    private static string FmtNumber(double value) => NumberFormatting.Format(value, null, 2);
}

/// <summary>
/// Static registration metadata for the <c>MQTTInspectorPage</c> surface — the route name (RouteTable maps
/// <c>MQTTInspector</c> → <c>/mqtt-inspector</c>), the generated OpenAPI operation id, the staleness window and the
/// localized chrome accessors the shell / view-model share.
/// </summary>
public static class MqttInspectorRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "MQTTInspectorPage";

    /// <summary>The navigation route name this page registers under (see RouteTable <c>MQTTInspector</c>).</summary>
    public const string RouteName = "MQTTInspector";

    /// <summary>The generated OpenAPI operation id for the broker-status query (web <c>useMQTTStatus</c>).</summary>
    public const string TelemetryOperation = "get_api_v1_telemetry";

    /// <summary>The staleness window in seconds beyond which a vehicle is "stale" (web <c>STALE_THRESHOLD</c>).</summary>
    public const int StaleThresholdSeconds = 120;

    /// <summary>The live refetch cadence in seconds (web <c>INTERVALS.REALTIME</c> — "Refreshes every 5s").</summary>
    public const int RefreshIntervalSeconds = 5;

    /// <summary>The localized page title (web <c>mqtt.title</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("mqtt.title", "MQTT Inspector");
    }

    /// <summary>The localized page subtitle (web <c>mqtt.subtitle</c>).</summary>
    public static string Subtitle(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("mqtt.subtitle", "MQTT connection status and streaming telemetry");
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>MQTTInspectorPage</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a VIN, broker host or signal count — so a
/// diagnostics line can never leak fleet content. Thread-safe.
/// </summary>
public sealed class MqttInspectorDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public MqttInspectorDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=MQTTInspectorPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={MqttInspectorRegistration.Slug}");
    }
}

/// <summary>
/// Null-tolerant <see cref="JsonElement"/> readers for the <c>MQTTInspectorPage</c> snapshots. A private per-feature
/// helper (mirroring the sibling W7 surfaces) so the snake_case / camelCase Go wire shape is preserved losslessly and
/// a partial / null payload never throws. Each accessor accepts one or more candidate property names so the
/// <c>useMQTTStatus</c> dual-casing normalisation is reproduced at the parse boundary.
/// </summary>
internal static class MqttInspectorJson
{
    public static string? Str(JsonElement o, params string[] names)
    {
        foreach (var name in names)
        {
            if (o.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String)
            {
                return v.GetString();
            }
        }

        return null;
    }

    public static long? Long(JsonElement o, params string[] names)
    {
        foreach (var name in names)
        {
            if (!o.TryGetProperty(name, out var v))
            {
                continue;
            }

            switch (v.ValueKind)
            {
                case JsonValueKind.Number when v.TryGetInt64(out var n):
                    return n;
                case JsonValueKind.Number when v.TryGetDouble(out var d):
                    return (long)d;
                case JsonValueKind.String when long.TryParse(v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var s):
                    return s;
            }
        }

        return null;
    }

    public static double? Double(JsonElement o, params string[] names)
    {
        foreach (var name in names)
        {
            if (!o.TryGetProperty(name, out var v))
            {
                continue;
            }

            switch (v.ValueKind)
            {
                case JsonValueKind.Number when v.TryGetDouble(out var d):
                    return d;
                case JsonValueKind.String when double.TryParse(v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var s):
                    return s;
            }
        }

        return null;
    }

    public static bool? Bool(JsonElement o, params string[] names)
    {
        foreach (var name in names)
        {
            if (!o.TryGetProperty(name, out var v))
            {
                continue;
            }

            switch (v.ValueKind)
            {
                case JsonValueKind.True:
                    return true;
                case JsonValueKind.False:
                    return false;
            }
        }

        return null;
    }

    public static IReadOnlyList<string> StringArray(JsonElement o, string name)
    {
        if (!o.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<string>();
        }

        var list = new List<string>();
        foreach (var item in v.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.String && item.GetString() is { Length: > 0 } s)
            {
                list.Add(s);
            }
        }

        return list;
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
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var parsed)
            ? parsed
            : null;
    }
}
