using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The lifecycle state a <see cref="ClimatePanelViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches a P2 feature surface must render for the web
/// live-telemetry Climate panel
/// (web/src/features/vehicles/components/telemetry-panels/ClimatePanel.tsx). The web component is a pure child
/// that renders its temperature / setpoint / HVAC / fan / system-badge content whenever its
/// <c>climateData</c> prop is present and otherwise draws the "No climate data available" empty state; the
/// native feature-view owns its cache-then-network latest-snapshot read and therefore renders the full state
/// matrix. <see cref="Empty"/> mirrors the web falsy-<c>climateData</c> branch (no snapshot for the vehicle)
/// and is distinct from a transport failure (<see cref="Error"/>).
/// </summary>
public enum ClimatePanelState
{
    /// <summary>Initial fetch with no cached snapshot — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh (or non-stale cached) snapshot is shown.</summary>
    Loaded,

    /// <summary>No vehicle / no snapshot resolved — render the friendly empty state.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// One latest climate snapshot projected from the <c>/climate/latest</c> response (web
/// <c>ClimateSnapshot</c> in <c>@/api/types</c>). Only the fields the web panel reads are kept: the four
/// temperatures in SI degrees Celsius (<c>inside_temp_c</c> / <c>outside_temp_c</c> / <c>driver_setpoint_c</c>
/// / <c>passenger_setpoint_c</c>), the textual <c>hvac_state</c> and <c>defrost_mode</c>, the
/// <c>is_climate_on</c> / <c>is_preconditioning</c> flags and the integer <c>fan_status</c>. Parsing is
/// null-tolerant so a partial row never throws and a missing field stays null (the panel then renders an em
/// dash or an inactive chip, mirroring the web nullish coalescing). Temperatures stay SI Celsius and are
/// converted to the user's display unit only at projection time.
/// </summary>
/// <param name="InsideTempC">Cabin temperature in SI °C, or null (web <c>inside_temp_c</c>).</param>
/// <param name="OutsideTempC">Outside temperature in SI °C, or null (web <c>outside_temp_c</c>).</param>
/// <param name="DriverSetpointC">Driver-side setpoint in SI °C, or null (web <c>driver_setpoint_c</c>).</param>
/// <param name="PassengerSetpointC">Passenger-side setpoint in SI °C, or null (web <c>passenger_setpoint_c</c>).</param>
/// <param name="HvacState">The textual HVAC state, or null (web <c>hvac_state</c>).</param>
/// <param name="DefrostMode">The textual defrost mode, or null (web <c>defrost_mode</c>).</param>
/// <param name="IsClimateOn">Whether climate is running, or null (web <c>is_climate_on</c>).</param>
/// <param name="IsPreconditioning">Whether the cabin is preconditioning, or null (web <c>is_preconditioning</c>).</param>
/// <param name="FanStatus">The integer fan level, or null (web <c>fan_status</c>).</param>
public sealed record ClimateReading(
    double? InsideTempC,
    double? OutsideTempC,
    double? DriverSetpointC,
    double? PassengerSetpointC,
    string? HvacState,
    string? DefrostMode,
    bool? IsClimateOn,
    bool? IsPreconditioning,
    int? FanStatus)
{
    /// <summary>Project a single <c>/climate/latest</c> JSON object into a tolerant reading.</summary>
    /// <param name="element">The raw snapshot JSON (a non-object yields an all-null reading).</param>
    /// <returns>The parsed reading (every field null-tolerant).</returns>
    public static ClimateReading FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return new ClimateReading(null, null, null, null, null, null, null, null, null);
        }

        return new ClimateReading(
            GetDouble(element, "inside_temp_c"),
            GetDouble(element, "outside_temp_c"),
            GetDouble(element, "driver_setpoint_c"),
            GetDouble(element, "passenger_setpoint_c"),
            GetString(element, "hvac_state"),
            GetString(element, "defrost_mode"),
            GetBool(element, "is_climate_on"),
            GetBool(element, "is_preconditioning"),
            GetInt(element, "fan_status"));
    }

    private static double? GetDouble(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
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

    private static int? GetInt(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetInt32(out var n) => n,
            JsonValueKind.Number when v.TryGetDouble(out var d) && !double.IsNaN(d) && !double.IsInfinity(d) => (int)d,
            JsonValueKind.String when int.TryParse(v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }

    private static bool? GetBool(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.String when bool.TryParse(v.GetString(), out var b) => b,
            JsonValueKind.Number when v.TryGetDouble(out var d) => d != 0,
            _ => null,
        };
    }

    private static string? GetString(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        if (v.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        string? s = v.GetString();
        return string.IsNullOrWhiteSpace(s) ? null : s;
    }
}

/// <summary>
/// One projected, render-ready temperature tile — the native analogue of a single web <c>MetricCard</c>
/// (cabin / outside). Holds the localized <see cref="Label"/>, the already-formatted display-unit
/// <see cref="Value"/> (or an em dash when the snapshot reported nothing) and the Narrator
/// <see cref="AutomationName"/>. Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Label">Localized metric label (web "Cabin" / "Outside").</param>
/// <param name="Value">Formatted temperature in the user's display unit, or an em dash.</param>
/// <param name="AutomationName">Spoken summary (label + value).</param>
public sealed record ClimatePanelMetric(string Label, string Value, string AutomationName);

/// <summary>
/// One projected, render-ready label/value detail row — the native analogue of a single web setpoint /
/// HVAC-state row. Holds the localized <see cref="Label"/>, the already-formatted <see cref="Value"/> and the
/// Narrator <see cref="AutomationName"/>. Pure data.
/// </summary>
/// <param name="Label">Localized row label (web "Driver Setpoint" / "Passenger Setpoint" / "HVAC State").</param>
/// <param name="Value">Formatted value (temperature in the user's unit, or the HVAC state, or an em dash).</param>
/// <param name="AutomationName">Spoken summary (label + value).</param>
public sealed record ClimatePanelDetail(string Label, string Value, string AutomationName);

/// <summary>
/// The projected, render-ready fan-speed readout — the native analogue of the web six-bar fan indicator.
/// Holds the localized <see cref="Label"/>, the <see cref="ActiveLevel"/> (web <c>fan_status ?? 0</c>) that
/// lights the graduated bars, the formatted numeric <see cref="Value"/> shown beside them and the Narrator
/// <see cref="AutomationName"/>. Pure data.
/// </summary>
/// <param name="Label">Localized fan label (web "Fan Speed").</param>
/// <param name="ActiveLevel">The active fan level (web <c>fan_status ?? 0</c>); bars 1..6 light when at or below it.</param>
/// <param name="Value">The numeric fan level rendered beside the bars.</param>
/// <param name="AutomationName">Spoken summary (label + level).</param>
public sealed record ClimatePanelFan(string Label, int ActiveLevel, string Value, string AutomationName);

/// <summary>
/// One projected system badge — the native analogue of a single web status chip (Defrost / Climate /
/// Precondition). Holds a stable <see cref="Key"/>, the semantic <see cref="Status"/> driving the chip colour
/// (web blue / green / amber when active, neutral otherwise), an optional Fluent <see cref="Glyph"/> standing
/// in for the web Snowflake / Zap icon, the localized <see cref="Label"/> (already including the on/off/mode
/// suffix), the <see cref="Active"/> flag and the Narrator <see cref="AutomationName"/>. Pure data.
/// </summary>
/// <param name="Key">Stable badge key (<c>defrost</c> / <c>climate</c> / <c>precondition</c>).</param>
/// <param name="Status">Semantic status driving the chip colour.</param>
/// <param name="Glyph">Optional Segoe Fluent glyph shown beside the label, or null.</param>
/// <param name="Label">Localized badge label including its state suffix.</param>
/// <param name="Active">True when the badge is in its active (coloured) state.</param>
/// <param name="AutomationName">Spoken summary of the badge.</param>
public sealed record ClimatePanelBadge(
    string Key,
    StatusKind Status,
    string? Glyph,
    string Label,
    bool Active,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the Climate panel — the native analogue of everything the web
/// component computes before returning its <c>GlassPanel</c>. Carries the always-present chrome strings
/// (title / panel aria / empty message), the <see cref="HasData"/> gate (web truthy <c>climateData</c>), the
/// cabin/outside temperature tiles, the driver/passenger setpoint rows, the HVAC-state row, the fan readout
/// and the three system badges. Pure data so the projection is unit-tested without a UI host. The content
/// members are null only in the no-snapshot <see cref="Empty"/> projection.
/// </summary>
/// <param name="HasData">True when a snapshot is present (web truthy <c>climateData</c>).</param>
/// <param name="Title">Localized surface title (web "Climate").</param>
/// <param name="PanelAutomationName">Localized panel Narrator label.</param>
/// <param name="EmptyMessage">Localized empty-state message.</param>
/// <param name="Cabin">The cabin temperature tile, or null when there is no snapshot.</param>
/// <param name="Outside">The outside temperature tile, or null when there is no snapshot.</param>
/// <param name="DriverSetpoint">The driver setpoint row, or null when there is no snapshot.</param>
/// <param name="PassengerSetpoint">The passenger setpoint row, or null when there is no snapshot.</param>
/// <param name="HvacState">The HVAC-state row, or null when there is no snapshot.</param>
/// <param name="Fan">The fan-speed readout, or null when there is no snapshot.</param>
/// <param name="Badges">The system badges (Defrost / Climate / Precondition), empty when there is no snapshot.</param>
public sealed record ClimatePanelDisplay(
    bool HasData,
    string Title,
    string PanelAutomationName,
    string EmptyMessage,
    ClimatePanelMetric? Cabin,
    ClimatePanelMetric? Outside,
    ClimatePanelDetail? DriverSetpoint,
    ClimatePanelDetail? PassengerSetpoint,
    ClimatePanelDetail? HvacState,
    ClimatePanelFan? Fan,
    IReadOnlyList<ClimatePanelBadge> Badges);

/// <summary>
/// Pure projection from a raw <see cref="ClimateReading"/> to the display model — the native port of the web
/// panel's <c>formatTemperature(...)</c> readouts, the <c>hvac_state ?? '—'</c> fallback, the
/// <c>fan_status ?? 0</c> bar indicator and the Defrost / Climate / Precondition badge selection in
/// web/src/features/vehicles/components/telemetry-panels/ClimatePanel.tsx. SI Celsius temperatures are
/// converted to the user's display unit here (and only here, via
/// <see cref="UnitFormatters.FormatTemperature(double?, UnitPref, int?)"/>); every label resolves through the
/// i18n facade.
/// </summary>
public static class ClimatePanelProjection
{
    /// <summary>Segoe Fluent thermometer glyph (web <c>Thermometer</c> icon) for the title and empty state.</summary>
    public const string ThermometerGlyph = "\uE9CA";

    /// <summary>Segoe Fluent glyph (web <c>Fan</c> icon) shown beside the fan-speed label.</summary>
    public const string FanGlyph = "\uE9CA";

    /// <summary>Segoe Fluent glyph (web <c>Snowflake</c> icon) shown on the Defrost badge.</summary>
    public const string DefrostGlyph = "\uE9CA";

    /// <summary>Segoe Fluent glyph (web <c>Zap</c> icon) shown on the Climate badge.</summary>
    public const string ClimateGlyph = "\uE945";

    /// <summary>The maximum number of graduated fan bars the web indicator renders.</summary>
    public const int FanBars = 6;

    /// <summary>The web "Off" sentinel that, when reported as the defrost mode, counts as inactive.</summary>
    private const string DefrostOff = "Off";

    /// <summary>Project a present <paramref name="reading"/> into the display model for <paramref name="units"/>.</summary>
    /// <param name="reading">The latest climate snapshot (a present snapshot is always content, per web).</param>
    /// <param name="units">The user's unit preference (web <c>useUnits</c>); only temperature is read.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <returns>The render-ready display model.</returns>
    public static ClimatePanelDisplay Project(
        ClimateReading reading,
        UnitPref units,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(reading);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        var cabin = Metric(
            localizer.GetString("common.insideTemp", "Cabin"),
            UnitFormatters.FormatTemperature(reading.InsideTempC, units));
        var outside = Metric(
            localizer.GetString("common.outsideTemp", "Outside"),
            UnitFormatters.FormatTemperature(reading.OutsideTempC, units));

        var driver = Detail(
            localizer.GetString("telemetry.driverSetpoint", "Driver Setpoint"),
            UnitFormatters.FormatTemperature(reading.DriverSetpointC, units));
        var passenger = Detail(
            localizer.GetString("telemetry.passengerSetpoint", "Passenger Setpoint"),
            UnitFormatters.FormatTemperature(reading.PassengerSetpointC, units));
        var hvac = Detail(
            localizer.GetString("telemetry.hvacState", "HVAC State"),
            reading.HvacState ?? UnitFormatters.DefaultEmptyDisplay);

        var fan = BuildFan(reading, localizer);
        var badges = BuildBadges(reading, localizer);

        return new ClimatePanelDisplay(
            HasData: true,
            Title: localizer.GetString("common.climate", "Climate"),
            PanelAutomationName: localizer.GetString("telemetry.climate", "Climate"),
            EmptyMessage: localizer.GetString("telemetry.noClimateData", "No climate data available"),
            Cabin: cabin,
            Outside: outside,
            DriverSetpoint: driver,
            PassengerSetpoint: passenger,
            HvacState: hvac,
            Fan: fan,
            Badges: badges);
    }

    /// <summary>Project the empty (no vehicle / no snapshot) display using the localizer.</summary>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <returns>An empty, no-data display carrying the localized chrome.</returns>
    public static ClimatePanelDisplay Empty(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return new ClimatePanelDisplay(
            HasData: false,
            Title: localizer.GetString("common.climate", "Climate"),
            PanelAutomationName: localizer.GetString("telemetry.climate", "Climate"),
            EmptyMessage: localizer.GetString("telemetry.noClimateData", "No climate data available"),
            Cabin: null,
            Outside: null,
            DriverSetpoint: null,
            PassengerSetpoint: null,
            HvacState: null,
            Fan: null,
            Badges: Array.Empty<ClimatePanelBadge>());
    }

    private static ClimatePanelMetric Metric(string label, string value) =>
        new(label, value, string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, value));

    private static ClimatePanelDetail Detail(string label, string value) =>
        new(label, value, string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, value));

    private static ClimatePanelFan BuildFan(ClimateReading reading, ILocalizer localizer)
    {
        // Web parity: `fan_status ?? 0` lights the bars and is shown verbatim beside them.
        int level = reading.FanStatus ?? 0;
        string label = localizer.GetString("telemetry.fanSpeed", "Fan Speed");
        string value = level.ToString(CultureInfo.CurrentCulture);
        string automation = string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, value);
        return new ClimatePanelFan(label, level, value, automation);
    }

    private static ClimatePanelBadge[] BuildBadges(ClimateReading reading, ILocalizer localizer)
    {
        string offLabel = localizer.GetString("common.off", "Off");
        string onLabel = localizer.GetString("common.on", "On");

        // Web parity: defrost is active when a mode is reported that isn't the "Off" sentinel; the chip then
        // shows the mode itself, otherwise the localized "Off".
        bool defrostActive = !string.IsNullOrEmpty(reading.DefrostMode)
            && !string.Equals(reading.DefrostMode, DefrostOff, StringComparison.OrdinalIgnoreCase);
        string defrostLabel = localizer.GetString("telemetry.defrost", "Defrost");
        string defrostSuffix = defrostActive ? reading.DefrostMode! : offLabel;
        var defrost = Badge(
            "defrost",
            defrostActive ? StatusKind.Info : StatusKind.Neutral,
            DefrostGlyph,
            defrostLabel,
            defrostSuffix,
            defrostActive);

        bool climateActive = reading.IsClimateOn == true;
        string climateLabel = localizer.GetString("telemetry.climate", "Climate");
        var climate = Badge(
            "climate",
            climateActive ? StatusKind.Success : StatusKind.Neutral,
            ClimateGlyph,
            climateLabel,
            climateActive ? onLabel : offLabel,
            climateActive);

        bool preconditionActive = reading.IsPreconditioning == true;
        string preconditionLabel = localizer.GetString("telemetry.precondition", "Precondition");
        var precondition = Badge(
            "precondition",
            preconditionActive ? StatusKind.Warning : StatusKind.Neutral,
            glyph: null,
            preconditionLabel,
            preconditionActive ? onLabel : offLabel,
            preconditionActive);

        return new[] { defrost, climate, precondition };
    }

    private static ClimatePanelBadge Badge(
        string key,
        StatusKind status,
        string? glyph,
        string label,
        string suffix,
        bool active)
    {
        string full = string.Format(CultureInfo.CurrentCulture, "{0} {1}", label, suffix);
        return new ClimatePanelBadge(key, status, glyph, full, active, full);
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;ClimateReading&gt;</c>, preserving every freshness flag (cached / refreshing /
/// stale / offline) so the view-model can render the full state matrix. A null / non-object snapshot collapses
/// to <see cref="RepositoryResult{T}.Empty"/> (the web falsy-<c>climateData</c> branch). Kept pure so the
/// parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class ClimatePanelResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    /// <param name="raw">The raw cache-then-network emission.</param>
    /// <returns>The typed emission with the same status / freshness.</returns>
    public static RepositoryResult<ClimateReading> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<ClimateReading>.Loading(),
            LoadStatus.Cached => Present(raw, raw.IsStale, raw.FetchedAt!.Value, RepositoryResult<ClimateReading>.Cached),
            LoadStatus.Refreshing => Present(raw, raw.IsStale, raw.FetchedAt!.Value, RepositoryResult<ClimateReading>.Refreshing),
            LoadStatus.Loaded => Loaded(raw),
            LoadStatus.Empty => RepositoryResult<ClimateReading>.Empty(raw.FetchedAt),
            LoadStatus.Offline => Offline(raw),
            _ => RepositoryResult<ClimateReading>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }

    private static RepositoryResult<ClimateReading> Present(
        RepositoryResult<JsonElement> raw,
        bool stale,
        DateTimeOffset fetchedAt,
        Func<ClimateReading, DateTimeOffset, bool, RepositoryResult<ClimateReading>> factory)
    {
        return TryParse(raw, out var reading)
            ? factory(reading, fetchedAt, stale)
            : RepositoryResult<ClimateReading>.Empty(fetchedAt);
    }

    private static RepositoryResult<ClimateReading> Loaded(RepositoryResult<JsonElement> raw)
    {
        DateTimeOffset fetchedAt = raw.FetchedAt ?? DateTimeOffset.UtcNow;
        return TryParse(raw, out var reading)
            ? RepositoryResult<ClimateReading>.Loaded(reading, fetchedAt)
            : RepositoryResult<ClimateReading>.Empty(fetchedAt);
    }

    private static RepositoryResult<ClimateReading> Offline(RepositoryResult<JsonElement> raw)
    {
        var error = raw.Error ?? new RepositoryError(RepositoryErrorKind.Network, "Offline");
        return TryParse(raw, out var reading)
            ? RepositoryResult<ClimateReading>.OfflineCached(reading, raw.FetchedAt!.Value, error)
            : RepositoryResult<ClimateReading>.Empty(raw.FetchedAt);
    }

    private static bool TryParse(RepositoryResult<JsonElement> raw, out ClimateReading reading)
    {
        if (raw.HasValue && raw.Value.ValueKind == JsonValueKind.Object)
        {
            reading = ClimateReading.FromJson(raw.Value);
            return true;
        }

        reading = new ClimateReading(null, null, null, null, null, null, null, null, null);
        return false;
    }
}

/// <summary>
/// Canonical registry metadata for the Climate panel — the native mirror of the web component
/// (web/src/features/vehicles/components/telemetry-panels/ClimatePanel.tsx). Centralises the stable id, the
/// diagnostics slug and the localized title so the view and view-model stay free of literal copy.
/// </summary>
public static class ClimatePanelRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "climate-panel";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "ClimatePanel";

    /// <summary>Localized surface title (web <c>common.climate</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <returns>The localized "Climate" title.</returns>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("common.climate", "Climate");
    }
}

/// <summary>
/// PII-safe diagnostics for the Climate panel (P1/S11 diagnostics contract). Records only the operational
/// <c>view.opened</c> event with the surface slug — never a temperature value, VIN or vehicle id — so a
/// diagnostics line can never leak vehicle data. Thread-safe.
/// </summary>
public sealed class ClimatePanelDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">Optional sink invoked with each diagnostics line.</param>
    public ClimatePanelDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ClimatePanel</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={ClimatePanelRegistration.Slug}");
    }
}
