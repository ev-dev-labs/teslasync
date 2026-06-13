using System.Globalization;
using TeslaSync.App.Core.Charts;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata for the ProgressRing surface — the native analogue of the module-level prop defaults in
/// <c>web/src/components/data-display/ProgressRing.tsx</c>. The web component is a pure presentational gauge
/// (an SVG with a full background <c>&lt;circle&gt;</c> track and a stroke-dash value arc swept
/// <c>value / max</c> from 12 o'clock, with an optional centred main / sub readout and an optional caption
/// beneath). It reads no network data and renders no titles or labels of its own, so this carries only the
/// diagnostics slug, the automation id, and the prop defaults the source declares (<c>max = 100</c>,
/// <c>size = 48</c>, <c>strokeWidth = 4</c>). The web <c>color</c> hex is replaced by a token-driven
/// <see cref="ChartRole"/> / colour index so the arc tints from the W1 palette and stays theme-aware
/// (ADR-009), exactly as <c>WidgetGaugeHero</c> / <c>TsRadialGauge</c> already do.
/// </summary>
public static class ProgressRingRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "ProgressRing";

    /// <summary>
    /// The root automation id the view stamps on itself. The web component declares no <c>data-testid</c>
    /// (it is an anonymous inline gauge), so this is the native-only stable hook UI-automation tests target.
    /// </summary>
    public const string RootAutomationId = "progress-ring";

    /// <summary>Default full-sweep maximum (web <c>max = 100</c>).</summary>
    public const double DefaultMax = 100.0;

    /// <summary>Default ring diameter in effective pixels (web <c>size = 48</c>).</summary>
    public const double DefaultSize = 48.0;

    /// <summary>Default arc stroke width in effective pixels (web <c>strokeWidth = 4</c>).</summary>
    public const double DefaultStrokeWidth = 4.0;

    /// <summary>
    /// Default categorical palette index for the value arc. Index 0 resolves to <c>TsChart01Brush</c>
    /// (the brand blue), the token analogue of the web default arc colour <c>#3b82f6</c>.
    /// </summary>
    public const int DefaultColorIndex = 0;
}

/// <summary>
/// Pure projection of the ring's render inputs — the native port of the web component body
/// (web/src/components/data-display/ProgressRing.tsx). It reproduces every geometric computation the web source
/// performs before returning JSX (radius, centre, circumference, the clamped value, the swept fraction and its
/// equivalent stroke-dash offset, the proportionally-sized centre fonts) and every conditional render branch
/// (<see cref="HasCenterLabel"/>, <see cref="HasCenterSubLabel"/>, <see cref="HasCenter"/>, <see cref="HasLabel"/>).
/// Inputs are sanitised so a partial / hostile config never throws or collapses the surface to a blank box: a
/// non-finite or non-positive size falls back to the default diameter, the stroke is clamped within the diameter,
/// the value is clamped into <c>[0, max]</c> and non-finite values settle to zero, and a non-positive max yields
/// an empty (but still drawn) ring. Kept static and side-effect-free so the adapter is unit-testable without a
/// view-model or a UI thread; the <see cref="ProgressRingViewModel"/> and the WinUI view both render from it.
/// </summary>
public readonly record struct ProgressRingProjection
{
    /// <summary>Fraction of <see cref="Size"/> used for the centred main readout font (web <c>size * 0.32</c>).</summary>
    public const double MainFontRatio = 0.32;

    /// <summary>Fraction of <see cref="Size"/> used for the centred sub readout font (web <c>size * 0.18</c>).</summary>
    public const double SubFontRatio = 0.18;

    /// <summary>Lower bound for the centred main readout font (web <c>Math.max(10, …)</c>).</summary>
    public const double MinMainFont = 10.0;

    /// <summary>Lower bound for the centred sub readout font (web <c>Math.max(8, …)</c>).</summary>
    public const double MinSubFont = 8.0;

    private ProgressRingProjection(
        double value,
        double max,
        double fraction,
        double size,
        double strokeWidth,
        double radius,
        double center,
        double circumference,
        double dashOffset,
        ChartRole role,
        int colorIndex,
        string centerLabel,
        bool hasCenterLabel,
        string centerSubLabel,
        bool hasCenterSubLabel,
        string label,
        bool hasLabel,
        double mainFontSize,
        double subFontSize,
        string percentText,
        string automationName)
    {
        Value = value;
        Max = max;
        Fraction = fraction;
        Size = size;
        StrokeWidth = strokeWidth;
        Radius = radius;
        Center = center;
        Circumference = circumference;
        DashOffset = dashOffset;
        Role = role;
        ColorIndex = colorIndex;
        CenterLabel = centerLabel;
        HasCenterLabel = hasCenterLabel;
        CenterSubLabel = centerSubLabel;
        HasCenterSubLabel = hasCenterSubLabel;
        Label = label;
        HasLabel = hasLabel;
        MainFontSize = mainFontSize;
        SubFontSize = subFontSize;
        PercentText = percentText;
        AutomationName = automationName;
    }

    /// <summary>The clamped, sanitised value the arc represents (web <c>clamped</c>).</summary>
    public double Value { get; }

    /// <summary>The effective full-sweep maximum (web <c>max</c>); non-positive collapses to zero.</summary>
    public double Max { get; }

    /// <summary>The swept fraction in <c>[0, 1]</c> (web <c>clamped / max</c>); the arc length.</summary>
    public double Fraction { get; }

    /// <summary>The effective ring diameter in pixels (web <c>size</c>).</summary>
    public double Size { get; }

    /// <summary>The effective arc stroke width in pixels (web <c>strokeWidth</c>), clamped within the diameter.</summary>
    public double StrokeWidth { get; }

    /// <summary>The ring radius (web <c>(size - strokeWidth) / 2</c>).</summary>
    public double Radius { get; }

    /// <summary>The ring centre coordinate (web <c>size / 2</c>); the geometry is square so X equals Y.</summary>
    public double Center { get; }

    /// <summary>The full ring circumference (web <c>2 * Math.PI * radius</c>).</summary>
    public double Circumference { get; }

    /// <summary>The stroke-dash offset that yields the swept arc (web <c>circumference - fraction * circumference</c>).</summary>
    public double DashOffset { get; }

    /// <summary>The semantic role tinting the value arc (token-driven, replacing the web <c>color</c> hex).</summary>
    public ChartRole Role { get; }

    /// <summary>The categorical palette index tinting the value arc when <see cref="Role"/> is <see cref="ChartRole.None"/>.</summary>
    public int ColorIndex { get; }

    /// <summary>The centred primary readout (web <c>centerLabel</c>); empty when unset.</summary>
    public string CenterLabel { get; }

    /// <summary>Whether a centred primary readout is rendered (web <c>centerLabel != null</c>).</summary>
    public bool HasCenterLabel { get; }

    /// <summary>The centred secondary readout (web <c>centerSubLabel</c>); empty when unset.</summary>
    public string CenterSubLabel { get; }

    /// <summary>Whether a centred secondary readout is rendered (web <c>centerSubLabel != null</c>).</summary>
    public bool HasCenterSubLabel { get; }

    /// <summary>The caption rendered beneath the ring (web <c>label</c>); empty when unset.</summary>
    public string Label { get; }

    /// <summary>Whether a caption is rendered beneath the ring (web <c>label &amp;&amp; …</c>).</summary>
    public bool HasLabel { get; }

    /// <summary>The centred primary readout font size (web <c>Math.max(10, Math.round(size * 0.32))</c>).</summary>
    public double MainFontSize { get; }

    /// <summary>The centred secondary readout font size (web <c>Math.max(8, Math.round(size * 0.18))</c>).</summary>
    public double SubFontSize { get; }

    /// <summary>The whole-number percentage of completion (e.g. <c>"72%"</c>); the accessible-name fallback.</summary>
    public string PercentText { get; }

    /// <summary>
    /// Whether the centred overlay is rendered at all (web <c>hasCenter = centerLabel != null || centerSubLabel
    /// != null</c>): true when either centred readout is present.
    /// </summary>
    public bool HasCenter => HasCenterLabel || HasCenterSubLabel;

    /// <summary>
    /// The composed accessible name. The web centre overlay is <c>aria-hidden</c>, so the meaningful readout is
    /// surfaced here on the ring container: the non-empty caption / centred readouts joined with a space, or the
    /// <see cref="PercentText"/> fallback when the caller supplies no text — so Narrator always announces
    /// something meaningful and the surface is never silent.
    /// </summary>
    public string AutomationName { get; }

    /// <summary>
    /// Project the render inputs. <paramref name="size"/> falls back to <see cref="ProgressRingRegistration.DefaultSize"/>
    /// when non-finite or non-positive; <paramref name="strokeWidth"/> falls back to the default and is clamped
    /// within the diameter; <paramref name="value"/> is sanitised and clamped into <c>[0, max]</c>; a non-positive
    /// <paramref name="max"/> yields an empty ring. The centred readouts and caption default to empty and are
    /// considered present only when non-blank (a blank readout renders nothing rather than an empty element).
    /// </summary>
    /// <param name="value">The value the arc represents (web <c>value</c>).</param>
    /// <param name="max">The full-sweep maximum (web <c>max</c>).</param>
    /// <param name="size">The ring diameter in pixels (web <c>size</c>).</param>
    /// <param name="strokeWidth">The arc stroke width in pixels (web <c>strokeWidth</c>).</param>
    /// <param name="centerLabel">The centred primary readout (web <c>centerLabel</c>), or null for none.</param>
    /// <param name="centerSubLabel">The centred secondary readout (web <c>centerSubLabel</c>), or null for none.</param>
    /// <param name="label">The caption rendered beneath the ring (web <c>label</c>), or null for none.</param>
    /// <param name="role">The semantic role tinting the value arc (token-driven).</param>
    /// <param name="colorIndex">The categorical palette index tinting the value arc when <paramref name="role"/> is None.</param>
    public static ProgressRingProjection Project(
        double value,
        double max = ProgressRingRegistration.DefaultMax,
        double size = ProgressRingRegistration.DefaultSize,
        double strokeWidth = ProgressRingRegistration.DefaultStrokeWidth,
        string? centerLabel = null,
        string? centerSubLabel = null,
        string? label = null,
        ChartRole role = ChartRole.None,
        int colorIndex = ProgressRingRegistration.DefaultColorIndex)
    {
        double safeSize = IsFinitePositive(size) ? size : ProgressRingRegistration.DefaultSize;
        double safeStroke = strokeWidth >= 0 && double.IsFinite(strokeWidth)
            ? Math.Min(strokeWidth, safeSize)
            : ProgressRingRegistration.DefaultStrokeWidth;

        double radius = Math.Max(0, (safeSize - safeStroke) / 2.0);
        double center = safeSize / 2.0;
        double circumference = 2.0 * Math.PI * radius;

        double effectiveMax = IsFinitePositive(max) ? max : 0.0;
        double clamped = effectiveMax > 0 ? Math.Clamp(Sanitize(value), 0, effectiveMax) : 0.0;
        double fraction = effectiveMax > 0 ? clamped / effectiveMax : 0.0;
        double dashOffset = circumference - (fraction * circumference);

        double mainFontSize = Math.Max(MinMainFont, Math.Round(safeSize * MainFontRatio));
        double subFontSize = Math.Max(MinSubFont, Math.Round(safeSize * SubFontRatio));

        string normalizedCenter = centerLabel ?? string.Empty;
        string normalizedSub = centerSubLabel ?? string.Empty;
        string normalizedLabel = label ?? string.Empty;
        bool hasCenterLabel = !string.IsNullOrWhiteSpace(normalizedCenter);
        bool hasCenterSubLabel = !string.IsNullOrWhiteSpace(normalizedSub);
        bool hasLabel = !string.IsNullOrWhiteSpace(normalizedLabel);

        string percentText = FormatPercent(fraction);
        string automationName = ComposeName(normalizedLabel, normalizedCenter, normalizedSub, percentText);

        return new ProgressRingProjection(
            clamped,
            effectiveMax,
            fraction,
            safeSize,
            safeStroke,
            radius,
            center,
            circumference,
            dashOffset,
            role,
            colorIndex,
            normalizedCenter,
            hasCenterLabel,
            normalizedSub,
            hasCenterSubLabel,
            normalizedLabel,
            hasLabel,
            mainFontSize,
            subFontSize,
            percentText,
            automationName);
    }

    private static bool IsFinitePositive(double value) => double.IsFinite(value) && value > 0;

    private static double Sanitize(double value) => double.IsFinite(value) ? value : 0.0;

    private static string FormatPercent(double fraction)
    {
        double percent = Math.Round(fraction * 100.0, MidpointRounding.AwayFromZero);
        return percent.ToString("0", CultureInfo.InvariantCulture) + "%";
    }

    private static string ComposeName(string label, string centerLabel, string centerSubLabel, string percentText)
    {
        var parts = new List<string>(3);
        AppendIfPresent(parts, label);
        AppendIfPresent(parts, centerLabel);
        AppendIfPresent(parts, centerSubLabel);
        return parts.Count > 0 ? string.Join(" ", parts) : percentText;
    }

    private static void AppendIfPresent(List<string> parts, string value)
    {
        if (!string.IsNullOrWhiteSpace(value))
        {
            parts.Add(value.Trim());
        }
    }
}

/// <summary>
/// PII-safe diagnostics for the ProgressRing surface (P1/S11 diagnostics contract). The ring carries no user
/// content beyond caller-supplied readout strings, so the collector records only the operational
/// <c>view.opened</c> event with the surface slug — never a value or label. Thread-safe.
/// </summary>
public sealed class ProgressRingDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public ProgressRingDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ProgressRing</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={ProgressRingRegistration.Slug}");
    }
}
