namespace TeslaSync.App.Core.Push;

/// <summary>
/// Routes a decoded foreground push into the app (P2/W6-0002). It is the single fan-out point a
/// <c>PushSessionController</c> calls for every payload the WNS channel delivers while the app is
/// running.
/// </summary>
public interface IForegroundPushRouter
{
    /// <summary>Routes <paramref name="payload"/> into the inbox, banner chrome and toast surface.</summary>
    Task RouteAsync(PushPayload payload, CancellationToken cancellationToken = default);
}

/// <summary>
/// The default <see cref="IForegroundPushRouter"/> (P2/W6-0002). For each foreground payload it:
/// <list type="number">
///   <item>ingests it into the <see cref="INotificationInbox"/> (notifications state), then</item>
///   <item>raises an in-app W2 banner via <see cref="IPushBannerSink"/>, then</item>
///   <item>presents a toast via the <see cref="IToastService"/> contract.</item>
/// </list>
/// A payload with no display text is ingested only (no empty toast/banner). The router is headless
/// and unit-tested with fakes; the Windows surfaces are injected.
/// </summary>
public sealed class ForegroundPushRouter : IForegroundPushRouter
{
    private readonly INotificationInbox _inbox;
    private readonly IPushBannerSink _banner;
    private readonly IToastService _toast;
    private readonly PushDiagnostics _diagnostics;

    /// <summary>Creates the router over the inbox, banner sink, toast service and diagnostics.</summary>
    public ForegroundPushRouter(
        INotificationInbox inbox,
        IPushBannerSink banner,
        IToastService toast,
        PushDiagnostics diagnostics)
    {
        ArgumentNullException.ThrowIfNull(inbox);
        ArgumentNullException.ThrowIfNull(banner);
        ArgumentNullException.ThrowIfNull(toast);
        ArgumentNullException.ThrowIfNull(diagnostics);

        _inbox = inbox;
        _banner = banner;
        _toast = toast;
        _diagnostics = diagnostics;
    }

    /// <inheritdoc />
    public async Task RouteAsync(PushPayload payload, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(payload);

        await _inbox.IngestAsync(payload, cancellationToken).ConfigureAwait(false);

        var title = payload.Title;
        var body = payload.Body;
        if (!string.IsNullOrWhiteSpace(title) || !string.IsNullOrWhiteSpace(body))
        {
            var displayTitle = title ?? string.Empty;
            var displayBody = body ?? string.Empty;

            _banner.Publish(new PushBanner(SeverityFor(payload.Category), displayTitle, displayBody));
            await _toast.ShowAsync(
                new PushToast(displayTitle, displayBody, payload.Category, LaunchArgumentFor(payload)),
                cancellationToken).ConfigureAwait(false);
        }

        _diagnostics.RecordPayloadRouted();
    }

    private static PushBannerSeverity SeverityFor(string? category) => category?.ToLowerInvariant() switch
    {
        "critical" or "alert" or "security" => PushBannerSeverity.Critical,
        "warning" or "warn" => PushBannerSeverity.Warning,
        _ => PushBannerSeverity.Info,
    };

    private static string? LaunchArgumentFor(PushPayload payload) =>
        payload.Data.TryGetValue("route", out var route) && !string.IsNullOrWhiteSpace(route) ? route : null;
}
