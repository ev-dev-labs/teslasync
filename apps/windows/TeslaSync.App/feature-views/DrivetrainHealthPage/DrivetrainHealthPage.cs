using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Driving;

/// <summary>
/// The native WinUI 3 <c>DrivetrainHealthPage</c> — a parity port of the web page
/// <c>web/src/features/driving/pages/DrivetrainHealthPage.tsx</c> (route <c>/drivetrain-health</c>, nav name
/// <c>DrivetrainHealth</c>). It binds to a <see cref="DrivetrainHealthPageViewModel"/> and renders the page
/// chrome (title + subtitle + data-freshness chip), the loading shimmer, the retriable error surface, the
/// page-level empty surface, and — in the success state — the full web composition: the health-overview banner,
/// the health-gauge grid, the temperature gauges, the temperature metric cards, the thermal-load panel, the
/// (conditional) live-motor status, the stator-temperature / torque-history / temperature-trend / power-output
/// charts, the health recommendations and the detail cards, each its own shared feature surface fed from the
/// page's single snapshot. The view is a thin renderer: all branch selection, aggregation, formatting and i18n
/// happen in the view-model's <see cref="DrivetrainHealthDisplay"/> projection. State changes are marshalled
/// onto the UI thread.
/// </summary>
public sealed partial class DrivetrainHealthPage : UserControl, IDisposable
{
    private const double SectionSpacing = 24;
    private const double PanelPadding = 24;

    private readonly DrivetrainHealthPageViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private readonly List<IDisposable> _children = [];
    private bool _disposed;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();
    private readonly TsDataFreshness _freshness = new();

    private readonly StackPanel _loadingSkeleton = new() { Spacing = SectionSpacing };
    private readonly TsQueryError _errorState = new();
    private readonly TsEmptyState _emptyState = new() { IconGlyph = DrivetrainHealthRegistration.EmptyGlyph };
    private readonly ContentControl _contentHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };

    /// <summary>Creates the page over the default empty feed and the shell resource localizer.</summary>
    public DrivetrainHealthPage()
        : this(EmptyDrivetrainHealthFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The five-source drivetrain-health data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public DrivetrainHealthPage(IDrivetrainHealthFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _viewModel = new DrivetrainHealthPageViewModel(feed, localizer);

        BuildLoadingSkeleton();
        Content = BuildLayout();

        _errorState.ActionInvoked += OnRetryInvoked;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The diagnostics surface slug (<c>DrivetrainHealthPage</c>).</summary>
    public static string Slug => DrivetrainHealthRegistration.Slug;

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
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 120 });
        _loadingSkeleton.Children.Add(ColumnsGrid(3, 16, BuildSkeletonBlocks(3, 200)));
        _loadingSkeleton.Children.Add(ColumnsGrid(4, 16, BuildSkeletonBlocks(4, 96)));
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 280 });
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 280 });
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

    /// <summary>Unsubscribe from and dispose the view-model and the mounted children (CA1001).</summary>
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
        DisposeChildren();
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

    private void Render(DrivetrainHealthDisplay display)
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

        _emptyState.Visibility = Show(display.ShowEmpty);
        _emptyState.Message = display.EmptyMessage;

        _contentHost.Visibility = Show(display.ShowContent);
        if (display.ShowContent)
        {
            _contentHost.Content = BuildContent(display);
        }
        else
        {
            _contentHost.Content = null;
            DisposeChildren();
        }
    }

    private StackPanel BuildContent(DrivetrainHealthDisplay d)
    {
        DisposeChildren();

        var now = _viewModel.UpdatedAt ?? DateTimeOffset.Now;
        var units = d.Units;
        var stack = new StackPanel { Spacing = SectionSpacing };

        // 1. Health overview banner (web HealthOverview).
        stack.Children.Add(new HealthOverview(_localizer, d.HealthOverview));

        // 2. Health-score / motor-details / drive-statistics grid (web HealthGaugeGrid).
        stack.Children.Add(new HealthGaugeGrid(_localizer, d.HealthGaugeGrid));

        // 3. Temperature gauges (web TemperatureGauges).
        stack.Children.Add(new TemperatureGauges(_localizer, d.TemperatureGauges));

        // 4. Temperature metric cards (web TemperatureMetricCards) — source-driven, fed from the page snapshot.
        stack.Children.Add(Track(new TemperatureMetricCards(
            new StaticTemperatureMetricCardsSource(d.TemperatureMetricCards, now), _localizer, units)));

        // 5. Thermal-load panel (web ThermalLoadPanel).
        stack.Children.Add(new ThermalLoadPanel(_localizer, d.ThermalLoadPanel, units));

        // 6. Live motor status (web {motorLatest && <LiveMotorStatus/>}).
        if (d.ShowLiveMotor && d.MotorLatest is { } reading)
        {
            stack.Children.Add(Track(new TeslaSync.App.FeatureViews.LiveMotorStatus(
                new StaticLiveMotorStatusSource(reading, now), _localizer, units, null, d.IsolationResistanceKohm)));
        }

        // 7. Stator-temperature chart (web StatorTempChart).
        stack.Children.Add(new StatorTempChart(_localizer, units, d.StatorTempChart));

        // 8. Torque-history chart (web TorqueHistoryChart) — source-driven.
        stack.Children.Add(Track(new TorqueHistoryChart(
            new StaticTorqueHistoryChartSource(d.TorqueSamples, now), _localizer)));

        // 9. Temperature-trend chart (web TemperatureTrendChart).
        stack.Children.Add(new TemperatureTrendChart(_localizer, units, d.TemperatureTrendChart));

        // 10. Power-output chart (web PowerOutputChart).
        stack.Children.Add(new PowerOutputChart(_localizer, d.PowerOutputChart));

        // 11. Health recommendations (web HealthRecommendations) — source-driven.
        stack.Children.Add(Track(new HealthRecommendations(
            new StaticHealthRecommendationsSource(d.HealthRecommendations, now), _localizer)));

        // 12. Detail cards (web DetailCards) — source-driven.
        stack.Children.Add(Track(new DetailCards(
            new StaticDetailCardsSource(d.DetailCards, now), _localizer, units)));

        return stack;
    }

    private T Track<T>(T child)
        where T : UIElement
    {
        if (child is IDisposable disposable)
        {
            _children.Add(disposable);
        }

        return child;
    }

    private void DisposeChildren()
    {
        foreach (var child in _children)
        {
            child.Dispose();
        }

        _children.Clear();
    }

    private static List<FrameworkElement> ColumnBlocks(IReadOnlyList<FrameworkElement> blocks) => [.. blocks];

    private static Grid ColumnsGrid(int columns, double gap, IReadOnlyList<FrameworkElement> children)
    {
        var grid = new Grid { ColumnSpacing = gap };
        for (int i = 0; i < columns; i++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        var ordered = ColumnBlocks(children);
        for (int i = 0; i < ordered.Count; i++)
        {
            var block = ordered[i];
            Grid.SetColumn(block, i % columns);
            grid.Children.Add(block);
        }

        return grid;
    }

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;

    private static async void InvokeAsync(Func<Task> action) => await action().ConfigureAwait(true);

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new DrivetrainHealthPageAutomationPeer(this);

    private sealed class DrivetrainHealthPageAutomationPeer(DrivetrainHealthPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override string GetClassNameCore() => nameof(DrivetrainHealthPage);

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
