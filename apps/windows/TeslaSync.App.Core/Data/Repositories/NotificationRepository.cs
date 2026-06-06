using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.Core.Data.Repositories;

/// <summary>Cache-then-network reads for the notifications inbox, stats and logs.</summary>
public interface INotificationRepository
{
    /// <summary>The notification channel/inbox list.</summary>
    IAsyncEnumerable<RepositoryResult<JsonElement>> ListAsync(CancellationToken cancellationToken = default);

    /// <summary>Notification delivery statistics.</summary>
    IAsyncEnumerable<RepositoryResult<JsonElement>> GetStatsAsync(CancellationToken cancellationToken = default);

    /// <summary>The notification delivery log.</summary>
    IAsyncEnumerable<RepositoryResult<JsonElement>> GetLogsAsync(CancellationToken cancellationToken = default);

    /// <summary>The unread-notification count.</summary>
    IAsyncEnumerable<RepositoryResult<JsonElement>> GetUnreadCountAsync(CancellationToken cancellationToken = default);
}

/// <summary>Default <see cref="INotificationRepository"/>.</summary>
public sealed class NotificationRepository : RepositoryBase, INotificationRepository
{
    /// <summary>Creates the repository.</summary>
    public NotificationRepository(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
        : base(api, engine, options)
    {
    }

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<JsonElement>> ListAsync(CancellationToken cancellationToken = default) =>
        Stream<JsonElement>("notifications:list", new ApiRequest(Operations.Notifications.List), cancellationToken: cancellationToken);

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<JsonElement>> GetStatsAsync(CancellationToken cancellationToken = default) =>
        Stream<JsonElement>("notifications:stats", new ApiRequest(Operations.Notifications.Stats), cancellationToken: cancellationToken);

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<JsonElement>> GetLogsAsync(CancellationToken cancellationToken = default) =>
        Stream<JsonElement>("notifications:logs", new ApiRequest(Operations.Notifications.Logs), cancellationToken: cancellationToken);

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<JsonElement>> GetUnreadCountAsync(CancellationToken cancellationToken = default) =>
        Stream<JsonElement>("notifications:unread-count", new ApiRequest(Operations.Notifications.UnreadCount), staleSeconds: Behavior.CacheFreshness.LiveStaleSeconds, cancellationToken: cancellationToken);
}
