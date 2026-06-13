using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;
using TeslaSync.App.SharedSurfaces;

namespace TeslaSync.App.FeatureViews.Vehicles;

/// <summary>
/// The native WinUI 3 <c>VehicleDetailPage</c> — a parity port of the web page
/// <c>web/src/features/vehicles/pages/VehicleDetailPage.tsx</c> (route <c>/vehicles/:id</c>, nav name
/// <c>VehicleDetail</c>). It binds to a <see cref="VehicleDetailPageViewModel"/> and is the parent composition
/// shell for the vehicle-detail experience: it owns the per-vehicle settings query lifecycle and renders the
/// page-level loading shimmer, the retriable error surface and the page-level empty surface once, then — in the
/// success state — a single Mica <c>GlassPanel1</c> hosting the sixteen web <c>&lt;SectionErrorBoundary&gt;</c>
/// regions (header, battery &amp; range, live state, quick stats, motor, climate, security, tire pressure,
/// charging telemetry, battery charts, recent drives, recent charges, vehicle config, Helix paint preview, quick
/// links and per-vehicle settings), each carrying its localized fallback title and a real-data summary drawn from
/// the resolved settings (or a never-blank localized empty caption), plus the header wake affordance whose result
/// surfaces in an <c>InfoBar</c>-style banner. The view is a thin renderer: all branch selection, formatting,
/// gating and i18n happen in the view-model's <see cref="VehicleDetailDisplay"/> projection. State changes are
/// marshalled onto the UI thread.
/// </summary>
public sealed partial class VehicleDetailPage : UserControl, IDisposable
{
    private const double SectionSpacing = 24;
    private const double PanelPadding = 24;
    private const double RowGap = 12;
    private const string PowerGlyph = "\uE7E8";

    private readonly VehicleDetailPageViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;

    private readonly PageTitle _title = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsDataFreshness _freshness = new() { VerticalAlignment = VerticalAlignment.Center };

    private readonly TsButton _wake = new()
    {
        Variant = ButtonVariant.Secondary,
        Size = ControlSize.Small,
        IconGlyph = PowerGlyph,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TsAlertBanner _wakeBanner = new()
    {
        Dismissible = true,
        IsOpen = false,
        Visibility = Visibility.Collapsed,
    };

    private readonly StackPanel _loadingSkeleton = new() { Spacing = SectionSpacing };
    private readonly TsQueryError _errorState = new();
    private readonly TsEmptyState _emptyState = new() { IconGlyph = VehicleDetailPageRegistration.EmptyGlyph };
    private readonly TsGlassPanel _glassPanel1 = new() { Padding = new Thickness(PanelPadding) };

    /// <summary>Creates the page over the default empty feed and the shell resource localizer (no vehicle bound).</summary>
    public VehicleDetailPage()
        : this(0)
    {
    }

    /// <summary>Creates the page over the default empty feed + shell localizer for a route-supplied vehicle id.</summary>
    /// <param name="vehicleId">The vehicle id from the <c>/vehicles/:id</c> route param.</param>
    public VehicleDetailPage(long vehicleId)
        : this(EmptyVehicleDetailPageFeed.Instance, ShellLocalizer.Instance, vehicleId)
    {
    }

    /// <summary>Creates the page over an explicit feed, localizer and vehicle id (used by tests / dependency injection).</summary>
    /// <param name="feed">The settings + wake data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="vehicleId">The vehicle id from the route.</param>
    public VehicleDetailPage(IVehicleDetailPageFeed feed, ILocalizer localizer, long vehicleId)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _viewModel = new VehicleDetailPageViewModel(feed, localizer, vehicleId);

        BuildLoadingSkeleton();
        Content = BuildLayout();

        _errorState.ActionInvoked += OnRetryInvoked;
        _wake.Click += OnWakeClick;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The diagnostics surface slug (<c>VehicleDetailPage</c>).</summary>
    public static string Slug => VehicleDetailPageRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting/diagnostics).</summary>
    public VehicleDetailPageViewModel ViewModel => _viewModel;

    private ScrollViewer BuildLayout()
    {
        var stack = new StackPanel { Spacing = SectionSpacing, Padding = new Thickness(PanelPadding) };
        stack.Children.Add(BuildHeader());
        stack.Children.Add(_wakeBanner);
        stack.Children.Add(_loadingSkeleton);
        stack.Children.Add(_errorState);
        stack.Children.Add(_emptyState);
        stack.Children.Add(_glassPanel1);

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
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        Grid.SetColumn(_title, 0);
        grid.Children.Add(_title);

        _freshness.Margin = new Thickness(0, 0, RowGap, 0);
        Grid.SetColumn(_freshness, 1);
        grid.Children.Add(_freshness);

        Grid.SetColumn(_wake, 2);
        grid.Children.Add(_wake);

        return grid;
    }

    private void BuildLoadingSkeleton()
    {
        // Mirrors web VehicleDetailSkeleton: header → battery panel → 2×4 stat grids → 2 panels → chart →
        // 2 panels → 6-card grid.
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 36 });
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 160 });
        _loadingSkeleton.Children.Add(UniformGrid(4, 16, BuildSkeletonBlocks(4, 96)));
        _loadingSkeleton.Children.Add(UniformGrid(4, 16, BuildSkeletonBlocks(4, 96)));
        _loadingSkeleton.Children.Add(UniformGrid(2, 16, BuildSkeletonBlocks(2, 176)));
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 320 });
        _loadingSkeleton.Children.Add(UniformGrid(2, 16, BuildSkeletonBlocks(2, 224)));
        _loadingSkeleton.Children.Add(UniformGrid(3, 16, BuildSkeletonBlocks(6, 96)));
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

    /// <summary>Unsubscribe from and dispose the view-model (CA1001; mirrors the sibling feature-view pages).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _errorState.ActionInvoked -= OnRetryInvoked;
        _wake.Click -= OnWakeClick;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        _viewModel.Dispose();
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

    private void OnWakeClick(object sender, RoutedEventArgs e) => _ = _viewModel.WakeAsync();

    private void Render(VehicleDetailDisplay display)
    {
        _title.Value = display.Title;
        AutomationProperties.SetName(this, display.AutomationName);

        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;

        _wake.Text = display.WakeLabel;
        _wake.IsLoading = _viewModel.WakeInProgress;
        AutomationProperties.SetName(_wake, display.WakeLabel);

        RenderWakeBanner(display);

        _loadingSkeleton.Visibility = Show(display.ShowLoading);

        _errorState.Visibility = Show(display.ShowError);
        _errorState.Message = display.ErrorText;
        _errorState.ActionText = display.RetryLabel;
        AutomationProperties.SetName(_errorState, display.ErrorText);

        _emptyState.Visibility = Show(display.ShowEmpty);
        _emptyState.Message = display.EmptyMessage;

        _glassPanel1.Visibility = Show(display.ShowContent);
        _glassPanel1.Content = display.ShowContent ? BuildContent(display) : null;
        AutomationProperties.SetName(_glassPanel1, display.EffectiveName);
    }

    private void RenderWakeBanner(VehicleDetailDisplay display)
    {
        string? status = _viewModel.WakeStatus;
        if (string.IsNullOrEmpty(status))
        {
            _wakeBanner.IsOpen = false;
            _wakeBanner.Visibility = Visibility.Collapsed;
            return;
        }

        _wakeBanner.Variant = _viewModel.WakeIsError ? CalloutVariant.Danger : CalloutVariant.Success;
        _wakeBanner.Title = display.WakeLabel;
        _wakeBanner.Message = status;
        _wakeBanner.IsOpen = true;
        _wakeBanner.Visibility = Visibility.Visible;
        AutomationProperties.SetName(_wakeBanner, $"{display.WakeLabel}. {status}");
    }

    private StackPanel BuildContent(VehicleDetailDisplay display)
    {
        var stack = new StackPanel { Spacing = SectionSpacing };
        int delay = 0;

        foreach (var section in display.Sections)
        {
            if (!section.Visible)
            {
                continue;
            }

            stack.Children.Add(new TsFadeIn { DelayMs = delay, Content = BuildSection(section) });
            delay += 40;
        }

        return stack;
    }

    private SectionErrorBoundary BuildSection(VehicleSectionDisplay section)
    {
        var column = new StackPanel { Spacing = RowGap };

        if (!string.IsNullOrEmpty(section.Heading))
        {
            column.Children.Add(new SectionTitle { Value = section.Heading });
        }

        if (section.Rows.Count > 0)
        {
            column.Children.Add(new TsKVList { Items = ToKeyValues(section.Rows) });
        }
        else
        {
            column.Children.Add(new TsEmptyState { Message = section.EmptyText ?? string.Empty });
        }

        AutomationProperties.SetName(column, section.AccessibleName);

        var boundary = new SectionErrorBoundary(_localizer)
        {
            FallbackTitle = section.FallbackTitle,
            ProtectedContent = column,
        };
        return boundary;
    }

    private static List<TsKeyValue> ToKeyValues(IReadOnlyList<VehicleKvRow> rows)
    {
        var list = new List<TsKeyValue>(rows.Count);
        foreach (var row in rows)
        {
            list.Add(new TsKeyValue(row.Label, row.Value));
        }

        return list;
    }

    private static Grid UniformGrid(int columns, double spacing, List<FrameworkElement> children)
    {
        var grid = new Grid { ColumnSpacing = spacing, RowSpacing = spacing };
        for (int c = 0; c < columns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        int rows = children.Count == 0 ? 0 : ((children.Count + columns - 1) / columns);
        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < children.Count; i++)
        {
            var element = children[i];
            Grid.SetColumn(element, i % columns);
            Grid.SetRow(element, i / columns);
            grid.Children.Add(element);
        }

        return grid;
    }

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new VehicleDetailPageAutomationPeer(this);

    private sealed class VehicleDetailPageAutomationPeer(VehicleDetailPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override string GetClassNameCore() => nameof(VehicleDetailPage);

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
