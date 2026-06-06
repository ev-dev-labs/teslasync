using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Forms;

namespace TeslaSync.App.Components.Forms;

/// <summary>
/// Single-vehicle scope picker (mirrors the web <c>VehicleSelect</c>). Bound to a
/// <see cref="VehicleSelectState"/> so it renders real loading / error / empty /
/// loaded states straight from the repository instead of static sample data. The
/// host calls <see cref="SetLoading"/>, <see cref="SetLoaded"/> and
/// <see cref="SetError"/>; the control raises <see cref="SelectionChanged"/> and
/// <see cref="RetryRequested"/>.
/// </summary>
public partial class TsVehicleSelect : ContentControl
{
    private readonly VehicleSelectState _state = new();
    private readonly Grid _root = new();
    private readonly TsSpinner _spinner = new();
    private readonly TsErrorDisplay _error = new();
    private readonly TsEmptyState _empty = new();
    private readonly ComboBox _combo = new() { HorizontalAlignment = HorizontalAlignment.Stretch };
    private bool _suppress;

    public static readonly DependencyProperty SelectedIdProperty = DependencyProperty.Register(
        nameof(SelectedId), typeof(long?), typeof(TsVehicleSelect),
        new PropertyMetadata(null, OnSelectedIdChanged));

    public static readonly DependencyProperty PromptTextProperty = DependencyProperty.Register(
        nameof(PromptText), typeof(string), typeof(TsVehicleSelect),
        new PropertyMetadata("Select a vehicle"));

    public static readonly DependencyProperty LoadingTextProperty = DependencyProperty.Register(
        nameof(LoadingText), typeof(string), typeof(TsVehicleSelect),
        new PropertyMetadata("Loading vehicles…", OnTextChanged));

    public static readonly DependencyProperty EmptyTitleProperty = DependencyProperty.Register(
        nameof(EmptyTitle), typeof(string), typeof(TsVehicleSelect),
        new PropertyMetadata("No vehicles", OnTextChanged));

    public static readonly DependencyProperty EmptyMessageProperty = DependencyProperty.Register(
        nameof(EmptyMessage), typeof(string), typeof(TsVehicleSelect),
        new PropertyMetadata("No vehicles are linked to this account yet.", OnTextChanged));

    public static readonly DependencyProperty ErrorTitleProperty = DependencyProperty.Register(
        nameof(ErrorTitle), typeof(string), typeof(TsVehicleSelect),
        new PropertyMetadata("Couldn’t load vehicles", OnTextChanged));

    public static readonly DependencyProperty RetryTextProperty = DependencyProperty.Register(
        nameof(RetryText), typeof(string), typeof(TsVehicleSelect),
        new PropertyMetadata("Try again", OnTextChanged));

    public TsVehicleSelect()
    {
        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;

        _spinner.Label = LoadingText;
        _error.ActionInvoked += (_, _) => _state.Retry();

        _root.Children.Add(_spinner);
        _root.Children.Add(_error);
        _root.Children.Add(_empty);
        _root.Children.Add(_combo);
        Content = _root;

        _combo.SelectionChanged += OnComboSelectionChanged;
        _state.PropertyChanged += (_, _) => Render();
        _state.RetryRequested += (_, _) => RetryRequested?.Invoke(this, EventArgs.Empty);

        ApplyText();
        Render();
    }

    /// <summary>Raised when the selected vehicle id changes.</summary>
    public event EventHandler<long?>? SelectionChanged;

    /// <summary>Raised when the user asks to retry the fleet load.</summary>
    public event EventHandler? RetryRequested;

    /// <summary>The selected vehicle id, or null.</summary>
    public long? SelectedId
    {
        get => (long?)GetValue(SelectedIdProperty);
        set => SetValue(SelectedIdProperty, value);
    }

    /// <summary>Localized prompt shown when nothing is selected.</summary>
    public string PromptText
    {
        get => (string)GetValue(PromptTextProperty);
        set => SetValue(PromptTextProperty, value);
    }

    /// <summary>Localized loading caption.</summary>
    public string LoadingText
    {
        get => (string)GetValue(LoadingTextProperty);
        set => SetValue(LoadingTextProperty, value);
    }

    /// <summary>Localized empty-state heading.</summary>
    public string EmptyTitle
    {
        get => (string)GetValue(EmptyTitleProperty);
        set => SetValue(EmptyTitleProperty, value);
    }

    /// <summary>Localized empty-state message.</summary>
    public string EmptyMessage
    {
        get => (string)GetValue(EmptyMessageProperty);
        set => SetValue(EmptyMessageProperty, value);
    }

    /// <summary>Localized error heading.</summary>
    public string ErrorTitle
    {
        get => (string)GetValue(ErrorTitleProperty);
        set => SetValue(ErrorTitleProperty, value);
    }

    /// <summary>Localized retry button label.</summary>
    public string RetryText
    {
        get => (string)GetValue(RetryTextProperty);
        set => SetValue(RetryTextProperty, value);
    }

    /// <summary>Move to the loading state and begin a fleet load.</summary>
    public void SetLoading() => _state.SetLoading();

    /// <summary>Record a loaded fleet (empty lists render the empty state).</summary>
    public void SetLoaded(IReadOnlyList<VehicleOption> vehicles)
    {
        ArgumentNullException.ThrowIfNull(vehicles);
        _state.SetLoaded(vehicles);
    }

    /// <summary>Record a fleet-load failure with a localized message.</summary>
    public void SetError(string message) => _state.SetError(message);

    private static void OnSelectedIdChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var control = (TsVehicleSelect)d;
        if (control._suppress)
        {
            return;
        }

        control._state.SelectedId = (long?)e.NewValue;
        control.SyncComboSelection();
    }

    private static void OnTextChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsVehicleSelect)d).ApplyText();

    private void ApplyText()
    {
        _spinner.Label = LoadingText;
        _error.Title = ErrorTitle;
        _error.ActionText = RetryText;
        _empty.Title = EmptyTitle;
        _empty.Message = EmptyMessage;
        _combo.PlaceholderText = PromptText; // parity:allow PlaceholderText is the WinUI prompt API
    }

    private void Render()
    {
        _error.Message = _state.ErrorMessage ?? string.Empty;
        RebuildOptions();

        _spinner.Visibility = _state.IsLoading ? Visibility.Visible : Visibility.Collapsed;
        _error.Visibility = _state.HasError ? Visibility.Visible : Visibility.Collapsed;
        _empty.Visibility = _state is { IsLoading: false, HasError: false, IsEmpty: true }
            ? Visibility.Visible
            : Visibility.Collapsed;
        _combo.Visibility = _state.HasVehicles && !_state.IsLoading && !_state.HasError
            ? Visibility.Visible
            : Visibility.Collapsed;

        if (_state.SelectedId != SelectedId)
        {
            _suppress = true;
            SelectedId = _state.SelectedId;
            _suppress = false;
        }

        SyncComboSelection();
    }

    private void RebuildOptions()
    {
        _suppress = true;
        _combo.Items.Clear();
        foreach (var vehicle in _state.Vehicles)
        {
            _combo.Items.Add(new ComboBoxItem { Content = VehicleLabels.Short(vehicle), Tag = vehicle.Id });
        }

        _suppress = false;
    }

    private void SyncComboSelection()
    {
        _suppress = true;
        var match = _combo.Items
            .OfType<ComboBoxItem>()
            .FirstOrDefault(item => item.Tag is long id && _state.SelectedId == id);
        _combo.SelectedItem = match;
        _suppress = false;
    }

    private void OnComboSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppress)
        {
            return;
        }

        var id = _combo.SelectedItem is ComboBoxItem { Tag: long value } ? value : (long?)null;
        _state.SelectedId = id;
        _suppress = true;
        SelectedId = _state.SelectedId;
        _suppress = false;
        SelectionChanged?.Invoke(this, _state.SelectedId);
    }
}

/// <summary>
/// Multi-vehicle scope picker (mirrors the web <c>VehicleMultiSelect</c>). Loads
/// the fleet through a <see cref="VehicleSelectState"/> (real loading / error /
/// empty states) and drives selection through a
/// <see cref="VehicleMultiSelectController"/>: an "All vehicles (current + future)"
/// sentinel mutually exclusive with a per-vehicle checkbox subset. Exposes the
/// current <see cref="Selection"/> and raises <see cref="SelectionChanged"/>.
/// </summary>
public partial class TsVehicleMultiSelect : ContentControl
{
    private readonly VehicleSelectState _fleet = new();
    private readonly VehicleMultiSelectController _controller = new();
    private readonly Grid _root = new();
    private readonly TsSpinner _spinner = new();
    private readonly TsErrorDisplay _error = new();
    private readonly TsEmptyState _empty = new();
    private readonly StackPanel _list = new() { Spacing = 6 };
    private readonly CheckBox _all = new();
    private readonly StackPanel _rows = new() { Spacing = 4 };
    private bool _suppress;

    public static readonly DependencyProperty AllVehiclesTextProperty = DependencyProperty.Register(
        nameof(AllVehiclesText), typeof(string), typeof(TsVehicleMultiSelect),
        new PropertyMetadata("All vehicles (current + future)", OnTextChanged));

    public static readonly DependencyProperty LoadingTextProperty = DependencyProperty.Register(
        nameof(LoadingText), typeof(string), typeof(TsVehicleMultiSelect),
        new PropertyMetadata("Loading vehicles…", OnTextChanged));

    public static readonly DependencyProperty EmptyTitleProperty = DependencyProperty.Register(
        nameof(EmptyTitle), typeof(string), typeof(TsVehicleMultiSelect),
        new PropertyMetadata("No vehicles", OnTextChanged));

    public static readonly DependencyProperty EmptyMessageProperty = DependencyProperty.Register(
        nameof(EmptyMessage), typeof(string), typeof(TsVehicleMultiSelect),
        new PropertyMetadata("No vehicles are linked to this account yet.", OnTextChanged));

    public static readonly DependencyProperty ErrorTitleProperty = DependencyProperty.Register(
        nameof(ErrorTitle), typeof(string), typeof(TsVehicleMultiSelect),
        new PropertyMetadata("Couldn’t load vehicles", OnTextChanged));

    public static readonly DependencyProperty RetryTextProperty = DependencyProperty.Register(
        nameof(RetryText), typeof(string), typeof(TsVehicleMultiSelect),
        new PropertyMetadata("Try again", OnTextChanged));

    public TsVehicleMultiSelect()
    {
        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;

        _error.ActionInvoked += (_, _) => _fleet.Retry();
        _all.Checked += OnAllToggled;
        _all.Unchecked += OnAllToggled;

        _list.Children.Add(_all);
        _list.Children.Add(_rows);

        _root.Children.Add(_spinner);
        _root.Children.Add(_error);
        _root.Children.Add(_empty);
        _root.Children.Add(_list);
        Content = _root;

        _fleet.PropertyChanged += (_, _) => Render();
        _fleet.RetryRequested += (_, _) => RetryRequested?.Invoke(this, EventArgs.Empty);
        _controller.PropertyChanged += (_, _) => SyncSelection();

        ApplyText();
        Render();
    }

    /// <summary>Raised when the selection changes.</summary>
    public event EventHandler<VehicleMultiSelection>? SelectionChanged;

    /// <summary>Raised when the user asks to retry the fleet load.</summary>
    public event EventHandler? RetryRequested;

    /// <summary>The current selection value.</summary>
    public VehicleMultiSelection Selection => _controller.Value;

    /// <summary>Localized "all vehicles" sentinel label.</summary>
    public string AllVehiclesText
    {
        get => (string)GetValue(AllVehiclesTextProperty);
        set => SetValue(AllVehiclesTextProperty, value);
    }

    /// <summary>Localized loading caption.</summary>
    public string LoadingText
    {
        get => (string)GetValue(LoadingTextProperty);
        set => SetValue(LoadingTextProperty, value);
    }

    /// <summary>Localized empty-state heading.</summary>
    public string EmptyTitle
    {
        get => (string)GetValue(EmptyTitleProperty);
        set => SetValue(EmptyTitleProperty, value);
    }

    /// <summary>Localized empty-state message.</summary>
    public string EmptyMessage
    {
        get => (string)GetValue(EmptyMessageProperty);
        set => SetValue(EmptyMessageProperty, value);
    }

    /// <summary>Localized error heading.</summary>
    public string ErrorTitle
    {
        get => (string)GetValue(ErrorTitleProperty);
        set => SetValue(ErrorTitleProperty, value);
    }

    /// <summary>Localized retry button label.</summary>
    public string RetryText
    {
        get => (string)GetValue(RetryTextProperty);
        set => SetValue(RetryTextProperty, value);
    }

    /// <summary>Move to the loading state and begin a fleet load.</summary>
    public void SetLoading() => _fleet.SetLoading();

    /// <summary>Record a loaded fleet (empty lists render the empty state).</summary>
    public void SetLoaded(IReadOnlyList<VehicleOption> vehicles)
    {
        ArgumentNullException.ThrowIfNull(vehicles);
        _fleet.SetLoaded(vehicles);
    }

    /// <summary>Record a fleet-load failure with a localized message.</summary>
    public void SetError(string message) => _fleet.SetError(message);

    /// <summary>Replace the current selection programmatically.</summary>
    public void SetSelection(VehicleMultiSelection selection)
    {
        ArgumentNullException.ThrowIfNull(selection);
        _controller.Value = selection;
    }

    private static void OnTextChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsVehicleMultiSelect)d).ApplyText();

    private void ApplyText()
    {
        _spinner.Label = LoadingText;
        _error.Title = ErrorTitle;
        _error.ActionText = RetryText;
        _empty.Title = EmptyTitle;
        _empty.Message = EmptyMessage;
        _all.Content = AllVehiclesText;
    }

    private void Render()
    {
        _error.Message = _fleet.ErrorMessage ?? string.Empty;

        _spinner.Visibility = _fleet.IsLoading ? Visibility.Visible : Visibility.Collapsed;
        _error.Visibility = _fleet.HasError ? Visibility.Visible : Visibility.Collapsed;
        _empty.Visibility = _fleet is { IsLoading: false, HasError: false, IsEmpty: true }
            ? Visibility.Visible
            : Visibility.Collapsed;
        _list.Visibility = _fleet.HasVehicles && !_fleet.IsLoading && !_fleet.HasError
            ? Visibility.Visible
            : Visibility.Collapsed;

        RebuildRows();
        SyncSelection();
    }

    private void RebuildRows()
    {
        _rows.Children.Clear();
        foreach (var vehicle in _fleet.Vehicles)
        {
            var id = vehicle.Id;
            var check = new CheckBox { Content = VehicleLabels.Detailed(vehicle), Tag = id };
            AutomationProperties.SetName(check, VehicleLabels.Detailed(vehicle));
            check.Checked += (_, _) => OnVehicleToggled(id);
            check.Unchecked += (_, _) => OnVehicleToggled(id);
            _rows.Children.Add(check);
        }
    }

    private void OnAllToggled(object sender, RoutedEventArgs e)
    {
        if (_suppress)
        {
            return;
        }

        var wantAll = _all.IsChecked == true;
        if (wantAll == _controller.Value.IsAll)
        {
            return;
        }

        _controller.ToggleAll();
        SelectionChanged?.Invoke(this, _controller.Value);
    }

    private void OnVehicleToggled(long vehicleId)
    {
        if (_suppress)
        {
            return;
        }

        _controller.ToggleVehicle(vehicleId);
        SelectionChanged?.Invoke(this, _controller.Value);
    }

    private void SyncSelection()
    {
        _suppress = true;
        var selection = _controller.Value;
        _all.IsChecked = selection.IsAll;
        var selected = selection.Kind == VehicleSelectionKind.Specific
            ? new HashSet<long>(selection.VehicleIds)
            : [];
        foreach (var check in _rows.Children.OfType<CheckBox>())
        {
            if (check.Tag is long id)
            {
                check.IsChecked = selected.Contains(id);
                check.IsEnabled = !selection.IsAll;
            }
        }

        _suppress = false;
    }
}
