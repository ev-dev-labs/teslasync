using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// The mutually-exclusive lifecycle state of the <c>VehicleCostPage</c> surface — the native mirror of the data
/// states the web page renders (web/src/features/admin/pages/VehicleCostPage.tsx). The web page runs the
/// <c>useVehicleCost</c> query and renders, in precedence order, the loading shimmer (web <c>query.isLoading</c>),
/// the subsystem-unavailable banner (web <c>subsystemMissing</c>, the HTTP 503 case) or the generic failure surface,
/// the fleet-total cards + per-vehicle table (web <c>query.data</c>), or the "no vehicle cost data" empty state when
/// no vehicle has ingested signals in the window. This enum is the top-level summary the ledger/Narrator key off;
/// per-region visibility is still driven by the projected flags so each branch renders exactly as the web composes it.
/// </summary>
public enum VehicleCostState
{
    /// <summary>The cost query is in flight (web <c>query.isLoading</c>) — the page shows the shimmer.</summary>
    Loading,

    /// <summary>The query resolved with no vehicles (web <c>vehicles.length === 0</c>) — the table shows an empty state.</summary>
    Empty,

    /// <summary>The query failed (web <c>subsystemMissing</c> 503, or any other error) — a banner / InfoBar is shown.</summary>
    Error,

    /// <summary>The query produced per-vehicle rows (web <c>vehicles.length &gt; 0</c>) — totals + table render.</summary>
    Success,
}

/// <summary>
/// One per-vehicle ingest-cost row — the native mirror of the web <c>VehicleCostRow</c>
/// (web/src/types/admin-operator-confidence.ts): the vehicle id + optional display name, the signal_log row count,
/// the estimated byte cost, the 24 h ingest rate (rows/min) and the 24 h DLQ failure count, plus the last-seen
/// timestamp. Field names mirror the Go API's snake_case JSON tags; parsing is null-tolerant. Pure data — no WinUI
/// types — so the projection is unit-tested without a UI host.
/// </summary>
public sealed record VehicleCostRow(
    long VehicleId,
    string? DisplayName,
    long SignalRowCount,
    long SignalBytesEst,
    double IngestRatePerMinute24h,
    long DlqFailures24h,
    string? LastSeenAt)
{
    /// <summary>Read one row from a JSON object, tolerating missing / null fields.</summary>
    public static VehicleCostRow FromJson(JsonElement o) => new(
        VehicleId: JsonReadHelpers.Long(o, "vehicle_id") ?? 0,
        DisplayName: JsonReadHelpers.Str(o, "display_name"),
        SignalRowCount: JsonReadHelpers.Long(o, "signal_row_count") ?? 0,
        SignalBytesEst: JsonReadHelpers.Long(o, "signal_bytes_est") ?? 0,
        IngestRatePerMinute24h: JsonReadHelpers.Double(o, "ingest_rate_per_minute_24h") ?? 0,
        DlqFailures24h: JsonReadHelpers.Long(o, "dlq_failures_24h") ?? 0,
        LastSeenAt: JsonReadHelpers.Str(o, "last_seen_at"));
}

/// <summary>
/// The fleet-total summary — the native mirror of the web <c>VehicleCostTotals</c>: the summed row count, byte
/// estimate, 24 h ingest rate and 24 h DLQ failures across every vehicle in the window. Pure data; parsing is
/// null-tolerant.
/// </summary>
public sealed record VehicleCostTotals(
    long TotalRows,
    long TotalBytesEst,
    double TotalRatePerMinute24h,
    long TotalFailures24h)
{
    /// <summary>The all-zero totals (the default before any data arrives).</summary>
    public static VehicleCostTotals Empty { get; } = new(0, 0, 0, 0);

    /// <summary>Read the totals from a JSON object, tolerating missing / null fields.</summary>
    public static VehicleCostTotals FromJson(JsonElement o)
    {
        if (o.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        return new VehicleCostTotals(
            TotalRows: JsonReadHelpers.Long(o, "total_rows") ?? 0,
            TotalBytesEst: JsonReadHelpers.Long(o, "total_bytes_est") ?? 0,
            TotalRatePerMinute24h: JsonReadHelpers.Double(o, "total_rate_per_minute_24h") ?? 0,
            TotalFailures24h: JsonReadHelpers.Long(o, "total_failures_24h") ?? 0);
    }
}

/// <summary>
/// The vehicle-cost envelope — the native mirror of the web <c>VehicleCostResponse</c>: the per-vehicle
/// <see cref="Vehicles"/> rows plus the fleet <see cref="Totals"/>, and a <see cref="HasData"/> marker recording
/// whether the server returned a response (the web <c>query.data</c> presence test). The tolerant parser unwraps the
/// platform <c>{data:…}</c> envelope (internal/platform/httputil.Respond) so the snake_case wire shape round-trips
/// losslessly. Pure data.
/// </summary>
public sealed record VehicleCostSnapshot(bool HasData, IReadOnlyList<VehicleCostRow> Vehicles, VehicleCostTotals Totals)
{
    /// <summary>The empty snapshot (no response yet) — the default local-state feed result.</summary>
    public static VehicleCostSnapshot Empty { get; } = new(false, Array.Empty<VehicleCostRow>(), VehicleCostTotals.Empty);

    /// <summary>
    /// Read the vehicle-cost response from JSON, tolerating missing / null fields and the platform <c>{data:…}</c>
    /// envelope. A non-object payload is treated as "no data" (the web empty branch).
    /// </summary>
    public static VehicleCostSnapshot FromJson(JsonElement root)
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

        var vehicles = new List<VehicleCostRow>();
        if (o.TryGetProperty("vehicles", out var arr) && arr.ValueKind == JsonValueKind.Array)
        {
            foreach (var element in arr.EnumerateArray())
            {
                if (element.ValueKind == JsonValueKind.Object)
                {
                    vehicles.Add(VehicleCostRow.FromJson(element));
                }
            }
        }

        VehicleCostTotals totals = o.TryGetProperty("totals", out var t)
            ? VehicleCostTotals.FromJson(t)
            : VehicleCostTotals.Empty;

        return new VehicleCostSnapshot(true, vehicles, totals);
    }
}

/// <summary>
/// The data port the <see cref="VehicleCostPageViewModel"/> reads the cost report through — the native parity of the
/// web <c>useVehicleCost(since, limit)</c> hook (GET /admin/observability/vehicle-cost). The view never performs HTTP
/// itself; the default <see cref="EmptyVehicleCostFeed"/> resolves to the empty state, and the generated-client-backed
/// <see cref="VehicleCostClientFeed"/> binds to the generated OpenAPI contract client (ADR-004). A failing fetch
/// throws (carrying the HTTP status via <c>ApiException</c>) so the view-model can surface the 503 subsystem-unavailable
/// branch distinctly from a generic failure, exactly as the web <c>subsystemMissing</c> check does.
/// </summary>
public interface IVehicleCostFeed
{
    /// <summary>Resolve the vehicle-cost snapshot for vehicles seen since <paramref name="since"/> (web <c>useVehicleCost</c>).</summary>
    Task<VehicleCostSnapshot> FetchAsync(DateTimeOffset since, int limit, CancellationToken cancellationToken);
}

/// <summary>The default feed — resolves every fetch to the empty snapshot (the empty data state).</summary>
public sealed class EmptyVehicleCostFeed : IVehicleCostFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyVehicleCostFeed Instance { get; } = new();

    private EmptyVehicleCostFeed()
    {
    }

    /// <inheritdoc />
    public Task<VehicleCostSnapshot> FetchAsync(DateTimeOffset since, int limit, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(VehicleCostSnapshot.Empty);
    }
}

/// <summary>
/// The render-time data model the <c>VehicleCostPage</c> projects from — the native analogue of the web page's
/// resolved query state (web/src/features/admin/pages/VehicleCostPage.tsx). Pure data so the projection is
/// unit-tested without a UI host.
/// </summary>
/// <param name="HasData">Whether the query produced a response (web <c>query.data</c>).</param>
/// <param name="Vehicles">The per-vehicle rows (web <c>query.data.vehicles</c>).</param>
/// <param name="Totals">The fleet totals (web <c>query.data.totals</c>).</param>
/// <param name="WindowDays">The selected look-back window in days (web <c>windowDays</c>).</param>
/// <param name="Loading">Whether the query is in flight with no data yet (web <c>query.isLoading</c>).</param>
/// <param name="HasError">Whether the query failed with a non-503 error.</param>
/// <param name="ErrorDetail">Optional failure detail appended to the error surface.</param>
/// <param name="SubsystemMissing">Whether the query failed with HTTP 503 (web <c>subsystemMissing</c>).</param>
public sealed record VehicleCostModel(
    bool HasData,
    IReadOnlyList<VehicleCostRow> Vehicles,
    VehicleCostTotals Totals,
    int WindowDays,
    bool Loading,
    bool HasError,
    string? ErrorDetail,
    bool SubsystemMissing)
{
    /// <summary>The initial model — the first load, no data yet, default 30-day window.</summary>
    public static VehicleCostModel Initial { get; } = new(
        HasData: false,
        Vehicles: Array.Empty<VehicleCostRow>(),
        Totals: VehicleCostTotals.Empty,
        WindowDays: VehicleCostProjection.DefaultWindowDays,
        Loading: true,
        HasError: false,
        ErrorDetail: null,
        SubsystemMissing: false);
}

/// <summary>One projected window-selector option (web <c>WINDOW_OPTIONS</c> entry): the day count, its localized label and whether it is selected.</summary>
public sealed record VehicleCostWindowOption(int Days, string Label, bool IsSelected);

/// <summary>One projected table column descriptor (web <c>Column</c>): the row-value key, the localized header and whether the values are numeric (right-aligned).</summary>
public sealed record VehicleCostColumn(string Key, string Header, bool IsNumeric);

/// <summary>One projected, render-ready table row (web table <c>render</c> output): the formatted cell values keyed by column for the shared data table.</summary>
public sealed record VehicleCostRowDisplay(
    long VehicleId,
    string Vehicle,
    string Rows,
    string Bytes,
    string Rate,
    string Failures,
    string LastSeen);

/// <summary>
/// The fully projected, render-ready view of the page for one input model — everything the WinUI view binds to, with
/// every visible literal already resolved through the i18n facade and every number formatted at the display boundary.
/// Holds the always-visible page header, the subsystem-unavailable banner, the four data-state flags, the four
/// fleet-total stat cards (Total rows / Total bytes / Rate / DLQ failures), and the per-vehicle breakdown panel
/// (window selector + table or empty state). Pure data so every branch is asserted headlessly.
/// </summary>
public sealed record VehicleCostDisplay(
    VehicleCostState State,
    string Title,
    string Subtitle,
    bool ShowSubsystemUnavailable,
    string SubsystemTitle,
    string SubsystemMessage,
    bool ShowLoading,
    string LoadingText,
    bool ShowError,
    string ErrorText,
    string RetryLabel,
    bool ShowContent,
    string TableTitle,
    string WindowLabel,
    IReadOnlyList<VehicleCostWindowOption> WindowOptions,
    int SelectedWindowDays,
    string TotalRowsLabel,
    string TotalRowsValue,
    string TotalRowsSub,
    string TotalBytesLabel,
    string TotalBytesValue,
    string TotalBytesSub,
    string TotalRateLabel,
    string TotalRateValue,
    string TotalRateSub,
    string TotalFailuresLabel,
    string TotalFailuresValue,
    string TotalFailuresSub,
    IReadOnlyList<VehicleCostColumn> Columns,
    IReadOnlyList<VehicleCostRowDisplay> Rows,
    bool ShowTable,
    bool ShowEmptyState,
    string EmptyTitle,
    string EmptyMessage,
    string EmptyTableMessage,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="VehicleCostModel"/> to its <see cref="VehicleCostDisplay"/> — the native port of
/// the render logic in web/src/features/admin/pages/VehicleCostPage.tsx. Every visible literal resolves through the
/// i18n facade using the exact web key names; counts format through <see cref="NumberFormatting"/> (the web
/// <c>fmtNumber</c>), bytes through <see cref="FormatBytes"/> (the web <c>formatBytes</c>) and the last-seen stamp
/// through <see cref="FormatRelative"/> (the web <c>formatRelative</c>), so the C# output matches the web truth. Every
/// chrome string (including the <c>unnamed</c> template and the window labels) is resolved on every projection so the
/// i18n contract holds in every data state. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class VehicleCostProjection
{
    /// <summary>Em-dash fallback shared with the web <c>'—'</c> literals.</summary>
    public const string EmDash = "\u2014";

    /// <summary>The default look-back window in days (web <c>useState&lt;number&gt;(30)</c>).</summary>
    public const int DefaultWindowDays = 30;

    /// <summary>The per-vehicle row limit requested (web <c>useVehicleCost(since, 100)</c>).</summary>
    public const int RowLimit = 100;

    private const long Kib = 1024L;
    private const long Mib = 1024L * 1024L;
    private const long Gib = 1024L * 1024L * 1024L;

    /// <summary>The window options offered by the selector (web <c>WINDOW_OPTIONS</c>): 1 / 7 / 30 / 90 days.</summary>
    public static IReadOnlyList<int> WindowChoices { get; } = new[] { 1, 7, 30, 90 };

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the resolved web query state).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="now">The reference instant for relative timestamp formatting.</param>
    public static VehicleCostDisplay Project(VehicleCostModel model, ILocalizer localizer, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        // ── Page header (web PageContainer title + subtitle) ────────────────────────────────────────────────
        string title = localizer.GetString("admin.vehicleCost.pageTitle", "Vehicle Ingest Cost");
        string subtitle = localizer.GetString(
            "admin.vehicleCost.subtitle",
            "Per-vehicle telemetry cost over the selected window. Use this to spot vehicles whose ingest volume is disproportionate to the fleet baseline.");

        // ── Subsystem-unavailable banner (web 503 subsystemMissing AlertBanner) ─────────────────────────────
        string subsystemTitle = localizer.GetString("admin.subsystem.unavailableTitle", "Subsystem unavailable");
        string subsystemMessage = localizer.GetString(
            "admin.vehicleCost.notConfigured",
            "The ingest-x-ray subsystem is not configured on this deployment. Vehicle cost reporting requires the signal_log hypertable to be populated.");

        // ── Generic failure surface (native InfoBar + Retry) ────────────────────────────────────────────────
        string loadFailed = localizer.GetString("error.loadFailed", "Failed to load data");
        string errorText = model.HasError && !string.IsNullOrEmpty(model.ErrorDetail)
            ? $"{loadFailed}: {model.ErrorDetail}"
            : loadFailed;
        string retryLabel = localizer.GetString("common.retry", "Retry");
        string loadingText = localizer.GetString("common.loading", "Loading...");

        // ── Per-vehicle breakdown panel chrome (web GlassPanel header) ──────────────────────────────────────
        string tableTitle = localizer.GetString("admin.vehicleCost.tableTitle", "Per-vehicle breakdown");
        string windowLabel = localizer.GetString("admin.vehicleCost.windowLabel", "Window");
        var windowOptions = BuildWindowOptions(model.WindowDays, localizer);

        // ── Fleet-total cards (web FleetTotalsCards) ────────────────────────────────────────────────────────
        string windowSubTemplate = localizer.GetString("admin.vehicleCost.windowSub", "Window: {0}d");
        string totalRowsLabel = localizer.GetString("admin.vehicleCost.totalRows", "Total rows");
        string totalBytesLabel = localizer.GetString("admin.vehicleCost.totalBytes", "Total bytes (est.)");
        string bytesSub = localizer.GetString("admin.vehicleCost.bytesSub", "96 bytes/row average");
        string totalRateLabel = localizer.GetString("admin.vehicleCost.totalRate", "Rate (rows/min, 24h)");
        string rateSub = localizer.GetString("admin.vehicleCost.rateSub", "Across all vehicles");
        string totalFailuresLabel = localizer.GetString("admin.vehicleCost.totalFailures", "DLQ failures (24h)");
        string failuresSub = localizer.GetString("admin.vehicleCost.failuresSub", "Codec or writer rejections");

        var totals = model.Totals;
        string windowSub = string.Format(CultureInfo.CurrentCulture, windowSubTemplate, model.WindowDays);

        // ── Table columns (web columns) ─────────────────────────────────────────────────────────────────────
        var columns = new List<VehicleCostColumn>
        {
            new("vehicle", localizer.GetString("admin.vehicleCost.colVehicle", "Vehicle"), false),
            new("rows", localizer.GetString("admin.vehicleCost.colRows", "Rows"), true),
            new("bytes", localizer.GetString("admin.vehicleCost.colBytes", "Bytes (est.)"), true),
            new("rate", localizer.GetString("admin.vehicleCost.colRate", "Rate (rows/min, 24h)"), true),
            new("failures", localizer.GetString("admin.vehicleCost.colFailures", "DLQ (24h)"), true),
            new("last", localizer.GetString("admin.vehicleCost.colLastSeen", "Last seen"), false),
        };

        // ── Table rows (web column render functions) ────────────────────────────────────────────────────────
        string unnamedTemplate = localizer.GetString("admin.vehicleCost.unnamed", "Vehicle #{0}");
        var rows = new List<VehicleCostRowDisplay>(model.Vehicles.Count);
        foreach (var row in model.Vehicles)
        {
            string vehicle = !string.IsNullOrEmpty(row.DisplayName)
                ? row.DisplayName!
                : string.Format(CultureInfo.CurrentCulture, unnamedTemplate, row.VehicleId);

            rows.Add(new VehicleCostRowDisplay(
                VehicleId: row.VehicleId,
                Vehicle: vehicle,
                Rows: FormatCount(row.SignalRowCount),
                Bytes: FormatBytes(row.SignalBytesEst),
                Rate: FormatRate(row.IngestRatePerMinute24h),
                Failures: FormatCount(row.DlqFailures24h),
                LastSeen: FormatRelative(row.LastSeenAt, now)));
        }

        // ── Empty state (web EmptyState + DataTable emptyMessage) ───────────────────────────────────────────
        string emptyTitle = localizer.GetString("admin.vehicleCost.emptyTitle", "No vehicle cost data");
        string emptyMessage = localizer.GetString(
            "admin.vehicleCost.emptyMessage",
            "No vehicles have ingested signals during this window.");
        string emptyTableMessage = localizer.GetString("admin.vehicleCost.emptyTable", "No vehicle cost data");

        // ── State selection (web render precedence) ─────────────────────────────────────────────────────────
        bool showLoading = model.Loading;
        bool showSubsystem = !model.Loading && model.SubsystemMissing;
        bool showError = !model.Loading && !model.SubsystemMissing && model.HasError;
        bool showContent = !model.Loading && !model.SubsystemMissing && !model.HasError;
        bool hasVehicles = model.Vehicles.Count > 0;
        bool showTable = showContent && hasVehicles;
        bool showEmptyState = showContent && !hasVehicles;

        VehicleCostState state = showLoading
            ? VehicleCostState.Loading
            : (showSubsystem || showError)
                ? VehicleCostState.Error
                : hasVehicles
                    ? VehicleCostState.Success
                    : VehicleCostState.Empty;

        return new VehicleCostDisplay(
            State: state,
            Title: title,
            Subtitle: subtitle,
            ShowSubsystemUnavailable: showSubsystem,
            SubsystemTitle: subsystemTitle,
            SubsystemMessage: subsystemMessage,
            ShowLoading: showLoading,
            LoadingText: loadingText,
            ShowError: showError,
            ErrorText: errorText,
            RetryLabel: retryLabel,
            ShowContent: showContent,
            TableTitle: tableTitle,
            WindowLabel: windowLabel,
            WindowOptions: windowOptions,
            SelectedWindowDays: model.WindowDays,
            TotalRowsLabel: totalRowsLabel,
            TotalRowsValue: FormatCount(totals.TotalRows),
            TotalRowsSub: windowSub,
            TotalBytesLabel: totalBytesLabel,
            TotalBytesValue: FormatBytes(totals.TotalBytesEst),
            TotalBytesSub: bytesSub,
            TotalRateLabel: totalRateLabel,
            TotalRateValue: FormatRate(totals.TotalRatePerMinute24h),
            TotalRateSub: rateSub,
            TotalFailuresLabel: totalFailuresLabel,
            TotalFailuresValue: FormatCount(totals.TotalFailures24h),
            TotalFailuresSub: failuresSub,
            Columns: columns,
            Rows: rows,
            ShowTable: showTable,
            ShowEmptyState: showEmptyState,
            EmptyTitle: emptyTitle,
            EmptyMessage: emptyMessage,
            EmptyTableMessage: emptyTableMessage,
            AutomationName: title);
    }

    /// <summary>Format an integer count with en-US grouping (web <c>fmtNumber</c> at 0 decimals).</summary>
    public static string FormatCount(long value) => NumberFormatting.Format(value, null, 0);

    /// <summary>Format the ingest rate with one fixed decimal and en-US grouping (web <c>fmtNumber(value, 1)</c>).</summary>
    public static string FormatRate(double value) => NumberFormatting.Format(value, null, 1);

    /// <summary>
    /// Format a byte count with binary units (web <c>formatBytes</c>): bytes verbatim below 1 KiB, then KB / MB / GB
    /// each with one fixed decimal. Mirrors the web's <c>toFixed(1)</c> (no grouping) so the C# output matches.
    /// </summary>
    public static string FormatBytes(long bytes)
    {
        if (bytes < Kib)
        {
            return $"{bytes.ToString(CultureInfo.InvariantCulture)} B";
        }

        if (bytes < Mib)
        {
            return $"{Fixed1(bytes / (double)Kib)} KB";
        }

        if (bytes < Gib)
        {
            return $"{Fixed1(bytes / (double)Mib)} MB";
        }

        return $"{Fixed1(bytes / (double)Gib)} GB";
    }

    /// <summary>
    /// Relative last-seen label (web <c>formatRelative</c>): "just now" / "Nm ago" / "Nh ago" / "Nd ago" for the
    /// first week, then an absolute "MMM d, yyyy" date; the em-dash fallback for null / unparseable input.
    /// </summary>
    public static string FormatRelative(string? raw, DateTimeOffset now)
    {
        if (string.IsNullOrWhiteSpace(raw) || !TryParseInstant(raw, out var value))
        {
            return EmDash;
        }

        long seconds = (long)Math.Floor((now - value).TotalSeconds);
        if (seconds < 60)
        {
            return "just now";
        }

        long minutes = seconds / 60;
        if (minutes < 60)
        {
            return $"{minutes}m ago";
        }

        long hours = minutes / 60;
        if (hours < 24)
        {
            return $"{hours}h ago";
        }

        long days = hours / 24;
        if (days < 7)
        {
            return $"{days}d ago";
        }

        return DateTimeFormatting.Format(value, DateTimeVariant.Date, now);
    }

    private static List<VehicleCostWindowOption> BuildWindowOptions(int selectedDays, ILocalizer localizer)
    {
        var options = new List<VehicleCostWindowOption>(WindowChoices.Count);
        foreach (var days in WindowChoices)
        {
            options.Add(new VehicleCostWindowOption(days, WindowLabelFor(days, localizer), days == selectedDays));
        }

        return options;
    }

    private static string WindowLabelFor(int days, ILocalizer localizer) => days switch
    {
        1 => localizer.GetString("admin.vehicleCost.window1d", "Last 1 day"),
        7 => localizer.GetString("admin.vehicleCost.window7d", "Last 7 days"),
        30 => localizer.GetString("admin.vehicleCost.window30d", "Last 30 days"),
        _ => localizer.GetString("admin.vehicleCost.window90d", "Last 90 days"),
    };

    private static string Fixed1(double value) => value.ToString("F1", CultureInfo.InvariantCulture);

    private static bool TryParseInstant(string raw, out DateTimeOffset value) =>
        DateTimeOffset.TryParse(
            raw,
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out value);
}

/// <summary>
/// Canonical metadata for the <c>VehicleCostPage</c> feature surface — the native mirror of the web page at
/// <c>web/src/features/admin/pages/VehicleCostPage.tsx</c> (route <c>/admin/vehicle-cost</c>, nav name
/// <c>VehicleCost</c>).
/// </summary>
public static class VehicleCostRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "VehicleCostPage";

    /// <summary>The navigation route name this page registers under (see RouteTable <c>VehicleCost</c>).</summary>
    public const string RouteName = "VehicleCost";

    /// <summary>The generated OpenAPI operation id for the cost query (web <c>useVehicleCost</c>).</summary>
    public const string Operation = "get_api_v1_admin_observability_vehicle_cost";

    /// <summary>The Segoe Fluent Icons glyph for the empty state (web <c>Wallet</c> icon).</summary>
    public const string EmptyGlyph = "\uE825"; // Money / wallet

    /// <summary>The localized page title (web <c>admin.vehicleCost.pageTitle</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("admin.vehicleCost.pageTitle", "Vehicle Ingest Cost");
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>VehicleCostPage</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a vehicle id, display name or count — so a
/// diagnostics line can never leak fleet content. Thread-safe.
/// </summary>
public sealed class VehicleCostDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public VehicleCostDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=VehicleCostPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={VehicleCostRegistration.Slug}");
    }
}
