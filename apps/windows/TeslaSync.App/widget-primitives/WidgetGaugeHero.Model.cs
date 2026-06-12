using TeslaSync.App.Core.Charts;

namespace TeslaSync.App.WidgetPrimitives;

/// <summary>
/// The gauge configuration a <c>WidgetGaugeHero</c> renders — the native, tokenized mirror of the web
/// <c>GaugeHeroConfig</c> (web/src/features/dashboard/widgets/shared/WidgetGaugeHero.tsx). The web's raw
/// <c>color</c> hex is replaced by a token-driven <see cref="Role"/> / <see cref="ColorIndex"/> (the exact arc
/// brush selectors the native <c>TsRadialGauge</c> uses) so the gauge tints from the W1 palette and stays
/// theme-aware — never a hard-coded hex (ADR-009 / Windows token guidance). <see cref="Label"/> and
/// <see cref="Unit"/> arrive already-localized from the consuming widget (the web primitive is anonymous, so it
/// owns no i18n keys of its own).
/// </summary>
public sealed record GaugeHeroConfig(
    double Value,
    double Max,
    string Label,
    string Unit,
    ChartRole Role = ChartRole.None,
    int ColorIndex = 0);

/// <summary>
/// One supporting stat shown beneath the gauge — the native mirror of one entry in the web <c>stats</c> array
/// (<c>GaugeHeroStat { label, value, unit? }</c>). The web value is <c>string | number</c>; here it is the
/// already-formatted display string so the caller owns unit conversion / number formatting at its own display
/// boundary, exactly as the web caller passes a pre-formatted value.
/// </summary>
public sealed record GaugeHeroStat(string Label, string Value, string? Unit = null);

/// <summary>
/// A render-ready projection of one <see cref="GaugeHeroStat"/>: the label, the value, the optional unit, and
/// the composed Narrator name the view applies to the tile. Pure data so the projection is unit-tested without
/// a UI host.
/// </summary>
public sealed record GaugeHeroStatDisplay(string Label, string Value, string? Unit, string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the primitive for one footprint — everything the web component
/// computes before returning JSX: the clamped gauge value and its formatted text, the value-arc selectors, the
/// per-footprint diameter (compact 70 / standard 100), the stats-row and children gates, the projected stats,
/// and the composed gauge Narrator name. Pure data so the whole composition is verified headlessly.
/// </summary>
public sealed record GaugeHeroDisplay(
    double GaugeValue,
    double GaugeMax,
    string GaugeLabel,
    string GaugeUnit,
    string GaugeValueText,
    int GaugeDecimals,
    ChartRole GaugeRole,
    int GaugeColorIndex,
    double GaugeDiameter,
    bool Compact,
    bool ShowStats,
    bool ShowChildren,
    IReadOnlyList<GaugeHeroStatDisplay> Stats,
    string GaugeAutomationName);

/// <summary>
/// Pure projection from the raw <see cref="GaugeHeroConfig"/> + stats + compact flag to the render-ready
/// <see cref="GaugeHeroDisplay"/> — the native port of the composition in
/// web/src/features/dashboard/widgets/shared/WidgetGaugeHero.tsx. It reproduces every conditional branch of the
/// web source: the <c>compact ? 70 : 100</c> diameter, the <c>!compact &amp;&amp; stats.length &gt; 0</c>
/// stats-row gate, and the <c>!compact</c> children gate. Clamping and formatting mirror the web
/// <c>RadialGauge</c> (clamp to <c>0..max</c>; integers render with no fraction digits, otherwise the global
/// precision of two). Every input is null-tolerant so a partial config never throws.
/// </summary>
public static class WidgetGaugeHeroProjection
{
    /// <summary>Gauge diameter on a compact (1x1) footprint (web <c>size = compact ? 70 : ...</c>).</summary>
    public const double CompactDiameter = 70;

    /// <summary>Gauge diameter on the standard footprint (web <c>... : 100</c>).</summary>
    public const double StandardDiameter = 100;

    /// <summary>Fraction digits the web <c>getGlobalPrecision()</c> defaults to for non-integer values.</summary>
    public const int GlobalPrecision = 2;

    /// <summary>Project <paramref name="gauge"/> + <paramref name="stats"/> for the given footprint.</summary>
    /// <param name="gauge">The gauge configuration (required).</param>
    /// <param name="stats">Optional supporting stats; null / empty renders the gauge alone.</param>
    /// <param name="compact">True on a compact footprint (web <c>compact</c>): smaller gauge, no stats, no children.</param>
    public static GaugeHeroDisplay Project(GaugeHeroConfig gauge, IReadOnlyList<GaugeHeroStat>? stats, bool compact)
    {
        ArgumentNullException.ThrowIfNull(gauge);

        double max = SafeNumber(gauge.Max);
        double value = ClampValue(SafeNumber(gauge.Value), max);
        int decimals = ValueDecimals(value);
        string valueText = ChartPalette.FormatValue(value, decimals);
        string label = gauge.Label ?? string.Empty;
        string unit = gauge.Unit ?? string.Empty;

        // Web parity: stats render only when not compact and at least one stat exists; children render only when
        // not compact. The gauge itself always renders (even at value 0) so the surface is never a blank box.
        bool showStats = !compact && stats is { Count: > 0 };
        bool showChildren = !compact;

        IReadOnlyList<GaugeHeroStatDisplay> projectedStats;
        if (showStats)
        {
            projectedStats = ProjectStats(stats!);
        }
        else
        {
            projectedStats = Array.Empty<GaugeHeroStatDisplay>();
        }

        return new GaugeHeroDisplay(
            GaugeValue: value,
            GaugeMax: max,
            GaugeLabel: label,
            GaugeUnit: unit,
            GaugeValueText: valueText,
            GaugeDecimals: decimals,
            GaugeRole: gauge.Role,
            GaugeColorIndex: gauge.ColorIndex,
            GaugeDiameter: compact ? CompactDiameter : StandardDiameter,
            Compact: compact,
            ShowStats: showStats,
            ShowChildren: showChildren,
            Stats: projectedStats,
            GaugeAutomationName: ComposeName(label, valueText, unit));
    }

    /// <summary>Project a single stat to its render-ready display (used by the view and asserted in tests).</summary>
    public static GaugeHeroStatDisplay ProjectStat(GaugeHeroStat stat)
    {
        ArgumentNullException.ThrowIfNull(stat);
        string label = stat.Label ?? string.Empty;
        string value = stat.Value ?? string.Empty;
        string? unit = string.IsNullOrEmpty(stat.Unit) ? null : stat.Unit;
        return new GaugeHeroStatDisplay(label, value, unit, ComposeName(label, value, unit ?? string.Empty));
    }

    private static List<GaugeHeroStatDisplay> ProjectStats(IReadOnlyList<GaugeHeroStat> stats)
    {
        var projected = new List<GaugeHeroStatDisplay>(stats.Count);
        foreach (var stat in stats)
        {
            projected.Add(ProjectStat(stat));
        }

        return projected;
    }

    // Web RadialGauge: clamped = max(0, min(value, max)). When max is non-positive the web ratio is undefined,
    // so we fall back to a non-negative value (the gauge control guards the arc sweep the same way).
    private static double ClampValue(double value, double max) =>
        max > 0 ? Math.Clamp(value, 0, max) : Math.Max(0, value);

    // Web RadialGauge: d = decimals ?? (Number.isInteger(clamped) ? 0 : getGlobalPrecision()).
    private static int ValueDecimals(double value) =>
        value == Math.Floor(value) ? 0 : GlobalPrecision;

    private static double SafeNumber(double value) =>
        double.IsNaN(value) || double.IsInfinity(value) ? 0.0 : value;

    // Narrator name: the non-empty label / value / unit parts joined with a space (e.g. "Battery 72 %").
    private static string ComposeName(string label, string value, string unit)
    {
        var parts = new List<string>(3);
        if (!string.IsNullOrWhiteSpace(label))
        {
            parts.Add(label.Trim());
        }

        if (!string.IsNullOrWhiteSpace(value))
        {
            parts.Add(value.Trim());
        }

        if (!string.IsNullOrWhiteSpace(unit))
        {
            parts.Add(unit.Trim());
        }

        return string.Join(" ", parts);
    }
}
