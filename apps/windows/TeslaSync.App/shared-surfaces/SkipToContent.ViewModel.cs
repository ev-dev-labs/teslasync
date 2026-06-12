using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="SkipToContent"/> view — the native port of the web
/// component (web/src/components/feedback/SkipToContent.tsx). The web component resolves a single localized
/// label through <c>useTranslation</c> and, on activation, focuses + scrolls the <c>#main-content</c> landmark
/// guarded by an <c>if (main)</c> check. This holder reproduces that exactly: it resolves the
/// <see cref="Label"/> once through the <see cref="ILocalizer"/> facade (P1/S10), reports whether the
/// main-content landmark is present via the <see cref="ISkipTarget"/> seam (P1/S8), and exposes
/// <see cref="Activate"/> which moves focus to the landmark when present and is a safe no-op otherwise — the web
/// <c>onClick</c> body. Because the surface has no data fetch there is no loading / error / stale / offline
/// branch to model (the web source has none); the only states are the resting (hidden) link, the focused
/// (revealed) link, and the activation outcome, all driven from this holder. The view performs no i18n, focus or
/// scrolling decision of its own — it binds to this holder. Drive it from one confinement (the UI thread); it is
/// not internally synchronised.
/// </summary>
public sealed class SkipToContentViewModel
{
    private readonly ISkipTarget _target;
    private readonly SkipToContentDiagnostics _diagnostics;
    private readonly string _label;
    private bool _opened;

    /// <summary>Creates the holder over the i18n facade, the landmark seam and an optional diagnostics sink.</summary>
    /// <param name="localizer">The i18n facade the label resolves through (web <c>useTranslation</c>).</param>
    /// <param name="target">The main-content landmark seam (web <c>document.getElementById('main-content')</c>).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the surface counters.</param>
    public SkipToContentViewModel(
        ILocalizer localizer,
        ISkipTarget target,
        SkipToContentDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(target);

        _target = target;
        _diagnostics = diagnostics ?? new SkipToContentDiagnostics();
        _label = SkipToContentRegistration.ResolveLabel(localizer);
    }

    /// <summary>The localized link label (web <c>t('a11y.skipToContent', 'Skip to main content')</c>).</summary>
    public string Label => _label;

    /// <summary>True when a main-content landmark is present to jump to (web <c>if (main)</c>).</summary>
    public bool HasTarget => _target.IsAvailable;

    /// <summary>The canonical diagnostics slug this surface registers under (<c>SkipToContent</c>).</summary>
    public static string Slug => SkipToContentRegistration.Slug;

    /// <summary>
    /// Record the surface opening exactly once (web component mount), emitting the <c>view.opened</c> diagnostic.
    /// Idempotent — a second call is a no-op — so repeated <c>Loaded</c> events never double-count.
    /// </summary>
    public void MarkOpened()
    {
        if (_opened)
        {
            return;
        }

        _opened = true;
        _diagnostics.RecordViewOpened();
    }

    /// <summary>
    /// Activate the skip link (web <c>onClick</c>): when the main-content landmark is present, move focus to it
    /// and bring it into view (web <c>main.focus(...); main.scrollIntoView(...)</c>) and record the activation;
    /// otherwise do nothing and record the miss (the web <c>if (main)</c> guard falling through — never throws).
    /// </summary>
    /// <returns>Whether focus was moved to the landmark or there was none to jump to.</returns>
    public SkipActivationResult Activate()
    {
        SkipActivationResult result = SkipActivation.Decide(_target.IsAvailable);
        if (result == SkipActivationResult.Activated)
        {
            _target.Focus();
            _diagnostics.RecordActivated();
        }
        else
        {
            _diagnostics.RecordTargetMissing();
        }

        return result;
    }
}
