namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata + i18n keys for the <c>FullscreenButton</c> shared surface — the native mirror of the web
/// <c>FullscreenButton</c> primitive (web/src/components/ui/FullscreenButton.tsx). The web component is a single
/// ghost icon-button that toggles the browser Fullscreen API on a target element, swapping its icon + accessible
/// label between an "Enter fullscreen" maximise affordance and an "Exit fullscreen" minimise affordance, and
/// hiding itself entirely when the platform reports no fullscreen support (web <c>if (!supported) return null;</c>).
/// This metadata carries the diagnostics slug the surface registers under, every render-contract i18n key/fallback
/// the web source passes to <c>t()</c> (<c>common.fullscreen.enter</c> / <c>common.fullscreen.exit</c>), the Segoe
/// Fluent glyphs that stand in for the web <c>Maximize</c> / <c>Minimize</c> lucide icons, the
/// <c>data-fullscreen-state</c> attribute values (web <c>'on'</c> / <c>'off'</c>) and the test automation id
/// (web <c>data-testid</c>) — so the native surface reproduces the web copy + states verbatim. Every key carries
/// the <c>translation.</c> catalog prefix the WinUI resource bridge expects (the convention every shipped surface
/// uses) and resolves against the English fallback headlessly. UI-free so it is asserted without a XAML host.
/// </summary>
public static class FullscreenButtonRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "FullscreenButton";

    /// <summary>i18n key for the enter-fullscreen label (web <c>common.fullscreen.enter</c>).</summary>
    public const string EnterKey = "translation.common.fullscreen.enter";

    /// <summary>English fallback for <see cref="EnterKey"/> (web second arg, verbatim).</summary>
    public const string EnterFallback = "Enter fullscreen";

    /// <summary>i18n key for the exit-fullscreen label (web <c>common.fullscreen.exit</c>).</summary>
    public const string ExitKey = "translation.common.fullscreen.exit";

    /// <summary>English fallback for <see cref="ExitKey"/> (web second arg, verbatim).</summary>
    public const string ExitFallback = "Exit fullscreen";

    /// <summary>
    /// Segoe Fluent "FullScreen" glyph shown while NOT fullscreen — the native stand-in for the web
    /// <c>Maximize</c> lucide icon (the "enter fullscreen" affordance).
    /// </summary>
    public const string EnterGlyph = "\uE740";

    /// <summary>
    /// Segoe Fluent "BackToWindow" glyph shown while fullscreen — the native stand-in for the web
    /// <c>Minimize</c> lucide icon (the "exit fullscreen" affordance).
    /// </summary>
    public const string ExitGlyph = "\uE73F";

    /// <summary>The <c>data-fullscreen-state</c> value while the target is fullscreen (web <c>'on'</c>).</summary>
    public const string StateOn = "on";

    /// <summary>The <c>data-fullscreen-state</c> value while the target is not fullscreen (web <c>'off'</c>).</summary>
    public const string StateOff = "off";

    /// <summary>
    /// The automation id the surface exposes for UI tests — the native analogue of the web
    /// <c>data-testid="fullscreen-button"</c>.
    /// </summary>
    public const string AutomationId = "fullscreen-button";
}

/// <summary>
/// PII-safe diagnostics for the <c>FullscreenButton</c> surface (P1/S11 diagnostics contract). The surface
/// carries no user data — only the boolean fullscreen toggle state — so the collector emits ONLY the operational
/// <see cref="RecordViewOpened"/> signal with the surface slug, never any view content or target identity.
/// Thread-safe; mirrors the shipped surfaces' collectors.
/// </summary>
public sealed class FullscreenButtonDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional sink the operational event line is written to.</param>
    public FullscreenButtonDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=FullscreenButton</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={FullscreenButtonRegistration.Slug}");
    }
}
