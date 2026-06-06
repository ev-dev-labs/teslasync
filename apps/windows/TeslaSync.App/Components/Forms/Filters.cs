using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Forms;

namespace TeslaSync.App.Components.Forms;

/// <summary>
/// Active-filter summary row (mirrors the web <c>ActiveFilterChips</c>). Renders a
/// removable chip per <see cref="Filters"/> entry plus a "clear all" affordance.
/// Removing a chip raises <see cref="FilterRemoved"/> with its key; clearing all
/// raises <see cref="Cleared"/>. The page owns the underlying URL/query state.
/// </summary>
public partial class TsActiveFilterChips : ContentControl
{
    private readonly ActiveFilterModel _model = new();
    private readonly StackPanel _row = new() { Orientation = Orientation.Horizontal, Spacing = 6 };
    private readonly TsButton _clearAll = new() { Variant = TeslaSync.App.Core.ButtonVariant.Subtle };

    public static readonly DependencyProperty FiltersProperty = DependencyProperty.Register(
        nameof(Filters), typeof(IReadOnlyList<FilterChip>), typeof(TsActiveFilterChips),
        new PropertyMetadata(null, OnFiltersChanged));

    public static readonly DependencyProperty ClearAllTextProperty = DependencyProperty.Register(
        nameof(ClearAllText), typeof(string), typeof(TsActiveFilterChips),
        new PropertyMetadata("Clear all", OnClearTextChanged));

    public static readonly DependencyProperty RemoveAutomationNameProperty = DependencyProperty.Register(
        nameof(RemoveAutomationName), typeof(string), typeof(TsActiveFilterChips),
        new PropertyMetadata("Remove filter"));

    public TsActiveFilterChips()
    {
        IsTabStop = false;
        _clearAll.Text = ClearAllText;
        _clearAll.Click += (_, _) => _model.ClearAll();
        _model.FilterRemoved += (_, key) => FilterRemoved?.Invoke(this, key);
        _model.Cleared += (_, _) => Cleared?.Invoke(this, EventArgs.Empty);

        var container = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        container.Children.Add(_row);
        container.Children.Add(_clearAll);
        Content = container;
        Render();
    }

    /// <summary>Raised when a single chip is removed.</summary>
    public event EventHandler<string>? FilterRemoved;

    /// <summary>Raised when all filters are cleared.</summary>
    public event EventHandler? Cleared;

    /// <summary>The active filter chips.</summary>
    public IReadOnlyList<FilterChip>? Filters
    {
        get => (IReadOnlyList<FilterChip>?)GetValue(FiltersProperty);
        set => SetValue(FiltersProperty, value);
    }

    /// <summary>Localized "clear all" button label.</summary>
    public string ClearAllText
    {
        get => (string)GetValue(ClearAllTextProperty);
        set => SetValue(ClearAllTextProperty, value);
    }

    /// <summary>Localized accessible-name prefix for chip remove buttons.</summary>
    public string RemoveAutomationName
    {
        get => (string)GetValue(RemoveAutomationNameProperty);
        set => SetValue(RemoveAutomationNameProperty, value);
    }

    private static void OnFiltersChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var chips = (TsActiveFilterChips)d;
        chips._model.Set(chips.Filters ?? []);
        chips.Render();
    }

    private static void OnClearTextChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsActiveFilterChips)d)._clearAll.Text = (string)e.NewValue;

    private void Render()
    {
        _row.Children.Clear();
        foreach (var chip in _model.Chips)
        {
            var key = chip.Key;
            var remove = new TsButton { Variant = TeslaSync.App.Core.ButtonVariant.Icon, IconGlyph = "\uE711" };
            AutomationProperties.SetName(remove, $"{RemoveAutomationName}: {chip.Label} {chip.Value}");
            remove.Click += (_, _) => _model.Remove(key);

            var content = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4 };
            content.Children.Add(new Caption { Value = chip.Label + ":", VerticalAlignment = VerticalAlignment.Center });
            content.Children.Add(new Text { Value = chip.Value, VerticalAlignment = VerticalAlignment.Center });
            content.Children.Add(remove);
            _row.Children.Add(new Border
            {
                Child = content,
                CornerRadius = new CornerRadius(999),
                BorderBrush = TypographyTokens.Brush("TsColorBorderBrush"),
                BorderThickness = new Thickness(1),
                Padding = new Thickness(8, 2, 4, 2),
            });
        }

        Visibility = _model.HasChips ? Visibility.Visible : Visibility.Collapsed;
        _clearAll.Visibility = _model.HasChips ? Visibility.Visible : Visibility.Collapsed;
    }
}

/// <summary>
/// Filter toolbar (mirrors the web <c>FilterBar</c>). Hosts the page's filter
/// controls in <see cref="FilterContent"/> with an active-filter chip summary
/// (<see cref="TsActiveFilterChips"/>) beneath, inside a tokenized panel. Forwards
/// the chip removal / clear events so the page can rewrite its query state.
/// </summary>
public partial class TsFilterBar : ContentControl
{
    private readonly ContentPresenter _filterHost = new();
    private readonly TsActiveFilterChips _chips = new();

    public static readonly DependencyProperty FilterContentProperty = DependencyProperty.Register(
        nameof(FilterContent), typeof(object), typeof(TsFilterBar),
        new PropertyMetadata(null, OnFilterContentChanged));

    public static readonly DependencyProperty FiltersProperty = DependencyProperty.Register(
        nameof(Filters), typeof(IReadOnlyList<FilterChip>), typeof(TsFilterBar),
        new PropertyMetadata(null, OnFiltersChanged));

    public static readonly DependencyProperty ClearAllTextProperty = DependencyProperty.Register(
        nameof(ClearAllText), typeof(string), typeof(TsFilterBar),
        new PropertyMetadata("Clear all", OnClearTextChanged));

    public TsFilterBar()
    {
        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        _chips.FilterRemoved += (_, key) => FilterRemoved?.Invoke(this, key);
        _chips.Cleared += (_, _) => Cleared?.Invoke(this, EventArgs.Empty);

        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(_filterHost);
        column.Children.Add(_chips);
        Content = new TsGlassPanel { Padding = new Thickness(16), Content = column };
    }

    /// <summary>Raised when a single chip is removed.</summary>
    public event EventHandler<string>? FilterRemoved;

    /// <summary>Raised when all filters are cleared.</summary>
    public event EventHandler? Cleared;

    /// <summary>The filter controls hosted in the bar.</summary>
    public object? FilterContent
    {
        get => GetValue(FilterContentProperty);
        set => SetValue(FilterContentProperty, value);
    }

    /// <summary>The active filter chips shown beneath the controls.</summary>
    public IReadOnlyList<FilterChip>? Filters
    {
        get => (IReadOnlyList<FilterChip>?)GetValue(FiltersProperty);
        set => SetValue(FiltersProperty, value);
    }

    /// <summary>Localized "clear all" label.</summary>
    public string ClearAllText
    {
        get => (string)GetValue(ClearAllTextProperty);
        set => SetValue(ClearAllTextProperty, value);
    }

    private static void OnFilterContentChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsFilterBar)d)._filterHost.Content = e.NewValue;

    private static void OnFiltersChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsFilterBar)d)._chips.Filters = (IReadOnlyList<FilterChip>?)e.NewValue;

    private static void OnClearTextChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsFilterBar)d)._chips.ClearAllText = (string)e.NewValue;
}

/// <summary>
/// Segmented pill filter bar (mirrors the web <c>PillFilterBar</c>): a row of
/// mutually-exclusive pill toggles over <see cref="Options"/>. The committed
/// <see cref="SelectedValue"/> drives, and is driven by, the chips; changes raise
/// <see cref="SelectionChanged"/>.
/// </summary>
public partial class TsPillFilterBar : ContentControl
{
    private readonly StackPanel _row = new() { Orientation = Orientation.Horizontal, Spacing = 6 };
    private readonly Dictionary<string, ToggleButton> _buttons = new(StringComparer.Ordinal);
    private bool _suppress;

    public static readonly DependencyProperty OptionsProperty = DependencyProperty.Register(
        nameof(Options), typeof(IReadOnlyList<ComboOption>), typeof(TsPillFilterBar),
        new PropertyMetadata(null, OnOptionsChanged));

    public static readonly DependencyProperty SelectedValueProperty = DependencyProperty.Register(
        nameof(SelectedValue), typeof(string), typeof(TsPillFilterBar),
        new PropertyMetadata(null, OnSelectedChanged));

    public TsPillFilterBar()
    {
        IsTabStop = false;
        Content = new ScrollViewer
        {
            Content = _row,
            HorizontalScrollMode = ScrollMode.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
        Rebuild();
    }

    /// <summary>Raised when the selected pill changes.</summary>
    public event EventHandler<string?>? SelectionChanged;

    /// <summary>The selectable pill options.</summary>
    public IReadOnlyList<ComboOption>? Options
    {
        get => (IReadOnlyList<ComboOption>?)GetValue(OptionsProperty);
        set => SetValue(OptionsProperty, value);
    }

    /// <summary>The selected option value, or null.</summary>
    public string? SelectedValue
    {
        get => (string?)GetValue(SelectedValueProperty);
        set => SetValue(SelectedValueProperty, value);
    }

    private static void OnOptionsChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsPillFilterBar)d).Rebuild();

    private static void OnSelectedChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsPillFilterBar)d).SyncSelection();

    private void Rebuild()
    {
        _row.Children.Clear();
        _buttons.Clear();
        foreach (var option in Options ?? [])
        {
            var value = option.Value;
            var pill = new ToggleButton
            {
                Content = option.Label,
                IsChecked = value == SelectedValue,
                IsEnabled = !option.Disabled,
            };
            AutomationProperties.SetName(pill, option.Label);
            pill.Click += (_, _) =>
            {
                if (_suppress)
                {
                    return;
                }

                SelectedValue = value;
                SelectionChanged?.Invoke(this, value);
            };
            _buttons[value] = pill;
            _row.Children.Add(pill);
        }

        SyncSelection();
    }

    private void SyncSelection()
    {
        _suppress = true;
        foreach (var (value, pill) in _buttons)
        {
            pill.IsChecked = value == SelectedValue;
        }

        _suppress = false;
    }
}
