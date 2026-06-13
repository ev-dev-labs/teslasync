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
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.SignalDiff;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Telemetry;

/// <summary>
/// The native WinUI 3 <c>SignalsWorkspacePage</c> — a parity port of the web page
/// web/src/features/telemetry/pages/SignalsWorkspacePage.tsx (route <c>/signals</c>, nav name <c>Signals</c>). The
/// web page is a thin orchestrator that composes the shared telemetry components inside a <c>PageContainer</c>; this
/// view reproduces the whole tree natively: it mounts the shared <see cref="SharedSurfaces.PageContainer"/> (title +
/// subtitle, the live-connection badge, the "Share" copy-link) whose body holds the headline stat strip (Selected /
/// Mode / Live-rate / Pinned-signals), the "Add signals" disclosure hosting the shared <see cref="SignalSelector"/>
/// catalog, the workspace toolbar (Time Range / Per Page / Run / Live / Compare + the help affordance), and the two
/// mutually-exclusive mode sections — Compare (the <see cref="SignalCompareControls"/>, the four diff stat cards, the
/// bulk-actions toolbar and the diff panel with its loading / empty / error / rows branches + pinned chips) and
/// Live/Historical (the <see cref="SignalStatsPanel"/>, the chart-layout tabs, the <see cref="SignalChartPanel"/>, and
/// the "pick signals and run a query" empty panel) — above the catalog-refresh footer. The view is a thin renderer:
/// every label, value, data-state and section-visibility flag flows from the view-model's
/// <see cref="SignalsWorkspaceDisplay"/> projection; state changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class SignalsWorkspacePage : UserControl, IDisposable
{
    private const double SectionSpacing = 20;
    private const string PinGlyph = "\uE718";          // Segoe Fluent Pin
    private const string SortGlyph = "\uE8CB";          // Segoe Fluent Sort
    private const string ActivityGlyph = "\uE9D2";      // Segoe Fluent activity
    private const string DatabaseGlyph = "\uE9D9";      // Segoe Fluent data
    private const string RefreshGlyph = "\uE72C";       // Segoe Fluent Refresh
    private const string CompareGlyph = "\uE8AB";       // Segoe Fluent switch/compare
    private const string ShareLinkUri = "teslasync://signals";

    private readonly SignalsWorkspacePageViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly SharedSurfaces.PageContainer _container;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;

    private readonly StackPanel _root = new() { Spacing = SectionSpacing };

    private readonly TsAlertBanner _errorBanner = new()
    {
        Variant = CalloutVariant.Danger,
        Visibility = Visibility.Collapsed,
    };

    private readonly TsEmptyState _noVehicle = new()
    {
        IconGlyph = ActivityGlyph,
        Visibility = Visibility.Collapsed,
    };

    private readonly TsStatCard _statSelected = new() { Glyph = SortGlyph };
    private readonly TsStatCard _statMode = new() { Glyph = DatabaseGlyph };
    private readonly TsStatCard _statLiveRate = new() { Glyph = ActivityGlyph };
    private readonly TsStatCard _statPinned = new() { Glyph = PinGlyph };

    private readonly TsBadge _liveBadge = new() { Dot = true, Visibility = Visibility.Collapsed };

    private readonly TsAccordion _accordion = new() { IsExpanded = false };
    private readonly Text _accordionTitle = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsBadge _accordionBadge = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly SignalSelector _selector;

    private readonly TsGlassPanel _toolbar = new() { Padding = new Thickness(18) };
    private readonly Label _timeRangeLabel = new();
    private readonly TsSelect _timeRangeSelect = new() { MinWidth = 150 };
    private readonly Label _perPageLabel = new();
    private readonly TsSelect _perPageSelect = new() { MinWidth = 88 };
    private readonly TsButton _runButton = new() { Variant = ButtonVariant.Primary, IconGlyph = DatabaseGlyph };
    private readonly TsButton _liveButton = new() { Variant = ButtonVariant.Outline, IconGlyph = ActivityGlyph };
    private readonly TsButton _compareButton = new() { Variant = ButtonVariant.Outline, IconGlyph = CompareGlyph };
    private readonly TsHelpTooltip _help = new();

    // ── Compare section ───────────────────────────────────────────────────────────────────────
    private readonly StackPanel _compareSection = new() { Spacing = SectionSpacing, Visibility = Visibility.Collapsed };
    private readonly SignalCompareControls _compareControls;
    private readonly TsStatCard _statChanged = new();
    private readonly TsStatCard _statVisible = new();
    private readonly TsStatCard _statDiffPinned = new();
    private readonly TsStatCard _statWindowSpan = new();
    private readonly TsButton _bulkPin = new() { Variant = ButtonVariant.Secondary, Size = ControlSize.Small, IconGlyph = PinGlyph };
    private readonly TsButton _bulkUnpin = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small };
    private readonly TsButton _bulkCsv = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small };
    private readonly TsButton _bulkAlert = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small };

    private readonly TsGlassPanel _diffPanel = new() { Padding = new Thickness(18) };
    private readonly Grid _diffBodyHost = new();
    private readonly StackPanel _diffLoadingHost = new() { Spacing = 8, Visibility = Visibility.Collapsed };
    private readonly StackPanel _diffEmptyHost = new() { Spacing = 8, Padding = new Thickness(0, 40, 0, 40), HorizontalAlignment = HorizontalAlignment.Center, Visibility = Visibility.Collapsed };
    private readonly FontIcon _diffEmptyIcon = new() { Glyph = CompareGlyph, FontSize = 28, HorizontalAlignment = HorizontalAlignment.Center };
    private readonly HelperText _diffEmptyText = new() { HorizontalAlignment = HorizontalAlignment.Center };
    private readonly ErrorText _diffErrorText = new() { Visibility = Visibility.Collapsed };
    private readonly StackPanel _diffRowsHost = new() { Visibility = Visibility.Collapsed };
    private readonly Grid _diffHeader = new();
    private readonly StackPanel _diffRowsBody = new();
    private readonly StackPanel _pinnedChipsHost = new() { Orientation = Orientation.Horizontal, Spacing = 6, Visibility = Visibility.Collapsed };
    private readonly Caption _pinnedChipsLabel = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly StackPanel _pinnedChipsItems = new() { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };

    // ── Live / historical section ─────────────────────────────────────────────────────────────
    private readonly StackPanel _historicalSection = new() { Spacing = SectionSpacing };
    private readonly SignalStatsPanel _statsPanel;
    private readonly StackPanel _chartModeRow = new() { Orientation = Orientation.Horizontal, Spacing = 8, HorizontalAlignment = HorizontalAlignment.Right, Visibility = Visibility.Collapsed };
    private readonly Caption _chartModeLabel = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsButton _chartAuto = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small };
    private readonly TsButton _chartOverlay = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small };
    private readonly TsButton _chartGrid = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small };
    private readonly SignalChartPanel _chartPanel;
    private readonly PanelTitle _resultTitle = new() { Visibility = Visibility.Collapsed };
    private readonly TsGlassPanel _historicalEmptyPanel = new() { Padding = new Thickness(18) };
    private readonly TsEmptyState _historicalEmpty = new() { IconGlyph = DatabaseGlyph };

    private readonly Caption _footer = new() { HorizontalAlignment = HorizontalAlignment.Right };

    /// <summary>Creates the page over the default no-backend feed and the shell resource localizer.</summary>
    public SignalsWorkspacePage()
        : this(EmptySignalsWorkspaceFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The workspace data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="vehicleId">The selected vehicle id (web <c>useSelectedVehicle</c>); 0 = none.</param>
    public SignalsWorkspacePage(ISignalsWorkspaceFeed feed, ILocalizer localizer, long vehicleId = 0)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _viewModel = new SignalsWorkspacePageViewModel(feed, localizer, vehicleId);
        _selector = new SignalSelector(localizer);
        _compareControls = new SignalCompareControls(localizer);
        _statsPanel = new SignalStatsPanel(localizer);
        _chartPanel = new SignalChartPanel(localizer);

        BuildContent();

        _container = new SharedSurfaces.PageContainer(localizer, _viewModel.Title)
        {
            Subtitle = _viewModel.Subtitle,
            CopyLink = true,
            CopyLinkText = ShareLinkUri,
            Actions = BuildActions(),
            PageContent = _root,
        };

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        AutomationProperties.SetName(this, _viewModel.Title);
        Content = _container;

        _selector.SelectionChanged += OnSelectionChanged;
        _compareControls.SearchChanged += OnDiffSearchChanged;
        _runButton.Click += OnRunClick;
        _liveButton.Click += OnLiveClick;
        _compareButton.Click += OnCompareClick;
        _bulkPin.Click += OnBulkPinClick;
        _bulkUnpin.Click += OnBulkUnpinClick;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The navigation route name the shell page factory registers this surface under (<c>SignalsWorkspace</c>).</summary>
    public static string RouteName => SignalsWorkspaceRegistration.RouteName;

    /// <summary>The diagnostics surface slug (<c>SignalsWorkspacePage</c>).</summary>
    public static string Slug => SignalsWorkspaceRegistration.Slug;

    private StackPanel BuildActions()
    {
        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        actions.Children.Add(_liveBadge);
        return actions;
    }

    private void BuildContent()
    {
        _root.Children.Add(_errorBanner);
        _root.Children.Add(_noVehicle);
        _root.Children.Add(BuildHeadlineStats());
        _root.Children.Add(BuildAccordion());
        _root.Children.Add(BuildToolbar());
        BuildCompareSection();
        _root.Children.Add(_compareSection);
        BuildHistoricalSection();
        _root.Children.Add(_historicalSection);
        _root.Children.Add(BuildFooter());
    }

    private Grid BuildHeadlineStats()
    {
        var grid = new Grid { ColumnSpacing = 12, RowSpacing = 12 };
        for (int i = 0; i < 4; i++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        Place(grid, _statSelected, 0);
        Place(grid, _statMode, 1);
        Place(grid, _statLiveRate, 2);
        Place(grid, _statPinned, 3);
        return grid;
    }

    private TsAccordion BuildAccordion()
    {
        var header = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10, VerticalAlignment = VerticalAlignment.Center };
        header.Children.Add(new FontIcon { Glyph = "\uEC6C", FontSize = 14, VerticalAlignment = VerticalAlignment.Center });
        header.Children.Add(_accordionTitle);
        header.Children.Add(_accordionBadge);
        _accordion.Header = header;
        _accordion.Content = _selector;
        return _accordion;
    }

    private TsGlassPanel BuildToolbar()
    {
        var perPageColumn = new StackPanel { Spacing = 4 };
        perPageColumn.Children.Add(_perPageLabel);
        foreach (var n in new[] { "25", "50", "100", "500" })
        {
            _perPageSelect.Items.Add(new ComboBoxItem { Content = n });
        }

        _perPageSelect.SelectedIndex = 0;
        perPageColumn.Children.Add(_perPageSelect);

        var rangeColumn = new StackPanel { Spacing = 4 };
        rangeColumn.Children.Add(_timeRangeLabel);
        foreach (var preset in TimeRangePresets())
        {
            _timeRangeSelect.Items.Add(new ComboBoxItem { Content = preset });
        }

        _timeRangeSelect.SelectedIndex = 0;
        rangeColumn.Children.Add(_timeRangeSelect);

        var left = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12, VerticalAlignment = VerticalAlignment.Bottom };
        left.Children.Add(rangeColumn);

        var right = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Bottom };
        right.Children.Add(perPageColumn);
        right.Children.Add(_runButton);
        right.Children.Add(_liveButton);
        right.Children.Add(_compareButton);
        right.Children.Add(_help);

        var row = new Grid { ColumnSpacing = 12 };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(left, 0);
        Grid.SetColumn(right, 1);
        right.HorizontalAlignment = HorizontalAlignment.Right;
        row.Children.Add(left);
        row.Children.Add(right);

        _toolbar.Content = row;
        return _toolbar;
    }

    private void BuildCompareSection()
    {
        _compareSection.Children.Add(_compareControls);

        var stats = new Grid { ColumnSpacing = 12, RowSpacing = 12 };
        for (int i = 0; i < 4; i++)
        {
            stats.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        Place(stats, _statChanged, 0);
        Place(stats, _statVisible, 1);
        Place(stats, _statDiffPinned, 2);
        Place(stats, _statWindowSpan, 3);
        _compareSection.Children.Add(stats);

        var bulk = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        bulk.Children.Add(_bulkPin);
        bulk.Children.Add(_bulkUnpin);
        bulk.Children.Add(_bulkCsv);
        bulk.Children.Add(_bulkAlert);
        _compareSection.Children.Add(bulk);

        BuildDiffPanel();
        _compareSection.Children.Add(_diffPanel);
    }

    private void BuildDiffPanel()
    {
        for (int i = 0; i < 4; i++)
        {
            _diffLoadingHost.Children.Add(new TsSkeleton { BlockHeight = 32, Radius = 8 });
        }

        _diffEmptyHost.Children.Add(_diffEmptyIcon);
        _diffEmptyHost.Children.Add(_diffEmptyText);

        BuildDiffHeader();
        _diffRowsHost.Children.Add(_diffHeader);
        _diffRowsHost.Children.Add(_diffRowsBody);

        _diffBodyHost.Children.Add(_diffLoadingHost);
        _diffBodyHost.Children.Add(_diffEmptyHost);
        _diffBodyHost.Children.Add(_diffErrorText);
        _diffBodyHost.Children.Add(_diffRowsHost);

        _pinnedChipsHost.Children.Add(_pinnedChipsLabel);
        _pinnedChipsHost.Children.Add(_pinnedChipsItems);

        var body = new StackPanel { Spacing = 12 };
        body.Children.Add(_diffBodyHost);
        body.Children.Add(_pinnedChipsHost);
        _diffPanel.Content = body;
    }

    private void BuildDiffHeader()
    {
        AddDiffColumns(_diffHeader);
        _diffHeader.Padding = new Thickness(8, 6, 8, 6);
        _diffHeader.BorderThickness = new Thickness(0, 0, 0, 1);
        _diffHeader.BorderBrush = TokenBrush("TsColorBorderBrush");

        PlaceDiffCell(_diffHeader, new Label { Value = _localizer.GetString("signalDiff.signal", "Signal") }, 0);
        PlaceDiffCell(_diffHeader, new Label { Value = _localizer.GetString("signalDiff.valueA", "Window A") }, 1);
        PlaceDiffCell(_diffHeader, new Label { Value = _localizer.GetString("signalDiff.valueB", "Window B") }, 2);
        PlaceDiffCell(_diffHeader, new Label { Value = _localizer.GetString("signalDiff.delta", "\u0394") }, 3);
    }

    private void BuildHistoricalSection()
    {
        _historicalSection.Children.Add(_statsPanel);

        _chartModeRow.Children.Add(_chartModeLabel);
        _chartModeRow.Children.Add(_chartAuto);
        _chartModeRow.Children.Add(_chartOverlay);
        _chartModeRow.Children.Add(_chartGrid);
        _historicalSection.Children.Add(_chartModeRow);

        _historicalSection.Children.Add(_chartPanel);
        _historicalSection.Children.Add(_resultTitle);

        _historicalEmptyPanel.Content = _historicalEmpty;
        _historicalSection.Children.Add(_historicalEmptyPanel);
    }

    private Border BuildFooter()
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, HorizontalAlignment = HorizontalAlignment.Right };
        var icon = new FontIcon { Glyph = RefreshGlyph, FontSize = 12, VerticalAlignment = VerticalAlignment.Center };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        row.Children.Add(icon);
        row.Children.Add(_footer);
        return new Border { Child = row };
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

    private void OnSelectionChanged(object? sender, IReadOnlyList<string> selection) =>
        _viewModel.SetSelectedSignals(selection);

    private void OnDiffSearchChanged(object? sender, string search) => _viewModel.SetDiffSearch(search);

    private void OnRunClick(object sender, RoutedEventArgs e) => _viewModel.RunHistorical();

    private async void OnLiveClick(object sender, RoutedEventArgs e) =>
        await _viewModel.ToggleLiveAsync().ConfigureAwait(true);

    private async void OnCompareClick(object sender, RoutedEventArgs e) =>
        await _viewModel.ToggleCompareAsync().ConfigureAwait(true);

    private async void OnBulkPinClick(object sender, RoutedEventArgs e) => await BulkTogglePinAsync(true).ConfigureAwait(true);

    private async void OnBulkUnpinClick(object sender, RoutedEventArgs e) => await BulkTogglePinAsync(false).ConfigureAwait(true);

    private async System.Threading.Tasks.Task BulkTogglePinAsync(bool pin)
    {
        // web bulk pin / unpin: flip the pin for every diff row currently visible after the filter.
        foreach (var row in _viewModel.Display.DiffDisplay.Rows.ToArray())
        {
            await _viewModel.TogglePinAsync(row.Name, pin).ConfigureAwait(true);
        }
    }

    private void Render(SignalsWorkspaceDisplay display)
    {
        _container.Title = display.Title;
        _container.Subtitle = display.Subtitle;
        _container.CopyLinkText = ShareLinkUri;
        AutomationProperties.SetName(this, display.AutomationName);

        _errorBanner.Message = display.ErrorLoadFailed;
        _errorBanner.IsOpen = true;
        _errorBanner.Visibility = Show(display.ShowError);

        _noVehicle.Title = display.NoVehicleTitle;
        _noVehicle.Message = display.NoVehicleDesc;
        _noVehicle.Visibility = Show(display.ShowNoVehicle);

        _liveBadge.Content = display.LiveBadgeText;
        _liveBadge.Status = display.LiveBadgeConnected ? StatusKind.Success : StatusKind.Danger;
        _liveBadge.Visibility = Show(display.ShowLiveBadge);

        _statSelected.Label = display.SelectedLabel;
        _statSelected.Value = display.SelectedValue;
        _statMode.Label = display.ModeLabel;
        _statMode.Value = display.ModeValue;
        _statLiveRate.Label = display.LiveRateLabel;
        _statLiveRate.Value = display.LiveRateValue;
        _statPinned.Label = display.PinnedLabel;
        _statPinned.Value = display.PinnedValue;

        _accordionTitle.Value = display.AddSignalsLabel;
        _accordionBadge.Content = display.SignalsSelectedBadge;
        _accordionBadge.Status = display.HasSelection ? StatusKind.Info : StatusKind.Neutral;
        _selector.SetSignals(_viewModel.AvailableSignals);
        _selector.SetSelected(_viewModel.SelectedSignals);

        _timeRangeLabel.Value = display.TimeRangeLabel;
        _perPageLabel.Value = display.PerPageLabel;
        _runButton.Text = display.RunLabel;
        _runButton.IsEnabled = display.HasSelection && !display.IsCompare && !display.IsLive;
        _runButton.Visibility = Show(!display.IsLive && !display.IsCompare);
        _liveButton.Text = display.IsLive ? display.StopLiveLabel : display.LiveLabel;
        _liveButton.Variant = display.IsLive ? ButtonVariant.Destructive : ButtonVariant.Outline;
        _compareButton.Text = display.IsCompare ? display.ExitCompareLabel : display.CompareLabel;
        _compareButton.Variant = display.IsCompare ? ButtonVariant.Primary : ButtonVariant.Outline;
        _perPageSelect.Visibility = Show(!display.IsLive && !display.IsCompare);
        _help.Hint = display.HelpLiveAria;
        AutomationProperties.SetName(_help, display.HelpLiveAria);

        RenderCompare(display);
        RenderHistorical(display);

        _footer.Value = display.RefreshHint;
    }

    private void RenderCompare(SignalsWorkspaceDisplay display)
    {
        _compareSection.Visibility = Show(display.IsCompare);

        _statChanged.Label = display.ChangedSignalsLabel;
        _statChanged.Value = display.ChangedSignalsValue;
        _statVisible.Label = display.VisibleLabel;
        _statVisible.Value = display.VisibleValue;
        _statDiffPinned.Label = display.DiffPinnedLabel;
        _statDiffPinned.Value = display.DiffPinnedValue;
        _statWindowSpan.Label = display.WindowSpanLabel;
        _statWindowSpan.Value = display.WindowSpanValue;

        _bulkPin.Text = display.BulkPinLabel;
        _bulkUnpin.Text = display.BulkUnpinLabel;
        _bulkCsv.Text = display.BulkCsvLabel;
        _bulkAlert.Text = display.BulkAddAlertLabel;
        bool hasVisibleRows = display.DiffDisplay.Rows.Count > 0;
        _bulkPin.IsEnabled = hasVisibleRows;
        _bulkUnpin.IsEnabled = hasVisibleRows;

        _diffLoadingHost.Visibility = Show(display.ShowDiffLoading);
        _diffEmptyHost.Visibility = Show(display.ShowDiffEmpty);
        _diffErrorText.Visibility = Show(display.ShowDiffError);
        _diffRowsHost.Visibility = Show(display.ShowDiffRows);

        _diffEmptyText.Value = display.NoChangesMessage;
        AutomationProperties.SetName(_diffEmptyHost, display.NoChangesMessage);
        _diffErrorText.Value = display.ErrorLoadFailed;

        RenderDiffRows(display);
        RenderPinnedChips(display);
    }

    private void RenderDiffRows(SignalsWorkspaceDisplay display)
    {
        _diffRowsBody.Children.Clear();
        foreach (var row in display.DiffDisplay.Rows)
        {
            _diffRowsBody.Children.Add(BuildDiffRow(row));
        }
    }

    private static Border BuildDiffRow(SignalDiffDisplayRow row)
    {
        var grid = new Grid { Padding = new Thickness(8, 6, 8, 6) };
        AddDiffColumns(grid);

        var nameCell = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
        if (row.IsPinned)
        {
            var pin = new FontIcon { Glyph = PinGlyph, FontSize = 11, VerticalAlignment = VerticalAlignment.Center };
            AutomationProperties.SetAccessibilityView(pin, AccessibilityView.Raw);
            nameCell.Children.Add(pin);
        }

        nameCell.Children.Add(new Text { Value = row.Name, VerticalAlignment = VerticalAlignment.Center });
        PlaceDiffCell(grid, nameCell, 0);
        PlaceDiffCell(grid, new Text { Value = row.DisplayA, VerticalAlignment = VerticalAlignment.Center }, 1);
        PlaceDiffCell(grid, new Text { Value = row.DisplayB, VerticalAlignment = VerticalAlignment.Center }, 2);

        var delta = new Text { Value = row.DeltaText, VerticalAlignment = VerticalAlignment.Center };
        var brush = DeltaBrush(row.DeltaTone);
        if (brush is not null)
        {
            delta.Foreground = brush;
        }

        PlaceDiffCell(grid, delta, 3);

        var border = new Border { Child = grid, BorderThickness = new Thickness(0, 0, 0, 1) };
        border.BorderBrush = TokenBrush("TsColorBorderBrush");
        AutomationProperties.SetName(border, row.AutomationName);
        return border;
    }

    private void RenderPinnedChips(SignalsWorkspaceDisplay display)
    {
        _pinnedChipsLabel.Value = display.PinnedChipsLabel;
        _pinnedChipsItems.Children.Clear();
        foreach (var chip in display.PinnedChips)
        {
            _pinnedChipsItems.Children.Add(new TsBadge { Status = StatusKind.Neutral, Content = chip });
        }

        _pinnedChipsHost.Visibility = Show(display.IsCompare && display.PinnedChips.Count > 0);
    }

    private void RenderHistorical(SignalsWorkspaceDisplay display)
    {
        _historicalSection.Visibility = Show(!display.IsCompare);

        bool showResults = display.ShowLiveResults || display.ShowHistoryResults;
        _statsPanel.Visibility = Show(showResults);
        if (showResults)
        {
            _statsPanel.Model = new SignalStatsModel(Array.Empty<SignalStat>(), _viewModel.SelectedSignals);
        }

        _chartModeLabel.Value = display.ChartModeLabel;
        _chartAuto.Text = display.ChartAutoLabel;
        _chartOverlay.Text = display.ChartOverlayLabel;
        _chartGrid.Text = display.ChartGridLabel;
        _chartModeRow.Visibility = Show(showResults && display.ShowChartModeTabs);

        _chartPanel.Visibility = Show(showResults);
        if (showResults)
        {
            _chartPanel.Model = display.IsLive ? SignalChartPanelModel.LiveWaiting : SignalChartPanelModel.Empty;
        }

        _resultTitle.Value = display.IsLive ? display.LiveTailTitle : display.HistoryTitle;
        _resultTitle.Visibility = Show(showResults);

        _historicalEmpty.Title = display.EmptyTitle;
        _historicalEmpty.Message = display.EmptyDesc;
        _historicalEmptyPanel.Visibility = Show(display.ShowHistoricalEmpty);
    }

    private IReadOnlyList<string> TimeRangePresets() =>
    [
        _localizer.GetString("range.today", "Today"),
        _localizer.GetString("range.7d", "Last 7 days"),
        _localizer.GetString("range.30d", "Last 30 days"),
        _localizer.GetString("range.all", "All time"),
    ];

    private static Brush? DeltaBrush(SignalDiffDeltaTone tone) => tone switch
    {
        SignalDiffDeltaTone.Positive => TokenBrush(StatusResources.AccentBrushKey(StatusKind.Success)),
        SignalDiffDeltaTone.Negative => TokenBrush(StatusResources.AccentBrushKey(StatusKind.Danger)),
        SignalDiffDeltaTone.Changed => TokenBrush(StatusResources.AccentBrushKey(StatusKind.Warning)),
        _ => DisplayTokens.TextMuted,
    };

    /// <summary>Unsubscribe and dispose the view-model and the IDisposable child surfaces (idempotent; CA1001).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _selector.SelectionChanged -= OnSelectionChanged;
        _compareControls.SearchChanged -= OnDiffSearchChanged;
        _runButton.Click -= OnRunClick;
        _liveButton.Click -= OnLiveClick;
        _compareButton.Click -= OnCompareClick;
        _bulkPin.Click -= OnBulkPinClick;
        _bulkUnpin.Click -= OnBulkUnpinClick;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        _selector.Dispose();
        _viewModel.Dispose();
        _container.Dispose();
        GC.SuppressFinalize(this);
    }

    private static void AddDiffColumns(Grid grid)
    {
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1.6, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
    }

    private static void PlaceDiffCell(Grid grid, FrameworkElement element, int column)
    {
        element.Margin = new Thickness(8, 0, 8, 0);
        Grid.SetColumn(element, column);
        grid.Children.Add(element);
    }

    private static void Place(Grid grid, FrameworkElement element, int column)
    {
        Grid.SetColumn(element, column);
        grid.Children.Add(element);
    }

    private static Brush? TokenBrush(string resourceKey) =>
        Application.Current.Resources.TryGetValue(resourceKey, out var value) && value is Brush brush ? brush : null;

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new SignalsWorkspacePageAutomationPeer(this);

    private sealed class SignalsWorkspacePageAutomationPeer(SignalsWorkspacePage owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
