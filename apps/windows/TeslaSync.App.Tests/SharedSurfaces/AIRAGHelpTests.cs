using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Settings;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the RAG-backed application-help surface's UI-thread-free logic — the SSE frame
/// parser (the native port of useAiStream's parseSSEFrame/toTypedEvent), the registration metadata + AI
/// feature-registry membership, the PII-safe diagnostics, and the view-model's gate / canStart / stream
/// lifecycle state machine (idle → streaming → done / error, duplicate-start no-op, cancel → idle, offline
/// classification, and the prompt-trimmed request body). Mirrors the web spec
/// (web/src/components/ai/AIRAGHelp.tsx + AIFeatureCard.tsx + useAiStream.ts). The WinUI view
/// (shared-surfaces/AIRAGHelp.cs) is exercised by the app build.
/// </summary>
public sealed class AIRAGHelpTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // ── registration + registry membership ───────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("AIRAGHelp", AIRAGHelpRegistration.Slug);

    [Fact]
    public void Feature_id_is_present_in_the_canonical_registry()
    {
        Assert.True(AIRAGHelpRegistration.IsRegisteredFeature(AIRAGHelpRegistration.FeatureId));
        Assert.Contains(AiFeatureRegistry.Features, m => m.Id == AIRAGHelpRegistration.FeatureId);
    }

    [Fact]
    public void Unknown_feature_id_is_not_registered() =>
        Assert.False(AIRAGHelpRegistration.IsRegisteredFeature("not-a-real-feature"));

    [Fact]
    public void Query_path_is_the_web_endpoint_without_the_version_prefix() =>
        Assert.Equal("/ai/help/query", AIRAGHelpRegistration.QueryPath);

    [Fact]
    public void Root_automation_id_matches_the_web_off_mode_test_id() =>
        Assert.Equal("ai-feature-rag-help-root", AIRAGHelpRegistration.RootAutomationId);

    [Fact]
    public void Feature_id_matches_the_web_with_ai_feature_slug() =>
        Assert.Equal("rag-help", AIRAGHelpRegistration.FeatureId);

    // ── diagnostics: view.opened, PII-safe (P1/S11) ──────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new AIRAGHelpDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=AIRAGHelp", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_without_a_sink_still_count_opens()
    {
        var diagnostics = new AIRAGHelpDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    [Fact]
    public void Diagnostics_never_leak_the_question_or_answer()
    {
        var lines = new List<string>();
        var diagnostics = new AIRAGHelpDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(lines);
        Assert.DoesNotContain('?', line);
        Assert.StartsWith("view.opened slug=", line, StringComparison.Ordinal);
    }

    // ── SSE parser (web parseSSEFrame / toTypedEvent) ────────────────────────────────────────────────────

    [Fact]
    public void Parser_reads_a_delta_frame()
    {
        var ev = AiHelpSseParser.ParseFrame("event: delta\ndata: {\"text\":\"Answering \"}");

        Assert.NotNull(ev);
        Assert.Equal(AiHelpEventKind.Delta, ev!.Kind);
        Assert.Equal("Answering ", ev.Text);
    }

    [Fact]
    public void Parser_reads_a_done_frame()
    {
        var ev = AiHelpSseParser.ParseFrame("event: done\ndata: {\"finish_reason\":\"stop\",\"usage\":{\"in\":1,\"out\":2}}");

        Assert.NotNull(ev);
        Assert.Equal(AiHelpEventKind.Done, ev!.Kind);
    }

    [Fact]
    public void Parser_reads_an_error_frame_with_its_message()
    {
        var ev = AiHelpSseParser.ParseFrame("event: error\ndata: {\"message\":\"rate_limited\"}");

        Assert.NotNull(ev);
        Assert.Equal(AiHelpEventKind.Error, ev!.Kind);
        Assert.Equal("rate_limited", ev.Message);
        Assert.Equal(AiHelpErrorReason.Stream, ev.ErrorReason);
    }

    [Fact]
    public void Parser_reads_a_confirm_request_frame()
    {
        var ev = AiHelpSseParser.ParseFrame(
            "event: confirm_request\ndata: {\"continuation_id\":\"c1\",\"tool\":\"t\",\"summary\":\"ok?\"}");

        Assert.NotNull(ev);
        Assert.Equal(AiHelpEventKind.ConfirmRequest, ev!.Kind);
    }

    [Fact]
    public void Parser_reads_tool_frames_but_keeps_no_payload()
    {
        var toolCall = AiHelpSseParser.ParseFrame("event: tool_call\ndata: {\"id\":\"t1\",\"name\":\"retrieve_docs\"}");
        var toolResult = AiHelpSseParser.ParseFrame(
            "event: tool_result\ndata: {\"id\":\"t1\",\"name\":\"retrieve_docs\",\"ok\":true,\"data\":[1,2]}");

        Assert.Equal(AiHelpEventKind.ToolCall, toolCall!.Kind);
        Assert.Equal(AiHelpEventKind.ToolResult, toolResult!.Kind);
    }

    [Fact]
    public void Parser_drops_a_delta_frame_without_text()
    {
        Assert.Null(AiHelpSseParser.ParseFrame("event: delta\ndata: {\"notText\":1}"));
        Assert.Null(AiHelpSseParser.ParseFrame("event: delta\ndata: {\"text\":5}"));
    }

    [Fact]
    public void Parser_drops_tool_frames_missing_required_fields()
    {
        Assert.Null(AiHelpSseParser.ParseFrame("event: tool_call\ndata: {\"id\":\"t1\"}"));
        Assert.Null(AiHelpSseParser.ParseFrame("event: tool_result\ndata: {\"id\":\"t1\",\"name\":\"x\"}"));
    }

    [Theory]
    [InlineData("event: future_event\ndata: {\"x\":1}")]
    [InlineData("event: delta\ndata: not json")]
    [InlineData("event: delta\ndata: 5")]
    [InlineData("event: delta")]
    [InlineData("data: {\"text\":\"hi\"}")]
    [InlineData(": keep-alive comment")]
    public void Parser_drops_unknown_malformed_or_eventless_frames(string raw) =>
        Assert.Null(AiHelpSseParser.ParseFrame(raw));

    [Fact]
    public void Parser_handles_the_bare_event_data_prefixes()
    {
        // The web parser also accepts `event:`/`data:` without the trailing space.
        var ev = AiHelpSseParser.ParseFrame("event:delta\ndata:{\"text\":\"x\"}");

        Assert.NotNull(ev);
        Assert.Equal("x", ev!.Text);
    }

    [Fact]
    public void ToTypedEvent_rejects_a_non_object_payload() =>
        Assert.Null(AiHelpSseParser.ToTypedEvent("delta", Json("5")));

    [Fact]
    public void ToTypedEvent_reads_a_delta()
    {
        var ev = AiHelpSseParser.ToTypedEvent("delta", Json("{\"text\":\"hi\"}"));

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

    // ── view-model: initial state + canStart (web canStart = prompt.trim().length > 0) ───────────────────

    [Fact]
    public void Initial_state_is_idle_with_no_output()
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On);

        Assert.Equal(AiHelpStreamState.Idle, vm.State);
        Assert.Equal(string.Empty, vm.AssistantText);
        Assert.False(vm.HasOutput);
        Assert.False(vm.IsThinking);
        Assert.False(vm.IsError);
        Assert.False(vm.IsOffline);
        Assert.False(vm.CanStart);
    }

    [Theory]
    [InlineData("", false)]
    [InlineData("   ", false)]
    [InlineData("How do I export drives?", true)]
    public void CanStart_requires_a_non_blank_prompt(string prompt, bool expected)
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On);
        vm.Prompt = prompt;

        Assert.Equal(expected, vm.CanStart);
        Assert.Equal(expected, vm.IsActionEnabled);
    }

    [Fact]
    public void Setting_prompt_reevaluates_can_start()
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On);
        Assert.False(vm.CanStart);

        vm.Prompt = "How do I enable energy cost forecasting?";

        Assert.True(vm.CanStart);
        Assert.True(vm.IsActionEnabled);
    }

    // ── view-model: stream lifecycle (web useAiStream) ───────────────────────────────────────────────────

    [Fact]
    public async Task Start_streams_deltas_into_text_then_completes_done()
    {
        var transport = new FakeAiHelpTransport(
            AiHelpStreamEvent.Delta("To export, "),
            AiHelpStreamEvent.Delta("open Settings."),
            AiHelpStreamEvent.Done());
        using var vm = Ready(transport);
        bool thinkingAtStreamStart = false;
        vm.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(vm.State) && vm.State == AiHelpStreamState.Streaming)
            {
                thinkingAtStreamStart = vm.IsThinking;
            }
        };

        await vm.StartAsync();

        Assert.Equal("To export, open Settings.", vm.AssistantText);
        Assert.Equal(AiHelpStreamState.Done, vm.State);
        Assert.True(thinkingAtStreamStart);
        Assert.False(vm.IsThinking);
        Assert.True(vm.HasOutput);
        Assert.Equal(1, transport.OpenCount);
        Assert.Equal("How do I export drives?", transport.LastRequest?.Prompt);
    }

    [Fact]
    public async Task Start_marks_done_when_the_stream_closes_without_a_terminal_event()
    {
        var transport = new FakeAiHelpTransport(AiHelpStreamEvent.Delta("partial answer"));
        using var vm = Ready(transport);

        await vm.StartAsync();

        Assert.Equal(AiHelpStreamState.Done, vm.State);
        Assert.Equal("partial answer", vm.AssistantText);
    }

    [Fact]
    public async Task Start_trims_the_prompt_in_the_request_body()
    {
        var transport = new FakeAiHelpTransport(AiHelpStreamEvent.Done());
        using var vm = NewViewModel(StaticAiFeatureGate.On, transport);
        vm.Prompt = "   How do I export drives?   ";

        await vm.StartAsync();

        Assert.Equal("How do I export drives?", transport.LastRequest?.Prompt);
    }

    [Fact]
    public async Task Start_is_a_no_op_without_a_prompt()
    {
        var transport = new FakeAiHelpTransport(AiHelpStreamEvent.Done());
        using var vm = NewViewModel(StaticAiFeatureGate.On, transport);

        await vm.StartAsync();

        Assert.Equal(AiHelpStreamState.Idle, vm.State);
        Assert.Equal(0, transport.OpenCount);
    }

    [Fact]
    public async Task Start_is_a_no_op_when_the_gate_is_closed()
    {
        var transport = new FakeAiHelpTransport(AiHelpStreamEvent.Done());
        using var vm = NewViewModel(StaticAiFeatureGate.Off, transport);
        vm.Prompt = "a question";

        await vm.StartAsync();

        Assert.Equal(AiHelpStreamState.Idle, vm.State);
        Assert.Equal(0, transport.OpenCount);
    }

    [Fact]
    public async Task Duplicate_start_while_streaming_is_a_no_op()
    {
        var transport = new FakeAiHelpTransport { HoldOpen = true };
        using var vm = Ready(transport);

        var first = vm.StartAsync();
        var second = vm.StartAsync();

        await second; // returns immediately without opening a second stream.
        Assert.Equal(AiHelpStreamState.Streaming, vm.State);
        Assert.Equal(1, transport.OpenCount);

        vm.Cancel();
        await first;
    }

    [Fact]
    public async Task Streaming_state_flips_button_label_and_disables_action()
    {
        var transport = new FakeAiHelpTransport { HoldOpen = true };
        using var vm = Ready(transport);

        var run = vm.StartAsync();

        Assert.Equal(AiHelpStreamState.Streaming, vm.State);
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
        var transport = new FakeAiHelpTransport(
            AiHelpStreamEvent.Error("rate_limited", AiHelpErrorReason.Stream));
        using var vm = Ready(transport);

        await vm.StartAsync();

        Assert.Equal(AiHelpStreamState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(vm.IsOffline);
        Assert.Equal("Helix error: rate_limited", vm.DisplayErrorText);
    }

    [Fact]
    public async Task Network_failure_shows_the_offline_message()
    {
        var transport = new FakeAiHelpTransport(
            AiHelpStreamEvent.Error("stream_network", AiHelpErrorReason.Network));
        using var vm = Ready(transport);

        await vm.StartAsync();

        Assert.Equal(AiHelpStreamState.Error, vm.State);
        Assert.True(vm.IsOffline);
        Assert.Equal(AIRAGHelpRegistration.OfflineFallback, vm.DisplayErrorText);
    }

    [Fact]
    public async Task Error_frame_without_a_message_uses_the_unknown_fallback()
    {
        var transport = new FakeAiHelpTransport(
            AiHelpStreamEvent.Error(string.Empty, AiHelpErrorReason.Stream));
        using var vm = Ready(transport);

        await vm.StartAsync();

        Assert.Equal("Helix error: unknown", vm.DisplayErrorText);
    }

    [Fact]
    public async Task Confirm_request_frame_pauses_the_stream()
    {
        var transport = new FakeAiHelpTransport(AiHelpStreamEvent.ConfirmRequest());
        using var vm = Ready(transport);

        await vm.StartAsync();

        Assert.Equal(AiHelpStreamState.PausedConfirm, vm.State);
    }

    [Fact]
    public async Task Cancel_returns_an_in_flight_stream_to_idle()
    {
        var transport = new FakeAiHelpTransport(AiHelpStreamEvent.Delta("started")) { HoldOpen = true };
        using var vm = Ready(transport);

        var run = vm.StartAsync();
        vm.Cancel();
        await run;

        Assert.Equal(AiHelpStreamState.Idle, vm.State);
    }

    [Fact]
    public async Task Error_then_retry_clears_the_prior_error()
    {
        var transport = new FakeAiHelpTransport(
            AiHelpStreamEvent.Error("boom", AiHelpErrorReason.Stream));
        using var vm = Ready(transport);
        await vm.StartAsync();
        Assert.Equal(AiHelpStreamState.Error, vm.State);

        transport.Reset(AiHelpStreamEvent.Delta("recovered"), AiHelpStreamEvent.Done());
        await vm.StartAsync();

        Assert.Equal(AiHelpStreamState.Done, vm.State);
        Assert.Equal("recovered", vm.AssistantText);
        Assert.False(vm.IsError);
        Assert.Equal(string.Empty, vm.DisplayErrorText);
    }

    [Fact]
    public async Task Tool_frames_do_not_change_visible_state()
    {
        var transport = new FakeAiHelpTransport(
            AiHelpStreamEvent.ToolCall(),
            AiHelpStreamEvent.ToolResult(),
            AiHelpStreamEvent.Delta("grounded answer"),
            AiHelpStreamEvent.Done());
        using var vm = Ready(transport);

        await vm.StartAsync();

        Assert.Equal(AiHelpStreamState.Done, vm.State);
        Assert.Equal("grounded answer", vm.AssistantText);
    }

    // ── view-model: i18n + accessibility labels (web AIFeatureCard copy) ─────────────────────────────────

    [Fact]
    public void Labels_resolve_to_the_web_fallback_copy()
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On);

        Assert.Equal("Ask the help assistant", vm.Title);
        Assert.Equal(AIRAGHelpRegistration.DescriptionFallback, vm.Description);
        Assert.Equal("Ask the assistant", vm.AskButtonLabel);
        Assert.Equal("Helix", vm.BadgeLabel);
        Assert.Equal("e.g. How do I enable energy cost forecasting?", vm.PromptPlaceholder);
        Assert.Equal("Ask Helix", vm.AskHelixLabel);
        Assert.Equal("Helix is thinking\u2026", vm.ThinkingLabel);
    }

    [Fact]
    public void Description_matches_the_web_source_verbatim() =>
        Assert.Equal(
            "Ask a natural-language question about the application and the assistant will answer using the " +
            "project\u2019s own documentation, runbooks, and i18n strings \u2014 with explicit citations to " +
            "each source.",
            AIRAGHelpRegistration.DescriptionFallback);

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
        Assert.Equal("Ask Helix \u00b7 Ask the assistant", vm.ActionAutomationName);
        Assert.Contains(vm.AskHelixLabel, vm.ActionAutomationName, StringComparison.Ordinal);
        Assert.Contains(vm.AskButtonLabel, vm.ActionAutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Labels_consult_every_catalog_key()
    {
        var localizer = new MapLocalizer(new Dictionary<string, string>(StringComparer.Ordinal)
        {
            [AIRAGHelpRegistration.TitleKey] = "T",
            [AIRAGHelpRegistration.DescriptionKey] = "D",
            [AIRAGHelpRegistration.AskButtonKey] = "Ab",
            [AIRAGHelpRegistration.BadgeKey] = "B",
            [AIRAGHelpRegistration.PromptPlaceholderKey] = "P",
            [AIRAGHelpRegistration.PromptLabelKey] = "Pl",
            [AIRAGHelpRegistration.AskHelixKey] = "A",
            [AIRAGHelpRegistration.ThinkingKey] = "K",
        });
        using var vm = new AIRAGHelpViewModel(new FakeAiHelpTransport(), StaticAiFeatureGate.On, localizer);

        Assert.Equal("T", vm.Title);
        Assert.Equal("D", vm.Description);
        Assert.Equal("Ab", vm.AskButtonLabel);
        Assert.Equal("B", vm.BadgeLabel);
        Assert.Equal("P", vm.PromptPlaceholder);
        Assert.Equal("Pl", vm.PromptLabel);
        Assert.Equal("A", vm.AskHelixLabel);
        Assert.Equal("K", vm.ThinkingLabel);
        Assert.Equal("A \u00b7 Ab", vm.ActionAutomationName);
    }

    // ── helpers ──────────────────────────────────────────────────────────────────────────────────────────

    private static AIRAGHelpViewModel NewViewModel(
        IAiFeatureGate gate,
        IAiHelpStreamTransport? transport = null) =>
        new(transport ?? new FakeAiHelpTransport(), gate, Localizer);

    private static AIRAGHelpViewModel Ready(IAiHelpStreamTransport transport)
    {
        var vm = new AIRAGHelpViewModel(transport, StaticAiFeatureGate.On, Localizer)
        {
            Prompt = "How do I export drives?",
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

    private sealed class FakeAiHelpTransport : IAiHelpStreamTransport
    {
        private AiHelpStreamEvent[] _events;

        public FakeAiHelpTransport(params AiHelpStreamEvent[] events) => _events = events;

        public bool HoldOpen { get; init; }

        public int OpenCount { get; private set; }

        public AiHelpRequest? LastRequest { get; private set; }

        public void Reset(params AiHelpStreamEvent[] events) => _events = events;

        public async IAsyncEnumerable<AiHelpStreamEvent> StreamAsync(
            AiHelpRequest request,
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
