using System.Collections.Generic;
using System.Collections.ObjectModel;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Core;

namespace TeslaSync.App.Components.UI;

/// <summary>
/// Spotlight-style command launcher (mirrors the web <c>CommandPalette</c>).
/// Hosts a search box over a result <see cref="ListView"/> ranked by
/// <see cref="CommandPaletteFilter"/>. Opens in a centered <see cref="Popup"/>,
/// supports keyboard navigation (Up/Down/Enter/Escape), and restores focus to the
/// previously focused element when dismissed.
/// </summary>
public partial class TsCommandPalette : ContentControl
{
    private readonly Popup _popup = new() { IsLightDismissEnabled = true };
    private readonly TsInput _search = new();
    private readonly ListView _results = new() { SelectionMode = ListViewSelectionMode.Single };
    private readonly Border _surface;
    private readonly ObservableCollection<CommandItem> _visible = [];
    private IReadOnlyList<CommandItem> _source = [];
    private object? _restoreFocusTo;

    public static readonly DependencyProperty CommandsProperty = DependencyProperty.Register(
        nameof(Commands), typeof(IReadOnlyList<CommandItem>), typeof(TsCommandPalette),
        new PropertyMetadata(null, OnCommandsChanged));

    public static readonly DependencyProperty IsOpenProperty = DependencyProperty.Register(
        nameof(IsOpen), typeof(bool), typeof(TsCommandPalette),
        new PropertyMetadata(false, OnIsOpenChanged));

    public static readonly DependencyProperty SearchHintProperty = DependencyProperty.Register(
        nameof(SearchHint), typeof(string), typeof(TsCommandPalette),
        new PropertyMetadata(null, OnHintChanged));

    public static readonly DependencyProperty AccessibleNameProperty = DependencyProperty.Register(
        nameof(AccessibleName), typeof(string), typeof(TsCommandPalette),
        new PropertyMetadata(null, OnAccessibleNameChanged));

    public TsCommandPalette()
    {
        IsTabStop = false;
        _results.ItemsSource = _visible;
        _results.ItemTemplate = BuildItemTemplate();

        var layout = new StackPanel { Spacing = 8, Width = 520, Padding = new Thickness(12) };
        layout.Children.Add(_search);
        layout.Children.Add(_results);

        _surface = new Border
        {
            Child = layout,
            CornerRadius = new CornerRadius(12),
            Background = (Brush)Application.Current.Resources["TsColorSurfaceBrush"],
            BorderBrush = (Brush)Application.Current.Resources["TsColorBorderBrush"],
            BorderThickness = new Thickness(1),
        };
        _popup.Child = _surface;
        Content = _popup;

        _search.TextChanged += (s, e) => ApplyFilter();
        _search.KeyDown += OnSearchKeyDown;
        _results.ItemClick += (s, e) => Invoke(e.ClickedItem as CommandItem);
        _results.IsItemClickEnabled = true;
        _popup.Closed += (s, e) => IsOpen = false;
    }

    /// <summary>Raised when a command is chosen.</summary>
    public event EventHandler<CommandItem>? CommandInvoked;

    public IReadOnlyList<CommandItem>? Commands
    {
        get => (IReadOnlyList<CommandItem>?)GetValue(CommandsProperty);
        set => SetValue(CommandsProperty, value);
    }

    public bool IsOpen
    {
        get => (bool)GetValue(IsOpenProperty);
        set => SetValue(IsOpenProperty, value);
    }

    /// <summary>Localized hint shown in the search field.</summary>
    public string? SearchHint
    {
        get => (string?)GetValue(SearchHintProperty);
        set => SetValue(SearchHintProperty, value);
    }

    /// <summary>Localized accessible name announced for the palette surface.</summary>
    public string? AccessibleName
    {
        get => (string?)GetValue(AccessibleNameProperty);
        set => SetValue(AccessibleNameProperty, value);
    }

    private static void OnCommandsChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var palette = (TsCommandPalette)d;
        palette._source = palette.Commands ?? [];
        palette.ApplyFilter();
    }

    private static void OnIsOpenChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var palette = (TsCommandPalette)d;
        if ((bool)e.NewValue)
        {
            palette.Open();
        }
        else
        {
            palette.Close();
        }
    }

    private static void OnHintChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsCommandPalette)d)._search.Hint = ((TsCommandPalette)d).SearchHint;

    private static void OnAccessibleNameChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var palette = (TsCommandPalette)d;
        if (!string.IsNullOrEmpty(palette.AccessibleName))
        {
            AutomationProperties.SetName(palette._surface, palette.AccessibleName);
        }
    }

    private void Open()
    {
        _restoreFocusTo = FocusManager.GetFocusedElement(XamlRoot);
        if (XamlRoot is not null)
        {
            _popup.XamlRoot = XamlRoot;
            var bounds = XamlRoot.Size;
            _popup.HorizontalOffset = Math.Max(0, (bounds.Width - 520) / 2);
            _popup.VerticalOffset = Math.Max(0, bounds.Height * 0.15);
        }

        _search.Text = string.Empty;
        ApplyFilter();
        _popup.IsOpen = true;
        _search.Focus(FocusState.Programmatic);
    }

    private void Close()
    {
        _popup.IsOpen = false;
        if (_restoreFocusTo is Control control)
        {
            control.Focus(FocusState.Programmatic);
        }

        _restoreFocusTo = null;
    }

    private void ApplyFilter()
    {
        var filtered = CommandPaletteFilter.Filter(_source, _search.Text);
        _visible.Clear();
        foreach (var item in filtered)
        {
            _visible.Add(item);
        }

        if (_visible.Count > 0)
        {
            _results.SelectedIndex = 0;
        }
    }

    private void OnSearchKeyDown(object sender, KeyRoutedEventArgs e)
    {
        switch (e.Key)
        {
            case Windows.System.VirtualKey.Down:
                e.Handled = true;
                MoveSelection(1);
                break;
            case Windows.System.VirtualKey.Up:
                e.Handled = true;
                MoveSelection(-1);
                break;
            case Windows.System.VirtualKey.Enter:
                e.Handled = true;
                Invoke(_results.SelectedItem as CommandItem);
                break;
            case Windows.System.VirtualKey.Escape:
                e.Handled = true;
                IsOpen = false;
                break;
            default:
                break;
        }
    }

    private void MoveSelection(int delta)
    {
        if (_visible.Count == 0)
        {
            return;
        }

        var next = Math.Clamp(_results.SelectedIndex + delta, 0, _visible.Count - 1);
        _results.SelectedIndex = next;
        _results.ScrollIntoView(_results.SelectedItem);
    }

    private void Invoke(CommandItem? item)
    {
        if (item is null)
        {
            return;
        }

        IsOpen = false;
        CommandInvoked?.Invoke(this, item);
    }

    private static DataTemplate BuildItemTemplate()
    {
        const string xaml = """
            <DataTemplate xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation">
                <StackPanel Spacing="2" Padding="4">
                    <TextBlock Text="{Binding Title}" />
                    <TextBlock Text="{Binding Subtitle}" Opacity="0.7" FontSize="12" />
                </StackPanel>
            </DataTemplate>
            """;
        return (DataTemplate)Microsoft.UI.Xaml.Markup.XamlReader.Load(xaml);
    }
}
