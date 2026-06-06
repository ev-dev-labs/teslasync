using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using GeneratedApi = TeslaSync.Windows.Generated.Api;

namespace TeslaSync.App.Core.Data.Repositories;

/// <summary>Cache-then-network reads for drive share-links.</summary>
public interface ISharingRepository
{
    /// <summary>The existing share-links for a drive.</summary>
    IAsyncEnumerable<RepositoryResult<JsonElement>> GetDriveSharesAsync(long driveId, CancellationToken cancellationToken = default);

    /// <summary>Resolve a public share token to its (typed) <see cref="GeneratedApi.ShareToken"/>.</summary>
    IAsyncEnumerable<RepositoryResult<GeneratedApi.ShareToken>> GetShareAsync(string token, CancellationToken cancellationToken = default);
}

/// <summary>Default <see cref="ISharingRepository"/>.</summary>
public sealed class SharingRepository : RepositoryBase, ISharingRepository
{
    /// <summary>Creates the repository.</summary>
    public SharingRepository(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
        : base(api, engine, options)
    {
    }

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<JsonElement>> GetDriveSharesAsync(long driveId, CancellationToken cancellationToken = default) =>
        Stream<JsonElement>(
            $"sharing:drive:{driveId}",
            ApiRequest.WithPath(Operations.Sharing.DriveShares, "driveID", Id(driveId)),
            cancellationToken: cancellationToken);

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<GeneratedApi.ShareToken>> GetShareAsync(string token, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrEmpty(token);
        return Stream<GeneratedApi.ShareToken>(
            $"sharing:token:{token}",
            ApiRequest.WithPath(Operations.Sharing.ShareToken, "token", token),
            cancellationToken: cancellationToken);
    }
}
