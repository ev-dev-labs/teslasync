using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Threading.Channels;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The repository-backed <see cref="ISystemHealthSource"/> — the native data adapter for the System Health
/// surface. It runs three concurrent cache-then-network reads — the server health rollup
/// (<c>GET /system/health</c>, generated operation <c>get_api_v1_system_health</c>, the web
/// <c>useSystemHealth</c> query, load-bearing), the database statistics
/// (<c>GET /dev-tools/db-stats</c>, the web <c>useDBStats</c> query) and the runtime / connection-pool snapshot
/// (<c>GET /dev-tools/runtime-info</c>, the web <c>useConnectionPool</c> query) — caching each raw JSON body so
/// the snake_case wire shape round-trips losslessly. Their emissions are combine-latest merged through
/// <see cref="SystemHealthResultMapper.Combine"/> as each settles, so the health read decides loaded/empty/error
/// and a slow / failed db-stats or pool read only enriches (or silently omits) the stat grid — mirroring the
/// web's health-driven render gate. None of the endpoints are vehicle-scoped, so no vehicle resolution is
/// required. No HTTP touches the view.
/// </summary>
public sealed class SystemHealthSource : ISystemHealthSource
{
    // The web useDBStats / useConnectionPool reads hit /dev-tools/db-stats and /dev-tools/runtime-info; the
    // generated endpoint table exposes these ids but Operations only carries SystemAdmin.Health as a named
    // constant, so the db-stats and runtime-info ids are referenced verbatim here (scoped to this surface).
    // Each resolves against TeslaSync.Windows.Generated.Api.ApiEndpoints.
    private const string DbStatsOperation = "get_api_v1_dev_tools_db_stats";
    private const string RuntimeInfoOperation = "get_api_v1_dev_tools_runtime_info";

    private const string HealthCacheKey = "system:health";
    private const string DbStatsCacheKey = "system:db-stats";
    private const string RuntimeInfoCacheKey = "system:runtime-info";

    private static readonly ApiRequest HealthRequest = new(Operations.SystemAdmin.Health);
    private static readonly ApiRequest DbStatsRequest = new(DbStatsOperation);
    private static readonly ApiRequest RuntimeInfoRequest = new(RuntimeInfoOperation);

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    public SystemHealthSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    private enum HealthPart
    {
        Health,
        DbStats,
        Pool,
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<SystemHealthReading>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        yield return RepositoryResult<SystemHealthReading>.Loading();

        var channel = Channel.CreateUnbounded<MergeItem>(new UnboundedChannelOptions
        {
            SingleReader = true,
            SingleWriter = false,
        });

        var pumpAll = Task.WhenAll(
            PumpAsync(HealthPart.Health, HealthStream(cancellationToken), channel.Writer, cancellationToken),
            PumpAsync(HealthPart.DbStats, DbStatsStream(cancellationToken), channel.Writer, cancellationToken),
            PumpAsync(HealthPart.Pool, RuntimeInfoStream(cancellationToken), channel.Writer, cancellationToken));

        // Complete the channel once every pump finishes; accessing t.Exception observes any pump fault so the
        // reader surfaces it (and no task goes unobserved). Cancellation is delivered cleanly via ReadAllAsync.
        _ = pumpAll.ContinueWith(
            static (t, writer) => ((ChannelWriter<MergeItem>)writer!).TryComplete(t.Exception),
            channel.Writer,
            CancellationToken.None,
            TaskContinuationOptions.ExecuteSynchronously,
            TaskScheduler.Default);

        var health = RepositoryResult<JsonElement>.Loading();
        var dbStats = RepositoryResult<JsonElement>.Loading();
        var pool = RepositoryResult<JsonElement>.Loading();

        await foreach (var item in channel.Reader.ReadAllAsync(cancellationToken).ConfigureAwait(false))
        {
            switch (item.Part)
            {
                case HealthPart.Health:
                    health = item.Result;
                    break;
                case HealthPart.DbStats:
                    dbStats = item.Result;
                    break;
                default:
                    pool = item.Result;
                    break;
            }

            // Web parity: the stat grid is an enrichment of the health read, so the db-stats / pool reads never
            // gate content. Hold the skeleton (the Loading already emitted) until the load-bearing health read
            // settles, then fold every emission with whatever the enrichment reads have so far.
            if (health.Status == LoadStatus.Loading)
            {
                continue;
            }

            var dbArg = dbStats.Status != LoadStatus.Loading ? (RepositoryResult<JsonElement>?)dbStats : null;
            var poolArg = pool.Status != LoadStatus.Loading ? (RepositoryResult<JsonElement>?)pool : null;
            yield return SystemHealthResultMapper.Combine(health, dbArg, poolArg);
        }
    }

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

    private IAsyncEnumerable<RepositoryResult<JsonElement>> HealthStream(CancellationToken cancellationToken) =>
        Stream(HealthCacheKey, HealthRequest, cancellationToken);

    private IAsyncEnumerable<RepositoryResult<JsonElement>> DbStatsStream(CancellationToken cancellationToken) =>
        Stream(DbStatsCacheKey, DbStatsRequest, cancellationToken);

    private IAsyncEnumerable<RepositoryResult<JsonElement>> RuntimeInfoStream(CancellationToken cancellationToken) =>
        Stream(RuntimeInfoCacheKey, RuntimeInfoRequest, cancellationToken);

    private IAsyncEnumerable<RepositoryResult<JsonElement>> Stream(
        string cacheKey,
        ApiRequest request,
        CancellationToken cancellationToken) =>
        _engine.StreamAsync<JsonElement>(
            cacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            IsEmptyBody,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

    // Web parity: only an absent / null body counts as empty. Each backend always returns a populated object
    // (an idle system renders as zeros / unhealthy components, not as the empty surface).
    private static bool IsEmptyBody(JsonElement element) =>
        element.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined;

    private readonly record struct MergeItem(HealthPart Part, RepositoryResult<JsonElement> Result);
}
