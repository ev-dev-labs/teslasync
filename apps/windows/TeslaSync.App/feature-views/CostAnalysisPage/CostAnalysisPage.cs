using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Widgets;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Charging;

/// <summary>
/// The shared data-layer dependencies the page threads into its self-fetching child surfaces' <c>Create</c>
/// factories (the native analogue of the React context the web children read). When null — the parameterless
/// default-feed page registered in the shell — the page renders the page-level empty state and never
/// constructs the self-fetching children; a DI host supplies the real bundle to drive the full section stack.
/// </summary>
/// <param name="Vehicles">Resolves the scoped (or primary) vehicle for each child read.</param>
/// <param name="Api">The generated contract client.</param>
/// <param name="Engine">The shared cache-then-network read engine.</param>
/// <param name="Options">The shared API client options (for JSON settings).</param>
public sealed record CostAnalysisSurfaceDependencies(
    IWidgetVehicleSource Vehicles,
    IApiClient Api,
    CacheThenNetworkEngine Engine,
    ApiClientOptions Options);

/// <summary>
/// The native WinUI 3 <c>CostAnalysisPage</c> — a parity port of the web page
/// <c>web/src/features/charging/pages/CostAnalysisPage.tsx</c> (route <c>/charging/costs</c>, nav name
/// <c>CostAnalysis</c>). It binds a <see cref="CostAnalysisPageViewModel"/> over the charging-sessions read
/// (web <c>useChargingSessionsPaginated</c>) and reproduces the web page's three-way gate: the full-page
/// <see cref="BuildLoadingSkeleton">loading skeleton</see> (web <c>LoadingSkeleton</c>), the centred empty
/// state (web <c>EmptyState</c> with the <c>costAnalysis.empty.*</c> strings), and — on a populated snapshot —
/// the full section stack composed from the existing Fluent child surfaces in the web order/grouping: the
/// cost summary cards; the monthly-cost area chart beside the cost-per-kWh trend; the charger-type breakdown;
/// the gas-vs-electric savings calculator; the monthly cost table; the time-of-use analysis; the cost
/// forecast section and its forecast details (web <c>useCostForecast</c>); and the lifetime summary beside the
/// environmental impact. The page is the single aggregation owner: it folds its session list into the four
/// presentational chart models its chart children render. The view is a thin renderer — all state selection,
/// formatting and i18n happen in the view-model / aggregator; state changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class CostAnalysisPage : UserControl, IDisposable
{
    private const string EmptyStateGlyph = "\uE1D6"; // currency glyph (route table icon for /cost-analysis)

    private readonly CostAnalysisPageViewModel _viewModel;
    private readonly CostAnalysisSurfaceDependencies? _dependencies;
    private readonly ILocalizer _localizer;
    private readonly DispatcherQueue? _dispatcher = DispatcherQueue.GetForCurrentThread();
    private readonly List<IDisposable> _surfaces = new();

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();
    private readonly TsDataFreshness _freshness = new() { VerticalAlignment = VerticalAlignment.Center };

    private readonly TsAlertBanner _errorBanner = new()
    {
        Variant = CalloutVariant.Danger,
        IsOpen = false,
        Dismissible = false,
    };

    private readonly StackPanel _loadingPanel;
    private readonly StackPanel _contentPanel = new() { Spacing = 24, Visibility = Visibility.Collapsed };
    private readonly Border _emptyPanel;
    private readonly TsEmptyState _emptyState = new() { IconGlyph = EmptyStateGlyph };

    private MonthlyCostChart? _monthlyChart;
    private CostPerKwhChart? _costPerKwhChart;
    private ChargerTypeBreakdown? _chargerType;
    private MonthlyCostTable? _monthlyTable;

    private bool _contentBuilt;
    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the page over the default empty session feed and the shell resource localizer.</summary>
    public CostAnalysisPage()
        : this(EmptyCostAnalysisSessionsSource.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit data source, localizer and (optional) child dependencies.</summary>
    /// <param name="source">The cache-then-network charging-sessions port (native <c>useChargingSessionsPaginated</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="dependencies">The shared data-layer bundle for the self-fetching child surfaces.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public CostAnalysisPage(
        ICostAnalysisSessionsSource source,
        ILocalizer localizer,
        CostAnalysisSurfaceDependencies? dependencies = null,
        CostAnalysisDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _dependencies = dependencies;
        _viewModel = new CostAnalysisPageViewModel(source, localizer, diagnostics);

        _loadingPanel = BuildLoadingSkeleton();
        _emptyPanel = BuildEmptyPanel();

        Content = BuildLayout();

        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>The navigation route name the shell registers this page under (<c>CostAnalysis</c>).</summary>
    public static string RouteName => CostAnalysisRegistration.RouteName;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public CostAnalysisPageViewModel ViewModel => _viewModel;

    private ScrollViewer BuildLayout()
    {
        var titleRow = new Grid();
        titleRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        titleRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var titleStack = new StackPanel { Spacing = 4 };
        titleStack.Children.Add(_title);
        titleStack.Children.Add(_subtitle);
        Grid.SetColumn(titleStack, 0);
        Grid.SetColumn(_freshness, 1);
        titleRow.Children.Add(titleStack);
        titleRow.Children.Add(_freshness);

        var stack = new StackPanel { Spacing = 16, Padding = new Thickness(24) };
        stack.Children.Add(titleRow);
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

    private static StackPanel BuildLoadingSkeleton()
    {
        // Native mirror of the web LoadingSkeleton: header + 6 metric cards + 2 charts + a table block.
        var panel = new StackPanel { Spacing = 24, Visibility = Visibility.Collapsed };

        var header = new StackPanel { Spacing = 8 };
        header.Children.Add(new TsSkeleton { BlockHeight = 28 });
        header.Children.Add(new TsSkeleton { BlockHeight = 16 });
        panel.Children.Add(header);

        panel.Children.Add(SkeletonGrid(3, 6, 84));
        panel.Children.Add(SkeletonGrid(2, 2, 220));

        var table = new TsGlassPanel { Padding = new Thickness(16) };
        var tableStack = new StackPanel { Spacing = 8 };
        tableStack.Children.Add(new TsSkeleton { BlockHeight = 16 });
        for (int i = 0; i < 5; i++)
        {
            tableStack.Children.Add(new TsSkeleton { BlockHeight = 32 });
        }

        table.Content = tableStack;
        panel.Children.Add(table);

        AutomationProperties.SetName(panel, "Loading cost analysis");
        return panel;
    }

    private static Grid SkeletonGrid(int columns, int tiles, double blockHeight)
    {
        var grid = new Grid { ColumnSpacing = 16, RowSpacing = 16 };
        for (int c = 0; c < columns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        int rows = (int)Math.Ceiling(tiles / (double)columns);
        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < tiles; i++)
        {
            var panel = new TsGlassPanel
            {
                Padding = new Thickness(16),
                Content = new TsSkeleton { BlockHeight = blockHeight },
            };
            Grid.SetColumn(panel, i % columns);
            Grid.SetRow(panel, i / columns);
            grid.Children.Add(panel);
        }

        return grid;
    }

    private Border BuildEmptyPanel()
    {
        // Web parity: a centred empty state in a tall region (web flex min-h-[60vh] items-center justify-center).
        _emptyState.HorizontalAlignment = HorizontalAlignment.Center;
        _emptyState.VerticalAlignment = VerticalAlignment.Center;
        return new Border
        {
            MinHeight = 360,
            Visibility = Visibility.Collapsed,
            Padding = new Thickness(24),
            Child = _emptyState,
        };
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
        if (_renderQueued)
        {
            return;
        }

        _renderQueued = true;
        if (_dispatcher is null || _dispatcher.HasThreadAccess)
        {
            RenderCoalesced();
        }
        else
        {
            _dispatcher.TryEnqueue(RenderCoalesced);
        }
    }

    private void RenderCoalesced()
    {
        _renderQueued = false;
        Render();
    }

    private void Render()
    {
        if (_disposed)
        {
            return;
        }

        var display = _viewModel.Display;
        var state = _viewModel.State;

        _title.Value = display.Title;
        _subtitle.Value = display.Subtitle;
        _emptyState.Title = display.EmptyTitle;
        _emptyState.Message = display.EmptyMessage;

        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError || state == CostAnalysisState.Offline;

        bool content = _viewModel.HasContent;
        if (content)
        {
            EnsureContentBuilt();
            FeedCharts();
        }

        _loadingPanel.Visibility = state == CostAnalysisState.Loading ? Visibility.Visible : Visibility.Collapsed;
        _contentPanel.Visibility = content ? Visibility.Visible : Visibility.Collapsed;
        _emptyPanel.Visibility = state == CostAnalysisState.Empty ? Visibility.Visible : Visibility.Collapsed;

        _errorBanner.IsOpen = state == CostAnalysisState.Error;
        _errorBanner.Message = _viewModel.ErrorMessage ?? string.Empty;

        AutomationProperties.SetName(this, display.Title);
    }

    private void FeedCharts()
    {
        var charts = _viewModel.Charts;
        if (_monthlyChart is not null)
        {
            _monthlyChart.Model = charts.Monthly;
        }

        if (_costPerKwhChart is not null)
        {
            _costPerKwhChart.Model = charts.CostPerKwh;
        }

        if (_chargerType is not null)
        {
            _chargerType.Model = charts.ChargerType;
        }

        if (_monthlyTable is not null)
        {
            _monthlyTable.Model = charts.MonthlyTable;
        }
    }

    private void EnsureContentBuilt()
    {
        if (_contentBuilt)
        {
            return;
        }

        _contentBuilt = true;

        // 1) Cost summary cards (web CostSummaryCards).
        AddSurface(TryCreate(deps => CostSummaryCards.Create(deps.Vehicles, deps.Api, deps.Engine, deps.Options, _localizer)));

        // 2) Monthly cost chart beside the cost-per-kWh trend (web 2-column grid).
        _monthlyChart = new MonthlyCostChart(_localizer);
        _costPerKwhChart = new CostPerKwhChart(_localizer);
        _contentPanel.Children.Add(TwoColumn(_monthlyChart, _costPerKwhChart));

        // 3) Charger-type breakdown (web ChargerTypeBreakdown).
        _chargerType = new ChargerTypeBreakdown(_localizer);
        _contentPanel.Children.Add(_chargerType);

        // 4) Gas-vs-electric savings calculator (web SavingsCalculator).
        AddSurface(TryCreate(deps => SavingsCalculator.Create(deps.Vehicles, deps.Api, deps.Engine, deps.Options, _localizer)));

        // 5) Monthly cost table (web MonthlyCostTable).
        _monthlyTable = new MonthlyCostTable(_localizer);
        _contentPanel.Children.Add(_monthlyTable);

        // 6) Time-of-use analysis (web TimeOfUseAnalysis).
        AddSurface(TryCreate(deps => TimeOfUseAnalysis.Create(deps.Vehicles, deps.Api, deps.Engine, deps.Options, _localizer)));

        // 7) Cost forecast section + forecast details (web CostForecastSection, useCostForecast).
        AddSurface(TryCreate(deps => CostForecastSection.Create(deps.Vehicles, deps.Api, deps.Engine, deps.Options, _localizer)));
        AddSurface(TryCreate(deps => ForecastDetails.Create(deps.Vehicles, deps.Api, deps.Engine, deps.Options, _localizer)));

        // 8) Lifetime summary beside the environmental impact (web 2-column grid).
        var lifetime = TryCreate(deps => LifetimeSummary.Create(deps.Api, deps.Engine, deps.Options, _localizer));
        var environment = TryCreate(deps => EnvironmentalImpact.Create(deps.Vehicles, deps.Api, deps.Engine, deps.Options, _localizer));
        if (lifetime is not null || environment is not null)
        {
            _contentPanel.Children.Add(TwoColumn(
                lifetime as FrameworkElement ?? new Grid(),
                environment as FrameworkElement ?? new Grid()));
            Track(lifetime);
            Track(environment);
        }
    }

    private T? TryCreate<T>(Func<CostAnalysisSurfaceDependencies, T> factory)
        where T : class =>
        _dependencies is { } deps ? factory(deps) : null;

    private void AddSurface(UIElement? surface)
    {
        if (surface is null)
        {
            return;
        }

        _contentPanel.Children.Add(surface);
        Track(surface);
    }

    private void Track(object? candidate)
    {
        if (candidate is IDisposable disposable)
        {
            _surfaces.Add(disposable);
        }
    }

    private static Grid TwoColumn(FrameworkElement left, FrameworkElement right)
    {
        var grid = new Grid { ColumnSpacing = 16, RowSpacing = 16 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetColumn(left, 0);
        Grid.SetColumn(right, 1);
        grid.Children.Add(left);
        grid.Children.Add(right);
        return grid;
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

        foreach (var surface in _surfaces)
        {
            surface.Dispose();
        }

        _surfaces.Clear();
        _viewModel.Dispose();
    }
}
