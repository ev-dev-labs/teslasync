using System;
using System.Collections.Generic;
using System.Runtime.CompilerServices;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Notifications;

/// <summary>
/// The render-ready projection behind the native <c>ChannelsPage</c> — the two visible literals the web page
/// resolves (web/src/features/notifications/pages/ChannelsPage.tsx renders <c>t('notifications.channels.title')</c>
/// as the <c>PageContainer</c> title and the <c>usePageTitle</c> document title, and
/// <c>t('notifications.channels.subtitle')</c> as the sub-heading). The page owns no data of its own, so this
/// projection carries no data state — only the localized chrome the page-container header binds to.
/// </summary>
/// <param name="Title">The localized page title (web <c>notifications.channels.title</c>).</param>
/// <param name="Subtitle">The localized sub-heading (web <c>notifications.channels.subtitle</c>).</param>
public sealed record ChannelsPageDisplay(string Title, string Subtitle)
{
    /// <summary>Resolve the title + subtitle through the i18n facade (web <c>t(...)</c> with the inline defaults).</summary>
    public static ChannelsPageDisplay Project(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return new ChannelsPageDisplay(
            ChannelsPageRegistration.Title(localizer),
            ChannelsPageRegistration.Subtitle(localizer));
    }
}

/// <summary>
/// Canonical metadata for the Channels page — the native mirror of the web route <c>/notifications/channels</c>
/// (nav name <c>Channels</c>). The shell page factory registers the surface under <see cref="RouteName"/>; the
/// title and subtitle resolve through the i18n facade with the web key names and the web inline-default English
/// copy (these two keys live as inline <c>t(key, default)</c> fallbacks in the web source — they are not catalog
/// entries — so the native surface resolves them the same way: keyed, with the same English fallback).
/// </summary>
public static class ChannelsPageRegistration
{
    /// <summary>The navigation route name the shell page factory registers this surface under.</summary>
    public const string RouteName = "NotificationsChannels";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "ChannelsPage";

    /// <summary>The localized page title (web <c>notifications.channels.title</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("notifications.channels.title", "Notification channels");
    }

    /// <summary>The localized page subtitle (web <c>notifications.channels.subtitle</c>).</summary>
    public static string Subtitle(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "notifications.channels.subtitle",
            "Where to send notifications: Discord, Slack, Telegram, email, ntfy, Pushover, or a custom webhook.");
    }
}

/// <summary>
/// The default empty channels feed the parameterless <see cref="ChannelsPage"/> hosts its
/// <c>NotificationChannelsView</c> against (the no-backend default, mirroring the other W7 pages' empty feeds).
/// The two reads yield a single resolved-but-empty snapshot — driving the hosted view's friendly empty state —
/// and the four mutations are inert. The repository-backed source is wired separately from the shared data layer
/// (web's TanStack hooks); this feed keeps the page mountable without a backend.
/// </summary>
public sealed class EmptyNotificationChannelsSource : INotificationChannelsSource
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyNotificationChannelsSource Instance { get; } = new();

    private EmptyNotificationChannelsSource()
    {
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<NotificationChannelList>> StreamChannelsAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        yield return RepositoryResult<NotificationChannelList>.Empty();
        await Task.CompletedTask.ConfigureAwait(false);
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<NotificationChannelStats>> StreamStatsAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        yield return RepositoryResult<NotificationChannelStats>.Empty();
        await Task.CompletedTask.ConfigureAwait(false);
    }

    /// <inheritdoc />
    public Task SaveAsync(JsonObject body, long? id, CancellationToken cancellationToken = default) => Task.CompletedTask;

    /// <inheritdoc />
    public Task DeleteAsync(long id, CancellationToken cancellationToken = default) => Task.CompletedTask;

    /// <inheritdoc />
    public Task ToggleAsync(long id, CancellationToken cancellationToken = default) => Task.CompletedTask;

    /// <inheritdoc />
    public Task<ChannelTestResponse> TestAsync(long id, CancellationToken cancellationToken = default) =>
        Task.FromResult(new ChannelTestResponse(false, null));
}

/// <summary>
/// PII-safe diagnostics for the Channels page (P1/S11 diagnostics contract). Records only the operational
/// <c>view.opened</c> event with the surface slug — never a channel name, credential or recipient — so a
/// diagnostics line can never leak notification configuration. Thread-safe.
/// </summary>
public sealed class ChannelsPageDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public ChannelsPageDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ChannelsPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={ChannelsPageRegistration.Slug}");
    }
}
