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
/// The repository-backed <see cref="ISignalHealthSource"/> — the native data adapter for the Signal Health
/// surface. It first resolves the primary (or explicit) vehicle from the shared <see cref="IWidgetVehicleSource"/>
/// (the native analogue of the web component's <c>vehicleId ?? vehicles?.[0]?.id ?? 0</c>), then runs three
/// concurrent cache-then-network reads — signal stats (<c>GET /signals/{vehicleID}/stats</c>), available signals
/// (<c>GET /signals/{vehicleID}/available</c>) and the live signal map (<c>GET /signals/{vehicleID}/live</c>) —
/// the web <c>useSignalStats</c> + <c>useSignals</c> + <c>useSignalGaps</c> queries. Their emissions are
/// combine-latest merged through <see cref="SignalHealthResultMapper"/> as each settles, so cached content
/// surfaces fast and a slow / failed read only leaves its slice absent while the others render. The freshness
/// chrome is driven by the stats read, exactly like the web. When no vehicle is available the read
/// short-circuits to <see cref="RepositoryResult{T}.Empty"/>, mirroring the web's disabled queries
/// (<c>enabled: id &gt; 0</c>). No HTTP touches the view.
/// </summary>
public sealed class SignalHealthSource : ISignalHealthSource
{
    // The web's useSignalStats / useSignalGaps read /signals/{id}/stats and /signals/{id}/live; the generated
    // endpoint table exposes these ids but Operations.Signals only carries the `available` constant, so the
    // stats and live ids are referenced verbatim here (scoped to this surface). Each resolves against
    // TeslaSync.Windows.Generated.Api.ApiEndpoints; available reuses the shared Operations.Signals.Available
    // constant. All three are path-parameterised on {vehicleID}.
    private const string SignalStatsOperation = "get_api_v1_signals_vehicleID_stats";
    private const string SignalLiveOperation = "get_api_v1_signals_vehicleID_live";
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
    public SignalHealthSource(
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

    private enum HealthPart
    {
        Stats,
        Signals,
        Gaps,
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<SignalHealthReading>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        long? vehicleId = await ResolveVehicleIdAsync(cancellationToken).ConfigureAwait(false);
        if (vehicleId is not { } vid)
        {
            // Web parity: with no vehicle every query is disabled, hasData is falsy → the empty surface.
            yield return RepositoryResult<SignalHealthReading>.Empty();
            yield break;
        }

        yield return RepositoryResult<SignalHealthReading>.Loading();

        var channel = Channel.CreateUnbounded<MergeItem>(new UnboundedChannelOptions
        {
            SingleReader = true,
            SingleWriter = false,
        });

        var pumpAll = Task.WhenAll(
            PumpAsync(HealthPart.Stats, Stream(vid, HealthPart.Stats, Request(SignalStatsOperation, vid), cancellationToken), channel.Writer, cancellationToken),
            PumpAsync(HealthPart.Signals, Stream(vid, HealthPart.Signals, Request(Operations.Signals.Available, vid), cancellationToken), channel.Writer, cancellationToken),
            PumpAsync(HealthPart.Gaps, Stream(vid, HealthPart.Gaps, Request(SignalLiveOperation, vid), cancellationToken), channel.Writer, cancellationToken));

        // Complete the channel once every pump finishes; accessing t.Exception observes any pump fault so the
        // reader surfaces it (and no task goes unobserved). Cancellation is delivered cleanly via ReadAllAsync.
        _ = pumpAll.ContinueWith(
            static (t, writer) => ((ChannelWriter<MergeItem>)writer!).TryComplete(t.Exception),
            channel.Writer,
            CancellationToken.None,
            TaskContinuationOptions.ExecuteSynchronously,
            TaskScheduler.Default);

        var stats = RepositoryResult<JsonElement>.Loading();
        var signals = RepositoryResult<JsonElement>.Loading();
        var gaps = RepositoryResult<JsonElement>.Loading();

        await foreach (var item in channel.Reader.ReadAllAsync(cancellationToken).ConfigureAwait(false))
        {
            switch (item.Part)
            {
                case HealthPart.Stats:
                    stats = item.Result;
                    break;
                case HealthPart.Signals:
                    signals = item.Result;
                    break;
                default:
                    gaps = item.Result;
                    break;
            }

            // Hold the initial skeleton (the Loading already emitted) until either a read has content to show
            // or every read has resolved — then a no-content picture is genuinely the empty / error surface
            // rather than a transient flash.
            bool anyContent = HasContent(stats) || HasContent(signals) || HasContent(gaps);
            bool allResolved = !IsLoading(stats) && !IsLoading(signals) && !IsLoading(gaps);
            if (!anyContent && !allResolved)
            {
                continue;
            }

            yield return SignalHealthResultMapper.Combine(stats, signals, gaps);
        }
    }

    private static bool HasContent(RepositoryResult<JsonElement> result) =>
        result.Status is LoadStatus.Cached or LoadStatus.Refreshing or LoadStatus.Loaded or LoadStatus.Offline;

    private static bool IsLoading(RepositoryResult<JsonElement> result) => result.Status == LoadStatus.Loading;

    private static async Task PumpAsync(
        HealthPart part,
        IAsyncEnumerable<RepositoryResult<JsonElement>> stream,
        ChannelWriter<MergeItem> writer,
        CancellationToken cancellationToken)
    {
        await foreach (var result in stream.ConfigureAwait(false))
        {
            await writer.WriteAsync(new MergeItem(part, result), cancellationToken).ConfigureAwait(false);
        }
    }

    // Web parity: a null / undefined body collapses to that read's empty terminal so it contributes no slice.
    // Empty objects / arrays ({}, []) stay content-bearing because the web treats them as truthy (hasData),
    // so a vehicle that reports an empty live map or empty catalog still renders the body rather than the
    // empty surface.
    private static bool IsEmptyBody(JsonElement element) => element.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined;

    private async Task<long?> ResolveVehicleIdAsync(CancellationToken cancellationToken)
    {
        if (_vehicleId is { } explicitId)
        {
            return explicitId;
        }

        var primary = await _vehicles.GetPrimaryAsync(cancellationToken).ConfigureAwait(false);
        return primary?.VehicleId;
    }

    private static ApiRequest Request(string operationId, long vid) => new(
        operationId,
        PathParams: new Dictionary<string, string>(StringComparer.Ordinal)
        {
            [VehiclePathParam] = vid.ToString(CultureInfo.InvariantCulture),
        });

    private IAsyncEnumerable<RepositoryResult<JsonElement>> Stream(long vid, HealthPart part, ApiRequest request, CancellationToken cancellationToken)
    {
        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"vehicles:{vid}:signal-health:{part}");
        return _engine.StreamAsync<JsonElement>(
            cacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            IsEmptyBody,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);
    }

    private readonly record struct MergeItem(HealthPart Part, RepositoryResult<JsonElement> Result);
}
