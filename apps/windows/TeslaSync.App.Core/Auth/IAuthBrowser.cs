namespace TeslaSync.App.Core.Auth;

/// <summary>
/// The result of a platform browser round-trip: the full callback URI the
/// authorization server redirected to (carrying <c>code</c>+<c>state</c>, or an
/// <c>error</c>).
/// </summary>
/// <param name="CallbackUri">The verbatim redirect URI returned to the app.</param>
public readonly record struct RedirectResult(string CallbackUri);

/// <summary>
/// Platform seam for the interactive authorize step. The core owns all crypto and
/// token logic and only delegates the system-browser round-trip to the platform
/// (on Windows, a <c>WebAuthenticationBroker</c>-compatible system-browser + loopback
/// flow). Implementations open <paramref name="authorizeUrl"/>, wait for the redirect
/// back to the registered callback, and return it as a <see cref="RedirectResult"/>.
/// A user cancellation should surface as an <see cref="AuthCanceledException"/>.
/// </summary>
public interface IAuthBrowser
{
    /// <summary>Opens <paramref name="authorizeUrl"/> and awaits the registered callback redirect.</summary>
    Task<RedirectResult> AuthorizeAsync(string authorizeUrl, CancellationToken cancellationToken = default);
}
