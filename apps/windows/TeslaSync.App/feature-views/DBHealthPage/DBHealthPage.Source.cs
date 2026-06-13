using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Diagnostics;

/// <summary>
/// The generated-client-backed <see cref="IDbHealthFeed"/> — the native data adapter for the DB-health surface. It
/// binds to the generated OpenAPI contract client (ADR-004) for the three diagnostics queries the web page runs:
/// <c>GET /dev-tools/db-stats</c> (web <c>useDBStats</c>), <c>GET /dev-tools/migration-status</c> (web
/// <c>useMigrations</c>) and <c>GET /dev-tools/runtime-info</c> (web <c>useConnectionPool</c>), none of which take
/// parameters. No HTTP touches the view; each response JSON round-trips through the tolerant snapshot parsers so the
/// snake_case Go wire shape is preserved losslessly. A non-success response surfaces as the client's
/// <see cref="ApiException"/> so the view-model can surface the per-source error / empty branches.
/// </summary>
public sealed class DbHealthClientFeed : IDbHealthFeed
{
    private readonly IApiClient _api;

    /// <summary>Creates the feed over the generated contract client.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    public DbHealthClientFeed(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<DbStatsSnapshot> FetchDbStatsAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(DbHealthRegistration.DbStatsOperation);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return DbStatsSnapshot.FromJson(json);
    }

    /// <inheritdoc />
    public async Task<MigrationSnapshot> FetchMigrationAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(DbHealthRegistration.MigrationOperation);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return MigrationSnapshot.FromJson(json);
    }

    /// <inheritdoc />
    public async Task<PoolSnapshot> FetchPoolAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(DbHealthRegistration.PoolOperation);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return PoolSnapshot.FromJson(json);
    }
}
