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
/// The repository-backed <see cref="IGuardModeSource"/> — the native data adapter for the Guard Mode
/// surface. It is the native analogue of the web component's hook pair: it resolves the primary (or
/// explicit) vehicle from the shared <see cref="IWidgetVehicleSource"/> (web
/// <c>vehicleId ?? vehicles?.[0]?.id ?? 0</c>) and runs <em>two</em> cache-then-network reads concurrently
/// — the guard configuration (generated operation <c>get_api_v1_vehicles_vehicleID_guard</c>, web
/// <c>useGuardConfig</c>) and the guard events feed (generated operation
/// <c>get_api_v1_vehicles_vehicleID_guard_events</c>, web <c>useGuardEvents</c>). Each side's emissions are
/// merged in arrival order through an unbounded channel and folded into one
/// <see cref="GuardModeSnapshot"/> result by <see cref="GuardModeResultMapper.Combine"/>, so the surface
/// shows whichever side resolves first (web <c>isLoading</c> / <c>isError</c> / <c>config</c> flag
/// combination). When no vehicle is available both reads are disabled — the read short-circuits to
/// <see cref="RepositoryResult{T}.Empty"/>, mirroring the web's <c>{config ? … : &lt;EmptyState&gt;}</c>
/// gate when the queries are disabled. No HTTP touches the view.
/// </summary>
public sealed class GuardModeSource : IGuardModeSource
{
    // The events endpoint has no Operations.* constant (it is the only file scoped to this surface that
    // references it); the configuration endpoint reuses the shared Operations.Vehicles.Guard constant.
    // Both ids resolve against TeslaSync.Windows.Generated.Api.ApiEndpoints.
    private const string EventsOperation = "get_api_v1_vehicles_vehicleID_guard_events";
    private const string VehiclePathParam = "vehicleID";

    private readonly IWidgetVehicleSource _vehicles;
    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;
    private readonly long? _vehicleId;

    /// <summary>Creates the source over the vehicle source, contract client, engine and JSON settings.</summary>
    /// <param name="vehicles">Resolves the primary (or explicit) vehicle to scope both reads to.</param>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    /// <param name="vehicleId">An explicit vehicle id; when null the primary cached vehicle is used.</param>
    public GuardModeSource(
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

    private enum SourceSide
    {
        Config,
        Events,
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<GuardModeSnapshot>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        long? vehicleId = await ResolveVehicleIdAsync(cancellationToken).ConfigureAwait(false);

        // Web parity: with no vehicle id both guard queries are disabled (enabled: vehicleId > 0), so
        // config resolves undefined and the widget shows the "No guard data" empty surface.
        if (vehicleId is not { } vid)
        {
            yield return RepositoryResult<GuardModeSnapshot>.Empty();
            yield break;
        }

        var configStream = ConfigStream(vid, cancellationToken);
        var eventsStream = EventsStream(vid, cancellationToken);

        var channel = Channel.CreateUnbounded<SideEmission>(
            new UnboundedChannelOptions { SingleReader = true, SingleWriter = false });

        var pumps = Task.WhenAll(
            PumpAsync(SourceSide.Config, configStream, channel.Writer, cancellationToken),
            PumpAsync(SourceSide.Events, eventsStream, channel.Writer, cancellationToken));

        // Complete the channel once both sub-reads finish (or fault/cancel) so the reader loop ends.
        _ = pumps.ContinueWith(
            static (task, state) => ((Channel<SideEmission>)state!).Writer.TryComplete(task.Exception),
            channel,
            CancellationToken.None,
            TaskContinuationOptions.ExecuteSynchronously,
            TaskScheduler.Default);

        RepositoryResult<JsonElement>? config = null;
        RepositoryResult<JsonElement>? events = null;

        await foreach (var emission in channel.Reader.ReadAllAsync(cancellationToken).ConfigureAwait(false))
        {
            if (emission.Side == SourceSide.Config)
            {
                config = emission.Result;
            }
            else
            {
                events = emission.Result;
            }

            yield return GuardModeResultMapper.Combine(config, events);
        }
    }

    private static async Task PumpAsync(
        SourceSide side,
        IAsyncEnumerable<RepositoryResult<JsonElement>> stream,
        ChannelWriter<SideEmission> writer,
        CancellationToken cancellationToken)
    {
        await foreach (var result in stream.WithCancellation(cancellationToken).ConfigureAwait(false))
        {
            await writer.WriteAsync(new SideEmission(side, result), cancellationToken).ConfigureAwait(false);
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

    private IAsyncEnumerable<RepositoryResult<JsonElement>> ConfigStream(long vehicleId, CancellationToken cancellationToken)
    {
        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"guard:{vehicleId}:config");
        var request = new ApiRequest(
            Operations.Vehicles.Guard,
            PathParams: new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [VehiclePathParam] = vehicleId.ToString(CultureInfo.InvariantCulture),
            });

        return Stream(cacheKey, request, cancellationToken);
    }

    private IAsyncEnumerable<RepositoryResult<JsonElement>> EventsStream(long vehicleId, CancellationToken cancellationToken)
    {
        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"guard:{vehicleId}:events");
        var request = new ApiRequest(
            EventsOperation,
            PathParams: new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [VehiclePathParam] = vehicleId.ToString(CultureInfo.InvariantCulture),
            });

        return Stream(cacheKey, request, cancellationToken);
    }

    private IAsyncEnumerable<RepositoryResult<JsonElement>> Stream(string cacheKey, ApiRequest request, CancellationToken cancellationToken) =>
        _engine.StreamAsync<JsonElement>(
            cacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            IsEmptyBody,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

    // A null / non-object body collapses to the empty terminal: for the configuration that is the "No
    // guard data" gate; for the events envelope a malformed body simply yields no rows (the snapshot's
    // event list stays empty while the configuration still renders).
    private static bool IsEmptyBody(JsonElement element) => element.ValueKind != JsonValueKind.Object;

    private readonly record struct SideEmission(SourceSide Side, RepositoryResult<JsonElement> Result);
}
