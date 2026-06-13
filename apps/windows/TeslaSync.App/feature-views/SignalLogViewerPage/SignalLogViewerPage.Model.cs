using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Telemetry;

/// <summary>
/// The top-level data state the <c>SignalLogViewerPage</c> can be in — the native union of the four web data
/// states the page renders (web/src/features/telemetry/pages/SignalLogViewerPage.tsx): the initial fleet /
/// available-signals load (<see cref="Loading"/>), the no-vehicle guard (web <c>vehicleId === 0</c>,
/// <see cref="Empty"/>), a fetch failure (web <c>anyError</c>, <see cref="Error"/>) and the populated controls
/// (<see cref="Success"/>). Every branch maps onto a visible surface; none is ever hidden.
/// </summary>
public enum SignalLogViewerState
{
    /// <summary>Initial fleet / available-signals fetch with nothing resolved yet — render the loading scaffold.</summary>
    Loading,

    /// <summary>No vehicle is selected (web <c>vehicleId === 0</c>) — render the "select a vehicle" empty state.</summary>
    Empty,

    /// <summary>A fetch failed (web <c>anyError</c>) — render the failure banner.</summary>
    Error,

    /// <summary>A vehicle is selected and its available signals resolved — render the query controls.</summary>
    Success,
}

/// <summary>The classified value slot of a signal-log row — the native union of the web table's value types.</summary>
public enum SignalLogValueType
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
public sealed record SignalLogViewerVehicle(long Id, string? DisplayName)
{
    /// <summary>The picker label (web <c>display_name || `Vehicle ${id}`</c>).</summary>
    public string Label => string.IsNullOrWhiteSpace(DisplayName)
        ? string.Create(CultureInfo.CurrentCulture, $"Vehicle {Id}")
        : DisplayName!;

    /// <summary>Parse a <c>GET /vehicles</c> JSON array into a tolerant list of fleet entries.</summary>
    public static IReadOnlyList<SignalLogViewerVehicle> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<SignalLogViewerVehicle>();
        }

        var list = new List<SignalLogViewerVehicle>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(new SignalLogViewerVehicle(
                    SignalLogJsonReaders.Id(item, "id"),
                    SignalLogJsonReaders.Str(item, "display_name") ?? SignalLogJsonReaders.Str(item, "displayName")));
            }
        }

        return list;
    }
}

/// <summary>
/// One parsed signal-history row — the native port of the web <c>SignalLogEntry</c>
/// (web/src/components/SignalQueryControls.tsx). The trio of nullable
/// <see cref="ValueNum"/> / <see cref="ValueStr"/> / <see cref="ValueBool"/> mirrors the web shape exactly and is
/// populated by classifying the wire value's JSON kind (web <c>adaptSignalHistoryPoint</c>'s <c>typeof</c> switch).
/// </summary>
public sealed record SignalLogEntry(
    string CreatedAt,
    string Signal,
    double? ValueNum,
    string? ValueStr,
    bool? ValueBool)
{
    /// <summary>The parsed observation instant, or <see langword="null"/> when absent / unparseable.</summary>
    public DateTimeOffset? Timestamp => SignalLogJsonReaders.ParseTimestamp(CreatedAt);

    /// <summary>The classified value slot (web <c>getValueType</c>: num → str → bool, defaulting to string).</summary>
    public SignalLogValueType ValueType()
    {
        if (ValueNum is not null)
        {
            return SignalLogValueType.Number;
        }

        if (ValueBool is not null)
        {
            return SignalLogValueType.Boolean;
        }

        return SignalLogValueType.Text;
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

        return SignalLogViewerProjection.EmDash;
    }

    /// <summary>
    /// Parse a <c>GET /signals/{vehicleID}/{signal}/history</c> envelope
    /// (<c>{ signal, data: [{ ts, kind, value }] }</c>) into a tolerant list of rows — the native port of the web
    /// <c>adaptSignalHistoryResp</c>: each point's value is classified by its JSON kind into the numeric / boolean /
    /// string slot, so a non-finite number or a null value collapses to the em-dash exactly as the web table does.
    /// </summary>
    public static IReadOnlyList<SignalLogEntry> ParseHistory(JsonElement envelope)
    {
        if (envelope.ValueKind != JsonValueKind.Object ||
            !envelope.TryGetProperty("data", out var rows) ||
            rows.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<SignalLogEntry>();
        }

        string signal = SignalLogJsonReaders.Str(envelope, "signal") ?? string.Empty;
        var list = new List<SignalLogEntry>(rows.GetArrayLength());
        foreach (var row in rows.EnumerateArray())
        {
            if (row.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromPoint(row, signal));
            }
        }

        return list;
    }

    private static SignalLogEntry FromPoint(JsonElement point, string signal)
    {
        string ts = SignalLogJsonReaders.Str(point, "ts") ?? string.Empty;
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

        return new SignalLogEntry(ts, signal, num, str, boolean);
    }
}

/// <summary>
/// The render-time data model the <see cref="SignalLogViewerPageViewModel"/> builds for the projection — the union
/// of the resolved <c>useSignals</c> payload and the page's URL-equivalent state (selected vehicle, selected
/// signals, range, per-page, the latched query and its fetched rows). Pure data so the projection is asserted
/// headlessly.
/// </summary>
public sealed record SignalLogViewerModel(
    IReadOnlyList<SignalLogViewerVehicle> Vehicles,
    long? SelectedVehicleId,
    IReadOnlyList<string> AvailableSignals,
    IReadOnlyList<string> SelectedSignals,
    DateRange Range,
    int PerPage,
    bool HasQueried,
    bool HistoryLoading,
    IReadOnlyList<SignalLogEntry> Rows,
    bool Loading,
    bool IsFetching,
    bool HasError,
    string? ErrorDetail);

/// <summary>One projected vehicle picker option (web <c>VehicleSelect</c> option).</summary>
public sealed record SignalLogVehicleOption(long Id, string Label);

/// <summary>One projected "Per Page" option (web <c>PER_PAGE_OPTIONS</c> entry).</summary>
public sealed record SignalLogPerPageOption(int Value, string Label);

/// <summary>One projected results-table column (web <c>Column</c> header).</summary>
public sealed record SignalLogColumnDisplay(string Key, string Header);

/// <summary>
/// One projected, render-ready results row — the native analogue of a web <c>SignalHistoryTable</c> row
/// (formatted timestamp + signal name + formatted value + value-type badge). Pure data; the WinUI view maps it onto
/// a text-cell <see cref="TeslaSync.App.Components.UI.TsDataRow"/>.
/// </summary>
public sealed record SignalLogRowDisplay(
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
/// boundary. Holds the header, the failure banner, the no-vehicle empty state, the query-controls panel
/// (GlassPanel1), the pre-query empty state and the results region (table + empty / loading), plus the four
/// data-state flags. Pure data so every branch is asserted headlessly.
/// </summary>
public sealed record SignalLogViewerDisplay(
    SignalLogViewerState State,
    string Title,
    string Subtitle,
    string SelectVehicleLabel,
    IReadOnlyList<SignalLogVehicleOption> VehicleOptions,
    long? SelectedVehicleId,
    bool ShowLoading,
    bool HasError,
    string ErrorBannerText,
    bool ShowNoVehicle,
    string NoVehicleTitle,
    string NoVehicleMessage,
    bool ShowControls,
    string SignalsLabel,
    IReadOnlyList<string> AvailableSignals,
    IReadOnlyList<string> SelectedSignals,
    string TimeRangeLabel,
    DateRange Range,
    string PerPageLabel,
    IReadOnlyList<SignalLogPerPageOption> PerPageOptions,
    int PerPage,
    string QueryLabel,
    bool CanQuery,
    bool IsFetching,
    bool HasQueried,
    bool ShowRecords,
    string RecordsText,
    bool ShowPreQueryEmpty,
    string PreQueryEmptyTitle,
    string PreQueryEmptyMessage,
    bool ShowResults,
    string ResultsTitle,
    string ResultsMetaText,
    bool HistoryLoading,
    IReadOnlyList<SignalLogColumnDisplay> Columns,
    IReadOnlyList<SignalLogRowDisplay> Rows,
    int TotalRecords,
    bool ShowResultsTable,
    bool ShowEmptyResults,
    string EmptyResultsTitle,
    string EmptyResultsMessage,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="SignalLogViewerModel"/> to its <see cref="SignalLogViewerDisplay"/> — the
/// native port of the render logic in web/src/features/telemetry/pages/SignalLogViewerPage.tsx (plus the
/// <c>SignalHistoryTable</c> results region it composes). Every visible literal resolves through the i18n facade
/// using the exact web key names; timestamps format through <see cref="DateTimeFormatting"/> so the C# output
/// matches the web truth. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class SignalLogViewerProjection
{
    /// <summary>Em-dash fallback shared with the web <c>'—'</c> literals.</summary>
    public const string EmDash = "\u2014";

    /// <summary>Project <paramref name="model"/> into its render-ready display.</summary>
    public static SignalLogViewerDisplay Project(SignalLogViewerModel model, ILocalizer localizer, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        var vehicleOptions = BuildVehicleOptions(model.Vehicles);
        bool hasVehicle = model.SelectedVehicleId is { } id && id > 0;
        var rows = model.Rows ?? Array.Empty<SignalLogEntry>();
        var selectedSignals = model.SelectedSignals ?? Array.Empty<string>();
        int total = rows.Count;

        bool showLoading = model.Loading;
        bool hasError = model.HasError;
        bool showNoVehicle = !showLoading && !hasVehicle;
        bool showControls = !showLoading && hasVehicle;

        bool canQuery = hasVehicle && selectedSignals.Count > 0 && model.Range.IsValid;

        bool showPreQueryEmpty = showControls && !model.HasQueried;
        bool showResults = showControls && model.HasQueried;
        bool showResultsTable = showResults && !model.HistoryLoading && total > 0;
        bool showEmptyResults = showResults && !model.HistoryLoading && total == 0;

        var state = ResolveState(showLoading, hasError, hasVehicle);

        string title = SignalLogViewerRegistration.Title(localizer);
        string subtitle = SignalLogViewerRegistration.Subtitle(localizer);
        string recordsWord = localizer.GetString("records", "records");
        string recordsText = string.Create(CultureInfo.CurrentCulture, $"{total} {recordsWord}");

        return new SignalLogViewerDisplay(
            State: state,
            Title: title,
            Subtitle: subtitle,
            SelectVehicleLabel: localizer.GetString("signalLog.selectVehicle", "Select vehicle"),
            VehicleOptions: vehicleOptions,
            SelectedVehicleId: model.SelectedVehicleId,
            ShowLoading: showLoading,
            HasError: hasError,
            ErrorBannerText: BuildErrorBannerText(model, localizer),
            ShowNoVehicle: showNoVehicle,
            NoVehicleTitle: localizer.GetString("signalLog.noVehicle", "Select a vehicle to begin"),
            NoVehicleMessage: localizer.GetString(
                "signalLog.noVehicleDesc",
                "Pick a vehicle from the picker above to query its signal history."),
            ShowControls: showControls,
            SignalsLabel: localizer.GetString("Signals", "Signals"),
            AvailableSignals: model.AvailableSignals ?? Array.Empty<string>(),
            SelectedSignals: selectedSignals,
            TimeRangeLabel: localizer.GetString("Time Range", "Time Range"),
            Range: model.Range,
            PerPageLabel: localizer.GetString("Per Page", "Per Page"),
            PerPageOptions: SignalLogViewerRegistration.PerPageOptions,
            PerPage: NormalizePerPage(model.PerPage),
            QueryLabel: localizer.GetString("Query", "Query"),
            CanQuery: canQuery,
            IsFetching: model.IsFetching,
            HasQueried: model.HasQueried,
            ShowRecords: showControls && model.HasQueried,
            RecordsText: recordsText,
            ShowPreQueryEmpty: showPreQueryEmpty,
            PreQueryEmptyTitle: localizer.GetString("Select signals and click Query", "Select signals and click Query"),
            PreQueryEmptyMessage: localizer.GetString(
                "Choose one or more signals, set a date range, then hit Query to browse signal history.",
                "Choose one or more signals, set a date range, then hit Query to browse signal history."),
            ShowResults: showResults,
            ResultsTitle: localizer.GetString("Signal Data", "Signal Data"),
            ResultsMetaText: BuildResultsMeta(total, localizer),
            HistoryLoading: showResults && model.HistoryLoading,
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
    public static string ValueTypeLabel(SignalLogValueType type, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return type switch
        {
            SignalLogValueType.Number => localizer.GetString("number", "number"),
            SignalLogValueType.Boolean => localizer.GetString("boolean", "boolean"),
            _ => localizer.GetString("string", "string"),
        };
    }

    /// <summary>The token brush key tinting a value-type badge (web <c>TYPE_BADGE_VARIANT</c>).</summary>
    public static string ValueTypeAccent(SignalLogValueType type) => type switch
    {
        SignalLogValueType.Number => "TsColorInfoBrush",
        SignalLogValueType.Boolean => "TsColorWarningBrush",
        _ => "TsColorSuccessBrush",
    };

    private static SignalLogViewerState ResolveState(bool loading, bool hasError, bool hasVehicle)
    {
        if (loading)
        {
            return SignalLogViewerState.Loading;
        }

        if (hasError)
        {
            return SignalLogViewerState.Error;
        }

        return hasVehicle ? SignalLogViewerState.Success : SignalLogViewerState.Empty;
    }

    private static IReadOnlyList<SignalLogVehicleOption> BuildVehicleOptions(IReadOnlyList<SignalLogViewerVehicle> vehicles)
    {
        if (vehicles is null || vehicles.Count == 0)
        {
            return Array.Empty<SignalLogVehicleOption>();
        }

        var options = new List<SignalLogVehicleOption>(vehicles.Count);
        foreach (var vehicle in vehicles)
        {
            options.Add(new SignalLogVehicleOption(vehicle.Id, vehicle.Label));
        }

        return options;
    }

    private static IReadOnlyList<SignalLogColumnDisplay> BuildColumns(ILocalizer localizer) =>
    [
        new("time", localizer.GetString("Timestamp", "Timestamp")),
        new("signal", localizer.GetString("Signal", "Signal")),
        new("value", localizer.GetString("Value", "Value")),
        new("type", localizer.GetString("Type", "Type")),
    ];

    private static IReadOnlyList<SignalLogRowDisplay> BuildRows(
        IReadOnlyList<SignalLogEntry> rows,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        if (rows.Count == 0)
        {
            return Array.Empty<SignalLogRowDisplay>();
        }

        var result = new List<SignalLogRowDisplay>(rows.Count);
        for (int i = 0; i < rows.Count; i++)
        {
            var row = rows[i];
            var type = row.ValueType();
            string typeLabel = ValueTypeLabel(type, localizer);
            string timestamp = DateTimeFormatting.Format(row.Timestamp, DateTimeVariant.Full, now);
            string signal = string.IsNullOrEmpty(row.Signal) ? EmDash : row.Signal;
            string value = row.FormatValue();
            string key = string.Create(CultureInfo.InvariantCulture, $"{row.CreatedAt}-{row.Signal}-{i}");

            result.Add(new SignalLogRowDisplay(
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

    private static string BuildErrorBannerText(SignalLogViewerModel model, ILocalizer localizer)
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
        SignalLogViewerRegistration.IsKnownPerPage(perPage) ? perPage : SignalLogViewerRegistration.DefaultPerPage;
}

/// <summary>
/// Canonical metadata for the <c>SignalLogViewerPage</c> feature surface — the native mirror of the web page at
/// web/src/features/telemetry/pages/SignalLogViewerPage.tsx (route <c>/signal-log</c>, nav name
/// <c>SignalLogViewer</c>).
/// </summary>
public static class SignalLogViewerRegistration
{
    private static readonly HashSet<int> PerPageSet = [25, 50, 100, 500];

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "SignalLogViewerPage";

    /// <summary>The navigation route name this page registers under (see RouteTable <c>SignalLogViewer</c>).</summary>
    public const string RouteName = "SignalLogViewer";

    /// <summary>The browser-tab title key (web <c>usePageTitle(t('Signal Log'))</c>).</summary>
    public const string PageTitleKey = "Signal Log";

    /// <summary>The default page size (web <c>useState(50)</c>).</summary>
    public const int DefaultPerPage = 50;

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
    public static IReadOnlyList<SignalLogPerPageOption> PerPageOptions { get; } =
    [
        new(25, "25"),
        new(50, "50"),
        new(100, "100"),
        new(500, "500"),
    ];

    /// <summary>True when <paramref name="value"/> is one of the known page sizes.</summary>
    public static bool IsKnownPerPage(int value) => PerPageSet.Contains(value);

    /// <summary>The browser-tab page title (web <c>usePageTitle(t('Signal Log'))</c>).</summary>
    public static string PageTitle(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(PageTitleKey, "Signal Log");
    }

    /// <summary>The localized page title (web <c>t('Signal Log Viewer')</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("Signal Log Viewer", "Signal Log Viewer");
    }

    /// <summary>The localized page subtitle (web <c>t('Query signal history from Postgres')</c>).</summary>
    public static string Subtitle(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("Query signal history from Postgres", "Query signal history from Postgres");
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>SignalLogViewerPage</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a vehicle id, signal name, value or date
/// range — so a diagnostics line can never leak telemetry. Thread-safe.
/// </summary>
public sealed class SignalLogViewerDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public SignalLogViewerDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=SignalLogViewerPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(string.Create(CultureInfo.InvariantCulture, $"view.opened slug={SignalLogViewerRegistration.Slug}"));
    }
}

/// <summary>Small null-tolerant JSON readers shared by the vehicle / history parsers (UI-free, unit-tested).</summary>
internal static class SignalLogJsonReaders
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

    public static DateTimeOffset? ParseTimestamp(string? raw)
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
