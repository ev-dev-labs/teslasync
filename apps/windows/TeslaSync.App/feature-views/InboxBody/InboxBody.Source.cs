using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The repository-backed <see cref="IInboxSource"/> — the native data adapter for the notification inbox. It
/// runs a single cache-then-network read of <c>GET /notifications/logs</c> (generated operation
/// <c>get_api_v1_notifications_logs</c>), appending the active <see cref="InboxFilter"/> as snake_case query
/// parameters and — in grouped mode — the <c>grouped=true</c> flag, exactly as the web composes
/// <c>useNotificationLogs</c> (flat) and <c>useNotificationGroups</c> (the same endpoint with
/// <c>?grouped=true</c>). Each raw JSON body is cached so the snake_case wire shape round-trips losslessly and
/// is then projected through <see cref="InboxReading.FromJson"/>. No HTTP touches the view.
/// </summary>
public sealed class InboxSource : IInboxSource
{
    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    public InboxSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<InboxReading>> StreamAsync(
        InboxQuery query,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(query);

        // Web parity: grouping only applies on the inbox tab — the archive workflow is always row-by-row.
        bool grouped = query.View == InboxView.Grouped && !query.Filter.Archived;

        var parameters = new Dictionary<string, object?>(query.Filter.ToQuery(), StringComparer.Ordinal);
        if (grouped)
        {
            parameters["grouped"] = "true";
        }

        var request = new ApiRequest(Operations.Notifications.Logs, null, parameters);
        string cacheKey = CacheKey(grouped, parameters);

        IAsyncEnumerable<RepositoryResult<JsonElement>> stream = _engine.StreamAsync<JsonElement>(
            cacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            IsEmpty,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (RepositoryResult<JsonElement> result in stream.ConfigureAwait(false))
        {
            yield return Map(result, query.View, grouped);
        }
    }

    private static RepositoryResult<InboxReading> Map(
        RepositoryResult<JsonElement> result,
        InboxView view,
        bool grouped)
    {
        InboxReading? reading = result.Value is { } body
            ? InboxReading.FromJson(body, view, grouped)
            : null;

        return new RepositoryResult<InboxReading>(
            result.Status,
            reading,
            result.FetchedAt,
            result.IsStale,
            result.Error);
    }

    // The logs / groups payload is a JSON array; a null body or empty array is the empty inbox.
    private static bool IsEmpty(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        JsonValueKind.Array => element.GetArrayLength() == 0,
        _ => false,
    };

    private static string CacheKey(bool grouped, IReadOnlyDictionary<string, object?> parameters)
    {
        var builder = new StringBuilder("notifications:logs:");
        builder.Append(grouped ? "grouped" : "flat");
        foreach (KeyValuePair<string, object?> pair in parameters.OrderBy(p => p.Key, StringComparer.Ordinal))
        {
            builder.Append(';').Append(pair.Key).Append('=')
                .Append(Convert.ToString(pair.Value, CultureInfo.InvariantCulture));
        }

        return builder.ToString();
    }
}

/// <summary>
/// The repository-backed <see cref="IInboxCommands"/> — the native command adapter for the inbox mutations.
/// Each method issues the matching generated write operation with the <c>{ "ids": [...] }</c> body the Go API
/// expects (or <c>{ "all": true }</c> for the inbox-wide mark-read), mirroring the web mutation hooks
/// (<c>useMarkNotificationsRead</c>, <c>useMarkNotificationsUnread</c>, <c>useBulkMarkRead</c>,
/// <c>useArchiveNotifications</c>, <c>useUnarchiveNotifications</c>, <c>useDeleteNotifications</c>). No HTTP
/// touches the view — the view-model drives this seam.
/// </summary>
public sealed class InboxCommands : IInboxCommands
{
    private const string MarkReadOperation = "post_api_v1_notifications_mark_read";
    private const string MarkUnreadOperation = "post_api_v1_notifications_mark_unread";
    private const string ArchiveOperation = "post_api_v1_notifications_archive";
    private const string UnarchiveOperation = "post_api_v1_notifications_unarchive";
    private const string DeleteOperation = "delete_api_v1_notifications_logs";

    private readonly IApiClient _api;

    /// <summary>Creates the command adapter over the generated contract client.</summary>
    /// <param name="api">The generated contract client.</param>
    public InboxCommands(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public Task MarkReadAsync(IReadOnlyList<long> ids, CancellationToken cancellationToken = default) =>
        SendIdsAsync(MarkReadOperation, ids, cancellationToken);

    /// <inheritdoc />
    public Task MarkAllReadAsync(CancellationToken cancellationToken = default) =>
        SendAsync(new ApiRequest(MarkReadOperation, Body: new MarkAllBody(true)), cancellationToken);

    /// <inheritdoc />
    public Task MarkUnreadAsync(IReadOnlyList<long> ids, CancellationToken cancellationToken = default) =>
        SendIdsAsync(MarkUnreadOperation, ids, cancellationToken);

    /// <inheritdoc />
    public Task ArchiveAsync(IReadOnlyList<long> ids, CancellationToken cancellationToken = default) =>
        SendIdsAsync(ArchiveOperation, ids, cancellationToken);

    /// <inheritdoc />
    public Task UnarchiveAsync(IReadOnlyList<long> ids, CancellationToken cancellationToken = default) =>
        SendIdsAsync(UnarchiveOperation, ids, cancellationToken);

    /// <inheritdoc />
    public Task DeleteAsync(IReadOnlyList<long> ids, CancellationToken cancellationToken = default) =>
        SendIdsAsync(DeleteOperation, ids, cancellationToken);

    private Task SendIdsAsync(string operationId, IReadOnlyList<long> ids, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(ids);
        return SendAsync(new ApiRequest(operationId, Body: new IdsBody(ids)), cancellationToken);
    }

    private async Task SendAsync(ApiRequest request, CancellationToken cancellationToken) =>
        await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);

    private sealed record IdsBody([property: JsonPropertyName("ids")] IReadOnlyList<long> Ids);

    private sealed record MarkAllBody([property: JsonPropertyName("all")] bool All);
}
