using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.Core.Data.Repositories;

/// <summary>Cache-then-network reads for trip rollups.</summary>
public interface ITripRepository
{
    /// <summary>The trip list.</summary>
    IAsyncEnumerable<RepositoryResult<JsonElement>> ListAsync(CancellationToken cancellationToken = default);

    /// <summary>A single trip's detail.</summary>
    IAsyncEnumerable<RepositoryResult<JsonElement>> GetAsync(string tripId, CancellationToken cancellationToken = default);
}

/// <summary>Default <see cref="ITripRepository"/>.</summary>
public sealed class TripRepository : RepositoryBase, ITripRepository
{
    /// <summary>Creates the repository.</summary>
    public TripRepository(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
        : base(api, engine, options)
    {
    }

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<JsonElement>> ListAsync(CancellationToken cancellationToken = default) =>
        Stream<JsonElement>("trips:list", new ApiRequest(Operations.Trips.List), cancellationToken: cancellationToken);

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<JsonElement>> GetAsync(string tripId, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrEmpty(tripId);
        return Stream<JsonElement>(
            $"trips:{tripId}",
            ApiRequest.WithPath(Operations.Trips.Detail, "trip_id", tripId),
            cancellationToken: cancellationToken);
    }
}
