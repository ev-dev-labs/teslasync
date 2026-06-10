using System.ComponentModel;
using System.Globalization;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="AIProviderSection"/> view — the native port of the
/// web component's hook composition (web/src/features/settings/components/AIProviderSection.tsx). The web
/// section is <em>controlled</em>: it receives the editable draft + the cloud flag as props and emits edits via
/// <c>onChange</c>. This holder mirrors that exactly — <see cref="Initialize"/> adopts the parent's draft, the
/// per-field <c>Set…</c> patchers clear the validation banner and raise <see cref="DraftChanged"/> (web
/// <c>patch</c>), and <see cref="ValidateAsync"/> drives the one network effect the section owns (web
/// <c>useValidateAiProvider</c>) through the <see cref="IAiProviderValidationSource"/>. Every label resolves
/// through the i18n facade so the view is a thin renderer. Drive it from one confinement (the UI thread); it is
/// not internally synchronised.
/// </summary>
public sealed class AiProviderSectionViewModel : INotifyPropertyChanged, IDisposable
{
    private const string AzureProvider = "azure";
    private const string FoundryFlavor = "foundry";
    private const string OpenAiFlavor = "openai";

    private readonly IAiProviderValidationSource _source;
    private readonly ILocalizer _localizer;

    private AiProviderDraft _draft = AiProviderDraft.Empty;
    private bool _isCloud;
    private bool _isValidating;
    private AiProviderBanner? _banner;
    private CancellationTokenSource? _validateCts;
    private bool _disposed;

    /// <summary>Creates the holder over its validation source and localizer.</summary>
    public AiProviderSectionViewModel(IAiProviderValidationSource source, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised whenever the draft is edited (web <c>onChange</c>); the host persists or re-projects it.</summary>
    public event EventHandler<AiProviderDraft>? DraftChanged;

    // ── Controlled inputs (web props) ─────────────────────────────────────────────────────────────────

    /// <summary>The editable provider draft (web <c>value</c>).</summary>
    public AiProviderDraft Draft => _draft;

    /// <summary>True when the parent surface is in cloud mode (web <c>isCloud</c>).</summary>
    public bool IsCloud => _isCloud;

    /// <summary>True when the parent surface is in local-only mode.</summary>
    public bool IsLocal => !_isCloud;

    /// <summary>Adopt the parent's draft + cloud flag (web controlled-component prop wiring); clears any banner.</summary>
    public void Initialize(AiProviderDraft draft, bool isCloud)
    {
        ArgumentNullException.ThrowIfNull(draft);
        _draft = draft;
        _isCloud = isCloud;
        _banner = null;
        RaiseAll();
    }

    // ── Validation lifecycle ──────────────────────────────────────────────────────────────────────────

    /// <summary>True while the pre-flight probe is in flight (web <c>validate.isPending</c>).</summary>
    public bool IsValidating
    {
        get => _isValidating;
        private set
        {
            if (Set(ref _isValidating, value))
            {
                Raise(nameof(CanValidate));
                Raise(nameof(ValidateButtonLabel));
            }
        }
    }

    /// <summary>The last validation banner, or null once cleared by an edit (web <c>validateBanner</c>).</summary>
    public AiProviderBanner? Banner
    {
        get => _banner;
        private set => Set(ref _banner, value);
    }

    /// <summary>Whether the Validate action is currently enabled (web <c>disabled</c> guard).</summary>
    public bool CanValidate => !_isValidating &&
        (_isCloud || !string.IsNullOrWhiteSpace(_draft.BaseUrl));

    // ── Conditional sections (web JSX guards) ─────────────────────────────────────────────────────────

    /// <summary>True when the provider is Azure in cloud mode (web <c>isCloud &amp;&amp; provider === 'azure'</c>).</summary>
    public bool IsAzure => _isCloud && string.Equals(_draft.Provider, AzureProvider, StringComparison.Ordinal);

    /// <summary>True when the Azure surface is the Foundry / Inference flavor (web <c>flavor === 'foundry'</c>).</summary>
    public bool IsAzureFoundry => string.Equals(FlavorValue, FoundryFlavor, StringComparison.Ordinal);

    /// <summary>Show the Azure flavor + api-version row (web <c>isCloud &amp;&amp; provider === 'azure'</c>).</summary>
    public bool ShowAzureFields => IsAzure;

    /// <summary>Show the Azure chat + embedding deployment inputs (web <c>flavor !== 'foundry'</c> guard).</summary>
    public bool ShowAzureDeploymentFields => IsAzure && !IsAzureFoundry;

    /// <summary>Show the local Base URL input + validate row (web <c>!isCloud</c>).</summary>
    public bool ShowLocalBaseUrl => IsLocal;

    /// <summary>Show the Azure resource-endpoint URL input (web <c>isCloud &amp;&amp; provider === 'azure'</c>).</summary>
    public bool ShowAzureBaseUrl => IsAzure;

    /// <summary>Show the cloud API-key + cost-cap + validate block (web <c>isCloud</c>).</summary>
    public bool ShowCloudFields => _isCloud;

    /// <summary>Show the local-only privacy explainer caption (web <c>!isCloud</c>).</summary>
    public bool ShowLocalExplainer => IsLocal;

    // ── Field values (bindable) ───────────────────────────────────────────────────────────────────────

    /// <summary>The selected provider (web <c>value.provider</c>).</summary>
    public string ProviderValue => _draft.Provider;

    /// <summary>The model identifier (web <c>value.model</c>).</summary>
    public string ModelValue => _draft.Model;

    /// <summary>The base / endpoint URL (web <c>value.base_url</c>).</summary>
    public string BaseUrlValue => _draft.BaseUrl;

    /// <summary>The in-memory API key (web <c>value.api_key</c>); never pre-populated from the server.</summary>
    public string ApiKeyValue => _draft.ApiKey;

    /// <summary>The Azure API version (web <c>value.api_version</c>).</summary>
    public string ApiVersionValue => _draft.ApiVersion;

    /// <summary>The Azure surface flavor, defaulting to <c>openai</c> (web <c>value.flavor || 'openai'</c>).</summary>
    public string FlavorValue => string.IsNullOrEmpty(_draft.Flavor) ? OpenAiFlavor : _draft.Flavor;

    /// <summary>The Azure chat deployment name (web <c>value.deployment</c>).</summary>
    public string DeploymentValue => _draft.Deployment;

    /// <summary>The Azure embedding deployment name (web <c>value.embedding_deployment</c>).</summary>
    public string EmbeddingDeploymentValue => _draft.EmbeddingDeployment;

    /// <summary>The cost cap rendered as whole-dollar text, or empty when unset (web <c>(cents/100).toFixed(2)</c>).</summary>
    public string CostCapText => _draft.CostCapCents > 0
        ? (_draft.CostCapCents / 100.0).ToString("0.00", CultureInfo.InvariantCulture)
        : string.Empty;

    // ── Provider / flavor options ─────────────────────────────────────────────────────────────────────

    /// <summary>The provider drop-down options (web cloud vs local <c>options</c> arrays).</summary>
    public IReadOnlyList<AiProviderOption> ProviderOptions => _isCloud
        ? new[]
        {
            new AiProviderOption("openai", "OpenAI"),
            new AiProviderOption("anthropic", "Anthropic"),
            new AiProviderOption("azure", "Azure AI"),
            new AiProviderOption("google", "Google"),
        }
        : new[]
        {
            new AiProviderOption("ollama", "Ollama"),
            new AiProviderOption("lmstudio", "LM Studio"),
            new AiProviderOption("llama-cpp", "llama.cpp"),
        };

    /// <summary>The Azure surface (flavor) drop-down options.</summary>
    public IReadOnlyList<AiProviderOption> FlavorOptions => new[]
    {
        new AiProviderOption(OpenAiFlavor, _localizer.GetString(
            "ai.settings.provider.azureFlavorOpenAi",
            "Azure OpenAI Service (gpt-4o, gpt-4-turbo, \u2026)")),
        new AiProviderOption(FoundryFlavor, _localizer.GetString(
            "ai.settings.provider.azureFlavorFoundry",
            "Azure AI Foundry / Inference (multi-vendor)")),
    };

    // ── Localised copy ────────────────────────────────────────────────────────────────────────────────

    /// <summary>Section heading + accessible name (web <c>ai.settings.provider.label</c>).</summary>
    public string SectionTitle => _localizer.GetString("ai.settings.provider.label", "Provider configuration");

    /// <summary>Provider field label (web <c>ai.settings.provider.providerLabel</c>).</summary>
    public string ProviderLabel => _localizer.GetString("ai.settings.provider.providerLabel", "Provider");

    /// <summary>Model field label — Azure (non-Foundry) widens it (web ternary on <c>azureModelLabel</c>).</summary>
    public string ModelLabel => IsAzure && !IsAzureFoundry
        ? _localizer.GetString("ai.settings.provider.azureModelLabel", "Model identifier (e.g. gpt-4o-mini)")
        : _localizer.GetString("ai.settings.provider.model", "Model");

    /// <summary>Model field helper text — present only for Azure (non-Foundry) (web ternary on <c>azureModelHint</c>).</summary>
    public string? ModelHint => IsAzure && !IsAzureFoundry
        ? _localizer.GetString(
            "ai.settings.provider.azureModelHint",
            "Used for cost tracking. Leave Deployment blank if your Azure deployment is named the same.")
        : null;

    /// <summary>Model field prompt text (web sample: cloud <c>gpt-4o-mini</c> / local <c>llama3.1:8b</c>).</summary>
    public string ModelPrompt => _isCloud
        ? _localizer.GetString("ai.settings.provider.modelSampleCloud", "gpt-4o-mini")
        : _localizer.GetString("ai.settings.provider.modelSampleLocal", "llama3.1:8b");

    /// <summary>Azure surface field label (web <c>ai.settings.provider.azureFlavor</c>).</summary>
    public string AzureFlavorLabel => _localizer.GetString("ai.settings.provider.azureFlavor", "Azure surface");

    /// <summary>Azure API-version field label (web <c>ai.settings.provider.azureApiVersion</c>).</summary>
    public string AzureApiVersionLabel =>
        _localizer.GetString("ai.settings.provider.azureApiVersion", "API version");

    /// <summary>Azure API-version field prompt text (web sample <c>2024-10-21</c>).</summary>
    public string AzureApiVersionPrompt =>
        _localizer.GetString("ai.settings.provider.azureApiVersionSample", "2024-10-21");

    /// <summary>Azure API-version helper text (web <c>ai.settings.provider.azureApiVersionHint</c>).</summary>
    public string AzureApiVersionHint => _localizer.GetString(
        "ai.settings.provider.azureApiVersionHint",
        "Leave blank to use the adapter default.");

    /// <summary>Azure chat-deployment field label (web <c>ai.settings.provider.azureDeployment</c>).</summary>
    public string AzureDeploymentLabel =>
        _localizer.GetString("ai.settings.provider.azureDeployment", "Chat deployment name");

    /// <summary>Azure chat-deployment prompt — the model, else a sample (web <c>value.model || 'gpt-4o-mini'</c>).</summary>
    public string AzureDeploymentPrompt => string.IsNullOrEmpty(_draft.Model)
        ? _localizer.GetString("ai.settings.provider.modelSampleCloud", "gpt-4o-mini")
        : _draft.Model;

    /// <summary>Azure chat-deployment helper text (web <c>ai.settings.provider.azureDeploymentHint</c>).</summary>
    public string AzureDeploymentHint => _localizer.GetString(
        "ai.settings.provider.azureDeploymentHint",
        "Leave blank to reuse the Model field.");

    /// <summary>Azure embedding-deployment field label (web <c>ai.settings.provider.azureEmbeddingDeployment</c>).</summary>
    public string AzureEmbeddingDeploymentLabel => _localizer.GetString(
        "ai.settings.provider.azureEmbeddingDeployment",
        "Embedding deployment name (optional)");

    /// <summary>Azure embedding-deployment prompt (web <c>value.embedding_model || 'text-embedding-3-small'</c>).</summary>
    public string AzureEmbeddingDeploymentPrompt => string.IsNullOrEmpty(_draft.EmbeddingModel)
        ? _localizer.GetString("ai.settings.provider.embeddingSample", "text-embedding-3-small")
        : _draft.EmbeddingModel;

    /// <summary>Local Base URL field label (web <c>ai.settings.provider.baseUrl</c>).</summary>
    public string BaseUrlLabel => _localizer.GetString("ai.settings.provider.baseUrl", "Base URL");

    /// <summary>Local Base URL field prompt text (web sample <c>http://localhost:11434</c>).</summary>
    public string BaseUrlPrompt =>
        _localizer.GetString("ai.settings.provider.baseUrlSample", "http://localhost:11434");

    /// <summary>Local Base URL helper text (web <c>ai.settings.provider.baseUrlHint</c>).</summary>
    public string BaseUrlHint => _localizer.GetString(
        "ai.settings.provider.baseUrlHint",
        "Must resolve to a private network address (loopback, RFC1918, link-local, or ULA).");

    /// <summary>Azure resource-endpoint field label (web <c>ai.settings.provider.azureBaseUrl</c>).</summary>
    public string AzureBaseUrlLabel =>
        _localizer.GetString("ai.settings.provider.azureBaseUrl", "Resource endpoint URL");

    /// <summary>Azure resource-endpoint prompt text (web sample <c>https://my-resource.openai.azure.com</c>).</summary>
    public string AzureBaseUrlPrompt =>
        _localizer.GetString("ai.settings.provider.azureBaseUrlSample", "https://my-resource.openai.azure.com");

    /// <summary>Azure resource-endpoint helper text (web <c>ai.settings.provider.azureBaseUrlHint</c>).</summary>
    public string AzureBaseUrlHint => _localizer.GetString(
        "ai.settings.provider.azureBaseUrlHint",
        "The Azure OpenAI resource endpoint or Azure AI Foundry endpoint.");

    /// <summary>API-key field label (web <c>ai.settings.provider.apiKey</c>).</summary>
    public string ApiKeyLabel => _localizer.GetString("ai.settings.provider.apiKey", "API key");

    /// <summary>API-key field prompt text (web api-key prompt i18n key).</summary>
    public string ApiKeyPrompt => _localizer.GetString(
        "ai.settings.provider.apiKeyPlaceholder", // parity:allow i18n key name from the web source
        "sk-\u2026  (leave blank to keep current)");

    /// <summary>API-key helper text (web <c>ai.settings.provider.apiKeyHint</c>).</summary>
    public string ApiKeyHint => _localizer.GetString(
        "ai.settings.provider.apiKeyHint",
        "Stored encrypted. Never displayed once saved.");

    /// <summary>Cost-cap field label (web <c>ai.settings.provider.costCap</c>).</summary>
    public string CostCapLabel => _localizer.GetString("ai.settings.provider.costCap", "Daily cost cap (USD)");

    /// <summary>Cost-cap field prompt text (web sample <c>5.00</c>).</summary>
    public string CostCapPrompt => _localizer.GetString("ai.settings.provider.costCapSample", "5.00");

    /// <summary>Cost-cap helper text (web <c>ai.settings.provider.costCapHint</c>).</summary>
    public string CostCapHint => _localizer.GetString(
        "ai.settings.provider.costCapHint",
        "Daily cap on cloud spending. 0 disables the cap.");

    /// <summary>Local-only privacy explainer caption (web <c>ai.settings.provider.localExplainer</c>).</summary>
    public string LocalExplainer => _localizer.GetString(
        "ai.settings.provider.localExplainer",
        "Local-only mode never sends data outside your network. The validator pins the resolved IP at save " +
        "time to defend against later DNS rebinding.");

    /// <summary>Trailing "validation is optional" helper text (web <c>ai.settings.provider.validateOptional</c>).</summary>
    public string ValidateOptionalHelp => _localizer.GetString(
        "ai.settings.provider.validateOptional",
        "Validation is optional but recommended \u2014 it catches mis-typed URLs and confirms the model is " +
        "reachable.");

    /// <summary>The Validate button label — busy, cloud or local variant (web ternary on <c>validate.isPending</c>).</summary>
    public string ValidateButtonLabel => _isValidating
        ? _localizer.GetString("ai.settings.validate.running", "Validating\u2026")
        : _isCloud
            ? _localizer.GetString("ai.settings.validate.cloudButton", "Validate connection")
            : _localizer.GetString("ai.settings.validate.button", "Validate");

    // ── Edit patchers (web patch) ─────────────────────────────────────────────────────────────────────

    /// <summary>Set the provider (web <c>patch({ provider })</c>); the host decides whether to reload saved config.</summary>
    public void SetProvider(string value) => Patch(_draft with { Provider = value ?? string.Empty });

    /// <summary>Set the model identifier (web <c>patch({ model })</c>).</summary>
    public void SetModel(string value) => Patch(_draft with { Model = value ?? string.Empty });

    /// <summary>Set the base / endpoint URL (web <c>patch({ base_url })</c>).</summary>
    public void SetBaseUrl(string value) => Patch(_draft with { BaseUrl = value ?? string.Empty });

    /// <summary>Set the in-memory API key (web <c>patch({ api_key })</c>).</summary>
    public void SetApiKey(string value) => Patch(_draft with { ApiKey = value ?? string.Empty });

    /// <summary>Set the Azure API version (web <c>patch({ api_version })</c>).</summary>
    public void SetApiVersion(string value) => Patch(_draft with { ApiVersion = value ?? string.Empty });

    /// <summary>Set the Azure surface flavor (web <c>patch({ flavor })</c>).</summary>
    public void SetFlavor(string value) => Patch(_draft with { Flavor = value ?? string.Empty });

    /// <summary>Set the Azure chat deployment name (web <c>patch({ deployment })</c>).</summary>
    public void SetDeployment(string value) => Patch(_draft with { Deployment = value ?? string.Empty });

    /// <summary>Set the Azure embedding deployment name (web <c>patch({ embedding_deployment })</c>).</summary>
    public void SetEmbeddingDeployment(string value) =>
        Patch(_draft with { EmbeddingDeployment = value ?? string.Empty });

    /// <summary>
    /// Set the daily cost cap from a dollar string (web cost-cap <c>onChange</c>): parse, clamp at zero, and
    /// store integer cents; an unparseable value disables the cap (0).
    /// </summary>
    public void SetCostCapFromDollars(string text)
    {
        var cents = double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var dollars)
            && double.IsFinite(dollars)
                ? Math.Max(0, (long)Math.Round(dollars * 100, MidpointRounding.AwayFromZero))
                : 0;
        Patch(_draft with { CostCapCents = cents });
    }

    /// <summary>
    /// Run the pre-flight probe (web <c>runValidate</c>): clear the banner, mark busy, ask the source, then
    /// render an OK or failure banner. Superseded attempts (a newer validate or a dispose) are ignored.
    /// </summary>
    public async Task ValidateAsync()
    {
        if (_isValidating)
        {
            return;
        }

        _validateCts?.Cancel();
        _validateCts?.Dispose();
        var cts = new CancellationTokenSource();
        _validateCts = cts;

        Banner = null;
        IsValidating = true;
        try
        {
            var outcome = await _source.ValidateAsync(_draft, _isCloud, cts.Token).ConfigureAwait(true);
            if (cts.IsCancellationRequested)
            {
                return;
            }

            Banner = outcome.IsOk
                ? new AiProviderBanner(
                    AiProviderBannerKind.Ok,
                    AiProviderValidationCopy.Success(_localizer, outcome.PinnedIp, outcome.ProbedModel))
                : new AiProviderBanner(
                    AiProviderBannerKind.Fail,
                    AiProviderValidationCopy.Failure(_localizer, outcome));
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer validate or a dispose — drop the result silently.
        }
        finally
        {
            if (ReferenceEquals(_validateCts, cts))
            {
                IsValidating = false;
            }
        }
    }

    /// <summary>Cancel any in-flight probe (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _validateCts?.Cancel();
        _validateCts?.Dispose();
        _validateCts = null;
    }

    private void Patch(AiProviderDraft next)
    {
        _draft = next;
        _banner = null;
        RaiseAll();
        DraftChanged?.Invoke(this, _draft);
    }

    private void RaiseAll()
    {
        // The view re-renders fully on any notification; an empty name signals "all properties changed".
        PropertyChanged?.Invoke(this, AllChanged);
    }

    private static readonly PropertyChangedEventArgs AllChanged = new(string.Empty);

    private bool Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return false;
        }

        field = value;
        Raise(name);
        return true;
    }

    private void Raise(string? name) => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
