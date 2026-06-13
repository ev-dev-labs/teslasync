using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.SystemOps;

/// <summary>
/// The native WinUI 3 <c>DataExportPage</c> — a parity port of the web page
/// <c>web/src/features/system/pages/DataExportPage.tsx</c> (route <c>/data-export</c>, nav name <c>DataExport</c>). It
/// binds to a <see cref="DataExportPageViewModel"/> and renders every web region with Fluent components and design
/// tokens: the page header (title + subtitle + Refresh), the four stat tiles (Total Exports / Total Size / Most
/// Exported / Last Export), the GDPR "Download my data" panel, the export wizard (type tiles, format choice, column
/// picker, vehicle scope, date presets + custom range, submit), the CSV / JSON format-preview cards, the data-overview
/// card, the export-history surface (whose body switches between the loading shimmer, the failure surface, the empty
/// state and the populated table) and the scheduled-exports note. The view is a thin renderer: all branch selection,
/// formatting and i18n happen in the view-model's <see cref="DataExportDisplay"/> projection. State changes are
/// marshalled onto the UI thread.
/// </summary>
public sealed partial class DataExportPage : UserControl, IDisposable
{
    private readonly DataExportPageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;
    private bool _suppressSelection;

    // Header.
    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();
    private readonly TsButton _refreshButton = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small };

    // Transient submit toast (web toast.success / toast.error).
    private readonly InfoBar _toast = new() { IsOpen = false, IsClosable = true };

    // Stat tiles (panels Total-Exports / Total-Size / Most-Exported / Last-Export).
    private readonly Grid _statsGrid = new() { ColumnSpacing = 12 };
    private readonly TsStatCard _totalExports = new();
    private readonly TsStatCard _totalSize = new();
    private readonly TsStatCard _mostExported = new();
    private readonly TsStatCard _lastExport = new();
    private readonly Grid _statsSkeleton = new() { ColumnSpacing = 12, Visibility = Visibility.Collapsed };

    // Account export panel (GlassPanel12).
    private readonly TsGlassPanel _accountPanel = new() { Glow = GlassGlow.Cyan };
    private readonly PanelTitle _accountTitle = new();
    private readonly Text _accountSubtitle = new();
    private readonly Label _accountVehicleLabel = new();
    private readonly TsSelect _accountVehicle = new() { HorizontalAlignment = HorizontalAlignment.Stretch };
    private readonly Label _accountStartLabel = new();
    private readonly CalendarDatePicker _accountStart = new() { HorizontalAlignment = HorizontalAlignment.Stretch };
    private readonly Label _accountEndLabel = new();
    private readonly CalendarDatePicker _accountEnd = new() { HorizontalAlignment = HorizontalAlignment.Stretch };
    private readonly Text _accountWarning = new();
    private readonly TsButton _accountStartButton = new() { Variant = ButtonVariant.Primary, Size = ControlSize.Medium };

    // Export wizard (GlassPanel9 + GlassPanel1).
    private readonly TsGlassPanel _wizardPanel = new() { Glow = GlassGlow.Cyan };
    private readonly PanelTitle _wizardTitle = new();
    private readonly Caption _step1 = new();
    private readonly Caption _step2 = new();
    private readonly Caption _step3 = new();
    private readonly Caption _step4 = new();
    private readonly Border _typeSelector = new();
    private readonly Grid _typeGrid = new() { RowSpacing = 12, ColumnSpacing = 12 };
    private readonly StackPanel _formatRow = new() { Orientation = Orientation.Horizontal, Spacing = 12 };
    private readonly StackPanel _columnPicker = new() { Spacing = 8, Visibility = Visibility.Collapsed };
    private readonly Caption _columnsTitle = new();
    private readonly TsSkeleton _columnsSkeleton = new() { BlockHeight = 96, Radius = 8, Visibility = Visibility.Collapsed };
    private readonly Border _columnsBox = new();
    private readonly Text _columnsHelper = new();
    private readonly TsButton _columnsSelectAll = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small };
    private readonly TsButton _columnsClear = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small };
    private readonly Grid _columnRows = new() { RowSpacing = 8, ColumnSpacing = 8 };
    private readonly StackPanel _vehicleStep = new() { Spacing = 8, MaxWidth = 320, Visibility = Visibility.Collapsed };
    private readonly TsSelect _wizardVehicle = new() { HorizontalAlignment = HorizontalAlignment.Stretch };
    private readonly StackPanel _presetRow = new() { Orientation = Orientation.Horizontal, Spacing = 8 };
    private readonly TsButton _customRangeButton = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small };
    private readonly StackPanel _customRange = new() { Orientation = Orientation.Horizontal, Spacing = 12, Visibility = Visibility.Collapsed };
    private readonly Label _customStartLabel = new();
    private readonly CalendarDatePicker _customStart = new();
    private readonly Label _customEndLabel = new();
    private readonly CalendarDatePicker _customEnd = new();
    private readonly TsButton _submitButton = new() { Variant = ButtonVariant.Primary, Size = ControlSize.Large };

    // Format info cards (GlassPanel2 / GlassPanel3).
    private readonly TsGlassPanel _csvCard = new() { Glow = GlassGlow.Cyan };
    private readonly PanelTitle _csvTitle = new();
    private readonly Text _csvDesc = new();
    private readonly StackPanel _csvSample = new() { Spacing = 2 };
    private readonly TsGlassPanel _jsonCard = new() { Glow = GlassGlow.Purple };
    private readonly PanelTitle _jsonTitle = new();
    private readonly Text _jsonDesc = new();
    private readonly StackPanel _jsonSample = new() { Spacing = 2 };

    // Data overview (GlassPanel4).
    private readonly TsGlassPanel _overviewPanel = new() { Glow = GlassGlow.None };
    private readonly PanelTitle _overviewTitle = new();
    private readonly TsSkeleton _overviewSkeleton = new() { BlockHeight = 32, Radius = 8, Visibility = Visibility.Collapsed };
    private readonly StackPanel _overviewBody = new() { Orientation = Orientation.Horizontal, Spacing = 24 };
    private readonly Text _overviewDrives = new();
    private readonly Text _overviewCharging = new();
    private readonly Text _overviewUnavailable = new() { Visibility = Visibility.Collapsed };

    // Export history (GlassPanel10 loading / GlassPanel11 table).
    private readonly TsGlassPanel _historyPanel = new() { Glow = GlassGlow.None };
    private readonly PanelTitle _historyTitle = new();
    private readonly TsBadge _activeBadge = new() { Status = StatusKind.Info, Dot = true, Visibility = Visibility.Collapsed };
    private readonly TsButton _historyRefresh = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small };
    private readonly StackPanel _historyLoading = new() { Spacing = 8, Visibility = Visibility.Collapsed };
    private readonly TsErrorDisplay _historyError = new() { Visibility = Visibility.Collapsed };
    private readonly TsEmptyState _historyEmpty = new() { IconGlyph = DataExportRegistration.FileDownGlyph, Visibility = Visibility.Collapsed };
    private readonly StackPanel _historyTable = new() { Visibility = Visibility.Collapsed };
    private readonly Grid _historyHeader = new() { Padding = new Thickness(12, 10, 12, 10) };
    private readonly StackPanel _historyRows = new();

    // Scheduled exports note (web RequiresAuth(dataExport.scheduled.feature)).
    private readonly TsGlassPanel _scheduledPanel = new() { Glow = GlassGlow.None };
    private readonly Text _scheduledNote = new();

    /// <summary>Creates the page over the default local-state feed and the shell resource localizer.</summary>
    public DataExportPage()
        : this(EmptyDataExportFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The data-export data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public DataExportPage(IDataExportFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new DataExportPageViewModel(feed, localizer);

        Content = BuildLayout();

        _refreshButton.Click += OnRefreshClick;
        _historyRefresh.Click += OnRefreshClick;
        _historyError.ActionInvoked += OnRetryInvoked;
        _accountStartButton.Click += OnAccountStartClick;
        _submitButton.Click += OnSubmitClick;
        _customRangeButton.Click += (_, _) => _viewModel.ToggleCustomRange();
        _columnsSelectAll.Click += (_, _) => _viewModel.SelectAllColumns();
        _columnsClear.Click += (_, _) => _viewModel.ClearColumns();
        _accountVehicle.SelectionChanged += OnAccountVehicleChanged;
        _wizardVehicle.SelectionChanged += OnWizardVehicleChanged;
        _accountStart.DateChanged += OnAccountStartDateChanged;
        _accountEnd.DateChanged += OnAccountEndDateChanged;
        _customStart.DateChanged += OnCustomStartDateChanged;
        _customEnd.DateChanged += OnCustomEndDateChanged;
        _viewModel.PropertyChanged += OnViewModelChanged;
        _viewModel.ToastRequested += OnToastRequested;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The diagnostics surface slug (<c>DataExportPage</c>).</summary>
    public static string Slug => DataExportRegistration.Slug;

    private ScrollViewer BuildLayout()
    {
        var stack = new StackPanel { Spacing = 16, Padding = new Thickness(24) };
        stack.Children.Add(BuildHeader());
        stack.Children.Add(_toast);
        stack.Children.Add(BuildStats());
        stack.Children.Add(BuildAccountPanel());
        stack.Children.Add(BuildWizardPanel());
        stack.Children.Add(BuildFormatInfoRow());
        stack.Children.Add(BuildOverviewPanel());
        stack.Children.Add(BuildHistoryPanel());
        stack.Children.Add(BuildScheduledPanel());

        return new ScrollViewer
        {
            Content = stack,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
    }

    private Grid BuildHeader()
    {
        var titles = new StackPanel { Spacing = 4 };
        titles.Children.Add(_title);
        titles.Children.Add(_subtitle);

        var grid = new Grid { ColumnSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(titles, 0);
        _refreshButton.VerticalAlignment = VerticalAlignment.Bottom;
        Grid.SetColumn(_refreshButton, 1);
        grid.Children.Add(titles);
        grid.Children.Add(_refreshButton);
        return grid;
    }

    private Grid BuildStats()
    {
        for (int i = 0; i < 4; i++)
        {
            _statsGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            _statsSkeleton.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            var sk = new TsSkeleton { BlockHeight = 80, Radius = 12 };
            Grid.SetColumn(sk, i);
            _statsSkeleton.Children.Add(sk);
        }

        Grid.SetColumn(_totalExports, 0);
        Grid.SetColumn(_totalSize, 1);
        Grid.SetColumn(_mostExported, 2);
        Grid.SetColumn(_lastExport, 3);
        _statsGrid.Children.Add(_totalExports);
        _statsGrid.Children.Add(_totalSize);
        _statsGrid.Children.Add(_mostExported);
        _statsGrid.Children.Add(_lastExport);

        var host = new Grid();
        host.Children.Add(_statsGrid);
        host.Children.Add(_statsSkeleton);
        return host;
    }

    private TsGlassPanel BuildAccountPanel()
    {
        var headerRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
        headerRow.Children.Add(new FontIcon { Glyph = "\uE7B8", FontSize = 18, VerticalAlignment = VerticalAlignment.Top });
        var headerText = new StackPanel { Spacing = 4 };
        headerText.Children.Add(_accountTitle);
        headerText.Children.Add(_accountSubtitle);
        headerRow.Children.Add(headerText);

        var fields = new Grid { ColumnSpacing = 12 };
        for (int i = 0; i < 3; i++)
        {
            fields.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        var vehicleCol = new StackPanel { Spacing = 4 };
        vehicleCol.Children.Add(_accountVehicleLabel);
        vehicleCol.Children.Add(_accountVehicle);
        Grid.SetColumn(vehicleCol, 0);

        var startCol = new StackPanel { Spacing = 4 };
        startCol.Children.Add(_accountStartLabel);
        startCol.Children.Add(_accountStart);
        Grid.SetColumn(startCol, 1);

        var endCol = new StackPanel { Spacing = 4 };
        endCol.Children.Add(_accountEndLabel);
        endCol.Children.Add(_accountEnd);
        Grid.SetColumn(endCol, 2);

        fields.Children.Add(vehicleCol);
        fields.Children.Add(startCol);
        fields.Children.Add(endCol);

        var footer = new Grid { ColumnSpacing = 12 };
        footer.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        footer.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var warnRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        warnRow.Children.Add(new FontIcon { Glyph = "\uE7BA", FontSize = 14, VerticalAlignment = VerticalAlignment.Top });
        warnRow.Children.Add(_accountWarning);
        Grid.SetColumn(warnRow, 0);
        _accountStartButton.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(_accountStartButton, 1);
        footer.Children.Add(warnRow);
        footer.Children.Add(_accountStartButton);

        var body = new StackPanel { Spacing = 16, Padding = new Thickness(20) };
        body.Children.Add(headerRow);
        body.Children.Add(fields);
        body.Children.Add(footer);

        _accountPanel.Content = body;
        AutomationProperties.SetName(_accountPanel, "GlassPanel12");
        return _accountPanel;
    }

    private TsGlassPanel BuildWizardPanel()
    {
        var header = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        header.Children.Add(new FontIcon { Glyph = DataExportRegistration.FileDownGlyph, FontSize = 18 });
        header.Children.Add(_wizardTitle);

        AutomationProperties.SetName(_typeSelector, "GlassPanel1");
        _typeSelector.Child = _typeGrid;

        var columnsActions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, HorizontalAlignment = HorizontalAlignment.Right };
        columnsActions.Children.Add(_columnsSelectAll);
        columnsActions.Children.Add(_columnsClear);
        var columnsHeader = new Grid { ColumnSpacing = 12 };
        columnsHeader.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        columnsHeader.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_columnsHelper, 0);
        Grid.SetColumn(columnsActions, 1);
        columnsHeader.Children.Add(_columnsHelper);
        columnsHeader.Children.Add(columnsActions);
        var columnsInner = new StackPanel { Spacing = 12 };
        columnsInner.Children.Add(columnsHeader);
        columnsInner.Children.Add(_columnRows);
        _columnsBox.Child = columnsInner;
        _columnsBox.Padding = new Thickness(16);
        _columnsBox.CornerRadius = new CornerRadius(8);
        _columnsBox.BorderThickness = new Thickness(1);
        _columnsBox.BorderBrush = TokenBrush("TsColorBorderBrush");
        _columnPicker.Children.Add(_columnsTitle);
        _columnPicker.Children.Add(_columnsSkeleton);
        _columnPicker.Children.Add(_columnsBox);

        _vehicleStep.Children.Add(_step3);
        _vehicleStep.Children.Add(_wizardVehicle);

        var dateBlock = new StackPanel { Spacing = 12 };
        dateBlock.Children.Add(_step4);
        dateBlock.Children.Add(_presetRow);
        dateBlock.Children.Add(_customRangeButton);
        _customStart.Header = null;
        _customEnd.Header = null;
        var startCol = new StackPanel { Spacing = 4 };
        startCol.Children.Add(_customStartLabel);
        startCol.Children.Add(_customStart);
        var endCol = new StackPanel { Spacing = 4 };
        endCol.Children.Add(_customEndLabel);
        endCol.Children.Add(_customEnd);
        _customRange.Children.Add(startCol);
        _customRange.Children.Add(endCol);
        dateBlock.Children.Add(_customRange);

        var body = new StackPanel { Spacing = 16, Padding = new Thickness(20) };
        body.Children.Add(header);
        body.Children.Add(_step1);
        body.Children.Add(_typeSelector);
        body.Children.Add(_step2);
        body.Children.Add(_formatRow);
        body.Children.Add(_columnPicker);
        body.Children.Add(_vehicleStep);
        body.Children.Add(dateBlock);
        body.Children.Add(_submitButton);

        _wizardPanel.Content = body;
        AutomationProperties.SetName(_wizardPanel, "GlassPanel9");
        return _wizardPanel;
    }

    private Grid BuildFormatInfoRow()
    {
        BuildFormatCard(_csvCard, _csvTitle, _csvDesc, _csvSample, "GlassPanel2");
        BuildFormatCard(_jsonCard, _jsonTitle, _jsonDesc, _jsonSample, "GlassPanel3");

        var grid = new Grid { ColumnSpacing = 16 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetColumn(_csvCard, 0);
        Grid.SetColumn(_jsonCard, 1);
        grid.Children.Add(_csvCard);
        grid.Children.Add(_jsonCard);
        return grid;
    }

    private static void BuildFormatCard(TsGlassPanel panel, PanelTitle title, Text desc, StackPanel sample, string automationName)
    {
        var body = new StackPanel { Spacing = 12, Padding = new Thickness(16) };
        body.Children.Add(title);
        body.Children.Add(desc);
        var box = new Border
        {
            Child = sample,
            Padding = new Thickness(12),
            CornerRadius = new CornerRadius(8),
            Background = TokenBrush("TsColorSurfaceGlassBrush"),
        };
        body.Children.Add(box);
        panel.Content = body;
        AutomationProperties.SetName(panel, automationName);
    }

    private TsGlassPanel BuildOverviewPanel()
    {
        var header = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        header.Children.Add(new FontIcon { Glyph = "\uE8F1", FontSize = 14 });
        header.Children.Add(_overviewTitle);

        _overviewBody.Children.Add(_overviewDrives);
        _overviewBody.Children.Add(_overviewCharging);

        var body = new StackPanel { Spacing = 12, Padding = new Thickness(16) };
        body.Children.Add(header);
        body.Children.Add(_overviewSkeleton);
        body.Children.Add(_overviewBody);
        body.Children.Add(_overviewUnavailable);

        _overviewPanel.Content = body;
        AutomationProperties.SetName(_overviewPanel, "GlassPanel4");
        return _overviewPanel;
    }

    private TsGlassPanel BuildHistoryPanel()
    {
        var titleRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12, VerticalAlignment = VerticalAlignment.Center };
        titleRow.Children.Add(_historyTitle);
        titleRow.Children.Add(_activeBadge);

        var header = new Grid { Padding = new Thickness(20, 16, 20, 16), ColumnSpacing = 12 };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(titleRow, 0);
        Grid.SetColumn(_historyRefresh, 1);
        header.Children.Add(titleRow);
        header.Children.Add(_historyRefresh);
        header.BorderBrush = TokenBrush("TsColorBorderBrush");
        header.BorderThickness = new Thickness(0, 0, 0, 1);

        for (int i = 0; i < 5; i++)
        {
            _historyLoading.Children.Add(new TsSkeleton { BlockHeight = 40, Radius = 6 });
        }

        _historyLoading.Padding = new Thickness(20);

        BuildHistoryHeaderRow();
        _historyTable.Children.Add(_historyHeader);
        _historyTable.Children.Add(_historyRows);

        var bodyHost = new Grid();
        bodyHost.Children.Add(_historyLoading);
        bodyHost.Children.Add(_historyError);
        bodyHost.Children.Add(_historyEmpty);
        bodyHost.Children.Add(_historyTable);

        var body = new StackPanel();
        body.Children.Add(header);
        body.Children.Add(bodyHost);

        _historyPanel.Content = body;
        AutomationProperties.SetName(_historyPanel, "GlassPanel11");
        AutomationProperties.SetName(_historyLoading, "GlassPanel10");
        return _historyPanel;
    }

    private TsGlassPanel BuildScheduledPanel()
    {
        var body = new StackPanel { Spacing = 8, Padding = new Thickness(16) };
        var header = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        header.Children.Add(new FontIcon { Glyph = "\uE823", FontSize = 14 });
        header.Children.Add(_scheduledNote);
        body.Children.Add(header);
        _scheduledPanel.Content = body;
        AutomationProperties.SetName(_scheduledPanel, "ScheduledExports");
        return _scheduledPanel;
    }

    private void BuildHistoryHeaderRow()
    {
        AddHistoryColumns(_historyHeader);
        _historyHeader.BorderBrush = TokenBrush("TsColorBorderBrush");
        _historyHeader.BorderThickness = new Thickness(0, 0, 0, 1);
        for (int i = 0; i < 9; i++)
        {
            var label = new Label();
            PlaceHistoryCell(label, i);
            _historyHeader.Children.Add(label);
        }
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
        _refreshButton.Click -= OnRefreshClick;
        _historyRefresh.Click -= OnRefreshClick;
        _historyError.ActionInvoked -= OnRetryInvoked;
        _accountStartButton.Click -= OnAccountStartClick;
        _submitButton.Click -= OnSubmitClick;
        _accountVehicle.SelectionChanged -= OnAccountVehicleChanged;
        _wizardVehicle.SelectionChanged -= OnWizardVehicleChanged;
        _accountStart.DateChanged -= OnAccountStartDateChanged;
        _accountEnd.DateChanged -= OnAccountEndDateChanged;
        _customStart.DateChanged -= OnCustomStartDateChanged;
        _customEnd.DateChanged -= OnCustomEndDateChanged;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        _viewModel.ToastRequested -= OnToastRequested;
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

    private void OnToastRequested(object? sender, DataExportToast toast)
    {
        void Show()
        {
            _toast.Title = toast.Title;
            _toast.Message = toast.Message;
            _toast.Severity = toast.IsError ? InfoBarSeverity.Error : InfoBarSeverity.Success;
            _toast.IsOpen = true;
        }

        if (_dispatcher.HasThreadAccess)
        {
            Show();
        }
        else
        {
            _dispatcher.TryEnqueue(Show);
        }
    }

    private void Render(DataExportDisplay display)
    {
        _suppressSelection = true;
        try
        {
            var s = display.Strings;
            _title.Value = s.Title;
            _subtitle.Value = s.Subtitle;
            _refreshButton.Text = s.Refresh;
            _refreshButton.IconGlyph = "\uE72C";
            AutomationProperties.SetName(this, display.AutomationName);

            RenderStats(display);
            RenderAccount(display.Account);
            RenderWizard(display.Wizard);
            RenderFormatCard(_csvTitle, _csvDesc, _csvSample, display.CsvCard);
            RenderFormatCard(_jsonTitle, _jsonDesc, _jsonSample, display.JsonCard);
            RenderOverview(display.Overview);
            RenderHistory(display);

            _scheduledNote.Value = display.ScheduledFeatureLabel;
        }
        finally
        {
            _suppressSelection = false;
        }
    }

    private void RenderStats(DataExportDisplay display)
    {
        _statsSkeleton.Visibility = Show(display.StatsLoading);
        _statsGrid.Visibility = Show(!display.StatsLoading);

        ApplyStat(_totalExports, display.StatTiles[0]);
        ApplyStat(_totalSize, display.StatTiles[1]);
        ApplyStat(_mostExported, display.StatTiles[2]);
        ApplyStat(_lastExport, display.StatTiles[3]);
    }

    private static void ApplyStat(TsStatCard card, StatTileDisplay tile)
    {
        card.Label = tile.Label;
        card.Value = tile.Value;
        card.Sublabel = tile.Sublabel ?? string.Empty;
        card.Glyph = tile.Glyph;
        AutomationProperties.SetName(card, tile.Key);
    }

    private void RenderAccount(AccountPanelDisplay account)
    {
        _accountTitle.Value = account.Title;
        _accountSubtitle.Value = account.Subtitle;
        _accountVehicleLabel.Value = account.VehicleLabel;
        _accountStartLabel.Value = account.StartDateLabel;
        _accountEndLabel.Value = account.EndDateLabel;
        _accountWarning.Value = account.Warning;
        _accountStartButton.Text = account.StartLabel;
        _accountStartButton.IconGlyph = "\uE74B";
        _accountStartButton.IsLoading = account.Busy;
        ApplySelectOptions(_accountVehicle, account.VehicleOptions, account.SelectedVehicleId);
    }

    private void RenderWizard(WizardDisplay wizard)
    {
        _wizardTitle.Value = wizard.Title;
        _step1.Value = wizard.Step1Label;
        _step2.Value = wizard.Step2Label;
        _step3.Value = wizard.Step3Label;
        _step4.Value = wizard.Step4Label;
        _submitButton.Text = wizard.SubmitLabel;
        _submitButton.IconGlyph = "\uE74B";
        _submitButton.IsLoading = wizard.SubmitBusy;
        _customRangeButton.Text = wizard.CustomRangeLabel;
        _customRangeButton.IconGlyph = "\uE787";
        _customRangeButton.Variant = wizard.CustomRangeActive ? ButtonVariant.Primary : ButtonVariant.Subtle;

        RenderTypeTiles(wizard.Types);
        RenderFormatButtons(wizard.Formats);
        RenderColumnPicker(wizard);
        RenderPresets(wizard.Presets);

        _vehicleStep.Visibility = Show(wizard.ShowVehicleStep);
        _wizardVehicle.Hint = wizard.VehiclePrompt;
        ApplySelectOptions(_wizardVehicle, wizard.VehicleOptions, wizard.SelectedVehicleId);

        _customRange.Visibility = Show(wizard.CustomRangeActive);
        _customStartLabel.Value = wizard.StartLabel;
        _customEndLabel.Value = wizard.EndLabel;
    }

    private void RenderTypeTiles(IReadOnlyList<ExportTypeOptionDisplay> types)
    {
        _typeGrid.Children.Clear();
        _typeGrid.ColumnDefinitions.Clear();
        _typeGrid.RowDefinitions.Clear();
        const int columns = 3;
        for (int c = 0; c < columns; c++)
        {
            _typeGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        int rows = (types.Count + columns - 1) / columns;
        for (int r = 0; r < rows; r++)
        {
            _typeGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < types.Count; i++)
        {
            var tile = BuildTypeTile(types[i]);
            Grid.SetColumn(tile, i % columns);
            Grid.SetRow(tile, i / columns);
            _typeGrid.Children.Add(tile);
        }
    }

    private Button BuildTypeTile(ExportTypeOptionDisplay type)
    {
        var titleRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        titleRow.Children.Add(new FontIcon { Glyph = type.Glyph, FontSize = 16, Foreground = StatusBrush(type.Badge) });
        titleRow.Children.Add(new Text { Value = type.Label, VerticalAlignment = VerticalAlignment.Center });

        var content = new StackPanel { Spacing = 6 };
        content.Children.Add(titleRow);
        content.Children.Add(new Caption { Value = type.Description });

        var button = new Button
        {
            Content = content,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Left,
            Padding = new Thickness(16),
            CornerRadius = new CornerRadius(12),
            BorderThickness = new Thickness(type.Selected ? 2 : 1),
            BorderBrush = type.Selected ? StatusBrush(type.Badge) : TokenBrush("TsColorBorderBrush"),
        };
        AutomationProperties.SetName(button, type.Label);
        string value = type.Value;
        button.Click += async (_, _) => await _viewModel.SelectTypeAsync(value).ConfigureAwait(true);
        return button;
    }

    private void RenderFormatButtons(IReadOnlyList<FormatOptionDisplay> formats)
    {
        _formatRow.Children.Clear();
        foreach (var format in formats)
        {
            var button = new TsButton
            {
                Text = format.Label,
                IconGlyph = format.Glyph,
                Variant = format.Selected ? ButtonVariant.Primary : ButtonVariant.Outline,
                Size = ControlSize.Medium,
            };
            string value = format.Value;
            button.Click += (_, _) => _viewModel.SelectFormat(value);
            _formatRow.Children.Add(button);
        }
    }

    private void RenderColumnPicker(WizardDisplay wizard)
    {
        _columnPicker.Visibility = Show(wizard.ShowColumnPicker);
        _columnsTitle.Value = wizard.ColumnsTitle;
        _columnsHelper.Value = wizard.ColumnsHelper;
        _columnsSelectAll.Text = wizard.ColumnsSelectAllLabel;
        _columnsSelectAll.IsEnabled = !wizard.ColumnsAllSelected;
        _columnsClear.Text = wizard.ColumnsClearLabel;
        _columnsSkeleton.Visibility = Show(wizard.ColumnsLoading);
        _columnsBox.Visibility = Show(!wizard.ColumnsLoading);

        _columnRows.Children.Clear();
        _columnRows.ColumnDefinitions.Clear();
        _columnRows.RowDefinitions.Clear();
        const int columns = 3;
        for (int c = 0; c < columns; c++)
        {
            _columnRows.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        int rows = (wizard.ColumnRows.Count + columns - 1) / columns;
        for (int r = 0; r < rows; r++)
        {
            _columnRows.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < wizard.ColumnRows.Count; i++)
        {
            var row = BuildColumnRow(wizard.ColumnRows[i], wizard.ColumnsRequiredLabel);
            Grid.SetColumn(row, i % columns);
            Grid.SetRow(row, i / columns);
            _columnRows.Children.Add(row);
        }
    }

    private Border BuildColumnRow(ColumnRowDisplay column, string requiredLabel)
    {
        var check = new CheckBox
        {
            Content = column.Label,
            IsChecked = column.Checked,
            IsEnabled = !column.Required,
            MinWidth = 0,
        };
        AutomationProperties.SetName(check, column.Label);
        string name = column.Name;
        check.Click += (_, _) => _viewModel.ToggleColumn(name);

        var grid = new Grid { ColumnSpacing = 8 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(check, 0);
        grid.Children.Add(check);

        if (column.Required)
        {
            var badge = new TsBadge { Status = StatusKind.Warning, Content = requiredLabel, VerticalAlignment = VerticalAlignment.Center };
            Grid.SetColumn(badge, 1);
            grid.Children.Add(badge);
        }

        return new Border
        {
            Child = grid,
            Padding = new Thickness(12, 8, 12, 8),
            CornerRadius = new CornerRadius(6),
            BorderThickness = new Thickness(1),
            BorderBrush = TokenBrush("TsColorBorderBrush"),
        };
    }

    private void RenderPresets(IReadOnlyList<DatePresetOptionDisplay> presets)
    {
        _presetRow.Children.Clear();
        foreach (var preset in presets)
        {
            var button = new TsButton
            {
                Text = preset.Label,
                Variant = preset.Selected ? ButtonVariant.Primary : ButtonVariant.Subtle,
                Size = ControlSize.Small,
            };
            int days = preset.Days;
            button.Click += (_, _) => _viewModel.SelectPreset(days);
            _presetRow.Children.Add(button);
        }
    }

    private static void RenderFormatCard(PanelTitle title, Text desc, StackPanel sample, FormatInfoCardDisplay card)
    {
        title.Value = card.Title;
        desc.Value = card.Description;
        sample.Children.Clear();
        foreach (var line in card.SampleLines)
        {
            sample.Children.Add(new Code { Value = line });
        }
    }

    private void RenderOverview(OverviewDisplay overview)
    {
        _overviewTitle.Value = overview.Title;
        _overviewSkeleton.Visibility = Show(overview.Loading);
        _overviewBody.Visibility = Show(!overview.Loading && overview.HasData);
        _overviewUnavailable.Visibility = Show(!overview.Loading && !overview.HasData);
        _overviewDrives.Value = $"{overview.DrivesValue} {overview.DrivesLabel}";
        _overviewCharging.Value = $"{overview.ChargingValue} {overview.ChargingLabel}";
        _overviewUnavailable.Value = overview.UnavailableText;
    }

    private void RenderHistory(DataExportDisplay display)
    {
        var history = display.History;
        _historyTitle.Value = history.Title;
        _historyRefresh.Text = history.RefreshLabel;
        _historyRefresh.IconGlyph = "\uE72C";
        _activeBadge.Visibility = Show(history.ShowActiveBadge);
        _activeBadge.Content = $"{history.ActiveCount} {history.ActiveLabel}";

        for (int i = 0; i < history.ColumnHeaders.Count && i < _historyHeader.Children.Count; i++)
        {
            ((Label)_historyHeader.Children[i]).Value = history.ColumnHeaders[i];
        }

        _historyLoading.Visibility = Show(display.ShowLoading);
        _historyError.Visibility = Show(display.ShowError);
        _historyEmpty.Visibility = Show(display.ShowEmpty);
        _historyTable.Visibility = Show(display.ShowSuccess);

        _historyError.Title = display.ErrorText;
        _historyError.ActionText = display.RetryLabel;
        AutomationProperties.SetName(_historyError, display.ErrorText);

        _historyEmpty.Title = history.EmptyTitle;
        _historyEmpty.Message = history.EmptyMessage;
        AutomationProperties.SetName(_historyEmpty, history.EmptyTitle);

        RenderHistoryRows(history);
    }

    private void RenderHistoryRows(HistoryDisplay history)
    {
        _historyRows.Children.Clear();
        foreach (var row in history.Rows)
        {
            _historyRows.Children.Add(BuildHistoryRow(row));
        }
    }

    private static Border BuildHistoryRow(HistoryRowDisplay row)
    {
        var grid = new Grid { Padding = new Thickness(12, 8, 12, 8), ColumnSpacing = 12 };
        AddHistoryColumns(grid);

        var type = new TsBadge { Status = row.TypeBadge, Content = row.TypeLabel, HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Center };
        PlaceHistoryCell(type, 0);

        var format = new TsBadge { Status = row.FormatBadge, Content = row.FormatUpper, HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Center };
        PlaceHistoryCell(format, 1);

        var statusChip = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
        statusChip.Children.Add(new FontIcon { Glyph = row.StatusGlyph, FontSize = 12, Foreground = StatusBrush(row.StatusBadge) });
        statusChip.Children.Add(new TsBadge { Status = row.StatusBadge, Content = row.StatusLabel });
        PlaceHistoryCell(statusChip, 2);

        var vehicle = new Text { Value = row.Vehicle, VerticalAlignment = VerticalAlignment.Center };
        PlaceHistoryCell(vehicle, 3);

        var records = new Text { Value = row.Records, VerticalAlignment = VerticalAlignment.Center };
        PlaceHistoryCell(records, 4);

        var size = new Text { Value = row.Size, VerticalAlignment = VerticalAlignment.Center };
        PlaceHistoryCell(size, 5);

        var duration = new Text { Value = row.Duration, VerticalAlignment = VerticalAlignment.Center };
        PlaceHistoryCell(duration, 6);

        var time = new Text { Value = row.Time, VerticalAlignment = VerticalAlignment.Center };
        PlaceHistoryCell(time, 7);

        grid.Children.Add(type);
        grid.Children.Add(format);
        grid.Children.Add(statusChip);
        grid.Children.Add(vehicle);
        grid.Children.Add(records);
        grid.Children.Add(size);
        grid.Children.Add(duration);
        grid.Children.Add(time);

        var action = BuildHistoryAction(row);
        PlaceHistoryCell(action, 8);
        grid.Children.Add(action);

        return new Border
        {
            Child = grid,
            BorderThickness = new Thickness(0, 0, 0, 1),
            BorderBrush = TokenBrush("TsColorBorderBrush"),
        };
    }

    private static FrameworkElement BuildHistoryAction(HistoryRowDisplay row)
    {
        if (row.CanDownload && row.DownloadUri is not null)
        {
            var button = new HyperlinkButton
            {
                NavigateUri = row.DownloadUri,
                Content = row.DownloadLabel,
                HorizontalAlignment = HorizontalAlignment.Right,
                VerticalAlignment = VerticalAlignment.Center,
            };
            AutomationProperties.SetName(button, row.DownloadLabel);
            return button;
        }

        if (row.HasError)
        {
            var error = new Text
            {
                Value = row.ErrorMessage,
                VerticalAlignment = VerticalAlignment.Center,
            };
            ToolTipService.SetToolTip(error, row.ErrorMessage);
            return error;
        }

        var empty = new Border();
        AutomationProperties.SetAccessibilityView(empty, AccessibilityView.Raw);
        return empty;
    }

    private void OnRefreshClick(object sender, RoutedEventArgs e) => InvokeAsync(() => _viewModel.RefreshAsync());

    private void OnRetryInvoked(object? sender, EventArgs e) => InvokeAsync(() => _viewModel.RefreshAsync());

    private void OnSubmitClick(object sender, RoutedEventArgs e) => InvokeAsync(() => _viewModel.SubmitAsync());

    private void OnAccountStartClick(object sender, RoutedEventArgs e) => InvokeAsync(() => _viewModel.RunAccountExportAsync());

    private void OnAccountVehicleChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppressSelection)
        {
            return;
        }

        if (_accountVehicle.SelectedValue is string value)
        {
            _viewModel.SetAccountVehicle(value);
        }
    }

    private void OnWizardVehicleChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppressSelection)
        {
            return;
        }

        if (_wizardVehicle.SelectedValue is string value)
        {
            _viewModel.SelectVehicle(value);
        }
    }

    private void OnAccountStartDateChanged(CalendarDatePicker sender, CalendarDatePickerDateChangedEventArgs args)
    {
        if (!_suppressSelection)
        {
            _viewModel.SetAccountStart(FormatDate(args.NewDate));
        }
    }

    private void OnAccountEndDateChanged(CalendarDatePicker sender, CalendarDatePickerDateChangedEventArgs args)
    {
        if (!_suppressSelection)
        {
            _viewModel.SetAccountEnd(FormatDate(args.NewDate));
        }
    }

    private void OnCustomStartDateChanged(CalendarDatePicker sender, CalendarDatePickerDateChangedEventArgs args)
    {
        if (!_suppressSelection)
        {
            _viewModel.SetCustomStart(FormatDate(args.NewDate));
        }
    }

    private void OnCustomEndDateChanged(CalendarDatePicker sender, CalendarDatePickerDateChangedEventArgs args)
    {
        if (!_suppressSelection)
        {
            _viewModel.SetCustomEnd(FormatDate(args.NewDate));
        }
    }

    private static void ApplySelectOptions(TsSelect select, IReadOnlyList<SelectOptionDisplay> options, string selectedValue)
    {
        select.DisplayMemberPath = nameof(SelectOptionDisplay.Label);
        select.SelectedValuePath = nameof(SelectOptionDisplay.Value);
        if (!ReferenceEquals(select.ItemsSource, options))
        {
            select.ItemsSource = options;
        }

        select.SelectedValue = selectedValue;
    }

    private static string FormatDate(DateTimeOffset? value) =>
        value is { } v ? v.UtcDateTime.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture) : string.Empty;

    private static void AddHistoryColumns(Grid grid)
    {
        double[] weights = [1.1, 0.8, 1.2, 1.0, 0.8, 0.8, 0.9, 1.4, 1.0];
        foreach (var weight in weights)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(weight, GridUnitType.Star) });
        }
    }

    private static void PlaceHistoryCell(FrameworkElement element, int column)
    {
        element.Margin = new Thickness(4, 0, 4, 0);
        Grid.SetColumn(element, column);
    }

    private static Brush? TokenBrush(string resourceKey) =>
        Application.Current.Resources.TryGetValue(resourceKey, out var value) && value is Brush brush ? brush : null;

    private static Brush? StatusBrush(StatusKind status) => TokenBrush(StatusResources.AccentBrushKey(status));

    private static async void InvokeAsync(Func<Task> action) => await action().ConfigureAwait(true);

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;

    protected override AutomationPeer OnCreateAutomationPeer() => new DataExportPageAutomationPeer(this);

    private sealed class DataExportPageAutomationPeer(DataExportPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
