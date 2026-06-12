using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews.Dashboard;

/// <summary>
/// The generated-client-backed <see cref="IAuthStatusSource"/> — the native data adapter for the dashboard's
/// connected-account read and the C# port of the web <c>useAuthStatus</c> hook (web/src/api/hooks/useSettings.ts).
/// It runs one cache-then-network read of <c>GET /auth/status</c> (generated operation
/// <c>get_api_v1_auth_status</c>) through the shared <see cref="CacheThenNetworkEngine"/>, caching the raw JSON so
/// the snake_case wire shape round-trips losslessly, and parses each emission into a
/// <see cref="DashboardAuthStatus"/>. No HTTP touches the view.
/// </summary>
public sealed class AuthStatusClientSource : IAuthStatusSource
{
    private const string AuthStatusOperationId = "get_api_v1_auth_status";
    private const string CacheKey = "auth:status";

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    public AuthStatusClientSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<DashboardAuthStatus>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var request = new ApiRequest(AuthStatusOperationId);
        var raw = _engine.StreamAsync<JsonElement>(
            CacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            IsAbsent,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return Map(emission);
        }
    }

    /// <summary>True only for a null / undefined body — an <c>{ authenticated: false }</c> object is a real result.</summary>
    private static bool IsAbsent(JsonElement element) =>
        element.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined;

    private static RepositoryResult<DashboardAuthStatus> Map(RepositoryResult<JsonElement> raw)
    {
        if (raw.HasValue)
        {
            var auth = DashboardAuthStatus.FromJson(raw.Value);
            return new RepositoryResult<DashboardAuthStatus>(raw.Status, auth, raw.FetchedAt, raw.IsStale, raw.Error);
        }

        return new RepositoryResult<DashboardAuthStatus>(raw.Status, default, raw.FetchedAt, raw.IsStale, raw.Error);
    }
}

/// <summary>
/// The generated-client-backed <see cref="IVehicleSyncGateway"/> — the native data adapter for the dashboard's
/// "Sync Vehicles" command and the C# port of the web <c>useSyncVehicles</c> mutation (web/src/api/hooks/
/// useVehicles.ts). It runs one <c>POST /vehicles/sync</c> (generated operation <c>post_api_v1_vehicles_sync</c>)
/// through the shared contract client and reports success or the classified failure via
/// <see cref="ApiErrorMapper"/>. No HTTP touches the view.
/// </summary>
public sealed class VehicleSyncClientGateway : IVehicleSyncGateway
{
    private const string SyncOperationId = "post_api_v1_vehicles_sync";

    private readonly IApiClient _api;
    private readonly Func<DateTimeOffset> _clock;

    /// <summary>Creates the gateway over the contract client and (optional) clock.</summary>
    public VehicleSyncClientGateway(IApiClient api, Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
        _clock = clock ?? (() => DateTimeOffset.UtcNow);
    }

    /// <inheritdoc />
    public async Task<RepositoryResult<bool>> SyncAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            await _api.SendAsync<JsonElement>(new ApiRequest(SyncOperationId), cancellationToken).ConfigureAwait(false);
            return RepositoryResult<bool>.Loaded(true, _clock());
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            return RepositoryResult<bool>.Failure(ApiErrorMapper.Map(ex));
        }
    }
}
