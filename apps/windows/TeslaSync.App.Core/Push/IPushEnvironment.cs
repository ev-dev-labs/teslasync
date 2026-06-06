namespace TeslaSync.App.Core.Push;

/// <summary>
/// The ambient device facts a registration carries to the backend (P2/W6-0002): the platform and
/// push transport, the app version, the user locale, an opaque per-install device identifier, and
/// the notification-capability flags. The Windows host supplies these from the package version,
/// globalization preferences and a persisted random install id; the headless core/tests use a
/// <see cref="StaticPushEnvironment"/>.
///
/// <para><see cref="StableDeviceId"/> is deliberately an opaque, non-reversible token (not a serial
/// number, MAC, VIN or username) so the registration record carries no personal data.</para>
/// </summary>
public interface IPushEnvironment
{
    /// <summary>The platform identifier (e.g. <see cref="PushCapabilities.WindowsPlatform"/>).</summary>
    string Platform { get; }

    /// <summary>The push transport identifier (e.g. <see cref="PushCapabilities.WnsProvider"/>).</summary>
    string PushProvider { get; }

    /// <summary>The running application version (e.g. <c>1.2.3.0</c>).</summary>
    string AppVersion { get; }

    /// <summary>The current BCP-47 user locale (e.g. <c>en-US</c>).</summary>
    string Locale { get; }

    /// <summary>An opaque, stable, non-PII per-install device identifier.</summary>
    string StableDeviceId { get; }

    /// <summary>The notification-capability flags this client supports.</summary>
    IReadOnlyList<string> Capabilities { get; }
}

/// <summary>
/// A fixed <see cref="IPushEnvironment"/> for the headless core and the unit tests. The Windows app
/// registers a package-derived implementation that overrides this via <c>TryAddSingleton</c>.
/// </summary>
public sealed class StaticPushEnvironment : IPushEnvironment
{
    /// <summary>Creates the environment with explicit values (capabilities default to the Windows set).</summary>
    public StaticPushEnvironment(
        string appVersion,
        string locale,
        string stableDeviceId,
        string platform = PushCapabilities.WindowsPlatform,
        string pushProvider = PushCapabilities.WnsProvider,
        IReadOnlyList<string>? capabilities = null)
    {
        ArgumentException.ThrowIfNullOrEmpty(appVersion);
        ArgumentException.ThrowIfNullOrEmpty(locale);
        ArgumentException.ThrowIfNullOrEmpty(stableDeviceId);
        ArgumentException.ThrowIfNullOrEmpty(platform);
        ArgumentException.ThrowIfNullOrEmpty(pushProvider);

        Platform = platform;
        PushProvider = pushProvider;
        AppVersion = appVersion;
        Locale = locale;
        StableDeviceId = stableDeviceId;
        Capabilities = capabilities ?? PushCapabilities.WindowsDefault;
    }

    /// <inheritdoc />
    public string Platform { get; }

    /// <inheritdoc />
    public string PushProvider { get; }

    /// <inheritdoc />
    public string AppVersion { get; }

    /// <inheritdoc />
    public string Locale { get; }

    /// <inheritdoc />
    public string StableDeviceId { get; }

    /// <inheritdoc />
    public IReadOnlyList<string> Capabilities { get; }
}
