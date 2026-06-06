using System.Globalization;
using TeslaSync.App.Core.Push;
using Windows.ApplicationModel;
using Windows.Storage;
using Windows.System.UserProfile;

namespace TeslaSync.App.Platform;

/// <summary>
/// The Windows <see cref="IPushEnvironment"/> (P2/W6-0002): it sources the registration facts from
/// the package version, the user's preferred language and a persisted random per-install id. The
/// install id is an opaque GUID (no hardware serial, MAC, account name or VIN) so the registration
/// carries no personal data; it is stored once in <c>LocalSettings</c> so re-registration upserts the
/// same device. Every lookup is guarded so an unpackaged dev run falls back to safe defaults.
/// </summary>
public sealed class PushDeviceEnvironment : IPushEnvironment
{
    private const string SettingsContainer = "teslasync.push";
    private const string DeviceIdKey = "install_id";

    /// <summary>Creates the environment, resolving the package/locale/install facts once.</summary>
    public PushDeviceEnvironment()
    {
        AppVersion = ResolveAppVersion();
        Locale = ResolveLocale();
        StableDeviceId = ResolveDeviceId();
        Capabilities = PushCapabilities.WindowsDefault;
    }

    /// <inheritdoc />
    public string Platform => PushCapabilities.WindowsPlatform;

    /// <inheritdoc />
    public string PushProvider => PushCapabilities.WnsProvider;

    /// <inheritdoc />
    public string AppVersion { get; }

    /// <inheritdoc />
    public string Locale { get; }

    /// <inheritdoc />
    public string StableDeviceId { get; }

    /// <inheritdoc />
    public IReadOnlyList<string> Capabilities { get; }

    private static string ResolveAppVersion()
    {
        try
        {
            var v = Package.Current.Id.Version;
            return string.Create(
                CultureInfo.InvariantCulture,
                $"{v.Major}.{v.Minor}.{v.Build}.{v.Revision}");
        }
        catch (Exception)
        {
            return "0.0.0.0";
        }
    }

    private static string ResolveLocale()
    {
        try
        {
            var languages = GlobalizationPreferences.Languages;
            if (languages.Count > 0 && !string.IsNullOrWhiteSpace(languages[0]))
            {
                return languages[0];
            }
        }
        catch (Exception)
        {
            // Fall through to the culture-based default below.
        }

        return CultureInfo.CurrentUICulture.Name is { Length: > 0 } name ? name : "en-US";
    }

    private static string ResolveDeviceId()
    {
        try
        {
            var container = ApplicationData.Current.LocalSettings
                .CreateContainer(SettingsContainer, ApplicationDataCreateDisposition.Always);
            if (container.Values.TryGetValue(DeviceIdKey, out var existing) && existing is string id && !string.IsNullOrEmpty(id))
            {
                return id;
            }

            var generated = Guid.NewGuid().ToString("N");
            container.Values[DeviceIdKey] = generated;
            return generated;
        }
        catch (Exception)
        {
            // No package identity — a process-stable opaque id keeps registration working in-session.
            return "ephemeral-" + Guid.NewGuid().ToString("N");
        }
    }
}
