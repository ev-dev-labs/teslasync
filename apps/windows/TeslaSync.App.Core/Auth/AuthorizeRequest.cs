using System.Text;

namespace TeslaSync.App.Core.Auth;

/// <summary>The authorization <c>code</c> + echoed <c>state</c> parsed from a verified redirect.</summary>
/// <param name="Code">The single-use authorization code.</param>
/// <param name="State">The echoed CSRF state, checked by the caller against the value it generated.</param>
public readonly record struct ParsedRedirect(string Code, string State);

/// <summary>
/// Builds the Authorization-Code-with-PKCE authorize request URL and parses/validates
/// the authorization-response callback. Pure and headless so the OAuth wire format is
/// unit-tested without a live browser.
/// </summary>
public static class AuthorizeRequest
{
    /// <summary>
    /// Builds the authorization-request URL. All parameter values are URL-encoded. The
    /// caller retains <paramref name="state"/>/<paramref name="nonce"/> (and the
    /// verifier) to validate the callback and exchange the code.
    /// </summary>
    public static string BuildAuthorizeUrl(OidcConfig config, PkcePair pkce, string state, string nonce)
    {
        ArgumentNullException.ThrowIfNull(config);
        ArgumentNullException.ThrowIfNull(pkce);

        var parameters = new (string Key, string Value)[]
        {
            ("response_type", "code"),
            ("client_id", config.ClientId),
            ("redirect_uri", config.RedirectUri),
            ("scope", string.Join(' ', config.Scopes)),
            ("state", state),
            ("nonce", nonce),
            ("code_challenge", pkce.Challenge),
            ("code_challenge_method", pkce.Method),
        };

        var query = new StringBuilder();
        foreach (var (key, value) in parameters)
        {
            if (query.Length > 0)
            {
                query.Append('&');
            }

            query.Append(Uri.EscapeDataString(key)).Append('=').Append(Uri.EscapeDataString(value));
        }

        var separator = config.AuthorizationEndpoint.Contains('?', StringComparison.Ordinal) ? '&' : '?';
        return config.AuthorizationEndpoint + separator + query;
    }

    /// <summary>
    /// Parses and validates an authorization-response callback URI. Enforces that the
    /// callback matches the configured redirect (scheme + host + path prefix), surfaces
    /// a provider <c>error</c> as <see cref="OAuthException"/>, and rejects ambiguous
    /// responses (missing/duplicate <c>state</c> or <c>code</c>). State equality is
    /// checked by the caller against the value it generated.
    /// </summary>
    public static ParsedRedirect ParseRedirect(string callbackUri, OidcConfig config)
    {
        ArgumentNullException.ThrowIfNull(config);

        if (!Uri.TryCreate(callbackUri, UriKind.Absolute, out var url))
        {
            throw new RedirectMismatchException("Unparseable redirect URI");
        }

        if (!Uri.TryCreate(config.RedirectUri, UriKind.Absolute, out var expected))
        {
            throw new RedirectMismatchException("Configured redirect URI is not absolute");
        }

        var sameTarget =
            string.Equals(url.Scheme, expected.Scheme, StringComparison.OrdinalIgnoreCase)
            && string.Equals(url.Host, expected.Host, StringComparison.OrdinalIgnoreCase)
            && url.AbsolutePath.StartsWith(expected.AbsolutePath, StringComparison.Ordinal);
        if (!sameTarget)
        {
            throw new RedirectMismatchException("Redirect URI does not match the configured callback");
        }

        var query = ParseQuery(url.Query);

        if (query.TryGetValue("error", out var errors) && errors.Count > 0)
        {
            query.TryGetValue("error_description", out var descriptions);
            throw new OAuthException(errors[0], descriptions is { Count: > 0 } ? descriptions[0] : null);
        }

        if (!query.TryGetValue("state", out var states) || states.Count != 1)
        {
            throw new InvalidResponseException("Redirect is missing a single state value");
        }

        if (!query.TryGetValue("code", out var codes) || codes.Count != 1)
        {
            throw new InvalidResponseException("Redirect is missing a single code value");
        }

        return new ParsedRedirect(codes[0], states[0]);
    }

    private static Dictionary<string, List<string>> ParseQuery(string rawQuery)
    {
        var result = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        var query = rawQuery.StartsWith('?') ? rawQuery[1..] : rawQuery;
        if (query.Length == 0)
        {
            return result;
        }

        foreach (var pair in query.Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var eq = pair.IndexOf('=', StringComparison.Ordinal);
            var key = eq >= 0 ? pair[..eq] : pair;
            var value = eq >= 0 ? pair[(eq + 1)..] : string.Empty;

            var decodedKey = Uri.UnescapeDataString(key.Replace('+', ' '));
            var decodedValue = Uri.UnescapeDataString(value.Replace('+', ' '));

            if (!result.TryGetValue(decodedKey, out var list))
            {
                list = [];
                result[decodedKey] = list;
            }

            list.Add(decodedValue);
        }

        return result;
    }
}
