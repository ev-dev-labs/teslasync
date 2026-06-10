using System.Linq;
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
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using Windows.ApplicationModel.DataTransfer;
using Windows.Storage;
using Windows.Storage.Pickers;
using WinRT.Interop;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 SettingsExportImport surface — a parity port of
/// web/src/features/settings/components/SettingsExportImport.tsx. It reproduces the web "Backup &amp; Restore"
/// panel composition: a <see cref="TsFadeIn"/> (the web <c>FadeIn</c>) wrapping a <see cref="TsGlassPanel"/>
/// (the web <c>GlassPanel</c>) whose header pairs a cyan accent icon badge (the web <c>IconBox</c> +
/// <c>Database</c>) with the localized title and subtitle, followed by the export row (a helper line and the
/// Export JSON button, the web <c>handleExport</c>) and the import row. The import row renders one of the web's
/// branches: the drop zone / file picker (web idle / parsing), the inline error box (web <c>parseError</c>),
/// the dry-run preview with its per-section diff and Apply / Cancel (web <c>stage === 'preview'</c>), or the
/// applied per-section diff with Done (web <c>stage === 'applied'</c>). There is no loading / empty / stale /
/// offline branch because the web source has none — it is an action surface, not a data widget. All flow logic
/// and projection run through the shared <see cref="SettingsExportImportViewModel"/>; the view performs only the
/// file-system intake (drag-drop / picker / Downloads write) the platform requires. Every string resolves
/// through the i18n facade, the surface and each action carry Narrator names, the error box is an assertive
/// live region, and the fade honours reduce-motion.
/// </summary>
public sealed partial class SettingsExportImport : ContentControl, IDisposable
{
    private const double BadgeSize = 40;
    private const double IconGlyphSize = 20;
    private const double DropIconSize = 32;

    /// <summary>The Segoe Fluent "Save" / download glyph standing in for the web Lucide <c>Download</c> icon.</summary>
    public const string DownloadGlyph = "\uE74E";

    /// <summary>The Segoe Fluent "Upload" glyph standing in for the web Lucide <c>Upload</c> icon.</summary>
    public const string UploadGlyph = "\uE74A";

    /// <summary>The Segoe Fluent "Page" glyph standing in for the web Lucide <c>FileJson</c> drop-zone icon.</summary>
    public const string FileGlyph = "\uE7C3";

    /// <summary>The Segoe Fluent "Warning" glyph standing in for the web Lucide <c>AlertTriangle</c> icon.</summary>
    public const string WarningGlyph = "\uE7BA";

    private readonly ILocalizer _localizer;
    private readonly SettingsExportImportViewModel _viewModel;
    private readonly SettingsExportImportDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly InfoBar _toast = new()
    {
        IsOpen = false,
        IsClosable = true,
        Severity = InfoBarSeverity.Informational,
        Margin = new Thickness(0, 0, 0, 12),
    };

    private readonly TsFadeIn _fade = new();
    private readonly TsGlassPanel _panel = new();
    private readonly StackPanel _root = new();

    private readonly Border _badge = new();
    private readonly FontIcon _badgeIcon = new();
    private readonly Heading _title = new();
    private readonly Text _subtitle = new();

    private readonly PanelTitle _exportTitle = new();
    private readonly HelperText _exportHelp = new();
    private readonly TsButton _exportButton = new() { Variant = ButtonVariant.Primary, IconGlyph = DownloadGlyph };

    private readonly PanelTitle _importTitle = new();
    private readonly HelperText _importHelp = new();

    private readonly Border _dropzone = new();
    private readonly FontIcon _dropIcon = new();
    private readonly Text _dropPrompt = new();
    private readonly TsButton _chooseButton = new() { Variant = ButtonVariant.Subtle, IconGlyph = UploadGlyph };

    private readonly Border _errorBox = new();
    private readonly ErrorText _errorText = new();

    private readonly StackPanel _previewBox = new() { Spacing = 12, Visibility = Visibility.Collapsed };
    private readonly Text _previewHeader = new();
    private readonly HelperText _previewSummary = new();
    private readonly TsButton _changeFileButton = new() { Variant = ButtonVariant.Subtle };
    private readonly StackPanel _previewSectionList = new() { Spacing = 6 };
    private readonly TsButton _cancelButton = new() { Variant = ButtonVariant.Subtle };
    private readonly TsButton _applyButton = new() { Variant = ButtonVariant.Primary };

    private readonly StackPanel _appliedBox = new() { Spacing = 12, Visibility = Visibility.Collapsed };
    private readonly Text _appliedHeader = new();
    private readonly StackPanel _appliedSectionList = new() { Spacing = 6 };
    private readonly TsButton _doneButton = new() { Variant = ButtonVariant.Subtle };

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;
    private string? _announcedError;

    /// <summary>Creates the surface over its data source, download sink, the i18n facade and an optional diagnostics collector.</summary>
    /// <param name="source">The settings-backup data source (export / dry-run / apply).</param>
    /// <param name="downloader">The sink that writes an exported bundle to the Downloads folder.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector for the <c>view.opened</c> event.</param>
    public SettingsExportImport(
        ISettingsBackupSource source,
        ISettingsBundleDownloader downloader,
        ILocalizer localizer,
        SettingsExportImportDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(downloader);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new SettingsExportImportDiagnostics();
        _viewModel = new SettingsExportImportViewModel(source, downloader, localizer);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        BuildChrome();

        _exportButton.Click += OnExportClicked;
        _chooseButton.Click += OnChooseClicked;
        _changeFileButton.Click += OnResetClicked;
        _cancelButton.Click += OnResetClicked;
        _doneButton.Click += OnResetClicked;
        _applyButton.Click += OnApplyClicked;
        _dropzone.DragOver += OnDropzoneDragOver;
        _dropzone.DragLeave += OnDropzoneDragLeave;
        _dropzone.Drop += OnDropzoneDrop;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        _viewModel.ToastRequested += OnToastRequested;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The diagnostics surface slug this view registers under (<c>SettingsExportImport</c>).</summary>
    public static string Slug => SettingsExportImportRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public SettingsExportImportViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory wiring the contract-client-backed <see cref="SettingsBackupSource"/> and the durable
    /// <see cref="DownloadsFolderBundleDownloader"/>, unless explicit collaborators are supplied for hosting or
    /// tests.
    /// </summary>
    /// <param name="api">The generated contract client (for export / dry-run / apply).</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector for the <c>view.opened</c> event.</param>
    /// <param name="downloader">Optional override for the download sink (durable Downloads-folder by default).</param>
    public static SettingsExportImport Create(
        IApiClient api,
        ILocalizer localizer,
        SettingsExportImportDiagnostics? diagnostics = null,
        ISettingsBundleDownloader? downloader = null)
    {
        ArgumentNullException.ThrowIfNull(api);
        return new SettingsExportImport(
            new SettingsBackupSource(api),
            downloader ?? new DownloadsFolderBundleDownloader(),
            localizer,
            diagnostics);
    }

    private void BuildChrome()
    {
        _panel.Padding = new Thickness(TypographyTokens.Size("TsSpaceXl", 20));

        BuildHeaderBadge();

        var titleStack = new StackPanel { Spacing = 4, VerticalAlignment = VerticalAlignment.Center };
        titleStack.Children.Add(_title);
        titleStack.Children.Add(_subtitle);

        var header = new Grid { ColumnSpacing = TypographyTokens.Size("TsSpaceMd", 12) };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetColumn(_badge, 0);
        Grid.SetColumn(titleStack, 1);
        header.Children.Add(_badge);
        header.Children.Add(titleStack);

        _root.Spacing = TypographyTokens.Size("TsSpaceXl", 20);
        _root.Children.Add(_toast);
        _root.Children.Add(header);
        _root.Children.Add(BuildExportRow());
        _root.Children.Add(BuildImportRow());

        _panel.Content = _root;
        _fade.Content = _panel;
        Content = _fade;
    }

    private void BuildHeaderBadge()
    {
        _badge.Width = BadgeSize;
        _badge.Height = BadgeSize;
        _badge.CornerRadius = DisplayTokens.Radius("TsRadiusSm", 8);
        _badge.BorderThickness = new Thickness(1);
        _badge.VerticalAlignment = VerticalAlignment.Top;
        _badge.HorizontalAlignment = HorizontalAlignment.Left;
        _badgeIcon.FontSize = IconGlyphSize;
        _badgeIcon.HorizontalAlignment = HorizontalAlignment.Center;
        _badgeIcon.VerticalAlignment = VerticalAlignment.Center;
        _badge.Child = _badgeIcon;
        AutomationProperties.SetAccessibilityView(_badge, AccessibilityView.Raw);
    }

    private Border BuildExportRow()
    {
        var textStack = new StackPanel { Spacing = 4, VerticalAlignment = VerticalAlignment.Center };
        textStack.Children.Add(_exportTitle);
        textStack.Children.Add(_exportHelp);

        _exportButton.VerticalAlignment = VerticalAlignment.Center;
        _exportButton.HorizontalAlignment = HorizontalAlignment.Right;

        var grid = new Grid { ColumnSpacing = TypographyTokens.Size("TsSpaceMd", 12) };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(textStack, 0);
        Grid.SetColumn(_exportButton, 1);
        grid.Children.Add(textStack);
        grid.Children.Add(_exportButton);

        return SectionBorder(grid);
    }

    private Border BuildImportRow()
    {
        var headerStack = new StackPanel { Spacing = 4 };
        headerStack.Children.Add(_importTitle);
        headerStack.Children.Add(_importHelp);

        BuildDropzone();
        BuildErrorBox();
        BuildPreviewBox();
        BuildAppliedBox();

        var body = new StackPanel { Spacing = 12 };
        body.Children.Add(headerStack);
        body.Children.Add(_dropzone);
        body.Children.Add(_errorBox);
        body.Children.Add(_previewBox);
        body.Children.Add(_appliedBox);

        return SectionBorder(body);
    }

    private void BuildDropzone()
    {
        // The web dashed border is approximated with a solid hairline + surface tint (WinUI Border has no
        // dashed stroke); the cyan drag-active tint is applied on DragOver for parity.
        _dropzone.CornerRadius = DisplayTokens.Radius("TsRadiusMd", 12);
        _dropzone.BorderThickness = new Thickness(2);
        _dropzone.BorderBrush = DisplayTokens.Border;
        _dropzone.Background = DisplayTokens.Surface;
        _dropzone.Padding = new Thickness(24);
        _dropzone.AllowDrop = true;

        _dropIcon.Glyph = FileGlyph;
        _dropIcon.FontSize = DropIconSize;
        _dropIcon.Foreground = DisplayTokens.TextMuted;
        _dropIcon.HorizontalAlignment = HorizontalAlignment.Center;
        AutomationProperties.SetAccessibilityView(_dropIcon, AccessibilityView.Raw);

        _dropPrompt.HorizontalAlignment = HorizontalAlignment.Center;
        _chooseButton.HorizontalAlignment = HorizontalAlignment.Center;

        var column = new StackPanel { Spacing = 8, HorizontalAlignment = HorizontalAlignment.Center };
        column.Children.Add(_dropIcon);
        column.Children.Add(_dropPrompt);
        column.Children.Add(_chooseButton);
        _dropzone.Child = column;
    }

    private void BuildErrorBox()
    {
        _errorBox.CornerRadius = DisplayTokens.Radius("TsRadiusSm", 8);
        _errorBox.BorderThickness = new Thickness(1);
        _errorBox.BorderBrush = TypographyTokens.Brush("TsColorDangerBrush");
        _errorBox.Padding = new Thickness(12);
        _errorBox.Visibility = Visibility.Collapsed;

        var icon = new FontIcon
        {
            Glyph = WarningGlyph,
            FontSize = 16,
            Foreground = TypographyTokens.Brush("TsColorDangerBrush"),
            VerticalAlignment = VerticalAlignment.Top,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        var row = new Grid { ColumnSpacing = 8 };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetColumn(icon, 0);
        Grid.SetColumn(_errorText, 1);
        row.Children.Add(icon);
        row.Children.Add(_errorText);

        _errorBox.Child = row;
        LiveRegion.Configure(_errorBox, assertive: true);
    }

    private void BuildPreviewBox()
    {
        var headerStack = new StackPanel { Spacing = 2 };
        headerStack.Children.Add(_previewHeader);
        headerStack.Children.Add(_previewSummary);

        _changeFileButton.VerticalAlignment = VerticalAlignment.Top;
        _changeFileButton.HorizontalAlignment = HorizontalAlignment.Right;

        var headerRow = new Grid { ColumnSpacing = 12 };
        headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(headerStack, 0);
        Grid.SetColumn(_changeFileButton, 1);
        headerRow.Children.Add(headerStack);
        headerRow.Children.Add(_changeFileButton);

        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        actions.Children.Add(_cancelButton);
        actions.Children.Add(_applyButton);

        _previewBox.Children.Add(headerRow);
        _previewBox.Children.Add(_previewSectionList);
        _previewBox.Children.Add(actions);
    }

    private void BuildAppliedBox()
    {
        var actions = new StackPanel { HorizontalAlignment = HorizontalAlignment.Right };
        actions.Children.Add(_doneButton);

        _appliedBox.Children.Add(_appliedHeader);
        _appliedBox.Children.Add(_appliedSectionList);
        _appliedBox.Children.Add(actions);
    }

    private static Border SectionBorder(UIElement child) => new()
    {
        BorderThickness = new Thickness(0, 1, 0, 0),
        BorderBrush = DisplayTokens.Border,
        Padding = new Thickness(0, 16, 0, 0),
        Child = child,
    };

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _diagnostics.RecordViewOpened();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Detach from the view-model and the action handlers (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _exportButton.Click -= OnExportClicked;
        _chooseButton.Click -= OnChooseClicked;
        _changeFileButton.Click -= OnResetClicked;
        _cancelButton.Click -= OnResetClicked;
        _doneButton.Click -= OnResetClicked;
        _applyButton.Click -= OnApplyClicked;
        _dropzone.DragOver -= OnDropzoneDragOver;
        _dropzone.DragLeave -= OnDropzoneDragLeave;
        _dropzone.Drop -= OnDropzoneDrop;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.ToastRequested -= OnToastRequested;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        GC.SuppressFinalize(this);
    }

    private void OnExportClicked(object sender, RoutedEventArgs e) => _ = _viewModel.ExportAsync();

    private void OnApplyClicked(object sender, RoutedEventArgs e) => _ = _viewModel.ApplyAsync();

    private void OnResetClicked(object sender, RoutedEventArgs e) => _viewModel.Reset();

    private async void OnChooseClicked(object sender, RoutedEventArgs e) => await PickAndIngestAsync();

    private void OnDropzoneDragOver(object sender, DragEventArgs e)
    {
        if (e.DataView.Contains(StandardDataFormats.StorageItems))
        {
            e.AcceptedOperation = DataPackageOperation.Copy;
            _dropzone.BorderBrush = TypographyTokens.Brush(ToolCardAccent.BrushKey(SettingsExportImportProjection.Accent))
                ?? DisplayTokens.Border;
        }
    }

    private void OnDropzoneDragLeave(object sender, DragEventArgs e) => _dropzone.BorderBrush = DisplayTokens.Border;

    private async void OnDropzoneDrop(object sender, DragEventArgs e)
    {
        _dropzone.BorderBrush = DisplayTokens.Border;
        if (!e.DataView.Contains(StandardDataFormats.StorageItems))
        {
            return;
        }

        var deferral = e.GetDeferral();
        try
        {
            var items = await e.DataView.GetStorageItemsAsync();
            if (items.OfType<StorageFile>().FirstOrDefault() is { } file)
            {
                await IngestStorageFileAsync(file);
            }
        }
        catch (Exception)
        {
            // A failed drop read must never crash the surface; the user can retry via the picker.
        }
        finally
        {
            deferral.Complete();
        }
    }

    private async Task PickAndIngestAsync()
    {
        var window = App.MainWindow;
        if (window is null)
        {
            return;
        }

        try
        {
            var picker = new FileOpenPicker { SuggestedStartLocation = PickerLocationId.DocumentsLibrary };
            picker.FileTypeFilter.Add(".json");
            InitializeWithWindow.Initialize(picker, WindowNative.GetWindowHandle(window));

            var file = await picker.PickSingleFileAsync();
            if (file is not null)
            {
                await IngestStorageFileAsync(file);
            }
        }
        catch (Exception)
        {
            // A cancelled / denied pick must never crash the surface.
        }
    }

    private async Task IngestStorageFileAsync(StorageFile file)
    {
        var properties = await file.GetBasicPropertiesAsync();
        long size = (long)properties.Size;
        await _viewModel.IngestAsync(
            file.Name,
            size,
            ct => FileIO.ReadTextAsync(file).AsTask(),
            CancellationToken.None);
    }

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        ScheduleRender();

    private void OnToastRequested(object? sender, SettingsToast toast) => Marshal(() => ApplyToast(toast));

    private void ApplyToast(SettingsToast toast)
    {
        _toast.Title = toast.Title;
        _toast.Message = toast.Detail;
        _toast.Severity = toast.IsError ? InfoBarSeverity.Error : InfoBarSeverity.Success;
        _toast.IsOpen = !string.IsNullOrEmpty(toast.Title);
    }

    private void ScheduleRender()
    {
        if (_renderQueued)
        {
            return;
        }

        _renderQueued = true;
        Marshal(RenderCoalesced);
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

    private void RenderCoalesced()
    {
        _renderQueued = false;
        Render();
    }

    private void Render()
    {
        SettingsExportImportDisplay display = _viewModel.Display;

        AutomationProperties.SetName(this, display.RegionName);
        _title.Value = display.Title;
        _subtitle.Value = display.Subtitle;
        ApplyAccent(display.Accent, display.Glyph);

        _exportTitle.Value = display.ExportTitle;
        _exportHelp.Value = display.ExportHelp;
        _exportButton.Text = display.ExportButtonText;
        _exportButton.IsLoading = display.ExportBusy;
        AutomationProperties.SetName(_exportButton, display.ExportButtonName);

        _importTitle.Value = display.ImportTitle;
        _importHelp.Value = display.ImportHelp;

        _dropzone.Visibility = display.ShowDropzone ? Visibility.Visible : Visibility.Collapsed;
        _dropPrompt.Value = display.DropPrompt;
        _chooseButton.Text = display.ChooseText;
        _chooseButton.IsLoading = display.IsParsing;
        AutomationProperties.SetName(_chooseButton, display.ChooseText);

        _errorBox.Visibility = display.HasError ? Visibility.Visible : Visibility.Collapsed;
        _errorText.Value = display.ErrorMessage ?? string.Empty;
        if (display.HasError)
        {
            AutomationProperties.SetName(_errorBox, display.ErrorMessage);
            AnnounceError(display.ErrorMessage);
        }
        else
        {
            _announcedError = null;
        }

        RenderPreview(display);
        RenderApplied(display);
    }

    private void RenderPreview(SettingsExportImportDisplay display)
    {
        _previewBox.Visibility = display.ShowPreview ? Visibility.Visible : Visibility.Collapsed;
        if (!display.ShowPreview)
        {
            _previewSectionList.Children.Clear();
            return;
        }

        _previewHeader.Value = display.PreviewHeader ?? string.Empty;
        _previewSummary.Value = display.SummaryText ?? string.Empty;
        _previewSummary.Visibility = string.IsNullOrEmpty(display.SummaryText) ? Visibility.Collapsed : Visibility.Visible;
        _changeFileButton.Text = display.ChangeFileText;
        AutomationProperties.SetName(_changeFileButton, display.ChangeFileText);

        _cancelButton.Text = display.CancelText;
        _cancelButton.IsEnabled = !display.IsApplying;
        AutomationProperties.SetName(_cancelButton, display.CancelText);

        _applyButton.Text = display.ApplyButtonText;
        _applyButton.IsLoading = display.IsApplying;
        _applyButton.IsEnabled = display.ApplyEnabled;
        AutomationProperties.SetName(_applyButton, display.ApplyButtonText);

        BuildSectionRows(_previewSectionList, display.SectionRows);
    }

    private void RenderApplied(SettingsExportImportDisplay display)
    {
        _appliedBox.Visibility = display.ShowApplied ? Visibility.Visible : Visibility.Collapsed;
        if (!display.ShowApplied)
        {
            _appliedSectionList.Children.Clear();
            return;
        }

        _appliedHeader.Value = display.AppliedHeader ?? string.Empty;
        _doneButton.Text = display.DoneText;
        AutomationProperties.SetName(_doneButton, display.DoneText);

        BuildSectionRows(_appliedSectionList, display.SectionRows);
    }

    private static void BuildSectionRows(StackPanel target, IReadOnlyList<SettingsImportSectionRow> rows)
    {
        target.Children.Clear();
        foreach (var row in rows)
        {
            var label = new TextBlock
            {
                Text = row.Label,
                FontFamily = TypographyTokens.Sans,
                FontSize = TypographyTokens.Size("TsTypeBodySmFontSize", 13),
                Foreground = TypographyTokens.Brush("TsColorTextPrimaryBrush"),
                VerticalAlignment = VerticalAlignment.Center,
                TextWrapping = TextWrapping.Wrap,
            };
            Grid.SetColumn(label, 0);

            FrameworkElement trailing;
            if (row.HasCounts)
            {
                var code = new Code { Value = row.CountsText, VerticalAlignment = VerticalAlignment.Center };
                trailing = code;
            }
            else
            {
                trailing = new TextBlock
                {
                    Text = SettingsExportImportProjection.SectionDash,
                    FontFamily = TypographyTokens.Sans,
                    FontSize = TypographyTokens.Size("TsTypeBodySmFontSize", 13),
                    Foreground = DisplayTokens.TextMuted,
                    VerticalAlignment = VerticalAlignment.Center,
                };
            }

            Grid.SetColumn(trailing, 1);

            var grid = new Grid { ColumnSpacing = 12 };
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            grid.Children.Add(label);
            grid.Children.Add(trailing);
            AutomationProperties.SetName(grid, $"{row.Label} {(row.HasCounts ? row.CountsText : SettingsExportImportProjection.SectionDash)}");

            target.Children.Add(grid);
        }
    }

    private void AnnounceError(string? message)
    {
        if (string.IsNullOrEmpty(message) || string.Equals(_announcedError, message, StringComparison.Ordinal))
        {
            return;
        }

        _announcedError = message;
        LiveRegion.Announce(_errorBox);
    }

    private void ApplyAccent(string accent, string glyph)
    {
        _badgeIcon.Glyph = glyph;

        Brush? brush = TypographyTokens.Brush(ToolCardAccent.BrushKey(accent));
        if (brush is SolidColorBrush solid)
        {
            _badgeIcon.Foreground = solid;
            Windows.UI.Color c = solid.Color;
            _badge.Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0x1A, c.R, c.G, c.B));
            _badge.BorderBrush = new SolidColorBrush(Windows.UI.Color.FromArgb(0x33, c.R, c.G, c.B));
        }
        else if (brush is not null)
        {
            _badgeIcon.Foreground = brush;
        }
    }
}

/// <summary>
/// The durable <see cref="ISettingsBundleDownloader"/> for the Windows app: it writes the exported bundle into
/// the user's Downloads folder via <see cref="DownloadsFolder"/>, the native analogue of the web blob download
/// that "drops the JSON into the user's downloads folder" (web/src/api/hooks/useSettingsBackup.ts). A name
/// collision is resolved by uniquifying rather than overwriting. This sink touches only the chosen file.
/// </summary>
public sealed class DownloadsFolderBundleDownloader : ISettingsBundleDownloader
{
    /// <inheritdoc />
    public async Task<string> SaveAsync(string filename, string json, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(filename);
        ArgumentNullException.ThrowIfNull(json);

        StorageFile file = await DownloadsFolder
            .CreateFileAsync(filename, CreationCollisionOption.GenerateUniqueName)
            .AsTask(cancellationToken)
            .ConfigureAwait(true);
        await FileIO.WriteTextAsync(file, json).AsTask(cancellationToken).ConfigureAwait(true);
        return file.Name;
    }
}
