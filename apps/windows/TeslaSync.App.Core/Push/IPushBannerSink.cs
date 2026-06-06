namespace TeslaSync.App.Core.Push;

/// <summary>Severity used to style a foreground push banner.</summary>
public enum PushBannerSeverity
{
    /// <summary>Informational (default).</summary>
    Info,

    /// <summary>A warning that needs attention but is not critical.</summary>
    Warning,

    /// <summary>A critical/urgent alert.</summary>
    Critical,
}

/// <summary>An in-app banner request raised from a foreground push (P2/W6-0002).</summary>
public sealed record PushBanner(PushBannerSeverity Severity, string Title, string Message);

/// <summary>
/// The W2 banner contract for the push layer (P2/W6-0002). The Windows implementation
/// (<c>PushBannerPresenter</c>) marshals to the UI thread and drives a shared <c>TsAlertBanner</c>;
/// the headless core registers a null implementation, and the App overrides it.
/// </summary>
public interface IPushBannerSink
{
    /// <summary>Publishes <paramref name="banner"/> to the in-app banner chrome.</summary>
    void Publish(PushBanner banner);
}

/// <summary>
/// A null <see cref="IPushBannerSink"/> used when no banner chrome is registered (the headless core
/// and unit tests). A deliberate Null-Object: it accepts and discards banners.
/// </summary>
public sealed class NullPushBannerSink : IPushBannerSink
{
    /// <inheritdoc />
    public void Publish(PushBanner banner)
    {
    }
}
