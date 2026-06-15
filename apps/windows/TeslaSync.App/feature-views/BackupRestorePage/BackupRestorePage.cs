using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// The native WinUI 3 <c>BackupRestorePage</c> — a parity port of the web page
/// <c>web/src/features/admin/pages/BackupRestorePage.tsx</c> (route <c>/backup</c>, nav name <c>BackupRestore</c>).
/// It binds to a <see cref="BackupRestorePageViewModel"/> and renders every web region with Fluent components and
/// design tokens: the header (title + subtitle + Quick Backup / New Config actions), the four metric tiles
/// (Total Configs / Total Backups / Last Backup / Total Size), the Backup Configurations panel (configs table or
/// the "no configs" empty state), the Backup History panel (runs table or the "no runs" empty state, plus the
/// recent-errors list), and the create / edit configuration modal, the delete confirm dialog and the restore
/// preview modal. The view is a thin renderer: all branch selection, formatting and i18n happen in the
/// view-model's <see cref="BackupRestoreDisplay"/> projection. State changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class BackupRestorePage : UserControl, IDisposable
{
    private const double PanelPadding = 24;
    private const string AddGlyph = "\uE710";
    private const string QuickGlyph = "\uE945";
    private const string RefreshGlyph = "\uE72C";
    private const string PlayGlyph = "\uE768";
    private const string EditGlyph = "\uE70F";
    private const string DeleteGlyph = "\uE74D";
    private const string DownloadGlyph = "\uE896";
    private const string VerifyGlyph = "\uE72E";
    private const string PreviewGlyph = "\uE890";
    private const string DatabaseGlyph = "\uE950";
    private const string ClockGlyph = "\uE823";
    private const string ErrorGlyph = "\uEA39";

    private static readonly (string Key, string Label, bool Password, bool Multiline, string Hint)[] LocalFields =
    {
        ("path", "Path", false, false, "/backups"),
    };

    private static readonly (string Key, string Label, bool Password, bool Multiline, string Hint)[] S3Fields =
    {
        ("bucket", "Bucket", false, false, "my-backup-bucket"),
        ("region", "Region", false, false, "us-east-1"),
        ("access_key", "Access Key", false, false, ""),
        ("secret_key", "Secret Key", true, false, ""),
        ("endpoint", "Endpoint (optional)", false, false, "https://s3.amazonaws.com"),
        ("prefix", "Prefix (optional)", false, false, "backups/"),
    };

    private static readonly (string Key, string Label, bool Password, bool Multiline, string Hint)[] AzureFields =
    {
        ("account_name", "Account Name", false, false, ""),
        ("account_key", "Account Key", true, false, ""),
        ("container_name", "Container Name", false, false, ""),
        ("prefix", "Prefix (optional)", false, false, "backups/"),
    };

    private static readonly (string Key, string Label, bool Password, bool Multiline, string Hint)[] GcsFields =
    {
        ("bucket", "Bucket", false, false, "my-backup-bucket"),
        ("credentials_json", "Credentials JSON", false, true, ""),
        ("prefix", "Prefix (optional)", false, false, "backups/"),
    };

    private readonly BackupRestorePageViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();
    private readonly TsButton _quickButton = new() { Variant = ButtonVariant.Secondary, Size = ControlSize.Small, IconGlyph = QuickGlyph, VerticalAlignment = VerticalAlignment.Center };
    private readonly TsButton _newButton = new() { Variant = ButtonVariant.Primary, Size = ControlSize.Small, IconGlyph = AddGlyph, VerticalAlignment = VerticalAlignment.Center };

    private readonly InfoBar _toast = new()
    {
        IsOpen = false,
        IsClosable = true,
        Severity = InfoBarSeverity.Success,
        Margin = new Thickness(0, 0, 0, 4),
    };

    private readonly StackPanel _loadingPanel = new() { Spacing = 16 };
    private readonly TsErrorDisplay _errorState = new();
    private readonly StackPanel _content = new() { Spacing = 16 };

    private readonly Grid _statsGrid = new() { ColumnSpacing = 12, RowSpacing = 12 };

    private readonly PanelTitle _configsTitle = new();
    private readonly StackPanel _configsTableHost = new() { Spacing = 0 };
    private readonly TsEmptyState _configsEmpty = new() { IconGlyph = DatabaseGlyph, Visibility = Visibility.Collapsed };

    private readonly PanelTitle _historyTitle = new();
    private readonly TsButton _refreshButton = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small, IconGlyph = RefreshGlyph, VerticalAlignment = VerticalAlignment.Center };
    private readonly StackPanel _runsTableHost = new() { Spacing = 0 };
    private readonly TsEmptyState _runsEmpty = new() { IconGlyph = ClockGlyph, Visibility = Visibility.Collapsed };
    private readonly StackPanel _errorsSection = new() { Spacing = 8, Visibility = Visibility.Collapsed };
    private readonly Caption _errorsTitle = new();
    private readonly StackPanel _errorsList = new() { Spacing = 8 };

    private int _lastToastSequence;

    /// <summary>Creates the page over the default empty feed and the shell resource localizer.</summary>
    public BackupRestorePage()
        : this(EmptyBackupFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The configs / runs list + mutation data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public BackupRestorePage(IBackupFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _viewModel = new BackupRestorePageViewModel(feed, localizer);

        BuildLoadingPanel();
        Content = BuildLayout();

        _quickButton.Click += OnQuickClicked;
        _newButton.Click += OnNewClicked;
        _refreshButton.Click += OnRefreshClicked;
        _errorState.ActionInvoked += OnRetryInvoked;
        _configsEmpty.ActionInvoked += OnNewClicked;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The navigation route name the shell registers this page under (<c>BackupRestore</c>).</summary>
    public static string RouteName => BackupRestoreRegistration.RouteName;

    /// <summary>The diagnostics surface slug (<c>BackupRestorePage</c>).</summary>
    public static string Slug => BackupRestoreRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public BackupRestorePageViewModel ViewModel => _viewModel;

    private ScrollViewer BuildLayout()
    {
        var stack = new StackPanel { Spacing = 16, Padding = new Thickness(24) };
        stack.Children.Add(BuildHeader());
        stack.Children.Add(_toast);
        stack.Children.Add(_loadingPanel);
        stack.Children.Add(_errorState);
        stack.Children.Add(BuildContent());

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
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var heading = new StackPanel { Spacing = 4, VerticalAlignment = VerticalAlignment.Center };
        heading.Children.Add(_title);
        heading.Children.Add(_subtitle);
        Grid.SetColumn(heading, 0);
        grid.Children.Add(heading);

        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        actions.Children.Add(_quickButton);
        actions.Children.Add(_newButton);
        Grid.SetColumn(actions, 1);
        grid.Children.Add(actions);

        return grid;
    }

    private void BuildLoadingPanel()
    {
        _loadingPanel.Children.Add(ColumnsGrid(4, 12, BuildSkeletonBlocks(4, 84)));
        _loadingPanel.Children.Add(new TsGlassPanel
        {
            Padding = new Thickness(PanelPadding),
            Content = new StackPanel
            {
                Spacing = 12,
                Children =
                {
                    new TsSkeleton { BlockHeight = 24 },
                    new TsSkeleton { BlockHeight = 64 },
                    new TsSkeleton { BlockHeight = 64 },
                },
            },
        });
    }

    private StackPanel BuildContent()
    {
        _content.Children.Add(BuildStatsPanel());
        _content.Children.Add(BuildConfigsPanel());
        _content.Children.Add(BuildHistoryPanel());
        return _content;
    }

    private StackPanel BuildStatsPanel()
    {
        var host = new StackPanel { Spacing = 0 };
        host.Children.Add(_statsGrid);
        return host;
    }

    private TsGlassPanel BuildConfigsPanel()
    {
        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(_configsTitle);
        column.Children.Add(_configsTableHost);
        column.Children.Add(_configsEmpty);
        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
    }

    private TsGlassPanel BuildHistoryPanel()
    {
        var headerGrid = new Grid();
        headerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        headerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        _historyTitle.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(_historyTitle, 0);
        Grid.SetColumn(_refreshButton, 1);
        headerGrid.Children.Add(_historyTitle);
        headerGrid.Children.Add(_refreshButton);

        _errorsList.Margin = new Thickness(0, 4, 0, 0);
        _errorsSection.Children.Add(_errorsTitle);
        _errorsSection.Children.Add(_errorsList);

        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(headerGrid);
        column.Children.Add(_runsTableHost);
        column.Children.Add(_runsEmpty);
        column.Children.Add(_errorsSection);

        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        _viewModel.NotifyOpened();
        await _viewModel.LoadAsync().ConfigureAwait(true);
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _quickButton.Click -= OnQuickClicked;
        _newButton.Click -= OnNewClicked;
        _refreshButton.Click -= OnRefreshClicked;
        _errorState.ActionInvoked -= OnRetryInvoked;
        _configsEmpty.ActionInvoked -= OnNewClicked;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
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

    private void OnRefreshClicked(object sender, RoutedEventArgs e) => _ = _viewModel.RefreshRunsAsync();

    private void OnQuickClicked(object sender, RoutedEventArgs e) => _ = _viewModel.QuickBackupAsync();

    private void OnNewClicked(object? sender, RoutedEventArgs e) => _ = OpenConfigModalAsync(null);

    private void OnNewClicked(object? sender, EventArgs e) => _ = OpenConfigModalAsync(null);

    private void LaunchDownload(long runId)
    {
        var uri = _viewModel.GetDownloadUri(runId);
        if (uri is not null)
        {
            _ = Windows.System.Launcher.LaunchUriAsync(uri);
        }
    }

    private void Render(BackupRestoreDisplay display)
    {
        var text = display.Text;

        _title.Value = text.Title;
        _subtitle.Value = text.Subtitle;
        _quickButton.Text = text.QuickBackup;
        _newButton.Text = text.NewConfig;
        _refreshButton.Text = text.Refresh;
        _configsTitle.Value = text.Configurations;
        _historyTitle.Value = text.History;
        AutomationProperties.SetName(this, text.Title);
        AutomationProperties.SetName(_quickButton, text.QuickBackup);
        AutomationProperties.SetName(_newButton, text.NewConfig);
        AutomationProperties.SetName(_refreshButton, text.Refresh);

        _loadingPanel.Visibility = Show(display.IsLoading);

        _errorState.Visibility = Show(display.ShowError);
        _errorState.Title = text.LoadFailed;
        _errorState.Message = display.ErrorMessage;
        _errorState.ActionText = text.Refresh;
        AutomationProperties.SetName(_errorState, text.LoadFailed);

        bool showContent = !display.IsLoading && !display.ShowError;
        _content.Visibility = Show(showContent);
        _quickButton.Visibility = Show(!display.ShowError);
        _newButton.Visibility = Show(!display.ShowError);

        if (showContent)
        {
            RenderStats(display);
            RenderConfigs(display);
            RenderRuns(display);
        }

        SyncToast();
    }

    private void RenderStats(BackupRestoreDisplay display)
    {
        var cards = new List<FrameworkElement>(display.Stats.Count);
        foreach (var stat in display.Stats)
        {
            var card = new TsMetricCard { Label = stat.Label, Value = stat.Value, AccentBrushKey = stat.AccentBrushKey };
            AutomationProperties.SetName(card, $"{stat.Label}: {stat.Value}");
            cards.Add(card);
        }

        FillColumnsGrid(_statsGrid, 4, cards);
    }

    private void RenderConfigs(BackupRestoreDisplay display)
    {
        var text = display.Text;
        bool hasRows = display.ConfigRows.Count > 0;

        _configsTableHost.Visibility = Show(hasRows);
        _configsEmpty.Visibility = Show(!hasRows);
        _configsEmpty.Title = text.NoConfigs;
        _configsEmpty.Message = text.NoConfigsMessage;
        _configsEmpty.ActionText = text.NewConfig;

        _configsTableHost.Children.Clear();
        if (!hasRows)
        {
            return;
        }

        var widths = new[] { 1.6, 1.0, 1.2, 1.0, 1.4, 1.1, 120.0 };
        _configsTableHost.Children.Add(HeaderRow(widths, new[]
        {
            text.Name, text.Type, text.Provider, text.Frequency, text.Schedule, text.Options, string.Empty,
        }));

        foreach (var row in display.ConfigRows)
        {
            _configsTableHost.Children.Add(BuildConfigRow(row, text, widths));
        }
    }

    private void RenderRuns(BackupRestoreDisplay display)
    {
        var text = display.Text;
        bool hasRows = display.RunRows.Count > 0;

        _runsTableHost.Visibility = Show(hasRows);
        _runsEmpty.Visibility = Show(!hasRows);
        _runsEmpty.Title = text.NoRuns;
        _runsEmpty.Message = text.NoRunsMessage;

        _runsTableHost.Children.Clear();
        if (hasRows)
        {
            var widths = new[] { 1.1, 0.9, 1.1, 1.0, 1.4, 0.9, 0.9, 0.9, 100.0 };
            _runsTableHost.Children.Add(HeaderRow(widths, new[]
            {
                text.Time, text.RunType, text.Status, text.Provider, text.File,
                text.Size, text.Records, text.Duration, string.Empty,
            }));

            foreach (var row in display.RunRows)
            {
                _runsTableHost.Children.Add(BuildRunRow(row, text, widths));
            }
        }

        RenderRecentErrors(display);
    }

    private void RenderRecentErrors(BackupRestoreDisplay display)
    {
        bool hasErrors = display.RecentErrors.Count > 0;
        _errorsSection.Visibility = Show(hasErrors);
        _errorsTitle.Value = display.Text.RecentErrors;

        _errorsList.Children.Clear();
        if (!hasErrors)
        {
            return;
        }

        foreach (var entry in display.RecentErrors)
        {
            var icon = new FontIcon { Glyph = ErrorGlyph, FontSize = 14, VerticalAlignment = VerticalAlignment.Top, Foreground = Token("TsColorDangerBrush") };
            var titleText = new Text { Value = entry.Title };
            var messageText = new Caption { Value = entry.Message };

            var col = new StackPanel { Spacing = 2 };
            col.Children.Add(titleText);
            col.Children.Add(messageText);

            var rowPanel = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
            rowPanel.Children.Add(icon);
            rowPanel.Children.Add(col);

            var border = new Border
            {
                Padding = new Thickness(12),
                CornerRadius = new CornerRadius(8),
                Background = Token("TsColorSurfaceGlassBrush"),
                BorderBrush = Token("TsColorDangerBrush"),
                BorderThickness = new Thickness(1),
                Child = rowPanel,
            };
            AutomationProperties.SetName(border, $"{entry.Title}: {entry.Message}");
            _errorsList.Children.Add(border);
        }
    }

    private Grid BuildConfigRow(BackupConfigRowDisplay row, BackupRestoreText text, double[] widths)
    {
        var name = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        name.Children.Add(new Text { Value = row.Name, VerticalAlignment = VerticalAlignment.Center });
        if (!row.Enabled)
        {
            name.Children.Add(new TsBadge { Status = StatusKind.Neutral, Content = row.DisabledLabel, VerticalAlignment = VerticalAlignment.Center });
        }

        var typeBadge = new TsBadge { Status = row.TypeStatus, Content = row.TypeLabel, VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = HorizontalAlignment.Left };
        var providerBadge = ProviderChip(row.ProviderGlyph, row.ProviderLabel, row.ProviderStatus);

        var schedule = new StackPanel { Spacing = 2 };
        schedule.Children.Add(new Caption { Value = $"{text.LastRun}: {row.LastRunText}" });
        schedule.Children.Add(new Caption { Value = $"{text.NextRun}: {row.NextRunText}" });

        var options = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
        if (row.ShowCompress)
        {
            options.Children.Add(new TsBadge { Status = StatusKind.Neutral, Content = text.Compress });
        }

        if (row.ShowEncrypt)
        {
            options.Children.Add(new TsBadge { Status = StatusKind.Warning, Content = text.Encrypt });
        }

        var actions = RowActions(
            (PlayGlyph, text.TriggerNow, () => _ = _viewModel.TriggerConfigAsync(row.Id)),
            (EditGlyph, text.Edit, () => _ = OpenConfigModalAsync(_viewModel.FindConfig(row.Id))),
            (DeleteGlyph, text.Delete, () => _ = ConfirmDeleteAsync(row.Id, row.Name)));

        return TableRow(widths, new FrameworkElement[]
        {
            name,
            typeBadge,
            providerBadge,
            new Caption { Value = row.FrequencyText, VerticalAlignment = VerticalAlignment.Center },
            schedule,
            options,
            actions,
        });
    }

    private Grid BuildRunRow(BackupRunRowDisplay row, BackupRestoreText text, double[] widths)
    {
        var statusPanel = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
        statusPanel.Children.Add(new FontIcon { Glyph = row.StatusGlyph, FontSize = 14, Foreground = Token(StatusResources.AccentBrushKey(row.StatusStatus)), VerticalAlignment = VerticalAlignment.Center });
        statusPanel.Children.Add(new TsBadge { Status = row.StatusStatus, Content = row.StatusLabel, VerticalAlignment = VerticalAlignment.Center });

        FrameworkElement actions = row.IsCompleted
            ? RowActions(
                (DownloadGlyph, text.Download, () => LaunchDownload(row.Id)),
                (VerifyGlyph, text.Verify, () => _ = _viewModel.VerifyRunAsync(row.Id)),
                (PreviewGlyph, text.Preview, () => _ = OpenPreviewAsync(row.Id)))
            : new Border();

        return TableRow(widths, new FrameworkElement[]
        {
            new Caption { Value = row.TimeText, VerticalAlignment = VerticalAlignment.Center },
            new TsBadge { Status = row.RunTypeStatus, Content = row.RunTypeLabel, VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = HorizontalAlignment.Left },
            statusPanel,
            new TsBadge { Status = row.ProviderStatus, Content = row.ProviderLabel, VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = HorizontalAlignment.Left },
            new Caption { Value = row.FileName, VerticalAlignment = VerticalAlignment.Center },
            new Caption { Value = row.SizeText, VerticalAlignment = VerticalAlignment.Center },
            new Caption { Value = row.RecordsText, VerticalAlignment = VerticalAlignment.Center },
            new Caption { Value = row.DurationText, VerticalAlignment = VerticalAlignment.Center },
            actions,
        });
    }

    private static StackPanel ProviderChip(string glyph, string label, StatusKind status)
    {
        var panel = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4, VerticalAlignment = VerticalAlignment.Center };
        var badgeContent = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4 };
        badgeContent.Children.Add(new FontIcon { Glyph = glyph, FontSize = 12, VerticalAlignment = VerticalAlignment.Center });
        badgeContent.Children.Add(new TextBlock { Text = label, VerticalAlignment = VerticalAlignment.Center });
        panel.Children.Add(new TsBadge { Status = status, Content = badgeContent, HorizontalAlignment = HorizontalAlignment.Left });
        return panel;
    }

    private static StackPanel RowActions(params (string Glyph, string Label, Action OnClick)[] buttons)
    {
        var panel = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 4,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
        };

        foreach (var (glyph, label, onClick) in buttons)
        {
            var button = new TsButton { Variant = ButtonVariant.Subtle, Size = ControlSize.Small, IconGlyph = glyph };
            AutomationProperties.SetName(button, label);
            ToolTipService.SetToolTip(button, label);
            button.Click += (_, _) => onClick();
            panel.Children.Add(button);
        }

        return panel;
    }

    // ── Create / edit modal ──────────────────────────────────────────────────────────────────────────────────
    private async Task OpenConfigModalAsync(BackupConfig? editing)
    {
        if (XamlRoot is null)
        {
            return;
        }

        var text = _viewModel.Display.Text;
        var seed = editing is null ? BackupConfigWrite.Empty : BackupConfigWrite.FromConfig(editing);

        var nameInput = new TsInput { Text = seed.Name, PlaceholderText = text.ConfigNameHint, HorizontalAlignment = HorizontalAlignment.Stretch }; // parity:allow WinUI TextBox.PlaceholderText property
        var enabledToggle = new TsToggle { IsOn = seed.Enabled };
        var typeSelect = BuildSelect(new[]
        {
            new SelectOption(text.Full, "full"),
            new SelectOption(text.Incremental, "incremental"),
        }, seed.BackupType);
        var freqInput = new TsInput { Text = seed.FrequencyDays.ToString(CultureInfo.InvariantCulture), HorizontalAlignment = HorizontalAlignment.Stretch };
        var retentionInput = new TsInput { Text = seed.MaxRetention.ToString(CultureInfo.InvariantCulture), HorizontalAlignment = HorizontalAlignment.Stretch };
        var providerSelect = BuildSelect(new[]
        {
            new SelectOption("Local", "local"),
            new SelectOption("Amazon S3", "s3"),
            new SelectOption("Azure Blob", "azure"),
            new SelectOption("Google Cloud", "gcs"),
        }, seed.Provider);
        var compressToggle = new TsToggle { IsOn = seed.Compress };
        var encryptToggle = new TsToggle { IsOn = seed.Encrypt };

        var providerFields = new Dictionary<string, TextBox>(StringComparer.Ordinal);
        var providerFieldsHost = new StackPanel { Spacing = 10 };
        void RebuildProviderFields()
        {
            providerFields.Clear();
            providerFieldsHost.Children.Clear();
            string provider = (providerSelect.SelectedValue as string) ?? seed.Provider;
            foreach (var spec in FieldsFor(provider))
            {
                seed.ProviderConfig.TryGetValue(spec.Key, out var existing);
                TextBox field = spec.Multiline
                    ? new TsTextarea { Text = existing ?? string.Empty, MinHeight = 80, HorizontalAlignment = HorizontalAlignment.Stretch }
                    : new TsInput { Text = existing ?? string.Empty, PlaceholderText = spec.Hint, HorizontalAlignment = HorizontalAlignment.Stretch }; // parity:allow WinUI TextBox.PlaceholderText property
                providerFields[spec.Key] = field;
                providerFieldsHost.Children.Add(LabeledField(spec.Label, field));
            }
        }

        providerSelect.SelectionChanged += (_, _) => RebuildProviderFields();
        RebuildProviderFields();

        var formBody = new StackPanel { Spacing = 14, MinWidth = 460 };
        formBody.Children.Add(LabeledField(text.ConfigName, nameInput));
        formBody.Children.Add(LabeledToggle(text.Enabled, enabledToggle));
        formBody.Children.Add(TwoColumn(LabeledField(text.BackupType, typeSelect), LabeledField(text.FrequencyDays, freqInput)));
        formBody.Children.Add(TwoColumn(LabeledField(text.MaxRetention, retentionInput), LabeledField(text.Provider, providerSelect)));
        formBody.Children.Add(new SectionTitle { Value = text.ProviderSettings });
        formBody.Children.Add(providerFieldsHost);
        formBody.Children.Add(TwoColumn(LabeledToggle(text.Compress, compressToggle), LabeledToggle(text.Encrypt, encryptToggle)));

        var dialog = new TsModal
        {
            Title = editing is null ? text.NewConfigTitle : text.EditConfig,
            Content = new ScrollViewer { Content = formBody, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, MaxHeight = 560 },
            PrimaryButtonText = editing is null ? text.Create : text.SaveChanges,
            CloseButtonText = text.Cancel,
            DefaultButton = ContentDialogButton.Primary,
            XamlRoot = XamlRoot,
        };

        dialog.PrimaryButtonClick += async (_, args) =>
        {
            var deferral = args.GetDeferral();
            try
            {
                if (string.IsNullOrWhiteSpace(nameInput.Text))
                {
                    args.Cancel = true;
                    return;
                }

                var providerConfig = providerFields.ToDictionary(p => p.Key, p => p.Value.Text ?? string.Empty, StringComparer.Ordinal);
                var write = new BackupConfigWrite(
                    Name: nameInput.Text.Trim(),
                    Enabled: enabledToggle.IsOn,
                    BackupType: (typeSelect.SelectedValue as string) ?? "full",
                    FrequencyDays: ParseInt(freqInput.Text, seed.FrequencyDays),
                    MaxRetention: ParseInt(retentionInput.Text, seed.MaxRetention),
                    Provider: (providerSelect.SelectedValue as string) ?? "local",
                    ProviderConfig: providerConfig,
                    Compress: compressToggle.IsOn,
                    Encrypt: encryptToggle.IsOn);

                bool ok = editing is null
                    ? await _viewModel.CreateConfigAsync(write).ConfigureAwait(true)
                    : await _viewModel.UpdateConfigAsync(editing.Id, write).ConfigureAwait(true);
                if (!ok)
                {
                    args.Cancel = true;
                }
            }
            finally
            {
                deferral.Complete();
            }
        };

        await dialog.ShowAsync();
    }

    private async Task ConfirmDeleteAsync(long id, string name)
    {
        if (XamlRoot is null)
        {
            return;
        }

        var text = _viewModel.Display.Text;
        var dialog = new TsConfirmDialog
        {
            Title = text.DeleteConfig,
            Content = new Text { Value = BackupRestoreProjection.Interpolate(text.DeleteConfigMessage, name) },
            PrimaryButtonText = text.Delete,
            CloseButtonText = text.Cancel,
            IsDestructive = true,
            XamlRoot = XamlRoot,
        };

        dialog.PrimaryButtonClick += async (_, args) =>
        {
            var deferral = args.GetDeferral();
            try
            {
                await _viewModel.DeleteConfigAsync(id).ConfigureAwait(true);
            }
            finally
            {
                deferral.Complete();
            }
        };

        await dialog.ShowAsync();
    }

    private async Task OpenPreviewAsync(long runId)
    {
        if (XamlRoot is null)
        {
            return;
        }

        var text = _viewModel.Display.Text;
        var body = new StackPanel { Spacing = 12, MinWidth = 420 };
        var loading = new Text { Value = text.LoadingPreview };
        body.Children.Add(loading);

        var dialog = new TsModal
        {
            Title = text.RestorePreview,
            Content = new ScrollViewer { Content = body, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, MaxHeight = 520 },
            CloseButtonText = text.Close,
            XamlRoot = XamlRoot,
        };

        var showTask = dialog.ShowAsync();

        var preview = await _viewModel.PreviewRunAsync(runId).ConfigureAwait(true);
        body.Children.Clear();
        if (preview is null || preview.Tables.Count == 0)
        {
            body.Children.Add(new TsEmptyState { IconGlyph = DatabaseGlyph, Title = text.NoTables });
        }
        else
        {
            var checksum = new TsBadge
            {
                Status = preview.ChecksumVerified ? StatusKind.Success : StatusKind.Danger,
                Content = preview.ChecksumVerified ? text.ChecksumVerified : text.ChecksumFailed,
                HorizontalAlignment = HorizontalAlignment.Left,
            };
            body.Children.Add(checksum);
            body.Children.Add(new SectionTitle { Value = text.Tables });

            var widths = new[] { 2.0, 1.0 };
            var tableHost = new StackPanel { Spacing = 0 };
            tableHost.Children.Add(HeaderRow(widths, new[] { text.Table, text.Rows }));
            foreach (var t in preview.Tables)
            {
                tableHost.Children.Add(TableRow(widths, new FrameworkElement[]
                {
                    new Text { Value = t.Name, VerticalAlignment = VerticalAlignment.Center },
                    new Caption { Value = BackupRestoreProjection.FormatInt(t.Rows), VerticalAlignment = VerticalAlignment.Center },
                }));
            }

            body.Children.Add(tableHost);
        }

        await showTask;
    }

    // ── Layout helpers ───────────────────────────────────────────────────────────────────────────────────────
    private static TsSelect BuildSelect(IReadOnlyList<SelectOption> options, string selectedValue)
    {
        var select = new TsSelect
        {
            ItemsSource = options,
            DisplayMemberPath = nameof(SelectOption.Label),
            SelectedValuePath = nameof(SelectOption.Value),
            SelectedValue = selectedValue,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };
        return select;
    }

    private static StackPanel LabeledField(string label, FrameworkElement control)
    {
        var cell = new StackPanel { Spacing = 4 };
        cell.Children.Add(new Label { Value = label });
        cell.Children.Add(control);
        return cell;
    }

    private static StackPanel LabeledToggle(string label, TsToggle toggle)
    {
        var cell = new StackPanel { Spacing = 4 };
        cell.Children.Add(new Label { Value = label });
        cell.Children.Add(toggle);
        return cell;
    }

    private static Grid TwoColumn(FrameworkElement left, FrameworkElement right)
    {
        var grid = new Grid { ColumnSpacing = 16 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetColumn(left, 0);
        Grid.SetColumn(right, 1);
        grid.Children.Add(left);
        grid.Children.Add(right);
        return grid;
    }

    private static Grid HeaderRow(double[] widths, string[] headers)
    {
        var cells = new FrameworkElement[headers.Length];
        for (int i = 0; i < headers.Length; i++)
        {
            cells[i] = new Caption { Value = headers[i].ToUpperInvariant() };
        }

        var grid = TableRow(widths, cells);
        grid.Padding = new Thickness(0, 0, 0, 8);
        grid.Margin = new Thickness(0, 0, 0, 4);
        grid.BorderBrush = Token("TsColorBorderBrush");
        grid.BorderThickness = new Thickness(0, 0, 0, 1);
        return grid;
    }

    private static Grid TableRow(double[] widths, FrameworkElement[] cells)
    {
        var grid = new Grid { ColumnSpacing = 12, Padding = new Thickness(0, 8, 0, 8) };
        for (int i = 0; i < widths.Length; i++)
        {
            double w = widths[i];
            grid.ColumnDefinitions.Add(new ColumnDefinition
            {
                Width = w >= 16 ? new GridLength(w) : new GridLength(w, GridUnitType.Star),
            });
        }

        for (int i = 0; i < cells.Length && i < widths.Length; i++)
        {
            var cell = cells[i];
            cell.VerticalAlignment = VerticalAlignment.Center;
            Grid.SetColumn(cell, i);
            grid.Children.Add(cell);
        }

        return grid;
    }

    private static (string Key, string Label, bool Password, bool Multiline, string Hint)[] FieldsFor(string provider) => provider switch
    {
        "s3" => S3Fields,
        "azure" => AzureFields,
        "gcs" => GcsFields,
        _ => LocalFields,
    };

    private static int ParseInt(string? value, int fallback) =>
        int.TryParse((value ?? string.Empty).Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) && n > 0
            ? n
            : fallback;

    private void SyncToast()
    {
        if (_viewModel.ToastSequence == _lastToastSequence)
        {
            return;
        }

        _lastToastSequence = _viewModel.ToastSequence;
        _toast.Title = _viewModel.ToastMessage;
        _toast.Message = string.Empty;
        _toast.Severity = _viewModel.ToastIsError ? InfoBarSeverity.Error : InfoBarSeverity.Success;
        _toast.IsOpen = !string.IsNullOrEmpty(_viewModel.ToastMessage);
    }

    private static Brush? Token(string key) => TypographyTokens.Brush(key);

    private static Grid ColumnsGrid(int columns, double spacing, List<FrameworkElement> children)
    {
        var grid = new Grid { ColumnSpacing = spacing, RowSpacing = spacing };
        FillColumnsGrid(grid, columns, children);
        return grid;
    }

    private static void FillColumnsGrid(Grid grid, int columns, List<FrameworkElement> children)
    {
        grid.Children.Clear();
        grid.ColumnDefinitions.Clear();
        grid.RowDefinitions.Clear();

        for (int i = 0; i < columns; i++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        int rows = (children.Count + columns - 1) / columns;
        for (int i = 0; i < rows; i++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < children.Count; i++)
        {
            var child = children[i];
            Grid.SetColumn(child, i % columns);
            Grid.SetRow(child, i / columns);
            grid.Children.Add(child);
        }
    }

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;

    private static List<FrameworkElement> BuildSkeletonBlocks(int count, double height)
    {
        var blocks = new List<FrameworkElement>(count);
        for (int i = 0; i < count; i++)
        {
            blocks.Add(new TsSkeleton { BlockHeight = height });
        }

        return blocks;
    }

    private sealed record SelectOption(string Label, string Value);
}
