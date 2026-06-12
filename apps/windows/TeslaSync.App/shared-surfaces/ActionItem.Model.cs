using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces.ActionItemSurface;

/// <summary>
/// Canonical metadata for the <c>ActionItem</c> shared surface — the native mirror of the module-level
/// constants in <c>web/src/components/status/ActionItem.tsx</c> (the <c>SEVERITY_CFG</c> table and the
/// <c>ActionCTA</c> render branches). Carries the diagnostics slug, the two ARIA roles the optional CTA selects
/// between (a navigation <c>link</c> from <c>cta.to</c>, or an action <c>button</c> from <c>cta.onClick</c>), the
/// trailing Segoe Fluent chevron glyph standing in for the web Lucide <c>ChevronRight</c>, the token brush keys
/// the title / description text resolve through (the web <c>--text-primary</c> / <c>--text-secondary</c> vars),
/// and the severity → shared <see cref="CalloutVariant"/> mapping that yields the accent brush + leading glyph.
/// UI-free so the mapping is asserted in tests without a XAML runtime.
/// </summary>
public static class ActionItemRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "ActionItem";

    /// <summary>ARIA role for the in-app action branch (web <c>&lt;button&gt;</c> from <c>cta.onClick</c>).</summary>
    public const string ButtonRole = "button";

    /// <summary>ARIA role for the navigation branch (web <c>&lt;a&gt;</c> / react-router <c>&lt;Link&gt;</c> from <c>cta.to</c>).</summary>
    public const string LinkRole = "link";

    /// <summary>Segoe Fluent "ChevronRight" glyph — the native stand-in for the web Lucide <c>ChevronRight</c> on the CTA.</summary>
    public const string ChevronGlyph = "\uE76C";

    /// <summary>Token brush key for the title text (web <c>text-[var(--text-primary)]</c>).</summary>
    public const string PrimaryTextBrushKey = "TsColorTextPrimaryBrush";

    /// <summary>Token brush key for the description sub-line (web <c>text-[var(--text-secondary)]</c>).</summary>
    public const string SecondaryTextBrushKey = "TsColorTextSecondaryBrush";

    /// <summary>The shared callout variant a severity maps to (web info / warn / error → Info / Warning / Danger).</summary>
    /// <param name="severity">The action severity (web <c>severity</c>).</param>
    public static CalloutVariant Variant(ActionSeverity severity) => severity switch
    {
        ActionSeverity.Warn => CalloutVariant.Warning,
        ActionSeverity.Error => CalloutVariant.Danger,
        _ => CalloutVariant.Info,
    };

    /// <summary>The shared accent brush key for a severity — the web <c>SEVERITY_CFG[severity].text</c> / ring / bg accent.</summary>
    /// <param name="severity">The action severity (web <c>severity</c>).</param>
    public static string AccentBrushKey(ActionSeverity severity) => CalloutVariants.AccentBrushKey(Variant(severity));

    /// <summary>The leading Segoe Fluent glyph for a severity — the web <c>SEVERITY_CFG[severity].icon</c> (Info / AlertTriangle / AlertCircle).</summary>
    /// <param name="severity">The action severity (web <c>severity</c>).</param>
    public static string Glyph(ActionSeverity severity) => CalloutVariants.Glyph(Variant(severity));
}

/// <summary>
/// The severity tier of an action — the native mirror of the web <c>ActionSeverity</c> union
/// (<c>'info' | 'warn' | 'error'</c> in <c>web/src/components/status/ActionItem.tsx</c> L14). Drives the leading
/// icon, the accent colour of the icon / CTA text, and the card's background tint + ring, via the shared
/// <see cref="CalloutVariant"/> mapping in <see cref="ActionItemRegistration.Variant"/>.
/// </summary>
public enum ActionSeverity
{
    /// <summary>web <c>'info'</c> — a neutral suggestion (blue Info glyph).</summary>
    Info,

    /// <summary>web <c>'warn'</c> — a cautionary task (amber AlertTriangle glyph).</summary>
    Warn,

    /// <summary>web <c>'error'</c> — an urgent task (red AlertCircle glyph).</summary>
    Error,
}

/// <summary>
/// How an action item's optional CTA behaves — the native discriminator for the three render branches the web
/// <c>ActionCTA</c> selects between (<c>ActionItem.tsx</c> L59-93): a navigation link (<c>cta.to</c>, optionally
/// <c>external</c>), an in-app action (<c>cta.onClick</c>), or nothing at all (a <c>cta</c> with neither
/// <c>to</c> nor <c>onClick</c>, where the web <c>ActionCTA</c> returns <c>null</c> and no CTA renders). The
/// internal / external distinction within the navigation branch is carried by
/// <see cref="ActionItemCta.IsExternal"/>, mirroring the web <c>cta.external</c> sub-flag.
/// </summary>
public enum ActionItemInteraction
{
    /// <summary>No CTA renders — the web <c>ActionCTA</c> returns <c>null</c> (neither <c>to</c> nor <c>onClick</c>).</summary>
    None,

    /// <summary>An in-app action — the CTA is a button (web <c>cta.onClick</c>).</summary>
    Invoke,

    /// <summary>A navigation target — the CTA is a link (web <c>cta.to</c>, internal or external).</summary>
    Navigate,
}

/// <summary>
/// The optional trailing call-to-action an <see cref="ActionItemModel"/> carries — the native analogue of the
/// web <c>cta</c> prop (<c>{ label, to?, external?, onClick? }</c> at <c>ActionItem.tsx</c> L27-28). It is pure
/// data (no delegate) so the projection stays unit-testable: the actual click behaviour is a view concern
/// surfaced through the surface's <c>ActionInvoked</c> event / <c>ActionCommand</c>, carrying <see cref="Href"/>
/// and <see cref="IsExternal"/> for the navigation case. The web branch precedence — <c>to</c> wins (an external
/// <c>to</c> opens in a new tab, an internal <c>to</c> routes in-app), else <c>onClick</c> makes it a button,
/// else nothing renders — lives in <see cref="Create"/>.
/// </summary>
public sealed record ActionItemCta
{
    private ActionItemCta(string label, string? href, bool isExternal, ActionItemInteraction interaction)
    {
        Label = label;
        Href = href;
        IsExternal = isExternal;
        Interaction = interaction;
    }

    /// <summary>The CTA label rendered before the trailing chevron (web <c>cta.label</c>).</summary>
    public string Label { get; }

    /// <summary>The navigation target for the link branch (web <c>cta.to</c>); null for the button / none branches.</summary>
    public string? Href { get; }

    /// <summary>Whether the navigation target opens externally in a new tab (web <c>cta.external</c>); false otherwise.</summary>
    public bool IsExternal { get; }

    /// <summary>Which render branch the CTA selects (web <c>to</c> → link, <c>onClick</c> → button, else none).</summary>
    public ActionItemInteraction Interaction { get; }

    /// <summary>An in-app navigation CTA — the surface renders a routing link (web <c>cta.to</c>, not external).</summary>
    /// <param name="label">The CTA label (web <c>cta.label</c>).</param>
    /// <param name="to">The in-app route (web <c>cta.to</c>); must be non-empty.</param>
    public static ActionItemCta NavigateInternal(string label, string to)
    {
        ArgumentNullException.ThrowIfNull(label);
        ArgumentException.ThrowIfNullOrEmpty(to);
        return new ActionItemCta(label, to, isExternal: false, ActionItemInteraction.Navigate);
    }

    /// <summary>An external navigation CTA — the surface renders a link that opens in a new tab (web <c>cta.to</c> + <c>external</c>).</summary>
    /// <param name="label">The CTA label (web <c>cta.label</c>).</param>
    /// <param name="to">The external URL (web <c>cta.to</c>); must be non-empty.</param>
    public static ActionItemCta NavigateExternal(string label, string to)
    {
        ArgumentNullException.ThrowIfNull(label);
        ArgumentException.ThrowIfNullOrEmpty(to);
        return new ActionItemCta(label, to, isExternal: true, ActionItemInteraction.Navigate);
    }

    /// <summary>An in-app action CTA — the surface renders a button (web <c>cta.onClick</c>).</summary>
    /// <param name="label">The CTA label (web <c>cta.label</c>).</param>
    public static ActionItemCta Invoke(string label)
    {
        ArgumentNullException.ThrowIfNull(label);
        return new ActionItemCta(label, href: null, isExternal: false, ActionItemInteraction.Invoke);
    }

    /// <summary>
    /// Build a CTA from the raw web prop shape, reproducing the web <c>ActionCTA</c> branch precedence exactly
    /// (<c>ActionItem.tsx</c> L67-93): a non-empty <paramref name="to"/> wins (a navigation link — external when
    /// <paramref name="external"/>, otherwise an in-app route), else a wired <paramref name="hasOnClick"/> makes
    /// it a button, else the CTA is inert (the web returns <c>null</c> — <see cref="Interaction"/> is
    /// <see cref="ActionItemInteraction.None"/> and the surface renders no CTA).
    /// </summary>
    /// <param name="label">The CTA label (web <c>cta.label</c>).</param>
    /// <param name="to">The navigation target (web <c>cta.to</c>); null / empty falls through to <paramref name="hasOnClick"/>.</param>
    /// <param name="external">Whether the navigation target opens externally (web <c>cta.external</c>); applies only when <paramref name="to"/> is set.</param>
    /// <param name="hasOnClick">Whether an in-app click handler is wired (web <c>cta.onClick</c>).</param>
    public static ActionItemCta Create(string label, string? to = null, bool external = false, bool hasOnClick = false)
    {
        ArgumentNullException.ThrowIfNull(label);

        if (!string.IsNullOrEmpty(to))
        {
            return new ActionItemCta(label, to, external, ActionItemInteraction.Navigate);
        }

        return hasOnClick
            ? new ActionItemCta(label, href: null, isExternal: false, ActionItemInteraction.Invoke)
            : new ActionItemCta(label, href: null, isExternal: false, ActionItemInteraction.None);
    }
}

/// <summary>
/// The render-time data model the <c>ActionItem</c> view binds to — the native analogue of the web
/// <c>ActionItemProps</c> (<c>ActionItem.tsx</c> L22-29). The web component is purely presentational: its parent
/// (the <c>ActionItemsPanel</c>) owns any data fetching and feeds an already-resolved severity, title,
/// description and CTA, so — exactly like React re-rendering the element with already-resolved props — there is
/// no fetch-driven loading / error / stale / offline branch to reproduce here; the only branches are the three
/// severities, the optional description sub-line, and the three CTA modes (link / button / none). The web
/// <c>description</c> is a <c>ReactNode</c>; this surface narrows it to text (as the panel always feeds a string
/// such as "v1.2.0 → v1.3.0"). Pure data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
public sealed record ActionItemModel
{
    private ActionItemModel(ActionSeverity severity, string title, string? description, ActionItemCta? cta)
    {
        Severity = severity;
        Title = title;
        Description = description;
        Cta = cta;
    }

    /// <summary>The severity tier driving the icon and accent colour (web <c>severity</c>).</summary>
    public ActionSeverity Severity { get; }

    /// <summary>The primary task title (web <c>title</c>).</summary>
    public string Title { get; }

    /// <summary>Optional sub-line beneath the title (web <c>description</c>, narrowed to text); null / empty renders title only.</summary>
    public string? Description { get; }

    /// <summary>Optional trailing CTA (web <c>cta</c>); null — or a CTA with neither <c>to</c> nor <c>onClick</c> — renders no CTA.</summary>
    public ActionItemCta? Cta { get; }

    /// <summary>An empty info item — the safe default the view falls back to when no model is supplied.</summary>
    public static ActionItemModel Empty { get; } = Create(ActionSeverity.Info, string.Empty);

    /// <summary>Build an action-item model.</summary>
    /// <param name="severity">The severity tier (web <c>severity</c>).</param>
    /// <param name="title">The primary task title (web <c>title</c>).</param>
    /// <param name="description">Optional sub-line (web <c>description</c>).</param>
    /// <param name="cta">Optional trailing CTA (web <c>cta</c>).</param>
    public static ActionItemModel Create(
        ActionSeverity severity,
        string title,
        string? description = null,
        ActionItemCta? cta = null)
    {
        ArgumentNullException.ThrowIfNull(title);
        return new ActionItemModel(severity, title, description, cta);
    }
}

/// <summary>
/// The fully projected, render-ready view of an <see cref="ActionItemModel"/> — everything the web component
/// derives before returning JSX (<c>ActionItem.tsx</c> L31-93): the resolved <see cref="Variant"/> and its
/// <see cref="AccentBrushKey"/> (the icon, CTA text, ring and background tint colour — the web
/// <c>SEVERITY_CFG[severity]</c>), the always-present leading <see cref="IconGlyph"/>, the
/// <see cref="TitleBrushKey"/> (primary) / <see cref="DescriptionBrushKey"/> (secondary) text colours, the
/// <see cref="Title"/> and the optional <see cref="Description"/> (<see cref="HasDescription"/>), the CTA branch
/// (<see cref="HasCta"/> / <see cref="CtaLabel"/> / <see cref="CtaHref"/> / <see cref="CtaIsExternal"/> /
/// <see cref="Interaction"/> / <see cref="CtaRole"/>), the variant tint <see cref="BackgroundTintOpacity"/> +
/// <see cref="RingOpacity"/>, the composed row <see cref="AutomationName"/> (the title then the description) and
/// the separate <see cref="CtaAccessibleName"/> Narrator reads for the focusable CTA. Pure data so every value
/// is asserted headlessly.
/// </summary>
/// <param name="Severity">The severity tier (web <c>severity</c>).</param>
/// <param name="Variant">The shared callout variant the severity maps to (Info / Warning / Danger).</param>
/// <param name="AccentBrushKey">Token brush key for the icon / CTA text / ring / background accent (web <c>SEVERITY_CFG.text</c>).</param>
/// <param name="IconGlyph">The leading severity glyph (web <c>SEVERITY_CFG.icon</c>); always present.</param>
/// <param name="TitleBrushKey">Token brush key for the title text (web <c>--text-primary</c>).</param>
/// <param name="Title">The primary task title (web <c>title</c>).</param>
/// <param name="HasDescription">True when the description sub-line renders (web <c>description &amp;&amp; ...</c>).</param>
/// <param name="DescriptionBrushKey">Token brush key for the description text (web <c>--text-secondary</c>).</param>
/// <param name="Description">The description sub-line, or empty when absent.</param>
/// <param name="HasCta">True when a CTA renders (web <c>cta</c> resolves to a link or button, not the null branch).</param>
/// <param name="CtaLabel">The CTA label, or empty when there is no CTA.</param>
/// <param name="CtaHref">The navigation target for the link branch (web <c>cta.to</c>); null otherwise.</param>
/// <param name="CtaIsExternal">Whether the link branch opens externally (web <c>cta.external</c>).</param>
/// <param name="Interaction">Which CTA render branch is active (none / button / link).</param>
/// <param name="CtaRole">The ARIA role the CTA exposes (link / button), or empty when there is no CTA.</param>
/// <param name="BackgroundTintOpacity">Alpha of the accent-coloured background tint (web <c>bg-*-500/10</c>).</param>
/// <param name="RingOpacity">Alpha of the accent-coloured ring (web <c>ring-*-400/20</c>).</param>
/// <param name="AutomationName">The composed accessible name for the row content Narrator reads (title, then description).</param>
/// <param name="CtaAccessibleName">The accessible name for the focusable CTA (its label); empty when there is no CTA.</param>
public sealed record ActionItemDisplay(
    ActionSeverity Severity,
    CalloutVariant Variant,
    string AccentBrushKey,
    string IconGlyph,
    string TitleBrushKey,
    string Title,
    bool HasDescription,
    string DescriptionBrushKey,
    string Description,
    bool HasCta,
    string CtaLabel,
    string? CtaHref,
    bool CtaIsExternal,
    ActionItemInteraction Interaction,
    string CtaRole,
    double BackgroundTintOpacity,
    double RingOpacity,
    string AutomationName,
    string CtaAccessibleName);

/// <summary>
/// Pure projection from an <see cref="ActionItemModel"/> to its <see cref="ActionItemDisplay"/> — the native
/// port of <c>web/src/components/status/ActionItem.tsx</c>. Reproduces the web derivations exactly: the accent
/// brush + leading glyph come from the shared <c>SEVERITY_CFG</c> table (<see cref="ActionItemRegistration"/>);
/// the title is always the primary text colour and the description the secondary; the CTA branch follows the web
/// <c>ActionCTA</c> precedence (<c>to</c> → link, else <c>onClick</c> → button, else no CTA) with the CTA text
/// tinted the severity accent (web <c>severityText</c>); the background tint / ring use the web <c>bg-*-500/10</c>
/// / <c>ring-*-400/20</c> alphas; and the row's accessible name is the title followed by the description (the
/// icon is decorative and the CTA is a separately-named focusable control). No WinUI types — so the projection
/// is unit-tested without a UI host.
/// </summary>
public static class ActionItemProjection
{
    /// <summary>Leading icon font size — web <c>h-5 w-5</c> (≈20&#160;px).</summary>
    public const double IconSize = 20;

    /// <summary>Title text font size — web <c>text-sm</c> (0.875rem ≈ 14&#160;px).</summary>
    public const double TitleFontSize = 14;

    /// <summary>Description text font size — web <c>text-xs</c> (0.75rem ≈ 12&#160;px).</summary>
    public const double DescriptionFontSize = 12;

    /// <summary>CTA label font size — web <c>text-xs</c> (0.75rem ≈ 12&#160;px).</summary>
    public const double CtaFontSize = 12;

    /// <summary>Trailing chevron font size — web <c>h-3.5 w-3.5</c> (≈14&#160;px).</summary>
    public const double ChevronSize = 14;

    /// <summary>Background tint alpha over the accent colour (web <c>bg-*-500/10</c>).</summary>
    public const double BackgroundTintOpacity = 0.10;

    /// <summary>Ring alpha over the accent colour (web <c>ring-*-400/20</c>).</summary>
    public const double RingOpacity = 0.20;

    /// <summary>Minimum CTA touch height — web <c>min-h-[36px]</c>.</summary>
    public const double CtaMinHeight = 36;

    /// <summary>The name-part separator (Narrator reads "title, description").</summary>
    private const string NameSeparator = ", ";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web props).</param>
    /// <param name="localizer">The i18n facade (P1/S10); reserved for parity with the surface family — this anonymous surface carries no inherent strings, so the title / description / CTA label are caller-supplied and already localized.</param>
    /// <returns>The render-ready display model.</returns>
    public static ActionItemDisplay Project(ActionItemModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        ActionSeverity severity = model.Severity;
        CalloutVariant variant = ActionItemRegistration.Variant(severity);
        string accentKey = ActionItemRegistration.AccentBrushKey(severity);

        bool hasDescription = !string.IsNullOrEmpty(model.Description);
        string description = model.Description ?? string.Empty;

        ActionItemCta? cta = model.Cta;
        ActionItemInteraction interaction = cta?.Interaction ?? ActionItemInteraction.None;
        bool hasCta = interaction is ActionItemInteraction.Invoke or ActionItemInteraction.Navigate;
        string ctaLabel = hasCta ? cta!.Label : string.Empty;
        string? ctaHref = interaction == ActionItemInteraction.Navigate ? cta!.Href : null;
        bool ctaIsExternal = interaction == ActionItemInteraction.Navigate && cta!.IsExternal;

        string ctaRole = interaction switch
        {
            ActionItemInteraction.Navigate => ActionItemRegistration.LinkRole,
            ActionItemInteraction.Invoke => ActionItemRegistration.ButtonRole,
            _ => string.Empty,
        };

        return new ActionItemDisplay(
            Severity: severity,
            Variant: variant,
            AccentBrushKey: accentKey,
            IconGlyph: ActionItemRegistration.Glyph(severity),
            TitleBrushKey: ActionItemRegistration.PrimaryTextBrushKey,
            Title: model.Title,
            HasDescription: hasDescription,
            DescriptionBrushKey: ActionItemRegistration.SecondaryTextBrushKey,
            Description: description,
            HasCta: hasCta,
            CtaLabel: ctaLabel,
            CtaHref: ctaHref,
            CtaIsExternal: ctaIsExternal,
            Interaction: interaction,
            CtaRole: ctaRole,
            BackgroundTintOpacity: BackgroundTintOpacity,
            RingOpacity: RingOpacity,
            AutomationName: ComposeName(model.Title, description, hasDescription),
            CtaAccessibleName: ctaLabel);
    }

    // The row's accessible name is the title followed by the description (when present) — the natural reading
    // order of the web content (the icon is decorative; the CTA is a separately-named focusable control).
    private static string ComposeName(string title, string description, bool hasDescription)
    {
        bool hasTitle = !string.IsNullOrEmpty(title);
        bool hasDesc = hasDescription && !string.IsNullOrEmpty(description);

        if (hasTitle && hasDesc)
        {
            return title + NameSeparator + description;
        }

        return hasTitle ? title : (hasDesc ? description : string.Empty);
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>ActionItem</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never the title, description or CTA label — so a
/// diagnostics line can never leak fleet state. Thread-safe; mirrors the peer surfaces' diagnostics collectors.
/// </summary>
public sealed class ActionItemDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional sink the operational event line is written to.</param>
    public ActionItemDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ActionItem</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={ActionItemRegistration.Slug}");
    }
}
