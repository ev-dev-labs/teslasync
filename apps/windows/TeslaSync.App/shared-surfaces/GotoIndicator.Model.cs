using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata for the <c>GotoIndicator</c> shared surface — the native mirror of the literals in
/// <c>web/src/components/feedback/GotoIndicator.tsx</c>. The web component is a small, transient keyboard-chord
/// hint: while the "go to" leader key is armed it floats a bottom-centre overlay reading the localized
/// <c>t('shortcuts.goto', 'Go to...')</c> label followed by two <c>&lt;kbd&gt;</c> key-caps (<c>g</c> then
/// <c>?</c>) joined by a <c>+</c>, and when the chord is not armed it renders nothing (<c>if (!visible) return
/// null</c>). It reads no data — its only hook is <c>useTranslation</c> and its only input is the <c>visible</c>
/// prop owned by the parent shortcut layer — so there is no fetch-driven loading / empty / error / stale /
/// offline chrome to reproduce; the surface's states are exactly the web ones: hidden (not armed) and shown
/// (armed). This holder pins the diagnostics slug, the single i18n key + its verbatim English fallback, the three
/// literal key-cap glyphs (which are physical keyboard keys, never translated — they match the web
/// <c>&lt;kbd&gt;</c> text exactly), the surface automation id, and the token brush keys the overlay / border /
/// label / key-caps tint through. It also composes the Narrator name and resolves the label. UI-free so the
/// mapping is asserted headlessly without a XAML runtime.
/// </summary>
public static class GotoIndicatorRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "GotoIndicator";

    /// <summary>i18n key for the lead-in label (web <c>t('shortcuts.goto', ...)</c> at GotoIndicator.tsx L16).</summary>
    public const string LabelKey = "translation.shortcuts.goto";

    /// <summary>English fallback for <see cref="LabelKey"/> — the web component's inline default value, verbatim.</summary>
    public const string LabelFallback = "Go to...";

    /// <summary>The first key-cap glyph (web first <c>&lt;kbd&gt;g&lt;/kbd&gt;</c>) — a physical key, never localized.</summary>
    public const string LeadingKeyCap = "g";

    /// <summary>The chord separator between the two key-caps (web <c>&lt;span&gt;+&lt;/span&gt;</c>).</summary>
    public const string KeyChordSeparator = "+";

    /// <summary>The second key-cap glyph (web second <c>&lt;kbd&gt;?&lt;/kbd&gt;</c>) — a physical key, never localized.</summary>
    public const string ChordKeyCap = "?";

    /// <summary>Automation id the surface exposes so Narrator / UI automation can resolve the transient hint.</summary>
    public const string RootAutomationId = "goto-indicator";

    /// <summary>Token brush key for the translucent overlay background (web <c>bg-[var(--surface-overlay)]</c>).</summary>
    public const string OverlayBrushKey = "TsSurfaceOverlayBrush";

    /// <summary>Token brush key for the hairline border (web <c>border-[var(--border-subtle)]</c>).</summary>
    public const string BorderBrushKey = "TsColorBorderBrush";

    /// <summary>Token brush key for the lead-in label and the <c>+</c> separator (web <c>text-[var(--text-muted)]</c>).</summary>
    public const string LabelBrushKey = "TsColorTextMutedBrush";

    /// <summary>Token brush key for the key-cap chip background (web <c>bg-[var(--surface-2)]</c>).</summary>
    public const string KeyCapBackgroundBrushKey = "TsColorSurfaceBrush";

    /// <summary>Token brush key for the key-cap chip text (web <c>text-[var(--text-secondary)]</c>).</summary>
    public const string KeyCapForegroundBrushKey = "TsColorTextSecondaryBrush";

    /// <summary>Token brush key for the overlay's primary text colour (web <c>text-[var(--text-primary)]</c>).</summary>
    public const string PrimaryTextBrushKey = "TsColorTextPrimaryBrush";

    /// <summary>Resolve the localized lead-in label (web <c>t('shortcuts.goto', 'Go to...')</c>).</summary>
    /// <param name="localizer">The i18n facade the label resolves through.</param>
    public static string ResolveLabel(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(LabelKey, LabelFallback);
    }

    /// <summary>
    /// Compose the accessible name Narrator reads for the armed hint — the natural reading order of the web
    /// content: the lead-in label, then the two key-caps joined by the separator (e.g. "Go to... g + ?"). The
    /// key-caps are decorative glyphs on screen, so the surface carries the whole hint as one announcement.
    /// </summary>
    /// <param name="label">The resolved lead-in label (web <c>t('shortcuts.goto', ...)</c>).</param>
    public static string ComposeAccessibleName(string label)
    {
        ArgumentNullException.ThrowIfNull(label);
        return string.Join(' ', label, LeadingKeyCap, KeyChordSeparator, ChordKeyCap);
    }
}

/// <summary>
/// Whether the <c>GotoIndicator</c> hint is rendered — the native discriminator for the web component's single
/// conditional (<c>web/src/components/feedback/GotoIndicator.tsx</c> L10): when the chord leader is armed the
/// overlay is shown, otherwise the component returns <c>null</c> and nothing is rendered. Because the surface
/// reads no data, these two are its only states (there is no loading / empty / error / stale / offline branch in
/// the source to reproduce).
/// </summary>
public enum GotoIndicatorVisibility
{
    /// <summary>The leader is not armed — the overlay is collapsed (web <c>if (!visible) return null</c>).</summary>
    Hidden,

    /// <summary>The leader is armed — the overlay is rendered (web <c>return &lt;div&gt;…&lt;/div&gt;</c>).</summary>
    Shown,
}

/// <summary>
/// Pure decision for whether the hint renders, given the parent's <c>visible</c> flag — the native port of the
/// web component's <c>if (!visible) return null</c> guard (<c>GotoIndicator.tsx</c> L10). A true flag yields
/// <see cref="GotoIndicatorVisibility.Shown"/>; a false flag yields <see cref="GotoIndicatorVisibility.Hidden"/>.
/// No WinUI types — unit-tested without a UI host.
/// </summary>
public static class GotoIndicatorVisibilityPolicy
{
    /// <summary>Decide the render state for an armed (<paramref name="visible"/> true) or disarmed leader.</summary>
    /// <param name="visible">Whether the parent shortcut layer has armed the chord (web <c>visible</c> prop).</param>
    public static GotoIndicatorVisibility Decide(bool visible) =>
        visible ? GotoIndicatorVisibility.Shown : GotoIndicatorVisibility.Hidden;
}

/// <summary>
/// PII-safe diagnostics for the <c>GotoIndicator</c> surface (P1/S11 diagnostics contract). The surface carries
/// no user content — only the localized static hint label and a physical-key chord — so the collector records
/// only operational counters with the surface slug: the <c>view.opened</c> event the prompt requires, plus the
/// armed / disarmed transitions of the hint. No label text or route is ever passed, so a diagnostics line can
/// never leak fleet state. Thread-safe; mirrors the peer surfaces' diagnostics collectors.
/// </summary>
public sealed class GotoIndicatorDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;
    private long _shown;
    private long _hidden;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the operational lines are written to, or null.</param>
    public GotoIndicatorDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Number of times the hint has been armed (became visible).</summary>
    public long Shown => Interlocked.Read(ref _shown);

    /// <summary>Number of times the hint has been disarmed (became hidden).</summary>
    public long Hidden => Interlocked.Read(ref _hidden);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=GotoIndicator</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={GotoIndicatorRegistration.Slug}");
    }

    /// <summary>Record that the hint became visible, emitting <c>goto.shown slug=GotoIndicator</c>.</summary>
    public void RecordShown()
    {
        Interlocked.Increment(ref _shown);
        _sink?.Invoke($"goto.shown slug={GotoIndicatorRegistration.Slug}");
    }

    /// <summary>Record that the hint became hidden, emitting <c>goto.hidden slug=GotoIndicator</c>.</summary>
    public void RecordHidden()
    {
        Interlocked.Increment(ref _hidden);
        _sink?.Invoke($"goto.hidden slug={GotoIndicatorRegistration.Slug}");
    }
}
