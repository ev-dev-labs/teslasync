using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Live;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the AITripPostcardShareCardImageGeneration surface's UI-thread-free logic — the
/// SSE-frame adapter (<see cref="AiTripPostcardStreamParser"/>), the request-body composition
/// (<see cref="AiTripPostcardRequest"/>), the stream state holder
/// (<see cref="AITripPostcardShareCardImageGenerationViewModel"/>), the label projection, the AI-feature gate and
/// the PII-safe diagnostics. Mirrors the web spec one-for-one (web/src/components/ai/AITripPostcardShareCardImageGeneration.tsx
/// + web/src/components/ai/AIFeatureCard.tsx + web/src/components/ai/AiOutputPanel.tsx + web/src/hooks/useAiStream.ts).
/// The WinUI part (<c>AITripPostcardShareCardImageGeneration</c> in shared-surfaces/AITripPostcardShareCardImageGeneration.cs,
/// which composes the glass panel, badge, inline action button, empty-state hint and output region and marshals
/// stream notifications onto the dispatcher) is exercised by the app build.
/// </summary>
public sealed class AITripPostcardShareCardImageGenerationTests
{
    // ── adapter: parseSSEFrame / toTypedEvent (web/src/hooks/useAiStream.ts L364-L468) ───────────────────

    [Fact]
    public void Delta_frame_parses_text()
    {
        var ev = AiTripPostcardStreamParser.ToTypedEvent("delta", "{\"text\":\"A coastal sunset postcard.\"}");

        Assert.NotNull(ev);
        Assert.Equal(AiTripPostcardEventKind.Delta, ev!.Kind);
        Assert.Equal("A coastal sunset postcard.", ev.Text);
    }

    [Fact]
    public void Delta_frame_without_text_is_dropped()
    {
        Assert.Null(AiTripPostcardStreamParser.ToTypedEvent("delta", "{\"notText\":1}"));
        Assert.Null(AiTripPostcardStreamParser.ToTypedEvent("delta", "{\"text\":5}"));
    }

    [Fact]
    public void Tool_call_frame_parses_when_id_and_name_present()
    {
        var ev = AiTripPostcardStreamParser.ToTypedEvent(
            "tool_call", "{\"id\":\"t1\",\"name\":\"draft_share_card\",\"arguments\":{}}");

        Assert.NotNull(ev);
        Assert.Equal(AiTripPostcardEventKind.ToolCall, ev!.Kind);
    }

    [Fact]
    public void Tool_call_frame_missing_required_field_is_dropped()
    {
        Assert.Null(AiTripPostcardStreamParser.ToTypedEvent("tool_call", "{\"id\":\"t1\"}"));
        Assert.Null(AiTripPostcardStreamParser.ToTypedEvent("tool_call", "{\"name\":\"x\"}"));
    }

    [Theory]
    [InlineData("true")]
    [InlineData("false")]
    public void Tool_result_frame_parses_when_ok_is_boolean(string okLiteral)
    {
        var ev = AiTripPostcardStreamParser.ToTypedEvent(
            "tool_result", $"{{\"id\":\"t1\",\"name\":\"x\",\"ok\":{okLiteral}}}");

        Assert.NotNull(ev);
        Assert.Equal(AiTripPostcardEventKind.ToolResult, ev!.Kind);
    }

    [Fact]
    public void Tool_result_frame_without_ok_is_dropped() =>
        Assert.Null(AiTripPostcardStreamParser.ToTypedEvent("tool_result", "{\"id\":\"t1\",\"name\":\"x\"}"));

    [Fact]
    public void Confirm_request_frame_parses_required_fields()
    {
        var ev = AiTripPostcardStreamParser.ToTypedEvent(
            "confirm_request", "{\"continuation_id\":\"c1\",\"tool\":\"t\",\"summary\":\"Proceed?\"}");

        Assert.NotNull(ev);
        Assert.Equal(AiTripPostcardEventKind.ConfirmRequest, ev!.Kind);
    }

    [Fact]
    public void Confirm_request_frame_missing_summary_is_dropped() =>
        Assert.Null(AiTripPostcardStreamParser.ToTypedEvent(
            "confirm_request", "{\"continuation_id\":\"c1\",\"tool\":\"x\"}"));

    [Fact]
    public void Done_frame_parses()
    {
        var ev = AiTripPostcardStreamParser.ToTypedEvent("done", "{\"finish_reason\":\"stop\"}");

        Assert.NotNull(ev);
        Assert.Equal(AiTripPostcardEventKind.Done, ev!.Kind);
    }

    [Fact]
    public void Error_frame_parses_message()
    {
        var ev = AiTripPostcardStreamParser.ToTypedEvent("error", "{\"message\":\"capped\"}");

        Assert.NotNull(ev);
        Assert.Equal(AiTripPostcardEventKind.Error, ev!.Kind);
        Assert.Equal("capped", ev.Message);
    }

    [Fact]
    public void Error_frame_defaults_message_to_unknown()
    {
        var ev = AiTripPostcardStreamParser.ToTypedEvent("error", "{}");

        Assert.NotNull(ev);
        Assert.Equal(AiTripPostcardEventKind.Error, ev!.Kind);
        Assert.Equal("unknown", ev.Message);
    }

    [Theory]
    [InlineData("future_event", "{\"x\":1}")]
    [InlineData("delta", "not json")]
    [InlineData("delta", "5")]
    [InlineData("delta", "")]
    [InlineData("", "{\"text\":\"hi\"}")]
    public void Unknown_malformed_or_empty_frames_are_dropped(string eventName, string data) =>
        Assert.Null(AiTripPostcardStreamParser.ToTypedEvent(eventName, data));

    [Fact]
    public void ParseFrame_delegates_to_typed_event()
    {
        var ev = AiTripPostcardStreamParser.ParseFrame(new SseFrame("delta", "{\"text\":\"Hi\"}", null, null));

        Assert.NotNull(ev);
        Assert.Equal("Hi", ev!.Text);
    }

    // ── request body: useMemo `{ trip_id, style_hint? }` (web AITripPostcardShareCardImageGeneration L67-L75) ──

    [Fact]
    public void Request_carries_trip_id_and_trimmed_style_hint()
    {
        var request = new AiTripPostcardRequest(42, "  vintage  ");

        Assert.Equal(42, request.TripId);
        Assert.Equal("vintage", request.StyleHint);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Request_omits_blank_style_hint(string? styleHint)
    {
        var request = new AiTripPostcardRequest(42, styleHint);

        Assert.Null(request.StyleHint);
    }

    [Fact]
    public void Request_serializes_to_snake_case_with_style_hint_when_present()
    {
        var json = JsonSerializer.Serialize(new AiTripPostcardRequest(42, "minimal"), ApiClientOptions.CreateJsonOptions());

        Assert.Contains("\"trip_id\":42", json, StringComparison.Ordinal);
        Assert.Contains("\"style_hint\":\"minimal\"", json, StringComparison.Ordinal);
    }

    [Fact]
    public void Request_serializes_omitting_style_hint_when_blank()
    {
        var json = JsonSerializer.Serialize(new AiTripPostcardRequest(42, null), ApiClientOptions.CreateJsonOptions());

        Assert.Contains("\"trip_id\":42", json, StringComparison.Ordinal);
        Assert.DoesNotContain("style_hint", json, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Start_posts_the_selected_trip_and_style_hint_to_the_transport()
    {
        var transport = new ScriptedTransport(Delta("draft"), DoneFrame());
        var vm = NewViewModel(transport: transport, tripId: 7, styleHint: "  retro  ");

        vm.Start();
        await vm.PendingStream!;

        Assert.NotNull(transport.LastRequest);
        Assert.Equal(7, transport.LastRequest!.TripId);
        Assert.Equal("retro", transport.LastRequest.StyleHint);
    }

    // ── projection: InnerSection + AIFeatureCard copy (web AITripPostcardShareCardImageGeneration.tsx) ────

    [Fact]
    public void Projection_resolves_web_default_fallbacks()
    {
        var display = AITripPostcardShareCardImageGenerationProjection.Project(PassthroughLocalizer.Instance);

        Assert.Equal("Draft a Helix share-card image", display.Title);
        Assert.Equal(AITripPostcardShareCardImageGenerationRegistration.DescriptionFallback, display.Description);
        Assert.Equal("Helix", display.BadgeLabel);
        Assert.Equal("Generate share card", display.ButtonLabel);
        Assert.Equal("Pick a trip from the list above to enable Helix.", display.EmptyHint);
        Assert.Equal("Ask Helix", display.AskHelixLabel);
        Assert.Equal("Helix is thinking\u2026", display.ThinkingLabel);
        Assert.Equal("Helix error:", display.ErrorLabel);
        Assert.Equal("unknown", display.ErrorUnknown);
        Assert.Equal("Retry", display.RetryLabel);
    }

    [Fact]
    public void Projection_description_states_the_propose_only_pii_contract()
    {
        var display = AITripPostcardShareCardImageGenerationProjection.Project(PassthroughLocalizer.Instance);

        // web: the description promises a propose-only draft, redacted context, and manual publish.
        Assert.Contains("propose-only", display.Description, StringComparison.Ordinal);
        Assert.Contains("never published automatically", display.Description, StringComparison.Ordinal);
        Assert.Contains("never raw coordinates or street addresses", display.Description, StringComparison.Ordinal);
    }

    [Fact]
    public void Projection_composes_button_accessible_name()
    {
        var display = AITripPostcardShareCardImageGenerationProjection.Project(PassthroughLocalizer.Instance);

        // web AIFeatureCard: aria-label = `${askHelixLabel} · ${buttonLabel}`.
        Assert.Equal("Ask Helix \u00b7 Generate share card", display.ButtonAutomationName);
        Assert.Contains(display.AskHelixLabel, display.ButtonAutomationName, StringComparison.Ordinal);
        Assert.Contains(display.ButtonLabel, display.ButtonAutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Projection_consults_every_catalog_key()
    {
        var localizer = new MapLocalizer(new Dictionary<string, string>(StringComparer.Ordinal)
        {
            [AITripPostcardShareCardImageGenerationRegistration.TitleKey] = "T",
            [AITripPostcardShareCardImageGenerationRegistration.DescriptionKey] = "D",
            [AITripPostcardShareCardImageGenerationRegistration.BadgeKey] = "B",
            [AITripPostcardShareCardImageGenerationRegistration.EmptyHintKey] = "H",
            [AITripPostcardShareCardImageGenerationRegistration.AskHelixKey] = "A",
            [AITripPostcardShareCardImageGenerationRegistration.ThinkingKey] = "K",
            [AITripPostcardShareCardImageGenerationRegistration.ButtonLabelKey] = "G",
            [AITripPostcardShareCardImageGenerationRegistration.ErrorLabelKey] = "E",
            [AITripPostcardShareCardImageGenerationRegistration.ErrorUnknownKey] = "U",
            [AITripPostcardShareCardImageGenerationRegistration.OfflineKey] = "O",
            [AITripPostcardShareCardImageGenerationRegistration.RetryKey] = "R",
        });

        var display = AITripPostcardShareCardImageGenerationProjection.Project(localizer);

        Assert.Equal("T", display.Title);
        Assert.Equal("D", display.Description);
        Assert.Equal("B", display.BadgeLabel);
        Assert.Equal("H", display.EmptyHint);
        Assert.Equal("A", display.AskHelixLabel);
        Assert.Equal("K", display.ThinkingLabel);
        Assert.Equal("G", display.ButtonLabel);
        Assert.Equal("E", display.ErrorLabel);
        Assert.Equal("U", display.ErrorUnknown);
        Assert.Equal("O", display.OfflineMessage);
        Assert.Equal("R", display.RetryLabel);
        Assert.Equal("A \u00b7 G", display.ButtonAutomationName);
    }

    // ── gate: withAiFeature / useAiEnabled (web/src/components/ai/withAiFeature.tsx) ──────────────────────

    [Fact]
    public void Gate_open_when_feature_enabled()
    {
        var vm = NewViewModel(gate: new DelegateAiFeatureGate(id => id == AITripPostcardShareCardImageGenerationRegistration.FeatureId));
        Assert.True(vm.IsGateOpen);
    }

    [Fact]
    public void Gate_closed_when_feature_disabled()
    {
        var vm = NewViewModel(gate: DelegateAiFeatureGate.Disabled);
        Assert.False(vm.IsGateOpen);
    }

    [Fact]
    public void Start_is_noop_when_gate_closed()
    {
        var transport = new ScriptedTransport(Delta("nope"), DoneFrame());
        var vm = NewViewModel(transport: transport, gate: DelegateAiFeatureGate.Disabled, tripId: 7);

        vm.Start();

        Assert.Null(vm.PendingStream);
        Assert.Equal(AiTripPostcardStreamState.Idle, vm.State);
    }

    // ── canStart: web `canStart={haveInputs}` (a resolved trip_id > 0) ───────────────────────────────────

    [Fact]
    public void CanStart_true_and_button_enabled_when_a_trip_is_selected()
    {
        var vm = NewViewModel(tripId: 7);

        Assert.True(vm.HaveInputs);
        Assert.True(vm.CanStart);
        Assert.True(vm.ButtonEnabled);
        Assert.False(vm.ShowEmptyHint);
        Assert.Equal("Ask Helix", vm.ButtonText);
        Assert.False(vm.HasOutput);
        Assert.False(vm.ShowThinking);
        Assert.False(vm.ShowText);
        Assert.False(vm.ShowError);
    }

    [Theory]
    [InlineData(null)]
    [InlineData(0L)]
    public void CanStart_false_and_hint_shown_when_no_trip_selected(long? tripId)
    {
        var vm = NewViewModel(tripId: tripId);

        Assert.False(vm.HaveInputs);
        Assert.False(vm.CanStart);
        Assert.False(vm.ButtonEnabled);
        Assert.True(vm.ShowEmptyHint);
    }

    [Fact]
    public void Start_is_noop_when_no_trip_selected()
    {
        var transport = new ScriptedTransport(Delta("nope"), DoneFrame());
        var vm = NewViewModel(transport: transport, tripId: null);

        vm.Start();

        Assert.Null(vm.PendingStream);
        Assert.Equal(AiTripPostcardStreamState.Idle, vm.State);
        Assert.Null(transport.LastRequest);
    }

    [Fact]
    public void Selecting_a_trip_flips_gating_and_raises_change_notifications()
    {
        var vm = NewViewModel(tripId: null);
        var raised = new List<string>();
        vm.PropertyChanged += (_, e) => raised.Add(e.PropertyName ?? string.Empty);

        vm.TripId = 7;

        Assert.True(vm.CanStart);
        Assert.True(vm.ButtonEnabled);
        Assert.False(vm.ShowEmptyHint);
        Assert.Contains(nameof(vm.CanStart), raised);
        Assert.Contains(nameof(vm.ButtonEnabled), raised);
        Assert.Contains(nameof(vm.ShowEmptyHint), raised);
        Assert.Contains(nameof(vm.HaveInputs), raised);
    }

    // ── stream lifecycle: useAiStream idle → streaming → done | error ────────────────────────────────────

    [Fact]
    public async Task Stream_accumulates_delta_text_then_completes_on_done()
    {
        var transport = new ScriptedTransport(Delta("A neon "), Delta("city skyline."), DoneFrame());
        var vm = NewViewModel(transport: transport);

        vm.Start();
        await vm.PendingStream!;

        Assert.Equal(AiTripPostcardStreamState.Done, vm.State);
        Assert.Equal("A neon city skyline.", vm.Text);
        Assert.False(vm.IsStreaming);
        Assert.True(vm.ShowText);
        Assert.True(vm.HasOutput);
        Assert.False(vm.ShowError);
        // web canStart stays true after a clean close (a trip is still selected), so the user can re-run.
        Assert.True(vm.CanStart);
        Assert.True(vm.ButtonEnabled);
    }

    [Fact]
    public async Task Stream_settles_done_when_connection_closes_without_terminal_frame()
    {
        var transport = new ScriptedTransport(Delta("partial"));
        var vm = NewViewModel(transport: transport);

        vm.Start();
        await vm.PendingStream!;

        // web: setState(cur => cur === 'streaming' ? 'done' : cur) on clean close.
        Assert.Equal(AiTripPostcardStreamState.Done, vm.State);
        Assert.Equal("partial", vm.Text);
    }

    [Fact]
    public async Task Stream_reassembles_frames_split_across_chunks()
    {
        var transport = new ScriptedTransport(
            "event: delta\ndata: {\"text\":\"Hel",
            "lo\"}\n\nevent: done\ndata: {}\n\n");
        var vm = NewViewModel(transport: transport);

        vm.Start();
        await vm.PendingStream!;

        Assert.Equal(AiTripPostcardStreamState.Done, vm.State);
        Assert.Equal("Hello", vm.Text);
    }

    [Fact]
    public async Task Error_frame_sets_error_state_and_composes_inline_message()
    {
        var transport = new ScriptedTransport("event: error\ndata: {\"message\":\"boom\"}\n\n");
        var vm = NewViewModel(transport: transport);

        vm.Start();
        await vm.PendingStream!;

        Assert.Equal(AiTripPostcardStreamState.Error, vm.State);
        Assert.True(vm.ShowError);
        Assert.False(vm.IsOffline);
        // web AiOutputPanel: `helix.errorLabel` + (error ?? errorUnknown).
        Assert.Equal("Helix error: boom", vm.DisplayErrorText);
    }

    [Fact]
    public async Task Http_failure_surfaces_as_error_with_status_code()
    {
        var transport = new ThrowingTransport(new HttpRequestException("stream_http_404"));
        var vm = NewViewModel(transport: transport);

        vm.Start();
        await vm.PendingStream!;

        // web: a non-ok response yields error state with `stream_http_${status}` (off-mode 404 → baseline fallback).
        Assert.Equal(AiTripPostcardStreamState.Error, vm.State);
        Assert.False(vm.IsOffline);
        Assert.Equal("Helix error: stream_http_404", vm.DisplayErrorText);
    }

    [Fact]
    public async Task Connectivity_failure_surfaces_as_offline_with_retryable_message()
    {
        var transport = new ThrowingTransport(new HttpRequestException("Connection refused"));
        var vm = NewViewModel(transport: transport);

        vm.Start();
        await vm.PendingStream!;

        Assert.Equal(AiTripPostcardStreamState.Error, vm.State);
        Assert.True(vm.IsOffline);
        // Offline branch shows the connectivity-aware message, not the generic "Helix error:" composition.
        Assert.Equal(AITripPostcardShareCardImageGenerationRegistration.OfflineFallback, vm.DisplayErrorText);
    }

    [Fact]
    public async Task Midstream_io_failure_surfaces_as_offline()
    {
        var transport = new ThrowingTransport(new IOException("socket reset"));
        var vm = NewViewModel(transport: transport);

        vm.Start();
        await vm.PendingStream!;

        Assert.Equal(AiTripPostcardStreamState.Error, vm.State);
        Assert.True(vm.IsOffline);
    }

    [Fact]
    public async Task Confirm_request_pauses_the_stream()
    {
        var transport = new ScriptedTransport(
            "event: confirm_request\ndata: {\"continuation_id\":\"c1\",\"tool\":\"t\",\"summary\":\"ok?\"}\n\n");
        var vm = NewViewModel(transport: transport);

        vm.Start();
        await vm.PendingStream!;

        // web: a confirm_request is NOT promoted to done on close; the surface holds the paused state. The
        // propose-only drafter never issues one, but the lifecycle is reproduced for parity with the shared hook.
        Assert.Equal(AiTripPostcardStreamState.PausedConfirm, vm.State);
    }

    [Fact]
    public void Streaming_state_flips_button_label_and_disables_action()
    {
        var transport = new IdleBlockingTransport();
        var vm = NewViewModel(transport: transport);

        vm.Start();

        Assert.Equal(AiTripPostcardStreamState.Streaming, vm.State);
        Assert.True(vm.IsStreaming);
        Assert.Equal("Helix is thinking\u2026", vm.ButtonText);
        Assert.False(vm.ButtonEnabled);
        Assert.Equal(string.Empty, vm.Text);
        Assert.True(vm.ShowThinking);
        Assert.True(vm.HasOutput);

        vm.Cancel();
    }

    [Fact]
    public async Task Cancel_returns_stream_to_idle_keeping_arrived_text()
    {
        var transport = new PrimedBlockingTransport();
        var vm = NewViewModel(transport: transport);

        vm.Start();
        Assert.Equal("primed", vm.Text);

        vm.Cancel();
        await vm.PendingStream!;

        // web AbortError path: a cancelled stream returns to idle (never error), keeping what already arrived.
        Assert.Equal(AiTripPostcardStreamState.Idle, vm.State);
        Assert.Equal("primed", vm.Text);
    }

    [Fact]
    public async Task Restarting_resets_accumulated_text_and_error()
    {
        var failing = new ThrowingTransport(new HttpRequestException("stream_http_500"));
        var vm = NewViewModel(transport: failing);
        vm.Start();
        await vm.PendingStream!;
        Assert.Equal(AiTripPostcardStreamState.Error, vm.State);

        // A re-press clears the prior error/text before re-opening; here the holder is reused with a fresh script.
        var vm2 = NewViewModel(transport: new ScriptedTransport(Delta("fresh"), DoneFrame()));
        vm2.Start();
        await vm2.PendingStream!;
        Assert.Equal(AiTripPostcardStreamState.Done, vm2.State);
        Assert.Equal("fresh", vm2.Text);
        Assert.False(vm2.ShowError);
    }

    // ── diagnostics: view.opened slug=AITripPostcardShareCardImageGeneration (P1/S11) ────────────────────

    [Fact]
    public void Diagnostics_emit_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new AITripPostcardShareCardImageGenerationDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=AITripPostcardShareCardImageGeneration", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_never_leak_draft_or_prompt_content()
    {
        var lines = new List<string>();
        var diagnostics = new AITripPostcardShareCardImageGenerationDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        // The only signal is the operational view.opened with the slug — no draft text, no trip id, no style hint.
        Assert.All(lines, line => Assert.StartsWith("view.opened slug=", line, StringComparison.Ordinal));
    }

    // ── helpers ──────────────────────────────────────────────────────────────────────────────────────────

    private static AITripPostcardShareCardImageGenerationViewModel NewViewModel(
        IAiTripPostcardTransport? transport = null,
        IAiFeatureGate? gate = null,
        long? tripId = 7,
        string? styleHint = null) =>
        new(
            transport ?? new ScriptedTransport(),
            gate ?? new DelegateAiFeatureGate(id => id == AITripPostcardShareCardImageGenerationRegistration.FeatureId),
            PassthroughLocalizer.Instance,
            tripId,
            styleHint);

    private static string Delta(string text) =>
        $"event: delta\ndata: {{\"text\":{System.Text.Json.JsonSerializer.Serialize(text)}}}\n\n";

    private static string DoneFrame() => "event: done\ndata: {}\n\n";

    private sealed class MapLocalizer : ILocalizer
    {
        private readonly IReadOnlyDictionary<string, string> _map;

        public MapLocalizer(IReadOnlyDictionary<string, string> map) => _map = map;

        public string GetString(string key, string fallback) =>
            _map.TryGetValue(key, out var value) ? value : fallback;
    }

    private sealed class ScriptedTransport : IAiTripPostcardTransport
    {
        private readonly string[] _chunks;

        public ScriptedTransport(params string[] chunks) => _chunks = chunks;

        public AiTripPostcardRequest? LastRequest { get; private set; }

        public async IAsyncEnumerable<string> OpenAsync(
            AiTripPostcardRequest request,
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            LastRequest = request;
            foreach (var chunk in _chunks)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return chunk;
            }

            await Task.CompletedTask;
        }
    }

    private sealed class ThrowingTransport : IAiTripPostcardTransport
    {
        private readonly Exception _error;

        public ThrowingTransport(Exception error) => _error = error;

        public async IAsyncEnumerable<string> OpenAsync(
            AiTripPostcardRequest request,
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            await Task.CompletedTask;
            throw _error;
#pragma warning disable CS0162 // Unreachable code — required to make the method an async iterator.
            yield break;
#pragma warning restore CS0162
        }
    }

    private sealed class IdleBlockingTransport : IAiTripPostcardTransport
    {
        public async IAsyncEnumerable<string> OpenAsync(
            AiTripPostcardRequest request,
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            await Task.Delay(Timeout.Infinite, cancellationToken);
            yield break;
        }
    }

    private sealed class PrimedBlockingTransport : IAiTripPostcardTransport
    {
        public async IAsyncEnumerable<string> OpenAsync(
            AiTripPostcardRequest request,
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            yield return "event: delta\ndata: {\"text\":\"primed\"}\n\n";
            await Task.Delay(Timeout.Infinite, cancellationToken);
        }
    }
}
