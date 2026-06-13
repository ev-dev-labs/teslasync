using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.DataDisplay;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// The native WinUI 3 <c>LiveSignalInspectorPage</c> — a parity port of the web page
/// <c>web/src/features/admin/pages/LiveSignalInspectorPage.tsx</c> (route <c>/admin/live-signals</c>, nav name
/// <c>LiveSignalInspector</c>). It binds to a <see cref="LiveSignalInspectorPageViewModel"/> and renders every web
/// region with Fluent components and design tokens: the page header (title + subtitle + a live indicator when a
/// vehicle is selected), the controls panel (GlassPanel1 — the vehicle picker, web <c>VehicleSelect</c>), the
/// no-vehicle empty state (GlassPanel2 — web <c>vehicleId === null</c>) and the live snapshot panel (GlassPanel3 —
/// an Activity-iconed header over the composed <see cref="LiveSignalsTable"/>, web <c>LiveSignalsTable</c>). The
/// composed table owns the per-second live read (web <c>useVehicleLiveSignals</c>) and its own loading / empty /
/// error / stale branches. The view is a thin renderer: all branch selection, formatting and i18n happen in the
/// view-model's <see cref="LiveSignalInspectorDisplay"/> projection. State changes are marshalled onto the UI
/// thread.
/// </summary>
public sealed partial class LiveSignalInspectorPage : UserControl, IDisposable
{
    private const string ActivityGlyph = "\uE9D9"; // Segoe Fluent — Speed (web lucide Activity)
    private const string RadioGlyph = "\uE93C";    // Segoe Fluent — Radio (web lucide Radio)

    private readonly LiveSignalInspectorPageViewModel _viewModel;
    private readonly ILiveSignalsTableSource _liveSource;
    private readonly ILocalizer _localizer;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;
    private bool _suppressEvents;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();
    private readonly TsLiveIndicator _liveIndicator = new() { State = LiveConnectionState.Connected, VerticalAlignment = VerticalAlignment.Center };

    private readonly TsGlassPanel _controlsPanel = new();
    private readonly TsSelect _vehicleSelect = new() { Width = 256, HorizontalAlignment = HorizontalAlignment.Left };
    private readonly StackPanel _vehicleLoading;
    private readonly ProgressRing _vehicleLoadingRing = new() { IsActive = true, Width = 18, Height = 18, VerticalAlignment = VerticalAlignment.Center };
    private readonly Caption _vehicleLoadingText = new() { VerticalAlignment = VerticalAlignment.Center };

    private readonly TsGlassPanel _noVehiclePanel = new();
    private readonly TsEmptyState _noVehicleEmpty = new() { IconGlyph = RadioGlyph };

    private readonly TsGlassPanel _snapshotPanel = new();
    private readonly PanelTitle _snapshotTitle = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly Border _snapshotHost = new();

    private LiveSignalsTable? _snapshotTable;
    private long _snapshotVehicleId;

    /// <summary>Creates the page over the default empty feed / live source and the shell resource localizer.</summary>
    public LiveSignalInspectorPage()
        : this(EmptyLiveSignalInspectorFeed.Instance, EmptyLiveSignalsTableSource.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed, live-signals source and localizer (tests / DI).</summary>
    /// <param name="feed">The fleet-list data port for the vehicle picker (web <c>useVehicles</c>).</param>
    /// <param name="liveSource">The per-vehicle live-snapshot source the composed table reads (web <c>useVehicleLiveSignals</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public LiveSignalInspectorPage(ILiveSignalInspectorFeed feed, ILiveSignalsTableSource liveSource, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(liveSource);
        ArgumentNullException.ThrowIfNull(localizer);

        _liveSource = liveSource;
        _localizer = localizer;
        _viewModel = new LiveSignalInspectorPageViewModel(feed, localizer);

        _vehicleLoading = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        _vehicleLoading.Children.Add(_vehicleLoadingRing);
        _vehicleLoading.Children.Add(_vehicleLoadingText);

        Content = BuildLayout();

        _vehicleSelect.SelectionChanged += OnVehicleChanged;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The diagnostics surface slug (<c>LiveSignalInspectorPage</c>).</summary>
    public static string Slug => LiveSignalInspectorRegistration.Slug;

    private ScrollViewer BuildLayout()
    {
        var stack = new StackPanel { Spacing = 16, Padding = new Thickness(24) };
        stack.Children.Add(BuildHeader());
        stack.Children.Add(BuildControlsPanel());
        stack.Children.Add(BuildNoVehiclePanel());
        stack.Children.Add(BuildSnapshotPanel());

        return new ScrollViewer
        {
            Content = stack,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
    }

    private Grid BuildHeader()
    {
        var heading = new StackPanel { Spacing = 4, VerticalAlignment = VerticalAlignment.Center };
        heading.Children.Add(_title);
        heading.Children.Add(_subtitle);

        var grid = new Grid { ColumnSpacing = 16 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(heading, 0);
        Grid.SetColumn(_liveIndicator, 1);
        grid.Children.Add(heading);
        grid.Children.Add(_liveIndicator);
        return grid;
    }

    private TsGlassPanel BuildControlsPanel()
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 16,
            VerticalAlignment = VerticalAlignment.Center,
        };
        row.Children.Add(_vehicleSelect);
        row.Children.Add(_vehicleLoading);

        _controlsPanel.Content = new Border { Padding = new Thickness(24), Child = row };
        return _controlsPanel;
    }

    private TsGlassPanel BuildNoVehiclePanel()
    {
        _noVehiclePanel.Content = new Border { Padding = new Thickness(24), Child = _noVehicleEmpty };
        return _noVehiclePanel;
    }

    private TsGlassPanel BuildSnapshotPanel()
    {
        var icon = new FontIcon
        {
            Glyph = ActivityGlyph,
            FontSize = 18,
            Foreground = Brush("TsColorTextMutedBrush"),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        var header = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(0, 0, 0, 16),
        };
        header.Children.Add(icon);
        header.Children.Add(_snapshotTitle);

        var body = new StackPanel { Spacing = 0 };
        body.Children.Add(header);
        body.Children.Add(_snapshotHost);

        _snapshotPanel.Content = new Border { Padding = new Thickness(24), Child = body };
        return _snapshotPanel;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        _viewModel.NotifyOpened();
        await _viewModel.LoadAsync().ConfigureAwait(true);
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Unsubscribe from and dispose the view-model + composed table (CA1001; mirrors the sibling pages).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _vehicleSelect.SelectionChanged -= OnVehicleChanged;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        _viewModel.Dispose();
        ReleaseSnapshotTable();
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

    private void Render(LiveSignalInspectorDisplay display)
    {
        _suppressEvents = true;

        _title.Value = display.Title;
        _subtitle.Value = display.Subtitle;
        AutomationProperties.SetName(this, display.AutomationName);

        // Header — live indicator (web actions: <LiveIndicator/> when vehicleId !== null).
        _liveIndicator.Visibility = Show(display.ShowLiveIndicator);

        // GlassPanel1 — controls (vehicle picker). Always visible.
        _vehicleSelect.Hint = display.SelectVehiclePrompt;
        AutomationProperties.SetName(_vehicleSelect, display.VehicleAriaLabel);
        AutomationProperties.SetName(_controlsPanel, display.VehicleAriaLabel);
        _vehicleSelect.ItemsSource = display.VehicleOptions;
        _vehicleSelect.DisplayMemberPath = nameof(LiveSignalVehicleOption.Label);
        _vehicleSelect.SelectedItem = FindOption(display);

        _vehicleLoading.Visibility = Show(display.ShowVehicleLoading);
        _vehicleLoadingText.Value = display.VehicleLoadingText;
        _vehicleLoadingRing.IsActive = display.ShowVehicleLoading;

        // GlassPanel2 — no-vehicle empty state (web vehicleId === null).
        _noVehiclePanel.Visibility = Show(display.ShowNoVehicle);
        _noVehicleEmpty.Title = display.NoVehicleTitle;
        _noVehicleEmpty.Message = display.NoVehicleMessage;

        // GlassPanel3 — live snapshot panel (web LiveSignalsTable).
        _snapshotPanel.Visibility = Show(display.ShowSnapshot);
        _snapshotTitle.Value = display.SnapshotTitle;
        AutomationProperties.SetName(_snapshotPanel, display.SnapshotTitle);
        SyncSnapshotTable(display);

        _suppressEvents = false;
    }

    private static LiveSignalVehicleOption? FindOption(LiveSignalInspectorDisplay display)
    {
        if (display.SelectedVehicleId is not { } id)
        {
            return null;
        }

        foreach (var option in display.VehicleOptions)
        {
            if (option.Id == id)
            {
                return option;
            }
        }

        return null;
    }

    private void SyncSnapshotTable(LiveSignalInspectorDisplay display)
    {
        if (display.ShowSnapshot && display.SelectedVehicleId is { } id && id > 0)
        {
            if (_snapshotTable is null || _snapshotVehicleId != id)
            {
                ReleaseSnapshotTable();
                _snapshotTable = new LiveSignalsTable(_liveSource, id, _localizer);
                _snapshotVehicleId = id;
                _snapshotHost.Child = _snapshotTable;
            }

            return;
        }

        ReleaseSnapshotTable();
    }

    private void ReleaseSnapshotTable()
    {
        if (_snapshotTable is null)
        {
            return;
        }

        _snapshotHost.Child = null;
        _snapshotTable.Dispose();
        _snapshotTable = null;
        _snapshotVehicleId = 0;
    }

    private void OnVehicleChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppressEvents)
        {
            return;
        }

        long? id = _vehicleSelect.SelectedItem is LiveSignalVehicleOption option ? option.Id : null;
        _viewModel.SelectVehicle(id);
    }

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;

    private static Brush? Brush(string key) =>
        Application.Current.Resources.TryGetValue(key, out var value) && value is Brush brush ? brush : null;
}
