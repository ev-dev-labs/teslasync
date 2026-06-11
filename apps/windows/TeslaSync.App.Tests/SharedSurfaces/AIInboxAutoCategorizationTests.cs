using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Settings;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the inbox auto-categorization surface's UI-thread-free logic — the SSE frame parser
/// (the native port of useAiStream's parseSSEFrame/toTypedEvent, extended to keep the tool_result payload), the
/// <c>draft_alert_categories</c> bucket validator (the native port of the web onEvent loop), the registration
/// metadata + AI feature-registry membership, the PII-safe diagnostics, the request-body omit-empty contract,
/// and the view-model's gate / canStart / stream lifecycle / proposal-capture / apply state machine. Mirrors the
/// web spec (web/src/components/ai/AIInboxAutoCategorization.tsx + AIFeatureCard.tsx + useAiStream.ts). The WinUI
/// view (shared-surfaces/AIInboxAutoCategorization.cs) is exercised by the app build.
/// </summary>
public sealed class AIInboxAutoCategorizationTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // ── registration + registry membership ───────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("AIInboxAutoCategorization", AIInboxAutoCategorizationRegistration.Slug);

    [Fact]
    public void Feature_id_is_present_in_the_canonical_registry()
    {
        Assert.True(AIInboxAutoCategorizationRegistration.IsRegisteredFeature(
            AIInboxAutoCategorizationRegistration.FeatureId));
        Assert.Contains(
            AiFeatureRegistry.Features,
            m => m.Id == AIInboxAutoCategorizationRegistration.FeatureId);
    }

    [Fact]
    public void Unknown_feature_id_is_not_registered() =>
        Assert.False(AIInboxAutoCategorizationRegistration.IsRegisteredFeature("not-a-real-feature"));

    [Fact]
    public void Categorize_path_is_the_web_endpoint_without_the_version_prefix() =>
        Assert.Equal("/ai/alerts/inbox/categorize", AIInboxAutoCategorizationRegistration.CategorizePath);

    [Fact]
    public void Categories_tool_name_matches_the_web_tool() =>
        Assert.Equal("draft_alert_categories", AIInboxAutoCategorizationRegistration.CategoriesToolName);

    // ── diagnostics: view.opened, PII-safe ───────────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new AIInboxAutoCategorizationDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=AIInboxAutoCategorization", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_without_a_sink_still_count_opens()
    {
        var diagnostics = new AIInboxAutoCategorizationDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    // ── SSE parser (web parseSSEFrame / toTypedEvent) ────────────────────────────────────────────────────

    [Fact]
    public void Parser_reads_a_delta_frame()
    {
        var ev = InboxCategorizationSseParser.ParseFrame("event: delta\ndata: {\"text\":\"Bucketing \"}");

        Assert.NotNull(ev);
        Assert.Equal(InboxCategorizationEventKind.Delta, ev!.Kind);
        Assert.Equal("Bucketing ", ev.Text);
    }

    [Fact]
    public void Parser_reads_a_done_frame()
    {
        var ev = InboxCategorizationSseParser.ParseFrame("event: done\ndata: {\"finish_reason\":\"stop\",\"usage\":{\"in\":1,\"out\":2}}");

        Assert.NotNull(ev);
        Assert.Equal(InboxCategorizationEventKind.Done, ev!.Kind);
    }

    [Fact]
    public void Parser_reads_an_error_frame_with_its_message()
    {
        var ev = InboxCategorizationSseParser.ParseFrame("event: error\ndata: {\"message\":\"rate_limited\"}");

        Assert.NotNull(ev);
        Assert.Equal(InboxCategorizationEventKind.Error, ev!.Kind);
        Assert.Equal("rate_limited", ev.Message);
        Assert.Equal(InboxCategorizationErrorReason.Stream, ev.ErrorReason);
    }

    [Fact]
    public void Parser_defaults_an_error_message_to_unknown_when_absent()
    {
        var ev = InboxCategorizationSseParser.ParseFrame("event: error\ndata: {\"reason\":\"cost_cap\"}");

        Assert.NotNull(ev);
        Assert.Equal(InboxCategorizationEventKind.Error, ev!.Kind);
        Assert.Equal("unknown", ev.Message);
    }

    [Fact]
    public void Parser_reads_a_tool_call_frame_with_its_name()
    {
        var ev = InboxCategorizationSseParser.ParseFrame("event: tool_call\ndata: {\"id\":\"1\",\"name\":\"draft_alert_categories\",\"arguments\":{}}");

        Assert.NotNull(ev);
        Assert.Equal(InboxCategorizationEventKind.ToolCall, ev!.Kind);
        Assert.Equal("draft_alert_categories", ev.ToolName);
    }

    [Fact]
    public void Parser_reads_a_tool_result_frame_and_keeps_its_payload()
    {
        var ev = InboxCategorizationSseParser.ParseFrame(
            "event: tool_result\ndata: {\"id\":\"1\",\"name\":\"draft_alert_categories\",\"ok\":true,\"data\":{\"status\":\"ok\",\"categories\":[{\"category\":\"battery\",\"count\":3}]}}");

        Assert.NotNull(ev);
        Assert.Equal(InboxCategorizationEventKind.ToolResult, ev!.Kind);
        Assert.Equal("draft_alert_categories", ev.ToolName);
        Assert.True(ev.ToolOk);
        Assert.NotNull(ev.ToolData);

        var buckets = CategoryBucketParser.Parse(ev.ToolData);
        var bucket = Assert.Single(buckets);
        Assert.Equal("battery", bucket.Category);
        Assert.Equal(3, bucket.Count);
    }

    [Fact]
    public void Parser_reads_a_failed_tool_result_frame()
    {
        var ev = InboxCategorizationSseParser.ParseFrame(
            "event: tool_result\ndata: {\"id\":\"1\",\"name\":\"draft_alert_categories\",\"ok\":false,\"error\":\"boom\"}");

        Assert.NotNull(ev);
        Assert.Equal(InboxCategorizationEventKind.ToolResult, ev!.Kind);
        Assert.False(ev.ToolOk);
    }

    [Fact]
    public void Parser_reads_a_confirm_request_frame()
    {
        var ev = InboxCategorizationSseParser.ParseFrame(
            "event: confirm_request\ndata: {\"continuation_id\":\"c\",\"tool\":\"t\",\"summary\":\"s\"}");

        Assert.NotNull(ev);
        Assert.Equal(InboxCategorizationEventKind.ConfirmRequest, ev!.Kind);
    }

    [Theory]
    [InlineData("event: delta\ndata: not-json")]
    [InlineData("data: {\"text\":\"x\"}")] // no event line
    [InlineData("event: mystery\ndata: {\"text\":\"x\"}")] // unknown event type
    [InlineData("event: delta\ndata: {\"text\":123}")] // text not a string
    [InlineData("event: tool_call\ndata: {\"id\":\"1\"}")] // missing required name
    [InlineData("event: tool_result\ndata: {\"id\":\"1\",\"name\":\"x\"}")] // missing ok
    public void Parser_returns_null_for_malformed_or_unknown_frames(string frame) =>
        Assert.Null(InboxCategorizationSseParser.ParseFrame(frame));

    [Fact]
    public void Parser_supports_no_space_after_field_name()
    {
        var ev = InboxCategorizationSseParser.ParseFrame("event:delta\ndata:{\"text\":\"y\"}");

        Assert.NotNull(ev);
        Assert.Equal("y", ev!.Text);
    }

    [Fact]
    public void Parser_ignores_comment_lines()
    {
        var ev = InboxCategorizationSseParser.ParseFrame(": keep-alive\nevent: done\ndata: {}");

        Assert.NotNull(ev);
        Assert.Equal(InboxCategorizationEventKind.Done, ev!.Kind);
    }

    // ── CategoryBucketParser (web onEvent bucket-building loop) ───────────────────────────────────────────

    [Fact]
    public void BucketParser_projects_a_full_bucket()
    {
        var buckets = CategoryBucketParser.Parse(Json(
            "{\"status\":\"ok\",\"categories\":[{\"category\":\"charging\",\"count\":5,\"rule_ids\":[9,4],\"sample_titles\":[\"Slow charge\",\"Charge stopped\"]}]}"));

        var bucket = Assert.Single(buckets);
        Assert.Equal("charging", bucket.Category);
        Assert.Equal(5, bucket.Count);
        Assert.Equal(new long[] { 9, 4 }, bucket.RuleIds);
        Assert.Equal(new[] { "Slow charge", "Charge stopped" }, bucket.SampleTitles);
    }

    [Fact]
    public void BucketParser_returns_empty_when_status_is_not_ok() =>
        Assert.Empty(CategoryBucketParser.Parse(Json("{\"status\":\"error\",\"categories\":[{\"category\":\"x\",\"count\":1}]}")));

    [Fact]
    public void BucketParser_returns_empty_when_categories_is_missing() =>
        Assert.Empty(CategoryBucketParser.Parse(Json("{\"status\":\"ok\"}")));

    [Fact]
    public void BucketParser_returns_empty_for_a_non_object_payload() =>
        Assert.Empty(CategoryBucketParser.Parse(Json("\"not-an-object\"")));

    [Fact]
    public void BucketParser_returns_empty_for_a_null_payload() =>
        Assert.Empty(CategoryBucketParser.Parse(null));

    [Fact]
    public void BucketParser_drops_invalid_elements_but_keeps_valid_ones()
    {
        var buckets = CategoryBucketParser.Parse(Json(
            "{\"status\":\"ok\",\"categories\":[" +
            "\"not-an-object\"," +
            "{\"category\":\"\",\"count\":1}," +          // empty category
            "{\"category\":\"tire\",\"count\":-2}," +     // negative count
            "{\"category\":\"climate\",\"count\":\"3\"}," + // count not a number
            "{\"category\":\"security\",\"count\":4}" +   // valid
            "]}"));

        var bucket = Assert.Single(buckets);
        Assert.Equal("security", bucket.Category);
        Assert.Equal(4, bucket.Count);
    }

    [Fact]
    public void BucketParser_keeps_only_positive_rule_ids_and_non_empty_sample_titles()
    {
        var buckets = CategoryBucketParser.Parse(Json(
            "{\"status\":\"ok\",\"categories\":[{\"category\":\"battery\",\"count\":2,\"rule_ids\":[7,0,-1,3],\"sample_titles\":[\"\",\"Low SoC\"]}]}"));

        var bucket = Assert.Single(buckets);
        Assert.Equal(new long[] { 7, 3 }, bucket.RuleIds);
        Assert.Equal(new[] { "Low SoC" }, bucket.SampleTitles);
    }

    // ── request body omit-empty (web useMemo) ────────────────────────────────────────────────────────────

    [Fact]
    public void Request_omits_empty_and_null_fields()
    {
        var json = JsonSerializer.Serialize(
            InboxCategorizationRequest.Create(vehicleId: null, windowDays: null, severities: Array.Empty<string>(), ruleIds: Array.Empty<long>()));

        Assert.Equal("{}", json);
    }

    [Fact]
    public void Request_emits_present_fields_with_snake_case_names()
    {
        var json = JsonSerializer.Serialize(
            InboxCategorizationRequest.Create(vehicleId: 7, windowDays: 14, severities: new[] { "critical" }, ruleIds: new long[] { 3, 9 }));

        Assert.Contains("\"vehicle_id\":7", json, StringComparison.Ordinal);
        Assert.Contains("\"window_days\":14", json, StringComparison.Ordinal);
        Assert.Contains("\"severities\":[\"critical\"]", json, StringComparison.Ordinal);
        Assert.Contains("\"rule_ids\":[3,9]", json, StringComparison.Ordinal);
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

    // ── view-model: initial state + canStart (web canStart) ──────────────────────────────────────────────

    [Fact]
    public void Initial_state_is_idle_with_no_output_and_no_proposal()
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On);

        Assert.Equal(InboxCategorizationStreamState.Idle, vm.State);
        Assert.Equal(string.Empty, vm.OutputText);
        Assert.False(vm.HasOutput);
        Assert.False(vm.HasProposal);
        Assert.False(vm.IsThinking);
        Assert.False(vm.IsError);
        Assert.True(vm.CanStart);
        Assert.True(vm.IsActionEnabled);
        Assert.Empty(vm.AllRuleIds);
        Assert.False(vm.ApplyEnabled);
    }

    // ── view-model: stream lifecycle (web useAiStream) ───────────────────────────────────────────────────

    [Fact]
    public async Task Start_streams_deltas_into_text_then_completes_done()
    {
        var transport = new FakeInboxTransport(
            InboxCategorizationStreamEvent.Delta("Bucketing "),
            InboxCategorizationStreamEvent.Delta("recent alerts."),
            InboxCategorizationStreamEvent.Done());
        using var vm = NewViewModel(StaticAiFeatureGate.On, transport);
        bool thinkingAtStreamStart = false;
        vm.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(vm.State) && vm.State == InboxCategorizationStreamState.Streaming)
            {
                thinkingAtStreamStart = vm.IsThinking;
            }
        };

        await vm.StartCategorizeAsync();

        Assert.Equal("Bucketing recent alerts.", vm.OutputText);
        Assert.Equal(InboxCategorizationStreamState.Done, vm.State);
        Assert.True(thinkingAtStreamStart);
        Assert.False(vm.IsThinking);
        Assert.Equal(1, transport.OpenCount);
    }

    [Fact]
    public async Task Start_captures_the_draft_alert_categories_proposal()
    {
        var transport = new FakeInboxTransport(
            InboxCategorizationStreamEvent.ToolResult(
                "draft_alert_categories",
                true,
                Json("{\"status\":\"ok\",\"categories\":[" +
                     "{\"category\":\"battery\",\"count\":3,\"rule_ids\":[5,2]}," +
                     "{\"category\":\"charging\",\"count\":1,\"rule_ids\":[2,9]}]}")),
            InboxCategorizationStreamEvent.Done());
        using var vm = NewViewModel(StaticAiFeatureGate.On, transport);

        await vm.StartCategorizeAsync();

        Assert.True(vm.HasProposal);
        Assert.Equal(2, vm.Proposal.Count);
        Assert.Equal(new long[] { 2, 5, 9 }, vm.AllRuleIds); // deduplicated + ascending
        Assert.True(vm.ApplyEnabled);
        Assert.Equal(InboxCategorizationStreamState.Done, vm.State);
        Assert.Equal(7, transport.LastRequest?.VehicleId);
    }

    [Fact]
    public async Task Tool_result_with_a_different_name_is_ignored()
    {
        var transport = new FakeInboxTransport(
            InboxCategorizationStreamEvent.ToolResult(
                "validate_alert_category",
                true,
                Json("{\"status\":\"ok\",\"categories\":[{\"category\":\"battery\",\"count\":3}]}")),
            InboxCategorizationStreamEvent.Done());
        using var vm = NewViewModel(StaticAiFeatureGate.On, transport);

        await vm.StartCategorizeAsync();

        Assert.False(vm.HasProposal);
    }

    [Fact]
    public async Task Failed_tool_result_does_not_capture_a_proposal()
    {
        var transport = new FakeInboxTransport(
            InboxCategorizationStreamEvent.ToolResult(
                "draft_alert_categories",
                false,
                Json("{\"status\":\"ok\",\"categories\":[{\"category\":\"battery\",\"count\":3}]}")),
            InboxCategorizationStreamEvent.Done());
        using var vm = NewViewModel(StaticAiFeatureGate.On, transport);

        await vm.StartCategorizeAsync();

        Assert.False(vm.HasProposal);
    }

    [Fact]
    public async Task Start_is_a_no_op_when_the_gate_is_closed()
    {
        var transport = new FakeInboxTransport(InboxCategorizationStreamEvent.Done());
        using var vm = NewViewModel(StaticAiFeatureGate.Off, transport);

        await vm.StartCategorizeAsync();

        Assert.Equal(InboxCategorizationStreamState.Idle, vm.State);
        Assert.Equal(0, transport.OpenCount);
    }

    [Fact]
    public async Task Duplicate_start_while_streaming_is_a_no_op()
    {
        var transport = new FakeInboxTransport { HoldOpen = true };
        using var vm = NewViewModel(StaticAiFeatureGate.On, transport);

        var first = vm.StartCategorizeAsync();
        var second = vm.StartCategorizeAsync();

        await second; // the second call returns immediately without opening a second stream.
        Assert.Equal(InboxCategorizationStreamState.Streaming, vm.State);
        Assert.Equal(1, transport.OpenCount);

        vm.Cancel();
        await first;
    }

    [Fact]
    public async Task Error_frame_moves_to_the_error_surface_with_the_helix_message()
    {
        var transport = new FakeInboxTransport(
            InboxCategorizationStreamEvent.Error("rate_limited", InboxCategorizationErrorReason.Stream));
        using var vm = NewViewModel(StaticAiFeatureGate.On, transport);

        await vm.StartCategorizeAsync();

        Assert.Equal(InboxCategorizationStreamState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(vm.IsOffline);
        Assert.Equal("Helix error: rate_limited", vm.DisplayErrorText);
    }

    [Fact]
    public async Task Network_failure_shows_the_offline_message()
    {
        var transport = new FakeInboxTransport(
            InboxCategorizationStreamEvent.Error("stream_network", InboxCategorizationErrorReason.Network));
        using var vm = NewViewModel(StaticAiFeatureGate.On, transport);

        await vm.StartCategorizeAsync();

        Assert.Equal(InboxCategorizationStreamState.Error, vm.State);
        Assert.True(vm.IsOffline);
        Assert.Equal(AIInboxAutoCategorizationRegistration.OfflineFallback, vm.DisplayErrorText);
    }

    [Fact]
    public async Task Confirm_request_frame_pauses_the_stream_and_blocks_start()
    {
        var transport = new FakeInboxTransport(InboxCategorizationStreamEvent.ConfirmRequest());
        using var vm = NewViewModel(StaticAiFeatureGate.On, transport);

        await vm.StartCategorizeAsync();

        Assert.Equal(InboxCategorizationStreamState.PausedConfirm, vm.State);
        Assert.False(vm.CanStart);
        Assert.False(vm.IsActionEnabled);
    }

    [Fact]
    public async Task Cancel_returns_an_in_flight_stream_to_idle()
    {
        var transport = new FakeInboxTransport(InboxCategorizationStreamEvent.Delta("started")) { HoldOpen = true };
        using var vm = NewViewModel(StaticAiFeatureGate.On, transport);

        var run = vm.StartCategorizeAsync();
        vm.Cancel();
        await run;

        Assert.Equal(InboxCategorizationStreamState.Idle, vm.State);
    }

    [Fact]
    public async Task Error_then_retry_clears_the_prior_error()
    {
        var transport = new FakeInboxTransport(
            InboxCategorizationStreamEvent.Error("boom", InboxCategorizationErrorReason.Stream));
        using var vm = NewViewModel(StaticAiFeatureGate.On, transport);
        await vm.StartCategorizeAsync();
        Assert.Equal(InboxCategorizationStreamState.Error, vm.State);

        transport.Reset(
            InboxCategorizationStreamEvent.ToolResult(
                "draft_alert_categories",
                true,
                Json("{\"status\":\"ok\",\"categories\":[{\"category\":\"noise\",\"count\":2,\"rule_ids\":[1]}]}")),
            InboxCategorizationStreamEvent.Done());
        await vm.StartCategorizeAsync();

        Assert.Equal(InboxCategorizationStreamState.Done, vm.State);
        Assert.True(vm.HasProposal);
        Assert.False(vm.IsError);
    }

    // ── view-model: apply-as-filter (web handleApply) ────────────────────────────────────────────────────

    [Fact]
    public async Task Apply_raises_the_event_with_the_deduplicated_rule_ids()
    {
        var transport = new FakeInboxTransport(
            InboxCategorizationStreamEvent.ToolResult(
                "draft_alert_categories",
                true,
                Json("{\"status\":\"ok\",\"categories\":[{\"category\":\"battery\",\"count\":3,\"rule_ids\":[5,2]},{\"category\":\"tire\",\"count\":1,\"rule_ids\":[2,8]}]}")),
            InboxCategorizationStreamEvent.Done());
        using var vm = NewViewModel(StaticAiFeatureGate.On, transport);
        await vm.StartCategorizeAsync();

        IReadOnlyList<long>? applied = null;
        vm.CategoriesApplied += (_, e) => applied = e.RuleIds;

        vm.ApplyCategories();

        Assert.Equal(new long[] { 2, 5, 8 }, applied);
    }

    [Fact]
    public void Apply_is_a_no_op_when_there_is_nothing_to_apply()
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On);
        bool raised = false;
        vm.CategoriesApplied += (_, _) => raised = true;

        vm.ApplyCategories();

        Assert.False(raised);
    }

    [Fact]
    public async Task Constructor_callback_receives_applied_rule_ids()
    {
        var transport = new FakeInboxTransport();
        IReadOnlyList<long>? applied = null;
        using var vm = new AIInboxAutoCategorizationViewModel(
            transport, StaticAiFeatureGate.On, Localizer, onApplyCategories: ids => applied = ids, vehicleId: 7);

        // Drive a proposal directly through the stream so AllRuleIds is non-empty.
        transport.Reset(
            InboxCategorizationStreamEvent.ToolResult(
                "draft_alert_categories",
                true,
                Json("{\"status\":\"ok\",\"categories\":[{\"category\":\"battery\",\"count\":3,\"rule_ids\":[4]}]}")),
            InboxCategorizationStreamEvent.Done());
        await vm.StartCategorizeAsync();

        vm.ApplyCategories();

        Assert.Equal(new long[] { 4 }, applied);
    }

    // ── view-model: scope-change reset (web cleanup effect) ──────────────────────────────────────────────

    [Fact]
    public async Task Changing_a_scope_input_clears_the_captured_proposal()
    {
        var transport = new FakeInboxTransport(
            InboxCategorizationStreamEvent.ToolResult(
                "draft_alert_categories",
                true,
                Json("{\"status\":\"ok\",\"categories\":[{\"category\":\"battery\",\"count\":3,\"rule_ids\":[5]}]}")),
            InboxCategorizationStreamEvent.Done());
        using var vm = NewViewModel(StaticAiFeatureGate.On, transport);
        await vm.StartCategorizeAsync();
        Assert.True(vm.HasProposal);

        vm.WindowDays = 30;

        Assert.False(vm.HasProposal);
        Assert.Equal(InboxCategorizationStreamState.Idle, vm.State);
    }

    [Fact]
    public async Task Changing_severities_clears_the_captured_proposal()
    {
        var transport = new FakeInboxTransport(
            InboxCategorizationStreamEvent.ToolResult(
                "draft_alert_categories",
                true,
                Json("{\"status\":\"ok\",\"categories\":[{\"category\":\"battery\",\"count\":3,\"rule_ids\":[5]}]}")),
            InboxCategorizationStreamEvent.Done());
        using var vm = NewViewModel(StaticAiFeatureGate.On, transport);
        await vm.StartCategorizeAsync();
        Assert.True(vm.HasProposal);

        vm.Severities = new[] { "critical" };

        Assert.False(vm.HasProposal);
    }

    [Fact]
    public void Setting_an_equal_severities_list_does_not_reset()
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On);
        int resets = 0;
        vm.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(vm.Severities))
            {
                resets++;
            }
        };

        vm.Severities = new[] { "critical" };
        vm.Severities = new[] { "critical" }; // equal sequence — no notification.

        Assert.Equal(1, resets);
    }

    // ── view-model: empty / output-panel states (P2 state matrix) ────────────────────────────────────────

    [Fact]
    public async Task Done_with_no_text_and_no_proposal_shows_the_empty_state()
    {
        var transport = new FakeInboxTransport(InboxCategorizationStreamEvent.Done());
        using var vm = NewViewModel(StaticAiFeatureGate.On, transport);

        await vm.StartCategorizeAsync();

        Assert.True(vm.ShowEmptyState);
        Assert.True(vm.ShowOutputPanel);
        Assert.False(vm.HasProposal);
    }

    [Fact]
    public async Task Done_with_a_proposal_hides_the_output_panel()
    {
        var transport = new FakeInboxTransport(
            InboxCategorizationStreamEvent.ToolResult(
                "draft_alert_categories",
                true,
                Json("{\"status\":\"ok\",\"categories\":[{\"category\":\"battery\",\"count\":3,\"rule_ids\":[5]}]}")),
            InboxCategorizationStreamEvent.Done());
        using var vm = NewViewModel(StaticAiFeatureGate.On, transport);

        await vm.StartCategorizeAsync();

        Assert.False(vm.ShowEmptyState);
        Assert.False(vm.ShowOutputPanel); // the chips carry the output, so no blank box.
        Assert.True(vm.HasProposal);
    }

    // ── view-model: i18n + accessibility labels ──────────────────────────────────────────────────────────

    [Fact]
    public void Labels_resolve_to_the_web_fallback_copy()
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On);

        Assert.Equal("Suggest inbox categories", vm.Title);
        Assert.Equal("Bucket recent alerts into categories from your inbox history. Descriptive replay only \u2014 review before applying.", vm.Description);
        Assert.Equal("Suggest categories", vm.SuggestButtonLabel);
        Assert.Equal("Helix", vm.BadgeLabel);
        Assert.Equal("Apply categories as filter", vm.ApplyLabel);
        Assert.Equal("Proposed categories (review before applying):", vm.PreviewLabel);
        Assert.Equal("Ask Helix", vm.AskHelixLabel);
    }

    [Fact]
    public async Task Action_label_flips_to_the_thinking_copy_while_streaming()
    {
        var transport = new FakeInboxTransport { HoldOpen = true };
        using var vm = NewViewModel(StaticAiFeatureGate.On, transport);

        Assert.Equal("Ask Helix", vm.ActionLabel);

        var run = vm.StartCategorizeAsync();
        Assert.Equal("Helix is thinking\u2026", vm.ActionLabel);

        vm.Cancel();
        await run;
    }

    [Fact]
    public void Action_automation_name_composes_the_helix_cta_and_verb()
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On);

        Assert.Equal("Ask Helix \u00b7 Suggest categories", vm.ActionAutomationName);
    }

    private static JsonElement Json(string raw)
    {
        using var doc = JsonDocument.Parse(raw);
        return doc.RootElement.Clone();
    }

    private static AIInboxAutoCategorizationViewModel NewViewModel(
        IAiFeatureGate gate,
        IAiInboxCategorizationStreamTransport? transport = null) =>
        new(transport ?? new FakeInboxTransport(), gate, Localizer, onApplyCategories: null, vehicleId: 7);

    /// <summary>
    /// A scripted <see cref="IAiInboxCategorizationStreamTransport"/> for headless lifecycle tests: yields a
    /// fixed event sequence and (optionally) holds the stream open afterwards so cancel / duplicate-start paths
    /// are exercised deterministically. Records the open count and the last request body.
    /// </summary>
    private sealed class FakeInboxTransport : IAiInboxCategorizationStreamTransport
    {
        private InboxCategorizationStreamEvent[] _events;
        private int _openCount;

        public FakeInboxTransport(params InboxCategorizationStreamEvent[] events) => _events = events;

        /// <summary>When true the stream stays open after the scripted events until cancelled.</summary>
        public bool HoldOpen { get; init; }

        public int OpenCount => Volatile.Read(ref _openCount);

        public InboxCategorizationRequest? LastRequest { get; private set; }

        public void Reset(params InboxCategorizationStreamEvent[] events) => _events = events;

        public async IAsyncEnumerable<InboxCategorizationStreamEvent> StreamAsync(
            InboxCategorizationRequest request,
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
