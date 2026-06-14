using System;
using System.Linq;
using System.Net.Http;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Admin;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the admin <c>UsersPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/admin/pages/UsersPage.tsx), the tolerant candidates parser (the <c>{ mode, candidates }</c>
/// object, the platform <c>{ data: [...] }</c> envelope, a bare array and the <c>mode: 'open'</c> signal), the
/// view-model's five render branches (open-mode / loading / error / empty / populated) composed from the status query
/// (web <c>useImpersonationStatus</c>, with the candidates query disabled while open — web <c>enabled: !open</c>) and
/// the candidates query (web <c>useImpersonationCandidates</c>), and the generated-client feed's request shaping (the
/// two GETs, with the 501 <c>AUTH_MODE_OPEN</c> mapped to the open signal). The WinUI view is exercised by the app
/// build; its per-region visibility is driven entirely by the <see cref="UsersDisplay"/> flags asserted here.
/// </summary>
public sealed class UsersPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // The 5 i18n keys the manifest (page:admin/Users) requires the page to resolve.
    private static readonly string[] ManifestStringKeys =
    [
        "impersonation.users.emptyMessage",
        "impersonation.users.emptyTitle",
        "impersonation.users.openMode",
        "impersonation.users.subtitle",
        "impersonation.users.title",
    ];

    private static ImpersonationCandidate Candidate(string subject = "subject-1") => new(subject);

    private static UsersModel Model(
        UsersImpersonationStatus? status = UsersImpersonationStatus.Inactive,
        ImpersonationSubjectsMode? candidatesMode = ImpersonationSubjectsMode.Session,
        System.Collections.Generic.IReadOnlyList<ImpersonationCandidate>? candidates = null,
        bool loading = false,
        bool hasError = false,
        string? errorDetail = null) =>
        new(status, candidatesMode, candidates ?? [Candidate()], loading, hasError, errorDetail);

    // ---- i18n key coverage ---------------------------------------------------------

    [Fact]
    public void Projection_resolves_the_five_manifest_string_keys_in_one_pass()
    {
        var recorder = new RecordingLocalizer();

        // Every visible literal resolves on every projection regardless of state; visibility is gated separately.
        _ = UsersProjection.Project(UsersModel.Initial, recorder);

        foreach (var key in ManifestStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Registration_exposes_the_manifest_string_defaults()
    {
        Assert.Equal("Subjects", UsersPageRegistration.Title(Localizer));
        Assert.Equal(
            "Active subjects you can impersonate for support. Sessions are limited to 15 minutes and recorded in the audit log.",
            UsersPageRegistration.Subtitle(Localizer));
        Assert.Equal(
            "Impersonation requires forward-auth mode. This install is in open mode, so per-user identity is not available.",
            UsersPageRegistration.OpenModeText(Localizer));
        Assert.Equal("No other subjects", UsersPageRegistration.EmptyTitle(Localizer));
        Assert.Equal(
            "No other subjects have an active session right now. Sign someone else in to enable impersonation.",
            UsersPageRegistration.EmptyMessage(Localizer));
    }

    // ---- Five render branches ------------------------------------------------------

    [Fact]
    public void State_loading_when_first_query_in_flight()
    {
        var display = UsersProjection.Project(UsersModel.Initial, Localizer);

        Assert.Equal(UsersPageState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowOpenMode);
        Assert.False(display.ShowError);
        Assert.False(display.ShowEmpty);
        Assert.False(display.ShowList);
        Assert.Equal("Loading subjects\u2026", display.LoadingText);
    }

    [Fact]
    public void State_open_mode_takes_precedence_over_loading()
    {
        // web: open ? OpenMode — even while a status read is notionally in flight, open suppresses everything else.
        var display = UsersProjection.Project(
            Model(status: UsersImpersonationStatus.Open, candidatesMode: null, candidates: [], loading: true),
            Localizer);

        Assert.Equal(UsersPageState.OpenMode, display.State);
        Assert.True(display.ShowOpenMode);
        Assert.False(display.ShowLoading);
        Assert.Contains("forward-auth", display.OpenModeText, StringComparison.Ordinal);
    }

    [Fact]
    public void State_error_shows_failure_and_retry()
    {
        var display = UsersProjection.Project(
            Model(candidatesMode: null, candidates: [], hasError: true, errorDetail: "network down"),
            Localizer);

        Assert.Equal(UsersPageState.Error, display.State);
        Assert.True(display.ShowError);
        Assert.Equal("Failed to load subjects. network down", display.ErrorText);
        Assert.Equal("Retry", display.RetryLabel);
    }

    [Fact]
    public void State_empty_when_no_other_subjects()
    {
        var display = UsersProjection.Project(Model(candidates: []), Localizer);

        Assert.Equal(UsersPageState.Empty, display.State);
        Assert.True(display.ShowEmpty);
        Assert.False(display.ShowList);
        Assert.Equal("No other subjects", display.EmptyTitle);
        Assert.Equal(
            "No other subjects have an active session right now. Sign someone else in to enable impersonation.",
            display.EmptyMessage);
    }

    [Fact]
    public void State_populated_when_subjects_present()
    {
        var display = UsersProjection.Project(Model(candidates: [Candidate("a"), Candidate("b")]), Localizer);

        Assert.Equal(UsersPageState.Populated, display.State);
        Assert.True(display.ShowList);
        Assert.False(display.ShowEmpty);
        Assert.Equal(2, display.Rows.Count);
        Assert.Equal("a", display.Rows[0].Subject);
    }

    [Fact]
    public void Open_candidates_mode_is_treated_as_no_subjects()
    {
        // web: subjects = candidates.data?.mode === 'session' ? candidates.data.candidates : [] -> open -> empty.
        var display = UsersProjection.Project(
            Model(candidatesMode: ImpersonationSubjectsMode.Open, candidates: []),
            Localizer);

        Assert.Equal(UsersPageState.Empty, display.State);
    }

    // ---- Row affordance (web <UserImpersonateButton subject disabled={active} />) ---

    [Fact]
    public void Rows_are_enabled_when_no_session_is_active()
    {
        var display = UsersProjection.Project(
            Model(status: UsersImpersonationStatus.Inactive, candidates: [Candidate("u1")]),
            Localizer);

        var row = Assert.Single(display.Rows);
        Assert.Equal("u1", row.Subject);
        Assert.False(row.ImpersonateDisabled);
    }

    [Fact]
    public void Rows_are_disabled_while_an_impersonation_session_is_active()
    {
        var display = UsersProjection.Project(
            Model(status: UsersImpersonationStatus.Active, candidates: [Candidate("u1"), Candidate("u2")]),
            Localizer);

        Assert.Equal(UsersPageState.Populated, display.State);
        Assert.All(display.Rows, r => Assert.True(r.ImpersonateDisabled));
    }

    // ---- Tolerant candidates parsing -----------------------------------------------

    [Fact]
    public void Snapshot_parses_the_mode_session_envelope()
    {
        using var doc = JsonDocument.Parse("{\"mode\":\"session\",\"candidates\":[{\"subject\":\"alice\"},{\"subject\":\"bob\"}]}");

        var snapshot = ImpersonationCandidatesSnapshot.FromJson(doc.RootElement);

        Assert.Equal(ImpersonationSubjectsMode.Session, snapshot.Mode);
        Assert.Equal(2, snapshot.Candidates.Count);
        Assert.Equal("alice", snapshot.Candidates[0].Subject);
    }

    [Fact]
    public void Snapshot_maps_mode_open_to_the_open_signal()
    {
        using var doc = JsonDocument.Parse("{\"mode\":\"open\"}");

        var snapshot = ImpersonationCandidatesSnapshot.FromJson(doc.RootElement);

        Assert.Equal(ImpersonationSubjectsMode.Open, snapshot.Mode);
        Assert.Empty(snapshot.Candidates);
    }

    [Fact]
    public void Snapshot_unwraps_the_data_envelope_and_a_bare_array()
    {
        using var enveloped = JsonDocument.Parse("{\"data\":[{\"subject\":\"c1\"}]}");
        using var bare = JsonDocument.Parse("[{\"subject\":\"c2\"}]");

        var fromEnvelope = ImpersonationCandidatesSnapshot.FromJson(enveloped.RootElement);
        var fromBare = ImpersonationCandidatesSnapshot.FromJson(bare.RootElement);

        Assert.Equal("c1", Assert.Single(fromEnvelope.Candidates).Subject);
        Assert.Equal("c2", Assert.Single(fromBare.Candidates).Subject);
    }

    [Fact]
    public void Candidate_parse_tolerates_a_missing_subject()
    {
        using var doc = JsonDocument.Parse("{}");

        Assert.Equal(string.Empty, ImpersonationCandidate.FromJson(doc.RootElement).Subject);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_open_status_shows_open_mode_and_skips_candidates()
    {
        var feed = new FakeSubjectsFeed(UsersImpersonationStatus.Open);
        using var vm = new UsersPageViewModel(feed, Localizer);

        await vm.LoadAsync();

        Assert.Equal(UsersPageState.OpenMode, vm.State);
        Assert.True(vm.Display.ShowOpenMode);
        Assert.Equal(1, feed.StatusFetchCount);
        Assert.Equal(0, feed.CandidatesFetchCount); // web enabled:!open — candidates never queried while open
    }

    [Fact]
    public async Task ViewModel_empty_candidates_is_the_empty_state()
    {
        var feed = new FakeSubjectsFeed(UsersImpersonationStatus.Inactive, ImpersonationCandidatesSnapshot.EmptySession);
        using var vm = new UsersPageViewModel(feed, Localizer);

        await vm.LoadAsync();

        Assert.Equal(UsersPageState.Empty, vm.State);
        Assert.True(vm.Display.ShowEmpty);
        Assert.Equal(1, feed.CandidatesFetchCount);
    }

    [Fact]
    public async Task ViewModel_loads_subjects_into_the_populated_state()
    {
        var feed = new FakeSubjectsFeed(
            UsersImpersonationStatus.Inactive,
            new ImpersonationCandidatesSnapshot(ImpersonationSubjectsMode.Session, [Candidate("alice")]));
        using var vm = new UsersPageViewModel(feed, Localizer);

        await vm.LoadAsync();

        Assert.Equal(UsersPageState.Populated, vm.State);
        Assert.True(vm.Display.ShowList);
        Assert.Equal("alice", Assert.Single(vm.Display.Rows).Subject);
        Assert.False(vm.IsFetching);
    }

    [Fact]
    public async Task ViewModel_active_status_disables_the_row_actions()
    {
        var feed = new FakeSubjectsFeed(
            UsersImpersonationStatus.Active,
            new ImpersonationCandidatesSnapshot(ImpersonationSubjectsMode.Session, [Candidate("alice")]));
        using var vm = new UsersPageViewModel(feed, Localizer);

        await vm.LoadAsync();

        Assert.Equal(UsersPageState.Populated, vm.State);
        Assert.True(Assert.Single(vm.Display.Rows).ImpersonateDisabled);
    }

    [Fact]
    public async Task ViewModel_candidates_failure_is_the_error_state()
    {
        var feed = new FakeSubjectsFeed(UsersImpersonationStatus.Inactive, candidatesThrow: true);
        using var vm = new UsersPageViewModel(feed, Localizer);

        await vm.LoadAsync();

        Assert.Equal(UsersPageState.Error, vm.State);
        Assert.True(vm.Display.ShowError);
        Assert.Contains("Failed to load subjects.", vm.Display.ErrorText, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ViewModel_status_failure_falls_back_to_inactive_and_queries_candidates()
    {
        // web parity: a status query error leaves open/active false, so the candidates query still runs.
        var feed = new FakeSubjectsFeed(
            UsersImpersonationStatus.Inactive,
            new ImpersonationCandidatesSnapshot(ImpersonationSubjectsMode.Session, [Candidate("alice")]))
        {
            StatusThrows = true,
        };
        using var vm = new UsersPageViewModel(feed, Localizer);

        await vm.LoadAsync();

        Assert.Equal(1, feed.CandidatesFetchCount);
        Assert.Equal(UsersPageState.Populated, vm.State);
    }

    // ---- Generated-client feed (web useImpersonationStatus + useImpersonationCandidates) ----

    [Fact]
    public async Task ClientFeed_status_sends_the_status_operation_and_maps_active()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"mode\":\"active\",\"target\":\"alice\"}"));
        var feed = new ImpersonationSubjectsClientFeed(api);

        var status = await feed.FetchStatusAsync(default);

        Assert.Equal(UsersImpersonationStatus.Active, status);
        Assert.Equal("get_api_v1_admin_impersonate", Assert.Single(api.Requests).OperationId);
    }

    [Fact]
    public async Task ClientFeed_status_maps_inactive()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"mode\":\"inactive\"}"));
        var feed = new ImpersonationSubjectsClientFeed(api);

        Assert.Equal(UsersImpersonationStatus.Inactive, await feed.FetchStatusAsync(default));
    }

    [Fact]
    public async Task ClientFeed_status_maps_auth_mode_open()
    {
        var api = new FakeApiClient();
        api.Throws(new ApiException("forward-auth disabled", 501, errorCode: "AUTH_MODE_OPEN"));
        var feed = new ImpersonationSubjectsClientFeed(api);

        Assert.Equal(UsersImpersonationStatus.Open, await feed.FetchStatusAsync(default));
    }

    [Fact]
    public async Task ClientFeed_status_transport_fault_falls_back_to_inactive()
    {
        var apiServer = new FakeApiClient();
        apiServer.Throws(new ApiException("boom", 500));
        Assert.Equal(UsersImpersonationStatus.Inactive, await new ImpersonationSubjectsClientFeed(apiServer).FetchStatusAsync(default));

        var apiNetwork = new FakeApiClient();
        apiNetwork.Throws(new HttpRequestException("down"));
        Assert.Equal(UsersImpersonationStatus.Inactive, await new ImpersonationSubjectsClientFeed(apiNetwork).FetchStatusAsync(default));
    }

    [Fact]
    public async Task ClientFeed_candidates_sends_the_candidates_operation()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"mode\":\"session\",\"candidates\":[{\"subject\":\"alice\"}]}"));
        var feed = new ImpersonationSubjectsClientFeed(api);

        var snapshot = await feed.FetchCandidatesAsync(default);

        Assert.Equal(ImpersonationSubjectsMode.Session, snapshot.Mode);
        Assert.Equal("alice", Assert.Single(snapshot.Candidates).Subject);
        Assert.Equal("get_api_v1_admin_impersonate_candidates", Assert.Single(api.Requests).OperationId);
    }

    [Fact]
    public async Task ClientFeed_candidates_maps_auth_mode_open_to_the_open_snapshot()
    {
        var api = new FakeApiClient();
        api.Throws(new ApiException("forward-auth disabled", 501, errorCode: "AUTH_MODE_OPEN"));
        var feed = new ImpersonationSubjectsClientFeed(api);

        Assert.Equal(ImpersonationSubjectsMode.Open, (await feed.FetchCandidatesAsync(default)).Mode);
    }

    [Fact]
    public async Task ClientFeed_candidates_propagates_a_genuine_failure()
    {
        var api = new FakeApiClient();
        api.Throws(new ApiException("boom", 500));
        var feed = new ImpersonationSubjectsClientFeed(api);

        await Assert.ThrowsAsync<ApiException>(() => feed.FetchCandidatesAsync(default));
    }

    // ---- Registration + diagnostics ------------------------------------------------

    [Fact]
    public void Registration_exposes_route_and_operations()
    {
        Assert.Equal("Users", UsersPageRegistration.RouteName);
        Assert.Equal("UsersPage", UsersPageRegistration.Slug);
        Assert.Equal("get_api_v1_admin_impersonate", UsersPageRegistration.StatusOperation);
        Assert.Equal("get_api_v1_admin_impersonate_candidates", UsersPageRegistration.CandidatesOperation);
        Assert.Equal("AUTH_MODE_OPEN", UsersPageRegistration.AuthModeOpenCode);
    }

    [Fact]
    public void Diagnostics_record_only_view_opened()
    {
        var lines = new System.Collections.Generic.List<string>();
        var diagnostics = new UsersPageDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=UsersPage", Assert.Single(lines));
    }

    private static JsonElement Json(string raw)
    {
        using var doc = JsonDocument.Parse(raw);
        return doc.RootElement.Clone();
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public System.Collections.Generic.List<string> Keys { get; } = [];

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }

    private sealed class FakeSubjectsFeed : IImpersonationSubjectsFeed
    {
        private readonly UsersImpersonationStatus _status;
        private readonly ImpersonationCandidatesSnapshot? _candidates;
        private readonly bool _candidatesThrow;

        public FakeSubjectsFeed(
            UsersImpersonationStatus status,
            ImpersonationCandidatesSnapshot? candidates = null,
            bool candidatesThrow = false)
        {
            _status = status;
            _candidates = candidates;
            _candidatesThrow = candidatesThrow;
        }

        public int StatusFetchCount { get; private set; }

        public int CandidatesFetchCount { get; private set; }

        public bool StatusThrows { get; init; }

        public Task<UsersImpersonationStatus> FetchStatusAsync(CancellationToken cancellationToken)
        {
            StatusFetchCount++;
            if (StatusThrows)
            {
                throw new InvalidOperationException("status failed");
            }

            return Task.FromResult(_status);
        }

        public Task<ImpersonationCandidatesSnapshot> FetchCandidatesAsync(CancellationToken cancellationToken)
        {
            CandidatesFetchCount++;
            if (_candidatesThrow)
            {
                throw new InvalidOperationException("candidates failed");
            }

            return Task.FromResult(_candidates ?? ImpersonationCandidatesSnapshot.EmptySession);
        }
    }
}
