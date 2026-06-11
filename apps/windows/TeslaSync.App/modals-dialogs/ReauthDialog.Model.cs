using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// The mode the reauth dialog operates in — the native analogue of the web
/// <c>DialogMode</c> (web/src/components/feedback/ReauthDialog.tsx). Forward-auth installs require a
/// credential (<see cref="Credential"/>); open-mode installs only need a typed confirmation
/// (<see cref="Confirm"/>). The mode is resolved from the deployment auth mode so a proxy mid-flight
/// flip is honoured.
/// </summary>
public enum ReauthDialogMode
{
    /// <summary>Forward-auth: render the password (and optional authenticator) credential form.</summary>
    Credential,

    /// <summary>Open mode: render the typed-confirmation form and resolve locally (no token minted).</summary>
    Confirm,
}

/// <summary>The credential tab the dialog is showing (web <c>activeTab</c>: 'password' | 'totp').</summary>
public enum ReauthTab
{
    /// <summary>The password tab.</summary>
    Password,

    /// <summary>The authenticator (TOTP) tab.</summary>
    Totp,
}

/// <summary>
/// The credential mode the server (or a local open-mode resolve) reports — the native analogue of the
/// web <c>SudoCredential.mode</c> ('session' | 'open'). <see cref="Open"/> means the install runs in open
/// mode and the action proceeds without an <c>X-Sudo-Token</c>; <see cref="Session"/> carries a minted
/// sudo token.
/// </summary>
public enum SudoCredentialMode
{
    /// <summary>A sudo token was minted, bound to the forward-auth subject.</summary>
    Session,

    /// <summary>Open-mode install — no token, the action proceeds.</summary>
    Open,
}

/// <summary>The deployment auth mode (web <c>useSessionMonitor().mode</c>: 'open' | 'session' | 'unknown').</summary>
public enum SessionAuthMode
{
    /// <summary>The mode has not been resolved yet (web <c>'unknown'</c>).</summary>
    Unknown,

    /// <summary>No auth provider is configured — the dialog uses the typed-confirmation variant (web <c>'open'</c>).</summary>
    Open,

    /// <summary>Forward-auth is configured — the dialog uses the credential variant (web <c>'session'</c>).</summary>
    ForwardAuth,
}

/// <summary>
/// The credential the dialog resolves with after a successful submission — the native analogue of the web
/// <c>SudoCredential</c> ({ mode, token, expiresAt }). In open mode only <see cref="Mode"/> is set
/// (<see cref="SudoCredentialMode.Open"/>); in forward-auth mode the minted <see cref="Token"/> and its
/// <see cref="ExpiresAt"/> are carried.
/// </summary>
public sealed record SudoCredential(SudoCredentialMode Mode, string? Token = null, string? ExpiresAt = null)
{
    /// <summary>The local open-mode credential resolved without a network round-trip (web <c>{ mode: 'open' }</c>).</summary>
    public static SudoCredential OpenMode { get; } = new(SudoCredentialMode.Open);
}

/// <summary>
/// The body posted to the reauth endpoint — the native analogue of the web <c>SudoSubmitBody</c>
/// ({ password? , totp_code? }). Exactly one field is set per submission; the wire keys are snake_case to
/// match the Go API.
/// </summary>
public sealed record SudoSubmitBody(string? Password = null, string? TotpCode = null)
{
    /// <summary>A password submission (web <c>{ password }</c>).</summary>
    public static SudoSubmitBody ForPassword(string password) => new(Password: password);

    /// <summary>An authenticator-code submission (web <c>{ totp_code }</c>).</summary>
    public static SudoSubmitBody ForTotp(string totpCode) => new(TotpCode: totpCode);

    /// <summary>The snake_case JSON body the reauth endpoint expects (omitting the unset field).</summary>
    public IReadOnlyDictionary<string, object?> ToReauthBody()
    {
        var body = new Dictionary<string, object?>(StringComparer.Ordinal);
        if (Password is not null)
        {
            body["password"] = Password;
        }

        if (TotpCode is not null)
        {
            body["totp_code"] = TotpCode;
        }

        return body;
    }
}

/// <summary>
/// The classified outcome of one reauth submission — the native analogue of the web submitter resolving to
/// a <c>SudoCredential</c> or rejecting with a coded error. On success it carries the
/// <see cref="Credential"/>; on failure it carries the server's structured <see cref="Code"/> (e.g.
/// <c>INVALID_CREDENTIAL</c>, <c>REAUTH_NOT_CONFIGURED</c>) and a human-readable <see cref="Message"/> so
/// the view-model can map it to the right localized error string without catching exceptions.
/// </summary>
public sealed record ReauthSubmitOutcome(bool Success, SudoCredential? Credential, string? Code, string? Message)
{
    /// <summary>A successful submission.</summary>
    public static ReauthSubmitOutcome Ok(SudoCredential credential) => new(true, credential, null, null);

    /// <summary>A classified failure carrying the server error code (when present) and a message.</summary>
    public static ReauthSubmitOutcome Fail(string? code, string? message) => new(false, null, code, message);
}

/// <summary>
/// Raised when the user dismisses the reauth dialog — the native analogue of the web
/// <c>SudoCanceledError</c>. The pending action's caller may treat this as a "user changed their mind"
/// no-op. Named with the CLR <c>Exception</c> suffix (CA1710) while preserving the web semantics.
/// </summary>
public sealed class SudoCanceledException : Exception
{
    /// <summary>Creates the cancellation signal with the default message.</summary>
    public SudoCanceledException()
        : base("Reauthentication was canceled.")
    {
    }

    /// <summary>Creates the cancellation signal with a custom message.</summary>
    public SudoCanceledException(string message)
        : base(message)
    {
    }

    /// <summary>Creates the cancellation signal wrapping an inner cause.</summary>
    public SudoCanceledException(string message, Exception innerException)
        : base(message, innerException)
    {
    }
}

/// <summary>
/// The parsed per-user TOTP enrollment status — the native projection of the web <c>TOTPStatus</c>
/// discriminated union returned by <c>useTOTPStatus</c> (GET <c>/auth/totp</c>):
/// <c>{ mode: 'open' }</c> when the backend reports <c>AUTH_MODE_OPEN</c>, otherwise
/// <c>{ mode: 'session', activated }</c>. <see cref="IsEnrolled"/> mirrors the web
/// <c>data.mode === 'session' &amp;&amp; data.activated === true</c> guard.
/// </summary>
public sealed record TotpStatusSnapshot(string? Mode, bool Activated)
{
    /// <summary>The open-mode sentinel snapshot (web <c>{ mode: 'open' }</c>).</summary>
    public static TotpStatusSnapshot OpenMode { get; } = new("open", false);

    /// <summary>True when per-user TOTP is enrolled (web <c>mode === 'session' &amp;&amp; activated</c>).</summary>
    public bool IsEnrolled => string.Equals(Mode, "session", StringComparison.OrdinalIgnoreCase) && Activated;

    /// <summary>True when the backend reported open mode (web <c>mode === 'open'</c>).</summary>
    public bool IsOpenMode => string.Equals(Mode, "open", StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// Parse the <c>/auth/totp</c> JSON payload, tolerating a missing/garbage body by falling back to a
    /// non-enrolled session snapshot (the conservative default the web hook uses before a value arrives).
    /// </summary>
    public static TotpStatusSnapshot FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return new TotpStatusSnapshot(null, false);
        }

        string? mode = element.TryGetProperty("mode", out var modeEl) && modeEl.ValueKind == JsonValueKind.String
            ? modeEl.GetString()
            : null;

        bool activated = element.TryGetProperty("activated", out var actEl) &&
            actEl.ValueKind is JsonValueKind.True or JsonValueKind.False && actEl.GetBoolean();

        return new TotpStatusSnapshot(mode, activated);
    }
}

/// <summary>
/// Token-preserving projection of the cache-then-network <c>/auth/totp</c> read — the native analogue of
/// the web <c>useTOTPStatus</c> query result. Parses each <see cref="JsonElement"/> emission into a
/// <see cref="TotpStatusSnapshot"/> while preserving the loading / cached / refreshing / stale / offline /
/// loaded status so the dialog can decide tab visibility for every state without flashing.
/// </summary>
public static class TotpStatusResultMapper
{
    /// <summary>Project a raw JSON emission into a typed snapshot, preserving its repository status.</summary>
    public static RepositoryResult<TotpStatusSnapshot> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        TotpStatusSnapshot Parsed() => raw.HasValue ? TotpStatusSnapshot.FromJson(raw.Value) : new TotpStatusSnapshot(null, false);

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<TotpStatusSnapshot>.Loading(),
            LoadStatus.Cached => RepositoryResult<TotpStatusSnapshot>.Cached(Parsed(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<TotpStatusSnapshot>.Refreshing(Parsed(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<TotpStatusSnapshot>.Loaded(Parsed(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<TotpStatusSnapshot>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<TotpStatusSnapshot>.OfflineCached(Parsed(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<TotpStatusSnapshot>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}

/// <summary>
/// One queued step-up challenge — the native analogue of the web module-level <c>PendingChallenge</c>. The
/// dialog is modal so only one challenge is active at a time; <see cref="Path"/> is the API path that
/// triggered the challenge (available for future action context, exactly like the web record).
/// </summary>
public sealed class ReauthChallenge
{
    /// <summary>Creates a challenge for the API path that gated the action.</summary>
    public ReauthChallenge(string path) => Path = path ?? string.Empty;

    /// <summary>The API path that triggered the challenge.</summary>
    public string Path { get; }
}

/// <summary>
/// The reader/controller seam the view-model binds to for the challenge queue (P1/S8 state-holder) — the
/// native analogue of the web module-level queue plus <c>useReauthDialogState</c>. Producers (the API
/// client interceptor) enqueue challenges; the dialog resolves the active one with a credential or rejects
/// it on cancel. Only one challenge is ever <see cref="Active"/> because the dialog is modal.
/// </summary>
public interface IReauthChallengeBroker
{
    /// <summary>Raised whenever the active challenge or queue depth changes.</summary>
    event EventHandler? Changed;

    /// <summary>The active challenge, or <c>null</c> when the queue is idle (web <c>active</c>).</summary>
    ReauthChallenge? Active { get; }

    /// <summary>Total queued + active challenges (web <c>total</c>).</summary>
    int Total { get; }

    /// <summary>Resolve the active challenge with <paramref name="credential"/> and advance the queue.</summary>
    void ResolveActive(SudoCredential credential);

    /// <summary>Reject the active challenge with <paramref name="cause"/> and advance the queue.</summary>
    void RejectActive(Exception cause);
}

/// <summary>
/// The data port the view-model resolves the deployment auth mode through (P1/S8) — the native analogue of
/// the web <c>useSessionMonitor</c>. The concrete source reads <c>/system/auth-mode</c>; the view never
/// performs HTTP itself.
/// </summary>
public interface ISessionAuthModeSource
{
    /// <summary>Resolve the current deployment auth mode (web <c>monitor.mode</c>).</summary>
    Task<SessionAuthMode> GetModeAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The data port the view-model binds to for the per-user TOTP enrollment status (P1/S8) — the native
/// analogue of the web <c>useTOTPStatus</c>. It yields the cache-then-network sequence of parsed snapshots
/// so the dialog keeps the right tab visible while the status refreshes.
/// </summary>
public interface ITotpStatusSource
{
    /// <summary>Stream the cache-then-network TOTP status snapshots, cached first.</summary>
    IAsyncEnumerable<RepositoryResult<TotpStatusSnapshot>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The data port the view-model submits credentials through (P1/S8) — the native analogue of the web
/// <c>defaultSubmitCredential</c> / <c>submitPerUserTotp</c> free functions. It posts to the reauth
/// endpoints (bypassing the SUDO_REQUIRED interceptor so the recovery flow cannot deadlock) and returns a
/// classified <see cref="ReauthSubmitOutcome"/> rather than throwing.
/// </summary>
public interface IReauthSubmitter
{
    /// <summary>
    /// Submit <paramref name="body"/>. When <paramref name="totpEnrolled"/> is set, an authenticator code is
    /// routed to the per-user endpoint; otherwise everything goes through the shared-secret reauth endpoint
    /// (web Root routing).
    /// </summary>
    Task<ReauthSubmitOutcome> SubmitAsync(SudoSubmitBody body, bool totpEnrolled, CancellationToken cancellationToken = default);
}

/// <summary>
/// Canonical metadata for the reauth dialog surface — the native mirror of the web component's identity and
/// its module-level constants. Carries the diagnostics surface slug, the typed-confirmation token, and the
/// generated OpenAPI operation ids the data sources resolve.
/// </summary>
public static class ReauthDialogRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "ReauthDialog";

    /// <summary>The literal the user must type to confirm a destructive open-mode action (web <c>TYPED_CONFIRMATION_TOKEN</c>).</summary>
    public const string TypedConfirmationToken = "CONFIRM";

    /// <summary>Maximum authenticator-code length the field accepts (web slices to 8 digits).</summary>
    public const int MaxTotpLength = 8;

    /// <summary>Generated OpenAPI operation id for the deployment auth-mode read (web <c>useSessionMonitor</c>).</summary>
    public const string AuthModeOperation = "get_api_v1_system_auth_mode";

    /// <summary>Generated OpenAPI operation id for the per-user TOTP status read (web <c>useTOTPStatus</c>).</summary>
    public const string TotpStatusOperation = "get_api_v1_auth_totp";

    /// <summary>Generated OpenAPI operation id for the shared-secret reauth submission (web <c>/auth/reauth</c>).</summary>
    public const string ReauthOperation = "post_api_v1_auth_reauth";

    /// <summary>Generated OpenAPI operation id for the per-user TOTP sudo submission (web <c>/auth/totp/sudo</c>).</summary>
    public const string TotpSudoOperation = "post_api_v1_auth_totp_sudo";

    /// <summary>Stable cache key for the TOTP status cache-then-network read.</summary>
    public const string TotpStatusCacheKey = "auth:totp:status";
}

/// <summary>
/// Localized string keys + English fallbacks for the reauth dialog — the native mirror of every
/// <c>t('sudo.*')</c> call in the web source. Every key resolves through the P1/S10 i18n facade
/// (<c>translation.sudo.*</c> in <c>Strings/{lang}/Resources.resw</c>); the fallback is the web default.
/// The <see cref="WithToken"/> helper performs the web <c>{{token}}</c> interpolation.
/// </summary>
public static class ReauthDialogStrings
{
    /// <summary>Credential-mode dialog title (web <c>sudo.title</c>).</summary>
    public const string TitleKey = "translation.sudo.title";

    /// <summary>Credential-mode dialog title fallback.</summary>
    public const string TitleFallback = "Confirm your identity";

    /// <summary>Open-mode dialog title (web <c>sudo.openMode.title</c>).</summary>
    public const string OpenTitleKey = "translation.sudo.openMode.title";

    /// <summary>Open-mode dialog title fallback.</summary>
    public const string OpenTitleFallback = "Confirm sensitive action";

    /// <summary>Credential-mode body (web <c>sudo.description</c>).</summary>
    public const string DescriptionKey = "translation.sudo.description";

    /// <summary>Credential-mode body fallback.</summary>
    public const string DescriptionFallback =
        "For your security, please re-enter your password or authenticator code before this action runs.";

    /// <summary>Open-mode body template with a <c>{{token}}</c> slot (web <c>sudo.openMode.body</c>).</summary>
    public const string OpenBodyKey = "translation.sudo.openMode.body";

    /// <summary>Open-mode body fallback (interpolated via <see cref="WithToken"/>).</summary>
    public const string OpenBodyFallback = "This is a destructive action. Type {{token}} to continue.";

    /// <summary>Password tab label (web <c>sudo.tabs.password</c>).</summary>
    public const string PasswordTabKey = "translation.sudo.tabs.password";

    /// <summary>Password tab label fallback.</summary>
    public const string PasswordTabFallback = "Password";

    /// <summary>Authenticator tab label (web <c>sudo.tabs.totp</c>).</summary>
    public const string TotpTabKey = "translation.sudo.tabs.totp";

    /// <summary>Authenticator tab label fallback.</summary>
    public const string TotpTabFallback = "Authenticator";

    /// <summary>Tab strip accessible name (web <c>sudo.tabs.label</c>).</summary>
    public const string TabsAriaKey = "translation.sudo.tabs.label";

    /// <summary>Tab strip accessible name fallback.</summary>
    public const string TabsAriaFallback = "Reauth method";

    /// <summary>Password field label (web <c>sudo.passwordLabel</c>).</summary>
    public const string PasswordLabelKey = "translation.sudo.passwordLabel";

    /// <summary>Password field label fallback.</summary>
    public const string PasswordLabelFallback = "Password";

    /// <summary>Authenticator field label (web <c>sudo.totpLabel</c>).</summary>
    public const string TotpLabelKey = "translation.sudo.totpLabel";

    /// <summary>Authenticator field label fallback.</summary>
    public const string TotpLabelFallback = "Authenticator code";

    /// <summary>Typed-confirmation field label template (web <c>sudo.typedConfirmationLabel</c>).</summary>
    public const string TypedConfirmationLabelKey = "translation.sudo.typedConfirmationLabel";

    /// <summary>Typed-confirmation field label fallback (interpolated via <see cref="WithToken"/>).</summary>
    public const string TypedConfirmationLabelFallback = "Type {{token}} to confirm";

    /// <summary>Credential-mode helper text (web <c>sudo.helper</c>).</summary>
    public const string HelperKey = "translation.sudo.helper";

    /// <summary>Credential-mode helper text fallback.</summary>
    public const string HelperFallback = "Your reauth lasts 5 minutes; rapid follow-up actions will not re-prompt.";

    /// <summary>Cancel button label (web <c>sudo.cancel</c>).</summary>
    public const string CancelKey = "translation.sudo.cancel";

    /// <summary>Cancel button label fallback.</summary>
    public const string CancelFallback = "Cancel";

    /// <summary>Credential-mode submit button label (web <c>sudo.submit</c>).</summary>
    public const string SubmitKey = "translation.sudo.submit";

    /// <summary>Credential-mode submit button label fallback.</summary>
    public const string SubmitFallback = "Confirm";

    /// <summary>Open-mode submit button label (web <c>sudo.openMode.submit</c>).</summary>
    public const string OpenSubmitKey = "translation.sudo.openMode.submit";

    /// <summary>Open-mode submit button label fallback.</summary>
    public const string OpenSubmitFallback = "Continue";

    /// <summary>Typed-confirmation mismatch error template (web <c>sudo.errors.typedConfirmationMismatch</c>).</summary>
    public const string TypedConfirmationMismatchKey = "translation.sudo.errors.typedConfirmationMismatch";

    /// <summary>Typed-confirmation mismatch error fallback (interpolated via <see cref="WithToken"/>).</summary>
    public const string TypedConfirmationMismatchFallback = "Type {{token}} exactly to confirm.";

    /// <summary>Empty-password error (web <c>sudo.errors.passwordRequired</c>).</summary>
    public const string PasswordRequiredKey = "translation.sudo.errors.passwordRequired";

    /// <summary>Empty-password error fallback.</summary>
    public const string PasswordRequiredFallback = "Enter your password to continue.";

    /// <summary>Empty-code error (web <c>sudo.errors.totpRequired</c>).</summary>
    public const string TotpRequiredKey = "translation.sudo.errors.totpRequired";

    /// <summary>Empty-code error fallback.</summary>
    public const string TotpRequiredFallback = "Enter the 6-digit code from your authenticator.";

    /// <summary>Wrong-password error (web <c>sudo.errors.invalidPassword</c>).</summary>
    public const string InvalidPasswordKey = "translation.sudo.errors.invalidPassword";

    /// <summary>Wrong-password error fallback.</summary>
    public const string InvalidPasswordFallback = "Password did not match.";

    /// <summary>Wrong-code error (web <c>sudo.errors.invalidTotp</c>).</summary>
    public const string InvalidTotpKey = "translation.sudo.errors.invalidTotp";

    /// <summary>Wrong-code error fallback.</summary>
    public const string InvalidTotpFallback = "Authenticator code was rejected.";

    /// <summary>Server-not-configured error (web <c>sudo.errors.notConfigured</c>).</summary>
    public const string NotConfiguredKey = "translation.sudo.errors.notConfigured";

    /// <summary>Server-not-configured error fallback.</summary>
    public const string NotConfiguredFallback =
        "Step-up reauth is not configured on this server. Ask your administrator to set TESLASYNC_SUDO_PASSWORD or TESLASYNC_SUDO_TOTP_SECRET.";

    /// <summary>Generic failure error (web <c>sudo.errors.unknown</c>).</summary>
    public const string UnknownKey = "translation.sudo.errors.unknown";

    /// <summary>Generic failure error fallback.</summary>
    public const string UnknownFallback = "Reauthentication failed.";

    /// <summary>Server structured code for a rejected credential (web INVALID_CREDENTIAL branch).</summary>
    public const string InvalidCredentialCode = "INVALID_CREDENTIAL";

    /// <summary>Server structured code when step-up reauth is unconfigured (web REAUTH_NOT_CONFIGURED branch).</summary>
    public const string ReauthNotConfiguredCode = "REAUTH_NOT_CONFIGURED";

    /// <summary>Per-user TOTP rejection code remapped onto <see cref="InvalidCredentialCode"/> (web submitPerUserTotp).</summary>
    public const string TotpInvalidCode = "TOTP_INVALID";

    /// <summary>Interpolate the web <c>{{token}}</c> slot with the typed-confirmation token.</summary>
    public static string WithToken(string template) =>
        (template ?? string.Empty).Replace("{{token}}", ReauthDialogRegistration.TypedConfirmationToken, StringComparison.Ordinal);
}

/// <summary>
/// PII-safe diagnostics for the reauth dialog surface (P1/S11 diagnostics contract). The dialog handles
/// credential material, so the collector records only the operational <c>view.opened</c> event with the
/// surface slug — never a password, code, token, or path. Thread-safe.
/// </summary>
public sealed class ReauthDialogDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public ReauthDialogDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the dialog has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the dialog was opened, emitting <c>view.opened slug=ReauthDialog</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(string.Create(CultureInfo.InvariantCulture, $"view.opened slug={ReauthDialogRegistration.Slug}"));
    }
}
