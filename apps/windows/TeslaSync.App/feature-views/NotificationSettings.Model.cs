using System.Collections.Generic;
using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive freshness state the <see cref="NotificationSettingsViewModel"/> exposes — the native
/// union of the loading / loaded / empty / stale / offline / error branches the P2 feature-view contract
/// mandates. The web source (web/src/features/settings/components/NotificationSettings.tsx) reads its
/// browser-tab settings through the TanStack query <c>useSettings()</c>; the native surface owns the same
/// cache-then-network read, so this state is driven by that read while the OS-permission and sound sections
/// (local preferences) always render inside the resolved surface.
/// </summary>
public enum NotificationSettingsState
{
    /// <summary>The settings read is in flight with no cached value yet — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh settings snapshot arrived — render the full surface.</summary>
    Loaded,

    /// <summary>The settings read resolved but carried no object — render the surface with default toggles.</summary>
    Empty,

    /// <summary>A cached snapshot older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render content plus an offline chip.</summary>
    Offline,

    /// <summary>The read failed with no cached snapshot — render the retriable error surface.</summary>
    Error,
}

/// <summary>
/// The OS notification-permission status — the native mirror of the web <c>useWebPush</c> hook's
/// <c>permission</c> (a browser <c>NotificationPermission</c>) combined with its <c>isSupported</c> flag.
/// <see cref="Unsupported"/> stands in for <c>!isSupported</c> (the web "not supported" branch), and the three
/// remaining values mirror the browser <c>default</c> / <c>granted</c> / <c>denied</c> permission states.
/// </summary>
public enum NotificationPermissionStatus
{
    /// <summary>Notifications are unavailable on this client (web <c>!isSupported</c>).</summary>
    Unsupported,

    /// <summary>Permission has not been requested yet — show the enable affordance (web <c>'default'</c>).</summary>
    Default,

    /// <summary>Permission is granted — show the enabled badge and per-event toggles (web <c>'granted'</c>).</summary>
    Granted,

    /// <summary>Permission is blocked — show the blocked hint (web <c>'denied'</c>).</summary>
    Denied,
}

/// <summary>
/// A notification-sound channel — the native, strongly-typed mirror of the web
/// <c>NOTIFICATION_SOUND_CATEGORIES</c> string union (web/src/lib/notificationSound.ts). The declaration order
/// matches the web array so the channel list renders in the same sequence.
/// </summary>
public enum NotificationSoundCategory
{
    /// <summary>Critical alerts (web <c>'critical_alert'</c>).</summary>
    CriticalAlert,

    /// <summary>Warning alerts (web <c>'warning_alert'</c>).</summary>
    WarningAlert,

    /// <summary>Informational alerts (web <c>'info_alert'</c>).</summary>
    InfoAlert,

    /// <summary>Charge-complete cue (web <c>'charge_complete'</c>).</summary>
    ChargeComplete,

    /// <summary>Drive-complete cue (web <c>'drive_complete'</c>).</summary>
    DriveComplete,

    /// <summary>Automation-run cue (web <c>'automation_run'</c>).</summary>
    AutomationRun,

    /// <summary>Achievement cue (web <c>'achievement'</c>).</summary>
    Achievement,
}

/// <summary>
/// The canonical catalog of notification-sound channels — the native port of the web
/// <c>NOTIFICATION_SOUND_CATEGORIES</c> list, its <c>DEFAULT_NOTIFICATION_SOUND_PREFS.perCategory</c> defaults,
/// the per-channel i18n keys (<c>notificationSounds.category.{wire}</c>) and the web <c>categoryFallback</c>
/// English strings. Pure data so the channel order, wire keys and defaults are unit-tested without a UI host.
/// </summary>
public static class NotificationSoundCatalog
{
    private static readonly NotificationSoundCategory[] OrderedCategories =
    {
        NotificationSoundCategory.CriticalAlert,
        NotificationSoundCategory.WarningAlert,
        NotificationSoundCategory.InfoAlert,
        NotificationSoundCategory.ChargeComplete,
        NotificationSoundCategory.DriveComplete,
        NotificationSoundCategory.AutomationRun,
        NotificationSoundCategory.Achievement,
    };

    /// <summary>The channels in web declaration order (web <c>NOTIFICATION_SOUND_CATEGORIES</c>).</summary>
    public static IReadOnlyList<NotificationSoundCategory> Ordered => OrderedCategories;

    /// <summary>The stable snake_case wire key for a channel (web union member, e.g. <c>critical_alert</c>).</summary>
    public static string WireKey(NotificationSoundCategory category) => category switch
    {
        NotificationSoundCategory.CriticalAlert => "critical_alert",
        NotificationSoundCategory.WarningAlert => "warning_alert",
        NotificationSoundCategory.InfoAlert => "info_alert",
        NotificationSoundCategory.ChargeComplete => "charge_complete",
        NotificationSoundCategory.DriveComplete => "drive_complete",
        NotificationSoundCategory.AutomationRun => "automation_run",
        _ => "achievement",
    };

    /// <summary>The i18n key for a channel's label (web <c>notificationSounds.category.{wire}</c>).</summary>
    public static string I18nKey(NotificationSoundCategory category) =>
        "notificationSounds.category." + WireKey(category);

    /// <summary>The English fallback for a channel label (web <c>categoryFallback</c>).</summary>
    public static string Fallback(NotificationSoundCategory category) => category switch
    {
        NotificationSoundCategory.CriticalAlert => "Critical alerts",
        NotificationSoundCategory.WarningAlert => "Warning alerts",
        NotificationSoundCategory.InfoAlert => "Informational alerts",
        NotificationSoundCategory.ChargeComplete => "Charge complete",
        NotificationSoundCategory.DriveComplete => "Drive complete",
        NotificationSoundCategory.AutomationRun => "Automation runs",
        _ => "Achievements",
    };

    /// <summary>The default per-channel gate (web <c>DEFAULT_NOTIFICATION_SOUND_PREFS.perCategory</c>).</summary>
    public static bool DefaultEnabled(NotificationSoundCategory category) => category switch
    {
        NotificationSoundCategory.CriticalAlert => true,
        NotificationSoundCategory.WarningAlert => true,
        NotificationSoundCategory.ChargeComplete => true,
        _ => false,
    };
}

/// <summary>
/// The out-of-tab notification preferences — the native mirror of the web <c>WebPushPreferences</c>
/// (web/src/hooks/useNotificationListener.ts: <c>{ alerts, exportStatus }</c>, both defaulting on). Drives the
/// two per-event toggles shown once OS notifications are granted.
/// </summary>
/// <param name="Alerts">Whether alert notifications fire while backgrounded (web <c>alerts</c>).</param>
/// <param name="ExportStatus">Whether export-completion notifications fire (web <c>exportStatus</c>).</param>
public sealed record WebPushPreferences(bool Alerts, bool ExportStatus)
{
    /// <summary>The web default — both events on (<c>DEFAULT_PREFS</c>).</summary>
    public static WebPushPreferences Default { get; } = new(true, true);
}

/// <summary>
/// The browser-tab signal preferences read from <c>GET /settings</c> — the native slice of the server
/// settings the web component toggles (<c>tab_badge_enabled</c> / <c>critical_flash_enabled</c>). Both default
/// on when the field is absent, mirroring the web's <c>settings?.tab_badge_enabled !== false</c> guard (and the
/// backend <c>settingsDefaults()</c>).
/// </summary>
/// <param name="TabBadgeEnabled">Whether the unread count shows in the tab/taskbar (web <c>tab_badge_enabled</c>).</param>
/// <param name="CriticalFlashEnabled">Whether critical alerts flash the tab/taskbar (web <c>critical_flash_enabled</c>).</param>
public sealed record NotificationTabSignals(bool TabBadgeEnabled, bool CriticalFlashEnabled)
{
    /// <summary>The default — both signals on (web missing-field default).</summary>
    public static NotificationTabSignals Default { get; } = new(true, true);

    /// <summary>
    /// Parse the two tab-signal flags from a <c>GET /settings</c> JSON object, defaulting each to on unless the
    /// field is explicitly <c>false</c> (web <c>!== false</c> parity). A non-object body yields the defaults.
    /// </summary>
    /// <param name="settings">The raw settings object from the API.</param>
    public static NotificationTabSignals FromSettings(JsonElement settings) => new(
        ReadFlagDefaultTrue(settings, "tab_badge_enabled"),
        ReadFlagDefaultTrue(settings, "critical_flash_enabled"));

    // web: `settings?.field !== false` — only an explicit boolean false turns the toggle off; a missing field,
    // null, or non-boolean value leaves it on (the seeded backend default).
    private static bool ReadFlagDefaultTrue(JsonElement settings, string field)
    {
        if (settings.ValueKind == JsonValueKind.Object
            && settings.TryGetProperty(field, out var value)
            && value.ValueKind == JsonValueKind.False)
        {
            return false;
        }

        return true;
    }
}

/// <summary>
/// The per-channel notification-sound preferences — the native mirror of the web <c>NotificationSoundPrefs</c>
/// (web/src/lib/notificationSound.ts: <c>{ master, perCategory, volume }</c>). Stored locally on the device
/// (the web stores them in <c>localStorage</c>); <see cref="Volume"/> is clamped to <c>[0, 1]</c>.
/// </summary>
public sealed record NotificationSoundPreferences
{
    /// <summary>The overall sound gate — when off, every channel is muted (web <c>master</c>).</summary>
    public bool Master { get; init; }

    /// <summary>The per-channel gate (web <c>perCategory</c>).</summary>
    public IReadOnlyDictionary<NotificationSoundCategory, bool> PerCategory { get; init; } =
        BuildDefaultPerCategory();

    /// <summary>The output volume in <c>[0, 1]</c> (web <c>volume</c>).</summary>
    public double Volume { get; init; } = DefaultVolume;

    /// <summary>The web default volume (<c>0.6</c>).</summary>
    public const double DefaultVolume = 0.6;

    /// <summary>The web default preferences — master off, web per-channel defaults, volume 0.6.</summary>
    public static NotificationSoundPreferences Default { get; } = new();

    /// <summary>True when <paramref name="category"/> is gated on (absent channels read as their default).</summary>
    public bool IsCategoryEnabled(NotificationSoundCategory category) =>
        PerCategory.TryGetValue(category, out var on) ? on : NotificationSoundCatalog.DefaultEnabled(category);

    /// <summary>Returns a copy with the master gate set to <paramref name="master"/>.</summary>
    public NotificationSoundPreferences WithMaster(bool master) => this with { Master = master };

    /// <summary>Returns a copy with <paramref name="category"/> gated to <paramref name="enabled"/>.</summary>
    public NotificationSoundPreferences WithCategory(NotificationSoundCategory category, bool enabled)
    {
        var next = new Dictionary<NotificationSoundCategory, bool>();
        foreach (var item in NotificationSoundCatalog.Ordered)
        {
            next[item] = item == category ? enabled : IsCategoryEnabled(item);
        }

        return this with { PerCategory = next };
    }

    /// <summary>Returns a copy with the volume set to <paramref name="volume"/> (clamped to <c>[0, 1]</c>).</summary>
    public NotificationSoundPreferences WithVolume(double volume) => this with { Volume = Clamp(volume) };

    /// <summary>Returns a fully-populated, volume-clamped copy (fills any missing channel with its default).</summary>
    public NotificationSoundPreferences Normalized()
    {
        var next = new Dictionary<NotificationSoundCategory, bool>();
        foreach (var item in NotificationSoundCatalog.Ordered)
        {
            next[item] = IsCategoryEnabled(item);
        }

        return new NotificationSoundPreferences { Master = Master, PerCategory = next, Volume = Clamp(Volume) };
    }

    /// <summary>Clamp a volume to the valid <c>[0, 1]</c> range (NaN folds to 0), matching the web <c>clamp</c>.</summary>
    public static double Clamp(double volume)
    {
        if (double.IsNaN(volume))
        {
            return 0;
        }

        return Math.Clamp(volume, 0, 1);
    }

    private static Dictionary<NotificationSoundCategory, bool> BuildDefaultPerCategory()
    {
        var defaults = new Dictionary<NotificationSoundCategory, bool>();
        foreach (var category in NotificationSoundCatalog.Ordered)
        {
            defaults[category] = NotificationSoundCatalog.DefaultEnabled(category);
        }

        return defaults;
    }
}

/// <summary>Why a notification-sound cue did or did not play — the native mirror of the web <c>PlayResult.reason</c>.</summary>
public enum NotificationSoundPlayReason
{
    /// <summary>The cue played (web <c>{ played: true }</c>).</summary>
    Played,

    /// <summary>The master gate is off (web <c>'master_off'</c>).</summary>
    MasterOff,

    /// <summary>The channel gate is off (web <c>'category_off'</c>).</summary>
    CategoryOff,

    /// <summary>The volume is zero (web <c>'volume_zero'</c>).</summary>
    VolumeZero,

    /// <summary>No audio device is available (web <c>'no_audio_context'</c>).</summary>
    Unavailable,
}

/// <summary>The settled outcome of evaluating a notification-sound cue — the native mirror of the web <c>PlayResult</c>.</summary>
/// <param name="Played">True when the cue would play.</param>
/// <param name="Reason">The structured reason it did or did not play.</param>
public sealed record NotificationSoundPlayResult(bool Played, NotificationSoundPlayReason Reason);

/// <summary>
/// The pure cue-gating logic shared by the channel "Test" affordance and live notification playback — the
/// native port of the web <c>playNotificationSound</c> gate and <c>handleTestSound</c> override
/// (web/src/lib/notificationSound.ts and the web component). The actual tone synthesis is a device concern the
/// WinUI view owns; this evaluates only whether a cue is allowed, so the gate is unit-tested without audio.
/// </summary>
public static class NotificationSoundPlayback
{
    /// <summary>
    /// Evaluate whether <paramref name="category"/> would play under <paramref name="prefs"/> — master, channel
    /// and volume gates in the web order (master off → category off → volume zero → unavailable → played).
    /// </summary>
    /// <param name="prefs">The current sound preferences.</param>
    /// <param name="category">The channel to evaluate.</param>
    /// <param name="audioAvailable">Whether an audio device is available (false mirrors the web no-context branch).</param>
    public static NotificationSoundPlayResult Evaluate(
        NotificationSoundPreferences prefs,
        NotificationSoundCategory category,
        bool audioAvailable = true)
    {
        ArgumentNullException.ThrowIfNull(prefs);

        if (!prefs.Master)
        {
            return new NotificationSoundPlayResult(false, NotificationSoundPlayReason.MasterOff);
        }

        if (!prefs.IsCategoryEnabled(category))
        {
            return new NotificationSoundPlayResult(false, NotificationSoundPlayReason.CategoryOff);
        }

        if (NotificationSoundPreferences.Clamp(prefs.Volume) <= 0)
        {
            return new NotificationSoundPlayResult(false, NotificationSoundPlayReason.VolumeZero);
        }

        if (!audioAvailable)
        {
            return new NotificationSoundPlayResult(false, NotificationSoundPlayReason.Unavailable);
        }

        return new NotificationSoundPlayResult(true, NotificationSoundPlayReason.Played);
    }

    /// <summary>
    /// Build the forced preferences the channel "Test" button plays under — the native port of the web
    /// <c>handleTestSound</c>: master on, this channel on, and the volume floored to <c>0.5</c> when it is zero,
    /// so the cue is always audible on demand regardless of the saved gates.
    /// </summary>
    /// <param name="prefs">The current sound preferences.</param>
    /// <param name="category">The channel being tested.</param>
    public static NotificationSoundPreferences TestOverride(
        NotificationSoundPreferences prefs,
        NotificationSoundCategory category)
    {
        ArgumentNullException.ThrowIfNull(prefs);

        double volume = prefs.Volume <= 0 ? 0.5 : prefs.Volume;
        return prefs.WithMaster(true).WithCategory(category, true).WithVolume(volume);
    }
}

/// <summary>
/// One render-ready toggle row — a localized label, its on/off value and a Narrator name. Pure data so the
/// projection is unit-tested without a UI host.
/// </summary>
/// <param name="Label">The localized toggle label.</param>
/// <param name="IsOn">The toggle's current value.</param>
/// <param name="AutomationName">The Narrator name for the toggle.</param>
public sealed record NotificationToggleRow(string Label, bool IsOn, string AutomationName);

/// <summary>
/// One render-ready notification-sound channel row — the toggle plus the per-row "Test" affordance and the
/// dim flag the web applies while the master gate is off.
/// </summary>
/// <param name="Category">The channel this row controls.</param>
/// <param name="Label">The localized channel label.</param>
/// <param name="IsOn">The channel's current gate.</param>
/// <param name="Dimmed">True when the row is dimmed (web <c>!master</c> opacity).</param>
/// <param name="ToggleAutomationName">The Narrator name for the channel toggle.</param>
/// <param name="TestLabel">The localized "Test" button label.</param>
/// <param name="TestAutomationName">The Narrator name for the "Test" button (web <c>testAria</c>).</param>
public sealed record NotificationSoundRow(
    NotificationSoundCategory Category,
    string Label,
    bool IsOn,
    bool Dimmed,
    string ToggleAutomationName,
    string TestLabel,
    string TestAutomationName);

/// <summary>
/// The render-ready OS/browser-notification section — the native projection of the web component's first
/// <c>GlassPanel</c>. Carries the localized chrome plus the per-status affordances (unsupported message, enable
/// button, enabled badge, blocked hint) and the per-event toggles shown once permission is granted.
/// </summary>
/// <param name="Title">The section title (web <c>browserNotifications.title</c>).</param>
/// <param name="Subtitle">The section subtitle (web <c>browserNotifications.subtitle</c>).</param>
/// <param name="IconGlyph">The Segoe Fluent bell glyph (web Lucide <c>Bell</c>).</param>
/// <param name="Status">The OS permission status driving the branch.</param>
/// <param name="UnsupportedMessage">The "not supported" message (web <c>browserNotifications.unsupported</c>).</param>
/// <param name="EnableButtonText">The enable-button label (web <c>browserNotifications.enable</c>).</param>
/// <param name="EnableButtonGlyph">The enable-button bell glyph.</param>
/// <param name="EnabledBadgeText">The granted badge text (web <c>browserNotifications.enabled</c>).</param>
/// <param name="BlockedMessage">The denied hint (web <c>browserNotifications.blocked</c>).</param>
/// <param name="EventsHeading">The per-event heading (web <c>browserNotifications.events</c>).</param>
/// <param name="Alerts">The "Alerts" toggle row (web <c>browserNotifications.alerts</c>).</param>
/// <param name="ExportStatus">The "Export completions" toggle row (web <c>browserNotifications.exportStatus</c>).</param>
/// <param name="EventsHint">The per-event hint (web <c>browserNotifications.hint</c>).</param>
public sealed record NotificationPermissionDisplay(
    string Title,
    string Subtitle,
    string IconGlyph,
    NotificationPermissionStatus Status,
    string UnsupportedMessage,
    string EnableButtonText,
    string EnableButtonGlyph,
    string EnabledBadgeText,
    string BlockedMessage,
    string EventsHeading,
    NotificationToggleRow Alerts,
    NotificationToggleRow ExportStatus,
    string EventsHint)
{
    /// <summary>True when the client supports notifications (web <c>isSupported</c>).</summary>
    public bool IsSupported => Status != NotificationPermissionStatus.Unsupported;

    /// <summary>True when the enable affordance should show (web <c>permission === 'default'</c>).</summary>
    public bool ShowEnableButton => Status == NotificationPermissionStatus.Default;

    /// <summary>True when the enabled badge should show (web <c>permission === 'granted'</c>).</summary>
    public bool ShowEnabledBadge => Status == NotificationPermissionStatus.Granted;

    /// <summary>True when the blocked hint should show (web <c>permission === 'denied'</c>).</summary>
    public bool ShowBlocked => Status == NotificationPermissionStatus.Denied;

    /// <summary>True when the per-event toggles should show (web <c>permission === 'granted'</c>).</summary>
    public bool ShowEvents => Status == NotificationPermissionStatus.Granted;
}

/// <summary>
/// The render-ready browser-tab-signals section — the native projection of the web component's second panel
/// (the <c>settings.tab.*</c> toggles).
/// </summary>
/// <param name="Heading">The section heading (web <c>settings.tab.heading</c>).</param>
/// <param name="Badge">The unread-count toggle row (web <c>settings.tab.badge</c>).</param>
/// <param name="Flash">The critical-flash toggle row (web <c>settings.tab.flash</c>).</param>
/// <param name="Hint">The section hint (web <c>settings.tab.hint</c>).</param>
public sealed record NotificationTabSignalsDisplay(
    string Heading,
    NotificationToggleRow Badge,
    NotificationToggleRow Flash,
    string Hint);

/// <summary>
/// The render-ready notification-sounds section — the native projection of the web component's third panel
/// (master toggle, autoplay hint, per-channel rows and the volume slider).
/// </summary>
/// <param name="IconGlyph">The Segoe Fluent volume glyph (web Lucide <c>Volume2</c>).</param>
/// <param name="Title">The section title (web <c>notificationSounds.title</c>).</param>
/// <param name="Subtitle">The section subtitle (web <c>notificationSounds.subtitle</c>).</param>
/// <param name="Master">The master toggle row (web <c>notificationSounds.master</c>).</param>
/// <param name="ShowAutoplayHint">True when the autoplay hint shows (web <c>master &amp;&amp; !dismissed</c>).</param>
/// <param name="AutoplayHint">The autoplay hint (web <c>notificationSounds.autoplayHint</c>).</param>
/// <param name="CategoriesHeading">The channels heading (web <c>notificationSounds.categoriesHeading</c>).</param>
/// <param name="Categories">The per-channel rows in web order.</param>
/// <param name="VolumeLabel">The volume slider label (web <c>notificationSounds.volume</c>).</param>
/// <param name="VolumePercent">The volume as a whole percentage (web <c>Math.round(volume * 100)</c>).</param>
/// <param name="VolumeValueText">The formatted volume value (web <c>`${n}%`</c>).</param>
/// <param name="VolumeAutomationName">The Narrator name for the volume slider.</param>
/// <param name="VolumeEnabled">True when the slider is interactive (web <c>!disabled</c> — master on).</param>
public sealed record NotificationSoundsDisplay(
    string IconGlyph,
    string Title,
    string Subtitle,
    NotificationToggleRow Master,
    bool ShowAutoplayHint,
    string AutoplayHint,
    string CategoriesHeading,
    IReadOnlyList<NotificationSoundRow> Categories,
    string VolumeLabel,
    int VolumePercent,
    string VolumeValueText,
    string VolumeAutomationName,
    bool VolumeEnabled);

/// <summary>
/// The fully projected, render-ready view of the whole NotificationSettings surface — the three sections plus
/// the surface Narrator name. Pure data (no WinUI types) so the projection is unit-tested without a XAML host.
/// </summary>
/// <param name="AutomationName">The surface Narrator name (the localized notifications title).</param>
/// <param name="Permission">The OS/browser-notification section.</param>
/// <param name="TabSignals">The browser-tab-signals section.</param>
/// <param name="Sounds">The notification-sounds section.</param>
public sealed record NotificationSettingsDisplay(
    string AutomationName,
    NotificationPermissionDisplay Permission,
    NotificationTabSignalsDisplay TabSignals,
    NotificationSoundsDisplay Sounds);

/// <summary>
/// Pure projection from the four preference sources to the render-ready <see cref="NotificationSettingsDisplay"/>
/// — the native port of the web NotificationSettings render
/// (web/src/features/settings/components/NotificationSettings.tsx). Every owned string resolves through the
/// i18n facade using the web's keys with the web English fallback, the per-channel rows are built in web order,
/// and the volume is projected as a whole percentage exactly as the web slider formats it. No SI conversion
/// applies — the surface carries no measurements.
/// </summary>
public static class NotificationSettingsProjection
{
    /// <summary>Segoe Fluent "Ringer" bell glyph standing in for the web Lucide <c>Bell</c> icon.</summary>
    public const string BellGlyph = "\uEA8F";

    /// <summary>Segoe Fluent "Volume" glyph standing in for the web Lucide <c>Volume2</c> icon.</summary>
    public const string VolumeGlyph = "\uE767";

    /// <summary>
    /// Project the four preference sources into the render-ready display, resolving every string through
    /// <paramref name="localizer"/>.
    /// </summary>
    /// <param name="permission">The OS notification-permission status.</param>
    /// <param name="pushPrefs">The out-of-tab event preferences.</param>
    /// <param name="tabSignals">The browser-tab signal preferences.</param>
    /// <param name="soundPrefs">The per-channel sound preferences.</param>
    /// <param name="autoplayHintDismissed">Whether the autoplay hint has been dismissed (web local state).</param>
    /// <param name="localizer">The i18n facade resolving every owned string.</param>
    public static NotificationSettingsDisplay Project(
        NotificationPermissionStatus permission,
        WebPushPreferences pushPrefs,
        NotificationTabSignals tabSignals,
        NotificationSoundPreferences soundPrefs,
        bool autoplayHintDismissed,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(pushPrefs);
        ArgumentNullException.ThrowIfNull(tabSignals);
        ArgumentNullException.ThrowIfNull(soundPrefs);
        ArgumentNullException.ThrowIfNull(localizer);

        var permissionDisplay = ProjectPermission(permission, pushPrefs, localizer);
        var tabDisplay = ProjectTabSignals(tabSignals, localizer);
        var soundsDisplay = ProjectSounds(soundPrefs, autoplayHintDismissed, localizer);

        return new NotificationSettingsDisplay(permissionDisplay.Title, permissionDisplay, tabDisplay, soundsDisplay);
    }

    private static NotificationPermissionDisplay ProjectPermission(
        NotificationPermissionStatus permission,
        WebPushPreferences pushPrefs,
        ILocalizer localizer)
    {
        string alertsLabel = localizer.GetString("browserNotifications.alerts", "Alerts");
        string exportLabel = localizer.GetString("browserNotifications.exportStatus", "Export completions");

        return new NotificationPermissionDisplay(
            Title: localizer.GetString("browserNotifications.title", "Browser Notifications"),
            Subtitle: localizer.GetString(
                "browserNotifications.subtitle",
                "Get notified when the app tab is in the background"),
            IconGlyph: BellGlyph,
            Status: permission,
            UnsupportedMessage: localizer.GetString(
                "browserNotifications.unsupported",
                "Browser notifications are not supported in this browser."),
            EnableButtonText: localizer.GetString("browserNotifications.enable", "Enable Browser Notifications"),
            EnableButtonGlyph: BellGlyph,
            EnabledBadgeText: localizer.GetString("browserNotifications.enabled", "Enabled"),
            BlockedMessage: localizer.GetString(
                "browserNotifications.blocked",
                "Notifications are blocked. Enable in your browser settings."),
            EventsHeading: localizer.GetString("browserNotifications.events", "Notify me about"),
            Alerts: new NotificationToggleRow(alertsLabel, pushPrefs.Alerts, alertsLabel),
            ExportStatus: new NotificationToggleRow(exportLabel, pushPrefs.ExportStatus, exportLabel),
            EventsHint: localizer.GetString(
                "browserNotifications.hint",
                "Notifications only fire when the app tab is in the background."));
    }

    private static NotificationTabSignalsDisplay ProjectTabSignals(
        NotificationTabSignals tabSignals,
        ILocalizer localizer)
    {
        string badgeLabel = localizer.GetString("settings.tab.badge", "Show unread count in browser tab");
        string flashLabel = localizer.GetString("settings.tab.flash", "Flash tab title on critical alerts");

        return new NotificationTabSignalsDisplay(
            Heading: localizer.GetString("settings.tab.heading", "Browser tab signals"),
            Badge: new NotificationToggleRow(badgeLabel, tabSignals.TabBadgeEnabled, badgeLabel),
            Flash: new NotificationToggleRow(flashLabel, tabSignals.CriticalFlashEnabled, flashLabel),
            Hint: localizer.GetString(
                "settings.tab.hint",
                "Adds a \"(N)\" prefix and favicon dot when there are unread notifications. Critical alerts " +
                "briefly flash \"(!) ALERT\" when the tab is in the background."));
    }

    private static NotificationSoundsDisplay ProjectSounds(
        NotificationSoundPreferences soundPrefs,
        bool autoplayHintDismissed,
        ILocalizer localizer)
    {
        string masterLabel = localizer.GetString("notificationSounds.master", "Enable notification sounds");
        string testLabel = localizer.GetString("notificationSounds.test", "Test");
        string testTemplate = localizer.GetString("notificationSounds.testAria", "Test {{name}} sound");

        var rows = new List<NotificationSoundRow>(NotificationSoundCatalog.Ordered.Count);
        foreach (var category in NotificationSoundCatalog.Ordered)
        {
            string label = localizer.GetString(
                NotificationSoundCatalog.I18nKey(category),
                NotificationSoundCatalog.Fallback(category));
            string testAria = testTemplate.Replace("{{name}}", label, StringComparison.Ordinal);
            rows.Add(new NotificationSoundRow(
                Category: category,
                Label: label,
                IsOn: soundPrefs.IsCategoryEnabled(category),
                Dimmed: !soundPrefs.Master,
                ToggleAutomationName: label,
                TestLabel: testLabel,
                TestAutomationName: testAria));
        }

        int percent = (int)Math.Round(NotificationSoundPreferences.Clamp(soundPrefs.Volume) * 100);
        string volumeLabel = localizer.GetString("notificationSounds.volume", "Volume");

        return new NotificationSoundsDisplay(
            IconGlyph: VolumeGlyph,
            Title: localizer.GetString("notificationSounds.title", "Notification sounds"),
            Subtitle: localizer.GetString(
                "notificationSounds.subtitle",
                "Play a short cue when an alert or completion event arrives. Plays even while the tab is visible."),
            Master: new NotificationToggleRow(masterLabel, soundPrefs.Master, masterLabel),
            ShowAutoplayHint: soundPrefs.Master && !autoplayHintDismissed,
            AutoplayHint: localizer.GetString(
                "notificationSounds.autoplayHint",
                "Some browsers require a click before audio is allowed. Use the Test buttons below once to " +
                "authorise playback."),
            CategoriesHeading: localizer.GetString("notificationSounds.categoriesHeading", "Channels"),
            Categories: rows,
            VolumeLabel: volumeLabel,
            VolumePercent: percent,
            VolumeValueText: string.Format(CultureInfo.InvariantCulture, "{0}%", percent),
            VolumeAutomationName: volumeLabel,
            VolumeEnabled: soundPrefs.Master);
    }
}

/// <summary>
/// Canonical metadata for the NotificationSettings surface — the native anchor for the web component at
/// web/src/features/settings/components/NotificationSettings.tsx. Centralises the diagnostics <see cref="Slug"/>
/// emitted with the <c>view.opened</c> event (P1/S11) and the generated <c>GET/PUT /settings</c> operation ids
/// the browser-tab-signals source reads and writes.
/// </summary>
public static class NotificationSettingsRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "NotificationSettings";

    /// <summary>The web component this surface mirrors.</summary>
    public const string WebSource = "features/settings/components/NotificationSettings.tsx";

    /// <summary>The generated OpenAPI operation id for <c>GET /settings</c> (web <c>useSettings</c>).</summary>
    public const string SettingsGetOperation = "get_api_v1_settings";

    /// <summary>The generated OpenAPI operation id for <c>PUT /settings</c> (web <c>useSaveSettings</c>).</summary>
    public const string SettingsPutOperation = "put_api_v1_settings";

    /// <summary>The notification-sound channels in web order.</summary>
    public static IReadOnlyList<NotificationSoundCategory> SoundCategories => NotificationSoundCatalog.Ordered;
}

/// <summary>
/// PII-safe diagnostics for the NotificationSettings surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a preference value — so a diagnostics line
/// can never leak user configuration. Thread-safe.
/// </summary>
public sealed class NotificationSettingsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional operational-only line sink (no user data is ever passed).</param>
    public NotificationSettingsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=NotificationSettings</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={NotificationSettingsRegistration.Slug}");
    }
}
