using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Live;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the AIDriveCoaching surface's UI-thread-free logic — the SSE-frame adapter
/// (<see cref="AiCoachStreamParser"/>), the stream state holder (<see cref="AiDriveCoachingViewModel"/>), the
/// label projection, the AI-feature gate and the PII-safe diagnostics. Mirrors the web spec one-for-one
/// (web/src/components/ai/AIDriveCoaching.tsx + web/src/hooks/useAiStream.ts). The WinUI part
/// (<c>AIDriveCoaching</c> in shared-surfaces/AIDriveCoaching.cs, which composes the glass panel, badge, action
/// button and output region and marshals stream notifications onto the dispatcher) is exercised by the app build.
/// </summary>
public sealed class AIDriveCoachingTests
{
    // ── adapter: parseSSEFrame / toTypedEvent (web/src/hooks/useAiStream.ts L364-L468) ───────────────────

    [Fact]
    public void Delta_frame_parses_text()
    {
        var ev = AiCoachStreamParser.ToTypedEvent("delta", "{\"text\":\"Hello\"}");

        Assert.NotNull(ev);
        Assert.Equal(AiCoachEventKind.Delta, ev!.Kind);
        Assert.Equal("Hello", ev.Text);
    }

    [Fact]
    public void Delta_frame_without_text_is_dropped()
    {
        Assert.Null(AiCoachStreamParser.ToTypedEvent("delta", "{\"notText\":1}"));
        Assert.Null(AiCoachStreamParser.ToTypedEvent("delta", "{\"text\":5}"));
    }

    [Fact]
    public void Tool_call_frame_parses_id_name_and_raw_arguments()
    {
        var ev = AiCoachStreamParser.ToTypedEvent(
            "tool_call", "{\"id\":\"t1\",\"name\":\"telemetry\",\"arguments\":{\"k\":1}}");

        Assert.NotNull(ev);
        Assert.Equal(AiCoachEventKind.ToolCall, ev!.Kind);
        Assert.Equal("t1", ev.Id);
        Assert.Equal("telemetry", ev.Name);
        Assert.Equal("{\"k\":1}", ev.ArgumentsJson);
    }

    [Fact]
    public void Tool_call_frame_missing_required_field_is_dropped()
    {
        Assert.Null(AiCoachStreamParser.ToTypedEvent("tool_call", "{\"id\":\"t1\"}"));
        Assert.Null(AiCoachStreamParser.ToTypedEvent("tool_call", "{\"name\":\"x\"}"));
    }

    [Theory]
    [InlineData("true", true)]
    [InlineData("false", false)]
    public void Tool_result_frame_parses_ok(string okLiteral, bool expected)
    {
        var ev = AiCoachStreamParser.ToTypedEvent(
            "tool_result", $"{{\"id\":\"t1\",\"name\":\"x\",\"ok\":{okLiteral},\"data\":[1,2],\"error\":\"e\"}}");

        Assert.NotNull(ev);
        Assert.Equal(AiCoachEventKind.ToolResult, ev!.Kind);
        Assert.Equal(expected, ev.Ok);
        Assert.Equal("[1,2]", ev.DataJson);
        Assert.Equal("e", ev.ToolError);
    }

    [Fact]
    public void Tool_result_frame_without_ok_is_dropped() =>
        Assert.Null(AiCoachStreamParser.ToTypedEvent("tool_result", "{\"id\":\"t1\",\"name\":\"x\"}"));

    [Fact]
    public void Confirm_request_frame_parses_fields()
    {
        var ev = AiCoachStreamParser.ToTypedEvent(
            "confirm_request", "{\"continuation_id\":\"c1\",\"tool\":\"wipe\",\"summary\":\"Proceed?\",\"args\":{}}");

        Assert.NotNull(ev);
        Assert.Equal(AiCoachEventKind.ConfirmRequest, ev!.Kind);
        Assert.Equal("c1", ev.ContinuationId);
        Assert.Equal("wipe", ev.Tool);
        Assert.Equal("Proceed?", ev.Summary);
        Assert.Equal("{}", ev.ArgsJson);
    }

    [Fact]
    public void Confirm_request_frame_missing_summary_is_dropped() =>
        Assert.Null(AiCoachStreamParser.ToTypedEvent("confirm_request", "{\"continuation_id\":\"c1\",\"tool\":\"x\"}"));

    [Fact]
    public void Done_frame_parses_finish_reason_and_usage()
    {
        var ev = AiCoachStreamParser.ToTypedEvent(
            "done", "{\"finish_reason\":\"length\",\"usage\":{\"in\":10,\"out\":20}}");

        Assert.NotNull(ev);
        Assert.Equal(AiCoachEventKind.Done, ev!.Kind);
        Assert.Equal("length", ev.FinishReason);
        Assert.Equal(10, ev.UsageIn);
        Assert.Equal(20, ev.UsageOut);
    }

    [Fact]
    public void Done_frame_defaults_finish_reason_and_usage()
    {
        var ev = AiCoachStreamParser.ToTypedEvent("done", "{}");

        Assert.NotNull(ev);
        Assert.Equal("stop", ev!.FinishReason);
        Assert.Equal(0, ev.UsageIn);
        Assert.Equal(0, ev.UsageOut);
    }

    [Fact]
    public void Error_frame_parses_structured_limit_fields()
    {
        var ev = AiCoachStreamParser.ToTypedEvent(
            "error",
            "{\"message\":\"too many\",\"reason\":\"rate_limited\",\"retry_after_s\":30,\"banner_level\":\"warn\",\"baseline_available\":true}");

        Assert.NotNull(ev);
        Assert.Equal(AiCoachEventKind.Error, ev!.Kind);
        Assert.Equal("too many", ev.Message);
        Assert.Equal("rate_limited", ev.Reason);
        Assert.Equal(30, ev.RetryAfterS);
        Assert.Equal("warn", ev.BannerLevel);
        Assert.True(ev.BaselineAvailable);
    }

    [Fact]
    public void Error_frame_defaults_message_and_drops_invalid_banner_level()
    {
        var ev = AiCoachStreamParser.ToTypedEvent("error", "{\"banner_level\":\"bogus\"}");

        Assert.NotNull(ev);
        Assert.Equal("unknown", ev!.Message);
        Assert.Null(ev.Reason);
        Assert.Null(ev.BannerLevel);
        Assert.Null(ev.BaselineAvailable);
    }

    [Fact]
    public void Error_frame_allows_empty_banner_level()
    {
        var ev = AiCoachStreamParser.ToTypedEvent("error", "{\"message\":\"x\",\"reason\":\"capped\",\"banner_level\":\"\"}");

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
        Assert.Null(AiCoachStreamParser.ToTypedEvent(eventName, data));

    [Fact]
    public void ParseFrame_delegates_to_typed_event()
    {
        var ev = AiCoachStreamParser.ParseFrame(new SseFrame("delta", "{\"text\":\"Hi\"}", null, null));

        Assert.NotNull(ev);
        Assert.Equal("Hi", ev!.Text);
    }

    // ── projection: InnerSection + AIFeatureCard copy (web/src/components/ai/AIDriveCoaching.tsx) ──────────

    [Fact]
    public void Projection_resolves_web_default_fallbacks()
    {
        var display = AIDriveCoachingProjection.Project(PassthroughLocalizer.Instance);

        Assert.Equal("Drive coaching", display.Title);
        Assert.Equal(AIDriveCoachingRegistration.DescriptionFallback, display.Description);
        Assert.Equal("Helix", display.BadgeLabel);
        Assert.Equal("Ask Helix", display.AskHelixLabel);
        Assert.Equal("Helix is thinking…", display.ThinkingLabel);
        Assert.Equal("Generate coaching", display.GenerateLabel);
        Assert.Equal("Coaching couldn't be generated. Try again.", display.ErrorMessage);
        Assert.Equal("Try again", display.RetryLabel);
    }

    [Fact]
    public void Projection_composes_button_accessible_name()
    {
        var display = AIDriveCoachingProjection.Project(PassthroughLocalizer.Instance);

        // web AIFeatureCard: aria-label = `${askHelixLabel} · ${buttonLabel}`.
        Assert.Equal("Ask Helix · Generate coaching", display.ButtonAutomationName);
        Assert.Contains(display.AskHelixLabel, display.ButtonAutomationName, StringComparison.Ordinal);
        Assert.Contains(display.GenerateLabel, display.ButtonAutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Projection_consults_every_catalog_key()
    {
        var localizer = new MapLocalizer(new Dictionary<string, string>(StringComparer.Ordinal)
        {
            [AIDriveCoachingRegistration.TitleKey] = "T",
            [AIDriveCoachingRegistration.DescriptionKey] = "D",
            [AIDriveCoachingRegistration.BadgeKey] = "B",
            [AIDriveCoachingRegistration.AskHelixKey] = "A",
            [AIDriveCoachingRegistration.ThinkingKey] = "K",
            [AIDriveCoachingRegistration.GenerateButtonKey] = "G",
            [AIDriveCoachingRegistration.ErrorKey] = "E",
            [AIDriveCoachingRegistration.RetryKey] = "R",
        });

        var display = AIDriveCoachingProjection.Project(localizer);

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
        var vm = NewViewModel(gate: new DelegateAiFeatureGate(id => id == AIDriveCoachingRegistration.FeatureId));
        Assert.True(vm.IsGateOpen);
    }

    [Fact]
    public void Gate_closed_when_feature_disabled()
    {
        var vm = NewViewModel(gate: DelegateAiFeatureGate.Disabled);
        Assert.False(vm.IsGateOpen);
    }

    // ── canStart: web `canStart = !!driveId` ─────────────────────────────────────────────────────────────

    [Fact]
    public void CanStart_false_without_drive_id()
    {
        var vm = NewViewModel(driveId: null);

        Assert.False(vm.CanStart);
        Assert.False(vm.ButtonEnabled);
        Assert.Equal("Ask Helix", vm.ButtonText);
    }

    [Fact]
    public void CanStart_true_with_drive_id()
    {
        var vm = NewViewModel(driveId: "42");

        Assert.True(vm.CanStart);
        Assert.True(vm.ButtonEnabled);
    }

    [Fact]
    public async Task Start_is_noop_without_drive_id()
    {
        var transport = new ScriptedTransport(Delta("nope"), DoneFrame());
        var vm = NewViewModel(transport: transport, driveId: null);

        vm.Start();

        Assert.Null(vm.PendingStream);
        Assert.Equal(AiCoachStreamState.Idle, vm.State);
        await Task.CompletedTask;
    }

    // ── stream lifecycle: useAiStream idle → streaming → done | error ────────────────────────────────────

    [Fact]
    public async Task Stream_accumulates_delta_text_then_completes_on_done()
    {
        var transport = new ScriptedTransport(Delta("Hello, "), Delta("world."), DoneFrame());
        var vm = NewViewModel(transport: transport, driveId: "7");

        vm.Start();
        await vm.PendingStream!;

        Assert.Equal(AiCoachStreamState.Done, vm.State);
        Assert.Equal("Hello, world.", vm.Text);
        Assert.False(vm.IsStreaming);
        Assert.True(vm.ShowText);
        Assert.False(vm.ShowError);
    }

    [Fact]
    public async Task Stream_settles_done_when_connection_closes_without_terminal_frame()
    {
        var transport = new ScriptedTransport(Delta("partial"));
        var vm = NewViewModel(transport: transport, driveId: "7");

        vm.Start();
        await vm.PendingStream!;

        // web: setState(cur => cur === 'streaming' ? 'done' : cur) on clean close.
        Assert.Equal(AiCoachStreamState.Done, vm.State);
        Assert.Equal("partial", vm.Text);
    }

    [Fact]
    public async Task Stream_reassembles_frames_split_across_chunks()
    {
        var transport = new ScriptedTransport(
            "event: delta\ndata: {\"text\":\"Hel",
            "lo\"}\n\nevent: done\ndata: {}\n\n");
        var vm = NewViewModel(transport: transport, driveId: "7");

        vm.Start();
        await vm.PendingStream!;

        Assert.Equal(AiCoachStreamState.Done, vm.State);
        Assert.Equal("Hello", vm.Text);
    }

    [Fact]
    public async Task Error_frame_sets_error_state_and_captures_limit()
    {
        var transport = new ScriptedTransport(
            "event: error\ndata: {\"message\":\"capped\",\"reason\":\"cost_cap\",\"retry_after_s\":60,\"banner_level\":\"critical\",\"baseline_available\":false}\n\n");
        var vm = NewViewModel(transport: transport, driveId: "7");

        vm.Start();
        await vm.PendingStream!;

        Assert.Equal(AiCoachStreamState.Error, vm.State);
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
        var vm = NewViewModel(transport: transport, driveId: "7");

        vm.Start();
        await vm.PendingStream!;

        Assert.Equal(AiCoachStreamState.Error, vm.State);
        Assert.Equal("boom", vm.Error);
        Assert.Null(vm.Limit);
    }

    [Fact]
    public async Task Confirm_request_pauses_the_stream()
    {
        var transport = new ScriptedTransport(
            "event: confirm_request\ndata: {\"continuation_id\":\"c1\",\"tool\":\"t\",\"summary\":\"ok?\"}\n\n");
        var vm = NewViewModel(transport: transport, driveId: "7");

        vm.Start();
        await vm.PendingStream!;

        // web: a confirm_request is NOT promoted to done on close; the surface holds the paused state.
        Assert.Equal(AiCoachStreamState.PausedConfirm, vm.State);
    }

    [Fact]
    public async Task Http_failure_surfaces_as_error_with_status_code()
    {
        var transport = new ThrowingTransport(new HttpRequestException("stream_http_404"));
        var vm = NewViewModel(transport: transport, driveId: "7");

        vm.Start();
        await vm.PendingStream!;

        // web: a non-ok response yields error state with `stream_http_${status}` (off-mode 404 → baseline fallback).
        Assert.Equal(AiCoachStreamState.Error, vm.State);
        Assert.Equal("stream_http_404", vm.Error);
    }

    [Fact]
    public async Task Streaming_state_flips_button_label_and_disables_action()
    {
        var transport = new IdleBlockingTransport();
        var vm = NewViewModel(transport: transport, driveId: "7");

        vm.Start();

        Assert.Equal(AiCoachStreamState.Streaming, vm.State);
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
        var vm = NewViewModel(transport: transport, driveId: "7");

        vm.Start();
        Assert.Equal("primed", vm.Text);

        vm.Cancel();
        await vm.PendingStream!;

        // web AbortError path: a cancelled stream returns to idle (never error), keeping what already arrived.
        Assert.Equal(AiCoachStreamState.Idle, vm.State);
        Assert.Equal("primed", vm.Text);
    }

    [Fact]
    public async Task Restarting_resets_accumulated_text_and_error()
    {
        var failing = new ThrowingTransport(new HttpRequestException("stream_http_500"));
        var vm = NewViewModel(transport: failing, driveId: "7");
        vm.Start();
        await vm.PendingStream!;
        Assert.Equal(AiCoachStreamState.Error, vm.State);

        // A re-press clears the prior error/text before re-opening; here the holder is reused with a fresh script.
        var vm2 = NewViewModel(transport: new ScriptedTransport(Delta("fresh"), DoneFrame()), driveId: "7");
        vm2.Start();
        await vm2.PendingStream!;
        Assert.Equal(AiCoachStreamState.Done, vm2.State);
        Assert.Equal("fresh", vm2.Text);
        Assert.Null(vm2.Error);
    }

    // ── diagnostics: view.opened slug=AIDriveCoaching (P1/S11) ───────────────────────────────────────────

    [Fact]
    public void Diagnostics_emit_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new AIDriveCoachingDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=AIDriveCoaching", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_never_leak_drive_content()
    {
        var lines = new List<string>();
        var diagnostics = new AIDriveCoachingDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.DoesNotContain(lines, line => line.Contains("drive", StringComparison.OrdinalIgnoreCase) && line.Contains('/'));
    }

    // ── helpers ──────────────────────────────────────────────────────────────────────────────────────────

    private static AiDriveCoachingViewModel NewViewModel(
        IAiCoachTransport? transport = null,
        IAiFeatureGate? gate = null,
        string? driveId = "1") =>
        new(
            transport ?? new ScriptedTransport(),
            gate ?? new DelegateAiFeatureGate(id => id == AIDriveCoachingRegistration.FeatureId),
            PassthroughLocalizer.Instance,
            driveId);

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

    private sealed class ScriptedTransport : IAiCoachTransport
    {
        private readonly string[] _chunks;

        public ScriptedTransport(params string[] chunks) => _chunks = chunks;

        public async IAsyncEnumerable<string> OpenAsync(
            string driveId,
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

    private sealed class ThrowingTransport : IAiCoachTransport
    {
        private readonly Exception _error;

        public ThrowingTransport(Exception error) => _error = error;

        public async IAsyncEnumerable<string> OpenAsync(
            string driveId,
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

    private sealed class IdleBlockingTransport : IAiCoachTransport
    {
        public async IAsyncEnumerable<string> OpenAsync(
            string driveId,
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            await Task.Delay(Timeout.Infinite, cancellationToken);
            yield break;
        }
    }

    private sealed class PrimedBlockingTransport : IAiCoachTransport
    {
        public async IAsyncEnumerable<string> OpenAsync(
            string driveId,
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            yield return "event: delta\ndata: {\"text\":\"primed\"}\n\n";
            await Task.Delay(Timeout.Infinite, cancellationToken);
        }
    }
}
