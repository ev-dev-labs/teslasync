using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="ReauthDialog"/> view — the native port of the
/// web <c>ReauthDialogRoot</c> + pure <c>ReauthDialog</c> composition
/// (web/src/components/feedback/ReauthDialog.tsx). It observes the shared <see cref="IReauthChallengeBroker"/>
/// (web module queue + <c>useReauthDialogState</c>), resolves the dialog <see cref="Mode"/> from the
/// deployment auth mode (web <c>useSessionMonitor</c>), derives <see cref="TotpTabAvailable"/> from the
/// per-user TOTP status (web <c>useTOTPStatus</c>), owns the form working state (active tab, password, code,
/// typed confirmation, submitting, error), and routes submit/cancel back to the queue — so the view is a
/// thin renderer. Every label resolves through the i18n facade. Drive it from one confinement (the UI
/// thread); it is not internally synchronised.
/// </summary>
public sealed class ReauthDialogViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IReauthChallengeBroker _queue;
    private readonly ISessionAuthModeSource _modeSource;
    private readonly ITotpStatusSource _totpSource;
    private readonly IReauthSubmitter _submitter;
    private readonly ILocalizer _localizer;

    private ReauthChallenge? _lastActive;
    private CancellationTokenSource? _initCts;

    private bool _isOpen;
    private ReauthDialogMode _mode = ReauthDialogMode.Credential;
    private ReauthTab _activeTab = ReauthTab.Password;
    private string _password = string.Empty;
    private string _totp = string.Empty;
    private string _confirmText = string.Empty;
    private bool _isSubmitting;
    private string? _errorMessage;
    private bool _totpTabAvailable = true;
    private bool _totpEnrolled;

    // TOTP status tracking (web isFetched / isError / data).
    private bool _totpFetched;
    private bool _totpError;
    private TotpStatusSnapshot? _totpSnapshot;

    private bool _disposed;

    /// <summary>Creates the holder over the challenge queue, data sources, submitter and i18n facade.</summary>
    public ReauthDialogViewModel(
        IReauthChallengeBroker queue,
        ISessionAuthModeSource modeSource,
        ITotpStatusSource totpSource,
        IReauthSubmitter submitter,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(queue);
        ArgumentNullException.ThrowIfNull(modeSource);
        ArgumentNullException.ThrowIfNull(totpSource);
        ArgumentNullException.ThrowIfNull(submitter);
        ArgumentNullException.ThrowIfNull(localizer);

        _queue = queue;
        _modeSource = modeSource;
        _totpSource = totpSource;
        _submitter = submitter;
        _localizer = localizer;

        _queue.Changed += OnQueueChanged;
        SyncFromQueue();
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>True while a challenge is active and the dialog should be shown (web <c>open</c>).</summary>
    public bool IsOpen
    {
        get => _isOpen;
        private set => Set(ref _isOpen, value);
    }

    /// <summary>The resolved dialog mode (web derived from <c>monitor.mode</c>).</summary>
    public ReauthDialogMode Mode
    {
        get => _mode;
        private set
        {
            if (Set(ref _mode, value))
            {
                // Mode-dependent labels and section visibility change with the mode.
                Raise(nameof(IsCredentialMode));
                Raise(nameof(IsConfirmMode));
                Raise(nameof(Title));
                Raise(nameof(BodyText));
                Raise(nameof(SubmitLabel));
            }
        }
    }

    /// <summary>True when the credential (forward-auth) form is shown.</summary>
    public bool IsCredentialMode => _mode == ReauthDialogMode.Credential;

    /// <summary>True when the typed-confirmation (open-mode) form is shown.</summary>
    public bool IsConfirmMode => _mode == ReauthDialogMode.Confirm;

    /// <summary>The active credential tab (web <c>activeTab</c>).</summary>
    public ReauthTab ActiveTab
    {
        get => _activeTab;
        private set
        {
            if (Set(ref _activeTab, value))
            {
                Raise(nameof(IsPasswordTab));
                Raise(nameof(IsTotpTab));
            }
        }
    }

    /// <summary>True when the password tab is active.</summary>
    public bool IsPasswordTab => _activeTab == ReauthTab.Password;

    /// <summary>True when the authenticator tab is active.</summary>
    public bool IsTotpTab => _activeTab == ReauthTab.Totp;

    /// <summary>The password field text (web <c>password</c>).</summary>
    public string Password
    {
        get => _password;
        set => Set(ref _password, value ?? string.Empty);
    }

    /// <summary>The authenticator field text — sanitized to at most 8 digits (web onChange replace/slice).</summary>
    public string Totp
    {
        get => _totp;
        set => Set(ref _totp, Sanitize(value));
    }

    /// <summary>The typed-confirmation field text (web <c>confirmText</c>).</summary>
    public string ConfirmText
    {
        get => _confirmText;
        set => Set(ref _confirmText, value ?? string.Empty);
    }

    /// <summary>True while a credential submission is in flight (web <c>submitting</c>).</summary>
    public bool IsSubmitting
    {
        get => _isSubmitting;
        private set => Set(ref _isSubmitting, value);
    }

    /// <summary>The localized error message, or <c>null</c> when there is none (web <c>error</c>).</summary>
    public string? ErrorMessage
    {
        get => _errorMessage;
        private set
        {
            if (Set(ref _errorMessage, value))
            {
                Raise(nameof(HasError));
            }
        }
    }

    /// <summary>True when an error message is being shown.</summary>
    public bool HasError => _errorMessage is { Length: > 0 };

    /// <summary>Whether the authenticator tab is shown (web <c>totpTabAvailable</c>).</summary>
    public bool TotpTabAvailable
    {
        get => _totpTabAvailable;
        private set => Set(ref _totpTabAvailable, value);
    }

    /// <summary>Whether per-user TOTP is enrolled, routing codes to the per-user endpoint (web <c>totpEnrolled</c>).</summary>
    public bool TotpEnrolled
    {
        get => _totpEnrolled;
        private set => Set(ref _totpEnrolled, value);
    }

    /// <summary>Total queued + active challenges (web <c>total</c>).</summary>
    public int PendingTotal => _queue.Total;

    /// <summary>The diagnostics surface slug this view registers under.</summary>
    public static string Slug => ReauthDialogRegistration.Slug;

    /// <summary>The last initialization run started on open; await it in tests for deterministic assertions.</summary>
    public Task InitializationTask { get; private set; } = Task.CompletedTask;

    // ── Localized labels (web t('sudo.*') call sites) ────────────────────────────────────────────────

    /// <summary>Dialog title (web <c>sudo.title</c> / <c>sudo.openMode.title</c>).</summary>
    public string Title => _mode == ReauthDialogMode.Confirm
        ? Tr(ReauthDialogStrings.OpenTitleKey, ReauthDialogStrings.OpenTitleFallback)
        : Tr(ReauthDialogStrings.TitleKey, ReauthDialogStrings.TitleFallback);

    /// <summary>Dialog body text (web <c>sudo.description</c> / <c>sudo.openMode.body</c>).</summary>
    public string BodyText => _mode == ReauthDialogMode.Confirm
        ? ReauthDialogStrings.WithToken(Tr(ReauthDialogStrings.OpenBodyKey, ReauthDialogStrings.OpenBodyFallback))
        : Tr(ReauthDialogStrings.DescriptionKey, ReauthDialogStrings.DescriptionFallback);

    /// <summary>Password tab label (web <c>sudo.tabs.password</c>).</summary>
    public string PasswordTabLabel => Tr(ReauthDialogStrings.PasswordTabKey, ReauthDialogStrings.PasswordTabFallback);

    /// <summary>Authenticator tab label (web <c>sudo.tabs.totp</c>).</summary>
    public string TotpTabLabel => Tr(ReauthDialogStrings.TotpTabKey, ReauthDialogStrings.TotpTabFallback);

    /// <summary>Tab strip accessible name (web <c>sudo.tabs.label</c>).</summary>
    public string TabsAriaLabel => Tr(ReauthDialogStrings.TabsAriaKey, ReauthDialogStrings.TabsAriaFallback);

    /// <summary>Password field label (web <c>sudo.passwordLabel</c>).</summary>
    public string PasswordFieldLabel => Tr(ReauthDialogStrings.PasswordLabelKey, ReauthDialogStrings.PasswordLabelFallback);

    /// <summary>Authenticator field label (web <c>sudo.totpLabel</c>).</summary>
    public string TotpFieldLabel => Tr(ReauthDialogStrings.TotpLabelKey, ReauthDialogStrings.TotpLabelFallback);

    /// <summary>Typed-confirmation field label (web <c>sudo.typedConfirmationLabel</c>, interpolated).</summary>
    public string TypedConfirmationFieldLabel =>
        ReauthDialogStrings.WithToken(Tr(ReauthDialogStrings.TypedConfirmationLabelKey, ReauthDialogStrings.TypedConfirmationLabelFallback));

    /// <summary>Credential-mode helper text (web <c>sudo.helper</c>).</summary>
    public string HelperTextValue => Tr(ReauthDialogStrings.HelperKey, ReauthDialogStrings.HelperFallback);

    /// <summary>Cancel button label (web <c>sudo.cancel</c>).</summary>
    public string CancelLabel => Tr(ReauthDialogStrings.CancelKey, ReauthDialogStrings.CancelFallback);

    /// <summary>Submit button label (web <c>sudo.submit</c> / <c>sudo.openMode.submit</c>).</summary>
    public string SubmitLabel => _mode == ReauthDialogMode.Confirm
        ? Tr(ReauthDialogStrings.OpenSubmitKey, ReauthDialogStrings.OpenSubmitFallback)
        : Tr(ReauthDialogStrings.SubmitKey, ReauthDialogStrings.SubmitFallback);

    // ── Commands (web handleSubmit / handleCancel / setActiveTab) ────────────────────────────────────

    /// <summary>Switch the credential tab (web <c>onChange</c>), ignoring the TOTP tab when it is unavailable.</summary>
    public void SetActiveTab(ReauthTab tab)
    {
        if (tab == ReauthTab.Totp && !_totpTabAvailable)
        {
            return;
        }

        ActiveTab = tab;
    }

    /// <summary>
    /// Submit the dialog — the native analogue of the web <c>handleSubmit</c>. In confirm mode it validates
    /// the typed token and resolves locally (no network, no token); in credential mode it validates the
    /// field, submits through the <see cref="IReauthSubmitter"/>, and on success resolves the active
    /// challenge, mapping any coded failure to the right localized error.
    /// </summary>
    public async Task SubmitAsync(CancellationToken cancellationToken = default)
    {
        if (_isSubmitting)
        {
            return;
        }

        if (_mode == ReauthDialogMode.Confirm)
        {
            if (!string.Equals(_confirmText.Trim(), ReauthDialogRegistration.TypedConfirmationToken, StringComparison.Ordinal))
            {
                ErrorMessage = ReauthDialogStrings.WithToken(
                    Tr(ReauthDialogStrings.TypedConfirmationMismatchKey, ReauthDialogStrings.TypedConfirmationMismatchFallback));
                return;
            }

            _queue.ResolveActive(SudoCredential.OpenMode);
            return;
        }

        IsSubmitting = true;
        ErrorMessage = null;
        try
        {
            if (_activeTab == ReauthTab.Password && _password.Trim().Length == 0)
            {
                ErrorMessage = Tr(ReauthDialogStrings.PasswordRequiredKey, ReauthDialogStrings.PasswordRequiredFallback);
                return;
            }

            if (_activeTab == ReauthTab.Totp && _totp.Trim().Length == 0)
            {
                ErrorMessage = Tr(ReauthDialogStrings.TotpRequiredKey, ReauthDialogStrings.TotpRequiredFallback);
                return;
            }

            var body = _activeTab == ReauthTab.Password
                ? SudoSubmitBody.ForPassword(_password)
                : SudoSubmitBody.ForTotp(_totp);

            var outcome = await _submitter.SubmitAsync(body, _totpEnrolled, cancellationToken).ConfigureAwait(false);
            if (outcome.Success && outcome.Credential is { } credential)
            {
                _queue.ResolveActive(credential);
                return;
            }

            ErrorMessage = MapSubmitError(outcome);
        }
        catch (OperationCanceledException)
        {
            // Disposed or superseded — leave the dialog untouched.
        }
        finally
        {
            IsSubmitting = false;
        }
    }

    /// <summary>Dismiss the dialog (web <c>handleCancel</c>), rejecting the active challenge unless a submit is in flight.</summary>
    public void Cancel()
    {
        if (_isSubmitting)
        {
            return;
        }

        _queue.RejectActive(new SudoCanceledException());
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _queue.Changed -= OnQueueChanged;
        CancelInit();
        GC.SuppressFinalize(this);
    }

    private string MapSubmitError(ReauthSubmitOutcome outcome)
    {
        if (string.Equals(outcome.Code, ReauthDialogStrings.ReauthNotConfiguredCode, StringComparison.Ordinal))
        {
            return Tr(ReauthDialogStrings.NotConfiguredKey, ReauthDialogStrings.NotConfiguredFallback);
        }

        if (string.Equals(outcome.Code, ReauthDialogStrings.InvalidCredentialCode, StringComparison.Ordinal))
        {
            return _activeTab == ReauthTab.Password
                ? Tr(ReauthDialogStrings.InvalidPasswordKey, ReauthDialogStrings.InvalidPasswordFallback)
                : Tr(ReauthDialogStrings.InvalidTotpKey, ReauthDialogStrings.InvalidTotpFallback);
        }

        return outcome.Message is { Length: > 0 } message
            ? message
            : Tr(ReauthDialogStrings.UnknownKey, ReauthDialogStrings.UnknownFallback);
    }

    private void OnQueueChanged(object? sender, EventArgs e) => SyncFromQueue();

    private void SyncFromQueue()
    {
        var active = _queue.Active;
        IsOpen = active is not null;
        Raise(nameof(PendingTotal));

        if (ReferenceEquals(active, _lastActive))
        {
            return;
        }

        _lastActive = active;
        if (active is null)
        {
            CancelInit();
            IsSubmitting = false;
            return;
        }

        // A fresh challenge: reset the form so the previous attempt's text never bleeds across actions
        // (web reset effect keyed on open + path), then resolve the mode and TOTP status.
        ResetForm();
        StartInitialization();
    }

    private void ResetForm()
    {
        Password = string.Empty;
        Totp = string.Empty;
        ConfirmText = string.Empty;
        ErrorMessage = null;
        ActiveTab = ReauthTab.Password;
        IsSubmitting = false;
        _totpFetched = false;
        _totpError = false;
        _totpSnapshot = null;
        TotpEnrolled = false;
        TotpTabAvailable = true;
    }

    private void StartInitialization()
    {
        CancelInit();
        _initCts = new CancellationTokenSource();
        InitializationTask = InitializeAsync(_initCts.Token);
    }

    private async Task InitializeAsync(CancellationToken cancellationToken)
    {
        try
        {
            var authMode = await _modeSource.GetModeAsync(cancellationToken).ConfigureAwait(false);
            Mode = authMode == SessionAuthMode.Open ? ReauthDialogMode.Confirm : ReauthDialogMode.Credential;

            // web: the TOTP status query is enabled only in credential mode.
            if (_mode != ReauthDialogMode.Credential)
            {
                return;
            }

            await foreach (var result in _totpSource.StreamAsync(cancellationToken).ConfigureAwait(false))
            {
                ApplyTotpStatus(result);
            }
        }
        catch (OperationCanceledException)
        {
            // Dialog closed or a newer challenge superseded this run.
        }
    }

    private void ApplyTotpStatus(RepositoryResult<TotpStatusSnapshot> result)
    {
        switch (result.Status)
        {
            case LoadStatus.Loading:
                _totpFetched = false;
                _totpError = false;
                break;
            case LoadStatus.Cached:
            case LoadStatus.Refreshing:
            case LoadStatus.Loaded:
            case LoadStatus.Offline:
                _totpFetched = true;
                _totpError = false;
                _totpSnapshot = result.Value;
                break;
            case LoadStatus.Empty:
                _totpFetched = true;
                _totpError = false;
                _totpSnapshot = null;
                break;
            default: // Error
                _totpFetched = true;
                _totpError = true;
                _totpSnapshot = null;
                break;
        }

        RecomputeTotpAvailability();
    }

    private void RecomputeTotpAvailability()
    {
        bool enrolled = _totpSnapshot?.IsEnrolled ?? false;

        // web: !isFetched || isError || totpEnrolled || (data?.mode !== 'open')
        bool available = !_totpFetched
            || _totpError
            || enrolled
            || _totpSnapshot is null
            || !_totpSnapshot.IsOpenMode;

        TotpEnrolled = enrolled;
        TotpTabAvailable = available;

        // web effect: if the TOTP tab disappears mid-flight, fall back to the password tab.
        if (!available && _activeTab == ReauthTab.Totp)
        {
            ActiveTab = ReauthTab.Password;
        }
    }

    private void CancelInit()
    {
        if (_initCts is null)
        {
            return;
        }

        _initCts.Cancel();
        _initCts.Dispose();
        _initCts = null;
    }

    private static string Sanitize(string? value)
    {
        if (string.IsNullOrEmpty(value))
        {
            return string.Empty;
        }

        Span<char> digits = stackalloc char[ReauthDialogRegistration.MaxTotpLength];
        int count = 0;
        foreach (char c in value)
        {
            if (c is >= '0' and <= '9')
            {
                if (count == ReauthDialogRegistration.MaxTotpLength)
                {
                    break;
                }

                digits[count++] = c;
            }
        }

        return count == 0 ? string.Empty : new string(digits[..count]);
    }

    private string Tr(string key, string fallback) => _localizer.GetString(key, fallback);

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

    private void Raise(string? name) => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
