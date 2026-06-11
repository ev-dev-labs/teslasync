using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Forms;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// The read port the <see cref="WidgetSettingsModalViewModel"/> binds to (P1/S8 state-holder seam) — the native
/// analogue of the web modal's <c>useVehicles()</c> query
/// (web/src/features/dashboard/components/WidgetSettingsModal.tsx). It yields the cache-then-network sequence of
/// fleet snapshots that populates the vehicle-scope dropdown. The view never performs HTTP itself; the concrete
/// <see cref="WidgetSettingsVehicleSource"/> (or a test fake) drives this.
/// </summary>
public interface IWidgetSettingsVehicleSource
{
    /// <summary>Stream the cache-then-network fleet list, newest cache first (web <c>useVehicles</c>).</summary>
    /// <param name="cancellationToken">Cancellation for a superseded read.</param>
    IAsyncEnumerable<RepositoryResult<IReadOnlyList<VehicleOption>>> StreamVehiclesAsync(
        CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IWidgetSettingsVehicleSource"/> — the native data adapter for the widget
/// settings modal's vehicle dropdown. It streams <c>GET /vehicles</c> through the shared
/// <see cref="CacheThenNetworkEngine"/> (the same cache-then-network pipeline the web <c>useVehicles</c> query
/// rides) and folds each emission's JSON array into presentation-ready <see cref="VehicleOption"/>s via
/// <see cref="WidgetSettingsProjection.ParseVehicles"/>. The body is cached as JSON so the snake_case wire shape
/// round-trips losslessly and a network failure surfaces the last cached fleet (offline) rather than an empty
/// dropdown. No HTTP touches the view.
/// </summary>
public sealed class WidgetSettingsVehicleSource : IWidgetSettingsVehicleSource
{
    /// <summary>The generated OpenAPI operation id for <c>GET /api/v1/vehicles</c> (web <c>useVehicles</c>).</summary>
    public const string VehiclesOperation = Operations.Vehicles.List;

    private const string VehiclesCacheKey = "dashboard:widget-settings:vehicles";

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    public WidgetSettingsVehicleSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<VehicleOption>>> StreamVehiclesAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var request = new ApiRequest(VehiclesOperation);
        IAsyncEnumerable<RepositoryResult<JsonElement>> stream = _engine.StreamAsync<JsonElement>(
            VehiclesCacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            IsEmptyArray,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (RepositoryResult<JsonElement> result in stream.ConfigureAwait(false))
        {
            IReadOnlyList<VehicleOption>? vehicles = result.Value is { } body
                ? WidgetSettingsProjection.ParseVehicles(body)
                : null;
            yield return new RepositoryResult<IReadOnlyList<VehicleOption>>(
                result.Status, vehicles, result.FetchedAt, result.IsStale, result.Error);
        }
    }

    // The vehicles payload is a JSON array; a null body or an empty array is treated as the empty result.
    private static bool IsEmptyArray(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        JsonValueKind.Array => element.GetArrayLength() == 0,
        _ => false,
    };
}

/// <summary>
/// A fixed <see cref="IWidgetSettingsVehicleSource"/> for headless hosts (and any caller that already holds a
/// resolved fleet). It emits a single terminal snapshot — <see cref="RepositoryResult{T}.Empty()"/> for an empty
/// fleet, otherwise <see cref="RepositoryResult{T}.Loaded"/> — so the view-model renders the loaded or empty
/// branch without a network round-trip. The Windows app registers the contract-client-backed
/// <see cref="WidgetSettingsVehicleSource"/>.
/// </summary>
public sealed class StaticWidgetSettingsVehicleSource : IWidgetSettingsVehicleSource
{
    private readonly IReadOnlyList<VehicleOption> _vehicles;
    private readonly Func<DateTimeOffset> _clock;

    /// <summary>Creates the source over a fixed fleet (defaults to an empty fleet).</summary>
    /// <param name="vehicles">The fixed fleet to surface, or null for an empty fleet.</param>
    /// <param name="clock">The clock stamping the emission's fetch time (defaults to UTC now).</param>
    public StaticWidgetSettingsVehicleSource(
        IReadOnlyList<VehicleOption>? vehicles = null, Func<DateTimeOffset>? clock = null)
    {
        _vehicles = vehicles ?? Array.Empty<VehicleOption>();
        _clock = clock ?? (() => DateTimeOffset.UtcNow);
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<VehicleOption>>> StreamVehiclesAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        await Task.CompletedTask.ConfigureAwait(false);
        cancellationToken.ThrowIfCancellationRequested();
        yield return _vehicles.Count == 0
            ? RepositoryResult<IReadOnlyList<VehicleOption>>.Empty(_clock())
            : RepositoryResult<IReadOnlyList<VehicleOption>>.Loaded(_vehicles, _clock());
    }
}
