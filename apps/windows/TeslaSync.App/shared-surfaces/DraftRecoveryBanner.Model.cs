using System.Globalization;
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// One immutable draft-recovery snapshot — the inputs the web <c>DraftRecoveryBanner</c> reads from its props
/// (web/src/components/feedback/DraftRecoveryBanner.tsx L8-23: <c>hasDraft</c>, <c>draftSavedAt</c>,
/// <c>itemNoun</c>). The banner is a present-only notice that the editor was hydrated from a stored draft, so
/// the snapshot carries only whether a draft was restored, when it was last persisted (null when unknown — the
/// web "a moment ago" path) and the optional noun the copy interpolates ("rule", "automation", "settings", …).
/// Pure value — no WinUI types — so the projection is asserted headlessly. Exposed by the P1/S8
/// <see cref="IDraftRecoverySource"/> and consumed by <see cref="DraftRecoveryBannerProjection.Project"/>.
/// </summary>
/// <param name="HasDraft">Whether the editor was hydrated from a stored draft (web <c>hasDraft</c>).</param>
/// <param name="SavedAt">When the draft was last persisted, or null when unknown (web <c>draftSavedAt</c>).</param>
/// <param name="ItemNoun">Optional noun the copy interpolates, or null for the generic copy (web <c>itemNoun</c>).</param>
public sealed record DraftRecoverySnapshot(bool HasDraft, DateTimeOffset? SavedAt, string? ItemNoun = null)
{
    /// <summary>The neutral snapshot — no draft was restored, so the banner stays collapsed (web <c>hasDraft = false</c>).</summary>
    public static DraftRecoverySnapshot None { get; } = new(false, null, null);
}

/// <summary>
/// Canonical metadata + i18n keys/fallbacks for the <c>DraftRecoveryBanner</c> shared surface — the native
/// mirror of the literals in web/src/components/feedback/DraftRecoveryBanner.tsx. It carries the diagnostics
/// slug the surface registers under, the automation ids the WinUI view stamps (synthesised native handles — the
/// web component declares no <c>data-testid</c>s — so the UI-automation tests can address the root and the two
/// actions), the ARIA role/live contract the wrapping notice declares, the semantic <see cref="CalloutVariant"/>
/// (the web <c>&lt;AlertBanner variant="info"&gt;</c>), and the five i18n keys with the verbatim English
/// fallbacks the web <c>t()</c> calls render. Keys mirror the web keys directly (matching the
/// <c>DraftRestorePrompt</c> feedback sibling), resolved against the English fallback headlessly through the
/// P1/S10 i18n facade. UI-free so it is asserted without a XAML host.
/// </summary>
public static class DraftRecoveryBannerRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "DraftRecoveryBanner";

    /// <summary>Automation id of the banner root (synthesised native handle — the web component declares no testid).</summary>
    public const string BannerAutomationId = "draft-recovery-banner";

    /// <summary>Automation id of the "Use draft" action (synthesised native handle).</summary>
    public const string UseDraftAutomationId = "draft-recovery-use";

    /// <summary>Automation id of the "Discard draft" action (synthesised native handle).</summary>
    public const string DiscardAutomationId = "draft-recovery-discard";

    /// <summary>ARIA role the wrapping notice exposes — a read-only status region (web <c>AlertBanner</c> notice).</summary>
    public const string StatusRole = "status";

    /// <summary>ARIA live urgency the banner declares — a polite, non-interrupting announcement (info variant).</summary>
    public const string LiveSetting = "polite";

    /// <summary>The semantic emphasis the banner renders with — the web <c>&lt;AlertBanner variant="info"&gt;</c>.</summary>
    public const CalloutVariant Variant = CalloutVariant.Info;

    /// <summary>i18n key for the unknown-time copy (web <c>t('draft.unknownTime', …)</c>).</summary>
    public const string UnknownTimeKey = "draft.unknownTime";

    /// <summary>English fallback for <see cref="UnknownTimeKey"/> — the web literal, verbatim.</summary>
    public const string UnknownTimeFallback = "a moment ago";

    /// <summary>i18n key for the generic restored copy (web <c>t('draft.restored', …, { when })</c>).</summary>
    public const string RestoredKey = "draft.restored";

    /// <summary>English fallback for <see cref="RestoredKey"/> — the web literal with the i18next <c>{{when}}</c> token.</summary>
    public const string RestoredFallback = "Draft restored from {{when}}.";

    /// <summary>i18n key for the noun-qualified restored copy (web <c>t('draft.restoredItem', …, { noun, when })</c>).</summary>
    public const string RestoredItemKey = "draft.restoredItem";

    /// <summary>English fallback for <see cref="RestoredItemKey"/> — the web literal with the i18next <c>{{noun}}</c> / <c>{{when}}</c> tokens.</summary>
    public const string RestoredItemFallback = "{{noun}} draft restored from {{when}}.";

    /// <summary>i18n key for the "Use draft" action label (web <c>t('draft.useDraft', …)</c>).</summary>
    public const string UseDraftKey = "draft.useDraft";

    /// <summary>English fallback for <see cref="UseDraftKey"/> — the web literal, verbatim.</summary>
    public const string UseDraftFallback = "Use draft";

    /// <summary>i18n key for the "Discard draft" action label (web <c>t('draft.discardDraft', …)</c>).</summary>
    public const string DiscardKey = "draft.discardDraft";

    /// <summary>English fallback for <see cref="DiscardKey"/> — the web literal, verbatim.</summary>
    public const string DiscardFallback = "Discard draft";

    /// <summary>The Segoe Fluent "Info" glyph the banner leads with (the native stand-in for the web Lucide <c>Info</c>).</summary>
    public static string Glyph => CalloutVariants.Glyph(Variant);

    /// <summary>The generated design-token accent brush key the info chrome tints from.</summary>
    public static string AccentBrushKey => CalloutVariants.AccentBrushKey(Variant);

    /// <summary>
    /// Resolve and interpolate the generic restored copy for <paramref name="when"/> — the native port of the
    /// web <c>t('draft.restored', '{{when}}', { when })</c>. Substitutes the web i18next token (<c>{{when}}</c>)
    /// and the native positional token (<c>{0}</c>) with a literal replace (never
    /// <see cref="string.Format(IFormatProvider, string, object?)"/>, so a localized value carrying a stray brace
    /// can never throw a <see cref="System.FormatException"/>).
    /// </summary>
    /// <param name="template">The resolved <see cref="RestoredKey"/> template (the localized or fallback copy).</param>
    /// <param name="when">The already-localized relative-time phrase to interpolate.</param>
    public static string FormatRestored(string template, string when)
    {
        ArgumentNullException.ThrowIfNull(template);
        ArgumentNullException.ThrowIfNull(when);
        return Interpolate(template, ("when", when), ("0", when));
    }

    /// <summary>
    /// Resolve and interpolate the noun-qualified restored copy — the native port of the web
    /// <c>t('draft.restoredItem', '{{noun}} … {{when}}', { noun, when })</c>. Substitutes both i18next tokens
    /// (<c>{{noun}}</c>, <c>{{when}}</c>) and their native positional equivalents (<c>{0}</c>=noun, <c>{1}</c>=when)
    /// with a literal replace.
    /// </summary>
    /// <param name="template">The resolved <see cref="RestoredItemKey"/> template (the localized or fallback copy).</param>
    /// <param name="noun">The already-localized noun to interpolate (web <c>itemNoun</c>).</param>
    /// <param name="when">The already-localized relative-time phrase to interpolate.</param>
    public static string FormatRestoredItem(string template, string noun, string when)
    {
        ArgumentNullException.ThrowIfNull(template);
        ArgumentNullException.ThrowIfNull(noun);
        ArgumentNullException.ThrowIfNull(when);
        return Interpolate(template, ("noun", noun), ("0", noun), ("when", when), ("1", when));
    }

    private static string Interpolate(string template, params (string Token, string Value)[] substitutions)
    {
        string result = template;
        foreach ((string token, string value) in substitutions)
        {
            result = result
                .Replace("{{" + token + "}}", value, StringComparison.Ordinal)
                .Replace("{" + token + "}", value, StringComparison.Ordinal);
        }

        return result;
    }
}

/// <summary>
/// Pure relative-time formatting for the surface — the native port of the web <c>formatRelativeTime</c>
/// (web/src/lib/dateFormat.ts L258-L268) the web component composes for the banner's "restored from {when}"
/// copy (web/src/components/feedback/DraftRecoveryBanner.tsx L52-54). The tier buckets ("Just now",
/// <c>{m}m ago</c>, <c>{h}h ago</c>, then the absolute "MMM d, hh:mm tt" date) mirror the web helper
/// one-for-one. Because .NET / ICU does not reproduce <c>Intl</c>'s per-locale skeletons byte-for-byte, the
/// &gt; 24 h date fallback renders the same fixed field pattern the web emits for en-US, localised through the
/// resolved <see cref="CultureInfo"/> (month names, AM/PM) — the same parity ceiling the shipped
/// <c>DraftRestorePrompt</c> sibling documents. The "now" is injectable so the formatter unit-tests
/// deterministically.
/// </summary>
public static class DraftRecoveryFormatting
{
    /// <summary>Relative tier shown for sub-minute / future deltas (web <c>formatRelativeTime</c> <c>'Just now'</c>).</summary>
    public const string JustNow = "Just now";

    // Field pattern mirrors web lib/dateFormat.formatRelativeTime's > 24h branch for en-US:
    //   toLocaleDateString({ month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) → "Apr 4, 02:30 AM"
    private const string AbsolutePattern = "MMM d, hh:mm tt";

    /// <summary>
    /// Render the elapsed time between <paramref name="savedAt"/> and <paramref name="now"/> — the native port of
    /// the web <c>formatRelativeTime</c>: under a minute (or a future instant, mirroring the web's unguarded
    /// <c>diffMin &lt; 1</c>) → "Just now"; under an hour → <c>{m}m ago</c>; under a day → <c>{h}h ago</c>;
    /// otherwise the absolute "MMM d, hh:mm tt" date rendered through <paramref name="culture"/>.
    /// </summary>
    public static string FormatRelativeTime(DateTimeOffset savedAt, DateTimeOffset now, CultureInfo culture)
    {
        ArgumentNullException.ThrowIfNull(culture);

        long minutes = (long)Math.Floor((now - savedAt).TotalMinutes);
        if (minutes < 1)
        {
            return JustNow;
        }

        if (minutes < 60)
        {
            return string.Create(CultureInfo.InvariantCulture, $"{minutes}m ago");
        }

        long hours = minutes / 60;
        if (hours < 24)
        {
            return string.Create(CultureInfo.InvariantCulture, $"{hours}h ago");
        }

        return savedAt.ToString(AbsolutePattern, culture);
    }
}

/// <summary>
/// The fully projected, render-ready view of a <see cref="DraftRecoverySnapshot"/> + the banner's internal
/// dismissed flag — everything the web <c>DraftRecoveryBanner</c> derives before returning JSX
/// (web/src/components/feedback/DraftRecoveryBanner.tsx L47-98): whether the banner is shown
/// (<see cref="IsVisible"/> — the web <c>if (!hasDraft || dismissed) return null</c> gate, inverted), the
/// localized relative-time <see cref="WhenText"/> (the <c>draftSavedAt ? formatRelativeTime(...) :
/// t('draft.unknownTime')</c> branch), the composed <see cref="Message"/> (the noun-qualified or generic
/// variant), the localized <see cref="UseDraftLabel"/> / <see cref="DiscardLabel"/>, the
/// <see cref="AccessibleName"/> the status region announces and the ARIA <see cref="LiveSetting"/>. Pure value
/// type so every field is asserted headlessly.
/// </summary>
public readonly record struct DraftRecoveryBannerProjection
{
    private DraftRecoveryBannerProjection(
        bool isVisible,
        string whenText,
        string message,
        string useDraftLabel,
        string discardLabel,
        string accessibleName,
        string liveSetting)
    {
        IsVisible = isVisible;
        WhenText = whenText;
        Message = message;
        UseDraftLabel = useDraftLabel;
        DiscardLabel = discardLabel;
        AccessibleName = accessibleName;
        LiveSetting = liveSetting;
    }

    /// <summary>Whether the banner is shown — the web <c>if (!hasDraft || dismissed) return null</c> gate, inverted.</summary>
    public bool IsVisible { get; }

    /// <summary>The localized relative-time phrase interpolated into the copy (web <c>when</c>).</summary>
    public string WhenText { get; }

    /// <summary>The composed, localized banner message — the noun-qualified or generic variant (web <c>message</c>).</summary>
    public string Message { get; }

    /// <summary>The localized "Use draft" action label (web <c>t('draft.useDraft')</c>).</summary>
    public string UseDraftLabel { get; }

    /// <summary>The localized "Discard draft" action label (web <c>t('draft.discardDraft')</c>).</summary>
    public string DiscardLabel { get; }

    /// <summary>The accessible name the status region announces — the banner message, read as one status.</summary>
    public string AccessibleName { get; }

    /// <summary>The ARIA live urgency the banner declares (polite).</summary>
    public string LiveSetting { get; }

    /// <summary>
    /// Project a draft-recovery snapshot + the banner's dismissed flag into a render-ready value, reproducing the
    /// web component (web/src/components/feedback/DraftRecoveryBanner.tsx L47-98): the banner is visible only
    /// while a draft was restored and the user has not dismissed it; <see cref="WhenText"/> is the relative-time
    /// phrase when a save instant is known and the localized "a moment ago" otherwise; the message is the
    /// noun-qualified variant when <see cref="DraftRecoverySnapshot.ItemNoun"/> is supplied and the generic copy
    /// otherwise; every string is resolved through the localizer.
    /// </summary>
    /// <param name="snapshot">The draft-recovery inputs (web props).</param>
    /// <param name="dismissed">Whether the user has dismissed the banner via either action (web <c>dismissed</c> state).</param>
    /// <param name="now">The instant the relative-time phrase is measured against (the render clock).</param>
    /// <param name="culture">The culture the absolute-date fallback renders through.</param>
    /// <param name="localizer">The i18n facade every string resolves through.</param>
    public static DraftRecoveryBannerProjection Project(
        DraftRecoverySnapshot snapshot,
        bool dismissed,
        DateTimeOffset now,
        CultureInfo culture,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentNullException.ThrowIfNull(culture);
        ArgumentNullException.ThrowIfNull(localizer);

        string when = snapshot.SavedAt is DateTimeOffset savedAt
            ? DraftRecoveryFormatting.FormatRelativeTime(savedAt, now, culture)
            : localizer.GetString(DraftRecoveryBannerRegistration.UnknownTimeKey, DraftRecoveryBannerRegistration.UnknownTimeFallback);

        string message;
        if (string.IsNullOrEmpty(snapshot.ItemNoun))
        {
            message = DraftRecoveryBannerRegistration.FormatRestored(
                localizer.GetString(DraftRecoveryBannerRegistration.RestoredKey, DraftRecoveryBannerRegistration.RestoredFallback),
                when);
        }
        else
        {
            message = DraftRecoveryBannerRegistration.FormatRestoredItem(
                localizer.GetString(DraftRecoveryBannerRegistration.RestoredItemKey, DraftRecoveryBannerRegistration.RestoredItemFallback),
                snapshot.ItemNoun,
                when);
        }

        string useDraft = localizer.GetString(DraftRecoveryBannerRegistration.UseDraftKey, DraftRecoveryBannerRegistration.UseDraftFallback);
        string discard = localizer.GetString(DraftRecoveryBannerRegistration.DiscardKey, DraftRecoveryBannerRegistration.DiscardFallback);

        return new DraftRecoveryBannerProjection(
            isVisible: snapshot.HasDraft && !dismissed,
            whenText: when,
            message: message,
            useDraftLabel: useDraft,
            discardLabel: discard,
            accessibleName: message,
            liveSetting: DraftRecoveryBannerRegistration.LiveSetting);
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>DraftRecoveryBanner</c> surface (P1/S11 diagnostics contract). The banner's
/// inputs include a free-text <c>itemNoun</c> and a save instant that could narrow what (and when) the user was
/// editing, so the collector records ONLY operational counters with the surface slug — never the noun, the
/// timestamp, or any copy. Thread-safe; mirrors the peer surfaces' diagnostics collectors.
/// </summary>
public sealed class DraftRecoveryBannerDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;
    private long _useDrafts;
    private long _discards;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the operational lines are written to, or null.</param>
    public DraftRecoveryBannerDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened (the <c>view.opened</c> count).</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Number of times the user accepted the restored draft from this surface.</summary>
    public long UseDrafts => Interlocked.Read(ref _useDrafts);

    /// <summary>Number of times the user discarded the restored draft from this surface.</summary>
    public long Discards => Interlocked.Read(ref _discards);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=DraftRecoveryBanner</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={DraftRecoveryBannerRegistration.Slug}");
    }

    /// <summary>Record a "Use draft" acceptance, emitting <c>draft-recovery.use slug=DraftRecoveryBanner</c> (no copy).</summary>
    public void RecordUseDraft()
    {
        Interlocked.Increment(ref _useDrafts);
        _sink?.Invoke($"draft-recovery.use slug={DraftRecoveryBannerRegistration.Slug}");
    }

    /// <summary>Record a "Discard draft" action, emitting <c>draft-recovery.discard slug=DraftRecoveryBanner</c> (no copy).</summary>
    public void RecordDiscard()
    {
        Interlocked.Increment(ref _discards);
        _sink?.Invoke($"draft-recovery.discard slug={DraftRecoveryBannerRegistration.Slug}");
    }
}
