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
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.VehicleSystems;

/// <summary>
/// The native WinUI 3 <c>TirePressurePage</c> — a parity port of the web page
/// <c>web/src/features/vehicle-systems/pages/TirePressurePage.tsx</c> (route <c>/tire-pressure</c>, nav name
/// <c>TirePressure</c>). It binds to a <see cref="TirePressurePageViewModel"/> and renders every web region with
/// Fluent components and design tokens: the page header (title + subtitle + data-freshness chip), the loading
/// shimmer, the retriable error surface, the page-level empty surface, and — in the success state — the TPMS
/// warning banner ("GlassPanel1"), the current-readings panel ("GlassPanel2") with its four per-corner radial
/// gauge cards ("GlassPanel3"), the four summary metric cards (Avg / Min / Warning-Count / Last-Updated), the
/// pressure-history line chart ("GlassPanel8") and the pressure-history table ("GlassPanel9"). The view is a
/// thin renderer: all branch selection, formatting and i18n happen in the view-model's
/// <see cref="TirePressureDisplay"/> projection. State changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class TirePressurePage : UserControl, IDisposable
{
    private const double SectionSpacing = 24;
    private const double PanelPadding = 24;
    private const double GaugeDiameter = 120;

    private readonly TirePressurePageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();
    private readonly TsDataFreshness _freshness = new();

    private readonly StackPanel _loadingSkeleton = new() { Spacing = SectionSpacing };
    private readonly TsQueryError _errorState = new();
    private readonly TsEmptyState _emptyState = new() { IconGlyph = TirePressureRegistration.EmptyGlyph };
    private readonly ContentControl _contentHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };

    /// <summary>Creates the page over the default empty feed and the shell resource localizer.</summary>
    public TirePressurePage()
        : this(EmptyTirePressureFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The two-source tyre-pressure data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public TirePressurePage(ITirePressureFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new TirePressurePageViewModel(feed, localizer);

        BuildLoadingSkeleton();
        Content = BuildLayout();

        _errorState.ActionInvoked += OnRetryInvoked;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The diagnostics surface slug (<c>TirePressurePage</c>).</summary>
    public static string Slug => TirePressureRegistration.Slug;

    private ScrollViewer BuildLayout()
    {
        var stack = new StackPanel { Spacing = SectionSpacing, Padding = new Thickness(PanelPadding) };
        stack.Children.Add(BuildHeader());
        stack.Children.Add(_loadingSkeleton);
        stack.Children.Add(_errorState);
        stack.Children.Add(_emptyState);
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
        _loadingSkeleton.Children.Add(ColumnsGrid(4, 16, BuildSkeletonBlocks(4, 96)));
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 300 });
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 200 });
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

    private void Render(TirePressureDisplay display)
    {
        _title.Value = display.Title;
        _subtitle.Value = display.Subtitle;
        AutomationProperties.SetName(this, display.AutomationName);

        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
        AutomationProperties.SetHelpText(_freshness, display.SelectVehicleLabel);

        _loadingSkeleton.Visibility = Show(display.ShowLoading);

        _errorState.Visibility = Show(display.ShowError);
        _errorState.Message = display.ErrorText;
        _errorState.ActionText = display.RetryLabel;
        AutomationProperties.SetName(_errorState, display.ErrorText);

        _emptyState.Visibility = Show(display.ShowEmpty);
        _emptyState.Message = display.EmptyMessage;

        _contentHost.Visibility = Show(display.ShowContent);
        _contentHost.Content = display.ShowContent ? BuildContent(display) : null;
    }

    private static StackPanel BuildContent(TirePressureDisplay display)
    {
        var stack = new StackPanel { Spacing = SectionSpacing };
        stack.Children.Add(BuildWarningBanner(display));
        stack.Children.Add(new TsFadeIn { DelayMs = 50, Content = BuildCurrentReadings(display) });
        stack.Children.Add(new TsFadeIn { DelayMs = 100, Content = BuildSummaryCards(display.SummaryCards) });
        stack.Children.Add(new TsFadeIn { DelayMs = 150, Content = BuildHistoryChart(display) });
        stack.Children.Add(new TsFadeIn { DelayMs = 200, Content = BuildHistoryTable(display) });
        return stack;
    }

    // ── TPMS warning banner (GlassPanel1) — visible only when a hard/soft warning is active ──────────────
    private static TsGlassPanel BuildWarningBanner(TirePressureDisplay display)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 12,
            VerticalAlignment = VerticalAlignment.Center,
        };

        row.Children.Add(new FontIcon
        {
            Glyph = TirePressureProjection.WarningGlyph,
            FontSize = 18,
            Foreground = display.WarningStatus == StatusKind.Danger
                ? DisplayTokens.Brush(StatusResources.AccentBrushKey(StatusKind.Danger))
                : DisplayTokens.Brush(StatusResources.AccentBrushKey(StatusKind.Warning)),
            VerticalAlignment = VerticalAlignment.Center,
        });

        var badge = new TsBadge
        {
            Status = display.WarningStatus,
            Content = new TextBlock { Text = display.WarningBannerText },
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(badge, display.WarningBannerText);
        row.Children.Add(badge);

        var panel = new TsGlassPanel
        {
            Padding = new Thickness(16, 12, 16, 12),
            Content = row,
            Visibility = Show(display.HasWarning),
        };
        AutomationProperties.SetName(panel, display.WarningBannerText);
        return panel;
    }

    // ── Current-readings panel (GlassPanel2) with four per-corner gauge cards (GlassPanel3) ──────────────
    private static TsGlassPanel BuildCurrentReadings(TirePressureDisplay display)
    {
        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(TitleRow(TirePressureProjection.GaugeGlyph, display.CurrentReadingsLabel));

        var cards = new List<FrameworkElement>(display.Gauges.Count);
        foreach (var gauge in display.Gauges)
        {
            cards.Add(BuildGaugeCard(gauge));
        }

        column.Children.Add(ColumnsGrid(4, 16, cards));
        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
    }

    private static TsGlassPanel BuildGaugeCard(TirePressureGaugeDisplay gauge)
    {
        var column = new StackPanel
        {
            Spacing = 12,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        column.Children.Add(new TsRadialGauge
        {
            Value = gauge.GaugeValue,
            Max = gauge.GaugeMax,
            Label = gauge.Label,
            Unit = gauge.GaugeUnit,
            ColorIndex = gauge.GaugeColorIndex,
            Decimals = 1,
            Diameter = GaugeDiameter,
        });

        var badge = new TsBadge
        {
            Status = gauge.BadgeStatus,
            Content = new TextBlock { Text = gauge.BadgeLabel },
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        AutomationProperties.SetName(badge, gauge.BadgeLabel);
        column.Children.Add(badge);

        var card = new TsGlassPanel { Padding = new Thickness(16), Content = column };
        AutomationProperties.SetName(card, gauge.AutomationName);
        return card;
    }

    // ── Four summary metric cards (Avg-Pressure / Min-Pressure / Warning-Count / Last-Updated) ───────────
    private static Grid BuildSummaryCards(IReadOnlyList<TirePressureMetricDisplay> metrics)
    {
        var cards = new List<FrameworkElement>(metrics.Count);
        foreach (var metric in metrics)
        {
            var card = new TsStatCard { Label = metric.Label, Value = metric.Value, Glyph = metric.Glyph };
            AutomationProperties.SetName(card, metric.AutomationName);
            cards.Add(card);
        }

        return ColumnsGrid(4, 16, cards);
    }

    // ── Pressure-history line chart (GlassPanel8) ────────────────────────────────────────────────────────
    private static TsGlassPanel BuildHistoryChart(TirePressureDisplay display)
    {
        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(TitleRow(TirePressureProjection.GaugeGlyph, display.PressureHistoryTitle));

        var chart = new TsLineChart
        {
            Title = display.HistoryChart.Title,
            Series = BuildSeries(display.HistoryChart.Series),
            ShowLegend = true,
            IncludeZero = false,
            MinHeight = 300,
        };

        column.Children.Add(new TsChartContainer
        {
            Title = display.HistoryChart.Title,
            AccessibleSummary = display.HistoryChart.AriaLabel,
            State = display.HistoryChart.HasData ? ChartState.Ready : ChartState.Empty,
            Body = chart,
            EmptyMessage = display.HistoryChart.EmptyMessage,
        });

        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
    }

    // ── Pressure-history table (GlassPanel9) ─────────────────────────────────────────────────────────────
    private static TsGlassPanel BuildHistoryTable(TirePressureDisplay display)
    {
        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(TitleRow(TirePressureProjection.ClockGlyph, display.HistoryTableTitle));

        if (display.TableRows.Count > 0)
        {
            column.Children.Add(BuildTable(display));
        }
        else
        {
            column.Children.Add(new TsEmptyState
            {
                IconGlyph = TirePressureProjection.ClockGlyph,
                Message = display.TableEmptyMessage,
            });
        }

        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
    }

    private static TsDataTable BuildTable(TirePressureDisplay display)
    {
        var table = new TsDataTable { Selectable = false, EmptyMessage = display.TableEmptyMessage };
        table.Columns =
        [
            new TsDataColumn { Key = "time", Header = display.TableColumns[0], IsNumeric = false },
            new TsDataColumn { Key = "fl", Header = display.TableColumns[1], IsNumeric = true },
            new TsDataColumn { Key = "fr", Header = display.TableColumns[2], IsNumeric = true },
            new TsDataColumn { Key = "rl", Header = display.TableColumns[3], IsNumeric = true },
            new TsDataColumn { Key = "rr", Header = display.TableColumns[4], IsNumeric = true },
            new TsDataColumn { Key = "warnings", Header = display.TableColumns[5], IsNumeric = false },
        ];

        var rows = new List<TsDataRow>(display.TableRows.Count);
        foreach (var row in display.TableRows)
        {
            rows.Add(new TsDataRow(row.Id, new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["time"] = row.Time,
                ["fl"] = row.FrontLeft,
                ["fr"] = row.FrontRight,
                ["rl"] = row.RearLeft,
                ["rr"] = row.RearRight,
                ["warnings"] = row.Warnings,
            }));
        }

        table.Rows = rows;
        AutomationProperties.SetName(table, display.HistoryTableTitle);
        return table;
    }

    // ── Shared primitives ────────────────────────────────────────────────────────────────────────────────
    private static StackPanel TitleRow(string glyph, string text)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        row.Children.Add(new FontIcon
        {
            Glyph = glyph,
            FontSize = 16,
            Foreground = DisplayTokens.Accent,
            VerticalAlignment = VerticalAlignment.Center,
        });
        row.Children.Add(new SectionTitle { Value = text, VerticalAlignment = VerticalAlignment.Center });
        return row;
    }

    private static List<ChartSeries> BuildSeries(IReadOnlyList<TirePressureSeriesDisplay> series)
    {
        var built = new List<ChartSeries>(series.Count);
        foreach (var s in series)
        {
            built.Add(new ChartSeries(s.Name, s.Points)
            {
                Kind = ChartSeriesKind.Line,
                ColorIndex = s.ColorIndex,
            });
        }

        return built;
    }

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

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;

    private static async void InvokeAsync(Func<Task> action) => await action().ConfigureAwait(true);

    protected override AutomationPeer OnCreateAutomationPeer() => new TirePressurePageAutomationPeer(this);

    private sealed class TirePressurePageAutomationPeer(TirePressurePage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
