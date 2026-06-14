using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Battery;

/// <summary>
/// The native WinUI 3 <c>PowerFlowDashboardPage</c> — a parity port of the web page
/// <c>web/src/features/battery/pages/PowerFlowDashboardPage.tsx</c> (route <c>/power-flow</c>, nav name
/// <c>PowerFlowDashboard</c>). It binds to a <see cref="PowerFlowDashboardPageViewModel"/> and renders every web
/// region with Fluent components and design tokens: the page header; the manual refresh affordance; the four header
/// status chips (grid status, storm mode, backup capable, last update); the loading shimmer; the retryable failure
/// surface; the four current-power tiles (Solar / Battery / Home / Grid); the battery-state panel (SOC gauge bar +
/// energy remaining + total capacity, with its "no battery data" empty state); the power-flow diagram (the Solar →
/// Home / Battery → Home / Grid → Home / Grid-Services → Grid arrows, with its "no power flow data" empty state);
/// and the two historical chart blocks (the stacked power area chart and the SOC line chart). The view is a thin
/// renderer: all branch selection, formatting and i18n happen in the view-model's <see cref="PowerFlowDisplay"/>
/// projection. State changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class PowerFlowDashboardPage : UserControl, IDisposable
{
    private readonly PowerFlowDashboardPageViewModel _viewModel;
    private readonly DispatcherQueue? _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;
    private bool _started;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();
    private readonly TsButton _refreshButton = new() { Variant = ButtonVariant.Primary, IconGlyph = "\uE72C" };

    private readonly StackPanel _loadingPanel;
    private readonly TsQueryError _errorState = new();
    private readonly StackPanel _contentPanel = new() { Spacing = 24, Visibility = Visibility.Collapsed };

    // Header status chips.
    private readonly BadgeChip _gridChip = new();
    private readonly BadgeChip _stormChip = new();
    private readonly BadgeChip _backupChip = new();
    private readonly BadgeChip _lastUpdateChip = new();

    // Current-power tiles (Solar-Production / Battery / Home-Consumption / Grid).
    private readonly TsStatCard _solarCard = new();
    private readonly TsStatCard _batteryCard = new();
    private readonly TsStatCard _homeCard = new();
    private readonly TsStatCard _gridCard = new();

    // Panel 5 — battery state.
    private readonly TsGlassPanel _batteryPanel = new() { Padding = new Thickness(24) };
    private readonly PanelTitle _batteryTitle = new();
    private readonly ContentControl _batteryHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };
    private readonly StackPanel _batteryContent = new() { Spacing = 12 };
    private readonly TsEmptyState _batteryEmpty = new() { IconGlyph = PowerFlowDashboardRegistration.BatteryGlyph };
    private readonly Text _socLabel = new();
    private readonly Subhead _socValue = new() { HorizontalAlignment = HorizontalAlignment.Right };
    private readonly TsMetricBar _socBar = new() { Max = 100, AccentBrushKey = "TsChartBatteryBrush" };
    private readonly Text _energyLeftLabel = new();
    private readonly Text _energyLeftValue = new() { HorizontalAlignment = HorizontalAlignment.Right };
    private readonly Text _totalCapacityLabel = new();
    private readonly Text _totalCapacityValue = new() { HorizontalAlignment = HorizontalAlignment.Right };

    // Panel 6 — power-flow diagram.
    private readonly TsGlassPanel _flowPanel = new() { Padding = new Thickness(24) };
    private readonly PanelTitle _flowTitle = new();
    private readonly ContentControl _flowHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };
    private readonly StackPanel _flowList = new() { Spacing = 8 };
    private readonly TsEmptyState _flowEmpty = new() { IconGlyph = PowerFlowDashboardRegistration.EmptyGlyph };

    // History section.
    private readonly SectionTitle _historyTitle = new();

    // Panels 7/8 — charts.
    private readonly TsChartContainer _powerContainer = new();
    private readonly TsAreaChart _powerChart = new() { ShowLegend = true, Height = 350, IncludeZero = true };
    private readonly TsChartContainer _socContainer = new();
    private readonly TsLineChart _socChart = new() { ShowLegend = false, Height = 250, IncludeZero = true };

    /// <summary>Creates the page over the default empty feed and the shell resource localizer.</summary>
    public PowerFlowDashboardPage()
        : this(EmptyPowerFlowFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The power-flow data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="siteId">The Tesla energy-site id (defaults to the web <c>DEFAULT_SITE_ID</c>).</param>
    public PowerFlowDashboardPage(
        IPowerFlowFeed feed,
        Core.Notifications.ILocalizer localizer,
        long siteId = PowerFlowDashboardRegistration.DefaultSiteId)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new PowerFlowDashboardPageViewModel(feed, localizer, siteId);
        _loadingPanel = BuildLoadingPanel();

        Content = BuildLayout();

        _refreshButton.Click += OnRefreshClicked;
        _errorState.ActionInvoked += OnRetryInvoked;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The navigation route name the shell registers this page under (<c>PowerFlowDashboard</c>).</summary>
    public static string RouteName => PowerFlowDashboardRegistration.RouteName;

    private ScrollViewer BuildLayout()
    {
        var header = new Grid();
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var titles = new StackPanel { Spacing = 4, VerticalAlignment = VerticalAlignment.Center };
        titles.Children.Add(_title);
        titles.Children.Add(_subtitle);
        Grid.SetColumn(titles, 0);

        _refreshButton.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(_refreshButton, 1);

        header.Children.Add(titles);
        header.Children.Add(_refreshButton);

        BuildContent();

        var stack = new StackPanel { Spacing = 24, Padding = new Thickness(24) };
        stack.Children.Add(header);
        stack.Children.Add(_errorState);
        stack.Children.Add(_loadingPanel);
        stack.Children.Add(_contentPanel);

        return new ScrollViewer
        {
            Content = stack,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
    }

    private static StackPanel BuildLoadingPanel()
    {
        var panel = new StackPanel { Spacing = 24, Visibility = Visibility.Collapsed };
        panel.Children.Add(new TsStatGridSkeleton(4));
        panel.Children.Add(new TsChartBlockSkeleton());
        return panel;
    }

    private void BuildContent()
    {
        var badges = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        badges.Children.Add(_gridChip.Badge);
        badges.Children.Add(_stormChip.Badge);
        badges.Children.Add(_backupChip.Badge);
        badges.Children.Add(_lastUpdateChip.Badge);
        _contentPanel.Children.Add(badges);

        _contentPanel.Children.Add(BuildEqualColumns(16, _solarCard, _batteryCard, _homeCard, _gridCard));

        BuildBatterySection();
        BuildFlowSection();
        _contentPanel.Children.Add(BuildEqualColumns(16, _batteryPanel, _flowPanel));

        _contentPanel.Children.Add(_historyTitle);

        _powerContainer.Body = _powerChart;
        _contentPanel.Children.Add(_powerContainer);

        _socContainer.Body = _socChart;
        _contentPanel.Children.Add(_socContainer);
    }

    private void BuildBatterySection()
    {
        _batteryContent.Children.Add(BuildKeyValueRow(_socLabel, _socValue));
        _batteryContent.Children.Add(_socBar);
        _batteryContent.Children.Add(BuildKeyValueRow(_energyLeftLabel, _energyLeftValue));
        _batteryContent.Children.Add(BuildKeyValueRow(_totalCapacityLabel, _totalCapacityValue));

        var body = new StackPanel { Spacing = 12 };
        body.Children.Add(_batteryTitle);
        body.Children.Add(_batteryHost);
        _batteryPanel.Content = body;
    }

    private void BuildFlowSection()
    {
        var body = new StackPanel { Spacing = 12 };
        body.Children.Add(_flowTitle);
        body.Children.Add(_flowHost);
        _flowPanel.Content = body;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _viewModel.NotifyOpened();
        await _viewModel.LoadAsync().ConfigureAwait(true);
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (_dispatcher is null || _dispatcher.HasThreadAccess)
        {
            Render(_viewModel.Display);
        }
        else
        {
            _dispatcher.TryEnqueue(() => Render(_viewModel.Display));
        }
    }

    private void Render(PowerFlowDisplay d)
    {
        if (_disposed)
        {
            return;
        }

        _title.Value = d.Title;
        _subtitle.Value = d.Subtitle;
        AutomationProperties.SetName(this, d.AutomationName);

        _refreshButton.Text = d.RefreshLabel;
        _refreshButton.IsLoading = _viewModel.IsRefreshing;

        _loadingPanel.Visibility = Show(d.ShowLoading);

        _errorState.Visibility = Show(d.ShowError);
        _errorState.Title = d.ErrorText;
        _errorState.ActionText = d.RetryLabel;
        AutomationProperties.SetName(_errorState, d.ErrorText);

        _contentPanel.Visibility = Show(d.ShowContent);

        _gridChip.Apply(d.GridBadge);
        _stormChip.Apply(d.StormBadge);
        _backupChip.Apply(d.BackupBadge);
        _lastUpdateChip.Apply(d.LastUpdateBadge);

        ApplyCard(_solarCard, d.SolarCard);
        ApplyCard(_batteryCard, d.BatteryCard);
        ApplyCard(_homeCard, d.HomeCard);
        ApplyCard(_gridCard, d.GridCard);

        RenderBatterySection(d);
        RenderFlowSection(d);

        _historyTitle.Value = d.HistoryTitle;

        _powerContainer.Title = d.PowerOverTimeTitle;
        _powerContainer.Subtitle = d.PowerOverTimeDesc;
        _powerContainer.AccessibleSummary = d.PowerOverTimeAria;
        _powerChart.Series = d.PowerSeries;
        _powerContainer.DataView.Series = d.PowerSeries;
        _powerContainer.State = d.PowerChartState;

        _socContainer.Title = d.SocOverTimeTitle;
        _socContainer.Subtitle = d.SocOverTimeDesc;
        _socContainer.AccessibleSummary = d.SocOverTimeAria;
        _socChart.Series = d.SocSeries;
        _socContainer.DataView.Series = d.SocSeries;
        _socContainer.State = d.SocChartState;
    }

    private void RenderBatterySection(PowerFlowDisplay d)
    {
        _batteryTitle.Value = d.BatteryStateTitle;
        AutomationProperties.SetName(_batteryPanel, d.BatteryStateTitle);

        if (d.HasBatteryData)
        {
            _socLabel.Value = d.StateOfChargeLabel;
            _socValue.Value = d.SocValueText;
            _socBar.Value = d.SocPercent;
            _socBar.ValueText = d.SocValueText;
            _socBar.Visibility = Show(d.SocBarVisible);
            _energyLeftLabel.Value = d.EnergyLeftLabel;
            _energyLeftValue.Value = d.EnergyLeftValue;
            _totalCapacityLabel.Value = d.TotalCapacityLabel;
            _totalCapacityValue.Value = d.TotalCapacityValue;
            _batteryHost.Content = _batteryContent;
        }
        else
        {
            _batteryEmpty.Message = d.NoBatteryDataMessage;
            AutomationProperties.SetName(_batteryEmpty, d.NoBatteryDataMessage);
            _batteryHost.Content = _batteryEmpty;
        }
    }

    private void RenderFlowSection(PowerFlowDisplay d)
    {
        _flowTitle.Value = d.FlowDiagramTitle;
        AutomationProperties.SetName(_flowPanel, d.FlowDiagramTitle);

        if (d.HasFlowData)
        {
            _flowList.Children.Clear();
            foreach (var arrow in d.FlowArrows)
            {
                _flowList.Children.Add(BuildArrowRow(arrow));
            }

            _flowHost.Content = _flowList;
        }
        else
        {
            _flowEmpty.Message = d.NoFlowDataMessage;
            AutomationProperties.SetName(_flowEmpty, d.NoFlowDataMessage);
            _flowHost.Content = _flowEmpty;
        }
    }

    private static void ApplyCard(TsStatCard card, PowerFlowStatTile tile)
    {
        card.Label = tile.Label;
        card.Value = tile.Value;
        card.Sublabel = tile.Sublabel;
        card.Glyph = tile.Glyph;
    }

    private static Grid BuildKeyValueRow(FrameworkElement label, FrameworkElement value)
    {
        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        label.VerticalAlignment = VerticalAlignment.Center;
        value.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(label, 0);
        Grid.SetColumn(value, 1);
        grid.Children.Add(label);
        grid.Children.Add(value);
        return grid;
    }

    private static Border BuildArrowRow(PowerFlowArrow arrow)
    {
        var grid = new Grid { ColumnSpacing = 8, VerticalAlignment = VerticalAlignment.Center };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var from = new Text { Value = arrow.From, VerticalAlignment = VerticalAlignment.Center };
        var direction = new FontIcon
        {
            Glyph = arrow.IsExport ? "\uE74A" : "\uE74B", // Up when exporting, Down otherwise (web ArrowUp/ArrowDown)
            FontSize = 12,
            VerticalAlignment = VerticalAlignment.Center,
        };
        var to = new Text { Value = arrow.To, VerticalAlignment = VerticalAlignment.Center };
        var power = new Text
        {
            Value = arrow.PowerText,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
        };

        Grid.SetColumn(from, 0);
        Grid.SetColumn(direction, 1);
        Grid.SetColumn(to, 2);
        Grid.SetColumn(power, 4);
        grid.Children.Add(from);
        grid.Children.Add(direction);
        grid.Children.Add(to);
        grid.Children.Add(power);

        var chip = new Border
        {
            CornerRadius = new CornerRadius(8),
            Padding = new Thickness(12, 6, 12, 6),
            BorderThickness = new Thickness(1),
            BorderBrush = Brush("TsColorBorderBrush"),
            Opacity = arrow.Active ? 1.0 : 0.55,
            Child = grid,
        };

        if (arrow.Active && Brush("TsChartSpeedBrush") is { } accent)
        {
            chip.BorderBrush = accent;
        }

        AutomationProperties.SetName(chip, $"{arrow.From} {arrow.To}: {arrow.PowerText}");
        return chip;
    }

    private static Grid BuildEqualColumns(double spacing, params FrameworkElement[] children)
    {
        var grid = new Grid { ColumnSpacing = spacing };
        for (var i = 0; i < children.Length; i++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            Grid.SetColumn(children[i], i);
            grid.Children.Add(children[i]);
        }

        return grid;
    }

    private void OnRefreshClicked(object sender, RoutedEventArgs e) => InvokeAsync(() => _viewModel.RefreshAsync());

    private void OnRetryInvoked(object? sender, EventArgs e) => InvokeAsync(() => _viewModel.RefreshAsync());

    private static async void InvokeAsync(Func<Task> action) => await action().ConfigureAwait(true);

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;

    private static Brush? Brush(string key) =>
        Application.Current.Resources.TryGetValue(key, out var v) && v is Brush b ? b : null;

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _refreshButton.Click -= OnRefreshClicked;
        _errorState.ActionInvoked -= OnRetryInvoked;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    protected override AutomationPeer OnCreateAutomationPeer() => new PowerFlowDashboardPageAutomationPeer(this);

    private sealed class PowerFlowDashboardPageAutomationPeer(PowerFlowDashboardPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }

    /// <summary>A header status chip (web <c>Badge</c>) — a tokenized <see cref="TsBadge"/> with a leading glyph and a label.</summary>
    private sealed class BadgeChip
    {
        private readonly FontIcon _icon = new() { FontSize = 12, VerticalAlignment = VerticalAlignment.Center };
        private readonly Text _text = new() { VerticalAlignment = VerticalAlignment.Center };

        public BadgeChip()
        {
            var row = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Spacing = 6,
                VerticalAlignment = VerticalAlignment.Center,
            };
            row.Children.Add(_icon);
            row.Children.Add(_text);
            Badge = new TsBadge { Content = row };
        }

        public TsBadge Badge { get; }

        public void Apply(PowerFlowBadge badge)
        {
            _icon.Glyph = badge.Glyph;
            _text.Value = badge.Text;
            Badge.Status = badge.Status;
            Badge.Visibility = badge.Visible ? Visibility.Visible : Visibility.Collapsed;
            AutomationProperties.SetName(Badge, badge.Text);
        }
    }
}
