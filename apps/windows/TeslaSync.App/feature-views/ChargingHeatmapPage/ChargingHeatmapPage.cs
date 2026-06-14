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
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Charging;

/// <summary>
/// The native WinUI 3 <c>ChargingHeatmapPage</c> — a parity port of the web page
/// <c>web/src/features/charging/pages/ChargingHeatmapPage.tsx</c> (route <c>/charging-heatmap</c>, nav name
/// <c>ChargingHeatmap</c>). It binds to a <see cref="ChargingHeatmapPageViewModel"/> and renders every web
/// region with Fluent components and design tokens: the page header (title + subtitle + data-freshness chip);
/// the loading skeleton; the retriable error surface; and — in the content state — the four summary stat
/// GlassPanels (Total Sessions / Total Energy / Total Cost / Avg Duration, "GlassPanel1".."GlassPanel4"), the
/// Favorite Charging Time GlassPanel ("GlassPanel5"), the weekly 7×24 charging heatmap grid with its hour
/// header, day rows, hover/Narrator tooltips and Less→More legend ("GlassPanel6"), and the Top Charging
/// Locations GlassPanel whose bar chart (or empty state) breaks sessions down by place ("GlassPanel7"). The
/// view is a thin renderer: all branch selection, reduction, the heat-colour buckets, formatting and i18n
/// happen in the view-model's <see cref="ChargingHeatmapDisplay"/> projection. State changes are marshalled
/// onto the UI thread.
/// </summary>
public sealed partial class ChargingHeatmapPage : UserControl, IDisposable
{
    private const double SectionSpacing = 24;
    private const double PanelPadding = 16;
    private const double ColumnGap = 16;

    private const double DayLabelWidth = 56;   // web grid-cols-[56px_…]
    private const double CellWidth = 24;
    private const double CellHeight = 26;       // web h-7
    private const double CellSpacing = 2;       // web gap-[2px]
    private const double CellRadius = 3;        // web rounded-sm
    private const double SwatchWidth = 24;      // web legend w-6
    private const double SwatchHeight = 12;     // web legend h-3
    private const double LocationsChartMinHeight = 280;

    private readonly ChargingHeatmapPageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();
    private readonly TsDataFreshness _freshness = new();

    private readonly StackPanel _loadingSkeleton = new() { Spacing = SectionSpacing };
    private readonly TsQueryError _errorState = new();

    private readonly StackPanel _contentPanel = new() { Spacing = SectionSpacing };

    // GlassPanel1..4 — the four summary stat cards.
    private readonly Caption _sessionsLabel = new();
    private readonly MetricValue _sessionsValue = new();
    private readonly TsGlassPanel _sessionsPanel;
    private readonly Caption _energyLabel = new();
    private readonly MetricValue _energyValue = new();
    private readonly TsGlassPanel _energyPanel;
    private readonly Caption _costLabel = new();
    private readonly MetricValue _costValue = new();
    private readonly TsGlassPanel _costPanel;
    private readonly Caption _durationLabel = new();
    private readonly MetricValue _durationValue = new();
    private readonly TsGlassPanel _durationPanel;

    // GlassPanel5 — favorite charging time.
    private readonly TsGlassPanel _favoritePanel = new();
    private readonly Caption _favoriteLabel = new();
    private readonly Text _favoriteMain = new();
    private readonly Caption _favoriteCount = new() { VerticalAlignment = VerticalAlignment.Bottom };
    private readonly StackPanel _favoriteLine = new() { Orientation = Orientation.Horizontal, Spacing = 8 };
    private readonly Text _favoriteEmpty = new();

    // GlassPanel6 — weekly heatmap grid.
    private readonly TsGlassPanel _gridPanel = new();
    private readonly PanelTitle _gridTitle = new();
    private readonly StackPanel _gridHost = new() { Spacing = CellSpacing };
    private readonly StackPanel _legendHost = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 8,
        VerticalAlignment = VerticalAlignment.Center,
    };
    private readonly Caption _lessLabel = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly Caption _moreLabel = new() { VerticalAlignment = VerticalAlignment.Center };

    // GlassPanel7 — top charging locations.
    private readonly TsGlassPanel _locationsPanel = new();
    private readonly PanelTitle _locationsTitle = new();
    private readonly TsBarChart _locationsChart = new()
    {
        ShowLegend = false,
        IncludeZero = true,
        MinHeight = LocationsChartMinHeight,
        HorizontalAlignment = HorizontalAlignment.Stretch,
    };
    private readonly TsEmptyState _locationsEmpty = new()
    {
        HorizontalAlignment = HorizontalAlignment.Center,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private string _gridSignature = string.Empty;

    /// <summary>Creates the page over the default empty feed and the shell resource localizer.</summary>
    public ChargingHeatmapPage()
        : this(EmptyChargingHeatmapFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The charging-sessions data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public ChargingHeatmapPage(IChargingHeatmapFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new ChargingHeatmapPageViewModel(feed, localizer);

        _sessionsPanel = BuildStatCard(GlassGlow.Cyan, _sessionsLabel, _sessionsValue);
        _energyPanel = BuildStatCard(GlassGlow.Green, _energyLabel, _energyValue);
        _costPanel = BuildStatCard(GlassGlow.Purple, _costLabel, _costValue);
        _durationPanel = BuildStatCard(GlassGlow.None, _durationLabel, _durationValue);

        BuildLoadingSkeleton();
        BuildFavoritePanel();
        BuildGridPanel();
        BuildLocationsPanel();
        BuildContentPanel();
        Content = BuildLayout();

        _errorState.ActionInvoked += OnRetryInvoked;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The diagnostics surface slug (<c>ChargingHeatmapPage</c>).</summary>
    public static string Slug => ChargingHeatmapRegistration.Slug;

    private static TsGlassPanel BuildStatCard(GlassGlow glow, Caption label, MetricValue value)
    {
        var stack = new StackPanel { Spacing = 4 };
        stack.Children.Add(label);
        stack.Children.Add(value);
        return new TsGlassPanel { Glow = glow, Padding = new Thickness(PanelPadding), Content = stack };
    }

    private ScrollViewer BuildLayout()
    {
        var stack = new StackPanel { Spacing = SectionSpacing, Padding = new Thickness(PanelPadding + 8) };
        stack.Children.Add(BuildHeader());
        stack.Children.Add(_loadingSkeleton);
        stack.Children.Add(_errorState);
        stack.Children.Add(_contentPanel);

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
        var statsRow = new Grid { ColumnSpacing = ColumnGap };
        for (int i = 0; i < 4; i++)
        {
            statsRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            var block = new TsSkeleton { BlockHeight = 80, ReduceMotion = MotionPreference.ReduceMotion };
            Grid.SetColumn(block, i);
            statsRow.Children.Add(block);
        }

        _loadingSkeleton.Children.Add(statsRow);
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 320, ReduceMotion = MotionPreference.ReduceMotion });
    }

    private void BuildFavoritePanel()
    {
        _favoriteLine.Children.Add(_favoriteMain);
        _favoriteLine.Children.Add(_favoriteCount);

        var column = new StackPanel { Spacing = 4 };
        column.Children.Add(_favoriteLabel);
        column.Children.Add(_favoriteLine);
        column.Children.Add(_favoriteEmpty);

        _favoritePanel.Glow = GlassGlow.Cyan;
        _favoritePanel.Padding = new Thickness(PanelPadding);
        _favoritePanel.Content = column;
    }

    private void BuildGridPanel()
    {
        var scroller = new ScrollViewer
        {
            Content = _gridHost,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Disabled,
            HorizontalScrollMode = ScrollMode.Auto,
            VerticalScrollMode = ScrollMode.Disabled,
        };

        _legendHost.Children.Add(_lessLabel);
        for (int i = 0; i < 5; i++)
        {
            _legendHost.Children.Add(new Border
            {
                Width = SwatchWidth,
                Height = SwatchHeight,
                CornerRadius = new CornerRadius(CellRadius),
                Background = new SolidColorBrush(Microsoft.UI.Colors.Transparent),
            });
        }

        _legendHost.Children.Add(_moreLabel);

        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(_gridTitle);
        column.Children.Add(scroller);
        column.Children.Add(_legendHost);

        _gridPanel.Padding = new Thickness(PanelPadding);
        _gridPanel.Content = column;
    }

    private void BuildLocationsPanel()
    {
        var body = new Grid();
        body.Children.Add(_locationsChart);
        body.Children.Add(_locationsEmpty);

        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(_locationsTitle);
        column.Children.Add(body);

        _locationsPanel.Padding = new Thickness(PanelPadding);
        _locationsPanel.Content = column;
    }

    private void BuildContentPanel()
    {
        var statsRow = new Grid { ColumnSpacing = ColumnGap };
        var cards = new[] { _sessionsPanel, _energyPanel, _costPanel, _durationPanel };
        for (int i = 0; i < cards.Length; i++)
        {
            statsRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            Grid.SetColumn(cards[i], i);
            statsRow.Children.Add(cards[i]);
        }

        _contentPanel.Children.Add(new TsFadeIn { Content = statsRow });
        _contentPanel.Children.Add(new TsFadeIn { DelayMs = 100, Content = _favoritePanel });
        _contentPanel.Children.Add(new TsFadeIn { DelayMs = 200, Content = _gridPanel });
        _contentPanel.Children.Add(new TsFadeIn { DelayMs = 300, Content = _locationsPanel });
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        _viewModel.NotifyOpened();
        await _viewModel.LoadAsync().ConfigureAwait(true);
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Unsubscribe from and dispose the view-model (CA1001; mirrors sibling pages).</summary>
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

    private void OnRetryInvoked(object? sender, EventArgs e) => _ = _viewModel.RefreshAsync();

    private void Render(ChargingHeatmapDisplay display)
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

        _contentPanel.Visibility = Show(display.ShowContent);
        if (display.ShowContent)
        {
            RenderStats(display);
            RenderFavorite(display);
            RenderGrid(display);
            RenderLegend(display);
            RenderLocations(display);
        }
    }

    private void RenderStats(ChargingHeatmapDisplay display)
    {
        _sessionsLabel.Value = display.TotalSessionsLabel;
        _sessionsValue.Value = display.TotalSessionsValue;
        AutomationProperties.SetName(_sessionsPanel, $"{display.TotalSessionsLabel}: {display.TotalSessionsValue}");

        _energyLabel.Value = display.TotalEnergyLabel;
        _energyValue.Value = display.TotalEnergyValue;
        AutomationProperties.SetName(_energyPanel, $"{display.TotalEnergyLabel}: {display.TotalEnergyValue}");

        _costLabel.Value = display.TotalCostLabel;
        _costValue.Value = display.TotalCostValue;
        AutomationProperties.SetName(_costPanel, $"{display.TotalCostLabel}: {display.TotalCostValue}");

        _durationLabel.Value = display.AvgDurationLabel;
        _durationValue.Value = display.AvgDurationValue;
        AutomationProperties.SetName(_durationPanel, $"{display.AvgDurationLabel}: {display.AvgDurationValue}");
    }

    private void RenderFavorite(ChargingHeatmapDisplay display)
    {
        _favoriteLabel.Value = display.FavoriteLabel;
        _favoriteMain.Value = display.FavoriteMain;
        _favoriteCount.Value = display.FavoriteCount;
        _favoriteEmpty.Value = display.FavoriteEmptyMessage;

        _favoriteLine.Visibility = Show(display.HasFavorite);
        _favoriteEmpty.Visibility = Show(!display.HasFavorite);

        string spoken = display.HasFavorite
            ? $"{display.FavoriteLabel}. {display.FavoriteMain} {display.FavoriteCount}"
            : $"{display.FavoriteLabel}. {display.FavoriteEmptyMessage}";
        AutomationProperties.SetName(_favoritePanel, spoken);
    }

    private void RenderGrid(ChargingHeatmapDisplay display)
    {
        _gridTitle.Value = display.GridTitle;
        AutomationProperties.SetName(_gridPanel, display.GridTitle);

        string signature = BuildGridSignature(display);
        if (signature == _gridSignature)
        {
            return;
        }

        _gridSignature = signature;
        _gridHost.Children.Clear();
        _gridHost.Children.Add(BuildHourHeader(display.HourLabels));
        foreach (ChargingHeatRow row in display.Rows)
        {
            _gridHost.Children.Add(BuildDayRow(row));
        }
    }

    private static StackPanel BuildHourHeader(IReadOnlyList<string> hourLabels)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = CellSpacing };
        row.Children.Add(new Border { Width = DayLabelWidth }); // gutter above the day-label column
        foreach (string label in hourLabels)
        {
            row.Children.Add(new TextBlock
            {
                Text = label,
                Width = CellWidth,
                FontSize = 10,
                TextAlignment = TextAlignment.Center,
                Foreground = DisplayTokens.TextMuted,
            });
        }

        AutomationProperties.SetAccessibilityView(row, AccessibilityView.Raw);
        return row;
    }

    private static StackPanel BuildDayRow(ChargingHeatRow row)
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
            FontSize = 12,
            VerticalAlignment = VerticalAlignment.Center,
            Foreground = DisplayTokens.TextSecondary,
        });

        foreach (ChargingHeatCell cell in row.Cells)
        {
            line.Children.Add(BuildCell(cell));
        }

        return line;
    }

    private static Border BuildCell(ChargingHeatCell cell)
    {
        ChargingHeatColor fill = cell.Fill;
        var border = new Border
        {
            Width = CellWidth,
            Height = CellHeight,
            CornerRadius = new CornerRadius(CellRadius),
            Background = new SolidColorBrush(Windows.UI.Color.FromArgb(fill.AlphaByte, fill.R, fill.G, fill.B)),
        };

        ToolTipService.SetToolTip(border, cell.Tooltip);
        AutomationProperties.SetName(border, cell.Tooltip);
        if (!cell.HasSessions)
        {
            // Keep the dense empty cells out of the linear Narrator walk; the tooltip still serves hover.
            AutomationProperties.SetAccessibilityView(border, AccessibilityView.Raw);
        }

        return border;
    }

    private void RenderLegend(ChargingHeatmapDisplay display)
    {
        _lessLabel.Value = display.LessLabel;
        _moreLabel.Value = display.MoreLabel;

        // The legend swatches sit between the Less and More captions (index 1..5 of the legend host).
        for (int i = 0; i < display.LegendSwatches.Count && i + 1 < _legendHost.Children.Count - 1; i++)
        {
            if (_legendHost.Children[i + 1] is Border swatch)
            {
                ChargingHeatColor color = display.LegendSwatches[i];
                swatch.Background = new SolidColorBrush(
                    Windows.UI.Color.FromArgb(color.AlphaByte, color.R, color.G, color.B));
            }
        }

        AutomationProperties.SetName(_legendHost, $"{display.LessLabel} \u2192 {display.MoreLabel}");
    }

    private void RenderLocations(ChargingHeatmapDisplay display)
    {
        _locationsTitle.Value = display.TopLocationsTitle;
        AutomationProperties.SetName(_locationsPanel, display.TopLocationsTitle);

        if (display.HasLocationData)
        {
            _locationsChart.Series = display.LocationSeries;
            _locationsChart.Title = display.TopLocationsTitle;
            AutomationProperties.SetName(_locationsChart, display.TopLocationsTitle);
        }

        _locationsChart.Visibility = Show(display.HasLocationData);
        _locationsEmpty.Message = display.NoDataMessage;
        _locationsEmpty.Visibility = Show(!display.HasLocationData);
        AutomationProperties.SetName(_locationsEmpty, display.NoDataMessage);
    }

    private static string BuildGridSignature(ChargingHeatmapDisplay display)
    {
        var builder = new System.Text.StringBuilder(display.MaxCount.ToString(System.Globalization.CultureInfo.InvariantCulture));
        foreach (ChargingHeatRow row in display.Rows)
        {
            foreach (ChargingHeatCell cell in row.Cells)
            {
                // Count drives the cell colour; the rounded energy drives the hover tooltip — fold both so a
                // data change that keeps every count identical still rebuilds the (now-stale) tooltips.
                builder.Append('|').Append(cell.Count).Append(':')
                    .Append((long)Math.Round(cell.EnergyKwh * 10, MidpointRounding.AwayFromZero));
            }
        }

        return builder.ToString();
    }

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;
}
