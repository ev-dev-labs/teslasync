using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The tri-state cookie/GDPR consent decision the <c>CookieConsentBanner</c> reacts to — the native analogue of
/// the web <c>ConsentState</c> union (web/src/lib/cookieConsent.ts L43, <c>'unknown' | 'accepted' | 'declined'</c>).
/// <see cref="Unknown"/> is the not-yet-decided state (materialised by the absence of the stored key) and is the
/// only value for which the banner is shown; <see cref="Accepted"/> / <see cref="Declined"/> are explicit user
/// decisions that dismiss the banner permanently.
/// </summary>
public enum CookieConsentState
{
    /// <summary>No decision recorded — the banner is shown (web <c>'unknown'</c>; the absent storage key).</summary>
    Unknown,

    /// <summary>The user accepted optional reporting — the banner is hidden (web <c>'accepted'</c>).</summary>
    Accepted,

    /// <summary>The user declined non-essential storage — the banner is hidden (web <c>'declined'</c>).</summary>
    Declined,
}

/// <summary>
/// Canonical metadata for the CookieConsentBanner surface — the native analogue of the module-level literals,
/// storage contract and <c>t()</c> keys in web/src/components/feedback/CookieConsentBanner.tsx and
/// web/src/lib/cookieConsent.ts. Carries the diagnostics slug, the dialog/control automation ids (the web
/// <c>data-testid</c> values), the ARIA role + modality contract, the Segoe Fluent glyph standing in for the web
/// Lucide <c>ShieldCheck</c>, the localStorage key + the persisted "accepted"/"declined" tokens, every i18n key
/// (with the English fallback the web renders verbatim — each already present in the P1/S10 catalogue under
/// <c>translation.consent.*</c>), and the pure consent helpers (<see cref="ParseConsent"/>,
/// <see cref="ToStorageValue"/>, <see cref="IsReportingAllowed"/>). UI-free so it is asserted in tests.
/// </summary>
public static class CookieConsentBannerRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "CookieConsentBanner";

    /// <summary>The automation id Narrator and UI-automation resolve the banner dialog by (web <c>data-testid</c>).</summary>
    public const string BannerAutomationId = "cookie-consent-banner";

    /// <summary>The automation id for the "Manage preferences" / "Hide details" toggle (web <c>data-testid</c>).</summary>
    public const string ToggleDetailsAutomationId = "cookie-consent-toggle-details";

    /// <summary>The automation id for the expandable category details block (web <c>data-testid</c>).</summary>
    public const string DetailsAutomationId = "cookie-consent-details";

    /// <summary>The automation id for the "Accept all" button (web <c>data-testid</c>).</summary>
    public const string AcceptAutomationId = "cookie-consent-accept";

    /// <summary>The automation id for the "Decline non-essential" button (web <c>data-testid</c>).</summary>
    public const string DeclineAutomationId = "cookie-consent-decline";

    /// <summary>ARIA role the banner exposes — a dialog (web <c>role="dialog"</c>).</summary>
    public const string DialogRole = "dialog";

    /// <summary>Whether the dialog is modal — false; the banner is non-blocking (web <c>aria-modal="false"</c>).</summary>
    public const bool IsModal = false;

    /// <summary>Segoe Fluent "Shield" glyph — the native stand-in for the web Lucide <c>ShieldCheck</c> icon.</summary>
    public const string ShieldGlyph = "\uEA18";

    /// <summary>The local storage key the decision is persisted under (web <c>CONSENT_STORAGE_KEY</c>).</summary>
    public const string ConsentStorageKey = "teslasync:consent:v1";

    /// <summary>The persisted token for an accepted decision (web <c>setConsent('accepted')</c>).</summary>
    public const string AcceptedStorageValue = "accepted";

    /// <summary>The persisted token for a declined decision (web <c>setConsent('declined')</c>).</summary>
    public const string DeclinedStorageValue = "declined";

    /// <summary>i18n key for the banner title (web <c>t('consent.banner.title', …)</c>).</summary>
    public const string TitleKey = "translation.consent.banner.title";

    /// <summary>English fallback for <see cref="TitleKey"/> — the web literal, verbatim.</summary>
    public const string TitleFallback = "Cookies & analytics";

    /// <summary>i18n key for the banner body (web <c>t('consent.banner.body', …)</c>).</summary>
    public const string BodyKey = "translation.consent.banner.body";

    /// <summary>English fallback for <see cref="BodyKey"/> — the web literal, verbatim.</summary>
    public const string BodyFallback =
        "TeslaSync uses strictly necessary storage to keep you signed in and to remember your preferences. " +
        "With your consent, we also collect anonymous performance and error reports to improve the app. " +
        "You can change your mind any time in Settings → Privacy.";

    /// <summary>i18n key for the "Hide details" toggle label (web <c>t('consent.banner.hideDetails', …)</c>).</summary>
    public const string HideDetailsKey = "translation.consent.banner.hideDetails";

    /// <summary>English fallback for <see cref="HideDetailsKey"/> — the web literal, verbatim.</summary>
    public const string HideDetailsFallback = "Hide details";

    /// <summary>i18n key for the "Manage preferences" toggle label (web <c>t('consent.banner.manage', …)</c>).</summary>
    public const string ManageKey = "translation.consent.banner.manage";

    /// <summary>English fallback for <see cref="ManageKey"/> — the web literal, verbatim.</summary>
    public const string ManageFallback = "Manage preferences";

    /// <summary>i18n key for the "Accept all" button (web <c>t('consent.banner.accept', …)</c>).</summary>
    public const string AcceptKey = "translation.consent.banner.accept";

    /// <summary>English fallback for <see cref="AcceptKey"/> — the web literal, verbatim.</summary>
    public const string AcceptFallback = "Accept all";

    /// <summary>i18n key for the "Decline non-essential" button (web <c>t('consent.banner.decline', …)</c>).</summary>
    public const string DeclineKey = "translation.consent.banner.decline";

    /// <summary>English fallback for <see cref="DeclineKey"/> — the web literal, verbatim.</summary>
    public const string DeclineFallback = "Decline non-essential";

    /// <summary>i18n key for the strictly-necessary category title (web <c>t('consent.category.essential.title', …)</c>).</summary>
    public const string EssentialTitleKey = "translation.consent.category.essential.title";

    /// <summary>English fallback for <see cref="EssentialTitleKey"/> — the web literal, verbatim.</summary>
    public const string EssentialTitleFallback = "Strictly necessary";

    /// <summary>i18n key for the "Always on" chip on the essential category (web <c>t('consent.category.alwaysOn', …)</c>).</summary>
    public const string AlwaysOnKey = "translation.consent.category.alwaysOn";

    /// <summary>English fallback for <see cref="AlwaysOnKey"/> — the web literal, verbatim.</summary>
    public const string AlwaysOnFallback = "Always on";

    /// <summary>i18n key for the strictly-necessary category body (web <c>t('consent.category.essential.body', …)</c>).</summary>
    public const string EssentialBodyKey = "translation.consent.category.essential.body";

    /// <summary>English fallback for <see cref="EssentialBodyKey"/> — the web literal, verbatim.</summary>
    public const string EssentialBodyFallback =
        "Authentication, session, theme, and saved drafts. Required for the app to work and exempt from " +
        "consent under the ePrivacy directive.";

    /// <summary>i18n key for the analytics category title (web <c>t('consent.category.analytics.title', …)</c>).</summary>
    public const string AnalyticsTitleKey = "translation.consent.category.analytics.title";

    /// <summary>English fallback for <see cref="AnalyticsTitleKey"/> — the web literal, verbatim.</summary>
    public const string AnalyticsTitleFallback = "Performance & error reporting";

    /// <summary>i18n key for the analytics category body (web <c>t('consent.category.analytics.body', …)</c>).</summary>
    public const string AnalyticsBodyKey = "translation.consent.category.analytics.body";

    /// <summary>English fallback for <see cref="AnalyticsBodyKey"/> — the web literal, verbatim.</summary>
    public const string AnalyticsBodyFallback =
        "Anonymous Core Web Vitals (page-load timings) and uncaught error reports sent to this TeslaSync " +
        "instance to help operators diagnose issues. No third parties involved.";

    /// <summary>
    /// Classify a raw persisted value into a <see cref="CookieConsentState"/> — the native port of the web
    /// <c>getConsent()</c> read (web/src/lib/cookieConsent.ts L58-68): only the exact "accepted" / "declined"
    /// tokens resolve to a decision; any other value (including null / an absent key) collapses to
    /// <see cref="CookieConsentState.Unknown"/> so a fresh, wiped or unreadable store all behave identically.
    /// </summary>
    /// <param name="raw">The raw stored token, or null when no value is recorded.</param>
    public static CookieConsentState ParseConsent(string? raw) => raw switch
    {
        AcceptedStorageValue => CookieConsentState.Accepted,
        DeclinedStorageValue => CookieConsentState.Declined,
        _ => CookieConsentState.Unknown,
    };

    /// <summary>
    /// The raw token a decision is persisted as — the native port of the web <c>setConsent</c> /
    /// <c>clearConsent</c> contract (web/src/lib/cookieConsent.ts L88-117): an explicit decision stores its
    /// "accepted" / "declined" token, while <see cref="CookieConsentState.Unknown"/> maps to null (the key is
    /// removed, restoring the not-yet-decided state).
    /// </summary>
    /// <param name="state">The decision to persist.</param>
    public static string? ToStorageValue(CookieConsentState state) => state switch
    {
        CookieConsentState.Accepted => AcceptedStorageValue,
        CookieConsentState.Declined => DeclinedStorageValue,
        _ => null,
    };

    /// <summary>
    /// Whether optional client-side reporting is allowed under the deployment's consent policy — the native port
    /// of the web <c>isReportingAllowed</c> helper (web/src/lib/cookieConsent.ts L163-166): when consent is not
    /// required reporting is always allowed; otherwise it is allowed only after an explicit
    /// <see cref="CookieConsentState.Accepted"/> (both <see cref="CookieConsentState.Unknown"/> and
    /// <see cref="CookieConsentState.Declined"/> block it).
    /// </summary>
    /// <param name="requireConsent">The deployment-wide consent requirement (web <c>require_cookie_consent</c>).</param>
    /// <param name="consent">The user's current stored decision.</param>
    public static bool IsReportingAllowed(bool requireConsent, CookieConsentState consent) =>
        !requireConsent || consent == CookieConsentState.Accepted;
}

/// <summary>
/// The fully projected, render-ready view of the banner — everything the web <c>CookieConsentBanner</c> derives
/// before returning JSX (web/src/components/feedback/CookieConsentBanner.tsx L105-216): whether the banner is
/// shown (<see cref="IsVisible"/> — the web <c>requireConsent &amp;&amp; consent === 'unknown'</c> gate), the
/// localized <see cref="Title"/> / <see cref="Body"/>, the details-toggle state (<see cref="ShowDetails"/> +
/// <see cref="ToggleLabel"/>), the two localized consent categories (strictly-necessary with its
/// <see cref="EssentialAlwaysOnLabel"/> chip, and performance/error reporting), the two action labels, and the
/// accessible name / description the dialog is announced with. Pure value type so every field is asserted
/// headlessly.
/// </summary>
public readonly record struct CookieConsentBannerProjection
{
    private CookieConsentBannerProjection(
        bool isVisible,
        string title,
        string body,
        bool showDetails,
        string toggleLabel,
        string essentialTitle,
        string essentialAlwaysOnLabel,
        string essentialBody,
        string analyticsTitle,
        string analyticsBody,
        string acceptLabel,
        string declineLabel)
    {
        IsVisible = isVisible;
        Title = title;
        Body = body;
        ShowDetails = showDetails;
        ToggleLabel = toggleLabel;
        EssentialTitle = essentialTitle;
        EssentialAlwaysOnLabel = essentialAlwaysOnLabel;
        EssentialBody = essentialBody;
        AnalyticsTitle = analyticsTitle;
        AnalyticsBody = analyticsBody;
        AcceptLabel = acceptLabel;
        DeclineLabel = declineLabel;
    }

    /// <summary>Whether the banner is shown — the web <c>requireConsent &amp;&amp; consent === 'unknown'</c> gate.</summary>
    public bool IsVisible { get; }

    /// <summary>The localized banner title (web <c>consent.banner.title</c>); also the dialog's accessible name.</summary>
    public string Title { get; }

    /// <summary>The localized banner body (web <c>consent.banner.body</c>); also the dialog's description.</summary>
    public string Body { get; }

    /// <summary>Whether the inline category details block is expanded (web <c>showDetails</c>).</summary>
    public bool ShowDetails { get; }

    /// <summary>The toggle label — "Hide details" when expanded, "Manage preferences" otherwise (web ternary).</summary>
    public string ToggleLabel { get; }

    /// <summary>The localized strictly-necessary category title (web <c>consent.category.essential.title</c>).</summary>
    public string EssentialTitle { get; }

    /// <summary>The localized "Always on" chip on the essential category (web <c>consent.category.alwaysOn</c>).</summary>
    public string EssentialAlwaysOnLabel { get; }

    /// <summary>The localized strictly-necessary category body (web <c>consent.category.essential.body</c>).</summary>
    public string EssentialBody { get; }

    /// <summary>The localized performance/error-reporting category title (web <c>consent.category.analytics.title</c>).</summary>
    public string AnalyticsTitle { get; }

    /// <summary>The localized performance/error-reporting category body (web <c>consent.category.analytics.body</c>).</summary>
    public string AnalyticsBody { get; }

    /// <summary>The localized "Accept all" action label (web <c>consent.banner.accept</c>).</summary>
    public string AcceptLabel { get; }

    /// <summary>The localized "Decline non-essential" action label (web <c>consent.banner.decline</c>).</summary>
    public string DeclineLabel { get; }

    /// <summary>The accessible name a screen reader announces for the dialog — the banner title (web <c>aria-labelledby</c>).</summary>
    public string AccessibleName => Title;

    /// <summary>The accessible description a screen reader announces for the dialog — the body (web <c>aria-describedby</c>).</summary>
    public string Description => Body;

    /// <summary>
    /// Project the consent inputs into a render-ready banner value, reproducing the web component
    /// (web/src/components/feedback/CookieConsentBanner.tsx L105-216): the banner is visible only when consent is
    /// required and the user has not yet decided, the toggle label flips with <paramref name="showDetails"/>, and
    /// every label resolves through the i18n facade.
    /// </summary>
    /// <param name="requireConsent">The deployment-wide consent requirement (web <c>requireConsent</c>).</param>
    /// <param name="consent">The user's current stored decision (web <c>consent</c>).</param>
    /// <param name="showDetails">Whether the inline details block is expanded (web <c>showDetails</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static CookieConsentBannerProjection Project(
        bool requireConsent,
        CookieConsentState consent,
        bool showDetails,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        var toggleLabel = showDetails
            ? localizer.GetString(CookieConsentBannerRegistration.HideDetailsKey, CookieConsentBannerRegistration.HideDetailsFallback)
            : localizer.GetString(CookieConsentBannerRegistration.ManageKey, CookieConsentBannerRegistration.ManageFallback);

        return new CookieConsentBannerProjection(
            isVisible: requireConsent && consent == CookieConsentState.Unknown,
            title: localizer.GetString(CookieConsentBannerRegistration.TitleKey, CookieConsentBannerRegistration.TitleFallback),
            body: localizer.GetString(CookieConsentBannerRegistration.BodyKey, CookieConsentBannerRegistration.BodyFallback),
            showDetails: showDetails,
            toggleLabel: toggleLabel,
            essentialTitle: localizer.GetString(CookieConsentBannerRegistration.EssentialTitleKey, CookieConsentBannerRegistration.EssentialTitleFallback),
            essentialAlwaysOnLabel: localizer.GetString(CookieConsentBannerRegistration.AlwaysOnKey, CookieConsentBannerRegistration.AlwaysOnFallback),
            essentialBody: localizer.GetString(CookieConsentBannerRegistration.EssentialBodyKey, CookieConsentBannerRegistration.EssentialBodyFallback),
            analyticsTitle: localizer.GetString(CookieConsentBannerRegistration.AnalyticsTitleKey, CookieConsentBannerRegistration.AnalyticsTitleFallback),
            analyticsBody: localizer.GetString(CookieConsentBannerRegistration.AnalyticsBodyKey, CookieConsentBannerRegistration.AnalyticsBodyFallback),
            acceptLabel: localizer.GetString(CookieConsentBannerRegistration.AcceptKey, CookieConsentBannerRegistration.AcceptFallback),
            declineLabel: localizer.GetString(CookieConsentBannerRegistration.DeclineKey, CookieConsentBannerRegistration.DeclineFallback));
    }
}

/// <summary>
/// PII-safe diagnostics for the CookieConsentBanner surface (P1/S11 diagnostics contract). The banner carries no
/// user content (only a deployment flag and an opaque tri-state decision), so the collector records ONLY the
/// operational <c>view.opened</c> event with the surface slug — never the consent decision itself, mirroring the
/// web component which persists the decision locally and emits no telemetry. Thread-safe; mirrors the peer
/// surfaces' diagnostics collectors.
/// </summary>
public sealed class CookieConsentBannerDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public CookieConsentBannerDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=CookieConsentBanner</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={CookieConsentBannerRegistration.Slug}");
    }
}
