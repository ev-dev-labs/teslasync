using System.Globalization;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata + i18n keys for the grouped tree multi-select surface — the native mirror of the web
/// <c>TreeSelect</c> (<c>web/src/components/forms/TreeSelect.tsx</c>), the generic tri-state two-level
/// (groups → leaves) multi-select primitive: a search box that filters the tree (without flattening it), a
/// header carrying a tri-state "select visible" checkbox + selected/visible counts + a clear-all action, and a
/// WAI-ARIA tree body whose group rows carry a tri-state (none / partial / all) checkbox, an expand chevron and
/// a <c>{selected}/{visible}</c> count over leaf rows with per-leaf disabled state. Selection is independent of
/// the search filter (selected leaves stay selected when filtered out of view; group / select-visible actions
/// only ever touch currently-visible, enabled leaves — the Grafana convention).
///
/// <para>
/// This metadata carries the diagnostics slug the surface registers under, the token brush / radius keys the
/// surface tints through (the web <c>text-[var(--text-primary/secondary/muted)]</c> text, the
/// <c>border-[var(--glass-border)]</c> hairline, the <c>bg-[var(--surface-1)]</c> body fill and the
/// <c>rounded-md</c> radius), and every render-contract i18n key/fallback the native surface routes through the
/// localizer. The web source's strings are component default-prop literals (it is an anonymous primitive with no
/// extracted catalog keys); the native surface routes each through <see cref="ILocalizer"/> with the verbatim
/// English fallback so there is no hardcoded English in the view, reusing the canonical <c>common.*</c> keys
/// where the catalog already carries them. UI-free so every projection is asserted without a XAML host.
/// </para>
/// </summary>
public static class TreeSelectRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "TreeSelect";

    // ── Token keys (web CSS variables → generated design-token brush/radius keys) ─────────────────────────

    /// <summary>Token brush key for primary text (web <c>text-[var(--text-primary)]</c>).</summary>
    public const string TextPrimaryBrushKey = "TsColorTextPrimaryBrush";

    /// <summary>Token brush key for secondary text (web <c>text-[var(--text-secondary)]</c>).</summary>
    public const string TextSecondaryBrushKey = "TsColorTextSecondaryBrush";

    /// <summary>Token brush key for muted text / counts / chevron (web <c>text-[var(--text-muted)]</c>).</summary>
    public const string TextMutedBrushKey = "TsColorTextMutedBrush";

    /// <summary>Token brush key for the body fill (web <c>bg-[var(--surface-1)]</c>).</summary>
    public const string SurfaceBrushKey = "TsColorSurfaceBrush";

    /// <summary>Token brush key for the body hairline (web <c>border-[var(--glass-border)]</c>).</summary>
    public const string BorderBrushKey = "TsColorBorderBrush";

    /// <summary>Corner-radius token key for the scroll body (web <c>rounded-md</c> ≈ 6&#160;px).</summary>
    public const string CornerRadiusKey = "TsRadiusSm";

    /// <summary>Corner-radius fallback in pixels when <see cref="CornerRadiusKey"/> is absent (web <c>rounded-md</c>).</summary>
    public const double CornerRadiusFallback = 6;

    // ── i18n keys + verbatim English fallbacks (web default-prop literals) ────────────────────────────────

    /// <summary>i18n key for the search box hint (web search box hint, default 'Search…').</summary>
    public const string SearchHintKey = "translation.treeSelect.searchHint";

    /// <summary>English fallback for <see cref="SearchHintKey"/> (web default, verbatim — U+2026 ellipsis).</summary>
    public const string SearchHintFallback = "Search\u2026";

    /// <summary>i18n key for the search box accessible name (web search <c>aria-label="Filter tree"</c>).</summary>
    public const string FilterAriaKey = "translation.treeSelect.filterAria";

    /// <summary>English fallback for <see cref="FilterAriaKey"/> (web literal, verbatim).</summary>
    public const string FilterAriaFallback = "Filter tree";

    /// <summary>i18n key for the clear-search (×) button accessible name (web <c>aria-label="Clear search"</c>).</summary>
    public const string ClearSearchKey = "translation.treeSelect.clearSearch";

    /// <summary>English fallback for <see cref="ClearSearchKey"/> (web literal, verbatim).</summary>
    public const string ClearSearchFallback = "Clear search";

    /// <summary>i18n key for the header select-all label when nothing is searched + not all selected (web <c>'Select all'</c>).</summary>
    public const string SelectAllKey = "translation.treeSelect.selectAll";

    /// <summary>English fallback for <see cref="SelectAllKey"/> (web literal, verbatim).</summary>
    public const string SelectAllFallback = "Select all";

    /// <summary>i18n key for the header select-all label when nothing is searched + all selected (web <c>'Clear all'</c>).</summary>
    public const string ClearAllKey = "translation.treeSelect.clearAll";

    /// <summary>English fallback for <see cref="ClearAllKey"/> (web literal, verbatim).</summary>
    public const string ClearAllFallback = "Clear all";

    /// <summary>i18n key for the header select-all label while searching + not all selected (web <c>`Select ${n} visible`</c>).</summary>
    public const string SelectVisibleKey = "translation.treeSelect.selectVisible";

    /// <summary>English fallback for <see cref="SelectVisibleKey"/> (web template; <c>{{count}}</c> interpolated).</summary>
    public const string SelectVisibleFallback = "Select {{count}} visible";

    /// <summary>i18n key for the header select-all label while searching + all selected (web <c>`Clear ${n} visible`</c>).</summary>
    public const string ClearVisibleKey = "translation.treeSelect.clearVisible";

    /// <summary>English fallback for <see cref="ClearVisibleKey"/> (web template; <c>{{count}}</c> interpolated).</summary>
    public const string ClearVisibleFallback = "Clear {{count}} visible";

    /// <summary>i18n key for the header selected-count chip when not searching (web <c>`${n} selected`</c>).</summary>
    public const string SelectedCountKey = "translation.treeSelect.selectedCount";

    /// <summary>English fallback for <see cref="SelectedCountKey"/> (web template; <c>{{count}}</c> interpolated).</summary>
    public const string SelectedCountFallback = "{{count}} selected";

    /// <summary>i18n key for the header selected-count chip while searching (web <c>`${n} selected of ${total}`</c>).</summary>
    public const string SelectedOfTotalKey = "translation.treeSelect.selectedOfTotal";

    /// <summary>English fallback for <see cref="SelectedOfTotalKey"/> (web template; <c>{{count}}</c> / <c>{{total}}</c>).</summary>
    public const string SelectedOfTotalFallback = "{{count}} selected of {{total}}";

    /// <summary>i18n key for the clear-all-selected action (web <c>'Clear all selected'</c>).</summary>
    public const string ClearAllSelectedKey = "translation.treeSelect.clearAllSelected";

    /// <summary>English fallback for <see cref="ClearAllSelectedKey"/> (web literal, verbatim).</summary>
    public const string ClearAllSelectedFallback = "Clear all selected";

    /// <summary>i18n key for the tree body accessible name (web <c>ariaLabel = 'Tree multi-select'</c>).</summary>
    public const string TreeLabelKey = "translation.treeSelect.ariaLabel";

    /// <summary>English fallback for <see cref="TreeLabelKey"/> (web default, verbatim).</summary>
    public const string TreeLabelFallback = "Tree multi-select";

    /// <summary>i18n key for the loading skeleton's sr-only status (web <c>VisuallyHidden "Loading…"</c>).</summary>
    public const string LoadingKey = "translation.treeSelect.loading";

    /// <summary>English fallback for <see cref="LoadingKey"/> (web literal, verbatim — U+2026 ellipsis).</summary>
    public const string LoadingFallback = "Loading\u2026";

    /// <summary>i18n key for the empty-catalog body text (web <c>emptyState ?? 'No items available.'</c>).</summary>
    public const string EmptyKey = "translation.treeSelect.empty";

    /// <summary>English fallback for <see cref="EmptyKey"/> (web default, verbatim).</summary>
    public const string EmptyFallback = "No items available.";

    /// <summary>i18n key for the no-search-results body text (web <c>noResultsState ?? `No matches for "${q}".`</c>).</summary>
    public const string NoResultsKey = "translation.treeSelect.noResults";

    /// <summary>English fallback for <see cref="NoResultsKey"/> (web template; <c>{{query}}</c> interpolated, curly quotes).</summary>
    public const string NoResultsFallback = "No matches for \u201C{{query}}\u201D.";

    /// <summary>i18n key for a group checkbox accessible name (web <c>`Toggle ${g.label}`</c>).</summary>
    public const string GroupToggleKey = "translation.treeSelect.groupToggle";

    /// <summary>English fallback for <see cref="GroupToggleKey"/> (web template; <c>{{group}}</c> interpolated).</summary>
    public const string GroupToggleFallback = "Toggle {{group}}";

    /// <summary>i18n key for a group row accessible name (web <c>`${g.label}, ${n} of ${total} selected`</c>).</summary>
    public const string GroupAriaKey = "translation.treeSelect.groupAria";

    /// <summary>English fallback for <see cref="GroupAriaKey"/> (web template; <c>{{group}}</c> / <c>{{count}}</c> / <c>{{total}}</c>).</summary>
    public const string GroupAriaFallback = "{{group}}, {{count}} of {{total}} selected";

    /// <summary>i18n key for a disabled leaf's accessible name suffix (web <c>`${leaf.label} (${reason})`</c>).</summary>
    public const string LeafDisabledKey = "translation.treeSelect.leafDisabled";

    /// <summary>English fallback for <see cref="LeafDisabledKey"/> (web template; <c>{{label}}</c> / <c>{{reason}}</c>).</summary>
    public const string LeafDisabledFallback = "{{label}} ({{reason}})";

    /// <summary>i18n key for the sr-only summary when not searching (web <c>`${n} selected of ${total} total`</c>).</summary>
    public const string SummaryKey = "translation.treeSelect.summary";

    /// <summary>English fallback for <see cref="SummaryKey"/> (web template; <c>{{count}}</c> / <c>{{total}}</c>).</summary>
    public const string SummaryFallback = "{{count}} selected of {{total}} total";

    /// <summary>i18n key for the sr-only summary while searching (web summary + <c>`, ${visible} visible`</c>).</summary>
    public const string SummaryVisibleKey = "translation.treeSelect.summaryVisible";

    /// <summary>English fallback for <see cref="SummaryVisibleKey"/> (web template; <c>{{count}}</c> / <c>{{total}}</c> / <c>{{visible}}</c>).</summary>
    public const string SummaryVisibleFallback = "{{count}} selected of {{total}} total, {{visible}} visible";

    // ── Resolved labels ──────────────────────────────────────────────────────────────────────────────────

    /// <summary>Resolve the search box hint through the localizer.</summary>
    public static string SearchHint(ILocalizer localizer) => Resolve(localizer, SearchHintKey, SearchHintFallback);

    /// <summary>Resolve the search box accessible name through the localizer.</summary>
    public static string FilterAria(ILocalizer localizer) => Resolve(localizer, FilterAriaKey, FilterAriaFallback);

    /// <summary>Resolve the clear-search button accessible name through the localizer.</summary>
    public static string ClearSearch(ILocalizer localizer) => Resolve(localizer, ClearSearchKey, ClearSearchFallback);

    /// <summary>Resolve the clear-all-selected action label through the localizer.</summary>
    public static string ClearAllSelected(ILocalizer localizer) => Resolve(localizer, ClearAllSelectedKey, ClearAllSelectedFallback);

    /// <summary>Resolve the tree body accessible name through the localizer.</summary>
    public static string TreeLabel(ILocalizer localizer) => Resolve(localizer, TreeLabelKey, TreeLabelFallback);

    /// <summary>Resolve the loading skeleton's sr-only status through the localizer.</summary>
    public static string Loading(ILocalizer localizer) => Resolve(localizer, LoadingKey, LoadingFallback);

    /// <summary>Resolve the empty-catalog body text through the localizer.</summary>
    public static string Empty(ILocalizer localizer) => Resolve(localizer, EmptyKey, EmptyFallback);

    /// <summary>Resolve the no-search-results body text through the localizer, interpolating the trimmed query (web <c>{{query}}</c>).</summary>
    public static string NoResults(ILocalizer localizer, string query) =>
        Interpolate(Resolve(localizer, NoResultsKey, NoResultsFallback), ("query", query ?? string.Empty));

    /// <summary>
    /// Resolve + interpolate the header select-all label — the native projection of the web <c>selectAllLabel</c>
    /// ternary (<c>TreeSelect.tsx</c> L385-L391): "Select/Clear all" when not searching, "Select/Clear
    /// {{count}} visible" while searching.
    /// </summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <param name="isSearching">Whether a search filter is active.</param>
    /// <param name="allVisibleSelected">Whether every visible-enabled leaf is selected.</param>
    /// <param name="visibleCount">The number of visible leaves (for the searching templates).</param>
    public static string SelectAllLabel(ILocalizer localizer, bool isSearching, bool allVisibleSelected, int visibleCount)
    {
        if (!isSearching)
        {
            return allVisibleSelected
                ? Resolve(localizer, ClearAllKey, ClearAllFallback)
                : Resolve(localizer, SelectAllKey, SelectAllFallback);
        }

        string template = allVisibleSelected
            ? Resolve(localizer, ClearVisibleKey, ClearVisibleFallback)
            : Resolve(localizer, SelectVisibleKey, SelectVisibleFallback);
        return Interpolate(template, ("count", Num(visibleCount)));
    }

    /// <summary>
    /// Resolve + interpolate the header selected-count chip — the native projection of the web count span
    /// (<c>TreeSelect.tsx</c> L437-L440): "{{count}} selected", with " of {{total}}" appended while searching.
    /// </summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <param name="selectedCount">The total number of selected leaves (across the unfiltered catalog).</param>
    /// <param name="totalCount">The total number of leaves in the catalog.</param>
    /// <param name="isSearching">Whether a search filter is active.</param>
    public static string SelectedSummary(ILocalizer localizer, int selectedCount, int totalCount, bool isSearching)
    {
        if (isSearching && totalCount > 0)
        {
            return Interpolate(
                Resolve(localizer, SelectedOfTotalKey, SelectedOfTotalFallback),
                ("count", Num(selectedCount)),
                ("total", Num(totalCount)));
        }

        return Interpolate(Resolve(localizer, SelectedCountKey, SelectedCountFallback), ("count", Num(selectedCount)));
    }

    /// <summary>Resolve + interpolate a group checkbox accessible name (web <c>`Toggle ${g.label}`</c>).</summary>
    public static string GroupToggle(ILocalizer localizer, string group) =>
        Interpolate(Resolve(localizer, GroupToggleKey, GroupToggleFallback), ("group", group ?? string.Empty));

    /// <summary>Resolve + interpolate a group row accessible name (web <c>`${g.label}, ${n} of ${total} selected`</c>).</summary>
    public static string GroupAria(ILocalizer localizer, string group, int selectedCount, int totalCount) =>
        Interpolate(
            Resolve(localizer, GroupAriaKey, GroupAriaFallback),
            ("group", group ?? string.Empty),
            ("count", Num(selectedCount)),
            ("total", Num(totalCount)));

    /// <summary>Resolve + interpolate a disabled leaf's accessible name (web <c>`${leaf.label} (${reason})`</c>); the bare label when no reason.</summary>
    public static string LeafName(ILocalizer localizer, string label, string? disabledReason) =>
        string.IsNullOrEmpty(disabledReason)
            ? label ?? string.Empty
            : Interpolate(
                Resolve(localizer, LeafDisabledKey, LeafDisabledFallback),
                ("label", label ?? string.Empty),
                ("reason", disabledReason));

    /// <summary>The group <c>{selected}/{visible}</c> count chip (web L558-L560); culture-formatted numbers.</summary>
    public static string GroupCount(int selectedCount, int visibleCount) =>
        string.Create(CultureInfo.CurrentCulture, $"{selectedCount}/{visibleCount}");

    /// <summary>
    /// Resolve + interpolate the sr-only live summary — the native projection of the web <c>VisuallyHidden</c>
    /// summary (<c>TreeSelect.tsx</c> L641-L644): "{{count}} selected of {{total}} total", with ", {{visible}}
    /// visible" appended while searching.
    /// </summary>
    public static string Summary(ILocalizer localizer, int selectedCount, int totalCount, int visibleCount, bool isSearching) =>
        isSearching
            ? Interpolate(
                Resolve(localizer, SummaryVisibleKey, SummaryVisibleFallback),
                ("count", Num(selectedCount)),
                ("total", Num(totalCount)),
                ("visible", Num(visibleCount)))
            : Interpolate(
                Resolve(localizer, SummaryKey, SummaryFallback),
                ("count", Num(selectedCount)),
                ("total", Num(totalCount)));

    private static string Num(int value) => value.ToString(CultureInfo.CurrentCulture);

    private static string Resolve(ILocalizer localizer, string key, string fallback)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(key, fallback);
    }

    /// <summary>
    /// Substitute each <c>{{token}}</c> (the web i18next form, used by the English fallbacks) and the matching
    /// native positional slot <c>{0}</c>/<c>{1}</c>… (the order tokens are supplied, used by the resw catalog)
    /// with its value. A literal replace — never <c>string.Format</c> — so a localized value carrying a stray
    /// brace can never throw a <see cref="FormatException"/>.
    /// </summary>
    private static string Interpolate(string template, params (string Token, string Value)[] tokens)
    {
        ArgumentNullException.ThrowIfNull(template);
        string result = template;
        for (int i = 0; i < tokens.Length; i++)
        {
            (string token, string value) = tokens[i];
            result = result
                .Replace("{{" + token + "}}", value, StringComparison.Ordinal)
                .Replace("{" + i.ToString(CultureInfo.InvariantCulture) + "}", value, StringComparison.Ordinal);
        }

        return result;
    }
}

/// <summary>
/// The mutually-exclusive body branch the tree renders — the native projection of the web source's body
/// branches (<c>TreeSelect.tsx</c> L468-L637). The web component shows exactly one: the four-row pulse skeleton
/// while <c>isLoading</c> (<see cref="Loading"/>, web L468), the friendly empty text when the catalog has no
/// groups (<see cref="Empty"/>, web <c>showEmpty</c> L481), the "no matches" text when the search filter
/// eliminated every group (<see cref="NoResults"/>, web <c>showNoResults</c> L487), or the tree rows themselves
/// (<see cref="Populated"/>, web L493). The web primitive is a controlled, prop-fed component with no fetch,
/// query-freshness or connectivity concept — like the peer presentational surfaces (Accordion / Combobox) it has
/// no error / stale / offline chrome to reproduce; the four branches below are the complete set the source
/// renders.
/// </summary>
public enum TreeSelectVisualState
{
    /// <summary>The skeleton shown while the catalog is loading (web <c>isLoading</c>).</summary>
    Loading,

    /// <summary>The catalog resolved with no groups — the empty-state text (web <c>showEmpty</c>).</summary>
    Empty,

    /// <summary>The search filter eliminated every group — the no-results text (web <c>showNoResults</c>).</summary>
    NoResults,

    /// <summary>One or more groups render — the tree rows (web populated branch).</summary>
    Populated,
}

/// <summary>The tri-state of a checkbox — the native analogue of the web <c>checked</c> / <c>indeterminate</c> pair.</summary>
public enum TreeCheckState
{
    /// <summary>Nothing selected (web <c>checked=false, indeterminate=false</c> → <c>aria-checked="false"</c>).</summary>
    Unchecked,

    /// <summary>Some but not all selected (web <c>indeterminate=true</c> → <c>aria-checked="mixed"</c>).</summary>
    Indeterminate,

    /// <summary>Everything selected (web <c>checked=true</c> → <c>aria-checked="true"</c>).</summary>
    Checked,
}

/// <summary>Which arm of the flat row sequence a row belongs to (web <c>RowKind</c>, <c>TreeSelect.tsx</c> L119).</summary>
public enum TreeSelectRowKind
{
    /// <summary>A group header row (web <c>role="treeitem" aria-level={1}</c>).</summary>
    Group,

    /// <summary>A leaf row under an expanded group (web <c>role="treeitem" aria-level={2}</c>).</summary>
    Leaf,
}

/// <summary>
/// One projected row of the flat tree sequence — the native analogue of a single web <c>role="treeitem"</c> row
/// (<c>TreeSelect.tsx</c> L514-L633). The view renders these without any selection / filter logic of its own:
/// <see cref="Kind"/> selects the chrome (a group header with its chevron + tri-state checkbox + count, or a leaf
/// with its checkbox), <see cref="RowIndex"/> is the roving-tabindex target (web <c>data-tree-row-index</c>),
/// <see cref="CheckState"/> drives the checkbox glyph + <c>aria-checked</c>, and <see cref="AccessibleName"/> /
/// <see cref="ToggleName"/> are the already-localized Narrator strings. Pure data so the projection is asserted
/// headlessly.
/// </summary>
public sealed record TreeSelectRow
{
    private TreeSelectRow(
        TreeSelectRowKind kind,
        int rowIndex,
        int level,
        string groupKey,
        string? leafValue,
        string label,
        TreeCheckState checkState,
        bool isExpanded,
        bool isDisabled,
        bool canToggle,
        int selectedCount,
        int visibleCount,
        string accessibleName,
        string toggleName,
        string automationId)
    {
        Kind = kind;
        RowIndex = rowIndex;
        Level = level;
        GroupKey = groupKey;
        LeafValue = leafValue;
        Label = label;
        CheckState = checkState;
        IsExpanded = isExpanded;
        IsDisabled = isDisabled;
        CanToggle = canToggle;
        SelectedCount = selectedCount;
        VisibleCount = visibleCount;
        AccessibleName = accessibleName;
        ToggleName = toggleName;
        AutomationId = automationId;
    }

    /// <summary>Which arm of the flat sequence the row belongs to.</summary>
    public TreeSelectRowKind Kind { get; }

    /// <summary>The row's position in the flat focusable sequence (web <c>data-tree-row-index</c>).</summary>
    public int RowIndex { get; }

    /// <summary>The WAI-ARIA level — 1 for a group, 2 for a leaf (web <c>aria-level</c>).</summary>
    public int Level { get; }

    /// <summary>The owning group's key.</summary>
    public string GroupKey { get; }

    /// <summary>The leaf value for a leaf row; null for a group row.</summary>
    public string? LeafValue { get; }

    /// <summary>The raw group / leaf label text.</summary>
    public string Label { get; }

    /// <summary>The checkbox tri-state — a group's none/partial/all, or a leaf's binary selected state.</summary>
    public TreeCheckState CheckState { get; }

    /// <summary>Whether a group row is expanded (group rows only; always false for leaves).</summary>
    public bool IsExpanded { get; }

    /// <summary>Whether a leaf row is disabled / uncheckable (leaf rows only; always false for groups).</summary>
    public bool IsDisabled { get; }

    /// <summary>Whether the row's checkbox can be toggled — a group with ≥1 visible-enabled leaf, or an enabled leaf.</summary>
    public bool CanToggle { get; }

    /// <summary>The number of selected leaves in the group (group rows only; web <c>groupSelectedCount</c>).</summary>
    public int SelectedCount { get; }

    /// <summary>The number of visible (filtered) leaves in the group (group rows only; web <c>g.leaves.length</c>).</summary>
    public int VisibleCount { get; }

    /// <summary>The already-localized accessible name Narrator reads for the row.</summary>
    public string AccessibleName { get; }

    /// <summary>The already-localized accessible name for the row's checkbox (group: "Toggle X"; leaf: the label).</summary>
    public string ToggleName { get; }

    /// <summary>The stable automation id (web <c>data-tree-row-index</c> analogue, prefixed by kind + key).</summary>
    public string AutomationId { get; }

    /// <summary>Build a group header row.</summary>
    /// <param name="rowIndex">The flat-sequence position.</param>
    /// <param name="groupKey">The group key.</param>
    /// <param name="label">The raw group label.</param>
    /// <param name="checkState">The group's tri-state over its visible-enabled leaves.</param>
    /// <param name="isExpanded">Whether the group is expanded.</param>
    /// <param name="canToggle">Whether the group has ≥1 visible-enabled leaf (web <c>visibleEnabledLeaves.length > 0</c>).</param>
    /// <param name="selectedCount">Selected leaves among the group's visible leaves.</param>
    /// <param name="visibleCount">The group's visible (filtered) leaf count.</param>
    /// <param name="accessibleName">The localized row accessible name (web group <c>aria-label</c>).</param>
    /// <param name="toggleName">The localized checkbox accessible name (web <c>`Toggle ${label}`</c>).</param>
    public static TreeSelectRow Group(
        int rowIndex,
        string groupKey,
        string label,
        TreeCheckState checkState,
        bool isExpanded,
        bool canToggle,
        int selectedCount,
        int visibleCount,
        string accessibleName,
        string toggleName)
    {
        ArgumentNullException.ThrowIfNull(groupKey);
        ArgumentNullException.ThrowIfNull(label);
        return new TreeSelectRow(
            TreeSelectRowKind.Group,
            rowIndex,
            level: 1,
            groupKey,
            leafValue: null,
            label,
            checkState,
            isExpanded,
            isDisabled: false,
            canToggle,
            selectedCount,
            visibleCount,
            accessibleName,
            toggleName,
            automationId: "tree-select-group-" + groupKey);
    }

    /// <summary>Build a leaf row.</summary>
    /// <param name="rowIndex">The flat-sequence position.</param>
    /// <param name="groupKey">The owning group's key.</param>
    /// <param name="leafValue">The leaf value.</param>
    /// <param name="label">The raw leaf label.</param>
    /// <param name="isSelected">Whether the leaf is selected.</param>
    /// <param name="isDisabled">Whether the leaf is disabled / uncheckable.</param>
    /// <param name="accessibleName">The localized row accessible name (web leaf <c>aria-label</c>, with any disabled reason).</param>
    public static TreeSelectRow Leaf(
        int rowIndex,
        string groupKey,
        string leafValue,
        string label,
        bool isSelected,
        bool isDisabled,
        string accessibleName)
    {
        ArgumentNullException.ThrowIfNull(groupKey);
        ArgumentNullException.ThrowIfNull(leafValue);
        ArgumentNullException.ThrowIfNull(label);
        return new TreeSelectRow(
            TreeSelectRowKind.Leaf,
            rowIndex,
            level: 2,
            groupKey,
            leafValue,
            label,
            isSelected ? TreeCheckState.Checked : TreeCheckState.Unchecked,
            isExpanded: false,
            isDisabled,
            canToggle: !isDisabled,
            selectedCount: 0,
            visibleCount: 0,
            accessibleName,
            toggleName: accessibleName,
            automationId: "tree-select-leaf-" + leafValue);
    }
}

/// <summary>
/// Pure tree-filter + tri-state helpers shared by the view-model and its tests — the native port of the web
/// module functions (<c>TreeSelect.tsx</c> <c>filterGroups</c> L104-L117 and the per-group tri-state derivations
/// L496-L504). Kept UI-free so the projection is unit-tested without a XAML host or a live view-model.
/// </summary>
public static class TreeSelectProjection
{
    /// <summary>
    /// Filter <paramref name="groups"/> by the search <paramref name="needle"/> — the native port of the web
    /// <c>filterGroups</c> (<c>TreeSelect.tsx</c> L104-L117). Case-insensitive substring against the leaf label;
    /// a group whose own label matches keeps all its leaves, otherwise only its matching leaves; groups with zero
    /// matches are dropped. Returns the original <paramref name="groups"/> reference when the needle is blank so
    /// an unfiltered tree keeps cheap reference equality (web memo parity).
    /// </summary>
    public static IReadOnlyList<TreeGroup> FilterGroups(IReadOnlyList<TreeGroup> groups, string? needle)
    {
        ArgumentNullException.ThrowIfNull(groups);
        string q = (needle ?? string.Empty).Trim();
        if (q.Length == 0)
        {
            return groups;
        }

        var outGroups = new List<TreeGroup>(groups.Count);
        foreach (TreeGroup g in groups)
        {
            bool groupMatches = g.Label.Contains(q, StringComparison.CurrentCultureIgnoreCase);
            IReadOnlyList<TreeLeaf> leaves = groupMatches
                ? g.Leaves
                : g.Leaves.Where(l => l.Label.Contains(q, StringComparison.CurrentCultureIgnoreCase)).ToList();
            if (leaves.Count == 0)
            {
                continue;
            }

            outGroups.Add(groupMatches ? g : new TreeGroup(g.Key, g.Label, leaves));
        }

        return outGroups;
    }

    /// <summary>
    /// The tri-state of a group over its visible-enabled leaves — the native port of the web
    /// <c>allGroupSelected</c> / <c>someGroupSelected</c> derivation (<c>TreeSelect.tsx</c> L501-L504): all when
    /// every visible-enabled leaf is selected (and there is at least one), partial when some-but-not-all selected,
    /// none otherwise.
    /// </summary>
    /// <param name="group">The (already-filtered) group.</param>
    /// <param name="isSelected">Predicate: whether a leaf value is selected.</param>
    /// <param name="isDisabled">Predicate: whether a leaf is disabled.</param>
    public static TreeCheckState GroupState(
        TreeGroup group,
        Func<string, bool> isSelected,
        Func<TreeLeaf, bool> isDisabled)
    {
        ArgumentNullException.ThrowIfNull(group);
        ArgumentNullException.ThrowIfNull(isSelected);
        ArgumentNullException.ThrowIfNull(isDisabled);

        int enabled = 0;
        int enabledSelected = 0;
        int anySelected = 0;
        foreach (TreeLeaf leaf in group.Leaves)
        {
            bool selected = isSelected(leaf.Value);
            if (selected)
            {
                anySelected++;
            }

            if (!isDisabled(leaf))
            {
                enabled++;
                if (selected)
                {
                    enabledSelected++;
                }
            }
        }

        bool all = enabled > 0 && enabledSelected == enabled;
        if (all)
        {
            return TreeCheckState.Checked;
        }

        // web someGroupSelected = groupSelectedCount > 0 && !allGroupSelected — any selected leaf (incl. disabled).
        return anySelected > 0 ? TreeCheckState.Indeterminate : TreeCheckState.Unchecked;
    }
}

/// <summary>
/// PII-safe diagnostics for the tree multi-select surface (P1/S11 diagnostics contract). A tree picker's labels
/// carry user-facing content (signal names, category labels), so the collector records ONLY the operational
/// <see cref="RecordViewOpened"/> signal with the surface slug — never the catalog, the labels, or the
/// selection. Thread-safe; mirrors the shipped surfaces' diagnostics collectors.
/// </summary>
public sealed class TreeSelectDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional sink the operational event line is written to.</param>
    public TreeSelectDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=TreeSelect</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={TreeSelectRegistration.Slug}");
    }
}
