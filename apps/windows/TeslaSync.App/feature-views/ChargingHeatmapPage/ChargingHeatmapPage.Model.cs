using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Charging;

/// <summary>
/// One charging session row from <c>GET /charging-sessions</c> (web <c>ChargingSession</c> in
/// web/src/api/types.ts), narrowed to the fields the Charging-Heatmap page reads — the start / end instants
/// that bin a session into the weekly grid and feed the duration stat, the SI energy added (watt-hours
/// exactly as the API stores it), the session cost and the start place that groups the top-locations chart.
/// Parsing is null-tolerant so a partial or schema-drifted row never throws (web parity: the page tolerates
/// undefined fields with <c>?? 0</c>). Pure data — no WinUI types — so the projection is unit-tested without a
/// UI host.
/// </summary>
public sealed record ChargingHeatmapSession(
    long Id,
    DateTimeOffset? StartedAt,
    DateTimeOffset? EndedAt,
    double? TotalEnergyAddedWh,
    double? CostDecimal,
    string? StartPlace)
{
    /// <summary>Project a single charging-session JSON object into a tolerant session record.</summary>
    public static ChargingHeatmapSession FromJson(JsonElement element) => new(
        Id: ChargingHeatmapJson.Long(element, "id") ?? 0,
        StartedAt: ChargingHeatmapJson.Instant(element, "started_at"),
        EndedAt: ChargingHeatmapJson.Instant(element, "ended_at"),
        TotalEnergyAddedWh: ChargingHeatmapJson.Double(element, "total_energy_added_wh"),
        CostDecimal: ChargingHeatmapJson.Double(element, "cost_decimal"),
        StartPlace: ChargingHeatmapJson.String(element, "start_place"));
}

/// <summary>
/// Null-tolerant <see cref="JsonElement"/> readers for the Charging-Heatmap page — every getter returns a
/// nullable rather than throwing so a partial or schema-drifted session row never aborts the parse (web
/// parity: the page tolerates undefined fields). WinUI-free so the parse is unit-tested without a UI host.
/// </summary>
internal static class ChargingHeatmapJson
{
    /// <summary>The string value of <paramref name="name"/>, or null when absent / not a JSON string.</summary>
    public static string? String(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object
        && obj.TryGetProperty(name, out var prop)
        && prop.ValueKind == JsonValueKind.String
            ? prop.GetString()
            : null;

    /// <summary>The numeric value of <paramref name="name"/>, tolerating a numeric or numeric-string field.</summary>
    public static double? Double(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var prop))
        {
            return null;
        }

        return prop.ValueKind switch
        {
            JsonValueKind.Number when prop.TryGetDouble(out var n) && !double.IsNaN(n) && !double.IsInfinity(n) => n,
            JsonValueKind.String when double.TryParse(prop.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var s) => s,
            _ => null,
        };
    }

    /// <summary>The integer value of <paramref name="name"/>, tolerating a numeric or numeric-string field.</summary>
    public static long? Long(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var prop))
        {
            return null;
        }

        return prop.ValueKind switch
        {
            JsonValueKind.Number when prop.TryGetInt64(out var n) => n,
            JsonValueKind.String when long.TryParse(prop.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var s) => s,
            _ => null,
        };
    }

    /// <summary>The timestamp value of <paramref name="name"/>, or null when absent / unparseable.</summary>
    public static DateTimeOffset? Instant(JsonElement obj, string name)
    {
        string? raw = String(obj, name);
        if (string.IsNullOrEmpty(raw))
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            raw,
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var instant)
            ? instant
            : null;
    }
}

/// <summary>
/// The parsed charging-sessions snapshot the page reads from <c>GET /charging-sessions</c> — the native mirror
/// of the web <c>useChargingSessionsPaginated</c> query result the page reduces into stats, the 7×24 grid and
/// the top-locations breakdown. <see cref="HasData"/> mirrors the web <c>sessions.length &gt; 0</c> gate (an
/// empty array → the page's zeroed empty layout). Pure data.
/// </summary>
public sealed record ChargingHeatmapSnapshot(IReadOnlyList<ChargingHeatmapSession> Sessions)
{
    /// <summary>The no-sessions snapshot — the parse fallback for an absent / non-array body.</summary>
    public static ChargingHeatmapSnapshot Empty { get; } = new(Array.Empty<ChargingHeatmapSession>());

    /// <summary>True when at least one charging session resolved (web <c>sessions.length &gt; 0</c>).</summary>
    public bool HasData => Sessions.Count > 0;

    /// <summary>Project a <c>GET /charging-sessions</c> JSON array into the snapshot (non-array body → empty).</summary>
    public static ChargingHeatmapSnapshot FromJson(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Array)
        {
            return Empty;
        }

        var sessions = new List<ChargingHeatmapSession>(root.GetArrayLength());
        foreach (var item in root.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                sessions.Add(ChargingHeatmapSession.FromJson(item));
            }
        }

        return sessions.Count == 0 ? Empty : new ChargingHeatmapSnapshot(sessions);
    }
}

/// <summary>
/// The mutually-exclusive lifecycle state the <see cref="ChargingHeatmapPageViewModel"/> can be in — the native
/// superset of the branches the web <c>ChargingHeatmapPage</c> renders
/// (web/src/features/charging/pages/ChargingHeatmapPage.tsx). <see cref="Loading"/> is the <c>isLoading</c>
/// skeleton branch and <see cref="Error"/> is the web query's error path (PageContainer <c>error</c> prop).
/// The web has no separate empty gate — it renders the same full layout for both populated and empty data
/// (zeroed stats, an all-empty grid and the locations empty state); <see cref="Empty"/> and
/// <see cref="Success"/> therefore share the content layout, distinguished only by their values, so every
/// value maps onto a visible surface (never a blank region).
/// </summary>
public enum ChargingHeatmapState
{
    /// <summary>Initial fetch with no snapshot — render the loading skeleton.</summary>
    Loading,

    /// <summary>The query resolved with no charging sessions — the zeroed content layout (web parity).</summary>
    Empty,

    /// <summary>At least one charging session — the populated content layout.</summary>
    Success,

    /// <summary>The query failed with no snapshot — the retriable error surface.</summary>
    Error,
}

/// <summary>
/// A plain, UI-free RGBA colour — the native mirror of the web component's per-cell / per-swatch
/// <c>rgba(r, g, b, a)</c> string. <see cref="R"/>, <see cref="G"/> and <see cref="B"/> are 0-255 channels and
/// <see cref="Alpha"/> is the 0..1 opacity (web parity). Kept WinUI-free so the colour buckets are unit-tested
/// headlessly; the view converts it to a <c>Windows.UI.Color</c> at render time.
/// </summary>
public readonly record struct ChargingHeatColor(byte R, byte G, byte B, double Alpha)
{
    /// <summary>
    /// The fill for one grid cell — the native port of the web <c>heatColor(count, max)</c> bucket ladder: the
    /// faint cyan empty wash when the cell carries no sessions (or the grid is empty), then cyan / emerald /
    /// amber / rose as the session ratio crosses the 0.25 / 0.5 / 0.75 thresholds.
    /// </summary>
    /// <param name="count">The session count in the cell.</param>
    /// <param name="max">The busiest cell's session count (the ratio denominator).</param>
    public static ChargingHeatColor ForCount(int count, int max)
    {
        if (count <= 0 || max <= 0)
        {
            return new ChargingHeatColor(0, 240, 255, 0.04);
        }

        double ratio = (double)count / max;
        if (ratio < 0.25)
        {
            return new ChargingHeatColor(0, 240, 255, 0.15);
        }

        if (ratio < 0.5)
        {
            return new ChargingHeatColor(16, 185, 129, 0.4);
        }

        if (ratio < 0.75)
        {
            return new ChargingHeatColor(245, 158, 11, 0.55);
        }

        return new ChargingHeatColor(239, 68, 68, 0.75);
    }

    /// <summary>The five legend swatches, Less → More — the web legend's explicit bucket colours, in order.</summary>
    public static IReadOnlyList<ChargingHeatColor> Legend { get; } = new[]
    {
        new ChargingHeatColor(0, 240, 255, 0.04),
        new ChargingHeatColor(0, 240, 255, 0.15),
        new ChargingHeatColor(16, 185, 129, 0.4),
        new ChargingHeatColor(245, 158, 11, 0.55),
        new ChargingHeatColor(239, 68, 68, 0.75),
    };

    /// <summary>The 0-255 alpha byte (web's 0..1 opacity scaled for the WinUI ARGB colour).</summary>
    public byte AlphaByte =>
        (byte)Math.Clamp((int)Math.Round(Math.Clamp(Alpha, 0, 1) * 255, MidpointRounding.AwayFromZero), 0, 255);
}

/// <summary>
/// One render-ready heatmap cell — a single (day, hour) square with its session <see cref="Count"/>, the
/// accumulated <see cref="EnergyKwh"/> the hover tooltip shows, the computed <see cref="Fill"/> colour and the
/// localized hover/Narrator <see cref="Tooltip"/>. Pure data so the colour buckets and tooltip text are
/// asserted headlessly.
/// </summary>
public sealed record ChargingHeatCell(
    int Hour,
    int Count,
    double EnergyKwh,
    ChargingHeatColor Fill,
    string Tooltip)
{
    /// <summary>True when the cell carries at least one charging session (web <c>cell.count &gt; 0</c>).</summary>
    public bool HasSessions => Count > 0;
}

/// <summary>
/// One render-ready heatmap row — a localized day label (web's <c>['Sun'..'Sat']</c> entry) plus its 24 hour
/// cells in order. Pure data so the grid shape is asserted without a UI host.
/// </summary>
public sealed record ChargingHeatRow(int DayIndex, string DayLabel, IReadOnlyList<ChargingHeatCell> Cells);

/// <summary>
/// One render-ready top-charging-location row — the place name and its session count, the native analogue of
/// one entry of the web <c>locationData</c> array (<c>{ name, count }</c>). Pure data.
/// </summary>
public sealed record ChargingHeatmapLocation(string Name, int Count);

/// <summary>
/// The render-time input the page projection folds — the parsed snapshot, the in-flight flag and any resolved
/// error detail. Pure data so the projection is verified headlessly. Mirrors the inputs the web page's render
/// reads (the query result, <c>isLoading</c>, <c>error</c>).
/// </summary>
public sealed record ChargingHeatmapModel(
    ChargingHeatmapSnapshot Snapshot,
    bool Loading,
    string? ErrorDetail);

/// <summary>
/// The fully projected, render-ready view of the Charging-Heatmap page for one input model — everything the
/// thin <see cref="ChargingHeatmapPage"/> view binds to. Holds the active <see cref="State"/> + its boolean
/// show-flags, the localized header copy, the four stat cards (label + pre-formatted value), the favourite
/// charging-time line, the 7×24 grid (sparse hour labels + day rows + the legend swatches and Less / More
/// labels), and the top-locations bar series + table rows (or the empty message). Pure data so every branch
/// is asserted headlessly.
/// </summary>
public sealed record ChargingHeatmapDisplay(
    ChargingHeatmapState State,
    bool ShowLoading,
    bool ShowError,
    bool ShowContent,
    string Title,
    string Subtitle,
    string TotalSessionsLabel,
    string TotalSessionsValue,
    string TotalEnergyLabel,
    string TotalEnergyValue,
    string TotalCostLabel,
    string TotalCostValue,
    string AvgDurationLabel,
    string AvgDurationValue,
    string FavoriteLabel,
    bool HasFavorite,
    string FavoriteMain,
    string FavoriteCount,
    string FavoriteEmptyMessage,
    string GridTitle,
    int MaxCount,
    IReadOnlyList<string> HourLabels,
    IReadOnlyList<ChargingHeatRow> Rows,
    IReadOnlyList<ChargingHeatColor> LegendSwatches,
    string LessLabel,
    string MoreLabel,
    string TopLocationsTitle,
    bool HasLocationData,
    IReadOnlyList<ChartSeries> LocationSeries,
    IReadOnlyList<ChargingHeatmapLocation> Locations,
    string NoDataMessage,
    string ErrorText,
    string RetryLabel,
    string AutomationName)
{
    /// <summary>An all-empty display (the loading fallback) projected from the empty snapshot.</summary>
    public static ChargingHeatmapDisplay Empty(ILocalizer localizer) => ChargingHeatmapProjection.Project(
        new ChargingHeatmapModel(ChargingHeatmapSnapshot.Empty, Loading: true, ErrorDetail: null),
        localizer,
        TimeZoneInfo.Local);
}

/// <summary>
/// Pure projection from a <see cref="ChargingHeatmapModel"/> to its <see cref="ChargingHeatmapDisplay"/> — the
/// native port of the render logic in web/src/features/charging/pages/ChargingHeatmapPage.tsx and its
/// <c>heatColor</c> / <c>buildGrid</c> helpers plus the <c>durationMinutes</c> helper it imports from
/// web/src/features/charging/components/charging-curve/helpers.ts. The branch precedence mirrors the web's data
/// lifecycle (loading → error superset → the zeroed-or-populated content layout). Every label resolves through
/// the i18n facade using the same keys the web feeds into <c>t(...)</c>. No WinUI types — unit-tested without
/// a UI host.
/// </summary>
public static class ChargingHeatmapProjection
{
    /// <summary>Days in a week (rows). Web grid is fixed Sun..Sat.</summary>
    public const int Days = 7;

    /// <summary>Hours in a day (columns). Web grid is fixed 0..23.</summary>
    public const int Hours = 24;

    /// <summary>The minimum repeat count a place needs to appear in the top-locations chart (web <c>c &gt;= 2</c>).</summary>
    public const int MinLocationCount = 2;

    /// <summary>The maximum number of top locations shown (web <c>slice(0, 10)</c>).</summary>
    public const int MaxLocations = 10;

    /// <summary>The energy readout precision (web <c>fmtNumber(totalEnergy, 1)</c>).</summary>
    public const int EnergyDecimals = 1;

    private const string EnergyUnitSuffix = "kWh";
    private const string DurationUnitSuffix = "min";

    private static readonly (string Key, string Fallback)[] DayLabels =
    {
        ("quietHours.weekday.sun", "Sun"),
        ("quietHours.weekday.mon", "Mon"),
        ("quietHours.weekday.tue", "Tue"),
        ("quietHours.weekday.wed", "Wed"),
        ("quietHours.weekday.thu", "Thu"),
        ("quietHours.weekday.fri", "Fri"),
        ("quietHours.weekday.sat", "Sat"),
    };

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade and zone.</summary>
    /// <param name="model">The render-time input (snapshot + flags).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="timeZone">The display time zone the grid bins sessions into (web browser-local time).</param>
    public static ChargingHeatmapDisplay Project(ChargingHeatmapModel model, ILocalizer localizer, TimeZoneInfo timeZone)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(timeZone);

        // Resolve every visible label up front so all twelve manifest keys are requested in every data state.
        string title = localizer.GetString("charging.heatmap.title", "Charging Patterns");
        string subtitle = localizer.GetString("charging.heatmap.subtitle", "When and where you charge");
        string totalSessionsLabel = localizer.GetString("charging.heatmap.totalSessions", "Total Sessions");
        string totalEnergyLabel = localizer.GetString("charging.heatmap.totalEnergy", "Total Energy");
        string totalCostLabel = localizer.GetString("charging.heatmap.totalCost", "Total Cost");
        string avgDurationLabel = localizer.GetString("charging.heatmap.avgDuration", "Avg Duration");
        string favoriteLabel = localizer.GetString("charging.heatmap.favorite", "Favorite Charging Time");
        string gridTitle = localizer.GetString("charging.heatmap.gridTitle", "Weekly Charging Heatmap");
        string topLocationsTitle = localizer.GetString("charging.heatmap.topLocations", "Top Charging Locations");
        string lessLabel = localizer.GetString("charging.heatmap.less", "Less");
        string moreLabel = localizer.GetString("charging.heatmap.more", "More");
        string noDataMessage = localizer.GetString("common.noData", "No data available");
        string sessionsWord = localizer.GetString("charging.curve.sessions", "sessions");

        ChargingHeatmapState state = SelectState(model);
        IReadOnlyList<ChargingHeatmapSession> sessions = model.Snapshot.Sessions;

        var stats = ChargingHeatmapStats.From(sessions);
        var grid = ChargingHeatmapGrid.Build(sessions, timeZone);
        var rows = BuildRows(grid, localizer, sessionsWord);
        var locations = BuildLocations(sessions, localizer);
        var locationSeries = BuildLocationSeries(locations, sessionsWord);

        string totalEnergyValue = string.Format(
            CultureInfo.CurrentCulture,
            "{0} {1}",
            NumberFormatting.Format(stats.TotalEnergyKwh, null, EnergyDecimals),
            EnergyUnitSuffix);
        string avgDurationValue = string.Format(
            CultureInfo.CurrentCulture,
            "{0} {1}",
            NumberFormatting.Format(stats.AvgDurationMinutes, null, 0),
            DurationUnitSuffix);

        string favoriteMain = grid.MaxCount > 0
            ? string.Format(
                CultureInfo.CurrentCulture,
                "{0}s at {1}:00",
                localizer.GetString(DayLabels[grid.FavoriteDay].Key, DayLabels[grid.FavoriteDay].Fallback),
                grid.FavoriteHour.ToString("00", CultureInfo.InvariantCulture))
            : string.Empty;
        string favoriteCount = grid.MaxCount > 0
            ? string.Format(CultureInfo.CurrentCulture, "({0} {1})", grid.MaxCount, sessionsWord)
            : string.Empty;

        string errorText = ResolveError(model, localizer);

        return new ChargingHeatmapDisplay(
            State: state,
            ShowLoading: state == ChargingHeatmapState.Loading,
            ShowError: state == ChargingHeatmapState.Error,
            ShowContent: state is ChargingHeatmapState.Empty or ChargingHeatmapState.Success,
            Title: title,
            Subtitle: subtitle,
            TotalSessionsLabel: totalSessionsLabel,
            TotalSessionsValue: NumberFormatting.Format(stats.Count, null, 0),
            TotalEnergyLabel: totalEnergyLabel,
            TotalEnergyValue: totalEnergyValue,
            TotalCostLabel: totalCostLabel,
            TotalCostValue: ScalarFormatters.FormatCurrency(stats.TotalCost),
            AvgDurationLabel: avgDurationLabel,
            AvgDurationValue: avgDurationValue,
            FavoriteLabel: favoriteLabel,
            HasFavorite: grid.MaxCount > 0,
            FavoriteMain: favoriteMain,
            FavoriteCount: favoriteCount,
            FavoriteEmptyMessage: noDataMessage,
            GridTitle: gridTitle,
            MaxCount: grid.MaxCount,
            HourLabels: BuildHourLabels(),
            Rows: rows,
            LegendSwatches: ChargingHeatColor.Legend,
            LessLabel: lessLabel,
            MoreLabel: moreLabel,
            TopLocationsTitle: topLocationsTitle,
            HasLocationData: locations.Count > 0,
            LocationSeries: locationSeries,
            Locations: locations,
            NoDataMessage: noDataMessage,
            ErrorText: errorText,
            RetryLabel: localizer.GetString("common.retry", "Retry"),
            AutomationName: BuildAutomationName(state, title, subtitle, noDataMessage, errorText));
    }

    /// <summary>The 24 hour-column labels — the hour number for every column (web header row shows all 0..23).</summary>
    public static IReadOnlyList<string> BuildHourLabels()
    {
        var labels = new List<string>(Hours);
        for (int hour = 0; hour < Hours; hour++)
        {
            labels.Add(hour.ToString(CultureInfo.InvariantCulture));
        }

        return labels;
    }

    private static ChargingHeatmapState SelectState(ChargingHeatmapModel model)
    {
        if (model.ErrorDetail is not null)
        {
            return ChargingHeatmapState.Error;
        }

        if (model.Loading)
        {
            return ChargingHeatmapState.Loading;
        }

        return model.Snapshot.HasData ? ChargingHeatmapState.Success : ChargingHeatmapState.Empty;
    }

    private static List<ChargingHeatRow> BuildRows(
        ChargingHeatmapGrid grid,
        ILocalizer localizer,
        string sessionsWord)
    {
        var rows = new List<ChargingHeatRow>(Days);
        for (int day = 0; day < Days; day++)
        {
            string dayLabel = localizer.GetString(DayLabels[day].Key, DayLabels[day].Fallback);
            var cells = new List<ChargingHeatCell>(Hours);
            for (int hour = 0; hour < Hours; hour++)
            {
                ChargingHeatmapCellData cell = grid.Cells[day][hour];
                cells.Add(new ChargingHeatCell(
                    Hour: hour,
                    Count: cell.Count,
                    EnergyKwh: cell.EnergyKwh,
                    Fill: ChargingHeatColor.ForCount(cell.Count, grid.MaxCount),
                    Tooltip: BuildTooltip(dayLabel, hour, cell, sessionsWord)));
            }

            rows.Add(new ChargingHeatRow(day, dayLabel, cells));
        }

        return rows;
    }

    private static string BuildTooltip(string dayLabel, int hour, ChargingHeatmapCellData cell, string sessionsWord)
    {
        string time = string.Create(CultureInfo.CurrentCulture, $"{dayLabel} {hour}:00");
        if (cell.Count <= 0)
        {
            return time;
        }

        // Web hover tooltip: "{DAYS[day]} {hour}:00" / "{count} sessions · {energy} kWh".
        string energy = NumberFormatting.Format(cell.EnergyKwh, null, EnergyDecimals);
        return string.Create(
            CultureInfo.CurrentCulture,
            $"{time} \u2014 {cell.Count} {sessionsWord} \u00b7 {energy} {EnergyUnitSuffix}");
    }

    private static IReadOnlyList<ChargingHeatmapLocation> BuildLocations(
        IReadOnlyList<ChargingHeatmapSession> sessions,
        ILocalizer localizer)
    {
        if (sessions.Count == 0)
        {
            return Array.Empty<ChargingHeatmapLocation>();
        }

        string unknown = localizer.GetString("common.unknown", "Unknown");
        var counts = new Dictionary<string, int>(StringComparer.Ordinal);
        var order = new List<string>();
        foreach (var session in sessions)
        {
            string name = string.IsNullOrEmpty(session.StartPlace) ? unknown : session.StartPlace;
            if (counts.TryGetValue(name, out int current))
            {
                counts[name] = current + 1;
            }
            else
            {
                counts[name] = 1;
                order.Add(name);
            }
        }

        // Web: Object.entries(counts).filter(c >= 2).sort(desc by count).slice(0, 10). A stable secondary order
        // on first-seen keeps equal-count ties deterministic.
        var ranked = new List<ChargingHeatmapLocation>();
        for (int i = 0; i < order.Count; i++)
        {
            string name = order[i];
            int count = counts[name];
            if (count >= MinLocationCount)
            {
                ranked.Add(new ChargingHeatmapLocation(name, count));
            }
        }

        ranked.Sort((a, b) => b.Count.CompareTo(a.Count));
        if (ranked.Count > MaxLocations)
        {
            ranked.RemoveRange(MaxLocations, ranked.Count - MaxLocations);
        }

        return ranked;
    }

    private static ChartSeries[] BuildLocationSeries(
        IReadOnlyList<ChargingHeatmapLocation> locations,
        string sessionsWord)
    {
        if (locations.Count == 0)
        {
            return Array.Empty<ChartSeries>();
        }

        var points = new List<ChartPoint>(locations.Count);
        for (int i = 0; i < locations.Count; i++)
        {
            points.Add(new ChartPoint(i, locations[i].Count, locations[i].Name));
        }

        return
        [
            new ChartSeries(sessionsWord, points)
            {
                Kind = ChartSeriesKind.Bar,
                ColorIndex = 0,
                Decimals = 0,
            },
        ];
    }

    private static string ResolveError(ChargingHeatmapModel model, ILocalizer localizer)
    {
        if (!string.IsNullOrWhiteSpace(model.ErrorDetail))
        {
            return model.ErrorDetail!;
        }

        return localizer.GetString("charging.heatmap.error", "Couldn't load charging sessions");
    }

    private static string BuildAutomationName(
        ChargingHeatmapState state,
        string title,
        string subtitle,
        string emptyMessage,
        string errorText) => state switch
        {
            ChargingHeatmapState.Loading => string.Format(CultureInfo.CurrentCulture, "{0}. {1}", title, subtitle),
            ChargingHeatmapState.Error => string.Format(CultureInfo.CurrentCulture, "{0}. {1}", title, errorText),
            ChargingHeatmapState.Empty => string.Format(CultureInfo.CurrentCulture, "{0}. {1}", title, emptyMessage),
            _ => string.Format(CultureInfo.CurrentCulture, "{0}. {1}", title, subtitle),
        };
}

/// <summary>
/// The reduced summary stats the four stat cards bind to — the native port of the web page's <c>stats</c>
/// memo (count, total energy in kWh, total cost, average duration in minutes). Pure data so the reduction is
/// asserted headlessly; energy is converted from SI watt-hours at this render boundary, never on disk.
/// </summary>
public readonly record struct ChargingHeatmapStats(int Count, double TotalEnergyKwh, double TotalCost, double AvgDurationMinutes)
{
    /// <summary>Reduce <paramref name="sessions"/> into the summary stats (web <c>stats</c> memo).</summary>
    public static ChargingHeatmapStats From(IReadOnlyList<ChargingHeatmapSession> sessions)
    {
        ArgumentNullException.ThrowIfNull(sessions);
        if (sessions.Count == 0)
        {
            return new ChargingHeatmapStats(0, 0, 0, 0);
        }

        double totalEnergyKwh = 0;
        double totalCost = 0;
        double totalDuration = 0;
        foreach (var session in sessions)
        {
            totalEnergyKwh += UnitConverters.EnergyFromSi(session.TotalEnergyAddedWh ?? 0, Core.Units.EnergyUnit.Kwh);
            totalCost += session.CostDecimal ?? 0;
            totalDuration += DurationMinutes(session.StartedAt, session.EndedAt);
        }

        return new ChargingHeatmapStats(
            Count: sessions.Count,
            TotalEnergyKwh: totalEnergyKwh,
            TotalCost: totalCost,
            AvgDurationMinutes: totalDuration / sessions.Count);
    }

    /// <summary>
    /// The web <c>durationMinutes(startedAt, endedAt)</c> helper, verbatim: zero unless both instants are
    /// present and the end is strictly after the start, then the whole-minute span rounded to the nearest
    /// minute.
    /// </summary>
    public static double DurationMinutes(DateTimeOffset? startedAt, DateTimeOffset? endedAt)
    {
        if (startedAt is not { } start || endedAt is not { } end || end <= start)
        {
            return 0;
        }

        return Math.Round((end - start).TotalMinutes, MidpointRounding.AwayFromZero);
    }
}

/// <summary>One (day, hour) grid cell's accumulated session count and energy (web <c>HeatCell</c>).</summary>
public readonly record struct ChargingHeatmapCellData(int Count, double EnergyKwh);

/// <summary>
/// The dense 7×24 grid the heatmap renders, built from the sessions — the native port of the web
/// <c>buildGrid</c> helper. Every session is binned by its start instant's day-of-week and hour in the display
/// time zone (web browser-local <c>new Date(...).getDay()/.getHours()</c>), accumulating the per-cell session
/// count and energy and tracking the busiest cell as the favourite. Pure data.
/// </summary>
public sealed class ChargingHeatmapGrid
{
    private ChargingHeatmapGrid(
        IReadOnlyList<IReadOnlyList<ChargingHeatmapCellData>> cells,
        int maxCount,
        int favoriteDay,
        int favoriteHour)
    {
        Cells = cells;
        MaxCount = maxCount;
        FavoriteDay = favoriteDay;
        FavoriteHour = favoriteHour;
    }

    /// <summary>The 7 day rows of 24 hour cells.</summary>
    public IReadOnlyList<IReadOnlyList<ChargingHeatmapCellData>> Cells { get; }

    /// <summary>The busiest cell's session count (the colour-ramp denominator; 0 when empty).</summary>
    public int MaxCount { get; }

    /// <summary>The day-of-week index (0 = Sun) of the busiest cell.</summary>
    public int FavoriteDay { get; }

    /// <summary>The hour (0..23) of the busiest cell.</summary>
    public int FavoriteHour { get; }

    /// <summary>Build the dense grid from <paramref name="sessions"/>, binning in <paramref name="timeZone"/>.</summary>
    public static ChargingHeatmapGrid Build(IReadOnlyList<ChargingHeatmapSession> sessions, TimeZoneInfo timeZone)
    {
        ArgumentNullException.ThrowIfNull(sessions);
        ArgumentNullException.ThrowIfNull(timeZone);

        var counts = new int[ChargingHeatmapProjection.Days, ChargingHeatmapProjection.Hours];
        var energy = new double[ChargingHeatmapProjection.Days, ChargingHeatmapProjection.Hours];
        int maxCount = 0;
        int favoriteDay = 0;
        int favoriteHour = 0;

        foreach (var session in sessions)
        {
            if (session.StartedAt is not { } started)
            {
                continue;
            }

            DateTime local = TimeZoneInfo.ConvertTime(started, timeZone).DateTime;
            int day = (int)local.DayOfWeek; // JS getDay(): Sunday = 0 .. Saturday = 6.
            int hour = local.Hour;

            counts[day, hour] += 1;
            energy[day, hour] += UnitConverters.EnergyFromSi(session.TotalEnergyAddedWh ?? 0, Core.Units.EnergyUnit.Kwh);
            if (counts[day, hour] > maxCount)
            {
                maxCount = counts[day, hour];
                favoriteDay = day;
                favoriteHour = hour;
            }
        }

        var rows = new List<IReadOnlyList<ChargingHeatmapCellData>>(ChargingHeatmapProjection.Days);
        for (int day = 0; day < ChargingHeatmapProjection.Days; day++)
        {
            var cells = new ChargingHeatmapCellData[ChargingHeatmapProjection.Hours];
            for (int hour = 0; hour < ChargingHeatmapProjection.Hours; hour++)
            {
                cells[hour] = new ChargingHeatmapCellData(counts[day, hour], energy[day, hour]);
            }

            rows.Add(cells);
        }

        return new ChargingHeatmapGrid(rows, maxCount, favoriteDay, favoriteHour);
    }
}

/// <summary>
/// Canonical navigation + diagnostics metadata for the Charging-Heatmap page — the native mirror of the web
/// page at web/src/features/charging/pages/ChargingHeatmapPage.tsx (route <c>/charging-heatmap</c>, nav name
/// <c>ChargingHeatmap</c>). The page reads the same charging-sessions list the web
/// <c>useChargingSessionsPaginated</c> hook reads (generated operation <c>get_api_v1_charging_sessions</c>).
/// </summary>
public static class ChargingHeatmapRegistration
{
    /// <summary>The navigation route name the shell registers this page under (matches <c>RouteTable</c>).</summary>
    public const string RouteName = "ChargingHeatmap";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "ChargingHeatmapPage";

    /// <summary>The generated charging-sessions operation the page's client feed reads.</summary>
    public const string Operation = Core.Data.Net.Operations.Charging.Sessions;

    /// <summary>The page-fetch limit (web <c>useChargingSessionsPaginated(vehicleId, { limit: 2000 })</c>).</summary>
    public const int PageLimit = 2000;

    /// <summary>The localized page title (web <c>t('charging.heatmap.title')</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("charging.heatmap.title", "Charging Patterns");
    }
}

/// <summary>
/// PII-safe diagnostics for the Charging-Heatmap page (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never an energy figure, cost, location or
/// session count — so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class ChargingHeatmapDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public ChargingHeatmapDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ChargingHeatmapPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={ChargingHeatmapRegistration.Slug}");
    }
}
