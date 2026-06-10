using System.Collections.Generic;
using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.Json.Nodes;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews;

/// <summary>The raw <c>POST /notifications/{id}/test</c> outcome (web <c>useTestChannel</c> response shape).</summary>
/// <param name="Success">True when the provider accepted the test delivery.</param>
/// <param name="Error">The optional server error message when the test failed.</param>
public sealed record ChannelTestResponse(bool Success, string? Error);

/// <summary>
/// The data port the <see cref="NotificationChannelsViewModel"/> binds to (P1/S8 state-holder seam). It yields
/// the two cache-then-network reads the web <c>NotificationChannelsView</c> composes (<c>useNotificationChannels</c>
/// → <c>GET /notifications</c>, <c>useNotificationStats</c> → <c>GET /notifications/stats</c>) and exposes the four
/// channel mutations (save / delete / toggle / test). The view never performs HTTP itself; the concrete
/// <see cref="NotificationChannelsSource"/> (or a test fake) drives this.
/// </summary>
public interface INotificationChannelsSource
{
    /// <summary>Stream the cache-then-network channel-list snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<NotificationChannelList>> StreamChannelsAsync(CancellationToken cancellationToken = default);

    /// <summary>Stream the cache-then-network delivery-stats snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<NotificationChannelStats>> StreamStatsAsync(CancellationToken cancellationToken = default);

    /// <summary>Create (<c>POST</c>) or update (<c>PUT</c>) a channel from <paramref name="body"/> (web <c>useSaveChannel</c>).</summary>
    Task SaveAsync(JsonObject body, long? id, CancellationToken cancellationToken = default);

    /// <summary>Delete a channel (web <c>useDeleteChannel</c>).</summary>
    Task DeleteAsync(long id, CancellationToken cancellationToken = default);

    /// <summary>Flip a channel's enabled flag (web <c>useToggleChannel</c>).</summary>
    Task ToggleAsync(long id, CancellationToken cancellationToken = default);

    /// <summary>Send a test delivery and return the provider outcome (web <c>useTestChannel</c>).</summary>
    Task<ChannelTestResponse> TestAsync(long id, CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="INotificationChannelsSource"/> — the native data adapter for the
/// NotificationChannels surface. The two reads replay cache-then-network through the shared
/// <see cref="CacheThenNetworkEngine"/> (the channel list and the stats object are cached as raw JSON and mapped
/// to the typed read-models by <see cref="NotificationChannelsResultMapper"/>); the four mutations go straight
/// through the generated contract client. No HTTP touches the view.
/// </summary>
public sealed class NotificationChannelsSource : INotificationChannelsSource
{
    private const string ChannelsCacheKey = "notifications:channels";
    private const string StatsCacheKey = "notifications:stats";

    private static readonly ApiRequest ChannelsRequest = new(NotificationChannelsRegistration.ChannelsOperation);
    private static readonly ApiRequest StatsRequest = new(NotificationChannelsRegistration.StatsOperation);

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    public NotificationChannelsSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<NotificationChannelList>> StreamChannelsAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var raw = _engine.StreamAsync<JsonElement>(
            ChannelsCacheKey,
            ct => _api.SendAsync<JsonElement>(ChannelsRequest, ct),
            IsEmptyArray,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return NotificationChannelsResultMapper.MapChannels(emission);
        }
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<NotificationChannelStats>> StreamStatsAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var raw = _engine.StreamAsync<JsonElement>(
            StatsCacheKey,
            ct => _api.SendAsync<JsonElement>(StatsRequest, ct),
            IsNotObject,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return NotificationChannelsResultMapper.MapStats(emission);
        }
    }

    /// <inheritdoc />
    public async Task SaveAsync(JsonObject body, long? id, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(body);

        var request = id is { } channelId
            ? new ApiRequest(NotificationChannelsRegistration.UpdateOperation, PathParams: PathFor(channelId), Body: body)
            : new ApiRequest(NotificationChannelsRegistration.CreateOperation, Body: body);

        await _api.SendAsync<JsonElement?>(request, cancellationToken).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public async Task DeleteAsync(long id, CancellationToken cancellationToken = default)
    {
        var request = new ApiRequest(NotificationChannelsRegistration.DeleteOperation, PathParams: PathFor(id));
        await _api.SendAsync<JsonElement?>(request, cancellationToken).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public async Task ToggleAsync(long id, CancellationToken cancellationToken = default)
    {
        var request = new ApiRequest(NotificationChannelsRegistration.ToggleOperation, PathParams: PathFor(id));
        await _api.SendAsync<JsonElement?>(request, cancellationToken).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public async Task<ChannelTestResponse> TestAsync(long id, CancellationToken cancellationToken = default)
    {
        var request = new ApiRequest(NotificationChannelsRegistration.TestOperation, PathParams: PathFor(id));
        var response = await _api.SendAsync<JsonElement?>(request, cancellationToken).ConfigureAwait(false);

        if (response is { } value && value.ValueKind == JsonValueKind.Object)
        {
            return new ChannelTestResponse(
                JsonScalars.ReadBool(value, "success", defaultValue: false),
                JsonScalars.ReadString(value, "error"));
        }

        return new ChannelTestResponse(false, null);
    }

    private static Dictionary<string, string> PathFor(long id) =>
        new(StringComparer.Ordinal)
        {
            [NotificationChannelsRegistration.ChannelIdParam] = id.ToString(CultureInfo.InvariantCulture),
        };

    private static bool IsEmptyArray(JsonElement element) =>
        element.ValueKind != JsonValueKind.Array || element.GetArrayLength() == 0;

    private static bool IsNotObject(JsonElement element) => element.ValueKind != JsonValueKind.Object;
}
