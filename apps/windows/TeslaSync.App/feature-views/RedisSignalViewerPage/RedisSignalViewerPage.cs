using System.Linq;
using System.Runtime.InteropServices;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// The native WinUI 3 <c>RedisSignalViewerPage</c> — a parity port of the web page
/// <c>web/src/features/admin/pages/RedisSignalViewerPage.tsx</c> (route <c>/redis-signals</c>, nav name
/// <c>RedisSignalViewer</c>). It binds to a <see cref="RedisSignalViewerPageViewModel"/> and renders every web region
/// with Fluent components and design tokens: the page header, the controls panel (GlassPanel1 — the vehicle picker,
/// the signal search, the category filter, the auto-refresh switch, the refresh button and the two destructive purge
/// buttons), the persistent diagnostic chips, the four stat tiles (Total Signals / Numbers / Strings / Booleans), the
/// failure banner, the purge-result banner, and the table panel (GlassPanel6) whose body switches between the
/// select-a-vehicle prompt, the loading skeleton, the no-match / no-signals empty states and the signal table. The
/// destructive purge runs through a Fluent <see cref="TsConfirmDialog"/> (typed confirmation for the cluster-wide
/// path). The view is a thin renderer: all branch selection, formatting and i18n happen in the view-model's
/// <see cref="RedisSignalViewerDisplay"/> projection. State changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class RedisSignalViewerPage : UserControl, IDisposable
{
    private const string DatabaseGlyph = "\uEA86"; // Database / storage (web Database icon)
    private const string SearchGlyph = "\uE721";   // Search
    private const string RefreshGlyph = "\uE72C";  // Refresh
    private const string TrashGlyph = "\uE74D";    // Delete
    private const int AutoRefreshSeconds = 5;      // web INTERVALS.REALTIME

    private readonly RedisSignalViewerPageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private readonly DispatcherTimer _autoRefreshTimer = new() { Interval = TimeSpan.FromSeconds(AutoRefreshSeconds) };
    private bool _disposed;
    private bool _suppressEvents;
    private bool _dialogOpen;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();

    private readonly TsSelect _vehicleSelect = new() { MinWidth = 220 };
    private readonly TsInput _searchInput = new() { MinWidth = 220 };
    private readonly TsSelect _categorySelect = new() { MinWidth = 180 };
    private readonly TsToggle _autoRefreshToggle = new();
    private readonly TsButton _refreshButton = new() { Variant = ButtonVariant.Secondary, IconGlyph = RefreshGlyph };
    private readonly TsButton _purgeButton = new() { Variant = ButtonVariant.Destructive, IconGlyph = TrashGlyph };
    private readonly TsButton _purgeAllButton = new() { Variant = ButtonVariant.Destructive, IconGlyph = TrashGlyph };
    private readonly TsGlassPanel _controlsPanel = new();

    private readonly StackPanel _chipsRow = new() { Orientation = Orientation.Horizontal, Spacing = 8 };
    private readonly TsBadge _modeChip = new();
    private readonly TsBadge _vinChip = new() { Status = StatusKind.Neutral };
    private readonly TsBadge _l1Chip = new() { Status = StatusKind.Info };

    private readonly TsStatCard _totalCard = new() { Glyph = DatabaseGlyph };
    private readonly TsStatCard _numbersCard = new();
    private readonly TsStatCard _stringsCard = new();
    private readonly TsStatCard _booleansCard = new();
    private readonly Grid _statsGrid = new() { ColumnSpacing = 16 };

    private readonly TsAlertBanner _errorBanner = new() { Variant = CalloutVariant.Danger, IsOpen = false, Dismissible = false };
    private readonly TsAlertBanner _purgeBanner = new() { IsOpen = false, Dismissible = true };

    private readonly TsGlassPanel _tablePanel = new();
    private readonly TsEmptyState _selectPromptEmpty = new() { IconGlyph = DatabaseGlyph };
    private readonly TsTableSkeleton _tableLoading = new();
    private readonly TsEmptyState _noMatchEmpty = new() { IconGlyph = SearchGlyph };
    private readonly TsEmptyState _noSignalsEmpty = new() { IconGlyph = DatabaseGlyph };
    private readonly TsDataTable _table = new();

    /// <summary>Creates the page over the default empty feed and the shell resource localizer.</summary>
    public RedisSignalViewerPage()
        : this(EmptyRedisSignalViewerFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The vehicles / signals / purge data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public RedisSignalViewerPage(IRedisSignalViewerFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new RedisSignalViewerPageViewModel(feed, localizer);

        _vehicleSelect.DisplayMemberPath = nameof(RedisVehicleOptionDisplay.Label);
        _categorySelect.DisplayMemberPath = nameof(RedisCategoryOptionDisplay.Label);
        _table.Selectable = false;

        Content = BuildLayout();

        _vehicleSelect.SelectionChanged += OnVehicleChanged;
        _searchInput.TextChanged += OnSearchChanged;
        _categorySelect.SelectionChanged += OnCategoryChanged;
        _autoRefreshToggle.Toggled += OnAutoRefreshToggled;
        _refreshButton.Click += OnRefreshClick;
        _purgeButton.Click += OnPurgeOneClick;
        _purgeAllButton.Click += OnPurgeAllClick;
        _purgeBanner.Dismissed += OnPurgeBannerDismissed;
        _autoRefreshTimer.Tick += OnAutoRefreshTick;

        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The diagnostics surface slug (<c>RedisSignalViewerPage</c>).</summary>
    public static string Slug => RedisSignalViewerRegistration.Slug;

    private ScrollViewer BuildLayout()
    {
        var stack = new StackPanel { Spacing = 16, Padding = new Thickness(24) };

        var header = new StackPanel { Spacing = 4 };
        header.Children.Add(_title);
        header.Children.Add(_subtitle);
        stack.Children.Add(header);

        stack.Children.Add(BuildControlsPanel());
        stack.Children.Add(_chipsRow);
        stack.Children.Add(BuildStatsGrid());
        stack.Children.Add(_errorBanner);
        stack.Children.Add(_purgeBanner);
        stack.Children.Add(BuildTablePanel());

        return new ScrollViewer
        {
            Content = stack,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
    }

    private TsGlassPanel BuildControlsPanel()
    {
        var body = new StackPanel { Spacing = 12, Padding = new Thickness(20) };

        var topRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
        topRow.Children.Add(_vehicleSelect);
        topRow.Children.Add(_searchInput);
        topRow.Children.Add(_categorySelect);

        var actionRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12, VerticalAlignment = VerticalAlignment.Center };
        actionRow.Children.Add(_autoRefreshToggle);
        actionRow.Children.Add(_refreshButton);
        actionRow.Children.Add(_purgeButton);
        actionRow.Children.Add(_purgeAllButton);

        body.Children.Add(topRow);
        body.Children.Add(actionRow);

        _controlsPanel.Content = body;
        return _controlsPanel;
    }

    private Grid BuildStatsGrid()
    {
        for (int i = 0; i < 4; i++)
        {
            _statsGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        Grid.SetColumn(_totalCard, 0);
        Grid.SetColumn(_numbersCard, 1);
        Grid.SetColumn(_stringsCard, 2);
        Grid.SetColumn(_booleansCard, 3);
        _statsGrid.Children.Add(_totalCard);
        _statsGrid.Children.Add(_numbersCard);
        _statsGrid.Children.Add(_stringsCard);
        _statsGrid.Children.Add(_booleansCard);

        _chipsRow.Children.Add(_modeChip);
        _chipsRow.Children.Add(_vinChip);
        _chipsRow.Children.Add(_l1Chip);
        return _statsGrid;
    }

    private TsGlassPanel BuildTablePanel()
    {
        var body = new StackPanel { Spacing = 8, Padding = new Thickness(20) };
        body.Children.Add(_selectPromptEmpty);
        body.Children.Add(_tableLoading);
        body.Children.Add(_noMatchEmpty);
        body.Children.Add(_noSignalsEmpty);
        body.Children.Add(_table);

        _tablePanel.Content = body;
        return _tablePanel;
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
        _autoRefreshTimer.Stop();
        _autoRefreshTimer.Tick -= OnAutoRefreshTick;
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

    private void Render(RedisSignalViewerDisplay display)
    {
        _suppressEvents = true;

        _title.Value = display.Title;
        _subtitle.Value = display.Subtitle;
        AutomationProperties.SetName(this, display.AutomationName);

        // Controls (GlassPanel1).
        _vehicleSelect.Hint = display.SelectVehiclePrompt;
        _vehicleSelect.ItemsSource = display.VehicleOptions;
        _vehicleSelect.SelectedItem = display.VehicleOptions.FirstOrDefault(o => o.Id == display.SelectedVehicleId);
        AutomationProperties.SetName(_vehicleSelect, display.SelectVehiclePrompt);

        _searchInput.Hint = display.SearchHint;
        if (_searchInput.Text != display.SearchValue)
        {
            _searchInput.Text = display.SearchValue;
        }

        AutomationProperties.SetName(_searchInput, display.SearchHint);

        _categorySelect.ItemsSource = display.CategoryOptions;
        _categorySelect.SelectedItem = display.CategoryOptions.FirstOrDefault(o => o.Value == display.CategoryFilter);

        _autoRefreshToggle.Header = display.AutoRefreshLabel;
        _autoRefreshToggle.IsOn = display.AutoRefresh;
        AutomationProperties.SetName(_autoRefreshToggle, display.AutoRefreshLabel);

        _refreshButton.Text = display.RefreshLabel;
        _refreshButton.IsEnabled = display.CanRefresh;
        AutomationProperties.SetName(_refreshButton, display.RefreshLabel);

        _purgeButton.Text = display.PurgeButtonText;
        _purgeButton.IsEnabled = display.CanPurgeOne;
        ToolTipService.SetToolTip(_purgeButton, display.PurgeButtonTitle);
        AutomationProperties.SetName(_purgeButton, display.PurgeButtonText);
        AutomationProperties.SetHelpText(_purgeButton, display.PurgeButtonTitle);

        _purgeAllButton.Text = display.PurgeAllButtonText;
        _purgeAllButton.IsEnabled = display.CanPurgeAll;
        ToolTipService.SetToolTip(_purgeAllButton, display.PurgeAllButtonTitle);
        AutomationProperties.SetName(_purgeAllButton, display.PurgeAllButtonText);
        AutomationProperties.SetHelpText(_purgeAllButton, display.PurgeAllButtonTitle);

        // Diagnostic chips (web meta chips).
        _chipsRow.Visibility = Show(display.ShowDiagnosticChips);
        _modeChip.Content = display.ModeChipText;
        _modeChip.Status = display.ModeChipVariant;
        _vinChip.Content = display.VinChipText;
        _vinChip.Visibility = Show(display.ShowVinChip);
        _l1Chip.Content = display.L1ChipText;
        _l1Chip.Visibility = Show(display.ShowL1Chip);

        // Stat tiles.
        _statsGrid.Visibility = Show(display.ShowStats);
        if (display.StatCards.Count == 4)
        {
            ApplyStat(_totalCard, display.StatCards[0]);
            ApplyStat(_numbersCard, display.StatCards[1]);
            ApplyStat(_stringsCard, display.StatCards[2]);
            ApplyStat(_booleansCard, display.StatCards[3]);
        }

        // Failure banner (web isError).
        _errorBanner.IsOpen = display.HasError;
        _errorBanner.Visibility = Show(display.HasError);
        _errorBanner.Message = display.ErrorBannerText;

        // Purge-result banner (web toast).
        var notice = _viewModel.PurgeNotice;
        _purgeBanner.Visibility = Show(notice.Show);
        _purgeBanner.IsOpen = notice.Show;
        _purgeBanner.Variant = notice.Variant;
        _purgeBanner.Title = notice.Title;
        _purgeBanner.Message = notice.Message;

        // Table panel (GlassPanel6).
        AutomationProperties.SetName(_tablePanel, display.Title);
        AutomationProperties.SetHelpText(_table, display.MaskedCoordLabel);

        _selectPromptEmpty.Visibility = Show(display.ShowSelectPrompt);
        _selectPromptEmpty.Message = display.SelectPromptMessage;

        _tableLoading.Visibility = Show(display.ShowTableLoading);

        _noMatchEmpty.Visibility = Show(display.ShowNoMatch);
        _noMatchEmpty.Message = display.NoMatchMessage;

        _noSignalsEmpty.Visibility = Show(display.ShowNoSignals);
        _noSignalsEmpty.Message = display.NoSignalsMessage;

        _table.Visibility = Show(display.ShowTable);
        if (display.ShowTable)
        {
            _table.Columns = BuildColumns(display.ColumnHeaders);
            _table.Rows = BuildRows(display.Rows);
        }

        UpdateAutoRefreshTimer(display);

        _suppressEvents = false;
    }

    private static void ApplyStat(TsStatCard card, RedisStatCardDisplay stat)
    {
        card.Label = stat.Label;
        card.Value = stat.Value;
        AutomationProperties.SetName(card, stat.AutomationName);
    }

    private static List<TsDataColumn> BuildColumns(IReadOnlyList<string> headers)
    {
        string[] keys = { "name", "value", "type", "category" };
        var columns = new List<TsDataColumn>(headers.Count);
        for (int i = 0; i < headers.Count && i < keys.Length; i++)
        {
            columns.Add(new TsDataColumn { Key = keys[i], Header = headers[i] });
        }

        return columns;
    }

    private static List<TsDataRow> BuildRows(IReadOnlyList<RedisSignalRowDisplay> rows)
    {
        var result = new List<TsDataRow>(rows.Count);
        foreach (var row in rows)
        {
            var values = new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["name"] = row.Name,
                ["value"] = row.Value,
                ["type"] = row.TypeLabel,
                ["category"] = row.CategoryLabel,
            };
            result.Add(new TsDataRow(row.Name, values));
        }

        return result;
    }

    private void UpdateAutoRefreshTimer(RedisSignalViewerDisplay display)
    {
        bool shouldRun = display.AutoRefresh && display.SelectedVehicleId is not null;
        if (shouldRun && !_autoRefreshTimer.IsEnabled)
        {
            _autoRefreshTimer.Start();
        }
        else if (!shouldRun && _autoRefreshTimer.IsEnabled)
        {
            _autoRefreshTimer.Stop();
        }
    }

    private void OnAutoRefreshTick(object? sender, object e) => InvokeAsync(() => _viewModel.RefreshAsync());

    private void OnVehicleChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppressEvents || _vehicleSelect.SelectedItem is not RedisVehicleOptionDisplay option)
        {
            return;
        }

        if (option.Id != _viewModel.SelectedVehicleId)
        {
            InvokeAsync(() => _viewModel.SelectVehicleAsync(option.Id));
        }
    }

    private void OnSearchChanged(object sender, TextChangedEventArgs e)
    {
        if (_suppressEvents)
        {
            return;
        }

        _viewModel.SetSearch(_searchInput.Text);
    }

    private void OnCategoryChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppressEvents || _categorySelect.SelectedItem is not RedisCategoryOptionDisplay option)
        {
            return;
        }

        _viewModel.SetCategoryFilter(option.Value);
    }

    private void OnAutoRefreshToggled(object? sender, EventArgs e)
    {
        if (_suppressEvents)
        {
            return;
        }

        _viewModel.SetAutoRefresh(_autoRefreshToggle.IsOn);
    }

    private void OnRefreshClick(object sender, RoutedEventArgs e)
    {
        if (_suppressEvents)
        {
            return;
        }

        InvokeAsync(() => _viewModel.RefreshAsync());
    }

    private void OnPurgeOneClick(object sender, RoutedEventArgs e)
    {
        if (_suppressEvents)
        {
            return;
        }

        _viewModel.OpenPurgeOne();
        InvokeAsync(ShowPurgeDialogAsync);
    }

    private void OnPurgeAllClick(object sender, RoutedEventArgs e)
    {
        if (_suppressEvents)
        {
            return;
        }

        _viewModel.OpenPurgeAll();
        InvokeAsync(ShowPurgeDialogAsync);
    }

    private void OnPurgeBannerDismissed(object? sender, EventArgs e) => _purgeBanner.Visibility = Visibility.Collapsed;

    private async Task ShowPurgeDialogAsync()
    {
        if (_dialogOpen || XamlRoot is null)
        {
            return;
        }

        var display = _viewModel.Display;
        var dialog = new TsConfirmDialog
        {
            Title = display.PurgeDialogTitle,
            PrimaryButtonText = display.PurgeConfirmLabel,
            CloseButtonText = display.PurgeCancelLabel,
            IsDestructive = true,
            XamlRoot = XamlRoot,
        };

        var body = new StackPanel { Spacing = 12, MaxWidth = 460 };
        body.Children.Add(new TextBlock { Text = display.PurgeDialogMessage, TextWrapping = TextWrapping.WrapWholeWords });

        if (display.PurgeRequiresTypedConfirmation)
        {
            var typedInput = new TsInput { Hint = display.PurgeTypedConfirmationLabel };
            AutomationProperties.SetName(typedInput, display.PurgeTypedConfirmationLabel);
            dialog.IsPrimaryButtonEnabled = false;
            typedInput.TextChanged += (_, _) =>
                dialog.IsPrimaryButtonEnabled = string.Equals((typedInput.Text ?? string.Empty).Trim(), "PURGE ALL", StringComparison.Ordinal);
            body.Children.Add(typedInput);
        }

        dialog.Content = body;
        dialog.PrimaryButtonClick += OnDialogConfirm;
        dialog.CloseButtonClick += OnDialogCancel;

        _dialogOpen = true;
        try
        {
            await dialog.ShowAsync();
        }
        catch (COMException)
        {
            // Another ContentDialog is already open on this XamlRoot — surface nothing.
        }
        finally
        {
            dialog.PrimaryButtonClick -= OnDialogConfirm;
            dialog.CloseButtonClick -= OnDialogCancel;
            _dialogOpen = false;
        }
    }

    private async void OnDialogConfirm(ContentDialog sender, ContentDialogButtonClickEventArgs args)
    {
        var deferral = args.GetDeferral();
        try
        {
            await _viewModel.ConfirmPurgeAsync().ConfigureAwait(true);
        }
        finally
        {
            deferral.Complete();
        }
    }

    private void OnDialogCancel(ContentDialog sender, ContentDialogButtonClickEventArgs args) => _viewModel.CancelPurge();

    private static async void InvokeAsync(Func<Task> action)
    {
        await action().ConfigureAwait(true);
    }

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;
}
