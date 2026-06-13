using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews.Vehicles;

/// <summary>
/// The data port the <see cref="VehicleSettingsTabViewModel"/> binds to (P1/S8 state-holder seam) — the native
/// parity of the three web hooks the <c>VehicleSettingsTab</c> composes
/// (web/src/api/hooks/useVehicleSettings.ts): the cache-then-network per-vehicle settings read
/// (<c>useVehicleSettings</c> → <c>GET /vehicles/{id}/settings</c>), the per-key upsert
/// (<c>useUpsertVehicleSetting</c> → <c>PUT /vehicles/{id}/settings/{key}</c>) and the idempotent per-key reset
/// (<c>useResetVehicleSetting</c> → <c>DELETE /vehicles/{id}/settings/{key}</c>). The view never performs HTTP; the
/// concrete <see cref="VehicleSettingsTabSource"/> (or a test fake) drives this.
/// </summary>
public interface IVehicleSettingsTabSource
{
    /// <summary>Stream the cache-then-network resolved-settings snapshots for a vehicle (web <c>useVehicleSettings</c>).</summary>
    IAsyncEnumerable<RepositoryResult<VehicleSettingsData>> StreamSettingsAsync(
        long vehicleId,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Upsert one key's value (web <c>useUpsertVehicleSetting</c> — <c>PUT … { value }</c>). Throws on a transport /
    /// HTTP failure so the caller surfaces the inline-validation / error toast and keeps the edited draft.
    /// </summary>
    Task UpsertAsync(long vehicleId, string key, VehicleSettingValue value, CancellationToken cancellationToken = default);

    /// <summary>
    /// Reset one key to its default (web <c>useResetVehicleSetting</c> — <c>DELETE …</c>). Idempotent: the backend
    /// returns 204 even when no override existed. Throws on a transport / HTTP failure.
    /// </summary>
    Task ResetAsync(long vehicleId, string key, CancellationToken cancellationToken = default);
}

/// <summary>
/// Maps each <see cref="RepositoryResult{T}"/> of the raw settings JSON into a parsed
/// <see cref="RepositoryResult{T}"/> of <see cref="VehicleSettingsData"/>, preserving the lifecycle status, fetch
/// time, staleness and error so the freshness chips and per-state branches survive the parse. A non-object /
/// absent body parses to <see cref="VehicleSettingsData.Empty"/>. WinUI-free so the mapping is unit-tested without a
/// UI host (mirrors <c>GeneralSettingsResultMapper</c>).
/// </summary>
public static class VehicleSettingsTabResultMapper
{
    /// <summary>Project one raw settings emission into a parsed per-vehicle-settings emission.</summary>
    public static RepositoryResult<VehicleSettingsData> Map(RepositoryResult<JsonElement> result)
    {
        ArgumentNullException.ThrowIfNull(result);

        return result.Status switch
        {
            LoadStatus.Loading => RepositoryResult<VehicleSettingsData>.Loading(),
            LoadStatus.Cached => RepositoryResult<VehicleSettingsData>.Cached(
                Parse(result.Value), result.FetchedAt!.Value, result.IsStale),
            LoadStatus.Refreshing => RepositoryResult<VehicleSettingsData>.Refreshing(
                Parse(result.Value), result.FetchedAt!.Value, result.IsStale),
            LoadStatus.Loaded => RepositoryResult<VehicleSettingsData>.Loaded(
                Parse(result.Value), result.FetchedAt!.Value),
            LoadStatus.Empty => RepositoryResult<VehicleSettingsData>.Empty(result.FetchedAt),
            LoadStatus.Offline => RepositoryResult<VehicleSettingsData>.OfflineCached(
                Parse(result.Value), result.FetchedAt!.Value, result.Error!),
            _ => RepositoryResult<VehicleSettingsData>.Failure(
                result.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Couldn't load vehicle settings")),
        };
    }

    private static VehicleSettingsData Parse(JsonElement value) =>
        value.ValueKind == JsonValueKind.Undefined
            ? VehicleSettingsData.Empty
            : VehicleSettingsData.FromJson(value) ?? VehicleSettingsData.Empty;
}

/// <summary>
/// The generated-client-backed <see cref="IVehicleSettingsTabSource"/> — the native data adapter for the
/// per-vehicle settings surface (ADR-004). The read runs one cache-then-network stream of
/// <c>GET /vehicles/{id}/settings</c> through the shared <see cref="CacheThenNetworkEngine"/> (the same SQLite cache
/// the rest of the app shares, keyed <c>vehicles:{id}:settings</c>) and parses each emission via
/// <see cref="VehicleSettingsTabResultMapper"/>; the freshness window matches the web hook's 30-second
/// <c>staleTime</c>. The upsert and reset reproduce the web mutations verbatim through the generated
/// <c>put_…_settings_key</c> / <c>delete_…_settings_key</c> operations. No HTTP touches the view.
/// </summary>
public sealed class VehicleSettingsTabSource : IVehicleSettingsTabSource
{
    private const string VehicleIdParam = "vehicleID";
    private const string KeyParam = "key";

    /// <summary>The web hook's <c>staleTime: 30_000</c> — the cached payload is flagged stale past 30 seconds.</summary>
    private const int StaleSeconds = 30;

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the shared contract client, cache-then-network engine and JSON settings.</summary>
    /// <param name="api">The generated OpenAPI contract client (read + mutations).</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options supplying the JSON serializer settings.</param>
    public VehicleSettingsTabSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);

        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<VehicleSettingsData>> StreamSettingsAsync(
        long vehicleId,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var request = ApiRequest.WithPath(
            VehicleSettingsTabRegistration.SettingsOperation,
            VehicleIdParam,
            vehicleId.ToString(CultureInfo.InvariantCulture));

        var stream = _engine.StreamAsync<JsonElement>(
            $"vehicles:{vehicleId}:settings",
            ct => _api.SendAsync<JsonElement>(request, ct),
            IsEmptyJson,
            _json,
            StaleSeconds,
            cancellationToken);

        await foreach (var emission in stream.ConfigureAwait(false))
        {
            yield return VehicleSettingsTabResultMapper.Map(emission);
        }
    }

    /// <inheritdoc />
    public Task UpsertAsync(long vehicleId, string key, VehicleSettingValue value, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrEmpty(key);
        ArgumentNullException.ThrowIfNull(value);

        var request = new ApiRequest(
            VehicleSettingsTabRegistration.UpsertOperation,
            PathParams: new Dictionary<string, string>
            {
                [VehicleIdParam] = vehicleId.ToString(CultureInfo.InvariantCulture),
                [KeyParam] = key,
            },
            Body: new VehicleSettingPutBody(value.Raw));

        return _api.SendAsync<JsonElement>(request, cancellationToken);
    }

    /// <inheritdoc />
    public Task ResetAsync(long vehicleId, string key, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrEmpty(key);

        var request = new ApiRequest(
            VehicleSettingsTabRegistration.ResetOperation,
            PathParams: new Dictionary<string, string>
            {
                [VehicleIdParam] = vehicleId.ToString(CultureInfo.InvariantCulture),
                [KeyParam] = key,
            });

        return _api.SendAsync<JsonElement>(request, cancellationToken);
    }

    /// <summary>Treat a null / empty JSON document (no object properties) as an empty resolver response.</summary>
    private static bool IsEmptyJson(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        JsonValueKind.Array => element.GetArrayLength() == 0,
        JsonValueKind.Object => !element.EnumerateObject().MoveNext(),
        _ => false,
    };
}

/// <summary>
/// The upsert request body — the web mutation's <c>{ value }</c> payload. The shared JSON settings are
/// <see cref="System.Text.Json.JsonSerializerDefaults.Web"/> (camelCase), so <see cref="Value"/> serializes as
/// <c>value</c> to match the Go handler.
/// </summary>
internal sealed record VehicleSettingPutBody(object? Value);
