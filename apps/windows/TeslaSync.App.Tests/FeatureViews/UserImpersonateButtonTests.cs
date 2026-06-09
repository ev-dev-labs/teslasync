using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the impersonate-button surface's UI-thread-free logic — the status JSON parse
/// adapter (mode + active fields), the cache-then-network result mapper (status pass-through + the
/// <c>AUTH_MODE_OPEN</c> open-access signal), the repository source's request shapes (the status read and the
/// start mutation body), the state-holder view-model's state matrix (loading / ready / starting / empty /
/// error / stale / offline) and confirm → start → retry action flow, the registry metadata + i18n facade
/// copy, and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/admin/components/UserImpersonateButton.tsx).
/// </summary>
public sealed class UserImpersonateButtonTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    private const string Subject = "proxy-subject-7f3a";

    // ---- Status snapshot parse adapter --------------------------------------------------------------

    [Fact]
    public void Snapshot_parses_active_payload()
    {
        using var doc = JsonDocument.Parse(
            """{"mode":"active","original_admin":"root","target":"alice","expires_at":"2026-06-06T12:15:00Z"}""");

        var snap = ImpersonationStatusSnapshot.FromJson(doc.RootElement);

        Assert.Equal(ImpersonationMode.Active, snap.Mode);
        Assert.Equal("root", snap.OriginalAdmin);
        Assert.Equal("alice", snap.Target);
        Assert.Equal(new DateTimeOffset(2026, 6, 6, 12, 15, 0, TimeSpan.Zero), snap.ExpiresAtInstant);
    }

    [Fact]
    public void Snapshot_parses_inactive_and_is_tolerant_of_missing_or_non_object()
    {
        using var inactive = JsonDocument.Parse("""{"mode":"inactive"}""");
        var snap = ImpersonationStatusSnapshot.FromJson(inactive.RootElement);
        Assert.Equal(ImpersonationMode.Inactive, snap.Mode);
        Assert.Null(snap.OriginalAdmin);
        Assert.Null(snap.Target);
        Assert.Null(snap.ExpiresAtInstant);

        using var partial = JsonDocument.Parse("""{"target":"x"}""");
        Assert.Equal(ImpersonationMode.Unknown, ImpersonationStatusSnapshot.FromJson(partial.RootElement).Mode);

        using var notObject = JsonDocument.Parse("null");
        Assert.Same(ImpersonationStatusSnapshot.Unknown, ImpersonationStatusSnapshot.FromJson(notObject.RootElement));
    }

    // ---- Result mapper ------------------------------------------------------------------------------

    [Fact]
    public void Mapper_passes_through_transient_and_terminal_status()
    {
        Assert.Equal(LoadStatus.Loading, ImpersonationStatusResultMapper.Map(RepositoryResult<JsonElement>.Loading()).Status);
        Assert.Equal(LoadStatus.Empty, ImpersonationStatusResultMapper.Map(RepositoryResult<JsonElement>.Empty(Now)).Status);

        var failure = ImpersonationStatusResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        Assert.Equal(LoadStatus.Error, failure.Status);
    }

    [Fact]
    public void Mapper_loaded_and_offline_carry_typed_snapshot()
    {
        using var doc = JsonDocument.Parse("""{"mode":"active","target":"alice"}""");

        var loaded = ImpersonationStatusResultMapper.Map(RepositoryResult<JsonElement>.Loaded(doc.RootElement.Clone(), Now));
        Assert.Equal(LoadStatus.Loaded, loaded.Status);
        Assert.Equal(ImpersonationMode.Active, loaded.Value!.Mode);

        var offline = ImpersonationStatusResultMapper.Map(
            RepositoryResult<JsonElement>.OfflineCached(
                doc.RootElement.Clone(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal("alice", offline.Value!.Target);
    }

    [Fact]
    public void Mapper_preserves_error_code_and_detects_open_mode()
    {
        var open = new RepositoryError(RepositoryErrorKind.Server, "open", 501, "AUTH_MODE_OPEN");
        var mapped = ImpersonationStatusResultMapper.Map(RepositoryResult<JsonElement>.Failure(open));

        Assert.Equal("AUTH_MODE_OPEN", mapped.Error!.Code);
        Assert.True(ImpersonationStatusResultMapper.IsOpenMode(mapped.Error));
        Assert.False(ImpersonationStatusResultMapper.IsOpenMode(new RepositoryError(RepositoryErrorKind.Server, "x")));
    }

    // ---- View-model: status state matrix ------------------------------------------------------------

    [Fact]
    public void ViewModel_initial_state_is_loading()
    {
        using var vm = NewViewModel();
        Assert.Equal(ImpersonateSurfaceState.Loading, vm.State);
        Assert.False(vm.CanStart);
    }

    [Fact]
    public async Task ViewModel_ready_when_status_loaded_and_action_available()
    {
        using var vm = NewViewModel(Loaded(Snapshot(ImpersonationMode.Inactive)));
        vm.Subject = Subject;

        await vm.LoadAsync();

        Assert.Equal(ImpersonateSurfaceState.Ready, vm.State);
        Assert.True(vm.CanStart);
        Assert.True(vm.IsButtonEnabled);
        Assert.False(vm.IsFetching);
    }

    [Fact]
    public async Task ViewModel_open_access_signal_renders_empty_surface()
    {
        using var vm = NewViewModel(RepositoryResult<ImpersonationStatusSnapshot>.Failure(
            new RepositoryError(RepositoryErrorKind.Server, "open", 501, "AUTH_MODE_OPEN")));
        vm.Subject = Subject;

        await vm.LoadAsync();

        Assert.Equal(ImpersonateSurfaceState.Empty, vm.State);
        Assert.False(vm.CanStart);
        Assert.False(vm.IsError);
        Assert.Equal("Impersonation is unavailable in open-access mode.", vm.HintMessage);
    }

    [Fact]
    public async Task ViewModel_non_object_body_renders_empty_surface()
    {
        using var vm = NewViewModel(RepositoryResult<ImpersonationStatusSnapshot>.Empty(Now));
        vm.Subject = Subject;

        await vm.LoadAsync();

        Assert.Equal(ImpersonateSurfaceState.Empty, vm.State);
        Assert.False(vm.CanStart);
    }

    [Fact]
    public async Task ViewModel_error_when_status_read_fails_hard()
    {
        using var vm = NewViewModel(RepositoryResult<ImpersonationStatusSnapshot>.Failure(
            new RepositoryError(RepositoryErrorKind.Server, "boom")));
        vm.Subject = Subject;

        await vm.LoadAsync();

        Assert.Equal(ImpersonateSurfaceState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(vm.CanStart);
        Assert.Equal("Could not reach the impersonation service. Try again.", vm.ErrorMessage);
    }

    [Fact]
    public async Task ViewModel_stale_cache_stays_actionable()
    {
        using var vm = NewViewModel(RepositoryResult<ImpersonationStatusSnapshot>.Cached(
            Snapshot(ImpersonationMode.Inactive), Now, stale: true));
        vm.Subject = Subject;

        await vm.LoadAsync();

        Assert.Equal(ImpersonateSurfaceState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.CanStart);
        Assert.Equal("Status may be out of date.", vm.HintMessage);
    }

    [Fact]
    public async Task ViewModel_offline_disables_action_and_sets_error_chip()
    {
        using var vm = NewViewModel(RepositoryResult<ImpersonationStatusSnapshot>.OfflineCached(
            Snapshot(ImpersonationMode.Inactive), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        vm.Subject = Subject;

        await vm.LoadAsync();

        Assert.Equal(ImpersonateSurfaceState.Offline, vm.State);
        Assert.True(vm.IsError);
        Assert.False(vm.CanStart);
        Assert.StartsWith("Offline", vm.HintMessage);
    }

    // ---- View-model: confirm → start action flow ----------------------------------------------------

    [Fact]
    public async Task ViewModel_begin_confirm_opens_dialog_only_when_actionable()
    {
        using var vm = NewViewModel(Loaded(Snapshot(ImpersonationMode.Inactive)));
        vm.Subject = Subject;
        await vm.LoadAsync();

        vm.BeginConfirm();

        Assert.True(vm.IsConfirmOpen);
        Assert.Equal(ImpersonateActionPhase.Confirming, vm.Phase);

        vm.CancelStart();
        Assert.False(vm.IsConfirmOpen);
        Assert.Equal(ImpersonateActionPhase.Idle, vm.Phase);
    }

    [Fact]
    public void ViewModel_begin_confirm_is_a_no_op_while_loading()
    {
        using var vm = NewViewModel();
        vm.Subject = Subject;

        vm.BeginConfirm();

        Assert.False(vm.IsConfirmOpen);
        Assert.Equal(ImpersonateActionPhase.Idle, vm.Phase);
    }

    [Fact]
    public async Task ViewModel_confirm_start_posts_subject_and_marks_started()
    {
        var source = new FakeImpersonationSource(
            start: subject => ImpersonationStartOutcome.Ok(new ImpersonationStatusSnapshot(
                ImpersonationMode.Active, "root", subject, null)),
            Loaded(Snapshot(ImpersonationMode.Inactive)));
        using var vm = new UserImpersonateButtonViewModel(source, Localizer, clock: () => Now) { Subject = Subject };
        await vm.LoadAsync();
        vm.BeginConfirm();

        await vm.ConfirmStartAsync();

        Assert.Equal(Subject, Assert.Single(source.StartedSubjects));
        Assert.Equal(ImpersonateActionPhase.Started, vm.Phase);
        Assert.True(vm.IsStarted);
        Assert.False(vm.CanStart);
    }

    [Fact]
    public async Task ViewModel_confirm_start_failure_surfaces_error_with_retry()
    {
        var source = new FakeImpersonationSource(
            start: _ => ImpersonationStartOutcome.Fail(new RepositoryError(RepositoryErrorKind.Server, "denied", 500)),
            Loaded(Snapshot(ImpersonationMode.Inactive)));
        using var vm = new UserImpersonateButtonViewModel(source, Localizer, clock: () => Now) { Subject = Subject };
        await vm.LoadAsync();
        vm.BeginConfirm();

        await vm.ConfirmStartAsync();

        Assert.Equal(ImpersonateActionPhase.Failed, vm.Phase);
        Assert.Equal(ImpersonateSurfaceState.Error, vm.State);
        Assert.Equal("Failed to start impersonation", vm.ErrorMessage);

        // Retry from a failed start re-opens the confirmation dialog (does not silently re-fire).
        await vm.RetryAsync();
        Assert.True(vm.IsConfirmOpen);
    }

    [Fact]
    public async Task ViewModel_disabled_prop_blocks_the_action()
    {
        using var vm = NewViewModel(Loaded(Snapshot(ImpersonationMode.Inactive)));
        vm.Subject = Subject;
        vm.Disabled = true;
        await vm.LoadAsync();

        Assert.False(vm.CanStart);
        vm.BeginConfirm();
        Assert.False(vm.IsConfirmOpen);
    }

    [Fact]
    public async Task ViewModel_empty_subject_blocks_the_action()
    {
        using var vm = NewViewModel(Loaded(Snapshot(ImpersonationMode.Inactive)));
        await vm.LoadAsync();

        Assert.Equal(ImpersonateSurfaceState.Ready, vm.State);
        Assert.False(vm.CanStart);
    }

    [Fact]
    public async Task ViewModel_button_label_switches_to_busy_while_starting()
    {
        // A start that never resolves keeps the view-model in the Starting phase for the assertion.
        var gate = new TaskCompletionSource<ImpersonationStartOutcome>();
        var source = new FakeImpersonationSource(
            startAsync: _ => gate.Task,
            Loaded(Snapshot(ImpersonationMode.Inactive)));
        using var vm = new UserImpersonateButtonViewModel(source, Localizer, clock: () => Now) { Subject = Subject };
        await vm.LoadAsync();
        vm.BeginConfirm();

        var starting = vm.ConfirmStartAsync();

        Assert.Equal(ImpersonateSurfaceState.Starting, vm.State);
        Assert.True(vm.IsStarting);
        Assert.Equal("Starting\u2026", vm.ButtonLabel);

        gate.SetResult(ImpersonationStartOutcome.Ok(Snapshot(ImpersonationMode.Active)));
        await starting;
        Assert.Equal("Impersonate", vm.ButtonLabel);
    }

    // ---- Repository source request shapes -----------------------------------------------------------

    [Fact]
    public async Task Source_streams_status_and_targets_the_generated_operation()
    {
        using var doc = JsonDocument.Parse("""{"mode":"inactive"}""");
        var client = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = NewSource(client);

        var emissions = await Collect(source.StreamStatusAsync());

        Assert.Equal(LoadStatus.Loading, emissions[0].Status);
        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        Assert.Equal(ImpersonationMode.Inactive, emissions[^1].Value!.Mode);
        Assert.Equal("get_api_v1_admin_impersonate", client.Requests[^1].OperationId);
        Assert.Equal(ImpersonationSource.StatusOperation, client.Requests[^1].OperationId);
        Assert.Null(client.Requests[^1].Body);
    }

    [Fact]
    public async Task Source_open_access_501_streams_error_with_code()
    {
        var client = new FakeApiClient().Throws(new ApiException("open", 501, null, "AUTH_MODE_OPEN"));
        var source = NewSource(client);

        var emissions = await Collect(source.StreamStatusAsync());

        Assert.Equal(LoadStatus.Error, emissions[^1].Status);
        Assert.Equal("AUTH_MODE_OPEN", emissions[^1].Error!.Code);
    }

    [Fact]
    public async Task Source_start_posts_subject_body_to_the_generated_operation()
    {
        using var doc = JsonDocument.Parse("""{"mode":"active","target":"alice"}""");
        var client = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = NewSource(client);

        var outcome = await source.StartAsync("alice");

        Assert.True(outcome.Success);
        Assert.Equal(ImpersonationMode.Active, outcome.Status!.Mode);

        var request = Assert.Single(client.Requests);
        Assert.Equal("post_api_v1_admin_impersonate", request.OperationId);
        Assert.Equal(ImpersonationSource.StartOperation, request.OperationId);
        Assert.NotNull(request.Body);
        Assert.Equal("""{"subject":"alice"}""", JsonSerializer.Serialize(request.Body));
    }

    [Fact]
    public async Task Source_start_failure_is_classified_not_thrown()
    {
        var client = new FakeApiClient().Throws(new ApiException("denied", 403, null, "FORBIDDEN"));
        var source = NewSource(client);

        var outcome = await source.StartAsync("alice");

        Assert.False(outcome.Success);
        Assert.Null(outcome.Status);
        Assert.Equal(RepositoryErrorKind.Unauthorized, outcome.Error!.Kind);
    }

    // ---- Registry, i18n copy + accessibility --------------------------------------------------------

    [Fact]
    public void Registration_exposes_stable_id_and_slug()
    {
        Assert.Equal("user-impersonate-button", UserImpersonateButtonRegistration.Id);
        Assert.Equal("UserImpersonateButton", UserImpersonateButtonRegistration.Slug);
    }

    [Fact]
    public void Registration_resolves_every_web_string_through_the_facade()
    {
        Assert.Equal("Impersonate", UserImpersonateButtonRegistration.StartLabel(Localizer));
        Assert.Equal("Starting\u2026", UserImpersonateButtonRegistration.StartingLabel(Localizer));
        Assert.Equal("Start impersonation session?", UserImpersonateButtonRegistration.ConfirmTitle(Localizer));
        Assert.Equal("Start impersonation", UserImpersonateButtonRegistration.ConfirmConfirmLabel(Localizer));
        Assert.Equal("Cancel", UserImpersonateButtonRegistration.ConfirmCancelLabel(Localizer));
    }

    [Fact]
    public void Registration_interpolates_the_subject_into_aria_and_message()
    {
        Assert.Equal(
            $"Impersonate {Subject}",
            UserImpersonateButtonRegistration.AriaLabel(Localizer, Subject));
        Assert.Contains(Subject, UserImpersonateButtonRegistration.ConfirmMessage(Localizer, Subject), StringComparison.Ordinal);
    }

    [Fact]
    public void ViewModel_exposes_accessible_button_name_with_subject()
    {
        using var vm = NewViewModel();
        vm.Subject = Subject;
        Assert.Equal($"Impersonate {Subject}", vm.ButtonAriaLabel);
    }

    // ---- Diagnostics (PII-safe) ---------------------------------------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var sink = new List<string>();
        var diagnostics = new UserImpersonateButtonDiagnostics(sink.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=UserImpersonateButton", Assert.Single(sink));
    }

    [Fact]
    public async Task Diagnostics_records_start_resolution_without_logging_the_subject()
    {
        var sink = new List<string>();
        var diagnostics = new UserImpersonateButtonDiagnostics(sink.Add);
        var source = new FakeImpersonationSource(
            start: subject => ImpersonationStartOutcome.Ok(new ImpersonationStatusSnapshot(
                ImpersonationMode.Active, "root", subject, null)),
            Loaded(Snapshot(ImpersonationMode.Inactive)));
        using var vm = new UserImpersonateButtonViewModel(source, Localizer, diagnostics, () => Now) { Subject = Subject };
        await vm.LoadAsync();
        vm.BeginConfirm();

        await vm.ConfirmStartAsync();

        Assert.Equal(1, diagnostics.StartsRequested);
        Assert.Equal(1, diagnostics.StartsSucceeded);
        Assert.Equal(0, diagnostics.StartsFailed);
        Assert.DoesNotContain(sink, line => line.Contains(Subject, StringComparison.Ordinal));
    }

    // ---- helpers ------------------------------------------------------------------------------------

    private static UserImpersonateButtonViewModel NewViewModel(
        params RepositoryResult<ImpersonationStatusSnapshot>[] status) =>
        new(new FakeImpersonationSource(status), Localizer, clock: () => Now);

    private static ImpersonationSource NewSource(IApiClient client)
    {
        var engine = new CacheThenNetworkEngine(new InMemoryCacheStore(), () => Now);
        var options = new ApiClientOptions { BaseAddress = new Uri("http://localhost") };
        return new ImpersonationSource(client, engine, options);
    }

    private static RepositoryResult<ImpersonationStatusSnapshot> Loaded(ImpersonationStatusSnapshot snapshot) =>
        RepositoryResult<ImpersonationStatusSnapshot>.Loaded(snapshot, Now);

    private static ImpersonationStatusSnapshot Snapshot(ImpersonationMode mode) =>
        new(mode, null, null, null);

    private static async Task<IReadOnlyList<RepositoryResult<ImpersonationStatusSnapshot>>> Collect(
        IAsyncEnumerable<RepositoryResult<ImpersonationStatusSnapshot>> stream)
    {
        var list = new List<RepositoryResult<ImpersonationStatusSnapshot>>();
        await foreach (var item in stream)
        {
            list.Add(item);
        }

        return list;
    }

    private sealed class FakeImpersonationSource : IImpersonationSource
    {
        private readonly IReadOnlyList<RepositoryResult<ImpersonationStatusSnapshot>> _status;
        private readonly Func<string, ImpersonationStartOutcome>? _start;
        private readonly Func<string, Task<ImpersonationStartOutcome>>? _startAsync;

        public FakeImpersonationSource(params RepositoryResult<ImpersonationStatusSnapshot>[] status)
            : this(start: null, status)
        {
        }

        public FakeImpersonationSource(
            Func<string, ImpersonationStartOutcome>? start,
            params RepositoryResult<ImpersonationStatusSnapshot>[] status)
        {
            _status = status;
            _start = start;
        }

        public FakeImpersonationSource(
            Func<string, Task<ImpersonationStartOutcome>>? startAsync,
            params RepositoryResult<ImpersonationStatusSnapshot>[] status)
        {
            _status = status;
            _startAsync = startAsync;
        }

        public List<string> StartedSubjects { get; } = new();

        public async IAsyncEnumerable<RepositoryResult<ImpersonationStatusSnapshot>> StreamStatusAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            foreach (var result in _status)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return result;
                await Task.Yield();
            }
        }

        public Task<ImpersonationStartOutcome> StartAsync(string subject, CancellationToken cancellationToken = default)
        {
            StartedSubjects.Add(subject);
            if (_startAsync is { } async)
            {
                return async(subject);
            }

            var outcome = _start?.Invoke(subject)
                ?? ImpersonationStartOutcome.Ok(new ImpersonationStatusSnapshot(
                    ImpersonationMode.Active, "root", subject, null));
            return Task.FromResult(outcome);
        }
    }
}
