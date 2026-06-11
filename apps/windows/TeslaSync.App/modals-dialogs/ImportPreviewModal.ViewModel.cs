using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// The transient parse error shown beneath the import tabs — the native analogue of the web modal's
/// <c>parseError</c> state (web/src/features/dashboard/components/ImportPreviewModal.tsx). Each member maps to
/// one of the modal's five <c>setParseError(t(...))</c> calls; the localized text is resolved at the boundary
/// through <see cref="ImportPreviewRegistration"/>.
/// </summary>
public enum ImportParseError
{
    /// <summary>The input was empty / whitespace (web <c>import.emptyInput</c>).</summary>
    EmptyInput,

    /// <summary>The chosen file could not be read (web <c>import.readError</c>).</summary>
    ReadError,

    /// <summary>A non-<c>.json</c> file was dropped (web <c>import.invalidFileType</c>).</summary>
    InvalidFileType,

    /// <summary>The URL carried no import parameter (web <c>import.noImportParam</c>).</summary>
    NoImportParam,

    /// <summary>The URL could not be parsed / decoded (web <c>import.invalidUrl</c>).</summary>
    InvalidUrl,
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="ImportPreviewModal"/> view — the native port of
/// the web <c>ImportPreviewModal</c> component (web/src/features/dashboard/components/ImportPreviewModal.tsx).
/// It owns the editable input state (the active tab, the pasted JSON, the share URL and the drag-over flag —
/// the web <c>useState</c> values), runs the pure <see cref="ImportValidator"/> (the web
/// <c>validateImportData</c> / <c>handleUrlImport</c>), and drives the two render modes the web switches
/// between: the <em>input</em> mode (tabs + the transient parse-error banner) and the <em>preview</em> mode
/// (validation errors / warnings, the dashboard summary + mini-grid thumbnail, the widget-availability list
/// and the Back / Import actions). The component performs no network read (its only hook is
/// <c>useTranslation</c>), so the surface has no loading / stale / offline branch; its states are input,
/// per-source parse error, preview-with-valid-dashboard, preview-with-errors, and the friendly
/// "cannot preview" empty state. The auto-validate-on-open path (web <c>initialJson</c>) and the
/// confirm / back / close transitions are reproduced exactly. Drive it from one confinement (the UI thread);
/// it is not internally synchronised.
/// </summary>
public sealed class ImportPreviewModalViewModel : INotifyPropertyChanged
{
    private readonly IImportFilePicker _filePicker;
    private readonly ILocalizer _localizer;
    private readonly IImportIdentity _identity;
    private readonly ImportPreviewDiagnostics _diagnostics;

    private ImportPreviewTab _activeTab = ImportPreviewTab.File;
    private string _pastedJson = string.Empty;
    private string _importUrl = string.Empty;
    private bool _isDragOver;
    private ImportValidation? _validation;
    private ImportParseError? _parseError;
    private bool _didAutoValidate;

    /// <summary>Creates the holder over its file-picker seam, localizer, identity seam and (optional) diagnostics.</summary>
    /// <param name="filePicker">The browse-for-file port (web file input + <c>file.text()</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="identity">The id/timestamp seam the validator uses; defaults to <see cref="SystemImportIdentity.Shared"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink (defaults to a no-op collector).</param>
    public ImportPreviewModalViewModel(
        IImportFilePicker filePicker,
        ILocalizer localizer,
        IImportIdentity? identity = null,
        ImportPreviewDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(filePicker);
        ArgumentNullException.ThrowIfNull(localizer);

        _filePicker = filePicker;
        _localizer = localizer;
        _identity = identity ?? SystemImportIdentity.Shared;
        _diagnostics = diagnostics ?? new ImportPreviewDiagnostics();
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised with the validated dashboard when the user confirms the import (web <c>onConfirm</c>).</summary>
    public event EventHandler<ImportedDashboard>? Confirmed;

    /// <summary>Raised when the modal should close (web <c>onClose</c>): confirm or dismiss.</summary>
    public event EventHandler? CloseRequested;

    // ── Header copy ──────────────────────────────────────────────────────────────────────────────────────

    /// <summary>The modal title — preview title once a validation exists, else the input title (web <c>title</c>).</summary>
    public string Title => _validation is null
        ? ImportPreviewRegistration.Title(_localizer)
        : ImportPreviewRegistration.PreviewTitle(_localizer);

    /// <summary>Shared modal-dismiss label (web <c>Modal</c> close "X").</summary>
    public string CloseLabel => ImportPreviewRegistration.Close(_localizer);

    // ── Static input copy (the Narrator-label source) ────────────────────────────────────────────────────

    /// <summary>"From File" tab label.</summary>
    public string TabFileLabel => ImportPreviewRegistration.TabFile(_localizer);

    /// <summary>"Paste JSON" tab label.</summary>
    public string TabPasteLabel => ImportPreviewRegistration.TabPaste(_localizer);

    /// <summary>"From URL" tab label.</summary>
    public string TabUrlLabel => ImportPreviewRegistration.TabUrl(_localizer);

    /// <summary>File drop-zone prompt.</summary>
    public string DropFileText => ImportPreviewRegistration.DropFile(_localizer);

    /// <summary>Browse button label.</summary>
    public string BrowseLabel => ImportPreviewRegistration.Browse(_localizer);

    /// <summary>Hidden file-input accessible label (the native picker's Narrator name).</summary>
    public string FileInputLabel => ImportPreviewRegistration.FileInputLabel(_localizer);

    /// <summary>Validate-and-preview button label.</summary>
    public string ValidateLabel => ImportPreviewRegistration.Validate(_localizer);

    /// <summary>Load-from-URL button label.</summary>
    public string LoadUrlLabel => ImportPreviewRegistration.LoadUrl(_localizer);

    /// <summary>Paste textarea sample hint.</summary>
    public string PasteHint => ImportPreviewRegistration.PasteHint(_localizer);

    /// <summary>URL input sample hint.</summary>
    public string UrlHint => ImportPreviewRegistration.UrlHint(_localizer);

    // ── Static preview copy ──────────────────────────────────────────────────────────────────────────────

    /// <summary>Widget-list section header.</summary>
    public string WidgetsHeader => ImportPreviewRegistration.Widgets(_localizer);

    /// <summary>Skipped-widget trailing label.</summary>
    public string NotAvailableText => ImportPreviewRegistration.NotAvailable(_localizer);

    /// <summary>Preview empty-state message (shown when the layout cannot be previewed).</summary>
    public string CannotPreviewMessage => ImportPreviewRegistration.CannotPreview(_localizer);

    /// <summary>Back button label.</summary>
    public string BackLabel => ImportPreviewRegistration.Back(_localizer);

    /// <summary>Confirm (import) button label.</summary>
    public string ConfirmLabel => ImportPreviewRegistration.Confirm(_localizer);

    // ── Editable input state (web useState) ──────────────────────────────────────────────────────────────

    /// <summary>The active import tab (web <c>activeTab</c>; default file).</summary>
    public ImportPreviewTab ActiveTab
    {
        get => _activeTab;
        set => Set(ref _activeTab, value);
    }

    /// <summary>The pasted JSON text (web <c>pastedJson</c>); editing it toggles <see cref="CanValidatePasted"/>.</summary>
    public string PastedJson
    {
        get => _pastedJson;
        set
        {
            if (Set(ref _pastedJson, value ?? string.Empty))
            {
                Raise(nameof(CanValidatePasted));
            }
        }
    }

    /// <summary>The share URL text (web <c>importUrl</c>); editing it toggles <see cref="CanLoadUrl"/>.</summary>
    public string ImportUrl
    {
        get => _importUrl;
        set
        {
            if (Set(ref _importUrl, value ?? string.Empty))
            {
                Raise(nameof(CanLoadUrl));
            }
        }
    }

    /// <summary>Whether a file is being dragged over the drop zone (web <c>isDragOver</c>).</summary>
    public bool IsDragOver
    {
        get => _isDragOver;
        set => Set(ref _isDragOver, value);
    }

    /// <summary>True when the validate button is enabled (web <c>disabled={!pastedJson.trim()}</c>).</summary>
    public bool CanValidatePasted => !string.IsNullOrWhiteSpace(_pastedJson);

    /// <summary>True when the load-URL button is enabled (web <c>disabled={!importUrl.trim()}</c>).</summary>
    public bool CanLoadUrl => !string.IsNullOrWhiteSpace(_importUrl);

    // ── Render mode + parse error ────────────────────────────────────────────────────────────────────────

    /// <summary>True once a validation result exists — the modal shows the preview (web <c>if (validation)</c>).</summary>
    public bool HasValidation => _validation is not null;

    /// <summary>The current validation result, or null while in input mode.</summary>
    public ImportValidation? Validation => _validation;

    /// <summary>True when a transient parse error should be surfaced under the tabs (web <c>parseError</c>).</summary>
    public bool HasParseError => _parseError is not null;

    /// <summary>The localized parse-error text, or empty when none (web <c>parseError</c>).</summary>
    public string ParseErrorText => _parseError switch
    {
        ImportParseError.EmptyInput => ImportPreviewRegistration.EmptyInput(_localizer),
        ImportParseError.ReadError => ImportPreviewRegistration.ReadError(_localizer),
        ImportParseError.InvalidFileType => ImportPreviewRegistration.InvalidFileType(_localizer),
        ImportParseError.NoImportParam => ImportPreviewRegistration.NoImportParam(_localizer),
        ImportParseError.InvalidUrl => ImportPreviewRegistration.InvalidUrl(_localizer),
        _ => string.Empty,
    };

    // ── Preview projections ──────────────────────────────────────────────────────────────────────────────

    /// <summary>The localized blocking-error lines (web <c>errors.map</c>), or empty in input mode.</summary>
    public IReadOnlyList<string> ErrorLines => _validation is null
        ? Array.Empty<string>()
        : ImportPreviewProjection.ErrorLines(_validation, _localizer);

    /// <summary>The localized non-blocking-warning lines (web <c>warnings.map</c>), or empty in input mode.</summary>
    public IReadOnlyList<string> WarningLines => _validation is null
        ? Array.Empty<string>()
        : ImportPreviewProjection.WarningLines(_validation, _localizer);

    /// <summary>True when there is at least one error line to surface.</summary>
    public bool HasErrors => ErrorLines.Count > 0;

    /// <summary>True when there is at least one warning line to surface.</summary>
    public bool HasWarnings => WarningLines.Count > 0;

    /// <summary>The widget-availability rows (web <c>availableWidgets</c> + <c>missingWidgets</c> rows).</summary>
    public IReadOnlyList<ImportPreviewWidgetRow> WidgetRows => _validation is null
        ? Array.Empty<ImportPreviewWidgetRow>()
        : ImportPreviewProjection.WidgetRows(_validation);

    /// <summary>True when a validated dashboard exists to summarise (web <c>dashboard ? ... : EmptyState</c>).</summary>
    public bool HasDashboard => _validation?.Dashboard is not null;

    /// <summary>The validated dashboard name (web <c>dashboard.name</c>), or empty.</summary>
    public string DashboardName => _validation?.Dashboard?.Name ?? string.Empty;

    /// <summary>The available-widget-count badge (web <c>{{count}} widgets</c>).</summary>
    public string AvailableBadge => ImportPreviewRegistration.AvailableCount(
        _localizer, _validation?.AvailableWidgets.Count ?? 0);

    /// <summary>True when the skipped-widget badge should be shown (web <c>missingWidgets.length &gt; 0</c>).</summary>
    public bool ShowMissingBadge => (_validation?.MissingWidgets.Count ?? 0) > 0;

    /// <summary>The skipped-widget-count badge (web <c>{{count}} skipped</c>).</summary>
    public string MissingBadge => ImportPreviewRegistration.MissingCount(
        _localizer, _validation?.MissingWidgets.Count ?? 0);

    /// <summary>True when the confirm (import) button is shown (web <c>isValid &amp;&amp; dashboard</c>).</summary>
    public bool CanConfirm => _validation?.CanConfirm ?? false;

    /// <summary>The mini-grid thumbnail model for the validated dashboard, or empty when there is none.</summary>
    public MiniGridPreviewModel PreviewModel => _validation?.Dashboard is { } dashboard
        ? ImportPreviewProjection.PreviewModel(dashboard)
        : MiniGridPreviewModel.Empty;

    // ── Commands ─────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Capture the <c>view.opened</c> diagnostic and, when an <paramref name="initialJson"/> payload is
    /// supplied on first open, auto-validate it straight into preview mode (web
    /// <c>if (open &amp;&amp; initialJson &amp;&amp; !didAutoValidate)</c>).
    /// </summary>
    /// <param name="initialJson">The pre-filled JSON (e.g. from a URL import), or null.</param>
    public void NotifyOpened(string? initialJson = null)
    {
        _diagnostics.RecordViewOpened();
        if (!_didAutoValidate && !string.IsNullOrEmpty(initialJson))
        {
            _didAutoValidate = true;
            SetValidation(ImportValidator.Validate(initialJson, _identity));
        }
    }

    /// <summary>Validate the pasted JSON (web paste tab <c>onClick={() =&gt; handleValidate(pastedJson)}</c>).</summary>
    public void ValidatePasted() => HandleValidate(_pastedJson);

    /// <summary>
    /// Decode and validate the share URL (web url tab <c>onClick={() =&gt; handleUrlImport(importUrl)}</c>):
    /// a missing parameter or unparseable URL surfaces the matching parse error; a decoded payload validates.
    /// </summary>
    public void LoadFromUrl()
    {
        SetParseError(null);
        ImportUrlResult result = ImportValidator.DecodeImportUrl(_importUrl);
        switch (result.Status)
        {
            case ImportUrlStatus.NoImportParam:
                SetParseError(ImportParseError.NoImportParam);
                break;
            case ImportUrlStatus.InvalidUrl:
                SetParseError(ImportParseError.InvalidUrl);
                break;
            case ImportUrlStatus.Decoded:
                HandleValidate(result.Json);
                break;
            default:
                break;
        }
    }

    /// <summary>
    /// Prompt for a <c>.json</c> file and validate its contents (web Browse → <c>handleFileImport</c>): a
    /// chosen file validates, an unreadable file surfaces the read error, and a cancelled picker is a no-op.
    /// </summary>
    /// <param name="cancellationToken">Cancels a pending pick (e.g. the modal closing).</param>
    public async Task BrowseForFileAsync(CancellationToken cancellationToken = default)
    {
        ImportFilePick pick = await _filePicker.PickJsonAsync(cancellationToken).ConfigureAwait(false);
        switch (pick.Outcome)
        {
            case ImportFilePickOutcome.Picked:
                HandleValidate(pick.Text);
                break;
            case ImportFilePickOutcome.Failed:
                SetParseError(ImportParseError.ReadError);
                break;
            case ImportFilePickOutcome.Cancelled:
            default:
                break;
        }
    }

    /// <summary>
    /// Whether a dropped file is acceptable (web <c>handleDrop</c> type guard). A non-<c>.json</c> file
    /// surfaces the wrong-type parse error and returns false; a <c>.json</c> file clears any prior error and
    /// returns true (the caller then reads its text and calls <see cref="ImportFileText"/> /
    /// <see cref="FailFileRead"/>).
    /// </summary>
    /// <param name="fileName">The dropped file's name, or null.</param>
    /// <param name="contentType">The dropped file's MIME type, or null.</param>
    public bool TryAcceptDroppedFile(string? fileName, string? contentType)
    {
        if (ImportValidator.IsJsonFile(fileName, contentType))
        {
            SetParseError(null);
            return true;
        }

        SetParseError(ImportParseError.InvalidFileType);
        return false;
    }

    /// <summary>Validate text read from a chosen / dropped file (web <c>handleFileImport</c> success path).</summary>
    /// <param name="text">The file's text.</param>
    public void ImportFileText(string text) => HandleValidate(text);

    /// <summary>Surface the file-read error (web <c>handleFileImport</c> <c>catch</c> → <c>setParseError(readError)</c>).</summary>
    public void FailFileRead() => SetParseError(ImportParseError.ReadError);

    /// <summary>Return from the preview to the input tabs (web <c>handleBackToInput</c>).</summary>
    public void Back()
    {
        SetValidation(null);
        SetParseError(null);
    }

    /// <summary>
    /// Confirm the import (web <c>handleConfirm</c>): when a validated dashboard exists, record the diagnostic,
    /// raise <see cref="Confirmed"/> with it, and close the modal (web <c>onConfirm(dashboard); handleClose()</c>).
    /// </summary>
    public void Confirm()
    {
        if (_validation?.Dashboard is { } dashboard)
        {
            _diagnostics.RecordImported();
            Confirmed?.Invoke(this, dashboard);
            CloseInternal();
        }
    }

    /// <summary>Dismiss the modal (web <c>onClose</c> / the close "X"): reset the input state, then close.</summary>
    public void RequestClose() => CloseInternal();

    private void HandleValidate(string raw)
    {
        SetParseError(null);
        if (string.IsNullOrWhiteSpace(raw))
        {
            SetParseError(ImportParseError.EmptyInput);
            return;
        }

        SetValidation(ImportValidator.Validate(raw, _identity));
    }

    private void CloseInternal()
    {
        ResetState();
        CloseRequested?.Invoke(this, EventArgs.Empty);
    }

    private void ResetState()
    {
        _didAutoValidate = false;
        ActiveTab = ImportPreviewTab.File;
        PastedJson = string.Empty;
        ImportUrl = string.Empty;
        IsDragOver = false;
        SetParseError(null);
        SetValidation(null);
    }

    private void SetValidation(ImportValidation? validation)
    {
        _validation = validation;
        Raise(nameof(Validation));
        Raise(nameof(HasValidation));
        Raise(nameof(Title));
        Raise(nameof(ErrorLines));
        Raise(nameof(WarningLines));
        Raise(nameof(HasErrors));
        Raise(nameof(HasWarnings));
        Raise(nameof(WidgetRows));
        Raise(nameof(HasDashboard));
        Raise(nameof(DashboardName));
        Raise(nameof(AvailableBadge));
        Raise(nameof(ShowMissingBadge));
        Raise(nameof(MissingBadge));
        Raise(nameof(CanConfirm));
        Raise(nameof(PreviewModel));
    }

    private void SetParseError(ImportParseError? parseError)
    {
        if (_parseError == parseError)
        {
            return;
        }

        _parseError = parseError;
        Raise(nameof(HasParseError));
        Raise(nameof(ParseErrorText));
    }

    private bool Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return false;
        }

        field = value;
        Raise(name);
        return true;
    }

    private void Raise(string? name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
