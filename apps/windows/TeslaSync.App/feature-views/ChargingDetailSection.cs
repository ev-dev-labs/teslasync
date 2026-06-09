using System.Collections.Generic;
using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 Charging-detail feature surface — a parity port of
/// web/src/features/analytics/components/analytics/ChargingDetailSection.tsx. It composes the web's four
/// always-visible glass panels: the Charger-Brands leaderboard (ranked proportional bars), the
/// Monthly-Charging-Trend composed chart (energy area + average-power line + sessions bar), the Cost-Analysis
/// cards (min / avg / median / max charging cost) and the Cost-by-Charger-Type bars. Each panel renders its
/// content or a friendly per-section empty state (the web ternary), and the surface as a whole renders
/// every state the P2 contract requires — the section skeletons while loading, a retry surface on a hard
/// failure, and a freshness chip (stale / offline) over the four panels otherwise. All data flows through the
/// shared <see cref="ChargingDetailViewModel"/>; the view never performs HTTP. Every string resolves through
/// the i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class ChargingDetailSection : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const double ChartHeight = 300;
    private const double SkeletonChartHeight = 220;

    // web ComposedChart series colour indices (CHART_COLORS[1] energy / [3] avg power / [2] sessions).
    private const int EnergyColorIndex = 1;
    private const int AvgPowerColorIndex = 3;
    private const int SessionsColorIndex = 2;

    private readonly ChargingDetailViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly ChargingDetailDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _root = new() { Spacing = 16 };

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, currency and (optional) diagnostics/clock.</summary>
    public ChargingDetailSection(
        IChargingDetailSource source,
        ILocalizer localizer,
        ChargingDetailDiagnostics? diagnostics = null,
        string? currencySymbol = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new ChargingDetailDiagnostics();
        _viewModel = new ChargingDetailViewModel(source, localizer, currencySymbol, clock);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        AutomationProperties.SetName(this, _viewModel.Display.AutomationName);

        Content = new ScrollViewer
        {
            Content = _root,
            VerticalScrollMode = ScrollMode.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollMode = ScrollMode.Disabled,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            Padding = new Thickness(4),
        };

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical surface id (<c>charging-detail-section</c>).</summary>
    public static string SurfaceId => ChargingDetailRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting/diagnostics).</summary>
    public ChargingDetailViewModel ViewModel => _viewModel;

    /// <summary>The currency symbol used for the cost cards; reassigning re-projects the current snapshot.</summary>
    public string CurrencySymbol
    {
        get => _viewModel.CurrencySymbol;
        set => _viewModel.CurrencySymbol = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="ChargingDetailSource"/> from the
    /// shared data layer (the host's P2-core dependencies).
    /// </summary>
    public static ChargingDetailSection Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        ChargingDetailDiagnostics? diagnostics = null,
        string? currencySymbol = null)
    {
        var source = new ChargingDetailSource(api, engine, options);
        return new ChargingDetailSection(source, localizer, diagnostics, currencySymbol);
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
        AutomationProperties.SetName(this, display.AutomationName);

        _root.Children.Clear();

        switch (_viewModel.State)
        {
            case ChargingDetailState.Loading:
                _root.Children.Add(BuildLoadingSkeletons(display));
                break;

            case ChargingDetailState.Error:
                _root.Children.Add(BuildErrorSurface());
                break;

            default:
                _root.Children.Add(BuildFreshnessHeader());
                _root.Children.Add(BuildBrandsSection(display));
                _root.Children.Add(BuildMonthlySection(display));
                _root.Children.Add(BuildCostSection(display));
                _root.Children.Add(BuildTypesSection(display));
                break;
        }
    }

    // ── Header (freshness chip + stale/offline badge + refresh) ───────────────────────────────────────

    private StackPanel BuildFreshnessHeader()
    {
        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
        };

        if (_viewModel.State is ChargingDetailState.Stale or ChargingDetailState.Offline)
        {
            actions.Children.Add(BuildFreshnessChip(_viewModel.State));
        }

        actions.Children.Add(new TsDataFreshness
        {
            UpdatedAt = _viewModel.UpdatedAt,
            IsFetching = _viewModel.IsFetching,
            IsError = _viewModel.State == ChargingDetailState.Offline,
            VerticalAlignment = VerticalAlignment.Center,
        });

        actions.Children.Add(BuildRefreshButton());

        return actions;
    }

    private TsBadge BuildFreshnessChip(ChargingDetailState state)
    {
        bool offline = state == ChargingDetailState.Offline;
        string text = offline
            ? _localizer.GetString("analytics.charging.offlineChip", "Offline")
            : _localizer.GetString("analytics.charging.staleChip", "Stale");

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
        AutomationProperties.SetName(button, _localizer.GetString("analytics.charging.refresh", "Refresh charging analytics"));
        button.Click += OnRefreshClick;
        return button;
    }

    private void OnRefreshClick(object sender, RoutedEventArgs e) => _ = _viewModel.RetryAsync();

    // ── Charger Brands (leaderboard) ──────────────────────────────────────────────────────────────────

    private static TsGlassPanel BuildBrandsSection(ChargingDetailDisplay display)
    {
        var content = new StackPanel { Spacing = 12 };
        content.Children.Add(new SectionTitle { Value = display.BrandsTitle });

        if (display.HasBrands)
        {
            var bars = new StackPanel { Spacing = 12 };
            foreach (var row in display.Brands)
            {
                bars.Children.Add(BuildBar(row));
            }

            content.Children.Add(bars);
        }
        else
        {
            content.Children.Add(EmptySection(display.NoBrandsMessage));
        }

        return Panel(content, display.BrandsTitle);
    }

    // ── Monthly Charging Trend (composed chart) ───────────────────────────────────────────────────────

    private static TsGlassPanel BuildMonthlySection(ChargingDetailDisplay display)
    {
        var content = new StackPanel { Spacing = 12 };
        content.Children.Add(new SectionTitle { Value = display.MonthlyTitle });

        if (display.HasMonthly)
        {
            var series = BuildMonthlySeries(display);

            var chart = new TsCartesianChart
            {
                Series = series,
                Title = display.MonthlyTitle,
                Height = ChartHeight,
                IncludeZero = true,
            };
            AutomationProperties.SetName(chart, display.MonthlyChartAriaLabel);
            content.Children.Add(chart);

            // The accessible tabular fallback the web ChartContainer exposes — one toggle away from the chart.
            var dataView = new TsChartDataView { Series = series };
            var expander = new Expander
            {
                Header = display.MonthlyChartAriaLabel,
                Content = dataView,
                HorizontalAlignment = HorizontalAlignment.Stretch,
                HorizontalContentAlignment = HorizontalAlignment.Stretch,
            };
            AutomationProperties.SetName(expander, display.MonthlyChartAriaLabel);
            content.Children.Add(expander);
        }
        else
        {
            content.Children.Add(EmptySection(display.NoMonthlyMessage));
        }

        return Panel(content, display.MonthlyTitle);
    }

    private static ChartSeries[] BuildMonthlySeries(ChargingDetailDisplay display)
    {
        var energy = new List<ChartPoint>(display.Monthly.Count);
        var avgPower = new List<ChartPoint>(display.Monthly.Count);
        var sessions = new List<ChartPoint>(display.Monthly.Count);

        for (int i = 0; i < display.Monthly.Count; i++)
        {
            var row = display.Monthly[i];
            energy.Add(new ChartPoint(i, row.Energy, row.Month));
            avgPower.Add(new ChartPoint(i, row.AvgPower, row.Month));
            sessions.Add(new ChartPoint(i, row.Sessions, row.Month));
        }

        return new[]
        {
            new ChartSeries(display.EnergySeriesLabel, energy) { Kind = ChartSeriesKind.Area, ColorIndex = EnergyColorIndex },
            new ChartSeries(display.AvgPowerSeriesLabel, avgPower) { Kind = ChartSeriesKind.Line, ColorIndex = AvgPowerColorIndex },
            new ChartSeries(display.SessionsSeriesLabel, sessions) { Kind = ChartSeriesKind.Bar, ColorIndex = SessionsColorIndex },
        };
    }

    // ── Cost Analysis (metric cards) ──────────────────────────────────────────────────────────────────

    private static TsGlassPanel BuildCostSection(ChargingDetailDisplay display)
    {
        var content = new StackPanel { Spacing = 12 };
        content.Children.Add(new SectionTitle { Value = display.CostTitle });

        if (display.HasCostStats)
        {
            var grid = new Grid { ColumnSpacing = 12, RowSpacing = 12 };
            for (int c = 0; c < display.CostCards.Count; c++)
            {
                grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            }

            for (int i = 0; i < display.CostCards.Count; i++)
            {
                var card = display.CostCards[i];
                var control = new TsMetricCard
                {
                    Label = card.Label,
                    Value = card.Value,
                    AccentBrushKey = card.AccentBrushKey,
                };
                AutomationProperties.SetName(control, card.AutomationName);
                Grid.SetColumn(control, i);
                grid.Children.Add(control);
            }

            content.Children.Add(grid);
        }
        else
        {
            content.Children.Add(EmptySection(display.NoCostStatsMessage));
        }

        return Panel(content, display.CostTitle);
    }

    // ── Cost by Charger Type (bars) ───────────────────────────────────────────────────────────────────

    private static TsGlassPanel BuildTypesSection(ChargingDetailDisplay display)
    {
        var content = new StackPanel { Spacing = 12 };
        content.Children.Add(new SectionTitle { Value = display.TypesTitle });

        if (display.HasChargerTypes)
        {
            var bars = new StackPanel { Spacing = 12 };
            foreach (var row in display.ChargerTypes)
            {
                bars.Children.Add(BuildBar(row));
            }

            content.Children.Add(bars);
        }
        else
        {
            content.Children.Add(EmptySection(display.NoChargerTypesMessage));
        }

        return Panel(content, display.TypesTitle);
    }

    // ── Loading skeletons ─────────────────────────────────────────────────────────────────────────────

    private StackPanel BuildLoadingSkeletons(ChargingDetailDisplay display)
    {
        var stack = new StackPanel { Spacing = 16 };
        stack.Children.Add(BuildSkeletonPanel(display.BrandsTitle, 140));
        stack.Children.Add(BuildSkeletonPanel(display.MonthlyTitle, SkeletonChartHeight));
        stack.Children.Add(BuildSkeletonPanel(display.CostTitle, 96));
        stack.Children.Add(BuildSkeletonPanel(display.TypesTitle, 120));

        LiveRegion.Configure(stack);
        LiveRegion.Announce(stack);
        AutomationProperties.SetName(
            stack,
            string.Format(
                CultureInfo.CurrentCulture,
                "{0}. {1}",
                display.AutomationName,
                _localizer.GetString("common.loading", "Loading")));
        return stack;
    }

    private static TsGlassPanel BuildSkeletonPanel(string title, double bodyHeight)
    {
        var content = new StackPanel { Spacing = 12 };
        content.Children.Add(new SectionTitle { Value = title });
        content.Children.Add(new TsSkeleton { BlockHeight = bodyHeight });
        return Panel(content, title);
    }

    // ── Error surface (web QueryError) ────────────────────────────────────────────────────────────────

    private TsGlassPanel BuildErrorSurface()
    {
        var error = new TsQueryError
        {
            Title = _localizer.GetString("analytics.charging.errorTitle", "Couldn't load charging analytics"),
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("analytics.charging.error", "Couldn't load charging analytics"),
            ActionText = _localizer.GetString("common.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
        };
        error.ActionInvoked += (_, _) => _ = _viewModel.RetryAsync();

        return Panel(error, _localizer.GetString("analytics.charging.errorTitle", "Couldn't load charging analytics"));
    }

    // ── Shared primitives ─────────────────────────────────────────────────────────────────────────────

    private static TsMetricBar BuildBar(ChargingDetailBarRow row)
    {
        var bar = new TsMetricBar
        {
            Label = row.Label,
            Value = row.Value,
            Max = row.Max,
            ValueText = row.ValueText,
            AccentBrushKey = row.AccentBrushKey,
        };
        AutomationProperties.SetName(bar, row.AutomationName);
        return bar;
    }

    private static TsEmptyState EmptySection(string message)
    {
        var empty = new TsEmptyState
        {
            Message = message,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(empty, message);
        return empty;
    }

    private static TsGlassPanel Panel(UIElement content, string automationName)
    {
        var panel = new TsGlassPanel { Padding = new Thickness(16), Content = content };
        AutomationProperties.SetName(panel, automationName);
        return panel;
    }
}
