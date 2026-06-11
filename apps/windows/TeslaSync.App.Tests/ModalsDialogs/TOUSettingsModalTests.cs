using System.Net.Http;
using System.Text.Json;
using System.Text.Json.Nodes;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.ModalsDialogs;
using Xunit;
using GeneratedApi = TeslaSync.Windows.Generated.Api;

namespace TeslaSync.App.Tests.ModalsDialogs;

/// <summary>
/// Headless verification of the TOUSettingsModal surface's UI-thread-free logic — the preset-option / preview /
/// <c>getPayload()</c> validation + payload-assembly projections, the contract-client-backed save + site-info
/// refresh sources' request shape and error classification (the web <c>useUpdateTOUSettings</c> /
/// <c>useRefreshTeslaEnergySiteInfo</c> adapters), the state-holder view-model's per-state flows (idle /
/// tab-switch / preset-preview / validation / submitting / success-and-close-with-refresh / failure, plus the
/// toast + close contract that mirrors the two web mutations + <c>onClose</c>), the i18n key + fallback contract
/// that doubles as the Narrator-label source, and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/battery/components/TOUSettingsModal.tsx + web/src/api/hooks/useEnergy.ts). The WinUI view
/// itself (TOUSettingsModal.cs) is exercised by the app build.
/// </summary>
public sealed class TouSettingsModalTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // ── Projection: rate-plan options + preview ──────────────────────────────────────────────────────────

    [Fact]
    public void RatePlanOptions_are_the_three_presets_in_web_order_with_labels()
    {
        var options = TouSettingsModalProjection.RatePlanOptions;

        Assert.Equal(
            ["pge-ev2a", "sce-tou-d", "sdge-tou-dr1"],
            options.Select(o => o.Value).ToArray());
        Assert.Equal(
            [
                "PG&E EV2-A \u2014 Pacific Gas & Electric",
                "SCE TOU-D \u2014 Southern California Edison",
                "SDG&E TOU-DR1 \u2014 San Diego Gas & Electric",
            ],
            options.Select(o => o.Label).ToArray());
    }

    [Theory]
    [InlineData("pge-ev2a", true)]
    [InlineData("sce-tou-d", true)]
    [InlineData("sdge-tou-dr1", true)]
    [InlineData("nope", false)]
    [InlineData("", false)]
    [InlineData(null, false)]
    public void IsKnownPlan_recognizes_only_bundled_presets(string? planId, bool known) =>
        Assert.Equal(known, TouSettingsModalProjection.IsKnownPlan(planId));

    [Fact]
    public void PreviewFor_returns_pretty_json_for_a_known_plan()
    {
        string preview = TouSettingsModalProjection.PreviewFor("pge-ev2a");

        Assert.Contains("tou_settings", preview, StringComparison.Ordinal);
        Assert.Contains("PG&E EV2-A", preview, StringComparison.Ordinal); // relaxed encoder keeps & literal
        Assert.Contains("\n", preview, StringComparison.Ordinal); // pretty-printed (JSON.stringify(…, null, 2))
    }

    [Theory]
    [InlineData("")]
    [InlineData(null)]
    [InlineData("nope")]
    public void PreviewFor_is_empty_for_no_or_unknown_plan(string? planId) =>
        Assert.Equal(string.Empty, TouSettingsModalProjection.PreviewFor(planId));

    // ── Projection: payload assembly (web getPayload) ────────────────────────────────────────────────────

    [Fact]
    public void BuildPayload_preset_returns_the_plan_envelope()
    {
        var result = TouSettingsModalProjection.BuildPayload(TouInputMode.Preset, "pge-ev2a", null);

        Assert.True(result.Success);
        Assert.Equal(TouValidationError.None, result.Error);
        var tou = result.Payload!["tou_settings"];
        Assert.NotNull(tou);
        Assert.Equal("PG&E EV2-A", tou!["tariff_content_v2"]!["name"]!.GetValue<string>());
        Assert.Equal("economics", tou["optimization_strategy"]!.GetValue<string>());
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("unknown-plan")]
    public void BuildPayload_preset_without_a_known_selection_fails(string? planId)
    {
        var result = TouSettingsModalProjection.BuildPayload(TouInputMode.Preset, planId, null);

        Assert.False(result.Success);
        Assert.Equal(TouValidationError.NoPresetSelected, result.Error);
        Assert.Null(result.Payload);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void BuildPayload_custom_empty_fails(string? json)
    {
        var result = TouSettingsModalProjection.BuildPayload(TouInputMode.Custom, null, json);

        Assert.False(result.Success);
        Assert.Equal(TouValidationError.EmptyJson, result.Error);
    }

    [Theory]
    [InlineData("[1, 2, 3]")]
    [InlineData("42")]
    [InlineData("\"a string\"")]
    [InlineData("null")]
    public void BuildPayload_custom_non_object_fails(string json)
    {
        var result = TouSettingsModalProjection.BuildPayload(TouInputMode.Custom, null, json);

        Assert.False(result.Success);
        Assert.Equal(TouValidationError.NotAnObject, result.Error);
    }

    [Theory]
    [InlineData("{ not json }")]
    [InlineData("{\"a\": }")]
    [InlineData("{")]
    public void BuildPayload_custom_invalid_json_fails(string json)
    {
        var result = TouSettingsModalProjection.BuildPayload(TouInputMode.Custom, null, json);

        Assert.False(result.Success);
        Assert.Equal(TouValidationError.InvalidJson, result.Error);
    }

    [Fact]
    public void BuildPayload_custom_object_with_envelope_is_sent_as_is()
    {
        var result = TouSettingsModalProjection.BuildPayload(
            TouInputMode.Custom, null, "{\"tou_settings\":{\"optimization_strategy\":\"self_consumption\"}}");

        Assert.True(result.Success);
        Assert.Equal(
            "self_consumption",
            result.Payload!["tou_settings"]!["optimization_strategy"]!.GetValue<string>());
    }

    [Fact]
    public void BuildPayload_custom_bare_object_is_wrapped_in_the_envelope()
    {
        var result = TouSettingsModalProjection.BuildPayload(
            TouInputMode.Custom, null, "{\"optimization_strategy\":\"economics\"}");

        Assert.True(result.Success);
        var tou = result.Payload!["tou_settings"];
        Assert.NotNull(tou);
        Assert.Equal("economics", tou!["optimization_strategy"]!.GetValue<string>());
    }

    [Fact]
    public void BuildPayload_custom_ignores_surrounding_whitespace()
    {
        var result = TouSettingsModalProjection.BuildPayload(
            TouInputMode.Custom, null, "  \n {\"tou_settings\":{}}  \n ");

        Assert.True(result.Success);
        Assert.NotNull(result.Payload!["tou_settings"]);
    }

    // ── Adapter: POST /tou-settings request shape + classification (web useUpdateTOUSettings) ────────────

    [Fact]
    public async Task UpdateAsync_posts_the_operation_path_param_and_body()
    {
        var api = new FakeApiClient { Response = "{\"id\":1}" };
        var source = new TouSettingsUpdateSource(api);
        var payload = TouSettingsModalProjection.BuildPayload(TouInputMode.Preset, "sce-tou-d", null).Payload!;

        var outcome = await source.UpdateAsync(7, payload);

        Assert.True(outcome.Success);
        Assert.Null(outcome.Error);
        Assert.NotNull(api.Last);
        Assert.Equal("post_api_v1_tesla_energy_sites_siteID_tou_settings", api.Last!.OperationId);
        Assert.Equal("7", api.Last.PathParams!["siteID"]);
        Assert.Same(payload, api.Last.Body);
    }

    [Fact]
    public async Task UpdateAsync_classifies_an_api_fault_without_throwing()
    {
        var api = new FakeApiClient { Failure = new ApiException("bad request", statusCode: 400) };
        var source = new TouSettingsUpdateSource(api);
        var payload = new JsonObject { ["tou_settings"] = new JsonObject() };

        var outcome = await source.UpdateAsync(7, payload);

        Assert.False(outcome.Success);
        Assert.NotNull(outcome.Error);
        Assert.Equal(400, outcome.Error!.StatusCode);
    }

    [Fact]
    public async Task UpdateAsync_classifies_a_network_fault_as_network()
    {
        var api = new FakeApiClient { Failure = new HttpRequestException("offline") };
        var source = new TouSettingsUpdateSource(api);

        var outcome = await source.UpdateAsync(7, new JsonObject { ["tou_settings"] = new JsonObject() });

        Assert.False(outcome.Success);
        Assert.Equal(RepositoryErrorKind.Network, outcome.Error!.Kind);
    }

    [Fact]
    public async Task UpdateAsync_rejects_a_null_payload() =>
        await Assert.ThrowsAsync<ArgumentNullException>(
            () => new TouSettingsUpdateSource(new FakeApiClient()).UpdateAsync(1, null!));

    // ── Adapter: POST /site-info/refresh request shape (web useRefreshTeslaEnergySiteInfo) ───────────────

    [Fact]
    public async Task RefreshAsync_posts_the_refresh_operation_and_path_param()
    {
        var api = new FakeApiClient { Response = "{\"data\":null}" };
        var source = new TouSiteInfoRefreshSource(api);

        var outcome = await source.RefreshAsync(42);

        Assert.True(outcome.Success);
        Assert.Equal("post_api_v1_tesla_energy_sites_siteID_site_info_refresh", api.Last!.OperationId);
        Assert.Equal("42", api.Last.PathParams!["siteID"]);
        Assert.Null(api.Last.Body);
    }

    [Fact]
    public async Task RefreshAsync_classifies_a_fault_without_throwing()
    {
        var api = new FakeApiClient { Failure = new ApiException("boom", statusCode: 500) };
        var source = new TouSiteInfoRefreshSource(api);

        var outcome = await source.RefreshAsync(42);

        Assert.False(outcome.Success);
        Assert.Equal(RepositoryErrorKind.Server, outcome.Error!.Kind);
    }

    // ── View-model: initial (idle) state ─────────────────────────────────────────────────────────────────

    [Fact]
    public void Initial_state_matches_web_defaults()
    {
        var vm = NewViewModel();

        Assert.Equal(TouInputMode.Preset, vm.Mode);
        Assert.True(vm.IsPresetMode);
        Assert.False(vm.IsCustomMode);
        Assert.Equal(string.Empty, vm.SelectedPlanId);
        Assert.Equal(string.Empty, vm.CustomJson);
        Assert.Equal(string.Empty, vm.SelectedPreview);
        Assert.False(vm.HasPreview);
        Assert.False(vm.HasError);
        Assert.False(vm.IsSubmitting);
        Assert.True(vm.CanSubmit);
        Assert.Equal(3, vm.RatePlanOptions.Count);
        Assert.Equal("Update Rate Plan", vm.SubmitLabel);
        Assert.Null(vm.PendingRefresh);
    }

    // ── View-model: tab switch + preset preview ──────────────────────────────────────────────────────────

    [Fact]
    public void SetMode_switches_the_active_tab()
    {
        var vm = NewViewModel();

        vm.SetMode(TouInputMode.Custom);

        Assert.Equal(TouInputMode.Custom, vm.Mode);
        Assert.True(vm.IsCustomMode);
        Assert.False(vm.IsPresetMode);
    }

    [Fact]
    public void Selecting_a_plan_projects_the_preview()
    {
        var vm = NewViewModel();

        vm.SelectedPlanId = "sdge-tou-dr1";

        Assert.True(vm.HasPreview);
        Assert.Contains("SDG&E TOU-DR1", vm.SelectedPreview, StringComparison.Ordinal);
    }

    [Fact]
    public void Clearing_the_plan_clears_the_preview()
    {
        var vm = NewViewModel();
        vm.SelectedPlanId = "pge-ev2a";
        Assert.True(vm.HasPreview);

        vm.SelectedPlanId = string.Empty;

        Assert.False(vm.HasPreview);
        Assert.Equal(string.Empty, vm.SelectedPreview);
    }

    // ── View-model: validation state ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Submit_preset_without_a_selection_surfaces_the_error_and_does_not_save()
    {
        var update = new FakeUpdateSource();
        var vm = NewViewModel(update: update);

        bool saved = await vm.SubmitAsync();

        Assert.False(saved);
        Assert.Equal(0, update.Calls);
        Assert.True(vm.HasError);
        Assert.Equal("Please select a rate plan", vm.ErrorMessage);
    }

    [Fact]
    public async Task Submit_custom_empty_surfaces_the_empty_error()
    {
        var update = new FakeUpdateSource();
        var vm = NewViewModel(update: update);
        vm.SetMode(TouInputMode.Custom);

        bool saved = await vm.SubmitAsync();

        Assert.False(saved);
        Assert.Equal(0, update.Calls);
        Assert.Equal("Please enter the TOU settings JSON", vm.ErrorMessage);
    }

    [Fact]
    public async Task Submit_custom_invalid_json_surfaces_the_invalid_error()
    {
        var vm = NewViewModel();
        vm.SetMode(TouInputMode.Custom);
        vm.CustomJson = "{ not valid";

        bool saved = await vm.SubmitAsync();

        Assert.False(saved);
        Assert.Equal("Invalid JSON \u2014 please check syntax", vm.ErrorMessage);
    }

    [Fact]
    public async Task Submit_custom_non_object_surfaces_the_object_error()
    {
        var vm = NewViewModel();
        vm.SetMode(TouInputMode.Custom);
        vm.CustomJson = "[1,2,3]";

        bool saved = await vm.SubmitAsync();

        Assert.False(saved);
        Assert.Equal("JSON must be an object", vm.ErrorMessage);
    }

    // ── View-model: success → save + refresh + close ─────────────────────────────────────────────────────

    [Fact]
    public async Task Submit_preset_success_saves_refreshes_toasts_and_closes()
    {
        var update = new FakeUpdateSource { Outcome = TouSettingsOutcome.Ok() };
        var refresh = new FakeRefreshSource { Outcome = TouSettingsOutcome.Ok() };
        var diag = new TouSettingsModalDiagnostics();
        var vm = NewViewModel(siteId: 9, update: update, refresh: refresh, diagnostics: diag);
        var toasts = new List<TouSettingsToast>();
        int closes = 0;
        vm.ToastRequested += (_, t) => toasts.Add(t);
        vm.CloseRequested += (_, _) => closes++;
        vm.NotifyOpened();
        vm.SelectedPlanId = "pge-ev2a";

        bool saved = await vm.SubmitAsync();

        Assert.True(saved);
        Assert.Equal(1, update.Calls);
        Assert.Equal(9, update.LastSiteId);
        Assert.NotNull(update.LastPayload);
        Assert.Equal("PG&E EV2-A", update.LastPayload!["tou_settings"]!["tariff_content_v2"]!["name"]!.GetValue<string>());
        Assert.Equal(1, closes);
        Assert.Equal(1, diag.SettingsSaved);
        Assert.False(vm.IsSubmitting);

        // Save toast fires synchronously; the refresh is fire-and-forget — await it for the refresh toast.
        Assert.NotNull(vm.PendingRefresh);
        await vm.PendingRefresh!;
        Assert.Equal(1, refresh.Calls);
        Assert.Equal(9, refresh.LastSiteId);
        Assert.Contains(toasts, t => !t.IsError && t.Message == "TOU settings saved");
        Assert.Contains(toasts, t => !t.IsError && t.Message == "Site info refreshed");
    }

    [Fact]
    public async Task Submit_custom_bare_object_wraps_and_saves()
    {
        var update = new FakeUpdateSource();
        var vm = NewViewModel(update: update);
        vm.SetMode(TouInputMode.Custom);
        vm.CustomJson = "{\"optimization_strategy\":\"economics\"}";

        bool saved = await vm.SubmitAsync();

        Assert.True(saved);
        Assert.Equal(
            "economics",
            update.LastPayload!["tou_settings"]!["optimization_strategy"]!.GetValue<string>());
    }

    // ── View-model: failure keeps the modal open ─────────────────────────────────────────────────────────

    [Fact]
    public async Task Submit_failure_surfaces_inline_error_and_error_toast_and_keeps_open()
    {
        var update = new FakeUpdateSource
        {
            Outcome = TouSettingsOutcome.Fail(new RepositoryError(RepositoryErrorKind.Server, "The server reported an error.")),
        };
        var vm = NewViewModel(update: update);
        var toasts = new List<TouSettingsToast>();
        int closes = 0;
        vm.ToastRequested += (_, t) => toasts.Add(t);
        vm.CloseRequested += (_, _) => closes++;
        vm.SelectedPlanId = "pge-ev2a";

        bool saved = await vm.SubmitAsync();

        Assert.False(saved);
        Assert.Equal(1, update.Calls);
        Assert.True(vm.HasError);
        Assert.Equal("The server reported an error.", vm.ErrorMessage);
        var toast = Assert.Single(toasts);
        Assert.True(toast.IsError);
        Assert.Equal("Failed to save TOU settings", toast.Message);
        Assert.Equal(0, closes);
        Assert.Null(vm.PendingRefresh);
        Assert.False(vm.IsSubmitting);
    }

    // ── View-model: submitting (busy) state ──────────────────────────────────────────────────────────────

    [Fact]
    public async Task CanSubmit_reflects_the_in_flight_state()
    {
        var gate = new TaskCompletionSource<TouSettingsOutcome>();
        var update = new FakeUpdateSource { Gate = gate.Task };
        var vm = NewViewModel(update: update);
        vm.SelectedPlanId = "pge-ev2a";

        var task = vm.SubmitAsync();

        Assert.True(vm.IsSubmitting);
        Assert.False(vm.CanSubmit);

        gate.SetResult(TouSettingsOutcome.Ok());
        Assert.True(await task);
        Assert.False(vm.IsSubmitting);
        Assert.True(vm.CanSubmit);
    }

    [Fact]
    public async Task Submit_is_ignored_while_already_submitting()
    {
        var gate = new TaskCompletionSource<TouSettingsOutcome>();
        var update = new FakeUpdateSource { Gate = gate.Task };
        var vm = NewViewModel(update: update);
        vm.SelectedPlanId = "pge-ev2a";

        var first = vm.SubmitAsync();
        bool second = await vm.SubmitAsync();

        Assert.False(second);
        gate.SetResult(TouSettingsOutcome.Ok());
        Assert.True(await first);
        Assert.Equal(1, update.Calls);
    }

    // ── View-model: cancel / close ───────────────────────────────────────────────────────────────────────

    [Fact]
    public void RequestClose_raises_close()
    {
        var vm = NewViewModel();
        int closes = 0;
        vm.CloseRequested += (_, _) => closes++;

        vm.RequestClose();

        Assert.Equal(1, closes);
    }

    [Fact]
    public async Task RequestClose_is_ignored_while_submitting()
    {
        var gate = new TaskCompletionSource<TouSettingsOutcome>();
        var update = new FakeUpdateSource { Gate = gate.Task };
        var vm = NewViewModel(update: update);
        int closes = 0;
        vm.CloseRequested += (_, _) => closes++;
        vm.SelectedPlanId = "pge-ev2a";
        var task = vm.SubmitAsync();

        vm.RequestClose();

        Assert.Equal(0, closes);
        gate.SetResult(TouSettingsOutcome.Ok());
        await task;
        Assert.Equal(1, closes); // the success path itself raised exactly one close
    }

    // ── Diagnostics (PII-safe, P1/S11) ───────────────────────────────────────────────────────────────────

    [Fact]
    public void NotifyOpened_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diag = new TouSettingsModalDiagnostics(lines.Add);
        var vm = NewViewModel(diagnostics: diag);

        vm.NotifyOpened();

        Assert.Equal(1, diag.ViewsOpened);
        Assert.Equal("view.opened slug=TOUSettingsModal", Assert.Single(lines));
    }

    [Fact]
    public void RecordSettingsSaved_emits_slug_without_content()
    {
        var lines = new List<string>();
        var diag = new TouSettingsModalDiagnostics(lines.Add);

        diag.RecordSettingsSaved();

        Assert.Equal(1, diag.SettingsSaved);
        Assert.Equal("tou.saved slug=TOUSettingsModal", Assert.Single(lines));
    }

    // ── i18n key + fallback contract (the Narrator-label source / a11y labels) ───────────────────────────

    [Fact]
    public void Every_label_routes_through_an_energy_common_or_toast_key()
    {
        var recorder = new RecordingLocalizer();

        ReadAllLabels(recorder);

        Assert.NotEmpty(recorder.Keys);
        Assert.All(recorder.Keys, key => Assert.True(
            key.StartsWith("energy.tou.", StringComparison.Ordinal)
            || key.StartsWith("common.", StringComparison.Ordinal)
            || key.StartsWith("toast.energy.", StringComparison.Ordinal),
            $"unexpected i18n key: {key}"));
    }

    [Fact]
    public void English_fallbacks_match_the_web_literals()
    {
        Assert.Equal("Update Rate Plan", TouSettingsModalRegistration.Title(Localizer));
        Assert.Equal(
            "Configure your utility rate plan so the Powerwall can optimize charging and discharging based on electricity pricing.",
            TouSettingsModalRegistration.Description(Localizer));
        Assert.Equal("Preset Tariff", TouSettingsModalRegistration.PresetTabLabel(Localizer));
        Assert.Equal("Custom JSON", TouSettingsModalRegistration.CustomTabLabel(Localizer));
        Assert.Equal("Rate Plan", TouSettingsModalRegistration.SelectPlanLabel(Localizer));
        Assert.Equal("Choose a rate plan\u2026", TouSettingsModalRegistration.SelectPrompt(Localizer));
        Assert.Equal("Preview", TouSettingsModalRegistration.PreviewLabel(Localizer));
        Assert.Equal("TOU Settings JSON", TouSettingsModalRegistration.CustomLabel(Localizer));
        Assert.Equal(
            "Paste the full tou_settings payload or just the inner object. See Tesla Fleet API docs for the schema.",
            TouSettingsModalRegistration.CustomHint(Localizer));
        Assert.Equal("Update Rate Plan", TouSettingsModalRegistration.SubmitLabel(Localizer));
        Assert.Equal("Cancel", TouSettingsModalRegistration.CancelLabel(Localizer));
        Assert.Equal("Please select a rate plan", TouSettingsModalRegistration.ValidationMessage(Localizer, TouValidationError.NoPresetSelected));
        Assert.Equal("Please enter the TOU settings JSON", TouSettingsModalRegistration.ValidationMessage(Localizer, TouValidationError.EmptyJson));
        Assert.Equal("JSON must be an object", TouSettingsModalRegistration.ValidationMessage(Localizer, TouValidationError.NotAnObject));
        Assert.Equal("Invalid JSON \u2014 please check syntax", TouSettingsModalRegistration.ValidationMessage(Localizer, TouValidationError.InvalidJson));
        Assert.Equal("TOU settings saved", TouSettingsModalRegistration.SaveSuccessToast(Localizer));
        Assert.Equal("Failed to save TOU settings", TouSettingsModalRegistration.SaveErrorToast(Localizer));
        Assert.Equal("Site info refreshed", TouSettingsModalRegistration.RefreshSuccessToast(Localizer));
        Assert.Equal("Failed to refresh site info", TouSettingsModalRegistration.RefreshErrorToast(Localizer));
    }

    [Fact]
    public void Every_interactive_element_has_a_non_empty_accessible_label()
    {
        // The Narrator name of each control is its i18n label; none may be blank.
        Assert.All(
            new[]
            {
                TouSettingsModalRegistration.Title(Localizer),
                TouSettingsModalRegistration.PresetTabLabel(Localizer),
                TouSettingsModalRegistration.CustomTabLabel(Localizer),
                TouSettingsModalRegistration.SelectPlanLabel(Localizer),
                TouSettingsModalRegistration.CustomLabel(Localizer),
                TouSettingsModalRegistration.SubmitLabel(Localizer),
                TouSettingsModalRegistration.SavingLabel(Localizer),
                TouSettingsModalRegistration.CancelLabel(Localizer),
            },
            label => Assert.False(string.IsNullOrWhiteSpace(label)));
    }

    [Fact]
    public void Native_idiom_labels_have_friendly_fallbacks()
    {
        Assert.Equal("Choose a rate plan to preview its tariff.", TouSettingsModalRegistration.PreviewEmpty(Localizer));
        Assert.Equal("Saving rate plan\u2026", TouSettingsModalRegistration.SavingLabel(Localizer));
        Assert.False(string.IsNullOrWhiteSpace(TouSettingsModalRegistration.CustomPrompt(Localizer)));
    }

    // ── Helpers + fakes ──────────────────────────────────────────────────────────────────────────────────

    private static TouSettingsModalViewModel NewViewModel(
        long siteId = 1,
        ITouSettingsUpdateSource? update = null,
        ITouSiteInfoRefreshSource? refresh = null,
        TouSettingsModalDiagnostics? diagnostics = null) =>
        new(siteId, update ?? new FakeUpdateSource(), refresh ?? new FakeRefreshSource(), Localizer, diagnostics);

    private static void ReadAllLabels(ILocalizer localizer)
    {
        _ = TouSettingsModalRegistration.Title(localizer);
        _ = TouSettingsModalRegistration.Description(localizer);
        _ = TouSettingsModalRegistration.PresetTabLabel(localizer);
        _ = TouSettingsModalRegistration.CustomTabLabel(localizer);
        _ = TouSettingsModalRegistration.SelectPlanLabel(localizer);
        _ = TouSettingsModalRegistration.SelectPrompt(localizer);
        _ = TouSettingsModalRegistration.PreviewLabel(localizer);
        _ = TouSettingsModalRegistration.PreviewEmpty(localizer);
        _ = TouSettingsModalRegistration.CustomLabel(localizer);
        _ = TouSettingsModalRegistration.CustomPrompt(localizer);
        _ = TouSettingsModalRegistration.CustomHint(localizer);
        _ = TouSettingsModalRegistration.SubmitLabel(localizer);
        _ = TouSettingsModalRegistration.SavingLabel(localizer);
        _ = TouSettingsModalRegistration.CancelLabel(localizer);
        _ = TouSettingsModalRegistration.SaveSuccessToast(localizer);
        _ = TouSettingsModalRegistration.SaveErrorToast(localizer);
        _ = TouSettingsModalRegistration.RefreshSuccessToast(localizer);
        _ = TouSettingsModalRegistration.RefreshErrorToast(localizer);
        _ = TouSettingsModalRegistration.ValidationMessage(localizer, TouValidationError.NoPresetSelected);
        _ = TouSettingsModalRegistration.ValidationMessage(localizer, TouValidationError.EmptyJson);
        _ = TouSettingsModalRegistration.ValidationMessage(localizer, TouValidationError.NotAnObject);
        _ = TouSettingsModalRegistration.ValidationMessage(localizer, TouValidationError.InvalidJson);
    }

    private sealed class FakeUpdateSource : ITouSettingsUpdateSource
    {
        public int Calls { get; private set; }

        public long LastSiteId { get; private set; }

        public JsonNode? LastPayload { get; private set; }

        public TouSettingsOutcome Outcome { get; set; } = TouSettingsOutcome.Ok();

        public Task<TouSettingsOutcome>? Gate { get; set; }

        public async Task<TouSettingsOutcome> UpdateAsync(
            long siteId,
            JsonNode payload,
            CancellationToken cancellationToken = default)
        {
            Calls++;
            LastSiteId = siteId;
            LastPayload = payload;
            if (Gate is { } gate)
            {
                return await gate.ConfigureAwait(false);
            }

            return Outcome;
        }
    }

    private sealed class FakeRefreshSource : ITouSiteInfoRefreshSource
    {
        public int Calls { get; private set; }

        public long LastSiteId { get; private set; }

        public TouSettingsOutcome Outcome { get; set; } = TouSettingsOutcome.Ok();

        public Task<TouSettingsOutcome> RefreshAsync(long siteId, CancellationToken cancellationToken = default)
        {
            Calls++;
            LastSiteId = siteId;
            return Task.FromResult(Outcome);
        }
    }

    private sealed class FakeApiClient : IApiClient
    {
        public ApiRequest? Last { get; private set; }

        public string Response { get; set; } = "{}";

        public Exception? Failure { get; set; }

        public GeneratedApi.EndpointDescriptor ResolveEndpoint(string operationId) =>
            throw new NotSupportedException();

        public Task<T> SendAsync<T>(ApiRequest request, CancellationToken cancellationToken = default)
        {
            Last = request;
            if (Failure is { } error)
            {
                return Task.FromException<T>(error);
            }

            using var doc = JsonDocument.Parse(Response);
            object element = doc.RootElement.Clone();
            return Task.FromResult((T)element);
        }
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = [];

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }
}
