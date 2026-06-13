using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.VehicleSystems;

/// <summary>
/// The native WinUI 3 <c>SoftwareUpdatesPage</c> — a parity port of the web page
/// <c>web/src/features/vehicle-systems/pages/SoftwareUpdatesPage.tsx</c> (route <c>/software-updates</c>, nav
/// name <c>SoftwareUpdates</c>). It binds to a <see cref="SoftwareUpdatesPageViewModel"/> and renders every web
/// region with Fluent components and design tokens: the page header (title + subtitle); the failure banner
/// (web <c>anyError</c>) with a retry affordance; the three metric tiles (Current Version / Updates Installed /
/// Total Updates); and the Update Timeline <see cref="TsGlassPanel"/> whose body switches between the loading
/// skeletons, the "No update history" <see cref="TsEmptyState"/> and the per-update timeline cards — each card
/// carrying the status icon + version + status badge + release-notes link, the owning vehicle, the install /
/// scheduled date and the created date. The view is a thin renderer: all branch selection, formatting and i18n
/// happen in the view-model's <see cref="SoftwareUpdatesDisplay"/> projection. State changes are marshalled
/// onto the UI thread.
/// </summary>
public sealed partial class SoftwareUpdatesPage : UserControl, IDisposable
{
    private const string ExternalLinkGlyph = "\uE8A7"; // OpenInNewWindow
    private const string CalendarGlyph = "\uE787"; // Calendar
    private const string ClockGlyph = "\uE823"; // Recent
    private const string EmptyGlyph = "\uE8EA"; // CellPhone (web Smartphone)

    private readonly SoftwareUpdatesPageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();

    private readonly TsAlertBanner _errorBanner = new()
    {
        Variant = CalloutVariant.Danger,
        IsOpen = false,
        Dismissible = false,
    };

    private readonly TsMetricCard _currentVersionCard = new();
    private readonly TsMetricCard _updatesInstalledCard = new();
    private readonly TsMetricCard _totalUpdatesCard = new();

    private readonly TsGlassPanel _timelinePanel = new() { Padding = new Thickness(24) };
    private readonly PanelTitle _timelineTitle = new();
    private readonly StackPanel _timelineLoading = new() { Spacing = 16 };
    private readonly TsEmptyState _timelineEmpty = new() { IconGlyph = EmptyGlyph };
    private readonly StackPanel _rowsPanel = new() { Spacing = 16 };

    /// <summary>Creates the page over the default empty source and the shell resource localizer.</summary>
    public SoftwareUpdatesPage()
        : this(EmptySoftwareUpdatesSource.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit source and localizer (used by tests / dependency injection).</summary>
    /// <param name="source">The software-updates data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public SoftwareUpdatesPage(ISoftwareUpdatesSource source, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new SoftwareUpdatesPageViewModel(source, localizer);

        BuildLoadingSkeleton();
        BuildTimeline();

        Content = BuildLayout();

        _errorBanner.ActionInvoked += OnRetryInvoked;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The diagnostics surface slug (<c>SoftwareUpdatesPage</c>).</summary>
    public static string Slug => SoftwareUpdatesRegistration.Slug;

    private ScrollViewer BuildLayout()
    {
        var header = new StackPanel { Spacing = 4 };
        header.Children.Add(_title);
        header.Children.Add(_subtitle);

        var root = new StackPanel
        {
            Spacing = 24,
            Padding = new Thickness(24),
            MaxWidth = 1100,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };
        root.Children.Add(header);
        root.Children.Add(_errorBanner);
        root.Children.Add(new TsFadeIn { Content = BuildMetricGrid() });
        root.Children.Add(new TsFadeIn { DelayMs = 50, Content = _timelinePanel });

        return new ScrollViewer
        {
            Content = root,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
        };
    }

    private Grid BuildMetricGrid()
    {
        var grid = new Grid { ColumnSpacing = 16 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        Place(grid, _currentVersionCard, 0);
        Place(grid, _updatesInstalledCard, 1);
        Place(grid, _totalUpdatesCard, 2);
        return grid;
    }

    private static void Place(Grid grid, FrameworkElement element, int column)
    {
        element.HorizontalAlignment = HorizontalAlignment.Stretch;
        Grid.SetColumn(element, column);
        grid.Children.Add(element);
    }

    private void BuildLoadingSkeleton()
    {
        for (int i = 0; i < 4; i++)
        {
            _timelineLoading.Children.Add(new TsSkeleton { BlockHeight = 80, Radius = 12 });
        }
    }

    private void BuildTimeline()
    {
        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(_timelineTitle);
        column.Children.Add(_timelineLoading);
        column.Children.Add(_timelineEmpty);
        column.Children.Add(_rowsPanel);
        _timelinePanel.Content = column;
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
        _errorBanner.ActionInvoked -= OnRetryInvoked;
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

    private void Render(SoftwareUpdatesDisplay display)
    {
        _title.Value = display.Title;
        _subtitle.Value = display.Subtitle;
        AutomationProperties.SetName(this, display.AutomationName);

        _errorBanner.IsOpen = display.ShowError;
        _errorBanner.Message = display.ErrorText;
        _errorBanner.ActionText = display.RetryText;
        AutomationProperties.SetName(_errorBanner, display.ErrorText);

        RenderMetric(_currentVersionCard, display, "currentVersion");
        RenderMetric(_updatesInstalledCard, display, "updatesInstalled");
        RenderMetric(_totalUpdatesCard, display, "totalUpdates");

        _timelineTitle.Value = display.TimelineTitle;
        AutomationProperties.SetName(_timelinePanel, display.TimelineTitle);

        _timelineLoading.Visibility = Show(display.ShowLoading);

        _timelineEmpty.Visibility = Show(display.ShowEmpty);
        _timelineEmpty.Title = display.EmptyTitle;
        _timelineEmpty.Message = display.EmptyMessage;

        _rowsPanel.Visibility = Show(display.ShowRows);
        RenderRows(display);
    }

    private void RenderRows(SoftwareUpdatesDisplay display)
    {
        _rowsPanel.Children.Clear();
        if (!display.ShowRows)
        {
            return;
        }

        foreach (var row in display.Rows)
        {
            _rowsPanel.Children.Add(BuildRow(row));
        }
    }

    private static TsGlassPanel BuildRow(SoftwareUpdateTimelineRow row)
    {
        var statusIcon = new FontIcon
        {
            Glyph = row.Glyph,
            FontSize = 16,
            VerticalAlignment = VerticalAlignment.Center,
            Foreground = TypographyTokens.Brush(row.AccentBrushKey),
        };

        var badge = new TsBadge { Content = row.StatusLabel, Status = row.BadgeStatus, VerticalAlignment = VerticalAlignment.Center };

        var releaseLink = new HyperlinkButton
        {
            NavigateUri = row.ReleaseNotesUri,
            Content = new FontIcon { Glyph = ExternalLinkGlyph, FontSize = 12 },
            Padding = new Thickness(4),
            VerticalAlignment = VerticalAlignment.Center,
        };
        ToolTipService.SetToolTip(releaseLink, row.ReleaseNotesTooltip);
        AutomationProperties.SetName(releaseLink, row.ReleaseNotesTooltip);

        var headerRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        headerRow.Children.Add(statusIcon);
        headerRow.Children.Add(new PanelTitle { Value = row.Version, VerticalAlignment = VerticalAlignment.Center });
        headerRow.Children.Add(badge);
        headerRow.Children.Add(releaseLink);

        var leftColumn = new StackPanel { Spacing = 4, VerticalAlignment = VerticalAlignment.Center };
        leftColumn.Children.Add(headerRow);
        leftColumn.Children.Add(new Caption { Value = row.VehicleName });

        var rightColumn = new StackPanel { Spacing = 2, HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Center };
        if (row.HasInstalledDate)
        {
            rightColumn.Children.Add(BuildDateLine(CalendarGlyph, row.InstalledDate));
        }

        if (row.HasScheduled)
        {
            rightColumn.Children.Add(BuildScheduledLine(row.ScheduledText));
        }

        rightColumn.Children.Add(new Caption { Value = row.CreatedDate });

        var grid = new Grid { ColumnSpacing = 16 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(leftColumn, 0);
        Grid.SetColumn(rightColumn, 1);
        grid.Children.Add(leftColumn);
        grid.Children.Add(rightColumn);

        var panel = new TsGlassPanel { Padding = new Thickness(16), Content = grid };
        AutomationProperties.SetName(panel, row.AutomationName);
        return panel;
    }

    private static StackPanel BuildDateLine(string glyph, string text)
    {
        var line = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4, HorizontalAlignment = HorizontalAlignment.Right };
        line.Children.Add(new FontIcon { Glyph = glyph, FontSize = 12, VerticalAlignment = VerticalAlignment.Center });
        line.Children.Add(new Caption { Value = text, VerticalAlignment = VerticalAlignment.Center });
        return line;
    }

    private static StackPanel BuildScheduledLine(string text)
    {
        var line = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4, HorizontalAlignment = HorizontalAlignment.Right };
        var icon = new FontIcon { Glyph = ClockGlyph, FontSize = 12, VerticalAlignment = VerticalAlignment.Center, Foreground = TypographyTokens.Brush("TsColorWarningBrush") };
        var caption = new Caption { Value = text, VerticalAlignment = VerticalAlignment.Center };
        line.Children.Add(icon);
        line.Children.Add(caption);
        return line;
    }

    private static void RenderMetric(TsMetricCard card, SoftwareUpdatesDisplay display, string key)
    {
        var metric = FindMetric(display, key);
        card.Label = metric.Label;
        card.Value = metric.Value;
        card.AccentBrushKey = metric.AccentBrushKey;
        AutomationProperties.SetName(card, metric.AutomationName);
    }

    private static SoftwareUpdateMetric FindMetric(SoftwareUpdatesDisplay display, string key)
    {
        foreach (var metric in display.Metrics)
        {
            if (string.Equals(metric.Key, key, StringComparison.Ordinal))
            {
                return metric;
            }
        }

        return new SoftwareUpdateMetric(key, string.Empty, string.Empty, "TsColorAccentBrush", string.Empty);
    }

    private void OnRetryInvoked(object? sender, EventArgs e) => InvokeAsync(() => _viewModel.RetryAsync());

    private static async void InvokeAsync(Func<Task> action)
    {
        await action().ConfigureAwait(true);
    }

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new SoftwareUpdatesPageAutomationPeer(this);

    private sealed class SoftwareUpdatesPageAutomationPeer(SoftwareUpdatesPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
