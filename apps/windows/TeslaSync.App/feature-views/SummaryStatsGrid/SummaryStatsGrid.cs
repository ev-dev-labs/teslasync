using System.Globalization;
using Microsoft.UI.Dispatching;
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

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 Summary-stats grid surface — a parity port of
/// web/src/features/charging/components/charging-curve/SummaryStatsGrid.tsx. It renders the web's six
/// always-visible summary cards (total sessions, total energy, average charge rate, peak rate, average
/// duration, total cost) in a responsive 2 / 3 / 6-column grid, each card a glass panel with an uppercase
/// label and a value plus optional unit suffix. Every state renders — the per-card skeletons while loading
/// (the web <c>SummaryCard</c> loading branch), the populated card grid (zeroed cards when the fleet has no
/// sessions, the web <c>?? 0</c> fallback), an explicit retry surface on hard failure, plus stale and offline
/// freshness chips over the grid otherwise. All data flows through the shared
/// <see cref="SummaryStatsGridViewModel"/>; the view never performs HTTP. Every string resolves through the
/// i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class SummaryStatsGrid : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const int FadeDelayMs = 50;           // web FadeIn delay 0.05s
    private const double SkeletonValueWidth = 80;
    private const double SkeletonValueHeight = 28;
    private const double NarrowBreakpoint = 600;
    private const double MediumBreakpoint = 1024;
    private const int CardCount = 6;

    private readonly SummaryStatsGridViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly SummaryStatsDiagnostics _diagnostics;
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

    /// <summary>Creates the surface over its data source, localizer, currency, precision and diagnostics.</summary>
    public SummaryStatsGrid(
        ISummaryStatsSource source,
        ILocalizer localizer,
        SummaryStatsDiagnostics? diagnostics = null,
        string? currencySymbol = null,
        int decimalPrecision = SummaryStatsProjection.DefaultPrecision,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new SummaryStatsDiagnostics();
        _viewModel = new SummaryStatsGridViewModel(source, localizer, currencySymbol, decimalPrecision, clock);
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

    /// <summary>The canonical surface id (<c>summary-stats-grid</c>).</summary>
    public static string SurfaceId => SummaryStatsRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public SummaryStatsGridViewModel ViewModel => _viewModel;

    /// <summary>The currency symbol used for the total-cost card; reassigning re-projects the current snapshot.</summary>
    public string CurrencySymbol
    {
        get => _viewModel.CurrencySymbol;
        set => _viewModel.CurrencySymbol = value;
    }

    /// <summary>The decimal precision used for the energy / rate / cost cards; reassigning re-projects.</summary>
    public int DecimalPrecision
    {
        get => _viewModel.DecimalPrecision;
        set => _viewModel.DecimalPrecision = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="SummaryStatsSource"/> from the shared
    /// data layer (the host's P2-core dependencies), optionally scoped to a single vehicle.
    /// </summary>
    public static SummaryStatsGrid Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        SummaryStatsDiagnostics? diagnostics = null,
        string? currencySymbol = null,
        int decimalPrecision = SummaryStatsProjection.DefaultPrecision,
        long? vehicleId = null)
    {
        var source = new SummaryStatsSource(api, engine, options, vehicleId);
        return new SummaryStatsGrid(source, localizer, diagnostics, currencySymbol, decimalPrecision);
    }

    private void BuildChrome()
    {
        // The web grid is headerless; the native superset adds a right-aligned freshness row so the mandated
        // stale / offline / refreshing states have a visible affordance above the always-fading card grid.
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
            case SummaryStatsState.Loading:
                Content = BuildLoading(display);
                break;

            case SummaryStatsState.Error:
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

        if (_viewModel.State is SummaryStatsState.Stale or SummaryStatsState.Offline)
        {
            _header.Children.Add(BuildFreshnessChip(_viewModel.State));
        }

        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.State == SummaryStatsState.Offline;
        _header.Children.Add(_freshness);

        _header.Children.Add(BuildRefreshButton());
    }

    private TsBadge BuildFreshnessChip(SummaryStatsState state)
    {
        bool offline = state == SummaryStatsState.Offline;
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

    // ── Card grid ─────────────────────────────────────────────────────────────────────────────────────

    private Grid BuildGrid(SummaryStatsDisplay display, bool loading)
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
            var card = BuildCard(display.Cards[i], loading);
            Grid.SetColumn(card, i % columns);
            Grid.SetRow(card, i / columns);
            grid.Children.Add(card);
        }

        return grid;
    }

    private TsGlassPanel BuildCard(SummaryStatCard card, bool loading)
    {
        var column = new StackPanel { Spacing = 4 };

        // web: uppercase tracking-wider secondary label. CSS uppercase is presentational only, so the visible
        // text is upper-cased while the panel's Narrator name keeps the source-case label/value.
        column.Children.Add(new Label
        {
            Value = card.Label.ToUpper(CultureInfo.CurrentCulture),
        });

        if (loading)
        {
            column.Children.Add(new TsSkeleton
            {
                BlockWidth = SkeletonValueWidth,
                BlockHeight = SkeletonValueHeight,
                HorizontalAlignment = HorizontalAlignment.Left,
            });
        }
        else
        {
            var valueRow = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Spacing = 4,
                VerticalAlignment = VerticalAlignment.Bottom,
            };
            valueRow.Children.Add(new MetricValue { Value = card.Value, VerticalAlignment = VerticalAlignment.Bottom });
            if (!string.IsNullOrEmpty(card.Unit))
            {
                valueRow.Children.Add(new Caption { Value = card.Unit, VerticalAlignment = VerticalAlignment.Bottom });
            }

            column.Children.Add(valueRow);
        }

        var panel = new TsGlassPanel { Padding = new Thickness(16), Content = column };
        AutomationProperties.SetName(
            panel,
            loading
                ? string.Format(
                    CultureInfo.CurrentCulture,
                    "{0}: {1}",
                    card.Label,
                    _localizer.GetString("common.loading", "Loading..."))
                : card.AutomationName);
        return panel;
    }

    // ── State bodies ─────────────────────────────────────────────────────────────────────────────────

    private Grid BuildLoading(SummaryStatsDisplay display)
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
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("charging.curve.error", "Couldn't load charging stats"),
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
        _ => CardCount,
    };

    private static bool IsGridState(SummaryStatsState state) =>
        state is SummaryStatsState.Loaded or SummaryStatsState.Empty or SummaryStatsState.Stale or SummaryStatsState.Offline;

    protected override AutomationPeer OnCreateAutomationPeer() => new SummaryStatsGridAutomationPeer(this);

    private sealed class SummaryStatsGridAutomationPeer(SummaryStatsGrid owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((SummaryStatsGrid)Owner).ViewModel.Display.AutomationName
                : name;
        }
    }
}
