using System.Text.RegularExpressions;

namespace TeslaSync.App.Core.Auth;

/// <summary>
/// Redacts OAuth token material from strings before they reach any log sink
/// (observability redaction, ADR-008 §6 / authentik runbook §4). Token values, bearer
/// headers and the sensitive OAuth form/JSON fields are replaced with a fixed marker
/// so a misrouted log line can never leak credentials.
/// </summary>
public static partial class TokenRedaction
{
    /// <summary>The fixed marker substituted for any redacted secret.</summary>
    public const string Marker = "***REDACTED***";

    /// <summary>
    /// Redacts <paramref name="input"/>: bearer headers, and the values of
    /// <c>access_token</c> / <c>refresh_token</c> / <c>id_token</c> / <c>code</c> /
    /// <c>code_verifier</c> / <c>client_secret</c> in both JSON and form/query shapes.
    /// </summary>
    public static string Redact(string? input)
    {
        if (string.IsNullOrEmpty(input))
        {
            return input ?? string.Empty;
        }

        var output = BearerHeader().Replace(input, "Bearer " + Marker);
        output = JsonSecret().Replace(output, m => m.Groups["key"].Value + "\"" + Marker + "\"");
        output = FormSecret().Replace(output, m => m.Groups["key"].Value + Marker);
        return output;
    }

    [GeneratedRegex(@"Bearer\s+[A-Za-z0-9._\-]+", RegexOptions.IgnoreCase)]
    private static partial Regex BearerHeader();

    [GeneratedRegex(
        "(?<key>\"(?:access_token|refresh_token|id_token|code|code_verifier|client_secret)\"\\s*:\\s*)\"[^\"]*\"",
        RegexOptions.IgnoreCase)]
    private static partial Regex JsonSecret();

    [GeneratedRegex(
        @"(?<key>(?:access_token|refresh_token|id_token|code|code_verifier|client_secret)=)[^&\s""]+",
        RegexOptions.IgnoreCase)]
    private static partial Regex FormSecret();
}
