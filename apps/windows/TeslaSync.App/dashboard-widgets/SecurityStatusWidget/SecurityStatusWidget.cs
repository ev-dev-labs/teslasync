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
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The native WinUI 3 Security dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/SecurityStatusWidget.tsx. It mirrors the web <c>WidgetShell</c> used with
/// a title (a skeleton while loading, a retry surface on error, otherwise the "🛡 Security" freshness header
/// above the body): when a security object resolves it renders the web shared <c>WidgetStatusGrid</c> as a
/// two-column grid of four status cells — Lock (locked/unlocked), Sentry (active/off), Doors (all-closed / n
/// open) and Windows (all-closed / n open) — each tinted by its semantic status with a corner dot, the web
/// lucide icon and the localized value; when the response carries no security object, a friendly "No security
/// data" empty state (the web <c>{securityData ? … : empty}</c> gate). All data flows through the shared
/// <see cref="SecurityStatusViewModel"/>; the view never performs HTTP. Every string resolves through the i18n
/// facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class SecurityStatusWidget : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const double DotSize = 8;
    private const int GridColumns = 2;

    private readonly SecurityStatusViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly SecurityStatusDiagnostics _diagnostics;
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
    /// <param name="source">The cache-then-network security source.</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="size">The widget footprint (registry metadata).</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics sink.</param>
    public SecurityStatusWidget(
        ISecurityStatusSource source,
        ILocalizer localizer,
        SecurityStatusSize size,
        SecurityStatusDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new SecurityStatusDiagnostics();
        _viewModel = new SecurityStatusViewModel(source, localizer, size);
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

    /// <summary>The canonical registry id this surface registers under (<c>security-status</c>).</summary>
    public static string RegistryId => SecurityStatusRegistration.Id;

    /// <summary>The widget footprint (registry metadata; the surface renders identically at every size).</summary>
    public SecurityStatusSize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="SecurityStatusSource"/> from the shared
    /// data layer (the dashboard host's P2-core dependencies), resolving the primary cached vehicle unless an
    /// explicit <paramref name="vehicleId"/> is supplied.
    /// </summary>
    public static SecurityStatusWidget Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        SecurityStatusSize? size = null,
        long? vehicleId = null,
        SecurityStatusDiagnostics? diagnostics = null)
    {
        var source = new SecurityStatusSource(vehicles, api, engine, options, vehicleId);
        return new SecurityStatusWidget(source, localizer, size ?? SecurityStatusRegistration.DefaultSize, diagnostics);
    }

    private void BuildChrome()
    {
        var icon = new FontIcon
        {
            Glyph = SecurityStatusProjection.ShieldGlyph,
            FontSize = 14,
            Foreground = SuccessBrush(),
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
        AutomationProperties.SetName(_refresh, _localizer.GetString("widget.securityStatus.refresh", "Refresh security status"));
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
            case SecurityStatusState.Loading:
                Content = BuildLoading();
                break;

            case SecurityStatusState.Error:
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
            // Web parity: no security object (securityData == null) renders the "No security data" surface.
            return BuildEmpty();
        }

        return BuildStatusGrid(display);
    }

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = 12, Padding = new Thickness(16, 16, 16, 16) };
        column.Children.Add(new TsSkeleton { BlockHeight = 18, BlockWidth = 120, ReduceMotion = MotionPreference.ReduceMotion });
        column.Children.Add(new TsSkeleton { BlockHeight = 44, ReduceMotion = MotionPreference.ReduceMotion });
        column.Children.Add(new TsSkeleton { BlockHeight = 44, ReduceMotion = MotionPreference.ReduceMotion });

        AutomationProperties.SetName(column, _localizer.GetString("widget.securityStatus.loading", "Loading security status"));
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("widget.securityStatus.error", "Couldn't load security status"),
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
        IconGlyph = SecurityStatusProjection.ShieldGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    // ── Status grid (web WidgetStatusGrid cols={2}) ──
    private static Grid BuildStatusGrid(SecurityStatusDisplay display)
    {
        var cells = display.Cells;
        int rows = (int)Math.Ceiling(cells.Count / (double)GridColumns);

        var grid = new Grid { ColumnSpacing = 8, RowSpacing = 8, VerticalAlignment = VerticalAlignment.Center };
        for (int c = 0; c < GridColumns; c++)
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
            Grid.SetColumn(tile, i % GridColumns);
            Grid.SetRow(tile, i / GridColumns);
            grid.Children.Add(tile);
        }

        AutomationProperties.SetName(grid, display.AutomationName);
        return grid;
    }

    // Web parity: WidgetStatusGrid cell — tinted rounded rect, corner status dot, leading icon, label + value.
    private static Border BuildCellTile(SecurityStatusCell cell)
    {
        var icon = new FontIcon
        {
            Glyph = cell.IconGlyph,
            FontSize = 14,
            Foreground = DisplayTokens.TextSecondary,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

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

        var stack = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        stack.Children.Add(label);
        stack.Children.Add(value);

        // Web parity: leading icon (auto) + flexible label/value column; right margin keeps text clear of the dot.
        var content = new Grid { ColumnSpacing = 8, Margin = new Thickness(0, 0, 12, 0), VerticalAlignment = VerticalAlignment.Center };
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetColumn(icon, 0);
        Grid.SetColumn(stack, 1);
        content.Children.Add(icon);
        content.Children.Add(stack);

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

    private static Brush SuccessBrush() => DisplayTokens.Brush(StatusResources.AccentBrushKey(StatusKind.Success));

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);
}
