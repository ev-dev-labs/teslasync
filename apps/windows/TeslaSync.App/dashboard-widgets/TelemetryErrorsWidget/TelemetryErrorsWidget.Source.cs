using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Threading.Channels;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.DashboardWidgets.TelemetryErrors;

/// <summary>
/// The repository-backed <see cref="ITelemetryErrorsSource"/> — the native data adapter for the Telemetry
/// Errors surface. It runs two concurrent cache-then-network reads — the Fleet Telemetry error-VIN list
/// (<c>GET /tesla/fleet-telemetry/error-vins</c>, generated operation
/// <c>get_api_v1_tesla_fleet_telemetry_error_vins</c>) and the error feed
/// (<c>GET /tesla/fleet-telemetry/errors</c>, <c>get_api_v1_tesla_fleet_telemetry_errors</c>) — the native
/// analogue of the web component's <c>useFleetTelemetryErrorVINs</c> + <c>useFleetTelemetryErrors</c>
/// queries. Their raw JSON emissions are combine-latest merged through
/// <see cref="TelemetryErrorsResultMapper.Combine"/> as each settles, so cached content surfaces fast and
/// the header freshness tracks both reads. No HTTP touches the view.
/// </summary>
public sealed class TelemetryErrorsSource : ITelemetryErrorsSource
{
    // These Fleet Telemetry endpoints have no Operations group yet (the tesla fleet-telemetry handler
    // post-dates the Operations.cs codegen seam), so their ids are referenced verbatim here — the only
    // file scoped to this surface. Both resolve against TeslaSync.Windows.Generated.Api.ApiEndpoints
    // (verified present: GET /tesla/fleet-telemetry/error-vins and GET /tesla/fleet-telemetry/errors).
    private const string ErrorVinsOperation = "get_api_v1_tesla_fleet_telemetry_error_vins";
    private const string ErrorsOperation = "get_api_v1_tesla_fleet_telemetry_errors";

    private const string ErrorVinsCacheKey = "tesla:fleet-telemetry:error-vins";
    private const string ErrorsCacheKey = "tesla:fleet-telemetry:errors";

    private static readonly ApiRequest ErrorVinsRequest = new(ErrorVinsOperation);
    private static readonly ApiRequest ErrorsRequest = new(ErrorsOperation);

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    public TelemetryErrorsSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    private enum Part
    {
        Vins,
        Errors,
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<TelemetryErrorsSnapshot>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var channel = Channel.CreateUnbounded<MergeItem>(new UnboundedChannelOptions
        {
            SingleReader = true,
            SingleWriter = false,
        });

        var pumpAll = Task.WhenAll(
            PumpAsync(Part.Vins, VinsStream(cancellationToken), channel.Writer, cancellationToken),
            PumpAsync(Part.Errors, ErrorsStream(cancellationToken), channel.Writer, cancellationToken));

        // Complete the channel once both pumps finish; accessing t.Exception observes any pump fault so the
        // reader surfaces it (and no task goes unobserved). Cancellation flows cleanly via ReadAllAsync.
        _ = pumpAll.ContinueWith(
            static (t, writer) => ((ChannelWriter<MergeItem>)writer!).TryComplete(t.Exception),
            channel.Writer,
            CancellationToken.None,
            TaskContinuationOptions.ExecuteSynchronously,
            TaskScheduler.Default);

        var vins = RepositoryResult<JsonElement>.Loading();
        var errors = RepositoryResult<JsonElement>.Loading();

        await foreach (var item in channel.Reader.ReadAllAsync(cancellationToken).ConfigureAwait(false))
        {
            if (item.Part == Part.Vins)
            {
                vins = item.Result;
            }
            else
            {
                errors = item.Result;
            }

            yield return TelemetryErrorsResultMapper.Combine(vins, errors);
        }
    }

    private static async Task PumpAsync(
        Part part,
        IAsyncEnumerable<RepositoryResult<JsonElement>> stream,
        ChannelWriter<MergeItem> writer,
        CancellationToken cancellationToken)
    {
        await foreach (var result in stream.ConfigureAwait(false))
        {
            await writer.WriteAsync(new MergeItem(part, result), cancellationToken).ConfigureAwait(false);
        }
    }

    // Both endpoints return a JSON array; a null/non-array body or an empty array carries no rows.
    private static bool IsEmptyResponse(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        JsonValueKind.Array => element.GetArrayLength() == 0,
        _ => true,
    };

    private IAsyncEnumerable<RepositoryResult<JsonElement>> VinsStream(CancellationToken cancellationToken) =>
        _engine.StreamAsync<JsonElement>(
            ErrorVinsCacheKey,
            ct => _api.SendAsync<JsonElement>(ErrorVinsRequest, ct),
            IsEmptyResponse,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

    private IAsyncEnumerable<RepositoryResult<JsonElement>> ErrorsStream(CancellationToken cancellationToken) =>
        _engine.StreamAsync<JsonElement>(
            ErrorsCacheKey,
            ct => _api.SendAsync<JsonElement>(ErrorsRequest, ct),
            IsEmptyResponse,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

    private readonly record struct MergeItem(Part Part, RepositoryResult<JsonElement> Result);
}
