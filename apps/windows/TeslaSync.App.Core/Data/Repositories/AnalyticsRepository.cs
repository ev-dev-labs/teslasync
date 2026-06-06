using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.Core.Data.Repositories;

/// <summary>
/// Cache-then-network reads for the analytics endpoints. These return contract JSON the
/// OpenAPI document does not give a typed schema for, so they surface as
/// <see cref="JsonElement"/> read models (W7 binds the documented fields directly).
/// </summary>
public interface IAnalyticsRepository
{
    /// <summary>Fleet-level rollup.</summary>
    IAsyncEnumerable<RepositoryResult<JsonElement>> GetFleetAsync(CancellationToken cancellationToken = default);

    /// <summary>Total cost of ownership.</summary>
    IAsyncEnumerable<RepositoryResult<JsonElement>> GetTcoAsync(CancellationToken cancellationToken = default);

    /// <summary>Battery degradation curve.</summary>
    IAsyncEnumerable<RepositoryResult<JsonElement>> GetBatteryDegradationAsync(CancellationToken cancellationToken = default);

    /// <summary>Battery health summary.</summary>
    IAsyncEnumerable<RepositoryResult<JsonElement>> GetBatteryHealthAsync(CancellationToken cancellationToken = default);

    /// <summary>Regenerative-braking analytics.</summary>
    IAsyncEnumerable<RepositoryResult<JsonElement>> GetRegenAsync(CancellationToken cancellationToken = default);

    /// <summary>Sleep/idle analytics.</summary>
    IAsyncEnumerable<RepositoryResult<JsonElement>> GetSleepAsync(CancellationToken cancellationToken = default);

    /// <summary>Speed-profile distribution.</summary>
    IAsyncEnumerable<RepositoryResult<JsonElement>> GetSpeedProfileAsync(CancellationToken cancellationToken = default);

    /// <summary>Temperature-impact analytics.</summary>
    IAsyncEnumerable<RepositoryResult<JsonElement>> GetTemperatureImpactAsync(CancellationToken cancellationToken = default);

    /// <summary>Route-efficiency analytics.</summary>
    IAsyncEnumerable<RepositoryResult<JsonElement>> GetRouteEfficiencyAsync(CancellationToken cancellationToken = default);

    /// <summary>Lifetime totals.</summary>
    IAsyncEnumerable<RepositoryResult<JsonElement>> GetLifetimeAsync(CancellationToken cancellationToken = default);
}

/// <summary>Default <see cref="IAnalyticsRepository"/>.</summary>
public sealed class AnalyticsRepository : RepositoryBase, IAnalyticsRepository
{
    /// <summary>Creates the repository.</summary>
    public AnalyticsRepository(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
        : base(api, engine, options)
    {
    }

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<JsonElement>> GetFleetAsync(CancellationToken cancellationToken = default) =>
        Read("analytics:fleet", Operations.Analytics.Fleet, cancellationToken);

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<JsonElement>> GetTcoAsync(CancellationToken cancellationToken = default) =>
        Read("analytics:tco", Operations.Analytics.Tco, cancellationToken);

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<JsonElement>> GetBatteryDegradationAsync(CancellationToken cancellationToken = default) =>
        Read("analytics:battery-degradation", Operations.Analytics.BatteryDegradation, cancellationToken);

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<JsonElement>> GetBatteryHealthAsync(CancellationToken cancellationToken = default) =>
        Read("analytics:battery-health", Operations.Analytics.BatteryHealth, cancellationToken);

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<JsonElement>> GetRegenAsync(CancellationToken cancellationToken = default) =>
        Read("analytics:regen", Operations.Analytics.Regen, cancellationToken);

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<JsonElement>> GetSleepAsync(CancellationToken cancellationToken = default) =>
        Read("analytics:sleep", Operations.Analytics.Sleep, cancellationToken);

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<JsonElement>> GetSpeedProfileAsync(CancellationToken cancellationToken = default) =>
        Read("analytics:speed-profile", Operations.Analytics.SpeedProfile, cancellationToken);

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<JsonElement>> GetTemperatureImpactAsync(CancellationToken cancellationToken = default) =>
        Read("analytics:temperature-impact", Operations.Analytics.TemperatureImpact, cancellationToken);

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<JsonElement>> GetRouteEfficiencyAsync(CancellationToken cancellationToken = default) =>
        Read("analytics:route-efficiency", Operations.Analytics.RouteEfficiency, cancellationToken);

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<JsonElement>> GetLifetimeAsync(CancellationToken cancellationToken = default) =>
        Read("analytics:lifetime", Operations.Analytics.Lifetime, cancellationToken);

    private IAsyncEnumerable<RepositoryResult<JsonElement>> Read(string cacheKey, string operationId, CancellationToken cancellationToken) =>
        Stream<JsonElement>(cacheKey, new ApiRequest(operationId), cancellationToken: cancellationToken);
}
