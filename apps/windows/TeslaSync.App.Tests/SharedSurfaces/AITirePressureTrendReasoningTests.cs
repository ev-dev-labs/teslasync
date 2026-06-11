using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Settings;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the tire-pressure-trend-reasoning narration surface's UI-thread-free logic — the
/// SSE frame parser (the native port of useAiStream's parseSSEFrame/toTypedEvent), the registration metadata +
/// AI feature-registry membership, the PII-safe diagnostics, and the view-model's gate / canStart / stream
/// lifecycle state machine (idle → streaming → done / error, duplicate-start no-op, cancel → idle, offline
/// classification). Mirrors the web spec (web/src/components/ai/AITirePressureTrendReasoning.tsx +
/// AIFeatureCard.tsx + useAiStream.ts). The WinUI view (shared-surfaces/AITirePressureTrendReasoning.cs) is
/// exercised by the app build.
/// </summary>
public sealed class AITirePressureTrendReasoningTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // ── registration + registry membership ───────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("AITirePressureTrendReasoning", AITirePressureTrendReasoningRegistration.Slug);

    [Fact]
    public void Feature_id_is_present_in_the_canonical_registry()
    {
        Assert.True(AITirePressureTrendReasoningRegistration.IsRegisteredFeature(
            AITirePressureTrendReasoningRegistration.FeatureId));
        Assert.Contains(
            AiFeatureRegistry.Features,
            m => m.Id == AITirePressureTrendReasoningRegistration.FeatureId);
    }

    [Fact]
    public void Feature_id_matches_the_web_withAiFeature_id() =>
        Assert.Equal("tire-pressure-trend-reasoning", AITirePressureTrendReasoningRegistration.FeatureId);

    [Fact]
    public void Root_automation_id_matches_the_web_off_mode_test_id() =>
        Assert.Equal(
            "ai-feature-tire-pressure-trend-reasoning-root",
            AITirePressureTrendReasoningRegistration.RootAutomationId);

    [Fact]
    public void Unknown_feature_id_is_not_registered() =>
        Assert.False(AITirePressureTrendReasoningRegistration.IsRegisteredFeature("not-a-real-feature"));

    [Fact]
    public void Explain_path_is_the_web_endpoint_without_the_version_prefix() =>
        Assert.Equal("/ai/tire-pressure/trends/explain", AITirePressureTrendReasoningRegistration.ExplainPath);

    // ── diagnostics: view.opened, PII-safe ───────────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new AITirePressureTrendReasoningDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=AITirePressureTrendReasoning", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_without_a_sink_still_count_opens()
    {
        var diagnostics = new AITirePressureTrendReasoningDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    // ── SSE parser (web parseSSEFrame / toTypedEvent) ────────────────────────────────────────────────────

    [Fact]
    public void Parser_reads_a_delta_frame()
    {
        var ev = AiTirePressureTrendSseParser.ParseFrame("event: delta\ndata: {\"text\":\"Hello \"}");

        Assert.NotNull(ev);
        Assert.Equal(AiTirePressureTrendEventKind.Delta, ev!.Kind);
        Assert.Equal("Hello ", ev.Text);
    }

    [Fact]
    public void Parser_reads_a_done_frame()
    {
        var ev = AiTirePressureTrendSseParser.ParseFrame("event: done\ndata: {\"finish_reason\":\"stop\",\"usage\":{\"in\":1,\"out\":2}}");

        Assert.NotNull(ev);
        Assert.Equal(AiTirePressureTrendEventKind.Done, ev!.Kind);
    }

    [Fact]
    public void Parser_reads_an_error_frame_with_its_message()
    {
        var ev = AiTirePressureTrendSseParser.ParseFrame("event: error\ndata: {\"message\":\"rate_limited\"}");

        Assert.NotNull(ev);
        Assert.Equal(AiTirePressureTrendEventKind.Error, ev!.Kind);
        Assert.Equal("rate_limited", ev.Message);
        Assert.Equal(AiTirePressureTrendErrorReason.Stream, ev.ErrorReason);
    }

    [Fact]
    public void Parser_defaults_an_error_message_to_unknown_when_absent()
    {
        var ev = AiTirePressureTrendSseParser.ParseFrame("event: error\ndata: {\"reason\":\"cost_cap\"}");

        Assert.NotNull(ev);
        Assert.Equal(AiTirePressureTrendEventKind.Error, ev!.Kind);
        Assert.Equal("unknown", ev.Message);
    }

    [Fact]
    public void Parser_reads_tool_frames_and_ignores_their_payload()
    {
        var call = AiTirePressureTrendSseParser.ParseFrame("event: tool_call\ndata: {\"id\":\"1\",\"name\":\"draft\"}");
        var result = AiTirePressureTrendSseParser.ParseFrame("event: tool_result\ndata: {\"id\":\"1\",\"name\":\"draft\",\"ok\":true}");

        Assert.Equal(AiTirePressureTrendEventKind.ToolCall, call!.Kind);
        Assert.Equal(AiTirePressureTrendEventKind.ToolResult, result!.Kind);
    }

    [Fact]
    public void Parser_reads_a_confirm_request_frame()
    {
        var ev = AiTirePressureTrendSseParser.ParseFrame(
            "event: confirm_request\ndata: {\"continuation_id\":\"c\",\"tool\":\"t\",\"summary\":\"s\"}");

        Assert.NotNull(ev);
        Assert.Equal(AiTirePressureTrendEventKind.ConfirmRequest, ev!.Kind);
    }

    [Fact]
    public void Parser_ignores_comment_lines_and_joins_multiple_data_lines()
    {
        var ev = AiTirePressureTrendSseParser.ParseFrame(": keep-alive\nevent: delta\ndata: line1\u0000".Replace("\u0000", "")
            + "\ndata: {\"text\":\"x\"}");

        // The first data line is not valid JSON on its own; multiple data lines are joined with \n and parsed
        // as one document, which is not valid here, so the malformed-join yields null (matches the web guard).
        Assert.Null(ev);
    }

    [Theory]
    [InlineData("event: delta\ndata: not-json")]
    [InlineData("data: {\"text\":\"x\"}")] // no event line
    [InlineData("event: mystery\ndata: {\"text\":\"x\"}")] // unknown event type
    [InlineData("event: delta\ndata: {\"text\":123}")] // text not a string
    [InlineData("event: tool_call\ndata: {\"id\":\"1\"}")] // missing required name
    public void Parser_returns_null_for_malformed_or_unknown_frames(string frame) =>
        Assert.Null(AiTirePressureTrendSseParser.ParseFrame(frame));

    [Fact]
    public void Parser_supports_no_space_after_field_name()
    {
        var ev = AiTirePressureTrendSseParser.ParseFrame("event:delta\ndata:{\"text\":\"y\"}");

        Assert.NotNull(ev);
        Assert.Equal("y", ev!.Text);
    }

    // ── view-model: gate (web withAiFeature / useAiEnabled) ──────────────────────────────────────────────

    [Fact]
    public void Gate_off_keeps_the_surface_closed()
    {
        using var vm = NewViewModel(StaticAiFeatureGate.Off, vehicleId: 7);

        Assert.False(vm.IsGateOpen);
    }

    [Fact]
    public void Gate_on_opens_the_surface()
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On, vehicleId: 7);

        Assert.True(vm.IsGateOpen);
    }

    // ── view-model: initial state + canStart (web haveInputs) ────────────────────────────────────────────

    [Fact]
    public void Initial_state_is_idle_with_no_output()
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On, vehicleId: 7);

        Assert.Equal(AiTirePressureTrendStreamState.Idle, vm.State);
        Assert.Equal(string.Empty, vm.NarrationText);
        Assert.False(vm.HasOutput);
        Assert.False(vm.IsThinking);
        Assert.False(vm.IsError);
    }

    [Theory]
    [InlineData(null, false)]
    [InlineData(0L, false)]
    [InlineData(-3L, false)]
    [InlineData(7L, true)]
    public void CanStart_requires_a_positive_vehicle_id(long? vehicleId, bool expected)
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On, vehicleId);

        Assert.Equal(expected, vm.CanStart);
        Assert.Equal(expected, vm.IsActionEnabled);
    }

    [Fact]
    public void Setting_vehicle_id_reevaluates_can_start()
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On, vehicleId: null);
        Assert.False(vm.CanStart);

        vm.VehicleId = 42;

        Assert.True(vm.CanStart);
        Assert.True(vm.IsActionEnabled);
    }

    // ── view-model: stream lifecycle (web useAiStream) ───────────────────────────────────────────────────

    [Fact]
    public async Task Start_streams_deltas_into_text_then_completes_done()
    {
        var transport = new FakeTirePressureTrendTransport(
            AiTirePressureTrendStreamEvent.Delta("All four corners "),
            AiTirePressureTrendStreamEvent.Delta("are trending stable."),
            AiTirePressureTrendStreamEvent.Done());
        using var vm = NewViewModel(StaticAiFeatureGate.On, vehicleId: 7, transport);
        bool thinkingAtStreamStart = false;
        vm.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(vm.State) && vm.State == AiTirePressureTrendStreamState.Streaming)
            {
                thinkingAtStreamStart = vm.IsThinking;
            }
        };

        await vm.StartAsync();

        Assert.Equal("All four corners are trending stable.", vm.NarrationText);
        Assert.Equal(AiTirePressureTrendStreamState.Done, vm.State);
        Assert.True(thinkingAtStreamStart);
        Assert.False(vm.IsThinking);
        Assert.Equal(1, transport.OpenCount);
        Assert.Equal(7, transport.LastRequest?.VehicleId);
    }

    [Fact]
    public async Task Start_marks_done_when_the_stream_closes_without_a_terminal_event()
    {
        var transport = new FakeTirePressureTrendTransport(AiTirePressureTrendStreamEvent.Delta("partial"));
        using var vm = NewViewModel(StaticAiFeatureGate.On, vehicleId: 7, transport);

        await vm.StartAsync();

        Assert.Equal(AiTirePressureTrendStreamState.Done, vm.State);
        Assert.Equal("partial", vm.NarrationText);
    }

    [Fact]
    public async Task Start_is_a_no_op_without_a_resolved_vehicle()
    {
        var transport = new FakeTirePressureTrendTransport(AiTirePressureTrendStreamEvent.Done());
        using var vm = NewViewModel(StaticAiFeatureGate.On, vehicleId: null, transport);

        await vm.StartAsync();

        Assert.Equal(AiTirePressureTrendStreamState.Idle, vm.State);
        Assert.Equal(0, transport.OpenCount);
    }

    [Fact]
    public async Task Start_is_a_no_op_when_the_gate_is_closed()
    {
        var transport = new FakeTirePressureTrendTransport(AiTirePressureTrendStreamEvent.Done());
        using var vm = NewViewModel(StaticAiFeatureGate.Off, vehicleId: 7, transport);

        await vm.StartAsync();

        Assert.Equal(AiTirePressureTrendStreamState.Idle, vm.State);
        Assert.Equal(0, transport.OpenCount);
    }

    [Fact]
    public async Task Duplicate_start_while_streaming_is_a_no_op()
    {
        var transport = new FakeTirePressureTrendTransport { HoldOpen = true };
        using var vm = NewViewModel(StaticAiFeatureGate.On, vehicleId: 7, transport);

        var first = vm.StartAsync();
        var second = vm.StartAsync();

        await second; // the second call returns immediately without opening a second stream.
        Assert.Equal(AiTirePressureTrendStreamState.Streaming, vm.State);
        Assert.Equal(1, transport.OpenCount);

        vm.Cancel();
        await first;
    }

    [Fact]
    public async Task Error_frame_moves_to_the_error_surface_with_the_helix_message()
    {
        var transport = new FakeTirePressureTrendTransport(
            AiTirePressureTrendStreamEvent.Error("rate_limited", AiTirePressureTrendErrorReason.Stream));
        using var vm = NewViewModel(StaticAiFeatureGate.On, vehicleId: 7, transport);

        await vm.StartAsync();

        Assert.Equal(AiTirePressureTrendStreamState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(vm.IsOffline);
        Assert.Equal("Helix error: rate_limited", vm.DisplayErrorText);
    }

    [Fact]
    public async Task Network_failure_shows_the_offline_message()
    {
        var transport = new FakeTirePressureTrendTransport(
            AiTirePressureTrendStreamEvent.Error("stream_network", AiTirePressureTrendErrorReason.Network));
        using var vm = NewViewModel(StaticAiFeatureGate.On, vehicleId: 7, transport);

        await vm.StartAsync();

        Assert.Equal(AiTirePressureTrendStreamState.Error, vm.State);
        Assert.True(vm.IsOffline);
        Assert.Equal(AITirePressureTrendReasoningRegistration.OfflineFallback, vm.DisplayErrorText);
    }

    [Fact]
    public async Task Confirm_request_frame_pauses_the_stream()
    {
        var transport = new FakeTirePressureTrendTransport(AiTirePressureTrendStreamEvent.ConfirmRequest());
        using var vm = NewViewModel(StaticAiFeatureGate.On, vehicleId: 7, transport);

        await vm.StartAsync();

        Assert.Equal(AiTirePressureTrendStreamState.PausedConfirm, vm.State);
    }

    [Fact]
    public async Task Cancel_returns_an_in_flight_stream_to_idle()
    {
        var transport = new FakeTirePressureTrendTransport(AiTirePressureTrendStreamEvent.Delta("started")) { HoldOpen = true };
        using var vm = NewViewModel(StaticAiFeatureGate.On, vehicleId: 7, transport);

        var run = vm.StartAsync();
        vm.Cancel();
        await run;

        Assert.Equal(AiTirePressureTrendStreamState.Idle, vm.State);
    }

    [Fact]
    public async Task Error_then_retry_clears_the_prior_error()
    {
        var transport = new FakeTirePressureTrendTransport(
            AiTirePressureTrendStreamEvent.Error("boom", AiTirePressureTrendErrorReason.Stream));
        using var vm = NewViewModel(StaticAiFeatureGate.On, vehicleId: 7, transport);
        await vm.StartAsync();
        Assert.Equal(AiTirePressureTrendStreamState.Error, vm.State);

        transport.Reset(AiTirePressureTrendStreamEvent.Delta("recovered"), AiTirePressureTrendStreamEvent.Done());
        await vm.StartAsync();

        Assert.Equal(AiTirePressureTrendStreamState.Done, vm.State);
        Assert.Equal("recovered", vm.NarrationText);
        Assert.False(vm.IsError);
    }

    // ── view-model: i18n + accessibility labels ──────────────────────────────────────────────────────────

    [Fact]
    public void Labels_resolve_to_the_web_fallback_copy()
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On, vehicleId: 7);

        Assert.Equal("Narrate the 30-day tire-pressure trend", vm.Title);
        Assert.Equal("Narrate trend", vm.ButtonLabel);
        Assert.Equal("Helix", vm.BadgeLabel);
        Assert.Equal("Ask Helix", vm.AskHelixLabel);
        Assert.Contains("four corner tire pressures", vm.Description, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Action_label_flips_to_the_thinking_copy_while_streaming()
    {
        var transport = new FakeTirePressureTrendTransport { HoldOpen = true };
        using var vm = NewViewModel(StaticAiFeatureGate.On, vehicleId: 7, transport);

        Assert.Equal("Ask Helix", vm.ActionLabel);

        var run = vm.StartAsync();
        Assert.Equal("Helix is thinking\u2026", vm.ActionLabel);

        vm.Cancel();
        await run;
    }

    [Fact]
    public void Action_automation_name_composes_the_helix_cta_and_verb()
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On, vehicleId: 7);

        Assert.Equal("Ask Helix \u00b7 Narrate trend", vm.ActionAutomationName);
    }

    private static AITirePressureTrendReasoningViewModel NewViewModel(
        IAiFeatureGate gate,
        long? vehicleId,
        IAiTirePressureTrendStreamTransport? transport = null) =>
        new(transport ?? new FakeTirePressureTrendTransport(), gate, Localizer, vehicleId);

    /// <summary>
    /// A scripted <see cref="IAiTirePressureTrendStreamTransport"/> for headless lifecycle tests: yields a fixed
    /// event sequence and (optionally) holds the stream open afterwards so cancel / duplicate-start paths are
    /// exercised deterministically. Records the open count and the last request body.
    /// </summary>
    private sealed class FakeTirePressureTrendTransport : IAiTirePressureTrendStreamTransport
    {
        private AiTirePressureTrendStreamEvent[] _events;
        private int _openCount;

        public FakeTirePressureTrendTransport(params AiTirePressureTrendStreamEvent[] events) => _events = events;

        /// <summary>When true the stream stays open after the scripted events until cancelled.</summary>
        public bool HoldOpen { get; init; }

        public int OpenCount => Volatile.Read(ref _openCount);

        public AiTirePressureTrendRequest? LastRequest { get; private set; }

        public void Reset(params AiTirePressureTrendStreamEvent[] events) => _events = events;

        public async IAsyncEnumerable<AiTirePressureTrendStreamEvent> StreamAsync(
            AiTirePressureTrendRequest request,
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
