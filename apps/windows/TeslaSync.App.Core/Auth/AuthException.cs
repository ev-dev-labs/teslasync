namespace TeslaSync.App.Core.Auth;

/// <summary>
/// Structured authentication failures surfaced by the auth core. The concrete type
/// drives recovery — an <see cref="OAuthException.IsInvalidGrant"/> on refresh wipes
/// the stored tokens and forces a full re-auth.
/// </summary>
public abstract class AuthException : Exception
{
    /// <summary>Creates an auth exception with a message and optional cause.</summary>
    protected AuthException(string message, Exception? innerException = null)
        : base(message, innerException)
    {
    }
}

/// <summary>The provider returned a standard OAuth error (e.g. <c>invalid_grant</c>, <c>access_denied</c>).</summary>
public sealed class OAuthException : AuthException
{
    /// <summary>Creates an OAuth error from the provider's <c>error</c>/<c>error_description</c>.</summary>
    public OAuthException(string error, string? description = null)
        : base("OAuth error: " + error + (description is null ? string.Empty : " (" + description + ")"))
    {
        Error = error;
        Description = description;
    }

    /// <summary>The OAuth <c>error</c> code (RFC 6749 §5.2).</summary>
    public string Error { get; }

    /// <summary>The optional human-readable <c>error_description</c>.</summary>
    public string? Description { get; }

    /// <summary>True for the refresh-token-invalid signal that forces a full re-auth.</summary>
    public bool IsInvalidGrant =>
        string.Equals(Error, "invalid_grant", StringComparison.OrdinalIgnoreCase);
}

/// <summary>A 2xx token response was malformed or missing required fields.</summary>
public sealed class InvalidResponseException : AuthException
{
    /// <summary>Creates the malformed-response error.</summary>
    public InvalidResponseException(string message)
        : base(message)
    {
    }
}

/// <summary>The callback <c>state</c> did not match the value we generated (possible CSRF / mixed-up flow).</summary>
public sealed class StateMismatchException : AuthException
{
    /// <summary>Creates the state-mismatch error.</summary>
    public StateMismatchException()
        : base("Authorization response state did not match the request")
    {
    }
}

/// <summary>The callback URI did not match the configured redirect.</summary>
public sealed class RedirectMismatchException : AuthException
{
    /// <summary>Creates the redirect-mismatch error.</summary>
    public RedirectMismatchException(string message)
        : base(message)
    {
    }
}

/// <summary>A network/transport failure talking to the provider.</summary>
public sealed class TransportException : AuthException
{
    /// <summary>Creates the transport error with an optional cause.</summary>
    public TransportException(string message, Exception? innerException = null)
        : base(message, innerException)
    {
    }
}

/// <summary>The interactive sign-in was cancelled by the user (closed browser / abort).</summary>
public sealed class AuthCanceledException : AuthException
{
    /// <summary>Creates the user-cancelled error.</summary>
    public AuthCanceledException()
        : base("Sign-in was canceled")
    {
    }
}
