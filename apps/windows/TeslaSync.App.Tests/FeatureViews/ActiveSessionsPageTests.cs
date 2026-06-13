using System.Linq;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Settings;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>ActiveSessionsPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/settings/pages/ActiveSessionsPage.tsx + components/ActiveSessionsSection.tsx), the device-label
/// heuristic (web <c>describeDevice</c>), the tolerant list parser (the <c>{ mode, sessions }</c> object, the platform
/// <c>{ data: [...] }</c> envelope and the bare array, plus the <c>mode: 'open'</c> signal), the view-model's
/// five-state matrix (loading / open-mode / error / empty / populated) plus the per-row + all-others revoke flows
/// (web <c>useRevokeSession</c> / <c>useRevokeAllOtherSessions</c>), and the generated-client feed's request shaping
/// (web <c>useSessions</c> GET + the two DELETEs, with the 501 <c>AUTH_MODE_OPEN</c> mapped to open-mode). The WinUI
/// view is exercised by the app build; its per-region visibility is driven entirely by the
/// <see cref="ActiveSessionsDisplay"/> flags asserted here.
/// </summary>
public sealed class ActiveSessionsPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 12, 17, 0, 0, TimeSpan.Zero);

    // The 2 i18n keys the manifest (page:settings/ActiveSessions) requires the page to resolve.
    private static readonly string[] ManifestStringKeys =
    [
        "account.sessions.subtitle", "account.sessions.title",
    ];

    // The hosted section's i18n keys (ported beyond the manifest minimum for full web fidelity).
    private static readonly string[] SectionStringKeys =
    [
        "sessions.loading", "sessions.openMode.title", "sessions.openMode.message", "sessions.errors.load",
        "common.retry", "sessions.title", "sessions.subtitle", "sessions.revokeAllOthers", "sessions.revokeAllOthersBusy",
        "sessions.columns.device", "sessions.columns.ip", "sessions.columns.createdAt", "sessions.columns.lastSeenAt",
        "sessions.current", "sessions.row.revoke", "sessions.row.revokeAria", "sessions.empty",
        "sessions.confirm.revokeTitle", "sessions.confirm.revokeMessage", "sessions.confirm.revokeConfirm",
        "sessions.confirm.revokeCancel", "sessions.confirm.allOthersTitle", "sessions.confirm.allOthersMessage",
        "sessions.confirm.allOthersConfirm", "sessions.confirm.allOthersCancel",
    ];

    private static ActiveSession Session(
        string id = "s-1",
        string userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        string ip = "203.0.113.7",
        string? createdAt = "2026-06-12T16:30:00Z",
        string? lastSeenAt = "2026-06-12T16:45:00Z",
        bool current = false) =>
        new(id, userAgent, ip, createdAt, lastSeenAt, current);

    private static ActiveSessionsModel Model(
        SessionsMode? mode = SessionsMode.Session,
        IReadOnlyList<ActiveSession>? sessions = null,
        bool loading = false,
        bool hasError = false,
        string? errorDetail = null,
        string? revokingId = null,
        bool revokingAllOthers = false) =>
        new(mode, sessions ?? [Session()], loading, hasError, errorDetail, revokingId, revokingAllOthers, Now);

    // ---- i18n key coverage ---------------------------------------------------------

    [Fact]
    public void Projection_resolves_the_two_manifest_string_keys()
    {
        var recorder = new RecordingLocalizer();

        _ = ActiveSessionsProjection.Project(Model(), recorder);

        foreach (var key in ManifestStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_the_section_string_keys_in_every_state()
    {
        var recorder = new RecordingLocalizer();

        // Chrome strings (page title/subtitle, panel header, columns, confirm copy) resolve on every projection
        // regardless of data state; visibility is gated separately.
        _ = ActiveSessionsProjection.Project(ActiveSessionsModel.Initial, recorder);

        foreach (var key in ManifestStringKeys.Concat(SectionStringKeys))
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Registration_exposes_the_manifest_title_and_subtitle_defaults()
    {
        Assert.Equal("Active sessions", ActiveSessionsRegistration.Title(Localizer));
        Assert.Equal(
            "Devices currently signed in to TeslaSync. Revoke individual sessions or sign out everywhere else.",
            ActiveSessionsRegistration.Subtitle(Localizer));
    }

    // ---- Five data states ----------------------------------------------------------

    [Fact]
    public void State_loading_when_query_in_flight()
    {
        var display = ActiveSessionsProjection.Project(ActiveSessionsModel.Initial, Localizer);

        Assert.Equal(ActiveSessionsState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowOpenMode);
        Assert.False(display.ShowError);
        Assert.False(display.ShowForwardAuth);
        Assert.Equal("Loading sessions\u2026", display.LoadingText);
    }

    [Fact]
    public void State_open_mode_when_session_tracking_unavailable()
    {
        var display = ActiveSessionsProjection.Project(Model(mode: SessionsMode.Open, sessions: []), Localizer);

        Assert.Equal(ActiveSessionsState.OpenMode, display.State);
        Assert.True(display.ShowOpenMode);
        Assert.False(display.ShowForwardAuth);
        Assert.Equal("Active sessions", display.OpenModeTitle);
        Assert.Contains("forward-auth", display.OpenModeMessage, StringComparison.Ordinal);
    }

    [Fact]
    public void State_error_shows_failure_and_retry()
    {
        var display = ActiveSessionsProjection.Project(
            Model(loading: false, hasError: true, errorDetail: "network down", sessions: []),
            Localizer);

        Assert.Equal(ActiveSessionsState.Error, display.State);
        Assert.True(display.ShowError);
        Assert.False(display.ShowForwardAuth);
        Assert.Equal("Failed to load active sessions. network down", display.ErrorText);
        Assert.Equal("Retry", display.RetryLabel);
    }

    [Fact]
    public void State_empty_when_forward_auth_has_no_sessions()
    {
        var display = ActiveSessionsProjection.Project(Model(sessions: []), Localizer);

        Assert.Equal(ActiveSessionsState.Empty, display.State);
        Assert.True(display.ShowForwardAuth);
        Assert.True(display.ShowEmpty);
        Assert.False(display.ShowTable);
        Assert.False(display.ShowAllOthers); // nothing to sign out
        Assert.Equal("No active sessions for this account.", display.EmptyMessage);
    }

    [Fact]
    public void State_populated_when_forward_auth_has_sessions()
    {
        var display = ActiveSessionsProjection.Project(Model(), Localizer);

        Assert.Equal(ActiveSessionsState.Populated, display.State);
        Assert.True(display.ShowForwardAuth);
        Assert.True(display.ShowTable);
        Assert.False(display.ShowEmpty);
        Assert.Single(display.Rows);
    }

    // ---- Forward-auth panel — rows + all-others ------------------------------------

    [Fact]
    public void Row_formats_every_cell_and_carries_the_revoke_affordance()
    {
        var session = Session(id: "abc-1", ip: "198.51.100.4");
        var display = ActiveSessionsProjection.Project(Model(sessions: [session]), Localizer);

        var row = Assert.Single(display.Rows);
        Assert.Equal("abc-1", row.Id);
        Assert.Equal("Chrome on Windows", row.Device);
        Assert.Equal("198.51.100.4", row.Ip);
        Assert.NotEqual("\u2014", row.SignedIn); // a parseable timestamp formats to a real datetime
        Assert.NotEqual("\u2014", row.LastSeen);
        Assert.False(row.Current);
        Assert.True(row.CanRevoke);
        Assert.Equal("Sign out", row.RevokeLabel);
        Assert.Equal("Sign out Chrome on Windows", row.RevokeAria); // {{device}} substituted
    }

    [Fact]
    public void Row_uses_em_dash_for_a_missing_ip()
    {
        var session = Session(ip: "");
        var display = ActiveSessionsProjection.Project(Model(sessions: [session]), Localizer);

        Assert.Equal("\u2014", Assert.Single(display.Rows).Ip);
    }

    [Fact]
    public void Current_row_is_chipped_and_has_no_revoke_button()
    {
        var current = Session(id: "me", current: true);
        var display = ActiveSessionsProjection.Project(Model(sessions: [current]), Localizer);

        var row = Assert.Single(display.Rows);
        Assert.True(row.Current);
        Assert.False(row.CanRevoke);
        Assert.Equal("This device", row.CurrentLabel);
        Assert.False(display.ShowAllOthers); // only the current session present -> nothing else to sign out
    }

    [Fact]
    public void All_others_action_shows_when_a_non_current_session_exists()
    {
        var display = ActiveSessionsProjection.Project(
            Model(sessions: [Session(id: "me", current: true), Session(id: "other", current: false)]),
            Localizer);

        Assert.True(display.ShowAllOthers);
        Assert.Equal("Sign out all other devices", display.AllOthersLabel);
        Assert.False(display.AllOthersBusy);
    }

    [Fact]
    public void All_others_action_reflects_the_in_flight_label()
    {
        var display = ActiveSessionsProjection.Project(
            Model(sessions: [Session(id: "me", current: true), Session(id: "other")], revokingAllOthers: true),
            Localizer);

        Assert.True(display.AllOthersBusy);
        Assert.Equal("Signing out\u2026", display.AllOthersLabel);
    }

    [Fact]
    public void Revoking_a_row_marks_only_that_row_busy()
    {
        var display = ActiveSessionsProjection.Project(
            Model(sessions: [Session(id: "a"), Session(id: "b")], revokingId: "a"),
            Localizer);

        Assert.True(display.Rows.Single(r => r.Id == "a").RevokeBusy);
        Assert.False(display.Rows.Single(r => r.Id == "b").RevokeBusy);
    }

    // ---- describeDevice parity -----------------------------------------------------

    [Theory]
    [InlineData("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36", "Chrome on Windows")]
    [InlineData("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36 Edg/120.0", "Edge on Windows")]
    [InlineData("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Gecko/20100101 Firefox/121.0", "Firefox on macOS")]
    [InlineData("Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/121.0", "Firefox on Linux")]
    [InlineData("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15", "Safari on macOS")]
    [InlineData("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120 Safari/537.36 OPR/106.0", "Opera on Windows")]
    [InlineData("RandomAgent/2.0 (Android 13; Mobile)", "Browser on Android")]
    [InlineData("", "Unknown device")]
    public void DescribeDevice_matches_the_web_heuristic(string userAgent, string expected)
    {
        Assert.Equal(expected, ActiveSessionsRegistration.DescribeDevice(userAgent));
    }

    // ---- Tolerant JSON parsing -----------------------------------------------------

    [Fact]
    public void Snapshot_parses_the_mode_session_envelope()
    {
        using var doc = JsonDocument.Parse(
            "{\"mode\":\"session\",\"sessions\":[{\"id\":\"1\",\"user_agent\":\"UA\",\"ip\":\"10.0.0.1\",\"current\":true," +
            "\"created_at\":\"2026-06-12T16:30:00Z\",\"last_seen_at\":\"2026-06-12T16:45:00Z\"}]}");

        var snapshot = ActiveSessionsSnapshot.FromJson(doc.RootElement);

        Assert.Equal(SessionsMode.Session, snapshot.Mode);
        var session = Assert.Single(snapshot.Sessions);
        Assert.Equal("1", session.Id);
        Assert.Equal("UA", session.UserAgent);
        Assert.Equal("10.0.0.1", session.Ip);
        Assert.True(session.Current);
        Assert.NotNull(session.CreatedAtTime);
    }

    [Fact]
    public void Snapshot_maps_mode_open_to_the_open_state()
    {
        using var doc = JsonDocument.Parse("{\"mode\":\"open\"}");

        var snapshot = ActiveSessionsSnapshot.FromJson(doc.RootElement);

        Assert.Equal(SessionsMode.Open, snapshot.Mode);
        Assert.Empty(snapshot.Sessions);
    }

    [Fact]
    public void Snapshot_unwraps_the_data_envelope_and_a_bare_array()
    {
        using var enveloped = JsonDocument.Parse("{\"data\":[{\"id\":\"5\",\"user_agent\":\"UA\"}]}");
        using var bare = JsonDocument.Parse("[{\"id\":\"6\",\"user_agent\":\"UA\"}]");

        var fromEnvelope = ActiveSessionsSnapshot.FromJson(enveloped.RootElement);
        var fromBare = ActiveSessionsSnapshot.FromJson(bare.RootElement);

        Assert.Equal("5", Assert.Single(fromEnvelope.Sessions).Id);
        Assert.Equal("6", Assert.Single(fromBare.Sessions).Id);
    }

    [Fact]
    public void Session_parse_tolerates_missing_fields()
    {
        using var doc = JsonDocument.Parse("{\"id\":\"x\"}");

        var session = ActiveSession.FromJson(doc.RootElement);

        Assert.Equal("x", session.Id);
        Assert.Equal(string.Empty, session.UserAgent);
        Assert.Equal(string.Empty, session.Ip);
        Assert.False(session.Current);
        Assert.Null(session.CreatedAtTime);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loads_sessions_into_the_populated_state()
    {
        var feed = new FakeSessionsFeed(new ActiveSessionsSnapshot(SessionsMode.Session, [Session()]));
        using var vm = new ActiveSessionsPageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(ActiveSessionsState.Populated, vm.State);
        Assert.True(vm.Display.ShowTable);
        Assert.False(vm.IsFetching);
    }

    [Fact]
    public async Task ViewModel_empty_snapshot_is_the_empty_state()
    {
        using var vm = new ActiveSessionsPageViewModel(EmptyActiveSessionsFeed.Instance, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(ActiveSessionsState.Empty, vm.State);
        Assert.True(vm.Display.ShowEmpty);
    }

    [Fact]
    public async Task ViewModel_open_snapshot_is_the_open_mode_state()
    {
        var feed = new FakeSessionsFeed(ActiveSessionsSnapshot.Open);
        using var vm = new ActiveSessionsPageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(ActiveSessionsState.OpenMode, vm.State);
        Assert.True(vm.Display.ShowOpenMode);
    }

    [Fact]
    public async Task ViewModel_feed_failure_is_the_error_state()
    {
        using var vm = new ActiveSessionsPageViewModel(new ThrowingSessionsFeed(), Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(ActiveSessionsState.Error, vm.State);
        Assert.True(vm.Display.ShowError);
        Assert.Contains("Failed to load active sessions.", vm.Display.ErrorText, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ViewModel_revoke_calls_the_feed_and_reloads()
    {
        var feed = new FakeSessionsFeed(new ActiveSessionsSnapshot(SessionsMode.Session, [Session(id: "victim")]));
        using var vm = new ActiveSessionsPageViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();

        await vm.RevokeAsync("victim");

        Assert.Equal(1, feed.RevokeCount);
        Assert.Equal("victim", feed.LastRevokedId);
        Assert.Equal(2, feed.FetchCount); // initial load + reload after the revoke
    }

    [Fact]
    public async Task ViewModel_revoke_failure_leaves_the_list_intact()
    {
        var feed = new FakeSessionsFeed(new ActiveSessionsSnapshot(SessionsMode.Session, [Session(id: "victim")]))
        {
            RevokeThrows = true,
        };
        using var vm = new ActiveSessionsPageViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();

        await vm.RevokeAsync("victim");

        Assert.Equal(1, feed.RevokeCount);
        Assert.Equal(1, feed.FetchCount); // no reload on failure — the row stays so the user can retry
        Assert.Equal(ActiveSessionsState.Populated, vm.State);
    }

    [Fact]
    public async Task ViewModel_revoke_all_others_calls_the_feed_and_reloads()
    {
        var feed = new FakeSessionsFeed(new ActiveSessionsSnapshot(
            SessionsMode.Session, [Session(id: "me", current: true), Session(id: "other")]))
        {
            RevokedReturn = 1,
        };
        using var vm = new ActiveSessionsPageViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();

        await vm.RevokeAllOthersAsync();

        Assert.Equal(1, feed.RevokeAllCount);
        Assert.Equal(2, feed.FetchCount);
        Assert.False(vm.Display.AllOthersBusy);
    }

    // ---- Generated-client feed (web useSessions + the two DELETEs) -----------------

    [Fact]
    public async Task ClientFeed_sends_the_list_operation()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"mode\":\"session\",\"sessions\":[{\"id\":\"1\",\"user_agent\":\"UA\"}]}"));
        var feed = new ActiveSessionsClientFeed(api);

        var snapshot = await feed.FetchAsync(default);

        Assert.Equal(SessionsMode.Session, snapshot.Mode);
        Assert.Equal("1", Assert.Single(snapshot.Sessions).Id);
        Assert.Equal("get_api_v1_auth_sessions", Assert.Single(api.Requests).OperationId);
    }

    [Fact]
    public async Task ClientFeed_maps_auth_mode_open_to_the_open_snapshot()
    {
        var api = new FakeApiClient();
        api.Throws(new ApiException("session tracking unavailable", 501, errorCode: "AUTH_MODE_OPEN"));
        var feed = new ActiveSessionsClientFeed(api);

        var snapshot = await feed.FetchAsync(default);

        Assert.Equal(SessionsMode.Open, snapshot.Mode);
    }

    [Fact]
    public async Task ClientFeed_propagates_a_genuine_list_failure()
    {
        var api = new FakeApiClient();
        api.Throws(new ApiException("boom", 500));
        var feed = new ActiveSessionsClientFeed(api);

        await Assert.ThrowsAsync<ApiException>(() => feed.FetchAsync(default));
    }

    [Fact]
    public async Task ClientFeed_revoke_sends_the_id_path_parameter()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{}"));
        var feed = new ActiveSessionsClientFeed(api);

        await feed.RevokeAsync("session-9", default);

        var request = Assert.Single(api.Requests);
        Assert.Equal("delete_api_v1_auth_sessions_id", request.OperationId);
        Assert.NotNull(request.PathParams);
        Assert.Equal("session-9", request.PathParams!["id"]);
    }

    [Fact]
    public async Task ClientFeed_revoke_all_others_returns_the_revoked_count()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"mode\":\"session\",\"revoked\":3}"));
        var feed = new ActiveSessionsClientFeed(api);

        var revoked = await feed.RevokeAllOthersAsync(default);

        Assert.Equal(3, revoked);
        Assert.Equal("delete_api_v1_auth_sessions_all_others", Assert.Single(api.Requests).OperationId);
    }

    // ---- Registration + diagnostics ------------------------------------------------

    [Fact]
    public void Registration_exposes_route_and_operations()
    {
        Assert.Equal("ActiveSessions", ActiveSessionsRegistration.RouteName);
        Assert.Equal("ActiveSessionsPage", ActiveSessionsRegistration.Slug);
        Assert.Equal("get_api_v1_auth_sessions", ActiveSessionsRegistration.ListOperation);
        Assert.Equal("delete_api_v1_auth_sessions_id", ActiveSessionsRegistration.RevokeOperation);
        Assert.Equal("delete_api_v1_auth_sessions_all_others", ActiveSessionsRegistration.RevokeAllOthersOperation);
        Assert.Equal("AUTH_MODE_OPEN", ActiveSessionsRegistration.AuthModeOpenCode);
    }

    [Fact]
    public void Diagnostics_record_only_view_opened()
    {
        var lines = new List<string>();
        var diagnostics = new ActiveSessionsDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=ActiveSessionsPage", Assert.Single(lines));
    }

    private static JsonElement Json(string raw)
    {
        using var doc = JsonDocument.Parse(raw);
        return doc.RootElement.Clone();
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = [];

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }

    private sealed class FakeSessionsFeed : IActiveSessionsFeed
    {
        private readonly ActiveSessionsSnapshot _snapshot;

        public FakeSessionsFeed(ActiveSessionsSnapshot snapshot) => _snapshot = snapshot;

        public int FetchCount { get; private set; }

        public int RevokeCount { get; private set; }

        public int RevokeAllCount { get; private set; }

        public string? LastRevokedId { get; private set; }

        public int RevokedReturn { get; set; }

        public bool RevokeThrows { get; set; }

        public Task<ActiveSessionsSnapshot> FetchAsync(CancellationToken cancellationToken)
        {
            FetchCount++;
            return Task.FromResult(_snapshot);
        }

        public Task RevokeAsync(string id, CancellationToken cancellationToken)
        {
            RevokeCount++;
            LastRevokedId = id;
            if (RevokeThrows)
            {
                throw new InvalidOperationException("revoke failed");
            }

            return Task.CompletedTask;
        }

        public Task<int> RevokeAllOthersAsync(CancellationToken cancellationToken)
        {
            RevokeAllCount++;
            return Task.FromResult(RevokedReturn);
        }
    }

    private sealed class ThrowingSessionsFeed : IActiveSessionsFeed
    {
        public Task<ActiveSessionsSnapshot> FetchAsync(CancellationToken cancellationToken) =>
            throw new InvalidOperationException("Failed to load active sessions.");

        public Task RevokeAsync(string id, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("revoke failed");

        public Task<int> RevokeAllOthersAsync(CancellationToken cancellationToken) =>
            throw new InvalidOperationException("all-others failed");
    }
}
