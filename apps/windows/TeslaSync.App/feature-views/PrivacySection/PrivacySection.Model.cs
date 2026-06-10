using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The freshness state of the <c>require_cookie_consent</c> read backing the consent panel — the native
/// analogue of the web <c>useVersionInfo</c> query status
/// (web/src/features/settings/components/PrivacySection.tsx). The consent panel is <b>always</b> rendered
/// (web parity: the controls are shown even when the deployment-wide flag is off so operators can preview the
/// flow); this only annotates the freshness chip and selects the body copy. When the read has no value yet,
/// is offline-without-cache, or has hard-failed, the surface treats consent as not-required
/// (web <c>Boolean(versionQuery.data?.require_cookie_consent)</c> coalesces <c>undefined</c> to
/// <c>false</c>) and shows the "preview" body — it never hides the panel.
/// </summary>
public enum PrivacyRequirementState
{
    /// <summary>The first version read is in flight and no cached value exists yet.</summary>
    Loading,

    /// <summary>A fresh value is shown (web <c>version.isSuccess</c>; the freshness chip reads "Live").</summary>
    Ready,

    /// <summary>A cached value is shown but is past the freshness window (web <c>version.isStale</c>).</summary>
    Stale,

    /// <summary>The network is unreachable; a cached value may be shown with an offline chip.</summary>
    Offline,

    /// <summary>The version read hard-failed with no cache; the panel shows the "preview" body + a retry.</summary>
    Error,
}

/// <summary>
/// Null-tolerant <see cref="JsonElement"/> reader for the <c>/system/version</c> body. The only field the
/// privacy surface consumes is <c>require_cookie_consent</c> (web <c>versionQuery.data?.require_cookie_consent</c>);
/// every shape other than a JSON boolean <c>true</c> coalesces to <c>false</c>, exactly as the web's
/// <c>Boolean(undefined)</c> does. Free of WinUI types so the parse is unit-tested without a UI host.
/// </summary>
internal static class PrivacySectionJson
{
    /// <summary>
    /// Read the deployment-wide cookie-consent requirement. Returns <c>true</c> only for a JSON object whose
    /// <c>require_cookie_consent</c> member is the boolean <c>true</c>; a missing field, a non-object body, or
    /// any non-true value yields <c>false</c> (web <c>Boolean(...)</c> parity).
    /// </summary>
    public static bool ReadRequireConsent(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object
            || !element.TryGetProperty("require_cookie_consent", out var flag))
        {
            return false;
        }

        return flag.ValueKind == JsonValueKind.True;
    }
}

/// <summary>
/// Maps a raw <see cref="RepositoryResult{T}"/> of the <c>/system/version</c> JSON envelope onto a typed
/// <see cref="RepositoryResult{T}"/> of the <c>require_cookie_consent</c> flag, preserving the load status,
/// fetch time, stale flag and error so the view-model can drive the freshness chip and the "preview" fallback.
/// Pure — unit-tested without a UI host.
/// </summary>
public static class ConsentRequirementResultMapper
{
    /// <summary>Project one raw version emission into a typed requirement-flag result.</summary>
    public static RepositoryResult<bool> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<bool>.Loading(),
            LoadStatus.Empty => RepositoryResult<bool>.Empty(raw.FetchedAt),
            LoadStatus.Error => RepositoryResult<bool>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
            LoadStatus.Cached => RepositoryResult<bool>.Cached(Flag(raw), raw.FetchedAt ?? default, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<bool>.Refreshing(Flag(raw), raw.FetchedAt ?? default, raw.IsStale),
            LoadStatus.Offline => RepositoryResult<bool>.OfflineCached(
                Flag(raw),
                raw.FetchedAt ?? default,
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Network, "Offline")),
            _ => RepositoryResult<bool>.Loaded(Flag(raw), raw.FetchedAt ?? default),
        };
    }

    private static bool Flag(RepositoryResult<JsonElement> raw) =>
        raw.HasValue && PrivacySectionJson.ReadRequireConsent(raw.Value);
}

/// <summary>
/// Pure projections for the privacy surface — the native analogue of the web component's inline copy
/// selection (the <c>consentLabel</c> switch and the <c>requireConsent ? bodyOn : bodyOff</c> ternary in
/// web/src/features/settings/components/PrivacySection.tsx). Every user-visible string flows through the i18n
/// facade so the projection is unit-tested headlessly and the view never resolves a literal.
/// </summary>
public static class PrivacySectionProjection
{
    /// <summary>
    /// The localized one-line summary of the current consent decision (web <c>consentLabel</c>): the three
    /// mutually-exclusive accepted / declined / not-decided strings.
    /// </summary>
    public static string ConsentStateLabel(PrivacyConsentState state, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return state switch
        {
            PrivacyConsentState.Accepted => PrivacySectionRegistration.ConsentStateAccepted(localizer),
            PrivacyConsentState.Declined => PrivacySectionRegistration.ConsentStateDeclined(localizer),
            _ => PrivacySectionRegistration.ConsentStateUnknown(localizer),
        };
    }

    /// <summary>
    /// The localized consent-section body copy (web <c>requireConsent ? bodyOn : bodyOff</c>): the "we collect
    /// reports with your consent" copy when the deployment requires consent, else the "preview the flow" copy.
    /// </summary>
    public static string ConsentBody(bool requireConsent, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return requireConsent
            ? PrivacySectionRegistration.ConsentBodyOn(localizer)
            : PrivacySectionRegistration.ConsentBodyOff(localizer);
    }

    /// <summary>
    /// The localized stored-entries counter (web <c>t('recentPages.storedCount', { count, defaultValue:
    /// `${count} entries stored` })</c>), formatting the count into the resolved template's <c>{0}</c> slot.
    /// </summary>
    public static string RecentCountLabel(int count, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        int safe = Math.Max(0, count);
        string template = PrivacySectionRegistration.RecentStoredCountTemplate(localizer);
        return template.Contains("{0}", StringComparison.Ordinal)
            ? string.Format(CultureInfo.CurrentCulture, template, safe)
            : string.Create(CultureInfo.CurrentCulture, $"{safe} {template}");
    }
}

/// <summary>
/// Canonical metadata + i18n keys for the <c>PrivacySection</c> feature surface — the native mirror of the web
/// component at <c>web/src/features/settings/components/PrivacySection.tsx</c>. Centralises the diagnostics
/// slug, the Segoe Fluent glyphs standing in for the web Lucide icons, and every localized string keyed
/// exactly as the web <c>t(...)</c> calls (with the same English fallbacks) so the view and view-model stay
/// free of literal copy. The native chrome for the version-read freshness states (retry / error hints) — which
/// the web fragment delegates to its host — is added here with its own keys. UI-free so every key is asserted
/// in tests.
/// </summary>
public static class PrivacySectionRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "PrivacySection";

    /// <summary>Stable action id the "Don't ask again" silence opt-in is keyed by (web <c>CONFIRM_SILENCE_KEY</c>).</summary>
    public const string ClearSilenceKey = "clear-recent-pages";

    /// <summary>Segoe Fluent "Shield" glyph standing in for the web <c>ShieldCheck</c> header icon.</summary>
    public const string HeaderGlyph = "\uEA18";

    /// <summary>Segoe Fluent "Delete" glyph standing in for the web <c>Trash2</c> clear-button icon.</summary>
    public const string ClearGlyph = "\uE74D";

    /// <summary>Segoe Fluent "Warning" glyph for the destructive clear confirmation dialog.</summary>
    public const string WarningGlyph = "\uE7BA";

    /// <summary>Segoe Fluent "CheckMark" glyph for the inline action-success line (the web toast).</summary>
    public const string SuccessGlyph = "\uE73E";

    // ── Header (web privacy.title / privacy.subtitle) ────────────────────────────────────────────────────

    /// <summary>Panel heading (web <c>privacy.title</c>).</summary>
    public static string Title(ILocalizer localizer) =>
        Require(localizer).GetString("privacy.title", "Privacy");

    /// <summary>Panel subtitle (web <c>privacy.subtitle</c>).</summary>
    public static string Subtitle(ILocalizer localizer) =>
        Require(localizer).GetString(
            "privacy.subtitle",
            "Manage local browsing history surfaces. These settings only affect this browser.");

    // ── Recent pages panel (web recentPages.*) ───────────────────────────────────────────────────────────

    /// <summary>Recent-pages panel title (web <c>recentPages.clearTitle</c>).</summary>
    public static string RecentClearTitle(ILocalizer localizer) =>
        Require(localizer).GetString("recentPages.clearTitle", "Recently viewed pages");

    /// <summary>Recent-pages panel body (web <c>recentPages.clearBody</c>).</summary>
    public static string RecentClearBody(ILocalizer localizer) =>
        Require(localizer).GetString(
            "recentPages.clearBody",
            "Wipe the list of pages used by the dashboard widget and the Recent section in the command palette.");

    /// <summary>Stored-entries counter template (web <c>recentPages.storedCount</c>, <c>{0}</c> = count).</summary>
    public static string RecentStoredCountTemplate(ILocalizer localizer) =>
        Require(localizer).GetString("recentPages.storedCount", "{0} entries stored");

    /// <summary>Clear-button label (web <c>recentPages.clearButton</c>).</summary>
    public static string RecentClearButton(ILocalizer localizer) =>
        Require(localizer).GetString("recentPages.clearButton", "Clear recent pages");

    /// <summary>Clear-confirmation dialog title (web <c>recentPages.clearConfirmTitle</c>).</summary>
    public static string ClearConfirmTitle(ILocalizer localizer) =>
        Require(localizer).GetString("recentPages.clearConfirmTitle", "Clear recent pages?");

    /// <summary>Clear-confirmation dialog message (web <c>recentPages.clearConfirmBody</c>).</summary>
    public static string ClearConfirmBody(ILocalizer localizer) =>
        Require(localizer).GetString(
            "recentPages.clearConfirmBody",
            "This will wipe the list immediately. The dashboard widget and palette Recent section will be empty until you visit new pages.");

    /// <summary>Clear-confirmation primary-button label (web <c>recentPages.clearConfirmCta</c>).</summary>
    public static string ClearConfirmCta(ILocalizer localizer) =>
        Require(localizer).GetString("recentPages.clearConfirmCta", "Clear pages");

    /// <summary>Inline success line after a clear (web <c>recentPages.cleared</c> toast).</summary>
    public static string ClearedToast(ILocalizer localizer) =>
        Require(localizer).GetString("recentPages.cleared", "Recent pages cleared");

    // ── Consent panel (web consent.*) ────────────────────────────────────────────────────────────────────

    /// <summary>Consent panel title (web <c>consent.section.title</c>).</summary>
    public static string ConsentSectionTitle(ILocalizer localizer) =>
        Require(localizer).GetString("consent.section.title", "Cookies & analytics consent");

    /// <summary>Consent body when the deployment requires consent (web <c>consent.section.bodyOn</c>).</summary>
    public static string ConsentBodyOn(ILocalizer localizer) =>
        Require(localizer).GetString(
            "consent.section.bodyOn",
            "This deployment collects anonymous performance and error reports with your consent. Strictly necessary storage (auth, settings) is always on.");

    /// <summary>Consent body when consent is not required (web <c>consent.section.bodyOff</c>).</summary>
    public static string ConsentBodyOff(ILocalizer localizer) =>
        Require(localizer).GetString(
            "consent.section.bodyOff",
            "This deployment does not require consent collection \u2014 these controls let you preview the user-facing flow.");

    /// <summary>Accepted-state label (web <c>consent.state.accepted</c>).</summary>
    public static string ConsentStateAccepted(ILocalizer localizer) =>
        Require(localizer).GetString(
            "consent.state.accepted",
            "Accepted \u2014 performance & error reporting on");

    /// <summary>Declined-state label (web <c>consent.state.declined</c>).</summary>
    public static string ConsentStateDeclined(ILocalizer localizer) =>
        Require(localizer).GetString(
            "consent.state.declined",
            "Declined \u2014 only essential storage in use");

    /// <summary>Not-decided-state label (web <c>consent.state.unknown</c>).</summary>
    public static string ConsentStateUnknown(ILocalizer localizer) =>
        Require(localizer).GetString(
            "consent.state.unknown",
            "Not decided \u2014 banner will appear on next visit");

    /// <summary>Grant/accept button label (web <c>consent.action.accept</c>).</summary>
    public static string ConsentActionAccept(ILocalizer localizer) =>
        Require(localizer).GetString("consent.action.accept", "Re-grant consent");

    /// <summary>Decline/withdraw button label (web <c>consent.action.decline</c>).</summary>
    public static string ConsentActionDecline(ILocalizer localizer) =>
        Require(localizer).GetString("consent.action.decline", "Withdraw consent");

    /// <summary>Reset button label (web <c>consent.action.reset</c>).</summary>
    public static string ConsentActionReset(ILocalizer localizer) =>
        Require(localizer).GetString("consent.action.reset", "Reset");

    /// <summary>Inline success line after granting consent (web <c>consent.toast.accepted</c>).</summary>
    public static string ConsentAcceptedToast(ILocalizer localizer) =>
        Require(localizer).GetString("consent.toast.accepted", "Consent granted");

    /// <summary>Inline success line after withdrawing consent (web <c>consent.toast.declined</c>).</summary>
    public static string ConsentDeclinedToast(ILocalizer localizer) =>
        Require(localizer).GetString("consent.toast.declined", "Consent withdrawn");

    /// <summary>Inline success line after resetting consent (web <c>consent.toast.reset</c>).</summary>
    public static string ConsentResetToast(ILocalizer localizer) =>
        Require(localizer).GetString("consent.toast.reset", "Consent reset \u2014 banner will reappear");

    // ── Shared / dialog chrome ───────────────────────────────────────────────────────────────────────────

    /// <summary>Cancel-button label, shared by the confirm dialog (web <c>common.cancel</c>).</summary>
    public static string CancelLabel(ILocalizer localizer) =>
        Require(localizer).GetString("common.cancel", "Cancel");

    /// <summary>"Don't ask again" silence checkbox label (web <c>confirm.silence.checkbox</c>).</summary>
    public static string SilenceCheckbox(ILocalizer localizer) =>
        Require(localizer).GetString("confirm.silence.checkbox", "Don't ask again for this action");

    // ── Native version-read chrome (web delegates these states to its host) ──────────────────────────────

    /// <summary>Loading hint while the consent-requirement read is in flight (native chrome).</summary>
    public static string RequirementLoadingLabel(ILocalizer localizer) =>
        Require(localizer).GetString("privacy.consent.requirement.loading", "Checking consent settings\u2026");

    /// <summary>Hard-failure hint for the consent-requirement read (native chrome).</summary>
    public static string RequirementErrorLabel(ILocalizer localizer) =>
        Require(localizer).GetString(
            "privacy.consent.requirement.error",
            "Couldn't check whether this deployment requires consent.");

    /// <summary>Retry affordance label for the consent-requirement error (native chrome).</summary>
    public static string RetryLabel(ILocalizer localizer) =>
        Require(localizer).GetString("privacy.consent.requirement.retry", "Try again");

    private static ILocalizer Require(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer;
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>PrivacySection</c> surface (P1/S11 diagnostics contract). Records only
/// operational counters with the surface slug — never the recent-page history (which leaks browsing patterns)
/// nor the specific consent decision — so a diagnostics line can never leak a user's private choices.
/// Thread-safe.
/// </summary>
public sealed class PrivacySectionDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;
    private long _recentPagesCleared;
    private long _consentChanges;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public PrivacySectionDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Number of times the recent-pages list was cleared.</summary>
    public long RecentPagesCleared => Interlocked.Read(ref _recentPagesCleared);

    /// <summary>Number of consent decisions changed (grant / withdraw / reset, undifferentiated).</summary>
    public long ConsentChanges => Interlocked.Read(ref _consentChanges);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=PrivacySection</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={PrivacySectionRegistration.Slug}");
    }

    /// <summary>Record that the recent-pages list was cleared (no paths are ever logged).</summary>
    public void RecordRecentPagesCleared()
    {
        Interlocked.Increment(ref _recentPagesCleared);
        _sink?.Invoke($"privacy.recentPages.cleared slug={PrivacySectionRegistration.Slug}");
    }

    /// <summary>Record that the consent decision changed (the specific choice is never logged).</summary>
    public void RecordConsentChanged()
    {
        Interlocked.Increment(ref _consentChanges);
        _sink?.Invoke($"privacy.consent.changed slug={PrivacySectionRegistration.Slug}");
    }
}
