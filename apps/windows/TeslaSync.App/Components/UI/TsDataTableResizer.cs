using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Input;

namespace TeslaSync.App.Components.UI;

/// <summary>
/// Column-edge drag handle used by <see cref="TsDataTable"/> headers. Wraps a
/// <see cref="Thumb"/> and mutates the bound <see cref="TsDataColumn.Width"/>
/// (clamped to <see cref="TsDataColumn.MinWidth"/>) while dragging. Also supports
/// keyboard resizing via Left/Right arrows for accessibility.
/// </summary>
public partial class TsDataTableResizer : ContentControl
{
    private const double KeyboardStep = 8;
    private readonly Thumb _thumb = new() { Width = 6, HorizontalAlignment = HorizontalAlignment.Right };

    public static readonly DependencyProperty ColumnProperty = DependencyProperty.Register(
        nameof(Column), typeof(TsDataColumn), typeof(TsDataTableResizer), new PropertyMetadata(null));

    public static readonly DependencyProperty AccessibleNameProperty = DependencyProperty.Register(
        nameof(AccessibleName), typeof(string), typeof(TsDataTableResizer),
        new PropertyMetadata(null, OnAccessibleNameChanged));

    public TsDataTableResizer()
    {
        IsTabStop = false;
        _thumb.IsTabStop = true;
        ProtectedCursor = Microsoft.UI.Input.InputSystemCursor.Create(Microsoft.UI.Input.InputSystemCursorShape.SizeWestEast);
        Content = _thumb;
        _thumb.DragDelta += OnDragDelta;
        _thumb.KeyDown += OnKeyDown;
    }

    public TsDataColumn? Column
    {
        get => (TsDataColumn?)GetValue(ColumnProperty);
        set => SetValue(ColumnProperty, value);
    }

    /// <summary>Localized accessible name for the resize handle.</summary>
    public string? AccessibleName
    {
        get => (string?)GetValue(AccessibleNameProperty);
        set => SetValue(AccessibleNameProperty, value);
    }

    private static void OnAccessibleNameChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var resizer = (TsDataTableResizer)d;
        if (!string.IsNullOrEmpty(resizer.AccessibleName))
        {
            AutomationProperties.SetName(resizer._thumb, resizer.AccessibleName);
        }
    }

    private void OnDragDelta(object sender, DragDeltaEventArgs e)
    {
        if (Column is { CanResize: true } column)
        {
            column.Width = Math.Max(column.MinWidth, column.Width + e.HorizontalChange);
        }
    }

    private void OnKeyDown(object sender, KeyRoutedEventArgs e)
    {
        if (Column is not { CanResize: true } column)
        {
            return;
        }

        if (e.Key == Windows.System.VirtualKey.Left)
        {
            e.Handled = true;
            column.Width = Math.Max(column.MinWidth, column.Width - KeyboardStep);
        }
        else if (e.Key == Windows.System.VirtualKey.Right)
        {
            e.Handled = true;
            column.Width += KeyboardStep;
        }
    }
}
