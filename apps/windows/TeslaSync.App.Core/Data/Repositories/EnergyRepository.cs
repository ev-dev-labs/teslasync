using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using GeneratedApi = TeslaSync.Windows.Generated.Api;

namespace TeslaSync.App.Core.Data.Repositories;

/// <summary>Cache-then-network reads for energy/efficiency stat rows.</summary>
public interface IEnergyRepository
{
    /// <summary>The energy analytics rows (SI: Wh, Wh/m, metres).</summary>
    IAsyncEnumerable<RepositoryResult<IReadOnlyList<GeneratedApi.EnergyStatsRow>>> GetEnergyStatsAsync(CancellationToken cancellationToken = default);
}

/// <summary>Default <see cref="IEnergyRepository"/>.</summary>
public sealed class EnergyRepository : RepositoryBase, IEnergyRepository
{
    /// <summary>Creates the repository.</summary>
    public EnergyRepository(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
        : base(api, engine, options)
    {
    }

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<IReadOnlyList<GeneratedApi.EnergyStatsRow>>> GetEnergyStatsAsync(CancellationToken cancellationToken = default) =>
        Stream<IReadOnlyList<GeneratedApi.EnergyStatsRow>>(
            "energy:analytics",
            new ApiRequest(Operations.Energy.Analytics),
            cancellationToken: cancellationToken);
}
