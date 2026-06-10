using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="IncidentForm"/> view — the native port of the web
/// <c>IncidentForm</c> component (web/src/features/system/components/status/IncidentForm.tsx). It owns the five
/// editable fields (title / severity / status / affected components / initial message — the web
/// <c>useState</c> values), the two static dropdown option lists (web inline option arrays) and drives the
/// create mutation behind its client-side title gate (web <c>useCreateIncident</c> + the <c>t.length &lt; 3</c>
/// guard). The web component is a write-only modal — there is no read query, so the surface never shows a
/// loading / empty / stale / offline state; its states are idle, the title-validation error, the in-flight
/// (submitting) state, and the success / failure feedback the web raises through <c>useToast</c>. Drive it from
/// one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class IncidentFormViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IIncidentCreateSource _source;
    private readonly ILocalizer _localizer;
    private readonly IncidentFormDiagnostics _diagnostics;
    private readonly CancellationTokenSource _cts = new();

    private string _title = string.Empty;
    private IncidentSeverity _severity = IncidentSeverity.Minor;
    private IncidentStatus _status = IncidentStatus.Investigating;
    private string _components = string.Empty;
    private string _message = string.Empty;
    private string? _titleError;
    private bool _isSubmitting;
    private bool _disposed;

    /// <summary>Creates the holder over its create source, localizer and (optional) diagnostics sink.</summary>
    /// <param name="source">The create-incident mutation port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink (defaults to a no-op collector).</param>
    public IncidentFormViewModel(
        IIncidentCreateSource source,
        ILocalizer localizer,
        IncidentFormDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _source = source;
        _localizer = localizer;
        _diagnostics = diagnostics ?? new IncidentFormDiagnostics();

        SeverityOptions = IncidentFormProjection.SeverityOptions(localizer);
        StatusOptions = IncidentFormProjection.StatusOptions(localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised with a localized message for the toast surface (web <c>useToast</c> success / error).</summary>
    public event EventHandler<IncidentFormToast>? ToastRequested;

    /// <summary>Raised when the modal should close (web <c>onClose()</c>): after a successful submit or a cancel.</summary>
    public event EventHandler? CloseRequested;

    // ── Static content (web inline option arrays) ────────────────────────────────────────────────────────

    /// <summary>The severity dropdown options (minor / major / critical) with localized labels.</summary>
    public IReadOnlyList<IncidentSeverityOption> SeverityOptions { get; }

    /// <summary>The status dropdown options (investigating / identified / monitoring / resolved).</summary>
    public IReadOnlyList<IncidentStatusOption> StatusOptions { get; }

    // ── Header / field copy ──────────────────────────────────────────────────────────────────────────────

    /// <summary>Modal title (web <c>Log an incident</c>).</summary>
    public string ModalTitle => IncidentFormRegistration.ModalTitle(_localizer);

    /// <summary>Title field label (web <c>Title</c>).</summary>
    public string TitleLabel => IncidentFormRegistration.TitleLabel(_localizer);

    /// <summary>Title field prompt.</summary>
    public string TitlePrompt => IncidentFormRegistration.TitlePrompt(_localizer);

    /// <summary>Severity field label (web <c>Severity</c>).</summary>
    public string SeverityLabel => IncidentFormRegistration.SeverityLabel(_localizer);

    /// <summary>Status field label (web <c>Status</c>).</summary>
    public string StatusLabel => IncidentFormRegistration.StatusLabel(_localizer);

    /// <summary>Affected-components field label (web <c>Affected components</c>).</summary>
    public string ComponentsLabel => IncidentFormRegistration.ComponentsLabel(_localizer);

    /// <summary>Affected-components helper note (web <c>(comma-separated, optional)</c>).</summary>
    public string ComponentsHint => IncidentFormRegistration.ComponentsHint(_localizer);

    /// <summary>Affected-components prompt.</summary>
    public string ComponentsPrompt => IncidentFormRegistration.ComponentsPrompt(_localizer);

    /// <summary>Initial-message field label (web <c>Initial timeline message</c>).</summary>
    public string MessageLabel => IncidentFormRegistration.MessageLabel(_localizer);

    /// <summary>Initial-message helper note (web <c>(optional)</c>).</summary>
    public string MessageHint => IncidentFormRegistration.MessageHint(_localizer);

    /// <summary>Initial-message prompt.</summary>
    public string MessagePrompt => IncidentFormRegistration.MessagePrompt(_localizer);

    /// <summary>Cancel button label (web <c>Cancel</c>).</summary>
    public string CancelLabel => IncidentFormRegistration.CancelLabel(_localizer);

    /// <summary>The submit button label — busy ("Logging…") while submitting, idle ("Log incident") otherwise.</summary>
    public string SubmitLabel => _isSubmitting
        ? IncidentFormRegistration.SubmittingLabel(_localizer)
        : IncidentFormRegistration.SubmitLabel(_localizer);

    // ── Editable fields (web useState) ───────────────────────────────────────────────────────────────────

    /// <summary>The incident title (required, 3..200). Editing it clears any prior validation error.</summary>
    public string Title
    {
        get => _title;
        set
        {
            if (Set(ref _title, value ?? string.Empty) && _titleError is not null)
            {
                TitleError = null;
            }
        }
    }

    /// <summary>The chosen severity (web <c>severity</c>; default minor).</summary>
    public IncidentSeverity Severity
    {
        get => _severity;
        set => Set(ref _severity, value);
    }

    /// <summary>The chosen lifecycle status (web <c>status</c>; default investigating).</summary>
    public IncidentStatus Status
    {
        get => _status;
        set => Set(ref _status, value);
    }

    /// <summary>The raw comma-separated affected-components text (web <c>components</c>).</summary>
    public string Components
    {
        get => _components;
        set => Set(ref _components, value ?? string.Empty);
    }

    /// <summary>The raw initial-message text (web <c>message</c>).</summary>
    public string Message
    {
        get => _message;
        set => Set(ref _message, value ?? string.Empty);
    }

    // ── Interaction state ────────────────────────────────────────────────────────────────────────────────

    /// <summary>The client-side title validation message, or null when the title is valid / untouched.</summary>
    public string? TitleError
    {
        get => _titleError;
        private set
        {
            if (Set(ref _titleError, value))
            {
                Raise(nameof(HasTitleError));
            }
        }
    }

    /// <summary>True while a title validation error should render against the title field.</summary>
    public bool HasTitleError => _titleError is not null;

    /// <summary>True while the create mutation is in flight (web <c>create.isPending</c>): buttons disabled.</summary>
    public bool IsSubmitting
    {
        get => _isSubmitting;
        private set
        {
            if (Set(ref _isSubmitting, value))
            {
                Raise(nameof(SubmitLabel));
            }
        }
    }

    // ── Commands ─────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>Record that the surface was opened (web mount) — emits the <c>view.opened</c> diagnostics event.</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>
    /// Validate and submit the form (web <c>handleSubmit</c>). A too-short title surfaces the validation toast
    /// and field error without submitting; otherwise the create mutation runs, a success raises the success
    /// toast and a close request, and a failure raises the error toast and keeps the form open. Returns true
    /// only when the incident was created (the view then lets the modal close).
    /// </summary>
    public async Task<bool> SubmitAsync(CancellationToken cancellationToken = default)
    {
        if (_isSubmitting || _disposed)
        {
            return false;
        }

        if (!IncidentFormProjection.IsTitleValid(_title))
        {
            string message = IncidentFormRegistration.TitleTooShortMessage(_localizer);
            TitleError = message;
            RaiseToast(message, isError: true);
            return false;
        }

        TitleError = null;
        IsSubmitting = true;
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(_cts.Token, cancellationToken);
        try
        {
            var request = IncidentFormProjection.BuildRequest(_title, _severity, _status, _components, _message);
            var outcome = await _source.CreateAsync(request, linked.Token).ConfigureAwait(false);
            if (outcome.Success)
            {
                _diagnostics.RecordIncidentLogged();
                RaiseToast(IncidentFormRegistration.SuccessMessage(_localizer), isError: false);
                RaiseClose();
                return true;
            }

            RaiseToast(IncidentFormRegistration.ErrorMessage(_localizer), isError: true);
            return false;
        }
        catch (OperationCanceledException)
        {
            // Superseded / disposed — leave the surface as-is (web no-ops on an aborted mutation).
            return false;
        }
        finally
        {
            IsSubmitting = false;
        }
    }

    /// <summary>Dismiss the form without submitting (web <c>Cancel</c> / <c>onClose</c>).</summary>
    public void RequestClose()
    {
        if (_isSubmitting)
        {
            return;
        }

        RaiseClose();
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _cts.Cancel();
        _cts.Dispose();
    }

    private void RaiseToast(string message, bool isError) =>
        ToastRequested?.Invoke(this, new IncidentFormToast(message, isError));

    private void RaiseClose() => CloseRequested?.Invoke(this, EventArgs.Empty);

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
