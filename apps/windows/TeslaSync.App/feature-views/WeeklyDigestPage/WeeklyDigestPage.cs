using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.WeeklyDigest;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Analytics;

/// <summary>
/// The native WinUI 3 <c>WeeklyDigestPage</c> — a parity port of the web page
/// <c>web/src/features/analytics/pages/WeeklyDigestPage.tsx</c> (route <c>/weekly-digest</c>, nav name
/// <c>WeeklyDigest</c>). It binds to a <see cref="WeeklyDigestPageViewModel"/> and renders every web region with
/// Fluent components and design tokens: the page header (title + subtitle) and the vehicle picker (web
/// <c>PageContainer</c> + <c>Select</c> actions), the loading skeleton (web <c>DigestSkeleton</c>), the retriable
/// error surface (web <c>PageContainer error</c>), the "No Data" empty state (web <c>EmptyState</c>), and the
/// populated digest (the week selector, the summary hero cards, and the embedded driving / charging / battery /
/// alerts sections plus the week-over-week comparison). The view is a thin renderer: all branch selection,
/// aggregation, unit conversion and i18n happen in the view-model's <see cref="WeeklyDigestDisplay"/> projection.
/// State changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class WeeklyDigestPage : UserControl, IDisposable
{
    private const int HeroCardCapacity = 6;
    private const int HeroColumns = 3;

    private readonly WeeklyDigestPageViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();
    private readonly TsSelect _vehicleSelect = new() { MinWidth = 192, HorizontalAlignment = HorizontalAlignment.Right };
    private bool _suppressVehicleEvent;
    private string _vehicleOptionsKey = string.Empty;

    private readonly StackPanel _loadingSkeleton = new() { Spacing = 24 };
    private readonly TsGlassPanel _emptyPanel = new();
    private readonly TsEmptyState _emptyState = new();
    private readonly TsQueryError _errorState = new();

    private readonly TsFadeIn _content = new();
    private readonly TsButton _prevWeekButton = new() { IconGlyph = "\uE76B" }; // ChevronLeft
    private readonly TsButton _nextWeekButton = new() { IconGlyph = "\uE76C" }; // ChevronRight
    private readonly TextBlock _weekLabel = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsBadge _currentBadge = new() { Status = StatusKind.Info };
    private readonly PanelTitle _weekSummaryTitle = new();
    private readonly Grid _heroGrid = new() { ColumnSpacing = 16, RowSpacing = 16 };
    private readonly List<HighlightCard> _heroCards = new(HeroCardCapacity);

    private readonly DrivingSection _driving;
    private readonly ChargingSection _charging;
    private readonly BatteryHealthSection _battery;
    private readonly AlertsSection _alerts;
    private readonly StaticWeekOverWeekSource _weekOverWeekSource;
    private readonly WeekOverWeekSummary _weekOverWeek;

    /// <summary>Creates the page over the default local-state feed and the shell resource localizer.</summary>
    public WeeklyDigestPage()
        : this(EmptyWeeklyDigestFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The weekly-digest data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="clock">Injectable clock used to resolve the active week (deterministic in tests).</param>
    /// <param name="currencySymbol">The active currency symbol for the cost figures (defaults to <c>$</c>).</param>
    public WeeklyDigestPage(
        IWeeklyDigestFeed feed,
        ILocalizer localizer,
        Func<DateTimeOffset>? clock = null,
        string? currencySymbol = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _viewModel = new WeeklyDigestPageViewModel(feed, localizer, clock, currencySymbol);

        _driving = new DrivingSection(localizer);
        _charging = new ChargingSection(localizer, currencySymbol: currencySymbol);
        _battery = new BatteryHealthSection(localizer);
        _alerts = new AlertsSection(localizer);
        _weekOverWeekSource = new StaticWeekOverWeekSource(clock);
        _weekOverWeek = new WeekOverWeekSummary(_weekOverWeekSource, localizer, currencySymbol);

        BuildHeroCards();
        Content = BuildLayout();

        _vehicleSelect.SelectionChanged += OnVehicleSelectionChanged;
        _prevWeekButton.Click += OnPrevWeek;
        _nextWeekButton.Click += OnNextWeek;
        _errorState.ActionInvoked += OnRetryInvoked;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The diagnostics surface slug (<c>WeeklyDigestPage</c>).</summary>
    public static string Slug => WeeklyDigestRegistration.Slug;

    private ScrollViewer BuildLayout()
    {
        var stack = new StackPanel { Spacing = 24, Padding = new Thickness(24) };
        stack.Children.Add(BuildHeader());
        stack.Children.Add(_loadingSkeleton);
        stack.Children.Add(_errorState);
        stack.Children.Add(_emptyPanel);
        stack.Children.Add(_content);

        BuildLoadingSkeleton();
        BuildEmptyPanel();
        BuildContent();

        return new ScrollViewer
        {
            Content = stack,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
    }

    private Grid BuildHeader()
    {
        var header = new Grid { ColumnSpacing = 16 };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var titles = new StackPanel { Spacing = 4, VerticalAlignment = VerticalAlignment.Center };
        titles.Children.Add(_title);
        titles.Children.Add(_subtitle);
        Grid.SetColumn(titles, 0);

        _vehicleSelect.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(_vehicleSelect, 1);

        header.Children.Add(titles);
        header.Children.Add(_vehicleSelect);
        return header;
    }

    private void BuildLoadingSkeleton()
    {
        // Web DigestSkeleton: a header block, the hero stat grid, and the section chart skeletons.
        _loadingSkeleton.Children.Add(new TsStatGridSkeleton(3));
        _loadingSkeleton.Children.Add(new TsStatGridSkeleton(4));
        _loadingSkeleton.Children.Add(new TsStatGridSkeleton(3));
    }

    private void BuildEmptyPanel()
    {
        _emptyPanel.Padding = new Thickness(24);
        _emptyPanel.Content = _emptyState;
    }

    private void BuildHeroCards()
    {
        for (var i = 0; i < HeroColumns; i++)
        {
            _heroGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        for (var i = 0; i < HeroCardCapacity; i++)
        {
            var card = new HighlightCard(_localizer) { HorizontalAlignment = HorizontalAlignment.Stretch };
            Grid.SetColumn(card, i % HeroColumns);
            Grid.SetRow(card, i / HeroColumns);
            _heroCards.Add(card);
            _heroGrid.Children.Add(card);
        }

        _heroGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        _heroGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
    }

    private void BuildContent()
    {
        var stack = new StackPanel { Spacing = 24 };

        stack.Children.Add(BuildWeekSelector());
        stack.Children.Add(BuildHeroPanel());
        stack.Children.Add(_driving);
        stack.Children.Add(_charging);
        stack.Children.Add(_battery);
        stack.Children.Add(_alerts);
        stack.Children.Add(_weekOverWeek);

        _content.Content = stack;
    }

    private TsGlassPanel BuildWeekSelector()
    {
        var grid = new Grid { Padding = new Thickness(20, 12, 20, 12) };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        Grid.SetColumn(_prevWeekButton, 0);

        var center = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        center.Children.Add(new FontIcon { Glyph = "\uE787", FontSize = 16, VerticalAlignment = VerticalAlignment.Center });
        center.Children.Add(_weekLabel);
        center.Children.Add(_currentBadge);
        Grid.SetColumn(center, 1);

        Grid.SetColumn(_nextWeekButton, 2);

        grid.Children.Add(_prevWeekButton);
        grid.Children.Add(center);
        grid.Children.Add(_nextWeekButton);

        return new TsGlassPanel { Content = grid };
    }

    private TsGlassPanel BuildHeroPanel()
    {
        var body = new StackPanel { Spacing = 16, Padding = new Thickness(24) };
        body.Children.Add(_weekSummaryTitle);
        body.Children.Add(_heroGrid);
        return new TsGlassPanel { Content = body };
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        _viewModel.NotifyOpened();
        await _viewModel.LoadAsync().ConfigureAwait(true);
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Unsubscribe from and dispose the view-model + the embedded week-over-week surface (CA1001).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _vehicleSelect.SelectionChanged -= OnVehicleSelectionChanged;
        _prevWeekButton.Click -= OnPrevWeek;
        _nextWeekButton.Click -= OnNextWeek;
        _errorState.ActionInvoked -= OnRetryInvoked;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        _weekOverWeek.Dispose();
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

    private void Render(WeeklyDigestDisplay display)
    {
        _title.Value = display.Title;
        _subtitle.Value = display.Subtitle;
        AutomationProperties.SetName(this, display.AutomationName);

        _vehicleSelect.Hint = display.SelectVehicleHint;
        _vehicleSelect.Visibility = Show(display.HasVehicles);
        UpdateVehicleOptions(display.VehicleOptions, display.SelectedVehicleId);

        _loadingSkeleton.Visibility = Show(display.ShowLoading);

        _errorState.Visibility = Show(display.ShowError);
        _errorState.Title = display.ErrorText;
        _errorState.ActionText = display.RetryLabel;
        AutomationProperties.SetName(_errorState, display.ErrorText);

        _emptyPanel.Visibility = Show(display.ShowEmpty);
        _emptyState.IconGlyph = display.EmptyGlyph;
        _emptyState.Title = display.EmptyTitle;
        _emptyState.Message = display.EmptyMessage;

        _content.Visibility = Show(display.ShowContent);
        if (display.ShowContent)
        {
            RenderContent(display);
        }
    }

    private void RenderContent(WeeklyDigestDisplay display)
    {
        _weekLabel.Text = display.WeekLabel;
        _prevWeekButton.Text = display.PrevWeekLabel;
        _nextWeekButton.Text = display.NextWeekLabel;
        _nextWeekButton.IsEnabled = !display.IsCurrentWeek;
        _currentBadge.Content = display.CurrentBadgeLabel;
        _currentBadge.Visibility = Show(display.IsCurrentWeek);
        AutomationProperties.SetName(_weekLabel, display.WeekLabel);

        _weekSummaryTitle.Value = display.WeekSummaryTitle;
        for (var i = 0; i < _heroCards.Count; i++)
        {
            if (i < display.HeroCards.Count)
            {
                _heroCards[i].Model = display.HeroCards[i];
                _heroCards[i].Visibility = Visibility.Visible;
            }
            else
            {
                _heroCards[i].Visibility = Visibility.Collapsed;
            }
        }

        _driving.Model = display.DrivingModel;
        _charging.Model = display.ChargingModel;
        _battery.Model = display.BatteryModel;
        _alerts.Model = display.AlertsModel;

        _weekOverWeekSource.Metrics = display.WeekOverWeek;
        _ = _weekOverWeek.ViewModel.LoadAsync();
    }

    private void UpdateVehicleOptions(IReadOnlyList<WeeklyDigestVehicleOption> options, string selectedId)
    {
        string key = string.Join("|", options.Select(o => $"{o.Id}:{o.Label}"));
        if (!string.Equals(key, _vehicleOptionsKey, StringComparison.Ordinal))
        {
            _vehicleOptionsKey = key;
            _suppressVehicleEvent = true;
            _vehicleSelect.Items.Clear();
            foreach (var option in options)
            {
                _vehicleSelect.Items.Add(new ComboBoxItem { Content = option.Label, Tag = option.Id });
            }

            _suppressVehicleEvent = false;
        }

        SelectVehicleItem(selectedId);
    }

    private void SelectVehicleItem(string selectedId)
    {
        var match = _vehicleSelect.Items
            .OfType<ComboBoxItem>()
            .FirstOrDefault(item => string.Equals(item.Tag as string, selectedId, StringComparison.Ordinal));

        if (ReferenceEquals(_vehicleSelect.SelectedItem, match))
        {
            return;
        }

        _suppressVehicleEvent = true;
        _vehicleSelect.SelectedItem = match;
        _suppressVehicleEvent = false;
    }

    private void OnVehicleSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppressVehicleEvent || _vehicleSelect.SelectedItem is not ComboBoxItem { Tag: string id })
        {
            return;
        }

        InvokeAsync(() => _viewModel.SelectVehicleAsync(id));
    }

    private void OnPrevWeek(object sender, RoutedEventArgs e) => _viewModel.PreviousWeek();

    private void OnNextWeek(object sender, RoutedEventArgs e) => _viewModel.NextWeek();

    private void OnRetryInvoked(object? sender, EventArgs e) => InvokeAsync(() => _viewModel.RefreshAsync());

    private static async void InvokeAsync(Func<Task> action)
    {
        await action().ConfigureAwait(true);
    }

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;
}
