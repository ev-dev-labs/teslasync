using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Settings;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the state-machine-debugger narration surface's UI-thread-free logic — the SSE frame
/// parser adapter (the native port of useAiStream's parseSSEFrame/toTypedEvent that projects raw frames into
/// typed events), the registration metadata + AI feature-registry membership, the PII-safe diagnostics, and the
/// view-model's gate / canStart (the (vehicle, window) triple) / empty-hint / stream lifecycle state machine
/// (idle → streaming → done / error, duplicate-start no-op, cancel → idle, offline classification). Mirrors the
/// web spec (web/src/components/ai/AIStateMachineDebuggerNarrator.tsx + AIFeatureCard.tsx + useAiStream.ts). The
/// WinUI view (shared-surfaces/AIStateMachineDebuggerNarrator.cs) is exercised by the app build; these per-state
/// view-model assertions are the headless snapshot of what the view renders in each state.
/// </summary>
public sealed class AIStateMachineDebuggerNarratorTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private const long VehicleId = 7;
    private const long FromUnix = 1000;
    private const long ToUnix = 2000;

    // ── registration + registry membership ───────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("AIStateMachineDebuggerNarrator", AIStateMachineDebuggerNarratorRegistration.Slug);

    [Fact]
    public void Registration_root_automation_id_mirrors_the_web_testid() =>
        Assert.Equal(
            "ai-feature-state-machine-debugger-narrator-root",
            AIStateMachineDebuggerNarratorRegistration.RootAutomationId);

    [Fact]
    public void Feature_id_is_present_in_the_canonical_registry()
    {
        Assert.True(AIStateMachineDebuggerNarratorRegistration.IsRegisteredFeature(
            AIStateMachineDebuggerNarratorRegistration.FeatureId));
        Assert.Contains(
            AiFeatureRegistry.Features,
            m => m.Id == AIStateMachineDebuggerNarratorRegistration.FeatureId);
    }

    [Fact]
    public void Unknown_feature_id_is_not_registered() =>
        Assert.False(AIStateMachineDebuggerNarratorRegistration.IsRegisteredFeature("not-a-real-feature"));

    [Fact]
    public void Narrate_path_is_the_web_endpoint_without_the_version_prefix() =>
        Assert.Equal("/ai/system/fsm/narrate", AIStateMachineDebuggerNarratorRegistration.NarratePath);

    // ── diagnostics: view.opened, PII-safe ───────────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new AIStateMachineDebuggerNarratorDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=AIStateMachineDebuggerNarrator", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_without_a_sink_still_count_opens()
    {
        var diagnostics = new AIStateMachineDebuggerNarratorDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    // ── adapter: SSE parser (web parseSSEFrame / toTypedEvent) ───────────────────────────────────────────

    [Fact]
    public void Parser_reads_a_delta_frame()
    {
        var ev = FsmNarrateSseParser.ParseFrame("event: delta\ndata: {\"text\":\"FSM \"}");

        Assert.NotNull(ev);
        Assert.Equal(FsmNarrateEventKind.Delta, ev!.Kind);
        Assert.Equal("FSM ", ev.Text);
    }

    [Fact]
    public void Parser_reads_a_done_frame()
    {
        var ev = FsmNarrateSseParser.ParseFrame("event: done\ndata: {\"finish_reason\":\"stop\",\"usage\":{\"in\":1,\"out\":2}}");

        Assert.NotNull(ev);
        Assert.Equal(FsmNarrateEventKind.Done, ev!.Kind);
    }

    [Fact]
    public void Parser_reads_an_error_frame_with_its_message()
    {
        var ev = FsmNarrateSseParser.ParseFrame("event: error\ndata: {\"message\":\"rate_limited\"}");

        Assert.NotNull(ev);
        Assert.Equal(FsmNarrateEventKind.Error, ev!.Kind);
        Assert.Equal("rate_limited", ev.Message);
        Assert.Equal(FsmNarrateErrorReason.Stream, ev.ErrorReason);
    }

    [Fact]
    public void Parser_defaults_an_error_message_to_unknown_when_absent()
    {
        var ev = FsmNarrateSseParser.ParseFrame("event: error\ndata: {\"reason\":\"cost_cap\"}");

        Assert.NotNull(ev);
        Assert.Equal(FsmNarrateEventKind.Error, ev!.Kind);
        Assert.Equal("unknown", ev.Message);
    }

    [Fact]
    public void Parser_reads_tool_frames_and_ignores_their_payload()
    {
        var call = FsmNarrateSseParser.ParseFrame("event: tool_call\ndata: {\"id\":\"1\",\"name\":\"query_fsm_trace\"}");
        var result = FsmNarrateSseParser.ParseFrame("event: tool_result\ndata: {\"id\":\"1\",\"name\":\"query_fsm_trace\",\"ok\":true}");

        Assert.Equal(FsmNarrateEventKind.ToolCall, call!.Kind);
        Assert.Equal(FsmNarrateEventKind.ToolResult, result!.Kind);
    }

    [Fact]
    public void Parser_reads_a_confirm_request_frame()
    {
        var ev = FsmNarrateSseParser.ParseFrame(
            "event: confirm_request\ndata: {\"continuation_id\":\"c\",\"tool\":\"t\",\"summary\":\"s\"}");

        Assert.NotNull(ev);
        Assert.Equal(FsmNarrateEventKind.ConfirmRequest, ev!.Kind);
    }

    [Fact]
    public void Parser_ignores_comment_lines_before_a_valid_frame()
    {
        var ev = FsmNarrateSseParser.ParseFrame(": keep-alive\nevent: delta\ndata: {\"text\":\"x\"}");

        Assert.NotNull(ev);
        Assert.Equal("x", ev!.Text);
    }

    [Theory]
    [InlineData("event: delta\ndata: not-json")]
    [InlineData("data: {\"text\":\"x\"}")] // no event line
    [InlineData("event: mystery\ndata: {\"text\":\"x\"}")] // unknown event type
    [InlineData("event: delta\ndata: {\"text\":123}")] // text not a string
    [InlineData("event: tool_call\ndata: {\"id\":\"1\"}")] // missing required name
    public void Parser_returns_null_for_malformed_or_unknown_frames(string frame) =>
        Assert.Null(FsmNarrateSseParser.ParseFrame(frame));

    [Fact]
    public void Parser_supports_no_space_after_field_name()
    {
        var ev = FsmNarrateSseParser.ParseFrame("event:delta\ndata:{\"text\":\"y\"}");

        Assert.NotNull(ev);
        Assert.Equal("y", ev!.Text);
    }

    // ── view-model: gate (web withAiFeature / useAiEnabled) ──────────────────────────────────────────────

    [Fact]
    public void Gate_off_keeps_the_surface_closed()
    {
        using var vm = NewViewModel(StaticAiFeatureGate.Off);

        Assert.False(vm.IsGateOpen);
    }

    [Fact]
    public void Gate_on_opens_the_surface()
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On);

        Assert.True(vm.IsGateOpen);
    }

    // ── view-model: initial state + empty hint (web haveScope / emptyHint) ───────────────────────────────

    [Fact]
    public void Initial_state_is_idle_with_no_output()
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On);

        Assert.Equal(FsmNarrateStreamState.Idle, vm.State);
        Assert.Equal(string.Empty, vm.NarrationText);
        Assert.False(vm.HasOutput);
        Assert.False(vm.IsThinking);
        Assert.False(vm.IsError);
    }

    [Fact]
    public void Empty_hint_shows_until_a_valid_scope_is_supplied()
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On, vehicleId: null, fromUnix: null, toUnix: null);
        Assert.True(vm.ShowEmptyHint);
        Assert.False(vm.CanStart);

        vm.SetScope(VehicleId, FromUnix, ToUnix);

        Assert.False(vm.ShowEmptyHint);
        Assert.True(vm.CanStart);
        Assert.True(vm.IsActionEnabled);
    }

    [Theory]
    [InlineData(VehicleId, FromUnix, ToUnix, true)]   // complete + valid window
    [InlineData(null, FromUnix, ToUnix, false)]       // no vehicle
    [InlineData(0L, FromUnix, ToUnix, false)]         // vehicle not positive
    [InlineData(-3L, FromUnix, ToUnix, false)]        // negative vehicle
    [InlineData(VehicleId, null, ToUnix, false)]      // no window start
    [InlineData(VehicleId, 0L, ToUnix, false)]        // window start not positive
    [InlineData(VehicleId, FromUnix, null, false)]    // no window end
    [InlineData(VehicleId, FromUnix, FromUnix, false)] // end equals start (not strictly after)
    [InlineData(VehicleId, ToUnix, FromUnix, false)]  // end before start
    [InlineData(VehicleId, FromUnix, FromUnix + 1, true)] // minimal valid window
    public void CanStart_requires_a_complete_and_ordered_scope(
        long? vehicleId,
        long? fromUnix,
        long? toUnix,
        bool expected)
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On, vehicleId, fromUnix, toUnix);

        Assert.Equal(expected, vm.CanStart);
        Assert.Equal(expected, vm.IsActionEnabled);
        Assert.Equal(!expected, vm.ShowEmptyHint);
    }

    [Fact]
    public void Setting_individual_scope_parts_reevaluates_can_start()
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On, vehicleId: null, fromUnix: null, toUnix: null);
        Assert.False(vm.CanStart);

        vm.VehicleId = VehicleId;
        vm.FromUnix = FromUnix;
        Assert.False(vm.CanStart); // still missing the window end

        vm.ToUnix = ToUnix;

        Assert.True(vm.CanStart);
        Assert.True(vm.IsActionEnabled);
    }

    // ── view-model: stream lifecycle (web useAiStream) ───────────────────────────────────────────────────

    [Fact]
    public async Task Start_streams_deltas_into_text_then_completes_done()
    {
        var transport = new FakeFsmNarrateTransport(
            FsmNarrateStreamEvent.Delta("The park FSM "),
            FsmNarrateStreamEvent.Delta("flapped twice."),
            FsmNarrateStreamEvent.Done());
        using var vm = NewViewModel(StaticAiFeatureGate.On, transport: transport);
        bool thinkingAtStreamStart = false;
        vm.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(vm.State) && vm.State == FsmNarrateStreamState.Streaming)
            {
                thinkingAtStreamStart = vm.IsThinking;
            }
        };

        await vm.StartAsync();

        Assert.Equal("The park FSM flapped twice.", vm.NarrationText);
        Assert.Equal(FsmNarrateStreamState.Done, vm.State);
        Assert.True(thinkingAtStreamStart);
        Assert.False(vm.IsThinking);
        Assert.Equal(1, transport.OpenCount);
    }

    [Fact]
    public async Task Start_posts_the_in_scope_window_triple()
    {
        var transport = new FakeFsmNarrateTransport(FsmNarrateStreamEvent.Done());
        using var vm = NewViewModel(StaticAiFeatureGate.On, transport: transport);

        await vm.StartAsync();

        Assert.NotNull(transport.LastRequest);
        Assert.Equal(VehicleId, transport.LastRequest!.VehicleId);
        Assert.Equal(FromUnix, transport.LastRequest.FromUnix);
        Assert.Equal(ToUnix, transport.LastRequest.ToUnix);
    }

    [Fact]
    public async Task Start_marks_done_when_the_stream_closes_without_a_terminal_event()
    {
        var transport = new FakeFsmNarrateTransport(FsmNarrateStreamEvent.Delta("partial"));
        using var vm = NewViewModel(StaticAiFeatureGate.On, transport: transport);

        await vm.StartAsync();

        Assert.Equal(FsmNarrateStreamState.Done, vm.State);
        Assert.Equal("partial", vm.NarrationText);
    }

    [Fact]
    public async Task Start_is_a_no_op_without_a_complete_scope()
    {
        var transport = new FakeFsmNarrateTransport(FsmNarrateStreamEvent.Done());
        using var vm = NewViewModel(StaticAiFeatureGate.On, vehicleId: VehicleId, fromUnix: null, toUnix: null, transport);

        await vm.StartAsync();

        Assert.Equal(FsmNarrateStreamState.Idle, vm.State);
        Assert.Equal(0, transport.OpenCount);
    }

    [Fact]
    public async Task Start_is_a_no_op_when_the_gate_is_closed()
    {
        var transport = new FakeFsmNarrateTransport(FsmNarrateStreamEvent.Done());
        using var vm = NewViewModel(StaticAiFeatureGate.Off, transport: transport);

        await vm.StartAsync();

        Assert.Equal(FsmNarrateStreamState.Idle, vm.State);
        Assert.Equal(0, transport.OpenCount);
    }

    [Fact]
    public async Task Duplicate_start_while_streaming_is_a_no_op()
    {
        var transport = new FakeFsmNarrateTransport { HoldOpen = true };
        using var vm = NewViewModel(StaticAiFeatureGate.On, transport: transport);

        var first = vm.StartAsync();
        var second = vm.StartAsync();

        await second; // the second call returns immediately without opening a second stream.
        Assert.Equal(FsmNarrateStreamState.Streaming, vm.State);
        Assert.Equal(1, transport.OpenCount);

        vm.Cancel();
        await first;
    }

    [Fact]
    public async Task Error_frame_moves_to_the_error_surface_with_the_helix_message()
    {
        var transport = new FakeFsmNarrateTransport(
            FsmNarrateStreamEvent.Error("rate_limited", FsmNarrateErrorReason.Stream));
        using var vm = NewViewModel(StaticAiFeatureGate.On, transport: transport);

        await vm.StartAsync();

        Assert.Equal(FsmNarrateStreamState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(vm.IsOffline);
        Assert.Equal("Helix error: rate_limited", vm.DisplayErrorText);
    }

    [Fact]
    public async Task Network_failure_shows_the_offline_message()
    {
        var transport = new FakeFsmNarrateTransport(
            FsmNarrateStreamEvent.Error("stream_network", FsmNarrateErrorReason.Network));
        using var vm = NewViewModel(StaticAiFeatureGate.On, transport: transport);

        await vm.StartAsync();

        Assert.Equal(FsmNarrateStreamState.Error, vm.State);
        Assert.True(vm.IsOffline);
        Assert.Equal(AIStateMachineDebuggerNarratorRegistration.OfflineFallback, vm.DisplayErrorText);
    }

    [Fact]
    public async Task Http_off_mode_failure_shows_the_generic_error_not_offline()
    {
        var transport = new FakeFsmNarrateTransport(
            FsmNarrateStreamEvent.Error("stream_http_404", FsmNarrateErrorReason.Http));
        using var vm = NewViewModel(StaticAiFeatureGate.On, transport: transport);

        await vm.StartAsync();

        Assert.Equal(FsmNarrateStreamState.Error, vm.State);
        Assert.False(vm.IsOffline);
        Assert.Equal("Helix error: stream_http_404", vm.DisplayErrorText);
    }

    [Fact]
    public async Task Confirm_request_frame_pauses_the_stream()
    {
        var transport = new FakeFsmNarrateTransport(FsmNarrateStreamEvent.ConfirmRequest());
        using var vm = NewViewModel(StaticAiFeatureGate.On, transport: transport);

        await vm.StartAsync();

        Assert.Equal(FsmNarrateStreamState.PausedConfirm, vm.State);
    }

    [Fact]
    public async Task Cancel_returns_an_in_flight_stream_to_idle()
    {
        var transport = new FakeFsmNarrateTransport(FsmNarrateStreamEvent.Delta("started")) { HoldOpen = true };
        using var vm = NewViewModel(StaticAiFeatureGate.On, transport: transport);

        var run = vm.StartAsync();
        vm.Cancel();
        await run;

        Assert.Equal(FsmNarrateStreamState.Idle, vm.State);
    }

    [Fact]
    public async Task Error_then_retry_clears_the_prior_error()
    {
        var transport = new FakeFsmNarrateTransport(
            FsmNarrateStreamEvent.Error("boom", FsmNarrateErrorReason.Stream));
        using var vm = NewViewModel(StaticAiFeatureGate.On, transport: transport);
        await vm.StartAsync();
        Assert.Equal(FsmNarrateStreamState.Error, vm.State);

        transport.Reset(FsmNarrateStreamEvent.Delta("recovered"), FsmNarrateStreamEvent.Done());
        await vm.StartAsync();

        Assert.Equal(FsmNarrateStreamState.Done, vm.State);
        Assert.Equal("recovered", vm.NarrationText);
        Assert.False(vm.IsError);
    }

    // ── view-model: i18n + accessibility labels ──────────────────────────────────────────────────────────

    [Fact]
    public void Labels_resolve_to_the_web_fallback_copy()
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On);

        Assert.Equal("Helix FSM narrator", vm.Title);
        Assert.Equal("Narrate transitions", vm.ButtonLabel);
        Assert.Equal("Helix", vm.BadgeLabel);
        Assert.Equal("Select a vehicle and a valid time window first.", vm.EmptyHint);
        Assert.Equal("Ask Helix", vm.AskHelixLabel);
        Assert.Contains("FSM transition trace", vm.Description, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Action_label_flips_to_the_thinking_copy_while_streaming()
    {
        var transport = new FakeFsmNarrateTransport { HoldOpen = true };
        using var vm = NewViewModel(StaticAiFeatureGate.On, transport: transport);

        Assert.Equal("Ask Helix", vm.ActionLabel);

        var run = vm.StartAsync();
        Assert.Equal("Helix is thinking\u2026", vm.ActionLabel);

        vm.Cancel();
        await run;
    }

    [Fact]
    public void Action_automation_name_composes_the_helix_cta_and_verb()
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On);

        Assert.Equal("Ask Helix \u00b7 Narrate transitions", vm.ActionAutomationName);
    }

    private static AIStateMachineDebuggerNarratorViewModel NewViewModel(
        IAiFeatureGate gate,
        long? vehicleId = VehicleId,
        long? fromUnix = FromUnix,
        long? toUnix = ToUnix,
        IFsmNarrateStreamTransport? transport = null) =>
        new(transport ?? new FakeFsmNarrateTransport(), gate, Localizer, vehicleId, fromUnix, toUnix);

    /// <summary>
    /// A scripted <see cref="IFsmNarrateStreamTransport"/> for headless lifecycle tests: yields a fixed event
    /// sequence and (optionally) holds the stream open afterwards so cancel / duplicate-start paths are
    /// exercised deterministically. Records the open count and the last request body.
    /// </summary>
    private sealed class FakeFsmNarrateTransport : IFsmNarrateStreamTransport
    {
        private FsmNarrateStreamEvent[] _events;
        private int _openCount;

        public FakeFsmNarrateTransport(params FsmNarrateStreamEvent[] events) => _events = events;

        /// <summary>When true the stream stays open after the scripted events until cancelled.</summary>
        public bool HoldOpen { get; init; }

        public int OpenCount => Volatile.Read(ref _openCount);

        public FsmNarrateRequest? LastRequest { get; private set; }

        public void Reset(params FsmNarrateStreamEvent[] events) => _events = events;

        public async IAsyncEnumerable<FsmNarrateStreamEvent> StreamAsync(
            FsmNarrateRequest request,
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            Interlocked.Increment(ref _openCount);
            LastRequest = request;

            foreach (var ev in _events)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return ev;
            }

            if (HoldOpen)
            {
                await Task.Delay(Timeout.Infinite, cancellationToken).ConfigureAwait(false);
            }
        }
    }
}
