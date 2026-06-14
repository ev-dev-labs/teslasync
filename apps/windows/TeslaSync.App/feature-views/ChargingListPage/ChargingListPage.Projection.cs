using System.Globalization;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.SharedSurfaces;

namespace TeslaSync.App.FeatureViews.Charging;

/// <summary>
/// Pure projection from the parsed charging-session snapshot + lifecycle state + interactive filters to the
/// render-ready <see cref="ChargingListDisplay"/> — the native port of
/// web/src/features/charging/pages/ChargingListPage.tsx. It folds the sessions into the overview period stats
/// (with prior-period deltas), the four trend series, the eight collection pills, the searched / sorted / paged
/// date-grouped session rows, the anomaly callout, and the conditional analytical sections, performing every
/// SI→display conversion only here. Every visible literal resolves through the i18n facade with the web key names
/// and verbatim English defaults. No WinUI types, so it is compiled into the headless test project.
/// </summary>
public static class ChargingListProjection
{
    /// <summary>How many sessions the page fetches per request (web <c>useChargingSessionsPaginated({ limit: 500 })</c>).</summary>
    public const int FetchLimit = 500;

    /// <summary>How many session rows the list shows per display page (web <c>size</c> = 50).</summary>
    public const int DisplayPageSize = 50;

    /// <summary>Minimum sessions before the optimizer section renders its body (web <c>THRESHOLD_OPTIMIZER</c>).</summary>
    public const int ThresholdOptimizer = 10;

    /// <summary>Minimum sessions before the charger-specs section renders its body (web <c>THRESHOLD_SPECS</c>).</summary>
    public const int ThresholdSpecs = 5;

    /// <summary>Minimum sessions before the battery-distribution section renders its body (web <c>THRESHOLD_BATTERY_DIST</c>).</summary>
    public const int ThresholdBatteryDist = 5;

    private const string CyanBrush = "TsChartSpeedBrush";
    private const string GreenBrush = "TsChartBatteryBrush";
    private const string RedBrush = "TsColorDangerBrush";
    private const string PurpleBrush = "TsChartPowerBrush";
    private const string BlueBrush = "TsColorAccentBrush";
    private const string AmberBrush = "TsColorWarningBrush";

    private const string EmDash = "\u2014";
    private const string Dot = "\u00B7";
    private const char DotChar = '\u00B7';

    /// <summary>Project the snapshot for the supplied state + filters + units into the render-ready display model.</summary>
    /// <param name="sessions">The parsed session snapshot (server order).</param>
    /// <param name="state">The resolved lifecycle state.</param>
    /// <param name="filters">The interactive URL/selection state.</param>
    /// <param name="units">The user's unit preference (web <c>unitPrefs</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="currencySymbol">The active currency symbol (web <c>currencySymbol</c>).</param>
    /// <param name="now">The clock used for default-range fallbacks.</param>
    /// <returns>The render-ready display model.</returns>
    public static ChargingListDisplay Project(
        IReadOnlyList<ChargingListSession> sessions,
        ChargingListState state,
        ChargingListFilters filters,
        UnitPref units,
        ILocalizer localizer,
        string currencySymbol,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(sessions);
        ArgumentNullException.ThrowIfNull(filters);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        var symbol = string.IsNullOrEmpty(currencySymbol) ? "$" : currencySymbol;

        var dateFiltered = sessions.Where(s => ChargingAggregation.InDateRange(s, filters.StartDate, filters.EndDate)).ToList();
        var currentStats = ChargingAggregation.ComputeChargingPeriodStats(dateFiltered, null, null);
        var priorRange = ChargingAggregation.PriorPeriod(filters.StartDate, filters.EndDate);
        var priorStats = priorRange is { } pr
            ? ChargingAggregation.ComputeChargingPeriodStats(sessions, pr.Start, pr.End)
            : null;

        var anomalies = ChargingAggregation.DetectChargingAnomalies(dateFiltered, symbol);
        var anomalyById = anomalies.ToDictionary(a => a.Session.Id, a => a.Message);
        var notable = ChargingAggregation.DetectNotableSessions(dateFiltered);

        var home = dateFiltered.Where(s => ChargingAggregation.GetChargerCategory(s.ChargerType) == ChargerCategory.Home).ToList();
        var sc = dateFiltered.Where(s => ChargingAggregation.GetChargerCategory(s.ChargerType) == ChargerCategory.Supercharger).ToList();
        var dc = dateFiltered.Where(s => ChargingAggregation.GetChargerCategory(s.ChargerType) == ChargerCategory.Dc).ToList();
        var free = dateFiltered.Where(s => s.CostDecimal is null || s.CostDecimal == 0).ToList();

        IReadOnlyList<ChargingListSession> collectionFiltered = CollectionFilter(dateFiltered, filters.Collection, symbol);

        var tokens = ChargingSearch.Parse(filters.Search);
        var filtered = tokens.Count == 0
            ? collectionFiltered
            : collectionFiltered.Where(s => ChargingSearch.Matches(s, tokens)).ToList();

        var sorted = SortSessions(filtered, filters.SortField, filters.SortDescending);

        int page = Math.Max(1, filters.Page);
        int totalRows = sorted.Count;
        int maxPage = Math.Max(1, (int)Math.Ceiling(totalRows / (double)DisplayPageSize));
        page = Math.Min(page, maxPage);
        var paginated = sorted.Skip((page - 1) * DisplayPageSize).Take(DisplayPageSize).ToList();

        var groups = BuildGroups(paginated, anomalyById, filters, units, symbol, localizer);

        var trendSeries = new Dictionary<string, IReadOnlyList<MetricPoint>>(StringComparer.Ordinal)
        {
            ["sessions"] = ChargingAggregation.DailyChargingTrend(dateFiltered, "sessions"),
            ["energy"] = ChargingAggregation.DailyChargingTrend(dateFiltered, "energy"),
            ["cost"] = ChargingAggregation.DailyChargingTrend(dateFiltered, "cost"),
            ["power"] = ChargingAggregation.DailyChargingTrend(dateFiltered, "power"),
        };

        var trendMetrics = BuildTrendMetrics(localizer);
        var collectionLabel = CollectionLabel(filters.Collection, localizer);
        var grade = BatteryGrade(currentStats.BatteryFriendlyScore);
        var periodLabel = string.Create(
            CultureInfo.InvariantCulture,
            $"{FormatDayKey(filters.StartDate, longStyle: true)} \u2013 {FormatDayKey(filters.EndDate, longStyle: true)}");

        var results = Interpolate(localizer.GetString("charging.results", "results"), ("count", FmtCompact(totalRows, 1000)));
        var resultsLabel = string.Create(CultureInfo.InvariantCulture, $"{FmtCompact(totalRows, 1000)} {localizer.GetString("charging.results", "results")}");

        return new ChargingListDisplay
        {
            State = state,
            Title = localizer.GetString("charging.list.title", "Charging Sessions"),
            Subtitle = localizer.GetString("charging.list.subtitle", "Cost, charger type, energy patterns, and battery-friendly scoring"),
            StickyAria = localizer.GetString("charging.stickyBar.aria", "Charging summary"),
            StickySummary = BuildStickySummary(localizer, periodLabel, collectionLabel, totalRows, grade),
            SearchPrompt = localizer.GetString("charging.searchPlaceholder", "Search charging — try \"charger:home\", \"cost:>5\", \"kwh:>20\", \"Costco\""), // parity:allow charging.searchPlaceholder is a required web i18n key name
            FilterPendingLabel = localizer.GetString("filter.pending", "Filtering\u2026"),
            FilterSearchLabel = localizer.GetString("charging.filterLabel.search", "Search"),
            FilterCollectionLabel = localizer.GetString("charging.filterLabel.collection", "View"),
            HasStats = currentStats.Count > 0,
            OverviewTitle = localizer.GetString("charging.overview", "Overview"),
            PeriodLabel = periodLabel,
            PriorLabel = BuildPriorLabel(localizer, priorRange, priorStats),
            KpiCards = BuildKpiCards(currentStats, priorStats, symbol, localizer),
            SecondaryLine = BuildSecondaryLine(localizer, currentStats, grade),
            NoStatsMessage = localizer.GetString("charging.noStatsRange", "No charging sessions in this range"),
            AnomalyCallout = BuildAnomalyCallout(localizer, anomalies.Count, filters.Collection),
            ViewAnomaliesLabel = localizer.GetString("charging.viewAnomalies", "View anomalies"),
            HasAnomalyCallout = anomalies.Count > 0 && filters.Collection != ChargingCollectionKind.Anomalies,
            TrendTitle = localizer.GetString("charging.overTime", "Charging over time"),
            TrendAria = localizer.GetString("charging.overTime.aria", "Charging over time chart with metric switcher"),
            TrendEmpty = localizer.GetString("charging.overTime.empty", "No data for this metric in the selected range"),
            TrendMetrics = trendMetrics,
            TrendSeries = trendSeries,
            TrendActiveKey = ResolveTrendKey(filters.TrendMetric),
            CollectionsAria = localizer.GetString("charging.collections.aria", "Filter charging sessions by collection"),
            CollectionOptions = BuildCollectionOptions(localizer, dateFiltered.Count, home.Count, sc.Count, dc.Count, free.Count, anomalies.Count, notable.Count),
            ActiveCollection = CollectionValue(filters.Collection),
            SortOptions = BuildSortOptions(localizer),
            ActiveSort = SortValue(filters.SortField),
            ListHeading = localizer.GetString("charging.allSessions", "All sessions"),
            Groups = groups,
            HasRows = groups.Count > 0,
            EmptyForCollectionTitle = localizer.GetString("charging.emptyForCollection", "No sessions in this view"),
            EmptyForCollectionMessage = localizer.GetString("charging.emptyForCollection.msg", "Try a different collection or clear your filters."),
            TotalRowCount = totalRows,
            ResultsLabel = resultsLabel,
            Page = page,
            PageSize = DisplayPageSize,
            Sections = BuildSections(localizer, dateFiltered),
            BulkDeleteLabel = localizer.GetString("bulk.actions.delete", "Delete"),
            BulkConfirmTitle = BuildBulkConfirmTitle(localizer, filters.SelectedIds.Count),
            BulkConfirmDescription = localizer.GetString("bulk.deleteConfirmDescription", "This cannot be undone."),
            CommonDeleteLabel = localizer.GetString("common.delete", "Delete"),
            SelectedCount = filters.SelectedIds.Count,
            EmptyTitle = localizer.GetString("charging.emptyTitle", "No charging sessions yet"),
            EmptyMessage = localizer.GetString("charging.emptyMessage", "Charging sessions will appear here once your vehicle starts charging."),
            EmptyCta = localizer.GetString("charging.empty.cta", "Learn about charging"),
            NoDataLabel = localizer.GetString("common.noData", "No data"),
        };
    }

    /// <summary>
    /// Apply the active date / collection / search / sort filters to the snapshot — the export-path twin of the
    /// list folding inside <see cref="Project"/> (web <c>sortedSessions</c>). Used by the CSV / JSON export so the
    /// downloaded rows match exactly what the list shows.
    /// </summary>
    /// <param name="sessions">The full session snapshot.</param>
    /// <param name="filters">The active filters.</param>
    /// <param name="currencySymbol">The active currency symbol (drives anomaly detection for that collection).</param>
    /// <returns>The filtered, sorted sessions (server order folded through the active sort).</returns>
    public static IReadOnlyList<ChargingListSession> FilterAndSort(
        IReadOnlyList<ChargingListSession> sessions,
        ChargingListFilters filters,
        string currencySymbol)
    {
        ArgumentNullException.ThrowIfNull(sessions);
        ArgumentNullException.ThrowIfNull(filters);

        var symbol = string.IsNullOrEmpty(currencySymbol) ? "$" : currencySymbol;
        var dateFiltered = sessions.Where(s => ChargingAggregation.InDateRange(s, filters.StartDate, filters.EndDate)).ToList();
        var collectionFiltered = CollectionFilter(dateFiltered, filters.Collection, symbol);
        var tokens = ChargingSearch.Parse(filters.Search);
        var filtered = tokens.Count == 0
            ? collectionFiltered
            : collectionFiltered.Where(s => ChargingSearch.Matches(s, tokens)).ToList();
        return SortSessions(filtered, filters.SortField, filters.SortDescending);
    }

    /// <summary>Build the CSV export of the supplied sessions (web <c>handleExportCsv</c> header + columns).</summary>
    /// <param name="rows">The sessions to export (already filtered + sorted).</param>
    /// <returns>The CSV text.</returns>
    public static string BuildCsv(IReadOnlyList<ChargingListSession> rows)
    {
        ArgumentNullException.ThrowIfNull(rows);
        var sb = new System.Text.StringBuilder();
        sb.AppendLine("id,started_at,ended_at,charger_type,kwh,cost,duration_min,avg_kw,peak_kw,start_place");
        foreach (var s in rows)
        {
            var fields = new[]
            {
                s.Id.ToString(CultureInfo.InvariantCulture),
                s.StartedAt?.ToString("o", CultureInfo.InvariantCulture) ?? string.Empty,
                s.EndedAt?.ToString("o", CultureInfo.InvariantCulture) ?? string.Empty,
                s.ChargerType ?? string.Empty,
                (s.TotalEnergyAddedWh / 1000.0).ToString("0.###", CultureInfo.InvariantCulture),
                s.CostDecimal?.ToString("0.##", CultureInfo.InvariantCulture) ?? string.Empty,
                ChargingAggregation.DurationMinutes(s).ToString("0.#", CultureInfo.InvariantCulture),
                (ChargingAggregation.AvgPowerW(s) / 1000.0).ToString("0.##", CultureInfo.InvariantCulture),
                ((s.PeakPowerW ?? 0) / 1000.0).ToString("0.##", CultureInfo.InvariantCulture),
                s.StartPlace ?? string.Empty,
            };
            sb.AppendLine(string.Join(',', fields.Select(EscapeCsv)));
        }

        return sb.ToString();
    }

    /// <summary>Build the JSON export of the supplied sessions (web <c>handleExportJson</c>).</summary>
    /// <param name="rows">The sessions to export (already filtered + sorted).</param>
    /// <returns>The indented JSON text.</returns>
    public static string BuildJson(IReadOnlyList<ChargingListSession> rows)
    {
        ArgumentNullException.ThrowIfNull(rows);
        return System.Text.Json.JsonSerializer.Serialize(rows, JsonExportOptions);
    }

    private static readonly System.Text.Json.JsonSerializerOptions JsonExportOptions = new() { WriteIndented = true };

    private static string EscapeCsv(string value) =>
        value.Contains(',', StringComparison.Ordinal) || value.Contains('"', StringComparison.Ordinal) || value.Contains('\n', StringComparison.Ordinal)
            ? string.Concat("\"", value.Replace("\"", "\"\"", StringComparison.Ordinal), "\"")
            : value;

    private static IReadOnlyList<ChargingListSession> CollectionFilter(
        List<ChargingListSession> dateFiltered,
        ChargingCollectionKind collection,
        string symbol) => collection switch
        {
            ChargingCollectionKind.Home => dateFiltered.Where(s => ChargingAggregation.GetChargerCategory(s.ChargerType) == ChargerCategory.Home).ToList(),
            ChargingCollectionKind.Supercharger => dateFiltered.Where(s => ChargingAggregation.GetChargerCategory(s.ChargerType) == ChargerCategory.Supercharger).ToList(),
            ChargingCollectionKind.Dc => dateFiltered.Where(s => ChargingAggregation.GetChargerCategory(s.ChargerType) == ChargerCategory.Dc).ToList(),
            ChargingCollectionKind.Free => dateFiltered.Where(s => s.CostDecimal is null || s.CostDecimal == 0).ToList(),
            ChargingCollectionKind.Anomalies => ChargingAggregation.DetectChargingAnomalies(dateFiltered, symbol).Select(a => a.Session).ToList(),
            ChargingCollectionKind.Notable => ChargingAggregation.DetectNotableSessions(dateFiltered),
            ChargingCollectionKind.Tagged => Array.Empty<ChargingListSession>(),
            _ => dateFiltered,
        };

    private static List<ChargingListSession> SortSessions(
        IReadOnlyList<ChargingListSession> sessions,
        ChargingSortField field,
        bool descending)
    {
        IEnumerable<ChargingListSession> ordered = field switch
        {
            ChargingSortField.Energy => sessions.OrderBy(s => s.TotalEnergyAddedWh),
            ChargingSortField.Cost => sessions.OrderBy(s => s.CostDecimal ?? 0),
            ChargingSortField.Duration => sessions.OrderBy(ChargingAggregation.DurationMinutes),
            ChargingSortField.Power => sessions.OrderBy(ChargingAggregation.AvgPowerW),
            _ => sessions.OrderBy(s => s.StartedAt ?? DateTimeOffset.MinValue),
        };

        var list = ordered.ToList();
        if (descending)
        {
            list.Reverse();
        }

        return list;
    }

    private static List<ChargingDateGroup> BuildGroups(
        IReadOnlyList<ChargingListSession> paginated,
        IReadOnlyDictionary<long, string> anomalyById,
        ChargingListFilters filters,
        UnitPref units,
        string symbol,
        ILocalizer localizer)
    {
        var buckets = new Dictionary<string, List<ChargingListSession>>(StringComparer.Ordinal);
        var order = new List<string>();
        foreach (var s in paginated)
        {
            var key = ChargingAggregation.DayKey(s);
            if (key is null)
            {
                continue;
            }

            if (!buckets.TryGetValue(key, out var list))
            {
                list = new List<ChargingListSession>();
                buckets[key] = list;
                order.Add(key);
            }

            list.Add(s);
        }

        order.Sort((a, b) => filters.SortDescending ? string.CompareOrdinal(b, a) : string.CompareOrdinal(a, b));

        var groups = new List<ChargingDateGroup>(order.Count);
        foreach (var key in order)
        {
            var items = buckets[key];
            var totalEnergy = items.Sum(s => s.TotalEnergyAddedWh) / 1000.0;
            var noun = items.Count == 1
                ? localizer.GetString("bulk.noun.session_one", "session")
                : localizer.GetString("bulk.noun.session_other", "sessions");
            var summary = string.Create(
                CultureInfo.InvariantCulture,
                $"{items.Count} {noun} {Dot} {FmtNumber(totalEnergy, 1)} kWh");

            var rows = items.Select(s => new ChargingSessionRow(
                s.Id,
                BuildCardModel(s, anomalyById, filters, units),
                filters.SelectedIds.Contains(s.Id))).ToList();

            groups.Add(new ChargingDateGroup(key, FormatDayKey(key, longStyle: true), summary, rows));
        }

        return groups;
    }

    private static ChargingSessionCardModel BuildCardModel(
        ChargingListSession s,
        IReadOnlyDictionary<long, string> anomalyById,
        ChargingListFilters filters,
        UnitPref units)
    {
        var snapshot = new ChargingSessionSnapshot(
            s.Id,
            s.StartedAt ?? DateTimeOffset.MinValue,
            s.EndedAt,
            s.ChargerType,
            s.TotalEnergyAddedWh,
            s.CostDecimal,
            s.PeakPowerW,
            s.AvgPowerW,
            s.StartSocPct,
            s.EndSocPct,
            s.OdometerStartM,
            s.OdometerEndM,
            s.StartPlace,
            s.StartLat,
            s.StartLng);

        anomalyById.TryGetValue(s.Id, out var anomalyMessage);
        return new ChargingSessionCardModel(
            Loading: false,
            Session: snapshot,
            Selectable: true,
            Selected: filters.SelectedIds.Contains(s.Id),
            AnomalyMessage: anomalyMessage,
            Density: filters.Density,
            DistanceUnit: units.Distance);
    }

    private static ChargingKpiCard[] BuildKpiCards(
        ChargingPeriodStats current,
        ChargingPeriodStats? prior,
        string symbol,
        ILocalizer localizer)
    {
        bool priorHasData = prior is { Count: > 0 };

        return new[]
        {
            new ChargingKpiCard(
                "sessions",
                localizer.GetString("charging.totalSessions", "Sessions"),
                FmtCompact(current.Count, 1000),
                CyanBrush,
                priorHasData ? DeltaText(prior!.Count, current.Count) : string.Empty,
                $"{localizer.GetString("charging.totalSessions", "Sessions")}: {FmtCompact(current.Count, 1000)}"),
            new ChargingKpiCard(
                "energy",
                localizer.GetString("charging.totalEnergy", "Energy (kWh)"),
                FmtCompact(current.TotalEnergyWh / 1000.0, 10000),
                GreenBrush,
                priorHasData ? DeltaText(prior!.TotalEnergyWh / 1000.0, current.TotalEnergyWh / 1000.0) : string.Empty,
                $"{localizer.GetString("charging.totalEnergy", "Energy (kWh)")}: {FmtCompact(current.TotalEnergyWh / 1000.0, 10000)}"),
            new ChargingKpiCard(
                "cost",
                localizer.GetString("charging.totalCost", "Cost"),
                FmtCurrency(current.TotalCost, symbol),
                RedBrush,
                priorHasData ? DeltaText(prior!.TotalCost, current.TotalCost) : string.Empty,
                $"{localizer.GetString("charging.totalCost", "Cost")}: {FmtCurrency(current.TotalCost, symbol)}"),
            new ChargingKpiCard(
                "rate",
                localizer.GetString("charging.avgRate", "Avg rate (kW)"),
                current.AvgRateKw is { } rate ? FmtNumber(rate, 1) : EmDash,
                PurpleBrush,
                priorHasData && prior!.AvgRateKw is { } pr && current.AvgRateKw is { } cr ? DeltaText(pr, cr) : string.Empty,
                $"{localizer.GetString("charging.avgRate", "Avg rate (kW)")}: {(current.AvgRateKw is { } r ? FmtNumber(r, 1) : EmDash)}"),
            new ChargingKpiCard(
                "duration",
                localizer.GetString("charging.avgDuration", "Avg duration"),
                current.AvgDurationMin is { } dur ? FormatDurationMinutes(dur) : EmDash,
                BlueBrush,
                priorHasData && prior!.AvgDurationMin is { } pd && current.AvgDurationMin is { } cd ? DeltaText(pd, cd) : string.Empty,
                $"{localizer.GetString("charging.avgDuration", "Avg duration")}: {(current.AvgDurationMin is { } d ? FormatDurationMinutes(d) : EmDash)}"),
            new ChargingKpiCard(
                "power",
                localizer.GetString("charging.avgPower", "Avg power (kW)"),
                current.AvgPowerW is { } pw ? FmtNumber(pw / 1000.0, 1) : EmDash,
                AmberBrush,
                priorHasData && prior!.AvgPowerW is { } pp && current.AvgPowerW is { } cp ? DeltaText(pp / 1000.0, cp / 1000.0) : string.Empty,
                $"{localizer.GetString("charging.avgPower", "Avg power (kW)")}: {(current.AvgPowerW is { } w ? FmtNumber(w / 1000.0, 1) : EmDash)}"),
        };
    }

    private static MetricDefinition[] BuildTrendMetrics(ILocalizer localizer) => new[]
    {
        new MetricDefinition { Key = "sessions", Label = localizer.GetString("charging.metric.sessions", "Sessions"), Kind = MetricChartKind.Bar, ColorIndex = 0 },
        new MetricDefinition { Key = "energy", Label = localizer.GetString("charging.metric.energy", "Energy"), Kind = MetricChartKind.Bar, ColorIndex = 1, Unit = "kWh", Decimals = 1 },
        new MetricDefinition { Key = "cost", Label = localizer.GetString("charging.metric.cost", "Cost"), Kind = MetricChartKind.Bar, ColorIndex = 2 },
        new MetricDefinition { Key = "power", Label = localizer.GetString("charging.metric.power", "Avg power"), Kind = MetricChartKind.Line, ColorIndex = 3, Unit = "kW", Decimals = 1 },
    };

    private static ComboOption[] BuildCollectionOptions(
        ILocalizer localizer,
        int all,
        int home,
        int sc,
        int dc,
        int free,
        int anomalies,
        int notable)
    {
        return new[]
        {
            new ComboOption("all", WithCount(localizer.GetString("charging.coll.all", "All"), all)),
            new ComboOption("home", WithCount(localizer.GetString("charging.coll.home", "Home"), home)),
            new ComboOption("supercharger", WithCount(localizer.GetString("charging.coll.supercharger", "Supercharger"), sc)),
            new ComboOption("dc", WithCount(localizer.GetString("charging.coll.dc", "DC Fast"), dc)),
            new ComboOption("free", WithCount(localizer.GetString("charging.coll.free", "Free"), free)),
            new ComboOption("anomalies", WithCount(localizer.GetString("charging.coll.anomalies", "Anomalies"), anomalies)),
            new ComboOption("notable", WithCount(localizer.GetString("charging.coll.notable", "Notable"), notable)),
            new ComboOption("tagged", localizer.GetString("charging.coll.tagged", "Tagged"), Disabled: true),
        };
    }

    private static ComboOption[] BuildSortOptions(ILocalizer localizer) => new[]
    {
        new ComboOption("date", localizer.GetString("charging.sort.date", "Date")),
        new ComboOption("energy", localizer.GetString("charging.sort.energy", "Energy")),
        new ComboOption("cost", localizer.GetString("charging.sort.cost", "Cost")),
        new ComboOption("duration", localizer.GetString("charging.sort.duration", "Duration")),
        new ComboOption("power", localizer.GetString("charging.sort.power", "Power")),
    };

    private static ChargingSectionDisplay[] BuildSections(
        ILocalizer localizer,
        List<ChargingListSession> dateFiltered)
    {
        var count = dateFiltered.Count;
        var itemNoun = localizer.GetString("charging.itemNoun", "sessions");

        var buckets = ComputeStartLevelDist(dateFiltered);
        bool batteryHasData = count >= ThresholdBatteryDist && buckets.Count > 0;
        var battery = new ChargingSectionDisplay(
            "batteryDist",
            localizer.GetString("charging.section.batteryDist", "Battery start-level distribution"),
            localizer.GetString("charging.section.batteryDistDesc", "See where you typically start charging."),
            batteryHasData,
            ThresholdMessage(count, ThresholdBatteryDist, itemNoun),
            batteryHasData ? buckets : Array.Empty<ChargingBucketBar>(),
            Array.Empty<ChargingSpecRow>());

        var specsRows = ComputeChargerSpecs(dateFiltered, localizer);
        bool specsHasData = count >= ThresholdSpecs && specsRows.Count > 0;
        var specs = new ChargingSectionDisplay(
            "specs",
            localizer.GetString("charging.section.specs", "Charger specs breakdown"),
            string.Empty,
            specsHasData,
            ThresholdMessage(count, ThresholdSpecs, itemNoun),
            false ? Array.Empty<ChargingBucketBar>() : Array.Empty<ChargingBucketBar>(),
            specsHasData ? specsRows : Array.Empty<ChargingSpecRow>());

        var optimizer = new ChargingSectionDisplay(
            "optimizer",
            localizer.GetString("charging.section.optimizer", "Charging optimizer"),
            localizer.GetString("charging.section.optimizerDesc", "Personalized tips to charge cheaper and protect your battery."),
            false,
            localizer.GetString("common.noData", "No data"),
            Array.Empty<ChargingBucketBar>(),
            Array.Empty<ChargingSpecRow>());

        return new[] { battery, specs, optimizer };
    }

    private static IReadOnlyList<ChargingBucketBar> ComputeStartLevelDist(IReadOnlyList<ChargingListSession> sessions)
    {
        var bins = new long[10];
        foreach (var s in sessions)
        {
            if (s.StartSocPct is not { } soc)
            {
                continue;
            }

            var idx = Math.Clamp((int)Math.Floor(soc / 10.0), 0, 9);
            bins[idx] += 1;
        }

        long max = bins.Length > 0 ? bins.Max() : 0;
        if (max == 0)
        {
            return Array.Empty<ChargingBucketBar>();
        }

        var bars = new List<ChargingBucketBar>(10);
        for (int i = 0; i < 10; i++)
        {
            var label = string.Create(CultureInfo.InvariantCulture, $"{i * 10}\u2013{(i + 1) * 10}%");
            bars.Add(new ChargingBucketBar(label, bins[i], max > 0 ? bins[i] / (double)max : 0));
        }

        return bars;
    }

    private static List<ChargingSpecRow> ComputeChargerSpecs(
        IReadOnlyList<ChargingListSession> sessions,
        ILocalizer localizer)
    {
        var rows = new List<ChargingSpecRow>();
        foreach (var (category, label) in new[]
        {
            (ChargerCategory.Home, localizer.GetString("charging.coll.home", "Home")),
            (ChargerCategory.Supercharger, localizer.GetString("charging.coll.supercharger", "Supercharger")),
            (ChargerCategory.Dc, localizer.GetString("charging.coll.dc", "DC Fast")),
        })
        {
            var inCat = sessions.Where(s => ChargingAggregation.GetChargerCategory(s.ChargerType) == category).ToList();
            if (inCat.Count == 0)
            {
                continue;
            }

            var peaks = inCat.Where(s => s.PeakPowerW is > 0).Select(s => s.PeakPowerW!.Value / 1000.0).ToList();
            var avgPeak = peaks.Count > 0 ? peaks.Average() : 0;
            var maxPeak = peaks.Count > 0 ? peaks.Max() : 0;
            var detail = string.Create(
                CultureInfo.InvariantCulture,
                $"{inCat.Count} {Dot} avg {FmtNumber(avgPeak, 1)} kW {Dot} max {FmtNumber(maxPeak, 1)} kW");
            rows.Add(new ChargingSpecRow(label, detail));
        }

        return rows;
    }

    private static string BuildStickySummary(ILocalizer localizer, string periodLabel, string collectionLabel, int totalRows, BatteryGradeInfo grade)
    {
        var title = localizer.GetString("charging.list.title", "Charging Sessions");
        var results = string.Create(CultureInfo.InvariantCulture, $"{FmtCompact(totalRows, 1000)} {localizer.GetString("charging.results", "results")}");
        var sb = new System.Text.StringBuilder();
        sb.Append(title).Append(' ').Append(DotChar).Append(' ')
          .Append(periodLabel).Append(' ').Append(DotChar).Append(' ')
          .Append(collectionLabel).Append(' ').Append(DotChar).Append(' ')
          .Append(results);
        if (grade.Label != EmDash)
        {
            sb.Append(' ').Append(DotChar).Append(' ')
              .Append(localizer.GetString("charging.avgScore", "avg")).Append(' ').Append(grade.Label);
        }

        return sb.ToString();
    }

    private static string BuildSecondaryLine(ILocalizer localizer, ChargingPeriodStats stats, BatteryGradeInfo grade)
    {
        if (stats.Count == 0)
        {
            return string.Empty;
        }

        var byType = Interpolate(
            localizer.GetString("charging.byType", "{{home}} home \u00B7 {{sc}} SC \u00B7 {{dc}} DC"),
            ("home", stats.HomeCount.ToString(CultureInfo.InvariantCulture)),
            ("sc", stats.SuperchargerCount.ToString(CultureInfo.InvariantCulture)),
            ("dc", stats.DcCount.ToString(CultureInfo.InvariantCulture)));
        var freeCount = Interpolate(localizer.GetString("charging.freeCount", "{{count}} free"), ("count", stats.FreeCount.ToString(CultureInfo.InvariantCulture)));

        var sb = new System.Text.StringBuilder();
        sb.Append(byType).Append(' ').Append(DotChar).Append(' ').Append(freeCount);
        if (grade.Label != EmDash)
        {
            sb.Append(' ').Append(DotChar).Append(' ')
              .Append(localizer.GetString("charging.batteryScore", "Battery score")).Append(' ').Append(grade.Label);
        }

        if (stats.MostCommonStartHour is { } hour)
        {
            var common = Interpolate(localizer.GetString("charging.mostCommon", "Most common start: {{hour}}"), ("hour", FormatHour(hour)));
            sb.Append(' ').Append(DotChar).Append(' ').Append(common);
        }

        return sb.ToString();
    }

    private static string BuildPriorLabel(ILocalizer localizer, (string Start, string End)? priorRange, ChargingPeriodStats? priorStats)
    {
        if (priorRange is not { } range)
        {
            return string.Empty;
        }

        var start = FormatDayKey(range.Start, longStyle: true);
        var end = FormatDayKey(range.End, longStyle: true);
        if (priorStats is { Count: > 0 })
        {
            return Interpolate(localizer.GetString("charging.priorPeriod", "prior period: {{start}} \u2013 {{end}}"), ("start", start), ("end", end));
        }

        return Interpolate(localizer.GetString("charging.noPriorData", "No charging in prior period: {{start}} \u2013 {{end}}"), ("start", start), ("end", end));
    }

    private static string BuildAnomalyCallout(ILocalizer localizer, int anomalyCount, ChargingCollectionKind collection)
    {
        if (anomalyCount == 0 || collection == ChargingCollectionKind.Anomalies)
        {
            return string.Empty;
        }

        var noun = anomalyCount == 1
            ? localizer.GetString("charging.anomaly_one", "anomaly")
            : localizer.GetString("charging.anomaly_other", "anomalies");
        return Interpolate(
            localizer.GetString("charging.anomalyCount", "{{count}} {{noun}} in this range"),
            ("count", anomalyCount.ToString(CultureInfo.InvariantCulture)),
            ("noun", noun));
    }

    private static string BuildBulkConfirmTitle(ILocalizer localizer, int selectedCount)
    {
        var noun = selectedCount == 1
            ? localizer.GetString("bulk.noun.session_one", "session")
            : localizer.GetString("bulk.noun.session_other", "sessions");
        return Interpolate(
            localizer.GetString("bulk.deleteConfirmTitle", "Delete {{count}} {{noun}}?"),
            ("count", selectedCount.ToString(CultureInfo.InvariantCulture)),
            ("noun", noun));
    }

    private static string ThresholdMessage(int current, int threshold, string itemNoun) =>
        string.Create(CultureInfo.InvariantCulture, $"{current}/{threshold} {itemNoun}");

    private static string CollectionLabel(ChargingCollectionKind collection, ILocalizer localizer) => collection switch
    {
        ChargingCollectionKind.Home => localizer.GetString("charging.coll.home", "Home"),
        ChargingCollectionKind.Supercharger => localizer.GetString("charging.coll.supercharger", "Supercharger"),
        ChargingCollectionKind.Dc => localizer.GetString("charging.coll.dc", "DC Fast"),
        ChargingCollectionKind.Free => localizer.GetString("charging.coll.free", "Free"),
        ChargingCollectionKind.Anomalies => localizer.GetString("charging.coll.anomalies", "Anomalies"),
        ChargingCollectionKind.Notable => localizer.GetString("charging.coll.notable", "Notable"),
        ChargingCollectionKind.Tagged => localizer.GetString("charging.coll.tagged", "Tagged"),
        _ => localizer.GetString("charging.coll.all", "All"),
    };

    private static string CollectionValue(ChargingCollectionKind collection) => collection switch
    {
        ChargingCollectionKind.Home => "home",
        ChargingCollectionKind.Supercharger => "supercharger",
        ChargingCollectionKind.Dc => "dc",
        ChargingCollectionKind.Free => "free",
        ChargingCollectionKind.Anomalies => "anomalies",
        ChargingCollectionKind.Notable => "notable",
        ChargingCollectionKind.Tagged => "tagged",
        _ => "all",
    };

    private static string SortValue(ChargingSortField field) => field switch
    {
        ChargingSortField.Energy => "energy",
        ChargingSortField.Cost => "cost",
        ChargingSortField.Duration => "duration",
        ChargingSortField.Power => "power",
        _ => "date",
    };

    private static string ResolveTrendKey(string? trend) => trend switch
    {
        "energy" => "energy",
        "cost" => "cost",
        "power" => "power",
        _ => "sessions",
    };

    private static string WithCount(string label, int count) =>
        string.Create(CultureInfo.InvariantCulture, $"{label} ({count})");

    private static string DeltaText(double previous, double current)
    {
        if (Math.Abs(previous) < 0.0001)
        {
            return string.Empty;
        }

        var pct = (current - previous) / Math.Abs(previous) * 100.0;
        var arrow = pct > 0 ? "\u25B2" : pct < 0 ? "\u25BC" : Dot;
        return string.Create(CultureInfo.InvariantCulture, $"{arrow} {Math.Abs(pct).ToString("0.#", CultureInfo.InvariantCulture)}%");
    }

    private static string Interpolate(string template, params (string Key, string Value)[] values)
    {
        var result = template;
        foreach (var (key, value) in values)
        {
            result = result.Replace(string.Concat("{{", key, "}}"), value, StringComparison.Ordinal);
        }

        return result;
    }

    private static string FmtNumber(double value, int decimals) =>
        value.ToString("N" + decimals.ToString(CultureInfo.InvariantCulture), CultureInfo.InvariantCulture);

    private static string FmtCurrency(double value, string symbol) =>
        string.Concat(symbol, value.ToString("N2", CultureInfo.InvariantCulture));

    private static string FmtCompact(double value, double threshold)
    {
        var abs = Math.Abs(value);
        if (abs < threshold)
        {
            return value == Math.Floor(value)
                ? ((long)value).ToString("N0", CultureInfo.InvariantCulture)
                : value.ToString("0.#", CultureInfo.InvariantCulture);
        }

        if (abs < 1_000_000)
        {
            return string.Concat((value / 1000.0).ToString("0.#", CultureInfo.InvariantCulture), "k");
        }

        return string.Concat((value / 1_000_000.0).ToString("0.#", CultureInfo.InvariantCulture), "M");
    }

    private static string FormatDurationMinutes(double minutes)
    {
        if (minutes < 1)
        {
            return "0m";
        }

        var total = (int)Math.Round(minutes);
        var h = total / 60;
        var m = total % 60;
        if (h == 0)
        {
            return string.Create(CultureInfo.InvariantCulture, $"{m}m");
        }

        return m > 0
            ? string.Create(CultureInfo.InvariantCulture, $"{h}h {m}m")
            : string.Create(CultureInfo.InvariantCulture, $"{h}h");
    }

    private static string FormatHour(int hour)
    {
        var clamped = ((hour % 24) + 24) % 24;
        return string.Create(CultureInfo.InvariantCulture, $"{clamped:00}:00");
    }

    private static string FormatDayKey(string? key, bool longStyle)
    {
        if (!DateTime.TryParseExact(key, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var dt))
        {
            return key ?? EmDash;
        }

        return dt.ToString(longStyle ? "MMM d, yyyy" : "MMM d", CultureInfo.InvariantCulture);
    }

    private static BatteryGradeInfo BatteryGrade(double? score)
    {
        if (score is not { } s)
        {
            return new BatteryGradeInfo(EmDash, "TsColorMutedBrush");
        }

        return s switch
        {
            >= 80 => new BatteryGradeInfo("A", GreenBrush),
            >= 60 => new BatteryGradeInfo("B", CyanBrush),
            >= 40 => new BatteryGradeInfo("C", AmberBrush),
            >= 20 => new BatteryGradeInfo("D", AmberBrush),
            _ => new BatteryGradeInfo("F", RedBrush),
        };
    }

    private sealed record BatteryGradeInfo(string Label, string BrushKey);
}
