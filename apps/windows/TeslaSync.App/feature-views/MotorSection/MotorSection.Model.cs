using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The lifecycle state a <see cref="MotorSectionViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches required by the P2 surface contract. The web
/// child (web/src/features/vehicles/components/vehicle-detail/MotorSection.tsx) is a pure component whose parent
/// (the Vehicle-Detail page) owns the query lifecycle; the native surface owns its own cache-then-network read,
/// so it reproduces every state visibly (none is ever hidden). <see cref="Empty"/> mirrors the web
/// <c>motorData ? … : &lt;EmptyState /&gt;</c> gate — the "No motor data available" surface that shows when the
/// motor snapshot is null/undefined.
/// </summary>
public enum MotorSectionState
{
    /// <summary>Initial fetch with no cached snapshot — render the skeleton.</summary>
    Loading,

    /// <summary>A fresh snapshot (or non-stale cache) with a motor object to render the metric cards for.</summary>
    Loaded,

    /// <summary>No vehicle resolved or the response carried no motor object — render the empty surface.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render the cards plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render the cards plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The motor fields the surface reads from <c>GET /motor/latest?vehicle_id={id}</c> — the native mirror of the
/// exact <c>MotorSnapshot</c> slice the web <c>MotorSection</c> consumes. Each field is nullable so a missing key
/// projects to the em dash exactly like the web <c>!= null</c> guards; torques are already SI (Nm), currents are
/// amperes, voltages are volts, axle speeds are rpm and motor temperatures are SI Celsius on the wire. A
/// <see langword="null"/> parse result models the web <c>motorData</c> being null/undefined (no motor object → the
/// empty surface); an object with every field missing still parses to a reading (all-null fields) so the grid
/// renders with em dashes, matching the web's <c>motorData ? grid : empty</c> gate (which keys only off the
/// snapshot's presence, not its contents).
/// </summary>
/// <param name="ShiftState">Gear / shift state string, or null (web <c>shift_state</c>).</param>
/// <param name="VbatFront">Front battery voltage in volts, or null (web <c>vbat_front</c>).</param>
/// <param name="VbatRear">Rear battery voltage in volts, or null (web <c>vbat_rear</c>).</param>
/// <param name="MotorCurrentFront">Front motor current in amperes, or null (web <c>motor_current_front</c>).</param>
/// <param name="TorqueNmFront">Front-axle torque in newton-metres, or null (web <c>torque_nm_front</c>).</param>
/// <param name="TorqueNmRear">Rear-axle torque in newton-metres, or null (web <c>torque_nm_rear</c>).</param>
/// <param name="MotorRpmFront">Front axle speed in rpm, or null (web <c>motor_rpm_front</c>).</param>
/// <param name="MotorRpmRear">Rear axle speed in rpm, or null (web <c>motor_rpm_rear</c>).</param>
/// <param name="MotorTempCFront">Front motor temperature in SI Celsius, or null (web <c>motor_temp_c_front</c>).</param>
/// <param name="MotorTempCRear">Rear motor temperature in SI Celsius, or null (web <c>motor_temp_c_rear</c>).</param>
public sealed record MotorSectionReading(
    string? ShiftState,
    double? VbatFront,
    double? VbatRear,
    double? MotorCurrentFront,
    double? TorqueNmFront,
    double? TorqueNmRear,
    double? MotorRpmFront,
    double? MotorRpmRear,
    double? MotorTempCFront,
    double? MotorTempCRear)
{
    /// <summary>
    /// Pack voltage proxy the web surfaces — <c>vbat_rear ?? vbat_front</c> (the rear bus is preferred, falling
    /// back to the front), or null when neither axle reported a voltage.
    /// </summary>
    public double? PackVoltage => VbatRear ?? VbatFront;

    /// <summary>
    /// Peak motor temperature the web computes — <c>Math.max(front ?? -Infinity, rear ?? -Infinity)</c> guarded by
    /// <c>isFinite</c>: the larger of the two readings, or null when neither axle reported a temperature.
    /// </summary>
    public double? PeakMotorTempC => (MotorTempCFront, MotorTempCRear) switch
    {
        ({ } front, { } rear) => Math.Max(front, rear),
        ({ } front, null) => front,
        (null, { } rear) => rear,
        _ => null,
    };

    /// <summary>
    /// Project a <c>GET /motor/latest</c> response into the motor slice, mirroring the web reads. Returns
    /// <see langword="null"/> for a non-object body — the native analogue of the web <c>motorData</c> being
    /// null/undefined (the <c>&lt;EmptyState /&gt;</c> branch). An object with missing fields still parses
    /// (all-null) so the grid renders em dashes exactly like the web.
    /// </summary>
    public static MotorSectionReading? FromResponse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new MotorSectionReading(
            ShiftState: ReadString(root, "shift_state"),
            VbatFront: ReadDouble(root, "vbat_front"),
            VbatRear: ReadDouble(root, "vbat_rear"),
            MotorCurrentFront: ReadDouble(root, "motor_current_front"),
            TorqueNmFront: ReadDouble(root, "torque_nm_front"),
            TorqueNmRear: ReadDouble(root, "torque_nm_rear"),
            MotorRpmFront: ReadDouble(root, "motor_rpm_front"),
            MotorRpmRear: ReadDouble(root, "motor_rpm_rear"),
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
/// One render-ready metric card in the powertrain grid — the native analogue of a web <c>MetricCard</c>
/// (Shift State / Pack Voltage / Motor Current / Torque / RPM / Motor Temp). The value is pre-formatted (value +
/// unit, the raw label, or the em dash) so the view is a thin renderer. <see cref="AccentBrushKey"/> carries the
/// token brush key for the card's accent rail (the native-idiomatic equivalent of the web tinted icon — the web
/// <c>color</c> prop maps onto a semantic accent token), and <see cref="AutomationName"/> carries the Narrator
/// label combining the label and value.
/// </summary>
/// <param name="Label">The localized card label.</param>
/// <param name="ValueText">The pre-formatted value (e.g. "D", "395.00 V", "1,200", or the em dash).</param>
/// <param name="AccentBrushKey">Token brush key for the card accent rail.</param>
/// <param name="AutomationName">The Narrator name combining label and value.</param>
public sealed record MotorSectionCard(string Label, string ValueText, string AccentBrushKey, string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the powertrain surface — the native analogue of everything the web
/// component computes before returning JSX (the eight metric cards, each already formatted / unit-converted /
/// em-dash-guarded). Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Title">The localized surface title ("Powertrain").</param>
/// <param name="AutomationName">The Narrator name for the surface (the title).</param>
/// <param name="Cards">The eight metric cards in web order.</param>
public sealed record MotorSectionDisplay(
    string Title,
    string AutomationName,
    IReadOnlyList<MotorSectionCard> Cards);

/// <summary>
/// Canonical registry metadata for the powertrain surface — the native anchor for the diagnostics slug and the
/// localized title / empty message. The web child has no registry entry (it is a page child); the native surface
/// still carries a stable id / slug for hosting and the P1/S11 diagnostics contract.
/// </summary>
public static class MotorSectionRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "motor-section";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "MotorSection";

    /// <summary>i18n key for the surface title (web <c>vehicles.detail.motor</c>).</summary>
    public const string TitleKey = "vehicles.detail.motor";

    /// <summary>English fallback for the surface title.</summary>
    public const string TitleFallback = "Powertrain";

    /// <summary>i18n key for the empty-state message (web <c>vehicles.detail.noMotorData</c>).</summary>
    public const string EmptyKey = "vehicles.detail.noMotorData";

    /// <summary>English fallback for the empty-state message.</summary>
    public const string EmptyFallback = "No motor data available";

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
/// PII-safe diagnostics for the powertrain surface (P1/S11 diagnostics contract). Records only the operational
/// <c>view.opened</c> event with the surface slug — never a torque / voltage / current / rpm / temperature value,
/// VIN or vehicle id — so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class MotorSectionDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public MotorSectionDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=MotorSection</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={MotorSectionRegistration.Slug}");
    }
}

/// <summary>
/// Pure projection from a raw <see cref="MotorSectionReading"/> to the display model — the native port of the web
/// <c>MotorSection</c> JSX: the eight metric cards, the <c>vbat_rear ?? vbat_front</c> pack-voltage fallback, the
/// <c>Math.max</c> peak-temperature rollup, the SI→display temperature conversion at the render boundary, and the
/// per-card accent colours. Torques (Nm), currents (A), voltages (V) and axle speeds (rpm) are already on the wire
/// in their display units; only the peak motor temperature is converted to the user's preferred unit. Every label
/// resolves through the i18n facade. Kept UI-free so it is unit-tested without a XAML host.
/// </summary>
public static class MotorSectionProjection
{
    /// <summary>Em dash shown when a readout has no value (web <c>'—'</c>).</summary>
    public const string EmDash = "\u2014";

    /// <summary>Volt unit label for pack voltage (web literal <c>V</c>).</summary>
    public const string VoltUnit = "V";

    /// <summary>Ampere unit label for motor current (web literal <c>A</c>).</summary>
    public const string AmpereUnit = "A";

    /// <summary>Newton-metre unit label for torque (web literal <c>Nm</c>).</summary>
    public const string NewtonMetreUnit = "Nm";

    /// <summary>Default fraction digits for general readouts (web <c>fmtNumber</c> global precision).</summary>
    public const int DefaultPrecision = 2;

    /// <summary>Fraction digits for rpm readouts (web <c>fmtInt</c>).</summary>
    public const int RpmPrecision = 0;

    // Accent token keys mapping the web MetricCard `color` prop onto the shared semantic accent tokens, exactly as
    // the sibling tool / panel surfaces do: web color="cyan" -> info accent, "purple" -> the default accent (the
    // theme's purple), "green" -> the success accent.
    private const string CyanAccent = "TsColorInfoBrush";
    private const string PurpleAccent = "TsColorAccentBrush";
    private const string GreenAccent = "TsColorSuccessBrush";

    /// <summary>Project <paramref name="reading"/> in <paramref name="units"/>, localizing every label.</summary>
    /// <param name="reading">The parsed motor reading.</param>
    /// <param name="units">The user's unit preference (web <c>useUnits</c>); only temperature is read.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <returns>The render-ready display model (eight cards in web order).</returns>
    public static MotorSectionDisplay Project(MotorSectionReading reading, UnitPref units, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(reading);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        int precision = Precision(units);
        string title = localizer.GetString(MotorSectionRegistration.TitleKey, MotorSectionRegistration.TitleFallback);

        var cards = new List<MotorSectionCard>(8)
        {
            Card(localizer.GetString("vehicles.detail.shiftState", "Shift State"), Text(reading.ShiftState), CyanAccent),
            Card(localizer.GetString("vehicles.detail.packVoltage", "Pack Voltage"), WithUnit(reading.PackVoltage, VoltUnit, precision), PurpleAccent),
            Card(localizer.GetString("vehicles.detail.motorCurrentFront", "Motor Current (F)"), WithUnit(reading.MotorCurrentFront, AmpereUnit, precision), GreenAccent),
            Card(localizer.GetString("vehicles.detail.torqueFront", "Front Torque"), WithUnit(reading.TorqueNmFront, NewtonMetreUnit, precision), CyanAccent),
            Card(localizer.GetString("vehicles.detail.torqueRear", "Rear Torque"), WithUnit(reading.TorqueNmRear, NewtonMetreUnit, precision), PurpleAccent),
            Card(localizer.GetString("vehicles.detail.rpmFront", "Front RPM"), Count(reading.MotorRpmFront), CyanAccent),
            Card(localizer.GetString("vehicles.detail.rpmRear", "Rear RPM"), Count(reading.MotorRpmRear), PurpleAccent),
            Card(localizer.GetString("vehicles.detail.motorTemp", "Motor Temp (peak)"), Temperature(reading.PeakMotorTempC, units), GreenAccent),
        };

        return new MotorSectionDisplay(title, title, cards);
    }

    // Format a finite scalar with its unit (e.g. "395.00 V"), or the em dash when null / non-finite (web
    // `value != null ? `${fmtNumber(value)} unit` : '—'`).
    private static string WithUnit(double? value, string unit, int precision)
    {
        if (!IsFinite(value))
        {
            return EmDash;
        }

        return $"{ScalarFormatters.FormatNumber(value, NonNegative(precision))} {unit}";
    }

    // Format an integer count with no unit (web `fmtInt(value)` for the RPM cards), or the em dash when null.
    private static string Count(double? value)
    {
        if (!IsFinite(value))
        {
            return EmDash;
        }

        return ScalarFormatters.FormatNumber(value, RpmPrecision);
    }

    // Format an SI Celsius temperature the way the web does — null -> em dash, otherwise
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

    private static int Precision(UnitPref units) => NonNegative(units.Precision ?? DefaultPrecision);

    private static int NonNegative(int precision) => precision < 0 ? 0 : precision;

    private static bool IsFinite(double? value) =>
        value is { } d && !double.IsNaN(d) && !double.IsInfinity(d);

    private static string Text(string? value) => string.IsNullOrEmpty(value) ? EmDash : value;

    private static MotorSectionCard Card(string label, string valueText, string accentBrushKey) =>
        new(label, valueText, accentBrushKey, $"{label} {valueText}");
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;MotorSectionReading&gt;</c>, preserving every freshness flag (cached / refreshing /
/// stale / offline). A successful emission whose body carries no motor object collapses to
/// <see cref="RepositoryResult{T}.Empty(System.DateTimeOffset?)"/> — the native analogue of the web
/// <c>{motorData ? … : &lt;EmptyState /&gt;}</c> gate. Kept pure so the parse-and-preserve contract is unit-tested
/// without a network or cache.
/// </summary>
public static class MotorSectionResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<MotorSectionReading> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        MotorSectionReading? Parse() => raw.HasValue ? MotorSectionReading.FromResponse(raw.Value) : null;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<MotorSectionReading>.Loading(),
            LoadStatus.Cached => Parse() is { } cached
                ? RepositoryResult<MotorSectionReading>.Cached(cached, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<MotorSectionReading>.Empty(raw.FetchedAt),
            LoadStatus.Refreshing => Parse() is { } refreshing
                ? RepositoryResult<MotorSectionReading>.Refreshing(refreshing, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<MotorSectionReading>.Empty(raw.FetchedAt),
            LoadStatus.Loaded => Parse() is { } loaded
                ? RepositoryResult<MotorSectionReading>.Loaded(loaded, raw.FetchedAt ?? DateTimeOffset.UtcNow)
                : RepositoryResult<MotorSectionReading>.Empty(raw.FetchedAt),
            LoadStatus.Empty => RepositoryResult<MotorSectionReading>.Empty(raw.FetchedAt),
            LoadStatus.Offline => Parse() is { } offline
                ? RepositoryResult<MotorSectionReading>.OfflineCached(offline, raw.FetchedAt!.Value, raw.Error!)
                : RepositoryResult<MotorSectionReading>.Empty(raw.FetchedAt),
            _ => RepositoryResult<MotorSectionReading>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
