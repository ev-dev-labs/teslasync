namespace TeslaSync.App.SharedSurfaces.UsageCardSurface;

/// <summary>
/// Visual intent driving the accent colour for the budget bar, the band ring / tint, the detail value text and
/// the banner — the native port of the web <c>UsageCardIntent</c> union
/// (web/src/components/data-display/UsageCard.tsx L23, <c>'normal' | 'warn' | 'danger'</c>).
/// </summary>
public enum UsageCardIntent
{
    /// <summary>Neutral intent — accent (cyan) bar, subtle surface band, primary value text (web <c>normal</c>).</summary>
    Normal,

    /// <summary>Cautionary intent — amber bar / ring / value (web <c>warn</c>).</summary>
    Warn,

    /// <summary>Critical intent — red bar / ring / value (web <c>danger</c>).</summary>
    Danger,
}

/// <summary>
/// Canonical metadata for the UsageCard shared surface — the native analogue of the module-level identity of
/// web/src/components/data-display/UsageCard.tsx. The web card is "pure presentational: no hooks, no API calls,
/// no derived state" and is anonymous (zero <c>t()</c> calls — every visible string arrives already-localized
/// through its props), so this registration carries only the diagnostics slug the surface registers under
/// (P1/S11) plus the budget-bar range constant the projection reproduces from the web
/// <c>Math.min(100, budget.pct)</c> clamp.
/// </summary>
public static class UsageCardRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "UsageCard";

    /// <summary>
    /// The full-bar value of the budget progress bar — the native port of the web visual width clamp
    /// (web/src/components/data-display/UsageCard.tsx L226, <c>Math.max(0, Math.min(100, budget.pct))</c>).
    /// </summary>
    public const double BudgetBarMax = 100;
}

/// <summary>
/// Pure, view-framework-free mapping from a <see cref="UsageCardIntent"/> to the design-token resource keys the
/// WinUI view tints from — the native port of the web Tailwind intent maps
/// (web/src/components/data-display/UsageCard.tsx L137-L165: <c>intentBarBg</c>, <c>intentBandRing</c>,
/// <c>intentValueText</c>). Kept here (rather than in the view) so the intent → token contract is unit-tested
/// without a XAML runtime; the view resolves these keys against <c>Application.Current.Resources</c>.
/// </summary>
public static class UsageCardPalette
{
    /// <summary>
    /// Theme brush key for the budget bar fill (web <c>intentBarBg</c>): accent (cyan) for normal, the warning
    /// brush for warn, the danger brush for danger.
    /// </summary>
    /// <param name="intent">The visual intent.</param>
    /// <returns>A token brush resource key.</returns>
    public static string BudgetBarBrushKey(UsageCardIntent intent) => intent switch
    {
        UsageCardIntent.Warn => "TsColorWarningBrush",
        UsageCardIntent.Danger => "TsColorDangerBrush",
        _ => "TsColorAccentBrush",
    };

    /// <summary>
    /// Theme brush key for a detail cell's value text (web <c>intentValueText</c>): the primary text brush for
    /// normal, the warning brush for warn, the danger brush for danger.
    /// </summary>
    /// <param name="intent">The visual intent.</param>
    /// <returns>A token brush resource key.</returns>
    public static string ValueBrushKey(UsageCardIntent intent) => intent switch
    {
        UsageCardIntent.Warn => "TsColorWarningBrush",
        UsageCardIntent.Danger => "TsColorDangerBrush",
        _ => "TsColorTextPrimaryBrush",
    };

    /// <summary>
    /// Raw colour token key used to tint a band's fill + ring for warn / danger (web <c>intentBandRing</c>
    /// <c>bg-amber-500/10 ring-amber-500/30</c> and the red equivalent). Returns null for
    /// <see cref="UsageCardIntent.Normal"/>, whose band uses the flat surface-glass background with no ring
    /// (web <c>bg-white/[0.03]</c>).
    /// </summary>
    /// <param name="intent">The visual intent.</param>
    /// <returns>A raw colour resource key, or null for the neutral surface treatment.</returns>
    public static string? BandTintColorKey(UsageCardIntent intent) => intent switch
    {
        UsageCardIntent.Warn => "TsColorWarningColor",
        UsageCardIntent.Danger => "TsColorDangerColor",
        _ => null,
    };
}

/// <summary>
/// The optional budget progress bar inputs (web <c>UsageCardBudget</c>,
/// web/src/components/data-display/UsageCard.tsx L77-L90). The card hides the whole budget section when no
/// budget is supplied, so consumers without a spend cap (e.g. self-hosted Ollama) skip the bar. Strings arrive
/// already-localized; null strings normalise to empty downstream so the projection never dereferences null.
/// </summary>
public sealed record UsageCardBudget
{
    /// <summary>Pre-formatted "spent of total" headline, e.g. "$0.42 of $5.00" (web <c>headline</c>).</summary>
    public string Headline { get; init; } = string.Empty;

    /// <summary>Optional right-side caption, e.g. "8% of monthly credit" (web <c>rightLabel</c>).</summary>
    public string? RightLabel { get; init; }

    /// <summary>Optional caption under the bar, e.g. "Day 5 of 30 · resets in 25 days" (web <c>caption</c>).</summary>
    public string? Caption { get; init; }

    /// <summary>The 0..100 percentage used for both the bar width and the announced value (web <c>pct</c>).</summary>
    public double Pct { get; init; }

    /// <summary>The visual intent driving the bar colour (web <c>intent</c>; default <see cref="UsageCardIntent.Normal"/>).</summary>
    public UsageCardIntent Intent { get; init; } = UsageCardIntent.Normal;

    /// <summary>The screen-reader label naming the budget (web <c>ariaLabel</c>); required for assistive tech.</summary>
    public string AriaLabel { get; init; } = string.Empty;
}

/// <summary>
/// One at-a-glance band rendered in the band grid (web <c>UsageCardBand</c>,
/// web/src/components/data-display/UsageCard.tsx L30-L37). An optional leading icon sits before the uppercase
/// label, the value is the large tabular headline, and the optional sub line is the small muted subtitle.
/// </summary>
public sealed record UsageCardBand
{
    /// <summary>Optional leading Segoe Fluent Icons glyph shown before the label (web <c>icon</c>).</summary>
    public string? IconGlyph { get; init; }

    /// <summary>The uppercase band label (web <c>label</c>).</summary>
    public string Label { get; init; } = string.Empty;

    /// <summary>The large tabular value headline (web <c>value</c>).</summary>
    public string Value { get; init; } = string.Empty;

    /// <summary>Optional small muted subtitle line (web <c>sub</c>).</summary>
    public string? Sub { get; init; }

    /// <summary>The visual intent — adds a coloured ring + tinted background (web <c>intent</c>; default normal).</summary>
    public UsageCardIntent Intent { get; init; } = UsageCardIntent.Normal;
}

/// <summary>
/// One key/value cell in the detail grid (web <c>UsageCardDetail</c>,
/// web/src/components/data-display/UsageCard.tsx L44-L49). Used for "useful requests / skipped polls / avg
/// latency / error rate"-style tabular pairs; the intent colours the value text (e.g. red for high error rates).
/// </summary>
public sealed record UsageCardDetail
{
    /// <summary>The muted cell label (web <c>label</c>).</summary>
    public string Label { get; init; } = string.Empty;

    /// <summary>The tabular cell value (web <c>value</c>).</summary>
    public string Value { get; init; } = string.Empty;

    /// <summary>The visual intent colouring the value text (web <c>intent</c>; default normal).</summary>
    public UsageCardIntent Intent { get; init; } = UsageCardIntent.Normal;
}

/// <summary>
/// One row in a top-list breakdown (web <c>UsageCardTopListItem</c>,
/// web/src/components/data-display/UsageCard.tsx L55-L59). The label is the left-aligned monospace name; the
/// value is the right-aligned count.
/// </summary>
public sealed record UsageCardTopListItem
{
    /// <summary>A stable key for the row (web <c>key</c>).</summary>
    public string Key { get; init; } = string.Empty;

    /// <summary>The left-aligned monospace label (web <c>label</c>).</summary>
    public string Label { get; init; } = string.Empty;

    /// <summary>The right-aligned value (web <c>value</c>).</summary>
    public string Value { get; init; } = string.Empty;
}

/// <summary>
/// One top-list block rendered in the block grid (web <c>UsageCardTopList</c>,
/// web/src/components/data-display/UsageCard.tsx L65-L70). Each block has its own optional icon, header and list
/// of <see cref="UsageCardTopListItem"/> rows.
/// </summary>
public sealed record UsageCardTopList
{
    /// <summary>A stable key for the block (web <c>key</c>).</summary>
    public string Key { get; init; } = string.Empty;

    /// <summary>Optional leading Segoe Fluent Icons glyph shown before the title (web <c>icon</c>).</summary>
    public string? IconGlyph { get; init; }

    /// <summary>The uppercase block title (web <c>title</c>).</summary>
    public string Title { get; init; } = string.Empty;

    /// <summary>The rows in the block (web <c>items</c>); never null.</summary>
    public IReadOnlyList<UsageCardTopListItem> Items { get; init; } = Array.Empty<UsageCardTopListItem>();
}

/// <summary>
/// The optional callout banner inputs (web <c>UsageCardBanner</c>,
/// web/src/components/data-display/UsageCard.tsx L98-L104). Rendered after the top-lists, before the footer, for
/// "over monthly credit"-style status messages; defaults to danger intent since most callouts here are warnings.
/// </summary>
public sealed record UsageCardBanner
{
    /// <summary>The banner heading (web <c>title</c>).</summary>
    public string Title { get; init; } = string.Empty;

    /// <summary>The banner description line (web <c>description</c>).</summary>
    public string Description { get; init; } = string.Empty;

    /// <summary>The visual intent (web <c>intent</c>; defaults to <see cref="UsageCardIntent.Danger"/> like the web).</summary>
    public UsageCardIntent Intent { get; init; } = UsageCardIntent.Danger;

    /// <summary>Optional leading Segoe Fluent Icons glyph overriding the variant default (web <c>icon</c>).</summary>
    public string? IconGlyph { get; init; }
}

/// <summary>
/// One footer link (web <c>UsageCardFooterLink</c>, web/src/components/data-display/UsageCard.tsx L110-L118).
/// The card raises a navigation request carrying the <see cref="Route"/> rather than navigating itself (the
/// native analogue of the web react-router <c>Link</c> / external anchor); a trailing external-link glyph is
/// always shown, matching the web.
/// </summary>
public sealed record UsageCardFooterLink
{
    /// <summary>A stable key for the link (web <c>key</c>).</summary>
    public string Key { get; init; } = string.Empty;

    /// <summary>The navigation target — an in-app route or an external URL (web <c>to</c>).</summary>
    public string Route { get; init; } = string.Empty;

    /// <summary>The link label (web <c>label</c>).</summary>
    public string Label { get; init; } = string.Empty;

    /// <summary>Whether the link renders as the primary (filled chip) variant (web <c>primary</c>; default secondary).</summary>
    public bool Primary { get; init; }

    /// <summary>Whether the link opens an external URL in the browser (web <c>external</c>; default in-app navigation).</summary>
    public bool External { get; init; }
}

/// <summary>
/// The full set of presentational inputs for one <see cref="UsageCard"/> — the native port of the web
/// <c>UsageCardProps</c> (web/src/components/data-display/UsageCard.tsx L120-L131). Every region is optional and
/// independently shown, exactly like the web card; when none is present the surface renders a friendly empty
/// state instead of a blank box. Null collections normalise to empty in the projection so the view never
/// iterates null.
/// </summary>
public sealed record UsageCardInput
{
    /// <summary>The optional budget progress bar (web <c>budget</c>).</summary>
    public UsageCardBudget? Budget { get; init; }

    /// <summary>The at-a-glance bands (web <c>bands</c>); null / empty hides the band grid.</summary>
    public IReadOnlyList<UsageCardBand>? Bands { get; init; }

    /// <summary>The detail cells (web <c>details</c>); null / empty hides the detail grid.</summary>
    public IReadOnlyList<UsageCardDetail>? Details { get; init; }

    /// <summary>The top-list blocks (web <c>topLists</c>); null / empty hides the top-list grid.</summary>
    public IReadOnlyList<UsageCardTopList>? TopLists { get; init; }

    /// <summary>The optional callout banner (web <c>banner</c>).</summary>
    public UsageCardBanner? Banner { get; init; }

    /// <summary>The footer links (web <c>footer</c>); null / empty hides the footer row.</summary>
    public IReadOnlyList<UsageCardFooterLink>? Footer { get; init; }

    /// <summary>
    /// The already-localized message shown in the empty state when no region is present (web <c>emptyMessage</c>).
    /// Supplied by the host; when empty the empty state shows its neutral icon alone, never English boilerplate.
    /// </summary>
    public string? EmptyMessage { get; init; }
}

/// <summary>
/// The render-ready projection of a <see cref="UsageCardBudget"/> — the native analogue of the values the web
/// <c>BudgetSection</c> derives in its body (web/src/components/data-display/UsageCard.tsx L220-L262): the
/// normalized headline / right-label / caption strings and which are shown, the clamped bar value, the
/// unclamped announced percentage (so screen readers announce over-budget overflow accurately, the web
/// <c>aria-valuenow</c>), the accent token key and the accessible name.
/// </summary>
public sealed record UsageCardBudgetView
{
    /// <summary>The "spent of total" headline (web <c>budget.headline</c>).</summary>
    public string Headline { get; init; } = string.Empty;

    /// <summary>The right-side caption text (web <c>budget.rightLabel</c>); empty when none.</summary>
    public string RightLabel { get; init; } = string.Empty;

    /// <summary>Whether the right-side caption is shown (web <c>budget.rightLabel &amp;&amp; …</c>).</summary>
    public bool ShowRightLabel { get; init; }

    /// <summary>Whether the right-side caption uses the danger emphasis (web <c>intent === 'danger'</c>).</summary>
    public bool RightLabelIsDanger { get; init; }

    /// <summary>The caption under the bar (web <c>budget.caption</c>); empty when none.</summary>
    public string Caption { get; init; } = string.Empty;

    /// <summary>Whether the caption under the bar is shown (web <c>budget.caption &amp;&amp; …</c>).</summary>
    public bool ShowCaption { get; init; }

    /// <summary>The clamped 0..100 bar fill value (web visual width <c>Math.max(0, Math.min(100, pct))</c>).</summary>
    public double BarValue { get; init; }

    /// <summary>The unclamped, non-negative announced percentage (web <c>aria-valuenow</c> = <c>Math.max(0, Math.round(pct))</c>).</summary>
    public int AnnouncedPercent { get; init; }

    /// <summary>The token brush key for the bar fill (web <c>intentBarBg</c>).</summary>
    public string AccentBrushKey { get; init; } = "TsColorAccentBrush";

    /// <summary>The screen-reader name for the bar — the supplied aria-label, falling back to the headline.</summary>
    public string AccessibleName { get; init; } = string.Empty;
}

/// <summary>
/// The render-ready projection of one <see cref="UsageCardInput"/> — everything the WinUI view needs to draw a
/// frame without recomputing anything, so the view is a thin renderer and the logic is verified headlessly. It
/// is the native analogue of the web card body (web/src/components/data-display/UsageCard.tsx L171-L214): which
/// regions are shown, the normalized (non-null) band / detail / top-list / footer collections, the projected
/// budget view, the banner, the empty-state decision and a Narrator name for the card region.
/// </summary>
public sealed class UsageCardDisplay
{
    internal UsageCardDisplay(
        bool showEmptyState,
        string emptyMessage,
        UsageCardBudgetView? budget,
        IReadOnlyList<UsageCardBand> bands,
        IReadOnlyList<UsageCardDetail> details,
        IReadOnlyList<UsageCardTopList> topLists,
        UsageCardBanner? banner,
        IReadOnlyList<UsageCardFooterLink> footer,
        string accessibleName)
    {
        ShowEmptyState = showEmptyState;
        EmptyMessage = emptyMessage;
        Budget = budget;
        Bands = bands;
        Details = details;
        TopLists = topLists;
        Banner = banner;
        Footer = footer;
        AccessibleName = accessibleName;
    }

    /// <summary>
    /// True when no region is present and the surface shows a friendly empty state instead of a blank box (web
    /// <c>!hasAnything</c>, web/src/components/data-display/UsageCard.tsx L191).
    /// </summary>
    public bool ShowEmptyState { get; }

    /// <summary>The already-localized empty-state message (web <c>emptyMessage</c>); empty shows the neutral icon alone.</summary>
    public string EmptyMessage { get; }

    /// <summary>True when any region is present (web <c>hasAnything</c>).</summary>
    public bool HasAnything => !ShowEmptyState;

    /// <summary>The projected budget bar, or null when no budget is supplied (web <c>budget ? … : null</c>).</summary>
    public UsageCardBudgetView? Budget { get; }

    /// <summary>Whether the budget section is drawn.</summary>
    public bool ShowBudget => Budget is not null;

    /// <summary>The at-a-glance bands (never null; empty when none).</summary>
    public IReadOnlyList<UsageCardBand> Bands { get; }

    /// <summary>Whether the band grid is drawn (web <c>bands &amp;&amp; bands.length &gt; 0</c>).</summary>
    public bool ShowBands => Bands.Count > 0;

    /// <summary>The detail cells (never null; empty when none).</summary>
    public IReadOnlyList<UsageCardDetail> Details { get; }

    /// <summary>Whether the detail grid is drawn (web <c>details &amp;&amp; details.length &gt; 0</c>).</summary>
    public bool ShowDetails => Details.Count > 0;

    /// <summary>The top-list blocks (never null; empty when none).</summary>
    public IReadOnlyList<UsageCardTopList> TopLists { get; }

    /// <summary>Whether the top-list grid is drawn (web <c>topLists &amp;&amp; topLists.length &gt; 0</c>).</summary>
    public bool ShowTopLists => TopLists.Count > 0;

    /// <summary>The callout banner, or null when none (web <c>banner ? … : null</c>).</summary>
    public UsageCardBanner? Banner { get; }

    /// <summary>Whether the banner is drawn.</summary>
    public bool ShowBanner => Banner is not null;

    /// <summary>The footer links (never null; empty when none).</summary>
    public IReadOnlyList<UsageCardFooterLink> Footer { get; }

    /// <summary>Whether the footer row is drawn (web <c>footer &amp;&amp; footer.length &gt; 0</c>).</summary>
    public bool ShowFooter => Footer.Count > 0;

    /// <summary>The Narrator name for the card region — never empty while any region is present.</summary>
    public string AccessibleName { get; }
}

/// <summary>
/// Pure, UI-thread-free projection of one <see cref="UsageCardInput"/> into a render-ready
/// <see cref="UsageCardDisplay"/> — the native port of the web card + <c>BudgetSection</c> bodies
/// (web/src/components/data-display/UsageCard.tsx L171-L262). It normalises the optional collections, computes
/// the budget bar math (the clamped fill width and the unclamped announced percentage), decides which regions
/// render and derives the Narrator name. It resolves no i18n keys (the web component is anonymous — every
/// visible string is supplied already-localized) and touches no view framework, so the WinUI view and the unit
/// tests share one source of truth.
/// </summary>
public static class UsageCardProjection
{
    /// <summary>
    /// Project <paramref name="input"/> into the render-ready display, reproducing the web composition exactly:
    /// the budget bar, the band grid, the detail grid, the top-list grid, the banner and the footer — or the
    /// empty state when none is present.
    /// </summary>
    /// <param name="input">The presentational inputs; never null.</param>
    /// <returns>The render-ready projection.</returns>
    public static UsageCardDisplay Project(UsageCardInput input)
    {
        ArgumentNullException.ThrowIfNull(input);

        IReadOnlyList<UsageCardBand> bands = input.Bands ?? Array.Empty<UsageCardBand>();
        IReadOnlyList<UsageCardDetail> details = input.Details ?? Array.Empty<UsageCardDetail>();
        IReadOnlyList<UsageCardTopList> topLists = input.TopLists ?? Array.Empty<UsageCardTopList>();
        IReadOnlyList<UsageCardFooterLink> footer = input.Footer ?? Array.Empty<UsageCardFooterLink>();

        UsageCardBudgetView? budget = input.Budget is { } b ? ProjectBudget(b) : null;

        bool hasAnything =
            budget is not null ||
            bands.Count > 0 ||
            details.Count > 0 ||
            topLists.Count > 0 ||
            input.Banner is not null ||
            footer.Count > 0;

        string accessibleName = ResolveAccessibleName(input, budget, bands, details, topLists, footer);

        return new UsageCardDisplay(
            showEmptyState: !hasAnything,
            emptyMessage: input.EmptyMessage ?? string.Empty,
            budget: budget,
            bands: bands,
            details: details,
            topLists: topLists,
            banner: input.Banner,
            footer: footer,
            accessibleName: accessibleName);
    }

    private static UsageCardBudgetView ProjectBudget(UsageCardBudget budget)
    {
        double pct = double.IsNaN(budget.Pct) ? 0 : budget.Pct;
        string rightLabel = budget.RightLabel ?? string.Empty;
        string caption = budget.Caption ?? string.Empty;
        string aria = string.IsNullOrEmpty(budget.AriaLabel) ? budget.Headline : budget.AriaLabel;

        return new UsageCardBudgetView
        {
            Headline = budget.Headline ?? string.Empty,
            RightLabel = rightLabel,
            ShowRightLabel = !string.IsNullOrEmpty(rightLabel),
            RightLabelIsDanger = budget.Intent == UsageCardIntent.Danger,
            Caption = caption,
            ShowCaption = !string.IsNullOrEmpty(caption),
            BarValue = Math.Clamp(pct, 0, UsageCardRegistration.BudgetBarMax),
            AnnouncedPercent = Math.Max(0, (int)Math.Round(pct, MidpointRounding.AwayFromZero)),
            AccentBrushKey = UsageCardPalette.BudgetBarBrushKey(budget.Intent),
            AccessibleName = aria,
        };
    }

    private static string ResolveAccessibleName(
        UsageCardInput input,
        UsageCardBudgetView? budget,
        IReadOnlyList<UsageCardBand> bands,
        IReadOnlyList<UsageCardDetail> details,
        IReadOnlyList<UsageCardTopList> topLists,
        IReadOnlyList<UsageCardFooterLink> footer)
    {
        if (!string.IsNullOrEmpty(budget?.AccessibleName))
        {
            return budget!.AccessibleName;
        }

        if (!string.IsNullOrEmpty(input.Banner?.Title))
        {
            return input.Banner!.Title;
        }

        if (bands.Count > 0 && !string.IsNullOrEmpty(bands[0].Label))
        {
            return bands[0].Label;
        }

        if (details.Count > 0 && !string.IsNullOrEmpty(details[0].Label))
        {
            return details[0].Label;
        }

        if (topLists.Count > 0 && !string.IsNullOrEmpty(topLists[0].Title))
        {
            return topLists[0].Title;
        }

        if (footer.Count > 0 && !string.IsNullOrEmpty(footer[0].Label))
        {
            return footer[0].Label;
        }

        return input.EmptyMessage ?? string.Empty;
    }
}

/// <summary>
/// PII-safe diagnostics for the UsageCard surface (P1/S11 diagnostics contract). The card frames user-facing
/// spend / volume values, so the collector records only the operational <see cref="RecordViewOpened"/> signal
/// with the surface slug — never a headline, label or amount. Thread-safe; mirrors the other shared-surface
/// diagnostics collectors.
/// </summary>
public sealed class UsageCardDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional sink the operational event string is forwarded to.</param>
    public UsageCardDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=UsageCard</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={UsageCardRegistration.Slug}");
    }
}
