using System.Text.RegularExpressions;

namespace TeslaSync.App.Core.Notifications;

/// <summary>
/// PII redaction for notification display text (P2/W8-0001, ADR-016). When the user has enabled
/// privacy redaction (e.g. hide sensitive content on the lock screen), the composer runs the toast
/// body through <see cref="Redact"/> so a VIN, a precise GPS coordinate pair or an email address is
/// masked before it ever reaches the OS toast surface. It is deliberately conservative — it would
/// rather over-mask an opaque 17-character id than surface a vehicle identifier on a shared screen.
/// </summary>
public static partial class NotificationRedaction
{
    /// <summary>The fixed marker substituted for a redacted token.</summary>
    public const string Mask = "•••";

    /// <summary>Masks any VIN, GPS coordinate pair or email address found in <paramref name="text"/>.</summary>
    public static string Redact(string? text)
    {
        if (string.IsNullOrEmpty(text))
        {
            return string.Empty;
        }

        var result = VinPattern().Replace(text, Mask);
        result = CoordinatePattern().Replace(result, Mask);
        result = EmailPattern().Replace(result, Mask);
        return result;
    }

    // A 17-character VIN (the VIN alphabet excludes I, O and Q).
    [GeneratedRegex(@"\b[A-HJ-NPR-Z0-9]{17}\b")]
    private static partial Regex VinPattern();

    // A decimal "lat, long" pair with at least three fractional digits (street-level precision).
    [GeneratedRegex(@"[-+]?\d{1,3}\.\d{3,}\s*,\s*[-+]?\d{1,3}\.\d{3,}")]
    private static partial Regex CoordinatePattern();

    [GeneratedRegex(@"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")]
    private static partial Regex EmailPattern();
}
