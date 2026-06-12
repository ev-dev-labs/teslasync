using System.Globalization;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The selected <c>[low, high]</c> pair of a <see cref="RangeSlider"/> — the native analogue of the web
/// component's <c>value: [number, number]</c> prop (web/src/components/ui/RangeSlider.tsx). Carried as a value
/// type so the surface's state holder and pure projection compare it by value. The web component documents the
/// tuple as "always normalised so <c>low &lt;= high</c>"; the <see cref="RangeSliderMath"/> change helpers keep it
/// sorted on every user interaction (the web thumb-swap), so callers never have to pre-sort.
/// </summary>
/// <param name="Low">The lower bound (web <c>value[0]</c>).</param>
/// <param name="High">The upper bound (web <c>value[1]</c>).</param>
public readonly record struct RangeSliderValue(double Low, double High);

/// <summary>
/// Canonical metadata + the two render-contract i18n keys for the dual-thumb range slider — the native mirror of
/// the module-level contract in <c>web/src/components/ui/RangeSlider.tsx</c>. The web component is a controlled,
/// presentational primitive (its only inputs are the caller-supplied value / bounds / labels and the
/// <c>onChange</c> callback; it reads no network data), so this carries only the diagnostics slug, the automation
/// ids the two thumbs stamp on themselves, the web prop defaults (<c>step = 1</c>, <c>showLabel = true</c>) and the
/// per-thumb accessible-name keys. The keys carry the <c>translation.</c> catalog prefix the WinUI resource bridge
/// expects; the web source interpolates <c>{{label}}</c>, so the catalog stores the value with the .NET positional
/// token <c>{0}</c> and the resolved string is composed with <see cref="string.Format(IFormatProvider, string, object?)"/>.
/// UI-free so it is asserted without a XAML host.
/// </summary>
public static class RangeSliderRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "RangeSlider";

    /// <summary>The root automation id the surface stamps on itself (the web wrapper carries no test id).</summary>
    public const string RootAutomationId = "range-slider";

    /// <summary>The automation id of the lower thumb (web <c>`${baseId}-low`</c>).</summary>
    public const string LowThumbAutomationId = "range-slider-low";

    /// <summary>The automation id of the upper thumb (web <c>`${baseId}-high`</c>).</summary>
    public const string HighThumbAutomationId = "range-slider-high";

    /// <summary>The default step increment (web <c>step = 1</c>).</summary>
    public const double DefaultStep = 1.0;

    /// <summary>Whether the visible label/value row shows by default (web <c>showLabel = true</c>).</summary>
    public const bool ShowLabelDefault = true;

    /// <summary>i18n key for the lower thumb's accessible name (web <c>slider.thumbMin</c>).</summary>
    public const string MinThumbLabelKey = "translation.slider.thumbMin";

    /// <summary>
    /// English fallback for <see cref="MinThumbLabelKey"/> in .NET positional form — the transform of the web
    /// <c>'{{label}} minimum'</c> token into <c>'{0} minimum'</c>, matching the P1/S10 catalog entry.
    /// </summary>
    public const string MinThumbLabelFallback = "{0} minimum";

    /// <summary>i18n key for the upper thumb's accessible name (web <c>slider.thumbMax</c>).</summary>
    public const string MaxThumbLabelKey = "translation.slider.thumbMax";

    /// <summary>
    /// English fallback for <see cref="MaxThumbLabelKey"/> in .NET positional form — the transform of the web
    /// <c>'{{label}} maximum'</c> token into <c>'{0} maximum'</c>, matching the P1/S10 catalog entry.
    /// </summary>
    public const string MaxThumbLabelFallback = "{0} maximum";
}

/// <summary>
/// Pure geometry + thumb-swap helpers for the range slider — the native port of the web component's
/// <c>handleLowChange</c> / <c>handleHighChange</c> swap rules and its decorative fill percentages
/// (web/src/components/ui/RangeSlider.tsx). Kept static and side-effect-free so the interaction contract is
/// unit-tested without a view-model or a UI thread; the <see cref="RangeSliderViewModel"/> and the WinUI view both
/// drive their values through it.
/// </summary>
public static class RangeSliderMath
{
    /// <summary>Coerce a step to a strictly positive snapping increment (the slider divides by it).</summary>
    /// <param name="step">The requested step (web <c>step</c>); zero or negative falls back to 1.</param>
    /// <returns>The requested step when positive, otherwise 1.</returns>
    public static double SafeStep(double step) => step > 0 && !double.IsNaN(step) ? step : 1.0;

    /// <summary>
    /// The Page-key increment (web Arrow keys step by <c>step</c>; PageUp/Down by ~10% of the range). Always at
    /// least the safe step so the large change never collapses to zero on a degenerate range.
    /// </summary>
    /// <param name="min">The inclusive lower bound.</param>
    /// <param name="max">The inclusive upper bound.</param>
    /// <param name="step">The fine step (web <c>step</c>).</param>
    /// <returns>The Page-key increment.</returns>
    public static double LargeStep(double min, double max, double step)
    {
        double safe = SafeStep(step);
        double range = max - min;
        double tenth = range > 0 ? range / 10.0 : safe;
        return Math.Max(safe, tenth);
    }

    /// <summary>
    /// The decorative fill position 0..100 of <paramref name="value"/> within <c>[min, max]</c> — the web
    /// <c>((value - min) / range) * 100</c> clamped to 0..100. On a degenerate range (<c>range &lt;= 0</c>) the web
    /// renders the low thumb at 0 and the high thumb at 100, so the caller supplies the
    /// <paramref name="degenerate"/> default for its thumb.
    /// </summary>
    /// <param name="value">The thumb value.</param>
    /// <param name="min">The inclusive lower bound.</param>
    /// <param name="max">The inclusive upper bound.</param>
    /// <param name="degenerate">The percentage to use when the range is zero/negative (0 for low, 100 for high).</param>
    /// <returns>The clamped fill percentage 0..100.</returns>
    public static double Percent(double value, double min, double max, double degenerate)
    {
        double range = max - min;
        if (range <= 0 || double.IsNaN(range))
        {
            return degenerate;
        }

        double pct = (value - min) / range * 100.0;
        return Math.Clamp(pct, 0.0, 100.0);
    }

    /// <summary>
    /// Apply a change to the LOW thumb, reproducing the web <c>handleLowChange</c>: when the new low value is
    /// dragged past the current high it becomes the new high and the old high becomes the low, so the returned
    /// tuple is always sorted ascending (the APG thumb-swap).
    /// </summary>
    /// <param name="current">The current selected pair.</param>
    /// <param name="next">The new value requested for the low thumb.</param>
    /// <returns>The sorted <c>[low, high]</c> pair after the change.</returns>
    public static RangeSliderValue ApplyLowChange(RangeSliderValue current, double next) =>
        next > current.High
            ? new RangeSliderValue(current.High, next)
            : new RangeSliderValue(next, current.High);

    /// <summary>
    /// Apply a change to the HIGH thumb, reproducing the web <c>handleHighChange</c>: when the new high value is
    /// dragged below the current low it becomes the new low and the old low becomes the high, so the returned tuple
    /// is always sorted ascending (the APG thumb-swap).
    /// </summary>
    /// <param name="current">The current selected pair.</param>
    /// <param name="next">The new value requested for the high thumb.</param>
    /// <returns>The sorted <c>[low, high]</c> pair after the change.</returns>
    public static RangeSliderValue ApplyHighChange(RangeSliderValue current, double next) =>
        next < current.Low
            ? new RangeSliderValue(next, current.Low)
            : new RangeSliderValue(current.Low, next);
}

/// <summary>
/// The render-ready projection of a <see cref="RangeSlider"/> — the native port of the web component body
/// (web/src/components/ui/RangeSlider.tsx). It formats each thumb's display value (web
/// <c>formatValue ? formatValue(n) : String(n)</c>), composes the visible "low – high" readout, resolves each
/// thumb's accessible name (web <c>minThumbLabel ?? t('slider.thumbMin', '{{label}} minimum', { label })</c>) and
/// computes the decorative fill percentages plus the "low thumb on top" z-order flag (web <c>lowPct &gt; 50</c>).
/// Pure and side-effect-free so the adapter is unit-testable; the view-model and the WinUI view both render from
/// it. Because the component reads no network data it has no loading / error / stale / offline branches — the
/// reproduced render branches are the visible-label row (web <c>showLabel</c>), the disabled state and the
/// thumb-swap / z-order behaviour.
/// </summary>
public readonly record struct RangeSliderProjection
{
    private RangeSliderProjection(
        double low,
        double high,
        string displayLow,
        string displayHigh,
        string rangeText,
        string ariaLow,
        string ariaHigh,
        double lowPercent,
        double highPercent,
        bool lowOnTop,
        bool showLabel,
        bool disabled)
    {
        Low = low;
        High = high;
        DisplayLow = displayLow;
        DisplayHigh = displayHigh;
        RangeText = rangeText;
        AriaLow = ariaLow;
        AriaHigh = ariaHigh;
        LowPercent = lowPercent;
        HighPercent = highPercent;
        LowOnTop = lowOnTop;
        ShowLabel = showLabel;
        Disabled = disabled;
    }

    /// <summary>The lower bound currently selected (web <c>value[0]</c>).</summary>
    public double Low { get; }

    /// <summary>The upper bound currently selected (web <c>value[1]</c>).</summary>
    public double High { get; }

    /// <summary>The lower bound formatted for display (web <c>displayLow</c>).</summary>
    public string DisplayLow { get; }

    /// <summary>The upper bound formatted for display (web <c>displayHigh</c>).</summary>
    public string DisplayHigh { get; }

    /// <summary>The visible "low – high" readout shown in the label row (web caption).</summary>
    public string RangeText { get; }

    /// <summary>The lower thumb's accessible name (web <c>aria-label</c> / <c>aria-valuetext</c> source).</summary>
    public string AriaLow { get; }

    /// <summary>The upper thumb's accessible name (web <c>aria-label</c> / <c>aria-valuetext</c> source).</summary>
    public string AriaHigh { get; }

    /// <summary>The lower thumb's fill position 0..100 (web <c>lowPct</c>).</summary>
    public double LowPercent { get; }

    /// <summary>The upper thumb's fill position 0..100 (web <c>highPct</c>).</summary>
    public double HighPercent { get; }

    /// <summary>
    /// True when the low thumb should sit above the high thumb in z-order (web <c>lowPct &gt; 50</c>), so it stays
    /// grabbable when the two thumbs collide near the far end.
    /// </summary>
    public bool LowOnTop { get; }

    /// <summary>Whether the visible label/value row renders (web <c>showLabel</c>).</summary>
    public bool ShowLabel { get; }

    /// <summary>Whether both thumbs are non-interactive (web <c>disabled</c>).</summary>
    public bool Disabled { get; }

    /// <summary>
    /// Project the render inputs. Formats the two thumb values through <paramref name="formatValue"/> (or the
    /// invariant <c>String(n)</c> default), composes the readout and per-thumb accessible names (resolving the
    /// thumb-label keys through <paramref name="localizer"/> and interpolating <paramref name="label"/> unless the
    /// caller supplied an explicit override), and computes the fill percentages + z-order flag.
    /// </summary>
    /// <param name="value">The selected <c>[low, high]</c> pair (web <c>value</c>).</param>
    /// <param name="min">The inclusive lower bound (web <c>min</c>).</param>
    /// <param name="max">The inclusive upper bound (web <c>max</c>).</param>
    /// <param name="label">The visible label and accessible-name base (web <c>label</c>); null is treated as empty.</param>
    /// <param name="formatValue">Formats each displayed value + aria text (web <c>formatValue</c>); null uses <c>String(n)</c>.</param>
    /// <param name="minThumbLabel">Explicit lower-thumb accessible name (web <c>minThumbLabel</c>); null resolves the i18n key.</param>
    /// <param name="maxThumbLabel">Explicit upper-thumb accessible name (web <c>maxThumbLabel</c>); null resolves the i18n key.</param>
    /// <param name="showLabel">Whether the label/value row renders (web <c>showLabel</c>).</param>
    /// <param name="disabled">Whether both thumbs are non-interactive (web <c>disabled</c>).</param>
    /// <param name="localizer">The i18n facade every thumb name resolves through.</param>
    /// <returns>The render-ready projection.</returns>
    public static RangeSliderProjection Project(
        RangeSliderValue value,
        double min,
        double max,
        string? label,
        Func<double, string>? formatValue,
        string? minThumbLabel,
        string? maxThumbLabel,
        bool showLabel,
        bool disabled,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        string safeLabel = label ?? string.Empty;

        string displayLow = Format(value.Low, formatValue);
        string displayHigh = Format(value.High, formatValue);
        string rangeText = $"{displayLow} \u2013 {displayHigh}";

        string ariaLow = minThumbLabel ?? Localize(localizer, RangeSliderRegistration.MinThumbLabelKey, RangeSliderRegistration.MinThumbLabelFallback, safeLabel);
        string ariaHigh = maxThumbLabel ?? Localize(localizer, RangeSliderRegistration.MaxThumbLabelKey, RangeSliderRegistration.MaxThumbLabelFallback, safeLabel);

        double lowPercent = RangeSliderMath.Percent(value.Low, min, max, degenerate: 0.0);
        double highPercent = RangeSliderMath.Percent(value.High, min, max, degenerate: 100.0);
        bool lowOnTop = lowPercent > 50.0;

        return new RangeSliderProjection(
            value.Low,
            value.High,
            displayLow,
            displayHigh,
            rangeText,
            ariaLow,
            ariaHigh,
            lowPercent,
            highPercent,
            lowOnTop,
            showLabel,
            disabled);
    }

    private static string Format(double value, Func<double, string>? formatValue) =>
        formatValue is not null ? formatValue(value) : value.ToString(CultureInfo.InvariantCulture);

    private static string Localize(ILocalizer localizer, string key, string fallback, string label)
    {
        string template = localizer.GetString(key, fallback);
        return string.Format(CultureInfo.CurrentCulture, template, label);
    }
}

/// <summary>
/// PII-safe diagnostics for the range slider (P1/S11 diagnostics contract). The slider carries only caller-supplied
/// numeric bounds, so the collector records only the operational <c>view.opened</c> event with the surface slug —
/// never the selected values, VIN or location. Thread-safe.
/// </summary>
public sealed class RangeSliderDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public RangeSliderDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=RangeSlider</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={RangeSliderRegistration.Slug}");
    }
}
