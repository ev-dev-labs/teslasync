using System.Diagnostics.CodeAnalysis;
using System.Globalization;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The four mutually-exclusive body states the <c>PageContainer</c> selects between — the native discriminator for
/// the web component's ternary chain (web/src/components/layout/PageContainer.tsx L111-125):
/// <c>loading ? &lt;Spinner&gt; : error ? &lt;errorCard&gt; : empty ? &lt;emptyState&gt; : &lt;PageErrorBoundary&gt;</c>.
/// The header (title / subtitle / actions) is always rendered above the body regardless of which state is active.
/// </summary>
public enum PageContainerState
{
    /// <summary>The web <c>loading</c> branch — a centred large <c>Spinner</c> replaces the body (web L111-114).</summary>
    Loading,

    /// <summary>The web <c>error</c> branch — a danger-tinted card showing the error message replaces the body (web L115-118).</summary>
    Error,

    /// <summary>The web <c>empty</c> branch — a centred "no data" message replaces the body (web L119-122).</summary>
    Empty,

    /// <summary>The web default branch — the page children wrapped in a page-level error boundary (web L123-125).</summary>
    Content,
}

/// <summary>
/// One immutable description of what the <c>PageContainer</c> is asked to render — the native analogue of the web
/// component's props plus the resolved body state (web/src/components/layout/PageContainer.tsx L36-93): the
/// <see cref="Title"/> / optional <see cref="Subtitle"/> header, the body gates (<see cref="Loading"/>,
/// <see cref="ErrorMessage"/> — non-null means the web <c>error</c> prop is truthy, <see cref="Empty"/> with its
/// optional <see cref="EmptyMessage"/> override), and the header-affordance flags (<see cref="HasActions"/> — the
/// web <c>actions</c> node is present, <see cref="CopyLink"/> — the web <c>copyLink</c> prop, <see cref="HasFreshness"/>
/// — the web <c>resolvedQuery</c> is non-null). Pure data — no WinUI types — so the projection is unit-tested
/// without a UI host.
/// </summary>
/// <param name="Title">The page title (web <c>title</c>, rendered as the <c>h1</c>).</param>
/// <param name="Subtitle">The optional sub-heading (web <c>subtitle</c>); null/blank hides it.</param>
/// <param name="Loading">Whether the loading spinner replaces the body (web <c>loading</c>).</param>
/// <param name="ErrorMessage">The user-facing error message (web <c>error.message</c>); null means no error (the web <c>error</c> prop is null).</param>
/// <param name="Empty">Whether the empty state replaces the body (web <c>empty</c>).</param>
/// <param name="EmptyMessage">The caller's empty-state override (web <c>emptyMessage</c>); null falls back to the "No {title} found." default.</param>
/// <param name="HasActions">Whether a caller actions node is present (web <c>actions</c> truthy).</param>
/// <param name="CopyLink">Whether the "Copy link" affordance is shown (web <c>copyLink</c>).</param>
/// <param name="HasFreshness">Whether the data-freshness chip is shown (web <c>resolvedQuery != null</c>).</param>
public sealed record PageContainerRequest(
    string Title,
    string? Subtitle,
    bool Loading,
    string? ErrorMessage,
    bool Empty,
    string? EmptyMessage,
    bool HasActions,
    bool CopyLink,
    bool HasFreshness);

/// <summary>
/// Canonical metadata for the <c>PageContainer</c> shared surface — the native mirror of the literals, layout
/// constants and the inline empty-message template in web/src/components/layout/PageContainer.tsx. Carries the
/// diagnostics slug, the stable automation ids for the surface and its regions, the generated design-token brush
/// keys the title / subtitle / empty / error chrome tint through (so light / dark / high-contrast all flow from the
/// token pipeline rather than hard-coded Tailwind classes), the danger-tint recipe the error card is painted with
/// (web <c>border-red-200 bg-red-50</c> / dark variants), the ARIA live urgencies each body state declares, and the
/// i18n keys (each with the English fallback the catalogue ships) the loading label, the empty-message default and
/// the copy-link affordance reference. UI-free so the mapping is asserted in tests without a XAML runtime.
/// </summary>
public static class PageContainerRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "PageContainer";

    /// <summary>The root automation id Narrator and UI-automation resolve the surface by.</summary>
    public const string RootAutomationId = "page-container";

    /// <summary>The automation id of the page title heading (web <c>h1</c>).</summary>
    public const string TitleAutomationId = "page-container-title";

    /// <summary>The automation id of the right-aligned header actions cluster.</summary>
    public const string ActionsAutomationId = "page-container-actions";

    /// <summary>The automation id of the loading region (the centred spinner host).</summary>
    public const string LoadingAutomationId = "page-container-loading";

    /// <summary>The automation id of the error card region.</summary>
    public const string ErrorAutomationId = "page-container-error";

    /// <summary>The automation id of the empty-state region.</summary>
    public const string EmptyAutomationId = "page-container-empty";

    /// <summary>The automation id of the page body region (the protected content boundary).</summary>
    public const string BodyAutomationId = "page-container-body";

    /// <summary>The automation id of the copy-link affordance.</summary>
    public const string CopyLinkAutomationId = "page-container-copy-link";

    /// <summary>Token brush key for the title text (web inherits <c>--text-primary</c>).</summary>
    public const string TitleBrushKey = "TsColorTextPrimaryBrush";

    /// <summary>Token brush key for the subtitle text (web <c>text-[var(--text-muted)]</c>).</summary>
    public const string SubtitleBrushKey = "TsColorTextMutedBrush";

    /// <summary>Token brush key for the empty-state text (web <c>text-[var(--text-muted)]</c>).</summary>
    public const string EmptyTextBrushKey = "TsColorTextMutedBrush";

    /// <summary>Generated design-token colour key the error card tint is derived from (web red).</summary>
    public const string DangerColorKey = "TsColorDangerColor";

    /// <summary>Generated design-token brush key for the error text (web <c>text-red-700</c> / <c>dark:text-red-300</c>).</summary>
    public const string DangerBrushKey = "TsColorDangerBrush";

    /// <summary>Error card background alpha over the danger colour (web <c>bg-red-50</c> / <c>dark:bg-red-900/20</c>).</summary>
    public const double ErrorCardBackgroundOpacity = 0.08;

    /// <summary>Error card border alpha over the danger colour (web <c>border-red-200</c> / <c>dark:border-red-800</c>).</summary>
    public const double ErrorCardBorderOpacity = 0.20;

    /// <summary>ARIA live urgency the error card declares — it supplants the page body, so Narrator announces it assertively.</summary>
    public const string LiveAssertive = "assertive";

    /// <summary>ARIA live urgency the loading / empty regions declare — a polite status announcement.</summary>
    public const string LivePolite = "polite";

    /// <summary>i18n key for the loading spinner's accessible label (shared with the Spinner surface).</summary>
    public const string LoadingLabelKey = "translation.global.loading";

    /// <summary>English fallback for <see cref="LoadingLabelKey"/> — the catalogue literal, verbatim.</summary>
    public const string LoadingLabelFallback = "Loading";

    /// <summary>
    /// i18n key for the empty-state default — the native key behind the web inline template
    /// <c>`No ${title.toLowerCase()} found.`</c> (web/src/components/layout/PageContainer.tsx L121). The
    /// <c>{0}</c> format slot is the lower-cased title.
    /// </summary>
    public const string EmptyMessageKey = "translation.pageContainer.empty";

    /// <summary>English fallback for <see cref="EmptyMessageKey"/> — the web template rendered verbatim, with the title slotted at <c>{0}</c>.</summary>
    public const string EmptyMessageFallback = "No {0} found.";

    /// <summary>i18n key for the idle copy-link label (web <c>CopyLinkButton</c> default).</summary>
    public const string CopyLinkLabelKey = "translation.actions.copyLink";

    /// <summary>English fallback for <see cref="CopyLinkLabelKey"/>.</summary>
    public const string CopyLinkLabelFallback = "Copy link";

    /// <summary>i18n key for the post-copy label (web <c>CopyLinkButton</c> copied state).</summary>
    public const string CopiedLabelKey = "translation.actions.copied";

    /// <summary>English fallback for <see cref="CopiedLabelKey"/>.</summary>
    public const string CopiedLabelFallback = "Copied";

    /// <summary>Resolve the loading spinner's accessible label (web <c>'Loading'</c>) through the i18n facade.</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string ResolveLoadingLabel(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(LoadingLabelKey, LoadingLabelFallback);
    }

    /// <summary>Resolve the idle copy-link label (web "Copy link") through the i18n facade.</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string ResolveCopyLinkLabel(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(CopyLinkLabelKey, CopyLinkLabelFallback);
    }

    /// <summary>Resolve the post-copy label (web "Copied") through the i18n facade.</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string ResolveCopiedLabel(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(CopiedLabelKey, CopiedLabelFallback);
    }
}

/// <summary>
/// The freshness-degradation ranking the <c>PageContainer</c> uses to fold a page's many query results into one
/// representative chip — the native port of the web <c>pickWorstQuery</c> helper
/// (web/src/components/layout/PageContainer.tsx L21-34). A page that fans out into a hero query plus a long tail of
/// cagg queries passes them all in and the single page-tier freshness chip surfaces the most-degraded state.
/// </summary>
public static class PageContainerFreshness
{
    /// <summary>
    /// The web degradation rank: <c>error</c> (3) &gt; <c>stale</c> (2) &gt; <c>fetching</c> (1) &gt; <c>fresh</c>
    /// (0) — the exact precedence of the web ternary <c>q.isError ? 3 : q.isStale ? 2 : q.isFetching ? 1 : 0</c>.
    /// </summary>
    /// <param name="snapshot">The freshness snapshot to rank.</param>
    public static int Rank(DataFreshnessSnapshot snapshot)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        return snapshot.IsError ? 3 : snapshot.IsStale ? 2 : snapshot.IsFetching ? 1 : 0;
    }

    /// <summary>
    /// Pick the most-degraded snapshot, reproducing the web <c>pickWorstQuery</c> exactly: scan left-to-right and
    /// keep the first snapshot of each strictly-higher rank, so on a tie the earliest-listed query wins (web seeds
    /// <c>worstRank = -1</c> and replaces only when <c>rank &gt; worstRank</c>).
    /// </summary>
    /// <param name="snapshots">The page's freshness snapshots; must contain at least one element.</param>
    /// <exception cref="ArgumentException"><paramref name="snapshots"/> is empty.</exception>
    public static DataFreshnessSnapshot PickWorst(IReadOnlyList<DataFreshnessSnapshot> snapshots)
    {
        ArgumentNullException.ThrowIfNull(snapshots);
        if (snapshots.Count == 0)
        {
            throw new ArgumentException("At least one freshness snapshot is required.", nameof(snapshots));
        }

        var worst = snapshots[0];
        var worstRank = -1;
        foreach (var snapshot in snapshots)
        {
            var rank = Rank(snapshot);
            if (rank > worstRank)
            {
                worst = snapshot;
                worstRank = rank;
            }
        }

        return worst;
    }
}

/// <summary>
/// The fully projected, render-ready view of a <see cref="PageContainerRequest"/> — everything the web component
/// derives before returning its JSX (web/src/components/layout/PageContainer.tsx L95-127): the header
/// <see cref="Title"/> and optional <see cref="Subtitle"/>, whether the right-aligned actions cluster is shown
/// (<see cref="ShowHeaderActions"/> = the web <c>actions || copyLink || resolvedQuery</c> gate) and which of its
/// three affordances render (<see cref="ShowFreshness"/>, <see cref="ShowCopyLink"/>, <see cref="HasActions"/>, in
/// the web header order), the resolved body <see cref="State"/>, the localized <see cref="ErrorMessage"/> /
/// <see cref="EmptyMessage"/> / <see cref="LoadingLabel"/>, and the accessibility contract for the active body
/// region (<see cref="BodyAccessibleName"/> + <see cref="BodyLiveAssertive"/>). Pure value type so every field is
/// asserted headlessly.
/// </summary>
public readonly record struct PageContainerProjection
{
    private PageContainerProjection(
        string title,
        bool hasSubtitle,
        string subtitle,
        PageContainerState state,
        string errorMessage,
        string emptyMessage,
        string loadingLabel,
        bool showHeaderActions,
        bool hasActions,
        bool showCopyLink,
        bool showFreshness,
        string bodyAccessibleName,
        bool bodyLiveAssertive)
    {
        Title = title;
        HasSubtitle = hasSubtitle;
        Subtitle = subtitle;
        State = state;
        ErrorMessage = errorMessage;
        EmptyMessage = emptyMessage;
        LoadingLabel = loadingLabel;
        ShowHeaderActions = showHeaderActions;
        HasActions = hasActions;
        ShowCopyLink = showCopyLink;
        ShowFreshness = showFreshness;
        BodyAccessibleName = bodyAccessibleName;
        BodyLiveAssertive = bodyLiveAssertive;
    }

    /// <summary>The page title (web <c>h1</c>).</summary>
    public string Title { get; }

    /// <summary>Whether the subtitle is shown (web <c>{subtitle &amp;&amp; …}</c>).</summary>
    public bool HasSubtitle { get; }

    /// <summary>The sub-heading text, or empty when hidden (web <c>subtitle</c>).</summary>
    public string Subtitle { get; }

    /// <summary>The resolved body state (web loading/error/empty/content precedence).</summary>
    public PageContainerState State { get; }

    /// <summary>The localized error message shown by the error card, or empty (web <c>error.message</c>).</summary>
    public string ErrorMessage { get; }

    /// <summary>The localized empty-state message (web <c>emptyMessage ?? `No ${title} found.`</c>).</summary>
    public string EmptyMessage { get; }

    /// <summary>The localized accessible label for the loading spinner (web <c>'Loading'</c>).</summary>
    public string LoadingLabel { get; }

    /// <summary>Whether the right-aligned header actions cluster is shown (web <c>actions || copyLink || resolvedQuery</c>).</summary>
    public bool ShowHeaderActions { get; }

    /// <summary>Whether a caller actions node is rendered in the cluster (web <c>actions</c>).</summary>
    public bool HasActions { get; }

    /// <summary>Whether the copy-link affordance is rendered in the cluster (web <c>copyLink</c>).</summary>
    public bool ShowCopyLink { get; }

    /// <summary>Whether the data-freshness chip is rendered in the cluster (web <c>resolvedQuery</c>).</summary>
    public bool ShowFreshness { get; }

    /// <summary>The accessible name a screen reader announces for the active body region (empty for the content state, which its children own).</summary>
    public string BodyAccessibleName { get; }

    /// <summary>Whether the active body region announces assertively (the error card) vs politely (loading / empty).</summary>
    public bool BodyLiveAssertive { get; }

    /// <summary>
    /// Project a request into a render-ready value, reproducing the web component
    /// (web/src/components/layout/PageContainer.tsx L95-127): the always-visible header, the
    /// <c>actions || copyLink || resolvedQuery</c> cluster gate, the loading → error → empty → content body
    /// precedence, and the <c>emptyMessage ?? `No ${title.toLowerCase()} found.`</c> default.
    /// </summary>
    /// <param name="request">The container description (web props + body gates).</param>
    /// <param name="localizer">The i18n facade the copy resolves through (P1/S10).</param>
    public static PageContainerProjection Project(PageContainerRequest request, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(localizer);

        var title = request.Title ?? string.Empty;
        var hasSubtitle = !string.IsNullOrWhiteSpace(request.Subtitle);
        var subtitle = hasSubtitle ? request.Subtitle!.Trim() : string.Empty;

        var state = ResolveState(request);
        var errorMessage = request.ErrorMessage ?? string.Empty;
        var emptyMessage = ResolveEmptyMessage(request, title, localizer);
        var loadingLabel = PageContainerRegistration.ResolveLoadingLabel(localizer);

        var showHeaderActions = request.HasActions || request.CopyLink || request.HasFreshness;

        var (bodyAccessibleName, bodyLiveAssertive) = state switch
        {
            PageContainerState.Loading => (loadingLabel, false),
            PageContainerState.Error => (errorMessage, true),
            PageContainerState.Empty => (emptyMessage, false),
            _ => (string.Empty, false),
        };

        return new PageContainerProjection(
            title,
            hasSubtitle,
            subtitle,
            state,
            errorMessage,
            emptyMessage,
            loadingLabel,
            showHeaderActions,
            request.HasActions,
            request.CopyLink,
            request.HasFreshness,
            bodyAccessibleName,
            bodyLiveAssertive);
    }

    private static PageContainerState ResolveState(PageContainerRequest request)
    {
        // web L111-125: loading wins, then a truthy error, then empty, otherwise the protected content.
        if (request.Loading)
        {
            return PageContainerState.Loading;
        }

        if (request.ErrorMessage is not null)
        {
            return PageContainerState.Error;
        }

        return request.Empty ? PageContainerState.Empty : PageContainerState.Content;
    }

    // web L121: `emptyMessage ?? `No ${title.toLowerCase()} found.`` — the caller override wins (JS `??` keeps an
    // explicit empty string), otherwise the lower-cased title is slotted into the localized template.
    [SuppressMessage(
        "Globalization",
        "CA1308:Normalize strings to uppercase",
        Justification = "Parity: the web source lower-cases the title for display in the empty-state sentence; this is user-facing copy, not a normalization key.")]
    private static string ResolveEmptyMessage(PageContainerRequest request, string title, ILocalizer localizer)
    {
        if (request.EmptyMessage is { } message)
        {
            return message;
        }

        var template = localizer.GetString(
            PageContainerRegistration.EmptyMessageKey,
            PageContainerRegistration.EmptyMessageFallback);

        return string.Format(CultureInfo.CurrentCulture, template, title.Trim().ToLowerInvariant());
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>PageContainer</c> surface (P1/S11 diagnostics contract). The container carries
/// only caller-supplied page chrome (title / subtitle / messages), so the collector records ONLY the operational
/// <c>view.opened</c> event with the surface slug — never the title or any message. Thread-safe; mirrors the peer
/// surfaces' diagnostics collectors.
/// </summary>
public sealed class PageContainerDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public PageContainerDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=PageContainer</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={PageContainerRegistration.Slug}");
    }
}
