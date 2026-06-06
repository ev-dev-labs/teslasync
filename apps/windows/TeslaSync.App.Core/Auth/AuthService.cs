namespace TeslaSync.App.Core.Auth;

/// <summary>
/// The platform-agnostic authentication core: OIDC Authorization-Code-with-PKCE
/// against Authentik (ADR-008). It owns all crypto and token logic — building the
/// authorize request, exchanging the code, refreshing and revoking tokens — and
/// persists credentials through an injected <see cref="ISecureTokenStore"/>. The
/// interactive browser round-trip is delegated to an <see cref="IAuthBrowser"/>; the
/// networking layer is fed via <see cref="AsTokenProvider"/>.
///
/// All token-mutating operations (sign-in, refresh, sign-out, restore) are serialized
/// by a single async lock so a refresh cannot resurrect a session a concurrent
/// sign-out just cleared, and concurrent 401s collapse into one refresh (single-flight).
/// </summary>
public sealed class AuthService : IAsyncDisposable
{
    private readonly ITokenEndpointClient _tokenClient;
    private readonly ISecureTokenStore _store;
    private readonly OidcConfig _config;
    private readonly IAuthBrowser _browser;
    private readonly Func<long> _nowEpochSeconds;
    private readonly long _proactiveRefreshSkewSeconds;
    private readonly SemaphoreSlim _mutex = new(1, 1);

    private AuthState _state = new AuthState.SignedOut();
    private TokenSet? _tokens;

    /// <summary>Creates the auth service over its provider/store/browser collaborators.</summary>
    /// <param name="tokenClient">Talks to the provider token/revocation endpoints.</param>
    /// <param name="store">Secure persistence for the <see cref="TokenSet"/>.</param>
    /// <param name="config">The OIDC public-client configuration.</param>
    /// <param name="browser">Platform seam for the authorize redirect round-trip.</param>
    /// <param name="nowEpochSeconds">Clock seam (injectable for deterministic tests).</param>
    /// <param name="proactiveRefreshSkewSeconds">Refresh this many seconds before access-token expiry.</param>
    public AuthService(
        ITokenEndpointClient tokenClient,
        ISecureTokenStore store,
        OidcConfig config,
        IAuthBrowser browser,
        Func<long>? nowEpochSeconds = null,
        long proactiveRefreshSkewSeconds = 60)
    {
        ArgumentNullException.ThrowIfNull(tokenClient);
        ArgumentNullException.ThrowIfNull(store);
        ArgumentNullException.ThrowIfNull(config);
        ArgumentNullException.ThrowIfNull(browser);

        _tokenClient = tokenClient;
        _store = store;
        _config = config;
        _browser = browser;
        _nowEpochSeconds = nowEpochSeconds ?? (() => DateTimeOffset.UtcNow.ToUnixTimeSeconds());
        _proactiveRefreshSkewSeconds = proactiveRefreshSkewSeconds;
    }

    /// <summary>Raised on every <see cref="State"/> transition (sign-in, refresh, sign-out, errors).</summary>
    public event EventHandler<AuthState>? StateChanged;

    /// <summary>The current observable session state.</summary>
    public AuthState State => _state;

    /// <summary>The current access token if signed in (no refresh), else <see langword="null"/>.</summary>
    public string? CurrentAccessToken => _tokens?.AccessToken;

    /// <summary>
    /// Rehydrates session state from the secure store on startup. Sets state to
    /// <see cref="AuthState.SignedIn"/> when a token set is present, otherwise
    /// <see cref="AuthState.SignedOut"/>.
    /// </summary>
    public async Task RestoreAsync(CancellationToken cancellationToken = default)
    {
        await _mutex.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var stored = await _store.LoadAsync(cancellationToken).ConfigureAwait(false);
            _tokens = stored;
            SetState(stored is null ? new AuthState.SignedOut() : new AuthState.SignedIn(stored));
        }
        finally
        {
            _mutex.Release();
        }
    }

    /// <summary>
    /// Runs the full interactive sign-in: generates PKCE + <c>state</c>/<c>nonce</c>,
    /// builds the authorize URL, delegates the browser round-trip, validates the
    /// callback, and exchanges the code for tokens (persisted before they become
    /// current). On any failure the state becomes <see cref="AuthState.Failed"/> and
    /// the originating exception is rethrown.
    /// </summary>
    public async Task<TokenSet> SignInAsync(CancellationToken cancellationToken = default)
    {
        SetState(new AuthState.Authenticating());
        try
        {
            var pkce = Pkce.Generate();
            var expectedState = Pkce.RandomUrlToken();
            var nonce = Pkce.RandomUrlToken();
            var authorizeUrl = AuthorizeRequest.BuildAuthorizeUrl(_config, pkce, expectedState, nonce);

            var redirect = await _browser.AuthorizeAsync(authorizeUrl, cancellationToken).ConfigureAwait(false);
            var parsed = AuthorizeRequest.ParseRedirect(redirect.CallbackUri, _config);
            if (!string.Equals(parsed.State, expectedState, StringComparison.Ordinal))
            {
                throw new StateMismatchException();
            }

            var grant = await _tokenClient
                .ExchangeAuthorizationCodeAsync(parsed.Code, pkce.Verifier, cancellationToken)
                .ConfigureAwait(false);
            var tokenSet = grant.ToTokenSet(previousRefresh: null, _nowEpochSeconds());
            await CommitAsync(tokenSet, cancellationToken).ConfigureAwait(false);
            return tokenSet;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception e)
        {
            SetState(new AuthState.Failed(e.Message, e));
            throw;
        }
    }

    /// <summary>
    /// Revokes the refresh token (best-effort) and clears all local credentials, ending
    /// in <see cref="AuthState.SignedOut"/>. Serialized with refresh so an in-flight
    /// refresh cannot re-establish the session afterwards.
    /// </summary>
    public async Task SignOutAsync(CancellationToken cancellationToken = default)
    {
        await _mutex.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var current = _tokens;
            if (current is not null)
            {
                try
                {
                    await _tokenClient.RevokeAsync(current.RefreshToken, "refresh_token", cancellationToken)
                        .ConfigureAwait(false);
                }
                catch (AuthException)
                {
                    // Revocation is best-effort; a provider failure must not block local sign-out.
                }
            }

            _tokens = null;
            await TryClearAsync(cancellationToken).ConfigureAwait(false);
            SetState(new AuthState.SignedOut());
        }
        finally
        {
            _mutex.Release();
        }
    }

    /// <summary>
    /// Adapts this service to the networking <see cref="ITokenProvider"/> seam: attaches
    /// the current access token (refreshing proactively when near expiry) and performs a
    /// single-flight refresh-and-retry on a 401.
    /// </summary>
    public ITokenProvider AsTokenProvider() => new TokenProviderAdapter(this);

    /// <inheritdoc />
    public ValueTask DisposeAsync()
    {
        _mutex.Dispose();
        return ValueTask.CompletedTask;
    }

    private async Task CommitAsync(TokenSet tokenSet, CancellationToken cancellationToken)
    {
        await _mutex.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            try
            {
                await _store.SaveAsync(tokenSet, cancellationToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception e)
            {
                _tokens = null;
                await TryClearAsync(cancellationToken).ConfigureAwait(false);
                SetState(new AuthState.SignedOut());
                throw new TransportException("Failed to persist tokens", e);
            }

            _tokens = tokenSet;
            SetState(new AuthState.SignedIn(tokenSet));
        }
        finally
        {
            _mutex.Release();
        }
    }

    /// <summary>
    /// Single-flight refresh. <paramref name="failedToken"/> is the access token whose
    /// use triggered the refresh (the 401'd bearer, or the near-expiry token). Under the
    /// lock, if the current token already differs from <paramref name="failedToken"/>
    /// another caller refreshed first, so the request can simply be replayed
    /// (<see langword="true"/>) without a second network call. An <c>invalid_grant</c>
    /// wipes the session; transient transport failures keep the existing tokens.
    /// </summary>
    private async Task<bool> RefreshLockedAsync(string? failedToken, CancellationToken cancellationToken)
    {
        await _mutex.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var current = _tokens;
            if (current is null)
            {
                return false;
            }

            if (failedToken is not null && !string.Equals(current.AccessToken, failedToken, StringComparison.Ordinal))
            {
                return true;
            }

            SetState(new AuthState.Refreshing(current));
            try
            {
                var grant = await _tokenClient.RefreshAsync(current.RefreshToken, cancellationToken)
                    .ConfigureAwait(false);
                var refreshed = grant.ToTokenSet(current.RefreshToken, _nowEpochSeconds());

                try
                {
                    await _store.SaveAsync(refreshed, cancellationToken).ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                    throw;
                }
                catch (Exception)
                {
                    _tokens = null;
                    await TryClearAsync(cancellationToken).ConfigureAwait(false);
                    SetState(new AuthState.SignedOut());
                    return false;
                }

                _tokens = refreshed;
                SetState(new AuthState.SignedIn(refreshed));
                return true;
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (OAuthException e)
            {
                if (e.IsInvalidGrant)
                {
                    _tokens = null;
                    await TryClearAsync(cancellationToken).ConfigureAwait(false);
                    SetState(new AuthState.SignedOut());
                }
                else
                {
                    // A non-fatal OAuth error: keep the session and let a later call retry.
                    SetState(new AuthState.SignedIn(current));
                }

                return false;
            }
            catch (AuthException)
            {
                // Transport/decode failure: keep credentials, stay signed in.
                SetState(new AuthState.SignedIn(current));
                return false;
            }
        }
        finally
        {
            _mutex.Release();
        }
    }

    private async Task TryClearAsync(CancellationToken cancellationToken)
    {
        try
        {
            await _store.ClearAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception)
        {
            // Clearing is best-effort; the in-memory session is already wiped.
        }
    }

    private void SetState(AuthState state)
    {
        _state = state;
        StateChanged?.Invoke(this, state);
    }

    private sealed class TokenProviderAdapter : ITokenProvider
    {
        private readonly AuthService _service;

        public TokenProviderAdapter(AuthService service) => _service = service;

        public async Task<string?> GetTokenAsync(CancellationToken cancellationToken = default)
        {
            var current = _service._tokens;
            if (current is null)
            {
                return null;
            }

            if (current.IsExpiringWithin(_service._proactiveRefreshSkewSeconds, _service._nowEpochSeconds()))
            {
                await _service.RefreshLockedAsync(current.AccessToken, cancellationToken).ConfigureAwait(false);
            }

            return _service._tokens?.AccessToken;
        }

        public Task<bool> OnUnauthorizedAsync(string? failedToken, CancellationToken cancellationToken = default) =>
            _service.RefreshLockedAsync(failedToken, cancellationToken);
    }
}
