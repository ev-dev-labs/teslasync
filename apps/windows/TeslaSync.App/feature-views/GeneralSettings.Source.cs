using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.Repositories;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The data port the <see cref="GeneralSettingsViewModel"/> binds to (P1/S8 state-holder seam). It exposes the four
/// reads/writes the web component composes through its hooks: the cache-then-network settings read (web
/// <c>useSettings()</c> → <c>GET /settings</c>), the full-replace save (web <c>useSaveSettings()</c> →
/// <c>PUT /settings</c>), the first-vehicle lookup (web <c>useVehicles()</c> → <c>GET /vehicles</c>, of which only
/// <c>vehicles[0].id</c> is used) and the per-vehicle car-preferences read (web <c>useCarPreferences()</c> →
/// <c>GET /user-preferences/latest</c>). The view never performs HTTP itself; the concrete
/// <see cref="GeneralSettingsSource"/> (or a test fake) drives this.
/// </summary>
public interface IGeneralSettingsSource
{
    /// <summary>Stream the cache-then-network settings snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<GeneralServerSettings>> StreamSettingsAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Persist <paramref name="settings"/> with a full-replace <c>PUT /settings</c> (the web partial-merge pattern),
    /// returning the committed snapshot. Throws on a transport/HTTP failure so the caller can revert its optimistic
    /// update and surface the error toast.
    /// </summary>
    Task<GeneralServerSettings> SaveAsync(GeneralServerSettings settings, CancellationToken cancellationToken = default);

    /// <summary>
    /// The first enrolled vehicle (web <c>vehicles?.[0]</c>), or null when none / the read fails. Best-effort: the
    /// surface degrades to "no sync banner" rather than erroring, so a transport fault resolves to null.
    /// </summary>
    Task<VehicleSummary?> GetFirstVehicleAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// The vehicle's reported unit/clock preferences (web <c>useCarPreferences(vehicleId)</c>), or null when absent /
    /// the read fails. Best-effort: a transport fault resolves to null so the banners simply do not render.
    /// </summary>
    Task<CarPreferences?> GetCarPreferencesAsync(long vehicleId, CancellationToken cancellationToken = default);
}

/// <summary>
/// Maps each <see cref="RepositoryResult{T}"/> of the raw settings JSON (from
/// <see cref="ISettingsRepository.GetSettingsAsync"/>) into a parsed <see cref="RepositoryResult{T}"/> of
/// <see cref="GeneralServerSettings"/>, preserving the lifecycle status, fetch time, staleness and error so the
/// freshness chips and per-state branches survive the parse. An empty / absent document parses to
/// <see cref="GeneralServerSettings.Default"/>. WinUI-free so the mapping is unit-tested without a UI host.
/// </summary>
public static class GeneralSettingsResultMapper
{
    /// <summary>Project one raw settings emission into a parsed general-settings emission.</summary>
    public static RepositoryResult<GeneralServerSettings> Map(RepositoryResult<JsonElement> result)
    {
        ArgumentNullException.ThrowIfNull(result);

        return result.Status switch
        {
            LoadStatus.Loading => RepositoryResult<GeneralServerSettings>.Loading(),
            LoadStatus.Cached => RepositoryResult<GeneralServerSettings>.Cached(
                Parse(result.Value), result.FetchedAt!.Value, result.IsStale),
            LoadStatus.Refreshing => RepositoryResult<GeneralServerSettings>.Refreshing(
                Parse(result.Value), result.FetchedAt!.Value, result.IsStale),
            LoadStatus.Loaded => RepositoryResult<GeneralServerSettings>.Loaded(
                Parse(result.Value), result.FetchedAt!.Value),
            LoadStatus.Empty => RepositoryResult<GeneralServerSettings>.Empty(result.FetchedAt),
            LoadStatus.Offline => RepositoryResult<GeneralServerSettings>.OfflineCached(
                Parse(result.Value), result.FetchedAt!.Value, result.Error!),
            _ => RepositoryResult<GeneralServerSettings>.Failure(
                result.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Couldn't load settings")),
        };
    }

    private static GeneralServerSettings Parse(JsonElement value) =>
        value.ValueKind == JsonValueKind.Undefined ? GeneralServerSettings.Default : GeneralServerSettings.FromJson(value);
}

/// <summary>
/// The repository-backed <see cref="IGeneralSettingsSource"/> — the native data adapter for the General settings
/// surface. The settings read runs one cache-then-network stream of <c>GET /settings</c> through the shared
/// <see cref="ISettingsRepository"/> (the same <c>settings:get</c> cache key the rest of the app shares) and parses
/// each emission via <see cref="GeneralSettingsResultMapper"/>. The save reproduces the web full-replace merge: it
/// serializes the whole settings document (every preserved field plus the fourteen editable keys from the typed form)
/// and sends it through the generated <c>put_api_v1_settings</c> operation. The vehicle and car-preference reads are
/// best-effort one-shots through the generated client (<c>get_api_v1_vehicles</c> and
/// <c>get_api_v1_user_preferences_latest</c>) that resolve to null on a transport fault. No HTTP touches the view.
/// </summary>
public sealed class GeneralSettingsSource : IGeneralSettingsSource
{
    /// <summary>The generated OpenAPI operation id for <c>PUT /api/v1/settings</c> (full-replace).</summary>
    public const string SaveOperation = "put_api_v1_settings";

    /// <summary>The generated OpenAPI operation id for <c>GET /api/v1/vehicles</c>.</summary>
    public const string VehiclesOperation = "get_api_v1_vehicles";

    /// <summary>The generated OpenAPI operation id for <c>GET /api/v1/user-preferences/latest</c>.</summary>
    public const string CarPreferencesOperation = "get_api_v1_user_preferences_latest";

    private readonly ISettingsRepository _settings;
    private readonly IApiClient _api;

    /// <summary>Creates the source over the shared settings repository and contract client.</summary>
    /// <param name="settings">The cache-then-network settings repository (the web <c>useSettings</c> read).</param>
    /// <param name="api">The generated contract client used for the save and the best-effort reads.</param>
    public GeneralSettingsSource(ISettingsRepository settings, IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(settings);
        ArgumentNullException.ThrowIfNull(api);
        _settings = settings;
        _api = api;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<GeneralServerSettings>> StreamSettingsAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        await foreach (var emission in _settings.GetSettingsAsync(cancellationToken).ConfigureAwait(false))
        {
            yield return GeneralSettingsResultMapper.Map(emission);
        }
    }

    /// <inheritdoc />
    public async Task<GeneralServerSettings> SaveAsync(
        GeneralServerSettings settings,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(settings);

        var request = new ApiRequest(SaveOperation, Body: settings.ToRequestBody());
        var response = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);

        // The endpoint echoes the saved document; parse it so the committed snapshot reflects any server-side
        // normalization, falling back to the optimistic value when the echo is not an object.
        return response.ValueKind == JsonValueKind.Object
            ? GeneralServerSettings.FromJson(response)
            : settings;
    }

    /// <inheritdoc />
    public async Task<VehicleSummary?> GetFirstVehicleAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            var response = await _api.SendAsync<JsonElement>(new ApiRequest(VehiclesOperation), cancellationToken)
                .ConfigureAwait(false);
            return VehicleSummary.FirstFrom(response);
        }
        catch (ApiException)
        {
            return null;
        }
        catch (HttpRequestException)
        {
            return null;
        }
    }

    /// <inheritdoc />
    public async Task<CarPreferences?> GetCarPreferencesAsync(long vehicleId, CancellationToken cancellationToken = default)
    {
        var request = new ApiRequest(
            CarPreferencesOperation,
            Query: new Dictionary<string, object?> { ["vehicle_id"] = vehicleId });

        try
        {
            var response = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
            return CarPreferences.FromJson(response);
        }
        catch (ApiException)
        {
            return null;
        }
        catch (HttpRequestException)
        {
            return null;
        }
    }
}
