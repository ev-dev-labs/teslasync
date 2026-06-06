using System.Net;
using System.Net.Http.Headers;

namespace TeslaSync.App.Core.Auth;

/// <summary>
/// A <see cref="DelegatingHandler"/> that centralizes bearer-token attachment and the
/// <c>401 Unauthorized</c> refresh-and-retry policy for every <c>/api/v1/*</c> request
/// (ADR-008). It pulls the current access token from an <see cref="ITokenProvider"/>
/// (which refreshes proactively before expiry), attaches it as
/// <c>Authorization: Bearer …</c>, and on a 401 asks the provider to refresh once and
/// replays the request a single time with the new token. Tokens are never logged.
/// </summary>
public sealed class AuthHttpHandler : DelegatingHandler
{
    private readonly ITokenProvider _tokenProvider;

    /// <summary>Creates the handler over the supplied token provider.</summary>
    public AuthHttpHandler(ITokenProvider tokenProvider)
    {
        ArgumentNullException.ThrowIfNull(tokenProvider);
        _tokenProvider = tokenProvider;
    }

    /// <summary>Creates the handler with an explicit inner handler (for composition/tests).</summary>
    public AuthHttpHandler(ITokenProvider tokenProvider, HttpMessageHandler innerHandler)
        : base(innerHandler)
    {
        ArgumentNullException.ThrowIfNull(tokenProvider);
        _tokenProvider = tokenProvider;
    }

    /// <inheritdoc />
    protected override async Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var token = await _tokenProvider.GetTokenAsync(cancellationToken).ConfigureAwait(false);
        Attach(request, token);

        var response = await base.SendAsync(request, cancellationToken).ConfigureAwait(false);
        if (response.StatusCode != HttpStatusCode.Unauthorized)
        {
            return response;
        }

        var refreshed = await _tokenProvider.OnUnauthorizedAsync(token, cancellationToken).ConfigureAwait(false);
        if (!refreshed)
        {
            return response;
        }

        var retryToken = await _tokenProvider.GetTokenAsync(cancellationToken).ConfigureAwait(false);
        if (retryToken is null)
        {
            return response;
        }

        response.Dispose();

        using var retryRequest = await CloneAsync(request).ConfigureAwait(false);
        Attach(retryRequest, retryToken);
        return await base.SendAsync(retryRequest, cancellationToken).ConfigureAwait(false);
    }

    private static void Attach(HttpRequestMessage request, string? token)
    {
        request.Headers.Authorization =
            string.IsNullOrEmpty(token) ? null : new AuthenticationHeaderValue("Bearer", token);
    }

    private static async Task<HttpRequestMessage> CloneAsync(HttpRequestMessage request)
    {
        var clone = new HttpRequestMessage(request.Method, request.RequestUri)
        {
            Version = request.Version,
            VersionPolicy = request.VersionPolicy,
        };

        foreach (var header in request.Headers)
        {
            clone.Headers.TryAddWithoutValidation(header.Key, header.Value);
        }

        foreach (var option in request.Options)
        {
            clone.Options.Set(new HttpRequestOptionsKey<object?>(option.Key), option.Value);
        }

        if (request.Content is not null)
        {
            var buffer = await request.Content.ReadAsByteArrayAsync().ConfigureAwait(false);
            var cloned = new ByteArrayContent(buffer);
            foreach (var header in request.Content.Headers)
            {
                cloned.Headers.TryAddWithoutValidation(header.Key, header.Value);
            }

            clone.Content = cloned;
        }

        return clone;
    }
}
