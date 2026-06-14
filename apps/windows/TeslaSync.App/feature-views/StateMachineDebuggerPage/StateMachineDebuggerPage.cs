using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Linq;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using Windows.Foundation;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Fsm;
using TeslaSync.App.FeatureViews.StateMachine;
using TeslaSync.App.Notifications;
using TeslaSync.App.SharedSurfaces;

namespace TeslaSync.App.FeatureViews.Telemetry;

/// <summary>
/// The native WinUI 3 <c>StateMachineDebuggerPage</c> — a parity port of the web page
/// <c>web/src/features/system/pages/StateMachineDebuggerPage.tsx</c> (route <c>/state-debugger</c>, nav name
/// <c>State Debugger</c>). It binds to a <see cref="StateMachineDebuggerPageViewModel"/> and reproduces every web
/// region natively in a shared <see cref="PageContainer"/>: the actions row (vehicle picker + range presets +
/// auto-refresh chip + share permalink), the FSM-type / per-page filters panel, the composed
/// <see cref="FSMHealthPanel"/>, the current-state hero, the composed <see cref="FSMSubFSMPanel"/>, the live
/// controls + <see cref="StateTimeline"/> + <see cref="SnapshotInspector"/> strip, the composed
/// <see cref="FSMStateDiagram"/>, the state-distribution donut + transition-counts table, the four stat tiles, the
/// composed <see cref="FSMTimelineChart"/>, the paged transition log and the selected-transition detail panel. The
/// view is a thin renderer: all branch selection, formatting and i18n happen in the view-model's
/// <see cref="StateMachineDebuggerDisplay"/> projection. State changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class StateMachineDebuggerPage : UserControl, IDisposable
{
    private readonly StateMachineDebuggerPageViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private readonly PageContainer _container;
    private bool _disposed;
    private bool _suppress;

    private StateMachineDebuggerDisplay _lastDisplay;
    private string _diagramFsmType = "vehicle";

    // Header actions.
    private readonly TsSelect _vehicleSelect = new() { MinWidth = 180 };
    private readonly TsSelect _rangeSelect = new() { MinWidth = 150 };
    private readonly FontIcon _refreshIcon = new() { Glyph = StateMachineDebuggerRegistration.RefreshGlyph, FontSize = 12, VerticalAlignment = VerticalAlignment.Center };
    private readonly Caption _autoRefreshText = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsCopyButton _shareButton = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small };

    // GlassPanel1 — filters.
    private readonly TsGlassPanel _filtersPanel = new();
    private readonly Label _fsmTypeLabel = new();
    private readonly TsHelpTooltip _fsmTypeHelp = new();
    private readonly TsSelect _fsmTypeSelect = new();
    private readonly Label _perPageLabel = new();
    private readonly TsSelect _perPageSelect = new();
    private readonly StackPanel _filtersGrid = new() { Spacing = 12 };
    private readonly TsEmptyState _noVehiclesState = new() { Visibility = Visibility.Collapsed };

    // GlassPanel2 — FSM health.
    private readonly FSMHealthPanel _healthPanel;

    // GlassPanel3 — current state hero.
    private readonly TsGlassPanel _currentStatePanel = new() { Padding = new Thickness(24) };
    private readonly Label _liveStateTitle = new();
    private readonly TsHelpTooltip _liveStateHelp = new();
    private readonly Caption _stateLoadingText = new() { Visibility = Visibility.Collapsed };
    private readonly TsEmptyState _noStateState = new() { Visibility = Visibility.Collapsed };
    private readonly Border _heroBadge = new() { CornerRadius = new CornerRadius(16), Padding = new Thickness(24, 12, 24, 12), Visibility = Visibility.Collapsed, HorizontalAlignment = HorizontalAlignment.Left };
    private readonly StackPanel _heroBadgeRow = new() { Orientation = Orientation.Horizontal, Spacing = 12, VerticalAlignment = VerticalAlignment.Center };
    private readonly Ellipse _heroDot = new() { Width = 12, Height = 12, VerticalAlignment = VerticalAlignment.Center };
    private readonly TextBlock _heroStateText = new() { FontSize = 28, FontWeight = Microsoft.UI.Text.FontWeights.Bold, VerticalAlignment = VerticalAlignment.Center };
    private readonly StackPanel _heroMeta = new() { Spacing = 4 };
    private readonly TextBlock _heroType = new();
    private readonly TextBlock _heroMode = new();
    private readonly TextBlock _heroSince = new();
    private readonly Caption _heroRelative = new();
    private readonly StackPanel _heroBody = new() { Orientation = Orientation.Horizontal, Spacing = 24, Visibility = Visibility.Collapsed };

    // Section 4 — sub-FSM panel.
    private readonly FSMSubFSMPanel _subFsmPanel;

    // Live controls + timeline + inspector.
    private readonly TsGlassPanel _livePanel = new() { Padding = new Thickness(20) };
    private readonly LiveControls _liveControls;
    private readonly StateTimeline _stateTimeline;
    private readonly SnapshotInspector _snapshotInspector;

    // Section 5 — state diagram.
    private readonly Border _diagramHost = new();
    private FSMStateDiagram _stateDiagram;

    // State distribution donut.
    private readonly TsChartContainer _distribution = new();
    private readonly TsPieChart _pie = new() { InnerRadiusRatio = 0.6, MinHeight = 220 };
    private readonly StackPanel _pieBody = new() { Spacing = 8, HorizontalAlignment = HorizontalAlignment.Center };
    private readonly StackPanel _pieColumnsHeader = new() { Orientation = Orientation.Horizontal, Spacing = 8, HorizontalAlignment = HorizontalAlignment.Center };
    private readonly Caption _pieColState = new();
    private readonly Caption _pieColCount = new();
    private readonly FlowWrapPanel _pieLegend = new() { HorizontalSpacing = 12, VerticalSpacing = 6, HorizontalAlignment = HorizontalAlignment.Center };

    // Transition counts table.
    private readonly TsGlassPanel _countsPanel = new() { Padding = new Thickness(20) };
    private readonly PanelTitle _countsTitle = new();
    private readonly Grid _countsHeader = new() { Margin = new Thickness(0, 0, 0, 8) };
    private readonly Label _countsStateHeader = new();
    private readonly Label _countsCountHeader = new() { HorizontalAlignment = HorizontalAlignment.Right };
    private readonly Label _countsIntervalHeader = new() { HorizontalAlignment = HorizontalAlignment.Right };
    private readonly StackPanel _countsRows = new();
    private readonly Caption _countsLoading = new() { Visibility = Visibility.Collapsed };
    private readonly TsEmptyState _countsEmpty = new() { Visibility = Visibility.Collapsed };

    // Stat cards.
    private readonly TsStatCard[] _statCards = { new(), new(), new(), new() };

    // FSM timeline chart.
    private readonly FSMTimelineChart _timelineChart;

    // Transition log.
    private readonly TsGlassPanel _logPanel = new() { Padding = new Thickness(20) };
    private readonly PanelTitle _logTitle = new();
    private readonly Caption _logTotal = new() { VerticalAlignment = VerticalAlignment.Bottom };
    private readonly Grid _logHeader = new() { Margin = new Thickness(0, 0, 0, 8) };
    private readonly Label _logIdxHeader = new() { HorizontalAlignment = HorizontalAlignment.Right };
    private readonly Label _logTimeHeader = new();
    private readonly Label _logFsmHeader = new();
    private readonly Label _logFromHeader = new();
    private readonly Label _logToHeader = new();
    private readonly Label _logTriggerHeader = new();
    private readonly StackPanel _logRows = new();
    private readonly Caption _logLoading = new() { Visibility = Visibility.Collapsed };
    private readonly TsEmptyState _logEmpty = new() { Visibility = Visibility.Collapsed };
    private readonly TsPagination _pagination = new() { HorizontalAlignment = HorizontalAlignment.Center };

    // Detail panel.
    private readonly TsGlassPanel _detailPanel = new() { Padding = new Thickness(20), Visibility = Visibility.Collapsed };
    private readonly PanelTitle _detailTitle = new();
    private readonly FlowWrapPanel _detailFields = new() { HorizontalSpacing = 24, VerticalSpacing = 16 };
    private readonly StackPanel _detailContext = new() { Spacing = 4, Visibility = Visibility.Collapsed };
    private readonly Caption _detailContextLabel = new();
    private readonly FlowWrapPanel _detailContextChips = new() { HorizontalSpacing = 8, VerticalSpacing = 8 };

    /// <summary>Creates the page over the default empty feed and the shell resource localizer.</summary>
    public StateMachineDebuggerPage()
        : this(EmptyStateMachineDebuggerFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The debugger data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public StateMachineDebuggerPage(IStateMachineDebuggerFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _viewModel = new StateMachineDebuggerPageViewModel(feed, localizer);

        _healthPanel = new FSMHealthPanel(localizer);
        _subFsmPanel = new FSMSubFSMPanel(localizer);
        _liveControls = new LiveControls(localizer);
        _stateTimeline = new StateTimeline(localizer);
        _snapshotInspector = new SnapshotInspector(localizer);
        _timelineChart = new FSMTimelineChart(localizer);
        _stateDiagram = new FSMStateDiagram(EmptyFsmStateDiagramSource.Instance, _diagramFsmType, localizer);

        _lastDisplay = _viewModel.Display;

        _container = new PageContainer(localizer, _viewModel.Title)
        {
            Subtitle = _viewModel.Subtitle,
            Actions = BuildActions(),
            PageContent = BuildBody(),
        };

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        AutomationProperties.SetName(this, _viewModel.Title);
        Content = _container;

        WireEvents();
        Render(_viewModel.Display);
    }

    /// <summary>The diagnostics surface slug (<c>StateMachineDebuggerPage</c>).</summary>
    public static string Slug => StateMachineDebuggerRegistration.Slug;

    private StackPanel BuildActions()
    {
        _vehicleSelect.DisplayMemberPath = nameof(OptionDisplay.Label);
        _rangeSelect.DisplayMemberPath = nameof(OptionDisplay.Label);

        var refreshChip = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4, VerticalAlignment = VerticalAlignment.Center };
        AutomationProperties.SetAccessibilityView(_refreshIcon, AccessibilityView.Raw);
        refreshChip.Children.Add(_refreshIcon);
        refreshChip.Children.Add(_autoRefreshText);

        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        actions.Children.Add(_vehicleSelect);
        actions.Children.Add(_rangeSelect);
        actions.Children.Add(refreshChip);
        actions.Children.Add(_shareButton);
        return actions;
    }

    private ScrollViewer BuildBody()
    {
        var stack = new StackPanel { Spacing = 16 };
        stack.Children.Add(BuildFiltersPanel());
        stack.Children.Add(_healthPanel);
        stack.Children.Add(BuildCurrentStatePanel());
        stack.Children.Add(_subFsmPanel);
        stack.Children.Add(BuildLivePanel());
        stack.Children.Add(_diagramHost);
        stack.Children.Add(BuildDistributionRow());
        stack.Children.Add(BuildStatCards());
        stack.Children.Add(_timelineChart);
        stack.Children.Add(BuildLogPanel());
        stack.Children.Add(BuildDetailPanel());

        _diagramHost.Child = _stateDiagram;

        return new ScrollViewer
        {
            Content = stack,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
    }

    private TsGlassPanel BuildFiltersPanel()
    {
        var typeColumn = new StackPanel { Spacing = 4 };
        var typeLabelRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4, VerticalAlignment = VerticalAlignment.Center };
        typeLabelRow.Children.Add(_fsmTypeLabel);
        typeLabelRow.Children.Add(_fsmTypeHelp);
        typeColumn.Children.Add(typeLabelRow);
        typeColumn.Children.Add(_fsmTypeSelect);
        _fsmTypeSelect.HorizontalAlignment = HorizontalAlignment.Stretch;
        _fsmTypeSelect.DisplayMemberPath = nameof(OptionDisplay.Label);

        var perPageColumn = new StackPanel { Spacing = 4 };
        perPageColumn.Children.Add(_perPageLabel);
        perPageColumn.Children.Add(_perPageSelect);
        _perPageSelect.HorizontalAlignment = HorizontalAlignment.Stretch;
        _perPageSelect.DisplayMemberPath = nameof(OptionDisplay.Label);

        _filtersGrid.Children.Add(typeColumn);
        _filtersGrid.Children.Add(perPageColumn);

        var body = new StackPanel { Padding = new Thickness(20), Spacing = 12 };
        body.Children.Add(_filtersGrid);
        body.Children.Add(_noVehiclesState);
        _filtersPanel.Content = body;
        return _filtersPanel;
    }

    private TsGlassPanel BuildCurrentStatePanel()
    {
        var header = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4, Margin = new Thickness(0, 0, 0, 12), VerticalAlignment = VerticalAlignment.Center };
        header.Children.Add(_liveStateTitle);
        header.Children.Add(_liveStateHelp);

        _heroBadgeRow.Children.Add(_heroDot);
        _heroBadgeRow.Children.Add(_heroStateText);
        _heroBadge.Child = _heroBadgeRow;

        _heroMeta.Children.Add(_heroType);
        _heroMeta.Children.Add(_heroMode);
        _heroMeta.Children.Add(_heroSince);
        _heroMeta.Children.Add(_heroRelative);
        _heroMeta.VerticalAlignment = VerticalAlignment.Center;

        _heroBody.Children.Add(_heroBadge);
        _heroBody.Children.Add(_heroMeta);

        var body = new StackPanel { Spacing = 8 };
        body.Children.Add(header);
        body.Children.Add(_stateLoadingText);
        body.Children.Add(_heroBody);
        body.Children.Add(_noStateState);
        _currentStatePanel.Content = body;
        return _currentStatePanel;
    }

    private TsGlassPanel BuildLivePanel()
    {
        var body = new StackPanel { Spacing = 16 };
        body.Children.Add(_liveControls);
        body.Children.Add(_stateTimeline);
        body.Children.Add(_snapshotInspector);
        _livePanel.Content = body;
        return _livePanel;
    }

    private Grid BuildDistributionRow()
    {
        _pieColumnsHeader.Children.Add(_pieColState);
        _pieColumnsHeader.Children.Add(_pieColCount);
        _pieBody.Children.Add(_pie);
        _pieBody.Children.Add(_pieColumnsHeader);
        _pieBody.Children.Add(_pieLegend);
        _distribution.Body = _pieBody;

        var grid = new Grid { ColumnSpacing = 16 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetColumn(_distribution, 0);
        Grid.SetColumn(BuildCountsPanel(), 1);
        grid.Children.Add(_distribution);
        grid.Children.Add(_countsPanel);
        return grid;
    }

    private TsGlassPanel BuildCountsPanel()
    {
        _countsHeader.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(2, GridUnitType.Star) });
        _countsHeader.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _countsHeader.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetColumn(_countsStateHeader, 0);
        Grid.SetColumn(_countsCountHeader, 1);
        Grid.SetColumn(_countsIntervalHeader, 2);
        _countsHeader.Children.Add(_countsStateHeader);
        _countsHeader.Children.Add(_countsCountHeader);
        _countsHeader.Children.Add(_countsIntervalHeader);

        var body = new StackPanel { Spacing = 8 };
        body.Children.Add(_countsTitle);
        body.Children.Add(_countsHeader);
        body.Children.Add(_countsRows);
        body.Children.Add(_countsLoading);
        body.Children.Add(_countsEmpty);
        _countsPanel.Content = body;
        return _countsPanel;
    }

    private Grid BuildStatCards()
    {
        var grid = new Grid { ColumnSpacing = 12 };
        for (int i = 0; i < _statCards.Length; i++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            _statCards[i].HorizontalAlignment = HorizontalAlignment.Stretch;
            Grid.SetColumn(_statCards[i], i);
            grid.Children.Add(_statCards[i]);
        }

        return grid;
    }

    private TsGlassPanel BuildLogPanel()
    {
        var titleRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Margin = new Thickness(0, 0, 0, 12) };
        titleRow.Children.Add(_logTitle);
        titleRow.Children.Add(_logTotal);

        _logHeader.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(40) });
        _logHeader.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1.4, GridUnitType.Star) });
        _logHeader.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _logHeader.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1.2, GridUnitType.Star) });
        _logHeader.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1.2, GridUnitType.Star) });
        _logHeader.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetColumn(_logIdxHeader, 0);
        Grid.SetColumn(_logTimeHeader, 1);
        Grid.SetColumn(_logFsmHeader, 2);
        Grid.SetColumn(_logFromHeader, 3);
        Grid.SetColumn(_logToHeader, 4);
        Grid.SetColumn(_logTriggerHeader, 5);
        _logHeader.Children.Add(_logIdxHeader);
        _logHeader.Children.Add(_logTimeHeader);
        _logHeader.Children.Add(_logFsmHeader);
        _logHeader.Children.Add(_logFromHeader);
        _logHeader.Children.Add(_logToHeader);
        _logHeader.Children.Add(_logTriggerHeader);

        var body = new StackPanel { Spacing = 8 };
        body.Children.Add(titleRow);
        body.Children.Add(_logHeader);
        body.Children.Add(_logRows);
        body.Children.Add(_logLoading);
        body.Children.Add(_logEmpty);
        body.Children.Add(_pagination);
        _logPanel.Content = body;
        return _logPanel;
    }

    private TsGlassPanel BuildDetailPanel()
    {
        _detailContext.Children.Add(_detailContextLabel);
        _detailContext.Children.Add(_detailContextChips);

        var body = new StackPanel { Spacing = 16 };
        body.Children.Add(_detailTitle);
        body.Children.Add(_detailFields);
        body.Children.Add(_detailContext);
        _detailPanel.Content = body;
        return _detailPanel;
    }

    private void WireEvents()
    {
        _vehicleSelect.SelectionChanged += OnVehicleChanged;
        _rangeSelect.SelectionChanged += OnRangeChanged;
        _fsmTypeSelect.SelectionChanged += OnFsmTypeChanged;
        _perPageSelect.SelectionChanged += OnPerPageChanged;
        _pagination.PageChanged += OnPageChanged;

        _liveControls.LiveToggled += (_, live) => Guard(() => _viewModel.SetLive(live));
        _liveControls.StepPrevRequested += (_, _) => InvokeAsync(() => _viewModel.StepPreviousAsync());
        _liveControls.StepNextRequested += (_, _) => InvokeAsync(() => _viewModel.StepNextAsync());
        _liveControls.WindowChanged += (_, minutes) => Guard(() => _viewModel.SetWindowMinutes(minutes));
        _liveControls.ClearBufferRequested += (_, _) => Guard(() => _viewModel.ClearBuffer());

        _stateTimeline.TransitionSelected += (_, id) => InvokeAsync(() => _viewModel.SelectTransitionAsync(id));
        _stateTimeline.WidenWindowRequested += (_, _) => Guard(() =>
            _viewModel.SetWindowMinutes(_lastDisplay.StateTimeline.WiderPreset ?? _lastDisplay.StateTimeline.WindowMinutes));
        _stateTimeline.JumpToLastRequested += (_, _) => InvokeAsync(() => _viewModel.JumpToLastAsync());

        _snapshotInspector.JumpToLastRequested += (_, _) => InvokeAsync(() => _viewModel.JumpToLastAsync());
        _snapshotInspector.RetryRequested += (_, _) => InvokeAsync(() => _viewModel.RefetchSnapshotAsync());

        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        _viewModel.NotifyOpened();
        await _viewModel.LoadAsync().ConfigureAwait(true);
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelChanged(object? sender, PropertyChangedEventArgs e)
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

    private void Render(StateMachineDebuggerDisplay display)
    {
        _suppress = true;
        _lastDisplay = display;

        _container.Title = display.Title;
        _container.Subtitle = display.Subtitle;
        _container.IsLoading = display.InitialLoading;
        AutomationProperties.SetName(this, display.AutomationName);

        RenderActions(display);
        RenderFilters(display);
        _healthPanel.Model = display.HealthModel;
        RenderCurrentState(display);
        _subFsmPanel.Model = display.SubFsmModel;
        _liveControls.Model = display.LiveControls;
        _stateTimeline.Model = display.StateTimeline;
        _snapshotInspector.Model = display.SnapshotInspector;
        RenderDiagram(display);
        RenderDistribution(display);
        RenderCounts(display);
        RenderStatCards(display);
        _timelineChart.Model = display.TimelineChartModel;
        RenderLog(display);
        RenderDetail(display);

        _suppress = false;
    }

    private void RenderActions(StateMachineDebuggerDisplay display)
    {
        _vehicleSelect.Visibility = Show(display.HasVehicles);
        _vehicleSelect.ItemsSource = display.VehicleOptions;
        _vehicleSelect.SelectedItem = display.VehicleOptions.FirstOrDefault(o => o.Value == display.SelectedVehicleValue);
        AutomationProperties.SetName(_vehicleSelect, display.SelectVehicleLabel);

        _rangeSelect.ItemsSource = display.RangeOptions;
        _rangeSelect.SelectedItem = display.RangeOptions.FirstOrDefault(o => o.Value == display.SelectedRangeValue);
        AutomationProperties.SetName(
            _rangeSelect,
            display.RangeOptions.FirstOrDefault(o => o.Value == display.SelectedRangeValue)?.Label ?? display.SelectedRangeValue);

        _autoRefreshText.Value = display.AutoRefreshLabel;
        _shareButton.Text = display.ShareLabel;
        _shareButton.CopyLabel = display.ShareLabel;
        _shareButton.ValueToCopy = StateMachineDebuggerRegistration.RouteName;
        AutomationProperties.SetName(_shareButton, display.ShareLabel);
    }

    private void RenderFilters(StateMachineDebuggerDisplay display)
    {
        _filtersGrid.Visibility = Show(display.HasVehicles);
        _noVehiclesState.Visibility = Show(!display.HasVehicles);
        _noVehiclesState.Message = display.NoVehiclesMessage;

        _fsmTypeLabel.Value = display.FsmTypeLabel;
        _fsmTypeHelp.Hint = display.HelpTypeBody;
        AutomationProperties.SetName(_fsmTypeHelp, display.HelpTypeAria);
        _fsmTypeSelect.ItemsSource = display.FsmTypeOptions;
        _fsmTypeSelect.SelectedItem = display.FsmTypeOptions.FirstOrDefault(o => o.Value == display.SelectedFsmTypeValue);
        AutomationProperties.SetName(_fsmTypeSelect, display.FsmTypeLabel);

        _perPageLabel.Value = display.PerPageLabel;
        _perPageSelect.ItemsSource = display.PerPageOptions;
        _perPageSelect.SelectedItem = display.PerPageOptions.FirstOrDefault(o => o.Value == display.SelectedPerPageValue);
        AutomationProperties.SetName(_perPageSelect, display.PerPageLabel);
    }

    private void RenderCurrentState(StateMachineDebuggerDisplay display)
    {
        _liveStateTitle.Value = display.VehicleLiveStateTitle;
        _liveStateHelp.Hint = display.HelpLiveStateBody;
        AutomationProperties.SetName(_liveStateHelp, display.HelpLiveStateAria);

        _stateLoadingText.Value = display.AutoRefreshLabel;
        _stateLoadingText.Visibility = Show(display.StateLoading);
        _noStateState.Message = display.NoStateMessage;
        _noStateState.Visibility = Show(!display.StateLoading && !display.ShowState);
        _heroBody.Visibility = Show(display.ShowState);

        if (display.Hero is { } hero)
        {
            var brush = StatusBrush(hero.Status);
            _heroDot.Fill = brush;
            _heroStateText.Text = hero.StateText;
            _heroStateText.Foreground = brush;
            _heroBadge.Background = TintBrush(hero.Status);
            _heroBadge.Visibility = Visibility.Visible;
            _heroType.Text = $"{hero.TypeLabel}: {hero.TypeValue}";
            _heroMode.Text = $"{hero.ModeLabel}: {hero.ModeValue}";
            _heroSince.Text = $"{hero.SinceLabel}: {hero.SinceText}";
            _heroRelative.Value = hero.SinceRelative;
            _heroRelative.Visibility = Show(hero.HasSince);
            ApplySecondary(_heroType, _heroMode, _heroSince);
        }
    }

    private void RenderDiagram(StateMachineDebuggerDisplay display)
    {
        if (string.Equals(_diagramFsmType, display.DiagramFsmType, StringComparison.Ordinal))
        {
            return;
        }

        _diagramFsmType = display.DiagramFsmType;
        _stateDiagram.Dispose();
        _stateDiagram = new FSMStateDiagram(EmptyFsmStateDiagramSource.Instance, _diagramFsmType, _localizer);
        _diagramHost.Child = _stateDiagram;
    }

    private void RenderDistribution(StateMachineDebuggerDisplay display)
    {
        _distribution.Title = display.DistributionTitle;
        _distribution.AccessibleSummary = display.DistributionAria;
        _distribution.EmptyMessage = display.ChartEmptyMessage;
        _distribution.State = display.ChartState;
        _pie.Values = display.PieValues;
        _pieColState.Value = display.ChartColStateLabel;
        _pieColCount.Value = display.ChartColCountLabel;
        _pieColumnsHeader.Visibility = Show(display.PieLegend.Count > 0);

        _pieLegend.Children.Clear();
        foreach (var item in display.PieLegend)
        {
            var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
            var dot = new Ellipse { Width = 10, Height = 10, Fill = ChartBrushes.ForIndex(item.ColorIndex), VerticalAlignment = VerticalAlignment.Center };
            var name = new Caption { Value = item.Name, VerticalAlignment = VerticalAlignment.Center };
            var count = new Caption { Value = item.CountText, VerticalAlignment = VerticalAlignment.Center };
            row.Children.Add(dot);
            row.Children.Add(name);
            row.Children.Add(count);
            _pieLegend.Children.Add(row);
        }
    }

    private void RenderCounts(StateMachineDebuggerDisplay display)
    {
        _countsTitle.Value = display.TransitionCountsTitle;
        _countsStateHeader.Value = display.ColStateLabel;
        _countsCountHeader.Value = display.ColCountLabel;
        _countsIntervalHeader.Value = display.AvgIntervalLabel;

        _countsLoading.Value = display.AutoRefreshLabel;
        _countsLoading.Visibility = Show(display.CountsLoading);
        _countsEmpty.Message = display.CountsEmptyMessage;
        _countsEmpty.Visibility = Show(!display.CountsLoading && !display.ShowCounts);
        _countsHeader.Visibility = Show(display.ShowCounts);
        _countsRows.Visibility = Show(display.ShowCounts);

        _countsRows.Children.Clear();
        foreach (var row in display.SummaryRows)
        {
            var grid = new Grid { Padding = new Thickness(0, 6, 0, 6) };
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(2, GridUnitType.Star) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

            var badge = BuildBadge(row.State);
            Grid.SetColumn(badge, 0);
            var count = new Text { Value = row.CountText, HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Center };
            Grid.SetColumn(count, 1);
            var interval = new Caption { Value = row.AvgIntervalText, HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Center };
            Grid.SetColumn(interval, 2);
            grid.Children.Add(badge);
            grid.Children.Add(count);
            grid.Children.Add(interval);
            _countsRows.Children.Add(grid);
        }
    }

    private void RenderStatCards(StateMachineDebuggerDisplay display)
    {
        for (int i = 0; i < _statCards.Length && i < display.StatCards.Count; i++)
        {
            _statCards[i].Label = display.StatCards[i].Label;
            _statCards[i].Value = display.StatCards[i].Value;
            _statCards[i].Glyph = display.StatCards[i].Glyph;
            AutomationProperties.SetName(_statCards[i], $"{display.StatCards[i].Label}: {display.StatCards[i].Value}");
        }
    }

    private void RenderLog(StateMachineDebuggerDisplay display)
    {
        _logTitle.Value = display.TransitionLogTitle;
        _logTotal.Value = display.TransitionLogTotalText;
        _logTotal.Visibility = Show(display.HasTotal);

        _logTimeHeader.Value = display.TimeColumnLabel;
        _logFsmHeader.Value = display.FsmColumnLabel;
        _logFromHeader.Value = display.FromColumnLabel;
        _logToHeader.Value = display.ToColumnLabel;
        _logTriggerHeader.Value = display.TriggerColumnLabel;
        _logIdxHeader.Value = "#";

        _logLoading.Value = display.AutoRefreshLabel;
        _logLoading.Visibility = Show(display.TransitionsLoading);
        _logEmpty.Message = display.TransitionsEmptyMessage;
        _logEmpty.Visibility = Show(!display.TransitionsLoading && !display.ShowTransitions);
        _logHeader.Visibility = Show(display.ShowTransitions);
        _logRows.Visibility = Show(display.ShowTransitions);

        _logRows.Children.Clear();
        foreach (var row in display.TransitionRows)
        {
            _logRows.Children.Add(BuildLogRow(row, display));
        }

        _pagination.Visibility = Show(display.ShowPagination);
        _pagination.PageSize = display.PerPage;
        _pagination.TotalItems = display.TotalRows;
        _pagination.Page = display.Page;
    }

    private Border BuildLogRow(TransitionRowDisplay row, StateMachineDebuggerDisplay display)
    {
        var grid = new Grid { Padding = new Thickness(0, 6, 0, 6) };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(40) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1.4, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1.2, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1.2, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(36) });

        var idx = new Caption { Value = row.IndexText, HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(idx, 0);
        var time = new Caption { Value = row.TimeText, VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(time, 1);
        var fsm = new Caption { Value = row.FsmText, VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(fsm, 2);
        var from = BuildBadge(row.FromBadge);
        Grid.SetColumn(from, 3);
        var to = BuildBadge(row.ToBadge);
        Grid.SetColumn(to, 4);
        var trigger = new Caption { Value = row.Trigger, VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(trigger, 5);

        var detailButton = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            IconGlyph = row.IsSelected ? "\uE70D" : "\uE70E",
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(detailButton, row.ViewDetailAria);
        long id = row.Id;
        detailButton.Click += (_, _) => InvokeAsync(() => _viewModel.SelectTransitionAsync(id));
        Grid.SetColumn(detailButton, 6);

        grid.Children.Add(idx);
        grid.Children.Add(time);
        grid.Children.Add(fsm);
        grid.Children.Add(from);
        grid.Children.Add(to);
        grid.Children.Add(trigger);
        grid.Children.Add(detailButton);

        var border = new Border
        {
            Child = grid,
            BorderThickness = new Thickness(0, 0, 0, 1),
            BorderBrush = Brush("TsColorBorderBrush"),
            Background = row.IsSelected ? TintBrush(StatusKind.Info) : null,
        };
        return border;
    }

    private void RenderDetail(StateMachineDebuggerDisplay display)
    {
        _detailPanel.Visibility = Show(display.ShowDetail);
        if (!display.ShowDetail)
        {
            return;
        }

        _detailTitle.Value = display.DetailTitle;

        _detailFields.Children.Clear();
        foreach (var field in display.DetailFields)
        {
            var column = new StackPanel { Spacing = 4, MinWidth = 160 };
            column.Children.Add(new Caption { Value = field.Label });
            if (field.Badge is { } badge)
            {
                column.Children.Add(BuildBadge(badge));
            }
            else if (field.Mono)
            {
                column.Children.Add(new Code { Value = field.Value });
            }
            else
            {
                column.Children.Add(new Text { Value = field.Value });
            }

            _detailFields.Children.Add(column);
        }

        _detailContextLabel.Value = display.DetailContextLabel;
        _detailContext.Visibility = Show(display.DetailContextChips.Count > 0);
        _detailContextChips.Children.Clear();
        foreach (var chip in display.DetailContextChips)
        {
            _detailContextChips.Children.Add(new Border
            {
                CornerRadius = new CornerRadius(4),
                Padding = new Thickness(8, 2, 8, 2),
                Background = Brush("TsColorSurfaceGlassBrush"),
                Child = new Caption { Value = chip },
            });
        }
    }

    private static TsBadge BuildBadge(StateBadgeInfo info) => new()
    {
        Status = info.Status,
        Dot = true,
        Content = info.Text,
        VerticalAlignment = VerticalAlignment.Center,
        HorizontalAlignment = HorizontalAlignment.Left,
    };

    private void OnVehicleChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppress || _vehicleSelect.SelectedItem is not OptionDisplay option || !long.TryParse(option.Value, out var id))
        {
            return;
        }

        InvokeAsync(() => _viewModel.SelectVehicleAsync(id));
    }

    private void OnRangeChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppress || _rangeSelect.SelectedItem is not OptionDisplay option || !Enum.TryParse<RangePreset>(option.Value, out var preset))
        {
            return;
        }

        InvokeAsync(() => _viewModel.SetRangeAsync(preset));
    }

    private void OnFsmTypeChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppress || _fsmTypeSelect.SelectedItem is not OptionDisplay option)
        {
            return;
        }

        InvokeAsync(() => _viewModel.SetFsmTypeAsync(option.Value));
    }

    private void OnPerPageChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppress || _perPageSelect.SelectedItem is not OptionDisplay option || !int.TryParse(option.Value, out var perPage))
        {
            return;
        }

        InvokeAsync(() => _viewModel.SetPerPageAsync(perPage));
    }

    private void OnPageChanged(object? sender, int page)
    {
        if (_suppress)
        {
            return;
        }

        InvokeAsync(() => _viewModel.SetPageAsync(page));
    }

    /// <summary>Unsubscribe from and dispose the view-model and composed surfaces (idempotent; CA1001).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        _stateDiagram.Dispose();
        _viewModel.Dispose();
        _container.Dispose();
        GC.SuppressFinalize(this);
    }

    private void Guard(Action action)
    {
        if (_suppress)
        {
            return;
        }

        action();
    }

    private static void ApplySecondary(params TextBlock[] blocks)
    {
        var brush = Brush("TsColorTextSecondaryBrush");
        foreach (var block in blocks)
        {
            block.Foreground = brush;
            block.FontSize = 13;
        }
    }

    private static Brush? StatusBrush(StatusKind status) => Brush(StatusResources.AccentBrushKey(status));

    private static SolidColorBrush? TintBrush(StatusKind status)
    {
        if (Brush(StatusResources.AccentBrushKey(status)) is SolidColorBrush solid)
        {
            var color = solid.Color;
            color.A = 28;
            return new SolidColorBrush(color);
        }

        return null;
    }

    private static Brush? Brush(string key) =>
        Application.Current.Resources.TryGetValue(key, out var value) && value is Brush brush ? brush : null;

    private static async void InvokeAsync(Func<System.Threading.Tasks.Task> action) =>
        await action().ConfigureAwait(true);

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;

    protected override AutomationPeer OnCreateAutomationPeer() => new StateMachineDebuggerPageAutomationPeer(this);

    private sealed class StateMachineDebuggerPageAutomationPeer(StateMachineDebuggerPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }

    /// <summary>
    /// A minimal left-to-right wrapping panel — the native analogue of the web <c>flex flex-wrap</c> rows used by
    /// the pie legend, the transition-detail grid and the details chips. Mirrors the established per-surface
    /// wrap-panel pattern (WinUI 3 ships no built-in <c>WrapPanel</c>).
    /// </summary>
    private sealed partial class FlowWrapPanel : Panel
    {
        public double HorizontalSpacing { get; set; }

        public double VerticalSpacing { get; set; }

        protected override Size MeasureOverride(Size availableSize)
        {
            double maxWidth = double.IsInfinity(availableSize.Width) ? double.PositiveInfinity : availableSize.Width;
            double x = 0, rowHeight = 0, totalHeight = 0, widest = 0;
            foreach (var child in Children)
            {
                child.Measure(new Size(double.PositiveInfinity, double.PositiveInfinity));
                var d = child.DesiredSize;
                if (x > 0 && x + d.Width > maxWidth)
                {
                    totalHeight += rowHeight + VerticalSpacing;
                    widest = Math.Max(widest, x - HorizontalSpacing);
                    x = 0;
                    rowHeight = 0;
                }

                x += d.Width + HorizontalSpacing;
                rowHeight = Math.Max(rowHeight, d.Height);
            }

            totalHeight += rowHeight;
            widest = Math.Max(widest, x - HorizontalSpacing);
            double width = double.IsInfinity(maxWidth) ? widest : maxWidth;
            return new Size(Math.Max(0, width), Math.Max(0, totalHeight));
        }

        protected override Size ArrangeOverride(Size finalSize)
        {
            double x = 0, y = 0, rowHeight = 0;
            foreach (var child in Children)
            {
                var d = child.DesiredSize;
                if (x > 0 && x + d.Width > finalSize.Width)
                {
                    x = 0;
                    y += rowHeight + VerticalSpacing;
                    rowHeight = 0;
                }

                child.Arrange(new Rect(x, y, d.Width, d.Height));
                x += d.Width + HorizontalSpacing;
                rowHeight = Math.Max(rowHeight, d.Height);
            }

            return finalSize;
        }
    }
}
