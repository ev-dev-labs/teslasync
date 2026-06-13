using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Forms;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// The read seam the <see cref="LiveSignalInspectorPageViewModel"/> binds to (P1/S8 state-holder layer) — the
/// native port of the page's only own data source (web/src/features/admin/pages/LiveSignalInspectorPage.tsx):
/// the <c>useVehicles → GET /vehicles</c> fleet list that fills the vehicle picker. The per-second live snapshot
/// (web <c>useVehicleLiveSignals</c>) is owned by the composed <see cref="LiveSignalsTable"/> surface through its
/// own <see cref="ILiveSignalsTableSource"/>, so it is deliberately not part of this feed. The view never performs
/// HTTP; the generated-client-backed <see cref="LiveSignalInspectorClientFeed"/> (or a test fake) drives this.
/// </summary>
public interface ILiveSignalInspectorFeed
{
    /// <summary>Fetch the fleet list for the vehicle picker (web <c>useVehicles → GET /vehicles</c>).</summary>
    Task<IReadOnlyList<VehicleOption>> FetchVehiclesAsync(CancellationToken cancellationToken);
}

/// <summary>The default feed — resolves to an empty fleet (the no-vehicle data state, no HTTP).</summary>
public sealed class EmptyLiveSignalInspectorFeed : ILiveSignalInspectorFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyLiveSignalInspectorFeed Instance { get; } = new();

    private EmptyLiveSignalInspectorFeed()
    {
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<VehicleOption>> FetchVehiclesAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult<IReadOnlyList<VehicleOption>>(Array.Empty<VehicleOption>());
    }
}

/// <summary>
/// The generated-client-backed <see cref="ILiveSignalInspectorFeed"/> — the native data adapter for the page's
/// fleet picker. It binds the web <c>useVehicles</c> source to the generated OpenAPI contract client (ADR-004):
/// <c>GET /vehicles</c> (operation <c>get_api_v1_vehicles</c>). The response JSON round-trips through the tolerant
/// <see cref="LiveSignalInspectorVehicles.ParseList"/> reader so the snake_case wire shape is preserved losslessly,
/// and a non-success response surfaces as the client's <see cref="ApiException"/> for the view-model's degrade
/// path. The client versions the path exactly once (never a double <c>/api/v1</c> prefix). No HTTP touches the view.
/// </summary>
public sealed class LiveSignalInspectorClientFeed : ILiveSignalInspectorFeed
{
    private readonly IApiClient _api;

    /// <summary>Creates the feed over the generated contract client.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    public LiveSignalInspectorClientFeed(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<VehicleOption>> FetchVehiclesAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(LiveSignalInspectorRegistration.VehiclesOperation);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return LiveSignalInspectorVehicles.ParseList(json);
    }
}

/// <summary>
/// The default <see cref="ILiveSignalsTableSource"/> for the composed snapshot — resolves to a single empty
/// snapshot so the hosted <see cref="LiveSignalsTable"/> renders its "no live signals cached" empty state without
/// any HTTP. The shell registers the page over this default (mirroring <c>EmptyLiveSignalInspectorFeed</c>); a host
/// that wires the page to the generated client supplies the repository-backed <see cref="LiveSignalsTableSource"/>
/// (or its <see cref="LiveSignalsTable.Create"/> factory) instead.
/// </summary>
public sealed class EmptyLiveSignalsTableSource : ILiveSignalsTableSource
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyLiveSignalsTableSource Instance { get; } = new();

    private EmptyLiveSignalsTableSource()
    {
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<LiveSignalRow>>> StreamLiveSignalsAsync(
        long vehicleId,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        await Task.CompletedTask.ConfigureAwait(false);
        yield return RepositoryResult<IReadOnlyList<LiveSignalRow>>.Empty(DateTimeOffset.UtcNow);
    }
}
