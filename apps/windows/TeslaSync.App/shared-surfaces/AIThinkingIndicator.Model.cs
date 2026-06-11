using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata for the AIThinkingIndicator surface — the native analogue of the module-level
/// constants and default <c>t()</c> calls in <c>web/src/components/ai/AIThinkingIndicator.tsx</c>. The web
/// component is a pure presentational "streaming-but-empty" indicator (the state shown while the SSE
/// connection is open and the first <c>delta.text</c> frame has not arrived), so this carries the diagnostics
/// slug, the <c>data-testid</c> automation id, the two i18n keys the source references (the default
/// <c>helix.thinking</c> label and the <c>ai.common.thinking</c> override example from the JSDoc), and the
/// structural constants the view composes from (three prose skeleton lines whose decreasing widths mimic text,
/// and three trailing "thinking" dots).
/// </summary>
public static class AIThinkingIndicatorRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "AIThinkingIndicator";

    /// <summary>
    /// The root automation id — the native analogue of the web <c>data-testid="ai-thinking-indicator"</c>.
    /// </summary>
    public const string RootAutomationId = "ai-thinking-indicator";

    /// <summary>
    /// i18n key for the default leading label (web <c>t('helix.thinking', 'Helix is thinking')</c>). The
    /// resource catalog is <c>translation</c>-namespaced, so the web key <c>helix.thinking</c> resolves under
    /// <see cref="HelixThinkingKey"/> here; absent a catalog entry the i18n facade returns
    /// <see cref="HelixThinkingFallback"/> verbatim, exactly as the peer AI surfaces do.
    /// </summary>
    public const string HelixThinkingKey = "translation.helix.thinking";

    /// <summary>English fallback for <see cref="HelixThinkingKey"/> (web second arg, verbatim — no ellipsis).</summary>
    public const string HelixThinkingFallback = "Helix is thinking";

    /// <summary>
    /// i18n key for the generic AI thinking label referenced by the web source's JSDoc as the override a
    /// summary-style surface would pass (web <c>t('ai.common.thinking', 'AI is thinking')</c>). Exposed so a
    /// host can request the generic verb instead of the Helix-branded default.
    /// </summary>
    public const string AiCommonThinkingKey = "translation.ai.common.thinking";

    /// <summary>English fallback for <see cref="AiCommonThinkingKey"/> (web second arg, verbatim).</summary>
    public const string AiCommonThinkingFallback = "AI is thinking";

    /// <summary>
    /// The ARIA role the web container declares (<c>role="status"</c>) — surfaced so the view and tests agree on
    /// the live-region contract the screen reader observes.
    /// </summary>
    public const string Role = "status";

    /// <summary>The ARIA live urgency the web container declares (<c>aria-live="polite"</c>).</summary>
    public const string LiveSetting = "polite";

    /// <summary>The number of trailing "thinking" dots the web indicator renders.</summary>
    public const int DotCount = 3;

    /// <summary>
    /// The decreasing widths of the three prose skeleton lines, as (numerator, denominator) fractions of the
    /// container width — the native analogue of the web <c>w-full</c>, <c>w-11/12</c> and <c>w-9/12</c> classes.
    /// Kept as exact fractions so the view can lay them out proportionally (responsive) rather than at a fixed
    /// pixel width.
    /// </summary>
    public static IReadOnlyList<(int Numerator, int Denominator)> SkeletonLineFractions { get; } =
        new (int, int)[] { (1, 1), (11, 12), (9, 12) };
}

/// <summary>
/// Pure projection of the indicator's render inputs — the native port of the web component body's two
/// decisions (web/src/components/ai/AIThinkingIndicator.tsx): the resolved leading label
/// (<c>label ?? t('helix.thinking', 'Helix is thinking')</c>) and whether motion runs (the web
/// <c>motion-safe:</c> variant, which drops the bouncing dots and line shimmer under
/// <c>prefers-reduced-motion</c>). Kept static and side-effect-free so the adapter is unit-testable without a
/// view-model or a UI thread; the <see cref="AIThinkingIndicatorViewModel"/> and the WinUI view both render
/// from it.
/// </summary>
public readonly record struct AIThinkingProjection
{
    private AIThinkingProjection(string label, bool animate)
    {
        Label = label;
        Animate = animate;
        Role = AIThinkingIndicatorRegistration.Role;
        LiveSetting = AIThinkingIndicatorRegistration.LiveSetting;
    }

    /// <summary>
    /// The resolved leading label — the screen-reader-visible status text. This is also the surface's
    /// accessible name, mirroring the web <c>role="status"</c> element whose only non-hidden content is the
    /// label (the HelixMark, dots and skeleton lines are <c>aria-hidden</c>).
    /// </summary>
    public string Label { get; }

    /// <summary>
    /// Whether the indicator animates (bouncing dots + shimmering lines). False under reduced motion, where the
    /// static skeleton is still shown — the web <c>motion-safe:</c> behaviour. Equivalent to
    /// <c>MotionDuration.ShouldAnimate(reduceMotion)</c>.
    /// </summary>
    public bool Animate { get; }

    /// <summary>The ARIA role the surface exposes (always <see cref="AIThinkingIndicatorRegistration.Role"/>).</summary>
    public string Role { get; }

    /// <summary>The ARIA live urgency the surface exposes (always <see cref="AIThinkingIndicatorRegistration.LiveSetting"/>).</summary>
    public string LiveSetting { get; }

    /// <summary>
    /// Project the render inputs. When <paramref name="customLabel"/> is null/blank the default label is
    /// resolved through the i18n facade (web <c>t('helix.thinking', 'Helix is thinking')</c>); otherwise the
    /// caller's already-translated override is used verbatim (web <c>label ?? ...</c>). <paramref name="reduceMotion"/>
    /// flips <see cref="Animate"/> off (web <c>prefers-reduced-motion</c>).
    /// </summary>
    /// <param name="localizer">The i18n facade the default label resolves through.</param>
    /// <param name="customLabel">An optional already-translated override label.</param>
    /// <param name="reduceMotion">Whether the OS reduce-motion preference is set.</param>
    public static AIThinkingProjection Project(ILocalizer localizer, string? customLabel, bool reduceMotion)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        var label = string.IsNullOrWhiteSpace(customLabel)
            ? localizer.GetString(
                AIThinkingIndicatorRegistration.HelixThinkingKey,
                AIThinkingIndicatorRegistration.HelixThinkingFallback)
            : customLabel;

        return new AIThinkingProjection(label, animate: !reduceMotion);
    }
}

/// <summary>
/// PII-safe diagnostics for the AIThinkingIndicator surface (P1/S11 diagnostics contract). The indicator
/// carries no user content (only a static "thinking" label), so the collector records the operational
/// <c>view.opened</c> event with the surface slug and nothing else. Thread-safe.
/// </summary>
public sealed class AIThinkingIndicatorDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public AIThinkingIndicatorDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=AIThinkingIndicator</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={AIThinkingIndicatorRegistration.Slug}");
    }
}
