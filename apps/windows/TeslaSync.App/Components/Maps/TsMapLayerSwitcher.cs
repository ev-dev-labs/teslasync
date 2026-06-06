using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using TeslaSync.App.Core.Maps;

namespace TeslaSync.App.Components.Maps;

/// <summary>
/// A base-map style switcher (port of the web <c>MapLayerSwitcher</c>). Renders one
/// toggle per <see cref="MapStyles"/> entry and raises <see cref="StyleSelected"/>
/// when the user picks a style; the active style stays pressed.
/// </summary>
public partial class TsMapLayerSwitcher : ContentControl
{
    private readonly StackPanel _row = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 4,
    };

    private bool _suppress;

    public static readonly DependencyProperty SelectedStyleProperty = DependencyProperty.Register(
        nameof(SelectedStyle), typeof(MapStyleKind), typeof(TsMapLayerSwitcher),
        new PropertyMetadata(MapStyleKind.Dark, OnSelectedStyleChanged));

    public TsMapLayerSwitcher()
    {
        IsTabStop = false;
        AutomationProperties.SetName(this, "Map style");

        foreach (var info in MapStyles.All)
        {
            var button = new ToggleButton
            {
                Content = new FontIcon { Glyph = info.Glyph, FontSize = 16 },
                Tag = info.Style,
                MinWidth = 40,
            };
            ToolTipService.SetToolTip(button, info.DefaultLabel);
            AutomationProperties.SetName(button, info.DefaultLabel);
            button.Checked += OnButtonChecked;
            button.Unchecked += OnButtonUnchecked;
            _row.Children.Add(button);
        }

        Content = _row;
        SyncButtons();
    }

    /// <summary>Raised when the user selects a base-map style.</summary>
    public event EventHandler<MapStyleKind>? StyleSelected;

    /// <summary>The currently selected base-map style.</summary>
    public MapStyleKind SelectedStyle
    {
        get => (MapStyleKind)GetValue(SelectedStyleProperty);
        set => SetValue(SelectedStyleProperty, value);
    }

    private static void OnSelectedStyleChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsMapLayerSwitcher)d).SyncButtons();

    private void OnButtonChecked(object sender, RoutedEventArgs e)
    {
        if (_suppress || sender is not ToggleButton { Tag: MapStyleKind style })
        {
            return;
        }

        SelectedStyle = style;
        StyleSelected?.Invoke(this, style);
    }

    private void OnButtonUnchecked(object sender, RoutedEventArgs e)
    {
        if (_suppress || sender is not ToggleButton { Tag: MapStyleKind style })
        {
            return;
        }

        // Prevent un-selecting the active style; re-check it.
        if (style == SelectedStyle)
        {
            SyncButtons();
        }
    }

    private void SyncButtons()
    {
        _suppress = true;
        foreach (var button in _row.Children.OfType<ToggleButton>())
        {
            button.IsChecked = button.Tag is MapStyleKind style && style == SelectedStyle;
        }

        _suppress = false;
    }
}

/// <summary>
/// Forces a hosted <see cref="TsMapControl"/> to recompute its tiles after the
/// surrounding layout settles or resizes (port of the web <c>MapInvalidator</c> that
/// calls <c>map.invalidateSize()</c> — Leaflet maps render blank until their
/// container size is known). Place one in the same layout as the map and call
/// <see cref="Attach"/>.
/// </summary>
public partial class TsMapInvalidator : ContentControl
{
    private TsMapControl? _map;

    public TsMapInvalidator()
    {
        IsTabStop = false;
        Width = 0;
        Height = 0;
        Visibility = Visibility.Collapsed;
        Loaded += (_, _) => _map?.Invalidate();
    }

    /// <summary>Attach the invalidator to a map; it re-invalidates on container size changes.</summary>
    public void Attach(TsMapControl map)
    {
        ArgumentNullException.ThrowIfNull(map);
        _map = map;
        if (Parent is FrameworkElement container)
        {
            container.SizeChanged += (_, _) => _map?.Invalidate();
        }

        map.Invalidate();
    }
}
