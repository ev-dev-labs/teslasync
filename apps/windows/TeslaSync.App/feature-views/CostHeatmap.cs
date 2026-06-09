using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 Cost-Heatmap feature surface — a parity port of
/// web/src/features/charging/components/charging-list/CostHeatmap.tsx. It reproduces the web
/// <c>GlassPanel</c> with the clock-iconed "Charging Cost Heatmap" title wrapping a 7×24 cost grid (Sun..Sat
/// rows × hour 0..23 columns), each square tinted with the same cost-intensity / session-alpha colour the web
/// computes inline, the sparse hour labels (every third column), the per-day labels and the
/// Cheap → Expensive legend. The web component is a pure child of the charging-list optimizer section (the
/// parent only mounts it when there is data); the native surface binds its own cache-then-network
/// <see cref="CostHeatmapViewModel"/>, so it renders every state the P2 contract requires — the skeleton
/// while loading, a retry surface on a hard failure, a friendly empty state when the optimizer returned no
/// weekly entries, and a freshness chip (stale / offline) over the grid otherwise. The view never performs
/// HTTP. Every string resolves through the i18n facade and every cell carries a Narrator name.
/// </summary>
public sealed partial class CostHeatmap : ContentControl, IDisposable
{
    private const string ClockGlyph = "\uE121"; // Segoe Fluent — Clock (web lucide <Clock/>)
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const int FadeDelayMs = 270; // web OptimizerSection FadeIn delay={0.27}

    private const double CellSize = 20; // square cell (web aspect-square)
    private const double CellSpacing = 2; // web gap-0.5
    private const double CellRadius = 2; // web rounded-sm
    private const double DayLabelWidth = 40; // web w-10
    private const double SwatchSize = 12; // web legend w-3 h-3
    private const double SkeletonHeight = 190; // approximate grid footprint

    private readonly CostHeatmapViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly CostHeatmapDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;
    private readonly TsFadeIn _fade = new() { DelayMs = FadeDelayMs };

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer and (optional) diagnostics.</summary>
    public CostHeatmap(
        ICostHeatmapSource source,
        ILocalizer localizer,
        CostHeatmapDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new CostHeatmapDiagnostics();
        _viewModel = new CostHeatmapViewModel(source, localizer);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Content = _fade;
        AutomationProperties.SetName(this, _viewModel.Display.AriaLabel);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical surface id (<c>cost-heatmap</c>).</summary>
    public static string SurfaceId => CostHeatmapRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting/diagnostics).</summary>
    public CostHeatmapViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="CostHeatmapSource"/> from the shared
    /// data layer (the host's P2-core dependencies), resolving the primary cached vehicle unless an explicit
    /// <paramref name="vehicleId"/> is supplied.
    /// </summary>
    public static CostHeatmap Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        long? vehicleId = null,
        CostHeatmapDiagnostics? diagnostics = null)
    {
        var source = new CostHeatmapSource(vehicles, api, engine, options, vehicleId);
        return new CostHeatmap(source, localizer, diagnostics);
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
        AutomationProperties.SetName(this, display.AriaLabel);

        _fade.Content = _viewModel.State switch
        {
            CostHeatmapState.Loading => BuildLoading(display),
            CostHeatmapState.Error => BuildErrorSurface(),
            _ => BuildPanel(display),
        };
    }

    // ── Loading (skeleton chrome) ───────────────────────────────────────────────────────────────────────

    private TsGlassPanel BuildLoading(CostHeatmapDisplay display)
    {
        var content = new StackPanel { Spacing = 16 };
        content.Children.Add(BuildHeader(display, actions: null));
        content.Children.Add(new TsSkeleton
        {
            BlockHeight = SkeletonHeight,
            ReduceMotion = MotionPreference.ReduceMotion,
        });

        var panel = new TsGlassPanel { Padding = new Thickness(24), Content = content };
        LiveRegion.Configure(panel);
        LiveRegion.Announce(panel);
        AutomationProperties.SetName(
            panel,
            string.Format(
                CultureInfo.CurrentCulture,
                "{0}. {1}",
                display.Title,
                _localizer.GetString("common.loading", "Loading...")));
        return panel;
    }

    // ── Error surface (web QueryError) ──────────────────────────────────────────────────────────────────

    private TsGlassPanel BuildErrorSurface()
    {
        var error = new TsQueryError
        {
            Title = _localizer.GetString("charging.optimizer.heatmap", "Charging Cost Heatmap"),
            Message = _viewModel.ErrorMessage
                ?? _localizer.GetString("error.loadFailed", "Failed to load data"),
            ActionText = _localizer.GetString("common.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;

        var panel = new TsGlassPanel { Padding = new Thickness(24), Content = error };
        AutomationProperties.SetName(panel, error.Message);
        return panel;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    // ── Panel (Loaded / Empty / Stale / Offline) ────────────────────────────────────────────────────────

    private TsGlassPanel BuildPanel(CostHeatmapDisplay display)
    {
        var content = new StackPanel { Spacing = 16 };
        content.Children.Add(BuildHeader(display, BuildActions()));
        if (display.HasData)
        {
            content.Children.Add(BuildHeatmap(display));
        }
        else
        {
            // Web parity: the parent hides the heatmap with no data; the native surface shows a friendly
            // empty state instead of a blank panel.
            content.Children.Add(new TsEmptyState { Message = display.EmptyMessage });
        }

        var panel = new TsGlassPanel { Padding = new Thickness(24), Content = content };
        AutomationProperties.SetName(panel, display.AriaLabel);
        return panel;
    }

    // ── Header (clock icon + title + actions) ───────────────────────────────────────────────────────────

    private static Grid BuildHeader(CostHeatmapDisplay display, FrameworkElement? actions)
    {
        var header = new Grid();
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var titleRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        var icon = new FontIcon
        {
            Glyph = ClockGlyph,
            FontSize = 16,
            Foreground = DisplayTokens.Accent,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        titleRow.Children.Add(icon);
        titleRow.Children.Add(new PanelTitle { Value = display.Title, VerticalAlignment = VerticalAlignment.Center });
        Grid.SetColumn(titleRow, 0);
        header.Children.Add(titleRow);

        if (actions is not null)
        {
            Grid.SetColumn(actions, 1);
            header.Children.Add(actions);
        }

        return header;
    }

    private StackPanel BuildActions()
    {
        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };

        if (_viewModel.State is CostHeatmapState.Stale or CostHeatmapState.Offline)
        {
            actions.Children.Add(BuildFreshnessChip(_viewModel.State));
        }

        actions.Children.Add(new TsDataFreshness
        {
            UpdatedAt = _viewModel.UpdatedAt,
            IsFetching = _viewModel.IsFetching,
            IsError = _viewModel.State == CostHeatmapState.Offline,
            VerticalAlignment = VerticalAlignment.Center,
        });

        actions.Children.Add(BuildRefreshButton());
        return actions;
    }

    private TsBadge BuildFreshnessChip(CostHeatmapState state)
    {
        bool offline = state == CostHeatmapState.Offline;
        string text = offline
            ? _localizer.GetString("common.offline", "Offline")
            : _localizer.GetString("charging.curve.stale", "Stale");

        var badge = new TsBadge
        {
            Status = offline ? StatusKind.Danger : StatusKind.Warning,
            Content = new TextBlock { Text = text, FontSize = 12 },
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(badge, text);
        return badge;
    }

    private TsButton BuildRefreshButton()
    {
        var button = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            IconGlyph = RefreshGlyph,
            VerticalAlignment = VerticalAlignment.Center,
            IsEnabled = !_viewModel.IsFetching,
        };
        AutomationProperties.SetName(button, _localizer.GetString("common.refresh", "Refresh"));
        button.Click += OnRefreshClick;
        return button;
    }

    private void OnRefreshClick(object sender, RoutedEventArgs e) => _ = _viewModel.RetryAsync();

    // ── Heatmap grid (hour labels + day rows + legend) ──────────────────────────────────────────────────

    private static ScrollViewer BuildHeatmap(CostHeatmapDisplay display)
    {
        var grid = new StackPanel { Spacing = CellSpacing };
        grid.Children.Add(BuildHourLabels(display.HourLabels));
        foreach (var row in display.Rows)
        {
            grid.Children.Add(BuildDayRow(row));
        }

        grid.Children.Add(BuildLegend(display));

        var scroller = new ScrollViewer
        {
            HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Disabled,
            HorizontalScrollMode = ScrollMode.Auto,
            VerticalScrollMode = ScrollMode.Disabled,
            Content = grid,
        };
        AutomationProperties.SetName(scroller, display.AriaLabel);
        return scroller;
    }

    private static StackPanel BuildHourLabels(IReadOnlyList<string> hourLabels)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = CellSpacing };
        row.Children.Add(new Border { Width = DayLabelWidth }); // gutter aligning with the day-label column
        foreach (var label in hourLabels)
        {
            // Dense data-viz axis label (web text-[8px] muted); tinted via the muted token so theming holds.
            row.Children.Add(new TextBlock
            {
                Text = label,
                Width = CellSize,
                FontSize = 9,
                TextAlignment = TextAlignment.Center,
                Foreground = DisplayTokens.TextMuted,
            });
        }

        AutomationProperties.SetAccessibilityView(row, AccessibilityView.Raw);
        return row;
    }

    private static StackPanel BuildDayRow(CostHeatmapRow row)
    {
        var line = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = CellSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };
        line.Children.Add(new TextBlock
        {
            Text = row.DayLabel,
            Width = DayLabelWidth,
            FontSize = 10,
            TextAlignment = TextAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
            Foreground = DisplayTokens.TextMuted,
        });

        foreach (var cell in row.Cells)
        {
            line.Children.Add(BuildCell(cell));
        }

        return line;
    }

    private static Border BuildCell(CostHeatmapCell cell)
    {
        var fill = cell.Fill;
        var border = new Border
        {
            Width = CellSize,
            Height = CellSize,
            CornerRadius = new CornerRadius(CellRadius),
            Background = new SolidColorBrush(Windows.UI.Color.FromArgb(fill.AlphaByte, fill.R, fill.G, fill.B)),
        };

        ToolTipService.SetToolTip(border, cell.Tooltip);
        AutomationProperties.SetName(border, cell.Tooltip);
        if (!cell.HasSessions)
        {
            // Keep the dense empty cells out of the linear Narrator walk; the tooltip still serves hover.
            AutomationProperties.SetAccessibilityView(border, AccessibilityView.Raw);
        }

        return border;
    }

    private static StackPanel BuildLegend(CostHeatmapDisplay display)
    {
        var legend = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
        };

        legend.Children.Add(new Caption { Value = display.CheapLabel, VerticalAlignment = VerticalAlignment.Center });

        var swatches = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = CellSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };
        foreach (var swatch in display.LegendSwatches)
        {
            var box = new Border
            {
                Width = SwatchSize,
                Height = SwatchSize,
                CornerRadius = new CornerRadius(CellRadius),
                Background = new SolidColorBrush(
                    Windows.UI.Color.FromArgb(swatch.AlphaByte, swatch.R, swatch.G, swatch.B)),
            };
            AutomationProperties.SetAccessibilityView(box, AccessibilityView.Raw);
            swatches.Children.Add(box);
        }

        legend.Children.Add(swatches);
        legend.Children.Add(new Caption { Value = display.ExpensiveLabel, VerticalAlignment = VerticalAlignment.Center });
        return legend;
    }
}
