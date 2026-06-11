using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive render branch of the <c>ChargingTelemetrySection</c> surface — the native union of
/// the states the P2 feature-view contract requires for the vehicle-detail Charging-Telemetry section
/// (web/src/features/vehicles/components/vehicle-detail/ChargingTelemetrySection.tsx). The web source is a pure
/// presentational child of the Vehicle-Detail page: it takes a <c>chargingTelemetry: ChargingTelemetry | null |
/// undefined</c> prop and renders either its eight-tile metric grid (a truthy reading) or a friendly empty state
/// (a null / undefined reading), performing no fetching itself. The parent live-telemetry experience owns the
/// query lifecycle, so it supplies the active <see cref="Status"/> — loading while the page is still resolving,
/// a retriable error on hard failure, and a stale / offline freshness chip layered over the last cached reading.
/// Every member maps onto a visible surface; none is ever hidden behind a <c>{data &amp;&amp; …}</c> guard.
/// </summary>
public enum ChargingTelemetrySectionState
{
    /// <summary>The page has not produced the live telemetry yet — skeleton chrome under the header.</summary>
    Loading,

    /// <summary>A charging telemetry reading is present (web truthy <c>chargingTelemetry</c>) — the metric grid.</summary>
    Ready,

    /// <summary>
    /// Resolved with no charging telemetry — the web <c>: &lt;EmptyState /&gt;</c> branch (a null / undefined
    /// <c>chargingTelemetry</c>) — the friendly "No charging telemetry available" surface, never a blank box.
    /// </summary>
    Empty,

    /// <summary>The page's telemetry query failed with no usable reading — a retriable error surface.</summary>
    Error,

    /// <summary>Showing a reading older than the freshness window — the metric grid plus a stale chip.</summary>
    Stale,

    /// <summary>No connectivity — the last cached reading plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The eight charging-telemetry metric tiles, in the web source's fixed render order. The view maps each kind
/// onto its design-token accent brush (the native analogue of the web <c>MetricCard color</c>) and the
/// projection maps it onto its formatted value.
/// </summary>
public enum ChargingTelemetryMetricKind
{
    /// <summary>Web "Charger Power" tile — <c>charger_power_w</c>, green.</summary>
    ChargerPower,

    /// <summary>Web "Voltage" tile — <c>charger_voltage</c>, cyan.</summary>
    Voltage,

    /// <summary>Web "Current" tile — <c>charger_actual_current</c>, purple.</summary>
    Current,

    /// <summary>Web "Energy Added" tile — <c>charge_energy_added_wh</c>, green.</summary>
    EnergyAdded,

    /// <summary>Web "Charging State" tile — <c>charging_state</c>, cyan.</summary>
    ChargingState,

    /// <summary>Web "Battery Level" tile — <c>battery_level</c>, green.</summary>
    BatteryLevel,

    /// <summary>Web "Charge Rate" tile — <c>range_added_meters_per_hour</c>, cyan.</summary>
    ChargeRate,

    /// <summary>Web "Range Added" tile — <c>range_added_meters</c>, purple.</summary>
    RangeAdded,
}

/// <summary>
/// One live charging-telemetry reading — the native analogue of the fields the web component consumes from its
/// <c>chargingTelemetry: ChargingTelemetry</c> prop. Values are SI as the backend stores them (Phase-42 /
/// Phase-48 canonical): <see cref="ChargerPowerW"/> is watts, <see cref="ChargeEnergyAddedWh"/> is watt-hours,
/// <see cref="RangeAddedMetersPerHour"/> is metres of range added per hour, <see cref="RangeAddedMeters"/> is
/// metres. Every member is nullable because the web component guards each one with a <c>!= null</c> check and
/// falls back to an em dash. Pure data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="ChargerPowerW">Charger power in SI watts (web <c>charger_power_w</c>).</param>
/// <param name="ChargerVoltageV">Charger voltage in volts (web <c>charger_voltage</c>).</param>
/// <param name="ChargerActualCurrentA">Charger actual current in amperes (web <c>charger_actual_current</c>).</param>
/// <param name="ChargeEnergyAddedWh">Energy added in SI watt-hours (web <c>charge_energy_added_wh</c>).</param>
/// <param name="ChargingState">Raw backend charging-state string (web <c>charging_state</c>), or null.</param>
/// <param name="BatteryLevel">Battery state-of-charge percentage (web <c>battery_level</c>).</param>
/// <param name="RangeAddedMetersPerHour">Range added in SI metres per hour (web <c>range_added_meters_per_hour</c>).</param>
/// <param name="RangeAddedMeters">Range added in SI metres (web <c>range_added_meters</c>).</param>
public sealed record ChargingTelemetryReadings(
    double? ChargerPowerW,
    double? ChargerVoltageV,
    double? ChargerActualCurrentA,
    double? ChargeEnergyAddedWh,
    string? ChargingState,
    double? BatteryLevel,
    double? RangeAddedMetersPerHour,
    double? RangeAddedMeters);

/// <summary>
/// The render-time data model the <c>ChargingTelemetrySection</c> view binds to — the native analogue of the web
/// component's <c>chargingTelemetry</c> prop, plus the parent-supplied lifecycle <see cref="Status"/> and
/// freshness flags (the native P1/S8 seam the page's live-telemetry state holder fills in). A null / undefined
/// web <c>chargingTelemetry</c> collapses to the empty surface, modelled here as a null <see cref="Readings"/>.
/// The component is presentational; user-facing labels are resolved from the i18n facade by the projection, not
/// passed in. Pure data — no WinUI types.
/// </summary>
/// <param name="Status">The parent-supplied lifecycle state.</param>
/// <param name="Readings">The current charging telemetry reading, or null when none is available (empty surface).</param>
/// <param name="UpdatedAt">When the reading was produced (drives the freshness affordance), or null.</param>
/// <param name="IsFetching">True while the parent is refreshing in the background.</param>
/// <param name="ErrorMessage">An already-localized hard-failure message, or null to use the default.</param>
public sealed record ChargingTelemetrySectionModel(
    ChargingTelemetrySectionState Status,
    ChargingTelemetryReadings? Readings,
    DateTimeOffset? UpdatedAt = null,
    bool IsFetching = false,
    string? ErrorMessage = null)
{
    /// <summary>The initial model: the page is still resolving live telemetry and no reading has arrived.</summary>
    public static ChargingTelemetrySectionModel Loading { get; } =
        new(ChargingTelemetrySectionState.Loading, null);

    /// <summary>A resolved model with no charging telemetry — the empty surface (web null <c>chargingTelemetry</c>).</summary>
    public static ChargingTelemetrySectionModel Empty { get; } =
        new(ChargingTelemetrySectionState.Empty, null);

    /// <summary>A hard-failure model (no usable reading) carrying an optional already-localized message.</summary>
    public static ChargingTelemetrySectionModel Failed(string? message = null) =>
        new(ChargingTelemetrySectionState.Error, null, ErrorMessage: message);

    /// <summary>A fresh resolved model carrying a charging telemetry reading.</summary>
    public static ChargingTelemetrySectionModel Ready(
        ChargingTelemetryReadings readings,
        DateTimeOffset? updatedAt = null,
        bool isFetching = false) =>
        new(ChargingTelemetrySectionState.Ready, readings, updatedAt, isFetching);

    /// <summary>A stale reading (older than the freshness window) carrying the cached telemetry.</summary>
    public static ChargingTelemetrySectionModel Stale(
        ChargingTelemetryReadings readings,
        DateTimeOffset? updatedAt = null) =>
        new(ChargingTelemetrySectionState.Stale, readings, updatedAt);

    /// <summary>An offline reading (no connectivity) carrying the last cached telemetry.</summary>
    public static ChargingTelemetrySectionModel Offline(
        ChargingTelemetryReadings readings,
        DateTimeOffset? updatedAt = null) =>
        new(ChargingTelemetrySectionState.Offline, readings, updatedAt);
}

/// <summary>
/// One projected, render-ready metric tile — the native analogue of a single web <c>&lt;MetricCard&gt;</c> in the
/// grid. <see cref="Kind"/> identifies the tile (and lets the view pick its accent), <see cref="Label"/> is the
/// localized label, <see cref="Value"/> is the formatted reading (or an em dash), <see cref="AccentBrushKey"/> is
/// the design-token brush key the web <c>color</c> maps to (theme-aware, never a literal hex), and
/// <see cref="AutomationName"/> is the spoken "<c>{label}: {value}</c>". Pure data.
/// </summary>
public sealed record ChargingTelemetryMetric(
    ChargingTelemetryMetricKind Kind,
    string Label,
    string Value,
    string AccentBrushKey,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the section for one input model — the native analogue of what the
/// web <c>ChargingTelemetrySection</c> renders. Holds the active <see cref="State"/>, the localized
/// <see cref="Title"/>, the decorative <see cref="HeaderGlyph"/>, the eight <see cref="Metrics"/> (always built so
/// a test can assert the grid regardless of branch; an absent reading projects each tile to an em dash), the
/// freshness chip copy + status (shown only for <see cref="ChargingTelemetrySectionState.Stale"/> /
/// <see cref="ChargingTelemetrySectionState.Offline"/>), the empty / loading / error copy and retry label, the
/// freshness timestamp + fetching flag, and the surface <see cref="AutomationName"/>. Pure data so every branch is
/// asserted headlessly.
/// </summary>
public sealed record ChargingTelemetrySectionDisplay(
    ChargingTelemetrySectionState State,
    string Title,
    string HeaderGlyph,
    IReadOnlyList<ChargingTelemetryMetric> Metrics,
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
/// Pure projection from a <see cref="ChargingTelemetrySectionModel"/> to its
/// <see cref="ChargingTelemetrySectionDisplay"/> — the native port of
/// web/src/features/vehicles/components/vehicle-detail/ChargingTelemetrySection.tsx. Branch precedence mirrors the
/// web parent's data lifecycle (loading → error → empty → freshness → ready); a fresh snapshot with a null reading
/// collapses to the friendly empty state, while a stale / offline reading keeps its cached grid under a freshness
/// chip.
/// <para>
/// Two unit readouts are reproduced <b>bug-for-bug</b> from the web source: it formats <c>charger_power_w</c>
/// (SI watts) as <c>`${fmtNumber(value)} kW`</c> and <c>charge_energy_added_wh</c> (SI watt-hours) as
/// <c>`${fmtNumber(value)} kWh`</c> — the template literal only appends the kilo-prefixed label, it does NOT scale
/// W→kW or Wh→kWh — so the web renders the raw SI magnitude beside a kilo-prefixed label. The native projection
/// faithfully reproduces that exact string rather than "correcting" it, because the web source is the parity
/// specification. The genuinely-converted readouts (Charge Rate via <see cref="UnitFormatters.FormatSpeed"/> and
/// Range Added via <see cref="UnitFormatters.FormatDistance"/>) DO convert at the display boundary, matching the
/// web's <c>useUnits</c> formatters.
/// </para>
/// Every label resolves through the i18n facade using the same keys the web source feeds into <c>t(...)</c>. Unit
/// symbols (kW, V, A, kWh, %) are not user-facing translatable text and are emitted verbatim, exactly as the web
/// source does. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class ChargingTelemetrySectionProjection
{
    /// <summary>Segoe Fluent — LightningBolt (web Lucide <c>Zap</c>), the header + empty-state glyph.</summary>
    public const string ZapGlyph = "\uE945";

    /// <summary>Accent brush key for the green tiles — web <c>color="green"</c> (#10b981, the battery token).</summary>
    public const string GreenAccentBrushKey = "TsChartBatteryBrush";

    /// <summary>Accent brush key for the cyan tiles — web <c>color="cyan"</c> (#00f0ff, the info token).</summary>
    public const string CyanAccentBrushKey = "TsColorInfoBrush";

    /// <summary>Accent brush key for the purple tiles — web <c>color="purple"</c> (#a855f7, the power token).</summary>
    public const string PurpleAccentBrushKey = "TsChartPowerBrush";

    private const string VoltUnit = "V";
    private const string CurrentUnit = "A";
    private const string PowerUnit = "kW";
    private const string EnergyUnit = "kWh";
    private const string PercentUnit = "%";
    private const string EmDash = "\u2014"; // web '—' fallback
    private const int SecondsPerHour = 3600; // web range_added_meters_per_hour / 3600 → m/s
    private const int DefaultPrecision = 2;  // web fmtNumber global precision default

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade and units.</summary>
    /// <param name="model">The render-time data model (the web prop, plus the parent's lifecycle status).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="units">The user's display preference (locale, precision, distance + speed units).</param>
    public static ChargingTelemetrySectionDisplay Project(
        ChargingTelemetrySectionModel model,
        ILocalizer localizer,
        UnitPref units)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(units);

        ChargingTelemetrySectionState state = SelectState(model);

        string title = localizer.GetString("vehicles.detail.chargingTelemetry", "Charging Telemetry");
        string emptyMessage = localizer.GetString("vehicles.detail.noChargingTelemetry", "No charging telemetry available");
        string loadingLabel = localizer.GetString("common.loading", "Loading...");
        string errorTitle = localizer.GetString("queryError.title", "Failed to load data");
        string errorMessage = string.IsNullOrWhiteSpace(model.ErrorMessage)
            ? localizer.GetString("error.serverError.message", "Something went wrong on our end. Please try again.")
            : model.ErrorMessage!;
        string retryLabel = localizer.GetString("common.retry", "Retry");

        IReadOnlyList<ChargingTelemetryMetric> metrics = BuildMetrics(model.Readings, localizer, units);

        bool showChip = state is ChargingTelemetrySectionState.Stale or ChargingTelemetrySectionState.Offline;
        string chipText = state switch
        {
            ChargingTelemetrySectionState.Offline => localizer.GetString("common.offline", "Offline"),
            ChargingTelemetrySectionState.Stale => localizer.GetString("common.stale", "Stale"),
            _ => string.Empty,
        };
        StatusKind chipStatus = state == ChargingTelemetrySectionState.Offline ? StatusKind.Danger : StatusKind.Warning;

        string automationName = BuildAutomationName(
            state, title, showChip, chipText, metrics, emptyMessage, loadingLabel, errorTitle);

        return new ChargingTelemetrySectionDisplay(
            State: state,
            Title: title,
            HeaderGlyph: ZapGlyph,
            Metrics: metrics,
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

    // Branch precedence from the web parent's data lifecycle. Loading / Error / Empty / Stale / Offline come
    // straight from the parent's classification; a fresh "Ready" snapshot with a null reading is the web
    // null/undefined chargingTelemetry case and collapses to the friendly empty state, while a stale / offline
    // reading keeps its cached grid under a chip (freshness wins over emptiness).
    private static ChargingTelemetrySectionState SelectState(ChargingTelemetrySectionModel model) => model.Status switch
    {
        ChargingTelemetrySectionState.Loading => ChargingTelemetrySectionState.Loading,
        ChargingTelemetrySectionState.Error => ChargingTelemetrySectionState.Error,
        ChargingTelemetrySectionState.Empty => ChargingTelemetrySectionState.Empty,
        ChargingTelemetrySectionState.Stale => ChargingTelemetrySectionState.Stale,
        ChargingTelemetrySectionState.Offline => ChargingTelemetrySectionState.Offline,
        _ => model.Readings is null ? ChargingTelemetrySectionState.Empty : ChargingTelemetrySectionState.Ready,
    };

    private static IReadOnlyList<ChargingTelemetryMetric> BuildMetrics(
        ChargingTelemetryReadings? r,
        ILocalizer localizer,
        UnitPref units)
    {
        // Web order: Charger Power, Voltage, Current, Energy Added, Charging State, Battery Level, Charge Rate,
        // Range Added — each with its web MetricCard colour mapped onto a design-token accent brush.
        var power = Metric(
            ChargingTelemetryMetricKind.ChargerPower,
            localizer.GetString("vehicles.detail.chargerPower", "Charger Power"),
            r?.ChargerPowerW is { } pw ? FmtWithUnit(pw, PowerUnit, units) : EmDash,
            GreenAccentBrushKey);

        var voltage = Metric(
            ChargingTelemetryMetricKind.Voltage,
            localizer.GetString("vehicles.detail.voltage", "Voltage"),
            r?.ChargerVoltageV is { } v ? FmtWithUnit(v, VoltUnit, units) : EmDash,
            CyanAccentBrushKey);

        var current = Metric(
            ChargingTelemetryMetricKind.Current,
            localizer.GetString("vehicles.detail.current", "Current"),
            r?.ChargerActualCurrentA is { } a ? FmtWithUnit(a, CurrentUnit, units) : EmDash,
            PurpleAccentBrushKey);

        var energy = Metric(
            ChargingTelemetryMetricKind.EnergyAdded,
            localizer.GetString("vehicles.detail.energyAdded", "Energy Added"),
            r?.ChargeEnergyAddedWh is { } e ? FmtWithUnit(e, EnergyUnit, units) : EmDash,
            GreenAccentBrushKey);

        // Web: charging_state ?? '—' (the raw backend string, NOT a localized "Unknown" fallback).
        var chargingState = Metric(
            ChargingTelemetryMetricKind.ChargingState,
            localizer.GetString("vehicles.detail.chargingState", "Charging State"),
            r?.ChargingState ?? EmDash,
            CyanAccentBrushKey);

        var battery = Metric(
            ChargingTelemetryMetricKind.BatteryLevel,
            localizer.GetString("vehicles.detail.batteryLevel", "Battery Level"),
            r?.BatteryLevel is { } b ? FmtNumber(b, units) + PercentUnit : EmDash,
            GreenAccentBrushKey);

        // Web: formatSpeed(range_added_meters_per_hour / 3600) — metres-per-hour ÷ 3600 → SI m/s, then converted
        // to the user's speed unit at the display boundary.
        var chargeRate = Metric(
            ChargingTelemetryMetricKind.ChargeRate,
            localizer.GetString("vehicles.detail.chargeRate", "Charge Rate"),
            r?.RangeAddedMetersPerHour is { } mph ? UnitFormatters.FormatSpeed(mph / SecondsPerHour, units) : EmDash,
            CyanAccentBrushKey);

        // Web: formatDistance(range_added_meters) — SI metres converted to the user's distance unit.
        var rangeAdded = Metric(
            ChargingTelemetryMetricKind.RangeAdded,
            localizer.GetString("vehicles.detail.rangeAdded", "Range Added"),
            r?.RangeAddedMeters is { } m ? UnitFormatters.FormatDistance(m, units) : EmDash,
            PurpleAccentBrushKey);

        return [power, voltage, current, energy, chargingState, battery, chargeRate, rangeAdded];
    }

    private static ChargingTelemetryMetric Metric(
        ChargingTelemetryMetricKind kind,
        string label,
        string value,
        string accentBrushKey) =>
        new(kind, label, value, accentBrushKey, $"{label}: {value}");

    private static string BuildAutomationName(
        ChargingTelemetrySectionState state,
        string title,
        bool showChip,
        string chipText,
        IReadOnlyList<ChargingTelemetryMetric> metrics,
        string emptyMessage,
        string loadingLabel,
        string errorTitle)
    {
        switch (state)
        {
            case ChargingTelemetrySectionState.Loading:
                return loadingLabel;
            case ChargingTelemetrySectionState.Empty:
                return $"{title}. {emptyMessage}";
            case ChargingTelemetrySectionState.Error:
                return $"{title}. {errorTitle}";
            default:
                var parts = new List<string> { title };
                if (showChip)
                {
                    parts.Add(chipText);
                }

                foreach (var metric in metrics)
                {
                    parts.Add(metric.AutomationName);
                }

                return string.Join(". ", parts);
        }
    }

    // Web fmtNumber(v): safeNumber(v) (non-finite → 0) formatted at the global decimal precision (default 2). The
    // unit-pref Precision is the global-precision analogue; fall back to 2 when it is unset, matching the web.
    private static string FmtNumber(double value, UnitPref units) =>
        NumberFormatting.Format(SafeNumber(value), units.Locale, GlobalPrecision(units));

    // Web template literal `${fmtNumber(v)} ${unit}` — appends the label WITHOUT scaling the magnitude.
    private static string FmtWithUnit(double value, string unit, UnitPref units) =>
        $"{FmtNumber(value, units)} {unit}";

    // Web safeNumber: a non-finite value formats as 0 rather than "NaN" / "∞".
    private static double SafeNumber(double value) => double.IsFinite(value) ? value : 0.0;

    private static int GlobalPrecision(UnitPref units) =>
        units.Precision is { } p and >= 0 ? p : DefaultPrecision;
}

/// <summary>
/// PII-safe diagnostics for the <c>ChargingTelemetrySection</c> surface (P1/S11 diagnostics contract). Records
/// only the operational <c>view.opened</c> event with the surface slug — never a power, voltage, current, energy,
/// battery level, charge rate or range figure — so a diagnostics line can never leak a user's charging behaviour.
/// Thread-safe.
/// </summary>
public sealed class ChargingTelemetrySectionDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public ChargingTelemetrySectionDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ChargingTelemetrySection</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={ChargingTelemetrySectionRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>ChargingTelemetrySection</c> feature surface — the native mirror of the web
/// component at <c>web/src/features/vehicles/components/vehicle-detail/ChargingTelemetrySection.tsx</c>.
/// </summary>
public static class ChargingTelemetrySectionRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "ChargingTelemetrySection";
}
