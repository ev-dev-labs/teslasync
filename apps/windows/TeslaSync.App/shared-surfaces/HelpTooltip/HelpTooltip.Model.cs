using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces.HelpTooltipSurface;

/// <summary>
/// Canonical metadata for the <c>HelpTooltip</c> shared surface — the native mirror of the module-level
/// constants in <c>web/src/components/ui/HelpTooltip.tsx</c>. The web component is a compact "?" affordance that
/// reveals an explanatory tooltip on hover / focus / tap with an optional "Learn more" link, so this carries the
/// diagnostics slug, the two fixed i18n keys it owns (the trigger's default accessible name
/// <c>help.tooltip.iconLabel</c> and the learn-more link's default label <c>common.learnMore</c>) with their
/// verbatim English fallbacks, the Segoe Fluent glyphs that stand in for the web Lucide icons (the
/// <c>HelpCircle</c> trigger and the <c>ExternalLink</c> learn-more affordance), the ARIA role the revealed body
/// declares (web <c>role="tooltip"</c>), and the trigger glyph sizes for the three web size tiers. UI-free so the
/// mapping is asserted in tests without a XAML runtime.
/// </summary>
public static class HelpTooltipRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "HelpTooltip";

    /// <summary>i18n key for the trigger's default accessible name (web <c>t('help.tooltip.iconLabel')</c>).</summary>
    public const string IconLabelKey = "translation.help.tooltip.iconLabel";

    /// <summary>English fallback for <see cref="IconLabelKey"/> (web second arg, verbatim).</summary>
    public const string IconLabelFallback = "More info";

    /// <summary>i18n key for the learn-more link's default label (web <c>t('common.learnMore')</c>).</summary>
    public const string LearnMoreKey = "translation.common.learnMore";

    /// <summary>English fallback for <see cref="LearnMoreKey"/> (web second arg, verbatim).</summary>
    public const string LearnMoreFallback = "Learn more";

    /// <summary>ARIA role the revealed tooltip body declares (web shared <c>&lt;Tooltip role="tooltip"&gt;</c>).</summary>
    public const string TooltipRole = "tooltip";

    /// <summary>Segoe Fluent "Help" glyph — the native stand-in for the web Lucide <c>HelpCircle</c> trigger icon.</summary>
    public const string HelpGlyph = "\uE897";

    /// <summary>Segoe Fluent "OpenInNewWindow" glyph — the native stand-in for the web Lucide <c>ExternalLink</c> icon.</summary>
    public const string ExternalLinkGlyph = "\uE8A7";

    /// <summary>Trigger glyph font size for the extra-small tier (web <c>h-3 w-3</c> ≈ 12&#160;px).</summary>
    public const double ExtraSmallIconSize = 12;

    /// <summary>Trigger glyph font size for the small tier — the web default (web <c>h-3.5 w-3.5</c> ≈ 14&#160;px).</summary>
    public const double SmallIconSize = 14;

    /// <summary>Trigger glyph font size for the medium tier (web <c>h-4 w-4</c> ≈ 16&#160;px).</summary>
    public const double MediumIconSize = 16;

    /// <summary>Learn-more trailing glyph font size (web <c>ExternalLink h-3 w-3</c> ≈ 12&#160;px).</summary>
    public const double ExternalLinkIconSize = 12;

    /// <summary>The trigger glyph font size for a size tier (web <c>SIZE_CLASS</c> map).</summary>
    /// <param name="size">The web size tier.</param>
    public static double IconSize(HelpTooltipSize size) => size switch
    {
        HelpTooltipSize.ExtraSmall => ExtraSmallIconSize,
        HelpTooltipSize.Medium => MediumIconSize,
        _ => SmallIconSize,
    };
}

/// <summary>
/// The trigger glyph size tier — the native analogue of the web <c>size</c> prop (<c>'xs' | 'sm' | 'md'</c>,
/// <c>HelpTooltip.tsx</c> L28-29). <see cref="Small"/> is the web default.
/// </summary>
public enum HelpTooltipSize
{
    /// <summary>web <c>'xs'</c> — <c>h-3 w-3</c> (≈ 12&#160;px).</summary>
    ExtraSmall,

    /// <summary>web <c>'sm'</c> — <c>h-3.5 w-3.5</c> (≈ 14&#160;px); the default.</summary>
    Small,

    /// <summary>web <c>'md'</c> — <c>h-4 w-4</c> (≈ 16&#160;px).</summary>
    Medium,
}

/// <summary>
/// Where the revealed tooltip sits relative to the trigger — the native analogue of the web <c>placement</c>
/// prop (<c>'top' | 'bottom' | 'left' | 'right'</c>, <c>HelpTooltip.tsx</c> L25). <see cref="Top"/> is the web
/// default. The WinUI view maps this to a <c>PlacementMode</c> (hover tooltip) / <c>FlyoutPlacementMode</c>
/// (learn-more popup) at the platform boundary.
/// </summary>
public enum HelpTooltipPlacement
{
    /// <summary>web <c>'top'</c> — above the trigger; the default.</summary>
    Top,

    /// <summary>web <c>'bottom'</c> — below the trigger.</summary>
    Bottom,

    /// <summary>web <c>'left'</c> — to the left of the trigger.</summary>
    Left,

    /// <summary>web <c>'right'</c> — to the right of the trigger.</summary>
    Right,
}

/// <summary>
/// The optional "Learn more" affordance a help tooltip carries — the native analogue of the web <c>learnMore</c>
/// prop (<c>{ url: string; label?: string }</c>, <c>HelpTooltip.tsx</c> L27). It is pure data so the projection
/// stays unit-testable; the WinUI view materialises it as a <c>HyperlinkButton</c> whose <c>NavigateUri</c> opens
/// the external target (the web <c>target="_blank" rel="noopener noreferrer"</c> new tab). A missing
/// <see cref="Label"/> falls back to the localized <c>common.learnMore</c> string in the projection.
/// </summary>
public sealed record HelpTooltipLearnMore
{
    private HelpTooltipLearnMore(string url, string? label)
    {
        Url = url;
        Label = label;
    }

    /// <summary>The external target opened in a new tab (web <c>learnMore.url</c>).</summary>
    public string Url { get; }

    /// <summary>The optional override label (web <c>learnMore.label</c>); null falls back to the localized "Learn more".</summary>
    public string? Label { get; }

    /// <summary>Build a learn-more affordance.</summary>
    /// <param name="url">The external target (web <c>learnMore.url</c>); must be non-empty.</param>
    /// <param name="label">Optional override label (web <c>learnMore.label</c>); null uses the localized default.</param>
    public static HelpTooltipLearnMore Create(string url, string? label = null)
    {
        ArgumentException.ThrowIfNullOrEmpty(url);
        return new HelpTooltipLearnMore(url, label);
    }
}

/// <summary>
/// The render-time data model the <c>HelpTooltip</c> view binds to — the native analogue of the web
/// <c>HelpTooltipProps</c> (<c>HelpTooltip.tsx</c> L17-40). The web component is purely presentational: it resolves
/// its body from <see cref="Text"/> or the <see cref="I18nKey"/> / <see cref="DefaultValue"/> pair through
/// <c>useTranslation</c> and otherwise just reflects its props, so — exactly like React re-rendering the element
/// with already-resolved props — there is no fetch-driven loading / error / stale / offline branch to reproduce
/// here; the only branches are the resolved-vs-empty content (the web <c>if (!resolved) return null</c>), the three
/// size tiers, the four placements, the optional learn-more link, and the optional accessible-name override. The
/// trigger-icon override (web <c>children</c>) is a view concern (it is arbitrary content) surfaced through the
/// view's <c>TriggerContent</c> property rather than this data model. Pure data — no WinUI types — so the
/// projection is unit-tested without a UI host.
/// </summary>
public sealed record HelpTooltipModel
{
    private HelpTooltipModel(
        string? text,
        string? i18nKey,
        string? defaultValue,
        HelpTooltipSize size,
        HelpTooltipPlacement placement,
        HelpTooltipLearnMore? learnMore,
        string? ariaLabel)
    {
        Text = text;
        I18nKey = i18nKey;
        DefaultValue = defaultValue;
        Size = size;
        Placement = placement;
        LearnMore = learnMore;
        AriaLabel = ariaLabel;
    }

    /// <summary>Plain text body, used when no <see cref="I18nKey"/> is supplied (web <c>text</c>).</summary>
    public string? Text { get; }

    /// <summary>i18n key for the body; takes precedence over <see cref="Text"/> (web <c>i18nKey</c>).</summary>
    public string? I18nKey { get; }

    /// <summary>English fallback for <see cref="I18nKey"/> when the key is missing (web <c>defaultValue</c>).</summary>
    public string? DefaultValue { get; }

    /// <summary>The trigger glyph size tier (web <c>size</c>; defaults to <see cref="HelpTooltipSize.Small"/>).</summary>
    public HelpTooltipSize Size { get; }

    /// <summary>Where the tooltip sits relative to the trigger (web <c>placement</c>; defaults to <see cref="HelpTooltipPlacement.Top"/>).</summary>
    public HelpTooltipPlacement Placement { get; }

    /// <summary>Optional "Learn more" link (web <c>learnMore</c>); null renders the body only.</summary>
    public HelpTooltipLearnMore? LearnMore { get; }

    /// <summary>Optional accessible-name override for the trigger (web <c>ariaLabel</c>); null uses the localized "More info".</summary>
    public string? AriaLabel { get; }

    /// <summary>An empty tooltip with no resolvable content — the view collapses to nothing (web <c>return null</c>).</summary>
    public static HelpTooltipModel Empty { get; } = new(null, null, null, HelpTooltipSize.Small, HelpTooltipPlacement.Top, null, null);

    /// <summary>Build a help tooltip from plain text (web <c>text</c> path).</summary>
    /// <param name="text">The body text (web <c>text</c>).</param>
    /// <param name="size">The trigger size tier (web <c>size</c>).</param>
    /// <param name="placement">The tooltip placement (web <c>placement</c>).</param>
    /// <param name="learnMore">Optional learn-more link (web <c>learnMore</c>).</param>
    /// <param name="ariaLabel">Optional accessible-name override (web <c>ariaLabel</c>).</param>
    public static HelpTooltipModel FromText(
        string text,
        HelpTooltipSize size = HelpTooltipSize.Small,
        HelpTooltipPlacement placement = HelpTooltipPlacement.Top,
        HelpTooltipLearnMore? learnMore = null,
        string? ariaLabel = null)
    {
        ArgumentNullException.ThrowIfNull(text);
        return new HelpTooltipModel(text, null, null, size, placement, learnMore, ariaLabel);
    }

    /// <summary>Build a help tooltip from an i18n key + English fallback (web <c>i18nKey</c> / <c>defaultValue</c> path).</summary>
    /// <param name="i18nKey">The body i18n key (web <c>i18nKey</c>).</param>
    /// <param name="defaultValue">The English fallback when the key is missing (web <c>defaultValue</c>).</param>
    /// <param name="size">The trigger size tier (web <c>size</c>).</param>
    /// <param name="placement">The tooltip placement (web <c>placement</c>).</param>
    /// <param name="learnMore">Optional learn-more link (web <c>learnMore</c>).</param>
    /// <param name="ariaLabel">Optional accessible-name override (web <c>ariaLabel</c>).</param>
    public static HelpTooltipModel FromKey(
        string i18nKey,
        string defaultValue,
        HelpTooltipSize size = HelpTooltipSize.Small,
        HelpTooltipPlacement placement = HelpTooltipPlacement.Top,
        HelpTooltipLearnMore? learnMore = null,
        string? ariaLabel = null)
    {
        ArgumentException.ThrowIfNullOrEmpty(i18nKey);
        ArgumentNullException.ThrowIfNull(defaultValue);
        return new HelpTooltipModel(null, i18nKey, defaultValue, size, placement, learnMore, ariaLabel);
    }

    /// <summary>
    /// Build a help tooltip from the raw web prop shape, reproducing the web content precedence exactly
    /// (<c>HelpTooltip.tsx</c> L61-63): a non-empty <paramref name="i18nKey"/> resolves through translation (with
    /// <paramref name="defaultValue"/> as the fallback), otherwise the plain <paramref name="text"/> is used.
    /// </summary>
    /// <param name="text">The plain text body (web <c>text</c>); ignored when <paramref name="i18nKey"/> is set.</param>
    /// <param name="i18nKey">The body i18n key (web <c>i18nKey</c>); takes precedence over <paramref name="text"/>.</param>
    /// <param name="defaultValue">The English fallback for <paramref name="i18nKey"/> (web <c>defaultValue</c>).</param>
    /// <param name="size">The trigger size tier (web <c>size</c>).</param>
    /// <param name="placement">The tooltip placement (web <c>placement</c>).</param>
    /// <param name="learnMore">Optional learn-more link (web <c>learnMore</c>).</param>
    /// <param name="ariaLabel">Optional accessible-name override (web <c>ariaLabel</c>).</param>
    public static HelpTooltipModel Create(
        string? text = null,
        string? i18nKey = null,
        string? defaultValue = null,
        HelpTooltipSize size = HelpTooltipSize.Small,
        HelpTooltipPlacement placement = HelpTooltipPlacement.Top,
        HelpTooltipLearnMore? learnMore = null,
        string? ariaLabel = null) =>
        new(text, i18nKey, defaultValue, size, placement, learnMore, ariaLabel);
}

/// <summary>
/// The fully projected, render-ready view of a <see cref="HelpTooltipModel"/> — everything the web component
/// derives before returning JSX (<c>HelpTooltip.tsx</c> L59-113): the <see cref="ResolvedText"/> body (from the
/// i18n key or the plain text), whether there is <see cref="HasContent"/> (the web <c>if (!resolved) return
/// null</c> guard, surfaced as <see cref="RendersNothing"/>), the trigger <see cref="Glyph"/> + <see cref="IconSize"/>,
/// the composed <see cref="AccessibleLabel"/> Narrator reads (web <c>ariaLabel ?? t('help.tooltip.iconLabel')</c>),
/// the <see cref="Placement"/>, the optional learn-more affordance (<see cref="HasLearnMore"/> /
/// <see cref="LearnMoreUrl"/> / <see cref="LearnMoreLabel"/> / <see cref="ExternalLinkGlyph"/>), and the
/// <see cref="TooltipRole"/> the revealed body declares. Pure data so every value is asserted headlessly.
/// </summary>
/// <param name="ResolvedText">The resolved body text (web <c>resolved</c>); empty when there is nothing to show.</param>
/// <param name="HasContent">True when <see cref="ResolvedText"/> is non-empty (web <c>resolved</c> truthy).</param>
/// <param name="RendersNothing">True when there is no content — the view collapses to nothing (web <c>return null</c>).</param>
/// <param name="Glyph">The trigger glyph (web Lucide <c>HelpCircle</c> stand-in).</param>
/// <param name="IconSize">The trigger glyph font size for the size tier (web <c>SIZE_CLASS</c>).</param>
/// <param name="AccessibleLabel">The trigger's accessible name (web <c>ariaLabel ?? t('help.tooltip.iconLabel')</c>).</param>
/// <param name="Placement">Where the tooltip sits relative to the trigger (web <c>placement</c>).</param>
/// <param name="HasLearnMore">True when the learn-more link renders (web <c>learnMore</c> present).</param>
/// <param name="LearnMoreUrl">The learn-more external target (web <c>learnMore.url</c>); null when absent.</param>
/// <param name="LearnMoreLabel">The learn-more label (web <c>learnMore.label ?? t('common.learnMore')</c>); empty when absent.</param>
/// <param name="ExternalLinkGlyph">The trailing glyph on the learn-more link (web Lucide <c>ExternalLink</c> stand-in).</param>
/// <param name="TooltipRole">The ARIA role the revealed body declares (web <c>role="tooltip"</c>).</param>
public sealed record HelpTooltipDisplay(
    string ResolvedText,
    bool HasContent,
    bool RendersNothing,
    string Glyph,
    double IconSize,
    string AccessibleLabel,
    HelpTooltipPlacement Placement,
    bool HasLearnMore,
    string? LearnMoreUrl,
    string LearnMoreLabel,
    string ExternalLinkGlyph,
    string TooltipRole);

/// <summary>
/// Pure projection from a <see cref="HelpTooltipModel"/> to its <see cref="HelpTooltipDisplay"/> — the native port
/// of <c>web/src/components/ui/HelpTooltip.tsx</c>. Reproduces the web derivations exactly: the body is the
/// translated <c>i18nKey</c> (with <c>defaultValue</c> as the fallback) when a key is supplied, otherwise the plain
/// <c>text</c> (web L61-63); an empty body means the surface renders nothing (web L67 <c>if (!resolved) return
/// null</c>); the trigger glyph size comes from the size tier (web <c>SIZE_CLASS</c>, L42-46); the accessible name
/// is the caller's <c>ariaLabel</c> or the localized <c>help.tooltip.iconLabel</c> "More info" (web L70); and the
/// learn-more label is the caller's override or the localized <c>common.learnMore</c> "Learn more" (web L87). No
/// WinUI types — so the projection is unit-tested without a UI host, and the view binds to its result.
/// </summary>
public static class HelpTooltipProjection
{
    /// <summary>Project <paramref name="model"/> into a render-ready display, resolving strings through <paramref name="localizer"/>.</summary>
    /// <param name="model">The render-time data model (the web props).</param>
    /// <param name="localizer">The i18n facade (P1/S10) every string resolves through (web <c>useTranslation</c>).</param>
    /// <returns>The render-ready display model.</returns>
    public static HelpTooltipDisplay Project(HelpTooltipModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        // web L61-63: i18nKey ? t(i18nKey, { defaultValue }) : (text ?? '').
        string resolved = !string.IsNullOrEmpty(model.I18nKey)
            ? localizer.GetString(model.I18nKey, model.DefaultValue ?? string.Empty)
            : (model.Text ?? string.Empty);

        bool hasContent = !string.IsNullOrEmpty(resolved);

        // web L70: ariaLabel ?? t('help.tooltip.iconLabel', { defaultValue: 'More info' }).
        string accessibleLabel = !string.IsNullOrEmpty(model.AriaLabel)
            ? model.AriaLabel!
            : localizer.GetString(HelpTooltipRegistration.IconLabelKey, HelpTooltipRegistration.IconLabelFallback);

        HelpTooltipLearnMore? learnMore = model.LearnMore;
        bool hasLearnMore = learnMore is not null;

        // web L87: learnMore.label ?? t('common.learnMore', { defaultValue: 'Learn more' }).
        string learnMoreLabel = hasLearnMore
            ? (!string.IsNullOrEmpty(learnMore!.Label)
                ? learnMore.Label!
                : localizer.GetString(HelpTooltipRegistration.LearnMoreKey, HelpTooltipRegistration.LearnMoreFallback))
            : string.Empty;

        return new HelpTooltipDisplay(
            ResolvedText: resolved,
            HasContent: hasContent,
            RendersNothing: !hasContent,
            Glyph: HelpTooltipRegistration.HelpGlyph,
            IconSize: HelpTooltipRegistration.IconSize(model.Size),
            AccessibleLabel: accessibleLabel,
            Placement: model.Placement,
            HasLearnMore: hasLearnMore,
            LearnMoreUrl: learnMore?.Url,
            LearnMoreLabel: learnMoreLabel,
            ExternalLinkGlyph: HelpTooltipRegistration.ExternalLinkGlyph,
            TooltipRole: HelpTooltipRegistration.TooltipRole);
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>HelpTooltip</c> surface (P1/S11 diagnostics contract). Help bodies can carry
/// user-facing copy, so the collector records only the operational <c>view.opened</c> event with the surface slug
/// — never the resolved text, accessible label or learn-more URL — so a diagnostics line can never leak fleet
/// state. Thread-safe; mirrors the peer surfaces' diagnostics collectors.
/// </summary>
public sealed class HelpTooltipDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional sink the operational event line is written to.</param>
    public HelpTooltipDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=HelpTooltip</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={HelpTooltipRegistration.Slug}");
    }
}
