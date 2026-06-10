using System.Globalization;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive render branch of the <c>TemperatureGauges</c> surface — the native union of the
/// states the P2 feature-view contract requires for the drivetrain-health temperature gauges
/// (web/src/features/driving/components/drivetrain-health/TemperatureGauges.tsx). The web component is a pure
/// presentational child (it takes a <c>sensors: TempSensor[]</c> prop and reads the active units from
/// <c>useUnits</c>; it performs no fetching), so the parent Drivetrain-Health page owns the query lifecycle and
/// supplies the active state. Every member maps onto a visible surface; none is ever hidden behind a
/// <c>{data &amp;&amp; …}</c> guard.
/// </summary>
public enum TemperatureGaugesState
{
    /// <summary>The drivetrain-health query is in flight and no sensors have arrived yet — skeleton chrome.</summary>
    Loading,

    /// <summary>At least one temperature sensor to render (the web fall-through) — the gauge grid.</summary>
    Ready,

    /// <summary>Resolved with no temperature sensors — a friendly empty state, never a blank box.</summary>
    Empty,

    /// <summary>The query failed with no usable snapshot — a retriable error surface.</summary>
    Error,

    /// <summary>Showing a snapshot older than the freshness window — gauges plus a stale chip.</summary>
    Stale,

    /// <summary>No connectivity — the last cached gauges plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// One drivetrain temperature sensor — the native analogue of the web <c>TempSensor</c>
/// (web/src/features/driving/components/drivetrain-health/constants.ts), narrowed to the fields
/// <c>TemperatureGauges</c> actually reads. <see cref="ValueCelsius"/> is the live reading in SI Celsius and is
/// <see langword="null"/> when the sensor is unavailable (web <c>value: number | null</c>);
/// <see cref="MaxTemperatureCelsius"/> is the gauge's full-sweep maximum, also SI Celsius (web <c>maxTemp</c>).
/// The web <c>color</c> and <c>icon</c> are intentionally omitted: <c>TemperatureGauges</c> derives the gauge
/// colour from <c>tempSeverityColor(value, maxTemp)</c> rather than the sensor's own <c>color</c>, and the icon
/// is the panel-level thermometer, not a per-gauge glyph. Pure data — no WinUI types.
/// </summary>
/// <param name="Key">Stable sensor id (web <c>key</c>), used as the gauge's React-style key.</param>
/// <param name="LabelKey">i18n key for the sensor label (web <c>labelKey</c>).</param>
/// <param name="DefaultLabel">English fallback label when the key is unresolved (web <c>defaultLabel</c>).</param>
/// <param name="ValueCelsius">Live reading in SI Celsius, or <see langword="null"/> when unavailable.</param>
/// <param name="MaxTemperatureCelsius">Full-sweep maximum in SI Celsius.</param>
public sealed record TemperatureGaugeSensor(
    string Key,
    string LabelKey,
    string DefaultLabel,
    double? ValueCelsius,
    double MaxTemperatureCelsius);

/// <summary>
/// The render-time data model the <c>TemperatureGauges</c> view binds to — the native analogue of the web
/// component's <c>sensors: TempSensor[]</c> prop plus the active <see cref="UnitPref"/> (web <c>useUnits</c>) and
/// the parent-supplied lifecycle <see cref="Status"/> and freshness flags. The view never performs HTTP; the
/// parent Drivetrain-Health state holder fills this in (the native P1/S8 seam). Sensor readings stay SI Celsius
/// — converted to the user's display unit only at projection time. Pure data so the projection is unit-tested
/// without a UI host.
/// </summary>
/// <param name="Status">The parent-supplied lifecycle state.</param>
/// <param name="Sensors">The temperature sensors to render, in display order.</param>
/// <param name="Units">The user's unit preference (only <see cref="UnitPref.Temperature"/> is read).</param>
/// <param name="UpdatedAt">Last successful update timestamp surfaced in the freshness chip.</param>
/// <param name="IsFetching">True while a background refresh is in flight.</param>
/// <param name="ErrorMessage">Already-localized error message for the error / offline surfaces, when set.</param>
public sealed record TemperatureGaugesModel(
    TemperatureGaugesState Status,
    IReadOnlyList<TemperatureGaugeSensor> Sensors,
    UnitPref Units,
    DateTimeOffset? UpdatedAt = null,
    bool IsFetching = false,
    string? ErrorMessage = null)
{
    /// <summary>The initial model: the query is in flight and no sensors have arrived yet.</summary>
    /// <param name="units">The user's unit preference; defaults to metric.</param>
    public static TemperatureGaugesModel Loading(UnitPref? units = null) =>
        new(TemperatureGaugesState.Loading, Array.Empty<TemperatureGaugeSensor>(), units ?? UnitPref.Metric);

    /// <summary>A resolved model with no sensors — the empty state.</summary>
    /// <param name="units">The user's unit preference; defaults to metric.</param>
    public static TemperatureGaugesModel Empty(UnitPref? units = null) =>
        new(TemperatureGaugesState.Empty, Array.Empty<TemperatureGaugeSensor>(), units ?? UnitPref.Metric);

    /// <summary>A hard-failure model (no usable snapshot) carrying an optional already-localized message.</summary>
    /// <param name="message">An already-localized error message, or null for the default copy.</param>
    /// <param name="units">The user's unit preference; defaults to metric.</param>
    public static TemperatureGaugesModel Failed(string? message = null, UnitPref? units = null) =>
        new(
            TemperatureGaugesState.Error,
            Array.Empty<TemperatureGaugeSensor>(),
            units ?? UnitPref.Metric,
            ErrorMessage: message);

    /// <summary>A fresh resolved model carrying the sensors to render.</summary>
    /// <param name="sensors">The temperature sensors.</param>
    /// <param name="units">The user's unit preference; defaults to metric.</param>
    /// <param name="updatedAt">The freshness timestamp.</param>
    /// <param name="isFetching">True while a background refresh is in flight.</param>
    public static TemperatureGaugesModel Ready(
        IReadOnlyList<TemperatureGaugeSensor> sensors,
        UnitPref? units = null,
        DateTimeOffset? updatedAt = null,
        bool isFetching = false)
    {
        ArgumentNullException.ThrowIfNull(sensors);
        return new(TemperatureGaugesState.Ready, sensors, units ?? UnitPref.Metric, updatedAt, isFetching);
    }

    /// <summary>A stale snapshot (older than the freshness window) carrying the cached sensors.</summary>
    /// <param name="sensors">The cached temperature sensors.</param>
    /// <param name="units">The user's unit preference; defaults to metric.</param>
    /// <param name="updatedAt">The freshness timestamp.</param>
    public static TemperatureGaugesModel Stale(
        IReadOnlyList<TemperatureGaugeSensor> sensors,
        UnitPref? units = null,
        DateTimeOffset? updatedAt = null)
    {
        ArgumentNullException.ThrowIfNull(sensors);
        return new(TemperatureGaugesState.Stale, sensors, units ?? UnitPref.Metric, updatedAt);
    }

    /// <summary>An offline snapshot (no connectivity) carrying the last cached sensors.</summary>
    /// <param name="sensors">The cached temperature sensors.</param>
    /// <param name="units">The user's unit preference; defaults to metric.</param>
    /// <param name="updatedAt">The freshness timestamp.</param>
    /// <param name="message">An already-localized offline message, or null for the default copy.</param>
    public static TemperatureGaugesModel Offline(
        IReadOnlyList<TemperatureGaugeSensor> sensors,
        UnitPref? units = null,
        DateTimeOffset? updatedAt = null,
        string? message = null)
    {
        ArgumentNullException.ThrowIfNull(sensors);
        return new(TemperatureGaugesState.Offline, sensors, units ?? UnitPref.Metric, updatedAt, ErrorMessage: message);
    }
}

/// <summary>
/// One projected, render-ready gauge consumed by the WinUI view — the native analogue of a single web
/// <c>RadialGauge</c> + its "Max" caption. <see cref="Fraction"/> is the clamped 0..1 sweep the web computes as
/// <c>clamp(displayValue, 0, displayMax) / displayMax</c> in <em>display</em> units (the web RadialGauge
/// receives already-converted values, so the sweep is unit-dependent for temperature — reproduced verbatim).
/// <see cref="ValueText"/> is the clamped centre readout (web <c>fmtNumber(clamped, d)</c>), <see cref="UnitLabel"/>
/// the small unit suffix, <see cref="MaxText"/> the "<c>Max: 150°C</c>" caption, and <see cref="Severity"/> maps
/// the web <c>tempSeverityColor</c> threshold (computed from the SI Celsius ratio) onto a semantic
/// <see cref="StatusKind"/>. Pure data.
/// </summary>
/// <param name="Key">Stable sensor id (the gauge's key).</param>
/// <param name="Label">Localized sensor label.</param>
/// <param name="ValueText">Clamped centre readout (number only, no unit).</param>
/// <param name="UnitLabel">Temperature unit suffix shown after the value (e.g. "°C").</param>
/// <param name="MaxText">The localized "Max" caption beneath the gauge (e.g. "Max: 150°C").</param>
/// <param name="Fraction">Clamped 0..1 gauge sweep in display units.</param>
/// <param name="Severity">Semantic colour the gauge arc and value are tinted with.</param>
/// <param name="AutomationName">Narrator name combining the label, value and max.</param>
public sealed record TemperatureGaugeDisplayItem(
    string Key,
    string Label,
    string ValueText,
    string UnitLabel,
    string MaxText,
    double Fraction,
    StatusKind Severity,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the temperature gauges — the native analogue of everything the web
/// <c>TemperatureGauges</c> renders. Holds the active <see cref="State"/>, the localized <see cref="Title"/>, the
/// projected <see cref="Gauges"/>, the freshness chip copy + status (shown only for
/// <see cref="TemperatureGaugesState.Stale"/> / <see cref="TemperatureGaugesState.Offline"/>), the empty /
/// loading / error copy and retry label, the freshness timestamp + fetching flag, and the surface
/// <see cref="AutomationName"/>. Pure data so every branch is asserted headlessly.
/// </summary>
public sealed record TemperatureGaugesDisplay(
    TemperatureGaugesState State,
    string Title,
    IReadOnlyList<TemperatureGaugeDisplayItem> Gauges,
    bool ShowFreshnessChip,
    string FreshnessChipText,
    StatusKind FreshnessChipStatus,
    string EmptyMessage,
    string LoadingLabel,
    string ErrorTitle,
    string ErrorMessage,
    string RetryLabel,
    DateTimeOffset? UpdatedAt,
    bool IsFetching,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="TemperatureGaugesModel"/> to its <see cref="TemperatureGaugesDisplay"/> — the
/// native port of web/src/features/driving/components/drivetrain-health/TemperatureGauges.tsx (plus its
/// <c>tempSeverityColor</c> helper). Branch precedence mirrors the web parent's data lifecycle
/// (loading → error → empty → freshness → ready); a fresh snapshot with no sensors collapses to a friendly empty
/// state, while a stale / offline snapshot keeps its cached gauges under a freshness chip. SI Celsius is
/// converted to the user's display unit here (and only here, via <see cref="UnitConverters.TemperatureFromSi"/>);
/// every number is produced by <see cref="NumberFormatting"/> (the 1:1 port of the web <c>fmtNumber</c>), the
/// gauge sweep is clamped in display units exactly as the web RadialGauge, and the severity threshold is computed
/// from the raw SI Celsius ratio exactly as the web <c>tempSeverityColor</c>. Every label resolves through the
/// i18n facade using the same keys the web feeds into <c>t(...)</c>. No WinUI types — unit-tested without a UI
/// host.
/// </summary>
public static class TemperatureGaugesProjection
{
    /// <summary>Ratio at or above which a sensor reads "critical" (web <c>tempSeverityColor</c> ≥ 0.85).</summary>
    public const double CriticalRatio = 0.85;

    /// <summary>Ratio at or above which a sensor reads "warning" (web <c>tempSeverityColor</c> ≥ 0.65).</summary>
    public const double WarningRatio = 0.65;

    /// <summary>
    /// Decimal places for the gauge centre readout of a non-integer value — the web RadialGauge's
    /// <c>getGlobalPrecision()</c> default (2). An integer value always renders with no decimals (web
    /// <c>Number.isInteger(clamped) ? 0 : …</c>); a host may override via <see cref="UnitPref.Precision"/>.
    /// </summary>
    public const int DefaultValuePrecision = 2;

    private const int MaxCaptionPrecision = 0;

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web prop plus units + lifecycle).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <returns>The render-ready display model.</returns>
    public static TemperatureGaugesDisplay Project(TemperatureGaugesModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        TemperatureGaugesState state = SelectState(model);

        string title = localizer.GetString("drivetrain.tempGauges", "Temperature Gauges");
        string maxLabel = localizer.GetString("drivetrain.maxLabel", "Max");
        List<TemperatureGaugeDisplayItem> gauges = BuildGauges(model, maxLabel, localizer);

        bool showChip = state is TemperatureGaugesState.Stale or TemperatureGaugesState.Offline;
        string chipText = state switch
        {
            TemperatureGaugesState.Offline => localizer.GetString("common.offline", "Offline"),
            TemperatureGaugesState.Stale => localizer.GetString("common.stale", "Stale"),
            _ => string.Empty,
        };
        StatusKind chipStatus = state == TemperatureGaugesState.Offline ? StatusKind.Danger : StatusKind.Warning;

        string emptyMessage = localizer.GetString("drivetrain.noData", "No drivetrain data");
        string loadingLabel = localizer.GetString("common.loading", "Loading");
        string errorTitle = localizer.GetString("drivetrain.tempGaugesError", "Couldn't load temperature gauges");
        string errorMessage = string.IsNullOrWhiteSpace(model.ErrorMessage)
            ? localizer.GetString(
                "drivetrain.tempGaugesErrorMessage",
                "We couldn't load the temperature gauges. Please try again.")
            : model.ErrorMessage!;
        string retryLabel = localizer.GetString("common.retry", "Retry");

        string automationName = BuildAutomationName(
            state, title, showChip, chipText, gauges, emptyMessage, loadingLabel, errorTitle);

        return new TemperatureGaugesDisplay(
            State: state,
            Title: title,
            Gauges: gauges,
            ShowFreshnessChip: showChip,
            FreshnessChipText: chipText,
            FreshnessChipStatus: chipStatus,
            EmptyMessage: emptyMessage,
            LoadingLabel: loadingLabel,
            ErrorTitle: errorTitle,
            ErrorMessage: errorMessage,
            RetryLabel: retryLabel,
            UpdatedAt: model.UpdatedAt,
            IsFetching: model.IsFetching,
            AutomationName: automationName);
    }

    /// <summary>
    /// Maps a sensor reading to its semantic severity — the native port of the web <c>tempSeverityColor</c>
    /// (helpers.ts): a null reading is unknown (<see cref="StatusKind.Neutral"/>, web grey), otherwise the SI
    /// Celsius ratio <c>value / max</c> selects critical (≥ <see cref="CriticalRatio"/>), warning
    /// (≥ <see cref="WarningRatio"/>) or good. A non-positive maximum is treated as unknown rather than dividing
    /// by zero.
    /// </summary>
    /// <param name="celsius">The sensor reading in SI Celsius, or null when unavailable.</param>
    /// <param name="maxCelsius">The sensor's full-sweep maximum in SI Celsius.</param>
    /// <returns>The semantic severity the gauge is tinted with.</returns>
    public static StatusKind SeverityFor(double? celsius, double maxCelsius)
    {
        if (celsius is not { } value || maxCelsius <= 0)
        {
            return StatusKind.Neutral;
        }

        double ratio = value / maxCelsius;
        if (ratio >= CriticalRatio)
        {
            return StatusKind.Danger;
        }

        return ratio >= WarningRatio ? StatusKind.Warning : StatusKind.Success;
    }

    // Branch precedence from the web parent's data lifecycle. Loading / Error / Empty / Stale / Offline come
    // straight from the parent's classification; a fresh "Ready" snapshot with no sensors has nothing to gauge
    // and collapses to the friendly empty state, while a stale / offline snapshot keeps its cached gauges.
    private static TemperatureGaugesState SelectState(TemperatureGaugesModel model) => model.Status switch
    {
        TemperatureGaugesState.Loading => TemperatureGaugesState.Loading,
        TemperatureGaugesState.Error => TemperatureGaugesState.Error,
        TemperatureGaugesState.Empty => TemperatureGaugesState.Empty,
        TemperatureGaugesState.Stale => TemperatureGaugesState.Stale,
        TemperatureGaugesState.Offline => TemperatureGaugesState.Offline,
        _ => model.Sensors.Count > 0 ? TemperatureGaugesState.Ready : TemperatureGaugesState.Empty,
    };

    private static List<TemperatureGaugeDisplayItem> BuildGauges(
        TemperatureGaugesModel model,
        string maxLabel,
        ILocalizer localizer)
    {
        TemperatureUnit unit = model.Units.Temperature;
        string unitLabel = UnitLabels.Label(unit);

        var gauges = new List<TemperatureGaugeDisplayItem>(model.Sensors.Count);
        foreach (TemperatureGaugeSensor sensor in model.Sensors)
        {
            gauges.Add(BuildGauge(sensor, model.Units, unit, unitLabel, maxLabel, localizer));
        }

        return gauges;
    }

    private static TemperatureGaugeDisplayItem BuildGauge(
        TemperatureGaugeSensor sensor,
        UnitPref units,
        TemperatureUnit unit,
        string unitLabel,
        string maxLabel,
        ILocalizer localizer)
    {
        string label = localizer.GetString(sensor.LabelKey, sensor.DefaultLabel);

        double displayMax = UnitConverters.TemperatureFromSi(sensor.MaxTemperatureCelsius, unit);

        // web: value={sensor.value !== null ? toTemperatureDisplay(sensor.value) : 0}
        double displayValue = sensor.ValueCelsius is { } celsius
            ? UnitConverters.TemperatureFromSi(celsius, unit)
            : 0;

        // web RadialGauge: clamped = Math.max(0, Math.min(value, max)); fraction = clamped / max.
        double clamped = displayMax > 0 ? Math.Clamp(displayValue, 0, displayMax) : Math.Max(0, displayValue);
        double fraction = displayMax > 0 ? clamped / displayMax : 0;

        int valueDecimals = IsInteger(clamped) ? 0 : (units.Precision ?? DefaultValuePrecision);
        string valueText = NumberFormatting.Format(clamped, units.Locale, valueDecimals);

        // web caption: {maxLabel}: {fmtNumber(displayMax, 0)}{unit}
        string maxValueText = NumberFormatting.Format(displayMax, units.Locale, MaxCaptionPrecision);
        string maxText = string.Format(CultureInfo.InvariantCulture, "{0}: {1}{2}", maxLabel, maxValueText, unitLabel);

        StatusKind severity = SeverityFor(sensor.ValueCelsius, sensor.MaxTemperatureCelsius);

        string automationName = string.Format(
            CultureInfo.InvariantCulture, "{0}, {1}{2}, {3}", label, valueText, unitLabel, maxText);

        return new TemperatureGaugeDisplayItem(
            sensor.Key, label, valueText, unitLabel, maxText, fraction, severity, automationName);
    }

    private static bool IsInteger(double value) => Math.Abs(value - Math.Round(value)) < 1e-9;

    private static string BuildAutomationName(
        TemperatureGaugesState state,
        string title,
        bool showChip,
        string chipText,
        IReadOnlyList<TemperatureGaugeDisplayItem> gauges,
        string emptyMessage,
        string loadingLabel,
        string errorTitle)
    {
        switch (state)
        {
            case TemperatureGaugesState.Loading:
                return $"{title}. {loadingLabel}";
            case TemperatureGaugesState.Empty:
                return $"{title}. {emptyMessage}";
            case TemperatureGaugesState.Error:
                return $"{title}. {errorTitle}";
            default:
                var parts = new List<string> { title };
                if (showChip)
                {
                    parts.Add(chipText);
                }

                foreach (TemperatureGaugeDisplayItem gauge in gauges)
                {
                    parts.Add(gauge.AutomationName);
                }

                return string.Join(". ", parts);
        }
    }
}

/// <summary>
/// Builds the four canonical drivetrain temperature sensors the web Drivetrain-Health page feeds into
/// <c>TemperatureGauges</c> (web/src/features/driving/pages/DrivetrainHealthPage.tsx <c>tempSensors</c> memo):
/// front motor, rear motor, inverter and battery, with the same i18n keys, default labels and full-sweep maxima
/// (150 °C motors, 120 °C inverter, 60 °C battery). Centralised so the host (and the headless tests) build the
/// canonical sensor set without re-declaring the web's constants. Pure data — no WinUI types.
/// </summary>
public static class DrivetrainTemperatureSensors
{
    /// <summary>Full-sweep maximum for each motor, in SI Celsius (web <c>maxTemp: 150</c>).</summary>
    public const double MotorMaxCelsius = 150;

    /// <summary>Full-sweep maximum for the inverter, in SI Celsius (web <c>maxTemp: 120</c>).</summary>
    public const double InverterMaxCelsius = 120;

    /// <summary>Full-sweep maximum for the battery, in SI Celsius (web <c>maxTemp: 60</c>).</summary>
    public const double BatteryMaxCelsius = 60;

    /// <summary>
    /// Builds the canonical front-motor / rear-motor / inverter / battery sensor set from live SI Celsius
    /// readings (any of which may be null when unavailable), in the web's fixed render order.
    /// </summary>
    /// <param name="frontMotorCelsius">Front-motor reading in SI Celsius, or null.</param>
    /// <param name="rearMotorCelsius">Rear-motor reading in SI Celsius, or null.</param>
    /// <param name="inverterCelsius">Inverter reading in SI Celsius, or null.</param>
    /// <param name="batteryCelsius">Battery reading in SI Celsius, or null.</param>
    /// <returns>The four sensors, in front-motor → rear-motor → inverter → battery order.</returns>
    public static IReadOnlyList<TemperatureGaugeSensor> Build(
        double? frontMotorCelsius,
        double? rearMotorCelsius,
        double? inverterCelsius,
        double? batteryCelsius) =>
    [
        new TemperatureGaugeSensor("frontMotor", "drivetrain.frontMotor", "Front Motor", frontMotorCelsius, MotorMaxCelsius),
        new TemperatureGaugeSensor("rearMotor", "drivetrain.rearMotor", "Rear Motor", rearMotorCelsius, MotorMaxCelsius),
        new TemperatureGaugeSensor("inverter", "drivetrain.inverter", "Inverter", inverterCelsius, InverterMaxCelsius),
        new TemperatureGaugeSensor("battery", "drivetrain.battery", "Battery", batteryCelsius, BatteryMaxCelsius),
    ];
}

/// <summary>
/// PII-safe diagnostics for the <c>TemperatureGauges</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a temperature value, sensor reading or
/// VIN — so a diagnostics line can never leak drivetrain telemetry. Thread-safe.
/// </summary>
public sealed class TemperatureGaugesDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">Optional sink invoked with each diagnostics line.</param>
    public TemperatureGaugesDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=TemperatureGauges</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={TemperatureGaugesRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>TemperatureGauges</c> feature surface — the native mirror of the web component
/// at <c>web/src/features/driving/components/drivetrain-health/TemperatureGauges.tsx</c>.
/// </summary>
public static class TemperatureGaugesRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "TemperatureGauges";
}
