using System.Collections.Generic;
using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The lifecycle state a <see cref="WeekOverWeekSummaryViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the surface renders. The web component
/// (web/src/features/analytics/components/weekly-digest/WeekOverWeekSummary.tsx) is presentational: it
/// receives a resolved <c>DigestMetrics</c> as a prop and only reads <c>useTranslation</c> +
/// <c>useFormatting</c>. The native feature-view owns its own weekly-digest read and therefore renders the
/// full state matrix the P2 contract mandates. Every branch maps onto a visible surface — none is hidden.
/// <see cref="Empty"/> mirrors the parent page's <c>{hasData ? … : &lt;EmptyState&gt;}</c> gate (the digest
/// query resolved to no data object), distinct from a transport failure (<see cref="Error"/>).
/// </summary>
public enum WeekOverWeekSummaryState
{
    /// <summary>Initial fetch with no cached digest — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh digest (or non-stale cache) with this-week-vs-last-week metrics to compare.</summary>
    Loaded,

    /// <summary>No vehicle resolved, or the response carried no digest object — render the empty surface.</summary>
    Empty,

    /// <summary>The request failed and no cached digest exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached digest older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached digest remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The this-week-vs-last-week rollup from <c>GET /vehicles/{vehicleID}/weekly-digest</c> the surface
/// consumes — the native analogue of the <c>DigestMetrics</c> the web <c>WeekOverWeekSummary</c> reads off
/// its prop. Field names mirror the Go API's snake_case JSON tags (<c>distance_km</c>, <c>energy_kwh</c>,
/// <c>cost</c>, <c>efficiency</c>, <c>drives</c> and the <c>prev_*</c> peers — see
/// internal/api/weeklydigest/handler.go). Distance is kilometres, energy kilowatt-hours and efficiency
/// Wh/km — the metric units the web component renders verbatim (it hardcodes <c>km</c> / <c>kWh</c> /
/// <c>Wh/km</c> / <c>kg</c> and performs no unit conversion). CO₂ saved is derived, not transported (web
/// <c>energyUsed * CO2_PER_KWH_GASOLINE_KG</c>). A <see langword="null"/> parse result models the web
/// <c>metrics</c> being absent (the "No data" surface). Parsing is null-tolerant so a partial body never
/// throws.
/// </summary>
/// <param name="Drives">Drive count this week (web <c>totalDrives</c>).</param>
/// <param name="DistanceKm">Distance driven this week, kilometres (web <c>totalDistance</c>).</param>
/// <param name="EnergyKwh">Energy used this week, kilowatt-hours (web <c>energyUsed</c>).</param>
/// <param name="Cost">Charging cost this week (web <c>chargingCost</c>).</param>
/// <param name="EfficiencyWhKm">Average efficiency this week, Wh/km (web <c>avgEfficiency</c>).</param>
/// <param name="PrevDrives">Drive count last week (web <c>prevDriveCount</c>).</param>
/// <param name="PrevDistanceKm">Distance driven last week, kilometres (web <c>prevDistance</c>).</param>
/// <param name="PrevEnergyKwh">Energy used last week, kilowatt-hours (web <c>prevEnergy</c>).</param>
/// <param name="PrevCost">Charging cost last week (web <c>prevChargingCost</c>).</param>
/// <param name="PrevEfficiencyWhKm">Average efficiency last week, Wh/km (web <c>prevAvgEfficiency</c>).</param>
public sealed record WeekOverWeekMetrics(
    double Drives,
    double DistanceKm,
    double EnergyKwh,
    double Cost,
    double EfficiencyWhKm,
    double PrevDrives,
    double PrevDistanceKm,
    double PrevEnergyKwh,
    double PrevCost,
    double PrevEfficiencyWhKm)
{
    /// <summary>
    /// Kilograms of CO₂ saved per kilowatt-hour versus a gasoline car — the web
    /// <c>CO2_PER_KWH_GASOLINE_KG</c> constant (web/src/features/analytics/components/weekly-digest/constants.ts).
    /// </summary>
    public const double Co2PerKwhKg = 0.21;

    /// <summary>An all-zero digest — the projection seed before the first emission.</summary>
    public static WeekOverWeekMetrics Empty { get; } = new(0, 0, 0, 0, 0, 0, 0, 0, 0, 0);

    /// <summary>This week's CO₂ saved, kilograms (web <c>co2Saved = energyUsed * CO2_PER_KWH_GASOLINE_KG</c>).</summary>
    public double Co2SavedKg => EnergyKwh * Co2PerKwhKg;

    /// <summary>Last week's CO₂ saved, kilograms (web <c>prevCo2 = prevEnergy * CO2_PER_KWH_GASOLINE_KG</c>).</summary>
    public double PrevCo2SavedKg => PrevEnergyKwh * Co2PerKwhKg;

    /// <summary>
    /// Project a <c>GET /vehicles/{vehicleID}/weekly-digest</c> response into a tolerant digest. Returns
    /// <see langword="null"/> when the body is not a JSON object — the native analogue of the web
    /// <c>metrics</c> being absent (the "No data" surface). Any object yields a digest (matching the web's
    /// truthy gate); absent or non-numeric fields coalesce to zero like the web's per-field reads.
    /// </summary>
    public static WeekOverWeekMetrics? FromResponse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new WeekOverWeekMetrics(
            Drives: ReadDouble(root, "drives") ?? 0,
            DistanceKm: ReadDouble(root, "distance_km") ?? 0,
            EnergyKwh: ReadDouble(root, "energy_kwh") ?? 0,
            Cost: ReadDouble(root, "cost") ?? 0,
            EfficiencyWhKm: ReadDouble(root, "efficiency") ?? 0,
            PrevDrives: ReadDouble(root, "prev_drives") ?? 0,
            PrevDistanceKm: ReadDouble(root, "prev_distance_km") ?? 0,
            PrevEnergyKwh: ReadDouble(root, "prev_energy_kwh") ?? 0,
            PrevCost: ReadDouble(root, "prev_cost") ?? 0,
            PrevEfficiencyWhKm: ReadDouble(root, "prev_efficiency") ?? 0);
    }

    private static double? ReadDouble(JsonElement obj, string name)
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

/// <summary>The direction a week-over-week change moved (web <c>trend.direction</c>).</summary>
public enum WeekOverWeekTrendDirection
{
    /// <summary>The metric increased week-over-week (web <c>'up'</c> — ↑).</summary>
    Up,

    /// <summary>The metric decreased week-over-week (web <c>'down'</c> — ↓).</summary>
    Down,

    /// <summary>No meaningful change (web <c>'flat'</c> — —).</summary>
    Flat,
}

/// <summary>
/// One week-over-week comparison chip — the native port of the web <c>trendFor()</c> result
/// (web/src/features/analytics/components/weekly-digest/helpers.ts). Holds the arrow direction, the
/// already-formatted signed percentage text and the good/bad flag (so a "lower is better" metric like
/// energy, cost or efficiency colours a decrease as positive). Pure data — no WinUI types.
/// </summary>
/// <param name="Direction">The arrow the chip renders (web <c>↑ / ↓ / —</c>).</param>
/// <param name="Value">The localized signed magnitude text (web <c>`${isUp ? '+' : ''}${fmtNumber(pct, 1)}%`</c> or "0%").</param>
/// <param name="Positive">True when the change is a desirable outcome (drives the success tint).</param>
public sealed record WeekOverWeekTrend(WeekOverWeekTrendDirection Direction, string Value, bool Positive)
{
    /// <summary>Web parity: a change whose absolute difference is below this renders as flat "0%".</summary>
    private const double FlatThreshold = 0.01;

    /// <summary>
    /// The signed percent change between <paramref name="current"/> and <paramref name="previous"/> — the
    /// native port of the web <c>pctChange</c>: a zero previous yields 100 when the current is positive (else
    /// 0), otherwise the signed percentage of the absolute previous.
    /// </summary>
    public static double PctChange(double current, double previous)
    {
        if (previous == 0)
        {
            return current > 0 ? 100 : 0;
        }

        return (current - previous) / Math.Abs(previous) * 100.0;
    }

    /// <summary>
    /// Compute the week-over-week trend for a current/previous pair — a row-for-row port of the web
    /// <c>trendFor(current, previous, invertPositive)</c>: a sub-0.01 absolute change renders a flat "0%"
    /// (flagged positive), otherwise the signed direction with the signed percentage and a positive flag that
    /// inverts for "lower is better" metrics. The percentage carries an explicit "+" when up and the intrinsic
    /// "-" when down.
    /// </summary>
    /// <param name="current">The current-week value.</param>
    /// <param name="previous">The previous-week value.</param>
    /// <param name="invertPositive">True when a decrease is the desirable outcome (energy, cost, efficiency).</param>
    public static WeekOverWeekTrend Of(double current, double previous, bool invertPositive = false)
    {
        double diff = current - previous;
        if (Math.Abs(diff) < FlatThreshold)
        {
            return new WeekOverWeekTrend(WeekOverWeekTrendDirection.Flat, "0%", true);
        }

        double pct = PctChange(current, previous);
        bool isUp = diff > 0;
        string value = (isUp ? "+" : string.Empty) + ScalarFormatters.FormatNumber(pct, 1) + "%";
        return new WeekOverWeekTrend(
            isUp ? WeekOverWeekTrendDirection.Up : WeekOverWeekTrendDirection.Down,
            value,
            invertPositive ? !isUp : isUp);
    }
}

/// <summary>
/// One projected, display-ready stat card consumed by the WinUI view (the native analogue of a web
/// <c>StatCard</c>). Holds the localized label, the already-formatted value, the optional unit suffix, the
/// resolved Fluent glyph, the week-over-week <see cref="WeekOverWeekTrend"/> and a Narrator automation name.
/// Pure data — no WinUI types.
/// </summary>
/// <param name="Label">The localized metric label (Distance / Drives / Energy / Cost / Efficiency / CO₂ Saved).</param>
/// <param name="Value">The already-formatted value.</param>
/// <param name="Unit">Optional unit suffix (km / kWh / Wh/km / kg), or null for drive count and currency.</param>
/// <param name="Glyph">The Fluent glyph accenting the card.</param>
/// <param name="Trend">The week-over-week comparison chip.</param>
/// <param name="AutomationName">The Narrator name describing the whole card.</param>
public sealed record WeekOverWeekCard(
    string Label,
    string Value,
    string? Unit,
    string Glyph,
    WeekOverWeekTrend Trend,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the week-over-week comparison — the localized panel title plus
/// the six metric cards (Distance, Drives, Energy, Cost, Efficiency, CO₂ Saved) the web component renders in
/// its responsive grid. Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Title">The localized panel title (web "Week-over-Week Comparison").</param>
/// <param name="Cards">The six metric cards, in web order.</param>
/// <param name="HasData">True when the cards reflect a resolved digest (always true once projected from data).</param>
public sealed record WeekOverWeekDisplay(string Title, IReadOnlyList<WeekOverWeekCard> Cards, bool HasData);

/// <summary>
/// Pure projection from a parsed <see cref="WeekOverWeekMetrics"/> to the render-ready
/// <see cref="WeekOverWeekDisplay"/> — the native port of the JSX + <c>t()</c> + <c>useFormatting</c>
/// composition in web/src/features/analytics/components/weekly-digest/WeekOverWeekSummary.tsx. Every label
/// resolves through the i18n facade; the six values are formatted exactly once here (the metric units the web
/// hardcodes, the currency via the active symbol); the trends are pure ratio maths. No WinUI types —
/// unit-tested without a UI host.
/// </summary>
public static class WeekOverWeekProjection
{
    /// <summary>The default currency symbol when the host supplies none (web <c>useFormatting</c> default "$").</summary>
    public const string DefaultCurrencySymbol = "$";

    /// <summary>i18n key for the panel title (web <c>analytics.weeklyDigest.weekOverWeek</c>).</summary>
    public const string TitleKey = "translation.analytics.weeklyDigest.weekOverWeek";

    /// <summary>i18n key for the Distance card label.</summary>
    public const string DistanceKey = "translation.analytics.weeklyDigest.distance";

    /// <summary>i18n key for the Drives card label.</summary>
    public const string DrivesKey = "translation.analytics.weeklyDigest.drives";

    /// <summary>i18n key for the Energy card label.</summary>
    public const string EnergyKey = "translation.analytics.weeklyDigest.energy";

    /// <summary>i18n key for the Cost card label.</summary>
    public const string CostKey = "translation.analytics.weeklyDigest.cost";

    /// <summary>i18n key for the Efficiency card label.</summary>
    public const string EfficiencyKey = "translation.analytics.weeklyDigest.efficiency";

    /// <summary>i18n key for the CO₂ Saved card label.</summary>
    public const string Co2Key = "translation.analytics.weeklyDigest.co2";

    // Decorative Fluent glyphs (Narrator-hidden in the view); the closest Segoe Fluent codes already used
    // elsewhere in the app for these concepts — see the sibling WeeklySummaryCardWidget / Drives surfaces.
    private const string DistanceGlyph = "\uE804";   // Car (web Car)
    private const string DrivesGlyph = "\uE7C0";     // Route (web Activity — drive count)
    private const string EnergyGlyph = "\uE945";     // LightningBolt (web Zap)
    private const string CostGlyph = "\uE1D3";       // Money (web Fuel — charging cost)
    private const string EfficiencyGlyph = "\uE950"; // Gauge (web BarChart3)
    private const string Co2Glyph = "\uE909";        // World / globe — eco (web Leaf)

    // web display precisions: fmtNumber(x, 1) for distance/energy/efficiency/co2, fmtInt for drives,
    // formatCurrency(cost, 2) for the cost.
    private const int OneDecimal = 1;
    private const int CostDecimals = 2;
    private const int DriveCountDecimals = 0;

    private const string DistanceUnit = "km";
    private const string EnergyUnit = "kWh";
    private const string EfficiencyUnit = "Wh/km";
    private const string Co2Unit = "kg";

    /// <summary>Project <paramref name="data"/> into the render-ready display using the active currency symbol.</summary>
    /// <param name="data">The parsed weekly digest.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="currencySymbol">The currency symbol for the cost card; defaults to "$" when null/blank.</param>
    public static WeekOverWeekDisplay Project(WeekOverWeekMetrics data, ILocalizer localizer, string? currencySymbol = null)
    {
        ArgumentNullException.ThrowIfNull(data);
        ArgumentNullException.ThrowIfNull(localizer);

        string symbol = string.IsNullOrWhiteSpace(currencySymbol) ? DefaultCurrencySymbol : currencySymbol;

        string title = localizer.GetString(TitleKey, "Week-over-Week Comparison");
        string distanceLabel = localizer.GetString(DistanceKey, "Distance");
        string drivesLabel = localizer.GetString(DrivesKey, "Drives");
        string energyLabel = localizer.GetString(EnergyKey, "Energy");
        string costLabel = localizer.GetString(CostKey, "Cost");
        string efficiencyLabel = localizer.GetString(EfficiencyKey, "Efficiency");
        string co2Label = localizer.GetString(Co2Key, "CO\u2082 Saved");

        string distanceValue = ScalarFormatters.FormatNumber(data.DistanceKm, OneDecimal);
        string drivesValue = ScalarFormatters.FormatNumber(data.Drives, DriveCountDecimals);
        string energyValue = ScalarFormatters.FormatNumber(data.EnergyKwh, OneDecimal);
        string costValue = ScalarFormatters.FormatCurrency(data.Cost, symbol, CostDecimals);
        string efficiencyValue = ScalarFormatters.FormatNumber(data.EfficiencyWhKm, OneDecimal);
        string co2Value = ScalarFormatters.FormatNumber(data.Co2SavedKg, OneDecimal);

        var cards = new List<WeekOverWeekCard>(6)
        {
            new(distanceLabel, distanceValue, DistanceUnit, DistanceGlyph,
                WeekOverWeekTrend.Of(data.DistanceKm, data.PrevDistanceKm),
                AutomationName(distanceLabel, distanceValue, DistanceUnit)),
            new(drivesLabel, drivesValue, null, DrivesGlyph,
                WeekOverWeekTrend.Of(data.Drives, data.PrevDrives),
                AutomationName(drivesLabel, drivesValue, null)),
            new(energyLabel, energyValue, EnergyUnit, EnergyGlyph,
                WeekOverWeekTrend.Of(data.EnergyKwh, data.PrevEnergyKwh, invertPositive: true),
                AutomationName(energyLabel, energyValue, EnergyUnit)),
            new(costLabel, costValue, null, CostGlyph,
                WeekOverWeekTrend.Of(data.Cost, data.PrevCost, invertPositive: true),
                AutomationName(costLabel, costValue, null)),
            new(efficiencyLabel, efficiencyValue, EfficiencyUnit, EfficiencyGlyph,
                WeekOverWeekTrend.Of(data.EfficiencyWhKm, data.PrevEfficiencyWhKm, invertPositive: true),
                AutomationName(efficiencyLabel, efficiencyValue, EfficiencyUnit)),
            new(co2Label, co2Value, Co2Unit, Co2Glyph,
                WeekOverWeekTrend.Of(data.Co2SavedKg, data.PrevCo2SavedKg),
                AutomationName(co2Label, co2Value, Co2Unit)),
        };

        return new WeekOverWeekDisplay(title, cards, true);
    }

    /// <summary>An empty display (title only, no cards) used as the view-model seed before the first emission.</summary>
    public static WeekOverWeekDisplay EmptyDisplay(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return new WeekOverWeekDisplay(
            localizer.GetString(TitleKey, "Week-over-Week Comparison"),
            Array.Empty<WeekOverWeekCard>(),
            false);
    }

    private static string AutomationName(string label, string value, string? unit) =>
        string.IsNullOrEmpty(unit)
            ? string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, value)
            : string.Format(CultureInfo.CurrentCulture, "{0}: {1} {2}", label, value, unit);
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;WeekOverWeekMetrics&gt;</c>, preserving every freshness flag
/// (cached / refreshing / stale / offline) so the view-model can render the full state matrix. A payload that
/// is not a JSON object collapses to <see cref="RepositoryResult{T}.Empty"/> — the web "No data" gate. Kept
/// pure so the parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class WeekOverWeekResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s digest payload (when present) while preserving its status.</summary>
    public static RepositoryResult<WeekOverWeekMetrics> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        WeekOverWeekMetrics? Parse() => raw.HasValue ? WeekOverWeekMetrics.FromResponse(raw.Value) : null;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<WeekOverWeekMetrics>.Loading(),
            LoadStatus.Cached => Parse() is { } cached
                ? RepositoryResult<WeekOverWeekMetrics>.Cached(cached, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<WeekOverWeekMetrics>.Empty(raw.FetchedAt),
            LoadStatus.Refreshing => Parse() is { } refreshing
                ? RepositoryResult<WeekOverWeekMetrics>.Refreshing(refreshing, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<WeekOverWeekMetrics>.Empty(raw.FetchedAt),
            LoadStatus.Loaded => Parse() is { } loaded
                ? RepositoryResult<WeekOverWeekMetrics>.Loaded(loaded, raw.FetchedAt ?? DateTimeOffset.UtcNow)
                : RepositoryResult<WeekOverWeekMetrics>.Empty(raw.FetchedAt),
            LoadStatus.Empty => RepositoryResult<WeekOverWeekMetrics>.Empty(raw.FetchedAt),
            LoadStatus.Offline => Parse() is { } offline
                ? RepositoryResult<WeekOverWeekMetrics>.OfflineCached(offline, raw.FetchedAt!.Value, raw.Error!)
                : RepositoryResult<WeekOverWeekMetrics>.Empty(raw.FetchedAt),
            _ => RepositoryResult<WeekOverWeekMetrics>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}

/// <summary>
/// Canonical registry metadata for the Week-over-Week Comparison surface — the native mirror of the web
/// component (web/src/features/analytics/components/weekly-digest/WeekOverWeekSummary.tsx, rendered inside the
/// Weekly Digest analytics page). Centralises the stable id, category and diagnostics slug so the view and
/// view-model stay free of literal identifiers.
/// </summary>
public static class WeekOverWeekSummaryRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "week-over-week-summary";

    /// <summary>Surface category (matches the web analytics feature).</summary>
    public const string Category = "analytics";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "WeekOverWeekSummary";
}

/// <summary>
/// PII-safe diagnostics for the Week-over-Week Comparison surface (P1/S11 diagnostics contract). Records only
/// the operational <c>view.opened</c> event with the surface slug — never a distance, energy figure, cost,
/// VIN or vehicle id — so a diagnostics line can never leak vehicle data. Thread-safe.
/// </summary>
public sealed class WeekOverWeekSummaryDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public WeekOverWeekSummaryDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=WeekOverWeekSummary</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={WeekOverWeekSummaryRegistration.Slug}");
    }
}
