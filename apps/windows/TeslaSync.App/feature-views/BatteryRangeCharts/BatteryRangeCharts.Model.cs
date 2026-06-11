using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive lifecycle state a <see cref="BatteryRangeChartsViewModel"/> can be in — the native
/// superset of the branches a P2 feature surface must render for the web Battery-Range charts
/// (web/src/features/vehicles/components/vehicle-detail/BatteryRangeCharts.tsx). The web component is a pure
/// child of the Vehicle-Detail page (it takes its <c>state</c> and <c>drives</c> as props); the native
/// surface owns its own cache-then-network read of the vehicle's live state plus its recent drives, so it
/// renders the full loading / loaded / empty / error / stale / offline matrix. Every value maps onto a
/// visible surface — none is hidden. <see cref="Empty"/> is reached only when no vehicle / no usable live
/// state resolves (the battery panel has nothing to plot); a present state with no drives is still
/// <see cref="Loaded"/> and the Drive-Trend panel renders its own friendly inner empty state, mirroring the
/// web <c>driveChartData.length &gt; 0</c> gate.
/// </summary>
public enum BatteryRangeChartsState
{
    /// <summary>Initial fetch with no cached snapshot — render the per-panel skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh snapshot carrying a usable battery state — render both panels.</summary>
    Loaded,

    /// <summary>No vehicle / no usable live state resolved — render the friendly empty state.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// One recent drive's distance/duration sample — the native analogue of the fields the web Battery-Range
/// drive-trend chart reads off each <c>Drive</c> (<c>start_ts</c>, <c>distance_m</c>, <c>duration_s</c>) in
/// web/src/features/vehicles/components/vehicle-detail/BatteryRangeCharts.tsx. SI on the wire (metres,
/// seconds); the projection converts at the display boundary. Parsing is null-tolerant (the web
/// <c>?? 0</c>) so a partial row never throws and a missing metric stays null.
/// </summary>
/// <param name="StartTs">Drive start instant, or null (web <c>start_ts</c>, the X-axis label source).</param>
/// <param name="DistanceMeters">Drive distance in SI metres, or null (web <c>distance_m</c>).</param>
/// <param name="DurationSeconds">Drive duration in SI seconds, or null (web <c>duration_s</c>).</param>
public sealed record DriveDistanceSample(
    DateTimeOffset? StartTs,
    double? DistanceMeters,
    double? DurationSeconds)
{
    /// <summary>Parse a drives JSON array into a tolerant list of samples, preserving the server order.</summary>
    public static IReadOnlyList<DriveDistanceSample> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<DriveDistanceSample>();
        }

        var list = new List<DriveDistanceSample>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Project a single drive JSON object into a tolerant sample.</summary>
    public static DriveDistanceSample FromJson(JsonElement obj) => new(
        BatteryRangeJson.DateTime(obj, "start_ts"),
        BatteryRangeJson.Double(obj, "distance_m"),
        BatteryRangeJson.Double(obj, "duration_s"));
}

/// <summary>
/// The assembled snapshot the <see cref="BatteryRangeChartsViewModel"/> projects — the native mirror of the
/// two props the web Vehicle-Detail page hands <c>&lt;BatteryRangeCharts state={…} drives={…} /&gt;</c>
/// (web/src/features/vehicles/components/vehicle-detail/BatteryRangeCharts.tsx, assembled from
/// <c>useVehicleState</c> and <c>useDrives</c>). It carries the live battery state (the gauge / bar / stat
/// figures) and the recent-drive distances/durations (the trend chart). Cached as JSON by the shared
/// <see cref="TeslaSync.App.Core.Data.CacheThenNetworkEngine"/> so it round-trips losslessly. WinUI-free so
/// the parse is unit-tested without a UI host; parsing is null-tolerant.
/// </summary>
/// <param name="HasState">True when a usable live state (a finite battery level) resolved.</param>
/// <param name="BatteryLevelPct">State-of-charge percent (web <c>state.battery_level</c>); 0 when absent.</param>
/// <param name="RatedRangeMeters">Rated range in SI metres (web <c>state.rated_range</c>), or null.</param>
/// <param name="Drives">The recent drives behind the trend chart (web <c>drives</c>), server order.</param>
public sealed record BatteryRangeChartsData(
    bool HasState,
    double BatteryLevelPct,
    double? RatedRangeMeters,
    IReadOnlyList<DriveDistanceSample> Drives)
{
    /// <summary>The no-data snapshot — the parse fallback for an asleep / absent state and the engine empty.</summary>
    public static BatteryRangeChartsData Empty { get; } =
        new(false, 0, null, Array.Empty<DriveDistanceSample>());

    /// <summary>
    /// True when a usable live battery state backed the snapshot. Drives the Loaded-vs-Empty classification:
    /// the battery panel only renders when there is a real state-of-charge to plot (the web component is
    /// rendered by its parent only once <c>state</c> exists). The drive list never gates the surface — a
    /// present state with no drives is still data, the Drive-Trend panel showing its own inner empty state.
    /// </summary>
    [JsonIgnore]
    public bool HasData => HasState;

    /// <summary>
    /// Assemble a snapshot from the vehicle-state response and the drives array. The state response is the
    /// web <c>StateResponse</c> envelope <c>{ state, live }</c>; the canonical state object (or a plain
    /// state object) supplies <c>battery_level</c> / <c>rated_range</c>. A response without a finite battery
    /// level (an asleep vehicle, web <c>stateData?.state</c> undefined) yields <see cref="Empty"/> so the
    /// surface shows its friendly empty state rather than a fabricated 0%.
    /// </summary>
    public static BatteryRangeChartsData FromParts(JsonElement stateResponse, JsonElement drives)
    {
        var drivesList = DriveDistanceSample.ParseList(drives);

        JsonElement? state = ResolveStateObject(stateResponse);
        if (state is not { } s || BatteryRangeJson.Double(s, "battery_level") is not { } level)
        {
            return new BatteryRangeChartsData(false, 0, null, drivesList);
        }

        return new BatteryRangeChartsData(
            HasState: true,
            BatteryLevelPct: level,
            RatedRangeMeters: BatteryRangeJson.Double(s, "rated_range"),
            Drives: drivesList);
    }

    // Web parity (helpers.ts StateResponse): the API returns `{ state: VehicleState, live }`. Prefer the
    // nested `state` object; tolerate a bare state object (no envelope) exactly as the native VehicleHero
    // surface does.
    private static JsonElement? ResolveStateObject(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        if (root.TryGetProperty("state", out var nested) && nested.ValueKind == JsonValueKind.Object)
        {
            return nested;
        }

        return root.TryGetProperty("battery_level", out _) ? root : null;
    }
}

/// <summary>
/// One categorical bar of the battery composition chart — the native analogue of a web
/// <c>batteryChartData</c> entry (<c>{ name, value }</c>): the localized <see cref="Label"/> ("Current" /
/// "Remaining") and its 0..100 <see cref="Value"/>. Pure data so the projection is unit-tested without a UI
/// host.
/// </summary>
/// <param name="Label">Localized category label (web "Current" / "Remaining").</param>
/// <param name="Value">The bar value, percent (web <c>state.battery_level</c> / <c>100 - …</c>).</param>
public sealed record BatteryBarDatum(string Label, double Value);

/// <summary>
/// One projected point of the drive-distance trend — the native analogue of a web <c>driveChartData</c>
/// entry. Holds the X-axis <see cref="DateLabel"/> (web <c>formatDate(start_ts)</c>), the display-unit
/// <see cref="DistanceDisplay"/> (web <c>Math.round(convertDistanceFromSI(distance_m))</c>) and the
/// <see cref="DurationMinutes"/> (web <c>Math.round(duration_s / 60)</c>). Pure data so the projection is
/// unit-tested without a UI host.
/// </summary>
/// <param name="DateLabel">Localized drive-date label (web <c>formatDate(start_ts)</c>).</param>
/// <param name="DistanceDisplay">Distance in the user's display unit, rounded (web <c>distance</c>).</param>
/// <param name="DurationMinutes">Duration in whole minutes (web <c>duration</c>).</param>
public sealed record DriveTrendPoint(string DateLabel, double DistanceDisplay, double DurationMinutes);

/// <summary>
/// The fully projected, render-ready view of the Battery-Range surface — the native analogue of everything
/// the web component computes before returning its two <c>GlassPanel</c>s. Carries the always-present chrome
/// strings, the battery panel's gauge / stat / bar figures, and the drive-trend panel's points + the
/// <see cref="HasDriveData"/> gate (web <c>driveChartData.length &gt; 0</c>). Pure data so the projection is
/// unit-tested without a UI host.
/// </summary>
public sealed record BatteryRangeChartsDisplay(
    // Panel 1 — Battery Overview.
    string BatteryOverviewTitle,
    double GaugeValue,
    double GaugeMax,
    StatusKind BatteryTier,
    string GaugeLabel,
    string GaugeUnit,
    string BatteryStatLabel,
    double BatteryStatValue,
    string RangeStatLabel,
    double RangeDisplay,
    string DistanceUnitLabel,
    IReadOnlyList<BatteryBarDatum> BatteryBars,
    string BatteryChartAutomationName,
    // Panel 2 — Drive Distance Trend.
    string DriveTrendTitle,
    bool HasDriveData,
    IReadOnlyList<DriveTrendPoint> DrivePoints,
    string DistanceSeriesName,
    string DurationSeriesName,
    string DriveChartAutomationName,
    string NoDriveDataMessage);

/// <summary>
/// Pure projection from the assembled <see cref="BatteryRangeChartsData"/> to the display model — the native
/// port of the web component's <c>batteryChartData</c> / <c>driveChartData</c> memos
/// (web/src/features/vehicles/components/vehicle-detail/BatteryRangeCharts.tsx). It reproduces the web
/// derivations exactly: the bar data is <c>[{Current, level}, {Remaining, 100-level}]</c>; the gauge tint is
/// <c>batteryColor(level)</c> (<c>&gt; 60</c> good, <c>&gt; 25</c> warning, else critical, mapped to the
/// equivalent <see cref="StatusKind"/> token brushes whose dark values are the same
/// <c>#10B981 / #F59E0B / #EF4444</c>); the range is <c>convertDistanceFromSI(rated_range)</c>; and the
/// trend points are <c>convertDistanceFromSI(distance_m)</c> / <c>duration_s / 60</c>, rounded and reversed
/// oldest→newest. Distance conversion happens here and only here; every label resolves through the i18n
/// facade.
/// </summary>
public static class BatteryRangeChartsProjection
{
    /// <summary>Above this level the battery reads "good" (web <c>batteryColor</c> <c>level &gt; 60</c>).</summary>
    public const double GoodThreshold = 60;

    /// <summary>Above this level (but not above <see cref="GoodThreshold"/>) the battery reads "warning" (web <c>level &gt; 25</c>).</summary>
    public const double WarningThreshold = 25;

    /// <summary>Gauge / bar full-scale (web <c>max={100}</c> and the <c>100 - level</c> remainder).</summary>
    public const double FullPercent = 100;

    /// <summary>
    /// Select the semantic tier for <paramref name="level"/>, mirroring the web <c>batteryColor(level)</c>:
    /// <c>level &gt; 60 ? good : level &gt; 25 ? warning : critical</c>. A non-finite level fails both
    /// comparisons and falls through to <see cref="StatusKind.Danger"/>.
    /// </summary>
    public static StatusKind BatteryTier(double level) =>
        level > GoodThreshold ? StatusKind.Success
        : level > WarningThreshold ? StatusKind.Warning
        : StatusKind.Danger;

    /// <summary>Project <paramref name="data"/> for the user's <paramref name="units"/>, localized via <paramref name="localizer"/>.</summary>
    /// <param name="data">The assembled snapshot (live state + recent drives).</param>
    /// <param name="units">The user's unit preference (web <c>useUnits</c>).</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    public static BatteryRangeChartsDisplay Project(
        BatteryRangeChartsData data,
        UnitPref units,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(data);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        double level = Math.Clamp(data.BatteryLevelPct, 0, FullPercent);
        double remaining = Math.Clamp(FullPercent - level, 0, FullPercent);
        double range = UnitConverters.DistanceFromSi(data.RatedRangeMeters ?? 0, units.Distance);
        string distanceUnit = UnitLabels.Label(units.Distance);

        string currentLabel = localizer.GetString("common.current", "Current");
        string remainingLabel = localizer.GetString("common.remaining", "Remaining");
        var bars = new[]
        {
            new BatteryBarDatum(currentLabel, level),
            new BatteryBarDatum(remainingLabel, remaining),
        };

        var points = BuildTrendPoints(data.Drives, units);
        string distanceSeries =
            $"{localizer.GetString("common.distance", "Distance")} ({distanceUnit})";
        string durationSeries = localizer.GetString("common.duration", "Duration");

        return new BatteryRangeChartsDisplay(
            BatteryOverviewTitle: localizer.GetString("vehicles.detail.batteryOverview", "Battery Overview"),
            GaugeValue: level,
            GaugeMax: FullPercent,
            BatteryTier: BatteryTier(level),
            GaugeLabel: localizer.GetString("common.battery", "Battery"),
            GaugeUnit: "%",
            BatteryStatLabel: localizer.GetString("common.battery", "Battery"),
            BatteryStatValue: level,
            RangeStatLabel: localizer.GetString("common.range", "Range"),
            RangeDisplay: range,
            DistanceUnitLabel: distanceUnit,
            BatteryBars: bars,
            BatteryChartAutomationName: BatteryAutomationName(level, remaining, currentLabel, remainingLabel, localizer),
            DriveTrendTitle: localizer.GetString("vehicles.detail.driveTrend", "Drive Distance Trend"),
            HasDriveData: points.Count > 0,
            DrivePoints: points,
            DistanceSeriesName: distanceSeries,
            DurationSeriesName: durationSeries,
            DriveChartAutomationName: DriveAutomationName(points, distanceSeries, durationSeries, localizer),
            NoDriveDataMessage: localizer.GetString("vehicles.detail.noDriveData", "No drive data for chart"));
    }

    /// <summary>Project the empty (no usable state) display using the localizer.</summary>
    public static BatteryRangeChartsDisplay Empty(UnitPref units, ILocalizer localizer) =>
        Project(BatteryRangeChartsData.Empty, units, localizer);

    // Web parity: driveChartData = (drives ?? []).map(...).reverse() — newest-first server rows become an
    // oldest→newest trend, each distance converted from SI and rounded, each duration in whole minutes.
    private static IReadOnlyList<DriveTrendPoint> BuildTrendPoints(
        IReadOnlyList<DriveDistanceSample> drives,
        UnitPref units)
    {
        if (drives.Count == 0)
        {
            return Array.Empty<DriveTrendPoint>();
        }

        var points = new List<DriveTrendPoint>(drives.Count);
        for (int i = drives.Count - 1; i >= 0; i--)
        {
            var d = drives[i];
            double distance = Math.Round(UnitConverters.DistanceFromSi(d.DistanceMeters ?? 0, units.Distance));
            double duration = Math.Round((d.DurationSeconds ?? 0) / 60.0);
            points.Add(new DriveTrendPoint(FormatDate(d.StartTs), distance, duration));
        }

        return points;
    }

    // Web parity: formatDate(start_ts) → "MMM d, yyyy" (Intl month:'short', day/year:'numeric'); the native
    // shared formatter's Date variant emits the identical en-US shape. `now` is irrelevant for the Date
    // variant, so the projection stays pure and deterministic.
    private static string FormatDate(DateTimeOffset? ts) =>
        DateTimeFormatting.Format(ts, DateTimeVariant.Date, default);

    private static string BatteryAutomationName(
        double level,
        double remaining,
        string currentLabel,
        string remainingLabel,
        ILocalizer localizer)
    {
        string title = localizer.GetString("vehicles.detail.batteryOverview", "Battery Overview");
        return string.Create(
            CultureInfo.InvariantCulture,
            $"{title}. {currentLabel} {level:0}%, {remainingLabel} {remaining:0}%");
    }

    private static string DriveAutomationName(
        IReadOnlyList<DriveTrendPoint> points,
        string distanceSeries,
        string durationSeries,
        ILocalizer localizer)
    {
        string title = localizer.GetString("vehicles.detail.driveTrend", "Drive Distance Trend");
        if (points.Count == 0)
        {
            return $"{title}. {localizer.GetString("vehicles.detail.noDriveData", "No drive data for chart")}";
        }

        return string.Create(
            CultureInfo.InvariantCulture,
            $"{title}. {distanceSeries}, {durationSeries}. {points.Count} drives");
    }
}

/// <summary>
/// Canonical registry metadata for the Battery-Range surface — the native mirror of the web Vehicle-Detail
/// feature component (web/src/features/vehicles/components/vehicle-detail/BatteryRangeCharts.tsx). Hosting
/// binds this surface with the stable <see cref="Id"/>; diagnostics tag it with <see cref="Slug"/>.
/// </summary>
public static class BatteryRangeChartsRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "battery-range-charts";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "BatteryRangeCharts";

    /// <summary>Localized surface title (web "Battery Overview", the leading panel).</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("vehicles.detail.batteryOverview", "Battery Overview");
    }
}

/// <summary>
/// PII-safe diagnostics for the Battery-Range surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a battery level, range, drive distance,
/// VIN or vehicle id — so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class BatteryRangeChartsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public BatteryRangeChartsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=BatteryRangeCharts</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={BatteryRangeChartsRegistration.Slug}");
    }
}

/// <summary>
/// Null-tolerant JSON readers shared by the Battery-Range parse path. Mirrors the web <c>?? 0</c> / optional
/// chaining: a missing or wrong-kind field reads as null rather than throwing, so a partial body never breaks
/// the surface. UI-free so the parse is unit-tested without a XAML host.
/// </summary>
internal static class BatteryRangeJson
{
    public static double? Double(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetDouble(out var n) && !double.IsNaN(n) && !double.IsInfinity(n) => n,
            JsonValueKind.String when double.TryParse(
                v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }

    public static DateTimeOffset? DateTime(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var v)
            || v.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            v.GetString(),
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var ts)
            ? ts
            : null;
    }
}
