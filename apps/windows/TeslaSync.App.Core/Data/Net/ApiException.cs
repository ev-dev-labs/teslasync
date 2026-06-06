namespace TeslaSync.App.Core.Data.Net;

/// <summary>
/// A non-success response (or a structurally-invalid one) from the TeslaSync API.
/// Carries the HTTP <see cref="StatusCode"/> and the server's structured
/// <see cref="ErrorCode"/> when the body matched the generated <c>Error</c> shape.
/// <see cref="Body"/> is a short, already-redaction-safe snippet for diagnostics.
/// </summary>
public sealed class ApiException : Exception
{
    /// <summary>Creates an API exception.</summary>
    public ApiException(
        string message,
        int? statusCode = null,
        string? body = null,
        string? errorCode = null,
        Exception? innerException = null)
        : base(message, innerException)
    {
        StatusCode = statusCode;
        Body = body;
        ErrorCode = errorCode;
    }

    /// <summary>The HTTP status code, when the failure was an HTTP response.</summary>
    public int? StatusCode { get; }

    /// <summary>A short, redaction-safe body snippet for diagnostics.</summary>
    public string? Body { get; }

    /// <summary>The server's structured error code (from the <c>Error.code</c> field), if present.</summary>
    public string? ErrorCode { get; }
}
