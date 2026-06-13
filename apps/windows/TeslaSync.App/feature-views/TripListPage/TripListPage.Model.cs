using System.Buffers;
using System.Globalization;
using System.Text;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Trips;

/// <summary>
/// The mutually-exclusive lifecycle state the <see cref="TripListPageViewModel"/> renders for its single data
/// source — the web Trips page's <c>useTrips({ vehicle_id, limit, offset, start, end })</c> hook
/// (web/src/features/trips/pages/TripListPage.tsx). It is the native union of the page's three web branches:
/// the <c>isLoading</c> skeleton grid, the <c>allTrips.length === 0</c> empty state, and the populated section
/// stack (stat cards + top-trips chart + trip list + pagination). Every branch maps onto a visible region;
/// none is ever blank. Faithful to the web page (which surfaces no dedicated trips-error UI — a failed query
/// leaves the list empty via <c>safeArray</c>), a hard transport failure with no cached rows folds into
/// <see cref="Empty"/>.
/// </summary>
public enum TripListState
{
    /// <summary>The first load with no cached snapshot (web <c>isLoading</c> skeleton grid).</summary>
    Loading,

    /// <summary>A resolved snapshot carrying no trips (web <c>allTrips.length === 0</c> empty state).</summary>
    Empty,

    /// <summary>A resolved snapshot with at least one trip (web populated section stack).</summary>
    Success,
}

/// <summary>
/// One parsed trip rollup from <c>GET /trips</c> — the native analogue of the web <c>Trip</c> type
/// (web/src/api/types.ts). Every numeric field is SI on the wire (meters, watt-hours) and is converted only at
/// the display boundary by <see cref="TripListProjection"/>. Parsing is null-tolerant so a partial row never
/// throws (mirrors the web <c>safeArray</c> + optional-field reads).
/// </summary>
/// <param name="Id">The trip id (web <c>trip.id</c>; selection + chart key).</param>
/// <param name="Name">The raw trip name or null (web <c>trip.name</c>).</param>
/// <param name="StartInstant">Parsed <c>start_date</c> instant, or null.</param>
/// <param name="EndInstant">Parsed <c>end_date</c> instant (duration end), or null (web "In progress").</param>
/// <param name="TotalDistanceM">Total distance in SI meters (web <c>total_distance_m</c>).</param>
/// <param name="TotalEnergyWh">Total energy in SI watt-hours (web <c>total_energy_wh</c>).</param>
/// <param name="TotalCost">Total cost in the user's currency (web <c>total_cost</c>).</param>
/// <param name="DriveCount">Number of drive segments (web <c>trip.drive_count</c>).</param>
/// <param name="ChargeCount">Number of charge segments (web <c>trip.charge_count</c>).</param>
public sealed record TripListItem(
    long Id,
    string? Name,
    DateTimeOffset? StartInstant,
    DateTimeOffset? EndInstant,
    double TotalDistanceM,
    double TotalEnergyWh,
    double TotalCost,
    long DriveCount,
    long ChargeCount)
{
    /// <summary>Parse a trip-list JSON array into a tolerant list, preserving server order.</summary>
    /// <param name="element">The parsed <c>GET /trips</c> body.</param>
    /// <returns>The parsed rows (empty when the body is not an array).</returns>
    public static IReadOnlyList<TripListItem> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<TripListItem>();
        }

        var list = new List<TripListItem>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Project a single trip JSON object into a tolerant row.</summary>
    /// <param name="obj">One trip object from the list.</param>
    /// <returns>The parsed, null-tolerant row.</returns>
    public static TripListItem FromJson(JsonElement obj) => new(
        GetLong(obj, "id"),
        GetString(obj, "name"),
        GetDateTime(obj, "start_date"),
        GetDateTime(obj, "end_date"),
        GetDouble(obj, "total_distance_m") ?? 0,
        GetDouble(obj, "total_energy_wh") ?? 0,
        GetDouble(obj, "total_cost") ?? 0,
        (long)Math.Round(GetDouble(obj, "drive_count") ?? 0, MidpointRounding.AwayFromZero),
        (long)Math.Round(GetDouble(obj, "charge_count") ?? 0, MidpointRounding.AwayFromZero));

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
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var dt)
            ? dt
            : null;
    }
}

/// <summary>
/// One render-ready summary metric tile — the native analogue of a single web <c>&lt;MetricCard&gt;</c> in the
/// four-up stats grid (Total Distance / Energy Used / Total Cost / Total Trips). Pure data so the projection is
/// unit-tested without a UI host; the accent rail brush keys mirror the web card <c>color</c> props
/// (cyan / amber / green / purple).
/// </summary>
/// <param name="Key">Stable identity for the tile (distance / energy / cost / total).</param>
/// <param name="Label">The localized label (web <c>label</c>).</param>
/// <param name="Value">The pre-formatted headline value (web <c>value</c>).</param>
/// <param name="Sublabel">The localized sub-line (web <c>subtitle</c>).</param>
/// <param name="AccentBrushKey">The design-token brush key for the accent rail (web <c>color</c>).</param>
/// <param name="AutomationName">Narrator name folding the label + value + sub-line.</param>
public sealed record TripStatCard(
    string Key,
    string Label,
    string Value,
    string Sublabel,
    string AccentBrushKey,
    string AutomationName);

/// <summary>
/// One projected bar in the "Top Trips by Distance" chart — the native analogue of a single recharts
/// horizontal <c>&lt;Bar&gt;</c> datum. Carries the trip name (web category axis), the display-unit distance
/// value (web <c>convertDistanceFromSI</c>, used to size the bar), its pre-formatted label and the share of the
/// largest bar (the native horizontal fill ratio). Pure data.
/// </summary>
/// <param name="Id">The trip id (chart key).</param>
/// <param name="Name">The resolved trip name (web <c>trip.name ?? `Trip ${id}`</c>).</param>
/// <param name="DistanceValue">The display-unit distance the bar encodes (web bar <c>distance</c>).</param>
/// <param name="DistanceText">The pre-formatted distance label with its unit.</param>
/// <param name="Ratio">Share of the largest bar, 0..1 (native horizontal fill width).</param>
/// <param name="AutomationName">Narrator name describing the bar.</param>
public sealed record TripChartBar(
    long Id,
    string Name,
    double DistanceValue,
    string DistanceText,
    double Ratio,
    string AutomationName);

/// <summary>
/// One projected, display-ready trip row the WinUI list binds to — the native analogue of a single web
/// <c>&lt;TripRow&gt;</c> glass panel. Holds the resolved name, the date / duration labels, the drive + charge
/// tallies, the unit-converted distance, the unit-aware energy readout, the efficiency readout, the optional
/// cost, and a Narrator automation name. Pure data so the projection is unit-tested headlessly.
/// </summary>
/// <param name="Id">The trip id (row key; web <c>trip.id</c>).</param>
/// <param name="Name">Resolved name or the "Trip #{id}" fallback (web <c>trip.name ?? `Trip #${id}`</c>).</param>
/// <param name="DateText">Short start-date label (web <c>formatDate(trip.start_date)</c>).</param>
/// <param name="DurationText">Duration label (web <c>formatDuration(start, end)</c>), or "In progress".</param>
/// <param name="DrivesText">Drive-segment tally text (web <c>{{count}} drives</c>).</param>
/// <param name="ChargesText">Charge-segment tally text (web <c>{{count}} charges</c>); blank when none.</param>
/// <param name="HasCharges">True when the charge tally is shown (web <c>trip.charge_count &gt; 0</c>).</param>
/// <param name="DistanceText">Display-unit distance (web <c>fmtInt(convertDistanceFromSI(…)) + unit</c>).</param>
/// <param name="EnergyText">Unit-aware energy (web <c>formatEnergy(total_energy_wh)</c>).</param>
/// <param name="EfficiencyText">Efficiency readout (web <c>fmtInt(efficiencyDisplay) + efficiencyUnit</c>).</param>
/// <param name="CostText">Currency cost (web <c>formatCurrency(total_cost)</c>); blank when zero.</param>
/// <param name="HasCost">True when the cost block is shown (web <c>trip.total_cost &gt; 0</c>).</param>
/// <param name="CostCaption">The localized "cost" caption under the cost value (web <c>trips.row.cost</c>).</param>
/// <param name="AutomationName">Narrator name folding the row labels together.</param>
public sealed record TripRow(
    long Id,
    string Name,
    string DateText,
    string DurationText,
    string DrivesText,
    string ChargesText,
    bool HasCharges,
    string DistanceText,
    string EnergyText,
    string EfficiencyText,
    string CostText,
    bool HasCost,
    string CostCaption,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the Trips page for one trip snapshot + state + display page — the
/// native analogue of everything the web component computes before returning JSX. Carries the active
/// <see cref="State"/>, the four summary <see cref="StatCards"/>, the <see cref="ChartBars"/> (top-10 by
/// distance), the current page of trip <see cref="Rows"/> with its paging math, and every localized literal the
/// page renders, so the view is a thin renderer and the tests assert every string + state through this model.
/// </summary>
public sealed record TripListDisplay(
    TripListState State,
    IReadOnlyList<TripStatCard> StatCards,
    IReadOnlyList<TripChartBar> ChartBars,
    IReadOnlyList<TripRow> Rows,
    int TotalRowCount,
    int Page,
    int PageSize,
    string Title,
    string Subtitle,
    string ChartTitle,
    string ChartAriaLabel,
    string ChartEmptyMessage,
    string ChartTripColumnLabel,
    string ChartDistanceColumnLabel,
    string ChartDataTableLabel,
    string ExportCsvLabel,
    string ExportJsonLabel,
    string ListHeading,
    string ListEmptyMessage)
{
    /// <summary>True when the populated trip list is shown (web truthy <c>allTrips.length &gt; 0</c>).</summary>
    public bool HasRows => State == TripListState.Success && TotalRowCount > 0;

    /// <summary>True when the top-trips chart has at least one bar (web <c>chartData.length &gt; 0</c>).</summary>
    public bool HasChart => ChartBars.Count > 0;

    /// <summary>The 1-based index of the first row on the current page (pager summary start).</summary>
    public int RangeStart => TotalRowCount == 0 ? 0 : ((Page - 1) * PageSize) + 1;

    /// <summary>The 1-based index of the last row on the current page (pager summary end).</summary>
    public int RangeEnd => Math.Min(Page * PageSize, TotalRowCount);
}

/// <summary>
/// Pure projection from the parsed trip list + lifecycle state + display page to the render-ready
/// <see cref="TripListDisplay"/> — the native port of web/src/features/trips/pages/TripListPage.tsx. It folds
/// the trips into the four summary metrics, the top-10-by-distance bar set and the per-trip rows, performing
/// the SI→display distance conversion exactly as the web <c>convertDistanceFromSI</c> does (and only here), the
/// unit-aware energy readout (web <c>formatEnergy</c>), the currency cost (web <c>formatCurrency</c>), the
/// Wh/(distance-unit) efficiency, the date label and the page's own <c>formatDuration</c>. Every literal
/// resolves through the i18n facade with the web key names and verbatim English defaults. Kept pure (no WinUI
/// types) so it is compiled into the headless test project and unit-tested without a UI host.
/// </summary>
public static class TripListProjection
{
    /// <summary>How many trips the page fetches per request (web <c>useTrips({ limit: 50 })</c> page size).</summary>
    public const int FetchLimit = 50;

    /// <summary>How many trip rows the list shows per display page (web list page size).</summary>
    public const int DisplayPageSize = 10;

    /// <summary>How many bars the top-trips chart renders (web <c>.slice(0, 10)</c>).</summary>
    public const int ChartTopN = 10;

    /// <summary>1 mile = 1.609344 km exactly — the web <c>KM_PER_MILE</c> efficiency factor.</summary>
    private const double KmPerMile = 1.609344;

    private const string EmDash = "\u2014";
    private const double MillisecondsPerHour = 3_600_000.0;
    private const double MillisecondsPerMinute = 60_000.0;

    /// <summary>Accent rail brush key for the distance metric (web card <c>color="cyan"</c>).</summary>
    public const string CyanAccentBrushKey = "TsChartSpeedBrush";

    /// <summary>Accent rail brush key for the energy metric (web card <c>color="amber"</c>).</summary>
    public const string AmberAccentBrushKey = "TsColorWarningBrush";

    /// <summary>Accent rail brush key for the cost metric (web card <c>color="green"</c>).</summary>
    public const string GreenAccentBrushKey = "TsChartBatteryBrush";

    /// <summary>Accent rail brush key for the total-trips metric (web card <c>color="purple"</c>).</summary>
    public const string PurpleAccentBrushKey = "TsChartPowerBrush";

    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true };

    private static readonly SearchValues<char> CsvSpecialChars = SearchValues.Create(",\"\n\r");

    /// <summary>Project <paramref name="trips"/> for <paramref name="state"/> + <paramref name="page"/>.</summary>
    /// <param name="trips">The parsed trip snapshot (server order).</param>
    /// <param name="state">The resolved lifecycle state.</param>
    /// <param name="page">The 1-based display page for the trip list.</param>
    /// <param name="units">The user's unit preference (web <c>unitPrefs</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="now">The clock used for date formatting.</param>
    /// <returns>The render-ready display model.</returns>
    public static TripListDisplay Project(
        IReadOnlyList<TripListItem> trips,
        TripListState state,
        int page,
        UnitPref units,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(trips);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        bool populated = state == TripListState.Success && trips.Count > 0;

        // Web parity: the four MetricCards render whenever the page is not loading — during the empty state
        // they show zero totals (isLoading ? skeletons : cards). Only the loading branch swaps them for
        // skeletons (handled by the view).
        IReadOnlyList<TripStatCard> statCards = state == TripListState.Loading
            ? Array.Empty<TripStatCard>()
            : BuildStatCards(trips, units, localizer);

        IReadOnlyList<TripChartBar> chartBars = populated
            ? BuildChartBars(trips, units, localizer)
            : Array.Empty<TripChartBar>();

        var allRows = populated ? BuildRows(trips, units, localizer, now) : Array.Empty<TripRow>();
        int totalRows = allRows.Count;
        int pageCount = Math.Max(1, (int)Math.Ceiling(totalRows / (double)DisplayPageSize));
        int clampedPage = Math.Min(Math.Max(1, page), pageCount);
        IReadOnlyList<TripRow> pageRows = totalRows == 0
            ? Array.Empty<TripRow>()
            : Slice(allRows, clampedPage);

        return new TripListDisplay(
            State: state,
            StatCards: statCards,
            ChartBars: chartBars,
            Rows: pageRows,
            TotalRowCount: totalRows,
            Page: clampedPage,
            PageSize: DisplayPageSize,
            Title: Title(localizer),
            Subtitle: Subtitle(localizer),
            ChartTitle: ChartTitle(localizer),
            ChartAriaLabel: ChartAriaLabel(localizer),
            ChartEmptyMessage: ChartEmptyMessage(localizer),
            ChartTripColumnLabel: ChartTripColumnLabel(localizer),
            ChartDistanceColumnLabel: ChartDistanceColumnLabel(units, localizer),
            ChartDataTableLabel: ChartTitle(localizer),
            ExportCsvLabel: ExportCsvLabel(localizer),
            ExportJsonLabel: ExportJsonLabel(localizer),
            ListHeading: ListHeading(localizer),
            ListEmptyMessage: ListEmptyMessage(localizer));
    }

    /// <summary>The localized page title (web <c>trips.title</c>).</summary>
    public static string Title(ILocalizer localizer) =>
        Require(localizer).GetString("trips.title", "Trips");

    /// <summary>The localized page subtitle (web <c>trips.subtitle</c>).</summary>
    public static string Subtitle(ILocalizer localizer) =>
        Require(localizer).GetString(
            "trips.subtitle",
            "Multi-drive trip reports with distance and cost tracking");

    /// <summary>The localized top-trips chart title (web <c>trips.chart.title</c>).</summary>
    public static string ChartTitle(ILocalizer localizer) =>
        Require(localizer).GetString("trips.chart.title", "Top Trips by Distance");

    /// <summary>The localized chart Narrator summary (web <c>trips.chart.title.aria</c>).</summary>
    public static string ChartAriaLabel(ILocalizer localizer) =>
        Require(localizer).GetString(
            "trips.chart.title.aria",
            "Top trips ranked by distance horizontal bar chart");

    /// <summary>The localized chart empty message (web <c>trips.chart.empty</c>).</summary>
    public static string ChartEmptyMessage(ILocalizer localizer) =>
        Require(localizer).GetString("trips.chart.empty", "No trip data to chart");

    /// <summary>The localized chart "Trip" column label (web <c>trips.chart.col.trip</c>).</summary>
    public static string ChartTripColumnLabel(ILocalizer localizer) =>
        Require(localizer).GetString("trips.chart.col.trip", "Trip");

    /// <summary>The localized chart "Distance (unit)" column label (web <c>trips.chart.distance</c> + unit).</summary>
    public static string ChartDistanceColumnLabel(UnitPref units, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(units);
        string distance = Require(localizer).GetString("trips.chart.distance", "Distance");
        return string.Create(CultureInfo.InvariantCulture, $"{distance} ({UnitLabels.Label(units.Distance)})");
    }

    /// <summary>The localized CSV export button label (web <c>trips.export.csv</c>).</summary>
    public static string ExportCsvLabel(ILocalizer localizer) =>
        Require(localizer).GetString("trips.export.csv", "CSV");

    /// <summary>The localized JSON export button label (web <c>trips.export.json</c>).</summary>
    public static string ExportJsonLabel(ILocalizer localizer) =>
        Require(localizer).GetString("trips.export.json", "JSON");

    /// <summary>The localized trip-list heading (web <c>trips.list.heading</c>).</summary>
    public static string ListHeading(ILocalizer localizer) =>
        Require(localizer).GetString("trips.list.heading", "All Trips");

    /// <summary>The localized trip-list empty message (web <c>trips.list.empty</c>).</summary>
    public static string ListEmptyMessage(ILocalizer localizer) =>
        Require(localizer).GetString("trips.list.empty", "No trips recorded yet");

    /// <summary>
    /// Format the trip duration exactly as the web page's own <c>formatDuration(startDate, endDate)</c>:
    /// "In progress" for a missing end, "{m}m" when under an hour, "{h}h {m}m" when the rounded minutes reach a
    /// half-minute, otherwise "{h}h".
    /// </summary>
    /// <param name="start">The trip start instant.</param>
    /// <param name="end">The trip end instant, or null.</param>
    /// <param name="localizer">The i18n facade resolving the "In progress" label.</param>
    /// <returns>The formatted duration label.</returns>
    public static string FormatDuration(DateTimeOffset? start, DateTimeOffset? end, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        if (end is not { } e || start is not { } s)
        {
            return localizer.GetString("trips.row.inProgress", "In progress");
        }

        double ms = (e - s).TotalMilliseconds;
        if (double.IsNaN(ms) || double.IsInfinity(ms))
        {
            return EmDash;
        }

        long hours = (long)Math.Floor(ms / MillisecondsPerHour);
        double minsRaw = ms % MillisecondsPerHour / MillisecondsPerMinute;
        if (hours == 0)
        {
            return ScalarFormatters.FormatNumber(minsRaw, 0) + "m";
        }

        return minsRaw >= 0.5
            ? string.Create(CultureInfo.InvariantCulture, $"{hours}h ") + ScalarFormatters.FormatNumber(minsRaw, 0) + "m"
            : string.Create(CultureInfo.InvariantCulture, $"{hours}h");
    }

    /// <summary>Format an SI-meters distance as "{value} {unit}" (web <c>fmtInt(convertDistanceFromSI(…)) + unit</c>).</summary>
    /// <param name="meters">The SI distance in meters.</param>
    /// <param name="units">The user's unit preference.</param>
    /// <returns>The display distance with its unit label.</returns>
    public static string FormatDistance(double meters, UnitPref units)
    {
        ArgumentNullException.ThrowIfNull(units);
        double value = UnitConverters.DistanceFromSi(meters, units.Distance);
        return ScalarFormatters.FormatNumber(value, 0) + " " + UnitLabels.Label(units.Distance);
    }

    /// <summary>Resolve a trip's display name, falling back to "Trip #{id}" (web <c>trip.name ?? `Trip #…`</c>).</summary>
    /// <param name="name">The raw trip name, or null.</param>
    /// <param name="id">The trip id used in the fallback.</param>
    /// <param name="localizer">The i18n facade resolving the "Trip" label.</param>
    /// <returns>The resolved name.</returns>
    public static string ResolveName(string? name, long id, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        if (!string.IsNullOrWhiteSpace(name))
        {
            return name;
        }

        string tripWord = localizer.GetString("trips.row.trip", "Trip");
        return string.Create(CultureInfo.InvariantCulture, $"{tripWord} #{id}");
    }

    /// <summary>The chart-bar trip name, falling back to "Trip {id}" (web <c>trip.name ?? `Trip ${id}`</c>).</summary>
    /// <param name="name">The raw trip name, or null.</param>
    /// <param name="id">The trip id used in the fallback.</param>
    /// <param name="localizer">The i18n facade resolving the "Trip" label.</param>
    /// <returns>The resolved chart label.</returns>
    public static string ResolveChartName(string? name, long id, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        if (!string.IsNullOrWhiteSpace(name))
        {
            return name;
        }

        string tripWord = localizer.GetString("trips.row.trip", "Trip");
        return string.Create(CultureInfo.InvariantCulture, $"{tripWord} {id}");
    }

    /// <summary>Build the four summary metric tiles (web stats grid).</summary>
    /// <param name="trips">The parsed trip snapshot.</param>
    /// <param name="units">The user's unit preference.</param>
    /// <param name="localizer">The i18n facade.</param>
    /// <returns>The four metric tiles in web order (distance / energy / cost / total).</returns>
    public static IReadOnlyList<TripStatCard> BuildStatCards(
        IReadOnlyList<TripListItem> trips, UnitPref units, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(trips);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        double totalDistM = 0, totalEnergyWh = 0, totalCost = 0;
        long totalDrives = 0;
        foreach (var trip in trips)
        {
            totalDistM += trip.TotalDistanceM;
            totalEnergyWh += trip.TotalEnergyWh;
            totalCost += trip.TotalCost;
            totalDrives += trip.DriveCount;
        }

        double totalDistDisplay = UnitConverters.DistanceFromSi(totalDistM, units.Distance);
        string distanceUnit = UnitLabels.Label(units.Distance);

        string distanceLabel = localizer.GetString("trips.stats.distance", "Total Distance");
        string distanceValue = ScalarFormatters.FormatNumber(totalDistDisplay, 0) + " " + distanceUnit;
        string distanceSub = Count(localizer, "trips.stats.tripCount", "{0} trips", trips.Count);

        string energyLabel = localizer.GetString("trips.stats.energy", "Energy Used");
        string energyValue = UnitFormatters.FormatEnergy(totalEnergyWh, units);
        string energySub = Count(localizer, "trips.stats.driveCount", "{0} drives", totalDrives);

        string costLabel = localizer.GetString("trips.stats.cost", "Total Cost");
        string costValue = ScalarFormatters.FormatCurrency(totalCost);
        string costSub = totalDistDisplay > 0
            ? ScalarFormatters.FormatCurrency(totalCost / totalDistDisplay * 100)
                + string.Create(CultureInfo.InvariantCulture, $"/100{distanceUnit}")
            : ScalarFormatters.FormatCurrency(0);

        string totalLabel = localizer.GetString("trips.stats.total", "Total Trips");
        string totalValue = trips.Count.ToString(CultureInfo.InvariantCulture);
        string totalSub = Count(localizer, "trips.stats.totalDrives", "{0} total drives", totalDrives);

        return new[]
        {
            new TripStatCard("distance", distanceLabel, distanceValue, distanceSub, CyanAccentBrushKey, Automation(distanceLabel, distanceValue, distanceSub)),
            new TripStatCard("energy", energyLabel, energyValue, energySub, AmberAccentBrushKey, Automation(energyLabel, energyValue, energySub)),
            new TripStatCard("cost", costLabel, costValue, costSub, GreenAccentBrushKey, Automation(costLabel, costValue, costSub)),
            new TripStatCard("total", totalLabel, totalValue, totalSub, PurpleAccentBrushKey, Automation(totalLabel, totalValue, totalSub)),
        };
    }

    /// <summary>Build the top-10-by-distance chart bars (web <c>chartData</c>).</summary>
    /// <param name="trips">The parsed trip snapshot.</param>
    /// <param name="units">The user's unit preference.</param>
    /// <param name="localizer">The i18n facade.</param>
    /// <returns>The top-10 bars, sorted by distance descending.</returns>
    public static IReadOnlyList<TripChartBar> BuildChartBars(
        IReadOnlyList<TripListItem> trips, UnitPref units, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(trips);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        var top = trips
            .OrderByDescending(t => t.TotalDistanceM)
            .Take(ChartTopN)
            .ToList();

        if (top.Count == 0)
        {
            return Array.Empty<TripChartBar>();
        }

        double max = 0;
        foreach (var trip in top)
        {
            double value = UnitConverters.DistanceFromSi(trip.TotalDistanceM, units.Distance);
            if (value > max)
            {
                max = value;
            }
        }

        var bars = new List<TripChartBar>(top.Count);
        foreach (var trip in top)
        {
            double value = UnitConverters.DistanceFromSi(trip.TotalDistanceM, units.Distance);
            string name = ResolveChartName(trip.Name, trip.Id, localizer);
            string distanceText = ScalarFormatters.FormatNumber(value, 0) + " " + UnitLabels.Label(units.Distance);
            double ratio = max > 0 ? Math.Clamp(value / max, 0, 1) : 0;
            bars.Add(new TripChartBar(trip.Id, name, value, distanceText, ratio, $"{name}: {distanceText}"));
        }

        return bars;
    }

    /// <summary>Build every display row from the trip snapshot (web <c>allTrips.map(TripRow)</c>).</summary>
    /// <param name="trips">The parsed trip snapshot.</param>
    /// <param name="units">The user's unit preference.</param>
    /// <param name="localizer">The i18n facade.</param>
    /// <param name="now">The clock used for date labels.</param>
    /// <returns>All rows in server order.</returns>
    public static IReadOnlyList<TripRow> BuildRows(
        IReadOnlyList<TripListItem> trips, UnitPref units, ILocalizer localizer, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(trips);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        string efficiencyUnit = units.Distance == DistanceUnit.Mi ? "Wh/mi" : "Wh/km";
        string costCaption = localizer.GetString("trips.row.cost", "cost");

        var rows = new List<TripRow>(trips.Count);
        foreach (var trip in trips)
        {
            string name = ResolveName(trip.Name, trip.Id, localizer);
            string dateText = DateTimeFormatting.Format(trip.StartInstant, DateTimeVariant.Date, now);
            string durationText = FormatDuration(trip.StartInstant, trip.EndInstant, localizer);
            string drivesText = Count(localizer, "trips.row.drives", "{0} drives", trip.DriveCount);
            bool hasCharges = trip.ChargeCount > 0;
            string chargesText = hasCharges
                ? Count(localizer, "trips.row.charges", "{0} charges", trip.ChargeCount)
                : string.Empty;
            string distanceText = FormatDistance(trip.TotalDistanceM, units);
            string energyText = UnitFormatters.FormatEnergy(trip.TotalEnergyWh, units);
            string efficiencyText = FormatEfficiency(trip, units, efficiencyUnit);
            bool hasCost = trip.TotalCost > 0;
            string costText = hasCost ? ScalarFormatters.FormatCurrency(trip.TotalCost) : string.Empty;

            string automation = string.Join(
                ", ",
                name, dateText, durationText, drivesText, distanceText, energyText);

            rows.Add(new TripRow(
                trip.Id, name, dateText, durationText, drivesText, chargesText, hasCharges,
                distanceText, energyText, efficiencyText, costText, hasCost, costCaption, automation));
        }

        return rows;
    }

    /// <summary>
    /// Serialize a trip snapshot to CSV exactly as the web <c>handleExportCSV</c> does (the same column set and
    /// raw SI values). Pure / UI-free so the export content is unit-tested and the view only writes the file.
    /// </summary>
    /// <param name="trips">The parsed trip snapshot.</param>
    /// <param name="localizer">The i18n facade resolving the "Trip" name fallback.</param>
    /// <returns>The CSV document text.</returns>
    public static string BuildCsv(IReadOnlyList<TripListItem> trips, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(trips);
        ArgumentNullException.ThrowIfNull(localizer);

        var sb = new StringBuilder();
        sb.Append("id,name,start_date,end_date,distance_m,energy_wh,cost,drives,charges\n");
        foreach (var trip in trips)
        {
            string name = trip.Name ?? ResolveName(null, trip.Id, localizer);
            sb.Append(trip.Id.ToString(CultureInfo.InvariantCulture)).Append(',')
                .Append(CsvField(name)).Append(',')
                .Append(CsvField(IsoOrEmpty(trip.StartInstant))).Append(',')
                .Append(CsvField(IsoOrEmpty(trip.EndInstant))).Append(',')
                .Append(trip.TotalDistanceM.ToString(CultureInfo.InvariantCulture)).Append(',')
                .Append(trip.TotalEnergyWh.ToString(CultureInfo.InvariantCulture)).Append(',')
                .Append(trip.TotalCost.ToString(CultureInfo.InvariantCulture)).Append(',')
                .Append(trip.DriveCount.ToString(CultureInfo.InvariantCulture)).Append(',')
                .Append(trip.ChargeCount.ToString(CultureInfo.InvariantCulture))
                .Append('\n');
        }

        return sb.ToString();
    }

    /// <summary>Serialize a trip snapshot to pretty JSON (web <c>handleExportJSON</c>). Pure / UI-free.</summary>
    /// <param name="trips">The parsed trip snapshot.</param>
    /// <returns>The JSON document text.</returns>
    public static string BuildJson(IReadOnlyList<TripListItem> trips)
    {
        ArgumentNullException.ThrowIfNull(trips);

        var rows = new List<Dictionary<string, object?>>(trips.Count);
        foreach (var trip in trips)
        {
            rows.Add(new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["id"] = trip.Id,
                ["name"] = trip.Name,
                ["start_date"] = IsoOrNull(trip.StartInstant),
                ["end_date"] = IsoOrNull(trip.EndInstant),
                ["total_distance_m"] = trip.TotalDistanceM,
                ["total_energy_wh"] = trip.TotalEnergyWh,
                ["total_cost"] = trip.TotalCost,
                ["drive_count"] = trip.DriveCount,
                ["charge_count"] = trip.ChargeCount,
            });
        }

        return JsonSerializer.Serialize(rows, JsonOptions);
    }

    private static string FormatEfficiency(TripListItem trip, UnitPref units, string efficiencyUnit)
    {
        if (trip.TotalDistanceM <= 0)
        {
            return "0 " + efficiencyUnit;
        }

        double whPerKm = trip.TotalEnergyWh / (trip.TotalDistanceM / 1000.0);
        double display = units.Distance == DistanceUnit.Mi ? whPerKm * KmPerMile : whPerKm;
        return ScalarFormatters.FormatNumber(display, 0) + " " + efficiencyUnit;
    }

    private static IReadOnlyList<TripRow> Slice(IReadOnlyList<TripRow> rows, int page)
    {
        int start = (page - 1) * DisplayPageSize;
        if (start >= rows.Count)
        {
            return Array.Empty<TripRow>();
        }

        int count = Math.Min(DisplayPageSize, rows.Count - start);
        var slice = new List<TripRow>(count);
        for (int i = 0; i < count; i++)
        {
            slice.Add(rows[start + i]);
        }

        return slice;
    }

    private static string Count(ILocalizer localizer, string key, string fallback, long count)
    {
        string template = localizer.GetString(key, fallback);
        return string.Format(CultureInfo.CurrentCulture, template, count);
    }

    private static string Automation(string label, string value, string sublabel) =>
        string.Join(", ", label, value, sublabel);

    private static string CsvField(string value)
    {
        if (value.AsSpan().IndexOfAny(CsvSpecialChars) < 0)
        {
            return value;
        }

        return "\"" + value.Replace("\"", "\"\"", StringComparison.Ordinal) + "\"";
    }

    private static string IsoOrEmpty(DateTimeOffset? value) =>
        value is { } v ? v.ToString("O", CultureInfo.InvariantCulture) : string.Empty;

    private static string? IsoOrNull(DateTimeOffset? value) =>
        value is { } v ? v.ToString("O", CultureInfo.InvariantCulture) : null;

    private static ILocalizer Require(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer;
    }
}

/// <summary>
/// Static identity + i18n helpers for the Trips page (web
/// <c>web/src/features/trips/pages/TripListPage.tsx</c>, route <c>/trips</c>, nav name <c>Trips</c>). The shell
/// page factory binds the view under <see cref="RouteName"/>; the <see cref="TeslaSync.App.Core.Navigation.RouteTable"/>
/// already maps <c>trips</c> to it.
/// </summary>
public static class TripListRegistration
{
    /// <summary>The navigation route name the shell page factory registers this page under.</summary>
    public const string RouteName = "Trips";

    /// <summary>The web route path (web <c>/trips</c>).</summary>
    public const string Route = "trips";

    /// <summary>The diagnostics slug (web component family).</summary>
    public const string Slug = "TripListPage";

    /// <summary>The cache-key prefix for the cache-then-network trips read.</summary>
    public const string CacheKeyPrefix = "trips:list";

    /// <summary>The Fluent route glyph (web Route icon; row avatar + empty-state icon).</summary>
    public const string RouteGlyph = "\uE7C0";

    /// <summary>The Fluent glyph for the export affordances (web Download icon).</summary>
    public const string ExportGlyph = "\uE74E";
}

/// <summary>
/// PII-safe diagnostics sink for the Trips page — records only the <c>view.opened</c> event (no trip names,
/// distances, costs or ids), mirroring the established W7 page diagnostics contract.
/// </summary>
public sealed class TripListDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the diagnostics sink over an optional line writer (null = count only).</summary>
    /// <param name="sink">Receives each PII-safe diagnostic line; null counts without emitting.</param>
    public TripListDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>The number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={TripListRegistration.Slug}");
    }
}

/// <summary>
/// The data port the <see cref="TripListPageViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of parsed trip lists — the native analogue of the web page's
/// <c>useTrips({ vehicle_id, limit })</c> hook. The view never performs HTTP itself; the concrete
/// <see cref="TripListSource"/> (or a test fake) drives this.
/// </summary>
public interface ITripListSource
{
    /// <summary>Stream the cache-then-network trip snapshots, newest cache first.</summary>
    /// <param name="cancellationToken">Cancels the in-flight read when a newer load supersedes it.</param>
    /// <returns>The ordered cache-then-network emissions for one logical read.</returns>
    IAsyncEnumerable<RepositoryResult<IReadOnlyList<TripListItem>>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The default <see cref="ITripListSource"/> — resolves every read to the empty list (the empty data state).
/// The shell registration uses this until a host wires the generated-client-backed <see cref="TripListSource"/>
/// via <see cref="TripListPage.Create"/>.
/// </summary>
public sealed class EmptyTripListSource : ITripListSource
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyTripListSource Instance { get; } = new();

    private EmptyTripListSource()
    {
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<TripListItem>>> StreamAsync(
        [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        yield return RepositoryResult<IReadOnlyList<TripListItem>>.Empty();
        await Task.CompletedTask.ConfigureAwait(false);
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;IReadOnlyList&lt;TripListItem&gt;&gt;</c>, preserving every freshness flag
/// (cached / refreshing / stale / offline) so the view-model can fold them into the loading / success / empty
/// states. Kept pure so the parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class TripListResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    /// <param name="raw">The raw cache-then-network emission.</param>
    /// <returns>The parsed emission with the same lifecycle status.</returns>
    public static RepositoryResult<IReadOnlyList<TripListItem>> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        IReadOnlyList<TripListItem> Parse() =>
            raw.HasValue ? TripListItem.ParseList(raw.Value) : Array.Empty<TripListItem>();

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<IReadOnlyList<TripListItem>>.Loading(),
            LoadStatus.Cached => RepositoryResult<IReadOnlyList<TripListItem>>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<IReadOnlyList<TripListItem>>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<IReadOnlyList<TripListItem>>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<IReadOnlyList<TripListItem>>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<IReadOnlyList<TripListItem>>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<IReadOnlyList<TripListItem>>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
