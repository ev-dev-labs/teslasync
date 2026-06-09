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
/// The repository-backed <see cref="IGeofenceSource"/> — the native data adapter for the Geofence Status surface.
/// It resolves the primary (or explicit) vehicle from the shared <see cref="IWidgetVehicleSource"/> (the native
/// analogue of the web component's <c>vehicleId ?? vehicles?.[0]?.id</c>) and then runs two concurrent
/// cache-then-network reads — the vehicle state (<c>GET /vehicles/{vehicleID}/state</c>, the web
/// <c>useVehicleState</c> query, used only for the live position) and the configured geofences
/// (<c>GET /geofences</c>, the web <c>useGeofences</c> query, the fence list). Their emissions are combine-latest
/// merged through <see cref="GeofenceCombiner"/> as each settles, so cached content surfaces fast and a slow /
/// failed position read only tints the freshness chip (the fence list renders whenever it is available). The
/// geofences read is vehicle-independent and always runs — even with no vehicle the list still renders (every fence
/// "outside", no current zone), mirroring the web's unconditional <c>useGeofences()</c>. No HTTP touches the view.
/// </summary>
public sealed class GeofenceSource : IGeofenceSource
{
    private const string VehiclePathParam = "vehicleID";

    private readonly IWidgetVehicleSource _vehicles;
    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;
    private readonly long? _vehicleId;

    /// <summary>Creates the source over the vehicle source, contract client, engine and JSON settings.</summary>
    /// <param name="vehicles">Resolves the primary (or explicit) vehicle to scope the position read to.</param>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    /// <param name="vehicleId">An explicit vehicle id; when null the primary cached vehicle is used.</param>
    public GeofenceSource(
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

    private enum GeofencePart
    {
        State,
        Fences,
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<GeofenceWidgetReading>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        long? vehicleId = await ResolveVehicleIdAsync(cancellationToken).ConfigureAwait(false);

        yield return RepositoryResult<GeofenceWidgetReading>.Loading();

        var channel = Channel.CreateUnbounded<MergeItem>(new UnboundedChannelOptions
        {
            SingleReader = true,
            SingleWriter = false,
        });

        // The geofences list always loads (web useGeofences has no vehicle gate); the position read only runs when
        // a vehicle is known — otherwise a single Empty emission lets the loading gate clear with no position.
        var stateStream = vehicleId is { } vid
            ? StateStream(vid, cancellationToken)
            : EmptyStateStream();

        var pumpAll = Task.WhenAll(
            PumpAsync(GeofencePart.State, stateStream, channel.Writer, cancellationToken),
            PumpAsync(GeofencePart.Fences, FencesStream(cancellationToken), channel.Writer, cancellationToken));

        // Complete the channel once every pump finishes; accessing t.Exception observes any pump fault so the
        // reader surfaces it (and no task goes unobserved). Cancellation is delivered cleanly via ReadAllAsync.
        _ = pumpAll.ContinueWith(
            static (t, writer) => ((ChannelWriter<MergeItem>)writer!).TryComplete(t.Exception),
            channel.Writer,
            CancellationToken.None,
            TaskContinuationOptions.ExecuteSynchronously,
            TaskScheduler.Default);

        var state = RepositoryResult<JsonElement>.Loading();
        var fences = RepositoryResult<JsonElement>.Loading();

        await foreach (var item in channel.Reader.ReadAllAsync(cancellationToken).ConfigureAwait(false))
        {
            if (item.Part == GeofencePart.State)
            {
                state = item.Result;
            }
            else
            {
                fences = item.Result;
            }

            // Web parity: the loading gate is `stateLoading || fenceLoading` — hold the skeleton until both settle.
            if (state.Status == LoadStatus.Loading || fences.Status == LoadStatus.Loading)
            {
                continue;
            }

            yield return GeofenceCombiner.Combine(state, fences);
        }
    }

    private static async Task PumpAsync(
        GeofencePart part,
        IAsyncEnumerable<RepositoryResult<JsonElement>> stream,
        ChannelWriter<MergeItem> writer,
        CancellationToken cancellationToken)
    {
        await foreach (var result in stream.ConfigureAwait(false))
        {
            await writer.WriteAsync(new MergeItem(part, result), cancellationToken).ConfigureAwait(false);
        }
    }

    // Web parity: a null / non-object state body carries no position (every fence renders "outside").
    private static bool IsEmptyState(JsonElement element) => element.ValueKind != JsonValueKind.Object;

    // Web parity: a missing / empty geofences array is the "No geofences configured" empty surface.
    private static bool IsEmptyFences(JsonElement element) =>
        element.ValueKind != JsonValueKind.Array || element.GetArrayLength() == 0;

#pragma warning disable CS1998 // async iterator with no await — a single synchronous Empty emission.
    private static async IAsyncEnumerable<RepositoryResult<JsonElement>> EmptyStateStream()
    {
        yield return RepositoryResult<JsonElement>.Empty();
    }
#pragma warning restore CS1998

    private async Task<long?> ResolveVehicleIdAsync(CancellationToken cancellationToken)
    {
        if (_vehicleId is { } explicitId)
        {
            return explicitId;
        }

        var primary = await _vehicles.GetPrimaryAsync(cancellationToken).ConfigureAwait(false);
        return primary?.VehicleId;
    }

    private IAsyncEnumerable<RepositoryResult<JsonElement>> StateStream(long vid, CancellationToken cancellationToken)
    {
        var request = new ApiRequest(
            Operations.Vehicles.State,
            PathParams: new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [VehiclePathParam] = vid.ToString(CultureInfo.InvariantCulture),
            });
        return _engine.StreamAsync<JsonElement>(
            string.Create(CultureInfo.InvariantCulture, $"vehicles:{vid}:geofence:state"),
            ct => _api.SendAsync<JsonElement>(request, ct),
            IsEmptyState,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);
    }

    private IAsyncEnumerable<RepositoryResult<JsonElement>> FencesStream(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(Operations.Locations.Geofences);
        return _engine.StreamAsync<JsonElement>(
            "geofences",
            ct => _api.SendAsync<JsonElement>(request, ct),
            IsEmptyFences,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);
    }

    private readonly record struct MergeItem(GeofencePart Part, RepositoryResult<JsonElement> Result);
}
