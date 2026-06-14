using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Status;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Status;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.SystemOps;

/// <summary>
/// The native WinUI 3 <c>SystemStatusPage</c> — a parity port of the web page
/// <c>web/src/features/system/pages/SystemStatusPage.tsx</c> (route <c>/system-status</c>, nav name
/// <c>SystemStatus</c>). It binds to a <see cref="SystemStatusPageViewModel"/> and reproduces every web region with
/// Fluent components and design tokens: the page header (title + subtitle + live / stale indicator + Refresh), the
/// top error banner, the status hero, the update-available callout, the at-a-glance health panel (the web GlassPanel),
/// the operator action-items panel, the server-resources panel, the nine disclosure accordions (services, database,
/// telemetry, notifications, workers, backups, Tesla API usage, recent errors, system info), the Tesla-auth card, the
/// 30-day uptime heatmap and the Status-API subscribe footer. Each bound data source renders its own loading / empty /
/// error / success state. The view is a thin renderer: all branch selection, formatting and i18n happen in the
/// view-model's <see cref="SystemStatusDisplay"/> projection. State changes are marshalled onto the UI thread; an
/// auto-refresh timer mirrors the web 30 s refetch interval.
/// </summary>
public sealed partial class SystemStatusPage : UserControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C";       // Segoe Fluent — Refresh
    private const int AutoRefreshSeconds = 30;          // web STATUS_REFRESH_MS (30 s)

    private readonly SystemStatusPageViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private DispatcherQueueTimer? _autoRefresh;
    private bool _disposed;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();
    private readonly Ellipse _liveDot = new() { Width = 8, Height = 8, VerticalAlignment = VerticalAlignment.Center };
    private readonly Caption _liveLabel = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly Border _livePill;
    private readonly TsButton _refreshButton = new() { Size = ControlSize.Small, Variant = ButtonVariant.Subtle, IconGlyph = RefreshGlyph };

    private readonly TsAlertBanner _errorBanner = new() { Variant = CalloutVariant.Danger, IsOpen = false, Dismissible = false };

    private readonly TsPageLoadSkeleton _skeleton = new();
    private readonly StackPanel _content = new() { Spacing = 20 };

    private readonly TsStatusHero _hero = new();
    private readonly TsAlertBanner _updateCallout = new() { Variant = CalloutVariant.Info, Dismissible = false };

    private readonly TsGlassPanel _healthPanel = new();
    private readonly PanelTitle _healthTitle = new();
    private readonly StackPanel _healthRows = new() { Spacing = 2 };

    private readonly TsActionItemsPanel _actionItems = new();
    private readonly TsResourcesPanel _resources = new();

    private readonly TsAccordion _servicesAccordion = new() { IsExpanded = true };
    private readonly ContentControl _servicesBody = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };
    private readonly TsAccordion _databaseAccordion = new() { IsExpanded = true };
    private readonly ContentControl _databaseBody = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };
    private readonly TsAccordion _telemetryAccordion = new() { IsExpanded = true };
    private readonly ContentControl _telemetryBody = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };
    private readonly TsAccordion _notificationsAccordion = new() { IsExpanded = true };
    private readonly ContentControl _notificationsBody = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };
    private readonly TsAccordion _workersAccordion = new() { IsExpanded = true };
    private readonly ContentControl _workersBody = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };
    private readonly TsAccordion _backupsAccordion = new() { IsExpanded = true };
    private readonly ContentControl _backupsBody = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };
    private readonly TsAccordion _apiUsageAccordion = new() { IsExpanded = true };
    private readonly ContentControl _apiUsageBody = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };
    private readonly TsAccordion _errorsAccordion = new() { IsExpanded = true };
    private readonly ContentControl _errorsBody = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };
    private readonly TsAccordion _systemInfoAccordion = new() { IsExpanded = true };
    private readonly ContentControl _systemInfoBody = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };

    private readonly TsGlassPanel _teslaAuthPanel = new();
    private readonly PanelTitle _teslaAuthTitle = new();
    private readonly TextBlock _teslaAuthSummary = new() { FontSize = 13, TextWrapping = TextWrapping.Wrap };
    private readonly ContentControl _teslaAuthBody = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };

    private readonly TsUptimeHeatmap _uptime = new();
    private readonly Text _subscribe = new();

    /// <summary>Creates the page over the default empty feed and the shell resource localizer.</summary>
    public SystemStatusPage()
        : this(EmptySystemStatusFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The status data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public SystemStatusPage(ISystemStatusFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new SystemStatusPageViewModel(feed, localizer);
        _localizer = localizer;

        _livePill = new Border
        {
            Padding = new Thickness(8, 3, 8, 3),
            CornerRadius = new CornerRadius(999),
            Background = DisplayTokens.Surface,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            VerticalAlignment = VerticalAlignment.Center,
            Child = BuildLivePillContent(),
        };

        Content = BuildLayout();

        _refreshButton.Click += (_, _) => _ = _viewModel.RefreshAsync();
        _hero.CtaInvoked += (_, _) => _ = _viewModel.RefreshAsync();

        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The diagnostics surface slug (<c>SystemStatusPage</c>).</summary>
    public static string Slug => SystemStatusRegistration.Slug;

    private StackPanel BuildLivePillContent()
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
        row.Children.Add(_liveDot);
        row.Children.Add(_liveLabel);
        return row;
    }

    private ScrollViewer BuildLayout()
    {
        _content.Children.Add(_hero);
        _content.Children.Add(_updateCallout);
        _content.Children.Add(BuildHealthPanel());
        _content.Children.Add(_actionItems);
        _content.Children.Add(_resources);
        _content.Children.Add(BuildAccordion(_servicesAccordion, _servicesBody));
        _content.Children.Add(BuildAccordion(_databaseAccordion, _databaseBody));
        _content.Children.Add(BuildAccordion(_telemetryAccordion, _telemetryBody));
        _content.Children.Add(BuildTeslaAuthPanel());
        _content.Children.Add(BuildAccordion(_notificationsAccordion, _notificationsBody));
        _content.Children.Add(BuildAccordion(_workersAccordion, _workersBody));
        _content.Children.Add(BuildAccordion(_backupsAccordion, _backupsBody));
        _content.Children.Add(BuildAccordion(_apiUsageAccordion, _apiUsageBody));
        _content.Children.Add(BuildAccordion(_errorsAccordion, _errorsBody));
        _content.Children.Add(BuildAccordion(_systemInfoAccordion, _systemInfoBody));
        _content.Children.Add(_uptime);
        _content.Children.Add(BuildSubscribeFooter());

        var stack = new StackPanel { Spacing = 20, Padding = new Thickness(24), MaxWidth = 1024 };
        stack.Children.Add(BuildHeader());
        stack.Children.Add(_errorBanner);
        stack.Children.Add(_skeleton);
        stack.Children.Add(_content);

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

        var topRow = new Grid { ColumnSpacing = 12 };
        topRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        topRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        topRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        _title.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(_title, 0);

        Grid.SetColumn(_livePill, 1);

        Grid.SetColumn(_refreshButton, 2);

        topRow.Children.Add(_title);
        topRow.Children.Add(_livePill);
        topRow.Children.Add(_refreshButton);

        header.Children.Add(topRow);
        header.Children.Add(_subtitle);
        return header;
    }

    private TsGlassPanel BuildHealthPanel()
    {
        var body = new StackPanel { Spacing = 8, Padding = new Thickness(8) };
        body.Children.Add(_healthTitle);
        body.Children.Add(_healthRows);
        _healthPanel.Content = body;
        AutomationProperties.SetName(_healthPanel, "Health");
        return _healthPanel;
    }

    private TsGlassPanel BuildTeslaAuthPanel()
    {
        var body = new StackPanel { Spacing = 8, Padding = new Thickness(16) };
        _teslaAuthSummary.Foreground = DisplayTokens.TextSecondary;
        body.Children.Add(_teslaAuthTitle);
        body.Children.Add(_teslaAuthSummary);
        body.Children.Add(_teslaAuthBody);
        _teslaAuthPanel.Content = body;
        return _teslaAuthPanel;
    }

    private static TsAccordion BuildAccordion(TsAccordion accordion, ContentControl body)
    {
        accordion.Content = new StackPanel { Spacing = 12, Padding = new Thickness(4, 8, 4, 4), Children = { body } };
        return accordion;
    }

    private StackPanel BuildSubscribeFooter()
    {
        var panel = new StackPanel { HorizontalAlignment = HorizontalAlignment.Center, Padding = new Thickness(0, 4, 0, 8) };
        _subscribe.Foreground = DisplayTokens.TextMuted;
        panel.Children.Add(_subscribe);
        return panel;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        _autoRefresh ??= CreateAutoRefreshTimer();
        _autoRefresh.Start();
        await _viewModel.LoadAsync().ConfigureAwait(true);
    }

    private DispatcherQueueTimer CreateAutoRefreshTimer()
    {
        var timer = _dispatcher.CreateTimer();
        timer.Interval = TimeSpan.FromSeconds(AutoRefreshSeconds);
        timer.IsRepeating = true;
        timer.Tick += OnAutoRefreshTick;
        return timer;
    }

    private void OnAutoRefreshTick(DispatcherQueueTimer sender, object args) => _ = _viewModel.RefreshAsync();

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Unsubscribe from and dispose the view-model (CA1001; mirrors the sibling feature-view pages).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        if (_autoRefresh is { } timer)
        {
            timer.Stop();
            timer.Tick -= OnAutoRefreshTick;
            _autoRefresh = null;
        }

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

    private void Render(SystemStatusDisplay display)
    {
        // ── Header ────────────────────────────────────────────────────────────────────────────────────────
        _title.Value = display.Title;
        _subtitle.Value = display.Subtitle;
        AutomationProperties.SetName(this, display.AutomationName);

        _refreshButton.Text = display.RefreshLabel;
        _refreshButton.IsLoading = _viewModel.IsFetching;
        AutomationProperties.SetName(_refreshButton, display.RefreshAriaLabel);
        ToolTipService.SetToolTip(_refreshButton, display.RefreshAriaLabel);

        _liveDot.Fill = DisplayPrimitives.HexBrush(display.IsLive ? StatusPresentation.HealthyHex : StatusPresentation.UnknownHex);
        _liveLabel.Value = display.IsStale ? Localize("systemStatus.stale", "Stale") : Localize("systemStatus.live", "Live");

        // ── Top error banner (web error → page still renders all sections) ─────────────────────────────────
        _errorBanner.Title = display.Title;
        _errorBanner.Message = display.HeroSubline;
        _errorBanner.IsOpen = display.ShowErrorBanner;
        _errorBanner.Visibility = Show(display.ShowErrorBanner);

        // ── Loading vs content (web isLoading → StatusPageSkeleton) ────────────────────────────────────────
        _skeleton.Visibility = Show(display.IsFirstLoad);
        _content.Visibility = Show(!display.IsFirstLoad);
        if (display.IsFirstLoad)
        {
            return;
        }

        // ── Status hero ────────────────────────────────────────────────────────────────────────────────────
        _hero.Status = display.OverallStatus;
        _hero.Subline = display.HeroSubline;
        _hero.SetCta(display.RunHealthCheckLabel, _viewModel.IsFetching);

        // ── Update-available callout (web hasUpdate) ───────────────────────────────────────────────────────
        _updateCallout.Title = display.UpdateAvailableTitle;
        _updateCallout.Message = $"{display.UpdateCurrentText} \u00b7 {display.ReleaseNotesLabel}";
        _updateCallout.IsOpen = display.ShowUpdateCallout;
        _updateCallout.Visibility = Show(display.ShowUpdateCallout);

        // ── Health panel (the web GlassPanel) ──────────────────────────────────────────────────────────────
        _healthTitle.Value = display.HealthTitle;
        RenderHealthRows(display.HealthRows);

        // ── Action items ───────────────────────────────────────────────────────────────────────────────────
        _actionItems.Title = display.ActionItemsTitle;
        _actionItems.EmptyText = Localize("systemStatus.nothingRightNow", "Nothing right now");
        _actionItems.SetItems(display.ActionItems.Select(BuildActionItem));

        // ── Resources ──────────────────────────────────────────────────────────────────────────────────────
        _resources.SetRows(display.ResourceRows.Select(r => new TsResourceRow(r.Label, r.ValueText, r.MetaText, r.Percent, r.IconGlyph)));
        _resources.Footnote = display.ResourcesFootnote;

        // ── Accordions ─────────────────────────────────────────────────────────────────────────────────────
        SetAccordionHeader(_servicesAccordion, display.ServicesTitle, display.ServicesSummary);
        _servicesBody.Content = RenderSourceBody(
            display.HealthSourceState, display.ServiceRows.Count > 0,
            () => BuildServicesContent(display), Localize("systemStatus.noData", "No data"));

        SetAccordionHeader(_databaseAccordion, display.DatabaseTitle, display.DatabaseSummary);
        _databaseBody.Content = BuildDatabaseContent(display);

        SetAccordionHeader(_telemetryAccordion, display.TelemetryTitle, display.TelemetrySummary);
        _telemetryBody.Content = RenderSourceBody(
            display.VehiclesSourceState, true,
            () => BuildTelemetryContent(display), Localize("systemStatus.noData", "No data"));

        SetAccordionHeader(_notificationsAccordion, display.NotificationsTitle, display.NotificationsSummary);
        _notificationsBody.Content = RenderSourceBody(
            display.NotificationsSourceState, true,
            () => BuildKvContent(display.NotificationRows, display.OpenNotificationsLabel), Localize("systemStatus.noData", "No data"));

        SetAccordionHeader(_workersAccordion, display.WorkersTitle, display.WorkersSummary);
        _workersBody.Content = BuildWorkersContent(display);

        SetAccordionHeader(_backupsAccordion, display.BackupsTitle, display.BackupsSummary);
        _backupsBody.Content = RenderSourceBody(
            display.BackupRunsSourceState, display.BackupsHasRuns,
            () => BuildKvContent(display.BackupRows, display.ManageBackupsLabel), display.NoBackupsMessage);

        SetAccordionHeader(_apiUsageAccordion, display.ApiUsageTitle, display.ApiUsageSummary);
        _apiUsageBody.Content = BuildApiUsageContent(display);

        SetAccordionHeader(_errorsAccordion, display.RecentErrorsTitle, display.RecentErrorsSummary);
        _errorsBody.Content = BuildErrorsContent(display);

        SetAccordionHeader(_systemInfoAccordion, display.SystemInfoTitle, display.SystemInfoSummary);
        _systemInfoBody.Content = BuildSystemInfoContent(display);

        // ── Tesla auth card ────────────────────────────────────────────────────────────────────────────────
        _teslaAuthTitle.Value = display.TeslaAuthLabel;
        _teslaAuthSummary.Text = display.TeslaAuthSummary;
        _teslaAuthBody.Content = RenderSourceBody(
            display.AuthSourceState, true,
            () => BuildTeslaAuthContent(display), Localize("systemStatus.noData", "No data"));

        // ── Uptime heatmap ─────────────────────────────────────────────────────────────────────────────────
        _uptime.SetDays(display.UptimeDays);
        _uptime.Footnote = display.UptimeFootnote;

        // ── Subscribe footer ───────────────────────────────────────────────────────────────────────────────
        _subscribe.Value = $"{display.SubscribeLabel} \u2192";
    }

    private void RenderHealthRows(IReadOnlyList<StatusHealthRowDisplay> rows)
    {
        _healthRows.Children.Clear();
        foreach (var row in rows)
        {
            _healthRows.Children.Add(new TsHealthRow
            {
                Status = row.Status,
                Label = row.Label,
                Summary = row.Summary,
                IconGlyph = row.IconGlyph,
            });
        }
    }

    private Border BuildActionItem(StatusActionItemDisplay item)
    {
        var accent = DisplayPrimitives.HexBrush(item.Severity switch
        {
            CalloutSeverity.Error => StatusPresentation.UnhealthyHex,
            CalloutSeverity.Warn => StatusPresentation.DegradedHex,
            _ => StatusPresentation.MaintenanceHex,
        });

        var column = new StackPanel { Spacing = 4 };
        column.Children.Add(new Text { Value = item.Title, Foreground = DisplayTokens.TextPrimary });
        if (!string.IsNullOrEmpty(item.Description))
        {
            column.Children.Add(new Caption { Value = item.Description });
        }

        if (!string.IsNullOrEmpty(item.CtaLabel))
        {
            var cta = new TsButton { Text = item.CtaLabel, Size = ControlSize.Small, Variant = ButtonVariant.Subtle };
            cta.Click += (_, _) => _ = _viewModel.RefreshAsync();
            column.Children.Add(cta);
        }

        return new Border
        {
            Child = column,
            Padding = new Thickness(12),
            CornerRadius = new CornerRadius(8),
            BorderBrush = accent,
            BorderThickness = new Thickness(3, 0, 0, 0),
            Background = DisplayTokens.Surface,
        };
    }

    private UIElement RenderSourceBody(SystemStatusState state, bool hasContent, Func<UIElement> success, string emptyMessage)
    {
        switch (state)
        {
            case SystemStatusState.Loading:
                return new TsSkeleton { Height = 64 };
            case SystemStatusState.Error:
                var error = new TsErrorDisplay
                {
                    Message = Localize("systemStatus.loadError", "Could not load data"),
                    ActionText = Localize("systemStatus.retry", "Retry"),
                };
                error.ActionInvoked += (_, _) => _ = _viewModel.RefreshAsync();
                return error;
            case SystemStatusState.Empty:
                return new TsEmptyState { Message = emptyMessage };
            default:
                return hasContent ? success() : new TsEmptyState { Message = emptyMessage };
        }
    }

    private StackPanel BuildServicesContent(SystemStatusDisplay display)
    {
        var column = new StackPanel { Spacing = 6 };
        foreach (var service in display.ServiceRows)
        {
            var row = new Grid { ColumnSpacing = 10 };
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            var dot = new Ellipse
            {
                Width = 8,
                Height = 8,
                VerticalAlignment = VerticalAlignment.Center,
                Fill = DisplayPrimitives.HexBrush(StatusPresentation.AccentHex(service.Status)),
            };
            Grid.SetColumn(dot, 0);

            var name = new Text { Value = service.Name, VerticalAlignment = VerticalAlignment.Center };
            Grid.SetColumn(name, 1);

            var status = new Caption { Value = service.StatusText, VerticalAlignment = VerticalAlignment.Center };
            Grid.SetColumn(status, 2);

            row.Children.Add(dot);
            row.Children.Add(name);
            row.Children.Add(status);
            column.Children.Add(row);
        }

        column.Children.Add(BuildDetailLink(display.OpenLiveMonitorLabel));
        return column;
    }

    private StackPanel BuildDatabaseContent(SystemStatusDisplay display)
    {
        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(new TsKVList { Items = Kv(display.DatabaseRows) });
        column.Children.Add(BuildDetailLink(display.OpenDbHealthLabel));
        return column;
    }

    private static Text BuildTelemetryContent(SystemStatusDisplay display) =>
        new Text { Value = display.TelemetrySummary, Foreground = DisplayTokens.TextSecondary };

    private StackPanel BuildKvContent(IReadOnlyList<StatusKvRow> rows, string detailLabel)
    {
        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(new TsKVList { Items = Kv(rows) });
        if (!string.IsNullOrEmpty(detailLabel))
        {
            column.Children.Add(BuildDetailLink(detailLabel));
        }

        return column;
    }

    private static IEnumerable<TsKeyValue> Kv(IReadOnlyList<StatusKvRow> rows) =>
        rows.Select(r => new TsKeyValue(r.Key, r.Value));

    private static StackPanel BuildWorkersContent(SystemStatusDisplay display)
    {
        var column = new StackPanel { Spacing = 8 };
        column.Children.Add(new Text { Value = display.WorkersSummary, Foreground = DisplayTokens.TextSecondary });
        column.Children.Add(new Caption { Value = display.WorkersUnhealthyText });
        return column;
    }

    private StackPanel BuildApiUsageContent(SystemStatusDisplay display)
    {
        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(new Text { Value = display.ApiUsageSummary, Foreground = DisplayTokens.TextSecondary });
        column.Children.Add(new Text { Value = display.ApiOverBudgetTitle, Foreground = DisplayTokens.TextSecondary });
        column.Children.Add(new Caption { Value = display.ApiOverBudgetDesc });
        column.Children.Add(BuildDetailLink(display.OpenApiLogsLabel));
        return column;
    }

    private StackPanel BuildErrorsContent(SystemStatusDisplay display)
    {
        var column = new StackPanel { Spacing = 12 };
        if (display.HasErrors && display.ErrorRows.Count > 0)
        {
            foreach (var error in display.ErrorRows)
            {
                var row = new Grid { ColumnSpacing = 10 };
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

                var code = new Code { Value = error.Code, VerticalAlignment = VerticalAlignment.Center };
                Grid.SetColumn(code, 0);
                var message = new Caption { Value = error.Message, VerticalAlignment = VerticalAlignment.Center };
                Grid.SetColumn(message, 1);
                var count = new Caption { Value = error.Count, VerticalAlignment = VerticalAlignment.Center };
                Grid.SetColumn(count, 2);
                row.Children.Add(code);
                row.Children.Add(message);
                row.Children.Add(count);
                column.Children.Add(row);
            }
        }
        else
        {
            var empty = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
            empty.Children.Add(new FontIcon { Glyph = "\uE7BA", FontSize = 14, Foreground = DisplayTokens.TextMuted, VerticalAlignment = VerticalAlignment.Center });
            empty.Children.Add(new Text { Value = display.NoErrorsMessage, Foreground = DisplayTokens.TextMuted, VerticalAlignment = VerticalAlignment.Center });
            column.Children.Add(empty);
        }

        column.Children.Add(BuildDetailLink(display.OpenErrorLogsLabel));
        return column;
    }

    private static StackPanel BuildSystemInfoContent(SystemStatusDisplay display)
    {
        var column = new StackPanel { Spacing = 8 };
        column.Children.Add(new TsKVList { Items = Kv(display.SystemInfoRows) });
        foreach (var row in display.SystemInfoRows)
        {
            if (string.IsNullOrEmpty(row.Value))
            {
                column.Children.Add(new Caption { Value = row.Key });
            }
        }

        return column;
    }

    private StackPanel BuildTeslaAuthContent(SystemStatusDisplay display)
    {
        var column = new StackPanel { Spacing = 8 };
        if (!display.TeslaConnected)
        {
            column.Children.Add(new Text { Value = display.TeslaNotConnectedTitle, Foreground = DisplayTokens.TextPrimary });
            column.Children.Add(new Caption { Value = display.TeslaNotConnectedDesc });
            var connect = new TsButton { Text = display.ConnectLabel, Size = ControlSize.Small, Variant = ButtonVariant.Secondary };
            connect.Click += (_, _) => _ = _viewModel.RefreshAsync();
            column.Children.Add(connect);
        }
        else
        {
            column.Children.Add(new Caption { Value = display.TeslaAuthSummary });
        }

        return column;
    }

    private TsButton BuildDetailLink(string label)
    {
        var button = new TsButton { Text = label, Size = ControlSize.Small, Variant = ButtonVariant.Subtle };
        button.Click += (_, _) => _ = _viewModel.RefreshAsync();
        return button;
    }

    private static void SetAccordionHeader(TsAccordion accordion, string title, string summary)
    {
        var header = new StackPanel { Spacing = 1 };
        header.Children.Add(new PanelTitle { Value = title });
        if (!string.IsNullOrEmpty(summary))
        {
            header.Children.Add(new Caption { Value = summary });
        }

        accordion.Header = header;
        AutomationProperties.SetName(accordion, string.IsNullOrEmpty(summary) ? title : $"{title}: {summary}");
    }

    private string Localize(string key, string fallback) => _localizer.GetString(key, fallback);

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;
}
