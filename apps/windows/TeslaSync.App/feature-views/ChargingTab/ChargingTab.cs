using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Layout;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 Charging analytics surface — a parity port of
/// web/src/features/analytics/components/analytics/ChargingTab.tsx and its composed
/// <c>ChargingDetailSection</c>. It reproduces every web section: the six summary metric tiles (sessions,
/// total energy, total cost, avg power, avg duration, charge efficiency), the charger-type donut, the
/// start-battery distribution bars, the hourly bar+line pattern, the charger-brand leaderboard, the monthly
/// area+line+bar trend, the four cost-analysis tiles and the cost-by-charger-type bars — each with the web's
/// per-section empty state, never a hidden panel. The web component is presentational (its parent
/// <c>AnalyticsPage</c> owns the fleet-analytics query); this self-contained surface additionally renders the
/// query lifecycle as explicit loading (skeleton chrome), whole-surface empty, stale (chip), offline (chip) and
/// hard-error (QueryError + retry) branches. All data flows through the shared <see cref="ChargingTabViewModel"/>;
/// the view never performs HTTP. Every string resolves through the i18n facade, each tile / panel / chart
/// carries a Narrator name, and state changes are announced through a polite live region. The surface adds no
/// custom motion, so reduced-motion is honoured by construction.
/// </summary>
public sealed partial class ChargingTab : ContentControl, IDisposable
{
    private const double ChartHeight = 280;
    private const double MonthlyChartHeight = 300;
    private const double SummaryCardMinWidth = 150;
    private const double ChartPanelMinWidth = 340;
    private const double CostCardMinWidth = 160;
    private const double DonutInnerRatio = 0.58; // web innerRadius 55 / outerRadius 95

    // Web CHART_COLORS indices the source pins per series (kept identical for cross-platform colour parity).
    private const int ColorCharges = 0;
    private const int ColorBattery = 1;
    private const int ColorSessions = 2;
    private const int ColorEnergyLine = 3;

    private readonly ChargingTabViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly ChargingTabDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _root = new() { Spacing = 16 };
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

    /// <summary>Creates the surface over its data source, localizer, diagnostics and currency symbol.</summary>
    /// <param name="source">The cache-then-network data port (P1/S8 state-holder seam).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    /// <param name="currencySymbol">The currency symbol (web <c>settings.currency_symbol</c>; default "$").</param>
    public ChargingTab(
        IChargingTabSource source,
        ILocalizer localizer,
        ChargingTabDiagnostics? diagnostics = null,
        string? currencySymbol = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new ChargingTabDiagnostics();
        _viewModel = new ChargingTabViewModel(source, localizer, currencySymbol);
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
        Render();
    }

    /// <summary>The diagnostics surface slug this view registers under (<c>ChargingTab</c>).</summary>
    public static string Slug => ChargingTabRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting/diagnostics).</summary>
    public ChargingTabViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="ChargingTabSource"/> from the shared data
    /// layer (the host's P2-core dependencies).
    /// </summary>
    public static ChargingTab Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        ChargingTabDiagnostics? diagnostics = null,
        string? currencySymbol = null)
    {
        var source = new ChargingTabSource(api, engine, options);
        return new ChargingTab(source, localizer, diagnostics, currencySymbol);
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
            ChargingTabState.Loading => BuildLoadingScaffold(),
            ChargingTabState.Error => BuildErrorBody(),
            ChargingTabState.Empty => BuildEmptyBody(),
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
            case ChargingTabState.Stale:
                _statusRow.Children.Add(BuildBadge(_viewModel.StaleLabel, StatusKind.Warning));
                break;
            case ChargingTabState.Offline:
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
        _queryError.Message = _viewModel.ErrorMessage ?? ChargingTabRegistration.ErrorText(_localizer);
        _queryError.ActionText = _viewModel.RetryLabel;
        _queryError.AttemptCount = _viewModel.Attempts;
        return _queryError;
    }

    // ── Whole-surface empty (null body) ──────────────────────────────────────────────────────────────
    private TsEmptyState BuildEmptyBody() => new TsEmptyState
    {
        Message = _viewModel.EmptyText,
        VerticalAlignment = VerticalAlignment.Center,
    };

    // ── Loading: skeleton chrome ─────────────────────────────────────────────────────────────────────
    private static StackPanel BuildLoadingScaffold()
    {
        var stack = new StackPanel { Spacing = 16 };

        var cards = new TsGrid { Columns = 6, Gutter = 12, ItemMinWidth = SummaryCardMinWidth };
        for (int i = 0; i < 6; i++)
        {
            cards.Children.Add(new TsSkeleton { BlockHeight = 76 });
        }

        stack.Children.Add(cards);

        var charts = new TsGrid { Columns = 2, Gutter = 16, ItemMinWidth = ChartPanelMinWidth };
        charts.Children.Add(SkeletonPanel(ChartHeight));
        charts.Children.Add(SkeletonPanel(ChartHeight));
        stack.Children.Add(charts);

        stack.Children.Add(SkeletonPanel(ChartHeight));
        stack.Children.Add(SkeletonPanel(MonthlyChartHeight));
        return stack;
    }

    private static TsGlassPanel SkeletonPanel(double height)
    {
        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(new TsSkeleton { BlockHeight = 16, Width = 180, HorizontalAlignment = HorizontalAlignment.Left });
        column.Children.Add(new TsSkeleton { BlockHeight = height });
        return new TsGlassPanel { Padding = new Thickness(16), Content = column };
    }

    // ── Ready / Stale / Offline: the full content composition ────────────────────────────────────────
    private StackPanel BuildContent(ChargingTabDisplay display)
    {
        var stack = new StackPanel { Spacing = 16 };

        stack.Children.Add(BuildSummaryGrid(display));

        var pair = new TsGrid { Columns = 2, Gutter = 16, ItemMinWidth = ChartPanelMinWidth };
        pair.Children.Add(BuildChargerTypesPanel(display));
        pair.Children.Add(BuildBatteryPanel(display));
        stack.Children.Add(pair);

        stack.Children.Add(BuildHourlyPanel(display));
        stack.Children.Add(BuildBrandsPanel(display));
        stack.Children.Add(BuildMonthlyPanel(display));
        stack.Children.Add(BuildCostPanel(display));
        stack.Children.Add(BuildCostByTypePanel(display));
        return stack;
    }

    private static TsGrid BuildSummaryGrid(ChargingTabDisplay display)
    {
        var grid = new TsGrid { Columns = 6, Gutter = 12, ItemMinWidth = SummaryCardMinWidth };
        foreach (var card in display.SummaryCards)
        {
            grid.Children.Add(BuildStatCard(card));
        }

        return grid;
    }

    private static TsStatCard BuildStatCard(ChargingMetricCard card)
    {
        var stat = new TsStatCard
        {
            Label = card.Label,
            Value = card.Value,
            Sublabel = card.Subtitle,
            Glyph = card.Glyph,
        };
        AutomationProperties.SetName(stat, card.AutomationName);
        return stat;
    }

    private TsGlassPanel BuildChargerTypesPanel(ChargingTabDisplay display)
    {
        UIElement body;
        if (display.ChargerTypes.Count > 0)
        {
            var points = new List<ChartPoint>(display.ChargerTypes.Count);
            for (int i = 0; i < display.ChargerTypes.Count; i++)
            {
                var slice = display.ChargerTypes[i];
                points.Add(new ChartPoint(i, slice.Count, slice.Type));
            }

            body = new TsPieChart
            {
                Values = points,
                InnerRadiusRatio = DonutInnerRatio,
                Height = ChartHeight,
            };
        }
        else
        {
            body = EmptyBody(_viewModel.NoChargerTypes);
        }

        return Panel(_viewModel.ChargerTypesTitle, body);
    }

    private TsGlassPanel BuildBatteryPanel(ChargingTabDisplay display)
    {
        UIElement body;
        if (display.BatteryDistribution.Count > 0)
        {
            var points = new List<ChartPoint>(display.BatteryDistribution.Count);
            for (int i = 0; i < display.BatteryDistribution.Count; i++)
            {
                var bar = display.BatteryDistribution[i];
                points.Add(new ChartPoint(i, bar.Count, bar.Range));
            }

            var series = new ChartSeries(_viewModel.SessionsSeries, points)
            {
                Kind = ChartSeriesKind.Bar,
                ColorIndex = ColorBattery,
            };

            body = new TsBarChart { Series = new List<ChartSeries> { series }, Height = ChartHeight };
        }
        else
        {
            body = EmptyBody(_viewModel.NoBatteryDistribution);
        }

        return Panel(_viewModel.StartBatteryTitle, body);
    }

    private TsGlassPanel BuildHourlyPanel(ChargingTabDisplay display)
    {
        UIElement body;
        if (display.HourlyPattern.Count > 0)
        {
            var chargePoints = new List<ChartPoint>(display.HourlyPattern.Count);
            var energyPoints = new List<ChartPoint>(display.HourlyPattern.Count);
            foreach (var hour in display.HourlyPattern)
            {
                chargePoints.Add(new ChartPoint(hour.Hour, hour.Charges, hour.HourLabel));
                energyPoints.Add(new ChartPoint(hour.Hour, hour.Energy, hour.HourLabel));
            }

            var series = new List<ChartSeries>
            {
                new(_viewModel.ChargesSeries, chargePoints) { Kind = ChartSeriesKind.Bar, ColorIndex = ColorCharges },
                new(_viewModel.EnergySeries, energyPoints) { Kind = ChartSeriesKind.Line, ColorIndex = ColorEnergyLine },
            };

            body = new TsComposedChart { Series = series, Height = ChartHeight };
        }
        else
        {
            body = EmptyBody(_viewModel.NoHourly);
        }

        return Panel(_viewModel.HourlyPatternTitle, body);
    }

    private TsGlassPanel BuildBrandsPanel(ChargingTabDisplay display)
    {
        UIElement body;
        if (display.ChargerBrands.Count > 0)
        {
            var list = new StackPanel { Spacing = 12 };
            foreach (var brand in display.ChargerBrands)
            {
                string label = string.Create(CultureInfo.CurrentCulture, $"#{brand.Rank} {brand.Brand}");
                string valueText = string.Create(CultureInfo.CurrentCulture, $"{brand.CountText} {_viewModel.SessionsWord}");
                var bar = new TsMetricBar
                {
                    Label = label,
                    Value = brand.Percent,
                    Max = 100,
                    ValueText = valueText,
                    AccentBrushKey = "TsColorSuccessBrush",
                };
                AutomationProperties.SetName(bar, string.Create(CultureInfo.CurrentCulture, $"{label}, {valueText}"));
                list.Children.Add(bar);
            }

            body = list;
        }
        else
        {
            body = EmptyBody(_viewModel.NoBrands);
        }

        return Panel(_viewModel.ChargerBrandsTitle, body);
    }

    private TsGlassPanel BuildMonthlyPanel(ChargingTabDisplay display)
    {
        UIElement body;
        if (display.MonthlyTrend.Count > 0)
        {
            var energyPoints = new List<ChartPoint>(display.MonthlyTrend.Count);
            var powerPoints = new List<ChartPoint>(display.MonthlyTrend.Count);
            var sessionPoints = new List<ChartPoint>(display.MonthlyTrend.Count);
            for (int i = 0; i < display.MonthlyTrend.Count; i++)
            {
                var month = display.MonthlyTrend[i];
                energyPoints.Add(new ChartPoint(i, month.Energy, month.Month));
                powerPoints.Add(new ChartPoint(i, month.AvgPower, month.Month));
                sessionPoints.Add(new ChartPoint(i, month.Sessions, month.Month));
            }

            var series = new List<ChartSeries>
            {
                new(_viewModel.EnergySeries, energyPoints) { Kind = ChartSeriesKind.Area, ColorIndex = ColorBattery },
                new(_viewModel.AvgPowerSeries, powerPoints) { Kind = ChartSeriesKind.Line, ColorIndex = ColorEnergyLine },
                new(_viewModel.SessionsSeries, sessionPoints) { Kind = ChartSeriesKind.Bar, ColorIndex = ColorSessions },
            };

            body = new TsComposedChart { Series = series, Height = MonthlyChartHeight };
        }
        else
        {
            body = EmptyBody(_viewModel.NoMonthly);
        }

        return Panel(_viewModel.MonthlyTrendTitle, body);
    }

    private TsGlassPanel BuildCostPanel(ChargingTabDisplay display)
    {
        UIElement body;
        if (display.HasCostStats)
        {
            var grid = new TsGrid { Columns = 4, Gutter = 12, ItemMinWidth = CostCardMinWidth };
            foreach (var card in display.CostCards)
            {
                grid.Children.Add(BuildStatCard(card));
            }

            body = grid;
        }
        else
        {
            body = EmptyBody(_viewModel.NoCostStats);
        }

        return Panel(_viewModel.CostAnalysisTitle, body);
    }

    private TsGlassPanel BuildCostByTypePanel(ChargingTabDisplay display)
    {
        UIElement body;
        if (display.CostByType.Count > 0)
        {
            var list = new StackPanel { Spacing = 12 };
            foreach (var row in display.CostByType)
            {
                string valueText = string.Create(CultureInfo.CurrentCulture, $"{row.CountText} ({row.PercentText}%)");
                var bar = new TsMetricBar
                {
                    Label = row.Type,
                    Value = row.Percent,
                    Max = 100,
                    ValueText = valueText,
                    AccentBrushKey = ChartPalette.KeyForIndex(row.ColorIndex),
                };
                AutomationProperties.SetName(bar, string.Create(CultureInfo.CurrentCulture, $"{row.Type}, {valueText}"));
                list.Children.Add(bar);
            }

            body = list;
        }
        else
        {
            body = EmptyBody(_viewModel.NoCostByType);
        }

        return Panel(_viewModel.CostByTypeTitle, body);
    }

    private static TsGlassPanel Panel(string title, UIElement body)
    {
        var stack = new StackPanel { Spacing = 12 };
        stack.Children.Add(new SectionTitle { Value = title });
        stack.Children.Add(body);

        var panel = new TsGlassPanel { Padding = new Thickness(16), Content = stack };
        AutomationProperties.SetName(panel, title);
        return panel;
    }

    private static TsEmptyState EmptyBody(string message) => new()
    {
        Message = message,
        VerticalAlignment = VerticalAlignment.Center,
    };

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
