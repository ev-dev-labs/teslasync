using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Driving;

/// <summary>
/// The fully projected, render-ready content the <c>DrivetrainHealthPage</c> view binds to — the native
/// analogue of everything the web page computes before the JSX builds its children
/// (web/src/features/driving/pages/DrivetrainHealthPage.tsx). It carries the resolved page chrome (title /
/// subtitle / automation name), the four-state visibility flags and copy, and a fully-built model (or snapshot)
/// for every one of the twelve child regions so the view is a thin renderer that never derives data itself.
/// No WinUI types — unit-testable without a UI host.
/// </summary>
/// <param name="State">The resolved top-level data state.</param>
/// <param name="Title">The localized page title (web <c>drivetrain.title</c>).</param>
/// <param name="Subtitle">The localized page subtitle (web <c>drivetrain.subtitle</c>).</param>
/// <param name="AutomationName">The composed Narrator name for the surface.</param>
/// <param name="ShowLoading">Whether the loading skeleton is shown.</param>
/// <param name="ShowEmpty">Whether the friendly empty surface is shown (web <c>EmptyState</c>).</param>
/// <param name="ShowError">Whether the retriable error surface is shown.</param>
/// <param name="ShowContent">Whether the populated composition is shown.</param>
/// <param name="EmptyMessage">The localized empty-state copy (web <c>drivetrain.noData</c>).</param>
/// <param name="ErrorText">The resolved error-state message.</param>
/// <param name="RetryLabel">The localized retry-affordance label.</param>
/// <param name="Units">The user's unit preference (applied only at the child render boundary).</param>
/// <param name="HealthOverview">The model for the <c>HealthOverview</c> banner child.</param>
/// <param name="HealthGaugeGrid">The model for the <c>HealthGaugeGrid</c> child.</param>
/// <param name="TemperatureGauges">The model for the <c>TemperatureGauges</c> child.</param>
/// <param name="ThermalLoadPanel">The model for the <c>ThermalLoadPanel</c> child.</param>
/// <param name="StatorTempChart">The model for the <c>StatorTempChart</c> child.</param>
/// <param name="TemperatureTrendChart">The model for the <c>TemperatureTrendChart</c> child.</param>
/// <param name="PowerOutputChart">The model for the <c>PowerOutputChart</c> child.</param>
/// <param name="ShowLiveMotor">Whether the live-motor child is shown (web <c>{motorLatest &amp;&amp; …}</c>).</param>
/// <param name="MotorLatest">The latest live-motor reading for the <c>LiveMotorStatus</c> child, or null.</param>
/// <param name="IsolationResistanceKohm">The HV-isolation resistance for <c>LiveMotorStatus</c>, or null.</param>
/// <param name="TorqueSamples">The motor-torque samples for the <c>TorqueHistoryChart</c> child.</param>
/// <param name="TemperatureMetricCards">The snapshot for the <c>TemperatureMetricCards</c> child.</param>
/// <param name="DetailCards">The snapshot for the <c>DetailCards</c> child.</param>
/// <param name="HealthRecommendations">The snapshot for the <c>HealthRecommendations</c> child.</param>
public sealed record DrivetrainHealthDisplay(
    DrivetrainHealthPageState State,
    string Title,
    string Subtitle,
    string AutomationName,
    bool ShowLoading,
    bool ShowEmpty,
    bool ShowError,
    bool ShowContent,
    string EmptyMessage,
    string ErrorText,
    string RetryLabel,
    UnitPref Units,
    HealthOverviewModel HealthOverview,
    HealthGaugeGridModel HealthGaugeGrid,
    TemperatureGaugesModel TemperatureGauges,
    ThermalLoadPanelModel ThermalLoadPanel,
    StatorTempChartModel StatorTempChart,
    TemperatureTrendChartModel TemperatureTrendChart,
    PowerOutputChartModel PowerOutputChart,
    bool ShowLiveMotor,
    TeslaSync.App.FeatureViews.MotorLiveReading? MotorLatest,
    double? IsolationResistanceKohm,
    IReadOnlyList<MotorTorqueSample> TorqueSamples,
    TemperatureMetricCardsSnapshot TemperatureMetricCards,
    DetailCardsSnapshot DetailCards,
    DrivetrainHealthSnapshot HealthRecommendations);

/// <summary>
/// Pure projection from a <see cref="DrivetrainHealthPageModel"/> to its <see cref="DrivetrainHealthDisplay"/>
/// — the native port of web/src/features/driving/pages/DrivetrainHealthPage.tsx. It resolves the four-state
/// matrix, then reproduces every web memo (the four temperature <c>sensors</c>, the windowed recent-drive
/// <c>chartData</c> with its <c>peakPower</c> / <c>avgPowerMax</c> / <c>minRegenPower</c> aggregates, the
/// <c>tempTrendData</c> filter and the <c>motorChartData</c> series) and builds a render-ready model (or
/// snapshot) for each of the twelve children, deferring every unit conversion to the children's own render
/// boundaries. No WinUI types — unit-testable without a UI host.
/// </summary>
public static class DrivetrainHealthProjection
{
    private const string EmDash = "\u2014";

    /// <summary>The default recent-drive look-back window in days (web <c>defaultStartDate = today − 30 days</c>).</summary>
    public const int WindowDays = 30;

    /// <summary>The maximum number of most-recent chart points retained (web <c>chartData.slice(-30)</c>).</summary>
    public const int MaxChartPoints = 30;

    private const double WattsPerKilowatt = 1000.0;

    // The four web sensors (constants.ts): { key, labelKey, defaultLabel, maxTemp }.
    private const double MotorMaxTempC = 150;
    private const double InverterMaxTempC = 120;
    private const double BatteryMaxTempC = 60;

    /// <summary>Project <paramref name="model"/> into a render-ready display in the active units + locale.</summary>
    /// <param name="model">The parsed five-source snapshot plus the page lifecycle flags.</param>
    /// <param name="units">The user's unit-display preference (applied only at the child render boundary).</param>
    /// <param name="localizer">The i18n facade every page label resolves through.</param>
    /// <param name="now">Injectable clock for the deterministic recent-drive window maths in tests.</param>
    /// <returns>The fully projected, render-ready display.</returns>
    public static DrivetrainHealthDisplay Project(
        DrivetrainHealthPageModel model,
        UnitPref units,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        var data = model.Data;

        DrivetrainHealthPageState state =
            model.Loading && !data.HasHealth ? DrivetrainHealthPageState.Loading
            : model.ErrorDetail is not null ? DrivetrainHealthPageState.Error
            : !data.HasHealth ? DrivetrainHealthPageState.Empty
            : DrivetrainHealthPageState.Success;

        string title = localizer.GetString("drivetrain.title", "Drivetrain Health");
        string subtitle = localizer.GetString("drivetrain.subtitle", "Motor, inverter, and battery thermal status");
        string emptyMessage = localizer.GetString("drivetrain.noData", "No drivetrain health data available yet");
        string retryLabel = localizer.GetString("common.retry", "Retry");
        string errorText = string.IsNullOrWhiteSpace(model.ErrorDetail)
            ? localizer.GetString("common.error", "Something went wrong")
            : model.ErrorDetail;

        double healthScore = DrivetrainHealthScore.ForLevel(data.OverallHealth);
        DateTimeOffset? updatedAt = state == DrivetrainHealthPageState.Success ? now : null;

        // ── Recent-drive window → chartData (web chartData useMemo) ─────────────────────────────────────
        var chart = BuildChartData(data.Drives, now);
        double peakKw = chart.Count == 0 ? 0 : chart.Max(p => p.PowerMax);
        double avgKw = chart.Count == 0 ? 0 : chart.Average(p => p.PowerMax);
        double minRegenKw = chart.Count == 0 ? 0 : chart.Min(p => p.PowerMin);

        var powerPoints = chart;
        var tempTrend = chart
            .Where(p => p.OutsideTempC is not null)
            .Select(p => new TemperatureTrendSample(p.Date, p.OutsideTempC))
            .ToList();

        // ── Motor-history → motorChartData (web motorChartData useMemo) ─────────────────────────────────
        var statorSamples = data.MotorHistory
            .Select(s => new StatorTempSample(
                s.Ts is null ? string.Empty : DateTimeFormatting.Format(ParseTs(s.Ts), DateTimeVariant.Time, now),
                s.MotorTempCFront,
                s.MotorTempCRear,
                s.InverterTempC))
            .ToList();
        var torqueSamples = data.MotorHistory
            .Select(s => new MotorTorqueSample(s.Ts, s.TorqueNmFront ?? s.TorqueNmRear))
            .ToList();

        // ── Four temperature sensors (web sensors useMemo) ──────────────────────────────────────────────
        var status = ToStatus(data.OverallHealth);
        double?[] sensorValues = [data.FrontMotorTempC, data.RearMotorTempC, data.InverterTempC, data.BatteryTempC];

        var gaugeStats = data.Stats is { } gs
            ? new HealthGaugeDriveStats(gs.TotalDrives, gs.TotalDistanceKm, gs.AvgSpeedKmh, gs.TopSpeedKmh)
            : null;
        var thermalStats = data.Stats is { } ts
            ? new ThermalDrivingStats((int)Math.Round(ts.TotalDrives, MidpointRounding.AwayFromZero), ts.RegenRatio)
            : null;
        var detailStats = data.Stats is { } ds
            ? new DetailCardsStats(ds.RegenEnergyWh, ds.Co2SavedKg)
            : null;

        // ── Build every child model / snapshot from the single page snapshot ────────────────────────────
        var healthOverview = HealthOverviewModel.Ready(data.OverallHealth, healthScore, data.MotorStatus, updatedAt);
        var healthGaugeGrid = HealthGaugeGridModel.Ready(
            status, healthScore, data.MotorStatus, sensorValues, gaugeStats, units, updatedAt);
        var temperatureGauges = TemperatureGaugesModel.Ready(BuildGaugeSensors(data), units, updatedAt);
        var thermalLoadPanel = ThermalLoadPanelModel.Ready(
            BuildThermalSensors(data), peakKw, avgKw, thermalStats, updatedAt);
        var statorChart = statorSamples.Count == 0
            ? StatorTempChartModel.Empty
            : new StatorTempChartModel(false, statorSamples);
        var trendChart = tempTrend.Count == 0
            ? TemperatureTrendChartModel.Empty
            : new TemperatureTrendChartModel(false, tempTrend);
        var powerChart = powerPoints.Count == 0
            ? PowerOutputChartModel.Empty
            : PowerOutputChartModel.Loaded(powerPoints
                .Select(p => new PowerOutputPoint(p.Date, p.PowerMax, p.PowerMin))
                .ToList());

        var metricCardsSnapshot = new TemperatureMetricCardsSnapshot(
            data.FrontMotorTempC, data.RearMotorTempC, data.InverterTempC, data.BatteryTempC,
            data.MotorStatus, status, peakKw);
        var detailSnapshot = new DetailCardsSnapshot(
            data.FrontMotorTempC, data.RearMotorTempC, data.InverterTempC, data.BatteryTempC,
            new DrivetrainPowerSummary(peakKw, avgKw, minRegenKw), detailStats);
        var recommendationsSnapshot = new DrivetrainHealthSnapshot(data.OverallHealth);

        return new DrivetrainHealthDisplay(
            State: state,
            Title: title,
            Subtitle: subtitle,
            AutomationName: title,
            ShowLoading: state == DrivetrainHealthPageState.Loading,
            ShowEmpty: state == DrivetrainHealthPageState.Empty,
            ShowError: state == DrivetrainHealthPageState.Error,
            ShowContent: state == DrivetrainHealthPageState.Success,
            EmptyMessage: emptyMessage,
            ErrorText: errorText,
            RetryLabel: retryLabel,
            Units: units,
            HealthOverview: healthOverview,
            HealthGaugeGrid: healthGaugeGrid,
            TemperatureGauges: temperatureGauges,
            ThermalLoadPanel: thermalLoadPanel,
            StatorTempChart: statorChart,
            TemperatureTrendChart: trendChart,
            PowerOutputChart: powerChart,
            ShowLiveMotor: data.MotorLatest is not null,
            MotorLatest: data.MotorLatest,
            IsolationResistanceKohm: null,
            TorqueSamples: torqueSamples,
            TemperatureMetricCards: metricCardsSnapshot,
            DetailCards: detailSnapshot,
            HealthRecommendations: recommendationsSnapshot);
    }

    /// <summary>The em-dash shown where a value is unavailable (mirrors the web fallback).</summary>
    public static string EmptyDisplay => EmDash;

    /// <summary>Map the canonical drivetrain-health level onto the <c>HealthGaugeGrid</c> / metric-card status enum.</summary>
    /// <param name="level">The canonical health level.</param>
    /// <returns>The equivalent <see cref="DrivetrainHealthStatus"/>.</returns>
    public static DrivetrainHealthStatus ToStatus(DrivetrainHealth level) => level switch
    {
        DrivetrainHealth.Warning => DrivetrainHealthStatus.Warning,
        DrivetrainHealth.Critical => DrivetrainHealthStatus.Critical,
        _ => DrivetrainHealthStatus.Good,
    };

    // One projected chart point — the native mirror of a web ChartDataPoint (date / powerMax / powerMin /
    // outsideTemp). Distance is omitted (no child reads it on the native side).
    private sealed record ChartPoint(string Date, double PowerMax, double PowerMin, double? OutsideTempC);

    private static List<ChartPoint> BuildChartData(IReadOnlyList<DrivetrainDriveSample> drives, DateTimeOffset now)
    {
        // Web window: today − 30 days at 00:00 → today at 23:59:59 (local), then ascending, capped at 30 points.
        DateTimeOffset start = new(now.Date.AddDays(-WindowDays), now.Offset);
        DateTimeOffset end = new(now.Date.AddDays(1).AddSeconds(-1), now.Offset);

        var windowed = new List<DrivetrainDriveSample>(drives.Count);
        foreach (var d in drives)
        {
            if (d.StartTs >= start && d.StartTs <= end)
            {
                windowed.Add(d);
            }
        }

        windowed.Sort((a, b) => a.StartTs.CompareTo(b.StartTs));
        IEnumerable<DrivetrainDriveSample> capped = windowed.Count > MaxChartPoints
            ? windowed.Skip(windowed.Count - MaxChartPoints)
            : windowed;

        return capped
            .Select(d => new ChartPoint(
                DateTimeFormatting.Format(d.StartTs, DateTimeVariant.Short, now),
                (d.AvgPowerW ?? 0) / WattsPerKilowatt,
                0,
                d.OutsideTempAvgC))
            .ToList();
    }

    private static IReadOnlyList<TemperatureGaugeSensor> BuildGaugeSensors(DrivetrainHealthPageData data) =>
    [
        new("frontMotor", "drivetrain.frontMotor", "Front Motor", data.FrontMotorTempC, MotorMaxTempC),
        new("rearMotor", "drivetrain.rearMotor", "Rear Motor", data.RearMotorTempC, MotorMaxTempC),
        new("inverter", "drivetrain.inverter", "Inverter", data.InverterTempC, InverterMaxTempC),
        new("battery", "drivetrain.battery", "Battery", data.BatteryTempC, BatteryMaxTempC),
    ];

    private static IReadOnlyList<ThermalSensorInput> BuildThermalSensors(DrivetrainHealthPageData data) =>
    [
        new("frontMotor", "drivetrain.frontMotor", "Front Motor", data.FrontMotorTempC, MotorMaxTempC),
        new("rearMotor", "drivetrain.rearMotor", "Rear Motor", data.RearMotorTempC, MotorMaxTempC),
        new("inverter", "drivetrain.inverter", "Inverter", data.InverterTempC, InverterMaxTempC),
        new("battery", "drivetrain.battery", "Battery", data.BatteryTempC, BatteryMaxTempC),
    ];

    private static DateTimeOffset? ParseTs(string? ts) =>
        DateTimeOffset.TryParse(
            ts,
            System.Globalization.CultureInfo.InvariantCulture,
            System.Globalization.DateTimeStyles.AssumeUniversal,
            out var dto)
            ? dto
            : null;
}
