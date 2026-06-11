using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="AcknowledgeAlertDialog"/> view — the native port of
/// the web <c>AcknowledgeAlertDialog</c> component (web/src/features/admin/components/AcknowledgeAlertDialog.tsx).
/// It owns the single editable field (the note — the web <c>note</c> <c>useState</c>), the host-driven
/// <see cref="Submitting"/> flag (the web <c>submitting</c> prop) and the optional acked-alert title shown as a
/// subtitle, and drives the acknowledge / cancel callbacks behind the note-length gate
/// (web <c>tooLong = trimmed.length > NOTE_MAX</c> + the <c>if (submitting || tooLong) return</c> guard in
/// <c>handleSubmit</c>). The actual ack mutation is owned by the parent (web <c>AlertsPage</c>), so this surface
/// is a pure callback form with no read query — it never shows a loading / empty / error / stale / offline state;
/// its states are the editable note, the too-long validation error, the in-flight (submitting) disabled state and
/// the optional subtitle. Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class AcknowledgeAlertDialogViewModel : INotifyPropertyChanged
{
    private readonly ILocalizer _localizer;
    private readonly AcknowledgeAlertDiagnostics _diagnostics;

    private string _note = string.Empty;
    private bool _submitting;

    /// <summary>Creates the holder over the optional acked-alert title, the localizer and a diagnostics sink.</summary>
    /// <param name="alertTitle">The title of the alert being acked, shown as a subtitle for context (web
    /// <c>alertTitle</c>); null / empty hides the subtitle.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink (defaults to a no-op collector).</param>
    public AcknowledgeAlertDialogViewModel(
        string? alertTitle,
        ILocalizer localizer,
        AcknowledgeAlertDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        AlertTitle = (alertTitle ?? string.Empty).Trim();
        _localizer = localizer;
        _diagnostics = diagnostics ?? new AcknowledgeAlertDiagnostics();
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised when the user acknowledges the alert (web <c>onSubmit(trimmed)</c>).</summary>
    public event EventHandler<AcknowledgeAlertDraft>? AcknowledgeRequested;

    /// <summary>Raised when the dialog should close without acknowledging (web <c>onClose()</c>).</summary>
    public event EventHandler? CloseRequested;

    // ── Context ──────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>The acked alert's title shown as a subtitle (web <c>alertTitle</c>); empty when absent.</summary>
    public string AlertTitle { get; }

    /// <summary>True when an <see cref="AlertTitle"/> subtitle should render (web <c>alertTitle ? … : null</c>).</summary>
    public bool HasAlertTitle => AlertTitle.Length > 0;

    // ── Header / field copy (the Narrator-label source) ──────────────────────────────────────────────────

    /// <summary>Dialog title (web <c>Acknowledge alert</c>).</summary>
    public string Title => AcknowledgeAlertRegistration.DialogTitle(_localizer);

    /// <summary>Note field label (web <c>Note (optional)</c>).</summary>
    public string NoteLabel => AcknowledgeAlertRegistration.NoteLabel(_localizer);

    /// <summary>Note field input hint (web <c>Optional: what's being done?</c>).</summary>
    public string NotePrompt => AcknowledgeAlertRegistration.NotePrompt(_localizer);

    /// <summary>Cancel button label (web <c>Cancel</c>).</summary>
    public string CancelLabel => AcknowledgeAlertRegistration.CancelLabel(_localizer);

    /// <summary>Acknowledge (submit) button label (web <c>Acknowledge</c>).</summary>
    public string SubmitLabel => AcknowledgeAlertRegistration.SubmitLabel(_localizer);

    /// <summary>The always-shown note hint with the character cap interpolated (web <c>noteHint</c>).</summary>
    public string NoteHint =>
        AcknowledgeAlertRegistration.NoteHint(_localizer, AcknowledgeAlertRegistration.NoteMaxLength);

    /// <summary>
    /// The too-long validation message shown against the field when <see cref="TooLong"/> is set, else null. It
    /// reuses the note hint copy (web <c>error={tooLong ? t('alerts.ack.noteHint', …) : undefined}</c>).
    /// </summary>
    public string? NoteError => TooLong ? NoteHint : null;

    // ── Editable field (web useState) ────────────────────────────────────────────────────────────────────

    /// <summary>
    /// The acknowledgement note (trimmed before submit; the editable text may run up to
    /// <see cref="AcknowledgeAlertRegistration.NoteInputMaxLength"/>). Editing it re-evaluates the too-long gate.
    /// </summary>
    public string Note
    {
        get => _note;
        set
        {
            bool wasTooLong = TooLong;
            if (Set(ref _note, value ?? string.Empty))
            {
                Raise(nameof(CanSubmit));
                if (TooLong != wasTooLong)
                {
                    Raise(nameof(TooLong));
                    Raise(nameof(HasNoteError));
                    Raise(nameof(NoteError));
                }
            }
        }
    }

    /// <summary>
    /// True while the parent's ack mutation is in flight (web <c>submitting</c> prop). The host sets it; it
    /// disables both buttons (<see cref="CanSubmit"/> / <see cref="CanCancel"/>) and blocks dismissal.
    /// </summary>
    public bool Submitting
    {
        get => _submitting;
        set
        {
            if (Set(ref _submitting, value))
            {
                Raise(nameof(CanSubmit));
                Raise(nameof(CanCancel));
            }
        }
    }

    // ── Interaction state ────────────────────────────────────────────────────────────────────────────────

    /// <summary>True once the trimmed note exceeds the cap (web <c>tooLong</c>): the field shows the error.</summary>
    public bool TooLong => AcknowledgeAlertProjection.IsTooLong(_note);

    /// <summary>True while a too-long error should render against the note field.</summary>
    public bool HasNoteError => TooLong;

    /// <summary>
    /// True when the Acknowledge button is enabled — not submitting and within the length cap
    /// (web <c>disabled={submitting || tooLong}</c>).
    /// </summary>
    public bool CanSubmit => !_submitting && !TooLong;

    /// <summary>True when the Cancel button is enabled — not submitting (web <c>disabled={submitting}</c>).</summary>
    public bool CanCancel => !_submitting;

    // ── Commands ─────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Reset the note and clear the submitting flag (web open <c>useEffect</c> — stale text from a previous alert
    /// would be confusing), then record the <c>view.opened</c> diagnostics event. Call when the dialog opens.
    /// </summary>
    public void NotifyOpened()
    {
        Note = string.Empty;
        Submitting = false;
        _diagnostics.RecordViewOpened();
    }

    /// <summary>
    /// Validate and emit the acknowledgement (web <c>handleSubmit</c>). While submitting or over the length cap it
    /// is a no-op (the web <c>if (submitting || tooLong) return</c>); otherwise it raises
    /// <see cref="AcknowledgeRequested"/> with the trimmed note (which may be empty) and records the diagnostics
    /// counter. Returns true only when an acknowledgement was emitted (the view then lets the dialog close).
    /// </summary>
    public bool Submit()
    {
        if (!CanSubmit)
        {
            return false;
        }

        AcknowledgeRequested?.Invoke(this, AcknowledgeAlertProjection.BuildDraft(_note));
        _diagnostics.RecordAcknowledged();
        return true;
    }

    /// <summary>
    /// Dismiss the dialog without acknowledging (web <c>onClose</c>, guarded by <c>!submitting</c>). While
    /// submitting it is a no-op so an in-flight ack cannot be abandoned mid-write. Returns true when the close was
    /// raised.
    /// </summary>
    public bool RequestClose()
    {
        if (_submitting)
        {
            return false;
        }

        CloseRequested?.Invoke(this, EventArgs.Empty);
        return true;
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
