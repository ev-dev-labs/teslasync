using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Settings;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the smart-charge schedule-suggestion surface's UI-thread-free logic — the SSE frame
/// parser (the native port of useAiStream's parseSSEFrame/toTypedEvent), the request-body adapter (the native
/// port of the web useMemo body: per-field defaults + depart_by ISO normalization), the registration metadata +
/// AI feature-registry membership, the PII-safe diagnostics, and the view-model's gate / canStart / stream
/// lifecycle state machine (idle → streaming → done / error, duplicate-start no-op, cancel → idle, offline
/// classification). Mirrors the web spec (web/src/components/ai/AISmartChargeScheduleSuggestion.tsx +
/// AIFeatureCard.tsx + useAiStream.ts). The WinUI view (shared-surfaces/AISmartChargeScheduleSuggestion.cs) is
/// exercised by the app build.
/// </summary>
public sealed class AISmartChargeScheduleSuggestionTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset FixedNow =
        new(2026, 1, 2, 3, 4, 5, TimeSpan.Zero);

    // ── registration + registry membership ───────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("AISmartChargeScheduleSuggestion", AISmartChargeScheduleSuggestionRegistration.Slug);

    [Fact]
    public void Feature_id_is_present_in_the_canonical_registry()
    {
        Assert.True(AISmartChargeScheduleSuggestionRegistration.IsRegisteredFeature(
            AISmartChargeScheduleSuggestionRegistration.FeatureId));
        Assert.Contains(
            AiFeatureRegistry.Features,
            m => m.Id == AISmartChargeScheduleSuggestionRegistration.FeatureId);
    }

    [Fact]
    public void Feature_id_matches_the_web_with_ai_feature_slug() =>
        Assert.Equal("smart-charge-schedule-suggestion", AISmartChargeScheduleSuggestionRegistration.FeatureId);

    [Fact]
    public void Unknown_feature_id_is_not_registered() =>
        Assert.False(AISmartChargeScheduleSuggestionRegistration.IsRegisteredFeature("not-a-real-feature"));

    [Fact]
    public void Draft_path_is_the_web_endpoint_without_the_version_prefix() =>
        Assert.Equal("/ai/charging/schedule/draft", AISmartChargeScheduleSuggestionRegistration.DraftPath);

    [Fact]
    public void Root_automation_id_mirrors_the_web_off_mode_test_id() =>
        Assert.Equal(
            "ai-feature-smart-charge-schedule-suggestion-root",
            AISmartChargeScheduleSuggestionRegistration.RootAutomationId);

    // ── diagnostics: view.opened, PII-safe ───────────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new AISmartChargeScheduleSuggestionDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=AISmartChargeScheduleSuggestion", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_without_a_sink_still_count_opens()
    {
        var diagnostics = new AISmartChargeScheduleSuggestionDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    // ── SSE parser (web parseSSEFrame / toTypedEvent) ────────────────────────────────────────────────────

    [Fact]
    public void Parser_reads_a_delta_frame()
    {
        var ev = AiScheduleSseParser.ParseFrame("event: delta\ndata: {\"text\":\"Charge \"}");

        Assert.NotNull(ev);
        Assert.Equal(AiScheduleEventKind.Delta, ev!.Kind);
        Assert.Equal("Charge ", ev.Text);
    }

    [Fact]
    public void Parser_reads_a_done_frame()
    {
        var ev = AiScheduleSseParser.ParseFrame("event: done\ndata: {\"finish_reason\":\"stop\",\"usage\":{\"in\":1,\"out\":2}}");

        Assert.NotNull(ev);
        Assert.Equal(AiScheduleEventKind.Done, ev!.Kind);
    }

    [Fact]
    public void Parser_reads_an_error_frame_with_its_message()
    {
        var ev = AiScheduleSseParser.ParseFrame("event: error\ndata: {\"message\":\"rate_limited\"}");

        Assert.NotNull(ev);
        Assert.Equal(AiScheduleEventKind.Error, ev!.Kind);
        Assert.Equal("rate_limited", ev.Message);
        Assert.Equal(AiScheduleErrorReason.Stream, ev.ErrorReason);
    }

    [Fact]
    public void Parser_defaults_an_error_message_to_unknown_when_absent()
    {
        var ev = AiScheduleSseParser.ParseFrame("event: error\ndata: {\"reason\":\"cost_cap\"}");

        Assert.NotNull(ev);
        Assert.Equal(AiScheduleEventKind.Error, ev!.Kind);
        Assert.Equal("unknown", ev.Message);
    }

    [Fact]
    public void Parser_reads_tool_frames_and_ignores_their_payload()
    {
        var call = AiScheduleSseParser.ParseFrame("event: tool_call\ndata: {\"id\":\"1\",\"name\":\"draft\"}");
        var result = AiScheduleSseParser.ParseFrame("event: tool_result\ndata: {\"id\":\"1\",\"name\":\"draft\",\"ok\":true}");

        Assert.Equal(AiScheduleEventKind.ToolCall, call!.Kind);
        Assert.Equal(AiScheduleEventKind.ToolResult, result!.Kind);
    }

    [Fact]
    public void Parser_reads_a_confirm_request_frame()
    {
        var ev = AiScheduleSseParser.ParseFrame(
            "event: confirm_request\ndata: {\"continuation_id\":\"c\",\"tool\":\"t\",\"summary\":\"s\"}");

        Assert.NotNull(ev);
        Assert.Equal(AiScheduleEventKind.ConfirmRequest, ev!.Kind);
    }

    [Fact]
    public void Parser_ignores_comment_lines_before_an_event()
    {
        var ev = AiScheduleSseParser.ParseFrame(": keep-alive\nevent: delta\ndata: {\"text\":\"x\"}");

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
        Assert.Null(AiScheduleSseParser.ParseFrame(frame));

    [Fact]
    public void Parser_supports_no_space_after_field_name()
    {
        var ev = AiScheduleSseParser.ParseFrame("event:delta\ndata:{\"text\":\"y\"}");

        Assert.NotNull(ev);
        Assert.Equal("y", ev!.Text);
    }

    // ── request-body adapter (web useMemo body: defaults + depart_by ISO) ─────────────────────────────────

    [Fact]
    public void Request_applies_the_web_defaults_when_inputs_are_unset()
    {
        var request = AiScheduleDraftRequest.FromInputs(
            new AiScheduleDraftInputs { VehicleId = 7, RatePlanId = "tou-1" },
            FixedNow);

        Assert.Equal(7, request.VehicleId);
        Assert.Equal(80, request.TargetSoc);
        Assert.Equal(20, request.CurrentSoc);
        Assert.Equal(32, request.MaxAmps);
        Assert.Equal(75, request.BatteryCapacityKwh);
        Assert.Equal(240, request.ChargerVoltage);
        Assert.True(request.PreferOffPeak);
        Assert.Equal("tou-1", request.RatePlanId);
    }

    [Fact]
    public void Request_passes_explicit_inputs_through()
    {
        var request = AiScheduleDraftRequest.FromInputs(
            new AiScheduleDraftInputs
            {
                VehicleId = 42,
                RatePlanId = "pge-ev2a",
                TargetSoc = 90,
                CurrentSoc = 35,
                MaxAmps = 48,
                BatteryCapacityKwh = 100,
                ChargerVoltage = 208,
                PreferOffPeak = false,
            },
            FixedNow);

        Assert.Equal(42, request.VehicleId);
        Assert.Equal(90, request.TargetSoc);
        Assert.Equal(35, request.CurrentSoc);
        Assert.Equal(48, request.MaxAmps);
        Assert.Equal(100, request.BatteryCapacityKwh);
        Assert.Equal(208, request.ChargerVoltage);
        Assert.False(request.PreferOffPeak);
        Assert.Equal("pge-ev2a", request.RatePlanId);
    }

    [Fact]
    public void Request_vehicle_id_is_zero_when_unresolved()
    {
        var request = AiScheduleDraftRequest.FromInputs(new AiScheduleDraftInputs(), FixedNow);

        Assert.Equal(0, request.VehicleId);
        Assert.Equal(string.Empty, request.RatePlanId);
    }

    [Fact]
    public void Request_depart_by_falls_back_to_now_when_empty()
    {
        var request = AiScheduleDraftRequest.FromInputs(
            new AiScheduleDraftInputs { VehicleId = 7, RatePlanId = "tou-1" },
            FixedNow);

        Assert.Equal("2026-01-02T03:04:05.000Z", request.DepartBy);
    }

    [Fact]
    public void Request_depart_by_falls_back_to_now_when_unparseable()
    {
        var request = AiScheduleDraftRequest.FromInputs(
            new AiScheduleDraftInputs { VehicleId = 7, RatePlanId = "tou-1", DepartBy = "not-a-date" },
            FixedNow);

        Assert.Equal("2026-01-02T03:04:05.000Z", request.DepartBy);
    }

    [Fact]
    public void Request_depart_by_normalizes_an_explicit_utc_instant()
    {
        var request = AiScheduleDraftRequest.FromInputs(
            new AiScheduleDraftInputs { VehicleId = 7, RatePlanId = "tou-1", DepartBy = "2026-03-04T05:06:07Z" },
            FixedNow);

        Assert.Equal("2026-03-04T05:06:07.000Z", request.DepartBy);
    }

    [Fact]
    public void Request_depart_by_converts_an_offset_instant_to_utc()
    {
        var request = AiScheduleDraftRequest.FromInputs(
            new AiScheduleDraftInputs { VehicleId = 7, RatePlanId = "tou-1", DepartBy = "2026-03-04T07:06:07+02:00" },
            FixedNow);

        Assert.Equal("2026-03-04T05:06:07.000Z", request.DepartBy);
    }

    [Fact]
    public void Request_serializes_to_the_web_snake_case_wire_contract()
    {
        var request = AiScheduleDraftRequest.FromInputs(
            new AiScheduleDraftInputs { VehicleId = 7, RatePlanId = "tou-1" },
            FixedNow);

        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(request));
        var root = doc.RootElement;

        Assert.Equal(7, root.GetProperty("vehicle_id").GetInt64());
        Assert.Equal(80, root.GetProperty("target_soc").GetDouble());
        Assert.Equal(20, root.GetProperty("current_soc").GetDouble());
        Assert.Equal(32, root.GetProperty("max_amps").GetDouble());
        Assert.Equal(75, root.GetProperty("battery_capacity_kwh").GetDouble());
        Assert.Equal(240, root.GetProperty("charger_voltage").GetDouble());
        Assert.Equal("tou-1", root.GetProperty("rate_plan_id").GetString());
        Assert.Equal("2026-01-02T03:04:05.000Z", root.GetProperty("depart_by").GetString());
        Assert.True(root.GetProperty("prefer_off_peak").GetBoolean());
    }

    // ── view-model: gate (web withAiFeature / useAiEnabled) ──────────────────────────────────────────────

    [Fact]
    public void Gate_off_keeps_the_surface_closed()
    {
        using var vm = NewViewModel(StaticAiFeatureGate.Off, ResolvedInputs());

        Assert.False(vm.IsGateOpen);
    }

    [Fact]
    public void Gate_on_opens_the_surface()
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On, ResolvedInputs());

        Assert.True(vm.IsGateOpen);
    }

    // ── view-model: initial state + canStart (web haveInputs) ────────────────────────────────────────────

    [Fact]
    public void Initial_state_is_idle_with_no_output()
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On, ResolvedInputs());

        Assert.Equal(AiScheduleStreamState.Idle, vm.State);
        Assert.Equal(string.Empty, vm.DraftText);
        Assert.False(vm.HasOutput);
        Assert.False(vm.IsThinking);
        Assert.False(vm.IsError);
    }

    [Theory]
    [InlineData(null, null, false)]      // no vehicle, no plan
    [InlineData(7L, null, false)]        // vehicle but no plan
    [InlineData(7L, "", false)]          // vehicle but empty plan
    [InlineData(null, "tou-1", false)]   // plan but no vehicle
    [InlineData(0L, "tou-1", false)]     // zero vehicle (web !!0 === false)
    [InlineData(7L, "tou-1", true)]      // both present
    public void CanStart_requires_both_a_vehicle_and_a_rate_plan(long? vehicleId, string? ratePlanId, bool expected)
    {
        using var vm = NewViewModel(
            StaticAiFeatureGate.On,
            new AiScheduleDraftInputs { VehicleId = vehicleId, RatePlanId = ratePlanId });

        Assert.Equal(expected, vm.CanStart);
        Assert.Equal(expected, vm.IsActionEnabled);
    }

    [Fact]
    public void Setting_inputs_reevaluates_can_start()
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On, new AiScheduleDraftInputs { VehicleId = 7 });
        Assert.False(vm.CanStart);

        vm.Inputs = new AiScheduleDraftInputs { VehicleId = 7, RatePlanId = "tou-1" };

        Assert.True(vm.CanStart);
        Assert.True(vm.IsActionEnabled);
    }

    // ── view-model: stream lifecycle (web useAiStream) ───────────────────────────────────────────────────

    [Fact]
    public async Task Start_streams_deltas_into_text_then_completes_done()
    {
        var transport = new FakeScheduleTransport(
            AiScheduleStreamEvent.Delta("Start charging "),
            AiScheduleStreamEvent.Delta("at 01:00 off-peak."),
            AiScheduleStreamEvent.Done());
        using var vm = NewViewModel(StaticAiFeatureGate.On, ResolvedInputs(), transport);
        bool thinkingAtStreamStart = false;
        vm.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(vm.State) && vm.State == AiScheduleStreamState.Streaming)
            {
                thinkingAtStreamStart = vm.IsThinking;
            }
        };

        await vm.StartAsync();

        Assert.Equal("Start charging at 01:00 off-peak.", vm.DraftText);
        Assert.Equal(AiScheduleStreamState.Done, vm.State);
        Assert.True(thinkingAtStreamStart);
        Assert.False(vm.IsThinking);
        Assert.Equal(1, transport.OpenCount);
        Assert.Equal(7, transport.LastRequest?.VehicleId);
        Assert.Equal("tou-1", transport.LastRequest?.RatePlanId);
    }

    [Fact]
    public async Task Start_marks_done_when_the_stream_closes_without_a_terminal_event()
    {
        var transport = new FakeScheduleTransport(AiScheduleStreamEvent.Delta("partial"));
        using var vm = NewViewModel(StaticAiFeatureGate.On, ResolvedInputs(), transport);

        await vm.StartAsync();

        Assert.Equal(AiScheduleStreamState.Done, vm.State);
        Assert.Equal("partial", vm.DraftText);
    }

    [Fact]
    public async Task Start_is_a_no_op_without_a_rate_plan()
    {
        var transport = new FakeScheduleTransport(AiScheduleStreamEvent.Done());
        using var vm = NewViewModel(StaticAiFeatureGate.On, new AiScheduleDraftInputs { VehicleId = 7 }, transport);

        await vm.StartAsync();

        Assert.Equal(AiScheduleStreamState.Idle, vm.State);
        Assert.Equal(0, transport.OpenCount);
    }

    [Fact]
    public async Task Start_is_a_no_op_without_a_vehicle()
    {
        var transport = new FakeScheduleTransport(AiScheduleStreamEvent.Done());
        using var vm = NewViewModel(
            StaticAiFeatureGate.On,
            new AiScheduleDraftInputs { RatePlanId = "tou-1" },
            transport);

        await vm.StartAsync();

        Assert.Equal(AiScheduleStreamState.Idle, vm.State);
        Assert.Equal(0, transport.OpenCount);
    }

    [Fact]
    public async Task Start_is_a_no_op_when_the_gate_is_closed()
    {
        var transport = new FakeScheduleTransport(AiScheduleStreamEvent.Done());
        using var vm = NewViewModel(StaticAiFeatureGate.Off, ResolvedInputs(), transport);

        await vm.StartAsync();

        Assert.Equal(AiScheduleStreamState.Idle, vm.State);
        Assert.Equal(0, transport.OpenCount);
    }

    [Fact]
    public async Task Duplicate_start_while_streaming_is_a_no_op()
    {
        var transport = new FakeScheduleTransport { HoldOpen = true };
        using var vm = NewViewModel(StaticAiFeatureGate.On, ResolvedInputs(), transport);

        var first = vm.StartAsync();
        var second = vm.StartAsync();

        await second; // the second call returns immediately without opening a second stream.
        Assert.Equal(AiScheduleStreamState.Streaming, vm.State);
        Assert.Equal(1, transport.OpenCount);

        vm.Cancel();
        await first;
    }

    [Fact]
    public async Task Error_frame_moves_to_the_error_surface_with_the_helix_message()
    {
        var transport = new FakeScheduleTransport(
            AiScheduleStreamEvent.Error("rate_limited", AiScheduleErrorReason.Stream));
        using var vm = NewViewModel(StaticAiFeatureGate.On, ResolvedInputs(), transport);

        await vm.StartAsync();

        Assert.Equal(AiScheduleStreamState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(vm.IsOffline);
        Assert.Equal("Helix error: rate_limited", vm.DisplayErrorText);
    }

    [Fact]
    public async Task Network_failure_shows_the_offline_message()
    {
        var transport = new FakeScheduleTransport(
            AiScheduleStreamEvent.Error("stream_network", AiScheduleErrorReason.Network));
        using var vm = NewViewModel(StaticAiFeatureGate.On, ResolvedInputs(), transport);

        await vm.StartAsync();

        Assert.Equal(AiScheduleStreamState.Error, vm.State);
        Assert.True(vm.IsOffline);
        Assert.Equal(AISmartChargeScheduleSuggestionRegistration.OfflineFallback, vm.DisplayErrorText);
    }

    [Fact]
    public async Task Confirm_request_frame_pauses_the_stream()
    {
        var transport = new FakeScheduleTransport(AiScheduleStreamEvent.ConfirmRequest());
        using var vm = NewViewModel(StaticAiFeatureGate.On, ResolvedInputs(), transport);

        await vm.StartAsync();

        Assert.Equal(AiScheduleStreamState.PausedConfirm, vm.State);
    }

    [Fact]
    public async Task Cancel_returns_an_in_flight_stream_to_idle()
    {
        var transport = new FakeScheduleTransport(AiScheduleStreamEvent.Delta("started")) { HoldOpen = true };
        using var vm = NewViewModel(StaticAiFeatureGate.On, ResolvedInputs(), transport);

        var run = vm.StartAsync();
        vm.Cancel();
        await run;

        Assert.Equal(AiScheduleStreamState.Idle, vm.State);
    }

    [Fact]
    public async Task Error_then_retry_clears_the_prior_error()
    {
        var transport = new FakeScheduleTransport(
            AiScheduleStreamEvent.Error("boom", AiScheduleErrorReason.Stream));
        using var vm = NewViewModel(StaticAiFeatureGate.On, ResolvedInputs(), transport);
        await vm.StartAsync();
        Assert.Equal(AiScheduleStreamState.Error, vm.State);

        transport.Reset(AiScheduleStreamEvent.Delta("recovered"), AiScheduleStreamEvent.Done());
        await vm.StartAsync();

        Assert.Equal(AiScheduleStreamState.Done, vm.State);
        Assert.Equal("recovered", vm.DraftText);
        Assert.False(vm.IsError);
    }

    // ── view-model: i18n + accessibility labels ──────────────────────────────────────────────────────────

    [Fact]
    public void Labels_resolve_to_the_web_fallback_copy()
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On, ResolvedInputs());

        Assert.Equal("Draft a schedule with Helix", vm.Title);
        Assert.Equal("Draft a schedule", vm.ButtonLabel);
        Assert.Equal("Helix", vm.BadgeLabel);
        Assert.Equal("Ask Helix", vm.AskHelixLabel);
        Assert.Contains("time-of-use-optimized charge schedule", vm.Description, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Action_label_flips_to_the_thinking_copy_while_streaming()
    {
        var transport = new FakeScheduleTransport { HoldOpen = true };
        using var vm = NewViewModel(StaticAiFeatureGate.On, ResolvedInputs(), transport);

        Assert.Equal("Ask Helix", vm.ActionLabel);

        var run = vm.StartAsync();
        Assert.Equal("Helix is thinking\u2026", vm.ActionLabel);

        vm.Cancel();
        await run;
    }

    [Fact]
    public void Action_automation_name_composes_the_helix_cta_and_verb()
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On, ResolvedInputs());

        Assert.Equal("Ask Helix \u00b7 Draft a schedule", vm.ActionAutomationName);
    }

    private static AiScheduleDraftInputs ResolvedInputs() =>
        new() { VehicleId = 7, RatePlanId = "tou-1" };

    private static AISmartChargeScheduleSuggestionViewModel NewViewModel(
        IAiFeatureGate gate,
        AiScheduleDraftInputs inputs,
        IAiScheduleDraftStreamTransport? transport = null) =>
        new(transport ?? new FakeScheduleTransport(), gate, Localizer, inputs, () => FixedNow);

    /// <summary>
    /// A scripted <see cref="IAiScheduleDraftStreamTransport"/> for headless lifecycle tests: yields a fixed
    /// event sequence and (optionally) holds the stream open afterwards so cancel / duplicate-start paths are
    /// exercised deterministically. Records the open count and the last request body.
    /// </summary>
    private sealed class FakeScheduleTransport : IAiScheduleDraftStreamTransport
    {
        private AiScheduleStreamEvent[] _events;
        private int _openCount;

        public FakeScheduleTransport(params AiScheduleStreamEvent[] events) => _events = events;

        /// <summary>When true the stream stays open after the scripted events until cancelled.</summary>
        public bool HoldOpen { get; init; }

        public int OpenCount => Volatile.Read(ref _openCount);

        public AiScheduleDraftRequest? LastRequest { get; private set; }

        public void Reset(params AiScheduleStreamEvent[] events) => _events = events;

        public async IAsyncEnumerable<AiScheduleStreamEvent> StreamAsync(
            AiScheduleDraftRequest request,
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
