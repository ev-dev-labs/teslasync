using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.SharedSurfaces;

namespace TeslaSync.App.FeatureViews.Charging;

/// <summary>
/// The mutually-exclusive lifecycle state the <see cref="ChargingListPageViewModel"/> renders for its charging
/// sessions source — the native union of the web Charging-list page's branches
/// (web/src/features/charging/pages/ChargingListPage.tsx): the <c>isLoading</c> skeletons, the resolved-but-empty
/// range (<c>currentStats.count === 0</c>), the retriable <c>QueryError</c> surface, and the populated section
/// stack (overview KPIs, trend chart, collections, session list, pager). Every branch maps onto a visible region;
/// none is ever blank.
/// </summary>
public enum ChargingListState
{
    /// <summary>The first load with no cached snapshot (web <c>isLoading</c> skeletons).</summary>
    Loading,

    /// <summary>A resolved snapshot with no sessions in range (web <c>currentStats.count === 0</c> empty state).</summary>
    Empty,

    /// <summary>A hard transport failure with no cached rows (web <c>QueryError</c> retriable surface).</summary>
    Error,

    /// <summary>A resolved snapshot with at least one session (web populated section stack).</summary>
    Success,
}

/// <summary>Coarse charger category — the native port of the web <c>getChargerCategory()</c> buckets.</summary>
public enum ChargerCategory
{
    /// <summary>Home / AC / wall (null type historically means home AC).</summary>
    Home,

    /// <summary>Supercharger / TPC.</summary>
    Supercharger,

    /// <summary>DC fast / CCS / CHAdeMO.</summary>
    Dc,

    /// <summary>Unrecognised charger type.</summary>
    Unknown,
}

/// <summary>One selectable session collection (web <c>COLLECTIONS</c> allowlist).</summary>
public enum ChargingCollectionKind
{
    /// <summary>All sessions in range.</summary>
    All,

    /// <summary>Home AC sessions.</summary>
    Home,

    /// <summary>Supercharger sessions.</summary>
    Supercharger,

    /// <summary>DC fast sessions.</summary>
    Dc,

    /// <summary>Free (no recorded cost) sessions.</summary>
    Free,

    /// <summary>Detected anomalous sessions.</summary>
    Anomalies,

    /// <summary>Notable (top-energy / fast) sessions.</summary>
    Notable,

    /// <summary>Tagged sessions (web parity: always empty / disabled).</summary>
    Tagged,
}

/// <summary>The active sort field for the session list (web <c>SORT_FIELDS</c> allowlist).</summary>
public enum ChargingSortField
{
    /// <summary>Sort by start instant.</summary>
    Date,

    /// <summary>Sort by energy added.</summary>
    Energy,

    /// <summary>Sort by cost.</summary>
    Cost,

    /// <summary>Sort by elapsed duration.</summary>
    Duration,

    /// <summary>Sort by average power.</summary>
    Power,
}

/// <summary>
/// One parsed charging session from <c>GET /charging</c> — the native analogue of the web <c>ChargingSession</c>
/// type (web/src/api/types.ts). Every numeric field is SI on the wire (watt-hours, watts, percent) and is
/// converted only at the display boundary by <see cref="ChargingListProjection"/>. Parsing is null-tolerant so a
/// partial row never throws (mirrors the web <c>safeArray</c> + optional-field reads).
/// </summary>
public sealed record ChargingListSession(
    long Id,
    DateTimeOffset? StartedAt,
    DateTimeOffset? EndedAt,
    string? ChargerType,
    double TotalEnergyAddedWh,
    double? CostDecimal,
    double? PeakPowerW,
    double? AvgPowerW,
    double? StartSocPct,
    double? EndSocPct,
    double? OdometerStartM,
    double? OdometerEndM,
    string? StartPlace,
    double? StartLat,
    double? StartLng)
{
    /// <summary>Parse a charging-session JSON array into a tolerant list, preserving server order.</summary>
    /// <param name="element">The parsed <c>GET /charging</c> body.</param>
    /// <returns>The parsed rows (empty when the body is not an array).</returns>
    public static IReadOnlyList<ChargingListSession> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<ChargingListSession>();
        }

        var list = new List<ChargingListSession>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Project a single session JSON object into a tolerant row.</summary>
    /// <param name="obj">One session object from the list.</param>
    /// <returns>The parsed, null-tolerant row.</returns>
    public static ChargingListSession FromJson(JsonElement obj) => new(
        GetLong(obj, "id"),
        GetDateTime(obj, "started_at"),
        GetDateTime(obj, "ended_at"),
        GetString(obj, "charger_type"),
        GetDouble(obj, "total_energy_added_wh") ?? 0,
        GetDouble(obj, "cost_decimal"),
        GetDouble(obj, "peak_power_w"),
        GetDouble(obj, "avg_power_w"),
        GetDouble(obj, "start_soc_pct"),
        GetDouble(obj, "end_soc_pct"),
        GetDouble(obj, "start_odometer_m"),
        GetDouble(obj, "end_odometer_m"),
        GetString(obj, "start_place"),
        GetDouble(obj, "start_lat"),
        GetDouble(obj, "start_lng"));

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

    private static string? GetString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static DateTimeOffset? GetDateTime(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            v.GetString(),
            CultureInfo.InvariantCulture,
            DateTimeStyles.RoundtripKind,
            out var dt)
            ? dt
            : null;
    }
}

/// <summary>
/// Period roll-up over a window of sessions — the native port of the web <c>ChargingPeriodStats</c>
/// (web/src/lib/chargingAggregation.ts). All sums are SI (watt-hours, decimal currency, minutes); display
/// conversion happens only in the projection.
/// </summary>
/// <param name="Count">Number of sessions in the window.</param>
/// <param name="TotalEnergyWh">Sum of energy added in SI watt-hours.</param>
/// <param name="TotalCost">Sum of decimal cost in the user's currency.</param>
/// <param name="TotalDurationMin">Sum of elapsed minutes.</param>
/// <param name="AvgRateKw">Average kWh/hr across the window, or null.</param>
/// <param name="AvgDurationMin">Average minutes per session, or null.</param>
/// <param name="AvgPowerW">Average power in SI watts, or null.</param>
/// <param name="MostCommonStartHour">Modal start hour-of-day (0..23), or null.</param>
/// <param name="HomeCount">Home-category session count.</param>
/// <param name="SuperchargerCount">Supercharger-category session count.</param>
/// <param name="DcCount">DC-category session count.</param>
/// <param name="FreeCount">Free (null/zero cost) session count.</param>
/// <param name="BatteryFriendlyScore">0..100 battery-friendliness score, or null.</param>
public sealed record ChargingPeriodStats(
    int Count,
    double TotalEnergyWh,
    double TotalCost,
    double TotalDurationMin,
    double? AvgRateKw,
    double? AvgDurationMin,
    double? AvgPowerW,
    int? MostCommonStartHour,
    int HomeCount,
    int SuperchargerCount,
    int DcCount,
    int FreeCount,
    double? BatteryFriendlyScore);

/// <summary>One detected anomaly — the native port of the web <c>ChargingAnomaly</c> (first matching rule wins).</summary>
/// <param name="Session">The flagged session.</param>
/// <param name="Kind">The anomaly kind key (telemetry_gap / cost_zero / bad_power / expensive / trickle).</param>
/// <param name="Message">The user-facing message, already formatted.</param>
public sealed record ChargingAnomaly(ChargingListSession Session, string Kind, string Message);

/// <summary>
/// Pure aggregation helpers for the Charging Sessions page — the native port of the web
/// <c>lib/chargingAggregation.ts</c> surface (charger category, session helpers, period stats, anomaly + notable
/// detection, daily trend). Inputs are SI-canonical so callers convert at the display edge. No WinUI types, so the
/// whole module is unit-tested headlessly.
/// </summary>
public static class ChargingAggregation
{
    private const double ExpensiveCostPerKwh = 0.5;
    private const double TricklePowerKw = 5;
    private const double TrickleMinDurationMin = 360;

    /// <summary>Map a raw <c>charger_type</c> string into a coarse <see cref="ChargerCategory"/> (web parity).</summary>
    /// <param name="type">The raw charger type (null historically means home AC).</param>
    public static ChargerCategory GetChargerCategory(string? type)
    {
        if (string.IsNullOrEmpty(type))
        {
            return ChargerCategory.Home;
        }

        var t = type.ToLowerInvariant();
        if (t.Contains("super", StringComparison.Ordinal) || t.Contains("tpc", StringComparison.Ordinal))
        {
            return ChargerCategory.Supercharger;
        }

        if (t.Contains("dc", StringComparison.Ordinal) || t.Contains("ccs", StringComparison.Ordinal) ||
            t.Contains("chademo", StringComparison.Ordinal) || t.Contains("fast", StringComparison.Ordinal))
        {
            return ChargerCategory.Dc;
        }

        if (t.Contains("home", StringComparison.Ordinal) || t.Contains("ac", StringComparison.Ordinal) ||
            t.Contains("wall", StringComparison.Ordinal))
        {
            return ChargerCategory.Home;
        }

        return ChargerCategory.Unknown;
    }

    /// <summary>Elapsed minutes between start and end; 0 for in-progress / malformed timestamps (web parity).</summary>
    /// <param name="session">The session to measure.</param>
    public static double DurationMinutes(ChargingListSession session)
    {
        ArgumentNullException.ThrowIfNull(session);
        if (session.StartedAt is not { } start || session.EndedAt is not { } end)
        {
            return 0;
        }

        var minutes = (end - start).TotalMinutes;
        return minutes <= 0 ? 0 : minutes;
    }

    /// <summary>Average power in SI watts: energy over elapsed hours, falling back to <c>avg_power_w</c> (web parity).</summary>
    /// <param name="session">The session to measure.</param>
    public static double AvgPowerW(ChargingListSession session)
    {
        ArgumentNullException.ThrowIfNull(session);
        var minutes = DurationMinutes(session);
        if (minutes > 0 && session.TotalEnergyAddedWh > 0)
        {
            return session.TotalEnergyAddedWh / (minutes / 60.0);
        }

        return session.AvgPowerW ?? 0;
    }

    /// <summary>Cost per kWh for one session, or null when free / unknown / zero-energy (web parity).</summary>
    /// <param name="session">The session to measure.</param>
    public static double? CostPerKwh(ChargingListSession session)
    {
        ArgumentNullException.ThrowIfNull(session);
        if (session.TotalEnergyAddedWh <= 0)
        {
            return null;
        }

        if (session.CostDecimal is not { } cost || cost <= 0)
        {
            return null;
        }

        return cost / (session.TotalEnergyAddedWh / 1000.0);
    }

    /// <summary>"Battery-friendly" 0..100 score for a window, or null when no session is scorable (web parity).</summary>
    /// <param name="sessions">The window of sessions.</param>
    public static double? BatteryFriendlyScore(IReadOnlyList<ChargingListSession> sessions)
    {
        ArgumentNullException.ThrowIfNull(sessions);
        double total = 0;
        int n = 0;
        foreach (var s in sessions)
        {
            if (s.StartSocPct is not { } start || s.EndSocPct is not { } end)
            {
                continue;
            }

            n += 1;
            double score = 50;
            if (start <= 30)
            {
                score += 30;
            }
            else if (start <= 50)
            {
                score += 15;
            }
            else if (start > 70)
            {
                score -= 10;
            }

            if (end <= 80)
            {
                score += 20;
            }
            else if (end > 90 && end < 100)
            {
                score -= 10;
            }
            else if (end >= 100)
            {
                score -= 25;
            }

            total += Math.Max(0, Math.Min(100, score));
        }

        return n > 0 ? total / n : null;
    }

    /// <summary>Inclusive day-bucket key (<c>yyyy-MM-dd</c>) at the session's own offset, or null.</summary>
    /// <param name="session">The session to key.</param>
    public static string? DayKey(ChargingListSession session)
    {
        ArgumentNullException.ThrowIfNull(session);
        return session.StartedAt is { } dt ? dt.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) : null;
    }

    /// <summary>True when the session's start day falls inclusively within the requested range.</summary>
    /// <param name="session">The session under test.</param>
    /// <param name="startDate">Inclusive start day (<c>yyyy-MM-dd</c>), or null for open.</param>
    /// <param name="endDate">Inclusive end day (<c>yyyy-MM-dd</c>), or null for open.</param>
    public static bool InDateRange(ChargingListSession session, string? startDate, string? endDate)
    {
        var day = DayKey(session);
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

    /// <summary>Compute the period roll-up over the window matching the requested range (web parity).</summary>
    /// <param name="sessions">The full session snapshot.</param>
    /// <param name="startDate">Inclusive start day, or null.</param>
    /// <param name="endDate">Inclusive end day, or null.</param>
    public static ChargingPeriodStats ComputeChargingPeriodStats(
        IReadOnlyList<ChargingListSession> sessions,
        string? startDate,
        string? endDate)
    {
        ArgumentNullException.ThrowIfNull(sessions);

        int count = 0;
        double totalEnergyWh = 0;
        double totalCost = 0;
        double totalDurationMin = 0;
        double powerSum = 0;
        int powerN = 0;
        int freeCount = 0;
        int home = 0, sc = 0, dc = 0;
        var hourCounts = new int[24];
        var inWindow = new List<ChargingListSession>();

        foreach (var s in sessions)
        {
            if (!InDateRange(s, startDate, endDate))
            {
                continue;
            }

            count += 1;
            inWindow.Add(s);
            totalEnergyWh += s.TotalEnergyAddedWh;
            totalCost += s.CostDecimal ?? 0;
            totalDurationMin += DurationMinutes(s);
            var p = AvgPowerW(s);
            if (p > 0)
            {
                powerSum += p;
                powerN += 1;
            }

            switch (GetChargerCategory(s.ChargerType))
            {
                case ChargerCategory.Home: home += 1; break;
                case ChargerCategory.Supercharger: sc += 1; break;
                case ChargerCategory.Dc: dc += 1; break;
                default: break;
            }

            if (s.CostDecimal is null || s.CostDecimal == 0)
            {
                freeCount += 1;
            }

            if (s.StartedAt is { } dt)
            {
                hourCounts[dt.Hour % 24] += 1;
            }
        }

        int? modalHour = null;
        int best = 0;
        for (int h = 0; h < 24; h++)
        {
            if (hourCounts[h] > best)
            {
                best = hourCounts[h];
                modalHour = h;
            }
        }

        return new ChargingPeriodStats(
            count,
            totalEnergyWh,
            totalCost,
            totalDurationMin,
            totalDurationMin > 0 ? totalEnergyWh / 1000.0 / (totalDurationMin / 60.0) : null,
            count > 0 ? totalDurationMin / count : null,
            powerN > 0 ? powerSum / powerN : null,
            modalHour,
            home,
            sc,
            dc,
            freeCount,
            BatteryFriendlyScore(inWindow));
    }

    /// <summary>Compute the immediately-preceding window of equal length, or null when the range is open.</summary>
    /// <param name="startDate">Inclusive start day (<c>yyyy-MM-dd</c>).</param>
    /// <param name="endDate">Inclusive end day (<c>yyyy-MM-dd</c>).</param>
    public static (string Start, string End)? PriorPeriod(string? startDate, string? endDate)
    {
        if (!TryParseDay(startDate, out var start) || !TryParseDay(endDate, out var end) || end < start)
        {
            return null;
        }

        var days = (end - start).Days + 1;
        var priorEnd = start.AddDays(-1);
        var priorStart = priorEnd.AddDays(-(days - 1));
        return (priorStart.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                priorEnd.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
    }

    private static bool TryParseDay(string? value, out DateTime day) =>
        DateTime.TryParseExact(value, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out day);

    /// <summary>
    /// Detect anomalies in a window — the native port of the web <c>detectChargingAnomalies</c>. Each session
    /// yields at most one anomaly (priority order: telemetry_gap → cost_zero → bad_power → expensive → trickle).
    /// </summary>
    /// <param name="sessions">The window of sessions, in original order.</param>
    /// <param name="currencySymbol">The currency symbol woven into the "expensive" message.</param>
    public static IReadOnlyList<ChargingAnomaly> DetectChargingAnomalies(
        IReadOnlyList<ChargingListSession> sessions,
        string currencySymbol)
    {
        ArgumentNullException.ThrowIfNull(sessions);
        var symbol = string.IsNullOrEmpty(currencySymbol) ? "$" : currencySymbol;
        var outList = new List<ChargingAnomaly>();
        foreach (var s in sessions)
        {
            var dur = DurationMinutes(s);
            var energyKwh = s.TotalEnergyAddedWh / 1000.0;
            var power = AvgPowerW(s) / 1000.0;
            var cpk = CostPerKwh(s);

            if (energyKwh < 0.1 && dur > 5)
            {
                outList.Add(new ChargingAnomaly(
                    s, "telemetry_gap", string.Create(CultureInfo.InvariantCulture, $"0 kWh added in {FormatDurationShort(dur)} — telemetry gap?")));
                continue;
            }

            if (energyKwh > 1 && (s.CostDecimal is null || s.CostDecimal == 0) &&
                GetChargerCategory(s.ChargerType) != ChargerCategory.Home)
            {
                outList.Add(new ChargingAnomaly(s, "cost_zero", "Energy added but no cost recorded"));
                continue;
            }

            if (GetChargerCategory(s.ChargerType) == ChargerCategory.Dc && dur > 30 && power < 3)
            {
                outList.Add(new ChargingAnomaly(
                    s, "bad_power", string.Create(CultureInfo.InvariantCulture, $"Low power for DC ({power.ToString("0.#", CultureInfo.InvariantCulture)} kW)")));
                continue;
            }

            if (cpk is { } cpkValue && cpkValue > ExpensiveCostPerKwh)
            {
                outList.Add(new ChargingAnomaly(
                    s, "expensive", string.Create(CultureInfo.InvariantCulture, $"Expensive charge ({symbol}{cpkValue.ToString("0.##", CultureInfo.InvariantCulture)}/kWh)")));
                continue;
            }

            if (dur > TrickleMinDurationMin && power < TricklePowerKw)
            {
                outList.Add(new ChargingAnomaly(
                    s, "trickle", string.Create(CultureInfo.InvariantCulture, $"Trickle charge ({power.ToString("0.#", CultureInfo.InvariantCulture)} kW for {FormatDurationShort(dur)})")));
                continue;
            }
        }

        return outList;
    }

    /// <summary>Notable sessions: top-decile by energy OR ≥150 kW peak — the native port of <c>detectNotableSessions</c>.</summary>
    /// <param name="sessions">The window of sessions, in original order.</param>
    public static IReadOnlyList<ChargingListSession> DetectNotableSessions(IReadOnlyList<ChargingListSession> sessions)
    {
        ArgumentNullException.ThrowIfNull(sessions);
        if (sessions.Count == 0)
        {
            return Array.Empty<ChargingListSession>();
        }

        var sorted = sessions.OrderByDescending(s => s.TotalEnergyAddedWh).ToList();
        var cutoff = Math.Min(50, Math.Max(1, (int)Math.Ceiling(sessions.Count * 0.1)));
        var topEnergy = new HashSet<long>(sorted.Take(cutoff).Select(s => s.Id));

        var result = new List<ChargingListSession>();
        var seen = new HashSet<long>();
        foreach (var s in sessions)
        {
            var isFast = (s.PeakPowerW ?? 0) >= 150_000;
            if ((topEnergy.Contains(s.Id) || isFast) && seen.Add(s.Id))
            {
                result.Add(s);
            }
        }

        return result;
    }

    /// <summary>Daily aggregation of one trend metric — the native port of <c>dailyChargingTrend</c> (sorted by day).</summary>
    /// <param name="sessions">The window of sessions.</param>
    /// <param name="metric">One of <c>sessions</c>, <c>energy</c>, <c>cost</c>, <c>power</c>.</param>
    public static IReadOnlyList<MetricPoint> DailyChargingTrend(
        IReadOnlyList<ChargingListSession> sessions,
        string metric)
    {
        ArgumentNullException.ThrowIfNull(sessions);
        ArgumentNullException.ThrowIfNull(metric);

        var buckets = new Dictionary<string, (double Sum, int Count)>(StringComparer.Ordinal);
        foreach (var s in sessions)
        {
            var day = DayKey(s);
            if (day is null)
            {
                continue;
            }

            buckets.TryGetValue(day, out var b);
            switch (metric)
            {
                case "sessions":
                    b.Sum += 1;
                    break;
                case "energy":
                    b.Sum += s.TotalEnergyAddedWh / 1000.0;
                    break;
                case "cost":
                    b.Sum += s.CostDecimal ?? 0;
                    break;
                case "power":
                    var p = AvgPowerW(s) / 1000.0;
                    if (p > 0)
                    {
                        b.Sum += p;
                        b.Count += 1;
                    }

                    break;
                default:
                    break;
            }

            buckets[day] = b;
        }

        return buckets
            .OrderBy(kv => kv.Key, StringComparer.Ordinal)
            .Select(kv => new MetricPoint(
                kv.Key,
                string.Equals(metric, "power", StringComparison.Ordinal)
                    ? (kv.Value.Count > 0 ? kv.Value.Sum / kv.Value.Count : 0)
                    : kv.Value.Sum))
            .ToList();
    }

    private static string FormatDurationShort(double minutes)
    {
        if (minutes < 60)
        {
            return string.Create(CultureInfo.InvariantCulture, $"{Math.Round(minutes)}m");
        }

        var h = (int)Math.Floor(minutes / 60);
        var m = (int)Math.Round(minutes - (h * 60));
        return m > 0
            ? string.Create(CultureInfo.InvariantCulture, $"{h}h {m}m")
            : string.Create(CultureInfo.InvariantCulture, $"{h}h");
    }
}
