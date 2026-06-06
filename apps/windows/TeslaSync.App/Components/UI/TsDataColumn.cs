using Microsoft.UI.Xaml;

namespace TeslaSync.App.Components.UI;

/// <summary>
/// Declarative column definition consumed by <see cref="TsDataTable"/>. Mirrors
/// the web table's column descriptor: a stable <see cref="Key"/> into each row's
/// value map, a localized <see cref="Header"/>, and per-column sort/resize/
/// visibility capabilities. Width and visibility are observable so the resizer
/// and column chooser can mutate them live.
/// </summary>
public partial class TsDataColumn : DependencyObject
{
    public static readonly DependencyProperty KeyProperty = DependencyProperty.Register(
        nameof(Key), typeof(string), typeof(TsDataColumn), new PropertyMetadata(string.Empty));

    public static readonly DependencyProperty HeaderProperty = DependencyProperty.Register(
        nameof(Header), typeof(string), typeof(TsDataColumn), new PropertyMetadata(null, OnChanged));

    public static readonly DependencyProperty WidthProperty = DependencyProperty.Register(
        nameof(Width), typeof(double), typeof(TsDataColumn), new PropertyMetadata(160.0, OnChanged));

    public static readonly DependencyProperty MinWidthProperty = DependencyProperty.Register(
        nameof(MinWidth), typeof(double), typeof(TsDataColumn), new PropertyMetadata(60.0));

    public static readonly DependencyProperty CanSortProperty = DependencyProperty.Register(
        nameof(CanSort), typeof(bool), typeof(TsDataColumn), new PropertyMetadata(true, OnChanged));

    public static readonly DependencyProperty CanResizeProperty = DependencyProperty.Register(
        nameof(CanResize), typeof(bool), typeof(TsDataColumn), new PropertyMetadata(true, OnChanged));

    public static readonly DependencyProperty IsVisibleProperty = DependencyProperty.Register(
        nameof(IsVisible), typeof(bool), typeof(TsDataColumn), new PropertyMetadata(true, OnChanged));

    public static readonly DependencyProperty IsNumericProperty = DependencyProperty.Register(
        nameof(IsNumeric), typeof(bool), typeof(TsDataColumn), new PropertyMetadata(false));

    /// <summary>Raised when a render-affecting property changes.</summary>
    public event EventHandler? Changed;

    /// <summary>Row value-map key this column reads.</summary>
    public string Key
    {
        get => (string)GetValue(KeyProperty);
        set => SetValue(KeyProperty, value);
    }

    /// <summary>Localized header label.</summary>
    public string? Header
    {
        get => (string?)GetValue(HeaderProperty);
        set => SetValue(HeaderProperty, value);
    }

    /// <summary>Current column width in pixels.</summary>
    public double Width
    {
        get => (double)GetValue(WidthProperty);
        set => SetValue(WidthProperty, value);
    }

    /// <summary>Smallest width the resizer allows.</summary>
    public double MinWidth
    {
        get => (double)GetValue(MinWidthProperty);
        set => SetValue(MinWidthProperty, value);
    }

    public bool CanSort
    {
        get => (bool)GetValue(CanSortProperty);
        set => SetValue(CanSortProperty, value);
    }

    public bool CanResize
    {
        get => (bool)GetValue(CanResizeProperty);
        set => SetValue(CanResizeProperty, value);
    }

    public bool IsVisible
    {
        get => (bool)GetValue(IsVisibleProperty);
        set => SetValue(IsVisibleProperty, value);
    }

    /// <summary>Right-aligns the cell and sorts values numerically.</summary>
    public bool IsNumeric
    {
        get => (bool)GetValue(IsNumericProperty);
        set => SetValue(IsNumericProperty, value);
    }

    private static void OnChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsDataColumn)d).Changed?.Invoke(d, EventArgs.Empty);
}
