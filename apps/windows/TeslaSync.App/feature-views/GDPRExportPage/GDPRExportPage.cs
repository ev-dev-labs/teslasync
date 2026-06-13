using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
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
/// The native WinUI 3 <c>GDPRExportPage</c> — a parity port of the web page
/// <c>web/src/features/admin/pages/GDPRExportPage.tsx</c> (route <c>/admin/gdpr-exports</c>, nav name <c>GDPRExport</c>).
/// It binds to a <see cref="GDPRExportPageViewModel"/> and renders every web region with Fluent components and design
/// tokens: the page header, the lookup panel (artifact-id input + Look up button + hint), the HTTP-503 subsystem
/// banner (web <c>subsystemMissing</c>), the HTTP-404 not-found banner (web <c>notFound</c>), the "no artifact
/// selected" empty surface, the loading + generic-error surfaces, and the artifact section — the status badge, the
/// format / size / storage stat tiles, the artifact-details panel (id + copy, user, created/completed/expires with
/// relative time, SHA-256 + copy), the optional export-failed banner and the download panel (Download bundle button or
/// the waiting / expired / failed caption). The view is a thin renderer: all branch selection, formatting and i18n
/// happen in the view-model's <see cref="GDPRExportDisplay"/> projection. State changes are marshalled onto the UI
/// thread.
/// </summary>
public sealed partial class GDPRExportPage : UserControl, IDisposable
{
    private const string SearchGlyph = "\uE721";
    private const string DownloadGlyph = "\uE896";

    private readonly GDPRExportPageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;
    private bool _suppressEvents;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();

    // ── Panel 1: lookup ──
    private readonly PanelTitle _lookupTitle = new();
    private readonly Label _idLabel = new();
    private readonly TsInput _idInput = new();
    private readonly TsButton _lookupButton = new() { Variant = ButtonVariant.Primary, Size = ControlSize.Medium, IconGlyph = SearchGlyph };
    private readonly Caption _lookupHint = new();

    // ── Banners ──
    private readonly TsAlertBanner _subsystemBanner = new() { Variant = CalloutVariant.Warning, IsOpen = false, Dismissible = false };
    private readonly TsAlertBanner _notFoundBanner = new() { Variant = CalloutVariant.Danger, IsOpen = false, Dismissible = false };

    // ── Panel 2: empty ──
    private readonly TsGlassPanel _emptyPanel = new();
    private readonly TsEmptyState _emptyState = new() { IconGlyph = DownloadGlyph };

    // ── Loading + error surfaces ──
    private readonly StackPanel _loadingPanel;
    private readonly Text _loadingText = new() { HorizontalAlignment = HorizontalAlignment.Center };
    private readonly TsQueryError _errorState = new();

    // ── Artifact section ──
    private readonly StackPanel _artifactSection = new() { Spacing = 16 };

    // Panel 3: status badge
    private readonly Caption _statusCaption = new();
    private readonly TsBadge _statusBadge = new();
    private readonly TextBlock _statusBadgeText = new() { FontSize = 13, VerticalAlignment = VerticalAlignment.Center };

    // Stat tiles
    private readonly TsStatCard _formatCard = new();
    private readonly TsStatCard _sizeCard = new();
    private readonly TsStatCard _storageCard = new();

    // Panel 7: details
    private readonly PanelTitle _metaTitle = new();
    private readonly StackPanel _metaRowsPanel = new() { Spacing = 16 };

    // Artifact-error banner
    private readonly TsAlertBanner _artifactErrorBanner = new() { Variant = CalloutVariant.Danger, IsOpen = false, Dismissible = false };

    // Panel 8: download
    private readonly PanelTitle _downloadTitle = new();
    private readonly StackPanel _downloadGroup = new() { Spacing = 12 };
    private readonly Text _downloadHint = new();
    private readonly TsButton _downloadButton = new() { Variant = ButtonVariant.Primary, Size = ControlSize.Medium, IconGlyph = DownloadGlyph };
    private readonly Caption _downloadCaption = new();

    private string _copyLabel = "Copy";
    private string _copiedLabel = "Copied";
    private string? _launchUri;

    /// <summary>Creates the page over the default empty feed and the shell resource localizer.</summary>
    public GDPRExportPage()
        : this(EmptyGDPRExportFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The GDPR-export data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public GDPRExportPage(IGDPRExportFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new GDPRExportPageViewModel(feed, localizer);

        _loadingPanel = BuildLoadingPanel();
        Content = BuildLayout();

        _lookupButton.Click += OnLookupClick;
        _idInput.KeyDown += OnIdKeyDown;
        _idInput.TextChanged += OnIdTextChanged;
        _errorState.ActionInvoked += OnRetryInvoked;
        _downloadButton.Click += OnDownloadClick;

        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The diagnostics surface slug (<c>GDPRExportPage</c>).</summary>
    public static string Slug => GDPRExportRegistration.Slug;

    private ScrollViewer BuildLayout()
    {
        var stack = new StackPanel { Spacing = 16, Padding = new Thickness(24) };

        var header = new StackPanel { Spacing = 4 };
        header.Children.Add(_title);
        header.Children.Add(_subtitle);
        stack.Children.Add(header);

        stack.Children.Add(BuildLookupPanel());
        stack.Children.Add(_subsystemBanner);
        stack.Children.Add(_notFoundBanner);
        stack.Children.Add(BuildEmptyPanel());
        stack.Children.Add(_loadingPanel);
        stack.Children.Add(_errorState);
        stack.Children.Add(BuildArtifactSection());

        return new ScrollViewer
        {
            Content = stack,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
    }

    private TsGlassPanel BuildLookupPanel()
    {
        var grid = new Grid { ColumnSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        _idInput.HorizontalAlignment = HorizontalAlignment.Stretch;
        var inputCell = new StackPanel { Spacing = 4 };
        inputCell.Children.Add(_idLabel);
        inputCell.Children.Add(_idInput);
        Grid.SetColumn(inputCell, 0);

        _lookupButton.VerticalAlignment = VerticalAlignment.Bottom;
        Grid.SetColumn(_lookupButton, 1);

        grid.Children.Add(inputCell);
        grid.Children.Add(_lookupButton);

        var body = new StackPanel { Spacing = 12 };
        body.Children.Add(_lookupTitle);
        body.Children.Add(grid);
        body.Children.Add(_lookupHint);

        return new TsGlassPanel { Content = new Border { Padding = new Thickness(24), Child = body } };
    }

    private TsGlassPanel BuildEmptyPanel()
    {
        _emptyPanel.Content = new Border { Padding = new Thickness(24), Child = _emptyState };
        return _emptyPanel;
    }

    private StackPanel BuildLoadingPanel()
    {
        var panel = new StackPanel
        {
            Spacing = 8,
            Padding = new Thickness(32),
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        panel.Children.Add(new ProgressRing { IsActive = true, Width = 28, Height = 28 });
        panel.Children.Add(_loadingText);
        return panel;
    }

    private StackPanel BuildArtifactSection()
    {
        _artifactSection.Children.Add(BuildStatGrid());
        _artifactSection.Children.Add(BuildDetailsPanel());
        _artifactSection.Children.Add(_artifactErrorBanner);
        _artifactSection.Children.Add(BuildDownloadPanel());
        return _artifactSection;
    }

    private Grid BuildStatGrid()
    {
        var grid = new Grid { ColumnSpacing = 16 };
        for (int i = 0; i < 4; i++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        var statusBody = new StackPanel { Spacing = 8 };
        statusBody.Children.Add(_statusCaption);
        _statusBadge.Content = _statusBadgeText;
        _statusBadge.HorizontalAlignment = HorizontalAlignment.Left;
        statusBody.Children.Add(_statusBadge);

        var statusPanel = new TsGlassPanel
        {
            Content = new Border { Padding = new Thickness(16), Child = statusBody },
        };

        AddColumn(grid, 0, statusPanel);
        AddColumn(grid, 1, _formatCard);
        AddColumn(grid, 2, _sizeCard);
        AddColumn(grid, 3, _storageCard);
        return grid;
    }

    private TsGlassPanel BuildDetailsPanel()
    {
        var body = new StackPanel { Spacing = 16 };
        body.Children.Add(_metaTitle);
        body.Children.Add(_metaRowsPanel);
        return new TsGlassPanel { Content = new Border { Padding = new Thickness(24), Child = body } };
    }

    private TsGlassPanel BuildDownloadPanel()
    {
        _downloadGroup.Children.Add(_downloadHint);
        _downloadButton.HorizontalAlignment = HorizontalAlignment.Left;
        _downloadGroup.Children.Add(_downloadButton);

        var body = new StackPanel { Spacing = 12 };
        body.Children.Add(_downloadTitle);
        body.Children.Add(_downloadGroup);
        body.Children.Add(_downloadCaption);

        return new TsGlassPanel { Content = new Border { Padding = new Thickness(24), Child = body } };
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

    private void Render(GDPRExportDisplay display)
    {
        _suppressEvents = true;

        _title.Value = display.Title;
        _subtitle.Value = display.Subtitle;
        AutomationProperties.SetName(this, display.AutomationName);
        _copyLabel = display.CopyLabel;
        _copiedLabel = display.CopiedLabel;
        _launchUri = display.DownloadLaunchUri;

        // ── Panel 1: lookup ──
        _lookupTitle.Value = display.LookupTitle;
        _idLabel.Value = display.IdLabel;
        _idInput.Hint = display.IdPlaceholder; // parity:allow input-hint placeholder text mirroring the web idPlaceholder, not a stub
        _lookupButton.Text = display.LookupButtonLabel;
        _lookupButton.IsEnabled = display.LookupEnabled;
        _lookupHint.Value = display.LookupHint;
        AutomationProperties.SetName(_idInput, display.IdLabel);
        if (_idInput.FocusState == FocusState.Unfocused && _idInput.Text != display.IdValue)
        {
            _idInput.Text = display.IdValue;
        }

        // ── Banners ──
        _subsystemBanner.IsOpen = display.ShowSubsystemUnavailable;
        _subsystemBanner.Title = display.SubsystemTitle;
        _subsystemBanner.Message = display.SubsystemMessage;

        _notFoundBanner.IsOpen = display.ShowNotFound;
        _notFoundBanner.Title = display.NotFoundTitle;
        _notFoundBanner.Message = display.NotFoundMessage;

        // ── Panel 2: empty ──
        _emptyPanel.Visibility = Show(display.ShowEmpty);
        _emptyState.Title = display.EmptyTitle;
        _emptyState.Message = display.EmptyMessage;

        // ── Loading + error surfaces ──
        _loadingPanel.Visibility = Show(display.ShowLoading);
        _loadingText.Value = display.LoadingText;

        _errorState.Visibility = Show(display.ShowError);
        _errorState.Message = display.ErrorText;
        _errorState.ActionText = display.RetryLabel;

        // ── Artifact section ──
        _artifactSection.Visibility = Show(display.ShowArtifact);

        _statusCaption.Value = display.StatusLabel;
        _statusBadgeText.Text = display.StatusText;
        _statusBadge.Status = display.StatusVariant;
        AutomationProperties.SetName(_statusBadge, $"{display.StatusLabel}: {display.StatusText}");

        ApplyStatCard(_formatCard, display.FormatLabel, display.FormatValue);
        ApplyStatCard(_sizeCard, display.BytesLabel, display.BytesValue);
        ApplyStatCard(_storageCard, display.StorageLabel, display.StorageValue);

        _metaTitle.Value = display.MetaTitle;
        RebuildMeta(display);

        _artifactErrorBanner.IsOpen = display.ShowArtifactError;
        _artifactErrorBanner.Title = display.ArtifactErrorTitle;
        _artifactErrorBanner.Message = display.ArtifactErrorText;

        _downloadTitle.Value = display.DownloadTitle;
        _downloadGroup.Visibility = Show(display.ShowDownloadButton);
        _downloadHint.Value = display.DownloadHint;
        _downloadButton.Text = display.DownloadButtonLabel;
        _downloadButton.IsEnabled = display.ShowDownloadButton;
        _downloadCaption.Visibility = Show(display.ShowDownloadCaption);
        _downloadCaption.Value = display.DownloadCaptionText;

        _suppressEvents = false;
    }

    private void RebuildMeta(GDPRExportDisplay display)
    {
        _metaRowsPanel.Children.Clear();
        if (!display.ShowArtifact)
        {
            return;
        }

        _metaRowsPanel.Children.Add(BuildMetaRow(
            new GDPRMetaRow(display.IdRowLabel, display.IdRowValue, null, Copyable: true, Mono: true)));

        foreach (var row in display.MetaRows)
        {
            _metaRowsPanel.Children.Add(BuildMetaRow(row));
        }
    }

    private StackPanel BuildMetaRow(GDPRMetaRow row)
    {
        var cell = new StackPanel { Spacing = 4 };
        cell.Children.Add(new Label { Value = row.Label });

        var valueText = new TextBlock
        {
            Text = row.Value,
            FontSize = 13,
            TextWrapping = TextWrapping.Wrap,
            IsTextSelectionEnabled = true,
            VerticalAlignment = VerticalAlignment.Center,
            Foreground = Brush("TsColorTextPrimaryBrush"),
        };
        if (row.Mono && MonoFont is { } mono)
        {
            valueText.FontFamily = mono;
        }

        if (row.Copyable)
        {
            var line = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
            line.Children.Add(valueText);
            var copy = new TsCopyButton
            {
                ValueToCopy = row.Value,
                CopyLabel = _copyLabel,
                CopiedLabel = _copiedLabel,
                Variant = ButtonVariant.Subtle,
                Size = ControlSize.Small,
                VerticalAlignment = VerticalAlignment.Center,
            };
            AutomationProperties.SetName(copy, $"{_copyLabel} {row.Label}");
            line.Children.Add(copy);
            cell.Children.Add(line);
        }
        else
        {
            cell.Children.Add(valueText);
        }

        if (!string.IsNullOrEmpty(row.Relative))
        {
            cell.Children.Add(new Caption { Value = row.Relative });
        }

        return cell;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        _viewModel.NotifyOpened();
        await _viewModel.LoadAsync().ConfigureAwait(true);
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnRetryInvoked(object? sender, EventArgs e) => InvokeAsync(() => _viewModel.RefreshAsync());

    private void OnLookupClick(object sender, RoutedEventArgs e) => InvokeAsync(() => _viewModel.LookupAsync());

    private void OnIdTextChanged(object sender, TextChangedEventArgs e)
    {
        if (!_suppressEvents)
        {
            _viewModel.SetIdInput(_idInput.Text ?? string.Empty);
        }
    }

    private void OnIdKeyDown(object sender, KeyRoutedEventArgs e)
    {
        if (e.Key == Windows.System.VirtualKey.Enter)
        {
            e.Handled = true;
            InvokeAsync(() => _viewModel.LookupAsync());
        }
    }

    private void OnDownloadClick(object sender, RoutedEventArgs e)
    {
        if (!string.IsNullOrEmpty(_launchUri) && Uri.TryCreate(_launchUri, UriKind.Absolute, out var uri))
        {
            _ = Windows.System.Launcher.LaunchUriAsync(uri);
        }
    }

    /// <summary>Unsubscribe from and dispose the view-model (CA1001; mirrors the sibling admin views).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private static void ApplyStatCard(TsStatCard card, string label, string value)
    {
        card.Label = label;
        card.Value = value;
    }

    private static void AddColumn(Grid grid, int column, FrameworkElement element)
    {
        element.HorizontalAlignment = HorizontalAlignment.Stretch;
        Grid.SetColumn(element, column);
        grid.Children.Add(element);
    }

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;

    private static async void InvokeAsync(Func<Task> action) => await action().ConfigureAwait(true);

    private static Brush? Brush(string key) =>
        Application.Current.Resources.TryGetValue(key, out var value) && value is Brush brush ? brush : null;

    private static FontFamily? MonoFont =>
        Application.Current.Resources.TryGetValue("TsTypeFontFamilyMono", out var value) && value is FontFamily family ? family : null;
}
