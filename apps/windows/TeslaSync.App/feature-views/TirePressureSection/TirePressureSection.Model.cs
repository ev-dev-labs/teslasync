using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The lifecycle state a <see cref="TirePressureSectionViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches a P2 feature surface must render for the web
/// vehicle-detail Tire-Pressure section
/// (web/src/features/vehicles/components/vehicle-detail/TirePressureSection.tsx). The web component is a pure
/// child that renders its four-corner grid whenever its <c>tireData</c> prop is present and otherwise draws the
/// "No tire pressure data available" empty state; the native feature-view owns its cache-then-network
/// latest-snapshot read and therefore renders the full state matrix. <see cref="Empty"/> mirrors the web
/// falsy-<c>tireData</c> branch (no snapshot for the vehicle) and is distinct from a transport failure
/// (<see cref="Error"/>).
/// </summary>
public enum TirePressureSectionState
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
/// The SI-Pascal tyre-pressure bands shared with the web helpers
/// (web/src/features/vehicles/components/vehicle-detail/helpers.ts <c>TIRE_PRESSURE_PA</c> +
/// <c>tirePressureVariant</c>). All comparisons stay in Pascals so there is one canonical source of truth;
/// display conversion to kilopascals and then to the user's pressure preference happens at the renderer. A
/// reading is danger outside the critical band, warning inside the soft band, success inside the safe band and
/// neutral when unknown.
/// </summary>
public static class TirePressureSectionThresholds
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
    /// Map an SI-Pascal corner pressure to its semantic badge variant — the native port of the web
    /// <c>tirePressureVariant(pa)</c>: neutral when unknown, danger outside the critical band, warning inside
    /// the soft band, success otherwise.
    /// </summary>
    /// <param name="pa">The corner pressure in SI Pascals, or null.</param>
    /// <returns>The corner's semantic badge variant.</returns>
    public static StatusKind Variant(double? pa)
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
/// One projected, render-ready corner tile — the native analogue of a single web per-corner
/// <c>&lt;GlassPanel&gt;</c> card. Holds the stable corner <see cref="Key"/>, the localized full
/// <see cref="Label"/> (Front Left / Front Right / Rear Left / Rear Right), the already-formatted display-unit
/// <see cref="Value"/> (or an em dash when the corner reported nothing, mirroring the web
/// <c>formatPressure(paToKpa(null))</c>), the semantic <see cref="BadgeStatus"/> driving the badge colour (web
/// <c>tirePressureVariant</c>), the localized <see cref="BadgeLabel"/> (Normal / Low / Critical / No Data) and
/// the Narrator <see cref="AutomationName"/>. Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Key">Stable corner key (<c>fl</c> / <c>fr</c> / <c>rl</c> / <c>rr</c>).</param>
/// <param name="Label">Localized full corner label.</param>
/// <param name="Value">Formatted pressure in the user's display unit, or an em dash.</param>
/// <param name="BadgeStatus">Semantic variant driving the badge colour.</param>
/// <param name="BadgeLabel">Localized badge text (Normal / Low / Critical / No Data).</param>
/// <param name="AutomationName">Spoken summary (corner label + value + badge state).</param>
public sealed record TirePressureSectionTile(
    string Key,
    string Label,
    string Value,
    StatusKind BadgeStatus,
    string BadgeLabel,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the Tire-Pressure section — the native analogue of everything the
/// web component computes before returning its <c>GlassPanel</c>. Carries the always-present chrome strings
/// (title / panel aria / empty message), the <see cref="HasData"/> gate (web truthy <c>tireData</c>) and the
/// four per-corner <see cref="Tiles"/> (in FL / FR / RL / RR order). Pure data so the projection is unit-tested
/// without a UI host.
/// </summary>
/// <param name="HasData">True when a snapshot is present (web truthy <c>tireData</c>).</param>
/// <param name="Title">Localized surface title (web "Tire Pressure").</param>
/// <param name="PanelAutomationName">Localized section Narrator label.</param>
/// <param name="EmptyMessage">Localized empty-state message.</param>
/// <param name="Tiles">The four per-corner tiles, in web order (FL / FR / RL / RR).</param>
public sealed record TirePressureSectionDisplay(
    bool HasData,
    string Title,
    string PanelAutomationName,
    string EmptyMessage,
    IReadOnlyList<TirePressureSectionTile> Tiles);

/// <summary>
/// Pure projection from a raw <see cref="TirePressureReading"/> to the display model — the native port of the
/// web section's per-corner <c>formatPressure(paToKpa(value))</c> readout, the <c>tirePressureVariant(value)</c>
/// badge variant and the Normal / Low / Critical / No Data badge text in
/// web/src/features/vehicles/components/vehicle-detail/TirePressureSection.tsx. SI Pascals are divided to
/// kilopascals and converted to the user's display unit here (and only here, via
/// <see cref="UnitFormatters.FormatPressure(double?, UnitPref, int?)"/>); every label resolves through the
/// i18n facade.
/// </summary>
public static class TirePressureSectionProjection
{
    /// <summary>Segoe Fluent "StatusCircleRing" glyph (web lucide <c>CircleDot</c>) for the title and empty state.</summary>
    public const string CircleDotGlyph = "\uEA3A";

    // SI Pascals → kilopascals before the display-unit conversion (web `paToKpa(pa)` = `pa / 1000`).
    private const double PascalsPerKilopascal = 1000;

    private static readonly CornerDefinition[] CornerDefs =
    {
        new("fl", "vehicles.detail.tireFl", "Front Left", static r => r.FrontLeftPa),
        new("fr", "vehicles.detail.tireFr", "Front Right", static r => r.FrontRightPa),
        new("rl", "vehicles.detail.tireRl", "Rear Left", static r => r.RearLeftPa),
        new("rr", "vehicles.detail.tireRr", "Rear Right", static r => r.RearRightPa),
    };

    /// <summary>Project a present <paramref name="reading"/> into the display model for <paramref name="units"/>.</summary>
    /// <param name="reading">The latest tyre-pressure snapshot (a present snapshot is always content, per web).</param>
    /// <param name="units">The user's unit preference (web <c>useUnits</c>); only pressure is read.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <returns>The render-ready display model.</returns>
    public static TirePressureSectionDisplay Project(
        TirePressureReading reading,
        UnitPref units,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(reading);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        var tiles = new List<TirePressureSectionTile>(CornerDefs.Length);
        foreach (var def in CornerDefs)
        {
            double? pa = def.Selector(reading);
            string label = localizer.GetString(def.LabelKey, def.LabelFallback);
            string value = UnitFormatters.FormatPressure(ToKilopascals(pa), units);
            StatusKind status = TirePressureSectionThresholds.Variant(pa);
            (string badgeKey, string badgeFallback) = BadgeFor(status);
            string badgeLabel = localizer.GetString(badgeKey, badgeFallback);
            string automationName = string.Format(
                CultureInfo.CurrentCulture, "{0}: {1}, {2}", label, value, badgeLabel);
            tiles.Add(new TirePressureSectionTile(def.Key, label, value, status, badgeLabel, automationName));
        }

        return new TirePressureSectionDisplay(
            HasData: true,
            Title: localizer.GetString("vehicles.detail.tirePressure", "Tire Pressure"),
            PanelAutomationName: localizer.GetString("vehicles.detail.tirePressure.aria", "Tire pressure for each wheel"),
            EmptyMessage: localizer.GetString("vehicles.detail.noTireData", "No tire pressure data available"),
            Tiles: tiles);
    }

    /// <summary>Project the empty (no vehicle / no snapshot) display using the localizer.</summary>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <returns>An empty, no-data display carrying the localized chrome.</returns>
    public static TirePressureSectionDisplay Empty(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return new TirePressureSectionDisplay(
            HasData: false,
            Title: localizer.GetString("vehicles.detail.tirePressure", "Tire Pressure"),
            PanelAutomationName: localizer.GetString("vehicles.detail.tirePressure.aria", "Tire pressure for each wheel"),
            EmptyMessage: localizer.GetString("vehicles.detail.noTireData", "No tire pressure data available"),
            Tiles: Array.Empty<TirePressureSectionTile>());
    }

    /// <summary>
    /// Map a corner's badge <paramref name="status"/> to its localized badge text — the native port of the web
    /// badge ternary. The web text branches map 1:1 onto <c>tirePressureVariant</c>'s bands: the soft-band
    /// "Low" covers both the soft-low and soft-high sides, exactly as the web ternary does, so a single
    /// status → text mapping reproduces it without drift.
    /// </summary>
    /// <param name="status">The corner's semantic badge variant.</param>
    /// <returns>The i18n key and English fallback for the badge text.</returns>
    public static (string Key, string Fallback) BadgeFor(StatusKind status) => status switch
    {
        StatusKind.Success => ("common.normal", "Normal"),
        StatusKind.Warning => ("common.low", "Low"),
        StatusKind.Danger => ("common.critical", "Critical"),
        _ => ("common.noData", "No Data"),
    };

    private static double? ToKilopascals(double? pa) =>
        pa is { } p && !double.IsNaN(p) && !double.IsInfinity(p) ? p / PascalsPerKilopascal : null;

    private sealed record CornerDefinition(
        string Key,
        string LabelKey,
        string LabelFallback,
        Func<TirePressureReading, double?> Selector);
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;TirePressureReading&gt;</c>, preserving every freshness flag (cached / refreshing /
/// stale / offline) so the view-model can render the full state matrix. A null / non-object snapshot collapses
/// to <see cref="RepositoryResult{T}.Empty"/> (the web falsy-<c>tireData</c> branch). Kept pure so the
/// parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class TirePressureSectionResultMapper
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
/// Canonical registry metadata for the Tire-Pressure section — the native mirror of the web component
/// (web/src/features/vehicles/components/vehicle-detail/TirePressureSection.tsx). Centralises the stable id, the
/// diagnostics slug and the localized title so the view and view-model stay free of literal copy.
/// </summary>
public static class TirePressureSectionRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "tire-pressure-section";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "TirePressureSection";

    /// <summary>Localized surface title (web <c>vehicles.detail.tirePressure</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <returns>The localized "Tire Pressure" title.</returns>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("vehicles.detail.tirePressure", "Tire Pressure");
    }
}

/// <summary>
/// PII-safe diagnostics for the Tire-Pressure section (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a pressure value, VIN or vehicle id — so a
/// diagnostics line can never leak vehicle data. Thread-safe.
/// </summary>
public sealed class TirePressureSectionDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">Optional sink invoked with each diagnostics line.</param>
    public TirePressureSectionDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=TirePressureSection</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={TirePressureSectionRegistration.Slug}");
    }
}
