using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive lifecycle state the <see cref="SecurityStatusCardsViewModel"/> can be in — the
/// native superset of the branches the web Security-status cards render
/// (web/src/features/admin/components/security-access/SecurityStatusCards.tsx). The web component is a pure
/// child of the Security &amp; Access page (it takes the latest <c>SecurityEvent</c> + an <c>isLoading</c>
/// flag as props); the native surface binds its own cache-then-network read of <c>/security/latest</c>, so it
/// owns the full loading / loaded / empty / error / stale / offline matrix the P2 state contract requires.
/// Every value maps onto a visible surface (never a blank panel): <see cref="Loaded"/>, <see cref="Empty"/>,
/// <see cref="Stale"/> and <see cref="Offline"/> all render the six status cards (the web grid is always
/// visible, the cards falling back to their safe defaults exactly as the web reads <c>latest?.locked</c> etc.
/// from an absent event), while <see cref="Loading"/> shows the six-card skeleton chrome and
/// <see cref="Error"/> the retry affordance.
/// </summary>
public enum SecurityStatusCardsState
{
    /// <summary>Initial fetch with no cached snapshot — render the six-card skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh snapshot carrying at least one live security signal.</summary>
    Loaded,

    /// <summary>The snapshot resolved but carries no security signals — the cards render their safe defaults.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render the cards plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render the cards plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The semantic accent a status card carries — the native, theme-token analogue of the web's per-card Tailwind
/// colour (green / red / amber / blue / purple / muted). Kept as a value (not a brush) so the projection is
/// unit-tested without a XAML runtime; <see cref="SecurityToneResources"/> maps each tone to a design-token
/// brush key the WinUI view resolves.
/// </summary>
public enum SecurityTone
{
    /// <summary>A reassuring "secured" state (web <c>text-green-400</c>): locked, closed, all windows closed.</summary>
    Positive,

    /// <summary>An at-risk state (web <c>text-red-400</c>): unlocked.</summary>
    Negative,

    /// <summary>An attention state (web <c>text-amber-400</c>): a door / window open, guest mode enabled.</summary>
    Caution,

    /// <summary>An armed-surveillance state (web <c>text-blue-400</c>): sentry mode active.</summary>
    Watch,

    /// <summary>A paired-device state (web <c>text-purple-400</c>): HomeLink nearby.</summary>
    Linked,

    /// <summary>A dormant / off state (web <c>text-[var(--text-muted)]</c>): inactive, away, disabled.</summary>
    Idle,
}

/// <summary>Maps a <see cref="SecurityTone"/> to its design-token brush resource key
/// (<c>apps/design/generated/windows/Tokens.xaml</c>). UI-free so the mapping is asserted without a XAML host.</summary>
public static class SecurityToneResources
{
    /// <summary>The theme-aware foreground/accent brush key for a tone.</summary>
    public static string BrushKey(SecurityTone tone) => tone switch
    {
        SecurityTone.Positive => "TsColorSuccessBrush",
        SecurityTone.Negative => "TsColorDangerBrush",
        SecurityTone.Caution => "TsColorWarningBrush",
        SecurityTone.Watch => "TsColorInfoBrush",
        SecurityTone.Linked => "TsColorAccentBrush",
        _ => "TsColorTextMutedBrush",
    };
}

/// <summary>The parsed window position the security feed reports (web <c>parseWindowState</c>).</summary>
public enum SecurityWindowState
{
    Closed,
    Venting,
    Open,
    Unknown,
}

/// <summary>
/// The latest security / access signals the web cards read — the native mirror of the
/// <c>SecurityEvent</c> fields <c>&lt;SecurityStatusCards latest=… /&gt;</c> consumes
/// (web/src/types/admin.ts). The <c>/security/latest</c> endpoint returns a snake_case object containing only
/// the signals currently present in live state, so every field is parsed null-tolerantly and falls back to the
/// same safe default the web derives from an absent <c>latest</c> (the optional-chaining <c>latest?.x</c>):
/// <list type="bullet">
/// <item><see cref="Locked"/> — <c>locked</c>, default <c>false</c> (web shows "Unlocked").</item>
/// <item><see cref="SentryActive"/> — <c>sentry_mode</c> via <see cref="IsSentryActive"/>, default <c>false</c>.</item>
/// <item><see cref="DoorsClosed"/> — <c>door_state</c> via <see cref="DoorClosed"/>, default <c>true</c>
/// (web <c>doorClosed(undefined) === true</c>).</item>
/// <item><see cref="DoorOpenLabel"/> — the raw <c>door_state</c> string shown when a door is open (web
/// <c>asNonEmptyString(latest?.doorState)</c>).</item>
/// <item><see cref="WindowsAllClosed"/> — every <c>fd/fp/rd/rp_window</c> Closed (web <c>allWindowsClosed</c>).</item>
/// <item><see cref="HomelinkNearby"/> / <see cref="GuestMode"/> — <c>homelink_nearby</c> / <c>guest_mode</c>.</item>
/// </list>
/// WinUI-free so the parse is unit-tested without a UI host. Both the API's snake_case keys and the
/// frontend-style camelCase aliases are accepted so a body from either shape binds.
/// </summary>
public sealed record SecurityStatusCardsData(
    bool Locked,
    bool SentryActive,
    bool DoorsClosed,
    string? DoorOpenLabel,
    bool WindowsAllClosed,
    bool HomelinkNearby,
    bool GuestMode,
    bool HasData)
{
    private static readonly string[] ClosedDoorTokens = { string.Empty, "closed", "closedall", "0", "false" };

    /// <summary>The no-signal snapshot — the parse fallback for an absent body and the loading fallback. Mirrors
    /// the web rendering of an <c>undefined</c> latest event: unlocked, inactive, closed, all windows closed,
    /// away, guest mode off.</summary>
    public static SecurityStatusCardsData Empty { get; } = new(
        Locked: false,
        SentryActive: false,
        DoorsClosed: true,
        DoorOpenLabel: null,
        WindowsAllClosed: true,
        HomelinkNearby: false,
        GuestMode: false,
        HasData: false);

    /// <summary>
    /// Parse a <c>/security/latest</c> object into the signals the six cards read. Absent fields fall back to
    /// the same safe defaults the web derives from an absent latest event; an object carrying none of the
    /// card's signals yields <see cref="Empty"/> (the no-data snapshot the cards render as defaults).
    /// </summary>
    public static SecurityStatusCardsData FromJson(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        bool any = false;

        bool locked = false;
        if (TryField(root, "locked", "locked", out var lockedEl))
        {
            any = true;
            locked = ReadBool(lockedEl) ?? false;
        }

        bool sentryActive = false;
        if (TryField(root, "sentry_mode", "sentryMode", out var sentryEl))
        {
            any = true;
            sentryActive = IsSentryActive(sentryEl);
        }

        bool doorsClosed = true;
        string? doorLabel = null;
        if (TryField(root, "door_state", "doorState", out var doorEl))
        {
            any = true;
            doorsClosed = DoorClosed(doorEl);
            doorLabel = AsNonEmptyString(doorEl);
        }

        var windows = new[]
        {
            ReadWindow(root, "fd_window", "fdWindow", ref any),
            ReadWindow(root, "fp_window", "fpWindow", ref any),
            ReadWindow(root, "rd_window", "rdWindow", ref any),
            ReadWindow(root, "rp_window", "rpWindow", ref any),
        };

        bool homelinkNearby = false;
        if (TryField(root, "homelink_nearby", "homelinkNearby", out var homeEl))
        {
            any = true;
            homelinkNearby = ReadBool(homeEl) ?? false;
        }

        bool guestMode = false;
        if (TryField(root, "guest_mode", "guestMode", out var guestEl))
        {
            any = true;
            guestMode = ReadBool(guestEl) ?? false;
        }

        if (!any)
        {
            return Empty;
        }

        bool windowsAllClosed = Array.TrueForAll(windows, static s => s == SecurityWindowState.Closed);

        return new SecurityStatusCardsData(
            Locked: locked,
            SentryActive: sentryActive,
            DoorsClosed: doorsClosed,
            DoorOpenLabel: doorsClosed ? null : doorLabel,
            WindowsAllClosed: windowsAllClosed,
            HomelinkNearby: homelinkNearby,
            GuestMode: guestMode,
            HasData: true);
    }

    // web isSentryActive: native bool -> itself; string -> armed unless it contains "off"; anything else -> false.
    internal static bool IsSentryActive(JsonElement value)
    {
        if (value.ValueKind is JsonValueKind.True or JsonValueKind.False)
        {
            return value.GetBoolean();
        }

        string? raw = AsNonEmptyString(value);
        return raw is not null && !raw.ToLowerInvariant().Contains("off", StringComparison.Ordinal);
    }

    // web doorClosed: tolerant of bool / number / object / string encodings; absent or "closed"-like -> closed.
    internal static bool DoorClosed(JsonElement value)
    {
        switch (value.ValueKind)
        {
            case JsonValueKind.Null or JsonValueKind.Undefined:
                return true;
            case JsonValueKind.True:
                return false;
            case JsonValueKind.False:
                return true;
            case JsonValueKind.Number:
                return value.TryGetDouble(out var n) && n == 0;
            case JsonValueKind.Object:
                return AllPropertiesFalsy(value);
            case JsonValueKind.String:
                return DoorStringClosed(value.GetString());
            default:
                return true;
        }
    }

    private static bool DoorStringClosed(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return true;
        }

        string lower = raw.Trim().ToLowerInvariant();
        if (Array.IndexOf(ClosedDoorTokens, lower) >= 0)
        {
            return true;
        }

        if (lower.StartsWith('{'))
        {
            try
            {
                using var doc = JsonDocument.Parse(raw);
                return AllPropertiesFalsy(doc.RootElement);
            }
            catch (JsonException)
            {
                return false;
            }
        }

        return false;
    }

    private static bool AllPropertiesFalsy(JsonElement obj)
    {
        if (obj.ValueKind != JsonValueKind.Object)
        {
            return false;
        }

        foreach (var prop in obj.EnumerateObject())
        {
            if (prop.Value.ValueKind is not (JsonValueKind.False or JsonValueKind.Null))
            {
                return false;
            }
        }

        return true;
    }

    // web parseWindowState: string-only (asNonEmptyString); "closed"/"0" -> Closed, contains "vent" -> Venting,
    // any other non-empty value -> Open, otherwise Unknown.
    internal static SecurityWindowState ParseWindowState(JsonElement value)
    {
        string? raw = AsNonEmptyString(value);
        if (raw is null)
        {
            return SecurityWindowState.Unknown;
        }

        string lower = raw.Trim().ToLowerInvariant();
        if (lower is "closed" or "0")
        {
            return SecurityWindowState.Closed;
        }

        if (lower.Contains("vent", StringComparison.Ordinal))
        {
            return SecurityWindowState.Venting;
        }

        return lower.Length > 0 ? SecurityWindowState.Open : SecurityWindowState.Unknown;
    }

    private static SecurityWindowState ReadWindow(JsonElement root, string snake, string camel, ref bool any)
    {
        if (TryField(root, snake, camel, out var value))
        {
            any = true;
            return ParseWindowState(value);
        }

        return SecurityWindowState.Unknown;
    }

    // web asNonEmptyString: a trimmed-non-empty string, else null (non-strings are rejected).
    internal static string? AsNonEmptyString(JsonElement value)
    {
        if (value.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        string? raw = value.GetString();
        return string.IsNullOrWhiteSpace(raw) ? null : raw;
    }

    private static bool? ReadBool(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        JsonValueKind.Number => value.TryGetDouble(out var n) ? n != 0 : null,
        JsonValueKind.String => ParseBoolString(value.GetString()),
        _ => null,
    };

    private static bool? ParseBoolString(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        return raw.Trim().ToLowerInvariant() switch
        {
            "true" or "1" or "yes" or "on" => true,
            "false" or "0" or "no" or "off" => false,
            _ => null,
        };
    }

    private static bool TryField(JsonElement root, string snake, string camel, out JsonElement value)
    {
        if (root.TryGetProperty(snake, out value))
        {
            return true;
        }

        return !string.Equals(snake, camel, StringComparison.Ordinal) && root.TryGetProperty(camel, out value);
    }
}

/// <summary>
/// One projected, render-ready status card — the native analogue of one of the web Security-status grid's six
/// <see cref="TeslaSync.App.Components.UI.TsGlassPanel"/> cells (a status glyph, a title, a bold status value
/// and a small muted description). Pure data so every value is asserted headlessly.
/// </summary>
/// <param name="Key">Stable card id (e.g. <c>lock</c>) used by the view and tests.</param>
/// <param name="Glyph">The Segoe Fluent status glyph rendered in the card header.</param>
/// <param name="Title">The localized card title (web <c>h3</c>).</param>
/// <param name="Value">The localized bold status value (web <c>text-2xl</c>).</param>
/// <param name="Description">The localized muted description (web <c>text-xs</c>).</param>
/// <param name="Tone">The semantic accent tinting the glyph + value.</param>
/// <param name="AutomationName">The composed Narrator name for the whole card.</param>
public sealed record SecurityStatusCard(
    string Key,
    string Glyph,
    string Title,
    string Value,
    string Description,
    SecurityTone Tone,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the Security-status cards — the six cards the web component draws
/// plus the localized surface label. The grid is always populated (web parity: the cards render their safe
/// defaults when there is no event), so <see cref="Cards"/> always has six entries; <see cref="HasData"/> only
/// reflects whether a live security signal backed the values. Pure data.
/// </summary>
public sealed record SecurityStatusCardsDisplay(
    IReadOnlyList<SecurityStatusCard> Cards,
    bool HasData,
    string AutomationName)
{
    /// <summary>The all-default display (the six cards in their safe-default branch) for the loading / empty fallback.</summary>
    public static SecurityStatusCardsDisplay Empty(ILocalizer localizer) =>
        SecurityStatusCardsProjection.Project(SecurityStatusCardsData.Empty, localizer);
}

/// <summary>
/// Pure projection from a raw <see cref="SecurityStatusCardsData"/> to its
/// <see cref="SecurityStatusCardsDisplay"/> — the native port of the render logic in
/// web/src/features/admin/components/security-access/SecurityStatusCards.tsx. The six cards reproduce the web
/// call sites one-for-one: Lock Status, Sentry Mode, Doors, Windows, HomeLink and Guest Mode, each with the
/// same icon-colour semantics, the same status value, and the same description. Every translatable string
/// resolves through the i18n facade using the catalog keys the web source passes to <c>t()</c> (the
/// <c>translation.</c>-namespaced form stored in the shared catalog + the WinUI resw). WinUI-free — unit-tested
/// without a UI host.
/// </summary>
public static class SecurityStatusCardsProjection
{
    // i18n keys (resolve against the P1/S10 catalog; the fallbacks mirror the web English literals).
    private const string LockTitleKey = "translation.admin.security.card.lockStatus";
    private const string LockTitleFallback = "Lock Status";
    private const string LockDescKey = "translation.admin.security.card.lockDesc";
    private const string LockDescFallback = "Vehicle lock state";
    private const string LockedKey = "translation.admin.security.locked";
    private const string LockedFallback = "Locked";
    private const string UnlockedKey = "translation.admin.security.unlocked";
    private const string UnlockedFallback = "Unlocked";

    private const string SentryTitleKey = "translation.admin.security.card.sentryMode";
    private const string SentryTitleFallback = "Sentry Mode";
    private const string SentryDescKey = "translation.admin.security.card.sentryDesc";
    private const string SentryDescFallback = "Camera surveillance system";
    private const string ActiveKey = "translation.admin.security.active";
    private const string ActiveFallback = "Active";
    private const string InactiveKey = "translation.admin.security.inactive";
    private const string InactiveFallback = "Inactive";

    private const string DoorsTitleKey = "translation.admin.security.card.doors";
    private const string DoorsTitleFallback = "Doors";
    private const string DoorsDescKey = "translation.admin.security.card.doorsDesc";
    private const string DoorsDescFallback = "All vehicle doors";
    private const string ClosedKey = "translation.admin.security.closed";
    private const string ClosedFallback = "Closed";
    private const string OpenKey = "translation.admin.security.open";
    private const string OpenFallback = "Open";

    private const string WindowsTitleKey = "translation.admin.security.card.windows";
    private const string WindowsTitleFallback = "Windows";
    private const string WindowsDescKey = "translation.admin.security.card.windowsDesc";
    private const string WindowsDescFallback = "Window positions";

    private const string HomeLinkTitleKey = "translation.admin.security.card.homelink";
    private const string HomeLinkTitleFallback = "HomeLink";
    private const string HomeLinkDescKey = "translation.admin.security.card.homelinkDesc";
    private const string HomeLinkDescFallback = "Garage door opener";
    private const string NearbyKey = "translation.admin.security.nearby";
    private const string NearbyFallback = "Nearby";
    private const string AwayKey = "translation.admin.security.away";
    private const string AwayFallback = "Away";

    private const string GuestTitleKey = "translation.admin.security.card.guestMode";
    private const string GuestTitleFallback = "Guest Mode";
    private const string GuestDescKey = "translation.admin.security.card.guestDesc";
    private const string GuestDescFallback = "Temporary access mode";
    private const string EnabledKey = "translation.admin.security.enabled";
    private const string EnabledFallback = "Enabled";
    private const string DisabledKey = "translation.admin.security.disabled";
    private const string DisabledFallback = "Disabled";

    /// <summary>Project <paramref name="data"/> into its six localized status cards using the i18n facade.</summary>
    public static SecurityStatusCardsDisplay Project(SecurityStatusCardsData data, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(data);
        ArgumentNullException.ThrowIfNull(localizer);

        string openDoorValue = data.DoorOpenLabel ?? localizer.GetString(OpenKey, OpenFallback);

        var cards = new[]
        {
            BuildCard(
                "lock",
                data.Locked ? SecurityStatusCardsRegistration.LockGlyph : SecurityStatusCardsRegistration.UnlockGlyph,
                localizer.GetString(LockTitleKey, LockTitleFallback),
                data.Locked
                    ? localizer.GetString(LockedKey, LockedFallback)
                    : localizer.GetString(UnlockedKey, UnlockedFallback),
                localizer.GetString(LockDescKey, LockDescFallback),
                data.Locked ? SecurityTone.Positive : SecurityTone.Negative),

            BuildCard(
                "sentry",
                SecurityStatusCardsRegistration.SentryGlyph,
                localizer.GetString(SentryTitleKey, SentryTitleFallback),
                data.SentryActive
                    ? localizer.GetString(ActiveKey, ActiveFallback)
                    : localizer.GetString(InactiveKey, InactiveFallback),
                localizer.GetString(SentryDescKey, SentryDescFallback),
                data.SentryActive ? SecurityTone.Watch : SecurityTone.Idle),

            BuildCard(
                "doors",
                SecurityStatusCardsRegistration.DoorGlyph,
                localizer.GetString(DoorsTitleKey, DoorsTitleFallback),
                data.DoorsClosed ? localizer.GetString(ClosedKey, ClosedFallback) : openDoorValue,
                localizer.GetString(DoorsDescKey, DoorsDescFallback),
                data.DoorsClosed ? SecurityTone.Positive : SecurityTone.Caution),

            BuildCard(
                "windows",
                SecurityStatusCardsRegistration.WindowGlyph,
                localizer.GetString(WindowsTitleKey, WindowsTitleFallback),
                data.WindowsAllClosed
                    ? localizer.GetString(ClosedKey, ClosedFallback)
                    : localizer.GetString(OpenKey, OpenFallback),
                localizer.GetString(WindowsDescKey, WindowsDescFallback),
                data.WindowsAllClosed ? SecurityTone.Positive : SecurityTone.Caution),

            BuildCard(
                "homelink",
                SecurityStatusCardsRegistration.HomeLinkGlyph,
                localizer.GetString(HomeLinkTitleKey, HomeLinkTitleFallback),
                data.HomelinkNearby
                    ? localizer.GetString(NearbyKey, NearbyFallback)
                    : localizer.GetString(AwayKey, AwayFallback),
                localizer.GetString(HomeLinkDescKey, HomeLinkDescFallback),
                data.HomelinkNearby ? SecurityTone.Linked : SecurityTone.Idle),

            BuildCard(
                "guest",
                SecurityStatusCardsRegistration.GuestGlyph,
                localizer.GetString(GuestTitleKey, GuestTitleFallback),
                data.GuestMode
                    ? localizer.GetString(EnabledKey, EnabledFallback)
                    : localizer.GetString(DisabledKey, DisabledFallback),
                localizer.GetString(GuestDescKey, GuestDescFallback),
                data.GuestMode ? SecurityTone.Caution : SecurityTone.Idle),
        };

        return new SecurityStatusCardsDisplay(
            Cards: cards,
            HasData: data.HasData,
            AutomationName: SecurityStatusCardsRegistration.Name(localizer));
    }

    private static SecurityStatusCard BuildCard(
        string key,
        string glyph,
        string title,
        string value,
        string description,
        SecurityTone tone) =>
        new(
            Key: key,
            Glyph: glyph,
            Title: title,
            Value: value,
            Description: description,
            Tone: tone,
            AutomationName: string.Format(CultureInfo.CurrentCulture, "{0}: {1}. {2}", title, value, description));
}

/// <summary>
/// Canonical metadata for the Security-status cards surface — the native mirror of the web component at
/// web/src/features/admin/components/security-access/SecurityStatusCards.tsx. The surface reads the same
/// <c>/security/latest</c> live state the Security &amp; Access page feeds the web cards.
/// </summary>
public static class SecurityStatusCardsRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "security-status-cards";

    /// <summary>Surface category.</summary>
    public const string Category = "admin";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "SecurityStatusCards";

    /// <summary>Segoe Fluent glyph for the locked state (Lock).</summary>
    public const string LockGlyph = "\uE72E";

    /// <summary>Segoe Fluent glyph for the unlocked state (Unlock).</summary>
    public const string UnlockGlyph = "\uE785";

    /// <summary>Segoe Fluent glyph for sentry mode (Shield / Security).</summary>
    public const string SentryGlyph = "\uEA18";

    /// <summary>Segoe Fluent glyph for the doors card (Door).</summary>
    public const string DoorGlyph = "\uE8D7";

    /// <summary>Segoe Fluent glyph for the windows card (Window).</summary>
    public const string WindowGlyph = "\uE8A7";

    /// <summary>Segoe Fluent glyph for the HomeLink card (Home).</summary>
    public const string HomeLinkGlyph = "\uE80F";

    /// <summary>Segoe Fluent glyph for the guest-mode card (Permissions / Key).</summary>
    public const string GuestGlyph = "\uE192";

    /// <summary>The catalog key for the surface title / Narrator name.</summary>
    public const string TitleKey = "translation.admin.security.title";

    /// <summary>The English fallback for the surface title.</summary>
    public const string TitleFallback = "Security & Access";

    /// <summary>Localized surface name (the Security &amp; Access page heading).</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(TitleKey, TitleFallback);
    }
}

/// <summary>
/// PII-safe diagnostics for the Security-status cards surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a lock / sentry / door value — so a
/// diagnostics line can never leak the vehicle's security posture. Thread-safe.
/// </summary>
public sealed class SecurityStatusCardsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public SecurityStatusCardsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=SecurityStatusCards</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={SecurityStatusCardsRegistration.Slug}");
    }
}
