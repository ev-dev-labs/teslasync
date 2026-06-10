using System.Net.Http;
using System.Text.Json;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The data port the <see cref="AiProviderSectionViewModel"/> binds to (P1/S8 state-holder seam) for the one
/// network effect the web provider section owns: the pre-flight probe (web <c>useValidateAiProvider</c> →
/// <c>POST /settings/ai/validate-config</c>). The view never performs HTTP itself; the concrete
/// <see cref="AiProviderValidationSource"/> (or a test fake) drives this. The draft itself is supplied by the
/// parent surface (the web component is controlled via <c>value</c> / <c>onChange</c> props), so there is no
/// read stream here — only the validate effect.
/// </summary>
public interface IAiProviderValidationSource
{
    /// <summary>
    /// Probe the supplied draft. Local mode pins private/loopback targets and rejects public egress; cloud
    /// mode runs a one-token chat probe. Never throws for an HTTP fault — a structured rejection, a transport
    /// fault and success are all returned as an <see cref="AiProviderValidationOutcome"/>.
    /// </summary>
    Task<AiProviderValidationOutcome> ValidateAsync(
        AiProviderDraft draft,
        bool isCloud,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// The contract-client-backed <see cref="IAiProviderValidationSource"/>. Posts the snake_case draft body
/// (built by <see cref="AiProviderValidationPayload"/>) to the generated <c>validate-config</c> operation and
/// classifies the result the way the web hook does: a 200 projects to a success outcome; a 422 is a
/// <em>validation verdict</em> (not an error) so its structured <c>code</c> becomes a typed rejection reason;
/// any other fault is classified through the shared <see cref="ApiErrorMapper"/> into a faulted outcome the
/// view localises. No HTTP touches the view.
/// </summary>
public sealed class AiProviderValidationSource : IAiProviderValidationSource
{
    /// <summary>The generated OpenAPI operation id for the provider validation probe.</summary>
    public const string ValidateOperation = "post_api_v1_settings_ai_validate_config";

    private const int UnprocessableEntity = 422;

    private readonly IApiClient _api;

    /// <summary>Creates the source over the shared contract client.</summary>
    public AiProviderValidationSource(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<AiProviderValidationOutcome> ValidateAsync(
        AiProviderDraft draft,
        bool isCloud,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(draft);

        var request = new ApiRequest(ValidateOperation, Body: AiProviderValidationPayload.Build(draft, isCloud));
        try
        {
            var body = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
            return AiProviderValidationOutcome.FromResponse(body);
        }
        catch (ApiException ex) when (ex.StatusCode == UnprocessableEntity)
        {
            // 422 is the validator's structured rejection — a validation outcome, not an error condition.
            return AiProviderValidationOutcome.Rejected(AiProviderValidationReasons.FromCode(ex.ErrorCode));
        }
        catch (ApiException ex)
        {
            return AiProviderValidationOutcome.Faulted(ApiErrorMapper.Map(ex));
        }
        catch (HttpRequestException ex)
        {
            return AiProviderValidationOutcome.Faulted(ApiErrorMapper.Map(ex));
        }
    }
}
