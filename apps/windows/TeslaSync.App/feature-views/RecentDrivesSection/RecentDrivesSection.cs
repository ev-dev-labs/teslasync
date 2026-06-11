using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 Recent-Drives feature surface — a parity port of
/// web/src/features/vehicles/components/vehicle-detail/RecentDrivesSection.tsx. It reproduces the web
/// section's heading (a Route glyph + "Recent Drives" title) with a "View all" affordance, and the web
/// <c>DataTable</c>'s four columns — Date, Distance (the sole sortable column), Duration and Battery — over
/// the recent drives. The web component is a pure child of the Vehicle-Detail page that receives an
/// already-resolved drive array; the native feature-view owns its cache-then-network drive-list read, so it
/// renders every state the P2 contract mandates — a loading skeleton, the populated sortable + paged table,
/// the friendly empty surface (web <c>EmptyState</c>), an explicit retry surface on hard failure, plus stale
/// and offline freshness chips. All data flows through the shared <see cref="RecentDrivesSectionViewModel"/>;
/// the view never performs HTTP. Every string resolves through the i18n facade and every interactive element
/// carries a Narrator name.
/// </summary>
public sealed partial class RecentDrivesSection : ContentControl, IDisposable
{
    private const string RouteGlyph = "\uE8AD";          // Segoe Fluent MapDirections — web lucide Route
    private const string RefreshGlyph = "\uE72C";        // Segoe Fluent Refresh
    private const string ViewAllGlyph = "\uE76C";        // Segoe Fluent ChevronRight — web ChevronRight
    private const string SortAscendingGlyph = "\uE70E";  // Segoe Fluent sort-up caret
    private const string SortDescendingGlyph = "\uE70D"; // Segoe Fluent sort-down caret
    private const int FadeInDelayMs = 300;
    private const int SkeletonLineCount = 6;
    private const double RowSpacing = 0;

    private static readonly GridLength[] ColumnWidths =
    {
        new(200), // date
        new(140), // distance
        new(120), // duration
        new(150), // battery
    };

    private readonly RecentDrivesSectionViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly RecentDrivesSectionDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly TsFadeIn _fade = new() { DelayMs = FadeInDelayMs };
    private readonly StackPanel _root = new() { Spacing = 16 };
    private readonly Grid _header = new();
    private readonly StackPanel _titleRow = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 8,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly FontIcon _titleIcon = new()
    {
        Glyph = RouteGlyph,
        FontSize = 16,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly SectionTitle _title = new() { VerticalAlignment = VerticalAlignment.Center };

    private readonly StackPanel _actions = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 8,
        HorizontalAlignment = HorizontalAlignment.Right,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TsBadge _freshnessChip = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TextBlock _freshnessChipText = new() { FontSize = 12 };
    private readonly TsDataFreshness _freshness = new() { VerticalAlignment = VerticalAlignment.Center };

    private readonly TsButton _refresh = new()
    {
        Variant = ButtonVariant.Subtle,
        Size = ControlSize.Small,
        IconGlyph = RefreshGlyph,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TsButton _viewAll = new()
    {
        Variant = ButtonVariant.Subtle,
        Size = ControlSize.Small,
        IconGlyph = ViewAllGlyph,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly Border _bodyHost = new();
    private readonly StackPanel _loadingRoot = new() { Spacing = 10 };
    private readonly TsQueryError _errorView = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsEmptyState _emptyView = new() { IconGlyph = RouteGlyph };

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, (optional) diagnostics and units.</summary>
    /// <param name="source">The cache-then-network drive-list source.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink; a private collector is used when null.</param>
    /// <param name="units">The user's unit preference (web <c>useUnits</c>); defaults to metric when null.</param>
    public RecentDrivesSection(
        IRecentDrivesSectionSource source,
        ILocalizer localizer,
        RecentDrivesSectionDiagnostics? diagnostics = null,
        UnitPref? units = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new RecentDrivesSectionDiagnostics();
        _viewModel = new RecentDrivesSectionViewModel(source, localizer, units);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        AutomationProperties.SetName(this, _viewModel.Title);

        BuildChrome();

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        _refresh.Click += OnRefreshClick;
        _viewAll.Click += OnViewAllClick;
        _errorView.ActionInvoked += OnRetry;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Content = _fade;
        Render();
    }

    /// <summary>Raised when the user invokes "View all"; the host routes this to the drives list (web <c>/drives</c>).</summary>
    public event EventHandler? ViewAllRequested;

    /// <summary>The canonical surface id (<c>recent-drives-section</c>).</summary>
    public static string SurfaceId => RecentDrivesSectionRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public RecentDrivesSectionViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="RecentDrivesSectionSource"/> from the
    /// shared data layer (the host's P2-core dependencies), scoped to an explicit <paramref name="vehicleId"/>
    /// or — when null — the primary vehicle.
    /// </summary>
    public static RecentDrivesSection Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        long? vehicleId = null,
        RecentDrivesSectionDiagnostics? diagnostics = null,
        UnitPref? units = null)
    {
        var source = new RecentDrivesSectionSource(vehicles, api, engine, options, vehicleId);
        return new RecentDrivesSection(source, localizer, diagnostics, units);
    }

    private void BuildChrome()
    {
        AutomationProperties.SetAccessibilityView(_titleIcon, AccessibilityView.Raw);
        _titleIcon.Foreground = DisplayTokens.Accent;
        _titleRow.Children.Add(_titleIcon);
        _titleRow.Children.Add(_title);

        _freshnessChip.Content = _freshnessChipText;
        _actions.Children.Add(_freshnessChip);
        _actions.Children.Add(_freshness);
        _actions.Children.Add(_refresh);
        _actions.Children.Add(_viewAll);

        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_titleRow, 0);
        Grid.SetColumn(_actions, 1);
        _header.Children.Add(_titleRow);
        _header.Children.Add(_actions);

        for (int i = 0; i < SkeletonLineCount; i++)
        {
            _loadingRoot.Children.Add(new TsSkeleton
            {
                BlockHeight = 14,
                ReduceMotion = MotionPreference.ReduceMotion,
            });
        }

        _root.Children.Add(_header);
        _root.Children.Add(_bodyHost);
        _fade.Content = new TsGlassPanel { Padding = new Thickness(24), Content = _root };
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _diagnostics.RecordViewOpened();
        _ = _viewModel.LoadAsync();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnRefreshClick(object sender, RoutedEventArgs e) => _ = _viewModel.RetryAsync();

    private void OnRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private void OnViewAllClick(object sender, RoutedEventArgs e) => ViewAllRequested?.Invoke(this, EventArgs.Empty);

    /// <summary>Detach from the view-model and cancel any in-flight load (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _refresh.Click -= OnRefreshClick;
        _viewAll.Click -= OnViewAllClick;
        _errorView.ActionInvoked -= OnRetry;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        ScheduleRender();

    private void ScheduleRender()
    {
        if (_renderQueued)
        {
            return;
        }

        _renderQueued = true;
        if (_dispatcher is { } dispatcher)
        {
            dispatcher.TryEnqueue(RenderCoalesced);
        }
        else
        {
            RenderCoalesced();
        }
    }

    private void RenderCoalesced()
    {
        _renderQueued = false;
        Render();
    }

    private void Render()
    {
        var display = _viewModel.Display;
        var state = _viewModel.State;

        _title.Value = display.Title;
        AutomationProperties.SetName(this, display.Title);

        _viewAll.Text = display.ViewAllLabel;
        AutomationProperties.SetName(_viewAll, display.ViewAllLabel);
        ToolTipService.SetToolTip(_viewAll, display.ViewAllLabel);

        UpdateFreshness(state);

        _bodyHost.Child = state switch
        {
            RecentDrivesSectionState.Loading => BuildLoading(),
            RecentDrivesSectionState.Error => BuildError(),
            RecentDrivesSectionState.Empty => BuildEmpty(display),
            _ => BuildTable(display),
        };
    }

    private StackPanel BuildLoading()
    {
        LiveRegion.Configure(_loadingRoot);
        LiveRegion.Announce(_loadingRoot);
        AutomationProperties.SetName(_loadingRoot, _viewModel.LoadingLabel);
        return _loadingRoot;
    }

    private TsQueryError BuildError()
    {
        _errorView.Title = _viewModel.ErrorTitle;
        _errorView.Message = _viewModel.ErrorMessage ?? _viewModel.ErrorTitle;
        _errorView.ActionText = _viewModel.RetryLabel;
        _errorView.AttemptCount = _viewModel.Attempts;
        AutomationProperties.SetName(_errorView, _errorView.Message);
        return _errorView;
    }

    private TsEmptyState BuildEmpty(RecentDrivesSectionDisplay display)
    {
        _emptyView.IconGlyph = RouteGlyph;
        _emptyView.Message = display.EmptyMessage;
        AutomationProperties.SetName(_emptyView, display.EmptyMessage);
        return _emptyView;
    }

    private StackPanel BuildTable(RecentDrivesSectionDisplay display)
    {
        var table = new StackPanel { Spacing = RowSpacing };
        table.Children.Add(BuildHeaderRow(display));
        foreach (var row in display.Rows)
        {
            table.Children.Add(BuildRow(row));
        }

        var scroller = new ScrollViewer
        {
            Content = table,
            HorizontalScrollMode = ScrollMode.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
            VerticalScrollMode = ScrollMode.Disabled,
            VerticalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };

        var root = new StackPanel { Spacing = 12 };
        root.Children.Add(scroller);
        if (display.ShowPagination)
        {
            root.Children.Add(BuildPager(display));
        }

        return root;
    }

    private Border BuildHeaderRow(RecentDrivesSectionDisplay display)
    {
        var grid = NewRowGrid();

        var date = HeaderText(display.DateHeader);
        Grid.SetColumn(date, 0);
        grid.Children.Add(date);

        var distance = BuildSortHeader(display.DistanceHeader, display.DistanceSortDirection);
        Grid.SetColumn(distance, 1);
        grid.Children.Add(distance);

        var duration = HeaderText(display.DurationHeader);
        Grid.SetColumn(duration, 2);
        grid.Children.Add(duration);

        var battery = HeaderText(display.BatteryHeader);
        Grid.SetColumn(battery, 3);
        grid.Children.Add(battery);

        return new Border
        {
            Child = grid,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(0, 0, 0, 1),
            Padding = new Thickness(0, 0, 0, 8),
        };
    }

    private TsButton BuildSortHeader(string header, SortDirection direction)
    {
        string? glyph = direction switch
        {
            SortDirection.Ascending => SortAscendingGlyph,
            SortDirection.Descending => SortDescendingGlyph,
            _ => null,
        };

        var button = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            Text = header,
            IconGlyph = glyph,
            HorizontalAlignment = HorizontalAlignment.Left,
        };
        AutomationProperties.SetName(button, HeaderAutomationName(header, direction));
        button.Click += (_, _) => _viewModel.ToggleDistanceSort();
        return button;
    }

    private string HeaderAutomationName(string header, SortDirection direction)
    {
        string suffix = direction switch
        {
            SortDirection.Ascending => _localizer.GetString("a11y.sortedAscending", "sorted ascending"),
            SortDirection.Descending => _localizer.GetString("a11y.sortedDescending", "sorted descending"),
            _ => _localizer.GetString("a11y.sortableColumn", "sortable"),
        };
        return string.Create(CultureInfo.CurrentCulture, $"{header}, {suffix}");
    }

    private static Border BuildRow(RecentDriveRow row)
    {
        var grid = NewRowGrid();

        var date = new TsDateTime
        {
            Value = row.StartTs,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(date, 0);
        grid.Children.Add(date);

        var distance = CellText(row.DistanceText);
        Grid.SetColumn(distance, 1);
        grid.Children.Add(distance);

        var duration = CellText(row.DurationText);
        Grid.SetColumn(duration, 2);
        grid.Children.Add(duration);

        var battery = CellText(row.BatteryText);
        Grid.SetColumn(battery, 3);
        grid.Children.Add(battery);

        AutomationProperties.SetName(grid, row.AutomationName);
        AutomationProperties.SetAccessibilityView(grid, AccessibilityView.Content);

        return new Border
        {
            Child = grid,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(0, 0, 0, 1),
            Padding = new Thickness(0, 8, 0, 8),
        };
    }

    private TsPagination BuildPager(RecentDrivesSectionDisplay display)
    {
        var pager = new TsPagination
        {
            Page = display.Page,
            PageSize = display.PageSize,
            TotalItems = display.TotalCount,
            FirstLabel = display.FirstLabel,
            PreviousLabel = display.PreviousLabel,
            NextLabel = display.NextLabel,
            LastLabel = display.LastLabel,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        pager.PageChanged += (_, page) => _viewModel.GoToPage(page);
        return pager;
    }

    private void UpdateFreshness(RecentDrivesSectionState state)
    {
        bool showActions = state is not (RecentDrivesSectionState.Loading or RecentDrivesSectionState.Error);
        _freshness.Visibility = showActions ? Visibility.Visible : Visibility.Collapsed;
        _refresh.Visibility = showActions ? Visibility.Visible : Visibility.Collapsed;

        if (!showActions)
        {
            _freshnessChip.Visibility = Visibility.Collapsed;
            return;
        }

        bool offline = state == RecentDrivesSectionState.Offline;
        bool stale = state == RecentDrivesSectionState.Stale;
        if (stale || offline)
        {
            _freshnessChip.Visibility = Visibility.Visible;
            _freshnessChip.Status = offline ? StatusKind.Danger : StatusKind.Warning;
            _freshnessChipText.Text = offline ? _viewModel.OfflineChip : _viewModel.StaleChip;
            AutomationProperties.SetName(_freshnessChip, _freshnessChipText.Text);
        }
        else
        {
            _freshnessChip.Visibility = Visibility.Collapsed;
        }

        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = offline;
        _refresh.IsEnabled = !_viewModel.IsFetching;
        AutomationProperties.SetName(_refresh, _viewModel.RefreshLabel);
        ToolTipService.SetToolTip(_refresh, _viewModel.RefreshLabel);
    }

    private static Grid NewRowGrid()
    {
        var grid = new Grid { ColumnSpacing = 12 };
        foreach (var width in ColumnWidths)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = width });
        }

        return grid;
    }

    private static TextBlock HeaderText(string text) => new()
    {
        Text = text,
        FontFamily = TypographyTokens.Sans,
        FontSize = 12,
        FontWeight = FontWeights.Medium,
        Foreground = DisplayTokens.TextSecondary,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static TextBlock CellText(string text) => new()
    {
        Text = text,
        FontFamily = TypographyTokens.Sans,
        FontSize = 13,
        Foreground = DisplayTokens.TextPrimary,
        TextTrimming = TextTrimming.CharacterEllipsis,
        VerticalAlignment = VerticalAlignment.Center,
    };

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new RecentDrivesSectionAutomationPeer(this);

    private sealed class RecentDrivesSectionAutomationPeer(RecentDrivesSection owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((RecentDrivesSection)Owner).ViewModel.Title
                : name;
        }
    }
}
