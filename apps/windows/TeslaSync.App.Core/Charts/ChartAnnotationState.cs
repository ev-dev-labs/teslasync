using System.ComponentModel;

namespace TeslaSync.App.Core.Charts;

/// <summary>
/// Owns the mutable set of user annotations on a chart (mirrors the web
/// AnnotationList / AddAnnotationPopover behaviour). Supports add / remove /
/// update with stable ordering so the WinUI annotation layer and list stay in
/// sync. UI-thread-free and testable.
/// </summary>
public sealed class ChartAnnotationState : INotifyPropertyChanged
{
    private readonly List<ChartAnnotation> _items = [];

    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current annotations in insertion order.</summary>
    public IReadOnlyList<ChartAnnotation> Items => _items;

    /// <summary>Adds an annotation, replacing any existing one with the same id.</summary>
    public void Add(ChartAnnotation annotation)
    {
        ArgumentNullException.ThrowIfNull(annotation);
        var index = _items.FindIndex(a => a.Id == annotation.Id);
        if (index >= 0)
        {
            _items[index] = annotation;
        }
        else
        {
            _items.Add(annotation);
        }

        Raise();
    }

    /// <summary>Removes the annotation with the given id; returns true when removed.</summary>
    public bool Remove(string id)
    {
        ArgumentException.ThrowIfNullOrEmpty(id);
        var index = _items.FindIndex(a => a.Id == id);
        if (index < 0)
        {
            return false;
        }

        _items.RemoveAt(index);
        Raise();
        return true;
    }

    /// <summary>Removes every annotation.</summary>
    public void Clear()
    {
        if (_items.Count == 0)
        {
            return;
        }

        _items.Clear();
        Raise();
    }

    private void Raise() =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Items)));
}
