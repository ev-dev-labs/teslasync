using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Telemetry;

/// <summary>
/// The read seam the <see cref="SignalGapDetectorPageViewModel"/> binds to (P1/S8 state-holder layer) — the native
/// port of the web page's data sources (web/src/features/telemetry/pages/SignalGapDetectorPage.tsx and the
/// <c>SignalCatalogPanel</c> it composes): the <c>useSelectedVehicle</c> fleet list that fills the vehicle picker and
/// the per-vehicle <c>useSignalGaps → GET /signals/{vehicleID}/live</c> read that fills the staleness catalog. Each
/// source is fetched independently so the view-model can mirror the web's no-vehicle guard and the catalog's
/// loading / empty / error states. The view never performs HTTP; the contract-client-backed
/// <see cref="SignalGapDetectorClientFeed"/> (or a test fake) drives this.
/// </summary>
public interface ISignalGapDetectorFeed
{
    /// <summary>Fetch the fleet list for the vehicle picker (web <c>useSelectedVehicle → GET /vehicles</c>).</summary>
    Task<IReadOnlyList<SignalGapDetectorVehicle>> FetchVehiclesAsync(CancellationToken cancellationToken);

    /// <summary>
    /// Fetch the per-vehicle live-signal snapshot (web <c>useSignalGaps → GET /signals/{vehicleID}/live</c>): the
    /// name → { value, timestamp } map the staleness catalog is derived from.
    /// </summary>
    Task<IReadOnlyList<SignalGapLiveEntry>> FetchLiveSignalsAsync(long vehicleId, CancellationToken cancellationToken);
}

/// <summary>
/// The default feed — resolves to an empty fleet and an empty live-signal snapshot (the no-vehicle / empty-catalog
/// data states, no HTTP). It keeps the shell-registered <see cref="SignalGapDetectorPage"/> mountable without a
/// backend; the generated-client-backed source (<see cref="SignalGapDetectorClientFeed"/>) is wired separately from
/// the shared data layer (web's TanStack hooks).
/// </summary>
public sealed class EmptySignalGapDetectorFeed : ISignalGapDetectorFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptySignalGapDetectorFeed Instance { get; } = new();

    private EmptySignalGapDetectorFeed()
    {
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<SignalGapDetectorVehicle>> FetchVehiclesAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult<IReadOnlyList<SignalGapDetectorVehicle>>(Array.Empty<SignalGapDetectorVehicle>());
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<SignalGapLiveEntry>> FetchLiveSignalsAsync(long vehicleId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult<IReadOnlyList<SignalGapLiveEntry>>(Array.Empty<SignalGapLiveEntry>());
    }
}

/// <summary>
/// The generated-client-backed <see cref="ISignalGapDetectorFeed"/> — the native data adapter for the Signal Gap
/// Detector page. It binds the page's two web data sources to the generated OpenAPI contract client (ADR-004):
/// <c>GET /vehicles</c> (web <c>useSelectedVehicle</c>) and <c>GET /signals/{vehicleID}/live</c> (web
/// <c>useSignalGaps</c>). The per-vehicle read fills the <c>{vehicleID}</c> path slot; each response JSON round-trips
/// through the tolerant model parsers so the snake_case wire shape is preserved losslessly, and a non-success
/// response surfaces as the client's <see cref="ApiException"/> for the view-model's error branch. No HTTP touches the
/// view.
/// </summary>
public sealed class SignalGapDetectorClientFeed : ISignalGapDetectorFeed
{
    private readonly IApiClient _api;

    /// <summary>Creates the feed over the generated contract client.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    public SignalGapDetectorClientFeed(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<SignalGapDetectorVehicle>> FetchVehiclesAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(SignalGapDetectorRegistration.VehiclesOperation);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return SignalGapDetectorVehicle.ParseList(json);
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<SignalGapLiveEntry>> FetchLiveSignalsAsync(long vehicleId, CancellationToken cancellationToken)
    {
        var request = new ApiRequest(
            SignalGapDetectorRegistration.LiveOperation,
            PathParams: new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [SignalGapDetectorRegistration.VehiclePathParam] = vehicleId.ToString(CultureInfo.InvariantCulture),
            });

        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return SignalGapLiveEntry.ParseLive(json);
    }
}
