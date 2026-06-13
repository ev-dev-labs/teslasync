using System.Globalization;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The accent colour a pill uses for its active fill / dot / underline — the native port of the web
/// <c>PillItem['accent']</c> union (<c>'cyan' | 'green' | 'amber' | 'red' | 'purple' | 'blue'</c>) in
/// <c>web/src/components/forms/PillFilterBar.tsx</c> (L21). <see cref="Cyan"/> is the web default
/// (<c>item.accent ?? 'cyan'</c>, L134) and "matches the rest of the app's neon palette". Each value maps to a
/// brand-palette brush key (see <see cref="PillFilterBarRegistration.AccentBrushKey"/>) so the projection and the
/// view agree on the accent without a UI host.
/// </summary>
public enum PillAccent
{
    /// <summary>web <c>'cyan'</c> — the default accent.</summary>
    Cyan,

    /// <summary>web <c>'green'</c> — the emerald accent.</summary>
    Green,

    /// <summary>web <c>'amber'</c> — the amber accent.</summary>
    Amber,

    /// <summary>web <c>'red'</c> — the rose accent.</summary>
    Red,

    /// <summary>web <c>'purple'</c> — the purple accent.</summary>
    Purple,

    /// <summary>web <c>'blue'</c> — the indigo accent.</summary>
    Blue,
}

/// <summary>
/// The render style of the filter bar — the native port of the web <c>PillFilterBarProps['variant']</c> union
/// (<c>'pills' | 'tabs'</c>) in <c>web/src/components/forms/PillFilterBar.tsx</c> (L37). <see cref="Pills"/> is
/// the web default (rounded-full chips with an active fill + dot); <see cref="Tabs"/> is a flat row with a
/// bottom-border underline on the active item.
/// </summary>
public enum PillFilterBarVariant
{
    /// <summary>web <c>'pills'</c> — rounded-full chips with an active fill and a leading accent dot.</summary>
    Pills,

    /// <summary>web <c>'tabs'</c> — a flat row with a 2px bottom-border underline on the active item.</summary>
    Tabs,
}

/// <summary>
/// The mutually-exclusive content state of the bar. The web source
/// (<c>web/src/components/forms/PillFilterBar.tsx</c>) is a controlled single-select tablist driven entirely by
/// its injected <c>items</c> — it performs no data fetch and has no asynchronous read, so it has no
/// loading / error / stale / offline chrome to reproduce (those belong to data-backed surfaces). The states it
/// actually has are <see cref="Ready"/> (one or more pills render) plus the defensive <see cref="Empty"/> branch
/// so a bar handed an empty <c>items</c> array renders a friendly muted marker rather than a blank box.
/// </summary>
public enum PillFilterBarState
{
    /// <summary>The bar has one or more pills and renders the tablist (the web row of <c>role="tab"</c> buttons).</summary>
    Ready,

    /// <summary>No items resolved — render a friendly, locale-neutral marker (never a blank box).</summary>
    Empty,
}

/// <summary>
/// Description of a single pill — the native port of the web <c>PillItem</c> interface
/// (<c>web/src/components/forms/PillFilterBar.tsx</c> L8-L24: <c>{ key; label; icon?; count?; accent?;
/// disabled? }</c>). The <see cref="Key"/> is the stable identifier written to URL state and passed to the
/// host's <c>onChange</c>; the <see cref="Label"/> is the already-localized visible text (the bar is anonymous —
/// the web source declares no <c>t()</c> calls, so every visible string is caller-composed); the optional
/// <see cref="IconGlyph"/> is the native analogue of the web <c>icon?: ReactNode</c> (a Segoe Fluent glyph rather
/// than a lucide svg); the optional <see cref="Count"/> renders as a muted <c>(12)</c> suffix; the
/// <see cref="Accent"/> drives the active fill/dot/underline (web default cyan); and a <see cref="Disabled"/> pill
/// is skipped during arrow navigation (web <c>enabledKeys</c>).
/// </summary>
public sealed class PillItemDescriptor
{
    /// <summary>Creates a pill descriptor.</summary>
    /// <param name="key">Stable identifier written to URL state / passed to <c>onChange</c> (web <c>key</c>); must be non-empty.</param>
    /// <param name="label">Already-localized visible label (web <c>label</c>).</param>
    /// <param name="iconGlyph">Optional leading Segoe Fluent glyph (the native analogue of web <c>icon</c>); null renders no icon.</param>
    /// <param name="count">Optional muted count suffix (web <c>count</c>); null renders no count.</param>
    /// <param name="accent">Active-state accent (web <c>accent</c>); defaults to <see cref="PillAccent.Cyan"/>.</param>
    /// <param name="disabled">When true the pill is non-interactive and skipped during arrow navigation (web <c>disabled</c>).</param>
    public PillItemDescriptor(
        string key,
        string label,
        string? iconGlyph = null,
        int? count = null,
        PillAccent accent = PillAccent.Cyan,
        bool disabled = false)
    {
        ArgumentException.ThrowIfNullOrEmpty(key);
        ArgumentNullException.ThrowIfNull(label);

        Key = key;
        Label = label;
        IconGlyph = string.IsNullOrEmpty(iconGlyph) ? null : iconGlyph;
        Count = count;
        Accent = accent;
        Disabled = disabled;
    }

    /// <summary>Stable identifier written to URL state and passed to <c>onChange</c> (web <c>key</c>).</summary>
    public string Key { get; }

    /// <summary>The already-localized visible label (web <c>label</c>).</summary>
    public string Label { get; }

    /// <summary>Optional leading Segoe Fluent glyph (native analogue of web <c>icon</c>); null renders no icon.</summary>
    public string? IconGlyph { get; }

    /// <summary>Optional muted count suffix (web <c>count</c>); null renders no count.</summary>
    public int? Count { get; }

    /// <summary>The active-state accent (web <c>accent</c>); defaults to <see cref="PillAccent.Cyan"/>.</summary>
    public PillAccent Accent { get; }

    /// <summary>Whether the pill is non-interactive and skipped during arrow navigation (web <c>disabled</c>).</summary>
    public bool Disabled { get; }

    /// <summary>The brand-palette brush key for this pill's <see cref="Accent"/> (web accent class → token).</summary>
    public string AccentBrushKey => PillFilterBarRegistration.AccentBrushKey(Accent);

    /// <summary>
    /// The pill's full visible/accessible text — the label plus the muted count suffix when present, mirroring
    /// the web button content (<c>{label}{count != null &amp;&amp; ` (${fmtInt(count)})`}</c>). Used as the
    /// pill's Narrator name so assistive tech reads the same text a sighted user sees.
    /// </summary>
    public string AccessibleText => Count is int value
        ? Label + " " + PillFilterBarRegistration.FormatCount(value)
        : Label;
}

/// <summary>
/// Canonical metadata for the PillFilterBar surface — the native mirror of the module-level constants and the
/// accent palette in <c>web/src/components/forms/PillFilterBar.tsx</c>. The web component is anonymous (it
/// declares no <c>t()</c> calls — its only assistive string, <c>ariaLabel</c>, is a required prop the caller
/// supplies already-localized), so this carries no i18n keys; it holds only the diagnostics slug, the automation
/// id, the per-accent brush keys, the count formatter and the geometry constants the view reads. UI-free so it is
/// asserted without a XAML host.
/// </summary>
public static class PillFilterBarRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "PillFilterBar";

    /// <summary>Root automation id — the native fallback for the web <c>data-testid={testId}</c> when no test id is supplied.</summary>
    public const string RootAutomationId = "pill-filter-bar";

    /// <summary>The default accent (web <c>item.accent ?? 'cyan'</c>).</summary>
    public const PillAccent DefaultAccent = PillAccent.Cyan;

    /// <summary>The default render style (web <c>variant = 'pills'</c>).</summary>
    public const PillFilterBarVariant DefaultVariant = PillFilterBarVariant.Pills;

    /// <summary>The default horizontal-overflow scroll behaviour (web <c>scrollable = true</c>).</summary>
    public const bool DefaultScrollable = true;

    /// <summary>Gap between pills in pixels (web <c>gap-1.5</c> = 0.375rem = 6px).</summary>
    public const double PillGap = 6;

    /// <summary>Diameter of the leading active dot in pixels (web <c>h-1.5 w-1.5</c> = 6px).</summary>
    public const double DotDiameter = 6;

    /// <summary>Leading icon edge length in pixels (web <c>[&amp;>svg]:h-3.5</c> = 0.875rem = 14px).</summary>
    public const double IconSize = 14;

    /// <summary>Active-fill opacity for the pills variant (web <c>bg-{accent}-500/15</c>).</summary>
    public const double ActiveFillOpacity = 0.15;

    /// <summary>Active-ring opacity for the pills variant (web <c>ring-{accent}-400/40</c>).</summary>
    public const double ActiveRingOpacity = 0.4;

    /// <summary>Opacity applied to a disabled pill (web <c>opacity-40</c>).</summary>
    public const double DisabledOpacity = 0.4;

    /// <summary>Bottom-underline thickness for the tabs variant in pixels (web <c>border-b-2</c>).</summary>
    public const double TabUnderlineThickness = 2;

    /// <summary>Corner radius for a pills-variant chip in pixels (web <c>rounded-full</c>).</summary>
    public const double PillCornerRadius = 9999;

    /// <summary>Locale-neutral marker rendered for the defensive empty state (an em dash; never English copy).</summary>
    public const string EmptyMarker = "\u2014";

    /// <summary>
    /// The brand-palette brush resource key for an accent — mirrors the web neon-palette accent map (L46-L62) onto
    /// the colour-accurate brand chart brushes from the design tokens (apps/design/tokens.json → Themes/Tokens.xaml),
    /// so the native accent hue matches the web source and stays theme-consistent without a per-accent theme brush.
    /// </summary>
    /// <param name="accent">The pill accent.</param>
    /// <returns>The brush resource key for the accent fill / dot / underline.</returns>
    public static string AccentBrushKey(PillAccent accent) => accent switch
    {
        PillAccent.Cyan => "TsChartRegenBrush",
        PillAccent.Green => "TsChartBatteryBrush",
        PillAccent.Amber => "TsChartEnergyBrush",
        PillAccent.Red => "TsChartTemperatureBrush",
        PillAccent.Purple => "TsChartPowerBrush",
        PillAccent.Blue => "TsChartSpeedBrush",
        _ => "TsChartRegenBrush",
    };

    /// <summary>
    /// Format a pill's count suffix — the native port of the web <c>`(${fmtInt(count)})`</c> (L188). Mirrors
    /// <c>fmtInt</c> (web/src/lib/numberFormat.ts L78 → <c>toLocaleString</c> with zero fraction digits): a
    /// locale-grouped integer wrapped in parentheses, e.g. <c>(12,345)</c>.
    /// </summary>
    /// <param name="count">The count to format.</param>
    /// <returns>The parenthesised, locale-grouped count.</returns>
    public static string FormatCount(int count) =>
        string.Create(CultureInfo.CurrentCulture, $"({count:N0})");
}

/// <summary>
/// PII-safe diagnostics for the PillFilterBar surface (P1/S11 diagnostics contract). A pill key is a low-level
/// filter token (e.g. <c>all</c> / <c>anomalies</c>), but to stay conservatively PII-safe the collector records
/// only the operational <see cref="RecordViewOpened"/> signal and the data-free <see cref="RecordSelectionChanged"/>
/// signal with the surface slug — never a pill key, label or count. Thread-safe; mirrors the shipped surfaces'
/// collectors.
/// </summary>
public sealed class PillFilterBarDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;
    private long _selectionChanges;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the diagnostics lines are written to, or null.</param>
    public PillFilterBarDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Number of times the active pill has changed.</summary>
    public long SelectionChanges => Interlocked.Read(ref _selectionChanges);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=PillFilterBar</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(
            string.Create(CultureInfo.InvariantCulture, $"view.opened slug={PillFilterBarRegistration.Slug}"));
    }

    /// <summary>Record that the active pill changed, emitting <c>pill-filter-bar.selection-changed slug=PillFilterBar</c>.</summary>
    public void RecordSelectionChanged()
    {
        Interlocked.Increment(ref _selectionChanges);
        _sink?.Invoke(
            string.Create(
                CultureInfo.InvariantCulture,
                $"pill-filter-bar.selection-changed slug={PillFilterBarRegistration.Slug}"));
    }
}
