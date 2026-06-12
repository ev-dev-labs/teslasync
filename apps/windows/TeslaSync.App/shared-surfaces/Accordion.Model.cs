using TeslaSync.App.Core.Motion;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata for the <c>Accordion</c> shared surface — the native mirror of the module-level
/// constants in <c>web/src/components/ui/Accordion.tsx</c>. The web component is a collapsible disclosure
/// section: a header row (an optional leading icon, the title, an optional badge, optional trailing header
/// content) over an animated body reveal, driven by a controlled-or-uncontrolled open flag. This carries the
/// diagnostics slug, the token brush / corner keys the surface tints through (the web
/// <c>text-[var(--text-primary)]</c> title, <c>text-[var(--text-muted)]</c> icon, <c>border-white/[0.06]</c>
/// hairline and <c>rounded-xl</c> radius), the default header / body padding (web <c>px-4 py-3</c>), the body
/// reveal duration (web framer-motion <c>0.2</c>s) and the collapsed / expanded chevron rotation the native
/// disclosure chevron reproduces (web <c>ChevronDown</c> + <c>rotate-180</c>). UI-free so the mapping is
/// asserted in tests without a XAML runtime.
/// </summary>
public static class AccordionRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "Accordion";

    /// <summary>Token brush key for the title text (web <c>text-[var(--text-primary)]</c>).</summary>
    public const string TitleBrushKey = "TsColorTextPrimaryBrush";

    /// <summary>Token brush key for the leading icon (web <c>text-[var(--text-muted)]</c>).</summary>
    public const string IconBrushKey = "TsColorTextMutedBrush";

    /// <summary>Token brush key for the outer hairline + body divider (web <c>border-white/[0.06]</c> / <c>/[0.04]</c>).</summary>
    public const string BorderBrushKey = "TsColorBorderBrush";

    /// <summary>Corner-radius token key for the outer container (web <c>rounded-xl</c> ≈ 12&#160;px).</summary>
    public const string CornerRadiusKey = "TsRadiusMd";

    /// <summary>Body reveal duration in milliseconds at full motion (web framer-motion <c>transition={{ duration: 0.2 }}</c>).</summary>
    public const int BodyRevealDurationMs = 200;

    /// <summary>The chevron rotation when collapsed (web resting <c>ChevronDown</c>); the native disclosure chevron reproduces this.</summary>
    public const double ChevronCollapsedRotationDegrees = 0;

    /// <summary>The chevron rotation when expanded (web <c>open &amp;&amp; rotate-180</c>); the native disclosure chevron reproduces this.</summary>
    public const double ChevronExpandedRotationDegrees = 180;

    /// <summary>The default header / body padding (web <c>px-4 py-3</c> — 16&#160;px horizontal, 12&#160;px vertical).</summary>
    public static AccordionPadding DefaultContentPadding { get; } = AccordionPadding.Symmetric(horizontal: 16, vertical: 12);
}

/// <summary>
/// A four-sided padding value, the UI-free analogue of a WinUI <c>Thickness</c> — kept WinUI-free so the web
/// <c>px-4 py-3</c> defaults and any caller override (web <c>headerClassName</c> / <c>bodyClassName</c>) are
/// asserted in tests without a XAML runtime. The view maps it to a <c>Thickness</c> at the platform boundary.
/// </summary>
/// <param name="Left">The left inset in pixels.</param>
/// <param name="Top">The top inset in pixels.</param>
/// <param name="Right">The right inset in pixels.</param>
/// <param name="Bottom">The bottom inset in pixels.</param>
public readonly record struct AccordionPadding(double Left, double Top, double Right, double Bottom)
{
    /// <summary>A symmetric padding (web <c>px-{h} py-{v}</c>): the same horizontal inset left + right, the same vertical inset top + bottom.</summary>
    /// <param name="horizontal">The left + right inset in pixels.</param>
    /// <param name="vertical">The top + bottom inset in pixels.</param>
    public static AccordionPadding Symmetric(double horizontal, double vertical) =>
        new(horizontal, vertical, horizontal, vertical);

    /// <summary>A uniform padding — the same inset on every side.</summary>
    /// <param name="all">The inset applied to every side in pixels.</param>
    public static AccordionPadding Uniform(double all) => new(all, all, all, all);
}

/// <summary>
/// The render-time data model the <c>Accordion</c> view binds to — the native analogue of the web
/// <c>AccordionProps</c> (<c>Accordion.tsx</c> L6-27). The web component is purely presentational: its parent
/// owns any data fetching and feeds an already-resolved title, icon, badge and body, so — exactly like React
/// re-rendering the element with already-resolved props — there is no fetch-driven loading / error / stale /
/// offline branch to reproduce here; the only state is open vs. collapsed (carried by
/// <see cref="AccordionViewModel"/>) plus the optional icon / badge / header-extra composition. The arbitrary
/// React nodes (<c>icon</c> / <c>badge</c> / <c>headerExtra</c> / <c>children</c>) are surfaced as content slots
/// on the view; this model carries the WinUI-free data (the title, the optional leading glyph, whether a badge /
/// header-extra slot is filled, the initial open flag, the padding overrides and the test id) so the projection
/// is unit-tested without a UI host.
/// </summary>
public sealed record AccordionModel
{
    private AccordionModel(
        string title,
        string? iconGlyph,
        bool hasBadge,
        bool hasHeaderExtra,
        bool defaultOpen,
        AccordionPadding headerPadding,
        AccordionPadding bodyPadding,
        string? testId)
    {
        Title = title;
        IconGlyph = iconGlyph;
        HasBadge = hasBadge;
        HasHeaderExtra = hasHeaderExtra;
        DefaultOpen = defaultOpen;
        HeaderPadding = headerPadding;
        BodyPadding = bodyPadding;
        TestId = testId;
    }

    /// <summary>The header title text (web <c>title</c>).</summary>
    public string Title { get; }

    /// <summary>Optional leading Segoe Fluent glyph (web <c>icon</c>); null renders no icon — the web never auto-adds one.</summary>
    public string? IconGlyph { get; }

    /// <summary>Whether a trailing badge slot is filled (web <c>badge</c> present).</summary>
    public bool HasBadge { get; }

    /// <summary>Whether a trailing header-extra slot is filled (web <c>headerExtra</c> present, e.g. inline search).</summary>
    public bool HasHeaderExtra { get; }

    /// <summary>The initial open state for the uncontrolled mode (web <c>defaultOpen</c>, default <c>false</c>).</summary>
    public bool DefaultOpen { get; }

    /// <summary>Header padding (web <c>headerClassName</c> override; default <c>px-4 py-3</c>).</summary>
    public AccordionPadding HeaderPadding { get; }

    /// <summary>Body padding (web <c>bodyClassName</c> override; default <c>px-4 py-3</c>).</summary>
    public AccordionPadding BodyPadding { get; }

    /// <summary>Optional automation id mirroring a web test hook (→ <c>AutomationProperties.AutomationId</c>).</summary>
    public string? TestId { get; }

    /// <summary>An empty, collapsed accordion — the safe default the view falls back to when no model is supplied.</summary>
    public static AccordionModel Empty { get; } = Create(string.Empty);

    /// <summary>Build an accordion model.</summary>
    /// <param name="title">The header title text (web <c>title</c>).</param>
    /// <param name="iconGlyph">Optional leading Segoe Fluent glyph (web <c>icon</c>).</param>
    /// <param name="hasBadge">Whether a trailing badge slot is filled (web <c>badge</c>).</param>
    /// <param name="hasHeaderExtra">Whether a trailing header-extra slot is filled (web <c>headerExtra</c>).</param>
    /// <param name="defaultOpen">The initial open state for the uncontrolled mode (web <c>defaultOpen</c>).</param>
    /// <param name="headerPadding">Header padding override (web <c>headerClassName</c>); null uses the default.</param>
    /// <param name="bodyPadding">Body padding override (web <c>bodyClassName</c>); null uses the default.</param>
    /// <param name="testId">Optional automation id (web test hook).</param>
    public static AccordionModel Create(
        string title,
        string? iconGlyph = null,
        bool hasBadge = false,
        bool hasHeaderExtra = false,
        bool defaultOpen = false,
        AccordionPadding? headerPadding = null,
        AccordionPadding? bodyPadding = null,
        string? testId = null)
    {
        ArgumentNullException.ThrowIfNull(title);
        return new AccordionModel(
            title,
            iconGlyph,
            hasBadge,
            hasHeaderExtra,
            defaultOpen,
            headerPadding ?? AccordionRegistration.DefaultContentPadding,
            bodyPadding ?? AccordionRegistration.DefaultContentPadding,
            testId);
    }
}

/// <summary>
/// The fully projected, render-ready view of an <see cref="AccordionModel"/> at a given open state — everything
/// the web component derives before returning JSX (<c>Accordion.tsx</c> L50-83): the title and its
/// <see cref="TitleBrushKey"/>, the optional leading <see cref="IconGlyph"/> + its <see cref="IconBrushKey"/>,
/// whether the badge / header-extra slots render, the resolved <see cref="IsOpen"/> / <see cref="IsBodyVisible"/>
/// (web <c>open &amp;&amp; ...</c>), the <see cref="ChevronRotationDegrees"/> the disclosure chevron points to
/// (web <c>open &amp;&amp; rotate-180</c>), the header / body padding, the outer <see cref="BorderBrushKey"/> +
/// <see cref="CornerRadiusKey"/>, the composed <see cref="AutomationName"/> Narrator reads and the optional
/// <see cref="AutomationId"/>. Pure data so every value is asserted headlessly.
/// </summary>
/// <param name="Title">The header title text (web <c>title</c>).</param>
/// <param name="TitleBrushKey">Token brush key for the title (web <c>text-[var(--text-primary)]</c>).</param>
/// <param name="HasIcon">True when a leading icon is shown (web <c>icon &amp;&amp; ...</c>).</param>
/// <param name="IconGlyph">The optional leading glyph (web <c>icon</c>); null when absent.</param>
/// <param name="IconBrushKey">Token brush key for the icon (web <c>text-[var(--text-muted)]</c>).</param>
/// <param name="HasBadge">True when the trailing badge slot renders (web <c>badge</c>).</param>
/// <param name="HasHeaderExtra">True when the trailing header-extra slot renders (web <c>headerExtra</c>).</param>
/// <param name="IsOpen">The resolved open state.</param>
/// <param name="IsBodyVisible">True when the body is revealed (web <c>open &amp;&amp; &lt;motion.div&gt;</c>); equals <see cref="IsOpen"/>.</param>
/// <param name="ChevronRotationDegrees">The chevron rotation the disclosure points to (0 collapsed, 180 expanded — web <c>rotate-180</c>).</param>
/// <param name="HeaderPadding">The header padding (web <c>headerClassName</c> default <c>px-4 py-3</c>).</param>
/// <param name="BodyPadding">The body padding (web <c>bodyClassName</c> default <c>px-4 py-3</c>).</param>
/// <param name="BorderBrushKey">Token brush key for the outer hairline + body divider (web <c>border-white/[0.06]</c>).</param>
/// <param name="CornerRadiusKey">Corner-radius token key for the outer container (web <c>rounded-xl</c>).</param>
/// <param name="AutomationName">The accessible name Narrator reads for the disclosure (the title).</param>
/// <param name="AutomationId">The optional automation id (web test hook); null when not supplied.</param>
public sealed record AccordionDisplay(
    string Title,
    string TitleBrushKey,
    bool HasIcon,
    string? IconGlyph,
    string IconBrushKey,
    bool HasBadge,
    bool HasHeaderExtra,
    bool IsOpen,
    bool IsBodyVisible,
    double ChevronRotationDegrees,
    AccordionPadding HeaderPadding,
    AccordionPadding BodyPadding,
    string BorderBrushKey,
    string CornerRadiusKey,
    string AutomationName,
    string? AutomationId);

/// <summary>
/// Pure projection from an <see cref="AccordionModel"/> + the resolved open state to its
/// <see cref="AccordionDisplay"/> — the native port of <c>web/src/components/ui/Accordion.tsx</c>. Reproduces
/// the web derivations exactly: the title tints with the primary text token and the icon with the muted token;
/// the icon renders only when a glyph is supplied (web <c>icon &amp;&amp; ...</c>); the body is revealed and the
/// chevron points to 180° only while open (web <c>open &amp;&amp; &lt;motion.div&gt;</c> / <c>open &amp;&amp;
/// rotate-180</c>); the header / body padding pass through (web <c>headerClassName</c> / <c>bodyClassName</c>);
/// and the accessible name is the title (the natural Narrator label for the disclosure). No WinUI types — so the
/// projection is unit-tested without a UI host.
/// </summary>
public static class AccordionProjection
{
    /// <summary>Leading icon font size — web <c>h-4 w-4</c> (≈16&#160;px).</summary>
    public const double IconSize = 16;

    /// <summary>Title font size — web <c>text-sm</c> (0.875rem ≈ 14&#160;px).</summary>
    public const double TitleFontSize = 14;

    /// <summary>Spacing between the header items — web <c>gap-3</c> (≈12&#160;px).</summary>
    public const double HeaderItemSpacing = 12;

    /// <summary>Project <paramref name="model"/> at <paramref name="isOpen"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web props).</param>
    /// <param name="isOpen">The resolved open state (from <see cref="AccordionViewModel"/>).</param>
    /// <param name="localizer">The i18n facade (P1/S10); reserved for parity with the surface family — this anonymous surface carries no inherent strings, so the title / badge / header-extra content is caller-supplied and already localized.</param>
    /// <returns>The render-ready display model.</returns>
    public static AccordionDisplay Project(AccordionModel model, bool isOpen, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        bool hasIcon = !string.IsNullOrEmpty(model.IconGlyph);

        return new AccordionDisplay(
            Title: model.Title,
            TitleBrushKey: AccordionRegistration.TitleBrushKey,
            HasIcon: hasIcon,
            IconGlyph: hasIcon ? model.IconGlyph : null,
            IconBrushKey: AccordionRegistration.IconBrushKey,
            HasBadge: model.HasBadge,
            HasHeaderExtra: model.HasHeaderExtra,
            IsOpen: isOpen,
            IsBodyVisible: isOpen,
            ChevronRotationDegrees: isOpen
                ? AccordionRegistration.ChevronExpandedRotationDegrees
                : AccordionRegistration.ChevronCollapsedRotationDegrees,
            HeaderPadding: model.HeaderPadding,
            BodyPadding: model.BodyPadding,
            BorderBrushKey: AccordionRegistration.BorderBrushKey,
            CornerRadiusKey: AccordionRegistration.CornerRadiusKey,
            AutomationName: model.Title,
            AutomationId: model.TestId);
    }
}

/// <summary>
/// Pure reduce-motion gating for the body reveal — the native analogue of the web framer-motion entrance
/// (<c>Accordion.tsx</c> L67-79: <c>opacity 0 → 1</c> over <c>0.2</c>s). The native disclosure animates its own
/// height + chevron and already honours the OS "show animations" setting at the platform layer; this gates the
/// surface's additional body fade so that, under reduced motion, the revealed body appears immediately in its
/// final state (the duration collapses to 0&#160;ms, mirroring framer-motion's <c>initial={false}</c>). Kept
/// static + WinUI-free so the policy is unit-tested without a <c>UISettings</c> host.
/// </summary>
public static class AccordionMotion
{
    /// <summary>
    /// The effective body-reveal fade duration in milliseconds: <see cref="AccordionRegistration.BodyRevealDurationMs"/>
    /// at full motion, 0 under reduced motion.
    /// </summary>
    /// <param name="reduceMotion">Whether the OS reduce-motion preference is set (web <c>prefers-reduced-motion</c>).</param>
    public static int BodyRevealDurationMs(bool reduceMotion) =>
        MotionDuration.Resolve(reduceMotion, AccordionRegistration.BodyRevealDurationMs);

    /// <summary>Whether the body fade should run at all — false under reduced motion (render the final state immediately).</summary>
    /// <param name="reduceMotion">Whether the OS reduce-motion preference is set (web <c>prefers-reduced-motion</c>).</param>
    public static bool ShouldAnimateBody(bool reduceMotion) => MotionDuration.ShouldAnimate(reduceMotion);
}

/// <summary>
/// PII-safe diagnostics for the <c>Accordion</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never the title or body content — so a
/// diagnostics line can never leak fleet state. Thread-safe; mirrors the peer surfaces' diagnostics collectors.
/// </summary>
public sealed class AccordionDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional sink the operational event line is written to.</param>
    public AccordionDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=Accordion</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={AccordionRegistration.Slug}");
    }
}
