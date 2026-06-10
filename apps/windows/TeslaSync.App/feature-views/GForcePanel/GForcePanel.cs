using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
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
/// The native WinUI 3 Acceleration-G-Force feature surface — a parity port of
/// web/src/features/driving/components/driving-dynamics/GForcePanel.tsx. It reproduces the web
/// <c>GlassPanel</c> wrapper (the "Acceleration G-Force" header) over the responsive three-up stat grid (web
/// <c>cols={{ default: 1, sm: 3 }}</c>) of Lateral, Longitudinal and Combined tiles — each a
/// <see cref="TsStatCard"/> (the native counterpart of the web <c>StatCard</c>) with the Gauge glyph, its
/// label, and the <c>fmtNumber(_, 2)</c> value plus the <c>g</c> unit (or the em-dash when an axis has not yet
/// reported). The web component is a thin reader of the <c>useDriveDynamicsLatest</c> snapshot; the native
/// surface binds its own cache-then-network <see cref="GForcePanelViewModel"/>, so it renders every state the
/// P2 contract requires — the skeleton while loading, a retry surface on a hard failure, the friendly empty
/// state when no acceleration axis has reported (web parity), and a freshness chip (stale / offline) over the
/// tiles otherwise. The view never performs HTTP. Every string resolves through the i18n facade and every
/// interactive element carries a Narrator name.
/// </summary>
public sealed partial class GForcePanel : ContentControl, IDisposable
{
    private const string GaugeGlyph = "\uE9D9"; // Segoe Fluent — Speedometer (web lucide Gauge)
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const int FadeDelayMs = 50;          // web FadeIn delay={0.05}
    private const double OuterPadding = 24;       // web p-6
    private const double SectionSpacing = 16;     // web mb-4
    private const double GridGap = 16;            // web gap-4
    private const double SmBreakpoint = 640;      // web sm: breakpoint (default:1 → sm:3)
    private const int WideColumns = 3;            // web sm:3
    private const int NarrowColumns = 1;          // web default:1
    private const double SkeletonIconSize = 16;

    private readonly GForcePanelViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly GForcePanelDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;
    private readonly TsFadeIn _fade = new() { DelayMs = FadeDelayMs };

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;
    private int _columns = WideColumns;

    /// <summary>Creates the surface over its data source, localizer and (optional) diagnostics/clock.</summary>
    public GForcePanel(
        IGForcePanelSource source,
        ILocalizer localizer,
        GForcePanelDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new GForcePanelDiagnostics();
        _viewModel = new GForcePanelViewModel(source, localizer, clock);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Content = _fade;
        AutomationProperties.SetName(this, _viewModel.Display.AriaLabel);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        SizeChanged += OnSizeChanged;
        Render();
    }

    /// <summary>The canonical surface id (<c>g-force-panel</c>).</summary>
    public static string SurfaceId => GForcePanelRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting/diagnostics).</summary>
    public GForcePanelViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="GForcePanelSource"/> from the shared
    /// data layer (the host's P2-core dependencies), resolving the primary cached vehicle unless an explicit
    /// <paramref name="vehicleId"/> is supplied.
    /// </summary>
    public static GForcePanel Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        long? vehicleId = null,
        GForcePanelDiagnostics? diagnostics = null)
    {
        var source = new GForcePanelSource(vehicles, api, engine, options, vehicleId);
        return new GForcePanel(source, localizer, diagnostics);
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

    private void OnSizeChanged(object sender, SizeChangedEventArgs e)
    {
        int desired = e.NewSize.Width >= SmBreakpoint ? WideColumns : NarrowColumns;
        if (desired != _columns)
        {
            _columns = desired;
            Render();
        }
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
            GForcePanelState.Loading => BuildLoading(display),
            GForcePanelState.Error => BuildErrorSurface(display),
            _ => BuildPanel(display),
        };
    }

    // ── Loaded / Empty / Stale / Offline (the GlassPanel composition) ───────────────────────────────────

    private TsGlassPanel BuildPanel(GForcePanelDisplay display)
    {
        var column = new StackPanel { Spacing = SectionSpacing };
        column.Children.Add(BuildHeader(display));

        if (display.HasData)
        {
            column.Children.Add(BuildMetricsGrid(display.Metrics));
        }
        else
        {
            column.Children.Add(new TsEmptyState
            {
                IconGlyph = GaugeGlyph,
                Message = display.EmptyMessage,
                HorizontalAlignment = HorizontalAlignment.Center,
            });
        }

        var panel = new TsGlassPanel { Padding = new Thickness(OuterPadding), Content = column };
        AutomationProperties.SetName(panel, display.AriaLabel);
        return panel;
    }

    private Grid BuildHeader(GForcePanelDisplay display)
    {
        var header = new Grid { ColumnSpacing = 12, VerticalAlignment = VerticalAlignment.Center };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var title = new PanelTitle { Value = display.Title, VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(title, 0);
        header.Children.Add(title);

        var actions = BuildActions();
        Grid.SetColumn(actions, 1);
        header.Children.Add(actions);

        return header;
    }

    private Grid BuildMetricsGrid(IReadOnlyList<GForceMetric> metrics)
    {
        int columns = Math.Max(1, _columns);
        int rows = (metrics.Count + columns - 1) / columns;

        var grid = new Grid { ColumnSpacing = GridGap, RowSpacing = GridGap };
        for (int c = 0; c < columns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < metrics.Count; i++)
        {
            var card = BuildStatCard(metrics[i]);
            Grid.SetColumn(card, i % columns);
            Grid.SetRow(card, i / columns);
            grid.Children.Add(card);
        }

        return grid;
    }

    private static TsStatCard BuildStatCard(GForceMetric metric)
    {
        var card = new TsStatCard
        {
            Glyph = GaugeGlyph,
            Label = metric.Label,
            Value = metric.ValueWithUnit,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };
        AutomationProperties.SetName(card, metric.AutomationName);
        return card;
    }

    // ── Header actions (freshness chip + freshness + refresh) ───────────────────────────────────────────

    private StackPanel BuildActions()
    {
        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };

        if (_viewModel.State is GForcePanelState.Stale or GForcePanelState.Offline)
        {
            actions.Children.Add(BuildFreshnessChip(_viewModel.State));
        }

        actions.Children.Add(new TsDataFreshness
        {
            UpdatedAt = _viewModel.UpdatedAt,
            IsFetching = _viewModel.IsFetching,
            IsError = _viewModel.State == GForcePanelState.Offline,
            VerticalAlignment = VerticalAlignment.Center,
        });

        actions.Children.Add(BuildRefreshButton());
        return actions;
    }

    private TsBadge BuildFreshnessChip(GForcePanelState state)
    {
        bool offline = state == GForcePanelState.Offline;
        string text = offline
            ? _localizer.GetString("common.offline", "Offline")
            : _localizer.GetString("common.stale", "Stale");

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

    // ── Loading (skeleton chrome) ───────────────────────────────────────────────────────────────────────

    private TsGlassPanel BuildLoading(GForcePanelDisplay display)
    {
        var column = new StackPanel { Spacing = SectionSpacing };

        var header = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        header.Children.Add(new TsSkeleton
        {
            BlockWidth = SkeletonIconSize,
            BlockHeight = SkeletonIconSize,
            Radius = 6,
            ReduceMotion = MotionPreference.ReduceMotion,
        });
        header.Children.Add(new TsSkeleton
        {
            BlockWidth = 200,
            BlockHeight = 16,
            ReduceMotion = MotionPreference.ReduceMotion,
        });
        column.Children.Add(header);
        column.Children.Add(new TsStatGridSkeleton(WideColumns));

        var panel = new TsGlassPanel { Padding = new Thickness(OuterPadding), Content = column };
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

    private TsGlassPanel BuildErrorSurface(GForcePanelDisplay display)
    {
        var error = new TsQueryError
        {
            Title = display.Title,
            Message = _viewModel.ErrorMessage
                ?? _localizer.GetString("dynamics.gForceError", "Couldn't load G-force telemetry"),
            ActionText = _localizer.GetString("common.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;

        var panel = new TsGlassPanel { Padding = new Thickness(OuterPadding), Content = error };
        AutomationProperties.SetName(panel, error.Message);
        return panel;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();
}
