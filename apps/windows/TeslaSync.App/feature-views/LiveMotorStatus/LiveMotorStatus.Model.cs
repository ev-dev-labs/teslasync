using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The lifecycle state a <see cref="LiveMotorStatusViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches required by the P2 surface contract. The web
/// child (web/src/features/driving/components/drivetrain-health/LiveMotorStatus.tsx) is a pure component whose
/// parent page owns the query lifecycle; the native surface owns its own cache-then-network read, so it
/// reproduces every state visibly (none is ever hidden). <see cref="Empty"/> mirrors the web
/// <c>hasData = motorLatest != null</c> gate — the "No live motor telemetry yet" surface.
/// </summary>
public enum LiveMotorStatusState
{
    /// <summary>Initial fetch with no cached snapshot — render the skeleton.</summary>
    Loading,

    /// <summary>A fresh snapshot (or non-stale cache) with a motor object to render the chips / metrics for.</summary>
    Loaded,

    /// <summary>No vehicle resolved or the response carried no motor object — render the empty surface.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render the readouts plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render the readouts plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The motor fields the surface reads from <c>GET /motor/latest?vehicle_id={id}</c> — the native mirror of the
/// exact <c>MotorSnapshot</c> slice the web <c>LiveMotorStatus</c> consumes. Each field is nullable so a missing
/// key projects to the em dash exactly like the web <c>!= null</c> guards; powers / torques / temperatures are
/// already SI (kW / Nm / °C) on the wire. A <see langword="null"/> parse result models the web <c>motorLatest</c>
/// being null/undefined (no motor object → the empty surface); an object with every field missing still parses to
/// a reading (all-null fields) so the panel renders with em dashes, matching the web <c>hasData</c> gate.
/// </summary>
/// <param name="ShiftState">Gear / shift state string, or null (web <c>shift_state</c>).</param>
/// <param name="PowerKw">Drive power in kilowatts, or null (web <c>power_kw</c>).</param>
/// <param name="RegenKw">Regen power in kilowatts, or null (web <c>regen_kw</c>).</param>
/// <param name="Source">Telemetry source label, or null (web <c>source</c>).</param>
/// <param name="MotorRpmFront">Front axle speed in rpm, or null (web <c>motor_rpm_front</c>).</param>
/// <param name="MotorRpmRear">Rear axle speed in rpm, or null (web <c>motor_rpm_rear</c>).</param>
/// <param name="TorqueNmFront">Front-axle torque in newton-metres, or null (web <c>torque_nm_front</c>).</param>
/// <param name="TorqueNmRear">Rear-axle torque in newton-metres, or null (web <c>torque_nm_rear</c>).</param>
/// <param name="MotorTempCFront">Front motor temperature in SI Celsius, or null (web <c>motor_temp_c_front</c>).</param>
/// <param name="MotorTempCRear">Rear motor temperature in SI Celsius, or null (web <c>motor_temp_c_rear</c>).</param>
/// <param name="InverterTempC">Inverter temperature in SI Celsius, or null (web <c>inverter_temp_c</c>).</param>
/// <param name="BatteryTempC">Battery temperature in SI Celsius, or null (web <c>battery_temp_c</c>).</param>
public sealed record MotorLiveReading(
    string? ShiftState,
    double? PowerKw,
    double? RegenKw,
    string? Source,
    double? MotorRpmFront,
    double? MotorRpmRear,
    double? TorqueNmFront,
    double? TorqueNmRear,
    double? MotorTempCFront,
    double? MotorTempCRear,
    double? InverterTempC,
    double? BatteryTempC)
{
    /// <summary>
    /// Project a <c>GET /motor/latest</c> response into the motor slice, mirroring the web reads. Returns
    /// <see langword="null"/> for a non-object body — the native analogue of the web <c>motorLatest</c> being
    /// null/undefined (<c>hasData == false</c> → the empty surface). An object with missing fields still parses
    /// (all-null) so the readouts render em dashes exactly like the web.
    /// </summary>
    public static MotorLiveReading? FromResponse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new MotorLiveReading(
            ShiftState: ReadString(root, "shift_state"),
            PowerKw: ReadDouble(root, "power_kw"),
            RegenKw: ReadDouble(root, "regen_kw"),
            Source: ReadString(root, "source"),
            MotorRpmFront: ReadDouble(root, "motor_rpm_front"),
            MotorRpmRear: ReadDouble(root, "motor_rpm_rear"),
            TorqueNmFront: ReadDouble(root, "torque_nm_front"),
            TorqueNmRear: ReadDouble(root, "torque_nm_rear"),
            MotorTempCFront: ReadDouble(root, "motor_temp_c_front"),
            MotorTempCRear: ReadDouble(root, "motor_temp_c_rear"),
            InverterTempC: ReadDouble(root, "inverter_temp_c"),
            BatteryTempC: ReadDouble(root, "battery_temp_c"));
    }

    // Read a finite number (JSON number or numeric string), or null when absent / non-finite.
    private static double? ReadDouble(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        double? parsed = v.ValueKind switch
        {
            JsonValueKind.Number => v.TryGetDouble(out var d) ? d : null,
            JsonValueKind.String => double.TryParse(
                v.GetString(),
                NumberStyles.Float | NumberStyles.AllowThousands,
                CultureInfo.InvariantCulture,
                out var s)
                ? s
                : null,
            _ => null,
        };

        return parsed is { } value && !double.IsNaN(value) && !double.IsInfinity(value) ? value : null;
    }

    private static string? ReadString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
}

/// <summary>
/// One render-ready chip in the top 2×4 grid — the native analogue of a web chip tile (Shift State / Power /
/// Regen / Source). The value is pre-formatted (value + unit, the raw label, or the em dash) so the view is a
/// thin renderer; <see cref="AutomationName"/> carries the Narrator label combining the label and value.
/// </summary>
/// <param name="Label">The localized chip label.</param>
/// <param name="ValueText">The pre-formatted value (e.g. "D", "12.50 kW", or the em dash).</param>
/// <param name="AutomationName">The Narrator name combining label and value.</param>
public sealed record LiveMotorChip(string Label, string ValueText, string AutomationName);

/// <summary>
/// One render-ready inline metric in the lower grid — the native analogue of a web <c>InlineMetric</c>
/// (F/R RPM, F/R Torque, F/R Motor Temp, Inverter / Battery Temp, HV Isolation). The value is pre-formatted so
/// the view is a thin renderer. <see cref="Status"/> is non-null only for the HV-Isolation metric, carrying the
/// web Shield threshold colour (the native-idiomatic equivalent of the web's tinted icon); a leading status dot
/// is rendered when it is set.
/// </summary>
/// <param name="Label">The localized metric label.</param>
/// <param name="ValueText">The pre-formatted value (e.g. "1,200 RPM", "45.00 °C", or the em dash).</param>
/// <param name="AutomationName">The Narrator name combining label and value.</param>
/// <param name="Status">Optional semantic status (HV-Isolation health); null for plain metrics.</param>
public sealed record LiveMotorMetric(string Label, string ValueText, string AutomationName, StatusKind? Status = null);

/// <summary>
/// The fully projected, render-ready view of the live-motor surface — the native analogue of everything the web
/// component computes before returning JSX (the four chips and the nine inline metrics, each already formatted /
/// unit-converted / em-dash-guarded). Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Title">The localized surface title ("Live Motor Status").</param>
/// <param name="AutomationName">The Narrator name for the surface (the title).</param>
/// <param name="Chips">The four top chips (Shift State / Power / Regen / Source).</param>
/// <param name="Metrics">The nine inline metrics (RPM / torque / temperatures / HV isolation).</param>
public sealed record LiveMotorStatusDisplay(
    string Title,
    string AutomationName,
    IReadOnlyList<LiveMotorChip> Chips,
    IReadOnlyList<LiveMotorMetric> Metrics);

/// <summary>
/// Canonical registry metadata for the Live Motor Status surface — the native anchor for the diagnostics slug
/// and the localized title. The web child has no registry entry (it is a page child); the native surface still
/// carries a stable id / slug for hosting and the P1/S11 diagnostics contract.
/// </summary>
public static class LiveMotorStatusRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "live-motor-status";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "LiveMotorStatus";

    /// <summary>i18n key for the surface title (web <c>drivetrain.liveMotor</c>).</summary>
    public const string TitleKey = "drivetrain.liveMotor";

    /// <summary>English fallback for the surface title.</summary>
    public const string TitleFallback = "Live Motor Status";

    /// <summary>i18n key for the empty-state message (web <c>drivetrain.noLiveMotor</c>).</summary>
    public const string EmptyKey = "drivetrain.noLiveMotor";

    /// <summary>English fallback for the empty-state message.</summary>
    public const string EmptyFallback = "No live motor telemetry yet";

    /// <summary>Localized surface title.</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(TitleKey, TitleFallback);
    }

    /// <summary>Localized empty-state message.</summary>
    public static string EmptyMessage(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(EmptyKey, EmptyFallback);
    }
}

/// <summary>
/// PII-safe diagnostics for the Live Motor Status surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a torque / temperature / rpm / isolation
/// value, VIN or vehicle id — so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class LiveMotorStatusDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public LiveMotorStatusDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=LiveMotorStatus</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={LiveMotorStatusRegistration.Slug}");
    }
}

/// <summary>
/// Pure projection from a raw <see cref="MotorLiveReading"/> (+ the live HV-isolation scalar) to the display
/// model — the native port of the web <c>LiveMotorStatus</c> JSX: the four chips, the nine inline metrics, the
/// SI→display temperature conversion at the render boundary, and the HV-Isolation threshold colouring. Powers /
/// torques are already SI on the wire; only temperatures are converted to the user's unit. Every label resolves
/// through the i18n facade. Kept UI-free so it is unit-tested without a XAML host.
/// </summary>
public static class LiveMotorStatusProjection
{
    /// <summary>Em dash shown when a readout has no value (web <c>'—'</c>).</summary>
    public const string EmDash = "\u2014";

    /// <summary>Kilo-ohm unit label for HV isolation (web <c>kΩ</c>).</summary>
    public const string KilohmUnit = "k\u03A9";

    /// <summary>Kilowatt unit label for power / regen (web literal <c>kW</c>).</summary>
    public const string KilowattUnit = "kW";

    /// <summary>Newton-metre unit label for torque (web literal <c>Nm</c>).</summary>
    public const string NewtonMetreUnit = "Nm";

    /// <summary>Rpm unit label for axle speed (web literal <c>RPM</c>).</summary>
    public const string RpmUnit = "RPM";

    /// <summary>Default fraction digits for general readouts (web <c>fmtNumber</c> global precision).</summary>
    public const int DefaultPrecision = 2;

    /// <summary>Fraction digits for rpm readouts (web <c>fmtInt</c>).</summary>
    public const int RpmPrecision = 0;

    /// <summary>At or above this isolation (kΩ) the Shield is green (web <c>&gt;= 500</c>).</summary>
    public const double IsolationGoodKohm = 500;

    /// <summary>At or above this isolation (kΩ) the Shield is amber (web <c>&gt;= 100</c>).</summary>
    public const double IsolationWarnKohm = 100;

    /// <summary>
    /// Classify the HV-isolation resistance into the Shield colour the web uses: null / ≤ 0 → muted
    /// (<see cref="StatusKind.Neutral"/>), ≥ 500 kΩ → green (<see cref="StatusKind.Success"/>), ≥ 100 kΩ → amber
    /// (<see cref="StatusKind.Warning"/>), otherwise red (<see cref="StatusKind.Danger"/>).
    /// </summary>
    public static StatusKind IsolationStatusFor(double? kohm)
    {
        if (kohm is not { } k || k <= 0 || double.IsNaN(k) || double.IsInfinity(k))
        {
            return StatusKind.Neutral;
        }

        if (k >= IsolationGoodKohm)
        {
            return StatusKind.Success;
        }

        return k >= IsolationWarnKohm ? StatusKind.Warning : StatusKind.Danger;
    }

    /// <summary>Project <paramref name="reading"/> (+ live isolation) in <paramref name="units"/>, localizing every label.</summary>
    public static LiveMotorStatusDisplay Project(
        MotorLiveReading reading,
        double? isolationResistanceKohm,
        UnitPref units,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(reading);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        int precision = Precision(units);
        string title = localizer.GetString(LiveMotorStatusRegistration.TitleKey, LiveMotorStatusRegistration.TitleFallback);

        var chips = new List<LiveMotorChip>(4)
        {
            Chip(localizer.GetString("drivetrain.shiftState", "Shift State"), Text(reading.ShiftState)),
            Chip(localizer.GetString("drivetrain.power", "Power"), WithUnit(reading.PowerKw, KilowattUnit, precision)),
            Chip(localizer.GetString("drivetrain.regen", "Regen"), WithUnit(reading.RegenKw, KilowattUnit, precision)),
            Chip(localizer.GetString("drivetrain.source", "Source"), Text(reading.Source)),
        };

        var metrics = new List<LiveMotorMetric>(9)
        {
            Metric(localizer.GetString("drivetrain.rpmFront", "Front Motor RPM"), WithUnit(reading.MotorRpmFront, RpmUnit, RpmPrecision)),
            Metric(localizer.GetString("drivetrain.rpmRear", "Rear Motor RPM"), WithUnit(reading.MotorRpmRear, RpmUnit, RpmPrecision)),
            Metric(localizer.GetString("drivetrain.torqueFront", "Front Torque"), WithUnit(reading.TorqueNmFront, NewtonMetreUnit, precision)),
            Metric(localizer.GetString("drivetrain.torqueRear", "Rear Torque"), WithUnit(reading.TorqueNmRear, NewtonMetreUnit, precision)),
            Metric(localizer.GetString("drivetrain.motorTempFront", "Front Motor Temp"), Temperature(reading.MotorTempCFront, units)),
            Metric(localizer.GetString("drivetrain.motorTempRear", "Rear Motor Temp"), Temperature(reading.MotorTempCRear, units)),
            Metric(localizer.GetString("drivetrain.inverterTemp", "Inverter Temp"), Temperature(reading.InverterTempC, units)),
            Metric(localizer.GetString("drivetrain.batteryTemp", "Battery Temp"), Temperature(reading.BatteryTempC, units)),
            Metric(
                localizer.GetString("drivetrain.isolationResistance", "HV Isolation"),
                Isolation(isolationResistanceKohm, units),
                IsolationStatusFor(isolationResistanceKohm)),
        };

        return new LiveMotorStatusDisplay(title, title, chips, metrics);
    }

    // Format a finite scalar with its unit (e.g. "12.50 kW"), or the em dash when null / non-finite.
    private static string WithUnit(double? value, string unit, int precision)
    {
        if (!IsFinite(value))
        {
            return EmDash;
        }

        return $"{ScalarFormatters.FormatNumber(value, NonNegative(precision))} {unit}";
    }

    // Format an SI Celsius temperature the way the web does — null → em dash, otherwise
    // fmtNumber(convertTempFromSI(c, unit)) plus the unit label (e.g. "45.00 °C").
    private static string Temperature(double? celsius, UnitPref units)
    {
        if (!IsFinite(celsius))
        {
            return EmDash;
        }

        double display = UnitConverters.TemperatureFromSi(celsius!.Value, units.Temperature);
        return $"{ScalarFormatters.FormatNumber(display, Precision(units))} {UnitLabels.Label(units.Temperature)}";
    }

    // Format the HV-isolation resistance the way the web does — only a positive finite value renders
    // (isolationResistance > 0), otherwise the em dash (e.g. "650.00 kΩ").
    private static string Isolation(double? kohm, UnitPref units)
    {
        if (kohm is not { } k || k <= 0 || !IsFinite(k))
        {
            return EmDash;
        }

        return $"{ScalarFormatters.FormatNumber(k, Precision(units))} {KilohmUnit}";
    }

    private static int Precision(UnitPref units) => NonNegative(units.Precision ?? DefaultPrecision);

    private static int NonNegative(int precision) => precision < 0 ? 0 : precision;

    private static bool IsFinite(double? value) =>
        value is { } d && !double.IsNaN(d) && !double.IsInfinity(d);

    private static string Text(string? value) => string.IsNullOrEmpty(value) ? EmDash : value;

    private static LiveMotorChip Chip(string label, string valueText) =>
        new(label, valueText, $"{label} {valueText}");

    private static LiveMotorMetric Metric(string label, string valueText, StatusKind? status = null) =>
        new(label, valueText, $"{label} {valueText}", status);
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;MotorLiveReading&gt;</c>, preserving every freshness flag (cached / refreshing / stale /
/// offline). A successful emission whose body carries no motor object collapses to
/// <see cref="RepositoryResult{T}.Empty(System.DateTimeOffset?)"/> — the native analogue of the web
/// <c>{hasData ? … : empty}</c> gate. Kept pure so the parse-and-preserve contract is unit-tested without a
/// network or cache.
/// </summary>
public static class LiveMotorStatusResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<MotorLiveReading> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        MotorLiveReading? Parse() => raw.HasValue ? MotorLiveReading.FromResponse(raw.Value) : null;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<MotorLiveReading>.Loading(),
            LoadStatus.Cached => Parse() is { } cached
                ? RepositoryResult<MotorLiveReading>.Cached(cached, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<MotorLiveReading>.Empty(raw.FetchedAt),
            LoadStatus.Refreshing => Parse() is { } refreshing
                ? RepositoryResult<MotorLiveReading>.Refreshing(refreshing, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<MotorLiveReading>.Empty(raw.FetchedAt),
            LoadStatus.Loaded => Parse() is { } loaded
                ? RepositoryResult<MotorLiveReading>.Loaded(loaded, raw.FetchedAt ?? DateTimeOffset.UtcNow)
                : RepositoryResult<MotorLiveReading>.Empty(raw.FetchedAt),
            LoadStatus.Empty => RepositoryResult<MotorLiveReading>.Empty(raw.FetchedAt),
            LoadStatus.Offline => Parse() is { } offline
                ? RepositoryResult<MotorLiveReading>.OfflineCached(offline, raw.FetchedAt!.Value, raw.Error!)
                : RepositoryResult<MotorLiveReading>.Empty(raw.FetchedAt),
            _ => RepositoryResult<MotorLiveReading>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
