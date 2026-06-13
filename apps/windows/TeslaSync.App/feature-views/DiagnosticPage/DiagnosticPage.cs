using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;
using Windows.Storage;

namespace TeslaSync.App.FeatureViews.SystemDiagnostics;

/// <summary>
/// The native WinUI 3 <c>DiagnosticPage</c> — a parity port of the web page
/// <c>web/src/features/system/pages/DiagnosticPage.tsx</c> (the operator self-test wizard; web route is unrouted). It
/// binds to a <see cref="DiagnosticPageViewModel"/> and renders every web region with Fluent components and design
/// tokens: the page header (title + subtitle + Run/Re-run affordance), and the five GlassPanel regions — the failed-run
/// error panel (web <c>latestError</c>), the overall hero (status glyph + verdict + generated-at + check-count badge),
/// the copy/download actions row, the per-check cards (icon + name + id + detail + remediation + status badge +
/// duration), the in-flight spinner panel, and the "no diagnostic run yet" empty panel. The view is a thin renderer:
/// all branch selection, formatting and i18n happen in the view-model's <see cref="DiagnosticDisplay"/> projection.
/// State changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class DiagnosticPage : UserControl, IDisposable
{
    private readonly DiagnosticPageViewModel _viewModel;
    private readonly IDiagnosticReportDownloader _downloader;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();
    private readonly TsButton _runButton = new() { Variant = ButtonVariant.Primary };

    private readonly TsGlassPanel _errorPanel = new();
    private readonly FontIcon _errorIcon = new() { FontSize = 20 };
    private readonly PanelTitle _errorTitle = new();
    private readonly Text _errorMessage = new();

    private readonly TsGlassPanel _overallPanel = new();
    private readonly Border _overallIconCircle;
    private readonly FontIcon _overallIcon = new() { FontSize = 28 };
    private readonly Heading _overallTitle = new();
    private readonly Caption _lastRun = new();
    private readonly TsBadge _checkCountBadge = new() { HorizontalAlignment = HorizontalAlignment.Right };
    private readonly TextBlock _checkCountText = new();

    private readonly StackPanel _actionsRow;
    private readonly TsCopyButton _copyButton = new() { Variant = ButtonVariant.Secondary, Size = ControlSize.Medium };
    private readonly TsButton _downloadButton = new() { Variant = ButtonVariant.Secondary, IconGlyph = "\uE896" };
    private readonly Caption _downloadStatus = new() { Visibility = Visibility.Collapsed };

    private readonly TsGlassPanel _checksPanel = new();
    private readonly ContentControl _checksHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };

    private readonly TsGlassPanel _runningPanel = new();
    private readonly TsSpinner _spinner = new() { Size = ControlSize.Large };

    private readonly TsGlassPanel _emptyPanel = new();
    private readonly TsEmptyState _emptyState = new() { IconGlyph = "\uE9D9" }; // Diagnostic / activity

    private string _reportText = string.Empty;
    private string _downloadFilename = string.Empty;
    private string _downloadSuccessMessage = string.Empty;

    /// <summary>Creates the page over the default (un-wired) runner, the Downloads-folder downloader and the shell localizer.</summary>
    public DiagnosticPage()
        : this(EmptyDiagnosticRunner.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit runner, localizer and (optional) report downloader (tests / DI).</summary>
    /// <param name="runner">The diagnostic-run data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="downloader">The report downloader (defaults to the Downloads-folder writer).</param>
    public DiagnosticPage(IDiagnosticRunner runner, ILocalizer localizer, IDiagnosticReportDownloader? downloader = null)
    {
        ArgumentNullException.ThrowIfNull(runner);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new DiagnosticPageViewModel(runner, localizer);
        _downloader = downloader ?? new DownloadsFolderReportDownloader();

        _overallIconCircle = BuildIconCircle(_overallIcon, 48);
        _actionsRow = BuildActionsRow();

        BuildErrorPanel();
        BuildOverallPanel();
        BuildChecksPanel();
        BuildRunningPanel();
        BuildEmptyPanel();

        Content = BuildLayout();

        _runButton.Click += OnRunInvoked;
        _emptyState.ActionInvoked += OnRunInvoked;
        _downloadButton.Click += OnDownloadInvoked;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The diagnostics surface slug (<c>DiagnosticPage</c>).</summary>
    public static string Slug => DiagnosticRegistration.Slug;

    private ScrollViewer BuildLayout()
    {
        var stack = new StackPanel { Spacing = 24, Padding = new Thickness(24) };
        stack.Children.Add(BuildHeader());
        stack.Children.Add(_errorPanel);
        stack.Children.Add(_overallPanel);
        stack.Children.Add(_actionsRow);
        stack.Children.Add(_downloadStatus);
        stack.Children.Add(_checksPanel);
        stack.Children.Add(_runningPanel);
        stack.Children.Add(_emptyPanel);

        return new ScrollViewer
        {
            Content = stack,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
    }

    private Grid BuildHeader()
    {
        var header = new Grid { ColumnSpacing = 16 };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var titles = new StackPanel { Spacing = 4, VerticalAlignment = VerticalAlignment.Center };
        titles.Children.Add(_title);
        titles.Children.Add(_subtitle);
        Grid.SetColumn(titles, 0);

        _runButton.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(_runButton, 1);

        header.Children.Add(titles);
        header.Children.Add(_runButton);
        return header;
    }

    private void BuildErrorPanel()
    {
        _errorIcon.Foreground = ToneBrush(StatusKind.Danger);
        _errorPanel.BorderBrush = ToneBrush(StatusKind.Danger);
        _errorPanel.BorderThickness = new Thickness(1);
        _errorPanel.Padding = new Thickness(16);

        var column = new StackPanel { Spacing = 4 };
        column.Children.Add(_errorTitle);
        column.Children.Add(_errorMessage);

        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
        _errorIcon.VerticalAlignment = VerticalAlignment.Top;
        row.Children.Add(_errorIcon);
        row.Children.Add(column);
        _errorPanel.Content = row;
    }

    private void BuildOverallPanel()
    {
        _overallPanel.Padding = new Thickness(20);

        var grid = new Grid { ColumnSpacing = 16 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var left = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 16, VerticalAlignment = VerticalAlignment.Center };
        left.Children.Add(_overallIconCircle);

        var verdict = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        verdict.Children.Add(_overallTitle);
        verdict.Children.Add(_lastRun);
        left.Children.Add(verdict);
        Grid.SetColumn(left, 0);

        _checkCountBadge.Content = _checkCountText;
        _checkCountBadge.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(_checkCountBadge, 1);

        grid.Children.Add(left);
        grid.Children.Add(_checkCountBadge);
        _overallPanel.Content = grid;
    }

    private StackPanel BuildActionsRow()
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        row.Children.Add(_copyButton);
        row.Children.Add(_downloadButton);
        return row;
    }

    private void BuildChecksPanel()
    {
        _checksPanel.Padding = new Thickness(0);
        _checksPanel.BorderThickness = new Thickness(0);
        _checksPanel.Background = null;
        _checksPanel.Content = _checksHost;
    }

    private void BuildRunningPanel()
    {
        _runningPanel.Padding = new Thickness(48);
        _runningPanel.Content = new Grid { Children = { _spinner } };
        _spinner.HorizontalAlignment = HorizontalAlignment.Center;
    }

    private void BuildEmptyPanel()
    {
        _emptyPanel.Padding = new Thickness(24);
        _emptyPanel.Content = _emptyState;
    }

    private void OnLoaded(object sender, RoutedEventArgs e) => _viewModel.NotifyOpened();

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Unsubscribe from and dispose the view-model (CA1001; mirrors the sibling feature-view pages).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _runButton.Click -= OnRunInvoked;
        _emptyState.ActionInvoked -= OnRunInvoked;
        _downloadButton.Click -= OnDownloadInvoked;
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

    private void OnRunInvoked(object? sender, object e) => InvokeAsync(() => _viewModel.RunAsync());

    private async void OnDownloadInvoked(object sender, RoutedEventArgs e)
    {
        if (string.IsNullOrEmpty(_reportText))
        {
            return;
        }

        try
        {
            await _downloader.SaveAsync(_downloadFilename, _reportText, CancellationToken.None).ConfigureAwait(true);
            _downloadStatus.Value = _downloadSuccessMessage;
            _downloadStatus.Visibility = Visibility.Visible;
        }
        catch (Exception)
        {
            // A failed save is non-fatal — the Copy affordance remains the operator's fallback.
            _downloadStatus.Visibility = Visibility.Collapsed;
        }
    }

    private void Render(DiagnosticDisplay display)
    {
        _title.Value = display.Title;
        _subtitle.Value = display.Subtitle;
        AutomationProperties.SetName(this, display.AutomationName);

        // Header Run / Re-run affordance.
        _runButton.Text = display.RunLabel;
        _runButton.IconGlyph = display.RunGlyph;
        _runButton.IsLoading = display.RunBusy;
        AutomationProperties.SetName(_runButton, display.RunLabel);

        // GlassPanel 1 — failed-run error panel.
        _errorPanel.Visibility = Show(display.ShowError);
        _errorTitle.Value = display.ErrorTitle;
        _errorMessage.Value = display.ErrorMessage;
        AutomationProperties.SetName(_errorPanel, display.ErrorTitle);

        // GlassPanel 2 — overall hero.
        _overallPanel.Visibility = Show(display.ShowOverall);
        _overallIcon.Glyph = display.OverallGlyph;
        _overallIcon.Foreground = ToneBrush(display.OverallTone);
        _overallTitle.Value = display.OverallTitle;
        _lastRun.Value = display.LastRunText;
        _checkCountText.Text = display.CheckCountText;
        _checkCountBadge.Status = display.OverallTone;
        AutomationProperties.SetName(_checkCountBadge, display.CheckCountText);

        // Actions — copy report + download .txt.
        _actionsRow.Visibility = Show(display.ShowActions);
        _copyButton.CopyLabel = display.CopyReportLabel;
        _copyButton.CopiedLabel = display.CopiedLabel;
        _copyButton.ValueToCopy = display.ReportJson;
        _downloadButton.Text = display.DownloadReportLabel;
        AutomationProperties.SetName(_downloadButton, display.DownloadReportLabel);
        _reportText = display.ReportText;
        _downloadFilename = display.DownloadFilename;
        _downloadSuccessMessage = display.CopyReportSuccess;
        if (!display.ShowActions)
        {
            _downloadStatus.Visibility = Visibility.Collapsed;
        }

        // GlassPanel 3 — per-check cards.
        _checksPanel.Visibility = Show(display.ShowChecks);
        _checksHost.Content = display.ShowChecks ? BuildChecksGrid(display.Checks) : null;

        // GlassPanel 4 — in-flight spinner.
        _runningPanel.Visibility = Show(display.ShowRunning);
        _spinner.Label = display.RunningText;

        // GlassPanel 5 — empty surface.
        _emptyPanel.Visibility = Show(display.ShowEmpty);
        _emptyState.Title = display.EmptyTitle;
        _emptyState.Message = display.EmptyMessage;
        _emptyState.ActionText = display.EmptyActionLabel;
    }

    private static Grid BuildChecksGrid(IReadOnlyList<DiagnosticCheckDisplay> cards)
    {
        var grid = new Grid { ColumnSpacing = 12, RowSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        int rows = (cards.Count + 1) / 2;
        for (var r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (var i = 0; i < cards.Count; i++)
        {
            var card = BuildCheckCard(cards[i]);
            Grid.SetRow(card, i / 2);
            Grid.SetColumn(card, i % 2);
            grid.Children.Add(card);
        }

        return grid;
    }

    private static TsGlassPanel BuildCheckCard(DiagnosticCheckDisplay card)
    {
        var panel = new TsGlassPanel { Padding = new Thickness(16) };
        AutomationProperties.SetName(panel, $"{card.Name} {card.StatusBadgeLabel}");

        var grid = new Grid { ColumnSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var leadIcon = new FontIcon { Glyph = card.StatusGlyph, FontSize = 18, Foreground = ToneBrush(card.Tone) };
        var iconCircle = BuildIconCircle(leadIcon, 36);
        iconCircle.VerticalAlignment = VerticalAlignment.Top;

        var body = new StackPanel { Spacing = 4 };
        body.Children.Add(new PanelTitle { Value = card.Name });
        body.Children.Add(new Caption { Value = card.Id });
        body.Children.Add(new Text { Value = card.Detail });

        if (card.ShowRemediation)
        {
            var remediation = new StackPanel { Spacing = 2 };
            remediation.Children.Add(new MetricLabel { Value = card.RemediationLabel });
            remediation.Children.Add(new Text { Value = card.Remediation });
            body.Children.Add(new Border
            {
                Child = remediation,
                Padding = new Thickness(12),
                CornerRadius = new CornerRadius(8),
                BorderThickness = new Thickness(1),
                BorderBrush = Brush("TsColorBorderBrush"),
                Background = Brush("TsColorSurfaceBrush"),
                Margin = new Thickness(0, 8, 0, 0),
            });
        }

        var lead = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
        lead.Children.Add(iconCircle);
        lead.Children.Add(body);
        Grid.SetColumn(lead, 0);

        var trailing = new StackPanel { Spacing = 8, HorizontalAlignment = HorizontalAlignment.Right };
        var badge = new TsBadge { Status = card.Tone, HorizontalAlignment = HorizontalAlignment.Right };
        badge.Content = new TextBlock { Text = card.StatusBadgeLabel };
        AutomationProperties.SetName(badge, card.StatusBadgeLabel);
        trailing.Children.Add(badge);
        trailing.Children.Add(new Caption { Value = card.DurationText, HorizontalAlignment = HorizontalAlignment.Right });
        Grid.SetColumn(trailing, 1);

        grid.Children.Add(lead);
        grid.Children.Add(trailing);
        panel.Content = grid;
        return panel;
    }

    private static Border BuildIconCircle(FontIcon icon, double size)
    {
        icon.HorizontalAlignment = HorizontalAlignment.Center;
        icon.VerticalAlignment = VerticalAlignment.Center;
        return new Border
        {
            Width = size,
            Height = size,
            CornerRadius = new CornerRadius(size / 2),
            Background = Brush("TsColorSurfaceBrush"),
            BorderBrush = Brush("TsColorBorderBrush"),
            BorderThickness = new Thickness(1),
            Child = icon,
        };
    }

    private static void InvokeAsync(Func<Task> action)
    {
        _ = RunGuardedAsync(action);
    }

    private static async Task RunGuardedAsync(Func<Task> action)
    {
        try
        {
            await action().ConfigureAwait(true);
        }
        catch (Exception)
        {
            // The view-model already folds run failures into the error panel; nothing to surface here.
        }
    }

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;

    private static Brush? ToneBrush(StatusKind tone) => Brush(StatusResources.AccentBrushKey(tone));

    private static Brush? Brush(string key) =>
        Application.Current.Resources.TryGetValue(key, out var value) && value is Brush brush ? brush : null;
}

/// <summary>
/// The default <see cref="IDiagnosticReportDownloader"/> — writes the plain-text diagnostic report to the user's
/// Downloads folder via <see cref="DownloadsFolder"/>, the native analogue of the web blob download. A name collision
/// is uniquified so re-saving never overwrites a prior report.
/// </summary>
public sealed class DownloadsFolderReportDownloader : IDiagnosticReportDownloader
{
    /// <inheritdoc />
    public async Task<string> SaveAsync(string filename, string content, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(filename);
        ArgumentNullException.ThrowIfNull(content);

        StorageFile file = await DownloadsFolder
            .CreateFileAsync(filename, CreationCollisionOption.GenerateUniqueName)
            .AsTask(cancellationToken)
            .ConfigureAwait(true);
        await FileIO.WriteTextAsync(file, content).AsTask(cancellationToken).ConfigureAwait(true);
        return file.Name;
    }
}
