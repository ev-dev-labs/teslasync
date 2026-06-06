namespace TeslaSync.App.Core.Data.State;

/// <summary>
/// Coarse classification of a repository failure, mapped from transport/HTTP
/// faults by <see cref="Behavior.ApiErrorMapper"/>. W7 pages branch on this to
/// pick the right recovery affordance (retry, re-auth, offline banner, …).
/// </summary>
public enum RepositoryErrorKind
{
    /// <summary>The device/host could not reach the API (DNS, socket, TLS, timeout).</summary>
    Network,

    /// <summary>A request was attempted while known to be offline.</summary>
    Offline,

    /// <summary>Authentication failed and could not be refreshed (401/403 after retry).</summary>
    Unauthorized,

    /// <summary>The requested resource does not exist (404).</summary>
    NotFound,

    /// <summary>The server returned a 5xx response.</summary>
    Server,

    /// <summary>The server asked the client to back off (429).</summary>
    RateLimited,

    /// <summary>The response body could not be decoded into the expected shape.</summary>
    Decoding,

    /// <summary>The operation was canceled by the caller.</summary>
    Canceled,

    /// <summary>An otherwise-unclassified failure.</summary>
    Unknown,
}

/// <summary>
/// A privacy-safe description of a repository failure. <see cref="Message"/> is a
/// human-readable summary that never contains token material (callers redact via
/// <c>TokenRedaction</c> before logging). <see cref="StatusCode"/> and
/// <see cref="Code"/> carry the HTTP status and the server's structured error code
/// when available.
/// </summary>
public sealed record RepositoryError(
    RepositoryErrorKind Kind,
    string Message,
    int? StatusCode = null,
    string? Code = null)
{
    /// <summary>True when retrying the same request might succeed.</summary>
    public bool IsRetryable => Kind is RepositoryErrorKind.Network
        or RepositoryErrorKind.Server
        or RepositoryErrorKind.RateLimited;

    /// <summary>True when the failure should force a re-authentication.</summary>
    public bool RequiresReauth => Kind is RepositoryErrorKind.Unauthorized;
}
