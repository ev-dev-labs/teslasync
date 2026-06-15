using System.Collections.Generic;
using System.Linq;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Documents;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;
using Windows.Storage;
using Windows.Storage.Pickers;
using Windows.System;
using WinRT.Interop;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// The native WinUI 3 <c>LiveLogsPage</c> — a parity port of the web page
/// <c>web/src/features/admin/pages/LiveLogsPage.tsx</c> (manifest web route <c>(unrouted)</c>). It binds to a
/// <see cref="LiveLogsPageViewModel"/> and renders every web region with Fluent components and design tokens:
/// the page header, the four <see cref="TsGlassPanel"/>s the web composes — the filters panel (minimum-level
/// <see cref="TsSelect"/> + grep / vehicle <see cref="TsInput"/>s), the controls panel (the connection
/// <see cref="TsBadge"/>, the buffered / received / drops captions and the Auto-scroll <see cref="TsToggle"/> +
/// Pause/Resume, Clear, Download and Reconnect <see cref="TsButton"/>s), the connection-error panel (web
/// <c>stream.error</c>) and the log-table panel whose body switches between the scrolling four-column table
/// (Time / Level / Message / Fields) and the "No log events yet" <see cref="TsEmptyState"/>. The view is a thin
/// renderer: every label, value and data-state flows from the view-model's <see cref="LiveLogsDisplay"/>
/// projection; live SSE events arrive through the injected <see cref="ILiveLogFeed"/> and are marshalled onto
/// the UI thread before reaching the view-model.
/// </summary>
public sealed partial class LiveLogsPage : UserControl, System.IDisposable
{
    private const double TimeColumnWidth = 112;
    private const double LevelColumnWidth = 88;
    private const double FieldsColumnWidth = 320;
    private const double TableMaxHeight = 520;
    private const double PanelPadding = 16;

    private const string PauseGlyph = "\uE769";    // Segoe Fluent — Pause
    private const string PlayGlyph = "\uE768";     // Play
    private const string AutoScrollGlyph = "\uE74B"; // Down
    private const string ClearGlyph = "\uE74D";    // Delete
    private const string DownloadGlyph = "\uEDE1"; // SaveLocal
    private const string ReconnectGlyph = "\uE72C"; // Refresh
    private const string WarningGlyph = "\uE7BA";  // Warning
    private const string EmptyGlyph = "\uE9D9";    // Stream / list

    private readonly ILiveLogFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly LiveLogsPageViewModel _viewModel;
    private readonly Microsoft.UI.Dispatching.DispatcherQueue? _dispatcher;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();

    // Filters panel (GlassPanel1).
    private readonly TsGlassPanel _filtersPanel = new() { Padding = new Thickness(PanelPadding) };
    private readonly Caption _levelLabel = new();
    private readonly TsSelect _levelSelect = new() { HorizontalAlignment = HorizontalAlignment.Stretch };
    private readonly Caption _grepLabel = new();
    private readonly TsInput _grepInput = new() { HorizontalAlignment = HorizontalAlignment.Stretch, MaxLength = 256 };
    private readonly HelperText _grepHelp = new();
    private readonly Caption _vehicleLabel = new();
    private readonly TsInput _vehicleInput = new() { HorizontalAlignment = HorizontalAlignment.Stretch };

    // Controls panel (GlassPanel2).
    private readonly TsGlassPanel _controlsPanel = new() { Padding = new Thickness(PanelPadding) };
    private readonly TsBadge _connectionBadge = new() { Dot = true, VerticalAlignment = VerticalAlignment.Center };
    private readonly Caption _bufferedCaption = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly Caption _receivedCaption = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly Caption _dropsCaption = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsToggle _autoscrollToggle = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsButton _pauseButton = new() { Variant = ButtonVariant.Secondary, Size = ControlSize.Small };
    private readonly TsButton _clearButton = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small, IconGlyph = ClearGlyph };
    private readonly TsButton _downloadButton = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small, IconGlyph = DownloadGlyph };
    private readonly TsButton _reconnectButton = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small, IconGlyph = ReconnectGlyph };

    // Error panel (GlassPanel3).
    private readonly TsGlassPanel _errorPanel = new() { Padding = new Thickness(PanelPadding), Visibility = Visibility.Collapsed };
    private readonly MetricLabel _errorTitle = new();
    private readonly Text _errorMessage = new();

    // Table panel (GlassPanel4).
    private readonly TsGlassPanel _tablePanel = new() { Padding = new Thickness(8) };
    private readonly Grid _tableHeader;
    private readonly TextBlock _hdrTime = NewHeaderCell();
    private readonly TextBlock _hdrLevel = NewHeaderCell();
    private readonly TextBlock _hdrMessage = NewHeaderCell();
    private readonly TextBlock _hdrFields = NewHeaderCell();
    private readonly StackPanel _rowsPanel = new() { Spacing = 0 };
    private readonly ScrollViewer _tableScroll;
    private readonly StackPanel _tableContainer = new() { Spacing = 0 };
    private readonly TsEmptyState _emptyState = new() { IconGlyph = EmptyGlyph, VerticalAlignment = VerticalAlignment.Center };
    private readonly ContentControl _tableHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };

    private readonly Caption _footerCaption = new();

    private string _levelOptionsSignature = string.Empty;
    private bool _suppressEvents;
    private bool _started;
    private bool _disposed;

    /// <summary>Creates the page over the default no-backend feed and the shell resource localizer.</summary>
    public LiveLogsPage()
        : this(EmptyLiveLogFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit live feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The live-stream seam (web's single SSE subscription).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public LiveLogsPage(ILiveLogFeed feed, ILocalizer localizer)
    {
        System.ArgumentNullException.ThrowIfNull(feed);
        System.ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _viewModel = new LiveLogsPageViewModel(localizer);
        _dispatcher = Microsoft.UI.Dispatching.DispatcherQueue.GetForCurrentThread();

        _levelSelect.DisplayMemberPath = nameof(LiveLogsLevelOption.Label);
        _levelSelect.SelectedValuePath = nameof(LiveLogsLevelOption.Value);

        _tableHeader = BuildColumnGrid();
        _tableHeader.Padding = new Thickness(8, 0, 8, 8);
        _tableHeader.BorderThickness = new Thickness(0, 0, 0, 1);
        _tableHeader.BorderBrush = Brush("TsColorBorderBrush");
        AddCell(_tableHeader, 0, _hdrTime);
        AddCell(_tableHeader, 1, _hdrLevel);
        AddCell(_tableHeader, 2, _hdrMessage);
        AddCell(_tableHeader, 3, _hdrFields);

        _tableScroll = new ScrollViewer
        {
            Content = _rowsPanel,
            MaxHeight = TableMaxHeight,
            VerticalScrollMode = ScrollMode.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollMode = ScrollMode.Disabled,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
        _tableContainer.Children.Add(_tableHeader);
        _tableContainer.Children.Add(_tableScroll);

        Content = BuildLayout();

        WireEvents();
        SeedLevelOptions(_viewModel.Display.LevelOptions);
        Render(_viewModel.Display);
    }

    /// <summary>The diagnostics surface slug (<c>LiveLogsPage</c>).</summary>
    public static string Slug => LiveLogsRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public LiveLogsPageViewModel ViewModel => _viewModel;

    private void WireEvents()
    {
        _levelSelect.SelectionChanged += OnLevelChanged;
        _grepInput.TextChanged += OnGrepChanged;
        _grepInput.KeyDown += OnGrepKeyDown;
        _grepInput.LostFocus += OnGrepCommitted;
        _vehicleInput.TextChanged += OnVehicleChanged;
        _autoscrollToggle.Toggled += OnAutoscrollToggled;
        _pauseButton.Click += OnPauseClick;
        _clearButton.Click += OnClearClick;
        _downloadButton.Click += OnDownloadClick;
        _reconnectButton.Click += OnReconnectClick;
        _emptyState.ActionInvoked += OnReconnectInvoked;

        _viewModel.PropertyChanged += OnViewModelChanged;
        _viewModel.StreamRequestChanged += OnStreamRequestChanged;
        _feed.ConnectionChanged += OnFeedConnectionChanged;
        _feed.LogReceived += OnFeedLogReceived;
        _feed.DropsReceived += OnFeedDrops;
        _feed.ErrorChanged += OnFeedError;

        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
    }

    private ScrollViewer BuildLayout()
    {
        var stack = new StackPanel { Spacing = 16, Padding = new Thickness(24) };

        var header = new StackPanel { Spacing = 4 };
        header.Children.Add(_title);
        header.Children.Add(_subtitle);
        stack.Children.Add(header);

        stack.Children.Add(BuildFiltersPanel());
        stack.Children.Add(BuildControlsPanel());
        stack.Children.Add(BuildErrorPanel());
        stack.Children.Add(BuildTablePanel());
        stack.Children.Add(_footerCaption);

        return new ScrollViewer
        {
            Content = stack,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
    }

    private TsGlassPanel BuildFiltersPanel()
    {
        // web grid-cols-1 md:grid-cols-4 — level (1) / grep (2) / vehicle (1).
        var grid = new Grid { ColumnSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(2, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var levelCol = new StackPanel { Spacing = 6 };
        levelCol.Children.Add(_levelLabel);
        levelCol.Children.Add(_levelSelect);
        Grid.SetColumn(levelCol, 0);
        grid.Children.Add(levelCol);

        var grepCol = new StackPanel { Spacing = 6 };
        grepCol.Children.Add(_grepLabel);
        grepCol.Children.Add(_grepInput);
        grepCol.Children.Add(_grepHelp);
        Grid.SetColumn(grepCol, 1);
        grid.Children.Add(grepCol);

        var vehicleCol = new StackPanel { Spacing = 6 };
        vehicleCol.Children.Add(_vehicleLabel);
        vehicleCol.Children.Add(_vehicleInput);
        Grid.SetColumn(vehicleCol, 2);
        grid.Children.Add(vehicleCol);

        _filtersPanel.Content = grid;
        return _filtersPanel;
    }

    private TsGlassPanel BuildControlsPanel()
    {
        var grid = new Grid { ColumnSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var stats = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 12,
            VerticalAlignment = VerticalAlignment.Center,
        };
        stats.Children.Add(_connectionBadge);
        stats.Children.Add(_bufferedCaption);
        stats.Children.Add(_receivedCaption);
        stats.Children.Add(_dropsCaption);
        Grid.SetColumn(stats, 0);
        grid.Children.Add(stats);

        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        actions.Children.Add(_autoscrollToggle);
        actions.Children.Add(_pauseButton);
        actions.Children.Add(_clearButton);
        actions.Children.Add(_downloadButton);
        actions.Children.Add(_reconnectButton);
        Grid.SetColumn(actions, 1);
        grid.Children.Add(actions);

        _controlsPanel.Content = grid;
        return _controlsPanel;
    }

    private TsGlassPanel BuildErrorPanel()
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
        row.Children.Add(new FontIcon
        {
            Glyph = WarningGlyph,
            FontSize = 20,
            Foreground = Brush("TsColorDangerBrush"),
            VerticalAlignment = VerticalAlignment.Top,
        });

        var body = new StackPanel { Spacing = 4 };
        body.Children.Add(_errorTitle);
        body.Children.Add(_errorMessage);
        row.Children.Add(body);

        _errorPanel.Content = row;
        _errorPanel.BorderBrush = Brush("TsColorDangerBrush");
        return _errorPanel;
    }

    private TsGlassPanel BuildTablePanel()
    {
        _tableHost.Content = _tableContainer;
        _tablePanel.Content = _tableHost;
        return _tablePanel;
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _viewModel.NotifyOpened();
        StartStream();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Unsubscribe from the feed / view-model and stop the stream (idempotent; mirrors the sibling pages).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;

        _levelSelect.SelectionChanged -= OnLevelChanged;
        _grepInput.TextChanged -= OnGrepChanged;
        _grepInput.KeyDown -= OnGrepKeyDown;
        _grepInput.LostFocus -= OnGrepCommitted;
        _vehicleInput.TextChanged -= OnVehicleChanged;
        _autoscrollToggle.Toggled -= OnAutoscrollToggled;
        _pauseButton.Click -= OnPauseClick;
        _clearButton.Click -= OnClearClick;
        _downloadButton.Click -= OnDownloadClick;
        _reconnectButton.Click -= OnReconnectClick;
        _emptyState.ActionInvoked -= OnReconnectInvoked;

        _viewModel.PropertyChanged -= OnViewModelChanged;
        _viewModel.StreamRequestChanged -= OnStreamRequestChanged;
        _feed.ConnectionChanged -= OnFeedConnectionChanged;
        _feed.LogReceived -= OnFeedLogReceived;
        _feed.DropsReceived -= OnFeedDrops;
        _feed.ErrorChanged -= OnFeedError;

        _feed.StopStreaming();
        GC.SuppressFinalize(this);
    }

    private void StartStream()
    {
        if (_viewModel.Enabled)
        {
            _feed.Start(_viewModel.CurrentRequest);
        }
        else
        {
            _feed.StopStreaming();
        }
    }

    // ---- view-model -> view ------------------------------------------------------------------------------

    private void OnViewModelChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        Marshal(() => Render(_viewModel.Display));

    private void OnStreamRequestChanged() => Marshal(StartStream);

    // ---- feed -> view-model (marshalled onto the UI thread) ----------------------------------------------

    private void OnFeedConnectionChanged(bool connected) => Marshal(() => _viewModel.SetConnected(connected));

    private void OnFeedLogReceived(LogStreamEvent ev) => Marshal(() => _viewModel.AppendEvent(ev));

    private void OnFeedDrops(int count) => Marshal(() => _viewModel.RecordDrops(count));

    private void OnFeedError(string? message) => Marshal(() => _viewModel.SetError(message));

    // ---- control events -> view-model --------------------------------------------------------------------

    private void OnLevelChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppressEvents)
        {
            return;
        }

        if (_levelSelect.SelectedValue is LogStreamLevel level)
        {
            _viewModel.SetLevel(level);
        }
    }

    private void OnGrepChanged(object sender, TextChangedEventArgs e)
    {
        if (_suppressEvents)
        {
            return;
        }

        _viewModel.SetGrepDraft(_grepInput.Text);
    }

    private void OnGrepKeyDown(object sender, KeyRoutedEventArgs e)
    {
        if (e.Key == VirtualKey.Enter)
        {
            e.Handled = true;
            _viewModel.ApplyGrep();
        }
    }

    private void OnGrepCommitted(object sender, RoutedEventArgs e) => _viewModel.ApplyGrep();

    private void OnVehicleChanged(object sender, TextChangedEventArgs e)
    {
        if (_suppressEvents)
        {
            return;
        }

        _viewModel.SetVehicleFilter(_vehicleInput.Text);
    }

    private void OnAutoscrollToggled(object? sender, System.EventArgs e)
    {
        if (_suppressEvents)
        {
            return;
        }

        _viewModel.SetAutoscroll(_autoscrollToggle.IsOn);
    }

    private void OnPauseClick(object sender, RoutedEventArgs e) => _viewModel.TogglePaused();

    private void OnClearClick(object sender, RoutedEventArgs e) => _viewModel.Clear();

    private void OnReconnectClick(object sender, RoutedEventArgs e) => _viewModel.Reconnect();

    private void OnReconnectInvoked(object? sender, System.EventArgs e) => _viewModel.Reconnect();

    private async void OnDownloadClick(object sender, RoutedEventArgs e)
    {
        var window = App.MainWindow;
        if (window is null)
        {
            return;
        }

        string content = _viewModel.BuildDownloadText();
        if (string.IsNullOrEmpty(content))
        {
            return;
        }

        var picker = new FileSavePicker
        {
            SuggestedStartLocation = PickerLocationId.DocumentsLibrary,
            SuggestedFileName = _viewModel.DownloadFileName(System.DateTimeOffset.Now),
        };
        picker.FileTypeChoices.Add("Text", new List<string> { ".txt" });
        InitializeWithWindow.Initialize(picker, WindowNative.GetWindowHandle(window));

        var file = await picker.PickSaveFileAsync().AsTask().ConfigureAwait(true);
        if (file is not null)
        {
            await FileIO.WriteTextAsync(file, content, Windows.Storage.Streams.UnicodeEncoding.Utf8).AsTask().ConfigureAwait(true);
        }
    }

    // ---- render ------------------------------------------------------------------------------------------

    private void Render(LiveLogsDisplay display)
    {
        _suppressEvents = true;

        _title.Value = display.Title;
        _subtitle.Value = display.Subtitle;
        AutomationProperties.SetName(this, display.AutomationName);

        // Filters (GlassPanel1).
        _levelLabel.Value = display.LevelLabel;
        SeedLevelOptions(display.LevelOptions);
        _levelSelect.SelectedValue = display.SelectedLevel;
        AutomationProperties.SetName(_levelSelect, display.LevelLabel);

        _grepLabel.Value = display.GrepLabel;
        _grepInput.Hint = display.GrepHint;
        if (_grepInput.Text != display.GrepValue)
        {
            _grepInput.Text = display.GrepValue;
        }

        _grepHelp.Value = display.GrepHelp;
        AutomationProperties.SetName(_grepInput, display.GrepLabel);

        _vehicleLabel.Value = display.VehicleIdLabel;
        _vehicleInput.Hint = display.VehicleIdHint;
        if (_vehicleInput.Text != display.VehicleIdValue)
        {
            _vehicleInput.Text = display.VehicleIdValue;
        }

        AutomationProperties.SetName(_vehicleInput, display.VehicleIdLabel);
        AutomationProperties.SetName(_filtersPanel, display.LevelLabel);

        // Controls (GlassPanel2).
        _connectionBadge.Content = display.ConnectionLabel;
        _connectionBadge.Status = display.ConnectionStatus;
        AutomationProperties.SetName(_connectionBadge, display.ConnectionLabel);

        _bufferedCaption.Value = display.BufferedText;
        _receivedCaption.Value = display.ReceivedText;
        _dropsCaption.Value = display.DropsText;
        _dropsCaption.Visibility = Show(display.ShowDrops);

        _autoscrollToggle.Header = display.AutoscrollLabel;
        _autoscrollToggle.IsOn = display.Autoscroll;

        _pauseButton.Text = display.PauseLabel;
        _pauseButton.IconGlyph = display.Paused ? PlayGlyph : PauseGlyph;

        _clearButton.Text = display.ClearLabel;

        _downloadButton.Text = display.DownloadLabel;
        _downloadButton.IsEnabled = display.CanDownload;

        _reconnectButton.Text = display.ReconnectLabel;
        AutomationProperties.SetName(_controlsPanel, display.ConnectionLabel);

        // Error (GlassPanel3).
        _errorPanel.Visibility = Show(display.ShowError);
        _errorTitle.Value = display.ErrorTitle;
        _errorMessage.Value = display.ErrorMessage;
        AutomationProperties.SetName(_errorPanel, display.ErrorTitle);

        // Table (GlassPanel4).
        _hdrTime.Text = display.TimeHeader;
        _hdrLevel.Text = display.LevelHeader;
        _hdrMessage.Text = display.MessageHeader;
        _hdrFields.Text = display.FieldsHeader;
        AutomationProperties.SetName(_tablePanel, display.Title);

        RenderTable(display);

        _footerCaption.Value = display.FooterText;

        _suppressEvents = false;
    }

    private void RenderTable(LiveLogsDisplay display)
    {
        if (display.ShowTable)
        {
            RebuildRows(display.Rows);
            _tableHost.Content = _tableContainer;
            if (display.Autoscroll)
            {
                ScrollToBottom();
            }
        }
        else
        {
            _emptyState.Title = display.EmptyTitle;
            _emptyState.Message = display.EmptyMessage;
            _emptyState.ActionText = display.ShowEmptyAction ? display.EmptyActionLabel : string.Empty;
            AutomationProperties.SetName(_emptyState, display.EmptyTitle);
            _tableHost.Content = _emptyState;
        }
    }

    private void RebuildRows(IReadOnlyList<LiveLogRowDisplay> rows)
    {
        _rowsPanel.Children.Clear();
        foreach (var row in rows)
        {
            _rowsPanel.Children.Add(BuildRow(row));
        }
    }

    private static Border BuildRow(LiveLogRowDisplay row)
    {
        var grid = BuildColumnGrid();
        grid.Padding = new Thickness(8, 8, 8, 8);

        AddCell(grid, 0, new TextBlock
        {
            Text = row.Time,
            FontFamily = MonoFont(),
            FontSize = 12,
            Foreground = Brush("TsColorTextSecondaryBrush"),
            VerticalAlignment = VerticalAlignment.Top,
        });

        AddCell(grid, 1, new TsBadge
        {
            Status = row.LevelStatus,
            Content = row.LevelLabel,
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Top,
        });

        AddCell(grid, 2, new TextBlock
        {
            Text = row.Message,
            FontFamily = MonoFont(),
            FontSize = 12,
            TextWrapping = TextWrapping.Wrap,
            Foreground = Brush("TsColorTextPrimaryBrush"),
            VerticalAlignment = VerticalAlignment.Top,
        });

        AddCell(grid, 3, BuildFieldsCell(row));

        return new Border
        {
            Child = grid,
            BorderThickness = new Thickness(0, 0, 0, 1),
            BorderBrush = Brush("TsColorBorderSubtleBrush") ?? Brush("TsColorBorderBrush"),
        };
    }

    private static TextBlock BuildFieldsCell(LiveLogRowDisplay row)
    {
        if (row.Fields.Count == 0 && row.OverflowText is null)
        {
            return new TextBlock { Text = string.Empty };
        }

        var text = new TextBlock
        {
            FontFamily = MonoFont(),
            FontSize = 10,
            TextWrapping = TextWrapping.Wrap,
            VerticalAlignment = VerticalAlignment.Top,
        };

        var muted = Brush("TsColorTextMutedBrush");
        var primary = Brush("TsColorTextSecondaryBrush");

        for (int i = 0; i < row.Fields.Count; i++)
        {
            var field = row.Fields[i];
            text.Inlines.Add(new Run { Text = field.Key + "=", Foreground = muted });
            text.Inlines.Add(new Run { Text = field.Value, Foreground = primary });
            if (i < row.Fields.Count - 1 || row.OverflowText is not null)
            {
                text.Inlines.Add(new Run { Text = "   " });
            }
        }

        if (row.OverflowText is { } overflow)
        {
            text.Inlines.Add(new Run { Text = overflow, Foreground = muted });
        }

        return text;
    }

    private void SeedLevelOptions(IReadOnlyList<LiveLogsLevelOption> options)
    {
        string signature = string.Join('|', options.Select(o => o.Label));
        if (signature == _levelOptionsSignature && _levelSelect.ItemsSource is not null)
        {
            return;
        }

        _levelOptionsSignature = signature;
        _levelSelect.ItemsSource = options;
    }

    private void ScrollToBottom()
    {
        _tableScroll.UpdateLayout();
        _tableScroll.ChangeView(null, _tableScroll.ScrollableHeight, null, true);
    }

    private void Marshal(System.Action action)
    {
        if (_dispatcher is { } dispatcher && !dispatcher.HasThreadAccess)
        {
            dispatcher.TryEnqueue(() => action());
            return;
        }

        action();
    }

    private static Grid BuildColumnGrid()
    {
        var grid = new Grid { ColumnSpacing = 12, HorizontalAlignment = HorizontalAlignment.Stretch };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(TimeColumnWidth) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(LevelColumnWidth) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(FieldsColumnWidth) });
        return grid;
    }

    private static void AddCell(Grid grid, int column, FrameworkElement element)
    {
        Grid.SetColumn(element, column);
        grid.Children.Add(element);
    }

    private static TextBlock NewHeaderCell() => new()
    {
        FontSize = 12,
        FontWeight = FontWeights.SemiBold,
        Foreground = Brush("TsColorTextMutedBrush"),
        HorizontalAlignment = HorizontalAlignment.Left,
    };

    private static FontFamily MonoFont() =>
        Application.Current.Resources.TryGetValue("TsTypeFontFamilyMono", out var v) && v is FontFamily f
            ? f
            : new FontFamily("Consolas");

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;

    private static Brush? Brush(string key) =>
        Application.Current.Resources.TryGetValue(key, out var value) && value is Brush brush ? brush : null;

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new LiveLogsPageAutomationPeer(this);

    private sealed class LiveLogsPageAutomationPeer(LiveLogsPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
