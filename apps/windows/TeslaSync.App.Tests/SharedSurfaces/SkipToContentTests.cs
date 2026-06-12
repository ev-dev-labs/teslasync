using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the <c>SkipToContent</c> shared surface's UI-thread-free logic — the registration
/// metadata + label resolver, the pure activation guard (<see cref="SkipActivation"/>), the inert landmark seam
/// (<see cref="NullSkipTarget"/>), the state holder that resolves the label and routes activation by landmark
/// presence (<see cref="SkipToContentViewModel"/>), the PII-safe diagnostics and the argument validation.
/// Mirrors the web spec one-for-one (web/src/components/feedback/SkipToContent.tsx +
/// web/src/components/feedback/__tests__/SkipToContent.test.tsx): the localized "Skip to main content" label, the
/// <c>#main-content</c> landmark target, the <c>if (main)</c> focus/scroll guard and its no-throw fall-through.
/// The WinUI view itself (SkipToContent.cs, which composes the atomic TsButton and the ControlSkipTarget focus
/// adapter) is exercised by the app build.
/// </summary>
public sealed class SkipToContentTests
{
    private const string LabelKey = "translation.a11y.skipToContent";
    private const string LabelFallback = "Skip to main content";

    // ── registration (slug, i18n key + fallback, automation id, landmark target) ─────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface()
    {
        Assert.Equal("SkipToContent", SkipToContentRegistration.Slug);
        Assert.Equal("SkipToContent", SkipToContentViewModel.Slug);
    }

    [Fact]
    public void Registration_pins_the_web_i18n_key_and_verbatim_english_fallback()
    {
        Assert.Equal(LabelKey, SkipToContentRegistration.LabelKey);
        Assert.Equal(LabelFallback, SkipToContentRegistration.LabelFallback);
    }

    [Fact]
    public void Registration_pins_the_link_automation_id_and_landmark_target()
    {
        // web data-testid="skip-to-content" and href="#main-content" / id="main-content".
        Assert.Equal("skip-to-content", SkipToContentRegistration.LinkAutomationId);
        Assert.Equal("main-content", SkipToContentRegistration.TargetLandmarkId);
    }

    [Fact]
    public void ResolveLabel_reads_the_a11y_skip_to_content_key_with_the_english_fallback()
    {
        var localizer = new RecordingLocalizer();

        string label = SkipToContentRegistration.ResolveLabel(localizer);

        // The single keyed call site the web t('a11y.skipToContent', 'Skip to main content') maps to.
        (string Key, string Fallback) call = Assert.Single(localizer.Calls);
        Assert.Equal(LabelKey, call.Key);
        Assert.Equal(LabelFallback, call.Fallback);
        Assert.Equal(LabelFallback, label);
    }

    [Fact]
    public void ResolveLabel_returns_the_localized_value_when_the_catalogue_has_one()
    {
        var localizer = new RecordingLocalizer { Translation = "Zum Hauptinhalt springen" };

        string label = SkipToContentRegistration.ResolveLabel(localizer);

        Assert.Equal("Zum Hauptinhalt springen", label);
    }

    [Fact]
    public void ResolveLabel_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() => SkipToContentRegistration.ResolveLabel(null!));

    // ── adapter: SkipActivation (the web `if (main)` guard) ──────────────────────────────────────────────

    [Fact]
    public void Decide_returns_activated_when_the_landmark_is_present() =>
        Assert.Equal(SkipActivationResult.Activated, SkipActivation.Decide(targetAvailable: true));

    [Fact]
    public void Decide_returns_no_target_when_the_landmark_is_absent() =>
        Assert.Equal(SkipActivationResult.NoTarget, SkipActivation.Decide(targetAvailable: false));

    // ── NullSkipTarget: inert fallback (web missing-landmark branch) ─────────────────────────────────────

    [Fact]
    public void NullSkipTarget_is_unavailable_and_its_focus_is_a_safe_no_op()
    {
        ISkipTarget target = NullSkipTarget.Instance;

        Assert.False(target.IsAvailable);
        Exception? error = Record.Exception(target.Focus);
        Assert.Null(error);
    }

    [Fact]
    public void NullSkipTarget_is_a_shared_singleton() =>
        Assert.Same(NullSkipTarget.Instance, NullSkipTarget.Instance);

    // ── ViewModel: label resolution (web useTranslation) ─────────────────────────────────────────────────

    [Fact]
    public void ViewModel_exposes_the_localized_label()
    {
        var vm = new SkipToContentViewModel(PassthroughLocalizer.Instance, new FakeSkipTarget());

        Assert.Equal(LabelFallback, vm.Label);
    }

    [Fact]
    public void ViewModel_resolves_the_label_through_the_a11y_skip_to_content_key()
    {
        var localizer = new RecordingLocalizer { Translation = "Saltar al contenido principal" };

        var vm = new SkipToContentViewModel(localizer, new FakeSkipTarget());

        Assert.Equal("Saltar al contenido principal", vm.Label);
        Assert.Equal(LabelKey, Assert.Single(localizer.Calls).Key);
    }

    // ── ViewModel: HasTarget reflects the landmark seam (web `if (main)`) ────────────────────────────────

    [Fact]
    public void ViewModel_has_target_reflects_the_seam_presence()
    {
        var present = new SkipToContentViewModel(PassthroughLocalizer.Instance, new FakeSkipTarget { IsAvailable = true });
        var absent = new SkipToContentViewModel(PassthroughLocalizer.Instance, new FakeSkipTarget { IsAvailable = false });

        Assert.True(present.HasTarget);
        Assert.False(absent.HasTarget);
    }

    // ── ViewModel: Activate with a landmark present (web focus + scrollIntoView) ─────────────────────────

    [Fact]
    public void Activate_focuses_the_landmark_when_present_and_records_the_activation()
    {
        var captured = new List<string>();
        var target = new FakeSkipTarget { IsAvailable = true };
        var vm = NewViewModel(target, captured);

        SkipActivationResult result = vm.Activate();

        Assert.Equal(SkipActivationResult.Activated, result);
        Assert.Equal(1, target.FocusCount);
        Assert.Equal("skip.activated slug=SkipToContent", Assert.Single(captured));
    }

    // ── ViewModel: Activate with no landmark (web `if (main)` falls through; never throws) ───────────────

    [Fact]
    public void Activate_is_a_safe_no_op_when_no_landmark_is_present()
    {
        var captured = new List<string>();
        var target = new FakeSkipTarget { IsAvailable = false };
        var vm = NewViewModel(target, captured);

        SkipActivationResult result = vm.Activate();

        Assert.Equal(SkipActivationResult.NoTarget, result);
        Assert.Equal(0, target.FocusCount);
        Assert.Equal("skip.targetMissing slug=SkipToContent", Assert.Single(captured));
    }

    [Fact]
    public void Activate_against_the_null_target_does_not_throw()
    {
        var vm = new SkipToContentViewModel(PassthroughLocalizer.Instance, NullSkipTarget.Instance);

        Exception? error = Record.Exception(() => vm.Activate());

        Assert.Null(error);
    }

    [Fact]
    public void Activate_can_be_invoked_repeatedly()
    {
        var target = new FakeSkipTarget { IsAvailable = true };
        var vm = new SkipToContentViewModel(PassthroughLocalizer.Instance, target);

        vm.Activate();
        vm.Activate();
        vm.Activate();

        Assert.Equal(3, target.FocusCount);
    }

    // ── ViewModel: view.opened is emitted once on open (web component mount) ─────────────────────────────

    [Fact]
    public void MarkOpened_records_the_view_opened_event_once()
    {
        var captured = new List<string>();
        var vm = NewViewModel(new FakeSkipTarget(), captured);

        vm.MarkOpened();
        vm.MarkOpened();

        Assert.Equal("view.opened slug=SkipToContent", Assert.Single(captured));
    }

    // ── ViewModel: argument validation ───────────────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_rejects_null_dependencies()
    {
        Assert.Throws<ArgumentNullException>(() => new SkipToContentViewModel(null!, new FakeSkipTarget()));
        Assert.Throws<ArgumentNullException>(() => new SkipToContentViewModel(PassthroughLocalizer.Instance, null!));
    }

    // ── Diagnostics (P1/S11): slug-only operational counters, never the label or landmark ────────────────

    [Fact]
    public void Diagnostics_count_and_emit_each_operational_event()
    {
        var captured = new List<string>();
        var diagnostics = new SkipToContentDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();
        diagnostics.RecordActivated();
        diagnostics.RecordTargetMissing();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal(1, diagnostics.Activations);
        Assert.Equal(1, diagnostics.TargetMisses);
        string[] expected =
        [
            "view.opened slug=SkipToContent",
            "skip.activated slug=SkipToContent",
            "skip.targetMissing slug=SkipToContent",
        ];
        Assert.Equal(expected, captured);
    }

    [Fact]
    public void Diagnostics_never_leak_the_label_text()
    {
        var captured = new List<string>();
        var target = new FakeSkipTarget { IsAvailable = true };
        var vm = NewViewModel(target, captured);

        vm.MarkOpened();
        vm.Activate();

        Assert.All(captured, line => Assert.DoesNotContain(LabelFallback, line, StringComparison.Ordinal));
    }

    [Fact]
    public void Diagnostics_without_a_sink_still_count()
    {
        var diagnostics = new SkipToContentDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    // ── Helpers / test doubles ───────────────────────────────────────────────────────────────────────────

    private static SkipToContentViewModel NewViewModel(FakeSkipTarget target, List<string> sink) =>
        new(PassthroughLocalizer.Instance, target, new SkipToContentDiagnostics(sink.Add));

    private sealed class FakeSkipTarget : ISkipTarget
    {
        public bool IsAvailable { get; init; }

        public int FocusCount { get; private set; }

        public void Focus() => FocusCount++;
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        private readonly List<(string Key, string Fallback)> _calls = [];

        public IReadOnlyList<(string Key, string Fallback)> Calls => _calls;

        public string? Translation { get; init; }

        public string GetString(string key, string fallback)
        {
            _calls.Add((key, fallback));
            return Translation ?? fallback;
        }
    }
}
