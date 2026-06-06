using System.Security.Cryptography;
using System.Text;

namespace TeslaSync.App.Core.Push;

/// <summary>
/// PII / credential redaction helpers for the push layer (P2/W6-0002, ADR-016 observability). A WNS
/// <see cref="PushChannel.ChannelUri"/> and the backend device token are secrets: they are never
/// written to a log or persisted locally in plaintext. <see cref="Fingerprint"/> derives a stable,
/// non-reversible tag from a channel URI so renewal can detect a channel change and diagnostics can
/// correlate registrations without ever revealing the URI itself.
/// </summary>
public static class PushRedaction
{
    /// <summary>The fixed marker substituted for a redacted channel URI / token in a log line.</summary>
    public const string Marker = "***CHANNEL***";

    /// <summary>
    /// A stable, non-reversible fingerprint of <paramref name="channelUri"/> (a truncated SHA-256
    /// hex digest, prefixed with <c>wns:</c>). Used as the local change-detection key and in
    /// diagnostics; it can never be expanded back into the URI.
    /// </summary>
    public static string Fingerprint(string? channelUri)
    {
        if (string.IsNullOrEmpty(channelUri))
        {
            return "wns:none";
        }

        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(channelUri));
        return "wns:" + Convert.ToHexString(hash, 0, 6).ToLowerInvariant();
    }

    /// <summary>
    /// Replaces any URI value in <paramref name="line"/> with <see cref="Marker"/> so a diagnostics
    /// line can never leak a channel URI or callback address.
    /// </summary>
    public static string Redact(string? line)
    {
        if (string.IsNullOrEmpty(line))
        {
            return line ?? string.Empty;
        }

        var tokens = line.Split(' ');
        var builder = new StringBuilder(line.Length);
        for (int i = 0; i < tokens.Length; i++)
        {
            if (i > 0)
            {
                builder.Append(' ');
            }

            builder.Append(LooksLikeUri(tokens[i]) ? Marker : tokens[i]);
        }

        return builder.ToString();
    }

    private static bool LooksLikeUri(string token) =>
        token.Contains("://", StringComparison.Ordinal);
}
