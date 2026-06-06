using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.Core.Data.Repositories;

/// <summary>Cache-then-network reads for automations, their history and presets.</summary>
public interface IAutomationRepository
{
    /// <summary>The automation list.</summary>
    IAsyncEnumerable<RepositoryResult<JsonElement>> ListAsync(CancellationToken cancellationToken = default);

    /// <summary>A single automation's detail.</summary>
    IAsyncEnumerable<RepositoryResult<JsonElement>> GetAsync(long automationId, CancellationToken cancellationToken = default);

    /// <summary>Automation run history.</summary>
    IAsyncEnumerable<RepositoryResult<JsonElement>> GetHistoryAsync(CancellationToken cancellationToken = default);

    /// <summary>Automation presets.</summary>
    IAsyncEnumerable<RepositoryResult<JsonElement>> GetPresetsAsync(CancellationToken cancellationToken = default);
}

/// <summary>Default <see cref="IAutomationRepository"/>.</summary>
public sealed class AutomationRepository : RepositoryBase, IAutomationRepository
{
    /// <summary>Creates the repository.</summary>
    public AutomationRepository(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
        : base(api, engine, options)
    {
    }

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<JsonElement>> ListAsync(CancellationToken cancellationToken = default) =>
        Stream<JsonElement>("automations:list", new ApiRequest(Operations.Automations.List), cancellationToken: cancellationToken);

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<JsonElement>> GetAsync(long automationId, CancellationToken cancellationToken = default) =>
        Stream<JsonElement>(
            $"automations:{automationId}",
            ApiRequest.WithPath(Operations.Automations.Detail, "id", Id(automationId)),
            cancellationToken: cancellationToken);

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<JsonElement>> GetHistoryAsync(CancellationToken cancellationToken = default) =>
        Stream<JsonElement>("automations:history", new ApiRequest(Operations.Automations.History), cancellationToken: cancellationToken);

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<JsonElement>> GetPresetsAsync(CancellationToken cancellationToken = default) =>
        Stream<JsonElement>("automations:presets", new ApiRequest(Operations.Automations.Presets), cancellationToken: cancellationToken);
}
