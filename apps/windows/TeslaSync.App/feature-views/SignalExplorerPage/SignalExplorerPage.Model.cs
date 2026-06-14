using System.Globalization;
using System.Linq;
using System.Text.Json;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Telemetry;

/// <summary>
/// The top-level data state the <c>SignalExplorerPage</c> can be in — the native union of the four web data states
/// the page renders (web/src/features/telemetry/pages/SignalExplorerPage.tsx): the initial fleet /
/// available-signals load (<see cref="Loading"/>), the no-vehicle guard (web <c>vehicleId === 0</c>,
/// <see cref="Empty"/>), a fetch failure (web <c>anyError</c>, <see cref="Error"/>) and the populated controls
/// (<see cref="Success"/>). Every branch maps onto a visible surface; none is ever hidden.
/// </summary>
public enum SignalExplorerState
{
    /// <summary>Initial fleet / available-signals fetch with nothing resolved yet — render the loading scaffold.</summary>
    Loading,

    /// <summary>No vehicle is selected (web <c>vehicleId === 0</c>) — render the "select a vehicle" empty state.</summary>
    Empty,

    /// <summary>A fetch failed (web <c>anyError</c>) — render the failure banner.</summary>
    Error,

    /// <summary>A vehicle is selected and its available signals resolved — render the explore controls.</summary>
    Success,
}

/// <summary>The classified value slot of a signal-history row — the native union of the web table's value types.</summary>
public enum SignalExplorerValueType
{
    /// <summary>A finite numeric value (web <c>value_num</c>) — info-tinted badge.</summary>
    Number,

    /// <summary>A string / enum / time value (web <c>value_str</c>) — success-tinted badge.</summary>
    Text,

    /// <summary>A boolean value (web <c>value_bool</c>) — warning-tinted badge.</summary>
    Boolean,
}

/// <summary>
/// One fleet entry filling the page's vehicle picker — the native port of the web <c>useSelectedVehicle</c> list
/// (<c>{ id, display_name }</c>). The <see cref="Label"/> mirrors the web <c>v.display_name || `Vehicle ${id}`</c>
/// fallback. Pure data; parsing is null-tolerant so a partial row never throws.
/// </summary>
public sealed record SignalExplorerVehicle(long Id, string? DisplayName)
{
    /// <summary>The picker label (web <c>display_name || `Vehicle ${id}`</c>).</summary>
    public string Label => string.IsNullOrWhiteSpace(DisplayName)
        ? string.Create(CultureInfo.CurrentCulture, $"Vehicle {Id}")
        : DisplayName!;

    /// <summary>Parse a <c>GET /vehicles</c> JSON array into a tolerant list of fleet entries.</summary>
    public static IReadOnlyList<SignalExplorerVehicle> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<SignalExplorerVehicle>();
        }

        var list = new List<SignalExplorerVehicle>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(new SignalExplorerVehicle(
                    SignalExplorerJsonReaders.Id(item, "id"),
                    SignalExplorerJsonReaders.Str(item, "display_name") ?? SignalExplorerJsonReaders.Str(item, "displayName")));
            }
        }

        return list;
    }
}

/// <summary>
/// One parsed signal-history observation — the native port of the web <c>SignalLogEntry</c>
/// (web/src/components/SignalQueryControls.tsx) the explorer's deferred <c>useQuery</c> flattens. The trio of
/// nullable <see cref="ValueNum"/> / <see cref="ValueStr"/> / <see cref="ValueBool"/> mirrors the web shape and is
/// populated by classifying the wire value's JSON kind (web <c>adaptSignalHistoryPoint</c>'s <c>typeof</c> switch).
/// </summary>
public sealed record SignalExplorerEntry(
    string CreatedAt,
    string Signal,
    double? ValueNum,
    string? ValueStr,
    bool? ValueBool)
{
    /// <summary>The parsed observation instant, or <see langword="null"/> when absent / unparseable.</summary>
    public DateTimeOffset? Timestamp => SignalExplorerJsonReaders.ParseTimestamp(CreatedAt);

    /// <summary>The classified value slot (web <c>getValueType</c>: num → bool → str).</summary>
    public SignalExplorerValueType ValueType()
    {
        if (ValueNum is not null)
        {
            return SignalExplorerValueType.Number;
        }

        if (ValueBool is not null)
        {
            return SignalExplorerValueType.Boolean;
        }

        return SignalExplorerValueType.Text;
    }

    /// <summary>
    /// The chart Y value for this observation — the native port of the web <c>chartData</c> coercion
    /// (<c>value_num ?? (value_bool === true ? 1 : value_bool === false ? 0 : null)</c>): a number passes through,
    /// a boolean maps to 1 / 0, anything else is a gap (<see langword="null"/>).
    /// </summary>
    public double? ChartValue()
    {
        if (ValueNum is { } n)
        {
            return n;
        }

        if (ValueBool is { } b)
        {
            return b ? 1d : 0d;
        }

        return null;
    }

    /// <summary>
    /// The display value (web <c>formatValue</c>: numeric → string → boolean → em-dash). Numbers use the invariant
    /// round-trip form so the C# output matches the web <c>String(value_num)</c>.
    /// </summary>
    public string FormatValue()
    {
        if (ValueNum is { } n)
        {
            return n.ToString(CultureInfo.InvariantCulture);
        }

        if (ValueStr is { } s)
        {
            return s;
        }

        if (ValueBool is { } b)
        {
            return b ? "true" : "false";
        }

        return SignalExplorerProjection.EmDash;
    }

    /// <summary>
    /// Parse a <c>GET /signals/{vehicleID}/{signal}/history</c> envelope
    /// (<c>{ signal, data: [{ ts, kind, value }] }</c>) into a tolerant list of rows — the native port of the web
    /// <c>adaptSignalHistoryResp</c>: each point's value is classified by its JSON kind into the numeric / boolean /
    /// string slot, so a non-finite number or a null value collapses to the em-dash exactly as the web table does.
    /// </summary>
    public static IReadOnlyList<SignalExplorerEntry> ParseHistory(JsonElement envelope)
    {
        if (envelope.ValueKind != JsonValueKind.Object ||
            !envelope.TryGetProperty("data", out var rows) ||
            rows.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<SignalExplorerEntry>();
        }

        string signal = SignalExplorerJsonReaders.Str(envelope, "signal") ?? string.Empty;
        var list = new List<SignalExplorerEntry>(rows.GetArrayLength());
        foreach (var row in rows.EnumerateArray())
        {
            if (row.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromPoint(row, signal));
            }
        }

        return list;
    }

    private static SignalExplorerEntry FromPoint(JsonElement point, string signal)
    {
        string ts = SignalExplorerJsonReaders.Str(point, "ts") ?? string.Empty;
        bool hasValue = point.TryGetProperty("value", out var value);

        double? num = null;
        string? str = null;
        bool? boolean = null;

        if (hasValue)
        {
            switch (value.ValueKind)
            {
                case JsonValueKind.Number when value.TryGetDouble(out var n) && double.IsFinite(n):
                    num = n;
                    break;
                case JsonValueKind.True:
                    boolean = true;
                    break;
                case JsonValueKind.False:
                    boolean = false;
                    break;
                case JsonValueKind.String:
                    str = value.GetString();
                    break;
                default:
                    // null / undefined / non-finite → leave all three nulled out (web `default` branch).
                    break;
            }
        }

        return new SignalExplorerEntry(ts, signal, num, str, boolean);
    }
}

/// <summary>
/// The render-time data model the <see cref="SignalExplorerPageViewModel"/> builds for the projection — the union
/// of the resolved <c>useSignals</c> payload and the page's URL-equivalent state (selected vehicle, selected
/// signals, range, per-page), the Live / Explore toggles and the deferred history rows. Pure data so the projection
/// is asserted headlessly.
/// </summary>
public sealed record SignalExplorerModel(
    IReadOnlyList<SignalExplorerVehicle> Vehicles,
    long? SelectedVehicleId,
    IReadOnlyList<string> AvailableSignals,
    IReadOnlyList<string> SelectedSignals,
    DateRange Range,
    int PerPage,
    bool IsLive,
    bool LiveConnected,
    bool HasExplored,
    bool HistoryLoading,
    IReadOnlyList<SignalExplorerEntry> Rows,
    bool Loading,
    bool IsFetching,
    bool HasError,
    string? ErrorDetail);

/// <summary>One projected vehicle picker option (web <c>VehicleSelect</c> option).</summary>
public sealed record SignalExplorerVehicleOption(long Id, string Label);

/// <summary>One projected "Per Page" option (web <c>PER_PAGE_OPTIONS</c> entry).</summary>
public sealed record SignalExplorerPerPageOption(int Value, string Label);

/// <summary>One projected results-table column (web <c>SignalHistoryTable</c> header).</summary>
public sealed record SignalExplorerColumnDisplay(string Key, string Header);

/// <summary>
/// One projected, render-ready history row — the native analogue of a web <c>SignalHistoryTable</c> row
/// (formatted timestamp + signal name + formatted value + value-type badge). Pure data; the WinUI view maps it onto
/// a text-cell <see cref="TeslaSync.App.Components.UI.TsDataRow"/>.
/// </summary>
public sealed record SignalExplorerRowDisplay(
    string RowKey,
    string Timestamp,
    string Signal,
    string Value,
    string TypeLabel,
    string AccentBrushKey,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the page for one input model — everything the WinUI view binds to,
/// with every visible literal already resolved through the i18n facade and every value formatted at the display
/// boundary. Holds the header (title / subtitle / vehicle picker / live-connection badge), the failure banner, the
/// no-vehicle empty state, the explore-controls panel (GlassPanel1 — the signal selector, time-range, per-page,
/// Explore and Live affordances plus the live help), the pre-explore empty state, and the results region (the
/// SignalStatsPanel + SignalChartPanel feeds and the history table), plus the four data-state flags. Pure data so
/// every branch is asserted headlessly.
/// </summary>
public sealed record SignalExplorerDisplay(
    SignalExplorerState State,
    string Title,
    string Subtitle,
    string SelectVehicleLabel,
    IReadOnlyList<SignalExplorerVehicleOption> VehicleOptions,
    long? SelectedVehicleId,
    bool ShowLoading,
    bool HasError,
    string ErrorBannerText,
    bool ShowNoVehicle,
    string NoVehicleTitle,
    string NoVehicleMessage,
    bool ShowControls,
    IReadOnlyList<string> AvailableSignals,
    IReadOnlyList<string> SelectedSignals,
    string TimeRangeLabel,
    DateRange Range,
    string PerPageLabel,
    IReadOnlyList<SignalExplorerPerPageOption> PerPageOptions,
    int PerPage,
    bool ShowPerPage,
    string ExploreLabel,
    bool ShowExplore,
    bool CanExplore,
    bool IsFetching,
    string LiveLabel,
    string StopLiveLabel,
    string LiveButtonText,
    bool LiveButtonIsDestructive,
    bool CanToggleLive,
    string HelpLiveAria,
    bool IsLive,
    bool ShowLiveBadge,
    bool LiveBadgeConnected,
    string LiveBadgeText,
    bool ShowPreExploreEmpty,
    string PreExploreEmptyTitle,
    string PreExploreEmptyMessage,
    bool ShowResults,
    bool ShowStats,
    IReadOnlyList<SignalStat> Stats,
    IReadOnlyList<SignalChartSample> ChartSamples,
    IReadOnlyList<SignalChartStat> ChartStats,
    long PointsLoaded,
    bool ShowHistoryTable,
    string ResultsTitle,
    string ResultsMetaText,
    bool HistoryLoading,
    IReadOnlyList<SignalExplorerColumnDisplay> Columns,
    IReadOnlyList<SignalExplorerRowDisplay> Rows,
    int TotalRecords,
    bool ShowResultsTable,
    bool ShowEmptyResults,
    string EmptyResultsTitle,
    string EmptyResultsMessage,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="SignalExplorerModel"/> to its <see cref="SignalExplorerDisplay"/> — the native
/// port of the render logic in web/src/features/telemetry/pages/SignalExplorerPage.tsx (plus the
/// <c>chartData</c> / <c>historicalStats</c> memos and the <c>SignalHistoryTable</c> region it composes). Every
/// visible literal resolves through the i18n facade using the exact web key names; timestamps format through
/// <see cref="DateTimeFormatting"/> so the C# output matches the web truth. No WinUI types — unit-tested without a
/// UI host.
/// </summary>
public static class SignalExplorerProjection
{
    /// <summary>Em-dash fallback shared with the web <c>'—'</c> literals.</summary>
    public const string EmDash = "\u2014";

    /// <summary>The web maximum of five concurrently-charted signals (<c>MAX_SIGNALS</c>).</summary>
    public const int MaxSignals = 5;

    /// <summary>Project <paramref name="model"/> into its render-ready display.</summary>
    public static SignalExplorerDisplay Project(SignalExplorerModel model, ILocalizer localizer, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        var vehicleOptions = BuildVehicleOptions(model.Vehicles);
        bool hasVehicle = model.SelectedVehicleId is { } id && id > 0;
        var rows = model.Rows ?? Array.Empty<SignalExplorerEntry>();
        var selectedSignals = model.SelectedSignals ?? Array.Empty<string>();
        int total = rows.Count;

        bool showLoading = model.Loading;
        bool hasError = model.HasError;
        bool showNoVehicle = !showLoading && !hasVehicle;
        bool showControls = !showLoading && hasVehicle;

        // web canExplore: a signal, a valid range and a vehicle.
        bool canExplore = hasVehicle && selectedSignals.Count > 0 && model.Range.IsValid;

        // web: `!hasHistorical && !isLive` renders the pre-explore empty; otherwise the results region.
        bool showResults = showControls && (model.HasExplored || model.IsLive);
        bool showPreExploreEmpty = showControls && !model.HasExplored && !model.IsLive;

        var stats = BuildStats(rows);
        var chartSamples = BuildChartSamples(rows);
        var chartStats = BuildChartStats(selectedSignals, stats);

        // web: `activeStats.length > 0 ? <SignalStatsPanel> : null` — live has no computed stats until data arrives.
        bool showStats = showResults && !model.IsLive && stats.Count > 0;
        bool showHistoryTable = showResults && !model.IsLive && model.HasExplored;
        bool showResultsTable = showHistoryTable && !model.HistoryLoading && total > 0;
        bool showEmptyResults = showHistoryTable && !model.HistoryLoading && total == 0;

        var state = ResolveState(showLoading, hasError, hasVehicle);

        string title = SignalExplorerRegistration.Title(localizer);
        string liveLabel = localizer.GetString("signalExplorer.live", "Live");
        string stopLiveLabel = localizer.GetString("signalExplorer.stopLive", "Stop live");
        string connectedLabel = localizer.GetString("liveMonitor.connected", "Connected");
        string disconnectedLabel = localizer.GetString("liveMonitor.disconnected", "Disconnected");

        return new SignalExplorerDisplay(
            State: state,
            Title: title,
            Subtitle: SignalExplorerRegistration.Subtitle(localizer),
            SelectVehicleLabel: localizer.GetString("signalExplorer.selectVehicle", "Select vehicle"),
            VehicleOptions: vehicleOptions,
            SelectedVehicleId: model.SelectedVehicleId,
            ShowLoading: showLoading,
            HasError: hasError,
            ErrorBannerText: BuildErrorBannerText(model, localizer),
            ShowNoVehicle: showNoVehicle,
            NoVehicleTitle: localizer.GetString("signalExplorer.noVehicle", "Select a vehicle to begin"),
            NoVehicleMessage: localizer.GetString(
                "signalExplorer.noVehicleDesc",
                "Pick a vehicle from the picker above to explore its signals."),
            ShowControls: showControls,
            AvailableSignals: model.AvailableSignals ?? Array.Empty<string>(),
            SelectedSignals: selectedSignals,
            TimeRangeLabel: localizer.GetString("Time Range", "Time Range"),
            Range: model.Range,
            PerPageLabel: localizer.GetString("Per Page", "Per Page"),
            PerPageOptions: SignalExplorerRegistration.PerPageOptions,
            PerPage: NormalizePerPage(model.PerPage),
            ShowPerPage: !model.IsLive,
            ExploreLabel: localizer.GetString("Explore", "Explore"),
            ShowExplore: !model.IsLive,
            CanExplore: canExplore,
            IsFetching: model.IsFetching,
            LiveLabel: liveLabel,
            StopLiveLabel: stopLiveLabel,
            LiveButtonText: model.IsLive ? stopLiveLabel : liveLabel,
            LiveButtonIsDestructive: model.IsLive,
            // web: `disabled={selectedSignals.length === 0 && !isLive}`.
            CanToggleLive: selectedSignals.Count > 0 || model.IsLive,
            HelpLiveAria: localizer.GetString("help.signal.live.aria", "More info about live signal streaming"),
            IsLive: model.IsLive,
            ShowLiveBadge: model.IsLive,
            LiveBadgeConnected: model.LiveConnected,
            LiveBadgeText: model.LiveConnected ? connectedLabel : disconnectedLabel,
            ShowPreExploreEmpty: showPreExploreEmpty,
            PreExploreEmptyTitle: localizer.GetString("Pick signals and click Explore", "Pick signals and click Explore"),
            PreExploreEmptyMessage: localizer.GetString(
                "Choose up to 5 signals, set a date range, then hit Explore \u2014 or toggle Live to stream in real time.",
                "Choose up to 5 signals, set a date range, then hit Explore \u2014 or toggle Live to stream in real time."),
            ShowResults: showResults,
            ShowStats: showStats,
            Stats: stats,
            ChartSamples: chartSamples,
            ChartStats: chartStats,
            PointsLoaded: total,
            ShowHistoryTable: showHistoryTable,
            ResultsTitle: localizer.GetString("Signal Data", "Signal Data"),
            ResultsMetaText: BuildResultsMeta(total, localizer),
            HistoryLoading: showHistoryTable && model.HistoryLoading,
            Columns: BuildColumns(localizer),
            Rows: BuildRows(rows, localizer, now),
            TotalRecords: total,
            ShowResultsTable: showResultsTable,
            ShowEmptyResults: showEmptyResults,
            EmptyResultsTitle: localizer.GetString("No data", "No data"),
            EmptyResultsMessage: localizer.GetString(
                "No signal data found for this query.",
                "No signal data found for this query."),
            AutomationName: title);
    }

    /// <summary>The localized value-type badge label (web <c>valueType</c>: number / string / boolean).</summary>
    public static string ValueTypeLabel(SignalExplorerValueType type, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return type switch
        {
            SignalExplorerValueType.Number => localizer.GetString("number", "number"),
            SignalExplorerValueType.Boolean => localizer.GetString("boolean", "boolean"),
            _ => localizer.GetString("string", "string"),
        };
    }

    /// <summary>The token brush key tinting a value-type badge (web <c>TYPE_BADGE_VARIANT</c>).</summary>
    public static string ValueTypeAccent(SignalExplorerValueType type) => type switch
    {
        SignalExplorerValueType.Number => "TsColorInfoBrush",
        SignalExplorerValueType.Boolean => "TsColorWarningBrush",
        _ => "TsColorSuccessBrush",
    };

    /// <summary>
    /// Aggregate the per-signal stats from the loaded rows — the native port of the web <c>historicalStats</c>
    /// memo: group the finite numeric samples by signal and emit min / max / avg / count, in first-seen order.
    /// </summary>
    public static IReadOnlyList<SignalStat> BuildStats(IReadOnlyList<SignalExplorerEntry> rows)
    {
        ArgumentNullException.ThrowIfNull(rows);
        if (rows.Count == 0)
        {
            return Array.Empty<SignalStat>();
        }

        var order = new List<string>();
        var bySignal = new Dictionary<string, List<double>>(StringComparer.Ordinal);
        foreach (var row in rows)
        {
            if (row.ValueNum is not { } value)
            {
                continue;
            }

            if (!bySignal.TryGetValue(row.Signal, out var values))
            {
                values = new List<double>();
                bySignal[row.Signal] = values;
                order.Add(row.Signal);
            }

            values.Add(value);
        }

        if (order.Count == 0)
        {
            return Array.Empty<SignalStat>();
        }

        var result = new List<SignalStat>(order.Count);
        foreach (var signal in order)
        {
            var values = bySignal[signal];
            double min = values[0];
            double max = values[0];
            double sum = 0;
            foreach (var v in values)
            {
                if (v < min)
                {
                    min = v;
                }

                if (v > max)
                {
                    max = v;
                }

                sum += v;
            }

            result.Add(new SignalStat(signal, min, max, sum / values.Count, values.Count));
        }

        return result;
    }

    /// <summary>
    /// Pivot the loaded rows into chart sample rows keyed by timestamp — the native port of the web
    /// <c>chartData</c> memo: one sample per distinct <c>created_at</c>, each mapping a signal to its coerced Y
    /// value, ascending by timestamp.
    /// </summary>
    public static IReadOnlyList<SignalChartSample> BuildChartSamples(IReadOnlyList<SignalExplorerEntry> rows)
    {
        ArgumentNullException.ThrowIfNull(rows);
        if (rows.Count == 0)
        {
            return Array.Empty<SignalChartSample>();
        }

        var order = new List<string>();
        var byTimestamp = new Dictionary<string, Dictionary<string, double?>>(StringComparer.Ordinal);
        foreach (var row in rows)
        {
            if (!byTimestamp.TryGetValue(row.CreatedAt, out var bucket))
            {
                bucket = new Dictionary<string, double?>(StringComparer.Ordinal);
                byTimestamp[row.CreatedAt] = bucket;
                order.Add(row.CreatedAt);
            }

            bucket[row.Signal] = row.ChartValue();
        }

        order.Sort(static (a, b) =>
            (SignalExplorerJsonReaders.ParseTimestamp(a) ?? DateTimeOffset.MinValue)
            .CompareTo(SignalExplorerJsonReaders.ParseTimestamp(b) ?? DateTimeOffset.MinValue));

        var samples = new List<SignalChartSample>(order.Count);
        foreach (var ts in order)
        {
            samples.Add(new SignalChartSample(ts, byTimestamp[ts]));
        }

        return samples;
    }

    private static IReadOnlyList<SignalChartStat> BuildChartStats(
        IReadOnlyList<string> selectedSignals,
        IReadOnlyList<SignalStat> stats)
    {
        if (stats.Count == 0)
        {
            return Array.Empty<SignalChartStat>();
        }

        var bySignal = new Dictionary<string, SignalStat>(StringComparer.Ordinal);
        foreach (var stat in stats)
        {
            bySignal[stat.Signal] = stat;
        }

        IReadOnlyList<string> ordered = selectedSignals.Count > 0
            ? selectedSignals
            : stats.Select(static s => s.Signal).ToList();

        var result = new List<SignalChartStat>(ordered.Count);
        foreach (var signal in ordered)
        {
            if (bySignal.TryGetValue(signal, out var stat))
            {
                result.Add(new SignalChartStat(stat.Min, stat.Max));
            }
        }

        return result;
    }

    private static SignalExplorerState ResolveState(bool loading, bool hasError, bool hasVehicle)
    {
        if (loading)
        {
            return SignalExplorerState.Loading;
        }

        if (hasError)
        {
            return SignalExplorerState.Error;
        }

        return hasVehicle ? SignalExplorerState.Success : SignalExplorerState.Empty;
    }

    private static IReadOnlyList<SignalExplorerVehicleOption> BuildVehicleOptions(IReadOnlyList<SignalExplorerVehicle> vehicles)
    {
        if (vehicles is null || vehicles.Count == 0)
        {
            return Array.Empty<SignalExplorerVehicleOption>();
        }

        var options = new List<SignalExplorerVehicleOption>(vehicles.Count);
        foreach (var vehicle in vehicles)
        {
            options.Add(new SignalExplorerVehicleOption(vehicle.Id, vehicle.Label));
        }

        return options;
    }

    private static IReadOnlyList<SignalExplorerColumnDisplay> BuildColumns(ILocalizer localizer) =>
    [
        new("time", localizer.GetString("Timestamp", "Timestamp")),
        new("signal", localizer.GetString("Signal", "Signal")),
        new("value", localizer.GetString("Value", "Value")),
        new("type", localizer.GetString("Type", "Type")),
    ];

    private static IReadOnlyList<SignalExplorerRowDisplay> BuildRows(
        IReadOnlyList<SignalExplorerEntry> rows,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        if (rows.Count == 0)
        {
            return Array.Empty<SignalExplorerRowDisplay>();
        }

        var result = new List<SignalExplorerRowDisplay>(rows.Count);
        for (int i = 0; i < rows.Count; i++)
        {
            var row = rows[i];
            var type = row.ValueType();
            string typeLabel = ValueTypeLabel(type, localizer);
            string timestamp = DateTimeFormatting.Format(row.Timestamp, DateTimeVariant.Full, now);
            string signal = string.IsNullOrEmpty(row.Signal) ? EmDash : row.Signal;
            string value = row.FormatValue();
            string key = string.Create(CultureInfo.InvariantCulture, $"{row.CreatedAt}-{row.Signal}-{i}");

            result.Add(new SignalExplorerRowDisplay(
                RowKey: key,
                Timestamp: timestamp,
                Signal: signal,
                Value: value,
                TypeLabel: typeLabel,
                AccentBrushKey: ValueTypeAccent(type),
                AutomationName: string.Create(CultureInfo.CurrentCulture, $"{timestamp}: {signal} {value} ({typeLabel})")));
        }

        return result;
    }

    private static string BuildErrorBannerText(SignalExplorerModel model, ILocalizer localizer)
    {
        // web: `{t('error.loadFailed', 'Failed to load data')}: {getErrorMessage(anyError)}`.
        string headline = localizer.GetString("error.loadFailed", "Failed to load data");
        if (string.IsNullOrWhiteSpace(model.ErrorDetail))
        {
            return headline;
        }

        return string.Create(CultureInfo.CurrentCulture, $"{headline}: {model.ErrorDetail}");
    }

    private static string BuildResultsMeta(int total, ILocalizer localizer)
    {
        // web SignalHistoryTable header: `{fmtInt(totalRows)} {t('total')}`.
        string totalWord = localizer.GetString("total", "total");
        string count = total.ToString("N0", CultureInfo.CurrentCulture);
        return string.Concat(count, " ", totalWord);
    }

    private static int NormalizePerPage(int perPage) =>
        SignalExplorerRegistration.IsKnownPerPage(perPage) ? perPage : SignalExplorerRegistration.DefaultPerPage;
}

/// <summary>
/// Canonical metadata for the <c>SignalExplorerPage</c> feature surface — the native mirror of the web page at
/// web/src/features/telemetry/pages/SignalExplorerPage.tsx (route <c>/signal-explorer</c>, nav name
/// <c>SignalExplorer</c>).
/// </summary>
public static class SignalExplorerRegistration
{
    private static readonly HashSet<int> PerPageSet = [25, 50, 100, 500];

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "SignalExplorerPage";

    /// <summary>The navigation route name this page registers under (see RouteTable <c>SignalExplorer</c>).</summary>
    public const string RouteName = "SignalExplorer";

    /// <summary>The default page size (web <c>useUrlNumber('size', 25)</c>).</summary>
    public const int DefaultPerPage = 25;

    /// <summary>Generated operation id for <c>GET /api/v1/vehicles</c> (web <c>useSelectedVehicle</c> fleet list).</summary>
    public const string VehiclesOperation = "get_api_v1_vehicles";

    /// <summary>Generated operation id for <c>GET /api/v1/signals/{vehicleID}/available</c> (web <c>useSignals</c>).</summary>
    public const string AvailableOperation = "get_api_v1_signals_vehicleID_available";

    /// <summary>Generated operation id for <c>GET /api/v1/signals/{vehicleID}/{signalName}/history</c>.</summary>
    public const string HistoryOperation = "get_api_v1_signals_vehicleID_signalName_history";

    /// <summary>The vehicle-id path-parameter name in the available / history operation templates.</summary>
    public const string VehiclePathParam = "vehicleID";

    /// <summary>The signal-name path-parameter name in the history operation template.</summary>
    public const string SignalPathParam = "signalName";

    /// <summary>The "Per Page" page-size choices (web <c>PER_PAGE_OPTIONS</c>).</summary>
    public static IReadOnlyList<int> PerPageValues { get; } = [25, 50, 100, 500];

    /// <summary>The "Per Page" options projected for the picker (web <c>PER_PAGE_OPTIONS</c>).</summary>
    public static IReadOnlyList<SignalExplorerPerPageOption> PerPageOptions { get; } =
    [
        new(25, "25"),
        new(50, "50"),
        new(100, "100"),
        new(500, "500"),
    ];

    /// <summary>True when <paramref name="value"/> is one of the known page sizes.</summary>
    public static bool IsKnownPerPage(int value) => PerPageSet.Contains(value);

    /// <summary>The localized page title (web <c>usePageTitle(t('Signal Explorer'))</c> + the PageContainer title).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("Signal Explorer", "Signal Explorer");
    }

    /// <summary>The localized page subtitle (web <c>t('Visualise signal history with chart and stats — or stream live')</c>).</summary>
    public static string Subtitle(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "Visualise signal history with chart and stats \u2014 or stream live",
            "Visualise signal history with chart and stats \u2014 or stream live");
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>SignalExplorerPage</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a vehicle id, signal name, value or date
/// range — so a diagnostics line can never leak telemetry. Thread-safe.
/// </summary>
public sealed class SignalExplorerDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public SignalExplorerDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=SignalExplorerPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(string.Create(CultureInfo.InvariantCulture, $"view.opened slug={SignalExplorerRegistration.Slug}"));
    }
}

/// <summary>Small null-tolerant JSON readers shared by the vehicle / history parsers (UI-free, unit-tested).</summary>
internal static class SignalExplorerJsonReaders
{
    public static string? Str(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    public static long Id(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return 0;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetInt64(out var n) => n,
            JsonValueKind.String when long.TryParse(
                v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) => n,
            _ => 0,
        };
    }

    public static DateTimeOffset? ParseTimestamp(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            value,
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var parsed)
            ? parsed
            : null;
    }
}
