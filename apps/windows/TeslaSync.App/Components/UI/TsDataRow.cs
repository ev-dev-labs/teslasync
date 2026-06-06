using System.Collections.Generic;
using System.ComponentModel;

namespace TeslaSync.App.Components.UI;

/// <summary>
/// A single row supplied to <see cref="TsDataTable"/>. Cell values are addressed
/// by column key (a loosely-typed value map mirroring the web table's row
/// objects). Carries an identity <see cref="Key"/> for selection plus optional
/// expansion content for the row-detail drawer.
/// </summary>
public sealed class TsDataRow : INotifyPropertyChanged
{
    private bool _isExpanded;

    public TsDataRow(object key, IReadOnlyDictionary<string, object?> values, object? expansionContent = null)
    {
        Key = key ?? throw new ArgumentNullException(nameof(key));
        Values = values ?? throw new ArgumentNullException(nameof(values));
        ExpansionContent = expansionContent;
    }

    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Stable identity used by selection state.</summary>
    public object Key { get; }

    /// <summary>Column-key → cell value map.</summary>
    public IReadOnlyDictionary<string, object?> Values { get; }

    /// <summary>Optional detail content shown when the row is expanded.</summary>
    public object? ExpansionContent { get; }

    /// <summary>Whether the row-detail drawer is open.</summary>
    public bool IsExpanded
    {
        get => _isExpanded;
        set
        {
            if (_isExpanded == value)
            {
                return;
            }

            _isExpanded = value;
            PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(IsExpanded)));
        }
    }

    /// <summary>Returns the cell value for <paramref name="columnKey"/> (null when absent).</summary>
    public object? ValueFor(string columnKey) =>
        Values.TryGetValue(columnKey, out var value) ? value : null;
}
