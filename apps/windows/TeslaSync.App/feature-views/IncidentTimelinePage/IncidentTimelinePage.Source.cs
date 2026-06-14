using System.Globalization;
using System.Net.Http;
using System.Text.Json;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews.SystemOps;

/// <summary>
/// The result of one incident-detail read — the native analogue of the web <c>useIncident</c> query resolving.
/// A success carries the parsed <see cref="Incident"/>; a 404 / fault carries a classified <see cref="Error"/>
/// (the web <c>error || !incident</c> branch) rather than throwing, so the view-model renders the never-blank
/// not-found surface instead of crashing.
/// </summary>
public sealed record IncidentTimelineFetch(IncidentDetail? Incident, RepositoryError? Error)
{
    /// <summary>A successful read.</summary>
    public static IncidentTimelineFetch Loaded(IncidentDetail incident) => new(incident, null);

    /// <summary>A classified failure (or a missing incident).</summary>
    public static IncidentTimelineFetch Failed(RepositoryError error) => new(null, error);
}

/// <summary>
/// The data port the <see cref="IncidentTimelinePageViewModel"/> binds to (P1/S8 state-holder seam) — the native
/// analogue of the web page's three hooks (web/src/features/system/pages/IncidentTimelinePage.tsx):
/// <c>useIncident</c> (the <c>GET /status/incidents/{id}</c> read the page is built around),
/// <c>useAppendIncidentUpdate</c> (the <c>POST /status/incidents/{id}/updates</c> write) and
/// <c>usePatchIncident</c> (the <c>PATCH /status/incidents/{id}</c> write the resolve action uses). The view never
/// performs HTTP itself; the concrete <see cref="IncidentTimelineClientSource"/> (or a test fake) drives this.
/// </summary>
public interface IIncidentTimelineSource
{
    /// <summary>Read one incident by id (web <c>useIncident(id)</c>). Never throws for an HTTP fault.</summary>
    Task<IncidentTimelineFetch> FetchAsync(long incidentId, CancellationToken cancellationToken = default);

    /// <summary>Append a timeline update (web <c>useAppendIncidentUpdate</c>). Never throws for an HTTP fault.</summary>
    Task<IncidentMutationOutcome> AppendUpdateAsync(
        long incidentId,
        AppendIncidentUpdateRequest request,
        CancellationToken cancellationToken = default);

    /// <summary>Patch the incident (web <c>usePatchIncident</c>; this page sends <c>resolved: true</c>). Never throws.</summary>
    Task<IncidentMutationOutcome> PatchAsync(
        long incidentId,
        PatchIncidentRequest request,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// The default source — resolves the read to the not-found surface and rejects the writes. It is what the shell
/// mounts until a DI host wires the generated-client-backed <see cref="IncidentTimelineClientSource"/> through
/// <see cref="IncidentTimelinePage.Create"/>, so the page always renders a real state (never a blank region)
/// rather than fabricating an incident.
/// </summary>
public sealed class EmptyIncidentTimelineSource : IIncidentTimelineSource
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyIncidentTimelineSource Instance { get; } = new();

    private EmptyIncidentTimelineSource()
    {
    }

    /// <inheritdoc />
    public Task<IncidentTimelineFetch> FetchAsync(long incidentId, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(IncidentTimelineFetch.Failed(
            new RepositoryError(RepositoryErrorKind.NotFound, "No incident source bound.")));
    }

    /// <inheritdoc />
    public Task<IncidentMutationOutcome> AppendUpdateAsync(
        long incidentId,
        AppendIncidentUpdateRequest request,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(IncidentMutationOutcome.Fail(
            new RepositoryError(RepositoryErrorKind.Offline, "No incident source bound.")));
    }

    /// <inheritdoc />
    public Task<IncidentMutationOutcome> PatchAsync(
        long incidentId,
        PatchIncidentRequest request,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(IncidentMutationOutcome.Fail(
            new RepositoryError(RepositoryErrorKind.Offline, "No incident source bound.")));
    }
}

/// <summary>
/// The generated-client-backed <see cref="IIncidentTimelineSource"/> — the native data adapter for the
/// post-mortem page (ADR-004). It binds the read and the two writes to the generated OpenAPI operations through
/// the shared <see cref="IApiClient"/> (the same auth + resilience pipeline the rest of the app shares), parses
/// each <c>{ … }</c> incident envelope through the tolerant <see cref="IncidentDetail"/> reader, and classifies
/// any fault through the shared <see cref="ApiErrorMapper"/> rather than throwing — so the view-model surfaces a
/// not-found region or a toast, never an unhandled rejection (web parity). No HTTP touches the view.
/// </summary>
public sealed class IncidentTimelineClientSource : IIncidentTimelineSource
{
    private readonly IApiClient _api;

    /// <summary>Creates the source over the shared contract client.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    public IncidentTimelineClientSource(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<IncidentTimelineFetch> FetchAsync(long incidentId, CancellationToken cancellationToken = default)
    {
        var request = ApiRequest.WithPath(
            IncidentTimelineRegistration.FetchOperation,
            IncidentTimelineRegistration.IdParam,
            incidentId.ToString(CultureInfo.InvariantCulture));
        try
        {
            var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
            return IncidentDetail.FromJson(json) is { } incident
                ? IncidentTimelineFetch.Loaded(incident)
                : IncidentTimelineFetch.Failed(
                    new RepositoryError(RepositoryErrorKind.NotFound, "Incident not found."));
        }
        catch (ApiException ex)
        {
            return IncidentTimelineFetch.Failed(ApiErrorMapper.Map(ex));
        }
        catch (HttpRequestException ex)
        {
            return IncidentTimelineFetch.Failed(ApiErrorMapper.Map(ex));
        }
    }

    /// <inheritdoc />
    public Task<IncidentMutationOutcome> AppendUpdateAsync(
        long incidentId,
        AppendIncidentUpdateRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        var apiRequest = new ApiRequest(
            IncidentTimelineRegistration.AppendOperation,
            PathParams: PathFor(incidentId),
            Body: request);
        return MutateAsync(apiRequest, cancellationToken);
    }

    /// <inheritdoc />
    public Task<IncidentMutationOutcome> PatchAsync(
        long incidentId,
        PatchIncidentRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        var apiRequest = new ApiRequest(
            IncidentTimelineRegistration.PatchOperation,
            PathParams: PathFor(incidentId),
            Body: request);
        return MutateAsync(apiRequest, cancellationToken);
    }

    private static Dictionary<string, string> PathFor(long incidentId) =>
        new(StringComparer.Ordinal)
        {
            [IncidentTimelineRegistration.IdParam] = incidentId.ToString(CultureInfo.InvariantCulture),
        };

    private async Task<IncidentMutationOutcome> MutateAsync(ApiRequest request, CancellationToken cancellationToken = default)
    {
        try
        {
            var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
            return IncidentMutationOutcome.Ok(IncidentDetail.FromJson(json));
        }
        catch (ApiException ex)
        {
            return IncidentMutationOutcome.Fail(ApiErrorMapper.Map(ex));
        }
        catch (HttpRequestException ex)
        {
            return IncidentMutationOutcome.Fail(ApiErrorMapper.Map(ex));
        }
    }
}
