using System.Globalization;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Which resilience condition raised the banner — the two mutually-exclusive shapes the web
/// <c>RateLimitBanner</c> renders (web/src/components/feedback/RateLimitBanner.tsx L44): a client-side
/// rate-limit (<see cref="RateLimited"/>, the web <c>teslasync:rate-limited</c> 429 event) or an upstream
/// circuit-breaker trip (<see cref="UpstreamDown"/>, the web <c>teslasync:upstream-down</c> 503
/// <c>UPSTREAM_BREAKER_OPEN</c> event). Each selects a different glyph and copy; both share the countdown,
/// retry and dismiss behaviour.
/// </summary>
public enum RateLimitKind
{
    /// <summary>A 429 rate-limit on an API scope — the web <c>kind: 'rate-limited'</c> (Clock glyph).</summary>
    RateLimited,

    /// <summary>An upstream breaker trip — the web <c>kind: 'upstream-down'</c> (AlertCircle glyph).</summary>
    UpstreamDown,
}

/// <summary>
/// Canonical metadata for the RateLimitBanner surface — the native analogue of the literals, the Lucide icons
/// and the <c>t()</c> keys in web/src/components/feedback/RateLimitBanner.tsx. Carries the diagnostics slug, the
/// banner / control automation ids, the Segoe Fluent glyphs standing in for the web Lucide <c>Clock</c> /
/// <c>AlertCircle</c> / <c>X</c> icons, the amber "warning" accent token keys (the web <c>amber-300</c> tint),
/// every i18n key (with the English fallback the web renders verbatim — each already present in the P1/S10
/// catalogue under <c>translation.*</c>), and the pure countdown / message helpers. UI-free so it is asserted in
/// tests.
/// </summary>
public static class RateLimitBannerRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "RateLimitBanner";

    /// <summary>The automation id Narrator and UI-automation resolve the banner strip by (web <c>data-testid</c>).</summary>
    public const string BannerAutomationId = "rate-limit-banner";

    /// <summary>The automation id for the "Retry now" button (web <c>rate-limit-banner-retry</c>).</summary>
    public const string RetryAutomationId = "rate-limit-banner-retry";

    /// <summary>The automation id for the dismiss ("X") button (web <c>rate-limit-banner-dismiss</c>).</summary>
    public const string DismissAutomationId = "rate-limit-banner-dismiss";

    /// <summary>Segoe Fluent "Recent" clock glyph — the native stand-in for the web Lucide <c>Clock</c> icon.</summary>
    public const string RateLimitedGlyph = "\uE823";

    /// <summary>Segoe Fluent "ErrorBadge" glyph — the native stand-in for the web Lucide <c>AlertCircle</c> icon.</summary>
    public const string UpstreamDownGlyph = "\uEA39";

    /// <summary>Segoe Fluent "ChromeClose" glyph — the native stand-in for the web Lucide <c>X</c> dismiss icon.</summary>
    public const string DismissGlyph = "\uE711";

    /// <summary>Token key for the amber accent brush — the web <c>amber-300</c> icon/border tint.</summary>
    public const string AccentBrushKey = "TsColorWarningBrush";

    /// <summary>Token key for the amber accent colour, used to derive the tinted strip / chip fills.</summary>
    public const string AccentColorKey = "TsColorWarningColor";

    /// <summary>Fallback amber accent (Tailwind <c>amber-500</c>) when the token dictionary is absent.</summary>
    public const string AccentFallback = "#F59E0B";

    /// <summary>i18n key for the rate-limit copy (web <c>t('ratelimit.banner', …)</c>).</summary>
    public const string RateLimitedKey = "translation.ratelimit.banner";

    /// <summary>English fallback for <see cref="RateLimitedKey"/> — the web literal (with the native <c>{0}</c> count slot).</summary>
    public const string RateLimitedFallback = "Too many requests — pausing for {0}s";

    /// <summary>i18n key for the upstream-down copy (web <c>t('upstream.banner', …)</c>).</summary>
    public const string UpstreamDownKey = "translation.upstream.banner";

    /// <summary>English fallback for <see cref="UpstreamDownKey"/> — the web literal (with the native <c>{0}</c> count slot).</summary>
    public const string UpstreamDownFallback = "Tesla upstream unavailable — retry in {0}s";

    /// <summary>i18n key for the "Retry now" action (web <c>t('ratelimit.retry', …)</c>).</summary>
    public const string RetryKey = "translation.ratelimit.retry";

    /// <summary>English fallback for <see cref="RetryKey"/> — the web literal, verbatim.</summary>
    public const string RetryFallback = "Retry now";

    /// <summary>i18n key for the dismiss-control accessible name (web <c>t('common.dismiss', …)</c>).</summary>
    public const string DismissKey = "translation.common.dismiss";

    /// <summary>English fallback for <see cref="DismissKey"/> — the web literal, verbatim.</summary>
    public const string DismissFallback = "Dismiss";

    /// <summary>The leading glyph for a banner of the given <paramref name="kind"/> (Clock vs AlertCircle).</summary>
    public static string GlyphFor(RateLimitKind kind) =>
        kind == RateLimitKind.RateLimited ? RateLimitedGlyph : UpstreamDownGlyph;

    /// <summary>The i18n message key for the given <paramref name="kind"/>.</summary>
    public static string MessageKey(RateLimitKind kind) =>
        kind == RateLimitKind.RateLimited ? RateLimitedKey : UpstreamDownKey;

    /// <summary>The English message fallback for the given <paramref name="kind"/>.</summary>
    public static string MessageFallback(RateLimitKind kind) =>
        kind == RateLimitKind.RateLimited ? RateLimitedFallback : UpstreamDownFallback;

    /// <summary>
    /// The whole seconds left until the cooldown expires — the native port of the web
    /// <c>Math.max(0, Math.ceil((expiresAt - now) / 1000))</c> (web/src/components/feedback/RateLimitBanner.tsx
    /// L104): the remaining window rounded up to the next whole second and clamped at zero once the window has
    /// elapsed.
    /// </summary>
    /// <param name="expiresAt">When the cooldown window ends.</param>
    /// <param name="now">The current instant.</param>
    public static int RemainingSeconds(DateTimeOffset expiresAt, DateTimeOffset now)
    {
        var milliseconds = (expiresAt - now).TotalMilliseconds;
        return milliseconds <= 0 ? 0 : (int)Math.Ceiling(milliseconds / 1000.0);
    }

    /// <summary>
    /// The localized, count-substituted banner copy — the native port of the web
    /// <c>t(key, fallback, { n: remaining })</c> call (web/src/components/feedback/RateLimitBanner.tsx L130-132):
    /// resolve the per-kind template through the i18n facade then substitute the remaining seconds. A malformed
    /// template (no/extra format slot) degrades to the raw resolved template rather than throwing.
    /// </summary>
    /// <param name="localizer">The i18n facade the template resolves through.</param>
    /// <param name="kind">Which banner copy to render.</param>
    /// <param name="remaining">The remaining seconds substituted into the <c>{0}</c> count slot.</param>
    public static string FormatMessage(ILocalizer localizer, RateLimitKind kind, int remaining)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        var template = localizer.GetString(MessageKey(kind), MessageFallback(kind));
        try
        {
            return string.Format(CultureInfo.CurrentCulture, template, remaining);
        }
        catch (FormatException)
        {
            // A translation with an unbalanced/extra brace must never crash the banner — render it as-is.
            return template;
        }
    }
}

/// <summary>
/// The live cooldown the banner is counting down — the native analogue of the web component's <c>State</c>
/// (web/src/components/feedback/RateLimitBanner.tsx L43-48): the triggering <see cref="Kind"/>, the optional
/// API <see cref="Scope"/> (rate-limit) or <see cref="Upstream"/> name (breaker), and the absolute
/// <see cref="ExpiresAt"/> instant the cooldown ends. Created from a retry-after window at the instant the signal
/// arrives, exactly like the web <c>expiresAt: Date.now() + Math.max(0, retryAfterSec) * 1000</c>. Pure value type.
/// </summary>
public readonly record struct RateLimitSignal
{
    private RateLimitSignal(RateLimitKind kind, string? scope, string? upstream, DateTimeOffset expiresAt)
    {
        Kind = kind;
        Scope = scope;
        Upstream = upstream;
        ExpiresAt = expiresAt;
    }

    /// <summary>Which resilience condition raised the banner.</summary>
    public RateLimitKind Kind { get; }

    /// <summary>The rate-limited API path scope (web <c>detail.scope</c>), or null for an upstream trip.</summary>
    public string? Scope { get; }

    /// <summary>The tripped upstream name (web <c>detail.upstream</c>), or null for a rate-limit.</summary>
    public string? Upstream { get; }

    /// <summary>The absolute instant the cooldown window ends (web <c>expiresAt</c>).</summary>
    public DateTimeOffset ExpiresAt { get; }

    /// <summary>
    /// Build a rate-limit cooldown from a retry-after window — the web <c>onLimited</c> handler
    /// (web/src/components/feedback/RateLimitBanner.tsx L58-68): <c>expiresAt = now + max(0, retryAfterSec) * 1000</c>.
    /// </summary>
    public static RateLimitSignal RateLimited(string? scope, double retryAfterSeconds, DateTimeOffset now) =>
        new(RateLimitKind.RateLimited, scope, null, ExpiresFrom(retryAfterSeconds, now));

    /// <summary>
    /// Build an upstream-down cooldown from a retry-after window — the web <c>onUpstream</c> handler
    /// (web/src/components/feedback/RateLimitBanner.tsx L69-79): same window maths, different copy.
    /// </summary>
    public static RateLimitSignal UpstreamDown(string? upstream, double retryAfterSeconds, DateTimeOffset now) =>
        new(RateLimitKind.UpstreamDown, null, upstream, ExpiresFrom(retryAfterSeconds, now));

    /// <summary>The whole seconds left until this cooldown expires at <paramref name="now"/>.</summary>
    public int RemainingSeconds(DateTimeOffset now) =>
        RateLimitBannerRegistration.RemainingSeconds(ExpiresAt, now);

    // web: Date.now() + Math.max(0, retryAfterSec) * 1000 — a non-finite or negative window clamps to "now".
    private static DateTimeOffset ExpiresFrom(double retryAfterSeconds, DateTimeOffset now)
    {
        var clamped = double.IsFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? retryAfterSeconds : 0;
        return now.AddMilliseconds(clamped * 1000.0);
    }
}

/// <summary>
/// The fully projected, render-ready view of the banner — everything the web <c>RateLimitBanner</c> derives
/// before returning JSX (web/src/components/feedback/RateLimitBanner.tsx L102-156): whether the strip is shown
/// (<see cref="IsVisible"/> — the web <c>if (!state) return null</c> gate), the triggering <see cref="Kind"/> and
/// its <see cref="Glyph"/> (Clock vs AlertCircle), the <see cref="RemainingSeconds"/> countdown, the localized
/// count-substituted <see cref="Message"/>, whether the retry control is enabled (<see cref="RetryEnabled"/> —
/// the web <c>disabled={remaining > 0}</c> inverse), the two action labels and the amber accent token. Pure value
/// type so every field is asserted headlessly.
/// </summary>
public readonly record struct RateLimitBannerProjection
{
    private RateLimitBannerProjection(
        bool isVisible,
        RateLimitKind kind,
        int remainingSeconds,
        string message,
        bool retryEnabled,
        string retryLabel,
        string dismissLabel,
        string glyph,
        string accentBrushKey,
        string accessibleName)
    {
        IsVisible = isVisible;
        Kind = kind;
        RemainingSeconds = remainingSeconds;
        Message = message;
        RetryEnabled = retryEnabled;
        RetryLabel = retryLabel;
        DismissLabel = dismissLabel;
        Glyph = glyph;
        AccentBrushKey = accentBrushKey;
        AccessibleName = accessibleName;
    }

    /// <summary>Whether the banner strip is shown — the web <c>state !== null</c> gate.</summary>
    public bool IsVisible { get; }

    /// <summary>Which resilience condition is being counted down.</summary>
    public RateLimitKind Kind { get; }

    /// <summary>The whole seconds left until the cooldown expires (web <c>remaining</c>).</summary>
    public int RemainingSeconds { get; }

    /// <summary>The localized, count-substituted banner copy; also the surface's accessible name.</summary>
    public string Message { get; }

    /// <summary>Whether the "Retry now" control is enabled (web <c>!(remaining &gt; 0)</c>).</summary>
    public bool RetryEnabled { get; }

    /// <summary>The localized "Retry now" label (web <c>ratelimit.retry</c>).</summary>
    public string RetryLabel { get; }

    /// <summary>The localized dismiss-control accessible name (web <c>common.dismiss</c>).</summary>
    public string DismissLabel { get; }

    /// <summary>The leading Segoe Fluent glyph for the current <see cref="Kind"/>.</summary>
    public string Glyph { get; }

    /// <summary>The amber accent token key for the icon / border tint.</summary>
    public string AccentBrushKey { get; }

    /// <summary>The accessible name a screen reader announces for the surface — the banner message.</summary>
    public string AccessibleName { get; }

    /// <summary>
    /// Project the current cooldown into a render-ready banner value, reproducing the web component
    /// (web/src/components/feedback/RateLimitBanner.tsx L102-156): a null <paramref name="signal"/> is the hidden
    /// state; otherwise the strip is visible with the per-kind glyph and copy, the remaining-seconds countdown,
    /// and the retry control enabled only once the window has elapsed. Every label resolves through the i18n facade.
    /// </summary>
    /// <param name="signal">The active cooldown, or null when no signal is in flight (hidden).</param>
    /// <param name="now">The current instant the countdown is computed against.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static RateLimitBannerProjection Project(RateLimitSignal? signal, DateTimeOffset now, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        var retryLabel = localizer.GetString(RateLimitBannerRegistration.RetryKey, RateLimitBannerRegistration.RetryFallback);
        var dismissLabel = localizer.GetString(RateLimitBannerRegistration.DismissKey, RateLimitBannerRegistration.DismissFallback);

        if (signal is not { } active)
        {
            return new RateLimitBannerProjection(
                isVisible: false,
                kind: RateLimitKind.RateLimited,
                remainingSeconds: 0,
                message: string.Empty,
                retryEnabled: false,
                retryLabel: retryLabel,
                dismissLabel: dismissLabel,
                glyph: RateLimitBannerRegistration.GlyphFor(RateLimitKind.RateLimited),
                accentBrushKey: RateLimitBannerRegistration.AccentBrushKey,
                accessibleName: string.Empty);
        }

        var remaining = active.RemainingSeconds(now);
        var message = RateLimitBannerRegistration.FormatMessage(localizer, active.Kind, remaining);

        return new RateLimitBannerProjection(
            isVisible: true,
            kind: active.Kind,
            remainingSeconds: remaining,
            message: message,
            retryEnabled: remaining <= 0,
            retryLabel: retryLabel,
            dismissLabel: dismissLabel,
            glyph: RateLimitBannerRegistration.GlyphFor(active.Kind),
            accentBrushKey: RateLimitBannerRegistration.AccentBrushKey,
            accessibleName: message);
    }
}

/// <summary>
/// PII-safe diagnostics for the RateLimitBanner surface (P1/S11 diagnostics contract). The banner carries no user
/// content — only an opaque API scope / upstream name and a countdown — so the collector records ONLY the
/// operational <c>view.opened</c> event with the surface slug, never the scope, upstream name or retry window,
/// mirroring the web component which emits no telemetry. Thread-safe; mirrors the peer surfaces' collectors.
/// </summary>
public sealed class RateLimitBannerDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public RateLimitBannerDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=RateLimitBanner</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={RateLimitBannerRegistration.Slug}");
    }
}
