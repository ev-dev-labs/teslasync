using System.Collections.Generic;
using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive freshness state of the registered-devices read backing the
/// <see cref="BrowserPushChannelViewModel"/> — the native union of the loading / loaded / empty / stale /
/// offline / error branches the P2 feature-view contract mandates. The web source
/// (web/src/features/notifications/components/BrowserPushChannelCard.tsx) reads its per-device list through the
/// TanStack query <c>usePushSubscriptions()</c>; the native surface owns the same cache-then-network read, so
/// this state is driven by that read while the channel chrome (header, status badge, enable/disable affordance),
/// which depends only on the local device capability, always renders.
/// </summary>
public enum BrowserPushChannelState
{
    /// <summary>The device read is in flight with no cached value yet — render the skeleton rows.</summary>
    Loading,

    /// <summary>A fresh device list arrived — render the registered-devices list.</summary>
    Loaded,

    /// <summary>The read resolved with no registered devices — render the friendly empty surface.</summary>
    Empty,

    /// <summary>A cached list older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached list remains — render content plus an offline chip.</summary>
    Offline,

    /// <summary>The read failed with no cached list — render the retriable error surface.</summary>
    Error,
}

/// <summary>
/// Whether browser push is usable on this device+server pairing — the native fold of the web <c>useWebPush</c>
/// hook's <c>isSupported</c> / <c>isPushSupported</c> flags (the latter already combining the Push API support
/// and the server VAPID key). The four values reproduce the web <c>disabledReason</c> precedence: notifications
/// unsupported, then server not configured, then the Push API unsupported, then (separately) a denied
/// permission. <see cref="Supported"/> means every capability gate is open.
/// </summary>
public enum BrowserPushCapability
{
    /// <summary>Every capability gate is open — show the enable / disable affordance (web <c>!isUnsupported</c>).</summary>
    Supported,

    /// <summary>The client cannot show notifications at all (web <c>!isSupported</c>).</summary>
    NotificationsUnsupported,

    /// <summary>The server has no VAPID keys configured (web <c>publicKey === null</c>).</summary>
    ServerNotConfigured,

    /// <summary>The client has no Push API (web <c>!isPushSupported</c> with a configured server).</summary>
    PushApiUnsupported,
}

/// <summary>
/// The OS notification-permission status — the native mirror of the web <c>useWebPush</c> hook's
/// <c>permission</c> (a browser <c>NotificationPermission</c>). The three values mirror the browser
/// <c>default</c> / <c>granted</c> / <c>denied</c> permission states.
/// </summary>
public enum BrowserPushPermissionStatus
{
    /// <summary>Permission has not been requested yet (web <c>'default'</c>).</summary>
    Default,

    /// <summary>Permission is granted (web <c>'granted'</c>).</summary>
    Granted,

    /// <summary>Permission is blocked (web <c>'denied'</c>) — drives the blocked reason.</summary>
    Denied,
}

/// <summary>
/// One server-registered push subscription — the native mirror of the web <c>PushSubscriptionRow</c>
/// (web/src/api/types.ts). Only the fields the card renders are retained; the key material (<c>p256dh</c> /
/// <c>auth</c>) is never projected to the UI. Parsed from the snake_case JSON the Go API returns.
/// </summary>
/// <param name="Id">The server row id (web <c>id</c>) — a stable list key.</param>
/// <param name="Endpoint">The push endpoint (web <c>endpoint</c>) — the per-device identity and remove key.</param>
/// <param name="UserAgent">The registering browser's user-agent (web <c>user_agent</c>), or null.</param>
/// <param name="LastUsedAt">When the subscription was last delivered to (web <c>last_used_at</c>), or null.</param>
public sealed record BrowserPushDevice(long Id, string Endpoint, string? UserAgent, DateTimeOffset? LastUsedAt)
{
    /// <summary>Parse a single device row from its JSON object, or null when it carries no endpoint.</summary>
    public static BrowserPushDevice? FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        string? endpoint = ReadString(element, "endpoint");
        if (string.IsNullOrEmpty(endpoint))
        {
            return null;
        }

        long id = element.TryGetProperty("id", out var idEl) && idEl.ValueKind == JsonValueKind.Number
            && idEl.TryGetInt64(out var parsed)
                ? parsed
                : 0;

        return new BrowserPushDevice(id, endpoint, ReadString(element, "user_agent"), ReadTimestamp(element, "last_used_at"));
    }

    /// <summary>Parse the device list from the <c>GET /push/subscribe</c> JSON array (non-arrays yield empty).</summary>
    public static IReadOnlyList<BrowserPushDevice> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<BrowserPushDevice>();
        }

        var rows = new List<BrowserPushDevice>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (FromJson(item) is { } row)
            {
                rows.Add(row);
            }
        }

        return rows;
    }

    private static string? ReadString(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private static DateTimeOffset? ReadTimestamp(JsonElement element, string name)
    {
        if (element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            && DateTimeOffset.TryParse(
                value.GetString(),
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
                out var parsed))
        {
            return parsed;
        }

        return null;
    }
}

/// <summary>
/// The render-ready projection of one registered-device row — the native port of the web per-device
/// <c>&lt;li&gt;</c> (browser label, this-device marker, last-used line and the remove affordance). Pure data so
/// the row composition and Narrator name are unit-tested without a XAML host.
/// </summary>
/// <param name="Endpoint">The endpoint used as the remove key and list identity.</param>
/// <param name="UserAgentText">The browser label (web <c>user_agent</c> or the "Unknown browser" fallback).</param>
/// <param name="IsThisDevice">True when the row is the current device (web <c>currentEndpoint === endpoint</c>).</param>
/// <param name="ThisDeviceMarker">The "(this device)" marker shown when <paramref name="IsThisDevice"/>.</param>
/// <param name="LastUsedText">The last-used line (web "Last used {{when}}" or "Not yet used").</param>
/// <param name="RemoveLabel">The remove button Narrator / tooltip label (web "Remove this device").</param>
/// <param name="AutomationName">The composed row Narrator name.</param>
public sealed record BrowserPushDeviceRow(
    string Endpoint,
    string UserAgentText,
    bool IsThisDevice,
    string ThisDeviceMarker,
    string LastUsedText,
    string RemoveLabel,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the whole BrowserPushChannelCard surface — the header, the status
/// badge, the unsupported reason or the enable/disable affordance, and the registered-devices section. Pure data
/// (no WinUI types) so the projection is unit-tested without a XAML host.
/// </summary>
/// <param name="AutomationName">The surface Narrator name (the localized title).</param>
/// <param name="IconGlyph">The Segoe Fluent bell glyph (web Lucide <c>BellRing</c>).</param>
/// <param name="Title">The card title (web <c>webpush.title</c>).</param>
/// <param name="Subtitle">The card subtitle (web <c>webpush.subtitle</c>).</param>
/// <param name="StatusText">The status badge text (active / not subscribed / unavailable).</param>
/// <param name="StatusStatus">The semantic status driving the badge colour.</param>
/// <param name="StatusAutomationName">The status badge Narrator name.</param>
/// <param name="IsUnsupported">True when a disabled reason applies (web <c>isUnsupported</c>).</param>
/// <param name="DisabledReason">The localized unsupported reason (empty when supported).</param>
/// <param name="ShowEnable">True to show the Enable button (web supported &amp; not subscribed).</param>
/// <param name="EnableText">The Enable button label (web <c>webpush.enable</c>).</param>
/// <param name="ShowDisable">True to show the Disable button (web supported &amp; subscribed).</param>
/// <param name="DisableText">The Disable button label (web <c>webpush.disable</c>).</param>
/// <param name="PlatformNote">The platform enable hint shown beside the action (web <c>webpush.iosNote</c>).</param>
/// <param name="DevicesHeading">The registered-devices heading (web <c>webpush.devices.title</c>).</param>
/// <param name="Devices">The projected per-device rows in server order.</param>
/// <param name="DevicesEmptyText">The friendly empty-state line shown when no devices are registered.</param>
public sealed record BrowserPushChannelDisplay(
    string AutomationName,
    string IconGlyph,
    string Title,
    string Subtitle,
    string StatusText,
    StatusKind StatusStatus,
    string StatusAutomationName,
    bool IsUnsupported,
    string DisabledReason,
    bool ShowEnable,
    string EnableText,
    bool ShowDisable,
    string DisableText,
    string PlatformNote,
    string DevicesHeading,
    IReadOnlyList<BrowserPushDeviceRow> Devices,
    string DevicesEmptyText);

/// <summary>
/// Pure projection from the local push capability and the registered-device list to the render-ready
/// <see cref="BrowserPushChannelDisplay"/> — the native port of the web BrowserPushChannelCard render
/// (web/src/features/notifications/components/BrowserPushChannelCard.tsx). Every owned string resolves through
/// the i18n facade using the web's keys with the web English fallback, the disabled-reason precedence matches
/// the web <c>disabledReason</c> ladder, and the per-device rows are built in server order. No SI conversion
/// applies — the surface carries no measurements; the only formatted value is the relative last-used time, which
/// reuses the shared <see cref="DateTimeFormatting"/> port of the web <c>formatRelative</c>.
/// </summary>
public static class BrowserPushChannelProjection
{
    /// <summary>Segoe Fluent "Ringer" bell glyph standing in for the web Lucide <c>BellRing</c> icon.</summary>
    public const string BellGlyph = "\uEA8F";

    /// <summary>Segoe Fluent "RingerSilent" glyph standing in for the web Lucide <c>BellOff</c> icon.</summary>
    public const string BellOffGlyph = "\uE7ED";

    /// <summary>Segoe Fluent "CellPhone" glyph standing in for the web Lucide <c>Smartphone</c> icon.</summary>
    public const string DeviceGlyph = "\uE8EA";

    /// <summary>Segoe Fluent "Delete" glyph standing in for the web Lucide <c>Trash2</c> icon.</summary>
    public const string RemoveGlyph = "\uE74D";

    /// <summary>Segoe Fluent "Warning" glyph standing in for the web Lucide <c>AlertCircle</c> icon.</summary>
    public const string WarningGlyph = "\uE7BA";

    /// <summary>
    /// Project the capability, permission, subscription state and device list into the render-ready display,
    /// resolving every string through <paramref name="localizer"/> and formatting last-used times relative to
    /// <paramref name="now"/>.
    /// </summary>
    /// <param name="capability">Whether browser push is usable here (web <c>useWebPush</c> support flags).</param>
    /// <param name="permission">The OS notification-permission status (web <c>useWebPush.permission</c>).</param>
    /// <param name="isSubscribed">Whether this device is subscribed (web <c>useWebPush.isSubscribed</c>).</param>
    /// <param name="currentEndpoint">This device's endpoint (web <c>useWebPush.currentEndpoint</c>), or null.</param>
    /// <param name="devices">The server-registered devices (web <c>usePushSubscriptions</c>).</param>
    /// <param name="localizer">The i18n facade resolving every owned string.</param>
    /// <param name="now">The wall clock the relative last-used times are computed against.</param>
    public static BrowserPushChannelDisplay Project(
        BrowserPushCapability capability,
        BrowserPushPermissionStatus permission,
        bool isSubscribed,
        string? currentEndpoint,
        IReadOnlyList<BrowserPushDevice> devices,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(devices);
        ArgumentNullException.ThrowIfNull(localizer);

        string disabledReason = DisabledReason(capability, permission, localizer);
        bool isUnsupported = disabledReason.Length > 0;

        string title = localizer.GetString(BrowserPushChannelStrings.Title, "Browser push");
        string statusText;
        StatusKind statusStatus;
        if (isUnsupported)
        {
            statusText = localizer.GetString(BrowserPushChannelStrings.StatusUnsupported, "Unavailable");
            statusStatus = StatusKind.Warning;
        }
        else if (isSubscribed)
        {
            statusText = localizer.GetString(BrowserPushChannelStrings.StatusSubscribed, "Active on this device");
            statusStatus = StatusKind.Success;
        }
        else
        {
            statusText = localizer.GetString(BrowserPushChannelStrings.StatusNotSubscribed, "Not subscribed");
            statusStatus = StatusKind.Neutral;
        }

        bool showEnable = !isUnsupported && !isSubscribed;
        bool showDisable = !isUnsupported && isSubscribed;
        string enableText = localizer.GetString(BrowserPushChannelStrings.Enable, "Enable on this device");
        string disableText = localizer.GetString(BrowserPushChannelStrings.Disable, "Disable on this device");

        return new BrowserPushChannelDisplay(
            AutomationName: title,
            IconGlyph: BellGlyph,
            Title: title,
            Subtitle: localizer.GetString(
                BrowserPushChannelStrings.Subtitle,
                "Get OS-level notifications even when TeslaSync is closed."),
            StatusText: statusText,
            StatusStatus: statusStatus,
            StatusAutomationName: statusText,
            IsUnsupported: isUnsupported,
            DisabledReason: disabledReason,
            ShowEnable: showEnable,
            EnableText: enableText,
            ShowDisable: showDisable,
            DisableText: disableText,
            PlatformNote: localizer.GetString(
                BrowserPushChannelStrings.PlatformNote,
                "iOS Safari requires version 16.4 or later, and you must add TeslaSync to your Home Screen."),
            DevicesHeading: localizer.GetString(BrowserPushChannelStrings.DevicesTitle, "Registered devices"),
            Devices: ProjectDevices(devices, currentEndpoint, localizer, now),
            DevicesEmptyText: localizer.GetString(
                BrowserPushChannelStrings.DevicesEmpty,
                "No browsers or devices are registered yet."));
    }

    private static string DisabledReason(
        BrowserPushCapability capability,
        BrowserPushPermissionStatus permission,
        ILocalizer localizer) => capability switch
        {
            BrowserPushCapability.NotificationsUnsupported => localizer.GetString(
                BrowserPushChannelStrings.UnsupportedNotification,
                "This browser doesn't support notifications."),
            BrowserPushCapability.ServerNotConfigured => localizer.GetString(
                BrowserPushChannelStrings.UnsupportedServerDisabled,
                "Browser push is not configured on this server. Ask your administrator to set the VAPID keys."),
            BrowserPushCapability.PushApiUnsupported => localizer.GetString(
                BrowserPushChannelStrings.UnsupportedPushApi,
                "This browser doesn't support the Push API."),
            _ when permission == BrowserPushPermissionStatus.Denied => localizer.GetString(
                BrowserPushChannelStrings.UnsupportedPermissionDenied,
                "Notifications are blocked for this site. Re-enable them in your browser settings to use browser push."),
            _ => string.Empty,
        };

    private static List<BrowserPushDeviceRow> ProjectDevices(
        IReadOnlyList<BrowserPushDevice> devices,
        string? currentEndpoint,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        string unknownAgent = localizer.GetString(BrowserPushChannelStrings.DevicesUnknownAgent, "Unknown browser");
        string thisDeviceMarker = localizer.GetString(BrowserPushChannelStrings.DevicesThisDevice, "(this device)");
        string removeLabel = localizer.GetString(BrowserPushChannelStrings.DevicesRemove, "Remove this device");
        string neverUsed = localizer.GetString(BrowserPushChannelStrings.DevicesNeverUsed, "Not yet used");
        string lastUsedTemplate = localizer.GetString(BrowserPushChannelStrings.DevicesLastUsed, "Last used {{when}}");

        var rows = new List<BrowserPushDeviceRow>(devices.Count);
        foreach (var device in devices)
        {
            bool isThisDevice = currentEndpoint is not null && currentEndpoint == device.Endpoint;
            string agent = string.IsNullOrEmpty(device.UserAgent) ? unknownAgent : device.UserAgent!;
            string lastUsed = device.LastUsedAt is { } at
                ? lastUsedTemplate.Replace(
                    "{{when}}",
                    DateTimeFormatting.Format(at, DateTimeVariant.Relative, now),
                    StringComparison.Ordinal)
                : neverUsed;

            string automationName = isThisDevice
                ? string.Format(CultureInfo.CurrentCulture, "{0} {1}. {2}", agent, thisDeviceMarker, lastUsed)
                : string.Format(CultureInfo.CurrentCulture, "{0}. {1}", agent, lastUsed);

            rows.Add(new BrowserPushDeviceRow(
                Endpoint: device.Endpoint,
                UserAgentText: agent,
                IsThisDevice: isThisDevice,
                ThisDeviceMarker: thisDeviceMarker,
                LastUsedText: lastUsed,
                RemoveLabel: removeLabel,
                AutomationName: automationName));
        }

        return rows;
    }
}

/// <summary>
/// The canonical i18n keys the BrowserPushChannelCard surface resolves — every <c>t()</c> call in the web source
/// plus the one native-only key the P2 contract adds (the registered-devices empty state, which the web hides
/// rather than rendering). Centralised so the catalog is asserted once against the web source and the keys never
/// drift between the projection and the resource pipeline.
/// </summary>
public static class BrowserPushChannelStrings
{
    /// <summary>Card title (web <c>webpush.title</c>).</summary>
    public const string Title = "webpush.title";

    /// <summary>Card subtitle (web <c>webpush.subtitle</c>).</summary>
    public const string Subtitle = "webpush.subtitle";

    /// <summary>Subscribed status badge (web <c>webpush.status.subscribed</c>).</summary>
    public const string StatusSubscribed = "webpush.status.subscribed";

    /// <summary>Not-subscribed status badge (web <c>webpush.status.notSubscribed</c>).</summary>
    public const string StatusNotSubscribed = "webpush.status.notSubscribed";

    /// <summary>Unavailable status badge (web <c>webpush.status.unsupported</c>).</summary>
    public const string StatusUnsupported = "webpush.status.unsupported";

    /// <summary>Notifications-unsupported reason (web <c>webpush.unsupported.notification</c>).</summary>
    public const string UnsupportedNotification = "webpush.unsupported.notification";

    /// <summary>Server-not-configured reason (web <c>webpush.unsupported.serverDisabled</c>).</summary>
    public const string UnsupportedServerDisabled = "webpush.unsupported.serverDisabled";

    /// <summary>Push-API-unsupported reason (web <c>webpush.unsupported.pushApi</c>).</summary>
    public const string UnsupportedPushApi = "webpush.unsupported.pushApi";

    /// <summary>Permission-denied reason (web <c>webpush.unsupported.permissionDenied</c>).</summary>
    public const string UnsupportedPermissionDenied = "webpush.unsupported.permissionDenied";

    /// <summary>Enable button label (web <c>webpush.enable</c>).</summary>
    public const string Enable = "webpush.enable";

    /// <summary>Disable button label (web <c>webpush.disable</c>).</summary>
    public const string Disable = "webpush.disable";

    /// <summary>Platform enable hint shown beside the action (web <c>webpush.iosNote</c>).</summary>
    public const string PlatformNote = "webpush.iosNote";

    /// <summary>Registered-devices heading (web <c>webpush.devices.title</c>).</summary>
    public const string DevicesTitle = "webpush.devices.title";

    /// <summary>Unknown-browser fallback label (web <c>webpush.devices.unknownAgent</c>).</summary>
    public const string DevicesUnknownAgent = "webpush.devices.unknownAgent";

    /// <summary>Last-used line template (web <c>webpush.devices.lastUsed</c>).</summary>
    public const string DevicesLastUsed = "webpush.devices.lastUsed";

    /// <summary>Never-used line (web <c>webpush.devices.neverUsed</c>).</summary>
    public const string DevicesNeverUsed = "webpush.devices.neverUsed";

    /// <summary>This-device marker (web <c>webpush.devices.thisDevice</c>).</summary>
    public const string DevicesThisDevice = "webpush.devices.thisDevice";

    /// <summary>Remove button label (web <c>webpush.devices.remove</c>).</summary>
    public const string DevicesRemove = "webpush.devices.remove";

    /// <summary>Registered-devices empty state (native-only; the web hides the section when empty).</summary>
    public const string DevicesEmpty = "webpush.devices.empty";

    /// <summary>Error-surface title for a hard device-read failure.</summary>
    public const string ErrorTitle = "webpush.error.title";

    /// <summary>Generic device-read failure message.</summary>
    public const string ErrorLoad = "webpush.error.load";

    /// <summary>Offline device-read message.</summary>
    public const string ErrorOffline = "webpush.error.offline";

    /// <summary>Unauthenticated device-read message.</summary>
    public const string ErrorAuth = "webpush.error.auth";

    /// <summary>Retry affordance label.</summary>
    public const string Retry = "common.retry";

    /// <summary>Refresh affordance Narrator label.</summary>
    public const string Refresh = "webpush.refresh";

    /// <summary>Stale freshness chip label.</summary>
    public const string StaleChip = "webpush.staleChip";

    /// <summary>Offline freshness chip label.</summary>
    public const string OfflineChip = "webpush.offlineChip";

    /// <summary>Every key the surface resolves — asserted in tests as the i18n catalog.</summary>
    public static IReadOnlyList<string> AllKeys => new[]
    {
        Title,
        Subtitle,
        StatusSubscribed,
        StatusNotSubscribed,
        StatusUnsupported,
        UnsupportedNotification,
        UnsupportedServerDisabled,
        UnsupportedPushApi,
        UnsupportedPermissionDenied,
        Enable,
        Disable,
        PlatformNote,
        DevicesTitle,
        DevicesUnknownAgent,
        DevicesLastUsed,
        DevicesNeverUsed,
        DevicesThisDevice,
        DevicesRemove,
        DevicesEmpty,
        ErrorTitle,
        ErrorLoad,
        ErrorOffline,
        ErrorAuth,
        Retry,
        Refresh,
        StaleChip,
        OfflineChip,
    };
}

/// <summary>
/// Canonical metadata for the BrowserPushChannelCard surface — the native anchor for the web component at
/// web/src/features/notifications/components/BrowserPushChannelCard.tsx. Centralises the diagnostics
/// <see cref="Slug"/> emitted with the <c>view.opened</c> event (P1/S11) and the generated push operation ids
/// the device source reads and writes.
/// </summary>
public static class BrowserPushChannelRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "BrowserPushChannelCard";

    /// <summary>The web component this surface mirrors.</summary>
    public const string WebSource = "features/notifications/components/BrowserPushChannelCard.tsx";

    /// <summary>The generated operation id for <c>GET /push/subscribe</c> (web <c>usePushSubscriptions</c>).</summary>
    public const string DevicesGetOperation = "get_api_v1_push_subscribe";

    /// <summary>The generated operation id for <c>DELETE /push/subscribe</c> (web <c>useUnsubscribePush</c>).</summary>
    public const string DeviceDeleteOperation = "delete_api_v1_push_subscribe";

    /// <summary>The generated operation id for <c>GET /push/public-key</c> (web <c>usePushPublicKey</c>).</summary>
    public const string PublicKeyOperation = "get_api_v1_push_public_key";
}

/// <summary>
/// PII-safe diagnostics for the BrowserPushChannelCard surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never an endpoint, user-agent or device id — so
/// a diagnostics line can never leak a registered device. Thread-safe.
/// </summary>
public sealed class BrowserPushChannelDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional operational-only line sink (no user data is ever passed).</param>
    public BrowserPushChannelDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=BrowserPushChannelCard</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={BrowserPushChannelRegistration.Slug}");
    }
}
