using System.Collections.Generic;
using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Live;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;
using TeslaSync.App.SharedSurfaces;

namespace TeslaSync.App.FeatureViews.Telemetry;

/// <summary>
/// The native WinUI 3 <c>LiveSignalMonitorPage</c> — a parity port of the web page
/// web/src/features/telemetry/pages/LiveSignalMonitorPage.tsx (route <c>/live-monitor</c>, nav name
/// <c>Live Monitor</c>). The web page is a thin wrapper that mounts the shared <c>LiveSignalTail</c> inside a
/// <c>PageContainer</c>, driven by the shared <c>useLiveSignalStream</c> SSE hook; this view reproduces the
/// whole tree natively: it mounts the shared <see cref="PageContainer"/> (title + subtitle, the live
/// connection <see cref="TsBadge"/> in the header Actions) whose body is the tail <see cref="TsGlassPanel"/>
/// — the filter field + the Pause/Resume, Auto-scroll and Clear controls, the four stat cards (Signals/sec,
/// Buffer Size, Unique Signals, Filtered) and the scrolling five-column table (Time / Signal / Value / Type /
/// Freshness) with its loading-shimmer, waiting-empty, filtered-empty and error/retry branches. The view is a
/// thin renderer: every label, value and data-state flows from the view-model's
/// <see cref="LiveSignalMonitorDisplay"/> projection; live SSE events arrive through the injected
/// <see cref="ILiveSignalMonitorFeed"/> and are marshalled onto the UI thread before reaching the view-model.
/// </summary>
public sealed partial class LiveSignalMonitorPage : UserControl, IDisposable
{
    private const double PanelPadding = 18;
    private const double SectionSpacing = 12;
    private const double FilterMaxWidth = 360;
    private const double TableMaxHeight = 520;
    private const double TimeColumnWidth = 96;
    private const double TypeColumnWidth = 108;
    private const double FreshnessColumnWidth = 140;
    private const int LoadingSkeletonRows = 6;

    private const string SearchGlyph = "\uE721";       // Segoe Fluent — Search
    private const string PauseGlyph = "\uE769";        // Pause
    private const string PlayGlyph = "\uE768";         // Play
    private const string AutoScrollGlyph = "\uE74B";   // Down
    private const string ClearGlyph = "\uE74D";        // Delete
    private const string RateGlyph = "\uE9D2";         // Activity
    private const string BufferGlyph = "\uE8CB";       // Sort
    private const string UniqueGlyph = "\uE9D2";       // Activity
    private const string FilteredGlyph = "\uE71C";     // Filter
    private const string WaitingGlyph = "\uE9D2";      // Activity

    private readonly ILocalizer _localizer;
    private readonly ILiveSignalMonitorFeed _feed;
    private readonly LiveSignalMonitorPageViewModel _viewModel;
    private readonly LiveSignalMonitorDiagnostics _diagnostics;
    private readonly PageContainer _container;
    private readonly DispatcherQueue? _dispatcher;
    private readonly DispatcherQueueTimer? _rateTimer;

    private readonly StackPanel _root = new() { Spacing = SectionSpacing };
    private readonly TsGlassPanel _panel = new() { Padding = new Thickness(PanelPadding) };

    private readonly TsBadge _connectionBadge = new() { Dot = true, VerticalAlignment = VerticalAlignment.Center };
    private readonly TsInput _filterBox = new() { HorizontalAlignment = HorizontalAlignment.Stretch };
    private readonly TsButton _pauseButton = new() { Variant = ButtonVariant.Secondary, Size = ControlSize.Small };
    private readonly TsButton _autoScrollButton = new() { Size = ControlSize.Small, IconGlyph = AutoScrollGlyph };
    private readonly TsButton _clearButton = new() { Variant = ButtonVariant.Destructive, Size = ControlSize.Small, IconGlyph = ClearGlyph };

    private readonly TsStatCard _rateCard = new() { Glyph = RateGlyph };
    private readonly TsStatCard _bufferCard = new() { Glyph = BufferGlyph };
    private readonly TsStatCard _uniqueCard = new() { Glyph = UniqueGlyph };
    private readonly TsStatCard _filteredCard = new() { Glyph = FilteredGlyph };

    private readonly Border _bodyHost = new();
    private readonly StackPanel _streamingHost = new() { Spacing = 0 };
    private readonly Grid _tableHeader = new() { ColumnSpacing = 12, Padding = new Thickness(8, 4, 8, 6) };
    private readonly StackPanel _tableBody = new() { Spacing = 0 };
    private readonly ScrollViewer _tableScroll;
    private readonly TsEmptyState _emptyState = new() { IconGlyph = WaitingGlyph, VerticalAlignment = VerticalAlignment.Center };
    private readonly TsQueryError _errorState = new() { VerticalAlignment = VerticalAlignment.Center };

    private bool _started;
    private bool _disposed;

    /// <summary>Creates the page over the default no-backend feed and the shell resource localizer.</summary>
    public LiveSignalMonitorPage()
        : this(EmptyLiveSignalMonitorFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit live feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The live-stream seam (web's single SSE subscription).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="vehicleId">The selected vehicle id (web <c>useSelectedVehicle</c>); 0 = none/all.</param>
    public LiveSignalMonitorPage(ILiveSignalMonitorFeed feed, ILocalizer localizer, long vehicleId = 0)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _diagnostics = new LiveSignalMonitorDiagnostics();
        _viewModel = new LiveSignalMonitorPageViewModel(localizer, vehicleId);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        _tableScroll = new ScrollViewer
        {
            Content = _tableBody,
            MaxHeight = TableMaxHeight,
            VerticalScrollMode = ScrollMode.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollMode = ScrollMode.Disabled,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };

        BuildContent();

        _container = new PageContainer(localizer, _viewModel.Title)
        {
            Subtitle = _viewModel.Subtitle,
            Actions = _connectionBadge,
            PageContent = _root,
        };

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        AutomationProperties.SetName(this, _viewModel.Title);
        Content = _container;

        if (_dispatcher is not null)
        {
            _rateTimer = _dispatcher.CreateTimer();
            _rateTimer.Interval = TimeSpan.FromSeconds(1);
            _rateTimer.Tick += OnRateTick;
        }

        _viewModel.PropertyChanged += OnViewModelChanged;
        _filterBox.TextChanged += OnFilterChanged;
        _pauseButton.Click += OnPauseClick;
        _autoScrollButton.Click += OnAutoScrollClick;
        _clearButton.Click += OnClearClick;
        _errorState.ActionInvoked += OnRetry;
        _feed.ConnectionChanged += OnFeedConnectionChanged;
        _feed.VehicleUpdated += OnFeedVehicleUpdated;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The navigation route name the shell page factory registers this surface under (<c>LiveSignalMonitor</c>).</summary>
    public static string RouteName => LiveSignalMonitorRegistration.RouteName;

    /// <summary>The diagnostics surface slug (<c>LiveSignalMonitorPage</c>).</summary>
    public static string Slug => LiveSignalMonitorRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public LiveSignalMonitorPageViewModel ViewModel => _viewModel;

    private void BuildContent()
    {
        var body = new StackPanel { Spacing = SectionSpacing };
        body.Children.Add(BuildHeader());
        body.Children.Add(BuildStatGrid());
        BuildTableHeader();
        _streamingHost.Children.Add(_tableHeader);
        _streamingHost.Children.Add(_tableScroll);
        body.Children.Add(_bodyHost);
        _panel.Content = body;
        _root.Children.Add(_panel);
    }

    private Grid BuildHeader()
    {
        AutomationProperties.SetName(_filterBox, _viewModel.Display.FilterAria);

        var searchIcon = new FontIcon
        {
            Glyph = SearchGlyph,
            FontSize = 14,
            Foreground = DisplayTokens.TextMuted,
            Margin = new Thickness(0, 0, 8, 0),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(searchIcon, AccessibilityView.Raw);

        var filterGrid = new Grid
        {
            MaxWidth = FilterMaxWidth,
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Center,
        };
        filterGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        filterGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetColumn(searchIcon, 0);
        Grid.SetColumn(_filterBox, 1);
        filterGrid.Children.Add(searchIcon);
        filterGrid.Children.Add(_filterBox);

        var controls = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
        };
        controls.Children.Add(_pauseButton);
        controls.Children.Add(_autoScrollButton);
        controls.Children.Add(_clearButton);

        var header = new Grid { ColumnSpacing = 12 };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(filterGrid, 0);
        Grid.SetColumn(controls, 1);
        header.Children.Add(filterGrid);
        header.Children.Add(controls);
        return header;
    }

    private Grid BuildStatGrid()
    {
        var grid = new Grid { ColumnSpacing = 12, RowSpacing = 12 };
        for (int i = 0; i < 4; i++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        Place(grid, _rateCard, 0);
        Place(grid, _bufferCard, 1);
        Place(grid, _uniqueCard, 2);
        Place(grid, _filteredCard, 3);
        return grid;
    }

    private void BuildTableHeader()
    {
        AddTableColumns(_tableHeader);
        _tableHeader.BorderBrush = DisplayTokens.Border;
        _tableHeader.BorderThickness = new Thickness(0, 0, 0, 1);
    }

    // ── Render ──────────────────────────────────────────────────────────────────────────────────────

    private void Render(LiveSignalMonitorDisplay display)
    {
        _container.Title = display.Title;
        _container.Subtitle = display.Subtitle;
        AutomationProperties.SetName(this, display.AutomationName);

        _connectionBadge.Content = display.ConnectionLabel;
        _connectionBadge.Status = display.Connected ? StatusKind.Success : StatusKind.Danger;

        _filterBox.Hint = display.FilterHint;
        AutomationProperties.SetName(_filterBox, display.FilterAria);

        _pauseButton.Text = display.PauseLabel;
        _pauseButton.IconGlyph = display.Paused ? PlayGlyph : PauseGlyph;
        _autoScrollButton.Text = display.AutoScrollLabel;
        _autoScrollButton.Variant = display.AutoScroll ? ButtonVariant.Secondary : ButtonVariant.Subtle;
        _clearButton.Text = display.ClearLabel;

        _rateCard.Label = display.RateLabel;
        _rateCard.Value = display.RateValue;
        _bufferCard.Label = display.BufferLabel;
        _bufferCard.Value = display.BufferValue;
        _bufferCard.Sublabel = display.BufferSublabel;
        _uniqueCard.Label = display.UniqueLabel;
        _uniqueCard.Value = display.UniqueValue;
        _filteredCard.Label = display.FilteredLabel;
        _filteredCard.Value = display.FilteredValue;

        RenderTableHeader(display);

        switch (display.BodyState)
        {
            case LiveSignalMonitorBodyState.Loading:
                _bodyHost.Child = BuildLoading(display.LoadingLabel);
                break;
            case LiveSignalMonitorBodyState.Error:
                _bodyHost.Child = RenderError(display);
                break;
            case LiveSignalMonitorBodyState.Empty:
                _bodyHost.Child = RenderEmpty(display);
                break;
            default:
                _bodyHost.Child = RenderStreaming(display);
                break;
        }
    }

    private void RenderTableHeader(LiveSignalMonitorDisplay display)
    {
        _tableHeader.Children.Clear();
        AddHeaderCell(display.TimeHeader, 0);
        AddHeaderCell(display.SignalHeader, 1);
        AddHeaderCell(display.ValueHeader, 2);
        AddHeaderCell(display.TypeHeader, 3);
        AddHeaderCell(display.FreshnessHeader, 4);
    }

    private void AddHeaderCell(string text, int column)
    {
        var cell = new TextBlock
        {
            Text = text,
            FontSize = 11,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextMuted,
            CharacterSpacing = 40,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(cell, column);
        _tableHeader.Children.Add(cell);
    }

    private StackPanel RenderStreaming(LiveSignalMonitorDisplay display)
    {
        _tableBody.Children.Clear();

        if (display.ShowNoMatch)
        {
            _tableBody.Children.Add(BuildMessageRow(display.NoMatchMessage));
            return _streamingHost;
        }

        foreach (var entry in display.Entries)
        {
            _tableBody.Children.Add(BuildRow(entry));
        }

        if (_viewModel.IsAutoScroll)
        {
            _tableScroll.ChangeView(null, 0, null, true);
        }

        return _streamingHost;
    }

    private TsEmptyState RenderEmpty(LiveSignalMonitorDisplay display)
    {
        _emptyState.Title = display.WaitingMessage;
        return _emptyState;
    }

    private TsQueryError RenderError(LiveSignalMonitorDisplay display)
    {
        _errorState.Title = display.ErrorTitle;
        _errorState.Message = display.ErrorTitle;
        _errorState.ActionText = display.RetryLabel;
        return _errorState;
    }

    private static Border BuildRow(LiveSignalMonitorDisplayEntry entry)
    {
        var time = new TextBlock
        {
            Text = entry.Timestamp.ToLocalTime().ToString("HH:mm:ss", CultureInfo.CurrentCulture),
            FontFamily = MonoFont,
            FontSize = 12,
            Foreground = DisplayTokens.TextMuted,
            TextWrapping = TextWrapping.NoWrap,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var name = new TextBlock
        {
            Text = entry.Name,
            FontFamily = MonoFont,
            FontSize = 12,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var value = new TextBlock
        {
            Text = entry.Value,
            FontFamily = MonoFont,
            FontSize = 12,
            Foreground = AccentBrush(entry.Type),
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var typeBadge = new TsBadge
        {
            Status = StatusFor(entry.Type),
            Content = entry.TypeLabel,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Left,
        };

        var freshness = new TsFreshnessIndicator
        {
            Timestamp = entry.Timestamp,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Left,
        };

        var grid = new Grid { ColumnSpacing = 12, Padding = new Thickness(8, 6, 8, 6), MinHeight = 36 };
        AddTableColumns(grid);
        var cells = new UIElement[] { time, name, value, typeBadge, freshness };
        for (int i = 0; i < cells.Length; i++)
        {
            Grid.SetColumn((FrameworkElement)cells[i], i);
            grid.Children.Add(cells[i]);
        }

        var border = new Border
        {
            Child = grid,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(0, 0, 0, 1),
        };
        AutomationProperties.SetName(border, entry.AutomationName);
        return border;
    }

    private static TextBlock BuildMessageRow(string message)
    {
        var block = new TextBlock
        {
            Text = message,
            FontSize = 13,
            Foreground = DisplayTokens.TextMuted,
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
            Margin = new Thickness(12, 24, 12, 24),
        };
        LiveRegion.Configure(block);
        LiveRegion.Announce(block);
        return block;
    }

    private static StackPanel BuildLoading(string announce)
    {
        var column = new StackPanel { Spacing = 8, Padding = new Thickness(0, 4, 0, 4) };
        for (int i = 0; i < LoadingSkeletonRows; i++)
        {
            column.Children.Add(new TsSkeleton { BlockHeight = 18 });
        }

        AutomationProperties.SetName(column, announce);
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    // ── Lifecycle ───────────────────────────────────────────────────────────────────────────────────

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _diagnostics.RecordViewOpened();
        _viewModel.SetConnected(_feed.Connected);
        _rateTimer?.Start();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnRateTick(DispatcherQueueTimer sender, object args) => _viewModel.AdvanceRateWindow();

    private void OnViewModelChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(LiveSignalMonitorPageViewModel.Display))
        {
            Render(_viewModel.Display);
        }
    }

    private void OnFilterChanged(object sender, TextChangedEventArgs e)
    {
        if (!_disposed)
        {
            _viewModel.SetFilter(_filterBox.Text ?? string.Empty);
        }
    }

    private void OnPauseClick(object sender, RoutedEventArgs e) => _viewModel.TogglePaused();

    private void OnAutoScrollClick(object sender, RoutedEventArgs e) => _viewModel.ToggleAutoScroll();

    private void OnClearClick(object sender, RoutedEventArgs e) => _viewModel.Clear();

    private void OnRetry(object? sender, EventArgs e) => _viewModel.SetErrored(false);

    private void OnFeedConnectionChanged(bool connected) => RunOnUi(() => _viewModel.SetConnected(connected));

    private void OnFeedVehicleUpdated(VehicleUpdateSnapshot snapshot) => RunOnUi(() => _viewModel.ApplyVehicleUpdate(snapshot));

    private void RunOnUi(Action action)
    {
        if (_dispatcher is null || _dispatcher.HasThreadAccess)
        {
            action();
            return;
        }

        _dispatcher.TryEnqueue(() => action());
    }

    /// <summary>Detach from the view-model, feed and timer; dispose the child surfaces (idempotent; CA1001).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _rateTimer?.Stop();
        if (_rateTimer is not null)
        {
            _rateTimer.Tick -= OnRateTick;
        }

        _viewModel.PropertyChanged -= OnViewModelChanged;
        _filterBox.TextChanged -= OnFilterChanged;
        _pauseButton.Click -= OnPauseClick;
        _autoScrollButton.Click -= OnAutoScrollClick;
        _clearButton.Click -= OnClearClick;
        _errorState.ActionInvoked -= OnRetry;
        _feed.ConnectionChanged -= OnFeedConnectionChanged;
        _feed.VehicleUpdated -= OnFeedVehicleUpdated;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;

        if (_feed is IDisposable disposableFeed)
        {
            disposableFeed.Dispose();
        }

        _container.Dispose();
        GC.SuppressFinalize(this);
    }

    // ── Table primitives ────────────────────────────────────────────────────────────────────────────

    private static FontFamily MonoFont => new("Consolas");

    private static void AddTableColumns(Grid grid)
    {
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(TimeColumnWidth) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1.4, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(TypeColumnWidth) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(FreshnessColumnWidth) });
    }

    private static void Place(Grid grid, FrameworkElement element, int column)
    {
        Grid.SetColumn(element, column);
        grid.Children.Add(element);
    }

    /// <summary>The semantic status for a value type — web <c>Badge</c> variant: number→info, boolean→warning, else success.</summary>
    private static StatusKind StatusFor(SignalEntryType type) => type switch
    {
        SignalEntryType.Number => StatusKind.Info,
        SignalEntryType.Boolean => StatusKind.Warning,
        _ => StatusKind.Success,
    };

    private static Brush AccentBrush(SignalEntryType type) =>
        DisplayTokens.Brush(StatusResources.AccentBrushKey(StatusFor(type)));

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new LiveSignalMonitorPageAutomationPeer(this);

    private sealed class LiveSignalMonitorPageAutomationPeer(LiveSignalMonitorPage owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
