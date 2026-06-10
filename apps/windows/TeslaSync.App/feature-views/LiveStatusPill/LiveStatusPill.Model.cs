using System.Globalization;
using TeslaSync.App.Core;
using TeslaSync.App.Core.DataDisplay;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The connection-state the <c>LiveStatusPill</c> reflects — the native analogue of the web
/// <c>StatusLiveState</c> union (<c>'live' | 'reconnecting' | 'offline'</c>) surfaced by
/// <c>useStatusLiveSSE</c> in web/src/features/system/hooks/useStatusLiveSSE.ts. Kept as a dedicated enum
/// (rather than reusing the atomic <c>LiveConnectionState</c>) because this surface's offline tone is the
/// neutral zinc/grey of the web source, whereas the shared live indicator paints its disconnected state
/// danger-red — a different semantic that must not leak in here.
/// </summary>
public enum StatusLiveState
{
    /// <summary>SSE flowing — green dot + "Live" (web <c>'live'</c>).</summary>
    Live,

    /// <summary>Last open errored, re-establishing — pulsing amber + "Reconnecting" (web <c>'reconnecting'</c>).</summary>
    Reconnecting,

    /// <summary>Gave up after backoff — grey + "Offline" (web <c>'offline'</c>).</summary>
    Offline,
}

/// <summary>
/// The render-time data model the <c>LiveStatusPill</c> surface binds to — the native analogue of the web
/// <c>LiveStatusPillProps</c> (<c>{ state, lastUpdateAt, now }</c> in
/// web/src/features/system/components/status/LiveStatusPill.tsx). The web component is purely presentational:
/// the parent /system-status surface owns the <c>useStatusLiveSSE</c> pump and feeds an already-resolved
/// connection <see cref="State"/> plus the <see cref="LastUpdateAt"/> timestamp of the last snapshot, so
/// there is no fetch-driven loading / empty / error / stale branch to reproduce here — the three connection
/// states (including <see cref="StatusLiveState.Offline"/>) ARE the surface's complete state set, exactly as
/// React re-renders the pill with already-resolved props. The web <c>now</c> prop is a render tick rather than
/// data, so it is a projection argument (see <see cref="LiveStatusPillProjection.Project"/>), not a model
/// field. Pure data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="State">The live-pipeline connection state (web <c>state</c>).</param>
/// <param name="LastUpdateAt">When the last snapshot landed, or null before the first (web <c>lastUpdateAt</c>).</param>
public sealed record LiveStatusPillModel(StatusLiveState State, DateTimeOffset? LastUpdateAt)
{
    /// <summary>The initial model — reconnecting with no snapshot yet (the web hook's start state).</summary>
    public static LiveStatusPillModel Connecting { get; } = new(StatusLiveState.Reconnecting, null);

    /// <summary>The offline model — gave up after backoff, no snapshot.</summary>
    public static LiveStatusPillModel Offline { get; } = new(StatusLiveState.Offline, null);
}

/// <summary>
/// The fully projected, render-ready view of a <see cref="LiveStatusPillModel"/> — everything the web
/// component derives before returning JSX: the resolved <see cref="State"/> and its lowercase
/// <see cref="StateToken"/> (web <c>data-status-live-state</c>), the semantic colour <see cref="Tier"/> and
/// its token-backed <see cref="AccentBrushKey"/> (web <c>TONE[state].cls</c> / <c>dot</c>), the Segoe Fluent
/// <see cref="IconGlyph"/> standing in for the web Lucide icon, whether the dot <see cref="Pulse"/>s (web
/// <c>TONE[state].pulse</c>), the localized <see cref="Label"/> (web <c>TONE[state].label</c>), the relative
/// "updated" <see cref="RelativeText"/> (web <c>relative(now, lastUpdateAt)</c>) and the composed Narrator
/// <see cref="AutomationName"/> (web <c>aria-label</c>). Pure data so every value is asserted headlessly.
/// </summary>
/// <param name="State">The connection state, passed through.</param>
/// <param name="StateToken">The lowercase state token (web <c>data-status-live-state</c>): live / reconnecting / offline.</param>
/// <param name="Tier">The semantic colour tier — Success / Warning / Neutral.</param>
/// <param name="AccentBrushKey">The generated design-token brush key the tier resolves to.</param>
/// <param name="IconGlyph">The Segoe Fluent glyph for the state (web Lucide Activity / Wifi / WifiOff).</param>
/// <param name="Pulse">True only while reconnecting — the dot pulses (web <c>pulse</c>).</param>
/// <param name="Label">The localized state label ("Live" / "Reconnecting" / "Offline").</param>
/// <param name="RelativeText">The relative "updated" age, or an em dash before the first update.</param>
/// <param name="AutomationName">The composed Narrator name (web <c>aria-label</c>).</param>
public sealed record LiveStatusPillDisplay(
    StatusLiveState State,
    string StateToken,
    StatusKind Tier,
    string AccentBrushKey,
    string IconGlyph,
    bool Pulse,
    string Label,
    string RelativeText,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="LiveStatusPillModel"/> (plus the render clock and the i18n facade) to its
/// <see cref="LiveStatusPillDisplay"/> — the native port of
/// web/src/features/system/components/status/LiveStatusPill.tsx. Reproduces the web derivations exactly: the
/// per-state <c>TONE</c> table (tier colour, pulse flag, icon and label), the <c>relative(now, lastUpdateAt)</c>
/// age tiers (em dash for no update, "just now" under five seconds, then "<c>{s}s ago</c>" / "<c>{m}m ago</c>" /
/// "<c>{h}h ago</c>"), and the composed <c>aria-label</c>. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class LiveStatusPillProjection
{
    /// <summary>Under this many seconds the relative label reads "just now" (web <c>secs &lt; 5</c>).</summary>
    public const int JustNowThresholdSeconds = 5;

    /// <summary>Seconds in a minute — the boundary from "{s}s ago" to "{m}m ago" (web <c>secs &lt; 60</c>).</summary>
    public const int MinuteSeconds = 60;

    /// <summary>Seconds in an hour — the boundary from "{m}m ago" to "{h}h ago" (web <c>secs &lt; 3600</c>).</summary>
    public const int HourSeconds = 3600;

    /// <summary>
    /// The semantic colour tier for <paramref name="state"/>, mirroring the web <c>TONE</c> hues:
    /// live is green (<see cref="StatusKind.Success"/>), reconnecting is amber (<see cref="StatusKind.Warning"/>)
    /// and offline is the neutral zinc/grey (<see cref="StatusKind.Neutral"/>).
    /// </summary>
    public static StatusKind Tier(StatusLiveState state) => state switch
    {
        StatusLiveState.Live => StatusKind.Success,
        StatusLiveState.Reconnecting => StatusKind.Warning,
        _ => StatusKind.Neutral,
    };

    /// <summary>True only while reconnecting — the dot pulses (web <c>TONE[state].pulse</c>).</summary>
    public static bool Pulses(StatusLiveState state) => state == StatusLiveState.Reconnecting;

    /// <summary>The Segoe Fluent glyph for <paramref name="state"/> (web Lucide Activity / Wifi / WifiOff).</summary>
    public static string GlyphFor(StatusLiveState state) => state switch
    {
        StatusLiveState.Live => LiveStatusPillRegistration.ActivityGlyph,
        StatusLiveState.Reconnecting => LiveStatusPillRegistration.WifiGlyph,
        _ => LiveStatusPillRegistration.OfflineGlyph,
    };

    /// <summary>The lowercase state token (web <c>data-status-live-state</c>): live / reconnecting / offline.</summary>
    public static string StateToken(StatusLiveState state) => state switch
    {
        StatusLiveState.Live => "live",
        StatusLiveState.Reconnecting => "reconnecting",
        _ => "offline",
    };

    /// <summary>Resolve the localized state label for <paramref name="state"/> (web <c>TONE[state].label</c>).</summary>
    public static string Label(StatusLiveState state, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        var (key, fallback) = state switch
        {
            StatusLiveState.Live => (LiveStatusPillRegistration.LiveLabelKey, LiveStatusPillRegistration.LiveLabelFallback),
            StatusLiveState.Reconnecting => (LiveStatusPillRegistration.ReconnectingLabelKey, LiveStatusPillRegistration.ReconnectingLabelFallback),
            _ => (LiveStatusPillRegistration.OfflineLabelKey, LiveStatusPillRegistration.OfflineLabelFallback),
        };
        return localizer.GetString(key, fallback);
    }

    /// <summary>
    /// The relative "updated" label for a snapshot that landed at <paramref name="lastUpdateAt"/>, evaluated
    /// against <paramref name="now"/> — the native port of the web <c>relative(now, lastUpdateAt)</c> helper.
    /// A null timestamp is the em dash (web <c>'—'</c>); otherwise the age in whole seconds (floored at zero,
    /// via the shared <see cref="FreshnessLogic.ComputeAge"/> which matches the web
    /// <c>Math.max(0, Math.floor(…/1000))</c>) tiers into "just now" (&lt; 5 s), then "<c>{s}s ago</c>",
    /// "<c>{m}m ago</c>" and "<c>{h}h ago</c>". The "just now" phrase and the "ago" word resolve through the
    /// localizer; the s/m/h unit letters mirror the web source's own literals.
    /// </summary>
    public static string FormatRelative(DateTimeOffset? lastUpdateAt, DateTimeOffset now, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        if (FreshnessLogic.ComputeAge(lastUpdateAt, now) is not { } secs)
        {
            return LiveStatusPillRegistration.EmDash;
        }

        if (secs < JustNowThresholdSeconds)
        {
            return localizer.GetString(LiveStatusPillRegistration.JustNowKey, LiveStatusPillRegistration.JustNowFallback);
        }

        var ago = localizer.GetString(LiveStatusPillRegistration.AgoKey, LiveStatusPillRegistration.AgoFallback);
        if (secs < MinuteSeconds)
        {
            return string.Format(CultureInfo.InvariantCulture, "{0}s {1}", secs, ago);
        }

        if (secs < HourSeconds)
        {
            return string.Format(CultureInfo.InvariantCulture, "{0}m {1}", secs / MinuteSeconds, ago);
        }

        return string.Format(CultureInfo.InvariantCulture, "{0}h {1}", secs / HourSeconds, ago);
    }

    /// <summary>Project <paramref name="model"/> into a render-ready display against the render clock.</summary>
    /// <param name="model">The render-time data model (the web props minus the <c>now</c> tick).</param>
    /// <param name="localizer">The i18n facade resolving the label, "just now"/"ago" and the aria-label template.</param>
    /// <param name="now">The render clock — the web <c>now</c> prop driving the relative label.</param>
    public static LiveStatusPillDisplay Project(LiveStatusPillModel model, ILocalizer localizer, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        var state = model.State;
        var tier = Tier(state);
        var label = Label(state, localizer);
        var relative = FormatRelative(model.LastUpdateAt, now, localizer);
        var ariaTemplate = localizer.GetString(
            LiveStatusPillRegistration.AriaLabelKey,
            LiveStatusPillRegistration.AriaLabelFallback);
        var automationName = string.Format(CultureInfo.CurrentCulture, ariaTemplate, label, relative);

        return new LiveStatusPillDisplay(
            State: state,
            StateToken: StateToken(state),
            Tier: tier,
            AccentBrushKey: StatusResources.AccentBrushKey(tier),
            IconGlyph: GlyphFor(state),
            Pulse: Pulses(state),
            Label: label,
            RelativeText: relative,
            AutomationName: automationName);
    }
}

/// <summary>
/// Canonical metadata for the <c>LiveStatusPill</c> feature surface — the native mirror of the web component at
/// web/src/features/system/components/status/LiveStatusPill.tsx: the stable diagnostics slug, the Segoe Fluent
/// glyphs that stand in for the web Lucide icons, the i18n keys (each with the English fallback the web source
/// renders verbatim) and the literal punctuation the web pill draws. UI-free so the metadata is asserted in
/// tests.
/// </summary>
public static class LiveStatusPillRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "LiveStatusPill";

    /// <summary>Segoe Fluent "activity / pulse" glyph — the web Lucide <c>Activity</c> icon (live).</summary>
    public const string ActivityGlyph = "\uE9D2";

    /// <summary>Segoe Fluent "Wifi" glyph — the web Lucide <c>Wifi</c> icon (reconnecting).</summary>
    public const string WifiGlyph = "\uE701";

    /// <summary>Segoe Fluent "offline" glyph — the native stand-in for the web Lucide <c>WifiOff</c> icon (offline).</summary>
    public const string OfflineGlyph = "\uEB5E";

    /// <summary>i18n key for the live label (web <c>TONE.live.label</c>).</summary>
    public const string LiveLabelKey = "system.liveStatus.label.live";

    /// <summary>English fallback for <see cref="LiveLabelKey"/> — the web literal.</summary>
    public const string LiveLabelFallback = "Live";

    /// <summary>i18n key for the reconnecting label (web <c>TONE.reconnecting.label</c>).</summary>
    public const string ReconnectingLabelKey = "system.liveStatus.label.reconnecting";

    /// <summary>English fallback for <see cref="ReconnectingLabelKey"/> — the web literal (no ellipsis).</summary>
    public const string ReconnectingLabelFallback = "Reconnecting";

    /// <summary>i18n key for the offline label (web <c>TONE.offline.label</c>).</summary>
    public const string OfflineLabelKey = "system.liveStatus.label.offline";

    /// <summary>English fallback for <see cref="OfflineLabelKey"/> — the web literal.</summary>
    public const string OfflineLabelFallback = "Offline";

    /// <summary>i18n key for the "just now" phrase (web <c>'just now'</c>).</summary>
    public const string JustNowKey = "system.liveStatus.justNow";

    /// <summary>English fallback for <see cref="JustNowKey"/> — the web literal (lowercase).</summary>
    public const string JustNowFallback = "just now";

    /// <summary>i18n key for the "ago" word composed into the relative label (web <c>'… ago'</c>).</summary>
    public const string AgoKey = "system.liveStatus.ago";

    /// <summary>English fallback for <see cref="AgoKey"/> — the web literal.</summary>
    public const string AgoFallback = "ago";

    /// <summary>i18n key for the Narrator aria-label template (web <c>aria-label</c>).</summary>
    public const string AriaLabelKey = "system.liveStatus.ariaLabel";

    /// <summary>English fallback for <see cref="AriaLabelKey"/> — the web template (<c>{0}</c>=label, <c>{1}</c>=relative).</summary>
    public const string AriaLabelFallback = "Live status stream: {0}, updated {1}";

    /// <summary>The em dash shown before the first update (web <c>'—'</c>).</summary>
    public const string EmDash = "\u2014";

    /// <summary>The middle dot separating the label from the relative age (web <c>'·'</c>).</summary>
    public const string MiddleDot = "\u00B7";
}

/// <summary>
/// PII-safe diagnostics for the <c>LiveStatusPill</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never the connection state or update time — so
/// a diagnostics line can never leak fleet state. Thread-safe.
/// </summary>
public sealed class LiveStatusPillDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public LiveStatusPillDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=LiveStatusPill</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={LiveStatusPillRegistration.Slug}");
    }
}
