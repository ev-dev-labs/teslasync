using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Forms;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 Drive-Analytics feature surface — a parity port of
/// web/src/features/driving/components/driving-dynamics/DriveAnalyticsSection.tsx. It reproduces the web
/// section's heading, its date <c>RangePicker</c> and its three <c>ChartContainer</c> cards: a Speed
/// Distribution bar chart (drives bucketed by average speed), an Acceleration Patterns scatter (peak power vs
/// trip distance, with the mean-power reference line) and a Power Profile dual-area (peak and regen power for
/// the recent drives). The web component is a pure child of the Driving-Dynamics page that receives an
/// already-filtered drive array; the native feature-view owns its cache-then-network drive-list read plus the
/// date range, so it renders every state the P2 contract mandates — a loading skeleton, the populated cards,
/// friendly empty surfaces, an explicit retry surface on hard failure, plus stale and offline freshness chips.
/// All data flows through the shared <see cref="DriveAnalyticsSectionViewModel"/>; the view never performs
/// HTTP. Every string resolves through the i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class DriveAnalyticsSection : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const double ChartHeight = 260;        // web ChartContainer height={300}/{320}
    private const int FadeInDelayMs = 450;         // web <FadeIn delay={0.45}>

    private readonly DriveAnalyticsSectionViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly DriveAnalyticsSectionDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly TsFadeIn _fade = new() { DelayMs = FadeInDelayMs };
    private readonly StackPanel _root = new() { Spacing = 16 };
    private readonly Grid _header = new();
    private readonly SectionTitle _title = new();
    private readonly StackPanel _actions = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 8,
        HorizontalAlignment = HorizontalAlignment.Right,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TsBadge _freshnessChip = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TextBlock _freshnessChipText = new() { FontSize = 12 };
    private readonly TsDataFreshness _freshness = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsButton _refresh = new()
    {
        Variant = ButtonVariant.Subtle,
        Size = ControlSize.Small,
        IconGlyph = RefreshGlyph,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly Border _bodyHost = new();
    private readonly StackPanel _contentRoot = new() { Spacing = 16 };
    private readonly TsRangePicker _rangePicker = new();
    private readonly TsChartContainer _speedCard = new();
    private readonly TsChartContainer _accelCard = new();
    private readonly TsChartContainer _powerCard = new();
    private readonly StackPanel _loadingRoot = new() { Spacing = 16 };
    private readonly TsQueryError _errorView = new() { VerticalAlignment = VerticalAlignment.Center };

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;
    private bool _suppressRange;

    /// <summary>Creates the surface over its data source, localizer, (optional) diagnostics, units and range.</summary>
    /// <param name="source">The cache-then-network drive-list source.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink; a private collector is used when null.</param>
    /// <param name="units">The user's unit preference (web <c>useUnits</c>); defaults to metric when null.</param>
    /// <param name="range">The initial date range; defaults to the last 30 days (web page default).</param>
    public DriveAnalyticsSection(
        IDriveAnalyticsSectionSource source,
        ILocalizer localizer,
        DriveAnalyticsSectionDiagnostics? diagnostics = null,
        UnitPref? units = null,
        DateRange? range = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new DriveAnalyticsSectionDiagnostics();
        _viewModel = new DriveAnalyticsSectionViewModel(source, localizer, units, range);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        AutomationProperties.SetName(this, _viewModel.Title);

        BuildChrome();

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        _refresh.Click += OnRefreshClick;
        _rangePicker.RangeChanged += OnRangePicked;
        _errorView.ActionInvoked += OnRetry;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Content = _fade;
        Render();
    }

    /// <summary>The canonical surface id (<c>drive-analytics-section</c>).</summary>
    public static string SurfaceId => DriveAnalyticsSectionRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public DriveAnalyticsSectionViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="DriveAnalyticsSectionSource"/> from the
    /// shared data layer (the host's P2-core dependencies), scoped to an explicit <paramref name="vehicleId"/>
    /// or — when null — the primary vehicle.
    /// </summary>
    public static DriveAnalyticsSection Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        long? vehicleId = null,
        DriveAnalyticsSectionDiagnostics? diagnostics = null,
        UnitPref? units = null,
        DateRange? range = null)
    {
        var source = new DriveAnalyticsSectionSource(vehicles, api, engine, options, vehicleId);
        return new DriveAnalyticsSection(source, localizer, diagnostics, units, range);
    }

    private void BuildChrome()
    {
        _freshnessChip.Content = _freshnessChipText;
        _actions.Children.Add(_freshnessChip);
        _actions.Children.Add(_freshness);
        _actions.Children.Add(_refresh);

        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_title, 0);
        Grid.SetColumn(_actions, 1);
        _header.Children.Add(_title);
        _header.Children.Add(_actions);

        var topRow = new Grid { ColumnSpacing = 16, RowSpacing = 16 };
        topRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        topRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetColumn(_speedCard, 0);
        Grid.SetColumn(_accelCard, 1);
        topRow.Children.Add(_speedCard);
        topRow.Children.Add(_accelCard);

        _contentRoot.Children.Add(_rangePicker);
        _contentRoot.Children.Add(topRow);
        _contentRoot.Children.Add(_powerCard);

        for (int i = 0; i < 3; i++)
        {
            _loadingRoot.Children.Add(new TsSkeleton
            {
                BlockHeight = ChartHeight,
                ReduceMotion = MotionPreference.ReduceMotion,
            });
        }

        _root.Children.Add(_header);
        _root.Children.Add(_bodyHost);
        _fade.Content = new TsGlassPanel { Padding = new Thickness(16), Content = _root };
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _diagnostics.RecordViewOpened();
        _ = _viewModel.LoadAsync();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnRefreshClick(object sender, RoutedEventArgs e) => _ = _viewModel.RetryAsync();

    private void OnRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private void OnRangePicked(object? sender, DateRange range)
    {
        if (_suppressRange)
        {
            return;
        }

        _viewModel.Range = range;
    }

    /// <summary>Detach from the view-model and cancel any in-flight load (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _refresh.Click -= OnRefreshClick;
        _rangePicker.RangeChanged -= OnRangePicked;
        _errorView.ActionInvoked -= OnRetry;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        ScheduleRender();

    private void ScheduleRender()
    {
        if (_renderQueued)
        {
            return;
        }

        _renderQueued = true;
        if (_dispatcher is { } dispatcher)
        {
            dispatcher.TryEnqueue(RenderCoalesced);
        }
        else
        {
            RenderCoalesced();
        }
    }

    private void RenderCoalesced()
    {
        _renderQueued = false;
        Render();
    }

    private void Render()
    {
        var display = _viewModel.Display;
        var state = _viewModel.State;

        _title.Value = display.Title;
        AutomationProperties.SetName(this, display.Title);

        UpdateFreshness(state);
        SyncRangePicker(display);

        _bodyHost.Child = state switch
        {
            DriveAnalyticsSectionState.Loading => BuildLoading(),
            DriveAnalyticsSectionState.Error => BuildError(),
            _ => BuildContent(display),
        };
    }

    private StackPanel BuildLoading()
    {
        LiveRegion.Configure(_loadingRoot);
        LiveRegion.Announce(_loadingRoot);
        AutomationProperties.SetName(_loadingRoot, _viewModel.LoadingLabel);
        return _loadingRoot;
    }

    private TsQueryError BuildError()
    {
        _errorView.Title = _viewModel.ErrorTitle;
        _errorView.Message = _viewModel.ErrorMessage ?? _viewModel.ErrorTitle;
        _errorView.ActionText = _viewModel.RetryLabel;
        _errorView.AttemptCount = _viewModel.Attempts;
        AutomationProperties.SetName(_errorView, _errorView.Message);
        return _errorView;
    }

    private StackPanel BuildContent(DriveAnalyticsSectionDisplay display)
    {
        UpdateSpeedCard(display);
        UpdateAccelCard(display);
        UpdatePowerCard(display);
        return _contentRoot;
    }

    private void UpdateSpeedCard(DriveAnalyticsSectionDisplay display)
    {
        var chrome = display.SpeedDistributionChrome;
        var model = display.SpeedDistribution;
        ApplyChrome(_speedCard, chrome, model.HasData);
        if (model.HasData)
        {
            var chart = new TsBarChart
            {
                Title = chrome.Title,
                Series = model.ToChartSeries(),
                ShowLegend = false,
                MinHeight = ChartHeight,
            };
            AutomationProperties.SetName(chart, chrome.AriaLabel);
            _speedCard.Body = chart;
            _speedCard.DataView.Series = model.ToChartSeries();
            _speedCard.DataView.XLabel = chrome.XColumnLabel;
        }
        else
        {
            _speedCard.Body = null;
            _speedCard.DataView.Series = Array.Empty<ChartSeries>();
        }
    }

    private void UpdateAccelCard(DriveAnalyticsSectionDisplay display)
    {
        var chrome = display.AccelerationChrome;
        var model = display.Acceleration;
        ApplyChrome(_accelCard, chrome, model.HasData);
        if (model.HasData)
        {
            var chart = new TsScatterChart
            {
                Title = chrome.Title,
                Series = model.ToChartSeries(),
                Annotations = model.ToAnnotations(display.AverageLabel),
                ShowLegend = false,
                MinHeight = ChartHeight,
            };
            AutomationProperties.SetName(chart, chrome.AriaLabel);
            _accelCard.Body = chart;
            _accelCard.DataView.Series = model.ToChartSeries();
            _accelCard.DataView.XLabel = chrome.XColumnLabel;
        }
        else
        {
            _accelCard.Body = null;
            _accelCard.DataView.Series = Array.Empty<ChartSeries>();
        }
    }

    private void UpdatePowerCard(DriveAnalyticsSectionDisplay display)
    {
        var chrome = display.PowerProfileChrome;
        var model = display.PowerProfile;
        ApplyChrome(_powerCard, chrome, model.HasData);
        if (model.HasData)
        {
            var chart = new TsAreaChart
            {
                Title = chrome.Title,
                Series = model.ToChartSeries(),
                Annotations = model.ToAnnotations(),
                ShowLegend = true,
                MinHeight = ChartHeight,
            };
            AutomationProperties.SetName(chart, chrome.AriaLabel);
            _powerCard.Body = chart;
            _powerCard.DataView.Series = model.ToChartSeries();
            _powerCard.DataView.XLabel = chrome.XColumnLabel;
        }
        else
        {
            _powerCard.Body = null;
            _powerCard.DataView.Series = Array.Empty<ChartSeries>();
        }
    }

    private static void ApplyChrome(TsChartContainer card, DriveAnalyticsChartChrome chrome, bool hasData)
    {
        card.Title = chrome.Title;
        card.Subtitle = chrome.Subtitle;
        card.AccessibleSummary = chrome.AriaLabel;
        card.EmptyMessage = chrome.EmptyMessage;
        card.DataViewLabel = chrome.DataTableLabel;
        card.State = hasData ? ChartState.Ready : ChartState.Empty;
    }

    private void SyncRangePicker(DriveAnalyticsSectionDisplay display)
    {
        _suppressRange = true;
        _rangePicker.StartLabel = display.StartLabel;
        _rangePicker.EndLabel = display.EndLabel;
        if (_rangePicker.Range != _viewModel.Range)
        {
            _rangePicker.Range = _viewModel.Range;
        }

        AutomationProperties.SetName(
            _rangePicker,
            string.Format(CultureInfo.CurrentCulture, "{0} – {1}", display.StartLabel, display.EndLabel));
        _suppressRange = false;
    }

    private void UpdateFreshness(DriveAnalyticsSectionState state)
    {
        bool showActions = state is not (DriveAnalyticsSectionState.Loading or DriveAnalyticsSectionState.Error);
        _actions.Visibility = showActions ? Visibility.Visible : Visibility.Collapsed;
        if (!showActions)
        {
            return;
        }

        bool offline = state == DriveAnalyticsSectionState.Offline;
        bool stale = state == DriveAnalyticsSectionState.Stale;
        if (stale || offline)
        {
            _freshnessChip.Visibility = Visibility.Visible;
            _freshnessChip.Status = offline ? StatusKind.Danger : StatusKind.Warning;
            _freshnessChipText.Text = offline ? _viewModel.OfflineChip : _viewModel.StaleChip;
            AutomationProperties.SetName(_freshnessChip, _freshnessChipText.Text);
        }
        else
        {
            _freshnessChip.Visibility = Visibility.Collapsed;
        }

        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = offline;
        _refresh.IsEnabled = !_viewModel.IsFetching;
        AutomationProperties.SetName(_refresh, _viewModel.RefreshLabel);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new DriveAnalyticsSectionAutomationPeer(this);

    private sealed class DriveAnalyticsSectionAutomationPeer(DriveAnalyticsSection owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((DriveAnalyticsSection)Owner).ViewModel.Title
                : name;
        }
    }
}
