using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 Detailed-Statistics feature surface — a parity port of
/// web/src/features/charging/components/charging-list/DetailedStatistics.tsx. It composes the web's single
/// glass panel: a "Detailed Statistics" section title with a trending-up glyph over a responsive 2 / 3 / 6-column
/// grid of six centred cells (total sessions, average duration, average power, top charger with its occurrence
/// count, total cost and average cost per kWh). Each cell is a bold, token-tinted value above a small muted
/// label — the average-power, total-cost and per-kWh values keep the web purple / amber / emerald accents. The
/// web component is a pure child of the Charging-History page; the native superset binds its own
/// cache-then-network <see cref="DetailedStatisticsViewModel"/> so it renders every state the P2 contract
/// requires — the per-cell skeletons while loading, a retry surface on a hard failure, and a freshness chip
/// (stale / offline) with a refresh affordance over the grid otherwise (the grid never hides; empty snapshots
/// render zeroed / em-dash cells). The view never performs HTTP. Every string resolves through the i18n facade
/// and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class DetailedStatistics : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const double PanelPadding = 20;        // web p-5
    private const double RootSpacing = 16;         // web mb-4 between the title and the grid
    private const double GridGap = 16;             // web gap-4
    private const double TitleSpacing = 8;         // web gap-2 (icon ↔ title)
    private const double CellSpacing = 4;          // value ↔ label
    private const double TitleIconSize = 16;       // web h-4 w-4
    private const double ValueFontSize = 18;       // web text-lg
    private const double LabelFontSize = 10;       // web text-[10px]
    private const double NarrowBreakpoint = 600;   // web sm
    private const double MediumBreakpoint = 1024;  // web md
    private const int CellCount = 6;
    private const double SkeletonValueWidth = 56;
    private const double SkeletonValueHeight = 22;
    private const double SkeletonLabelWidth = 40;
    private const double SkeletonLabelHeight = 10;

    private readonly DetailedStatisticsViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly DetailedStatisticsDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _root = new() { Spacing = RootSpacing };
    private readonly TsGlassPanel _panel;

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, currency and (optional) diagnostics/clock.</summary>
    public DetailedStatistics(
        IDetailedStatisticsSource source,
        ILocalizer localizer,
        DetailedStatisticsDiagnostics? diagnostics = null,
        string? currencySymbol = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new DetailedStatisticsDiagnostics();
        _viewModel = new DetailedStatisticsViewModel(source, localizer, currencySymbol, clock);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        AutomationProperties.SetName(this, _viewModel.Display.AutomationName);

        _panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = _root };
        Content = _panel;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        SizeChanged += OnSizeChanged;
        Render();
    }

    /// <summary>The canonical surface id (<c>detailed-statistics</c>).</summary>
    public static string SurfaceId => DetailedStatisticsRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public DetailedStatisticsViewModel ViewModel => _viewModel;

    /// <summary>The currency symbol used for the cost cells; reassigning re-projects the current snapshot.</summary>
    public string CurrencySymbol
    {
        get => _viewModel.CurrencySymbol;
        set => _viewModel.CurrencySymbol = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="DetailedStatisticsSource"/> from the
    /// shared data layer (the host's P2-core dependencies), optionally scoped to a single vehicle.
    /// </summary>
    public static DetailedStatistics Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        DetailedStatisticsDiagnostics? diagnostics = null,
        string? currencySymbol = null,
        long? vehicleId = null)
    {
        var source = new DetailedStatisticsSource(api, engine, options, vehicleId);
        return new DetailedStatistics(source, localizer, diagnostics, currencySymbol);
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

        _root.Children.Clear();

        switch (_viewModel.State)
        {
            case DetailedStatisticsState.Loading:
                _root.Children.Add(BuildHeader(display, includeFreshness: false));
                _root.Children.Add(BuildLoadingGrid(display));
                break;

            case DetailedStatisticsState.Error:
                _root.Children.Add(BuildHeader(display, includeFreshness: false));
                _root.Children.Add(BuildError());
                break;

            default:
                _root.Children.Add(BuildHeader(display, includeFreshness: true));
                _root.Children.Add(BuildCellGrid(display));
                break;
        }
    }

    // ── Header (title + optional freshness chip / refresh) ────────────────────────────────────────────────

    private Grid BuildHeader(DetailedStatisticsDisplay display, bool includeFreshness)
    {
        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var titleRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = TitleSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };
        titleRow.Children.Add(DecorativeIcon(
            DetailedStatisticsRegistration.TrendingUpGlyph, TitleIconSize, DisplayTokens.Brush("TsColorAccentBrush")));
        titleRow.Children.Add(new SectionTitle { Value = display.Title, VerticalAlignment = VerticalAlignment.Center });
        Grid.SetColumn(titleRow, 0);
        grid.Children.Add(titleRow);

        if (includeFreshness)
        {
            var actions = BuildFreshnessActions();
            Grid.SetColumn(actions, 1);
            grid.Children.Add(actions);
        }

        return grid;
    }

    private StackPanel BuildFreshnessActions()
    {
        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
        };

        if (_viewModel.State is DetailedStatisticsState.Stale or DetailedStatisticsState.Offline)
        {
            actions.Children.Add(BuildFreshnessChip(_viewModel.State));
        }

        actions.Children.Add(new TsDataFreshness
        {
            UpdatedAt = _viewModel.UpdatedAt,
            IsFetching = _viewModel.IsFetching,
            IsError = _viewModel.State == DetailedStatisticsState.Offline,
            VerticalAlignment = VerticalAlignment.Center,
        });

        actions.Children.Add(BuildRefreshButton());
        return actions;
    }

    private TsBadge BuildFreshnessChip(DetailedStatisticsState state)
    {
        bool offline = state == DetailedStatisticsState.Offline;
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
        };
        AutomationProperties.SetName(button, _localizer.GetString("common.refresh", "Refresh"));
        button.Click += OnRefreshClick;
        return button;
    }

    private void OnRefreshClick(object sender, RoutedEventArgs e) => _ = _viewModel.RetryAsync();

    // ── Cell grid ─────────────────────────────────────────────────────────────────────────────────────────

    private Grid BuildCellGrid(DetailedStatisticsDisplay display)
    {
        var cells = new List<FrameworkElement>(display.Cells.Count);
        foreach (var cell in display.Cells)
        {
            cells.Add(BuildCell(cell));
        }

        return BuildResponsiveGrid(cells);
    }

    private static StackPanel BuildCell(DetailedStatCell cell)
    {
        var column = new StackPanel
        {
            Spacing = CellSpacing,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        var value = new TextBlock
        {
            Text = cell.Value,
            FontSize = ValueFontSize,
            FontWeight = FontWeights.Bold,
            Foreground = DisplayTokens.Brush(cell.AccentBrushKey),
            TextAlignment = TextAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center,
            TextWrapping = TextWrapping.Wrap,
        };
        AutomationProperties.SetAccessibilityView(value, AccessibilityView.Raw);

        var label = new TextBlock
        {
            Text = cell.Label,
            FontSize = LabelFontSize,
            Foreground = DisplayTokens.TextMuted,
            TextAlignment = TextAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center,
            TextWrapping = TextWrapping.Wrap,
        };
        AutomationProperties.SetAccessibilityView(label, AccessibilityView.Raw);

        column.Children.Add(value);
        column.Children.Add(label);

        // The composed "label: value" carries the cell to Narrator as one stop (children are hidden above).
        AutomationProperties.SetName(column, cell.AutomationName);
        return column;
    }

    // ── Loading skeletons ─────────────────────────────────────────────────────────────────────────────────

    private Grid BuildLoadingGrid(DetailedStatisticsDisplay display)
    {
        var cells = new List<FrameworkElement>(CellCount);
        for (int i = 0; i < CellCount; i++)
        {
            cells.Add(BuildSkeletonCell());
        }

        var grid = BuildResponsiveGrid(cells);
        LiveRegion.Configure(grid);
        LiveRegion.Announce(grid);
        AutomationProperties.SetName(
            grid,
            string.Format(
                CultureInfo.CurrentCulture,
                "{0}. {1}",
                display.Title,
                _localizer.GetString("common.loading", "Loading")));
        return grid;
    }

    private static StackPanel BuildSkeletonCell()
    {
        var column = new StackPanel
        {
            Spacing = CellSpacing,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        column.Children.Add(new TsSkeleton
        {
            BlockWidth = SkeletonValueWidth,
            BlockHeight = SkeletonValueHeight,
            Radius = 6,
            HorizontalAlignment = HorizontalAlignment.Center,
        });
        column.Children.Add(new TsSkeleton
        {
            BlockWidth = SkeletonLabelWidth,
            BlockHeight = SkeletonLabelHeight,
            Radius = 6,
            HorizontalAlignment = HorizontalAlignment.Center,
        });
        return column;
    }

    // ── Error surface (web QueryError) ────────────────────────────────────────────────────────────────────

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage
                ?? _localizer.GetString("charging.stats.error", "Couldn't load charging statistics"),
            ActionText = _localizer.GetString("common.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnRetry;
        return error;
    }

    private void OnRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    // ── Shared layout primitives ──────────────────────────────────────────────────────────────────────────

    private Grid BuildResponsiveGrid(List<FrameworkElement> items)
    {
        int columns = ColumnsForWidth(AvailableWidth());
        var grid = new Grid { ColumnSpacing = GridGap, RowSpacing = GridGap };
        for (int c = 0; c < columns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        int rows = (int)Math.Ceiling(items.Count / (double)columns);
        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < items.Count; i++)
        {
            var item = items[i];
            Grid.SetColumn(item, i % columns);
            Grid.SetRow(item, i / columns);
            grid.Children.Add(item);
        }

        return grid;
    }

    private double AvailableWidth()
    {
        double width = _root.ActualWidth;
        if (width <= 0)
        {
            width = ActualWidth - (PanelPadding * 2);
        }

        return width;
    }

    private static int ColumnsForWidth(double width) => width switch
    {
        <= 0 => 2,
        < NarrowBreakpoint => 2,
        < MediumBreakpoint => 3,
        _ => CellCount,
    };

    private static bool IsGridState(DetailedStatisticsState state) =>
        state is DetailedStatisticsState.Loaded
            or DetailedStatisticsState.Empty
            or DetailedStatisticsState.Stale
            or DetailedStatisticsState.Offline;

    private static FontIcon DecorativeIcon(string glyph, double fontSize, Brush foreground)
    {
        var icon = new FontIcon
        {
            Glyph = glyph,
            FontSize = fontSize,
            Foreground = foreground,
            VerticalAlignment = VerticalAlignment.Center,
        };

        // Decorative — its meaning is carried by the adjacent title and the surface Narrator name.
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        return icon;
    }

    protected override AutomationPeer OnCreateAutomationPeer() => new DetailedStatisticsAutomationPeer(this);

    private sealed class DetailedStatisticsAutomationPeer(DetailedStatistics owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((DetailedStatistics)Owner).ViewModel.Display.AutomationName
                : name;
        }
    }
}
