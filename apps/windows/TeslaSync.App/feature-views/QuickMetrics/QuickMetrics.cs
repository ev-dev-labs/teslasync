using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
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
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 QuickMetrics surface — a parity port of
/// web/src/features/charging/components/charging-list/QuickMetrics.tsx. It reproduces the web's single glass
/// panel holding a responsive, centred grid of six metric cells (Home / Supercharger / DC Fast session counts,
/// each with a leading glyph and a semantic accent colour, plus Total Time, Monthly Avg and Per Session), and —
/// when there is nothing to show — the web's in-panel empty state ("No charging metrics available yet"). The web
/// component is presentational (its parent <c>ChargingListPage</c> owns the charging-sessions query and passes
/// <c>computeStats(sessions)</c> down); this self-contained surface additionally renders the query lifecycle as
/// explicit loading (skeleton chrome), whole-surface empty, stale (chip), offline (chip) and hard-error
/// (QueryError + retry) branches — no surface is ever hidden. All data flows through the shared
/// <see cref="QuickMetricsViewModel"/>; the view never performs HTTP. The grid reflows to 2 / 3 / 6 columns with
/// width (web <c>grid-cols-2 sm:grid-cols-3 md:grid-cols-6</c>). Every string resolves through the i18n facade,
/// each cell and the panel carry a Narrator name, and state changes are announced through a polite live region.
/// The three count cells (web <c>&lt;AnimatedNumber/&gt;</c>) render their resolved value directly; the surface
/// adds no custom motion, so reduced-motion is honoured by construction.
/// </summary>
public sealed partial class QuickMetrics : ContentControl, IDisposable
{
    private const double PanelPadding = 20;
    private const double CellGap = 16;
    private const double ValueFontSize = 18;   // web text-lg
    private const double LabelFontSize = 11;   // web text-[10px]
    private const double GlyphFontSize = 12;   // web h-3 w-3
    private const double TwoColumnMaxWidth = 520;   // below → 2 cols (web base grid-cols-2)
    private const double ThreeColumnMaxWidth = 760; // below → 3 cols (web sm:); at/above → 6 (web md:)
    private const int FullColumns = 6;
    private const int MetricCount = 6;

    private readonly QuickMetricsViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly QuickMetricsDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _root = new() { Spacing = 8 };
    private readonly StackPanel _statusRow = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 8,
        HorizontalAlignment = HorizontalAlignment.Right,
        VerticalAlignment = VerticalAlignment.Center,
    };
    private readonly ContentControl _bodyHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };
    private readonly TsDataFreshness _freshness = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsQueryError _queryError = new();
    private readonly Caption _statusLine = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;
    private string? _announced;
    private int _columns = FullColumns;

    /// <summary>Creates the surface over its data source, localizer, diagnostics and currency symbol.</summary>
    /// <param name="source">The cache-then-network data port (P1/S8 state-holder seam).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    /// <param name="currencySymbol">The currency symbol (web <c>settings.currency_symbol</c>; default "$").</param>
    public QuickMetrics(
        IQuickMetricsSource source,
        ILocalizer localizer,
        QuickMetricsDiagnostics? diagnostics = null,
        string? currencySymbol = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new QuickMetricsDiagnostics();
        _viewModel = new QuickMetricsViewModel(source, localizer, currencySymbol);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        BuildChrome();
        AutomationProperties.SetName(this, _viewModel.SurfaceTitle);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        _queryError.ActionInvoked += OnRetryInvoked;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        SizeChanged += OnSizeChanged;
        Render();
    }

    /// <summary>The diagnostics surface slug this view registers under (<c>QuickMetrics</c>).</summary>
    public static string Slug => QuickMetricsRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting/diagnostics).</summary>
    public QuickMetricsViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="QuickMetricsSource"/> from the shared data
    /// layer (the host's P2-core dependencies).
    /// </summary>
    public static QuickMetrics Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        QuickMetricsDiagnostics? diagnostics = null,
        string? currencySymbol = null,
        long? vehicleId = null)
    {
        var source = new QuickMetricsSource(vehicles, api, engine, options, vehicleId);
        return new QuickMetrics(source, localizer, diagnostics, currencySymbol);
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _queryError.ActionInvoked -= OnRetryInvoked;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        SizeChanged -= OnSizeChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void BuildChrome()
    {
        _statusLine.Visibility = Visibility.Collapsed;
        LiveRegion.Configure(_statusLine);

        _root.Children.Add(_statusRow);
        _root.Children.Add(_bodyHost);
        _root.Children.Add(_statusLine);
        Content = _root;
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

    private void OnRetryInvoked(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        ScheduleRender();

    private void OnSizeChanged(object sender, SizeChangedEventArgs e)
    {
        int desired = ColumnsForWidth(e.NewSize.Width);
        if (desired != _columns)
        {
            _columns = desired;
            ScheduleRender();
        }
    }

    private static int ColumnsForWidth(double width) => width switch
    {
        // web: grid-cols-2 sm:grid-cols-3 md:grid-cols-6.
        <= 0 => FullColumns,
        < TwoColumnMaxWidth => 2,
        < ThreeColumnMaxWidth => 3,
        _ => FullColumns,
    };

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
        BuildStatusRow();

        _bodyHost.Content = _viewModel.State switch
        {
            QuickMetricsState.Loading => BuildLoadingScaffold(),
            QuickMetricsState.Error => BuildErrorBody(),
            QuickMetricsState.Empty => BuildEmptyBody(),
            _ => BuildContent(_viewModel.Display),
        };

        UpdateStatusLine();
        AutomationProperties.SetName(this, _viewModel.SurfaceTitle);
    }

    // ── Status row: stale / offline chip + freshness ─────────────────────────────────────────────────
    private void BuildStatusRow()
    {
        _statusRow.Children.Clear();

        switch (_viewModel.State)
        {
            case QuickMetricsState.Stale:
                _statusRow.Children.Add(BuildBadge(_viewModel.StaleLabel, StatusKind.Warning));
                break;
            case QuickMetricsState.Offline:
                _statusRow.Children.Add(BuildBadge(_viewModel.OfflineLabel, StatusKind.Danger));
                break;
            default:
                break;
        }

        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
        _statusRow.Children.Add(_freshness);
    }

    private void UpdateStatusLine()
    {
        string? message = _viewModel.StatusAnnouncement;
        if (string.IsNullOrEmpty(message))
        {
            _statusLine.Visibility = Visibility.Collapsed;
            _announced = null;
            return;
        }

        _statusLine.Value = message;
        _statusLine.Visibility = Visibility.Visible;
        AutomationProperties.SetName(_statusLine, message);

        if (!string.Equals(_announced, message, StringComparison.Ordinal))
        {
            _announced = message;
            LiveRegion.Announce(_statusLine);
        }
    }

    // ── Error (web parent's QueryError) ──────────────────────────────────────────────────────────────
    private TsQueryError BuildErrorBody()
    {
        _queryError.Message = _viewModel.ErrorMessage ?? QuickMetricsRegistration.ErrorText(_localizer);
        _queryError.ActionText = _viewModel.RetryLabel;
        _queryError.AttemptCount = _viewModel.Attempts;
        return _queryError;
    }

    // ── Whole-surface empty (web <GlassPanel><EmptyState/></GlassPanel>) ─────────────────────────────
    private TsGlassPanel BuildEmptyBody()
    {
        var empty = new TsEmptyState
        {
            Message = _viewModel.EmptyText,
            VerticalAlignment = VerticalAlignment.Center,
        };
        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = empty };
        AutomationProperties.SetName(panel, _viewModel.SurfaceTitle);
        return panel;
    }

    // ── Loading: skeleton tiles inside the panel ─────────────────────────────────────────────────────
    private TsGlassPanel BuildLoadingScaffold()
    {
        var grid = BuildGrid(MetricCount);
        for (int i = 0; i < MetricCount; i++)
        {
            var tile = new TsSkeleton
            {
                BlockHeight = 44,
                ReduceMotion = MotionPreference.ReduceMotion,
                HorizontalAlignment = HorizontalAlignment.Stretch,
            };
            Place(grid, tile, i);
        }

        AutomationProperties.SetName(grid, QuickMetricsRegistration.LoadingLabel(_localizer));
        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = grid };
    }

    // ── Ready / Stale / Offline: the six-metric grid ─────────────────────────────────────────────────
    private TsGlassPanel BuildContent(QuickMetricsDisplay display)
    {
        var grid = BuildGrid(display.Metrics.Count);
        for (int i = 0; i < display.Metrics.Count; i++)
        {
            Place(grid, BuildCell(display.Metrics[i]), i);
        }

        AutomationProperties.SetName(grid, _viewModel.SurfaceTitle);
        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = grid };
        AutomationProperties.SetName(panel, _viewModel.SurfaceTitle);
        return panel;
    }

    private Grid BuildGrid(int count)
    {
        int columns = Math.Max(1, _columns);
        var grid = new Grid { ColumnSpacing = CellGap, RowSpacing = CellGap };
        for (int c = 0; c < columns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        int rows = (int)Math.Ceiling(Math.Max(count, 1) / (double)columns);
        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        return grid;
    }

    private void Place(Grid grid, FrameworkElement element, int index)
    {
        int columns = Math.Max(1, _columns);
        Grid.SetColumn(element, index % columns);
        Grid.SetRow(element, index / columns);
        grid.Children.Add(element);
    }

    // ── One centred metric cell (value over icon+label) ──────────────────────────────────────────────
    private static StackPanel BuildCell(QuickMetricsMetric metric)
    {
        var cell = new StackPanel
        {
            Spacing = 2,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Top,
        };

        cell.Children.Add(BuildValue(metric));
        cell.Children.Add(BuildLabel(metric));

        AutomationProperties.SetName(cell, metric.AutomationName);
        return cell;
    }

    private static TextBlock BuildValue(QuickMetricsMetric metric)
    {
        Brush brush = metric.Accent is { } kind
            ? DisplayTokens.Brush(StatusResources.AccentBrushKey(kind))
            : DisplayTokens.TextPrimary;

        var value = new TextBlock
        {
            Text = metric.ValueText,
            FontSize = ValueFontSize,
            FontWeight = FontWeights.Bold,
            Foreground = brush,
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
        };
        AutomationProperties.SetAccessibilityView(value, AccessibilityView.Raw);
        return value;
    }

    private static StackPanel BuildLabel(QuickMetricsMetric metric)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 4,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        if (!string.IsNullOrEmpty(metric.Glyph))
        {
            row.Children.Add(new FontIcon
            {
                Glyph = metric.Glyph,
                FontSize = GlyphFontSize,
                Foreground = DisplayTokens.TextMuted,
                VerticalAlignment = VerticalAlignment.Center,
            });
        }

        row.Children.Add(new TextBlock
        {
            Text = metric.Label,
            FontSize = LabelFontSize,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
            TextAlignment = TextAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
        });

        AutomationProperties.SetAccessibilityView(row, AccessibilityView.Raw);
        return row;
    }

    private static TsBadge BuildBadge(string text, StatusKind kind)
    {
        var badge = new TsBadge
        {
            Status = kind,
            Content = new TextBlock { Text = text, FontSize = 12 },
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(badge, text);
        return badge;
    }
}
