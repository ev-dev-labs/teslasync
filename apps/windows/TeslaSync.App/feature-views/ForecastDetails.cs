using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.DataDisplay;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>ForecastDetails</c> feature surface — a parity port of
/// web/src/features/charging/components/cost-analysis/ForecastDetails.tsx. It renders the cost-forecast detail
/// trio in a three-column grid: the <b>Charging Breakdown</b> donut (the native analogue of the recharts
/// <c>PieChart</c> via <see cref="TsPieChart"/>) with a home-vs-supercharger legend showing each source's
/// per-kWh price; the <b>Gas vs EV Savings</b> panel with the animated monthly-savings hero, the annual /
/// lifetime figures and the gas / EV / distance rows; and the <b>Insights</b> list. Every state renders — a
/// three-panel loading skeleton, the populated trio, friendly per-panel empty surfaces when their data is
/// absent, an explicit retry surface on hard failure, plus stale and offline freshness chips. All data flows
/// through the shared <see cref="ForecastDetailsViewModel"/>; the view never performs HTTP. Entrances stagger
/// through <see cref="TsFadeIn"/> and the savings count-up both honour the system reduce-motion setting, every
/// string resolves through the i18n facade, and the surface + each legend / value carries a Narrator name.
/// </summary>
public sealed partial class ForecastDetails : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C";   // Segoe Fluent — Refresh
    private const string FuelGlyph = "\u26FD";      // ⛽ savings heading accent
    private const string InsightGlyph = "\U0001F4A1"; // 💡 insights heading accent
    private const string BoltGlyph = "\u26A1";      // ⚡ insight row accent
    private const string EmptyGlyph = "\uE9D2";     // Segoe Fluent — chart/empty document

    private const double PanelPadding = 24;          // web p-6
    private const double PanelSpacing = 16;          // web gap-4
    private const double DonutHeight = 180;          // web ResponsiveContainer height={180}
    private const double DonutInnerRadiusRatio = 0.66; // web innerRadius 50 / outerRadius 75
    private const double LegendDotSize = 8;          // web h-2 w-2
    private const double HeroNumberSize = 30;        // web text-3xl
    private const double CountUpSeconds = 1.5;       // web AnimatedNumber duration

    private const string SuccessBrushKey = "TsColorSuccessBrush";
    private const string DangerBrushKey = "TsColorDangerBrush";
    private const string SurfaceBrushKey = "TsColorSurfaceBrush";

    private readonly ForecastDetailsViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly ForecastDetailsDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly Border _headerHost = new() { Padding = new Thickness(0, 0, 0, 8) };
    private readonly Border _bodyHost = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;
    private bool _animated;
    private double _animatedValue;

    /// <summary>Creates the surface over its data source, localizer, diagnostics and (optional) currency symbol.</summary>
    public ForecastDetails(
        IForecastDetailsSource source,
        ILocalizer localizer,
        ForecastDetailsDiagnostics? diagnostics = null,
        string? currencySymbol = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new ForecastDetailsDiagnostics();
        _viewModel = new ForecastDetailsViewModel(source, localizer, currencySymbol);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        MinHeight = 240;
        AutomationProperties.SetName(this, _viewModel.Title);

        BuildChrome();

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical surface id (<c>forecast-details</c>).</summary>
    public static string SurfaceId => ForecastDetailsRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public ForecastDetailsViewModel ViewModel => _viewModel;

    /// <summary>The currency symbol used for the monetary figures; reassigning re-projects the snapshot.</summary>
    public string CurrencySymbol
    {
        get => _viewModel.CurrencySymbol;
        set => _viewModel.CurrencySymbol = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="ForecastDetailsSource"/> from the shared
    /// data layer (the host's P2-core dependencies), resolving the primary vehicle and the default six-month
    /// horizon, mirroring the web hook <c>useCostForecast(vehicleId, 6)</c>.
    /// </summary>
    public static ForecastDetails Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        ForecastDetailsDiagnostics? diagnostics = null,
        int months = ForecastDetailsSource.DefaultMonths,
        long? vehicleId = null,
        string? currencySymbol = null)
    {
        var source = new ForecastDetailsSource(vehicles, api, engine, options, months, vehicleId);
        return new ForecastDetails(source, localizer, diagnostics, currencySymbol);
    }

    private void BuildChrome()
    {
        _root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        _root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        Grid.SetRow(_headerHost, 0);
        Grid.SetRow(_bodyHost, 1);
        _root.Children.Add(_headerHost);
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
            case ForecastDetailsState.Loading:
                AutomationProperties.SetName(this, _viewModel.LoadingLabel);
                _headerHost.Child = null;
                _bodyHost.Child = BuildLoading();
                Content = _root;
                break;

            case ForecastDetailsState.Error:
                AutomationProperties.SetName(this, _viewModel.ErrorTitle);
                _headerHost.Child = null;
                _bodyHost.Child = BuildError();
                Content = _root;
                break;

            default:
                AutomationProperties.SetName(this, _viewModel.Title);
                _headerHost.Child = BuildHeader();
                _bodyHost.Child = BuildGrid(_viewModel.Display);
                Content = _root;
                break;
        }
    }

    // ── Header (freshness chip + stale/offline badge + refresh) ───────────────────────────────────────

    private StackPanel BuildHeader()
    {
        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
        };

        if (_viewModel.State is ForecastDetailsState.Stale or ForecastDetailsState.Offline)
        {
            actions.Children.Add(BuildFreshnessChip(_viewModel.State));
        }

        actions.Children.Add(new TsDataFreshness
        {
            UpdatedAt = _viewModel.UpdatedAt,
            IsFetching = _viewModel.IsFetching,
            IsError = _viewModel.State == ForecastDetailsState.Offline,
            VerticalAlignment = VerticalAlignment.Center,
        });

        actions.Children.Add(BuildRefreshButton());
        return actions;
    }

    private TsBadge BuildFreshnessChip(ForecastDetailsState state)
    {
        bool offline = state == ForecastDetailsState.Offline;
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

    // ── The three-panel grid (web grid-cols-1 lg:grid-cols-3) ─────────────────────────────────────────

    private Grid BuildGrid(ForecastDetailsDisplay display)
    {
        var grid = new Grid { ColumnSpacing = PanelSpacing };
        for (int i = 0; i < 3; i++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        AddPanel(grid, 0, BuildBreakdownPanel(display), 0);
        AddPanel(grid, 1, BuildSavingsPanel(display), 90);
        AddPanel(grid, 2, BuildInsightsPanel(display), 180);
        return grid;
    }

    private static void AddPanel(Grid grid, int column, FrameworkElement panel, int delayMs)
    {
        var fade = new TsFadeIn
        {
            DelayMs = delayMs,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Stretch,
            Content = panel,
        };
        Grid.SetColumn(fade, column);
        grid.Children.Add(fade);
    }

    // ── Panel 1: Charging Breakdown ───────────────────────────────────────────────────────────────────

    private static TsGlassPanel BuildBreakdownPanel(ForecastDetailsDisplay display)
    {
        var column = PanelColumn();
        column.Children.Add(BuildHeading(display.BreakdownTitle, null, null));

        if (display.HasData)
        {
            column.Children.Add(BuildDonut(display));
            column.Children.Add(BuildLegend(display));
        }
        else
        {
            column.Children.Add(BuildEmpty(display.NoBreakdownMessage));
        }

        return Panel(column, display.BreakdownTitle);
    }

    private static TsPieChart BuildDonut(ForecastDetailsDisplay display)
    {
        var points = new List<ChartPoint>(display.Segments.Count);
        foreach (var segment in display.Segments)
        {
            points.Add(new ChartPoint(0, segment.Percent, segment.Name));
        }

        var donut = new TsPieChart
        {
            Values = points,
            InnerRadiusRatio = DonutInnerRadiusRatio,
            Height = DonutHeight,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };
        AutomationProperties.SetName(donut, display.ChartSummary);
        return donut;
    }

    private static StackPanel BuildLegend(ForecastDetailsDisplay display)
    {
        var legend = new StackPanel { Spacing = 8 };
        foreach (var segment in display.Segments)
        {
            legend.Children.Add(BuildLegendRow(segment));
        }

        return legend;
    }

    private static Grid BuildLegendRow(ForecastBreakdownSegment segment)
    {
        var row = new Grid();
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var label = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        var dot = new Ellipse
        {
            Width = LegendDotSize,
            Height = LegendDotSize,
            Fill = ChartBrushes.ForIndex(segment.ColorIndex),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(dot, AccessibilityView.Raw);
        var name = new TextBlock
        {
            Text = segment.Name,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            VerticalAlignment = VerticalAlignment.Center,
        };
        label.Children.Add(dot);
        label.Children.Add(name);
        Grid.SetColumn(label, 0);

        var value = new TextBlock
        {
            Text = segment.CostPerKwhText,
            FontSize = 12,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextPrimary,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(value, 1);

        row.Children.Add(label);
        row.Children.Add(value);
        AutomationProperties.SetName(row, segment.AutomationName);
        return row;
    }

    // ── Panel 2: Gas vs EV Savings ────────────────────────────────────────────────────────────────────

    private TsGlassPanel BuildSavingsPanel(ForecastDetailsDisplay display)
    {
        var column = PanelColumn();
        column.Children.Add(BuildHeading(display.SavingsTitle, FuelGlyph, DisplayTokens.Brush(SuccessBrushKey)));

        if (display.HasData)
        {
            column.Children.Add(BuildMonthlyHero(display));
            column.Children.Add(BuildAnnualLifetime(display));
            column.Children.Add(BuildSavingsRows(display));
        }
        else
        {
            column.Children.Add(BuildEmpty(display.NoSavingsMessage));
        }

        return Panel(column, display.SavingsAutomationName);
    }

    private Border BuildMonthlyHero(ForecastDetailsDisplay display)
    {
        var inner = new StackPanel { Spacing = 4, HorizontalAlignment = HorizontalAlignment.Center };
        inner.Children.Add(new TextBlock
        {
            Text = display.MonthlySavingsLabel,
            FontSize = 11,
            CharacterSpacing = 80,
            Foreground = DisplayTokens.TextMuted,
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
        });
        inner.Children.Add(BuildAnimatedMoney(
            display.MonthlySavingsValue,
            display.MonthlySavingsText,
            display.CurrencySymbol,
            HeroNumberSize,
            DisplayTokens.Brush(SuccessBrushKey)));

        var hero = new Border
        {
            Padding = new Thickness(16),
            CornerRadius = DisplayTokens.Radius("TsRadiusLg", 12),
            Background = DisplayTokens.Brush(SurfaceBrushKey),
            HorizontalAlignment = HorizontalAlignment.Stretch,
            Child = inner,
        };
        AutomationProperties.SetName(hero, display.SavingsAutomationName);
        return hero;
    }

    private static Grid BuildAnnualLifetime(ForecastDetailsDisplay display)
    {
        var grid = new Grid { ColumnSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var annual = BuildStatBox(display.AnnualLabel, display.AnnualText);
        Grid.SetColumn(annual, 0);
        var lifetime = BuildStatBox(display.LifetimeLabel, display.LifetimeText);
        Grid.SetColumn(lifetime, 1);

        grid.Children.Add(annual);
        grid.Children.Add(lifetime);
        return grid;
    }

    private static Border BuildStatBox(string label, string value)
    {
        var inner = new StackPanel { Spacing = 2, HorizontalAlignment = HorizontalAlignment.Center };
        inner.Children.Add(new TextBlock
        {
            Text = label,
            FontSize = 11,
            Foreground = DisplayTokens.TextMuted,
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
        });
        inner.Children.Add(new TextBlock
        {
            Text = value,
            FontSize = 16,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
        });

        var box = new Border
        {
            Padding = new Thickness(12),
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            Background = DisplayTokens.Brush(SurfaceBrushKey),
            Child = inner,
        };
        AutomationProperties.SetName(box, $"{label} {value}");
        return box;
    }

    private static StackPanel BuildSavingsRows(ForecastDetailsDisplay display)
    {
        var rows = new StackPanel { Spacing = 4 };
        rows.Children.Add(BuildSavingsRow(display.GasCostLabel, display.GasCostText, DisplayTokens.Brush(DangerBrushKey)));
        rows.Children.Add(BuildSavingsRow(display.EvCostLabel, display.EvCostText, DisplayTokens.Brush(SuccessBrushKey)));
        rows.Children.Add(BuildSavingsRow(display.AvgKmLabel, display.AvgKmText, DisplayTokens.TextSecondary));
        return rows;
    }

    private static Grid BuildSavingsRow(string label, string value, Brush valueBrush)
    {
        var row = new Grid();
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var labelText = new TextBlock
        {
            Text = label,
            FontSize = 12,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(labelText, 0);

        var valueText = new TextBlock
        {
            Text = value,
            FontSize = 12,
            Foreground = valueBrush,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(valueText, 1);

        row.Children.Add(labelText);
        row.Children.Add(valueText);
        AutomationProperties.SetName(row, $"{label} {value}");
        return row;
    }

    // ── Panel 3: Insights ─────────────────────────────────────────────────────────────────────────────

    private static TsGlassPanel BuildInsightsPanel(ForecastDetailsDisplay display)
    {
        var column = PanelColumn();
        column.Children.Add(BuildHeading(display.InsightsTitle, InsightGlyph, DisplayTokens.TextMuted));

        if (display.Insights.Count > 0)
        {
            var list = new StackPanel { Spacing = 12 };
            foreach (var insight in display.Insights)
            {
                list.Children.Add(BuildInsightCard(insight));
            }

            column.Children.Add(list);
        }
        else
        {
            column.Children.Add(BuildEmpty(display.NoInsightsMessage));
        }

        return Panel(column, display.InsightsTitle);
    }

    private static Border BuildInsightCard(string insight)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
        var icon = new TextBlock
        {
            Text = BoltGlyph,
            FontSize = 13,
            VerticalAlignment = VerticalAlignment.Top,
            Margin = new Thickness(0, 2, 0, 0),
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        var text = new TextBlock
        {
            Text = insight,
            FontSize = 13,
            Foreground = DisplayTokens.TextSecondary,
            TextWrapping = TextWrapping.Wrap,
        };
        row.Children.Add(icon);
        row.Children.Add(text);

        var card = new Border
        {
            Padding = new Thickness(12),
            CornerRadius = DisplayTokens.Radius("TsRadiusLg", 12),
            Background = DisplayTokens.Brush(SurfaceBrushKey),
            Child = row,
        };
        AutomationProperties.SetName(card, insight);
        return card;
    }

    // ── Shared panel primitives ───────────────────────────────────────────────────────────────────────

    private static StackPanel PanelColumn() => new() { Spacing = 16 };

    private static TsGlassPanel Panel(FrameworkElement content, string automationName)
    {
        var panel = new TsGlassPanel
        {
            Padding = new Thickness(PanelPadding),
            VerticalAlignment = VerticalAlignment.Stretch,
            Content = content,
        };
        AutomationProperties.SetName(panel, automationName);
        return panel;
    }

    private static FrameworkElement BuildHeading(string title, string? glyph, Brush? glyphBrush)
    {
        var titleText = new TextBlock
        {
            Text = title,
            FontSize = 14,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
        };

        if (glyph is null)
        {
            AutomationProperties.SetName(titleText, title);
            return titleText;
        }

        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        var icon = new TextBlock
        {
            Text = glyph,
            FontSize = 14,
            Foreground = glyphBrush ?? DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        row.Children.Add(icon);
        row.Children.Add(titleText);
        AutomationProperties.SetName(row, title);
        return row;
    }

    private static TsEmptyState BuildEmpty(string message) => new()
    {
        IconGlyph = EmptyGlyph,
        Message = message,
        VerticalAlignment = VerticalAlignment.Center,
    };

    // ── Loading / Error surfaces ──────────────────────────────────────────────────────────────────────

    private Grid BuildLoading()
    {
        var grid = new Grid { ColumnSpacing = PanelSpacing };
        for (int i = 0; i < 3; i++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        for (int i = 0; i < 3; i++)
        {
            var panel = BuildSkeletonPanel();
            Grid.SetColumn(panel, i);
            grid.Children.Add(panel);
        }

        AutomationProperties.SetName(grid, _viewModel.LoadingLabel);
        LiveRegion.Configure(grid);
        LiveRegion.Announce(grid);
        return grid;
    }

    private static TsGlassPanel BuildSkeletonPanel()
    {
        var column = new StackPanel { Spacing = 14 };
        column.Children.Add(new TsSkeleton { BlockHeight = 16, BlockWidth = 140 });
        column.Children.Add(new TsSkeleton { BlockHeight = 120 });
        column.Children.Add(new TsSkeleton { BlockHeight = 14 });
        column.Children.Add(new TsSkeleton { BlockHeight = 14, BlockWidth = 160 });

        return new TsGlassPanel
        {
            Padding = new Thickness(PanelPadding),
            VerticalAlignment = VerticalAlignment.Stretch,
            Content = column,
        };
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Title = _viewModel.ErrorTitle,
            Message = _viewModel.ErrorMessage ?? _viewModel.ErrorTitle,
            ActionText = _viewModel.RetryLabel,
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnRetry;
        return error;
    }

    private void OnRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    // ── Reduce-motion-aware count-up (web AnimatedNumber) ─────────────────────────────────────────────

    private TextBlock BuildAnimatedMoney(double target, string finalText, string symbol, double fontSize, Brush foreground)
    {
        var text = new TextBlock
        {
            Text = finalText,
            FontSize = fontSize,
            FontWeight = FontWeights.Bold,
            Foreground = foreground,
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
        };

        // Animate the count-up only when motion is allowed and the value is new (avoid re-animating on an
        // incidental rebuild). Reduced motion / a repeat render snaps straight to the final figure, matching
        // the shared AnimatedNumberModel's reduce-motion contract and the web AnimatedNumber.
        bool reduce = MotionPreference.ReduceMotion;
        bool shouldAnimate = !reduce && (!_animated || !AreClose(_animatedValue, target));
        if (!shouldAnimate)
        {
            return text;
        }

        _animated = true;
        _animatedValue = target;

        var model = new AnimatedNumberModel(0, target, CountUpSeconds, reduceMotion: false);
        var timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(16) };
        var started = DateTimeOffset.MinValue;

        void Stop() => timer.Stop();

        text.Loaded += (_, _) =>
        {
            started = DateTimeOffset.Now;
            text.Text = FormatMoney(0, symbol);
            timer.Start();
        };
        text.Unloaded += (_, _) => Stop();
        timer.Tick += (_, _) =>
        {
            double elapsed = (DateTimeOffset.Now - started).TotalSeconds;
            if (model.IsComplete(elapsed))
            {
                text.Text = finalText;
                Stop();
                return;
            }

            text.Text = FormatMoney(model.ValueAt(elapsed), symbol);
        };

        return text;
    }

    private static string FormatMoney(double value, string symbol) =>
        ScalarFormatters.FormatCurrency(value, symbol, ForecastDetailsProjection.SavingsPrecision);

    private static bool AreClose(double a, double b) => Math.Abs(a - b) < 0.005;

    protected override AutomationPeer OnCreateAutomationPeer() => new ForecastDetailsAutomationPeer(this);

    private sealed class ForecastDetailsAutomationPeer(ForecastDetails owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((ForecastDetails)Owner).ViewModel.Title
                : name;
        }
    }
}
