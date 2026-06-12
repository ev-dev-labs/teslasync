using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Charging;

/// <summary>
/// The native WinUI 3 <c>ChargingCurvePage</c> — a parity port of the web page
/// <c>web/src/features/charging/pages/ChargingCurvePage.tsx</c> (route <c>/charging-curve</c>, nav name
/// <c>ChargingCurve</c>). It binds to a <see cref="ChargingCurvePageViewModel"/> and renders every web region
/// with Fluent components and design tokens: the page header (title + subtitle + data-freshness chip); the
/// loading skeleton; the retriable error surface; the page-level empty glass panel (the web empty-state
/// <c>GlassPanel</c>, "GlassPanel1"); and — in the success state — the session selector with its summary line,
/// the summary-stats grid, the selected session's power-vs-SOC curve and detail panel (or, when no session is
/// selected, the select-a-session hint glass panel, "GlassPanel2"), the session-comparison chart, the
/// charger-type and speed-trend charts, and the time-to-charge section. The view is a thin renderer: all
/// branch selection, formatting and i18n happen in the view-model's <see cref="ChargingCurveDisplay"/>
/// projection. State changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class ChargingCurvePage : UserControl, IDisposable
{
    private const double SectionSpacing = 24;
    private const double PanelPadding = 24;
    private const double ColumnGap = 24;

    private readonly ChargingCurvePageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;
    private bool _suppressSelection;
    private string _optionSignature = string.Empty;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();
    private readonly TsDataFreshness _freshness = new();

    private readonly StackPanel _loadingSkeleton = new() { Spacing = SectionSpacing };
    private readonly TsQueryError _errorState = new();

    private readonly TsGlassPanel _emptyPanel = new();
    private readonly Text _emptyMessage = new() { HorizontalAlignment = HorizontalAlignment.Center };
    private readonly Caption _emptyHint = new() { HorizontalAlignment = HorizontalAlignment.Center };

    private readonly StackPanel _contentPanel = new() { Spacing = SectionSpacing };
    private readonly TsSelect _selector = new() { HorizontalAlignment = HorizontalAlignment.Left, MinWidth = 360 };
    private readonly Caption _summaryLine = new();

    private readonly SummaryStatsGrid _summaryStats;
    private readonly SessionCurveChart _curveChart;
    private readonly SessionDetailPanel _detailPanel;
    private readonly Grid _curveDetailGrid = new() { ColumnSpacing = ColumnGap };
    private readonly TsGlassPanel _hintPanel = new();
    private readonly Text _hintText = new() { HorizontalAlignment = HorizontalAlignment.Center };
    private readonly SessionComparisonChart _comparison;
    private readonly ChargerTypeChart _chargerChart;
    private readonly SpeedTrendChart _speedTrend;
    private readonly TimeToChargeSection _timeToCharge;

    /// <summary>Creates the page over the default empty feed and the shell resource localizer.</summary>
    public ChargingCurvePage()
        : this(EmptyChargingCurveFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The charging-sessions data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public ChargingCurvePage(IChargingCurveFeed feed, ILocalizer localizer)
        : this(feed, localizer, null)
    {
    }

    /// <summary>
    /// Creates the page over an explicit feed, localizer and optional host services. When
    /// <paramref name="childServices"/> is supplied, the self-fetching child sections run their own
    /// cache-then-network charging-sessions reads scoped to the active vehicle; otherwise they fall back to
    /// their empty surfaces while the presentational sections still render from the page's own read.
    /// </summary>
    /// <param name="feed">The charging-sessions data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="childServices">The host dependencies for the self-fetching child sections, or null.</param>
    public ChargingCurvePage(IChargingCurveFeed feed, ILocalizer localizer, ChargingCurveChildServices? childServices)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new ChargingCurvePageViewModel(feed, localizer);

        _curveChart = new SessionCurveChart(localizer);
        _detailPanel = new SessionDetailPanel(localizer);
        _chargerChart = new ChargerTypeChart(localizer);
        _summaryStats = BuildSummaryStats(localizer, childServices);
        _comparison = BuildComparison(localizer, childServices);
        _speedTrend = BuildSpeedTrend(localizer, childServices);
        _timeToCharge = BuildTimeToCharge(localizer, childServices);

        BuildLoadingSkeleton();
        BuildEmptyPanel();
        BuildHintPanel();
        BuildContentPanel();
        Content = BuildLayout();

        _errorState.ActionInvoked += OnRetryInvoked;
        _selector.SelectionChanged += OnSessionSelected;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The diagnostics surface slug (<c>ChargingCurvePage</c>).</summary>
    public static string Slug => ChargingCurveRegistration.Slug;

    private static SummaryStatsGrid BuildSummaryStats(ILocalizer localizer, ChargingCurveChildServices? services) =>
        services is { } svc
            ? SummaryStatsGrid.Create(svc.Api, svc.Engine, svc.Options, localizer, vehicleId: svc.VehicleId)
            : new SummaryStatsGrid(EmptySummaryStatsSource.Instance, localizer);

    private static SessionComparisonChart BuildComparison(ILocalizer localizer, ChargingCurveChildServices? services) =>
        services is { } svc
            ? SessionComparisonChart.Create(svc.Vehicles, svc.Api, svc.Engine, svc.Options, localizer, svc.VehicleId)
            : new SessionComparisonChart(EmptySessionComparisonSource.Instance, localizer);

    private static SpeedTrendChart BuildSpeedTrend(ILocalizer localizer, ChargingCurveChildServices? services) =>
        services is { } svc
            ? SpeedTrendChart.Create(svc.Api, svc.Engine, svc.Options, localizer, svc.VehicleId)
            : new SpeedTrendChart(EmptySpeedTrendChartSource.Instance, localizer);

    private static TimeToChargeSection BuildTimeToCharge(ILocalizer localizer, ChargingCurveChildServices? services) =>
        services is { } svc
            ? TimeToChargeSection.Create(svc.Api, svc.Engine, svc.Options, localizer, vehicleId: svc.VehicleId)
            : new TimeToChargeSection(EmptyTimeToChargeSource.Instance, localizer);

    private ScrollViewer BuildLayout()
    {
        var stack = new StackPanel { Spacing = SectionSpacing, Padding = new Thickness(PanelPadding) };
        stack.Children.Add(BuildHeader());
        stack.Children.Add(_loadingSkeleton);
        stack.Children.Add(_errorState);
        stack.Children.Add(_emptyPanel);
        stack.Children.Add(_contentPanel);

        return new ScrollViewer
        {
            Content = stack,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
    }

    private Grid BuildHeader()
    {
        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var titles = new StackPanel { Spacing = 4, VerticalAlignment = VerticalAlignment.Center };
        titles.Children.Add(_title);
        titles.Children.Add(_subtitle);
        Grid.SetColumn(titles, 0);
        grid.Children.Add(titles);

        _freshness.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(_freshness, 1);
        grid.Children.Add(_freshness);

        return grid;
    }

    private void BuildLoadingSkeleton()
    {
        _loadingSkeleton.Children.Add(ColumnsGrid(6, 16, BuildSkeletonBlocks(6, 96)));
        _loadingSkeleton.Children.Add(ColumnsGrid(3, ColumnGap, BuildSkeletonBlocks(3, 220)));
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 320 });
    }

    private void BuildEmptyPanel()
    {
        var column = new StackPanel
        {
            Spacing = 8,
            Padding = new Thickness(0, 48, 0, 48),
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        column.Children.Add(_emptyMessage);
        column.Children.Add(_emptyHint);
        _emptyPanel.Padding = new Thickness(PanelPadding);
        _emptyPanel.Content = column;
    }

    private void BuildHintPanel()
    {
        var column = new StackPanel
        {
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            Padding = new Thickness(0, 32, 0, 32),
        };
        column.Children.Add(_hintText);
        _hintPanel.Padding = new Thickness(PanelPadding);
        _hintPanel.Content = column;
    }

    private void BuildContentPanel()
    {
        var selectorRow = new StackPanel { Spacing = 8 };
        selectorRow.Children.Add(_selector);
        selectorRow.Children.Add(_summaryLine);
        _contentPanel.Children.Add(selectorRow);

        _contentPanel.Children.Add(_summaryStats);

        _curveDetailGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(2, GridUnitType.Star) });
        _curveDetailGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetColumn(_curveChart, 0);
        Grid.SetColumn(_detailPanel, 1);
        _curveDetailGrid.Children.Add(_curveChart);
        _curveDetailGrid.Children.Add(_detailPanel);
        _contentPanel.Children.Add(_curveDetailGrid);
        _contentPanel.Children.Add(_hintPanel);

        _contentPanel.Children.Add(_comparison);

        var bottomGrid = new Grid { ColumnSpacing = ColumnGap };
        bottomGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        bottomGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetColumn(_chargerChart, 0);
        Grid.SetColumn(_speedTrend, 1);
        bottomGrid.Children.Add(_chargerChart);
        bottomGrid.Children.Add(_speedTrend);
        _contentPanel.Children.Add(bottomGrid);

        _contentPanel.Children.Add(_timeToCharge);
    }

    private static Grid ColumnsGrid(int columns, double gap, List<FrameworkElement> children)
    {
        var grid = new Grid { ColumnSpacing = gap };
        for (int c = 0; c < columns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        for (int i = 0; i < children.Count; i++)
        {
            Grid.SetColumn(children[i], i % columns);
            grid.Children.Add(children[i]);
        }

        return grid;
    }

    private static List<FrameworkElement> BuildSkeletonBlocks(int count, double height)
    {
        var blocks = new List<FrameworkElement>(count);
        for (int i = 0; i < count; i++)
        {
            blocks.Add(new TsSkeleton { BlockHeight = height });
        }

        return blocks;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        _viewModel.NotifyOpened();
        await _viewModel.LoadAsync().ConfigureAwait(true);
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Unsubscribe from and dispose the view-model and child sections (CA1001; mirrors sibling pages).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _errorState.ActionInvoked -= OnRetryInvoked;
        _selector.SelectionChanged -= OnSessionSelected;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        _viewModel.Dispose();
        _summaryStats.Dispose();
        _comparison.Dispose();
        _speedTrend.Dispose();
        _timeToCharge.Dispose();
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

    private void OnRetryInvoked(object? sender, EventArgs e) => _ = _viewModel.RefreshAsync();

    private void OnSessionSelected(object sender, SelectionChangedEventArgs e)
    {
        if (_suppressSelection)
        {
            return;
        }

        long? id = (_selector.SelectedItem as ComboBoxItem)?.Tag is long tag ? tag : null;
        _viewModel.SelectSession(id);
    }

    private void Render(ChargingCurveDisplay display)
    {
        _title.Value = display.Title;
        _subtitle.Value = display.Subtitle;
        AutomationProperties.SetName(this, display.AutomationName);

        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;

        _loadingSkeleton.Visibility = Show(display.ShowLoading);

        _errorState.Visibility = Show(display.ShowError);
        _errorState.Message = display.ErrorText;
        _errorState.ActionText = display.RetryLabel;
        AutomationProperties.SetName(_errorState, display.ErrorText);

        _emptyMessage.Value = display.EmptyMessage;
        _emptyHint.Value = display.EmptyHint;
        _emptyPanel.Visibility = Show(display.ShowEmpty);
        AutomationProperties.SetName(_emptyPanel, $"{display.EmptyMessage}. {display.EmptyHint}");

        _contentPanel.Visibility = Show(display.ShowContent);
        if (display.ShowContent)
        {
            RenderContent(display);
        }
    }

    private void RenderContent(ChargingCurveDisplay display)
    {
        UpdateSelector(display);

        _summaryLine.Value = display.SelectedSummaryLine ?? string.Empty;
        _summaryLine.Visibility = Show(!string.IsNullOrEmpty(display.SelectedSummaryLine));

        _hintText.Value = display.SelectSessionHint;
        _curveChart.Model = display.SelectedCurveModel;
        _detailPanel.Model = display.SelectedDetailModel;
        _chargerChart.Model = display.ChargerModel;

        _curveDetailGrid.Visibility = Show(display.HasSelectedSession);
        _hintPanel.Visibility = Show(!display.HasSelectedSession);
        AutomationProperties.SetName(_hintPanel, display.SelectSessionHint);
    }

    private void UpdateSelector(ChargingCurveDisplay display)
    {
        _suppressSelection = true;

        string signature = BuildOptionSignature(display.SessionOptions);
        if (signature != _optionSignature)
        {
            var items = new List<ComboBoxItem>(display.SessionOptions.Count);
            foreach (var option in display.SessionOptions)
            {
                items.Add(new ComboBoxItem { Content = option.Label, Tag = option.Id });
            }

            _selector.ItemsSource = items;
            _optionSignature = signature;
        }

        _selector.Hint = display.SelectSessionPrompt;
        AutomationProperties.SetName(_selector, display.SelectSessionPrompt);
        _selector.SelectedItem = FindOptionItem(display.SelectedSessionId);

        _suppressSelection = false;
    }

    private ComboBoxItem? FindOptionItem(long? sessionId)
    {
        if (sessionId is not { } id || _selector.ItemsSource is not IEnumerable<ComboBoxItem> items)
        {
            return null;
        }

        foreach (var item in items)
        {
            if (item.Tag is long tag && tag == id)
            {
                return item;
            }
        }

        return null;
    }

    private static string BuildOptionSignature(IReadOnlyList<ChargingCurveSessionOption> options)
    {
        if (options.Count == 0)
        {
            return string.Empty;
        }

        var ids = new string[options.Count];
        for (int i = 0; i < options.Count; i++)
        {
            ids[i] = options[i].Id.ToString(System.Globalization.CultureInfo.InvariantCulture);
        }

        return string.Join('|', ids);
    }

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;
}
