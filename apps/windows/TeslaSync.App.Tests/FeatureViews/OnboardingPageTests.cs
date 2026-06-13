using System.Linq;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Onboarding;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>OnboardingPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/onboarding/pages/OnboardingPage.tsx), the tolerant status parser
/// (web/src/api/hooks/useOnboarding.ts), the three-step <c>Stepper</c> done / current / pending derivation and its
/// per-step CTA, the footer's complete-vs-polling + skip-vs-continue branch, the two-state matrix (loading / success)
/// and the view-model's pessimistic-gate load flow + 30s poll contract. The WinUI view is exercised by the app build;
/// its per-region visibility is driven entirely by the <see cref="OnboardingDisplay"/> flags asserted here.
/// </summary>
public sealed class OnboardingPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // The 25 i18n keys the manifest requires the page to resolve.
    private static readonly string[] RequiredStringKeys =
    [
        "onboarding.checkAgain", "onboarding.continue", "onboarding.footer.account", "onboarding.footer.docs",
        "onboarding.footer.help", "onboarding.footer.or", "onboarding.intro.desc", "onboarding.intro.title",
        "onboarding.pageTitle", "onboarding.polling", "onboarding.ready", "onboarding.skip", "onboarding.skipHint",
        "onboarding.subtitle", "onboarding.telemetry.desc", "onboarding.telemetry.docs", "onboarding.telemetry.title",
        "onboarding.tesla.cta", "onboarding.tesla.desc", "onboarding.tesla.title", "onboarding.vehicle.checking",
        "onboarding.vehicle.cta", "onboarding.vehicle.desc", "onboarding.vehicle.title", "onboarding.welcome",
    ];

    private static OnboardingModel Model(
        bool teslaConnected = false,
        int vehicleCount = 0,
        bool dataFlowing = false,
        bool isComplete = false,
        bool resolved = true,
        bool loading = false,
        bool isFetching = false) =>
        new(
            Status: new OnboardingStatusSnapshot(teslaConnected, vehicleCount, dataFlowing, isComplete),
            Resolved: resolved,
            Loading: loading,
            IsFetching: isFetching);

    // ---- i18n key coverage (all 25 manifest strings) -------------------------------

    [Fact]
    public void Manifest_requires_twenty_five_strings()
    {
        Assert.Equal(25, RequiredStringKeys.Length);
        Assert.Equal(RequiredStringKeys.Length, RequiredStringKeys.Distinct().Count());
    }

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        // One projection run references every manifest key regardless of the model branch.
        _ = OnboardingProjection.Project(Model(isFetching: true), recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_all_keys_even_in_the_loading_state()
    {
        var recorder = new RecordingLocalizer();

        _ = OnboardingProjection.Project(Model(resolved: false, loading: true), recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    // ---- two-state matrix ----------------------------------------------------------

    [Fact]
    public void Unresolved_first_read_projects_loading_state()
    {
        var display = OnboardingProjection.Project(Model(resolved: false, loading: true), Localizer);
        Assert.Equal(OnboardingState.Loading, display.State);
    }

    [Fact]
    public void Resolved_read_projects_success_state()
    {
        var display = OnboardingProjection.Project(Model(), Localizer);
        Assert.Equal(OnboardingState.Success, display.State);
    }

    [Fact]
    public void Header_resolves_welcome_and_subtitle()
    {
        var display = OnboardingProjection.Project(Model(), Localizer);
        Assert.Equal("Welcome to TeslaSync", display.Title);
        Assert.Equal("Three quick steps before your dashboard is ready.", display.Subtitle);
        Assert.Equal("Welcome to TeslaSync", display.DocumentTitle);
        Assert.Equal("Setup checklist", display.IntroTitle);
    }

    // ---- three-step checklist ------------------------------------------------------

    [Fact]
    public void Three_steps_render_in_order()
    {
        var display = OnboardingProjection.Project(Model(), Localizer);
        Assert.Collection(
            display.Steps,
            s => Assert.Equal("tesla", s.Key),
            s => Assert.Equal("vehicle", s.Key),
            s => Assert.Equal("telemetry", s.Key));
    }

    [Fact]
    public void Nothing_connected_makes_the_tesla_step_current()
    {
        var display = OnboardingProjection.Project(Model(), Localizer);

        Assert.False(display.Steps[0].Done);
        Assert.True(display.Steps[0].IsCurrent);
        Assert.False(display.Steps[1].IsCurrent);
        Assert.False(display.Steps[2].IsCurrent);
    }

    [Fact]
    public void Connecting_tesla_advances_the_current_step_to_vehicle()
    {
        var display = OnboardingProjection.Project(Model(teslaConnected: true), Localizer);

        Assert.True(display.Steps[0].Done);
        Assert.False(display.Steps[0].IsCurrent);
        Assert.True(display.Steps[1].IsCurrent);
    }

    [Fact]
    public void Vehicles_present_advances_the_current_step_to_telemetry()
    {
        var display = OnboardingProjection.Project(Model(teslaConnected: true, vehicleCount: 2), Localizer);

        Assert.True(display.Steps[1].Done);
        Assert.True(display.Steps[2].IsCurrent);
    }

    [Fact]
    public void Every_anchor_satisfied_leaves_no_current_step()
    {
        var display = OnboardingProjection.Project(
            Model(teslaConnected: true, vehicleCount: 1, dataFlowing: true, isComplete: true),
            Localizer);

        Assert.All(display.Steps, s => Assert.True(s.Done));
        Assert.DoesNotContain(display.Steps, s => s.IsCurrent);
    }

    [Fact]
    public void Step_ctas_carry_the_web_targets_and_actions()
    {
        var display = OnboardingProjection.Project(Model(), Localizer);

        Assert.Equal(OnboardingStepAction.Navigate, display.Steps[0].CtaAction);
        Assert.Equal("/tesla-account", display.Steps[0].CtaTarget);
        Assert.Equal("Connect Tesla account", display.Steps[0].CtaLabel);

        Assert.Equal(OnboardingStepAction.Refresh, display.Steps[1].CtaAction);

        Assert.Equal(OnboardingStepAction.DocumentationLink, display.Steps[2].CtaAction);
        Assert.Equal("/docs/fleet-telemetry-setup", display.Steps[2].CtaTarget);
        Assert.Equal("Setup guide", display.Steps[2].CtaLabel);
    }

    [Theory]
    [InlineData(false, "Refresh", true)]
    [InlineData(true, "Checking…", false)]
    public void Vehicle_step_cta_reflects_the_fetching_flag(bool fetching, string label, bool enabled)
    {
        var display = OnboardingProjection.Project(Model(isFetching: fetching), Localizer);

        Assert.Equal(label, display.Steps[1].CtaLabel);
        Assert.Equal(enabled, display.Steps[1].CtaEnabled);
        Assert.Equal(enabled, display.CheckAgainEnabled);
    }

    // ---- footer branch -------------------------------------------------------------

    [Fact]
    public void Incomplete_setup_shows_polling_copy_and_skip()
    {
        var display = OnboardingProjection.Project(Model(), Localizer);

        Assert.False(display.IsComplete);
        Assert.Equal("This page refreshes automatically every 30 seconds.", display.StatusLine);
        Assert.True(display.ShowSkip);
        Assert.False(display.ShowContinue);
        Assert.Equal("Skip for now", display.SkipLabel);
        Assert.Equal("Check again", display.CheckAgainLabel);
    }

    [Fact]
    public void Complete_setup_shows_ready_copy_and_continue()
    {
        var display = OnboardingProjection.Project(
            Model(teslaConnected: true, vehicleCount: 1, dataFlowing: true, isComplete: true),
            Localizer);

        Assert.True(display.IsComplete);
        Assert.Equal("You are all set — your dashboard is ready.", display.StatusLine);
        Assert.False(display.ShowSkip);
        Assert.True(display.ShowContinue);
        Assert.Equal("Continue to dashboard", display.ContinueLabel);
    }

    [Fact]
    public void Footer_help_resolves_the_link_labels()
    {
        var display = OnboardingProjection.Project(Model(), Localizer);

        Assert.Equal("Need help? See the", display.FooterHelp);
        Assert.Equal("Tesla account page", display.FooterAccountLabel);
        Assert.Equal("documentation", display.FooterDocsLabel);
    }

    // ---- tolerant JSON parsing -----------------------------------------------------

    [Fact]
    public void Snapshot_parses_the_flat_object()
    {
        using var doc = JsonDocument.Parse(
            "{\"tesla_connected\":true,\"vehicle_count\":3,\"data_flowing\":false,\"is_complete\":false}");

        var snapshot = OnboardingStatusSnapshot.FromJson(doc.RootElement);

        Assert.True(snapshot.TeslaConnected);
        Assert.Equal(3, snapshot.VehicleCount);
        Assert.False(snapshot.DataFlowing);
        Assert.False(snapshot.IsComplete);
    }

    [Fact]
    public void Snapshot_unwraps_the_data_envelope()
    {
        using var doc = JsonDocument.Parse(
            "{\"data\":{\"tesla_connected\":true,\"vehicle_count\":1,\"data_flowing\":true,\"is_complete\":true}}");

        var snapshot = OnboardingStatusSnapshot.FromJson(doc.RootElement);

        Assert.True(snapshot.TeslaConnected);
        Assert.Equal(1, snapshot.VehicleCount);
        Assert.True(snapshot.IsComplete);
    }

    [Fact]
    public void Snapshot_treats_missing_fields_as_unsatisfied()
    {
        using var doc = JsonDocument.Parse("{}");

        var snapshot = OnboardingStatusSnapshot.FromJson(doc.RootElement);

        Assert.False(snapshot.TeslaConnected);
        Assert.Equal(0, snapshot.VehicleCount);
        Assert.False(snapshot.DataFlowing);
        Assert.False(snapshot.IsComplete);
    }

    [Fact]
    public void Snapshot_treats_non_object_as_pending()
    {
        using var doc = JsonDocument.Parse("null");
        Assert.Equal(OnboardingStatusSnapshot.Pending, OnboardingStatusSnapshot.FromJson(doc.RootElement));
    }

    // ---- view-model flow -----------------------------------------------------------

    [Fact]
    public async Task ViewModel_load_transitions_to_success()
    {
        var feed = new FakeFeed(new OnboardingStatusSnapshot(true, 2, true, true));
        using var vm = new OnboardingPageViewModel(feed, Localizer);

        await vm.LoadAsync();

        Assert.Equal(OnboardingState.Success, vm.State);
        Assert.True(vm.IsComplete);
        Assert.False(vm.IsFetching);
        Assert.True(vm.Display.ShowContinue);
    }

    [Fact]
    public async Task ViewModel_default_feed_is_the_outstanding_checklist()
    {
        using var vm = new OnboardingPageViewModel(EmptyOnboardingStatusFeed.Instance, Localizer);

        await vm.LoadAsync();

        Assert.Equal(OnboardingState.Success, vm.State);
        Assert.False(vm.IsComplete);
        Assert.True(vm.Display.ShowSkip);
        Assert.True(vm.Display.Steps[0].IsCurrent);
    }

    [Fact]
    public async Task ViewModel_feed_failure_degrades_to_the_pessimistic_checklist()
    {
        // web pessimistic gate: a failed read falls back to "nothing connected" rather than a failure region.
        using var vm = new OnboardingPageViewModel(new ThrowingFeed(), Localizer);

        await vm.LoadAsync();

        Assert.Equal(OnboardingState.Success, vm.State);
        Assert.False(vm.IsComplete);
        Assert.False(vm.Display.IsComplete);
        Assert.True(vm.Display.ShowSkip);
    }

    [Fact]
    public async Task ViewModel_polls_until_complete()
    {
        var feed = new FakeFeed(new OnboardingStatusSnapshot(true, 1, false, false));
        using var vm = new OnboardingPageViewModel(feed, Localizer);

        Assert.False(vm.ShouldPoll); // nothing read yet

        await vm.LoadAsync();
        Assert.True(vm.ShouldPoll); // resolved + incomplete -> keep polling

        feed.Next = new OnboardingStatusSnapshot(true, 1, true, true);
        await vm.RefreshAsync();
        Assert.False(vm.ShouldPoll); // complete -> stop polling
    }

    // ---- registration + diagnostics ------------------------------------------------

    [Fact]
    public void Registration_exposes_route_slug_and_operation()
    {
        Assert.Equal("Onboarding", OnboardingRegistration.RouteName);
        Assert.Equal("OnboardingPage", OnboardingRegistration.Slug);
        Assert.Equal("get_api_v1_onboarding_status", OnboardingRegistration.StatusOperation);
        Assert.Equal(30, OnboardingRegistration.PollIntervalSeconds);
        Assert.Equal("Welcome to TeslaSync", OnboardingRegistration.Title(Localizer));
        Assert.Equal("Three quick steps before your dashboard is ready.", OnboardingRegistration.Subtitle(Localizer));
    }

    [Fact]
    public void Diagnostics_records_view_opened_with_slug()
    {
        string? captured = null;
        var diagnostics = new OnboardingDiagnostics(line => captured = line);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=OnboardingPage", captured);
    }

    // ---- test doubles --------------------------------------------------------------

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = [];

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }

    private sealed class FakeFeed(OnboardingStatusSnapshot first) : IOnboardingStatusFeed
    {
        public OnboardingStatusSnapshot Next { get; set; } = first;

        public Task<OnboardingStatusSnapshot> FetchAsync(CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            return Task.FromResult(Next);
        }
    }

    private sealed class ThrowingFeed : IOnboardingStatusFeed
    {
        public Task<OnboardingStatusSnapshot> FetchAsync(CancellationToken cancellationToken) =>
            throw new InvalidOperationException("offline");
    }
}
