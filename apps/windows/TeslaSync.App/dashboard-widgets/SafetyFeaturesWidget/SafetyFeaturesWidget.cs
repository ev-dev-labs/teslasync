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
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The native WinUI 3 Safety Features dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/SafetyFeaturesWidget.tsx. It mirrors the web <c>WidgetShell</c>
/// (a skeleton while loading, a retry surface on a hard failure, otherwise a Shield + "Safety Features"
/// freshness header above the body) and the component's compact / standard branch: at <c>cols ≤ 1</c> the
/// body is the centred active-feature count (the big number plus the "Active Features" caption); otherwise it
/// is the eight-cell ADAS status grid (Forward Collision Warning, Auto Emergency Braking, Lane Departure
/// Avoidance, Emergency Lane Departure, Blind Spot Camera, Blind Spot Collision Warning, Speed Limit Warning,
/// Cruise Follow Distance), each cell tinted by its ok / inactive / unknown status with a corner dot and the
/// resolved value. When the response carries no safety object a friendly "No safety data" empty state is shown
/// (the web <c>{data ? … : &lt;EmptyState&gt;}</c> gate). All data flows through the shared
/// <see cref="SafetyFeaturesViewModel"/>; the view never performs HTTP. Every string resolves through the i18n
/// facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class SafetyFeaturesWidget : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const double DotSize = 8;

    private readonly SafetyFeaturesViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly SafetyFeaturesDiagnostics _diagnostics;
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
    /// <param name="source">The cache-then-network ADAS source.</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="size">The widget footprint (registry metadata; drives the compact / grid layout).</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics sink.</param>
    public SafetyFeaturesWidget(
        ISafetyFeaturesSource source,
        ILocalizer localizer,
        SafetyFeaturesSize size,
        SafetyFeaturesDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new SafetyFeaturesDiagnostics();
        _viewModel = new SafetyFeaturesViewModel(source, localizer, size);
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

    /// <summary>The canonical registry id this surface registers under (<c>safety-features</c>).</summary>
    public static string RegistryId => SafetyFeaturesRegistration.Id;

    /// <summary>The widget footprint; reassigning re-projects the grid/count for the new layout.</summary>
    public SafetyFeaturesSize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="SafetyFeaturesSource"/> from the shared
    /// data layer (the dashboard host's P2-core dependencies), resolving the primary cached vehicle unless an
    /// explicit <paramref name="vehicleId"/> is supplied.
    /// </summary>
    public static SafetyFeaturesWidget Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        SafetyFeaturesSize? size = null,
        long? vehicleId = null,
        SafetyFeaturesDiagnostics? diagnostics = null)
    {
        var source = new SafetyFeaturesSource(vehicles, api, engine, options, vehicleId);
        return new SafetyFeaturesWidget(source, localizer, size ?? SafetyFeaturesRegistration.DefaultSize, diagnostics);
    }

    private void BuildChrome()
    {
        var icon = new FontIcon
        {
            Glyph = SafetyFeaturesProjection.ShieldGlyph,
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
        AutomationProperties.SetName(_refresh, _localizer.GetString("widget.safety.refresh", "Refresh safety features"));
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
            case SafetyFeaturesState.Loading:
                Content = BuildLoading();
                break;

            case SafetyFeaturesState.Error:
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
        // Web parity: the compact branch passes title={undefined} to WidgetShell, so the title is hidden.
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
            // Web parity: no safety object (data == null) renders the "No safety data" surface.
            return BuildEmpty();
        }

        return display.IsCompact ? BuildCompact(display) : BuildGrid(display);
    }

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = 12, Padding = new Thickness(16, 16, 16, 16) };
        column.Children.Add(new TsSkeleton { BlockHeight = 18, BlockWidth = 140, ReduceMotion = MotionPreference.ReduceMotion });
        column.Children.Add(new TsSkeleton { BlockHeight = 44, ReduceMotion = MotionPreference.ReduceMotion });
        column.Children.Add(new TsSkeleton { BlockHeight = 44, ReduceMotion = MotionPreference.ReduceMotion });

        AutomationProperties.SetName(column, _localizer.GetString("widget.safety.loading", "Loading safety features"));
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("widget.safety.error", "Couldn't load safety features"),
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
        IconGlyph = SafetyFeaturesProjection.ShieldGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    // ── Compact active-feature count (web isCompact branch) ──
    private static StackPanel BuildCompact(SafetyFeaturesDisplay display)
    {
        var count = new TextBlock
        {
            Text = display.ActiveCountText,
            FontSize = 30,
            FontWeight = FontWeights.Bold,
            Foreground = SuccessBrush(),
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
        };

        var label = new TextBlock
        {
            Text = display.ActiveFeaturesLabel,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
        };

        var column = new StackPanel
        {
            Spacing = 4,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        column.Children.Add(count);
        column.Children.Add(label);

        AutomationProperties.SetName(column, display.AutomationName);
        return column;
    }

    // ── Eight-cell ADAS status grid (web non-compact WidgetStatusGrid branch) ──
    private static Grid BuildGrid(SafetyFeaturesDisplay display)
    {
        int cols = display.GridColumns;
        int rows = (int)Math.Ceiling(display.Cells.Count / (double)cols);

        var grid = new Grid { ColumnSpacing = 8, RowSpacing = 8 };
        for (int c = 0; c < cols; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < display.Cells.Count; i++)
        {
            var tile = BuildCellTile(display.Cells[i]);
            Grid.SetColumn(tile, i % cols);
            Grid.SetRow(tile, i / cols);
            grid.Children.Add(tile);
        }

        AutomationProperties.SetName(grid, display.AutomationName);
        return grid;
    }

    // Web parity: WidgetStatusGrid cell — tinted rounded rect, corner status dot, label + value.
    private static Border BuildCellTile(SafetyCell cell)
    {
        var status = SafetyFeaturesProjection.ToStatusKind(cell.Status);

        var label = new TextBlock
        {
            Text = cell.Label,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        };

        var value = new TextBlock
        {
            Text = cell.Value,
            FontSize = 13,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        };

        var content = new StackPanel { Spacing = 2 };
        content.Children.Add(label);
        content.Children.Add(value);

        var dot = new Ellipse
        {
            Width = DotSize,
            Height = DotSize,
            Fill = DisplayTokens.Brush(StatusResources.AccentBrushKey(status)),
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
            BorderBrush = StatusTint(status, 0.25),
            Background = StatusTint(status, 0.10),
            Padding = new Thickness(12, 8, 12, 8),
        };
        AutomationProperties.SetName(tile, cell.AutomationName);
        return tile;
    }

    /// <summary>
    /// A themed semantic-status tint at the given alpha (web's <c>bg-{status}/10</c> / <c>border-{status}/20</c>):
    /// resolves the status colour token and applies <paramref name="opacity"/>, falling back to the muted
    /// surface tokens when a key is missing so light/dark/high-contrast all stay token-driven. The neutral
    /// inactive / unknown statuses use the muted surface (web's <c>bg-white/[0.03]</c>).
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
