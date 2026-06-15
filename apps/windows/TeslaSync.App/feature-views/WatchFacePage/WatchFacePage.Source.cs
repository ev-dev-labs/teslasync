using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.Json.Serialization;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews.Watch;

/// <summary>
/// The watch-summary data port the <see cref="WatchFacePageViewModel"/> binds to (P1/S8 state-holder seam) — the
/// native analogue of the web <c>useWatchSummary</c> hook (web/src/api/hooks/useWatch.ts). It yields the
/// cache-then-network sequence of parsed <see cref="WatchFaceSummary"/> snapshots for <c>GET /watch/summary</c>;
/// the view never performs HTTP itself. The concrete <see cref="WatchFaceSummarySource"/> (or a test fake) drives
/// this.
/// </summary>
public interface IWatchFaceSummarySource
{
    /// <summary>Stream the cache-then-network watch-summary snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<WatchFaceSummary>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IWatchFaceSummarySource"/> — the native data adapter for the watch page's
/// <c>useWatchSummary</c> read. It runs one cache-then-network read of <c>GET /watch/summary</c> (generated
/// operation <c>get_api_v1_watch_summary</c>) through the shared <see cref="CacheThenNetworkEngine"/>, caching the
/// raw JSON so the snake_case wire shape round-trips losslessly, and parses each emission into a
/// <see cref="WatchFaceSummary"/>. Web parity: the watch query is never disabled — it always runs, the optional
/// <c>vehicle_id</c> deep-link being forwarded as the query only when one is available (web <c>?vehicle_id=…</c>).
/// A response that parses to <see langword="null"/> collapses to <see cref="RepositoryResult{T}.Empty"/>, mirroring
/// the web <c>!data</c> empty surface. No HTTP touches the view.
/// </summary>
public sealed class WatchFaceSummarySource : IWatchFaceSummarySource
{
    // Generated operation id (TeslaSync.Windows.Generated.Api.ApiEndpoints); asserted by the source tests.
    private const string SummaryOperation = "get_api_v1_watch_summary";
    private const string VehicleQueryParam = "vehicle_id";

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;
    private readonly long? _vehicleId;

    /// <summary>Creates the source over the contract client, engine and JSON settings.</summary>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    /// <param name="vehicleId">An explicit vehicle id (web <c>?vehicle_id=</c>); when null the server picks the vehicle.</param>
    public WatchFaceSummarySource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options, long? vehicleId = null)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
        _vehicleId = vehicleId;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<WatchFaceSummary>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var query = _vehicleId is { } id
            ? new Dictionary<string, object?>(StringComparer.Ordinal) { [VehicleQueryParam] = id }
            : null;
        var request = new ApiRequest(SummaryOperation, Query: query);

        // Cache key shared with the WatchSummaryWidget read (identical /watch/summary payload) so a cached snapshot
        // surfaces fast for either consumer; both parse from the same raw JSON.
        string cacheKey = _vehicleId is { } v
            ? string.Create(CultureInfo.InvariantCulture, $"watch:{v}:summary")
            : "watch:primary:summary";

        var raw = _engine.StreamAsync<JsonElement>(
            cacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            IsEmpty,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return WatchFaceResultMapper.Map(emission, WatchFaceSummary.FromResponse);
        }
    }

    // Web parity: an absent / non-object / empty body carries no usable summary → the "No vehicle found" surface.
    private static bool IsEmpty(JsonElement element) => WatchFaceSummary.FromResponse(element) is null;
}

/// <summary>
/// The result of a watch-face tap command POST — the native mirror of the web <c>useWatchCommand</c> mutation
/// settling (success or a classified failure). Pure data so the flow is unit-tested without a network.
/// </summary>
/// <param name="Success">Whether the command was accepted.</param>
/// <param name="Error">The classified failure when <see cref="Success"/> is false; otherwise null.</param>
public sealed record WatchFaceCommandOutcome(bool Success, RepositoryError? Error)
{
    /// <summary>A successful command settlement.</summary>
    public static WatchFaceCommandOutcome Ok { get; } = new(true, null);

    /// <summary>A failed command settlement carrying the classified error.</summary>
    public static WatchFaceCommandOutcome Failure(RepositoryError error) => new(false, error);
}

/// <summary>
/// The command-mutation port (P1/S8) — the native analogue of the web <c>useWatchCommand</c> mutation
/// (<c>POST /watch/command</c> with body <c>{ vehicle_id, command }</c>). The view never performs HTTP itself; the
/// concrete <see cref="WatchFaceCommandSender"/> (or a test fake) drives this and returns a classified outcome.
/// </summary>
public interface IWatchFaceCommandSender
{
    /// <summary>Send <paramref name="command"/> for <paramref name="vehicleId"/> and return the classified outcome.</summary>
    Task<WatchFaceCommandOutcome> SendAsync(long vehicleId, string command, CancellationToken cancellationToken = default);
}

/// <summary>
/// The single real <see cref="IWatchFaceCommandSender"/> — the native data adapter for a watch-face tap command.
/// It POSTs <c>{ "vehicle_id": &lt;id&gt;, "command": "&lt;wire&gt;" }</c> to <c>/watch/command</c> (generated
/// operation <c>post_api_v1_watch_command</c>) through the shared contract client — the native analogue of the web
/// <c>useWatchCommand</c> mutation's <c>watchRequest('/watch/command', { method: 'POST', body: JSON.stringify({
/// vehicle_id, command }) })</c>. The response's <c>success</c> flag (when present) classifies the outcome; a
/// thrown error is mapped through <see cref="ApiErrorMapper"/>. No HTTP touches the view.
/// </summary>
public sealed class WatchFaceCommandSender : IWatchFaceCommandSender
{
    // Generated operation id (asserted by the source tests).
    private const string CommandOperation = "post_api_v1_watch_command";

    private readonly IApiClient _api;

    /// <summary>Creates the sender over the generated contract client.</summary>
    public WatchFaceCommandSender(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<WatchFaceCommandOutcome> SendAsync(long vehicleId, string command, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrEmpty(command);

        var request = new ApiRequest(
            CommandOperation,
            Body: new WatchCommandRequestBody(vehicleId, command));

        try
        {
            var response = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
            return ParseSuccess(response)
                ? WatchFaceCommandOutcome.Ok
                : WatchFaceCommandOutcome.Failure(new RepositoryError(RepositoryErrorKind.Server, "Command failed"));
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            return WatchFaceCommandOutcome.Failure(ApiErrorMapper.Map(ex));
        }
    }

    // Web parity: `data.success` drives the result. The handler returns { success, message }; a body with no
    // explicit `success` field is treated as accepted (the request returned 2xx without throwing).
    private static bool ParseSuccess(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("success", out var s))
        {
            return true;
        }

        return s.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.Number when s.TryGetDouble(out var n) => n != 0,
            JsonValueKind.String => bool.TryParse(s.GetString(), out var b) && b,
            _ => true,
        };
    }

    // The POST body shape the Go watch handler decodes ({ vehicle_id, command }); the web sends vehicleId ?? 0.
    private sealed record WatchCommandRequestBody(
        [property: JsonPropertyName("vehicle_id")] long VehicleId,
        [property: JsonPropertyName("command")] string Command);
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;T&gt;</c>, preserving every freshness flag (cached / refreshing / stale / offline). A
/// successful emission whose body parses to <see langword="null"/> collapses to <see cref="RepositoryResult{T}.Empty"/>
/// — the native analogue of the web read returning no data. Kept pure so the parse-and-preserve contract is
/// unit-tested without a network or cache.
/// </summary>
public static class WatchFaceResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) with <paramref name="parse"/> while preserving its status.</summary>
    public static RepositoryResult<T> Map<T>(RepositoryResult<JsonElement> raw, Func<JsonElement, T?> parse)
        where T : class
    {
        ArgumentNullException.ThrowIfNull(raw);
        ArgumentNullException.ThrowIfNull(parse);

        T? Parse() => raw.HasValue ? parse(raw.Value) : null;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<T>.Loading(),
            LoadStatus.Cached => Parse() is { } cached
                ? RepositoryResult<T>.Cached(cached, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<T>.Empty(raw.FetchedAt),
            LoadStatus.Refreshing => Parse() is { } refreshing
                ? RepositoryResult<T>.Refreshing(refreshing, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<T>.Empty(raw.FetchedAt),
            LoadStatus.Loaded => Parse() is { } loaded
                ? RepositoryResult<T>.Loaded(loaded, raw.FetchedAt ?? DateTimeOffset.UtcNow)
                : RepositoryResult<T>.Empty(raw.FetchedAt),
            LoadStatus.Empty => RepositoryResult<T>.Empty(raw.FetchedAt),
            LoadStatus.Offline => Parse() is { } offline
                ? RepositoryResult<T>.OfflineCached(offline, raw.FetchedAt!.Value, raw.Error!)
                : RepositoryResult<T>.Empty(raw.FetchedAt),
            _ => RepositoryResult<T>.Failure(raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
