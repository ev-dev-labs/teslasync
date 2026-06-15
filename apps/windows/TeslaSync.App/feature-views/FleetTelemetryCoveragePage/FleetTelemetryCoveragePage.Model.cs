using System.Linq;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// The mutually-exclusive lifecycle state of the <c>FleetTelemetryCoveragePage</c> surface — the native mirror of the
/// data states the web page renders (web/src/features/admin/pages/FleetTelemetryCoveragePage.tsx). The web page runs the
/// <c>useFleetTelemetryCoverage</c> query and renders, in precedence order, the spinner (web <c>query.isLoading</c>),
/// the generic failure panel (web <c>error</c>), the "no categories" / "filter matched nothing" empty states (web
/// <c>categories.length === 0</c> / <c>filteredCategories.length === 0</c>) and otherwise the per-category sections.
/// This enum is the top-level summary the ledger / Narrator key off; the always-visible header, stat tiles, legend,
/// destination and filter panels render in every state, gated by the projected flags.
/// </summary>
public enum FleetTelemetryCoverageState
{
    /// <summary>The coverage query is in flight (web <c>query.isLoading</c>) — the spinner is shown.</summary>
    Loading,

    /// <summary>The query resolved with no categories, or the active filter matched none (web empty / filter-empty).</summary>
    Empty,

    /// <summary>The query produced one or more matching categories (web category sections render).</summary>
    Success,

    /// <summary>The query failed (web <c>error</c>) — the failure panel is shown; the header Refresh is the retry.</summary>
    Error,
}

/// <summary>
/// One routed field within a category — the native mirror of the web <c>FleetTelemetryFieldCoverage</c>
/// (web/src/api/types.ts): the Tesla <see cref="Field"/>, the <see cref="Destination"/> table it lands in, the optional
/// <see cref="Column"/> it maps to, whether it is ALSO mirrored to <c>signal_log</c> (<see cref="AlsoSignalLog"/>), and
/// whether it is currently <see cref="Subscribed"/>. Field names mirror the Go API's snake_case JSON tags; parsing is
/// null-tolerant. Pure data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
public sealed record FleetTelemetryFieldCoverage(
    string Field,
    string Destination,
    string? Column,
    bool AlsoSignalLog,
    bool Subscribed)
{
    /// <summary>Read one field from a JSON object, tolerating missing / null fields.</summary>
    public static FleetTelemetryFieldCoverage FromJson(JsonElement o)
    {
        if (o.ValueKind != JsonValueKind.Object)
        {
            return new FleetTelemetryFieldCoverage(string.Empty, string.Empty, null, false, false);
        }

        return new FleetTelemetryFieldCoverage(
            Field: JsonReadHelpers.Str(o, "field") ?? string.Empty,
            Destination: JsonReadHelpers.Str(o, "destination") ?? string.Empty,
            Column: JsonReadHelpers.Str(o, "column"),
            AlsoSignalLog: JsonReadHelpers.Bool(o, "also_signal_log") ?? false,
            Subscribed: JsonReadHelpers.Bool(o, "subscribed") ?? false);
    }
}

/// <summary>
/// One category bucket in the coverage response — the native mirror of the web <c>FleetTelemetryCategoryCoverage</c>:
/// the <see cref="Category"/> name, its <see cref="TotalFields"/> count, a per-<see cref="Destinations"/> field-count
/// breakdown, and the individual <see cref="Fields"/> routed under it. Pure data; parsing is null-tolerant.
/// </summary>
public sealed record FleetTelemetryCategoryCoverage(
    string Category,
    long TotalFields,
    IReadOnlyDictionary<string, long> Destinations,
    IReadOnlyList<FleetTelemetryFieldCoverage> Fields)
{
    /// <summary>Read one category from a JSON object, tolerating missing / null fields.</summary>
    public static FleetTelemetryCategoryCoverage FromJson(JsonElement o)
    {
        if (o.ValueKind != JsonValueKind.Object)
        {
            return new FleetTelemetryCategoryCoverage(
                string.Empty,
                0,
                new Dictionary<string, long>(StringComparer.Ordinal),
                Array.Empty<FleetTelemetryFieldCoverage>());
        }

        var fields = new List<FleetTelemetryFieldCoverage>();
        if (o.TryGetProperty("fields", out var f) && f.ValueKind == JsonValueKind.Array)
        {
            foreach (var element in f.EnumerateArray())
            {
                fields.Add(FleetTelemetryFieldCoverage.FromJson(element));
            }
        }

        return new FleetTelemetryCategoryCoverage(
            Category: JsonReadHelpers.Str(o, "category") ?? string.Empty,
            TotalFields: JsonReadHelpers.Long(o, "total_fields") ?? 0,
            Destinations: JsonReadHelpers.LongMap(o, "destinations"),
            Fields: fields);
    }
}

/// <summary>
/// The normalized, consumer-facing coverage snapshot — the native mirror of the web hook's queryFn return shape after
/// its <c>?? []</c> / <c>?? {}</c> defaulting (web <c>useFleetTelemetryCoverage</c>). Every collection is guaranteed
/// non-null so the view can iterate without a null guard. <see cref="DestinationTotals"/> counts dual-written fields
/// under both their primary destination AND <c>signal_log</c>, matching the runtime fan-out. Pure data; parsing is
/// null-tolerant (a non-object payload yields <see cref="Empty"/>).
/// </summary>
public sealed record FleetTelemetryCoverageSnapshot(
    IReadOnlyList<FleetTelemetryCategoryCoverage> Categories,
    IReadOnlyDictionary<string, long> DestinationTotals,
    IReadOnlyList<string> OrphanFields)
{
    /// <summary>The empty snapshot (no routing data) — the default local-state feed result.</summary>
    public static FleetTelemetryCoverageSnapshot Empty { get; } = new(
        Array.Empty<FleetTelemetryCategoryCoverage>(),
        new Dictionary<string, long>(StringComparer.Ordinal),
        Array.Empty<string>());

    /// <summary>
    /// Read the coverage envelope from JSON, reproducing the web <c>?? []</c> / <c>?? {}</c> coalescing: a missing or
    /// <c>null</c> <c>categories</c> / <c>destination_totals</c> / <c>orphan_fields</c> each default to empty.
    /// </summary>
    public static FleetTelemetryCoverageSnapshot FromJson(JsonElement o)
    {
        if (o.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        var categories = new List<FleetTelemetryCategoryCoverage>();
        if (o.TryGetProperty("categories", out var c) && c.ValueKind == JsonValueKind.Array)
        {
            foreach (var element in c.EnumerateArray())
            {
                categories.Add(FleetTelemetryCategoryCoverage.FromJson(element));
            }
        }

        var orphans = new List<string>();
        if (o.TryGetProperty("orphan_fields", out var orphanEl) && orphanEl.ValueKind == JsonValueKind.Array)
        {
            foreach (var element in orphanEl.EnumerateArray())
            {
                if (element.ValueKind == JsonValueKind.String)
                {
                    orphans.Add(element.GetString() ?? string.Empty);
                }
            }
        }

        return new FleetTelemetryCoverageSnapshot(
            Categories: categories,
            DestinationTotals: JsonReadHelpers.LongMap(o, "destination_totals"),
            OrphanFields: orphans);
    }
}

/// <summary>
/// The data port the <see cref="FleetTelemetryCoveragePageViewModel"/> reads the routing snapshot through — the native
/// parity of the web <c>useFleetTelemetryCoverage</c> hook (GET /tesla/fleet-telemetry/coverage). The view never
/// performs HTTP itself; the default <see cref="EmptyFleetTelemetryCoverageFeed"/> resolves to the empty state, and the
/// generated-client-backed <see cref="FleetTelemetryCoverageClientFeed"/> binds to the generated OpenAPI contract
/// client (ADR-004). A failing fetch throws so the view-model can surface the generic failure branch.
/// </summary>
public interface IFleetTelemetryCoverageFeed
{
    /// <summary>Resolve the coverage snapshot (web <c>useFleetTelemetryCoverage</c>).</summary>
    Task<FleetTelemetryCoverageSnapshot> FetchAsync(CancellationToken cancellationToken);
}

/// <summary>The default feed — resolves every fetch to the empty snapshot (the empty data state).</summary>
public sealed class EmptyFleetTelemetryCoverageFeed : IFleetTelemetryCoverageFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyFleetTelemetryCoverageFeed Instance { get; } = new();

    private EmptyFleetTelemetryCoverageFeed()
    {
    }

    /// <inheritdoc />
    public Task<FleetTelemetryCoverageSnapshot> FetchAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(FleetTelemetryCoverageSnapshot.Empty);
    }
}

/// <summary>
/// The render-time data model the <c>FleetTelemetryCoveragePage</c> projects from — the native analogue of the web
/// page's resolved query state plus the client-side filter (web <c>filter</c> useState). Pure data so the projection is
/// unit-tested without a UI host.
/// </summary>
/// <param name="Snapshot">The normalized coverage snapshot (web <c>query.data</c>).</param>
/// <param name="Loading">Whether the query is in flight with no data yet (web <c>query.isLoading</c>).</param>
/// <param name="HasError">Whether the query failed (web <c>error</c>).</param>
/// <param name="ErrorDetail">Optional failure detail appended to the error surface.</param>
/// <param name="Filter">The active client-side filter text (web <c>filter</c>).</param>
public sealed record FleetTelemetryCoverageModel(
    FleetTelemetryCoverageSnapshot Snapshot,
    bool Loading,
    bool HasError,
    string? ErrorDetail,
    string Filter)
{
    /// <summary>The initial model — the first load, no data yet, no filter.</summary>
    public static FleetTelemetryCoverageModel Initial { get; } = new(
        FleetTelemetryCoverageSnapshot.Empty,
        Loading: true,
        HasError: false,
        ErrorDetail: null,
        Filter: string.Empty);
}

/// <summary>
/// One projected, render-ready destination chip (web <c>Badge</c> in the destination breakdown / per-category header):
/// the pre-formatted "<c>dest: count</c>" <see cref="Label"/> and the semantic <see cref="Tone"/> the badge tints to.
/// </summary>
public sealed record CoverageDestinationChip(string Label, StatusKind Tone);

/// <summary>
/// One projected, render-ready per-field table row (web <c>buildFieldColumns</c> render output): the mono
/// <see cref="Field"/>, the <see cref="Destination"/> badge text, the <see cref="ColumnText"/> (the column or its
/// em-dash fallback), the dual-write flag + its <see cref="DualWriteText"/> badge label, and the subscribed flag + its
/// <see cref="SubscribedText"/> badge label. <see cref="RowKey"/> mirrors the web <c>keyExtractor</c>.
/// </summary>
public sealed record CoverageFieldRowDisplay(
    string Field,
    string Destination,
    bool HasColumn,
    string ColumnText,
    bool AlsoSignalLog,
    string DualWriteText,
    bool Subscribed,
    string SubscribedText,
    string RowKey);

/// <summary>
/// One projected, render-ready category section (web <c>CategorySection</c>): the <see cref="Category"/> name, the
/// "<c>N routed fields</c>" <see cref="TotalFieldsCaption"/>, the per-category <see cref="DestinationChips"/>, and either
/// the filtered <see cref="Fields"/> rows or the <see cref="EmptyFieldsText"/> shown when none match. Pure data.
/// </summary>
public sealed record CoverageCategoryDisplay(
    string Category,
    string TotalFieldsCaption,
    IReadOnlyList<CoverageDestinationChip> DestinationChips,
    bool HasFields,
    string EmptyFieldsText,
    IReadOnlyList<CoverageFieldRowDisplay> Fields,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the page for one input model — everything the WinUI view binds to, with
/// every visible literal already resolved through the i18n facade and every count formatted at the display boundary.
/// Holds the always-visible page header + Refresh, the five summary stat tiles, the legend / destination / filter
/// panels, the conditional orphan-fields panel, and the bottom data-state region (loading / error / empty / the
/// per-category sections). Pure data so every branch is asserted headlessly.
/// </summary>
public sealed record FleetTelemetryCoverageDisplay(
    FleetTelemetryCoverageState State,
    string Title,
    string Subtitle,
    string RefreshLabel,
    string StatCategoriesLabel,
    string StatCategoriesValue,
    string StatRoutedFieldsLabel,
    string StatRoutedFieldsValue,
    string StatSubscribedLabel,
    string StatSubscribedValue,
    string StatRoutedNotSubscribedLabel,
    string StatRoutedNotSubscribedValue,
    string StatOrphansLabel,
    string StatOrphansValue,
    string LegendTitle,
    string LegendIntro,
    string LegendColumnLabel,
    string LegendColumnHelp,
    string LegendDualWriteLabel,
    string LegendDualWriteHelp,
    string LegendSubscribedLabel,
    string LegendSubscribedHelp,
    string DestinationsTitle,
    string DestinationsHelp,
    bool HasDestinations,
    string DestinationsEmptyText,
    IReadOnlyList<CoverageDestinationChip> DestinationChips,
    bool ShowOrphans,
    string OrphansTitle,
    string OrphansHelp,
    IReadOnlyList<string> Orphans,
    string FilterHint,
    string ColumnFieldHeader,
    string ColumnDestinationHeader,
    string ColumnColumnHeader,
    string ColumnDualWriteHeader,
    string ColumnSubscribedHeader,
    bool ShowLoading,
    string LoadingText,
    bool ShowError,
    string ErrorText,
    bool ShowEmpty,
    string EmptyText,
    bool ShowCategories,
    IReadOnlyList<CoverageCategoryDisplay> Categories,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="FleetTelemetryCoverageModel"/> to its <see cref="FleetTelemetryCoverageDisplay"/> —
/// the native port of the render logic in web/src/features/admin/pages/FleetTelemetryCoveragePage.tsx. Every visible
/// literal resolves through the i18n facade using the exact web key names; counts format through
/// <see cref="NumberFormatting"/> (the web <c>fmtInt</c>). All 37 chrome strings are resolved on every projection
/// (visibility is gated by the returned flags), so the i18n contract holds in every data state. No WinUI types —
/// unit-tested without a UI host.
/// </summary>
public static class FleetTelemetryCoverageProjection
{
    /// <summary>Em-dash fallback shared with the web <c>'—'</c> literals.</summary>
    public const string EmDash = "\u2014";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the resolved web query state + filter).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static FleetTelemetryCoverageDisplay Project(FleetTelemetryCoverageModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        // ── Page header (web PageContainer title + subtitle + Refresh action) ───────────────────────────────
        string title = localizer.GetString("coverage.pageTitle", "Fleet Telemetry Coverage");
        string subtitle = localizer.GetString(
            "coverage.subtitle",
            "Package-derived snapshot of which Tesla proto fields the build routes and which the current subscription pushes. Sourced from routing.yaml and teslaconfig.Builder \u2014 no per-vehicle telemetry counts.");
        string refreshLabel = localizer.GetString("coverage.refresh", "Refresh");

        // ── Summary stat tiles (web StatCards) ──────────────────────────────────────────────────────────────
        string statCategoriesLabel = localizer.GetString("coverage.stat.categories", "Categories");
        string statRoutedFieldsLabel = localizer.GetString("coverage.stat.routedFields", "Routed fields");
        string statSubscribedLabel = localizer.GetString("coverage.stat.subscribed", "Subscribed");
        string statRoutedNotSubscribedLabel = localizer.GetString("coverage.stat.routedNotSubscribed", "Routed, not subscribed");
        string statOrphansLabel = localizer.GetString("coverage.stat.orphans", "Orphan fields");

        // ── Legend panel (web "Reading this page") ──────────────────────────────────────────────────────────
        string legendTitle = localizer.GetString("coverage.legend.title", "Reading this page");
        string legendIntro = localizer.GetString(
            "coverage.legend.intro",
            "Each row is one Tesla telemetry field declared in routing.yaml. The dashes below mean \"not applicable\" for that field \u2014 they are expected, not missing data.");
        string legendColumnLabel = localizer.GetString("coverage.legend.columnLabel", "Column");
        string legendColumnHelp = localizer.GetString(
            "coverage.legend.columnHelp",
            "\u2014 the typed destination column. A dash means the field is stored in signal_log, a generic key/value table where the field name itself is the key \u2014 there is no per-field column.");
        string legendDualWriteLabel = localizer.GetString("coverage.legend.dualWriteLabel", "Dual write");
        string legendDualWriteHelp = localizer.GetString(
            "coverage.legend.dualWriteHelp",
            "\u2014 marks fields written to both their primary table AND signal_log (for replay and historical reconstruction). A dash means single-write only, which is the normal case.");
        string legendSubscribedLabel = localizer.GetString("coverage.legend.subscribedLabel", "Subscribed");
        string legendSubscribedHelp = localizer.GetString(
            "coverage.legend.subscribedHelp",
            "\u2014 whether Tesla Fleet Telemetry is currently pushing this field to us. \"No\" means the writer is wired but the subscription request omits the field.");

        // ── Destination breakdown panel ─────────────────────────────────────────────────────────────────────
        string destinationsTitle = localizer.GetString("coverage.destinations.title", "Destination breakdown");
        string destinationsHelp = localizer.GetString(
            "coverage.destinations.help",
            "Counts how many routed fields land in each storage destination. Fields routed with also_signal_log:true are counted under both their primary destination and signal_log, matching the runtime fan-out \u2014 totals may exceed the unique routed-fields count.");
        string destinationsEmpty = localizer.GetString("coverage.destinations.empty", "No destinations reported.");

        // ── Orphan-fields warning panel ─────────────────────────────────────────────────────────────────────
        string orphansTitle = localizer.GetString("coverage.orphans.title", "Orphan fields detected");
        string orphansHelp = localizer.GetString(
            "coverage.orphans.help",
            "These routing.yaml entries reference Field names not present in protomodel.SignalsByName and not a strict prefix-extension of a compound parent. This is a deployment drift between the vendored Tesla proto and routing.yaml \u2014 investigate before relying on the affected destinations.");

        // ── Filter panel + per-field table column headers ───────────────────────────────────────────────────
        string filterHint = localizer.GetString(
            "coverage.filter.placeholder", // parity:allow web i18n key name, not a stub marker
            "Filter by field name, destination, or column\u2026");
        string colField = localizer.GetString("coverage.col.field", "Field");
        string colDestination = localizer.GetString("coverage.col.destination", "Destination");
        string colColumn = localizer.GetString("coverage.col.column", "Column");
        string colDualWrite = localizer.GetString("coverage.col.dualWrite", "Dual write");
        string colSubscribed = localizer.GetString("coverage.col.subscribed", "Subscribed");

        // ── Per-row badge labels + per-category captions ────────────────────────────────────────────────────
        string dualWriteYes = localizer.GetString("coverage.dualWrite.yes", "signal_log");
        string subscribedYes = localizer.GetString("coverage.subscribed.yes", "yes");
        string subscribedNo = localizer.GetString("coverage.subscribed.no", "no");
        string totalFieldsTemplate = localizer.GetString("coverage.category.totalFields", "{{count}} routed fields");
        string categoryEmpty = localizer.GetString("coverage.category.empty", "This category has no routed fields.");
        string categoryNoMatch = localizer.GetString("coverage.category.noMatch", "No fields match the current filter.");

        // ── Bottom data-state strings ───────────────────────────────────────────────────────────────────────
        string loadingText = localizer.GetString("coverage.loading", "Loading routing snapshot\u2026");
        string errorBase = localizer.GetString(
            "coverage.error",
            "Could not load Fleet Telemetry coverage. Check API logs and try again.");
        string errorText = model.HasError && !string.IsNullOrEmpty(model.ErrorDetail)
            ? $"{errorBase} {model.ErrorDetail}"
            : errorBase;
        string emptyMessage = localizer.GetString(
            "coverage.empty",
            "No categories returned. The embedded routing.yaml may be empty or the loader failed silently.");
        string filterEmptyMessage = localizer.GetString(
            "coverage.filterEmpty",
            "No categories match the current filter.");

        // ── Summary stats (web summarise) ───────────────────────────────────────────────────────────────────
        var categories = model.Snapshot.Categories;
        long totalRoutedFields = 0;
        long subscribedFields = 0;
        foreach (var category in categories)
        {
            totalRoutedFields += category.Fields.Count;
            foreach (var field in category.Fields)
            {
                if (field.Subscribed)
                {
                    subscribedFields += 1;
                }
            }
        }

        long unsubscribedRoutedFields = totalRoutedFields - subscribedFields;
        var orphans = model.Snapshot.OrphanFields;

        // ── Destination breakdown (web sortedDestinations, desc by count) ───────────────────────────────────
        var destinationChips = SortDestinations(model.Snapshot.DestinationTotals, StatusKind.Info);
        bool hasDestinations = destinationChips.Count > 0;

        // ── Filter + per-category sections (web filteredCategories + CategorySection) ───────────────────────
        string query = model.Filter.Trim();
        var filtered = FilterCategories(categories, query);
        var categoryDisplays = filtered
            .Select(category => BuildCategory(
                category,
                query,
                totalFieldsTemplate,
                categoryEmpty,
                categoryNoMatch,
                dualWriteYes,
                subscribedYes,
                subscribedNo))
            .ToList();

        // ── State selection (web render precedence) ─────────────────────────────────────────────────────────
        bool showLoading = model.Loading;
        bool showError = !model.Loading && model.HasError;
        bool showEmpty = !model.Loading && !model.HasError && (categories.Count == 0 || filtered.Count == 0);
        bool showCategories = !model.Loading && !model.HasError && categories.Count > 0 && filtered.Count > 0;
        string emptyText = categories.Count == 0 ? emptyMessage : filterEmptyMessage;

        FleetTelemetryCoverageState state = showLoading
            ? FleetTelemetryCoverageState.Loading
            : showError
                ? FleetTelemetryCoverageState.Error
                : showCategories
                    ? FleetTelemetryCoverageState.Success
                    : FleetTelemetryCoverageState.Empty;

        return new FleetTelemetryCoverageDisplay(
            State: state,
            Title: title,
            Subtitle: subtitle,
            RefreshLabel: refreshLabel,
            StatCategoriesLabel: statCategoriesLabel,
            StatCategoriesValue: FormatCount(categories.Count),
            StatRoutedFieldsLabel: statRoutedFieldsLabel,
            StatRoutedFieldsValue: FormatCount(totalRoutedFields),
            StatSubscribedLabel: statSubscribedLabel,
            StatSubscribedValue: FormatCount(subscribedFields),
            StatRoutedNotSubscribedLabel: statRoutedNotSubscribedLabel,
            StatRoutedNotSubscribedValue: FormatCount(unsubscribedRoutedFields),
            StatOrphansLabel: statOrphansLabel,
            StatOrphansValue: FormatCount(orphans.Count),
            LegendTitle: legendTitle,
            LegendIntro: legendIntro,
            LegendColumnLabel: legendColumnLabel,
            LegendColumnHelp: legendColumnHelp,
            LegendDualWriteLabel: legendDualWriteLabel,
            LegendDualWriteHelp: legendDualWriteHelp,
            LegendSubscribedLabel: legendSubscribedLabel,
            LegendSubscribedHelp: legendSubscribedHelp,
            DestinationsTitle: destinationsTitle,
            DestinationsHelp: destinationsHelp,
            HasDestinations: hasDestinations,
            DestinationsEmptyText: destinationsEmpty,
            DestinationChips: destinationChips,
            ShowOrphans: orphans.Count > 0,
            OrphansTitle: orphansTitle,
            OrphansHelp: orphansHelp,
            Orphans: orphans,
            FilterHint: filterHint,
            ColumnFieldHeader: colField,
            ColumnDestinationHeader: colDestination,
            ColumnColumnHeader: colColumn,
            ColumnDualWriteHeader: colDualWrite,
            ColumnSubscribedHeader: colSubscribed,
            ShowLoading: showLoading,
            LoadingText: loadingText,
            ShowError: showError,
            ErrorText: errorText,
            ShowEmpty: showEmpty,
            EmptyText: emptyText,
            ShowCategories: showCategories,
            Categories: categoryDisplays,
            AutomationName: title);
    }

    /// <summary>Format a count with en-US grouping (web <c>fmtInt</c>).</summary>
    public static string FormatCount(long value) => NumberFormatting.Format(value, null, 0);

    // web: Object.entries(destinations).sort((a, b) => b[1] - a[1]). Counts equal → key ascending for determinism.
    private static List<CoverageDestinationChip> SortDestinations(
        IReadOnlyDictionary<string, long> destinations,
        StatusKind tone) =>
        destinations
            .OrderByDescending(entry => entry.Value)
            .ThenBy(entry => entry.Key, StringComparer.Ordinal)
            .Select(entry => new CoverageDestinationChip($"{entry.Key}: {FormatCount(entry.Value)}", tone))
            .ToList();

    // web filteredCategories: keep a category when its name matches OR any of its fields match (uses the full field set).
    private static IReadOnlyList<FleetTelemetryCategoryCoverage> FilterCategories(
        IReadOnlyList<FleetTelemetryCategoryCoverage> categories,
        string query)
    {
        if (query.Length == 0)
        {
            return categories;
        }

        return categories
            .Where(category =>
                category.Category.Contains(query, StringComparison.OrdinalIgnoreCase) ||
                category.Fields.Any(field => MatchesField(field, query)))
            .ToList();
    }

    // web CategorySection.filtered: a field matches when its field / destination / column contains the query.
    private static bool MatchesField(FleetTelemetryFieldCoverage field, string query) =>
        field.Field.Contains(query, StringComparison.OrdinalIgnoreCase) ||
        field.Destination.Contains(query, StringComparison.OrdinalIgnoreCase) ||
        (field.Column ?? string.Empty).Contains(query, StringComparison.OrdinalIgnoreCase);

    private static CoverageCategoryDisplay BuildCategory(
        FleetTelemetryCategoryCoverage category,
        string query,
        string totalFieldsTemplate,
        string categoryEmpty,
        string categoryNoMatch,
        string dualWriteYes,
        string subscribedYes,
        string subscribedNo)
    {
        var visibleFields = query.Length == 0
            ? category.Fields
            : category.Fields.Where(field => MatchesField(field, query)).ToList();

        var rows = visibleFields
            .Select(field => new CoverageFieldRowDisplay(
                Field: field.Field,
                Destination: field.Destination,
                HasColumn: !string.IsNullOrEmpty(field.Column),
                ColumnText: string.IsNullOrEmpty(field.Column) ? EmDash : field.Column!,
                AlsoSignalLog: field.AlsoSignalLog,
                DualWriteText: dualWriteYes,
                Subscribed: field.Subscribed,
                SubscribedText: field.Subscribed ? subscribedYes : subscribedNo,
                RowKey: $"{category.Category}:{field.Field}"))
            .ToList();

        // web: filtered.length === 0 ? noMatch text : DataTable. An unfiltered empty category uses the table's
        // emptyMessage (category.empty); a filtered-out one uses the category.noMatch copy.
        string emptyFieldsText = query.Length == 0 ? categoryEmpty : categoryNoMatch;

        return new CoverageCategoryDisplay(
            Category: category.Category,
            TotalFieldsCaption: totalFieldsTemplate.Replace("{{count}}", FormatCount(category.TotalFields), StringComparison.Ordinal),
            DestinationChips: SortDestinations(category.Destinations, StatusKind.Neutral),
            HasFields: rows.Count > 0,
            EmptyFieldsText: emptyFieldsText,
            Fields: rows,
            AutomationName: category.Category);
    }
}

/// <summary>
/// Canonical metadata for the <c>FleetTelemetryCoveragePage</c> feature surface — the native mirror of the web page at
/// <c>web/src/features/admin/pages/FleetTelemetryCoveragePage.tsx</c> (route <c>/admin/telemetry/coverage</c>, nav name
/// <c>FleetTelemetryCoverage</c>).
/// </summary>
public static class FleetTelemetryCoverageRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "FleetTelemetryCoveragePage";

    /// <summary>The navigation route name this page registers under (see RouteTable <c>FleetTelemetryCoverage</c>).</summary>
    public const string RouteName = "FleetTelemetryCoverage";

    /// <summary>The generated OpenAPI operation id for the coverage query (web <c>useFleetTelemetryCoverage</c>).</summary>
    public const string Operation = "get_api_v1_tesla_fleet_telemetry_coverage";

    /// <summary>The localized page title (web <c>coverage.pageTitle</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("coverage.pageTitle", "Fleet Telemetry Coverage");
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>FleetTelemetryCoveragePage</c> surface (P1/S11 diagnostics contract). Records only
/// the operational <c>view.opened</c> event with the surface slug — never a field / destination name or count — so a
/// diagnostics line can never leak routing content. Thread-safe.
/// </summary>
public sealed class FleetTelemetryCoverageDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public FleetTelemetryCoverageDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=FleetTelemetryCoveragePage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={FleetTelemetryCoverageRegistration.Slug}");
    }
}
