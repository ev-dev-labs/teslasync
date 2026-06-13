using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Commands;

/// <summary>
/// The native WinUI 3 <c>CommandsPage</c> — a parity port of the web page
/// <c>web/src/features/system/pages/CommandsPage.tsx</c> (route <c>/commands</c>, nav name <c>Commands</c>). It
/// binds to a <see cref="CommandsPageViewModel"/> and renders every web region with Fluent components and
/// design tokens: the page header (title + subtitle) whose actions carry the in-app "View History" link and
/// the "online/total online" tally; the four stat tiles (Vehicles / Online / Asleep / Refresh) or — with no
/// roster — the "no data" <see cref="TsEmptyState"/>; the non-fatal states-error <see cref="TsGlassPanel"/>
/// banner (the web <c>statesError</c> GlassPanel); and the main region that switches between the loading
/// shimmer, the per-vehicle command-centre headers (one <see cref="TsGlassPanel"/> per vehicle — identity,
/// state badge, freshness pill and the live battery / range / temperature readouts), and the "no vehicles"
/// <see cref="TsEmptyState"/>. The view is a thin renderer: all branch selection, SI conversion, formatting
/// and i18n happen in the view-model's <see cref="CommandsDisplay"/> projection. A <see cref="DispatcherTimer"/>
/// re-runs the load every 15 seconds (web <c>refetchInterval: 15_000</c>); state changes are marshalled onto
/// the UI thread.
/// </summary>
public sealed partial class CommandsPage : UserControl, IDisposable
{
    private const string AlertGlyph = "\uE7BA";       // warning triangle
    private const string CarGlyph = "\uE804";         // vehicle
    private const string ActivityGlyph = "\uE9D9";    // pulse / activity
    private const string BatteryGlyph = "\uE83F";     // battery
    private const string RangeGlyph = "\uE701";       // signal / range
    private const string TempGlyph = "\uE9CA";        // thermometer

    private readonly CommandsPageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private readonly DispatcherTimer _refreshTimer;
    private bool _disposed;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();
    private readonly HyperlinkButton _viewHistory = new();
    private TextBlock? _historyLabel;

    private readonly StackPanel _onlineSummary = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 0,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly Text _onlineCountText = new();
    private readonly Caption _onlineRestText = new();

    private readonly ContentControl _statsHost = new()
    {
        HorizontalContentAlignment = HorizontalAlignment.Stretch,
    };

    private readonly Grid _metricGrid = new() { ColumnSpacing = 12 };
    private readonly TsMetricCard _vehiclesCard = new();
    private readonly TsMetricCard _onlineCard = new();
    private readonly TsMetricCard _asleepCard = new();
    private readonly TsMetricCard _refreshCard = new();
    private readonly TsEmptyState _statsEmpty = new() { IconGlyph = ActivityGlyph };

    private readonly TsGlassPanel _statesErrorPanel = new()
    {
        Padding = new Thickness(12),
        Visibility = Visibility.Collapsed,
    };

    private readonly Text _statesErrorText = new();

    private readonly ContentControl _mainHost = new()
    {
        HorizontalContentAlignment = HorizontalAlignment.Stretch,
    };

    private readonly StackPanel _loadingSkeleton = new() { Spacing = 24 };
    private readonly StackPanel _centersStack = new() { Spacing = 24 };
    private readonly TsEmptyState _vehiclesEmpty = new() { IconGlyph = CarGlyph };

    /// <summary>Creates the page over the default empty source and the shell resource localizer.</summary>
    public CommandsPage()
        : this(EmptyCommandsSource.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit source and localizer (used by tests / dependency injection).</summary>
    /// <param name="source">The commands data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public CommandsPage(ICommandsSource source, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new CommandsPageViewModel(source, localizer);
        _refreshTimer = new DispatcherTimer
        {
            Interval = TimeSpan.FromMilliseconds(CommandsRegistration.RefreshIntervalMs),
        };
        _refreshTimer.Tick += OnRefreshTick;

        BuildOnlineSummary();
        BuildMetricGrid();
        BuildStatesErrorPanel();
        BuildLoadingSkeleton();

        Content = BuildLayout();

        _statsEmpty.ActionInvoked += OnRetryInvoked;
        _viewHistory.Click += OnViewHistoryClick;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>Raised when the header "View History" link is invoked (the host navigates to the history page).</summary>
    public event EventHandler? ViewHistoryRequested;

    /// <summary>The diagnostics surface slug (<c>CommandsPage</c>).</summary>
    public static string Slug => CommandsRegistration.Slug;

    private ScrollViewer BuildLayout()
    {
        var stack = new StackPanel { Spacing = 16, Padding = new Thickness(24) };
        stack.Children.Add(BuildHeader());
        stack.Children.Add(new TsFadeIn { Content = _statsHost });
        stack.Children.Add(_statesErrorPanel);
        stack.Children.Add(_mainHost);

        return new ScrollViewer
        {
            Content = stack,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
        };
    }

    private Grid BuildHeader()
    {
        var header = new Grid { ColumnSpacing = 16 };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var titleColumn = new StackPanel { Spacing = 4, VerticalAlignment = VerticalAlignment.Center };
        titleColumn.Children.Add(_title);
        titleColumn.Children.Add(_subtitle);
        Grid.SetColumn(titleColumn, 0);
        header.Children.Add(titleColumn);

        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 12,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Right,
        };

        var historyContent = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
        historyContent.Children.Add(Decorative(new FontIcon { Glyph = "\uE81C", FontSize = 14 }));
        var historyLabel = new TextBlock { VerticalAlignment = VerticalAlignment.Center };
        historyContent.Children.Add(historyLabel);
        _viewHistory.Content = historyContent;
        _historyLabel = historyLabel;
        actions.Children.Add(_viewHistory);
        actions.Children.Add(_onlineSummary);

        Grid.SetColumn(actions, 1);
        header.Children.Add(actions);
        return header;
    }

    private void BuildOnlineSummary()
    {
        _onlineCountText.Foreground = TypographyTokens.Brush("TsColorSuccessBrush");
        _onlineSummary.Children.Add(_onlineCountText);
        _onlineSummary.Children.Add(_onlineRestText);
    }

    private void BuildMetricGrid()
    {
        for (var i = 0; i < 4; i++)
        {
            _metricGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        Place(_metricGrid, _vehiclesCard, 0);
        Place(_metricGrid, _onlineCard, 1);
        Place(_metricGrid, _asleepCard, 2);
        Place(_metricGrid, _refreshCard, 3);
    }

    private void BuildStatesErrorPanel()
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        row.Children.Add(Decorative(new FontIcon
        {
            Glyph = AlertGlyph,
            FontSize = 16,
            Foreground = TypographyTokens.Brush("TsColorDangerBrush"),
            VerticalAlignment = VerticalAlignment.Center,
        }));
        _statesErrorText.Foreground = TypographyTokens.Brush("TsColorDangerBrush");
        _statesErrorText.VerticalAlignment = VerticalAlignment.Center;
        row.Children.Add(_statesErrorText);
        _statesErrorPanel.Glow = GlassGlow.None;
        _statesErrorPanel.Content = row;
    }

    private void BuildLoadingSkeleton()
    {
        for (var i = 0; i < 2; i++)
        {
            _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 220, Radius = 16 });
        }
    }

    private static void Place(Grid grid, FrameworkElement element, int column)
    {
        element.HorizontalAlignment = HorizontalAlignment.Stretch;
        Grid.SetColumn(element, column);
        grid.Children.Add(element);
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        _viewModel.NotifyOpened();
        _refreshTimer.Start();
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
        _refreshTimer.Stop();
        _refreshTimer.Tick -= OnRefreshTick;
        _statsEmpty.ActionInvoked -= OnRetryInvoked;
        _viewHistory.Click -= OnViewHistoryClick;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnRefreshTick(object? sender, object e)
    {
        if (!_disposed)
        {
            _ = _viewModel.RefreshAsync();
        }
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

    private void Render(CommandsDisplay display)
    {
        _title.Value = display.Title;
        _subtitle.Value = display.Subtitle;
        AutomationProperties.SetName(this, display.AutomationName);

        if (_historyLabel is not null)
        {
            _historyLabel.Text = display.ViewHistoryText;
        }

        AutomationProperties.SetName(_viewHistory, display.ViewHistoryText);

        _onlineSummary.Visibility = Show(display.HasVehicles);
        _onlineCountText.Value = display.OnlineCountText;
        _onlineRestText.Value = $"/{display.TotalCountText} {display.OnlineWord}";
        AutomationProperties.SetName(_onlineSummary, display.OnlineSummaryAutomationName);

        RenderStats(display);
        RenderStatesError(display);
        RenderMain(display);
    }

    private void RenderStats(CommandsDisplay display)
    {
        if (display.ShowStats)
        {
            RenderMetric(_vehiclesCard, display, "vehicles");
            RenderMetric(_onlineCard, display, "online");
            RenderMetric(_asleepCard, display, "asleep");
            RenderMetric(_refreshCard, display, "refresh");
            _statsHost.Content = _metricGrid;
        }
        else
        {
            _statsEmpty.Message = display.NoDataMessage;
            AutomationProperties.SetName(_statsEmpty, display.NoDataMessage);
            _statsHost.Content = _statsEmpty;
        }
    }

    private void RenderStatesError(CommandsDisplay display)
    {
        _statesErrorPanel.Visibility = Show(display.HasStatesError);
        _statesErrorText.Value = display.StatesErrorText;
        AutomationProperties.SetName(_statesErrorPanel, display.StatesErrorText);
    }

    private void RenderMain(CommandsDisplay display)
    {
        if (display.ShowLoading)
        {
            _mainHost.Content = _loadingSkeleton;
            return;
        }

        if (display.ShowContent)
        {
            RenderCenters(display.Centers);
            _mainHost.Content = _centersStack;
            return;
        }

        _vehiclesEmpty.Title = display.NoVehiclesTitle;
        _vehiclesEmpty.Message = display.ConnectFleetMessage;
        AutomationProperties.SetName(_vehiclesEmpty, display.NoVehiclesTitle);
        _mainHost.Content = _vehiclesEmpty;
    }

    private void RenderCenters(IReadOnlyList<CommandsVehicleCenter> centers)
    {
        _centersStack.Children.Clear();
        int index = 0;
        foreach (var center in centers)
        {
            _centersStack.Children.Add(new TsFadeIn { DelayMs = index * 40, Content = BuildCenterPanel(center) });
            index++;
        }
    }

    private static TsGlassPanel BuildCenterPanel(CommandsVehicleCenter center)
    {
        var body = new StackPanel { Spacing = 12 };

        var headerRow = new Grid { ColumnSpacing = 16 };
        headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var identity = new StackPanel { Spacing = 4, VerticalAlignment = VerticalAlignment.Center };

        var nameRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 12,
            VerticalAlignment = VerticalAlignment.Center,
        };
        nameRow.Children.Add(new PanelTitle { Value = center.Name, VerticalAlignment = VerticalAlignment.Center });
        nameRow.Children.Add(new TsBadge
        {
            Status = center.IsAsleep ? StatusKind.Neutral : StatusKind.Success,
            Content = center.StateLabel,
            VerticalAlignment = VerticalAlignment.Center,
        });
        nameRow.Children.Add(new TsFreshnessIndicator
        {
            Timestamp = center.UpdatedAt,
            VerticalAlignment = VerticalAlignment.Center,
        });
        identity.Children.Add(nameRow);
        identity.Children.Add(new Caption { Value = center.ModelVin });
        Grid.SetColumn(identity, 0);
        headerRow.Children.Add(identity);

        if (center.HasLiveState)
        {
            var readouts = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Spacing = 16,
                VerticalAlignment = VerticalAlignment.Center,
            };
            readouts.Children.Add(Readout(
                BatteryGlyph,
                center.BatteryText,
                center.BatteryHigh ? "TsColorSuccessBrush" : "TsColorWarningBrush"));
            readouts.Children.Add(Readout(RangeGlyph, center.RangeText, "TsColorTextSecondaryBrush"));
            if (center.HasTemp)
            {
                readouts.Children.Add(Readout(TempGlyph, center.TempText, "TsColorTextSecondaryBrush"));
            }

            Grid.SetColumn(readouts, 1);
            headerRow.Children.Add(readouts);
        }

        body.Children.Add(headerRow);

        var panel = new TsGlassPanel { Padding = new Thickness(24), Content = body };
        AutomationProperties.SetName(panel, center.AutomationName);
        return panel;
    }

    private static StackPanel Readout(string glyph, string value, string brushKey)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 6,
            VerticalAlignment = VerticalAlignment.Center,
        };
        row.Children.Add(Decorative(new FontIcon
        {
            Glyph = glyph,
            FontSize = 14,
            Foreground = TypographyTokens.Brush("TsColorTextMutedBrush"),
            VerticalAlignment = VerticalAlignment.Center,
        }));
        row.Children.Add(new Text
        {
            Value = value,
            Foreground = TypographyTokens.Brush(brushKey),
            VerticalAlignment = VerticalAlignment.Center,
        });
        AutomationProperties.SetName(row, value);
        return row;
    }

    private static void RenderMetric(TsMetricCard card, CommandsDisplay display, string key)
    {
        var metric = FindMetric(display, key);
        card.Label = metric.Label;
        card.Value = metric.Value;
        card.AccentBrushKey = metric.AccentBrushKey;
        AutomationProperties.SetName(card, metric.AutomationName);
    }

    private static CommandsMetric FindMetric(CommandsDisplay display, string key)
    {
        foreach (var metric in display.Metrics)
        {
            if (string.Equals(metric.Key, key, StringComparison.Ordinal))
            {
                return metric;
            }
        }

        return new CommandsMetric(key, string.Empty, string.Empty, "TsColorAccentBrush", string.Empty);
    }

    private void OnRetryInvoked(object? sender, EventArgs e) => InvokeAsync(() => _viewModel.RefreshAsync());

    private void OnViewHistoryClick(object sender, RoutedEventArgs e) =>
        ViewHistoryRequested?.Invoke(this, EventArgs.Empty);

    private static T Decorative<T>(T element)
        where T : UIElement
    {
        AutomationProperties.SetAccessibilityView(element, AccessibilityView.Raw);
        return element;
    }

    private static async void InvokeAsync(Func<Task> action)
    {
        await action().ConfigureAwait(true);
    }

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new CommandsPageAutomationPeer(this);

    private sealed class CommandsPageAutomationPeer(CommandsPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
