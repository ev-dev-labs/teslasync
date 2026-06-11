using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Settings;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the signal-explorer natural-language filter surface's UI-thread-free logic — the SSE
/// frame parser (the native port of useAiStream's parseSSEFrame/toTypedEvent, including the tool_result data
/// capture), the typed draft-envelope narrowing (the port of parseSignalFilterDraft, including the status==='ok'
/// gate and the signals.every(string) all-or-nothing check), the registration metadata + AI feature-registry
/// membership, the PII-safe diagnostics, and the view-model's gate / canStart / stream lifecycle state machine
/// (idle → streaming → done / error, duplicate-start no-op, cancel → idle, offline classification, draft capture,
/// the vehicle-scope gate and the propose-only apply handoff). Mirrors the web spec
/// (web/src/components/ai/AISignalExplorerNlFilter.tsx + AIFeatureCard.tsx + useAiStream.ts). The WinUI view
/// (shared-surfaces/AISignalExplorerNlFilter.cs) is exercised by the app build.
/// </summary>
public sealed class AISignalExplorerNlFilterTests
{
    private const string ValidDraftJson =
        "{\"status\":\"ok\",\"draft\":{\"vehicle_id\":7," +
        "\"signals\":[\"VehicleSpeed\",\"BatteryLevel\"]," +
        "\"range_preset\":\"yesterday\",\"per_page\":100}}";

    private const string RejectedDraftJson =
        "{\"status\":\"invalid\",\"draft\":{\"vehicle_id\":7," +
        "\"signals\":[\"VehicleSpeed\"],\"range_preset\":\"yesterday\",\"per_page\":100}}";

    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // ── registration + registry membership ───────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("AISignalExplorerNlFilter", AISignalExplorerNlFilterRegistration.Slug);

    [Fact]
    public void Feature_id_is_present_in_the_canonical_registry()
    {
        Assert.True(AISignalExplorerNlFilterRegistration.IsRegisteredFeature(AISignalExplorerNlFilterRegistration.FeatureId));
        Assert.Contains(AiFeatureRegistry.Features, m => m.Id == AISignalExplorerNlFilterRegistration.FeatureId);
    }

    [Fact]
    public void Unknown_feature_id_is_not_registered() =>
        Assert.False(AISignalExplorerNlFilterRegistration.IsRegisteredFeature("not-a-real-feature"));

    [Fact]
    public void Draft_path_is_the_web_endpoint_without_the_version_prefix() =>
        Assert.Equal("/ai/signals/filter/draft", AISignalExplorerNlFilterRegistration.DraftPath);

    [Fact]
    public void Draft_tool_name_matches_the_backend_tool() =>
        Assert.Equal("draft_signal_filter", AISignalExplorerNlFilterRegistration.DraftToolName);

    [Fact]
    public void Root_automation_id_matches_the_web_off_mode_test_id() =>
        Assert.Equal("ai-feature-signal-explorer-nl-filter-root", AISignalExplorerNlFilterRegistration.RootAutomationId);

    // ── diagnostics: view.opened, PII-safe ───────────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new AISignalExplorerNlFilterDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=AISignalExplorerNlFilter", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_without_a_sink_still_count_opens()
    {
        var diagnostics = new AISignalExplorerNlFilterDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    // ── SSE parser (web parseSSEFrame / toTypedEvent) ────────────────────────────────────────────────────

    [Fact]
    public void Parser_reads_a_delta_frame()
    {
        var ev = AiSignalFilterDraftSseParser.ParseFrame("event: delta\ndata: {\"text\":\"Drafting \"}");

        Assert.NotNull(ev);
        Assert.Equal(AiSignalFilterDraftEventKind.Delta, ev!.Kind);
        Assert.Equal("Drafting ", ev.Text);
    }

    [Fact]
    public void Parser_reads_a_done_frame()
    {
        var ev = AiSignalFilterDraftSseParser.ParseFrame("event: done\ndata: {\"finish_reason\":\"stop\",\"usage\":{\"in\":1,\"out\":2}}");

        Assert.NotNull(ev);
        Assert.Equal(AiSignalFilterDraftEventKind.Done, ev!.Kind);
    }

    [Fact]
    public void Parser_reads_an_error_frame_with_its_message()
    {
        var ev = AiSignalFilterDraftSseParser.ParseFrame("event: error\ndata: {\"message\":\"rate_limited\"}");

        Assert.NotNull(ev);
        Assert.Equal(AiSignalFilterDraftEventKind.Error, ev!.Kind);
        Assert.Equal("rate_limited", ev.Message);
        Assert.Equal(AiSignalFilterDraftErrorReason.Stream, ev.ErrorReason);
    }

    [Fact]
    public void Parser_defaults_an_error_message_to_unknown_when_absent()
    {
        var ev = AiSignalFilterDraftSseParser.ParseFrame("event: error\ndata: {\"reason\":\"cost_cap\"}");

        Assert.NotNull(ev);
        Assert.Equal(AiSignalFilterDraftEventKind.Error, ev!.Kind);
        Assert.Equal("unknown", ev.Message);
    }

    [Fact]
    public void Parser_reads_a_tool_call_frame_and_ignores_its_payload()
    {
        var call = AiSignalFilterDraftSseParser.ParseFrame("event: tool_call\ndata: {\"id\":\"1\",\"name\":\"draft_signal_filter\"}");

        Assert.NotNull(call);
        Assert.Equal(AiSignalFilterDraftEventKind.ToolCall, call!.Kind);
    }

    [Fact]
    public void Parser_reads_a_tool_result_frame_and_captures_its_data_payload()
    {
        var ev = AiSignalFilterDraftSseParser.ParseFrame(
            "event: tool_result\ndata: {\"id\":\"1\",\"name\":\"draft_signal_filter\",\"ok\":true,\"data\":" +
            ValidDraftJson + "}");

        Assert.NotNull(ev);
        Assert.Equal(AiSignalFilterDraftEventKind.ToolResult, ev!.Kind);
        Assert.Equal("draft_signal_filter", ev.ToolName);
        Assert.True(ev.ToolOk);
        Assert.NotNull(ev.ToolData);
        Assert.True(ev.ToolData!.Value.TryGetProperty("status", out _));
    }

    [Fact]
    public void Parser_reads_a_failed_tool_result_with_no_data()
    {
        var ev = AiSignalFilterDraftSseParser.ParseFrame(
            "event: tool_result\ndata: {\"id\":\"1\",\"name\":\"draft_signal_filter\",\"ok\":false}");

        Assert.NotNull(ev);
        Assert.Equal(AiSignalFilterDraftEventKind.ToolResult, ev!.Kind);
        Assert.False(ev.ToolOk);
        Assert.Null(ev.ToolData);
    }

    [Fact]
    public void Parser_reads_a_confirm_request_frame()
    {
        var ev = AiSignalFilterDraftSseParser.ParseFrame(
            "event: confirm_request\ndata: {\"continuation_id\":\"c\",\"tool\":\"t\",\"summary\":\"s\"}");

        Assert.NotNull(ev);
        Assert.Equal(AiSignalFilterDraftEventKind.ConfirmRequest, ev!.Kind);
    }

    [Fact]
    public void Parser_ignores_comment_lines()
    {
        var ev = AiSignalFilterDraftSseParser.ParseFrame(": keep-alive\nevent: delta\ndata: {\"text\":\"x\"}");

        Assert.NotNull(ev);
        Assert.Equal("x", ev!.Text);
    }

    [Theory]
    [InlineData("event: delta\ndata: not-json")]
    [InlineData("data: {\"text\":\"x\"}")] // no event line
    [InlineData("event: mystery\ndata: {\"text\":\"x\"}")] // unknown event type
    [InlineData("event: delta\ndata: {\"text\":123}")] // text not a string
    [InlineData("event: tool_call\ndata: {\"id\":\"1\"}")] // missing required name
    [InlineData("event: tool_result\ndata: {\"id\":\"1\",\"name\":\"x\"}")] // missing required ok
    public void Parser_returns_null_for_malformed_or_unknown_frames(string frame) =>
        Assert.Null(AiSignalFilterDraftSseParser.ParseFrame(frame));

    [Fact]
    public void Parser_supports_no_space_after_field_name()
    {
        var ev = AiSignalFilterDraftSseParser.ParseFrame("event:delta\ndata:{\"text\":\"y\"}");

        Assert.NotNull(ev);
        Assert.Equal("y", ev!.Text);
    }

    // ── draft envelope narrowing (web parseSignalFilterDraft) ────────────────────────────────────────────

    [Fact]
    public void Draft_parse_accepts_a_well_formed_ok_envelope()
    {
        Assert.True(SignalFilterDraft.TryParse(Element(ValidDraftJson), out var draft));

        Assert.NotNull(draft);
        Assert.Equal(7, draft!.VehicleId);
        Assert.Equal(new[] { "VehicleSpeed", "BatteryLevel" }, draft.Signals);
        Assert.Equal("yesterday", draft.RangePreset);
        Assert.Equal(100, draft.PerPage);
    }

    [Fact]
    public void Draft_parse_rejects_a_non_ok_envelope()
    {
        // web parseSignalFilterDraft: obj.status !== 'ok' → return null (no draft, no apply action).
        Assert.False(SignalFilterDraft.TryParse(Element(RejectedDraftJson), out var draft));
        Assert.Null(draft);
    }

    [Fact]
    public void Draft_parse_rejects_when_any_signal_is_not_a_string()
    {
        // web: d.signals.every((s) => typeof s === 'string') — a single non-string element rejects the whole
        // draft (it is NOT filtered out, unlike the Grafana targets list).
        const string json =
            "{\"status\":\"ok\",\"draft\":{\"vehicle_id\":7,\"signals\":[\"VehicleSpeed\",123]," +
            "\"range_preset\":\"yesterday\",\"per_page\":100}}";

        Assert.False(SignalFilterDraft.TryParse(Element(json), out var draft));
        Assert.Null(draft);
    }

    [Fact]
    public void Draft_parse_accepts_an_empty_signals_array()
    {
        // web: Array.isArray([]) is true and [].every(...) is true, so an empty signals list parses (the
        // min=1 length bound is enforced server-side at tool-input validation, not in parseSignalFilterDraft).
        const string json =
            "{\"status\":\"ok\",\"draft\":{\"vehicle_id\":3,\"signals\":[]," +
            "\"range_preset\":\"all\",\"per_page\":25}}";

        Assert.True(SignalFilterDraft.TryParse(Element(json), out var draft));
        Assert.NotNull(draft);
        Assert.Empty(draft!.Signals);
        Assert.Equal(3, draft.VehicleId);
        Assert.Equal("all", draft.RangePreset);
        Assert.Equal(25, draft.PerPage);
    }

    [Theory]
    [InlineData("{\"draft\":{\"vehicle_id\":7,\"signals\":[\"S\"],\"range_preset\":\"all\",\"per_page\":25}}")] // no status
    [InlineData("{\"status\":\"ok\"}")] // no draft
    [InlineData("{\"status\":\"ok\",\"draft\":{\"signals\":[\"S\"],\"range_preset\":\"all\",\"per_page\":25}}")] // no vehicle_id
    [InlineData("{\"status\":\"ok\",\"draft\":{\"vehicle_id\":\"7\",\"signals\":[\"S\"],\"range_preset\":\"all\",\"per_page\":25}}")] // vehicle_id not a number
    [InlineData("{\"status\":\"ok\",\"draft\":{\"vehicle_id\":7,\"range_preset\":\"all\",\"per_page\":25}}")] // no signals
    [InlineData("{\"status\":\"ok\",\"draft\":{\"vehicle_id\":7,\"signals\":{\"a\":1},\"range_preset\":\"all\",\"per_page\":25}}")] // signals not an array
    [InlineData("{\"status\":\"ok\",\"draft\":{\"vehicle_id\":7,\"signals\":[\"S\"],\"per_page\":25}}")] // no range_preset
    [InlineData("{\"status\":\"ok\",\"draft\":{\"vehicle_id\":7,\"signals\":[\"S\"],\"range_preset\":7,\"per_page\":25}}")] // range_preset not a string
    [InlineData("{\"status\":\"ok\",\"draft\":{\"vehicle_id\":7,\"signals\":[\"S\"],\"range_preset\":\"all\"}}")] // no per_page
    [InlineData("{\"status\":\"ok\",\"draft\":{\"vehicle_id\":7,\"signals\":[\"S\"],\"range_preset\":\"all\",\"per_page\":\"25\"}}")] // per_page not a number
    public void Draft_parse_rejects_a_malformed_envelope(string json)
    {
        Assert.False(SignalFilterDraft.TryParse(Element(json), out var draft));
        Assert.Null(draft);
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

    // ── view-model: initial state + canStart (web hasPrompt && hasVehicle) ───────────────────────────────

    [Fact]
    public void Initial_state_is_idle_with_no_output_and_no_draft()
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On);

        Assert.Equal(AiSignalFilterDraftStreamState.Idle, vm.State);
        Assert.Equal(string.Empty, vm.AssistantText);
        Assert.False(vm.HasOutput);
        Assert.False(vm.IsThinking);
        Assert.False(vm.IsError);
        Assert.False(vm.HasDraft);
        Assert.Equal(0, vm.DraftSignalCount);
        Assert.False(vm.CanStart);
    }

    [Theory]
    [InlineData("", false)]
    [InlineData("   ", false)]
    [InlineData("show me battery level for yesterday", true)]
    public void CanStart_requires_a_non_blank_prompt_when_a_vehicle_is_in_scope(string prompt, bool expected)
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On, vehicleId: 7);
        vm.Prompt = prompt;

        Assert.Equal(expected, vm.CanStart);
        Assert.Equal(expected, vm.IsActionEnabled);
    }

    [Fact]
    public void CanStart_is_false_without_a_resolved_vehicle_even_with_a_prompt()
    {
        // web hasVehicle = vehicleId > 0; a zero / negative id keeps the action disabled.
        using var vm = NewViewModel(StaticAiFeatureGate.On, vehicleId: 0);
        vm.Prompt = "show me battery level for yesterday";

        Assert.False(vm.CanStart);
        Assert.False(vm.IsActionEnabled);
    }

    [Fact]
    public void Resolving_the_vehicle_reevaluates_can_start()
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On, vehicleId: 0);
        vm.Prompt = "show me battery level for yesterday";
        Assert.False(vm.CanStart);

        vm.VehicleId = 12;

        Assert.True(vm.CanStart);
        Assert.True(vm.IsActionEnabled);
    }

    // ── view-model: stream lifecycle (web useAiStream) ───────────────────────────────────────────────────

    [Fact]
    public async Task Start_streams_deltas_into_text_then_completes_done()
    {
        var transport = new FakeSignalFilterDraftTransport(
            AiSignalFilterDraftStreamEvent.Delta("Proposing "),
            AiSignalFilterDraftStreamEvent.Delta("a filter."),
            AiSignalFilterDraftStreamEvent.Done());
        using var vm = Ready(transport);
        bool thinkingAtStreamStart = false;
        vm.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(vm.State) && vm.State == AiSignalFilterDraftStreamState.Streaming)
            {
                thinkingAtStreamStart = vm.IsThinking;
            }
        };

        await vm.StartAsync();

        Assert.Equal("Proposing a filter.", vm.AssistantText);
        Assert.Equal(AiSignalFilterDraftStreamState.Done, vm.State);
        Assert.True(thinkingAtStreamStart);
        Assert.False(vm.IsThinking);
        Assert.Equal(1, transport.OpenCount);
        Assert.Equal("show me battery level for yesterday", transport.LastRequest?.Prompt);
        Assert.Equal(7, transport.LastRequest?.VehicleId);
    }

    [Fact]
    public async Task Start_marks_done_when_the_stream_closes_without_a_terminal_event()
    {
        var transport = new FakeSignalFilterDraftTransport(AiSignalFilterDraftStreamEvent.Delta("partial"));
        using var vm = Ready(transport);

        await vm.StartAsync();

        Assert.Equal(AiSignalFilterDraftStreamState.Done, vm.State);
        Assert.Equal("partial", vm.AssistantText);
    }

    [Fact]
    public async Task Start_sends_the_scoped_vehicle_id_and_trimmed_prompt_in_the_request_body()
    {
        var transport = new FakeSignalFilterDraftTransport(AiSignalFilterDraftStreamEvent.Done());
        using var vm = NewViewModel(StaticAiFeatureGate.On, vehicleId: 42, transport);
        vm.Prompt = "   show me battery level for yesterday   ";

        await vm.StartAsync();

        Assert.Equal("show me battery level for yesterday", transport.LastRequest?.Prompt);
        Assert.Equal(42, transport.LastRequest?.VehicleId);
    }

    [Fact]
    public async Task Start_is_a_no_op_without_a_prompt()
    {
        var transport = new FakeSignalFilterDraftTransport(AiSignalFilterDraftStreamEvent.Done());
        using var vm = NewViewModel(StaticAiFeatureGate.On, vehicleId: 7, transport);

        await vm.StartAsync();

        Assert.Equal(AiSignalFilterDraftStreamState.Idle, vm.State);
        Assert.Equal(0, transport.OpenCount);
    }

    [Fact]
    public async Task Start_is_a_no_op_without_a_resolved_vehicle()
    {
        var transport = new FakeSignalFilterDraftTransport(AiSignalFilterDraftStreamEvent.Done());
        using var vm = NewViewModel(StaticAiFeatureGate.On, vehicleId: 0, transport);
        vm.Prompt = "show me battery level for yesterday";

        await vm.StartAsync();

        Assert.Equal(AiSignalFilterDraftStreamState.Idle, vm.State);
        Assert.Equal(0, transport.OpenCount);
    }

    [Fact]
    public async Task Start_is_a_no_op_when_the_gate_is_closed()
    {
        var transport = new FakeSignalFilterDraftTransport(AiSignalFilterDraftStreamEvent.Done());
        using var vm = NewViewModel(StaticAiFeatureGate.Off, vehicleId: 7, transport);
        vm.Prompt = "a prompt";

        await vm.StartAsync();

        Assert.Equal(AiSignalFilterDraftStreamState.Idle, vm.State);
        Assert.Equal(0, transport.OpenCount);
    }

    [Fact]
    public async Task Duplicate_start_while_streaming_is_a_no_op()
    {
        var transport = new FakeSignalFilterDraftTransport { HoldOpen = true };
        using var vm = Ready(transport);

        var first = vm.StartAsync();
        var second = vm.StartAsync();

        await second; // the second call returns immediately without opening a second stream.
        Assert.Equal(AiSignalFilterDraftStreamState.Streaming, vm.State);
        Assert.Equal(1, transport.OpenCount);

        vm.Cancel();
        await first;
    }

    // ── view-model: draft capture (web tool_result handler) ──────────────────────────────────────────────

    [Fact]
    public async Task Tool_result_with_an_accepted_envelope_is_captured_as_a_draft()
    {
        var transport = new FakeSignalFilterDraftTransport(
            DraftEvent(ValidDraftJson),
            AiSignalFilterDraftStreamEvent.Done());
        using var vm = Ready(transport);

        await vm.StartAsync();

        Assert.True(vm.HasDraft);
        Assert.NotNull(vm.Draft);
        Assert.Equal(7, vm.Draft!.VehicleId);
        Assert.Equal(2, vm.DraftSignalCount);
        Assert.True(vm.IsApplyEnabled);
    }

    [Fact]
    public async Task Tool_result_for_another_tool_is_ignored()
    {
        var transport = new FakeSignalFilterDraftTransport(
            DraftEvent(ValidDraftJson, name: "some_other_tool"),
            AiSignalFilterDraftStreamEvent.Done());
        using var vm = Ready(transport);

        await vm.StartAsync();

        Assert.False(vm.HasDraft);
    }

    [Fact]
    public async Task Tool_result_with_a_non_ok_envelope_is_not_captured()
    {
        var transport = new FakeSignalFilterDraftTransport(
            DraftEvent(RejectedDraftJson),
            AiSignalFilterDraftStreamEvent.Done());
        using var vm = Ready(transport);

        await vm.StartAsync();

        Assert.False(vm.HasDraft);
        Assert.False(vm.IsApplyEnabled);
    }

    [Fact]
    public async Task A_new_run_clears_the_prior_captured_draft()
    {
        var transport = new FakeSignalFilterDraftTransport(DraftEvent(ValidDraftJson), AiSignalFilterDraftStreamEvent.Done());
        using var vm = Ready(transport);
        await vm.StartAsync();
        Assert.True(vm.HasDraft);

        transport.Reset(AiSignalFilterDraftStreamEvent.Delta("no filter this time"), AiSignalFilterDraftStreamEvent.Done());
        await vm.StartAsync();

        Assert.False(vm.HasDraft);
    }

    // ── view-model: propose-only apply handoff (web handleApply) ─────────────────────────────────────────

    [Fact]
    public async Task Apply_hands_the_captured_draft_to_the_callback()
    {
        SignalFilterDraft? applied = null;
        var transport = new FakeSignalFilterDraftTransport(DraftEvent(ValidDraftJson), AiSignalFilterDraftStreamEvent.Done());
        using var vm = new AISignalExplorerNlFilterViewModel(transport, StaticAiFeatureGate.On, Localizer, vehicleId: 7, onApply: d => applied = d)
        {
            Prompt = "show me battery level for yesterday",
        };
        await vm.StartAsync();

        vm.Apply();

        Assert.NotNull(applied);
        Assert.Equal(7, applied!.VehicleId);
        Assert.Equal(new[] { "VehicleSpeed", "BatteryLevel" }, applied.Signals);
        Assert.Equal("yesterday", applied.RangePreset);
        Assert.Equal(100, applied.PerPage);
    }

    [Fact]
    public void Apply_is_a_no_op_when_no_draft_is_captured()
    {
        int calls = 0;
        var transport = new FakeSignalFilterDraftTransport();
        using var vm = new AISignalExplorerNlFilterViewModel(transport, StaticAiFeatureGate.On, Localizer, vehicleId: 7, onApply: _ => calls++);

        vm.Apply();

        Assert.Equal(0, calls);
    }

    [Fact]
    public async Task Apply_is_disabled_while_a_stream_is_in_flight()
    {
        var transport = new FakeSignalFilterDraftTransport(DraftEvent(ValidDraftJson)) { HoldOpen = true };
        SignalFilterDraft? applied = null;
        using var vm = new AISignalExplorerNlFilterViewModel(transport, StaticAiFeatureGate.On, Localizer, vehicleId: 7, onApply: d => applied = d)
        {
            Prompt = "show me battery level for yesterday",
        };

        var run = vm.StartAsync();
        // The draft arrives but the stream is still open (HoldOpen) → apply must stay disabled.
        vm.Apply();

        Assert.True(vm.HasDraft);
        Assert.False(vm.IsApplyEnabled);
        Assert.Null(applied);

        vm.Cancel();
        await run;
    }

    // ── view-model: error / offline / confirm / cancel ───────────────────────────────────────────────────

    [Fact]
    public async Task Error_frame_moves_to_the_error_surface_with_the_helix_message()
    {
        var transport = new FakeSignalFilterDraftTransport(
            AiSignalFilterDraftStreamEvent.Error("rate_limited", AiSignalFilterDraftErrorReason.Stream));
        using var vm = Ready(transport);

        await vm.StartAsync();

        Assert.Equal(AiSignalFilterDraftStreamState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(vm.IsOffline);
        Assert.Equal("Helix error: rate_limited", vm.DisplayErrorText);
    }

    [Fact]
    public async Task Network_failure_shows_the_offline_message()
    {
        var transport = new FakeSignalFilterDraftTransport(
            AiSignalFilterDraftStreamEvent.Error("stream_network", AiSignalFilterDraftErrorReason.Network));
        using var vm = Ready(transport);

        await vm.StartAsync();

        Assert.Equal(AiSignalFilterDraftStreamState.Error, vm.State);
        Assert.True(vm.IsOffline);
        Assert.Equal(AISignalExplorerNlFilterRegistration.OfflineFallback, vm.DisplayErrorText);
    }

    [Fact]
    public async Task Confirm_request_frame_pauses_the_stream()
    {
        var transport = new FakeSignalFilterDraftTransport(AiSignalFilterDraftStreamEvent.ConfirmRequest());
        using var vm = Ready(transport);

        await vm.StartAsync();

        Assert.Equal(AiSignalFilterDraftStreamState.PausedConfirm, vm.State);
    }

    [Fact]
    public async Task Cancel_returns_an_in_flight_stream_to_idle()
    {
        var transport = new FakeSignalFilterDraftTransport(AiSignalFilterDraftStreamEvent.Delta("started")) { HoldOpen = true };
        using var vm = Ready(transport);

        var run = vm.StartAsync();
        vm.Cancel();
        await run;

        Assert.Equal(AiSignalFilterDraftStreamState.Idle, vm.State);
    }

    [Fact]
    public async Task Error_then_retry_clears_the_prior_error()
    {
        var transport = new FakeSignalFilterDraftTransport(
            AiSignalFilterDraftStreamEvent.Error("boom", AiSignalFilterDraftErrorReason.Stream));
        using var vm = Ready(transport);
        await vm.StartAsync();
        Assert.Equal(AiSignalFilterDraftStreamState.Error, vm.State);

        transport.Reset(AiSignalFilterDraftStreamEvent.Delta("recovered"), AiSignalFilterDraftStreamEvent.Done());
        await vm.StartAsync();

        Assert.Equal(AiSignalFilterDraftStreamState.Done, vm.State);
        Assert.Equal("recovered", vm.AssistantText);
        Assert.False(vm.IsError);
    }

    // ── view-model: i18n + accessibility labels ──────────────────────────────────────────────────────────

    [Fact]
    public void Labels_resolve_to_the_web_fallback_copy()
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On);

        Assert.Equal("Helix natural-language filter", vm.Title);
        Assert.Equal("Draft filter", vm.DraftButtonLabel);
        Assert.Equal("Helix", vm.BadgeLabel);
        Assert.Equal("Ask Helix", vm.AskHelixLabel);
        Assert.Equal("Filter request", vm.PromptLabel);
        Assert.Equal("Apply to filters", vm.ApplyButtonLabel);
        Assert.Equal("e.g. show me battery level for yesterday", vm.PromptPlaceholder);
        Assert.Contains("plain English", vm.Description, StringComparison.Ordinal);
        Assert.Contains("before clicking Explore", vm.ApplyTooltip, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Action_label_flips_to_the_thinking_copy_while_streaming()
    {
        var transport = new FakeSignalFilterDraftTransport { HoldOpen = true };
        using var vm = Ready(transport);

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

        Assert.Equal("Ask Helix \u00b7 Draft filter", vm.ActionAutomationName);
    }

    // ── helpers ──────────────────────────────────────────────────────────────────────────────────────────

    private static JsonElement Element(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }

    private static AiSignalFilterDraftStreamEvent DraftEvent(string json, string name = "draft_signal_filter") =>
        AiSignalFilterDraftStreamEvent.ToolResult(name, true, Element(json));

    private static AISignalExplorerNlFilterViewModel NewViewModel(
        IAiFeatureGate gate,
        long vehicleId = 7,
        IAiSignalFilterDraftStreamTransport? transport = null) =>
        new(transport ?? new FakeSignalFilterDraftTransport(), gate, Localizer, vehicleId);

    private static AISignalExplorerNlFilterViewModel Ready(IAiSignalFilterDraftStreamTransport transport) =>
        new(transport, StaticAiFeatureGate.On, Localizer, vehicleId: 7) { Prompt = "show me battery level for yesterday" };

    /// <summary>
    /// A scripted <see cref="IAiSignalFilterDraftStreamTransport"/> for headless lifecycle tests: yields a fixed
    /// event sequence and (optionally) holds the stream open afterwards so cancel / duplicate-start / apply-
    /// while-streaming paths are exercised deterministically. Records the open count and the last request body.
    /// </summary>
    private sealed class FakeSignalFilterDraftTransport : IAiSignalFilterDraftStreamTransport
    {
        private AiSignalFilterDraftStreamEvent[] _events;
        private int _openCount;

        public FakeSignalFilterDraftTransport(params AiSignalFilterDraftStreamEvent[] events) => _events = events;

        /// <summary>When true the stream stays open after the scripted events until cancelled.</summary>
        public bool HoldOpen { get; init; }

        public int OpenCount => Volatile.Read(ref _openCount);

        public AiSignalFilterDraftRequest? LastRequest { get; private set; }

        public void Reset(params AiSignalFilterDraftStreamEvent[] events) => _events = events;

        public async IAsyncEnumerable<AiSignalFilterDraftStreamEvent> StreamAsync(
            AiSignalFilterDraftRequest request,
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
