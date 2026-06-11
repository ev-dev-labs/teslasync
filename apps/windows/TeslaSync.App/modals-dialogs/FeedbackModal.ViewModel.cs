using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="FeedbackModal"/> view — the native port of the web
/// <c>FeedbackModal</c> component (web/src/components/feedback/FeedbackModal.tsx). It owns the editable fields
/// (category / title / body and the two attach toggles — the web <c>useState</c> values), captures the
/// auto-attached <see cref="FeedbackContext"/> when the modal opens (the web synchronous reads of
/// <c>useLocation()</c> / <c>navigator</c> / <c>import.meta.env</c> / <c>getRecentReportsForFeedback()</c>), runs
/// the zod-equivalent title / body validation behind the submit gate, and drives the submit mutation (web
/// <c>useSubmitFeedback</c>). The web component is a write-only modal — there is no read query, so the surface
/// never shows a loading / stale / offline state; its states are the editable form, the per-field validation
/// errors, the in-flight (submitting) state, the inline + toast submit failure, and the success-and-close path.
/// The auto-attached context resolves synchronously, so its only "empty" branch is a friendly <c>unknown</c>
/// fallback for a missing value. Drive it from one confinement (the UI thread); it is not internally
/// synchronised.
/// </summary>
public sealed class FeedbackModalViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IFeedbackSubmitSource _submit;
    private readonly IFeedbackContextSource _contextSource;
    private readonly ILocalizer _localizer;
    private readonly FeedbackModalDiagnostics _diagnostics;
    private readonly CancellationTokenSource _cts = new();

    private FeedbackContext _context = FeedbackContext.Empty;
    private FeedbackCategory _category = FeedbackCategory.Bug;
    private string _title = string.Empty;
    private string _body = string.Empty;
    private bool _includeRecentErrors = true;
    private bool _includeConsoleTail;
    private bool _titleTouched;
    private bool _bodyTouched;
    private string? _titleError;
    private string? _bodyError;
    private bool _isSubmitting;
    private bool _submitFailed;
    private bool _disposed;

    /// <summary>Creates the holder over its submit + context sources, localizer and (optional) diagnostics sink.</summary>
    /// <param name="submit">The feedback submit mutation port (web <c>useSubmitFeedback</c>).</param>
    /// <param name="contextSource">The auto-attached-context port (web <c>useLocation</c> + reporter ring + env).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink (defaults to a no-op collector).</param>
    public FeedbackModalViewModel(
        IFeedbackSubmitSource submit,
        IFeedbackContextSource contextSource,
        ILocalizer localizer,
        FeedbackModalDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(submit);
        ArgumentNullException.ThrowIfNull(contextSource);
        ArgumentNullException.ThrowIfNull(localizer);

        _submit = submit;
        _contextSource = contextSource;
        _localizer = localizer;
        _diagnostics = diagnostics ?? new FeedbackModalDiagnostics();

        CategoryOptions = FeedbackModalProjection.CategoryOptions(localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised with a localized message for the toast surface (web <c>useSubmitFeedback</c> success / error).</summary>
    public event EventHandler<FeedbackModalToast>? ToastRequested;

    /// <summary>Raised when the modal should close (web <c>onClose()</c>): after a successful submit or a cancel.</summary>
    public event EventHandler? CloseRequested;

    // ── Static content (web inline arrays) ───────────────────────────────────────────────────────────────

    /// <summary>The category dropdown options (bug / feature / other) with localized labels.</summary>
    public IReadOnlyList<FeedbackCategoryOption> CategoryOptions { get; }

    // ── Header / field copy (the Narrator-label source) ──────────────────────────────────────────────────

    /// <summary>Modal title (web <c>Report a bug / Send feedback</c>).</summary>
    public string ModalTitle => FeedbackModalRegistration.ModalTitle(_localizer);

    /// <summary>Category field label (web <c>What kind of feedback?</c>).</summary>
    public string CategoryLabel => FeedbackModalRegistration.CategoryLabel(_localizer);

    /// <summary>Title field label (web <c>Title</c>).</summary>
    public string TitleLabel => FeedbackModalRegistration.TitleLabel(_localizer);

    /// <summary>Title field prompt (the web input hint).</summary>
    public string TitlePrompt => FeedbackModalRegistration.TitlePrompt(_localizer);

    /// <summary>Body field label (web <c>Details</c>).</summary>
    public string BodyLabel => FeedbackModalRegistration.BodyLabel(_localizer);

    /// <summary>Body field prompt (the web input hint).</summary>
    public string BodyPrompt => FeedbackModalRegistration.BodyPrompt(_localizer);

    /// <summary>Auto-attached context panel title (web <c>Auto-attached context</c>).</summary>
    public string ContextTitle => FeedbackModalRegistration.ContextTitle(_localizer);

    /// <summary>Context page-route row label (web <c>Page</c>).</summary>
    public string ContextPageLabel => FeedbackModalRegistration.ContextPageLabel(_localizer);

    /// <summary>Context app-version row label (web <c>App version</c>).</summary>
    public string ContextAppVersionLabel => FeedbackModalRegistration.ContextAppVersionLabel(_localizer);

    /// <summary>Context runtime row label (web <c>Browser</c>, adapted to the Windows idiom "System").</summary>
    public string ContextRuntimeLabel => FeedbackModalRegistration.ContextRuntimeLabel(_localizer);

    /// <summary>Recent-errors toggle hint (web <c>feedback.form.includeErrorsHint</c>).</summary>
    public string IncludeErrorsHint => FeedbackModalRegistration.IncludeErrorsHint(_localizer);

    /// <summary>Console / log toggle label (web <c>Attach recent console messages</c>, "console" → "log").</summary>
    public string IncludeConsoleLabel => FeedbackModalRegistration.IncludeConsoleLabel(_localizer);

    /// <summary>Console / log toggle hint (web <c>feedback.form.includeConsoleHint</c>).</summary>
    public string IncludeConsoleHint => FeedbackModalRegistration.IncludeConsoleHint(_localizer);

    /// <summary>Inline submit-failure message (web <c>feedback.submitError</c>).</summary>
    public string SubmitErrorText => FeedbackModalRegistration.SubmitError(_localizer);

    /// <summary>Cancel button label (web <c>Cancel</c>).</summary>
    public string CancelLabel => FeedbackModalRegistration.CancelLabel(_localizer);

    /// <summary>The recent-errors toggle label with the captured error count (web <c>Attach recent errors ({{count}})</c>).</summary>
    public string IncludeErrorsLabel =>
        FeedbackModalRegistration.IncludeErrorsLabel(_localizer, _context.RecentErrorCount);

    /// <summary>The submit button label — busy ("Submitting…") while submitting, idle ("Send feedback") otherwise.</summary>
    public string SubmitLabel => _isSubmitting
        ? FeedbackModalRegistration.SubmittingLabel(_localizer)
        : FeedbackModalRegistration.SubmitLabel(_localizer);

    // ── Auto-attached context (web reads, shown before submit) ───────────────────────────────────────────

    /// <summary>The captured page route (web <c>location.pathname</c>); always present (defaults to <c>/</c>).</summary>
    public string PageRouteDisplay => _context.PageRoute;

    /// <summary>The captured app version, or the <c>unknown</c> fallback when absent (web <c>appVersion || unknown</c>).</summary>
    public string AppVersionDisplay => string.IsNullOrEmpty(_context.AppVersion)
        ? FeedbackModalRegistration.ContextUnknown(_localizer)
        : _context.AppVersion;

    /// <summary>The captured runtime descriptor, or the <c>unknown</c> fallback when absent (web <c>userAgent || unknown</c>).</summary>
    public string RuntimeDisplay => string.IsNullOrEmpty(_context.Runtime)
        ? FeedbackModalRegistration.ContextUnknown(_localizer)
        : _context.Runtime;

    /// <summary>The number of captured recent errors available to attach.</summary>
    public int RecentErrorCount => _context.RecentErrorCount;

    // ── Editable fields (web useState) ───────────────────────────────────────────────────────────────────

    /// <summary>The chosen category (web <c>category</c>; default bug).</summary>
    public FeedbackCategory Category
    {
        get => _category;
        set => Set(ref _category, value);
    }

    /// <summary>The feedback title (required, 5..120). Editing it re-validates the title field.</summary>
    public string Title
    {
        get => _title;
        set
        {
            if (Set(ref _title, value ?? string.Empty))
            {
                RecomputeValidation();
            }
        }
    }

    /// <summary>The feedback body (required, 20..4000). Editing it re-validates the body field.</summary>
    public string Body
    {
        get => _body;
        set
        {
            if (Set(ref _body, value ?? string.Empty))
            {
                RecomputeValidation();
            }
        }
    }

    /// <summary>Whether to attach the captured recent errors (web <c>includeRecentErrors</c>; default on).</summary>
    public bool IncludeRecentErrors
    {
        get => _includeRecentErrors;
        set => Set(ref _includeRecentErrors, value);
    }

    /// <summary>Whether to attach the captured console / log tail (web <c>includeConsoleTail</c>; default off).</summary>
    public bool IncludeConsoleTail
    {
        get => _includeConsoleTail;
        set => Set(ref _includeConsoleTail, value);
    }

    // ── Validation state (web touched + zod errors) ──────────────────────────────────────────────────────

    /// <summary>The title validation message shown when the field is touched and invalid, else null.</summary>
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

    /// <summary>The body validation message shown when the field is touched and invalid, else null.</summary>
    public string? BodyError
    {
        get => _bodyError;
        private set
        {
            if (Set(ref _bodyError, value))
            {
                Raise(nameof(HasBodyError));
            }
        }
    }

    /// <summary>True while a title validation error should render against the title field.</summary>
    public bool HasTitleError => _titleError is not null;

    /// <summary>True while a body validation error should render against the body field.</summary>
    public bool HasBodyError => _bodyError is not null;

    // ── Interaction state ────────────────────────────────────────────────────────────────────────────────

    /// <summary>True while the submit mutation is in flight (web <c>submit.isPending</c>): buttons disabled.</summary>
    public bool IsSubmitting
    {
        get => _isSubmitting;
        private set
        {
            if (Set(ref _isSubmitting, value))
            {
                Raise(nameof(SubmitLabel));
                Raise(nameof(CanSubmit));
            }
        }
    }

    /// <summary>True once a submit has failed, surfacing the inline alert (web <c>submit.isError</c>).</summary>
    public bool SubmitFailed
    {
        get => _submitFailed;
        private set => Set(ref _submitFailed, value);
    }

    /// <summary>
    /// True when the submit button is enabled — the form satisfies the zod schema and no submit is in flight
    /// (web <c>disabled={isSubmitting || !validation.success}</c>).
    /// </summary>
    public bool CanSubmit => !_isSubmitting && FeedbackModalProjection.IsValid(_title, _body);

    // ── Commands ─────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Capture the auto-attached context (web mount reads) and emit the <c>view.opened</c> diagnostics event.
    /// Re-projects every context-dependent label so the panel reflects the snapshot.
    /// </summary>
    public void NotifyOpened()
    {
        if (_disposed)
        {
            return;
        }

        _context = _contextSource.Capture() ?? FeedbackContext.Empty;
        Raise(nameof(PageRouteDisplay));
        Raise(nameof(AppVersionDisplay));
        Raise(nameof(RuntimeDisplay));
        Raise(nameof(RecentErrorCount));
        Raise(nameof(IncludeErrorsLabel));
        _diagnostics.RecordViewOpened();
    }

    /// <summary>Mark the title field as touched (web <c>onBlur</c>), surfacing any pending validation error.</summary>
    public void MarkTitleTouched()
    {
        if (!_titleTouched)
        {
            _titleTouched = true;
            RecomputeValidation();
        }
    }

    /// <summary>Mark the body field as touched (web <c>onBlur</c>), surfacing any pending validation error.</summary>
    public void MarkBodyTouched()
    {
        if (!_bodyTouched)
        {
            _bodyTouched = true;
            RecomputeValidation();
        }
    }

    /// <summary>
    /// Validate and submit the feedback (web <c>onSubmit</c>). It marks both fields touched, and an invalid form
    /// surfaces the field errors without submitting; otherwise the submit mutation runs, a success records the
    /// diagnostic, raises the success toast and a close request, and a failure raises the inline alert + error
    /// toast and keeps the modal open. Returns true only when the feedback was submitted (the view then closes).
    /// </summary>
    public async Task<bool> SubmitAsync(CancellationToken cancellationToken = default)
    {
        if (_isSubmitting || _disposed)
        {
            return false;
        }

        _titleTouched = true;
        _bodyTouched = true;
        RecomputeValidation();

        if (!FeedbackModalProjection.IsValid(_title, _body))
        {
            return false;
        }

        SubmitFailed = false;
        IsSubmitting = true;
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(_cts.Token, cancellationToken);
        try
        {
            var request = FeedbackModalProjection.BuildRequest(
                _category, _title, _body, _context, _includeRecentErrors, _includeConsoleTail);
            var outcome = await _submit.SubmitAsync(request, linked.Token).ConfigureAwait(false);
            if (outcome.Success)
            {
                _diagnostics.RecordFeedbackSubmitted();
                RaiseToast(FeedbackModalRegistration.SuccessMessage(_localizer), isError: false);
                RaiseClose();
                return true;
            }

            SubmitFailed = true;
            RaiseToast(FeedbackModalRegistration.SubmitError(_localizer), isError: true);
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

    /// <summary>Dismiss the modal without submitting (web <c>Cancel</c> / <c>onClose</c>).</summary>
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

    private void RecomputeValidation()
    {
        TitleError = _titleTouched && !FeedbackModalProjection.IsTitleValid(_title)
            ? FeedbackModalRegistration.TitleErrorMessage(_localizer)
            : null;
        BodyError = _bodyTouched && !FeedbackModalProjection.IsBodyValid(_body)
            ? FeedbackModalRegistration.BodyErrorMessage(_localizer)
            : null;
        Raise(nameof(CanSubmit));
    }

    private void RaiseToast(string message, bool isError) =>
        ToastRequested?.Invoke(this, new FeedbackModalToast(message, isError));

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
