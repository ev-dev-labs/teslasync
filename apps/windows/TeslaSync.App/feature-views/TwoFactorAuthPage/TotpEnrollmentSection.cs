using System.Collections.Generic;
using System.IO;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;
using Windows.Storage;
using Windows.Storage.Pickers;
using Windows.Storage.Streams;
using WinRT.Interop;

namespace TeslaSync.App.FeatureViews.Settings;

/// <summary>
/// The native WinUI 3 <c>TOTPEnrollmentSection</c> surface — a parity port of
/// web/src/features/settings/components/TOTPEnrollmentSection.tsx. It composes the web component's glass panel into
/// one tokenized <see cref="TsGlassPanel"/> whose body resolves to exactly one of the web render branches: a
/// loading row (spinner + "Loading two-factor settings…"), the open-mode forward-auth notice (amber icon + heading +
/// helper text), the not-enrolled state ("Not enrolled" pill + Enable-TOTP button + authenticator hint) or the
/// active state ("Active" pill + last-used + backup-codes-remaining + Regenerate / Disable). The three modal flows —
/// the enroll QR + manual-secret + 6-digit verify, the one-time backup-codes reveal, and the typed-confirmation
/// disable — are shown imperatively as Fluent <see cref="TsModal"/> / <see cref="TsConfirmDialog"/> surfaces, exactly
/// as the sibling feature-views do. All state flows through <see cref="TotpEnrollmentSectionViewModel"/>; the view
/// performs no HTTP and resolves every label through the i18n facade.
/// </summary>
public sealed partial class TotpEnrollmentSection : ContentControl, IDisposable
{
    private const string ShieldGlyph = "\uE72E";   // Segoe Fluent — Shield
    private const string WarningGlyph = "\uE7BA";  // Segoe Fluent — Warning
    private const string KeyGlyph = "\uE192";      // Segoe Fluent — Permissions (key)
    private const string RegenerateGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const string DisableGlyph = "\uE74D";  // Segoe Fluent — Delete
    private const string DownloadGlyph = "\uE896"; // Segoe Fluent — Download
    private const double PanelPadding = 24;        // web p-6
    private const double IconBoxSize = 40;
    private const double QrSize = 224;             // web width/height 224

    private readonly TotpEnrollmentSectionViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly TotpEnrollmentDiagnostics _diagnostics;
    private readonly TotpSectionStrings _strings;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _root = new() { Spacing = 16 };

    // Loading branch.
    private readonly StackPanel _loadingPanel = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 16,
        Visibility = Visibility.Collapsed,
    };

    private readonly Text _loadingText = new();

    // Open-mode branch.
    private readonly StackPanel _openModePanel = new() { Spacing = 12, Visibility = Visibility.Collapsed };
    private readonly Heading _openModeTitle = new();
    private readonly HelperText _openModeMessage = new();

    // Main branch (not-enrolled / active).
    private readonly StackPanel _mainPanel = new() { Spacing = 20, Visibility = Visibility.Collapsed };
    private readonly Border _mainIconBox;
    private readonly FontIcon _mainIcon = new() { FontSize = 20 };
    private readonly Heading _mainTitle = new();
    private readonly HelperText _mainSubtitle = new();
    private readonly TsBadge _statusBadge = new() { VerticalAlignment = VerticalAlignment.Center };

    // Not-enrolled sub-state.
    private readonly StackPanel _notEnrolledPanel = new() { Spacing = 8, Visibility = Visibility.Collapsed };
    private readonly TsButton _enrollButton = new()
    {
        Variant = ButtonVariant.Primary,
        Size = ControlSize.Small,
        IconGlyph = KeyGlyph,
        HorizontalAlignment = HorizontalAlignment.Left,
    };

    private readonly HelperText _enrollHint = new();

    // Active sub-state.
    private readonly StackPanel _activePanel = new() { Spacing = 12, Visibility = Visibility.Collapsed };
    private readonly Label _lastUsedLabel = new();
    private readonly Text _lastUsedValue = new();
    private readonly Label _backupRemainingLabel = new();
    private readonly Text _backupRemainingValue = new();
    private readonly TsButton _regenerateButton = new()
    {
        Variant = ButtonVariant.Subtle,
        Size = ControlSize.Small,
        IconGlyph = RegenerateGlyph,
    };

    private readonly TsButton _disableButton = new()
    {
        Variant = ButtonVariant.Destructive,
        Size = ControlSize.Small,
        IconGlyph = DisableGlyph,
    };

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the section over the inert open-mode controller and the shell localizer (the shell entry point).</summary>
    public TotpEnrollmentSection()
        : this(OpenModeTotpController.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the section over an explicit controller, localizer and optional diagnostics (tests / DI).</summary>
    /// <param name="controller">The status/enroll/verify/revoke/regenerate seam (web <c>useTOTP*</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector for the <c>view.opened</c> event.</param>
    public TotpEnrollmentSection(
        ITotpEnrollmentController controller,
        ILocalizer localizer,
        TotpEnrollmentDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(controller);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new TotpEnrollmentDiagnostics();
        _viewModel = new TotpEnrollmentSectionViewModel(controller, localizer);
        _strings = _viewModel.Strings;
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        _mainIconBox = new Border
        {
            Width = IconBoxSize,
            Height = IconBoxSize,
            CornerRadius = new CornerRadius(10),
            Background = DisplayTokens.Surface,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            Child = _mainIcon,
        };

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        BuildChrome();

        _enrollButton.Click += (_, _) => _ = OnEnrollAsync();
        _regenerateButton.Click += (_, _) => _ = OnRegenerateAsync();
        _disableButton.Click += (_, _) => _ = OnDisableAsync();

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The diagnostics surface slug this view registers under (<c>TOTPEnrollmentSection</c>).</summary>
    public static string Slug => "TOTPEnrollmentSection";

    /// <summary>The backing state holder (exposed for hosting / diagnostics and tests).</summary>
    public TotpEnrollmentSectionViewModel ViewModel => _viewModel;

    private void BuildChrome()
    {
        // Loading branch — spinner + text.
        _loadingPanel.Children.Add(new ProgressRing { IsActive = true, Width = 20, Height = 20 });
        _loadingText.VerticalAlignment = VerticalAlignment.Center;
        _loadingPanel.Children.Add(_loadingText);

        // Open-mode branch — amber icon + heading, then the requirement message.
        var openHeader = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
        openHeader.Children.Add(BuildIconBox(WarningGlyph, StatusKind.Warning));
        _openModeTitle.VerticalAlignment = VerticalAlignment.Center;
        openHeader.Children.Add(_openModeTitle);
        _openModePanel.Children.Add(openHeader);
        _openModePanel.Children.Add(_openModeMessage);

        // Main branch — header row (icon + title/subtitle + status pill).
        var header = new Grid { ColumnSpacing = 12 };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var titleRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
        titleRow.Children.Add(_mainIconBox);
        var titleColumn = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        titleColumn.Children.Add(_mainTitle);
        titleColumn.Children.Add(_mainSubtitle);
        titleRow.Children.Add(titleColumn);

        Grid.SetColumn(titleRow, 0);
        Grid.SetColumn(_statusBadge, 1);
        header.Children.Add(titleRow);
        header.Children.Add(_statusBadge);
        _mainPanel.Children.Add(header);

        // Not-enrolled sub-state.
        _notEnrolledPanel.Children.Add(_enrollButton);
        _notEnrolledPanel.Children.Add(_enrollHint);
        _mainPanel.Children.Add(_notEnrolledPanel);

        // Active sub-state — last-used / backup-remaining grid, then the actions.
        var stats = new Grid { ColumnSpacing = 12, RowSpacing = 4 };
        stats.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        stats.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        stats.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        stats.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

        Grid.SetColumn(_lastUsedLabel, 0);
        Grid.SetRow(_lastUsedLabel, 0);
        Grid.SetColumn(_lastUsedValue, 0);
        Grid.SetRow(_lastUsedValue, 1);
        Grid.SetColumn(_backupRemainingLabel, 1);
        Grid.SetRow(_backupRemainingLabel, 0);
        Grid.SetColumn(_backupRemainingValue, 1);
        Grid.SetRow(_backupRemainingValue, 1);
        stats.Children.Add(_lastUsedLabel);
        stats.Children.Add(_lastUsedValue);
        stats.Children.Add(_backupRemainingLabel);
        stats.Children.Add(_backupRemainingValue);
        _activePanel.Children.Add(stats);

        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        actions.Children.Add(_regenerateButton);
        actions.Children.Add(_disableButton);
        _activePanel.Children.Add(actions);
        _mainPanel.Children.Add(_activePanel);

        _root.Children.Add(_loadingPanel);
        _root.Children.Add(_openModePanel);
        _root.Children.Add(_mainPanel);

        Content = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = _root };
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _diagnostics.RecordViewOpened();
        _ = _viewModel.LoadAsync();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Detach from the view-model and cancel any in-flight load (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        ScheduleRender();

    private void ScheduleRender()
    {
        if (_renderQueued)
        {
            return;
        }

        _renderQueued = true;
        if (_dispatcher is { } dispatcher)
        {
            dispatcher.TryEnqueue(RenderCoalesced);
        }
        else
        {
            RenderCoalesced();
        }
    }

    private void RenderCoalesced()
    {
        _renderQueued = false;
        Render();
    }

    private void Render()
    {
        var state = _viewModel.State;

        _loadingPanel.Visibility = Vis(state == TotpSectionState.Loading);
        _openModePanel.Visibility = Vis(state == TotpSectionState.OpenMode);
        _mainPanel.Visibility = Vis(state is TotpSectionState.NotEnrolled or TotpSectionState.Active);

        _loadingText.Value = _strings.Loading;

        _openModeTitle.Value = _strings.Title;
        _openModeMessage.Value = _strings.OpenModeMessage;

        bool activated = state == TotpSectionState.Active;
        _mainTitle.Value = _strings.Title;
        _mainSubtitle.Value = _strings.Subtitle;
        _mainIcon.Glyph = ShieldGlyph;
        _mainIcon.Foreground = AccentBrush(activated ? StatusKind.Success : StatusKind.Info);
        _statusBadge.Status = activated ? StatusKind.Success : StatusKind.Neutral;
        _statusBadge.Content = _viewModel.StatusPillText;
        AutomationProperties.SetName(_statusBadge, _viewModel.StatusPillText);

        _notEnrolledPanel.Visibility = Vis(state == TotpSectionState.NotEnrolled);
        _enrollButton.Text = _strings.ActionEnroll;
        _enrollButton.IsLoading = _viewModel.IsEnrolling;
        _enrollHint.Value = _strings.ActionEnrollHint;

        _activePanel.Visibility = Vis(activated);
        _lastUsedLabel.Value = _strings.LastUsedLabel;
        _lastUsedValue.Value = _viewModel.LastUsedText;
        _backupRemainingLabel.Value = _strings.BackupCodesRemainingLabel;
        _backupRemainingValue.Value = _viewModel.BackupCodesRemaining.ToString(System.Globalization.CultureInfo.CurrentCulture);
        _regenerateButton.Text = _strings.ActionRegenerate;
        _regenerateButton.IsLoading = _viewModel.IsRegenerating;
        _disableButton.Text = _strings.ActionDisable;

        AutomationProperties.SetName(this, _strings.Title);
    }

    private async Task OnEnrollAsync()
    {
        await _viewModel.StartEnrollAsync().ConfigureAwait(true);
        if (_viewModel.DialogStep == TotpDialogStep.Enroll && _viewModel.Enrollment is { } enrollment)
        {
            await ShowEnrollModalAsync(enrollment).ConfigureAwait(true);
        }
    }

    private async Task OnRegenerateAsync()
    {
        await _viewModel.RegenerateAsync().ConfigureAwait(true);
        if (_viewModel.DialogStep == TotpDialogStep.BackupCodes)
        {
            await ShowBackupCodesModalAsync().ConfigureAwait(true);
        }
    }

    private async Task OnDisableAsync()
    {
        _viewModel.StartDisable();
        await ShowDisableDialogAsync().ConfigureAwait(true);
    }

    private async Task ShowEnrollModalAsync(TotpEnrollment enrollment)
    {
        var content = new StackPanel { Spacing = 16 };
        content.Children.Add(new Text { Value = _strings.ModalScanInstructions });

        var qrImage = new Image
        {
            Width = QrSize,
            Height = QrSize,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        AutomationProperties.SetName(qrImage, _strings.ModalQrAlt);
        var qrSource = await DecodeDataUriAsync(enrollment.QrDataUri).ConfigureAwait(true);
        if (qrSource is not null)
        {
            qrImage.Source = qrSource;
        }

        content.Children.Add(qrImage);

        content.Children.Add(new Label { Value = _strings.ModalManualLabel });
        var secretRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        secretRow.Children.Add(new Code { Value = enrollment.Secret, VerticalAlignment = VerticalAlignment.Center });
        var secretCopy = new TsCopyButton { ValueToCopy = enrollment.Secret };
        AutomationProperties.SetName(secretCopy, _localizer.GetString("common.copy", "Copy"));
        secretRow.Children.Add(secretCopy);
        content.Children.Add(secretRow);

        var codeInput = new TsInput { Hint = "••••••" };
        AutomationProperties.SetName(codeInput, _strings.ModalCodeLabel);
        codeInput.TextChanged += (_, _) =>
        {
            _viewModel.SetVerifyCode(codeInput.Text);
            if (codeInput.Text != _viewModel.VerifyCode)
            {
                codeInput.Text = _viewModel.VerifyCode;
                codeInput.SelectionStart = codeInput.Text.Length;
            }
        };
        content.Children.Add(new Label { Value = _strings.ModalCodeLabel });
        content.Children.Add(codeInput);

        var errorText = new ErrorText { Visibility = Visibility.Collapsed };
        content.Children.Add(errorText);

        var dialog = new TsModal
        {
            Title = _strings.ModalEnrollTitle,
            Content = content,
            PrimaryButtonText = _strings.ModalVerify,
            CloseButtonText = _strings.ModalCancel,
            XamlRoot = XamlRoot,
        };

        dialog.PrimaryButtonClick += async (_, args) =>
        {
            var deferral = args.GetDeferral();
            try
            {
                await _viewModel.VerifyAsync().ConfigureAwait(true);
                if (_viewModel.VerifyError is { } error)
                {
                    errorText.Value = error;
                    errorText.Visibility = Visibility.Visible;
                    codeInput.HasError = true;
                    args.Cancel = true;
                }
            }
            finally
            {
                deferral.Complete();
            }
        };

        await dialog.ShowAsync();

        if (_viewModel.DialogStep == TotpDialogStep.BackupCodes)
        {
            await ShowBackupCodesModalAsync().ConfigureAwait(true);
        }
        else
        {
            _viewModel.CloseDialog();
        }
    }

    private async Task ShowBackupCodesModalAsync()
    {
        var codes = _viewModel.RevealedCodes ?? Array.Empty<string>();

        var content = new StackPanel { Spacing = 16 };
        content.Children.Add(new Text { Value = _strings.BackupCodesWarning });

        var codeGrid = new Grid { ColumnSpacing = 8, RowSpacing = 8 };
        codeGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        codeGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        for (int i = 0; i < codes.Count; i++)
        {
            while (codeGrid.RowDefinitions.Count <= i / 2)
            {
                codeGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            }

            var code = new Code { Value = codes[i] };
            Grid.SetColumn(code, i % 2);
            Grid.SetRow(code, i / 2);
            codeGrid.Children.Add(code);
        }

        var listBorder = new Border
        {
            CornerRadius = new CornerRadius(8),
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            Background = DisplayTokens.Surface,
            Padding = new Thickness(12),
            Child = codeGrid,
        };
        content.Children.Add(listBorder);

        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        var downloadButton = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            IconGlyph = DownloadGlyph,
            Text = _strings.BackupCodesDownload,
        };
        downloadButton.Click += (_, _) => _ = DownloadBackupCodesAsync();
        actions.Children.Add(downloadButton);
        var codesCopy = new TsCopyButton { ValueToCopy = string.Join('\n', codes) };
        AutomationProperties.SetName(codesCopy, _localizer.GetString("common.copy", "Copy"));
        actions.Children.Add(codesCopy);
        content.Children.Add(actions);

        var dialog = new TsModal
        {
            Title = _strings.BackupCodesTitle,
            Content = content,
            PrimaryButtonText = _strings.BackupCodesDone,
            XamlRoot = XamlRoot,
        };

        await dialog.ShowAsync();
        _viewModel.CloseDialog();
    }

    private async Task ShowDisableDialogAsync()
    {
        var content = new StackPanel { Spacing = 12 };
        content.Children.Add(new Text { Value = _strings.DisableMessage });
        content.Children.Add(new Label { Value = _strings.DisableTypedLabel });

        var confirmInput = new TsInput { Hint = TotpEnrollmentProjection.DisableConfirmationPhrase };
        AutomationProperties.SetName(confirmInput, _strings.DisableTypedLabel);
        content.Children.Add(confirmInput);

        var dialog = new TsConfirmDialog
        {
            Title = _strings.DisableTitle,
            Content = content,
            PrimaryButtonText = _strings.DisableConfirm,
            CloseButtonText = _strings.DisableCancel,
            IsDestructive = true,
            XamlRoot = XamlRoot,
        };

        dialog.PrimaryButtonClick += async (_, args) =>
        {
            if (!string.Equals(
                    confirmInput.Text?.Trim(),
                    TotpEnrollmentProjection.DisableConfirmationPhrase,
                    StringComparison.Ordinal))
            {
                confirmInput.HasError = true;
                args.Cancel = true;
                return;
            }

            var deferral = args.GetDeferral();
            try
            {
                await _viewModel.ConfirmDisableAsync().ConfigureAwait(true);
            }
            finally
            {
                deferral.Complete();
            }
        };

        var result = await dialog.ShowAsync();
        if (result != ContentDialogResult.Primary)
        {
            _viewModel.CancelDisable();
        }
    }

    private async Task DownloadBackupCodesAsync()
    {
        var body = _viewModel.BackupCodesFileContent();
        if (string.IsNullOrEmpty(body))
        {
            return;
        }

        var window = App.MainWindow;
        if (window is null)
        {
            return;
        }

        try
        {
            var picker = new FileSavePicker
            {
                SuggestedStartLocation = PickerLocationId.DocumentsLibrary,
                SuggestedFileName = Path.GetFileNameWithoutExtension(TotpEnrollmentProjection.BackupCodesFileName),
            };
            picker.FileTypeChoices.Add("Text", new List<string> { ".txt" });
            InitializeWithWindow.Initialize(picker, WindowNative.GetWindowHandle(window));

            var file = await picker.PickSaveFileAsync().AsTask().ConfigureAwait(true);
            if (file is null)
            {
                return;
            }

            await FileIO.WriteTextAsync(file, body).AsTask().ConfigureAwait(true);
        }
        catch (Exception)
        {
            // Best-effort download; a cancelled or failed save is a no-op (web blob download has no error path).
        }
    }

    private static async Task<ImageSource?> DecodeDataUriAsync(string dataUri)
    {
        if (string.IsNullOrEmpty(dataUri))
        {
            return null;
        }

        var marker = dataUri.IndexOf("base64,", StringComparison.Ordinal);
        if (marker < 0)
        {
            return null;
        }

        try
        {
            var bytes = Convert.FromBase64String(dataUri[(marker + 7)..]);
            var stream = new InMemoryRandomAccessStream();
            using (var writer = new DataWriter(stream))
            {
                writer.WriteBytes(bytes);
                await writer.StoreAsync();
                await writer.FlushAsync();
                writer.DetachStream();
            }

            stream.Seek(0);
            var bitmap = new BitmapImage();
            await bitmap.SetSourceAsync(stream);
            return bitmap;
        }
        catch (Exception ex) when (ex is FormatException or System.Runtime.InteropServices.COMException)
        {
            return null;
        }
    }

    private static Border BuildIconBox(string glyph, StatusKind status)
    {
        var icon = new FontIcon
        {
            Glyph = glyph,
            FontSize = 20,
            Foreground = AccentBrush(status),
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        return new Border
        {
            Width = IconBoxSize,
            Height = IconBoxSize,
            CornerRadius = new CornerRadius(10),
            Background = DisplayTokens.Surface,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            Child = icon,
        };
    }

    private static Brush AccentBrush(StatusKind status) => DisplayTokens.Brush(StatusResources.AccentBrushKey(status));

    private static Visibility Vis(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;
}
