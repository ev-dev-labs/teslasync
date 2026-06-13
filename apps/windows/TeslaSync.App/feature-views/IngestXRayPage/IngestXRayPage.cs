using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Layout;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.IngestXRay;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// The native WinUI 3 <c>IngestXRayPage</c> — a parity port of the web page
/// <c>web/src/features/admin/pages/IngestXRayPage.tsx</c> (route <c>/admin/ingest-xray</c>, nav name
/// <c>IngestXRay</c>). It binds to an <see cref="IngestXRayPageViewModel"/> and reproduces every web region with
/// Fluent components and design tokens: the page header (title + subtitle + the <c>query={xray}</c> data-freshness
/// chip), the retryable X-Ray-error InfoBar, the controls glass panel (GlassPanel 1 — the <see cref="XRayControls"/>
/// vehicle / window / bucket picker), the no-vehicle empty glass panel (GlassPanel 2 — shown while no vehicle is
/// selected), the three stat tiles (the <see cref="XRayHeader"/> region: total samples / distinct fields / window),
/// the bucket chart glass panel (GlassPanel 3 — the <see cref="XRayBucketChart"/>) and the field-statistics glass
/// panel (GlassPanel 4 — an Activity-titled header over the <see cref="XRayFieldsTable"/>). The view is a thin
/// renderer: all branch selection, formatting and i18n happen in the view-model and the composed surfaces'
/// projections. State changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class IngestXRayPage : UserControl, IDisposable
{
    private const string FieldsGlyph = "\uE9D9"; // Health — the web lucide Activity (field statistics).
    private const double CardMinWidth = 200;      // web sm:grid-cols-3 wrap threshold.

    private readonly IngestXRayPageViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();
    private readonly TsDataFreshness _freshness = new();
    private readonly TsQueryError _xrayError = new();

    private readonly XRayControls _controls;
    private readonly XRayBucketChart _chart;
    private readonly XRayFieldsTable _fields;

    private readonly TsStatCard _samplesCard = new();
    private readonly TsStatCard _fieldsCard = new();
    private readonly TsStatCard _windowCard = new();
    private readonly TsEmptyState _noVehicleEmpty = new();
    private readonly PanelTitle _fieldsTitle = new();

    private readonly TsGlassPanel _controlsPanel;
    private readonly TsGlassPanel _noVehiclePanel;
    private readonly StackPanel _dataSection = new() { Spacing = 24 };

    private XRayControlsModel? _lastControlsModel;
    private XRayBucketChartModel? _lastChartModel;
    private XRayFieldsTableModel? _lastFieldsModel;

    /// <summary>Creates the page over the default empty feed and the shell resource localizer.</summary>
    public IngestXRayPage()
        : this(EmptyIngestXRayPageFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit data port and a localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The page's read seam (web <c>useVehicles</c> + <c>useIngestXRay</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public IngestXRayPage(IIngestXRayPageFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _viewModel = new IngestXRayPageViewModel(feed, localizer);

        _controls = new XRayControls(localizer);
        _chart = new XRayBucketChart(localizer);
        _fields = new XRayFieldsTable(localizer);
        _controlsPanel = new TsGlassPanel { Content = _controls, Padding = new Thickness(24) };
        _noVehiclePanel = new TsGlassPanel { Content = _noVehicleEmpty, Padding = new Thickness(24) };

        Content = BuildLayout();

        _controls.VehicleChanged += OnVehicleChanged;
        _controls.WindowChanged += OnWindowChanged;
        _controls.BucketChanged += OnBucketChanged;
        _controls.RetryRequested += OnVehiclesRetry;
        _xrayError.ActionInvoked += OnXRayRetry;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>The diagnostics surface slug (<c>IngestXRayPage</c>).</summary>
    public static string Slug => IngestXRayPageRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public IngestXRayPageViewModel ViewModel => _viewModel;

    private Grid BuildLayout()
    {
        BuildDataSection();

        var stack = new StackPanel { Spacing = 24, Padding = new Thickness(24) };
        stack.Children.Add(BuildHeader());
        stack.Children.Add(_controlsPanel);   // GlassPanel 1 — controls
        stack.Children.Add(_xrayError);       // page-tier X-Ray error surface (InfoBar + Retry)
        stack.Children.Add(_noVehiclePanel);  // GlassPanel 2 — no-vehicle empty
        stack.Children.Add(_dataSection);     // header tiles + GlassPanel 3 (chart) + GlassPanel 4 (fields)

        var scroller = new ScrollViewer
        {
            Content = stack,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };

        var root = new Grid();
        root.Children.Add(scroller);
        return root;
    }

    private Grid BuildHeader()
    {
        var heading = new StackPanel { Spacing = 4 };
        heading.Children.Add(_title);
        heading.Children.Add(_subtitle);

        var header = new Grid { ColumnSpacing = 12 };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        Grid.SetColumn(heading, 0);
        _freshness.VerticalAlignment = VerticalAlignment.Top;
        _freshness.HorizontalAlignment = HorizontalAlignment.Right;
        Grid.SetColumn(_freshness, 1);

        header.Children.Add(heading);
        header.Children.Add(_freshness);
        return header;
    }

    // The data section the web renders once a vehicle is selected: the three stat tiles (XRayHeader), the bucket
    // chart (GlassPanel 3, self-wrapped in its own Mica region) and the field-statistics panel (GlassPanel 4).
    private void BuildDataSection()
    {
        _samplesCard.Glyph = XRayHeaderRegistration.SamplesGlyph;
        _fieldsCard.Glyph = XRayHeaderRegistration.FieldsGlyph;
        _windowCard.Glyph = XRayHeaderRegistration.WindowGlyph;

        var tiles = new TsGrid { Columns = 3, Gutter = 16, ItemMinWidth = CardMinWidth };
        tiles.Children.Add(_samplesCard);
        tiles.Children.Add(_fieldsCard);
        tiles.Children.Add(_windowCard);

        _dataSection.Children.Add(tiles);
        _dataSection.Children.Add(_chart);                  // GlassPanel 3 — bucket chart
        _dataSection.Children.Add(BuildFieldsPanel());      // GlassPanel 4 — field statistics
    }

    // A web `<GlassPanel className="p-6">` whose header is an Activity icon + PanelTitle row above the table.
    private TsGlassPanel BuildFieldsPanel()
    {
        var headerRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            Margin = new Thickness(0, 0, 0, 16),
        };
        var icon = new FontIcon { Glyph = FieldsGlyph, FontSize = 18, Foreground = DisplayTokens.TextMuted };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        _fieldsTitle.VerticalAlignment = VerticalAlignment.Center;
        headerRow.Children.Add(icon);
        headerRow.Children.Add(_fieldsTitle);

        var body = new StackPanel { Spacing = 0 };
        body.Children.Add(headerRow);
        body.Children.Add(_fields);

        return new TsGlassPanel { Content = body, Padding = new Thickness(24) };
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
        _controls.VehicleChanged -= OnVehicleChanged;
        _controls.WindowChanged -= OnWindowChanged;
        _controls.BucketChanged -= OnBucketChanged;
        _controls.RetryRequested -= OnVehiclesRetry;
        _xrayError.ActionInvoked -= OnXRayRetry;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnViewModelChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (_dispatcher.HasThreadAccess)
        {
            Render();
        }
        else
        {
            _dispatcher.TryEnqueue(Render);
        }
    }

    private void Render()
    {
        _title.Value = _viewModel.Title;
        _subtitle.Value = _viewModel.Subtitle;
        AutomationProperties.SetName(this, _viewModel.Title);

        // web PageContainer query={xray}: the page-tier data-freshness chip (loading → "Updating…",
        // error → "Error", success → "Live") tied to the X-Ray query.
        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;

        // Retryable X-Ray-error surface (the native InfoBar + Retry for the error data state).
        _xrayError.Title = _viewModel.LoadErrorMessage;
        _xrayError.ActionText = _viewModel.RetryLabel;
        _xrayError.Visibility = Show(_viewModel.ShowXRayError);
        AutomationProperties.SetName(_xrayError, _viewModel.LoadErrorMessage);

        // GlassPanel 1 — controls (always visible). Only reassign when the model actually changed so a background
        // refresh never re-announces the picker or drops the open dropdown.
        XRayControlsModel controls = _viewModel.ControlsModel;
        if (!controls.Equals(_lastControlsModel))
        {
            _controls.Model = controls;
            _lastControlsModel = controls;
        }

        // GlassPanel 2 — no-vehicle empty (web vehicleId === null branch).
        _noVehicleEmpty.Title = _viewModel.NoVehicleTitle;
        _noVehicleEmpty.Message = _viewModel.NoVehicleMessage;
        _noVehiclePanel.Visibility = Show(_viewModel.ShowNoVehicle);

        // Header tiles + GlassPanel 3 + GlassPanel 4 (web vehicle-selected branch).
        _dataSection.Visibility = Show(_viewModel.HasVehicle);

        _samplesCard.Label = _viewModel.SamplesLabel;
        _samplesCard.Sublabel = _viewModel.SamplesSublabel;
        _fieldsCard.Label = _viewModel.FieldsLabel;
        _fieldsCard.Sublabel = _viewModel.FieldsSublabel;
        _windowCard.Label = _viewModel.WindowTitle;
        _windowCard.Sublabel = _viewModel.WindowSublabel;

        XRayHeaderDisplay header = _viewModel.HeaderDisplay;
        _samplesCard.Value = header.SamplesValue;
        _fieldsCard.Value = header.FieldsValue;
        _windowCard.Value = header.WindowValue;

        _fieldsTitle.Value = _viewModel.PanelFieldsTitle;

        XRayBucketChartModel chart = _viewModel.BucketChartModel;
        if (!chart.Equals(_lastChartModel))
        {
            _chart.Model = chart;
            _lastChartModel = chart;
        }

        XRayFieldsTableModel fields = _viewModel.FieldsTableModel;
        if (!fields.Equals(_lastFieldsModel))
        {
            _fields.Model = fields;
            _lastFieldsModel = fields;
        }
    }

    private void OnVehicleChanged(object? sender, int? vehicleId) =>
        InvokeAsync(() => _viewModel.SelectVehicleAsync(vehicleId));

    private void OnWindowChanged(object? sender, IngestXRayWindow window) =>
        InvokeAsync(() => _viewModel.SelectWindowAsync(window));

    private void OnBucketChanged(object? sender, IngestXRayBucket bucket) =>
        InvokeAsync(() => _viewModel.SelectBucketAsync(bucket));

    private void OnVehiclesRetry(object? sender, EventArgs e) =>
        InvokeAsync(() => _viewModel.RetryVehiclesAsync());

    private void OnXRayRetry(object? sender, EventArgs e) =>
        InvokeAsync(() => _viewModel.RetryXRayAsync());

    private static async void InvokeAsync(Func<Task> action) => await action().ConfigureAwait(true);

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;
}
