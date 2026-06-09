using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Threading.Channels;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The repository-backed <see cref="INotificationStatsSource"/> — the native data adapter for the
/// Notification Stats surface. It runs two concurrent cache-then-network reads — the delivery rollup
/// (<c>GET /notifications/stats</c>, generated operation <c>get_api_v1_notifications_stats</c>, the web
/// <c>useNotificationStats</c> query, load-bearing) and the recent delivery log (<c>GET /notifications/logs</c>,
/// generated operation <c>get_api_v1_notifications_logs</c>, the web <c>useNotificationLogs</c> query) —
/// caching each raw JSON body so the snake_case wire shape round-trips losslessly. Their emissions are
/// combine-latest merged through <see cref="NotificationStatsResultMapper.Combine"/> as each settles, so the
/// stats decide loaded/empty/error and a slow / failed logs read only enriches (or silently omits) the wide
/// recent-delivery table — mirroring the web's stats-driven render gate. Neither endpoint is vehicle-scoped,
/// so no vehicle resolution is required. No HTTP touches the view.
/// </summary>
public sealed class NotificationStatsSource : INotificationStatsSource
{
    private const string StatsCacheKey = "notifications:stats";
    private const string LogsCacheKey = "notifications:logs";

    private static readonly ApiRequest StatsRequest = new(Operations.Notifications.Stats);
    private static readonly ApiRequest LogsRequest = new(Operations.Notifications.Logs);

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    public NotificationStatsSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    private enum NotificationPart
    {
        Stats,
        Logs,
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<NotificationStatsReading>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        yield return RepositoryResult<NotificationStatsReading>.Loading();

        var channel = Channel.CreateUnbounded<MergeItem>(new UnboundedChannelOptions
        {
            SingleReader = true,
            SingleWriter = false,
        });

        var pumps = new List<Task>(2)
        {
            PumpAsync(NotificationPart.Stats, StatsStream(cancellationToken), channel.Writer, cancellationToken),
            PumpAsync(NotificationPart.Logs, LogsStream(cancellationToken), channel.Writer, cancellationToken),
        };

        var pumpAll = Task.WhenAll(pumps);

        // Complete the channel once both pumps finish; accessing t.Exception observes any pump fault so the
        // reader surfaces it (and no task goes unobserved). Cancellation flows cleanly via ReadAllAsync.
        _ = pumpAll.ContinueWith(
            static (t, writer) => ((ChannelWriter<MergeItem>)writer!).TryComplete(t.Exception),
            channel.Writer,
            CancellationToken.None,
            TaskContinuationOptions.ExecuteSynchronously,
            TaskScheduler.Default);

        var stats = RepositoryResult<JsonElement>.Loading();
        var logs = RepositoryResult<JsonElement>.Loading();

        await foreach (var item in channel.Reader.ReadAllAsync(cancellationToken).ConfigureAwait(false))
        {
            if (item.Part == NotificationPart.Stats)
            {
                stats = item.Result;
            }
            else
            {
                logs = item.Result;
            }

            // Web parity: the recent table is a wide-only enrichment, so the logs read never gates content
            // (the native analogue of the DashboardStats timeline). Only the load-bearing stats read does.
            if (stats.Status == LoadStatus.Loading)
            {
                continue;
            }

            var logsArg = logs.Status != LoadStatus.Loading ? (RepositoryResult<JsonElement>?)logs : null;
            yield return NotificationStatsResultMapper.Combine(stats, logsArg);
        }
    }

    private static async Task PumpAsync(
        NotificationPart part,
        IAsyncEnumerable<RepositoryResult<JsonElement>> stream,
        ChannelWriter<MergeItem> writer,
        CancellationToken cancellationToken)
    {
        await foreach (var result in stream.ConfigureAwait(false))
        {
            await writer.WriteAsync(new MergeItem(part, result), cancellationToken).ConfigureAwait(false);
        }
    }

    private IAsyncEnumerable<RepositoryResult<JsonElement>> StatsStream(CancellationToken cancellationToken) =>
        Stream(StatsCacheKey, StatsRequest, IsStatsEmpty, cancellationToken);

    private IAsyncEnumerable<RepositoryResult<JsonElement>> LogsStream(CancellationToken cancellationToken) =>
        Stream(LogsCacheKey, LogsRequest, IsLogsEmpty, cancellationToken);

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

    // Web parity: only an absent / null body counts as empty for the load-bearing stats read (the backend
    // always returns a populated object — an idle inbox renders as zeros, not as the empty surface).
    private static bool IsStatsEmpty(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        _ => false,
    };

    // The logs payload is a JSON array; a null body or empty array contributes nothing to the wide table.
    private static bool IsLogsEmpty(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        JsonValueKind.Array => element.GetArrayLength() == 0,
        _ => false,
    };

    private readonly record struct MergeItem(NotificationPart Part, RepositoryResult<JsonElement> Result);
}
