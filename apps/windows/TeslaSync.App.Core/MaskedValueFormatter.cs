namespace TeslaSync.App.Core;

/// <summary>Masking strategy for <c>TsMaskedValue</c>, mirroring the web
/// <c>MaskVariant</c> contract.</summary>
public enum MaskVariant
{
    /// <summary>Reveal the last 4 characters (tokens, keys).</summary>
    Token,

    /// <summary>Reveal the last 4 characters of a VIN.</summary>
    Vin,

    /// <summary>Mask the local part of an email, keep the domain.</summary>
    Email,

    /// <summary>Fully mask every character.</summary>
    Full,
}

/// <summary>
/// UI-free formatter producing the masked rendering of a sensitive value.
/// The WinUI <c>TsMaskedValue</c> control reveals the raw value on demand but
/// always renders this masked form by default.
/// </summary>
public static class MaskedValueFormatter
{
    private const char MaskChar = '•';
    private const string EmDash = "—";

    /// <summary>Returns the masked rendering of <paramref name="value"/>.
    /// Empty/whitespace yields an em-dash.</summary>
    public static string Mask(string? value, MaskVariant variant, int? showLast = null)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return EmDash;
        }

        return variant switch
        {
            MaskVariant.Email => MaskEmail(value),
            MaskVariant.Full => new string(MaskChar, value.Length),
            MaskVariant.Vin => MaskTail(value, showLast ?? 4),
            _ => MaskTail(value, showLast ?? 4),
        };
    }

    private static string MaskTail(string value, int showLast)
    {
        var visible = Math.Clamp(showLast, 0, value.Length);
        var hidden = value.Length - visible;
        return string.Concat(new string(MaskChar, hidden), value.AsSpan(hidden));
    }

    private static string MaskEmail(string value)
    {
        var at = value.IndexOf('@', StringComparison.Ordinal);
        if (at <= 0)
        {
            return new string(MaskChar, value.Length);
        }

        var local = value[..at];
        var domain = value[at..];
        var firstChar = local[0];
        var maskedLocal = string.Concat(firstChar.ToString(), new string(MaskChar, Math.Max(1, local.Length - 1)));
        return maskedLocal + domain;
    }
}
