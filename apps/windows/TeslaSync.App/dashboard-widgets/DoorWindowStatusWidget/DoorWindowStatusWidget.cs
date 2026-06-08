using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The native WinUI 3 Door &amp; Window Status dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/DoorWindowStatusWidget.tsx. It mirrors the web <c>WidgetShell</c>
/// (a skeleton while loading, a retry surface on error, otherwise the "🚪 Door &amp; Window Status" freshness
/// header above the body): when a security object resolves it renders, at the single 1×1 footprint, the two
/// summary badges (a success "Doors ✓" / warning "{n} door(s) open" chip and the matching windows chip) or,
/// at every larger footprint, the two sections — a "Doors" heading over a 2-column grid of four corner cells
/// and a "Windows" heading over its own four-cell grid, each cell tinted by its open/closed/partial/unknown
/// status with a corner dot and the localized value; when the response carries no security object, a friendly
/// "No door/window data" empty grid (the web <c>{securityData ? … : &lt;WidgetStatusGrid cells={[]} /&gt;}</c>
/// gate). All data flows through the shared <see cref="DoorWindowStatusViewModel"/>; the view never performs
/// HTTP. Every string resolves through the i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class DoorWindowStatusWidget : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const double DotSize = 8;

    private readonly DoorWindowStatusViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly DoorWindowStatusDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly ScrollViewer _bodyHost = new();
    private readonly Grid _header = new();
    private readonly StackPanel _titleRow = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 6,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TextBlock _titleText = new();
    private readonly TsDataFreshness _freshness = new();
    private readonly Button _refresh = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, footprint and diagnostics.</summary>
    /// <param name="source">The cache-then-network door/window source.</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="size">The widget footprint (registry metadata; drives the compact / grid layout).</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics sink.</param>
    public DoorWindowStatusWidget(
        IDoorWindowStatusSource source,
        ILocalizer localizer,
        DoorWindowStatusSize size,
        DoorWindowStatusDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new DoorWindowStatusDiagnostics();
        _viewModel = new DoorWindowStatusViewModel(source, localizer, size);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        BuildChrome();
        AutomationProperties.SetName(this, _viewModel.Title);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical registry id this surface registers under (<c>door-window-status</c>).</summary>
    public static string RegistryId => DoorWindowStatusRegistration.Id;

    /// <summary>The widget footprint; reassigning re-projects the grid/badges for the new layout.</summary>
    public DoorWindowStatusSize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="DoorWindowStatusSource"/> from the shared
    /// data layer (the dashboard host's P2-core dependencies), resolving the primary cached vehicle unless an
    /// explicit <paramref name="vehicleId"/> is supplied.
    /// </summary>
    public static DoorWindowStatusWidget Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        DoorWindowStatusSize? size = null,
        long? vehicleId = null,
        DoorWindowStatusDiagnostics? diagnostics = null)
    {
        var source = new DoorWindowStatusSource(vehicles, api, engine, options, vehicleId);
        return new DoorWindowStatusWidget(source, localizer, size ?? DoorWindowStatusRegistration.DefaultSize, diagnostics);
    }

    private void BuildChrome()
    {
        var icon = new FontIcon
        {
            Glyph = DoorWindowStatusProjection.DoorGlyph,
            FontSize = 14,
            Foreground = InfoBrush(),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        _titleText.Text = _viewModel.Title;
        _titleText.FontSize = 11;
        _titleText.FontWeight = FontWeights.Medium;
        _titleText.Foreground = DisplayTokens.TextMuted;
        _titleText.CharacterSpacing = 80;
        _titleText.VerticalAlignment = VerticalAlignment.Center;

        _titleRow.Children.Add(icon);
        _titleRow.Children.Add(_titleText);

        _refresh.Content = new FontIcon { Glyph = RefreshGlyph, FontSize = 12 };
        _refresh.Background = Transparent();
        _refresh.BorderThickness = new Thickness(0);
        _refresh.Padding = new Thickness(6, 2, 6, 2);
        _refresh.VerticalAlignment = VerticalAlignment.Center;
        AutomationProperties.SetName(_refresh, _localizer.GetString("widget.doorWindow.refresh", "Refresh door & window status"));
        _refresh.Click += OnRefreshClick;

        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        actions.Children.Add(_freshness);
        actions.Children.Add(_refresh);

        _header.Padding = new Thickness(16, 12, 12, 2);
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_titleRow, 0);
        Grid.SetColumn(actions, 1);
        _header.Children.Add(_titleRow);
        _header.Children.Add(actions);

        _bodyHost.VerticalScrollMode = ScrollMode.Auto;
        _bodyHost.VerticalScrollBarVisibility = ScrollBarVisibility.Auto;
        _bodyHost.HorizontalScrollMode = ScrollMode.Disabled;
        _bodyHost.HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled;
        _bodyHost.Padding = new Thickness(16, 4, 16, 12);

        _root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        _root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        Grid.SetRow(_header, 0);
        Grid.SetRow(_bodyHost, 1);
        _root.Children.Add(_header);
        _root.Children.Add(_bodyHost);
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

    /// <summary>Detach from the view-model and cancel any in-flight load (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnRefreshClick(object sender, RoutedEventArgs e) => _ = _viewModel.RetryAsync();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) => ScheduleRender();

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
        switch (_viewModel.State)
        {
            case DoorWindowStatusState.Loading:
                Content = BuildLoading();
                break;

            case DoorWindowStatusState.Error:
                Content = BuildError();
                break;

            default:
                UpdateHeader();
                _bodyHost.Content = BuildBody();
                Content = _root;
                break;
        }
    }

    private void UpdateHeader()
    {
        bool compact = _viewModel.Size.IsCompact;
        _titleRow.Visibility = compact ? Visibility.Collapsed : Visibility.Visible;
        _titleText.Text = _viewModel.Title;
        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
        _refresh.IsEnabled = !_viewModel.IsFetching;
    }

    private UIElement BuildBody()
    {
        if (_viewModel.Display is not { } display)
        {
            // Web parity: no security object (securityData == null) renders the "No door/window data" surface.
            return BuildEmpty();
        }

        return display.IsCompact ? BuildBadges(display) : BuildGrids(display);
    }

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = 12, Padding = new Thickness(16, 16, 16, 16) };
        column.Children.Add(new TsSkeleton { BlockHeight = 18, BlockWidth = 140, ReduceMotion = MotionPreference.ReduceMotion });
        column.Children.Add(new TsSkeleton { BlockHeight = 44, ReduceMotion = MotionPreference.ReduceMotion });
        column.Children.Add(new TsSkeleton { BlockHeight = 44, ReduceMotion = MotionPreference.ReduceMotion });

        AutomationProperties.SetName(column, _localizer.GetString("widget.doorWindow.loading", "Loading door & window status"));
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("widget.doorWindow.error", "Couldn't load door & window status"),
            ActionText = _localizer.GetString("common.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;
        return error;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = DoorWindowStatusProjection.DoorGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    // ── Compact badges (web isCompact branch) ──
    private static StackPanel BuildBadges(DoorWindowStatusDisplay display)
    {
        var column = new StackPanel
        {
            Spacing = 6,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        column.Children.Add(BuildBadge(display.DoorBadgeText, display.DoorBadgeStatus));
        column.Children.Add(BuildBadge(display.WindowBadgeText, display.WindowBadgeStatus));

        AutomationProperties.SetName(column, display.AutomationName);
        return column;
    }

    private static TsBadge BuildBadge(string text, StatusKind status)
    {
        var badge = new TsBadge
        {
            Status = status,
            Content = text,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(badge, text);
        return badge;
    }

    // ── Door + window grids (web non-compact branch) ──
    private static StackPanel BuildGrids(DoorWindowStatusDisplay display)
    {
        var column = new StackPanel
        {
            // Web parity: isTall → space-y-4 (16px), else space-y-2 (8px).
            Spacing = display.IsTall ? 16 : 8,
        };

        column.Children.Add(BuildSection(display.DoorsHeading, display.DoorCells));
        column.Children.Add(BuildSection(display.WindowsHeading, display.WindowCells));

        AutomationProperties.SetName(column, display.AutomationName);
        return column;
    }

    private static StackPanel BuildSection(string heading, IReadOnlyList<DoorWindowCell> cells)
    {
        var section = new StackPanel { Spacing = 6 };

        var headingText = new TextBlock
        {
            Text = heading.ToUpper(CultureInfo.CurrentCulture),
            FontSize = 11,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextMuted,
            CharacterSpacing = 80,
        };
        AutomationProperties.SetAccessibilityView(headingText, AccessibilityView.Raw);
        section.Children.Add(headingText);
        section.Children.Add(BuildCellGrid(cells));
        return section;
    }

    private static Grid BuildCellGrid(IReadOnlyList<DoorWindowCell> cells)
    {
        const int cols = 2;
        int rows = (int)Math.Ceiling(cells.Count / (double)cols);

        var grid = new Grid { ColumnSpacing = 8, RowSpacing = 8 };
        for (int c = 0; c < cols; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < cells.Count; i++)
        {
            var tile = BuildCellTile(cells[i]);
            Grid.SetColumn(tile, i % cols);
            Grid.SetRow(tile, i / cols);
            grid.Children.Add(tile);
        }

        return grid;
    }

    // Web parity: WidgetStatusGrid cell — tinted rounded rect, corner status dot, label + value.
    private static Border BuildCellTile(DoorWindowCell cell)
    {
        var label = new TextBlock
        {
            Text = cell.Label,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            TextTrimming = TextTrimming.CharacterEllipsis,
        };

        var value = new TextBlock
        {
            Text = cell.Value,
            FontSize = 13,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
        };

        var content = new StackPanel { Spacing = 2 };
        content.Children.Add(label);
        content.Children.Add(value);

        var dot = new Ellipse
        {
            Width = DotSize,
            Height = DotSize,
            Fill = DisplayTokens.Brush(StatusResources.AccentBrushKey(cell.Status)),
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Top,
            Margin = new Thickness(0, 2, 2, 0),
        };
        AutomationProperties.SetAccessibilityView(dot, AccessibilityView.Raw);

        var layout = new Grid();
        layout.Children.Add(content);
        layout.Children.Add(dot);

        var tile = new Border
        {
            Child = layout,
            MinHeight = 44,
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            BorderThickness = new Thickness(1),
            BorderBrush = StatusTint(cell.Status, 0.25),
            Background = StatusTint(cell.Status, 0.10),
            Padding = new Thickness(12, 8, 12, 8),
        };
        AutomationProperties.SetName(tile, cell.AutomationName);
        return tile;
    }

    /// <summary>
    /// A themed semantic-status tint at the given alpha (web's <c>bg-{status}/10</c> / <c>border-{status}/20</c>):
    /// resolves the status colour token and applies <paramref name="opacity"/>, falling back to the muted
    /// surface tokens when a key is missing so light/dark/high-contrast all stay token-driven.
    /// </summary>
    private static Brush StatusTint(StatusKind kind, double opacity)
    {
        if (Application.Current?.Resources is { } res &&
            res.TryGetValue(StatusResources.AccentColorKey(kind), out var value))
        {
            switch (value)
            {
                case Windows.UI.Color color:
                    return new SolidColorBrush(color) { Opacity = opacity };
                case SolidColorBrush brush:
                    return new SolidColorBrush(brush.Color) { Opacity = opacity };
            }
        }

        return kind == StatusKind.Neutral
            ? DisplayTokens.Surface
            : new SolidColorBrush(Microsoft.UI.Colors.Transparent);
    }

    private static Brush InfoBrush() => DisplayTokens.Brush(StatusResources.AccentBrushKey(StatusKind.Info));

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);
}
