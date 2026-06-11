using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Settings;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the natural-language Grafana-panel drafter surface's UI-thread-free logic — the SSE
/// frame parser (the native port of useAiStream's parseSSEFrame/toTypedEvent, including the tool_result data
/// capture), the typed draft-envelope narrowing (the port of parseGrafanaPanelDraft, including the status==='ok'
/// gate), the registration metadata + AI feature-registry membership, the PII-safe diagnostics, and the
/// view-model's gate / canStart / stream lifecycle state machine (idle → streaming → done / error,
/// duplicate-start no-op, cancel → idle, offline classification, draft capture and the propose-only apply
/// handoff). Mirrors the web spec (web/src/components/ai/AINLGrafanaPanel.tsx + AIFeatureCard.tsx +
/// useAiStream.ts). The WinUI view (shared-surfaces/AINLGrafanaPanel.cs) is exercised by the app build.
/// </summary>
public sealed class AINLGrafanaPanelTests
{
    private const string ValidDraftJson =
        "{\"status\":\"ok\",\"draft\":{\"prompt\":\"daily drives\"," +
        "\"rationale\":\"A daily time series of distance driven this month.\"," +
        "\"panel\":{\"title\":\"Daily distance\",\"type\":\"timeseries\"," +
        "\"datasource\":{\"type\":\"postgres\",\"uid\":\"ds-pg\"}," +
        "\"targets\":[{\"ref_id\":\"A\",\"raw_sql\":\"SELECT day, meters FROM drives\",\"format\":\"time_series\"}]," +
        "\"grid_pos\":{\"x\":0,\"y\":0,\"w\":12,\"h\":8}}," +
        "\"referenced_tables\":[\"drives\"]}}";

    private const string RejectedDraftJson =
        "{\"status\":\"invalid\",\"draft\":{\"prompt\":\"daily drives\",\"rationale\":\"r\"," +
        "\"panel\":{\"title\":\"x\",\"type\":\"timeseries\",\"datasource\":{\"type\":\"postgres\",\"uid\":\"u\"}," +
        "\"targets\":[],\"grid_pos\":{\"x\":0,\"y\":0,\"w\":1,\"h\":1}},\"referenced_tables\":[]}}";

    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // ── registration + registry membership ───────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("AINLGrafanaPanel", AINLGrafanaPanelRegistration.Slug);

    [Fact]
    public void Feature_id_is_present_in_the_canonical_registry()
    {
        Assert.True(AINLGrafanaPanelRegistration.IsRegisteredFeature(AINLGrafanaPanelRegistration.FeatureId));
        Assert.Contains(AiFeatureRegistry.Features, m => m.Id == AINLGrafanaPanelRegistration.FeatureId);
    }

    [Fact]
    public void Unknown_feature_id_is_not_registered() =>
        Assert.False(AINLGrafanaPanelRegistration.IsRegisteredFeature("not-a-real-feature"));

    [Fact]
    public void Draft_path_is_the_web_endpoint_without_the_version_prefix() =>
        Assert.Equal("/ai/power/grafana-panel/draft", AINLGrafanaPanelRegistration.DraftPath);

    [Fact]
    public void Draft_tool_name_matches_the_backend_tool() =>
        Assert.Equal("draft_grafana_panel", AINLGrafanaPanelRegistration.DraftToolName);

    [Fact]
    public void Root_automation_id_matches_the_web_off_mode_test_id() =>
        Assert.Equal("ai-feature-nl-grafana-panel-root", AINLGrafanaPanelRegistration.RootAutomationId);

    // ── diagnostics: view.opened, PII-safe ───────────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new AINLGrafanaPanelDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=AINLGrafanaPanel", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_without_a_sink_still_count_opens()
    {
        var diagnostics = new AINLGrafanaPanelDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    // ── SSE parser (web parseSSEFrame / toTypedEvent) ────────────────────────────────────────────────────

    [Fact]
    public void Parser_reads_a_delta_frame()
    {
        var ev = AiGrafanaDraftSseParser.ParseFrame("event: delta\ndata: {\"text\":\"Drafting \"}");

        Assert.NotNull(ev);
        Assert.Equal(AiGrafanaDraftEventKind.Delta, ev!.Kind);
        Assert.Equal("Drafting ", ev.Text);
    }

    [Fact]
    public void Parser_reads_a_done_frame()
    {
        var ev = AiGrafanaDraftSseParser.ParseFrame("event: done\ndata: {\"finish_reason\":\"stop\",\"usage\":{\"in\":1,\"out\":2}}");

        Assert.NotNull(ev);
        Assert.Equal(AiGrafanaDraftEventKind.Done, ev!.Kind);
    }

    [Fact]
    public void Parser_reads_an_error_frame_with_its_message()
    {
        var ev = AiGrafanaDraftSseParser.ParseFrame("event: error\ndata: {\"message\":\"rate_limited\"}");

        Assert.NotNull(ev);
        Assert.Equal(AiGrafanaDraftEventKind.Error, ev!.Kind);
        Assert.Equal("rate_limited", ev.Message);
        Assert.Equal(AiGrafanaDraftErrorReason.Stream, ev.ErrorReason);
    }

    [Fact]
    public void Parser_defaults_an_error_message_to_unknown_when_absent()
    {
        var ev = AiGrafanaDraftSseParser.ParseFrame("event: error\ndata: {\"reason\":\"cost_cap\"}");

        Assert.NotNull(ev);
        Assert.Equal(AiGrafanaDraftEventKind.Error, ev!.Kind);
        Assert.Equal("unknown", ev.Message);
    }

    [Fact]
    public void Parser_reads_a_tool_call_frame_and_ignores_its_payload()
    {
        var call = AiGrafanaDraftSseParser.ParseFrame("event: tool_call\ndata: {\"id\":\"1\",\"name\":\"draft_grafana_panel\"}");

        Assert.NotNull(call);
        Assert.Equal(AiGrafanaDraftEventKind.ToolCall, call!.Kind);
    }

    [Fact]
    public void Parser_reads_a_tool_result_frame_and_captures_its_data_payload()
    {
        var ev = AiGrafanaDraftSseParser.ParseFrame(
            "event: tool_result\ndata: {\"id\":\"1\",\"name\":\"draft_grafana_panel\",\"ok\":true,\"data\":" +
            ValidDraftJson + "}");

        Assert.NotNull(ev);
        Assert.Equal(AiGrafanaDraftEventKind.ToolResult, ev!.Kind);
        Assert.Equal("draft_grafana_panel", ev.ToolName);
        Assert.True(ev.ToolOk);
        Assert.NotNull(ev.ToolData);
        Assert.True(ev.ToolData!.Value.TryGetProperty("status", out _));
    }

    [Fact]
    public void Parser_reads_a_failed_tool_result_with_no_data()
    {
        var ev = AiGrafanaDraftSseParser.ParseFrame(
            "event: tool_result\ndata: {\"id\":\"1\",\"name\":\"draft_grafana_panel\",\"ok\":false}");

        Assert.NotNull(ev);
        Assert.Equal(AiGrafanaDraftEventKind.ToolResult, ev!.Kind);
        Assert.False(ev.ToolOk);
        Assert.Null(ev.ToolData);
    }

    [Fact]
    public void Parser_reads_a_confirm_request_frame()
    {
        var ev = AiGrafanaDraftSseParser.ParseFrame(
            "event: confirm_request\ndata: {\"continuation_id\":\"c\",\"tool\":\"t\",\"summary\":\"s\"}");

        Assert.NotNull(ev);
        Assert.Equal(AiGrafanaDraftEventKind.ConfirmRequest, ev!.Kind);
    }

    [Fact]
    public void Parser_ignores_comment_lines()
    {
        var ev = AiGrafanaDraftSseParser.ParseFrame(": keep-alive\nevent: delta\ndata: {\"text\":\"x\"}");

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
        Assert.Null(AiGrafanaDraftSseParser.ParseFrame(frame));

    [Fact]
    public void Parser_supports_no_space_after_field_name()
    {
        var ev = AiGrafanaDraftSseParser.ParseFrame("event:delta\ndata:{\"text\":\"y\"}");

        Assert.NotNull(ev);
        Assert.Equal("y", ev!.Text);
    }

    // ── draft envelope narrowing (web parseGrafanaPanelDraft) ────────────────────────────────────────────

    [Fact]
    public void Draft_parse_accepts_a_well_formed_ok_envelope()
    {
        Assert.True(GrafanaPanelDraft.TryParse(Element(ValidDraftJson), out var draft));

        Assert.NotNull(draft);
        Assert.Equal("daily drives", draft!.Prompt);
        Assert.Equal("A daily time series of distance driven this month.", draft.Rationale);
        Assert.Equal("Daily distance", draft.Panel.Title);
        Assert.Equal("timeseries", draft.Panel.Type);
        Assert.Equal("postgres", draft.Panel.Datasource.Type);
        Assert.Equal("ds-pg", draft.Panel.Datasource.Uid);
        var target = Assert.Single(draft.Panel.Targets);
        Assert.Equal("A", target.RefId);
        Assert.Equal("SELECT day, meters FROM drives", target.RawSql);
        Assert.Equal("time_series", target.Format);
        Assert.Null(target.Expr);
        Assert.Equal(0, draft.Panel.GridPos.X);
        Assert.Equal(0, draft.Panel.GridPos.Y);
        Assert.Equal(12, draft.Panel.GridPos.W);
        Assert.Equal(8, draft.Panel.GridPos.H);
        Assert.Equal(new[] { "drives" }, draft.ReferencedTables);
    }

    [Fact]
    public void Draft_parse_rejects_a_non_ok_envelope()
    {
        // web parseGrafanaPanelDraft: obj.status !== 'ok' → return null (no draft, no apply action).
        Assert.False(GrafanaPanelDraft.TryParse(Element(RejectedDraftJson), out var draft));
        Assert.Null(draft);
    }

    [Fact]
    public void Draft_parse_defaults_missing_targets_to_empty()
    {
        const string json =
            "{\"status\":\"ok\",\"draft\":{\"prompt\":\"p\",\"rationale\":\"r\"," +
            "\"panel\":{\"title\":\"t\",\"type\":\"stat\",\"datasource\":{\"type\":\"prometheus\",\"uid\":\"u\"}," +
            "\"grid_pos\":{\"x\":1,\"y\":2,\"w\":3,\"h\":4}}}}";

        Assert.True(GrafanaPanelDraft.TryParse(Element(json), out var draft));
        Assert.NotNull(draft);
        Assert.Empty(draft!.Panel.Targets);
        Assert.Empty(draft.ReferencedTables);
    }

    [Fact]
    public void Draft_parse_drops_a_target_missing_its_ref_id()
    {
        const string json =
            "{\"status\":\"ok\",\"draft\":{\"prompt\":\"p\",\"rationale\":\"r\"," +
            "\"panel\":{\"title\":\"t\",\"type\":\"stat\",\"datasource\":{\"type\":\"prometheus\",\"uid\":\"u\"}," +
            "\"targets\":[{\"expr\":\"up\"},{\"ref_id\":\"B\",\"expr\":\"rate(x[5m])\"}]," +
            "\"grid_pos\":{\"x\":0,\"y\":0,\"w\":6,\"h\":6}}}}";

        Assert.True(GrafanaPanelDraft.TryParse(Element(json), out var draft));
        Assert.NotNull(draft);
        var target = Assert.Single(draft!.Panel.Targets);
        Assert.Equal("B", target.RefId);
        Assert.Equal("rate(x[5m])", target.Expr);
    }

    [Theory]
    [InlineData("{\"draft\":{\"prompt\":\"p\",\"rationale\":\"r\",\"panel\":{\"title\":\"t\",\"type\":\"stat\",\"datasource\":{\"type\":\"a\",\"uid\":\"b\"},\"grid_pos\":{\"x\":0,\"y\":0,\"w\":1,\"h\":1}}}}")] // no status
    [InlineData("{\"status\":\"ok\"}")] // no draft
    [InlineData("{\"status\":\"ok\",\"draft\":{\"rationale\":\"r\",\"panel\":{\"title\":\"t\",\"type\":\"stat\",\"datasource\":{\"type\":\"a\",\"uid\":\"b\"},\"grid_pos\":{\"x\":0,\"y\":0,\"w\":1,\"h\":1}}}}")] // no prompt
    [InlineData("{\"status\":\"ok\",\"draft\":{\"prompt\":\"p\",\"panel\":{\"title\":\"t\",\"type\":\"stat\",\"datasource\":{\"type\":\"a\",\"uid\":\"b\"},\"grid_pos\":{\"x\":0,\"y\":0,\"w\":1,\"h\":1}}}}")] // no rationale
    [InlineData("{\"status\":\"ok\",\"draft\":{\"prompt\":\"p\",\"rationale\":\"r\"}}")] // no panel
    [InlineData("{\"status\":\"ok\",\"draft\":{\"prompt\":\"p\",\"rationale\":\"r\",\"panel\":{\"type\":\"stat\",\"datasource\":{\"type\":\"a\",\"uid\":\"b\"},\"grid_pos\":{\"x\":0,\"y\":0,\"w\":1,\"h\":1}}}}")] // no panel title
    [InlineData("{\"status\":\"ok\",\"draft\":{\"prompt\":\"p\",\"rationale\":\"r\",\"panel\":{\"title\":\"t\",\"type\":\"stat\",\"grid_pos\":{\"x\":0,\"y\":0,\"w\":1,\"h\":1}}}}")] // no datasource
    [InlineData("{\"status\":\"ok\",\"draft\":{\"prompt\":\"p\",\"rationale\":\"r\",\"panel\":{\"title\":\"t\",\"type\":\"stat\",\"datasource\":{\"type\":\"a\"},\"grid_pos\":{\"x\":0,\"y\":0,\"w\":1,\"h\":1}}}}")] // datasource missing uid
    [InlineData("{\"status\":\"ok\",\"draft\":{\"prompt\":\"p\",\"rationale\":\"r\",\"panel\":{\"title\":\"t\",\"type\":\"stat\",\"datasource\":{\"type\":\"a\",\"uid\":\"b\"}}}}")] // no grid_pos
    [InlineData("{\"status\":\"ok\",\"draft\":{\"prompt\":\"p\",\"rationale\":\"r\",\"panel\":{\"title\":\"t\",\"type\":\"stat\",\"datasource\":{\"type\":\"a\",\"uid\":\"b\"},\"grid_pos\":{\"x\":\"0\",\"y\":0,\"w\":1,\"h\":1}}}}")] // grid_pos.x not a number
    public void Draft_parse_rejects_a_malformed_envelope(string json)
    {
        Assert.False(GrafanaPanelDraft.TryParse(Element(json), out var draft));
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

    // ── view-model: initial state + canStart (web hasPrompt) ─────────────────────────────────────────────

    [Fact]
    public void Initial_state_is_idle_with_no_output_and_no_draft()
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On);

        Assert.Equal(AiGrafanaDraftStreamState.Idle, vm.State);
        Assert.Equal(string.Empty, vm.AssistantText);
        Assert.False(vm.HasOutput);
        Assert.False(vm.IsThinking);
        Assert.False(vm.IsError);
        Assert.False(vm.HasDraft);
        Assert.False(vm.CanStart);
    }

    [Theory]
    [InlineData("", false)]
    [InlineData("   ", false)]
    [InlineData("show me daily drives", true)]
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

        vm.Prompt = "draft me a panel";

        Assert.True(vm.CanStart);
        Assert.True(vm.IsActionEnabled);
    }

    // ── view-model: stream lifecycle (web useAiStream) ───────────────────────────────────────────────────

    [Fact]
    public async Task Start_streams_deltas_into_text_then_completes_done()
    {
        var transport = new FakeGrafanaDraftTransport(
            AiGrafanaDraftStreamEvent.Delta("Proposing "),
            AiGrafanaDraftStreamEvent.Delta("a panel."),
            AiGrafanaDraftStreamEvent.Done());
        using var vm = Ready(transport);
        bool thinkingAtStreamStart = false;
        vm.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(vm.State) && vm.State == AiGrafanaDraftStreamState.Streaming)
            {
                thinkingAtStreamStart = vm.IsThinking;
            }
        };

        await vm.StartAsync();

        Assert.Equal("Proposing a panel.", vm.AssistantText);
        Assert.Equal(AiGrafanaDraftStreamState.Done, vm.State);
        Assert.True(thinkingAtStreamStart);
        Assert.False(vm.IsThinking);
        Assert.Equal(1, transport.OpenCount);
        Assert.Equal("show me daily drives", transport.LastRequest?.Prompt);
    }

    [Fact]
    public async Task Start_marks_done_when_the_stream_closes_without_a_terminal_event()
    {
        var transport = new FakeGrafanaDraftTransport(AiGrafanaDraftStreamEvent.Delta("partial"));
        using var vm = Ready(transport);

        await vm.StartAsync();

        Assert.Equal(AiGrafanaDraftStreamState.Done, vm.State);
        Assert.Equal("partial", vm.AssistantText);
    }

    [Fact]
    public async Task Start_trims_the_prompt_in_the_request_body()
    {
        var transport = new FakeGrafanaDraftTransport(AiGrafanaDraftStreamEvent.Done());
        using var vm = NewViewModel(StaticAiFeatureGate.On, transport);
        vm.Prompt = "   show me daily drives   ";

        await vm.StartAsync();

        Assert.Equal("show me daily drives", transport.LastRequest?.Prompt);
    }

    [Fact]
    public async Task Start_is_a_no_op_without_a_prompt()
    {
        var transport = new FakeGrafanaDraftTransport(AiGrafanaDraftStreamEvent.Done());
        using var vm = NewViewModel(StaticAiFeatureGate.On, transport);

        await vm.StartAsync();

        Assert.Equal(AiGrafanaDraftStreamState.Idle, vm.State);
        Assert.Equal(0, transport.OpenCount);
    }

    [Fact]
    public async Task Start_is_a_no_op_when_the_gate_is_closed()
    {
        var transport = new FakeGrafanaDraftTransport(AiGrafanaDraftStreamEvent.Done());
        using var vm = NewViewModel(StaticAiFeatureGate.Off, transport);
        vm.Prompt = "a prompt";

        await vm.StartAsync();

        Assert.Equal(AiGrafanaDraftStreamState.Idle, vm.State);
        Assert.Equal(0, transport.OpenCount);
    }

    [Fact]
    public async Task Duplicate_start_while_streaming_is_a_no_op()
    {
        var transport = new FakeGrafanaDraftTransport { HoldOpen = true };
        using var vm = Ready(transport);

        var first = vm.StartAsync();
        var second = vm.StartAsync();

        await second; // the second call returns immediately without opening a second stream.
        Assert.Equal(AiGrafanaDraftStreamState.Streaming, vm.State);
        Assert.Equal(1, transport.OpenCount);

        vm.Cancel();
        await first;
    }

    // ── view-model: draft capture (web tool_result handler) ──────────────────────────────────────────────

    [Fact]
    public async Task Tool_result_with_an_accepted_envelope_is_captured_as_a_draft()
    {
        var transport = new FakeGrafanaDraftTransport(
            DraftEvent(ValidDraftJson),
            AiGrafanaDraftStreamEvent.Done());
        using var vm = Ready(transport);

        await vm.StartAsync();

        Assert.True(vm.HasDraft);
        Assert.NotNull(vm.Draft);
        Assert.Equal("Daily distance", vm.Draft!.Panel.Title);
        Assert.Equal("Daily distance", vm.DraftPanelTitle);
        Assert.True(vm.IsApplyEnabled);
    }

    [Fact]
    public async Task Tool_result_for_another_tool_is_ignored()
    {
        var transport = new FakeGrafanaDraftTransport(
            DraftEvent(ValidDraftJson, name: "some_other_tool"),
            AiGrafanaDraftStreamEvent.Done());
        using var vm = Ready(transport);

        await vm.StartAsync();

        Assert.False(vm.HasDraft);
    }

    [Fact]
    public async Task Tool_result_with_a_non_ok_envelope_is_not_captured()
    {
        var transport = new FakeGrafanaDraftTransport(
            DraftEvent(RejectedDraftJson),
            AiGrafanaDraftStreamEvent.Done());
        using var vm = Ready(transport);

        await vm.StartAsync();

        Assert.False(vm.HasDraft);
        Assert.False(vm.IsApplyEnabled);
    }

    [Fact]
    public async Task A_new_run_clears_the_prior_captured_draft()
    {
        var transport = new FakeGrafanaDraftTransport(DraftEvent(ValidDraftJson), AiGrafanaDraftStreamEvent.Done());
        using var vm = Ready(transport);
        await vm.StartAsync();
        Assert.True(vm.HasDraft);

        transport.Reset(AiGrafanaDraftStreamEvent.Delta("no panel this time"), AiGrafanaDraftStreamEvent.Done());
        await vm.StartAsync();

        Assert.False(vm.HasDraft);
    }

    // ── view-model: propose-only apply handoff (web handleApply) ─────────────────────────────────────────

    [Fact]
    public async Task Apply_hands_the_captured_draft_to_the_callback()
    {
        GrafanaPanelDraft? applied = null;
        var transport = new FakeGrafanaDraftTransport(DraftEvent(ValidDraftJson), AiGrafanaDraftStreamEvent.Done());
        using var vm = new AINLGrafanaPanelViewModel(transport, StaticAiFeatureGate.On, Localizer, d => applied = d)
        {
            Prompt = "show me daily drives",
        };
        await vm.StartAsync();

        vm.Apply();

        Assert.NotNull(applied);
        Assert.Equal("Daily distance", applied!.Panel.Title);
        Assert.Equal("SELECT day, meters FROM drives", Assert.Single(applied.Panel.Targets).RawSql);
    }

    [Fact]
    public void Apply_is_a_no_op_when_no_draft_is_captured()
    {
        int calls = 0;
        var transport = new FakeGrafanaDraftTransport();
        using var vm = new AINLGrafanaPanelViewModel(transport, StaticAiFeatureGate.On, Localizer, _ => calls++);

        vm.Apply();

        Assert.Equal(0, calls);
    }

    [Fact]
    public async Task Apply_is_disabled_while_a_stream_is_in_flight()
    {
        var transport = new FakeGrafanaDraftTransport(DraftEvent(ValidDraftJson)) { HoldOpen = true };
        GrafanaPanelDraft? applied = null;
        using var vm = new AINLGrafanaPanelViewModel(transport, StaticAiFeatureGate.On, Localizer, d => applied = d)
        {
            Prompt = "show me daily drives",
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
        var transport = new FakeGrafanaDraftTransport(
            AiGrafanaDraftStreamEvent.Error("rate_limited", AiGrafanaDraftErrorReason.Stream));
        using var vm = Ready(transport);

        await vm.StartAsync();

        Assert.Equal(AiGrafanaDraftStreamState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(vm.IsOffline);
        Assert.Equal("Helix error: rate_limited", vm.DisplayErrorText);
    }

    [Fact]
    public async Task Network_failure_shows_the_offline_message()
    {
        var transport = new FakeGrafanaDraftTransport(
            AiGrafanaDraftStreamEvent.Error("stream_network", AiGrafanaDraftErrorReason.Network));
        using var vm = Ready(transport);

        await vm.StartAsync();

        Assert.Equal(AiGrafanaDraftStreamState.Error, vm.State);
        Assert.True(vm.IsOffline);
        Assert.Equal(AINLGrafanaPanelRegistration.OfflineFallback, vm.DisplayErrorText);
    }

    [Fact]
    public async Task Confirm_request_frame_pauses_the_stream()
    {
        var transport = new FakeGrafanaDraftTransport(AiGrafanaDraftStreamEvent.ConfirmRequest());
        using var vm = Ready(transport);

        await vm.StartAsync();

        Assert.Equal(AiGrafanaDraftStreamState.PausedConfirm, vm.State);
    }

    [Fact]
    public async Task Cancel_returns_an_in_flight_stream_to_idle()
    {
        var transport = new FakeGrafanaDraftTransport(AiGrafanaDraftStreamEvent.Delta("started")) { HoldOpen = true };
        using var vm = Ready(transport);

        var run = vm.StartAsync();
        vm.Cancel();
        await run;

        Assert.Equal(AiGrafanaDraftStreamState.Idle, vm.State);
    }

    [Fact]
    public async Task Error_then_retry_clears_the_prior_error()
    {
        var transport = new FakeGrafanaDraftTransport(
            AiGrafanaDraftStreamEvent.Error("boom", AiGrafanaDraftErrorReason.Stream));
        using var vm = Ready(transport);
        await vm.StartAsync();
        Assert.Equal(AiGrafanaDraftStreamState.Error, vm.State);

        transport.Reset(AiGrafanaDraftStreamEvent.Delta("recovered"), AiGrafanaDraftStreamEvent.Done());
        await vm.StartAsync();

        Assert.Equal(AiGrafanaDraftStreamState.Done, vm.State);
        Assert.Equal("recovered", vm.AssistantText);
        Assert.False(vm.IsError);
    }

    // ── view-model: i18n + accessibility labels ──────────────────────────────────────────────────────────

    [Fact]
    public void Labels_resolve_to_the_web_fallback_copy()
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On);

        Assert.Equal("Helix natural-language Grafana panel drafter", vm.Title);
        Assert.Equal("Draft panel", vm.DraftButtonLabel);
        Assert.Equal("Helix", vm.BadgeLabel);
        Assert.Equal("Ask Helix", vm.AskHelixLabel);
        Assert.Equal("Grafana panel request", vm.PromptLabel);
        Assert.Equal("Apply to editor", vm.ApplyButtonLabel);
        Assert.Equal("e.g. show me a daily time series of how far I drove this month", vm.PromptPlaceholder);
        Assert.Contains("plain English", vm.Description, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Action_label_flips_to_the_thinking_copy_while_streaming()
    {
        var transport = new FakeGrafanaDraftTransport { HoldOpen = true };
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

        Assert.Equal("Ask Helix \u00b7 Draft panel", vm.ActionAutomationName);
    }

    // ── helpers ──────────────────────────────────────────────────────────────────────────────────────────

    private static JsonElement Element(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }

    private static AiGrafanaDraftStreamEvent DraftEvent(string json, string name = "draft_grafana_panel") =>
        AiGrafanaDraftStreamEvent.ToolResult(name, true, Element(json));

    private static AINLGrafanaPanelViewModel NewViewModel(
        IAiFeatureGate gate,
        IAiGrafanaDraftStreamTransport? transport = null) =>
        new(transport ?? new FakeGrafanaDraftTransport(), gate, Localizer);

    private static AINLGrafanaPanelViewModel Ready(IAiGrafanaDraftStreamTransport transport) =>
        new(transport, StaticAiFeatureGate.On, Localizer) { Prompt = "show me daily drives" };

    /// <summary>
    /// A scripted <see cref="IAiGrafanaDraftStreamTransport"/> for headless lifecycle tests: yields a fixed
    /// event sequence and (optionally) holds the stream open afterwards so cancel / duplicate-start / apply-
    /// while-streaming paths are exercised deterministically. Records the open count and the last request body.
    /// </summary>
    private sealed class FakeGrafanaDraftTransport : IAiGrafanaDraftStreamTransport
    {
        private AiGrafanaDraftStreamEvent[] _events;
        private int _openCount;

        public FakeGrafanaDraftTransport(params AiGrafanaDraftStreamEvent[] events) => _events = events;

        /// <summary>When true the stream stays open after the scripted events until cancelled.</summary>
        public bool HoldOpen { get; init; }

        public int OpenCount => Volatile.Read(ref _openCount);

        public AiGrafanaDraftRequest? LastRequest { get; private set; }

        public void Reset(params AiGrafanaDraftStreamEvent[] events) => _events = events;

        public async IAsyncEnumerable<AiGrafanaDraftStreamEvent> StreamAsync(
            AiGrafanaDraftRequest request,
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
