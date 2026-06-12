using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata for the <c>SkipToContent</c> shared surface — the native analogue of the literals in
/// web/src/components/feedback/SkipToContent.tsx. The web component is a WCAG 2.4.1 (Bypass Blocks, Level A)
/// skip link: a single visually-hidden-until-focused anchor, mounted as the very first interactive element of
/// the layout, that on activation moves focus to (and scrolls into view) the page's <c>#main-content</c>
/// landmark so keyboard / screen-reader users do not have to tab through the entire sidebar on every page.
/// It renders one localized label and resolves it through <c>t('a11y.skipToContent', 'Skip to main content')</c>;
/// there is no data fetch, so the surface has no loading / empty / error / stale / offline chrome. This holder
/// pins the diagnostics slug, the link's automation id (the web <c>data-testid="skip-to-content"</c>), the
/// target landmark id (the web <c>#main-content</c>), the single i18n key + its verbatim English fallback, and
/// the label resolver. UI-free so the metadata is asserted headlessly.
/// </summary>
public static class SkipToContentRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "SkipToContent";

    /// <summary>The automation id the link exposes — the web <c>data-testid="skip-to-content"</c>.</summary>
    public const string LinkAutomationId = "skip-to-content";

    /// <summary>The landmark the link jumps to — the web <c>#main-content</c> / <c>id="main-content"</c>.</summary>
    public const string TargetLandmarkId = "main-content";

    /// <summary>i18n key for the link label (web <c>t('a11y.skipToContent', ...)</c> at SkipToContent.tsx L41).</summary>
    public const string LabelKey = "translation.a11y.skipToContent";

    /// <summary>English fallback for <see cref="LabelKey"/> — the web default value, verbatim.</summary>
    public const string LabelFallback = "Skip to main content";

    /// <summary>Resolve the localized link label (web <c>t('a11y.skipToContent', 'Skip to main content')</c>).</summary>
    /// <param name="localizer">The i18n facade the label resolves through.</param>
    public static string ResolveLabel(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(LabelKey, LabelFallback);
    }
}

/// <summary>
/// The main-content landmark seam the skip link activates (P1/S8 state-holder seam) — the native analogue of
/// the web <c>document.getElementById('main-content')</c> the component reads in its <c>onClick</c>. The view
/// never resolves the landmark itself: a shell adapter (or a test fake) reports whether the landmark is present
/// (<see cref="IsAvailable"/> — the web <c>if (main)</c> guard) and performs the focus move
/// (<see cref="Focus"/> — the web <c>main.focus({ preventScroll: false }); main.scrollIntoView({ block: 'start' })</c>),
/// so the activation logic is asserted headlessly. The production adapter wraps the WinUI main-content control;
/// <see cref="NullSkipTarget"/> stands in when no landmark is mounted (the web missing-landmark branch).
/// </summary>
public interface ISkipTarget
{
    /// <summary>True when a main-content landmark is present to jump to (web <c>if (main)</c>).</summary>
    bool IsAvailable { get; }

    /// <summary>
    /// Move keyboard focus to the landmark and bring it into view — the web
    /// <c>main.focus({ preventScroll: false }); main.scrollIntoView({ block: 'start' })</c>. Never called when
    /// <see cref="IsAvailable"/> is false.
    /// </summary>
    void Focus();
}

/// <summary>
/// The inert landmark seam used when no main-content landmark is mounted — the native analogue of the web
/// component's <c>if (main)</c> guard falling through when <c>document.getElementById('main-content')</c>
/// returns null: the activation is a safe no-op that never throws. <see cref="IsAvailable"/> is always false
/// and <see cref="Focus"/> does nothing.
/// </summary>
public sealed class NullSkipTarget : ISkipTarget
{
    /// <summary>The shared inert instance.</summary>
    public static NullSkipTarget Instance { get; } = new();

    private NullSkipTarget()
    {
    }

    /// <inheritdoc />
    public bool IsAvailable => false;

    /// <inheritdoc />
    public void Focus()
    {
        // No landmark mounted — the web onClick falls through its `if (main)` guard and does nothing.
    }
}

/// <summary>
/// The outcome of activating the skip link — whether the main-content landmark was focused
/// (<see cref="Activated"/>) or there was no landmark to jump to (<see cref="NoTarget"/>, the web
/// <c>if (main)</c> guard falling through). Exposed so the view-model's <c>Activate</c> can be asserted
/// headlessly.
/// </summary>
public enum SkipActivationResult
{
    /// <summary>The landmark was present and focus was moved to it (web <c>if (main) { ... }</c>).</summary>
    Activated,

    /// <summary>No landmark was present, so nothing happened (web guard fell through; never throws).</summary>
    NoTarget,
}

/// <summary>
/// Pure decision for what activating the skip link should do, given whether the main-content landmark is
/// present — the native port of the web component's <c>onClick</c> guard
/// (web/src/components/feedback/SkipToContent.tsx L32-39): <c>const main = document.getElementById('main-content');
/// if (main) { main.focus(...); main.scrollIntoView(...); }</c>. When the landmark is present the result is
/// <see cref="SkipActivationResult.Activated"/>; otherwise it is <see cref="SkipActivationResult.NoTarget"/> and
/// the caller does nothing (the web no-op). No WinUI types — unit-tested without a UI host.
/// </summary>
public static class SkipActivation
{
    /// <summary>Decide the activation outcome for a landmark that is present or absent.</summary>
    /// <param name="targetAvailable">Whether the main-content landmark is present (web <c>if (main)</c>).</param>
    public static SkipActivationResult Decide(bool targetAvailable) =>
        targetAvailable ? SkipActivationResult.Activated : SkipActivationResult.NoTarget;
}

/// <summary>
/// PII-safe diagnostics for the <c>SkipToContent</c> surface (P1/S11 diagnostics contract). The surface carries
/// no user content — only the localized, static skip-link label and a focus move — so the collector records only
/// operational counters with the surface slug: the <c>view.opened</c> event the prompt requires, plus the
/// activation outcome (focused vs. no-landmark). No label, route or landmark text is ever passed. Thread-safe;
/// mirrors the peer surfaces' diagnostics collectors.
/// </summary>
public sealed class SkipToContentDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;
    private long _activations;
    private long _targetMisses;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the operational lines are written to, or null.</param>
    public SkipToContentDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Number of activations that moved focus to the landmark.</summary>
    public long Activations => Interlocked.Read(ref _activations);

    /// <summary>Number of activations that found no landmark to jump to (web guard fell through).</summary>
    public long TargetMisses => Interlocked.Read(ref _targetMisses);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=SkipToContent</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={SkipToContentRegistration.Slug}");
    }

    /// <summary>Record a focus move to the landmark, emitting <c>skip.activated slug=SkipToContent</c>.</summary>
    public void RecordActivated()
    {
        Interlocked.Increment(ref _activations);
        _sink?.Invoke($"skip.activated slug={SkipToContentRegistration.Slug}");
    }

    /// <summary>Record an activation with no landmark, emitting <c>skip.targetMissing slug=SkipToContent</c>.</summary>
    public void RecordTargetMissing()
    {
        Interlocked.Increment(ref _targetMisses);
        _sink?.Invoke($"skip.targetMissing slug={SkipToContentRegistration.Slug}");
    }
}
