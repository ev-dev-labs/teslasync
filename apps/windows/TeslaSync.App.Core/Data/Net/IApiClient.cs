using GeneratedApi = TeslaSync.Windows.Generated.Api;

namespace TeslaSync.App.Core.Data.Net;

/// <summary>
/// The single contract client the repositories use. It resolves a request against the
/// generated OpenAPI endpoint table, builds the URL (versioned exactly once), sends it
/// through the shared <see cref="HttpClient"/> pipeline (auth + resilience handlers),
/// and deserializes the response into the requested type using the shared JSON
/// settings. No repository talks to <see cref="HttpClient"/> directly.
/// </summary>
public interface IApiClient
{
    /// <summary>Resolves the generated endpoint descriptor for an operation id.</summary>
    GeneratedApi.EndpointDescriptor ResolveEndpoint(string operationId);

    /// <summary>Sends <paramref name="request"/> and deserializes the JSON response into <typeparamref name="T"/>.</summary>
    Task<T> SendAsync<T>(ApiRequest request, CancellationToken cancellationToken = default);
}
