using System.Collections.Generic;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Core;

namespace TeslaSync.App.Components.UI;

/// <summary>
/// Column-visibility chooser for <see cref="TsDataTable"/> (mirrors the web column
/// chooser). Renders a button that opens a flyout of checkboxes, one per column,
/// toggling each <see cref="TsDataColumn.IsVisible"/>. Labels are consumer-supplied.
/// </summary>
public partial class TsDataTableColumnsMenu : ContentControl
{
    private readonly TsButton _trigger = new() { Variant = ButtonVariant.Subtle, IconGlyph = "\uE71C" };
    private readonly MenuFlyout _flyout = new();

    public static readonly DependencyProperty ColumnsProperty = DependencyProperty.Register(
        nameof(Columns), typeof(IReadOnlyList<TsDataColumn>), typeof(TsDataTableColumnsMenu),
        new PropertyMetadata(null, OnColumnsChanged));

    public static readonly DependencyProperty LabelProperty = DependencyProperty.Register(
        nameof(Label), typeof(string), typeof(TsDataTableColumnsMenu),
        new PropertyMetadata(null, OnLabelChanged));

    public TsDataTableColumnsMenu()
    {
        IsTabStop = false;
        _trigger.Flyout = _flyout;
        Content = _trigger;
    }

    public IReadOnlyList<TsDataColumn>? Columns
    {
        get => (IReadOnlyList<TsDataColumn>?)GetValue(ColumnsProperty);
        set => SetValue(ColumnsProperty, value);
    }

    /// <summary>Localized accessible name / tooltip for the chooser button.</summary>
    public string? Label
    {
        get => (string?)GetValue(LabelProperty);
        set => SetValue(LabelProperty, value);
    }

    private static void OnColumnsChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsDataTableColumnsMenu)d).Rebuild();

    private static void OnLabelChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var menu = (TsDataTableColumnsMenu)d;
        if (!string.IsNullOrEmpty(menu.Label))
        {
            AutomationProperties.SetName(menu._trigger, menu.Label);
            ToolTipService.SetToolTip(menu._trigger, menu.Label);
        }
    }

    private void Rebuild()
    {
        _flyout.Items.Clear();
        if (Columns is null)
        {
            return;
        }

        foreach (var column in Columns)
        {
            var item = new ToggleMenuFlyoutItem
            {
                Text = column.Header ?? column.Key,
                IsChecked = column.IsVisible,
            };
            var captured = column;
            item.Click += (s, e) => captured.IsVisible = item.IsChecked;
            _flyout.Items.Add(item);
        }
    }
}
