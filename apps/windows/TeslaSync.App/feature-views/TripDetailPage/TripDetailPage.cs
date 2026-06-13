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

namespace TeslaSync.App.FeatureViews.Trips;

/// <summary>
/// The native WinUI 3 <c>TripDetailPage</c> — a parity port of the web page
/// <c>web/src/features/trips/pages/TripDetailPage.tsx</c> (route <c>/trips/:id</c>, nav name <c>TripDetail</c>).
/// It binds to a <see cref="TripDetailPageViewModel"/> and renders every web region with Fluent components and
/// design tokens: the page header (title + the success-only subtitle), the loading shimmer, the retriable error
/// surface, the page-level "Trip not found" empty surface, and — in the success state — the four headline stat
/// cards (Distance, Energy Used, Efficiency, Cost) and the six-row detail glass panel (Trip ID, Name, Started,
/// Ended, Drives, Charges). The view is a thin renderer: all branch selection, formatting and i18n happen in the
/// view-model's <see cref="TripDetailDisplay"/> projection. State changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class TripDetailPage : UserControl, IDisposable
{
    private const double SectionSpacing = 24;
    private const double PanelPadding = 24;
    private const double CardGap = 16;
    private const double HeaderGap = 4;

    private readonly TripDetailPageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();

    private readonly StackPanel _loadingSkeleton = new() { Spacing = SectionSpacing };
    private readonly TsQueryError _errorState = new();
    private readonly TsEmptyState _emptyState = new() { IconGlyph = TripDetailPageRegistration.EmptyGlyph };
    private readonly ContentControl _contentHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };

    /// <summary>Creates the page over the default empty feed and the shell resource localizer (no trip bound).</summary>
    public TripDetailPage()
        : this(0)
    {
    }

    /// <summary>Creates the page over the default empty feed + shell localizer for a route-supplied trip id.</summary>
    /// <param name="tripId">The trip id from the <c>/trips/:id</c> route param.</param>
    public TripDetailPage(long tripId)
        : this(EmptyTripDetailPageFeed.Instance, ShellLocalizer.Instance, tripId)
    {
    }

    /// <summary>Creates the page over an explicit feed, localizer and trip id (used by tests / dependency injection).</summary>
    /// <param name="feed">The single-source trip data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="tripId">The trip id from the route.</param>
    public TripDetailPage(ITripDetailPageFeed feed, ILocalizer localizer, long tripId)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new TripDetailPageViewModel(feed, localizer, tripId);

        BuildLoadingSkeleton();
        Content = BuildLayout();

        _errorState.ActionInvoked += OnRetryInvoked;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The diagnostics surface slug (<c>TripDetailPage</c>).</summary>
    public static string Slug => TripDetailPageRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting/diagnostics).</summary>
    public TripDetailPageViewModel ViewModel => _viewModel;

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

    private StackPanel BuildHeader()
    {
        // Mirrors web PageContainer header: title with a success-only muted subtitle (name / "Trip #id").
        _subtitle.Visibility = Visibility.Collapsed;
        return new StackPanel
        {
            Spacing = HeaderGap,
            Children = { _title, _subtitle },
        };
    }

    private void BuildLoadingSkeleton()
    {
        // Mirrors the success content shape: four stat-card tiles then the detail glass panel.
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 32 });
        _loadingSkeleton.Children.Add(UniformGrid(4, CardGap, BuildSkeletonBlocks(4, 96)));
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 232 });
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

    private void OnRetryInvoked(object? sender, EventArgs e) => _ = _viewModel.RefreshAsync();

    private void Render(TripDetailDisplay display)
    {
        _title.Value = display.Title;
        AutomationProperties.SetName(this, display.AutomationName);

        _subtitle.Value = display.Subtitle;
        _subtitle.Visibility = Show(display.ShowSubtitle);

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

    private static StackPanel BuildContent(TripDetailDisplay display)
    {
        var stack = new StackPanel { Spacing = SectionSpacing };
        stack.Children.Add(new TsFadeIn { Content = BuildStatCards(display.StatCards) });
        stack.Children.Add(new TsFadeIn { DelayMs = 60, Content = BuildDetailPanel(display) });
        return stack;
    }

    private static Grid BuildStatCards(IReadOnlyList<TripStatCardDisplay> cards)
    {
        var cells = new List<FrameworkElement>(cards.Count);
        foreach (var card in cards)
        {
            var control = new TsStatCard
            {
                Label = card.Label,
                Value = card.Value,
                Glyph = card.Glyph,
            };
            AutomationProperties.SetName(control, $"{card.Label}: {card.Value}");
            cells.Add(control);
        }

        return UniformGrid(4, CardGap, cells);
    }

    private static TsGlassPanel BuildDetailPanel(TripDetailDisplay display)
    {
        var list = new TsKVList { Items = ToKeyValues(display.DetailRows) };
        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = list };
        AutomationProperties.SetName(panel, display.DetailsAccessibleName);
        return panel;
    }

    private static List<TsKeyValue> ToKeyValues(IReadOnlyList<TripKvRow> rows)
    {
        var list = new List<TsKeyValue>(rows.Count);
        foreach (var row in rows)
        {
            list.Add(new TsKeyValue(row.Label, row.Value));
        }

        return list;
    }

    private static Grid UniformGrid(int columns, double spacing, List<FrameworkElement> children)
    {
        var grid = new Grid { ColumnSpacing = spacing, RowSpacing = spacing };
        for (int c = 0; c < columns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        int rows = children.Count == 0 ? 0 : ((children.Count + columns - 1) / columns);
        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < children.Count; i++)
        {
            var element = children[i];
            Grid.SetColumn(element, i % columns);
            Grid.SetRow(element, i / columns);
            grid.Children.Add(element);
        }

        return grid;
    }

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new TripDetailPageAutomationPeer(this);

    private sealed class TripDetailPageAutomationPeer(TripDetailPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override string GetClassNameCore() => nameof(TripDetailPage);

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
