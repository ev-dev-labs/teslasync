using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive surface state for the <see cref="AdvancedSettingsViewModel"/> — the native union of
/// the two branches the web <c>AdvancedSettings</c> component renders
/// (web/src/features/settings/components/AdvancedSettings.tsx). That component is a purely client-side,
/// synchronous panel: it reads the silenced confirm-dialog ids straight from local storage
/// (<c>listSilenced()</c> in web/src/lib/confirmSilence.ts) and renders either the empty state or the
/// restore list — it never touches the network. So, exactly as the sibling client utilities document (see
/// <see cref="JwtDecoderState"/>), there is deliberately no loading / error / stale / offline state: the read
/// resolves synchronously on this device and a failed / unreadable store is folded to
/// <see cref="Empty"/> (mirroring the web <c>load()</c> try/catch that returns an empty set) rather than a
/// crash or a blank box.
/// </summary>
public enum AdvancedSettingsState
{
    /// <summary>No prompts are silenced — render the friendly empty state (web <c>silenced.length === 0</c>).</summary>
    Empty,

    /// <summary>One or more prompts are silenced — render the restore list and the "Restore all" action.</summary>
    Populated,
}

/// <summary>
/// Resolves a silenced action id to its friendly, localized label — the native port of the web
/// <c>useSilenceKeyLabel</c> hook (web/src/features/settings/components/AdvancedSettings.tsx). It maps the two
/// known ids to their catalog strings and falls back to the raw id for any unknown adopter (the web
/// forward-compat <c>default: return key</c>), so a newly-shipped silence key still renders before its
/// translation lands. UI-free so it is unit-tested without a XAML host.
/// </summary>
public static class SilencedPromptLabeler
{
    /// <summary>The stable "discard unsaved draft" action id (web <c>discard-draft</c>).</summary>
    public const string DiscardDraftId = "discard-draft";

    /// <summary>The stable "leave page with unsaved changes" action id (web <c>unsaved-navigation</c>).</summary>
    public const string UnsavedNavigationId = "unsaved-navigation";

    /// <summary>i18n key for the discard-draft label (web <c>settings.advanced.restoreConfirms.keys.discardDraft</c>).</summary>
    public const string DiscardDraftKey = "settings.advanced.restoreConfirms.keys.discardDraft";

    /// <summary>English fallback for the discard-draft label.</summary>
    public const string DiscardDraftFallback = "Discard unsaved draft";

    /// <summary>i18n key for the unsaved-navigation label (web <c>settings.advanced.restoreConfirms.keys.unsavedNavigation</c>).</summary>
    public const string UnsavedNavigationKey = "settings.advanced.restoreConfirms.keys.unsavedNavigation";

    /// <summary>English fallback for the unsaved-navigation label.</summary>
    public const string UnsavedNavigationFallback = "Leave page with unsaved changes";

    /// <summary>Resolve <paramref name="key"/> to its friendly label, falling back to the raw id when unknown.</summary>
    /// <param name="key">The silenced action id (a stable, namespaced confirm-dialog key).</param>
    /// <param name="localizer">The i18n facade resolving the known labels.</param>
    public static string Label(string key, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        return key switch
        {
            DiscardDraftId => localizer.GetString(DiscardDraftKey, DiscardDraftFallback),
            UnsavedNavigationId => localizer.GetString(UnsavedNavigationKey, UnsavedNavigationFallback),
            _ => key ?? string.Empty,
        };
    }
}

/// <summary>
/// One render-ready row of the restore list — the native analogue of a web <c>&lt;li&gt;</c> in
/// <c>AdvancedSettings</c>. Carries the stable <see cref="Key"/> (the silenced action id passed back to
/// <c>unsilence</c>), the friendly <see cref="Label"/> shown in the row, and the contextual
/// <see cref="RestoreActionName"/> announced by Narrator on the row's "Restore" button (the visible label is
/// just "Restore", so the per-row name carries the prompt it restores). Pure data — no WinUI types.
/// </summary>
/// <param name="Key">The stable silenced action id (restored via <c>unsilence(key)</c>).</param>
/// <param name="Label">The friendly, localized row label (web <c>labelFor(key)</c>).</param>
/// <param name="RestoreActionName">The Narrator name for the row's restore button (label-qualified).</param>
public sealed record AdvancedSettingsRow(string Key, string Label, string RestoreActionName);

/// <summary>
/// The fully projected, render-ready view of the silenced-prompts panel — the native analogue of the web
/// <c>AdvancedSettings</c> render output. Carries the chosen <see cref="State"/>, the localized header chrome
/// (icon badge glyph + accent, title, description), the optional "Restore all" action (shown only when
/// populated, web <c>silenced.length &gt; 0</c>), the per-row "Restore" label, the empty-state message and the
/// projected <see cref="Rows"/>. Pure data — no WinUI types — so the projection is unit-tested headlessly.
/// </summary>
/// <param name="State">The mutually-exclusive render branch.</param>
/// <param name="Title">The localized panel title (web <c>t('advanced.restoreConfirms.title')</c>).</param>
/// <param name="Description">The localized panel description (web <c>t('advanced.restoreConfirms.description')</c>).</param>
/// <param name="Glyph">The Segoe Fluent glyph for the accent badge (web Lucide <c>ShieldQuestion</c>).</param>
/// <param name="Accent">The badge accent name (web <c>color="cyan"</c>).</param>
/// <param name="RegionName">The surface's Narrator name (the localized title).</param>
/// <param name="ShowRestoreAll">True when the header "Restore all" action is shown (web <c>silenced.length &gt; 0</c>).</param>
/// <param name="RestoreAllText">The localized "Restore all" button label.</param>
/// <param name="RestoreAllActionName">The Narrator name for the "Restore all" button.</param>
/// <param name="RestoreText">The localized per-row "Restore" button label.</param>
/// <param name="IsEmpty">True when no prompts are silenced (the empty state is shown).</param>
/// <param name="EmptyMessage">The localized empty-state message (web <c>t('advanced.restoreConfirms.empty')</c>).</param>
/// <param name="Rows">The projected restore rows, ordinal-sorted by id (web <c>listSilenced()</c> ordering).</param>
public sealed record AdvancedSettingsDisplay(
    AdvancedSettingsState State,
    string Title,
    string Description,
    string Glyph,
    string Accent,
    string RegionName,
    bool ShowRestoreAll,
    string RestoreAllText,
    string RestoreAllActionName,
    string RestoreText,
    bool IsEmpty,
    string EmptyMessage,
    IReadOnlyList<AdvancedSettingsRow> Rows)
{
    /// <summary>The number of silenced prompts currently shown.</summary>
    public int Count => Rows.Count;
}

/// <summary>
/// Pure projection from the list of silenced action ids to the render-ready <see cref="AdvancedSettingsDisplay"/>
/// — the native port of the web <c>AdvancedSettings</c> render
/// (web/src/features/settings/components/AdvancedSettings.tsx). It resolves every owned string through the
/// i18n facade using the web's keys, defensively dedupes and ordinal-sorts the ids (mirroring the web
/// <c>listSilenced()</c> <c>Set</c> + <c>.sort()</c> so the list is stable), labels each id via
/// <see cref="SilencedPromptLabeler"/>, and selects the empty / populated branch. No SI conversion applies —
/// the surface carries no measurements. UI-free so it is unit-tested without a XAML runtime.
/// </summary>
public static class AdvancedSettingsProjection
{
    /// <summary>i18n key for the panel title (web <c>t('advanced.restoreConfirms.title')</c>).</summary>
    public const string TitleKey = "settings.advanced.restoreConfirms.title";

    /// <summary>English fallback for the panel title.</summary>
    public const string TitleFallback = "Confirmation prompts";

    /// <summary>i18n key for the panel description (web <c>t('advanced.restoreConfirms.description')</c>).</summary>
    public const string DescriptionKey = "settings.advanced.restoreConfirms.description";

    /// <summary>English fallback for the panel description.</summary>
    public const string DescriptionFallback =
        "Re-enable \u201CDon\u2019t ask again\u201D prompts you previously silenced.";

    /// <summary>i18n key for the "Restore all" action (web <c>t('advanced.restoreConfirms.restoreAll')</c>).</summary>
    public const string RestoreAllKey = "settings.advanced.restoreConfirms.restoreAll";

    /// <summary>English fallback for the "Restore all" action.</summary>
    public const string RestoreAllFallback = "Restore all";

    /// <summary>i18n key for the per-row "Restore" action (web <c>t('advanced.restoreConfirms.restore')</c>).</summary>
    public const string RestoreKey = "settings.advanced.restoreConfirms.restore";

    /// <summary>English fallback for the per-row "Restore" action.</summary>
    public const string RestoreFallback = "Restore";

    /// <summary>i18n key for the empty-state message (web <c>t('advanced.restoreConfirms.empty')</c>).</summary>
    public const string EmptyKey = "settings.advanced.restoreConfirms.empty";

    /// <summary>English fallback for the empty-state message.</summary>
    public const string EmptyFallback =
        "No silenced prompts. Tick \u201CDon\u2019t ask again\u201D on a confirmation dialog to silence it.";

    /// <summary>Segoe Fluent "Shield" glyph standing in for the web Lucide <c>ShieldQuestion</c> icon.</summary>
    public const string Glyph = "\uEA18";

    /// <summary>The badge accent name (web <c>color="cyan"</c>); resolved by <see cref="ToolCardAccent"/>.</summary>
    public const string Accent = "cyan";

    /// <summary>Project <paramref name="silencedKeys"/> into the render-ready display, resolving strings via <paramref name="localizer"/>.</summary>
    /// <param name="silencedKeys">The current silenced action ids (any order; deduped + sorted here).</param>
    /// <param name="localizer">The i18n facade resolving every owned string.</param>
    public static AdvancedSettingsDisplay Project(IReadOnlyList<string> silencedKeys, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(silencedKeys);
        ArgumentNullException.ThrowIfNull(localizer);

        string title = localizer.GetString(TitleKey, TitleFallback);
        string description = localizer.GetString(DescriptionKey, DescriptionFallback);
        string restoreAll = localizer.GetString(RestoreAllKey, RestoreAllFallback);
        string restore = localizer.GetString(RestoreKey, RestoreFallback);
        string empty = localizer.GetString(EmptyKey, EmptyFallback);

        // Defensive dedupe + ordinal sort — mirrors the web listSilenced() Set + .sort() so the list is
        // stable regardless of the store's emission order.
        var ordered = silencedKeys
            .Where(static k => !string.IsNullOrEmpty(k))
            .Distinct(StringComparer.Ordinal)
            .OrderBy(static k => k, StringComparer.Ordinal)
            .ToList();

        var rows = new List<AdvancedSettingsRow>(ordered.Count);
        foreach (var key in ordered)
        {
            string label = SilencedPromptLabeler.Label(key, localizer);
            rows.Add(new AdvancedSettingsRow(key, label, ComposeRestoreName(restore, label)));
        }

        bool isEmpty = rows.Count == 0;

        return new AdvancedSettingsDisplay(
            State: isEmpty ? AdvancedSettingsState.Empty : AdvancedSettingsState.Populated,
            Title: title,
            Description: description,
            Glyph: Glyph,
            Accent: Accent,
            RegionName: title,
            ShowRestoreAll: !isEmpty,
            RestoreAllText: restoreAll,
            RestoreAllActionName: restoreAll,
            RestoreText: restore,
            IsEmpty: isEmpty,
            EmptyMessage: empty,
            Rows: rows);
    }

    // The visible per-row button reads "Restore"; the Narrator name qualifies it with the prompt so screen
    // reader users know which prompt each button re-enables.
    private static string ComposeRestoreName(string restore, string label) =>
        string.IsNullOrEmpty(label) ? restore : $"{restore} \u2014 {label}";
}

/// <summary>
/// Canonical metadata for the AdvancedSettings surface — the native anchor for the web component at
/// web/src/features/settings/components/AdvancedSettings.tsx. The diagnostics <see cref="Slug"/> is the stable
/// surface name emitted with the <c>view.opened</c> event (P1/S11 diagnostics contract).
/// </summary>
public static class AdvancedSettingsRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "AdvancedSettings";

    /// <summary>The localized surface name (the panel title) — the host chrome / Narrator name.</summary>
    /// <param name="localizer">The i18n facade resolving the title.</param>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(AdvancedSettingsProjection.TitleKey, AdvancedSettingsProjection.TitleFallback);
    }
}

/// <summary>
/// PII-safe diagnostics for the AdvancedSettings surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a silenced action id or any user data —
/// so a diagnostics line can never leak a preference. Thread-safe.
/// </summary>
public sealed class AdvancedSettingsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional operational-only line sink (no user data is ever passed).</param>
    public AdvancedSettingsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=AdvancedSettings</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={AdvancedSettingsRegistration.Slug}");
    }
}
