using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Dashboard;

/// <summary>
/// The native WinUI 3 <c>QuickStatsPage</c> — a parity port of the web page
/// <c>web/src/features/dashboard/pages/QuickStatsPage.tsx</c> (route <c>/quick-stats</c>, nav name
/// <c>QuickStats</c>). It binds to a <see cref="QuickStatsPageViewModel"/> and renders every web region with
/// Fluent components and design tokens: the centred page title; the loading shimmer; the failure surface
/// (InfoBar-equivalent + Retry); the vehicle <see cref="TsGlassPanel"/> (the badge + name + "model · state"
/// sub-line, or the "no vehicle found" <see cref="TsEmptyState"/>); the four metric tiles (Distance / Drives /
/// kWh Used / Total Cost); and the footer brand line with the in-app "Open Dashboard" link. The view is a thin
/// renderer: all branch selection, SI conversion, formatting and i18n happen in the view-model's
/// <see cref="QuickStatsDisplay"/> projection. State changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class QuickStatsPage : UserControl, IDisposable
{
    private readonly QuickStatsPageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;

    private readonly PageTitle _title = new() { HorizontalAlignment = HorizontalAlignment.Center };

    private readonly StackPanel _loadingSkeleton = new() { Spacing = 12 };
    private readonly TsQueryError _errorState = new();

    private readonly StackPanel _contentRoot = new()
    {
        Spacing = 16,
        MaxWidth = 460,
        HorizontalAlignment = HorizontalAlignment.Center,
    };

    private readonly TsGlassPanel _vehiclePanel = new() { Padding = new Thickness(16) };
    private readonly ContentControl _vehicleHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };
    private readonly StackPanel _vehicleContent = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 12,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly FontIcon _vehicleGlyph = new() { Glyph = QuickStatsProjection.CarGlyph, FontSize = 20 };
    private readonly PanelTitle _vehicleName = new();
    private readonly Caption _vehicleSubtitle = new();
    private readonly TsEmptyState _vehicleEmpty = new() { IconGlyph = QuickStatsProjection.CarGlyph };

    private readonly TsMetricCard _distanceCard = new();
    private readonly TsMetricCard _drivesCard = new();
    private readonly TsMetricCard _energyCard = new();
    private readonly TsMetricCard _costCard = new();

    private readonly Caption _footerText = new() { HorizontalAlignment = HorizontalAlignment.Center };
    private readonly HyperlinkButton _openDashboard = new() { HorizontalAlignment = HorizontalAlignment.Center };

    /// <summary>Creates the page over the default empty source and the shell resource localizer.</summary>
    public QuickStatsPage()
        : this(EmptyQuickStatsSource.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit source and localizer (used by tests / dependency injection).</summary>
    /// <param name="source">The quick-stats data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public QuickStatsPage(IQuickStatsSource source, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new QuickStatsPageViewModel(source, localizer);

        BuildLoadingSkeleton();
        BuildVehicleCard();
        BuildContent();

        Content = BuildLayout();

        _errorState.ActionInvoked += OnRetryInvoked;
        _openDashboard.Click += OnOpenDashboardClick;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>Raised when the footer "Open Dashboard" link is invoked (the host navigates to the dashboard).</summary>
    public event EventHandler? OpenDashboardRequested;

    /// <summary>The diagnostics surface slug (<c>QuickStatsPage</c>).</summary>
    public static string Slug => QuickStatsRegistration.Slug;

    private ScrollViewer BuildLayout()
    {
        var centred = new StackPanel
        {
            Spacing = 24,
            Padding = new Thickness(24),
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            MaxWidth = 520,
        };
        centred.Children.Add(_title);
        centred.Children.Add(_loadingSkeleton);
        centred.Children.Add(_errorState);
        centred.Children.Add(_contentRoot);

        return new ScrollViewer
        {
            Content = centred,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
        };
    }

    private void BuildLoadingSkeleton()
    {
        _loadingSkeleton.MaxWidth = 460;
        _loadingSkeleton.HorizontalAlignment = HorizontalAlignment.Center;
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 72, Radius = 12 });
        _loadingSkeleton.Children.Add(new TsStatGridSkeleton(2));
        _loadingSkeleton.Children.Add(new TsStatGridSkeleton(2));
    }

    private void BuildVehicleCard()
    {
        var badge = new Border
        {
            Width = 40,
            Height = 40,
            CornerRadius = new CornerRadius(20),
            BorderThickness = new Thickness(1),
            BorderBrush = TypographyTokens.Brush("TsColorBorderBrush"),
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center,
            Child = _vehicleGlyph,
        };
        _vehicleGlyph.HorizontalAlignment = HorizontalAlignment.Center;
        _vehicleGlyph.VerticalAlignment = VerticalAlignment.Center;
        _vehicleGlyph.Foreground = TypographyTokens.Brush("TsChartSpeedBrush");

        var nameColumn = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        nameColumn.Children.Add(_vehicleName);
        nameColumn.Children.Add(_vehicleSubtitle);

        _vehicleContent.Children.Add(badge);
        _vehicleContent.Children.Add(nameColumn);

        _vehiclePanel.Content = _vehicleHost;
    }

    private void BuildContent()
    {
        _contentRoot.Children.Add(new TsFadeIn { Content = _vehiclePanel });
        _contentRoot.Children.Add(new TsFadeIn { DelayMs = 50, Content = BuildMetricGrid() });

        var footer = new StackPanel
        {
            Spacing = 2,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        footer.Children.Add(_footerText);
        footer.Children.Add(_openDashboard);
        _contentRoot.Children.Add(new TsFadeIn { DelayMs = 100, Content = footer });
    }

    private Grid BuildMetricGrid()
    {
        var grid = new Grid { ColumnSpacing = 12, RowSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

        Place(grid, _distanceCard, 0, 0);
        Place(grid, _drivesCard, 0, 1);
        Place(grid, _energyCard, 1, 0);
        Place(grid, _costCard, 1, 1);
        return grid;
    }

    private static void Place(Grid grid, FrameworkElement element, int row, int column)
    {
        element.HorizontalAlignment = HorizontalAlignment.Stretch;
        Grid.SetRow(element, row);
        Grid.SetColumn(element, column);
        grid.Children.Add(element);
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        _viewModel.NotifyOpened();
        await _viewModel.LoadAsync().ConfigureAwait(true);
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Unsubscribe from and dispose the view-model (CA1001; mirrors the sibling feature-view pages).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _errorState.ActionInvoked -= OnRetryInvoked;
        _openDashboard.Click -= OnOpenDashboardClick;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

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

    private void Render(QuickStatsDisplay display)
    {
        _title.Value = display.Title;
        AutomationProperties.SetName(this, display.AutomationName);

        _loadingSkeleton.Visibility = Show(display.ShowLoading);

        _errorState.Visibility = Show(display.ShowError);
        _errorState.Title = display.ErrorText;
        _errorState.ActionText = display.RetryText;
        AutomationProperties.SetName(_errorState, display.ErrorText);

        _contentRoot.Visibility = Show(display.ShowContent);

        RenderVehicleCard(display);
        RenderMetric(_distanceCard, display, "distance");
        RenderMetric(_drivesCard, display, "drives");
        RenderMetric(_energyCard, display, "energy");
        RenderMetric(_costCard, display, "cost");

        _footerText.Value = display.FooterText;
        _openDashboard.Content = display.OpenDashboardText;
        AutomationProperties.SetName(_openDashboard, display.OpenDashboardText);
    }

    private void RenderVehicleCard(QuickStatsDisplay display)
    {
        if (display.HasVehicle)
        {
            _vehicleName.Value = display.VehicleName;
            _vehicleSubtitle.Value = display.VehicleSubtitle;
            _vehicleHost.Content = _vehicleContent;
        }
        else
        {
            _vehicleEmpty.Message = display.NoVehicleMessage;
            _vehicleHost.Content = _vehicleEmpty;
        }

        AutomationProperties.SetName(_vehiclePanel, display.VehicleAutomationName);
    }

    private static void RenderMetric(TsMetricCard card, QuickStatsDisplay display, string key)
    {
        var metric = FindMetric(display, key);
        card.Label = metric.Label;
        card.Value = metric.Value;
        card.AccentBrushKey = metric.AccentBrushKey;
        AutomationProperties.SetName(card, metric.AutomationName);
    }

    private static QuickStatsMetric FindMetric(QuickStatsDisplay display, string key)
    {
        foreach (var metric in display.Metrics)
        {
            if (string.Equals(metric.Key, key, StringComparison.Ordinal))
            {
                return metric;
            }
        }

        return new QuickStatsMetric(key, string.Empty, string.Empty, "TsColorAccentBrush", string.Empty);
    }

    private void OnRetryInvoked(object? sender, EventArgs e) => InvokeAsync(() => _viewModel.RetryAsync());

    private void OnOpenDashboardClick(object sender, RoutedEventArgs e) =>
        OpenDashboardRequested?.Invoke(this, EventArgs.Empty);

    private static async void InvokeAsync(Func<Task> action)
    {
        await action().ConfigureAwait(true);
    }

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new QuickStatsPageAutomationPeer(this);

    private sealed class QuickStatsPageAutomationPeer(QuickStatsPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
