using TeslaSync.App.Core.Auth;
using Windows.System;

namespace TeslaSync.App.Auth;

/// <summary>
/// <see cref="IAuthBrowser"/> for WinUI 3 (ADR-008). WinUI 3 has no in-process
/// <c>WebAuthenticationBroker</c> equivalent to UWP, so the authorize step is performed
/// in the user's default system browser (launched via <see cref="Launcher.LaunchUriAsync(Uri)"/>)
/// and the response is delivered back through the registered <c>teslasync://</c> custom
/// URI scheme as a protocol activation. This keeps Authentik's login (and any IdP MFA /
/// passkey UX) in the trusted system browser with shared SSO cookies, and never embeds a
/// WebView the app could scrape.
///
/// <para>
/// <see cref="AuthorizeAsync"/> opens the URL and parks a <see cref="TaskCompletionSource{TResult}"/>;
/// the app's activation handler calls <see cref="TryComplete(Uri)"/> when the callback URI
/// arrives, resolving the awaiting sign-in.
/// </para>
/// </summary>
public sealed class WebAuthenticationBrowser : IAuthBrowser
{
    private readonly object _gate = new();
    private TaskCompletionSource<string>? _pending;

    /// <inheritdoc />
    public async Task<RedirectResult> AuthorizeAsync(string authorizeUrl, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(authorizeUrl);
        cancellationToken.ThrowIfCancellationRequested();

        var tcs = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        lock (_gate)
        {
            // A new interactive sign-in supersedes any abandoned previous attempt.
            _pending?.TrySetCanceled(CancellationToken.None);
            _pending = tcs;
        }

        using var registration = cancellationToken.Register(static state =>
            ((TaskCompletionSource<string>)state!).TrySetCanceled(), tcs);

        var launched = await Launcher.LaunchUriAsync(new Uri(authorizeUrl)).AsTask().ConfigureAwait(true);
        if (!launched)
        {
            lock (_gate)
            {
                if (ReferenceEquals(_pending, tcs))
                {
                    _pending = null;
                }
            }

            throw new TransportException("Unable to launch the system browser for sign-in.");
        }

        string callbackUri;
        try
        {
            callbackUri = await tcs.Task.ConfigureAwait(true);
        }
        catch (TaskCanceledException)
        {
            throw new AuthCanceledException();
        }
        finally
        {
            lock (_gate)
            {
                if (ReferenceEquals(_pending, tcs))
                {
                    _pending = null;
                }
            }
        }

        return new RedirectResult(callbackUri);
    }

    /// <summary>
    /// Completes a pending <see cref="AuthorizeAsync"/> with the OAuth callback
    /// <paramref name="callbackUri"/> delivered by protocol activation. Returns
    /// <see langword="true"/> when a sign-in was awaiting this callback.
    /// </summary>
    public bool TryComplete(Uri callbackUri)
    {
        ArgumentNullException.ThrowIfNull(callbackUri);

        TaskCompletionSource<string>? pending;
        lock (_gate)
        {
            pending = _pending;
        }

        return pending is not null && pending.TrySetResult(callbackUri.OriginalString);
    }
}
