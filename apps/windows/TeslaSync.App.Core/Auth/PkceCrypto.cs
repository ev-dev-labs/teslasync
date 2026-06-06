using System.Security.Cryptography;
using System.Text;

namespace TeslaSync.App.Core.Auth;

/// <summary>
/// Low-level cryptographic primitives for the OIDC PKCE flow (ADR-008): a
/// cryptographically secure random byte source, SHA-256, and unpadded BASE64URL
/// encoding (RFC 4648 §5). Kept WinUI-free so the auth logic is unit-tested headlessly.
/// </summary>
public static class PkceCrypto
{
    /// <summary>Returns <paramref name="count"/> cryptographically secure random bytes.</summary>
    public static byte[] SecureRandomBytes(int count)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(count);
        return RandomNumberGenerator.GetBytes(count);
    }

    /// <summary>SHA-256 digest of <paramref name="data"/>.</summary>
    public static byte[] Sha256(byte[] data)
    {
        ArgumentNullException.ThrowIfNull(data);
        return SHA256.HashData(data);
    }

    /// <summary>SHA-256 digest of the ASCII bytes of <paramref name="value"/>.</summary>
    public static byte[] Sha256(string value)
    {
        ArgumentNullException.ThrowIfNull(value);
        return SHA256.HashData(Encoding.ASCII.GetBytes(value));
    }

    /// <summary>
    /// Encodes <paramref name="data"/> as unpadded BASE64URL: standard Base64 with
    /// <c>+</c>→<c>-</c>, <c>/</c>→<c>_</c> and the trailing <c>=</c> padding removed.
    /// </summary>
    public static string Base64UrlNoPad(byte[] data)
    {
        ArgumentNullException.ThrowIfNull(data);
        return Convert.ToBase64String(data)
            .Replace('+', '-')
            .Replace('/', '_')
            .TrimEnd('=');
    }
}
