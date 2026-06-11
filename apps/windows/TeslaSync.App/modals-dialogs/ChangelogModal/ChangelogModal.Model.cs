using System.Globalization;
using System.Text.RegularExpressions;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// The Keep-a-Changelog change category (web <c>ChangelogChangeType</c>). Drives the section grouping,
/// the localized section heading and the section dot colour exactly like
/// web/src/components/feedback/ChangelogModal.tsx.
/// </summary>
public enum ChangelogChangeType
{
    /// <summary>New capability (web <c>added</c>).</summary>
    Added,

    /// <summary>Behaviour change (web <c>changed</c>).</summary>
    Changed,

    /// <summary>Bug fix (web <c>fixed</c>).</summary>
    Fixed,

    /// <summary>Removed capability (web <c>removed</c>).</summary>
    Removed,

    /// <summary>Deprecation notice (web <c>deprecated</c>).</summary>
    Deprecated,

    /// <summary>Security fix (web <c>security</c>).</summary>
    Security,
}

/// <summary>The release badge classification (web <c>ChangelogBadge</c>).</summary>
public enum ChangelogBadge
{
    /// <summary>The topmost release (web <c>latest</c>).</summary>
    Latest,

    /// <summary>A shipped stable release (web <c>stable</c>).</summary>
    Stable,

    /// <summary>A pre-release (web <c>beta</c>).</summary>
    Beta,
}

/// <summary>
/// The mutually-exclusive lifecycle state the <see cref="ChangelogModalViewModel"/> can be in — the native
/// union of the loading / loaded / empty / error / stale / offline branches a data-driven surface renders.
/// The web ChangelogModal reads static generated data so it only ever renders the loaded branch; the native
/// surface models the full cache-then-network seam so the catalog can be surfaced through a skeleton and a
/// degraded read still renders a friendly surface.
/// </summary>
public enum ChangelogModalState
{
    /// <summary>Initial fetch with no content yet — render the skeleton chrome.</summary>
    Loading,

    /// <summary>The catalog resolved with at least one release — render the body.</summary>
    Loaded,

    /// <summary>The catalog resolved empty — render the friendly empty surface.</summary>
    Empty,

    /// <summary>The read failed and nothing is renderable — render the retry affordance.</summary>
    Error,

    /// <summary>The shown body is backed by a cached read older than the freshness window — body plus a stale chip.</summary>
    Stale,

    /// <summary>The read is offline but cached content remains — body plus an offline chip.</summary>
    Offline,
}

/// <summary>A single typed change line within a release (web <c>ChangelogChange</c>).</summary>
/// <param name="Type">The Keep-a-Changelog category.</param>
/// <param name="Text">The human-readable change text (already localized at author time, shown verbatim).</param>
public sealed record ChangelogChange(ChangelogChangeType Type, string Text);

/// <summary>One release entry (web <c>ChangelogEntry</c>).</summary>
/// <param name="Version">Semver string, e.g. "0.7.0" or "1.0.0-beta.1".</param>
/// <param name="Date">ISO date (YYYY-MM-DD) the version was released.</param>
/// <param name="Badge">The badge classification.</param>
/// <param name="Changes">The flat list of changes, in section order.</param>
public sealed record ChangelogEntry(
    string Version,
    string Date,
    ChangelogBadge Badge,
    IReadOnlyList<ChangelogChange> Changes);

/// <summary>
/// The merged reading the <see cref="IChangelogSource"/> emits — the static catalog plus the user's
/// acknowledgement state (web <c>useChangelog</c> = generated <c>CHANGELOG</c> + the localStorage
/// <c>seen-version</c>). The projection derives the unseen subset and the first-visit flag from it.
/// </summary>
/// <param name="Entries">All releases, newest first.</param>
/// <param name="SeenVersion">The highest version the user has acknowledged, or <see langword="null"/> on a first visit.</param>
public sealed record ChangelogReading(IReadOnlyList<ChangelogEntry> Entries, string? SeenVersion)
{
    /// <summary>The topmost release version, or <see langword="null"/> when the catalog is empty.</summary>
    public string? LatestVersion => Entries.Count > 0 ? Entries[0].Version : null;
}

/// <summary>One section (added / changed / …) of a rendered release, with its localized heading and dot colour.</summary>
/// <param name="Type">The change category.</param>
/// <param name="Label">The localized section heading.</param>
/// <param name="DotStatus">The semantic status driving the leading dot colour (web <c>SECTION_DOT</c>).</param>
/// <param name="Items">The change texts in this section.</param>
public sealed record ChangelogSectionDisplay(
    ChangelogChangeType Type,
    string Label,
    StatusKind DotStatus,
    IReadOnlyList<string> Items);

/// <summary>A render-ready release entry: header metadata plus its non-empty, ordered sections.</summary>
/// <param name="Version">The raw semver string.</param>
/// <param name="VersionLabel">The display version ("v" + <paramref name="Version"/>).</param>
/// <param name="Date">The release date text.</param>
/// <param name="Badge">The badge classification.</param>
/// <param name="BadgeLabel">The localized badge label.</param>
/// <param name="BadgeStatus">The semantic status driving the badge colour (web <c>BADGE_VARIANT</c>).</param>
/// <param name="DefaultExpanded">True for the first two entries (web <c>defaultOpen={idx &lt; 2}</c>).</param>
/// <param name="Sections">The non-empty sections, in canonical order.</param>
/// <param name="AutomationName">The Narrator name for the entry header.</param>
public sealed record ChangelogEntryDisplay(
    string Version,
    string VersionLabel,
    string Date,
    ChangelogBadge Badge,
    string BadgeLabel,
    StatusKind BadgeStatus,
    bool DefaultExpanded,
    IReadOnlyList<ChangelogSectionDisplay> Sections,
    string AutomationName);

/// <summary>The complete, render-ready body the modal shows (web parity for the modal content + subtitle).</summary>
/// <param name="VisibleEntries">The entries shown — the unseen subset, or all entries on a first visit.</param>
/// <param name="IsFirstVisit">True when every entry is unseen (web <c>newEntries.length === entries.length</c>).</param>
/// <param name="HasUnseen">True when at least one release shipped after the seen version (web <c>hasUnseen</c>).</param>
/// <param name="NewCount">The count of unseen releases (drives the since-last-visit subtitle).</param>
/// <param name="Subtitle">The localized subtitle (first-visit copy or the since-last-visit count line).</param>
/// <param name="AutomationName">The Narrator name summarising the modal.</param>
public sealed record ChangelogModalDisplay(
    IReadOnlyList<ChangelogEntryDisplay> VisibleEntries,
    bool IsFirstVisit,
    bool HasUnseen,
    int NewCount,
    string Subtitle,
    string AutomationName)
{
    /// <summary>True when there is at least one entry to render.</summary>
    public bool HasEntries => VisibleEntries.Count > 0;
}

/// <summary>
/// The UI-free projection that turns a <see cref="ChangelogReading"/> into the render-ready
/// <see cref="ChangelogModalDisplay"/> — the native port of the body-building logic in
/// web/src/components/feedback/ChangelogModal.tsx (the unseen-subset gate, the first-visit subtitle, the
/// per-entry section grouping, the badge/section mapping) plus the semver comparison from
/// web/src/hooks/useChangelog.ts. Kept static and resource-free so it is exhaustively unit-testable without a
/// XAML runtime; every label flows through the injected <see cref="ILocalizer"/>.
/// </summary>
public static partial class ChangelogModalProjection
{
    private static readonly ChangelogChangeType[] SectionOrder =
    {
        ChangelogChangeType.Added,
        ChangelogChangeType.Changed,
        ChangelogChangeType.Fixed,
        ChangelogChangeType.Removed,
        ChangelogChangeType.Deprecated,
        ChangelogChangeType.Security,
    };

    /// <summary>
    /// Project the merged reading into the render-ready display: the unseen subset (or all entries on a first
    /// visit), the localized subtitle, and each entry's ordered non-empty sections.
    /// </summary>
    public static ChangelogModalDisplay Project(ChangelogReading reading, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(reading);
        ArgumentNullException.ThrowIfNull(localizer);

        IReadOnlyList<ChangelogEntry> entries = reading.Entries;
        string? seen = reading.SeenVersion;

        IReadOnlyList<ChangelogEntry> newEntries = string.IsNullOrEmpty(seen)
            ? entries
            : entries.Where(e => CompareVersions(e.Version, seen) > 0).ToList();

        bool isFirstVisit = newEntries.Count == entries.Count;
        IReadOnlyList<ChangelogEntry> visible = newEntries.Count > 0 ? newEntries : entries;

        string subtitle = isFirstVisit
            ? localizer.GetString(
                "changelog.modal.subtitleFirstVisit",
                "Welcome! Here's a quick tour of what TeslaSync ships with right now.")
            : string.Format(
                CultureInfo.CurrentCulture,
                localizer.GetString(
                    "changelog.modal.subtitleSinceLastVisit",
                    "{0} new release(s) since your last visit."),
                visible.Count);

        var entryDisplays = new List<ChangelogEntryDisplay>(visible.Count);
        for (int i = 0; i < visible.Count; i++)
        {
            entryDisplays.Add(ProjectEntry(visible[i], i, localizer));
        }

        string title = localizer.GetString("changelog.modal.title", "What's new in TeslaSync");
        string automationName = $"{title}. {subtitle}";

        return new ChangelogModalDisplay(
            entryDisplays,
            isFirstVisit,
            newEntries.Count > 0,
            newEntries.Count,
            subtitle,
            automationName);
    }

    /// <summary>The localized badge label for a badge (web <c>BADGE_KEY</c> / <c>BADGE_FALLBACK</c>).</summary>
    public static string BadgeLabel(ChangelogBadge badge, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return badge switch
        {
            ChangelogBadge.Latest => localizer.GetString("changelog.badges.latest", "Latest"),
            ChangelogBadge.Stable => localizer.GetString("changelog.badges.stable", "Stable"),
            ChangelogBadge.Beta => localizer.GetString("changelog.badges.beta", "Beta"),
            _ => localizer.GetString("changelog.badges.stable", "Stable"),
        };
    }

    /// <summary>The semantic badge colour (web <c>BADGE_VARIANT</c>: latest→success, stable→info, beta→warning).</summary>
    public static StatusKind BadgeStatus(ChangelogBadge badge) => badge switch
    {
        ChangelogBadge.Latest => StatusKind.Success,
        ChangelogBadge.Stable => StatusKind.Info,
        ChangelogBadge.Beta => StatusKind.Warning,
        _ => StatusKind.Info,
    };

    /// <summary>The localized section heading (web <c>SECTION_KEY</c> / <c>SECTION_FALLBACK</c>).</summary>
    public static string SectionLabel(ChangelogChangeType type, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return type switch
        {
            ChangelogChangeType.Added => localizer.GetString("changelog.sections.added", "Added"),
            ChangelogChangeType.Changed => localizer.GetString("changelog.sections.changed", "Changed"),
            ChangelogChangeType.Fixed => localizer.GetString("changelog.sections.fixed", "Fixed"),
            ChangelogChangeType.Removed => localizer.GetString("changelog.sections.removed", "Removed"),
            ChangelogChangeType.Deprecated => localizer.GetString("changelog.sections.deprecated", "Deprecated"),
            ChangelogChangeType.Security => localizer.GetString("changelog.sections.security", "Security"),
            _ => localizer.GetString("changelog.sections.changed", "Changed"),
        };
    }

    /// <summary>
    /// The section dot colour (web <c>SECTION_DOT</c>). The web palette has six tints; WinUI's
    /// <see cref="StatusKind"/> has five, so deprecated maps to neutral (the web purple has no semantic peer).
    /// </summary>
    public static StatusKind SectionDotStatus(ChangelogChangeType type) => type switch
    {
        ChangelogChangeType.Added => StatusKind.Success,
        ChangelogChangeType.Changed => StatusKind.Info,
        ChangelogChangeType.Fixed => StatusKind.Warning,
        ChangelogChangeType.Removed => StatusKind.Danger,
        ChangelogChangeType.Deprecated => StatusKind.Neutral,
        ChangelogChangeType.Security => StatusKind.Danger,
        _ => StatusKind.Neutral,
    };

    /// <summary>
    /// Compare two semver strings, returning -1 / 0 / 1 (web <c>compareVersions</c>). Pre-release tags sort
    /// before the corresponding release; anything that fails to parse falls back to an ordinal compare so a
    /// malformed entry never throws.
    /// </summary>
    public static int CompareVersions(string a, string b)
    {
        ArgumentNullException.ThrowIfNull(a);
        ArgumentNullException.ThrowIfNull(b);
        if (string.Equals(a, b, StringComparison.Ordinal))
        {
            return 0;
        }

        VersionParts? pa = Parse(a);
        VersionParts? pb = Parse(b);
        if (pa is not { } va || pb is not { } vb)
        {
            return Math.Sign(string.CompareOrdinal(a, b));
        }

        if (va.Major != vb.Major)
        {
            return va.Major < vb.Major ? -1 : 1;
        }

        if (va.Minor != vb.Minor)
        {
            return va.Minor < vb.Minor ? -1 : 1;
        }

        if (va.Patch != vb.Patch)
        {
            return va.Patch < vb.Patch ? -1 : 1;
        }

        // Cores equal — a pre-release sorts before the stable release.
        if (va.Pre is null && vb.Pre is not null)
        {
            return 1;
        }

        if (va.Pre is not null && vb.Pre is null)
        {
            return -1;
        }

        if (va.Pre is null && vb.Pre is null)
        {
            return 0;
        }

        return Math.Sign(string.CompareOrdinal(va.Pre, vb.Pre));
    }

    private static ChangelogEntryDisplay ProjectEntry(ChangelogEntry entry, int index, ILocalizer localizer)
    {
        var sections = new List<ChangelogSectionDisplay>(SectionOrder.Length);
        foreach (var type in SectionOrder)
        {
            var items = entry.Changes.Where(c => c.Type == type).Select(c => c.Text).ToList();
            if (items.Count == 0)
            {
                continue;
            }

            sections.Add(new ChangelogSectionDisplay(type, SectionLabel(type, localizer), SectionDotStatus(type), items));
        }

        string badgeLabel = BadgeLabel(entry.Badge, localizer);
        string versionLabel = $"v{entry.Version}";
        string automationName = $"{versionLabel}, {badgeLabel}, {entry.Date}";

        return new ChangelogEntryDisplay(
            entry.Version,
            versionLabel,
            entry.Date,
            entry.Badge,
            badgeLabel,
            BadgeStatus(entry.Badge),
            index < 2,
            sections,
            automationName);
    }

    private static VersionParts? Parse(string version)
    {
        var match = SemverRegex().Match(version);
        if (!match.Success)
        {
            return null;
        }

        return new VersionParts(
            int.Parse(match.Groups[1].Value, CultureInfo.InvariantCulture),
            int.Parse(match.Groups[2].Value, CultureInfo.InvariantCulture),
            int.Parse(match.Groups[3].Value, CultureInfo.InvariantCulture),
            match.Groups[4].Success ? match.Groups[4].Value : null);
    }

    [GeneratedRegex(@"^(\d+)\.(\d+)\.(\d+)(?:[-+](.+))?$")]
    private static partial Regex SemverRegex();

    private readonly record struct VersionParts(int Major, int Minor, int Patch, string? Pre);
}
