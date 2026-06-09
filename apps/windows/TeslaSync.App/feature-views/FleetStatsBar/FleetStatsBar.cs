using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 Fleet-stats bar surface — a parity port of
/// web/src/features/dashboard/components/FleetStatsBar.tsx. It renders the web's five always-visible stat
/// panels in a responsive 2 / 3 / 4 / 5-column grid (the web <c>grid-cols-2 sm:grid-cols-3 md:grid-cols-4
/// lg:grid-cols-5</c>): the fleet size (with an "{n} online" caption), the 30-day distance (with a sparkline
/// of recent drive distances), the 30-day energy (with a sparkline of recent charge energies), the
/// fleet-average efficiency, and the unread-alert count. Each panel is a glass card with a label, a
/// count-up value plus optional unit suffix, and either a mini chart or a small caption — the native analogue
/// of the web <see cref="TsGlassPanel"/> + <c>AnimatedNumber</c> + <c>MiniChart</c> composition. Every state
/// renders: the per-panel skeletons while loading, the populated grid (zeroed panels when the fleet has no
/// data, the web <c>?? 0</c>), an explicit retry surface on hard failure, plus stale and offline freshness
/// chips over the grid. All data flows through the shared <see cref="FleetStatsBarViewModel"/>; the view never
/// performs HTTP. Every string resolves through the i18n facade and the surface carries a Narrator name.
/// </summary>
public sealed partial class FleetStatsBar : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const int FadeDelayMs = 50;           // web FadeIn-style entrance
    private const double PanelPadding = 14;        // web GlassPanel p-3/p-4
    private const double PanelSpacing = 4;         // web space between label / value / sub
    private const double GridGap = 12;             // web gap-2 sm:gap-3
    private const double SkeletonValueWidth = 72;
    private const double SkeletonValueHeight = 26;
    private const double SkeletonSubWidth = 56;
    private const double SkeletonSubHeight = 14;
    private const double SparklineWidth = 72;
    private const double SparklineHeight = 28;
    private const double NarrowBreakpoint = 520;
    private const double MediumBreakpoint = 760;
    private const double WideBreakpoint = 1000;
    private const int MaxColumns = 5;

    private readonly FleetStatsBarViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly FleetStatsBarDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly StackPanel _header = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 8,
        HorizontalAlignment = HorizontalAlignment.Right,
        Padding = new Thickness(0, 0, 0, 8),
    };

    private readonly TsDataFreshness _freshness = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsFadeIn _body = new() { DelayMs = FadeDelayMs };

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, unit preference and (optional) diagnostics.</summary>
    /// <param name="source">The cache-then-network fleet-stats source.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="units">The user's display-unit preference (web <c>useUnits().unitPrefs</c>); null = metric.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public FleetStatsBar(
        IFleetStatsBarSource source,
        ILocalizer localizer,
        UnitPref? units = null,
        FleetStatsBarDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new FleetStatsBarDiagnostics();
        _viewModel = new FleetStatsBarViewModel(source, localizer, units);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        AutomationProperties.SetName(this, _viewModel.Display.AutomationName);

        BuildChrome();

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        SizeChanged += OnSizeChanged;
        Render();
    }

    /// <summary>The canonical surface id (<c>fleet-stats-bar</c>).</summary>
    public static string SurfaceId => FleetStatsBarRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public FleetStatsBarViewModel ViewModel => _viewModel;

    /// <summary>The display-unit preference; reassigning re-projects the current snapshot at the new units.</summary>
    public UnitPref Units
    {
        get => _viewModel.Units;
        set => _viewModel.Units = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="FleetStatsBarSource"/> from the shared
    /// data layer (the host's P2-core dependencies).
    /// </summary>
    public static FleetStatsBar Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        UnitPref? units = null,
        FleetStatsBarDiagnostics? diagnostics = null)
    {
        var source = new FleetStatsBarSource(api, engine, options);
        return new FleetStatsBar(source, localizer, units, diagnostics);
    }

    private void BuildChrome()
    {
        // The web bar is headerless; the native superset adds a right-aligned freshness row so the mandated
        // stale / offline / refreshing states have a visible affordance above the always-fading panel grid.
        _root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        _root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        Grid.SetRow(_header, 0);
        Grid.SetRow(_body, 1);
        _root.Children.Add(_header);
        _root.Children.Add(_body);
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

    private void OnSizeChanged(object sender, SizeChangedEventArgs e)
    {
        if (e.PreviousSize.Width != e.NewSize.Width && IsGridState(_viewModel.State))
        {
            ScheduleRender();
        }
    }

    /// <summary>Detach from the view-model and cancel any in-flight load (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        SizeChanged -= OnSizeChanged;
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
        AutomationProperties.SetName(this, display.AutomationName);

        switch (_viewModel.State)
        {
            case FleetStatsBarState.Loading:
                Content = BuildLoading(display);
                break;

            case FleetStatsBarState.Error:
                Content = BuildError();
                break;

            default:
                UpdateHeader();
                _body.Content = BuildGrid(display, loading: false);
                Content = _root;
                break;
        }
    }

    // ── Header (freshness chip + stale/offline badge + refresh) ───────────────────────────────────────

    private void UpdateHeader()
    {
        _header.Children.Clear();

        if (_viewModel.State is FleetStatsBarState.Stale or FleetStatsBarState.Offline)
        {
            _header.Children.Add(BuildFreshnessChip(_viewModel.State));
        }

        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.State == FleetStatsBarState.Offline;
        _header.Children.Add(_freshness);

        _header.Children.Add(BuildRefreshButton());
    }

    private TsBadge BuildFreshnessChip(FleetStatsBarState state)
    {
        bool offline = state == FleetStatsBarState.Offline;
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

    // ── Panel grid ────────────────────────────────────────────────────────────────────────────────────

    private Grid BuildGrid(FleetStatsBarDisplay display, bool loading)
    {
        int columns = ColumnsForWidth(AvailableWidth());
        var grid = new Grid { ColumnSpacing = GridGap, RowSpacing = GridGap };
        for (int c = 0; c < columns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        int rows = (int)Math.Ceiling(display.Panels.Count / (double)columns);
        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < display.Panels.Count; i++)
        {
            var panel = BuildPanel(display.Panels[i], loading);
            Grid.SetColumn(panel, i % columns);
            Grid.SetRow(panel, i / columns);
            grid.Children.Add(panel);
        }

        return grid;
    }

    private TsGlassPanel BuildPanel(FleetStatPanel panel, bool loading)
    {
        var column = new StackPanel
        {
            Spacing = PanelSpacing,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        // web metric-label: small muted label above the value.
        column.Children.Add(new MetricLabel
        {
            Value = panel.Label,
            HorizontalAlignment = HorizontalAlignment.Center,
        });

        if (loading)
        {
            column.Children.Add(new TsSkeleton
            {
                BlockWidth = SkeletonValueWidth,
                BlockHeight = SkeletonValueHeight,
                HorizontalAlignment = HorizontalAlignment.Center,
            });
            column.Children.Add(new TsSkeleton
            {
                BlockWidth = SkeletonSubWidth,
                BlockHeight = SkeletonSubHeight,
                HorizontalAlignment = HorizontalAlignment.Center,
            });
        }
        else
        {
            column.Children.Add(new TsAnimatedNumber
            {
                Value = panel.Value,
                Precision = panel.Precision,
                Suffix = panel.Suffix ?? string.Empty,
                ReduceMotion = MotionPreference.ReduceMotion,
                HorizontalAlignment = HorizontalAlignment.Center,
            });

            column.Children.Add(BuildPanelFooter(panel));
        }

        var glass = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
        AutomationProperties.SetName(
            glass,
            loading
                ? string.Format(
                    CultureInfo.CurrentCulture,
                    "{0}: {1}",
                    panel.Label,
                    _localizer.GetString("common.loading", "Loading..."))
                : panel.AutomationName);
        AutomationProperties.SetAccessibilityView(glass, AccessibilityView.Content);
        return glass;
    }

    private static UIElement BuildPanelFooter(FleetStatPanel panel)
    {
        if (panel.Chart is { } series)
        {
            var chart = new TsMiniChart
            {
                Series = series,
                MinHeight = SparklineHeight,
                Height = SparklineHeight,
                Width = SparklineWidth,
                HorizontalAlignment = HorizontalAlignment.Center,
                Margin = new Thickness(0, 4, 0, 0),
            };

            // The sparkline is decorative; the panel's value is already in the Narrator name, so keep the
            // chart out of the accessibility tree to avoid a duplicate, label-less announcement.
            AutomationProperties.SetAccessibilityView(chart, AccessibilityView.Raw);
            return chart;
        }

        return new Caption
        {
            Value = panel.SubLabel ?? string.Empty,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
    }

    // ── State bodies ─────────────────────────────────────────────────────────────────────────────────

    private Grid BuildLoading(FleetStatsBarDisplay display)
    {
        var grid = BuildGrid(display, loading: true);
        LiveRegion.Configure(grid);
        LiveRegion.Announce(grid);
        AutomationProperties.SetName(
            grid,
            string.Format(
                CultureInfo.CurrentCulture,
                "{0}. {1}",
                display.AutomationName,
                _localizer.GetString("common.loading", "Loading...")));
        return grid;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("dashboard.fleet.error", "Couldn't load fleet stats"),
            ActionText = _localizer.GetString("common.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnRetry;
        return error;
    }

    private void OnRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private double AvailableWidth()
    {
        double width = _body.ActualWidth;
        if (width <= 0)
        {
            width = ActualWidth;
        }

        return width;
    }

    private static int ColumnsForWidth(double width) => width switch
    {
        <= 0 => 2,
        < NarrowBreakpoint => 2,
        < MediumBreakpoint => 3,
        < WideBreakpoint => 4,
        _ => MaxColumns,
    };

    private static bool IsGridState(FleetStatsBarState state) =>
        state is FleetStatsBarState.Loaded
            or FleetStatsBarState.Empty
            or FleetStatsBarState.Stale
            or FleetStatsBarState.Offline;

    protected override AutomationPeer OnCreateAutomationPeer() => new FleetStatsBarAutomationPeer(this);

    private sealed class FleetStatsBarAutomationPeer(FleetStatsBar owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((FleetStatsBar)Owner).ViewModel.Display.AutomationName
                : name;
        }
    }
}
