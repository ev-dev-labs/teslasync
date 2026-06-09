using System.Collections.Generic;
using System.Globalization;
using TeslaSync.App.Core;
using TeslaSync.App.Core.DataDisplay;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The coarse charger category a <c>ChargingSessionCard</c> keys its badge / glow off — the native mirror of the
/// web <c>ChargerCategory</c> union (<c>'home' | 'supercharger' | 'dc' | 'unknown'</c>) from
/// <c>web/src/lib/chargingAggregation.ts</c>. Mapped from the raw <c>charger_type</c> string by
/// <see cref="ChargingSessionMath.CategoryOf"/> exactly as the web <c>getChargerCategory()</c> does.
/// </summary>
public enum ChargerCategory
{
    /// <summary>Home / AC / wall charging (also the null-<c>charger_type</c> default, per the web).</summary>
    Home,

    /// <summary>Tesla Supercharger / TPC.</summary>
    Supercharger,

    /// <summary>Third-party DC fast charging (CCS / CHAdeMO / "fast").</summary>
    Dc,

    /// <summary>A charger string we could not classify.</summary>
    Unknown,
}

/// <summary>
/// Card density — the native mirror of the web <c>density?: 'comfortable' | 'compact'</c> prop. The
/// <see cref="Compact"/> variant hides the secondary metrics row (battery delta, peak/avg power, duration, cost,
/// distance) exactly as the web component does.
/// </summary>
public enum ChargingCardDensity
{
    /// <summary>Full card: header + route + the secondary metrics row (web default).</summary>
    Comfortable,

    /// <summary>Dense card: header + route only, no metrics row (web <c>compact</c>).</summary>
    Compact,
}

/// <summary>
/// The accent glow the card surface resolves to — the WinUI-free analogue of the web
/// <c>glow={ACCENT[cat] === 'red' ? 'cyan' : 'green'}</c> expression (a Supercharger glows cyan, every other
/// category glows green). Mirrors the members of the view-layer <c>GlassGlow</c> so the mapping is unit-tested
/// headlessly and bridged to the WinUI enum only in the view.
/// </summary>
public enum ChargingCardGlow
{
    /// <summary>Cyan accent glow (web <c>'cyan'</c> — a Supercharger session).</summary>
    Cyan,

    /// <summary>Green accent glow (web <c>'green'</c> — home / DC / unknown sessions).</summary>
    Green,
}

/// <summary>
/// The mutually-exclusive render branch of the <c>ChargingSessionCard</c> surface. The web source
/// (<c>web/src/features/charging/components/ChargingSessionCard.tsx</c>) is a pure presentational card: it takes a
/// resolved <c>session</c> prop and performs no fetching, so — exactly like the sibling <c>HighlightCard</c> port
/// — the parent list owns the query lifecycle (the Charging page renders its skeleton / <c>QueryError</c> /
/// page-level empty state once for the whole list before any card is mounted, mounting a card only with a
/// resolved session). There is therefore no fetch-driven error / stale / offline branch to reproduce inside this
/// surface; the only card-local branches are the parent-driven <see cref="Loading"/> skeleton and the
/// missing-session <see cref="Empty"/> fallback a parent grid drives directly. Every branch maps onto a visible
/// surface; none is ever hidden.
/// </summary>
public enum ChargingSessionCardState
{
    /// <summary>The parent has not resolved the session yet (<c>model.Loading</c>) — tokenized skeleton chrome.</summary>
    Loading,

    /// <summary>Resolved with no session — the card chrome over a friendly empty stand-in, never a blank box.</summary>
    Empty,

    /// <summary>A session is present (the web render) — the header, route and (comfortable) metrics row.</summary>
    Ready,
}

/// <summary>
/// The render-time projection of one charging session the card reads — the native, WinUI-free and
/// <c>Generated</c>-free analogue of the web <c>ChargingSession</c> prop. The parent (a charging list /
/// state-holder) maps each API <c>ChargingSession</c> field-for-field into this snapshot; the values stay
/// SI-canonical (Wh, W, seconds, metres, decimal currency, percent) exactly as the API and the web source keep
/// them, so the card converts only at its own display boundary. Pure data — no WinUI / no generated-client types —
/// so the projection is unit-tested without a UI host and compiles in the headless test project.
/// </summary>
/// <param name="Id">The session id (web <c>id</c>) — used only for the selection callback, never displayed.</param>
/// <param name="StartedAt">When charging began (web <c>started_at</c>).</param>
/// <param name="EndedAt">When charging ended (web <c>ended_at</c>), or null while in progress.</param>
/// <param name="ChargerType">Raw charger type string (web <c>charger_type</c>); null historically means home AC.</param>
/// <param name="TotalEnergyAddedWh">Energy added in watt-hours (web <c>total_energy_added_wh</c>).</param>
/// <param name="CostDecimal">Session cost in the user's currency (web <c>cost_decimal</c>), or null when free / unknown.</param>
/// <param name="PeakPowerW">Peak charge power in watts (web <c>peak_power_w</c>), or null.</param>
/// <param name="AvgPowerW">API-reported average power in watts (web <c>avg_power_w</c>), or null.</param>
/// <param name="StartSocPct">State of charge at start, percent (web <c>start_soc_pct</c>), or null.</param>
/// <param name="EndSocPct">State of charge at end, percent (web <c>end_soc_pct</c>), or null.</param>
/// <param name="OdometerStartM">Odometer at start, metres (web <c>start_odometer_m</c>), or null.</param>
/// <param name="OdometerEndM">Odometer at end, metres (web <c>end_odometer_m</c>), or null.</param>
/// <param name="StartPlace">Resolved charger location label (web <c>start_place</c>), or null.</param>
/// <param name="StartLat">Charger latitude (web <c>start_lat</c>), or null.</param>
/// <param name="StartLng">Charger longitude (web <c>start_lng</c>), or null.</param>
public sealed record ChargingSessionSnapshot(
    long Id,
    DateTimeOffset StartedAt,
    DateTimeOffset? EndedAt = null,
    string? ChargerType = null,
    double? TotalEnergyAddedWh = null,
    double? CostDecimal = null,
    double? PeakPowerW = null,
    double? AvgPowerW = null,
    double? StartSocPct = null,
    double? EndSocPct = null,
    double? OdometerStartM = null,
    double? OdometerEndM = null,
    string? StartPlace = null,
    double? StartLat = null,
    double? StartLng = null);

/// <summary>
/// The render-time data model the <c>ChargingSessionCard</c> view binds to — the native analogue of the web
/// component's props (<c>session</c>, <c>selected</c>, <c>onToggleSelect</c>, <c>anomaly</c>, <c>density</c>, plus
/// the distance display context the web threads through <c>toDistanceDisplay</c> / <c>distanceUnit</c>). The card
/// is presentational, so user-facing labels are resolved from the i18n facade by the projection, not passed in.
/// Pure data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Loading">When true the parent has not resolved the session yet (the loading branch).</param>
/// <param name="Session">The session to render (web <c>session</c>); null renders the empty branch.</param>
/// <param name="Selectable">Whether a selection checkbox is shown (web <c>typeof onToggleSelect === 'function'</c>).</param>
/// <param name="Selected">Whether the row is selected (web <c>selected</c>).</param>
/// <param name="AnomalyMessage">The page-level anomaly message to flag inline (web <c>anomaly.message</c>), or null.</param>
/// <param name="Density">The density variant (web <c>density</c>, default comfortable).</param>
/// <param name="DistanceUnit">The user's distance display unit (web <c>distanceUnit</c> + <c>toDistanceDisplay</c>).</param>
public sealed record ChargingSessionCardModel(
    bool Loading,
    ChargingSessionSnapshot? Session,
    bool Selectable = false,
    bool Selected = false,
    string? AnomalyMessage = null,
    ChargingCardDensity Density = ChargingCardDensity.Comfortable,
    DistanceUnit DistanceUnit = DistanceUnit.Km)
{
    /// <summary>The initial model: the parent is still resolving the session, so the loading branch renders.</summary>
    public static ChargingSessionCardModel Pending { get; } = new(true, null);

    /// <summary>A resolved model with no session — the empty branch.</summary>
    public static ChargingSessionCardModel Blank { get; } = new(false, null);
}

/// <summary>
/// One compact metric chip in the secondary row — the native analogue of a web <c>InlineMetric</c> (icon + value)
/// or one of the two raw metric spans (cost-per-kWh, distance gained) the card renders. <see cref="Glyph"/> is the
/// optional decorative Segoe Fluent glyph standing in for the web Lucide icon (null for the cost-per-kWh span,
/// which the web renders icon-less); <see cref="Text"/> is the already-formatted value rendered verbatim; and
/// <see cref="AccentBrushKey"/> is the token brush key the value tints with (muted by default, success for the
/// cost span, power/purple for the distance span — mirroring the web classes).
/// </summary>
/// <param name="Glyph">Decorative Segoe Fluent glyph, or null when the web span has no icon.</param>
/// <param name="Text">The already-formatted, verbatim metric value.</param>
/// <param name="AccentBrushKey">Token brush key the value tints with.</param>
public sealed record ChargingCardMetric(string? Glyph, string Text, string AccentBrushKey);

/// <summary>
/// The fully projected, render-ready view of one card input — the native analogue of everything the web
/// <c>ChargingSessionCard</c> computes before returning its <c>HistoryListRow</c>. Holds the active
/// <see cref="State"/>, the selection state + label, the optional leading battery-friendly score + its aria label,
/// the header (timestamp, duration, charger badge, optional energy / free / anomaly badges), the single-endpoint
/// route label, the (comfortable-only) battery delta + metric chips, the resolved <see cref="Glow"/>, the shared
/// empty / loading copy, and the composed surface <see cref="AutomationName"/>. Pure data so every branch is
/// asserted headlessly.
/// </summary>
public sealed record ChargingSessionCardDisplay(
    ChargingSessionCardState State,
    bool Selectable,
    bool Selected,
    long SessionId,
    string SelectLabel,
    bool HasScore,
    double Score,
    string ScoreAriaLabel,
    string StartedAtText,
    string DurationText,
    string ChargerLabel,
    StatusKind ChargerStatus,
    bool HasEnergyBadge,
    string EnergyBadgeText,
    bool HasFreeBadge,
    string FreeLabel,
    bool HasAnomaly,
    string AnomalyMessage,
    bool HasRoute,
    string RouteLabel,
    bool ShowMetrics,
    double? BatteryStartPct,
    double? BatteryEndPct,
    IReadOnlyList<ChargingCardMetric> Metrics,
    ChargingCardGlow Glow,
    string EmptyMessage,
    string LoadingLabel,
    string AutomationName);

/// <summary>
/// Pure SI/null-safe maths shared by the card projection — the native port of the web helpers the card pulls from
/// <c>@/lib/chargingAggregation</c> (<c>getChargerCategory</c>, <c>durationMinutes</c>, <c>avgPowerW</c>,
/// <c>costPerKwh</c>), <c>charging-curve/helpers</c> (<c>distanceAddedM</c>), <c>@/lib/dateFormat</c>
/// (<c>formatDurationMinutes</c>) and the card's own inline battery-friendly score heuristic. Kept WinUI-free so it
/// is asserted directly in tests.
/// </summary>
public static class ChargingSessionMath
{
    /// <summary>The universal em-dash shown in place of unrenderable / missing values.</summary>
    public const string EmDash = "\u2014";

    /// <summary>
    /// Map a raw <c>charger_type</c> into the coarse category — a 1:1 port of the web <c>getChargerCategory()</c>:
    /// a null/empty type is historically home AC; "super"/"tpc" → Supercharger; "dc"/"ccs"/"chademo"/"fast" → DC;
    /// "home"/"ac"/"wall" → Home; anything else → Unknown.
    /// </summary>
    public static ChargerCategory CategoryOf(string? type)
    {
        if (string.IsNullOrEmpty(type))
        {
            return ChargerCategory.Home;
        }

        if (Has(type, "super") || Has(type, "tpc"))
        {
            return ChargerCategory.Supercharger;
        }

        if (Has(type, "dc") || Has(type, "ccs") || Has(type, "chademo") || Has(type, "fast"))
        {
            return ChargerCategory.Dc;
        }

        if (Has(type, "home") || Has(type, "ac") || Has(type, "wall"))
        {
            return ChargerCategory.Home;
        }

        return ChargerCategory.Unknown;
    }

    // Case-insensitive substring test — the native equivalent of the web `type.toLowerCase().includes(token)`.
    private static bool Has(string value, string token) =>
        value.Contains(token, StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// Duration in (fractional) minutes between start and end — the web <c>durationMinutes(session)</c>. Returns 0
    /// for in-progress sessions or a non-positive / non-finite span so callers never propagate NaN.
    /// </summary>
    public static double DurationMinutes(ChargingSessionSnapshot session)
    {
        ArgumentNullException.ThrowIfNull(session);
        if (session.EndedAt is not { } end)
        {
            return 0;
        }

        double minutes = (end - session.StartedAt).TotalMinutes;
        return double.IsFinite(minutes) && minutes > 0 ? minutes : 0;
    }

    /// <summary>
    /// Average power in watts — the web <c>avgPowerW(session)</c>: total energy added divided by elapsed hours
    /// when both are usable, else the API-provided <c>avg_power_w</c>, else 0.
    /// </summary>
    public static double AvgPowerW(ChargingSessionSnapshot session)
    {
        ArgumentNullException.ThrowIfNull(session);
        double minutes = DurationMinutes(session);
        double energy = session.TotalEnergyAddedWh ?? 0;
        if (minutes > 0 && energy > 0)
        {
            return energy / (minutes / 60.0);
        }

        return session.AvgPowerW ?? 0;
    }

    /// <summary>
    /// Cost per kWh for the session — the web <c>costPerKwh(session)</c>. Null when free / unknown / zero-energy.
    /// </summary>
    public static double? CostPerKwh(ChargingSessionSnapshot session)
    {
        ArgumentNullException.ThrowIfNull(session);
        double energy = session.TotalEnergyAddedWh ?? 0;
        if (energy <= 0)
        {
            return null;
        }

        if (session.CostDecimal is not { } cost || cost <= 0)
        {
            return null;
        }

        return cost / (energy / 1000.0);
    }

    /// <summary>
    /// Distance added (metres) from the odometer delta — the web <c>distanceAddedM(session)</c>. Null when either
    /// odometer reading is missing or the delta is non-positive.
    /// </summary>
    public static double? DistanceAddedM(ChargingSessionSnapshot session)
    {
        ArgumentNullException.ThrowIfNull(session);
        if (session.OdometerStartM is not { } start || session.OdometerEndM is not { } end)
        {
            return null;
        }

        double delta = end - start;
        return delta > 0 ? delta : null;
    }

    /// <summary>
    /// The card's inline per-session "battery-friendly" 0–100 score — a 1:1 port of the heuristic the web card
    /// computes in its leading <c>ScoreBadge</c>: reward starting low (≤30 %) and stopping in the 30→80 % sweet
    /// spot; penalise starting high and charging to 100 %. Null when either SoC endpoint is missing.
    /// </summary>
    public static double? BatteryFriendlyScore(double? startPct, double? endPct)
    {
        if (startPct is not { } start || endPct is not { } end)
        {
            return null;
        }

        double s = 50;
        if (start <= 30)
        {
            s += 30;
        }
        else if (start <= 50)
        {
            s += 15;
        }
        else if (start > 70)
        {
            s -= 10;
        }

        if (end <= 80)
        {
            s += 20;
        }
        else if (end > 90 && end < 100)
        {
            s -= 10;
        }
        else if (end >= 100)
        {
            s -= 25;
        }

        return Math.Max(0, Math.Min(100, s));
    }

    /// <summary>
    /// Minute duration with a rounded-minute remainder ("5m" or "2h 5m") — the web <c>formatDurationMinutes</c>.
    /// Returns the em dash for a non-finite / negative input. The minute remainder is rounded half-away-from-zero
    /// with grouping via <see cref="NumberFormatting"/>, matching the web <c>formatRoundedInt</c>
    /// (<c>Intl.NumberFormat</c> with zero fraction digits).
    /// </summary>
    public static string FormatDurationMinutes(double minutes)
    {
        if (!double.IsFinite(minutes) || minutes < 0)
        {
            return EmDash;
        }

        long hours = (long)Math.Floor(minutes / 60.0);
        string remainder = NumberFormatting.Format(minutes % 60.0, null, 0);
        return hours > 0
            ? string.Create(CultureInfo.InvariantCulture, $"{hours}h {remainder}m")
            : string.Create(CultureInfo.InvariantCulture, $"{remainder}m");
    }
}

/// <summary>
/// Pure projection from a <see cref="ChargingSessionCardModel"/> to its <see cref="ChargingSessionCardDisplay"/> —
/// the native port of <c>web/src/features/charging/components/ChargingSessionCard.tsx</c>. The branch precedence
/// mirrors the card lifecycle (loading → empty → ready); the charger badge variant, the energy / free / anomaly
/// badges, the single-endpoint route, the leading battery-friendly score and the comfortable-only metric chips all
/// reproduce the web composition with the web's exact formatting (<c>fmtNumber</c> / <c>fmtInt</c> /
/// <c>formatCurrency</c> / <c>formatDurationMinutes</c>) and unit suffixes. Non-finite numbers are coerced to zero
/// (the web <c>safeNumber</c> guard inside the formatters). Every user-facing label resolves through the i18n
/// facade using keys that mirror the web <c>charging</c> namespace. No WinUI types — unit-tested without a host.
/// </summary>
public static class ChargingSessionCardProjection
{
    /// <summary>Token brush key for muted metric text (the web <c>InlineMetric</c> default tone).</summary>
    public const string MutedBrushKey = "TsColorTextMutedBrush";

    /// <summary>Token brush key for the cost chip (the web <c>text-emerald-300</c>).</summary>
    public const string CostBrushKey = "TsColorSuccessBrush";

    /// <summary>Token brush key for the distance chip (the web <c>text-purple-300</c>).</summary>
    public const string DistanceBrushKey = "TsChartPowerBrush";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade + currency.</summary>
    /// <param name="model">The render-time data model (the web props).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="currencySymbol">The active currency symbol for the cost chips (web <c>formatCurrency</c>; default <c>$</c>).</param>
    /// <param name="decimalPrecision">The user's default decimal precision (web global precision; default 2).</param>
    public static ChargingSessionCardDisplay Project(
        ChargingSessionCardModel model,
        ILocalizer localizer,
        string? currencySymbol = null,
        int decimalPrecision = 2)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        string currency = string.IsNullOrWhiteSpace(currencySymbol) ? "$" : currencySymbol;
        int precision = decimalPrecision < 0 ? 0 : decimalPrecision;

        string emptyMessage = localizer.GetString("translation.charging.session.empty", "No charging session to show");
        string loadingLabel = localizer.GetString("translation.common.loading", "Loading");
        string selectLabel = localizer.GetString("translation.selectSession", "Select charging session");

        if (model.Loading)
        {
            return Skeleton(ChargingSessionCardState.Loading, loadingLabel, emptyMessage, loadingLabel, selectLabel);
        }

        if (model.Session is not { } session)
        {
            return Skeleton(ChargingSessionCardState.Empty, emptyMessage, emptyMessage, loadingLabel, selectLabel);
        }

        ChargerCategory category = ChargingSessionMath.CategoryOf(session.ChargerType);

        double durationMin = ChargingSessionMath.DurationMinutes(session);
        double energyKwh = (session.TotalEnergyAddedWh ?? 0) / 1000.0;
        bool isFree = session.CostDecimal is not { } cost || cost == 0;

        string startedAtText = DateTimeFormatting.Format(session.StartedAt, DateTimeVariant.Full, session.StartedAt);
        string durationText = ChargingSessionMath.FormatDurationMinutes(durationMin);
        string chargerLabel = ChargerLabel(category, localizer);

        bool hasEnergyBadge = energyKwh > 0;
        string energyBadgeText = string.Create(
            CultureInfo.InvariantCulture, $"{NumberFormatting.Format(Safe(energyKwh), null, precision)} kWh");

        bool hasFree = isFree && energyKwh > 0;
        string freeLabel = localizer.GetString("translation.charging.table.free", "Free");

        bool hasAnomaly = !string.IsNullOrWhiteSpace(model.AnomalyMessage);
        string anomalyMessage = model.AnomalyMessage ?? string.Empty;

        double? score = ChargingSessionMath.BatteryFriendlyScore(session.StartSocPct, session.EndSocPct);
        string scoreAria = ScoreAria(score, localizer);

        string routeLabel = RouteLabel(session);
        bool hasRoute = !string.IsNullOrEmpty(routeLabel);

        bool showMetrics = model.Density != ChargingCardDensity.Compact;
        IReadOnlyList<ChargingCardMetric> metrics = showMetrics
            ? BuildMetrics(session, durationMin, model.DistanceUnit, currency, precision)
            : [];

        var display = new ChargingSessionCardDisplay(
            State: ChargingSessionCardState.Ready,
            Selectable: model.Selectable,
            Selected: model.Selected,
            SessionId: session.Id,
            SelectLabel: selectLabel,
            HasScore: score is not null,
            Score: score ?? double.NaN,
            ScoreAriaLabel: scoreAria,
            StartedAtText: startedAtText,
            DurationText: durationText,
            ChargerLabel: chargerLabel,
            ChargerStatus: ChargerStatus(category),
            HasEnergyBadge: hasEnergyBadge,
            EnergyBadgeText: energyBadgeText,
            HasFreeBadge: hasFree,
            FreeLabel: freeLabel,
            HasAnomaly: hasAnomaly,
            AnomalyMessage: anomalyMessage,
            HasRoute: hasRoute,
            RouteLabel: hasRoute ? routeLabel : ChargingSessionMath.EmDash,
            ShowMetrics: showMetrics,
            BatteryStartPct: session.StartSocPct,
            BatteryEndPct: session.EndSocPct,
            Metrics: metrics,
            Glow: category == ChargerCategory.Supercharger ? ChargingCardGlow.Cyan : ChargingCardGlow.Green,
            EmptyMessage: emptyMessage,
            LoadingLabel: loadingLabel,
            AutomationName: string.Empty);

        return display with { AutomationName = BuildAutomationName(display) };
    }

    /// <summary>Map a category to its localized charger-type label (the web <c>chargerLabels[cat]</c>).</summary>
    public static string ChargerLabel(ChargerCategory category, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return category switch
        {
            ChargerCategory.Supercharger => localizer.GetString("translation.charging.chargerTypes.supercharger", "Supercharger"),
            ChargerCategory.Dc => localizer.GetString("translation.charging.chargerTypes.dc", "DC Fast"),
            ChargerCategory.Home => localizer.GetString("translation.charging.chargerTypes.home", "Home / AC"),
            _ => localizer.GetString("translation.charging.chargerTypes.unknown", "Charger"),
        };
    }

    /// <summary>
    /// Map a category to its badge status — the web ternary
    /// <c>cat === 'supercharger' ? 'danger' : cat === 'dc' ? 'warning' : 'success'</c>.
    /// </summary>
    public static StatusKind ChargerStatus(ChargerCategory category) => category switch
    {
        ChargerCategory.Supercharger => StatusKind.Danger,
        ChargerCategory.Dc => StatusKind.Warning,
        _ => StatusKind.Success,
    };

    private static ChargingSessionCardDisplay Skeleton(
        ChargingSessionCardState state,
        string automationName,
        string emptyMessage,
        string loadingLabel,
        string selectLabel) =>
        new(
            State: state,
            Selectable: false,
            Selected: false,
            SessionId: 0,
            SelectLabel: selectLabel,
            HasScore: false,
            Score: double.NaN,
            ScoreAriaLabel: string.Empty,
            StartedAtText: ChargingSessionMath.EmDash,
            DurationText: ChargingSessionMath.EmDash,
            ChargerLabel: string.Empty,
            ChargerStatus: StatusKind.Neutral,
            HasEnergyBadge: false,
            EnergyBadgeText: string.Empty,
            HasFreeBadge: false,
            FreeLabel: string.Empty,
            HasAnomaly: false,
            AnomalyMessage: string.Empty,
            HasRoute: false,
            RouteLabel: ChargingSessionMath.EmDash,
            ShowMetrics: false,
            BatteryStartPct: null,
            BatteryEndPct: null,
            Metrics: [],
            Glow: ChargingCardGlow.Green,
            EmptyMessage: emptyMessage,
            LoadingLabel: loadingLabel,
            AutomationName: automationName);

    private static List<ChargingCardMetric> BuildMetrics(
        ChargingSessionSnapshot session,
        double durationMin,
        DistanceUnit distanceUnit,
        string currency,
        int precision)
    {
        var metrics = new List<ChargingCardMetric>(6);

        if (session.PeakPowerW is { } peak)
        {
            metrics.Add(new ChargingCardMetric(
                ChargingSessionCardRegistration.TrendingUpGlyph,
                string.Create(CultureInfo.InvariantCulture, $"{NumberFormatting.Format(Safe(peak / 1000.0), null, precision)} kW peak"),
                MutedBrushKey));
        }

        double avgPowerW = ChargingSessionMath.AvgPowerW(session);
        if (avgPowerW > 0)
        {
            metrics.Add(new ChargingCardMetric(
                ChargingSessionCardRegistration.PlugGlyph,
                string.Create(CultureInfo.InvariantCulture, $"~{NumberFormatting.Format(Safe(avgPowerW / 1000.0), null, precision)} kW avg"),
                MutedBrushKey));
        }

        if (durationMin > 0)
        {
            metrics.Add(new ChargingCardMetric(
                ChargingSessionCardRegistration.ClockGlyph,
                ChargingSessionMath.FormatDurationMinutes(durationMin),
                MutedBrushKey));
        }

        if (session.CostDecimal is { } cost && cost > 0)
        {
            metrics.Add(new ChargingCardMetric(
                ChargingSessionCardRegistration.CostGlyph,
                Currency(currency, cost, precision),
                CostBrushKey));
        }

        if (ChargingSessionMath.CostPerKwh(session) is { } perKwh)
        {
            metrics.Add(new ChargingCardMetric(
                null,
                string.Create(CultureInfo.InvariantCulture, $"({Currency(currency, perKwh, 2)}/kWh)"),
                MutedBrushKey));
        }

        if (ChargingSessionMath.DistanceAddedM(session) is { } meters)
        {
            double gained = UnitConverters.DistanceFromSi(meters, distanceUnit);
            if (gained > 0)
            {
                metrics.Add(new ChargingCardMetric(
                    ChargingSessionCardRegistration.ZapGlyph,
                    string.Create(
                        CultureInfo.InvariantCulture,
                        $"+{NumberFormatting.Format(Safe(gained), null, 0)} {UnitLabels.Label(distanceUnit)}"),
                    DistanceBrushKey));
            }
        }

        return metrics;
    }

    // web formatCurrency(amount, decimals) = `${symbol}${fmtNumber(amount, decimals)}`.
    private static string Currency(string symbol, double amount, int decimals) =>
        symbol + NumberFormatting.Format(Safe(amount), null, decimals);

    private static string ScoreAria(double? score, ILocalizer localizer)
    {
        if (score is not { } value)
        {
            return string.Empty;
        }

        string template = localizer.GetString("translation.charging.scoreAria", "Battery-friendly score: {{value}}");
        string formatted = NumberFormatting.Format(value, null, 0);
        return template.Replace("{{value}}", formatted, StringComparison.Ordinal);
    }

    // The web RouteDisplay explicit-single mode renders just the charger location (no "→ end"); reuse the shared
    // RouteLogic endpoint labeller so an address wins over a "lat, lon" fallback exactly as the web does.
    private static string RouteLabel(ChargingSessionSnapshot session)
    {
        var endpoint = new RouteEndpoint(
            string.IsNullOrWhiteSpace(session.StartPlace) ? null : session.StartPlace,
            session.StartLat,
            session.StartLng);
        return RouteLogic.EndpointLabel(endpoint) ?? string.Empty;
    }

    private static string BuildAutomationName(ChargingSessionCardDisplay display)
    {
        var parts = new List<string>(8);
        if (display.HasScore)
        {
            parts.Add(display.ScoreAriaLabel);
        }

        parts.Add(display.ChargerLabel);
        parts.Add(display.StartedAtText);
        parts.Add(display.DurationText);

        if (display.HasEnergyBadge)
        {
            parts.Add(display.EnergyBadgeText);
        }

        if (display.HasFreeBadge)
        {
            parts.Add(display.FreeLabel);
        }

        if (display.HasAnomaly)
        {
            parts.Add(display.AnomalyMessage);
        }

        if (display.HasRoute)
        {
            parts.Add(display.RouteLabel);
        }

        foreach (var metric in display.Metrics)
        {
            parts.Add(metric.Text);
        }

        return string.Join(". ", parts);
    }

    // The web safeNumber() guard inside the formatters: a non-finite value formats as 0 rather than "NaN"/"∞".
    private static double Safe(double value) => double.IsFinite(value) ? value : 0;
}

/// <summary>
/// PII-safe diagnostics for the <c>ChargingSessionCard</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never the charger location, energy, cost, SoC or
/// session id — so a diagnostics line can never leak a user's charging behaviour or whereabouts. Thread-safe.
/// </summary>
public sealed class ChargingSessionCardDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public ChargingSessionCardDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ChargingSessionCard</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={ChargingSessionCardRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>ChargingSessionCard</c> feature surface — the native mirror of the web component
/// at <c>web/src/features/charging/components/ChargingSessionCard.tsx</c>. Holds the diagnostics slug and the Segoe
/// Fluent glyphs that stand in for the web Lucide icons. UI-free so the metadata is asserted in tests.
/// </summary>
public static class ChargingSessionCardRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "ChargingSessionCard";

    /// <summary>Segoe Fluent "LightningBolt" glyph (web <c>Zap</c> — distance gained).</summary>
    public const string ZapGlyph = "\uE945";

    /// <summary>Segoe Fluent "Recent" glyph (web <c>Clock</c> — duration).</summary>
    public const string ClockGlyph = "\uE823";

    /// <summary>Segoe Fluent "PowerButton" glyph (web <c>Plug</c> — average power).</summary>
    public const string PlugGlyph = "\uE7E8";

    /// <summary>Segoe Fluent "ChevronUp" glyph (web <c>TrendingUp</c> — peak power).</summary>
    public const string TrendingUpGlyph = "\uE70E";

    /// <summary>Segoe Fluent "Money" glyph (web <c>DollarSign</c> — cost).</summary>
    public const string CostGlyph = "\uE1D3";

    /// <summary>Segoe Fluent "Brightness" glyph (web <c>Sun</c> — free charge).</summary>
    public const string SunGlyph = "\uE706";

    /// <summary>Segoe Fluent "Warning" glyph (web <c>AlertTriangle</c> — anomaly).</summary>
    public const string WarningGlyph = "\uE7BA";
}
