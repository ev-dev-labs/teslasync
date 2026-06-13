using System.Collections.Generic;
using System.ComponentModel;
using System.Globalization;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Settings;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="TotpEnrollmentSection"/> view — the native port of the
/// web component web/src/features/settings/components/TOTPEnrollmentSection.tsx. It owns the status read through the
/// shared <see cref="ITotpEnrollmentController"/> seam (default <see cref="OpenModeTotpController"/>) and the full
/// dialog flow the web component drives with local state: the enroll modal (QR + manual secret + 6-digit verify),
/// the one-time backup-codes reveal and the typed-confirmation disable. It surfaces the mutually-exclusive
/// <see cref="State"/> (loading / open-mode / not-enrolled / active), the open <see cref="DialogStep"/>, the verify
/// input + inline error, and the busy flags each action button binds. Drive it from one confinement (the UI
/// thread); it is not internally synchronised. It never throws — every controller failure is caught and surfaces
/// as an inline message or a swallowed no-op, mirroring the web component's try/catch branches.
/// </summary>
public sealed class TotpEnrollmentSectionViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ITotpEnrollmentController _controller;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset, string> _formatDateTime;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private TotpSectionState _state = TotpSectionState.Loading;
    private TotpStatus? _status;
    private TotpEnrollment? _enrollment;
    private IReadOnlyList<string>? _revealedCodes;
    private TotpDialogStep _dialogStep = TotpDialogStep.Closed;
    private string _verifyCode = string.Empty;
    private string? _verifyError;
    private bool _showDisableConfirm;
    private bool _isEnrolling;
    private bool _isVerifying;
    private bool _isRevoking;
    private bool _isRegenerating;

    /// <summary>Creates the holder over the shared controller seam and the i18n facade.</summary>
    /// <param name="controller">The status/enroll/verify/revoke/regenerate seam (web <c>useTOTP*</c>).</param>
    /// <param name="localizer">The i18n facade resolving every owned string.</param>
    /// <param name="formatDateTime">An optional formatter for the "last used" timestamp (web <c>formatDateTime</c>).</param>
    public TotpEnrollmentSectionViewModel(
        ITotpEnrollmentController controller,
        ILocalizer localizer,
        Func<DateTimeOffset, string>? formatDateTime = null)
    {
        ArgumentNullException.ThrowIfNull(controller);
        ArgumentNullException.ThrowIfNull(localizer);
        _controller = controller;
        _localizer = localizer;
        _formatDateTime = formatDateTime ?? DefaultFormat;
        Strings = TotpEnrollmentProjection.Strings(localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The fully-localized label set the view binds (web <c>t('totp.*')</c>).</summary>
    public TotpSectionStrings Strings { get; }

    /// <summary>The current mutually-exclusive surface state (web render branch).</summary>
    public TotpSectionState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The last status snapshot read from the controller (null until the first read resolves).</summary>
    public TotpStatus? Status => _status;

    /// <summary>The open modal step (web <c>dialogStep</c>).</summary>
    public TotpDialogStep DialogStep
    {
        get => _dialogStep;
        private set => Set(ref _dialogStep, value);
    }

    /// <summary>The one-time enrollment material backing the enroll modal (web <c>enrollment</c>).</summary>
    public TotpEnrollment? Enrollment => _enrollment;

    /// <summary>The backup codes revealed once after activation / regeneration (web <c>revealedCodes</c>).</summary>
    public IReadOnlyList<string>? RevealedCodes => _revealedCodes;

    /// <summary>The sanitized 6-digit verify input (web <c>verifyCode</c>).</summary>
    public string VerifyCode
    {
        get => _verifyCode;
        private set => Set(ref _verifyCode, value);
    }

    /// <summary>The inline verify error, or null when none (web <c>verifyError</c>).</summary>
    public string? VerifyError
    {
        get => _verifyError;
        private set => Set(ref _verifyError, value);
    }

    /// <summary>True while the disable confirmation is shown (web <c>showDisableConfirm</c>).</summary>
    public bool ShowDisableConfirm
    {
        get => _showDisableConfirm;
        private set => Set(ref _showDisableConfirm, value);
    }

    /// <summary>True while an enrollment request is in flight (web <c>enrollMut.isPending</c>).</summary>
    public bool IsEnrolling
    {
        get => _isEnrolling;
        private set => Set(ref _isEnrolling, value);
    }

    /// <summary>True while a verify request is in flight (web <c>verifyMut.isPending</c>).</summary>
    public bool IsVerifying
    {
        get => _isVerifying;
        private set => Set(ref _isVerifying, value);
    }

    /// <summary>True while a revoke request is in flight (web <c>revokeMut.isPending</c>).</summary>
    public bool IsRevoking
    {
        get => _isRevoking;
        private set => Set(ref _isRevoking, value);
    }

    /// <summary>True while a backup-code regeneration is in flight (web <c>regenMut.isPending</c>).</summary>
    public bool IsRegenerating
    {
        get => _isRegenerating;
        private set => Set(ref _isRegenerating, value);
    }

    /// <summary>True when an active credential exists (drives the status pill variant; web <c>activated</c>).</summary>
    public bool IsActivated => _state == TotpSectionState.Active;

    /// <summary>The localized status-pill text — "Active" when activated, else "Not enrolled".</summary>
    public string StatusPillText => IsActivated ? Strings.StatusActive : Strings.StatusNotEnrolled;

    /// <summary>The remaining backup-code count shown in the active state (0 when not activated; web fallback).</summary>
    public int BackupCodesRemaining => _status is { Activated: true } s ? s.BackupCodesRemaining : 0;

    /// <summary>The localized "last used" value — the formatted timestamp, or "Never" when absent (web branch).</summary>
    public string LastUsedText =>
        _status is { Activated: true, LastUsedAt: { } at } ? _formatDateTime(at) : Strings.LastUsedNever;

    /// <summary>
    /// Run the status read (web <c>useTOTPStatus</c>): shows the skeleton only when nothing is resolved yet, then
    /// folds the status into <see cref="State"/>. On any failure the surface degrades to the open-mode notice (web
    /// <c>!status.data</c> branch), never throwing. A superseding load cancels the prior one.
    /// </summary>
    /// <param name="cancellationToken">Cancels the read.</param>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var previous = Interlocked.Exchange(ref _cts, cts);
        previous?.Cancel();
        previous?.Dispose();

        if (_status is null)
        {
            State = TotpSectionState.Loading;
        }

        try
        {
            var status = await _controller.GetStatusAsync(cts.Token).ConfigureAwait(false);
            ApplyStatus(status);
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this emission silently.
        }
        catch (Exception)
        {
            // Web: a failed status read leaves status.data undefined, which renders the open-mode notice.
            ApplyStatus(null);
        }
    }

    /// <summary>Retry the status read from the top (web query refetch).</summary>
    public Task RetryAsync() => LoadAsync();

    /// <summary>
    /// Begin enrollment (web <c>handleEnroll</c>): requests the QR + secret + backup codes and opens the enroll
    /// modal. On failure the modal stays closed and the pill is unchanged (web swallows the error).
    /// </summary>
    /// <param name="cancellationToken">Cancels the request.</param>
    public async Task StartEnrollAsync(CancellationToken cancellationToken = default)
    {
        IsEnrolling = true;
        try
        {
            var enrollment = await _controller.EnrollAsync(cancellationToken).ConfigureAwait(false);
            _enrollment = enrollment;
            Raise(nameof(Enrollment));
            VerifyCode = string.Empty;
            VerifyError = null;
            DialogStep = TotpDialogStep.Enroll;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Web: enroll error is surfaced by the hook's onError toast; the dialog stays closed.
        }
        finally
        {
            IsEnrolling = false;
        }
    }

    /// <summary>Set the verify input, keeping only digits and at most six (web onChange sanitizer).</summary>
    /// <param name="value">The raw input value.</param>
    public void SetVerifyCode(string? value) => VerifyCode = SanitizeCode(value);

    /// <summary>
    /// Verify the 6-digit code and activate (web <c>handleVerify</c>): validates the length, then on success reveals
    /// the backup codes and flips to the backup-codes modal; on failure shows the classified inline error.
    /// </summary>
    /// <param name="cancellationToken">Cancels the request.</param>
    public async Task VerifyAsync(CancellationToken cancellationToken = default)
    {
        VerifyError = null;
        var code = SanitizeCode(_verifyCode);
        if (code.Length != 6)
        {
            VerifyError = TotpEnrollmentProjection.CodeLengthError(_localizer);
            return;
        }

        IsVerifying = true;
        try
        {
            await _controller.VerifyAsync(code, cancellationToken).ConfigureAwait(false);
            _revealedCodes = _enrollment?.BackupCodes ?? Array.Empty<string>();
            Raise(nameof(RevealedCodes));
            DialogStep = TotpDialogStep.BackupCodes;
        }
        catch (TotpException ex)
        {
            VerifyError = TotpEnrollmentProjection.VerifyError(_localizer, ex.Kind);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            VerifyError = TotpEnrollmentProjection.VerifyError(_localizer, TotpErrorKind.Generic);
        }
        finally
        {
            IsVerifying = false;
        }
    }

    /// <summary>Open the typed-confirmation disable dialog (web <c>setShowDisableConfirm(true)</c>).</summary>
    public void StartDisable() => ShowDisableConfirm = true;

    /// <summary>Close the disable dialog without revoking (web <c>onCancel</c>).</summary>
    public void CancelDisable() => ShowDisableConfirm = false;

    /// <summary>
    /// Confirm disabling TOTP (web <c>handleConfirmDisable</c>): revokes the credential, closes the dialog and
    /// re-reads the status. A revoke failure is swallowed (web surfaces the hook toast) and the dialog still closes.
    /// </summary>
    /// <param name="cancellationToken">Cancels the request.</param>
    public async Task ConfirmDisableAsync(CancellationToken cancellationToken = default)
    {
        IsRevoking = true;
        try
        {
            await _controller.RevokeAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Web: revoke error is surfaced by the hook's onError toast; the dialog closes via finally below.
        }
        finally
        {
            IsRevoking = false;
            ShowDisableConfirm = false;
        }

        await LoadAsync(cancellationToken).ConfigureAwait(false);
    }

    /// <summary>
    /// Regenerate the backup codes (web <c>handleRegenerate</c>): reveals the new set and opens the backup-codes
    /// modal. A failure is swallowed (web surfaces the hook toast).
    /// </summary>
    /// <param name="cancellationToken">Cancels the request.</param>
    public async Task RegenerateAsync(CancellationToken cancellationToken = default)
    {
        IsRegenerating = true;
        try
        {
            var result = await _controller.RegenerateBackupCodesAsync(cancellationToken).ConfigureAwait(false);
            _revealedCodes = result.BackupCodes;
            Raise(nameof(RevealedCodes));
            _enrollment = null;
            Raise(nameof(Enrollment));
            DialogStep = TotpDialogStep.BackupCodes;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Web: regenerate error is surfaced by the hook's onError toast; nothing else to do.
        }
        finally
        {
            IsRegenerating = false;
        }
    }

    /// <summary>Close any open modal, discarding the enrollment material and verify input (web <c>closeDialog</c>).</summary>
    public void CloseDialog()
    {
        DialogStep = TotpDialogStep.Closed;
        _enrollment = null;
        Raise(nameof(Enrollment));
        _revealedCodes = null;
        Raise(nameof(RevealedCodes));
        VerifyCode = string.Empty;
        VerifyError = null;
    }

    /// <summary>The downloadable backup-codes file body, or an empty string when there is nothing to write.</summary>
    /// <returns>The localized file content (web <c>downloadCodes</c> body).</returns>
    public string BackupCodesFileContent() =>
        TotpEnrollmentProjection.BackupCodesFileContent(_localizer, _revealedCodes);

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        var cts = Interlocked.Exchange(ref _cts, null);
        cts?.Cancel();
        cts?.Dispose();
    }

    private void ApplyStatus(TotpStatus? status)
    {
        _status = status;
        Raise(nameof(Status));

        State = status is null || status.Mode == TotpMode.Open
            ? TotpSectionState.OpenMode
            : status.Activated
                ? TotpSectionState.Active
                : TotpSectionState.NotEnrolled;

        Raise(nameof(IsActivated));
        Raise(nameof(StatusPillText));
        Raise(nameof(BackupCodesRemaining));
        Raise(nameof(LastUsedText));
    }

    private static string SanitizeCode(string? value)
    {
        if (string.IsNullOrEmpty(value))
        {
            return string.Empty;
        }

        Span<char> buffer = stackalloc char[6];
        int length = 0;
        foreach (var ch in value)
        {
            if (ch is >= '0' and <= '9')
            {
                buffer[length++] = ch;
                if (length == 6)
                {
                    break;
                }
            }
        }

        return new string(buffer[..length]);
    }

    private static string DefaultFormat(DateTimeOffset value) =>
        value.LocalDateTime.ToString("g", CultureInfo.CurrentCulture);

    private void Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return;
        }

        field = value;
        Raise(name);
    }

    private void Raise(string? name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
