using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The data port the <see cref="FleetTelemetryHealthViewModel"/> binds to (P1/S8 state-holder seam). It
/// exposes the two independent cache-then-network reads the web devtools tool composes — the Fleet
/// Telemetry error-VIN list (web <c>useFleetTelemetryErrorVINs</c>) and the per-VIN error feed (web
/// <c>useFleetTelemetryErrors</c>, which re-queries when a VIN is selected) — plus the two
/// "Refresh from Tesla" mutations (web <c>useRefreshFleetTelemetryErrorVINs</c> /
/// <c>useRefreshFleetTelemetryErrors</c>). The view never performs HTTP itself; the concrete
/// <see cref="FleetTelemetryHealthSource"/> (or a test fake) drives this.
/// </summary>
public interface IFleetTelemetryHealthSource
{
    /// <summary>Stream the cache-then-network error-VIN snapshots, cached first.</summary>
    IAsyncEnumerable<RepositoryResult<IReadOnlyList<FleetTelemetryErrorVin>>> StreamErrorVinsAsync(
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Stream the cache-then-network error snapshots, optionally filtered to one <paramref name="vin"/>
    /// (web <c>useFleetTelemetryErrors(selectedVin || undefined)</c>). A null/empty VIN reads the full feed.
    /// </summary>
    IAsyncEnumerable<RepositoryResult<IReadOnlyList<FleetTelemetryError>>> StreamErrorsAsync(
        string? vin,
        CancellationToken cancellationToken = default);

    /// <summary>Ask the server to re-pull the error-VIN list from Tesla (web POST <c>.../error-vins/refresh</c>).</summary>
    Task RefreshErrorVinsAsync(CancellationToken cancellationToken = default);

    /// <summary>Ask the server to re-pull the error feed from Tesla (web POST <c>.../errors/refresh</c>).</summary>
    Task RefreshErrorsAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IFleetTelemetryHealthSource"/> — the native data adapter for the Fleet
/// Telemetry health surface. It runs two independent cache-then-network reads through the shared
/// <see cref="CacheThenNetworkEngine"/>, caching the raw JSON so the snake_case wire shape round-trips
/// losslessly, then maps each emission to a typed list via <see cref="FleetTelemetryHealthResultMapper"/>:
/// <c>GET /tesla/fleet-telemetry/error-vins</c> (generated operation
/// <c>get_api_v1_tesla_fleet_telemetry_error_vins</c>) and
/// <c>GET /tesla/fleet-telemetry/errors[?vin=]</c> (<c>get_api_v1_tesla_fleet_telemetry_errors</c>). The two
/// "Refresh from Tesla" actions POST to the generated refresh operations. No HTTP touches the view.
/// </summary>
public sealed class FleetTelemetryHealthSource : IFleetTelemetryHealthSource
{
    // The tesla fleet-telemetry handler post-dates the Operations.cs codegen seam, so these generated
    // operation ids are referenced verbatim here (the only file scoped to this surface). All four resolve
    // against TeslaSync.Windows.Generated.Api.ApiEndpoints (verified present in ApiEndpoints.cs).
    private const string ErrorVinsOperation = "get_api_v1_tesla_fleet_telemetry_error_vins";
    private const string ErrorsOperation = "get_api_v1_tesla_fleet_telemetry_errors";
    private const string RefreshErrorVinsOperation = "post_api_v1_tesla_fleet_telemetry_error_vins_refresh";
    private const string RefreshErrorsOperation = "post_api_v1_tesla_fleet_telemetry_errors_refresh";

    private const string ErrorVinsCacheKey = "tesla:fleet-telemetry:error-vins";
    private const string ErrorsCacheKeyPrefix = "tesla:fleet-telemetry:errors";

    private static readonly ApiRequest ErrorVinsRequest = new(ErrorVinsOperation);

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    public FleetTelemetryHealthSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<FleetTelemetryErrorVin>>> StreamErrorVinsAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var raw = _engine.StreamAsync<JsonElement>(
            ErrorVinsCacheKey,
            ct => _api.SendAsync<JsonElement>(ErrorVinsRequest, ct),
            IsEmptyResponse,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return FleetTelemetryHealthResultMapper.MapVins(emission);
        }
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<FleetTelemetryError>>> StreamErrorsAsync(
        string? vin,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        string? filter = string.IsNullOrWhiteSpace(vin) ? null : vin;
        string cacheKey = filter is null
            ? ErrorsCacheKeyPrefix
            : string.Create(CultureInfo.InvariantCulture, $"{ErrorsCacheKeyPrefix}:{filter}");

        // web: useFleetTelemetryErrors appends ?vin= only when a VIN is selected. The errors endpoint
        // declares no typed query params, so the client appends this filter without contract rejection.
        var request = filter is null
            ? new ApiRequest(ErrorsOperation)
            : new ApiRequest(ErrorsOperation, Query: new Dictionary<string, object?> { ["vin"] = filter });

        var raw = _engine.StreamAsync<JsonElement>(
            cacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            IsEmptyResponse,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return FleetTelemetryHealthResultMapper.MapErrors(emission);
        }
    }

    /// <inheritdoc />
    public Task RefreshErrorVinsAsync(CancellationToken cancellationToken = default) =>
        _api.SendAsync<JsonElement>(new ApiRequest(RefreshErrorVinsOperation), cancellationToken);

    /// <inheritdoc />
    public Task RefreshErrorsAsync(CancellationToken cancellationToken = default) =>
        _api.SendAsync<JsonElement>(new ApiRequest(RefreshErrorsOperation), cancellationToken);

    // Both endpoints return a JSON array; a null/non-array body or an empty array carries no rows.
    private static bool IsEmptyResponse(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        JsonValueKind.Array => element.GetArrayLength() == 0,
        _ => true,
    };
}
