using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 Cost Summary Cards surface — a parity port of
/// web/src/features/charging/components/cost-analysis/CostSummaryCards.tsx. It renders the six charging
/// cost-economics tiles (Total Cost, Avg $/kWh, Cost Per Mile/km, Total Energy, Gas Savings $, Savings %) in
/// a responsive grid, converting energy/distance to the user's display units at the render boundary (web
/// <c>useFormatting</c>/<c>useSettings</c>) and resolving every label through the i18n facade (web
/// <c>useTranslation</c>). Every state renders — a loading skeleton, the populated tile grid (entrance-faded,
/// the native mapping of the web <c>StaggerContainer</c>/<c>StaggerItem</c>), a friendly empty surface when
/// there are no charging sessions, an explicit retry surface on hard failure, plus stale and offline
/// freshness chips. All data flows through the shared <see cref="CostSummaryCardsViewModel"/>; the view never
/// performs HTTP. Every interactive element carries a Narrator name.
/// </summary>
public sealed partial class CostSummaryCards : ContentControl, IDisposable
{
    private const int LoadingSkeletonTiles = 6;
    private const double NarrowBreakpoint = 540;
    private const double MediumBreakpoint = 900;

    private readonly CostSummaryCardsViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly CostSummaryCardsDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly Grid _header = new();
    private readonly TsDataFreshness _freshness = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly Border _bodyHost = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, units, currency/gas settings and diagnostics.</summary>
    public CostSummaryCards(
        ICostSummaryCardsSource source,
        ILocalizer localizer,
        UnitPref? units = null,
        CostSummaryCardsSettings? settings = null,
        CostSummaryCardsDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new CostSummaryCardsDiagnostics();
        _viewModel = new CostSummaryCardsViewModel(source, localizer, units, settings);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        AutomationProperties.SetName(this, _viewModel.Title);

        BuildChrome();

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        SizeChanged += OnSizeChanged;
        Render();
    }

    /// <summary>The canonical surface id (<c>cost-summary-cards</c>).</summary>
    public static string SurfaceId => CostSummaryCardsRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public CostSummaryCardsViewModel ViewModel => _viewModel;

    /// <summary>The user's unit preference; reassigning re-projects the metrics in the new units.</summary>
    public UnitPref Units
    {
        get => _viewModel.Units;
        set => _viewModel.Units = value;
    }

    /// <summary>The currency/gas preferences; reassigning re-projects symbol, gas price and gas unit.</summary>
    public CostSummaryCardsSettings Settings
    {
        get => _viewModel.Settings;
        set => _viewModel.Settings = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="CostSummaryCardsSource"/> from the
    /// shared data layer (the host's P2-core dependencies), scoping the read to the primary (or explicit)
    /// vehicle.
    /// </summary>
    public static CostSummaryCards Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        UnitPref? units = null,
        CostSummaryCardsSettings? settings = null,
        CostSummaryCardsDiagnostics? diagnostics = null,
        long? vehicleId = null)
    {
        var source = new CostSummaryCardsSource(vehicles, api, engine, options, vehicleId);
        return new CostSummaryCards(source, localizer, units, settings, diagnostics);
    }

    private void BuildChrome()
    {
        // The web grid is headerless; the native superset adds a single right-aligned freshness chip so the
        // mandated stale / offline / refreshing states have a visible affordance.
        _header.Padding = new Thickness(0, 0, 0, 8);
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_freshness, 1);
        _header.Children.Add(_freshness);

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

    private void OnSizeChanged(object sender, SizeChangedEventArgs e)
    {
        // Re-flow the responsive grid when the available width crosses a breakpoint.
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
        switch (_viewModel.State)
        {
            case CostSummaryCardsState.Loading:
                Content = BuildLoading();
                break;

            case CostSummaryCardsState.Error:
                Content = BuildError();
                break;

            default:
                UpdateHeader();
                _bodyHost.Child = BuildBody();
                Content = _root;
                break;
        }
    }

    private void UpdateHeader()
    {
        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
    }

    private UIElement BuildBody()
    {
        var display = _viewModel.Display;
        if (!display.HasData)
        {
            return BuildEmpty();
        }

        // Map the web StaggerContainer/StaggerItem entrance to a single section-level fade-in that honours
        // reduce-motion while preserving the responsive grid layout.
        return new TsFadeIn { Content = BuildGrid(display) };
    }

    // ── Grid ─────────────────────────────────────────────────────────────────────────────────────────

    private Grid BuildGrid(CostSummaryCardsDisplay display)
    {
        int columns = ColumnsForWidth(AvailableWidth());
        var grid = new Grid { ColumnSpacing = 16, RowSpacing = 16 };
        for (int c = 0; c < columns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        int rows = (int)Math.Ceiling(display.Cards.Count / (double)columns);
        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < display.Cards.Count; i++)
        {
            var tile = BuildCardTile(display.Cards[i]);
            Grid.SetColumn(tile, i % columns);
            Grid.SetRow(tile, i / columns);
            grid.Children.Add(tile);
        }

        return grid;
    }

    private static Border BuildCardTile(CostSummaryCard card)
    {
        // Leading icon chip (web <div className="rounded-lg bg-[var(--surface-2)] p-2">{icon}</div>).
        var glyph = new FontIcon
        {
            Glyph = card.Glyph,
            FontSize = 18,
            Foreground = ChartBrushes.ForIndex(card.ColorIndex),
        };
        AutomationProperties.SetAccessibilityView(glyph, AccessibilityView.Raw);

        var iconChip = new Border
        {
            Child = glyph,
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            Background = DisplayTokens.Brush("TsColorSurfaceGlassBrush"),
            Padding = new Thickness(8),
            VerticalAlignment = VerticalAlignment.Top,
        };

        var label = new TextBlock
        {
            Text = card.Label,
            FontSize = 12,
            Foreground = DisplayTokens.TextMuted,
            TextTrimming = TextTrimming.CharacterEllipsis,
        };

        var value = new TextBlock
        {
            Text = card.Value,
            FontSize = 18,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            Margin = new Thickness(0, 2, 0, 0),
            TextTrimming = TextTrimming.CharacterEllipsis,
        };

        var subtitle = new TextBlock
        {
            Text = card.Subtitle,
            FontSize = 12,
            Foreground = DisplayTokens.TextMuted,
            Margin = new Thickness(0, 2, 0, 0),
            TextTrimming = TextTrimming.CharacterEllipsis,
        };

        var textColumn = new StackPanel { Spacing = 0 };
        textColumn.Children.Add(label);
        textColumn.Children.Add(value);
        textColumn.Children.Add(subtitle);

        var rowGrid = new Grid { ColumnSpacing = 12 };
        rowGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        rowGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetColumn(iconChip, 0);
        Grid.SetColumn(textColumn, 1);
        rowGrid.Children.Add(iconChip);
        rowGrid.Children.Add(textColumn);

        var tile = new Border
        {
            Child = rowGrid,
            CornerRadius = DisplayTokens.Radius("TsRadiusLg", 12),
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            Background = DisplayTokens.Surface,
            Padding = new Thickness(16),
        };
        AutomationProperties.SetName(tile, card.AutomationName);
        return tile;
    }

    private double AvailableWidth()
    {
        double width = _bodyHost.ActualWidth;
        if (width <= 0)
        {
            width = ActualWidth;
        }

        return width;
    }

    private static int ColumnsForWidth(double width) => width switch
    {
        <= 0 => 3,
        < NarrowBreakpoint => 2,
        < MediumBreakpoint => 3,
        _ => 6,
    };

    private static bool IsGridState(CostSummaryCardsState state) =>
        state is CostSummaryCardsState.Loaded or CostSummaryCardsState.Stale or CostSummaryCardsState.Offline;

    // ── State bodies ─────────────────────────────────────────────────────────────────────────────────

    private Grid BuildLoading()
    {
        var grid = new Grid { ColumnSpacing = 16, RowSpacing = 16, Padding = new Thickness(0, 4, 0, 4) };
        const int columns = 3;
        for (int c = 0; c < columns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        int rows = (int)Math.Ceiling(LoadingSkeletonTiles / (double)columns);
        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < LoadingSkeletonTiles; i++)
        {
            var tile = new TsSkeleton { BlockHeight = 84 };
            Grid.SetColumn(tile, i % columns);
            Grid.SetRow(tile, i / columns);
            grid.Children.Add(tile);
        }

        AutomationProperties.SetName(grid, _viewModel.LoadingLabel);
        LiveRegion.Configure(grid);
        LiveRegion.Announce(grid);
        return grid;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("costAnalysis.summary.error", "Couldn't load cost summary"),
            ActionText = _viewModel.RetryLabel,
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnRetry;
        return error;
    }

    private void OnRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private TsEmptyState BuildEmpty() => new()
    {
        Title = _viewModel.Title,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    protected override AutomationPeer OnCreateAutomationPeer() => new CostSummaryCardsAutomationPeer(this);

    private sealed class CostSummaryCardsAutomationPeer(CostSummaryCards owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((CostSummaryCards)Owner).ViewModel.Title
                : name;
        }
    }
}
