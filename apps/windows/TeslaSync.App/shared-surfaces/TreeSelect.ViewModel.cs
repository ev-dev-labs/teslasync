using System.ComponentModel;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="TreeSelect"/> view — the native port of the web
/// <c>TreeSelect</c> component body (<c>web/src/components/forms/TreeSelect.tsx</c>). It composes the shared,
/// unit-tested Core selection engine (<see cref="TreeSelectModel"/>, P1/S8) for the leaf selection + group
/// expansion state rather than re-implementing it, and layers on the web source's presentation logic: the search
/// filter that narrows the tree without flattening it (<see cref="TreeSelectProjection.FilterGroups"/>); the
/// per-group tri-state over visible-enabled leaves; the header tri-state "select visible" with its
/// Select/Clear-all (+ "{{count}} visible") label, the selected/visible counts and the clear-all action; per-leaf
/// disabled state; the four-branch body state matrix (loading skeleton / empty catalog / no search results /
/// populated tree); the flat <see cref="TreeSelectRow"/> projection a future virtualization wrapper can drop into;
/// and the roving-tabindex keyboard model (move / Home / End / expand / collapse / focus-parent / toggle).
///
/// <para>
/// Selection is independent of the search filter (web parity): selected leaves stay selected when filtered out of
/// view, and the group / select-visible toggles only ever touch currently-visible, enabled leaves. The view binds
/// the projected state, rebuilds its rows on <see cref="PropertyChanged"/> and moves focus on
/// <see cref="FocusMoved"/>, and performs no I/O. Drive it from one confinement (the UI thread).
/// </para>
/// </summary>
public sealed class TreeSelectViewModel : INotifyPropertyChanged, IDisposable
{
    private static readonly PropertyChangedEventArgs AllProperties = new(string.Empty);
    private static readonly IReadOnlyList<TreeSelectRow> NoRows = Array.Empty<TreeSelectRow>();
    private static readonly IReadOnlyList<string> NoValues = Array.Empty<string>();

    private readonly TreeSelectModel _model;
    private readonly IReadOnlyList<TreeGroup> _groups;
    private readonly ILocalizer _localizer;
    private readonly Func<TreeLeaf, bool>? _getLeafDisabled;
    private readonly Func<TreeLeaf, string?>? _getLeafDisabledReason;
    private readonly int _totalLeafCount;

    private string _search;
    private bool _isLoading;
    private int _focusIndex;
    private bool _suppressRecompute;
    private bool _disposed;

    private IReadOnlyList<TreeGroup> _filtered = Array.Empty<TreeGroup>();
    private IReadOnlyList<string> _visibleLeafValues = NoValues;
    private IReadOnlyList<TreeSelectRow> _rows = NoRows;
    private int _visibleSelectedCount;

    /// <summary>Creates the holder over the catalog, the i18n facade and the optional presentation seams.</summary>
    /// <param name="groups">The full group catalog (web <c>groups</c> prop). The search filter narrows it in-component.</param>
    /// <param name="localizer">The i18n facade every label resolves through (P1/S10).</param>
    /// <param name="initialSelection">The initially-selected leaf values (web <c>selectedIds</c> prop); null selects none.</param>
    /// <param name="searchValue">The initial search box value (web <c>searchValue</c> prop).</param>
    /// <param name="isLoading">Whether the catalog is loading — renders the skeleton (web <c>isLoading</c> prop).</param>
    /// <param name="expandedByDefault">Whether groups start expanded; the web default is collapsed (<c>false</c>).</param>
    /// <param name="getLeafDisabled">Predicate marking a leaf visible-but-uncheckable (web <c>getLeafDisabled</c> prop).</param>
    /// <param name="getLeafDisabledReason">Tooltip / sr-only reason for a disabled leaf (web <c>getLeafDisabledReason</c> prop).</param>
    public TreeSelectViewModel(
        IReadOnlyList<TreeGroup> groups,
        ILocalizer localizer,
        IReadOnlyList<string>? initialSelection = null,
        string searchValue = "",
        bool isLoading = false,
        bool expandedByDefault = false,
        Func<TreeLeaf, bool>? getLeafDisabled = null,
        Func<TreeLeaf, string?>? getLeafDisabledReason = null)
    {
        ArgumentNullException.ThrowIfNull(groups);
        ArgumentNullException.ThrowIfNull(localizer);

        _groups = groups;
        _localizer = localizer;
        _getLeafDisabled = getLeafDisabled;
        _getLeafDisabledReason = getLeafDisabledReason;
        _search = searchValue ?? string.Empty;
        _isLoading = isLoading;
        _totalLeafCount = groups.Sum(g => g.Leaves.Count);
        _model = new TreeSelectModel(groups, expandedByDefault);

        // Seed the initial selection through the Core engine without re-projecting per leaf (web `selectedIds`).
        if (initialSelection is { Count: > 0 })
        {
            _suppressRecompute = true;
            var known = new HashSet<string>(_groups.SelectMany(g => g.Leaves).Select(l => l.Value), StringComparer.Ordinal);
            foreach (string value in initialSelection)
            {
                if (known.Contains(value) && !_model.IsSelected(value))
                {
                    _model.ToggleLeaf(value);
                }
            }

            _suppressRecompute = false;
        }

        _model.PropertyChanged += OnModelChanged;
        Recompute();
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised when the committed selection changes (web <c>onChange(next)</c>) with the new selected values.</summary>
    public event EventHandler<IReadOnlyList<string>>? SelectionChanged;

    /// <summary>Raised when only the roving-focus row changes (no row rebuild) — the view moves XAML focus to the index.</summary>
    public event EventHandler<int>? FocusMoved;

    /// <summary>The canonical diagnostics slug this surface registers under (<c>TreeSelect</c>).</summary>
    public static string Slug => TreeSelectRegistration.Slug;

    // ── Catalog + selection value ────────────────────────────────────────────────────────────────────────

    /// <summary>The full group catalog (web <c>groups</c>).</summary>
    public IReadOnlyList<TreeGroup> Groups => _groups;

    /// <summary>The selected leaf values in stable tree order (web <c>selectedIds</c>).</summary>
    public IReadOnlyList<string> SelectedValues => _model.SelectedValues;

    /// <summary>The number of selected leaves across the whole catalog (web <c>selectedIds.length</c>).</summary>
    public int SelectedCount => _model.SelectedCount;

    /// <summary>The total number of leaves in the catalog (web <c>totalLeafCount</c>).</summary>
    public int TotalLeafCount => _totalLeafCount;

    // ── Search ───────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>The search box value (web controlled <c>searchValue</c>); setting it re-filters the tree.</summary>
    public string Search
    {
        get => _search;
        set => SetSearch(value);
    }

    /// <summary>Whether a search filter is active (web <c>isSearching = searchValue.trim().length > 0</c>).</summary>
    public bool IsSearching => _search.Trim().Length > 0;

    /// <summary>Whether the clear-search (×) affordance is shown (web <c>searchValue ? … : undefined</c>).</summary>
    public bool ShowClearSearch => _search.Length > 0;

    /// <summary>Replace the search value (web <c>onSearchChange</c>); re-filters the tree and clamps focus.</summary>
    /// <param name="value">The next search value; null is treated as empty.</param>
    public void SetSearch(string? value)
    {
        string next = value ?? string.Empty;
        if (string.Equals(_search, next, StringComparison.Ordinal))
        {
            return;
        }

        _search = next;
        Recompute();
    }

    /// <summary>Clear the search box (web clear-search <c>onClick</c>).</summary>
    public void ClearSearch() => SetSearch(string.Empty);

    // ── Loading ──────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>Whether the catalog is loading — renders the skeleton (web <c>isLoading</c>).</summary>
    public bool IsLoading
    {
        get => _isLoading;
        set
        {
            if (_isLoading == value)
            {
                return;
            }

            _isLoading = value;
            Recompute();
        }
    }

    // ── Body state matrix ────────────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Which body branch renders — the native projection of the web body branches (<c>TreeSelect.tsx</c>
    /// L468-L637): the skeleton while loading, the empty text when the catalog has no groups, the no-results
    /// text when the filter eliminated every group, otherwise the populated tree.
    /// </summary>
    public TreeSelectVisualState VisualState
    {
        get
        {
            if (_isLoading)
            {
                return TreeSelectVisualState.Loading;
            }

            if (_groups.Count == 0)
            {
                return TreeSelectVisualState.Empty;
            }

            return _filtered.Count == 0 ? TreeSelectVisualState.NoResults : TreeSelectVisualState.Populated;
        }
    }

    /// <summary>The flat, render-ready row sequence (web flat <c>role="treeitem"</c> sequence). Empty unless populated.</summary>
    public IReadOnlyList<TreeSelectRow> Rows => _rows;

    /// <summary>The filtered group count (web <c>filtered.length</c>); zero triggers the no-results branch.</summary>
    public int FilteredGroupCount => _filtered.Count;

    /// <summary>The number of visible (filtered) leaves (web <c>visibleLeafIds.length</c>).</summary>
    public int VisibleLeafCount => _visibleLeafValues.Count;

    // ── Header select-all + counts ───────────────────────────────────────────────────────────────────────

    /// <summary>The number of visible leaves that are selected (web <c>visibleSelectedCount</c>).</summary>
    public int VisibleSelectedCount => _visibleSelectedCount;

    /// <summary>Whether every visible leaf is selected (web <c>allVisibleSelected</c>).</summary>
    public bool AllVisibleSelected => _visibleLeafValues.Count > 0 && _visibleSelectedCount == _visibleLeafValues.Count;

    /// <summary>Whether some-but-not-all visible leaves are selected (web <c>someVisibleSelected</c>).</summary>
    public bool SomeVisibleSelected => _visibleSelectedCount > 0 && !AllVisibleSelected;

    /// <summary>The header select-all checkbox tri-state (web <c>checked</c> / <c>indeterminate</c>).</summary>
    public TreeCheckState HeaderCheckState => AllVisibleSelected
        ? TreeCheckState.Checked
        : SomeVisibleSelected ? TreeCheckState.Indeterminate : TreeCheckState.Unchecked;

    /// <summary>Whether the header select-all checkbox is enabled (web <c>disabled={visibleLeafIds.length === 0}</c>).</summary>
    public bool HeaderCanToggle => _visibleLeafValues.Count > 0;

    /// <summary>Whether the clear-all-selected action is shown (web <c>selectedIds.length > 0</c>).</summary>
    public bool ShowClearAllSelected => _model.SelectedCount > 0;

    // ── Roving focus ─────────────────────────────────────────────────────────────────────────────────────

    /// <summary>The roving-tabindex focus row index (web <c>focusIndex</c>); the only tab stop in the tree body.</summary>
    public int FocusIndex => _focusIndex;

    /// <summary>The currently-focused row, or null when the tree has no rows.</summary>
    public TreeSelectRow? FocusedRow => _focusIndex >= 0 && _focusIndex < _rows.Count ? _rows[_focusIndex] : null;

    // ── Localized chrome labels ──────────────────────────────────────────────────────────────────────────

    /// <summary>The search box hint (web search box hint).</summary>
    public string SearchHint => TreeSelectRegistration.SearchHint(_localizer);

    /// <summary>The search box accessible name (web search <c>aria-label</c>).</summary>
    public string FilterAria => TreeSelectRegistration.FilterAria(_localizer);

    /// <summary>The clear-search button accessible name (web <c>aria-label="Clear search"</c>).</summary>
    public string ClearSearchLabel => TreeSelectRegistration.ClearSearch(_localizer);

    /// <summary>The header select-all label (web <c>selectAllLabel</c>): Select/Clear all, or Select/Clear N visible.</summary>
    public string SelectAllLabel =>
        TreeSelectRegistration.SelectAllLabel(_localizer, IsSearching, AllVisibleSelected, _visibleLeafValues.Count);

    /// <summary>The header selected-count chip (web count span): "{{count}} selected" (+ " of {{total}}" while searching).</summary>
    public string SelectedSummary =>
        TreeSelectRegistration.SelectedSummary(_localizer, _model.SelectedCount, _totalLeafCount, IsSearching);

    /// <summary>The clear-all-selected action label (web <c>'Clear all selected'</c>).</summary>
    public string ClearAllSelectedLabel => TreeSelectRegistration.ClearAllSelected(_localizer);

    /// <summary>The tree body accessible name (web <c>ariaLabel</c>).</summary>
    public string TreeLabel => TreeSelectRegistration.TreeLabel(_localizer);

    /// <summary>The loading skeleton's sr-only status (web <c>VisuallyHidden "Loading…"</c>).</summary>
    public string LoadingLabel => TreeSelectRegistration.Loading(_localizer);

    /// <summary>The empty-catalog body text (web <c>emptyState ?? 'No items available.'</c>).</summary>
    public string EmptyLabel => TreeSelectRegistration.Empty(_localizer);

    /// <summary>The no-search-results body text (web <c>noResultsState ?? `No matches for "${q}".`</c>).</summary>
    public string NoResultsLabel => TreeSelectRegistration.NoResults(_localizer, _search.Trim());

    /// <summary>The sr-only live summary (web <c>VisuallyHidden aria-live</c> summary).</summary>
    public string Summary => TreeSelectRegistration.Summary(
        _localizer, _model.SelectedCount, _totalLeafCount, _visibleLeafValues.Count, IsSearching);

    // ── Selection mutations ──────────────────────────────────────────────────────────────────────────────

    /// <summary>Toggle a single leaf (web <c>toggleLeaf</c>); a no-op when the leaf is disabled or unknown.</summary>
    /// <param name="value">The leaf value to toggle.</param>
    public void ToggleLeaf(string value)
    {
        ArgumentNullException.ThrowIfNull(value);
        TreeLeaf? leaf = FindLeaf(value);
        if (leaf is null || IsLeafDisabled(leaf))
        {
            return;
        }

        _model.ToggleLeaf(value);
        RaiseSelectionChanged();
    }

    /// <summary>
    /// Toggle a group over its visible-enabled leaves (web <c>toggleGroup</c>): if every visible-enabled leaf is
    /// selected, clear them; otherwise select all visible-enabled leaves. Selection of leaves filtered out of view
    /// is preserved. A no-op when the group has no visible-enabled leaf.
    /// </summary>
    /// <param name="groupKey">The group key to toggle.</param>
    public void ToggleGroupVisible(string groupKey)
    {
        ArgumentNullException.ThrowIfNull(groupKey);
        TreeGroup? group = _filtered.FirstOrDefault(g => string.Equals(g.Key, groupKey, StringComparison.Ordinal));
        if (group is null)
        {
            return;
        }

        var enabled = group.Leaves.Where(l => !IsLeafDisabled(l)).Select(l => l.Value).ToList();
        ApplyVisibleToggle(enabled);
    }

    /// <summary>
    /// Toggle every visible-enabled leaf across all filtered groups (web <c>toggleAllVisible</c> / "Select
    /// visible"): clear them when all are selected, otherwise select them all. A no-op when nothing is
    /// visible-enabled.
    /// </summary>
    public void ToggleAllVisible()
    {
        var enabled = new List<string>(_visibleLeafValues.Count);
        foreach (TreeGroup group in _filtered)
        {
            foreach (TreeLeaf leaf in group.Leaves)
            {
                if (!IsLeafDisabled(leaf))
                {
                    enabled.Add(leaf.Value);
                }
            }
        }

        ApplyVisibleToggle(enabled);
    }

    /// <summary>Clear every selection (web <c>clearAll</c> / <c>onChange([])</c>).</summary>
    public void ClearAllSelected()
    {
        if (_model.SelectedCount == 0)
        {
            return;
        }

        _model.Clear();
        RaiseSelectionChanged();
    }

    // ── Expansion ────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>Whether a group renders expanded (web <c>isExpanded = isSearching || expandedIds.includes(id)</c>).</summary>
    /// <param name="groupKey">The group key.</param>
    public bool IsRowExpanded(string groupKey)
    {
        ArgumentNullException.ThrowIfNull(groupKey);
        return IsSearching || _model.IsExpanded(groupKey);
    }

    /// <summary>
    /// Expand or collapse a group (web <c>toggleExpanded</c>); a no-op while searching, because expansion is
    /// computed (everything open) so flipping it would have no visible effect.
    /// </summary>
    /// <param name="groupKey">The group key to toggle.</param>
    public void ToggleExpanded(string groupKey)
    {
        ArgumentNullException.ThrowIfNull(groupKey);
        if (IsSearching)
        {
            return;
        }

        _model.ToggleExpanded(groupKey);
    }

    // ── Roving keyboard model (web handleKeyDown, L313-L378) ─────────────────────────────────────────────

    /// <summary>Set the focus row directly (web row <c>onFocus</c> / <c>onClick</c> sets <c>focusIndex</c>).</summary>
    /// <param name="index">The target row index; clamped to the current rows.</param>
    public void SetFocusIndex(int index)
    {
        int clamped = Clamp(index);
        if (clamped == _focusIndex)
        {
            return;
        }

        _focusIndex = clamped;
        FocusMoved?.Invoke(this, _focusIndex);
    }

    /// <summary>Move focus to the next row (web ArrowDown).</summary>
    public void FocusNext()
    {
        if (_focusIndex + 1 < _rows.Count)
        {
            SetFocusIndex(_focusIndex + 1);
        }
    }

    /// <summary>Move focus to the previous row (web ArrowUp).</summary>
    public void FocusPrevious()
    {
        if (_focusIndex > 0)
        {
            SetFocusIndex(_focusIndex - 1);
        }
    }

    /// <summary>Move focus to the first row (web Home).</summary>
    public void FocusFirst() => SetFocusIndex(0);

    /// <summary>Move focus to the last row (web End).</summary>
    public void FocusLast() => SetFocusIndex(_rows.Count - 1);

    /// <summary>Expand the focused group if it is collapsed (web ArrowRight on a collapsed group).</summary>
    public void ExpandFocused()
    {
        if (FocusedRow is { Kind: TreeSelectRowKind.Group } row && !IsRowExpanded(row.GroupKey))
        {
            ToggleExpanded(row.GroupKey);
        }
    }

    /// <summary>
    /// Collapse the focused expanded group, or move focus to a leaf's parent group (web ArrowLeft): on an
    /// expanded group (and not while searching) collapse it; on a leaf focus its parent group row.
    /// </summary>
    public void CollapseOrFocusParent()
    {
        if (FocusedRow is not { } row)
        {
            return;
        }

        if (row.Kind == TreeSelectRowKind.Group)
        {
            if (IsRowExpanded(row.GroupKey) && !IsSearching)
            {
                ToggleExpanded(row.GroupKey);
            }

            return;
        }

        int parentIndex = IndexOfGroupRow(row.GroupKey);
        if (parentIndex >= 0)
        {
            SetFocusIndex(parentIndex);
        }
    }

    /// <summary>Toggle the focused row's selection (web Space): a group's visible-enabled leaves, or an enabled leaf.</summary>
    public void ToggleSelectionAtFocus()
    {
        if (FocusedRow is not { } row)
        {
            return;
        }

        if (row.Kind == TreeSelectRowKind.Group)
        {
            ToggleGroupVisible(row.GroupKey);
        }
        else if (row.LeafValue is { } value && !row.IsDisabled)
        {
            ToggleLeaf(value);
        }
    }

    /// <summary>Toggle the focused group's expansion (web Enter on a group); a no-op on a leaf.</summary>
    public void ToggleExpansionAtFocus()
    {
        if (FocusedRow is { Kind: TreeSelectRowKind.Group } row)
        {
            ToggleExpanded(row.GroupKey);
        }
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _model.PropertyChanged -= OnModelChanged;
    }

    // ── Internals ────────────────────────────────────────────────────────────────────────────────────────

    private void ApplyVisibleToggle(List<string> enabledValues)
    {
        if (enabledValues.Count == 0)
        {
            return;
        }

        bool allSelected = enabledValues.All(_model.IsSelected);

        _suppressRecompute = true;
        foreach (string value in enabledValues)
        {
            bool selected = _model.IsSelected(value);
            // Select all when not all are selected; clear all when every one is selected (web set semantics).
            if (allSelected ? selected : !selected)
            {
                _model.ToggleLeaf(value);
            }
        }

        _suppressRecompute = false;
        Recompute();
        RaiseSelectionChanged();
    }

    private void OnModelChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (_suppressRecompute)
        {
            return;
        }

        Recompute();
    }

    private void Recompute()
    {
        if (_suppressRecompute)
        {
            return;
        }

        _filtered = TreeSelectProjection.FilterGroups(_groups, _search);

        var visible = new List<string>();
        int visibleSelected = 0;
        foreach (TreeGroup group in _filtered)
        {
            foreach (TreeLeaf leaf in group.Leaves)
            {
                visible.Add(leaf.Value);
                if (_model.IsSelected(leaf.Value))
                {
                    visibleSelected++;
                }
            }
        }

        _visibleLeafValues = visible;
        _visibleSelectedCount = visibleSelected;
        _rows = BuildRows();
        _focusIndex = Clamp(_focusIndex);
        PropertyChanged?.Invoke(this, AllProperties);
    }

    private IReadOnlyList<TreeSelectRow> BuildRows()
    {
        if (_isLoading || _filtered.Count == 0)
        {
            return NoRows;
        }

        var rows = new List<TreeSelectRow>();
        foreach (TreeGroup group in _filtered)
        {
            int selectedInGroup = group.Leaves.Count(l => _model.IsSelected(l.Value));
            bool canToggle = group.Leaves.Any(l => !IsLeafDisabled(l));
            TreeCheckState state = TreeSelectProjection.GroupState(group, _model.IsSelected, IsLeafDisabled);
            string accessibleName = TreeSelectRegistration.GroupAria(
                _localizer, group.Label, selectedInGroup, group.Leaves.Count);
            string toggleName = TreeSelectRegistration.GroupToggle(_localizer, group.Label);
            bool expanded = IsRowExpanded(group.Key);

            rows.Add(TreeSelectRow.Group(
                rows.Count, group.Key, group.Label, state, expanded, canToggle,
                selectedInGroup, group.Leaves.Count, accessibleName, toggleName));

            if (!expanded)
            {
                continue;
            }

            foreach (TreeLeaf leaf in group.Leaves)
            {
                bool disabled = IsLeafDisabled(leaf);
                string? reason = disabled ? _getLeafDisabledReason?.Invoke(leaf) : null;
                string name = TreeSelectRegistration.LeafName(_localizer, leaf.Label, reason);
                rows.Add(TreeSelectRow.Leaf(
                    rows.Count, group.Key, leaf.Value, leaf.Label, _model.IsSelected(leaf.Value), disabled, name));
            }
        }

        return rows;
    }

    private int IndexOfGroupRow(string groupKey)
    {
        for (int i = 0; i < _rows.Count; i++)
        {
            TreeSelectRow row = _rows[i];
            if (row.Kind == TreeSelectRowKind.Group && string.Equals(row.GroupKey, groupKey, StringComparison.Ordinal))
            {
                return i;
            }
        }

        return -1;
    }

    private int Clamp(int index)
    {
        if (_rows.Count == 0)
        {
            return 0;
        }

        if (index < 0)
        {
            return 0;
        }

        return index >= _rows.Count ? _rows.Count - 1 : index;
    }

    private bool IsLeafDisabled(TreeLeaf leaf) => _getLeafDisabled?.Invoke(leaf) ?? false;

    private TreeLeaf? FindLeaf(string value)
    {
        foreach (TreeGroup group in _groups)
        {
            foreach (TreeLeaf leaf in group.Leaves)
            {
                if (string.Equals(leaf.Value, value, StringComparison.Ordinal))
                {
                    return leaf;
                }
            }
        }

        return null;
    }

    private void RaiseSelectionChanged() => SelectionChanged?.Invoke(this, _model.SelectedValues);
}
