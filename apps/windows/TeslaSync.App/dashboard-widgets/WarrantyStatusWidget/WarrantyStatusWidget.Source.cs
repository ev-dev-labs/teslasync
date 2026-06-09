using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The data port the <see cref="WarrantyStatusViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of parsed <see cref="WarrantyStatusSnapshot"/> values — the native analogue of
/// the web component's <c>useWarrantyDetails()</c> hook
/// (web/src/features/dashboard/widgets/WarrantyStatusWidget.tsx). The view never performs HTTP itself; the
/// concrete <see cref="WarrantyStatusSource"/> (or a test fake) drives this.
/// </summary>
public interface IWarrantyStatusSource
{
    /// <summary>Stream the cache-then-network warranty snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<WarrantyStatusSnapshot>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IWarrantyStatusSource"/> — the native data adapter for the Warranty Status
/// surface. It runs one cache-then-network read of <c>GET /tesla/warranty</c> (generated operation
/// <see cref="WarrantyStatusRegistration.WarrantyOperationId"/>, the web <c>useWarrantyDetails</c> query)
/// through the shared <see cref="CacheThenNetworkEngine"/> and projects the <c>{ data, fetched_at }</c>
/// envelope into a cacheable <see cref="WarrantyStatusSnapshot"/>. Unlike the vehicle-scoped surfaces, the web
/// hook passes no vehicle id, so the read is fleet-wide and needs no vehicle resolution. No HTTP touches the
/// view.
/// </summary>
public sealed class WarrantyStatusSource : IWarrantyStatusSource
{
    private const string CacheKey = "tesla:warranty";

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    public WarrantyStatusSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<WarrantyStatusSnapshot>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var request = new ApiRequest(WarrantyStatusRegistration.WarrantyOperationId);

        // The snapshot is always a meaningful value (a null warranty `data` renders the widget's own empty
        // surface, not the engine's generic Empty), so nothing is treated as empty here.
        var stream = _engine.StreamAsync(
            CacheKey,
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

    private async Task<WarrantyStatusSnapshot> FetchAsync(ApiRequest request, CancellationToken cancellationToken)
    {
        var envelope = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return WarrantyStatusSnapshot.FromEnvelope(envelope);
    }
}
