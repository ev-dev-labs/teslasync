using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.ModalsDialogs;
using Xunit;

namespace TeslaSync.App.Tests.ModalsDialogs;

/// <summary>
/// Headless verification of the reauth dialog's UI-thread-free logic — the challenge queue, the
/// TOTP-status cached→projection adapter, the auth-mode / credential parsers, and the view-model's mode
/// resolution, tab-availability matrix, submit routing, error mapping and cancel behaviour. Mirrors the web
/// spec one-for-one (web/src/components/feedback/ReauthDialog.tsx). The WinUI parts (ReauthDialog.cs) are
/// exercised by the app build.
/// </summary>
public sealed class ReauthDialogTests
{
    // ── Challenge queue (web module queue + useReauthDialogState) ─────────────────────────────────────

    [Fact]
    public void Queue_starts_idle()
    {
        var queue = new ReauthChallengeBroker();

        Assert.Null(queue.Active);
        Assert.Equal(0, queue.Total);
    }

    [Fact]
    public void Enqueue_activates_first_challenge_and_queues_the_rest()
    {
        var queue = new ReauthChallengeBroker();

        _ = queue.EnqueueAsync("/a");
        _ = queue.EnqueueAsync("/b");

        Assert.NotNull(queue.Active);
        Assert.Equal("/a", queue.Active!.Path);
        Assert.Equal(2, queue.Total);
    }

    [Fact]
    public async Task ResolveActive_completes_the_active_task_and_advances()
    {
        var queue = new ReauthChallengeBroker();
        var first = queue.EnqueueAsync("/a");
        _ = queue.EnqueueAsync("/b");

        var credential = new SudoCredential(SudoCredentialMode.Session, "tok", "2026-01-01T00:00:00Z");
        queue.ResolveActive(credential);

        Assert.Equal(credential, await first);
        Assert.Equal("/b", queue.Active!.Path);
        Assert.Equal(1, queue.Total);
    }

    [Fact]
    public async Task RejectActive_faults_with_cancellation_and_advances()
    {
        var queue = new ReauthChallengeBroker();
        var first = queue.EnqueueAsync("/a");

        queue.RejectActive(new SudoCanceledException());

        await Assert.ThrowsAsync<SudoCanceledException>(() => first);
        Assert.Null(queue.Active);
    }

    [Fact]
    public void Changed_is_raised_on_enqueue_and_resolve()
    {
        var queue = new ReauthChallengeBroker();
        int changes = 0;
        queue.Changed += (_, _) => changes++;

        _ = queue.EnqueueAsync("/a");
        queue.ResolveActive(SudoCredential.OpenMode);

        Assert.Equal(2, changes);
    }

    [Fact]
    public async Task Reset_drains_active_and_queued_challenges()
    {
        var queue = new ReauthChallengeBroker();
        var first = queue.EnqueueAsync("/a");
        var second = queue.EnqueueAsync("/b");

        queue.Reset();

        await Assert.ThrowsAsync<SudoCanceledException>(() => first);
        await Assert.ThrowsAsync<SudoCanceledException>(() => second);
        Assert.Null(queue.Active);
        Assert.Equal(0, queue.Total);
    }

    // ── TOTP status snapshot parsing (web TOTPStatus union) ───────────────────────────────────────────

    [Theory]
    [InlineData("{\"mode\":\"session\",\"activated\":true}", "session", true, true, false)]
    [InlineData("{\"mode\":\"session\",\"activated\":false}", "session", false, false, false)]
    [InlineData("{\"mode\":\"open\"}", "open", false, false, true)]
    public void TotpStatusSnapshot_parses_mode_and_activation(
        string json, string mode, bool activated, bool enrolled, bool openMode)
    {
        var snapshot = TotpStatusSnapshot.FromJson(JsonDocument.Parse(json).RootElement);

        Assert.Equal(mode, snapshot.Mode);
        Assert.Equal(activated, snapshot.Activated);
        Assert.Equal(enrolled, snapshot.IsEnrolled);
        Assert.Equal(openMode, snapshot.IsOpenMode);
    }

    [Fact]
    public void TotpStatusSnapshot_tolerates_non_object_payloads()
    {
        var snapshot = TotpStatusSnapshot.FromJson(JsonDocument.Parse("\"nope\"").RootElement);

        Assert.Null(snapshot.Mode);
        Assert.False(snapshot.Activated);
        Assert.False(snapshot.IsEnrolled);
    }

    // ── TOTP status cached → projection adapter (web useTOTPStatus result) ────────────────────────────

    [Fact]
    public void Mapper_preserves_cached_status_and_projects_payload()
    {
        var fetchedAt = DateTimeOffset.UnixEpoch;
        var raw = RepositoryResult<JsonElement>.Cached(
            JsonDocument.Parse("{\"mode\":\"session\",\"activated\":true}").RootElement, fetchedAt, stale: true);

        var mapped = TotpStatusResultMapper.Map(raw);

        Assert.Equal(LoadStatus.Cached, mapped.Status);
        Assert.True(mapped.IsStale);
        Assert.Equal(fetchedAt, mapped.FetchedAt);
        Assert.NotNull(mapped.Value);
        Assert.True(mapped.Value!.IsEnrolled);
    }

    [Fact]
    public void Mapper_preserves_loading_and_failure_states()
    {
        Assert.Equal(LoadStatus.Loading, TotpStatusResultMapper.Map(RepositoryResult<JsonElement>.Loading()).Status);

        var error = new RepositoryError(RepositoryErrorKind.Server, "boom");
        var failure = TotpStatusResultMapper.Map(RepositoryResult<JsonElement>.Failure(error));
        Assert.Equal(LoadStatus.Error, failure.Status);
        Assert.Equal(error, failure.Error);
    }

    [Fact]
    public void Mapper_preserves_offline_cached_value()
    {
        var error = new RepositoryError(RepositoryErrorKind.Offline, "offline");
        var raw = RepositoryResult<JsonElement>.OfflineCached(
            JsonDocument.Parse("{\"mode\":\"session\",\"activated\":false}").RootElement, DateTimeOffset.UnixEpoch, error);

        var mapped = TotpStatusResultMapper.Map(raw);

        Assert.Equal(LoadStatus.Offline, mapped.Status);
        Assert.NotNull(mapped.Value);
        Assert.Equal("session", mapped.Value!.Mode);
    }

    // ── Auth-mode + credential parsing (web useSessionMonitor / submitter) ────────────────────────────

    [Theory]
    [InlineData("{\"mode\":\"open\"}", SessionAuthMode.Open)]
    [InlineData("{\"mode\":\"session\"}", SessionAuthMode.ForwardAuth)]
    [InlineData("{\"auth_mode\":\"open\"}", SessionAuthMode.Open)]
    [InlineData("{\"other\":1}", SessionAuthMode.Unknown)]
    public void ParseMode_maps_deployment_auth_mode(string json, SessionAuthMode expected) =>
        Assert.Equal(expected, SessionAuthModeSource.ParseMode(JsonDocument.Parse(json).RootElement));

    [Fact]
    public void ParseCredential_reads_snake_case_token_and_session_mode()
    {
        var element = JsonDocument.Parse("{\"mode\":\"session\",\"sudo_token\":\"abc\",\"expires_at\":\"2026-01-01T00:00:00Z\"}").RootElement;

        var credential = ReauthSubmitter.ParseCredential(element, forceSession: false);

        Assert.Equal(SudoCredentialMode.Session, credential.Mode);
        Assert.Equal("abc", credential.Token);
        Assert.Equal("2026-01-01T00:00:00Z", credential.ExpiresAt);
    }

    [Fact]
    public void ParseCredential_tolerates_camel_case_aliases_and_open_mode()
    {
        var element = JsonDocument.Parse("{\"mode\":\"open\",\"token\":\"xyz\",\"expiresAt\":\"later\"}").RootElement;

        var credential = ReauthSubmitter.ParseCredential(element, forceSession: false);

        Assert.Equal(SudoCredentialMode.Open, credential.Mode);
        Assert.Equal("xyz", credential.Token);
        Assert.Equal("later", credential.ExpiresAt);
    }

    [Fact]
    public void ParseCredential_forces_session_mode_for_per_user_totp()
    {
        var element = JsonDocument.Parse("{\"mode\":\"open\",\"sudo_token\":\"t\"}").RootElement;

        var credential = ReauthSubmitter.ParseCredential(element, forceSession: true);

        Assert.Equal(SudoCredentialMode.Session, credential.Mode);
    }

    // ── View-model: mode resolution (web monitor.mode → DialogMode) ───────────────────────────────────

    [Fact]
    public async Task ViewModel_resolves_confirm_mode_in_open_install()
    {
        using var harness = Harness.Open(SessionAuthMode.Open);
        _ = harness.Enqueue();
        await harness.ViewModel.InitializationTask;

        Assert.True(harness.ViewModel.IsOpen);
        Assert.Equal(ReauthDialogMode.Confirm, harness.ViewModel.Mode);
        Assert.True(harness.ViewModel.IsConfirmMode);
    }

    [Fact]
    public async Task ViewModel_resolves_credential_mode_in_forward_auth_install()
    {
        using var harness = Harness.Open(SessionAuthMode.ForwardAuth);
        _ = harness.Enqueue();
        await harness.ViewModel.InitializationTask;

        Assert.Equal(ReauthDialogMode.Credential, harness.ViewModel.Mode);
        Assert.True(harness.ViewModel.IsCredentialMode);
    }

    // ── View-model: totpTabAvailable matrix (web derivation) ──────────────────────────────────────────

    [Fact]
    public async Task TotpTab_is_shown_while_status_is_loading()
    {
        using var harness = Harness.Open(SessionAuthMode.ForwardAuth, RepositoryResult<TotpStatusSnapshot>.Loading());
        _ = harness.Enqueue();
        await harness.ViewModel.InitializationTask;

        Assert.True(harness.ViewModel.TotpTabAvailable);
    }

    [Fact]
    public async Task TotpTab_is_shown_on_status_error()
    {
        using var harness = Harness.Open(
            SessionAuthMode.ForwardAuth,
            RepositoryResult<TotpStatusSnapshot>.Failure(new RepositoryError(RepositoryErrorKind.Server, "x")));
        _ = harness.Enqueue();
        await harness.ViewModel.InitializationTask;

        Assert.True(harness.ViewModel.TotpTabAvailable);
    }

    [Fact]
    public async Task TotpTab_is_shown_when_enrolled()
    {
        using var harness = Harness.Open(
            SessionAuthMode.ForwardAuth,
            RepositoryResult<TotpStatusSnapshot>.Loaded(new TotpStatusSnapshot("session", true), DateTimeOffset.UnixEpoch));
        _ = harness.Enqueue();
        await harness.ViewModel.InitializationTask;

        Assert.True(harness.ViewModel.TotpTabAvailable);
        Assert.True(harness.ViewModel.TotpEnrolled);
    }

    [Fact]
    public async Task TotpTab_is_shown_when_session_but_not_activated()
    {
        using var harness = Harness.Open(
            SessionAuthMode.ForwardAuth,
            RepositoryResult<TotpStatusSnapshot>.Loaded(new TotpStatusSnapshot("session", false), DateTimeOffset.UnixEpoch));
        _ = harness.Enqueue();
        await harness.ViewModel.InitializationTask;

        Assert.True(harness.ViewModel.TotpTabAvailable);
        Assert.False(harness.ViewModel.TotpEnrolled);
    }

    [Fact]
    public async Task TotpTab_is_hidden_in_open_mode_status()
    {
        using var harness = Harness.Open(
            SessionAuthMode.ForwardAuth,
            RepositoryResult<TotpStatusSnapshot>.Loaded(TotpStatusSnapshot.OpenMode, DateTimeOffset.UnixEpoch));
        _ = harness.Enqueue();
        await harness.ViewModel.InitializationTask;

        Assert.False(harness.ViewModel.TotpTabAvailable);
    }

    [Fact]
    public async Task SetActiveTab_ignores_totp_when_unavailable()
    {
        using var harness = Harness.Open(
            SessionAuthMode.ForwardAuth,
            RepositoryResult<TotpStatusSnapshot>.Loaded(TotpStatusSnapshot.OpenMode, DateTimeOffset.UnixEpoch));
        _ = harness.Enqueue();
        await harness.ViewModel.InitializationTask;

        harness.ViewModel.SetActiveTab(ReauthTab.Totp);

        Assert.Equal(ReauthTab.Password, harness.ViewModel.ActiveTab);
    }

    // ── View-model: confirm-mode submit (web open-mode resolve) ───────────────────────────────────────

    [Fact]
    public async Task Confirm_submit_with_wrong_token_sets_mismatch_error()
    {
        using var harness = Harness.Open(SessionAuthMode.Open);
        var pending = harness.Enqueue();
        await harness.ViewModel.InitializationTask;

        harness.ViewModel.ConfirmText = "nope";
        await harness.ViewModel.SubmitAsync();

        Assert.True(harness.ViewModel.HasError);
        Assert.Contains("CONFIRM", harness.ViewModel.ErrorMessage, StringComparison.Ordinal);
        Assert.False(pending.IsCompleted);
    }

    [Fact]
    public async Task Confirm_submit_with_correct_token_resolves_open_credential()
    {
        using var harness = Harness.Open(SessionAuthMode.Open);
        var pending = harness.Enqueue();
        await harness.ViewModel.InitializationTask;

        harness.ViewModel.ConfirmText = "CONFIRM";
        await harness.ViewModel.SubmitAsync();

        var credential = await pending;
        Assert.Equal(SudoCredentialMode.Open, credential.Mode);
        Assert.False(harness.ViewModel.IsOpen);
    }

    // ── View-model: credential submit (web defaultSubmitCredential routing + errors) ──────────────────

    [Fact]
    public async Task Password_submit_empty_field_requires_password()
    {
        using var harness = Harness.Open(SessionAuthMode.ForwardAuth);
        _ = harness.Enqueue();
        await harness.ViewModel.InitializationTask;

        await harness.ViewModel.SubmitAsync();

        Assert.Equal(ReauthDialogStrings.PasswordRequiredFallback, harness.ViewModel.ErrorMessage);
        Assert.False(harness.Submitter.WasCalled);
    }

    [Fact]
    public async Task Password_submit_success_resolves_credential()
    {
        var credential = new SudoCredential(SudoCredentialMode.Session, "tok", "exp");
        using var harness = Harness.Open(SessionAuthMode.ForwardAuth);
        harness.Submitter.Outcome = ReauthSubmitOutcome.Ok(credential);
        var pending = harness.Enqueue();
        await harness.ViewModel.InitializationTask;

        harness.ViewModel.Password = "hunter2";
        await harness.ViewModel.SubmitAsync();

        Assert.Equal(credential, await pending);
        Assert.Equal("hunter2", harness.Submitter.LastBody!.Password);
        Assert.False(harness.ViewModel.IsSubmitting);
    }

    [Fact]
    public async Task Password_submit_invalid_credential_shows_password_error()
    {
        using var harness = Harness.Open(SessionAuthMode.ForwardAuth);
        harness.Submitter.Outcome = ReauthSubmitOutcome.Fail(ReauthDialogStrings.InvalidCredentialCode, "bad");
        _ = harness.Enqueue();
        await harness.ViewModel.InitializationTask;

        harness.ViewModel.Password = "wrong";
        await harness.ViewModel.SubmitAsync();

        Assert.Equal(ReauthDialogStrings.InvalidPasswordFallback, harness.ViewModel.ErrorMessage);
        Assert.True(harness.ViewModel.IsOpen);
    }

    [Fact]
    public async Task Submit_not_configured_shows_admin_hint()
    {
        using var harness = Harness.Open(SessionAuthMode.ForwardAuth);
        harness.Submitter.Outcome = ReauthSubmitOutcome.Fail(ReauthDialogStrings.ReauthNotConfiguredCode, "nope");
        _ = harness.Enqueue();
        await harness.ViewModel.InitializationTask;

        harness.ViewModel.Password = "x";
        await harness.ViewModel.SubmitAsync();

        Assert.Equal(ReauthDialogStrings.NotConfiguredFallback, harness.ViewModel.ErrorMessage);
    }

    [Fact]
    public async Task Totp_submit_empty_field_requires_code()
    {
        using var harness = Harness.Open(
            SessionAuthMode.ForwardAuth,
            RepositoryResult<TotpStatusSnapshot>.Loaded(new TotpStatusSnapshot("session", true), DateTimeOffset.UnixEpoch));
        _ = harness.Enqueue();
        await harness.ViewModel.InitializationTask;

        harness.ViewModel.SetActiveTab(ReauthTab.Totp);
        await harness.ViewModel.SubmitAsync();

        Assert.Equal(ReauthDialogStrings.TotpRequiredFallback, harness.ViewModel.ErrorMessage);
    }

    [Fact]
    public async Task Totp_submit_invalid_shows_totp_error_and_passes_enrollment()
    {
        using var harness = Harness.Open(
            SessionAuthMode.ForwardAuth,
            RepositoryResult<TotpStatusSnapshot>.Loaded(new TotpStatusSnapshot("session", true), DateTimeOffset.UnixEpoch));
        harness.Submitter.Outcome = ReauthSubmitOutcome.Fail(ReauthDialogStrings.InvalidCredentialCode, "bad");
        _ = harness.Enqueue();
        await harness.ViewModel.InitializationTask;

        harness.ViewModel.SetActiveTab(ReauthTab.Totp);
        harness.ViewModel.Totp = "123456";
        await harness.ViewModel.SubmitAsync();

        Assert.Equal(ReauthDialogStrings.InvalidTotpFallback, harness.ViewModel.ErrorMessage);
        Assert.True(harness.Submitter.LastTotpEnrolled);
        Assert.Equal("123456", harness.Submitter.LastBody!.TotpCode);
    }

    [Fact]
    public void Totp_input_keeps_only_digits_and_caps_length()
    {
        using var harness = Harness.Open(SessionAuthMode.ForwardAuth);

        harness.ViewModel.Totp = "12ab34-5678999";

        Assert.Equal("12345678", harness.ViewModel.Totp);
    }

    // ── View-model: reset on open + cancel (web reset effect / handleCancel) ──────────────────────────

    [Fact]
    public async Task New_challenge_resets_the_form()
    {
        using var harness = Harness.Open(SessionAuthMode.ForwardAuth);
        var first = harness.Enqueue();
        await harness.ViewModel.InitializationTask;
        harness.ViewModel.Password = "stale";

        harness.Queue.ResolveActive(new SudoCredential(SudoCredentialMode.Session, "t"));
        await first;
        var second = harness.Queue.EnqueueAsync("/next");
        await harness.ViewModel.InitializationTask;

        Assert.True(harness.ViewModel.IsOpen);
        Assert.Equal(string.Empty, harness.ViewModel.Password);
        Assert.Equal(ReauthTab.Password, harness.ViewModel.ActiveTab);
        harness.Queue.RejectActive(new SudoCanceledException());
        await Assert.ThrowsAsync<SudoCanceledException>(() => second);
    }

    [Fact]
    public async Task Cancel_rejects_the_active_challenge()
    {
        using var harness = Harness.Open(SessionAuthMode.ForwardAuth);
        var pending = harness.Enqueue();
        await harness.ViewModel.InitializationTask;

        harness.ViewModel.Cancel();

        await Assert.ThrowsAsync<SudoCanceledException>(() => pending);
        Assert.False(harness.ViewModel.IsOpen);
    }

    // ── Accessibility: every interactive element carries a localized label ────────────────────────────

    [Fact]
    public void ViewModel_exposes_localized_labels_for_every_control()
    {
        using var harness = Harness.Idle();
        var vm = harness.ViewModel;

        Assert.Equal(ReauthDialogStrings.TitleFallback, vm.Title);
        Assert.Equal(ReauthDialogStrings.CancelFallback, vm.CancelLabel);
        Assert.Equal(ReauthDialogStrings.SubmitFallback, vm.SubmitLabel);
        Assert.Equal(ReauthDialogStrings.PasswordTabFallback, vm.PasswordTabLabel);
        Assert.Equal(ReauthDialogStrings.TotpTabFallback, vm.TotpTabLabel);
        Assert.Equal(ReauthDialogStrings.TabsAriaFallback, vm.TabsAriaLabel);
        Assert.Equal(ReauthDialogStrings.PasswordLabelFallback, vm.PasswordFieldLabel);
        Assert.Equal(ReauthDialogStrings.TotpLabelFallback, vm.TotpFieldLabel);
        Assert.Equal(ReauthDialogStrings.HelperFallback, vm.HelperTextValue);
        Assert.Contains("CONFIRM", vm.TypedConfirmationFieldLabel, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Confirm_mode_uses_open_titles_and_interpolated_body()
    {
        using var harness = Harness.Open(SessionAuthMode.Open);
        _ = harness.Enqueue();
        await harness.ViewModel.InitializationTask;

        Assert.Equal(ReauthDialogStrings.OpenTitleFallback, harness.ViewModel.Title);
        Assert.Equal(ReauthDialogStrings.OpenSubmitFallback, harness.ViewModel.SubmitLabel);
        Assert.Contains("CONFIRM", harness.ViewModel.BodyText, StringComparison.Ordinal);
    }

    // ── Diagnostics (P1/S11 view.opened contract) ─────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_emit_view_opened_with_surface_slug()
    {
        var events = new List<string>();
        var diagnostics = new ReauthDialogDiagnostics(events.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal("view.opened slug=ReauthDialog", Assert.Single(events));
        Assert.Equal(1, diagnostics.ViewsOpened);
    }

    // ── Test doubles ──────────────────────────────────────────────────────────────────────────────────

    private sealed class Harness : IDisposable
    {
        private Harness(SessionAuthMode mode, IReadOnlyList<RepositoryResult<TotpStatusSnapshot>> totpResults)
        {
            Queue = new ReauthChallengeBroker();
            Submitter = new FakeSubmitter();
            ViewModel = new ReauthDialogViewModel(
                Queue,
                new FakeModeSource(mode),
                new FakeTotpSource(totpResults),
                Submitter,
                PassthroughLocalizer.Instance);
        }

        public ReauthChallengeBroker Queue { get; }

        public FakeSubmitter Submitter { get; }

        public ReauthDialogViewModel ViewModel { get; }

        public static Harness Idle() =>
            new(SessionAuthMode.ForwardAuth, Array.Empty<RepositoryResult<TotpStatusSnapshot>>());

        public static Harness Open(SessionAuthMode mode, params RepositoryResult<TotpStatusSnapshot>[] totpResults) =>
            new(mode, totpResults);

        public Task<SudoCredential> Enqueue(string path = "/protected") => Queue.EnqueueAsync(path);

        public void Dispose() => ViewModel.Dispose();
    }

    private sealed class FakeModeSource : ISessionAuthModeSource
    {
        private readonly SessionAuthMode _mode;

        public FakeModeSource(SessionAuthMode mode) => _mode = mode;

        public Task<SessionAuthMode> GetModeAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(_mode);
    }

    private sealed class FakeTotpSource : ITotpStatusSource
    {
        private readonly IReadOnlyList<RepositoryResult<TotpStatusSnapshot>> _results;

        public FakeTotpSource(IReadOnlyList<RepositoryResult<TotpStatusSnapshot>> results) => _results = results;

        public async IAsyncEnumerable<RepositoryResult<TotpStatusSnapshot>> StreamAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            foreach (var result in _results)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return result;
            }

            await Task.CompletedTask.ConfigureAwait(false);
        }
    }

    private sealed class FakeSubmitter : IReauthSubmitter
    {
        public ReauthSubmitOutcome Outcome { get; set; } =
            ReauthSubmitOutcome.Ok(new SudoCredential(SudoCredentialMode.Session, "default-token"));

        public bool WasCalled { get; private set; }

        public SudoSubmitBody? LastBody { get; private set; }

        public bool LastTotpEnrolled { get; private set; }

        public Task<ReauthSubmitOutcome> SubmitAsync(
            SudoSubmitBody body, bool totpEnrolled, CancellationToken cancellationToken = default)
        {
            WasCalled = true;
            LastBody = body;
            LastTotpEnrolled = totpEnrolled;
            return Task.FromResult(Outcome);
        }
    }
}
