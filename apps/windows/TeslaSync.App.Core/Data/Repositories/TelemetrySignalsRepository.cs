using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.Core.Data.Repositories;

/// <summary>Cache-then-network reads for the telemetry signal catalog, availability and history.</summary>
public interface ITelemetrySignalsRepository
{
    /// <summary>The signals a vehicle currently exposes.</summary>
    IAsyncEnumerable<RepositoryResult<JsonElement>> GetAvailableAsync(long vehicleId, CancellationToken cancellationToken = default);

    /// <summary>The historical series for one signal on one vehicle.</summary>
    IAsyncEnumerable<RepositoryResult<JsonElement>> GetHistoryAsync(long vehicleId, string signalName, CancellationToken cancellationToken = default);

    /// <summary>The catalog of all known signals.</summary>
    IAsyncEnumerable<RepositoryResult<JsonElement>> GetCatalogAsync(CancellationToken cancellationToken = default);
}

/// <summary>Default <see cref="ITelemetrySignalsRepository"/>.</summary>
public sealed class TelemetrySignalsRepository : RepositoryBase, ITelemetrySignalsRepository
{
    /// <summary>Creates the repository.</summary>
    public TelemetrySignalsRepository(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
        : base(api, engine, options)
    {
    }

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<JsonElement>> GetAvailableAsync(long vehicleId, CancellationToken cancellationToken = default) =>
        Stream<JsonElement>(
            $"signals:{vehicleId}:available",
            ApiRequest.WithPath(Operations.Signals.Available, "vehicleID", Id(vehicleId)),
            cancellationToken: cancellationToken);

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<JsonElement>> GetHistoryAsync(long vehicleId, string signalName, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrEmpty(signalName);
        var pathParams = new Dictionary<string, string>
        {
            ["vehicleID"] = Id(vehicleId),
            ["signalName"] = signalName,
        };
        return Stream<JsonElement>(
            $"signals:{vehicleId}:{signalName}:history",
            new ApiRequest(Operations.Signals.History, pathParams),
            cancellationToken: cancellationToken);
    }

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<JsonElement>> GetCatalogAsync(CancellationToken cancellationToken = default) =>
        Stream<JsonElement>("signals:catalog", new ApiRequest(Operations.Signals.Catalog), cancellationToken: cancellationToken);
}
