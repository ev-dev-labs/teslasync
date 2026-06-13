using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Driving;

/// <summary>
/// The native WinUI 3 <c>TripPlannerPage</c> — a parity port of the web page
/// <c>web/src/features/driving/pages/TripPlannerPage.tsx</c> (route <c>/trip-planner</c>, nav name
/// <c>TripPlanner</c>). It binds to a <see cref="TripPlannerPageViewModel"/> and renders every web region with
/// Fluent components and design tokens: the page header; <b>GlassPanel1</b> — the Plan Your Trip form (the two
/// <see cref="AddressInput"/> origin/destination fields, the current- and minimum-arrival-SOC sliders, the
/// driving-speed select, the Plan Trip / Send to Car actions with the vehicle-battery caption and the plan-error
/// banner); the estimate disclaimer; the <see cref="TripPlannerMap"/>; the six trip-summary stat tiles
/// (<b>Distance / Total-Time / Driving / Charging / Energy / Est-Cost</b>); the feasibility warning;
/// <b>GlassPanel8</b> — the Weather Impact panel; the <see cref="SOCRouteChart"/>; and the
/// <see cref="TripLegList"/>. The view is a thin renderer: all branch selection, SI conversion, formatting and i18n
/// happen in the view-model's <see cref="TripPlannerDisplay"/> projection. The plan mutation's loading / error /
/// success states are surfaced on the action button (spinner + disabled), the error banner, and the result regions
/// respectively. State changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class TripPlannerPage : UserControl, IDisposable
{
    private const string NavGlyph = "\uE8AD";          // MapDirections (web Navigation)
    private const string BatteryGlyph = "\uE83E";      // battery (web Battery)
    private const string ThermometerGlyph = "\uE9CA";  // thermometer-ish (web Thermometer)

    private readonly TripPlannerPageViewModel _viewModel;
    private readonly DispatcherQueue? _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;
    private bool _started;
    private bool _suppressSpeed;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();

    // GlassPanel1 — Plan Your Trip form.
    private readonly TsGlassPanel _formPanel = new() { Padding = new Thickness(24), Glow = GlassGlow.Green };
    private readonly SectionTitle _formTitle = new();
    private readonly AddressInput _originInput;
    private readonly AddressInput _destInput;
    private readonly Label _currentSocLabel = new();
    private readonly TsSlider _currentSocSlider = new() { Minimum = 10, Maximum = 100, StepFrequency = 1, MinWidth = 140 };
    private readonly Caption _currentSocValue = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly Label _minArrivalLabel = new();
    private readonly TsSlider _minArrivalSlider = new() { Minimum = 5, Maximum = 50, StepFrequency = 1, MinWidth = 140 };
    private readonly Caption _minArrivalValue = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly Label _speedLabel = new();
    private readonly TsSelect _speedSelect = new() { HorizontalAlignment = HorizontalAlignment.Stretch };
    private readonly TsButton _planButton = new() { Variant = ButtonVariant.Primary, IconGlyph = "\uE8AD" };
    private readonly TsButton _sendButton = new() { Variant = ButtonVariant.Secondary, IconGlyph = "\uE724", Visibility = Visibility.Collapsed };
    private readonly StackPanel _batteryHost = new() { Orientation = Orientation.Horizontal, Spacing = 4, VerticalAlignment = VerticalAlignment.Center, Visibility = Visibility.Collapsed };
    private readonly Caption _vehicleBattery = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsAlertBanner _planError = new() { Variant = CalloutVariant.Danger, Visibility = Visibility.Collapsed };

    // Estimate disclaimer.
    private readonly TsAlertBanner _disclaimer = new() { Variant = CalloutVariant.Warning, Visibility = Visibility.Collapsed };
    private readonly TsFadeIn _disclaimerHost = new() { DelayMs = 20, Visibility = Visibility.Collapsed };

    // Map.
    private readonly TripPlannerMap _map;

    // Trip summary stats — Distance / Total-Time / Driving / Charging / Energy / Est-Cost.
    private readonly TsStatCard _distanceCard = new();
    private readonly TsStatCard _totalTimeCard = new();
    private readonly TsStatCard _drivingCard = new();
    private readonly TsStatCard _chargingCard = new();
    private readonly TsStatCard _energyCard = new();
    private readonly TsStatCard _costCard = new();
    private readonly TsFadeIn _statsHost = new() { DelayMs = 40, Visibility = Visibility.Collapsed };

    // Feasibility warning.
    private readonly TsAlertBanner _feasibility = new() { Variant = CalloutVariant.Danger, Visibility = Visibility.Collapsed };

    // GlassPanel8 — Weather Impact.
    private readonly TsGlassPanel _weatherPanel = new() { Padding = new Thickness(16) };
    private readonly PanelTitle _weatherTitle = new();
    private readonly Text _weatherNote = new();
    private readonly Caption _weatherFactor = new();
    private readonly TsFadeIn _weatherHost = new() { DelayMs = 50, Visibility = Visibility.Collapsed };

    // SOC chart + leg-by-leg breakdown.
    private readonly SOCRouteChart _socChart;
    private readonly TripLegList _legList;

    /// <summary>Creates the page over the default no-op ports and the shell resource localizer.</summary>
    public TripPlannerPage()
        : this(
            NoopPlanTripClient.Instance,
            NoopSendToCarClient.Instance,
            TripPlannerNoVehicleSource.Instance,
            EmptyTripGeocodeSource.Instance,
            ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over explicit data ports and a localizer (used by tests / DI hosts).</summary>
    /// <param name="planClient">The plan mutation port (native <c>usePlanTrip</c>).</param>
    /// <param name="sendToCarClient">The send-to-car command port (native <c>handleSendToCar</c>).</param>
    /// <param name="vehicles">The selected/primary vehicle source (native <c>useSelectedVehicle</c>).</param>
    /// <param name="geocodeSource">The geocode autocomplete port both address fields share.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="units">The user's display-unit preference; null = metric.</param>
    /// <param name="currencySymbol">The account currency symbol; null = "$".</param>
    public TripPlannerPage(
        IPlanTripClient planClient,
        ISendToCarClient sendToCarClient,
        IWidgetVehicleSource vehicles,
        IAddressGeocodeSource geocodeSource,
        ILocalizer localizer,
        UnitPref? units = null,
        string? currencySymbol = null)
    {
        ArgumentNullException.ThrowIfNull(planClient);
        ArgumentNullException.ThrowIfNull(sendToCarClient);
        ArgumentNullException.ThrowIfNull(vehicles);
        ArgumentNullException.ThrowIfNull(geocodeSource);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new TripPlannerPageViewModel(planClient, sendToCarClient, vehicles, localizer, units, currencySymbol);

        _originInput = new AddressInput(geocodeSource, localizer);
        _destInput = new AddressInput(geocodeSource, localizer);
        _map = new TripPlannerMap(localizer);
        _socChart = new SOCRouteChart(localizer);
        _legList = new TripLegList(localizer, null, _viewModel.CurrencySymbol);

        InitialiseControls();
        Content = BuildLayout();

        _originInput.LocationSelected += OnOriginSelected;
        _destInput.LocationSelected += OnDestinationSelected;
        _currentSocSlider.ValueChanged += OnCurrentSocChanged;
        _minArrivalSlider.ValueChanged += OnMinArrivalChanged;
        _speedSelect.SelectionChanged += OnSpeedChanged;
        _planButton.Click += OnPlanClicked;
        _sendButton.Click += OnSendClicked;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>The navigation route name the shell registers this page under (<c>TripPlanner</c>).</summary>
    public static string RouteName => TripPlannerRegistration.RouteName;

    /// <summary>The diagnostics surface slug (<c>TripPlannerPage</c>).</summary>
    public static string Slug => TripPlannerRegistration.Slug;

    private void InitialiseControls()
    {
        _currentSocSlider.Value = _viewModel.CurrentSoc;
        _minArrivalSlider.Value = _viewModel.MinArrivalSoc;
        _currentSocValue.Value = FormatPercent(_viewModel.CurrentSoc);
        _minArrivalValue.Value = FormatPercent(_viewModel.MinArrivalSoc);

        _speedSelect.DisplayMemberPath = nameof(TripSpeedOption.Label);
        _speedSelect.ItemsSource = _viewModel.Display.SpeedOptions;
        SyncSpeedSelection();
    }

    private ScrollViewer BuildLayout()
    {
        var header = new StackPanel { Spacing = 4 };
        header.Children.Add(_title);
        header.Children.Add(_subtitle);

        _disclaimerHost.Content = _disclaimer;
        _statsHost.Content = BuildStatsGrid();
        _weatherHost.Content = BuildWeatherPanel();

        var stack = new StackPanel { Spacing = 24, Padding = new Thickness(24) };
        stack.Children.Add(header);
        stack.Children.Add(new TsFadeIn { Content = BuildFormPanel() });
        stack.Children.Add(_disclaimerHost);
        stack.Children.Add(new TsFadeIn { DelayMs = 30, Content = _map });
        stack.Children.Add(_statsHost);
        stack.Children.Add(_feasibility);
        stack.Children.Add(_weatherHost);
        stack.Children.Add(new TsFadeIn { DelayMs = 60, Content = _socChart });
        stack.Children.Add(new TsFadeIn { DelayMs = 70, Content = _legList });

        return new ScrollViewer
        {
            Content = stack,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollMode = ScrollMode.Disabled,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
        };
    }

    private TsGlassPanel BuildFormPanel()
    {
        var titleRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        var navIcon = new FontIcon { Glyph = NavGlyph, FontSize = 18, Foreground = TypographyTokens.Brush("TsColorSuccessBrush") };
        AutomationProperties.SetAccessibilityView(navIcon, AccessibilityView.Raw);
        titleRow.Children.Add(navIcon);
        titleRow.Children.Add(_formTitle);

        var addressGrid = new Grid { ColumnSpacing = 16, RowSpacing = 16 };
        addressGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        addressGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Place(addressGrid, _originInput, 0, 0);
        Place(addressGrid, _destInput, 0, 1);

        var controlsGrid = new Grid { ColumnSpacing = 16, RowSpacing = 16 };
        for (int i = 0; i < 3; i++)
        {
            controlsGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        var currentSocRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        currentSocRow.Children.Add(_currentSocSlider);
        currentSocRow.Children.Add(_currentSocValue);

        var minArrivalRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        minArrivalRow.Children.Add(_minArrivalSlider);
        minArrivalRow.Children.Add(_minArrivalValue);

        Place(controlsGrid, Field(_currentSocLabel, currentSocRow), 0, 0);
        Place(controlsGrid, Field(_minArrivalLabel, minArrivalRow), 0, 1);
        Place(controlsGrid, Field(_speedLabel, _speedSelect), 0, 2);

        var batteryIcon = new FontIcon { Glyph = BatteryGlyph, FontSize = 14, Foreground = TypographyTokens.Brush("TsColorTextMutedBrush") };
        AutomationProperties.SetAccessibilityView(batteryIcon, AccessibilityView.Raw);
        _batteryHost.Children.Add(batteryIcon);
        _batteryHost.Children.Add(_vehicleBattery);

        var actionRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12, VerticalAlignment = VerticalAlignment.Center };
        actionRow.Children.Add(_planButton);
        actionRow.Children.Add(_sendButton);
        actionRow.Children.Add(_batteryHost);

        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(titleRow);
        column.Children.Add(addressGrid);
        column.Children.Add(controlsGrid);
        column.Children.Add(actionRow);
        column.Children.Add(_planError);
        _formPanel.Content = column;
        return _formPanel;
    }

    private Grid BuildStatsGrid()
    {
        var grid = new Grid { ColumnSpacing = 16, RowSpacing = 16 };
        for (int i = 0; i < 3; i++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

        Place(grid, _distanceCard, 0, 0);
        Place(grid, _totalTimeCard, 0, 1);
        Place(grid, _drivingCard, 0, 2);
        Place(grid, _chargingCard, 1, 0);
        Place(grid, _energyCard, 1, 1);
        Place(grid, _costCard, 1, 2);
        return grid;
    }

    private TsGlassPanel BuildWeatherPanel()
    {
        var titleRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
        var icon = new FontIcon { Glyph = ThermometerGlyph, FontSize = 18, Foreground = TypographyTokens.Brush("TsColorWarningBrush"), VerticalAlignment = VerticalAlignment.Top };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        var body = new StackPanel { Spacing = 4 };
        body.Children.Add(_weatherTitle);
        body.Children.Add(_weatherNote);
        body.Children.Add(_weatherFactor);

        titleRow.Children.Add(icon);
        titleRow.Children.Add(body);
        _weatherPanel.Content = titleRow;
        return _weatherPanel;
    }

    private static StackPanel Field(Label label, FrameworkElement control)
    {
        var field = new StackPanel { Spacing = 6 };
        field.Children.Add(label);
        field.Children.Add(control);
        return field;
    }

    private static void Place(Grid grid, FrameworkElement element, int row, int column)
    {
        element.HorizontalAlignment = HorizontalAlignment.Stretch;
        Grid.SetRow(element, row);
        Grid.SetColumn(element, column);
        grid.Children.Add(element);
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _viewModel.NotifyOpened();
        _ = _viewModel.LoadAsync();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnOriginSelected(object? sender, AddressSelection selection) =>
        _viewModel.Origin = new TripLocationModel(selection.Lat, selection.Lng, selection.Name);

    private void OnDestinationSelected(object? sender, AddressSelection selection) =>
        _viewModel.Destination = new TripLocationModel(selection.Lat, selection.Lng, selection.Name);

    private void OnCurrentSocChanged(object sender, Microsoft.UI.Xaml.Controls.Primitives.RangeBaseValueChangedEventArgs e)
    {
        _viewModel.CurrentSoc = (int)Math.Round(e.NewValue, MidpointRounding.AwayFromZero);
        _currentSocValue.Value = FormatPercent(_viewModel.CurrentSoc);
    }

    private void OnMinArrivalChanged(object sender, Microsoft.UI.Xaml.Controls.Primitives.RangeBaseValueChangedEventArgs e)
    {
        _viewModel.MinArrivalSoc = (int)Math.Round(e.NewValue, MidpointRounding.AwayFromZero);
        _minArrivalValue.Value = FormatPercent(_viewModel.MinArrivalSoc);
    }

    private void OnSpeedChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppressSpeed)
        {
            return;
        }

        if (_speedSelect.SelectedItem is TripSpeedOption option)
        {
            _viewModel.SpeedFactor = option.Factor;
        }
    }

    private void OnPlanClicked(object sender, RoutedEventArgs e) => InvokeAsync(() => _viewModel.PlanAsync());

    private void OnSendClicked(object sender, RoutedEventArgs e) => InvokeAsync(() => _viewModel.SendToCarAsync());

    private void OnViewModelChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (_dispatcher is null || _dispatcher.HasThreadAccess)
        {
            Render();
        }
        else
        {
            _dispatcher.TryEnqueue(Render);
        }
    }

    private void Render()
    {
        if (_disposed)
        {
            return;
        }

        var d = _viewModel.Display;

        _title.Value = d.Title;
        _subtitle.Value = d.Subtitle;
        AutomationProperties.SetName(this, d.AutomationName);

        RenderForm(d);
        RenderDisclaimer(d);
        RenderMap();
        RenderStats(d);
        RenderFeasibility(d);
        RenderWeather(d);
        RenderResultSurfaces();
    }

    private void RenderForm(TripPlannerDisplay d)
    {
        _formTitle.Value = d.FormTitle;
        _originInput.Label = d.FromLabel;
        _originInput.PromptText = d.OriginPrompt;
        _destInput.Label = d.ToLabel;
        _destInput.PromptText = d.DestinationPrompt;
        _currentSocLabel.Value = d.CurrentSocLabel;
        _minArrivalLabel.Value = d.MinArrivalLabel;
        _speedLabel.Value = d.DrivingSpeedLabel;

        _planButton.Text = d.PlanButtonText;
        _planButton.IsLoading = _viewModel.IsPlanning;
        _planButton.IsEnabled = _viewModel.CanPlan;
        AutomationProperties.SetName(_planButton, d.PlanButtonText);

        _sendButton.Text = d.SendToCarText;
        _sendButton.Visibility = Show(_viewModel.CanSendToCar);
        AutomationProperties.SetName(_sendButton, d.SendToCarText);

        _vehicleBattery.Value = d.VehicleBatteryText;
        _batteryHost.Visibility = Show(d.HasVehicleBattery);
        AutomationProperties.SetName(_batteryHost, d.VehicleBatteryText);

        _planError.Message = d.PlanErrorText;
        _planError.Visibility = Show(d.ShowPlanError);
        AutomationProperties.SetName(_formPanel, d.FormTitle);
    }

    private void RenderDisclaimer(TripPlannerDisplay d)
    {
        _disclaimer.Message = d.DisclaimerText;
        _disclaimerHost.Visibility = Show(d.ShowDisclaimer);
        AutomationProperties.SetName(_disclaimer, d.DisclaimerText);
    }

    private void RenderMap()
    {
        var origin = ToInput(_viewModel.Origin);
        var destination = ToInput(_viewModel.Destination);
        var result = _viewModel.Result;
        var legs = result?.MapLegs ?? [];
        var stops = result?.MapStops ?? [];
        _map.Model = new TripPlannerMapModel(new TripPlannerRoute(origin, destination, legs, stops));
    }

    private void RenderStats(TripPlannerDisplay d)
    {
        RenderStat(_distanceCard, d, "distance");
        RenderStat(_totalTimeCard, d, "totalTime");
        RenderStat(_drivingCard, d, "drivingTime");
        RenderStat(_chargingCard, d, "chargingTime");
        RenderStat(_energyCard, d, "energy");
        RenderStat(_costCard, d, "cost");
        _statsHost.Visibility = Show(d.ShowStats);
    }

    private static void RenderStat(TsStatCard card, TripPlannerDisplay d, string key)
    {
        var stat = FindStat(d, key);
        card.Label = stat.Label;
        card.Value = stat.Value;
        card.Glyph = stat.Glyph;
        AutomationProperties.SetName(card, stat.AutomationName);
    }

    private static TripStat FindStat(TripPlannerDisplay d, string key)
    {
        foreach (var stat in d.Stats)
        {
            if (string.Equals(stat.Key, key, StringComparison.Ordinal))
            {
                return stat;
            }
        }

        return new TripStat(key, string.Empty, string.Empty, string.Empty, string.Empty);
    }

    private void RenderFeasibility(TripPlannerDisplay d)
    {
        _feasibility.Message = d.NotFeasibleText;
        _feasibility.Visibility = Show(d.ShowFeasibilityWarning);
        AutomationProperties.SetName(_feasibility, d.NotFeasibleText);
    }

    private void RenderWeather(TripPlannerDisplay d)
    {
        _weatherTitle.Value = d.WeatherTitle;
        _weatherNote.Value = d.WeatherNote;
        _weatherFactor.Value = d.WeatherFactorText;
        _weatherFactor.Visibility = Show(d.ShowWeatherFactor);
        _weatherHost.Visibility = Show(d.ShowWeather);
        AutomationProperties.SetName(_weatherPanel, d.WeatherTitle);
    }

    private void RenderResultSurfaces()
    {
        var result = _viewModel.Result;

        _socChart.Model = result is null
            ? SOCRouteChartModel.Empty
            : SOCRouteChartModel.Loaded(result.SocCurve, result.ChargeStopSocs, _viewModel.MinArrivalSoc);

        _legList.Model = result is null
            ? TripLegListModel.Empty
            : TripLegListModel.FromJson(result.RawPlan, _viewModel.DistanceUnit);
    }

    private void SyncSpeedSelection()
    {
        _suppressSpeed = true;
        TripSpeedOption? selected = null;
        foreach (var option in _viewModel.Display.SpeedOptions)
        {
            if (Math.Abs(option.Factor - _viewModel.SpeedFactor) < 0.001)
            {
                selected = option;
                break;
            }
        }

        _speedSelect.SelectedItem = selected;
        _suppressSpeed = false;
    }

    private static TripLocationInput? ToInput(TripLocationModel? model) =>
        model is null ? null : new TripLocationInput(model.Lat, model.Lng, model.Name);

    private static string FormatPercent(int value) =>
        string.Create(System.Globalization.CultureInfo.CurrentCulture, $"{value}%");

    private static async void InvokeAsync(Func<Task> action) => await action().ConfigureAwait(true);

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;

    /// <summary>Unsubscribe from and dispose the view-model and owned sub-surfaces (CA1001).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _originInput.LocationSelected -= OnOriginSelected;
        _destInput.LocationSelected -= OnDestinationSelected;
        _currentSocSlider.ValueChanged -= OnCurrentSocChanged;
        _minArrivalSlider.ValueChanged -= OnMinArrivalChanged;
        _speedSelect.SelectionChanged -= OnSpeedChanged;
        _planButton.Click -= OnPlanClicked;
        _sendButton.Click -= OnSendClicked;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;

        _originInput.Dispose();
        _destInput.Dispose();
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new TripPlannerPageAutomationPeer(this);

    private sealed class TripPlannerPageAutomationPeer(TripPlannerPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
