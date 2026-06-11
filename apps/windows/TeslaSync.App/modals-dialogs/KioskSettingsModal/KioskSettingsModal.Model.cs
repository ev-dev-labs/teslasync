using System.Globalization;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// On-screen corner the kiosk clock pins to — the native mirror of the web <c>KioskConfig.clockPosition</c> union
/// (<c>'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'</c>,
/// web/src/features/dashboard/hooks/useKioskMode.ts). The wire form is the lower-case hyphenated token the web
/// persists to <c>localStorage</c>.
/// </summary>
public enum ClockCorner
{
    /// <summary>Top-left corner (web <c>top-left</c>).</summary>
    TopLeft,

    /// <summary>Top-right corner (web <c>top-right</c>).</summary>
    TopRight,

    /// <summary>Bottom-left corner (web <c>bottom-left</c>).</summary>
    BottomLeft,

    /// <summary>Bottom-right corner (web <c>bottom-right</c>) — the web default.</summary>
    BottomRight,
}

/// <summary>Wire mapping for <see cref="ClockCorner"/> — UI-free so it is asserted headlessly.</summary>
public static class ClockCorners
{
    /// <summary>The lower-case hyphenated token for <paramref name="corner"/> (web <c>clockPosition</c> member).</summary>
    public static string ToToken(ClockCorner corner) => corner switch
    {
        ClockCorner.TopLeft => "top-left",
        ClockCorner.TopRight => "top-right",
        ClockCorner.BottomLeft => "bottom-left",
        ClockCorner.BottomRight => "bottom-right",
        _ => "bottom-right",
    };

    /// <summary>Parse a web token back to a <see cref="ClockCorner"/>; false (→ bottom-right) for an unknown token.</summary>
    public static bool TryFromToken(string? token, out ClockCorner corner)
    {
        switch (token)
        {
            case "top-left":
                corner = ClockCorner.TopLeft;
                return true;
            case "top-right":
                corner = ClockCorner.TopRight;
                return true;
            case "bottom-left":
                corner = ClockCorner.BottomLeft;
                return true;
            case "bottom-right":
                corner = ClockCorner.BottomRight;
                return true;
            default:
                corner = ClockCorner.BottomRight;
                return false;
        }
    }
}

/// <summary>
/// The kiosk-mode configuration the modal edits — the native mirror of the web <c>KioskConfig</c>
/// (web/src/features/dashboard/hooks/useKioskMode.ts). The web modal receives this as a prop and emits partial
/// updates through <c>onUpdateConfig</c>; the native surface holds it in its view-model and emits a fresh snapshot
/// on every change. Durations keep the web units verbatim so the option labels and the downstream kiosk runtime
/// match: <see cref="RotateIntervalSeconds"/> and <see cref="CursorTimeoutSeconds"/> are in seconds,
/// <see cref="DimAfterMinutes"/> is in minutes; <see cref="DimLevel"/>, <see cref="WidgetOpacity"/> and
/// <see cref="BackgroundOpacity"/> are 0..1 fractions.
/// </summary>
public sealed record KioskConfig(
    int RotateIntervalSeconds,
    IReadOnlyList<string> DashboardIds,
    bool HideCursor,
    int CursorTimeoutSeconds,
    int DimAfterMinutes,
    double DimLevel,
    bool ShowClock,
    ClockCorner ClockPosition,
    double WidgetOpacity,
    double BackgroundOpacity)
{
    /// <summary>
    /// The defaults applied when no saved kiosk config exists — a verbatim mirror of the web
    /// <c>DEFAULT_KIOSK_CONFIG</c> (30&#160;s rotation, all dashboards, cursor auto-hide after 5&#160;s, no
    /// dimming, clock shown bottom-right, fully solid widgets and background).
    /// </summary>
    public static KioskConfig Default { get; } = new(
        RotateIntervalSeconds: KioskSettingsModalRegistration.DefaultRotateIntervalSeconds,
        DashboardIds: Array.Empty<string>(),
        HideCursor: KioskSettingsModalRegistration.DefaultHideCursor,
        CursorTimeoutSeconds: KioskSettingsModalRegistration.DefaultCursorTimeoutSeconds,
        DimAfterMinutes: KioskSettingsModalRegistration.DefaultDimAfterMinutes,
        DimLevel: KioskSettingsModalRegistration.DefaultDimLevel,
        ShowClock: KioskSettingsModalRegistration.DefaultShowClock,
        ClockPosition: KioskSettingsModalRegistration.DefaultClockPosition,
        WidgetOpacity: KioskSettingsModalRegistration.DefaultWidgetOpacity,
        BackgroundOpacity: KioskSettingsModalRegistration.DefaultBackgroundOpacity);
}

/// <summary>
/// One saved dashboard the rotation list offers — the native mirror of the fields the web modal reads off a
/// <c>SavedDashboard</c> (web/src/features/dashboard/widgets/types.ts): its <see cref="Id"/>, display
/// <see cref="Name"/> and whether it is the user's <see cref="IsDefault"/> layout (which renders the "Default"
/// chip). The widgets / layouts the web type also carries are irrelevant to this surface and are not modelled.
/// </summary>
public sealed record KioskDashboard(string Id, string Name, bool IsDefault = false);

/// <summary>One choice in a kiosk dropdown — a value paired with its localized label (web inline option arrays).</summary>
/// <typeparam name="T">The option's value type (an interval in seconds / minutes, or a <see cref="ClockCorner"/>).</typeparam>
public sealed record KioskSelectOption<T>(T Value, string Label);

/// <summary>
/// The computed live-preview swatch appearance — the native analogue of the web preview block's inline styles.
/// <see cref="BackgroundAlpha"/> is the alpha of the page-background layer (web
/// <c>rgba(10,10,20,backgroundOpacity)</c>), <see cref="WidgetAlpha"/> the alpha of the frosted widget panel (web
/// <c>rgba(255,255,255,0.03 + widgetOpacity*0.17)</c>) and <see cref="BlurRadiusPixels"/> the panel blur (web
/// <c>blur(4 + widgetOpacity*12)px</c>). The fixed RGB channels live on
/// <see cref="KioskSettingsModalRegistration"/>; the view composes the colours so this record stays WinUI-free.
/// </summary>
public sealed record KioskPreview(byte BackgroundAlpha, byte WidgetAlpha, double BlurRadiusPixels);

/// <summary>
/// Canonical metadata, web defaults / bounds, Segoe Fluent glyphs and i18n keys for the
/// <c>KioskSettingsModal</c> surface — the native mirror of
/// web/src/features/dashboard/components/KioskSettingsModal.tsx. The web component ships literal copy and inline
/// option arrays; every literal is keyed here (with that literal as the English fallback) so the native view and
/// view-model stay free of inline strings and magic numbers and resolve copy through the i18n facade. The
/// <c>kiosk.*</c> keys mirror the web <c>t('kiosk.…')</c> calls one-for-one. UI-free so every key + bound is
/// asserted in tests.
/// </summary>
public static class KioskSettingsModalRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "KioskSettingsModal";

    // ── Web DEFAULT_KIOSK_CONFIG ─────────────────────────────────────────────────────────────────────────

    /// <summary>Default rotation interval in seconds (web <c>rotateInterval: 30</c>).</summary>
    public const int DefaultRotateIntervalSeconds = 30;

    /// <summary>Cursor auto-hide on by default (web <c>hideCursor: true</c>).</summary>
    public const bool DefaultHideCursor = true;

    /// <summary>Default cursor auto-hide delay in seconds (web <c>cursorTimeout: 5</c>).</summary>
    public const int DefaultCursorTimeoutSeconds = 5;

    /// <summary>Default screen-dim delay in minutes; 0 disables dimming (web <c>dimAfter: 0</c>).</summary>
    public const int DefaultDimAfterMinutes = 0;

    /// <summary>Default dimmed-brightness fraction (web <c>dimLevel: 0.5</c>).</summary>
    public const double DefaultDimLevel = 0.5;

    /// <summary>Clock shown by default (web <c>showClock: true</c>).</summary>
    public const bool DefaultShowClock = true;

    /// <summary>Default clock corner (web <c>clockPosition: 'bottom-right'</c>).</summary>
    public const ClockCorner DefaultClockPosition = ClockCorner.BottomRight;

    /// <summary>Default widget-panel opacity fraction (web <c>widgetOpacity: 1.0</c>).</summary>
    public const double DefaultWidgetOpacity = 1.0;

    /// <summary>Default page-background opacity fraction (web <c>backgroundOpacity: 1.0</c>).</summary>
    public const double DefaultBackgroundOpacity = 1.0;

    // ── Slider bounds (web Slider min / max / step, in percent) ──────────────────────────────────────────

    /// <summary>Dimmed-brightness slider minimum percent (web dim-brightness <c>min={30}</c>).</summary>
    public const int DimLevelMinPercent = 30;

    /// <summary>Dimmed-brightness slider maximum percent (web dim-brightness <c>max={90}</c>).</summary>
    public const int DimLevelMaxPercent = 90;

    /// <summary>Widget-opacity slider minimum percent (web widget-opacity <c>min={30}</c>).</summary>
    public const int WidgetOpacityMinPercent = 30;

    /// <summary>Widget-opacity slider maximum percent (web widget-opacity <c>max={100}</c>).</summary>
    public const int WidgetOpacityMaxPercent = 100;

    /// <summary>Background-opacity slider minimum percent (web background-opacity <c>min={0}</c>).</summary>
    public const int BackgroundOpacityMinPercent = 0;

    /// <summary>Background-opacity slider maximum percent (web background-opacity <c>max={100}</c>).</summary>
    public const int BackgroundOpacityMaxPercent = 100;

    /// <summary>Opacity slider step in percent (web widget / background <c>step={5}</c>).</summary>
    public const int OpacityStepPercent = 5;

    // ── Preview swatch fixed channels (web inline rgba constants) ────────────────────────────────────────

    /// <summary>Page-background preview red channel (web <c>rgba(10,…)</c>).</summary>
    public const byte PreviewBackgroundRed = 10;

    /// <summary>Page-background preview green channel (web <c>rgba(…,10,…)</c>).</summary>
    public const byte PreviewBackgroundGreen = 10;

    /// <summary>Page-background preview blue channel (web <c>rgba(…,20,…)</c>).</summary>
    public const byte PreviewBackgroundBlue = 20;

    /// <summary>Widget-panel preview channel — white for all three (web <c>rgba(255,255,255,…)</c>).</summary>
    public const byte PreviewWidgetChannel = 255;

    // ── Segoe Fluent glyphs (the web Lucide icons' native stand-ins) ─────────────────────────────────────

    /// <summary>Segoe Fluent "TVMonitor" glyph standing in for the web hint's Lucide <c>Monitor</c> icon.</summary>
    public const string MonitorGlyph = "\uE7F4";

    /// <summary>Segoe Fluent "FullScreen" glyph standing in for the web enter-button's Lucide <c>Maximize2</c> icon.</summary>
    public const string FullScreenGlyph = "\uE740";

    // ── Web option value arrays (verbatim, in render order) ──────────────────────────────────────────────

    /// <summary>Rotation-interval option values in seconds (web <c>ROTATION_OPTIONS</c>; 0 = off).</summary>
    public static IReadOnlyList<int> RotationIntervalValues { get; } = [0, 10, 15, 30, 60, 120, 300];

    /// <summary>Cursor auto-hide delay option values in seconds (web <c>CURSOR_TIMEOUT_OPTIONS</c>).</summary>
    public static IReadOnlyList<int> CursorTimeoutValues { get; } = [3, 5, 10, 15];

    /// <summary>Screen-dim delay option values in minutes (web <c>DIM_AFTER_OPTIONS</c>; 0 = never).</summary>
    public static IReadOnlyList<int> DimAfterValues { get; } = [0, 5, 10, 15, 30, 60];

    /// <summary>Clock-corner options in render order (web <c>CLOCK_POSITION_OPTIONS</c>).</summary>
    public static IReadOnlyList<ClockCorner> ClockCornerOrder { get; } =
    [
        ClockCorner.TopLeft,
        ClockCorner.TopRight,
        ClockCorner.BottomLeft,
        ClockCorner.BottomRight,
    ];

    // ── Header / field copy (the Narrator-label source; web t('kiosk.…')) ────────────────────────────────

    /// <summary>Modal title (web <c>t('kiosk.settings', 'Kiosk Settings')</c>).</summary>
    public static string SettingsTitle(ILocalizer localizer) =>
        Require(localizer).GetString("kiosk.settings", "Kiosk Settings");

    /// <summary>Rotation section title (web <c>t('kiosk.rotation', 'Dashboard Rotation')</c>).</summary>
    public static string RotationTitle(ILocalizer localizer) =>
        Require(localizer).GetString("kiosk.rotation", "Dashboard Rotation");

    /// <summary>Rotation-interval field label (web <c>t('kiosk.rotationInterval', 'Rotation Interval')</c>).</summary>
    public static string RotationIntervalLabel(ILocalizer localizer) =>
        Require(localizer).GetString("kiosk.rotationInterval", "Rotation Interval");

    /// <summary>Dashboards-to-rotate field label (web <c>t('kiosk.dashboardsToRotate', 'Dashboards to Rotate')</c>).</summary>
    public static string DashboardsToRotateLabel(ILocalizer localizer) =>
        Require(localizer).GetString("kiosk.dashboardsToRotate", "Dashboards to Rotate");

    /// <summary>Default-dashboard chip (web <c>t('kiosk.default', 'Default')</c>).</summary>
    public static string DefaultBadge(ILocalizer localizer) =>
        Require(localizer).GetString("kiosk.default", "Default");

    /// <summary>Display section title (web <c>t('kiosk.display', 'Display')</c>).</summary>
    public static string DisplayTitle(ILocalizer localizer) =>
        Require(localizer).GetString("kiosk.display", "Display");

    /// <summary>Cursor auto-hide toggle label (web <c>t('kiosk.hideCursor', 'Auto-hide Cursor')</c>).</summary>
    public static string HideCursorLabel(ILocalizer localizer) =>
        Require(localizer).GetString("kiosk.hideCursor", "Auto-hide Cursor");

    /// <summary>Cursor auto-hide delay field label (web <c>t('kiosk.cursorTimeout', 'Hide After')</c>).</summary>
    public static string CursorTimeoutLabel(ILocalizer localizer) =>
        Require(localizer).GetString("kiosk.cursorTimeout", "Hide After");

    /// <summary>Screen-dim delay field label (web <c>t('kiosk.dimAfter', 'Dim Screen After')</c>).</summary>
    public static string DimAfterLabel(ILocalizer localizer) =>
        Require(localizer).GetString("kiosk.dimAfter", "Dim Screen After");

    /// <summary>Dimmed-brightness slider label (web <c>t('kiosk.brightness', 'Dimmed Brightness')</c>).</summary>
    public static string BrightnessLabel(ILocalizer localizer) =>
        Require(localizer).GetString("kiosk.brightness", "Dimmed Brightness");

    /// <summary>Clock toggle label (web <c>t('kiosk.showClock', 'Show Clock')</c>).</summary>
    public static string ShowClockLabel(ILocalizer localizer) =>
        Require(localizer).GetString("kiosk.showClock", "Show Clock");

    /// <summary>Clock-position field label (web <c>t('kiosk.clockPosition', 'Clock Position')</c>).</summary>
    public static string ClockPositionLabel(ILocalizer localizer) =>
        Require(localizer).GetString("kiosk.clockPosition", "Clock Position");

    /// <summary>Transparency section title (web <c>t('kiosk.transparency', 'Transparency')</c>).</summary>
    public static string TransparencyTitle(ILocalizer localizer) =>
        Require(localizer).GetString("kiosk.transparency", "Transparency");

    /// <summary>Transparency section description (web <c>t('kiosk.transparencyDesc', …)</c>).</summary>
    public static string TransparencyDescription(ILocalizer localizer) =>
        Require(localizer).GetString(
            "kiosk.transparencyDesc",
            "Adjust widget and background opacity. Higher values are more solid and readable.");

    /// <summary>Widget-opacity slider label (web <c>t('kiosk.widgetOpacity', 'Widget Opacity')</c>).</summary>
    public static string WidgetOpacityLabel(ILocalizer localizer) =>
        Require(localizer).GetString("kiosk.widgetOpacity", "Widget Opacity");

    /// <summary>Background-opacity slider label (web <c>t('kiosk.bgOpacity', 'Background Opacity')</c>).</summary>
    public static string BackgroundOpacityLabel(ILocalizer localizer) =>
        Require(localizer).GetString("kiosk.bgOpacity", "Background Opacity");

    /// <summary>Slider low-end caption (web <c>t('kiosk.transparent', 'Transparent')</c>).</summary>
    public static string TransparentLabel(ILocalizer localizer) =>
        Require(localizer).GetString("kiosk.transparent", "Transparent");

    /// <summary>Slider high-end caption (web <c>t('kiosk.solid', 'Solid')</c>).</summary>
    public static string SolidLabel(ILocalizer localizer) =>
        Require(localizer).GetString("kiosk.solid", "Solid");

    /// <summary>Live-preview swatch caption (web <c>t('kiosk.preview', 'Preview — this is how widgets will look')</c>).</summary>
    public static string PreviewText(ILocalizer localizer) =>
        Require(localizer).GetString("kiosk.preview", "Preview \u2014 this is how widgets will look");

    /// <summary>Footer hint (web <c>t('kiosk.hint', …)</c>).</summary>
    public static string HintText(ILocalizer localizer) =>
        Require(localizer).GetString(
            "kiosk.hint",
            "Kiosk mode enters fullscreen and hides all navigation. Move the mouse or touch the screen to reveal the exit button. Press Esc to exit.");

    /// <summary>Primary action label (web <c>t('kiosk.enter', 'Enter Kiosk Mode')</c>).</summary>
    public static string EnterLabel(ILocalizer localizer) =>
        Require(localizer).GetString("kiosk.enter", "Enter Kiosk Mode");

    /// <summary>Dismiss action label (web <c>t('common.cancel', 'Cancel')</c>).</summary>
    public static string CancelLabel(ILocalizer localizer) =>
        Require(localizer).GetString("common.cancel", "Cancel");

    // ── Option labels (web hardcoded option labels, keyed for the native no-literals rule) ───────────────

    /// <summary>"Off" rotation option (web <c>ROTATION_OPTIONS</c> <c>{ value: '0', label: 'Off' }</c>).</summary>
    public static string OffLabel(ILocalizer localizer) =>
        Require(localizer).GetString("kiosk.option.off", "Off");

    /// <summary>"Never" dim-after option (web <c>DIM_AFTER_OPTIONS</c> <c>{ value: '0', label: 'Never' }</c>).</summary>
    public static string NeverLabel(ILocalizer localizer) =>
        Require(localizer).GetString("kiosk.option.never", "Never");

    /// <summary>A seconds option label, e.g. "10s" (web <c>'10s'</c> style), with <paramref name="seconds"/> interpolated.</summary>
    public static string SecondsLabel(ILocalizer localizer, int seconds) =>
        Interpolate(Require(localizer).GetString("kiosk.option.seconds", "{0}s"), seconds);

    /// <summary>A minutes option label, e.g. "5 min" (web <c>'5 min'</c> style), with <paramref name="minutes"/> interpolated.</summary>
    public static string MinutesLabel(ILocalizer localizer, int minutes) =>
        Interpolate(Require(localizer).GetString("kiosk.option.minutes", "{0} min"), minutes);

    /// <summary>The localized label for a clock <paramref name="corner"/> (web <c>CLOCK_POSITION_OPTIONS</c> labels).</summary>
    public static string ClockCornerLabel(ILocalizer localizer, ClockCorner corner) => corner switch
    {
        ClockCorner.TopLeft => Require(localizer).GetString("kiosk.clock.topLeft", "Top Left"),
        ClockCorner.TopRight => Require(localizer).GetString("kiosk.clock.topRight", "Top Right"),
        ClockCorner.BottomLeft => Require(localizer).GetString("kiosk.clock.bottomLeft", "Bottom Left"),
        ClockCorner.BottomRight => Require(localizer).GetString("kiosk.clock.bottomRight", "Bottom Right"),
        _ => Require(localizer).GetString("kiosk.clock.bottomRight", "Bottom Right"),
    };

    /// <summary>Format a percent value, e.g. "75%" (web Slider <c>formatValue=(n)=>`${Math.round(n)}%`</c>).</summary>
    public static string PercentLabel(int percent) =>
        percent.ToString(CultureInfo.CurrentCulture) + "%";

    private static string Interpolate(string template, int value)
    {
        // Mirrors the web template interpolation; the "{0}" slot lets a translation reorder the unit.
        return template.Contains("{0}", StringComparison.Ordinal)
            ? template.Replace("{0}", value.ToString(CultureInfo.CurrentCulture), StringComparison.Ordinal)
            : template;
    }

    private static ILocalizer Require(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer;
    }
}

/// <summary>
/// Pure projections for the <c>KioskSettingsModal</c> surface — the native analogue of the web component's render
/// branches and inline derivations: the progressive-disclosure gates (the dashboards-to-rotate list, the
/// cursor-timeout select, the dimmed-brightness slider and the clock-position select all appear only when their
/// parent control is engaged), the initial rotation selection, the "can't deselect the last dashboard" toggle
/// rule, the four dropdown option projections and the live-preview swatch maths. Kept static and resource-free so
/// it is exhaustively unit-testable without a XAML runtime.
/// </summary>
public static class KioskSettingsModalProjection
{
    /// <summary>
    /// True when the dashboards-to-rotate checklist renders — the native analogue of the web
    /// <c>config.rotateInterval &gt; 0 &amp;&amp; dashboards.length &gt; 1</c> gate (rotation on, and more than one
    /// dashboard to choose between).
    /// </summary>
    public static bool ShouldShowDashboardList(int rotateIntervalSeconds, int dashboardCount) =>
        rotateIntervalSeconds > 0 && dashboardCount > 1;

    /// <summary>True when the cursor-timeout select renders (web <c>config.hideCursor &amp;&amp; (…)</c>).</summary>
    public static bool ShouldShowCursorTimeout(bool hideCursor) => hideCursor;

    /// <summary>True when the dimmed-brightness slider renders (web <c>config.dimAfter &gt; 0 &amp;&amp; (…)</c>).</summary>
    public static bool ShouldShowDimBrightness(int dimAfterMinutes) => dimAfterMinutes > 0;

    /// <summary>True when the clock-position select renders (web <c>config.showClock &amp;&amp; (…)</c>).</summary>
    public static bool ShouldShowClockPosition(bool showClock) => showClock;

    /// <summary>
    /// The initial rotation selection — the native analogue of the web
    /// <c>new Set(config.dashboardIds.length &gt; 0 ? config.dashboardIds : dashboards.map(d =&gt; d.id))</c>: the
    /// saved ids when any were saved, otherwise every dashboard. Unknown saved ids (no matching dashboard) are
    /// dropped so the selection never references a dashboard that is gone.
    /// </summary>
    public static IReadOnlyList<string> InitialSelection(
        IReadOnlyList<string>? savedIds,
        IReadOnlyList<KioskDashboard> dashboards)
    {
        ArgumentNullException.ThrowIfNull(dashboards);
        var known = new HashSet<string>(dashboards.Select(d => d.Id));
        var saved = (savedIds ?? Array.Empty<string>())
            .Where(known.Contains)
            .Distinct()
            .ToList();
        return saved.Count > 0 ? saved : dashboards.Select(d => d.Id).ToList();
    }

    /// <summary>
    /// True when a dashboard may be removed from the rotation selection — the native analogue of the web
    /// <c>if (next.size &gt; 1) next.delete(id)</c> guard: the last selected dashboard cannot be deselected.
    /// </summary>
    public static bool CanDeselect(int selectedCount) => selectedCount > 1;

    /// <summary>
    /// Apply a checklist toggle for <paramref name="id"/> to the current <paramref name="selected"/> set — the
    /// native analogue of the web <c>toggleDashboard</c>: an unselected id is added; a selected id is removed only
    /// while more than one remains (the last one stays). Returns a fresh ordered list (selection order preserved).
    /// </summary>
    public static IReadOnlyList<string> Toggle(IReadOnlyList<string> selected, string id)
    {
        ArgumentNullException.ThrowIfNull(selected);
        var next = new List<string>(selected);
        int index = next.IndexOf(id);
        if (index >= 0)
        {
            if (CanDeselect(next.Count))
            {
                next.RemoveAt(index);
            }
        }
        else
        {
            next.Add(id);
        }

        return next;
    }

    /// <summary>The rotation-interval dropdown options (web <c>ROTATION_OPTIONS</c>): 0 → "Off", &lt; 60 → "{n}s", else "{n} min".</summary>
    public static IReadOnlyList<KioskSelectOption<int>> RotationOptions(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return KioskSettingsModalRegistration.RotationIntervalValues
            .Select(v => new KioskSelectOption<int>(v, RotationLabel(localizer, v)))
            .ToList();
    }

    /// <summary>The cursor auto-hide delay dropdown options (web <c>CURSOR_TIMEOUT_OPTIONS</c>): all "{n}s".</summary>
    public static IReadOnlyList<KioskSelectOption<int>> CursorTimeoutOptions(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return KioskSettingsModalRegistration.CursorTimeoutValues
            .Select(v => new KioskSelectOption<int>(v, KioskSettingsModalRegistration.SecondsLabel(localizer, v)))
            .ToList();
    }

    /// <summary>The screen-dim delay dropdown options (web <c>DIM_AFTER_OPTIONS</c>): 0 → "Never", else "{n} min".</summary>
    public static IReadOnlyList<KioskSelectOption<int>> DimAfterOptions(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return KioskSettingsModalRegistration.DimAfterValues
            .Select(v => new KioskSelectOption<int>(v, DimAfterOptionLabel(localizer, v)))
            .ToList();
    }

    /// <summary>The clock-position dropdown options (web <c>CLOCK_POSITION_OPTIONS</c>): the four corners.</summary>
    public static IReadOnlyList<KioskSelectOption<ClockCorner>> ClockPositionOptions(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return KioskSettingsModalRegistration.ClockCornerOrder
            .Select(c => new KioskSelectOption<ClockCorner>(
                c, KioskSettingsModalRegistration.ClockCornerLabel(localizer, c)))
            .ToList();
    }

    /// <summary>The rotation-interval option label for <paramref name="seconds"/> (web off / seconds / minutes split).</summary>
    public static string RotationLabel(ILocalizer localizer, int seconds)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        if (seconds <= 0)
        {
            return KioskSettingsModalRegistration.OffLabel(localizer);
        }

        return seconds < 60
            ? KioskSettingsModalRegistration.SecondsLabel(localizer, seconds)
            : KioskSettingsModalRegistration.MinutesLabel(localizer, seconds / 60);
    }

    /// <summary>The screen-dim option label for <paramref name="minutes"/> (web never / minutes split).</summary>
    public static string DimAfterOptionLabel(ILocalizer localizer, int minutes)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return minutes <= 0
            ? KioskSettingsModalRegistration.NeverLabel(localizer)
            : KioskSettingsModalRegistration.MinutesLabel(localizer, minutes);
    }

    /// <summary>
    /// Compute the live-preview swatch appearance from the two opacity fractions — the native analogue of the web
    /// preview block's inline <c>rgba()</c> / <c>blur()</c> maths. Inputs are clamped to 0..1 (the web defaults a
    /// missing value to 1 via <c>?? 1</c>); alphas are rounded half-away-from-zero to match JS <c>Math.round</c>.
    /// </summary>
    public static KioskPreview ComputePreview(double widgetOpacity, double backgroundOpacity)
    {
        double widget = Clamp01(widgetOpacity);
        double background = Clamp01(backgroundOpacity);
        byte backgroundAlpha = ToByte(background);
        byte widgetAlpha = ToByte(0.03 + (widget * 0.17));
        double blur = 4 + (widget * 12);
        return new KioskPreview(backgroundAlpha, widgetAlpha, blur);
    }

    /// <summary>Convert an opacity fraction (0..1) to its slider percent (web <c>Math.round(opacity * 100)</c>).</summary>
    public static int OpacityToPercent(double opacity) =>
        (int)Math.Round(Clamp01(opacity) * 100, MidpointRounding.AwayFromZero);

    /// <summary>Convert a slider percent (0..100) back to an opacity fraction (web <c>n / 100</c>).</summary>
    public static double PercentToOpacity(int percent) => percent / 100.0;

    private static double Clamp01(double value)
    {
        if (double.IsNaN(value))
        {
            return 1;
        }

        return value < 0 ? 0 : value > 1 ? 1 : value;
    }

    private static byte ToByte(double fraction)
    {
        double clamped = fraction < 0 ? 0 : fraction > 1 ? 1 : fraction;
        return (byte)Math.Round(clamped * 255, MidpointRounding.AwayFromZero);
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>KioskSettingsModal</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> counter with the surface slug — never any kiosk configuration or dashboard
/// names — so a diagnostics line can never leak user content. Thread-safe.
/// </summary>
public sealed class KioskSettingsModalDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public KioskSettingsModalDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=KioskSettingsModal</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(string.Create(
            CultureInfo.InvariantCulture, $"view.opened slug={KioskSettingsModalRegistration.Slug}"));
    }
}
