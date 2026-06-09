using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Threading.Channels;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The repository-backed <see cref="IVehicleHeroCardSource"/> — the native data adapter for the Vehicle Hero
/// Card surface. It resolves the primary (or explicit) vehicle id from the shared
/// <see cref="IWidgetVehicleSource"/> (the native analogue of the web component's
/// <c>vehicleId ? vehicles.find(…) ?? vehicles[0] : vehicles[0]</c>), seeds the header identity from that cached
/// snapshot, then runs two concurrent cache-then-network reads — the vehicle list (<c>GET /vehicles</c>, web
/// <c>useVehicles</c>) to enrich the model/trim/name, and the vehicle state
/// (<c>GET /vehicles/{vehicleID}/state</c>, web <c>useVehicleState</c>) for the battery / range / temperatures /
/// charging / status. Their emissions are combine-latest merged through <see cref="VehicleHeroCardResultMapper"/>
/// as each settles, so the card surfaces fast and only the state read gates the loading skeleton (web
/// <c>loading={isLoading}</c>). When no vehicle is available the read short-circuits to
/// <see cref="RepositoryResult{T}.Empty"/>, mirroring the web's <c>{vehicle ? … : &lt;EmptyState&gt;}</c> gate.
/// No HTTP touches the view.
/// </summary>
public sealed class VehicleHeroCardSource : IVehicleHeroCardSource
{
    private const string VehiclesListCacheKey = "vehicles:list";
    private const string VehiclePathParam = "vehicleID";

    private readonly IWidgetVehicleSource _vehicles;
    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;
    private readonly long? _vehicleId;

    /// <summary>Creates the source over the vehicle source, contract client, engine and JSON settings.</summary>
    /// <param name="vehicles">Resolves the primary (or explicit) vehicle to scope the reads to.</param>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    /// <param name="vehicleId">An explicit vehicle id; when null the primary cached vehicle is used.</param>
    public VehicleHeroCardSource(
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

    private enum HeroPart
    {
        Vehicles,
        State,
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<VehicleHeroReading>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var snapshot = await ResolveSnapshotAsync(cancellationToken).ConfigureAwait(false);
        long? resolved = _vehicleId ?? snapshot?.VehicleId;
        if (resolved is not { } vehicleId)
        {
            // Web parity: with no vehicle the widget renders the "No vehicle data" empty surface.
            yield return RepositoryResult<VehicleHeroReading>.Empty();
            yield break;
        }

        var identity = SeedIdentity(vehicleId, snapshot);

        yield return RepositoryResult<VehicleHeroReading>.Loading();

        var channel = Channel.CreateUnbounded<MergeItem>(new UnboundedChannelOptions
        {
            SingleReader = true,
            SingleWriter = false,
        });

        var pumpAll = Task.WhenAll(
            PumpAsync(HeroPart.Vehicles, VehiclesStream(cancellationToken), channel.Writer, cancellationToken),
            PumpAsync(HeroPart.State, StateStream(vehicleId, cancellationToken), channel.Writer, cancellationToken));

        // Complete the channel once every pump finishes; accessing t.Exception observes any pump fault so the
        // reader surfaces it (and no task goes unobserved). Cancellation is delivered cleanly via ReadAllAsync.
        _ = pumpAll.ContinueWith(
            static (t, writer) => ((ChannelWriter<MergeItem>)writer!).TryComplete(t.Exception),
            channel.Writer,
            CancellationToken.None,
            TaskContinuationOptions.ExecuteSynchronously,
            TaskScheduler.Default);

        var state = RepositoryResult<JsonElement>.Loading();

        await foreach (var item in channel.Reader.ReadAllAsync(cancellationToken).ConfigureAwait(false))
        {
            if (item.Part == HeroPart.Vehicles)
            {
                // Web parity: enrich the header (model/trim/name) from the vehicles list as it settles.
                if (item.Result.HasValue &&
                    VehicleHeroIdentity.FromVehiclesArray(item.Result.Value, vehicleId) is { } enriched)
                {
                    identity = enriched;
                }
            }
            else
            {
                state = item.Result;
            }

            // Web parity: only useVehicleState gates the surface — the vehicles list never blocks the skeleton.
            if (state.Status == LoadStatus.Loading)
            {
                continue;
            }

            yield return VehicleHeroCardResultMapper.Combine(identity, state);
        }
    }

    private static async Task PumpAsync(
        HeroPart part,
        IAsyncEnumerable<RepositoryResult<JsonElement>> stream,
        ChannelWriter<MergeItem> writer,
        CancellationToken cancellationToken)
    {
        await foreach (var result in stream.ConfigureAwait(false))
        {
            await writer.WriteAsync(new MergeItem(part, result), cancellationToken).ConfigureAwait(false);
        }
    }

    private static VehicleHeroIdentity SeedIdentity(long vehicleId, WidgetVehicleSnapshot? snapshot) => new(
        Id: vehicleId,
        DisplayName: snapshot?.DisplayName ?? string.Empty,
        Vin: snapshot?.Vin ?? string.Empty,
        Model: string.Empty,
        TrimBadging: string.Empty);

    private async Task<WidgetVehicleSnapshot?> ResolveSnapshotAsync(CancellationToken cancellationToken)
    {
        if (_vehicleId is { } explicitId)
        {
            var explicitSnapshot = await _vehicles.GetAsync(explicitId, cancellationToken).ConfigureAwait(false);
            if (explicitSnapshot is not null)
            {
                return explicitSnapshot;
            }
        }

        return await _vehicles.GetPrimaryAsync(cancellationToken).ConfigureAwait(false);
    }

    private IAsyncEnumerable<RepositoryResult<JsonElement>> VehiclesStream(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(Operations.Vehicles.List);
        return Stream(VehiclesListCacheKey, request, IsEmptyArray, cancellationToken);
    }

    private IAsyncEnumerable<RepositoryResult<JsonElement>> StateStream(long vehicleId, CancellationToken cancellationToken)
    {
        var request = new ApiRequest(
            Operations.Vehicles.State,
            PathParams: new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [VehiclePathParam] = vehicleId.ToString(CultureInfo.InvariantCulture),
            });
        return Stream(
            string.Create(CultureInfo.InvariantCulture, $"vehicles:{vehicleId}:hero-card:state"),
            request,
            IsEmptyState,
            cancellationToken);
    }

    private IAsyncEnumerable<RepositoryResult<JsonElement>> Stream(
        string cacheKey,
        ApiRequest request,
        Func<JsonElement, bool> isEmpty,
        CancellationToken cancellationToken) =>
        _engine.StreamAsync<JsonElement>(
            cacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            isEmpty,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

    // Web parity: a stateless-but-present body still renders the card, so only a null/non-object state body is
    // "empty"; the mapper folds that into a card with em-dash metrics (web `state` undefined → card renders).
    private static bool IsEmptyState(JsonElement element) => element.ValueKind is not JsonValueKind.Object;

    private static bool IsEmptyArray(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        JsonValueKind.Array => element.GetArrayLength() == 0,
        _ => false,
    };

    private readonly record struct MergeItem(HeroPart Part, RepositoryResult<JsonElement> Result);
}
