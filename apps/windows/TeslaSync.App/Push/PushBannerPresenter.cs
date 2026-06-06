using Microsoft.UI.Dispatching;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Push;

namespace TeslaSync.App.Push;

/// <summary>
/// Binds the headless <see cref="IPushBannerSink"/> contract to the W2 banner chrome (P2/W6-0002): a
/// foreground push raises an in-app <see cref="TsAlertBanner"/>. <see cref="IPushBannerSink.Publish"/>
/// is invoked from the background push pump, so each update is marshalled onto the UI thread via the
/// supplied <see cref="DispatcherQueue"/> (mirroring the W6 <c>LiveConnectionPresenter</c>). Only the
/// localized title/message reach the banner — never a channel URI, token or raw payload.
/// </summary>
public sealed class PushBannerPresenter : IPushBannerSink
{
    private readonly DispatcherQueue _dispatcher;
    private readonly TsAlertBanner _banner;

    /// <summary>Creates the presenter over the UI dispatcher and the in-app alert banner.</summary>
    public PushBannerPresenter(DispatcherQueue dispatcher, TsAlertBanner banner)
    {
        ArgumentNullException.ThrowIfNull(dispatcher);
        ArgumentNullException.ThrowIfNull(banner);
        _dispatcher = dispatcher;
        _banner = banner;
    }

    /// <inheritdoc />
    public void Publish(PushBanner banner)
    {
        ArgumentNullException.ThrowIfNull(banner);

        if (_dispatcher.HasThreadAccess)
        {
            Apply(banner);
            return;
        }

        _dispatcher.TryEnqueue(() => Apply(banner));
    }

    private void Apply(PushBanner banner)
    {
        _banner.Variant = ToVariant(banner.Severity);
        _banner.Title = banner.Title;
        _banner.Message = banner.Message;
        _banner.IsOpen = true;
    }

    private static CalloutVariant ToVariant(PushBannerSeverity severity) => severity switch
    {
        PushBannerSeverity.Critical => CalloutVariant.Danger,
        PushBannerSeverity.Warning => CalloutVariant.Warning,
        _ => CalloutVariant.Info,
    };
}
