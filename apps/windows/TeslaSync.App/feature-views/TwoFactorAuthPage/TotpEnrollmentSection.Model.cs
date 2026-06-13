using System.Collections.Generic;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Settings;

/// <summary>Forward-auth mode of the TOTP surface (web <c>TOTPStatus.mode</c>).</summary>
public enum TotpMode
{
    /// <summary>No forward-auth header is configured upstream — per-user TOTP is unavailable (web <c>'open'</c>).</summary>
    Open,

    /// <summary>The reverse proxy injects an authenticated user — enrollment is available (web <c>'forward_auth'</c>).</summary>
    ForwardAuth,
}

/// <summary>The mutually-exclusive surface state the <c>TOTPEnrollmentSection</c> renders (web render branches).</summary>
public enum TotpSectionState
{
    /// <summary>The status read is in flight (web <c>status.isLoading</c> spinner).</summary>
    Loading,

    /// <summary>Open mode or no status — the forward-auth requirement notice (web <c>mode === 'open'</c> branch).</summary>
    OpenMode,

    /// <summary>Forward-auth, no active credential — the "Not enrolled" pill + Enroll button (web not-activated branch).</summary>
    NotEnrolled,

    /// <summary>Forward-auth with an active credential — last-used, backup count, Regenerate + Disable (web activated branch).</summary>
    Active,
}

/// <summary>The open modal step inside the section (web <c>dialogStep</c>).</summary>
public enum TotpDialogStep
{
    /// <summary>No modal is open.</summary>
    Closed,

    /// <summary>The QR + manual-secret + 6-digit verify modal (web <c>'enroll'</c>).</summary>
    Enroll,

    /// <summary>The one-time backup-codes reveal modal (web <c>'backupCodes'</c>).</summary>
    BackupCodes,
}

/// <summary>The class of a TOTP verification failure (web <c>TOTP_*_CODE</c> error codes).</summary>
public enum TotpErrorKind
{
    /// <summary>The submitted code did not match (web <c>TOTP_INVALID_CODE</c>).</summary>
    InvalidCode,

    /// <summary>Too many incorrect attempts (web <c>TOTP_RATE_LIMITED_CODE</c>).</summary>
    RateLimited,

    /// <summary>The enrollment window expired (web <c>TOTP_ENROLLMENT_EXPIRED_CODE</c>).</summary>
    EnrollmentExpired,

    /// <summary>Any other verification failure (web generic branch).</summary>
    Generic,
}

/// <summary>
/// A classified TOTP operation failure raised by an <see cref="ITotpEnrollmentController"/>. Mirrors the web
/// component's mapping of <c>isApiError(err).code</c> to a specific inline message, so the view-model can resolve
/// the matching localized error without inspecting transport details.
/// </summary>
public sealed class TotpException : Exception
{
    /// <summary>Creates the failure over its classification.</summary>
    /// <param name="kind">The error class driving the inline message.</param>
    /// <param name="message">An optional technical message (never shown raw for the classified kinds).</param>
    public TotpException(TotpErrorKind kind, string? message = null)
        : base(message)
    {
        Kind = kind;
    }

    /// <summary>The classified verification failure.</summary>
    public TotpErrorKind Kind { get; }
}

/// <summary>The current per-user TOTP status (web <c>TOTPStatus</c>).</summary>
public sealed record TotpStatus
{
    /// <summary>The forward-auth mode of the surface.</summary>
    public TotpMode Mode { get; init; }

    /// <summary>True when an active TOTP credential exists (web <c>activated</c>).</summary>
    public bool Activated { get; init; }

    /// <summary>When the credential was last used for a step-up (web <c>last_used_at</c>); null when never.</summary>
    public DateTimeOffset? LastUsedAt { get; init; }

    /// <summary>Remaining single-use backup codes (web <c>backup_codes_remaining</c>).</summary>
    public int BackupCodesRemaining { get; init; }

    /// <summary>The canonical open-mode status (no forward-auth backend wired).</summary>
    public static TotpStatus OpenMode { get; } = new() { Mode = TotpMode.Open };
}

/// <summary>The one-time enrollment material returned when enrollment starts (web <c>TOTPEnrollment</c>).</summary>
public sealed record TotpEnrollment
{
    /// <summary>The base32 manual-entry secret (web <c>secret</c>).</summary>
    public string Secret { get; init; } = string.Empty;

    /// <summary>The QR-code <c>data:</c> URI (web <c>qr_data_uri</c>).</summary>
    public string QrDataUri { get; init; } = string.Empty;

    /// <summary>The single-use backup codes revealed once after activation (web <c>backup_codes</c>).</summary>
    public IReadOnlyList<string> BackupCodes { get; init; } = Array.Empty<string>();
}

/// <summary>
/// The behavior seam the <c>TOTPEnrollmentSection</c> view-model drives — the native analogue of the web
/// <c>useTOTP*</c> hooks (status / enroll / verify / revoke / regenerate). The shell mounts the section over the
/// inert <see cref="OpenModeTotpController"/> by default (the manifest models this page as rendering from local
/// state — the generated C# client exposes no per-user TOTP endpoint), so the surface resolves to the canonical
/// open-mode notice without contacting a backend. A host that runs behind forward-auth injects a client-backed
/// controller, mirroring the <c>EmptyXSource</c> → repository-backed source convention the sibling pages use.
/// </summary>
public interface ITotpEnrollmentController
{
    /// <summary>Read the current per-user TOTP status (web <c>useTOTPStatus</c>).</summary>
    /// <param name="cancellationToken">Cancels the read.</param>
    /// <returns>The current status.</returns>
    Task<TotpStatus> GetStatusAsync(CancellationToken cancellationToken = default);

    /// <summary>Begin enrollment, returning the QR + secret + backup codes (web <c>useTOTPEnroll</c>).</summary>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>The one-time enrollment material.</returns>
    Task<TotpEnrollment> EnrollAsync(CancellationToken cancellationToken = default);

    /// <summary>Verify a 6-digit code and activate the credential (web <c>useTOTPVerify</c>).</summary>
    /// <param name="code">The 6-digit code from the authenticator app.</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>A task that completes on success or throws a <see cref="TotpException"/>.</returns>
    Task VerifyAsync(string code, CancellationToken cancellationToken = default);

    /// <summary>Disable TOTP and invalidate backup codes (web <c>useTOTPRevoke</c>).</summary>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>A task that completes on success.</returns>
    Task RevokeAsync(CancellationToken cancellationToken = default);

    /// <summary>Regenerate the backup codes, returning the new set (web <c>useTOTPRegenerateBackupCodes</c>).</summary>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>The regenerated backup codes.</returns>
    Task<TotpEnrollment> RegenerateBackupCodesAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The inert default <see cref="ITotpEnrollmentController"/> the shell mounts when no forward-auth-backed controller
/// is wired. It resolves the status read to <see cref="TotpStatus.OpenMode"/> — the web component's own no-backend
/// default, where the Enroll / Disable affordances are not rendered and no enrollment endpoint is hit — and treats
/// every mutation as unsupported (open mode cannot enroll). Tests inject their own forward-auth fake.
/// </summary>
public sealed class OpenModeTotpController : ITotpEnrollmentController
{
    /// <summary>The shared singleton instance.</summary>
    public static OpenModeTotpController Instance { get; } = new();

    private OpenModeTotpController()
    {
    }

    /// <inheritdoc />
    public Task<TotpStatus> GetStatusAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(TotpStatus.OpenMode);
    }

    /// <inheritdoc />
    public Task<TotpEnrollment> EnrollAsync(CancellationToken cancellationToken = default) =>
        throw new NotSupportedException("Per-user TOTP enrollment requires forward-auth mode.");

    /// <inheritdoc />
    public Task VerifyAsync(string code, CancellationToken cancellationToken = default) =>
        throw new NotSupportedException("Per-user TOTP enrollment requires forward-auth mode.");

    /// <inheritdoc />
    public Task RevokeAsync(CancellationToken cancellationToken = default) =>
        throw new NotSupportedException("Per-user TOTP enrollment requires forward-auth mode.");

    /// <inheritdoc />
    public Task<TotpEnrollment> RegenerateBackupCodesAsync(CancellationToken cancellationToken = default) =>
        throw new NotSupportedException("Per-user TOTP enrollment requires forward-auth mode.");
}

/// <summary>
/// Every localized label the <c>TOTPEnrollmentSection</c> renders, resolved once through the i18n facade. Centralised
/// so the view binds a single projected record and the headless tests assert each web key flows through the
/// localizer. Every key carries the web <c>settings.totp.*</c> name (the settings-namespace keys that already exist
/// in <c>Strings/*.resw</c>) with the web English fallback verbatim.
/// </summary>
public sealed record TotpSectionStrings
{
    /// <summary>Section title (web <c>totp.title</c>).</summary>
    public required string Title { get; init; }

    /// <summary>Section subtitle (web <c>totp.subtitle</c>).</summary>
    public required string Subtitle { get; init; }

    /// <summary>Open-mode forward-auth requirement notice (web <c>totp.openMode.message</c>).</summary>
    public required string OpenModeMessage { get; init; }

    /// <summary>"Active" status pill (web <c>totp.status.active</c>).</summary>
    public required string StatusActive { get; init; }

    /// <summary>"Not enrolled" status pill (web <c>totp.status.notEnrolled</c>).</summary>
    public required string StatusNotEnrolled { get; init; }

    /// <summary>Loading text (web <c>totp.loading</c>).</summary>
    public required string Loading { get; init; }

    /// <summary>"Last used" label (web <c>totp.lastUsed.label</c>).</summary>
    public required string LastUsedLabel { get; init; }

    /// <summary>"Never" last-used value (web <c>totp.lastUsed.never</c>).</summary>
    public required string LastUsedNever { get; init; }

    /// <summary>"Backup codes remaining" label (web <c>totp.backupCodesRemaining.label</c>).</summary>
    public required string BackupCodesRemainingLabel { get; init; }

    /// <summary>"Regenerate backup codes" action (web <c>totp.actions.regenerate</c>).</summary>
    public required string ActionRegenerate { get; init; }

    /// <summary>"Disable" action (web <c>totp.actions.disable</c>).</summary>
    public required string ActionDisable { get; init; }

    /// <summary>"Enable TOTP" action (web <c>totp.actions.enroll</c>).</summary>
    public required string ActionEnroll { get; init; }

    /// <summary>Enroll hint (web <c>totp.actions.enrollHint</c>).</summary>
    public required string ActionEnrollHint { get; init; }

    /// <summary>Enroll modal title (web <c>totp.modal.enrollTitle</c>).</summary>
    public required string ModalEnrollTitle { get; init; }

    /// <summary>Enroll modal scan instructions (web <c>totp.modal.scanInstructions</c>).</summary>
    public required string ModalScanInstructions { get; init; }

    /// <summary>QR alt text (web <c>totp.modal.qrAlt</c>).</summary>
    public required string ModalQrAlt { get; init; }

    /// <summary>Manual-entry secret label (web <c>totp.modal.manualLabel</c>).</summary>
    public required string ModalManualLabel { get; init; }

    /// <summary>6-digit code input label (web <c>totp.modal.codeLabel</c>).</summary>
    public required string ModalCodeLabel { get; init; }

    /// <summary>Enroll modal cancel (web <c>totp.modal.cancel</c>).</summary>
    public required string ModalCancel { get; init; }

    /// <summary>Enroll modal verify-and-activate (web <c>totp.modal.verify</c>).</summary>
    public required string ModalVerify { get; init; }

    /// <summary>Backup-codes modal title (web <c>totp.backupCodes.title</c>).</summary>
    public required string BackupCodesTitle { get; init; }

    /// <summary>Backup-codes warning (web <c>totp.backupCodes.warning</c>).</summary>
    public required string BackupCodesWarning { get; init; }

    /// <summary>"Download .txt" action (web <c>totp.backupCodes.download</c>).</summary>
    public required string BackupCodesDownload { get; init; }

    /// <summary>"I saved them" action (web <c>totp.backupCodes.done</c>).</summary>
    public required string BackupCodesDone { get; init; }

    /// <summary>Disable confirm title (web <c>totp.disable.title</c>).</summary>
    public required string DisableTitle { get; init; }

    /// <summary>Disable confirm message (web <c>totp.disable.message</c>).</summary>
    public required string DisableMessage { get; init; }

    /// <summary>Disable confirm button (web <c>totp.disable.confirm</c>).</summary>
    public required string DisableConfirm { get; init; }

    /// <summary>Disable cancel button (web <c>totp.disable.cancel</c>).</summary>
    public required string DisableCancel { get; init; }

    /// <summary>Typed-confirmation label (web <c>totp.disable.typedLabel</c>).</summary>
    public required string DisableTypedLabel { get; init; }
}

/// <summary>
/// Pure projection of the localized <see cref="TotpSectionStrings"/> and the verify-error message, plus the
/// canonical glyphs and the typed-confirmation phrase. UI-free so the strings are asserted headlessly.
/// </summary>
public static class TotpEnrollmentProjection
{
    /// <summary>The typed phrase the disable confirmation requires (web <c>requireTypedConfirmation="DISABLE"</c>).</summary>
    public const string DisableConfirmationPhrase = "DISABLE";

    /// <summary>The file name the backup-codes download writes (web <c>teslasync-totp-backup-codes.txt</c>).</summary>
    public const string BackupCodesFileName = "teslasync-totp-backup-codes.txt";

    private const string FileHeaderKey = "settings.totp.backupCodes.fileHeader";
    private const string FileHeaderFallback = "# TeslaSync TOTP backup codes — keep secret.";

    /// <summary>Resolve every section label through the i18n facade (web <c>t('totp.*')</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <returns>The fully-localized label set.</returns>
    public static TotpSectionStrings Strings(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return new TotpSectionStrings
        {
            Title = localizer.GetString("settings.totp.title", "Two-factor authentication"),
            Subtitle = localizer.GetString(
                "settings.totp.subtitle",
                "TOTP codes from your authenticator app are required for the sudo step-up before destructive admin actions."),
            OpenModeMessage = localizer.GetString(
                "settings.totp.openMode.message",
                "Per-user TOTP requires forward-auth mode. Configure your reverse proxy to inject X-Forwarded-User then reload."),
            StatusActive = localizer.GetString("settings.totp.status.active", "Active"),
            StatusNotEnrolled = localizer.GetString("settings.totp.status.notEnrolled", "Not enrolled"),
            Loading = localizer.GetString("settings.totp.loading", "Loading two-factor settings…"),
            LastUsedLabel = localizer.GetString("settings.totp.lastUsed.label", "Last used"),
            LastUsedNever = localizer.GetString("settings.totp.lastUsed.never", "Never"),
            BackupCodesRemainingLabel = localizer.GetString(
                "settings.totp.backupCodesRemaining.label", "Backup codes remaining"),
            ActionRegenerate = localizer.GetString("settings.totp.actions.regenerate", "Regenerate backup codes"),
            ActionDisable = localizer.GetString("settings.totp.actions.disable", "Disable"),
            ActionEnroll = localizer.GetString("settings.totp.actions.enroll", "Enable TOTP"),
            ActionEnrollHint = localizer.GetString(
                "settings.totp.actions.enrollHint",
                "Compatible with Google Authenticator, 1Password, Bitwarden, Authy and other RFC 6238 clients."),
            ModalEnrollTitle = localizer.GetString("settings.totp.modal.enrollTitle", "Enable TOTP"),
            ModalScanInstructions = localizer.GetString(
                "settings.totp.modal.scanInstructions",
                "Scan the QR code with your authenticator app, or enter the secret manually."),
            ModalQrAlt = localizer.GetString("settings.totp.modal.qrAlt", "TOTP QR code"),
            ModalManualLabel = localizer.GetString("settings.totp.modal.manualLabel", "Manual entry secret"),
            ModalCodeLabel = localizer.GetString(
                "settings.totp.modal.codeLabel", "Enter the 6-digit code from your app"),
            ModalCancel = localizer.GetString("settings.totp.modal.cancel", "Cancel"),
            ModalVerify = localizer.GetString("settings.totp.modal.verify", "Verify and activate"),
            BackupCodesTitle = localizer.GetString("settings.totp.backupCodes.title", "Save your backup codes"),
            BackupCodesWarning = localizer.GetString(
                "settings.totp.backupCodes.warning",
                "These codes will not be shown again. Store them in a password manager. Each code can be used once if you lose access to your authenticator app."),
            BackupCodesDownload = localizer.GetString("settings.totp.backupCodes.download", "Download .txt"),
            BackupCodesDone = localizer.GetString("settings.totp.backupCodes.done", "I saved them"),
            DisableTitle = localizer.GetString(
                "settings.totp.disable.title", "Disable two-factor authentication?"),
            DisableMessage = localizer.GetString(
                "settings.totp.disable.message",
                "You will no longer be prompted for a TOTP code on the sudo step-up. Your backup codes will be invalidated."),
            DisableConfirm = localizer.GetString("settings.totp.disable.confirm", "Disable"),
            DisableCancel = localizer.GetString("settings.totp.disable.cancel", "Keep TOTP enabled"),
            DisableTypedLabel = localizer.GetString("settings.totp.disable.typedLabel", "Type DISABLE to confirm"),
        };
    }

    /// <summary>Resolve the inline verify-error message for a failure kind (web error-code branch).</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <param name="kind">The classified verification failure.</param>
    /// <returns>The localized inline error.</returns>
    public static string VerifyError(ILocalizer localizer, TotpErrorKind kind)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return kind switch
        {
            TotpErrorKind.InvalidCode => localizer.GetString(
                "settings.totp.errors.invalidCode", "Code did not match. Try the next one."),
            TotpErrorKind.RateLimited => localizer.GetString(
                "settings.totp.errors.rateLimited", "Too many incorrect attempts. Try again in 15 minutes."),
            TotpErrorKind.EnrollmentExpired => localizer.GetString(
                "settings.totp.errors.enrollmentExpired", "Enrollment expired. Close and start over."),
            _ => localizer.GetString("settings.totp.errors.verifyGeneric", "Verification failed."),
        };
    }

    /// <summary>The "enter all 6 digits" length-validation message (web <c>totp.errors.codeLength</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <returns>The localized length error.</returns>
    public static string CodeLengthError(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("settings.totp.errors.codeLength", "Enter all 6 digits.");
    }

    /// <summary>
    /// Build the downloadable backup-codes text (web <c>downloadCodes</c>): the localized header, a blank line, then
    /// one code per line with a trailing newline. Returns an empty string when there are no codes (web no-op guard).
    /// </summary>
    /// <param name="localizer">The i18n facade resolving the file header.</param>
    /// <param name="codes">The revealed backup codes.</param>
    /// <returns>The file body, or an empty string when there is nothing to write.</returns>
    public static string BackupCodesFileContent(ILocalizer localizer, IReadOnlyList<string>? codes)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        if (codes is null || codes.Count == 0)
        {
            return string.Empty;
        }

        var header = localizer.GetString(FileHeaderKey, FileHeaderFallback);
        return $"{header}\n\n{string.Join('\n', codes)}\n";
    }
}

/// <summary>
/// PII-safe diagnostics for the TOTP enrollment section (P1/S11 diagnostics contract). Records only the operational
/// <c>view.opened</c> event with the surface slug — never a secret, backup code, QR URI, verification code or TOTP
/// status — so a diagnostics line can never leak authentication material. Thread-safe.
/// </summary>
public sealed class TotpEnrollmentDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink each diagnostics line is written to (null discards).</param>
    public TotpEnrollmentDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=TOTPEnrollmentSection</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke("view.opened slug=TOTPEnrollmentSection");
    }
}
