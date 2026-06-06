using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Forms;

namespace TeslaSync.App.Components.Forms;

/// <summary>
/// Single-select type-ahead (mirrors the web <c>Combobox</c>). Wraps a native
/// <see cref="AutoSuggestBox"/> (keyboard navigation, filtering and Narrator
/// support come for free) and drives filtering / selection through the
/// UI-free <see cref="ComboboxState"/>.
/// </summary>
public partial class TsCombobox : ContentControl
{
    private readonly AutoSuggestBox _box = new();
    private ComboboxState _state = new([]);

    public static readonly DependencyProperty OptionsProperty = DependencyProperty.Register(
        nameof(Options), typeof(IReadOnlyList<ComboOption>), typeof(TsCombobox),
        new PropertyMetadata(null, OnOptionsChanged));

    public static readonly DependencyProperty SelectedValueProperty = DependencyProperty.Register(
        nameof(SelectedValue), typeof(string), typeof(TsCombobox),
        new PropertyMetadata(null, OnSelectedValueChanged));

    public static readonly DependencyProperty PromptTextProperty = DependencyProperty.Register(
        nameof(PromptText), typeof(string), typeof(TsCombobox),
        new PropertyMetadata(string.Empty, OnPromptTextChanged));

    public TsCombobox()
    {
        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        _box.DisplayMemberPath = nameof(ComboOption.Label);
        _box.TextMemberPath = nameof(ComboOption.Label);
        _box.TextChanged += OnTextChanged;
        _box.SuggestionChosen += OnSuggestionChosen;
        _box.QuerySubmitted += OnQuerySubmitted;
        Content = _box;
        Rebuild();
    }

    /// <summary>Raised when the committed selection changes.</summary>
    public event EventHandler<string?>? SelectionChanged;

    /// <summary>The selectable options.</summary>
    public IReadOnlyList<ComboOption>? Options
    {
        get => (IReadOnlyList<ComboOption>?)GetValue(OptionsProperty);
        set => SetValue(OptionsProperty, value);
    }

    /// <summary>The committed selected value, or null.</summary>
    public string? SelectedValue
    {
        get => (string?)GetValue(SelectedValueProperty);
        set => SetValue(SelectedValueProperty, value);
    }

    /// <summary>Localized prompt text.</summary>
    public string PromptText
    {
        get => (string)GetValue(PromptTextProperty);
        set => SetValue(PromptTextProperty, value);
    }

    private static void OnOptionsChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsCombobox)d).Rebuild();

    private static void OnSelectedValueChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var combo = (TsCombobox)d;
        var value = (string?)e.NewValue;
        if (value is not null && combo._state.Select(value))
        {
            var option = (combo.Options ?? []).FirstOrDefault(o => o.Value == value);
            if (option is not null)
            {
                combo._box.Text = option.Label;
            }
        }
        else if (string.IsNullOrEmpty(value))
        {
            combo._box.Text = string.Empty;
        }
    }

    private static void OnPromptTextChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsCombobox)d)._box.PlaceholderText = (string)e.NewValue; // parity:allow PlaceholderText is the WinUI hint API

    private void Rebuild()
    {
        _state = new ComboboxState(Options ?? []);
        _box.ItemsSource = _state.Filtered;
    }

    private void OnTextChanged(AutoSuggestBox sender, AutoSuggestBoxTextChangedEventArgs args)
    {
        if (args.Reason != AutoSuggestionBoxTextChangeReason.UserInput)
        {
            return;
        }

        _state.Query = sender.Text;
        sender.ItemsSource = _state.Filtered;
    }

    private void OnSuggestionChosen(AutoSuggestBox sender, AutoSuggestBoxSuggestionChosenEventArgs args)
    {
        if (args.SelectedItem is ComboOption option && !option.Disabled)
        {
            Commit(option);
        }
    }

    private void OnQuerySubmitted(AutoSuggestBox sender, AutoSuggestBoxQuerySubmittedEventArgs args)
    {
        if (args.ChosenSuggestion is ComboOption option && !option.Disabled)
        {
            Commit(option);
        }
    }

    private void Commit(ComboOption option)
    {
        _state.Select(option.Value);
        _box.Text = option.Label;
        SetValue(SelectedValueProperty, option.Value);
        SelectionChanged?.Invoke(this, option.Value);
    }
}

/// <summary>
/// Multi-select type-ahead (mirrors the web <c>ComboboxMulti</c>). An
/// <see cref="AutoSuggestBox"/> drives filtering; chosen options become removable
/// chips. Selection is tracked by the UI-free <see cref="ComboboxMultiState"/>.
/// </summary>
public partial class TsComboboxMulti : ContentControl
{
    private readonly AutoSuggestBox _box = new();
    private readonly StackPanel _chips = new() { Orientation = Orientation.Horizontal, Spacing = 6 };
    private ComboboxMultiState _state = new([]);

    public static readonly DependencyProperty OptionsProperty = DependencyProperty.Register(
        nameof(Options), typeof(IReadOnlyList<ComboOption>), typeof(TsComboboxMulti),
        new PropertyMetadata(null, OnOptionsChanged));

    public static readonly DependencyProperty PromptTextProperty = DependencyProperty.Register(
        nameof(PromptText), typeof(string), typeof(TsComboboxMulti),
        new PropertyMetadata(string.Empty, OnPromptTextChanged));

    public static readonly DependencyProperty RemoveAutomationNameProperty = DependencyProperty.Register(
        nameof(RemoveAutomationName), typeof(string), typeof(TsComboboxMulti),
        new PropertyMetadata("Remove"));

    public TsComboboxMulti()
    {
        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        _box.DisplayMemberPath = nameof(ComboOption.Label);
        _box.TextMemberPath = nameof(ComboOption.Label);
        _box.TextChanged += OnTextChanged;
        _box.SuggestionChosen += OnSuggestionChosen;

        var column = new StackPanel { Spacing = 6 };
        column.Children.Add(new ScrollViewer
        {
            Content = _chips,
            HorizontalScrollMode = ScrollMode.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Disabled,
        });
        column.Children.Add(_box);
        Content = column;
        Rebuild();
    }

    /// <summary>Raised when the selected set changes.</summary>
    public event EventHandler<IReadOnlyList<string>>? SelectionChanged;

    /// <summary>The selectable options.</summary>
    public IReadOnlyList<ComboOption>? Options
    {
        get => (IReadOnlyList<ComboOption>?)GetValue(OptionsProperty);
        set => SetValue(OptionsProperty, value);
    }

    /// <summary>Localized prompt text.</summary>
    public string PromptText
    {
        get => (string)GetValue(PromptTextProperty);
        set => SetValue(PromptTextProperty, value);
    }

    /// <summary>Localized accessible name prefix for chip remove buttons.</summary>
    public string RemoveAutomationName
    {
        get => (string)GetValue(RemoveAutomationNameProperty);
        set => SetValue(RemoveAutomationNameProperty, value);
    }

    /// <summary>The selected values in stable option order.</summary>
    public IReadOnlyList<string> SelectedValues => _state.SelectedValues;

    private static void OnOptionsChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsComboboxMulti)d).Rebuild();

    private static void OnPromptTextChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsComboboxMulti)d)._box.PlaceholderText = (string)e.NewValue; // parity:allow PlaceholderText is the WinUI hint API

    private void Rebuild()
    {
        _state = new ComboboxMultiState(Options ?? []);
        _box.ItemsSource = _state.Filtered;
        RenderChips();
    }

    private void OnTextChanged(AutoSuggestBox sender, AutoSuggestBoxTextChangedEventArgs args)
    {
        if (args.Reason != AutoSuggestionBoxTextChangeReason.UserInput)
        {
            return;
        }

        _state.Query = sender.Text;
        sender.ItemsSource = _state.Filtered;
    }

    private void OnSuggestionChosen(AutoSuggestBox sender, AutoSuggestBoxSuggestionChosenEventArgs args)
    {
        if (args.SelectedItem is ComboOption option && !option.Disabled)
        {
            _state.Toggle(option.Value);
            sender.Text = string.Empty;
            _state.Query = string.Empty;
            sender.ItemsSource = _state.Filtered;
            RenderChips();
            SelectionChanged?.Invoke(this, _state.SelectedValues);
        }
    }

    private void RenderChips()
    {
        _chips.Children.Clear();
        var labels = (Options ?? []).ToDictionary(o => o.Value, o => o.Label, StringComparer.Ordinal);
        foreach (var value in _state.SelectedValues)
        {
            var captured = value;
            var text = labels.TryGetValue(value, out var label) ? label : value;
            var remove = new TsButton { Variant = TeslaSync.App.Core.ButtonVariant.Icon, IconGlyph = "\uE711" };
            AutomationProperties.SetName(remove, $"{RemoveAutomationName}: {text}");
            remove.Click += (_, _) =>
            {
                _state.Toggle(captured);
                RenderChips();
                SelectionChanged?.Invoke(this, _state.SelectedValues);
            };

            var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4 };
            row.Children.Add(new Text { Value = text, VerticalAlignment = VerticalAlignment.Center });
            row.Children.Add(remove);
            _chips.Children.Add(new Border
            {
                Child = row,
                CornerRadius = new CornerRadius(999),
                BorderBrush = TypographyTokens.Brush("TsColorBorderBrush"),
                BorderThickness = new Thickness(1),
                Padding = new Thickness(8, 2, 4, 2),
            });
        }
    }
}

/// <summary>
/// Grouped multi-select tree (mirrors the web <c>TreeSelect</c>). Renders each
/// <see cref="TreeGroup"/> as an expander with a tri-state group checkbox and per
/// leaf checkboxes; selection and expand/collapse are driven by the UI-free
/// <see cref="TreeSelectModel"/>.
/// </summary>
public partial class TsTreeSelect : ContentControl
{
    private readonly StackPanel _root = new() { Spacing = 4 };
    private readonly Dictionary<string, CheckBox> _groupChecks = new(StringComparer.Ordinal);
    private TreeSelectModel _model = new([]);
    private bool _suppress;

    public static readonly DependencyProperty GroupsProperty = DependencyProperty.Register(
        nameof(Groups), typeof(IReadOnlyList<TreeGroup>), typeof(TsTreeSelect),
        new PropertyMetadata(null, OnGroupsChanged));

    public TsTreeSelect()
    {
        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        Content = _root;
        Rebuild();
    }

    /// <summary>Raised when the selected leaf set changes.</summary>
    public event EventHandler<IReadOnlyList<string>>? SelectionChanged;

    /// <summary>The grouped options.</summary>
    public IReadOnlyList<TreeGroup>? Groups
    {
        get => (IReadOnlyList<TreeGroup>?)GetValue(GroupsProperty);
        set => SetValue(GroupsProperty, value);
    }

    /// <summary>The selected leaf values in stable tree order.</summary>
    public IReadOnlyList<string> SelectedValues => _model.SelectedValues;

    private static void OnGroupsChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsTreeSelect)d).Rebuild();

    private void Rebuild()
    {
        _model = new TreeSelectModel(Groups ?? []);
        _groupChecks.Clear();
        _root.Children.Clear();
        foreach (var group in Groups ?? [])
        {
            _root.Children.Add(BuildGroup(group));
        }
    }

    private Expander BuildGroup(TreeGroup group)
    {
        var groupKey = group.Key;
        var groupCheck = new CheckBox { Content = group.Label, IsThreeState = true };
        _groupChecks[groupKey] = groupCheck;
        SyncGroupCheck(groupKey);
        groupCheck.Checked += (_, _) => OnGroupChanged(groupKey, true);
        groupCheck.Unchecked += (_, _) => OnGroupChanged(groupKey, false);

        var leaves = new StackPanel { Spacing = 2, Margin = new Thickness(24, 0, 0, 0) };
        foreach (var leaf in group.Leaves)
        {
            var leafKey = leaf.Value;
            var leafCheck = new CheckBox { Content = leaf.Label, IsChecked = _model.IsSelected(leafKey) };
            leafCheck.Checked += (_, _) => OnLeafChanged(groupKey, leafKey, true);
            leafCheck.Unchecked += (_, _) => OnLeafChanged(groupKey, leafKey, false);
            leaves.Children.Add(leafCheck);
        }

        return new Expander
        {
            Header = groupCheck,
            Content = leaves,
            IsExpanded = _model.IsExpanded(groupKey),
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
        };
    }

    private void OnLeafChanged(string groupKey, string value, bool isChecked)
    {
        if (_suppress || _model.IsSelected(value) == isChecked)
        {
            return;
        }

        _model.ToggleLeaf(value);
        SyncGroupCheck(groupKey);
        SelectionChanged?.Invoke(this, _model.SelectedValues);
    }

    private void OnGroupChanged(string groupKey, bool isChecked)
    {
        if (_suppress)
        {
            return;
        }

        var fully = _model.IsGroupFullySelected(groupKey);
        if (isChecked == fully)
        {
            return;
        }

        _model.ToggleGroup(groupKey);
        SyncGroupCheck(groupKey);
        SyncLeafChecks(groupKey);
        SelectionChanged?.Invoke(this, _model.SelectedValues);
    }

    private void SyncLeafChecks(string groupKey)
    {
        var group = (Groups ?? []).FirstOrDefault(g => g.Key == groupKey);
        if (group is null)
        {
            return;
        }

        var index = (Groups ?? []).ToList().FindIndex(g => g.Key == groupKey);
        if (index < 0 || index >= _root.Children.Count || _root.Children[index] is not Expander expander ||
            expander.Content is not StackPanel leaves)
        {
            return;
        }

        _suppress = true;
        for (var i = 0; i < leaves.Children.Count && i < group.Leaves.Count; i++)
        {
            if (leaves.Children[i] is CheckBox leafCheck)
            {
                leafCheck.IsChecked = _model.IsSelected(group.Leaves[i].Value);
            }
        }

        _suppress = false;
    }

    private void SyncGroupCheck(string groupKey)
    {
        if (!_groupChecks.TryGetValue(groupKey, out var check))
        {
            return;
        }

        _suppress = true;
        if (_model.IsGroupFullySelected(groupKey))
        {
            check.IsChecked = true;
        }
        else if (_model.IsGroupPartiallySelected(groupKey))
        {
            check.IsChecked = null;
        }
        else
        {
            check.IsChecked = false;
        }

        _suppress = false;
    }
}
