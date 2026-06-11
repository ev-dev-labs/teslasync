using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Settings;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the on-device voice surface's UI-thread-free logic — the SSE frame parser (the
/// native port of useAiStream's parseSSEFrame/toTypedEvent), the sentence chunker (the port of
/// popCompleteSentences), the registration metadata + AI feature-registry membership, the PII-safe diagnostics,
/// and the view-model's gate / dictation / text-to-speech / canStart / stream lifecycle state machine
/// (idle → streaming → done / error, duplicate-start no-op, cancel → idle, offline classification, transcript
/// draft persistence, and the trimmed <c>{ message, session_id }</c> request body). Mirrors the web spec
/// (web/src/components/ai/AIVoiceMode.tsx + AIFeatureCard.tsx + useAiStream.ts). The WinUI view
/// (shared-surfaces/AIVoiceMode.cs) and its WinRT speech adapters are exercised by the app build.
/// </summary>
public sealed class AIVoiceModeTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // ── registration + registry membership ───────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("AIVoiceMode", AIVoiceModeRegistration.Slug);

    [Fact]
    public void Feature_id_is_present_in_the_canonical_registry()
    {
        Assert.True(AIVoiceModeRegistration.IsRegisteredFeature(AIVoiceModeRegistration.FeatureId));
        Assert.Contains(AiFeatureRegistry.Features, m => m.Id == AIVoiceModeRegistration.FeatureId);
    }

    [Fact]
    public void Unknown_feature_id_is_not_registered() =>
        Assert.False(AIVoiceModeRegistration.IsRegisteredFeature("not-a-real-feature"));

    [Fact]
    public void Chat_path_is_the_web_endpoint_without_the_version_prefix() =>
        Assert.Equal("/ai/voice/chat", AIVoiceModeRegistration.ChatPath);

    [Fact]
    public void Root_automation_id_matches_the_web_off_mode_test_id() =>
        Assert.Equal("ai-feature-voice-mode-root", AIVoiceModeRegistration.RootAutomationId);

    [Fact]
    public void Feature_id_matches_the_web_with_ai_feature_slug() =>
        Assert.Equal("voice-mode", AIVoiceModeRegistration.FeatureId);

    // ── diagnostics: view.opened, PII-safe (P1/S11) ──────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new AIVoiceModeDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=AIVoiceMode", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_without_a_sink_still_count_opens()
    {
        var diagnostics = new AIVoiceModeDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    [Fact]
    public void Diagnostics_never_leak_the_question_or_answer()
    {
        var lines = new List<string>();
        var diagnostics = new AIVoiceModeDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(lines);
        Assert.StartsWith("view.opened slug=", line, StringComparison.Ordinal);
    }

    // ── SSE parser (web parseSSEFrame / toTypedEvent) ────────────────────────────────────────────────────

    [Fact]
    public void Parser_reads_a_delta_frame()
    {
        var ev = AiVoiceSseParser.ParseFrame("event: delta\ndata: {\"text\":\"Charging \"}");

        Assert.NotNull(ev);
        Assert.Equal(AiVoiceEventKind.Delta, ev!.Kind);
        Assert.Equal("Charging ", ev.Text);
    }

    [Fact]
    public void Parser_reads_a_done_frame()
    {
        var ev = AiVoiceSseParser.ParseFrame("event: done\ndata: {\"finish_reason\":\"stop\",\"usage\":{\"in\":1,\"out\":2}}");

        Assert.NotNull(ev);
        Assert.Equal(AiVoiceEventKind.Done, ev!.Kind);
    }

    [Fact]
    public void Parser_reads_an_error_frame_with_its_message()
    {
        var ev = AiVoiceSseParser.ParseFrame("event: error\ndata: {\"message\":\"rate_limited\"}");

        Assert.NotNull(ev);
        Assert.Equal(AiVoiceEventKind.Error, ev!.Kind);
        Assert.Equal("rate_limited", ev.Message);
        Assert.Equal(AiVoiceErrorReason.Stream, ev.ErrorReason);
    }

    [Fact]
    public void Parser_reads_a_confirm_request_frame()
    {
        var ev = AiVoiceSseParser.ParseFrame(
            "event: confirm_request\ndata: {\"continuation_id\":\"c1\",\"tool\":\"t\",\"summary\":\"ok?\"}");

        Assert.NotNull(ev);
        Assert.Equal(AiVoiceEventKind.ConfirmRequest, ev!.Kind);
    }

    [Fact]
    public void Parser_reads_tool_frames_but_keeps_no_payload()
    {
        var toolCall = AiVoiceSseParser.ParseFrame("event: tool_call\ndata: {\"id\":\"t1\",\"name\":\"vehicle_state\"}");
        var toolResult = AiVoiceSseParser.ParseFrame(
            "event: tool_result\ndata: {\"id\":\"t1\",\"name\":\"vehicle_state\",\"ok\":true,\"data\":[1,2]}");

        Assert.Equal(AiVoiceEventKind.ToolCall, toolCall!.Kind);
        Assert.Equal(AiVoiceEventKind.ToolResult, toolResult!.Kind);
    }

    [Fact]
    public void Parser_drops_a_delta_frame_without_text()
    {
        Assert.Null(AiVoiceSseParser.ParseFrame("event: delta\ndata: {\"notText\":1}"));
        Assert.Null(AiVoiceSseParser.ParseFrame("event: delta\ndata: {\"text\":5}"));
    }

    [Theory]
    [InlineData("event: future_event\ndata: {\"x\":1}")]
    [InlineData("event: delta\ndata: not json")]
    [InlineData("event: delta\ndata: 5")]
    [InlineData("event: delta")]
    [InlineData("data: {\"text\":\"hi\"}")]
    [InlineData(": keep-alive comment")]
    public void Parser_drops_unknown_malformed_or_eventless_frames(string raw) =>
        Assert.Null(AiVoiceSseParser.ParseFrame(raw));

    [Fact]
    public void Parser_handles_the_bare_event_data_prefixes()
    {
        var ev = AiVoiceSseParser.ParseFrame("event:delta\ndata:{\"text\":\"x\"}");

        Assert.NotNull(ev);
        Assert.Equal("x", ev!.Text);
    }

    // ── sentence chunker (web popCompleteSentences) ──────────────────────────────────────────────────────

    [Fact]
    public void Chunker_pops_a_complete_sentence_and_keeps_the_remainder()
    {
        var flush = VoiceSentenceChunker.PopCompleteSentences("Battery is full. Range is good");

        Assert.Equal(["Battery is full."], flush.Spoken);
        Assert.Equal("Range is good", flush.Remainder);
    }

    [Fact]
    public void Chunker_pops_multiple_sentences()
    {
        var flush = VoiceSentenceChunker.PopCompleteSentences("Hello there! How are you? I am here");

        Assert.Equal(["Hello there!", "How are you?"], flush.Spoken);
        Assert.Equal("I am here", flush.Remainder);
    }

    [Fact]
    public void Chunker_keeps_text_without_a_boundary_as_remainder()
    {
        var flush = VoiceSentenceChunker.PopCompleteSentences("no terminator yet");

        Assert.Empty(flush.Spoken);
        Assert.Equal("no terminator yet", flush.Remainder);
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

    // ── view-model: initial state + canStart ─────────────────────────────────────────────────────────────

    [Fact]
    public void Initial_state_is_idle_with_no_output()
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On);

        Assert.Equal(AiVoiceStreamState.Idle, vm.State);
        Assert.Equal(string.Empty, vm.AssistantText);
        Assert.False(vm.HasOutput);
        Assert.False(vm.IsThinking);
        Assert.False(vm.IsError);
        Assert.False(vm.IsOffline);
        Assert.False(vm.CanStart);
        Assert.False(vm.IsListening);
        Assert.True(vm.IsTtsEnabled);
        Assert.True(vm.ShowEmptyHint);
    }

    [Fact]
    public void Session_id_is_stable_and_voice_prefixed()
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On);

        Assert.StartsWith("voice_", vm.SessionId, StringComparison.Ordinal);
        Assert.Equal(vm.SessionId, vm.SessionId);
    }

    [Fact]
    public void Initial_transcript_is_restored_from_the_draft_store()
    {
        var draft = new FakeTranscriptDraftStore("half a question");
        using var vm = new AIVoiceModeViewModel(
            new FakeAiVoiceTransport(), StaticAiFeatureGate.On, Localizer, draftStore: draft);

        Assert.Equal("half a question", vm.Transcript);
        Assert.True(vm.HasTranscript);
        Assert.False(vm.ShowEmptyHint);
    }

    [Theory]
    [InlineData("", false)]
    [InlineData("   ", false)]
    [InlineData("How much range do I have?", true)]
    public void CanStart_requires_a_non_blank_transcript(string transcript, bool expected)
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On);
        vm.Transcript = transcript;

        Assert.Equal(expected, vm.CanStart);
        Assert.Equal(expected, vm.IsActionEnabled);
        Assert.Equal(!expected, vm.ShowEmptyHint);
    }

    // ── view-model: stream lifecycle (web useAiStream) ───────────────────────────────────────────────────

    [Fact]
    public async Task Start_streams_deltas_into_text_then_completes_done()
    {
        var transport = new FakeAiVoiceTransport(
            AiVoiceStreamEvent.Delta("You have "),
            AiVoiceStreamEvent.Delta("250 km."),
            AiVoiceStreamEvent.Done());
        using var vm = Ready(transport);
        bool thinkingAtStreamStart = false;
        vm.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(vm.State) && vm.State == AiVoiceStreamState.Streaming)
            {
                thinkingAtStreamStart = vm.IsThinking;
            }
        };

        await vm.StartAsync();

        Assert.Equal("You have 250 km.", vm.AssistantText);
        Assert.Equal(AiVoiceStreamState.Done, vm.State);
        Assert.True(thinkingAtStreamStart);
        Assert.False(vm.IsThinking);
        Assert.True(vm.HasOutput);
        Assert.Equal(1, transport.OpenCount);
    }

    [Fact]
    public async Task Start_marks_done_when_the_stream_closes_without_a_terminal_event()
    {
        var transport = new FakeAiVoiceTransport(AiVoiceStreamEvent.Delta("partial answer"));
        using var vm = Ready(transport);

        await vm.StartAsync();

        Assert.Equal(AiVoiceStreamState.Done, vm.State);
        Assert.Equal("partial answer", vm.AssistantText);
    }

    [Fact]
    public async Task Start_sends_the_trimmed_message_and_session_id_in_the_body()
    {
        var transport = new FakeAiVoiceTransport(AiVoiceStreamEvent.Delta("ok"));
        using var vm = NewViewModel(StaticAiFeatureGate.On, transport);
        vm.Transcript = "   How fast am I going?   ";

        await vm.StartAsync();

        Assert.Equal("How fast am I going?", transport.LastRequest?.Message);
        Assert.Equal(vm.SessionId, transport.LastRequest?.SessionId);
    }

    [Fact]
    public async Task Start_is_a_no_op_without_a_transcript()
    {
        var transport = new FakeAiVoiceTransport(AiVoiceStreamEvent.Done());
        using var vm = NewViewModel(StaticAiFeatureGate.On, transport);

        await vm.StartAsync();

        Assert.Equal(AiVoiceStreamState.Idle, vm.State);
        Assert.Equal(0, transport.OpenCount);
    }

    [Fact]
    public async Task Start_is_a_no_op_when_the_gate_is_closed()
    {
        var transport = new FakeAiVoiceTransport(AiVoiceStreamEvent.Done());
        using var vm = NewViewModel(StaticAiFeatureGate.Off, transport);
        vm.Transcript = "a question";

        await vm.StartAsync();

        Assert.Equal(AiVoiceStreamState.Idle, vm.State);
        Assert.Equal(0, transport.OpenCount);
    }

    [Fact]
    public async Task Duplicate_start_while_streaming_is_a_no_op()
    {
        var transport = new FakeAiVoiceTransport { HoldOpen = true };
        using var vm = Ready(transport);

        var first = vm.StartAsync();
        var second = vm.StartAsync();

        await second;
        Assert.Equal(AiVoiceStreamState.Streaming, vm.State);
        Assert.Equal(1, transport.OpenCount);

        vm.Cancel();
        await first;
    }

    [Fact]
    public async Task Streaming_state_flips_button_label_and_disables_action()
    {
        var transport = new FakeAiVoiceTransport { HoldOpen = true };
        using var vm = Ready(transport);

        var run = vm.StartAsync();

        Assert.Equal(AiVoiceStreamState.Streaming, vm.State);
        Assert.True(vm.IsStreaming);
        Assert.True(vm.IsBusy);
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
        var transport = new FakeAiVoiceTransport(
            AiVoiceStreamEvent.Error("rate_limited", AiVoiceErrorReason.Stream));
        using var vm = Ready(transport);

        await vm.StartAsync();

        Assert.Equal(AiVoiceStreamState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(vm.IsOffline);
        Assert.Equal("Helix error: rate_limited", vm.DisplayErrorText);
    }

    [Fact]
    public async Task Network_failure_shows_the_offline_message()
    {
        var transport = new FakeAiVoiceTransport(
            AiVoiceStreamEvent.Error("stream_network", AiVoiceErrorReason.Network));
        using var vm = Ready(transport);

        await vm.StartAsync();

        Assert.Equal(AiVoiceStreamState.Error, vm.State);
        Assert.True(vm.IsOffline);
        Assert.Equal(AIVoiceModeRegistration.OfflineFallback, vm.DisplayErrorText);
    }

    [Fact]
    public async Task Error_frame_without_a_message_uses_the_unknown_fallback()
    {
        var transport = new FakeAiVoiceTransport(
            AiVoiceStreamEvent.Error(string.Empty, AiVoiceErrorReason.Stream));
        using var vm = Ready(transport);

        await vm.StartAsync();

        Assert.Equal("Helix error: unknown", vm.DisplayErrorText);
    }

    [Fact]
    public async Task Confirm_request_frame_pauses_the_stream()
    {
        var transport = new FakeAiVoiceTransport(AiVoiceStreamEvent.ConfirmRequest());
        using var vm = Ready(transport);

        await vm.StartAsync();

        Assert.Equal(AiVoiceStreamState.PausedConfirm, vm.State);
        Assert.True(vm.IsBusy);
    }

    [Fact]
    public async Task Cancel_returns_an_in_flight_stream_to_idle()
    {
        var transport = new FakeAiVoiceTransport(AiVoiceStreamEvent.Delta("started")) { HoldOpen = true };
        using var vm = Ready(transport);

        var run = vm.StartAsync();
        vm.Cancel();
        await run;

        Assert.Equal(AiVoiceStreamState.Idle, vm.State);
    }

    [Fact]
    public async Task Tool_frames_do_not_change_visible_state()
    {
        var transport = new FakeAiVoiceTransport(
            AiVoiceStreamEvent.ToolCall(),
            AiVoiceStreamEvent.ToolResult(),
            AiVoiceStreamEvent.Delta("grounded answer"),
            AiVoiceStreamEvent.Done());
        using var vm = Ready(transport);

        await vm.StartAsync();

        Assert.Equal(AiVoiceStreamState.Done, vm.State);
        Assert.Equal("grounded answer", vm.AssistantText);
    }

    [Fact]
    public async Task Done_clears_the_transcript_and_its_draft()
    {
        var draft = new FakeTranscriptDraftStore();
        var transport = new FakeAiVoiceTransport(AiVoiceStreamEvent.Delta("ok"), AiVoiceStreamEvent.Done());
        using var vm = new AIVoiceModeViewModel(
            transport, StaticAiFeatureGate.On, Localizer, draftStore: draft)
        {
            Transcript = "What is my range?",
        };

        await vm.StartAsync();

        Assert.Equal(string.Empty, vm.Transcript);
        Assert.Equal(string.Empty, draft.Current);
    }

    // ── view-model: text-to-speech (web speechSynthesis + sentence chunking) ─────────────────────────────

    [Fact]
    public async Task Streamed_reply_is_spoken_one_sentence_at_a_time()
    {
        var playback = new FakeSpeechPlayback();
        var transport = new FakeAiVoiceTransport(
            AiVoiceStreamEvent.Delta("To park, "),
            AiVoiceStreamEvent.Delta("press here. "),
            AiVoiceStreamEvent.Delta("Then wait."),
            AiVoiceStreamEvent.Done());
        using var vm = Ready(transport, playback: playback);

        await vm.StartAsync();

        Assert.Equal(["To park, press here.", "Then wait."], playback.Spoken);
    }

    [Fact]
    public async Task Muted_replies_are_not_spoken()
    {
        var playback = new FakeSpeechPlayback();
        var transport = new FakeAiVoiceTransport(
            AiVoiceStreamEvent.Delta("Range is full. "),
            AiVoiceStreamEvent.Done());
        using var vm = Ready(transport, playback: playback);
        vm.ToggleTts();

        await vm.StartAsync();

        Assert.False(vm.IsTtsEnabled);
        Assert.Empty(playback.Spoken);
    }

    [Fact]
    public void Toggling_tts_off_cancels_any_in_flight_speech()
    {
        var playback = new FakeSpeechPlayback();
        using var vm = Ready(new FakeAiVoiceTransport(), playback: playback);

        vm.ToggleTts();

        Assert.False(vm.IsTtsEnabled);
        Assert.Equal(1, playback.CancelCount);
    }

    [Fact]
    public async Task Error_during_stream_cancels_speech()
    {
        var playback = new FakeSpeechPlayback();
        var transport = new FakeAiVoiceTransport(
            AiVoiceStreamEvent.Error("boom", AiVoiceErrorReason.Stream));
        using var vm = Ready(transport, playback: playback);

        await vm.StartAsync();

        Assert.Empty(playback.Spoken);
        // One cancel from the pre-stream reset (web cancelSpeech) + one from the error handler.
        Assert.True(playback.CancelCount >= 2);
    }

    // ── view-model: dictation (web SpeechRecognition) ────────────────────────────────────────────────────

    [Fact]
    public void Start_listening_starts_the_recognizer_and_flips_the_listening_state()
    {
        var dictation = new FakeSpeechDictation();
        using var vm = Ready(new FakeAiVoiceTransport(), dictation: dictation);

        vm.StartListening();

        Assert.True(vm.IsListening);
        Assert.True(vm.MicButtonIsStop);
        Assert.Equal(1, dictation.StartCount);
        Assert.Equal(string.Empty, vm.SttError);
        Assert.False(vm.HasSttError);
    }

    [Fact]
    public void Start_listening_without_support_shows_the_unsupported_error()
    {
        var dictation = new FakeSpeechDictation { IsSupported = false };
        using var vm = Ready(new FakeAiVoiceTransport(), dictation: dictation);

        Assert.False(vm.SpeechSupported);
        Assert.True(vm.ShowUnsupportedHint);

        vm.StartListening();

        Assert.False(vm.IsListening);
        Assert.Equal(0, dictation.StartCount);
        Assert.Equal(AIVoiceModeRegistration.ErrorUnsupportedFallback, vm.SttError);
        Assert.False(vm.ShowUnsupportedHint);
    }

    [Fact]
    public void Recognized_text_appends_to_the_transcript()
    {
        var dictation = new FakeSpeechDictation();
        using var vm = Ready(new FakeAiVoiceTransport(), dictation: dictation, transcript: string.Empty);

        vm.StartListening();
        dictation.RaiseText("hello");
        dictation.RaiseText("world");

        Assert.Equal("hello world", vm.Transcript);
        Assert.True(vm.CanStart);
    }

    [Fact]
    public void Dictation_error_surfaces_the_reason_and_stops_listening()
    {
        var dictation = new FakeSpeechDictation();
        using var vm = Ready(new FakeAiVoiceTransport(), dictation: dictation);
        vm.StartListening();

        dictation.RaiseError("no-speech");

        Assert.Equal("Voice input failed: no-speech", vm.SttError);
        Assert.False(vm.IsListening);
    }

    [Fact]
    public void Dictation_ended_stops_listening()
    {
        var dictation = new FakeSpeechDictation();
        using var vm = Ready(new FakeAiVoiceTransport(), dictation: dictation);
        vm.StartListening();

        dictation.RaiseEnded();

        Assert.False(vm.IsListening);
    }

    [Fact]
    public void Stop_listening_stops_the_recognizer()
    {
        var dictation = new FakeSpeechDictation();
        using var vm = Ready(new FakeAiVoiceTransport(), dictation: dictation);
        vm.StartListening();

        vm.StopListening();

        Assert.False(vm.IsListening);
        Assert.Equal(1, dictation.StopCount);
    }

    [Fact]
    public async Task Stop_all_stops_dictation_stream_and_speech()
    {
        var dictation = new FakeSpeechDictation();
        var playback = new FakeSpeechPlayback();
        var transport = new FakeAiVoiceTransport { HoldOpen = true };
        using var vm = Ready(transport, dictation: dictation, playback: playback);
        vm.StartListening();
        var run = vm.StartAsync();

        vm.StopAll();
        await run;

        Assert.False(vm.IsListening);
        Assert.Equal(1, dictation.StopCount);
        Assert.Equal(AiVoiceStreamState.Idle, vm.State);
        Assert.True(playback.CancelCount >= 1);
    }

    [Fact]
    public void Transcript_draft_is_persisted_while_idle()
    {
        var draft = new FakeTranscriptDraftStore();
        using var vm = new AIVoiceModeViewModel(
            new FakeAiVoiceTransport(), StaticAiFeatureGate.On, Localizer, draftStore: draft);

        vm.Transcript = "draft me";

        Assert.Equal("draft me", draft.Current);
    }

    [Fact]
    public void Dispose_clears_the_draft_and_aborts_dictation()
    {
        var draft = new FakeTranscriptDraftStore("leftover");
        var dictation = new FakeSpeechDictation();
        var vm = new AIVoiceModeViewModel(
            new FakeAiVoiceTransport(), StaticAiFeatureGate.On, Localizer, dictation: dictation, draftStore: draft);

        vm.Dispose();

        Assert.Equal(string.Empty, draft.Current);
        Assert.Equal(1, dictation.AbortCount);
    }

    // ── view-model: transcript display + control labels ──────────────────────────────────────────────────

    [Fact]
    public void Transcript_region_shows_the_idle_hint_when_blank()
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On);

        Assert.True(vm.TranscriptIsHint);
        Assert.Equal("Tap the mic and ask Helix anything about your Tesla.", vm.TranscriptDisplay);
    }

    [Fact]
    public void Transcript_region_shows_the_listening_hint_while_listening()
    {
        var dictation = new FakeSpeechDictation();
        using var vm = Ready(new FakeAiVoiceTransport(), dictation: dictation, transcript: string.Empty);

        vm.StartListening();

        Assert.True(vm.TranscriptIsHint);
        Assert.Equal("Listening \u2014 speak now\u2026", vm.TranscriptDisplay);
    }

    [Fact]
    public void Transcript_region_shows_dictated_text_when_present()
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On);
        vm.Transcript = "What is my range?";

        Assert.False(vm.TranscriptIsHint);
        Assert.Equal("What is my range?", vm.TranscriptDisplay);
    }

    [Fact]
    public void Mic_labels_track_the_listening_state()
    {
        var dictation = new FakeSpeechDictation();
        using var vm = Ready(new FakeAiVoiceTransport(), dictation: dictation);

        Assert.Equal("Speak", vm.MicLabel);
        Assert.Equal("Start listening", vm.MicAutomationName);
        Assert.False(vm.MicButtonIsStop);

        vm.StartListening();

        Assert.Equal("Stop mic", vm.MicLabel);
        Assert.Equal("Stop listening", vm.MicAutomationName);
        Assert.True(vm.MicButtonIsStop);
    }

    [Fact]
    public void Tts_labels_track_the_enabled_state()
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On);

        Assert.Equal("Mute Helix", vm.TtsToggleLabel);
        Assert.Equal("Mute spoken replies", vm.TtsToggleAutomationName);

        vm.ToggleTts();

        Assert.Equal("Unmute Helix", vm.TtsToggleLabel);
        Assert.Equal("Unmute spoken replies", vm.TtsToggleAutomationName);
    }

    [Fact]
    public async Task Stop_button_is_shown_only_while_busy()
    {
        var transport = new FakeAiVoiceTransport { HoldOpen = true };
        using var vm = Ready(transport);

        Assert.False(vm.ShowStopButton);

        var run = vm.StartAsync();
        Assert.True(vm.ShowStopButton);

        vm.Cancel();
        await run;
        Assert.False(vm.ShowStopButton);
    }

    // ── view-model: i18n + accessibility labels (web AIVoiceMode + AIFeatureCard copy) ───────────────────

    [Fact]
    public void Labels_resolve_to_the_web_fallback_copy()
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On);

        Assert.Equal("Voice mode", vm.Title);
        Assert.Equal(AIVoiceModeRegistration.DescriptionFallback, vm.Description);
        Assert.Equal("Speak to Helix", vm.ButtonLabel);
        Assert.Equal("Helix", vm.BadgeLabel);
        Assert.Equal("Voice transcript", vm.TranscriptLabel);
        Assert.Equal("Tap the mic and dictate a question first.", vm.EmptyHint);
        Assert.Equal("Ask Helix", vm.AskHelixLabel);
        Assert.Equal("Helix is thinking\u2026", vm.ThinkingLabel);
        Assert.Equal("Stop", vm.StopAllLabel);
        Assert.Equal("Stop Helix", vm.StopAllAutomationName);
    }

    [Fact]
    public void Description_matches_the_web_source_verbatim() =>
        Assert.Equal(
            "Speak to Helix and hear the reply out loud. Voice input and playback both stay on this device " +
            "\u2014 only the transcribed text is sent to the assistant, never the raw audio.",
            AIVoiceModeRegistration.DescriptionFallback);

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
        Assert.Equal("Ask Helix \u00b7 Speak to Helix", vm.ActionAutomationName);
        Assert.Contains(vm.AskHelixLabel, vm.ActionAutomationName, StringComparison.Ordinal);
        Assert.Contains(vm.ButtonLabel, vm.ActionAutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Format_stt_error_folds_the_reason_into_the_template() =>
        Assert.Equal(
            "Voice input failed: network",
            AIVoiceModeRegistration.FormatSttError(AIVoiceModeRegistration.ErrorSttFailedFallback, "network"));

    [Fact]
    public void Labels_consult_every_catalog_key()
    {
        var localizer = new MapLocalizer(new Dictionary<string, string>(StringComparer.Ordinal)
        {
            [AIVoiceModeRegistration.TitleKey] = "T",
            [AIVoiceModeRegistration.DescriptionKey] = "D",
            [AIVoiceModeRegistration.ButtonKey] = "Bt",
            [AIVoiceModeRegistration.BadgeKey] = "B",
            [AIVoiceModeRegistration.TranscriptLabelKey] = "Tl",
            [AIVoiceModeRegistration.IdleHintKey] = "Ih",
            [AIVoiceModeRegistration.ListeningHintKey] = "Lh",
            [AIVoiceModeRegistration.UnsupportedHintKey] = "Uh",
            [AIVoiceModeRegistration.EmptyHintKey] = "Eh",
            [AIVoiceModeRegistration.StartListeningKey] = "Sl",
            [AIVoiceModeRegistration.StartListeningShortKey] = "Sls",
            [AIVoiceModeRegistration.MuteTtsKey] = "Mt",
            [AIVoiceModeRegistration.MuteTtsShortKey] = "Mts",
            [AIVoiceModeRegistration.StopAllKey] = "Sa",
            [AIVoiceModeRegistration.StopAllShortKey] = "Sas",
            [AIVoiceModeRegistration.AskHelixKey] = "A",
            [AIVoiceModeRegistration.ThinkingKey] = "K",
        });
        using var vm = new AIVoiceModeViewModel(new FakeAiVoiceTransport(), StaticAiFeatureGate.On, localizer);

        Assert.Equal("T", vm.Title);
        Assert.Equal("D", vm.Description);
        Assert.Equal("Bt", vm.ButtonLabel);
        Assert.Equal("B", vm.BadgeLabel);
        Assert.Equal("Tl", vm.TranscriptLabel);
        Assert.Equal("Ih", vm.IdleHint);
        Assert.Equal("Uh", vm.UnsupportedHint);
        Assert.Equal("Eh", vm.EmptyHint);
        Assert.Equal("Sls", vm.MicLabel);
        Assert.Equal("Sl", vm.MicAutomationName);
        Assert.Equal("Mts", vm.TtsToggleLabel);
        Assert.Equal("Mt", vm.TtsToggleAutomationName);
        Assert.Equal("Sas", vm.StopAllLabel);
        Assert.Equal("Sa", vm.StopAllAutomationName);
        Assert.Equal("A \u00b7 Bt", vm.ActionAutomationName);
    }

    // ── helpers ──────────────────────────────────────────────────────────────────────────────────────────

    private static AIVoiceModeViewModel NewViewModel(
        IAiFeatureGate gate,
        IAiVoiceStreamTransport? transport = null) =>
        new(transport ?? new FakeAiVoiceTransport(), gate, Localizer);

    private static AIVoiceModeViewModel Ready(
        IAiVoiceStreamTransport transport,
        ISpeechDictation? dictation = null,
        ISpeechPlayback? playback = null,
        string transcript = "How much range do I have?")
    {
        var vm = new AIVoiceModeViewModel(
            transport, StaticAiFeatureGate.On, Localizer, dictation, playback)
        {
            Transcript = transcript,
        };
        return vm;
    }

    private sealed class MapLocalizer : ILocalizer
    {
        private readonly IReadOnlyDictionary<string, string> _map;

        public MapLocalizer(IReadOnlyDictionary<string, string> map) => _map = map;

        public string GetString(string key, string fallback) =>
            _map.TryGetValue(key, out var value) ? value : fallback;
    }

    private sealed class FakeAiVoiceTransport : IAiVoiceStreamTransport
    {
        private AiVoiceStreamEvent[] _events;

        public FakeAiVoiceTransport(params AiVoiceStreamEvent[] events) => _events = events;

        public bool HoldOpen { get; init; }

        public int OpenCount { get; private set; }

        public AiVoiceRequest? LastRequest { get; private set; }

        public void Reset(params AiVoiceStreamEvent[] events) => _events = events;

        public async IAsyncEnumerable<AiVoiceStreamEvent> StreamAsync(
            AiVoiceRequest request,
            [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken = default)
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

    private sealed class FakeSpeechDictation : ISpeechDictation
    {
        public bool IsSupported { get; init; } = true;

        public int StartCount { get; private set; }

        public int StopCount { get; private set; }

        public int AbortCount { get; private set; }

        public string? LastLanguage { get; private set; }

        public event EventHandler<SpeechDictationTextEventArgs>? TranscriptUpdated;

        public event EventHandler<SpeechDictationErrorEventArgs>? ErrorRaised;

        public event EventHandler? Ended;

        public void Start(string languageTag)
        {
            StartCount++;
            LastLanguage = languageTag;
        }

        public void StopDictation() => StopCount++;

        public void Abort() => AbortCount++;

        public void RaiseText(string text) =>
            TranscriptUpdated?.Invoke(this, new SpeechDictationTextEventArgs(text));

        public void RaiseError(string reason) =>
            ErrorRaised?.Invoke(this, new SpeechDictationErrorEventArgs(reason));

        public void RaiseEnded() => Ended?.Invoke(this, EventArgs.Empty);
    }

    private sealed class FakeSpeechPlayback : ISpeechPlayback
    {
        public List<string> Spoken { get; } = [];

        public int CancelCount { get; private set; }

        public void Speak(string text, string languageTag) => Spoken.Add(text);

        public void Cancel() => CancelCount++;
    }

    private sealed class FakeTranscriptDraftStore : ITranscriptDraftStore
    {
        public FakeTranscriptDraftStore(string initial = "") => Current = initial;

        public string Current { get; set; }

        public string GetDraft() => Current;

        public void SetDraft(string value) => Current = value;
    }
}
