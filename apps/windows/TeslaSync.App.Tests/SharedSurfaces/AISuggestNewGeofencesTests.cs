using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Settings;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the suggest-new-geofences surface's UI-thread-free logic — the SSE frame parser
/// (the native port of useAiStream's parseSSEFrame/toTypedEvent, including the tool_result data capture), the
/// typed draft-envelope narrowing (the port of the web handleEvent guard), the registration metadata + AI
/// feature-registry membership, the PII-safe diagnostics, and the view-model's gate / canStart / stream
/// lifecycle state machine (idle → streaming → done / error, duplicate-start no-op, cancel → idle, offline
/// classification, draft capture and the propose-only apply handoff). Mirrors the web spec
/// (web/src/components/ai/AISuggestNewGeofences.tsx + AIFeatureCard.tsx + useAiStream.ts). The WinUI view
/// (shared-surfaces/AISuggestNewGeofences.cs) is exercised by the app build.
/// </summary>
public sealed class AISuggestNewGeofencesTests
{
    private const string ValidDraftJson =
        "{\"draft\":{\"location_id\":42,\"vehicle_id\":7,\"proposed_name\":\"Home charger\"," +
        "\"radius_m\":120,\"centroid_lat\":37.422,\"centroid_lon\":-122.084},\"status\":\"ok\"}";

    private const string RejectedDraftJson =
        "{\"draft\":{\"location_id\":42,\"vehicle_id\":7,\"proposed_name\":\"Too small\"," +
        "\"radius_m\":5,\"centroid_lat\":1.5,\"centroid_lon\":2.5},\"status\":\"invalid\"," +
        "\"validation_error\":\"radius below minimum\"}";

    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // ── registration + registry membership ───────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("AISuggestNewGeofences", AISuggestNewGeofencesRegistration.Slug);

    [Fact]
    public void Feature_id_is_present_in_the_canonical_registry()
    {
        Assert.True(AISuggestNewGeofencesRegistration.IsRegisteredFeature(
            AISuggestNewGeofencesRegistration.FeatureId));
        Assert.Contains(
            AiFeatureRegistry.Features,
            m => m.Id == AISuggestNewGeofencesRegistration.FeatureId);
    }

    [Fact]
    public void Unknown_feature_id_is_not_registered() =>
        Assert.False(AISuggestNewGeofencesRegistration.IsRegisteredFeature("not-a-real-feature"));

    [Fact]
    public void Draft_path_is_the_web_endpoint_without_the_version_prefix() =>
        Assert.Equal("/ai/geofences/draft", AISuggestNewGeofencesRegistration.DraftPath);

    [Fact]
    public void Draft_tool_name_matches_the_backend_tool() =>
        Assert.Equal("draft_geofence", AISuggestNewGeofencesRegistration.DraftToolName);

    // ── diagnostics: view.opened, PII-safe ───────────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new AISuggestNewGeofencesDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=AISuggestNewGeofences", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_without_a_sink_still_count_opens()
    {
        var diagnostics = new AISuggestNewGeofencesDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    // ── SSE parser (web parseSSEFrame / toTypedEvent) ────────────────────────────────────────────────────

    [Fact]
    public void Parser_reads_a_delta_frame()
    {
        var ev = AiGeofenceDraftSseParser.ParseFrame("event: delta\ndata: {\"text\":\"Drafting \"}");

        Assert.NotNull(ev);
        Assert.Equal(AiGeofenceDraftEventKind.Delta, ev!.Kind);
        Assert.Equal("Drafting ", ev.Text);
    }

    [Fact]
    public void Parser_reads_a_done_frame()
    {
        var ev = AiGeofenceDraftSseParser.ParseFrame("event: done\ndata: {\"finish_reason\":\"stop\",\"usage\":{\"in\":1,\"out\":2}}");

        Assert.NotNull(ev);
        Assert.Equal(AiGeofenceDraftEventKind.Done, ev!.Kind);
    }

    [Fact]
    public void Parser_reads_an_error_frame_with_its_message()
    {
        var ev = AiGeofenceDraftSseParser.ParseFrame("event: error\ndata: {\"message\":\"rate_limited\"}");

        Assert.NotNull(ev);
        Assert.Equal(AiGeofenceDraftEventKind.Error, ev!.Kind);
        Assert.Equal("rate_limited", ev.Message);
        Assert.Equal(AiGeofenceDraftErrorReason.Stream, ev.ErrorReason);
    }

    [Fact]
    public void Parser_defaults_an_error_message_to_unknown_when_absent()
    {
        var ev = AiGeofenceDraftSseParser.ParseFrame("event: error\ndata: {\"reason\":\"cost_cap\"}");

        Assert.NotNull(ev);
        Assert.Equal(AiGeofenceDraftEventKind.Error, ev!.Kind);
        Assert.Equal("unknown", ev.Message);
    }

    [Fact]
    public void Parser_reads_a_tool_call_frame_and_ignores_its_payload()
    {
        var call = AiGeofenceDraftSseParser.ParseFrame("event: tool_call\ndata: {\"id\":\"1\",\"name\":\"draft_geofence\"}");

        Assert.NotNull(call);
        Assert.Equal(AiGeofenceDraftEventKind.ToolCall, call!.Kind);
    }

    [Fact]
    public void Parser_reads_a_tool_result_frame_and_captures_its_data_payload()
    {
        var ev = AiGeofenceDraftSseParser.ParseFrame(
            "event: tool_result\ndata: {\"id\":\"1\",\"name\":\"draft_geofence\",\"ok\":true,\"data\":" +
            ValidDraftJson + "}");

        Assert.NotNull(ev);
        Assert.Equal(AiGeofenceDraftEventKind.ToolResult, ev!.Kind);
        Assert.Equal("draft_geofence", ev.ToolName);
        Assert.True(ev.ToolOk);
        Assert.NotNull(ev.ToolData);
        Assert.True(ev.ToolData!.Value.TryGetProperty("status", out _));
    }

    [Fact]
    public void Parser_reads_a_failed_tool_result_with_no_data()
    {
        var ev = AiGeofenceDraftSseParser.ParseFrame(
            "event: tool_result\ndata: {\"id\":\"1\",\"name\":\"draft_geofence\",\"ok\":false}");

        Assert.NotNull(ev);
        Assert.Equal(AiGeofenceDraftEventKind.ToolResult, ev!.Kind);
        Assert.False(ev.ToolOk);
        Assert.Null(ev.ToolData);
    }

    [Fact]
    public void Parser_reads_a_confirm_request_frame()
    {
        var ev = AiGeofenceDraftSseParser.ParseFrame(
            "event: confirm_request\ndata: {\"continuation_id\":\"c\",\"tool\":\"t\",\"summary\":\"s\"}");

        Assert.NotNull(ev);
        Assert.Equal(AiGeofenceDraftEventKind.ConfirmRequest, ev!.Kind);
    }

    [Fact]
    public void Parser_ignores_comment_lines()
    {
        var ev = AiGeofenceDraftSseParser.ParseFrame(": keep-alive\nevent: delta\ndata: {\"text\":\"x\"}");

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
        Assert.Null(AiGeofenceDraftSseParser.ParseFrame(frame));

    [Fact]
    public void Parser_supports_no_space_after_field_name()
    {
        var ev = AiGeofenceDraftSseParser.ParseFrame("event:delta\ndata:{\"text\":\"y\"}");

        Assert.NotNull(ev);
        Assert.Equal("y", ev!.Text);
    }

    // ── draft envelope narrowing (web handleEvent guard) ─────────────────────────────────────────────────

    [Fact]
    public void Draft_parse_accepts_a_well_formed_ok_envelope()
    {
        Assert.True(GeofenceDraft.TryParse(Element(ValidDraftJson), out var draft));

        Assert.NotNull(draft);
        Assert.True(draft!.IsOk);
        Assert.Equal(42, draft.LocationId);
        Assert.Equal(7, draft.VehicleId);
        Assert.Equal("Home charger", draft.ProposedName);
        Assert.Equal(120, draft.RadiusMeters);
        Assert.Equal(37.422, draft.CentroidLat);
        Assert.Equal(-122.084, draft.CentroidLon);
        Assert.Null(draft.ValidationError);
    }

    [Fact]
    public void Draft_parse_accepts_a_rejected_envelope_with_its_validation_error()
    {
        Assert.True(GeofenceDraft.TryParse(Element(RejectedDraftJson), out var draft));

        Assert.NotNull(draft);
        Assert.False(draft!.IsOk);
        Assert.Equal("invalid", draft.Status);
        Assert.Equal("radius below minimum", draft.ValidationError);
    }

    [Fact]
    public void Draft_parse_accepts_a_floating_point_radius()
    {
        const string json =
            "{\"draft\":{\"location_id\":1,\"vehicle_id\":2,\"proposed_name\":\"x\"," +
            "\"radius_m\":88.7,\"centroid_lat\":0,\"centroid_lon\":0},\"status\":\"ok\"}";

        Assert.True(GeofenceDraft.TryParse(Element(json), out var draft));
        Assert.Equal(88.7, draft!.RadiusMeters);
    }

    [Fact]
    public void Draft_to_application_maps_the_web_apply_payload()
    {
        Assert.True(GeofenceDraft.TryParse(Element(ValidDraftJson), out var draft));

        var application = draft!.ToApplication();

        Assert.Equal("Home charger", application.Name);
        Assert.Equal(37.422, application.Latitude);
        Assert.Equal(-122.084, application.Longitude);
        Assert.Equal(120, application.Radius);
    }

    [Theory]
    [InlineData("{\"draft\":{\"location_id\":1,\"vehicle_id\":2,\"proposed_name\":\"x\",\"radius_m\":1,\"centroid_lat\":0,\"centroid_lon\":0}}")] // no status
    [InlineData("{\"status\":\"ok\"}")] // no draft
    [InlineData("{\"draft\":{\"vehicle_id\":2,\"proposed_name\":\"x\",\"radius_m\":1,\"centroid_lat\":0,\"centroid_lon\":0},\"status\":\"ok\"}")] // no location_id
    [InlineData("{\"draft\":{\"location_id\":1,\"proposed_name\":\"x\",\"radius_m\":1,\"centroid_lat\":0,\"centroid_lon\":0},\"status\":\"ok\"}")] // no vehicle_id
    [InlineData("{\"draft\":{\"location_id\":1,\"vehicle_id\":2,\"radius_m\":1,\"centroid_lat\":0,\"centroid_lon\":0},\"status\":\"ok\"}")] // no proposed_name
    [InlineData("{\"draft\":{\"location_id\":1,\"vehicle_id\":2,\"proposed_name\":\"x\",\"centroid_lat\":0,\"centroid_lon\":0},\"status\":\"ok\"}")] // no radius_m
    [InlineData("{\"draft\":{\"location_id\":1,\"vehicle_id\":2,\"proposed_name\":\"x\",\"radius_m\":\"big\",\"centroid_lat\":0,\"centroid_lon\":0},\"status\":\"ok\"}")] // radius not a number
    [InlineData("{\"draft\":{\"location_id\":1,\"vehicle_id\":2,\"proposed_name\":\"x\",\"radius_m\":1,\"centroid_lon\":0},\"status\":\"ok\"}")] // no centroid_lat
    public void Draft_parse_rejects_a_malformed_envelope(string json)
    {
        Assert.False(GeofenceDraft.TryParse(Element(json), out var draft));
        Assert.Null(draft);
    }

    // ── view-model: gate (web withAiFeature / useAiEnabled) ──────────────────────────────────────────────

    [Fact]
    public void Gate_off_keeps_the_surface_closed()
    {
        using var vm = NewViewModel(StaticAiFeatureGate.Off, locationId: 7);

        Assert.False(vm.IsGateOpen);
    }

    [Fact]
    public void Gate_on_opens_the_surface()
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On, locationId: 7);

        Assert.True(vm.IsGateOpen);
    }

    // ── view-model: initial state + canStart (web canStart) ──────────────────────────────────────────────

    [Fact]
    public void Initial_state_is_idle_with_no_output_and_no_draft()
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On, locationId: 7);

        Assert.Equal(AiGeofenceDraftStreamState.Idle, vm.State);
        Assert.Equal(string.Empty, vm.AssistantText);
        Assert.False(vm.HasOutput);
        Assert.False(vm.IsThinking);
        Assert.False(vm.IsError);
        Assert.False(vm.HasDraft);
    }

    [Theory]
    [InlineData(null, false)]
    [InlineData(0L, false)]
    [InlineData(-3L, false)]
    [InlineData(7L, true)]
    public void CanStart_requires_a_positive_location(long? locationId, bool expected)
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On, locationId);

        Assert.Equal(expected, vm.CanStart);
        Assert.Equal(expected, vm.IsActionEnabled);
    }

    [Fact]
    public void Setting_location_reevaluates_can_start()
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On, locationId: null);
        Assert.False(vm.CanStart);

        vm.LocationId = 42;

        Assert.True(vm.CanStart);
        Assert.True(vm.IsActionEnabled);
    }

    // ── view-model: stream lifecycle (web useAiStream) ───────────────────────────────────────────────────

    [Fact]
    public async Task Start_streams_deltas_into_text_then_completes_done()
    {
        var transport = new FakeDraftTransport(
            AiGeofenceDraftStreamEvent.Delta("Proposing "),
            AiGeofenceDraftStreamEvent.Delta("a geofence."),
            AiGeofenceDraftStreamEvent.Done());
        using var vm = Ready(transport);
        bool thinkingAtStreamStart = false;
        vm.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(vm.State) && vm.State == AiGeofenceDraftStreamState.Streaming)
            {
                thinkingAtStreamStart = vm.IsThinking;
            }
        };

        await vm.StartAsync();

        Assert.Equal("Proposing a geofence.", vm.AssistantText);
        Assert.Equal(AiGeofenceDraftStreamState.Done, vm.State);
        Assert.True(thinkingAtStreamStart);
        Assert.False(vm.IsThinking);
        Assert.Equal(1, transport.OpenCount);
        Assert.Equal(7, transport.LastRequest?.LocationId);
    }

    [Fact]
    public async Task Start_marks_done_when_the_stream_closes_without_a_terminal_event()
    {
        var transport = new FakeDraftTransport(AiGeofenceDraftStreamEvent.Delta("partial"));
        using var vm = Ready(transport);

        await vm.StartAsync();

        Assert.Equal(AiGeofenceDraftStreamState.Done, vm.State);
        Assert.Equal("partial", vm.AssistantText);
    }

    [Fact]
    public async Task Start_is_a_no_op_without_a_resolved_location()
    {
        var transport = new FakeDraftTransport(AiGeofenceDraftStreamEvent.Done());
        using var vm = NewViewModel(StaticAiFeatureGate.On, locationId: null, transport);

        await vm.StartAsync();

        Assert.Equal(AiGeofenceDraftStreamState.Idle, vm.State);
        Assert.Equal(0, transport.OpenCount);
    }

    [Fact]
    public async Task Start_is_a_no_op_when_the_gate_is_closed()
    {
        var transport = new FakeDraftTransport(AiGeofenceDraftStreamEvent.Done());
        using var vm = NewViewModel(StaticAiFeatureGate.Off, locationId: 7, transport);

        await vm.StartAsync();

        Assert.Equal(AiGeofenceDraftStreamState.Idle, vm.State);
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
        Assert.Equal(AiGeofenceDraftStreamState.Streaming, vm.State);
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
            AiGeofenceDraftStreamEvent.Done());
        using var vm = Ready(transport);

        await vm.StartAsync();

        Assert.True(vm.HasDraft);
        Assert.Equal("Home charger", vm.DraftName);
        Assert.Equal("Radius: 120 m", vm.DraftRadiusText);
        Assert.False(vm.IsDraftRejected);
        Assert.False(vm.HasDraftValidationError);
        Assert.True(vm.IsApplyEnabled);
    }

    [Fact]
    public async Task Captured_draft_rounds_the_radius_for_display()
    {
        const string json =
            "{\"draft\":{\"location_id\":1,\"vehicle_id\":2,\"proposed_name\":\"x\"," +
            "\"radius_m\":119.6,\"centroid_lat\":0,\"centroid_lon\":0},\"status\":\"ok\"}";
        var transport = new FakeDraftTransport(DraftEvent(json), AiGeofenceDraftStreamEvent.Done());
        using var vm = Ready(transport);

        await vm.StartAsync();

        Assert.Equal("Radius: 120 m", vm.DraftRadiusText);
    }

    [Fact]
    public async Task Rejected_draft_shows_the_validator_verdict_and_disables_apply()
    {
        var transport = new FakeDraftTransport(
            DraftEvent(RejectedDraftJson),
            AiGeofenceDraftStreamEvent.Done());
        using var vm = Ready(transport);

        await vm.StartAsync();

        Assert.True(vm.HasDraft);
        Assert.Equal("Too small", vm.DraftName);
        Assert.True(vm.IsDraftRejected);
        Assert.True(vm.HasDraftValidationError);
        Assert.Equal("radius below minimum", vm.DraftValidationError);
        Assert.False(vm.IsApplyEnabled);
    }

    [Fact]
    public async Task Tool_result_for_another_tool_is_ignored()
    {
        var transport = new FakeDraftTransport(
            DraftEvent(ValidDraftJson, name: "some_other_tool"),
            AiGeofenceDraftStreamEvent.Done());
        using var vm = Ready(transport);

        await vm.StartAsync();

        Assert.False(vm.HasDraft);
    }

    [Fact]
    public async Task Failed_tool_result_is_ignored()
    {
        var transport = new FakeDraftTransport(
            AiGeofenceDraftStreamEvent.ToolResult(
                AISuggestNewGeofencesRegistration.DraftToolName, ok: false, null),
            AiGeofenceDraftStreamEvent.Done());
        using var vm = Ready(transport);

        await vm.StartAsync();

        Assert.False(vm.HasDraft);
    }

    [Fact]
    public async Task Apply_invokes_the_callback_with_the_accepted_draft()
    {
        GeofenceDraftApplication? applied = null;
        var transport = new FakeDraftTransport(DraftEvent(ValidDraftJson), AiGeofenceDraftStreamEvent.Done());
        using var vm = new AISuggestNewGeofencesViewModel(
            transport, StaticAiFeatureGate.On, Localizer, locationId: 7, currentName: null, onApplyDraft: a => applied = a);

        await vm.StartAsync();
        vm.Apply();

        Assert.NotNull(applied);
        Assert.Equal("Home charger", applied!.Value.Name);
        Assert.Equal(37.422, applied.Value.Latitude);
        Assert.Equal(-122.084, applied.Value.Longitude);
        Assert.Equal(120, applied.Value.Radius);
    }

    [Fact]
    public async Task Apply_is_a_no_op_for_a_rejected_draft()
    {
        int applied = 0;
        var transport = new FakeDraftTransport(DraftEvent(RejectedDraftJson), AiGeofenceDraftStreamEvent.Done());
        using var vm = new AISuggestNewGeofencesViewModel(
            transport, StaticAiFeatureGate.On, Localizer, locationId: 7, currentName: null, onApplyDraft: _ => applied++);

        await vm.StartAsync();
        vm.Apply();

        Assert.Equal(0, applied);
    }

    [Fact]
    public async Task Changing_location_clears_a_captured_draft()
    {
        var transport = new FakeDraftTransport(DraftEvent(ValidDraftJson), AiGeofenceDraftStreamEvent.Done());
        using var vm = Ready(transport);
        await vm.StartAsync();
        Assert.True(vm.HasDraft);

        vm.LocationId = 99;

        Assert.False(vm.HasDraft);
    }

    [Fact]
    public async Task New_run_clears_the_prior_draft()
    {
        var transport = new FakeDraftTransport(DraftEvent(ValidDraftJson), AiGeofenceDraftStreamEvent.Done());
        using var vm = Ready(transport);
        await vm.StartAsync();
        Assert.True(vm.HasDraft);

        transport.Reset(AiGeofenceDraftStreamEvent.Delta("thinking"));
        await vm.StartAsync();

        Assert.False(vm.HasDraft);
    }

    // ── view-model: error / offline / confirm / cancel ───────────────────────────────────────────────────

    [Fact]
    public async Task Error_frame_moves_to_the_error_surface_with_the_helix_message()
    {
        var transport = new FakeDraftTransport(
            AiGeofenceDraftStreamEvent.Error("rate_limited", AiGeofenceDraftErrorReason.Stream));
        using var vm = Ready(transport);

        await vm.StartAsync();

        Assert.Equal(AiGeofenceDraftStreamState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(vm.IsOffline);
        Assert.Equal("Helix error: rate_limited", vm.DisplayErrorText);
    }

    [Fact]
    public async Task Network_failure_shows_the_offline_message()
    {
        var transport = new FakeDraftTransport(
            AiGeofenceDraftStreamEvent.Error("stream_network", AiGeofenceDraftErrorReason.Network));
        using var vm = Ready(transport);

        await vm.StartAsync();

        Assert.Equal(AiGeofenceDraftStreamState.Error, vm.State);
        Assert.True(vm.IsOffline);
        Assert.Equal(AISuggestNewGeofencesRegistration.OfflineFallback, vm.DisplayErrorText);
    }

    [Fact]
    public async Task Confirm_request_frame_pauses_the_stream_and_blocks_canStart()
    {
        var transport = new FakeDraftTransport(AiGeofenceDraftStreamEvent.ConfirmRequest());
        using var vm = Ready(transport);

        await vm.StartAsync();

        Assert.Equal(AiGeofenceDraftStreamState.PausedConfirm, vm.State);
        Assert.False(vm.CanStart);
    }

    [Fact]
    public async Task Cancel_returns_an_in_flight_stream_to_idle()
    {
        var transport = new FakeDraftTransport(AiGeofenceDraftStreamEvent.Delta("started")) { HoldOpen = true };
        using var vm = Ready(transport);

        var run = vm.StartAsync();
        vm.Cancel();
        await run;

        Assert.Equal(AiGeofenceDraftStreamState.Idle, vm.State);
    }

    [Fact]
    public async Task Error_then_retry_clears_the_prior_error()
    {
        var transport = new FakeDraftTransport(
            AiGeofenceDraftStreamEvent.Error("boom", AiGeofenceDraftErrorReason.Stream));
        using var vm = Ready(transport);
        await vm.StartAsync();
        Assert.Equal(AiGeofenceDraftStreamState.Error, vm.State);

        transport.Reset(AiGeofenceDraftStreamEvent.Delta("recovered"), AiGeofenceDraftStreamEvent.Done());
        await vm.StartAsync();

        Assert.Equal(AiGeofenceDraftStreamState.Done, vm.State);
        Assert.Equal("recovered", vm.AssistantText);
        Assert.False(vm.IsError);
    }

    // ── view-model: current-label context line (web currentName) ─────────────────────────────────────────

    [Fact]
    public void Current_name_is_absent_by_default()
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On, locationId: 7);

        Assert.False(vm.HasCurrentName);
        Assert.Equal(string.Empty, vm.CurrentName);
    }

    [Fact]
    public void Current_name_is_surfaced_when_supplied()
    {
        using var vm = new AISuggestNewGeofencesViewModel(
            new FakeDraftTransport(), StaticAiFeatureGate.On, Localizer, locationId: 7, currentName: "37.42, -122.08");

        Assert.True(vm.HasCurrentName);
        Assert.Equal("37.42, -122.08", vm.CurrentName);
        Assert.Equal("Current label", vm.CurrentLabel);
    }

    // ── view-model: i18n + accessibility labels ──────────────────────────────────────────────────────────

    [Fact]
    public void Labels_resolve_to_the_web_fallback_copy()
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On, locationId: 7);

        Assert.Equal("Suggest a geofence for this location", vm.Title);
        Assert.Equal("Suggest geofence", vm.SuggestButtonLabel);
        Assert.Equal("Helix", vm.BadgeLabel);
        Assert.Equal("Ask Helix", vm.AskHelixLabel);
        Assert.Equal("Proposed geofence", vm.ProposalLabel);
        Assert.Equal("Radius", vm.RadiusLabel);
        Assert.Equal("Apply to form", vm.ApplyButtonLabel);
        Assert.Equal("Proposal rejected by validator", vm.RejectedLabel);
        Assert.Equal("Current label", vm.CurrentLabel);
        Assert.Contains("typed geofence draft", vm.Description, StringComparison.Ordinal);
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
        using var vm = NewViewModel(StaticAiFeatureGate.On, locationId: 7);

        Assert.Equal("Ask Helix \u00b7 Suggest geofence", vm.ActionAutomationName);
    }

    // ── helpers ──────────────────────────────────────────────────────────────────────────────────────────

    private static JsonElement Element(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }

    private static AiGeofenceDraftStreamEvent DraftEvent(
        string envelopeJson,
        bool ok = true,
        string name = "draft_geofence") =>
        AiGeofenceDraftStreamEvent.ToolResult(name, ok, Element(envelopeJson));

    private static AISuggestNewGeofencesViewModel NewViewModel(
        IAiFeatureGate gate,
        long? locationId,
        IAiGeofenceDraftStreamTransport? transport = null) =>
        new(transport ?? new FakeDraftTransport(), gate, Localizer, locationId);

    /// <summary>A gate-on, location-scoped view-model that satisfies <c>canStart</c>.</summary>
    private static AISuggestNewGeofencesViewModel Ready(IAiGeofenceDraftStreamTransport transport) =>
        new(transport, StaticAiFeatureGate.On, Localizer, locationId: 7);

    /// <summary>
    /// A scripted <see cref="IAiGeofenceDraftStreamTransport"/> for headless lifecycle tests: yields a fixed
    /// event sequence and (optionally) holds the stream open afterwards so cancel / duplicate-start paths are
    /// exercised deterministically. Records the open count and the last request body.
    /// </summary>
    private sealed class FakeDraftTransport : IAiGeofenceDraftStreamTransport
    {
        private AiGeofenceDraftStreamEvent[] _events;
        private int _openCount;

        public FakeDraftTransport(params AiGeofenceDraftStreamEvent[] events) => _events = events;

        /// <summary>When true the stream stays open after the scripted events until cancelled.</summary>
        public bool HoldOpen { get; init; }

        public int OpenCount => Volatile.Read(ref _openCount);

        public AiGeofenceDraftRequest? LastRequest { get; private set; }

        public void Reset(params AiGeofenceDraftStreamEvent[] events) => _events = events;

        public async IAsyncEnumerable<AiGeofenceDraftStreamEvent> StreamAsync(
            AiGeofenceDraftRequest request,
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
