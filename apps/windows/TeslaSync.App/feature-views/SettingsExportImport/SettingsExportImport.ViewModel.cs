using System.ComponentModel;
using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.Json.Nodes;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// A transient toast request raised by the <see cref="SettingsExportImportViewModel"/> — the native analogue of
/// the web <c>useToast</c> / <c>useMutationToast</c> calls in <c>SettingsExportImport</c>
/// (web/src/features/settings/components/SettingsExportImport.tsx). The host surfaces it (the view binds it to
/// an <c>InfoBar</c>); <see cref="IsError"/> selects the severity.
/// </summary>
/// <param name="Title">The localized toast title.</param>
/// <param name="Detail">The localized toast detail (may be empty).</param>
/// <param name="IsError">True for the error severity, false for success/informational.</param>
public sealed record SettingsToast(string Title, string Detail, bool IsError);

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="SettingsExportImport"/> view — the native port of
/// the web <c>SettingsExportImport</c> component's hook composition
/// (web/src/features/settings/components/SettingsExportImport.tsx). It owns the export busy flag, the import
/// stage machine (idle → parsing → preview → applied), the pending file + dry-run preview, the applied result
/// and the inline parse error, drives the <see cref="ISettingsBackupSource"/> (the web <c>useSettingsBackup</c>
/// hooks) and the <see cref="ISettingsBundleDownloader"/> (the web blob download), and re-projects through
/// <see cref="SettingsExportImportProjection"/> so the view is a thin renderer. The whole surface never throws:
/// export failures raise an error toast, import parse / validation / preview failures render an inline error,
/// and a cancelled apply step-up keeps the preview visible. Drive it from one confinement (the UI thread); it
/// is not internally synchronised.
/// </summary>
public sealed class SettingsExportImportViewModel : INotifyPropertyChanged
{
    /// <summary>i18n key for the export-failure toast (web <c>toast.settings.export.error</c>).</summary>
    public const string ExportErrorToastKey = "toast.settings.export.error";

    /// <summary>i18n key for the dry-run-failure toast (web <c>toast.settings.import.dryRunError</c>).</summary>
    public const string DryRunErrorToastKey = "toast.settings.import.dryRunError";

    /// <summary>i18n key for the apply-failure toast (web <c>toast.settings.import.applyError</c>).</summary>
    public const string ApplyErrorToastKey = "toast.settings.import.applyError";

    /// <summary>i18n key for the export-success toast title (web <c>backup.export.successTitle</c>).</summary>
    public const string ExportSuccessTitleKey = "backup.export.successTitle";

    /// <summary>i18n key for the export-success toast detail (web <c>backup.export.successDetail</c>).</summary>
    public const string ExportSuccessDetailKey = "backup.export.successDetail";

    /// <summary>i18n key for the apply-success toast title (web <c>backup.import.appliedTitle</c>).</summary>
    public const string AppliedTitleKey = "backup.import.appliedTitle";

    /// <summary>i18n key for the apply-success toast detail template (web <c>backup.import.appliedDetail</c>).</summary>
    public const string AppliedDetailKey = "backup.import.appliedDetail";

    /// <summary>i18n key for the import-too-large inline error (web <c>backup.import.errorTooLarge</c>).</summary>
    public const string ErrorTooLargeKey = "backup.import.errorTooLarge";

    /// <summary>i18n key for the file-read inline error (web <c>backup.import.errorRead</c>).</summary>
    public const string ErrorReadKey = "backup.import.errorRead";

    /// <summary>i18n key for the invalid-JSON inline error template (web <c>backup.import.errorJson</c>).</summary>
    public const string ErrorJsonKey = "backup.import.errorJson";

    /// <summary>i18n key for the preview-failure inline error (web <c>backup.import.errorPreview</c>).</summary>
    public const string ErrorPreviewKey = "backup.import.errorPreview";

    private static readonly JsonSerializerOptions PrettyJson = new() { WriteIndented = true };

    private readonly ISettingsBackupSource _source;
    private readonly ISettingsBundleDownloader _downloader;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;

    private SettingsExportImportState _state = SettingsExportImportState.Idle;
    private bool _exportBusy;
    private bool _isApplying;
    private string? _parseError;
    private JsonNode? _pendingBundle;
    private string? _pendingFilename;
    private long _pendingSizeBytes;
    private SettingsImportResult? _previewResult;
    private SettingsImportResult? _appliedResult;
    private SettingsExportImportDisplay _display;

    /// <summary>Creates the holder over its data source, download sink, localizer and an optional clock.</summary>
    /// <param name="source">The settings-backup data source (export / dry-run / apply).</param>
    /// <param name="downloader">The sink that writes an exported bundle to the Downloads folder.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="clock">An optional UTC clock for the export filename (defaults to <see cref="DateTimeOffset.UtcNow"/>).</param>
    public SettingsExportImportViewModel(
        ISettingsBackupSource source,
        ISettingsBundleDownloader downloader,
        ILocalizer localizer,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(downloader);
        ArgumentNullException.ThrowIfNull(localizer);

        _source = source;
        _downloader = downloader;
        _localizer = localizer;
        _clock = clock ?? (static () => DateTimeOffset.UtcNow);
        _display = Project();
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised with a localized transient toast for the host surface (web <c>useToast</c>).</summary>
    public event EventHandler<SettingsToast>? ToastRequested;

    /// <summary>The current import-flow stage.</summary>
    public SettingsExportImportState State => _state;

    /// <summary>True while an export is in flight (web <c>exportMut.isPending</c>).</summary>
    public bool ExportBusy => _exportBusy;

    /// <summary>True while an apply is in flight (web <c>applyMut.isPending</c>).</summary>
    public bool IsApplying => _isApplying;

    /// <summary>The inline parse/preview error message, or <see langword="null"/>.</summary>
    public string? ParseError => _parseError;

    /// <summary>The pending import file's name, or <see langword="null"/>.</summary>
    public string? PendingFilename => _pendingFilename;

    /// <summary>The pending import file's size in bytes.</summary>
    public long PendingSizeBytes => _pendingSizeBytes;

    /// <summary>The dry-run result shown in the preview stage, or <see langword="null"/>.</summary>
    public SettingsImportResult? PreviewResult => _previewResult;

    /// <summary>The apply result shown in the applied stage, or <see langword="null"/>.</summary>
    public SettingsImportResult? AppliedResult => _appliedResult;

    /// <summary>The projected, render-ready display for the current state.</summary>
    public SettingsExportImportDisplay Display => _display;

    /// <summary>The localized surface title (Narrator name / host chrome).</summary>
    public string Title => SettingsExportImportRegistration.Name(_localizer);

    /// <summary>
    /// Run the export flow (web <c>handleExport</c>): fetch the bundle, write it to the Downloads folder and
    /// fire the success toast. A failure raises the error toast; a cancellation is silent. Re-entrant calls
    /// while an export is already in flight are ignored.
    /// </summary>
    /// <param name="cancellationToken">A token cancelling the export.</param>
    public async Task ExportAsync(CancellationToken cancellationToken = default)
    {
        if (_exportBusy)
        {
            return;
        }

        SetExportBusy(true);
        try
        {
            JsonNode bundle = await _source.ExportAsync(cancellationToken).ConfigureAwait(false);
            string json = bundle.ToJsonString(PrettyJson);
            string filename = SettingsBundleConstants.DefaultExportFilename(_clock());
            await _downloader.SaveAsync(filename, json, cancellationToken).ConfigureAwait(false);

            RaiseToast(new SettingsToast(
                _localizer.GetString(ExportSuccessTitleKey, "Settings exported"),
                _localizer.GetString(ExportSuccessDetailKey, "Saved to your downloads folder."),
                IsError: false));
        }
        catch (OperationCanceledException)
        {
            // Cancelled (e.g. the surface was torn down) — drop silently.
        }
        catch (Exception)
        {
            RaiseToast(new SettingsToast(
                _localizer.GetString(ExportErrorToastKey, "Failed to export settings"),
                string.Empty,
                IsError: true));
        }
        finally
        {
            SetExportBusy(false);
        }
    }

    /// <summary>
    /// Run the import intake (web <c>ingestFile</c>): reset any prior import, enforce the size cap, read and
    /// parse the file, validate the bundle schema locally and — on success — run the dry-run preview. Every
    /// failure renders an inline error and returns to the idle stage; the surface never throws.
    /// </summary>
    /// <param name="filename">The chosen file's name (shown in the preview header).</param>
    /// <param name="sizeBytes">The chosen file's size in bytes (checked against the 1 MiB cap before reading).</param>
    /// <param name="readTextAsync">Reads the file's text lazily, so the size cap rejects before any read.</param>
    /// <param name="cancellationToken">A token cancelling the read / preview.</param>
    public async Task IngestAsync(
        string filename,
        long sizeBytes,
        Func<CancellationToken, Task<string>> readTextAsync,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(filename);
        ArgumentNullException.ThrowIfNull(readTextAsync);

        ResetState();
        SetState(SettingsExportImportState.Parsing);

        if (sizeBytes > SettingsBundleConstants.MaxImportFileBytes)
        {
            FailParse(_localizer.GetString(ErrorTooLargeKey, "File is too large (max 1 MB)."));
            return;
        }

        string text;
        try
        {
            text = await readTextAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            SetState(SettingsExportImportState.Idle);
            return;
        }
        catch (Exception)
        {
            FailParse(_localizer.GetString(ErrorReadKey, "Failed to read the file."));
            return;
        }

        JsonNode? parsed;
        try
        {
            parsed = JsonNode.Parse(text);
        }
        catch (JsonException ex)
        {
            FailParse(string.Format(
                CultureInfo.CurrentCulture,
                _localizer.GetString(ErrorJsonKey, "File is not valid JSON: {0}"),
                ex.Message));
            return;
        }

        SettingsBundleValidation validation = SettingsBundleValidator.Validate(parsed);
        if (!validation.IsValid)
        {
            FailParse(validation.Error!.Localize(_localizer));
            return;
        }

        JsonNode bundle = validation.Bundle!.Root;
        _pendingBundle = bundle;
        _pendingFilename = filename;
        _pendingSizeBytes = sizeBytes;
        RaiseChanged(nameof(PendingFilename));
        RaiseChanged(nameof(PendingSizeBytes));

        try
        {
            SettingsImportResult result = await _source.PreviewImportAsync(bundle, cancellationToken).ConfigureAwait(false);
            _previewResult = result;
            RaiseChanged(nameof(PreviewResult));
            SetState(SettingsExportImportState.Preview);
        }
        catch (OperationCanceledException)
        {
            ClearPending();
            SetState(SettingsExportImportState.Idle);
        }
        catch (Exception)
        {
            ClearPending();
            RaiseToast(new SettingsToast(
                _localizer.GetString(DryRunErrorToastKey, "Failed to preview import"),
                string.Empty,
                IsError: true));
            FailParse(_localizer.GetString(ErrorPreviewKey, "Failed to preview import."));
        }
    }

    /// <summary>
    /// Apply the pending bundle (web <c>handleApply</c>): re-issue the import with <c>dry_run=false</c>, move to
    /// the applied stage and fire the success toast. A cancelled step-up keeps the preview visible (no toast);
    /// any other failure raises the error toast and keeps the preview. A no-op when nothing is pending or an
    /// apply is already in flight.
    /// </summary>
    /// <param name="cancellationToken">A token cancelling the apply.</param>
    public async Task ApplyAsync(CancellationToken cancellationToken = default)
    {
        if (_pendingBundle is null || _isApplying)
        {
            return;
        }

        SetApplying(true);
        try
        {
            SettingsImportResult result = await _source.ApplyImportAsync(_pendingBundle, cancellationToken).ConfigureAwait(false);
            _appliedResult = result;
            RaiseChanged(nameof(AppliedResult));
            SetState(SettingsExportImportState.Applied);

            SettingsImportSummary applied = SettingsImportSummary.From(result);
            RaiseToast(new SettingsToast(
                _localizer.GetString(AppliedTitleKey, "Settings imported"),
                string.Format(
                    CultureInfo.CurrentCulture,
                    _localizer.GetString(AppliedDetailKey, "{0} added, {1} updated, {2} skipped."),
                    applied.Added,
                    applied.Updated,
                    applied.Skipped),
                IsError: false));
        }
        catch (SettingsImportStepUpCanceledException)
        {
            // The user cancelled the step-up — keep the dry-run preview visible so they can retry.
        }
        catch (OperationCanceledException)
        {
            // Cancelled (e.g. the surface was torn down) — keep the preview, drop silently.
        }
        catch (Exception)
        {
            RaiseToast(new SettingsToast(
                _localizer.GetString(ApplyErrorToastKey, "Failed to apply import"),
                string.Empty,
                IsError: true));
        }
        finally
        {
            SetApplying(false);
        }
    }

    /// <summary>Reset the import flow to its resting state (web <c>resetImport</c>).</summary>
    public void Reset()
    {
        ResetState();
        Reproject();
    }

    /// <summary>Re-resolve every label and re-project — the native analogue of react-i18next re-rendering after the active language changes.</summary>
    public void Reload() => Reproject();

    private void ResetState()
    {
        ClearPending();
        _state = SettingsExportImportState.Idle;
        _parseError = null;
        _previewResult = null;
        _appliedResult = null;
    }

    private void ClearPending()
    {
        _pendingBundle = null;
        _pendingFilename = null;
        _pendingSizeBytes = 0;
    }

    private void FailParse(string message)
    {
        ClearPending();
        _state = SettingsExportImportState.Idle;
        _parseError = message;
        RaiseChanged(nameof(State));
        RaiseChanged(nameof(ParseError));
        Reproject();
    }

    private void SetState(SettingsExportImportState state)
    {
        if (_state != state)
        {
            _state = state;
            RaiseChanged(nameof(State));
        }

        Reproject();
    }

    private void SetExportBusy(bool busy)
    {
        if (_exportBusy != busy)
        {
            _exportBusy = busy;
            RaiseChanged(nameof(ExportBusy));
            Reproject();
        }
    }

    private void SetApplying(bool applying)
    {
        if (_isApplying != applying)
        {
            _isApplying = applying;
            RaiseChanged(nameof(IsApplying));
            Reproject();
        }
    }

    private SettingsExportImportDisplay Project() =>
        SettingsExportImportProjection.Project(
            new SettingsExportImportSnapshot(
                _state,
                _exportBusy,
                _isApplying,
                _parseError,
                _pendingFilename,
                _pendingSizeBytes,
                _previewResult,
                _appliedResult),
            _localizer);

    private void Reproject()
    {
        _display = Project();
        RaiseChanged(nameof(Display));
    }

    private void RaiseToast(SettingsToast toast) => ToastRequested?.Invoke(this, toast);

    private void RaiseChanged([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
