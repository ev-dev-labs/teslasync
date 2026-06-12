using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.ModalsDialogs;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The mutually-exclusive lifecycle state the <see cref="ReleaseNotesViewModel"/> can be in — the native
/// union of the loading / loaded / empty / error / stale / offline branches a data-driven surface renders.
/// The web <c>ReleaseNotes</c> reads the static generated <c>CHANGELOG</c> so it only ever renders the loaded
/// branch; the native surface routes the same catalog through the shared cache-then-network seam so the list
/// can be surfaced through a skeleton and a degraded read still renders a friendly surface rather than a blank
/// card (mirrors the sibling <see cref="ChangelogModalState"/>).
/// </summary>
public enum ReleaseNotesState
{
    /// <summary>Initial fetch with no content yet — render the skeleton chrome.</summary>
    Loading,

    /// <summary>The catalog resolved with at least one release — render the accordion list.</summary>
    Loaded,

    /// <summary>The catalog resolved empty — render the friendly empty surface.</summary>
    Empty,

    /// <summary>The read failed and nothing is renderable — render the retry affordance.</summary>
    Error,

    /// <summary>The shown list is backed by a cached read older than the freshness window — list plus a stale chip.</summary>
    Stale,

    /// <summary>The read is offline but cached content remains — list plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// Canonical metadata for the <c>ReleaseNotes</c> shared surface — the native analogue of the module-level
/// constants in web/src/components/feedback/ReleaseNotes.tsx. Carries the diagnostics slug, the default release
/// cap (web <c>limit = 3</c>), the list / entry automation ids, the Segoe Fluent "Gift" glyph standing in for the
/// web Lucide <c>Gift</c> icon, and the i18n keys (each with the English fallback the web renders verbatim — every
/// key already exists in the P1/S10 catalogue under <c>translation.changelog.*</c> / <c>translation.common.*</c>).
/// It also maps a release <see cref="ChangelogBadge"/> and a <see cref="ChangelogChangeType"/> to the shared
/// semantic <see cref="StatusKind"/> palette (the native peer of the web <c>BADGE_VARIANT</c> / <c>ICON_TINT</c> /
/// <c>DOT_TINT</c> maps). UI-free so it is asserted headlessly.
/// </summary>
public static class ReleaseNotesRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "ReleaseNotes";

    /// <summary>Default number of releases rendered, newest-first (web <c>limit = 3</c>).</summary>
    public const int DefaultLimit = 3;

    /// <summary>The automation id Narrator and UI-automation resolve the release list by.</summary>
    public const string ListAutomationId = "release-notes-list";

    /// <summary>Segoe Fluent "Gift" glyph — the native stand-in for the web Lucide <c>Gift</c> icon.</summary>
    public const string GiftGlyph = "\uE8C9";

    /// <summary>i18n key for the per-release "What's New" heading (web <c>changelog.releaseNotes.heading</c>).</summary>
    public const string HeadingKey = "translation.changelog.releaseNotes.heading";

    /// <summary>English fallback for <see cref="HeadingKey"/> — the web default value, verbatim.</summary>
    public const string HeadingFallback = "What's New";

    /// <summary>i18n key for the "latest" badge label (web <c>changelog.badges.latest</c>).</summary>
    public const string BadgeLatestKey = "translation.changelog.badges.latest";

    /// <summary>i18n key for the "stable" badge label (web <c>changelog.badges.stable</c>).</summary>
    public const string BadgeStableKey = "translation.changelog.badges.stable";

    /// <summary>i18n key for the "beta" badge label (web <c>changelog.badges.beta</c>).</summary>
    public const string BadgeBetaKey = "translation.changelog.badges.beta";

    /// <summary>i18n key for the empty-surface message.</summary>
    public const string EmptyKey = "translation.common.noData";

    /// <summary>English fallback for <see cref="EmptyKey"/>.</summary>
    public const string EmptyFallback = "No data available";

    /// <summary>i18n key for the retry affordance label.</summary>
    public const string RetryKey = "translation.common.retry";

    /// <summary>English fallback for <see cref="RetryKey"/>.</summary>
    public const string RetryFallback = "Retry";

    /// <summary>i18n key for the stale chip label.</summary>
    public const string StaleKey = "translation.common.stale";

    /// <summary>English fallback for <see cref="StaleKey"/>.</summary>
    public const string StaleFallback = "Stale";

    /// <summary>i18n key for the offline chip label (and the offline error message).</summary>
    public const string OfflineKey = "translation.common.offline";

    /// <summary>English fallback for <see cref="OfflineKey"/>.</summary>
    public const string OfflineFallback = "Offline";

    /// <summary>i18n key for the loading announcement.</summary>
    public const string LoadingKey = "translation.common.loading";

    /// <summary>English fallback for <see cref="LoadingKey"/>.</summary>
    public const string LoadingFallback = "Loading...";

    /// <summary>i18n key for the generic (non-offline) error message.</summary>
    public const string ErrorKey = "translation.error.serverError.message";

    /// <summary>English fallback for <see cref="ErrorKey"/>.</summary>
    public const string ErrorFallback = "Something went wrong on our end. Please try again.";

    /// <summary>Resolve the localized "What's New" heading (web <c>t('changelog.releaseNotes.heading')</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string Heading(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(HeadingKey, HeadingFallback);
    }

    /// <summary>Resolve the localized badge label for a release badge (web <c>BADGE_KEY</c> / <c>BADGE_FALLBACK</c>).</summary>
    /// <param name="badge">The release badge classification.</param>
    /// <param name="localizer">The i18n facade.</param>
    public static string BadgeLabel(ChangelogBadge badge, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return badge switch
        {
            ChangelogBadge.Latest => localizer.GetString(BadgeLatestKey, "Latest"),
            ChangelogBadge.Stable => localizer.GetString(BadgeStableKey, "Stable"),
            ChangelogBadge.Beta => localizer.GetString(BadgeBetaKey, "Beta"),
            _ => localizer.GetString(BadgeStableKey, "Stable"),
        };
    }

    /// <summary>
    /// The semantic accent for a release badge — the native peer of the web <c>BADGE_VARIANT</c>
    /// (latest→success, stable→info, beta→warning). The same accent tints the leading "Gift" glyph, exactly
    /// as the web <c>ICON_TINT</c> map uses the matching emerald / cyan / amber family.
    /// </summary>
    /// <param name="badge">The release badge classification.</param>
    public static StatusKind BadgeStatus(ChangelogBadge badge) => badge switch
    {
        ChangelogBadge.Latest => StatusKind.Success,
        ChangelogBadge.Stable => StatusKind.Info,
        ChangelogBadge.Beta => StatusKind.Warning,
        _ => StatusKind.Info,
    };

    /// <summary>
    /// The semantic dot accent for a change line — the native peer of the web <c>DOT_TINT</c> map
    /// (added→emerald, changed→cyan, fixed→amber, removed/security→rose, deprecated→purple). WinUI's
    /// <see cref="StatusKind"/> has no purple, so deprecated maps to neutral (the same choice the sibling
    /// ChangelogModal makes), keeping the two native changelog surfaces colour-consistent.
    /// </summary>
    /// <param name="type">The Keep-a-Changelog change category.</param>
    public static StatusKind ChangeDotStatus(ChangelogChangeType type) => type switch
    {
        ChangelogChangeType.Added => StatusKind.Success,
        ChangelogChangeType.Changed => StatusKind.Info,
        ChangelogChangeType.Fixed => StatusKind.Warning,
        ChangelogChangeType.Removed => StatusKind.Danger,
        ChangelogChangeType.Deprecated => StatusKind.Neutral,
        ChangelogChangeType.Security => StatusKind.Danger,
        _ => StatusKind.Neutral,
    };
}

/// <summary>
/// One render-ready change line within a release — the native analogue of a single <c>release.changes</c> item
/// in the web flat list (web/src/components/feedback/ReleaseNotes.tsx L108-115). Unlike the sibling
/// ChangelogModal, the web <c>ReleaseNotes</c> does NOT group changes into Keep-a-Changelog sections: it renders
/// every change in author order, each prefixed by a dot coloured from its <see cref="ChangelogChangeType"/>.
/// </summary>
/// <param name="Text">The human-readable change text (authored, shown verbatim).</param>
/// <param name="DotStatus">The semantic status driving the leading dot colour (web <c>DOT_TINT</c>).</param>
public sealed record ReleaseNotesChangeDisplay(string Text, StatusKind DotStatus);

/// <summary>A render-ready release entry: header metadata plus its ordered, flat change list.</summary>
/// <param name="Version">The raw semver string, e.g. "0.7.0".</param>
/// <param name="VersionLabel">The display version ("v" + <paramref name="Version"/>).</param>
/// <param name="Date">The release date text (ISO YYYY-MM-DD).</param>
/// <param name="Badge">The badge classification.</param>
/// <param name="BadgeLabel">The localized badge label.</param>
/// <param name="BadgeStatus">The semantic accent for the badge AND the leading "Gift" glyph (web <c>BADGE_VARIANT</c> / <c>ICON_TINT</c>).</param>
/// <param name="DefaultExpanded">True only for the first entry (web initial <c>expanded = releases[0].version</c>).</param>
/// <param name="Changes">The flat change list, in author order.</param>
/// <param name="AutomationName">The Narrator name for the entry header (version, badge, date).</param>
public sealed record ReleaseNotesEntryDisplay(
    string Version,
    string VersionLabel,
    string Date,
    ChangelogBadge Badge,
    string BadgeLabel,
    StatusKind BadgeStatus,
    bool DefaultExpanded,
    IReadOnlyList<ReleaseNotesChangeDisplay> Changes,
    string AutomationName);

/// <summary>
/// The complete, render-ready list the surface shows — the capped, newest-first releases plus the localized
/// "What's New" heading every expanded entry repeats (web/src/components/feedback/ReleaseNotes.tsx).
/// </summary>
/// <param name="Entries">The releases shown — the newest <c>limit</c> entries (web <c>CHANGELOG.slice(0, limit)</c>).</param>
/// <param name="Heading">The localized per-release "What's New" heading.</param>
/// <param name="AutomationName">The Narrator name summarising the list region.</param>
public sealed record ReleaseNotesDisplay(
    IReadOnlyList<ReleaseNotesEntryDisplay> Entries,
    string Heading,
    string AutomationName)
{
    /// <summary>True when there is at least one release to render.</summary>
    public bool HasEntries => Entries.Count > 0;
}

/// <summary>
/// The UI-free projection that turns a <see cref="ChangelogReading"/> into the render-ready
/// <see cref="ReleaseNotesDisplay"/> — the native port of the web <c>ReleaseNotes</c> render body
/// (web/src/components/feedback/ReleaseNotes.tsx L70-123): the newest-<c>limit</c> slice, the per-release
/// header (version + localized badge + date), the flat author-ordered change list with type-coloured dots, and
/// the first-release-expanded-by-default initial state. Kept static and resource-free so it is exhaustively
/// unit-testable without a XAML runtime; every label flows through the injected <see cref="ILocalizer"/>. The
/// reading's seen-version is irrelevant to this surface (unlike the modal, ReleaseNotes always shows the newest
/// releases regardless of acknowledgement state), so it is ignored.
/// </summary>
public static class ReleaseNotesProjection
{
    /// <summary>
    /// Project a changelog reading into the render-ready release list, capped to <paramref name="limit"/>
    /// newest-first entries (web <c>CHANGELOG.slice(0, limit)</c>); a non-positive limit yields an empty list.
    /// </summary>
    /// <param name="reading">The merged changelog reading (its seen-version is ignored).</param>
    /// <param name="limit">The maximum number of releases to render (web <c>limit</c>, default 3).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static ReleaseNotesDisplay Project(ChangelogReading reading, int limit, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(reading);
        ArgumentNullException.ThrowIfNull(localizer);

        string heading = ReleaseNotesRegistration.Heading(localizer);

        int take = Math.Max(0, limit);
        var entries = new List<ReleaseNotesEntryDisplay>(Math.Min(take, reading.Entries.Count));
        for (int i = 0; i < reading.Entries.Count && i < take; i++)
        {
            entries.Add(ProjectEntry(reading.Entries[i], i, localizer));
        }

        string automationName = entries.Count > 0
            ? $"{heading}. {entries.Count}"
            : heading;

        return new ReleaseNotesDisplay(entries, heading, automationName);
    }

    private static ReleaseNotesEntryDisplay ProjectEntry(ChangelogEntry entry, int index, ILocalizer localizer)
    {
        var changes = new List<ReleaseNotesChangeDisplay>(entry.Changes.Count);
        foreach (var change in entry.Changes)
        {
            changes.Add(new ReleaseNotesChangeDisplay(
                change.Text,
                ReleaseNotesRegistration.ChangeDotStatus(change.Type)));
        }

        string badgeLabel = ReleaseNotesRegistration.BadgeLabel(entry.Badge, localizer);
        string versionLabel = $"v{entry.Version}";
        string automationName = $"{versionLabel}, {badgeLabel}, {entry.Date}";

        return new ReleaseNotesEntryDisplay(
            entry.Version,
            versionLabel,
            entry.Date,
            entry.Badge,
            badgeLabel,
            ReleaseNotesRegistration.BadgeStatus(entry.Badge),
            index == 0,
            changes,
            automationName);
    }
}

/// <summary>
/// PII-safe diagnostics for the ReleaseNotes surface (P1/S11 diagnostics contract). The surface carries only
/// authored changelog text and version labels (no user content), so the collector records ONLY the operational
/// <c>view.opened</c> event with the surface slug — never a version or change text. Thread-safe; mirrors the peer
/// surfaces' diagnostics collectors.
/// </summary>
public sealed class ReleaseNotesDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public ReleaseNotesDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ReleaseNotes</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={ReleaseNotesRegistration.Slug}");
    }
}
