using System.Globalization;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Driving;

/// <summary>
/// Pure projection from a <see cref="DrivingDynamicsModel"/> to its <see cref="DrivingDynamicsDisplay"/> — the
/// native port of the render logic in web/src/features/driving/pages/DrivingDynamicsPage.tsx and every one of its
/// eleven children (LiveMotorStatus, GForcePanel, PedalUsage, SpeedGearPanel, AutopilotSection,
/// MotorHistoryCharts, MotorEfficiencyInsights, SummaryStats, DrivingCoachSection, DriveAnalyticsSection,
/// DrivingTips) plus the shared <c>computeMotorStats</c> / <c>getThrottleStyle</c> helpers. The page-level branch
/// precedence mirrors the web data lifecycle (loading → error → success); each section then renders its own
/// empty state. Every label resolves through the i18n facade using the same keys the web page uses and every SI
/// value is converted at this display boundary. Pure data — no WinUI types — so the projection is unit-tested.
/// </summary>
public static class DrivingDynamicsProjection
{
    /// <summary>Segoe Fluent — Setting (gear), web lucide <c>Cog</c>.</summary>
    public const string CogGlyph = "\uE713";

    /// <summary>Segoe Fluent — Speed, web lucide <c>Gauge</c>.</summary>
    public const string GaugeGlyph = "\uE9D9";

    /// <summary>Segoe Fluent — LightningBolt, web lucide <c>Zap</c>.</summary>
    public const string ZapGlyph = "\uE945";

    /// <summary>Segoe Fluent — Thermometer, web lucide <c>Thermometer</c>.</summary>
    public const string ThermometerGlyph = "\uE9CA";

    /// <summary>Segoe Fluent — activity / pulse, web lucide <c>Activity</c> / <c>BarChart3</c>.</summary>
    public const string ActivityGlyph = "\uE9D2";

    /// <summary>Segoe Fluent — Calendar, web lucide <c>Calendar</c>.</summary>
    public const string CalendarGlyph = "\uE787";

    /// <summary>Segoe Fluent — Street-side / Go, web lucide <c>Navigation</c>.</summary>
    public const string NavigationGlyph = "\uE8AD";

    /// <summary>Segoe Fluent — TrendingDown surrogate (down arrow), web lucide <c>TrendingDown</c>.</summary>
    public const string TrendingDownGlyph = "\uE74B";

    /// <summary>Segoe Fluent — corner / share, web lucide <c>CornerDownRight</c>.</summary>
    public const string CornerGlyph = "\uE72A";

    /// <summary>The empty-section glyph used by the page-level empty surfaces.</summary>
    public const string EmptyGlyph = ActivityGlyph;

    private const string SuccessBrush = "TsColorSuccessBrush";
    private const string WarningBrush = "TsColorWarningBrush";
    private const string DangerBrush = "TsColorDangerBrush";
    private const string AccentBrush = "TsColorAccentBrush";
    private const string EmDash = "\u2014";

    // The five web speed buckets (helpers.ts SPEED_BUCKETS_RANGES) in SI m/s, with their display label.
    private static readonly (double Min, double Max, string Label)[] SpeedBuckets =
    [
        (0, 30, "0\u201330"),
        (30, 60, "30\u201360"),
        (60, 90, "60\u201390"),
        (90, 120, "90\u2013120"),
        (120, double.PositiveInfinity, "120+"),
    ];

    /// <summary>Project <paramref name="model"/> into a render-ready display using the active units + localizer.</summary>
    /// <param name="model">The parsed seven-source data plus the page lifecycle flags and date range.</param>
    /// <param name="units">The user's unit-display preference (applied only at this boundary).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="now">Injectable clock for deterministic date formatting in tests.</param>
    public static DrivingDynamicsDisplay Project(
        DrivingDynamicsModel model,
        UnitPref units,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        var snapshot = model.Snapshot;

        DrivingDynamicsState state =
            model.Loading && !snapshot.Loaded ? DrivingDynamicsState.Loading
            : model.ErrorDetail is not null ? DrivingDynamicsState.Error
            : DrivingDynamicsState.Success;

        string title = localizer.GetString("dynamics.title", "Driving Dynamics");
        string subtitle = localizer.GetString("dynamics.subtitle", "Live motor telemetry, G-forces & driving analysis");
        string errorTitle = localizer.GetString("dynamics.error", "Unable to load driving dynamics");
        string errorText = string.IsNullOrWhiteSpace(model.ErrorDetail)
            ? errorTitle
            : $"{errorTitle}: {model.ErrorDetail}";

        var filteredDrives = FilterDrives(snapshot.Drives, model.Range);
        var stats = MotorStats.Compute(snapshot.MotorHistory);

        return new DrivingDynamicsDisplay(
            State: state,
            Title: title,
            Subtitle: subtitle,
            ShowLoading: state == DrivingDynamicsState.Loading,
            ShowError: state == DrivingDynamicsState.Error,
            ShowContent: state == DrivingDynamicsState.Success,
            ErrorText: errorText,
            RetryLabel: localizer.GetString("common.retry", "Retry"),
            LoadingLabel: localizer.GetString("common.loading", "Loading..."),
            LiveMotor: BuildLiveMotor(snapshot.MotorLatest, units, localizer),
            GForce: BuildGForce(snapshot.DriveDynamics, localizer),
            Pedal: BuildPedal(snapshot.DriveDynamics, localizer),
            SpeedGear: BuildSpeedGear(snapshot.MotorLatest, filteredDrives, units, localizer),
            Autopilot: BuildAutopilot(snapshot.Autopilot, units, localizer),
            MotorCharts: BuildMotorCharts(snapshot.MotorHistory, localizer),
            Efficiency: BuildEfficiency(stats, units, localizer),
            Summary: BuildSummary(stats, units, localizer),
            Coach: BuildCoach(snapshot.Coach, localizer),
            Analytics: BuildAnalytics(filteredDrives, model.Range, units, localizer),
            Tips: BuildTips(stats, localizer),
            AutomationName: $"{title}. {subtitle}");
    }

    /// <summary>Filter the drive list to the inclusive page-scoped day range (web <c>filteredDrives</c>).</summary>
    public static IReadOnlyList<DriveRow> FilterDrives(IReadOnlyList<DriveRow> drives, DateRange range)
    {
        if (drives.Count == 0)
        {
            return drives;
        }

        string start = range.Start.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        string end = range.End.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

        var filtered = new List<DriveRow>(drives.Count);
        foreach (var d in drives)
        {
            string day = d.StartDay;
            if (string.CompareOrdinal(day, start) >= 0 && string.CompareOrdinal(day, end) <= 0)
            {
                filtered.Add(d);
            }
        }

        return filtered;
    }

    // ── 1. Live Motor Status ─────────────────────────────────────────────────────────────────────────────
    private static LiveMotorDisplay BuildLiveMotor(MotorReading? motor, UnitPref units, ILocalizer l)
    {
        string title = l.GetString("dynamics.liveMotor", "Live Motor Status");
        string tempUnit = UnitLabels.Label(units.Temperature);

        if (motor is null)
        {
            return new LiveMotorDisplay(
                title,
                false,
                l.GetString("dynamics.noLiveMotor", "Awaiting live motor data"),
                System.Array.Empty<DynGauge>(),
                EmDash,
                StatusKind.Neutral,
                l.GetString("dynamics.shiftState", "Shift State"));
        }

        double torque = motor.TorqueTotal;
        double rpm = motor.RpmFront ?? 0;
        double? tempC = motor.MotorTempC is { } t && !double.IsInfinity(t) ? t : null;
        double tempDisplay = tempC is { } c ? UnitConverters.TemperatureFromSi(c, units.Temperature) : 0;
        string tempCaption = tempC is { } cc
            ? UnitFormatters.FormatTemperature(cc, units, 1)
            : l.GetString("dynamics.awaiting", "Awaiting data");

        var gauges = new List<DynGauge>
        {
            new(torque, 1000, l.GetString("dynamics.torque", "Torque"), "Nm",
                $"{ScalarFormatters.FormatNumber(torque, 0)} Nm", ChartRole.Power, 0,
                $"{l.GetString("dynamics.torque", "Torque")}: {ScalarFormatters.FormatNumber(torque, 0)} Nm"),
            new(rpm, 18000, l.GetString("dynamics.rpmFront", "Front RPM"), "RPM",
                $"{ScalarFormatters.FormatNumber(rpm, 0)} RPM", ChartRole.Speed, 0,
                $"{l.GetString("dynamics.rpmFront", "Front RPM")}: {ScalarFormatters.FormatNumber(rpm, 0)} RPM"),
            new(tempDisplay, 200, l.GetString("dynamics.motorTemp", "Motor"), tempUnit,
                tempCaption, ChartRole.Temperature, 1,
                $"{l.GetString("dynamics.motorTemp", "Motor")}: {tempCaption}"),
        };

        string shift = string.IsNullOrEmpty(motor.ShiftState)
            ? l.GetString("dynamics.unknown", "Unknown")
            : motor.ShiftState!;

        return new LiveMotorDisplay(
            title,
            true,
            l.GetString("dynamics.noLiveMotor", "Awaiting live motor data"),
            gauges,
            shift,
            motor.ShiftState == "D" ? StatusKind.Success : StatusKind.Neutral,
            l.GetString("dynamics.shiftState", "Shift State"));
    }

    // ── 2. G-Force ───────────────────────────────────────────────────────────────────────────────────────
    private static GForceDisplay BuildGForce(DriveDynamicsReading dyn, ILocalizer l)
    {
        string title = l.GetString("dynamics.gForce", "Acceleration G-Force");
        string g = "g";

        var cards = new List<DynStatCard>
        {
            GCard(l.GetString("dynamics.lateral", "Lateral"), dyn.LateralAcceleration, g),
            GCard(l.GetString("dynamics.longitudinal", "Longitudinal"), dyn.LongitudinalAcceleration, g),
            GCard(l.GetString("dynamics.combined", "Combined"), dyn.CombinedG, g),
        };

        return new GForceDisplay(
            title,
            dyn.HasGForce,
            l.GetString("dynamics.gForceNoData", "No G-force telemetry received yet"),
            cards);
    }

    private static DynStatCard GCard(string label, double? value, string unit)
    {
        string text = value is { } v ? $"{ScalarFormatters.FormatNumber(v, 2)} {unit}" : EmDash;
        return new DynStatCard(GaugeGlyph, label, text, $"{label}: {text}");
    }

    // ── 3. Pedal Usage ───────────────────────────────────────────────────────────────────────────────────
    private static PedalDisplay BuildPedal(DriveDynamicsReading dyn, ILocalizer l)
    {
        string title = l.GetString("dynamics.pedalUsage", "Pedal Usage");
        bool brakeActive = dyn.BrakePedalActive == true;

        var throttle = new DynGauge(
            dyn.PedalPosition ?? 0, 100, l.GetString("dynamics.throttle", "Throttle"),
            dyn.PedalPosition is not null ? "%" : EmDash,
            l.GetString("dynamics.throttlePosition", "Throttle Position"), ChartRole.Energy, 0,
            $"{l.GetString("dynamics.throttle", "Throttle")}: {(dyn.PedalPosition is { } p ? ScalarFormatters.FormatNumber(p, 0) + "%" : EmDash)}");

        var brake = new DynGauge(
            dyn.BrakePedalPosition ?? 0, 100, l.GetString("dynamics.brake", "Brake"),
            dyn.BrakePedalPosition is not null ? "%" : EmDash,
            l.GetString("dynamics.brakePedalPosition", "Brake Pedal Position"), ChartRole.Regen, 0,
            $"{l.GetString("dynamics.brake", "Brake")}: {(dyn.BrakePedalPosition is { } b ? ScalarFormatters.FormatNumber(b, 0) + "%" : EmDash)}");

        return new PedalDisplay(
            title,
            dyn.HasPedal,
            l.GetString("dynamics.pedalNoData", "No pedal telemetry received yet"),
            throttle,
            brake,
            brakeActive ? l.GetString("dynamics.brakeActive", "Brake Active") : l.GetString("dynamics.brakeInactive", "Brake Inactive"),
            brakeActive ? StatusKind.Danger : StatusKind.Success,
            l.GetString("dynamics.brakePedal", "Brake Pedal Status"));
    }

    // ── 4. Speed & Gear ──────────────────────────────────────────────────────────────────────────────────
    private static SpeedGearDisplay BuildSpeedGear(
        MotorReading? motor, IReadOnlyList<DriveRow> drives, UnitPref units, ILocalizer l)
    {
        double? avgMps = null;
        double? topMps = null;
        if (drives.Count > 0)
        {
            avgMps = drives.Sum(d => d.AvgSpeedMps ?? 0) / drives.Count;
            topMps = drives.Max(d => d.MaxSpeedMps ?? 0);
        }

        string speedUnit = UnitLabels.Label(units.Speed);
        string power = motor?.PowerKw is { } kw ? ScalarFormatters.FormatNumber(kw, 1) : EmDash;
        string avgSpeed = avgMps is { } a ? ScalarFormatters.FormatNumber(UnitConverters.SpeedFromSi(a, units.Speed), 0) : EmDash;
        string topSpeed = topMps is { } tp ? ScalarFormatters.FormatNumber(UnitConverters.SpeedFromSi(tp, units.Speed), 0) : EmDash;
        string shift = string.IsNullOrEmpty(motor?.ShiftState) ? EmDash : motor!.ShiftState!;

        return new SpeedGearDisplay(
            l.GetString("dynamics.speedGear", "Speed & Gear"),
            shift,
            ShiftStatus(motor?.ShiftState),
            l.GetString("dynamics.shiftState", "Shift State"),
            l.GetString("dynamics.power", "Motor Power"),
            power,
            l.GetString("dynamics.avgDriveSpeed", "Avg Drive Speed"),
            avgSpeed,
            l.GetString("dynamics.topDriveSpeed", "Top Drive Speed"),
            topSpeed,
            "kW",
            speedUnit);
    }

    // ── 5. Autopilot & Cruise ────────────────────────────────────────────────────────────────────────────
    private static AutopilotDisplay BuildAutopilot(AutopilotReading auto, UnitPref units, ILocalizer l)
    {
        string speedUnit = UnitLabels.Label(units.Speed);
        string Speed(double? mps) => mps is { } v
            ? $"{ScalarFormatters.FormatNumber(UnitConverters.SpeedFromSi(v, units.Speed), 0)} {speedUnit}"
            : EmDash;

        var cards = new List<DynStatCard>
        {
            new(GaugeGlyph, l.GetString("dynamics.currentSpeed", "Current Speed"), Speed(auto.SpeedMps),
                $"{l.GetString("dynamics.currentSpeed", "Current Speed")}: {Speed(auto.SpeedMps)}"),
            new(NavigationGlyph, l.GetString("dynamics.cruiseSetSpeed", "Cruise Set Speed"), Speed(auto.CruiseSetMps),
                $"{l.GetString("dynamics.cruiseSetSpeed", "Cruise Set Speed")}: {Speed(auto.CruiseSetMps)}"),
            new(NavigationGlyph, l.GetString("dynamics.followDistance", "Follow Distance"), auto.FollowDistance ?? EmDash,
                $"{l.GetString("dynamics.followDistance", "Follow Distance")}: {auto.FollowDistance ?? EmDash}"),
        };

        return new AutopilotDisplay(
            l.GetString("dynamics.autopilot", "Autopilot & Cruise"),
            auto.HasAny,
            l.GetString("dynamics.autopilotNoData", "No cruise / autopilot telemetry received yet"),
            cards);
    }

    // ── 6. Motor History charts ──────────────────────────────────────────────────────────────────────────
    private static MotorChartsDisplay BuildMotorCharts(IReadOnlyList<MotorReading> history, ILocalizer l)
    {
        string empty = l.GetString("dynamics.awaitingData", "Awaiting motor telemetry data...");

        var powerPts = new List<ChartPoint>();
        var regenPts = new List<ChartPoint>();
        var torqueFront = new List<ChartPoint>();
        var torqueRear = new List<ChartPoint>();
        var rpmFront = new List<ChartPoint>();
        var rpmRear = new List<ChartPoint>();

        for (int i = 0; i < history.Count; i++)
        {
            var s = history[i];
            string time = s.Ts?.ToString("HH:mm:ss", CultureInfo.InvariantCulture) ?? i.ToString(CultureInfo.InvariantCulture);
            powerPts.Add(new ChartPoint(i, s.PowerKw ?? 0, time));
            regenPts.Add(new ChartPoint(i, s.RegenKw ?? 0, time));
            torqueFront.Add(new ChartPoint(i, s.TorqueFront ?? 0, time));
            torqueRear.Add(new ChartPoint(i, s.TorqueRear ?? 0, time));
            rpmFront.Add(new ChartPoint(i, s.RpmFront ?? 0, time));
            rpmRear.Add(new ChartPoint(i, s.RpmRear ?? 0, time));
        }

        bool has = history.Count > 0;

        var power = new DynChartCard(
            l.GetString("dynamics.powerOverTime", "Motor Power Over Time"),
            l.GetString("dynamics.powerOverTimeDesc", "Drive and regen power from motor telemetry"),
            l.GetString("dynamics.powerOverTime.aria", "Motor power and regen over time area chart"),
            empty, has, l.GetString("dynamics.power", "Power"),
            [
                new DynSeries(l.GetString("dynamics.power", "Power"), ChartSeriesKind.Area, ChartRole.Power, 0, "kW", powerPts),
                new DynSeries(l.GetString("dynamics.regen", "Regen"), ChartSeriesKind.Area, ChartRole.Regen, 1, "kW", regenPts),
            ],
            System.Array.Empty<ChartAnnotation>());

        var torque = new DynChartCard(
            l.GetString("dynamics.torqueHistory", "Motor Torque History"),
            l.GetString("dynamics.torqueHistoryDesc", "Front and rear motor torque over time"),
            l.GetString("dynamics.torqueHistory.aria", "Front and rear motor torque over time line chart"),
            empty, has, l.GetString("dynamics.torque", "Torque"),
            [
                new DynSeries(l.GetString("dynamics.torqueFront", "Front Torque"), ChartSeriesKind.Line, ChartRole.None, 0, "Nm", torqueFront),
                new DynSeries(l.GetString("dynamics.torqueRear", "Rear Torque"), ChartSeriesKind.Line, ChartRole.None, 4, "Nm", torqueRear),
            ],
            System.Array.Empty<ChartAnnotation>());

        var rpm = new DynChartCard(
            l.GetString("dynamics.rpmHistory", "Motor RPM History"),
            l.GetString("dynamics.rpmHistoryDesc", "Front and rear motor RPM over time"),
            l.GetString("dynamics.rpmHistory.aria", "Front and rear motor RPM over time line chart"),
            empty, has, "RPM",
            [
                new DynSeries(l.GetString("dynamics.rpmFront", "Front RPM"), ChartSeriesKind.Line, ChartRole.Speed, 0, "RPM", rpmFront),
                new DynSeries(l.GetString("dynamics.rpmRear", "Rear RPM"), ChartSeriesKind.Line, ChartRole.None, 4, "RPM", rpmRear),
            ],
            System.Array.Empty<ChartAnnotation>());

        return new MotorChartsDisplay(power, torque, rpm);
    }

    // ── 7. Motor Efficiency Insights ─────────────────────────────────────────────────────────────────────
    private static EfficiencyInsightsDisplay BuildEfficiency(MotorStats? stats, UnitPref units, ILocalizer l)
    {
        string empty = l.GetString("dynamics.noMotorData", "No motor data recorded yet");
        string torqueTitle = l.GetString("dynamics.torqueDistribution", "Torque Distribution");
        string throttleTitle = l.GetString("dynamics.throttleBehavior", "Throttle Behavior");
        string thermalTitle = l.GetString("dynamics.motorThermal", "Motor Thermal");

        if (stats is null)
        {
            return new EfficiencyInsightsDisplay(
                false, empty, torqueTitle, System.Array.Empty<DynKeyValue>(), throttleTitle,
                l.GetString("dynamics.avgPower", "Avg Power"), EmDash,
                l.GetString("dynamics.drivingStyle", "Style"), EmDash, StatusKind.Neutral, 0, 200, AccentBrush,
                thermalTitle, System.Array.Empty<DynKeyValue>(), EmDash, StatusKind.Neutral);
        }

        var torqueRows = new List<DynKeyValue>
        {
            new(l.GetString("dynamics.avgTorque", "Avg Torque"), $"{ScalarFormatters.FormatNumber(stats.AvgTorque, 1)} Nm"),
            new(l.GetString("dynamics.maxTorque", "Max Torque"), $"{ScalarFormatters.FormatNumber(stats.MaxTorque, 1)} Nm"),
            new(l.GetString("dynamics.highTorqueTime", "High Torque Time"), ScalarFormatters.FormatPercentage(stats.HighTorquePct, 1)),
        };

        var thermalRows = new List<DynKeyValue>
        {
            new(l.GetString("dynamics.avgMotorTemp", "Avg Motor Temp"), UnitFormatters.FormatTemperature(stats.AvgMotorTemp, units, 1)),
            new(l.GetString("dynamics.maxMotorTemp", "Max Motor Temp"), UnitFormatters.FormatTemperature(stats.MaxMotorTemp, units, 1)),
        };

        var (styleText, styleStatus, styleAccent) = stats.Style switch
        {
            ThrottleStyle.Conservative => (l.GetString("dynamics.conservative", "Conservative"), StatusKind.Success, SuccessBrush),
            ThrottleStyle.Moderate => (l.GetString("dynamics.moderate", "Moderate"), StatusKind.Warning, WarningBrush),
            _ => (l.GetString("dynamics.aggressive", "Aggressive"), StatusKind.Danger, DangerBrush),
        };

        var (thermalText, thermalStatus) = stats.MaxMotorTemp < 100
            ? (l.GetString("dynamics.thermalGood", "Thermal: Good"), StatusKind.Success)
            : stats.MaxMotorTemp < 140
                ? (l.GetString("dynamics.thermalWarm", "Thermal: Warm"), StatusKind.Warning)
                : (l.GetString("dynamics.thermalHot", "Thermal: Hot"), StatusKind.Danger);

        return new EfficiencyInsightsDisplay(
            true, empty, torqueTitle, torqueRows, throttleTitle,
            l.GetString("dynamics.avgPower", "Avg Power"), $"{ScalarFormatters.FormatNumber(stats.AvgPower, 1)} kW",
            l.GetString("dynamics.drivingStyle", "Style"), styleText, styleStatus, stats.AvgPower, 200, styleAccent,
            thermalTitle, thermalRows, thermalText, thermalStatus);
    }

    // ── 8. Summary Stats ─────────────────────────────────────────────────────────────────────────────────
    private static SummaryStatsDisplay BuildSummary(MotorStats? stats, UnitPref units, ILocalizer l)
    {
        string Temp() => stats is { } s ? UnitFormatters.FormatTemperature(s.AvgMotorTemp, units, 1) : EmDash;

        var cards = new List<DynStatCard>
        {
            Card(ActivityGlyph, l.GetString("dynamics.totalReadings", "Total Readings"), ScalarFormatters.FormatNumber(stats?.TotalReadings ?? 0, 0)),
            Card(ZapGlyph, l.GetString("dynamics.avgTorque", "Avg Torque"), $"{ScalarFormatters.FormatNumber(stats?.AvgTorque ?? 0, 1)} Nm"),
            Card(CornerGlyph, l.GetString("dynamics.peakPower", "Peak Power"), $"{ScalarFormatters.FormatNumber(stats?.PeakPower ?? 0, 1)} kW"),
            Card(TrendingDownGlyph, l.GetString("dynamics.peakRegen", "Peak Regen"), $"{ScalarFormatters.FormatNumber(stats?.PeakRegen ?? 0, 1)} kW"),
            Card(GaugeGlyph, l.GetString("dynamics.avgPower", "Avg Power"), $"{ScalarFormatters.FormatNumber(stats?.AvgPower ?? 0, 1)} kW"),
            Card(ThermometerGlyph, l.GetString("dynamics.avgMotorTemp", "Avg Motor Temp"), Temp()),
        };

        return new SummaryStatsDisplay(cards);
    }

    // ── 9. Driving Coach ─────────────────────────────────────────────────────────────────────────────────
    private static CoachDisplay BuildCoach(CoachData? coach, ILocalizer l)
    {
        double score = coach?.OverallScore ?? 0;
        int total = coach?.TotalDrivesAnalyzed ?? 0;

        var (segments, rows) = BuildStyleBreakdown(coach, l);
        var weekly = BuildWeeklySeries(coach, l);
        var patterns = BuildPatterns(coach, l);
        var (recsHas, recs) = BuildRecommendations(coach, l);
        var (perHas, perRows) = BuildPerDrive(coach);

        return new CoachDisplay(
            l.GetString("dynamics.coach.title", "Driving Coach"),
            score,
            ScoreStatus(score),
            l.GetString("dynamics.coach.overallScore", "Driving Score"),
            string.Format(CultureInfo.CurrentCulture, l.GetString("dynamics.coach.drivesAnalyzed", "{0} drives analyzed"), total),
            l.GetString("dynamics.coach.styleBreakdown", "Style Breakdown"),
            coach is { } c && c.TotalDrivesAnalyzed > 0,
            l.GetString("dynamics.coach.noData", "Drive more to see your style breakdown."),
            segments,
            rows,
            l.GetString("dynamics.coach.avgEfficiency", "Avg Efficiency"),
            $"{ScalarFormatters.FormatNumber(coach?.EfficiencyWhKm ?? 0, 0)} Wh/km",
            l.GetString("dynamics.coach.bestEfficiency", "Best Efficiency"),
            $"{ScalarFormatters.FormatNumber(coach?.BestEfficiencyWhKm ?? 0, 0)} Wh/km",
            l.GetString("dynamics.coach.weeklyTrend", "Weekly Score Trend"),
            (coach?.WeeklyTrend.Count ?? 0) > 1,
            l.GetString("dynamics.coach.needWeeks", "Need at least 2 weeks of data for trend analysis."),
            weekly,
            l.GetString("dynamics.coach.patterns", "Driving Patterns"),
            patterns,
            l.GetString("dynamics.coach.recommendations", "Recommendations"),
            recsHas,
            l.GetString("dynamics.coach.noRecs", "Recommendations will appear after more drives."),
            recs,
            l.GetString("dynamics.coach.perDriveScores", "Per-Drive Scores"),
            perHas,
            l.GetString("dynamics.coach.noDrives", "Drive data will appear after your first trip."),
            [
                l.GetString("dynamics.coach.col.date", "Date"),
                l.GetString("dynamics.coach.col.score", "Score"),
                l.GetString("dynamics.coach.col.style", "Style"),
                l.GetString("dynamics.coach.col.efficiency", "Wh/km"),
                l.GetString("dynamics.coach.col.distance", "Distance"),
            ],
            perRows);
    }

    private static (IReadOnlyList<CoachStyleSegment>, IReadOnlyList<CoachStyleRow>) BuildStyleBreakdown(CoachData? coach, ILocalizer l)
    {
        if (coach is not { } c || c.TotalDrivesAnalyzed <= 0)
        {
            return (System.Array.Empty<CoachStyleSegment>(), System.Array.Empty<CoachStyleRow>());
        }

        var styles = new (string Key, int Count, StatusKind Status)[]
        {
            ("efficient", c.EfficientCount, StatusKind.Success),
            ("moderate", c.ModerateCount, StatusKind.Warning),
            ("aggressive", c.AggressiveCount, StatusKind.Danger),
        };

        var segments = new List<CoachStyleSegment>();
        var rows = new List<CoachStyleRow>();
        foreach (var (key, count, status) in styles)
        {
            double pct = (double)count / c.TotalDrivesAnalyzed * 100;
            string label = l.GetString($"dynamics.coach.style.{key}", Capitalize(key));
            if (pct > 0)
            {
                segments.Add(new CoachStyleSegment(key, pct / 100.0, status, $"{label}: {count}"));
            }

            rows.Add(new CoachStyleRow(label, count.ToString(CultureInfo.CurrentCulture), status));
        }

        return (segments, rows);
    }

    private static DynSeries BuildWeeklySeries(CoachData? coach, ILocalizer l)
    {
        var points = new List<ChartPoint>();
        var weekly = coach?.WeeklyTrend ?? System.Array.Empty<CoachWeeklyPoint>();
        for (int i = 0; i < weekly.Count; i++)
        {
            points.Add(new ChartPoint(i, weekly[i].Score, weekly[i].Week));
        }

        return new DynSeries(l.GetString("dynamics.coach.col.score", "Score"), ChartSeriesKind.Line, ChartRole.Regen, 0, null, points);
    }

    private static List<CoachPatternRow> BuildPatterns(CoachData? coach, ILocalizer l)
    {
        var defs = new (string Label, double Value, double Lo, double Hi)[]
        {
            (l.GetString("dynamics.coach.hardAccel", "Hard Acceleration"), coach?.HardAccelPct ?? 0, 20, 40),
            (l.GetString("dynamics.coach.hardBrake", "Hard Braking"), coach?.HardBrakePct ?? 0, 15, 30),
            (l.GetString("dynamics.coach.highway", "Highway Driving"), coach?.HighwayPct ?? 0, 50, 70),
            (l.GetString("dynamics.coach.shortTrips", "Short Trips (<5 km)"), coach?.ShortTripPct ?? 0, 30, 50),
            (l.GetString("dynamics.coach.coldStarts", "Cold Starts"), coach?.ColdStartPct ?? 0, 15, 30),
        };

        var rows = new List<CoachPatternRow>(defs.Length);
        foreach (var (label, value, lo, hi) in defs)
        {
            StatusKind status = value <= lo ? StatusKind.Success : value <= hi ? StatusKind.Warning : StatusKind.Danger;
            rows.Add(new CoachPatternRow(label, ScalarFormatters.FormatPercentage(value, 0), Math.Min(100, value), status));
        }

        return rows;
    }

    private static (bool, IReadOnlyList<CoachRecRow>) BuildRecommendations(CoachData? coach, ILocalizer l)
    {
        var recs = coach?.Recommendations ?? System.Array.Empty<CoachRecommendation>();
        if (recs.Count == 0)
        {
            return (false, System.Array.Empty<CoachRecRow>());
        }

        var rows = new List<CoachRecRow>(recs.Count);
        foreach (var r in recs)
        {
            StatusKind status = r.Impact switch
            {
                "high" => StatusKind.Danger,
                "medium" => StatusKind.Warning,
                _ => StatusKind.Success,
            };
            rows.Add(new CoachRecRow(r.Impact, status, r.Tip));
        }

        return (true, rows);
    }

    private static (bool, IReadOnlyList<CoachScoreRow>) BuildPerDrive(CoachData? coach)
    {
        var scores = coach?.PerDriveScores ?? System.Array.Empty<CoachDriveScore>();
        if (scores.Count == 0)
        {
            return (false, System.Array.Empty<CoachScoreRow>());
        }

        var rows = new List<CoachScoreRow>(scores.Count);
        foreach (var s in scores)
        {
            StatusKind scoreStatus = s.Score >= 75 ? StatusKind.Success : s.Score >= 50 ? StatusKind.Warning : StatusKind.Danger;
            StatusKind styleStatus = s.Style switch
            {
                "efficient" => StatusKind.Success,
                "moderate" => StatusKind.Warning,
                _ => StatusKind.Danger,
            };
            rows.Add(new CoachScoreRow(
                s.DriveId.ToString(CultureInfo.InvariantCulture),
                FormatDateShort(s.Date),
                ScalarFormatters.FormatNumber(s.Score, 0),
                scoreStatus,
                s.Style,
                styleStatus,
                ScalarFormatters.FormatNumber(s.Efficiency, 0),
                $"{ScalarFormatters.FormatNumber(s.Distance, 0)} km"));
        }

        return (true, rows);
    }

    // ── 10. Drive Analytics ──────────────────────────────────────────────────────────────────────────────
    private static AnalyticsDisplay BuildAnalytics(
        IReadOnlyList<DriveRow> drives, DateRange range, UnitPref units, ILocalizer l)
    {
        string speedUnit = UnitLabels.Label(units.Speed);
        string distanceUnit = UnitLabels.Label(units.Distance);
        string drivesLabel = l.GetString("dynamics.drives", "Drives");

        // Speed distribution (bar).
        var counts = new int[SpeedBuckets.Length];
        foreach (var d in drives)
        {
            if (d.AvgSpeedMps is not { } mps)
            {
                continue;
            }

            double spd = UnitConverters.SpeedFromSi(mps, units.Speed);
            for (int i = 0; i < SpeedBuckets.Length; i++)
            {
                double lo = UnitConverters.SpeedFromSi(SpeedBuckets[i].Min, units.Speed);
                double hi = double.IsPositiveInfinity(SpeedBuckets[i].Max)
                    ? double.PositiveInfinity
                    : UnitConverters.SpeedFromSi(SpeedBuckets[i].Max, units.Speed);
                if (spd >= lo && spd < hi)
                {
                    counts[i]++;
                    break;
                }
            }
        }

        var speedPts = new List<ChartPoint>(SpeedBuckets.Length);
        for (int i = 0; i < SpeedBuckets.Length; i++)
        {
            speedPts.Add(new ChartPoint(i, counts[i], $"{SpeedBuckets[i].Label} {speedUnit}"));
        }

        var speedCard = new DynChartCard(
            l.GetString("dynamics.speedDistribution", "Speed Distribution"),
            l.GetString("dynamics.speedDistDesc", "Drives grouped by average speed"),
            l.GetString("dynamics.speedDistribution.aria", "Speed-bucket drive count distribution bar chart"),
            l.GetString("common.noData", "No data available"),
            drives.Count > 0,
            l.GetString("dynamics.col.range", "Speed range"),
            [new DynSeries(drivesLabel, ChartSeriesKind.Bar, ChartRole.None, 0, null, speedPts)],
            System.Array.Empty<ChartAnnotation>());

        // Acceleration patterns (scatter) + mean reference line.
        var accelPts = new List<ChartPoint>();
        double sumPower = 0;
        foreach (var d in drives)
        {
            if (d.AvgPowerW is not { } w)
            {
                continue;
            }

            double distance = Math.Round(UnitConverters.DistanceFromSi(d.DistanceM, units.Distance));
            double powerKw = w / 1000.0;
            accelPts.Add(new ChartPoint(distance, powerKw, null));
            sumPower += powerKw;
        }

        var accelAnnotations = new List<ChartAnnotation>();
        string avgLabel = l.GetString("dynamics.avg", "Avg");
        if (accelPts.Count > 0)
        {
            double mean = sumPower / accelPts.Count;
            accelAnnotations.Add(new ChartAnnotation("avg-power", ChartAnnotationKind.HorizontalLine, mean)
            {
                Label = avgLabel,
                Role = ChartRole.Energy,
            });
        }

        var accelCard = new DynChartCard(
            l.GetString("dynamics.accelPatterns", "Acceleration Patterns"),
            l.GetString("dynamics.accelPatternsDesc", "Peak power vs trip distance"),
            l.GetString("dynamics.accelPatterns.aria", "Per-drive scatter chart of peak power versus trip distance"),
            l.GetString("common.noData", "No data available"),
            accelPts.Count > 0,
            $"{l.GetString("dynamics.distance", "Distance")} ({distanceUnit})",
            [new DynSeries(drivesLabel, ChartSeriesKind.Scatter, ChartRole.None, 3, "kW", accelPts)],
            accelAnnotations);

        // Power profile (dual area) — recent 20 drives.
        var maxPts = new List<ChartPoint>();
        var minPts = new List<ChartPoint>();
        int startIdx = Math.Max(0, drives.Count - 20);
        for (int i = startIdx; i < drives.Count; i++)
        {
            var d = drives[i];
            string label = FormatDateShort(d.StartTs);
            maxPts.Add(new ChartPoint(i - startIdx, (d.AvgPowerW ?? 0) / 1000.0, label));
            minPts.Add(new ChartPoint(i - startIdx, 0, label));
        }

        var powerCard = new DynChartCard(
            l.GetString("dynamics.powerProfile", "Power Profile"),
            l.GetString("dynamics.powerProfileDesc", "Peak & regen power for recent drives"),
            l.GetString("dynamics.powerProfile.aria", "Recent-drives peak and regen power dual-area chart"),
            l.GetString("common.noData", "No data available"),
            maxPts.Count > 0,
            l.GetString("dynamics.col.drive", "Drive"),
            [
                new DynSeries(l.GetString("dynamics.maxPower", "Max Power (kW)"), ChartSeriesKind.Area, ChartRole.None, 0, "kW", maxPts),
                new DynSeries(l.GetString("dynamics.regenPower", "Regen Power (kW)"), ChartSeriesKind.Area, ChartRole.Regen, 3, "kW", minPts),
            ],
            System.Array.Empty<ChartAnnotation>());

        return new AnalyticsDisplay(
            l.GetString("dynamics.driveAnalytics", "Drive Analytics"),
            range,
            range.Start.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            range.End.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            speedCard,
            accelCard,
            powerCard,
            avgLabel);
    }

    // ── 11. Driving Tips ─────────────────────────────────────────────────────────────────────────────────
    private static TipsDisplay BuildTips(MotorStats? stats, ILocalizer l)
    {
        bool positive = stats is { } s && s.Style == ThrottleStyle.Conservative;
        var tips = new List<DynTipRow>();

        if (stats is not { } st)
        {
            tips.Add(new DynTipRow(l.GetString("dynamics.tipNoData", "Drive your vehicle to start collecting dynamics data."), false));
            return new TipsDisplay(l.GetString("dynamics.recommendations", "Driving Style Recommendations"), tips);
        }

        if (st.AvgPower > 80)
        {
            tips.Add(new DynTipRow(l.GetString("dynamics.tipEaseAccel", "Ease into the accelerator \u2014 gradual inputs save energy and tire wear."), positive));
            tips.Add(new DynTipRow(l.GetString("dynamics.tipBrakeEarly", "Brake earlier and lighter to improve regen capture."), positive));
        }
        else if (st.AvgPower > 20)
        {
            tips.Add(new DynTipRow(l.GetString("dynamics.tipSmoothThrottle", "Smooth throttle transitions can improve efficiency by 10\u201315%."), positive));
            tips.Add(new DynTipRow(l.GetString("dynamics.tipCoast", "Lift off the pedal earlier to let regen do the work."), positive));
        }
        else
        {
            tips.Add(new DynTipRow(l.GetString("dynamics.tipGreat", "Excellent driving style! Maintaining this maximizes range and comfort."), positive));
            tips.Add(new DynTipRow(l.GetString("dynamics.tipKeep", "Keep monitoring your scores \u2014 consistency is key."), positive));
        }

        if (st.MaxMotorTemp > 120)
        {
            tips.Add(new DynTipRow(l.GetString("dynamics.tipThermal", "Motor temps are running high \u2014 consider easing off sustained high power."), positive));
        }

        return new TipsDisplay(l.GetString("dynamics.recommendations", "Driving Style Recommendations"), tips);
    }

    // ── Shared helpers ───────────────────────────────────────────────────────────────────────────────────
    private static DynStatCard Card(string glyph, string label, string value) =>
        new(glyph, label, value, $"{label}: {value}");

    /// <summary>The gear tint band (web <c>shiftColor</c> / <c>shiftBadgeVariant</c>).</summary>
    public static StatusKind ShiftStatus(string? shift) => shift switch
    {
        "D" => StatusKind.Success,
        "R" => StatusKind.Danger,
        "N" => StatusKind.Warning,
        _ => StatusKind.Neutral,
    };

    /// <summary>The coach-score quality band (web ≥75 success / ≥50 warning / else danger).</summary>
    public static StatusKind ScoreStatus(double score) =>
        score >= 75 ? StatusKind.Success : score >= 50 ? StatusKind.Warning : StatusKind.Danger;

    private static string Capitalize(string s) =>
        string.IsNullOrEmpty(s) ? s : char.ToUpper(s[0], CultureInfo.InvariantCulture) + s[1..];

    private static string FormatDateShort(string raw)
    {
        if (DateTimeOffset.TryParse(raw, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var parsed))
        {
            return parsed.ToString("MMM d", CultureInfo.CurrentCulture);
        }

        return string.IsNullOrEmpty(raw) ? EmDash : raw;
    }

    private static string FormatDateShort(DateTimeOffset? ts) =>
        ts is { } t ? t.ToString("MMM d", CultureInfo.CurrentCulture) : EmDash;
}

/// <summary>
/// Canonical navigation + diagnostics metadata for the Driving-Dynamics page — the native mirror of the web page
/// at web/src/features/driving/pages/DrivingDynamicsPage.tsx (route <c>/driving-dynamics</c>, nav name
/// <c>DrivingDynamics</c>). The page reads the four hooks the web page calls directly — <c>useMotorLatest</c>
/// (<c>get_api_v1_motor_latest</c>), <c>useMotorHistory</c> (<c>get_api_v1_motor</c>), <c>useDrives</c>
/// (<c>get_api_v1_drives</c>) and <c>useDrivingCoach</c> (<c>get_api_v1_analytics_driving_coach</c>) — plus the
/// three reads its self-fetching children make.
/// </summary>
public static class DrivingDynamicsRegistration
{
    /// <summary>The navigation route name the shell registers this page under (matches <c>RouteTable</c>).</summary>
    public const string RouteName = "DrivingDynamics";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "DrivingDynamicsPage";

    /// <summary>Generated operation id for the latest motor reading (web <c>useMotorLatest</c>).</summary>
    public const string MotorLatestOperation = "get_api_v1_motor_latest";

    /// <summary>Generated operation id for the motor history (web <c>useMotorHistory</c>).</summary>
    public const string MotorHistoryOperation = "get_api_v1_motor";

    /// <summary>Generated operation id for the drive list (web <c>useDrives</c>).</summary>
    public const string DrivesOperation = "get_api_v1_drives";

    /// <summary>Generated operation id for the driving-coach rollup (web <c>useDrivingCoach</c>).</summary>
    public const string CoachOperation = "get_api_v1_analytics_driving_coach";

    /// <summary>Generated operation id for the latest drive-dynamics telemetry (web <c>useDriveDynamicsLatest</c>).</summary>
    public const string DriveDynamicsLatestOperation = "get_api_v1_drive_dynamics_latest";

    /// <summary>Generated operation id for the vehicle state read (web <c>useVehicleState</c>).</summary>
    public const string VehicleStateOperation = "get_api_v1_vehicles_vehicleID_state";

    /// <summary>Generated operation id for the cold-signal observations read (web <c>useSignalObservations</c>).</summary>
    public const string ObservationsOperation = "get_api_v1_signals_observations";

    /// <summary>The Segoe Fluent glyph for the page-level empty / section surfaces.</summary>
    public const string EmptyGlyph = DrivingDynamicsProjection.EmptyGlyph;

    /// <summary>The localized page title (web <c>t('dynamics.title')</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("dynamics.title", "Driving Dynamics");
    }
}

/// <summary>
/// PII-safe diagnostics sink for the Driving-Dynamics surface — records only the <c>view.opened</c> event with
/// the surface slug, never any vehicle data. Mirrors the sibling feature-view diagnostics.
/// </summary>
public sealed class DrivingDynamicsDiagnostics
{
    private readonly Action<string>? _sink;
    private int _viewsOpened;

    /// <summary>Creates the diagnostics sink over an optional line writer.</summary>
    public DrivingDynamicsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>The number of times the surface was opened.</summary>
    public int ViewsOpened => _viewsOpened;

    /// <summary>Record that the surface was opened (PII-safe).</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={DrivingDynamicsRegistration.Slug}");
    }
}
