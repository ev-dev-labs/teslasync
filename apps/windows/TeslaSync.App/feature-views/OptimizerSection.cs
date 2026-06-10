using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 charging Optimizer feature surface — a parity port of
/// web/src/features/charging/components/charging-list/OptimizerSection.tsx. It reproduces the web composition:
/// the conditional success "savings" banner (web <c>potential_monthly_savings &gt; 5</c>), the three-up grid
/// of the Charging Habits panel, the Battery-Friendly Score radial gauge with its colour-coded caption, and
/// the Cost Analysis panel; the weekly Cost Heatmap (reusing the sibling cost-heatmap projection, mounted when
/// there are weekly entries); and the Optimization Recommendations list (or a friendly empty state). The web
/// component is a pure child of the charging-list page; the native surface binds its own cache-then-network
/// <see cref="OptimizerSectionViewModel"/>, so it renders every state the P2 contract requires — the skeleton
/// while loading, a retry surface on a hard failure, a friendly empty state when the optimizer query returned
/// no body, and a freshness chip (stale / offline) over the content otherwise. The view never performs HTTP.
/// Every string resolves through the i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class OptimizerSection : ContentControl, IDisposable
{
    private const string CalendarGlyph = "\uE787"; // Segoe Fluent — Calendar (web lucide <Calendar/>)
    private const string DollarGlyph = "\uE1D3"; // Segoe Fluent — money (web lucide <DollarSign/>)
    private const string LightbulbGlyph = "\uEA80"; // Segoe Fluent — Lightbulb (web lucide <Lightbulb/>)
    private const string ShieldGlyph = "\uEA18"; // Segoe Fluent — Shield (web lucide <Shield/>)
    private const string ClockGlyph = "\uE121"; // Segoe Fluent — Clock (web lucide <Clock/> on the heatmap)
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh

    private const int BannerFadeDelayMs = 230; // web FadeIn delay={0.23}
    private const int GridFadeDelayMs = 240; // web FadeIn delay={0.24}
    private const int HeatmapFadeDelayMs = 270; // web FadeIn delay={0.27}
    private const int RecommendationsFadeDelayMs = 280; // web FadeIn delay={0.28}

    private const double GaugeDiameter = 150; // web RadialGauge size={150}
    private const double PanelPadding = 24; // web GlassPanel p-6
    private const double SectionSpacing = 16; // web gap-4

    // Heatmap grid metrics (web aspect-square cells / gap-0.5 / rounded-sm / w-10 day gutter).
    private const double CellSize = 20;
    private const double CellSpacing = 2;
    private const double CellRadius = 2;
    private const double DayLabelWidth = 40;
    private const double SwatchSize = 12;

    private readonly OptimizerSectionViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly OptimizerSectionDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer and (optional) diagnostics.</summary>
    public OptimizerSection(
        IOptimizerSectionSource source,
        ILocalizer localizer,
        OptimizerSectionDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new OptimizerSectionDiagnostics();
        _viewModel = new OptimizerSectionViewModel(source, localizer);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        AutomationProperties.SetName(this, _viewModel.Display.AriaLabel);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical surface id (<c>optimizer-section</c>).</summary>
    public static string SurfaceId => OptimizerSectionRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting/diagnostics).</summary>
    public OptimizerSectionViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="OptimizerSectionSource"/> from the
    /// shared data layer (the host's P2-core dependencies), resolving the primary cached vehicle unless an
    /// explicit <paramref name="vehicleId"/> is supplied.
    /// </summary>
    public static OptimizerSection Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        long? vehicleId = null,
        OptimizerSectionDiagnostics? diagnostics = null)
    {
        var source = new OptimizerSectionSource(vehicles, api, engine, options, vehicleId);
        return new OptimizerSection(source, localizer, diagnostics);
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
        AutomationProperties.SetName(this, display.AriaLabel);

        Content = _viewModel.State switch
        {
            OptimizerSectionState.Loading => BuildLoading(),
            OptimizerSectionState.Error => BuildErrorSurface(),
            OptimizerSectionState.Empty => BuildEmptySurface(display),
            _ => BuildContent(display),
        };
    }

    // ── Loading (skeleton chrome) ───────────────────────────────────────────────────────────────────────

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = SectionSpacing };
        column.Children.Add(new TsSkeleton { BlockHeight = 56, ReduceMotion = MotionPreference.ReduceMotion });

        var grid = ThreeColumnGrid();
        for (int i = 0; i < 3; i++)
        {
            var card = new TsSkeleton { BlockHeight = 200, ReduceMotion = MotionPreference.ReduceMotion };
            Grid.SetColumn(card, i);
            grid.Children.Add(card);
        }

        column.Children.Add(grid);
        column.Children.Add(new TsSkeleton { BlockHeight = 160, ReduceMotion = MotionPreference.ReduceMotion });

        AutomationProperties.SetName(column, _localizer.GetString("common.loading", "Loading..."));
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    // ── Error surface (web QueryError) ──────────────────────────────────────────────────────────────────

    private TsQueryError BuildErrorSurface()
    {
        var error = new TsQueryError
        {
            Title = OptimizerSectionRegistration.Name(_localizer),
            Message = _viewModel.ErrorMessage
                ?? _localizer.GetString("error.loadFailed", "Failed to load data"),
            ActionText = _localizer.GetString("common.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;
        return error;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    // ── Empty surface (web parent renders nothing without a body) ───────────────────────────────────────

    private static TsEmptyState BuildEmptySurface(OptimizerSectionDisplay display)
    {
        var empty = new TsEmptyState
        {
            IconGlyph = LightbulbGlyph,
            Message = display.EmptyMessage,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(empty, display.EmptyMessage);
        return empty;
    }

    // ── Content (Loaded / Stale / Offline) ──────────────────────────────────────────────────────────────

    private StackPanel BuildContent(OptimizerSectionDisplay display)
    {
        var column = new StackPanel { Spacing = SectionSpacing };
        column.Children.Add(BuildFreshnessHeader());

        if (display.ShowSavingsBanner)
        {
            column.Children.Add(Fade(BannerFadeDelayMs, BuildSavingsBanner(display)));
        }

        column.Children.Add(Fade(GridFadeDelayMs, BuildPanelsGrid(display)));

        if (display.ShowHeatmap)
        {
            column.Children.Add(Fade(HeatmapFadeDelayMs, BuildHeatmapPanel(display.Heatmap)));
        }

        column.Children.Add(Fade(RecommendationsFadeDelayMs, BuildRecommendationsPanel(display)));

        AutomationProperties.SetName(column, display.AriaLabel);
        return column;
    }

    private static TsFadeIn Fade(int delayMs, UIElement content) => new()
    {
        DelayMs = delayMs,
        Content = content,
    };

    // ── Freshness header (stale / offline chip + refresh) ───────────────────────────────────────────────

    private Grid BuildFreshnessHeader()
    {
        var header = new Grid();
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
        };

        if (_viewModel.State is OptimizerSectionState.Stale or OptimizerSectionState.Offline)
        {
            actions.Children.Add(BuildFreshnessChip(_viewModel.State));
        }

        actions.Children.Add(new TsDataFreshness
        {
            UpdatedAt = _viewModel.UpdatedAt,
            IsFetching = _viewModel.IsFetching,
            IsError = _viewModel.State == OptimizerSectionState.Offline,
            VerticalAlignment = VerticalAlignment.Center,
        });

        actions.Children.Add(BuildRefreshButton());

        Grid.SetColumn(actions, 1);
        header.Children.Add(actions);
        return header;
    }

    private TsBadge BuildFreshnessChip(OptimizerSectionState state)
    {
        bool offline = state == OptimizerSectionState.Offline;
        string text = offline
            ? _localizer.GetString("common.offline", "Offline")
            : _localizer.GetString("charging.curve.stale", "Stale");

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

    // ── Savings banner (web AlertBanner variant="success") ──────────────────────────────────────────────

    private static TsAlertBanner BuildSavingsBanner(OptimizerSectionDisplay display)
    {
        var banner = new TsAlertBanner
        {
            Variant = CalloutVariant.Success,
            Title = display.SavingsBannerTitle,
            Message = display.SavingsBannerMessage,
            Dismissible = false,
        };
        return banner;
    }

    // ── Three-up panel grid (habits / battery score / cost) ─────────────────────────────────────────────

    private static Grid BuildPanelsGrid(OptimizerSectionDisplay display)
    {
        var grid = ThreeColumnGrid();

        var habits = BuildHabitsPanel(display);
        Grid.SetColumn(habits, 0);
        grid.Children.Add(habits);

        var score = BuildBatteryScorePanel(display);
        Grid.SetColumn(score, 1);
        grid.Children.Add(score);

        var cost = BuildCostPanel(display);
        Grid.SetColumn(cost, 2);
        grid.Children.Add(cost);

        return grid;
    }

    private static Grid ThreeColumnGrid()
    {
        var grid = new Grid { ColumnSpacing = SectionSpacing };
        for (int i = 0; i < 3; i++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        return grid;
    }

    private static TsGlassPanel BuildHabitsPanel(OptimizerSectionDisplay display)
    {
        var content = new StackPanel { Spacing = 12 };
        content.Children.Add(BuildPanelHeader(CalendarGlyph, DisplayTokens.Accent, display.HabitsTitle));
        content.Children.Add(BuildRows(display.HabitRows));
        return Panel(content, display.HabitsTitle);
    }

    private static TsGlassPanel BuildBatteryScorePanel(OptimizerSectionDisplay display)
    {
        var content = new StackPanel
        {
            Spacing = 8,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        // TsRadialGauge tints its arc from a themed chart role (no arbitrary hex like the web gauge); the
        // battery-friendly score band (web green / amber / red) is conveyed by the colour-coded caption below.
        var gauge = new TsRadialGauge
        {
            Value = display.BatteryHealthScore,
            Max = 100,
            Decimals = 0,
            Label = display.BatteryScoreTitle,
            Role = ChartRole.Battery,
            Diameter = GaugeDiameter,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        AutomationProperties.SetName(
            gauge,
            string.Format(
                CultureInfo.CurrentCulture,
                "{0}: {1}",
                display.BatteryScoreTitle,
                ScalarFormatValue(display.BatteryHealthScore)));
        content.Children.Add(gauge);

        var caption = new Caption
        {
            Value = display.BatteryScoreCaption,
            HorizontalAlignment = HorizontalAlignment.Center,
            Foreground = StatusBrush(display.BatteryScoreStatus),
        };
        content.Children.Add(caption);

        return Panel(content, string.Format(
            CultureInfo.CurrentCulture, "{0}. {1}", display.BatteryScoreTitle, display.BatteryScoreCaption));
    }

    private static TsGlassPanel BuildCostPanel(OptimizerSectionDisplay display)
    {
        var content = new StackPanel { Spacing = 12 };
        content.Children.Add(BuildPanelHeader(
            DollarGlyph, StatusBrush(StatusKind.Success), display.CostAnalysisTitle));
        content.Children.Add(BuildRows(display.CostRows));
        return Panel(content, display.CostAnalysisTitle);
    }

    private static TsGlassPanel Panel(UIElement content, string automationName)
    {
        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = content };
        AutomationProperties.SetName(panel, automationName);
        return panel;
    }

    private static StackPanel BuildPanelHeader(string glyph, Brush iconBrush, string title)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        var icon = new FontIcon
        {
            Glyph = glyph,
            FontSize = 16,
            Foreground = iconBrush,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        row.Children.Add(icon);
        row.Children.Add(new PanelTitle { Value = title, VerticalAlignment = VerticalAlignment.Center });
        return row;
    }

    private static StackPanel BuildRows(IReadOnlyList<OptimizerStatRow> rows)
    {
        var column = new StackPanel { Spacing = 10 };
        foreach (var row in rows)
        {
            column.Children.Add(BuildRow(row));
        }

        return column;
    }

    private static Grid BuildRow(OptimizerStatRow row)
    {
        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var label = new TextBlock
        {
            Text = row.Label,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            VerticalAlignment = VerticalAlignment.Center,
            TextWrapping = TextWrapping.Wrap,
        };
        Grid.SetColumn(label, 0);

        var value = new TextBlock
        {
            Text = row.Value,
            FontSize = 12,
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
            Foreground = ToneBrush(row.Tone),
            TextAlignment = TextAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(value, 1);

        grid.Children.Add(label);
        grid.Children.Add(value);
        AutomationProperties.SetName(grid, string.Format(CultureInfo.CurrentCulture, "{0}: {1}", row.Label, row.Value));
        return grid;
    }

    // ── Cost heatmap (reuses the shared cost-heatmap projection) ────────────────────────────────────────

    private static TsGlassPanel BuildHeatmapPanel(CostHeatmapDisplay heatmap)
    {
        var content = new StackPanel { Spacing = SectionSpacing };
        content.Children.Add(BuildPanelHeader(ClockGlyph, DisplayTokens.Accent, heatmap.Title));
        content.Children.Add(BuildHeatmapGrid(heatmap));

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = content };
        AutomationProperties.SetName(panel, heatmap.AriaLabel);
        return panel;
    }

    private static ScrollViewer BuildHeatmapGrid(CostHeatmapDisplay display)
    {
        var grid = new StackPanel { Spacing = CellSpacing };
        grid.Children.Add(BuildHourLabels(display.HourLabels));
        foreach (var row in display.Rows)
        {
            grid.Children.Add(BuildDayRow(row));
        }

        grid.Children.Add(BuildLegend(display));

        var scroller = new ScrollViewer
        {
            HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Disabled,
            HorizontalScrollMode = ScrollMode.Auto,
            VerticalScrollMode = ScrollMode.Disabled,
            Content = grid,
        };
        AutomationProperties.SetName(scroller, display.AriaLabel);
        return scroller;
    }

    private static StackPanel BuildHourLabels(IReadOnlyList<string> hourLabels)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = CellSpacing };
        row.Children.Add(new Border { Width = DayLabelWidth });
        foreach (var label in hourLabels)
        {
            row.Children.Add(new TextBlock
            {
                Text = label,
                Width = CellSize,
                FontSize = 9,
                TextAlignment = TextAlignment.Center,
                Foreground = DisplayTokens.TextMuted,
            });
        }

        AutomationProperties.SetAccessibilityView(row, AccessibilityView.Raw);
        return row;
    }

    private static StackPanel BuildDayRow(CostHeatmapRow row)
    {
        var line = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = CellSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };
        line.Children.Add(new TextBlock
        {
            Text = row.DayLabel,
            Width = DayLabelWidth,
            FontSize = 10,
            TextAlignment = TextAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
            Foreground = DisplayTokens.TextMuted,
        });

        foreach (var cell in row.Cells)
        {
            line.Children.Add(BuildCell(cell));
        }

        return line;
    }

    private static Border BuildCell(CostHeatmapCell cell)
    {
        var fill = cell.Fill;
        var border = new Border
        {
            Width = CellSize,
            Height = CellSize,
            CornerRadius = new CornerRadius(CellRadius),
            Background = new SolidColorBrush(Windows.UI.Color.FromArgb(fill.AlphaByte, fill.R, fill.G, fill.B)),
        };

        ToolTipService.SetToolTip(border, cell.Tooltip);
        AutomationProperties.SetName(border, cell.Tooltip);
        if (!cell.HasSessions)
        {
            AutomationProperties.SetAccessibilityView(border, AccessibilityView.Raw);
        }

        return border;
    }

    private static StackPanel BuildLegend(CostHeatmapDisplay display)
    {
        var legend = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
        };

        legend.Children.Add(new Caption { Value = display.CheapLabel, VerticalAlignment = VerticalAlignment.Center });

        var swatches = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = CellSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };
        foreach (var swatch in display.LegendSwatches)
        {
            var box = new Border
            {
                Width = SwatchSize,
                Height = SwatchSize,
                CornerRadius = new CornerRadius(CellRadius),
                Background = new SolidColorBrush(
                    Windows.UI.Color.FromArgb(swatch.AlphaByte, swatch.R, swatch.G, swatch.B)),
            };
            AutomationProperties.SetAccessibilityView(box, AccessibilityView.Raw);
            swatches.Children.Add(box);
        }

        legend.Children.Add(swatches);
        legend.Children.Add(new Caption { Value = display.ExpensiveLabel, VerticalAlignment = VerticalAlignment.Center });
        return legend;
    }

    // ── Recommendations (cards or friendly empty state) ─────────────────────────────────────────────────

    private static TsGlassPanel BuildRecommendationsPanel(OptimizerSectionDisplay display)
    {
        var content = new StackPanel { Spacing = 12 };
        content.Children.Add(BuildPanelHeader(
            LightbulbGlyph, StatusBrush(StatusKind.Warning), display.RecommendationsTitle));

        if (display.HasRecommendations)
        {
            foreach (var rec in display.Recommendations)
            {
                content.Children.Add(BuildRecommendationCard(rec));
            }
        }
        else
        {
            content.Children.Add(new TsEmptyState { Message = display.NoRecommendationsMessage });
        }

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = content };
        AutomationProperties.SetName(panel, display.RecommendationsTitle);
        return panel;
    }

    private static Border BuildRecommendationCard(OptimizerRecommendationView rec)
    {
        var statusBrush = StatusBrush(rec.Status);

        var row = new Grid { ColumnSpacing = 12 };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var shield = new FontIcon
        {
            Glyph = ShieldGlyph,
            FontSize = 18,
            Foreground = statusBrush,
            VerticalAlignment = VerticalAlignment.Top,
        };
        AutomationProperties.SetAccessibilityView(shield, AccessibilityView.Raw);
        Grid.SetColumn(shield, 0);
        row.Children.Add(shield);

        var body = new StackPanel { Spacing = 4 };

        var titleRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        titleRow.Children.Add(new TextBlock
        {
            Text = rec.Title,
            FontSize = 14,
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
            TextWrapping = TextWrapping.Wrap,
        });

        if (!string.IsNullOrEmpty(rec.PriorityLabel))
        {
            titleRow.Children.Add(BuildChip(rec.PriorityLabel.ToUpper(CultureInfo.CurrentCulture), rec.Status));
        }

        if (rec.ShowSavings)
        {
            titleRow.Children.Add(BuildChip(rec.SavingsLabel, StatusKind.Success));
        }

        body.Children.Add(titleRow);
        body.Children.Add(new TextBlock
        {
            Text = rec.Detail,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            TextWrapping = TextWrapping.Wrap,
        });
        Grid.SetColumn(body, 1);
        row.Children.Add(body);

        var card = new Border
        {
            CornerRadius = new CornerRadius(12),
            Padding = new Thickness(16),
            BorderThickness = new Thickness(1),
            BorderBrush = TintBrush(statusBrush, 40),
            Background = TintBrush(statusBrush, 16),
            Child = row,
        };
        AutomationProperties.SetName(card, rec.AutomationName);
        return card;
    }

    private static TsBadge BuildChip(string text, StatusKind status)
    {
        var badge = new TsBadge
        {
            Status = status,
            Content = new TextBlock { Text = text, FontSize = 10 },
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(badge, text);
        return badge;
    }

    // ── Shared token helpers ────────────────────────────────────────────────────────────────────────────

    private static Brush ToneBrush(OptimizerValueTone tone) => tone switch
    {
        OptimizerValueTone.Primary => DisplayTokens.TextPrimary,
        OptimizerValueTone.Muted => DisplayTokens.TextSecondary,
        OptimizerValueTone.Danger => StatusBrush(StatusKind.Danger),
        OptimizerValueTone.Success => StatusBrush(StatusKind.Success),
        _ => DisplayTokens.TextPrimary,
    };

    private static Brush StatusBrush(StatusKind status) => DisplayTokens.Brush(StatusResources.AccentBrushKey(status));

    private static string ScalarFormatValue(double value) =>
        ChartPalette.FormatValue(Math.Clamp(value, 0, 100), 0);

    // Derive a low-alpha tint from a themed status brush (web bg-*/[0.06] / border-*/[0.10]); a dynamic
    // computed colour, not a static inline style.
    private static Brush TintBrush(Brush source, byte alpha)
    {
        if (source is SolidColorBrush solid)
        {
            var c = solid.Color;
            return new SolidColorBrush(Windows.UI.Color.FromArgb(alpha, c.R, c.G, c.B));
        }

        return source;
    }
}
