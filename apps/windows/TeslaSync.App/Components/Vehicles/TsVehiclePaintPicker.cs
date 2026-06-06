using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Shapes;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Vehicles;

namespace TeslaSync.App.Components.Vehicles;

/// <summary>
/// Paint-colour picker for the digital twin (port of the web
/// <c>VehiclePaintPicker</c>). Renders one swatch toggle per
/// <see cref="PaintPalettes.All"/> entry and raises <see cref="PaintSelected"/> when
/// the user picks a colour; the active swatch stays pressed and is exposed to
/// assistive technology by its localized label.
/// </summary>
public partial class TsVehiclePaintPicker : ContentControl
{
    private readonly StackPanel _row = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 8,
    };

    private bool _suppress;

    public static readonly DependencyProperty SelectedIdProperty = DependencyProperty.Register(
        nameof(SelectedId), typeof(PaintPaletteId), typeof(TsVehiclePaintPicker),
        new PropertyMetadata(PaintPaletteId.PearlWhite, OnSelectedIdChanged));

    public TsVehiclePaintPicker()
    {
        IsTabStop = false;
        AutomationProperties.SetName(this, "Vehicle paint colour");

        foreach (var paint in PaintPalettes.All)
        {
            var swatch = new Ellipse
            {
                Width = 22,
                Height = 22,
                Fill = DisplayPrimitives.HexBrush(paint.Swatch),
                Stroke = DisplayTokens.Border,
                StrokeThickness = 1,
            };

            var button = new ToggleButton
            {
                Content = swatch,
                Tag = paint.Id,
                MinWidth = 0,
                Padding = new Thickness(3),
            };
            ToolTipService.SetToolTip(button, paint.DefaultLabel);
            AutomationProperties.SetName(button, paint.DefaultLabel);
            button.Checked += OnSwatchChecked;
            button.Unchecked += OnSwatchUnchecked;
            _row.Children.Add(button);
        }

        Content = _row;
        SyncButtons();
    }

    /// <summary>Raised when the user selects a paint colour.</summary>
    public event EventHandler<PaintPalette>? PaintSelected;

    /// <summary>The currently selected paint palette id.</summary>
    public PaintPaletteId SelectedId
    {
        get => (PaintPaletteId)GetValue(SelectedIdProperty);
        set => SetValue(SelectedIdProperty, value);
    }

    private static void OnSelectedIdChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsVehiclePaintPicker)d).SyncButtons();

    private void OnSwatchChecked(object sender, RoutedEventArgs e)
    {
        if (_suppress || sender is not ToggleButton { Tag: PaintPaletteId id })
        {
            return;
        }

        SelectedId = id;
        PaintSelected?.Invoke(this, PaintPalettes.ById(id));
    }

    private void OnSwatchUnchecked(object sender, RoutedEventArgs e)
    {
        if (_suppress || sender is not ToggleButton { Tag: PaintPaletteId id })
        {
            return;
        }

        if (id == SelectedId)
        {
            SyncButtons();
        }
    }

    private void SyncButtons()
    {
        _suppress = true;
        foreach (var button in _row.Children.OfType<ToggleButton>())
        {
            button.IsChecked = button.Tag is PaintPaletteId id && id == SelectedId;
        }

        _suppress = false;
    }
}
