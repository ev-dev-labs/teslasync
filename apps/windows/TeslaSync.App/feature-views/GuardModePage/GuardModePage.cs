using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Forms;
using TeslaSync.App.Components.Layout;
using TeslaSync.App.Components.Maps;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Maps;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.VehicleSystems;

/// <summary>
/// The native WinUI 3 <c>GuardModePage</c> — a parity port of the web page
/// <c>web/src/features/vehicle-systems/pages/GuardModePage.tsx</c> (route <c>/guard-mode</c>, nav name
/// <c>GuardMode</c>). It binds to a <see cref="GuardModePageViewModel"/> and renders every web region with
/// Fluent components and design tokens: the page header (title + subtitle + vehicle picker + data-freshness),
/// the triggered-alert banner, the arm/disarm toggle card, the status card (armed-since / lock / sentry /
/// unacknowledged), the PANIC card, the guard-settings panel (home geofence + sensitivity selects, the
/// auto-panic toggle and Save), the live map (layer switcher + vehicle marker + popup + home-geofence circle
/// + event trail) and the newest-first event timeline — each with its loading / empty / error surface. The
/// panic confirmation is a Fluent <see cref="ContentDialog"/>. The view is a thin renderer: all branch
/// selection, formatting and i18n happen in the view-model's <see cref="GuardModeDisplay"/> projection. State
/// changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class GuardModePage : UserControl, IDisposable
{
    private const double SectionSpacing = 20;
    private const double PanelPadding = 20;
    private const double MapHeight = 400;
    private const int MapZoom = 15;

    private const string ShieldGlyph = "\uEA18";
    private const string ClockGlyph = "\uE823";
    private const string LockGlyph = "\uE72E";
    private const string EyeGlyph = "\uE7B3";
    private const string AlertGlyph = "\uE7BA";
    private const string SirenGlyph = "\uEA8F";

    private readonly GuardModePageViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;
    private bool _suppressEvents;
    private bool _mapOverlaysAttached;
    private int _lastToastSequence;

    // ── Scaffold + header ──
    private readonly TsPageContainer _scaffold = new();
    private readonly TsVehicleSelect _vehicleSelect = new() { MinWidth = 200 };
    private readonly TsDataFreshness _freshness = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly InfoBar _toast = new()
    {
        IsOpen = false,
        IsClosable = true,
        Severity = InfoBarSeverity.Success,
        Margin = new Thickness(0, 0, 0, 4),
    };

    private readonly TsAlertBanner _triggeredBanner = new()
    {
        Variant = CalloutVariant.Danger,
        Dismissible = false,
        IsOpen = false,
        Visibility = Visibility.Collapsed,
    };

    // ── Row 1: toggle card ──
    private readonly TsGlassPanel _togglePanel = new();
    private readonly FontIcon _shieldIcon = new() { Glyph = ShieldGlyph, FontSize = 40, HorizontalAlignment = HorizontalAlignment.Center };
    private readonly TextBlock _statusHeadline = new() { FontSize = 18, FontWeight = FontWeights.Bold, HorizontalAlignment = HorizontalAlignment.Center };
    private readonly TsToggle _guardToggle = new() { HorizontalAlignment = HorizontalAlignment.Center };
    private readonly Caption _updatingText = new() { HorizontalAlignment = HorizontalAlignment.Center, Visibility = Visibility.Collapsed };

    // ── Row 1: status card ──
    private readonly TsGlassPanel _statusPanel = new();
    private readonly Label _statusTitle = new();
    private readonly TextBlock _armedSinceText = new() { TextWrapping = TextWrapping.Wrap };
    private readonly TextBlock _lockText = new();
    private readonly TextBlock _sentryText = new();
    private readonly TextBlock _unackSummaryText = new();

    // ── Row 1: panic card ──
    private readonly TsGlassPanel _panicPanel = new();
    private readonly Label _emergencyTitle = new();
    private readonly TsButton _panicButton = new() { Variant = ButtonVariant.Destructive, HorizontalAlignment = HorizontalAlignment.Stretch };
    private readonly Caption _panicDesc = new() { HorizontalAlignment = HorizontalAlignment.Center };

    // ── Row 2: settings ──
    private readonly TsGlassPanel _settingsPanel = new();
    private readonly Label _settingsTitle = new();
    private readonly Label _homeGeofenceLabel = new();
    private readonly TsSelect _homeGeofenceSelect = new() { HorizontalAlignment = HorizontalAlignment.Stretch };
    private readonly Caption _homeGeofenceHelp = new();
    private readonly Label _sensitivityLabel = new();
    private readonly TsSelect _sensitivitySelect = new() { HorizontalAlignment = HorizontalAlignment.Stretch };
    private readonly TsToggle _autoPanicToggle = new();
    private readonly Caption _autoPanicHelp = new();
    private readonly TsButton _saveButton = new() { Variant = ButtonVariant.Primary, HorizontalAlignment = HorizontalAlignment.Left };

    // ── Row 3: live map ──
    private readonly TsGlassPanel _mapPanel = new();
    private readonly SectionTitle _mapTitle = new();
    private readonly Grid _mapHost = new() { MinHeight = MapHeight };
    private readonly TsMapControl _map = new() { MinHeight = MapHeight };
    private readonly TsMapLayerSwitcher _layerSwitcher = new() { HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(0, 8, 8, 0) };
    private readonly TsMapInvalidator _mapInvalidator = new();
    private readonly TsMapMarker _marker = new();
    private readonly TsMapCircle _homeCircle = new() { Visibility = Visibility.Collapsed };
    private readonly TsMapPolyline _eventTrail = new();
    private readonly GuardMapPopup _popup = new();
    private readonly TsEmptyState _mapEmpty = new() { IconGlyph = GuardModeProjection.MapEmptyGlyph, MinHeight = MapHeight, Visibility = Visibility.Collapsed };

    // ── Row 4: event timeline ──
    private readonly TsGlassPanel _eventsPanel = new();
    private readonly SectionTitle _eventsTitle = new();
    private readonly TsBadge _unackBadge = new() { Status = StatusKind.Danger, Visibility = Visibility.Collapsed };
    private readonly StackPanel _eventsList = new() { Spacing = 12 };
    private readonly TsEmptyState _eventsEmpty = new() { IconGlyph = "\uE946", Visibility = Visibility.Collapsed };

    private TsConfirmDialog? _panicDialog;

    /// <summary>Creates the page over the default empty feed and the shell resource localizer.</summary>
    public GuardModePage()
        : this(EmptyGuardModeFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The guard data + mutation port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public GuardModePage(IGuardModeFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _viewModel = new GuardModePageViewModel(feed, localizer);

        Content = BuildLayout();

        _vehicleSelect.SelectionChanged += OnVehicleSelectionChanged;
        _vehicleSelect.RetryRequested += OnRetryInvoked;
        _scaffold.RetryRequested += OnRetryInvoked;
        _layerSwitcher.StyleSelected += OnMapStyleSelected;
        _guardToggle.Toggled += OnGuardToggled;
        _autoPanicToggle.Toggled += OnAutoPanicToggled;
        _saveButton.Click += OnSaveClicked;
        _panicButton.Click += OnPanicClicked;
        _sensitivitySelect.SelectionChanged += OnSensitivityChanged;
        _homeGeofenceSelect.SelectionChanged += OnHomeGeofenceChanged;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The navigation route name the shell registers this page under (<c>GuardMode</c>).</summary>
    public static string RouteName => GuardModeRegistration.RouteName;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public GuardModePageViewModel ViewModel => _viewModel;

    private TsPageContainer BuildLayout()
    {
        _scaffold.AddHeaderAction(_vehicleSelect);
        _scaffold.AddHeaderAction(_freshness);
        _scaffold.PageContent = BuildScrollableContent();
        return _scaffold;
    }

    private ScrollViewer BuildScrollableContent()
    {
        var stack = new StackPanel { Spacing = SectionSpacing };
        stack.Children.Add(_toast);
        stack.Children.Add(_triggeredBanner);
        stack.Children.Add(BuildTopRow());
        stack.Children.Add(BuildSettingsPanel());
        stack.Children.Add(BuildMapPanel());
        stack.Children.Add(BuildEventsPanel());

        return new ScrollViewer
        {
            Content = stack,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
    }

    private TsGrid BuildTopRow()
    {
        var grid = new TsGrid { Columns = 3, Gutter = 16, ItemMinWidth = 260 };
        grid.Children.Add(BuildTogglePanel());
        grid.Children.Add(BuildStatusPanel());
        grid.Children.Add(BuildPanicPanel());
        return grid;
    }

    private TsGlassPanel BuildTogglePanel()
    {
        var column = new StackPanel { Spacing = 14, HorizontalAlignment = HorizontalAlignment.Center };
        var iconHost = new Border
        {
            Width = 80,
            Height = 80,
            CornerRadius = new CornerRadius(40),
            HorizontalAlignment = HorizontalAlignment.Center,
            Child = _shieldIcon,
            Padding = new Thickness(20),
        };
        column.Children.Add(iconHost);
        column.Children.Add(_statusHeadline);
        column.Children.Add(_guardToggle);
        column.Children.Add(_updatingText);

        _togglePanel.Padding = new Thickness(PanelPadding + 4);
        _togglePanel.Content = column;
        return _togglePanel;
    }

    private TsGlassPanel BuildStatusPanel()
    {
        var rows = new StackPanel { Spacing = 12 };
        rows.Children.Add(StatusRow(ClockGlyph, _armedSinceText));
        rows.Children.Add(StatusRow(LockGlyph, _lockText));
        rows.Children.Add(StatusRow(EyeGlyph, _sentryText));
        rows.Children.Add(StatusRow(AlertGlyph, _unackSummaryText));

        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(_statusTitle);
        column.Children.Add(rows);

        _statusPanel.Padding = new Thickness(PanelPadding + 4);
        _statusPanel.Content = column;
        return _statusPanel;
    }

    private TsGlassPanel BuildPanicPanel()
    {
        var column = new StackPanel { Spacing = 14, HorizontalAlignment = HorizontalAlignment.Center };
        column.Children.Add(new FontIcon { Glyph = SirenGlyph, FontSize = 40, HorizontalAlignment = HorizontalAlignment.Center, Foreground = DisplayTokens.Brush("TsColorDangerBrush") });
        column.Children.Add(_emergencyTitle);
        column.Children.Add(_panicButton);
        column.Children.Add(_panicDesc);

        _panicPanel.Padding = new Thickness(PanelPadding + 4);
        _panicPanel.Content = column;
        return _panicPanel;
    }

    private TsGlassPanel BuildSettingsPanel()
    {
        var homeColumn = new StackPanel { Spacing = 6 };
        homeColumn.Children.Add(_homeGeofenceLabel);
        homeColumn.Children.Add(_homeGeofenceSelect);
        homeColumn.Children.Add(_homeGeofenceHelp);

        var sensitivityColumn = new StackPanel { Spacing = 6 };
        sensitivityColumn.Children.Add(_sensitivityLabel);
        sensitivityColumn.Children.Add(_sensitivitySelect);

        var autoColumn = new StackPanel { Spacing = 6 };
        autoColumn.Children.Add(_autoPanicToggle);
        autoColumn.Children.Add(_autoPanicHelp);
        autoColumn.Children.Add(_saveButton);

        var grid = new TsGrid { Columns = 3, Gutter = 16, ItemMinWidth = 240 };
        grid.Children.Add(homeColumn);
        grid.Children.Add(sensitivityColumn);
        grid.Children.Add(autoColumn);

        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(_settingsTitle);
        column.Children.Add(grid);

        _settingsPanel.Padding = new Thickness(PanelPadding);
        _settingsPanel.Content = column;
        return _settingsPanel;
    }

    private TsGlassPanel BuildMapPanel()
    {
        _map.HorizontalAlignment = HorizontalAlignment.Stretch;
        _map.VerticalAlignment = VerticalAlignment.Stretch;
        _mapHost.Children.Add(_map);
        _mapHost.Children.Add(_layerSwitcher);
        _mapHost.Children.Add(_mapInvalidator);
        _mapHost.Children.Add(_mapEmpty);

        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(_mapTitle);
        column.Children.Add(_mapHost);

        _mapPanel.Padding = new Thickness(PanelPadding);
        _mapPanel.Content = column;
        return _mapPanel;
    }

    private TsGlassPanel BuildEventsPanel()
    {
        var header = new Grid();
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_eventsTitle, 0);
        Grid.SetColumn(_unackBadge, 1);
        header.Children.Add(_eventsTitle);
        header.Children.Add(_unackBadge);

        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(header);
        column.Children.Add(_eventsList);
        column.Children.Add(_eventsEmpty);

        _eventsPanel.Padding = new Thickness(PanelPadding);
        _eventsPanel.Content = column;
        return _eventsPanel;
    }

    private static Grid StatusRow(string glyph, TextBlock text)
    {
        ApplyBodyBrush(text);
        var icon = new FontIcon { Glyph = glyph, FontSize = 16, Foreground = DisplayTokens.TextMuted, VerticalAlignment = VerticalAlignment.Center };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        var grid = new Grid { ColumnSpacing = 8, VerticalAlignment = VerticalAlignment.Center };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetColumn(icon, 0);
        Grid.SetColumn(text, 1);
        grid.Children.Add(icon);
        grid.Children.Add(text);
        return grid;
    }

    private static void ApplyBodyBrush(TextBlock text) => text.Foreground = DisplayTokens.TextSecondary;

    // ── Lifecycle ──

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        _mapInvalidator.Attach(_map);
        _viewModel.NotifyOpened();
        await _viewModel.LoadAsync().ConfigureAwait(true);
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Unsubscribe from and dispose the view-model + hosted surfaces (CA1001).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _vehicleSelect.SelectionChanged -= OnVehicleSelectionChanged;
        _vehicleSelect.RetryRequested -= OnRetryInvoked;
        _scaffold.RetryRequested -= OnRetryInvoked;
        _layerSwitcher.StyleSelected -= OnMapStyleSelected;
        _guardToggle.Toggled -= OnGuardToggled;
        _autoPanicToggle.Toggled -= OnAutoPanicToggled;
        _saveButton.Click -= OnSaveClicked;
        _panicButton.Click -= OnPanicClicked;
        _sensitivitySelect.SelectionChanged -= OnSensitivityChanged;
        _homeGeofenceSelect.SelectionChanged -= OnHomeGeofenceChanged;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    // ── Event handlers ──

    private void OnViewModelChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (_dispatcher.HasThreadAccess)
        {
            Render(_viewModel.Display);
        }
        else
        {
            _dispatcher.TryEnqueue(() => Render(_viewModel.Display));
        }
    }

    private void OnRetryInvoked(object? sender, EventArgs e) => _ = _viewModel.RefreshAsync();

    private void OnVehicleSelectionChanged(object? sender, long? vehicleId)
    {
        if (_suppressEvents)
        {
            return;
        }

        _ = _viewModel.SetVehicleAsync(vehicleId);
    }

    private void OnMapStyleSelected(object? sender, MapStyleKind style) => _map.MapStyle = style;

    private void OnGuardToggled(object? sender, EventArgs e)
    {
        if (_suppressEvents)
        {
            return;
        }

        _ = _viewModel.ToggleGuardAsync();
    }

    private void OnAutoPanicToggled(object? sender, EventArgs e)
    {
        if (_suppressEvents)
        {
            return;
        }

        _viewModel.SetAutoPanic(_autoPanicToggle.IsOn);
    }

    private void OnSaveClicked(object sender, RoutedEventArgs e) => _ = _viewModel.SaveSettingsAsync();

    private void OnSensitivityChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppressEvents)
        {
            return;
        }

        _viewModel.SetSensitivity(SelectedTag(_sensitivitySelect));
    }

    private void OnHomeGeofenceChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppressEvents)
        {
            return;
        }

        _viewModel.SetHomeGeofence(SelectedTag(_homeGeofenceSelect));
    }

    private async void OnPanicClicked(object sender, RoutedEventArgs e)
    {
        var display = _viewModel.Display;
        _panicDialog ??= new TsConfirmDialog { IsDestructive = true };
        _panicDialog.XamlRoot = XamlRoot;
        _panicDialog.Title = display.PanicConfirmTitle;
        _panicDialog.Content = display.PanicConfirmMessage;
        _panicDialog.PrimaryButtonText = display.PanicConfirmLabel;
        _panicDialog.CloseButtonText = _localizer.GetString("common.cancel", "Cancel");

        var result = await _panicDialog.ShowAsync();
        if (result == ContentDialogResult.Primary)
        {
            await _viewModel.PanicAsync().ConfigureAwait(true);
        }
    }

    // ── Render ──

    private void Render(GuardModeDisplay display)
    {
        _scaffold.Title = display.Title;
        _scaffold.Subtitle = display.Subtitle;
        _scaffold.IsLoading = display.IsLoading;
        _scaffold.ErrorMessage = display.ShowError ? display.ErrorMessage : null;

        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;

        RenderVehicleSelect();
        RenderToast();
        RenderTriggeredBanner(display);
        RenderTogglePanel(display);
        RenderStatusPanel(display);
        RenderPanicPanel(display);
        RenderSettingsPanel(display);
        RenderMap(display);
        RenderEvents(display);
    }

    private void RenderVehicleSelect()
    {
        _suppressEvents = true;
        if (_viewModel.VehiclesLoading)
        {
            _vehicleSelect.SetLoading();
        }
        else if (_viewModel.VehiclesError is { } error)
        {
            _vehicleSelect.SetError(error);
        }
        else
        {
            _vehicleSelect.SetLoaded(_viewModel.Vehicles);
            _vehicleSelect.SelectedId = _viewModel.SelectedVehicleId;
        }

        _suppressEvents = false;
    }

    private void RenderToast()
    {
        if (_viewModel.ToastSequence == _lastToastSequence)
        {
            return;
        }

        _lastToastSequence = _viewModel.ToastSequence;
        if (string.IsNullOrEmpty(_viewModel.ToastMessage))
        {
            return;
        }

        _toast.Severity = _viewModel.ToastIsError ? InfoBarSeverity.Error : InfoBarSeverity.Success;
        _toast.Message = _viewModel.ToastMessage;
        _toast.IsOpen = true;
    }

    private void RenderTriggeredBanner(GuardModeDisplay display)
    {
        _triggeredBanner.Title = display.AlertTriggeredTitle;
        _triggeredBanner.Message = display.ShowTriggeredAlert
            ? string.Format(CultureInfo.CurrentCulture, "{0} — {1}", display.AlertEventLabel, display.AlertTimeLabel)
            : string.Empty;
        _triggeredBanner.IsOpen = display.ShowTriggeredAlert;
        _triggeredBanner.Visibility = display.ShowTriggeredAlert ? Visibility.Visible : Visibility.Collapsed;
    }

    private void RenderTogglePanel(GuardModeDisplay display)
    {
        _shieldIcon.Glyph = GuardModeProjection.ShieldGlyphFor(display.Shield);
        _shieldIcon.Foreground = display.Shield switch
        {
            GuardShieldState.Triggered => DisplayTokens.Brush("TsColorDangerBrush"),
            GuardShieldState.Armed => DisplayTokens.Brush("TsColorSuccessBrush"),
            _ => DisplayTokens.TextMuted,
        };

        _statusHeadline.Text = display.StatusHeadline;
        _statusHeadline.Foreground = DisplayTokens.TextPrimary;
        _guardToggle.Header = display.EnableGuardLabel;
        AutomationProperties.SetName(_guardToggle, display.EnableGuardLabel);

        _suppressEvents = true;
        _guardToggle.IsOn = display.IsArmed;
        _suppressEvents = false;

        _updatingText.Value = display.UpdatingLabel;
        _updatingText.Visibility = display.ShowUpdating ? Visibility.Visible : Visibility.Collapsed;
    }

    private void RenderStatusPanel(GuardModeDisplay display)
    {
        _statusTitle.Value = display.StatusTitle;
        _armedSinceText.Text = display.ArmedSinceText;
        _lockText.Text = display.LockText;
        _sentryText.Text = display.SentryText;
        _unackSummaryText.Text = display.UnackSummaryText;
    }

    private void RenderPanicPanel(GuardModeDisplay display)
    {
        _emergencyTitle.Value = display.EmergencyTitle;
        _panicButton.Text = display.PanicButtonLabel;
        _panicButton.IsLoading = display.PanicPending;
        _panicButton.IsEnabled = !display.PanicPending && _viewModel.SelectedVehicleId is { } id && id > 0;
        _panicDesc.Value = display.PanicDescription;
    }

    private void RenderSettingsPanel(GuardModeDisplay display)
    {
        _settingsTitle.Value = display.SettingsTitle;
        _homeGeofenceLabel.Value = display.HomeGeofenceLabel;
        _homeGeofenceHelp.Value = display.HomeGeofenceHelp;
        _sensitivityLabel.Value = display.SensitivityLabel;
        _autoPanicToggle.Header = display.AutoPanicLabel;
        AutomationProperties.SetName(_autoPanicToggle, display.AutoPanicLabel);
        _autoPanicHelp.Value = display.AutoPanicHelp;
        _saveButton.Text = display.SaveSettingsLabel;
        _saveButton.IsLoading = display.SavePending;

        _suppressEvents = true;
        RebuildOptions(_sensitivitySelect, display.SensitivityOptions.Select(o => (o.Value, o.Label)), display.SelectedSensitivity);
        RebuildOptions(_homeGeofenceSelect, display.GeofenceOptions.Select(o => (o.Value, o.Label)), display.SelectedGeofenceId);
        _autoPanicToggle.IsOn = display.AutoPanicChecked;
        _suppressEvents = false;
    }

    private void RenderMap(GuardModeDisplay display)
    {
        _mapTitle.Value = display.LiveMapTitle;
        _mapEmpty.Message = display.NoLocationMessage;

        if (!display.HasLocation)
        {
            _map.Visibility = Visibility.Collapsed;
            _layerSwitcher.Visibility = Visibility.Collapsed;
            _mapEmpty.Visibility = Visibility.Visible;
            return;
        }

        _map.Visibility = Visibility.Visible;
        _layerSwitcher.Visibility = Visibility.Visible;
        _mapEmpty.Visibility = Visibility.Collapsed;

        EnsureMapOverlays();

        _map.CenterLat = display.VehicleLat;
        _map.CenterLng = display.VehicleLng;
        _map.Zoom = MapZoom;

        _marker.Location = new GeoPoint(display.VehicleLat, display.VehicleLng);
        _marker.LabelText = display.MarkerLabel;

        _popup.SetContent(display.MarkerLabel, display.MarkerPopupCoords);
        _popup.Location = new GeoPoint(display.VehicleLat, display.VehicleLng);

        if (display.HasHomeGeofence)
        {
            _homeCircle.Visibility = Visibility.Visible;
            _homeCircle.Center = new GeoPoint(display.HomeGeofenceLat, display.HomeGeofenceLng);
            _homeCircle.RadiusMeters = display.HomeGeofenceRadius;
            _homeCircle.SetBrushes(
                new SolidColorBrush(Microsoft.UI.Colors.DodgerBlue) { Opacity = 0.6 },
                new SolidColorBrush(Microsoft.UI.Colors.DodgerBlue) { Opacity = 0.15 });
        }
        else
        {
            _homeCircle.Visibility = Visibility.Collapsed;
        }

        _eventTrail.SetPoints(Array.Empty<GeoPoint>());
        _eventTrail.SetStroke(new SolidColorBrush(Microsoft.UI.Colors.Red));

        _map.SetHasGeometry(true);
        _map.Invalidate();
    }

    private void EnsureMapOverlays()
    {
        if (_mapOverlaysAttached)
        {
            return;
        }

        _map.AddOverlay(_eventTrail);
        _map.AddOverlay(_homeCircle);
        _map.AddOverlay(_marker);
        _map.AddOverlay(_popup);
        _mapOverlaysAttached = true;
    }

    private void RenderEvents(GuardModeDisplay display)
    {
        _eventsTitle.Value = display.EventTimelineTitle;
        _eventsEmpty.Message = display.NoEventsMessage;

        _unackBadge.Content = display.UnackBadgeText;
        _unackBadge.Visibility = display.ShowUnackBadge ? Visibility.Visible : Visibility.Collapsed;

        _eventsList.Children.Clear();
        foreach (var row in display.Events)
        {
            _eventsList.Children.Add(BuildEventRow(row));
        }

        _eventsList.Visibility = display.HasEvents ? Visibility.Visible : Visibility.Collapsed;
        _eventsEmpty.Visibility = display.HasEvents ? Visibility.Collapsed : Visibility.Visible;
    }

    private Border BuildEventRow(GuardEventRow row)
    {
        var icon = new FontIcon
        {
            Glyph = row.Glyph,
            FontSize = 18,
            Foreground = DisplayTokens.Brush(row.AccentBrushKey),
            VerticalAlignment = VerticalAlignment.Top,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        var badgeRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        var badge = new TsBadge { Status = row.BadgeStatus, Content = row.BadgeLabel };
        badgeRow.Children.Add(badge);
        badgeRow.Children.Add(new Caption { Value = row.TimeLabel, VerticalAlignment = VerticalAlignment.Center });

        var body = new StackPanel { Spacing = 4, VerticalAlignment = VerticalAlignment.Center };
        body.Children.Add(badgeRow);
        if (row.TransitionText is { } transition)
        {
            body.Children.Add(new Caption { Value = transition });
        }

        if (row.AcknowledgedByText is { } acknowledgedBy)
        {
            body.Children.Add(new Caption { Value = acknowledgedBy });
        }

        var grid = new Grid { ColumnSpacing = 12, Padding = new Thickness(12) };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(icon, 0);
        Grid.SetColumn(body, 1);
        grid.Children.Add(icon);
        grid.Children.Add(body);

        if (row.ShowAckButton)
        {
            var ackButton = new TsButton
            {
                Variant = ButtonVariant.Secondary,
                Size = ControlSize.Small,
                Text = row.AckLabel,
                VerticalAlignment = VerticalAlignment.Top,
                Tag = row.Id,
            };
            ackButton.Click += OnAcknowledgeClicked;
            Grid.SetColumn(ackButton, 2);
            grid.Children.Add(ackButton);
        }

        var border = new Border
        {
            Child = grid,
            CornerRadius = new CornerRadius(8),
            BorderThickness = new Thickness(1),
            BorderBrush = row.Acknowledged ? DisplayTokens.Border : DisplayTokens.Brush("TsColorDangerBrush"),
            Background = DisplayTokens.Surface,
        };
        AutomationProperties.SetName(border, row.AutomationName);
        return border;
    }

    private void OnAcknowledgeClicked(object sender, RoutedEventArgs e)
    {
        if (sender is TsButton { Tag: long id })
        {
            _ = _viewModel.AcknowledgeAsync(id);
        }
    }

    private static void RebuildOptions(TsSelect select, IEnumerable<(string Value, string Label)> options, string selectedValue)
    {
        select.Items.Clear();
        ComboBoxItem? selected = null;
        foreach (var (value, label) in options)
        {
            var item = new ComboBoxItem { Content = label, Tag = value };
            select.Items.Add(item);
            if (string.Equals(value, selectedValue, StringComparison.Ordinal))
            {
                selected = item;
            }
        }

        select.SelectedItem = selected;
    }

    private static string SelectedTag(TsSelect select) =>
        select.SelectedItem is ComboBoxItem { Tag: string value } ? value : string.Empty;
}

/// <summary>
/// A geographic popup pinned above the vehicle marker (port of the web map <c>Popup</c> nested inside the
/// guard <c>Marker</c>). Implements <see cref="IMapOverlay"/> so the map reprojects it on every viewport
/// change; it shows the vehicle name + its <c>lat, lng</c> coordinates exactly like the web <c>MapPopup</c>.
/// </summary>
public sealed partial class GuardMapPopup : ContentControl, IMapOverlay
{
    private readonly TextBlock _name = new() { FontWeight = FontWeights.SemiBold, FontSize = 13 };
    private readonly TextBlock _coords = new() { FontSize = 11, Foreground = DisplayTokens.TextMuted };

    /// <summary>Creates the popup card.</summary>
    public GuardMapPopup()
    {
        IsTabStop = false;
        IsHitTestVisible = false;

        var column = new StackPanel { Spacing = 2 };
        column.Children.Add(_name);
        column.Children.Add(_coords);

        Content = new Border
        {
            Child = column,
            Background = DisplayTokens.Surface,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(8),
            Padding = new Thickness(10, 6, 10, 6),
        };
    }

    /// <summary>The popup's geographic anchor (the vehicle position).</summary>
    public GeoPoint Location { get; set; }

    /// <summary>Set the vehicle name + coordinate lines (web <c>MapPopup</c> body).</summary>
    public void SetContent(string vehicleName, string coordinates)
    {
        _name.Text = vehicleName;
        _coords.Text = coordinates;
        AutomationProperties.SetName(this, string.IsNullOrEmpty(coordinates) ? vehicleName : $"{vehicleName}. {coordinates}");
    }

    /// <summary>Reposition the popup just above its anchor on the overlay canvas.</summary>
    public void Project(IMapProjection projection)
    {
        ArgumentNullException.ThrowIfNull(projection);
        var screen = projection.ToScreen(Location);
        Canvas.SetLeft(this, screen.X - (ActualWidth > 0 ? ActualWidth / 2 : 60));
        Canvas.SetTop(this, screen.Y - (ActualHeight > 0 ? ActualHeight + 28 : 60));
    }
}
