using TeslaSync.App.Core.Live;
using TeslaSync.App.Core.Push;

namespace TeslaSync.App.Core.Notifications;

/// <summary>
/// The W8 foreground notification fan-out (P2/W8-0001) — the richer successor to the W6
/// <c>ForegroundPushRouter</c>. For each decoded foreground <see cref="PushPayload"/> it composes a
/// localized, deep-linkable <see cref="NotificationContent"/>, asks <see cref="NotificationDeliveryPolicy"/>
/// how to deliver it given the foreground state, the user settings, quiet hours and Focus Assist, and
/// then fans out accordingly: it always records the notification in the inbox, raises the in-app banner
/// when the app is active, and presents an actionable OS toast when appropriate. It implements
/// <see cref="IForegroundPushRouter"/> so it drops straight into the W6 <c>PushSessionController</c>;
/// headless and unit-tested with fakes.
/// </summary>
public sealed class NotificationDispatcher : IForegroundPushRouter
{
    private readonly INotificationInbox _inbox;
    private readonly IPushBannerSink _banner;
    private readonly IToastPresenter _toast;
    private readonly NotificationComposer _composer;
    private readonly IForegroundLifecycle _foreground;
    private readonly IFocusAssistProvider _focusAssist;
    private readonly Func<NotificationSettings> _settings;
    private readonly NotificationDiagnostics _diagnostics;
    private readonly Func<DateTimeOffset> _clock;

    /// <summary>Creates the dispatcher over the inbox, banner, toast surface, composer and delivery context.</summary>
    public NotificationDispatcher(
        INotificationInbox inbox,
        IPushBannerSink banner,
        IToastPresenter toast,
        NotificationComposer composer,
        IForegroundLifecycle foreground,
        IFocusAssistProvider focusAssist,
        Func<NotificationSettings> settings,
        NotificationDiagnostics diagnostics,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(inbox);
        ArgumentNullException.ThrowIfNull(banner);
        ArgumentNullException.ThrowIfNull(toast);
        ArgumentNullException.ThrowIfNull(composer);
        ArgumentNullException.ThrowIfNull(foreground);
        ArgumentNullException.ThrowIfNull(focusAssist);
        ArgumentNullException.ThrowIfNull(settings);
        ArgumentNullException.ThrowIfNull(diagnostics);

        _inbox = inbox;
        _banner = banner;
        _toast = toast;
        _composer = composer;
        _foreground = foreground;
        _focusAssist = focusAssist;
        _settings = settings;
        _diagnostics = diagnostics;
        _clock = clock ?? (() => DateTimeOffset.Now);
    }

    /// <inheritdoc />
    public async Task RouteAsync(PushPayload payload, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(payload);

        var content = _composer.Compose(payload);
        var decision = NotificationDeliveryPolicy.Decide(
            content,
            _settings(),
            _focusAssist.Current,
            _foreground.IsForeground,
            TimeOnly.FromTimeSpan(_clock().TimeOfDay));

        if (decision.Ingest)
        {
            await _inbox.IngestAsync(payload, cancellationToken).ConfigureAwait(false);
            _diagnostics.RecordIngested(content.Kind);
        }

        if (decision.InAppBanner)
        {
            _banner.Publish(new PushBanner(content.Severity, content.Title, content.Body));
            _diagnostics.RecordBanner(content.Kind);
        }

        if (decision.OsToast)
        {
            await _toast.PresentAsync(content.ToToast(), cancellationToken).ConfigureAwait(false);
            _diagnostics.RecordToast(content.Kind);
        }
        else if (!decision.InAppBanner)
        {
            _diagnostics.RecordToastSuppressed(content.Kind);
        }
    }
}
