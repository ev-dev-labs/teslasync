using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.Core.Data.Repositories;

/// <summary>Cache-then-network reads for user settings, polling config and dashboard layouts.</summary>
public interface ISettingsRepository
{
    /// <summary>The user's settings document.</summary>
    IAsyncEnumerable<RepositoryResult<JsonElement>> GetSettingsAsync(CancellationToken cancellationToken = default);

    /// <summary>The polling configuration.</summary>
    IAsyncEnumerable<RepositoryResult<JsonElement>> GetPollingConfigAsync(CancellationToken cancellationToken = default);

    /// <summary>Saved dashboard layouts.</summary>
    IAsyncEnumerable<RepositoryResult<JsonElement>> GetDashboardLayoutsAsync(CancellationToken cancellationToken = default);
}

/// <summary>Default <see cref="ISettingsRepository"/>.</summary>
public sealed class SettingsRepository : RepositoryBase, ISettingsRepository
{
    /// <summary>Creates the repository.</summary>
    public SettingsRepository(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
        : base(api, engine, options)
    {
    }

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<JsonElement>> GetSettingsAsync(CancellationToken cancellationToken = default) =>
        Stream<JsonElement>("settings:get", new ApiRequest(Operations.Settings.Get), cancellationToken: cancellationToken);

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<JsonElement>> GetPollingConfigAsync(CancellationToken cancellationToken = default) =>
        Stream<JsonElement>("settings:polling-config", new ApiRequest(Operations.Settings.PollingConfig), cancellationToken: cancellationToken);

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<JsonElement>> GetDashboardLayoutsAsync(CancellationToken cancellationToken = default) =>
        Stream<JsonElement>("settings:dashboard-layouts", new ApiRequest(Operations.Settings.DashboardLayouts), cancellationToken: cancellationToken);
}
