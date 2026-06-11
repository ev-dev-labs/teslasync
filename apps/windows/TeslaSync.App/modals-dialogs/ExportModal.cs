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

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// The native WinUI 3 <c>ExportModal</c> surface — a parity port of
/// web/src/features/dashboard/components/ExportModal.tsx. It presents a <see cref="TsModal"/> ("Export Dashboard")
/// whose body stacks the web layout: a summary row (a layout preview, the dashboard name, a widget-count + JSON-size
/// badge pair, and the "Updated {{date}}" caption) above the three export actions — a primary "Download JSON File"
/// button, a "Copy to Clipboard" copy button over the pretty JSON, and a "Copy Shareable URL" copy button that is
/// disabled once the encoded link exceeds 2000 characters — with a warning banner surfacing that same limit. The
/// web component is controlled and presentational (it has no query), so this surface has no loading / stale /
/// offline / error branch; its only conditional surfaces — the URL-too-long warning and the disabled share button —
/// are reproduced. The view performs no work itself: download and dismiss are routed to the host through the
/// <see cref="DownloadRequested"/> and <see cref="Closed"/> events (web <c>onDownload</c> / <c>onClose</c>), exactly
/// as the web parent owns those props. Every string resolves through the i18n facade, every interactive element
/// carries a Narrator name, and the surface adds no bespoke motion so reduced-motion is honoured by construction.
/// </summary>
public sealed partial class ExportModal : ContentControl, IDisposable
{
    private const double BodyMinWidth = 360;
    private const double BodyMaxHeight = 600;
    private const double BodySpacing = 20;
    private const double SummarySpacing = 16;
    private const double TextColumnSpacing = 6;
    private const double OptionSpacing = 8;
    private const double BadgeSpacing = 8;
    private const double PreviewWidth = 128;
    private const double TileMargin = 1;

    private readonly ExportModalViewModel _viewModel;
    private readonly DispatcherQueue? _dispatcher;
    private readonly StackPanel _body = new() { Spacing = BodySpacing, MinWidth = BodyMinWidth };

    private TsModal? _dialog;
    private bool _started;
    private bool _shown;
    private bool _closeRaised;
    private bool _disposed;

    /// <summary>Creates the surface over the dashboard prop, share origin, localizer, date formatter and diagnostics.</summary>
    /// <param name="dashboard">The dashboard to export (the web <c>dashboard</c> prop).</param>
    /// <param name="shareOrigin">The web app origin the share deep link targets (web <c>window.location.origin</c>).</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="dateFormatter">The date-formatting seam for the updated caption (web <c>useDateFormat</c>).</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics sink.</param>
    public ExportModal(
        SavedDashboardSnapshot dashboard,
        string shareOrigin,
        ILocalizer localizer,
        IExportDateFormatter dateFormatter,
        ExportModalDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(dashboard);
        ArgumentNullException.ThrowIfNull(shareOrigin);
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(dateFormatter);

        _viewModel = new ExportModalViewModel(dashboard, shareOrigin, localizer, dateFormatter, diagnostics);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;
        AutomationProperties.SetAutomationId(this, "export-modal");
        AutomationProperties.SetName(this, _viewModel.Title);

        BuildBody();
        Content = _body;

        _viewModel.DownloadRequested += OnViewModelDownloadRequested;
        _viewModel.CloseRequested += OnViewModelCloseRequested;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
    }

    /// <summary>Creates the surface with the default <see cref="SystemExportDateFormatter"/>.</summary>
    /// <param name="dashboard">The dashboard to export (the web <c>dashboard</c> prop).</param>
    /// <param name="shareOrigin">The web app origin the share deep link targets.</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics sink.</param>
    public ExportModal(
        SavedDashboardSnapshot dashboard,
        string shareOrigin,
        ILocalizer localizer,
        ExportModalDiagnostics? diagnostics = null)
        : this(dashboard, shareOrigin, localizer, new SystemExportDateFormatter(), diagnostics)
    {
    }

    /// <summary>Raised when the user picks "Download JSON File" (web <c>onDownload</c>): the host persists the JSON.</summary>
    public event EventHandler<ExportDownloadRequest>? DownloadRequested;

    /// <summary>Raised once the modal has closed (web <c>onClose</c>): a download or a dismiss.</summary>
    public event EventHandler? Closed;

    /// <summary>The canonical surface slug (<c>ExportModal</c>).</summary>
    public static string SurfaceId => ExportModalRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public ExportModalViewModel ViewModel => _viewModel;

    /// <summary>
    /// Present the modal over <paramref name="xamlRoot"/> (web <c>&lt;Modal open&gt;</c>). Idempotent: a second
    /// call while the dialog is showing is a no-op. Resolves when the modal has closed.
    /// </summary>
    public async Task ShowAsync(XamlRoot xamlRoot)
    {
        ArgumentNullException.ThrowIfNull(xamlRoot);
        if (_shown || _disposed)
        {
            return;
        }

        _shown = true;
        var dialog = new TsModal
        {
            Title = _viewModel.Title,
            CloseButtonText = _viewModel.CloseLabel,
            DefaultButton = ContentDialogButton.Close,
            XamlRoot = xamlRoot,
            Content = new ScrollViewer
            {
                Content = _body,
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                HorizontalScrollMode = ScrollMode.Disabled,
                MaxHeight = BodyMaxHeight,
            },
        };
        AutomationProperties.SetAutomationId(dialog, "export-modal-dialog");
        AutomationProperties.SetName(dialog, _viewModel.Title);
        dialog.CloseButtonClick += OnCloseButtonClick;
        dialog.Closed += OnDialogClosed;
        _dialog = dialog;

        try
        {
            await dialog.ShowAsync();
        }
        catch (COMException)
        {
            // Another ContentDialog is already open on this XamlRoot — the host owns ordering; surface nothing.
            _shown = false;
            _dialog = null;
        }
    }

    /// <summary>Detach from the view-model and dismiss the dialog (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.DownloadRequested -= OnViewModelDownloadRequested;
        _viewModel.CloseRequested -= OnViewModelCloseRequested;
        DismissDialog();
    }

    private void BuildBody()
    {
        _body.Children.Add(BuildSummary());
        _body.Children.Add(BuildOptions());
        _body.Children.Add(BuildWarning());
    }

    private Grid BuildSummary()
    {
        var grid = new Grid { ColumnSpacing = SummarySpacing };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var preview = BuildPreview();
        Grid.SetColumn(preview, 0);
        grid.Children.Add(preview);

        var text = new StackPanel { Spacing = TextColumnSpacing, VerticalAlignment = VerticalAlignment.Center };
        text.Children.Add(new PanelTitle { Value = _viewModel.DashboardName });
        text.Children.Add(BuildBadges());
        text.Children.Add(new Caption { Value = _viewModel.UpdatedLabel });
        Grid.SetColumn(text, 1);
        grid.Children.Add(text);

        return grid;
    }

    private Border BuildPreview()
    {
        var model = _viewModel.MiniGrid;
        var inner = new Grid();
        for (int c = 0; c < model.Columns; c++)
        {
            inner.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        for (int r = 0; r < model.Rows; r++)
        {
            inner.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        }

        foreach (var tile in model.Tiles)
        {
            var cell = new Border
            {
                Background = DisplayTokens.Surface,
                BorderBrush = DisplayTokens.Border,
                BorderThickness = new Thickness(1),
                CornerRadius = DisplayTokens.Radius("TsRadiusSm", 4),
                Margin = new Thickness(TileMargin),
            };
            Grid.SetColumn(cell, tile.Column);
            Grid.SetRow(cell, tile.Row);
            Grid.SetColumnSpan(cell, tile.ColumnSpan);
            Grid.SetRowSpan(cell, tile.RowSpan);
            inner.Children.Add(cell);
        }

        var border = new Border
        {
            Width = PreviewWidth,
            Height = PreviewWidth * model.Rows / model.Columns,
            VerticalAlignment = VerticalAlignment.Top,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            CornerRadius = DisplayTokens.Radius("TsRadiusLg", 8),
            Child = inner,
        };
        AutomationProperties.SetName(border, _viewModel.WidgetCountLabel);
        AutomationProperties.SetAccessibilityView(border, Microsoft.UI.Xaml.Automation.Peers.AccessibilityView.Raw);
        return border;
    }

    private StackPanel BuildBadges()
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = BadgeSpacing,
        };

        var countContent = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 4,
            VerticalAlignment = VerticalAlignment.Center,
        };
        countContent.Children.Add(new FontIcon { Glyph = ExportModalRegistration.PackageGlyph, FontSize = 12 });
        countContent.Children.Add(new TextBlock { Text = _viewModel.WidgetCountLabel });

        var countBadge = new TsBadge { Status = StatusKind.Neutral, Content = countContent };
        AutomationProperties.SetName(countBadge, _viewModel.WidgetCountLabel);

        var sizeBadge = new TsBadge { Status = StatusKind.Neutral, Content = _viewModel.JsonSizeLabel };
        AutomationProperties.SetName(sizeBadge, _viewModel.JsonSizeLabel);

        row.Children.Add(countBadge);
        row.Children.Add(sizeBadge);
        return row;
    }

    private StackPanel BuildOptions()
    {
        var options = new StackPanel { Spacing = OptionSpacing };

        var download = new TsButton
        {
            Variant = ButtonVariant.Primary,
            Size = ControlSize.Medium,
            Text = _viewModel.DownloadLabel,
            IconGlyph = ExportModalRegistration.DownloadGlyph,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };
        AutomationProperties.SetName(download, _viewModel.DownloadLabel);
        AutomationProperties.SetAutomationId(download, "export-modal-download");
        download.Click += OnDownloadClick;

        var copyJson = new TsCopyButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Medium,
            ValueToCopy = _viewModel.DashboardJson,
            CopyLabel = _viewModel.CopyClipboardLabel,
            CopiedLabel = _viewModel.CopiedLabel,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };
        AutomationProperties.SetName(copyJson, _viewModel.CopyClipboardLabel);
        AutomationProperties.SetAutomationId(copyJson, "export-modal-copy-json");

        var copyUrl = new TsCopyButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Medium,
            ValueToCopy = _viewModel.ShareUrl,
            CopyLabel = _viewModel.CopyShareUrlLabel,
            CopiedLabel = _viewModel.UrlCopiedLabel,
            IsEnabled = _viewModel.CanCopyShareUrl,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };
        AutomationProperties.SetName(copyUrl, _viewModel.CopyShareUrlLabel);
        AutomationProperties.SetAutomationId(copyUrl, "export-modal-copy-url");

        options.Children.Add(download);
        options.Children.Add(copyJson);
        options.Children.Add(copyUrl);
        return options;
    }

    private TsInlineCallout BuildWarning()
    {
        var warning = new TsInlineCallout
        {
            Variant = CalloutVariant.Warning,
            Message = _viewModel.ShareErrorMessage ?? string.Empty,
            Visibility = _viewModel.HasShareError ? Visibility.Visible : Visibility.Collapsed,
        };
        AutomationProperties.SetAutomationId(warning, "export-modal-url-warning");
        return warning;
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _viewModel.NotifyOpened();
        if (XamlRoot is { } xamlRoot)
        {
            _ = ShowAsync(xamlRoot);
        }
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnDownloadClick(object sender, RoutedEventArgs e)
    {
        // web handleDownload: onDownload(); onClose();
        _viewModel.RequestDownload();
        _viewModel.RequestClose();
    }

    private void OnCloseButtonClick(ContentDialog sender, ContentDialogButtonClickEventArgs args) =>
        _viewModel.RequestClose();

    private void OnDialogClosed(ContentDialog sender, ContentDialogClosedEventArgs args)
    {
        sender.CloseButtonClick -= OnCloseButtonClick;
        sender.Closed -= OnDialogClosed;
        _dialog = null;
        RaiseClosed();
    }

    private void OnViewModelDownloadRequested(object? sender, ExportDownloadRequest request) =>
        Marshal(() => DownloadRequested?.Invoke(this, request));

    private void OnViewModelCloseRequested(object? sender, EventArgs e) => Marshal(DismissDialog);

    private void DismissDialog() => _dialog?.Hide();

    private void RaiseClosed()
    {
        if (_closeRaised)
        {
            return;
        }

        _closeRaised = true;
        Closed?.Invoke(this, EventArgs.Empty);
    }

    private void Marshal(DispatcherQueueHandler action)
    {
        if (_dispatcher is { } dispatcher && !dispatcher.HasThreadAccess)
        {
            dispatcher.TryEnqueue(action);
        }
        else
        {
            action();
        }
    }
}
