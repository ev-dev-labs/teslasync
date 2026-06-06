namespace TeslaSync.App.Core.Auth;

/// <summary>
/// Observable authentication session state. A transparent refresh moves
/// <see cref="SignedIn"/> → <see cref="Refreshing"/> → <see cref="SignedIn"/>; both
/// carry the current <see cref="TokenSet"/> so the UI can keep signed-in content
/// visible while a refresh is in flight rather than flashing a signed-out view.
/// </summary>
public abstract record AuthState
{
    private AuthState()
    {
    }

    /// <summary>No credentials: the user must run the sign-in flow.</summary>
    public sealed record SignedOut : AuthState;

    /// <summary>A sign-in flow is in progress (authorize round-trip + code exchange).</summary>
    public sealed record Authenticating : AuthState;

    /// <summary>Signed in with a valid (or soon-to-be-refreshed) token set.</summary>
    public sealed record SignedIn(TokenSet Tokens) : AuthState;

    /// <summary>A token refresh is in flight; <c>Tokens</c> is the credential being replaced.</summary>
    public sealed record Refreshing(TokenSet Tokens) : AuthState;

    /// <summary>A sign-in attempt failed; <c>Cause</c> is the originating error when available.</summary>
    public sealed record Failed(string Message, Exception? Cause = null) : AuthState;

    /// <summary>True when a valid signed-in session exists (including during a refresh).</summary>
    public bool IsAuthenticated => this is SignedIn or Refreshing;
}
