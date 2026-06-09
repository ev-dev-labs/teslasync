using System.Globalization;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Analytics;

/// <summary>
/// The render-time data model the <c>EnvironmentSlide</c> surface binds to — the native analogue of the web
/// component's only prop (<c>data: YearReview</c>, from which it reads <em>only</em> <c>co2_offset_kg</c>,
/// the SI kilograms of CO₂ offset). The web component is presentational: the parent year-review viewer owns
/// the query lifecycle (the loading spinner, the <c>QueryError</c> retry, and the stale/offline chrome) and
/// only mounts this slide once the review has resolved, so this model carries just the parent's
/// <see cref="Loading"/> flag and the resolved <see cref="Co2OffsetKg"/> scalar. A <c>null</c> value models
/// "the parent has no review to show" (the friendly empty surface), mirroring the sibling
/// <c>BatteryTab</c> model. Pure data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Loading">True while the parent year-review fetch is in flight (web <c>data === undefined</c>).</param>
/// <param name="Co2OffsetKg">The resolved SI kilograms of CO₂ offset, or <c>null</c> when none is available.</param>
public sealed record EnvironmentSlideModel(bool Loading, double? Co2OffsetKg)
{
    /// <summary>The initial model: the parent's first fetch is in flight and no review has arrived yet.</summary>
    public static EnvironmentSlideModel Pending { get; } = new(true, null);

    /// <summary>A resolved model with no CO₂ value — the empty state.</summary>
    public static EnvironmentSlideModel Empty { get; } = new(false, null);

    /// <summary>A resolved model carrying the given SI kilograms of CO₂ offset (the ready state, including 0).</summary>
    public static EnvironmentSlideModel Resolved(double co2OffsetKg) => new(false, co2OffsetKg);
}

/// <summary>
/// The mutually-exclusive render branch of the <c>EnvironmentSlide</c> surface — the native union of the
/// states the web component renders (<c>features/analytics/components/review/EnvironmentSlide.tsx</c>). The
/// web source is presentational (it takes the resolved <c>data</c> as a prop and performs no fetching), so
/// the branches are a direct function of the input <see cref="EnvironmentSlideModel"/>: there is no
/// fetch-driven error / stale / offline branch to reproduce here — the parent year-review viewer owns the
/// query lifecycle and only mounts this slide with the resolved data. Every branch maps onto a visible
/// surface; none is ever hidden.
/// </summary>
public enum EnvironmentSlideState
{
    /// <summary>The parent fetch is in flight (web <c>data === undefined</c>) — skeleton chrome.</summary>
    Loading,

    /// <summary>Resolved with no CO₂ value — the friendly empty state, never a blank box.</summary>
    Empty,

    /// <summary>A resolved CO₂ value (web fall-through) — the globe, count-up offset and tree visualization.</summary>
    Ready,
}

/// <summary>
/// The fully projected, render-ready view of the surface for one input model — the native analogue of what
/// the web <c>EnvironmentSlide</c> returns. Holds the active <see cref="State"/>, the resolved chrome labels
/// and the Ready-state composition: the eyebrow <see cref="Co2Label"/>, the count-up
/// <see cref="Co2Value"/>/<see cref="Co2ValueText"/> with its <see cref="Co2Suffix"/>, the
/// <see cref="TreesEquivText"/> caption, the capped tree-icon <see cref="TreeCount"/>, and the
/// <see cref="HasOverflow"/>/<see cref="OverflowText"/> "+N more" affordance. Pure data so every branch is
/// asserted without a UI host.
/// </summary>
public sealed record EnvironmentSlideDisplay(
    EnvironmentSlideState State,
    string SurfaceName,
    string Co2Label,
    double Co2Value,
    string Co2ValueText,
    string Co2Suffix,
    string Co2DisplayText,
    string TreesEquivText,
    int TreeCount,
    bool HasOverflow,
    string OverflowText,
    string EmptyMessage,
    string LoadingLabel,
    string AutomationName);

/// <summary>
/// Pure projection from an <see cref="EnvironmentSlideModel"/> (+ the i18n facade) to its
/// <see cref="EnvironmentSlideDisplay"/> — the native port of
/// <c>features/analytics/components/review/EnvironmentSlide.tsx</c>. The branch precedence mirrors the web
/// source's parent contract (loading → empty → ready); the offset renders through the shared SI display
/// boundary (<see cref="NumberFormatting"/> = the web <c>AnimatedNumber</c>'s <c>fmtNumber(_, 0)</c>); the
/// tree count is the web <c>Math.round(co2_offset_kg / 21)</c> capped at 30 icons; and every label resolves
/// through the i18n facade using the same keys the web source feeds into <c>t()</c>
/// (<c>yearReview.co2Offset</c>, <c>yearReview.treesEquiv</c>, <c>yearReview.more</c>). No WinUI types —
/// unit-tested without a UI host.
/// </summary>
public static class EnvironmentSlideProjection
{
    // web: treesPlanted = Math.round(co2_offset_kg / 21).
    private const double KilogramsPerTree = 21.0;

    // web: treeIcons = Array.from({ length: Math.min(treesPlanted, 30) }) — the grid caps at 30 glyphs.
    private const int MaxTreeIcons = 30;

    // web: <AnimatedNumber suffix=" kg" /> — the unit is a literal, not localized.
    private const string KilogramSuffix = " kg";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web prop).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static EnvironmentSlideDisplay Project(EnvironmentSlideModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        string co2Label = localizer.GetString("yearReview.co2Offset", "CO\u2082 offset");
        string loadingLabel = localizer.GetString("common.loading", "Loading...");
        string emptyMessage = localizer.GetString("common.noData", "No data available");

        EnvironmentSlideState state = SelectState(model);

        if (state != EnvironmentSlideState.Ready)
        {
            string chromeAutomation = state == EnvironmentSlideState.Loading
                ? $"{co2Label}. {loadingLabel}"
                : emptyMessage;

            return new EnvironmentSlideDisplay(
                State: state,
                SurfaceName: co2Label,
                Co2Label: co2Label,
                Co2Value: 0,
                Co2ValueText: string.Empty,
                Co2Suffix: KilogramSuffix,
                Co2DisplayText: string.Empty,
                TreesEquivText: string.Empty,
                TreeCount: 0,
                HasOverflow: false,
                OverflowText: string.Empty,
                EmptyMessage: emptyMessage,
                LoadingLabel: loadingLabel,
                AutomationName: chromeAutomation);
        }

        double co2 = Safe(model.Co2OffsetKg ?? 0);

        // web: fmtNumber(co2_offset_kg, 0) — en-US grouped, zero fraction digits.
        string co2ValueText = NumberFormatting.Format(co2, null, 0);
        string co2DisplayText = $"{co2ValueText}{KilogramSuffix}";

        // web: treesPlanted = Math.round(co2_offset_kg / 21). Math.round is floor(x + 0.5); reproduced for the
        // non-negative CO₂ domain so the icon count matches the web exactly.
        int treesPlanted = (int)Math.Floor((co2 / KilogramsPerTree) + 0.5);
        int treeCount = Math.Clamp(treesPlanted, 0, MaxTreeIcons);
        bool hasOverflow = treesPlanted > MaxTreeIcons;

        // web: t('yearReview.treesEquiv', { count, defaultValue: 'Like planting {{count}} trees' }). The native
        // catalog normalizes i18next's {{count}} to a .NET {0} format slot, so resolve then string.Format.
        string treesEquivText = string.Format(
            CultureInfo.CurrentCulture,
            localizer.GetString("yearReview.treesEquiv", "Like planting {0} trees"),
            treesPlanted.ToString(CultureInfo.InvariantCulture));

        // web: +{treesPlanted - 30} {t('yearReview.more', 'more')} — only when treesPlanted exceeds the cap.
        string overflowText = hasOverflow
            ? string.Format(
                CultureInfo.CurrentCulture,
                "+{0} {1}",
                (treesPlanted - MaxTreeIcons).ToString(CultureInfo.InvariantCulture),
                localizer.GetString("yearReview.more", "more"))
            : string.Empty;

        string automationName = $"{co2Label}: {co2DisplayText}. {treesEquivText}";

        return new EnvironmentSlideDisplay(
            State: EnvironmentSlideState.Ready,
            SurfaceName: co2Label,
            Co2Label: co2Label,
            Co2Value: co2,
            Co2ValueText: co2ValueText,
            Co2Suffix: KilogramSuffix,
            Co2DisplayText: co2DisplayText,
            TreesEquivText: treesEquivText,
            TreeCount: treeCount,
            HasOverflow: hasOverflow,
            OverflowText: overflowText,
            EmptyMessage: emptyMessage,
            LoadingLabel: loadingLabel,
            AutomationName: automationName);
    }

    /// <summary>Branch precedence from the web parent contract: loading → empty → ready.</summary>
    private static EnvironmentSlideState SelectState(EnvironmentSlideModel model)
    {
        if (model.Loading)
        {
            return EnvironmentSlideState.Loading;
        }

        // The web slide always receives a numeric co2_offset_kg; a null here models "no review to show".
        return model.Co2OffsetKg is null ? EnvironmentSlideState.Empty : EnvironmentSlideState.Ready;
    }

    // web `safe`-equivalent: coerce a non-finite (null/NaN/Infinity) value to 0 before formatting.
    private static double Safe(double value) => double.IsFinite(value) ? value : 0.0;
}

/// <summary>
/// PII-safe diagnostics for the <c>EnvironmentSlide</c> surface (P1/S11 diagnostics contract). Records only
/// the operational <c>view.opened</c> event with the surface slug — never the CO₂ value or any review
/// figure — so a diagnostics line can never leak year-review telemetry. Thread-safe.
/// </summary>
public sealed class EnvironmentSlideDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public EnvironmentSlideDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=EnvironmentSlide</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={EnvironmentSlideRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>EnvironmentSlide</c> feature surface — the native mirror of the web
/// component at <c>web/src/features/analytics/components/review/EnvironmentSlide.tsx</c>.
/// </summary>
public static class EnvironmentSlideRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "EnvironmentSlide";

    /// <summary>The globe emoji the web slide leads with (🌍, U+1F30D).</summary>
    public const string GlobeGlyph = "\U0001F30D";

    /// <summary>The tree emoji rendered in the offset visualization grid (🌳, U+1F333).</summary>
    public const string TreeGlyph = "\U0001F333";
}
