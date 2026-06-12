using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Dashboard;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>DashboardPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/dashboard/pages/DashboardPage.tsx), the three-state matrix (loading / error / success), the
/// authenticated vs unauthenticated onboarding branch, the auth-warning gate, and the view-model's auth-load and
/// vehicle-sync flow over its two data ports (<c>useAuthStatus</c> + <c>useSyncVehicles</c>). The WinUI view is
/// exercised by the app build; its per-region visibility is driven entirely by the
/// <see cref="DashboardDisplay"/> flags asserted here.
/// </summary>
public sealed class DashboardPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    /// <summary>Every visible literal the page renders (web key names) — the 36 manifest parity strings.</summary>
    private static readonly string[] RequiredStringKeys =
    [
        "auth.connectPrompt", "auth.notConnected", "auth.settings", "auth.toStart",
        "dashboard.addWidget", "dashboard.autoArrange", "dashboard.customize", "dashboard.customizeHint",
        "dashboard.customizeHintCta", "dashboard.done", "dashboard.editHint", "dashboard.kiosk",
        "dashboard.newDashboard", "dashboard.printSnapshot", "dashboard.redo", "dashboard.reset",
        "dashboard.templates", "dashboard.undo", "error.loadFailed", "layout.resetMessage",
        "onboarding.charging", "onboarding.connect", "onboarding.control", "onboarding.desc",
        "onboarding.drives", "onboarding.sync", "onboarding.syncDesc", "onboarding.syncTitle",
        "onboarding.title", "onboarding.tracking", "subtitle", "theme.firstRunBody",
        "theme.firstRunLater", "theme.firstRunOpen", "theme.firstRunTitle", "title",
    ];

    private static DashboardModel Model(
        bool authenticated = false,
        bool resolved = true,
        bool loading = false,
        bool loadFailed = false,
        string? errorDetail = null,
        bool editMode = false,
        bool syncing = false) =>
        new(
            Auth: new DashboardAuthStatus(authenticated, resolved),
            Loading: loading,
            LoadFailed: loadFailed,
            ErrorDetail: errorDetail,
            EditMode: editMode,
            Syncing: syncing);

    // ---- i18n key coverage (all 36 manifest strings) -------------------------------

    [Fact]
    public void Manifest_requires_thirty_six_strings()
    {
        Assert.Equal(36, RequiredStringKeys.Length);
        Assert.Equal(RequiredStringKeys.Length, RequiredStringKeys.Distinct().Count());
    }

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        // One projection run references every manifest key regardless of the model branch.
        _ = DashboardProjection.Project(Model(authenticated: true, loadFailed: true, errorDetail: "boom", editMode: true), recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    // ---- three-state matrix --------------------------------------------------------

    [Fact]
    public void Loading_model_projects_loading_state()
    {
        var display = DashboardProjection.Project(Model(resolved: false, loading: true), Localizer);
        Assert.Equal(DashboardState.Loading, display.State);
        Assert.False(display.HasError);
    }

    [Fact]
    public void Failed_model_projects_error_state_with_banner_text()
    {
        var display = DashboardProjection.Project(Model(loadFailed: true, errorDetail: "network down"), Localizer);
        Assert.Equal(DashboardState.Error, display.State);
        Assert.True(display.HasError);
        Assert.Contains("Failed to load data", display.ErrorText);
        Assert.Contains("network down", display.ErrorText);
    }

    [Fact]
    public void Resolved_model_projects_success_state()
    {
        var display = DashboardProjection.Project(Model(authenticated: true), Localizer);
        Assert.Equal(DashboardState.Success, display.State);
        Assert.False(display.HasError);
    }

    [Fact]
    public void Sync_error_is_additive_banner_over_success()
    {
        // A resolved auth value with a sync failure keeps the success body but surfaces the error banner.
        var display = DashboardProjection.Project(Model(authenticated: true, errorDetail: "sync failed"), Localizer);
        Assert.Equal(DashboardState.Success, display.State);
        Assert.True(display.HasError);
    }

    // ---- onboarding branch ---------------------------------------------------------

    [Fact]
    public void Unauthenticated_onboarding_shows_welcome_and_connect()
    {
        var display = DashboardProjection.Project(Model(authenticated: false), Localizer);

        Assert.False(display.Authenticated);
        Assert.Equal("Welcome to TeslaSync", display.OnboardingHeading);
        Assert.Equal("Connect Tesla Account", display.OnboardingActionLabel);
        Assert.True(display.ShowAuthWarning);
        Assert.Equal(4, display.FeatureCards.Count);
    }

    [Fact]
    public void Authenticated_onboarding_shows_sync_and_hides_warning()
    {
        var display = DashboardProjection.Project(Model(authenticated: true), Localizer);

        Assert.True(display.Authenticated);
        Assert.Equal("Sync Your Vehicles", display.OnboardingHeading);
        Assert.Equal("Sync Vehicles", display.OnboardingActionLabel);
        Assert.False(display.ShowAuthWarning);
    }

    [Fact]
    public void Unknown_auth_does_not_show_warning_before_first_read()
    {
        var display = DashboardProjection.Project(Model(authenticated: false, resolved: false, loading: true), Localizer);
        Assert.False(display.ShowAuthWarning);
    }

    [Fact]
    public void Feature_cards_carry_labels_and_accents()
    {
        var display = DashboardProjection.Project(Model(), Localizer);
        Assert.Collection(
            display.FeatureCards,
            c => Assert.Equal("Real-time Tracking", c.Label),
            c => Assert.Equal("Drive History", c.Label),
            c => Assert.Equal("Charge Analytics", c.Label),
            c => Assert.Equal("Vehicle Control", c.Label));
    }

    // ---- auth-status parsing -------------------------------------------------------

    [Theory]
    [InlineData("{\"authenticated\":true}", true)]
    [InlineData("{\"authenticated\":false}", false)]
    [InlineData("{}", false)]
    public void Auth_status_parses_authenticated_flag(string json, bool expected)
    {
        using var doc = System.Text.Json.JsonDocument.Parse(json);
        var auth = DashboardAuthStatus.FromJson(doc.RootElement);
        Assert.Equal(expected, auth.Authenticated);
        Assert.True(auth.Resolved);
    }

    // ---- view-model flow -----------------------------------------------------------

    [Fact]
    public async Task ViewModel_load_transitions_to_success_with_auth()
    {
        var source = new StubAuthSource(RepositoryResult<DashboardAuthStatus>.Loaded(new DashboardAuthStatus(true, true), DateTimeOffset.UtcNow));
        var gateway = new StubSyncGateway();
        using var vm = new DashboardPageViewModel(source, gateway, Localizer);

        await vm.LoadAsync();

        Assert.Equal(DashboardState.Success, vm.State);
        Assert.True(vm.Display.Authenticated);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_load_failure_sets_error_state()
    {
        var source = new StubAuthSource(RepositoryResult<DashboardAuthStatus>.Failure(new RepositoryError(RepositoryErrorKind.Network, "offline")));
        using var vm = new DashboardPageViewModel(source, new StubSyncGateway(), Localizer);

        await vm.LoadAsync();

        Assert.Equal(DashboardState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.True(vm.Display.HasError);
    }

    [Fact]
    public async Task ViewModel_sync_invokes_gateway_then_reloads()
    {
        var source = new StubAuthSource(RepositoryResult<DashboardAuthStatus>.Loaded(new DashboardAuthStatus(true, true), DateTimeOffset.UtcNow));
        var gateway = new StubSyncGateway();
        using var vm = new DashboardPageViewModel(source, gateway, Localizer);

        await vm.LoadAsync();
        await vm.SyncAsync();

        Assert.Equal(1, gateway.Calls);
        Assert.False(vm.IsSyncing);
    }

    [Fact]
    public async Task ViewModel_sync_failure_surfaces_error_banner()
    {
        var source = new StubAuthSource(RepositoryResult<DashboardAuthStatus>.Loaded(new DashboardAuthStatus(true, true), DateTimeOffset.UtcNow));
        var gateway = new StubSyncGateway(RepositoryResult<bool>.Failure(new RepositoryError(RepositoryErrorKind.Server, "sync 500")));
        using var vm = new DashboardPageViewModel(source, gateway, Localizer);

        await vm.LoadAsync();
        await vm.SyncAsync();

        Assert.True(vm.Display.HasError);
        Assert.Equal(DashboardState.Success, vm.State);
    }

    [Fact]
    public void ViewModel_toggles_edit_mode()
    {
        using var vm = new DashboardPageViewModel(EmptyAuthStatusSource.Instance, NoopVehicleSyncGateway.Instance, Localizer);

        Assert.False(vm.EditMode);
        vm.ToggleEditMode();
        Assert.True(vm.EditMode);
        Assert.True(vm.Display.EditMode);
        vm.SetEditMode(false);
        Assert.False(vm.EditMode);
    }

    // ---- registration --------------------------------------------------------------

    [Fact]
    public void Registration_exposes_route_and_slug()
    {
        Assert.Equal("Dashboard", DashboardRegistration.RouteName);
        Assert.Equal("DashboardPage", DashboardRegistration.Slug);
        Assert.Equal("Command Center", DashboardRegistration.Title(Localizer));
        Assert.Equal("Real-time fleet intelligence and control", DashboardRegistration.Subtitle(Localizer));
    }

    [Fact]
    public void Diagnostics_records_view_opened_with_slug()
    {
        string? captured = null;
        var diagnostics = new DashboardDiagnostics(line => captured = line);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=DashboardPage", captured);
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

    private sealed class StubAuthSource(RepositoryResult<DashboardAuthStatus> result) : IAuthStatusSource
    {
        public async IAsyncEnumerable<RepositoryResult<DashboardAuthStatus>> StreamAsync(
            [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            yield return result;
            await Task.CompletedTask.ConfigureAwait(false);
        }
    }

    private sealed class StubSyncGateway(RepositoryResult<bool>? result = null) : IVehicleSyncGateway
    {
        private readonly RepositoryResult<bool> _result = result ?? RepositoryResult<bool>.Loaded(true, DateTimeOffset.UtcNow);

        public int Calls { get; private set; }

        public Task<RepositoryResult<bool>> SyncAsync(CancellationToken cancellationToken = default)
        {
            Calls++;
            return Task.FromResult(_result);
        }
    }
}
