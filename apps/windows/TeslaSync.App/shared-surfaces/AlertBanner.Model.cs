using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The render-time data model the <c>AlertBanner</c> shared surface binds to — the native analogue of the web
/// <c>AlertBannerProps</c> (web/src/components/feedback/AlertBanner.tsx L5-11). The web component is the persistent,
/// page-level inline notification primitive (info / success / warning / danger) the rest of the feedback family is
/// built on (e.g. <see cref="BrowserCompatBanner"/> renders an <c>AlertBanner variant="warning"</c>): it is purely
/// presentational, so its parent — the page or feature that owns the data fetch — feeds an already-resolved
/// variant, title, body, optional leading icon and dismissibility, exactly like React re-rendering the element with
/// resolved props. There is therefore no fetch-driven loading / error / stale / offline branch to reproduce in the
/// model; the live data states belong to the owning page, and the only "empty" state is the absence of an alert
/// (the source's <c>Current</c> is null), which collapses the banner. Pure data — no WinUI types — so the
/// projection is unit-tested without a UI host.
/// </summary>
public sealed record AlertBannerModel
{
    private AlertBannerModel(CalloutVariant variant, string body, string? title, string? iconGlyph, bool dismissible)
    {
        Variant = variant;
        Body = body;
        Title = title;
        IconGlyph = iconGlyph;
        Dismissible = dismissible;
    }

    /// <summary>The severity tier driving the accent colour and assistive-tech urgency (web <c>variant</c>).</summary>
    public CalloutVariant Variant { get; }

    /// <summary>The body text rendered under the optional title (web <c>children</c>, narrowed to text for this surface).</summary>
    public string Body { get; }

    /// <summary>Optional emphasised title shown above the body (web <c>title</c>); null / empty renders body only.</summary>
    public string? Title { get; }

    /// <summary>Optional leading Segoe Fluent glyph (web <c>icon</c>); null renders no icon — the web never auto-adds one.</summary>
    public string? IconGlyph { get; }

    /// <summary>Whether a dismiss affordance is shown (the web <c>onClose</c> callback being supplied).</summary>
    public bool Dismissible { get; }

    /// <summary>
    /// Build a banner model. <paramref name="body"/> is required (the web <c>children</c> is a required prop); the
    /// title, icon and dismissibility are optional and absent by default, matching the web optional props.
    /// </summary>
    /// <param name="variant">The severity tier (web <c>variant</c>).</param>
    /// <param name="body">The body text (web <c>children</c>); required, may be empty.</param>
    /// <param name="title">Optional emphasised title (web <c>title</c>).</param>
    /// <param name="iconGlyph">Optional leading Segoe Fluent glyph (web <c>icon</c>).</param>
    /// <param name="dismissible">Whether a dismiss affordance is shown (web <c>onClose</c> supplied).</param>
    public static AlertBannerModel Create(
        CalloutVariant variant,
        string body,
        string? title = null,
        string? iconGlyph = null,
        bool dismissible = false)
    {
        ArgumentNullException.ThrowIfNull(body);
        return new AlertBannerModel(variant, body, title, iconGlyph, dismissible);
    }
}

/// <summary>
/// Canonical metadata for the <c>AlertBanner</c> shared surface — the native mirror of the module-level constants in
/// web/src/components/feedback/AlertBanner.tsx. Carries the diagnostics slug, the banner / dismiss automation ids,
/// the ARIA role + live urgency the surface selects per variant (a polite <c>status</c> for info / success /
/// warning, an assertive <c>alert</c> for danger), the Segoe Fluent close glyph standing in for the web Lucide
/// <c>X</c>, the sole inherent i18n string (the dismiss control's accessible name; the surface is otherwise
/// anonymous and renders caller-supplied, already-localized content), the shared variant accent token brush keys,
/// and the tint alphas reproducing the web <c>border-*/20</c> / <c>bg-*/5</c> / <c>text-*/80</c> scale. UI-free so
/// the mapping is asserted in tests without a XAML runtime.
/// </summary>
public static class AlertBannerRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "AlertBanner";

    /// <summary>The automation id Narrator and UI-automation resolve the banner by.</summary>
    public const string BannerAutomationId = "alert-banner";

    /// <summary>The automation id Narrator and UI-automation resolve the dismiss button by.</summary>
    public const string DismissAutomationId = "alert-banner-dismiss";

    /// <summary>ARIA role for the quiet variants (info / success / warning) — a polite status region.</summary>
    public const string StatusRole = "status";

    /// <summary>ARIA role for the danger variant — an assertive alert region.</summary>
    public const string AlertRole = "alert";

    /// <summary>Live-region urgency for the quiet variants (announced at the next pause).</summary>
    public const string PoliteLiveSetting = "polite";

    /// <summary>Live-region urgency for the danger variant (interrupts the screen reader).</summary>
    public const string AssertiveLiveSetting = "assertive";

    /// <summary>Segoe Fluent "ChromeClose" glyph — the native stand-in for the web Lucide <c>X</c> dismiss icon.</summary>
    public const string DismissGlyph = "\uE711";

    /// <summary>i18n key for the dismiss control's accessible name (the web icon button has no visible label).</summary>
    public const string DismissKey = "translation.alert.banner.dismiss";

    /// <summary>English fallback for <see cref="DismissKey"/>.</summary>
    public const string DismissFallback = "Dismiss";

    /// <summary>The name-part separator Narrator reads between the title and body ("Title. Body").</summary>
    public const string AccessibleNameSeparator = ". ";

    /// <summary>Banner border alpha over the variant accent colour (web <c>border-*/20</c>).</summary>
    public const double BorderOpacity = 0.20;

    /// <summary>Banner background alpha over the variant accent colour (web <c>bg-*/5</c>, nudged for native legibility).</summary>
    public const double BackgroundOpacity = 0.06;

    /// <summary>Body / dismiss-glyph foreground alpha over the variant accent colour (web <c>text-*/80</c>).</summary>
    public const double BodyForegroundOpacity = 0.80;

    /// <summary>The shared variant accent brush key (info / success / warning / danger) — the web <c>titleText</c> colour.</summary>
    /// <param name="variant">The banner severity.</param>
    public static string AccentBrushKey(CalloutVariant variant) => CalloutVariants.AccentBrushKey(variant);

    /// <summary>The default Segoe Fluent glyph for a variant — offered for callers that want the semantic icon (the web <c>icon</c> prop is otherwise caller-supplied).</summary>
    /// <param name="variant">The banner severity.</param>
    public static string Glyph(CalloutVariant variant) => CalloutVariants.Glyph(variant);

    /// <summary>The ARIA role the surface exposes for a variant — <see cref="AlertRole"/> for danger, else <see cref="StatusRole"/>.</summary>
    /// <param name="variant">The banner severity.</param>
    public static string RoleFor(CalloutVariant variant) =>
        CalloutVariants.IsAssertive(variant) ? AlertRole : StatusRole;

    /// <summary>The live-region urgency the surface declares for a variant — assertive for danger, else polite.</summary>
    /// <param name="variant">The banner severity.</param>
    public static string LiveSettingFor(CalloutVariant variant) =>
        CalloutVariants.IsAssertive(variant) ? AssertiveLiveSetting : PoliteLiveSetting;

    /// <summary>Resolve the localized dismiss-control accessible name through the i18n facade.</summary>
    /// <param name="localizer">The i18n facade (P1/S10).</param>
    public static string ResolveDismissLabel(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(DismissKey, DismissFallback);
    }

    /// <summary>
    /// Compose the accessible name a screen reader announces — the title followed by the body (the natural reading
    /// order of the web markup, where the icon is decorative). Either part may be empty.
    /// </summary>
    /// <param name="title">The banner title (web <c>title</c>); may be empty.</param>
    /// <param name="body">The banner body (web <c>children</c>); may be empty.</param>
    public static string ComposeAccessibleName(string title, string body)
    {
        ArgumentNullException.ThrowIfNull(title);
        ArgumentNullException.ThrowIfNull(body);

        bool hasTitle = title.Length > 0;
        bool hasBody = body.Length > 0;

        if (hasTitle && hasBody)
        {
            return title + AccessibleNameSeparator + body;
        }

        return hasTitle ? title : body;
    }
}

/// <summary>
/// The fully projected, render-ready view of an <see cref="AlertBannerModel"/> (plus the ephemeral dismissed flag) —
/// everything the web <c>AlertBanner</c> derives before returning JSX (AlertBanner.tsx L39-54): whether the banner
/// is shown (<see cref="IsVisible"/> — content present and not dismissed), the <see cref="Variant"/>, the optional
/// <see cref="Title"/> (<see cref="HasTitle"/>), the <see cref="Body"/>, the optional <see cref="IconGlyph"/>
/// (<see cref="HasIcon"/>), whether it is <see cref="Dismissible"/>, the resolved <see cref="AccentBrushKey"/> and
/// the <see cref="BorderOpacity"/> / <see cref="BackgroundOpacity"/> / <see cref="BodyForegroundOpacity"/> tint
/// alphas, the localized <see cref="DismissLabel"/>, the composed <see cref="AccessibleName"/>, and the
/// <see cref="Role"/> / <see cref="LiveSetting"/> / <see cref="IsAssertive"/> assistive-tech contract. Pure value
/// type so every field is asserted headlessly.
/// </summary>
public readonly record struct AlertBannerProjection
{
    private AlertBannerProjection(
        bool isVisible,
        CalloutVariant variant,
        string title,
        bool hasTitle,
        string body,
        string? iconGlyph,
        bool hasIcon,
        bool dismissible,
        string accentBrushKey,
        double borderOpacity,
        double backgroundOpacity,
        double bodyForegroundOpacity,
        string dismissLabel,
        string accessibleName,
        string role,
        string liveSetting,
        bool isAssertive)
    {
        IsVisible = isVisible;
        Variant = variant;
        Title = title;
        HasTitle = hasTitle;
        Body = body;
        IconGlyph = iconGlyph;
        HasIcon = hasIcon;
        Dismissible = dismissible;
        AccentBrushKey = accentBrushKey;
        BorderOpacity = borderOpacity;
        BackgroundOpacity = backgroundOpacity;
        BodyForegroundOpacity = bodyForegroundOpacity;
        DismissLabel = dismissLabel;
        AccessibleName = accessibleName;
        Role = role;
        LiveSetting = liveSetting;
        IsAssertive = isAssertive;
    }

    /// <summary>Whether the banner is shown — content is present and the user has not dismissed it.</summary>
    public bool IsVisible { get; }

    /// <summary>The banner severity (web <c>variant</c>).</summary>
    public CalloutVariant Variant { get; }

    /// <summary>The banner title (web <c>title</c>); empty when absent.</summary>
    public string Title { get; }

    /// <summary>True when a title is rendered (web <c>title &amp;&amp; ...</c>).</summary>
    public bool HasTitle { get; }

    /// <summary>The banner body (web <c>children</c>).</summary>
    public string Body { get; }

    /// <summary>The optional leading glyph (web <c>icon</c>); null when absent.</summary>
    public string? IconGlyph { get; }

    /// <summary>True when a leading icon is rendered (web <c>icon &amp;&amp; ...</c>).</summary>
    public bool HasIcon { get; }

    /// <summary>True when the dismiss affordance is rendered (web <c>onClose &amp;&amp; ...</c>).</summary>
    public bool Dismissible { get; }

    /// <summary>Token brush key for the variant accent (web <c>titleText</c> / <c>border</c> / <c>bg</c> hue).</summary>
    public string AccentBrushKey { get; }

    /// <summary>Border alpha over the accent colour (web <c>border-*/20</c>).</summary>
    public double BorderOpacity { get; }

    /// <summary>Background alpha over the accent colour (web <c>bg-*/5</c>).</summary>
    public double BackgroundOpacity { get; }

    /// <summary>Body / dismiss-glyph foreground alpha over the accent colour (web <c>text-*/80</c>).</summary>
    public double BodyForegroundOpacity { get; }

    /// <summary>The localized dismiss-control accessible name.</summary>
    public string DismissLabel { get; }

    /// <summary>The accessible name a screen reader announces — the title and body together.</summary>
    public string AccessibleName { get; }

    /// <summary>The ARIA role the surface exposes (status / alert).</summary>
    public string Role { get; }

    /// <summary>The ARIA live urgency the banner declares (polite / assertive).</summary>
    public string LiveSetting { get; }

    /// <summary>True for the danger variant — its announcement interrupts the screen reader.</summary>
    public bool IsAssertive { get; }

    /// <summary>
    /// Project a banner model (or its absence) plus the dismissed flag into a render-ready value, reproducing the
    /// web component (AlertBanner.tsx L39-54): the banner is visible when content is present and not dismissed; the
    /// variant selects the accent token and the assistive-tech urgency; the title / body / icon branches mirror the
    /// web optional renders; and the dismiss label is always resolved so it is ready the instant the banner shows.
    /// </summary>
    /// <param name="model">The banner content (web props), or null when there is no alert to show.</param>
    /// <param name="dismissed">Whether the user has dismissed the current alert (web post-<c>onClose</c> removal).</param>
    /// <param name="localizer">The i18n facade the dismiss label resolves through.</param>
    public static AlertBannerProjection Project(AlertBannerModel? model, bool dismissed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        CalloutVariant variant = model?.Variant ?? CalloutVariant.Info;
        string title = model?.Title ?? string.Empty;
        string body = model?.Body ?? string.Empty;
        string? iconGlyph = model?.IconGlyph;
        bool hasIcon = !string.IsNullOrEmpty(iconGlyph);
        bool dismissible = model?.Dismissible ?? false;
        bool isAssertive = CalloutVariants.IsAssertive(variant);

        return new AlertBannerProjection(
            isVisible: model is not null && !dismissed,
            variant: variant,
            title: title,
            hasTitle: title.Length > 0,
            body: body,
            iconGlyph: hasIcon ? iconGlyph : null,
            hasIcon: hasIcon,
            dismissible: dismissible,
            accentBrushKey: AlertBannerRegistration.AccentBrushKey(variant),
            borderOpacity: AlertBannerRegistration.BorderOpacity,
            backgroundOpacity: AlertBannerRegistration.BackgroundOpacity,
            bodyForegroundOpacity: AlertBannerRegistration.BodyForegroundOpacity,
            dismissLabel: AlertBannerRegistration.ResolveDismissLabel(localizer),
            accessibleName: AlertBannerRegistration.ComposeAccessibleName(title, body),
            role: AlertBannerRegistration.RoleFor(variant),
            liveSetting: AlertBannerRegistration.LiveSettingFor(variant),
            isAssertive: isAssertive);
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>AlertBanner</c> surface (P1/S11 diagnostics contract). The banner carries
/// caller-supplied user content, so the collector records ONLY the operational <c>view.opened</c> event with the
/// surface slug — never the title or body — so a diagnostics line can never leak fleet state. Thread-safe; mirrors
/// the peer surfaces' diagnostics collectors.
/// </summary>
public sealed class AlertBannerDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional sink the operational event line is written to.</param>
    public AlertBannerDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=AlertBanner</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={AlertBannerRegistration.Slug}");
    }
}
