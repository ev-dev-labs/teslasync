using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The lifecycle state a <see cref="TirePressurePanelViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches a P2 feature surface must render for the web
/// live-telemetry Tire-Pressure panel
/// (web/src/features/vehicles/components/telemetry-panels/TirePressurePanel.tsx). The web component is a pure
/// child that renders its four-corner content whenever its <c>tireData</c> prop is present and otherwise draws
/// the "No tire pressure data available" empty line; the native feature-view owns its cache-then-network
/// latest-snapshot read and therefore renders the full state matrix. <see cref="Empty"/> mirrors the web
/// falsy-<c>tireData</c> branch (no snapshot for the vehicle) and is distinct from a transport failure
/// (<see cref="Error"/>).
/// </summary>
public enum TirePressurePanelState
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
/// One latest tyre-pressure snapshot projected from the <c>/tire-pressure/latest</c> response (web
/// <c>TirePressureSnapshot</c> in <c>@/api/types</c>). Only the four corner pressures the web panel reads are
/// kept, each in SI Pascals (<c>front_left</c> / <c>front_right</c> / <c>rear_left</c> / <c>rear_right</c>).
/// Parsing is null-tolerant so a partial row never throws and a missing corner stays null (the panel renders an
/// em dash for it, mirroring the web <c>formatPressure(paToKpa(null))</c>). Pressures stay SI Pascals — divided
/// to kilopascals and converted to the user's display unit only at projection time.
/// </summary>
/// <param name="FrontLeftPa">Front-left tyre pressure in SI Pascals, or null (web <c>front_left</c>).</param>
/// <param name="FrontRightPa">Front-right tyre pressure in SI Pascals, or null (web <c>front_right</c>).</param>
/// <param name="RearLeftPa">Rear-left tyre pressure in SI Pascals, or null (web <c>rear_left</c>).</param>
/// <param name="RearRightPa">Rear-right tyre pressure in SI Pascals, or null (web <c>rear_right</c>).</param>
public sealed record TirePressureReading(
    double? FrontLeftPa,
    double? FrontRightPa,
    double? RearLeftPa,
    double? RearRightPa)
{
    /// <summary>Project a single <c>/tire-pressure/latest</c> JSON object into a tolerant reading.</summary>
    /// <param name="element">The raw snapshot JSON (a non-object yields an all-null reading).</param>
    /// <returns>The parsed reading (every corner null-tolerant).</returns>
    public static TirePressureReading FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return new TirePressureReading(null, null, null, null);
        }

        return new TirePressureReading(
            GetDouble(element, "front_left"),
            GetDouble(element, "front_right"),
            GetDouble(element, "rear_left"),
            GetDouble(element, "rear_right"));
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
}

/// <summary>
/// The SI-Pascal tyre-pressure bands shared with the web helpers
/// (web/src/features/vehicles/components/vehicle-detail/helpers.ts <c>TIRE_PRESSURE_PA</c>). All comparisons
/// stay in Pascals so there is one canonical source of truth; display conversion to kilopascals and then to the
/// user's pressure preference happens at the renderer. A reading is danger outside the critical band, warning
/// inside the soft band, success inside the safe band and neutral when unknown.
/// </summary>
public static class TirePressurePanelThresholds
{
    /// <summary>Below this is critical-low (≈ 30.0 psi).</summary>
    public const double LowCriticalPa = 206_800;

    /// <summary>Below this is warning-low (≈ 35.0 psi).</summary>
    public const double LowWarningPa = 241_300;

    /// <summary>Above this is warning-high (≈ 45.0 psi).</summary>
    public const double HighWarningPa = 310_300;

    /// <summary>Above this is critical-high (≈ 50.0 psi).</summary>
    public const double HighCriticalPa = 344_700;

    /// <summary>
    /// Map an SI-Pascal corner pressure to its semantic status (web <c>getColor</c> / <c>getBorder</c>):
    /// neutral when unknown, danger outside the critical band, warning inside the soft band, success otherwise.
    /// </summary>
    /// <param name="pa">The corner pressure in SI Pascals, or null.</param>
    /// <returns>The corner's semantic status.</returns>
    public static StatusKind CornerStatus(double? pa)
    {
        if (pa is not { } p || double.IsNaN(p))
        {
            return StatusKind.Neutral;
        }

        if (p < LowCriticalPa || p > HighCriticalPa)
        {
            return StatusKind.Danger;
        }

        if (p < LowWarningPa || p > HighWarningPa)
        {
            return StatusKind.Warning;
        }

        return StatusKind.Success;
    }
}

/// <summary>
/// One projected, render-ready corner tile — the native analogue of a single web per-corner card. Holds the
/// stable corner <see cref="Key"/>, the localized abbreviated <see cref="Label"/> (FL / FR / RL / RR), the
/// already-formatted display-unit <see cref="Value"/> (or an em dash when the corner reported nothing), the
/// semantic <see cref="Status"/> tinting the value text + border (web <c>getColor</c> / <c>getBorder</c>) and
/// the Narrator <see cref="AutomationName"/>. Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Key">Stable corner key (<c>fl</c> / <c>fr</c> / <c>rl</c> / <c>rr</c>).</param>
/// <param name="Label">Localized abbreviated corner label.</param>
/// <param name="Value">Formatted pressure in the user's display unit, or an em dash.</param>
/// <param name="Status">Semantic status tinting the value + border.</param>
/// <param name="AutomationName">Spoken summary (full corner name + value).</param>
public sealed record TirePressurePanelCorner(
    string Key,
    string Label,
    string Value,
    StatusKind Status,
    string AutomationName);

/// <summary>
/// The overall tyre-pressure summary chip — the native analogue of the web status pill. Holds the semantic
/// <see cref="Status"/> driving the chip colour, the Fluent <see cref="Glyph"/> standing in for the web
/// ✓ / ✗ / ⚠ marks, the localized <see cref="Label"/> (web "All Normal" / "Attention Needed" /
/// "Check Pressure") and the Narrator <see cref="AutomationName"/>. Pure data.
/// </summary>
/// <param name="Status">Semantic status driving the chip colour.</param>
/// <param name="Glyph">Segoe Fluent glyph shown beside the label.</param>
/// <param name="Label">Localized summary label.</param>
/// <param name="AutomationName">Spoken summary of the chip.</param>
public sealed record TirePressurePanelSummary(
    StatusKind Status,
    string Glyph,
    string Label,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the Tire-Pressure panel — the native analogue of everything the
/// web component computes before returning its <c>GlassPanel</c>. Carries the always-present chrome strings
/// (title / panel aria / empty message), the <see cref="HasData"/> gate (web truthy <c>tireData</c>), the four
/// per-corner <see cref="Corners"/> (in FL / FR / RL / RR order) and the overall <see cref="Summary"/> chip.
/// Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="HasData">True when a snapshot is present (web truthy <c>tireData</c>).</param>
/// <param name="Title">Localized surface title (web "Tire Pressure").</param>
/// <param name="PanelAutomationName">Localized panel Narrator label.</param>
/// <param name="EmptyMessage">Localized empty-state message.</param>
/// <param name="Corners">The four per-corner tiles, in web order (FL / FR / RL / RR).</param>
/// <param name="Summary">The overall summary chip, or null when there is no snapshot.</param>
public sealed record TirePressurePanelDisplay(
    bool HasData,
    string Title,
    string PanelAutomationName,
    string EmptyMessage,
    IReadOnlyList<TirePressurePanelCorner> Corners,
    TirePressurePanelSummary? Summary);

/// <summary>
/// Pure projection from a raw <see cref="TirePressureReading"/> to the display model — the native port of the
/// web panel's per-corner <c>formatPressure(paToKpa(pa))</c> readout, the <c>getColor</c> / <c>getBorder</c>
/// status mapping and the <c>allGood</c> / <c>anyBad</c> summary-chip selection in
/// web/src/features/vehicles/components/telemetry-panels/TirePressurePanel.tsx. SI Pascals are divided to
/// kilopascals and converted to the user's display unit here (and only here, via
/// <see cref="UnitFormatters.FormatPressure(double?, UnitPref, int?)"/>); every label resolves through the
/// i18n facade.
/// </summary>
public static class TirePressurePanelProjection
{
    /// <summary>Segoe Fluent gauge glyph (web <c>Gauge</c> icon) for the title and empty state.</summary>
    public const string GaugeGlyph = "\uE9D9";

    /// <summary>Segoe Fluent check glyph for the "All Normal" summary (web ✓).</summary>
    public const string AllNormalGlyph = "\uE73E";

    /// <summary>Segoe Fluent cancel glyph for the "Attention Needed" summary (web ✗).</summary>
    public const string AttentionGlyph = "\uE711";

    /// <summary>Segoe Fluent warning glyph for the "Check Pressure" summary (web ⚠).</summary>
    public const string CheckGlyph = "\uE7BA";

    // SI Pascals → kilopascals before the display-unit conversion (web `paToKpa(pa)` = `pa / 1000`).
    private const double PascalsPerKilopascal = 1000;

    private static readonly CornerDefinition[] CornerDefs =
    {
        new("fl", "vehicles.tirePressure.fl", "FL", "vehicles.tirePressure.frontLeft", "Front Left", static r => r.FrontLeftPa),
        new("fr", "vehicles.tirePressure.fr", "FR", "vehicles.tirePressure.frontRight", "Front Right", static r => r.FrontRightPa),
        new("rl", "vehicles.tirePressure.rl", "RL", "vehicles.tirePressure.rearLeft", "Rear Left", static r => r.RearLeftPa),
        new("rr", "vehicles.tirePressure.rr", "RR", "vehicles.tirePressure.rearRight", "Rear Right", static r => r.RearRightPa),
    };

    /// <summary>Project a present <paramref name="reading"/> into the display model for <paramref name="units"/>.</summary>
    /// <param name="reading">The latest tyre-pressure snapshot (a present snapshot is always content, per web).</param>
    /// <param name="units">The user's unit preference (web <c>useUnits</c>); only pressure is read.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <returns>The render-ready display model.</returns>
    public static TirePressurePanelDisplay Project(
        TirePressureReading reading,
        UnitPref units,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(reading);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        var corners = new List<TirePressurePanelCorner>(CornerDefs.Length);
        foreach (var def in CornerDefs)
        {
            double? pa = def.Selector(reading);
            string label = localizer.GetString(def.LabelKey, def.LabelFallback);
            string fullLabel = localizer.GetString(def.FullKey, def.FullFallback);
            string value = UnitFormatters.FormatPressure(ToKilopascals(pa), units);
            StatusKind status = TirePressurePanelThresholds.CornerStatus(pa);
            string automationName = string.Format(CultureInfo.CurrentCulture, "{0}: {1}", fullLabel, value);
            corners.Add(new TirePressurePanelCorner(def.Key, label, value, status, automationName));
        }

        var summary = BuildSummary(reading, localizer);

        return new TirePressurePanelDisplay(
            HasData: true,
            Title: localizer.GetString("common.tirePressure", "Tire Pressure"),
            PanelAutomationName: localizer.GetString("vehicles.tirePressure.aria", "Tire pressure for each wheel"),
            EmptyMessage: localizer.GetString("vehicles.tirePressure.empty", "No tire pressure data available"),
            Corners: corners,
            Summary: summary);
    }

    /// <summary>Project the empty (no vehicle / no snapshot) display using the localizer.</summary>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <returns>An empty, no-data display carrying the localized chrome.</returns>
    public static TirePressurePanelDisplay Empty(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return new TirePressurePanelDisplay(
            HasData: false,
            Title: localizer.GetString("common.tirePressure", "Tire Pressure"),
            PanelAutomationName: localizer.GetString("vehicles.tirePressure.aria", "Tire pressure for each wheel"),
            EmptyMessage: localizer.GetString("vehicles.tirePressure.empty", "No tire pressure data available"),
            Corners: Array.Empty<TirePressurePanelCorner>(),
            Summary: null);
    }

    private static TirePressurePanelSummary BuildSummary(TirePressureReading reading, ILocalizer localizer)
    {
        double?[] corners = { reading.FrontLeftPa, reading.FrontRightPa, reading.RearLeftPa, reading.RearRightPa };

        // Web parity: allGood = every corner reported and sits inside the soft band.
        bool allGood = corners.All(pa =>
            pa is { } p
            && p >= TirePressurePanelThresholds.LowWarningPa
            && p <= TirePressurePanelThresholds.HighWarningPa);

        // Web parity: anyBad = some reported corner sits outside the critical band.
        bool anyBad = corners.Any(pa =>
            pa is { } p
            && (p < TirePressurePanelThresholds.LowCriticalPa || p > TirePressurePanelThresholds.HighCriticalPa));

        if (allGood)
        {
            string label = localizer.GetString("vehicles.tirePressure.allNormal", "All Normal");
            return new TirePressurePanelSummary(StatusKind.Success, AllNormalGlyph, label, label);
        }

        if (anyBad)
        {
            string label = localizer.GetString("vehicles.tirePressure.attentionNeeded", "Attention Needed");
            return new TirePressurePanelSummary(StatusKind.Danger, AttentionGlyph, label, label);
        }

        string check = localizer.GetString("vehicles.tirePressure.checkPressure", "Check Pressure");
        return new TirePressurePanelSummary(StatusKind.Warning, CheckGlyph, check, check);
    }

    private static double? ToKilopascals(double? pa) =>
        pa is { } p && !double.IsNaN(p) && !double.IsInfinity(p) ? p / PascalsPerKilopascal : null;

    private sealed record CornerDefinition(
        string Key,
        string LabelKey,
        string LabelFallback,
        string FullKey,
        string FullFallback,
        Func<TirePressureReading, double?> Selector);
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;TirePressureReading&gt;</c>, preserving every freshness flag (cached / refreshing /
/// stale / offline) so the view-model can render the full state matrix. A null / non-object snapshot collapses
/// to <see cref="RepositoryResult{T}.Empty"/> (the web falsy-<c>tireData</c> branch). Kept pure so the
/// parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class TirePressurePanelResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    /// <param name="raw">The raw cache-then-network emission.</param>
    /// <returns>The typed emission with the same status / freshness.</returns>
    public static RepositoryResult<TirePressureReading> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<TirePressureReading>.Loading(),
            LoadStatus.Cached => Present(raw, raw.IsStale, raw.FetchedAt!.Value, RepositoryResult<TirePressureReading>.Cached),
            LoadStatus.Refreshing => Present(raw, raw.IsStale, raw.FetchedAt!.Value, RepositoryResult<TirePressureReading>.Refreshing),
            LoadStatus.Loaded => Loaded(raw),
            LoadStatus.Empty => RepositoryResult<TirePressureReading>.Empty(raw.FetchedAt),
            LoadStatus.Offline => Offline(raw),
            _ => RepositoryResult<TirePressureReading>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }

    private static RepositoryResult<TirePressureReading> Present(
        RepositoryResult<JsonElement> raw,
        bool stale,
        DateTimeOffset fetchedAt,
        Func<TirePressureReading, DateTimeOffset, bool, RepositoryResult<TirePressureReading>> factory)
    {
        return TryParse(raw, out var reading)
            ? factory(reading, fetchedAt, stale)
            : RepositoryResult<TirePressureReading>.Empty(fetchedAt);
    }

    private static RepositoryResult<TirePressureReading> Loaded(RepositoryResult<JsonElement> raw)
    {
        DateTimeOffset fetchedAt = raw.FetchedAt ?? DateTimeOffset.UtcNow;
        return TryParse(raw, out var reading)
            ? RepositoryResult<TirePressureReading>.Loaded(reading, fetchedAt)
            : RepositoryResult<TirePressureReading>.Empty(fetchedAt);
    }

    private static RepositoryResult<TirePressureReading> Offline(RepositoryResult<JsonElement> raw)
    {
        var error = raw.Error ?? new RepositoryError(RepositoryErrorKind.Network, "Offline");
        return TryParse(raw, out var reading)
            ? RepositoryResult<TirePressureReading>.OfflineCached(reading, raw.FetchedAt!.Value, error)
            : RepositoryResult<TirePressureReading>.Empty(raw.FetchedAt);
    }

    private static bool TryParse(RepositoryResult<JsonElement> raw, out TirePressureReading reading)
    {
        if (raw.HasValue && raw.Value.ValueKind == JsonValueKind.Object)
        {
            reading = TirePressureReading.FromJson(raw.Value);
            return true;
        }

        reading = new TirePressureReading(null, null, null, null);
        return false;
    }
}

/// <summary>
/// Canonical registry metadata for the Tire-Pressure panel — the native mirror of the web component
/// (web/src/features/vehicles/components/telemetry-panels/TirePressurePanel.tsx). Centralises the stable id, the
/// diagnostics slug and the localized title so the view and view-model stay free of literal copy.
/// </summary>
public static class TirePressurePanelRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "tire-pressure-panel";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "TirePressurePanel";

    /// <summary>Localized surface title (web <c>common.tirePressure</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <returns>The localized "Tire Pressure" title.</returns>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("common.tirePressure", "Tire Pressure");
    }
}

/// <summary>
/// PII-safe diagnostics for the Tire-Pressure panel (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a pressure value, VIN or vehicle id — so a
/// diagnostics line can never leak vehicle data. Thread-safe.
/// </summary>
public sealed class TirePressurePanelDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">Optional sink invoked with each diagnostics line.</param>
    public TirePressurePanelDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=TirePressurePanel</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={TirePressurePanelRegistration.Slug}");
    }
}
