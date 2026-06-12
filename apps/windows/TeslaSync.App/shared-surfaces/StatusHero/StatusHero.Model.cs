using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces.StatusHeroSurface;

/// <summary>
/// The five at-a-glance health levels the hero card surfaces — the native mirror of the web
/// <c>HeroStatus</c> union (<c>'healthy' | 'degraded' | 'unhealthy' | 'unknown' | 'maintenance'</c> in
/// web/src/components/status/StatusHero.tsx). Each member drives the icon glyph, the accent (icon, headline and
/// frame), and the default headline, exactly as the web <c>STATUS_CONFIG</c> map does.
/// </summary>
public enum HeroStatus
{
    /// <summary>Everything is operational — green check (web <c>'healthy'</c>).</summary>
    Healthy,

    /// <summary>Reduced but functional — amber warning triangle (web <c>'degraded'</c>).</summary>
    Degraded,

    /// <summary>A service outage — red error badge (web <c>'unhealthy'</c>).</summary>
    Unhealthy,

    /// <summary>No status resolved — muted help glyph (web <c>'unknown'</c>): the always-rendered empty state.</summary>
    Unknown,

    /// <summary>Scheduled maintenance — info-blue wrench (web <c>'maintenance'</c>).</summary>
    Maintenance,
}

/// <summary>
/// Canonical, UI-free metadata for the <c>StatusHero</c> shared surface — the native mirror of the web component
/// at <c>web/src/components/status/StatusHero.tsx</c>. It pins the diagnostics slug, the root automation id, the
/// per-status icon glyph and accent-token mapping (reusing the tested <see cref="StatusResources"/> kind→brush
/// table from the core), the icon-circle tint/ring alphas (the web <c>bg-{c}-500/15</c> + <c>ring-{c}-500/40</c>),
/// the call-to-action refresh glyph, and the i18n key + English-fallback pairs for the default headlines and the
/// "Live" label. The web component hard-codes these headline literals in <c>STATUS_CONFIG</c>; here every visible
/// string flows through one keyed call site so it can be localized for real in the app and asserted headlessly in
/// tests. No WinUI types — so the mapping is unit-tested without a XAML runtime.
/// </summary>
public static class StatusHeroRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "StatusHero";

    /// <summary>
    /// The root automation id the view stamps on itself. The web hero is a <c>GlassPanel</c> that accepts an
    /// optional <c>id</c> for in-page anchoring; this is the stable hook UI-automation targets when no per-instance
    /// anchor id is supplied.
    /// </summary>
    public const string RootAutomationId = "status-hero";

    /// <summary>Icon-circle background tint alpha — the web <c>bg-{colour}-500/15</c> (15%).</summary>
    public const double TintAlpha = 0.15;

    /// <summary>Icon-circle ring alpha — the web <c>ring-{colour}-500/40</c> (40%).</summary>
    public const double RingAlpha = 0.40;

    /// <summary>Segoe Fluent "CompletedSolid" — the healthy filled check circle (web Lucide <c>CheckCircle</c>).</summary>
    public const string HealthyGlyph = "\uEC61";

    /// <summary>Segoe Fluent "Warning" — the degraded triangle (web Lucide <c>AlertTriangle</c>).</summary>
    public const string DegradedGlyph = "\uE7BA";

    /// <summary>Segoe Fluent "ErrorBadge" — the unhealthy error circle (web Lucide <c>XCircle</c>).</summary>
    public const string UnhealthyGlyph = "\uEA39";

    /// <summary>Segoe Fluent "Help" — the unknown question circle (web Lucide <c>HelpCircle</c>).</summary>
    public const string UnknownGlyph = "\uE897";

    /// <summary>Segoe Fluent "Repair" — the maintenance wrench (web Lucide <c>Wrench</c>).</summary>
    public const string MaintenanceGlyph = "\uE90F";

    /// <summary>Segoe Fluent "Refresh" — the call-to-action glyph (web Lucide <c>RefreshCw</c>).</summary>
    public const string CtaGlyph = "\uE72C";

    /// <summary>The generated design-token brush key for the connected "Live" dot (web emerald).</summary>
    public const string LiveDotBrushKey = "TsColorSuccessBrush";

    /// <summary>i18n key for the "Live" label (web literal <c>Live</c>).</summary>
    public const string LiveKey = "status.hero.live";

    /// <summary>English fallback for <see cref="LiveKey"/> — the web literal.</summary>
    public const string LiveFallback = "Live";

    /// <summary>
    /// The semantic <see cref="StatusKind"/> a hero status maps to — the bridge to the core's tested kind→token
    /// table (<see cref="StatusResources"/>). healthy→Success (green), degraded→Warning (amber),
    /// unhealthy→Danger (red), maintenance→Info (blue), unknown→Neutral (the web zinc/secondary).
    /// </summary>
    /// <param name="status">The hero status.</param>
    public static StatusKind Kind(HeroStatus status) => status switch
    {
        HeroStatus.Healthy => StatusKind.Success,
        HeroStatus.Degraded => StatusKind.Warning,
        HeroStatus.Unhealthy => StatusKind.Danger,
        HeroStatus.Maintenance => StatusKind.Info,
        _ => StatusKind.Neutral,
    };

    /// <summary>The generated design-token accent brush key for a status (icon, headline and frame).</summary>
    /// <param name="status">The hero status.</param>
    public static string AccentBrushKey(HeroStatus status) => StatusResources.AccentBrushKey(Kind(status));

    /// <summary>The Segoe Fluent glyph for a status (web <c>STATUS_CONFIG[status].icon</c>).</summary>
    /// <param name="status">The hero status.</param>
    public static string Glyph(HeroStatus status) => status switch
    {
        HeroStatus.Healthy => HealthyGlyph,
        HeroStatus.Degraded => DegradedGlyph,
        HeroStatus.Unhealthy => UnhealthyGlyph,
        HeroStatus.Maintenance => MaintenanceGlyph,
        _ => UnknownGlyph,
    };

    /// <summary>The i18n key for a status's default headline (web <c>STATUS_CONFIG[status].defaultHeadline</c>).</summary>
    /// <param name="status">The hero status.</param>
    public static string HeadlineKey(HeroStatus status) => status switch
    {
        HeroStatus.Healthy => "status.hero.healthy",
        HeroStatus.Degraded => "status.hero.degraded",
        HeroStatus.Unhealthy => "status.hero.unhealthy",
        HeroStatus.Maintenance => "status.hero.maintenance",
        _ => "status.hero.unknown",
    };

    /// <summary>The English fallback for a status's default headline — the exact web literal.</summary>
    /// <param name="status">The hero status.</param>
    public static string HeadlineFallback(HeroStatus status) => status switch
    {
        HeroStatus.Healthy => "All systems operational",
        HeroStatus.Degraded => "Degraded performance",
        HeroStatus.Unhealthy => "Service outage",
        HeroStatus.Maintenance => "Scheduled maintenance",
        _ => "Status unknown",
    };
}

/// <summary>
/// The optional call-to-action the hero renders — the native analogue of the web <c>cta</c> prop
/// (<c>{ label; onClick; loading? }</c> in web/src/components/status/StatusHero.tsx). The data model carries only
/// the <see cref="Label"/> and the <see cref="Loading"/> flag; the click itself is a view concern (the view
/// raises its <c>CtaInvoked</c> event, the host wires the web <c>onClick</c>), so this record stays UI-free. When
/// <see cref="Loading"/> is true the button shows a progress ring and is non-interactive — the web spinning
/// <c>RefreshCw</c> + <c>disabled</c>.
/// </summary>
/// <param name="Label">The button label (web <c>cta.label</c>) — caller-localized.</param>
/// <param name="Loading">Whether the action is in flight (web <c>cta.loading</c>).</param>
public sealed record StatusHeroCallToAction(string Label, bool Loading = false);

/// <summary>
/// The render-time data model the <c>StatusHero</c> view binds to — the native analogue of the web
/// <c>StatusHeroProps</c> (web/src/components/status/StatusHero.tsx). The web component is purely presentational:
/// its parent (the System Status page hero, an incident page, an embedded dashboard summary) owns any data
/// fetching and feeds an already-resolved <see cref="Status"/>, so — exactly like React re-rendering the element
/// with already-resolved props — there is no fetch-driven loading / error / stale / offline branch to reproduce
/// here. The branches are the five status variants (each always rendered, never hidden — <see cref="HeroStatus.Unknown"/>
/// is the friendly empty state) plus the optional subline, live affordance and call-to-action. Pure data — no
/// WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
public sealed record StatusHeroModel
{
    private StatusHeroModel(
        HeroStatus status,
        string? headline,
        string? subline,
        bool live,
        StatusHeroCallToAction? cta,
        string? anchorId)
    {
        Status = status;
        Headline = headline;
        Subline = subline;
        Live = live;
        Cta = cta;
        AnchorId = anchorId;
    }

    /// <summary>The resolved health level (web <c>status</c>).</summary>
    public HeroStatus Status { get; }

    /// <summary>Optional headline override (web <c>headline</c>); null/blank falls back to the per-status default.</summary>
    public string? Headline { get; }

    /// <summary>
    /// Optional sub-line beneath the headline (web <c>subline</c>). The web prop is a <c>ReactNode</c>; the native
    /// surface accepts the resolved text (the documented usages — e.g. "Last checked 12s ago" — are plain strings).
    /// </summary>
    public string? Subline { get; }

    /// <summary>Whether to show the "Live" affordance (web <c>live</c>); only honoured when a subline is present.</summary>
    public bool Live { get; }

    /// <summary>The optional call-to-action (web <c>cta</c>); null renders no button.</summary>
    public StatusHeroCallToAction? Cta { get; }

    /// <summary>Optional per-instance automation/anchor id (web <c>id</c>); null uses the default root id.</summary>
    public string? AnchorId { get; }

    /// <summary>The initial / empty model — the <see cref="HeroStatus.Unknown"/> state (web <c>status="unknown"</c>).</summary>
    public static StatusHeroModel Unknown { get; } = For(HeroStatus.Unknown);

    /// <summary>A model for a status with optional headline / subline / live / call-to-action / anchor id.</summary>
    /// <param name="status">The resolved health level (web <c>status</c>).</param>
    /// <param name="headline">Optional headline override (web <c>headline</c>).</param>
    /// <param name="subline">Optional sub-line text (web <c>subline</c>).</param>
    /// <param name="live">Whether to show the live affordance (web <c>live</c>).</param>
    /// <param name="cta">Optional call-to-action (web <c>cta</c>).</param>
    /// <param name="anchorId">Optional automation/anchor id (web <c>id</c>).</param>
    public static StatusHeroModel For(
        HeroStatus status,
        string? headline = null,
        string? subline = null,
        bool live = false,
        StatusHeroCallToAction? cta = null,
        string? anchorId = null) =>
        new(status, headline, subline, live, cta, anchorId);
}

/// <summary>
/// The fully projected, render-ready view of a <see cref="StatusHeroModel"/> — the native analogue of everything
/// the web component derives before returning JSX (web/src/components/status/StatusHero.tsx): the resolved
/// <see cref="Headline"/> (override or localized per-status default), the <see cref="AccentBrushKey"/> that tints
/// the icon, headline and frame, the <see cref="IconGlyph"/>, the subline gate (<see cref="HasSubline"/> +
/// <see cref="Subline"/>), the live affordance gate (<see cref="ShowLive"/> — true only when live AND a subline
/// are present, mirroring the web nesting — plus its <see cref="LiveLabel"/>), the call-to-action gate
/// (<see cref="HasCta"/> + <see cref="CtaLabel"/> + <see cref="CtaLoading"/> + <see cref="CtaGlyph"/>), the
/// polite-status <see cref="AutomationName"/> (the headline, plus the subline when present), and the resolved
/// <see cref="AutomationId"/>. Pure data so every value is asserted headlessly.
/// </summary>
/// <param name="Status">The resolved health level (web <c>status</c>).</param>
/// <param name="Kind">The semantic kind the accent token derives from (web colour family).</param>
/// <param name="Headline">The resolved headline (web <c>headline ?? cfg.defaultHeadline</c>).</param>
/// <param name="AccentBrushKey">The accent design-token brush key for icon, headline and frame.</param>
/// <param name="IconGlyph">The Segoe Fluent status glyph (web <c>cfg.icon</c>).</param>
/// <param name="HasSubline">True when a non-blank subline was supplied (web <c>subline</c> truthy).</param>
/// <param name="Subline">The subline text (empty when none).</param>
/// <param name="ShowLive">True when the live affordance renders (web <c>subline &amp;&amp; live</c>).</param>
/// <param name="LiveLabel">The localized "Live" label (web literal).</param>
/// <param name="HasCta">True when a call-to-action was supplied (web <c>cta</c> truthy).</param>
/// <param name="CtaLabel">The call-to-action label (web <c>cta.label</c>; empty when none).</param>
/// <param name="CtaLoading">Whether the call-to-action is in flight (web <c>cta.loading</c>).</param>
/// <param name="CtaGlyph">The Segoe Fluent refresh glyph for the call-to-action (web <c>RefreshCw</c>).</param>
/// <param name="AutomationName">The polite-status accessible name (web role="status" content).</param>
/// <param name="AutomationId">The resolved automation/anchor id (web <c>id</c> ?? the default root id).</param>
public sealed record StatusHeroDisplay(
    HeroStatus Status,
    StatusKind Kind,
    string Headline,
    string AccentBrushKey,
    string IconGlyph,
    bool HasSubline,
    string Subline,
    bool ShowLive,
    string LiveLabel,
    bool HasCta,
    string CtaLabel,
    bool CtaLoading,
    string CtaGlyph,
    string AutomationName,
    string AutomationId);

/// <summary>
/// Pure projection from a <see cref="StatusHeroModel"/> to its <see cref="StatusHeroDisplay"/> — the native port
/// of web/src/components/status/StatusHero.tsx. Reproduces the web derivations exactly:
/// <list type="bullet">
///   <item><description>the headline is the supplied override when non-blank, else the localized per-status
///   default (web <c>headline ?? cfg.defaultHeadline</c>).</description></item>
///   <item><description>the accent brush key, icon glyph and semantic kind come from the per-status mapping
///   (web <c>STATUS_CONFIG[status]</c>), reusing the core's tested kind→token table.</description></item>
///   <item><description>the live affordance shows only when a subline is present AND live is set — the web nests
///   the live dot inside the <c>{subline &amp;&amp; (...)}</c> block, so a blank subline hides it.</description></item>
///   <item><description>the call-to-action carries its label, loading flag and refresh glyph (web <c>cta</c>).</description></item>
///   <item><description>the accessible name is the headline, plus the subline when present (the web role="status"
///   region content).</description></item>
/// </list>
/// Every visible string resolves through the i18n facade with a stable key + English fallback. No WinUI types —
/// so the projection is unit-tested without a UI host.
/// </summary>
public static class StatusHeroProjection
{
    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web props).</param>
    /// <param name="localizer">The i18n facade every visible string resolves through (P1/S10).</param>
    /// <returns>The render-ready display model.</returns>
    public static StatusHeroDisplay Project(StatusHeroModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        HeroStatus status = model.Status;

        // web: headline ?? cfg.defaultHeadline — a blank override is treated as absent.
        string headline = string.IsNullOrWhiteSpace(model.Headline)
            ? localizer.GetString(StatusHeroRegistration.HeadlineKey(status), StatusHeroRegistration.HeadlineFallback(status))
            : model.Headline!;

        bool hasSubline = !string.IsNullOrWhiteSpace(model.Subline);
        string subline = hasSubline ? model.Subline!.Trim() : string.Empty;

        // web: the live dot is nested inside the {subline && (...)} block, so it never shows without a subline.
        bool showLive = hasSubline && model.Live;
        string liveLabel = localizer.GetString(StatusHeroRegistration.LiveKey, StatusHeroRegistration.LiveFallback);

        StatusHeroCallToAction? cta = model.Cta;
        bool hasCta = cta is not null;

        string automationName = hasSubline ? $"{headline}. {subline}" : headline;
        string automationId = string.IsNullOrWhiteSpace(model.AnchorId)
            ? StatusHeroRegistration.RootAutomationId
            : model.AnchorId!;

        return new StatusHeroDisplay(
            Status: status,
            Kind: StatusHeroRegistration.Kind(status),
            Headline: headline,
            AccentBrushKey: StatusHeroRegistration.AccentBrushKey(status),
            IconGlyph: StatusHeroRegistration.Glyph(status),
            HasSubline: hasSubline,
            Subline: subline,
            ShowLive: showLive,
            LiveLabel: liveLabel,
            HasCta: hasCta,
            CtaLabel: cta?.Label ?? string.Empty,
            CtaLoading: cta?.Loading ?? false,
            CtaGlyph: StatusHeroRegistration.CtaGlyph,
            AutomationName: automationName,
            AutomationId: automationId);
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>StatusHero</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never the status, headline or subline — so a
/// diagnostics line can never leak fleet state. Thread-safe.
/// </summary>
public sealed class StatusHeroDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional sink the operational event line is written to.</param>
    public StatusHeroDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=StatusHero</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={StatusHeroRegistration.Slug}");
    }
}
