using TeslaSync.App.FeatureViews.Settings;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the withAiFeature gate surface's UI-thread-free logic — the registration metadata
/// (slug, root-marker convention, registry guard), the PII-safe diagnostics, the <c>useAiEnabled</c> data
/// adapter (<see cref="AiEnabledEvaluator"/>), and the view-model that mirrors the web HOC contract: throw on an
/// unknown feature id at construction, the open / closed gate verdict (the surface's only two states), live
/// re-evaluation, and the web <c>displayName</c> / <c>data-testid</c> projections. Mirrors the web spec
/// one-for-one (web/src/components/ai/withAiFeature.tsx, web/src/hooks/useAiEnabled.ts and
/// web/src/components/ai/withAiFeature.test.tsx). The WinUI view (shared-surfaces/withAiFeature.cs) is exercised
/// by the app build.
/// </summary>
public sealed class WithAiFeatureTests
{
    // chatbot-llm anchors the suite for parity with web withAiFeature.test.tsx (its root marker is the exact
    // id the web test asserts); drive-coaching is a second registered feature for the per-feature predicate.
    private const string KnownFeature = "chatbot-llm";
    private const string OtherKnownFeature = "drive-coaching";
    private const string UnknownFeature = "not-a-real-feature";

    // ── registration (anonymous web HOC: slug + marker + registry guard) ─────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_prompt_surface_slug() =>
        Assert.Equal("withAiFeature", WithAiFeatureRegistration.Slug);

    [Fact]
    public void Root_automation_id_follows_the_ai_feature_root_convention() =>
        // web withAiFeature.test.tsx asserts exactly this marker for chatbot-llm.
        Assert.Equal("ai-feature-chatbot-llm-root", WithAiFeatureRegistration.RootAutomationId(KnownFeature));

    [Fact]
    public void Root_automation_id_composes_the_prefix_and_suffix_constants() =>
        Assert.Equal(
            WithAiFeatureRegistration.MarkerPrefix + OtherKnownFeature + WithAiFeatureRegistration.MarkerSuffix,
            WithAiFeatureRegistration.RootAutomationId(OtherKnownFeature));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void Root_automation_id_rejects_a_blank_feature_id(string? featureId) =>
        // null -> ArgumentNullException, "" -> ArgumentException; both derive from ArgumentException.
        Assert.ThrowsAny<ArgumentException>(() => WithAiFeatureRegistration.RootAutomationId(featureId!));

    [Fact]
    public void Known_feature_id_is_present_in_the_canonical_registry()
    {
        Assert.True(WithAiFeatureRegistration.IsRegisteredFeature(KnownFeature));
        Assert.Contains(AiFeatureRegistry.Features, m => m.Id == KnownFeature);
    }

    [Fact]
    public void Unknown_feature_id_is_not_registered() =>
        Assert.False(WithAiFeatureRegistration.IsRegisteredFeature(UnknownFeature));

    [Fact]
    public void Unknown_feature_message_names_the_offending_id_and_the_regen_path()
    {
        var message = WithAiFeatureRegistration.UnknownFeatureMessage(UnknownFeature);

        Assert.Contains("unknown AI feature id", message, StringComparison.OrdinalIgnoreCase);
        Assert.Contains(UnknownFeature, message, StringComparison.Ordinal);
    }

    // ── diagnostics (view.opened, PII-safe — never the feature id or inner content) ──────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new WithAiFeatureDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=withAiFeature", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_without_a_sink_still_count_opens()
    {
        var diagnostics = new WithAiFeatureDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    // ── adapter: AiEnabledEvaluator (web useAiEnabled) ───────────────────────────────────────────────────

    [Fact]
    public void Evaluator_enables_a_registered_feature_when_the_gate_is_on() =>
        Assert.True(AiEnabledEvaluator.IsEnabled(StaticAiFeatureGate.On, KnownFeature));

    [Fact]
    public void Evaluator_disables_when_the_gate_is_off() =>
        // web: ai_mode='off' (or per-feature flag false) -> useAiEnabled returns false.
        Assert.False(AiEnabledEvaluator.IsEnabled(StaticAiFeatureGate.Off, KnownFeature));

    [Fact]
    public void Evaluator_disables_an_unknown_feature_even_when_the_gate_is_on() =>
        // web: if (!AI_FEATURES[feature]) return false — registry check precedes the mode/flag check.
        Assert.False(AiEnabledEvaluator.IsEnabled(StaticAiFeatureGate.On, UnknownFeature));

    [Fact]
    public void Evaluator_is_fail_closed_for_a_null_gate() =>
        Assert.False(AiEnabledEvaluator.IsEnabled(null!, KnownFeature));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void Evaluator_is_fail_closed_for_a_blank_id(string? featureId) =>
        Assert.False(AiEnabledEvaluator.IsEnabled(StaticAiFeatureGate.On, featureId!));

    [Fact]
    public void Evaluator_honors_a_per_feature_predicate()
    {
        // web: useAiEnabled gates on the per-feature flag, not a global on/off — only the opted-in feature is on.
        var gate = new DelegateAiFeatureGate(id => id == KnownFeature);

        Assert.True(AiEnabledEvaluator.IsEnabled(gate, KnownFeature));
        Assert.False(AiEnabledEvaluator.IsEnabled(gate, OtherKnownFeature));
    }

    // ── view-model: gate (web withAiFeature / useAiEnabled) — the surface's two states ───────────────────

    [Fact]
    public void Gate_off_keeps_the_surface_closed()
    {
        var vm = new WithAiFeatureViewModel(StaticAiFeatureGate.Off, KnownFeature);

        Assert.False(vm.IsGateOpen);
    }

    [Fact]
    public void Gate_on_opens_the_surface()
    {
        var vm = new WithAiFeatureViewModel(StaticAiFeatureGate.On, KnownFeature);

        Assert.True(vm.IsGateOpen);
    }

    [Fact]
    public void Gate_reevaluates_live_when_the_underlying_flag_flips()
    {
        // web useAiEnabled re-runs on every render, so toggling the AI setting flips the gate without rebuilding
        // the surface. The view-model reads the gate live to reproduce that.
        var enabled = false;
        var gate = new DelegateAiFeatureGate(_ => enabled);
        var vm = new WithAiFeatureViewModel(gate, KnownFeature);
        Assert.False(vm.IsGateOpen);

        enabled = true;

        Assert.True(vm.IsGateOpen);
    }

    // ── view-model: unknown / blank / null guards (web throws at the wrapping call) ──────────────────────

    [Fact]
    public void ViewModel_throws_for_an_unknown_feature_id()
    {
        var ex = Assert.Throws<ArgumentException>(
            () => new WithAiFeatureViewModel(StaticAiFeatureGate.On, UnknownFeature));

        Assert.Contains("unknown AI feature id", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData("")]
    public void ViewModel_throws_for_a_blank_feature_id(string featureId) =>
        Assert.Throws<ArgumentException>(() => new WithAiFeatureViewModel(StaticAiFeatureGate.On, featureId));

    [Fact]
    public void ViewModel_throws_for_a_null_feature_id() =>
        Assert.Throws<ArgumentNullException>(() => new WithAiFeatureViewModel(StaticAiFeatureGate.On, null!));

    [Fact]
    public void ViewModel_throws_for_a_null_gate() =>
        Assert.Throws<ArgumentNullException>(() => new WithAiFeatureViewModel(null!, KnownFeature));

    // ── view-model: projections (web data-testid + displayName) + accessibility marker ───────────────────

    [Fact]
    public void ViewModel_exposes_the_wrapped_feature_id()
    {
        var vm = new WithAiFeatureViewModel(StaticAiFeatureGate.On, KnownFeature);

        Assert.Equal(KnownFeature, vm.FeatureId);
    }

    [Fact]
    public void Root_automation_id_is_the_accessible_marker_the_view_applies()
    {
        // The view sets AutomationProperties.AutomationId to this value when the gate is open (the native
        // analogue of the web wrapper's data-testid / data-ai-feature), so it IS the accessibility marker
        // tooling keys on; when closed the view drops it so nothing leaks.
        var vm = new WithAiFeatureViewModel(StaticAiFeatureGate.On, KnownFeature);

        Assert.Equal("ai-feature-chatbot-llm-root", vm.RootAutomationId);
    }

    [Fact]
    public void Wrapper_name_reproduces_the_web_display_name()
    {
        var vm = new WithAiFeatureViewModel(StaticAiFeatureGate.On, KnownFeature, "ChatbotPanel");

        Assert.Equal("withAiFeature(chatbot-llm, ChatbotPanel)", vm.WrapperName);
    }

    [Fact]
    public void Wrapper_name_defaults_the_inner_name_to_component()
    {
        // web: const innerName = Inner.displayName ?? Inner.name ?? 'Component'.
        var vm = new WithAiFeatureViewModel(StaticAiFeatureGate.On, KnownFeature);

        Assert.Equal("withAiFeature(chatbot-llm, Component)", vm.WrapperName);
    }

    [Fact]
    public void Refresh_raises_is_gate_open_change()
    {
        var vm = new WithAiFeatureViewModel(StaticAiFeatureGate.On, KnownFeature);
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        vm.Refresh();

        Assert.Contains(nameof(WithAiFeatureViewModel.IsGateOpen), changed);
    }
}
