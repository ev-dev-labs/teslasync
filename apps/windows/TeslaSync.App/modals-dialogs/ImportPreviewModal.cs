using System.Runtime.InteropServices;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Windows.ApplicationModel.DataTransfer;
using Windows.Storage;
using Windows.Storage.Pickers;
using Windows.UI.Text;
using WinRT.Interop;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// The native WinUI 3 <c>ImportPreviewModal</c> surface — a parity port of
/// web/src/features/dashboard/components/ImportPreviewModal.tsx. It presents a <see cref="TsModal"/> whose body
/// switches between two modes. In <em>input</em> mode it shows a three-tab navigator — "From File" (a
/// drag-and-drop zone plus a Browse button backed by a <c>.json</c> file picker), "Paste JSON" (a monospace
/// text area + Validate &amp; Preview) and "From URL" (a share-link field + Load from URL) — with a transient
/// parse-error callout beneath. In <em>preview</em> mode it shows the validation errors / warnings, the
/// validated dashboard's summary (a <see cref="MiniGridPreview"/> thumbnail, its name and the
/// available / skipped widget-count badges) or a friendly "cannot preview" empty state, the
/// widget-availability list, and the Back / Import actions. The surface performs no network read (its only web
/// hook is <c>useTranslation</c>), so it has no loading / stale / offline branch. The view never validates,
/// decodes URLs or touches the file system itself — it binds the shared
/// <see cref="ImportPreviewModalViewModel"/> and reads file text through the
/// <see cref="IImportFilePicker"/> seam. Every string resolves through the i18n facade, every interactive
/// element carries a Narrator name, the callouts announce through live regions, and the only motion is the
/// shared <see cref="TsFadeIn"/> (which honours reduce-motion).
/// </summary>
public sealed partial class ImportPreviewModal : ContentControl, IDisposable
{
    private const double BodyMinWidth = 460;
    private const double BodyMaxHeight = 560;
    private const double SectionSpacing = 16;
    private const double GroupSpacing = 12;
    private const double RowSpacing = 8;
    private const double DropZonePadding = 28;
    private const double DropIconSize = 28;
    private const double PreviewThumbnailWidth = 160;
    private const double WidgetListMaxHeight = 192;
    private const double RowIconSize = 14;
    private const string GlassBrushKey = "TsColorSurfaceGlassBrush";

    private readonly ImportPreviewModalViewModel _viewModel;
    private readonly DispatcherQueue? _dispatcher;
    private readonly string? _initialJson;
    private readonly CancellationTokenSource _cts = new();

    private readonly Grid _body = new() { MinWidth = BodyMinWidth };
    private readonly StackPanel _inputPanel = new() { Spacing = SectionSpacing };
    private readonly StackPanel _previewPanel = new() { Spacing = SectionSpacing };

    private readonly TsTabs _tabs = new();
    private readonly TabViewItem _fileTab = new() { IsClosable = false };
    private readonly TabViewItem _pasteTab = new() { IsClosable = false };
    private readonly TabViewItem _urlTab = new() { IsClosable = false };
    private readonly Border _dropZone = new();
    private readonly TsButton _browseButton = new() { Variant = ButtonVariant.Subtle };
    private readonly TsTextarea _pasteBox = new() { MinHeight = 180 };
    private readonly TsButton _validateButton = new() { Variant = ButtonVariant.Primary };
    private readonly TsInput _urlBox = new();
    private readonly TsButton _loadButton = new() { Variant = ButtonVariant.Primary };
    private readonly TsInlineCallout _parseErrorBar = new() { Variant = CalloutVariant.Danger, IsOpen = false };

    private readonly TsInlineCallout _errorBar = new() { Variant = CalloutVariant.Danger, IsOpen = false };
    private readonly TsInlineCallout _warningBar = new() { Variant = CalloutVariant.Warning, IsOpen = false };
    private readonly StackPanel _dashboardContent = new() { Spacing = SectionSpacing };
    private readonly MiniGridPreview _miniGrid;
    private readonly PanelTitle _dashboardName = new();
    private readonly TsBadge _availableBadge = new() { Status = StatusKind.Neutral };
    private readonly TsBadge _missingBadge = new() { Status = StatusKind.Neutral };
    private readonly Label _widgetsHeader = new();
    private readonly StackPanel _widgetList = new() { Spacing = 6 };
    private readonly TsEmptyState _emptyState = new();
    private readonly TsButton _backButton = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small };
    private readonly TsButton _confirmButton = new() { Variant = ButtonVariant.Primary, Size = ControlSize.Small };

    private TsModal? _dialog;
    private bool _started;
    private bool _shown;
    private bool _closeRaised;
    private bool _disposed;

    /// <summary>Creates the surface over its file-picker seam, localizer, identity seam and (optional) diagnostics.</summary>
    /// <param name="filePicker">The browse-for-file port (web file input + <c>file.text()</c>).</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="identity">The id/timestamp seam the validator uses; defaults to <see cref="SystemImportIdentity.Shared"/>.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics sink.</param>
    /// <param name="initialJson">Pre-filled JSON (web <c>initialJson</c>) auto-validated on open, or null.</param>
    public ImportPreviewModal(
        IImportFilePicker filePicker,
        ILocalizer localizer,
        IImportIdentity? identity = null,
        ImportPreviewDiagnostics? diagnostics = null,
        string? initialJson = null)
    {
        ArgumentNullException.ThrowIfNull(filePicker);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new ImportPreviewModalViewModel(filePicker, localizer, identity, diagnostics);
        _initialJson = initialJson;
        _dispatcher = DispatcherQueue.GetForCurrentThread();
        _miniGrid = new MiniGridPreview(localizer) { Width = PreviewThumbnailWidth };

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;
        AutomationProperties.SetAutomationId(this, "import-preview-modal");
        AutomationProperties.SetName(this, _viewModel.Title);

        BuildInputPanel();
        BuildPreviewPanel();
        _body.Children.Add(_inputPanel);
        _body.Children.Add(_previewPanel);
        Content = new Grid();

        ApplyMode();
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        _viewModel.Confirmed += OnViewModelConfirmed;
        _viewModel.CloseRequested += OnViewModelCloseRequested;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
    }

    /// <summary>Raised with the validated dashboard when the user confirms the import (web <c>onConfirm</c>).</summary>
    public event EventHandler<ImportedDashboard>? Confirmed;

    /// <summary>Raised when the modal has closed (web <c>onClose</c>): confirm or dismiss.</summary>
    public event EventHandler? Closed;

    /// <summary>The canonical surface slug (<c>ImportPreviewModal</c>).</summary>
    public static string SurfaceId => ImportPreviewRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public ImportPreviewModalViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory wiring the concrete window-backed <see cref="WindowImportFilePicker"/> (the native
    /// analogue of the web hidden file input). The host supplies the localizer + (optional) identity,
    /// diagnostics and pre-filled <paramref name="initialJson"/>.
    /// </summary>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="identity">The id/timestamp seam the validator uses, or null for the system default.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics sink.</param>
    /// <param name="initialJson">Pre-filled JSON (web <c>initialJson</c>) auto-validated on open, or null.</param>
    public static ImportPreviewModal Create(
        ILocalizer localizer,
        IImportIdentity? identity = null,
        ImportPreviewDiagnostics? diagnostics = null,
        string? initialJson = null) =>
        new(new WindowImportFilePicker(), localizer, identity, diagnostics, initialJson);

    /// <summary>
    /// Present the modal over <paramref name="xamlRoot"/> (web <c>&lt;Modal open&gt;</c>). Idempotent: a second
    /// call while the dialog is showing is a no-op. Resolves when the modal has closed.
    /// </summary>
    /// <param name="xamlRoot">The root to host the dialog over.</param>
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
        AutomationProperties.SetAutomationId(dialog, "import-preview-modal-dialog");
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

    /// <summary>Detach from the view-model, dismiss the dialog and cancel in-flight work (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Confirmed -= OnViewModelConfirmed;
        _viewModel.CloseRequested -= OnViewModelCloseRequested;
        _cts.Cancel();
        _cts.Dispose();
        DismissDialog();
        GC.SuppressFinalize(this);
    }

    // ── Input mode ───────────────────────────────────────────────────────────────────────────────────────

    private void BuildInputPanel()
    {
        BuildFileTab();
        BuildPasteTab();
        BuildUrlTab();

        _tabs.TabItems.Add(_fileTab);
        _tabs.TabItems.Add(_pasteTab);
        _tabs.TabItems.Add(_urlTab);
        _tabs.SelectionChanged += OnTabSelectionChanged;
        AutomationProperties.SetName(_tabs, _viewModel.Title);

        AutomationProperties.SetAutomationId(_parseErrorBar, "import-preview-parse-error");

        _inputPanel.Children.Add(_tabs);
        _inputPanel.Children.Add(_parseErrorBar);
    }

    private void BuildFileTab()
    {
        _fileTab.Header = _viewModel.TabFileLabel;

        var column = new StackPanel
        {
            Orientation = Orientation.Vertical,
            Spacing = GroupSpacing,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        column.Children.Add(new FontIcon
        {
            Glyph = ImportPreviewRegistration.UploadGlyph,
            FontSize = DropIconSize,
            Foreground = DisplayTokens.TextMuted,
            HorizontalAlignment = HorizontalAlignment.Center,
        });
        column.Children.Add(new Text
        {
            Value = _viewModel.DropFileText,
            Foreground = DisplayTokens.TextSecondary,
            HorizontalContentAlignment = HorizontalAlignment.Center,
        });

        _browseButton.Text = _viewModel.BrowseLabel;
        _browseButton.IconGlyph = ImportPreviewRegistration.BrowseGlyph;
        AutomationProperties.SetName(_browseButton, _viewModel.BrowseLabel);
        AutomationProperties.SetAutomationId(_browseButton, "import-preview-browse");
        _browseButton.Click += OnBrowseClicked;
        column.Children.Add(_browseButton);

        _dropZone.Background = DisplayTokens.Brush(GlassBrushKey);
        _dropZone.BorderBrush = DisplayTokens.Border;
        _dropZone.BorderThickness = new Thickness(1);
        _dropZone.CornerRadius = new CornerRadius(12);
        _dropZone.Padding = new Thickness(DropZonePadding);
        _dropZone.AllowDrop = true;
        _dropZone.Child = column;
        _dropZone.DragOver += OnDropZoneDragOver;
        _dropZone.DragLeave += OnDropZoneDragLeave;
        _dropZone.Drop += OnDropZoneDrop;
        AutomationProperties.SetName(_dropZone, _viewModel.FileInputLabel);
        AutomationProperties.SetAutomationId(_dropZone, "import-preview-dropzone");

        _fileTab.Content = new TsFadeIn { Content = _dropZone };
    }

    private void BuildPasteTab()
    {
        _pasteTab.Header = _viewModel.TabPasteLabel;

        _pasteBox.Hint = _viewModel.PasteHint;
        _pasteBox.FontFamily = MonospaceFont();
        AutomationProperties.SetName(_pasteBox, _viewModel.TabPasteLabel);
        AutomationProperties.SetAutomationId(_pasteBox, "import-preview-paste");
        _pasteBox.TextChanged += OnPasteTextChanged;

        _validateButton.Text = _viewModel.ValidateLabel;
        _validateButton.IconGlyph = ImportPreviewRegistration.ValidateGlyph;
        _validateButton.IsEnabled = _viewModel.CanValidatePasted;
        AutomationProperties.SetName(_validateButton, _viewModel.ValidateLabel);
        AutomationProperties.SetAutomationId(_validateButton, "import-preview-validate");
        _validateButton.Click += OnValidateClicked;

        var column = new StackPanel { Spacing = GroupSpacing };
        column.Children.Add(_pasteBox);
        column.Children.Add(_validateButton);
        _pasteTab.Content = new TsFadeIn { Content = column };
    }

    private void BuildUrlTab()
    {
        _urlTab.Header = _viewModel.TabUrlLabel;

        _urlBox.Hint = _viewModel.UrlHint;
        AutomationProperties.SetName(_urlBox, _viewModel.TabUrlLabel);
        AutomationProperties.SetAutomationId(_urlBox, "import-preview-url");
        _urlBox.TextChanged += OnUrlTextChanged;

        var field = new Grid();
        field.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        field.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        var linkIcon = new FontIcon
        {
            Glyph = ImportPreviewRegistration.LinkGlyph,
            FontSize = RowIconSize,
            Foreground = DisplayTokens.TextMuted,
            Margin = new Thickness(0, 0, RowSpacing, 0),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(linkIcon, AccessibilityView.Raw);
        Grid.SetColumn(linkIcon, 0);
        Grid.SetColumn(_urlBox, 1);
        field.Children.Add(linkIcon);
        field.Children.Add(_urlBox);

        _loadButton.Text = _viewModel.LoadUrlLabel;
        _loadButton.IsEnabled = _viewModel.CanLoadUrl;
        AutomationProperties.SetName(_loadButton, _viewModel.LoadUrlLabel);
        AutomationProperties.SetAutomationId(_loadButton, "import-preview-load");
        _loadButton.Click += OnLoadClicked;

        var column = new StackPanel { Spacing = GroupSpacing };
        column.Children.Add(field);
        column.Children.Add(_loadButton);
        _urlTab.Content = new TsFadeIn { Content = column };
    }

    // ── Preview mode ─────────────────────────────────────────────────────────────────────────────────────

    private void BuildPreviewPanel()
    {
        AutomationProperties.SetAutomationId(_errorBar, "import-preview-errors");
        AutomationProperties.SetAutomationId(_warningBar, "import-preview-warnings");

        var summary = new Grid { ColumnSpacing = SectionSpacing };
        summary.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        summary.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var thumbnail = new Border { Width = PreviewThumbnailWidth, Child = _miniGrid };
        Grid.SetColumn(thumbnail, 0);
        summary.Children.Add(thumbnail);

        var details = new StackPanel { Spacing = RowSpacing, VerticalAlignment = VerticalAlignment.Top };
        details.Children.Add(_dashboardName);

        var badges = new StackPanel { Orientation = Orientation.Horizontal, Spacing = RowSpacing };
        AutomationProperties.SetAutomationId(_availableBadge, "import-preview-available-badge");
        AutomationProperties.SetAutomationId(_missingBadge, "import-preview-missing-badge");
        badges.Children.Add(_availableBadge);
        badges.Children.Add(_missingBadge);
        details.Children.Add(badges);
        Grid.SetColumn(details, 1);
        summary.Children.Add(details);

        _widgetsHeader.Value = _viewModel.WidgetsHeader;

        var widgetScroll = new ScrollViewer
        {
            Content = _widgetList,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollMode = ScrollMode.Disabled,
            MaxHeight = WidgetListMaxHeight,
        };

        _dashboardContent.Children.Add(summary);
        _dashboardContent.Children.Add(_widgetsHeader);
        _dashboardContent.Children.Add(widgetScroll);

        _emptyState.Message = _viewModel.CannotPreviewMessage;
        AutomationProperties.SetAutomationId(_emptyState, "import-preview-empty");

        _backButton.Text = _viewModel.BackLabel;
        AutomationProperties.SetName(_backButton, _viewModel.BackLabel);
        AutomationProperties.SetAutomationId(_backButton, "import-preview-back");
        _backButton.Click += OnBackClicked;

        _confirmButton.Text = _viewModel.ConfirmLabel;
        _confirmButton.IconGlyph = ImportPreviewRegistration.AvailableGlyph;
        AutomationProperties.SetName(_confirmButton, _viewModel.ConfirmLabel);
        AutomationProperties.SetAutomationId(_confirmButton, "import-preview-confirm");
        _confirmButton.Click += OnConfirmClicked;

        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = RowSpacing,
            Margin = new Thickness(0, RowSpacing, 0, 0),
        };
        actions.Children.Add(_backButton);
        actions.Children.Add(_confirmButton);

        _previewPanel.Children.Add(_errorBar);
        _previewPanel.Children.Add(_warningBar);
        _previewPanel.Children.Add(new TsFadeIn { Content = _dashboardContent });
        _previewPanel.Children.Add(_emptyState);
        _previewPanel.Children.Add(actions);
    }

    private void RebuildWidgetList()
    {
        _widgetList.Children.Clear();
        foreach (ImportPreviewWidgetRow row in _viewModel.WidgetRows)
        {
            _widgetList.Children.Add(BuildWidgetRow(row));
        }
    }

    private Border BuildWidgetRow(ImportPreviewWidgetRow row)
    {
        var content = new Grid();
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var line = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = RowSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var status = new FontIcon
        {
            Glyph = row.Available ? ImportPreviewRegistration.AvailableGlyph : ImportPreviewRegistration.MissingGlyph,
            FontSize = RowIconSize,
            Foreground = DisplayTokens.Brush(row.Available ? "TsColorSuccessBrush" : "TsColorDangerBrush"),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(status, AccessibilityView.Raw);
        line.Children.Add(status);

        if (row.Available && row.IconGlyph is { } glyph)
        {
            var widgetIcon = new FontIcon
            {
                Glyph = glyph,
                FontSize = RowIconSize,
                Foreground = DisplayTokens.TextMuted,
                VerticalAlignment = VerticalAlignment.Center,
            };
            AutomationProperties.SetAccessibilityView(widgetIcon, AccessibilityView.Raw);
            line.Children.Add(widgetIcon);
        }

        var name = new TextBlock
        {
            Text = row.DisplayName,
            FontSize = TypographyTokenSize(),
            Foreground = row.Available ? DisplayTokens.TextSecondary : DisplayTokens.TextMuted,
            TextTrimming = TextTrimming.CharacterEllipsis,
            VerticalAlignment = VerticalAlignment.Center,
        };
        if (!row.Available)
        {
            name.TextDecorations = TextDecorations.Strikethrough;
        }

        line.Children.Add(name);
        Grid.SetColumn(line, 0);
        content.Children.Add(line);

        if (!row.Available)
        {
            var notAvailable = new TextBlock
            {
                Text = _viewModel.NotAvailableText,
                FontSize = TypographyTokenSize(),
                Foreground = DisplayTokens.Brush("TsColorDangerBrush"),
                VerticalAlignment = VerticalAlignment.Center,
                Margin = new Thickness(RowSpacing, 0, 0, 0),
            };
            Grid.SetColumn(notAvailable, 1);
            content.Children.Add(notAvailable);
        }

        var border = new Border
        {
            Background = DisplayTokens.Brush(GlassBrushKey),
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(8),
            Padding = new Thickness(12, 8, 12, 8),
            Child = content,
        };
        AutomationProperties.SetName(
            border,
            row.Available ? row.DisplayName : $"{row.DisplayName}. {_viewModel.NotAvailableText}");
        return border;
    }

    // ── View-model binding ───────────────────────────────────────────────────────────────────────────────

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        Marshal(() => ApplyViewModelState(e.PropertyName));

    private void ApplyViewModelState(string? propertyName)
    {
        switch (propertyName)
        {
            case nameof(ImportPreviewModalViewModel.HasValidation):
            case nameof(ImportPreviewModalViewModel.Title):
                ApplyMode();
                break;
            case nameof(ImportPreviewModalViewModel.HasParseError):
            case nameof(ImportPreviewModalViewModel.ParseErrorText):
                ApplyParseError();
                break;
            case nameof(ImportPreviewModalViewModel.CanValidatePasted):
                _validateButton.IsEnabled = _viewModel.CanValidatePasted;
                break;
            case nameof(ImportPreviewModalViewModel.CanLoadUrl):
                _loadButton.IsEnabled = _viewModel.CanLoadUrl;
                break;
            case nameof(ImportPreviewModalViewModel.PreviewModel):
                _miniGrid.Model = _viewModel.PreviewModel;
                break;
            default:
                break;
        }
    }

    private void ApplyMode()
    {
        bool preview = _viewModel.HasValidation;
        _inputPanel.Visibility = preview ? Visibility.Collapsed : Visibility.Visible;
        _previewPanel.Visibility = preview ? Visibility.Visible : Visibility.Collapsed;

        if (preview)
        {
            ApplyPreviewContent();
        }
        else
        {
            ApplyParseError();
        }

        if (_dialog is { } dialog)
        {
            dialog.Title = _viewModel.Title;
            AutomationProperties.SetName(dialog, _viewModel.Title);
        }

        AutomationProperties.SetName(this, _viewModel.Title);
    }

    private void ApplyPreviewContent()
    {
        ApplyCallout(_errorBar, _viewModel.HasErrors, _viewModel.ErrorLines);
        ApplyCallout(_warningBar, _viewModel.HasWarnings, _viewModel.WarningLines);

        bool hasDashboard = _viewModel.HasDashboard;
        _dashboardContent.Visibility = hasDashboard ? Visibility.Visible : Visibility.Collapsed;
        _emptyState.Visibility = hasDashboard ? Visibility.Collapsed : Visibility.Visible;

        if (hasDashboard)
        {
            _miniGrid.Model = _viewModel.PreviewModel;
            _dashboardName.Value = _viewModel.DashboardName;
            _availableBadge.Content = _viewModel.AvailableBadge;
            _missingBadge.Content = _viewModel.MissingBadge;
            _missingBadge.Visibility = _viewModel.ShowMissingBadge ? Visibility.Visible : Visibility.Collapsed;
            RebuildWidgetList();
        }

        _confirmButton.Visibility = _viewModel.CanConfirm ? Visibility.Visible : Visibility.Collapsed;
    }

    private void ApplyParseError()
    {
        _parseErrorBar.Message = _viewModel.ParseErrorText;
        _parseErrorBar.IsOpen = _viewModel.HasParseError;
    }

    private static void ApplyCallout(TsInlineCallout callout, bool visible, IReadOnlyList<string> lines)
    {
        callout.Message = visible ? string.Join('\n', lines) : string.Empty;
        callout.IsOpen = visible;
    }

    // ── Events ───────────────────────────────────────────────────────────────────────────────────────────

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _viewModel.NotifyOpened(_initialJson);
        if (XamlRoot is { } xamlRoot)
        {
            _ = ShowAsync(xamlRoot);
        }
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnTabSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        int index = _tabs.SelectedIndex;
        _viewModel.ActiveTab = index switch
        {
            1 => ImportPreviewTab.Paste,
            2 => ImportPreviewTab.Url,
            _ => ImportPreviewTab.File,
        };
    }

    private async void OnBrowseClicked(object sender, RoutedEventArgs e)
    {
        if (_disposed)
        {
            return;
        }

        await _viewModel.BrowseForFileAsync(_cts.Token);
    }

    private void OnPasteTextChanged(object sender, TextChangedEventArgs e) => _viewModel.PastedJson = _pasteBox.Text;

    private void OnUrlTextChanged(object sender, TextChangedEventArgs e) => _viewModel.ImportUrl = _urlBox.Text;

    private void OnValidateClicked(object sender, RoutedEventArgs e) => _viewModel.ValidatePasted();

    private void OnLoadClicked(object sender, RoutedEventArgs e) => _viewModel.LoadFromUrl();

    private void OnBackClicked(object sender, RoutedEventArgs e) => _viewModel.Back();

    private void OnConfirmClicked(object sender, RoutedEventArgs e) => _viewModel.Confirm();

    private void OnDropZoneDragOver(object sender, DragEventArgs e)
    {
        if (!e.DataView.Contains(StandardDataFormats.StorageItems))
        {
            return;
        }

        e.AcceptedOperation = DataPackageOperation.Copy;
        _viewModel.IsDragOver = true;
        _dropZone.BorderBrush = DisplayTokens.Accent;
    }

    private void OnDropZoneDragLeave(object sender, DragEventArgs e)
    {
        _viewModel.IsDragOver = false;
        _dropZone.BorderBrush = DisplayTokens.Border;
    }

    private async void OnDropZoneDrop(object sender, DragEventArgs e)
    {
        _viewModel.IsDragOver = false;
        _dropZone.BorderBrush = DisplayTokens.Border;
        if (_disposed || !e.DataView.Contains(StandardDataFormats.StorageItems))
        {
            return;
        }

        var deferral = e.GetDeferral();
        try
        {
            var items = await e.DataView.GetStorageItemsAsync();
            if (items.OfType<StorageFile>().FirstOrDefault() is not { } file)
            {
                return;
            }

            if (!_viewModel.TryAcceptDroppedFile(file.Name, file.ContentType))
            {
                return;
            }

            try
            {
                string text = await FileIO.ReadTextAsync(file);
                _viewModel.ImportFileText(text);
            }
            catch (Exception)
            {
                // web file.text() rejection → "Failed to read file"; never crash the surface.
                _viewModel.FailFileRead();
            }
        }
        catch (Exception)
        {
            // A failed drop read must never crash the surface; the user can retry via the picker.
            _viewModel.FailFileRead();
        }
        finally
        {
            deferral.Complete();
        }
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

    private void OnViewModelConfirmed(object? sender, ImportedDashboard dashboard) =>
        Marshal(() => Confirmed?.Invoke(this, dashboard));

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

    private static FontFamily MonospaceFont() =>
        Application.Current.Resources.TryGetValue("TsTypeFontFamilyMono", out object? value) && value is FontFamily font
            ? font
            : new FontFamily("Consolas");

    private static double TypographyTokenSize() =>
        Application.Current.Resources.TryGetValue("TsTypeBodySmFontSize", out object? value) && value is double size
            ? size
            : 12;

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

/// <summary>
/// The concrete, window-backed <see cref="IImportFilePicker"/> — the native analogue of the web modal's hidden
/// <c>&lt;input type="file" accept=".json"&gt;</c>. It opens a <see cref="FileOpenPicker"/> filtered to
/// <c>.json</c>, initialized with the main window handle (a WinUI 3 desktop requirement), and reads the chosen
/// file's text. A dismissed picker is <see cref="ImportFilePickOutcome.Cancelled"/>; a picker or read fault is
/// classified as <see cref="ImportFilePickOutcome.Failed"/> rather than thrown, so the view-model can surface
/// the web "Failed to read file" parse error.
/// </summary>
public sealed class WindowImportFilePicker : IImportFilePicker
{
    /// <inheritdoc />
    public async Task<ImportFilePick> PickJsonAsync(CancellationToken cancellationToken = default)
    {
        Window? window = App.MainWindow;
        if (window is null)
        {
            return ImportFilePick.Cancelled;
        }

        StorageFile? file;
        try
        {
            var picker = new FileOpenPicker { SuggestedStartLocation = PickerLocationId.DocumentsLibrary };
            picker.FileTypeFilter.Add(".json");
            InitializeWithWindow.Initialize(picker, WindowNative.GetWindowHandle(window));
            file = await picker.PickSingleFileAsync();
        }
        catch (Exception)
        {
            // A picker initialization / invocation fault must never crash the surface.
            return ImportFilePick.Failed;
        }

        if (file is null)
        {
            return ImportFilePick.Cancelled;
        }

        try
        {
            string text = await FileIO.ReadTextAsync(file);
            return ImportFilePick.Picked(text);
        }
        catch (Exception)
        {
            // web file.text() rejection → "Failed to read file".
            return ImportFilePick.Failed;
        }
    }
}
