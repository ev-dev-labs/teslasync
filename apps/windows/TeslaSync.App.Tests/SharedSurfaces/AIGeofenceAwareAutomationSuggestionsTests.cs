using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Settings;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the geofence-aware automation-suggestions surface's UI-thread-free logic — the SSE
/// frame parser (the native port of useAiStream's parseSSEFrame/toTypedEvent, including the tool_result data
/// capture), the typed draft-envelope narrowing (the port of normalizeAutomationInput), the registration
/// metadata + AI feature-registry membership, the PII-safe diagnostics, and the view-model's gate / canStart /
/// stream lifecycle state machine (idle → streaming → done / error, duplicate-start no-op, cancel → idle,
/// offline classification, draft capture and the propose-only apply handoff). Mirrors the web spec
/// (web/src/components/ai/AIGeofenceAwareAutomationSuggestions.tsx + AIFeatureCard.tsx + useAiStream.ts). The
/// WinUI view (shared-surfaces/AIGeofenceAwareAutomationSuggestions.cs) is exercised by the app build.
/// </summary>
public sealed class AIGeofenceAwareAutomationSuggestionsTests
{
    private const string ValidDraftJson =
        "{\"draft\":{\"name\":\"Arrive home cabin\",\"description\":\"Cool the cabin on arrival\"," +
        "\"vehicle_id\":7,\"enabled\":true,\"triggers\":[{\"type\":\"geofence_enter\"}]," +
        "\"conditions\":[{\"type\":\"weekday\"},{\"type\":\"after_sunset\"}]," +
        "\"actions\":[{\"type\":\"cabin_overheat\"}]},\"status\":\"ok\"}";

    private const string RejectedDraftJson =
        "{\"draft\":{\"name\":\"Bad draft\",\"vehicle_id\":7,\"enabled\":false," +
        "\"triggers\":[],\"conditions\":[],\"actions\":[]},\"status\":\"invalid\"," +
        "\"validation_error\":\"no geofence referenced\"}";

    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // ── registration + registry membership ───────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("AIGeofenceAwareAutomationSuggestions", AIGeofenceAwareAutomationSuggestionsRegistration.Slug);

    [Fact]
    public void Feature_id_is_present_in_the_canonical_registry()
    {
        Assert.True(AIGeofenceAwareAutomationSuggestionsRegistration.IsRegisteredFeature(
            AIGeofenceAwareAutomationSuggestionsRegistration.FeatureId));
        Assert.Contains(
            AiFeatureRegistry.Features,
            m => m.Id == AIGeofenceAwareAutomationSuggestionsRegistration.FeatureId);
    }

    [Fact]
    public void Unknown_feature_id_is_not_registered() =>
        Assert.False(AIGeofenceAwareAutomationSuggestionsRegistration.IsRegisteredFeature("not-a-real-feature"));

    [Fact]
    public void Draft_path_is_the_web_endpoint_without_the_version_prefix() =>
        Assert.Equal("/ai/geofences/automations/draft", AIGeofenceAwareAutomationSuggestionsRegistration.DraftPath);

    [Fact]
    public void Draft_tool_name_matches_the_backend_tool() =>
        Assert.Equal("draft_automation_graph", AIGeofenceAwareAutomationSuggestionsRegistration.DraftToolName);

    // ── diagnostics: view.opened, PII-safe ───────────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new AIGeofenceAwareAutomationSuggestionsDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=AIGeofenceAwareAutomationSuggestions", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_without_a_sink_still_count_opens()
    {
        var diagnostics = new AIGeofenceAwareAutomationSuggestionsDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    // ── SSE parser (web parseSSEFrame / toTypedEvent) ────────────────────────────────────────────────────

    [Fact]
    public void Parser_reads_a_delta_frame()
    {
        var ev = AiAutomationDraftSseParser.ParseFrame("event: delta\ndata: {\"text\":\"Drafting \"}");

        Assert.NotNull(ev);
        Assert.Equal(AiAutomationDraftEventKind.Delta, ev!.Kind);
        Assert.Equal("Drafting ", ev.Text);
    }

    [Fact]
    public void Parser_reads_a_done_frame()
    {
        var ev = AiAutomationDraftSseParser.ParseFrame("event: done\ndata: {\"finish_reason\":\"stop\",\"usage\":{\"in\":1,\"out\":2}}");

        Assert.NotNull(ev);
        Assert.Equal(AiAutomationDraftEventKind.Done, ev!.Kind);
    }

    [Fact]
    public void Parser_reads_an_error_frame_with_its_message()
    {
        var ev = AiAutomationDraftSseParser.ParseFrame("event: error\ndata: {\"message\":\"rate_limited\"}");

        Assert.NotNull(ev);
        Assert.Equal(AiAutomationDraftEventKind.Error, ev!.Kind);
        Assert.Equal("rate_limited", ev.Message);
        Assert.Equal(AiAutomationDraftErrorReason.Stream, ev.ErrorReason);
    }

    [Fact]
    public void Parser_defaults_an_error_message_to_unknown_when_absent()
    {
        var ev = AiAutomationDraftSseParser.ParseFrame("event: error\ndata: {\"reason\":\"cost_cap\"}");

        Assert.NotNull(ev);
        Assert.Equal(AiAutomationDraftEventKind.Error, ev!.Kind);
        Assert.Equal("unknown", ev.Message);
    }

    [Fact]
    public void Parser_reads_a_tool_call_frame_and_ignores_its_payload()
    {
        var call = AiAutomationDraftSseParser.ParseFrame("event: tool_call\ndata: {\"id\":\"1\",\"name\":\"draft_automation_graph\"}");

        Assert.NotNull(call);
        Assert.Equal(AiAutomationDraftEventKind.ToolCall, call!.Kind);
    }

    [Fact]
    public void Parser_reads_a_tool_result_frame_and_captures_its_data_payload()
    {
        var ev = AiAutomationDraftSseParser.ParseFrame(
            "event: tool_result\ndata: {\"id\":\"1\",\"name\":\"draft_automation_graph\",\"ok\":true,\"data\":" +
            ValidDraftJson + "}");

        Assert.NotNull(ev);
        Assert.Equal(AiAutomationDraftEventKind.ToolResult, ev!.Kind);
        Assert.Equal("draft_automation_graph", ev.ToolName);
        Assert.True(ev.ToolOk);
        Assert.NotNull(ev.ToolData);
        Assert.True(ev.ToolData!.Value.TryGetProperty("status", out _));
    }

    [Fact]
    public void Parser_reads_a_failed_tool_result_with_no_data()
    {
        var ev = AiAutomationDraftSseParser.ParseFrame(
            "event: tool_result\ndata: {\"id\":\"1\",\"name\":\"draft_automation_graph\",\"ok\":false}");

        Assert.NotNull(ev);
        Assert.Equal(AiAutomationDraftEventKind.ToolResult, ev!.Kind);
        Assert.False(ev.ToolOk);
        Assert.Null(ev.ToolData);
    }

    [Fact]
    public void Parser_reads_a_confirm_request_frame()
    {
        var ev = AiAutomationDraftSseParser.ParseFrame(
            "event: confirm_request\ndata: {\"continuation_id\":\"c\",\"tool\":\"t\",\"summary\":\"s\"}");

        Assert.NotNull(ev);
        Assert.Equal(AiAutomationDraftEventKind.ConfirmRequest, ev!.Kind);
    }

    [Fact]
    public void Parser_ignores_comment_lines()
    {
        var ev = AiAutomationDraftSseParser.ParseFrame(": keep-alive\nevent: delta\ndata: {\"text\":\"x\"}");

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
        Assert.Null(AiAutomationDraftSseParser.ParseFrame(frame));

    [Fact]
    public void Parser_supports_no_space_after_field_name()
    {
        var ev = AiAutomationDraftSseParser.ParseFrame("event:delta\ndata:{\"text\":\"y\"}");

        Assert.NotNull(ev);
        Assert.Equal("y", ev!.Text);
    }

    // ── draft envelope narrowing (web normalizeAutomationInput) ──────────────────────────────────────────

    [Fact]
    public void Draft_parse_accepts_a_well_formed_ok_envelope()
    {
        Assert.True(GeofenceAutomationDraft.TryParse(Element(ValidDraftJson), out var draft));

        Assert.NotNull(draft);
        Assert.True(draft!.IsOk);
        Assert.Equal("Arrive home cabin", draft.Graph.Name);
        Assert.Equal("Cool the cabin on arrival", draft.Graph.Description);
        Assert.Equal(7, draft.Graph.VehicleId);
        Assert.True(draft.Graph.Enabled);
        Assert.Single(draft.Graph.Triggers);
        Assert.Equal(2, draft.Graph.Conditions.Count);
        Assert.Single(draft.Graph.Actions);
        Assert.Null(draft.ValidationError);
    }

    [Fact]
    public void Draft_parse_accepts_a_rejected_envelope_with_its_validation_error()
    {
        Assert.True(GeofenceAutomationDraft.TryParse(Element(RejectedDraftJson), out var draft));

        Assert.NotNull(draft);
        Assert.False(draft!.IsOk);
        Assert.Equal("invalid", draft.Status);
        Assert.Equal("no geofence referenced", draft.ValidationError);
    }

    [Fact]
    public void Draft_parse_defaults_a_missing_description_to_empty()
    {
        Assert.True(GeofenceAutomationDraft.TryParse(Element(RejectedDraftJson), out var draft));

        Assert.NotNull(draft);
        Assert.Equal(string.Empty, draft!.Graph.Description);
    }

    [Theory]
    [InlineData("{\"draft\":{\"name\":\"x\",\"vehicle_id\":7,\"enabled\":true,\"triggers\":[],\"conditions\":[],\"actions\":[]}}")] // no status
    [InlineData("{\"status\":\"ok\"}")] // no draft
    [InlineData("{\"draft\":{\"name\":\"x\",\"enabled\":true,\"triggers\":[],\"conditions\":[],\"actions\":[]},\"status\":\"ok\"}")] // no vehicle_id
    [InlineData("{\"draft\":{\"vehicle_id\":7,\"enabled\":true,\"triggers\":[],\"conditions\":[],\"actions\":[]},\"status\":\"ok\"}")] // no name
    [InlineData("{\"draft\":{\"name\":\"x\",\"vehicle_id\":7,\"enabled\":true,\"conditions\":[],\"actions\":[]},\"status\":\"ok\"}")] // no triggers array
    [InlineData("{\"draft\":{\"name\":\"x\",\"vehicle_id\":7,\"enabled\":\"yes\",\"triggers\":[],\"conditions\":[],\"actions\":[]},\"status\":\"ok\"}")] // enabled not bool
    public void Draft_parse_rejects_a_malformed_envelope(string json)
    {
        Assert.False(GeofenceAutomationDraft.TryParse(Element(json), out var draft));
        Assert.Null(draft);
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

    // ── view-model: initial state + canStart (web canStart) ──────────────────────────────────────────────

    [Fact]
    public void Initial_state_is_idle_with_no_output_and_no_draft()
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On, vehicleId: 7);

        Assert.Equal(AiAutomationDraftStreamState.Idle, vm.State);
        Assert.Equal(string.Empty, vm.AssistantText);
        Assert.False(vm.HasOutput);
        Assert.False(vm.IsThinking);
        Assert.False(vm.IsError);
        Assert.False(vm.HasDraft);
    }

    [Theory]
    [InlineData(null, "a prompt", false)]
    [InlineData(0L, "a prompt", false)]
    [InlineData(-3L, "a prompt", false)]
    [InlineData(7L, "", false)]
    [InlineData(7L, "   ", false)]
    [InlineData(7L, "a prompt", true)]
    public void CanStart_requires_a_positive_vehicle_and_a_non_blank_prompt(long? vehicleId, string prompt, bool expected)
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On, vehicleId);
        vm.Prompt = prompt;

        Assert.Equal(expected, vm.CanStart);
        Assert.Equal(expected, vm.IsActionEnabled);
    }

    [Fact]
    public void Setting_prompt_and_vehicle_reevaluates_can_start()
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On, vehicleId: null);
        Assert.False(vm.CanStart);

        vm.VehicleId = 42;
        vm.Prompt = "draft me an automation";

        Assert.True(vm.CanStart);
        Assert.True(vm.IsActionEnabled);
    }

    // ── view-model: stream lifecycle (web useAiStream) ───────────────────────────────────────────────────

    [Fact]
    public async Task Start_streams_deltas_into_text_then_completes_done()
    {
        var transport = new FakeDraftTransport(
            AiAutomationDraftStreamEvent.Delta("Proposing "),
            AiAutomationDraftStreamEvent.Delta("an automation."),
            AiAutomationDraftStreamEvent.Done());
        using var vm = Ready(transport);
        bool thinkingAtStreamStart = false;
        vm.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(vm.State) && vm.State == AiAutomationDraftStreamState.Streaming)
            {
                thinkingAtStreamStart = vm.IsThinking;
            }
        };

        await vm.StartAsync();

        Assert.Equal("Proposing an automation.", vm.AssistantText);
        Assert.Equal(AiAutomationDraftStreamState.Done, vm.State);
        Assert.True(thinkingAtStreamStart);
        Assert.False(vm.IsThinking);
        Assert.Equal(1, transport.OpenCount);
        Assert.Equal(7, transport.LastRequest?.VehicleId);
        Assert.Equal("draft me an automation", transport.LastRequest?.Prompt);
    }

    [Fact]
    public async Task Start_marks_done_when_the_stream_closes_without_a_terminal_event()
    {
        var transport = new FakeDraftTransport(AiAutomationDraftStreamEvent.Delta("partial"));
        using var vm = Ready(transport);

        await vm.StartAsync();

        Assert.Equal(AiAutomationDraftStreamState.Done, vm.State);
        Assert.Equal("partial", vm.AssistantText);
    }

    [Fact]
    public async Task Start_is_a_no_op_without_a_resolved_vehicle()
    {
        var transport = new FakeDraftTransport(AiAutomationDraftStreamEvent.Done());
        using var vm = NewViewModel(StaticAiFeatureGate.On, vehicleId: null, transport);
        vm.Prompt = "a prompt";

        await vm.StartAsync();

        Assert.Equal(AiAutomationDraftStreamState.Idle, vm.State);
        Assert.Equal(0, transport.OpenCount);
    }

    [Fact]
    public async Task Start_is_a_no_op_without_a_prompt()
    {
        var transport = new FakeDraftTransport(AiAutomationDraftStreamEvent.Done());
        using var vm = NewViewModel(StaticAiFeatureGate.On, vehicleId: 7, transport);

        await vm.StartAsync();

        Assert.Equal(AiAutomationDraftStreamState.Idle, vm.State);
        Assert.Equal(0, transport.OpenCount);
    }

    [Fact]
    public async Task Start_is_a_no_op_when_the_gate_is_closed()
    {
        var transport = new FakeDraftTransport(AiAutomationDraftStreamEvent.Done());
        using var vm = NewViewModel(StaticAiFeatureGate.Off, vehicleId: 7, transport);
        vm.Prompt = "a prompt";

        await vm.StartAsync();

        Assert.Equal(AiAutomationDraftStreamState.Idle, vm.State);
        Assert.Equal(0, transport.OpenCount);
    }

    [Fact]
    public async Task Duplicate_start_while_streaming_is_a_no_op()
    {
        var transport = new FakeDraftTransport { HoldOpen = true };
        using var vm = Ready(transport);

        var first = vm.StartAsync();
        var second = vm.StartAsync();

        await second; // the second call returns immediately without opening a second stream.
        Assert.Equal(AiAutomationDraftStreamState.Streaming, vm.State);
        Assert.Equal(1, transport.OpenCount);

        vm.Cancel();
        await first;
    }

    // ── view-model: draft capture (web tool_result handler) ──────────────────────────────────────────────

    [Fact]
    public async Task Tool_result_with_an_accepted_envelope_is_captured_as_a_draft()
    {
        var transport = new FakeDraftTransport(
            DraftEvent(ValidDraftJson),
            AiAutomationDraftStreamEvent.Done());
        using var vm = Ready(transport);

        await vm.StartAsync();

        Assert.True(vm.HasDraft);
        Assert.Equal("Arrive home cabin", vm.DraftName);
        Assert.True(vm.HasDraftDescription);
        Assert.Equal("Cool the cabin on arrival", vm.DraftDescription);
        Assert.Equal("Triggers: 1 \u00b7 Conditions: 2 \u00b7 Actions: 1", vm.DraftSummaryText);
        Assert.False(vm.IsDraftRejected);
        Assert.True(vm.IsApplyEnabled);
    }

    [Fact]
    public async Task Rejected_draft_shows_the_validator_verdict_and_disables_apply()
    {
        var transport = new FakeDraftTransport(
            DraftEvent(RejectedDraftJson),
            AiAutomationDraftStreamEvent.Done());
        using var vm = Ready(transport);

        await vm.StartAsync();

        Assert.True(vm.HasDraft);
        Assert.Equal("Bad draft", vm.DraftName);
        Assert.True(vm.IsDraftRejected);
        Assert.True(vm.HasDraftValidationError);
        Assert.Equal("no geofence referenced", vm.DraftValidationError);
        Assert.False(vm.IsApplyEnabled);
    }

    [Fact]
    public async Task Blank_named_draft_shows_the_unnamed_fallback()
    {
        const string json =
            "{\"draft\":{\"name\":\"\",\"vehicle_id\":7,\"enabled\":true,\"triggers\":[],\"conditions\":[]," +
            "\"actions\":[]},\"status\":\"ok\"}";
        var transport = new FakeDraftTransport(DraftEvent(json), AiAutomationDraftStreamEvent.Done());
        using var vm = Ready(transport);

        await vm.StartAsync();

        Assert.Equal("(unnamed)", vm.DraftName);
    }

    [Fact]
    public async Task Tool_result_for_another_tool_is_ignored()
    {
        var transport = new FakeDraftTransport(
            DraftEvent(ValidDraftJson, name: "some_other_tool"),
            AiAutomationDraftStreamEvent.Done());
        using var vm = Ready(transport);

        await vm.StartAsync();

        Assert.False(vm.HasDraft);
    }

    [Fact]
    public async Task Failed_tool_result_is_ignored()
    {
        var transport = new FakeDraftTransport(
            AiAutomationDraftStreamEvent.ToolResult(
                AIGeofenceAwareAutomationSuggestionsRegistration.DraftToolName, ok: false, null),
            AiAutomationDraftStreamEvent.Done());
        using var vm = Ready(transport);

        await vm.StartAsync();

        Assert.False(vm.HasDraft);
    }

    [Fact]
    public async Task Apply_invokes_the_callback_with_the_accepted_graph()
    {
        GeofenceAutomationGraph? applied = null;
        var transport = new FakeDraftTransport(DraftEvent(ValidDraftJson), AiAutomationDraftStreamEvent.Done());
        using var vm = new AIGeofenceAwareAutomationSuggestionsViewModel(
            transport, StaticAiFeatureGate.On, Localizer, vehicleId: 7, onApplyDraft: g => applied = g);
        vm.Prompt = "draft me an automation";

        await vm.StartAsync();
        vm.Apply();

        Assert.NotNull(applied);
        Assert.Equal("Arrive home cabin", applied!.Name);
        Assert.Equal(7, applied.VehicleId);
    }

    [Fact]
    public async Task Apply_is_a_no_op_for_a_rejected_draft()
    {
        int applied = 0;
        var transport = new FakeDraftTransport(DraftEvent(RejectedDraftJson), AiAutomationDraftStreamEvent.Done());
        using var vm = new AIGeofenceAwareAutomationSuggestionsViewModel(
            transport, StaticAiFeatureGate.On, Localizer, vehicleId: 7, onApplyDraft: _ => applied++);
        vm.Prompt = "draft me an automation";

        await vm.StartAsync();
        vm.Apply();

        Assert.Equal(0, applied);
    }

    [Fact]
    public async Task Changing_vehicle_clears_a_captured_draft()
    {
        var transport = new FakeDraftTransport(DraftEvent(ValidDraftJson), AiAutomationDraftStreamEvent.Done());
        using var vm = Ready(transport);
        await vm.StartAsync();
        Assert.True(vm.HasDraft);

        vm.VehicleId = 99;

        Assert.False(vm.HasDraft);
    }

    [Fact]
    public async Task New_run_clears_the_prior_draft()
    {
        var transport = new FakeDraftTransport(DraftEvent(ValidDraftJson), AiAutomationDraftStreamEvent.Done());
        using var vm = Ready(transport);
        await vm.StartAsync();
        Assert.True(vm.HasDraft);

        transport.Reset(AiAutomationDraftStreamEvent.Delta("thinking"));
        await vm.StartAsync();

        Assert.False(vm.HasDraft);
    }

    // ── view-model: error / offline / confirm / cancel ───────────────────────────────────────────────────

    [Fact]
    public async Task Error_frame_moves_to_the_error_surface_with_the_helix_message()
    {
        var transport = new FakeDraftTransport(
            AiAutomationDraftStreamEvent.Error("rate_limited", AiAutomationDraftErrorReason.Stream));
        using var vm = Ready(transport);

        await vm.StartAsync();

        Assert.Equal(AiAutomationDraftStreamState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(vm.IsOffline);
        Assert.Equal("Helix error: rate_limited", vm.DisplayErrorText);
    }

    [Fact]
    public async Task Network_failure_shows_the_offline_message()
    {
        var transport = new FakeDraftTransport(
            AiAutomationDraftStreamEvent.Error("stream_network", AiAutomationDraftErrorReason.Network));
        using var vm = Ready(transport);

        await vm.StartAsync();

        Assert.Equal(AiAutomationDraftStreamState.Error, vm.State);
        Assert.True(vm.IsOffline);
        Assert.Equal(AIGeofenceAwareAutomationSuggestionsRegistration.OfflineFallback, vm.DisplayErrorText);
    }

    [Fact]
    public async Task Confirm_request_frame_pauses_the_stream_and_blocks_canStart()
    {
        var transport = new FakeDraftTransport(AiAutomationDraftStreamEvent.ConfirmRequest());
        using var vm = Ready(transport);

        await vm.StartAsync();

        Assert.Equal(AiAutomationDraftStreamState.PausedConfirm, vm.State);
        Assert.False(vm.CanStart);
    }

    [Fact]
    public async Task Cancel_returns_an_in_flight_stream_to_idle()
    {
        var transport = new FakeDraftTransport(AiAutomationDraftStreamEvent.Delta("started")) { HoldOpen = true };
        using var vm = Ready(transport);

        var run = vm.StartAsync();
        vm.Cancel();
        await run;

        Assert.Equal(AiAutomationDraftStreamState.Idle, vm.State);
    }

    [Fact]
    public async Task Error_then_retry_clears_the_prior_error()
    {
        var transport = new FakeDraftTransport(
            AiAutomationDraftStreamEvent.Error("boom", AiAutomationDraftErrorReason.Stream));
        using var vm = Ready(transport);
        await vm.StartAsync();
        Assert.Equal(AiAutomationDraftStreamState.Error, vm.State);

        transport.Reset(AiAutomationDraftStreamEvent.Delta("recovered"), AiAutomationDraftStreamEvent.Done());
        await vm.StartAsync();

        Assert.Equal(AiAutomationDraftStreamState.Done, vm.State);
        Assert.Equal("recovered", vm.AssistantText);
        Assert.False(vm.IsError);
    }

    // ── view-model: i18n + accessibility labels ──────────────────────────────────────────────────────────

    [Fact]
    public void Labels_resolve_to_the_web_fallback_copy()
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On, vehicleId: 7);

        Assert.Equal("Suggest a geofence-aware automation", vm.Title);
        Assert.Equal("Suggest automation", vm.SuggestButtonLabel);
        Assert.Equal("Helix", vm.BadgeLabel);
        Assert.Equal("Ask Helix", vm.AskHelixLabel);
        Assert.Equal("Proposed automation", vm.ProposalLabel);
        Assert.Equal("Apply to form", vm.ApplyButtonLabel);
        Assert.Equal("Proposal rejected by validator", vm.RejectedLabel);
        Assert.Contains("existing geofences", vm.Description, StringComparison.Ordinal);
        Assert.Contains("cabin overheat protection", vm.PlaceholderText, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Action_label_flips_to_the_thinking_copy_while_streaming()
    {
        var transport = new FakeDraftTransport { HoldOpen = true };
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
        using var vm = NewViewModel(StaticAiFeatureGate.On, vehicleId: 7);

        Assert.Equal("Ask Helix \u00b7 Suggest automation", vm.ActionAutomationName);
    }

    // ── helpers ──────────────────────────────────────────────────────────────────────────────────────────

    private static JsonElement Element(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }

    private static AiAutomationDraftStreamEvent DraftEvent(
        string envelopeJson,
        bool ok = true,
        string name = "draft_automation_graph") =>
        AiAutomationDraftStreamEvent.ToolResult(name, ok, Element(envelopeJson));

    private static AIGeofenceAwareAutomationSuggestionsViewModel NewViewModel(
        IAiFeatureGate gate,
        long? vehicleId,
        IAiAutomationDraftStreamTransport? transport = null) =>
        new(transport ?? new FakeDraftTransport(), gate, Localizer, vehicleId);

    /// <summary>A gate-on, vehicle-scoped, prompt-filled view-model that satisfies <c>canStart</c>.</summary>
    private static AIGeofenceAwareAutomationSuggestionsViewModel Ready(IAiAutomationDraftStreamTransport transport)
    {
        var vm = new AIGeofenceAwareAutomationSuggestionsViewModel(transport, StaticAiFeatureGate.On, Localizer, vehicleId: 7)
        {
            Prompt = "draft me an automation",
        };
        return vm;
    }

    /// <summary>
    /// A scripted <see cref="IAiAutomationDraftStreamTransport"/> for headless lifecycle tests: yields a fixed
    /// event sequence and (optionally) holds the stream open afterwards so cancel / duplicate-start paths are
    /// exercised deterministically. Records the open count and the last request body.
    /// </summary>
    private sealed class FakeDraftTransport : IAiAutomationDraftStreamTransport
    {
        private AiAutomationDraftStreamEvent[] _events;
        private int _openCount;

        public FakeDraftTransport(params AiAutomationDraftStreamEvent[] events) => _events = events;

        /// <summary>When true the stream stays open after the scripted events until cancelled.</summary>
        public bool HoldOpen { get; init; }

        public int OpenCount => Volatile.Read(ref _openCount);

        public AiAutomationDraftRequest? LastRequest { get; private set; }

        public void Reset(params AiAutomationDraftStreamEvent[] events) => _events = events;

        public async IAsyncEnumerable<AiAutomationDraftStreamEvent> StreamAsync(
            AiAutomationDraftRequest request,
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
