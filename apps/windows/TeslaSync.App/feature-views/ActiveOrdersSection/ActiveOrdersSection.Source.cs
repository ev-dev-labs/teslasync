using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews.Settings;

/// <summary>
/// The data port the <see cref="ActiveOrdersSectionViewModel"/> binds to (P1/S8 state-holder seam). It exposes
/// the two operations the web component composes — the cache-then-network read of the Tesla user orders (web
/// <c>useTeslaUserOrders</c> → <c>GET /tesla/user/orders</c>) and the refresh mutation (web
/// <c>useRefreshTeslaOrders</c> → <c>POST /tesla/user/orders/refresh</c>). The view never performs HTTP
/// itself; the concrete <see cref="ActiveOrdersSource"/> (or a test fake) drives this.
/// </summary>
public interface IActiveOrdersSource
{
    /// <summary>Stream the cache-then-network orders snapshots, cached first.</summary>
    IAsyncEnumerable<RepositoryResult<OrdersSnapshot>> StreamOrdersAsync(
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Run the refresh mutation, asking the backend to re-pull the orders from Tesla. Never throws for an API
    /// failure — it maps the fault to a classified <see cref="OrdersRefreshOutcome"/> (the web mutation's
    /// <c>onError</c> path) — but propagates <see cref="OperationCanceledException"/> so a superseding run can
    /// cancel.
    /// </summary>
    Task<OrdersRefreshOutcome> RefreshAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IActiveOrdersSource"/> — the native data adapter for the active-orders
/// surface. The read runs one cache-then-network pass through the shared <see cref="CacheThenNetworkEngine"/>,
/// caching the raw JSON so the snake_case envelope round-trips losslessly, then maps each emission to a typed
/// <see cref="OrdersSnapshot"/> via <see cref="ActiveOrdersResultMapper"/> (generated operation
/// <c>get_api_v1_tesla_user_orders</c>). The refresh sends the write operation
/// <c>post_api_v1_tesla_user_orders_refresh</c> through the same <see cref="IApiClient"/> pipeline (auth +
/// resilience), classifying any fault through <see cref="ApiErrorMapper"/>. No HTTP touches the view.
/// </summary>
public sealed class ActiveOrdersSource : IActiveOrdersSource
{
    /// <summary>The generated OpenAPI operation id for the orders read.</summary>
    public const string OrdersOperation = "get_api_v1_tesla_user_orders";

    /// <summary>The generated OpenAPI operation id for the orders refresh mutation.</summary>
    public const string RefreshOperation = "post_api_v1_tesla_user_orders_refresh";

    private const string CacheKey = "tesla:user:orders";

    // Web parity: useTeslaUserOrders sets staleTime: STALE_TIMES.SLOW (5 minutes); the engine flags a cached
    // snapshot older than this window as stale so the header shows the refreshing chip.
    private const int SlowStaleSeconds = 300;

    private static readonly ApiRequest OrdersRequest = new(OrdersOperation);
    private static readonly ApiRequest RefreshRequest = new(RefreshOperation);

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    public ActiveOrdersSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<OrdersSnapshot>> StreamOrdersAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var raw = _engine.StreamAsync<JsonElement>(
            CacheKey,
            ct => _api.SendAsync<JsonElement>(OrdersRequest, ct),
            IsEmptyResponse,
            _json,
            SlowStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return ActiveOrdersResultMapper.Map(emission);
        }
    }

    /// <inheritdoc />
    public async Task<OrdersRefreshOutcome> RefreshAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            await _api.SendAsync<JsonElement>(RefreshRequest, cancellationToken).ConfigureAwait(false);
            return OrdersRefreshOutcome.Success();
        }
        catch (OperationCanceledException)
        {
            // A superseding run (or disposal) cancelled this one — let the caller drop it silently.
            throw;
        }
        catch (Exception ex)
        {
            return OrdersRefreshOutcome.Failure(ApiErrorMapper.Map(ex));
        }
    }

    // A null / non-object body carries no usable envelope (web parity: the query has no data → empty state
    // with no header timestamp). A valid envelope with an empty orders array is NOT treated as empty here: the
    // engine keeps the payload so the header's "Synced {when}" survives, and the body's empty state is derived
    // from the zero order count downstream (web: orders.length === 0 → empty body with the "no active orders"
    // copy).
    private static bool IsEmptyResponse(JsonElement element) => element.ValueKind != JsonValueKind.Object;
}
