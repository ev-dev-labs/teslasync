using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.Maps;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Maps;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Maps;

/// <summary>
/// Builds and owns the create / edit geofence form rendered inside the page's <c>TsModal</c> — the native port of
/// the web modal body (web/src/features/maps/pages/GeofencesPage.tsx). It composes the optional "use current
/// location" section (the vehicle / browser / draw-on-map source switch, the vehicle picker, the Fluent
/// <see cref="TsMapControl"/> + <see cref="TsGeofenceDrawer"/>, and the get-location action), the name /
/// latitude / longitude / radius inputs with their per-field validation errors, the alert-type selector and the
/// active toggle. The host page reads the live form through <see cref="Snapshot"/> and surfaces validation
/// failures through <see cref="ShowErrors"/>. Every label resolves through the injected localizer.
/// </summary>
internal sealed class GeofenceFormBuilder
{
    private enum LocationSource
    {
        Vehicle,
        Browser,
        Map,
    }

    private const double MapHeight = 256;

    private readonly GeofencesPage _page;
    private readonly ILocalizer _localizer;
    private readonly bool _isCreate;

    private readonly InfoBar _formError = new()
    {
        Severity = InfoBarSeverity.Error,
        IsOpen = false,
        IsClosable = false,
        Margin = new Thickness(0, 0, 0, 4),
    };

    private readonly TsInput _name = new();
    private readonly TsInput _latitude = new();
    private readonly TsInput _longitude = new();
    private readonly TsInput _radius = new();
    private readonly ErrorText _nameError = new() { Visibility = Visibility.Collapsed };
    private readonly ErrorText _latError = new() { Visibility = Visibility.Collapsed };
    private readonly ErrorText _lngError = new() { Visibility = Visibility.Collapsed };
    private readonly ErrorText _radiusError = new() { Visibility = Visibility.Collapsed };
    private readonly TsSelect _alertSelect = new();
    private readonly TsToggle _enabledToggle = new();

    private readonly StackPanel _locationContent = new() { Spacing = 12 };
    private readonly TsSelect _vehicleSelect = new();
    private readonly TsButton _getLocationButton = new() { Variant = ButtonVariant.Secondary, Size = ControlSize.Small, IconGlyph = "\uE81D" };
    private readonly TsButton _vehicleTab;
    private readonly TsButton _browserTab;
    private readonly TsButton _mapTab;
    private TsMapControl? _map;
    private TsGeofenceDrawer? _drawer;

    private LocationSource _source = LocationSource.Vehicle;
    private long _selectedVehicleId;
    private bool _locationLoading;

    /// <summary>Builds the form over the host page, localizer, create/edit mode and the initial snapshot.</summary>
    /// <param name="page">The host page (for the vehicle feed, the position read and the toast surface).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="isCreate">True for the create modal (shows the "use current location" section).</param>
    /// <param name="initial">The initial form snapshot (web <c>EMPTY_FORM</c> or the edited geofence).</param>
    public GeofenceFormBuilder(GeofencesPage page, ILocalizer localizer, bool isCreate, GeofenceFormState initial)
    {
        ArgumentNullException.ThrowIfNull(page);
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(initial);

        _page = page;
        _localizer = localizer;
        _isCreate = isCreate;

        _vehicleTab = SourceTab(_localizer.GetString("geofences.vehicle", "Vehicle"));
        _browserTab = SourceTab(_localizer.GetString("geofences.browser", "Browser"));
        _mapTab = SourceTab(_localizer.GetString("geofences.drawOnMap", "Draw on map"));

        Root = BuildRoot(initial);
    }

    /// <summary>The dialog content element.</summary>
    public StackPanel Root { get; }

    /// <summary>Read the live form values (web controlled-input snapshot).</summary>
    public GeofenceFormState Snapshot()
    {
        var kind = _alertSelect.SelectedItem is ComboBoxItem item && item.Tag is GeofenceAlertKind k
            ? k
            : GeofenceAlertKind.Both;

        return new GeofenceFormState(
            _name.Text ?? string.Empty,
            _latitude.Text ?? string.Empty,
            _longitude.Text ?? string.Empty,
            _radius.Text ?? string.Empty,
            kind,
            _enabledToggle.IsOn);
    }

    /// <summary>Surface the per-field validation errors + the top-level banner (web <c>fieldErrors</c> + <c>formError</c>).</summary>
    public void ShowErrors(GeofenceFieldErrors errors, string formError)
    {
        ArgumentNullException.ThrowIfNull(errors);
        SetFieldError(_name, _nameError, errors.Name);
        SetFieldError(_latitude, _latError, errors.Latitude);
        SetFieldError(_longitude, _lngError, errors.Longitude);
        SetFieldError(_radius, _radiusError, errors.Radius);

        _formError.Message = formError;
        _formError.IsOpen = !string.IsNullOrEmpty(formError);
    }

    private StackPanel BuildRoot(GeofenceFormState initial)
    {
        var root = new StackPanel { Spacing = 16, MinWidth = 420 };
        root.Children.Add(_formError);

        if (_isCreate)
        {
            root.Children.Add(BuildLocationSection(initial));
        }

        _name.Header = _localizer.GetString("Name", "Name");
        _name.Hint = _localizer.GetString("Home", "Home");
        _name.Text = initial.Name;
        AutomationProperties.SetName(_name, _localizer.GetString("Name", "Name"));
        root.Children.Add(Field(_name, _nameError));

        _latitude.Header = _localizer.GetString("Latitude", "Latitude");
        _latitude.Hint = "37.7749";
        _latitude.Text = initial.Latitude;
        AutomationProperties.SetName(_latitude, _localizer.GetString("Latitude", "Latitude"));

        _longitude.Header = _localizer.GetString("Longitude", "Longitude");
        _longitude.Hint = "-122.4194";
        _longitude.Text = initial.Longitude;
        AutomationProperties.SetName(_longitude, _localizer.GetString("Longitude", "Longitude"));

        var coordGrid = new Grid { ColumnSpacing = 16 };
        coordGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        coordGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        var latColumn = Field(_latitude, _latError);
        var lngColumn = Field(_longitude, _lngError);
        Grid.SetColumn(latColumn, 0);
        Grid.SetColumn(lngColumn, 1);
        coordGrid.Children.Add(latColumn);
        coordGrid.Children.Add(lngColumn);
        root.Children.Add(coordGrid);

        _radius.Header = _localizer.GetString("Radius (meters)", "Radius (meters)");
        _radius.Hint = "100";
        _radius.Text = initial.Radius;
        AutomationProperties.SetName(_radius, _localizer.GetString("Radius (meters)", "Radius (meters)"));
        var radiusColumn = Field(_radius, _radiusError);
        radiusColumn.Children.Add(new HelperText { Value = _localizer.GetString("Minimum 10m, maximum 50000m", "Minimum 10m, maximum 50000m") });
        root.Children.Add(radiusColumn);

        BuildAlertSelect(initial.AlertType);
        root.Children.Add(_alertSelect);

        _enabledToggle.Header = _localizer.GetString("Active", "Active");
        _enabledToggle.IsOn = initial.Enabled;
        root.Children.Add(_enabledToggle);

        return root;
    }

    private void BuildAlertSelect(GeofenceAlertKind selected)
    {
        _alertSelect.Header = _localizer.GetString("Alert Type", "Alert Type");
        AutomationProperties.SetName(_alertSelect, _localizer.GetString("Alert Type", "Alert Type"));

        AddAlertOption(GeofenceAlertKind.Entry, _localizer.GetString("Entry Only", "Entry Only"));
        AddAlertOption(GeofenceAlertKind.Exit, _localizer.GetString("Exit Only", "Exit Only"));
        AddAlertOption(GeofenceAlertKind.Both, _localizer.GetString("Entry & Exit", "Entry & Exit"));
        AddAlertOption(GeofenceAlertKind.None, _localizer.GetString("None", "None"));

        for (int i = 0; i < _alertSelect.Items.Count; i++)
        {
            if (_alertSelect.Items[i] is ComboBoxItem item && item.Tag is GeofenceAlertKind kind && kind == selected)
            {
                _alertSelect.SelectedIndex = i;
                return;
            }
        }

        _alertSelect.SelectedIndex = 2;
    }

    private void AddAlertOption(GeofenceAlertKind kind, string label) =>
        _alertSelect.Items.Add(new ComboBoxItem { Content = label, Tag = kind });

    private StackPanel BuildLocationSection(GeofenceFormState initial)
    {
        var header = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        header.Children.Add(new FontIcon { Glyph = "\uE81D", FontSize = 16 });
        header.Children.Add(new Text { Value = _localizer.GetString("geofences.useCurrentLocation", "Use Current Location"), VerticalAlignment = VerticalAlignment.Center });

        var tabs = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        tabs.Children.Add(_vehicleTab);
        tabs.Children.Add(_browserTab);
        tabs.Children.Add(_mapTab);

        _vehicleTab.Click += (_, _) => SetSource(LocationSource.Vehicle, initial);
        _browserTab.Click += (_, _) => SetSource(LocationSource.Browser, initial);
        _mapTab.Click += (_, _) => SetSource(LocationSource.Map, initial);

        _vehicleSelect.Header = _localizer.GetString("geofences.selectVehicle", "Select Vehicle");
        AutomationProperties.SetName(_vehicleSelect, _localizer.GetString("geofences.selectVehicle", "Select Vehicle"));
        _vehicleSelect.Items.Add(new ComboBoxItem { Content = _localizer.GetString("geofences.chooseVehicle", "— Choose vehicle —"), Tag = 0L });
        foreach (var vehicle in _page.ViewModel.Vehicles)
        {
            _vehicleSelect.Items.Add(new ComboBoxItem { Content = vehicle.Label, Tag = vehicle.Id });
        }

        _vehicleSelect.SelectedIndex = 0;
        _vehicleSelect.SelectionChanged += (_, _) =>
        {
            _selectedVehicleId = _vehicleSelect.SelectedItem is ComboBoxItem item && item.Tag is long id ? id : 0;
        };

        _getLocationButton.Text = _localizer.GetString("geofences.getLocation", "Get Location");
        _getLocationButton.Click += OnGetLocationClicked;

        var section = new StackPanel { Spacing = 12 };
        section.Children.Add(header);
        section.Children.Add(tabs);
        section.Children.Add(_locationContent);

        SetSource(LocationSource.Vehicle, initial);

        return new StackPanel
        {
            Spacing = 12,
            Children = { new TsGlassPanel { Padding = new Thickness(16), Content = section } },
        };
    }

    private static TsButton SourceTab(string label) => new()
    {
        Variant = ButtonVariant.Subtle,
        Size = ControlSize.Small,
        Text = label,
    };

    private void SetSource(LocationSource source, GeofenceFormState initial)
    {
        _source = source;
        _vehicleTab.Variant = source == LocationSource.Vehicle ? ButtonVariant.Primary : ButtonVariant.Subtle;
        _browserTab.Variant = source == LocationSource.Browser ? ButtonVariant.Primary : ButtonVariant.Subtle;
        _mapTab.Variant = source == LocationSource.Map ? ButtonVariant.Primary : ButtonVariant.Subtle;

        _locationContent.Children.Clear();
        switch (source)
        {
            case LocationSource.Vehicle:
                _locationContent.Children.Add(_vehicleSelect);
                _locationContent.Children.Add(_getLocationButton);
                break;
            case LocationSource.Browser:
                _locationContent.Children.Add(_getLocationButton);
                break;
            default:
                _locationContent.Children.Add(new Caption
                {
                    Value = _localizer.GetString(
                        "geofences.drawHint",
                        "Click the circle tool, then click and drag on the map to draw a fence."),
                });
                _locationContent.Children.Add(BuildMap(initial));
                break;
        }
    }

    private Border BuildMap(GeofenceFormState initial)
    {
        var (centerLat, centerLng, zoom) = ResolveCenter(initial);
        _map = new TsMapControl
        {
            MapStyle = MapStyleKind.Dark,
            Height = MapHeight,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            CenterLat = centerLat,
            CenterLng = centerLng,
            Zoom = zoom,
        };

        _drawer = new TsGeofenceDrawer { DrawMode = GeofenceDrawMode.Rectangle };
        _map.AddOverlay(_drawer);
        _drawer.GeofenceDrawn += OnGeofenceDrawn;
        UpdateDraftFence();

        var border = new Border
        {
            CornerRadius = new CornerRadius(12),
            BorderThickness = new Thickness(1),
            BorderBrush = GeofencesPage.Brush("TsColorBorderBrush"),
            Child = _map,
        };
        AutomationProperties.SetName(border, _localizer.GetString("geofences.drawerLabel", "Geofence drawing map"));
        AutomationProperties.SetLandmarkType(border, Microsoft.UI.Xaml.Automation.Peers.AutomationLandmarkType.Main);
        return border;
    }

    private void OnGeofenceDrawn(object? sender, NewGeofence geofence)
    {
        if (geofence.Polygon is not { Count: > 0 } ring)
        {
            return;
        }

        var (lat, lng, radius) = CircleFromRing(ring);
        _latitude.Text = lat.ToString(CultureInfo.InvariantCulture);
        _longitude.Text = lng.ToString(CultureInfo.InvariantCulture);
        _radius.Text = Math.Round(radius).ToString(CultureInfo.InvariantCulture);
        UpdateDraftFence();
    }

    private void UpdateDraftFence()
    {
        if (_drawer is null)
        {
            return;
        }

        if (TryParse(_latitude.Text, out var lat) && TryParse(_longitude.Text, out var lng) &&
            TryParse(_radius.Text, out var radius) && radius > 0 && (lat != 0 || lng != 0))
        {
            _drawer.SetGeofences(new[]
            {
                new DrawableGeofence("draft", lat, lng, radius, null, _name.Text),
            });
        }
        else
        {
            _drawer.SetGeofences(Array.Empty<DrawableGeofence>());
        }
    }

    private async void OnGetLocationClicked(object sender, RoutedEventArgs e)
    {
        if (_locationLoading)
        {
            return;
        }

        _locationLoading = true;
        _getLocationButton.IsLoading = true;
        _getLocationButton.Text = _localizer.GetString("geofences.gettingLocation", "Getting location…");

        try
        {
            if (_source == LocationSource.Vehicle)
            {
                if (_selectedVehicleId <= 0)
                {
                    _page.PushToast(_localizer.GetString("geofences.selectVehicle", "Select a vehicle first"), isError: true);
                    return;
                }

                var position = await _page.ViewModel.GetLatestPositionAsync(_selectedVehicleId).ConfigureAwait(true);
                if (position is null)
                {
                    _page.PushToast(_localizer.GetString("geofences.noPosition", "No position data available for this vehicle"), isError: true);
                    return;
                }

                _latitude.Text = position.Latitude.ToString(CultureInfo.InvariantCulture);
                _longitude.Text = position.Longitude.ToString(CultureInfo.InvariantCulture);
            }
            else if (_source == LocationSource.Browser)
            {
                // The desktop shell has no browser geolocation provider — surface the same "denied" path the web
                // shows when the browser refuses the permission (web GeolocationPositionError branch).
                _page.PushToast(_localizer.GetString("geofences.locationDenied", "Location access denied"), isError: true);
            }
        }
        catch (Exception)
        {
            _page.PushToast(_localizer.GetString("geofences.locationFailed", "Failed to get location"), isError: true);
        }
        finally
        {
            _locationLoading = false;
            _getLocationButton.IsLoading = false;
            _getLocationButton.Text = _localizer.GetString("geofences.getLocation", "Get Location");
        }
    }

    private static (double Lat, double Lng, int Zoom) ResolveCenter(GeofenceFormState initial)
    {
        if (TryParse(initial.Latitude, out var lat) && TryParse(initial.Longitude, out var lng) && (lat != 0 || lng != 0))
        {
            return (lat, lng, 15);
        }

        return (37.7749, -122.4194, 11);
    }

    private static void SetFieldError(TsInput input, ErrorText error, string? message)
    {
        input.HasError = message is not null;
        error.Value = message ?? string.Empty;
        error.Visibility = message is not null ? Visibility.Visible : Visibility.Collapsed;
    }

    private static StackPanel Field(FrameworkElement input, ErrorText error) =>
        new() { Spacing = 4, Children = { input, error } };

    private static bool TryParse(string? value, out double result) =>
        double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out result);

    private static (double Lat, double Lng, double Radius) CircleFromRing(IReadOnlyList<GeoPoint> ring)
    {
        double lat = ring.Average(p => p.Lat);
        double lng = ring.Average(p => p.Lng);
        double radius = ring.Max(p => MetersBetween(lat, lng, p.Lat, p.Lng));
        return (lat, lng, radius);
    }

    private static double MetersBetween(double lat1, double lng1, double lat2, double lng2)
    {
        const double earthRadiusM = 6_371_000.0;
        double dLat = (lat2 - lat1) * Math.PI / 180.0;
        double dLng = (lng2 - lng1) * Math.PI / 180.0;
        double a = (Math.Sin(dLat / 2) * Math.Sin(dLat / 2)) +
            (Math.Cos(lat1 * Math.PI / 180.0) * Math.Cos(lat2 * Math.PI / 180.0) * Math.Sin(dLng / 2) * Math.Sin(dLng / 2));
        return earthRadiusM * (2 * Math.Atan2(Math.Sqrt(a), Math.Sqrt(1 - a)));
    }
}
