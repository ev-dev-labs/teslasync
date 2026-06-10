using System.Text.Json;
using System.Text.Json.Nodes;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The structured reason a provider validation was rejected — the native analogue of the web
/// <c>ValidateAiProviderReason</c> union (web/src/api/hooks/useAiSettings.ts). The wire codes mirror the
/// constants in <c>internal/api/ai_settings_validate_handler.go</c>; <see cref="Unknown"/> is the defensive
/// fallback the server may widen into. Pure data, unit-tested without a UI host.
/// </summary>
public enum AiProviderValidationReason
{
    /// <summary>Base URL resolved to a public address (local mode requires a private target).</summary>
    NotLocal,

    /// <summary>Malformed URL, DNS failure, or another generic local-validator rejection.</summary>
    Invalid,

    /// <summary>Request body carried <c>mode=off</c> or an unknown mode.</summary>
    BadMode,

    /// <summary>Request body was malformed.</summary>
    BadRequest,

    /// <summary>Cloud probe hit a provider name with no registered adapter.</summary>
    UnknownProvider,

    /// <summary>Cloud probe needs an API key (request omitted it and no saved key fallback).</summary>
    MissingApiKey,

    /// <summary>Azure flavor needs a resource endpoint.</summary>
    MissingBaseUrl,

    /// <summary>Azure OpenAI Service flavor needs a deployment name (or model) to route to.</summary>
    MissingDeployment,

    /// <summary>Provider returned 401/403 (bad key).</summary>
    Unauthorized,

    /// <summary>Provider returned 404 (bad URL or deployment slug).</summary>
    NotFound,

    /// <summary>Provider returned 5xx/429 or a transport failure (provider-side problem).</summary>
    UpstreamError,

    /// <summary>Probe exceeded the budget.</summary>
    Timeout,

    /// <summary>Fallback when the server omitted (or widened) the code.</summary>
    Unknown,
}

/// <summary>
/// Maps the backend's structured <c>code</c> string onto a typed <see cref="AiProviderValidationReason"/> —
/// the native mirror of the web <c>reasonFromCode</c> switch. Unknown / future codes narrow to
/// <see cref="AiProviderValidationReason.Unknown"/> so exhaustive handling keeps working.
/// </summary>
public static class AiProviderValidationReasons
{
    /// <summary>Resolves a wire <c>code</c> to its typed reason (null / unrecognised → <c>Unknown</c>).</summary>
    public static AiProviderValidationReason FromCode(string? code) => code switch
    {
        "not_local" => AiProviderValidationReason.NotLocal,
        "invalid" => AiProviderValidationReason.Invalid,
        "bad_mode" => AiProviderValidationReason.BadMode,
        "bad_request" => AiProviderValidationReason.BadRequest,
        "unknown_provider" => AiProviderValidationReason.UnknownProvider,
        "missing_api_key" => AiProviderValidationReason.MissingApiKey,
        "missing_base_url" => AiProviderValidationReason.MissingBaseUrl,
        "missing_deployment" => AiProviderValidationReason.MissingDeployment,
        "unauthorized" => AiProviderValidationReason.Unauthorized,
        "not_found" => AiProviderValidationReason.NotFound,
        "upstream_error" => AiProviderValidationReason.UpstreamError,
        "timeout" => AiProviderValidationReason.Timeout,
        _ => AiProviderValidationReason.Unknown,
    };
}

/// <summary>The lifecycle of a single validation attempt.</summary>
public enum AiProviderValidationStatus
{
    /// <summary>The probe succeeded (HTTP 200, <c>ok: true</c>).</summary>
    Ok,

    /// <summary>The validator rejected the configuration (HTTP 422 with a structured code + server message).</summary>
    Rejected,

    /// <summary>The request never produced a validation verdict (transport / 5xx fault).</summary>
    Faulted,
}

/// <summary>
/// The discriminated result of a provider validation — the native analogue of the web
/// <c>ValidateAiProviderResult</c>. A 200 yields <see cref="Status"/> <c>Ok</c> (with the optional
/// <see cref="PinnedIp"/> / <see cref="ProbedModel"/> the UI echoes); a 422 yields <c>Rejected</c> carrying the
/// server's structured <see cref="Reason"/> and verbatim <see cref="Message"/>; any other fault yields
/// <c>Faulted</c> carrying a classified <see cref="RepositoryError"/> the view localises. Pure data.
/// </summary>
public sealed record AiProviderValidationOutcome(
    AiProviderValidationStatus Status,
    string? PinnedIp = null,
    string? ProbedModel = null,
    string? Note = null,
    AiProviderValidationReason Reason = AiProviderValidationReason.Unknown,
    string Message = "",
    RepositoryError? Error = null)
{
    /// <summary>True when the provider was reachable.</summary>
    public bool IsOk => Status == AiProviderValidationStatus.Ok;

    /// <summary>A successful probe, echoing the pinned IP / probed model when the server supplied them.</summary>
    public static AiProviderValidationOutcome Success(string? pinnedIp, string? probedModel, string? note = null) =>
        new(AiProviderValidationStatus.Ok, NullIfBlank(pinnedIp), NullIfBlank(probedModel), NullIfBlank(note));

    /// <summary>A structured validator rejection (HTTP 422); the reason code drives the localised banner.</summary>
    public static AiProviderValidationOutcome Rejected(AiProviderValidationReason reason, string message = "") =>
        new(AiProviderValidationStatus.Rejected, Reason: reason, Message: message ?? string.Empty);

    /// <summary>A transport / server fault with no validation verdict; the view renders a localised message.</summary>
    public static AiProviderValidationOutcome Faulted(RepositoryError error)
    {
        ArgumentNullException.ThrowIfNull(error);
        return new AiProviderValidationOutcome(
            AiProviderValidationStatus.Faulted,
            Reason: AiProviderValidationReason.UpstreamError,
            Message: error.Message,
            Error: error);
    }

    /// <summary>
    /// Projects the HTTP-200 body into a success outcome. The validator always returns <c>ok: true</c> on a
    /// 200; a defensively-false body degrades to an <c>Unknown</c> rejection so the UI never shows a green
    /// banner for a not-ok payload.
    /// </summary>
    public static AiProviderValidationOutcome FromResponse(JsonElement body)
    {
        if (body.ValueKind != JsonValueKind.Object || !ReadBool(body, "ok"))
        {
            return Rejected(AiProviderValidationReason.Unknown);
        }

        return Success(ReadString(body, "pinned_ip"), ReadString(body, "probed_model"), ReadString(body, "note"));
    }

    private static string? NullIfBlank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value;

    private static string? ReadString(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object
        && obj.TryGetProperty(name, out var prop)
        && prop.ValueKind == JsonValueKind.String
            ? prop.GetString()
            : null;

    private static bool ReadBool(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object
        && obj.TryGetProperty(name, out var prop)
        && prop.ValueKind == JsonValueKind.True;
}

/// <summary>
/// Builds the snake_case JSON body posted to <c>POST /settings/ai/validate-config</c> — the native mirror of
/// the web <c>runValidate</c> request shape. Local mode forwards only <c>mode</c> + <c>provider</c> +
/// <c>base_url</c> (the validator is provider-agnostic there); cloud mode forwards the full configuration and
/// omits <c>api_key</c> when the user left it blank so the backend falls back to the saved encrypted value
/// rather than clobbering it. Pure data so the wire contract is unit-tested without a UI host.
/// </summary>
public static class AiProviderValidationPayload
{
    /// <summary>Constructs the request body for the supplied draft + transport mode.</summary>
    public static JsonObject Build(AiProviderDraft draft, bool isCloud)
    {
        ArgumentNullException.ThrowIfNull(draft);

        if (!isCloud)
        {
            return new JsonObject
            {
                ["mode"] = "local",
                ["provider"] = draft.Provider,
                ["base_url"] = draft.BaseUrl,
            };
        }

        var body = new JsonObject
        {
            ["mode"] = "cloud",
            ["provider"] = draft.Provider,
            ["base_url"] = draft.BaseUrl,
            ["model"] = draft.Model,
            ["api_version"] = draft.ApiVersion,
            ["flavor"] = draft.Flavor,
            ["deployment"] = draft.Deployment,
            ["embedding_model"] = draft.EmbeddingModel,
            ["embedding_deployment"] = draft.EmbeddingDeployment,
        };

        // Only forward api_key when the user actually typed one; an empty field lets the backend reuse the
        // saved (encrypted) value rather than overwriting it with "".
        if (!string.IsNullOrWhiteSpace(draft.ApiKey))
        {
            body["api_key"] = draft.ApiKey;
        }

        return body;
    }
}

/// <summary>
/// Builds the localised banner copy for a finished validation — the native mirror of the web success-message
/// branch in <c>runValidate</c> plus the failure fallbacks. A pinned IP wins over a probed model wins over the
/// generic "reachable" line; a structured rejection shows the server's verbatim message (dynamic data, not a
/// UI literal); a transport fault shows a localised generic line. Interpolation follows the i18next
/// <c>{{token}}</c> convention so a translated resource and the English fallback share one shape. Pure logic.
/// </summary>
public static class AiProviderValidationCopy
{
    /// <summary>The success line for an OK outcome (pinned IP &gt; probed model &gt; generic).</summary>
    public static string Success(ILocalizer localizer, string? pinnedIp, string? probedModel)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        if (!string.IsNullOrWhiteSpace(pinnedIp))
        {
            return Interpolate(
                localizer.GetString("ai.settings.validate.successPinned", "OK \u2014 pinned to {{ip}}"),
                "ip",
                pinnedIp!);
        }

        if (!string.IsNullOrWhiteSpace(probedModel))
        {
            return Interpolate(
                localizer.GetString("ai.settings.validate.successProbed", "OK \u2014 {{model}} reachable"),
                "model",
                probedModel!);
        }

        return localizer.GetString("ai.settings.validate.success", "OK \u2014 provider reachable");
    }

    /// <summary>
    /// The banner message for a failed outcome. A structured 422 rejection localises a clear line from its
    /// reason code (the native generated API client surfaces the structured <c>code</c>, not the server's
    /// free-form prose, so this is the i18n-correct equivalent of the web's verbatim server text); a
    /// transport / server fault localises a generic line.
    /// </summary>
    public static string Failure(ILocalizer localizer, AiProviderValidationOutcome outcome)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(outcome);

        if (outcome.Status == AiProviderValidationStatus.Rejected)
        {
            return ReasonMessage(localizer, outcome.Reason);
        }

        return localizer.GetString(
            "ai.settings.validate.faulted",
            "Validation could not complete. Check the API and try again.");
    }

    private static string ReasonMessage(ILocalizer localizer, AiProviderValidationReason reason) => reason switch
    {
        AiProviderValidationReason.NotLocal => localizer.GetString(
            "ai.settings.validate.reason.notLocal",
            "That address is not private. Local mode needs a loopback or private-network URL."),
        AiProviderValidationReason.Invalid => localizer.GetString(
            "ai.settings.validate.reason.invalid",
            "That URL could not be validated. Check it and try again."),
        AiProviderValidationReason.BadMode => localizer.GetString(
            "ai.settings.validate.reason.badMode",
            "Validation is unavailable for the current mode."),
        AiProviderValidationReason.BadRequest => localizer.GetString(
            "ai.settings.validate.reason.badRequest",
            "The validation request was malformed."),
        AiProviderValidationReason.UnknownProvider => localizer.GetString(
            "ai.settings.validate.reason.unknownProvider",
            "That provider has no adapter configured."),
        AiProviderValidationReason.MissingApiKey => localizer.GetString(
            "ai.settings.validate.reason.missingApiKey",
            "An API key is required to reach this provider."),
        AiProviderValidationReason.MissingBaseUrl => localizer.GetString(
            "ai.settings.validate.reason.missingBaseUrl",
            "A resource endpoint URL is required."),
        AiProviderValidationReason.MissingDeployment => localizer.GetString(
            "ai.settings.validate.reason.missingDeployment",
            "A deployment name (or model) is required to route the request."),
        AiProviderValidationReason.Unauthorized => localizer.GetString(
            "ai.settings.validate.reason.unauthorized",
            "The provider rejected the credentials."),
        AiProviderValidationReason.NotFound => localizer.GetString(
            "ai.settings.validate.reason.notFound",
            "The provider endpoint or deployment was not found."),
        AiProviderValidationReason.UpstreamError => localizer.GetString(
            "ai.settings.validate.reason.upstreamError",
            "The provider returned an error. Try again shortly."),
        AiProviderValidationReason.Timeout => localizer.GetString(
            "ai.settings.validate.reason.timeout",
            "The validation probe timed out."),
        _ => localizer.GetString("ai.settings.validate.reason.unknown", "Validation failed."),
    };

    private static string Interpolate(string template, string token, string value) =>
        template.Replace("{{" + token + "}}", value, StringComparison.Ordinal);
}

/// <summary>
/// Stable identity + localised title for the provider-configuration surface (P1/S11 registry). The
/// <see cref="Id"/> matches the web <c>data-testid</c> (<c>ai-provider-section</c>); the <see cref="Slug"/> is
/// the diagnostics surface name. Pure metadata.
/// </summary>
public static class AiProviderSectionRegistration
{
    /// <summary>The canonical surface id (matches the web test id).</summary>
    public const string Id = "ai-provider-section";

    /// <summary>The diagnostics surface slug.</summary>
    public const string Slug = "AIProviderSection";

    /// <summary>The localised section heading (web <c>ai.settings.provider.label</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("ai.settings.provider.label", "Provider configuration");
    }
}

/// <summary>
/// PII-safe diagnostics for the provider surface (P1/S11 diagnostics contract). Records only the operational
/// <c>view.opened</c> event with the surface slug — never a provider name, key, URL or model — so a
/// diagnostics line can never leak operator-specific configuration. Thread-safe.
/// </summary>
public sealed class AiProviderSectionDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public AiProviderSectionDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=AIProviderSection</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={AiProviderSectionRegistration.Slug}");
    }
}

/// <summary>Whether a validation banner reports success or failure (drives its tone token).</summary>
public enum AiProviderBannerKind
{
    /// <summary>The provider was reachable.</summary>
    Ok,

    /// <summary>The configuration was rejected or the probe faulted.</summary>
    Fail,
}

/// <summary>An inline validation banner: a tone + a finished message. Pure data.</summary>
public sealed record AiProviderBanner(AiProviderBannerKind Kind, string Message);

/// <summary>One option in a provider / Azure-surface drop-down: the wire <see cref="Value"/> and its display
/// <see cref="Label"/>. Mirrors the web <c>Select</c> options arrays. Pure data.</summary>
public sealed record AiProviderOption(string Value, string Label);
