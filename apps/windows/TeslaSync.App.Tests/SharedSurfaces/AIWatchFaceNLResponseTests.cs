using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Settings;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the watch-face natural-language Helix narrator surface's UI-thread-free logic — the
/// SSE frame parser (the native port of useAiStream's parseSSEFrame/toTypedEvent), the registration metadata +
/// AI feature-registry membership, the PII-safe diagnostics, the optional-<c>message</c> request body shape, and
/// the view-model's gate / canStart / stream lifecycle state machine (idle → streaming → done / error,
/// duplicate-start no-op, cancel → idle, offline classification, paused-confirm guard, and the empty-question
/// default-summary contract). Mirrors the web spec (web/src/components/ai/AIWatchFaceNLResponse.tsx +
/// AIFeatureCard.tsx + useAiStream.ts). The WinUI view (shared-surfaces/AIWatchFaceNLResponse.cs) is exercised
/// by the app build.
/// </summary>
public sealed class AIWatchFaceNLResponseTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // ── registration + registry membership ───────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("AIWatchFaceNLResponse", AIWatchFaceNLResponseRegistration.Slug);

    [Fact]
    public void Feature_id_is_present_in_the_canonical_registry()
    {
        Assert.True(AIWatchFaceNLResponseRegistration.IsRegisteredFeature(AIWatchFaceNLResponseRegistration.FeatureId));
        Assert.Contains(AiFeatureRegistry.Features, m => m.Id == AIWatchFaceNLResponseRegistration.FeatureId);
    }

    [Fact]
    public void Unknown_feature_id_is_not_registered() =>
        Assert.False(AIWatchFaceNLResponseRegistration.IsRegisteredFeature("not-a-real-feature"));

    [Fact]
    public void Respond_path_is_the_web_endpoint_without_the_version_prefix() =>
        Assert.Equal("/ai/watch/respond", AIWatchFaceNLResponseRegistration.RespondPath);

    [Fact]
    public void Root_automation_id_matches_the_web_off_mode_test_id() =>
        Assert.Equal("ai-feature-watch-face-nl-response-root", AIWatchFaceNLResponseRegistration.RootAutomationId);

    [Fact]
    public void Feature_id_matches_the_web_with_ai_feature_slug() =>
        Assert.Equal("watch-face-nl-response", AIWatchFaceNLResponseRegistration.FeatureId);

    [Fact]
    public void Max_message_chars_matches_the_web_cap() =>
        Assert.Equal(1000, AIWatchFaceNLResponseRegistration.MaxMessageChars);

    // ── diagnostics: view.opened, PII-safe (P1/S11) ──────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new AIWatchFaceNLResponseDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=AIWatchFaceNLResponse", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_without_a_sink_still_count_opens()
    {
        var diagnostics = new AIWatchFaceNLResponseDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    [Fact]
    public void Diagnostics_never_leak_the_question_or_narration()
    {
        var lines = new List<string>();
        var diagnostics = new AIWatchFaceNLResponseDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(lines);
        Assert.DoesNotContain('?', line);
        Assert.StartsWith("view.opened slug=", line, StringComparison.Ordinal);
    }

    // ── request body shape (web body { message: trimmed || undefined }) ──────────────────────────────────

    [Fact]
    public void Empty_question_serializes_to_an_empty_body()
    {
        Assert.Equal("{}", JsonSerializer.Serialize(new AiWatchRequest(null)));
        Assert.Equal("{}", JsonSerializer.Serialize(new AiWatchRequest(string.Empty)));
    }

    [Fact]
    public void Non_empty_question_serializes_the_message_field()
    {
        Assert.Equal("{\"message\":\"is the car locked?\"}",
            JsonSerializer.Serialize(new AiWatchRequest("is the car locked?")));
    }

    // ── SSE parser (web parseSSEFrame / toTypedEvent) ────────────────────────────────────────────────────

    [Fact]
    public void Parser_reads_a_delta_frame()
    {
        var ev = AiWatchSseParser.ParseFrame("event: delta\ndata: {\"text\":\"Battery is \"}");

        Assert.NotNull(ev);
        Assert.Equal(AiWatchEventKind.Delta, ev!.Kind);
        Assert.Equal("Battery is ", ev.Text);
    }

    [Fact]
    public void Parser_reads_a_done_frame()
    {
        var ev = AiWatchSseParser.ParseFrame("event: done\ndata: {\"finish_reason\":\"stop\",\"usage\":{\"in\":1,\"out\":2}}");

        Assert.NotNull(ev);
        Assert.Equal(AiWatchEventKind.Done, ev!.Kind);
    }

    [Fact]
    public void Parser_reads_an_error_frame_with_its_message()
    {
        var ev = AiWatchSseParser.ParseFrame("event: error\ndata: {\"message\":\"rate_limited\"}");

        Assert.NotNull(ev);
        Assert.Equal(AiWatchEventKind.Error, ev!.Kind);
        Assert.Equal("rate_limited", ev.Message);
        Assert.Equal(AiWatchErrorReason.Stream, ev.ErrorReason);
    }

    [Fact]
    public void Parser_reads_a_confirm_request_frame()
    {
        var ev = AiWatchSseParser.ParseFrame(
            "event: confirm_request\ndata: {\"continuation_id\":\"c1\",\"tool\":\"t\",\"summary\":\"ok?\"}");

        Assert.NotNull(ev);
        Assert.Equal(AiWatchEventKind.ConfirmRequest, ev!.Kind);
    }

    [Fact]
    public void Parser_reads_tool_frames_but_keeps_no_payload()
    {
        var toolCall = AiWatchSseParser.ParseFrame("event: tool_call\ndata: {\"id\":\"t1\",\"name\":\"query_watch_context\"}");
        var toolResult = AiWatchSseParser.ParseFrame(
            "event: tool_result\ndata: {\"id\":\"t1\",\"name\":\"query_watch_context\",\"ok\":true,\"data\":[1,2]}");

        Assert.Equal(AiWatchEventKind.ToolCall, toolCall!.Kind);
        Assert.Equal(AiWatchEventKind.ToolResult, toolResult!.Kind);
    }

    [Fact]
    public void Parser_drops_a_delta_frame_without_text()
    {
        Assert.Null(AiWatchSseParser.ParseFrame("event: delta\ndata: {\"notText\":1}"));
        Assert.Null(AiWatchSseParser.ParseFrame("event: delta\ndata: {\"text\":5}"));
    }

    [Fact]
    public void Parser_drops_tool_frames_missing_required_fields()
    {
        Assert.Null(AiWatchSseParser.ParseFrame("event: tool_call\ndata: {\"id\":\"t1\"}"));
        Assert.Null(AiWatchSseParser.ParseFrame("event: tool_result\ndata: {\"id\":\"t1\",\"name\":\"x\"}"));
    }

    [Theory]
    [InlineData("event: future_event\ndata: {\"x\":1}")]
    [InlineData("event: delta\ndata: not json")]
    [InlineData("event: delta\ndata: 5")]
    [InlineData("event: delta")]
    [InlineData("data: {\"text\":\"hi\"}")]
    [InlineData(": keep-alive comment")]
    public void Parser_drops_unknown_malformed_or_eventless_frames(string raw) =>
        Assert.Null(AiWatchSseParser.ParseFrame(raw));

    [Fact]
    public void Parser_handles_the_bare_event_data_prefixes()
    {
        // The web parser also accepts `event:`/`data:` without the trailing space.
        var ev = AiWatchSseParser.ParseFrame("event:delta\ndata:{\"text\":\"x\"}");

        Assert.NotNull(ev);
        Assert.Equal("x", ev!.Text);
    }

    [Fact]
    public void ToTypedEvent_rejects_a_non_object_payload() =>
        Assert.Null(AiWatchSseParser.ToTypedEvent("delta", Json("5")));

    [Fact]
    public void ToTypedEvent_reads_a_delta()
    {
        var ev = AiWatchSseParser.ToTypedEvent("delta", Json("{\"text\":\"hi\"}"));

        Assert.NotNull(ev);
        Assert.Equal("hi", ev!.Text);
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

    // ── view-model: initial state + canStart (web canStart = messageWithinCap && state != paused-confirm) ─

    [Fact]
    public void Initial_state_is_idle_with_no_output()
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On);

        Assert.Equal(AiWatchStreamState.Idle, vm.State);
        Assert.Equal(string.Empty, vm.AssistantText);
        Assert.False(vm.HasOutput);
        Assert.False(vm.IsThinking);
        Assert.False(vm.IsError);
        Assert.False(vm.IsOffline);
    }

    [Fact]
    public void CanStart_allows_an_empty_question_for_the_default_summary()
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On);

        // web: an empty message is allowed — the backend applies a default-summary prompt.
        Assert.True(vm.CanStart);
        Assert.True(vm.IsActionEnabled);
        Assert.True(vm.MessageWithinCap);
    }

    [Theory]
    [InlineData("", true)]
    [InlineData("   ", true)]
    [InlineData("how is my battery?", true)]
    public void CanStart_is_true_for_questions_within_the_cap(string message, bool expected)
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On);
        vm.Message = message;

        Assert.Equal(expected, vm.CanStart);
        Assert.Equal(expected, vm.IsActionEnabled);
    }

    [Fact]
    public void CanStart_is_false_when_the_question_exceeds_the_cap()
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On);
        vm.Message = new string('x', AIWatchFaceNLResponseRegistration.MaxMessageChars + 1);

        Assert.False(vm.MessageWithinCap);
        Assert.False(vm.CanStart);
        Assert.False(vm.IsActionEnabled);
    }

    [Fact]
    public void CanStart_treats_a_question_exactly_at_the_cap_as_valid()
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On);
        vm.Message = new string('x', AIWatchFaceNLResponseRegistration.MaxMessageChars);

        Assert.True(vm.MessageWithinCap);
        Assert.True(vm.CanStart);
    }

    [Fact]
    public void Setting_message_reevaluates_can_start()
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On);
        var raised = new List<string>();
        vm.PropertyChanged += (_, e) => raised.Add(e.PropertyName ?? string.Empty);

        vm.Message = "is the car charging?";

        Assert.Contains(nameof(vm.CanStart), raised);
        Assert.Contains(nameof(vm.IsActionEnabled), raised);
        Assert.Contains(nameof(vm.MessageWithinCap), raised);
    }

    // ── view-model: stream lifecycle (web useAiStream) ───────────────────────────────────────────────────

    [Fact]
    public async Task Start_streams_deltas_into_text_then_completes_done()
    {
        var transport = new FakeAiWatchTransport(
            AiWatchStreamEvent.Delta("Battery is at 82%, "),
            AiWatchStreamEvent.Delta("the car is locked."),
            AiWatchStreamEvent.Done());
        using var vm = Ready(transport, "how is my battery?");
        bool thinkingAtStreamStart = false;
        vm.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(vm.State) && vm.State == AiWatchStreamState.Streaming)
            {
                thinkingAtStreamStart = vm.IsThinking;
            }
        };

        await vm.StartAsync();

        Assert.Equal("Battery is at 82%, the car is locked.", vm.AssistantText);
        Assert.Equal(AiWatchStreamState.Done, vm.State);
        Assert.True(thinkingAtStreamStart);
        Assert.False(vm.IsThinking);
        Assert.True(vm.HasOutput);
        Assert.Equal(1, transport.OpenCount);
        Assert.Equal("how is my battery?", transport.LastRequest?.Message);
    }

    [Fact]
    public async Task Start_with_an_empty_question_sends_the_default_summary_body()
    {
        var transport = new FakeAiWatchTransport(AiWatchStreamEvent.Delta("Summary."), AiWatchStreamEvent.Done());
        using var vm = NewViewModel(StaticAiFeatureGate.On, transport);

        // web: empty textarea → body { message: undefined } → {} → backend default summary.
        await vm.StartAsync();

        Assert.Equal(1, transport.OpenCount);
        Assert.Null(transport.LastRequest?.Message);
        Assert.Equal(AiWatchStreamState.Done, vm.State);
        Assert.Equal("Summary.", vm.AssistantText);
    }

    [Fact]
    public async Task Start_marks_done_when_the_stream_closes_without_a_terminal_event()
    {
        var transport = new FakeAiWatchTransport(AiWatchStreamEvent.Delta("partial narration"));
        using var vm = Ready(transport, "status?");

        await vm.StartAsync();

        Assert.Equal(AiWatchStreamState.Done, vm.State);
        Assert.Equal("partial narration", vm.AssistantText);
    }

    [Fact]
    public async Task Start_trims_the_question_in_the_request_body()
    {
        var transport = new FakeAiWatchTransport(AiWatchStreamEvent.Done());
        using var vm = NewViewModel(StaticAiFeatureGate.On, transport);
        vm.Message = "   how is my battery?   ";

        await vm.StartAsync();

        Assert.Equal("how is my battery?", transport.LastRequest?.Message);
    }

    [Fact]
    public async Task Start_with_a_whitespace_only_question_sends_the_default_summary_body()
    {
        var transport = new FakeAiWatchTransport(AiWatchStreamEvent.Done());
        using var vm = NewViewModel(StaticAiFeatureGate.On, transport);
        vm.Message = "    ";

        await vm.StartAsync();

        Assert.Equal(1, transport.OpenCount);
        Assert.Null(transport.LastRequest?.Message);
    }

    [Fact]
    public async Task Start_is_a_no_op_when_the_question_exceeds_the_cap()
    {
        var transport = new FakeAiWatchTransport(AiWatchStreamEvent.Done());
        using var vm = NewViewModel(StaticAiFeatureGate.On, transport);
        vm.Message = new string('x', AIWatchFaceNLResponseRegistration.MaxMessageChars + 1);

        await vm.StartAsync();

        Assert.Equal(AiWatchStreamState.Idle, vm.State);
        Assert.Equal(0, transport.OpenCount);
    }

    [Fact]
    public async Task Start_is_a_no_op_when_the_gate_is_closed()
    {
        var transport = new FakeAiWatchTransport(AiWatchStreamEvent.Done());
        using var vm = NewViewModel(StaticAiFeatureGate.Off, transport);
        vm.Message = "a question";

        await vm.StartAsync();

        Assert.Equal(AiWatchStreamState.Idle, vm.State);
        Assert.Equal(0, transport.OpenCount);
    }

    [Fact]
    public async Task Duplicate_start_while_streaming_is_a_no_op()
    {
        var transport = new FakeAiWatchTransport { HoldOpen = true };
        using var vm = Ready(transport, "status?");

        var first = vm.StartAsync();
        var second = vm.StartAsync();

        await second; // returns immediately without opening a second stream.
        Assert.Equal(AiWatchStreamState.Streaming, vm.State);
        Assert.Equal(1, transport.OpenCount);

        vm.Cancel();
        await first;
    }

    [Fact]
    public async Task Streaming_state_flips_button_label_and_disables_action()
    {
        var transport = new FakeAiWatchTransport { HoldOpen = true };
        using var vm = Ready(transport, "status?");

        var run = vm.StartAsync();

        Assert.Equal(AiWatchStreamState.Streaming, vm.State);
        Assert.True(vm.IsStreaming);
        Assert.Equal("Helix is thinking\u2026", vm.ActionLabel);
        Assert.False(vm.IsActionEnabled);
        Assert.True(vm.IsThinking);

        vm.Cancel();
        await run;
    }

    // ── view-model: error / offline / confirm / cancel ───────────────────────────────────────────────────

    [Fact]
    public async Task Error_frame_moves_to_the_error_surface_with_the_helix_message()
    {
        var transport = new FakeAiWatchTransport(
            AiWatchStreamEvent.Error("rate_limited", AiWatchErrorReason.Stream));
        using var vm = Ready(transport, "status?");

        await vm.StartAsync();

        Assert.Equal(AiWatchStreamState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(vm.IsOffline);
        Assert.Equal("Helix error: rate_limited", vm.DisplayErrorText);
    }

    [Fact]
    public async Task Network_failure_shows_the_offline_message()
    {
        var transport = new FakeAiWatchTransport(
            AiWatchStreamEvent.Error("stream_network", AiWatchErrorReason.Network));
        using var vm = Ready(transport, "status?");

        await vm.StartAsync();

        Assert.Equal(AiWatchStreamState.Error, vm.State);
        Assert.True(vm.IsOffline);
        Assert.Equal(AIWatchFaceNLResponseRegistration.OfflineFallback, vm.DisplayErrorText);
    }

    [Fact]
    public async Task Error_frame_without_a_message_uses_the_unknown_fallback()
    {
        var transport = new FakeAiWatchTransport(
            AiWatchStreamEvent.Error(string.Empty, AiWatchErrorReason.Stream));
        using var vm = Ready(transport, "status?");

        await vm.StartAsync();

        Assert.Equal("Helix error: unknown", vm.DisplayErrorText);
    }

    [Fact]
    public async Task Confirm_request_frame_pauses_the_stream_and_blocks_restart()
    {
        var transport = new FakeAiWatchTransport(AiWatchStreamEvent.ConfirmRequest());
        using var vm = Ready(transport, "lock the car");

        await vm.StartAsync();

        Assert.Equal(AiWatchStreamState.PausedConfirm, vm.State);

        // web canStart excludes paused-confirm — a restart is a no-op.
        Assert.False(vm.CanStart);
        await vm.StartAsync();
        Assert.Equal(1, transport.OpenCount);
    }

    [Fact]
    public async Task Cancel_returns_an_in_flight_stream_to_idle()
    {
        var transport = new FakeAiWatchTransport(AiWatchStreamEvent.Delta("started")) { HoldOpen = true };
        using var vm = Ready(transport, "status?");

        var run = vm.StartAsync();
        vm.Cancel();
        await run;

        Assert.Equal(AiWatchStreamState.Idle, vm.State);
    }

    [Fact]
    public async Task Error_then_retry_clears_the_prior_error()
    {
        var transport = new FakeAiWatchTransport(
            AiWatchStreamEvent.Error("boom", AiWatchErrorReason.Stream));
        using var vm = Ready(transport, "status?");
        await vm.StartAsync();
        Assert.Equal(AiWatchStreamState.Error, vm.State);

        transport.Reset(AiWatchStreamEvent.Delta("recovered"), AiWatchStreamEvent.Done());
        await vm.StartAsync();

        Assert.Equal(AiWatchStreamState.Done, vm.State);
        Assert.Equal("recovered", vm.AssistantText);
        Assert.False(vm.IsError);
        Assert.Equal(string.Empty, vm.DisplayErrorText);
    }

    [Fact]
    public async Task Tool_frames_do_not_change_visible_state()
    {
        var transport = new FakeAiWatchTransport(
            AiWatchStreamEvent.ToolCall(),
            AiWatchStreamEvent.ToolResult(),
            AiWatchStreamEvent.Delta("grounded narration"),
            AiWatchStreamEvent.Done());
        using var vm = Ready(transport, "status?");

        await vm.StartAsync();

        Assert.Equal(AiWatchStreamState.Done, vm.State);
        Assert.Equal("grounded narration", vm.AssistantText);
    }

    // ── view-model: i18n + accessibility labels (web AIFeatureCard copy) ─────────────────────────────────

    [Fact]
    public void Labels_resolve_to_the_web_fallback_copy()
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On);

        Assert.Equal("Ask Helix about your watch face", vm.Title);
        Assert.Equal(AIWatchFaceNLResponseRegistration.DescriptionFallback, vm.Description);
        Assert.Equal("Ask about my car", vm.ButtonLabel);
        Assert.Equal("Helix", vm.BadgeLabel);
        Assert.Equal("e.g. how is my battery? Is the car locked? Leave empty for a summary.", vm.Placeholder);
        Assert.Equal("Your question for Helix", vm.InputLabel);
        Assert.Equal("Ask Helix", vm.AskHelixLabel);
        Assert.Equal("Helix is thinking\u2026", vm.ThinkingLabel);
    }

    [Fact]
    public void Description_matches_the_web_source_verbatim() =>
        Assert.Equal(
            "Ask Helix a glance-style natural-language question about your vehicle right now \u2014 battery, " +
            "range, charging, locks, climate, recent alerts. Helix only reads a typed snapshot of canonical " +
            "state values; it never claims to have changed a setting or sent a vehicle command. To lock, " +
            "unlock, start climate, or send another command use the watch-face tap icons or the phone app.",
            AIWatchFaceNLResponseRegistration.DescriptionFallback);

    [Fact]
    public void Action_label_is_the_universal_cta_when_idle()
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On);

        Assert.Equal("Ask Helix", vm.ActionLabel);
    }

    [Fact]
    public void Action_accessible_name_composes_the_cta_and_the_per_feature_verb()
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On);

        // web AIFeatureCard: aria-label = `${askHelixLabel} · ${buttonLabel}`.
        Assert.Equal("Ask Helix \u00b7 Ask about my car", vm.ActionAutomationName);
        Assert.Contains(vm.AskHelixLabel, vm.ActionAutomationName, StringComparison.Ordinal);
        Assert.Contains(vm.ButtonLabel, vm.ActionAutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Labels_consult_every_catalog_key()
    {
        var localizer = new MapLocalizer(new Dictionary<string, string>(StringComparer.Ordinal)
        {
            [AIWatchFaceNLResponseRegistration.TitleKey] = "T",
            [AIWatchFaceNLResponseRegistration.DescriptionKey] = "D",
            [AIWatchFaceNLResponseRegistration.ButtonKey] = "Bt",
            [AIWatchFaceNLResponseRegistration.BadgeKey] = "B",
            [AIWatchFaceNLResponseRegistration.PlaceholderKey] = "P",
            [AIWatchFaceNLResponseRegistration.InputLabelKey] = "Il",
            [AIWatchFaceNLResponseRegistration.AskHelixKey] = "A",
            [AIWatchFaceNLResponseRegistration.ThinkingKey] = "K",
        });
        using var vm = new AIWatchFaceNLResponseViewModel(new FakeAiWatchTransport(), StaticAiFeatureGate.On, localizer);

        Assert.Equal("T", vm.Title);
        Assert.Equal("D", vm.Description);
        Assert.Equal("Bt", vm.ButtonLabel);
        Assert.Equal("B", vm.BadgeLabel);
        Assert.Equal("P", vm.Placeholder);
        Assert.Equal("Il", vm.InputLabel);
        Assert.Equal("A", vm.AskHelixLabel);
        Assert.Equal("K", vm.ThinkingLabel);
        Assert.Equal("A \u00b7 Bt", vm.ActionAutomationName);
    }

    // ── helpers ──────────────────────────────────────────────────────────────────────────────────────────

    private static AIWatchFaceNLResponseViewModel NewViewModel(
        IAiFeatureGate gate,
        IAiWatchStreamTransport? transport = null) =>
        new(transport ?? new FakeAiWatchTransport(), gate, Localizer);

    private static AIWatchFaceNLResponseViewModel Ready(IAiWatchStreamTransport transport, string message)
    {
        var vm = new AIWatchFaceNLResponseViewModel(transport, StaticAiFeatureGate.On, Localizer)
        {
            Message = message,
        };
        return vm;
    }

    private static JsonElement Json(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }

    private sealed class MapLocalizer : ILocalizer
    {
        private readonly IReadOnlyDictionary<string, string> _map;

        public MapLocalizer(IReadOnlyDictionary<string, string> map) => _map = map;

        public string GetString(string key, string fallback) =>
            _map.TryGetValue(key, out var value) ? value : fallback;
    }

    private sealed class FakeAiWatchTransport : IAiWatchStreamTransport
    {
        private AiWatchStreamEvent[] _events;

        public FakeAiWatchTransport(params AiWatchStreamEvent[] events) => _events = events;

        public bool HoldOpen { get; init; }

        public int OpenCount { get; private set; }

        public AiWatchRequest? LastRequest { get; private set; }

        public void Reset(params AiWatchStreamEvent[] events) => _events = events;

        public async IAsyncEnumerable<AiWatchStreamEvent> StreamAsync(
            AiWatchRequest request,
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            OpenCount++;
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
