using TeslaSync.App.Core.DataDisplay;
using TeslaSync.App.Core.Live;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The visual variant of a <c>LiveIndicator</c> — the native analogue of the web
/// <c>LiveIndicatorVariant = 'pill' | 'dot' | 'compact'</c> union
/// (web/src/components/data-display/LiveIndicator.tsx L13):
/// <list type="bullet">
///   <item><see cref="Pill"/> — colored chip with icon, label and (when connected) a freshness timestamp.</item>
///   <item><see cref="Dot"/> — a bare colored dot with no text (dense headers / app shell).</item>
///   <item><see cref="Compact"/> — colored chip with icon + label, but no timestamp.</item>
/// </list>
/// </summary>
public enum LiveIndicatorVariant
{
    /// <summary>Colored chip with icon, label and a freshness timestamp when connected (web <c>'pill'</c>, the default).</summary>
    Pill,

    /// <summary>A bare colored dot, no text (web <c>'dot'</c>).</summary>
    Dot,

    /// <summary>Colored chip with icon + label, no timestamp (web <c>'compact'</c>).</summary>
    Compact,
}

/// <summary>
/// One immutable read of the live-data pipeline health — the native analogue of the two fields the web
/// <c>&lt;LiveIndicator&gt;</c> consumes from <c>useLiveConnection()</c>
/// (web/src/hooks/useLiveConnection.ts): the coarse <see cref="Status"/> (the web <c>status</c> union
/// connected / reconnecting / disconnected / unknown) and the wall-clock time of the last live message
/// (<see cref="LastMessageAt"/>, the web <c>lastMessageAt</c>). The per-channel breakdown the web hook also
/// returns is backend-internal and never surfaced, so it is intentionally omitted. Pure data — no WinUI types —
/// so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Status">The live-pipeline health (web <c>status</c>).</param>
/// <param name="LastMessageAt">The time of the last live message of any kind, or null (web <c>lastMessageAt</c>).</param>
public sealed record LiveIndicatorSnapshot(LiveConnectionState Status, DateTimeOffset? LastMessageAt)
{
    /// <summary>The brand-new-app-load default — unknown health with no message yet (web <c>'unknown'</c> start state).</summary>
    public static LiveIndicatorSnapshot Unknown { get; } = new(LiveConnectionState.Unknown, null);

    /// <summary>The transport-down default — disconnected with no message.</summary>
    public static LiveIndicatorSnapshot Disconnected { get; } = new(LiveConnectionState.Disconnected, null);

    /// <summary>
    /// Derive an indicator snapshot from the Core live-connection monitor's <see cref="LiveConnectionSnapshot"/>
    /// — the native equivalent of the web <c>useLiveConnection()</c> deriving its return shape from the
    /// <c>sseManager</c> lifecycle. The transport <see cref="LiveConnectionSnapshot.EffectiveState"/> (which
    /// already folds in the ADR-013 freshness window) is mapped to the coarse UI-facing
    /// <see cref="LiveConnectionState"/> via the shared <see cref="LiveConnectionMapping.ToIndicatorState"/>, and
    /// <see cref="LiveConnectionSnapshot.LastEventAt"/> becomes the last-message timestamp.
    /// </summary>
    /// <param name="connection">The Core monitor snapshot to project.</param>
    public static LiveIndicatorSnapshot FromConnection(LiveConnectionSnapshot connection)
    {
        ArgumentNullException.ThrowIfNull(connection);
        return new LiveIndicatorSnapshot(
            LiveConnectionMapping.ToIndicatorState(connection.EffectiveState),
            connection.LastEventAt);
    }
}

/// <summary>
/// Canonical metadata for the LiveIndicator surface — the native analogue of the module-level <c>cfg</c> table
/// and the default <c>t()</c> calls in web/src/components/data-display/LiveIndicator.tsx. Carries the diagnostics
/// slug, the automation id, the lowercase status tokens the web <c>status</c> union uses, the Segoe Fluent glyphs
/// standing in for the web Lucide icons (Wifi / Loader2 / WifiOff), the i18n keys (each with the English fallback
/// the web source renders verbatim) and the ARIA role/live contract. UI-free so it is asserted in tests.
/// </summary>
public static class LiveIndicatorRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "LiveIndicator";

    /// <summary>The root automation id Narrator and UI-automation resolve the surface by.</summary>
    public const string RootAutomationId = "live-indicator";

    /// <summary>ARIA role the surface exposes (web <c>role="status"</c>).</summary>
    public const string StatusRole = "status";

    /// <summary>ARIA live urgency the status region declares (web <c>role="status"</c> ⇒ implicit <c>aria-live="polite"</c>).</summary>
    public const string LiveSetting = "polite";

    /// <summary>The middle dot separating the label from the freshness timestamp (web <c>'· '</c>).</summary>
    public const string MiddleDot = "\u00B7";

    /// <summary>Segoe Fluent "Wifi" glyph — the web Lucide <c>Wifi</c> icon (connected).</summary>
    public const string WifiGlyph = "\uE701";

    /// <summary>Segoe Fluent "Refresh" glyph — the native spinning stand-in for the web Lucide <c>Loader2</c> icon (reconnecting).</summary>
    public const string ReconnectingGlyph = "\uE72C";

    /// <summary>Segoe Fluent "offline" glyph — the native stand-in for the web Lucide <c>WifiOff</c> icon (disconnected / unknown).</summary>
    public const string WifiOffGlyph = "\uEB5E";

    /// <summary>i18n key for the connected label (web <c>t('live.connected', 'Live')</c>).</summary>
    public const string ConnectedKey = "translation.live.connected";

    /// <summary>English fallback for <see cref="ConnectedKey"/> — the web literal.</summary>
    public const string ConnectedFallback = "Live";

    /// <summary>i18n key for the reconnecting label (web <c>t('live.reconnecting', 'Reconnecting…')</c>).</summary>
    public const string ReconnectingKey = "translation.live.reconnecting";

    /// <summary>English fallback for <see cref="ReconnectingKey"/> — the web literal (trailing ellipsis).</summary>
    public const string ReconnectingFallback = "Reconnecting\u2026";

    /// <summary>i18n key for the disconnected label (web <c>t('live.disconnected', 'Offline')</c>).</summary>
    public const string DisconnectedKey = "translation.live.disconnected";

    /// <summary>English fallback for <see cref="DisconnectedKey"/> — the web literal.</summary>
    public const string DisconnectedFallback = "Offline";

    /// <summary>i18n key for the unknown label (web <c>t('live.unknown', 'Unknown')</c>).</summary>
    public const string UnknownKey = "translation.live.unknown";

    /// <summary>English fallback for <see cref="UnknownKey"/> — the web literal.</summary>
    public const string UnknownFallback = "Unknown";

    /// <summary>The lowercase status token the web <c>status</c> union uses: connected / reconnecting / disconnected / unknown.</summary>
    public static string StatusToken(LiveConnectionState status) => status switch
    {
        LiveConnectionState.Connected => "connected",
        LiveConnectionState.Reconnecting => "reconnecting",
        LiveConnectionState.Disconnected => "disconnected",
        _ => "unknown",
    };

    /// <summary>The Segoe Fluent glyph the <paramref name="status"/> shows (web Lucide Wifi / Loader2 / WifiOff).</summary>
    public static string Glyph(LiveConnectionState status) => status switch
    {
        LiveConnectionState.Connected => WifiGlyph,
        LiveConnectionState.Reconnecting => ReconnectingGlyph,
        _ => WifiOffGlyph,
    };

    /// <summary>The i18n key and English fallback for the <paramref name="status"/> label (web <c>cfg[status].label</c>).</summary>
    public static (string Key, string Fallback) LabelKey(LiveConnectionState status) => status switch
    {
        LiveConnectionState.Connected => (ConnectedKey, ConnectedFallback),
        LiveConnectionState.Reconnecting => (ReconnectingKey, ReconnectingFallback),
        LiveConnectionState.Disconnected => (DisconnectedKey, DisconnectedFallback),
        _ => (UnknownKey, UnknownFallback),
    };

    /// <summary>Resolve the localized label for <paramref name="status"/> through the i18n facade (web <c>t(...)</c>).</summary>
    /// <param name="status">The live-pipeline health.</param>
    /// <param name="localizer">The i18n facade the label resolves through.</param>
    public static string Label(LiveConnectionState status, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        var (key, fallback) = LabelKey(status);
        return localizer.GetString(key, fallback);
    }
}

/// <summary>
/// The fully projected, render-ready view of a <see cref="LiveIndicatorSnapshot"/> for a given
/// <see cref="LiveIndicatorVariant"/> — everything the web component derives before returning JSX
/// (web/src/components/data-display/LiveIndicator.tsx L45-L112): the resolved <see cref="Status"/> and its
/// lowercase <see cref="StatusToken"/>, the generated design-token <see cref="AccentBrushKey"/> the dot / icon /
/// label tint from (web <c>cfg[status].text</c> / <c>dot</c>), the Segoe Fluent <see cref="IconGlyph"/> (web
/// <c>cfg[status].icon</c>), whether the icon <see cref="Spin"/>s (web <c>cfg[status].spin</c> + the native
/// reduced-motion gate), the localized <see cref="Label"/> (web <c>cfg[status].label</c>), which sub-elements the
/// variant draws (<see cref="ShowDot"/> / <see cref="ShowIcon"/> / <see cref="ShowLabel"/> /
/// <see cref="ShowTimestamp"/>), the freshness <see cref="RelativeText"/> (web
/// <c>formatRelativeTime(lastMessageAt)</c>), whether the dot variant carries a tooltip (<see cref="DotOnly"/>,
/// web <c>title</c> on the bare dot) and the accessible <see cref="AutomationName"/> (web <c>aria-label</c>) with
/// its <see cref="Role"/> / <see cref="LiveSetting"/>. Pure value type so every field is asserted headlessly.
/// </summary>
public readonly record struct LiveIndicatorProjection
{
    private LiveIndicatorProjection(
        LiveConnectionState status,
        LiveIndicatorVariant variant,
        string accentBrushKey,
        string iconGlyph,
        string label,
        bool spin,
        bool showDot,
        bool showIcon,
        bool showLabel,
        bool showTimestamp,
        string relativeText)
    {
        Status = status;
        Variant = variant;
        AccentBrushKey = accentBrushKey;
        IconGlyph = iconGlyph;
        Label = label;
        Spin = spin;
        ShowDot = showDot;
        ShowIcon = showIcon;
        ShowLabel = showLabel;
        ShowTimestamp = showTimestamp;
        RelativeText = relativeText;
        StatusToken = LiveIndicatorRegistration.StatusToken(status);
        Role = LiveIndicatorRegistration.StatusRole;
        LiveSetting = LiveIndicatorRegistration.LiveSetting;
    }

    /// <summary>The resolved live-pipeline health (web <c>status</c>).</summary>
    public LiveConnectionState Status { get; }

    /// <summary>The lowercase status token (web <c>status</c> union): connected / reconnecting / disconnected / unknown.</summary>
    public string StatusToken { get; }

    /// <summary>The visual variant being rendered (web <c>variant</c>).</summary>
    public LiveIndicatorVariant Variant { get; }

    /// <summary>The generated design-token brush key the dot, icon and label tint from (web <c>cfg[status].text</c> / <c>dot</c>).</summary>
    public string AccentBrushKey { get; }

    /// <summary>The Segoe Fluent glyph (web Lucide Wifi / Loader2 / WifiOff).</summary>
    public string IconGlyph { get; }

    /// <summary>The localized status label (web <c>cfg[status].label</c>).</summary>
    public string Label { get; }

    /// <summary>Whether the icon spins (web <c>cfg[status].spin</c> — reconnecting — gated by the native reduce-motion preference).</summary>
    public bool Spin { get; }

    /// <summary>Whether the bare colored dot is drawn (web <c>variant === 'dot'</c>).</summary>
    public bool ShowDot { get; }

    /// <summary>Whether the chip icon is drawn (web chip variants <c>'pill'</c> / <c>'compact'</c>).</summary>
    public bool ShowIcon { get; }

    /// <summary>Whether the chip label is drawn (web chip variants <c>'pill'</c> / <c>'compact'</c>).</summary>
    public bool ShowLabel { get; }

    /// <summary>Whether the freshness timestamp is drawn (web <c>variant === 'pill' &amp;&amp; status === 'connected' &amp;&amp; lastMessageAt</c>).</summary>
    public bool ShowTimestamp { get; }

    /// <summary>The freshness relative-time text (web <c>formatRelativeTime(lastMessageAt)</c>); empty unless <see cref="ShowTimestamp"/>.</summary>
    public string RelativeText { get; }

    /// <summary>Whether this is the bare-dot variant — the view shows the label as a tooltip (web <c>title</c> on the dot).</summary>
    public bool DotOnly => Variant == LiveIndicatorVariant.Dot;

    /// <summary>The accessible name (web <c>aria-label</c>): always the status label, for every variant.</summary>
    public string AutomationName => Label;

    /// <summary>The ARIA role the surface exposes (web <c>role="status"</c>).</summary>
    public string Role { get; }

    /// <summary>The ARIA live urgency the surface declares (always polite).</summary>
    public string LiveSetting { get; }

    /// <summary>
    /// Project a snapshot into a render-ready value for <paramref name="variant"/>, reproducing the web component
    /// body exactly (web/src/components/data-display/LiveIndicator.tsx L45-L112): the per-status <c>cfg</c> table
    /// (token accent, Segoe Fluent glyph, localized label and the reconnecting <c>spin</c> flag), the variant's
    /// element set (the bare dot for <c>'dot'</c>; icon + label for <c>'pill'</c> / <c>'compact'</c>), and the
    /// freshness stamp shown only when <c>variant === 'pill' &amp;&amp; status === 'connected' &amp;&amp;
    /// lastMessageAt</c>. The spin flag additionally honors the OS reduce-motion preference (the native
    /// accessibility contract), so an animation-suppressed host shows the static reconnecting glyph.
    /// </summary>
    /// <param name="snapshot">The live-pipeline read (web <c>useLiveConnection()</c> return).</param>
    /// <param name="variant">The visual variant (web <c>variant</c>, default <see cref="LiveIndicatorVariant.Pill"/>).</param>
    /// <param name="reduceMotion">Whether the OS reduce-motion preference is set (web <c>prefers-reduced-motion</c>).</param>
    /// <param name="now">The clock the freshness relative-time age is measured against (web <c>Date.now()</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static LiveIndicatorProjection Project(
        LiveIndicatorSnapshot snapshot,
        LiveIndicatorVariant variant,
        bool reduceMotion,
        DateTimeOffset now,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentNullException.ThrowIfNull(localizer);

        var status = snapshot.Status;

        // web cfg[status].spin (reconnecting only) — additionally gated on the OS reduce-motion preference so the
        // native surface honors the platform accessibility contract (the web class is unconditional).
        var spin = LiveConnectionPresentation.ShouldAnimate(status) && !reduceMotion;

        var isDot = variant == LiveIndicatorVariant.Dot;

        // web: {variant === 'pill' && status === 'connected' && lastMessageAt && (...)}.
        var showTimestamp = variant == LiveIndicatorVariant.Pill
            && status == LiveConnectionState.Connected
            && snapshot.LastMessageAt is not null;

        // web: `· ${formatRelativeTime(lastMessageAt)}` — DateTimeFormatting.Relative is the 1:1 native port.
        var relativeText = showTimestamp
            ? DateTimeFormatting.Format(snapshot.LastMessageAt, DateTimeVariant.Relative, now)
            : string.Empty;

        return new LiveIndicatorProjection(
            status: status,
            variant: variant,
            accentBrushKey: LiveConnectionPresentation.AccentBrushKey(status),
            iconGlyph: LiveIndicatorRegistration.Glyph(status),
            label: LiveIndicatorRegistration.Label(status, localizer),
            spin: spin,
            showDot: isDot,
            showIcon: !isDot,
            showLabel: !isDot,
            showTimestamp: showTimestamp,
            relativeText: relativeText);
    }
}

/// <summary>
/// PII-safe diagnostics for the LiveIndicator surface (P1/S11 diagnostics contract). The indicator carries no
/// user content (only a coarse connection status and a relative time), so the collector records ONLY the
/// operational <c>view.opened</c> event with the surface slug — never the status or timestamp. Thread-safe;
/// mirrors the peer surfaces' diagnostics collectors.
/// </summary>
public sealed class LiveIndicatorDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public LiveIndicatorDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=LiveIndicator</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={LiveIndicatorRegistration.Slug}");
    }
}
