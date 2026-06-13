using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the <c>HelpSegment</c> shared surface's UI-thread-free logic — the registration
/// metadata (slug, root + per-affordance automation ids, the <c>?</c> key-cap, the seven i18n keys the source
/// references with their verbatim English fallbacks), the <see cref="HelpSegmentRegistration.ResolveLabels"/>
/// projection, the inert + delegate command seams (<see cref="NullHelpSegmentActions"/> /
/// <see cref="DelegateHelpSegmentActions"/>), the state holder that resolves the labels and routes the three
/// affordances through the seam (<see cref="HelpSegmentViewModel"/>), the PII-safe diagnostics and the argument
/// validation. Mirrors the web spec one-for-one (web/src/components/layout/status-bar/HelpSegment.tsx): the seven
/// localized strings, the compact <c>iconOnly</c> mode, and the three decoupled help commands
/// (<c>toggle-keyboard-shortcuts</c>, <c>dispatchTourLauncherOpen()</c>, <c>open-feedback-modal</c>). The WinUI view
/// itself (shared-surfaces/HelpSegment.cs, which composes the borderless Fluent buttons + TsTooltip and sets the
/// Narrator names / automation ids) is exercised by the app build.
/// </summary>
public sealed class HelpSegmentTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // ── registration (slug, automation ids, key-cap) ─────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface()
    {
        Assert.Equal("HelpSegment", HelpSegmentRegistration.Slug);
        Assert.Equal("HelpSegment", HelpSegmentViewModel.Slug);
    }

    [Fact]
    public void Registration_pins_the_root_and_per_affordance_automation_ids()
    {
        // web data-tour="keyboard-hint", data-tour-launcher-trigger, data-testid="status-bar-feedback-trigger".
        Assert.Equal("help-segment", HelpSegmentRegistration.RootAutomationId);
        Assert.Equal("keyboard-hint", HelpSegmentRegistration.TourAnchorId);
        Assert.Equal("status-bar-shortcuts-trigger", HelpSegmentRegistration.ShortcutsAutomationId);
        Assert.Equal("status-bar-tour-trigger", HelpSegmentRegistration.TourAutomationId);
        Assert.Equal("status-bar-feedback-trigger", HelpSegmentRegistration.FeedbackAutomationId);
    }

    [Fact]
    public void Registration_pins_the_question_mark_key_cap()
    {
        // web <kbd>?</kbd>.
        Assert.Equal("?", HelpSegmentRegistration.ShortcutKeyCap);
        Assert.Equal("?", HelpSegmentViewModel.ShortcutKeyCap);
    }

    [Fact]
    public void Registration_pins_the_seven_web_i18n_keys_and_verbatim_english_fallbacks()
    {
        Assert.Equal("translation.shortcuts.tooltip", HelpSegmentRegistration.ShortcutsTooltipKey);
        Assert.Equal("Keyboard shortcuts", HelpSegmentRegistration.ShortcutsTooltipFallback);
        Assert.Equal("translation.shortcuts.openAria", HelpSegmentRegistration.ShortcutsAriaKey);
        Assert.Equal("Open keyboard shortcuts", HelpSegmentRegistration.ShortcutsAriaFallback);
        Assert.Equal("translation.shortcuts.hintSuffix", HelpSegmentRegistration.ShortcutsHintSuffixKey);
        Assert.Equal("for shortcuts", HelpSegmentRegistration.ShortcutsHintSuffixFallback);
        Assert.Equal("translation.tour.launcher.openShort", HelpSegmentRegistration.TourShortKey);
        Assert.Equal("Take a tour", HelpSegmentRegistration.TourShortFallback);
        Assert.Equal("translation.tour.launcher.openAria", HelpSegmentRegistration.TourAriaKey);
        Assert.Equal("Open tour launcher", HelpSegmentRegistration.TourAriaFallback);
        Assert.Equal("translation.feedback.openShort", HelpSegmentRegistration.FeedbackShortKey);
        Assert.Equal("Report bug", HelpSegmentRegistration.FeedbackShortFallback);
        Assert.Equal("translation.feedback.openAria", HelpSegmentRegistration.FeedbackAriaKey);
        Assert.Equal("Open feedback / bug report form", HelpSegmentRegistration.FeedbackAriaFallback);
    }

    // ── ResolveLabels: the seven web t() call sites ──────────────────────────────────────────────────────

    [Fact]
    public void ResolveLabels_reads_the_seven_keys_with_the_english_fallbacks()
    {
        var localizer = new RecordingLocalizer();

        HelpSegmentLabels labels = HelpSegmentRegistration.ResolveLabels(localizer);

        Assert.Equal("Keyboard shortcuts", labels.ShortcutsTooltip);
        Assert.Equal("Open keyboard shortcuts", labels.ShortcutsAria);
        Assert.Equal("for shortcuts", labels.ShortcutsHintSuffix);
        Assert.Equal("Take a tour", labels.TourShort);
        Assert.Equal("Open tour launcher", labels.TourAria);
        Assert.Equal("Report bug", labels.FeedbackShort);
        Assert.Equal("Open feedback / bug report form", labels.FeedbackAria);

        string[] expectedKeys =
        [
            "translation.shortcuts.tooltip",
            "translation.shortcuts.openAria",
            "translation.shortcuts.hintSuffix",
            "translation.tour.launcher.openShort",
            "translation.tour.launcher.openAria",
            "translation.feedback.openShort",
            "translation.feedback.openAria",
        ];
        Assert.Equal(expectedKeys, localizer.Keys);
    }

    [Fact]
    public void ResolveLabels_returns_the_localized_values_when_the_catalogue_has_them()
    {
        var localizer = new RecordingLocalizer { Translation = "Atajos de teclado" };

        HelpSegmentLabels labels = HelpSegmentRegistration.ResolveLabels(localizer);

        Assert.Equal("Atajos de teclado", labels.ShortcutsTooltip);
        Assert.Equal("Atajos de teclado", labels.FeedbackAria);
    }

    [Fact]
    public void ResolveLabels_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() => HelpSegmentRegistration.ResolveLabels(null!));

    // ── NullHelpSegmentActions: inert default (web events with no listener) ───────────────────────────────

    [Fact]
    public void NullHelpSegmentActions_commands_are_safe_no_ops()
    {
        IHelpSegmentActions actions = NullHelpSegmentActions.Instance;

        Assert.Null(Record.Exception(actions.OpenKeyboardShortcuts));
        Assert.Null(Record.Exception(actions.OpenTour));
        Assert.Null(Record.Exception(actions.OpenFeedback));
    }

    [Fact]
    public void NullHelpSegmentActions_is_a_shared_singleton() =>
        Assert.Same(NullHelpSegmentActions.Instance, NullHelpSegmentActions.Instance);

    // ── DelegateHelpSegmentActions: routes each affordance to its callback ────────────────────────────────

    [Fact]
    public void DelegateHelpSegmentActions_forwards_each_command_to_its_callback()
    {
        var calls = new List<string>();
        var actions = new DelegateHelpSegmentActions(
            () => calls.Add("shortcuts"),
            () => calls.Add("tour"),
            () => calls.Add("feedback"));

        actions.OpenKeyboardShortcuts();
        actions.OpenTour();
        actions.OpenFeedback();

        Assert.Equal(["shortcuts", "tour", "feedback"], calls);
    }

    [Fact]
    public void DelegateHelpSegmentActions_rejects_null_callbacks()
    {
        static void NoOp()
        {
        }

        Assert.Throws<ArgumentNullException>(() => new DelegateHelpSegmentActions(null!, NoOp, NoOp));
        Assert.Throws<ArgumentNullException>(() => new DelegateHelpSegmentActions(NoOp, null!, NoOp));
        Assert.Throws<ArgumentNullException>(() => new DelegateHelpSegmentActions(NoOp, NoOp, null!));
    }

    // ── ViewModel: label resolution + icon-only mode (web useTranslation + iconOnly prop) ─────────────────

    [Fact]
    public void ViewModel_exposes_the_localized_labels()
    {
        var vm = new HelpSegmentViewModel(Localizer, NullHelpSegmentActions.Instance);

        Assert.Equal("Keyboard shortcuts", vm.ShortcutsTooltip);
        Assert.Equal("Open keyboard shortcuts", vm.ShortcutsAria);
        Assert.Equal("for shortcuts", vm.ShortcutsHintSuffix);
        Assert.Equal("Take a tour", vm.TourShort);
        Assert.Equal("Open tour launcher", vm.TourAria);
        Assert.Equal("Report bug", vm.FeedbackShort);
        Assert.Equal("Open feedback / bug report form", vm.FeedbackAria);
        Assert.Equal("?", HelpSegmentViewModel.ShortcutKeyCap);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void ViewModel_icon_only_reflects_the_constructor_mode(bool iconOnly)
    {
        var vm = new HelpSegmentViewModel(Localizer, NullHelpSegmentActions.Instance, iconOnly);

        Assert.Equal(iconOnly, vm.IconOnly);

        // Labels resolve regardless of layout mode; the view drops them in compact mode but keeps the aria names.
        Assert.Equal("Take a tour", vm.TourShort);
        Assert.Equal("Open tour launcher", vm.TourAria);
    }

    // ── ViewModel: the three affordances route through the seam + record diagnostics ──────────────────────

    [Fact]
    public void Affordances_route_through_the_seam_and_record_each_invocation()
    {
        var captured = new List<string>();
        var actions = new RecordingActions();
        var vm = new HelpSegmentViewModel(
            Localizer,
            actions,
            iconOnly: false,
            new HelpSegmentDiagnostics(captured.Add));

        vm.OpenKeyboardShortcuts();
        vm.OpenTour();
        vm.OpenFeedback();

        Assert.Equal(["shortcuts", "tour", "feedback"], actions.Calls);
        string[] expected =
        [
            "help.shortcuts slug=HelpSegment",
            "help.tour slug=HelpSegment",
            "help.feedback slug=HelpSegment",
        ];
        Assert.Equal(expected, captured);
    }

    [Fact]
    public void Affordances_can_be_invoked_repeatedly()
    {
        var actions = new RecordingActions();
        var vm = new HelpSegmentViewModel(Localizer, actions);

        vm.OpenKeyboardShortcuts();
        vm.OpenKeyboardShortcuts();
        vm.OpenFeedback();

        Assert.Equal(["shortcuts", "shortcuts", "feedback"], actions.Calls);
    }

    // ── ViewModel: view.opened is emitted once on open (web component mount) ──────────────────────────────

    [Fact]
    public void MarkOpened_records_the_view_opened_event_once()
    {
        var captured = new List<string>();
        var vm = new HelpSegmentViewModel(
            Localizer,
            NullHelpSegmentActions.Instance,
            iconOnly: false,
            new HelpSegmentDiagnostics(captured.Add));

        vm.MarkOpened();
        vm.MarkOpened();

        Assert.Equal("view.opened slug=HelpSegment", Assert.Single(captured));
    }

    // ── ViewModel: argument validation ───────────────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_rejects_null_dependencies()
    {
        Assert.Throws<ArgumentNullException>(() => new HelpSegmentViewModel(null!, NullHelpSegmentActions.Instance));
        Assert.Throws<ArgumentNullException>(() => new HelpSegmentViewModel(Localizer, null!));
    }

    // ── Diagnostics (P1/S11): slug-only operational counters, never the label text ────────────────────────

    [Fact]
    public void Diagnostics_count_and_emit_each_operational_event()
    {
        var captured = new List<string>();
        var diagnostics = new HelpSegmentDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();
        diagnostics.RecordShortcutsOpened();
        diagnostics.RecordTourOpened();
        diagnostics.RecordFeedbackOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal(1, diagnostics.ShortcutsOpened);
        Assert.Equal(1, diagnostics.ToursOpened);
        Assert.Equal(1, diagnostics.FeedbackOpened);
        string[] expected =
        [
            "view.opened slug=HelpSegment",
            "help.shortcuts slug=HelpSegment",
            "help.tour slug=HelpSegment",
            "help.feedback slug=HelpSegment",
        ];
        Assert.Equal(expected, captured);
    }

    [Fact]
    public void Diagnostics_never_leak_the_label_text()
    {
        var captured = new List<string>();
        var vm = new HelpSegmentViewModel(
            Localizer,
            new RecordingActions(),
            iconOnly: false,
            new HelpSegmentDiagnostics(captured.Add));

        vm.MarkOpened();
        vm.OpenKeyboardShortcuts();
        vm.OpenTour();
        vm.OpenFeedback();

        string[] secrets =
        [
            "Keyboard shortcuts",
            "Open keyboard shortcuts",
            "Take a tour",
            "Report bug",
            "Open feedback / bug report form",
        ];
        Assert.All(captured, line =>
            Assert.All(secrets, secret => Assert.DoesNotContain(secret, line, StringComparison.Ordinal)));
    }

    [Fact]
    public void Diagnostics_without_a_sink_still_count()
    {
        var diagnostics = new HelpSegmentDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordShortcutsOpened();
        diagnostics.RecordShortcutsOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal(2, diagnostics.ShortcutsOpened);
    }

    // ── Helpers / test doubles ───────────────────────────────────────────────────────────────────────────

    private sealed class RecordingActions : IHelpSegmentActions
    {
        private readonly List<string> _calls = [];

        public IReadOnlyList<string> Calls => _calls;

        public void OpenKeyboardShortcuts() => _calls.Add("shortcuts");

        public void OpenTour() => _calls.Add("tour");

        public void OpenFeedback() => _calls.Add("feedback");
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        private readonly List<string> _keys = [];

        public IReadOnlyList<string> Keys => _keys;

        public string? Translation { get; init; }

        public string GetString(string key, string fallback)
        {
            _keys.Add(key);
            return Translation ?? fallback;
        }
    }
}
