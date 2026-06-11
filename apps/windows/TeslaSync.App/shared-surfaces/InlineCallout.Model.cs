using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces.InlineCalloutSurface;

/// <summary>
/// Canonical metadata for the <c>InlineCallout</c> shared surface — the native mirror of the module-level
/// constants in <c>web/src/components/feedback/InlineCallout.tsx</c>. Carries the diagnostics slug, the three ARIA
/// roles the web component selects between (a non-interactive <c>status</c>, an action <c>button</c>, or a
/// navigation <c>link</c>), the polite live-region urgency the status branch declares, the trailing Segoe Fluent
/// chevron glyph standing in for the web Lucide <c>ChevronRight</c>, and the token brush keys the variant tint /
/// body colour resolve through. UI-free so the mapping is asserted in tests without a XAML runtime.
/// </summary>
public static class InlineCalloutRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "InlineCallout";

    /// <summary>ARIA role for the non-interactive branch (web <c>&lt;div role="status"&gt;</c>).</summary>
    public const string StatusRole = "status";

    /// <summary>ARIA role for the in-app action branch (web <c>&lt;button&gt;</c> from <c>action.onClick</c>).</summary>
    public const string ButtonRole = "button";

    /// <summary>ARIA role for the navigation branch (web <c>&lt;a href&gt;</c> from <c>action.href</c>).</summary>
    public const string LinkRole = "link";

    /// <summary>Live-region urgency the status branch declares (web wrapper <c>role="status"</c> is polite).</summary>
    public const string LiveSetting = "polite";

    /// <summary>Segoe Fluent "ChevronRight" glyph — the native stand-in for the web Lucide <c>ChevronRight</c>.</summary>
    public const string ChevronGlyph = "\uE76C";

    /// <summary>Token brush key for the neutral body text used by the info / success variants (web <c>--text-secondary</c>).</summary>
    public const string SecondaryTextBrushKey = "TsColorTextSecondaryBrush";

    /// <summary>The shared variant accent brush key (info / success / warning / danger), the web <c>iconText</c> / ring colour.</summary>
    /// <param name="variant">The callout severity.</param>
    public static string AccentBrushKey(CalloutVariant variant) => CalloutVariants.AccentBrushKey(variant);

    /// <summary>The default Segoe Fluent glyph for a variant — offered for callers that want the semantic icon (the web <c>icon</c> prop is otherwise caller-supplied).</summary>
    /// <param name="variant">The callout severity.</param>
    public static string Glyph(CalloutVariant variant) => CalloutVariants.Glyph(variant);
}

/// <summary>
/// How a callout's optional action behaves — the native discriminator for the three render branches the web
/// component selects between (<c>web/src/components/feedback/InlineCallout.tsx</c> L81-110): a navigation link
/// (<c>action.href</c>), an in-app action (<c>action.onClick</c>), or no interaction at all (the web
/// <c>&lt;div role="status"&gt;</c> fall-through, where an action's label + chevron still render but the surface is
/// inert).
/// </summary>
public enum InlineCalloutInteraction
{
    /// <summary>No interaction — the inert status branch (web neither <c>href</c> nor <c>onClick</c>).</summary>
    None,

    /// <summary>An in-app action — the surface is a button (web <c>action.onClick</c>).</summary>
    Invoke,

    /// <summary>A navigation target — the surface is a link (web <c>action.href</c>).</summary>
    Navigate,
}

/// <summary>
/// The optional trailing action a callout carries — the native analogue of the web <c>action</c> prop
/// (<c>{ label, href?, onClick? }</c> at <c>InlineCallout.tsx</c> L26-30). It is pure data (no delegate) so the
/// projection stays unit-testable: the actual click behaviour is a view concern surfaced through the surface's
/// <c>ActionInvoked</c> event / <c>ActionCommand</c>, carrying <see cref="Href"/> for the navigation case. The web
/// "prefers <c>href</c> when both are supplied" rule lives in <see cref="Create"/>.
/// </summary>
public sealed record InlineCalloutAction
{
    private InlineCalloutAction(string label, string? href, InlineCalloutInteraction interaction)
    {
        Label = label;
        Href = href;
        Interaction = interaction;
    }

    /// <summary>The action label rendered before the trailing chevron (web <c>action.label</c>).</summary>
    public string Label { get; }

    /// <summary>The navigation target for the link branch (web <c>action.href</c>); null for the other branches.</summary>
    public string? Href { get; }

    /// <summary>Which render branch the action selects (web <c>href</c> / <c>onClick</c> / fall-through).</summary>
    public InlineCalloutInteraction Interaction { get; }

    /// <summary>A navigation action — the surface becomes a link (web <c>action.href</c>).</summary>
    /// <param name="label">The action label (web <c>action.label</c>).</param>
    /// <param name="href">The navigation target (web <c>action.href</c>); must be non-empty.</param>
    public static InlineCalloutAction Navigate(string label, string href)
    {
        ArgumentNullException.ThrowIfNull(label);
        ArgumentException.ThrowIfNullOrEmpty(href);
        return new InlineCalloutAction(label, href, InlineCalloutInteraction.Navigate);
    }

    /// <summary>An in-app action — the surface becomes a button (web <c>action.onClick</c>).</summary>
    /// <param name="label">The action label (web <c>action.label</c>).</param>
    public static InlineCalloutAction Invoke(string label)
    {
        ArgumentNullException.ThrowIfNull(label);
        return new InlineCalloutAction(label, href: null, InlineCalloutInteraction.Invoke);
    }

    /// <summary>An inert action — its label + chevron render, but the surface stays a status region (web action with neither <c>href</c> nor <c>onClick</c>).</summary>
    /// <param name="label">The action label (web <c>action.label</c>).</param>
    public static InlineCalloutAction Inert(string label)
    {
        ArgumentNullException.ThrowIfNull(label);
        return new InlineCalloutAction(label, href: null, InlineCalloutInteraction.None);
    }

    /// <summary>
    /// Build an action from the raw web prop shape, reproducing the web branch precedence exactly
    /// (<c>InlineCallout.tsx</c> L81-104): a non-empty <paramref name="href"/> wins (navigation link), else a wired
    /// <paramref name="hasOnClick"/> makes it a button, else the action is inert (its label + chevron still show
    /// inside the status branch).
    /// </summary>
    /// <param name="label">The action label (web <c>action.label</c>).</param>
    /// <param name="href">The navigation target (web <c>action.href</c>); null / empty falls through to <paramref name="hasOnClick"/>.</param>
    /// <param name="hasOnClick">Whether an in-app click handler is wired (web <c>action.onClick</c>).</param>
    public static InlineCalloutAction Create(string label, string? href = null, bool hasOnClick = false)
    {
        ArgumentNullException.ThrowIfNull(label);

        if (!string.IsNullOrEmpty(href))
        {
            return new InlineCalloutAction(label, href, InlineCalloutInteraction.Navigate);
        }

        return hasOnClick
            ? new InlineCalloutAction(label, href: null, InlineCalloutInteraction.Invoke)
            : new InlineCalloutAction(label, href: null, InlineCalloutInteraction.None);
    }
}

/// <summary>
/// The render-time data model the <c>InlineCallout</c> view binds to — the native analogue of the web
/// <c>InlineCalloutProps</c> (<c>InlineCallout.tsx</c> L14-35). The web component is purely presentational: its
/// parent (a section-card footer) owns any data fetching and feeds an already-resolved variant, icon, body and
/// action, so — exactly like React re-rendering the element with already-resolved props — there is no fetch-driven
/// loading / error / stale / offline branch to reproduce here; the only branches are the four variants, the
/// optional leading icon, and the three action modes (status / button / link). Pure data — no WinUI types — so the
/// projection is unit-tested without a UI host.
/// </summary>
public sealed record InlineCalloutModel
{
    private InlineCalloutModel(
        CalloutVariant variant,
        string body,
        string? iconGlyph,
        InlineCalloutAction? action,
        string? testId)
    {
        Variant = variant;
        Body = body;
        IconGlyph = iconGlyph;
        Action = action;
        TestId = testId;
    }

    /// <summary>The severity tier driving colour (web <c>variant</c>).</summary>
    public CalloutVariant Variant { get; }

    /// <summary>The body text rendered as the callout's message (web <c>children</c>, narrowed to text for this surface).</summary>
    public string Body { get; }

    /// <summary>Optional leading Segoe Fluent glyph (web <c>icon</c>); null renders no icon — the web never auto-adds one.</summary>
    public string? IconGlyph { get; }

    /// <summary>Optional trailing action (web <c>action</c>); null renders body only.</summary>
    public InlineCalloutAction? Action { get; }

    /// <summary>Optional automation id mirroring the web test hook (web <c>testId</c> → <c>AutomationProperties.AutomationId</c>).</summary>
    public string? TestId { get; }

    /// <summary>An empty info callout — the safe default the view falls back to when no model is supplied.</summary>
    public static InlineCalloutModel Empty { get; } = Create(CalloutVariant.Info, string.Empty);

    /// <summary>Build a callout model.</summary>
    /// <param name="variant">The severity tier (web <c>variant</c>).</param>
    /// <param name="body">The body text (web <c>children</c>).</param>
    /// <param name="iconGlyph">Optional leading Segoe Fluent glyph (web <c>icon</c>).</param>
    /// <param name="action">Optional trailing action (web <c>action</c>).</param>
    /// <param name="testId">Optional automation id (web <c>testId</c>).</param>
    public static InlineCalloutModel Create(
        CalloutVariant variant,
        string body,
        string? iconGlyph = null,
        InlineCalloutAction? action = null,
        string? testId = null)
    {
        ArgumentNullException.ThrowIfNull(body);
        return new InlineCalloutModel(variant, body, iconGlyph, action, testId);
    }
}

/// <summary>
/// The fully projected, render-ready view of an <see cref="InlineCalloutModel"/> — everything the web component
/// derives before returning JSX (<c>InlineCallout.tsx</c> L54-110): the resolved accent / body token brush keys
/// (<see cref="AccentBrushKey"/> for the icon, action and ring; <see cref="BodyBrushKey"/> for the message —
/// neutral for info / success, the accent for the louder warning / danger), the optional <see cref="IconGlyph"/>,
/// the <see cref="Body"/> text, the optional action (<see cref="HasAction"/> / <see cref="ActionLabel"/> /
/// <see cref="Href"/> / <see cref="Interaction"/>), the selected <see cref="Role"/> and whether it is an
/// <see cref="IsInteractive"/> control or an <see cref="IsStatusRegion"/> live region, the variant tint
/// <see cref="BackgroundTintOpacity"/> + <see cref="RingOpacity"/>, the composed <see cref="AutomationName"/>
/// Narrator reads, and the optional <see cref="AutomationId"/>. Pure data so every value is asserted headlessly.
/// </summary>
/// <param name="Variant">The severity tier (web <c>variant</c>).</param>
/// <param name="AccentBrushKey">Token brush key for the icon / action / ring accent (web <c>iconText</c> / <c>ring</c>).</param>
/// <param name="BodyBrushKey">Token brush key for the body text (web <c>text</c>): secondary for info / success, the accent for warning / danger.</param>
/// <param name="BodyUsesAccent">True when the body is tinted with the accent (web warning / danger); false when it is neutral (info / success).</param>
/// <param name="IconGlyph">The optional leading glyph (web <c>icon</c>); null when absent.</param>
/// <param name="HasIcon">True when a leading icon is shown.</param>
/// <param name="Body">The body text (web <c>children</c>).</param>
/// <param name="HasAction">True when the trailing action label + chevron render (web <c>action</c> present).</param>
/// <param name="ActionLabel">The action label, or empty when there is no action.</param>
/// <param name="Href">The navigation target for the link branch (web <c>action.href</c>); null otherwise.</param>
/// <param name="Interaction">Which render branch is active (status / button / link).</param>
/// <param name="IsInteractive">True for the button / link branches (focusable, clickable).</param>
/// <param name="IsStatusRegion">True for the non-interactive status branch (a polite live region).</param>
/// <param name="Role">The ARIA role string the surface exposes (status / button / link).</param>
/// <param name="BackgroundTintOpacity">Alpha of the accent-coloured background tint (web <c>bg-*/5</c>).</param>
/// <param name="RingOpacity">Alpha of the accent-coloured ring (web <c>ring-*/20</c> or <c>/25</c>).</param>
/// <param name="AutomationName">The composed accessible name Narrator reads (body, then action label).</param>
/// <param name="AutomationId">The optional automation id (web <c>testId</c>); null when not supplied.</param>
public sealed record InlineCalloutDisplay(
    CalloutVariant Variant,
    string AccentBrushKey,
    string BodyBrushKey,
    bool BodyUsesAccent,
    string? IconGlyph,
    bool HasIcon,
    string Body,
    bool HasAction,
    string ActionLabel,
    string? Href,
    InlineCalloutInteraction Interaction,
    bool IsInteractive,
    bool IsStatusRegion,
    string Role,
    double BackgroundTintOpacity,
    double RingOpacity,
    string AutomationName,
    string? AutomationId);

/// <summary>
/// Pure projection from an <see cref="InlineCalloutModel"/> to its <see cref="InlineCalloutDisplay"/> — the native
/// port of <c>web/src/components/feedback/InlineCallout.tsx</c>. Reproduces the web derivations exactly: the accent
/// brush is the shared variant accent (the web <c>iconText</c> / ring colour); the body brush is neutral for the
/// quiet info / success variants and the accent for the louder warning / danger variants (the web
/// <c>text-amber-200/85</c> / <c>text-rose-200/85</c> split); the render branch follows the web precedence
/// (<c>href</c> → link, else <c>onClick</c> → button, else status); the ring alpha bumps from the info / success
/// <c>/20</c> to the warning / danger <c>/25</c>; and the accessible name is the body followed by the action label
/// (the natural reading order of the web <c>&lt;a&gt;</c> / <c>&lt;button&gt;</c> / status content). No WinUI types —
/// so the projection is unit-tested without a UI host.
/// </summary>
public static class InlineCalloutProjection
{
    /// <summary>Leading icon font size — web <c>h-4 w-4</c> (≈16&#160;px).</summary>
    public const double IconSize = 16;

    /// <summary>Body / action text font size — web <c>text-xs</c> (0.75rem ≈ 12&#160;px).</summary>
    public const double BodyFontSize = 12;

    /// <summary>Trailing chevron font size — web <c>h-3 w-3</c> (≈12&#160;px).</summary>
    public const double ChevronSize = 12;

    /// <summary>Background tint alpha over the accent colour (web <c>bg-*/5</c>, nudged for native legibility).</summary>
    public const double BackgroundTintOpacity = 0.06;

    /// <summary>Ring alpha for the info / success variants (web <c>ring-*/20</c>).</summary>
    public const double RingOpacity = 0.20;

    /// <summary>Ring alpha for the louder warning / danger variants (web <c>ring-*/25</c>).</summary>
    public const double StrongRingOpacity = 0.25;

    /// <summary>The name-part separator (Narrator reads "body, action label").</summary>
    private const string NameSeparator = ", ";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web props).</param>
    /// <param name="localizer">The i18n facade (P1/S10); reserved for parity with the surface family — this anonymous surface carries no inherent strings, so the body / action label are caller-supplied and already localized.</param>
    /// <returns>The render-ready display model.</returns>
    public static InlineCalloutDisplay Project(InlineCalloutModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        CalloutVariant variant = model.Variant;
        bool bodyUsesAccent = variant is CalloutVariant.Warning or CalloutVariant.Danger;
        string accentKey = InlineCalloutRegistration.AccentBrushKey(variant);
        string bodyBrushKey = bodyUsesAccent ? accentKey : InlineCalloutRegistration.SecondaryTextBrushKey;

        InlineCalloutAction? action = model.Action;
        bool hasAction = action is not null;
        InlineCalloutInteraction interaction = action?.Interaction ?? InlineCalloutInteraction.None;
        bool isInteractive = interaction is InlineCalloutInteraction.Invoke or InlineCalloutInteraction.Navigate;
        string actionLabel = action?.Label ?? string.Empty;
        string? href = action?.Href;

        string role = interaction switch
        {
            InlineCalloutInteraction.Navigate => InlineCalloutRegistration.LinkRole,
            InlineCalloutInteraction.Invoke => InlineCalloutRegistration.ButtonRole,
            _ => InlineCalloutRegistration.StatusRole,
        };

        bool hasIcon = !string.IsNullOrEmpty(model.IconGlyph);

        return new InlineCalloutDisplay(
            Variant: variant,
            AccentBrushKey: accentKey,
            BodyBrushKey: bodyBrushKey,
            BodyUsesAccent: bodyUsesAccent,
            IconGlyph: hasIcon ? model.IconGlyph : null,
            HasIcon: hasIcon,
            Body: model.Body,
            HasAction: hasAction,
            ActionLabel: actionLabel,
            Href: href,
            Interaction: interaction,
            IsInteractive: isInteractive,
            IsStatusRegion: !isInteractive,
            Role: role,
            BackgroundTintOpacity: BackgroundTintOpacity,
            RingOpacity: bodyUsesAccent ? StrongRingOpacity : RingOpacity,
            AutomationName: ComposeName(model.Body, actionLabel, hasAction),
            AutomationId: model.TestId);
    }

    // The accessible name is the body followed by the action label (when present) — the natural reading order of
    // the web content (icon is aria-hidden, the body text then the action label + decorative chevron).
    private static string ComposeName(string body, string actionLabel, bool hasAction)
    {
        bool hasBody = !string.IsNullOrEmpty(body);
        bool hasLabel = hasAction && !string.IsNullOrEmpty(actionLabel);

        if (hasBody && hasLabel)
        {
            return body + NameSeparator + actionLabel;
        }

        return hasBody ? body : (hasLabel ? actionLabel : string.Empty);
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>InlineCallout</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never the body text or action label — so a
/// diagnostics line can never leak fleet state. Thread-safe; mirrors the peer surfaces' diagnostics collectors.
/// </summary>
public sealed class InlineCalloutDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional sink the operational event line is written to.</param>
    public InlineCalloutDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=InlineCallout</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={InlineCalloutRegistration.Slug}");
    }
}
