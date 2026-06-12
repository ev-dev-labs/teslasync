using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
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
/// The native WinUI 3 <c>SchemaDriftPage</c> — a parity port of the web page
/// <c>web/src/features/admin/pages/SchemaDriftPage.tsx</c> (route <c>/admin/schema-drift</c>, nav name
/// <c>SchemaDrift</c>). It binds to a <see cref="SchemaDriftPageViewModel"/> and renders every web region with Fluent
/// components and design tokens: the page header (title + subtitle), the HTTP-503 subsystem-unavailable banner (web
/// <c>subsystemMissing</c>), the loading shimmer, the generic failure surface (InfoBar-equivalent + Retry), the
/// "no fingerprint" empty state, the drift-summary glass panel (status badge + the Tables/Columns/Indexes delta stat
/// cards) and the fingerprints glass panel (the current + expected seed fingerprint cards, each carrying the
/// Tables/Columns/Indexes counts and the seed's capture timestamp). The view is a thin renderer: all branch
/// selection, formatting and i18n happen in the view-model's <see cref="SchemaDriftDisplay"/> projection. State
/// changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class SchemaDriftPage : UserControl, IDisposable
{
    private readonly SchemaDriftPageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();

    private readonly TsAlertBanner _subsystemBanner = new() { Variant = CalloutVariant.Warning, IsOpen = false, Dismissible = false };
    private readonly TsStatGridSkeleton _loadingSkeleton = new(3);
    private readonly TsQueryError _errorState = new();

    private readonly TsGlassPanel _emptyPanel = new();
    private readonly TsEmptyState _emptyState = new() { IconGlyph = "\uE8D7" }; // Fingerprint

    private readonly TsGlassPanel _summaryPanel = new();
    private readonly PanelTitle _statusTitle = new();
    private readonly TsBadge _statusBadge = new() { HorizontalAlignment = HorizontalAlignment.Right };
    private readonly TsStatCard _tableDeltaCard = new();
    private readonly TsStatCard _columnDeltaCard = new();
    private readonly TsStatCard _indexDeltaCard = new();

    private readonly TsGlassPanel _detailsPanel = new();
    private readonly PanelTitle _fingerprintTitle = new();
    private readonly ContentControl _currentCardHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };
    private readonly ContentControl _expectedCardHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };

    /// <summary>Creates the page over the default local-state feed and the shell resource localizer.</summary>
    public SchemaDriftPage()
        : this(EmptySchemaDriftFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The schema-drift data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public SchemaDriftPage(ISchemaDriftFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new SchemaDriftPageViewModel(feed, localizer);

        BuildSummaryPanel();
        BuildDetailsPanel();
        BuildEmptyPanel();

        Content = BuildLayout();

        _errorState.ActionInvoked += OnRetryInvoked;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The diagnostics surface slug (<c>SchemaDriftPage</c>).</summary>
    public static string Slug => SchemaDriftRegistration.Slug;

    private ScrollViewer BuildLayout()
    {
        var stack = new StackPanel { Spacing = 24, Padding = new Thickness(24) };
        stack.Children.Add(BuildHeader());
        stack.Children.Add(_subsystemBanner);
        stack.Children.Add(_loadingSkeleton);
        stack.Children.Add(_errorState);
        stack.Children.Add(_emptyPanel);
        stack.Children.Add(_summaryPanel);
        stack.Children.Add(_detailsPanel);

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

    private void BuildSummaryPanel()
    {
        var body = new StackPanel { Spacing = 24, Padding = new Thickness(24) };

        var headerRow = new Grid();
        headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        _statusTitle.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(_statusTitle, 0);
        Grid.SetColumn(_statusBadge, 1);
        headerRow.Children.Add(_statusTitle);
        headerRow.Children.Add(_statusBadge);
        body.Children.Add(headerRow);

        body.Children.Add(BuildEqualColumns(16, _tableDeltaCard, _columnDeltaCard, _indexDeltaCard));

        _summaryPanel.Content = body;
    }

    private void BuildDetailsPanel()
    {
        var body = new StackPanel { Spacing = 16, Padding = new Thickness(24) };
        body.Children.Add(_fingerprintTitle);
        body.Children.Add(BuildEqualColumns(24, _currentCardHost, _expectedCardHost));
        _detailsPanel.Content = body;
    }

    private void BuildEmptyPanel()
    {
        _emptyPanel.Padding = new Thickness(24);
        _emptyPanel.Content = _emptyState;
    }

    // A grid of equal-width star columns hosting each child, matching the web responsive card grids.
    private static Grid BuildEqualColumns(double spacing, params FrameworkElement[] children)
    {
        var grid = new Grid { ColumnSpacing = spacing };
        for (var i = 0; i < children.Length; i++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            Grid.SetColumn(children[i], i);
            grid.Children.Add(children[i]);
        }

        return grid;
    }

    // The web FingerprintCard: a tokenized surface with a title, the SHA-256, the Tables/Columns/Indexes
    // mini-stats, and the optional "Captured …" line for the seed fingerprint.
    private static Border BuildFingerprintCard(FingerprintCardDisplay card)
    {
        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(new Text { Value = card.Title });
        column.Children.Add(new Code { Value = card.Sha256 });

        var stats = new Grid { ColumnSpacing = 8 };
        for (var i = 0; i < 3; i++)
        {
            stats.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        AddFingerprintStat(stats, 0, card.TablesLabel, card.TablesValue);
        AddFingerprintStat(stats, 1, card.ColumnsLabel, card.ColumnsValue);
        AddFingerprintStat(stats, 2, card.IndexesLabel, card.IndexesValue);
        column.Children.Add(stats);

        if (card.ShowGeneratedAt)
        {
            column.Children.Add(new Caption { Value = card.GeneratedAtText });
        }

        return new Border
        {
            Child = column,
            CornerRadius = new CornerRadius(8),
            BorderBrush = Brush("TsColorBorderBrush"),
            BorderThickness = new Thickness(1),
            Background = Brush("TsColorSurfaceBrush"),
            Padding = new Thickness(16),
        };
    }

    private static void AddFingerprintStat(Grid grid, int column, string label, string value)
    {
        var cell = new StackPanel { Spacing = 2, HorizontalAlignment = HorizontalAlignment.Center };
        cell.Children.Add(new MetricValue { Value = value, HorizontalAlignment = HorizontalAlignment.Center });
        cell.Children.Add(new Caption { Value = label, HorizontalAlignment = HorizontalAlignment.Center });
        Grid.SetColumn(cell, column);
        grid.Children.Add(cell);
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

    private void Render(SchemaDriftDisplay display)
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

        // Empty state.
        _emptyPanel.Visibility = Show(display.ShowEmpty);
        _emptyState.Title = display.EmptyTitle;
        _emptyState.Message = display.EmptyMessage;

        // Drift summary (status badge + the three delta stat cards).
        _summaryPanel.Visibility = Show(display.ShowSummary);
        _statusTitle.Value = display.StatusTitle;
        _statusBadge.Status = display.StatusBadgeVariant;
        _statusBadge.Content = BuildBadgeContent(display.StatusBadgeLabel, display.IsDrifted);
        AutomationProperties.SetName(_statusBadge, display.StatusBadgeLabel);

        _tableDeltaCard.Label = display.TableDeltaLabel;
        _tableDeltaCard.Value = display.TableDeltaValue;
        _tableDeltaCard.Sublabel = display.TableDeltaSub;

        _columnDeltaCard.Label = display.ColumnDeltaLabel;
        _columnDeltaCard.Value = display.ColumnDeltaValue;
        _columnDeltaCard.Sublabel = display.ColumnDeltaSub;

        _indexDeltaCard.Label = display.IndexDeltaLabel;
        _indexDeltaCard.Value = display.IndexDeltaValue;
        _indexDeltaCard.Sublabel = display.IndexDeltaSub;

        // Fingerprint details (current + expected seed cards).
        _detailsPanel.Visibility = Show(display.ShowDetails);
        _fingerprintTitle.Value = display.FingerprintTitle;
        _currentCardHost.Content = BuildFingerprintCard(display.CurrentCard);
        _expectedCardHost.Content = BuildFingerprintCard(display.ExpectedCard);
    }

    private static StackPanel BuildBadgeContent(string label, bool isDrifted)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
        row.Children.Add(new FontIcon { Glyph = isDrifted ? "\uE7BA" : "\uE73E", FontSize = 14 });
        row.Children.Add(new TextBlock { Text = label, VerticalAlignment = VerticalAlignment.Center });
        return row;
    }

    private void OnRetryInvoked(object? sender, EventArgs e) => InvokeAsync(() => _viewModel.RefreshAsync());

    private static async void InvokeAsync(Func<Task> action)
    {
        await action().ConfigureAwait(true);
    }

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;

    private static Brush? Brush(string key) =>
        Application.Current.Resources.TryGetValue(key, out var value) && value is Brush brush ? brush : null;
}
