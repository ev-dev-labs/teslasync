using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.VehicleSystems;

/// <summary>
/// The mutually-exclusive lifecycle state of the <c>MaintenancePage</c> surface — the native mirror of the data
/// states the web page renders (web/src/features/vehicle-systems/pages/MaintenancePage.tsx). The web page runs two
/// TanStack queries (the maintenance items <c>/maintenance</c> and the service records <c>/maintenance/records</c>)
/// and renders, in precedence order, the loading shimmer (web <c>isLoading &amp;&amp; !items</c>), a failure banner
/// above the body (web <c>anyError</c>), then the summary cards plus the item grid / cost / projection / records
/// regions (web <c>items</c>). This enum is the top-level summary the ledger/Narrator key off; per-region visibility
/// is still driven by the projected flags so the failure banner can sit above any content branch exactly as the web
/// composes them.
/// </summary>
public enum MaintenanceState
{
    /// <summary>A query is in flight with no data yet (web <c>isLoading &amp;&amp; !items</c>) — the page shows the shimmer.</summary>
    Loading,

    /// <summary>The queries resolved with no maintenance items (web <c>items.length === 0</c>) — the grid shows an empty state.</summary>
    Empty,

    /// <summary>A query failed (web <c>anyError</c>) — a failure banner is shown above the body.</summary>
    Error,

    /// <summary>The queries produced maintenance items (web <c>items.length &gt; 0</c>) — the full body renders.</summary>
    Success,
}

/// <summary>
/// One maintenance item — the native mirror of the web <c>MaintenanceItem</c>
/// (web/src/features/vehicle-systems/pages/MaintenancePage.tsx): the category, name and description, the optional
/// due-date / due-mileage targets, the current odometer, the last-service date / mileage, the optional
/// month / mile service intervals, and the server status. Field names mirror the Go API's snake_case JSON tags;
/// parsing is null-tolerant. Pure data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
public sealed record MaintenanceItem(
    long Id,
    string Category,
    string Name,
    string Description,
    string? DueDate,
    double? DueMileage,
    double CurrentMileage,
    string? LastServiceDate,
    double? LastServiceMileage,
    double? IntervalMonths,
    double? IntervalMiles,
    string Status)
{
    /// <summary>Read one item from a JSON object, tolerating missing / null fields.</summary>
    public static MaintenanceItem FromJson(JsonElement o) => new(
        Id: JsonReadHelpers.Long(o, "id") ?? 0,
        Category: JsonReadHelpers.Str(o, "category") ?? string.Empty,
        Name: JsonReadHelpers.Str(o, "name") ?? string.Empty,
        Description: JsonReadHelpers.Str(o, "description") ?? string.Empty,
        DueDate: JsonReadHelpers.Str(o, "due_date"),
        DueMileage: JsonReadHelpers.Double(o, "due_mileage"),
        CurrentMileage: JsonReadHelpers.Double(o, "current_mileage") ?? 0,
        LastServiceDate: JsonReadHelpers.Str(o, "last_service_date"),
        LastServiceMileage: JsonReadHelpers.Double(o, "last_service_mileage"),
        IntervalMonths: JsonReadHelpers.Double(o, "interval_months"),
        IntervalMiles: JsonReadHelpers.Double(o, "interval_miles"),
        Status: JsonReadHelpers.Str(o, "status") ?? "good");
}

/// <summary>
/// One service-history record — the native mirror of the web <c>ServiceRecord</c>: the service date, description,
/// odometer, cost, and provider. Field names mirror the Go API's snake_case JSON tags; parsing is null-tolerant.
/// Pure data.
/// </summary>
public sealed record MaintenanceServiceRecord(
    long Id,
    string Date,
    string Description,
    double Mileage,
    double Cost,
    string Provider)
{
    /// <summary>Read one record from a JSON object, tolerating missing / null fields.</summary>
    public static MaintenanceServiceRecord FromJson(JsonElement o) => new(
        Id: JsonReadHelpers.Long(o, "id") ?? 0,
        Date: JsonReadHelpers.Str(o, "date") ?? string.Empty,
        Description: JsonReadHelpers.Str(o, "description") ?? string.Empty,
        Mileage: JsonReadHelpers.Double(o, "mileage") ?? 0,
        Cost: JsonReadHelpers.Double(o, "cost") ?? 0,
        Provider: JsonReadHelpers.Str(o, "provider") ?? string.Empty);
}

/// <summary>
/// The maintenance envelope — the native mirror of the web page's two resolved queries: the maintenance
/// <see cref="Items"/> (web <c>/maintenance</c>) plus the service <see cref="Records"/> (web
/// <c>/maintenance/records</c>), and a <see cref="HasData"/> marker recording whether the server responded. The
/// tolerant parsers accept both a bare JSON array and the platform <c>{data:[…]}</c> envelope so the snake_case wire
/// shape round-trips losslessly. Pure data.
/// </summary>
public sealed record MaintenanceSnapshot(
    bool HasData,
    IReadOnlyList<MaintenanceItem> Items,
    IReadOnlyList<MaintenanceServiceRecord> Records)
{
    /// <summary>The empty snapshot (no response yet) — the default local-state feed result.</summary>
    public static MaintenanceSnapshot Empty { get; } =
        new(false, Array.Empty<MaintenanceItem>(), Array.Empty<MaintenanceServiceRecord>());

    /// <summary>Read the maintenance items array from JSON (bare array or <c>{data:[…]}</c> envelope), tolerant of partial rows.</summary>
    public static IReadOnlyList<MaintenanceItem> ItemsFromJson(JsonElement root)
    {
        var items = new List<MaintenanceItem>();
        foreach (var element in EnumerateArray(root))
        {
            items.Add(MaintenanceItem.FromJson(element));
        }

        return items;
    }

    /// <summary>Read the service records array from JSON (bare array or <c>{data:[…]}</c> envelope), tolerant of partial rows.</summary>
    public static IReadOnlyList<MaintenanceServiceRecord> RecordsFromJson(JsonElement root)
    {
        var records = new List<MaintenanceServiceRecord>();
        foreach (var element in EnumerateArray(root))
        {
            records.Add(MaintenanceServiceRecord.FromJson(element));
        }

        return records;
    }

    private static IEnumerable<JsonElement> EnumerateArray(JsonElement root)
    {
        JsonElement array = root;
        if (root.ValueKind == JsonValueKind.Object &&
            root.TryGetProperty("data", out var data))
        {
            array = data;
        }

        if (array.ValueKind != JsonValueKind.Array)
        {
            yield break;
        }

        foreach (var element in array.EnumerateArray())
        {
            if (element.ValueKind == JsonValueKind.Object)
            {
                yield return element;
            }
        }
    }
}

/// <summary>
/// The data port the <see cref="MaintenancePageViewModel"/> reads the maintenance report through — the native parity
/// of the web page's two queries (GET /maintenance + GET /maintenance/records). The view never performs HTTP itself;
/// the default <see cref="EmptyMaintenanceFeed"/> resolves to the empty state, and the generated-client-backed
/// <see cref="MaintenanceClientFeed"/> binds to the generated OpenAPI contract client (ADR-004). A failing fetch
/// throws (carrying the HTTP status via <c>ApiException</c>) so the view-model surfaces the failure banner exactly as
/// the web <c>anyError</c> check does.
/// </summary>
public interface IMaintenanceFeed
{
    /// <summary>Resolve the maintenance snapshot (items + service records) for the active vehicle context.</summary>
    Task<MaintenanceSnapshot> FetchAsync(CancellationToken cancellationToken);
}

/// <summary>The default feed — resolves every fetch to the empty snapshot (the empty data state).</summary>
public sealed class EmptyMaintenanceFeed : IMaintenanceFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyMaintenanceFeed Instance { get; } = new();

    private EmptyMaintenanceFeed()
    {
    }

    /// <inheritdoc />
    public Task<MaintenanceSnapshot> FetchAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(MaintenanceSnapshot.Empty);
    }
}

/// <summary>
/// The render-time data model the <c>MaintenancePage</c> projects from — the native analogue of the web page's
/// resolved query state plus the client-side category filter and sort selection
/// (web/src/features/vehicle-systems/pages/MaintenancePage.tsx). Pure data so the projection is unit-tested without a
/// UI host.
/// </summary>
/// <param name="HasData">Whether a query produced a response (web <c>items</c> presence).</param>
/// <param name="Items">The maintenance items (web <c>/maintenance</c>).</param>
/// <param name="Records">The service records (web <c>/maintenance/records</c>).</param>
/// <param name="CategoryFilter">The selected category, or <c>all</c> (web <c>categoryFilter</c>).</param>
/// <param name="SortBy">The selected sort key (web <c>sortBy</c>).</param>
/// <param name="Loading">Whether a query is in flight with no data yet (web <c>isLoading &amp;&amp; !items</c>).</param>
/// <param name="HasError">Whether either query failed (web <c>anyError</c>).</param>
/// <param name="ErrorDetail">Optional failure detail appended to the error banner.</param>
public sealed record MaintenanceModel(
    bool HasData,
    IReadOnlyList<MaintenanceItem> Items,
    IReadOnlyList<MaintenanceServiceRecord> Records,
    string CategoryFilter,
    string SortBy,
    bool Loading,
    bool HasError,
    string? ErrorDetail)
{
    /// <summary>The initial model — first load, no data yet, default "all" filter + "status" sort.</summary>
    public static MaintenanceModel Initial { get; } = new(
        HasData: false,
        Items: Array.Empty<MaintenanceItem>(),
        Records: Array.Empty<MaintenanceServiceRecord>(),
        CategoryFilter: MaintenanceProjection.AllCategories,
        SortBy: MaintenanceProjection.DefaultSort,
        Loading: true,
        HasError: false,
        ErrorDetail: null);
}

/// <summary>One projected metric tile (web <c>MetricCard</c>): the localized label, the formatted value and the accent brush key.</summary>
public sealed record MaintenanceMetric(string Label, string Value, string AccentBrushKey);

/// <summary>One projected selector option (web <c>Select</c> option): the value, its localized label and whether it is selected.</summary>
public sealed record MaintenanceOption(string Value, string Label, bool IsSelected);

/// <summary>
/// One projected, render-ready maintenance item card (web <c>MaintenanceItemCard</c>): the category chip, the derived
/// status badge, the name + description, the optional progress bar and the footer chips. Every visible literal is
/// already resolved.
/// </summary>
public sealed record MaintenanceItemCardDisplay(
    long Id,
    string CategoryLabel,
    string CategoryAccentBrushKey,
    string StatusLabel,
    StatusKind StatusKind,
    string Name,
    string Description,
    bool ShowProgress,
    double ProgressFraction,
    string ProgressPercentText,
    string ProgressColorBrushKey,
    string DueText,
    bool HasDue,
    string MileageText,
    bool HasMileage,
    string LastServiceText,
    bool HasLastService);

/// <summary>One projected service-projection row (web projections list): the item name, the combined detail line and the status badge.</summary>
public sealed record MaintenanceProjectionRow(string Name, string DetailText, bool HasDetail, string BadgeLabel, StatusKind BadgeStatus);

/// <summary>One projected table column descriptor (web <c>Column</c>): the row-value key, the localized header and whether the values are numeric (right-aligned).</summary>
public sealed record MaintenanceColumn(string Key, string Header, bool IsNumeric);

/// <summary>One projected, render-ready service-records table row (web table <c>render</c> output): the formatted cells keyed by column.</summary>
public sealed record MaintenanceRecordRow(long Id, string Date, string Description, string Mileage, string Cost, string Provider);

/// <summary>
/// The fully projected, render-ready view of the page for one input model — everything the WinUI view binds to, with
/// every visible literal already resolved through the i18n facade and every number / date formatted at the display
/// boundary. Holds the always-visible page header, the failure banner, the data-state flags, the four summary stat
/// cards, the filter / sort toolbar, the item grid (cards or empty), the estimated-annual-cost panel (cost cards or
/// empty), the service-projections panel (rows or empty) and the service-records panel (table or empty). Pure data so
/// every branch is asserted headlessly.
/// </summary>
public sealed record MaintenanceDisplay(
    MaintenanceState State,
    string Title,
    string Subtitle,
    string AutomationName,
    bool ShowError,
    string ErrorText,
    bool ShowLoading,
    bool ShowContent,
    IReadOnlyList<MaintenanceMetric> SummaryCards,
    IReadOnlyList<MaintenanceOption> CategoryOptions,
    IReadOnlyList<MaintenanceOption> SortOptions,
    string ScheduleLabel,
    bool ShowItems,
    IReadOnlyList<MaintenanceItemCardDisplay> ItemCards,
    bool ShowItemsEmpty,
    string ItemsEmptyTitle,
    string ItemsEmptyMessage,
    string CostTitle,
    bool ShowCostCards,
    IReadOnlyList<MaintenanceMetric> CostCards,
    string CostNote,
    bool ShowCostEmpty,
    string CostEmptyMessage,
    string ProjectionsTitle,
    bool ShowProjections,
    IReadOnlyList<MaintenanceProjectionRow> ProjectionRows,
    bool ShowProjectionsEmpty,
    string ProjectionsEmptyMessage,
    string RecordsTitle,
    bool ShowRecords,
    IReadOnlyList<MaintenanceColumn> RecordColumns,
    IReadOnlyList<MaintenanceRecordRow> RecordRows,
    string RecordsEmptyTableMessage,
    bool ShowRecordsEmpty,
    string RecordsEmptyMessage);

/// <summary>
/// Pure projection from a <see cref="MaintenanceModel"/> to its <see cref="MaintenanceDisplay"/> — the native port of
/// the render logic in web/src/features/vehicle-systems/pages/MaintenancePage.tsx. Every visible literal resolves
/// through the i18n facade using the exact web key names; counts format through <see cref="NumberFormatting"/> (web
/// <c>fmtNumber</c>), costs through <see cref="FormatCurrency"/> (web <c>formatCurrency</c>) and dates through
/// <see cref="DateTimeFormatting"/> (web <c>formatDate</c> / <c>formatDateTime</c>), so the C# output matches the web
/// truth. Every chrome string is resolved on every projection so the i18n contract holds in every data state. No
/// WinUI types — unit-tested without a UI host.
/// </summary>
public static class MaintenanceProjection
{
    /// <summary>Em-dash fallback shared with the web <c>'—'</c> literals.</summary>
    public const string EmDash = "\u2014";

    /// <summary>The "all categories" filter sentinel (web <c>'all'</c>).</summary>
    public const string AllCategories = "all";

    /// <summary>The default sort key (web <c>useState('status')</c>).</summary>
    public const string DefaultSort = "status";

    private const double DaysPerMonth = 30.44;
    private const double MillisPerDay = 24.0 * 60.0 * 60.0 * 1000.0;
    private const double MillisPerYear = 365.25 * 24.0 * 3600.0 * 1000.0;
    private const int MaxProjections = 8;

    private const string AccentCyan = "TsColorInfoBrush";      // web color="cyan"
    private const string AccentAmber = "TsColorWarningBrush";  // web color="amber"
    private const string AccentRed = "TsColorDangerBrush";     // web color="red"
    private const string AccentGreen = "TsColorSuccessBrush";  // web color="green"
    private const string AccentPurple = "TsColorAccentBrush";  // web color="purple"

    /// <summary>The sort keys offered by the selector, in web order (web <c>SORT_OPTIONS</c>).</summary>
    public static IReadOnlyList<string> SortChoices { get; } = new[] { "status", "name", "due_date", "category" };

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the resolved web query state + filter/sort).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="now">The reference instant for progress / date formatting.</param>
    public static MaintenanceDisplay Project(MaintenanceModel model, ILocalizer localizer, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        // ── Page header (web PageContainer title + subtitle) ────────────────────────────────────────────────
        string title = localizer.GetString("Maintenance", "Maintenance");
        string subtitle = localizer.GetString(
            "Service schedule, records, and upcoming maintenance",
            "Service schedule, records, and upcoming maintenance");

        // ── Failure banner (web anyError AlertBanner) ───────────────────────────────────────────────────────
        string loadFailed = localizer.GetString("error.loadFailed", "Failed to load data");
        string errorText = model.HasError && !string.IsNullOrEmpty(model.ErrorDetail)
            ? $"{loadFailed}: {model.ErrorDetail}"
            : loadFailed;

        // ── Summary stat cards (web MetricCard grid) ────────────────────────────────────────────────────────
        string totalItemsLabel = localizer.GetString("Total Items", "Total Items");
        string dueSoonLabel = localizer.GetString("Due Soon", "Due Soon");
        string overdueLabel = localizer.GetString("Overdue", "Overdue");
        string completedLabel = localizer.GetString("Completed", "Completed");

        var summary = Summarize(model.Items);
        var summaryCards = new List<MaintenanceMetric>
        {
            new(totalItemsLabel, FormatCount(summary.Total), AccentCyan),
            new(dueSoonLabel, FormatCount(summary.Soon), AccentAmber),
            new(overdueLabel, FormatCount(summary.Overdue), AccentRed),
            new(completedLabel, FormatCount(summary.Completed), AccentGreen),
        };

        // ── Filter / sort toolbar (web Select + Schedule Button) ────────────────────────────────────────────
        string scheduleLabel = localizer.GetString("Schedule Maintenance", "Schedule Maintenance");
        var categoryOptions = BuildCategoryOptions(model.Items, model.CategoryFilter, localizer);
        var sortOptions = BuildSortOptions(model.SortBy, localizer);

        // ── Item grid (web filteredItems map / EmptyState) ──────────────────────────────────────────────────
        string dueLabel = localizer.GetString("Due", "Due");
        string miUnit = localizer.GetString("mi", "mi");
        string goodLabel = localizer.GetString("Good", "Good");

        var filtered = FilterAndSort(model.Items, model.CategoryFilter, model.SortBy);
        var itemCards = new List<MaintenanceItemCardDisplay>(filtered.Count);
        foreach (var item in filtered)
        {
            itemCards.Add(ProjectItemCard(item, now, dueLabel, miUnit, goodLabel, dueSoonLabel, overdueLabel, completedLabel, localizer));
        }

        string itemsEmptyTitle = localizer.GetString("No maintenance items", "No maintenance items");
        string itemsEmptyFiltered = localizer.GetString(
            "No items match the selected category. Try a different filter.",
            "No items match the selected category. Try a different filter.");
        string itemsEmptyAll = localizer.GetString(
            "No maintenance items found for this vehicle.",
            "No maintenance items found for this vehicle.");
        string itemsEmptyMessage = model.CategoryFilter != AllCategories ? itemsEmptyFiltered : itemsEmptyAll;
        bool showItems = itemCards.Count > 0;

        // ── Estimated annual cost panel (web costStats) ─────────────────────────────────────────────────────
        string costTitle = localizer.GetString("Estimated Annual Cost", "Estimated Annual Cost");
        string totalSpentLabel = localizer.GetString("Total Spent", "Total Spent");
        string annualEstLabel = localizer.GetString("Annual Est.", "Annual Est.");
        string avgServiceLabel = localizer.GetString("Avg / Service", "Avg / Service");
        string costNote = localizer.GetString(
            "EV maintenance is typically 40-60% cheaper than a comparable gas vehicle.",
            "EV maintenance is typically 40-60% cheaper than a comparable gas vehicle.");
        string costEmptyMessage = localizer.GetString(
            "No cost data available yet. Log service records to see cost estimates.",
            "No cost data available yet. Log service records to see cost estimates.");

        var costStats = ComputeCostStats(model.Records);
        var costCards = new List<MaintenanceMetric>();
        if (costStats is { } stats)
        {
            costCards.Add(new MaintenanceMetric(totalSpentLabel, FormatCurrency(stats.TotalCost, 0), AccentGreen));
            costCards.Add(new MaintenanceMetric(annualEstLabel, $"{FormatCurrency(stats.AnnualCost, 0)}/yr", AccentCyan));
            costCards.Add(new MaintenanceMetric(avgServiceLabel, FormatCurrency(stats.AvgPerService, 0), AccentPurple));
        }

        bool showCostCards = costStats is not null;

        // ── Service projections panel (web projections) ─────────────────────────────────────────────────────
        string projectionsTitle = localizer.GetString("Service Projections", "Service Projections");
        string projectionsEmptyMessage = localizer.GetString(
            "No upcoming service projections available.",
            "No upcoming service projections available.");
        var projectionRows = BuildProjections(model.Items, now, miUnit, goodLabel, dueSoonLabel, overdueLabel, completedLabel);
        bool showProjections = projectionRows.Count > 0;

        // ── Service records panel (web DataTable) ───────────────────────────────────────────────────────────
        string recordsTitle = localizer.GetString("Service Records", "Service Records");
        var recordColumns = new List<MaintenanceColumn>
        {
            new("date", localizer.GetString("Date", "Date"), false),
            new("description", localizer.GetString("Description", "Description"), false),
            new("mileage", localizer.GetString("Mileage", "Mileage"), true),
            new("cost", localizer.GetString("Cost", "Cost"), true),
            new("provider", localizer.GetString("Provider", "Provider"), false),
        };

        var recordRows = new List<MaintenanceRecordRow>(model.Records.Count);
        foreach (var record in model.Records)
        {
            recordRows.Add(new MaintenanceRecordRow(
                Id: record.Id,
                Date: FormatDateTime(record.Date, now),
                Description: record.Description,
                Mileage: $"{FormatCount(record.Mileage)} {miUnit}",
                Cost: FormatCurrency(record.Cost, 2),
                Provider: string.IsNullOrEmpty(record.Provider) ? EmDash : record.Provider));
        }

        string recordsEmptyTableMessage = localizer.GetString("No service records found.", "No service records found.");
        string recordsEmptyMessage = localizer.GetString("No service records logged yet.", "No service records logged yet.");
        bool showRecords = recordRows.Count > 0;

        // ── State selection (web render precedence) ─────────────────────────────────────────────────────────
        bool showLoading = model.Loading && !model.HasData;
        bool showError = !showLoading && model.HasError;
        bool showContent = !showLoading;
        bool hasItems = model.Items.Count > 0;

        MaintenanceState state = showLoading
            ? MaintenanceState.Loading
            : model.HasError
                ? MaintenanceState.Error
                : hasItems
                    ? MaintenanceState.Success
                    : MaintenanceState.Empty;

        return new MaintenanceDisplay(
            State: state,
            Title: title,
            Subtitle: subtitle,
            AutomationName: title,
            ShowError: showError,
            ErrorText: errorText,
            ShowLoading: showLoading,
            ShowContent: showContent,
            SummaryCards: summaryCards,
            CategoryOptions: categoryOptions,
            SortOptions: sortOptions,
            ScheduleLabel: scheduleLabel,
            ShowItems: showItems,
            ItemCards: itemCards,
            ShowItemsEmpty: !showItems,
            ItemsEmptyTitle: itemsEmptyTitle,
            ItemsEmptyMessage: itemsEmptyMessage,
            CostTitle: costTitle,
            ShowCostCards: showCostCards,
            CostCards: costCards,
            CostNote: costNote,
            ShowCostEmpty: !showCostCards,
            CostEmptyMessage: costEmptyMessage,
            ProjectionsTitle: projectionsTitle,
            ShowProjections: showProjections,
            ProjectionRows: projectionRows,
            ShowProjectionsEmpty: !showProjections,
            ProjectionsEmptyMessage: projectionsEmptyMessage,
            RecordsTitle: recordsTitle,
            ShowRecords: showRecords,
            RecordColumns: recordColumns,
            RecordRows: recordRows,
            RecordsEmptyTableMessage: recordsEmptyTableMessage,
            ShowRecordsEmpty: !showRecords,
            RecordsEmptyMessage: recordsEmptyMessage);
    }

    /// <summary>Format an integer count with en-US grouping (web <c>fmtNumber</c> at 0 decimals).</summary>
    public static string FormatCount(double value) => NumberFormatting.Format(value, null, 0);

    /// <summary>Format a currency amount (web <c>formatCurrency</c>): the "$" symbol plus the grouped, fixed-decimal value.</summary>
    public static string FormatCurrency(double value, int decimals) => $"${NumberFormatting.Format(value, null, decimals)}";

    /// <summary>Format a date as "MMM d, yyyy" (web <c>formatDate</c>); the em-dash fallback for null / unparseable input.</summary>
    public static string FormatDate(string? raw, DateTimeOffset now) =>
        TryParseInstant(raw, out var value) ? DateTimeFormatting.Format(value, DateTimeVariant.Date, now) : EmDash;

    /// <summary>Format a datetime as "MMM d, yyyy hh:mm tt" (web <c>formatDateTime</c>); the em-dash fallback for null / unparseable input.</summary>
    public static string FormatDateTime(string? raw, DateTimeOffset now) =>
        TryParseInstant(raw, out var value) ? DateTimeFormatting.Format(value, DateTimeVariant.Full, now) : EmDash;

    /// <summary>
    /// The completion percentage for an item (web <c>computeProgress</c>): the elapsed fraction of the mile interval,
    /// else the month interval, else the due-mileage ratio — each clamped to 0..100; 0 when no target is known.
    /// </summary>
    public static double ComputeProgress(MaintenanceItem item, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(item);

        if (item.IntervalMiles is { } miles and > 0 && item.LastServiceMileage is { } lastMiles)
        {
            double elapsed = item.CurrentMileage - lastMiles;
            return Clamp(elapsed / miles * 100.0);
        }

        if (item.IntervalMonths is { } months and > 0 && TryParseInstant(item.LastServiceDate, out var lastDate))
        {
            double intervalMs = months * DaysPerMonth * MillisPerDay;
            double elapsed = (now - lastDate).TotalMilliseconds;
            return intervalMs > 0 ? Clamp(elapsed / intervalMs * 100.0) : 0.0;
        }

        if (item.DueMileage is { } due and > 0)
        {
            return Clamp(item.CurrentMileage / due * 100.0);
        }

        return 0.0;
    }

    /// <summary>The derived status (web <c>derivedStatus</c>): completed items stay completed; otherwise from the progress percentage.</summary>
    public static string DerivedStatus(MaintenanceItem item, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(item);
        return string.Equals(item.Status, "completed", StringComparison.Ordinal)
            ? "completed"
            : StatusFromPercent(ComputeProgress(item, now));
    }

    private static MaintenanceItemCardDisplay ProjectItemCard(
        MaintenanceItem item,
        DateTimeOffset now,
        string dueLabel,
        string miUnit,
        string goodLabel,
        string dueSoonLabel,
        string overdueLabel,
        string completedLabel,
        ILocalizer localizer)
    {
        double pct = ComputeProgress(item, now);
        string derived = DerivedStatus(item, now);
        (StatusKind kind, string label) = BadgeFor(derived, goodLabel, dueSoonLabel, overdueLabel, completedLabel);
        bool showProgress = !string.Equals(derived, "completed", StringComparison.Ordinal);

        string dueText = string.Empty;
        if (!string.IsNullOrEmpty(item.DueDate))
        {
            dueText = $"{dueLabel}: {FormatDate(item.DueDate, now)}";
        }
        else if (item.DueMileage is { } due)
        {
            dueText = $"{dueLabel}: {FormatCount(due)} {miUnit}";
        }

        string mileageText = item.CurrentMileage > 0 ? $"{FormatCount(item.CurrentMileage)} {miUnit}" : string.Empty;
        string lastServiceText = !string.IsNullOrEmpty(item.LastServiceDate) ? FormatDate(item.LastServiceDate, now) : string.Empty;

        return new MaintenanceItemCardDisplay(
            Id: item.Id,
            CategoryLabel: Capitalize(item.Category, localizer),
            CategoryAccentBrushKey: CategoryColor(item.Category),
            StatusLabel: label,
            StatusKind: kind,
            Name: item.Name,
            Description: item.Description,
            ShowProgress: showProgress,
            ProgressFraction: Math.Min(pct, 100.0) / 100.0,
            ProgressPercentText: $"{FormatCount(pct)}%",
            ProgressColorBrushKey: ProgressColor(pct),
            DueText: dueText,
            HasDue: !string.IsNullOrEmpty(dueText),
            MileageText: mileageText,
            HasMileage: !string.IsNullOrEmpty(mileageText),
            LastServiceText: lastServiceText,
            HasLastService: !string.IsNullOrEmpty(lastServiceText));
    }

    private static List<MaintenanceProjectionRow> BuildProjections(
        IReadOnlyList<MaintenanceItem> items,
        DateTimeOffset now,
        string miUnit,
        string goodLabel,
        string dueSoonLabel,
        string overdueLabel,
        string completedLabel)
    {
        var candidates = new List<(MaintenanceItem Item, double? MilesRemaining, string? DueDate)>();
        foreach (var item in items)
        {
            bool hasInterval = (item.IntervalMiles is > 0) || (item.IntervalMonths is > 0);
            if (string.Equals(item.Status, "completed", StringComparison.Ordinal) || !hasInterval)
            {
                continue;
            }

            double? milesRemaining = item.DueMileage is { } due ? Math.Max(due - item.CurrentMileage, 0.0) : null;
            string? dueDate = !string.IsNullOrEmpty(item.DueDate) ? FormatDate(item.DueDate, now) : null;
            candidates.Add((item, milesRemaining, dueDate));
        }

        candidates.Sort((a, b) =>
        {
            bool aOverdue = string.Equals(a.Item.Status, "overdue", StringComparison.Ordinal);
            bool bOverdue = string.Equals(b.Item.Status, "overdue", StringComparison.Ordinal);
            if (aOverdue && !bOverdue)
            {
                return -1;
            }

            if (bOverdue && !aOverdue)
            {
                return 1;
            }

            double am = a.MilesRemaining ?? double.PositiveInfinity;
            double bm = b.MilesRemaining ?? double.PositiveInfinity;
            return am.CompareTo(bm);
        });

        var rows = new List<MaintenanceProjectionRow>();
        foreach (var candidate in candidates)
        {
            if (rows.Count >= MaxProjections)
            {
                break;
            }

            var parts = new List<string>(2);
            if (candidate.MilesRemaining is { } miles)
            {
                parts.Add($"{FormatCount(miles)} {miUnit}");
            }

            if (!string.IsNullOrEmpty(candidate.DueDate))
            {
                parts.Add(candidate.DueDate!);
            }

            (StatusKind kind, string label) = BadgeFor(candidate.Item.Status, goodLabel, dueSoonLabel, overdueLabel, completedLabel);
            rows.Add(new MaintenanceProjectionRow(
                Name: candidate.Item.Name,
                DetailText: string.Join("  ", parts),
                HasDetail: parts.Count > 0,
                BadgeLabel: label,
                BadgeStatus: kind));
        }

        return rows;
    }

    private static MaintenanceSummary Summarize(IReadOnlyList<MaintenanceItem> items)
    {
        int soon = 0, overdue = 0, completed = 0;
        foreach (var item in items)
        {
            switch (item.Status)
            {
                case "soon":
                    soon++;
                    break;
                case "overdue":
                    overdue++;
                    break;
                case "completed":
                    completed++;
                    break;
                default:
                    break;
            }
        }

        return new MaintenanceSummary(items.Count, soon, overdue, completed);
    }

    private static MaintenanceCostStats? ComputeCostStats(IReadOnlyList<MaintenanceServiceRecord> records)
    {
        if (records.Count == 0)
        {
            return null;
        }

        double totalCost = 0;
        var times = new List<double>(records.Count);
        foreach (var record in records)
        {
            totalCost += record.Cost;
            if (TryParseInstant(record.Date, out var value))
            {
                times.Add(value.ToUnixTimeMilliseconds());
            }
        }

        if (times.Count < 2)
        {
            return new MaintenanceCostStats(totalCost, totalCost, totalCost / records.Count);
        }

        double spanYears = Math.Max((times.Max() - times.Min()) / MillisPerYear, 0.1);
        return new MaintenanceCostStats(totalCost, totalCost / spanYears, totalCost / records.Count);
    }

    private static List<MaintenanceItem> FilterAndSort(IReadOnlyList<MaintenanceItem> items, string categoryFilter, string sortBy)
    {
        var result = new List<MaintenanceItem>();
        foreach (var item in items)
        {
            if (string.Equals(categoryFilter, AllCategories, StringComparison.Ordinal) ||
                string.Equals(item.Category, categoryFilter, StringComparison.Ordinal))
            {
                result.Add(item);
            }
        }

        result.Sort((a, b) => sortBy switch
        {
            "name" => string.Compare(a.Name, b.Name, StringComparison.OrdinalIgnoreCase),
            "due_date" => DueDateOrder(a).CompareTo(DueDateOrder(b)),
            "category" => string.Compare(a.Category, b.Category, StringComparison.OrdinalIgnoreCase),
            _ => StatusOrder(a.Status).CompareTo(StatusOrder(b.Status)),
        });

        return result;
    }

    private static double DueDateOrder(MaintenanceItem item) =>
        TryParseInstant(item.DueDate, out var value) ? value.ToUnixTimeMilliseconds() : double.PositiveInfinity;

    private static int StatusOrder(string status) => status switch
    {
        "overdue" => 0,
        "soon" => 1,
        "good" => 2,
        "completed" => 3,
        _ => 4,
    };

    private static List<MaintenanceOption> BuildCategoryOptions(IReadOnlyList<MaintenanceItem> items, string selected, ILocalizer localizer)
    {
        var categories = new SortedSet<string>(StringComparer.Ordinal);
        foreach (var item in items)
        {
            if (!string.IsNullOrEmpty(item.Category))
            {
                categories.Add(item.Category);
            }
        }

        var options = new List<MaintenanceOption>
        {
            new(AllCategories, localizer.GetString("All Categories", "All Categories"), selected == AllCategories),
        };

        foreach (var category in categories)
        {
            options.Add(new MaintenanceOption(category, Capitalize(category, localizer), category == selected));
        }

        return options;
    }

    private static List<MaintenanceOption> BuildSortOptions(string selected, ILocalizer localizer)
    {
        var options = new List<MaintenanceOption>(SortChoices.Count);
        foreach (var choice in SortChoices)
        {
            options.Add(new MaintenanceOption(choice, SortLabel(choice, localizer), choice == selected));
        }

        return options;
    }

    private static string SortLabel(string choice, ILocalizer localizer) => choice switch
    {
        "name" => localizer.GetString("Name", "Name"),
        "due_date" => localizer.GetString("Due Date", "Due Date"),
        "category" => localizer.GetString("Category", "Category"),
        _ => localizer.GetString("Status", "Status"),
    };

    private static (StatusKind Kind, string Label) BadgeFor(
        string status,
        string goodLabel,
        string dueSoonLabel,
        string overdueLabel,
        string completedLabel) => status switch
        {
            "soon" => (StatusKind.Warning, dueSoonLabel),
            "overdue" => (StatusKind.Danger, overdueLabel),
            "completed" => (StatusKind.Info, completedLabel),
            _ => (StatusKind.Success, goodLabel),
        };

    private static string StatusFromPercent(double pct) => pct switch
    {
        >= 90 => "overdue",
        >= 70 => "soon",
        _ => "good",
    };

    private static string CategoryColor(string category) => category switch
    {
        "tires" or "wipers" => AccentCyan,
        "brakes" => AccentRed,
        "battery" => AccentGreen,
        "filters" or "alignment" => AccentAmber,
        "fluids" => AccentPurple,
        _ => "TsColorTextSecondaryBrush",
    };

    private static string ProgressColor(double pct) => pct switch
    {
        >= 90 => AccentRed,
        >= 70 => AccentAmber,
        _ => AccentGreen,
    };

    private static string Capitalize(string value, ILocalizer localizer)
    {
        if (string.IsNullOrEmpty(value))
        {
            return localizer.GetString("general", "General");
        }

        return char.ToUpperInvariant(value[0]) + value[1..];
    }

    private static double Clamp(double value) => Math.Min(100.0, Math.Max(0.0, value));

    private static bool TryParseInstant(string? raw, out DateTimeOffset value)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            value = default;
            return false;
        }

        return DateTimeOffset.TryParse(
            raw,
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out value);
    }

    private readonly record struct MaintenanceSummary(int Total, int Soon, int Overdue, int Completed);

    private readonly record struct MaintenanceCostStats(double TotalCost, double AnnualCost, double AvgPerService);
}

/// <summary>
/// Canonical metadata for the <c>MaintenancePage</c> feature surface — the native mirror of the web page at
/// <c>web/src/features/vehicle-systems/pages/MaintenancePage.tsx</c> (route <c>/maintenance</c>, nav name
/// <c>Maintenance</c>).
/// </summary>
public static class MaintenanceRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "MaintenancePage";

    /// <summary>The navigation route name this page registers under (see RouteTable <c>Maintenance</c>).</summary>
    public const string RouteName = "Maintenance";

    /// <summary>The generated OpenAPI operation id for the maintenance items query (web <c>/maintenance</c>).</summary>
    public const string ItemsOperation = "get_api_v1_maintenance";

    /// <summary>The generated OpenAPI operation id for the service records query (web <c>/maintenance/records</c>).</summary>
    public const string RecordsOperation = "get_api_v1_maintenance_records";

    /// <summary>The Segoe Fluent Icons glyph for the item-grid empty state (web <c>Wrench</c> icon).</summary>
    public const string WrenchGlyph = "\uE90F"; // Repair / wrench

    /// <summary>The localized page title (web <c>t('Maintenance')</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("Maintenance", "Maintenance");
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>MaintenancePage</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never an item name, provider or count — so a
/// diagnostics line can never leak fleet content. Thread-safe.
/// </summary>
public sealed class MaintenanceDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public MaintenanceDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=MaintenancePage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={MaintenanceRegistration.Slug}");
    }
}

/// <summary>
/// Null-tolerant readers for the snake_case maintenance JSON wire shape. Internal to the vehicle-systems feature
/// namespace and UI-free so the projection round-trips the wire shape losslessly without a UI host.
/// </summary>
internal static class JsonReadHelpers
{
    public static string? Str(JsonElement o, string name) =>
        o.ValueKind == JsonValueKind.Object && o.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String
            ? v.GetString()
            : null;

    public static long? Long(JsonElement o, string name)
    {
        if (o.ValueKind != JsonValueKind.Object || !o.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetInt64(out var l) => l,
            JsonValueKind.Number when v.TryGetDouble(out var d) => (long)d,
            JsonValueKind.String when long.TryParse(v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var s) => s,
            _ => null,
        };
    }

    public static double? Double(JsonElement o, string name)
    {
        if (o.ValueKind != JsonValueKind.Object || !o.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetDouble(out var d) => d,
            JsonValueKind.String when double.TryParse(v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var s) => s,
            _ => null,
        };
    }
}
