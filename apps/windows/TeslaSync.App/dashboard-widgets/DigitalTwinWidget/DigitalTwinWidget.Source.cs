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
/// The repository-backed <see cref="IDigitalTwinSource"/> — the native data adapter for the Digital Twin
/// surface. It first resolves the primary (or explicit) vehicle from the shared <see cref="IWidgetVehicleSource"/>
/// (the native analogue of the web component's <c>vehicleId ? vehicles?.find(…) ?? vehicles?.[0] : vehicles?.[0]</c>)
/// for the caption identity, then runs three concurrent cache-then-network reads — vehicle state
/// (<c>GET /vehicles/{vehicleID}/state</c>), security latest (<c>GET /security/latest?vehicle_id=</c>) and charging
/// telemetry latest (<c>GET /charging-telemetry/latest?vehicle_id=</c>) — the web <c>useVehicleState</c> +
/// <c>useSecurityLatest</c> + <c>useChargingTelemetryLatest</c> queries. Their emissions are combine-latest merged
/// through <see cref="DigitalTwinResultMapper"/> as each settles, so cached content surfaces fast and a slow /
/// failed read only tints the freshness chip (the twin renders whenever a vehicle is known). When no vehicle is
/// available the read short-circuits to <see cref="RepositoryResult{T}.Empty"/>, mirroring the web's
/// <c>{vehicle ? … : &lt;EmptyState&gt;}</c> gate. No HTTP touches the view.
/// </summary>
public sealed class DigitalTwinSource : IDigitalTwinSource
{
    // The web's useSecurityLatest reads /security/latest; the generated endpoint table exposes this id but
    // Operations.cs carries no Security group yet, so it is referenced verbatim here (the only file scoped to
    // this surface). The id resolves against TeslaSync.Windows.Generated.Api.ApiEndpoints.
    private const string SecurityLatestOperation = "get_api_v1_security_latest";
    private const string VehiclePathParam = "vehicleID";
    private const string VehicleQueryParam = "vehicle_id";

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
    public DigitalTwinSource(
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

    private enum TwinPart
    {
        State,
        Security,
        Charging,
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<DigitalTwinReading>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var snapshot = await ResolveSnapshotAsync(cancellationToken).ConfigureAwait(false);
        if (snapshot is null)
        {
            // Web parity: with no vehicle the widget renders the "No vehicle data" empty surface.
            yield return RepositoryResult<DigitalTwinReading>.Empty();
            yield break;
        }

        long vid = snapshot.VehicleId;
        var identity = new DigitalTwinIdentity(snapshot.DisplayName, snapshot.Vin, ExteriorColor: null);

        yield return RepositoryResult<DigitalTwinReading>.Loading();

        var channel = Channel.CreateUnbounded<MergeItem>(new UnboundedChannelOptions
        {
            SingleReader = true,
            SingleWriter = false,
        });

        var pumpAll = Task.WhenAll(
            PumpAsync(TwinPart.State, StateStream(vid, cancellationToken), channel.Writer, cancellationToken),
            PumpAsync(TwinPart.Security, SecurityStream(vid, cancellationToken), channel.Writer, cancellationToken),
            PumpAsync(TwinPart.Charging, ChargingStream(vid, cancellationToken), channel.Writer, cancellationToken));

        // Complete the channel once every pump finishes; accessing t.Exception observes any pump fault so the
        // reader surfaces it (and no task goes unobserved). Cancellation is delivered cleanly via ReadAllAsync.
        _ = pumpAll.ContinueWith(
            static (t, writer) => ((ChannelWriter<MergeItem>)writer!).TryComplete(t.Exception),
            channel.Writer,
            CancellationToken.None,
            TaskContinuationOptions.ExecuteSynchronously,
            TaskScheduler.Default);

        var state = RepositoryResult<JsonElement>.Loading();
        var security = RepositoryResult<JsonElement>.Loading();
        var charging = RepositoryResult<JsonElement>.Loading();

        await foreach (var item in channel.Reader.ReadAllAsync(cancellationToken).ConfigureAwait(false))
        {
            switch (item.Part)
            {
                case TwinPart.State:
                    state = item.Result;
                    break;
                case TwinPart.Security:
                    security = item.Result;
                    break;
                default:
                    charging = item.Result;
                    break;
            }

            // Web parity: the loading gate is `stateLoading || securityLoading` — charging never gates the twin.
            if (state.Status == LoadStatus.Loading || security.Status == LoadStatus.Loading)
            {
                continue;
            }

            var chargingArg = charging.Status == LoadStatus.Loading ? null : (RepositoryResult<JsonElement>?)charging;
            yield return DigitalTwinResultMapper.Combine(identity, state, security, chargingArg);
        }
    }

    private static async Task PumpAsync(
        TwinPart part,
        IAsyncEnumerable<RepositoryResult<JsonElement>> stream,
        ChannelWriter<MergeItem> writer,
        CancellationToken cancellationToken)
    {
        await foreach (var result in stream.ConfigureAwait(false))
        {
            await writer.WriteAsync(new MergeItem(part, result), cancellationToken).ConfigureAwait(false);
        }
    }

    // Web parity: a null / non-object body collapses to the empty terminal — that read contributes no twin fields
    // (the merge treats it as unknown) while the other reads still render the twin.
    private static bool IsEmptyBody(JsonElement element) => element.ValueKind != JsonValueKind.Object;

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

    private IAsyncEnumerable<RepositoryResult<JsonElement>> StateStream(long vid, CancellationToken cancellationToken)
    {
        var request = new ApiRequest(
            Operations.Vehicles.State,
            PathParams: new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [VehiclePathParam] = vid.ToString(CultureInfo.InvariantCulture),
            });
        return Stream(string.Create(CultureInfo.InvariantCulture, $"vehicles:{vid}:digital-twin:state"), request, cancellationToken);
    }

    private IAsyncEnumerable<RepositoryResult<JsonElement>> SecurityStream(long vid, CancellationToken cancellationToken)
    {
        var request = new ApiRequest(
            SecurityLatestOperation,
            Query: new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                [VehicleQueryParam] = vid,
            });
        return Stream(string.Create(CultureInfo.InvariantCulture, $"vehicles:{vid}:digital-twin:security"), request, cancellationToken);
    }

    private IAsyncEnumerable<RepositoryResult<JsonElement>> ChargingStream(long vid, CancellationToken cancellationToken)
    {
        var request = new ApiRequest(
            Operations.Charging.TelemetryLatest,
            Query: new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                [VehicleQueryParam] = vid,
            });
        return Stream(string.Create(CultureInfo.InvariantCulture, $"vehicles:{vid}:digital-twin:charging"), request, cancellationToken);
    }

    private IAsyncEnumerable<RepositoryResult<JsonElement>> Stream(string cacheKey, ApiRequest request, CancellationToken cancellationToken) =>
        _engine.StreamAsync<JsonElement>(
            cacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            IsEmptyBody,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

    private readonly record struct MergeItem(TwinPart Part, RepositoryResult<JsonElement> Result);
}
