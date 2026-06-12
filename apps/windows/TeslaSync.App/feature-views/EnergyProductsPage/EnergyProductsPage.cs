using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Battery;

/// <summary>
/// The native WinUI 3 <c>EnergyProductsPage</c> — a parity port of the web page
/// <c>web/src/features/battery/pages/EnergyProductsPage.tsx</c> (route <c>/energy-products</c>, nav name
/// <c>EnergyProducts</c>). It binds to an <see cref="EnergyProductsPageViewModel"/> and renders every web
/// region with Fluent components and design tokens: the page header with a data-freshness chip + the
/// refresh-from-Tesla action; the failure banner; the four summary stat panels (Energy Sites / With Solar /
/// With Battery / Backup Capable); one card per discovered site (header, the Charge / Capacity / Type stats,
/// the capability chips and the storm-mode chip) hosting a site-configuration section (operation mode +
/// backup-reserve radial gauge, the Powerwalls / Rated Power / Rated Energy stats, firmware, component chips
/// and the Time-of-Use rate-plan panel); and the page-level empty state. The view is a thin renderer: all
/// branch selection, formatting and i18n happen in the view-model's projections. State changes are marshalled
/// onto the UI thread.
/// </summary>
public sealed partial class EnergyProductsPage : UserControl, IDisposable
{
    private readonly EnergyProductsPageViewModel _viewModel;
    private readonly DispatcherQueue? _dispatcher = DispatcherQueue.GetForCurrentThread();
    private readonly ILocalizer _localizer;
    private readonly Dictionary<EnergySiteCardViewModel, EnergySiteCardView> _cardViews = new();
    private bool _disposed;
    private bool _started;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();
    private readonly TsDataFreshness _freshness = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsButton _refreshButton = new() { Variant = ButtonVariant.Primary, IconGlyph = "\uE72C" };

    private readonly TsAlertBanner _errorBanner = new()
    {
        Variant = CalloutVariant.Danger,
        IsOpen = false,
        Dismissible = false,
    };

    private readonly StackPanel _loadingPanel;
    private readonly StackPanel _contentPanel = new() { Spacing = 16 };
    private readonly StackPanel _cardsPanel = new() { Spacing = 16 };

    private readonly TsStatCard _totalSitesTile = new() { Glyph = EnergyProductsProjection.ZapGlyph };
    private readonly TsStatCard _withSolarTile = new() { Glyph = EnergyProductsProjection.SolarGlyph };
    private readonly TsStatCard _withBatteryTile = new() { Glyph = EnergyProductsProjection.BatteryGlyph };
    private readonly TsStatCard _backupCapableTile = new() { Glyph = EnergyProductsProjection.ShieldGlyph };

    private readonly TsGlassPanel _emptyPanel = new() { Padding = new Thickness(32) };
    private readonly TsEmptyState _emptyState = new() { IconGlyph = EnergyProductsProjection.ZapGlyph };

    /// <summary>Raised when a card's "Update rate plan" action is invoked (the host opens the TOU editor).</summary>
    public event EventHandler<long>? RatePlanUpdateRequested;

    /// <summary>Creates the page over the default empty feeds and the shell resource localizer.</summary>
    public EnergyProductsPage()
        : this(EmptyEnergyProductsSource.Instance, EmptyEnergySiteInfoSource.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over explicit data sources and a localizer (used by tests / DI hosts).</summary>
    /// <param name="source">The cache-then-network energy-sites list port.</param>
    /// <param name="siteInfoSource">The shared per-site configuration port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public EnergyProductsPage(IEnergyProductsSource source, IEnergySiteInfoSource siteInfoSource, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(siteInfoSource);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _viewModel = new EnergyProductsPageViewModel(source, siteInfoSource, localizer);

        _loadingPanel = BuildLoadingPanel();
        Content = BuildLayout();

        _refreshButton.Click += OnRefreshClick;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>The navigation route name the shell registers this page under (<c>EnergyProducts</c>).</summary>
    public static string RouteName => EnergyProductsRegistration.RouteName;

    private ScrollViewer BuildLayout()
    {
        var titleRow = new Grid();
        titleRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        titleRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var titleStack = new StackPanel { Spacing = 4 };
        titleStack.Children.Add(_title);
        titleStack.Children.Add(_subtitle);
        Grid.SetColumn(titleStack, 0);

        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 12,
            VerticalAlignment = VerticalAlignment.Center,
        };
        actions.Children.Add(_freshness);
        actions.Children.Add(_refreshButton);
        Grid.SetColumn(actions, 1);

        titleRow.Children.Add(titleStack);
        titleRow.Children.Add(actions);

        BuildContentPanel();
        _emptyPanel.Content = _emptyState;
        _emptyPanel.Visibility = Visibility.Collapsed;

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

    private static StackPanel BuildLoadingPanel()
    {
        var panel = new StackPanel { Spacing = 16, Visibility = Visibility.Collapsed };
        panel.Children.Add(new TsStatGridSkeleton(4));
        panel.Children.Add(new TsStatSkeleton());
        panel.Children.Add(new TsStatSkeleton());
        return panel;
    }

    private void BuildContentPanel()
    {
        _contentPanel.Children.Add(UniformColumns(4, 16,
            _totalSitesTile, _withSolarTile, _withBatteryTile, _backupCapableTile));
        _contentPanel.Children.Add(_cardsPanel);
        _contentPanel.Visibility = Visibility.Collapsed;
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

    private void OnRefreshClick(object sender, RoutedEventArgs e) => _ = _viewModel.RefreshAsync();

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
        _refreshButton.Text = d.RefreshLabel;
        _refreshButton.IsLoading = _viewModel.IsFetching;
        AutomationProperties.SetName(_refreshButton, d.RefreshLabel);

        ApplyStat(_totalSitesTile, d.TotalSites);
        ApplyStat(_withSolarTile, d.WithSolar);
        ApplyStat(_withBatteryTile, d.WithBattery);
        ApplyStat(_backupCapableTile, d.BackupCapable);

        _emptyState.Message = d.EmptyMessage;

        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError || state == EnergyProductsState.Offline;

        RebuildCards();

        bool content = state is EnergyProductsState.Loaded or EnergyProductsState.Stale or EnergyProductsState.Offline;
        _loadingPanel.Visibility = state == EnergyProductsState.Loading ? Visibility.Visible : Visibility.Collapsed;
        _contentPanel.Visibility = content ? Visibility.Visible : Visibility.Collapsed;
        _emptyPanel.Visibility = state == EnergyProductsState.Empty ? Visibility.Visible : Visibility.Collapsed;

        _errorBanner.IsOpen = state == EnergyProductsState.Error;
        _errorBanner.Message = _viewModel.ErrorMessage ?? string.Empty;

        AutomationProperties.SetName(this, d.Title);
    }

    private void RebuildCards()
    {
        var cards = _viewModel.Cards;
        var wanted = new HashSet<EnergySiteCardViewModel>(cards);

        foreach (var pair in _cardViews.Where(p => !wanted.Contains(p.Key)).ToList())
        {
            _cardsPanel.Children.Remove(pair.Value);
            pair.Value.Dispose();
            _cardViews.Remove(pair.Key);
        }

        for (int i = 0; i < cards.Count; i++)
        {
            var cardVm = cards[i];
            if (!_cardViews.TryGetValue(cardVm, out var view))
            {
                view = new EnergySiteCardView(cardVm, _localizer);
                view.RatePlanUpdateRequested += OnCardRatePlanUpdateRequested;
                _cardViews[cardVm] = view;
            }

            if (i >= _cardsPanel.Children.Count || !ReferenceEquals(_cardsPanel.Children[i], view))
            {
                _cardsPanel.Children.Remove(view);
                _cardsPanel.Children.Insert(Math.Min(i, _cardsPanel.Children.Count), view);
            }
        }
    }

    private void OnCardRatePlanUpdateRequested(object? sender, long siteId) =>
        RatePlanUpdateRequested?.Invoke(this, siteId);

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _refreshButton.Click -= OnRefreshClick;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;

        foreach (var view in _cardViews.Values)
        {
            view.RatePlanUpdateRequested -= OnCardRatePlanUpdateRequested;
            view.Dispose();
        }

        _cardViews.Clear();
        _viewModel.Dispose();
    }

    private static void ApplyStat(TsStatCard tile, EnergyStat stat)
    {
        tile.Label = stat.Label;
        tile.Value = stat.Value;
        tile.Glyph = stat.Glyph;
        AutomationProperties.SetName(tile, stat.AutomationName);
    }

    internal static Grid UniformColumns(int columns, double spacing, params FrameworkElement[] children)
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

    internal static Brush? Brush(string key) =>
        Application.Current?.Resources is { } r && r.TryGetValue(key, out var v) && v is Brush b ? b : null;

    internal static TsBadge Chip(StatusKind status, string glyph, string text)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4 };
        if (!string.IsNullOrEmpty(glyph))
        {
            row.Children.Add(new FontIcon { Glyph = glyph, FontSize = 12, VerticalAlignment = VerticalAlignment.Center });
        }

        row.Children.Add(new TextBlock { Text = text, VerticalAlignment = VerticalAlignment.Center });
        var badge = new TsBadge { Status = status, Content = row };
        AutomationProperties.SetName(badge, text);
        return badge;
    }
}
