using TeslaSync.App.Core;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.WeeklyDigest;

/// <summary>
/// The render-time data model the <c>BatteryPill</c> view binds to — the native analogue of the web
/// <c>BatteryPillProps</c> (<c>{ level, label }</c> in
/// web/src/features/analytics/components/weekly-digest/BatteryPill.tsx). The web component is a pure
/// presentational pill: the parent weekly-digest surface owns any data fetching and feeds an already
/// resolved state-of-charge <see cref="Level"/> (0-100) and an already-localized <see cref="Label"/>, so
/// there is no fetch-driven loading / empty / error / stale / offline branch to reproduce here (those belong
/// to the parent, exactly as React re-renders the pill with already-resolved props). Pure data — no WinUI
/// types — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Level">The battery level percentage, 0-100 (web <c>level</c>).</param>
/// <param name="Label">The already-localized caption shown above the value (web <c>label</c>).</param>
public sealed record BatteryPillModel(double Level, string Label)
{
    /// <summary>The initial model — an empty (unlabeled) pill at zero charge.</summary>
    public static BatteryPillModel Empty { get; } = new(0, string.Empty);
}

/// <summary>
/// The fully projected, render-ready view of a <see cref="BatteryPillModel"/> — the native analogue of
/// everything the web component derives before returning JSX: the semantic colour <see cref="Tier"/> (web
/// <c>STATUS_COLORS</c> selection), its token-backed <see cref="AccentBrushKey"/>, the formatted
/// <see cref="PercentText"/> (web <c>{fmtInt(level)}%</c>), the passthrough <see cref="Label"/>, the clamped
/// progress <see cref="BarFraction"/> (web <c>width: min(level, 100)%</c>), and the composed Narrator name.
/// Pure data so every value is asserted headlessly.
/// </summary>
/// <param name="Tier">The semantic colour tier — <see cref="StatusKind.Success"/> / <see cref="StatusKind.Warning"/> / <see cref="StatusKind.Danger"/>.</param>
/// <param name="AccentBrushKey">The generated design-token brush key the tier resolves to.</param>
/// <param name="PercentText">The grouped integer percentage with the trailing percent sign, e.g. "85%".</param>
/// <param name="Label">The caption, shown verbatim above the value.</param>
/// <param name="BarFraction">The 0..1 progress-bar fill fraction.</param>
/// <param name="AutomationName">The composed Narrator name for the surface.</param>
public sealed record BatteryPillDisplay(
    StatusKind Tier,
    string AccentBrushKey,
    string PercentText,
    string Label,
    double BarFraction,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="BatteryPillModel"/> to its <see cref="BatteryPillDisplay"/> — the native
/// port of web/src/features/analytics/components/weekly-digest/BatteryPill.tsx. Reproduces the web derivations
/// exactly: the colour is <c>level &gt;= 60 ? good : level &gt;= 30 ? warning : critical</c> (the
/// <c>STATUS_COLORS</c> traffic-light, mapped to the equivalent <see cref="StatusKind"/> token brushes whose
/// dark-theme values are the same <c>#10B981 / #F59E0B / #EF4444</c>); the value is <c>fmtInt(level)</c>
/// followed by a percent sign (locale grouping, zero fraction digits, with the web <c>safeNumber</c>
/// non-finite-to-zero guard); and the bar fill is <c>Math.min(level, 100)%</c> clamped to a valid 0..1 width.
/// No WinUI types — unit-tested without a UI host.
/// </summary>
public static class BatteryPillProjection
{
    /// <summary>At or above this level the pill is the "good" tier (web <c>level &gt;= 60</c>).</summary>
    public const double GoodThreshold = 60;

    /// <summary>At or above this level (but below <see cref="GoodThreshold"/>) the pill is the "warning" tier (web <c>level &gt;= 30</c>).</summary>
    public const double WarningThreshold = 30;

    private const double FullPercent = 100.0;
    private const string PercentSign = "%";

    /// <summary>
    /// Select the semantic colour tier for <paramref name="level"/>, mirroring the web
    /// <c>level &gt;= 60 ? STATUS_COLORS.good : level &gt;= 30 ? STATUS_COLORS.warning : STATUS_COLORS.critical</c>.
    /// A non-finite level fails both comparisons and falls through to <see cref="StatusKind.Danger"/>, exactly
    /// as the web ternary does.
    /// </summary>
    public static StatusKind Tier(double level) =>
        level >= GoodThreshold ? StatusKind.Success
        : level >= WarningThreshold ? StatusKind.Warning
        : StatusKind.Danger;

    /// <summary>Project <paramref name="model"/> into a render-ready display.</summary>
    /// <param name="model">The render-time data model (the web props).</param>
    public static BatteryPillDisplay Project(BatteryPillModel model)
    {
        ArgumentNullException.ThrowIfNull(model);

        double level = model.Level;
        StatusKind tier = Tier(level);
        string label = model.Label ?? string.Empty;
        string percentText = FormatPercent(level);
        string automationName = string.IsNullOrEmpty(label)
            ? percentText
            : string.Concat(label, ": ", percentText);

        return new BatteryPillDisplay(
            Tier: tier,
            AccentBrushKey: StatusResources.AccentBrushKey(tier),
            PercentText: percentText,
            Label: label,
            BarFraction: BarFractionOf(level),
            AutomationName: automationName);
    }

    /// <summary>
    /// Format the level as the web does for <c>{fmtInt(level)}%</c>: <c>fmtInt</c> is
    /// <c>fmtNumber(safeNumber(level), 0)</c>, so a non-finite level coerces to zero (the web
    /// <c>safeNumber</c> guard) and the rest groups in threes with zero fraction digits before the trailing
    /// percent sign.
    /// </summary>
    public static string FormatPercent(double level)
    {
        double safe = double.IsFinite(level) ? level : 0;
        return NumberFormatting.Format(safe, null, 0) + PercentSign;
    }

    /// <summary>
    /// The clamped 0..1 progress-bar fill for <paramref name="level"/>, mirroring the web inline
    /// <c>width: `${Math.min(level, 100)}%`</c>. A non-finite or negative width is invalid CSS and renders as
    /// an empty bar, so it is clamped to zero; anything at or above 100 fills the track.
    /// </summary>
    public static double BarFractionOf(double level)
    {
        if (!double.IsFinite(level))
        {
            return 0;
        }

        double capped = Math.Min(level, FullPercent);
        return Math.Clamp(capped / FullPercent, 0.0, 1.0);
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>BatteryPill</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never the battery level or label — so a
/// diagnostics line can never leak fleet state. Thread-safe.
/// </summary>
public sealed class BatteryPillDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public BatteryPillDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=BatteryPill</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={BatteryPillRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>BatteryPill</c> feature surface — the native mirror of the web component at
/// <c>web/src/features/analytics/components/weekly-digest/BatteryPill.tsx</c>: the stable diagnostics slug and
/// the Segoe Fluent Icons glyph that stands in for the web Lucide <c>Battery</c> icon. UI-free so the metadata
/// is asserted in tests.
/// </summary>
public static class BatteryPillRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "BatteryPill";

    /// <summary>Segoe Fluent "Battery10" glyph — the web Lucide <c>Battery</c> icon, shared with the battery widgets.</summary>
    public const string BatteryGlyph = "\uE83F";
}
