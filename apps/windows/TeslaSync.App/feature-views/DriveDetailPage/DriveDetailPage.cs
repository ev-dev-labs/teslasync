using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;
using TeslaSync.App.SharedSurfaces;

namespace TeslaSync.App.FeatureViews.Driving;

/// <summary>
/// The native WinUI 3 <c>DriveDetailPage</c> — a parity port of the web page
/// <c>web/src/features/driving/pages/DriveDetailPage.tsx</c> (route <c>/drives/:id</c>, nav name
/// <c>DriveDetail</c>). It binds to a <see cref="DriveDetailPageViewModel"/> and is the parent composition shell
/// for the drive-detail experience: it owns the query lifecycle and renders the page-level loading shimmer, the
/// retriable error surface and the page-level empty surface once, then — in the success state — the nineteen web
/// <c>&lt;SectionErrorBoundary&gt;</c> regions (header, hero gauges, timeline, stat cards, Helix coaching, more
/// details, energy summary, cost savings, route map, journey details, overview / SoC / elevation charts,
/// temperature, speed histogram, Helix speed-profile insights, power profile, tire pressure and the why-ended
/// diagnostic), each carrying its localized fallback title and a real data summary drawn from the resolved drive,
/// plus the no-telemetry informational banner that replaces the numeric-summary sections when the drive carries
/// no meaningful telemetry. The view is a thin renderer: all branch selection, formatting, gating and i18n happen
/// in the view-model's <see cref="DriveDetailDisplay"/> projection. State changes are marshalled onto the UI
/// thread.
/// </summary>
public sealed partial class DriveDetailPage : UserControl, IDisposable
{
    private const double SectionSpacing = 24;
    private const double PanelPadding = 24;
    private const double RowGap = 12;
    private const string ChevronLeftGlyph = "\uE76B";

    private readonly DriveDetailPageViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;

    private readonly TsButton _back = new()
    {
        Variant = ButtonVariant.Subtle,
        Size = ControlSize.Small,
        IconGlyph = ChevronLeftGlyph,
        VerticalAlignment = VerticalAlignment.Center,
        Margin = new Thickness(0, 0, RowGap, 0),
    };

    private readonly PageTitle _title = new();
    private readonly TsDataFreshness _freshness = new();
    private readonly PrintButton _print = new();

    private readonly StackPanel _loadingSkeleton = new() { Spacing = SectionSpacing };
    private readonly TsQueryError _errorState = new();
    private readonly TsEmptyState _emptyState = new() { IconGlyph = DriveDetailPageRegistration.EmptyGlyph };
    private readonly ContentControl _contentHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };

    /// <summary>Creates the page over the default empty feed and the shell resource localizer (no drive bound).</summary>
    public DriveDetailPage()
        : this(0)
    {
    }

    /// <summary>Creates the page over the default empty feed + shell localizer for a route-supplied drive id.</summary>
    /// <param name="driveId">The drive id from the <c>/drives/:id</c> route param.</param>
    public DriveDetailPage(long driveId)
        : this(EmptyDriveDetailPageFeed.Instance, ShellLocalizer.Instance, driveId)
    {
    }

    /// <summary>Creates the page over an explicit feed, localizer and drive id (used by tests / dependency injection).</summary>
    /// <param name="feed">The two-source drive data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="driveId">The drive id from the route.</param>
    public DriveDetailPage(IDriveDetailPageFeed feed, ILocalizer localizer, long driveId)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _viewModel = new DriveDetailPageViewModel(feed, localizer, driveId);

        BuildLoadingSkeleton();
        Content = BuildLayout();

        _errorState.ActionInvoked += OnRetryInvoked;
        _back.Click += OnBackClick;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        AutomationProperties.SetName(_back, _localizer.GetString("common.back", "Back"));

        Render(_viewModel.Display);
    }

    /// <summary>Raised when the in-content back affordance is invoked (web back link to <c>/drives</c>).</summary>
    public event EventHandler? BackRequested;

    /// <summary>The diagnostics surface slug (<c>DriveDetailPage</c>).</summary>
    public static string Slug => DriveDetailPageRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting/diagnostics).</summary>
    public DriveDetailPageViewModel ViewModel => _viewModel;

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
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        Grid.SetColumn(_back, 0);
        grid.Children.Add(_back);

        _title.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(_title, 1);
        grid.Children.Add(_title);

        _freshness.VerticalAlignment = VerticalAlignment.Center;
        _freshness.Margin = new Thickness(0, 0, RowGap, 0);
        Grid.SetColumn(_freshness, 2);
        grid.Children.Add(_freshness);

        _print.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(_print, 3);
        grid.Children.Add(_print);

        return grid;
    }

    private void BuildLoadingSkeleton()
    {
        // Mirrors web DriveDetailSkeleton: header → hero (h-36) → 8 stat cards → overview chart → 2 side charts.
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 36 });
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 144 });
        _loadingSkeleton.Children.Add(UniformGrid(4, 16, BuildSkeletonBlocks(8, 96)));
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 320 });
        _loadingSkeleton.Children.Add(UniformGrid(2, 16, BuildSkeletonBlocks(2, 280)));
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
        _back.Click -= OnBackClick;
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

    private void Render(DriveDetailDisplay display)
    {
        _title.Value = display.Title;
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
        _contentHost.Content = display.ShowContent ? BuildContent(display) : null;
    }

    private StackPanel BuildContent(DriveDetailDisplay display)
    {
        var stack = new StackPanel { Spacing = SectionSpacing };
        int delay = 0;

        foreach (var section in display.Sections)
        {
            if (!section.Visible)
            {
                continue;
            }

            stack.Children.Add(new TsFadeIn { DelayMs = delay, Content = BuildSection(section) });
            delay += 40;

            // The no-telemetry banner sits directly after the header (web AlertBanner placement).
            if (section.Id == "header" && display.ShowNoTelemetryBanner)
            {
                stack.Children.Add(new TsFadeIn { DelayMs = delay, Content = BuildNoTelemetryBanner(display) });
                delay += 40;
            }
        }

        return stack;
    }

    private static TsAlertBanner BuildNoTelemetryBanner(DriveDetailDisplay display)
    {
        var banner = new TsAlertBanner
        {
            Variant = CalloutVariant.Info,
            Title = display.NoTelemetryTitle,
            Message = display.NoTelemetryBody,
            Dismissible = false,
            IsOpen = true,
        };
        AutomationProperties.SetName(banner, $"{display.NoTelemetryTitle}. {display.NoTelemetryBody}");
        return banner;
    }

    private SectionErrorBoundary BuildSection(DriveSectionDisplay section)
    {
        var column = new StackPanel { Spacing = RowGap };

        if (!string.IsNullOrEmpty(section.Heading))
        {
            column.Children.Add(new SectionTitle { Value = section.Heading });
        }

        if (section.Rows.Count > 0)
        {
            column.Children.Add(new TsKVList { Items = ToKeyValues(section.Rows) });
        }
        else
        {
            column.Children.Add(new TsEmptyState { Message = section.EmptyText ?? string.Empty });
        }

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
        AutomationProperties.SetName(panel, section.AccessibleName);

        var boundary = new SectionErrorBoundary(_localizer)
        {
            FallbackTitle = section.FallbackTitle,
            ProtectedContent = panel,
        };
        return boundary;
    }

    private static List<TsKeyValue> ToKeyValues(IReadOnlyList<DriveKvRow> rows)
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

    private void OnBackClick(object sender, RoutedEventArgs e) => BackRequested?.Invoke(this, EventArgs.Empty);

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new DriveDetailPageAutomationPeer(this);

    private sealed class DriveDetailPageAutomationPeer(DriveDetailPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override string GetClassNameCore() => nameof(DriveDetailPage);

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
