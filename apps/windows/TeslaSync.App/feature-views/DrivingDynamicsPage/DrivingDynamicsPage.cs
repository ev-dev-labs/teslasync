using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Forms;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Driving;

/// <summary>
/// The native WinUI 3 <c>DrivingDynamicsPage</c> — a parity port of the web page
/// <c>web/src/features/driving/pages/DrivingDynamicsPage.tsx</c> (route <c>/driving-dynamics</c>, nav name
/// <c>DrivingDynamics</c>). It binds to a <see cref="DrivingDynamicsPageViewModel"/> and renders every web region
/// with Fluent components and design tokens: the page header (title + subtitle + data-freshness chip), the
/// loading shimmer, the retriable error surface, and — in the success state — the eleven web sections in order
/// (Live Motor Status, G-Force, Pedal Usage, Speed &amp; Gear, Autopilot &amp; Cruise, Motor-History charts,
/// Motor-Efficiency insights, Summary stats, Driving Coach, Drive Analytics and Driving Tips). Each section
/// renders its own empty state from the projection, never a blank panel. The view is a thin renderer: all branch
/// selection, formatting and i18n happen in the view-model's <see cref="DrivingDynamicsDisplay"/> projection.
/// State changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class DrivingDynamicsPage : UserControl, IDisposable
{
    private const double SectionSpacing = 24;
    private const double PanelPadding = 24;
    private const double GaugeDiameter = 120;
    private const double ChartHeight = 280;

    private readonly DrivingDynamicsPageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();
    private readonly TsDataFreshness _freshness = new();

    private readonly StackPanel _loadingSkeleton = new() { Spacing = SectionSpacing };
    private readonly TsQueryError _errorState = new();
    private readonly ContentControl _contentHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };

    /// <summary>Creates the page over the default empty feed and the shell resource localizer.</summary>
    public DrivingDynamicsPage()
        : this(EmptyDrivingDynamicsFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The seven-source driving-dynamics data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public DrivingDynamicsPage(IDrivingDynamicsFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new DrivingDynamicsPageViewModel(feed, localizer);

        BuildLoadingSkeleton();
        Content = BuildLayout();

        _errorState.ActionInvoked += OnRetryInvoked;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The diagnostics surface slug (<c>DrivingDynamicsPage</c>).</summary>
    public static string Slug => DrivingDynamicsRegistration.Slug;

    /// <summary>
    /// Wires the generated-client-backed feed for the active vehicle (the future DI host entry, ADR-004). The
    /// shell registers the parameterless ctor; a host with the contract client supplies live data through here.
    /// </summary>
    public static DrivingDynamicsPage Create(IApiClient api, long vehicleId, ILocalizer localizer) =>
        new(new DrivingDynamicsClientFeed(api, vehicleId), localizer);

    private ScrollViewer BuildLayout()
    {
        var stack = new StackPanel { Spacing = SectionSpacing, Padding = new Thickness(PanelPadding) };
        stack.Children.Add(BuildHeader());
        stack.Children.Add(_loadingSkeleton);
        stack.Children.Add(_errorState);
        stack.Children.Add(_contentHost);

        return new ScrollViewer
        {
            Content = stack,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
    }

    private Grid BuildHeader()
    {
        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var titles = new StackPanel { Spacing = 4, VerticalAlignment = VerticalAlignment.Center };
        titles.Children.Add(_title);
        titles.Children.Add(_subtitle);
        Grid.SetColumn(titles, 0);
        grid.Children.Add(titles);

        _freshness.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(_freshness, 1);
        grid.Children.Add(_freshness);

        return grid;
    }

    private void BuildLoadingSkeleton()
    {
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 200 });
        _loadingSkeleton.Children.Add(ColumnsGrid(3, 16, BuildSkeletonBlocks(3, 140)));
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = ChartHeight });
        _loadingSkeleton.Children.Add(ColumnsGrid(6, 12, BuildSkeletonBlocks(6, 96)));
    }

    private static List<FrameworkElement> BuildSkeletonBlocks(int count, double height)
    {
        var blocks = new List<FrameworkElement>(count);
        for (int i = 0; i < count; i++)
        {
            blocks.Add(new TsSkeleton { BlockHeight = height });
        }

        return blocks;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        _viewModel.NotifyOpened();
        await _viewModel.LoadAsync().ConfigureAwait(true);
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Unsubscribe from and dispose the view-model (CA1001; mirrors the sibling feature-view pages).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _errorState.ActionInvoked -= OnRetryInvoked;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnViewModelChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (_dispatcher.HasThreadAccess)
        {
            Render(_viewModel.Display);
        }
        else
        {
            _dispatcher.TryEnqueue(() => Render(_viewModel.Display));
        }
    }

    private void OnRetryInvoked(object? sender, EventArgs e) => InvokeAsync(() => _viewModel.RefreshAsync());

    private void OnRangePicked(DateRange range) => _viewModel.Range = range;

    private void Render(DrivingDynamicsDisplay display)
    {
        _title.Value = display.Title;
        _subtitle.Value = display.Subtitle;
        AutomationProperties.SetName(this, display.AutomationName);

        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;

        _loadingSkeleton.Visibility = Show(display.ShowLoading);

        _errorState.Visibility = Show(display.ShowError);
        _errorState.Message = display.ErrorText;
        _errorState.ActionText = display.RetryLabel;
        AutomationProperties.SetName(_errorState, display.ErrorText);

        _contentHost.Visibility = Show(display.ShowContent);
        _contentHost.Content = display.ShowContent ? BuildContent(display) : null;
    }

    private StackPanel BuildContent(DrivingDynamicsDisplay display)
    {
        var stack = new StackPanel { Spacing = SectionSpacing };
        stack.Children.Add(new TsFadeIn { Content = BuildLiveMotor(display.LiveMotor) });
        stack.Children.Add(new TsFadeIn { DelayMs = 50, Content = BuildGForce(display.GForce) });
        stack.Children.Add(new TsFadeIn { DelayMs = 100, Content = BuildPedal(display.Pedal) });
        stack.Children.Add(new TsFadeIn { DelayMs = 150, Content = BuildSpeedGear(display.SpeedGear) });
        stack.Children.Add(new TsFadeIn { DelayMs = 170, Content = BuildAutopilot(display.Autopilot) });
        stack.Children.Add(new TsFadeIn { DelayMs = 200, Content = BuildMotorCharts(display.MotorCharts) });
        stack.Children.Add(new TsFadeIn { DelayMs = 350, Content = BuildEfficiency(display.Efficiency) });
        stack.Children.Add(new TsFadeIn { DelayMs = 400, Content = BuildSummary(display.Summary) });
        stack.Children.Add(new TsFadeIn { DelayMs = 420, Content = BuildCoach(display.Coach) });
        stack.Children.Add(new TsFadeIn { DelayMs = 450, Content = BuildAnalytics(display.Analytics) });
        stack.Children.Add(new TsFadeIn { DelayMs = 600, Content = BuildTips(display.Tips) });
        return stack;
    }

    // ── 1. Live Motor Status ─────────────────────────────────────────────────────────────────────────────
    private static TsGlassPanel BuildLiveMotor(LiveMotorDisplay d)
    {
        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(new SectionTitle { Value = d.Title });

        if (d.HasData)
        {
            var tiles = new List<FrameworkElement>();
            foreach (var gauge in d.Gauges)
            {
                tiles.Add(BuildGaugeTile(gauge));
            }

            tiles.Add(BuildShiftTile(d.ShiftValue, d.ShiftStatus, d.ShiftCaption));
            column.Children.Add(ColumnsGrid(4, 24, tiles));
        }
        else
        {
            column.Children.Add(new TsEmptyState { IconGlyph = DrivingDynamicsProjection.CogGlyph, Message = d.EmptyMessage });
        }

        return Panel(column);
    }

    private static StackPanel BuildGaugeTile(DynGauge gauge)
    {
        var tile = new StackPanel { Spacing = 8, HorizontalAlignment = HorizontalAlignment.Center };
        tile.Children.Add(new TsRadialGauge
        {
            Value = gauge.Value,
            Max = gauge.Max,
            Label = gauge.Label,
            Unit = gauge.Unit,
            Role = gauge.Role,
            Decimals = gauge.Decimals,
            Diameter = GaugeDiameter,
            HorizontalAlignment = HorizontalAlignment.Center,
        });
        tile.Children.Add(new Caption { Value = gauge.Caption, HorizontalAlignment = HorizontalAlignment.Center });
        AutomationProperties.SetName(tile, gauge.AutomationName);
        return tile;
    }

    private static StackPanel BuildShiftTile(string value, StatusKind status, string caption)
    {
        var content = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
        content.Children.Add(new FontIcon { Glyph = DrivingDynamicsProjection.CogGlyph, FontSize = 14, VerticalAlignment = VerticalAlignment.Center });
        content.Children.Add(new TextBlock { Text = value, FontSize = 18, FontWeight = FontWeights.SemiBold, VerticalAlignment = VerticalAlignment.Center });

        var badge = new TsBadge { Status = status, Content = content, HorizontalAlignment = HorizontalAlignment.Center };
        var host = new Grid { Width = GaugeDiameter, Height = GaugeDiameter, HorizontalAlignment = HorizontalAlignment.Center };
        host.Children.Add(badge);

        var tile = new StackPanel { Spacing = 12, HorizontalAlignment = HorizontalAlignment.Center };
        tile.Children.Add(host);
        tile.Children.Add(new Caption { Value = caption, HorizontalAlignment = HorizontalAlignment.Center });
        AutomationProperties.SetName(tile, $"{caption}: {value}");
        return tile;
    }

    // ── 2. G-Force ───────────────────────────────────────────────────────────────────────────────────────
    private static TsGlassPanel BuildGForce(GForceDisplay d)
    {
        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(new SectionTitle { Value = d.Title });
        if (d.HasData)
        {
            column.Children.Add(BuildStatCardGrid(d.Cards, 3));
        }
        else
        {
            column.Children.Add(new TsEmptyState { IconGlyph = DrivingDynamicsProjection.GaugeGlyph, Message = d.EmptyMessage });
        }

        return Panel(column);
    }

    // ── 3. Pedal Usage ───────────────────────────────────────────────────────────────────────────────────
    private static TsGlassPanel BuildPedal(PedalDisplay d)
    {
        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(new SectionTitle { Value = d.Title });

        if (d.HasData)
        {
            var brakeTile = new StackPanel { Spacing = 12, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
            brakeTile.Children.Add(new FontIcon { Glyph = DrivingDynamicsProjection.CogGlyph, FontSize = 28, HorizontalAlignment = HorizontalAlignment.Center });
            brakeTile.Children.Add(new TsBadge { Status = d.BrakeStatus, Content = new Caption { Value = d.BrakeBadge }, HorizontalAlignment = HorizontalAlignment.Center });
            brakeTile.Children.Add(new Caption { Value = d.BrakeCaption, HorizontalAlignment = HorizontalAlignment.Center });
            AutomationProperties.SetName(brakeTile, $"{d.BrakeCaption}: {d.BrakeBadge}");

            var tiles = new List<FrameworkElement> { BuildGaugeTile(d.Throttle), BuildGaugeTile(d.Brake), brakeTile };
            column.Children.Add(ColumnsGrid(3, 24, tiles));
        }
        else
        {
            column.Children.Add(new TsEmptyState { IconGlyph = DrivingDynamicsProjection.GaugeGlyph, Message = d.EmptyMessage });
        }

        return Panel(column);
    }

    // ── 4. Speed & Gear ──────────────────────────────────────────────────────────────────────────────────
    private static TsGlassPanel BuildSpeedGear(SpeedGearDisplay d)
    {
        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(new SectionTitle { Value = d.Title });

        var shift = new StackPanel { Spacing = 8, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
        var shiftLetter = new TextBlock { Text = d.ShiftValue, FontSize = 44, FontWeight = FontWeights.Bold, HorizontalAlignment = HorizontalAlignment.Center };
        ApplyStatusForeground(shiftLetter, d.ShiftStatus);
        shift.Children.Add(shiftLetter);
        shift.Children.Add(new TsBadge { Status = d.ShiftStatus, Content = new Caption { Value = d.ShiftLabel }, HorizontalAlignment = HorizontalAlignment.Center });

        var tiles = new List<FrameworkElement>
        {
            shift,
            BuildMetricTile(d.PowerLabel, d.PowerValue, d.PowerUnit),
            BuildMetricTile(d.AvgSpeedLabel, d.AvgSpeedValue, d.SpeedUnit),
            BuildMetricTile(d.TopSpeedLabel, d.TopSpeedValue, d.SpeedUnit),
        };
        column.Children.Add(ColumnsGrid(4, 24, tiles));
        return Panel(column);
    }

    private static StackPanel BuildMetricTile(string label, string value, string unit)
    {
        var tile = new StackPanel { Spacing = 4, HorizontalAlignment = HorizontalAlignment.Center };
        tile.Children.Add(new Caption { Value = label, HorizontalAlignment = HorizontalAlignment.Center });
        tile.Children.Add(new MetricValue { Value = value, HorizontalAlignment = HorizontalAlignment.Center });
        tile.Children.Add(new Caption { Value = unit, HorizontalAlignment = HorizontalAlignment.Center });
        AutomationProperties.SetName(tile, $"{label}: {value} {unit}");
        return tile;
    }

    // ── 5. Autopilot & Cruise ────────────────────────────────────────────────────────────────────────────
    private static TsGlassPanel BuildAutopilot(AutopilotDisplay d)
    {
        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(new SectionTitle { Value = d.Title });
        if (d.HasData)
        {
            column.Children.Add(BuildStatCardGrid(d.Cards, 3));
        }
        else
        {
            column.Children.Add(new TsEmptyState { IconGlyph = DrivingDynamicsProjection.NavigationGlyph, Message = d.EmptyMessage });
        }

        return Panel(column);
    }

    // ── 6. Motor History charts ──────────────────────────────────────────────────────────────────────────
    private static StackPanel BuildMotorCharts(MotorChartsDisplay d)
    {
        var stack = new StackPanel { Spacing = SectionSpacing };
        stack.Children.Add(BuildChartCard(d.Power));
        stack.Children.Add(BuildChartCard(d.Torque));
        stack.Children.Add(BuildChartCard(d.Rpm));
        return stack;
    }

    // ── 7. Motor Efficiency Insights ─────────────────────────────────────────────────────────────────────
    private static Grid BuildEfficiency(EfficiencyInsightsDisplay d)
    {
        var torque = new StackPanel { Spacing = 12 };
        torque.Children.Add(BuildPanelHeader(DrivingDynamicsProjection.ZapGlyph, d.TorqueTitle));
        if (d.HasData)
        {
            foreach (var row in d.TorqueRows)
            {
                torque.Children.Add(BuildKeyValueRow(row));
            }
        }
        else
        {
            torque.Children.Add(new TsEmptyState { IconGlyph = DrivingDynamicsProjection.ActivityGlyph, Message = d.EmptyMessage });
        }

        var throttle = new StackPanel { Spacing = 12 };
        throttle.Children.Add(BuildPanelHeader(DrivingDynamicsProjection.GaugeGlyph, d.ThrottleTitle));
        if (d.HasData)
        {
            throttle.Children.Add(BuildKeyValueRow(new DynKeyValue(d.AvgPowerLabel, d.AvgPowerValue)));
            var styleRow = new Grid();
            styleRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            styleRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            var styleLabel = new Text { Value = d.StyleLabel, VerticalAlignment = VerticalAlignment.Center };
            Grid.SetColumn(styleLabel, 0);
            var styleBadge = new TsBadge { Status = d.StyleStatus, Content = new Caption { Value = d.StyleText }, VerticalAlignment = VerticalAlignment.Center };
            Grid.SetColumn(styleBadge, 1);
            styleRow.Children.Add(styleLabel);
            styleRow.Children.Add(styleBadge);
            throttle.Children.Add(styleRow);
            throttle.Children.Add(new TsMetricBar { Value = d.StyleBarValue, Max = d.StyleBarMax, AccentBrushKey = d.StyleBarAccent });
        }
        else
        {
            throttle.Children.Add(new TsEmptyState { IconGlyph = DrivingDynamicsProjection.ActivityGlyph, Message = d.EmptyMessage });
        }

        var thermal = new StackPanel { Spacing = 12 };
        thermal.Children.Add(BuildPanelHeader(DrivingDynamicsProjection.ThermometerGlyph, d.ThermalTitle));
        if (d.HasData)
        {
            foreach (var row in d.ThermalRows)
            {
                thermal.Children.Add(BuildKeyValueRow(row));
            }

            thermal.Children.Add(new TsBadge { Status = d.ThermalStatus, Content = new Caption { Value = d.ThermalBadge }, HorizontalAlignment = HorizontalAlignment.Left });
        }
        else
        {
            thermal.Children.Add(new TsEmptyState { IconGlyph = DrivingDynamicsProjection.ActivityGlyph, Message = d.EmptyMessage });
        }

        var panels = new List<FrameworkElement>
        {
            new TsGlassPanel { Padding = new Thickness(20), Content = torque },
            new TsGlassPanel { Padding = new Thickness(20), Content = throttle },
            new TsGlassPanel { Padding = new Thickness(20), Content = thermal },
        };
        return ColumnsGrid(3, 16, panels);
    }

    // ── 8. Summary Stats ─────────────────────────────────────────────────────────────────────────────────
    private static Grid BuildSummary(SummaryStatsDisplay d) => BuildStatCardGrid(d.Cards, 6);

    // ── 9. Driving Coach ─────────────────────────────────────────────────────────────────────────────────
    private static StackPanel BuildCoach(CoachDisplay d)
    {
        var stack = new StackPanel { Spacing = SectionSpacing };
        stack.Children.Add(new SectionTitle { Value = d.Title });

        // Score + Style + Efficiency (3-up).
        var scorePanel = new StackPanel { Spacing = 12, HorizontalAlignment = HorizontalAlignment.Center };
        scorePanel.Children.Add(new TsRadialGauge
        {
            Value = d.GaugeValue,
            Max = 100,
            Label = d.GaugeLabel,
            Role = StatusToRole(d.GaugeStatus),
            Decimals = 0,
            Diameter = 160,
            HorizontalAlignment = HorizontalAlignment.Center,
        });
        scorePanel.Children.Add(new Caption { Value = d.DrivesAnalyzed, HorizontalAlignment = HorizontalAlignment.Center });

        var stylePanel = new StackPanel { Spacing = 12 };
        stylePanel.Children.Add(new PanelTitle { Value = d.StyleTitle });
        if (d.StyleHasData)
        {
            stylePanel.Children.Add(BuildStyleBar(d.StyleSegments));
            foreach (var row in d.StyleRows)
            {
                stylePanel.Children.Add(BuildStyleLegendRow(row));
            }
        }
        else
        {
            stylePanel.Children.Add(new TsEmptyState { IconGlyph = DrivingDynamicsProjection.ActivityGlyph, Message = d.StyleEmptyMessage });
        }

        var effPanel = new StackPanel { Spacing = 12 };
        effPanel.Children.Add(new TsStatCard { Label = d.AvgEffLabel, Value = d.AvgEffValue, Glyph = DrivingDynamicsProjection.ZapGlyph });
        effPanel.Children.Add(new TsStatCard { Label = d.BestEffLabel, Value = d.BestEffValue, Glyph = DrivingDynamicsProjection.GaugeGlyph });

        var topRow = ColumnsGrid(3, 16, new List<FrameworkElement>
        {
            new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = scorePanel },
            new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = stylePanel },
            new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = effPanel },
        });
        stack.Children.Add(topRow);

        // Weekly trend chart.
        var weeklyBody = new StackPanel { Spacing = 12 };
        weeklyBody.Children.Add(new PanelTitle { Value = d.WeeklyTitle });
        if (d.WeeklyHasData)
        {
            var chart = new TsLineChart { Series = [ToChartSeries(d.WeeklySeries)], ShowLegend = false, MinHeight = 200 };
            AutomationProperties.SetName(chart, d.WeeklyTitle);
            weeklyBody.Children.Add(chart);
        }
        else
        {
            weeklyBody.Children.Add(new TsEmptyState { IconGlyph = DrivingDynamicsProjection.ActivityGlyph, Message = d.WeeklyEmptyMessage });
        }

        stack.Children.Add(new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = weeklyBody });

        // Pattern indicators.
        var patterns = new StackPanel { Spacing = 12 };
        patterns.Children.Add(new PanelTitle { Value = d.PatternsTitle });
        foreach (var p in d.Patterns)
        {
            patterns.Children.Add(BuildPatternRow(p));
        }

        stack.Children.Add(new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = patterns });

        // Recommendations.
        var recs = new StackPanel { Spacing = 12 };
        recs.Children.Add(BuildPanelHeader(DrivingDynamicsProjection.ZapGlyph, d.RecommendationsTitle));
        if (d.RecsHasData)
        {
            foreach (var r in d.Recommendations)
            {
                recs.Children.Add(BuildRecRow(r));
            }
        }
        else
        {
            recs.Children.Add(new TsEmptyState { IconGlyph = DrivingDynamicsProjection.ActivityGlyph, Message = d.RecsEmptyMessage });
        }

        stack.Children.Add(new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = recs });

        // Per-drive scores table.
        var perDrive = new StackPanel { Spacing = 12 };
        perDrive.Children.Add(new PanelTitle { Value = d.PerDriveTitle });
        if (d.PerDriveHasData)
        {
            perDrive.Children.Add(BuildPerDriveTable(d));
        }
        else
        {
            perDrive.Children.Add(new TsEmptyState { IconGlyph = DrivingDynamicsProjection.ActivityGlyph, Message = d.PerDriveEmptyMessage });
        }

        stack.Children.Add(new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = perDrive });
        return stack;
    }

    private static Border BuildStyleBar(IReadOnlyList<CoachStyleSegment> segments)
    {
        var grid = new Grid { Height = 16, MinWidth = 80 };
        foreach (var seg in segments)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(Math.Max(0.0001, seg.Fraction), GridUnitType.Star) });
        }

        for (int i = 0; i < segments.Count; i++)
        {
            var fill = new Border { Background = StatusBrush(segments[i].Status) };
            ToolTipService.SetToolTip(fill, segments[i].Tooltip);
            Grid.SetColumn(fill, i);
            grid.Children.Add(fill);
        }

        return new Border { CornerRadius = new CornerRadius(8), Child = grid };
    }

    private static Grid BuildStyleLegendRow(CoachStyleRow row)
    {
        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var left = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        left.Children.Add(new Border { Width = 8, Height = 8, CornerRadius = new CornerRadius(4), Background = StatusBrush(row.Status), VerticalAlignment = VerticalAlignment.Center });
        left.Children.Add(new Caption { Value = row.Label });
        Grid.SetColumn(left, 0);

        var count = new Text { Value = row.Count, VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(count, 1);

        grid.Children.Add(left);
        grid.Children.Add(count);
        AutomationProperties.SetName(grid, $"{row.Label}: {row.Count}");
        return grid;
    }

    private static StackPanel BuildPatternRow(CoachPatternRow p)
    {
        var column = new StackPanel { Spacing = 4 };
        var header = new Grid();
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var label = new Caption { Value = p.Label };
        Grid.SetColumn(label, 0);
        var value = new Caption { Value = p.ValueText };
        Grid.SetColumn(value, 1);
        header.Children.Add(label);
        header.Children.Add(value);
        column.Children.Add(header);
        column.Children.Add(new TsMetricBar { Value = p.BarValue, Max = 100, AccentBrushKey = StatusResources.AccentBrushKey(p.Status) });
        AutomationProperties.SetName(column, $"{p.Label}: {p.ValueText}");
        return column;
    }

    private static Grid BuildRecRow(CoachRecRow r)
    {
        var grid = new Grid { ColumnSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        var badge = new TsBadge { Status = r.ImpactStatus, Content = new Caption { Value = r.Impact }, VerticalAlignment = VerticalAlignment.Top };
        Grid.SetColumn(badge, 0);
        var tip = new Text { Value = r.Tip };
        Grid.SetColumn(tip, 1);
        grid.Children.Add(badge);
        grid.Children.Add(tip);
        return grid;
    }

    private static TsDataTable BuildPerDriveTable(CoachDisplay d)
    {
        var table = new TsDataTable { Selectable = false, EmptyMessage = d.PerDriveEmptyMessage };
        table.Columns =
        [
            new TsDataColumn { Key = "date", Header = d.PerDriveColumns[0], IsNumeric = false },
            new TsDataColumn { Key = "score", Header = d.PerDriveColumns[1], IsNumeric = true },
            new TsDataColumn { Key = "style", Header = d.PerDriveColumns[2], IsNumeric = false },
            new TsDataColumn { Key = "efficiency", Header = d.PerDriveColumns[3], IsNumeric = true },
            new TsDataColumn { Key = "distance", Header = d.PerDriveColumns[4], IsNumeric = true },
        ];

        var rows = new List<TsDataRow>(d.PerDriveRows.Count);
        foreach (var r in d.PerDriveRows)
        {
            rows.Add(new TsDataRow(r.Id, new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["date"] = r.Date,
                ["score"] = r.Score,
                ["style"] = r.Style,
                ["efficiency"] = r.Efficiency,
                ["distance"] = r.Distance,
            }));
        }

        table.Rows = rows;
        AutomationProperties.SetName(table, d.PerDriveTitle);
        return table;
    }

    // ── 10. Drive Analytics ──────────────────────────────────────────────────────────────────────────────
    private StackPanel BuildAnalytics(AnalyticsDisplay d)
    {
        var stack = new StackPanel { Spacing = SectionSpacing };
        stack.Children.Add(new SectionTitle { Value = d.Title });

        var picker = new TsRangePicker { StartLabel = d.StartLabel, EndLabel = d.EndLabel, Range = d.Range };
        picker.RangeChanged += (_, r) => OnRangePicked(r);
        AutomationProperties.SetName(picker, $"{d.StartLabel} \u2013 {d.EndLabel}");
        stack.Children.Add(picker);

        var topRow = ColumnsGrid(2, 16, new List<FrameworkElement>
        {
            BuildChartCard(d.SpeedDistribution),
            BuildChartCard(d.Acceleration),
        });
        stack.Children.Add(topRow);
        stack.Children.Add(BuildChartCard(d.PowerProfile));
        return stack;
    }

    // ── 11. Driving Tips ─────────────────────────────────────────────────────────────────────────────────
    private static TsGlassPanel BuildTips(TipsDisplay d)
    {
        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(BuildPanelHeader(DrivingDynamicsProjection.ZapGlyph, d.Title));
        foreach (var tip in d.Tips)
        {
            var row = new Grid { ColumnSpacing = 12 };
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            var icon = new FontIcon
            {
                Glyph = tip.Positive ? DrivingDynamicsProjection.GaugeGlyph : DrivingDynamicsProjection.ZapGlyph,
                FontSize = 16,
                VerticalAlignment = VerticalAlignment.Top,
            };
            ApplyStatusForeground(icon, tip.Positive ? StatusKind.Success : StatusKind.Warning);
            Grid.SetColumn(icon, 0);
            var text = new Text { Value = tip.Text };
            Grid.SetColumn(text, 1);
            row.Children.Add(icon);
            row.Children.Add(text);
            column.Children.Add(row);
        }

        return Panel(column);
    }

    // ── Shared primitives ────────────────────────────────────────────────────────────────────────────────
    private static TsChartContainer BuildChartCard(DynChartCard card)
    {
        var container = new TsChartContainer
        {
            Title = card.Title,
            Subtitle = card.Subtitle,
            AccessibleSummary = card.AriaLabel,
            EmptyMessage = card.EmptyMessage,
            DataViewLabel = card.Title,
            State = card.HasData ? ChartState.Ready : ChartState.Empty,
        };

        var series = ToChartSeries(card.Series);
        if (card.HasData)
        {
            var chart = MakeChart(card.Series, series, card.Annotations);
            AutomationProperties.SetName(chart, card.AriaLabel);
            container.Body = chart;
            container.DataView.Series = series;
            container.DataView.XLabel = card.XLabel;
        }
        else
        {
            container.Body = null;
            container.DataView.Series = System.Array.Empty<ChartSeries>();
        }

        return container;
    }

    private static TsCartesianChart MakeChart(
        IReadOnlyList<DynSeries> source,
        List<ChartSeries> series,
        IReadOnlyList<ChartAnnotation> annotations)
    {
        ChartSeriesKind kind = source.Count > 0 ? source[0].Kind : ChartSeriesKind.Line;
        TsCartesianChart chart = kind switch
        {
            ChartSeriesKind.Area => new TsAreaChart(),
            ChartSeriesKind.Bar => new TsBarChart(),
            ChartSeriesKind.Scatter => new TsScatterChart(),
            _ => new TsLineChart(),
        };

        chart.Series = series;
        chart.ShowLegend = series.Count > 1;
        chart.MinHeight = ChartHeight;
        if (annotations.Count > 0)
        {
            chart.Annotations = annotations;
        }

        return chart;
    }

    private static List<ChartSeries> ToChartSeries(IReadOnlyList<DynSeries> source)
    {
        var built = new List<ChartSeries>(source.Count);
        foreach (var s in source)
        {
            built.Add(ToChartSeries(s));
        }

        return built;
    }

    private static ChartSeries ToChartSeries(DynSeries s) =>
        new(s.Name, s.Points)
        {
            Kind = s.Kind,
            Role = s.Role,
            ColorIndex = s.ColorIndex,
            Unit = s.Unit,
        };

    private static Grid BuildStatCardGrid(IReadOnlyList<DynStatCard> cards, int columns)
    {
        var tiles = new List<FrameworkElement>(cards.Count);
        foreach (var card in cards)
        {
            var tile = new TsStatCard { Label = card.Label, Value = card.Value, Glyph = card.Glyph };
            AutomationProperties.SetName(tile, card.AutomationName);
            tiles.Add(tile);
        }

        return ColumnsGrid(columns, 16, tiles);
    }

    private static StackPanel BuildPanelHeader(string glyph, string title)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        row.Children.Add(new FontIcon { Glyph = glyph, FontSize = 16, VerticalAlignment = VerticalAlignment.Center });
        row.Children.Add(new PanelTitle { Value = title, VerticalAlignment = VerticalAlignment.Center });
        return row;
    }

    private static Grid BuildKeyValueRow(DynKeyValue row)
    {
        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var label = new Text { Value = row.Label, VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(label, 0);
        var value = new Text { Value = row.Value, VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(value, 1);
        grid.Children.Add(label);
        grid.Children.Add(value);
        AutomationProperties.SetName(grid, $"{row.Label}: {row.Value}");
        return grid;
    }

    private static TsGlassPanel Panel(UIElement content) =>
        new() { Padding = new Thickness(PanelPadding), Content = content };

    private static Grid ColumnsGrid(int columns, double spacing, List<FrameworkElement> children)
    {
        int cols = Math.Max(1, columns);
        int rows = (int)Math.Ceiling(children.Count / (double)cols);

        var grid = new Grid { ColumnSpacing = spacing, RowSpacing = spacing };
        for (int c = 0; c < cols; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        for (int r = 0; r < Math.Max(1, rows); r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < children.Count; i++)
        {
            var child = children[i];
            Grid.SetColumn(child, i % cols);
            Grid.SetRow(child, i / cols);
            grid.Children.Add(child);
        }

        return grid;
    }

    private static void ApplyStatusForeground(TextBlock element, StatusKind status)
    {
        if (Application.Current.Resources.TryGetValue(StatusResources.AccentBrushKey(status), out var brush)
            && brush is Microsoft.UI.Xaml.Media.Brush b)
        {
            element.Foreground = b;
        }
    }

    private static void ApplyStatusForeground(FontIcon element, StatusKind status)
    {
        if (Application.Current.Resources.TryGetValue(StatusResources.AccentBrushKey(status), out var brush)
            && brush is Microsoft.UI.Xaml.Media.Brush b)
        {
            element.Foreground = b;
        }
    }

    private static Microsoft.UI.Xaml.Media.Brush StatusBrush(StatusKind status)
    {
        if (Application.Current.Resources.TryGetValue(StatusResources.AccentBrushKey(status), out var brush)
            && brush is Microsoft.UI.Xaml.Media.Brush b)
        {
            return b;
        }

        return new Microsoft.UI.Xaml.Media.SolidColorBrush(Microsoft.UI.Colors.Gray);
    }

    private static ChartRole StatusToRole(StatusKind status) => status switch
    {
        StatusKind.Success => ChartRole.Regen,
        StatusKind.Warning => ChartRole.Energy,
        StatusKind.Danger => ChartRole.Power,
        _ => ChartRole.None,
    };

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;

    private static async void InvokeAsync(Func<Task> action) => await action().ConfigureAwait(true);

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new DrivingDynamicsPageAutomationPeer(this);

    private sealed class DrivingDynamicsPageAutomationPeer(DrivingDynamicsPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
