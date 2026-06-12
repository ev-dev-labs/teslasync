using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Driving;

/// <summary>
/// One drive aggregate from <c>GET /drives/{driveID}</c> (web <c>Drive</c> / <c>DriveDetail</c> in
/// web/src/api/types.ts) — the primary read the page is built around. Distance is SI metres, duration SI
/// seconds, speed SI metres-per-second, energy SI watt-hours, power SI watts and temperatures SI Celsius;
/// state-of-charge is a dimensionless percentage. Parsing is null-tolerant so a partial row never throws and the
/// projection applies the same web <c>?? 0</c> / <c>?? '—'</c> defaults. <see cref="TelemetryCount"/> /
/// <see cref="PositionCount"/> mirror the web <c>drive.telemetry</c> / <c>drive.positions</c> array lengths the
/// no-telemetry envelope check reads.
/// </summary>
public sealed record DriveData(
    long Id,
    long VehicleId,
    DateTimeOffset? StartTs,
    DateTimeOffset? EndTs,
    double DurationS,
    double DistanceM,
    string? StartAddress,
    string? EndAddress,
    double? StartLat,
    double? StartLon,
    double? EndLat,
    double? EndLon,
    double? StartSocPct,
    double? EndSocPct,
    double? EnergyUsedWh,
    double? RegenEnergyWh,
    double? AvgSpeedMps,
    double? MaxSpeedMps,
    double? AvgPowerW,
    double? OutsideTempAvgC,
    double? InsideTempAvgC,
    double? Score,
    string? EndedStatus,
    bool Live,
    int TelemetryCount,
    int PositionCount)
{
    /// <summary>Project a <c>GET /drives/{driveID}</c> response into the drive, or null for a non-object body.</summary>
    public static DriveData? FromJson(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new DriveData(
            Id: (long)(DriveDetailJson.Double(root, "id") ?? 0),
            VehicleId: (long)(DriveDetailJson.Double(root, "vehicle_id") ?? 0),
            StartTs: DriveDetailJson.Date(root, "start_ts"),
            EndTs: DriveDetailJson.Date(root, "end_ts"),
            DurationS: DriveDetailJson.Double(root, "duration_s") ?? 0,
            DistanceM: DriveDetailJson.Double(root, "distance_m") ?? 0,
            StartAddress: DriveDetailJson.String(root, "start_address"),
            EndAddress: DriveDetailJson.String(root, "end_address"),
            StartLat: DriveDetailJson.Double(root, "start_lat"),
            StartLon: DriveDetailJson.Double(root, "start_lon"),
            EndLat: DriveDetailJson.Double(root, "end_lat"),
            EndLon: DriveDetailJson.Double(root, "end_lon"),
            StartSocPct: DriveDetailJson.Double(root, "start_soc_pct"),
            EndSocPct: DriveDetailJson.Double(root, "end_soc_pct"),
            EnergyUsedWh: DriveDetailJson.Double(root, "energy_used_wh"),
            RegenEnergyWh: DriveDetailJson.Double(root, "regen_energy_wh"),
            AvgSpeedMps: DriveDetailJson.Double(root, "avg_speed_mps"),
            MaxSpeedMps: DriveDetailJson.Double(root, "max_speed_mps"),
            AvgPowerW: DriveDetailJson.Double(root, "avg_power_w"),
            OutsideTempAvgC: DriveDetailJson.Double(root, "outside_temp_avg_c"),
            InsideTempAvgC: DriveDetailJson.Double(root, "inside_temp_avg_c"),
            Score: DriveDetailJson.Double(root, "score"),
            EndedStatus: DriveDetailJson.String(root, "ended_status"),
            Live: DriveDetailJson.Bool(root, "live") ?? false,
            TelemetryCount: DriveDetailJson.ArrayCount(root, "telemetry"),
            PositionCount: DriveDetailJson.ArrayCount(root, "positions"));
    }
}

/// <summary>The vehicle slice from <c>GET /vehicles/{id}</c> (web <c>useVehicle</c>) — only the display name the header shows.</summary>
public sealed record DriveVehicleData(string? DisplayName)
{
    /// <summary>Project a <c>GET /vehicles/{id}</c> response into the slice, or null for a non-object body.</summary>
    public static DriveVehicleData? FromJson(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new DriveVehicleData(DriveDetailJson.String(root, "display_name"));
    }
}

/// <summary>
/// The two-source drive-detail snapshot the page renders from — the drive aggregate (web <c>useDrive</c>) fused
/// with its owning vehicle's display name (web <c>useVehicle</c>). The page owns the query lifecycle and mounts
/// the presentational sections with this already-resolved snapshot, exactly as the sibling drive-detail surfaces
/// (DriveTimeline / JourneyDetailsPanel / …) expect.
/// </summary>
public sealed record DriveDetailSnapshot(DriveData? Drive, DriveVehicleData? Vehicle)
{
    /// <summary>The empty snapshot — no drive resolved yet (loading / empty seed).</summary>
    public static DriveDetailSnapshot Empty { get; } = new(null, null);

    /// <summary>True once the primary drive read resolved an object.</summary>
    public bool HasDrive => Drive is not null;
}

/// <summary>The render-time model: the parsed snapshot plus the page lifecycle flags (web query <c>isLoading</c> / error).</summary>
public sealed record DriveDetailModel(DriveDetailSnapshot Snapshot, bool Loading, string? ErrorDetail)
{
    /// <summary>The initial model: the primary drive query is in flight with nothing resolved yet.</summary>
    public static DriveDetailModel Initial { get; } = new(DriveDetailSnapshot.Empty, true, null);
}

/// <summary>The four mutually-exclusive top-level data states the page renders (web isLoading / error / no-drive / ready).</summary>
public enum DriveDetailState
{
    /// <summary>The primary drive read is in flight with nothing to show — the loading skeleton.</summary>
    Loading,

    /// <summary>Resolved with no drive — the friendly page-level empty surface.</summary>
    Empty,

    /// <summary>The primary read failed — the retriable error surface.</summary>
    Error,

    /// <summary>A drive resolved — the full detail content.</summary>
    Success,
}

/// <summary>One projected key/value row inside a section card — WinUI-free so the projection stays testable.</summary>
public sealed record DriveKvRow(string Label, string Value);

/// <summary>
/// One projected drive-detail section (one web <c>&lt;SectionErrorBoundary&gt;</c> wrapper). Carries the section
/// id, the localized error-boundary fallback title (web <c>fallbackTitle</c>), an optional section heading, the
/// gating <see cref="Visible"/> flag (web's conditional render), the real data rows drawn from the resolved
/// drive, and the localized empty copy shown when the section has no page-level data (never a blank region).
/// </summary>
public sealed record DriveSectionDisplay(
    string Id,
    string FallbackTitle,
    string? Heading,
    bool Visible,
    IReadOnlyList<DriveKvRow> Rows,
    string? EmptyText,
    string AccessibleName);

/// <summary>
/// The fully-resolved, render-ready projection of <c>DriveDetailPage</c> — every web region as pure data so the
/// WinUI view is a thin renderer and the projection is unit-tested without a UI host. The four-state flags drive
/// the top-level surfaces; the no-telemetry envelope drives the informational banner; and every section carries
/// its own localized fallback title and empty fallback so no region is ever hidden behind missing data.
/// </summary>
public sealed record DriveDetailDisplay
{
    public required DriveDetailState State { get; init; }
    public required string Title { get; init; }
    public required string AutomationName { get; init; }
    public required string VehicleName { get; init; }

    // ── No-telemetry envelope (web AlertBanner) ──
    public required bool HasMeaningfulDriveStats { get; init; }
    public required bool HasEnergy { get; init; }
    public required string NoTelemetryTitle { get; init; }
    public required string NoTelemetryBody { get; init; }

    // ── Sections (19 web SectionErrorBoundary regions) ──
    public required IReadOnlyList<DriveSectionDisplay> Sections { get; init; }

    // ── State surfaces ──
    public required string ErrorText { get; init; }
    public required string RetryLabel { get; init; }
    public required string EmptyMessage { get; init; }

    public bool ShowLoading => State == DriveDetailState.Loading;
    public bool ShowError => State == DriveDetailState.Error;
    public bool ShowEmpty => State == DriveDetailState.Empty;
    public bool ShowContent => State == DriveDetailState.Success;

    /// <summary>True when the no-telemetry informational banner replaces the numeric-summary sections.</summary>
    public bool ShowNoTelemetryBanner => ShowContent && !HasMeaningfulDriveStats;

    /// <summary>The sections whose web visibility gating is satisfied (the ones actually rendered).</summary>
    public IReadOnlyList<DriveSectionDisplay> VisibleSections =>
        Sections.Where(section => section.Visible).ToList();
}

/// <summary>
/// The fully-resolved set of localized strings the page renders — every i18n key the web
/// <c>DriveDetailPage</c> feeds into <c>t(...)</c> at the page level (the 23 manifest keys: title, vehicle, the
/// two no-telemetry strings and the 19 section-boundary fallback titles), resolved once through the i18n facade
/// so the projection stays readable and the string-coverage test can assert every manifest key in one pass.
/// </summary>
public sealed record DriveDetailStrings
{
    public required string Title { get; init; }
    public required string Vehicle { get; init; }
    public required string NoTelemetryTitle { get; init; }
    public required string NoTelemetryBody { get; init; }

    public required string HeaderFailed { get; init; }
    public required string HeroGaugesFailed { get; init; }
    public required string TimelineFailed { get; init; }
    public required string StatCardsFailed { get; init; }
    public required string AiCoachingFailed { get; init; }
    public required string MoreDetailsFailed { get; init; }
    public required string EnergySummaryFailed { get; init; }
    public required string CostSavingsFailed { get; init; }
    public required string RouteMapFailed { get; init; }
    public required string JourneyDetailsFailed { get; init; }
    public required string OverviewChartFailed { get; init; }
    public required string SocChartFailed { get; init; }
    public required string ElevationChartFailed { get; init; }
    public required string TemperatureFailed { get; init; }
    public required string SpeedHistogramFailed { get; init; }
    public required string AiSpeedProfileInsightsFailed { get; init; }
    public required string PowerProfileFailed { get; init; }
    public required string TirePressureFailed { get; init; }
    public required string WhyEndedFailed { get; init; }

    /// <summary>Resolve every page-level string through the i18n facade (web key names, verbatim).</summary>
    public static DriveDetailStrings Resolve(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        return new DriveDetailStrings
        {
            Title = localizer.GetString("driveDetail.title", "Drive Detail"),
            Vehicle = localizer.GetString("driveDetail.vehicle", "Vehicle"),
            NoTelemetryTitle = localizer.GetString("driveDetail.noTelemetryTitle", "No telemetry recorded for this drive"),
            NoTelemetryBody = localizer.GetString(
                "driveDetail.noTelemetryBody",
                "Only the start/end timestamps and battery levels are available. Distance, speed, energy and route data require live telemetry samples — none were captured during this drive."),
            HeaderFailed = localizer.GetString("driveDetail.section.headerFailed", "Drive header failed to load"),
            HeroGaugesFailed = localizer.GetString("driveDetail.section.heroGaugesFailed", "Hero gauges failed to load"),
            TimelineFailed = localizer.GetString("driveDetail.section.timelineFailed", "Drive timeline failed to load"),
            StatCardsFailed = localizer.GetString("driveDetail.section.statCardsFailed", "Drive stats failed to load"),
            AiCoachingFailed = localizer.GetString("driveDetail.section.aiCoachingFailed", "Helix drive coaching failed to load"),
            MoreDetailsFailed = localizer.GetString("driveDetail.section.moreDetailsFailed", "More details failed to load"),
            EnergySummaryFailed = localizer.GetString("driveDetail.section.energySummaryFailed", "Energy summary failed to load"),
            CostSavingsFailed = localizer.GetString("driveDetail.section.costSavingsFailed", "Cost savings panel failed to load"),
            RouteMapFailed = localizer.GetString("driveDetail.section.routeMapFailed", "Route map failed to load"),
            JourneyDetailsFailed = localizer.GetString("driveDetail.section.journeyDetailsFailed", "Journey details failed to load"),
            OverviewChartFailed = localizer.GetString("driveDetail.section.overviewChartFailed", "Drive overview chart failed to load"),
            SocChartFailed = localizer.GetString("driveDetail.section.socChartFailed", "SOC chart failed to load"),
            ElevationChartFailed = localizer.GetString("driveDetail.section.elevationChartFailed", "Elevation chart failed to load"),
            TemperatureFailed = localizer.GetString("driveDetail.section.temperatureFailed", "Temperature section failed to load"),
            SpeedHistogramFailed = localizer.GetString("driveDetail.section.speedHistogramFailed", "Speed histogram failed to load"),
            AiSpeedProfileInsightsFailed = localizer.GetString("driveDetail.section.aiSpeedProfileInsightsFailed", "Helix speed-profile insights failed to load"),
            PowerProfileFailed = localizer.GetString("driveDetail.section.powerProfileFailed", "Power profile chart failed to load"),
            TirePressureFailed = localizer.GetString("driveDetail.section.tirePressureFailed", "Tire pressure section failed to load"),
            WhyEndedFailed = localizer.GetString("driveDetail.section.whyEndedFailed", "Why-ended diagnostic failed to load"),
        };
    }
}

/// <summary>
/// Pure projection from a <see cref="DriveDetailModel"/> to its <see cref="DriveDetailDisplay"/> — the native
/// port of web/src/features/driving/components/drive-detail composed by
/// web/src/features/driving/pages/DriveDetailPage.tsx. It selects the four-state matrix, resolves every
/// page-level label through the i18n facade, reproduces the web no-telemetry envelope check
/// (<c>hasMeaningfulDriveStats</c>), and assembles the nineteen <c>SectionErrorBoundary</c> regions — each with
/// its localized fallback title, its web visibility gating, and a real data summary drawn from the resolved
/// drive (formatted at the SI display boundary via <see cref="UnitConverters"/>) or its own localized empty copy.
/// No WinUI types so the whole contract is unit-tested without a UI host.
/// </summary>
public static class DriveDetailProjection
{
    private const string Dash = "\u2014";
    private const string RouteArrow = "\u2192";
    private const double SecondsPerHour = 3600.0;

    /// <summary>Project <paramref name="model"/> into a render-ready display using the active units + localizer.</summary>
    /// <param name="model">The parsed two-source data plus the page lifecycle flags.</param>
    /// <param name="units">The user's unit-display preference (applied only at this boundary).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="now">Injectable clock for deterministic date formatting in tests.</param>
    public static DriveDetailDisplay Project(
        DriveDetailModel model,
        UnitPref units,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);
        _ = now;

        // Resolve every page-level string unconditionally so the manifest keys are requested in every state.
        DriveDetailStrings s = DriveDetailStrings.Resolve(localizer);
        DriveDetailSnapshot snapshot = model.Snapshot;
        DriveData? drive = snapshot.Drive;

        DriveDetailState state =
            model.Loading && drive is null ? DriveDetailState.Loading
            : model.ErrorDetail is not null ? DriveDetailState.Error
            : drive is null ? DriveDetailState.Empty
            : DriveDetailState.Success;

        string loadFailed = localizer.GetString("error.loadFailed", "Failed to load data");
        string errorText = string.IsNullOrWhiteSpace(model.ErrorDetail)
            ? loadFailed
            : $"{loadFailed}: {model.ErrorDetail}";
        string retryLabel = localizer.GetString("common.retry", "Retry");
        string emptyMessage = localizer.GetString("common.noData", "No data available");

        string vehicleName = string.IsNullOrEmpty(snapshot.Vehicle?.DisplayName)
            ? s.Vehicle
            : snapshot.Vehicle!.DisplayName!;

        double energyWh = EnergyWh(drive);
        bool hasMeaningful = drive is { } d && (
            d.DistanceM > 0
            || (d.MaxSpeedMps ?? 0) > 0
            || energyWh > 0
            || d.TelemetryCount > 0
            || d.PositionCount > 0);
        bool hasEnergy = energyWh > 0;

        List<DriveSectionDisplay> sections = drive is null
            ? new List<DriveSectionDisplay>()
            : BuildSections(drive, s, units, localizer, energyWh, hasMeaningful, hasEnergy, vehicleName);
        string automationName = drive is { } da
            ? $"{s.Title}: {RouteLabel(da, s)}"
            : s.Title;

        return new DriveDetailDisplay
        {
            State = state,
            Title = s.Title,
            AutomationName = automationName,
            VehicleName = vehicleName,
            HasMeaningfulDriveStats = hasMeaningful,
            HasEnergy = hasEnergy,
            NoTelemetryTitle = s.NoTelemetryTitle,
            NoTelemetryBody = s.NoTelemetryBody,
            Sections = sections,
            ErrorText = errorText,
            RetryLabel = retryLabel,
            EmptyMessage = emptyMessage,
        };
    }

    private static List<DriveSectionDisplay> BuildSections(
        DriveData drive,
        DriveDetailStrings s,
        UnitPref units,
        ILocalizer localizer,
        double energyWh,
        bool hasMeaningful,
        bool hasEnergy,
        string vehicleName)
    {
        // Local label resolver — reuses existing catalog keys for section content (not part of the required set).
        string L(string key, string fallback) => localizer.GetString(key, fallback);

        string noData = localizer.GetString("common.noData", "No data available");
        string noChartData = L("driveDetail.noChartData", "No telemetry data available");
        string noRouteData = L("driveDetail.noRouteData", "No route data available for this drive");
        string noTemperatureData = L("driveDetail.noTemperatureData", "No temperature telemetry is available for this drive.");

        string distanceUnit = UnitLabels.Label(units.Distance);
        string speedUnit = UnitLabels.Label(units.Speed);
        string energyUnit = UnitLabels.Label(units.Energy);
        string tempUnit = UnitLabels.Label(units.Temperature);

        string distanceText = Measure(UnitConverters.DistanceFromSi(drive.DistanceM, units.Distance), distanceUnit);
        string maxSpeedText = drive.MaxSpeedMps is { } mx ? Measure(UnitConverters.SpeedFromSi(mx, units.Speed), speedUnit) : Dash;
        string avgSpeedText = drive.AvgSpeedMps is { } av ? Measure(UnitConverters.SpeedFromSi(av, units.Speed), speedUnit) : Dash;
        string durationText = DriveTimelineProjection.FormatDurationFromSeconds(drive.DurationS);
        string energyText = energyWh > 0 ? Measure(UnitConverters.EnergyFromSi(energyWh, units.Energy), energyUnit) : Dash;
        double regenWh = drive.RegenEnergyWh ?? 0;
        string regenText = regenWh > 0 ? Measure(UnitConverters.EnergyFromSi(regenWh, units.Energy), energyUnit) : Dash;
        string avgPowerText = drive.AvgPowerW is { } pw
            ? Measure(UnitConverters.PowerFromSi(pw, PowerUnit.Kw), UnitLabels.Label(PowerUnit.Kw))
            : Dash;
        string startSocText = drive.StartSocPct is { } ss ? Percent(ss) : Dash;
        string endSocText = drive.EndSocPct is { } es ? Percent(es) : Dash;
        string outsideTempText = drive.OutsideTempAvgC is { } ot ? Measure(UnitConverters.TemperatureFromSi(ot, units.Temperature), tempUnit) : Dash;
        string insideTempText = drive.InsideTempAvgC is { } it ? Measure(UnitConverters.TemperatureFromSi(it, units.Temperature), tempUnit) : Dash;

        string startTimeText = drive.StartTs is { } st ? st.ToLocalTime().ToString("g", CultureInfo.CurrentCulture) : Dash;
        string endTimeText = drive.EndTs is { } et ? et.ToLocalTime().ToString("g", CultureInfo.CurrentCulture) : Dash;
        string routeLabel = RouteLabel(drive, s);
        string startAddress = string.IsNullOrEmpty(drive.StartAddress) ? Dash : drive.StartAddress!;
        string endAddress = string.IsNullOrEmpty(drive.EndAddress) ? Dash : drive.EndAddress!;

        string startLabel = L("driveDetail.start", "Start");
        string endLabel = L("driveDetail.end", "End");
        string distanceLabel = L("driveDetail.distance", "Distance");
        string maxSpeedLabel = L("driveDetail.maxSpeed", "Max Speed");
        string avgSpeedLabel = L("driveDetail.avgSpeed", "Avg Speed");
        string speedLabel = L("driveDetail.speed", "Speed");
        string durationLabel = L("driveDetail.duration", "Duration");
        string netEnergyLabel = L("driveDetail.netEnergy", "Net Consumption");
        string powerLabel = L("driveDetail.power", "Power");
        string socLabel = L("driveDetail.soc", "SOC");
        string regenLabel = L("driveDetail.regen", "Regenerated");
        string routeHeading = L("driveDetail.route", "Route");

        bool hasRoute = (drive.StartLat is { } a1 && drive.StartLon is { } a2 && (a1 != 0 || a2 != 0))
            || (drive.EndLat is { } b1 && drive.EndLon is { } b2 && (b1 != 0 || b2 != 0));
        bool hasSamples = drive.TelemetryCount > 0 || drive.PositionCount > 0;
        bool hasSoc = drive.StartSocPct is not null || drive.EndSocPct is not null;
        bool hasTemp = drive.OutsideTempAvgC is not null || drive.InsideTempAvgC is not null;

        var sections = new List<DriveSectionDisplay>
        {
            Section("header", s.HeaderFailed, routeHeading, true, new[]
            {
                new DriveKvRow(routeHeading, routeLabel),
                new DriveKvRow(s.Vehicle, vehicleName),
                new DriveKvRow(startLabel, startTimeText),
            }, null),

            Section("hero-gauges", s.HeroGaugesFailed, null, hasMeaningful, new[]
            {
                new DriveKvRow(distanceLabel, distanceText),
                new DriveKvRow(speedLabel, maxSpeedText),
                new DriveKvRow(durationLabel, durationText),
                new DriveKvRow(netEnergyLabel, energyText),
            }, null),

            Section("timeline", s.TimelineFailed, null, true, new[]
            {
                new DriveKvRow(startLabel, startTimeText),
                new DriveKvRow(durationLabel, durationText),
                new DriveKvRow(endLabel, drive.EndTs is null ? L("driveDetail.inProgress", "In progress") : endTimeText),
            }, null),

            Section("stat-cards", s.StatCardsFailed, null, hasMeaningful, new[]
            {
                new DriveKvRow(distanceLabel, distanceText),
                new DriveKvRow(maxSpeedLabel, maxSpeedText),
                new DriveKvRow(avgSpeedLabel, avgSpeedText),
                new DriveKvRow(netEnergyLabel, energyText),
            }, null),

            Section("ai-coaching", s.AiCoachingFailed, null, true, Array.Empty<DriveKvRow>(), noData),

            Section("more-details", s.MoreDetailsFailed, null, hasMeaningful, new[]
            {
                new DriveKvRow(netEnergyLabel, energyText),
                new DriveKvRow(powerLabel, avgPowerText),
                new DriveKvRow(socLabel, $"{startSocText} {RouteArrow} {endSocText}"),
            }, null),

            Section("energy-summary", s.EnergySummaryFailed, null, hasMeaningful, new[]
            {
                new DriveKvRow(netEnergyLabel, energyText),
                new DriveKvRow(regenLabel, regenText),
            }, null),

            Section("cost-savings", s.CostSavingsFailed, L("driveDetail.tripCost", "Trip Cost"), hasEnergy, new[]
            {
                new DriveKvRow(netEnergyLabel, energyText),
            }, null),

            Section("route-map", s.RouteMapFailed, routeHeading, true,
                hasRoute
                    ? new[]
                    {
                        new DriveKvRow(startLabel, Coords(drive.StartLat, drive.StartLon)),
                        new DriveKvRow(endLabel, Coords(drive.EndLat, drive.EndLon)),
                    }
                    : Array.Empty<DriveKvRow>(),
                hasRoute ? null : noRouteData),

            Section("journey-details", s.JourneyDetailsFailed, routeHeading, true, new[]
            {
                new DriveKvRow(startLabel, startAddress),
                new DriveKvRow(endLabel, endAddress),
                new DriveKvRow(distanceLabel, distanceText),
            }, null),

            Section("overview-chart", s.OverviewChartFailed, null, true,
                hasSamples
                    ? new[]
                    {
                        new DriveKvRow(avgSpeedLabel, avgSpeedText),
                        new DriveKvRow(maxSpeedLabel, maxSpeedText),
                    }
                    : Array.Empty<DriveKvRow>(),
                hasSamples ? null : noChartData),

            Section("soc-chart", s.SocChartFailed, L("driveDetail.socOverTime", "SOC % Over Time"), true,
                hasSoc
                    ? new[] { new DriveKvRow(socLabel, $"{startSocText} {RouteArrow} {endSocText}") }
                    : Array.Empty<DriveKvRow>(),
                hasSoc ? null : noChartData),

            Section("elevation-chart", s.ElevationChartFailed, null, true, Array.Empty<DriveKvRow>(), noChartData),

            Section("temperature", s.TemperatureFailed, L("driveDetail.temperatures", "Temperatures"), true,
                hasTemp
                    ? new[]
                    {
                        new DriveKvRow(L("driveDetail.outside", "Outside"), outsideTempText),
                        new DriveKvRow(L("driveDetail.inside", "Inside"), insideTempText),
                    }
                    : Array.Empty<DriveKvRow>(),
                hasTemp ? null : noTemperatureData),

            Section("speed-histogram", s.SpeedHistogramFailed, L("driveDetail.speedHistogram", "Speed Histogram"), true,
                hasSamples
                    ? new[]
                    {
                        new DriveKvRow(avgSpeedLabel, avgSpeedText),
                        new DriveKvRow(maxSpeedLabel, maxSpeedText),
                    }
                    : Array.Empty<DriveKvRow>(),
                hasSamples ? null : noChartData),

            Section("ai-speed-profile-insights", s.AiSpeedProfileInsightsFailed, null, true, Array.Empty<DriveKvRow>(), noData),

            Section("power-profile", s.PowerProfileFailed, L("driveDetail.powerProfile", "Power Profile"), true,
                drive.AvgPowerW is not null
                    ? new[] { new DriveKvRow(powerLabel, avgPowerText) }
                    : Array.Empty<DriveKvRow>(),
                drive.AvgPowerW is not null ? null : noChartData),

            Section("tire-pressure", s.TirePressureFailed, L("driveDetail.tirePressure", "Tire Pressure During Drive"), true,
                Array.Empty<DriveKvRow>(), noChartData),

            Section("why-ended", s.WhyEndedFailed, null, true,
                string.IsNullOrEmpty(drive.EndedStatus)
                    ? Array.Empty<DriveKvRow>()
                    : new[] { new DriveKvRow(endLabel, drive.EndedStatus!) },
                string.IsNullOrEmpty(drive.EndedStatus) ? noData : null),
        };

        return sections;
    }

    private static DriveSectionDisplay Section(
        string id,
        string fallbackTitle,
        string? heading,
        bool visible,
        DriveKvRow[] rows,
        string? emptyText)
    {
        string accessible = heading ?? (rows.Length > 0 ? rows[0].Label : fallbackTitle);
        return new DriveSectionDisplay(id, fallbackTitle, heading, visible, rows, emptyText, accessible);
    }

    private static string RouteLabel(DriveData drive, DriveDetailStrings s)
    {
        bool hasStart = !string.IsNullOrEmpty(drive.StartAddress);
        bool hasEnd = !string.IsNullOrEmpty(drive.EndAddress);
        if (!hasStart && !hasEnd)
        {
            return s.Title;
        }

        string start = hasStart ? drive.StartAddress! : Dash;
        string end = hasEnd ? drive.EndAddress! : Dash;
        return $"{start} {RouteArrow} {end}";
    }

    private static double EnergyWh(DriveData? drive)
    {
        if (drive is null)
        {
            return 0;
        }

        if (drive.EnergyUsedWh is { } e)
        {
            return e;
        }

        // Web fallback: |avgPowerW| * (durationS / 3600).
        double power = Math.Abs(drive.AvgPowerW ?? 0);
        return power * (drive.DurationS / SecondsPerHour);
    }

    private static string Measure(double value, string unit) =>
        string.Create(CultureInfo.CurrentCulture, $"{Round(value)} {unit}");

    private static string Percent(double value) =>
        string.Create(CultureInfo.CurrentCulture, $"{Round(value)}%");

    private static string Coords(double? lat, double? lon)
    {
        if (lat is not { } la || lon is not { } lo || (la == 0 && lo == 0))
        {
            return Dash;
        }

        return string.Create(CultureInfo.InvariantCulture, $"{la:0.0000}, {lo:0.0000}");
    }

    private static double Round(double value)
    {
        double rounded = Math.Round(value, 1, MidpointRounding.AwayFromZero);
        return rounded == 0 ? 0 : rounded; // collapse negative-zero
    }
}

/// <summary>
/// Canonical registration metadata for the <c>DriveDetailPage</c> surface — the shell route name, the
/// diagnostics slug, the generated-client operation ids for the two reads the web page performs
/// (<c>GET /drives/{driveID}</c> + <c>GET /vehicles/{vehicleID}</c>) and the empty-surface glyph.
/// </summary>
public static class DriveDetailPageRegistration
{
    /// <summary>The route / page-factory name the shell registers this page under.</summary>
    public const string RouteName = "DriveDetail";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "DriveDetailPage";

    /// <summary>The drive-detail read — web <c>GET /drives/{id}</c> (returns Drive).</summary>
    public const string DriveOperation = "get_api_v1_drives_driveID";

    /// <summary>The vehicle read — web <c>GET /vehicles/{id}</c>.</summary>
    public const string VehicleOperation = "get_api_v1_vehicles_vehicleID";

    /// <summary>Segoe Fluent glyph for the page-level empty surface (Car).</summary>
    public const string EmptyGlyph = "\uE804";

    /// <summary>The localized page title (web <c>t('driveDetail.title')</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("driveDetail.title", "Drive Detail");
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>DriveDetailPage</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a drive id, address, location or VIN — so a
/// diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class DriveDetailPageDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public DriveDetailPageDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=DriveDetailPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={DriveDetailPageRegistration.Slug}");
    }
}

/// <summary>
/// Tolerant <see cref="JsonElement"/> readers for the drive-detail parsers (mirrors the sibling feature json
/// helpers). Every read is null-safe so a partial wire object never throws; numeric-strings are tolerated to
/// match the Go API's mixed scalar encoding.
/// </summary>
internal static class DriveDetailJson
{
    /// <summary>Reads a numeric (or numeric-string) property, or null when absent / non-numeric / non-finite.</summary>
    public static double? Double(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var v))
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

    /// <summary>Reads a non-empty string property, or null when absent / non-string / blank.</summary>
    public static string? String(JsonElement obj, string name)
    {
        if (obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String)
        {
            string? str = v.GetString();
            return string.IsNullOrEmpty(str) ? null : str;
        }

        return null;
    }

    /// <summary>Reads a boolean property (tolerating <c>true</c>/<c>false</c> tokens), or null when absent.</summary>
    public static bool? Bool(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => null,
        };
    }

    /// <summary>Reads an ISO-8601 timestamp property as a UTC <see cref="DateTimeOffset"/>, or null when unparseable.</summary>
    public static DateTimeOffset? Date(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.String)
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

    /// <summary>Reads the element count of an array property (web <c>arr.length</c>), or 0 when absent / non-array.</summary>
    public static int ArrayCount(JsonElement obj, string name)
    {
        if (obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(name, out var arr) && arr.ValueKind == JsonValueKind.Array)
        {
            return arr.GetArrayLength();
        }

        return 0;
    }
}
