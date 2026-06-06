using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.DataDisplay;
using TeslaSync.App.Core.Forms;

namespace TeslaSync.App.Components.Layout;

/// <summary>
/// A compact toolbar vehicle picker (port of the web header <c>VehiclePicker</c>).
/// Unlike the form-grade <c>TsVehicleSelect</c> it has no internal load state
/// machine: the shell hands it the already-loaded fleet and the current selection,
/// and it raises <see cref="SelectionChanged"/> with the chosen vehicle id.
/// </summary>
public partial class TsVehiclePicker : ContentControl
{
    private readonly ComboBox _combo = new()
    {
        MinWidth = 180,
        HorizontalAlignment = HorizontalAlignment.Left,
    };

    private bool _suppress;

    public static readonly DependencyProperty SelectedIdProperty = DependencyProperty.Register(
        nameof(SelectedId), typeof(long?), typeof(TsVehiclePicker),
        new PropertyMetadata(null, OnSelectedIdChanged));

    public static readonly DependencyProperty PromptProperty = DependencyProperty.Register(
        nameof(Prompt), typeof(string), typeof(TsVehiclePicker),
        new PropertyMetadata("Select a vehicle", OnPromptChanged));

    public TsVehiclePicker()
    {
        IsTabStop = false;
        _combo.PlaceholderText = Prompt; // parity:allow PlaceholderText is the WinUI prompt API
        AutomationProperties.SetName(_combo, "Vehicle");
        _combo.SelectionChanged += OnComboChanged;
        Content = _combo;
    }

    /// <summary>Raised when the selected vehicle id changes.</summary>
    public event EventHandler<long?>? SelectionChanged;

    /// <summary>The selected vehicle id, or null.</summary>
    public long? SelectedId
    {
        get => (long?)GetValue(SelectedIdProperty);
        set => SetValue(SelectedIdProperty, value);
    }

    /// <summary>Localized prompt shown when nothing is selected.</summary>
    public string Prompt
    {
        get => (string)GetValue(PromptProperty);
        set => SetValue(PromptProperty, value);
    }

    /// <summary>Replace the available fleet (preserving the current selection if present).</summary>
    public void SetVehicles(IReadOnlyList<VehicleOption> vehicles)
    {
        ArgumentNullException.ThrowIfNull(vehicles);
        _suppress = true;
        _combo.Items.Clear();
        foreach (var vehicle in vehicles)
        {
            _combo.Items.Add(new ComboBoxItem { Content = VehicleLabels.Short(vehicle), Tag = vehicle.Id });
        }

        _suppress = false;
        SyncSelection();
    }

    private static void OnSelectedIdChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var picker = (TsVehiclePicker)d;
        if (!picker._suppress)
        {
            picker.SyncSelection();
        }
    }

    private static void OnPromptChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsVehiclePicker)d)._combo.PlaceholderText = (string)e.NewValue; // parity:allow WinUI prompt API

    private void SyncSelection()
    {
        _suppress = true;
        var match = _combo.Items
            .OfType<ComboBoxItem>()
            .FirstOrDefault(item => item.Tag is long id && SelectedId == id);
        _combo.SelectedItem = match;
        _suppress = false;
    }

    private void OnComboChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppress)
        {
            return;
        }

        long? id = _combo.SelectedItem is ComboBoxItem { Tag: long value } ? value : null;
        _suppress = true;
        SelectedId = id;
        _suppress = false;
        SelectionChanged?.Invoke(this, id);
    }
}

/// <summary>One labelled status item shown in a <see cref="TsStatusBar"/>.</summary>
/// <param name="Label">Localized label (e.g. "Live").</param>
/// <param name="Value">Localized value (e.g. "Connected").</param>
/// <param name="Severity">Severity driving the status dot colour.</param>
public readonly record struct StatusBarItem(string Label, string Value, SeverityLevel Severity);

/// <summary>
/// A bottom status bar (port of the web <c>StatusBar</c>). Renders a row of
/// labelled items each with a severity-tinted dot, plus an optional trailing slot.
/// The whole bar is a polite live region so status changes are announced.
/// </summary>
public partial class TsStatusBar : ContentControl
{
    private readonly Grid _root = new();
    private readonly StackPanel _items = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 20,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly StackPanel _trailing = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 8,
        HorizontalAlignment = HorizontalAlignment.Right,
        VerticalAlignment = VerticalAlignment.Center,
    };

    public TsStatusBar()
    {
        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        Padding = new Thickness(16, 6, 16, 6);
        BorderBrush = DisplayTokens.Border;
        BorderThickness = new Thickness(0, 1, 0, 0);
        Background = DisplayTokens.Surface;

        _root.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _root.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_items, 0);
        Grid.SetColumn(_trailing, 1);
        _root.Children.Add(_items);
        _root.Children.Add(_trailing);
        Content = _root;

        Feedback.LiveRegion.Configure(this, assertive: false);
        AutomationProperties.SetName(this, "Status");
    }

    /// <summary>Add a trailing element (e.g. a sync button) to the right of the bar.</summary>
    public void AddTrailing(UIElement element)
    {
        ArgumentNullException.ThrowIfNull(element);
        _trailing.Children.Add(element);
    }

    /// <summary>Replace the status items and announce the change.</summary>
    public void SetItems(IReadOnlyList<StatusBarItem> items)
    {
        ArgumentNullException.ThrowIfNull(items);
        _items.Children.Clear();
        foreach (var item in items)
        {
            _items.Children.Add(BuildItem(item));
        }

        Feedback.LiveRegion.Announce(this);
    }

    private static StackPanel BuildItem(StatusBarItem item)
    {
        var row = DisplayPrimitives.Row(8);
        var tokens = SeverityLevels.Tokens(item.Severity);
        Brush accent = DisplayTokens.Brush(tokens.AccentBrushKey);

        row.Children.Add(DisplayPrimitives.Dot(accent, 9));
        row.Children.Add(new Caption { Value = item.Label });
        row.Children.Add(new Text { Value = item.Value });

        string spoken = $"{item.Label}: {item.Value}";
        AutomationProperties.SetName(row, spoken);
        return row;
    }
}
