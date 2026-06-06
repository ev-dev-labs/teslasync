using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Core;

namespace TeslaSync.App.Components.UI;

/// <summary>
/// Contextual action bar shown above <see cref="TsDataTable"/> when one or more
/// rows are selected (mirrors the web bulk bar). Displays the selection count via
/// a consumer-supplied composite format and hosts caller-provided bulk-action
/// content. Collapses itself when the count is zero.
/// </summary>
public partial class TsDataTableBulkBar : ContentControl
{
    private readonly TextBlock _summary = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsButton _clear = new() { Variant = ButtonVariant.Subtle, IconGlyph = "\uE711" };
    private readonly StackPanel _actionsHost = new() { Orientation = Orientation.Horizontal, Spacing = 8 };
    private readonly Border _surface;

    public static readonly DependencyProperty SelectedCountProperty = DependencyProperty.Register(
        nameof(SelectedCount), typeof(int), typeof(TsDataTableBulkBar),
        new PropertyMetadata(0, OnVisualChanged));

    public static readonly DependencyProperty CountFormatProperty = DependencyProperty.Register(
        nameof(CountFormat), typeof(string), typeof(TsDataTableBulkBar),
        new PropertyMetadata("{0}", OnVisualChanged));

    public static readonly DependencyProperty ActionsProperty = DependencyProperty.Register(
        nameof(Actions), typeof(object), typeof(TsDataTableBulkBar),
        new PropertyMetadata(null, OnActionsChanged));

    public static readonly DependencyProperty ClearLabelProperty = DependencyProperty.Register(
        nameof(ClearLabel), typeof(string), typeof(TsDataTableBulkBar),
        new PropertyMetadata(null, OnVisualChanged));

    public TsDataTableBulkBar()
    {
        IsTabStop = false;
        var panel = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
        panel.Children.Add(_summary);
        panel.Children.Add(_actionsHost);
        panel.Children.Add(_clear);

        _surface = new Border
        {
            Child = panel,
            Padding = new Thickness(12, 6, 12, 6),
            CornerRadius = new CornerRadius(8),
            Background = (Brush)Application.Current.Resources["TsColorSurfaceGlassBrush"],
            BorderBrush = (Brush)Application.Current.Resources["TsColorBorderBrush"],
            BorderThickness = new Thickness(1),
        };
        Content = _surface;

        _clear.Click += (s, e) => SelectionCleared?.Invoke(this, EventArgs.Empty);
        Render();
    }

    /// <summary>Raised when the user clears the current selection.</summary>
    public event EventHandler? SelectionCleared;

    public int SelectedCount
    {
        get => (int)GetValue(SelectedCountProperty);
        set => SetValue(SelectedCountProperty, value);
    }

    /// <summary>Composite format string; <c>{0}</c> is the selected-row count.</summary>
    public string CountFormat
    {
        get => (string)GetValue(CountFormatProperty);
        set => SetValue(CountFormatProperty, value);
    }

    /// <summary>Caller-provided bulk-action controls.</summary>
    public object? Actions
    {
        get => GetValue(ActionsProperty);
        set => SetValue(ActionsProperty, value);
    }

    /// <summary>Localized accessible name for the clear-selection button.</summary>
    public string? ClearLabel
    {
        get => (string?)GetValue(ClearLabelProperty);
        set => SetValue(ClearLabelProperty, value);
    }

    private static void OnVisualChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsDataTableBulkBar)d).Render();

    private static void OnActionsChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var bar = (TsDataTableBulkBar)d;
        bar._actionsHost.Children.Clear();
        if (e.NewValue is UIElement element)
        {
            bar._actionsHost.Children.Add(element);
        }
    }

    private void Render()
    {
        Visibility = SelectedCount > 0 ? Visibility.Visible : Visibility.Collapsed;
        _summary.Text = string.Format(
            System.Globalization.CultureInfo.CurrentCulture, CountFormat, SelectedCount);

        if (!string.IsNullOrEmpty(ClearLabel))
        {
            AutomationProperties.SetName(_clear, ClearLabel);
            ToolTipService.SetToolTip(_clear, ClearLabel);
        }
    }
}
