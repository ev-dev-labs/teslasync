using System.Linq;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Components.Vehicles;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Vehicles;
using TeslaSync.App.Notifications;
using TeslaSync.App.SharedSurfaces;

namespace TeslaSync.App.FeatureViews.Vehicles;

/// <summary>
/// The native WinUI 3 <c>DigitalTwinPage</c> — a parity port of the web page
/// <c>web/src/features/vehicles/pages/DigitalTwinPage.tsx</c> (route <c>/digital-twin</c>, nav group Vehicles). It
/// binds a <see cref="DigitalTwinPageViewModel"/> and renders every web region with Fluent components + design
/// tokens: the page header (title + subtitle) with the shared <see cref="VehicleSelect"/> picker as its action, then
/// the three data states — the loading skeleton (web <c>PageContainer loading</c>), the "no vehicles" empty panel
/// (web <c>!vehicle &amp;&amp; !vehiclesLoading</c>), and the resolved layout: the main twin visualization
/// (<see cref="TsVehicleTwin"/> + <see cref="TsVehiclePaintPicker"/> + last-updated stamp) beside the doors / windows
/// / security &amp; status side panels. The view is a thin renderer: all branch selection, formatting and i18n happen
/// in the view-model's projection; state changes are marshalled onto the UI thread and the live reads re-poll every
/// 5 s (web <c>REFRESH_INTERVAL</c>).
/// </summary>
public sealed partial class DigitalTwinPage : UserControl, IDisposable
{
    private const double SidePanelWidth = 320;

    private readonly DigitalTwinPageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private DispatcherQueueTimer? _refreshTimer;
    private bool _disposed;

    // Header (web PageContainer title / subtitle + actions=<VehicleSelect/>).
    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();
    private readonly VehicleSelect _vehicleSelect;

    // GlassPanel1 — the "no vehicles" empty panel (web !vehicle branch).
    private readonly TsGlassPanel _emptyPanel = new() { Padding = new Thickness(32) };
    private readonly TsEmptyState _noVehicles = new() { IconGlyph = DigitalTwinPageRegistration.CarGlyph };

    // The loading skeleton (web PageContainer loading overlay).
    private readonly StackPanel _loadingSkeleton = new() { Spacing = 16 };

    // GlassPanel2 — the main twin visualization (web VehicleTwin + VehiclePaintPicker + lastUpdated).
    private readonly Grid _contentRoot = new() { ColumnSpacing = 24 };
    private readonly TsGlassPanel _twinPanel = new() { Padding = new Thickness(28) };
    private readonly TsVehicleTwin _twin = new() { HorizontalAlignment = HorizontalAlignment.Center };
    private readonly TsVehiclePaintPicker _paintPicker = new() { HorizontalAlignment = HorizontalAlignment.Center };
    private readonly Caption _lastUpdated = new() { HorizontalAlignment = HorizontalAlignment.Center };

    // GlassPanel3 — Doors & Openings (web KVList | noDoorData EmptyState).
    private readonly TsGlassPanel _doorsPanel = new() { Padding = new Thickness(16) };
    private readonly PanelTitle _doorsTitle = new();
    private readonly ContentControl _doorsHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };
    private readonly TsKVList _doorsList = new();
    private readonly TsEmptyState _doorsEmpty = new() { IconGlyph = DigitalTwinPageRegistration.InfoGlyph };

    // GlassPanel4 — Windows (web KVList | noWindowData EmptyState).
    private readonly TsGlassPanel _windowsPanel = new() { Padding = new Thickness(16) };
    private readonly PanelTitle _windowsTitle = new();
    private readonly ContentControl _windowsHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };
    private readonly TsKVList _windowsList = new();
    private readonly TsEmptyState _windowsEmpty = new() { IconGlyph = DigitalTwinPageRegistration.InfoGlyph };

    // GlassPanel5 — Security & Status (web KVList + StatusBadge).
    private readonly TsGlassPanel _securityPanel = new() { Padding = new Thickness(16) };
    private readonly PanelTitle _securityTitle = new();
    private readonly TsKVList _securityList = new();
    private readonly TsStatusBadge _badge = new();
    private readonly Border _badgeDivider = new() { Margin = new Thickness(0, 12, 0, 0), Padding = new Thickness(0, 12, 0, 0) };

    private PaintPaletteId? _paintOverride;
    private long? _renderedVehicleId;
    private bool _renderedVehicleSet;

    /// <summary>Creates the page over the default empty feed and the shell resource localizer.</summary>
    public DigitalTwinPage()
        : this(EmptyDigitalTwinPageFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The digital-twin data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public DigitalTwinPage(IDigitalTwinPageFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new DigitalTwinPageViewModel(feed, localizer);
        _vehicleSelect = new VehicleSelect(_viewModel.SelectState, localizer, withIcon: true);

        BuildLoadingSkeleton();
        BuildContent();

        Content = BuildLayout();

        _paintPicker.PaintSelected += OnPaintSelected;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The diagnostics surface slug (<c>DigitalTwinPage</c>).</summary>
    public static string Slug => DigitalTwinPageRegistration.Slug;

    private ScrollViewer BuildLayout()
    {
        var stack = new StackPanel { Spacing = 24, Padding = new Thickness(24) };
        stack.Children.Add(BuildHeader());
        stack.Children.Add(_loadingSkeleton);
        stack.Children.Add(_emptyPanel);
        stack.Children.Add(_contentRoot);

        return new ScrollViewer
        {
            Content = stack,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
    }

    private Grid BuildHeader()
    {
        var header = new Grid { ColumnSpacing = 16 };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var heading = new StackPanel { Spacing = 4, VerticalAlignment = VerticalAlignment.Center };
        heading.Children.Add(_title);
        heading.Children.Add(_subtitle);
        Grid.SetColumn(heading, 0);

        _vehicleSelect.MinWidth = 220;
        _vehicleSelect.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(_vehicleSelect, 1);

        header.Children.Add(heading);
        header.Children.Add(_vehicleSelect);
        return header;
    }

    private void BuildLoadingSkeleton()
    {
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 220 });
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 120 });
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 120 });
    }

    private void BuildContent()
    {
        // GlassPanel1 — no-vehicles empty panel.
        _emptyPanel.Content = _noVehicles;

        // GlassPanel2 — twin visualization column.
        var twinColumn = new StackPanel { Spacing = 20, HorizontalAlignment = HorizontalAlignment.Stretch };
        twinColumn.Children.Add(_twin);
        twinColumn.Children.Add(_paintPicker);
        twinColumn.Children.Add(_lastUpdated);
        _twinPanel.Content = twinColumn;

        // GlassPanel3 — Doors & Openings.
        _doorsPanel.Content = BuildDetailPanel(_doorsTitle, _doorsHost);

        // GlassPanel4 — Windows.
        _windowsPanel.Content = BuildDetailPanel(_windowsTitle, _windowsHost);

        // GlassPanel5 — Security & Status.
        _badgeDivider.Child = _badge;
        var securityBody = new StackPanel { Spacing = 0 };
        securityBody.Children.Add(_securityTitle);
        var securitySpacer = new StackPanel { Spacing = 12, Margin = new Thickness(0, 12, 0, 0) };
        securitySpacer.Children.Add(_securityList);
        securitySpacer.Children.Add(_badgeDivider);
        securityBody.Children.Add(securitySpacer);
        _securityPanel.Content = securityBody;

        var sidePanels = new StackPanel { Spacing = 16, Width = SidePanelWidth };
        sidePanels.Children.Add(_doorsPanel);
        sidePanels.Children.Add(_windowsPanel);
        sidePanels.Children.Add(_securityPanel);

        _contentRoot.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _contentRoot.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_twinPanel, 0);
        Grid.SetColumn(sidePanels, 1);
        _contentRoot.Children.Add(_twinPanel);
        _contentRoot.Children.Add(sidePanels);
    }

    private static StackPanel BuildDetailPanel(PanelTitle title, ContentControl host)
    {
        var body = new StackPanel { Spacing = 12 };
        body.Children.Add(title);
        body.Children.Add(host);
        return body;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        _viewModel.NotifyOpened();

        _refreshTimer ??= CreateRefreshTimer();
        _refreshTimer.Start();

        await _viewModel.LoadAsync().ConfigureAwait(true);
    }

    private DispatcherQueueTimer CreateRefreshTimer()
    {
        var timer = _dispatcher.CreateTimer();
        timer.Interval = TimeSpan.FromMilliseconds(DigitalTwinPageProjection.RefreshIntervalMs);
        timer.IsRepeating = true;
        timer.Tick += OnRefreshTick;
        return timer;
    }

    private void OnRefreshTick(DispatcherQueueTimer sender, object args) => _ = _viewModel.RefreshAsync();

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Stop polling, unsubscribe and dispose the view-model (CA1001; mirrors the sibling feature-view pages).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        if (_refreshTimer is { } timer)
        {
            timer.Stop();
            timer.Tick -= OnRefreshTick;
            _refreshTimer = null;
        }

        _paintPicker.PaintSelected -= OnPaintSelected;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        _vehicleSelect.Dispose();
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnPaintSelected(object? sender, PaintPalette palette)
    {
        _paintOverride = palette.Id;
        _twin.SetPaint(palette);
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

    private void Render(DigitalTwinPageDisplay display)
    {
        _title.Value = display.Title;
        _subtitle.Value = display.Subtitle;
        AutomationProperties.SetName(this, display.AutomationName);

        _loadingSkeleton.Visibility = Show(display.ShowLoading);
        _emptyPanel.Visibility = Show(display.ShowEmpty);
        _contentRoot.Visibility = Show(display.ShowContent);

        _noVehicles.Message = display.NoVehiclesMessage;

        RenderTwin(display);
        RenderDetailPanel(_doorsTitle, display.DoorsTitle, _doorsHost, _doorsList, _doorsEmpty, display.ShowDoorItems, display.DoorItems, display.NoDoorMessage);
        RenderDetailPanel(_windowsTitle, display.WindowsTitle, _windowsHost, _windowsList, _windowsEmpty, display.ShowWindowItems, display.WindowItems, display.NoWindowMessage);
        RenderSecurity(display);
    }

    private void RenderTwin(DigitalTwinPageDisplay display)
    {
        // A new vehicle resets any local paint override so its own colour shows.
        if (!_renderedVehicleSet || _renderedVehicleId != display.SelectedVehicleId)
        {
            _renderedVehicleSet = true;
            _renderedVehicleId = display.SelectedVehicleId;
            _paintOverride = null;
            _paintPicker.SelectedId = PaintPalettes.InferFromTesla(display.Twin.ExteriorColor).Id;
        }

        _twin.SetModel(display.Twin);
        if (_paintOverride is { } id)
        {
            _twin.SetPaint(PaintPalettes.ById(id));
        }

        _lastUpdated.Visibility = Show(display.ShowLastUpdated);
        _lastUpdated.Value = $"{display.LastUpdatedLabel}: {display.LastUpdatedValue}";
    }

    private static void RenderDetailPanel(
        PanelTitle title,
        string titleText,
        ContentControl host,
        TsKVList list,
        TsEmptyState empty,
        bool showItems,
        IReadOnlyList<DigitalTwinItem> items,
        string emptyMessage)
    {
        title.Value = titleText;
        if (showItems)
        {
            list.Items = ToKeyValues(items);
            host.Content = list;
            AutomationProperties.SetName(host, titleText);
        }
        else
        {
            empty.Message = emptyMessage;
            host.Content = empty;
            AutomationProperties.SetName(host, emptyMessage);
        }
    }

    private void RenderSecurity(DigitalTwinPageDisplay display)
    {
        _securityTitle.Value = display.SecurityTitle;
        _securityList.Items = ToKeyValues(display.SecurityItems);
        _badgeDivider.Visibility = Show(display.ShowBadge);
        _badge.Status = display.BadgeStatus;
        _badge.AccentBrushKey = display.BadgeAccentKey;
    }

    private static List<TsKeyValue> ToKeyValues(IReadOnlyList<DigitalTwinItem> items) =>
        items.Select(static i => new TsKeyValue(i.Label, i.Value)).ToList();

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new DigitalTwinPageAutomationPeer(this);

    private sealed class DigitalTwinPageAutomationPeer(DigitalTwinPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
