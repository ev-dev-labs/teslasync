using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Charging;

/// <summary>
/// The mutually-exclusive lifecycle state of the <c>TeslaChargingHistoryPage</c> surface — the native mirror of the
/// data states the web page renders (web/src/features/charging/pages/TeslaChargingHistoryPage.tsx). The web page runs
/// the <c>useTeslaChargingHistory</c> query and renders, in precedence order, the page-level loading shimmer (web
/// <c>PageContainer loading</c>), the page-level failure surface (web <c>PageContainer error</c>), the four summary
/// cards + monthly-spending chart + session table (web <c>response</c>), or the friendly empty states when no
/// Supercharger session has been imported yet. This enum is the top-level summary the ledger / Narrator key off;
/// per-region visibility is still driven by the projected flags so each branch renders exactly as the web composes it.
/// </summary>
public enum TeslaChargingHistoryState
{
    /// <summary>The history query is in flight with no data yet (web <c>isLoading</c>) — the page shows the shimmer.</summary>
    Loading,

    /// <summary>The query resolved with no in-range entries (web <c>entries.length === 0</c>) — every region shows its empty state.</summary>
    Empty,

    /// <summary>The query failed (web <c>error</c>) — the page failure surface (InfoBar + Retry) is shown.</summary>
    Error,

    /// <summary>The query produced in-range entries (web <c>entries.length &gt; 0</c>) — stats, chart and table render.</summary>
    Success,
}

/// <summary>
/// One Tesla Supercharger / DC billing record — the native mirror of the web <c>TeslaChargingHistoryEntry</c>
/// (web/src/api/hooks/useCharging.ts), narrowed to the fields the page reads. Field names mirror the Go API's
/// snake_case JSON tags; energy is SI watt-hours and is converted to the display unit at the render boundary only.
/// Parsing is null-tolerant. Pure data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
public sealed record TeslaChargingHistoryEntry(
    long SessionId,
    string? Vin,
    string? SiteLocationName,
    string? ChargeStartDatetime,
    string? ChargeStopDatetime,
    string? CurrencyCode,
    string? PricingType,
    double? RateBase,
    double? UsageWh,
    double? TotalDue,
    bool HasInvoice,
    string? InvoiceContentId,
    string? FetchedAt)
{
    /// <summary>Read one entry from a JSON object, tolerating missing / null fields.</summary>
    public static TeslaChargingHistoryEntry FromJson(JsonElement o) => new(
        SessionId: JsonReadHelpers.Long(o, "session_id") ?? JsonReadHelpers.Long(o, "id") ?? 0,
        Vin: JsonReadHelpers.Str(o, "vin"),
        SiteLocationName: JsonReadHelpers.Str(o, "site_location_name"),
        ChargeStartDatetime: JsonReadHelpers.Str(o, "charge_start_datetime"),
        ChargeStopDatetime: JsonReadHelpers.Str(o, "charge_stop_datetime"),
        CurrencyCode: JsonReadHelpers.Str(o, "currency_code"),
        PricingType: JsonReadHelpers.Str(o, "pricing_type"),
        RateBase: JsonReadHelpers.Double(o, "rate_base"),
        UsageWh: JsonReadHelpers.Double(o, "usage_wh"),
        TotalDue: JsonReadHelpers.Double(o, "total_due"),
        HasInvoice: ReadBool(o, "has_invoice"),
        InvoiceContentId: JsonReadHelpers.Str(o, "invoice_content_id"),
        FetchedAt: JsonReadHelpers.Str(o, "fetched_at"));

    private static bool ReadBool(JsonElement o, string name)
    {
        if (o.ValueKind != JsonValueKind.Object || !o.TryGetProperty(name, out var v))
        {
            return false;
        }

        return v.ValueKind == JsonValueKind.True;
    }
}

/// <summary>
/// The history-summary block — the native mirror of the web <c>TeslaChargingHistorySummary</c>: the session count, the
/// SI watt-hours energy total, the currency spend total and the average cost per kWh. Pure data; parsing is
/// null-tolerant.
/// </summary>
public sealed record TeslaChargingHistorySummary(
    long TotalSessions,
    double? TotalWh,
    double? TotalSpend,
    double? AvgCostPerKwh)
{
    /// <summary>The all-zero / all-null summary (the default before any data arrives).</summary>
    public static TeslaChargingHistorySummary Empty { get; } = new(0, null, null, null);

    /// <summary>Read the summary from a JSON object, tolerating missing / null fields.</summary>
    public static TeslaChargingHistorySummary FromJson(JsonElement o)
    {
        if (o.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        return new TeslaChargingHistorySummary(
            TotalSessions: JsonReadHelpers.Long(o, "total_sessions") ?? 0,
            TotalWh: JsonReadHelpers.Double(o, "total_wh"),
            TotalSpend: JsonReadHelpers.Double(o, "total_spend"),
            AvgCostPerKwh: JsonReadHelpers.Double(o, "avg_cost_per_kwh"));
    }
}

/// <summary>
/// The charging-history envelope — the native mirror of the web <c>TeslaChargingHistoryResponse</c>: the
/// <see cref="Entries"/> rows plus the <see cref="Summary"/>, and a <see cref="HasData"/> marker recording whether the
/// server returned a response (the web <c>response</c> presence test). The tolerant parser unwraps the platform
/// <c>{data:…}</c> envelope (internal/platform/httputil.Respond) so the snake_case wire shape round-trips losslessly.
/// Pure data.
/// </summary>
public sealed record TeslaChargingHistorySnapshot(
    bool HasData,
    IReadOnlyList<TeslaChargingHistoryEntry> Entries,
    TeslaChargingHistorySummary Summary)
{
    /// <summary>The empty snapshot (no response yet) — the default local-state feed result.</summary>
    public static TeslaChargingHistorySnapshot Empty { get; } =
        new(false, Array.Empty<TeslaChargingHistoryEntry>(), TeslaChargingHistorySummary.Empty);

    /// <summary>
    /// Read the charging-history response from JSON, tolerating missing / null fields and the platform
    /// <c>{data:…}</c> envelope. A non-object payload is treated as "no data" (the web empty branch).
    /// </summary>
    public static TeslaChargingHistorySnapshot FromJson(JsonElement root)
    {
        JsonElement o = root;
        if (root.ValueKind == JsonValueKind.Object &&
            root.TryGetProperty("data", out var data) &&
            data.ValueKind == JsonValueKind.Object)
        {
            o = data;
        }

        if (o.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        var entries = new List<TeslaChargingHistoryEntry>();
        if (o.TryGetProperty("entries", out var arr) && arr.ValueKind == JsonValueKind.Array)
        {
            foreach (var element in arr.EnumerateArray())
            {
                if (element.ValueKind == JsonValueKind.Object)
                {
                    entries.Add(TeslaChargingHistoryEntry.FromJson(element));
                }
            }
        }

        TeslaChargingHistorySummary summary = o.TryGetProperty("summary", out var s)
            ? TeslaChargingHistorySummary.FromJson(s)
            : TeslaChargingHistorySummary.Empty;

        return new TeslaChargingHistorySnapshot(true, entries, summary);
    }
}

/// <summary>
/// The data port the <see cref="TeslaChargingHistoryPageViewModel"/> reads through — the native parity of the web
/// page's hooks: <c>useTeslaChargingHistory(vin)</c> (GET /tesla/charging/history), <c>useVehicles()</c>
/// (GET /vehicles) and the <c>useRefreshTeslaChargingHistory()</c> mutation (POST /tesla/charging/history/refresh).
/// The view never performs HTTP itself; the default <see cref="EmptyTeslaChargingHistoryFeed"/> resolves to the empty
/// state, and the generated-client-backed <see cref="TeslaChargingHistoryClientFeed"/> binds to the generated OpenAPI
/// contract client (ADR-004).
/// </summary>
public interface ITeslaChargingHistoryFeed
{
    /// <summary>Resolve the charging-history snapshot for the selected <paramref name="vin"/> (null = all vehicles).</summary>
    Task<TeslaChargingHistorySnapshot> FetchHistoryAsync(string? vin, CancellationToken cancellationToken);

    /// <summary>Resolve the enrolled vehicles that populate the dropdown (web <c>useVehicles</c>).</summary>
    Task<IReadOnlyList<TeslaChargingVehicle>> FetchVehiclesAsync(CancellationToken cancellationToken);

    /// <summary>Trigger a refresh-from-Tesla for the selected <paramref name="vin"/> and return the fresh snapshot.</summary>
    Task<TeslaChargingHistorySnapshot> RefreshAsync(string? vin, CancellationToken cancellationToken);
}

/// <summary>The default feed — resolves every fetch to the empty snapshot / no vehicles (the empty data state).</summary>
public sealed class EmptyTeslaChargingHistoryFeed : ITeslaChargingHistoryFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyTeslaChargingHistoryFeed Instance { get; } = new();

    private EmptyTeslaChargingHistoryFeed()
    {
    }

    /// <inheritdoc />
    public Task<TeslaChargingHistorySnapshot> FetchHistoryAsync(string? vin, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(TeslaChargingHistorySnapshot.Empty);
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<TeslaChargingVehicle>> FetchVehiclesAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult<IReadOnlyList<TeslaChargingVehicle>>(Array.Empty<TeslaChargingVehicle>());
    }

    /// <inheritdoc />
    public Task<TeslaChargingHistorySnapshot> RefreshAsync(string? vin, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(TeslaChargingHistorySnapshot.Empty);
    }
}

/// <summary>
/// The render-time data model the <c>TeslaChargingHistoryPage</c> projects from — the native analogue of the web
/// page's resolved query state plus the vehicle dropdown, the client-side search + date-range filters, the
/// refresh-mutation flag and the user's unit / currency display preference. Pure data so the projection is unit-tested
/// without a UI host.
/// </summary>
public sealed record TeslaChargingHistoryModel(
    bool HasData,
    IReadOnlyList<TeslaChargingHistoryEntry> Entries,
    TeslaChargingHistorySummary Summary,
    IReadOnlyList<TeslaChargingVehicle> Vehicles,
    string SelectedVin,
    string SearchQuery,
    DateOnly? RangeStart,
    DateOnly? RangeEnd,
    bool Loading,
    bool HasError,
    string? ErrorDetail,
    bool RefreshPending,
    UnitPref Units,
    string CurrencySymbol)
{
    /// <summary>The initial model — the first load, no data yet, all vehicles, no filters, metric units, "$" currency.</summary>
    public static TeslaChargingHistoryModel Initial { get; } = new(
        HasData: false,
        Entries: Array.Empty<TeslaChargingHistoryEntry>(),
        Summary: TeslaChargingHistorySummary.Empty,
        Vehicles: Array.Empty<TeslaChargingVehicle>(),
        SelectedVin: string.Empty,
        SearchQuery: string.Empty,
        RangeStart: null,
        RangeEnd: null,
        Loading: true,
        HasError: false,
        ErrorDetail: null,
        RefreshPending: false,
        Units: UnitPref.Metric,
        CurrencySymbol: TeslaChargingHistoryProjection.DefaultCurrencySymbol);
}

/// <summary>One projected month bucket for the spending chart (web <c>buildMonthlySpending</c> output): the <c>YYYY-MM</c> bucket and its summed currency total.</summary>
public sealed record TeslaChargingMonthlySpend(string Month, double Total);

/// <summary>One projected table column descriptor (web <c>Column</c>): the row-value key, the localized header and whether the values are numeric (right-aligned, numeric sort).</summary>
public sealed record TeslaChargingHistoryColumn(string Key, string Header, bool IsNumeric);

/// <summary>
/// One projected, render-ready table row (web column <c>render</c> output): the formatted cell values keyed by column
/// for the shared data table, plus the invoice affordance (whether a downloadable invoice exists and its URL — web
/// <c>getTeslaChargingInvoiceURL</c>).
/// </summary>
public sealed record TeslaChargingHistoryRowDisplay(
    long SessionId,
    string Date,
    string Location,
    string Duration,
    string Energy,
    string Cost,
    string Rate,
    string Invoice,
    bool HasInvoice,
    string InvoiceUrl);

/// <summary>
/// The fully projected, render-ready view of the page for one input model — everything the WinUI view binds to, with
/// every visible literal already resolved through the i18n facade and every number formatted at the display boundary.
/// Holds the always-visible page header, the controls bar (vehicle selector + date-range picker + refresh + last-synced
/// caption), the four data-state flags, the four summary stat cards, the monthly-spending chart (series + accessible
/// table headers + empty message), and the session table (search field + active-filter chips + columns + rows or the
/// no-data / no-matches empty states). Pure data so every branch is asserted headlessly.
/// </summary>
public sealed record TeslaChargingHistoryDisplay(
    TeslaChargingHistoryState State,
    string Title,
    string Subtitle,
    string AutomationName,
    string AllVehiclesLabel,
    string SelectVehicleLabel,
    IReadOnlyList<TeslaChargingVehicleOption> VehicleOptions,
    string RefreshLabel,
    string RefreshingLabel,
    string RefreshButtonLabel,
    bool RefreshPending,
    bool ShowLastSync,
    string LastSyncText,
    bool ShowLoading,
    string LoadingText,
    bool ShowError,
    string ErrorText,
    string RetryLabel,
    bool ShowContent,
    string SessionsStatLabel,
    string SessionsStatValue,
    string EnergyStatLabel,
    string EnergyStatValue,
    string SpendStatLabel,
    string SpendStatValue,
    string AvgCostStatLabel,
    string AvgCostStatValue,
    string MonthlySpendingTitle,
    string MonthlySpendingAria,
    string MonthColumnLabel,
    string TotalColumnLabel,
    string NoChartDataMessage,
    bool ShowChart,
    IReadOnlyList<TeslaChargingMonthlySpend> MonthlySpends,
    IReadOnlyList<ChartSeries> ChartSeries,
    string TableTitle,
    string SearchQuery,
    string SearchPromptText,
    string SearchFilterLabel,
    bool ShowSearchChip,
    IReadOnlyList<FilterChip> FilterChips,
    string InvoiceLinkLabel,
    string DownloadInvoiceLabel,
    string ExportCsvLabel,
    IReadOnlyList<TeslaChargingHistoryColumn> Columns,
    IReadOnlyList<TeslaChargingHistoryRowDisplay> Rows,
    bool ShowFilterBar,
    bool ShowTable,
    bool ShowNoMatches,
    string NoMatchesMessage,
    bool ShowNoData,
    string NoDataMessage);

/// <summary>
/// Pure projection from a <see cref="TeslaChargingHistoryModel"/> to its <see cref="TeslaChargingHistoryDisplay"/> —
/// the native port of the render logic in web/src/features/charging/pages/TeslaChargingHistoryPage.tsx. Every visible
/// literal resolves through the i18n facade using the exact web key names; the summary cards format through the shared
/// SI unit / scalar formatters (the web <c>formatEnergy</c> / <c>formatCurrency</c> / <c>fmtInt</c>), the table cells
/// reproduce each web column's <c>render</c> (energy via <c>formatEnergy</c>, duration via <c>formatDurationMinutes</c>,
/// cost / rate via the currency / number formatters), and the chart reproduces <c>buildMonthlySpending</c> over the
/// date-range-filtered entries. The summary stats come from the API summary (the web reads <c>summary</c> directly, not
/// the filtered rows). Every chrome string is resolved on every projection so the i18n contract holds in every data
/// state. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class TeslaChargingHistoryProjection
{
    /// <summary>Em-dash fallback shared with the web <c>'—'</c> literals.</summary>
    public const string EmDash = "\u2014";

    /// <summary>The default currency symbol (web <c>settings.currency_symbol</c> default "$").</summary>
    public const string DefaultCurrencySymbol = "$";

    /// <summary>The accessible-table / chart series key carrying each month's currency total.</summary>
    public const string TotalKey = "total";

    private const int EnergyPrecision = 1;   // web formatEnergy(_, { precision: 1 })
    private const int SpendPrecision = 2;     // web formatCurrency(_, 2)
    private const int AvgCostPrecision = 3;   // web formatCurrency(_, 3)
    private const int RatePrecision = 3;      // web fmtNumber(rate_base, 3)

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the resolved web query state + dropdown / filter / refresh flags).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="now">The reference instant for absolute timestamp formatting.</param>
    public static TeslaChargingHistoryDisplay Project(
        TeslaChargingHistoryModel model,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        // ── Page header (web PageContainer title + subtitle) ────────────────────────────────────────────────
        string title = localizer.GetString("tesla_charging.title", "Tesla Charging History");
        string subtitle = localizer.GetString(
            "tesla_charging.subtitle",
            "Supercharger & DC fast charging billing records from Tesla");

        // ── Controls bar (web vehicle selector + range picker + refresh + last-synced caption) ──────────────
        string allVehicles = localizer.GetString("tesla_charging.allVehicles", "All Vehicles");
        string selectVehicle = localizer.GetString("tesla_charging.selectVehicle", "Select vehicle");
        string refreshLabel = localizer.GetString("tesla_charging.refresh", "Refresh from Tesla");
        string refreshingLabel = localizer.GetString("tesla_charging.refreshing", "Syncing...");
        string lastSyncLabel = localizer.GetString("tesla_charging.lastSync", "Last synced");

        // ── Summary stat cards (web StatCard ×4) ────────────────────────────────────────────────────────────
        string sessionsStatLabel = localizer.GetString("tesla_charging.stats.sessions", "Total Sessions");
        string energyStatLabel = localizer.GetString("tesla_charging.stats.energy", "Total Energy");
        string spendStatLabel = localizer.GetString("tesla_charging.stats.spend", "Total Spend");
        string avgCostStatLabel = localizer.GetString("tesla_charging.stats.avgCost", "Avg Cost/kWh");

        // ── Monthly spending chart (web ChartContainer + BarChart) ──────────────────────────────────────────
        string monthlySpendingTitle = localizer.GetString("tesla_charging.monthlySpending", "Monthly Spending");
        string monthlySpendingAria = localizer.GetString("tesla_charging.monthlySpending.aria", "Monthly Tesla charging spending bar chart");
        string monthColumnLabel = localizer.GetString("tesla_charging.col.month", "Month");
        string totalColumnLabel = localizer.GetString("tesla_charging.col.total", "Total ($)");
        string noChartData = localizer.GetString("tesla_charging.noChartData", "No spending data yet. Click \"Refresh from Tesla\" to sync.");

        // ── Session table (web DataTable GlassPanel) ────────────────────────────────────────────────────────
        string tableTitle = localizer.GetString("tesla_charging.sessions", "Charging Sessions");
        string searchPrompt = localizer.GetString("tesla_charging.searchPlaceholder", "Search by location…"); // parity:allow i18n key 'searchPlaceholder' is a verbatim web key, not a stub
        string searchFilterLabel = localizer.GetString("tesla_charging.filterLabel.search", "Search");
        string invoiceLinkLabel = localizer.GetString("charging.invoice", "Invoice");
        string downloadInvoiceLabel = localizer.GetString("tesla_charging.downloadInvoice", "Download invoice");
        string exportCsv = localizer.GetString("table.bulkActions.exportCsv", "Export CSV");
        string noData = localizer.GetString("tesla_charging.noData", "No Tesla charging history yet. Click \"Refresh from Tesla\" to import your Supercharger sessions.");
        string noMatches = localizer.GetString("tesla_charging.noMatches", "No sessions match your search.");

        string colDate = localizer.GetString("tesla_charging.col.date", "Date");
        string colLocation = localizer.GetString("tesla_charging.col.location", "Location");
        string colDuration = localizer.GetString("tesla_charging.col.duration", "Duration");
        string colEnergy = localizer.GetString("tesla_charging.col.energy", "Energy");
        string colCost = localizer.GetString("tesla_charging.col.cost_decimal", "Cost");
        string colRate = localizer.GetString("tesla_charging.col.rate", "Rate");
        string colInvoice = localizer.GetString("tesla_charging.col.invoice", "Invoice");

        // ── Page-level data states (web PageContainer loading / error + render precedence) ──────────────────
        string loadingText = localizer.GetString("common.loading", "Loading...");
        string loadFailed = localizer.GetString("error.loadFailed", "Failed to load data");
        string retryLabel = localizer.GetString("common.retry", "Retry");
        string errorText = model.HasError && !string.IsNullOrEmpty(model.ErrorDetail)
            ? $"{loadFailed}: {model.ErrorDetail}"
            : loadFailed;

        bool showLoading = model.Loading;
        bool showError = !model.Loading && model.HasError;
        bool showContent = !model.Loading && !model.HasError;

        // The web range filter narrows the client-side entries; the summary cards still read the API summary.
        var rangeEntries = FilterByRange(model.Entries, model.RangeStart, model.RangeEnd);
        bool hasRangeEntries = rangeEntries.Count > 0;

        var searchedEntries = FilterBySearch(rangeEntries, model.SearchQuery);
        var sortedEntries = SortByDateDescending(searchedEntries);

        TeslaChargingHistoryState state = showLoading
            ? TeslaChargingHistoryState.Loading
            : showError
                ? TeslaChargingHistoryState.Error
                : hasRangeEntries
                    ? TeslaChargingHistoryState.Success
                    : TeslaChargingHistoryState.Empty;

        // ── Vehicle dropdown options (web vehicleOptions) ───────────────────────────────────────────────────
        var vehicleOptions = new List<TeslaChargingVehicleOption>(model.Vehicles.Count + 1)
        {
            new(string.Empty, allVehicles, string.IsNullOrEmpty(model.SelectedVin)),
        };
        foreach (var v in model.Vehicles)
        {
            string label = $"{v.DisplayName} ({Last6(v.Vin)})";
            vehicleOptions.Add(new TeslaChargingVehicleOption(v.Vin, label, v.Vin == model.SelectedVin));
        }

        // ── Refresh button (web refreshMutation.isPending toggle) ───────────────────────────────────────────
        string refreshButtonLabel = model.RefreshPending ? refreshingLabel : refreshLabel;

        // ── Last-synced caption (web entries[0].fetched_at over the range-filtered rows) ─────────────────────
        bool showLastSync = hasRangeEntries && !string.IsNullOrEmpty(rangeEntries[0].FetchedAt);
        string lastSyncText = showLastSync
            ? $"{lastSyncLabel}: {DateTimeFormatting.Format(ParseInstant(rangeEntries[0].FetchedAt), DateTimeVariant.Full, now)}"
            : lastSyncLabel;

        // ── Summary stat values (web summary cards — read straight from the API summary) ────────────────────
        var summary = model.Summary;
        string sessionsValue = ScalarFormatters.FormatNumber(summary.TotalSessions, 0);
        string energyValue = summary.TotalWh != null
            ? UnitFormatters.FormatEnergy(summary.TotalWh, model.Units, EnergyPrecision)
            : EmDash;
        string spendValue = summary.TotalSpend != null
            ? ScalarFormatters.FormatCurrency(summary.TotalSpend, model.CurrencySymbol, SpendPrecision)
            : EmDash;
        string avgCostValue = summary.AvgCostPerKwh != null
            ? ScalarFormatters.FormatCurrency(summary.AvgCostPerKwh, model.CurrencySymbol, AvgCostPrecision)
            : EmDash;

        // ── Monthly spending chart series (web buildMonthlySpending + <BarChart>) ───────────────────────────
        var monthly = BuildMonthlySpending(rangeEntries);
        bool showChart = monthly.Count > 0;
        IReadOnlyList<ChartSeries> chartSeries = BuildChartSeries(monthly, totalColumnLabel, model.CurrencySymbol);

        // ── Active-filter chips (web ActiveFilterChips — only the search chip when a query is set) ──────────
        bool showSearchChip = !string.IsNullOrEmpty(model.SearchQuery);
        var filterChips = showSearchChip
            ? new List<FilterChip> { new("q", searchFilterLabel, model.SearchQuery) }
            : new List<FilterChip>();

        // ── Table columns + rows (web columns + render functions) ───────────────────────────────────────────
        var columns = new List<TeslaChargingHistoryColumn>
        {
            new("date", colDate, false),
            new("location", colLocation, false),
            new("duration", colDuration, false),
            new("energy", colEnergy, true),
            new("cost", colCost, true),
            new("rate", colRate, false),
            new("invoice", colInvoice, false),
        };

        var rows = new List<TeslaChargingHistoryRowDisplay>(sortedEntries.Count);
        foreach (var e in sortedEntries)
        {
            bool hasInvoice = e.HasInvoice && !string.IsNullOrEmpty(e.InvoiceContentId);
            rows.Add(new TeslaChargingHistoryRowDisplay(
                SessionId: e.SessionId,
                Date: DateTimeFormatting.Format(ParseInstant(e.ChargeStartDatetime), DateTimeVariant.Full, now),
                Location: NullableText(e.SiteLocationName),
                Duration: FormatDurationMinutes(DurationMinutes(e.ChargeStartDatetime, e.ChargeStopDatetime)),
                Energy: e.UsageWh != null
                    ? UnitFormatters.FormatEnergy(e.UsageWh, model.Units, EnergyPrecision)
                    : EmDash,
                Cost: e.TotalDue != null
                    ? ScalarFormatters.FormatCurrency(e.TotalDue, model.CurrencySymbol, SpendPrecision)
                    : EmDash,
                Rate: e.RateBase != null
                    ? $"{NumberFormatting.Format(e.RateBase.Value, model.Units.Locale, RatePrecision)}/{(string.IsNullOrEmpty(e.PricingType) ? "kWh" : e.PricingType)}"
                    : EmDash,
                Invoice: hasInvoice ? invoiceLinkLabel : EmDash,
                HasInvoice: hasInvoice,
                InvoiceUrl: hasInvoice ? TeslaChargingHistoryRegistration.InvoiceUrl(e.InvoiceContentId!) : string.Empty));
        }

        bool showTable = hasRangeEntries && rows.Count > 0;
        bool showNoMatches = hasRangeEntries && rows.Count == 0;
        bool showNoData = !hasRangeEntries;

        return new TeslaChargingHistoryDisplay(
            State: state,
            Title: title,
            Subtitle: subtitle,
            AutomationName: title,
            AllVehiclesLabel: allVehicles,
            SelectVehicleLabel: selectVehicle,
            VehicleOptions: vehicleOptions,
            RefreshLabel: refreshLabel,
            RefreshingLabel: refreshingLabel,
            RefreshButtonLabel: refreshButtonLabel,
            RefreshPending: model.RefreshPending,
            ShowLastSync: showLastSync,
            LastSyncText: lastSyncText,
            ShowLoading: showLoading,
            LoadingText: loadingText,
            ShowError: showError,
            ErrorText: errorText,
            RetryLabel: retryLabel,
            ShowContent: showContent,
            SessionsStatLabel: sessionsStatLabel,
            SessionsStatValue: sessionsValue,
            EnergyStatLabel: energyStatLabel,
            EnergyStatValue: energyValue,
            SpendStatLabel: spendStatLabel,
            SpendStatValue: spendValue,
            AvgCostStatLabel: avgCostStatLabel,
            AvgCostStatValue: avgCostValue,
            MonthlySpendingTitle: monthlySpendingTitle,
            MonthlySpendingAria: monthlySpendingAria,
            MonthColumnLabel: monthColumnLabel,
            TotalColumnLabel: totalColumnLabel,
            NoChartDataMessage: noChartData,
            ShowChart: showChart,
            MonthlySpends: monthly,
            ChartSeries: chartSeries,
            TableTitle: tableTitle,
            SearchQuery: model.SearchQuery,
            SearchPromptText: searchPrompt,
            SearchFilterLabel: searchFilterLabel,
            ShowSearchChip: showSearchChip,
            FilterChips: filterChips,
            InvoiceLinkLabel: invoiceLinkLabel,
            DownloadInvoiceLabel: downloadInvoiceLabel,
            ExportCsvLabel: exportCsv,
            Columns: columns,
            Rows: rows,
            ShowFilterBar: hasRangeEntries,
            ShowTable: showTable,
            ShowNoMatches: showNoMatches,
            NoMatchesMessage: noMatches,
            ShowNoData: showNoData,
            NoDataMessage: noData);
    }

    /// <summary>Aggregate entries by <c>YYYY-MM</c> bucket, summing the currency total (web <c>buildMonthlySpending</c>).</summary>
    public static IReadOnlyList<TeslaChargingMonthlySpend> BuildMonthlySpending(IReadOnlyList<TeslaChargingHistoryEntry> entries)
    {
        ArgumentNullException.ThrowIfNull(entries);

        var map = new Dictionary<string, double>(StringComparer.Ordinal);
        foreach (var e in entries)
        {
            DateTimeOffset? start = ParseInstant(e.ChargeStartDatetime);
            if (start is not { } d)
            {
                continue;
            }

            string key = $"{d.Year.ToString("D4", CultureInfo.InvariantCulture)}-{d.Month.ToString("D2", CultureInfo.InvariantCulture)}";
            map[key] = (map.TryGetValue(key, out var current) ? current : 0) + (e.TotalDue ?? 0);
        }

        var keys = new List<string>(map.Keys);
        keys.Sort(StringComparer.Ordinal);
        var result = new List<TeslaChargingMonthlySpend>(keys.Count);
        foreach (var key in keys)
        {
            result.Add(new TeslaChargingMonthlySpend(key, map[key]));
        }

        return result;
    }

    /// <summary>Filter entries to those whose start date falls within the inclusive <paramref name="start"/>..<paramref name="end"/> range (null bound = unbounded; web range filter).</summary>
    public static IReadOnlyList<TeslaChargingHistoryEntry> FilterByRange(
        IReadOnlyList<TeslaChargingHistoryEntry> entries,
        DateOnly? start,
        DateOnly? end)
    {
        ArgumentNullException.ThrowIfNull(entries);

        if (start is null && end is null)
        {
            return entries;
        }

        var result = new List<TeslaChargingHistoryEntry>(entries.Count);
        foreach (var e in entries)
        {
            if (ParseInstant(e.ChargeStartDatetime) is not { } d)
            {
                continue;
            }

            var date = DateOnly.FromDateTime(d.UtcDateTime);
            if (start is { } s && date < s)
            {
                continue;
            }

            if (end is { } en && date > en)
            {
                continue;
            }

            result.Add(e);
        }

        return result;
    }

    /// <summary>Filter entries whose site location contains <paramref name="query"/> (case-insensitive; web <c>useFilteredList</c> on <c>site_location_name</c>).</summary>
    public static IReadOnlyList<TeslaChargingHistoryEntry> FilterBySearch(
        IReadOnlyList<TeslaChargingHistoryEntry> entries,
        string? query)
    {
        ArgumentNullException.ThrowIfNull(entries);

        if (string.IsNullOrWhiteSpace(query))
        {
            return entries;
        }

        var needle = query.Trim();
        var result = new List<TeslaChargingHistoryEntry>(entries.Count);
        foreach (var e in entries)
        {
            if (!string.IsNullOrEmpty(e.SiteLocationName) &&
                e.SiteLocationName.Contains(needle, StringComparison.OrdinalIgnoreCase))
            {
                result.Add(e);
            }
        }

        return result;
    }

    /// <summary>Compute the whole-minute duration between two ISO timestamps (web <c>durationMinutes</c>); null when the stop is missing / not after the start.</summary>
    public static long? DurationMinutes(string? start, string? stop)
    {
        if (ParseInstant(start) is not { } s || ParseInstant(stop) is not { } e)
        {
            return null;
        }

        double minutes = (e - s).TotalMinutes;
        return minutes > 0 ? (long)Math.Round(minutes) : null;
    }

    /// <summary>Format a whole-minute duration as "Xh Ym" / "Ym" (web <c>formatDurationMinutes</c>); em-dash for null.</summary>
    public static string FormatDurationMinutes(long? minutes)
    {
        if (minutes is not { } m)
        {
            return EmDash;
        }

        long h = m / 60;
        long mins = m % 60;
        return h > 0
            ? $"{h}h {mins}m"
            : $"{mins}m";
    }

    /// <summary>The last six characters of a VIN (web <c>vin.slice(-6)</c>); the whole string when shorter.</summary>
    public static string Last6(string? vin)
    {
        if (string.IsNullOrEmpty(vin))
        {
            return string.Empty;
        }

        return vin.Length <= 6 ? vin : vin[^6..];
    }

    private static List<TeslaChargingHistoryEntry> SortByDateDescending(IReadOnlyList<TeslaChargingHistoryEntry> entries)
    {
        // web default sort: sortKey='date', sortDir='desc' (charge_start_datetime, lexicographic ISO compare).
        var sorted = new List<TeslaChargingHistoryEntry>(entries);
        sorted.Sort((a, b) => string.CompareOrdinal(b.ChargeStartDatetime ?? string.Empty, a.ChargeStartDatetime ?? string.Empty));
        return sorted;
    }

    private static ChartSeries[] BuildChartSeries(
        IReadOnlyList<TeslaChargingMonthlySpend> monthly,
        string seriesName,
        string currencySymbol)
    {
        if (monthly.Count == 0)
        {
            return Array.Empty<ChartSeries>();
        }

        var points = new List<ChartPoint>(monthly.Count);
        for (var i = 0; i < monthly.Count; i++)
        {
            points.Add(new ChartPoint(i, monthly[i].Total, monthly[i].Month));
        }

        return new[]
        {
            new ChartSeries(seriesName, points)
            {
                Kind = ChartSeriesKind.Bar,
                ColorIndex = 0,
                Unit = currencySymbol,
                Decimals = 0,
            },
        };
    }

    private static string NullableText(string? value) => string.IsNullOrEmpty(value) ? EmDash : value!;

    private static DateTimeOffset? ParseInstant(string? raw)
    {
        if (string.IsNullOrEmpty(raw))
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            raw,
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var value)
            ? value
            : null;
    }
}

/// <summary>
/// The canonical registration metadata for the <c>TeslaChargingHistoryPage</c> surface — the diagnostics slug, the
/// shell route name + web route, the generated-client operation ids the <see cref="TeslaChargingHistoryClientFeed"/>
/// binds to, and the invoice-download URL builder (web <c>getTeslaChargingInvoiceURL</c>). UI-free so it is asserted in
/// unit tests and shared by the view, the feed and the shell registration.
/// </summary>
public static class TeslaChargingHistoryRegistration
{
    /// <summary>The diagnostics surface slug (the type name).</summary>
    public const string Slug = "TeslaChargingHistoryPage";

    /// <summary>The shell route name this page registers under.</summary>
    public const string RouteName = "TeslaChargingHistory";

    /// <summary>The web route this page is the parity port of.</summary>
    public const string WebRoute = "/tesla-charging-history";

    /// <summary>The generated operation id for the history query (GET /tesla/charging/history/).</summary>
    public const string HistoryOperation = "get_api_v1_tesla_charging_history";

    /// <summary>The generated operation id for the refresh mutation (POST /tesla/charging/history/refresh).</summary>
    public const string RefreshOperation = "post_api_v1_tesla_charging_history_refresh";

    /// <summary>The generated operation id for the vehicles query (GET /vehicles/).</summary>
    public const string VehiclesOperation = "get_api_v1_vehicles";

    /// <summary>The generated operation id for the invoice download (GET /tesla/charging/invoice/{contentID}).</summary>
    public const string InvoiceOperation = "get_api_v1_tesla_charging_invoice_contentID";

    /// <summary>The Segoe Fluent glyph for the refresh button.</summary>
    public const string RefreshGlyph = "\uE72C";

    /// <summary>The Segoe Fluent glyph for the export-CSV bulk action.</summary>
    public const string ExportGlyph = "\uEDE1";

    /// <summary>The Segoe Fluent glyph for the empty session-table state.</summary>
    public const string TableGlyph = "\uE945";

    /// <summary>The Segoe Fluent glyph for the empty monthly-spending chart state.</summary>
    public const string ChartGlyph = "\uE825";

    /// <summary>The Segoe Fluent glyph for the Total Sessions card.</summary>
    public const string SessionsGlyph = "\uE945";

    /// <summary>The Segoe Fluent glyph for the Total Energy card.</summary>
    public const string EnergyGlyph = "\uEC4A";

    /// <summary>The Segoe Fluent glyph for the Total Spend card.</summary>
    public const string SpendGlyph = "\uE825";

    /// <summary>The Segoe Fluent glyph for the Avg Cost/kWh card.</summary>
    public const string AvgCostGlyph = "\uF0CE";

    /// <summary>
    /// Build the direct invoice-download URL for an invoice content id (web <c>getTeslaChargingInvoiceURL</c>): an
    /// <c>&lt;a href&gt;</c> path under the API prefix, not a generated-client call.
    /// </summary>
    public static string InvoiceUrl(string contentId)
    {
        ArgumentNullException.ThrowIfNull(contentId);
        return $"/api/v1/tesla/charging/invoice/{contentId}";
    }
}

/// <summary>
/// The PII-safe diagnostics sink for the <c>TeslaChargingHistoryPage</c> surface. Records only the
/// <c>view.opened</c> event keyed by the surface slug — never a VIN, location, cost or any billing field — so the
/// open rate is observable without leaking fleet data.
/// </summary>
public sealed class TeslaChargingHistoryDiagnostics
{
    private int _openedCount;

    /// <summary>The number of times the surface has been opened in this process (test / diagnostics hook).</summary>
    public int OpenedCount => _openedCount;

    /// <summary>Record that the surface was opened.</summary>
    public void RecordViewOpened() => Interlocked.Increment(ref _openedCount);
}
