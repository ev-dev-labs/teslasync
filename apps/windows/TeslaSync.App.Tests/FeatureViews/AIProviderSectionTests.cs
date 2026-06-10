using System.Net.Http;
using System.Text.Json;
using System.Text.Json.Nodes;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the provider-configuration surface's UI-thread-free logic — the reason-code
/// mapping, the validate-config request payload builder (local vs cloud shape, api-key omission), the HTTP-200
/// response projection, the success / failure banner copy, the repository source's request shape + fault
/// classification, the controlled state-holder view-model (conditional-section flags, edit patchers that clear
/// the banner and raise <c>DraftChanged</c>, the cost-cap parse, the validate lifecycle) and the registry +
/// diagnostics. Mirrors the web spec (web/src/features/settings/components/AIProviderSection.tsx).
/// </summary>
public sealed class AIProviderSectionTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // ---- Reason code mapping (web reasonFromCode) ----------------------------------

    [Theory]
    [InlineData("not_local", AiProviderValidationReason.NotLocal)]
    [InlineData("invalid", AiProviderValidationReason.Invalid)]
    [InlineData("bad_mode", AiProviderValidationReason.BadMode)]
    [InlineData("bad_request", AiProviderValidationReason.BadRequest)]
    [InlineData("unknown_provider", AiProviderValidationReason.UnknownProvider)]
    [InlineData("missing_api_key", AiProviderValidationReason.MissingApiKey)]
    [InlineData("missing_base_url", AiProviderValidationReason.MissingBaseUrl)]
    [InlineData("missing_deployment", AiProviderValidationReason.MissingDeployment)]
    [InlineData("unauthorized", AiProviderValidationReason.Unauthorized)]
    [InlineData("not_found", AiProviderValidationReason.NotFound)]
    [InlineData("upstream_error", AiProviderValidationReason.UpstreamError)]
    [InlineData("timeout", AiProviderValidationReason.Timeout)]
    [InlineData("future_code", AiProviderValidationReason.Unknown)]
    [InlineData(null, AiProviderValidationReason.Unknown)]
    public void Reason_maps_wire_code_with_unknown_fallback(string? code, AiProviderValidationReason expected) =>
        Assert.Equal(expected, AiProviderValidationReasons.FromCode(code));

    // ---- Request payload builder (web runValidate body) ----------------------------

    [Fact]
    public void Payload_local_forwards_only_mode_provider_and_base_url()
    {
        var draft = AiProviderDraft.Empty with
        {
            Provider = "ollama",
            BaseUrl = "http://localhost:11434",
            ApiKey = "should-not-be-sent",
            Model = "llama3.1:8b",
        };

        var body = AiProviderValidationPayload.Build(draft, isCloud: false);

        Assert.Equal("local", (string?)body["mode"]);
        Assert.Equal("ollama", (string?)body["provider"]);
        Assert.Equal("http://localhost:11434", (string?)body["base_url"]);
        Assert.False(body.ContainsKey("api_key"));
        Assert.False(body.ContainsKey("model"));
    }

    [Fact]
    public void Payload_cloud_forwards_the_full_configuration()
    {
        var draft = new AiProviderDraft(
            "azure", "https://res.openai.azure.com", "gpt-4o-mini", "sk-secret", 500,
            "2024-10-21", "openai", "chat-deploy", "text-embedding-3-small", "embed-deploy");

        var body = AiProviderValidationPayload.Build(draft, isCloud: true);

        Assert.Equal("cloud", (string?)body["mode"]);
        Assert.Equal("azure", (string?)body["provider"]);
        Assert.Equal("https://res.openai.azure.com", (string?)body["base_url"]);
        Assert.Equal("gpt-4o-mini", (string?)body["model"]);
        Assert.Equal("sk-secret", (string?)body["api_key"]);
        Assert.Equal("2024-10-21", (string?)body["api_version"]);
        Assert.Equal("openai", (string?)body["flavor"]);
        Assert.Equal("chat-deploy", (string?)body["deployment"]);
        Assert.Equal("text-embedding-3-small", (string?)body["embedding_model"]);
        Assert.Equal("embed-deploy", (string?)body["embedding_deployment"]);
    }

    [Fact]
    public void Payload_cloud_omits_api_key_when_blank()
    {
        var draft = AiProviderDraft.Empty with { Provider = "openai", ApiKey = "   " };

        var body = AiProviderValidationPayload.Build(draft, isCloud: true);

        Assert.False(body.ContainsKey("api_key"));
    }

    // ---- Response projection (HTTP 200 body) ---------------------------------------

    [Fact]
    public void Response_pinned_ip_projects_to_a_pinned_success()
    {
        var outcome = FromJson("""{"ok":true,"mode":"local","base_url":"x","pinned_ip":"10.0.0.5"}""");

        Assert.True(outcome.IsOk);
        Assert.Equal("10.0.0.5", outcome.PinnedIp);
        Assert.Null(outcome.ProbedModel);
    }

    [Fact]
    public void Response_probed_model_projects_to_a_probed_success()
    {
        var outcome = FromJson("""{"ok":true,"probed_model":"gpt-4o"}""");

        Assert.True(outcome.IsOk);
        Assert.Null(outcome.PinnedIp);
        Assert.Equal("gpt-4o", outcome.ProbedModel);
    }

    [Fact]
    public void Response_bare_ok_projects_to_a_generic_success()
    {
        var outcome = FromJson("""{"ok":true}""");

        Assert.True(outcome.IsOk);
        Assert.Null(outcome.PinnedIp);
        Assert.Null(outcome.ProbedModel);
    }

    [Theory]
    [InlineData("""{"ok":false}""")]
    [InlineData("[]")]
    [InlineData("null")]
    public void Response_not_ok_or_non_object_degrades_to_an_unknown_rejection(string json)
    {
        var outcome = FromJson(json);

        Assert.False(outcome.IsOk);
        Assert.Equal(AiProviderValidationStatus.Rejected, outcome.Status);
        Assert.Equal(AiProviderValidationReason.Unknown, outcome.Reason);
    }

    // ---- Banner copy (web success/failure branches) --------------------------------

    [Fact]
    public void Copy_success_prefers_pinned_then_probed_then_generic()
    {
        Assert.Equal("OK \u2014 pinned to 10.0.0.5", AiProviderValidationCopy.Success(Localizer, "10.0.0.5", "gpt-4o"));
        Assert.Equal("OK \u2014 gpt-4o reachable", AiProviderValidationCopy.Success(Localizer, null, "gpt-4o"));
        Assert.Equal("OK \u2014 provider reachable", AiProviderValidationCopy.Success(Localizer, null, null));
    }

    [Fact]
    public void Copy_failure_localises_a_rejection_reason_and_a_fault()
    {
        var rejected = AiProviderValidationOutcome.Rejected(AiProviderValidationReason.NotLocal);
        var faulted = AiProviderValidationOutcome.Faulted(new RepositoryError(RepositoryErrorKind.Network, "down"));

        Assert.StartsWith("That address is not private", AiProviderValidationCopy.Failure(Localizer, rejected));
        Assert.StartsWith("Validation could not complete", AiProviderValidationCopy.Failure(Localizer, faulted));
    }

    // ---- Repository source (request shape + fault classification) -------------------

    [Fact]
    public async Task Source_posts_the_validate_operation_and_projects_success()
    {
        using var doc = JsonDocument.Parse("""{"ok":true,"pinned_ip":"127.0.0.1"}""");
        var client = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = new AiProviderValidationSource(client);
        var draft = AiProviderDraft.Empty with { Provider = "ollama", BaseUrl = "http://localhost:11434" };

        var outcome = await source.ValidateAsync(draft, isCloud: false);

        Assert.True(outcome.IsOk);
        Assert.Equal("127.0.0.1", outcome.PinnedIp);
        Assert.Equal("post_api_v1_settings_ai_validate_config", client.Requests[^1].OperationId);
        Assert.Equal(AiProviderValidationSource.ValidateOperation, client.Requests[^1].OperationId);
        var body = Assert.IsType<JsonObject>(client.Requests[^1].Body);
        Assert.Equal("local", (string?)body["mode"]);
    }

    [Fact]
    public async Task Source_treats_a_422_as_a_structured_rejection()
    {
        var client = new FakeApiClient().Throws(
            new ApiException("API request failed with status 422.", 422, "{}", "not_local"));
        var source = new AiProviderValidationSource(client);

        var outcome = await source.ValidateAsync(AiProviderDraft.Empty, isCloud: false);

        Assert.Equal(AiProviderValidationStatus.Rejected, outcome.Status);
        Assert.Equal(AiProviderValidationReason.NotLocal, outcome.Reason);
    }

    [Fact]
    public async Task Source_classifies_a_transport_fault()
    {
        var client = new FakeApiClient().Throws(new HttpRequestException("down"));
        var source = new AiProviderValidationSource(client);

        var outcome = await source.ValidateAsync(AiProviderDraft.Empty, isCloud: true);

        Assert.Equal(AiProviderValidationStatus.Faulted, outcome.Status);
        Assert.NotNull(outcome.Error);
        Assert.Equal(RepositoryErrorKind.Network, outcome.Error!.Kind);
    }

    [Fact]
    public async Task Source_classifies_a_server_fault()
    {
        var client = new FakeApiClient().Throws(
            new ApiException("API request failed with status 500.", 500));
        var source = new AiProviderValidationSource(client);

        var outcome = await source.ValidateAsync(AiProviderDraft.Empty, isCloud: true);

        Assert.Equal(AiProviderValidationStatus.Faulted, outcome.Status);
        Assert.Equal(RepositoryErrorKind.Server, outcome.Error!.Kind);
    }

    // ---- View-model: controlled inputs + conditional sections ----------------------

    [Fact]
    public void ViewModel_local_shows_the_base_url_block_and_local_provider_options()
    {
        using var vm = NewViewModel();
        vm.Initialize(AiProviderDraft.Empty with { Provider = "ollama" }, isCloud: false);

        Assert.True(vm.IsLocal);
        Assert.True(vm.ShowLocalBaseUrl);
        Assert.True(vm.ShowLocalExplainer);
        Assert.False(vm.ShowCloudFields);
        Assert.False(vm.ShowAzureFields);
        Assert.Contains(vm.ProviderOptions, o => o.Value == "ollama");
        Assert.DoesNotContain(vm.ProviderOptions, o => o.Value == "openai");
    }

    [Fact]
    public void ViewModel_cloud_azure_openai_shows_deployment_fields()
    {
        using var vm = NewViewModel();
        vm.Initialize(AiProviderDraft.Empty with { Provider = "azure", Flavor = "openai" }, isCloud: true);

        Assert.True(vm.ShowCloudFields);
        Assert.True(vm.ShowAzureFields);
        Assert.True(vm.ShowAzureBaseUrl);
        Assert.True(vm.ShowAzureDeploymentFields);
        Assert.False(vm.ShowLocalBaseUrl);
        Assert.Contains(vm.ProviderOptions, o => o.Value == "azure");
    }

    [Fact]
    public void ViewModel_cloud_azure_foundry_hides_deployment_fields()
    {
        using var vm = NewViewModel();
        vm.Initialize(AiProviderDraft.Empty with { Provider = "azure", Flavor = "foundry" }, isCloud: true);

        Assert.True(vm.ShowAzureFields);
        Assert.False(vm.ShowAzureDeploymentFields);
    }

    [Fact]
    public void ViewModel_flavor_defaults_to_openai_when_unset()
    {
        using var vm = NewViewModel();
        vm.Initialize(AiProviderDraft.Empty with { Provider = "azure", Flavor = "" }, isCloud: true);

        Assert.Equal("openai", vm.FlavorValue);
    }

    [Fact]
    public void ViewModel_model_label_widens_for_azure_openai_only()
    {
        using var vm = NewViewModel();

        vm.Initialize(AiProviderDraft.Empty with { Provider = "azure", Flavor = "openai" }, isCloud: true);
        Assert.Equal("Model identifier (e.g. gpt-4o-mini)", vm.ModelLabel);
        Assert.NotNull(vm.ModelHint);

        vm.Initialize(AiProviderDraft.Empty with { Provider = "azure", Flavor = "foundry" }, isCloud: true);
        Assert.Equal("Model", vm.ModelLabel);
        Assert.Null(vm.ModelHint);
    }

    // ---- View-model: edit patchers (web patch + onChange) --------------------------

    [Fact]
    public void ViewModel_set_field_raises_draft_changed_and_updates_value()
    {
        using var vm = NewViewModel();
        vm.Initialize(AiProviderDraft.Empty with { Provider = "ollama" }, isCloud: false);
        AiProviderDraft? emitted = null;
        vm.DraftChanged += (_, d) => emitted = d;

        vm.SetBaseUrl("http://localhost:11434");

        Assert.Equal("http://localhost:11434", vm.BaseUrlValue);
        Assert.NotNull(emitted);
        Assert.Equal("http://localhost:11434", emitted!.BaseUrl);
    }

    [Fact]
    public async Task ViewModel_editing_clears_the_validation_banner()
    {
        var src = new FakeValidationSource { Result = AiProviderValidationOutcome.Success(null, null) };
        using var vm = new AiProviderSectionViewModel(src, Localizer);
        vm.Initialize(AiProviderDraft.Empty with { Provider = "ollama", BaseUrl = "http://localhost:11434" }, isCloud: false);

        await vm.ValidateAsync();
        Assert.NotNull(vm.Banner);

        vm.SetModel("llama3.1:8b");
        Assert.Null(vm.Banner);
    }

    [Theory]
    [InlineData("5.00", 500L)]
    [InlineData("12.5", 1250L)]
    [InlineData("0", 0L)]
    [InlineData("", 0L)]
    [InlineData("not-a-number", 0L)]
    public void ViewModel_cost_cap_parses_dollars_into_cents(string input, long expectedCents)
    {
        using var vm = NewViewModel();
        vm.Initialize(AiProviderDraft.Empty, isCloud: true);

        vm.SetCostCapFromDollars(input);

        Assert.Equal(expectedCents, vm.Draft.CostCapCents);
    }

    [Fact]
    public void ViewModel_cost_cap_text_formats_cents_to_two_decimals()
    {
        using var vm = NewViewModel();
        vm.Initialize(AiProviderDraft.Empty with { CostCapCents = 750 }, isCloud: true);
        Assert.Equal("7.50", vm.CostCapText);

        vm.Initialize(AiProviderDraft.Empty with { CostCapCents = 0 }, isCloud: true);
        Assert.Equal(string.Empty, vm.CostCapText);
    }

    // ---- View-model: validate lifecycle (web runValidate) --------------------------

    [Fact]
    public void ViewModel_can_validate_requires_a_base_url_in_local_mode()
    {
        using var vm = NewViewModel();

        vm.Initialize(AiProviderDraft.Empty with { Provider = "ollama", BaseUrl = "" }, isCloud: false);
        Assert.False(vm.CanValidate);

        vm.SetBaseUrl("http://localhost:11434");
        Assert.True(vm.CanValidate);
    }

    [Fact]
    public void ViewModel_can_validate_in_cloud_mode_without_a_base_url()
    {
        using var vm = NewViewModel();
        vm.Initialize(AiProviderDraft.Empty with { Provider = "openai", BaseUrl = "" }, isCloud: true);

        Assert.True(vm.CanValidate);
    }

    [Fact]
    public async Task ViewModel_validating_state_disables_the_action_and_swaps_the_label()
    {
        var src = new FakeValidationSource { Gate = new TaskCompletionSource() };
        using var vm = new AiProviderSectionViewModel(src, Localizer);
        vm.Initialize(AiProviderDraft.Empty with { Provider = "openai" }, isCloud: true);

        var pending = vm.ValidateAsync();

        Assert.True(vm.IsValidating);
        Assert.False(vm.CanValidate);
        Assert.Equal("Validating\u2026", vm.ValidateButtonLabel);

        src.Gate!.SetResult();
        await pending;

        Assert.False(vm.IsValidating);
    }

    [Fact]
    public async Task ViewModel_validate_success_renders_an_ok_banner()
    {
        var src = new FakeValidationSource { Result = AiProviderValidationOutcome.Success("10.0.0.9", null) };
        using var vm = new AiProviderSectionViewModel(src, Localizer);
        vm.Initialize(AiProviderDraft.Empty with { Provider = "ollama", BaseUrl = "http://localhost:11434" }, isCloud: false);

        await vm.ValidateAsync();

        Assert.NotNull(vm.Banner);
        Assert.Equal(AiProviderBannerKind.Ok, vm.Banner!.Kind);
        Assert.Equal("OK \u2014 pinned to 10.0.0.9", vm.Banner.Message);
        Assert.Single(src.Calls);
        Assert.False(src.Calls[0].IsCloud);
    }

    [Fact]
    public async Task ViewModel_validate_rejection_renders_a_fail_banner()
    {
        var src = new FakeValidationSource
        {
            Result = AiProviderValidationOutcome.Rejected(AiProviderValidationReason.Unauthorized),
        };
        using var vm = new AiProviderSectionViewModel(src, Localizer);
        vm.Initialize(AiProviderDraft.Empty with { Provider = "openai" }, isCloud: true);

        await vm.ValidateAsync();

        Assert.NotNull(vm.Banner);
        Assert.Equal(AiProviderBannerKind.Fail, vm.Banner!.Kind);
        Assert.StartsWith("The provider rejected the credentials", vm.Banner.Message);
    }

    // ---- View-model: i18n facade + a11y label presence -----------------------------

    [Fact]
    public void ViewModel_exposes_localized_copy_through_the_facade()
    {
        using var vm = NewViewModel();
        vm.Initialize(AiProviderDraft.Empty with { Provider = "ollama" }, isCloud: false);

        Assert.Equal("Provider configuration", vm.SectionTitle);
        Assert.Equal("Provider", vm.ProviderLabel);
        Assert.Equal("Base URL", vm.BaseUrlLabel);
        Assert.Equal("Validate", vm.ValidateButtonLabel);
        Assert.StartsWith("Local-only mode never sends data", vm.LocalExplainer);
        Assert.StartsWith("Validation is optional", vm.ValidateOptionalHelp);
    }

    [Fact]
    public void ViewModel_cloud_validate_button_uses_the_connection_label()
    {
        using var vm = NewViewModel();
        vm.Initialize(AiProviderDraft.Empty with { Provider = "openai" }, isCloud: true);

        Assert.Equal("Validate connection", vm.ValidateButtonLabel);
        Assert.Equal("API key", vm.ApiKeyLabel);
        Assert.Equal("Daily cost cap (USD)", vm.CostCapLabel);
    }

    [Fact]
    public void ViewModel_every_interactive_control_has_a_nonempty_accessible_label()
    {
        // The view binds each control's Narrator name to one of these properties (the AutomationProperties
        // calls live in the WinUI view, exercised by the app build); assert the label source is fully
        // populated so no interactive element can render without an accessible name.
        using var vm = NewViewModel();
        vm.Initialize(AiProviderDraft.Empty with { Provider = "azure", Flavor = "openai" }, isCloud: true);

        var labels = new[]
        {
            vm.ProviderLabel, vm.ModelLabel, vm.AzureFlavorLabel, vm.AzureApiVersionLabel,
            vm.AzureDeploymentLabel, vm.AzureEmbeddingDeploymentLabel, vm.AzureBaseUrlLabel,
            vm.ApiKeyLabel, vm.CostCapLabel, vm.ValidateButtonLabel, vm.SectionTitle,
        };

        Assert.All(labels, label => Assert.False(string.IsNullOrWhiteSpace(label)));
    }

    // ---- Registry + diagnostics ----------------------------------------------------

    [Fact]
    public void Registration_exposes_stable_id_slug_and_localized_title()
    {
        Assert.Equal("ai-provider-section", AiProviderSectionRegistration.Id);
        Assert.Equal("AIProviderSection", AiProviderSectionRegistration.Slug);
        Assert.Equal("Provider configuration", AiProviderSectionRegistration.Title(Localizer));
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var sink = new List<string>();
        var diagnostics = new AiProviderSectionDiagnostics(sink.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=AIProviderSection", Assert.Single(sink));
    }

    // ---- helpers -------------------------------------------------------------------

    private static AiProviderSectionViewModel NewViewModel() =>
        new(new FakeValidationSource(), Localizer);

    private static AiProviderValidationOutcome FromJson(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return AiProviderValidationOutcome.FromResponse(doc.RootElement);
    }

    private sealed class FakeValidationSource : IAiProviderValidationSource
    {
        public AiProviderValidationOutcome Result { get; set; } =
            AiProviderValidationOutcome.Success(null, null);

        public TaskCompletionSource? Gate { get; set; }

        public List<(AiProviderDraft Draft, bool IsCloud)> Calls { get; } = new();

        public async Task<AiProviderValidationOutcome> ValidateAsync(
            AiProviderDraft draft,
            bool isCloud,
            CancellationToken cancellationToken = default)
        {
            Calls.Add((draft, isCloud));
            if (Gate is not null)
            {
                await Gate.Task.ConfigureAwait(false);
            }

            return Result;
        }
    }
}
