using System.Globalization;
using System.Text.Json;

namespace TeslaSync.App.FeatureViews.Driving;

/// <summary>
/// The mutually-exclusive lifecycle state the <see cref="DrivesListPageViewModel"/> renders for its drives source —
/// the native union of the web Drives-list page's branches
/// (web/src/features/driving/pages/DrivesListPage.tsx): the <c>isLoading</c> skeletons, the resolved-but-empty range
/// (<c>currentStats.count === 0</c> / no drives), the retriable <c>error</c> surface, and the populated section stack
/// (overview KPIs, trend chart, collections, drive list, pager). Every branch maps onto a visible region; none is
/// ever blank.
/// </summary>
public enum DrivesListState
{
    /// <summary>The first load with no cached snapshot (web <c>isLoading</c> skeletons).</summary>
    Loading,

    /// <summary>A resolved snapshot with no drives in range (web empty state).</summary>
    Empty,

    /// <summary>A hard transport failure with no cached rows (web retriable error surface).</summary>
    Error,

    /// <summary>A resolved snapshot with at least one drive (web populated section stack).</summary>
    Success,
}

/// <summary>One selectable drive collection (web <c>COLLECTIONS</c> allowlist).</summary>
public enum DriveCollectionKind
{
    /// <summary>All drives in range.</summary>
    All,

    /// <summary>Detected anomalous (grade D) drives.</summary>
    Anomalies,

    /// <summary>Notable (top-decile distance / grade A+) drives.</summary>
    Notable,

    /// <summary>Recurring origin↔destination commute drives.</summary>
    Commutes,

    /// <summary>Tagged drives (web parity: always empty / disabled).</summary>
    Tagged,
}

/// <summary>The active sort field for the drive list (web <c>sort</c> allowlist).</summary>
public enum DriveSortField
{
    /// <summary>Sort by start instant (web <c>date</c>, most-recent first).</summary>
    Date,

    /// <summary>Sort by distance (web <c>distance</c>, longest first).</summary>
    Distance,

    /// <summary>Sort by efficiency (web <c>efficiency</c>, best first).</summary>
    Efficiency,
}

/// <summary>
/// One efficiency grade — the native port of the web <c>Grade</c> (web/src/lib/drivesAggregation.ts). <see cref="Label"/>
/// is the display letter (<c>A+</c>…<c>D</c> or the em-dash for ungraded), <see cref="ColorHex"/> the per-badge hex from
/// the shared palette, and <see cref="Numeric"/> the averaging weight (null for ungraded drives so callers skip them).
/// </summary>
/// <param name="Label">The display grade label.</param>
/// <param name="ColorHex">The badge hex colour (shared web palette).</param>
/// <param name="Numeric">The averaging weight, or null when ungraded.</param>
public readonly record struct DriveGrade(string Label, string ColorHex, double? Numeric);

/// <summary>
/// One parsed drive from <c>GET /drives?vehicle_id={id}</c> — the native analogue of the web <c>Drive</c> type
/// (web/src/types/driving.ts). Every distance/speed/power/energy field is SI (meters, m/s, watts, watt-hours) exactly
/// as stored — conversion happens only at the render boundary by <see cref="DrivesListProjection"/>. Parsing is
/// null-tolerant so a partial wire object never throws (mirrors the web optional-field reads).
/// </summary>
public sealed record DriveListItem(
    long Id,
    DateTimeOffset? StartTs,
    DateTimeOffset? EndTs,
    double DistanceM,
    double DurationS,
    double? AvgSpeedMps,
    double? MaxSpeedMps,
    double? StartBatteryPct,
    double? EndBatteryPct,
    double? EnergyUsedWh,
    double? AvgPowerW,
    string? StartAddress,
    string? EndAddress,
    double? StartLat,
    double? StartLon,
    double? EndLat,
    double? EndLon)
{
    /// <summary>Parse the drives wire body (a bare array or <c>{ "drives": [...] }</c>) into a tolerant list.</summary>
    /// <param name="root">The parsed <c>GET /drives</c> body.</param>
    /// <returns>The parsed rows (empty when the body has no array).</returns>
    public static IReadOnlyList<DriveListItem> ParseList(JsonElement root)
    {
        JsonElement array = root;
        if (root.ValueKind == JsonValueKind.Object && root.TryGetProperty("drives", out var inner))
        {
            array = inner;
        }

        if (array.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<DriveListItem>();
        }

        var list = new List<DriveListItem>(array.GetArrayLength());
        foreach (var item in array.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Project one drive JSON object into a tolerant row (snake_case wire shape, no camelCaseKeys on native).</summary>
    /// <param name="obj">One drive object from the list.</param>
    /// <returns>The parsed, null-tolerant row.</returns>
    public static DriveListItem FromJson(JsonElement obj) => new(
        GetLong(obj, "id"),
        GetDate(obj, "start_ts"),
        GetDate(obj, "end_ts"),
        GetDouble(obj, "distance_m") ?? 0,
        GetDouble(obj, "duration_s") ?? 0,
        GetDouble(obj, "avg_speed_mps"),
        GetDouble(obj, "max_speed_mps"),
        GetDouble(obj, "start_battery_pct"),
        GetDouble(obj, "end_battery_pct"),
        GetDouble(obj, "energy_used_wh"),
        GetDouble(obj, "avg_power_w"),
        GetString(obj, "start_address"),
        GetString(obj, "end_address"),
        GetDouble(obj, "start_lat"),
        GetDouble(obj, "start_lon"),
        GetDouble(obj, "end_lat"),
        GetDouble(obj, "end_lon"));

    private static long GetLong(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return 0;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetInt64(out var n) => n,
            JsonValueKind.String when long.TryParse(v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) => n,
            _ => 0,
        };
    }

    private static double? GetDouble(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetDouble(out var n) && !double.IsNaN(n) && !double.IsInfinity(n) => n,
            JsonValueKind.String when double.TryParse(v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }

    private static string? GetString(JsonElement obj, string name)
    {
        if (obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String)
        {
            string? s = v.GetString();
            return string.IsNullOrEmpty(s) ? null : s;
        }

        return null;
    }

    private static DateTimeOffset? GetDate(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            v.GetString(),
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var dt)
            ? dt
            : null;
    }
}

/// <summary>
/// Period roll-up over a window of drives — the native port of the web <c>PeriodStats</c>
/// (web/src/lib/drivesAggregation.ts). All sums are SI (meters, seconds, Wh/km, kWh); display conversion happens only
/// in the projection.
/// </summary>
/// <param name="Count">Number of drives in the window.</param>
/// <param name="TotalDistanceM">Sum of distance in SI meters.</param>
/// <param name="TotalDurationS">Sum of duration in SI seconds.</param>
/// <param name="AvgEfficiencyWhKm">Average efficiency in Wh/km, or null when ungradable.</param>
/// <param name="BestEfficiencyWhKm">Best (lowest) efficiency in Wh/km, or null.</param>
/// <param name="TopSpeedMps">Top instantaneous speed in m/s.</param>
/// <param name="LongestDistanceM">Distance of the longest single drive (SI meters).</param>
/// <param name="AvgGradeNumeric">Average grade weight, ready for <see cref="DrivesAggregation.GradeFromNumeric"/>.</param>
/// <param name="TotalEnergyKwh">Total energy used (kWh) summed from per-drive battery delta.</param>
public sealed record DrivesPeriodStats(
    int Count,
    double TotalDistanceM,
    double TotalDurationS,
    double? AvgEfficiencyWhKm,
    double? BestEfficiencyWhKm,
    double TopSpeedMps,
    double LongestDistanceM,
    double? AvgGradeNumeric,
    double TotalEnergyKwh);

/// <summary>
/// Pure aggregation helpers for the Drives page — the native port of the web <c>lib/drivesAggregation.ts</c> surface
/// (efficiency + grade ladder, period stats, prior period, anomaly / notable / commute detection, daily trend, day
/// keys). Inputs are SI-canonical so callers convert at the display edge. No WinUI types, so the whole module is
/// unit-tested headlessly.
/// </summary>
public static class DrivesAggregation
{
    /// <summary>The green A/A+ grade hex (web <c>GRADE_PALETTE</c>).</summary>
    public const string ColorGreen = "#10b981";

    /// <summary>The cyan B-grade hex (web palette).</summary>
    public const string ColorCyan = "#00f0ff";

    /// <summary>The amber C-grade hex (web palette).</summary>
    public const string ColorAmber = "#f59e0b";

    /// <summary>The red D-grade hex (web palette).</summary>
    public const string ColorRed = "#ef4444";

    /// <summary>The grey ungraded hex (web palette).</summary>
    public const string ColorGrey = "#6b7280";

    /// <summary>The em-dash label for an ungraded drive.</summary>
    public const string EmDash = "\u2014";

    /// <summary>
    /// Per-drive efficiency in Wh/km (web <c>getEfficiency</c>). Null when the drive lacks the inputs (no battery
    /// delta, zero distance).
    /// </summary>
    /// <param name="drive">The drive to measure.</param>
    public static double? GetEfficiency(DriveListItem drive)
    {
        ArgumentNullException.ThrowIfNull(drive);
        var batteryUsed = (drive.StartBatteryPct ?? 0) - (drive.EndBatteryPct ?? 0);
        if (drive.DistanceM > 0 && batteryUsed > 0)
        {
            return batteryUsed * 0.75 * 1000.0 / (drive.DistanceM / 1000.0);
        }

        return null;
    }

    /// <summary>Map an efficiency value (Wh/km) to a letter grade (web <c>gradeFromEfficiency</c>; lower is better).</summary>
    /// <param name="eff">The efficiency in Wh/km, or null.</param>
    public static DriveGrade GradeFromEfficiency(double? eff)
    {
        if (eff is not { } e)
        {
            return new DriveGrade(EmDash, ColorGrey, null);
        }

        if (e < 130)
        {
            return new DriveGrade("A+", ColorGreen, 4.5);
        }

        if (e < 160)
        {
            return new DriveGrade("A", ColorGreen, 4.0);
        }

        if (e < 190)
        {
            return new DriveGrade("B", ColorCyan, 3.0);
        }

        if (e < 220)
        {
            return new DriveGrade("C", ColorAmber, 2.0);
        }

        return new DriveGrade("D", ColorRed, 1.0);
    }

    /// <summary>Map a numeric grade weight back to a letter grade (web <c>gradeFromNumeric</c>).</summary>
    /// <param name="numeric">The averaged grade weight, or null.</param>
    public static DriveGrade GradeFromNumeric(double? numeric)
    {
        if (numeric is not { } n || double.IsNaN(n) || double.IsInfinity(n))
        {
            return new DriveGrade(EmDash, ColorGrey, null);
        }

        if (n >= 4.25)
        {
            return new DriveGrade("A+", ColorGreen, 4.5);
        }

        if (n >= 3.5)
        {
            return new DriveGrade("A", ColorGreen, 4.0);
        }

        if (n >= 2.5)
        {
            return new DriveGrade("B", ColorCyan, 3.0);
        }

        if (n >= 1.5)
        {
            return new DriveGrade("C", ColorAmber, 2.0);
        }

        return new DriveGrade("D", ColorRed, 1.0);
    }

    /// <summary>The inclusive day-range filter (web <c>inDateRange</c>); both bounds compared as <c>yyyy-MM-dd</c> keys.</summary>
    /// <param name="drive">The drive under test.</param>
    /// <param name="startDate">Inclusive start day key, or null/empty for no lower bound.</param>
    /// <param name="endDate">Inclusive end day key, or null/empty for no upper bound.</param>
    public static bool InDateRange(DriveListItem drive, string? startDate, string? endDate)
    {
        ArgumentNullException.ThrowIfNull(drive);
        var day = DayKey(drive);
        if (day is null)
        {
            return true;
        }

        if (!string.IsNullOrEmpty(startDate) && string.CompareOrdinal(day, startDate) < 0)
        {
            return false;
        }

        if (!string.IsNullOrEmpty(endDate) && string.CompareOrdinal(day, endDate) > 0)
        {
            return false;
        }

        return true;
    }

    /// <summary>Aggregate a window of drives into headline stats (web <c>computePeriodStats</c>).</summary>
    /// <param name="drives">The drives to aggregate.</param>
    /// <param name="startDate">Optional inclusive start day key.</param>
    /// <param name="endDate">Optional inclusive end day key.</param>
    public static DrivesPeriodStats ComputePeriodStats(IReadOnlyList<DriveListItem> drives, string? startDate, string? endDate)
    {
        ArgumentNullException.ThrowIfNull(drives);
        int count = 0;
        double totalDistanceM = 0;
        double totalDurationS = 0;
        double topSpeedMps = 0;
        double longestDistanceM = 0;
        double effSum = 0;
        int effN = 0;
        double? bestEff = null;
        double gradeSum = 0;
        int gradeN = 0;
        double totalEnergyKwh = 0;

        foreach (var d in drives)
        {
            if (!InDateRange(d, startDate, endDate))
            {
                continue;
            }

            count += 1;
            totalDistanceM += d.DistanceM;
            totalDurationS += d.DurationS;
            if ((d.MaxSpeedMps ?? 0) > topSpeedMps)
            {
                topSpeedMps = d.MaxSpeedMps ?? 0;
            }

            if (d.DistanceM > longestDistanceM)
            {
                longestDistanceM = d.DistanceM;
            }

            var eff = GetEfficiency(d);
            if (eff is { } e)
            {
                effSum += e;
                effN += 1;
                if (bestEff is null || e < bestEff)
                {
                    bestEff = e;
                }
            }

            var grade = GradeFromEfficiency(eff);
            if (grade.Numeric is { } weight)
            {
                gradeSum += weight;
                gradeN += 1;
            }

            if (d.StartBatteryPct is { } start && d.EndBatteryPct is { } end && start > end)
            {
                totalEnergyKwh += (start - end) * 0.75;
            }
        }

        return new DrivesPeriodStats(
            count,
            totalDistanceM,
            totalDurationS,
            effN > 0 ? effSum / effN : null,
            bestEff,
            topSpeedMps,
            longestDistanceM,
            gradeN > 0 ? gradeSum / gradeN : null,
            totalEnergyKwh);
    }

    /// <summary>The equal-length window immediately before <c>[startDate, endDate]</c> (web <c>priorPeriod</c>).</summary>
    /// <param name="startDate">Inclusive current start day key.</param>
    /// <param name="endDate">Inclusive current end day key.</param>
    /// <returns>The prior window, or null for malformed input.</returns>
    public static (string Start, string End)? PriorPeriod(string? startDate, string? endDate)
    {
        if (string.IsNullOrEmpty(startDate) || string.IsNullOrEmpty(endDate))
        {
            return null;
        }

        if (!TryYmdToUtc(startDate, out var startMs) || !TryYmdToUtc(endDate, out var endMs))
        {
            return null;
        }

        var lengthDays = Math.Max(1, (long)Math.Round((endMs - startMs).TotalDays) + 1);
        var priorEnd = startMs.AddDays(-1);
        var priorStart = priorEnd.AddDays(-(lengthDays - 1));
        return (priorStart.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), priorEnd.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
    }

    /// <summary>Drives whose efficiency grade is D — the worst tier (web <c>detectAnomalies</c>).</summary>
    /// <param name="drives">The drives to scan.</param>
    public static List<DriveListItem> DetectAnomalies(IReadOnlyList<DriveListItem> drives)
    {
        ArgumentNullException.ThrowIfNull(drives);
        return drives.Where(d => GradeFromEfficiency(GetEfficiency(d)).Label == "D").ToList();
    }

    /// <summary>Top-decile-by-distance OR grade-A+ drives, decile pool capped at 50 (web <c>detectNotable</c>).</summary>
    /// <param name="drives">The drives to scan.</param>
    public static List<DriveListItem> DetectNotable(IReadOnlyList<DriveListItem> drives)
    {
        ArgumentNullException.ThrowIfNull(drives);
        if (drives.Count == 0)
        {
            return new List<DriveListItem>();
        }

        var sorted = drives.OrderByDescending(d => d.DistanceM).ToList();
        var cutoff = Math.Min(50, Math.Max(1, (int)Math.Ceiling(drives.Count * 0.1)));
        var longTrips = new HashSet<long>(sorted.Take(cutoff).Select(d => d.Id));

        var result = new List<DriveListItem>();
        var seen = new HashSet<long>();
        foreach (var d in drives)
        {
            var isAplus = GradeFromEfficiency(GetEfficiency(d)).Label == "A+";
            if ((longTrips.Contains(d.Id) || isAplus) && seen.Add(d.Id))
            {
                result.Add(d);
            }
        }

        return result;
    }

    /// <summary>Drives belonging to a recurring origin↔destination pair (web <c>detectCommutes</c>).</summary>
    /// <param name="drives">The drives to scan.</param>
    /// <param name="minOccurrences">Minimum pair occurrences before it counts as a commute (web default 3).</param>
    public static List<DriveListItem> DetectCommutes(IReadOnlyList<DriveListItem> drives, int minOccurrences = 3)
    {
        ArgumentNullException.ThrowIfNull(drives);
        var counts = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var d in drives)
        {
            var key = PairKey(d);
            if (key is null)
            {
                continue;
            }

            counts[key] = counts.TryGetValue(key, out var n) ? n + 1 : 1;
        }

        return drives.Where(d =>
        {
            var key = PairKey(d);
            return key is not null && counts.TryGetValue(key, out var n) && n >= minOccurrences;
        }).ToList();
    }

    /// <summary>Daily aggregation of a trend metric across the drives (web <c>dailyTrend</c>), sorted ascending by day.</summary>
    /// <param name="drives">The drives to aggregate.</param>
    /// <param name="metric">The metric key (drives / distance / score / efficiency / cost).</param>
    public static IReadOnlyList<(string Date, double Value)> DailyTrend(IReadOnlyList<DriveListItem> drives, string metric)
    {
        ArgumentNullException.ThrowIfNull(drives);
        var buckets = new Dictionary<string, (double Sum, int Count)>(StringComparer.Ordinal);
        foreach (var d in drives)
        {
            var day = DayKey(d);
            if (day is null)
            {
                continue;
            }

            (double Sum, int Count) b = buckets.TryGetValue(day, out var existing) ? existing : (0.0, 0);
            switch (metric)
            {
                case "drives":
                    b.Sum += 1;
                    break;
                case "distance":
                    b.Sum += d.DistanceM;
                    break;
                case "efficiency":
                    if (GetEfficiency(d) is { } eff)
                    {
                        b.Sum += eff;
                        b.Count += 1;
                    }

                    break;
                case "score":
                    if (GradeFromEfficiency(GetEfficiency(d)).Numeric is { } weight)
                    {
                        b.Sum += weight;
                        b.Count += 1;
                    }

                    break;
                case "cost":
                    if (d.StartBatteryPct is { } start && d.EndBatteryPct is { } end && start > end)
                    {
                        b.Sum += (start - end) * 0.75;
                    }

                    break;
                default:
                    break;
            }

            buckets[day] = b;
        }

        var points = new List<(string Date, double Value)>(buckets.Count);
        foreach (var (date, b) in buckets)
        {
            double value = metric is "efficiency" or "score"
                ? (b.Count > 0 ? b.Sum / b.Count : 0)
                : b.Sum;
            points.Add((date, value));
        }

        points.Sort((a, b) => string.CompareOrdinal(a.Date, b.Date));
        return points;
    }

    /// <summary>The <c>yyyy-MM-dd</c> day key for a drive's start instant, or null when absent (web <c>localDayKey</c>).</summary>
    /// <param name="drive">The drive whose start day to key.</param>
    public static string? DayKey(DriveListItem drive)
    {
        ArgumentNullException.ThrowIfNull(drive);
        if (drive.StartTs is not { } ts)
        {
            return null;
        }

        return ts.UtcDateTime.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
    }

    private static string? PairKey(DriveListItem d)
    {
        var a = Normalise(d.StartAddress);
        var b = Normalise(d.EndAddress);
        if (a is null || b is null)
        {
            return null;
        }

        return string.CompareOrdinal(a, b) < 0 ? string.Concat(a, "::", b) : string.Concat(b, "::", a);
    }

    private static string? Normalise(string? addr)
    {
        if (string.IsNullOrWhiteSpace(addr))
        {
            return null;
        }

        var collapsed = System.Text.RegularExpressions.Regex.Replace(addr.Trim().ToLowerInvariant(), "\\s+", " ");
        return collapsed.Length == 0 ? null : collapsed;
    }

    private static bool TryYmdToUtc(string key, out DateTime utc) =>
        DateTime.TryParseExact(key, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out utc);
}

/// <summary>
/// Canonical metadata + cache-key helpers for the Drives-list page — the native mirror of the web page at
/// <c>web/src/features/driving/pages/DrivesListPage.tsx</c> (route <c>/drives</c>, nav name <c>Drives</c>). Holds the
/// route name, the two generated operation ids it binds to, the diagnostics slug and the Fluent affordance glyphs.
/// </summary>
public static class DrivesListRegistration
{
    /// <summary>The navigation route name the shell page factory registers this page under (matches RouteTable <c>drives</c>).</summary>
    public const string RouteName = "Drives";

    /// <summary>The web route path (web <c>/drives</c>).</summary>
    public const string Route = "drives";

    /// <summary>The diagnostics slug (web component family).</summary>
    public const string Slug = "DrivesListPage";

    /// <summary>The cache-key prefix for the cache-then-network drive read.</summary>
    public const string CacheKeyPrefix = "drives:list";

    /// <summary>The generated operation id for the drive list read (web <c>useDrives</c>).</summary>
    public const string DrivesOperation = "get_api_v1_drives";

    /// <summary>The generated operation id for the bulk delete (web <c>useBulkDeleteDrives</c> → <c>DELETE /drives/bulk</c>).</summary>
    public const string BulkDeleteOperation = "delete_api_v1_drives_bulk";

    /// <summary>The Fluent route glyph (Segoe car/route; empty-state icon).</summary>
    public const string RouteGlyph = "\uE7C0";

    /// <summary>The Fluent glyph for the export affordances (web Download icon).</summary>
    public const string ExportGlyph = "\uE74E";

    /// <summary>The Fluent glyph for the bulk-delete affordance (web Trash icon).</summary>
    public const string DeleteGlyph = "\uE74D";
}

/// <summary>
/// PII-safe diagnostics sink for the Drives-list page — records only the <c>view.opened</c> event (no places,
/// distances, efficiencies or ids), mirroring the established W7 page diagnostics contract. Thread-safe.
/// </summary>
public sealed class DrivesListDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the diagnostics sink over an optional line writer (null = count only).</summary>
    /// <param name="sink">Receives each PII-safe diagnostic line; null counts without emitting.</param>
    public DrivesListDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>The number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(string.Create(CultureInfo.InvariantCulture, $"view.opened slug={DrivesListRegistration.Slug}"));
    }
}
