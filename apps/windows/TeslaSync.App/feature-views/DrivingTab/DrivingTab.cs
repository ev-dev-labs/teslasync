using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Analytics;

/// <summary>
/// The native WinUI 3 <c>DrivingTab</c> feature surface — a parity port of
/// <c>web/src/features/analytics/components/analytics/DrivingTab.tsx</c> together with its
/// <c>DrivingPerformanceCards</c> and <c>DrivingTemperatureStats</c> children. It is presentational: assign
/// a <see cref="Model"/> (the web <c>data?.drive_analytics</c> + the parent-owned load phase) and
/// <see cref="Units"/> (the web <c>useUnits</c>) and it renders exactly one of the surface states —
/// <see cref="DrivingTabState.Loading"/> (skeleton chrome), <see cref="DrivingTabState.Error"/> (a
/// <see cref="TsQueryError"/> retry surface that raises <see cref="RetryRequested"/>), or the section
/// scaffold (<see cref="DrivingTabState.Empty"/> / <see cref="DrivingTabState.Ready"/>, plus a stale /
/// offline freshness chip for <see cref="DrivingTabState.Stale"/> / <see cref="DrivingTabState.Offline"/>):
/// the six-tile performance grid, the seven chart panels (speed / trip-distance / hourly / temperature-vs
/// -efficiency / daily-trend / duration / efficiency-trend — each rendering its native chart or its localized
/// empty state) and the six-tile temperature-stats grid. The view never performs HTTP; all branch selection,
/// unit conversion and label resolution happen in the WinUI-free <see cref="DrivingTabProjection"/>. Every
/// string resolves through the i18n facade and every panel/card/chart carries a Narrator name.
/// </summary>
public sealed partial class DrivingTab : ContentControl
{
    private const int MetricGridColumns = 3;
    private const double ChartMinHeight = 260;

    private readonly ILocalizer _localizer;
    private readonly DrivingTabDiagnostics _diagnostics;

    private DrivingTabModel _model;
    private UnitPref _units;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, units, and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="DrivingTabModel.Pending"/>.</param>
    /// <param name="units">The user's unit preference; defaults to <see cref="UnitPref.Metric"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public DrivingTab(
        ILocalizer localizer,
        DrivingTabModel? model = null,
        UnitPref? units = null,
        DrivingTabDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? DrivingTabModel.Pending;
        _units = units ?? UnitPref.Metric;
        _diagnostics = diagnostics ?? new DrivingTabDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>Raised when the user invokes the error-state retry affordance (the parent owns the refetch).</summary>
    public event EventHandler? RetryRequested;

    /// <summary>The canonical diagnostics slug this surface registers under (<c>DrivingTab</c>).</summary>
    public static string Slug => DrivingTabRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public DrivingTabModel Model
    {
        get => _model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _model = value;
            Render();
        }
    }

    /// <summary>The user's unit preference; reassigning re-projects the metrics and charts in the new units.</summary>
    public UnitPref Units
    {
        get => _units;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _units = value;
            Render();
        }
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_opened)
        {
            return;
        }

        _opened = true;
        _diagnostics.RecordViewOpened();
    }

    private void Render()
    {
        var display = DrivingTabProjection.Project(_model, _units, _localizer);
        AutomationProperties.SetName(this, display.AutomationName);

        Content = display.State switch
        {
            DrivingTabState.Loading => BuildLoading(display),
            DrivingTabState.Error => BuildError(display),
            _ => BuildContent(display),
        };
    }

    // ── Content (web FadeIn wrapping the section scaffold) ───────────────────────────────────────────
    private static ScrollViewer BuildContent(DrivingTabDisplay display)
    {
        var stack = new StackPanel { Spacing = 16, Padding = new Thickness(0, 16, 0, 0) };

        if (display.StatusChip != DriveStatusChip.None)
        {
            stack.Children.Add(BuildStatusChip(display));
        }

        // Web parity: DrivingPerformanceCards is a bare metric grid (no panel), always populated.
        stack.Children.Add(BuildCardGrid(display.PerformanceCards.Cards));

        foreach (var section in display.Charts)
        {
            stack.Children.Add(BuildChartPanel(section));
        }

        stack.Children.Add(BuildMetricPanel(display.TemperatureStats));

        var fade = new TsFadeIn { Content = stack };
        AutomationProperties.SetName(fade, display.AutomationName);

        return new ScrollViewer
        {
            Content = fade,
            VerticalScrollMode = ScrollMode.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollMode = ScrollMode.Disabled,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
    }

    private static TsStatusPill BuildStatusChip(DrivingTabDisplay display)
    {
        var pill = new TsStatusPill
        {
            Status = display.StatusChip == DriveStatusChip.Offline ? StatusKind.Danger : StatusKind.Warning,
            Content = display.StatusChipLabel,
            HorizontalAlignment = HorizontalAlignment.Left,
        };
        AutomationProperties.SetName(pill, display.StatusChipLabel);
        return pill;
    }

    // One titled GlassPanel wrapping a native chart or its empty state (web GlassPanel + SectionTitle block).
    private static TsGlassPanel BuildChartPanel(DriveChartSection section)
    {
        var stack = new StackPanel { Spacing = 12 };
        stack.Children.Add(new PanelTitle { Value = section.Title });

        if (section.HasData)
        {
            // A single composed surface renders every kind (bar / line / area / scatter) by each series'
            // own ChartSeriesKind — the native analogue of the web BarChart / ComposedChart / ScatterChart /
            // AreaChart the source picks per section.
            var chart = new TsComposedChart
            {
                Title = section.Title,
                Series = section.Series,
                ShowLegend = section.Series.Count > 1,
                IncludeZero = !HasScatter(section.Series),
                MinHeight = ChartMinHeight,
                HorizontalAlignment = HorizontalAlignment.Stretch,
            };
            AutomationProperties.SetName(chart, section.AccessibleSummary);
            stack.Children.Add(chart);
        }
        else
        {
            stack.Children.Add(new TsEmptyState { Message = section.EmptyMessage });
        }

        var panel = new TsGlassPanel { Padding = new Thickness(16), Content = stack };
        AutomationProperties.SetName(panel, section.AutomationName);
        return panel;
    }

    // The temperature-stats GlassPanel: title + the six-tile grid, or its empty fallback.
    private static TsGlassPanel BuildMetricPanel(DriveMetricSection section)
    {
        var stack = new StackPanel { Spacing = 12 };
        stack.Children.Add(new PanelTitle { Value = section.Title });

        if (section.HasData)
        {
            stack.Children.Add(BuildCardGrid(section.Cards));
        }
        else
        {
            stack.Children.Add(new TsEmptyState { Message = section.EmptyMessage });
        }

        var panel = new TsGlassPanel { Padding = new Thickness(16), Content = stack };
        AutomationProperties.SetName(panel, section.AutomationName);
        return panel;
    }

    private static Grid BuildCardGrid(IReadOnlyList<DriveMetricCard> cards)
    {
        int columns = Math.Min(MetricGridColumns, Math.Max(1, cards.Count));
        int rows = (int)Math.Ceiling(cards.Count / (double)columns);

        var grid = new Grid { ColumnSpacing = 12, RowSpacing = 12 };
        for (int c = 0; c < columns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < cards.Count; i++)
        {
            var tile = BuildMetricCard(cards[i]);
            Grid.SetColumn(tile, i % columns);
            Grid.SetRow(tile, i / columns);
            grid.Children.Add(tile);
        }

        return grid;
    }

    private static TsMetricCard BuildMetricCard(DriveMetricCard card)
    {
        // The unit rides the metric card's caption slot (the web MetricCard `subtitle` is the unit label).
        var tile = new TsMetricCard
        {
            Label = card.Label,
            Value = card.Value,
            AccentBrushKey = card.AccentBrushKey,
            DeltaText = card.Unit,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };
        AutomationProperties.SetName(tile, card.AutomationName);
        return tile;
    }

    private static StackPanel BuildLoading(DrivingTabDisplay display)
    {
        bool reduceMotion = MotionPreference.ReduceMotion;
        var column = new StackPanel { Spacing = 16, Padding = new Thickness(0, 16, 0, 0) };

        // The performance-grid skeleton, then one skeleton per chart panel (web WidgetShell loading chrome).
        column.Children.Add(new TsSkeleton { BlockHeight = 64, Radius = 8, ReduceMotion = reduceMotion });
        for (int i = 0; i < 4; i++)
        {
            column.Children.Add(new TsSkeleton { BlockHeight = 200, Radius = 8, ReduceMotion = reduceMotion });
        }

        AutomationProperties.SetName(column, display.AutomationName);
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsQueryError BuildError(DrivingTabDisplay display)
    {
        var error = new TsQueryError
        {
            Message = display.ErrorMessage,
            ActionText = display.RetryLabel,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnRetry;
        AutomationProperties.SetName(error, display.AutomationName);
        return error;
    }

    private void OnRetry(object? sender, EventArgs e) => RetryRequested?.Invoke(this, EventArgs.Empty);

    private static bool HasScatter(IReadOnlyList<ChartSeries> series)
    {
        foreach (var s in series)
        {
            if (s.Kind == ChartSeriesKind.Scatter)
            {
                return true;
            }
        }

        return false;
    }
}
