using System.Globalization;
using System.Threading;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.WidgetPrimitives;

/// <summary>
/// Canonical metadata + layout metrics for the WidgetShell widget primitive — the native analogue of the
/// module-level identity of the web source (web/src/features/dashboard/widgets/WidgetShell.tsx). The web component
/// is the shared chrome every dashboard widget renders inside: an optional uppercase muted title row (with an icon,
/// a "?" help affordance, a data-freshness chip, a pin toggle and caller actions) above a scrollable content slot,
/// with an early <c>loading</c> branch (a full-height skeleton), an early <c>error</c> branch (a centered
/// query-error) and a subtle green "just updated" glow that fades over 1.5&#160;s whenever the data timestamp
/// advances. It reads no network data of its own (it is purely presentational), so this carries the diagnostics
/// slug, the root automation id, the i18n key behind the help affordance's accessible name (reused from the
/// existing catalogue), and the metrics the web Tailwind classes encode (the header / content paddings, the 11&#160;px
/// medium uppercase wide-tracked title, the inter-element gaps, the freshness overlay offset and the glow's colour /
/// blur / opacity / duration). UI-free so every value is asserted headlessly.
/// </summary>
public static class WidgetShellRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "WidgetShell";

    /// <summary>
    /// The root automation id the view stamps on itself. The web component declares no <c>data-testid</c> (it is an
    /// anonymous presentational wrapper), so this is the native-only stable hook UI-automation tests target.
    /// </summary>
    public const string RootAutomationId = "widget-shell";

    /// <summary>Header left padding in DIPs (web title row <c>px-4</c>).</summary>
    public const double HeaderPaddingLeft = 16;

    /// <summary>Header top padding in DIPs (web title row <c>pt-3</c>).</summary>
    public const double HeaderPaddingTop = 12;

    /// <summary>Header right padding in DIPs (web title row <c>px-4</c>).</summary>
    public const double HeaderPaddingRight = 16;

    /// <summary>Header bottom padding in DIPs (web title row <c>pb-1</c>).</summary>
    public const double HeaderPaddingBottom = 4;

    /// <summary>Content left padding in DIPs when not <c>noPadding</c> (web <c>px-4</c>).</summary>
    public const double ContentPaddingLeft = 16;

    /// <summary>Content right padding in DIPs when not <c>noPadding</c> (web <c>px-4</c>).</summary>
    public const double ContentPaddingRight = 16;

    /// <summary>Content bottom padding in DIPs when not <c>noPadding</c> (web <c>pb-3</c>).</summary>
    public const double ContentPaddingBottom = 12;

    /// <summary>Title font size in DIPs (web <c>text-[11px]</c>).</summary>
    public const double TitleFontSize = 11;

    /// <summary>Title font weight (web <c>font-medium</c>).</summary>
    public const double TitleFontWeight = 500;

    /// <summary>Title letter spacing in 1/1000&#160;em (web <c>tracking-wider</c> = 0.05&#160;em).</summary>
    public const double TitleCharacterSpacing = 50;

    /// <summary>Gap between the icon, title and help affordance in DIPs (web header left <c>gap-1.5</c>).</summary>
    public const double IconTitleGap = 6;

    /// <summary>Gap between the freshness chip, pin toggle and actions in DIPs (web header right <c>gap-2</c>).</summary>
    public const double HeaderActionsGap = 8;

    /// <summary>Top offset of the title-less freshness overlay in DIPs (web <c>top-1.5</c>).</summary>
    public const double FreshnessOverlayTop = 6;

    /// <summary>Right offset of the title-less freshness overlay in DIPs (web <c>right-1.5</c>).</summary>
    public const double FreshnessOverlayRight = 6;

    /// <summary>Duration the "just updated" glow holds before it has fully faded in milliseconds (web <c>setTimeout(…, 1500)</c>).</summary>
    public const int PulseDurationMs = 1500;

    /// <summary>Glow blur radius in DIPs (web <c>shadow-[0_0_12px_…]</c>).</summary>
    public const double PulseGlowBlurRadius = 12;

    /// <summary>Glow peak opacity (web <c>rgba(34,197,94,0.15)</c> alpha).</summary>
    public const double PulseGlowOpacity = 0.15;

    /// <summary>Glow colour red channel (web emerald <c>34</c>).</summary>
    public const byte PulseGlowRed = 34;

    /// <summary>Glow colour green channel (web emerald <c>197</c>).</summary>
    public const byte PulseGlowGreen = 197;

    /// <summary>Glow colour blue channel (web emerald <c>94</c>).</summary>
    public const byte PulseGlowBlue = 94;

    /// <summary>
    /// i18n key behind the help affordance's accessible name. The web source labels the help tooltip
    /// <c>aria-label={`More info about ${title}`}</c>; the native surface reuses the existing catalogue key
    /// <c>translation.a11y.helpFor</c> ("Help for {0}") so no new key is introduced.
    /// </summary>
    public const string HelpAccessibleNameKey = "translation.a11y.helpFor";

    /// <summary>English fallback for <see cref="HelpAccessibleNameKey"/> (the catalogue value, with the .NET positional <c>{0}</c> = title).</summary>
    public const string HelpAccessibleNameFallback = "Help for {0}";

    /// <summary>Compose the help affordance's accessible name for <paramref name="title"/> through the i18n facade.</summary>
    /// <param name="localizer">The i18n facade the label resolves through.</param>
    /// <param name="title">The widget title interpolated into the label.</param>
    public static string ResolveHelpAccessibleName(ILocalizer localizer, string title)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return string.Format(
            CultureInfo.CurrentCulture,
            localizer.GetString(HelpAccessibleNameKey, HelpAccessibleNameFallback),
            title ?? string.Empty);
    }
}

/// <summary>
/// The contextual-help metadata a caller attaches to a titled widget — the native analogue of the web
/// <c>WidgetHelp</c> interface (web/src/features/dashboard/widgets/types.ts L13-18). Either a static
/// <see cref="Text"/> or a translated <see cref="I18nKey"/> (with a <see cref="DefaultValue"/> fallback) supplies the
/// tooltip body, and an optional <see cref="LearnMoreUrl"/> (with an optional <see cref="LearnMoreLabel"/>) adds a
/// follow-on reference. Pure data so the projection is unit-tested without a UI host.
/// </summary>
public sealed record WidgetHelpInfo
{
    /// <summary>A static, already-localized tooltip body (web <c>text</c>); used when <see cref="I18nKey"/> is absent.</summary>
    public string? Text { get; init; }

    /// <summary>The i18n key the tooltip body resolves through (web <c>i18nKey</c>); preferred over <see cref="Text"/>.</summary>
    public string? I18nKey { get; init; }

    /// <summary>The English fallback for <see cref="I18nKey"/> (web <c>defaultValue</c>).</summary>
    public string? DefaultValue { get; init; }

    /// <summary>An optional "learn more" reference target (web <c>learnMore.url</c>); null/empty hides the reference.</summary>
    public string? LearnMoreUrl { get; init; }

    /// <summary>The optional visible label for the <see cref="LearnMoreUrl"/> reference (web <c>learnMore.label</c>).</summary>
    public string? LearnMoreLabel { get; init; }
}

/// <summary>
/// The inputs the WidgetShell primitive renders from — the native analogue of the props the web
/// <c>&lt;WidgetShell&gt;</c> receives from a dashboard widget (web/src/features/dashboard/widgets/WidgetShell.tsx
/// L12-51). The web <c>icon</c>, <c>actions</c> and <c>children</c> props are <c>ReactNode</c> slots hosted by the
/// view as live <see cref="Microsoft.UI.Xaml.UIElement"/>s, so they are not modelled here. The two web freshness
/// shapes (<c>query</c> vs the granular <c>updatedAt</c>/<c>isFetching</c>/<c>isStale</c>/<c>isError</c>/<c>onRefresh</c>
/// props) both collapse to the same four freshness primitives plus the <see cref="FreshnessCanRefresh"/> affordance
/// flag, gated by <see cref="HasFreshness"/> (web <c>updatedAt !== undefined || query !== undefined</c>). Everything
/// else is plain data so the projection and view-model are unit-tested without a UI host.
/// </summary>
public sealed record WidgetShellInput
{
    /// <summary>The optional widget title (web <c>title</c>); null/empty renders the title-less layout.</summary>
    public string? Title { get; init; }

    /// <summary>Whether the widget is loading (web <c>loading</c>): the shell renders a full-height skeleton.</summary>
    public bool Loading { get; init; }

    /// <summary>The optional error message (web <c>error</c>); non-empty renders the centered query-error branch.</summary>
    public string? ErrorMessage { get; init; }

    /// <summary>Whether the content slot drops its padding and clips instead of scrolling (web <c>noPadding</c>).</summary>
    public bool NoPadding { get; init; }

    /// <summary>The optional help metadata (web <c>help</c>); the "?" affordance shows only when a title is present.</summary>
    public WidgetHelpInfo? Help { get; init; }

    /// <summary>Whether a freshness chip is shown (web <c>updatedAt !== undefined || query !== undefined</c>).</summary>
    public bool HasFreshness { get; init; }

    /// <summary>When the data was last successfully fetched, or null (web <c>updatedAt</c> / <c>query.dataUpdatedAt</c>).</summary>
    public DateTimeOffset? UpdatedAt { get; init; }

    /// <summary>Whether a (re)fetch is currently in flight (web <c>isFetching</c>).</summary>
    public bool IsFetching { get; init; }

    /// <summary>Whether the data is past its freshness window (web <c>isStale</c>).</summary>
    public bool IsStale { get; init; }

    /// <summary>Whether the last fetch failed (web freshness <c>isError</c>; distinct from <see cref="ErrorMessage"/>).</summary>
    public bool IsError { get; init; }

    /// <summary>Whether the freshness chip offers a manual refresh affordance (web <c>onRefresh</c> present).</summary>
    public bool FreshnessCanRefresh { get; init; }

    /// <summary>The stable widget id used as the pin item id (web <c>widgetId</c>); pin shows only with a dashboard id.</summary>
    public string? WidgetId { get; init; }

    /// <summary>The dashboard id used as the pin context (web <c>dashboardId</c>); pin shows only with a widget id.</summary>
    public string? DashboardId { get; init; }
}

/// <summary>
/// The render-ready projection of one <see cref="WidgetShellInput"/> — everything the WinUI view needs to draw a
/// frame without recomputing anything, so the view stays a thin renderer and the composition is verified headlessly.
/// It is the native analogue of the values the web component body derives
/// (web/src/features/dashboard/widgets/WidgetShell.tsx L53-168): the mutually-exclusive loading / error / shell
/// branch (<see cref="ShowSkeleton"/> / <see cref="ShowError"/> with <see cref="ErrorMessage"/>), the title row
/// (<see cref="HasTitle"/> + the original <see cref="Title"/> for accessibility and the uppercase
/// <see cref="TitleDisplay"/> for rendering), the help affordance (<see cref="ShowHelp"/> + the resolved
/// <see cref="HelpTooltipText"/> and <see cref="HelpAccessibleName"/>), the freshness chip
/// (<see cref="ShowFreshness"/> + <see cref="FreshnessCompact"/> + the four freshness primitives), the pin toggle
/// (<see cref="ShowPin"/>), the content padding mode (<see cref="NoPadding"/>) and the pulse driver
/// (<see cref="EffectiveUpdatedAt"/>).
/// </summary>
public sealed record WidgetShellDisplay
{
    internal WidgetShellDisplay(
        bool showSkeleton,
        bool showError,
        string errorMessage,
        bool hasTitle,
        string title,
        string titleDisplay,
        bool showHelp,
        string helpTooltipText,
        string helpAccessibleName,
        bool hasLearnMore,
        string learnMoreUrl,
        string learnMoreLabel,
        bool showFreshness,
        bool freshnessCompact,
        bool freshnessCanRefresh,
        DateTimeOffset? updatedAt,
        bool isFetching,
        bool isStale,
        bool isError,
        bool showPin,
        string pinWidgetId,
        string pinDashboardId,
        bool noPadding,
        DateTimeOffset? effectiveUpdatedAt,
        string accessibleName)
    {
        ShowSkeleton = showSkeleton;
        ShowError = showError;
        ErrorMessage = errorMessage;
        HasTitle = hasTitle;
        Title = title;
        TitleDisplay = titleDisplay;
        ShowHelp = showHelp;
        HelpTooltipText = helpTooltipText;
        HelpAccessibleName = helpAccessibleName;
        HasLearnMore = hasLearnMore;
        LearnMoreUrl = learnMoreUrl;
        LearnMoreLabel = learnMoreLabel;
        ShowFreshness = showFreshness;
        FreshnessCompact = freshnessCompact;
        FreshnessCanRefresh = freshnessCanRefresh;
        UpdatedAt = updatedAt;
        IsFetching = isFetching;
        IsStale = isStale;
        IsError = isError;
        ShowPin = showPin;
        PinWidgetId = pinWidgetId;
        PinDashboardId = pinDashboardId;
        NoPadding = noPadding;
        EffectiveUpdatedAt = effectiveUpdatedAt;
        AccessibleName = accessibleName;
    }

    /// <summary>Whether the full-height loading skeleton is shown (web <c>if (loading) return &lt;Skeleton … /&gt;</c>).</summary>
    public bool ShowSkeleton { get; }

    /// <summary>Whether the centered query-error is shown (web <c>if (error) return …</c>); never set while loading.</summary>
    public bool ShowError { get; }

    /// <summary>The error message rendered in the query-error branch (web <c>new Error(error)</c>).</summary>
    public string ErrorMessage { get; }

    /// <summary>Whether the title row is rendered (web <c>title ? …</c>).</summary>
    public bool HasTitle { get; }

    /// <summary>The original title (for the accessible name / heading); empty when title-less.</summary>
    public string Title { get; }

    /// <summary>The uppercased title for display (web <c>uppercase</c>); empty when title-less.</summary>
    public string TitleDisplay { get; }

    /// <summary>Whether the "?" help affordance is shown (web <c>help &amp;&amp;</c> inside the title row).</summary>
    public bool ShowHelp { get; }

    /// <summary>The resolved tooltip body (the help text, plus the optional learn-more reference line).</summary>
    public string HelpTooltipText { get; }

    /// <summary>The help affordance's accessible name (web <c>aria-label</c>): "Help for {title}".</summary>
    public string HelpAccessibleName { get; }

    /// <summary>Whether the help metadata carries a learn-more reference (web <c>learnMore</c>).</summary>
    public bool HasLearnMore { get; }

    /// <summary>The learn-more reference target, or empty (web <c>learnMore.url</c>).</summary>
    public string LearnMoreUrl { get; }

    /// <summary>The learn-more reference visible label, or empty (web <c>learnMore.label</c>).</summary>
    public string LearnMoreLabel { get; }

    /// <summary>Whether the freshness chip is shown (web <c>showFreshness</c>).</summary>
    public bool ShowFreshness { get; }

    /// <summary>Whether the freshness chip is the icon-only compact form (web <c>freshnessCompact = !title</c>).</summary>
    public bool FreshnessCompact { get; }

    /// <summary>Whether the freshness chip offers a manual refresh affordance (web <c>onRefresh</c> present).</summary>
    public bool FreshnessCanRefresh { get; }

    /// <summary>When the data was last successfully fetched, or null (web <c>updatedAt</c>).</summary>
    public DateTimeOffset? UpdatedAt { get; }

    /// <summary>Whether a (re)fetch is in flight (web <c>isFetching</c>).</summary>
    public bool IsFetching { get; }

    /// <summary>Whether the data is past its freshness window (web <c>isStale</c>).</summary>
    public bool IsStale { get; }

    /// <summary>Whether the last fetch failed (web freshness <c>isError</c>).</summary>
    public bool IsError { get; }

    /// <summary>Whether the pin toggle is shown (web <c>widgetId &amp;&amp; dashboardId</c> inside the title row).</summary>
    public bool ShowPin { get; }

    /// <summary>The pin item id (web <c>widgetId</c>), or empty.</summary>
    public string PinWidgetId { get; }

    /// <summary>The pin context (web <c>dashboardId</c>), or empty.</summary>
    public string PinDashboardId { get; }

    /// <summary>Whether the content slot drops padding and clips (web <c>noPadding</c>): otherwise it pads and scrolls.</summary>
    public bool NoPadding { get; }

    /// <summary>The timestamp the pulse-on-change effect watches (web <c>effectiveUpdatedAt</c>); null suppresses the pulse.</summary>
    public DateTimeOffset? EffectiveUpdatedAt { get; }

    /// <summary>The shell's accessible name (the title when present, else empty so the content carries the semantics).</summary>
    public string AccessibleName { get; }
}

/// <summary>
/// Pure, UI-thread-free projection of one <see cref="WidgetShellInput"/> into a render-ready
/// <see cref="WidgetShellDisplay"/> — the native port of the web component body
/// (web/src/features/dashboard/widgets/WidgetShell.tsx L53-168). It resolves the mutually-exclusive
/// loading / error / shell branch (loading wins over error, web's early returns in order), the help text + accessible
/// name, the freshness gating (<c>showFreshness</c> + the <c>!title</c> compact rule) and the pin gating
/// (<c>widgetId &amp;&amp; dashboardId</c>, only inside the title row). It touches no view framework, so the WinUI
/// view and the unit tests share one source of truth.
/// </summary>
public static class WidgetShellProjection
{
    /// <summary>
    /// Project <paramref name="input"/>, resolving every string through <paramref name="localizer"/>. Reproduces the
    /// web body: the <c>loading</c> / <c>error</c> early returns (loading first), the title row's uppercase title and
    /// help affordance, the <c>showFreshness</c> + <c>freshnessCompact</c> rules and the title-scoped pin gating.
    /// </summary>
    /// <param name="input">The resolved props (web component props); never null.</param>
    /// <param name="localizer">The i18n facade every string resolves through; never null.</param>
    public static WidgetShellDisplay Project(WidgetShellInput input, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(input);
        ArgumentNullException.ThrowIfNull(localizer);

        // web L82-87: loading returns the skeleton first; only then does the error branch return.
        bool showSkeleton = input.Loading;
        string errorMessage = input.ErrorMessage ?? string.Empty;
        bool showError = !showSkeleton && errorMessage.Length > 0;

        string title = input.Title ?? string.Empty;
        bool hasTitle = title.Length > 0;
        string titleDisplay = hasTitle ? title.ToUpper(CultureInfo.CurrentCulture) : string.Empty;

        (bool showHelp, string helpTooltipText, string helpAccessibleName, bool hasLearnMore, string learnMoreUrl, string learnMoreLabel) =
            ResolveHelp(input.Help, hasTitle, title, localizer);

        // web L89-91: showFreshness = updatedAt !== undefined || query !== undefined; freshnessCompact = !title.
        bool showFreshness = input.HasFreshness;
        bool freshnessCompact = !hasTitle;

        // web L139-146: the pin only renders inside the title row, and only when both ids are present.
        string pinWidgetId = input.WidgetId ?? string.Empty;
        string pinDashboardId = input.DashboardId ?? string.Empty;
        bool showPin = hasTitle && pinWidgetId.Length > 0 && pinDashboardId.Length > 0;

        // web L65: effectiveUpdatedAt = updatedAt ?? query?.dataUpdatedAt — both collapse to the snapshot timestamp.
        DateTimeOffset? effectiveUpdatedAt = input.HasFreshness ? input.UpdatedAt : null;

        string accessibleName = hasTitle ? title : string.Empty;

        return new WidgetShellDisplay(
            showSkeleton: showSkeleton,
            showError: showError,
            errorMessage: errorMessage,
            hasTitle: hasTitle,
            title: title,
            titleDisplay: titleDisplay,
            showHelp: showHelp,
            helpTooltipText: helpTooltipText,
            helpAccessibleName: helpAccessibleName,
            hasLearnMore: hasLearnMore,
            learnMoreUrl: learnMoreUrl,
            learnMoreLabel: learnMoreLabel,
            showFreshness: showFreshness,
            freshnessCompact: freshnessCompact,
            freshnessCanRefresh: input.FreshnessCanRefresh,
            updatedAt: input.UpdatedAt,
            isFetching: input.IsFetching,
            isStale: input.IsStale,
            isError: input.IsError,
            showPin: showPin,
            pinWidgetId: pinWidgetId,
            pinDashboardId: pinDashboardId,
            noPadding: input.NoPadding,
            effectiveUpdatedAt: effectiveUpdatedAt,
            accessibleName: accessibleName);
    }

    private static (bool ShowHelp, string TooltipText, string AccessibleName, bool HasLearnMore, string LearnMoreUrl, string LearnMoreLabel)
        ResolveHelp(WidgetHelpInfo? help, bool hasTitle, string title, ILocalizer localizer)
    {
        // web L125: the help affordance is rendered only when `help` is present AND the widget has a visible title.
        if (help is null || !hasTitle)
        {
            return (false, string.Empty, string.Empty, false, string.Empty, string.Empty);
        }

        // web HelpTooltip: prefer the translated i18nKey (with defaultValue), else the static text.
        string body;
        if (!string.IsNullOrEmpty(help.I18nKey))
        {
            string fallback = help.DefaultValue ?? help.Text ?? string.Empty;
            body = localizer.GetString(help.I18nKey, fallback);
        }
        else
        {
            body = help.Text ?? string.Empty;
        }

        bool hasLearnMore = !string.IsNullOrEmpty(help.LearnMoreUrl);
        string learnMoreUrl = hasLearnMore ? help.LearnMoreUrl! : string.Empty;
        string learnMoreLabel = help.LearnMoreLabel ?? string.Empty;

        // The native tooltip is text-only, so the learn-more reference is surfaced as a second line (its label when
        // supplied, otherwise the bare url) — the web renders it as a follow-on "learn more" link.
        string tooltipText = body;
        if (hasLearnMore)
        {
            string reference = learnMoreLabel.Length > 0 ? learnMoreLabel : learnMoreUrl;
            tooltipText = tooltipText.Length > 0 ? $"{tooltipText}\n{reference}" : reference;
        }

        string accessibleName = WidgetShellRegistration.ResolveHelpAccessibleName(localizer, title);
        return (true, tooltipText, accessibleName, hasLearnMore, learnMoreUrl, learnMoreLabel);
    }
}

/// <summary>
/// PII-safe diagnostics for the WidgetShell surface (P1/S11 diagnostics contract). The shell renders only
/// caller-supplied content, so the collector records ONLY the operational <c>view.opened</c> event with the surface
/// slug — never the title, the error message or any content. Thread-safe; mirrors the peer surfaces' diagnostics
/// collectors.
/// </summary>
public sealed class WidgetShellDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public WidgetShellDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=WidgetShell</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={WidgetShellRegistration.Slug}");
    }
}
