using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata for the <c>HelpSegment</c> shared surface — the native analogue of the literals and
/// dispatched events in web/src/components/layout/status-bar/HelpSegment.tsx. The web component is the footer
/// status-bar segment that consolidates the three always-available help affordances that used to live at the
/// bottom of the sidebar: a keyboard-shortcuts cheat-sheet trigger (the <c>?</c> hint), a guided-tour launcher and
/// an in-app feedback / bug-report trigger. Each affordance stays decoupled from the view tree by dispatching the
/// same global signal the rest of the shell listens for (<c>toggle-keyboard-shortcuts</c>,
/// <c>dispatchTourLauncherOpen()</c> and <c>open-feedback-modal</c>), so the command palette and any other surface
/// keep working unchanged. There is no data fetch, so the surface has no loading / empty / error / stale / offline
/// chrome — the only state branch the source has is the compact <c>iconOnly</c> mode (icons + tooltips) versus the
/// expanded mode (icon + label, plus the <c>?</c> key-cap and "for shortcuts" hint on the shortcuts affordance).
/// This holder pins the diagnostics slug, the root + per-affordance automation ids (the web <c>data-tour</c> /
/// <c>data-tour-launcher-trigger</c> / <c>data-testid</c> hooks), the <c>?</c> key-cap glyph and the seven i18n
/// keys each with the verbatim English fallback the web source renders. UI-free so the metadata is asserted
/// headlessly.
/// </summary>
public static class HelpSegmentRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "HelpSegment";

    /// <summary>The root automation id Narrator and UI-automation resolve the surface by (web <c>data-tour="keyboard-hint"</c> host).</summary>
    public const string RootAutomationId = "help-segment";

    /// <summary>The tour-registry anchor id the surface carries — the web <c>data-tour="keyboard-hint"</c>.</summary>
    public const string TourAnchorId = "keyboard-hint";

    /// <summary>Automation id for the keyboard-shortcuts affordance (the web <c>?</c> cheat-sheet trigger).</summary>
    public const string ShortcutsAutomationId = "status-bar-shortcuts-trigger";

    /// <summary>Automation id for the tour-launcher affordance — the web <c>data-tour-launcher-trigger</c>.</summary>
    public const string TourAutomationId = "status-bar-tour-trigger";

    /// <summary>Automation id for the feedback affordance — the web <c>data-testid="status-bar-feedback-trigger"</c>.</summary>
    public const string FeedbackAutomationId = "status-bar-feedback-trigger";

    /// <summary>The key-cap shown on the shortcuts affordance in expanded mode — the web <c>&lt;kbd&gt;?&lt;/kbd&gt;</c>.</summary>
    public const string ShortcutKeyCap = "?";

    /// <summary>i18n key for the shortcuts tooltip (web <c>t('shortcuts.tooltip', 'Keyboard shortcuts')</c>).</summary>
    public const string ShortcutsTooltipKey = "translation.shortcuts.tooltip";

    /// <summary>English fallback for <see cref="ShortcutsTooltipKey"/> — the web default, verbatim.</summary>
    public const string ShortcutsTooltipFallback = "Keyboard shortcuts";

    /// <summary>i18n key for the shortcuts accessible name (web <c>t('shortcuts.openAria', 'Open keyboard shortcuts')</c>).</summary>
    public const string ShortcutsAriaKey = "translation.shortcuts.openAria";

    /// <summary>English fallback for <see cref="ShortcutsAriaKey"/> — the web default, verbatim.</summary>
    public const string ShortcutsAriaFallback = "Open keyboard shortcuts";

    /// <summary>i18n key for the shortcuts hint suffix (web <c>t('shortcuts.hintSuffix', 'for shortcuts')</c>).</summary>
    public const string ShortcutsHintSuffixKey = "translation.shortcuts.hintSuffix";

    /// <summary>English fallback for <see cref="ShortcutsHintSuffixKey"/> — the web default, verbatim.</summary>
    public const string ShortcutsHintSuffixFallback = "for shortcuts";

    /// <summary>i18n key for the tour label / tooltip (web <c>t('tour.launcher.openShort', 'Take a tour')</c>).</summary>
    public const string TourShortKey = "translation.tour.launcher.openShort";

    /// <summary>English fallback for <see cref="TourShortKey"/> — the web default, verbatim.</summary>
    public const string TourShortFallback = "Take a tour";

    /// <summary>i18n key for the tour accessible name (web <c>t('tour.launcher.openAria', 'Open tour launcher')</c>).</summary>
    public const string TourAriaKey = "translation.tour.launcher.openAria";

    /// <summary>English fallback for <see cref="TourAriaKey"/> — the web default, verbatim.</summary>
    public const string TourAriaFallback = "Open tour launcher";

    /// <summary>i18n key for the feedback label / tooltip (web <c>t('feedback.openShort', 'Report bug')</c>).</summary>
    public const string FeedbackShortKey = "translation.feedback.openShort";

    /// <summary>English fallback for <see cref="FeedbackShortKey"/> — the web default, verbatim.</summary>
    public const string FeedbackShortFallback = "Report bug";

    /// <summary>i18n key for the feedback accessible name (web <c>t('feedback.openAria', 'Open feedback / bug report form')</c>).</summary>
    public const string FeedbackAriaKey = "translation.feedback.openAria";

    /// <summary>English fallback for <see cref="FeedbackAriaKey"/> — the web default, verbatim.</summary>
    public const string FeedbackAriaFallback = "Open feedback / bug report form";

    /// <summary>
    /// Resolve every localized string the surface renders through the i18n facade — the native port of the seven
    /// <c>t()</c> call sites in HelpSegment.tsx. Each label flows through a single keyed call site so the resource
    /// keys are asserted in tests and resolved for real in the app.
    /// </summary>
    /// <param name="localizer">The i18n facade the labels resolve through (web <c>useTranslation</c>).</param>
    public static HelpSegmentLabels ResolveLabels(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return new HelpSegmentLabels(
            localizer.GetString(ShortcutsTooltipKey, ShortcutsTooltipFallback),
            localizer.GetString(ShortcutsAriaKey, ShortcutsAriaFallback),
            localizer.GetString(ShortcutsHintSuffixKey, ShortcutsHintSuffixFallback),
            localizer.GetString(TourShortKey, TourShortFallback),
            localizer.GetString(TourAriaKey, TourAriaFallback),
            localizer.GetString(FeedbackShortKey, FeedbackShortFallback),
            localizer.GetString(FeedbackAriaKey, FeedbackAriaFallback));
    }
}

/// <summary>
/// The localized strings the <c>HelpSegment</c> surface renders, resolved once from the i18n facade — the native
/// projection of the seven <c>t()</c> results in HelpSegment.tsx. <see cref="ShortcutsTooltip"/> / <see cref="TourShort"/>
/// / <see cref="FeedbackShort"/> are the hover tooltips (and, in expanded mode, the visible labels); the
/// <c>*Aria</c> values are the Narrator accessible names; <see cref="ShortcutsHintSuffix"/> is the "for shortcuts"
/// text shown after the <c>?</c> key-cap. Immutable and UI-free so the projection is asserted headlessly.
/// </summary>
/// <param name="ShortcutsTooltip">The shortcuts hover tooltip (web <c>shortcuts.tooltip</c>, "Keyboard shortcuts").</param>
/// <param name="ShortcutsAria">The shortcuts accessible name (web <c>shortcuts.openAria</c>, "Open keyboard shortcuts").</param>
/// <param name="ShortcutsHintSuffix">The text after the key-cap (web <c>shortcuts.hintSuffix</c>, "for shortcuts").</param>
/// <param name="TourShort">The tour tooltip + label (web <c>tour.launcher.openShort</c>, "Take a tour").</param>
/// <param name="TourAria">The tour accessible name (web <c>tour.launcher.openAria</c>, "Open tour launcher").</param>
/// <param name="FeedbackShort">The feedback tooltip + label (web <c>feedback.openShort</c>, "Report bug").</param>
/// <param name="FeedbackAria">The feedback accessible name (web <c>feedback.openAria</c>, "Open feedback / bug report form").</param>
public sealed record HelpSegmentLabels(
    string ShortcutsTooltip,
    string ShortcutsAria,
    string ShortcutsHintSuffix,
    string TourShort,
    string TourAria,
    string FeedbackShort,
    string FeedbackAria);

/// <summary>
/// The decoupled help-command seam the <c>HelpSegment</c> surface routes its three affordances through (P1/S8
/// state-holder layer) — the native analogue of the global signals the web component dispatches instead of calling
/// into the React tree (web/src/components/layout/status-bar/HelpSegment.tsx L39-L41): the keyboard cheat-sheet
/// (web <c>window.dispatchEvent(new CustomEvent('toggle-keyboard-shortcuts'))</c>), the guided tour (web
/// <c>dispatchTourLauncherOpen()</c>) and the in-app feedback form (web
/// <c>window.dispatchEvent(new CustomEvent('open-feedback-modal'))</c>). The view never opens anything itself: a
/// shell adapter (or a test fake) performs the command so the surface's wiring is asserted headlessly.
/// <see cref="NullHelpSegmentActions"/> stands in when no host is wired (design-time / tests);
/// <see cref="DelegateHelpSegmentActions"/> is the production binding.
/// </summary>
public interface IHelpSegmentActions
{
    /// <summary>Open the keyboard-shortcuts cheat sheet — web <c>window.dispatchEvent(new CustomEvent('toggle-keyboard-shortcuts'))</c>.</summary>
    void OpenKeyboardShortcuts();

    /// <summary>Open the guided-tour launcher — web <c>dispatchTourLauncherOpen()</c>.</summary>
    void OpenTour();

    /// <summary>Open the in-app feedback / bug-report form — web <c>window.dispatchEvent(new CustomEvent('open-feedback-modal'))</c>.</summary>
    void OpenFeedback();
}

/// <summary>
/// The inert help-command seam used when no host is wired — the safe design-time / unit-test default. Every command
/// is a no-op that never throws, mirroring the web events being dispatched into a shell with no listener attached.
/// </summary>
public sealed class NullHelpSegmentActions : IHelpSegmentActions
{
    /// <summary>The shared inert instance.</summary>
    public static NullHelpSegmentActions Instance { get; } = new();

    private NullHelpSegmentActions()
    {
    }

    /// <inheritdoc />
    public void OpenKeyboardShortcuts()
    {
        // No host listener wired — the command is intentionally inert.
    }

    /// <inheritdoc />
    public void OpenTour()
    {
        // No host listener wired — the command is intentionally inert.
    }

    /// <inheritdoc />
    public void OpenFeedback()
    {
        // No host listener wired — the command is intentionally inert.
    }
}

/// <summary>
/// An <see cref="IHelpSegmentActions"/> that forwards each affordance to a caller-supplied callback — the
/// production binding the composition root wires to the shell's help signals (the native counterparts of the web
/// <c>toggle-keyboard-shortcuts</c> / tour-launcher / <c>open-feedback-modal</c> dispatchers).
/// </summary>
public sealed class DelegateHelpSegmentActions : IHelpSegmentActions
{
    private readonly Action _openShortcuts;
    private readonly Action _openTour;
    private readonly Action _openFeedback;

    /// <summary>Creates the seam over the host's three help-command callbacks.</summary>
    /// <param name="openShortcuts">Invoked to open the keyboard cheat sheet.</param>
    /// <param name="openTour">Invoked to open the guided-tour launcher.</param>
    /// <param name="openFeedback">Invoked to open the feedback / bug-report form.</param>
    public DelegateHelpSegmentActions(Action openShortcuts, Action openTour, Action openFeedback)
    {
        ArgumentNullException.ThrowIfNull(openShortcuts);
        ArgumentNullException.ThrowIfNull(openTour);
        ArgumentNullException.ThrowIfNull(openFeedback);

        _openShortcuts = openShortcuts;
        _openTour = openTour;
        _openFeedback = openFeedback;
    }

    /// <inheritdoc />
    public void OpenKeyboardShortcuts() => _openShortcuts();

    /// <inheritdoc />
    public void OpenTour() => _openTour();

    /// <inheritdoc />
    public void OpenFeedback() => _openFeedback();
}

/// <summary>
/// PII-safe diagnostics for the <c>HelpSegment</c> surface (P1/S11 diagnostics contract). The segment carries no
/// user content — only static, localized help labels and three decoupled commands — so the collector records only
/// operational counters tagged with the surface slug: the <c>view.opened</c> event the prompt requires, plus one
/// counter per affordance invocation (shortcuts / tour / feedback). No label text is ever passed. Thread-safe;
/// mirrors the peer surfaces' diagnostics collectors.
/// </summary>
public sealed class HelpSegmentDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;
    private long _shortcutsOpened;
    private long _toursOpened;
    private long _feedbackOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the operational lines are written to, or null.</param>
    public HelpSegmentDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Number of times the keyboard-shortcuts affordance was invoked.</summary>
    public long ShortcutsOpened => Interlocked.Read(ref _shortcutsOpened);

    /// <summary>Number of times the tour-launcher affordance was invoked.</summary>
    public long ToursOpened => Interlocked.Read(ref _toursOpened);

    /// <summary>Number of times the feedback affordance was invoked.</summary>
    public long FeedbackOpened => Interlocked.Read(ref _feedbackOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=HelpSegment</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={HelpSegmentRegistration.Slug}");
    }

    /// <summary>Record a shortcuts-cheat-sheet open, emitting <c>help.shortcuts slug=HelpSegment</c>.</summary>
    public void RecordShortcutsOpened()
    {
        Interlocked.Increment(ref _shortcutsOpened);
        _sink?.Invoke($"help.shortcuts slug={HelpSegmentRegistration.Slug}");
    }

    /// <summary>Record a tour-launcher open, emitting <c>help.tour slug=HelpSegment</c>.</summary>
    public void RecordTourOpened()
    {
        Interlocked.Increment(ref _toursOpened);
        _sink?.Invoke($"help.tour slug={HelpSegmentRegistration.Slug}");
    }

    /// <summary>Record a feedback-form open, emitting <c>help.feedback slug=HelpSegment</c>.</summary>
    public void RecordFeedbackOpened()
    {
        Interlocked.Increment(ref _feedbackOpened);
        _sink?.Invoke($"help.feedback slug={HelpSegmentRegistration.Slug}");
    }
}
