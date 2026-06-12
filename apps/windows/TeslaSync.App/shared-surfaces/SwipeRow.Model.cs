namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata + pure interaction maths for the SwipeRow surface — the native analogue of the
/// module-level constants and the touch handlers in <c>web/src/components/mobile/SwipeRow.tsx</c>. The web
/// component is a swipe-to-action row primitive that mirrors the iOS Mail / Apple Notes gesture: drag left to
/// reveal a right-edge action, drag right to reveal a left-edge action; a short release past the reveal
/// threshold leaves the row "peeked" with the action button tappable, a long release past 50&#160;% of the row
/// width auto-fires the action, a vertical drag aborts so the parent list keeps scrolling, and crossing the
/// reveal threshold for the first time fires a single haptic blip. It reads no network data and renders no
/// titles of its own, so this type carries the diagnostics slug, the automation id, the gesture constants (the
/// web <c>DEFAULT_REVEAL</c> / <c>VERTICAL_TOLERANCE</c> / <c>ACTION_WIDTH</c> and the 8&#160;px horizontal lock
/// / 10&#160;ms haptic / <c>duration-fast</c> snap), the default action glyphs (the web <c>Archive</c> /
/// <c>Trash2</c> by tone), and the pure offset / release maths the view drives through. UI-free so every value is
/// asserted headlessly.
/// </summary>
public static class SwipeRowRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "SwipeRow";

    /// <summary>
    /// The root automation id the view stamps on itself — the native analogue of the web
    /// <c>data-testid="swipe-row"</c>, the only stable hook UI-automation tests target on the anonymous wrapper.
    /// </summary>
    public const string RootAutomationId = "swipe-row";

    /// <summary>
    /// Default distance (device-independent pixels) the user must drag before the action is "revealed" — the web
    /// <c>DEFAULT_REVEAL</c> (64&#160;px). A caller may override it per row (web <c>revealThreshold</c> prop).
    /// </summary>
    public const double DefaultRevealThreshold = 64;

    /// <summary>
    /// Vertical drift (px) past which the gesture is abandoned so the parent list keeps scrolling — the web
    /// <c>VERTICAL_TOLERANCE</c> (16&#160;px).
    /// </summary>
    public const double VerticalTolerance = 16;

    /// <summary>Width (px) of the revealed action panel and the resting peek offset — the web <c>ACTION_WIDTH</c> (96&#160;px).</summary>
    public const double ActionWidth = 96;

    /// <summary>
    /// Horizontal movement (px) at which the gesture locks onto the swipe axis — the web <c>Math.abs(dx) &lt; 8</c>
    /// guard that distinguishes "the user wants to swipe" from an incidental tap jitter.
    /// </summary>
    public const double HorizontalEngageThreshold = 8;

    /// <summary>Haptic blip length (ms) fired once when the reveal threshold is first crossed — the web <c>navigator.vibrate(10)</c>.</summary>
    public const int HapticPulseMs = 10;

    /// <summary>
    /// Snap-back / settle transition length (ms) — the web <c>duration-fast</c> (<c>--motion-duration-fast: 150ms</c>).
    /// Collapses to 0 under reduced motion (the web <c>prefers-reduced-motion</c> short-circuit / the
    /// <c>--motion-duration-fast: 0ms</c> override), routed through <c>MotionDuration.Resolve</c> in the view.
    /// </summary>
    public const int SnapDurationMs = 150;

    /// <summary>
    /// Segoe Fluent Icons glyph for the default <see cref="SwipeActionTone.Default"/> action — the native
    /// analogue of the web lucide <c>Archive</c> icon (U+E7B8 "Archive").
    /// </summary>
    public const string DefaultActionGlyph = "\uE7B8";

    /// <summary>
    /// Segoe Fluent Icons glyph for the default <see cref="SwipeActionTone.Danger"/> action — the native analogue
    /// of the web lucide <c>Trash2</c> icon (U+E74D "Delete").
    /// </summary>
    public const string DangerActionGlyph = "\uE74D";

    /// <summary>Resolve the default glyph for a tone (web <c>defaultIcon</c>: <c>Trash2</c> for danger, else <c>Archive</c>).</summary>
    /// <param name="tone">The action tone.</param>
    public static string DefaultGlyphFor(SwipeActionTone tone) =>
        tone == SwipeActionTone.Danger ? DangerActionGlyph : DefaultActionGlyph;
}

/// <summary>
/// Visual tone of a swipe action — the native analogue of the web <c>SwipeAction.tone</c>
/// (<c>'danger' | 'default'</c>). <see cref="Default"/> paints the cyan action panel, <see cref="Danger"/> the
/// rose one (web <c>actionPanelClasses</c>).
/// </summary>
public enum SwipeActionTone
{
    /// <summary>web <c>'default'</c> — the cyan action panel. The default.</summary>
    Default,

    /// <summary>web <c>'danger'</c> — the rose action panel (delete / destructive).</summary>
    Danger,
}

/// <summary>
/// The display data of one swipe action — the native port of the web <c>SwipeAction</c> interface
/// (web/src/components/mobile/SwipeRow.tsx L41-L55), minus the <c>onAction</c> callback, which is behaviour and
/// lives on the <see cref="SwipeRowViewModel"/>. Pure data so the projection and the accessible-name contract are
/// unit-tested without a view. The action button's accessible name is <see cref="AriaLabel"/> when supplied,
/// otherwise <see cref="Label"/> (web <c>aria-label={ariaLabel ?? label}</c>); its glyph is
/// <see cref="IconGlyphOverride"/> when supplied, otherwise the tone default (web <c>defaultIcon</c>).
/// </summary>
public sealed record SwipeActionModel
{
    /// <summary>Creates the action display model.</summary>
    /// <param name="label">The localised label rendered inside the action button (web <c>label</c>). Required.</param>
    /// <param name="tone">The visual tone (web <c>tone</c>); defaults to <see cref="SwipeActionTone.Default"/>.</param>
    /// <param name="ariaLabel">An optional accessible-name override (web <c>ariaLabel</c>); null/blank falls back to <paramref name="label"/>.</param>
    /// <param name="iconGlyphOverride">An optional Segoe Fluent Icons glyph (web <c>icon</c>); null/blank falls back to the tone default.</param>
    public SwipeActionModel(
        string label,
        SwipeActionTone tone = SwipeActionTone.Default,
        string? ariaLabel = null,
        string? iconGlyphOverride = null)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(label);
        Label = label;
        Tone = tone;
        AriaLabel = string.IsNullOrWhiteSpace(ariaLabel) ? null : ariaLabel;
        IconGlyphOverride = string.IsNullOrWhiteSpace(iconGlyphOverride) ? null : iconGlyphOverride;
    }

    /// <summary>The localised label rendered inside the action button (web <c>label</c>).</summary>
    public string Label { get; }

    /// <summary>The visual tone (web <c>tone</c>).</summary>
    public SwipeActionTone Tone { get; }

    /// <summary>The accessible-name override, or null when the label is screen-reader friendly (web <c>ariaLabel</c>).</summary>
    public string? AriaLabel { get; }

    /// <summary>The glyph override, or null to use the tone default (web <c>icon</c>).</summary>
    public string? IconGlyphOverride { get; }

    /// <summary>The accessible name the action button reports (web <c>aria-label={ariaLabel ?? label}</c>).</summary>
    public string AccessibleName => AriaLabel ?? Label;

    /// <summary>The resolved Segoe Fluent Icons glyph (web <c>icon ?? defaultIcon(tone)</c>).</summary>
    public string Glyph => IconGlyphOverride ?? SwipeRowRegistration.DefaultGlyphFor(Tone);
}

/// <summary>
/// The outcome the gesture resolves to on release — the native analogue of the branch ladder in the web
/// <c>onTouchEnd</c> (web/src/components/mobile/SwipeRow.tsx L210-L247).
/// </summary>
public enum SwipeOutcome
{
    /// <summary>The row snaps back closed (web final <c>updateOffset(0)</c>).</summary>
    None,

    /// <summary>The left action is held open for a tap (web <c>updateOffset(ACTION_WIDTH)</c>).</summary>
    PeekLeft,

    /// <summary>The right action is held open for a tap (web <c>updateOffset(-ACTION_WIDTH)</c>).</summary>
    PeekRight,

    /// <summary>The left action auto-fires immediately (web <c>fireLeft()</c>).</summary>
    FireLeft,

    /// <summary>The right action auto-fires immediately (web <c>fireRight()</c>).</summary>
    FireRight,
}

/// <summary>
/// The resolved result of releasing a drag — the <see cref="Outcome"/> plus the offset the row rests at after the
/// snap-back (0 when closed or firing, ±<see cref="SwipeRowRegistration.ActionWidth"/> when peeked).
/// </summary>
/// <param name="Outcome">What the release does.</param>
/// <param name="RestingOffset">The translate-X the content settles to (px; negative = revealed right action).</param>
public readonly record struct SwipeRelease(SwipeOutcome Outcome, double RestingOffset);

/// <summary>
/// The pure offset / release maths of the swipe gesture — the native port of the web <c>onTouchMove</c> /
/// <c>onTouchEnd</c> bodies (web/src/components/mobile/SwipeRow.tsx L162-L247). Side-effect-free and UI-free so the
/// whole gesture is verified headlessly: the vertical-abort guard, the horizontal-engage lock, the per-side
/// drag clamp, the first-threshold-cross detection (for the haptic) and the release branch ladder (auto-fire past
/// half-width, peek past the reveal threshold, else snap closed).
/// </summary>
public static class SwipeGeometry
{
    /// <summary>
    /// Whether a not-yet-engaged gesture should abort because the user is scrolling the list vertically — the web
    /// <c>!dragging &amp;&amp; Math.abs(dy) &gt; VERTICAL_TOLERANCE &amp;&amp; Math.abs(dy) &gt; Math.abs(dx)</c>.
    /// </summary>
    /// <param name="dx">Horizontal delta from the touch start (px).</param>
    /// <param name="dy">Vertical delta from the touch start (px).</param>
    /// <param name="verticalTolerance">Drift past which the gesture aborts (default the web <c>VERTICAL_TOLERANCE</c>).</param>
    public static bool IsVerticalCancel(double dx, double dy, double verticalTolerance = SwipeRowRegistration.VerticalTolerance) =>
        Math.Abs(dy) > verticalTolerance && Math.Abs(dy) > Math.Abs(dx);

    /// <summary>
    /// Whether the horizontal movement is large enough to lock onto the swipe axis — the web
    /// <c>Math.abs(dx) &gt;= 8</c> (the inverse of the <c>&lt; 8</c> early-return).
    /// </summary>
    /// <param name="dx">Horizontal delta from the touch start (px).</param>
    /// <param name="engageThreshold">Movement at which the swipe engages (default the web 8&#160;px).</param>
    public static bool IsHorizontalEngaged(double dx, double engageThreshold = SwipeRowRegistration.HorizontalEngageThreshold) =>
        Math.Abs(dx) >= engageThreshold;

    /// <summary>
    /// Clamp a raw horizontal delta to a renderable content offset — the web limit-to-wired-side + overshoot
    /// resist (web L186-L194): a left drag is ignored when there is no right action, a right drag when there is
    /// no left action, and the magnitude never exceeds the row width.
    /// </summary>
    /// <param name="dx">Raw horizontal delta from the touch start (px).</param>
    /// <param name="width">The measured row width (px); a non-positive width falls back to the web 320&#160;px default.</param>
    /// <param name="hasLeftAction">Whether a left-edge action is wired (revealed by a right drag, positive offset).</param>
    /// <param name="hasRightAction">Whether a right-edge action is wired (revealed by a left drag, negative offset).</param>
    public static double ClampOffset(double dx, double width, bool hasLeftAction, bool hasRightAction)
    {
        double next = dx;
        if (next < 0 && !hasRightAction)
        {
            next = 0;
        }

        if (next > 0 && !hasLeftAction)
        {
            next = 0;
        }

        double maxAbs = width > 0 ? width : 320;
        if (next < -maxAbs)
        {
            next = -maxAbs;
        }

        if (next > maxAbs)
        {
            next = maxAbs;
        }

        return next;
    }

    /// <summary>
    /// Whether the offset has reached the reveal threshold (used to fire the one-shot haptic) — the web
    /// <c>Math.abs(next) &gt;= revealThreshold</c>.
    /// </summary>
    /// <param name="offset">The current content offset (px).</param>
    /// <param name="revealThreshold">The reveal distance (px).</param>
    public static bool CrossedReveal(double offset, double revealThreshold) =>
        Math.Abs(offset) >= revealThreshold;

    /// <summary>
    /// Resolve a drag release to its outcome + resting offset — the native port of the web <c>onTouchEnd</c>
    /// branch ladder (web L228-L246): a far left swipe (past half width) auto-fires the right action, a far right
    /// swipe auto-fires the left action, a shorter swipe past the reveal threshold peeks the relevant action open,
    /// and anything less snaps the row closed. Each branch is gated on the matching action being wired, exactly as
    /// the web is.
    /// </summary>
    /// <param name="finalOffset">The content offset at release (px; negative = right action revealed).</param>
    /// <param name="width">The measured row width (px); a non-positive width falls back to the web 320&#160;px default.</param>
    /// <param name="revealThreshold">The reveal distance (px).</param>
    /// <param name="hasLeftAction">Whether a left-edge action is wired.</param>
    /// <param name="hasRightAction">Whether a right-edge action is wired.</param>
    /// <param name="actionWidth">The resting peek offset magnitude (default the web <c>ACTION_WIDTH</c>).</param>
    public static SwipeRelease ResolveRelease(
        double finalOffset,
        double width,
        double revealThreshold,
        bool hasLeftAction,
        bool hasRightAction,
        double actionWidth = SwipeRowRegistration.ActionWidth)
    {
        double effectiveWidth = width > 0 ? width : 320;
        double halfWidth = effectiveWidth / 2;

        if (finalOffset <= -halfWidth && hasRightAction)
        {
            return new SwipeRelease(SwipeOutcome.FireRight, 0);
        }

        if (finalOffset >= halfWidth && hasLeftAction)
        {
            return new SwipeRelease(SwipeOutcome.FireLeft, 0);
        }

        if (finalOffset <= -revealThreshold && hasRightAction)
        {
            return new SwipeRelease(SwipeOutcome.PeekRight, -actionWidth);
        }

        if (finalOffset >= revealThreshold && hasLeftAction)
        {
            return new SwipeRelease(SwipeOutcome.PeekLeft, actionWidth);
        }

        return new SwipeRelease(SwipeOutcome.None, 0);
    }
}

/// <summary>
/// Pure projection of the SwipeRow's render inputs — the native port of the web component body
/// (web/src/components/mobile/SwipeRow.tsx L103-L113, L271-L273). It decides whether the swipe gesture is
/// <see cref="IsActive"/> (the web <c>active = (enabled ?? isCoarse) &amp;&amp; (rightAction != null || leftAction
/// != null)</c>: touch-only by default, and only when at least one action is wired — otherwise the row renders its
/// children straight through), surfaces the wired <see cref="LeftAction"/> / <see cref="RightAction"/> display
/// models and the <see cref="ReduceMotion"/> flag (web <c>useMotionPreference</c>, which collapses the snap-back
/// transition to 0&#160;ms), and carries the per-row <see cref="RevealThreshold"/> + the
/// <see cref="ActionWidth"/>. Kept static and side-effect-free so the adapter is unit-testable without a
/// view-model or a UI thread.
/// </summary>
public readonly record struct SwipeRowProjection
{
    private SwipeRowProjection(
        bool isActive,
        SwipeActionModel? leftAction,
        SwipeActionModel? rightAction,
        bool reduceMotion,
        double revealThreshold)
    {
        IsActive = isActive;
        LeftAction = leftAction;
        RightAction = rightAction;
        ReduceMotion = reduceMotion;
        RevealThreshold = revealThreshold;
        ActionWidth = SwipeRowRegistration.ActionWidth;
    }

    /// <summary>
    /// Whether the swipe gesture is wired up. False on a fine pointer (mouse) unless explicitly enabled, and false
    /// when no action is wired — in both cases the view renders its children straight through with no handlers
    /// (web <c>if (!active) return &lt;&gt;{children}&lt;/&gt;</c>).
    /// </summary>
    public bool IsActive { get; }

    /// <summary>The left-edge action (revealed by a right drag), or null when none is wired (web <c>leftAction</c>).</summary>
    public SwipeActionModel? LeftAction { get; }

    /// <summary>The right-edge action (revealed by a left drag), or null when none is wired (web <c>rightAction</c>).</summary>
    public SwipeActionModel? RightAction { get; }

    /// <summary>Whether a left-edge action is wired (web <c>leftAction != null</c>).</summary>
    public bool HasLeftAction => LeftAction is not null;

    /// <summary>Whether a right-edge action is wired (web <c>rightAction != null</c>).</summary>
    public bool HasRightAction => RightAction is not null;

    /// <summary>Whether the OS reduce-motion preference is set, collapsing the snap-back to 0&#160;ms (web <c>useMotionPreference</c>).</summary>
    public bool ReduceMotion { get; }

    /// <summary>The reveal distance for this row in px (web <c>revealThreshold</c>, default 64).</summary>
    public double RevealThreshold { get; }

    /// <summary>The revealed action panel width / resting peek offset in px (web <c>ACTION_WIDTH</c>).</summary>
    public double ActionWidth { get; }

    /// <summary>
    /// Project the render inputs, reproducing the web component body. A null/non-positive
    /// <paramref name="revealThreshold"/> falls back to the web default (64&#160;px). The gesture is active only on
    /// a coarse pointer (unless <paramref name="enabled"/> overrides it) and only when at least one action is
    /// wired.
    /// </summary>
    /// <param name="enabled">The explicit touch opt-in (web <c>enabled</c>); null defers to <paramref name="coarsePointer"/>.</param>
    /// <param name="coarsePointer">Whether the primary pointer is coarse / touch (web <c>useIsCoarsePointer</c>).</param>
    /// <param name="reduceMotion">Whether the OS reduce-motion preference is set (web <c>useMotionPreference</c>).</param>
    /// <param name="leftAction">The left-edge action, or null (web <c>leftAction</c>).</param>
    /// <param name="rightAction">The right-edge action, or null (web <c>rightAction</c>).</param>
    /// <param name="revealThreshold">The per-row reveal distance (web <c>revealThreshold</c>); non-positive uses the default.</param>
    public static SwipeRowProjection Project(
        bool? enabled,
        bool coarsePointer,
        bool reduceMotion,
        SwipeActionModel? leftAction,
        SwipeActionModel? rightAction,
        double revealThreshold = SwipeRowRegistration.DefaultRevealThreshold)
    {
        bool hasAction = leftAction is not null || rightAction is not null;
        bool active = (enabled ?? coarsePointer) && hasAction;
        double threshold = revealThreshold > 0 ? revealThreshold : SwipeRowRegistration.DefaultRevealThreshold;

        return new SwipeRowProjection(active, leftAction, rightAction, reduceMotion, threshold);
    }
}

/// <summary>
/// PII-safe diagnostics for the SwipeRow surface (P1/S11 diagnostics contract). The row carries no user content
/// of its own beyond the caller-supplied action labels, so the collector records only the operational
/// <c>view.opened</c> event with the surface slug — never the labels or the wrapped row content. Thread-safe;
/// mirrors the peer surfaces' diagnostics collectors.
/// </summary>
public sealed class SwipeRowDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public SwipeRowDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=SwipeRow</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={SwipeRowRegistration.Slug}");
    }
}
