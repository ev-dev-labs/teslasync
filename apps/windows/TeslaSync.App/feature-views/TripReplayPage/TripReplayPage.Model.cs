using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Driving;

/// <summary>
/// One render-ready replay sample — the native analogue of a single web <c>DrivePosition</c> after the page's
/// position ↔ telemetry merge (web/src/features/trips/pages/TripReplayPage.tsx). The drive's <c>positions</c>
/// array carries only lat/lon/speed; power, battery, elevation, range and temperature live on the parallel
/// <c>telemetry</c> array, so each position is joined to its nearest-by-timestamp telemetry row. Distances and
/// ranges are SI metres, speed SI metres-per-second, temperature SI Celsius and power kilowatts (already kW at
/// this presentational boundary, exactly as the web component receives it). Parsing is null-tolerant so a partial
/// row never throws.
/// </summary>
/// <param name="Latitude">Latitude in degrees (web <c>latitude</c>).</param>
/// <param name="Longitude">Longitude in degrees (web <c>longitude</c>).</param>
/// <param name="SpeedMps">Speed in SI metres-per-second, or null (web <c>speed</c>).</param>
/// <param name="PowerKw">Instantaneous battery power in kilowatts, or null (web <c>power</c>).</param>
/// <param name="BatteryPct">State-of-charge percentage (web <c>batteryLevel</c>, defaulting to 0).</param>
/// <param name="TimestampUtc">Sample instant, or null (web <c>timestamp</c> with <c>created_at</c> fallback).</param>
/// <param name="ElevationM">Elevation in SI metres, or null (web <c>elevation</c>).</param>
/// <param name="OutsideTempC">Outside temperature in SI Celsius, or null (web <c>outsideTemp</c>).</param>
/// <param name="RatedRangeM">Rated range remaining in SI metres, or null (web <c>ratedRange</c>).</param>
public sealed record TripReplayPagePosition(
    double Latitude,
    double Longitude,
    double? SpeedMps,
    double? PowerKw,
    double BatteryPct,
    DateTimeOffset? TimestampUtc,
    double? ElevationM,
    double? OutsideTempC,
    double? RatedRangeM);

/// <summary>
/// The parsed drive aggregate the Trip-Replay page renders from — the summary stats the web reads off
/// <c>useDrive(id)</c> plus the merged <see cref="Positions"/> the replay engine, map, elevation profile and
/// current-stat cards all derive from. Distance is SI metres, duration SI seconds and speeds SI metres-per-second.
/// </summary>
/// <param name="Id">The drive id (web <c>drive.id</c>).</param>
/// <param name="StartTs">Drive start instant, or null (web <c>drive.startTs</c>).</param>
/// <param name="StartAddress">Reverse-geocoded start address, or null (web <c>drive.startAddress</c>).</param>
/// <param name="EndAddress">Reverse-geocoded end address, or null (web <c>drive.endAddress</c>).</param>
/// <param name="DistanceM">Total distance in SI metres (web <c>drive.distanceM</c>).</param>
/// <param name="DurationS">Total duration in SI seconds (web <c>drive.durationS</c>).</param>
/// <param name="StartSocPct">Start state-of-charge percentage, or null (web <c>drive.startBatteryPct</c>).</param>
/// <param name="EndSocPct">End state-of-charge percentage, or null (web <c>drive.endBatteryPct</c>).</param>
/// <param name="MaxSpeedMps">Maximum speed in SI metres-per-second, or null (web <c>drive.maxSpeedMps</c>).</param>
/// <param name="AvgSpeedMps">Average speed in SI metres-per-second, or null (web <c>drive.avgSpeedMps</c>).</param>
/// <param name="Positions">The merged, recorded-order replay samples (never null; empty when none were captured).</param>
public sealed record TripReplayDrive(
    long Id,
    DateTimeOffset? StartTs,
    string? StartAddress,
    string? EndAddress,
    double DistanceM,
    double DurationS,
    double? StartSocPct,
    double? EndSocPct,
    double? MaxSpeedMps,
    double? AvgSpeedMps,
    IReadOnlyList<TripReplayPagePosition> Positions)
{
    /// <summary>Project a <c>GET /drives/{driveID}</c> response into the drive, or null for a non-object body.</summary>
    /// <param name="root">The drive-detail JSON body.</param>
    public static TripReplayDrive? FromJson(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new TripReplayDrive(
            Id: (long)(TripReplayPageJson.Double(root, "id") ?? 0),
            StartTs: TripReplayPageJson.Date(root, "start_ts", "startTs"),
            StartAddress: TripReplayPageJson.String(root, "start_address", "startAddress"),
            EndAddress: TripReplayPageJson.String(root, "end_address", "endAddress"),
            DistanceM: TripReplayPageJson.Double(root, "distance_m", "distanceM") ?? 0,
            DurationS: TripReplayPageJson.Double(root, "duration_s", "durationS") ?? 0,
            StartSocPct: TripReplayPageJson.Double(root, "start_soc_pct", "startBatteryPct"),
            EndSocPct: TripReplayPageJson.Double(root, "end_soc_pct", "endBatteryPct"),
            MaxSpeedMps: TripReplayPageJson.Double(root, "max_speed_mps", "maxSpeedMps"),
            AvgSpeedMps: TripReplayPageJson.Double(root, "avg_speed_mps", "avgSpeedMps"),
            Positions: TripReplayPositionMerge.Build(root));
    }
}

/// <summary>The one-source drive snapshot the page renders from — the parsed drive (web <c>useDrive</c>) or none.</summary>
/// <param name="Drive">The parsed drive aggregate, or null when no drive resolved (web <c>drive === undefined</c>).</param>
public sealed record TripReplayPageSnapshot(TripReplayDrive? Drive)
{
    /// <summary>The empty snapshot — no drive resolved yet (loading / empty seed).</summary>
    public static TripReplayPageSnapshot Empty { get; } = new((TripReplayDrive?)null);

    /// <summary>True once the drive read resolved an object.</summary>
    public bool HasDrive => Drive is not null;

    /// <summary>True when there is at least one plottable position (web <c>positions.length &gt; 0</c>).</summary>
    public bool HasPositions => Drive is { Positions.Count: > 0 };
}

/// <summary>The render-time model: the parsed snapshot plus the page lifecycle flags (web query <c>isLoading</c> / error).</summary>
/// <param name="Snapshot">The parsed drive snapshot.</param>
/// <param name="Loading">True while the primary drive read is in flight (web <c>isLoading</c>).</param>
/// <param name="ErrorDetail">The error message when the primary read failed (web <c>error</c>), else null.</param>
public sealed record TripReplayPageModel(TripReplayPageSnapshot Snapshot, bool Loading, string? ErrorDetail)
{
    /// <summary>The initial model: the drive query is in flight with nothing resolved yet.</summary>
    public static TripReplayPageModel Initial { get; } = new(TripReplayPageSnapshot.Empty, true, null);
}

/// <summary>The four mutually-exclusive top-level data states the page renders (web isLoading / error / no-gps / ready).</summary>
public enum TripReplayPageState
{
    /// <summary>The drive read is in flight with nothing to show — the loading skeleton.</summary>
    Loading,

    /// <summary>Resolved with no GPS positions — the friendly "no GPS data" empty surface.</summary>
    Empty,

    /// <summary>The drive read failed — the retriable error surface.</summary>
    Error,

    /// <summary>A drive with positions resolved — the full replay content.</summary>
    Success,
}

/// <summary>One drive-summary tile (web <c>StatCard</c>): a label, a pre-formatted value, an optional unit and a glyph.</summary>
/// <param name="Label">The localized tile label.</param>
/// <param name="Value">The pre-formatted headline value.</param>
/// <param name="Unit">The optional unit suffix (web <c>StatCard.unit</c>), or null.</param>
/// <param name="Glyph">The Segoe Fluent accent glyph.</param>
public sealed record TripReplaySummaryCard(string Label, string Value, string? Unit, string Glyph);

/// <summary>One current-position metric tile (web <c>MetricCard</c>): a label, an already-unit-suffixed value and a glyph.</summary>
/// <param name="Label">The localized metric label.</param>
/// <param name="Value">The pre-formatted value with its unit inline (web MetricCard value), or an em dash.</param>
/// <param name="Glyph">The Segoe Fluent accent glyph.</param>
/// <param name="AccentBrushKey">The token brush key for the metric accent rail.</param>
public sealed record TripReplayMetric(string Label, string Value, string Glyph, string AccentBrushKey);

/// <summary>
/// The fully-resolved, render-ready projection of <c>TripReplayPage</c> — every always-present web region as pure
/// data so the WinUI view is a thin renderer and the projection is unit-tested without a UI host. The four state
/// flags drive the top-level surfaces; the summary cards, elevation profile points and speed sparkline are the
/// page-owned sections; the per-frame current-stat cards are projected separately by
/// <see cref="TripReplayPageProjection.CurrentStats"/> because they change with the playhead.
/// </summary>
public sealed record TripReplayPageDisplay
{
    /// <summary>The current top-level data state.</summary>
    public required TripReplayPageState State { get; init; }

    /// <summary>The localized page title (web <c>replay.title</c>).</summary>
    public required string Title { get; init; }

    /// <summary>The localized page subtitle (web drive + date + route), or empty when no drive.</summary>
    public required string Subtitle { get; init; }

    /// <summary>The accessible page name for Narrator.</summary>
    public required string AutomationName { get; init; }

    /// <summary>The localized back affordance label (web "Back to Drive").</summary>
    public required string BackLabel { get; init; }

    /// <summary>The localized current-stats section heading (web "Current Position Stats").</summary>
    public required string CurrentStatsTitle { get; init; }

    /// <summary>The localized drive-summary section heading (web "Drive Summary").</summary>
    public required string SummaryTitle { get; init; }

    /// <summary>The localized accessible label for the playback transport section.</summary>
    public required string PlaybackLabel { get; init; }

    /// <summary>The eight drive-summary tiles (web StaggerContainer of StatCards).</summary>
    public required IReadOnlyList<TripReplaySummaryCard> SummaryCards { get; init; }

    /// <summary>The elevation-profile points (X = cumulative distance in display units, Y = elevation in metres).</summary>
    public required IReadOnlyList<ChartPoint> ElevationPoints { get; init; }

    /// <summary>The elevation-profile caption unit (always metres).</summary>
    public required string ElevationUnit { get; init; }

    /// <summary>The down-sampled speed values behind the scrubber (web <c>speedSparkData</c>).</summary>
    public required IReadOnlyList<double> SpeedSparkData { get; init; }

    /// <summary>Hard-error copy.</summary>
    public required string ErrorText { get; init; }

    /// <summary>Retry affordance label.</summary>
    public required string RetryLabel { get; init; }

    /// <summary>The "no GPS data" empty-surface message.</summary>
    public required string EmptyMessage { get; init; }

    /// <summary>Loading Narrator label.</summary>
    public required string LoadingLabel { get; init; }

    /// <summary>True when the loading skeleton is shown.</summary>
    public bool ShowLoading => State == TripReplayPageState.Loading;

    /// <summary>True when the retriable error surface is shown.</summary>
    public bool ShowError => State == TripReplayPageState.Error;

    /// <summary>True when the "no GPS data" empty surface is shown.</summary>
    public bool ShowEmpty => State == TripReplayPageState.Empty;

    /// <summary>True when the six replay sections are shown.</summary>
    public bool ShowContent => State == TripReplayPageState.Success;
}

/// <summary>
/// The fully-resolved set of localized strings the page renders — every i18n key the web <c>TripReplayPage</c>
/// feeds into <c>t(...)</c> (web key names, verbatim) resolved once through the i18n facade so the projection
/// stays readable and the string-coverage test can assert every key in one pass.
/// </summary>
public sealed record TripReplayPageStrings
{
    /// <summary>Web <c>replay.title</c>.</summary>
    public required string Title { get; init; }

    /// <summary>Web <c>replay.drive</c>.</summary>
    public required string Drive { get; init; }

    /// <summary>Web <c>replay.backToDrive</c>.</summary>
    public required string BackToDrive { get; init; }

    /// <summary>Web <c>replay.currentStats</c>.</summary>
    public required string CurrentStats { get; init; }

    /// <summary>Web <c>replay.stat.speed</c>.</summary>
    public required string StatSpeed { get; init; }

    /// <summary>Web <c>replay.stat.power</c>.</summary>
    public required string StatPower { get; init; }

    /// <summary>Web <c>replay.stat.battery</c>.</summary>
    public required string StatBattery { get; init; }

    /// <summary>Web <c>replay.stat.elevation</c>.</summary>
    public required string StatElevation { get; init; }

    /// <summary>Web <c>replay.stat.range</c>.</summary>
    public required string StatRange { get; init; }

    /// <summary>Web <c>replay.stat.temp</c>.</summary>
    public required string StatTemp { get; init; }

    /// <summary>Web <c>replay.summary.title</c>.</summary>
    public required string SummaryTitle { get; init; }

    /// <summary>Web <c>replay.summary.distance</c>.</summary>
    public required string SummaryDistance { get; init; }

    /// <summary>Web <c>replay.summary.duration</c>.</summary>
    public required string SummaryDuration { get; init; }

    /// <summary>Web <c>replay.summary.efficiency</c>.</summary>
    public required string SummaryEfficiency { get; init; }

    /// <summary>Web <c>replay.summary.elevGain</c>.</summary>
    public required string SummaryElevGain { get; init; }

    /// <summary>Web <c>replay.summary.elevLoss</c>.</summary>
    public required string SummaryElevLoss { get; init; }

    /// <summary>Web <c>replay.summary.maxSpeed</c>.</summary>
    public required string SummaryMaxSpeed { get; init; }

    /// <summary>Web <c>replay.summary.avgSpeed</c>.</summary>
    public required string SummaryAvgSpeed { get; init; }

    /// <summary>Web <c>replay.summary.battery</c>.</summary>
    public required string SummaryBattery { get; init; }

    /// <summary>Web <c>replay.playback</c> (accessible transport label).</summary>
    public required string Playback { get; init; }

    /// <summary>Web <c>replay.noGps</c> empty-state message.</summary>
    public required string NoGps { get; init; }

    /// <summary>Web <c>replay.error</c> hard-error copy.</summary>
    public required string Error { get; init; }

    /// <summary>Web <c>replay.retry</c> retry label.</summary>
    public required string Retry { get; init; }

    /// <summary>Web <c>replay.loading</c> Narrator label.</summary>
    public required string Loading { get; init; }

    /// <summary>Resolve every page-level string through the i18n facade (web key names, verbatim).</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static TripReplayPageStrings Resolve(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        return new TripReplayPageStrings
        {
            Title = localizer.GetString("replay.title", "Trip Replay"),
            Drive = localizer.GetString("replay.drive", "Drive"),
            BackToDrive = localizer.GetString("replay.backToDrive", "Back to Drive"),
            CurrentStats = localizer.GetString("replay.currentStats", "Current Position Stats"),
            StatSpeed = localizer.GetString("replay.stat.speed", "Speed"),
            StatPower = localizer.GetString("replay.stat.power", "Power"),
            StatBattery = localizer.GetString("replay.stat.battery", "Battery"),
            StatElevation = localizer.GetString("replay.stat.elevation", "Elevation"),
            StatRange = localizer.GetString("replay.stat.range", "Range"),
            StatTemp = localizer.GetString("replay.stat.temp", "Temperature"),
            SummaryTitle = localizer.GetString("replay.summary.title", "Drive Summary"),
            SummaryDistance = localizer.GetString("replay.summary.distance", "Distance"),
            SummaryDuration = localizer.GetString("replay.summary.duration", "Duration"),
            SummaryEfficiency = localizer.GetString("replay.summary.efficiency", "Efficiency"),
            SummaryElevGain = localizer.GetString("replay.summary.elevGain", "Elevation Gain"),
            SummaryElevLoss = localizer.GetString("replay.summary.elevLoss", "Elevation Loss"),
            SummaryMaxSpeed = localizer.GetString("replay.summary.maxSpeed", "Max Speed"),
            SummaryAvgSpeed = localizer.GetString("replay.summary.avgSpeed", "Avg Speed"),
            SummaryBattery = localizer.GetString("replay.summary.battery", "Battery"),
            Playback = localizer.GetString("replay.playback", "Playback controls"),
            NoGps = localizer.GetString(
                "replay.noGps",
                "No GPS data available for this drive. Trip replay requires valid position coordinates from Fleet Telemetry."),
            Error = localizer.GetString("replay.error", "Failed to load trip replay"),
            Retry = localizer.GetString("replay.retry", "Retry"),
            Loading = localizer.GetString("replay.loading", "Loading trip replay"),
        };
    }
}

/// <summary>
/// Pure projection from a <see cref="TripReplayPageModel"/> to its <see cref="TripReplayPageDisplay"/> — the
/// native port of web/src/features/trips/pages/TripReplayPage.tsx. It selects the four-state matrix, resolves
/// every page-level label through the i18n facade, and assembles the always-present sections (the eight
/// drive-summary tiles, the elevation-profile points and the speed sparkline) with SI values converted to the
/// user's display units only at this boundary. The per-frame current-stat tiles are projected by
/// <see cref="CurrentStats"/>. No WinUI types so the whole contract is unit-tested without a UI host.
/// </summary>
public static class TripReplayPageProjection
{
    private const string Dash = "\u2014";
    private const string Arrow = "\u2192";
    private const string AccentKey = "TsColorAccentBrush";
    private const string EfficiencyUnit = "Wh/km";
    private const string ElevationUnitLabel = "m";
    private const int SparkTargetPoints = 80;

    // Segoe Fluent glyphs for the metric / summary tiles (web lucide icons; visual parity only).
    private const string SpeedGlyph = "\uEC4A";
    private const string PowerGlyph = "\uE945";
    private const string BatteryGlyph = "\uE83F";
    private const string ElevationGlyph = "\uE909";
    private const string RangeGlyph = "\uE81D";
    private const string TempGlyph = "\uE9CA";
    private const string DurationGlyph = "\uE917";
    private const string EfficiencyGlyph = "\uE9D9";
    private const string ElevGainGlyph = "\uE74A";
    private const string ElevLossGlyph = "\uE74B";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the active units + localizer.</summary>
    /// <param name="model">The parsed snapshot plus the page lifecycle flags.</param>
    /// <param name="units">The user's unit-display preference (applied only at this boundary).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="now">Injectable clock for deterministic date formatting in tests.</param>
    public static TripReplayPageDisplay Project(
        TripReplayPageModel model,
        UnitPref units,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);
        _ = now;

        TripReplayPageStrings s = TripReplayPageStrings.Resolve(localizer);
        TripReplayPageSnapshot snapshot = model.Snapshot;
        TripReplayDrive? drive = snapshot.Drive;

        TripReplayPageState state = SelectState(model);

        return new TripReplayPageDisplay
        {
            State = state,
            Title = s.Title,
            Subtitle = BuildSubtitle(drive, s),
            AutomationName = drive is { } d ? $"{s.Title}. {s.Drive} #{d.Id}" : s.Title,
            BackLabel = s.BackToDrive,
            CurrentStatsTitle = s.CurrentStats,
            SummaryTitle = s.SummaryTitle,
            PlaybackLabel = s.Playback,
            SummaryCards = BuildSummary(drive, units, s),
            ElevationPoints = BuildElevation(drive, units),
            ElevationUnit = ElevationUnitLabel,
            SpeedSparkData = BuildSparkData(drive),
            ErrorText = model.ErrorDetail is { Length: > 0 } detail ? detail : s.Error,
            RetryLabel = s.Retry,
            EmptyMessage = s.NoGps,
            LoadingLabel = s.Loading,
        };
    }

    /// <summary>
    /// Project the six current-position metric tiles for the playhead at <paramref name="index"/> — the native
    /// port of the web "Current Position Stats" panel. Each value is converted from SI to the user's display
    /// units at this boundary; a missing metric renders an em dash (never a blank tile).
    /// </summary>
    /// <param name="positions">The merged replay samples.</param>
    /// <param name="index">The playhead sample index.</param>
    /// <param name="units">The user's unit-display preference.</param>
    /// <param name="localizer">The i18n facade.</param>
    public static IReadOnlyList<TripReplayMetric> CurrentStats(
        IReadOnlyList<TripReplayPagePosition> positions,
        int index,
        UnitPref units,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(positions);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        TripReplayPageStrings s = TripReplayPageStrings.Resolve(localizer);
        TripReplayPagePosition? cp = positions.Count > 0
            ? positions[Math.Clamp(index, 0, positions.Count - 1)]
            : null;

        string speedLabel = UnitLabels.Label(units.Speed);
        string distLabel = UnitLabels.Label(units.Distance);
        string tempLabel = UnitLabels.Label(units.Temperature);

        string speed = cp?.SpeedMps is { } mps
            ? $"{ScalarFormatters.FormatNumber(UnitConverters.SpeedFromSi(mps, units.Speed), 1)} {speedLabel}"
            : Dash;
        string power = cp?.PowerKw is { } kw
            ? $"{ScalarFormatters.FormatNumber(kw, 1)} kW"
            : Dash;
        string battery = cp is { } b
            ? $"{ScalarFormatters.FormatNumber(b.BatteryPct, 0)}%"
            : Dash;
        string elevation = cp?.ElevationM is { } elev
            ? $"{ScalarFormatters.FormatNumber(elev, 0)} m"
            : Dash;
        string range = cp?.RatedRangeM is { } rng
            ? $"{ScalarFormatters.FormatNumber(UnitConverters.DistanceFromSi(rng, units.Distance), 1)} {distLabel}"
            : Dash;
        string temp = cp?.OutsideTempC is { } t
            ? $"{ScalarFormatters.FormatNumber(UnitConverters.TemperatureFromSi(t, units.Temperature), 1)} {tempLabel}"
            : Dash;

        return new[]
        {
            new TripReplayMetric(s.StatSpeed, speed, SpeedGlyph, AccentKey),
            new TripReplayMetric(s.StatPower, power, PowerGlyph, AccentKey),
            new TripReplayMetric(s.StatBattery, battery, BatteryGlyph, AccentKey),
            new TripReplayMetric(s.StatElevation, elevation, ElevationGlyph, AccentKey),
            new TripReplayMetric(s.StatRange, range, RangeGlyph, AccentKey),
            new TripReplayMetric(s.StatTemp, temp, TempGlyph, AccentKey),
        };
    }

    private static TripReplayPageState SelectState(TripReplayPageModel model)
    {
        if (model.ErrorDetail is not null)
        {
            return TripReplayPageState.Error;
        }

        if (model.Snapshot.HasPositions)
        {
            return TripReplayPageState.Success;
        }

        // Web parity: positions.length === 0 && !isLoading → EmptyState; while loading with nothing yet → skeleton.
        return model.Loading ? TripReplayPageState.Loading : TripReplayPageState.Empty;
    }

    private static string BuildSubtitle(TripReplayDrive? drive, TripReplayPageStrings s)
    {
        if (drive is not { } d)
        {
            return string.Empty;
        }

        string date = d.StartTs is { } ts
            ? ts.ToLocalTime().ToString("MMM d, yyyy, h:mm tt", CultureInfo.CurrentCulture)
            : string.Empty;
        string head = date.Length > 0
            ? $"{s.Drive} #{d.Id} {Dash} {date}"
            : $"{s.Drive} #{d.Id}";

        if (d.StartAddress is { Length: > 0 } start && d.EndAddress is { Length: > 0 } end)
        {
            return $"{head}  \u00b7  {start} {Arrow} {end}";
        }

        return head;
    }

    private static TripReplaySummaryCard[] BuildSummary(
        TripReplayDrive? drive,
        UnitPref units,
        TripReplayPageStrings s)
    {
        string distLabel = UnitLabels.Label(units.Distance);
        string speedLabel = UnitLabels.Label(units.Speed);

        double distanceUser = drive is { } d ? UnitConverters.DistanceFromSi(d.DistanceM, units.Distance) : 0;
        string distanceValue = drive is null ? Dash : ScalarFormatters.FormatNumber(distanceUser, 1);
        string durationValue = drive is { } dd ? FormatDriveTime(dd.DurationS / 60.0) : Dash;

        double? efficiency = drive is { } e
            && e.DistanceM > 0
            && e.StartSocPct is { } startSoc
            && e.EndSocPct is { } endSoc
            && distanceUser > 0
            ? (startSoc - endSoc) / distanceUser * 1000.0
            : null;

        string maxSpeed = drive?.MaxSpeedMps is { } maxMps
            ? ScalarFormatters.FormatNumber(UnitConverters.SpeedFromSi(maxMps, units.Speed), 1)
            : Dash;
        string avgSpeed = drive?.AvgSpeedMps is { } avgMps
            ? ScalarFormatters.FormatNumber(UnitConverters.SpeedFromSi(avgMps, units.Speed), 1)
            : Dash;

        string battery = drive is { StartSocPct: { } bs, EndSocPct: { } be }
            ? $"{ScalarFormatters.FormatNumber(bs, 0)}% {Arrow} {ScalarFormatters.FormatNumber(be, 0)}%"
            : Dash;

        return new[]
        {
            new TripReplaySummaryCard(s.SummaryDistance, distanceValue, drive is null ? null : distLabel, RangeGlyph),
            new TripReplaySummaryCard(s.SummaryDuration, durationValue, null, DurationGlyph),
            new TripReplaySummaryCard(
                s.SummaryEfficiency,
                efficiency is { } eff ? ScalarFormatters.FormatNumber(eff, 1) : Dash,
                efficiency is null ? null : EfficiencyUnit,
                EfficiencyGlyph),
            new TripReplaySummaryCard(s.SummaryElevGain, Dash, null, ElevGainGlyph),
            new TripReplaySummaryCard(s.SummaryElevLoss, Dash, null, ElevLossGlyph),
            new TripReplaySummaryCard(
                s.SummaryMaxSpeed, maxSpeed, drive?.MaxSpeedMps is null ? null : speedLabel, SpeedGlyph),
            new TripReplaySummaryCard(
                s.SummaryAvgSpeed, avgSpeed, drive?.AvgSpeedMps is null ? null : speedLabel, SpeedGlyph),
            new TripReplaySummaryCard(s.SummaryBattery, battery, null, BatteryGlyph),
        };
    }

    private static IReadOnlyList<ChartPoint> BuildElevation(TripReplayDrive? drive, UnitPref units)
    {
        if (drive is not { Positions.Count: > 0 } d)
        {
            return Array.Empty<ChartPoint>();
        }

        var points = new List<ChartPoint>(d.Positions.Count);
        double cumulativeMeters = 0;
        for (int i = 0; i < d.Positions.Count; i++)
        {
            var p = d.Positions[i];
            if (i > 0)
            {
                var prev = d.Positions[i - 1];
                cumulativeMeters += TripReplayGeo.HaversineMeters(prev.Latitude, prev.Longitude, p.Latitude, p.Longitude);
            }

            double distance = Math.Round(
                UnitConverters.DistanceFromSi(cumulativeMeters, units.Distance), 2, MidpointRounding.AwayFromZero);
            points.Add(new ChartPoint(distance, p.ElevationM ?? 0));
        }

        return points;
    }

    private static double[] BuildSparkData(TripReplayDrive? drive)
    {
        if (drive is not { Positions.Count: > 0 } d)
        {
            return Array.Empty<double>();
        }

        var positions = d.Positions;
        if (positions.Count <= SparkTargetPoints)
        {
            var all = new double[positions.Count];
            for (int i = 0; i < positions.Count; i++)
            {
                all[i] = positions[i].SpeedMps ?? 0;
            }

            return all;
        }

        double stride = positions.Count / (double)SparkTargetPoints;
        var sampled = new double[SparkTargetPoints];
        for (int i = 0; i < SparkTargetPoints; i++)
        {
            int idx = Math.Min(positions.Count - 1, (int)Math.Floor(i * stride));
            sampled[i] = positions[idx].SpeedMps ?? 0;
        }

        return sampled;
    }

    private static string FormatDriveTime(double minutes)
    {
        int hours = (int)Math.Floor(minutes / 60.0);
        int mins = (int)Math.Round(minutes % 60.0, MidpointRounding.AwayFromZero);
        return hours > 0
            ? string.Create(CultureInfo.CurrentCulture, $"{hours}h {mins}m")
            : string.Create(CultureInfo.CurrentCulture, $"{mins}m");
    }
}

/// <summary>
/// Builds the merged, recorded-order replay samples from a drive-detail body — the native port of the web page's
/// position ↔ telemetry join (web/src/features/trips/pages/TripReplayPage.tsx). The <c>positions</c> array carries
/// lat/lon/speed; the parallel <c>telemetry</c> array carries power, battery, elevation, range and temperature, so
/// each position is fused with its nearest-by-timestamp telemetry row (O(log n) binary search over a
/// timestamp-sorted index). Positions at the null island <c>(0, 0)</c> are dropped, exactly as the web filter does.
/// </summary>
public static class TripReplayPositionMerge
{
    /// <summary>Project a drive-detail (or bare positions array) response into the merged replay samples.</summary>
    /// <param name="root">The drive-detail JSON body.</param>
    public static IReadOnlyList<TripReplayPagePosition> Build(JsonElement root)
    {
        JsonElement positions = root.ValueKind == JsonValueKind.Array ? root : ArrayOrDefault(root, "positions");

        if (positions.ValueKind != JsonValueKind.Array || positions.GetArrayLength() == 0)
        {
            return Array.Empty<TripReplayPagePosition>();
        }

        var telemetry = BuildTelemetryIndex(root);

        var samples = new List<TripReplayPagePosition>(positions.GetArrayLength());
        foreach (var raw in positions.EnumerateArray())
        {
            if (raw.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            double lat = TripReplayPageJson.Double(raw, "latitude") ?? 0;
            double lon = TripReplayPageJson.Double(raw, "longitude") ?? 0;
            if (lat == 0 && lon == 0)
            {
                continue; // web parity: filter the null island
            }

            DateTimeOffset? ts = TripReplayPageJson.Date(raw, "timestamp", "created_at", "createdAt");
            JsonElement? tel = NearestTelemetry(telemetry, ts);

            samples.Add(new TripReplayPagePosition(
                Latitude: lat,
                Longitude: lon,
                SpeedMps: TripReplayPageJson.Double(raw, "speed") ?? Pick(tel, "speed"),
                PowerKw: Pick2(raw, tel, "power"),
                BatteryPct: Pick2(raw, tel, "battery_level", "batteryLevel") ?? 0,
                TimestampUtc: ts,
                ElevationM: Pick2(raw, tel, "elevation"),
                OutsideTempC: Pick2(raw, tel, "outside_temp", "outsideTemp"),
                RatedRangeM: Pick2(raw, tel, "rated_range", "ratedRange")));
        }

        return samples;
    }

    private static IReadOnlyList<(long Ts, JsonElement Row)> BuildTelemetryIndex(JsonElement root)
    {
        JsonElement telemetry = ArrayOrDefault(root, "telemetry");
        if (telemetry.ValueKind != JsonValueKind.Array || telemetry.GetArrayLength() == 0)
        {
            return Array.Empty<(long, JsonElement)>();
        }

        var rows = new List<(long Ts, JsonElement Row)>(telemetry.GetArrayLength());
        foreach (var row in telemetry.EnumerateArray())
        {
            if (row.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            DateTimeOffset? ts = TripReplayPageJson.Date(row, "created_at", "createdAt", "timestamp");
            if (ts is { } value)
            {
                rows.Add((value.ToUnixTimeMilliseconds(), row));
            }
        }

        rows.Sort(static (a, b) => a.Ts.CompareTo(b.Ts));
        return rows;
    }

    private static JsonElement? NearestTelemetry(IReadOnlyList<(long Ts, JsonElement Row)> index, DateTimeOffset? ts)
    {
        if (index.Count == 0 || ts is not { } when)
        {
            return null;
        }

        long target = when.ToUnixTimeMilliseconds();
        int lo = 0;
        int hi = index.Count - 1;
        while (lo < hi)
        {
            int mid = (lo + hi) >> 1;
            if (index[mid].Ts < target)
            {
                lo = mid + 1;
            }
            else
            {
                hi = mid;
            }
        }

        if (lo > 0 && Math.Abs(index[lo - 1].Ts - target) < Math.Abs(index[lo].Ts - target))
        {
            return index[lo - 1].Row;
        }

        return index[lo].Row;
    }

    private static double? Pick(JsonElement? telemetry, string name) =>
        telemetry is { } tel ? TripReplayPageJson.Double(tel, name) : null;

    private static double? Pick2(JsonElement pos, JsonElement? telemetry, string camel, string? snake = null)
    {
        double? fromPos = snake is null
            ? TripReplayPageJson.Double(pos, camel)
            : TripReplayPageJson.Double(pos, camel, snake);
        if (fromPos is { } v)
        {
            return v;
        }

        if (telemetry is not { } tel)
        {
            return null;
        }

        return snake is null
            ? TripReplayPageJson.Double(tel, camel)
            : TripReplayPageJson.Double(tel, camel, snake);
    }

    private static JsonElement ArrayOrDefault(JsonElement root, string name) =>
        root.ValueKind == JsonValueKind.Object && root.TryGetProperty(name, out var arr) ? arr : default;
}

/// <summary>
/// Canonical registration metadata for the <c>TripReplayPage</c> surface — the shell route name, the diagnostics
/// slug, the generated-client operation id for the drive read (<c>GET /drives/{driveID}</c>) and the
/// empty-surface glyph.
/// </summary>
public static class TripReplayPageRegistration
{
    /// <summary>The route / page-factory name the shell registers this page under (web route <c>drives/:id/replay</c>).</summary>
    public const string RouteName = "TripReplay";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "TripReplayPage";

    /// <summary>The drive-detail read — web <c>GET /drives/{id}</c> (returns Drive with positions + telemetry).</summary>
    public const string DriveOperation = "get_api_v1_drives_driveID";

    /// <summary>Segoe Fluent glyph for the "no GPS data" empty surface (MapPin).</summary>
    public const string EmptyGlyph = "\uE707";

    /// <summary>Segoe Fluent glyph for the in-content back affordance (ChevronLeft).</summary>
    public const string BackGlyph = "\uE76B";

    /// <summary>The localized page title (web <c>t('replay.title')</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("replay.title", "Trip Replay");
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>TripReplayPage</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a drive id, address, location, speed or VIN
/// — so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class TripReplayPageDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The PII-safe diagnostics sink (null = collect counts only).</param>
    public TripReplayPageDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=TripReplayPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={TripReplayPageRegistration.Slug}");
    }
}

/// <summary>
/// Tolerant <see cref="JsonElement"/> readers for the Trip-Replay page parsers (mirrors the sibling feature json
/// helpers). Every read is null-safe so a partial wire object never throws; numeric-strings are tolerated to match
/// the Go API's mixed scalar encoding, and multiple property names are tried to bridge the snake_case /
/// camelCase shapes the web page reads.
/// </summary>
internal static class TripReplayPageJson
{
    /// <summary>Reads the first present numeric (or numeric-string) property among <paramref name="names"/>.</summary>
    /// <param name="obj">The JSON object.</param>
    /// <param name="names">Candidate property names, in priority order.</param>
    public static double? Double(JsonElement obj, params string[] names)
    {
        if (obj.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        foreach (string name in names)
        {
            if (!obj.TryGetProperty(name, out var v))
            {
                continue;
            }

            double? value = v.ValueKind switch
            {
                JsonValueKind.Number when v.TryGetDouble(out var n) && !double.IsNaN(n) && !double.IsInfinity(n) => n,
                JsonValueKind.String when double.TryParse(
                    v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var n) => n,
                _ => null,
            };

            if (value is { } resolved)
            {
                return resolved;
            }
        }

        return null;
    }

    /// <summary>Reads the first present non-empty string property among <paramref name="names"/>.</summary>
    /// <param name="obj">The JSON object.</param>
    /// <param name="names">Candidate property names, in priority order.</param>
    public static string? String(JsonElement obj, params string[] names)
    {
        if (obj.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        foreach (string name in names)
        {
            if (obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String)
            {
                string? str = v.GetString();
                if (!string.IsNullOrEmpty(str))
                {
                    return str;
                }
            }
        }

        return null;
    }

    /// <summary>Reads the first present ISO-8601 timestamp property among <paramref name="names"/> as UTC.</summary>
    /// <param name="obj">The JSON object.</param>
    /// <param name="names">Candidate property names, in priority order.</param>
    public static DateTimeOffset? Date(JsonElement obj, params string[] names)
    {
        if (obj.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        foreach (string name in names)
        {
            if (obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String
                && DateTimeOffset.TryParse(
                    v.GetString(),
                    CultureInfo.InvariantCulture,
                    DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
                    out var dt))
            {
                return dt;
            }
        }

        return null;
    }
}
