using System.Collections.Generic;
using System.Globalization;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The branch the <see cref="DraftRestorePromptViewModel"/> actually renders — the native port of the web
/// <c>DraftRestorePrompt</c> render gate (web/src/components/feedback/DraftRestorePrompt.tsx L185-L317:
/// <c>if (!showPrompt &amp;&amp; !reviewOpen) return null</c>, then the bottom-left card, then the review
/// <c>Modal</c>).
/// <para>
/// The web source reads recoverable work from the client-side draft index (<c>getDrafts()</c> over
/// <c>localStorage</c>) <b>synchronously</b> and re-renders on <c>subscribeDraftIndex</c> — it performs no
/// network read. So, exactly like the shipped <c>RecentlyViewedWidget</c> / <c>TimeStamp</c> sibling surfaces
/// document, it has <b>no</b> loading / error / stale / offline chrome: there is nothing to fetch, fail, go
/// stale, or fall offline. The visible branches it actually has are reproduced in full below; the generic
/// "empty" state maps to <see cref="Review"/> with no rows (the web "No drafts to restore." paragraph).
/// </para>
/// </summary>
public enum DraftRestoreState
{
    /// <summary>Nothing surfaced — the surface renders nothing (web <c>!showPrompt &amp;&amp; !reviewOpen</c> → <c>null</c>).</summary>
    Idle,

    /// <summary>The compact bottom-left recovery card is shown (web <c>showPrompt &amp;&amp; !reviewOpen</c>).</summary>
    Prompt,

    /// <summary>The review modal is open, listing every draft (or the empty message) (web <c>reviewOpen</c>).</summary>
    Review,
}

/// <summary>
/// One recoverable draft surfaced by the draft-index seam — the native port of the web <c>DraftEntry</c>
/// (web/src/lib/draftIndex.ts L58-L77). Pure data (no WinUI types) so the projection is unit-tested without a
/// UI host. Indexed by <see cref="StorageKey"/> (the full underlying envelope key) so the same logical key at
/// two schema versions is two separate drafts, exactly as the web index keys by <c>storageKey</c>.
/// </summary>
/// <param name="StorageKey">Full localStorage key of the underlying envelope (web <c>storageKey</c>) — the discard / dedup key.</param>
/// <param name="Key">User-supplied logical key without the version prefix (web <c>key</c>).</param>
/// <param name="Version">Schema version embedded in the storage key (web <c>version</c>).</param>
/// <param name="Label">Human-readable label shown in the prompt; may be blank (web <c>label</c>).</param>
/// <param name="Route">In-app route navigated to on Resume (web <c>route</c>).</param>
/// <param name="SavedAt">Last persistence time the "Saved {when}" label is derived from (web <c>savedAt</c>).</param>
/// <param name="Fallback">True when synthesised from a fallback rule rather than an explicit registration (web <c>fallback</c>).</param>
public sealed record DraftEntry(
    string StorageKey,
    string Key,
    int Version,
    string Label,
    string Route,
    DateTimeOffset SavedAt,
    bool Fallback = false);

/// <summary>
/// One projected, render-ready draft row consumed by the WinUI view — the native analogue of a rendered web
/// <c>&lt;li&gt;</c> recovery row (web/src/components/feedback/DraftRestorePrompt.tsx L267-L301). The
/// <see cref="Label"/> already has the "Unsaved draft" fallback applied (web <c>entry.label || t(...)</c>),
/// <see cref="SavedAtText"/> is the already-localized "Saved {when}" caption (web <c>t('draft.recovery.savedAt',
/// { when })</c>), <see cref="Route"/> is the Resume destination, and <see cref="AutomationName"/> is the
/// Narrator name joining the label and the saved-at caption. Pure data so the projection is unit-tested headlessly.
/// </summary>
/// <param name="StorageKey">The draft's stable key (web row key / <c>data-testid</c> suffix), used for Resume / Discard.</param>
/// <param name="Label">Display label with the fallback already applied (web <c>entry.label || fallbackLabel</c>).</param>
/// <param name="SavedAtText">Localized "Saved {when}" caption (web <c>t('draft.recovery.savedAt', { when })</c>).</param>
/// <param name="Route">The in-app route Resume navigates to (web <c>entry.route</c>).</param>
/// <param name="AutomationName">Narrator name for the row (label + saved-at caption).</param>
public sealed record DraftRestoreRow(
    string StorageKey,
    string Label,
    string SavedAtText,
    string Route,
    string AutomationName);

/// <summary>
/// Canonical metadata + i18n keys/fallbacks for the draft-restore prompt surface — the native mirror of the web
/// <c>DraftRestorePrompt</c> (web/src/components/feedback/DraftRestorePrompt.tsx). It carries the diagnostics
/// slug the surface registers under and every render-contract i18n key/fallback the web source passes to
/// <c>t()</c>, reproducing the web copy verbatim. Keys mirror the web keys directly (matching the
/// <c>SessionExpiredModal</c> feedback sibling), resolved against the English fallback headlessly through the
/// P1/S10 i18n facade. UI-free so it is asserted without a XAML host.
/// </summary>
public static class DraftRestorePromptRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "DraftRestorePrompt";

    /// <summary>i18n key for the prompt card title (web <c>draft.recovery.promptTitle</c>).</summary>
    public const string PromptTitleKey = "draft.recovery.promptTitle";

    /// <summary>English fallback for <see cref="PromptTitleKey"/> (web second arg, verbatim).</summary>
    public const string PromptTitleFallback = "Unsaved drafts restored";

    /// <summary>i18n key for the prompt card body (web <c>draft.recovery.promptBody</c>).</summary>
    public const string PromptBodyKey = "draft.recovery.promptBody";

    /// <summary>
    /// English singular fallback for <see cref="PromptBodyKey"/> (web <c>defaultValue_one</c>, verbatim — the
    /// <c>{{count}}</c> token is interpolated by <see cref="FormatPromptBody"/>).
    /// </summary>
    public const string PromptBodyOneFallback = "You have {{count}} unsaved draft from a previous session.";

    /// <summary>
    /// English plural fallback for <see cref="PromptBodyKey"/> (web <c>defaultValue_other</c> / <c>defaultValue</c>,
    /// verbatim — the <c>{{count}}</c> token is interpolated by <see cref="FormatPromptBody"/>).
    /// </summary>
    public const string PromptBodyOtherFallback = "You have {{count}} unsaved drafts from a previous session.";

    /// <summary>i18n key for the "Review" affordance (web <c>draft.recovery.review</c>).</summary>
    public const string ReviewKey = "draft.recovery.review";

    /// <summary>English fallback for <see cref="ReviewKey"/> (web second arg, verbatim).</summary>
    public const string ReviewFallback = "Review";

    /// <summary>i18n key for the "Dismiss" affordance (web <c>draft.recovery.dismiss</c>).</summary>
    public const string DismissKey = "draft.recovery.dismiss";

    /// <summary>English fallback for <see cref="DismissKey"/> (web second arg, verbatim).</summary>
    public const string DismissFallback = "Dismiss";

    /// <summary>i18n key for the close-button accessible name (web <c>draft.recovery.close</c>).</summary>
    public const string CloseKey = "draft.recovery.close";

    /// <summary>English fallback for <see cref="CloseKey"/> (web second arg, verbatim).</summary>
    public const string CloseFallback = "Close";

    /// <summary>i18n key for the review modal title (web <c>draft.recovery.modalTitle</c>).</summary>
    public const string ModalTitleKey = "draft.recovery.modalTitle";

    /// <summary>English fallback for <see cref="ModalTitleKey"/> (web second arg, verbatim).</summary>
    public const string ModalTitleFallback = "Restore unsaved drafts";

    /// <summary>i18n key for the review modal body (web <c>draft.recovery.modalBody</c>).</summary>
    public const string ModalBodyKey = "draft.recovery.modalBody";

    /// <summary>English fallback for <see cref="ModalBodyKey"/> (web second arg, verbatim).</summary>
    public const string ModalBodyFallback =
        "These drafts were saved in your browser before this session. Resume to continue editing or discard to clear them.";

    /// <summary>i18n key for the empty review state (web <c>draft.recovery.empty</c>).</summary>
    public const string EmptyKey = "draft.recovery.empty";

    /// <summary>English fallback for <see cref="EmptyKey"/> (web second arg, verbatim).</summary>
    public const string EmptyFallback = "No drafts to restore.";

    /// <summary>i18n key for the per-row label fallback (web <c>draft.recovery.fallbackLabel</c>).</summary>
    public const string FallbackLabelKey = "draft.recovery.fallbackLabel";

    /// <summary>English fallback for <see cref="FallbackLabelKey"/> (web second arg, verbatim).</summary>
    public const string FallbackLabelFallback = "Unsaved draft";

    /// <summary>i18n key for the per-row saved-at caption (web <c>draft.recovery.savedAt</c>).</summary>
    public const string SavedAtKey = "draft.recovery.savedAt";

    /// <summary>
    /// English fallback for <see cref="SavedAtKey"/> (web second arg, verbatim — the <c>{{when}}</c> token is
    /// interpolated by <see cref="FormatSavedAt"/>).
    /// </summary>
    public const string SavedAtFallback = "Saved {{when}}";

    /// <summary>i18n key for the per-row "Resume" action (web <c>draft.recovery.resume</c>).</summary>
    public const string ResumeKey = "draft.recovery.resume";

    /// <summary>English fallback for <see cref="ResumeKey"/> (web second arg, verbatim).</summary>
    public const string ResumeFallback = "Resume";

    /// <summary>i18n key for the per-row "Discard" action (web <c>draft.recovery.discard</c>).</summary>
    public const string DiscardKey = "draft.recovery.discard";

    /// <summary>English fallback for <see cref="DiscardKey"/> (web second arg, verbatim).</summary>
    public const string DiscardFallback = "Discard";

    /// <summary>
    /// Resolve and interpolate the prompt body for <paramref name="count"/> surfaced drafts — the native port of
    /// the web <c>t('draft.recovery.promptBody', { count, defaultValue_one, defaultValue_other })</c> plural
    /// selection. Picks the singular template when exactly one draft surfaced, else the plural template, resolves
    /// it through <paramref name="localizer"/>, and substitutes the web i18next token (<c>{{count}}</c>) and the
    /// native positional token (<c>{0}</c>) via a literal replace (never
    /// <see cref="string.Format(IFormatProvider, string, object?)"/>, so a localized value carrying a stray brace
    /// can never throw a <see cref="System.FormatException"/>).
    /// </summary>
    public static string FormatPromptBody(TeslaSync.App.Core.Notifications.ILocalizer localizer, int count)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        string fallback = count == 1 ? PromptBodyOneFallback : PromptBodyOtherFallback;
        string template = localizer.GetString(PromptBodyKey, fallback);
        return Interpolate(template, "count", count.ToString(CultureInfo.CurrentCulture));
    }

    /// <summary>
    /// Interpolate a relative-time string into the localized "Saved {when}" caption — the native port of the web
    /// <c>t('draft.recovery.savedAt', { when })</c>. Substitutes the web i18next token (<c>{{when}}</c>) and the
    /// native positional token (<c>{0}</c>) with a literal replace.
    /// </summary>
    public static string FormatSavedAt(string template, string when)
    {
        ArgumentNullException.ThrowIfNull(when);
        return Interpolate(template, "when", when);
    }

    private static string Interpolate(string template, string token, string value)
    {
        ArgumentNullException.ThrowIfNull(template);
        return template
            .Replace("{{" + token + "}}", value, StringComparison.Ordinal)
            .Replace("{0}", value, StringComparison.Ordinal);
    }
}

/// <summary>
/// Pure relative-time formatting for the surface — the native port of the web <c>formatRelativeTime</c>
/// (web/src/lib/dateFormat.ts L258-L268) the web component composes for each draft's "Saved {when}" caption.
/// The tier buckets ("Just now", <c>{m}m ago</c>, <c>{h}h ago</c>, then the absolute "MMM d, hh:mm tt" date)
/// mirror the web helper one-for-one. Because .NET / ICU does not reproduce <c>Intl</c>'s per-locale skeletons
/// byte-for-byte, the &gt; 24 h date fallback renders the same fixed field pattern the web emits for en-US,
/// localised through the resolved <see cref="CultureInfo"/> (month names, AM/PM) — the same parity ceiling the
/// shipped <c>TimeStamp</c> sibling documents. The tier suffixes are the web lib helper's own hard-coded copy
/// (not <c>t()</c> call sites), so they are reproduced verbatim rather than re-routed through i18n. The "now" is
/// injectable so the formatter unit-tests deterministically.
/// </summary>
public static class DraftRestoreFormatting
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
/// Pure projection from <see cref="DraftEntry"/> records to render-ready <see cref="DraftRestoreRow"/>s — the
/// native port of the web component's <c>drafts.map</c> (web/src/components/feedback/DraftRestorePrompt.tsx
/// L267-L301): the "Unsaved draft" label fallback, the localized "Saved {when}" caption (composing
/// <see cref="DraftRestoreFormatting.FormatRelativeTime"/>), and the Narrator name joining both. Every
/// user-visible string flows through the i18n facade. No SI conversion applies (no measurements).
/// </summary>
public static class DraftRestoreProjection
{
    /// <summary>
    /// Project <paramref name="drafts"/> (already newest-first) into render-ready rows, resolving the label
    /// fallback and the "Saved {when}" caption through <paramref name="localizer"/> against <paramref name="now"/>
    /// in <paramref name="culture"/>.
    /// </summary>
    public static IReadOnlyList<DraftRestoreRow> Project(
        IReadOnlyList<DraftEntry> drafts,
        DateTimeOffset now,
        CultureInfo culture,
        TeslaSync.App.Core.Notifications.ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(drafts);
        ArgumentNullException.ThrowIfNull(culture);
        ArgumentNullException.ThrowIfNull(localizer);

        if (drafts.Count == 0)
        {
            return Array.Empty<DraftRestoreRow>();
        }

        var rows = new List<DraftRestoreRow>(drafts.Count);
        string fallbackLabel = localizer.GetString(
            DraftRestorePromptRegistration.FallbackLabelKey,
            DraftRestorePromptRegistration.FallbackLabelFallback);
        string savedAtTemplate = localizer.GetString(
            DraftRestorePromptRegistration.SavedAtKey,
            DraftRestorePromptRegistration.SavedAtFallback);

        foreach (DraftEntry entry in drafts)
        {
            string label = string.IsNullOrWhiteSpace(entry.Label) ? fallbackLabel : entry.Label;
            string when = DraftRestoreFormatting.FormatRelativeTime(entry.SavedAt, now, culture);
            string savedAtText = DraftRestorePromptRegistration.FormatSavedAt(savedAtTemplate, when);
            string automationName = string.Create(CultureInfo.CurrentCulture, $"{label}, {savedAtText}");
            rows.Add(new DraftRestoreRow(entry.StorageKey, label, savedAtText, entry.Route, automationName));
        }

        return rows;
    }
}

/// <summary>
/// PII-safe diagnostics for the draft-restore prompt (P1/S11 diagnostics contract). A draft's label and route
/// can leak what the user was editing and where, so the collector records ONLY the operational
/// <see cref="RecordViewOpened"/> signal with the surface slug — never a label, a route, a storage key, or any
/// draft content. Thread-safe; mirrors the shipped surfaces' collectors.
/// </summary>
public sealed class DraftRestorePromptDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public DraftRestorePromptDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has surfaced its prompt (the <c>view.opened</c> count).</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the prompt surfaced, emitting <c>view.opened slug=DraftRestorePrompt</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(
            string.Create(
                CultureInfo.InvariantCulture,
                $"view.opened slug={DraftRestorePromptRegistration.Slug}"));
    }
}
