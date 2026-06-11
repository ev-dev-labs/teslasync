using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive render branch of the <c>EnergyChargingPanel</c> surface — the native union of the
/// states the web component renders
/// (web/src/features/vehicles/components/telemetry-panels/EnergyChargingPanel.tsx). The web source is a pure
/// presentational panel (it takes a <c>chargingTelemetry: ChargingTelemetry | null | undefined</c> prop and
/// performs no fetching), so the branches are a direct function of the input <see cref="EnergyChargingPanelModel"/>
/// — there is no fetch-driven error / stale / offline branch to reproduce in THIS surface. The parent live-telemetry
/// experience (web <c>LiveTelemetryPanels</c>) owns the query lifecycle: loading / error / stale / offline are
/// resolved once for the whole live-telemetry section before any panel is handed its slice of data, exactly as the
/// web grid only renders the panel with whatever <c>chargingTelemetry</c> the page has already resolved. Every
/// branch maps onto a visible surface; none is ever hidden.
/// </summary>
public enum EnergyChargingState
{
    /// <summary>The parent has not produced the live telemetry yet — skeleton chrome under the header.</summary>
    Loading,

    /// <summary>
    /// Resolved with no charging telemetry — the web <c>: &lt;EmptyState /&gt;</c> branch (a null / undefined
    /// <c>chargingTelemetry</c>) — the friendly "No charging telemetry available" surface.
    /// </summary>
    Empty,

    /// <summary>A charging telemetry reading is present (web truthy <c>chargingTelemetry</c>) — the metric body.</summary>
    Ready,
}

/// <summary>
/// The semantic tone of the charging-state chip — the native union of the web component's three-way conditional
/// (<c>charging_state === 'Charging' ? cyan : charging_state === 'Complete' ? green : gray</c>). The chip text is
/// the raw backend <c>charging_state</c> string (or the localized "Unknown" fallback); only the colour is driven by
/// this tone, mapped to a token brush at the display boundary by the view.
/// </summary>
public enum ChargingStateTone
{
    /// <summary>The vehicle is actively charging (web <c>'Charging'</c>) — cyan chip.</summary>
    Charging,

    /// <summary>Charging has completed (web <c>'Complete'</c>) — green chip.</summary>
    Complete,

    /// <summary>Any other / unknown / null state (web else branch) — neutral chip.</summary>
    Neutral,
}

/// <summary>
/// One live charging-telemetry reading — the native analogue of the fields the web component consumes from its
/// <c>chargingTelemetry: ChargingTelemetry</c> prop. Values are SI as the backend stores them (Phase-42 / Phase-48
/// canonical): <see cref="ChargerPowerW"/> is watts, <see cref="ChargeEnergyAddedWh"/> is watt-hours,
/// <see cref="RangeAddedMetersPerHour"/> is metres of range added per hour. Every member is nullable because the
/// web component guards each one with a <c>!= null</c> check and falls back to an em dash. Pure data — no WinUI
/// types — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="ChargerVoltageV">Charger voltage in volts (web <c>charger_voltage</c>).</param>
/// <param name="ChargerActualCurrentA">Charger actual current in amperes (web <c>charger_actual_current</c>).</param>
/// <param name="ChargerPowerW">Charger power in SI watts (web <c>charger_power_w</c>).</param>
/// <param name="ChargeEnergyAddedWh">Energy added in SI watt-hours (web <c>charge_energy_added_wh</c>).</param>
/// <param name="ChargingState">Raw backend charging state string (web <c>charging_state</c>), or null.</param>
/// <param name="BatteryLevel">Battery state of charge percentage (web <c>battery_level</c>).</param>
/// <param name="RangeAddedMetersPerHour">Range added in SI metres per hour (web <c>range_added_meters_per_hour</c>).</param>
public sealed record EnergyChargingReadings(
    double? ChargerVoltageV,
    double? ChargerActualCurrentA,
    double? ChargerPowerW,
    double? ChargeEnergyAddedWh,
    string? ChargingState,
    double? BatteryLevel,
    double? RangeAddedMetersPerHour);

/// <summary>
/// The render-time data model the <c>EnergyChargingPanel</c> view binds to — the native analogue of the web
/// component's <c>chargingTelemetry</c> prop, plus the <see cref="Loading"/> flag the parent live-telemetry section
/// supplies (the web panel itself has no loading prop; the parent owns that). A null / undefined web
/// <c>chargingTelemetry</c> collapses to the empty surface, modelled here as a null <see cref="Readings"/>. The
/// component is presentational; user-facing labels are resolved from the i18n facade by the projection, not passed
/// in. Pure data — no WinUI types.
/// </summary>
/// <param name="Loading">True while the parent is still resolving live telemetry.</param>
/// <param name="Readings">The current charging telemetry reading, or null when none is available (empty surface).</param>
public sealed record EnergyChargingPanelModel(bool Loading, EnergyChargingReadings? Readings)
{
    /// <summary>The initial model: the parent is still resolving live telemetry and no reading has arrived.</summary>
    public static EnergyChargingPanelModel Pending { get; } = new(true, null);

    /// <summary>A resolved model with no charging telemetry — the empty surface (web null <c>chargingTelemetry</c>).</summary>
    public static EnergyChargingPanelModel Empty { get; } = new(false, null);
}

/// <summary>
/// One projected, render-ready metric tile — the native analogue of a web <c>&lt;MetricCard&gt;</c> in the two-column
/// grid (Charger Voltage, Charger Current). <see cref="Label"/> is the localized label, <see cref="Value"/> is the
/// formatted reading (or an em dash), <see cref="Subtitle"/> is the unit symbol the web passes as the card's
/// <c>subtitle</c> (e.g. "V" / "A"), and <see cref="AutomationName"/> is the spoken "<c>{label}: {value} {subtitle}</c>".
/// Pure data.
/// </summary>
public sealed record EnergyChargingMetric(string Label, string Value, string Subtitle, string AutomationName);

/// <summary>
/// One projected, render-ready label/value row — the native analogue of a web "<c>flex justify-between</c>" row
/// (Charger Power, Energy Added, Battery Level, Charge Rate). <see cref="Glyph"/> is the optional decorative leading
/// glyph (empty when the web row has no icon; the Charge Rate row carries the lightning glyph), <see cref="Label"/>
/// is the localized muted label, <see cref="Value"/> is the formatted reading (or an em dash), and
/// <see cref="AutomationName"/> is the spoken "<c>{label}: {value}</c>". Pure data.
/// </summary>
public sealed record EnergyChargingStat(string Glyph, string Label, string Value, string AutomationName);

/// <summary>
/// The projected, render-ready charging-state chip row — the native analogue of the web "Charging State" row.
/// <see cref="Label"/> is the localized row label, <see cref="Value"/> is the chip text (the raw backend state or
/// the localized "Unknown" fallback), <see cref="Tone"/> selects the chip colour, and <see cref="AutomationName"/>
/// is the spoken "<c>{label}: {value}</c>". Pure data.
/// </summary>
public sealed record EnergyChargingChip(string Label, string Value, ChargingStateTone Tone, string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the panel for one input model — the native analogue of what the web
/// <c>EnergyChargingPanel</c> renders. Holds the active <see cref="State"/>, the localized <see cref="Title"/>, the
/// decorative <see cref="HeaderGlyph"/>, the two metric tiles, the four label/value stats, the charging-state chip,
/// the overall <see cref="EmptyMessage"/>, the <see cref="LoadingLabel"/>, and the surface <see cref="AutomationName"/>.
/// The metric/stat/chip members are always built (an absent reading projects to an em dash) so a test can assert the
/// body bug-for-bug regardless of the active branch; the view shows them only in the <see cref="EnergyChargingState.Ready"/>
/// branch. Pure data so every branch is asserted headlessly.
/// </summary>
public sealed record EnergyChargingPanelDisplay(
    EnergyChargingState State,
    string Title,
    string HeaderGlyph,
    EnergyChargingMetric Voltage,
    EnergyChargingMetric Current,
    EnergyChargingStat Power,
    EnergyChargingStat Energy,
    EnergyChargingChip ChargingState,
    EnergyChargingStat Battery,
    EnergyChargingStat ChargeRate,
    string EmptyMessage,
    string LoadingLabel,
    string AutomationName);

/// <summary>
/// Pure projection from an <see cref="EnergyChargingPanelModel"/> to its <see cref="EnergyChargingPanelDisplay"/> —
/// the native port of web/src/features/vehicles/components/telemetry-panels/EnergyChargingPanel.tsx. The branch
/// precedence mirrors the web source's lifecycle (loading → empty → ready).
/// <para>
/// Two unit readouts are reproduced <b>bug-for-bug</b> from the web source: the web formats
/// <c>charger_power_w</c> (SI watts) with <c>fmtWithUnit(value, 'kW')</c> and <c>charge_energy_added_wh</c>
/// (SI watt-hours) with <c>fmtWithUnit(value, 'kWh')</c>. <c>fmtWithUnit</c> only appends the unit label — it does
/// NOT scale W→kW or Wh→kWh — so the web renders the raw SI magnitude beside a kilo-prefixed label. The native
/// projection faithfully reproduces that exact string (raw magnitude + space + label) rather than "correcting" it,
/// because the web source is the parity specification. The genuinely-converted readout (Charge Rate via
/// <see cref="UnitFormatters.FormatSpeed"/>) DOES convert at the display boundary, matching the web's
/// <c>formatSpeed</c>.
/// </para>
/// Every label resolves through the i18n facade using the same keys the web source feeds into <c>t(...)</c>. Unit
/// symbols (V, A, kW, kWh, %) are not user-facing translatable text and are emitted verbatim, exactly as the web
/// source does. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class EnergyChargingPanelProjection
{
    /// <summary>Segoe Fluent — Battery (web Lucide <c>BatteryCharging</c>), the panel's header glyph.</summary>
    public const string HeaderGlyph = "\uE83F";

    /// <summary>Segoe Fluent — LightningBolt (web Lucide <c>Zap</c>), the Charge Rate row glyph.</summary>
    public const string ChargeRateGlyph = "\uE945";

    /// <summary>The backend charging-state value the web source treats as the active (cyan) state.</summary>
    public const string ChargingStateValue = "Charging";

    /// <summary>The backend charging-state value the web source treats as the complete (green) state.</summary>
    public const string CompleteStateValue = "Complete";

    private const string VoltUnit = "V";
    private const string CurrentUnit = "A";
    private const string PowerUnit = "kW";
    private const string EnergyUnit = "kWh";
    private const string PercentUnit = "%";
    private const string EmDash = "\u2014"; // web '—' fallback
    private const int SecondsPerHour = 3600; // web range_added_meters_per_hour / 3600 → m/s
    private const int DefaultPrecision = 2;  // web fmtNumber global precision default

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade and units.</summary>
    /// <param name="model">The render-time data model (the web prop, plus the parent's loading flag).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="units">The user's display preference (locale, precision, and speed unit for Charge Rate).</param>
    public static EnergyChargingPanelDisplay Project(
        EnergyChargingPanelModel model,
        ILocalizer localizer,
        UnitPref units)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(units);

        string title = localizer.GetString("telemetry.energyCharging", "Energy & Charging");
        string emptyMessage = localizer.GetString("telemetry.noChargingTelemetry", "No charging telemetry available");
        string loadingLabel = localizer.GetString("common.loading", "Loading...");
        string unknownText = localizer.GetString("common.unknown", "Unknown");

        EnergyChargingReadings? r = model.Readings;

        EnergyChargingMetric voltage = BuildMetric(
            localizer.GetString("telemetry.chargerVoltage", "Charger Voltage"),
            r?.ChargerVoltageV,
            VoltUnit,
            units);

        EnergyChargingMetric current = BuildMetric(
            localizer.GetString("telemetry.chargerCurrent", "Charger Current"),
            r?.ChargerActualCurrentA,
            CurrentUnit,
            units);

        EnergyChargingStat power = BuildUnitStat(
            localizer.GetString("telemetry.chargerPower", "Charger Power"),
            r?.ChargerPowerW,
            PowerUnit,
            units);

        EnergyChargingStat energy = BuildUnitStat(
            localizer.GetString("telemetry.energyAdded", "Energy Added"),
            r?.ChargeEnergyAddedWh,
            EnergyUnit,
            units);

        EnergyChargingChip chargingState = BuildChip(
            localizer.GetString("telemetry.chargingState", "Charging State"),
            r?.ChargingState,
            unknownText);

        EnergyChargingStat battery = BuildPercentStat(
            localizer.GetString("telemetry.batteryLevel", "Battery Level"),
            r?.BatteryLevel,
            units);

        EnergyChargingStat chargeRate = BuildChargeRateStat(
            localizer.GetString("telemetry.chargeRate", "Charge Rate"),
            r?.RangeAddedMetersPerHour,
            units);

        EnergyChargingState state = SelectState(model);

        return new EnergyChargingPanelDisplay(
            State: state,
            Title: title,
            HeaderGlyph: HeaderGlyph,
            Voltage: voltage,
            Current: current,
            Power: power,
            Energy: energy,
            ChargingState: chargingState,
            Battery: battery,
            ChargeRate: chargeRate,
            EmptyMessage: emptyMessage,
            LoadingLabel: loadingLabel,
            AutomationName: BuildAutomationName(
                state, title, emptyMessage, loadingLabel, voltage, current, power, energy, chargingState, battery, chargeRate));
    }

    /// <summary>Branch precedence from the web source's lifecycle: loading → empty → ready.</summary>
    private static EnergyChargingState SelectState(EnergyChargingPanelModel model)
    {
        if (model.Loading)
        {
            return EnergyChargingState.Loading;
        }

        return model.Readings is null ? EnergyChargingState.Empty : EnergyChargingState.Ready;
    }

    // Web: <MetricCard value={x != null ? fmtNumber(x) : '—'} subtitle="V" /> — a bare formatted magnitude with the
    // unit carried as the card subtitle (not appended to the value).
    private static EnergyChargingMetric BuildMetric(string label, double? value, string subtitle, UnitPref units)
    {
        string text = value is { } v ? FmtNumber(v, units) : EmDash;
        return new EnergyChargingMetric(label, text, subtitle, $"{label}: {text} {subtitle}");
    }

    // Web: `{x != null ? fmtWithUnit(x, 'kW'|'kWh') : '—'}` — bug-for-bug: fmtWithUnit appends the label WITHOUT
    // scaling, so the raw SI magnitude is rendered beside the kilo-prefixed unit.
    private static EnergyChargingStat BuildUnitStat(string label, double? value, string unit, UnitPref units)
    {
        string text = value is { } v ? FmtWithUnit(v, unit, units) : EmDash;
        return new EnergyChargingStat(string.Empty, label, text, $"{label}: {text}");
    }

    // Web: `{battery_level != null ? `${fmtNumber(battery_level)}%` : '—'}`.
    private static EnergyChargingStat BuildPercentStat(string label, double? value, UnitPref units)
    {
        string text = value is { } v ? $"{FmtNumber(v, units)}{PercentUnit}" : EmDash;
        return new EnergyChargingStat(string.Empty, label, text, $"{label}: {text}");
    }

    // Web: `{range_added_meters_per_hour != null ? formatSpeed(range_added_meters_per_hour / 3600) : '—'}` —
    // metres-per-hour ÷ 3600 → SI m/s, then converted to the user's speed unit at the display boundary.
    private static EnergyChargingStat BuildChargeRateStat(string label, double? metersPerHour, UnitPref units)
    {
        string text = metersPerHour is { } v
            ? UnitFormatters.FormatSpeed(v / SecondsPerHour, units)
            : EmDash;
        return new EnergyChargingStat(ChargeRateGlyph, label, text, $"{label}: {text}");
    }

    // Web: text = charging_state ?? t('common.unknown'); tone = Charging ? cyan : Complete ? green : gray. The tone
    // else-branch also covers a null state, so an unknown chip is always neutral.
    private static EnergyChargingChip BuildChip(string label, string? state, string unknownText)
    {
        string text = state ?? unknownText;
        ChargingStateTone tone = state switch
        {
            ChargingStateValue => ChargingStateTone.Charging,
            CompleteStateValue => ChargingStateTone.Complete,
            _ => ChargingStateTone.Neutral,
        };

        return new EnergyChargingChip(label, text, tone, $"{label}: {text}");
    }

    // Web fmtNumber(v): safeNumber(v) (non-finite → 0) formatted at the global decimal precision (default 2). The
    // unit-pref Precision is the global-precision analogue; fall back to 2 when it is unset, matching the web.
    private static string FmtNumber(double value, UnitPref units) =>
        NumberFormatting.Format(SafeNumber(value), units.Locale, GlobalPrecision(units));

    // Web fmtWithUnit(v, unit) === `${fmtNumber(v)} ${unit}`.
    private static string FmtWithUnit(double value, string unit, UnitPref units) =>
        $"{FmtNumber(value, units)} {unit}";

    // Web safeNumber: a non-finite value formats as 0 rather than "NaN" / "∞".
    private static double SafeNumber(double value) => double.IsFinite(value) ? value : 0.0;

    private static int GlobalPrecision(UnitPref units) =>
        units.Precision is { } p and >= 0 ? p : DefaultPrecision;

    private static string BuildAutomationName(
        EnergyChargingState state,
        string title,
        string emptyMessage,
        string loadingLabel,
        EnergyChargingMetric voltage,
        EnergyChargingMetric current,
        EnergyChargingStat power,
        EnergyChargingStat energy,
        EnergyChargingChip chargingState,
        EnergyChargingStat battery,
        EnergyChargingStat chargeRate) => state switch
        {
            EnergyChargingState.Loading => loadingLabel,
            EnergyChargingState.Empty => $"{title}. {emptyMessage}",
            _ => string.Join(
                ". ",
                title,
                voltage.AutomationName,
                current.AutomationName,
                power.AutomationName,
                energy.AutomationName,
                chargingState.AutomationName,
                battery.AutomationName,
                chargeRate.AutomationName),
        };
}

/// <summary>
/// PII-safe diagnostics for the <c>EnergyChargingPanel</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a voltage, current, power, energy or battery
/// figure — so a diagnostics line can never leak a user's charging behaviour. Thread-safe.
/// </summary>
public sealed class EnergyChargingPanelDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public EnergyChargingPanelDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=EnergyChargingPanel</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={EnergyChargingPanelRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>EnergyChargingPanel</c> feature surface — the native mirror of the web component
/// at <c>web/src/features/vehicles/components/telemetry-panels/EnergyChargingPanel.tsx</c>.
/// </summary>
public static class EnergyChargingPanelRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "EnergyChargingPanel";
}
