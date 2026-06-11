using System.Net.Http;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// The process-wide step-up challenge queue — the native analogue of the web module-level queue in
/// <c>ReauthDialog.tsx</c> (<c>active</c> / <c>pending</c> / <c>listeners</c>) plus its
/// <c>enqueue</c> / <c>resolveActive</c> / <c>rejectActive</c> helpers. The API client's SUDO_REQUIRED
/// interceptor calls <see cref="EnqueueAsync"/>; the dialog view-model observes <see cref="Changed"/> and
/// resolves or rejects the active challenge. Because the dialog is modal only one challenge is ever active;
/// the rest await their turn behind it, exactly like the web promise queue. Internally synchronized so the
/// background interceptor and the UI thread can touch it safely; <see cref="Changed"/> is raised outside the
/// lock.
/// </summary>
public sealed class ReauthChallengeBroker : IReauthChallengeBroker
{
    private readonly object _gate = new();
    private readonly Queue<PendingEntry> _pending = new();
    private PendingEntry? _active;

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public ReauthChallenge? Active
    {
        get
        {
            lock (_gate)
            {
                return _active?.Challenge;
            }
        }
    }

    /// <inheritdoc />
    public int Total
    {
        get
        {
            lock (_gate)
            {
                return (_active is null ? 0 : 1) + _pending.Count;
            }
        }
    }

    /// <summary>
    /// Enqueue a challenge for <paramref name="path"/> and await its resolution — the native analogue of the
    /// web <c>enqueue</c>. Resolves with the minted <see cref="SudoCredential"/> on submit, or faults with a
    /// <see cref="SudoCanceledException"/> on dismiss.
    /// </summary>
    public Task<SudoCredential> EnqueueAsync(string path)
    {
        var entry = new PendingEntry(new ReauthChallenge(path));
        lock (_gate)
        {
            if (_active is null)
            {
                _active = entry;
            }
            else
            {
                _pending.Enqueue(entry);
            }
        }

        RaiseChanged();
        return entry.Completion.Task;
    }

    /// <inheritdoc />
    public void ResolveActive(SudoCredential credential)
    {
        ArgumentNullException.ThrowIfNull(credential);
        PendingEntry? resolved;
        lock (_gate)
        {
            resolved = _active;
            _active = _pending.Count > 0 ? _pending.Dequeue() : null;
        }

        if (resolved is null)
        {
            return;
        }

        resolved.Completion.TrySetResult(credential);
        RaiseChanged();
    }

    /// <inheritdoc />
    public void RejectActive(Exception cause)
    {
        ArgumentNullException.ThrowIfNull(cause);
        PendingEntry? rejected;
        lock (_gate)
        {
            rejected = _active;
            _active = _pending.Count > 0 ? _pending.Dequeue() : null;
        }

        if (rejected is null)
        {
            return;
        }

        rejected.Completion.TrySetException(cause);
        RaiseChanged();
    }

    /// <summary>
    /// Drain every active and queued challenge with a <see cref="SudoCanceledException"/> — the native
    /// analogue of the web test-only <c>__resetReauthDialogForTests</c>. Lets each test start from a clean
    /// queue.
    /// </summary>
    public void Reset()
    {
        List<PendingEntry> drained = new();
        lock (_gate)
        {
            if (_active is not null)
            {
                drained.Add(_active);
                _active = null;
            }

            while (_pending.Count > 0)
            {
                drained.Add(_pending.Dequeue());
            }
        }

        foreach (var entry in drained)
        {
            entry.Completion.TrySetException(new SudoCanceledException("Queue reset."));
        }

        if (drained.Count > 0)
        {
            RaiseChanged();
        }
    }

    private void RaiseChanged() => Changed?.Invoke(this, EventArgs.Empty);

    private sealed class PendingEntry
    {
        public PendingEntry(ReauthChallenge challenge)
        {
            Challenge = challenge;
            Completion = new TaskCompletionSource<SudoCredential>(TaskCreationOptions.RunContinuationsAsynchronously);
        }

        public ReauthChallenge Challenge { get; }

        public TaskCompletionSource<SudoCredential> Completion { get; }
    }
}

/// <summary>
/// The contract-client-backed <see cref="ISessionAuthModeSource"/> — the native data adapter for the
/// deployment auth mode (web <c>useSessionMonitor</c>). It reads the generated <c>/system/auth-mode</c>
/// operation and maps the reported <c>mode</c> to <see cref="SessionAuthMode"/>; any transport fault
/// degrades to <see cref="SessionAuthMode.Unknown"/> so the dialog falls back to the credential variant
/// (web parity: anything that is not <c>'open'</c> renders the credential form). No HTTP touches the view.
/// </summary>
public sealed class SessionAuthModeSource : ISessionAuthModeSource
{
    private readonly IApiClient _api;

    /// <summary>Creates the source over the contract client.</summary>
    public SessionAuthModeSource(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<SessionAuthMode> GetModeAsync(CancellationToken cancellationToken = default)
    {
        var request = new ApiRequest(ReauthDialogRegistration.AuthModeOperation);
        try
        {
            var element = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
            return ParseMode(element);
        }
        catch (ApiException)
        {
            return SessionAuthMode.Unknown;
        }
        catch (HttpRequestException)
        {
            return SessionAuthMode.Unknown;
        }
        catch (JsonException)
        {
            return SessionAuthMode.Unknown;
        }
    }

    /// <summary>Map a <c>/system/auth-mode</c> payload to the deployment mode (tolerating mode / auth_mode keys).</summary>
    public static SessionAuthMode ParseMode(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return SessionAuthMode.Unknown;
        }

        string? mode = ReadString(element, "mode") ?? ReadString(element, "auth_mode");
        if (mode is null)
        {
            return SessionAuthMode.Unknown;
        }

        return string.Equals(mode, "open", StringComparison.OrdinalIgnoreCase)
            ? SessionAuthMode.Open
            : SessionAuthMode.ForwardAuth;
    }

    private static string? ReadString(JsonElement element, string name) =>
        element.TryGetProperty(name, out var prop) && prop.ValueKind == JsonValueKind.String
            ? prop.GetString()
            : null;
}

/// <summary>
/// The repository-backed <see cref="ITotpStatusSource"/> — the native data adapter for the per-user TOTP
/// status (web <c>useTOTPStatus</c>). It runs one cache-then-network read of the generated
/// <c>/auth/totp</c> operation through the shared <see cref="CacheThenNetworkEngine"/>, caching the raw
/// JSON so the snake_case wire shape round-trips losslessly, and maps each emission to a typed
/// <see cref="TotpStatusSnapshot"/> via <see cref="TotpStatusResultMapper"/>. The web hook treats the
/// <c>501 AUTH_MODE_OPEN</c> response as a successful <c>{ mode: 'open' }</c> status; this source mirrors
/// that by synthesizing the open-mode payload inside the fetch so the engine never sees it as a fault.
/// No HTTP touches the view.
/// </summary>
public sealed class TotpStatusSource : ITotpStatusSource
{
    private const string AuthModeOpenCode = "AUTH_MODE_OPEN";

    private static readonly JsonElement OpenModePayload = ParseOpenModePayload();

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    public TotpStatusSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<TotpStatusSnapshot>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var raw = _engine.StreamAsync<JsonElement>(
            ReauthDialogRegistration.TotpStatusCacheKey,
            FetchStatusAsync,
            IsEmptyStatus,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return TotpStatusResultMapper.Map(emission);
        }
    }

    private async Task<JsonElement> FetchStatusAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(ReauthDialogRegistration.TotpStatusOperation);
        try
        {
            return await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        }
        catch (ApiException ex) when (
            string.Equals(ex.ErrorCode, AuthModeOpenCode, StringComparison.Ordinal) || ex.StatusCode == 501)
        {
            // web: the 501 AUTH_MODE_OPEN response is a "feature unavailable" signal, not an error — the
            // status hook normalises it to { mode: 'open' } so consumers branch on the union.
            return OpenModePayload;
        }
    }

    private static bool IsEmptyStatus(JsonElement element) =>
        element.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined;

    private static JsonElement ParseOpenModePayload()
    {
        using var document = JsonDocument.Parse("{\"mode\":\"open\"}");
        return document.RootElement.Clone();
    }
}

/// <summary>
/// The contract-client-backed <see cref="IReauthSubmitter"/> — the native data adapter for the reauth
/// submission, mirroring the web <c>defaultSubmitCredential</c> / <c>submitPerUserTotp</c> free functions.
/// Per-user authenticator codes (when enrolled) post to <c>/auth/totp/sudo</c>; passwords and shared-secret
/// codes post to <c>/auth/reauth</c>. Both bypass the SUDO_REQUIRED interceptor by going straight through
/// the contract client, so the recovery flow cannot deadlock. Faults are classified into a
/// <see cref="ReauthSubmitOutcome"/> (per-user <c>TOTP_INVALID</c> is remapped onto the legacy
/// <c>INVALID_CREDENTIAL</c> code) rather than thrown. No HTTP touches the view.
/// </summary>
public sealed class ReauthSubmitter : IReauthSubmitter
{
    private readonly IApiClient _api;

    /// <summary>Creates the submitter over the contract client.</summary>
    public ReauthSubmitter(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<ReauthSubmitOutcome> SubmitAsync(
        SudoSubmitBody body, bool totpEnrolled, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(body);

        if (totpEnrolled && body.TotpCode is { } code)
        {
            return await SubmitPerUserTotpAsync(code, cancellationToken).ConfigureAwait(false);
        }

        return await SubmitReauthAsync(body, cancellationToken).ConfigureAwait(false);
    }

    private async Task<ReauthSubmitOutcome> SubmitReauthAsync(SudoSubmitBody body, CancellationToken cancellationToken)
    {
        var request = new ApiRequest(ReauthDialogRegistration.ReauthOperation, Body: body.ToReauthBody());
        try
        {
            var element = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
            return ReauthSubmitOutcome.Ok(ParseCredential(element, forceSession: false));
        }
        catch (ApiException ex)
        {
            return ReauthSubmitOutcome.Fail(ex.ErrorCode, ex.Message);
        }
        catch (HttpRequestException ex)
        {
            return ReauthSubmitOutcome.Fail(null, ex.Message);
        }
    }

    private async Task<ReauthSubmitOutcome> SubmitPerUserTotpAsync(string code, CancellationToken cancellationToken)
    {
        var body = new Dictionary<string, object?>(StringComparer.Ordinal) { ["code"] = code };
        var request = new ApiRequest(ReauthDialogRegistration.TotpSudoOperation, Body: body);
        try
        {
            var element = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
            return ReauthSubmitOutcome.Ok(ParseCredential(element, forceSession: true));
        }
        catch (ApiException ex)
        {
            // web submitPerUserTotp: map TOTP_INVALID back onto INVALID_CREDENTIAL so the dialog's existing
            // error branch still fires.
            string? remapped = string.Equals(ex.ErrorCode, ReauthDialogStrings.TotpInvalidCode, StringComparison.Ordinal)
                ? ReauthDialogStrings.InvalidCredentialCode
                : ex.ErrorCode;
            return ReauthSubmitOutcome.Fail(remapped, ex.Message);
        }
        catch (HttpRequestException ex)
        {
            return ReauthSubmitOutcome.Fail(null, ex.Message);
        }
    }

    /// <summary>
    /// Parse the reauth response — the native analogue of the web token parsing: snake_case
    /// <c>sudo_token</c> / <c>expires_at</c> with legacy camelCase aliases tolerated, and the credential
    /// mode (<c>open</c> vs <c>session</c>). When <paramref name="forceSession"/> is set (per-user TOTP) the
    /// mode is always <see cref="SudoCredentialMode.Session"/>.
    /// </summary>
    public static SudoCredential ParseCredential(JsonElement element, bool forceSession)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return new SudoCredential(SudoCredentialMode.Session);
        }

        string? token = ReadString(element, "sudo_token") ?? ReadString(element, "token");
        string? expiresAt = ReadString(element, "expires_at") ?? ReadString(element, "expiresAt");

        var mode = forceSession
            ? SudoCredentialMode.Session
            : string.Equals(ReadString(element, "mode"), "open", StringComparison.OrdinalIgnoreCase)
                ? SudoCredentialMode.Open
                : SudoCredentialMode.Session;

        return new SudoCredential(mode, token, expiresAt);
    }

    private static string? ReadString(JsonElement element, string name) =>
        element.TryGetProperty(name, out var prop) && prop.ValueKind == JsonValueKind.String
            ? prop.GetString()
            : null;
}
