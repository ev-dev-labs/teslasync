using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Telemetry;

/// <summary>
/// The top-level data state the <c>SignalGapDetectorPage</c> can be in — the native union of the web page's render
/// branches (web/src/features/telemetry/pages/SignalGapDetectorPage.tsx): the initial fleet load
/// (<see cref="Loading"/>), the no-vehicle guard (web <c>!vehicleId || vehicleId &lt;= 0</c>,
/// <see cref="Empty"/>), a fleet-load failure (<see cref="Error"/>) and the selected-vehicle catalog
/// (<see cref="Catalog"/>, web <c>&lt;SignalCatalogPanel&gt;</c>). Every branch maps onto a visible surface; none is
/// ever hidden.
/// </summary>
public enum SignalGapDetectorState
{
    /// <summary>Initial fleet fetch with nothing resolved yet — render the loading scaffold.</summary>
    Loading,

    /// <summary>No vehicle is selected (web <c>!vehicleId</c>) — render the "select a vehicle" empty state.</summary>
    Empty,

    /// <summary>The fleet fetch failed — render the failure banner so the picker is never silently blank.</summary>
    Error,

    /// <summary>A vehicle is selected — render the staleness-aware signal catalog.</summary>
    Catalog,
}

/// <summary>
/// The inner state of the catalog region (web <c>SignalCatalogPanel</c> + <c>useSignalGaps</c>): the live-signal
/// fetch in flight (<see cref="Loading"/>), a fetch failure (<see cref="Error"/>), a resolved-but-empty catalog
/// (<see cref="Empty"/>, web "No signal data available") and a populated catalog (<see cref="Success"/>).
/// </summary>
public enum SignalGapCatalogState
{
    /// <summary>The per-vehicle live-signal read is in flight — render the row skeleton.</summary>
    Loading,

    /// <summary>The live-signal read failed — render the catalog error state.</summary>
    Error,

    /// <summary>The vehicle reported no signals — render the "No signal data available" empty state.</summary>
    Empty,

    /// <summary>The vehicle reported signals — render the summary cards and the catalog table.</summary>
    Success,
}

/// <summary>
/// The staleness category of a signal used for filtering and the summary counts — the native port of the web
/// <c>SignalRow['category']</c> (<c>!ts ? 'never' : staleness &gt; 300 ? 'stale' : 'active'</c>).
/// </summary>
public enum SignalGapCategory
{
    /// <summary>A timestamp arrived within the last five minutes (web <c>'active'</c>).</summary>
    Active,

    /// <summary>A timestamp arrived more than five minutes ago (web <c>'stale'</c>).</summary>
    Stale,

    /// <summary>No timestamp ever arrived (web <c>'never'</c>).</summary>
    Never,
}

/// <summary>
/// The staleness band driving the status badge label / colour — the native port of the web
/// <c>getCatalogStalenessStyle</c> four-way switch (never received / active &lt;30s / aging &lt;5min / stale).
/// </summary>
public enum SignalGapBand
{
    /// <summary>A timestamp arrived within the last 30 seconds (web "Active", success tint).</summary>
    Active,

    /// <summary>A timestamp arrived 30s–5min ago (web "Aging", warning tint).</summary>
    Aging,

    /// <summary>A timestamp arrived more than 5 minutes ago (web "Stale", danger tint).</summary>
    Stale,

    /// <summary>No timestamp ever arrived (web "Never received", muted tint).</summary>
    Never,
}

/// <summary>The catalog filter mode (web <c>CatalogFilterMode</c>: all / stale / active).</summary>
public enum SignalGapFilterMode
{
    /// <summary>Show every signal (web <c>'all'</c>).</summary>
    All,

    /// <summary>Show only stale or never-received signals (web <c>'stale'</c>).</summary>
    Stale,

    /// <summary>Show only active signals (web <c>'active'</c>).</summary>
    Active,
}

/// <summary>The catalog sort mode (web <c>CatalogSortMode</c>: staleness / alpha / category).</summary>
public enum SignalGapSortMode
{
    /// <summary>Most-stale first (web <c>'staleness'</c>, descending staleness).</summary>
    Staleness,

    /// <summary>Alphabetical by signal name (web <c>'alpha'</c>).</summary>
    Alpha,

    /// <summary>Grouped by category never → stale → active (web <c>'category'</c>).</summary>
    Category,
}

/// <summary>
/// One fleet entry filling the page's vehicle picker — the native port of the web <c>useSelectedVehicle</c> list
/// (<c>{ id, display_name }</c>). The <see cref="Label"/> mirrors the web <c>v.display_name || `Vehicle ${id}`</c>
/// fallback. Pure data; parsing is null-tolerant so a partial row never throws.
/// </summary>
/// <param name="Id">The vehicle id (web <c>v.id</c>).</param>
/// <param name="DisplayName">The vehicle's display name (web <c>v.display_name</c>), or null.</param>
public sealed record SignalGapDetectorVehicle(long Id, string? DisplayName)
{
    /// <summary>The picker label (web <c>display_name || `Vehicle ${id}`</c>).</summary>
    public string Label => string.IsNullOrWhiteSpace(DisplayName)
        ? string.Create(CultureInfo.CurrentCulture, $"Vehicle {Id}")
        : DisplayName!;

    /// <summary>Parse a <c>GET /vehicles</c> JSON array into a tolerant list of fleet entries.</summary>
    public static IReadOnlyList<SignalGapDetectorVehicle> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<SignalGapDetectorVehicle>();
        }

        var list = new List<SignalGapDetectorVehicle>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(new SignalGapDetectorVehicle(
                    SignalGapJsonReaders.Id(item, "id"),
                    SignalGapJsonReaders.Str(item, "display_name") ?? SignalGapJsonReaders.Str(item, "displayName")));
            }
        }

        return list;
    }
}

/// <summary>
/// One raw live-signal observation — the native port of a web <c>SignalRow</c> source row before staleness is
/// derived (web <c>useSignalGaps</c> returns <c>{ [name]: { value, timestamp } }</c>). Staleness / category / band
/// are intentionally NOT stored here: like the web component they are recomputed against "now" at projection time,
/// so the freshness tiers update on every refresh.
/// </summary>
/// <param name="Name">The signal name (web object key).</param>
/// <param name="Value">The stringified last value (web <c>String(value)</c>), or null when the value was null.</param>
/// <param name="Timestamp">The last-observation instant (web <c>timestamp</c>), or null when never received.</param>
public sealed record SignalGapLiveEntry(string Name, string? Value, DateTimeOffset? Timestamp)
{
    /// <summary>
    /// Parse the <c>GET /signals/{vehicleID}/live</c> envelope (<c>{ signals: { name: { value, timestamp } } }</c>)
    /// into a tolerant list of observations — the native port of the web <c>useSignalGaps</c> reducer
    /// (<c>res.signals ?? {}</c> then <c>Object.entries(...).map(...)</c>). A non-object entry collapses to a bare
    /// value with no timestamp (web <c>typeof entry === 'object' ? entry : { value: entry, timestamp: null }</c>).
    /// </summary>
    public static IReadOnlyList<SignalGapLiveEntry> ParseLive(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object ||
            !element.TryGetProperty("signals", out var signals) ||
            signals.ValueKind != JsonValueKind.Object)
        {
            return Array.Empty<SignalGapLiveEntry>();
        }

        var list = new List<SignalGapLiveEntry>();
        foreach (var entry in signals.EnumerateObject())
        {
            list.Add(FromEntry(entry.Name, entry.Value));
        }

        return list;
    }

    private static SignalGapLiveEntry FromEntry(string name, JsonElement entry)
    {
        if (entry.ValueKind == JsonValueKind.Object)
        {
            string? value = entry.TryGetProperty("value", out var v)
                ? SignalGapJsonReaders.StringifyValue(v)
                : null;
            DateTimeOffset? ts = SignalGapJsonReaders.ParseTimestamp(SignalGapJsonReaders.Str(entry, "timestamp"));
            return new SignalGapLiveEntry(name, value, ts);
        }

        return new SignalGapLiveEntry(name, SignalGapJsonReaders.StringifyValue(entry), null);
    }
}

/// <summary>
/// The render-time data model the <see cref="SignalGapDetectorPageViewModel"/> builds for the projection — the union
/// of the resolved fleet / live-signal payloads and the page's local UI state (selected vehicle, the catalog search /
/// filter / sort, the last-refreshed instant). Pure data so the projection is asserted headlessly.
/// </summary>
public sealed record SignalGapDetectorModel(
    IReadOnlyList<SignalGapDetectorVehicle> Vehicles,
    long? SelectedVehicleId,
    SignalGapCatalogState CatalogState,
    IReadOnlyList<SignalGapLiveEntry> Signals,
    string Search,
    SignalGapFilterMode FilterMode,
    SignalGapSortMode SortMode,
    bool Loading,
    bool HasError,
    string? ErrorDetail,
    DateTimeOffset? LastRefreshed);

/// <summary>One projected vehicle-picker option (web <c>VehicleSelect</c> option).</summary>
public sealed record SignalGapVehicleOption(long Id, string Label);

/// <summary>One projected summary stat card (web <c>StatCard</c>): label + formatted value + accent glyph.</summary>
public sealed record SignalGapStatDisplay(string Label, string Value, string Glyph);

/// <summary>One projected catalog-table column (web <c>Column</c> header).</summary>
public sealed record SignalGapColumnDisplay(string Key, string Header, double Width, bool IsNumeric);

/// <summary>
/// One projected, render-ready catalog row — the native analogue of a web <c>SignalCatalogPanel</c> table row
/// (status band label + signal name + last value + last-updated time + time-since). Pure data; the WinUI view maps it
/// onto a text-cell <see cref="TeslaSync.App.Components.UI.TsDataRow"/>.
/// </summary>
public sealed record SignalGapRowDisplay(
    string RowKey,
    string Status,
    string Signal,
    string Value,
    string LastUpdated,
    string TimeSince,
    string AutomationName);

/// <summary>One projected filter toggle (web filter button: All / Stale Only / Active Only).</summary>
public sealed record SignalGapFilterOption(SignalGapFilterMode Mode, string Label, bool IsActive);

/// <summary>One projected sort toggle (web sort button: Most Stale / A-Z / Category).</summary>
public sealed record SignalGapSortOption(SignalGapSortMode Mode, string Label, bool IsActive);

/// <summary>
/// The fully projected, render-ready view of the page for one input model — everything the WinUI view binds to, with
/// every visible literal already resolved through the i18n facade and every value formatted at the display boundary.
/// Holds the header (title / subtitle / vehicle picker), the fleet-failure banner, the no-vehicle empty state, and the
/// catalog region (summary cards, search / filter / sort controls, the table and its loading / empty / error states).
/// Pure data so every branch is asserted headlessly.
/// </summary>
public sealed record SignalGapDetectorDisplay(
    SignalGapDetectorState State,
    string Title,
    string Subtitle,
    string SelectVehicleLabel,
    IReadOnlyList<SignalGapVehicleOption> VehicleOptions,
    long? SelectedVehicleId,
    bool ShowLoading,
    bool HasError,
    string ErrorBannerText,
    bool ShowNoVehicle,
    string NoVehicleTitle,
    string NoVehicleMessage,
    bool ShowCatalog,
    IReadOnlyList<SignalGapStatDisplay> Stats,
    string SearchHint,
    string SearchLabel,
    string Search,
    string FilterLabel,
    IReadOnlyList<SignalGapFilterOption> FilterOptions,
    string SortLabel,
    IReadOnlyList<SignalGapSortOption> SortOptions,
    string RefreshIntervalText,
    bool ShowCatalogLoading,
    bool ShowCatalogError,
    string CatalogErrorText,
    bool ShowCatalogEmpty,
    string CatalogEmptyText,
    bool ShowTable,
    IReadOnlyList<SignalGapColumnDisplay> Columns,
    IReadOnlyList<SignalGapRowDisplay> Rows,
    int TotalRows,
    string TableEmptyMessage,
    bool ShowLastRefreshed,
    string LastRefreshedText,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="SignalGapDetectorModel"/> to its <see cref="SignalGapDetectorDisplay"/> — the
/// native port of the render logic in web/src/features/telemetry/pages/SignalGapDetectorPage.tsx plus the
/// <c>SignalCatalogPanel</c> it composes. Every visible literal resolves through the i18n facade using the exact web
/// key names; staleness, categories and timestamps are recomputed against <c>now</c> so the freshness tiers match the
/// web truth. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class SignalGapDetectorProjection
{
    /// <summary>Em-dash fallback shared with the web <c>'—'</c> literals.</summary>
    public const string EmDash = "\u2014";

    private const double ActiveThresholdSeconds = 30;
    private const double StaleThresholdSeconds = 300;

    /// <summary>The staleness in seconds, or <see cref="double.PositiveInfinity"/> when never received.</summary>
    public static double StalenessSeconds(DateTimeOffset? timestamp, DateTimeOffset now) =>
        timestamp is { } ts ? (now - ts).TotalSeconds : double.PositiveInfinity;

    /// <summary>The staleness category (web <c>!ts ? 'never' : staleness &gt; 300 ? 'stale' : 'active'</c>).</summary>
    public static SignalGapCategory CategoryOf(DateTimeOffset? timestamp, double staleness)
    {
        if (timestamp is null)
        {
            return SignalGapCategory.Never;
        }

        return staleness > StaleThresholdSeconds ? SignalGapCategory.Stale : SignalGapCategory.Active;
    }

    /// <summary>The staleness band (web <c>getCatalogStalenessStyle</c>: never / active &lt;30 / aging &lt;300 / stale).</summary>
    public static SignalGapBand BandOf(DateTimeOffset? timestamp, double staleness)
    {
        if (timestamp is null)
        {
            return SignalGapBand.Never;
        }

        if (staleness < ActiveThresholdSeconds)
        {
            return SignalGapBand.Active;
        }

        return staleness < StaleThresholdSeconds ? SignalGapBand.Aging : SignalGapBand.Stale;
    }

    /// <summary>The localized status-band label (web <c>getCatalogStalenessStyle().label</c>).</summary>
    public static string BandLabel(SignalGapBand band, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return band switch
        {
            SignalGapBand.Active => localizer.GetString("signalGap.bandActive", "Active"),
            SignalGapBand.Aging => localizer.GetString("signalGap.bandAging", "Aging"),
            SignalGapBand.Stale => localizer.GetString("signalGap.bandStale", "Stale"),
            _ => localizer.GetString("signalGap.bandNever", "Never received"),
        };
    }

    /// <summary>The token brush key tinting a status band (web <c>getCatalogStalenessStyle().variant</c>).</summary>
    public static string BandAccent(SignalGapBand band) => band switch
    {
        SignalGapBand.Active => "TsColorSuccessBrush",
        SignalGapBand.Aging => "TsColorWarningBrush",
        SignalGapBand.Stale => "TsColorDangerBrush",
        _ => "TsColorTextSecondaryBrush",
    };

    /// <summary>Format the time-since column (web <c>formatStaleness</c>: <c>Ns ago</c> / <c>Nm ago</c> / <c>Nh Nm ago</c>).</summary>
    public static string FormatStaleness(double seconds)
    {
        if (!double.IsFinite(seconds))
        {
            return EmDash;
        }

        if (seconds < 60)
        {
            return string.Create(CultureInfo.CurrentCulture, $"{Round(seconds)}s ago");
        }

        if (seconds < 3600)
        {
            return string.Create(CultureInfo.CurrentCulture, $"{Round(seconds / 60)}m ago");
        }

        long hours = (long)Math.Floor(seconds / 3600);
        double minutes = (seconds % 3600) / 60;
        return string.Create(CultureInfo.CurrentCulture, $"{hours}h {Round(minutes)}m ago");
    }

    /// <summary>Project <paramref name="model"/> into its render-ready display.</summary>
    public static SignalGapDetectorDisplay Project(SignalGapDetectorModel model, ILocalizer localizer, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        var vehicleOptions = BuildVehicleOptions(model.Vehicles);
        bool hasVehicle = model.SelectedVehicleId is { } id && id > 0;
        var signals = model.Signals ?? Array.Empty<SignalGapLiveEntry>();

        bool showLoading = model.Loading;
        bool hasError = model.HasError;
        bool showNoVehicle = !showLoading && !hasError && !hasVehicle;
        bool showCatalog = !showLoading && !hasError && hasVehicle;

        var state = ResolveState(showLoading, hasError, hasVehicle);

        // The computed (staleness-resolved) rows over the full catalog, used for the summary counts.
        var computed = signals.Select(s => Compute(s, now)).ToList();
        int total = computed.Count;
        int activeCount = computed.Count(c => c.Category == SignalGapCategory.Active);
        int staleCount = computed.Count(c => c.Category == SignalGapCategory.Stale);
        int neverCount = computed.Count(c => c.Category == SignalGapCategory.Never);

        // The filtered + sorted rows actually rendered in the table (web search → filterMode → sort).
        var visible = FilterAndSort(computed, model.Search, model.FilterMode, model.SortMode);
        var rows = BuildRows(visible, localizer, now);

        bool catalogLoading = showCatalog && model.CatalogState == SignalGapCatalogState.Loading;
        bool catalogError = showCatalog && model.CatalogState == SignalGapCatalogState.Error;
        bool catalogResolved = showCatalog && !catalogLoading && !catalogError;
        bool catalogEmpty = catalogResolved && total == 0;
        bool showTable = catalogResolved && total > 0;

        string title = SignalGapDetectorRegistration.Title(localizer);

        return new SignalGapDetectorDisplay(
            State: state,
            Title: title,
            Subtitle: SignalGapDetectorRegistration.Subtitle(localizer),
            SelectVehicleLabel: localizer.GetString("signalGap.selectVehicle", "Select vehicle"),
            VehicleOptions: vehicleOptions,
            SelectedVehicleId: model.SelectedVehicleId,
            ShowLoading: showLoading,
            HasError: hasError,
            ErrorBannerText: BuildErrorBannerText(model, localizer),
            ShowNoVehicle: showNoVehicle,
            NoVehicleTitle: localizer.GetString("signalGap.noVehicle", "Select a vehicle to begin"),
            NoVehicleMessage: localizer.GetString(
                "signalGap.noVehicleDesc",
                "Pick a vehicle from the picker above to inspect its signal freshness."),
            ShowCatalog: showCatalog,
            Stats: BuildStats(localizer, total, activeCount, staleCount, neverCount),
            SearchHint: localizer.GetString("signalGap.filterPlaceholder", "Filter by signal name..."), // parity:allow web i18n key name signalGap.filterPlaceholder
            SearchLabel: localizer.GetString("signalGap.filterLabel", "Filter signals"),
            Search: model.Search ?? string.Empty,
            FilterLabel: localizer.GetString("signalGap.status", "Status"),
            FilterOptions: BuildFilterOptions(localizer, model.FilterMode),
            SortLabel: localizer.GetString("signalGap.category", "Category"),
            SortOptions: BuildSortOptions(localizer, model.SortMode),
            RefreshIntervalText: localizer.GetString("signalGap.refreshInterval", "Refreshes every 5s"),
            ShowCatalogLoading: catalogLoading,
            ShowCatalogError: catalogError,
            CatalogErrorText: BuildErrorBannerText(model, localizer),
            ShowCatalogEmpty: catalogEmpty,
            CatalogEmptyText: localizer.GetString("signalGap.noData", "No signal data available"),
            ShowTable: showTable,
            Columns: BuildColumns(localizer),
            Rows: rows,
            TotalRows: total,
            TableEmptyMessage: localizer.GetString("signalGap.noMatch", "No signals match current filters"),
            ShowLastRefreshed: showCatalog && model.LastRefreshed is not null,
            LastRefreshedText: BuildLastRefreshed(model.LastRefreshed, localizer, now),
            AutomationName: title);
    }

    private static SignalGapDetectorState ResolveState(bool loading, bool hasError, bool hasVehicle)
    {
        if (loading)
        {
            return SignalGapDetectorState.Loading;
        }

        if (hasError)
        {
            return SignalGapDetectorState.Error;
        }

        return hasVehicle ? SignalGapDetectorState.Catalog : SignalGapDetectorState.Empty;
    }

    private static ComputedRow Compute(SignalGapLiveEntry entry, DateTimeOffset now)
    {
        double staleness = StalenessSeconds(entry.Timestamp, now);
        return new ComputedRow(
            entry,
            staleness,
            CategoryOf(entry.Timestamp, staleness),
            BandOf(entry.Timestamp, staleness));
    }

    private static List<ComputedRow> FilterAndSort(
        IReadOnlyList<ComputedRow> rows,
        string? search,
        SignalGapFilterMode filterMode,
        SignalGapSortMode sortMode)
    {
        IEnumerable<ComputedRow> list = rows;

        if (!string.IsNullOrWhiteSpace(search))
        {
            string q = search.Trim();
            list = list.Where(r => r.Entry.Name.Contains(q, StringComparison.OrdinalIgnoreCase));
        }

        list = filterMode switch
        {
            SignalGapFilterMode.Stale => list.Where(r =>
                r.Category is SignalGapCategory.Stale or SignalGapCategory.Never),
            SignalGapFilterMode.Active => list.Where(r => r.Category == SignalGapCategory.Active),
            _ => list,
        };

        list = sortMode switch
        {
            SignalGapSortMode.Alpha => list.OrderBy(r => r.Entry.Name, StringComparer.CurrentCultureIgnoreCase),
            SignalGapSortMode.Category => list.OrderBy(r => CategoryOrder(r.Category)),
            _ => list.OrderByDescending(r => r.Staleness),
        };

        return list.ToList();
    }

    private static int CategoryOrder(SignalGapCategory category) => category switch
    {
        SignalGapCategory.Never => 0,
        SignalGapCategory.Stale => 1,
        _ => 2,
    };

    private static IReadOnlyList<SignalGapRowDisplay> BuildRows(
        IReadOnlyList<ComputedRow> rows,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        if (rows.Count == 0)
        {
            return Array.Empty<SignalGapRowDisplay>();
        }

        var result = new List<SignalGapRowDisplay>(rows.Count);
        for (int i = 0; i < rows.Count; i++)
        {
            var row = rows[i];
            string status = BandLabel(row.Band, localizer);
            string signal = string.IsNullOrEmpty(row.Entry.Name) ? EmDash : row.Entry.Name;
            string value = string.IsNullOrEmpty(row.Entry.Value) ? EmDash : row.Entry.Value!;
            string lastUpdated = row.Entry.Timestamp is null
                ? EmDash
                : DateTimeFormatting.Format(row.Entry.Timestamp, DateTimeVariant.Full, now);
            string timeSince = row.Entry.Timestamp is null ? EmDash : FormatStaleness(row.Staleness);
            string key = string.Create(CultureInfo.InvariantCulture, $"{row.Entry.Name}-{i}");

            result.Add(new SignalGapRowDisplay(
                RowKey: key,
                Status: status,
                Signal: signal,
                Value: value,
                LastUpdated: lastUpdated,
                TimeSince: timeSince,
                AutomationName: string.Create(
                    CultureInfo.CurrentCulture,
                    $"{signal}: {status}, {value}, {timeSince}")));
        }

        return result;
    }

    private static IReadOnlyList<SignalGapStatDisplay> BuildStats(
        ILocalizer localizer,
        int total,
        int active,
        int stale,
        int never) =>
    [
        new(localizer.GetString("signalGap.totalSignals", "Total Signals"), Count(total), "\uE8CB"),
        new(localizer.GetString("signalGap.active", "Active (<30s)"), Count(active), "\uE72C"),
        new(localizer.GetString("signalGap.stale", "Stale (>5min)"), Count(stale), "\uE7BA"),
        new(localizer.GetString("signalGap.neverReceived", "Never Received"), Count(never), "\uE7BA"),
    ];

    private static IReadOnlyList<SignalGapFilterOption> BuildFilterOptions(
        ILocalizer localizer,
        SignalGapFilterMode mode) =>
    [
        new(SignalGapFilterMode.All, localizer.GetString("signalGap.all", "All"), mode == SignalGapFilterMode.All),
        new(SignalGapFilterMode.Stale, localizer.GetString("signalGap.staleOnly", "Stale Only"), mode == SignalGapFilterMode.Stale),
        new(SignalGapFilterMode.Active, localizer.GetString("signalGap.activeOnly", "Active Only"), mode == SignalGapFilterMode.Active),
    ];

    private static IReadOnlyList<SignalGapSortOption> BuildSortOptions(
        ILocalizer localizer,
        SignalGapSortMode mode) =>
    [
        new(SignalGapSortMode.Staleness, localizer.GetString("signalGap.mostStale", "Most Stale"), mode == SignalGapSortMode.Staleness),
        new(SignalGapSortMode.Alpha, localizer.GetString("signalGap.az", "A-Z"), mode == SignalGapSortMode.Alpha),
        new(SignalGapSortMode.Category, localizer.GetString("signalGap.category", "Category"), mode == SignalGapSortMode.Category),
    ];

    private static IReadOnlyList<SignalGapColumnDisplay> BuildColumns(ILocalizer localizer) =>
    [
        new("status", localizer.GetString("signalGap.status", "Status"), 120, false),
        new("signal", localizer.GetString("signalGap.signal", "Signal"), 240, false),
        new("value", localizer.GetString("signalGap.lastValue", "Last Value"), 200, false),
        new("lastUpdated", localizer.GetString("signalGap.lastUpdated", "Last Updated"), 200, false),
        new("timeSince", localizer.GetString("signalGap.timeSince", "Time Since"), 130, true),
    ];

    private static string BuildErrorBannerText(SignalGapDetectorModel model, ILocalizer localizer)
    {
        string headline = localizer.GetString("error.loadFailed", "Failed to load data");
        if (string.IsNullOrWhiteSpace(model.ErrorDetail))
        {
            return headline;
        }

        return string.Create(CultureInfo.CurrentCulture, $"{headline}: {model.ErrorDetail}");
    }

    private static string BuildLastRefreshed(DateTimeOffset? lastRefreshed, ILocalizer localizer, DateTimeOffset now)
    {
        string label = localizer.GetString("signalGap.lastRefreshed", "Last refreshed");
        if (lastRefreshed is null)
        {
            return label;
        }

        string relative = DateTimeFormatting.Format(lastRefreshed, DateTimeVariant.Relative, now);
        return string.Create(CultureInfo.CurrentCulture, $"{label}: {relative}");
    }

    private static IReadOnlyList<SignalGapVehicleOption> BuildVehicleOptions(
        IReadOnlyList<SignalGapDetectorVehicle> vehicles)
    {
        if (vehicles is null || vehicles.Count == 0)
        {
            return Array.Empty<SignalGapVehicleOption>();
        }

        var options = new List<SignalGapVehicleOption>(vehicles.Count);
        foreach (var vehicle in vehicles)
        {
            options.Add(new SignalGapVehicleOption(vehicle.Id, vehicle.Label));
        }

        return options;
    }

    private static string Count(int value) => value.ToString("N0", CultureInfo.CurrentCulture);

    private static long Round(double value) => (long)Math.Round(value, MidpointRounding.AwayFromZero);

    private sealed record ComputedRow(
        SignalGapLiveEntry Entry,
        double Staleness,
        SignalGapCategory Category,
        SignalGapBand Band);
}

/// <summary>
/// Canonical metadata for the <c>SignalGapDetectorPage</c> feature surface — the native mirror of the web page at
/// web/src/features/telemetry/pages/SignalGapDetectorPage.tsx (route <c>/signal-gaps</c>, nav name
/// <c>SignalGapDetector</c>).
/// </summary>
public static class SignalGapDetectorRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "SignalGapDetectorPage";

    /// <summary>The navigation route name this page registers under (see RouteTable <c>SignalGapDetector</c>).</summary>
    public const string RouteName = "SignalGapDetector";

    /// <summary>The browser-tab title key (web <c>usePageTitle(t('signalGap.title'))</c>).</summary>
    public const string PageTitleKey = "signalGap.title";

    /// <summary>Generated operation id for <c>GET /api/v1/vehicles</c> (web <c>useSelectedVehicle</c> fleet list).</summary>
    public const string VehiclesOperation = "get_api_v1_vehicles";

    /// <summary>Generated operation id for <c>GET /api/v1/signals/{vehicleID}/live</c> (web <c>useSignalGaps</c>).</summary>
    public const string LiveOperation = "get_api_v1_signals_vehicleID_live";

    /// <summary>The vehicle-id path-parameter name in the live-signals operation template.</summary>
    public const string VehiclePathParam = "vehicleID";

    /// <summary>The localized page title (web <c>t('signalGap.title', 'Signal Gap Detector')</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("signalGap.title", "Signal Gap Detector");
    }

    /// <summary>The localized page subtitle (web <c>t('signalGap.subtitle', ...)</c>).</summary>
    public static string Subtitle(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "signalGap.subtitle",
            "Identify signals that have stopped arriving or have gaps");
    }

    /// <summary>The localized browser-tab title (web <c>usePageTitle(t('signalGap.title', 'Signal Gaps'))</c>).</summary>
    public static string PageTitle(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(PageTitleKey, "Signal Gaps");
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>SignalGapDetectorPage</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a vehicle id, signal name or value — so a
/// diagnostics line can never leak telemetry. Thread-safe.
/// </summary>
public sealed class SignalGapDetectorDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public SignalGapDetectorDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=SignalGapDetectorPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(string.Create(CultureInfo.InvariantCulture, $"view.opened slug={SignalGapDetectorRegistration.Slug}"));
    }
}

/// <summary>Small null-tolerant JSON readers shared by the vehicle / live-signal parsers (UI-free, unit-tested).</summary>
internal static class SignalGapJsonReaders
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

    /// <summary>Stringify a JSON value the way the web <c>String(value)</c> does (null → <see langword="null"/>).</summary>
    public static string? StringifyValue(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.String => value.GetString(),
        JsonValueKind.Number => value.GetRawText(),
        JsonValueKind.True => "true",
        JsonValueKind.False => "false",
        JsonValueKind.Null or JsonValueKind.Undefined => null,
        _ => value.GetRawText(),
    };

    /// <summary>Parse an ISO-8601 timestamp into a UTC instant, or <see langword="null"/> when absent / unparseable.</summary>
    public static DateTimeOffset? ParseTimestamp(string? raw)
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
