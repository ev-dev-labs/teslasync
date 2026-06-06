namespace TeslaSync.App.Core.Live;

/// <summary>
/// Raised by an <see cref="ISseTransport"/> when the live endpoint answers a connection attempt
/// with <c>401 Unauthorized</c>. <see cref="SseClient"/> treats this distinctly from a generic
/// transport drop: it asks the <see cref="Auth.ITokenProvider"/> to refresh once and reconnects;
/// a second consecutive <c>401</c> surfaces <see cref="LiveConnection.AuthRequired"/> rather than
/// looping. The message never contains token material.
/// </summary>
public sealed class SseUnauthorizedException : Exception
{
    /// <summary>Creates the exception with a default, redaction-safe message.</summary>
    public SseUnauthorizedException()
        : base("The live stream was rejected with 401 Unauthorized.")
    {
    }

    /// <summary>Creates the exception with a custom (redaction-safe) message.</summary>
    public SseUnauthorizedException(string message)
        : base(message)
    {
    }

    /// <summary>Creates the exception wrapping an inner cause.</summary>
    public SseUnauthorizedException(string message, Exception innerException)
        : base(message, innerException)
    {
    }
}
