using System.Globalization;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive render branch of the <c>ThermalLoadPanel</c> surface — the native union of the
/// states the P2 feature-view contract requires for the drivetrain thermal-load indicators
/// (web/src/features/driving/components/drivetrain-health/ThermalLoadPanel.tsx). The web component is a pure
/// presentational child (it takes already-resolved <c>sensors</c> / <c>peakPower</c> / <c>avgPowerMax</c> /
/// <c>stats</c> props and performs no fetching), so the parent drivetrain-health experience owns the query
/// lifecycle (web <c>useDrivetrainHealth</c> / <c>useDrives</c> / <c>useDrivingStats</c>) and supplies the
/// active state. Every member maps onto a visible surface (never a blank box): <see cref="Ready"/>,
/// <see cref="Stale"/> and <see cref="Offline"/> render the thermal bars plus the four inline metrics (with
/// the stale / offline chip for the latter two), <see cref="Empty"/> renders the friendly empty state (no
/// sensors to plot), <see cref="Loading"/> the skeleton chrome and <see cref="Error"/> the retry surface.
/// </summary>
public enum ThermalLoadPanelState
{
    /// <summary>The parent query is in flight and no snapshot has arrived yet — skeleton chrome.</summary>
    Loading,

    /// <summary>A resolved snapshot carrying at least one thermal sensor — the bars-plus-metrics composition.</summary>
    Ready,

    /// <summary>Resolved with no sensors to plot — a friendly empty state, never a blank box.</summary>
    Empty,

    /// <summary>The query failed with no usable snapshot — a retriable error surface.</summary>
    Error,

    /// <summary>Showing a snapshot older than the freshness window — content plus a stale chip.</summary>
    Stale,

    /// <summary>No connectivity — the last cached snapshot plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The thermal severity a single sensor bar carries — the native mirror of the web
/// <c>tempSeverityColor(celsius, max)</c> bands
/// (web/src/features/driving/components/drivetrain-health/helpers.ts): a null reading is
/// <see cref="Unknown"/> (web grey <c>#6b7280</c>); a ratio ≥ 0.85 is <see cref="Critical"/> (web
/// <c>HEALTH_COLOR.critical</c>); ≥ 0.65 is <see cref="Warning"/> (<c>HEALTH_COLOR.warning</c>); otherwise
/// <see cref="Good"/> (<c>HEALTH_COLOR.good</c>). Resolved to a theme-aware token brush by
/// <see cref="ThermalLoadPanelTokens.SeverityBrushKey"/> so the view never hard-codes a colour.
/// </summary>
public enum ThermalSeverity
{
    /// <summary>Within the normal band (web green <c>#10b981</c>) — success accent.</summary>
    Good,

    /// <summary>Running warm, ratio ≥ 0.65 (web amber <c>#f59e0b</c>) — warning accent.</summary>
    Warning,

    /// <summary>Overheating, ratio ≥ 0.85 (web red <c>#ef4444</c>) — danger accent.</summary>
    Critical,

    /// <summary>No reading (web grey <c>#6b7280</c>) — muted accent.</summary>
    Unknown,
}

/// <summary>
/// One thermal sensor the panel plots — the native mirror of the web <c>TempSensor</c> subset
/// <c>ThermalLoadPanel</c> reads (key, labelKey, defaultLabel, value, maxTemp). The web <c>color</c> / icon
/// props are not surfaced here: the bar's fill colour is derived from <see cref="ValueC"/> /
/// <see cref="MaxTempC"/> by <c>tempSeverityColor</c>, exactly as the web does. <see cref="ValueC"/> stays
/// SI Celsius (null when the sensor has no reading); it is converted to the user's unit only at projection
/// time. Pure data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Key">Stable sensor id (web <c>sensor.key</c>; the bar's row key).</param>
/// <param name="LabelKey">i18n key for the sensor label (web <c>sensor.labelKey</c>).</param>
/// <param name="DefaultLabel">English fallback label (web <c>sensor.defaultLabel</c>).</param>
/// <param name="ValueC">The reading in SI Celsius, or null when the sensor has no value.</param>
/// <param name="MaxTempC">The bar's full-scale temperature in SI Celsius (web <c>sensor.maxTemp</c>).</param>
public sealed record ThermalSensorInput(
    string Key,
    string LabelKey,
    string DefaultLabel,
    double? ValueC,
    double MaxTempC);

/// <summary>
/// The driving-stats subset the panel's two stat tiles read — the native mirror of the web <c>stats</c> prop
/// fields <c>ThermalLoadPanel</c> touches (<c>totalDrives</c>, <c>regenRatio</c>). A null
/// <see cref="ThermalLoadPanelModel.Stats"/> reproduces the web <c>stats === undefined</c> branch (the Drives
/// and Regen-Ratio tiles render an em dash). <see cref="RegenRatio"/> is the web 0..1 ratio (multiplied by
/// 100 at render). Pure data, UI-free.
/// </summary>
/// <param name="TotalDrives">The lifetime drive count (web <c>stats.totalDrives</c>).</param>
/// <param name="RegenRatio">The regen ratio as a 0..1 fraction (web <c>stats.regenRatio</c>).</param>
public sealed record ThermalDrivingStats(int TotalDrives, double RegenRatio);

/// <summary>
/// The render-time data model the <c>ThermalLoadPanel</c> view binds to — the native analogue of the web
/// component's props (<c>sensors</c> / <c>peakPower</c> / <c>avgPowerMax</c> / <c>stats</c>,
/// web/src/features/driving/components/drivetrain-health/ThermalLoadPanel.tsx) plus the parent-supplied
/// lifecycle <see cref="Status"/> and freshness flags. The view never performs HTTP; the parent
/// drivetrain-health state holder fills this in (the native P1/S8 seam). <see cref="PeakPowerKw"/> and
/// <see cref="AvgPowerKw"/> arrive already in kilowatts (web parity — the parent computes
/// <c>avg_power_w / 1000</c> before passing them, and the panel renders them with a literal <c>kW</c>
/// suffix). Pure data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Status">The parent-supplied lifecycle state.</param>
/// <param name="Sensors">The thermal sensors to plot (web <c>sensors</c>); empty drives the empty state.</param>
/// <param name="PeakPowerKw">Peak drive power in kW (web <c>peakPower</c>); a non-positive value renders an em dash.</param>
/// <param name="AvgPowerKw">Average peak drive power in kW (web <c>avgPowerMax</c>); non-positive renders an em dash.</param>
/// <param name="Stats">The driving stats, or null (web <c>stats</c> undefined → the Drives / Regen tiles em-dash).</param>
/// <param name="UpdatedAt">When the snapshot was produced (drives the stale / offline freshness chip), or null.</param>
/// <param name="IsFetching">Whether a background refetch is in flight over the current snapshot.</param>
/// <param name="ErrorMessage">An optional already-localized hard-failure message (the error branch).</param>
public sealed record ThermalLoadPanelModel(
    ThermalLoadPanelState Status,
    IReadOnlyList<ThermalSensorInput> Sensors,
    double PeakPowerKw,
    double AvgPowerKw,
    ThermalDrivingStats? Stats,
    DateTimeOffset? UpdatedAt = null,
    bool IsFetching = false,
    string? ErrorMessage = null)
{
    /// <summary>The initial model: the parent query is in flight and no snapshot has arrived yet.</summary>
    public static ThermalLoadPanelModel Loading { get; } =
        new(ThermalLoadPanelState.Loading, Array.Empty<ThermalSensorInput>(), 0, 0, null);

    /// <summary>A resolved model with no sensors to plot — the empty state.</summary>
    public static ThermalLoadPanelModel Empty { get; } =
        new(ThermalLoadPanelState.Empty, Array.Empty<ThermalSensorInput>(), 0, 0, null);

    /// <summary>A hard-failure model (no usable snapshot) carrying an optional already-localized message.</summary>
    public static ThermalLoadPanelModel Failed(string? message = null) =>
        new(ThermalLoadPanelState.Error, Array.Empty<ThermalSensorInput>(), 0, 0, null, ErrorMessage: message);

    /// <summary>A fresh resolved model carrying the sensors, power figures and (optional) driving stats.</summary>
    public static ThermalLoadPanelModel Ready(
        IReadOnlyList<ThermalSensorInput> sensors,
        double peakPowerKw,
        double avgPowerKw,
        ThermalDrivingStats? stats,
        DateTimeOffset? updatedAt = null,
        bool isFetching = false) =>
        new(ThermalLoadPanelState.Ready, sensors ?? Array.Empty<ThermalSensorInput>(), peakPowerKw, avgPowerKw, stats, updatedAt, isFetching);

    /// <summary>A stale snapshot (older than the freshness window) carrying the cached data.</summary>
    public static ThermalLoadPanelModel Stale(
        IReadOnlyList<ThermalSensorInput> sensors,
        double peakPowerKw,
        double avgPowerKw,
        ThermalDrivingStats? stats,
        DateTimeOffset? updatedAt = null) =>
        new(ThermalLoadPanelState.Stale, sensors ?? Array.Empty<ThermalSensorInput>(), peakPowerKw, avgPowerKw, stats, updatedAt);

    /// <summary>An offline snapshot (no connectivity) carrying the last cached data.</summary>
    public static ThermalLoadPanelModel Offline(
        IReadOnlyList<ThermalSensorInput> sensors,
        double peakPowerKw,
        double avgPowerKw,
        ThermalDrivingStats? stats,
        DateTimeOffset? updatedAt = null) =>
        new(ThermalLoadPanelState.Offline, sensors ?? Array.Empty<ThermalSensorInput>(), peakPowerKw, avgPowerKw, stats, updatedAt);
}

/// <summary>
/// One projected, render-ready thermal sensor bar — the native mirror of a web <c>MetricBar</c> row
/// (web/src/components/data-display/MetricBar.tsx) inside <c>ThermalLoadPanel</c>. Holds the localized label,
/// the bar value / full-scale (the fill fraction is layout math, never unit conversion), the already-formatted
/// temperature read-out shown beside the bar (web <c>sublabel = displayTemp(value, formatTemperature)</c>, an
/// em dash when the reading is null), the resolved <see cref="Severity"/> and its token brush key (web
/// <c>tempSeverityColor</c>), and the Narrator name. Pure data so the projection is asserted headlessly.
/// </summary>
/// <param name="Key">The sensor's stable row key (web <c>sensor.key</c>).</param>
/// <param name="Label">The localized sensor label.</param>
/// <param name="Value">The bar value (web <c>value ?? 0</c>, SI Celsius).</param>
/// <param name="Max">The bar full-scale (web <c>sensor.maxTemp</c>, SI Celsius).</param>
/// <param name="ValueText">The formatted temperature read-out beside the bar (em dash when null).</param>
/// <param name="Severity">The resolved thermal severity band (web <c>tempSeverityColor</c>).</param>
/// <param name="SeverityBrushKey">The token brush key tinting the bar fill for <see cref="Severity"/>.</param>
/// <param name="AutomationName">The Narrator name combining the label and the read-out.</param>
public sealed record ThermalSensorRow(
    string Key,
    string Label,
    double Value,
    double Max,
    string ValueText,
    ThermalSeverity Severity,
    string SeverityBrushKey,
    string AutomationName);

/// <summary>
/// One projected, render-ready inline metric tile — the native mirror of a web <c>InlineMetric</c>
/// (web/src/components/data-display/InlineMetric.tsx) inside <c>ThermalLoadPanel</c> (Peak Power, Avg Power,
/// Drives, Regen Ratio). Holds the Segoe Fluent glyph standing in for the web Lucide icon, the icon's token
/// brush key, the localized label, the already-formatted value (an em dash when there is no value), and the
/// Narrator name. Pure data so the projection is asserted headlessly.
/// </summary>
/// <param name="Key">A stable tile key (<c>peakPower</c> / <c>avgPower</c> / <c>drives</c> / <c>regenRatio</c>).</param>
/// <param name="Glyph">The Segoe Fluent glyph (web Lucide icon stand-in).</param>
/// <param name="IconBrushKey">The token brush key tinting the icon.</param>
/// <param name="Label">The localized tile label.</param>
/// <param name="Value">The already-formatted value, or an em dash.</param>
/// <param name="AutomationName">The Narrator name combining the label and value.</param>
public sealed record ThermalInlineMetric(
    string Key,
    string Glyph,
    string IconBrushKey,
    string Label,
    string Value,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the surface for one input model — the native analogue of
/// everything the web <c>ThermalLoadPanel</c> computes before returning JSX. Holds the active
/// <see cref="State"/>, the localized header <see cref="Title"/>, the thermal sensor bars, the four inline
/// metrics, the empty / loading / error copy and retry label, the stale / offline freshness chip, the
/// freshness timestamp + fetching flag, and the surface <see cref="AutomationName"/>. <see cref="HasData"/>
/// drives the content-vs-empty body branch (sensors present → bars + metrics; none → the friendly empty
/// state). Pure data so every branch is asserted headlessly.
/// </summary>
/// <param name="State">The resolved render branch.</param>
/// <param name="Title">The localized panel title (web <c>drivetrain.thermalMetrics</c>).</param>
/// <param name="HasData">True when there is at least one sensor to plot.</param>
/// <param name="Sensors">The projected sensor bars, in input order.</param>
/// <param name="Metrics">The four projected inline metrics (Peak / Avg power, Drives, Regen Ratio).</param>
/// <param name="EmptyMessage">The localized empty-state copy.</param>
/// <param name="LoadingLabel">The localized loading copy.</param>
/// <param name="ErrorTitle">The localized error-state title.</param>
/// <param name="ErrorMessage">The localized (or model-supplied) error-state message.</param>
/// <param name="RetryLabel">The localized retry-affordance label.</param>
/// <param name="ShowFreshnessChip">Whether a stale / offline freshness chip is shown.</param>
/// <param name="FreshnessChipText">The localized freshness-chip caption.</param>
/// <param name="FreshnessChipStatus">The freshness-chip tone (offline → danger, stale → warning).</param>
/// <param name="UpdatedAt">When the snapshot was produced, or null.</param>
/// <param name="IsFetching">Whether a background refetch is in flight.</param>
/// <param name="AutomationName">The composed Narrator name for the surface.</param>
public sealed record ThermalLoadPanelDisplay(
    ThermalLoadPanelState State,
    string Title,
    bool HasData,
    IReadOnlyList<ThermalSensorRow> Sensors,
    IReadOnlyList<ThermalInlineMetric> Metrics,
    string EmptyMessage,
    string LoadingLabel,
    string ErrorTitle,
    string ErrorMessage,
    string RetryLabel,
    bool ShowFreshnessChip,
    string FreshnessChipText,
    StatusKind FreshnessChipStatus,
    DateTimeOffset? UpdatedAt,
    bool IsFetching,
    string AutomationName)
{
    /// <summary>An all-empty display (the friendly empty state) for the loading / empty fallback.</summary>
    public static ThermalLoadPanelDisplay Empty(UnitPref units, ILocalizer localizer) =>
        ThermalLoadPanelProjection.Project(ThermalLoadPanelModel.Empty, units, localizer);
}

/// <summary>Resolves a <see cref="ThermalSeverity"/> to a generated design-token brush key. UI-free so the
/// mapping is unit-tested without a XAML runtime.</summary>
public static class ThermalLoadPanelTokens
{
    /// <summary>The theme-aware brush key tinting a sensor bar's fill (web <c>tempSeverityColor</c> → token).</summary>
    public static string SeverityBrushKey(ThermalSeverity severity) => severity switch
    {
        ThermalSeverity.Critical => "TsColorDangerBrush",   // web HEALTH_COLOR.critical (#ef4444)
        ThermalSeverity.Warning => "TsColorWarningBrush",   // web HEALTH_COLOR.warning (#f59e0b)
        ThermalSeverity.Good => "TsColorSuccessBrush",      // web HEALTH_COLOR.good (#10b981)
        _ => "TsColorTextMutedBrush",                       // web null grey (#6b7280)
    };
}

/// <summary>
/// Pure projection from a <see cref="ThermalLoadPanelModel"/> to its <see cref="ThermalLoadPanelDisplay"/> —
/// the native port of web/src/features/driving/components/drivetrain-health/ThermalLoadPanel.tsx (plus the
/// <c>tempSeverityColor</c> / <c>displayTemp</c> helpers). Branch precedence mirrors the web parent's data
/// lifecycle (loading → error → empty → stale / offline → ready); within a content state the bars + metrics
/// render when at least one sensor is present, otherwise a friendly empty state. SI Celsius is converted to
/// the user's unit here (and only here, via <see cref="UnitFormatters.FormatTemperature"/>); the power tiles
/// render the pre-derived kW figures with a literal <c>kW</c> suffix (web parity — the web hardcodes the
/// unit and does not pass power through <c>useUnits</c>). Every label resolves through the i18n facade using
/// the same keys the web feeds into <c>t(...)</c>. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class ThermalLoadPanelProjection
{
    /// <summary>The em dash shown when a value is unknown (the project-wide null-safety marker).</summary>
    public const string EmDash = "\u2014";

    /// <summary>The literal power-unit suffix the power tiles carry (web <c>'kW'</c>, applied verbatim).</summary>
    public const string PowerUnit = "kW";

    /// <summary>The ratio (value / max) at and above which a sensor is critical (web <c>tempSeverityColor</c> 0.85).</summary>
    public const double CriticalRatio = 0.85;

    /// <summary>The ratio (value / max) at and above which a sensor is warning (web <c>tempSeverityColor</c> 0.65).</summary>
    public const double WarningRatio = 0.65;

    /// <summary>i18n key for the panel title (web <c>drivetrain.thermalMetrics</c>).</summary>
    public const string TitleKey = "drivetrain.thermalMetrics";

    /// <summary>English fallback for <see cref="TitleKey"/>.</summary>
    public const string TitleFallback = "Thermal Load Indicators";

    /// <summary>i18n key for the Peak-Power tile (web <c>drivetrain.peakPower</c>).</summary>
    public const string PeakPowerKey = "drivetrain.peakPower";

    /// <summary>i18n key for the Avg-Power tile (web <c>drivetrain.avgPower</c>).</summary>
    public const string AvgPowerKey = "drivetrain.avgPower";

    /// <summary>i18n key for the Drives tile (web <c>drivetrain.drivesLabel</c>).</summary>
    public const string DrivesKey = "drivetrain.drivesLabel";

    /// <summary>i18n key for the Regen-Ratio tile (web <c>drivetrain.regenRatio</c>).</summary>
    public const string RegenRatioKey = "drivetrain.regenRatio";

    /// <summary>i18n key for the empty-state copy (shared drivetrain no-data string).</summary>
    public const string EmptyMessageKey = "drivetrain.noData";

    /// <summary>English fallback for <see cref="EmptyMessageKey"/>.</summary>
    public const string EmptyMessageFallback = "No drivetrain data available";

    /// <summary>i18n key for the loading copy (the shared <c>common.loading</c> string).</summary>
    public const string LoadingKey = "common.loading";

    /// <summary>English fallback for <see cref="LoadingKey"/>.</summary>
    public const string LoadingFallback = "Loading";

    /// <summary>i18n key for the error-state title.</summary>
    public const string ErrorTitleKey = "drivetrain.thermalLoadError";

    /// <summary>English fallback for <see cref="ErrorTitleKey"/>.</summary>
    public const string ErrorTitleFallback = "Couldn't load thermal load indicators";

    /// <summary>i18n key for the error-state message.</summary>
    public const string ErrorMessageKey = "drivetrain.thermalLoadErrorMessage";

    /// <summary>English fallback for <see cref="ErrorMessageKey"/>.</summary>
    public const string ErrorMessageFallback = "We couldn't load the thermal load indicators right now. Please try again.";

    /// <summary>i18n key for the retry affordance (the shared <c>common.retry</c> string).</summary>
    public const string RetryKey = "common.retry";

    /// <summary>English fallback for <see cref="RetryKey"/>.</summary>
    public const string RetryFallback = "Retry";

    /// <summary>i18n key for the stale freshness chip (the shared <c>common.stale</c> string).</summary>
    public const string StaleChipKey = "common.stale";

    /// <summary>English fallback for <see cref="StaleChipKey"/>.</summary>
    public const string StaleChipFallback = "Stale";

    /// <summary>i18n key for the offline freshness chip (the shared <c>common.offline</c> string).</summary>
    public const string OfflineChipKey = "common.offline";

    /// <summary>English fallback for <see cref="OfflineChipKey"/>.</summary>
    public const string OfflineChipFallback = "Offline";

    private const int PowerDecimals = 1;     // web fmtNumber(avgPowerMax, 1)
    private const int PercentDecimals = 1;   // web fmtNumber(regenRatio * 100, 1)

    /// <summary>Project <paramref name="model"/> into a render-ready display using the user's units and the
    /// i18n facade.</summary>
    /// <param name="model">The render-time data model (the web props plus the parent lifecycle state).</param>
    /// <param name="units">The user's unit preference (web <c>useUnits</c>; only the temperature unit is read).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static ThermalLoadPanelDisplay Project(ThermalLoadPanelModel model, UnitPref units, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        ThermalLoadPanelState state = SelectState(model);

        string title = localizer.GetString(TitleKey, TitleFallback);
        var sensors = BuildSensorRows(model.Sensors, units, localizer);
        var metrics = BuildMetrics(model, localizer);
        bool hasData = sensors.Count > 0;

        bool showChip = state is ThermalLoadPanelState.Stale or ThermalLoadPanelState.Offline;
        string chipText = state switch
        {
            ThermalLoadPanelState.Offline => localizer.GetString(OfflineChipKey, OfflineChipFallback),
            ThermalLoadPanelState.Stale => localizer.GetString(StaleChipKey, StaleChipFallback),
            _ => string.Empty,
        };
        StatusKind chipStatus = state == ThermalLoadPanelState.Offline ? StatusKind.Danger : StatusKind.Warning;

        string emptyMessage = localizer.GetString(EmptyMessageKey, EmptyMessageFallback);
        string loadingLabel = localizer.GetString(LoadingKey, LoadingFallback);
        string errorTitle = localizer.GetString(ErrorTitleKey, ErrorTitleFallback);
        string errorMessage = string.IsNullOrWhiteSpace(model.ErrorMessage)
            ? localizer.GetString(ErrorMessageKey, ErrorMessageFallback)
            : model.ErrorMessage!;
        string retryLabel = localizer.GetString(RetryKey, RetryFallback);

        string automationName = BuildAutomationName(
            state, title, hasData, showChip, chipText, emptyMessage, loadingLabel, errorTitle);

        return new ThermalLoadPanelDisplay(
            State: state,
            Title: title,
            HasData: hasData,
            Sensors: sensors,
            Metrics: metrics,
            EmptyMessage: emptyMessage,
            LoadingLabel: loadingLabel,
            ErrorTitle: errorTitle,
            ErrorMessage: errorMessage,
            RetryLabel: retryLabel,
            ShowFreshnessChip: showChip,
            FreshnessChipText: chipText,
            FreshnessChipStatus: chipStatus,
            UpdatedAt: model.UpdatedAt,
            IsFetching: model.IsFetching,
            AutomationName: automationName);
    }

    /// <summary>
    /// Classify a sensor's reading into a <see cref="ThermalSeverity"/> band — the native port of
    /// <c>tempSeverityColor</c>: null → <see cref="ThermalSeverity.Unknown"/>; otherwise the ratio
    /// <c>value / max</c> is bucketed (≥ 0.85 critical, ≥ 0.65 warning, else good). A non-positive
    /// <paramref name="maxC"/> is treated as unknown so the division is always well-defined.
    /// </summary>
    public static ThermalSeverity Severity(double? valueC, double maxC)
    {
        if (valueC is not { } v || double.IsNaN(v) || double.IsInfinity(v))
        {
            return ThermalSeverity.Unknown;
        }

        if (maxC <= 0 || double.IsNaN(maxC) || double.IsInfinity(maxC))
        {
            return ThermalSeverity.Unknown;
        }

        double ratio = v / maxC;
        if (ratio >= CriticalRatio)
        {
            return ThermalSeverity.Critical;
        }

        return ratio >= WarningRatio ? ThermalSeverity.Warning : ThermalSeverity.Good;
    }

    // Branch precedence from the web parent's data lifecycle. Loading / Error / Empty / Stale / Offline come
    // straight from the parent's classification; a resolved "Ready" snapshot keeps its state even with no
    // sensors (the body's HasData branch renders the friendly empty state) — only an explicit parent Empty
    // collapses the whole surface to the empty chrome.
    private static ThermalLoadPanelState SelectState(ThermalLoadPanelModel model) => model.Status switch
    {
        ThermalLoadPanelState.Loading => ThermalLoadPanelState.Loading,
        ThermalLoadPanelState.Error => ThermalLoadPanelState.Error,
        ThermalLoadPanelState.Empty => ThermalLoadPanelState.Empty,
        ThermalLoadPanelState.Stale => ThermalLoadPanelState.Stale,
        ThermalLoadPanelState.Offline => ThermalLoadPanelState.Offline,
        _ => ThermalLoadPanelState.Ready,
    };

    private static IReadOnlyList<ThermalSensorRow> BuildSensorRows(
        IReadOnlyList<ThermalSensorInput> sensors,
        UnitPref units,
        ILocalizer localizer)
    {
        if (sensors is null || sensors.Count == 0)
        {
            return Array.Empty<ThermalSensorRow>();
        }

        var rows = new List<ThermalSensorRow>(sensors.Count);
        foreach (var sensor in sensors)
        {
            string label = localizer.GetString(sensor.LabelKey, sensor.DefaultLabel);

            // web: displayTemp(value, formatTemperature) — null reads as the em dash, otherwise the
            // user-unit temperature. UnitFormatters returns the em dash for null/NaN, so this is one call.
            string valueText = UnitFormatters.FormatTemperature(sensor.ValueC, units);

            var severity = Severity(sensor.ValueC, sensor.MaxTempC);
            double barValue = sensor.ValueC is { } v && !double.IsNaN(v) && !double.IsInfinity(v) ? v : 0; // web value ?? 0

            rows.Add(new ThermalSensorRow(
                Key: sensor.Key,
                Label: label,
                Value: barValue,
                Max: sensor.MaxTempC,
                ValueText: valueText,
                Severity: severity,
                SeverityBrushKey: ThermalLoadPanelTokens.SeverityBrushKey(severity),
                AutomationName: string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, valueText)));
        }

        return rows;
    }

    private static ThermalInlineMetric[] BuildMetrics(ThermalLoadPanelModel model, ILocalizer localizer)
    {
        // web: peakPower > 0 ? `${fmtInt(peakPower)} kW` : '—'
        string peakValue = model.PeakPowerKw > 0
            ? string.Format(CultureInfo.CurrentCulture, "{0} {1}", ScalarFormatters.FormatNumber(model.PeakPowerKw, 0), PowerUnit)
            : EmDash;

        // web: avgPowerMax > 0 ? `${fmtNumber(avgPowerMax, 1)} kW` : '—'
        string avgValue = model.AvgPowerKw > 0
            ? string.Format(CultureInfo.CurrentCulture, "{0} {1}", ScalarFormatters.FormatNumber(model.AvgPowerKw, PowerDecimals), PowerUnit)
            : EmDash;

        // web: stats ? fmtInt(stats.totalDrives) : '—'
        string drivesValue = model.Stats is { } drivesStats
            ? ScalarFormatters.FormatNumber(drivesStats.TotalDrives, 0)
            : EmDash;

        // web: stats ? `${fmtNumber(stats.regenRatio * 100, 1)}%` : '—'
        string regenValue = model.Stats is { } regenStats
            ? string.Format(CultureInfo.CurrentCulture, "{0}%", ScalarFormatters.FormatNumber(regenStats.RegenRatio * 100, PercentDecimals))
            : EmDash;

        return new[]
        {
            BuildMetric("peakPower", ThermalLoadPanelRegistration.ZapGlyph, ThermalLoadPanelRegistration.PeakPowerBrushKey, PeakPowerKey, "Peak Power", peakValue, localizer),
            BuildMetric("avgPower", ThermalLoadPanelRegistration.TrendingUpGlyph, ThermalLoadPanelRegistration.AvgPowerBrushKey, AvgPowerKey, "Avg Power", avgValue, localizer),
            BuildMetric("drives", ThermalLoadPanelRegistration.ActivityGlyph, ThermalLoadPanelRegistration.DrivesBrushKey, DrivesKey, "Drives", drivesValue, localizer),
            BuildMetric("regenRatio", ThermalLoadPanelRegistration.ShieldGlyph, ThermalLoadPanelRegistration.RegenRatioBrushKey, RegenRatioKey, "Regen Ratio", regenValue, localizer),
        };
    }

    private static ThermalInlineMetric BuildMetric(
        string key,
        string glyph,
        string iconBrushKey,
        string labelKey,
        string labelFallback,
        string value,
        ILocalizer localizer)
    {
        string label = localizer.GetString(labelKey, labelFallback);
        return new ThermalInlineMetric(
            Key: key,
            Glyph: glyph,
            IconBrushKey: iconBrushKey,
            Label: label,
            Value: value,
            AutomationName: string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, value));
    }

    private static string BuildAutomationName(
        ThermalLoadPanelState state,
        string title,
        bool hasData,
        bool showChip,
        string chipText,
        string emptyMessage,
        string loadingLabel,
        string errorTitle)
    {
        switch (state)
        {
            case ThermalLoadPanelState.Loading:
                return loadingLabel;
            case ThermalLoadPanelState.Error:
                return errorTitle;
            case ThermalLoadPanelState.Empty:
                return emptyMessage;
            default:
                // Content states: the freshness chip (when present) leads, then the title; an empty body
                // (no sensors) appends the empty copy so the container name is never silent about it. The
                // per-bar / per-tile Narrator names carry the detailed read-outs.
                var parts = new List<string>(3);
                if (showChip)
                {
                    parts.Add(chipText);
                }

                parts.Add(title);
                if (!hasData)
                {
                    parts.Add(emptyMessage);
                }

                return string.Join(". ", parts);
        }
    }
}

/// <summary>
/// Canonical metadata for the <c>ThermalLoadPanel</c> feature surface — the native mirror of the web
/// component at <c>web/src/features/driving/components/drivetrain-health/ThermalLoadPanel.tsx</c> (and the
/// parent page's sensor definitions). Holds the stable id, the diagnostics slug, the Segoe Fluent glyphs
/// standing in for the web Lucide icons (<c>Activity</c> / <c>Zap</c> / <c>TrendingUp</c> / <c>Shield</c>),
/// the per-tile icon brush keys, and the four canonical thermal sensors (front / rear motor, inverter,
/// battery) the parent plots. UI-free so the metadata is asserted in tests.
/// </summary>
public static class ThermalLoadPanelRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "thermal-load-panel";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "ThermalLoadPanel";

    /// <summary>Segoe Fluent activity-line glyph (web <c>Activity</c>) — the header and the Drives tile.</summary>
    public const string ActivityGlyph = "\uE9D2";

    /// <summary>Segoe Fluent LightningBolt glyph (web <c>Zap</c>) — the Peak-Power tile.</summary>
    public const string ZapGlyph = "\uE945";

    /// <summary>Segoe Fluent trending-up glyph (web <c>TrendingUp</c>) — the Avg-Power tile.</summary>
    public const string TrendingUpGlyph = "\uE70E";

    /// <summary>Segoe Fluent shield glyph (web <c>Shield</c>) — the Regen-Ratio tile.</summary>
    public const string ShieldGlyph = "\uEA18";

    // The web tints the four tile icons purple / cyan / green / amber. The Windows token palette has no
    // purple, so each maps to the nearest semantic token brush (the glyphs already make the tiles distinct).

    /// <summary>Token brush key tinting the Peak-Power icon (web purple <c>Zap</c> → brand accent).</summary>
    public const string PeakPowerBrushKey = "TsColorAccentBrush";

    /// <summary>Token brush key tinting the Avg-Power icon (web cyan <c>TrendingUp</c> → info).</summary>
    public const string AvgPowerBrushKey = "TsColorInfoBrush";

    /// <summary>Token brush key tinting the Drives icon (web green <c>Activity</c> → success).</summary>
    public const string DrivesBrushKey = "TsColorSuccessBrush";

    /// <summary>Token brush key tinting the Regen-Ratio icon (web amber <c>Shield</c> → warning).</summary>
    public const string RegenRatioBrushKey = "TsColorWarningBrush";

    /// <summary>i18n key + English fallback + SI full-scale for the front-motor sensor (web parent).</summary>
    public const string FrontMotorLabelKey = "drivetrain.frontMotor";

    /// <summary>i18n key + English fallback + SI full-scale for the rear-motor sensor (web parent).</summary>
    public const string RearMotorLabelKey = "drivetrain.rearMotor";

    /// <summary>i18n key + English fallback + SI full-scale for the inverter sensor (web parent).</summary>
    public const string InverterLabelKey = "drivetrain.inverter";

    /// <summary>i18n key + English fallback + SI full-scale for the battery sensor (web parent).</summary>
    public const string BatteryLabelKey = "drivetrain.battery";

    private const double MotorMaxTempC = 150;    // web sensor.maxTemp (front + rear motor)
    private const double InverterMaxTempC = 120; // web sensor.maxTemp (inverter)
    private const double BatteryMaxTempC = 60;   // web sensor.maxTemp (battery)

    /// <summary>
    /// Build the four canonical thermal sensors the web parent plots — the native mirror of the
    /// drivetrain-health page's <c>sensors</c> memo (front motor, rear motor, inverter, battery, with their
    /// 150 / 150 / 120 / 60 °C full-scales). Each reading stays SI Celsius (null when the drivetrain-health
    /// payload omits it); the projection converts to the user's unit. This keeps the surface self-describing
    /// for hosts and tests while the parent owns the actual query.
    /// </summary>
    /// <param name="frontMotorC">Front-motor temperature in SI Celsius, or null.</param>
    /// <param name="rearMotorC">Rear-motor temperature in SI Celsius, or null.</param>
    /// <param name="inverterC">Inverter temperature in SI Celsius, or null.</param>
    /// <param name="batteryC">Battery temperature in SI Celsius, or null.</param>
    /// <returns>The four sensors in front / rear / inverter / battery order.</returns>
    public static IReadOnlyList<ThermalSensorInput> BuildSensors(
        double? frontMotorC,
        double? rearMotorC,
        double? inverterC,
        double? batteryC) => new[]
    {
        new ThermalSensorInput("frontMotor", FrontMotorLabelKey, "Front Motor", frontMotorC, MotorMaxTempC),
        new ThermalSensorInput("rearMotor", RearMotorLabelKey, "Rear Motor", rearMotorC, MotorMaxTempC),
        new ThermalSensorInput("inverter", InverterLabelKey, "Inverter", inverterC, InverterMaxTempC),
        new ThermalSensorInput("battery", BatteryLabelKey, "Battery", batteryC, BatteryMaxTempC),
    };
}

/// <summary>
/// PII-safe diagnostics for the <c>ThermalLoadPanel</c> surface (P1/S11 diagnostics contract). Records only
/// the operational <c>view.opened</c> event with the surface slug — never a temperature, power figure, drive
/// count or VIN — so a diagnostics line can never leak a user's drivetrain telemetry. Thread-safe.
/// </summary>
public sealed class ThermalLoadPanelDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public ThermalLoadPanelDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ThermalLoadPanel</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={Slug}");
    }

    private static string Slug => ThermalLoadPanelRegistration.Slug;
}
