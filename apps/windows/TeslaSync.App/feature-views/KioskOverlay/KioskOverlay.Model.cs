using System.Globalization;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The corner a kiosk clock anchors to — the native union of the web
/// <c>KioskConfig.clockPosition</c> literal (<c>'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'</c>,
/// web/src/features/dashboard/hooks/useKioskMode.ts). Drives the clock overlay's
/// horizontal/vertical alignment exactly as the web component's conditional Tailwind corner classes do
/// (web/src/features/dashboard/components/KioskOverlay.tsx).
/// </summary>
public enum KioskClockCorner
{
    /// <summary>Anchor to the top-left corner (web <c>'top-left'</c>).</summary>
    TopLeft,

    /// <summary>Anchor to the top-right corner (web <c>'top-right'</c>).</summary>
    TopRight,

    /// <summary>Anchor to the bottom-left corner (web <c>'bottom-left'</c>).</summary>
    BottomLeft,

    /// <summary>Anchor to the bottom-right corner (web <c>'bottom-right'</c>) — the web default.</summary>
    BottomRight,
}

/// <summary>
/// The overlay-relevant slice of the web <c>KioskConfig</c> (web/src/features/dashboard/hooks/useKioskMode.ts).
/// The web <see cref="KioskOverlay"/> component reads only four config fields — <c>dimLevel</c>,
/// <c>showClock</c>, <c>clockPosition</c> and <c>rotateInterval</c> — so this record carries exactly those
/// (the remaining kiosk settings are owned by the separate kiosk-settings surface, out of scope here). Pure
/// data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="DimLevel">
/// The retained-brightness fraction (web <c>config.dimLevel</c>, 0..1). The black burn-in layer renders at
/// <c>1 - DimLevel</c> opacity, reproducing the web inline <c>style={{ opacity: 1 - config.dimLevel }}</c>.
/// </param>
/// <param name="ShowClock">Whether the clock overlay renders (web <c>config.showClock</c>).</param>
/// <param name="ClockCorner">Which corner the clock anchors to (web <c>config.clockPosition</c>).</param>
/// <param name="RotateIntervalSeconds">
/// The dashboard auto-rotation interval in seconds (web <c>config.rotateInterval</c>). The rotation dots only
/// render when this is positive (web <c>config.rotateInterval &gt; 0</c>).
/// </param>
public sealed record KioskOverlayConfig(
    double DimLevel,
    bool ShowClock,
    KioskClockCorner ClockCorner,
    int RotateIntervalSeconds)
{
    /// <summary>
    /// The overlay-relevant defaults mirrored from the web <c>DEFAULT_KIOSK_CONFIG</c>
    /// (web/src/features/dashboard/hooks/useKioskMode.ts): <c>dimLevel 0.5</c>, <c>showClock true</c>,
    /// <c>clockPosition 'bottom-right'</c>, <c>rotateInterval 30</c>.
    /// </summary>
    public static KioskOverlayConfig Default { get; } =
        new(DimLevel: 0.5, ShowClock: true, ClockCorner: KioskClockCorner.BottomRight, RotateIntervalSeconds: 30);
}

/// <summary>
/// The runtime inputs the web <see cref="KioskOverlay"/> receives as props (minus the <c>onExit</c> callback,
/// which the native view surfaces as an event): the active <see cref="Config"/>, the live dim / cursor-hidden
/// flags the parent <c>useKioskMode</c> hook computes, and the dashboard rotation position. Immutable so a new
/// snapshot is projected on every change.
/// </summary>
/// <param name="Config">The active overlay configuration (web <c>config</c> prop).</param>
/// <param name="IsDimmed">Whether the burn-in dim layer is active (web <c>isDimmed</c> prop).</param>
/// <param name="IsCursorHidden">Whether the mouse cursor is auto-hidden (web <c>isCursorHidden</c> prop).</param>
/// <param name="DashboardCount">How many dashboards are in the rotation set (web <c>dashboardCount</c> prop).</param>
/// <param name="CurrentIndex">The zero-based index of the visible dashboard (web <c>currentIndex</c> prop).</param>
public sealed record KioskOverlayInputs(
    KioskOverlayConfig Config,
    bool IsDimmed,
    bool IsCursorHidden,
    int DashboardCount,
    int CurrentIndex)
{
    /// <summary>The idle baseline — default config, nothing dimmed/hidden, a single dashboard.</summary>
    public static KioskOverlayInputs Default { get; } =
        new(KioskOverlayConfig.Default, IsDimmed: false, IsCursorHidden: false, DashboardCount: 1, CurrentIndex: 0);
}

/// <summary>
/// The render-ready clock readout — the native projection of the web clock overlay's two lines:
/// <see cref="Time"/> (web <c>formatTime(now)</c>) above <see cref="DateWithDay"/> (web
/// <c>formatDateWithDay(now)</c>), anchored to <see cref="Corner"/>.
/// </summary>
/// <param name="Time">The locale time-of-day, e.g. "02:30 PM" (web <c>formatTime</c>).</param>
/// <param name="DateWithDay">The weekday + short date, e.g. "Mon, Jun 8" (web <c>formatDateWithDay</c>).</param>
/// <param name="Corner">The corner the clock anchors to.</param>
public sealed record KioskClockReadout(string Time, string DateWithDay, KioskClockCorner Corner);

/// <summary>One dashboard-rotation indicator dot; <see cref="IsActive"/> marks the visible dashboard (wider dot).</summary>
/// <param name="IsActive">True for the dot representing the currently visible dashboard (web <c>i === currentIndex</c>).</param>
public sealed record KioskRotationDot(bool IsActive);

/// <summary>
/// The fully-projected, render-ready presentation of the kiosk overlay — the single immutable snapshot the
/// WinUI view paints. Every conditional layer of the web <see cref="KioskOverlay"/> maps to a field here so the
/// view stays a thin renderer and every branch is unit-tested headlessly.
/// </summary>
/// <param name="ShowDim">Whether the burn-in dim layer renders (web <c>isDimmed</c>).</param>
/// <param name="DimOpacity">The dim layer opacity, <c>1 - dimLevel</c> clamped to 0..1 (web inline style).</param>
/// <param name="HideCursor">Whether the mouse cursor is hidden (web <c>isCursorHidden</c>).</param>
/// <param name="ShowClock">Whether the clock overlay renders (web <c>config.showClock</c>).</param>
/// <param name="Clock">The clock readout when <see cref="ShowClock"/>; otherwise <see langword="null"/>.</param>
/// <param name="ShowRotationDots">
/// Whether the rotation dots render (web <c>dashboardCount &gt; 1 &amp;&amp; config.rotateInterval &gt; 0</c>).
/// </param>
/// <param name="RotationDots">The indicator dots, one per dashboard (empty when hidden).</param>
/// <param name="ActiveDotIndex">The index of the active dot, or <c>-1</c> when no dots render.</param>
/// <param name="ExitAriaLabel">The Narrator name for the exit affordance (web <c>aria-label</c> <c>kiosk.exit</c>).</param>
/// <param name="ExitButtonLabel">The visible exit label (web <c>kiosk.exitLabel</c>).</param>
/// <param name="RegionName">The localized accessibility landmark name for the whole overlay.</param>
public sealed record KioskOverlayPresentation(
    bool ShowDim,
    double DimOpacity,
    bool HideCursor,
    bool ShowClock,
    KioskClockReadout? Clock,
    bool ShowRotationDots,
    IReadOnlyList<KioskRotationDot> RotationDots,
    int ActiveDotIndex,
    string ExitAriaLabel,
    string ExitButtonLabel,
    string RegionName);

/// <summary>
/// Locale-aware clock string formatting for the overlay — the native port of the web <c>useDateFormat</c>
/// helpers the clock consumes. <see cref="FormatTime"/> mirrors <c>formatTime</c> (locale time-of-day) by
/// delegating to the shared <see cref="DateTimeFormatting"/> port; <see cref="FormatDateWithDay"/> mirrors
/// <c>formatDateWithDay</c> (<c>{ weekday:'short', month:'short', day:'numeric' }</c>) which the shared port
/// has no variant for, so it is composed here. Both are pure for deterministic tests.
/// </summary>
public static class KioskClockFormat
{
    private static readonly CultureInfo EnUs = CultureInfo.GetCultureInfo("en-US");

    /// <summary>Format the time-of-day exactly as the web <c>formatTime</c> ("02:30 PM").</summary>
    public static string FormatTime(DateTimeOffset value) =>
        DateTimeFormatting.Format(value, DateTimeVariant.Time, value);

    /// <summary>
    /// Format the weekday + short date exactly as the web <c>formatDateWithDay</c>
    /// (<c>{ weekday:'short', month:'short', day:'numeric' }</c>) — e.g. "Mon, Jun 8".
    /// </summary>
    public static string FormatDateWithDay(DateTimeOffset value) =>
        value.LocalDateTime.ToString("ddd, MMM d", EnUs);
}

/// <summary>
/// Pure projection from the prop-shaped <see cref="KioskOverlayInputs"/> (plus the current instant) to the
/// render-ready <see cref="KioskOverlayPresentation"/> — the native analogue of the web
/// <see cref="KioskOverlay"/> component body (its conditional layer JSX). WinUI-free so every branch is
/// asserted without a UI host. The web component performs no data fetch (it reads only <c>useTranslation</c>
/// and <c>useDateFormat</c>), so there are no loading / error / offline / stale data states to mirror — only
/// the composition of the dim, clock, rotation-dot and exit layers, all reproduced here.
/// </summary>
public static class KioskOverlayProjection
{
    /// <summary>
    /// Project <paramref name="inputs"/> at instant <paramref name="now"/>, resolving every label through
    /// <paramref name="localizer"/>. Dim opacity is <c>1 - dimLevel</c> clamped to 0..1; the clock is built
    /// only when <c>showClock</c>; the rotation dots render only when more than one dashboard is rotating;
    /// <paramref name="now"/> drives the clock strings so a per-second tick re-projects the readout.
    /// </summary>
    public static KioskOverlayPresentation Project(
        KioskOverlayInputs inputs,
        DateTimeOffset now,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(inputs);
        ArgumentNullException.ThrowIfNull(localizer);

        KioskOverlayConfig config = inputs.Config;

        bool showDim = inputs.IsDimmed;
        double dimOpacity = showDim ? Clamp01(1.0 - config.DimLevel) : 0.0;

        bool showClock = config.ShowClock;
        KioskClockReadout? clock = showClock
            ? new KioskClockReadout(
                KioskClockFormat.FormatTime(now),
                KioskClockFormat.FormatDateWithDay(now),
                config.ClockCorner)
            : null;

        bool showDots = inputs.DashboardCount > 1 && config.RotateIntervalSeconds > 0;
        (IReadOnlyList<KioskRotationDot> dots, int activeIndex) =
            BuildDots(showDots, inputs.DashboardCount, inputs.CurrentIndex);

        return new KioskOverlayPresentation(
            ShowDim: showDim,
            DimOpacity: dimOpacity,
            HideCursor: inputs.IsCursorHidden,
            ShowClock: showClock,
            Clock: clock,
            ShowRotationDots: showDots,
            RotationDots: dots,
            ActiveDotIndex: activeIndex,
            ExitAriaLabel: KioskOverlayRegistration.ExitAriaLabel(localizer),
            ExitButtonLabel: KioskOverlayRegistration.ExitButtonLabel(localizer),
            RegionName: KioskOverlayRegistration.RegionName(localizer));
    }

    private static (IReadOnlyList<KioskRotationDot> Dots, int ActiveIndex) BuildDots(bool show, int count, int currentIndex)
    {
        if (!show || count <= 0)
        {
            return (Array.Empty<KioskRotationDot>(), -1);
        }

        int active = Math.Clamp(currentIndex, 0, count - 1);
        var dots = new KioskRotationDot[count];
        for (int i = 0; i < count; i++)
        {
            dots[i] = new KioskRotationDot(i == active);
        }

        return (dots, active);
    }

    private static double Clamp01(double value)
    {
        if (double.IsNaN(value))
        {
            return 0.0;
        }

        return Math.Clamp(value, 0.0, 1.0);
    }
}

/// <summary>
/// Canonical metadata for the Kiosk Overlay surface — slug, i18n keys and the icon glyph. The web component
/// renders no visible heading, so the only keyed copy is the exit affordance's accessibility + visible labels
/// (web <c>t('kiosk.exit')</c> / <c>t('kiosk.exitLabel')</c>) and the accessibility landmark name reused from
/// the kiosk nav label (web <c>dashboard.kiosk</c>). Keys are fully namespaced (<c>translation.*</c>) so they
/// resolve through the shell resource pipeline in every shipped language, with the English fallback kept for
/// the headless / missing-resource path.
/// </summary>
public static class KioskOverlayRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "KioskOverlay";

    /// <summary>The Segoe Fluent glyph for the exit affordance (Cancel — the native analogue of the web lucide X).</summary>
    public const string ExitGlyph = "\uE711";

    /// <summary>The i18n key for the exit affordance's Narrator label (web <c>kiosk.exit</c>).</summary>
    public const string ExitAriaKey = "translation.kiosk.exit";

    /// <summary>The i18n key for the exit affordance's visible label (web <c>kiosk.exitLabel</c>).</summary>
    public const string ExitLabelKey = "translation.kiosk.exitLabel";

    /// <summary>The i18n key for the overlay's accessibility landmark name (web <c>dashboard.kiosk</c>).</summary>
    public const string RegionKey = "translation.dashboard.kiosk";

    /// <summary>The localized Narrator label for the exit affordance.</summary>
    public static string ExitAriaLabel(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(ExitAriaKey, "Exit kiosk mode");
    }

    /// <summary>The localized visible label for the exit affordance.</summary>
    public static string ExitButtonLabel(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(ExitLabelKey, "Exit Kiosk");
    }

    /// <summary>The localized accessibility landmark name for the whole overlay.</summary>
    public static string RegionName(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(RegionKey, "Kiosk");
    }
}

/// <summary>
/// PII-safe diagnostics for the Kiosk Overlay surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never any config, time or dashboard value — so
/// a diagnostics line can never leak anything user-specific. Thread-safe.
/// </summary>
public sealed class KioskOverlayDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public KioskOverlayDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=KioskOverlay</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={KioskOverlayRegistration.Slug}");
    }
}

/// <summary>
/// The seam the view drives to reflect the cursor-auto-hide state (web <c>isCursorHidden</c>) onto the
/// platform. Abstracted so the idempotent transition logic is unit-tested without touching real Win32 input,
/// and so the headless test project never links the native effect.
/// </summary>
public interface IKioskCursorController
{
    /// <summary>Hide (<see langword="true"/>) or show (<see langword="false"/>) the mouse cursor.</summary>
    void SetCursorHidden(bool hidden);
}

/// <summary>
/// Idempotent cursor-visibility controller — the native equivalent of the web component's cursor-hiding layer
/// (which injects <c>cursor: none</c> CSS over the kiosk root). It applies the raw show/hide effect (supplied
/// as <c>applyHidden</c>) only on an actual state transition, so the underlying Win32 visibility counter is
/// never driven out of balance no matter how often the projection re-emits the same flag. Pure of any
/// WinUI/Win32 dependency so the transition logic is unit-tested with a recording action.
/// </summary>
public sealed class KioskCursorController : IKioskCursorController
{
    private readonly Action<bool> _applyHidden;
    private bool _hidden;

    /// <summary>Creates the controller over the raw effect that actually hides/shows the cursor.</summary>
    public KioskCursorController(Action<bool> applyHidden)
    {
        ArgumentNullException.ThrowIfNull(applyHidden);
        _applyHidden = applyHidden;
    }

    /// <summary>Whether the cursor is currently hidden by this controller.</summary>
    public bool IsHidden => _hidden;

    /// <inheritdoc />
    public void SetCursorHidden(bool hidden)
    {
        if (hidden == _hidden)
        {
            return;
        }

        _hidden = hidden;
        _applyHidden(hidden);
    }
}
