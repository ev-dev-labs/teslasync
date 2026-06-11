using TeslaSync.App.Core.Units;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata for the AnimatedNumber surface — the native analogue of the module-level prop defaults
/// in <c>web/src/components/data-display/AnimatedNumber.tsx</c>. The web component is a pure presentational
/// count-up readout (a <c>&lt;span class="tabular-nums"&gt;</c> that tweens its displayed value from
/// <c>0</c> to the <c>value</c> prop over <c>duration</c> seconds with an ease-out-quad curve, wrapping the
/// locale-formatted number in an optional <c>prefix</c> / <c>suffix</c>). It reads no network data and renders
/// no titles or labels of its own, so this carries only the diagnostics slug, the automation id, and the three
/// prop defaults the source declares (<c>duration = 1</c>, <c>decimals = 0</c>, and the implicit <c>from = 0</c>
/// tween origin).
/// </summary>
public static class AnimatedNumberRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "AnimatedNumber";

    /// <summary>
    /// The root automation id the view stamps on itself. The web component declares no <c>data-testid</c>
    /// (it is an anonymous inline span), so this is the native-only stable hook UI-automation tests target.
    /// </summary>
    public const string RootAutomationId = "animated-number";

    /// <summary>Default tween duration in seconds (web <c>duration = 1</c>).</summary>
    public const double DefaultDurationSeconds = 1.0;

    /// <summary>Default fraction-digit count for the rendered number (web <c>decimals = 0</c>).</summary>
    public const int DefaultDecimals = 0;

    /// <summary>The value the count-up tween starts from (web <c>const from = 0</c>).</summary>
    public const double StartValue = 0.0;
}

/// <summary>
/// Pure projection of the readout's render inputs — the native port of the web component body
/// (web/src/components/data-display/AnimatedNumber.tsx). It captures the validated <see cref="Value"/>,
/// <see cref="Decimals"/>, <see cref="Prefix"/>, <see cref="Suffix"/> and <see cref="DurationSeconds"/>, decides
/// whether the count-up should run (<see cref="Animate"/> is false under reduced motion or a non-positive
/// duration, matching the web <c>ease-out</c> tween collapsing to its final frame), and formats any tween frame
/// through the shared <see cref="ScalarFormatters.FormatNumber(double?, int, string)"/> helper — the verified
/// 1:1 port of the web <c>fmtNumber(display, decimals)</c> (en-US grouping, fixed fraction digits). Kept static
/// and side-effect-free so the adapter is unit-testable without a view-model or a UI thread; the
/// <see cref="AnimatedNumberViewModel"/> and the WinUI view both render from it.
/// </summary>
public readonly record struct AnimatedNumberProjection
{
    private AnimatedNumberProjection(
        double value,
        int decimals,
        string prefix,
        string suffix,
        double durationSeconds,
        bool animate)
    {
        Value = value;
        Decimals = decimals;
        Prefix = prefix;
        Suffix = suffix;
        DurationSeconds = durationSeconds;
        Animate = animate;
    }

    /// <summary>The target value the count-up settles on (web <c>value</c> prop / tween <c>to</c>).</summary>
    public double Value { get; }

    /// <summary>The fixed fraction-digit count the number is rendered with (web <c>decimals</c>, never negative).</summary>
    public int Decimals { get; }

    /// <summary>The leading text rendered before the number (web <c>prefix</c>); empty when unset.</summary>
    public string Prefix { get; }

    /// <summary>The trailing text rendered after the number (web <c>suffix</c>); empty when unset.</summary>
    public string Suffix { get; }

    /// <summary>The tween duration in seconds (web <c>duration</c>, clamped to be non-negative).</summary>
    public double DurationSeconds { get; }

    /// <summary>
    /// Whether the count-up animates. False under reduced motion or a non-positive duration, where the readout
    /// snaps straight to <see cref="Value"/> — the native analogue of the web tween reaching <c>progress = 1</c>
    /// immediately and the system "animations off" / Narrator expectation.
    /// </summary>
    public bool Animate { get; }

    /// <summary>
    /// The fully formatted final readout (<see cref="Prefix"/> + formatted <see cref="Value"/> +
    /// <see cref="Suffix"/>). This is the settled string the surface exposes as its accessible name so Narrator
    /// reads the meaningful value rather than the intermediate count-up frames.
    /// </summary>
    public string FormattedTarget => Format(Value);

    /// <summary>
    /// Format one tween frame exactly as the web render does:
    /// <c>{prefix}{fmtNumber(frame, decimals)}{suffix}</c>. The number flows through the shared
    /// <see cref="ScalarFormatters.FormatNumber(double?, int, string)"/> so grouping and rounding match the web
    /// <c>Intl.NumberFormat</c> contract.
    /// </summary>
    /// <param name="frameValue">The interpolated value at the current animation frame.</param>
    /// <returns>The prefixed/suffixed, locale-formatted readout string.</returns>
    public string Format(double frameValue) =>
        $"{Prefix}{ScalarFormatters.FormatNumber(frameValue, Decimals)}{Suffix}";

    /// <summary>
    /// Project the render inputs. <paramref name="decimals"/> is clamped to be non-negative and
    /// <paramref name="durationSeconds"/> to be non-negative; <paramref name="prefix"/> / <paramref name="suffix"/>
    /// default to empty. <see cref="Animate"/> is true only when motion is allowed and the duration is positive
    /// (web reduced-motion / zero-duration both collapse the tween to its final frame).
    /// </summary>
    /// <param name="value">The target value (web <c>value</c>).</param>
    /// <param name="decimals">The fraction-digit count (web <c>decimals</c>).</param>
    /// <param name="prefix">The leading text (web <c>prefix</c>), or null for none.</param>
    /// <param name="suffix">The trailing text (web <c>suffix</c>), or null for none.</param>
    /// <param name="durationSeconds">The tween duration in seconds (web <c>duration</c>).</param>
    /// <param name="reduceMotion">Whether the OS reduce-motion preference is set.</param>
    public static AnimatedNumberProjection Project(
        double value,
        int decimals,
        string? prefix,
        string? suffix,
        double durationSeconds,
        bool reduceMotion)
    {
        int safeDecimals = decimals < 0 ? 0 : decimals;
        double safeDuration = durationSeconds < 0 ? 0 : durationSeconds;
        bool animate = !reduceMotion && safeDuration > 0;

        return new AnimatedNumberProjection(
            value,
            safeDecimals,
            prefix ?? string.Empty,
            suffix ?? string.Empty,
            safeDuration,
            animate);
    }
}

/// <summary>
/// PII-safe diagnostics for the AnimatedNumber surface (P1/S11 diagnostics contract). The readout carries no
/// user content beyond a caller-supplied number and prefix/suffix, so the collector records only the
/// operational <c>view.opened</c> event with the surface slug — never the value. Thread-safe.
/// </summary>
public sealed class AnimatedNumberDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public AnimatedNumberDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=AnimatedNumber</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={AnimatedNumberRegistration.Slug}");
    }
}
