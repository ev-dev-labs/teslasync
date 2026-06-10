using System.Net.Http;
using System.Text.Json;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutation port the <see cref="IncidentFormViewModel"/> binds to (P1/S8 state-holder seam) — the native
/// analogue of the web <c>useCreateIncident</c> hook (web/src/api/hooks/useIncidents.ts). It drives the single
/// <c>POST /status/incidents</c> write the form performs. The view never performs HTTP itself; the concrete
/// <see cref="IncidentCreateSource"/> (or a test fake) drives this.
/// </summary>
public interface IIncidentCreateSource
{
    /// <summary>
    /// Create an incident (web <c>create.mutateAsync(payload)</c>): <c>POST /status/incidents</c> with the
    /// assembled body. Returns success or a classified error — it never throws for an HTTP fault so the caller
    /// surfaces a toast rather than an unhandled rejection (web parity).
    /// </summary>
    Task<IncidentFormSubmitOutcome> CreateAsync(IncidentCreateRequest request, CancellationToken cancellationToken = default);
}

/// <summary>
/// The contract-client-backed <see cref="IIncidentCreateSource"/> — the native data adapter for the incident
/// form. It POSTs the assembled body to the generated <c>post_api_v1_status_incidents</c> endpoint through the
/// shared <see cref="IApiClient"/> (the same auth + resilience pipeline the rest of the app shares) and
/// classifies any fault through the shared <see cref="ApiErrorMapper"/> rather than throwing. The created
/// incident row in the response is discarded — the form only needs success/failure, exactly like the web
/// mutation, whose <c>onSuccess</c> simply invalidates the list and closes the modal. No HTTP touches the view.
/// </summary>
public sealed class IncidentCreateSource : IIncidentCreateSource
{
    /// <summary>The generated OpenAPI operation id for <c>POST /api/v1/status/incidents</c>.</summary>
    public const string CreateOperation = "post_api_v1_status_incidents";

    private readonly IApiClient _api;

    /// <summary>Creates the source over the shared contract client.</summary>
    /// <param name="api">The generated contract client used for the create POST.</param>
    public IncidentCreateSource(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<IncidentFormSubmitOutcome> CreateAsync(
        IncidentCreateRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        var apiRequest = new ApiRequest(CreateOperation, Body: request);
        try
        {
            _ = await _api.SendAsync<JsonElement>(apiRequest, cancellationToken).ConfigureAwait(false);
            return IncidentFormSubmitOutcome.Ok();
        }
        catch (ApiException ex)
        {
            return IncidentFormSubmitOutcome.Fail(ApiErrorMapper.Map(ex));
        }
        catch (HttpRequestException ex)
        {
            return IncidentFormSubmitOutcome.Fail(ApiErrorMapper.Map(ex));
        }
    }
}
