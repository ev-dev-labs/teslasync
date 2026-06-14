using System.Globalization;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.SharedSurfaces;

namespace TeslaSync.App.FeatureViews.Driving;

/// <summary>
/// Pure projection from the parsed drive snapshot + lifecycle state + interactive filters to the render-ready
/// <see cref="DrivesListDisplay"/> — the native port of web/src/features/driving/pages/DrivesListPage.tsx. It folds
/// the drives into the overview period stats (with prior-period deltas), the five trend series, the five collection
/// pills, the searched / sorted / paged date-grouped drive rows and the anomaly callout, performing every
/// SI→display conversion only here. Every visible literal resolves through the i18n facade with the web key names
/// and verbatim English defaults. No WinUI types, so it is compiled into the headless test project.
/// </summary>
public static class DrivesListProjection
{
    /// <summary>How many drive rows the list shows per display page (web <c>size</c> = 50).</summary>
    public const int DisplayPageSize = 50;

    /// <summary>The default cost-per-kWh applied to energy costs when the host supplies none (web <c>costPerKwh</c>).</summary>
    public const double DefaultCostPerKwh = 0.15;

    /// <summary>The high-speed badge threshold in m/s (web <c>maxSpeedMps &gt; 58.1152</c>, ~130 mph).</summary>
    public const double HighSpeedThresholdMps = 58.1152;

    private const string CyanBrush = "TsChartSpeedBrush";
    private const string GreenBrush = "TsChartBatteryBrush";
    private const string BlueBrush = "TsColorAccentBrush";
    private const string PurpleBrush = "TsChartPowerBrush";
    private const string AmberBrush = "TsColorWarningBrush";
    private const string RedBrush = "TsColorDangerBrush";

    private const string EmDash = "\u2014";
    private const string Dot = "\u00B7";
    private const char DotChar = '\u00B7';

    private static readonly string[] TrendKeys = { "drives", "distance", "score", "efficiency", "cost" };

    /// <summary>Project the snapshot for the supplied state + filters + units into the render-ready display model.</summary>
    /// <param name="drives">The parsed drive snapshot (server order).</param>
    /// <param name="state">The resolved lifecycle state.</param>
    /// <param name="filters">The interactive URL/selection state.</param>
    /// <param name="units">The user's unit preference (web <c>unitPrefs</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="costPerKwh">The active cost-per-kWh (web <c>costPerKwh</c>).</param>
    /// <param name="currencySymbol">The active currency symbol (web <c>currencySymbol</c>).</param>
    /// <param name="now">The clock used for default-range fallbacks.</param>
    /// <returns>The render-ready display model.</returns>
    public static DrivesListDisplay Project(
        IReadOnlyList<DriveListItem> drives,
        DrivesListState state,
        DrivesListFilters filters,
        UnitPref units,
        ILocalizer localizer,
        double costPerKwh,
        string currencySymbol,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(drives);
        ArgumentNullException.ThrowIfNull(filters);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        var symbol = string.IsNullOrEmpty(currencySymbol) ? "$" : currencySymbol;
        var perKwh = costPerKwh > 0 ? costPerKwh : DefaultCostPerKwh;

        var dateFiltered = drives.Where(d => DrivesAggregation.InDateRange(d, filters.StartDate, filters.EndDate)).ToList();
        var currentStats = DrivesAggregation.ComputePeriodStats(dateFiltered, null, null);
        var priorRange = DrivesAggregation.PriorPeriod(filters.StartDate, filters.EndDate);
        var priorStats = priorRange is { } pr
            ? DrivesAggregation.ComputePeriodStats(drives, pr.Start, pr.End)
            : null;

        var anomalies = DrivesAggregation.DetectAnomalies(dateFiltered);
        var anomalyIds = new HashSet<long>(anomalies.Select(a => a.Id));
        var notable = DrivesAggregation.DetectNotable(dateFiltered);
        var commutes = DrivesAggregation.DetectCommutes(dateFiltered, 3);

        IReadOnlyList<DriveListItem> collectionFiltered = CollectionFilter(dateFiltered, filters.Collection, anomalies, notable, commutes);

        var tokens = DriveSearch.Parse(filters.Search);
        var filtered = tokens.Count == 0
            ? collectionFiltered
            : collectionFiltered.Where(d => DriveSearch.Matches(d, tokens, units.Distance)).ToList();

        var sorted = SortDrives(filtered, filters.SortField);

        int page = Math.Max(1, filters.Page);
        int totalRows = sorted.Count;
        int maxPage = Math.Max(1, (int)Math.Ceiling(totalRows / (double)DisplayPageSize));
        page = Math.Min(page, maxPage);
        var paginated = sorted.Skip((page - 1) * DisplayPageSize).Take(DisplayPageSize).ToList();

        var groups = BuildGroups(paginated, anomalyIds, filters, units, perKwh, symbol, localizer);

        var trendSeries = BuildTrendSeries(dateFiltered, units, perKwh);
        var trendMetrics = BuildTrendMetrics(localizer, units, symbol);

        var avgGrade = DrivesAggregation.GradeFromNumeric(currentStats.AvgGradeNumeric);
        var collectionLabel = CollectionLabel(filters.Collection, localizer);
        var periodLabel = BuildPeriodLabel(filters.StartDate, filters.EndDate);

        return new DrivesListDisplay
        {
            State = state,
            Title = localizer.GetString("drives.title", "Drive History"),
            Subtitle = localizer.GetString("drives.subtitle", "Trip scoring, efficiency analysis, distance patterns, and performance data"),
            StickyAria = localizer.GetString("drives.stickyBar.aria", "Drive history summary"),
            StickySummary = BuildStickySummary(localizer, periodLabel, collectionLabel, sorted.Count, avgGrade),
            SearchPrompt = localizer.GetString("drives.searchPlaceholder", "Search drives \u2014 try \"score:D\", \"Office\", \"29.1\""), // parity:allow drives.searchPlaceholder is a required web i18n key name
            FilterPendingLabel = localizer.GetString("filter.pending", "Filtering\u2026"),
            FilterSearchLabel = localizer.GetString("drives.filterLabel.search", "Search"),
            FilterCollectionLabel = localizer.GetString("drives.filterLabel.collection", "View"),
            HasStats = currentStats.Count > 0,
            OverviewTitle = localizer.GetString("drives.overview", "Overview"),
            PeriodLabel = periodLabel,
            PriorLabel = BuildPriorLabel(localizer, priorRange, priorStats),
            KpiCards = BuildKpiCards(localizer, currentStats, priorStats, avgGrade, units, perKwh, symbol),
            SecondaryLine = BuildSecondaryLine(localizer, currentStats, units),
            NoStatsMessage = localizer.GetString("drives.noStatsRange", "No drives in this range"),
            AnomalyCallout = BuildAnomalyCallout(localizer, anomalies.Count, filters.Collection),
            ViewAnomaliesLabel = localizer.GetString("drives.viewAnomalies", "View anomalies"),
            HasAnomalyCallout = anomalies.Count > 0 && filters.Collection != DriveCollectionKind.Anomalies,
            TrendTitle = localizer.GetString("drives.overTime", "Drives over time"),
            TrendAria = localizer.GetString("drives.overTime.aria", "Drives over time chart with metric switcher"),
            TrendEmpty = localizer.GetString("drives.overTime.empty", "No data for this metric in the selected range"),
            TrendMetrics = trendMetrics,
            TrendSeries = trendSeries,
            TrendActiveKey = ResolveTrendKey(filters.TrendMetric),
            CollectionsAria = localizer.GetString("drives.collections.aria", "Filter drives by collection"),
            CollectionOptions = BuildCollectionOptions(localizer, dateFiltered.Count, anomalies.Count, notable.Count, commutes.Count),
            ActiveCollection = CollectionValue(filters.Collection),
            SortOptions = BuildSortOptions(localizer),
            ActiveSort = SortValue(filters.SortField),
            SortAria = BuildSortAria(localizer, filters.SortField),
            ListHeading = localizer.GetString("drives.allDrives", "All Drives"),
            Groups = groups,
            HasRows = groups.Count > 0,
            EmptyForCollectionTitle = localizer.GetString("drives.emptyForCollection", "No drives in this view"),
            EmptyForCollectionMessage = localizer.GetString("drives.emptyForCollection.msg", "Try switching to a different collection or clearing your filters."),
            TotalRowCount = totalRows,
            ResultsLabel = BuildResultsLabel(localizer, sorted.Count),
            Page = page,
            PageSize = DisplayPageSize,
            BulkDeleteLabel = localizer.GetString("bulk.actions.delete", "Delete"),
            BulkConfirmTitle = BuildBulkConfirmTitle(localizer, filters.SelectedIds.Count),
            BulkConfirmDescription = localizer.GetString("bulk.deleteConfirmDescription", "This cannot be undone."),
            CommonDeleteLabel = localizer.GetString("common.delete", "Delete"),
            SelectedCount = filters.SelectedIds.Count,
            EmptyTitle = localizer.GetString("drives.emptyTitle", "No drives recorded yet"),
            EmptyMessage = localizer.GetString("drives.emptyMessage", "Drive data will appear here once your vehicle records trips."),
            EmptyCta = localizer.GetString("drives.empty.cta", "Reset filters"),
            NoDataLabel = localizer.GetString("common.noData", "No data available"),
        };
    }

    /// <summary>
    /// Apply the active date / collection / search / sort filters to the snapshot — the export-path twin of the list
    /// folding inside <see cref="Project"/> (web <c>sortedDrives</c>). Used by the CSV / JSON export so the downloaded
    /// rows match exactly what the list shows.
    /// </summary>
    /// <param name="drives">The full drive snapshot.</param>
    /// <param name="filters">The active filters.</param>
    /// <param name="distanceUnit">The display distance unit (drives the search distance comparisons).</param>
    /// <returns>The filtered, sorted drives.</returns>
    public static IReadOnlyList<DriveListItem> FilterAndSort(
        IReadOnlyList<DriveListItem> drives,
        DrivesListFilters filters,
        DistanceUnit distanceUnit)
    {
        ArgumentNullException.ThrowIfNull(drives);
        ArgumentNullException.ThrowIfNull(filters);

        var dateFiltered = drives.Where(d => DrivesAggregation.InDateRange(d, filters.StartDate, filters.EndDate)).ToList();
        var anomalies = DrivesAggregation.DetectAnomalies(dateFiltered);
        var notable = DrivesAggregation.DetectNotable(dateFiltered);
        var commutes = DrivesAggregation.DetectCommutes(dateFiltered, 3);
        var collectionFiltered = CollectionFilter(dateFiltered, filters.Collection, anomalies, notable, commutes);
        var tokens = DriveSearch.Parse(filters.Search);
        var filtered = tokens.Count == 0
            ? collectionFiltered
            : collectionFiltered.Where(d => DriveSearch.Matches(d, tokens, distanceUnit)).ToList();
        return SortDrives(filtered, filters.SortField);
    }

    /// <summary>Build the CSV export of the supplied drives (web <c>export/drives?format=csv</c> columns).</summary>
    /// <param name="rows">The drives to export (already filtered + sorted).</param>
    /// <returns>The CSV text.</returns>
    public static string BuildCsv(IReadOnlyList<DriveListItem> rows)
    {
        ArgumentNullException.ThrowIfNull(rows);
        var sb = new System.Text.StringBuilder();
        sb.AppendLine("id,start_ts,end_ts,distance_m,duration_s,start_battery_pct,end_battery_pct,avg_speed_mps,max_speed_mps,start_address,end_address");
        foreach (var d in rows)
        {
            var fields = new[]
            {
                d.Id.ToString(CultureInfo.InvariantCulture),
                d.StartTs?.ToString("o", CultureInfo.InvariantCulture) ?? string.Empty,
                d.EndTs?.ToString("o", CultureInfo.InvariantCulture) ?? string.Empty,
                d.DistanceM.ToString("0.###", CultureInfo.InvariantCulture),
                d.DurationS.ToString("0.#", CultureInfo.InvariantCulture),
                d.StartBatteryPct?.ToString("0.#", CultureInfo.InvariantCulture) ?? string.Empty,
                d.EndBatteryPct?.ToString("0.#", CultureInfo.InvariantCulture) ?? string.Empty,
                d.AvgSpeedMps?.ToString("0.##", CultureInfo.InvariantCulture) ?? string.Empty,
                d.MaxSpeedMps?.ToString("0.##", CultureInfo.InvariantCulture) ?? string.Empty,
                d.StartAddress ?? string.Empty,
                d.EndAddress ?? string.Empty,
            };
            sb.AppendLine(string.Join(',', fields.Select(EscapeCsv)));
        }

        return sb.ToString();
    }

    /// <summary>Build the JSON export of the supplied drives (web <c>export/drives?format=json</c>).</summary>
    /// <param name="rows">The drives to export (already filtered + sorted).</param>
    /// <returns>The indented JSON text.</returns>
    public static string BuildJson(IReadOnlyList<DriveListItem> rows)
    {
        ArgumentNullException.ThrowIfNull(rows);
        return System.Text.Json.JsonSerializer.Serialize(rows, JsonExportOptions);
    }

    private static readonly System.Text.Json.JsonSerializerOptions JsonExportOptions = new() { WriteIndented = true };

    private static string EscapeCsv(string value) =>
        value.Contains(',', StringComparison.Ordinal) || value.Contains('"', StringComparison.Ordinal) || value.Contains('\n', StringComparison.Ordinal)
            ? string.Concat("\"", value.Replace("\"", "\"\"", StringComparison.Ordinal), "\"")
            : value;

    private static IReadOnlyList<DriveListItem> CollectionFilter(
        List<DriveListItem> dateFiltered,
        DriveCollectionKind collection,
        List<DriveListItem> anomalies,
        List<DriveListItem> notable,
        List<DriveListItem> commutes) => collection switch
        {
            DriveCollectionKind.Anomalies => anomalies,
            DriveCollectionKind.Notable => notable,
            DriveCollectionKind.Commutes => commutes,
            DriveCollectionKind.Tagged => Array.Empty<DriveListItem>(),
            _ => dateFiltered,
        };

    private static List<DriveListItem> SortDrives(IReadOnlyList<DriveListItem> drives, DriveSortField field)
    {
        return field switch
        {
            DriveSortField.Distance => drives.OrderByDescending(d => d.DistanceM).ToList(),
            DriveSortField.Efficiency => drives.OrderBy(d => DrivesAggregation.GetEfficiency(d) ?? 999.0).ToList(),
            _ => drives.OrderByDescending(d => d.StartTs ?? DateTimeOffset.MinValue).ToList(),
        };
    }

    private static Dictionary<string, IReadOnlyList<MetricPoint>> BuildTrendSeries(
        IReadOnlyList<DriveListItem> dateFiltered,
        UnitPref units,
        double perKwh)
    {
        var series = new Dictionary<string, IReadOnlyList<MetricPoint>>(StringComparer.Ordinal);
        foreach (var key in TrendKeys)
        {
            var raw = DrivesAggregation.DailyTrend(dateFiltered, key);
            var points = new List<MetricPoint>(raw.Count);
            foreach (var (date, value) in raw)
            {
                double converted = key switch
                {
                    "distance" => UnitConverters.DistanceFromSi(value, units.Distance),
                    "efficiency" => EfficiencyDisplay(value, units),
                    "cost" => value * perKwh,
                    _ => value,
                };
                points.Add(new MetricPoint(date, converted));
            }

            series[key] = points;
        }

        return series;
    }

    private static List<MetricDefinition> BuildTrendMetrics(ILocalizer localizer, UnitPref units, string symbol)
    {
        var distanceUnit = UnitLabels.Label(units.Distance);
        var efficiencyUnit = EfficiencyUnit(units);
        return new List<MetricDefinition>
        {
            new() { Key = "drives", Label = localizer.GetString("drives.metric.drives", "Drives"), Kind = MetricChartKind.Bar, ColorIndex = 0, Decimals = 0 },
            new() { Key = "distance", Label = localizer.GetString("drives.metric.distance", "Distance"), Kind = MetricChartKind.Bar, ColorIndex = 1, Unit = distanceUnit, Decimals = 1 },
            new() { Key = "score", Label = localizer.GetString("drives.metric.score", "Score"), Kind = MetricChartKind.Line, ColorIndex = 2, Decimals = 1 },
            new() { Key = "efficiency", Label = localizer.GetString("drives.metric.efficiency", "Efficiency"), Kind = MetricChartKind.Line, ColorIndex = 3, Unit = efficiencyUnit, Decimals = 0 },
            new() { Key = "cost", Label = localizer.GetString("drives.metric.cost", "Cost"), Kind = MetricChartKind.Bar, ColorIndex = 4, Unit = symbol, Decimals = 2 },
        };
    }

    private static List<DriveDateGroup> BuildGroups(
        IReadOnlyList<DriveListItem> paginated,
        IReadOnlySet<long> anomalyIds,
        DrivesListFilters filters,
        UnitPref units,
        double perKwh,
        string symbol,
        ILocalizer localizer)
    {
        var buckets = new Dictionary<string, List<DriveListItem>>(StringComparer.Ordinal);
        var order = new List<string>();
        foreach (var d in paginated)
        {
            var key = DrivesAggregation.DayKey(d);
            if (key is null)
            {
                continue;
            }

            if (!buckets.TryGetValue(key, out var list))
            {
                list = new List<DriveListItem>();
                buckets[key] = list;
                order.Add(key);
            }

            list.Add(d);
        }

        // The list is most-recent-first; date groups follow the same descending day order.
        order.Sort((a, b) => string.CompareOrdinal(b, a));

        var distanceUnit = UnitLabels.Label(units.Distance);
        var groups = new List<DriveDateGroup>(order.Count);
        foreach (var key in order)
        {
            var items = buckets[key];
            double totalDistDisplay = UnitConverters.DistanceFromSi(items.Sum(d => d.DistanceM), units.Distance);
            var noun = items.Count == 1
                ? localizer.GetString("bulk.noun.drive_one", "drive")
                : localizer.GetString("bulk.noun.drive_other", "drives");
            var summary = string.Create(
                CultureInfo.InvariantCulture,
                $"{items.Count} {noun} {Dot} {FmtNumber(totalDistDisplay, 1)} {distanceUnit}");

            var rows = items.Select(d => BuildRow(d, anomalyIds, filters, units, perKwh, symbol, localizer)).ToList();
            groups.Add(new DriveDateGroup(key, FormatDayKey(key, longStyle: true), summary, rows));
        }

        return groups;
    }

    private static DriveRowModel BuildRow(
        DriveListItem d,
        IReadOnlySet<long> anomalyIds,
        DrivesListFilters filters,
        UnitPref units,
        double perKwh,
        string symbol,
        ILocalizer localizer)
    {
        var speedUnit = UnitLabels.Label(units.Speed);
        var efficiencyUnit = EfficiencyUnit(units);
        bool isCompleted = d.EndTs != null;
        bool hasData = d.DistanceM > 0 || d.DurationS > 0;

        var eff = DrivesAggregation.GetEfficiency(d);
        var grade = DrivesAggregation.GradeFromEfficiency(eff);

        string avgValue;
        if (d.AvgSpeedMps is { } avg)
        {
            avgValue = FmtInt(UnitConverters.SpeedFromSi(avg, units.Speed));
        }
        else if (d.DurationS > 0 && d.DistanceM > 0)
        {
            avgValue = FmtInt(UnitConverters.SpeedFromSi(d.DistanceM / d.DurationS, units.Speed));
        }
        else
        {
            avgValue = EmDash;
        }

        bool hasBattery = d.StartBatteryPct is { } sb && d.EndBatteryPct is { } eb &&
            !(sb == 0 && eb == 0 && isCompleted);

        string? costText = null;
        if (hasBattery && d.StartBatteryPct is { } start && d.EndBatteryPct is { } end && start > end)
        {
            costText = string.Concat("~", FmtCurrency((start - end) * 0.75 * perKwh, symbol));
        }

        (string PrimaryText, DriveBadgeKind Kind) primary = hasData
            ? (string.Create(CultureInfo.InvariantCulture, $"{FmtNumber(UnitConverters.DistanceFromSi(d.DistanceM, units.Distance), 1)} {UnitLabels.Label(units.Distance)}"), DriveBadgeKind.Info)
            : isCompleted
                ? (localizer.GetString("drives.noTelemetry", "No telemetry"), DriveBadgeKind.Warning)
                : (localizer.GetString("drives.inProgress", "In progress"), DriveBadgeKind.Success);

        return new DriveRowModel
        {
            Id = d.Id,
            Selected = filters.SelectedIds.Contains(d.Id),
            SelectAria = Interpolate(localizer.GetString("drives.selectDrive", "Select drive on {0}"), FormatDayKey(DrivesAggregation.DayKey(d), longStyle: true)),
            ScoreLabel = grade.Label,
            ScoreColorHex = grade.ColorHex,
            ScoreAria = Interpolate(localizer.GetString("drives.scoreAria", "Score {0}"), grade.Label),
            TimeLabel = FormatTime(d.StartTs),
            DurationLabel = FormatDurationMinutes(d.DurationS / 60.0),
            PrimaryBadgeText = primary.PrimaryText,
            PrimaryBadgeKind = primary.Kind,
            HighSpeed = d.MaxSpeedMps is { } ms && ms > HighSpeedThresholdMps,
            HighSpeedLabel = localizer.GetString("drives.highSpeed", "High speed"),
            IsAnomaly = anomalyIds.Contains(d.Id),
            AnomalyLabel = localizer.GetString("drives.lowEfficiencyBadge", "Low efficiency"),
            RouteStartAddress = d.StartAddress ?? string.Empty,
            RouteStartLat = d.StartLat,
            RouteStartLon = d.StartLon,
            RouteEndAddress = d.EndAddress ?? string.Empty,
            RouteEndLat = d.EndLat,
            RouteEndLon = d.EndLon,
            AvgText = string.Create(CultureInfo.InvariantCulture, $"{localizer.GetString("drives.avg", "Avg")} {avgValue} {speedUnit}"),
            MaxText = d.MaxSpeedMps is { } max
                ? string.Create(CultureInfo.InvariantCulture, $"{localizer.GetString("drives.max", "Max")} {FmtInt(UnitConverters.SpeedFromSi(max, units.Speed))} {speedUnit}")
                : null,
            HasBattery = hasBattery,
            BatteryStartPct = d.StartBatteryPct ?? 0,
            BatteryEndPct = d.EndBatteryPct ?? 0,
            EfficiencyText = eff is { } e
                ? string.Create(CultureInfo.InvariantCulture, $"{FmtInt(EfficiencyDisplay(e, units))} {efficiencyUnit}")
                : null,
            EfficiencyColorHex = eff is null ? null : grade.ColorHex,
            CostText = costText,
        };
    }

    private static List<DriveKpiCard> BuildKpiCards(
        ILocalizer localizer,
        DrivesPeriodStats current,
        DrivesPeriodStats? prior,
        DriveGrade avgGrade,
        UnitPref units,
        double perKwh,
        string symbol)
    {
        bool priorHas = prior is { Count: > 0 };
        var distanceUnit = UnitLabels.Label(units.Distance);
        var efficiencyUnit = EfficiencyUnit(units);

        double distDisplay = UnitConverters.DistanceFromSi(current.TotalDistanceM, units.Distance);
        double? priorDist = prior is null ? null : UnitConverters.DistanceFromSi(prior.TotalDistanceM, units.Distance);
        double driveTimeMin = current.TotalDurationS / 60.0;
        double? priorDriveTimeMin = prior is null ? null : prior.TotalDurationS / 60.0;
        double? avgEff = current.AvgEfficiencyWhKm is { } e ? EfficiencyDisplay(e, units) : null;
        double? priorEff = prior?.AvgEfficiencyWhKm is { } pe ? EfficiencyDisplay(pe, units) : null;
        double totalCost = current.TotalEnergyKwh * perKwh;
        double? priorCost = prior is null ? null : prior.TotalEnergyKwh * perKwh;

        var cards = new List<DriveKpiCard>(6)
        {
            Kpi("drives", localizer.GetString("drives.totalDrives", "Drives"), FmtCompact(current.Count),
                CyanBrush, priorHas ? DeltaText(prior!.Count, current.Count) : string.Empty),
            Kpi("distance", WithUnit(localizer.GetString("drives.distance", "Distance"), distanceUnit), FmtCompact(distDisplay),
                GreenBrush, priorHas && priorDist is { } pd ? DeltaText(pd, distDisplay) : string.Empty),
            Kpi("driveTime", localizer.GetString("drives.driveTime", "Drive time"), FormatDurationMinutes(driveTimeMin),
                BlueBrush, priorHas && priorDriveTimeMin is { } pt ? DeltaText(pt, driveTimeMin) : string.Empty),
            Kpi("score", localizer.GetString("drives.avgScore", "Avg score"), avgGrade.Label,
                PurpleBrush, priorHas && prior!.AvgGradeNumeric is { } pg && current.AvgGradeNumeric is { } cg ? DeltaText(pg, cg) : string.Empty),
            Kpi("efficiency", WithUnit(localizer.GetString("drives.efficiency", "Efficiency"), efficiencyUnit), avgEff is { } ed ? FmtInt(ed) : EmDash,
                AmberBrush, priorHas && avgEff is { } ae && priorEff is { } pef ? DeltaText(pef, ae) : string.Empty),
            Kpi("cost", localizer.GetString("drives.cost", "Cost"), FmtCurrency(totalCost, symbol),
                RedBrush, priorHas && priorCost is { } pc ? DeltaText(pc, totalCost) : string.Empty),
        };
        return cards;
    }

    private static DriveKpiCard Kpi(string key, string label, string value, string brush, string delta) =>
        new(key, label, value, brush, delta, string.Create(CultureInfo.InvariantCulture, $"{label}: {value}"));

    private static string BuildSecondaryLine(ILocalizer localizer, DrivesPeriodStats stats, UnitPref units)
    {
        if (stats.Count == 0)
        {
            return string.Empty;
        }

        var distanceUnit = UnitLabels.Label(units.Distance);
        var speedUnit = UnitLabels.Label(units.Speed);
        var topSpeed = FmtInt(UnitConverters.SpeedFromSi(stats.TopSpeedMps, units.Speed));
        var longest = FmtNumber(UnitConverters.DistanceFromSi(stats.LongestDistanceM, units.Distance), 1);
        var avgTrip = FmtNumber(UnitConverters.DistanceFromSi(stats.Count > 0 ? stats.TotalDistanceM / stats.Count : 0, units.Distance), 1);
        var avgDur = FormatDurationMinutes(stats.Count > 0 ? stats.TotalDurationS / 60.0 / stats.Count : 0);

        var sb = new System.Text.StringBuilder();
        sb.Append(localizer.GetString("drives.topSpeed", "Top Speed")).Append(' ').Append(topSpeed).Append(' ').Append(speedUnit);
        sb.Append(' ').Append(DotChar).Append(' ').Append(localizer.GetString("drives.longest", "Longest")).Append(' ').Append(longest).Append(' ').Append(distanceUnit);
        sb.Append(' ').Append(DotChar).Append(' ').Append(localizer.GetString("drives.avgTrip", "Avg trip")).Append(' ').Append(avgTrip).Append(' ').Append(distanceUnit);
        sb.Append(' ').Append(DotChar).Append(' ').Append(avgDur).Append(' ').Append(localizer.GetString("drives.avgDur", "avg dur"));
        return sb.ToString();
    }

    private static string BuildStickySummary(ILocalizer localizer, string periodLabel, string collectionLabel, int resultCount, DriveGrade avgGrade)
    {
        var sb = new System.Text.StringBuilder();
        sb.Append(localizer.GetString("drives.title", "Drive History"));
        sb.Append(' ').Append(DotChar).Append(' ').Append(periodLabel);
        sb.Append(' ').Append(DotChar).Append(' ').Append(collectionLabel);
        sb.Append(' ').Append(DotChar).Append(' ').Append(FmtCompact(resultCount)).Append(' ').Append(localizer.GetString("drives.results", "results"));
        if (avgGrade.Label != EmDash)
        {
            sb.Append(' ').Append(DotChar).Append(' ').Append(localizer.GetString("drives.avgScore", "Avg score")).Append(' ').Append(avgGrade.Label);
        }

        return sb.ToString();
    }

    private static string BuildPriorLabel(ILocalizer localizer, (string Start, string End)? priorRange, DrivesPeriodStats? priorStats)
    {
        if (priorRange is not { } range)
        {
            return string.Empty;
        }

        var start = FormatDayKey(range.Start, longStyle: true);
        var end = FormatDayKey(range.End, longStyle: true);
        if (priorStats is { Count: > 0 })
        {
            return Interpolate(localizer.GetString("drives.priorPeriod", "prior period: {0} \u2013 {1}"), start, end);
        }

        return Interpolate(localizer.GetString("drives.noPriorData", "No drives in prior period: {0} \u2013 {1}"), start, end);
    }

    private static string BuildAnomalyCallout(ILocalizer localizer, int anomalyCount, DriveCollectionKind collection)
    {
        if (anomalyCount == 0 || collection == DriveCollectionKind.Anomalies)
        {
            return string.Empty;
        }

        var noun = anomalyCount == 1
            ? localizer.GetString("drives.anomaly_one", "anomaly")
            : localizer.GetString("drives.anomaly_other", "anomalies");
        return Interpolate(
            localizer.GetString("drives.anomalyCount", "{0} {1} in this range"),
            anomalyCount.ToString(CultureInfo.InvariantCulture),
            noun);
    }

    private static string BuildBulkConfirmTitle(ILocalizer localizer, int selectedCount)
    {
        var noun = selectedCount == 1
            ? localizer.GetString("bulk.noun.drive_one", "drive")
            : localizer.GetString("bulk.noun.drive_other", "drives");
        return Interpolate(
            localizer.GetString("bulk.deleteConfirmTitle", "Delete {0} {1}?"),
            selectedCount.ToString(CultureInfo.InvariantCulture),
            noun);
    }

    private static string BuildResultsLabel(ILocalizer localizer, int count) =>
        string.Create(CultureInfo.InvariantCulture, $"{FmtCompact(count)} {localizer.GetString("drives.results", "results")}");

    private static List<ComboOption> BuildCollectionOptions(ILocalizer localizer, int all, int anomalies, int notable, int commutes)
    {
        return new List<ComboOption>
        {
            new("all", WithCount(localizer.GetString("drives.coll.all", "All"), all)),
            new("anomalies", WithCount(localizer.GetString("drives.coll.anomalies", "Anomalies"), anomalies)),
            new("notable", WithCount(localizer.GetString("drives.coll.notable", "Notable"), notable)),
            new("commutes", WithCount(localizer.GetString("drives.coll.commutes", "Commutes"), commutes)),
            new("tagged", WithCount(localizer.GetString("drives.coll.tagged", "Tagged"), 0), Disabled: true),
        };
    }

    private static List<ComboOption> BuildSortOptions(ILocalizer localizer)
    {
        return new List<ComboOption>
        {
            new("date", localizer.GetString("drives.sortRecent", "Recent")),
            new("distance", localizer.GetString("drives.sortDistance", "Distance")),
            new("efficiency", localizer.GetString("drives.sortEfficiency", "Efficiency")),
        };
    }

    private static string BuildSortAria(ILocalizer localizer, DriveSortField field)
    {
        var label = field switch
        {
            DriveSortField.Distance => localizer.GetString("drives.sortDistance", "Distance"),
            DriveSortField.Efficiency => localizer.GetString("drives.sortEfficiency", "Efficiency"),
            _ => localizer.GetString("drives.sortRecent", "Recent"),
        };
        return Interpolate(localizer.GetString("drives.sortByAria", "Sort by {0}"), label);
    }

    private static string CollectionLabel(DriveCollectionKind collection, ILocalizer localizer) => collection switch
    {
        DriveCollectionKind.Anomalies => localizer.GetString("drives.coll.anomalies", "Anomalies"),
        DriveCollectionKind.Notable => localizer.GetString("drives.coll.notable", "Notable"),
        DriveCollectionKind.Commutes => localizer.GetString("drives.coll.commutes", "Commutes"),
        DriveCollectionKind.Tagged => localizer.GetString("drives.coll.tagged", "Tagged"),
        _ => localizer.GetString("drives.coll.all", "All"),
    };

    private static string CollectionValue(DriveCollectionKind collection) => collection switch
    {
        DriveCollectionKind.Anomalies => "anomalies",
        DriveCollectionKind.Notable => "notable",
        DriveCollectionKind.Commutes => "commutes",
        DriveCollectionKind.Tagged => "tagged",
        _ => "all",
    };

    private static string SortValue(DriveSortField field) => field switch
    {
        DriveSortField.Distance => "distance",
        DriveSortField.Efficiency => "efficiency",
        _ => "date",
    };

    private static string ResolveTrendKey(string? trend) => trend switch
    {
        "distance" => "distance",
        "score" => "score",
        "efficiency" => "efficiency",
        "cost" => "cost",
        _ => "drives",
    };

    private static double EfficiencyDisplay(double whPerKm, UnitPref units) =>
        units.Distance == DistanceUnit.Mi ? whPerKm * 1.609344 : whPerKm;

    private static string EfficiencyUnit(UnitPref units) =>
        units.Distance == DistanceUnit.Mi ? "Wh/mi" : "Wh/km";

    private static string WithUnit(string label, string unit) =>
        string.Create(CultureInfo.InvariantCulture, $"{label} ({unit})");

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

    private static string Interpolate(string template, params string[] args)
    {
        var result = template;
        for (int i = 0; i < args.Length; i++)
        {
            result = result.Replace(
                string.Concat("{", i.ToString(CultureInfo.InvariantCulture), "}"),
                args[i],
                StringComparison.Ordinal);
        }

        return result;
    }

    private static string FmtNumber(double value, int decimals) =>
        value.ToString("N" + decimals.ToString(CultureInfo.InvariantCulture), CultureInfo.InvariantCulture);

    private static string FmtInt(double value) =>
        Math.Round(value, MidpointRounding.AwayFromZero).ToString("N0", CultureInfo.InvariantCulture);

    private static string FmtCurrency(double value, string symbol) =>
        string.Concat(symbol, value.ToString("N2", CultureInfo.InvariantCulture));

    private static string FmtCompact(double value)
    {
        var abs = Math.Abs(value);
        if (abs < 1000)
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

    private static string FormatTime(DateTimeOffset? ts)
    {
        if (ts is not { } value)
        {
            return EmDash;
        }

        return value.UtcDateTime.ToString("h:mm tt", CultureInfo.InvariantCulture);
    }

    private static string FormatDayKey(string? key, bool longStyle)
    {
        if (!DateTime.TryParseExact(key, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var dt))
        {
            return key ?? EmDash;
        }

        return dt.ToString(longStyle ? "MMM d, yyyy" : "MMM d", CultureInfo.InvariantCulture);
    }

    private static string BuildPeriodLabel(string startDate, string endDate) =>
        string.Create(CultureInfo.InvariantCulture, $"{FormatDayKey(startDate, longStyle: true)} \u2013 {FormatDayKey(endDate, longStyle: true)}");
}
