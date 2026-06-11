using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Live;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the AIVehiclePaintPreview surface's UI-thread-free logic — the SSE-frame adapter
/// (<see cref="AiPaintPreviewStreamParser"/>), the per-vehicle request adapter (<see cref="AiPaintPreviewRequest"/>,
/// the web <c>numericVehicleId</c> / <c>body</c> / <c>urlPath</c> derivation), the stream state holder
/// (<see cref="AiVehiclePaintPreviewViewModel"/>), the label projection, the AI-feature gate and the PII-safe
/// diagnostics. Mirrors the web spec one-for-one (web/src/components/ai/AIVehiclePaintPreview.tsx +
/// web/src/hooks/useAiStream.ts). The WinUI part (<c>AIVehiclePaintPreview</c> in
/// shared-surfaces/AIVehiclePaintPreview.cs, which composes the glass panel, badge, action button, empty hint and
/// output region and marshals stream notifications onto the dispatcher) binds 1:1 to the state-holder flags
/// asserted here (CanStart / ShowEmptyHint / ShowThinking / ShowText / ShowError / IsOffline) and is exercised by
/// the app build.
/// </summary>
public sealed class AIVehiclePaintPreviewTests
{
    // ── adapter: parseSSEFrame / toTypedEvent (web/src/hooks/useAiStream.ts L364-L468) ───────────────────

    [Fact]
    public void Delta_frame_parses_text()
    {
        var ev = AiPaintPreviewStreamParser.ToTypedEvent("delta", "{\"text\":\"A red roadster\"}");

        Assert.NotNull(ev);
        Assert.Equal(AiPaintPreviewEventKind.Delta, ev!.Kind);
        Assert.Equal("A red roadster", ev.Text);
    }

    [Fact]
    public void Delta_frame_without_text_is_dropped()
    {
        Assert.Null(AiPaintPreviewStreamParser.ToTypedEvent("delta", "{\"notText\":1}"));
        Assert.Null(AiPaintPreviewStreamParser.ToTypedEvent("delta", "{\"text\":5}"));
    }

    [Fact]
    public void Tool_call_frame_parses_id_name_and_raw_arguments()
    {
        var ev = AiPaintPreviewStreamParser.ToTypedEvent(
            "tool_call", "{\"id\":\"t1\",\"name\":\"vehicle_context\",\"arguments\":{\"k\":1}}");

        Assert.NotNull(ev);
        Assert.Equal(AiPaintPreviewEventKind.ToolCall, ev!.Kind);
        Assert.Equal("t1", ev.Id);
        Assert.Equal("vehicle_context", ev.Name);
        Assert.Equal("{\"k\":1}", ev.ArgumentsJson);
    }

    [Fact]
    public void Tool_call_frame_missing_required_field_is_dropped()
    {
        Assert.Null(AiPaintPreviewStreamParser.ToTypedEvent("tool_call", "{\"id\":\"t1\"}"));
        Assert.Null(AiPaintPreviewStreamParser.ToTypedEvent("tool_call", "{\"name\":\"x\"}"));
    }

    [Theory]
    [InlineData("true", true)]
    [InlineData("false", false)]
    public void Tool_result_frame_parses_ok(string okLiteral, bool expected)
    {
        var ev = AiPaintPreviewStreamParser.ToTypedEvent(
            "tool_result", $"{{\"id\":\"t1\",\"name\":\"x\",\"ok\":{okLiteral},\"data\":[1,2],\"error\":\"e\"}}");

        Assert.NotNull(ev);
        Assert.Equal(AiPaintPreviewEventKind.ToolResult, ev!.Kind);
        Assert.Equal(expected, ev.Ok);
        Assert.Equal("[1,2]", ev.DataJson);
        Assert.Equal("e", ev.ToolError);
    }

    [Fact]
    public void Tool_result_frame_without_ok_is_dropped() =>
        Assert.Null(AiPaintPreviewStreamParser.ToTypedEvent("tool_result", "{\"id\":\"t1\",\"name\":\"x\"}"));

    [Fact]
    public void Confirm_request_frame_parses_fields()
    {
        var ev = AiPaintPreviewStreamParser.ToTypedEvent(
            "confirm_request", "{\"continuation_id\":\"c1\",\"tool\":\"apply\",\"summary\":\"Proceed?\",\"args\":{}}");

        Assert.NotNull(ev);
        Assert.Equal(AiPaintPreviewEventKind.ConfirmRequest, ev!.Kind);
        Assert.Equal("c1", ev.ContinuationId);
        Assert.Equal("apply", ev.Tool);
        Assert.Equal("Proceed?", ev.Summary);
        Assert.Equal("{}", ev.ArgsJson);
    }

    [Fact]
    public void Confirm_request_frame_missing_summary_is_dropped() =>
        Assert.Null(AiPaintPreviewStreamParser.ToTypedEvent("confirm_request", "{\"continuation_id\":\"c1\",\"tool\":\"x\"}"));

    [Fact]
    public void Done_frame_parses_finish_reason_and_usage()
    {
        var ev = AiPaintPreviewStreamParser.ToTypedEvent(
            "done", "{\"finish_reason\":\"length\",\"usage\":{\"in\":10,\"out\":20}}");

        Assert.NotNull(ev);
        Assert.Equal(AiPaintPreviewEventKind.Done, ev!.Kind);
        Assert.Equal("length", ev.FinishReason);
        Assert.Equal(10, ev.UsageIn);
        Assert.Equal(20, ev.UsageOut);
    }

    [Fact]
    public void Done_frame_defaults_finish_reason_and_usage()
    {
        var ev = AiPaintPreviewStreamParser.ToTypedEvent("done", "{}");

        Assert.NotNull(ev);
        Assert.Equal("stop", ev!.FinishReason);
        Assert.Equal(0, ev.UsageIn);
        Assert.Equal(0, ev.UsageOut);
    }

    [Fact]
    public void Error_frame_parses_structured_limit_fields()
    {
        var ev = AiPaintPreviewStreamParser.ToTypedEvent(
            "error",
            "{\"message\":\"too many\",\"reason\":\"rate_limited\",\"retry_after_s\":30,\"banner_level\":\"warn\",\"baseline_available\":true}");

        Assert.NotNull(ev);
        Assert.Equal(AiPaintPreviewEventKind.Error, ev!.Kind);
        Assert.Equal("too many", ev.Message);
        Assert.Equal("rate_limited", ev.Reason);
        Assert.Equal(30, ev.RetryAfterS);
        Assert.Equal("warn", ev.BannerLevel);
        Assert.True(ev.BaselineAvailable);
    }

    [Fact]
    public void Error_frame_defaults_message_and_drops_invalid_banner_level()
    {
        var ev = AiPaintPreviewStreamParser.ToTypedEvent("error", "{\"banner_level\":\"bogus\"}");

        Assert.NotNull(ev);
        Assert.Equal("unknown", ev!.Message);
        Assert.Null(ev.Reason);
        Assert.Null(ev.BannerLevel);
        Assert.Null(ev.BaselineAvailable);
    }

    [Fact]
    public void Error_frame_allows_empty_banner_level()
    {
        var ev = AiPaintPreviewStreamParser.ToTypedEvent("error", "{\"message\":\"x\",\"reason\":\"capped\",\"banner_level\":\"\"}");

        Assert.NotNull(ev);
        Assert.Equal(string.Empty, ev!.BannerLevel);
    }

    [Theory]
    [InlineData("future_event", "{\"x\":1}")]
    [InlineData("delta", "not json")]
    [InlineData("delta", "5")]
    [InlineData("delta", "")]
    [InlineData("", "{\"text\":\"hi\"}")]
    public void Unknown_malformed_or_empty_frames_are_dropped(string eventName, string data) =>
        Assert.Null(AiPaintPreviewStreamParser.ToTypedEvent(eventName, data));

    [Fact]
    public void ParseFrame_delegates_to_typed_event()
    {
        var ev = AiPaintPreviewStreamParser.ParseFrame(new SseFrame("delta", "{\"text\":\"Hi\"}", null, null));

        Assert.NotNull(ev);
        Assert.Equal("Hi", ev!.Text);
    }

    // ── adapter: numericVehicleId / body / urlPath (web AIVehiclePaintPreview.tsx L62-L84) ────────────────

    [Fact]
    public void Request_with_positive_vehicle_id_builds_path_and_enables_action()
    {
        var request = AiPaintPreviewRequest.Create(42, null);

        Assert.Equal(42, request.NumericVehicleId);
        Assert.Equal(42, request.EffectiveVehicleId);
        Assert.True(request.HasInputs);
        Assert.Equal("/ai/vehicles/42/paint-preview/draft", request.DraftPath);
        // web: empty payload → JSON.stringify({}) === "{}".
        Assert.Equal("{}", request.BodyJson);
        Assert.Null(request.StyleHint);
    }

    [Fact]
    public void Request_carries_trimmed_style_hint_in_body()
    {
        var request = AiPaintPreviewRequest.Create(7, "  studio  ");

        Assert.Equal("studio", request.StyleHint);
        // web: JSON.stringify({ style_hint: styleHint.trim() }).
        Assert.Equal("{\"style_hint\":\"studio\"}", request.BodyJson);
        Assert.Equal("/ai/vehicles/7/paint-preview/draft", request.DraftPath);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Request_omits_blank_style_hint_from_body(string? styleHint)
    {
        var request = AiPaintPreviewRequest.Create(7, styleHint);

        Assert.Null(request.StyleHint);
        Assert.Equal("{}", request.BodyJson);
    }

    [Theory]
    [InlineData(null)]
    [InlineData(0)]
    [InlineData(-3)]
    public void Request_without_resolved_vehicle_disables_action_and_uses_zero_path(int? vehicleId)
    {
        var request = AiPaintPreviewRequest.Create(vehicleId, "studio");

        // web: haveInputs = numericVehicleId > 0; urlPath falls back to /ai/vehicles/0/... when not positive.
        Assert.False(request.HasInputs);
        Assert.Equal(0, request.EffectiveVehicleId);
        Assert.Equal("/ai/vehicles/0/paint-preview/draft", request.DraftPath);
    }

    // ── projection: InnerSection + AIFeatureCard copy (web/src/components/ai/AIVehiclePaintPreview.tsx) ────

    [Fact]
    public void Projection_resolves_web_default_fallbacks()
    {
        var display = AIVehiclePaintPreviewProjection.Project(PassthroughLocalizer.Instance);

        Assert.Equal("Draft a Helix paint preview", display.Title);
        Assert.Equal(AIVehiclePaintPreviewRegistration.DescriptionFallback, display.Description);
        Assert.Equal("Helix", display.BadgeLabel);
        Assert.Equal("Ask Helix", display.AskHelixLabel);
        Assert.Equal("Helix is thinking\u2026", display.ThinkingLabel);
        Assert.Equal("Preview paint color", display.ButtonLabel);
        Assert.Equal("Open a vehicle detail page to enable Helix.", display.NoVehicleHint);
        Assert.Equal("Helix error:", display.ErrorLabel);
        Assert.Equal("Retry", display.RetryLabel);
    }

    [Fact]
    public void Projection_description_carries_privacy_and_propose_only_contract()
    {
        var display = AIVehiclePaintPreviewProjection.Project(PassthroughLocalizer.Instance);

        Assert.Contains("propose-only", display.Description, StringComparison.Ordinal);
        Assert.Contains("never applied automatically", display.Description, StringComparison.Ordinal);
        Assert.Contains("redacted vehicle context", display.Description, StringComparison.Ordinal);
    }

    [Fact]
    public void Projection_composes_button_accessible_name()
    {
        var display = AIVehiclePaintPreviewProjection.Project(PassthroughLocalizer.Instance);

        // web AIFeatureCard: aria-label = `${askHelixLabel} · ${buttonLabel}`.
        Assert.Equal("Ask Helix \u00b7 Preview paint color", display.ButtonAutomationName);
        Assert.Contains(display.AskHelixLabel, display.ButtonAutomationName, StringComparison.Ordinal);
        Assert.Contains(display.ButtonLabel, display.ButtonAutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Projection_consults_every_catalog_key()
    {
        var localizer = new MapLocalizer(new Dictionary<string, string>(StringComparer.Ordinal)
        {
            [AIVehiclePaintPreviewRegistration.TitleKey] = "T",
            [AIVehiclePaintPreviewRegistration.DescriptionKey] = "D",
            [AIVehiclePaintPreviewRegistration.BadgeKey] = "B",
            [AIVehiclePaintPreviewRegistration.AskHelixKey] = "A",
            [AIVehiclePaintPreviewRegistration.ThinkingKey] = "K",
            [AIVehiclePaintPreviewRegistration.ButtonLabelKey] = "P",
            [AIVehiclePaintPreviewRegistration.NoVehicleHintKey] = "H",
            [AIVehiclePaintPreviewRegistration.ErrorLabelKey] = "E",
            [AIVehiclePaintPreviewRegistration.ErrorUnknownKey] = "U",
            [AIVehiclePaintPreviewRegistration.OfflineKey] = "O",
            [AIVehiclePaintPreviewRegistration.RetryKey] = "R",
        });

        var display = AIVehiclePaintPreviewProjection.Project(localizer);

        Assert.Equal("T", display.Title);
        Assert.Equal("D", display.Description);
        Assert.Equal("B", display.BadgeLabel);
        Assert.Equal("A", display.AskHelixLabel);
        Assert.Equal("K", display.ThinkingLabel);
        Assert.Equal("P", display.ButtonLabel);
        Assert.Equal("H", display.NoVehicleHint);
        Assert.Equal("E", display.ErrorLabel);
        Assert.Equal("U", display.ErrorUnknown);
        Assert.Equal("O", display.OfflineMessage);
        Assert.Equal("R", display.RetryLabel);
        Assert.Equal("A \u00b7 P", display.ButtonAutomationName);
    }

    // ── a11y: the action carries the per-feature accessible name (web aria-label) ─────────────────────────

    [Fact]
    public void Action_accessible_name_is_present_and_non_empty()
    {
        var vm = NewViewModel(vehicleId: 9);

        Assert.False(string.IsNullOrWhiteSpace(vm.Display.ButtonAutomationName));
        Assert.Contains("Preview paint color", vm.Display.ButtonAutomationName, StringComparison.Ordinal);
    }

    // ── gate: withAiFeature / useAiEnabled (web/src/components/ai/withAiFeature.tsx) ──────────────────────

    [Fact]
    public void Gate_open_when_feature_enabled()
    {
        var vm = NewViewModel(gate: new DelegateAiFeatureGate(id => id == AIVehiclePaintPreviewRegistration.FeatureId));
        Assert.True(vm.IsGateOpen);
    }

    [Fact]
    public void Gate_closed_when_feature_disabled()
    {
        var vm = NewViewModel(gate: DelegateAiFeatureGate.Disabled);
        Assert.False(vm.IsGateOpen);
    }

    // ── canStart / emptyHint: web `canStart = haveInputs`, `!canStart && emptyHint` ──────────────────────

    [Fact]
    public void CanStart_false_without_vehicle_and_empty_hint_shows()
    {
        var vm = NewViewModel(vehicleId: null);

        Assert.False(vm.CanStart);
        Assert.True(vm.ShowEmptyHint);
        Assert.False(vm.ButtonEnabled);
        Assert.Equal("Ask Helix", vm.ButtonText);
    }

    [Fact]
    public void CanStart_true_with_vehicle_and_empty_hint_hidden()
    {
        var vm = NewViewModel(vehicleId: 42);

        Assert.True(vm.CanStart);
        Assert.False(vm.ShowEmptyHint);
        Assert.True(vm.ButtonEnabled);
    }

    [Fact]
    public async Task Start_is_noop_without_vehicle()
    {
        var transport = new ScriptedTransport(Delta("nope"), DoneFrame());
        var vm = NewViewModel(transport: transport, vehicleId: null);

        vm.Start();

        Assert.Null(vm.PendingStream);
        Assert.Equal(AiPaintPreviewStreamState.Idle, vm.State);
        await Task.CompletedTask;
    }

    // ── stream lifecycle: useAiStream idle → streaming → done | error ────────────────────────────────────

    [Fact]
    public async Task Stream_accumulates_delta_text_then_completes_on_done()
    {
        var transport = new ScriptedTransport(Delta("A studio-lit "), Delta("midnight silver coupe."), DoneFrame());
        var vm = NewViewModel(transport: transport, vehicleId: 7);

        vm.Start();
        await vm.PendingStream!;

        Assert.Equal(AiPaintPreviewStreamState.Done, vm.State);
        Assert.Equal("A studio-lit midnight silver coupe.", vm.Text);
        Assert.False(vm.IsStreaming);
        Assert.True(vm.ShowText);
        Assert.False(vm.ShowError);
        Assert.True(vm.HasOutput);
    }

    [Fact]
    public async Task Stream_passes_effective_vehicle_id_and_style_hint_to_transport()
    {
        var transport = new CapturingTransport(Delta("ok"), DoneFrame());
        var vm = NewViewModel(transport: transport, vehicleId: 13, styleHint: "  outdoor ");

        vm.Start();
        await vm.PendingStream!;

        Assert.Equal(13, transport.LastVehicleId);
        Assert.Equal("outdoor", transport.LastStyleHint);
    }

    [Fact]
    public async Task Stream_settles_done_when_connection_closes_without_terminal_frame()
    {
        var transport = new ScriptedTransport(Delta("partial"));
        var vm = NewViewModel(transport: transport, vehicleId: 7);

        vm.Start();
        await vm.PendingStream!;

        // web: setState(cur => cur === 'streaming' ? 'done' : cur) on clean close.
        Assert.Equal(AiPaintPreviewStreamState.Done, vm.State);
        Assert.Equal("partial", vm.Text);
    }

    [Fact]
    public async Task Stream_reassembles_frames_split_across_chunks()
    {
        var transport = new ScriptedTransport(
            "event: delta\ndata: {\"text\":\"Hel",
            "lo\"}\n\nevent: done\ndata: {}\n\n");
        var vm = NewViewModel(transport: transport, vehicleId: 7);

        vm.Start();
        await vm.PendingStream!;

        Assert.Equal(AiPaintPreviewStreamState.Done, vm.State);
        Assert.Equal("Hello", vm.Text);
    }

    [Fact]
    public async Task Error_frame_sets_error_state_and_captures_limit()
    {
        var transport = new ScriptedTransport(
            "event: error\ndata: {\"message\":\"capped\",\"reason\":\"cost_cap\",\"retry_after_s\":60,\"banner_level\":\"critical\",\"baseline_available\":false}\n\n");
        var vm = NewViewModel(transport: transport, vehicleId: 7);

        vm.Start();
        await vm.PendingStream!;

        Assert.Equal(AiPaintPreviewStreamState.Error, vm.State);
        Assert.Equal("capped", vm.Error);
        Assert.True(vm.ShowError);
        Assert.False(vm.IsOffline);
        Assert.NotNull(vm.Limit);
        Assert.Equal("cost_cap", vm.Limit!.Reason);
        Assert.Equal(60, vm.Limit.RetryAfterS);
        Assert.Equal("critical", vm.Limit.BannerLevel);
        Assert.False(vm.Limit.BaselineAvailable);
        // web AiOutputPanel: "Helix error: <message>".
        Assert.Equal("Helix error: capped", vm.DisplayErrorText);
    }

    [Fact]
    public async Task Plain_error_frame_sets_error_without_limit()
    {
        var transport = new ScriptedTransport("event: error\ndata: {\"message\":\"boom\"}\n\n");
        var vm = NewViewModel(transport: transport, vehicleId: 7);

        vm.Start();
        await vm.PendingStream!;

        Assert.Equal(AiPaintPreviewStreamState.Error, vm.State);
        Assert.Equal("boom", vm.Error);
        Assert.Null(vm.Limit);
        Assert.Equal("Helix error: boom", vm.DisplayErrorText);
    }

    [Fact]
    public async Task Confirm_request_pauses_the_stream()
    {
        var transport = new ScriptedTransport(
            "event: confirm_request\ndata: {\"continuation_id\":\"c1\",\"tool\":\"t\",\"summary\":\"ok?\"}\n\n");
        var vm = NewViewModel(transport: transport, vehicleId: 7);

        vm.Start();
        await vm.PendingStream!;

        // web: a confirm_request is NOT promoted to done on close; the surface holds the paused state.
        Assert.Equal(AiPaintPreviewStreamState.PausedConfirm, vm.State);
    }

    [Fact]
    public async Task Http_failure_surfaces_as_error_with_status_code()
    {
        var transport = new ThrowingTransport(new HttpRequestException("stream_http_404"));
        var vm = NewViewModel(transport: transport, vehicleId: 7);

        vm.Start();
        await vm.PendingStream!;

        // web: a non-ok response yields error state with `stream_http_${status}` (off-mode 404 → baseline fallback).
        Assert.Equal(AiPaintPreviewStreamState.Error, vm.State);
        Assert.Equal("stream_http_404", vm.Error);
        Assert.False(vm.IsOffline);
        Assert.Equal("Helix error: stream_http_404", vm.DisplayErrorText);
    }

    [Fact]
    public async Task Connectivity_fault_surfaces_as_offline()
    {
        var transport = new ThrowingTransport(new HttpRequestException("Connection refused"));
        var vm = NewViewModel(transport: transport, vehicleId: 7);

        vm.Start();
        await vm.PendingStream!;

        // A non-`stream_http_` HttpRequestException is a connectivity fault → the offline affordance (P2 offline
        // state for a cache-free on-demand surface).
        Assert.Equal(AiPaintPreviewStreamState.Error, vm.State);
        Assert.True(vm.IsOffline);
        Assert.Equal("You\u2019re offline \u2014 reconnect and try the paint preview again", vm.DisplayErrorText);
    }

    [Fact]
    public async Task Mid_stream_io_failure_surfaces_as_offline()
    {
        var transport = new ThrowingTransport(new IOException("socket reset"));
        var vm = NewViewModel(transport: transport, vehicleId: 7);

        vm.Start();
        await vm.PendingStream!;

        Assert.Equal(AiPaintPreviewStreamState.Error, vm.State);
        Assert.True(vm.IsOffline);
    }

    [Fact]
    public async Task Streaming_state_flips_button_label_and_disables_action()
    {
        var transport = new IdleBlockingTransport();
        var vm = NewViewModel(transport: transport, vehicleId: 7);

        vm.Start();

        Assert.Equal(AiPaintPreviewStreamState.Streaming, vm.State);
        Assert.True(vm.IsStreaming);
        Assert.Equal("Helix is thinking\u2026", vm.ButtonText);
        Assert.False(vm.ButtonEnabled);
        Assert.Equal(string.Empty, vm.Text);
        Assert.True(vm.ShowThinking);

        vm.Cancel();
        await vm.PendingStream!;
    }

    [Fact]
    public async Task Cancel_returns_stream_to_idle()
    {
        var transport = new PrimedBlockingTransport();
        var vm = NewViewModel(transport: transport, vehicleId: 7);

        vm.Start();
        Assert.Equal("primed", vm.Text);

        vm.Cancel();
        await vm.PendingStream!;

        // web AbortError path: a cancelled stream returns to idle (never error), keeping what already arrived.
        Assert.Equal(AiPaintPreviewStreamState.Idle, vm.State);
        Assert.Equal("primed", vm.Text);
    }

    [Fact]
    public async Task Restarting_resets_accumulated_text_and_error()
    {
        var failing = new ThrowingTransport(new HttpRequestException("stream_http_500"));
        var vm = NewViewModel(transport: failing, vehicleId: 7);
        vm.Start();
        await vm.PendingStream!;
        Assert.Equal(AiPaintPreviewStreamState.Error, vm.State);

        // A re-press clears the prior error/text before re-opening; here the holder is reused with a fresh script.
        var vm2 = NewViewModel(transport: new ScriptedTransport(Delta("fresh"), DoneFrame()), vehicleId: 7);
        vm2.Start();
        await vm2.PendingStream!;
        Assert.Equal(AiPaintPreviewStreamState.Done, vm2.State);
        Assert.Equal("fresh", vm2.Text);
        Assert.Null(vm2.Error);
    }

    // ── diagnostics: view.opened slug=AIVehiclePaintPreview (P1/S11) ──────────────────────────────────────

    [Fact]
    public void Diagnostics_emit_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new AIVehiclePaintPreviewDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=AIVehiclePaintPreview", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_never_leak_vehicle_content()
    {
        var lines = new List<string>();
        var diagnostics = new AIVehiclePaintPreviewDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.DoesNotContain(lines, line => line.Contains("style_hint", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(lines, line => line.Contains("/ai/vehicles/", StringComparison.OrdinalIgnoreCase));
    }

    // ── helpers ──────────────────────────────────────────────────────────────────────────────────────────

    private static AiVehiclePaintPreviewViewModel NewViewModel(
        IAiPaintPreviewTransport? transport = null,
        IAiFeatureGate? gate = null,
        int? vehicleId = 1,
        string? styleHint = null) =>
        new(
            transport ?? new ScriptedTransport(),
            gate ?? new DelegateAiFeatureGate(id => id == AIVehiclePaintPreviewRegistration.FeatureId),
            PassthroughLocalizer.Instance,
            vehicleId,
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

    private sealed class ScriptedTransport : IAiPaintPreviewTransport
    {
        private readonly string[] _chunks;

        public ScriptedTransport(params string[] chunks) => _chunks = chunks;

        public async IAsyncEnumerable<string> OpenAsync(
            int vehicleId,
            string? styleHint,
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            foreach (var chunk in _chunks)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return chunk;
            }

            await Task.CompletedTask;
        }
    }

    private sealed class CapturingTransport : IAiPaintPreviewTransport
    {
        private readonly string[] _chunks;

        public CapturingTransport(params string[] chunks) => _chunks = chunks;

        public int LastVehicleId { get; private set; }

        public string? LastStyleHint { get; private set; }

        public async IAsyncEnumerable<string> OpenAsync(
            int vehicleId,
            string? styleHint,
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            LastVehicleId = vehicleId;
            LastStyleHint = styleHint;
            foreach (var chunk in _chunks)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return chunk;
            }

            await Task.CompletedTask;
        }
    }

    private sealed class ThrowingTransport : IAiPaintPreviewTransport
    {
        private readonly Exception _error;

        public ThrowingTransport(Exception error) => _error = error;

        public async IAsyncEnumerable<string> OpenAsync(
            int vehicleId,
            string? styleHint,
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            await Task.CompletedTask;
            if (_error is not null)
            {
                throw _error;
            }

            yield break;
        }
    }

    private sealed class IdleBlockingTransport : IAiPaintPreviewTransport
    {
        public async IAsyncEnumerable<string> OpenAsync(
            int vehicleId,
            string? styleHint,
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            await Task.Delay(Timeout.Infinite, cancellationToken);
            yield break;
        }
    }

    private sealed class PrimedBlockingTransport : IAiPaintPreviewTransport
    {
        public async IAsyncEnumerable<string> OpenAsync(
            int vehicleId,
            string? styleHint,
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            yield return "event: delta\ndata: {\"text\":\"primed\"}\n\n";
            await Task.Delay(Timeout.Infinite, cancellationToken);
        }
    }
}
