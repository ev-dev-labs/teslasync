using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// The native WinUI 3 <c>DiskForecastPage</c> — a parity port of the web page
/// <c>web/src/features/admin/pages/DiskForecastPage.tsx</c> (route <c>/admin/disk-forecast</c>, nav name
/// <c>DiskForecast</c>). It binds to a <see cref="DiskForecastPageViewModel"/> and renders every web region with Fluent
/// components and design tokens: the page header (title + subtitle), the HTTP-503 subsystem-unavailable banner (web
/// <c>subsystemMissing</c>), the loading shimmer, the generic failure surface (InfoBar-equivalent + Retry), the
/// "no hypertables" empty state, the fleet-totals stat grid (the Total-disk / Uncompressed / Compressed /
/// Growth-per-day cards) and the hypertables table panel (GlassPanel 5) with its six columns — name + chunk count,
/// total, the uncompressed/compressed split, per-day growth, days-to-quota and the severity badge. The view is a thin
/// renderer: all branch selection, formatting and i18n happen in the view-model's <see cref="DiskForecastDisplay"/>
/// projection. State changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class DiskForecastPage : UserControl, IDisposable
{
    private readonly DiskForecastPageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();

    private readonly TsAlertBanner _subsystemBanner = new() { Variant = CalloutVariant.Warning, IsOpen = false, Dismissible = false };
    private readonly TsStatGridSkeleton _loadingSkeleton = new(4);
    private readonly TsQueryError _errorState = new();

    private readonly Grid _statGrid = new() { ColumnSpacing = 16 };
    private readonly TsStatCard _totalCard = new();
    private readonly TsStatCard _uncompressedCard = new();
    private readonly TsStatCard _compressedCard = new();
    private readonly TsStatCard _growthCard = new();

    private readonly TsGlassPanel _tablePanel = new();
    private readonly PanelTitle _tableTitle = new();
    private readonly ContentControl _tableHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };
    private readonly TsEmptyState _emptyState = new() { IconGlyph = "\uE958" }; // Storage / database

    /// <summary>Creates the page over the default local-state feed and the shell resource localizer.</summary>
    public DiskForecastPage()
        : this(EmptyDiskForecastFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The disk-forecast data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public DiskForecastPage(IDiskForecastFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new DiskForecastPageViewModel(feed, localizer);

        BuildStatGrid();
        BuildTablePanel();

        Content = BuildLayout();

        _errorState.ActionInvoked += OnRetryInvoked;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The diagnostics surface slug (<c>DiskForecastPage</c>).</summary>
    public static string Slug => DiskForecastRegistration.Slug;

    private ScrollViewer BuildLayout()
    {
        var stack = new StackPanel { Spacing = 24, Padding = new Thickness(24) };
        stack.Children.Add(BuildHeader());
        stack.Children.Add(_subsystemBanner);
        stack.Children.Add(_loadingSkeleton);
        stack.Children.Add(_errorState);
        stack.Children.Add(_statGrid);
        stack.Children.Add(_tablePanel);

        return new ScrollViewer
        {
            Content = stack,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
    }

    private StackPanel BuildHeader()
    {
        var header = new StackPanel { Spacing = 4 };
        header.Children.Add(_title);
        header.Children.Add(_subtitle);
        return header;
    }

    private void BuildStatGrid()
    {
        var cards = new FrameworkElement[] { _totalCard, _uncompressedCard, _compressedCard, _growthCard };
        for (var i = 0; i < cards.Length; i++)
        {
            _statGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            Grid.SetColumn(cards[i], i);
            _statGrid.Children.Add(cards[i]);
        }
    }

    private void BuildTablePanel()
    {
        var body = new StackPanel { Spacing = 16, Padding = new Thickness(24) };
        body.Children.Add(_tableTitle);
        body.Children.Add(_tableHost);
        _tablePanel.Content = body;
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

    private void Render(DiskForecastDisplay display)
    {
        _title.Value = display.Title;
        _subtitle.Value = display.Subtitle;
        AutomationProperties.SetName(this, display.AutomationName);

        // Subsystem-unavailable banner (web 503 subsystemMissing).
        _subsystemBanner.Title = display.SubsystemTitle;
        _subsystemBanner.Message = display.SubsystemMessage;
        _subsystemBanner.IsOpen = display.ShowSubsystemUnavailable;
        _subsystemBanner.Visibility = Show(display.ShowSubsystemUnavailable);

        // Loading shimmer.
        _loadingSkeleton.Visibility = Show(display.ShowLoading);

        // Generic failure surface (InfoBar-equivalent + Retry).
        _errorState.Visibility = Show(display.ShowError);
        _errorState.Title = display.ErrorText;
        _errorState.ActionText = display.RetryLabel;
        AutomationProperties.SetName(_errorState, display.ErrorText);

        // Fleet-totals stat grid (the four web StatCards).
        _statGrid.Visibility = Show(display.ShowStats);
        ApplyStat(_totalCard, display.TotalCard);
        ApplyStat(_uncompressedCard, display.UncompressedCard);
        ApplyStat(_compressedCard, display.CompressedCard);
        ApplyStat(_growthCard, display.GrowthCard);

        // Hypertables table panel (GlassPanel 5): table when populated, otherwise the empty state.
        _tablePanel.Visibility = Show(display.ShowTablePanel);
        _tableTitle.Value = display.TableTitle;

        _emptyState.Title = display.EmptyTitle;
        _emptyState.Message = display.EmptyMessage;

        if (display.ShowTable)
        {
            _tableHost.Content = BuildTable(display);
        }
        else
        {
            _tableHost.Content = _emptyState;
        }
    }

    private static void ApplyStat(TsStatCard card, DiskForecastStatDisplay model)
    {
        card.Label = model.Label;
        card.Value = model.Value;
        card.Sublabel = model.Sublabel;
    }

    // The web DataTable: a header row above one row per hypertable, horizontally scrollable.
    private static ScrollViewer BuildTable(DiskForecastDisplay display)
    {
        var table = new StackPanel { Spacing = 0, MinWidth = 720 };
        table.Children.Add(BuildHeaderRow(display));
        foreach (var row in display.Rows)
        {
            table.Children.Add(BuildRow(row));
        }

        var scroller = new ScrollViewer
        {
            Content = table,
            HorizontalScrollMode = ScrollMode.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
            VerticalScrollMode = ScrollMode.Disabled,
            VerticalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
        AutomationProperties.SetName(scroller, display.TableTitle);
        return scroller;
    }

    private static Grid NewRowGrid()
    {
        var grid = new Grid { ColumnSpacing = 12 };
        double[] weights = { 2.2, 1.0, 1.6, 1.0, 1.0, 0.9 };
        foreach (var w in weights)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(w, GridUnitType.Star) });
        }

        return grid;
    }

    private static Border BuildHeaderRow(DiskForecastDisplay display)
    {
        var grid = NewRowGrid();
        AddHeaderCell(grid, 0, display.ColTable, right: false);
        AddHeaderCell(grid, 1, display.ColTotal, right: true);
        AddHeaderCell(grid, 2, display.ColSplit, right: true);
        AddHeaderCell(grid, 3, display.ColGrowth, right: true);
        AddHeaderCell(grid, 4, display.ColDays, right: true);
        AddHeaderCell(grid, 5, display.ColSeverity, right: true);

        return new Border
        {
            Child = grid,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(0, 0, 0, 1),
            Padding = new Thickness(0, 0, 0, 8),
        };
    }

    private static void AddHeaderCell(Grid grid, int column, string text, bool right)
    {
        var block = new TextBlock
        {
            Text = text,
            FontFamily = TypographyTokens.Sans,
            FontSize = 12,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextSecondary,
            Padding = new Thickness(4, 4, 4, 4),
            TextTrimming = TextTrimming.CharacterEllipsis,
            HorizontalAlignment = right ? HorizontalAlignment.Right : HorizontalAlignment.Left,
            TextAlignment = right ? TextAlignment.Right : TextAlignment.Left,
        };
        Grid.SetColumn(block, column);
        grid.Children.Add(block);
    }

    private static Border BuildRow(DiskForecastRowDisplay row)
    {
        var grid = NewRowGrid();

        var nameCell = BuildStackedCell(row.HypertableName, row.ChunkCountText, right: false, boldValue: true);
        Grid.SetColumn(nameCell, 0);
        grid.Children.Add(nameCell);

        AddTextCell(grid, 1, row.TotalText, right: true);

        var splitCell = BuildStackedCell(row.UncompressedText, row.CompressedText, right: true, boldValue: false);
        Grid.SetColumn(splitCell, 2);
        grid.Children.Add(splitCell);

        AddTextCell(grid, 3, row.GrowthText, right: true);
        AddTextCell(grid, 4, row.DaysText, right: true);

        var badge = new TsBadge
        {
            Status = row.SeverityVariant,
            Content = new TextBlock { Text = row.SeverityLabel, FontSize = 11 },
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(badge, row.SeverityLabel);
        Grid.SetColumn(badge, 5);
        grid.Children.Add(badge);

        AutomationProperties.SetName(grid, row.AutomationName);
        AutomationProperties.SetAccessibilityView(grid, AccessibilityView.Content);

        return new Border
        {
            Child = grid,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(0, 0, 0, 1),
            Padding = new Thickness(0, 8, 0, 8),
        };
    }

    private static void AddTextCell(Grid grid, int column, string text, bool right)
    {
        var block = new TextBlock
        {
            Text = text,
            FontFamily = TypographyTokens.Sans,
            FontSize = 13,
            Foreground = DisplayTokens.TextPrimary,
            Padding = new Thickness(4, 2, 4, 2),
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
            HorizontalAlignment = right ? HorizontalAlignment.Right : HorizontalAlignment.Left,
            TextAlignment = right ? TextAlignment.Right : TextAlignment.Left,
        };
        Grid.SetColumn(block, column);
        grid.Children.Add(block);
    }

    // A two-line cell: a primary value over a muted caption (web flex-col cells).
    private static StackPanel BuildStackedCell(string value, string caption, bool right, bool boldValue)
    {
        var stack = new StackPanel
        {
            Spacing = 2,
            Padding = new Thickness(4, 2, 4, 2),
            HorizontalAlignment = right ? HorizontalAlignment.Right : HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Center,
        };

        stack.Children.Add(new TextBlock
        {
            Text = value,
            FontFamily = TypographyTokens.Sans,
            FontSize = 13,
            FontWeight = boldValue ? FontWeights.Medium : FontWeights.Normal,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextAlignment = right ? TextAlignment.Right : TextAlignment.Left,
        });

        stack.Children.Add(new TextBlock
        {
            Text = caption,
            FontFamily = TypographyTokens.Sans,
            FontSize = 12,
            Foreground = DisplayTokens.TextMuted,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextAlignment = right ? TextAlignment.Right : TextAlignment.Left,
        });

        return stack;
    }

    private void OnRetryInvoked(object? sender, EventArgs e) => InvokeAsync(() => _viewModel.RefreshAsync());

    private static async void InvokeAsync(Func<Task> action)
    {
        await action().ConfigureAwait(true);
    }

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;

    protected override AutomationPeer OnCreateAutomationPeer() => new DiskForecastPageAutomationPeer(this);

    private sealed class DiskForecastPageAutomationPeer(DiskForecastPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
