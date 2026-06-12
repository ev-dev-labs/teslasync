using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Analytics;

/// <summary>
/// The native WinUI 3 <c>TrueCostPage</c> — a parity port of the web page
/// <c>web/src/features/analytics/pages/TrueCostPage.tsx</c> (route <c>/analytics/tco</c>, nav name
/// <c>TrueCostOwnership</c>). It binds to a <see cref="TrueCostPageViewModel"/> and renders every web region
/// with Fluent components and design tokens: the page header with a data-freshness chip; the failure banner;
/// the four hero stat panels (Total EV Cost / Equiv. Gas Cost / Total Savings / Monthly Savings); the
/// cumulative-savings area chart; the cost-per-kilometre comparison bar chart with its two chips; the
/// monthly EV-vs-gas bar chart; the savings-breakdown panel with its three cards; and the page-level empty
/// state. The view is a thin renderer: all branch selection, formatting and i18n happen in the view-model's
/// <see cref="TrueCostDisplay"/> projection. State changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class TrueCostPage : UserControl, IDisposable
{
    private readonly TrueCostPageViewModel _viewModel;
    private readonly DispatcherQueue? _dispatcher = DispatcherQueue.GetForCurrentThread();
    private readonly ILocalizer _localizer;
    private bool _disposed;
    private bool _started;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();
    private readonly TsDataFreshness _freshness = new();

    private readonly TsAlertBanner _errorBanner = new()
    {
        Variant = CalloutVariant.Danger,
        IsOpen = false,
        Dismissible = false,
    };

    private readonly StackPanel _loadingPanel;
    private readonly Caption _loadingCaption = new() { HorizontalAlignment = HorizontalAlignment.Center };

    private readonly StackPanel _contentPanel = new() { Spacing = 24 };

    private readonly StatTile _evTile;
    private readonly StatTile _gasTile;
    private readonly StatTile _savingsTile;
    private readonly StatTile _monthlyTile;

    private readonly TsChartContainer _cumulativeContainer = new();
    private readonly TsAreaChart _cumulativeChart = new() { ShowLegend = false, Height = 280 };

    private readonly TsChartContainer _costPerKmContainer = new();
    private readonly TsBarChart _costPerKmChart = new() { ShowLegend = false, Height = 200 };
    private readonly ChipTile _evChip = new();
    private readonly ChipTile _gasChip = new();

    private readonly TsChartContainer _monthlyContainer = new();
    private readonly TsBarChart _monthlyChart = new() { Height = 220 };

    private readonly TsGlassPanel _breakdownPanel = new();
    private readonly PanelTitle _breakdownTitle = new();
    private readonly BreakdownTile _fuelTile = new();
    private readonly BreakdownTile _maintenanceTile = new();
    private readonly BreakdownTile _totalEstimatedTile = new();

    private readonly TsGlassPanel _emptyPanel = new();
    private readonly TsEmptyState _emptyState = new() { IconGlyph = "\uE1D3" };

    /// <summary>Creates the page over the default empty TCO feed and the shell resource localizer.</summary>
    public TrueCostPage()
        : this(EmptyTrueCostBreakdownSource.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit data source and localizer (used by tests / DI hosts).</summary>
    /// <param name="source">The cache-then-network TCO data port (native <c>useCostBreakdown</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public TrueCostPage(ITrueCostBreakdownSource source, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _viewModel = new TrueCostPageViewModel(source, localizer);

        _evTile = new StatTile(GlassGlow.Cyan, Brush("TsChartSpeedBrush"));
        _gasTile = new StatTile(GlassGlow.None, Brush("TsChartTemperatureBrush"));
        _savingsTile = new StatTile(GlassGlow.Green, Brush("TsChartBatteryBrush"));
        _monthlyTile = new StatTile(GlassGlow.Green, Brush("TsChartBatteryBrush"));

        _loadingPanel = BuildLoadingPanel();

        Content = BuildLayout();

        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>The navigation route name the shell registers this page under (<c>TrueCostOwnership</c>).</summary>
    public static string RouteName => TrueCostRegistration.RouteName;

    private ScrollViewer BuildLayout()
    {
        var header = new StackPanel { Spacing = 4 };

        var titleRow = new Grid();
        titleRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        titleRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var titleStack = new StackPanel { Spacing = 4 };
        titleStack.Children.Add(_title);
        titleStack.Children.Add(_subtitle);
        Grid.SetColumn(titleStack, 0);
        _freshness.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(_freshness, 1);
        titleRow.Children.Add(titleStack);
        titleRow.Children.Add(_freshness);
        header.Children.Add(titleRow);

        BuildContentPanel();
        BuildEmptyPanel();

        var stack = new StackPanel { Spacing = 16, Padding = new Thickness(24) };
        stack.Children.Add(header);
        stack.Children.Add(_errorBanner);
        stack.Children.Add(_loadingPanel);
        stack.Children.Add(_contentPanel);
        stack.Children.Add(_emptyPanel);

        return new ScrollViewer
        {
            Content = stack,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollMode = ScrollMode.Disabled,
        };
    }

    private StackPanel BuildLoadingPanel()
    {
        var panel = new StackPanel
        {
            Spacing = 12,
            MinHeight = 200,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            Visibility = Visibility.Collapsed,
        };
        panel.Children.Add(new ProgressRing { IsActive = true, Width = 32, Height = 32 });
        _loadingCaption.Value = _localizer.GetString("common.loading", "Loading\u2026");
        panel.Children.Add(_loadingCaption);
        return panel;
    }

    private void BuildContentPanel()
    {
        // Hero stat panels (GlassPanel1..4).
        _contentPanel.Children.Add(UniformGrid(4, 16,
            _evTile.Panel, _gasTile.Panel, _savingsTile.Panel, _monthlyTile.Panel));

        // Cumulative savings area chart (ChartContainer + AreaChart).
        _cumulativeChart.IncludeZero = true;
        _cumulativeContainer.Body = _cumulativeChart;
        _contentPanel.Children.Add(_cumulativeContainer);

        // Cost-per-km comparison + monthly EV-vs-gas (two columns).
        _costPerKmChart.IncludeZero = true;
        var costBody = new StackPanel { Spacing = 16 };
        costBody.Children.Add(_costPerKmChart);
        costBody.Children.Add(UniformGrid(2, 16, _evChip.Root, _gasChip.Root));
        _costPerKmContainer.Body = costBody;

        _monthlyChart.IncludeZero = true;
        _monthlyContainer.Body = _monthlyChart;

        _contentPanel.Children.Add(UniformGrid(2, 24, _costPerKmContainer, _monthlyContainer));

        // Savings breakdown panel (GlassPanel8).
        var breakdownColumn = new StackPanel { Spacing = 16 };
        breakdownColumn.Children.Add(_breakdownTitle);
        breakdownColumn.Children.Add(UniformGrid(3, 16, _fuelTile.Root, _maintenanceTile.Root, _totalEstimatedTile.Root));
        _breakdownPanel.Content = breakdownColumn;
        _breakdownPanel.Padding = new Thickness(24);
        _contentPanel.Children.Add(_breakdownPanel);

        _contentPanel.Visibility = Visibility.Collapsed;
    }

    private void BuildEmptyPanel()
    {
        _emptyPanel.Padding = new Thickness(32);
        _emptyPanel.Content = _emptyState;
        _emptyPanel.Visibility = Visibility.Collapsed;
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _viewModel.NotifyOpened();
        _ = _viewModel.LoadAsync();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (_dispatcher is null || _dispatcher.HasThreadAccess)
        {
            Render();
        }
        else
        {
            _dispatcher.TryEnqueue(Render);
        }
    }

    private void Render()
    {
        if (_disposed)
        {
            return;
        }

        var d = _viewModel.Display;
        var state = _viewModel.State;

        _title.Value = d.Title;
        _subtitle.Value = d.Subtitle;

        // Hero panels.
        _evTile.Apply(d.TotalEvCost);
        _gasTile.Apply(d.EquivGasCost);
        _savingsTile.Apply(d.TotalSavings);
        _monthlyTile.Apply(d.MonthlySavings);

        // Cumulative savings area chart.
        _cumulativeContainer.Title = d.CumulativeTitle;
        _cumulativeContainer.AccessibleSummary = d.CumulativeAria;
        _cumulativeContainer.EmptyMessage = d.NoMonthlyDataMessage;
        _cumulativeChart.Series = d.CumulativeSeries;
        _cumulativeContainer.State = d.HasMonthlyData ? ChartState.Ready : ChartState.Empty;

        // Cost-per-km comparison bars + chips.
        _costPerKmContainer.Title = d.CostPerKmTitle;
        _costPerKmContainer.AccessibleSummary = d.CostPerKmAria;
        _costPerKmChart.Series = d.CostPerKmSeries;
        _costPerKmContainer.State = ChartState.Ready;
        _evChip.Apply(d.CostPerKmEvChipValue, d.CostPerKmEvChipLabel);
        _gasChip.Apply(d.CostPerKmIceChipValue, d.CostPerKmIceChipLabel);

        // Monthly EV-vs-gas bars.
        _monthlyContainer.Title = d.MonthlyTitle;
        _monthlyContainer.AccessibleSummary = d.MonthlyAria;
        _monthlyContainer.EmptyMessage = d.NoMonthlyDataMessage;
        _monthlyChart.Series = d.MonthlySeries;
        _monthlyContainer.State = d.HasMonthlyData ? ChartState.Ready : ChartState.Empty;

        // Savings breakdown.
        _breakdownTitle.Value = d.SavingsBreakdownTitle;
        _fuelTile.Apply(d.FuelSavings);
        _maintenanceTile.Apply(d.MaintenanceSavings);
        _totalEstimatedTile.Apply(d.TotalEstimatedSavings);

        // Page-level empty state (GlassPanel9).
        _emptyState.Message = d.NoDataMessage;

        // Freshness chip (web DataFreshnessAuto).
        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError || state == TrueCostState.Offline;

        // State machine: loading / empty / error / success (loaded|stale|offline).
        bool content = state is TrueCostState.Loaded or TrueCostState.Stale or TrueCostState.Offline;
        _loadingPanel.Visibility = state == TrueCostState.Loading ? Visibility.Visible : Visibility.Collapsed;
        _contentPanel.Visibility = content ? Visibility.Visible : Visibility.Collapsed;
        _emptyPanel.Visibility = state == TrueCostState.Empty ? Visibility.Visible : Visibility.Collapsed;

        _errorBanner.IsOpen = state == TrueCostState.Error;
        _errorBanner.Message = _viewModel.ErrorMessage ?? string.Empty;

        AutomationProperties.SetName(this, d.Title);
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        _viewModel.Dispose();
    }

    private static Grid UniformGrid(int columns, double spacing, params FrameworkElement[] children)
    {
        var grid = new Grid { ColumnSpacing = spacing, RowSpacing = spacing };
        for (int i = 0; i < columns; i++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        for (int i = 0; i < children.Length; i++)
        {
            int col = i % columns;
            int row = i / columns;
            while (grid.RowDefinitions.Count <= row)
            {
                grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            }

            Grid.SetColumn(children[i], col);
            Grid.SetRow(children[i], row);
            grid.Children.Add(children[i]);
        }

        return grid;
    }

    private static Brush? Brush(string key) =>
        Application.Current?.Resources is { } r && r.TryGetValue(key, out var v) && v is Brush b ? b : null;

    /// <summary>A hero stat panel — a tokenized glass panel with an accent icon, label, value and sub-line.</summary>
    private sealed class StatTile
    {
        private readonly Caption _label = new();
        private readonly MetricValue _value = new();
        private readonly Caption _sub = new();

        public StatTile(GlassGlow glow, Brush? iconBrush)
        {
            var headerRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
            Icon = new FontIcon { FontSize = 16, VerticalAlignment = VerticalAlignment.Center };
            if (iconBrush is not null)
            {
                Icon.Foreground = iconBrush;
            }

            headerRow.Children.Add(Icon);
            headerRow.Children.Add(_label);

            var column = new StackPanel { Spacing = 6 };
            column.Children.Add(headerRow);
            column.Children.Add(_value);
            column.Children.Add(_sub);

            Panel = new TsGlassPanel { Glow = glow, Padding = new Thickness(20), Content = column };
        }

        public TsGlassPanel Panel { get; }

        public FontIcon Icon { get; }

        public void Apply(TrueCostStat stat)
        {
            Icon.Glyph = stat.Glyph;
            _label.Value = stat.Label;
            _value.Value = stat.Value;
            _sub.Value = stat.Sublabel;
            AutomationProperties.SetName(Panel, stat.AutomationName);
        }
    }

    /// <summary>A cost-per-km chip — a bordered tile carrying a formatted value and a muted label.</summary>
    private sealed class ChipTile
    {
        private readonly MetricValue _value = new() { HorizontalAlignment = HorizontalAlignment.Center };
        private readonly Caption _label = new() { HorizontalAlignment = HorizontalAlignment.Center };

        public ChipTile()
        {
            var column = new StackPanel { Spacing = 4, HorizontalAlignment = HorizontalAlignment.Center };
            column.Children.Add(_value);
            column.Children.Add(_label);

            Root = new Border
            {
                CornerRadius = new CornerRadius(12),
                Padding = new Thickness(12),
                BorderThickness = new Thickness(1),
                BorderBrush = Brush("TsColorBorderBrush"),
                Child = column,
            };
        }

        public Border Root { get; }

        public void Apply(string value, string label)
        {
            _value.Value = value;
            _label.Value = label;
            AutomationProperties.SetName(Root, $"{value} {label}");
        }
    }

    /// <summary>A savings-breakdown sub-card — a bordered tile with a label, value and sub-line.</summary>
    private sealed class BreakdownTile
    {
        private readonly Caption _label = new();
        private readonly MetricValue _value = new();
        private readonly Caption _sub = new();

        public BreakdownTile()
        {
            var column = new StackPanel { Spacing = 6 };
            column.Children.Add(_label);
            column.Children.Add(_value);
            column.Children.Add(_sub);

            Root = new Border
            {
                CornerRadius = new CornerRadius(12),
                Padding = new Thickness(16),
                BorderThickness = new Thickness(1),
                BorderBrush = Brush("TsColorBorderBrush"),
                Child = column,
            };
        }

        public Border Root { get; }

        public void Apply(TrueCostBreakdownCard card)
        {
            _label.Value = card.Label;
            _value.Value = card.Value;
            _sub.Value = card.Sublabel;
            AutomationProperties.SetName(Root, $"{card.Label}: {card.Value}, {card.Sublabel}");
        }
    }
}
