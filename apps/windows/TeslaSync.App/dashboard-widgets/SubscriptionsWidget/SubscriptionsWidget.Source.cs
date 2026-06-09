using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The repository-backed <see cref="ISubscriptionsSource"/> — the native data adapter for the Subscriptions
/// surface. It first resolves the primary vehicle from the shared <see cref="IWidgetVehicleSource"/> (the
/// native analogue of the web component's <c>vehicleId ?? vehicles?.[0]?.id</c>), then performs the single
/// cache-then-network read of <c>GET /vehicles/{vehicleID}/subscriptions</c> (generated operation
/// <see cref="SubscriptionsRegistration.SubscriptionsOperationId"/>, the web <c>useVehicleSubscriptions</c>
/// query) and projects the <c>{ data, fetched_at }</c> envelope into a cacheable
/// <see cref="SubscriptionsSnapshot"/>. When no vehicle is available the read short-circuits to
/// <see cref="RepositoryResult{T}.Empty"/>, mirroring the web hook's disabled query
/// (<c>enabled: !!vehicleId</c>) collapsing <c>subsData</c> to null. No HTTP touches the view.
/// </summary>
public sealed class SubscriptionsSource : ISubscriptionsSource
{
    private readonly IWidgetVehicleSource _vehicles;
    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;
    private readonly long? _vehicleId;

    /// <summary>Creates the source over the vehicle source, contract client, engine and JSON settings.</summary>
    /// <param name="vehicles">Resolves the primary (or explicit) vehicle to scope the read to.</param>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    /// <param name="vehicleId">An explicit vehicle id; when null the primary cached vehicle is used.</param>
    public SubscriptionsSource(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        long? vehicleId = null)
    {
        ArgumentNullException.ThrowIfNull(vehicles);
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _vehicles = vehicles;
        _api = api;
        _engine = engine;
        _json = options.Json;
        _vehicleId = vehicleId;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<SubscriptionsSnapshot>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        long? vehicleId = await ResolveVehicleIdAsync(cancellationToken).ConfigureAwait(false);
        if (vehicleId is not { } vid)
        {
            // Web parity: with no vehicle the useVehicleSubscriptions query is disabled and `subsData` is null,
            // which parses to an empty list → the "No subscriptions" empty surface.
            yield return RepositoryResult<SubscriptionsSnapshot>.Empty();
            yield break;
        }

        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"vehicles:{vid}:subscriptions");
        var request = new ApiRequest(
            SubscriptionsRegistration.SubscriptionsOperationId,
            PathParams: new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [SubscriptionsRegistration.VehiclePathParam] = vid.ToString(CultureInfo.InvariantCulture),
            });

        // The snapshot is always a meaningful value (an empty subscription list is rendered as the widget's
        // own empty surface, not the engine's generic Empty), so nothing is treated as empty here.
        var stream = _engine.StreamAsync(
            cacheKey,
            ct => FetchAsync(request, ct),
            static _ => false,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in stream.ConfigureAwait(false))
        {
            yield return emission;
        }
    }

    private async Task<SubscriptionsSnapshot> FetchAsync(ApiRequest request, CancellationToken cancellationToken)
    {
        var envelope = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return SubscriptionsSnapshot.FromEnvelope(envelope);
    }

    private async Task<long?> ResolveVehicleIdAsync(CancellationToken cancellationToken)
    {
        if (_vehicleId is { } explicitId)
        {
            return explicitId;
        }

        var primary = await _vehicles.GetPrimaryAsync(cancellationToken).ConfigureAwait(false);
        return primary?.VehicleId;
    }
}
