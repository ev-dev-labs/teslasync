using System.Globalization;
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata for the ImpersonationBanner surface — the native analogue of the literals and <c>t()</c> keys
/// in web/src/components/feedback/ImpersonationBanner.tsx. Carries the diagnostics slug, the banner / countdown /
/// end automation ids (the web <c>data-testid</c> values), the ARIA role + live contract (web <c>role="alert"</c> /
/// <c>aria-live="polite"</c> — the impersonation context must be unmissable but is not interruptive), the generated
/// amber warning design-token keys + the Segoe Fluent glyph standing in for the web Lucide <c>UserCheck</c> mark, the
/// amber-300 tint alphas, and the i18n keys (each with the English fallback the web renders verbatim — all six already
/// present in the P1/S10 catalogue under <c>translation.impersonation.banner.*</c>). It also owns the pure
/// <see cref="FormatRemaining"/> port of the web countdown formatter. UI-free so it is asserted in tests.
/// </summary>
public static class ImpersonationBannerRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "ImpersonationBanner";

    /// <summary>The automation id Narrator and UI-automation resolve the banner by (web <c>data-testid</c>).</summary>
    public const string BannerAutomationId = "impersonation-banner";

    /// <summary>The automation id for the remaining-lifetime countdown line (web <c>data-testid</c>).</summary>
    public const string CountdownAutomationId = "impersonation-banner-countdown";

    /// <summary>The automation id for the "End impersonation" button (web <c>data-testid</c>).</summary>
    public const string EndAutomationId = "impersonation-banner-end";

    /// <summary>ARIA role the surface exposes — an alert region (web <c>role="alert"</c>).</summary>
    public const string AlertRole = "alert";

    /// <summary>ARIA live urgency the surface declares (web <c>aria-live="polite"</c>).</summary>
    public const string LiveSetting = "polite";

    /// <summary>Generated design-token colour key the amber banner tint is derived from (web amber-300).</summary>
    public const string WarningColorKey = "TsColorWarningColor";

    /// <summary>Banner background alpha over the warning colour (web <c>bg-amber-300/[0.12]</c>).</summary>
    public const double BannerBackgroundOpacity = 0.12;

    /// <summary>Banner bottom-border alpha over the warning colour (web <c>border-amber-300/40</c>).</summary>
    public const double BannerBorderOpacity = 0.40;

    /// <summary>Icon-chip background alpha over the warning colour (web <c>bg-amber-300/20</c>).</summary>
    public const double IconChipOpacity = 0.20;

    /// <summary>Generated warning brush key the banner icon tints from — the shared callout warning brush (web amber-300).</summary>
    public static string WarningBrushKey { get; } = CalloutVariants.AccentBrushKey(CalloutVariant.Warning);

    /// <summary>Segoe Fluent "Admin" glyph — the native stand-in for the web Lucide <c>UserCheck</c> identity mark.</summary>
    public const string IdentityGlyph = "\uE7EF";

    /// <summary>i18n key for the banner title (web <c>t('impersonation.banner.title', ...)</c> at ImpersonationBanner.tsx L107).</summary>
    public const string TitleKey = "translation.impersonation.banner.title";

    /// <summary>English fallback for <see cref="TitleKey"/> — the web default value, with the native <c>{0}</c> slot.</summary>
    public const string TitleFallback = "Impersonating {0}";

    /// <summary>i18n key for the banner body (web <c>t('impersonation.banner.body', ...)</c> at ImpersonationBanner.tsx L110).</summary>
    public const string BodyKey = "translation.impersonation.banner.body";

    /// <summary>English fallback for <see cref="BodyKey"/> — the web default value, verbatim.</summary>
    public const string BodyFallback =
        "You are viewing TeslaSync as another subject. End impersonation to restore your session.";

    /// <summary>i18n key for the remaining-lifetime line (web <c>t('impersonation.banner.endsIn', ...)</c> at ImpersonationBanner.tsx L81).</summary>
    public const string EndsInKey = "translation.impersonation.banner.endsIn";

    /// <summary>English fallback for <see cref="EndsInKey"/> — the web default value, with the native <c>{0}</c> slot.</summary>
    public const string EndsInFallback = "Expires in {0}";

    /// <summary>i18n key for the expired-claim line (web <c>t('impersonation.banner.expired', ...)</c> at ImpersonationBanner.tsx L85).</summary>
    public const string ExpiredKey = "translation.impersonation.banner.expired";

    /// <summary>English fallback for <see cref="ExpiredKey"/> — the web default value, verbatim.</summary>
    public const string ExpiredFallback = "Session expired";

    /// <summary>i18n key for the busy end label (web <c>t('impersonation.banner.ending', ...)</c> at ImpersonationBanner.tsx L129).</summary>
    public const string EndingKey = "translation.impersonation.banner.ending";

    /// <summary>English fallback for <see cref="EndingKey"/> — the web default value, verbatim (trailing ellipsis).</summary>
    public const string EndingFallback = "Ending\u2026";

    /// <summary>i18n key for the idle end label (web <c>t('impersonation.banner.end', ...)</c> at ImpersonationBanner.tsx L130).</summary>
    public const string EndKey = "translation.impersonation.banner.end";

    /// <summary>English fallback for <see cref="EndKey"/> — the web default value, verbatim.</summary>
    public const string EndFallback = "End impersonation";

    /// <summary>Resolve the localized banner title with the subject interpolated (web <c>t('impersonation.banner.title', { target })</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <param name="target">The impersonated subject identifier.</param>
    public static string ResolveTitle(ILocalizer localizer, string target)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return Format(localizer.GetString(TitleKey, TitleFallback), target ?? string.Empty);
    }

    /// <summary>Resolve the localized banner body (web <c>t('impersonation.banner.body')</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string ResolveBody(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(BodyKey, BodyFallback);
    }

    /// <summary>Resolve the localized remaining-lifetime line with the formatted time interpolated (web <c>t('impersonation.banner.endsIn', { time })</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <param name="time">The pre-formatted remaining-lifetime string (see <see cref="FormatRemaining"/>).</param>
    public static string ResolveEndsIn(ILocalizer localizer, string time)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return Format(localizer.GetString(EndsInKey, EndsInFallback), time ?? string.Empty);
    }

    /// <summary>Resolve the localized expired-claim line (web <c>t('impersonation.banner.expired')</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string ResolveExpired(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(ExpiredKey, ExpiredFallback);
    }

    /// <summary>Resolve the localized end-button label — busy while ending, idle otherwise (web ternary at ImpersonationBanner.tsx L128-130).</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <param name="isEnding">Whether the end mutation is in flight.</param>
    public static string ResolveEndLabel(ILocalizer localizer, bool isEnding)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return isEnding
            ? localizer.GetString(EndingKey, EndingFallback)
            : localizer.GetString(EndKey, EndFallback);
    }

    /// <summary>
    /// Render the remaining cookie lifetime as <c>"HHh MMm"</c> or <c>"MMm SSs"</c> or <c>"SSs"</c> — the faithful
    /// port of the web <c>formatRemaining(ms)</c> helper (ImpersonationBanner.tsx L29-42). The minutes and seconds
    /// are zero-padded to two digits exactly as the web <c>String(n).padStart(2, '0')</c>; the leading magnitude is
    /// not. Negative spans floor to zero.
    /// </summary>
    /// <param name="remaining">The time left until the impersonation cookie expires.</param>
    public static string FormatRemaining(TimeSpan remaining)
    {
        var total = (long)Math.Max(0, Math.Floor(remaining.TotalSeconds));
        var hours = total / 3600;
        var minutes = total % 3600 / 60;
        var seconds = total % 60;

        if (hours > 0)
        {
            return string.Format(CultureInfo.InvariantCulture, "{0}h {1:D2}m", hours, minutes);
        }

        if (minutes > 0)
        {
            return string.Format(CultureInfo.InvariantCulture, "{0}m {1:D2}s", minutes, seconds);
        }

        return string.Format(CultureInfo.InvariantCulture, "{0}s", seconds);
    }

    private static string Format(string template, string argument) =>
        template.Contains("{0}", StringComparison.Ordinal)
            ? string.Format(CultureInfo.CurrentCulture, template, argument)
            : template;
}

/// <summary>
/// The fully projected, render-ready view of the impersonation status — everything the web
/// <c>ImpersonationBanner</c> derives before returning JSX (web/src/components/feedback/ImpersonationBanner.tsx
/// L44-132): whether the banner is shown (<see cref="IsVisible"/> — the web
/// <c>if (!isImpersonationActive(data)) return null</c> gate), the localized <see cref="Title"/> /
/// <see cref="Body"/>, the remaining-lifetime <see cref="Countdown"/> (present only when the claim carries a
/// parseable <c>expires_at</c>, web <c>countdown</c>), the busy-aware end-button <see cref="EndLabel"/>, the ARIA
/// <see cref="LiveSetting"/>, and the <see cref="AccessibleName"/> the polite alert region announces. Pure value
/// type recomputed every countdown tick, so every field is asserted headlessly.
/// </summary>
public readonly record struct ImpersonationBannerProjection
{
    private ImpersonationBannerProjection(
        bool isVisible,
        string target,
        string title,
        string body,
        bool hasCountdown,
        string countdown,
        string endLabel,
        bool isEnding,
        string accessibleName,
        string liveSetting)
    {
        IsVisible = isVisible;
        Target = target;
        Title = title;
        Body = body;
        HasCountdown = hasCountdown;
        Countdown = countdown;
        EndLabel = endLabel;
        IsEnding = isEnding;
        AccessibleName = accessibleName;
        LiveSetting = liveSetting;
    }

    /// <summary>Whether the banner is shown — the web <c>if (!isImpersonationActive(data)) return null</c> gate, inverted.</summary>
    public bool IsVisible { get; }

    /// <summary>The impersonated subject identifier (web <c>data.target</c>).</summary>
    public string Target { get; }

    /// <summary>The localized banner title (web <c>impersonation.banner.title</c>).</summary>
    public string Title { get; }

    /// <summary>The localized banner body (web <c>impersonation.banner.body</c>).</summary>
    public string Body { get; }

    /// <summary>Whether the remaining-lifetime line is shown (web <c>countdown !== null</c>, i.e. a parseable expiry).</summary>
    public bool HasCountdown { get; }

    /// <summary>The localized remaining-lifetime line (web <c>countdown</c>), or empty when <see cref="HasCountdown"/> is false.</summary>
    public string Countdown { get; }

    /// <summary>The localized end-button label — busy while ending, idle otherwise (web ternary).</summary>
    public string EndLabel { get; }

    /// <summary>Whether the end mutation is in flight (web <c>endMut.isPending</c>) — drives the disabled button.</summary>
    public bool IsEnding { get; }

    /// <summary>The accessible name the polite alert region announces — the title, body and (when shown) the countdown.</summary>
    public string AccessibleName { get; }

    /// <summary>The ARIA live urgency the banner declares (polite).</summary>
    public string LiveSetting { get; }

    /// <summary>
    /// Project an impersonation status snapshot into a render-ready banner value, reproducing the web component
    /// (web/src/components/feedback/ImpersonationBanner.tsx L44-132): the banner is shown only while the status mode
    /// is <c>active</c>; the countdown is derived from the claim's <c>expires_at</c> against <paramref name="now"/>
    /// (more than a second left → "Expires in {time}", otherwise → "Session expired", absent / unparseable expiry →
    /// no countdown line); and the end-button label reflects the in-flight end mutation.
    /// </summary>
    /// <param name="snapshot">The current impersonation status (web <c>useImpersonationStatus().data</c>).</param>
    /// <param name="now">The instant the countdown is measured against (web <c>now</c> tick state).</param>
    /// <param name="isEnding">Whether the end mutation is in flight (web <c>endMut.isPending</c>).</param>
    /// <param name="localizer">The i18n facade the strings resolve through.</param>
    public static ImpersonationBannerProjection Project(
        ImpersonationStatusSnapshot snapshot,
        DateTimeOffset now,
        bool isEnding,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentNullException.ThrowIfNull(localizer);

        var isVisible = snapshot.Mode == ImpersonationMode.Active;
        var target = snapshot.Target ?? string.Empty;
        var title = ImpersonationBannerRegistration.ResolveTitle(localizer, target);
        var body = ImpersonationBannerRegistration.ResolveBody(localizer);
        var (hasCountdown, countdown) = ResolveCountdown(snapshot.ExpiresAtInstant, now, localizer);
        var endLabel = ImpersonationBannerRegistration.ResolveEndLabel(localizer, isEnding);
        var accessibleName = hasCountdown ? $"{title}. {body} {countdown}" : $"{title}. {body}";

        return new ImpersonationBannerProjection(
            isVisible,
            target,
            title,
            body,
            hasCountdown,
            countdown,
            endLabel,
            isEnding,
            accessibleName,
            ImpersonationBannerRegistration.LiveSetting);
    }

    // web L77-87: a countdown is derived only when expiresMs !== null; a remaining magnitude over one second renders
    // "Expires in {time}", and anything at-or-below one second renders "Session expired".
    private static (bool HasCountdown, string Countdown) ResolveCountdown(
        DateTimeOffset? expiresAt,
        DateTimeOffset now,
        ILocalizer localizer)
    {
        if (expiresAt is not { } expiry)
        {
            return (false, string.Empty);
        }

        var remaining = expiry - now;
        return remaining > TimeSpan.FromSeconds(1)
            ? (true, ImpersonationBannerRegistration.ResolveEndsIn(
                localizer,
                ImpersonationBannerRegistration.FormatRemaining(remaining)))
            : (true, ImpersonationBannerRegistration.ResolveExpired(localizer));
    }
}

/// <summary>
/// PII-safe diagnostics for the ImpersonationBanner surface (P1/S11 diagnostics contract). The banner carries the
/// impersonated subject identifier, which must NEVER reach a diagnostics line — the collector records only the
/// operational <c>view.opened</c> event plus the end-action counters with the surface slug, never the subject or the
/// original admin. Thread-safe; mirrors the peer surfaces' diagnostics collectors.
/// </summary>
public sealed class ImpersonationBannerDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;
    private long _endsRequested;
    private long _endsSucceeded;
    private long _endsFailed;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the diagnostics lines are written to, or null.</param>
    public ImpersonationBannerDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Number of end-impersonation actions invoked.</summary>
    public long EndsRequested => Interlocked.Read(ref _endsRequested);

    /// <summary>Number of end-impersonation actions that succeeded.</summary>
    public long EndsSucceeded => Interlocked.Read(ref _endsSucceeded);

    /// <summary>Number of end-impersonation actions that failed.</summary>
    public long EndsFailed => Interlocked.Read(ref _endsFailed);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ImpersonationBanner</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={ImpersonationBannerRegistration.Slug}");
    }

    /// <summary>Record that an end action was invoked (no subject is ever logged).</summary>
    public void RecordEndRequested()
    {
        Interlocked.Increment(ref _endsRequested);
        _sink?.Invoke($"impersonation.end.requested slug={ImpersonationBannerRegistration.Slug}");
    }

    /// <summary>Record the resolution of an end action (success/failure only — never the subject).</summary>
    /// <param name="success">Whether the end mutation succeeded.</param>
    public void RecordEndResolved(bool success)
    {
        if (success)
        {
            Interlocked.Increment(ref _endsSucceeded);
        }
        else
        {
            Interlocked.Increment(ref _endsFailed);
        }

        _sink?.Invoke(
            $"impersonation.end.resolved slug={ImpersonationBannerRegistration.Slug} success={(success ? "true" : "false")}");
    }
}
