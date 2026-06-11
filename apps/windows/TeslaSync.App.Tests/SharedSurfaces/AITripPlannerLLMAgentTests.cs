using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Live;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the AITripPlannerLLMAgent surface's UI-thread-free logic — the SSE-frame adapter
/// (<see cref="AiTripPlanStreamParser"/>), the draft request-body builder (<see cref="AiTripPlanRequest"/>), the
/// stream state holder (<see cref="AiTripPlannerLLMAgentViewModel"/>), the label projection, the AI-feature gate
/// and the PII-safe diagnostics. Mirrors the web spec one-for-one
/// (web/src/components/ai/AITripPlannerLLMAgent.tsx + web/src/hooks/useAiStream.ts). The WinUI part
/// (<c>AITripPlannerLLMAgent</c> in shared-surfaces/AITripPlannerLLMAgent.cs, which composes the glass panel,
/// badge, action button and output region and marshals stream notifications onto the dispatcher) is exercised by
/// the app build.
/// </summary>
public sealed class AITripPlannerLLMAgentTests
{
    // ── adapter: parseSSEFrame / toTypedEvent (web/src/hooks/useAiStream.ts L364-L468) ───────────────────

    [Fact]
    public void Delta_frame_parses_text()
    {
        var ev = AiTripPlanStreamParser.ToTypedEvent("delta", "{\"text\":\"Hello\"}");

        Assert.NotNull(ev);
        Assert.Equal(AiTripPlanEventKind.Delta, ev!.Kind);
        Assert.Equal("Hello", ev.Text);
    }

    [Fact]
    public void Delta_frame_without_text_is_dropped()
    {
        Assert.Null(AiTripPlanStreamParser.ToTypedEvent("delta", "{\"notText\":1}"));
        Assert.Null(AiTripPlanStreamParser.ToTypedEvent("delta", "{\"text\":5}"));
    }

    [Fact]
    public void Tool_call_frame_parses_id_name_and_raw_arguments()
    {
        var ev = AiTripPlanStreamParser.ToTypedEvent(
            "tool_call", "{\"id\":\"t1\",\"name\":\"charging\",\"arguments\":{\"k\":1}}");

        Assert.NotNull(ev);
        Assert.Equal(AiTripPlanEventKind.ToolCall, ev!.Kind);
        Assert.Equal("t1", ev.Id);
        Assert.Equal("charging", ev.Name);
        Assert.Equal("{\"k\":1}", ev.ArgumentsJson);
    }

    [Fact]
    public void Tool_call_frame_missing_required_field_is_dropped()
    {
        Assert.Null(AiTripPlanStreamParser.ToTypedEvent("tool_call", "{\"id\":\"t1\"}"));
        Assert.Null(AiTripPlanStreamParser.ToTypedEvent("tool_call", "{\"name\":\"x\"}"));
    }

    [Theory]
    [InlineData("true", true)]
    [InlineData("false", false)]
    public void Tool_result_frame_parses_ok(string okLiteral, bool expected)
    {
        var ev = AiTripPlanStreamParser.ToTypedEvent(
            "tool_result", $"{{\"id\":\"t1\",\"name\":\"x\",\"ok\":{okLiteral},\"data\":[1,2],\"error\":\"e\"}}");

        Assert.NotNull(ev);
        Assert.Equal(AiTripPlanEventKind.ToolResult, ev!.Kind);
        Assert.Equal(expected, ev.Ok);
        Assert.Equal("[1,2]", ev.DataJson);
        Assert.Equal("e", ev.ToolError);
    }

    [Fact]
    public void Tool_result_frame_without_ok_is_dropped() =>
        Assert.Null(AiTripPlanStreamParser.ToTypedEvent("tool_result", "{\"id\":\"t1\",\"name\":\"x\"}"));

    [Fact]
    public void Confirm_request_frame_parses_fields()
    {
        var ev = AiTripPlanStreamParser.ToTypedEvent(
            "confirm_request", "{\"continuation_id\":\"c1\",\"tool\":\"save\",\"summary\":\"Proceed?\",\"args\":{}}");

        Assert.NotNull(ev);
        Assert.Equal(AiTripPlanEventKind.ConfirmRequest, ev!.Kind);
        Assert.Equal("c1", ev.ContinuationId);
        Assert.Equal("save", ev.Tool);
        Assert.Equal("Proceed?", ev.Summary);
        Assert.Equal("{}", ev.ArgsJson);
    }

    [Fact]
    public void Confirm_request_frame_missing_summary_is_dropped() =>
        Assert.Null(AiTripPlanStreamParser.ToTypedEvent("confirm_request", "{\"continuation_id\":\"c1\",\"tool\":\"x\"}"));

    [Fact]
    public void Done_frame_parses_finish_reason_and_usage()
    {
        var ev = AiTripPlanStreamParser.ToTypedEvent(
            "done", "{\"finish_reason\":\"length\",\"usage\":{\"in\":10,\"out\":20}}");

        Assert.NotNull(ev);
        Assert.Equal(AiTripPlanEventKind.Done, ev!.Kind);
        Assert.Equal("length", ev.FinishReason);
        Assert.Equal(10, ev.UsageIn);
        Assert.Equal(20, ev.UsageOut);
    }

    [Fact]
    public void Done_frame_defaults_finish_reason_and_usage()
    {
        var ev = AiTripPlanStreamParser.ToTypedEvent("done", "{}");

        Assert.NotNull(ev);
        Assert.Equal("stop", ev!.FinishReason);
        Assert.Equal(0, ev.UsageIn);
        Assert.Equal(0, ev.UsageOut);
    }

    [Fact]
    public void Error_frame_parses_structured_limit_fields()
    {
        var ev = AiTripPlanStreamParser.ToTypedEvent(
            "error",
            "{\"message\":\"too many\",\"reason\":\"rate_limited\",\"retry_after_s\":30,\"banner_level\":\"warn\",\"baseline_available\":true}");

        Assert.NotNull(ev);
        Assert.Equal(AiTripPlanEventKind.Error, ev!.Kind);
        Assert.Equal("too many", ev.Message);
        Assert.Equal("rate_limited", ev.Reason);
        Assert.Equal(30, ev.RetryAfterS);
        Assert.Equal("warn", ev.BannerLevel);
        Assert.True(ev.BaselineAvailable);
    }

    [Fact]
    public void Error_frame_defaults_message_and_drops_invalid_banner_level()
    {
        var ev = AiTripPlanStreamParser.ToTypedEvent("error", "{\"banner_level\":\"bogus\"}");

        Assert.NotNull(ev);
        Assert.Equal("unknown", ev!.Message);
        Assert.Null(ev.Reason);
        Assert.Null(ev.BannerLevel);
        Assert.Null(ev.BaselineAvailable);
    }

    [Fact]
    public void Error_frame_allows_empty_banner_level()
    {
        var ev = AiTripPlanStreamParser.ToTypedEvent("error", "{\"message\":\"x\",\"reason\":\"capped\",\"banner_level\":\"\"}");

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
        Assert.Null(AiTripPlanStreamParser.ToTypedEvent(eventName, data));

    [Fact]
    public void ParseFrame_delegates_to_typed_event()
    {
        var ev = AiTripPlanStreamParser.ParseFrame(new SseFrame("delta", "{\"text\":\"Hi\"}", null, null));

        Assert.NotNull(ev);
        Assert.Equal("Hi", ev!.Text);
    }

    // ── request body: useMemo body (web/src/components/ai/AITripPlannerLLMAgent.tsx L39-L70) ──────────────

    [Fact]
    public void Build_applies_web_default_soc_and_speed_factor()
    {
        var request = AiTripPlanRequest.Build(new AiTripPlannerInputs(
            VehicleId: "7",
            Origin: new TripLocation(1, 2, "A"),
            Destination: new TripLocation(3, 4, "B")));

        // web: current_soc ?? 80, charge_limit_soc ?? 90, min_arrival_soc ?? 20, speed_factor ?? 1.0.
        Assert.Equal(80, request.CurrentSoc);
        Assert.Equal(90, request.ChargeLimitSoc);
        Assert.Equal(20, request.MinArrivalSoc);
        Assert.Equal(1.0, request.SpeedFactor);
    }

    [Fact]
    public void Build_uses_supplied_soc_and_speed_factor()
    {
        var request = AiTripPlanRequest.Build(new AiTripPlannerInputs(
            VehicleId: "7",
            Origin: new TripLocation(1, 2, "A"),
            Destination: new TripLocation(3, 4, "B"),
            CurrentSoc: 55,
            MinArrivalSoc: 15,
            ChargeLimitSoc: 100,
            SpeedFactor: 1.2));

        Assert.Equal(55, request.CurrentSoc);
        Assert.Equal(100, request.ChargeLimitSoc);
        Assert.Equal(15, request.MinArrivalSoc);
        Assert.Equal(1.2, request.SpeedFactor);
    }

    [Fact]
    public void Build_zero_fills_absent_endpoints()
    {
        var request = AiTripPlanRequest.Build(new AiTripPlannerInputs(VehicleId: "7"));

        // web: origin/destination ? {...} : { lat: 0, lng: 0, name: '' }.
        Assert.Equal(0, request.Origin.Lat);
        Assert.Equal(0, request.Origin.Lng);
        Assert.Equal(string.Empty, request.Origin.Name);
        Assert.Equal(0, request.Destination.Lat);
        Assert.Equal(string.Empty, request.Destination.Name);
    }

    [Fact]
    public void Build_carries_endpoint_coordinates_and_defaults_missing_name()
    {
        var request = AiTripPlanRequest.Build(new AiTripPlannerInputs(
            VehicleId: "7",
            Origin: new TripLocation(37.5, -122.3, "Home"),
            Destination: new TripLocation(34.1, -118.2)));

        Assert.Equal(37.5, request.Origin.Lat);
        Assert.Equal(-122.3, request.Origin.Lng);
        Assert.Equal("Home", request.Origin.Name);
        // web: name ?? '' — an absent name becomes the empty string.
        Assert.Equal(string.Empty, request.Destination.Name);
    }

    [Theory]
    [InlineData("42", 42)]
    [InlineData("0", 0)]
    [InlineData("abc", 0)]
    [InlineData(null, 0)]
    [InlineData("", 0)]
    public void Build_parses_vehicle_id_to_int_or_zero(string? vehicleId, long expected)
    {
        var request = AiTripPlanRequest.Build(new AiTripPlannerInputs(vehicleId));

        // web: numericVehicleId || 0 — a non-numeric / absent id becomes 0.
        Assert.Equal(expected, request.VehicleId);
    }

    [Fact]
    public void Request_serializes_snake_case_wire_shape()
    {
        var request = AiTripPlanRequest.Build(new AiTripPlannerInputs(
            VehicleId: "7",
            Origin: new TripLocation(1.5, 2.5, "A"),
            Destination: new TripLocation(3.5, 4.5, "B")));

        string json = JsonSerializer.Serialize(request);
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        // GetProperty throws when a snake_case key is missing, so this asserts the web wire names bit-for-bit.
        Assert.Equal(7, root.GetProperty("vehicle_id").GetInt64());
        Assert.Equal(80, root.GetProperty("current_soc").GetDouble());
        Assert.Equal(90, root.GetProperty("charge_limit_soc").GetDouble());
        Assert.Equal(20, root.GetProperty("min_arrival_soc").GetDouble());
        Assert.Equal(1.0, root.GetProperty("speed_factor").GetDouble());

        var origin = root.GetProperty("origin");
        Assert.Equal(1.5, origin.GetProperty("lat").GetDouble());
        Assert.Equal(2.5, origin.GetProperty("lng").GetDouble());
        Assert.Equal("A", origin.GetProperty("name").GetString());
        Assert.Equal("B", root.GetProperty("destination").GetProperty("name").GetString());
    }

    // ── projection: InnerSection + AIFeatureCard copy (web/src/components/ai/AITripPlannerLLMAgent.tsx) ────

    [Fact]
    public void Projection_resolves_web_default_fallbacks()
    {
        var display = AITripPlannerLLMAgentProjection.Project(PassthroughLocalizer.Instance);

        Assert.Equal("Draft a plan with Helix", display.Title);
        Assert.Equal(AITripPlannerLLMAgentRegistration.DescriptionFallback, display.Description);
        Assert.Equal("Helix", display.BadgeLabel);
        Assert.Equal("Ask Helix", display.AskHelixLabel);
        Assert.Equal("Helix is thinking…", display.ThinkingLabel);
        Assert.Equal("Draft a plan", display.GenerateLabel);
        Assert.Equal("The plan couldn't be drafted. Try again.", display.ErrorMessage);
        Assert.Equal("Try again", display.RetryLabel);
    }

    [Fact]
    public void Projection_composes_button_accessible_name()
    {
        var display = AITripPlannerLLMAgentProjection.Project(PassthroughLocalizer.Instance);

        // web AIFeatureCard: aria-label = `${askHelixLabel} · ${buttonLabel}`.
        Assert.Equal("Ask Helix · Draft a plan", display.ButtonAutomationName);
        Assert.Contains(display.AskHelixLabel, display.ButtonAutomationName, StringComparison.Ordinal);
        Assert.Contains(display.GenerateLabel, display.ButtonAutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Projection_consults_every_catalog_key()
    {
        var localizer = new MapLocalizer(new Dictionary<string, string>(StringComparer.Ordinal)
        {
            [AITripPlannerLLMAgentRegistration.TitleKey] = "T",
            [AITripPlannerLLMAgentRegistration.DescriptionKey] = "D",
            [AITripPlannerLLMAgentRegistration.BadgeKey] = "B",
            [AITripPlannerLLMAgentRegistration.AskHelixKey] = "A",
            [AITripPlannerLLMAgentRegistration.ThinkingKey] = "K",
            [AITripPlannerLLMAgentRegistration.GenerateButtonKey] = "G",
            [AITripPlannerLLMAgentRegistration.ErrorKey] = "E",
            [AITripPlannerLLMAgentRegistration.RetryKey] = "R",
        });

        var display = AITripPlannerLLMAgentProjection.Project(localizer);

        Assert.Equal("T", display.Title);
        Assert.Equal("D", display.Description);
        Assert.Equal("B", display.BadgeLabel);
        Assert.Equal("A", display.AskHelixLabel);
        Assert.Equal("K", display.ThinkingLabel);
        Assert.Equal("G", display.GenerateLabel);
        Assert.Equal("E", display.ErrorMessage);
        Assert.Equal("R", display.RetryLabel);
        Assert.Equal("A · G", display.ButtonAutomationName);
    }

    // ── gate: withAiFeature / useAiEnabled (web/src/components/ai/withAiFeature.tsx) ──────────────────────

    [Fact]
    public void Gate_open_when_feature_enabled()
    {
        var vm = NewViewModel(gate: new DelegateAiFeatureGate(id => id == AITripPlannerLLMAgentRegistration.FeatureId));
        Assert.True(vm.IsGateOpen);
    }

    [Fact]
    public void Gate_closed_when_feature_disabled()
    {
        var vm = NewViewModel(gate: DelegateAiFeatureGate.Disabled);
        Assert.False(vm.IsGateOpen);
    }

    // ── canStart: web `canStart = !!vehicleId && origin != null && destination != null` ──────────────────

    [Fact]
    public void CanStart_true_with_vehicle_origin_and_destination()
    {
        var vm = NewViewModel(inputs: ValidInputs());

        Assert.True(vm.CanStart);
        Assert.True(vm.ButtonEnabled);
    }

    [Fact]
    public void CanStart_false_without_vehicle_id()
    {
        var vm = NewViewModel(inputs: ValidInputs() with { VehicleId = null });

        Assert.False(vm.CanStart);
        Assert.False(vm.ButtonEnabled);
        Assert.Equal("Ask Helix", vm.ButtonText);
    }

    [Fact]
    public void CanStart_false_without_origin()
    {
        var vm = NewViewModel(inputs: ValidInputs() with { Origin = null });

        Assert.False(vm.CanStart);
        Assert.False(vm.ButtonEnabled);
    }

    [Fact]
    public void CanStart_false_without_destination()
    {
        var vm = NewViewModel(inputs: ValidInputs() with { Destination = null });

        Assert.False(vm.CanStart);
        Assert.False(vm.ButtonEnabled);
    }

    [Fact]
    public async Task Start_is_noop_without_inputs()
    {
        var transport = new ScriptedTransport(Delta("nope"), DoneFrame());
        var vm = NewViewModel(transport: transport, inputs: ValidInputs() with { Destination = null });

        vm.Start();

        Assert.Null(vm.PendingStream);
        Assert.Equal(AiTripPlanStreamState.Idle, vm.State);
        await Task.CompletedTask;
    }

    // ── stream lifecycle: useAiStream idle → streaming → done | error ────────────────────────────────────

    [Fact]
    public async Task Stream_accumulates_delta_text_then_completes_on_done()
    {
        var transport = new ScriptedTransport(Delta("Leg 1. "), Delta("Charge at A."), DoneFrame());
        var vm = NewViewModel(transport: transport);

        vm.Start();
        await vm.PendingStream!;

        Assert.Equal(AiTripPlanStreamState.Done, vm.State);
        Assert.Equal("Leg 1. Charge at A.", vm.Text);
        Assert.False(vm.IsStreaming);
        Assert.True(vm.ShowText);
        Assert.False(vm.ShowError);
    }

    [Fact]
    public async Task Stream_settles_done_when_connection_closes_without_terminal_frame()
    {
        var transport = new ScriptedTransport(Delta("partial"));
        var vm = NewViewModel(transport: transport);

        vm.Start();
        await vm.PendingStream!;

        // web: setState(cur => cur === 'streaming' ? 'done' : cur) on clean close.
        Assert.Equal(AiTripPlanStreamState.Done, vm.State);
        Assert.Equal("partial", vm.Text);
    }

    [Fact]
    public async Task Stream_reassembles_frames_split_across_chunks()
    {
        var transport = new ScriptedTransport(
            "event: delta\ndata: {\"text\":\"Dra",
            "ft\"}\n\nevent: done\ndata: {}\n\n");
        var vm = NewViewModel(transport: transport);

        vm.Start();
        await vm.PendingStream!;

        Assert.Equal(AiTripPlanStreamState.Done, vm.State);
        Assert.Equal("Draft", vm.Text);
    }

    [Fact]
    public async Task Stream_posts_the_built_request_body()
    {
        var transport = new CapturingTransport(DoneFrame());
        var inputs = new AiTripPlannerInputs(
            VehicleId: "42",
            Origin: new TripLocation(1, 2, "A"),
            Destination: new TripLocation(3, 4, "B"),
            CurrentSoc: 60);
        var vm = NewViewModel(transport: transport, inputs: inputs);

        vm.Start();
        await vm.PendingStream!;

        Assert.NotNull(transport.LastRequest);
        Assert.Equal(42, transport.LastRequest!.VehicleId);
        Assert.Equal(60, transport.LastRequest.CurrentSoc);
        Assert.Equal("A", transport.LastRequest.Origin.Name);
        Assert.Same(vm.Request, transport.LastRequest);
    }

    [Fact]
    public async Task Error_frame_sets_error_state_and_captures_limit()
    {
        var transport = new ScriptedTransport(
            "event: error\ndata: {\"message\":\"capped\",\"reason\":\"cost_cap\",\"retry_after_s\":60,\"banner_level\":\"critical\",\"baseline_available\":false}\n\n");
        var vm = NewViewModel(transport: transport);

        vm.Start();
        await vm.PendingStream!;

        Assert.Equal(AiTripPlanStreamState.Error, vm.State);
        Assert.Equal("capped", vm.Error);
        Assert.True(vm.ShowError);
        Assert.NotNull(vm.Limit);
        Assert.Equal("cost_cap", vm.Limit!.Reason);
        Assert.Equal(60, vm.Limit.RetryAfterS);
        Assert.Equal("critical", vm.Limit.BannerLevel);
        Assert.False(vm.Limit.BaselineAvailable);
    }

    [Fact]
    public async Task Plain_error_frame_sets_error_without_limit()
    {
        var transport = new ScriptedTransport("event: error\ndata: {\"message\":\"boom\"}\n\n");
        var vm = NewViewModel(transport: transport);

        vm.Start();
        await vm.PendingStream!;

        Assert.Equal(AiTripPlanStreamState.Error, vm.State);
        Assert.Equal("boom", vm.Error);
        Assert.Null(vm.Limit);
    }

    [Fact]
    public async Task Confirm_request_pauses_the_stream()
    {
        var transport = new ScriptedTransport(
            "event: confirm_request\ndata: {\"continuation_id\":\"c1\",\"tool\":\"t\",\"summary\":\"ok?\"}\n\n");
        var vm = NewViewModel(transport: transport);

        vm.Start();
        await vm.PendingStream!;

        // web: a confirm_request is NOT promoted to done on close; the surface holds the paused state.
        Assert.Equal(AiTripPlanStreamState.PausedConfirm, vm.State);
    }

    [Fact]
    public async Task Http_failure_surfaces_as_error_with_status_code()
    {
        var transport = new ThrowingTransport(new HttpRequestException("stream_http_404"));
        var vm = NewViewModel(transport: transport);

        vm.Start();
        await vm.PendingStream!;

        // web: a non-ok response yields error state with `stream_http_${status}` (off-mode 404 → baseline fallback).
        Assert.Equal(AiTripPlanStreamState.Error, vm.State);
        Assert.Equal("stream_http_404", vm.Error);
    }

    [Fact]
    public async Task Streaming_state_flips_button_label_and_disables_action()
    {
        var transport = new IdleBlockingTransport();
        var vm = NewViewModel(transport: transport);

        vm.Start();

        Assert.Equal(AiTripPlanStreamState.Streaming, vm.State);
        Assert.True(vm.IsStreaming);
        Assert.Equal("Helix is thinking…", vm.ButtonText);
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
        var vm = NewViewModel(transport: transport);

        vm.Start();
        Assert.Equal("primed", vm.Text);

        vm.Cancel();
        await vm.PendingStream!;

        // web AbortError path: a cancelled stream returns to idle (never error), keeping what already arrived.
        Assert.Equal(AiTripPlanStreamState.Idle, vm.State);
        Assert.Equal("primed", vm.Text);
    }

    [Fact]
    public async Task Restarting_resets_accumulated_text_and_error()
    {
        var failing = new ThrowingTransport(new HttpRequestException("stream_http_500"));
        var vm = NewViewModel(transport: failing);
        vm.Start();
        await vm.PendingStream!;
        Assert.Equal(AiTripPlanStreamState.Error, vm.State);

        // A re-press clears the prior error/text before re-opening; here the holder is reused with a fresh script.
        var vm2 = NewViewModel(transport: new ScriptedTransport(Delta("fresh"), DoneFrame()));
        vm2.Start();
        await vm2.PendingStream!;
        Assert.Equal(AiTripPlanStreamState.Done, vm2.State);
        Assert.Equal("fresh", vm2.Text);
        Assert.Null(vm2.Error);
    }

    // ── diagnostics: view.opened slug=AITripPlannerLLMAgent (P1/S11) ─────────────────────────────────────

    [Fact]
    public void Diagnostics_emit_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new AITripPlannerLLMAgentDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=AITripPlannerLLMAgent", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_never_leak_trip_content()
    {
        var lines = new List<string>();
        var diagnostics = new AITripPlannerLLMAgentDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        // Only the operational slug is recorded — never coordinates, vehicle id or the drafted plan text.
        Assert.DoesNotContain(lines, line => line.Contains("lat", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(lines, line => line.Contains("vehicle_id", StringComparison.OrdinalIgnoreCase));
    }

    // ── helpers ──────────────────────────────────────────────────────────────────────────────────────────

    private static AiTripPlannerInputs ValidInputs() => new(
        VehicleId: "7",
        Origin: new TripLocation(37.7, -122.4, "Origin"),
        Destination: new TripLocation(34.0, -118.2, "Destination"));

    private static AiTripPlannerLLMAgentViewModel NewViewModel(
        IAiTripPlannerTransport? transport = null,
        IAiFeatureGate? gate = null,
        AiTripPlannerInputs? inputs = null) =>
        new(
            transport ?? new ScriptedTransport(),
            gate ?? new DelegateAiFeatureGate(id => id == AITripPlannerLLMAgentRegistration.FeatureId),
            PassthroughLocalizer.Instance,
            inputs ?? ValidInputs());

    private static string Delta(string text) =>
        $"event: delta\ndata: {{\"text\":{JsonSerializer.Serialize(text)}}}\n\n";

    private static string DoneFrame() => "event: done\ndata: {}\n\n";

    private sealed class MapLocalizer : ILocalizer
    {
        private readonly IReadOnlyDictionary<string, string> _map;

        public MapLocalizer(IReadOnlyDictionary<string, string> map) => _map = map;

        public string GetString(string key, string fallback) =>
            _map.TryGetValue(key, out var value) ? value : fallback;
    }

    private sealed class ScriptedTransport : IAiTripPlannerTransport
    {
        private readonly string[] _chunks;

        public ScriptedTransport(params string[] chunks) => _chunks = chunks;

        public async IAsyncEnumerable<string> OpenAsync(
            AiTripPlanRequest request,
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

    private sealed class CapturingTransport : IAiTripPlannerTransport
    {
        private readonly string[] _chunks;

        public CapturingTransport(params string[] chunks) => _chunks = chunks;

        public AiTripPlanRequest? LastRequest { get; private set; }

        public async IAsyncEnumerable<string> OpenAsync(
            AiTripPlanRequest request,
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

    private sealed class ThrowingTransport : IAiTripPlannerTransport
    {
        private readonly Exception _error;

        public ThrowingTransport(Exception error) => _error = error;

        public async IAsyncEnumerable<string> OpenAsync(
            AiTripPlanRequest request,
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

    private sealed class IdleBlockingTransport : IAiTripPlannerTransport
    {
        public async IAsyncEnumerable<string> OpenAsync(
            AiTripPlanRequest request,
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            await Task.Delay(Timeout.Infinite, cancellationToken);
            yield break;
        }
    }

    private sealed class PrimedBlockingTransport : IAiTripPlannerTransport
    {
        public async IAsyncEnumerable<string> OpenAsync(
            AiTripPlanRequest request,
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            yield return "event: delta\ndata: {\"text\":\"primed\"}\n\n";
            await Task.Delay(Timeout.Infinite, cancellationToken);
        }
    }
}
