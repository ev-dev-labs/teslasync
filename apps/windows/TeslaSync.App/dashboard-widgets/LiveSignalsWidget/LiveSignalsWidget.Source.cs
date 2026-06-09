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
/// The repository-backed <see cref="ILiveSignalsSource"/> — the native data adapter for the Live Signals
/// surface. It first resolves the primary (or explicit) vehicle from the shared <see cref="IWidgetVehicleSource"/>
/// (the native analogue of the web component's <c>vehicleId ?? vehicles?.[0]?.id ?? 0</c>), then runs four
/// concurrent cache-then-network reads — motor latest (<c>GET /motor/latest?vehicle_id=</c>), climate latest
/// (<c>GET /climate/latest?vehicle_id=</c>), security latest (<c>GET /security/latest?vehicle_id=</c>) and
/// tire-pressure latest (<c>GET /tire-pressure/latest?vehicle_id=</c>) — the web <c>useMotorLatest</c> +
/// <c>useClimateLatest</c> + <c>useSecurityLatest</c> + <c>useLatestTirePressure</c> queries. Their emissions are
/// combine-latest merged through <see cref="LiveSignalsResultMapper"/> as each settles, so cached content
/// surfaces fast and a slow / failed read only leaves that cell's skeleton up while the others render. The
/// freshness chrome is driven by the motor read, exactly like the web. When no vehicle is available the read
/// short-circuits to <see cref="RepositoryResult{T}.Empty"/>, mirroring the web's disabled queries
/// (<c>enabled: id &gt; 0</c>). No HTTP touches the view.
/// </summary>
public sealed class LiveSignalsSource : ILiveSignalsSource
{
    // The web's useMotorLatest / useSecurityLatest / useLatestTirePressure read /motor/latest, /security/latest
    // and /tire-pressure/latest; the generated endpoint table exposes these ids but Operations.cs carries no
    // Motor / Security / TirePressure group yet, so they are referenced verbatim here (the file scoped to this
    // surface). Each resolves against TeslaSync.Windows.Generated.Api.ApiEndpoints; climate reuses the shared
    // Operations.Climate.Latest constant.
    private const string MotorLatestOperation = "get_api_v1_motor_latest";
    private const string SecurityLatestOperation = "get_api_v1_security_latest";
    private const string TirePressureLatestOperation = "get_api_v1_tire_pressure_latest";
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
    public LiveSignalsSource(
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

    private enum SignalPart
    {
        Motor,
        Climate,
        Security,
        Tires,
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<LiveSignalsReading>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        long? vehicleId = await ResolveVehicleIdAsync(cancellationToken).ConfigureAwait(false);
        if (vehicleId is not { } vid)
        {
            // Web parity: with no vehicle every query is disabled, hasData is falsy → the empty surface.
            yield return RepositoryResult<LiveSignalsReading>.Empty();
            yield break;
        }

        yield return RepositoryResult<LiveSignalsReading>.Loading();

        var channel = Channel.CreateUnbounded<MergeItem>(new UnboundedChannelOptions
        {
            SingleReader = true,
            SingleWriter = false,
        });

        var pumpAll = Task.WhenAll(
            PumpAsync(SignalPart.Motor, Stream(vid, SignalPart.Motor, MotorRequest(vid), cancellationToken), channel.Writer, cancellationToken),
            PumpAsync(SignalPart.Climate, Stream(vid, SignalPart.Climate, ClimateRequest(vid), cancellationToken), channel.Writer, cancellationToken),
            PumpAsync(SignalPart.Security, Stream(vid, SignalPart.Security, SecurityRequest(vid), cancellationToken), channel.Writer, cancellationToken),
            PumpAsync(SignalPart.Tires, Stream(vid, SignalPart.Tires, TiresRequest(vid), cancellationToken), channel.Writer, cancellationToken));

        // Complete the channel once every pump finishes; accessing t.Exception observes any pump fault so the
        // reader surfaces it (and no task goes unobserved). Cancellation is delivered cleanly via ReadAllAsync.
        _ = pumpAll.ContinueWith(
            static (t, writer) => ((ChannelWriter<MergeItem>)writer!).TryComplete(t.Exception),
            channel.Writer,
            CancellationToken.None,
            TaskContinuationOptions.ExecuteSynchronously,
            TaskScheduler.Default);

        var motor = RepositoryResult<JsonElement>.Loading();
        var climate = RepositoryResult<JsonElement>.Loading();
        var security = RepositoryResult<JsonElement>.Loading();
        var tires = RepositoryResult<JsonElement>.Loading();

        await foreach (var item in channel.Reader.ReadAllAsync(cancellationToken).ConfigureAwait(false))
        {
            switch (item.Part)
            {
                case SignalPart.Motor:
                    motor = item.Result;
                    break;
                case SignalPart.Climate:
                    climate = item.Result;
                    break;
                case SignalPart.Security:
                    security = item.Result;
                    break;
                default:
                    tires = item.Result;
                    break;
            }

            // Hold the initial skeleton (the Loading already emitted) until either a read has content to show
            // or every read has resolved — then a no-content picture is genuinely the empty / error surface
            // rather than a transient flash.
            bool anyContent = HasContent(motor) || HasContent(climate) || HasContent(security) || HasContent(tires);
            bool allResolved = !IsLoading(motor) && !IsLoading(climate) && !IsLoading(security) && !IsLoading(tires);
            if (!anyContent && !allResolved)
            {
                continue;
            }

            yield return LiveSignalsResultMapper.Combine(motor, climate, security, tires);
        }
    }

    private static bool HasContent(RepositoryResult<JsonElement> result) =>
        result.Status is LoadStatus.Cached or LoadStatus.Refreshing or LoadStatus.Loaded or LoadStatus.Offline;

    private static bool IsLoading(RepositoryResult<JsonElement> result) => result.Status == LoadStatus.Loading;

    private static async Task PumpAsync(
        SignalPart part,
        IAsyncEnumerable<RepositoryResult<JsonElement>> stream,
        ChannelWriter<MergeItem> writer,
        CancellationToken cancellationToken)
    {
        await foreach (var result in stream.ConfigureAwait(false))
        {
            await writer.WriteAsync(new MergeItem(part, result), cancellationToken).ConfigureAwait(false);
        }
    }

    // Web parity: a null / non-object body collapses to that read's empty terminal — that section contributes no
    // value (its cell keeps the skeleton) while the other reads still render the grid.
    private static bool IsEmptyBody(JsonElement element) => element.ValueKind != JsonValueKind.Object;

    private async Task<long?> ResolveVehicleIdAsync(CancellationToken cancellationToken)
    {
        if (_vehicleId is { } explicitId)
        {
            return explicitId;
        }

        var primary = await _vehicles.GetPrimaryAsync(cancellationToken).ConfigureAwait(false);
        return primary?.VehicleId;
    }

    private static ApiRequest MotorRequest(long vid) => Query(MotorLatestOperation, vid);

    private static ApiRequest ClimateRequest(long vid) => Query(Operations.Climate.Latest, vid);

    private static ApiRequest SecurityRequest(long vid) => Query(SecurityLatestOperation, vid);

    private static ApiRequest TiresRequest(long vid) => Query(TirePressureLatestOperation, vid);

    private static ApiRequest Query(string operationId, long vid) => new(
        operationId,
        Query: new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            [VehicleQueryParam] = vid,
        });

    private IAsyncEnumerable<RepositoryResult<JsonElement>> Stream(long vid, SignalPart part, ApiRequest request, CancellationToken cancellationToken)
    {
        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"vehicles:{vid}:live-signals:{part}");
        return _engine.StreamAsync<JsonElement>(
            cacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            IsEmptyBody,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);
    }

    private readonly record struct MergeItem(SignalPart Part, RepositoryResult<JsonElement> Result);
}
