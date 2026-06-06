namespace TeslaSync.App.Core.Auth;

/// <summary>
/// A PKCE (RFC 7636) verifier/challenge pair. The <see cref="Verifier"/> is kept
/// private to the app and sent only on the token exchange; the <see cref="Challenge"/>
/// is what travels in the authorize request. <see cref="Method"/> is always
/// <c>S256</c> — the <c>plain</c> method is rejected.
/// </summary>
public sealed class PkcePair
{
    internal PkcePair(string verifier, string challenge)
    {
        Verifier = verifier;
        Challenge = challenge;
    }

    /// <summary>The high-entropy <c>code_verifier</c> (private; sent only on token exchange).</summary>
    public string Verifier { get; }

    /// <summary>The <c>code_challenge</c> sent in the authorize request.</summary>
    public string Challenge { get; }

    /// <summary>The challenge method — always <c>S256</c>.</summary>
    public string Method { get; } = "S256";
}

/// <summary>
/// PKCE generation helpers (RFC 7636) plus the URL-safe random token used for the
/// OAuth <c>state</c> (CSRF defence) and <c>nonce</c> (ID-token replay defence).
/// </summary>
public static class Pkce
{
    /// <summary>
    /// Derives the S256 <c>code_challenge</c> for a <paramref name="verifier"/>:
    /// <c>BASE64URL(SHA256(ASCII(verifier)))</c>. Exposed for the RFC 7636
    /// known-answer test.
    /// </summary>
    public static string ChallengeFor(string verifier) =>
        PkceCrypto.Base64UrlNoPad(PkceCrypto.Sha256(verifier));

    /// <summary>
    /// Generates a fresh PKCE pair: a 43-character verifier (256 bits of entropy,
    /// <c>BASE64URL(32 random bytes)</c>, within RFC 7636's 43–128 length window) and
    /// its S256 challenge. <paramref name="randomBytes"/> is injectable so tests can
    /// pin the verifier; production uses <see cref="PkceCrypto.SecureRandomBytes"/>.
    /// </summary>
    public static PkcePair Generate(Func<int, byte[]>? randomBytes = null)
    {
        var rng = randomBytes ?? PkceCrypto.SecureRandomBytes;
        var verifier = PkceCrypto.Base64UrlNoPad(rng(32));
        return new PkcePair(verifier, ChallengeFor(verifier));
    }

    /// <summary>
    /// A 256-bit, URL-safe random token used for the OAuth <c>state</c> and
    /// <c>nonce</c> parameters.
    /// </summary>
    public static string RandomUrlToken(Func<int, byte[]>? randomBytes = null)
    {
        var rng = randomBytes ?? PkceCrypto.SecureRandomBytes;
        return PkceCrypto.Base64UrlNoPad(rng(32));
    }
}
