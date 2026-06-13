using System.Globalization;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive render branch of the <c>SummaryHeroCards</c> surface — the native union of the states
/// the web component renders (web/src/features/analytics/components/weekly-digest/SummaryHeroCards.tsx). The web
/// source is a pure presentational composite: it takes the already-resolved <c>metrics</c> object plus an
/// optional <c>funFact</c> and renders the "Week Summary" panel of <c>HighlightCard</c> tiles, performing no
/// fetching — so the branch is a direct function of the input <see cref="SummaryHeroCardsModel"/>. There is no
/// fetch-driven error / stale / offline branch to reproduce inside this surface: the owning
/// <c>WeeklyDigestPage</c> owns the <c>useWeeklyDigest</c> query lifecycle and renders its <c>DigestSkeleton</c>,
/// page-level error surface and "No Data" empty state once for the whole digest before the summary hero cards are
/// composed with resolved props (exactly as React only mounts <c>&lt;SummaryHeroCards … /&gt;</c> after the data
/// resolves) — the same precedent the sibling <c>HighlightCard</c> / <c>SummaryStatsRow</c> / <c>DriveStatCards</c>
/// surfaces follow. The defensive <see cref="Loading"/> branch renders tokenized skeleton chrome while the parent
/// has not resolved the metrics yet, so the surface is never a blank box. Every branch maps onto a visible
/// surface; none is ever hidden.
/// </summary>
public enum SummaryHeroCardsState
{
    /// <summary>The parent has not resolved the weekly metrics yet — tokenized skeleton chrome inside the panel.</summary>
    Loading,

    /// <summary>The metrics resolved (the web render) — the Week Summary panel of highlight tiles.</summary>
    Ready,
}

/// <summary>
/// The optional "fun fact" the summary panel renders as its sixth tile — the native analogue of the web
/// <c>FunFact</c> prop (web/src/features/analytics/components/weekly-digest/types.ts). The owning digest computes
/// it (nearest city-pair to the week's distance) and passes it down already formatted, exactly as the web
/// <c>SummaryHeroCards</c> receives <c>funFact</c> as a resolved prop and only renders <c>{funFact &amp;&amp; …}</c>.
/// A null <see cref="SummaryHeroCardsModel.FunFact"/> drops the tile, mirroring the web truthiness gate. Pure data
/// — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="From">The origin city of the comparison (web <c>funFact.from</c>).</param>
/// <param name="To">The destination city of the comparison (web <c>funFact.to</c>).</param>
/// <param name="Times">The already-formatted multiple (web <c>funFact.times</c>, e.g. <c>"2.5"</c>) rendered as "{times}×".</param>
public sealed record SummaryHeroFunFact(string From, string To, string Times);

/// <summary>
/// The slice of the web <c>DigestMetrics</c> the summary hero cards read — held in the digest's display units
/// (kilometres, kilowatt-hours, kilograms and the account currency) exactly as the web
/// <c>useWeeklyDigest</c> hook hands them to <c>SummaryHeroCards</c>
/// (web/src/features/analytics/components/weekly-digest/SummaryHeroCards.tsx reads only these five current /
/// previous pairs). The values are already at the render boundary (the SI→display conversion happened upstream in
/// the digest aggregation, ADR-004), so the surface renders them verbatim and computes only the period-over-period
/// trend. Pure data — no WinUI types.
/// </summary>
/// <param name="TotalDistance">Distance driven this week in kilometres (web <c>metrics.totalDistance</c>).</param>
/// <param name="PrevDistance">Distance driven the previous week in kilometres (web <c>metrics.prevDistance</c>).</param>
/// <param name="TotalDrives">Number of drives this week (web <c>metrics.totalDrives</c>).</param>
/// <param name="PrevDriveCount">Number of drives the previous week (web <c>metrics.prevDriveCount</c>).</param>
/// <param name="EnergyUsed">Energy consumed this week in kilowatt-hours (web <c>metrics.energyUsed</c>).</param>
/// <param name="PrevEnergy">Energy consumed the previous week in kilowatt-hours (web <c>metrics.prevEnergy</c>).</param>
/// <param name="ChargingCost">Charging spend this week in the account currency (web <c>metrics.chargingCost</c>).</param>
/// <param name="PrevChargingCost">Charging spend the previous week in the account currency (web <c>metrics.prevChargingCost</c>).</param>
/// <param name="Co2Saved">Estimated CO₂ avoided this week in kilograms (web <c>metrics.co2Saved</c>).</param>
/// <param name="PrevCo2">Estimated CO₂ avoided the previous week in kilograms (web <c>metrics.prevCo2</c>).</param>
public sealed record SummaryHeroMetrics(
    double TotalDistance,
    double PrevDistance,
    long TotalDrives,
    long PrevDriveCount,
    double EnergyUsed,
    double PrevEnergy,
    double ChargingCost,
    double PrevChargingCost,
    double Co2Saved,
    double PrevCo2)
{
    /// <summary>The all-zero metrics — a resolved week with no driving or charging activity.</summary>
    public static SummaryHeroMetrics Zero { get; } = new(0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
}

/// <summary>
/// The currency context the Charging Cost tile formats through — the native analogue of the single
/// <c>useFormatting()</c> value the web <c>SummaryHeroCards</c> consumes
/// (web/src/hooks/useFormatting.ts): <c>formatCurrency(amount, 2)</c> renders
/// <c>`${currencySymbol}${fmtNumber(amount, 2)}`</c>, where a blank symbol falls back to <c>"$"</c>. Supplied to
/// the projection so the cost tile reproduces the web output exactly. Pure data — no WinUI types.
/// </summary>
/// <param name="CurrencySymbol">The leading currency symbol (web <c>currencySymbol</c>; blank falls back to "$").</param>
public sealed record SummaryHeroFormatting(string CurrencySymbol = "$")
{
    /// <summary>The web default: the dollar symbol.</summary>
    public static SummaryHeroFormatting Default { get; } = new();
}

/// <summary>
/// The render-time data model the <c>SummaryHeroCards</c> view binds to — the native analogue of the web
/// component's props (web/src/features/analytics/components/weekly-digest/SummaryHeroCards.tsx): the resolved
/// <c>metrics</c>, the optional <c>funFact</c>, plus the parent's fetch flag (the lifecycle the web's
/// <c>DigestSkeleton</c> owns) and the currency context the web reads from <c>useFormatting</c>. The component is
/// presentational, so user-facing strings (the panel title, the tile labels and the fun-fact copy) are resolved
/// from the i18n facade by the projection rather than passed in. Pure data — no WinUI types — so the projection is
/// unit-tested without a UI host.
/// </summary>
/// <param name="Loading">When true the parent is still resolving the metrics — the loading branch.</param>
/// <param name="Metrics">The resolved weekly metrics in display units (web <c>metrics</c>).</param>
/// <param name="FunFact">The optional city-pair fun fact (web <c>funFact</c>); null drops the sixth tile.</param>
/// <param name="Formatting">The currency context the cost tile formats through (web <c>useFormatting</c>).</param>
public sealed record SummaryHeroCardsModel(
    bool Loading,
    SummaryHeroMetrics Metrics,
    SummaryHeroFunFact? FunFact,
    SummaryHeroFormatting Formatting)
{
    /// <summary>The initial model: the parent fetch is in flight and no metrics have arrived yet.</summary>
    public static SummaryHeroCardsModel Pending { get; } =
        new(true, SummaryHeroMetrics.Zero, null, SummaryHeroFormatting.Default);

    /// <summary>A resolved model over the supplied metrics / fun fact / currency (the web render path).</summary>
    /// <param name="metrics">The resolved weekly metrics in display units.</param>
    /// <param name="funFact">The optional city-pair fun fact; null drops the sixth tile.</param>
    /// <param name="formatting">The currency context; defaults to the dollar symbol when null.</param>
    public static SummaryHeroCardsModel ForMetrics(
        SummaryHeroMetrics metrics,
        SummaryHeroFunFact? funFact = null,
        SummaryHeroFormatting? formatting = null)
    {
        ArgumentNullException.ThrowIfNull(metrics);
        return new(false, metrics, funFact, formatting ?? SummaryHeroFormatting.Default);
    }
}

/// <summary>
/// The fully projected, render-ready view of the summary hero panel for one input model — the native analogue of
/// everything the web <c>SummaryHeroCards</c> computes before returning JSX. Holds the active <see cref="State"/>,
/// the localized <see cref="WeekSummaryTitle"/>, the ordered <see cref="Cards"/> (the five always-present tiles
/// plus the optional fun-fact tile, empty while loading), the shared loading copy and the surface
/// <see cref="AutomationName"/>. Each card is a <see cref="HighlightCardModel"/>, exactly the prop the web feeds
/// each child <c>&lt;HighlightCard&gt;</c>. Pure data so every branch is asserted headlessly.
/// </summary>
/// <param name="State">The resolved render branch.</param>
/// <param name="WeekSummaryTitle">The localized panel title (web <c>t('analytics.weeklyDigest.weekSummary')</c>).</param>
/// <param name="Cards">The ordered highlight-card models (empty while loading).</param>
/// <param name="LoadingLabel">The localized loading announcement (the loading branch).</param>
/// <param name="AutomationName">The composed Narrator name for the surface.</param>
public sealed record SummaryHeroCardsDisplay(
    SummaryHeroCardsState State,
    string WeekSummaryTitle,
    IReadOnlyList<HighlightCardModel> Cards,
    string LoadingLabel,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="SummaryHeroCardsModel"/> to its <see cref="SummaryHeroCardsDisplay"/> — the
/// native port of web/src/features/analytics/components/weekly-digest/SummaryHeroCards.tsx. The branch precedence
/// mirrors the parent-driven lifecycle (loading → ready); the five always-present tiles reproduce the web
/// composition in order (Total Distance, Total Drives, Energy Used, Charging Cost, CO₂ Saved) with the web's
/// Lucide-icon → Segoe Fluent glyph and <c>color</c> mapping; each tile's change reproduces the web
/// <c>trendFor</c> (a near-zero change is "0%"/positive, otherwise a signed percentage whose desirability flips
/// for the "lower is better" energy and cost metrics via <c>invertPositive</c>); the distance / energy / CO₂
/// readouts reproduce <c>fmtNumber(value, 1)</c> with their unit suffix, the drive count reproduces
/// <c>fmtInt</c>, and the cost reproduces <c>formatCurrency(value, 2)</c>; and the sixth tile is added only when a
/// <c>funFact</c> is present (the web <c>{funFact &amp;&amp; …}</c> gate), rendering "{times}×" with the localized
/// "≈ {times}× {from} → {to}" caption. Every string resolves through the i18n facade using the exact web key
/// names. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class SummaryHeroCardsProjection
{
    /// <summary>The multiplication sign the fun-fact value and caption use (web <c>×</c>).</summary>
    public const string Times = "\u00d7";

    // ── Segoe Fluent glyphs standing in for the web Lucide icons (matching the parent WeeklyDigestPage port) ──
    private const string CarGlyph = "\uE804";       // web Car (Total Distance)
    private const string ActivityGlyph = "\uE9D2";  // web Activity (Total Drives)
    private const string ZapGlyph = "\uE945";       // web Zap (Energy Used)
    private const string FuelGlyph = "\uE1D3";      // web Fuel (Charging Cost)
    private const string LeafGlyph = "\uE8B7";      // web Leaf (CO₂ Saved)
    private const string MapPinGlyph = "\uE707";    // web MapPin (Fun Fact)

    // ── i18n keys (taken verbatim from the web t(...) call sites, plus the shared loading key) ──────────────
    internal const string WeekSummaryKey = "analytics.weeklyDigest.weekSummary";
    internal const string WeekSummaryFallback = "Week Summary";
    internal const string TotalDistanceKey = "analytics.weeklyDigest.totalDistance";
    internal const string TotalDistanceFallback = "Total Distance";
    internal const string TotalDrivesKey = "analytics.weeklyDigest.totalDrives";
    internal const string TotalDrivesFallback = "Total Drives";
    internal const string EnergyUsedKey = "analytics.weeklyDigest.energyUsed";
    internal const string EnergyUsedFallback = "Energy Used";
    internal const string ChargingCostKey = "analytics.weeklyDigest.chargingCost";
    internal const string ChargingCostFallback = "Charging Cost";
    internal const string Co2SavedKey = "analytics.weeklyDigest.co2Saved";
    internal const string Co2SavedFallback = "CO\u2082 Saved";
    internal const string FunFactKey = "analytics.weeklyDigest.funFact";
    internal const string FunFactFallback = "Fun Fact";
    internal const string FunFactDescKey = "analytics.weeklyDigest.funFactDesc";
    internal const string FunFactDescFallback = "\u2248 {0}\u00d7 {1} \u2192 {2}";
    internal const string LoadingKey = "common.loading";
    internal const string LoadingFallback = "Loading...";

    // The kilometre / kilowatt-hour / kilogram unit suffixes the web appends after fmtNumber (web display units).
    private const string KilometreSuffix = " km";
    private const string KilowattHourSuffix = " kWh";
    private const string KilogramSuffix = " kg";

    private const string DefaultCurrencySymbol = "$";

    // The web trendFor "no meaningful change" epsilon and the percentage rendered for a flat change.
    private const double FlatChangeEpsilon = 0.01;
    private const string FlatChangeValue = "0%";
    private const string PercentSuffix = "%";
    private const string PositiveSign = "+";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web props, plus the parent's fetch flag).</param>
    /// <param name="localizer">The i18n facade every string resolves through.</param>
    public static SummaryHeroCardsDisplay Project(SummaryHeroCardsModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        string title = localizer.GetString(WeekSummaryKey, WeekSummaryFallback);
        string loadingLabel = localizer.GetString(LoadingKey, LoadingFallback);

        if (model.Loading)
        {
            return new SummaryHeroCardsDisplay(
                SummaryHeroCardsState.Loading, title, Array.Empty<HighlightCardModel>(), loadingLabel, loadingLabel);
        }

        var cards = BuildCards(model, localizer);
        return new SummaryHeroCardsDisplay(
            SummaryHeroCardsState.Ready, title, cards, loadingLabel, BuildAutomationName(title, cards, localizer));
    }

    /// <summary>
    /// The web <c>pctChange</c>: the signed percentage change of <paramref name="current"/> against
    /// <paramref name="previous"/>. A zero previous yields 100 when the current is positive (a full increase),
    /// otherwise 0.
    /// </summary>
    /// <param name="current">The current-period value.</param>
    /// <param name="previous">The previous-period value.</param>
    public static double PctChange(double current, double previous)
    {
        if (previous == 0)
        {
            return current > 0 ? 100 : 0;
        }

        return (current - previous) / Math.Abs(previous) * 100;
    }

    private static List<HighlightCardModel> BuildCards(SummaryHeroCardsModel model, ILocalizer localizer)
    {
        var m = model.Metrics;
        string currency = NormalizeCurrency(model.Formatting.CurrencySymbol);

        var cards = new List<HighlightCardModel>(6)
        {
            Hero(
                CarGlyph,
                localizer.GetString(TotalDistanceKey, TotalDistanceFallback),
                Num(m.TotalDistance, 1) + KilometreSuffix,
                Trend(m.TotalDistance, m.PrevDistance, false),
                HighlightColor.Cyan),
            Hero(
                ActivityGlyph,
                localizer.GetString(TotalDrivesKey, TotalDrivesFallback),
                Num(m.TotalDrives, 0),
                Trend(m.TotalDrives, m.PrevDriveCount, false),
                HighlightColor.Green),
            Hero(
                ZapGlyph,
                localizer.GetString(EnergyUsedKey, EnergyUsedFallback),
                Num(m.EnergyUsed, 1) + KilowattHourSuffix,
                Trend(m.EnergyUsed, m.PrevEnergy, true),
                HighlightColor.Purple),
            Hero(
                FuelGlyph,
                localizer.GetString(ChargingCostKey, ChargingCostFallback),
                currency + Num(m.ChargingCost, 2),
                Trend(m.ChargingCost, m.PrevChargingCost, true),
                HighlightColor.Amber),
            Hero(
                LeafGlyph,
                localizer.GetString(Co2SavedKey, Co2SavedFallback),
                Num(m.Co2Saved, 1) + KilogramSuffix,
                Trend(m.Co2Saved, m.PrevCo2, false),
                HighlightColor.Green),
        };

        if (model.FunFact is { } funFact)
        {
            string descTemplate = localizer.GetString(FunFactDescKey, FunFactDescFallback);
            cards.Add(new HighlightCardModel(
                Loading: false,
                IconGlyph: MapPinGlyph,
                Label: localizer.GetString(FunFactKey, FunFactFallback),
                Value: funFact.Times + Times,
                ChangeValue: null,
                ChangePositive: true,
                Subtitle: string.Format(CultureInfo.CurrentCulture, descTemplate, funFact.Times, funFact.From, funFact.To),
                Color: HighlightColor.Cyan));
        }

        return cards;
    }

    private static HighlightCardModel Hero(
        string glyph, string label, string value, (string Value, bool Positive) trend, HighlightColor color) =>
        new(false, glyph, label, value, trend.Value, trend.Positive, null, color);

    // Web trendFor(): a near-zero change is "0%"/positive; otherwise a signed percentage whose desirability flips
    // for "lower is better" metrics (energy, cost) via invertPositive. HighlightCard reads only value + positive.
    private static (string Value, bool Positive) Trend(double current, double previous, bool invertPositive)
    {
        double diff = current - previous;
        if (Math.Abs(diff) < FlatChangeEpsilon)
        {
            return (FlatChangeValue, true);
        }

        bool isUp = diff > 0;
        string value = (isUp ? PositiveSign : string.Empty) + Num(PctChange(current, previous), 1) + PercentSuffix;
        return (value, invertPositive ? !isUp : isUp);
    }

    private static string NormalizeCurrency(string? symbol) =>
        string.IsNullOrWhiteSpace(symbol) ? DefaultCurrencySymbol : symbol;

    private static string Num(double value, int decimals) => NumberFormatting.Format(value, null, decimals);

    // Reading order matches the web panel: the title, then each tile spoken as the child HighlightCard would speak
    // it (label, value, change, subtitle). Reusing the child projection keeps the Narrator name in lock-step with
    // the rendered tiles without re-deriving the per-tile copy.
    private static string BuildAutomationName(string title, List<HighlightCardModel> cards, ILocalizer localizer)
    {
        var parts = new List<string>(cards.Count + 1) { title };
        foreach (var card in cards)
        {
            parts.Add(HighlightCardProjection.Project(card, localizer).AutomationName);
        }

        return string.Join(". ", parts);
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>SummaryHeroCards</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never the distance, energy, cost, CO₂ or
/// fun-fact figures — so a diagnostics line can never leak a user's fleet activity. Thread-safe.
/// </summary>
public sealed class SummaryHeroCardsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public SummaryHeroCardsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=SummaryHeroCards</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={SummaryHeroCardsRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>SummaryHeroCards</c> feature surface — the native mirror of the web component at
/// <c>web/src/features/analytics/components/weekly-digest/SummaryHeroCards.tsx</c>. UI-free so the metadata is
/// asserted in tests and referenced without a XAML runtime.
/// </summary>
public static class SummaryHeroCardsRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "SummaryHeroCards";
}
