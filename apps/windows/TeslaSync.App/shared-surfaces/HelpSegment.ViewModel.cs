using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="HelpSegment"/> view — the native port of the web
/// component body (web/src/components/layout/status-bar/HelpSegment.tsx). The web component resolves seven labels
/// through <c>useTranslation</c> and exposes three click handlers that dispatch the decoupled help signals. This
/// holder reproduces that exactly: it resolves the <see cref="Labels"/> once through the <see cref="ILocalizer"/>
/// facade (P1/S10), records the compact <see cref="IconOnly"/> mode (web <c>iconOnly</c> prop), and exposes
/// <see cref="OpenKeyboardShortcuts"/> / <see cref="OpenTour"/> / <see cref="OpenFeedback"/> which route through the
/// <see cref="IHelpSegmentActions"/> seam (P1/S8) and count the invocation. Because the surface has no data fetch
/// there is no loading / error / stale / offline branch to model (the web source has none); the only state is the
/// compact-versus-expanded layout, driven from this holder. The view performs no i18n or command decision of its
/// own — it binds to this holder. Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class HelpSegmentViewModel
{
    private readonly IHelpSegmentActions _actions;
    private readonly HelpSegmentDiagnostics _diagnostics;
    private readonly HelpSegmentLabels _labels;
    private readonly bool _iconOnly;
    private bool _opened;

    /// <summary>Creates the holder over the i18n facade, the help-command seam, the layout mode and a diagnostics sink.</summary>
    /// <param name="localizer">The i18n facade every label resolves through (web <c>useTranslation</c>).</param>
    /// <param name="actions">The decoupled help-command seam the affordances route through (web event dispatchers).</param>
    /// <param name="iconOnly">Whether the compact icon-only mode is rendered (web <c>iconOnly</c> prop).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the surface counters.</param>
    public HelpSegmentViewModel(
        ILocalizer localizer,
        IHelpSegmentActions actions,
        bool iconOnly = false,
        HelpSegmentDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(actions);

        _actions = actions;
        _diagnostics = diagnostics ?? new HelpSegmentDiagnostics();
        _labels = HelpSegmentRegistration.ResolveLabels(localizer);
        _iconOnly = iconOnly;
    }

    /// <summary>The canonical surface slug this surface registers under (<c>HelpSegment</c>).</summary>
    public static string Slug => HelpSegmentRegistration.Slug;

    /// <summary>The localized strings the surface renders (web <c>useTranslation</c> results).</summary>
    public HelpSegmentLabels Labels => _labels;

    /// <summary>Whether the compact icon-only mode is rendered (web <c>iconOnly</c> prop).</summary>
    public bool IconOnly => _iconOnly;

    /// <summary>The key-cap shown on the shortcuts affordance in expanded mode (web <c>&lt;kbd&gt;?&lt;/kbd&gt;</c>).</summary>
    public static string ShortcutKeyCap => HelpSegmentRegistration.ShortcutKeyCap;

    /// <summary>The shortcuts hover tooltip (web <c>shortcuts.tooltip</c>).</summary>
    public string ShortcutsTooltip => _labels.ShortcutsTooltip;

    /// <summary>The shortcuts accessible name (web <c>shortcuts.openAria</c>).</summary>
    public string ShortcutsAria => _labels.ShortcutsAria;

    /// <summary>The text after the key-cap in expanded mode (web <c>shortcuts.hintSuffix</c>).</summary>
    public string ShortcutsHintSuffix => _labels.ShortcutsHintSuffix;

    /// <summary>The tour tooltip + expanded label (web <c>tour.launcher.openShort</c>).</summary>
    public string TourShort => _labels.TourShort;

    /// <summary>The tour accessible name (web <c>tour.launcher.openAria</c>).</summary>
    public string TourAria => _labels.TourAria;

    /// <summary>The feedback tooltip + expanded label (web <c>feedback.openShort</c>).</summary>
    public string FeedbackShort => _labels.FeedbackShort;

    /// <summary>The feedback accessible name (web <c>feedback.openAria</c>).</summary>
    public string FeedbackAria => _labels.FeedbackAria;

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
    /// Open the keyboard-shortcuts cheat sheet (web <c>openShortcuts</c> onClick): route through the seam and record
    /// the invocation. The web handler dispatches <c>toggle-keyboard-shortcuts</c>; the seam performs the native
    /// equivalent.
    /// </summary>
    public void OpenKeyboardShortcuts()
    {
        _actions.OpenKeyboardShortcuts();
        _diagnostics.RecordShortcutsOpened();
    }

    /// <summary>
    /// Open the guided-tour launcher (web <c>openTour</c> onClick): route through the seam and record the
    /// invocation. The web handler calls <c>dispatchTourLauncherOpen()</c>; the seam performs the native equivalent.
    /// </summary>
    public void OpenTour()
    {
        _actions.OpenTour();
        _diagnostics.RecordTourOpened();
    }

    /// <summary>
    /// Open the in-app feedback / bug-report form (web <c>openFeedback</c> onClick): route through the seam and
    /// record the invocation. The web handler dispatches <c>open-feedback-modal</c>; the seam performs the native
    /// equivalent.
    /// </summary>
    public void OpenFeedback()
    {
        _actions.OpenFeedback();
        _diagnostics.RecordFeedbackOpened();
    }
}
