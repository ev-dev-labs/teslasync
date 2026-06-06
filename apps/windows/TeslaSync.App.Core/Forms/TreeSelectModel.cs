using System.ComponentModel;

namespace TeslaSync.App.Core.Forms;

/// <summary>A selectable leaf inside a <see cref="TreeGroup"/>.</summary>
public sealed record TreeLeaf(string Value, string Label);

/// <summary>A collapsible group of <see cref="TreeLeaf"/> options.</summary>
public sealed record TreeGroup(string Key, string Label, IReadOnlyList<TreeLeaf> Leaves);

/// <summary>
/// UI-thread-free model for the grouped multi-select (<c>TsTreeSelect</c>).
/// Tracks selection and expand/collapse, and computes per-group tri-state
/// (none / partial / all) so the control renders group checkboxes correctly.
/// </summary>
public sealed class TreeSelectModel : INotifyPropertyChanged
{
    private readonly IReadOnlyList<TreeGroup> _groups;
    private readonly HashSet<string> _selected = new(StringComparer.Ordinal);
    private readonly HashSet<string> _expanded = new(StringComparer.Ordinal);

    public TreeSelectModel(IReadOnlyList<TreeGroup> groups, bool expandedByDefault = true)
    {
        ArgumentNullException.ThrowIfNull(groups);
        _groups = groups;
        if (expandedByDefault)
        {
            foreach (var group in groups)
            {
                _expanded.Add(group.Key);
            }
        }
    }

    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The groups, as supplied.</summary>
    public IReadOnlyList<TreeGroup> Groups => _groups;

    /// <summary>Selected leaf values in stable tree order.</summary>
    public IReadOnlyList<string> SelectedValues =>
        _groups.SelectMany(g => g.Leaves)
            .Where(l => _selected.Contains(l.Value))
            .Select(l => l.Value)
            .ToList();

    /// <summary>Number of selected leaves.</summary>
    public int SelectedCount => _selected.Count;

    /// <summary>Whether a leaf is selected.</summary>
    public bool IsSelected(string value) => _selected.Contains(value);

    /// <summary>Whether a group is expanded.</summary>
    public bool IsExpanded(string groupKey) => _expanded.Contains(groupKey);

    /// <summary>Whether every leaf in a group is selected (false for empty groups).</summary>
    public bool IsGroupFullySelected(string groupKey)
    {
        var group = Find(groupKey);
        return group is not null && group.Leaves.Count > 0 &&
            group.Leaves.All(l => _selected.Contains(l.Value));
    }

    /// <summary>Whether a group has some but not all leaves selected.</summary>
    public bool IsGroupPartiallySelected(string groupKey)
    {
        var group = Find(groupKey);
        if (group is null || group.Leaves.Count == 0)
        {
            return false;
        }

        var count = group.Leaves.Count(l => _selected.Contains(l.Value));
        return count > 0 && count < group.Leaves.Count;
    }

    /// <summary>Toggle a single leaf.</summary>
    public void ToggleLeaf(string value)
    {
        if (!_selected.Remove(value))
        {
            _selected.Add(value);
        }

        RaiseSelection();
    }

    /// <summary>
    /// Toggle a whole group: if fully selected, clear it; otherwise select all
    /// its leaves.
    /// </summary>
    public void ToggleGroup(string groupKey)
    {
        var group = Find(groupKey);
        if (group is null)
        {
            return;
        }

        if (IsGroupFullySelected(groupKey))
        {
            foreach (var leaf in group.Leaves)
            {
                _selected.Remove(leaf.Value);
            }
        }
        else
        {
            foreach (var leaf in group.Leaves)
            {
                _selected.Add(leaf.Value);
            }
        }

        RaiseSelection();
    }

    /// <summary>Expand or collapse a group.</summary>
    public void ToggleExpanded(string groupKey)
    {
        if (!_expanded.Remove(groupKey))
        {
            _expanded.Add(groupKey);
        }

        Raise(nameof(IsExpanded));
    }

    /// <summary>Clear every selection.</summary>
    public void Clear()
    {
        if (_selected.Count == 0)
        {
            return;
        }

        _selected.Clear();
        RaiseSelection();
    }

    private TreeGroup? Find(string groupKey) =>
        _groups.FirstOrDefault(g => string.Equals(g.Key, groupKey, StringComparison.Ordinal));

    private void RaiseSelection()
    {
        Raise(nameof(SelectedValues));
        Raise(nameof(SelectedCount));
    }

    private void Raise(string name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
