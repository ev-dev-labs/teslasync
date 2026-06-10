using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Driving;

/// <summary>
/// The lifecycle state a <see cref="LiveMotorStatusViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches required by the P2 surface contract. The web
/// child (web/src/features/driving/components/driving-dynamics/LiveMotorStatus.tsx) is a pure component whose
/// parent page owns the <c>useMotorLatest</c> query; the native surface owns its own cache-then-network read, so
/// it reproduces every state visibly (none is ever hidden). <see cref="Empty"/> mirrors the web
/// <c>motorLatest ? … : &lt;EmptyState /&gt;</c> gate — the "Awaiting live motor data" surface.
/// </summary>
public enum LiveMotorStatusState
{
    /// <summary>Initial fetch with no cached snapshot — render the skeleton.</summary>
    Loading,

    /// <summary>A fresh snapshot (or non-stale cache) with a motor object to render the gauges for.</summary>
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
/// The motor fields the driving-dynamics surface reads from <c>GET /motor/latest?vehicle_id={id}</c> — the native
/// mirror of the exact <c>MotorSnapshot</c> slice the web <c>LiveMotorStatus</c> consumes (shift state, front rpm,
/// front/rear torque, front/rear motor temperature). Each field is nullable so a missing key falls back exactly
/// like the web (<c>?? 0</c> for the gauges, the "Awaiting data" caption for temperature). Torques are SI Nm and
/// temperatures SI °C on the wire. A <see langword="null"/> parse result models the web <c>motorLatest</c> being
/// null/undefined (no motor object → the empty surface); an object with every field missing still parses to a
/// reading (all-null) so the panel renders with the zero-fallback gauges, matching the web <c>hasData</c> gate.
/// </summary>
/// <param name="ShiftState">Gear / shift state string, or null (web <c>shift_state</c>).</param>
/// <param name="MotorRpmFront">Front axle speed in rpm, or null (web <c>motor_rpm_front</c>).</param>
/// <param name="TorqueNmFront">Front-axle torque in newton-metres, or null (web <c>torque_nm_front</c>).</param>
/// <param name="TorqueNmRear">Rear-axle torque in newton-metres, or null (web <c>torque_nm_rear</c>).</param>
/// <param name="MotorTempCFront">Front motor temperature in SI Celsius, or null (web <c>motor_temp_c_front</c>).</param>
/// <param name="MotorTempCRear">Rear motor temperature in SI Celsius, or null (web <c>motor_temp_c_rear</c>).</param>
public sealed record MotorLiveReading(
    string? ShiftState,
    double? MotorRpmFront,
    double? TorqueNmFront,
    double? TorqueNmRear,
    double? MotorTempCFront,
    double? MotorTempCRear)
{
    /// <summary>
    /// Project a <c>GET /motor/latest</c> response into the motor slice, mirroring the web reads. Returns
    /// <see langword="null"/> for a non-object body — the native analogue of the web <c>motorLatest</c> being
    /// null/undefined (<c>hasData == false</c> → the empty surface). An object with missing fields still parses
    /// (all-null) so the gauges render their zero fallbacks exactly like the web.
    /// </summary>
    public static MotorLiveReading? FromResponse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new MotorLiveReading(
            ShiftState: ReadString(root, "shift_state"),
            MotorRpmFront: ReadDouble(root, "motor_rpm_front"),
            TorqueNmFront: ReadDouble(root, "torque_nm_front"),
            TorqueNmRear: ReadDouble(root, "torque_nm_rear"),
            MotorTempCFront: ReadDouble(root, "motor_temp_c_front"),
            MotorTempCRear: ReadDouble(root, "motor_temp_c_rear"));
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
/// One render-ready radial gauge in the surface — the native analogue of a web <c>RadialGauge</c> tile (Torque /
/// Front RPM / Motor temperature). The value, max, unit and decimals drive the native gauge arc + centred text,
/// the <see cref="Caption"/> is the pre-formatted readout shown beneath it (the web's extra
/// <c>&lt;span&gt;</c>), and <see cref="Accent"/> selects the themed value-arc brush. <see cref="AutomationName"/>
/// carries the Narrator label combining the gauge name and its readout.
/// </summary>
/// <param name="Label">The localized gauge name (web <c>label</c>: "Torque" / "Front RPM" / "Motor").</param>
/// <param name="Value">The (display-unit) value the arc sweeps to.</param>
/// <param name="Max">The full-sweep maximum (web <c>max</c>).</param>
/// <param name="Unit">The unit suffix shown after the centred value (e.g. "Nm", "RPM", "°C").</param>
/// <param name="Decimals">Fixed decimals for the centred value (web's integer ? 0 : globalPrecision rule).</param>
/// <param name="Accent">The themed chart role for the value arc (web's per-gauge colour).</param>
/// <param name="Caption">The pre-formatted readout beneath the gauge (e.g. "430.00 Nm", "45.0°C", "Awaiting data").</param>
/// <param name="AutomationName">The Narrator name combining the gauge name and its readout.</param>
public sealed record LiveMotorGauge(
    string Label,
    double Value,
    double Max,
    string Unit,
    int Decimals,
    ChartRole Accent,
    string Caption,
    string AutomationName);

/// <summary>
/// The render-ready shift-state chip — the native analogue of the web <c>Badge</c> tile (a gear icon plus the
/// shift letter). <see cref="IsDrive"/> mirrors the web <c>shift_state === 'D'</c> success variant and
/// <see cref="Status"/> carries the themed colour. <see cref="ValueText"/> is the shift letter or the localized
/// "Unknown" fallback (web <c>shift_state ?? t('dynamics.unknown')</c>).
/// </summary>
/// <param name="Caption">The localized caption beneath the chip (web "Shift State").</param>
/// <param name="ValueText">The shift letter, or the localized "Unknown" fallback.</param>
/// <param name="IsDrive">True when the shift state is Drive (web success variant).</param>
/// <param name="Status">The themed status driving the chip colour.</param>
/// <param name="AutomationName">The Narrator name combining the caption and value.</param>
public sealed record LiveMotorShiftBadge(
    string Caption,
    string ValueText,
    bool IsDrive,
    StatusKind Status,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the live-motor surface — the native analogue of everything the web
/// <c>LiveMotorStatus</c> renders when <c>motorLatest</c> is present: the title, the three radial gauges (Torque,
/// Front RPM, Motor temperature) and the shift-state chip. Pure data so the projection is unit-tested without a
/// UI host.
/// </summary>
/// <param name="Title">The localized surface title ("Live Motor Status").</param>
/// <param name="AutomationName">The Narrator name for the surface (the title).</param>
/// <param name="Gauges">The three radial gauges (Torque / Front RPM / Motor temperature).</param>
/// <param name="ShiftBadge">The shift-state chip.</param>
public sealed record LiveMotorStatusDisplay(
    string Title,
    string AutomationName,
    IReadOnlyList<LiveMotorGauge> Gauges,
    LiveMotorShiftBadge ShiftBadge);

/// <summary>
/// Canonical registry metadata for the driving-dynamics Live Motor Status surface — the native anchor for the
/// diagnostics slug and the localized copy. The web child has no registry entry (it is a page child); the native
/// surface still carries a stable id / slug for hosting and the P1/S11 diagnostics contract. Mirrors the
/// <c>HeroGauges</c> precedent where the same surface name is namespaced per feature area.
/// </summary>
public static class LiveMotorStatusRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "live-motor-status";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (per the P1/S11 contract).</summary>
    public const string Slug = "LiveMotorStatus";

    /// <summary>i18n key for the surface title (web <c>dynamics.liveMotor</c>).</summary>
    public const string TitleKey = "dynamics.liveMotor";

    /// <summary>English fallback for the surface title.</summary>
    public const string TitleFallback = "Live Motor Status";

    /// <summary>i18n key for the empty-state message (web <c>dynamics.noLiveMotor</c>).</summary>
    public const string EmptyKey = "dynamics.noLiveMotor";

    /// <summary>English fallback for the empty-state message.</summary>
    public const string EmptyFallback = "Awaiting live motor data";

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
/// PII-safe diagnostics for the driving-dynamics Live Motor Status surface (P1/S11 diagnostics contract). Records
/// only the operational <c>view.opened</c> event with the surface slug — never a torque / temperature / rpm value,
/// VIN or vehicle id — so a diagnostics line can never leak fleet data. Thread-safe.
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
/// Pure projection from a raw <see cref="MotorLiveReading"/> to the display model — the native port of the web
/// driving-dynamics <c>LiveMotorStatus</c> JSX: the total-torque gauge (front + rear), the front-rpm gauge, the
/// max-motor-temperature gauge (SI→display conversion at the render boundary) and the shift-state chip. Torques /
/// rpm are already SI on the wire; only the temperature is converted to the user's unit. Every label resolves
/// through the i18n facade. Kept UI-free so it is unit-tested without a XAML host.
/// </summary>
public static class LiveMotorStatusProjection
{
    /// <summary>Full-sweep maximum for the total-torque gauge (web <c>max={1000}</c>).</summary>
    public const double TorqueMax = 1000;

    /// <summary>Full-sweep maximum for the front-rpm gauge (web <c>max={18000}</c>).</summary>
    public const double RpmMax = 18000;

    /// <summary>Full-sweep maximum for the motor-temperature gauge (web <c>max={200}</c>).</summary>
    public const double TempMax = 200;

    /// <summary>Newton-metre unit label for torque (web literal <c>Nm</c>).</summary>
    public const string NewtonMetreUnit = "Nm";

    /// <summary>Rpm unit label for axle speed (web literal <c>RPM</c>).</summary>
    public const string RpmUnit = "RPM";

    /// <summary>Default fraction digits for general readouts (web <c>fmtNumber</c> global precision).</summary>
    public const int DefaultPrecision = 2;

    /// <summary>Fraction digits for the rpm readout (web <c>fmtNumber(rpmFront, 0)</c>).</summary>
    public const int RpmPrecision = 0;

    /// <summary>Fraction digits for the temperature readout (web <c>fmtNumber(temp, 1)</c>).</summary>
    public const int TempPrecision = 1;

    /// <summary>Project <paramref name="reading"/> in <paramref name="units"/>, localizing every label.</summary>
    public static LiveMotorStatusDisplay Project(MotorLiveReading reading, UnitPref units, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(reading);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        // Web: torqueTotal = (torque_nm_front ?? 0) + (torque_nm_rear ?? 0).
        double torqueTotal = (reading.TorqueNmFront ?? 0) + (reading.TorqueNmRear ?? 0);

        // Web: rpmFront = motor_rpm_front ?? 0.
        double rpmFront = reading.MotorRpmFront ?? 0;

        // Web: motorTempC = max(front ?? -Inf, rear ?? -Inf), treated as null when not finite.
        double? motorTempC = MaxFinite(reading.MotorTempCFront, reading.MotorTempCRear);
        string tempLabel = UnitLabels.Label(units.Temperature);
        double motorTempDisplay = motorTempC is { } c ? UnitConverters.TemperatureFromSi(c, units.Temperature) : 0;

        var torque = new LiveMotorGauge(
            Label: localizer.GetString("dynamics.torque", "Torque"),
            Value: torqueTotal,
            Max: TorqueMax,
            Unit: NewtonMetreUnit,
            Decimals: GaugeDecimals(torqueTotal, TorqueMax, units),
            Accent: ChartRole.Power,
            Caption: $"{Number(torqueTotal, Precision(units))} {NewtonMetreUnit}",
            AutomationName: string.Empty);

        var rpm = new LiveMotorGauge(
            Label: localizer.GetString("dynamics.rpmFront", "Front RPM"),
            Value: rpmFront,
            Max: RpmMax,
            Unit: RpmUnit,
            Decimals: GaugeDecimals(rpmFront, RpmMax, units),
            Accent: ChartRole.Speed,
            Caption: $"{Number(rpmFront, RpmPrecision)} {RpmUnit}",
            AutomationName: string.Empty);

        // Web: the caption is fmtNumber(temp, 1) + tempUnit when finite, else t('dynamics.awaiting').
        string tempCaption = motorTempC is { } tc
            ? $"{Number(UnitConverters.TemperatureFromSi(tc, units.Temperature), TempPrecision)}{tempLabel}"
            : localizer.GetString("dynamics.awaiting", "Awaiting data");

        var temperature = new LiveMotorGauge(
            Label: localizer.GetString("dynamics.motorTemp", "Motor"),
            Value: motorTempDisplay,
            Max: TempMax,
            Unit: tempLabel,
            Decimals: GaugeDecimals(motorTempDisplay, TempMax, units),
            Accent: ChartRole.Temperature,
            Caption: tempCaption,
            AutomationName: string.Empty);

        var gauges = new List<LiveMotorGauge>(3)
        {
            WithName(torque),
            WithName(rpm),
            WithName(temperature),
        };

        bool isDrive = string.Equals(reading.ShiftState, "D", StringComparison.Ordinal);
        string shiftValue = string.IsNullOrEmpty(reading.ShiftState)
            ? localizer.GetString("dynamics.unknown", "Unknown")
            : reading.ShiftState;
        string shiftCaption = localizer.GetString("dynamics.shiftState", "Shift State");
        var shiftBadge = new LiveMotorShiftBadge(
            Caption: shiftCaption,
            ValueText: shiftValue,
            IsDrive: isDrive,
            Status: isDrive ? StatusKind.Success : StatusKind.Neutral,
            AutomationName: $"{shiftCaption} {shiftValue}");

        string title = localizer.GetString(LiveMotorStatusRegistration.TitleKey, LiveMotorStatusRegistration.TitleFallback);
        return new LiveMotorStatusDisplay(title, title, gauges, shiftBadge);
    }

    private static LiveMotorGauge WithName(LiveMotorGauge gauge) =>
        gauge with { AutomationName = $"{gauge.Label} {gauge.Caption}" };

    // Web RadialGauge: d = decimals ?? (Number.isInteger(clamped) ? 0 : globalPrecision); clamped = clamp(value, 0, max).
    private static int GaugeDecimals(double value, double max, UnitPref units)
    {
        double ceiling = max > 0 ? max : value;
        double clamped = Math.Clamp(value, 0, ceiling);
        bool isInteger = clamped == Math.Floor(clamped);
        return isInteger ? 0 : Precision(units);
    }

    private static double? MaxFinite(double? a, double? b)
    {
        if (a is { } x && b is { } y)
        {
            return Math.Max(x, y);
        }

        return a ?? b;
    }

    private static int Precision(UnitPref units) => NonNegative(units.Precision ?? DefaultPrecision);

    private static int NonNegative(int precision) => precision < 0 ? 0 : precision;

    private static string Number(double value, int precision) => ScalarFormatters.FormatNumber(value, precision);
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;MotorLiveReading&gt;</c>, preserving every freshness flag (cached / refreshing / stale /
/// offline). A successful emission whose body carries no motor object collapses to
/// <see cref="RepositoryResult{T}.Empty(System.DateTimeOffset?)"/> — the native analogue of the web
/// <c>{motorLatest ? … : empty}</c> gate. Kept pure so the parse-and-preserve contract is unit-tested without a
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
