using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the BackendTool feature-view's UI-thread-free logic — the outcome classification
/// (web <c>apiFetch</c> success vs <c>{ error }</c>), the dev-tools run adapter (the POST/GET path + body the
/// web <c>useMutation</c> fires), the registry/diagnostics, and the state-holder view-model's per-state
/// transitions (idle / running / success / failed) plus the localized labels and Narrator names. Mirrors the
/// web spec (web/src/features/admin/components/devtools/BackendTool.tsx).
/// </summary>
public sealed class BackendToolTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static JsonElement El(string json) => JsonSerializer.Deserialize<JsonElement>(json);

    private static BackendToolDescriptor Descriptor(
        string operationId = "post_api_v1_dev_tools_fleet_status",
        object? body = null) =>
        new("\uE945", "TsColorInfoBrush", "Fleet Status", "Check the fleet API status", operationId, body);

    // ---- Outcome classification (web apiFetch result parity) ------------------------

    [Fact]
    public void Outcome_plain_object_is_success_with_payload()
    {
        var outcome = BackendToolOutcome.FromResponse(El("{\"connected\":true,\"count\":3}"));
        Assert.True(outcome.Ok);
        Assert.Null(outcome.Error);
        Assert.NotNull(outcome.Data);
    }

    [Fact]
    public void Outcome_string_error_is_failure_with_message()
    {
        var outcome = BackendToolOutcome.FromResponse(El("{\"error\":\"boom\"}"));
        Assert.False(outcome.Ok);
        Assert.Equal("boom", outcome.Error);
        Assert.Null(outcome.Data);
    }

    [Fact]
    public void Outcome_truthy_non_string_error_is_failure_without_message()
    {
        // Web: variant=danger (error truthy) but error text undefined (typeof !== 'string').
        var outcome = BackendToolOutcome.FromResponse(El("{\"error\":true}"));
        Assert.False(outcome.Ok);
        Assert.Null(outcome.Error);
    }

    [Theory]
    [InlineData("{\"error\":\"\"}")]
    [InlineData("{\"error\":0}")]
    [InlineData("{\"error\":false}")]
    [InlineData("{\"error\":null}")]
    public void Outcome_falsy_error_is_success(string json)
    {
        var outcome = BackendToolOutcome.FromResponse(El(json));
        Assert.True(outcome.Ok);
    }

    [Fact]
    public void Outcome_array_response_is_success()
    {
        var outcome = BackendToolOutcome.FromResponse(El("[1,2,3]"));
        Assert.True(outcome.Ok);
    }

    [Fact]
    public void PrettyPrint_indents_payload()
    {
        var json = BackendToolFormat.PrettyPrint(El("{\"a\":1}"));
        Assert.Contains("\n", json, StringComparison.Ordinal);
        Assert.Contains("\"a\": 1", json, StringComparison.Ordinal);
    }

    // ---- Run adapter (web useMutation -> apiFetch) ----------------------------------

    [Fact]
    public async Task Runner_sends_operation_and_body_then_classifies_success()
    {
        var body = new { foo = "bar" };
        var api = new FakeApiClient().ReturnsValue(El("{\"ok\":true}"));
        var runner = new BackendToolRunner(api);

        var outcome = await runner.RunAsync(Descriptor("post_api_v1_dev_tools_fleet_status", body));

        Assert.True(outcome.Ok);
        var request = Assert.Single(api.Requests);
        Assert.Equal("post_api_v1_dev_tools_fleet_status", request.OperationId);
        Assert.Same(body, request.Body);
    }

    [Fact]
    public async Task Runner_folds_api_fault_into_failed_outcome()
    {
        // Web parity: apiFetch catch -> { error: message }; the runner never throws a transport fault.
        var api = new FakeApiClient().Throws(new ApiException("boom", 500));
        var runner = new BackendToolRunner(api);

        var outcome = await runner.RunAsync(Descriptor());

        Assert.False(outcome.Ok);
        Assert.False(string.IsNullOrEmpty(outcome.Error));
    }

    [Fact]
    public async Task Runner_classifies_error_field_response_as_failure()
    {
        var api = new FakeApiClient().ReturnsValue(El("{\"error\":\"nope\"}"));
        var runner = new BackendToolRunner(api);

        var outcome = await runner.RunAsync(Descriptor("get_api_v1_dev_tools_db_stats"));

        Assert.False(outcome.Ok);
        Assert.Equal("nope", outcome.Error);
    }

    [Fact]
    public async Task Runner_rethrows_cancellation()
    {
        var api = new FakeApiClient().Throws(new OperationCanceledException());
        var runner = new BackendToolRunner(api);

        await Assert.ThrowsAsync<OperationCanceledException>(() => runner.RunAsync(Descriptor()));
    }

    // ---- View-model: initial (idle / empty) state -----------------------------------

    [Fact]
    public void Initial_state_is_idle_with_no_badge_and_idle_result()
    {
        var vm = new BackendToolViewModel(new ScriptedRunner(Success()), Localizer, Descriptor());

        Assert.Equal(BackendToolState.Idle, vm.State);
        Assert.True(vm.IsIdle);
        Assert.False(vm.HasResult);
        Assert.False(vm.ShowBadge);
        Assert.True(vm.CanRun);
        Assert.True(vm.ShowResultIdle);
        Assert.False(vm.HasResultData);
        Assert.Equal(Core.StatusKind.Neutral, vm.ResultTrayStatus);
    }

    // ---- View-model: running state --------------------------------------------------

    [Fact]
    public async Task Running_state_spins_and_hides_badge()
    {
        var runner = new GatedRunner();
        var vm = new BackendToolViewModel(runner, Localizer, Descriptor());

        var run = vm.RunAsync();

        Assert.Equal(BackendToolState.Running, vm.State);
        Assert.True(vm.IsRunning);
        Assert.False(vm.CanRun);
        Assert.False(vm.ShowBadge);

        runner.Complete(Success());
        await run;

        Assert.Equal(BackendToolState.Success, vm.State);
    }

    [Fact]
    public async Task Second_run_while_running_is_a_no_op()
    {
        var runner = new GatedRunner();
        var vm = new BackendToolViewModel(runner, Localizer, Descriptor());

        var first = vm.RunAsync();
        await vm.RunAsync(); // returns immediately — the gated runner is still pending

        Assert.Equal(1, runner.Calls);

        runner.Complete(Success());
        await first;
    }

    // ---- View-model: success state --------------------------------------------------

    [Fact]
    public async Task Success_state_shows_green_badge_and_json_payload()
    {
        var vm = new BackendToolViewModel(
            new ScriptedRunner(BackendToolOutcome.Succeeded(El("{\"connected\":true}"))),
            Localizer,
            Descriptor());

        await vm.RunAsync();

        Assert.Equal(BackendToolState.Success, vm.State);
        Assert.True(vm.ShowBadge);
        Assert.Equal(Core.StatusKind.Success, vm.BadgeStatus);
        Assert.Equal("Success", vm.BadgeText);
        Assert.True(vm.HasResultData);
        Assert.False(vm.ShowResultIdle);
        Assert.NotNull(vm.ResultJson);
        Assert.Null(vm.ResultError);
        Assert.Equal(Core.StatusKind.Success, vm.ResultTrayStatus);
        Assert.Equal("Fleet Status: Success", vm.LastAnnouncement);
    }

    // ---- View-model: failed state ---------------------------------------------------

    [Fact]
    public async Task Failed_state_shows_danger_badge_and_error_text()
    {
        var vm = new BackendToolViewModel(
            new ScriptedRunner(BackendToolOutcome.Failed("it broke")),
            Localizer,
            Descriptor());

        await vm.RunAsync();

        Assert.Equal(BackendToolState.Failed, vm.State);
        Assert.True(vm.ShowBadge);
        Assert.Equal(Core.StatusKind.Danger, vm.BadgeStatus);
        Assert.Equal("Failed", vm.BadgeText);
        Assert.False(vm.HasResultData);
        Assert.Equal("it broke", vm.ResultError);
        Assert.False(vm.ShowResultIdle);
        Assert.Equal(Core.StatusKind.Danger, vm.ResultTrayStatus);
        Assert.Equal("Fleet Status: Failed", vm.LastAnnouncement);
    }

    [Fact]
    public async Task Failed_without_message_falls_back_to_idle_result_line()
    {
        var vm = new BackendToolViewModel(
            new ScriptedRunner(BackendToolOutcome.Failed(null)),
            Localizer,
            Descriptor());

        await vm.RunAsync();

        Assert.Equal(BackendToolState.Failed, vm.State);
        Assert.Equal(Core.StatusKind.Danger, vm.BadgeStatus);
        Assert.Null(vm.ResultError);
        Assert.True(vm.ShowResultIdle); // web: badge "Failed" but ResultPanel shows the idle line
        Assert.Equal(Core.StatusKind.Neutral, vm.ResultTrayStatus);
    }

    [Fact]
    public async Task Run_can_be_repeated_after_settling()
    {
        var runner = new ScriptedRunner(Success());
        var vm = new BackendToolViewModel(runner, Localizer, Descriptor());

        await vm.RunAsync();
        Assert.Equal(BackendToolState.Success, vm.State);

        await vm.RunAsync();
        Assert.Equal(BackendToolState.Success, vm.State);
        Assert.Equal(2, runner.Calls);
    }

    // ---- Localized labels + a11y names (web t('Run') / t('Success') / t('Failed')) ---

    [Fact]
    public void Labels_resolve_to_web_literals()
    {
        var vm = new BackendToolViewModel(new ScriptedRunner(Success()), Localizer, Descriptor());

        Assert.Equal("Run", vm.RunLabel);
        Assert.Equal("Success", vm.SuccessLabel);
        Assert.Equal("Failed", vm.FailedLabel);
        Assert.Equal("No result yet", vm.NoResultLabel);
        Assert.Equal("Copy", vm.CopyLabel);
        Assert.Equal("Copied", vm.CopiedLabel);
    }

    [Fact]
    public void Run_action_name_is_scoped_to_the_tool()
    {
        var vm = new BackendToolViewModel(new ScriptedRunner(Success()), Localizer, Descriptor());

        Assert.Contains("Fleet Status", vm.RunActionName, StringComparison.Ordinal);
        Assert.Contains("Fleet Status", vm.RunningLabel, StringComparison.Ordinal);
        Assert.Equal("Fleet Status", vm.ResultTitle);
    }

    [Fact]
    public void Descriptor_accent_uses_a_semantic_token_not_neon()
    {
        var descriptor = Descriptor();
        Assert.StartsWith("TsColor", descriptor.AccentBrushKey, StringComparison.Ordinal);
        Assert.EndsWith("Brush", descriptor.AccentBrushKey, StringComparison.Ordinal);
        Assert.DoesNotContain("neon", descriptor.AccentBrushKey, StringComparison.OrdinalIgnoreCase);
    }

    // ---- Diagnostics (P1/S11 view.opened) -------------------------------------------

    [Fact]
    public void Diagnostics_records_view_opened_with_slug()
    {
        var sink = new List<string>();
        var diagnostics = new BackendToolDiagnostics(sink.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Contains("view.opened slug=BackendTool", sink);
        Assert.Equal("BackendTool", BackendToolRegistration.Slug);
    }

    // ---- Disposal -------------------------------------------------------------------

    [Fact]
    public void Dispose_is_idempotent()
    {
        var vm = new BackendToolViewModel(new ScriptedRunner(Success()), Localizer, Descriptor());
        vm.Dispose();
        vm.Dispose();
    }

    private static BackendToolOutcome Success() => BackendToolOutcome.Succeeded(El("{\"ok\":true}"));

    private sealed class ScriptedRunner : IBackendToolRunner
    {
        private readonly BackendToolOutcome _outcome;

        public ScriptedRunner(BackendToolOutcome outcome) => _outcome = outcome;

        public int Calls { get; private set; }

        public Task<BackendToolOutcome> RunAsync(BackendToolDescriptor descriptor, CancellationToken cancellationToken = default)
        {
            Calls++;
            return Task.FromResult(_outcome);
        }
    }

    private sealed class GatedRunner : IBackendToolRunner
    {
        private readonly TaskCompletionSource<BackendToolOutcome> _gate =
            new(TaskCreationOptions.RunContinuationsAsynchronously);

        public int Calls { get; private set; }

        public Task<BackendToolOutcome> RunAsync(BackendToolDescriptor descriptor, CancellationToken cancellationToken = default)
        {
            Calls++;
            return _gate.Task;
        }

        public void Complete(BackendToolOutcome outcome) => _gate.TrySetResult(outcome);
    }
}
