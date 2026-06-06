using System.Collections.ObjectModel;

namespace TeslaSync.App.Core.Push;

/// <summary>
/// Identifiers and notification-capability flags reported to the backend at device-registration
/// time (P2/W6-0002). The platform/provider strings name the push transport; the capability flags
/// describe what kinds of notification this client can present so the <c>notification-worker</c> can
/// tailor fan-out (ADR-009). All values are static, non-PII descriptors.
/// </summary>
public static class PushCapabilities
{
    /// <summary>The platform identifier sent as <c>platform</c> in the registration payload.</summary>
    public const string WindowsPlatform = "windows";

    /// <summary>The push transport identifier sent as <c>push_provider</c> (Windows Notification Service).</summary>
    public const string WnsProvider = "wns";

    /// <summary>Capability: the client can present interruptive toast notifications.</summary>
    public const string Toast = "toast";

    /// <summary>Capability: the client can render badge/tile counters.</summary>
    public const string Badge = "badge";

    /// <summary>Capability: the client can surface in-app alert banners while in the foreground.</summary>
    public const string Alert = "alert";

    /// <summary>The default Windows capability set (toast + badge + alert).</summary>
    public static readonly IReadOnlyList<string> WindowsDefault =
        new ReadOnlyCollection<string>(new[] { Toast, Badge, Alert });
}
