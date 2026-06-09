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
/// The data port the <see cref="SignalCatalogViewModel"/> binds to (P1/S8 state-holder seam). It
/// exposes the two cache-then-network sequences the web <c>SignalCatalogWidget</c> composes — the
/// global signal catalog (<c>GET /signals/catalog</c>, web <c>useSignalCatalog</c>) and the per-vehicle
/// observation feed (<c>GET /signals/observations?vehicle_id=</c>, web <c>useSignalObservations</c>
/// with the <c>vehicleId ?? vehicles[0].id</c> resolution and <c>enabled: !!vehicleId</c> gate). The
/// view never performs HTTP itself; the concrete <see cref="SignalCatalogSource"/> (or a test fake)
/// drives this.
/// </summary>
public interface ISignalCatalogSource
{
    /// <summary>Stream the cache-then-network global signal-catalog snapshots.</summary>
    IAsyncEnumerable<RepositoryResult<IReadOnlyList<SignalCatalogEntryModel>>> StreamCatalogAsync(CancellationToken cancellationToken = default);

    /// <summary>Stream the cache-then-network per-vehicle observation snapshots (empty when no vehicle is resolved).</summary>
    IAsyncEnumerable<RepositoryResult<IReadOnlyList<SignalObservationModel>>> StreamObservationsAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="ISignalCatalogSource"/> — the native data adapter for the Signal
/// Catalog surface. It runs two independent cache-then-network reads through the shared
/// <see cref="CacheThenNetworkEngine"/>, caching the raw JSON so the snake_case wire shape round-trips
/// losslessly: <c>GET /signals/catalog</c> (operation <c>get_api_v1_signals_catalog</c>) and, after
/// resolving the primary (or explicit) vehicle from the shared <see cref="IWidgetVehicleSource"/>,
/// <c>GET /signals/observations?vehicle_id={id}</c> (operation <c>get_api_v1_signals_observations</c>).
/// When no vehicle is available the observation read short-circuits to
/// <see cref="RepositoryResult{T}.Empty"/>, mirroring the web hook's disabled query
/// (<c>enabled: !!vehicleId</c>). No HTTP touches the view.
/// </summary>
public sealed class SignalCatalogSource : ISignalCatalogSource
{
    // The catalog operation is shared with TelemetrySignalsRepository (Operations.Signals.Catalog); the
    // observations operation has no Operations.cs entry yet, so it is referenced verbatim here (scoped
    // to this surface) and resolves against TeslaSync.Windows.Generated.Api.ApiEndpoints.
    private const string CatalogOperation = "get_api_v1_signals_catalog";
    private const string ObservationsOperation = "get_api_v1_signals_observations";
    private const string CatalogCacheKey = "signals:catalog";
    private const string VehicleQueryParam = "vehicle_id";

    private readonly IWidgetVehicleSource _vehicles;
    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;
    private readonly long? _vehicleId;

    /// <summary>Creates the source over the vehicle source, contract client, engine and JSON settings.</summary>
    /// <param name="vehicles">Resolves the primary (or explicit) vehicle to scope the observation read to.</param>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    /// <param name="vehicleId">An explicit vehicle id; when null the primary cached vehicle is used.</param>
    public SignalCatalogSource(
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
    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<SignalCatalogEntryModel>>> StreamCatalogAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var request = new ApiRequest(CatalogOperation);
        var raw = _engine.StreamAsync<JsonElement>(
            CatalogCacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            IsEmptyCatalog,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return SignalCatalogResultMapper.Map(emission);
        }
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<SignalObservationModel>>> StreamObservationsAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        long? vehicleId = await ResolveVehicleIdAsync(cancellationToken).ConfigureAwait(false);
        if (vehicleId is not { } vid)
        {
            // Web parity: with no vehicle the useSignalObservations query is disabled and the data is empty.
            yield return RepositoryResult<IReadOnlyList<SignalObservationModel>>.Empty();
            yield break;
        }

        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"signals:observations:{vid}");
        var request = new ApiRequest(
            ObservationsOperation,
            Query: new Dictionary<string, object?>(StringComparer.Ordinal) { [VehicleQueryParam] = vid });

        var raw = _engine.StreamAsync<JsonElement>(
            cacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            IsEmptyObservations,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return SignalObservationsResultMapper.Map(emission);
        }
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

    // The catalog returns {signals: [...]}; treat a missing/empty signals array (or a non-object body)
    // as the empty terminal so the view-model renders the "No signals in catalog" surface.
    private static bool IsEmptyCatalog(JsonElement element) => IsEmptyArrayUnder(element, "signals");

    // The observations endpoint returns {count, total, observations: [...]}; an empty observations
    // array contributes no counts.
    private static bool IsEmptyObservations(JsonElement element) => IsEmptyArrayUnder(element, "observations");

    private static bool IsEmptyArrayUnder(JsonElement element, string property)
    {
        if (element.ValueKind == JsonValueKind.Object && element.TryGetProperty(property, out var array))
        {
            return array.ValueKind != JsonValueKind.Array || array.GetArrayLength() == 0;
        }

        return element.ValueKind switch
        {
            JsonValueKind.Array => element.GetArrayLength() == 0,
            _ => true,
        };
    }
}
