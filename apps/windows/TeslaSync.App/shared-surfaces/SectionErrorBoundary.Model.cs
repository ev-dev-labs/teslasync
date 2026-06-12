using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The three fallback configurations the <c>SectionErrorBoundary</c> selects between — the native discriminator for
/// the web component's prop-driven branches (web/src/components/feedback/SectionErrorBoundary.tsx L36-70): the
/// default inline fallback with a working retry (<see cref="Default"/>), a custom-title alert card without a retry
/// (<see cref="TitleFallback"/>), and a caller-supplied fallback node (<see cref="CustomFallback"/>). The mode is a
/// static configuration (the web prop shape) chosen once per boundary; whether the fallback is actually shown is the
/// separate run-time <c>HasError</c> flag.
/// </summary>
public enum SectionErrorBoundaryMode
{
    /// <summary>
    /// The web default branch (neither <c>fallback</c> nor <c>fallbackTitle</c> supplied) — delegates to the
    /// <c>ErrorBoundary</c> inline UI, a compact danger-tinted card with a working retry affordance.
    /// </summary>
    Default,

    /// <summary>
    /// The web <c>fallbackTitle</c> branch — a <c>role="alert"</c> card showing the caller's title and the shared
    /// "other parts still work" subtitle, with no retry button (web L44-63).
    /// </summary>
    TitleFallback,

    /// <summary>
    /// The web <c>fallback</c> branch — the caller fully overrides the fallback node (e.g. a table row), and no
    /// retry button is shown (web L36-42).
    /// </summary>
    CustomFallback,
}

/// <summary>
/// One immutable description of what the <c>SectionErrorBoundary</c> is asked to render — the native analogue of the
/// web component's props plus the boundary's caught-error state
/// (web/src/components/feedback/SectionErrorBoundary.tsx L6-33 and the underlying <c>ErrorBoundary</c> state): the
/// configured <see cref="Mode"/>, whether an error is currently caught (<see cref="HasError"/> — the web
/// <c>this.state.hasError</c> gate), the optional <see cref="FallbackTitle"/> the <see cref="SectionErrorBoundaryMode.TitleFallback"/>
/// mode renders, and the optional PII-safe <see cref="DetailText"/> the <see cref="SectionErrorBoundaryMode.Default"/>
/// mode may show in place of the reassuring subtitle. Pure data — no WinUI types — so the projection is unit-tested
/// without a UI host.
/// </summary>
/// <param name="Mode">The configured fallback mode (web prop shape).</param>
/// <param name="HasError">Whether a render failure has been captured (web <c>this.state.hasError</c>).</param>
/// <param name="FallbackTitle">The caller title for the title-fallback mode (web <c>fallbackTitle</c>); null falls back to the default section title.</param>
/// <param name="DetailText">An optional PII-safe detail for the default mode (e.g. a localized failure category or exception type name); null shows the reassuring subtitle instead of the web's raw <c>error.message</c>.</param>
public sealed record SectionErrorBoundaryRequest(
    SectionErrorBoundaryMode Mode,
    bool HasError,
    string? FallbackTitle,
    string? DetailText)
{
    /// <summary>The healthy request for a mode — the boundary shows its protected content (web <c>return this.props.children</c>).</summary>
    /// <param name="mode">The configured fallback mode (only relevant once an error is caught).</param>
    public static SectionErrorBoundaryRequest Healthy(SectionErrorBoundaryMode mode) =>
        new(mode, HasError: false, FallbackTitle: null, DetailText: null);

    /// <summary>A caught-error request — the boundary shows its fallback (web <c>this.state.hasError === true</c>).</summary>
    /// <param name="mode">The configured fallback mode.</param>
    /// <param name="fallbackTitle">The caller title for the title-fallback mode (web <c>fallbackTitle</c>).</param>
    /// <param name="detailText">An optional PII-safe detail for the default mode.</param>
    public static SectionErrorBoundaryRequest Errored(
        SectionErrorBoundaryMode mode,
        string? fallbackTitle = null,
        string? detailText = null) =>
        new(mode, HasError: true, fallbackTitle, detailText);
}

/// <summary>
/// Canonical metadata for the <c>SectionErrorBoundary</c> shared surface — the native mirror of the literals, icon
/// and i18n key in web/src/components/feedback/SectionErrorBoundary.tsx and the inline fallback chrome it delegates
/// to in web/src/components/feedback/ErrorBoundary.tsx. Carries the diagnostics slug, the boundary / retry
/// automation ids, the ARIA role + live urgency the alert fallback declares, the Segoe Fluent glyph standing in for
/// the web Lucide <c>AlertTriangle</c>, the tesla-red danger tint recipe the fallback card is painted with, the
/// neutral text brush keys the title / subtitle resolve through, and the i18n keys (each with the English fallback
/// the catalogue ships) the fallback copy references. UI-free so the mapping is asserted in tests without a XAML
/// runtime.
/// </summary>
public static class SectionErrorBoundaryRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "SectionErrorBoundary";

    /// <summary>The automation id Narrator and UI-automation resolve the boundary by.</summary>
    public const string BoundaryAutomationId = "section-error-boundary";

    /// <summary>The automation id Narrator and UI-automation resolve the retry button by.</summary>
    public const string RetryAutomationId = "section-error-boundary-retry";

    /// <summary>ARIA role the fallback card declares — an assertive alert region (web <c>role="alert"</c>).</summary>
    public const string RoleAlert = "alert";

    /// <summary>ARIA live urgency for the alert — interrupts the screen reader (web <c>role="alert"</c> implies assertive).</summary>
    public const string LiveAssertive = "assertive";

    /// <summary>Segoe Fluent "Warning" glyph — the native stand-in for the web Lucide <c>AlertTriangle</c> icon.</summary>
    public const string AlertGlyph = "\uE7BA";

    /// <summary>Generated design-token colour key the card tint is derived from (web <c>tesla-red</c>).</summary>
    public const string DangerColorKey = "TsColorDangerColor";

    /// <summary>Generated design-token brush key for the danger foreground / icon (web <c>text-tesla-red</c>).</summary>
    public const string DangerBrushKey = "TsColorDangerBrush";

    /// <summary>Token brush key for the title text (web <c>text-[var(--text-secondary)]</c>).</summary>
    public const string SecondaryTextBrushKey = "TsColorTextSecondaryBrush";

    /// <summary>Token brush key for the subtitle / detail text (web <c>text-[var(--text-muted)]</c>).</summary>
    public const string MutedTextBrushKey = "TsColorTextMutedBrush";

    /// <summary>Card background alpha over the danger colour (web <c>bg-tesla-red/5</c>).</summary>
    public const double CardBackgroundOpacity = 0.05;

    /// <summary>Card border alpha over the danger colour (web <c>border-tesla-red/20</c>).</summary>
    public const double CardBorderOpacity = 0.20;

    /// <summary>i18n key for the default fallback title (web <c>errors.section.title</c>).</summary>
    public const string DefaultTitleKey = "translation.errors.section.title";

    /// <summary>English fallback for <see cref="DefaultTitleKey"/> — the catalogue literal, verbatim.</summary>
    public const string DefaultTitleFallback = "This section failed to load";

    /// <summary>i18n key for the fallback subtitle (web <c>errors.section.subtitle</c>) — the key extracted from the web source.</summary>
    public const string SubtitleKey = "translation.errors.section.subtitle";

    /// <summary>English fallback for <see cref="SubtitleKey"/> — the web literal, verbatim.</summary>
    public const string SubtitleFallback = "Other parts of the page should still work.";

    /// <summary>i18n key for the retry button label (web <c>error.retry</c>, shared with the ErrorDisplay surface).</summary>
    public const string RetryKey = "translation.error.retry";

    /// <summary>English fallback for <see cref="RetryKey"/> — the catalogue literal, verbatim.</summary>
    public const string RetryFallback = "Retry";

    /// <summary>i18n key for the chart-section title preset (web <c>errors.section.chartTitle</c>, a common <c>fallbackTitle</c> call-site value).</summary>
    public const string ChartTitleKey = "translation.errors.section.chartTitle";

    /// <summary>English fallback for <see cref="ChartTitleKey"/> — the catalogue literal, verbatim.</summary>
    public const string ChartTitleFallback = "This chart failed to load";

    /// <summary>i18n key for the table-section title preset (web <c>errors.section.tableTitle</c>, a common <c>fallbackTitle</c> call-site value).</summary>
    public const string TableTitleKey = "translation.errors.section.tableTitle";

    /// <summary>English fallback for <see cref="TableTitleKey"/> — the catalogue literal, verbatim.</summary>
    public const string TableTitleFallback = "This table failed to render";

    /// <summary>i18n key for the widget-section title preset (web <c>errors.section.widgetTitle</c>, a common <c>fallbackTitle</c> call-site value).</summary>
    public const string WidgetTitleKey = "translation.errors.section.widgetTitle";

    /// <summary>English fallback for <see cref="WidgetTitleKey"/> — the catalogue literal, verbatim.</summary>
    public const string WidgetTitleFallback = "Widget failed to load";
}

/// <summary>
/// The fully projected, render-ready view of a <see cref="SectionErrorBoundaryRequest"/> — everything the web
/// component derives before returning its fallback JSX
/// (web/src/components/feedback/SectionErrorBoundary.tsx L36-70 and the delegated <c>ErrorBoundary</c> inline UI):
/// whether the boundary is showing a fallback (<see cref="IsErrored"/> — the web <c>hasError</c> gate; false renders
/// the protected children), whether that fallback is the danger-tinted alert card (<see cref="ShowsCard"/>) or the
/// caller's custom node (<see cref="ShowsCustomFallback"/>), the Segoe Fluent <see cref="IconGlyph"/>, the localized
/// <see cref="Title"/> / <see cref="Detail"/>, whether the retry affordance is shown (<see cref="HasRetry"/>) and its
/// localized <see cref="RetryLabel"/>, the ARIA <see cref="Role"/> / <see cref="LiveSetting"/> the alert declares,
/// and the composed <see cref="AccessibleName"/> a screen reader announces. Pure value type so every field is
/// asserted headlessly.
/// </summary>
public readonly record struct SectionErrorBoundaryProjection
{
    private SectionErrorBoundaryProjection(
        bool isErrored,
        SectionErrorBoundaryMode mode,
        bool showsCard,
        bool showsCustomFallback,
        string iconGlyph,
        string title,
        string detail,
        bool hasRetry,
        string retryLabel,
        string role,
        string liveSetting,
        string accessibleName)
    {
        IsErrored = isErrored;
        Mode = mode;
        ShowsCard = showsCard;
        ShowsCustomFallback = showsCustomFallback;
        IconGlyph = iconGlyph;
        Title = title;
        Detail = detail;
        HasRetry = hasRetry;
        RetryLabel = retryLabel;
        Role = role;
        LiveSetting = liveSetting;
        AccessibleName = accessibleName;
    }

    /// <summary>Whether the boundary is showing a fallback (web <c>hasError</c>); false renders the protected children.</summary>
    public bool IsErrored { get; }

    /// <summary>The configured fallback mode (carried through for hosting / tests).</summary>
    public SectionErrorBoundaryMode Mode { get; }

    /// <summary>Whether the danger-tinted alert card is shown (the default / title-fallback modes while errored).</summary>
    public bool ShowsCard { get; }

    /// <summary>Whether the caller's custom fallback node is shown (the custom-fallback mode while errored).</summary>
    public bool ShowsCustomFallback { get; }

    /// <summary>The Segoe Fluent glyph the card shows (web Lucide <c>AlertTriangle</c>); empty when no card is shown.</summary>
    public string IconGlyph { get; }

    /// <summary>The localized card title (web <c>fallbackTitle</c> or the default section title); empty when no card is shown.</summary>
    public string Title { get; }

    /// <summary>The localized card detail (web subtitle, or a PII-safe default-mode detail); empty when no card is shown.</summary>
    public string Detail { get; }

    /// <summary>Whether the retry affordance is shown (web default inline mode only).</summary>
    public bool HasRetry { get; }

    /// <summary>The localized retry label (empty when there is no retry).</summary>
    public string RetryLabel { get; }

    /// <summary>The ARIA role the card declares (web <c>role</c>); empty for the custom-fallback / healthy states.</summary>
    public string Role { get; }

    /// <summary>The ARIA live urgency the card declares; empty for the custom-fallback / healthy states.</summary>
    public string LiveSetting { get; }

    /// <summary>The accessible name a screen reader announces — the title and detail together; empty when no card is shown.</summary>
    public string AccessibleName { get; }

    /// <summary>The healthy projection for a mode — the boundary renders its protected children (web <c>return this.props.children</c>).</summary>
    /// <param name="mode">The configured fallback mode (only relevant once an error is caught).</param>
    public static SectionErrorBoundaryProjection Healthy(SectionErrorBoundaryMode mode) => new(
        isErrored: false,
        mode: mode,
        showsCard: false,
        showsCustomFallback: false,
        iconGlyph: string.Empty,
        title: string.Empty,
        detail: string.Empty,
        hasRetry: false,
        retryLabel: string.Empty,
        role: string.Empty,
        liveSetting: string.Empty,
        accessibleName: string.Empty);

    /// <summary>
    /// Project a request into a render-ready value, reproducing the web component
    /// (web/src/components/feedback/SectionErrorBoundary.tsx L31-70): a healthy boundary renders its children;
    /// a caught error selects the custom node, the title-fallback alert card (no retry), or the default inline card
    /// (with retry) by <see cref="SectionErrorBoundaryRequest.Mode"/>.
    /// </summary>
    /// <param name="request">The boundary description (web props + caught-error state).</param>
    /// <param name="localizer">The i18n facade the copy resolves through (P1/S10).</param>
    public static SectionErrorBoundaryProjection Project(SectionErrorBoundaryRequest request, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(localizer);

        if (!request.HasError)
        {
            return Healthy(request.Mode);
        }

        var subtitle = localizer.GetString(
            SectionErrorBoundaryRegistration.SubtitleKey,
            SectionErrorBoundaryRegistration.SubtitleFallback);
        var defaultTitle = localizer.GetString(
            SectionErrorBoundaryRegistration.DefaultTitleKey,
            SectionErrorBoundaryRegistration.DefaultTitleFallback);

        return request.Mode switch
        {
            // web: <ErrorBoundary fallback={fallback}> — the caller's node fully owns the fallback (and its semantics).
            SectionErrorBoundaryMode.CustomFallback => ProjectCustom(),

            // web: the fallbackTitle branch — caller title + subtitle, role="alert", no retry.
            SectionErrorBoundaryMode.TitleFallback => ProjectCard(
                mode: SectionErrorBoundaryMode.TitleFallback,
                title: string.IsNullOrEmpty(request.FallbackTitle) ? defaultTitle : request.FallbackTitle!,
                detail: subtitle,
                hasRetry: false,
                localizer: localizer),

            // web default: the ErrorBoundary inline UI — section title + detail + a working retry.
            _ => ProjectCard(
                mode: SectionErrorBoundaryMode.Default,
                title: defaultTitle,
                detail: string.IsNullOrEmpty(request.DetailText) ? subtitle : request.DetailText!,
                hasRetry: true,
                localizer: localizer),
        };
    }

    private static SectionErrorBoundaryProjection ProjectCustom() => new(
        isErrored: true,
        mode: SectionErrorBoundaryMode.CustomFallback,
        showsCard: false,
        showsCustomFallback: true,
        iconGlyph: string.Empty,
        title: string.Empty,
        detail: string.Empty,
        hasRetry: false,
        retryLabel: string.Empty,
        role: string.Empty,
        liveSetting: string.Empty,
        accessibleName: string.Empty);

    private static SectionErrorBoundaryProjection ProjectCard(
        SectionErrorBoundaryMode mode,
        string title,
        string detail,
        bool hasRetry,
        ILocalizer localizer) => new(
        isErrored: true,
        mode: mode,
        showsCard: true,
        showsCustomFallback: false,
        iconGlyph: SectionErrorBoundaryRegistration.AlertGlyph,
        title: title,
        detail: detail,
        hasRetry: hasRetry,
        retryLabel: hasRetry
            ? localizer.GetString(SectionErrorBoundaryRegistration.RetryKey, SectionErrorBoundaryRegistration.RetryFallback)
            : string.Empty,
        role: SectionErrorBoundaryRegistration.RoleAlert,
        liveSetting: SectionErrorBoundaryRegistration.LiveAssertive,
        accessibleName: ComposeAccessibleName(title, detail));

    private static string ComposeAccessibleName(string title, string detail) =>
        string.IsNullOrEmpty(detail) ? title : $"{title} {detail}";
}

/// <summary>
/// PII-safe diagnostics for the <c>SectionErrorBoundary</c> surface (P1/S11 diagnostics contract). The boundary
/// carries an opaque failure category and localized copy only — never the underlying exception, message or the web
/// <c>name</c> log correlation token — so the collector records ONLY the operational <c>view.opened</c> event with
/// the surface slug. Thread-safe; mirrors the peer surfaces' diagnostics collectors.
/// </summary>
public sealed class SectionErrorBoundaryDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public SectionErrorBoundaryDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=SectionErrorBoundary</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={SectionErrorBoundaryRegistration.Slug}");
    }
}
