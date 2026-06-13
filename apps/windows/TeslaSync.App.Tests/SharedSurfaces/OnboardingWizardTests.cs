using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the OnboardingWizard shared surface's UI-thread-free logic — the registration metadata
/// (slug, the surface / control automation ids, the close / next glyphs, the onboarded storage key + value, the
/// broadcast message type, the 1500&#160;ms reveal delay, the cyan step-indicator token, and the i18n keys with
/// their verbatim web fallbacks), the four-step catalogue (titles / descriptions / glyphs / accent ramp), the pure
/// onboarded-flag helper, the pure <see cref="OnboardingWizardProjection"/> (per-step content, the "Next" /
/// "Get Started" switch, the dot map, the step-progress label, clamping, and the accessible name / description
/// contract), the onboarded stores
/// (<see cref="InMemoryOnboardingStore"/> / <see cref="DelegatedOnboardingStore"/> across the not-onboarded /
/// completed / external-completion states), the <see cref="OnboardingWizardViewModel"/> state holder (initial
/// hidden projection, reveal, step advance, finish, skip / dismiss completion, external collapse, and subscription
/// cleanup), and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/components/feedback/OnboardingWizard.tsx). The WinUI view itself
/// (shared-surfaces/OnboardingWizard.cs) and its ApplicationData-backed store are exercised by the app build.
/// </summary>
public sealed class OnboardingWizardTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static OnboardingWizardProjection Project(bool isPresenting, int currentStep, ILocalizer? localizer = null) =>
        OnboardingWizardProjection.Project(isPresenting, currentStep, localizer ?? Localizer);

    // ── registration ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("OnboardingWizard", OnboardingWizardRegistration.Slug);

    [Fact]
    public void Automation_ids_are_stable()
    {
        Assert.Equal("onboarding-wizard", OnboardingWizardRegistration.SurfaceAutomationId);
        Assert.Equal("onboarding-wizard-steps", OnboardingWizardRegistration.StepIndicatorAutomationId);
        Assert.Equal("onboarding-wizard-skip", OnboardingWizardRegistration.SkipAutomationId);
        Assert.Equal("onboarding-wizard-primary", OnboardingWizardRegistration.PrimaryAutomationId);
        Assert.Equal("onboarding-wizard-close", OnboardingWizardRegistration.CloseAutomationId);
    }

    [Fact]
    public void Glyphs_match_the_shared_fluent_stand_ins()
    {
        Assert.Equal("\uE711", OnboardingWizardRegistration.CloseGlyph);    // ChromeClose (web X)
        Assert.Equal("\uE76C", OnboardingWizardRegistration.NextGlyph);     // ChevronRight (web ChevronRight)
    }

    [Fact]
    public void Onboarded_flag_contract_matches_the_web_localstorage_flag()
    {
        Assert.Equal("teslasync-onboarded", OnboardingWizardRegistration.OnboardedStorageKey);
        Assert.Equal("true", OnboardingWizardRegistration.OnboardedStorageValue);
        Assert.Equal("onboarded", OnboardingWizardRegistration.BroadcastMessageType);
    }

    [Fact]
    public void Reveal_delay_matches_the_web_timeout()
    {
        Assert.Equal(1500, OnboardingWizardRegistration.RevealDelayMs);
        Assert.Equal(TimeSpan.FromMilliseconds(1500), OnboardingWizardRegistration.RevealDelay);
    }

    [Fact]
    public void Step_indicator_token_matches_the_web_cyan()
    {
        // web COLOR.CYAN = #00f0ff.
        Assert.Equal("TsColorAccentColor", OnboardingWizardRegistration.StepIndicatorColorKey);
        Assert.Equal("#00F0FF", OnboardingWizardRegistration.StepIndicatorColorFallback);
    }

    [Fact]
    public void Step_count_matches_the_web_steps_array()
    {
        Assert.Equal(4, OnboardingWizardRegistration.StepCount);
        Assert.Equal(4, OnboardingWizardRegistration.Steps.Count);
    }

    [Fact]
    public void I18n_keys_resolve_under_the_onboarding_wizard_namespace()
    {
        string[] keys =
        {
            OnboardingWizardRegistration.SkipKey,
            OnboardingWizardRegistration.NextKey,
            OnboardingWizardRegistration.GetStartedKey,
            OnboardingWizardRegistration.CloseKey,
            OnboardingWizardRegistration.StepProgressKey,
            OnboardingWizardRegistration.Steps[0].TitleKey,
            OnboardingWizardRegistration.Steps[0].DescriptionKey,
            OnboardingWizardRegistration.Steps[3].TitleKey,
            OnboardingWizardRegistration.Steps[3].DescriptionKey,
        };

        Assert.All(keys, key => Assert.StartsWith("translation.onboardingWizard.", key, StringComparison.Ordinal));
    }

    [Fact]
    public void I18n_action_fallbacks_match_the_web_literals_verbatim()
    {
        Assert.Equal("Skip", OnboardingWizardRegistration.SkipFallback);
        Assert.Equal("Next", OnboardingWizardRegistration.NextFallback);
        Assert.Equal("Get Started", OnboardingWizardRegistration.GetStartedFallback);
        Assert.Equal("Close", OnboardingWizardRegistration.CloseFallback);
        Assert.Equal("Step {0} of {1}", OnboardingWizardRegistration.StepProgressFallback);
    }

    [Fact]
    public void Steps_match_the_web_titles_descriptions_glyphs_and_accents()
    {
        var steps = OnboardingWizardRegistration.Steps;

        Assert.Equal("Welcome to TeslaSync", steps[0].TitleFallback);
        Assert.Equal(
            "Your all-in-one Tesla fleet management dashboard. Track drives, monitor battery health, analyze energy usage, and control your vehicles — all in one place.",
            steps[0].DescriptionFallback);
        Assert.Equal("\uE945", steps[0].Glyph); // LightningBolt (web Zap)
        Assert.Equal("#00F0FF", steps[0].AccentHex);

        Assert.Equal("Connect Your Tesla", steps[1].TitleFallback);
        Assert.Equal(
            "Head to Settings and link your Tesla account via OAuth. TeslaSync will securely poll your vehicle data and keep everything in sync automatically.",
            steps[1].DescriptionFallback);
        Assert.Equal("\uE804", steps[1].Glyph); // Car (web Car)
        Assert.Equal("#10B981", steps[1].AccentHex);

        Assert.Equal("Configure Settings", steps[2].TitleFallback);
        Assert.Equal(
            "Customize your polling interval, distance units, energy cost per kWh, notification preferences, and MQTT integration to match your setup.",
            steps[2].DescriptionFallback);
        Assert.Equal("\uE713", steps[2].Glyph); // Setting (web Settings)
        Assert.Equal("#F59E0B", steps[2].AccentHex);

        Assert.Equal("You're All Set!", steps[3].TitleFallback);
        Assert.Equal(
            "Your dashboard is ready. Explore drives, charging sessions, efficiency analytics, and more. You can always revisit settings to fine-tune your experience.",
            steps[3].DescriptionFallback);
        Assert.Equal("\uE930", steps[3].Glyph); // CheckCircle (web CheckCircle)
        Assert.Equal("#8B5CF6", steps[3].AccentHex);
    }

    [Theory]
    [InlineData(null, false)]
    [InlineData("", false)]
    [InlineData("true", true)]
    [InlineData("1", true)]
    public void IsOnboarded_treats_any_non_empty_token_as_onboarded(string? raw, bool expected) =>
        Assert.Equal(expected, OnboardingWizardRegistration.IsOnboarded(raw));

    [Fact]
    public void Step_resolves_its_title_and_description_through_the_localizer()
    {
        var step = OnboardingWizardRegistration.Steps[1];
        Assert.Equal("Connect Your Tesla", step.Title(Localizer));
        Assert.Equal(step.DescriptionFallback, step.Description(Localizer));
    }

    // ── projection ────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Projection_renders_each_step_content()
    {
        var first = Project(isPresenting: true, currentStep: 0);
        Assert.True(first.IsPresenting);
        Assert.Equal(0, first.CurrentStepIndex);
        Assert.Equal(1, first.StepNumber);
        Assert.Equal("Welcome to TeslaSync", first.Title);
        Assert.Equal("\uE945", first.Glyph);
        Assert.Equal("#00F0FF", first.AccentHex);
        Assert.False(first.IsLastStep);

        var last = Project(isPresenting: true, currentStep: 3);
        Assert.Equal(3, last.CurrentStepIndex);
        Assert.Equal("You're All Set!", last.Title);
        Assert.Equal("#8B5CF6", last.AccentHex);
        Assert.True(last.IsLastStep);
    }

    [Fact]
    public void Projection_primary_label_switches_to_get_started_on_the_final_step()
    {
        Assert.Equal("Next", Project(true, 0).PrimaryActionLabel);
        Assert.Equal("Next", Project(true, 1).PrimaryActionLabel);
        Assert.Equal("Next", Project(true, 2).PrimaryActionLabel);
        Assert.Equal("Get Started", Project(true, 3).PrimaryActionLabel);
    }

    [Fact]
    public void Projection_resolves_the_skip_and_close_labels()
    {
        var p = Project(true, 0);
        Assert.Equal("Skip", p.SkipLabel);
        Assert.Equal("Close", p.CloseLabel);
    }

    [Fact]
    public void Projection_step_progress_label_is_one_based()
    {
        Assert.Equal("Step 1 of 4", Project(true, 0).StepProgressLabel);
        Assert.Equal("Step 3 of 4", Project(true, 2).StepProgressLabel);
        Assert.Equal("Step 4 of 4", Project(true, 3).StepProgressLabel);
    }

    [Fact]
    public void Projection_dots_fill_up_to_and_mark_the_active_step()
    {
        var dots = Project(true, 1).Dots;
        Assert.Equal(4, dots.Count);

        Assert.True(dots[0].IsFilled);
        Assert.False(dots[0].IsActive);

        Assert.True(dots[1].IsFilled);
        Assert.True(dots[1].IsActive);

        Assert.False(dots[2].IsFilled);
        Assert.False(dots[2].IsActive);

        Assert.False(dots[3].IsFilled);
        Assert.False(dots[3].IsActive);
    }

    [Fact]
    public void BuildDots_handles_the_first_and_last_steps()
    {
        var first = OnboardingWizardProjection.BuildDots(0, 4);
        Assert.True(first[0].IsActive);
        Assert.True(first[0].IsFilled);
        Assert.False(first[1].IsFilled);

        var last = OnboardingWizardProjection.BuildDots(3, 4);
        Assert.All(last, dot => Assert.True(dot.IsFilled));
        Assert.True(last[3].IsActive);
        Assert.False(last[2].IsActive);

        Assert.Empty(OnboardingWizardProjection.BuildDots(0, 0));
    }

    [Fact]
    public void Projection_clamps_an_out_of_range_step()
    {
        Assert.Equal(0, Project(true, -5).CurrentStepIndex);
        Assert.Equal(3, Project(true, 99).CurrentStepIndex);
    }

    [Fact]
    public void Projection_carries_the_presenting_flag()
    {
        Assert.True(Project(isPresenting: true, currentStep: 0).IsPresenting);
        Assert.False(Project(isPresenting: false, currentStep: 0).IsPresenting);
    }

    [Fact]
    public void Projection_accessible_name_is_the_title_and_description_is_the_step_text()
    {
        var p = Project(true, 2);
        Assert.Equal(p.Title, p.AccessibleName);
        Assert.Equal(p.Description, p.AccessibleDescription);
        Assert.False(string.IsNullOrWhiteSpace(p.AccessibleName));
        Assert.False(string.IsNullOrWhiteSpace(p.AccessibleDescription));
    }

    [Fact]
    public void Projection_equality_ignores_the_derived_dots()
    {
        // Two projections with identical scalar state must be equal (the view-model relies on this to skip no-op
        // reprojections) — even though Dots allocates a fresh list each access.
        Assert.Equal(Project(true, 1), Project(true, 1));
        Assert.NotEqual(Project(true, 1), Project(true, 2));
    }

    [Fact]
    public void Projection_throws_on_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() => OnboardingWizardProjection.Project(true, 0, null!));

    // ── onboarded stores ──────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void InMemoryStore_starts_not_onboarded_and_records_a_completion()
    {
        var store = new InMemoryOnboardingStore();
        var raised = 0;
        store.Changed += (_, _) => raised++;

        Assert.False(store.IsOnboarded);

        store.Complete();

        Assert.True(store.IsOnboarded);
        Assert.Equal(1, store.CompleteCount);
        Assert.Equal(1, raised);
    }

    [Fact]
    public void InMemoryStore_seeded_onboarded_starts_completed()
    {
        var store = new InMemoryOnboardingStore(onboarded: true);
        Assert.True(store.IsOnboarded);
    }

    [Fact]
    public void InMemoryStore_reset_clears_the_flag()
    {
        var store = new InMemoryOnboardingStore(onboarded: true);
        var raised = 0;
        store.Changed += (_, _) => raised++;

        store.Reset();

        Assert.False(store.IsOnboarded);
        Assert.Equal(1, raised);

        store.Reset(); // idempotent — no further change.
        Assert.Equal(1, raised);
    }

    [Fact]
    public void DelegatedStore_round_trips_through_the_host_reader_writer()
    {
        string? stored = null;
        var store = new DelegatedOnboardingStore(() => stored, v => stored = v);
        var raised = 0;
        store.Changed += (_, _) => raised++;

        Assert.False(store.IsOnboarded);

        store.Complete();

        Assert.Equal("true", stored);
        Assert.True(store.IsOnboarded);
        Assert.Equal(1, raised);
    }

    [Fact]
    public void DelegatedStore_read_failure_degrades_to_not_onboarded()
    {
        var store = new DelegatedOnboardingStore(
            () => throw new InvalidOperationException("storage unavailable"),
            _ => { });

        Assert.False(store.IsOnboarded);
    }

    [Fact]
    public void DelegatedStore_write_failure_is_swallowed_but_still_notifies()
    {
        var store = new DelegatedOnboardingStore(
            () => null,
            _ => throw new InvalidOperationException("quota exceeded"));
        var raised = 0;
        store.Changed += (_, _) => raised++;

        store.Complete(); // must not throw.

        Assert.Equal(1, raised);
    }

    [Fact]
    public void DelegatedStore_external_completion_notification_re_renders()
    {
        var store = new DelegatedOnboardingStore(() => null, _ => { });
        var raised = 0;
        store.Changed += (_, _) => raised++;

        store.NotifyExternalCompletion();

        Assert.Equal(1, raised);
    }

    [Fact]
    public void DelegatedStore_validates_its_reader_and_writer()
    {
        Assert.Throws<ArgumentNullException>(() => new DelegatedOnboardingStore(null!, _ => { }));
        Assert.Throws<ArgumentNullException>(() => new DelegatedOnboardingStore(() => null, null!));
    }

    // ── view model ────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_is_hidden_before_the_reveal_delay_elapses()
    {
        using var vm = new OnboardingWizardViewModel(Localizer, new InMemoryOnboardingStore());

        Assert.False(vm.IsRevealed);
        Assert.False(vm.IsPresenting);
        Assert.Equal(0, vm.CurrentStepIndex);
        Assert.Equal("Welcome to TeslaSync", vm.Title);
        Assert.Equal("Next", vm.PrimaryActionLabel);
        Assert.Equal("Skip", vm.SkipLabel);
    }

    [Fact]
    public void ViewModel_reveal_presents_the_wizard()
    {
        using var vm = new OnboardingWizardViewModel(Localizer, new InMemoryOnboardingStore());
        var changes = 0;
        vm.PropertyChanged += (_, _) => changes++;

        vm.Reveal();

        Assert.True(vm.IsRevealed);
        Assert.True(vm.IsPresenting);
        Assert.Equal(1, changes);

        vm.Reveal(); // idempotent — already revealed.
        Assert.Equal(1, changes);
    }

    [Fact]
    public void ViewModel_reveal_stays_hidden_when_already_onboarded()
    {
        using var vm = new OnboardingWizardViewModel(Localizer, new InMemoryOnboardingStore(onboarded: true));

        vm.Reveal();

        Assert.True(vm.IsRevealed);
        Assert.False(vm.IsPresenting);
    }

    [Fact]
    public void ViewModel_advance_walks_the_steps_then_finishes()
    {
        var store = new InMemoryOnboardingStore();
        using var vm = new OnboardingWizardViewModel(Localizer, store);
        vm.Reveal();

        Assert.Equal(0, vm.CurrentStepIndex);
        Assert.Equal("Next", vm.PrimaryActionLabel);

        vm.Advance();
        Assert.Equal(1, vm.CurrentStepIndex);

        vm.Advance();
        Assert.Equal(2, vm.CurrentStepIndex);

        vm.Advance();
        Assert.Equal(3, vm.CurrentStepIndex);
        Assert.True(vm.IsLastStep);
        Assert.Equal("Get Started", vm.PrimaryActionLabel);

        vm.Advance(); // final step → completes onboarding.
        Assert.True(store.IsOnboarded);
        Assert.Equal(1, store.CompleteCount);
        Assert.False(vm.IsPresenting);
    }

    [Fact]
    public void ViewModel_skip_completes_and_collapses_the_wizard()
    {
        var store = new InMemoryOnboardingStore();
        using var vm = new OnboardingWizardViewModel(Localizer, store);
        vm.Reveal();

        Assert.True(vm.IsPresenting);
        vm.Skip();

        Assert.True(store.IsOnboarded);
        Assert.Equal(1, store.CompleteCount);
        Assert.False(vm.IsPresenting);
    }

    [Fact]
    public void ViewModel_dismiss_completes_and_collapses_the_wizard()
    {
        var store = new InMemoryOnboardingStore();
        using var vm = new OnboardingWizardViewModel(Localizer, store);
        vm.Reveal();
        var changes = 0;
        vm.PropertyChanged += (_, _) => changes++;

        vm.Dismiss();

        Assert.True(store.IsOnboarded);
        Assert.False(vm.IsPresenting);
        Assert.Equal(1, changes);
    }

    [Fact]
    public void ViewModel_collapses_on_an_external_completion()
    {
        var store = new InMemoryOnboardingStore();
        using var vm = new OnboardingWizardViewModel(Localizer, store);
        vm.Reveal();
        var changes = 0;
        vm.PropertyChanged += (_, _) => changes++;

        Assert.True(vm.IsPresenting);

        // A sibling instance completes onboarding (web subscribe('onboarded')).
        store.Complete();

        Assert.False(vm.IsPresenting);
        Assert.Equal(1, changes);
    }

    [Fact]
    public void ViewModel_dispose_unsubscribes_from_the_store()
    {
        var store = new InMemoryOnboardingStore();
        var vm = new OnboardingWizardViewModel(Localizer, store);
        vm.Reveal();
        var changes = 0;
        vm.PropertyChanged += (_, _) => changes++;

        vm.Dispose();
        store.Complete();

        Assert.Equal(0, changes);
    }

    [Fact]
    public void ViewModel_validates_its_dependencies()
    {
        var store = new InMemoryOnboardingStore();
        Assert.Throws<ArgumentNullException>(() => new OnboardingWizardViewModel(null!, store));
        Assert.Throws<ArgumentNullException>(() => new OnboardingWizardViewModel(Localizer, null!));
    }

    // ── diagnostics ───────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_emits_only_the_view_opened_event_with_the_slug()
    {
        var lines = new List<string>();
        var diagnostics = new OnboardingWizardDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal(new[] { "view.opened slug=OnboardingWizard" }, lines);
    }

    [Fact]
    public void Diagnostics_counts_repeated_opens()
    {
        var diagnostics = new OnboardingWizardDiagnostics();
        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();
        Assert.Equal(2, diagnostics.ViewsOpened);
    }
}
