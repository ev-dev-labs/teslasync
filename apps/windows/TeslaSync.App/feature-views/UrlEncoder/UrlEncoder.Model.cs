using System.Text;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// Encode / decode direction of the <see cref="UrlEncoderViewModel"/> — the native union of the web
/// <c>mode</c> state ('encode' | 'decode') in
/// web/src/features/admin/components/devtools/tools/UrlEncoder.tsx.
/// </summary>
public enum UrlEncoderMode
{
    /// <summary>Plain text → percent-encoded (the web <c>encodeURIComponent</c> branch).</summary>
    Encode,

    /// <summary>Percent-encoded → plain text (the web <c>decodeURIComponent</c> branch).</summary>
    Decode,
}

/// <summary>
/// The display state the URL-encoder surface can be in — the honest union of the branches the web source
/// actually renders. The tool is a pure client-side codec (its only hook is <c>useTranslation</c>; it
/// performs no I/O), so there is no loading / error / stale / offline branch to reproduce: the web's
/// <c>output</c> memo collapses to exactly these three outcomes, gated by <c>{output &amp;&amp; (…)}</c>.
/// </summary>
public enum UrlEncoderState
{
    /// <summary>No input yet — the output panel is not rendered (web falsy <c>output</c>); the input affordance is always visible.</summary>
    Empty,

    /// <summary>The codec succeeded — the output panel shows the converted value.</summary>
    Success,

    /// <summary>The codec threw (malformed input) — the output panel shows the localized "Invalid Input" message.</summary>
    Invalid,
}

/// <summary>
/// The outcome of a single <see cref="UrlCodec"/> conversion: whether it succeeded and, when it did, the
/// converted value. Localization-free so the conversion contract is unit-tested without a resource host;
/// the localized "Invalid Input" copy is applied by the view-model.
/// </summary>
public readonly record struct UrlCodecResult(bool Ok, string Value)
{
    /// <summary>A successful conversion carrying <paramref name="value"/>.</summary>
    public static UrlCodecResult Succeeded(string value) => new(true, value);

    /// <summary>A failed conversion (malformed input).</summary>
    public static UrlCodecResult Failed() => new(false, string.Empty);
}

/// <summary>
/// Pure URL-component codec — the native port of the web source's <c>encodeURIComponent</c> /
/// <c>decodeURIComponent</c> memo. It reproduces the browser semantics the web relies on:
/// <c>encodeURIComponent</c> percent-encodes the UTF-8 bytes of every character outside the unreserved set
/// (<c>A–Z a–z 0–9 - _ . ! ~ * ' ( )</c>) and throws a <c>URIError</c> on a lone UTF-16 surrogate;
/// <c>decodeURIComponent</c> reassembles <c>%XX</c> byte runs into UTF-8 code points and throws on a
/// malformed escape or an invalid byte sequence. Both failures surface as
/// <see cref="UrlCodecResult.Failed"/>, which the view-model maps to the localized "Invalid Input" message —
/// matching the web <c>try/catch</c>. UI-free and deterministic so it is fully unit-testable.
/// </summary>
public static class UrlCodec
{
    // encodeURIComponent leaves these characters (plus ASCII alphanumerics) unescaped.
    private const string Unreserved = "-_.!~*'()";

    private static readonly char[] HexUpper = "0123456789ABCDEF".ToCharArray();

    // A strict decoder so overlong encodings, surrogate code points and out-of-range bytes fault exactly
    // as decodeURIComponent does, rather than silently yielding the U+FFFD replacement character.
    private static readonly UTF8Encoding StrictUtf8 = new(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true);

    /// <summary>
    /// Convert <paramref name="input"/> in the given <paramref name="mode"/>. Empty input yields an empty
    /// success (the web early-returns <c>''</c>), so the surface shows no output panel.
    /// </summary>
    public static UrlCodecResult Transform(UrlEncoderMode mode, string? input)
    {
        if (string.IsNullOrEmpty(input))
        {
            return UrlCodecResult.Succeeded(string.Empty);
        }

        return mode == UrlEncoderMode.Encode ? Encode(input) : Decode(input);
    }

    // encodeURIComponent: percent-encode the UTF-8 bytes of each character outside the unreserved set; a
    // lone surrogate is a URIError in the browser, which the web catch turns into "Invalid Input".
    private static UrlCodecResult Encode(string input)
    {
        var sb = new StringBuilder(input.Length * 3);
        int i = 0;
        while (i < input.Length)
        {
            char c = input[i];
            if (IsUnreserved(c))
            {
                sb.Append(c);
                i++;
                continue;
            }

            int codePoint;
            if (char.IsHighSurrogate(c))
            {
                if (i + 1 < input.Length && char.IsLowSurrogate(input[i + 1]))
                {
                    codePoint = char.ConvertToUtf32(c, input[i + 1]);
                    i += 2;
                }
                else
                {
                    return UrlCodecResult.Failed();
                }
            }
            else if (char.IsLowSurrogate(c))
            {
                return UrlCodecResult.Failed();
            }
            else
            {
                codePoint = c;
                i++;
            }

            foreach (byte b in Encoding.UTF8.GetBytes(char.ConvertFromUtf32(codePoint)))
            {
                sb.Append('%');
                sb.Append(HexUpper[(b >> 4) & 0xF]);
                sb.Append(HexUpper[b & 0xF]);
            }
        }

        return UrlCodecResult.Succeeded(sb.ToString());
    }

    // decodeURIComponent: pass non-escape characters through and reassemble each %XX byte run into its
    // UTF-8 code point. A malformed escape, a bad continuation byte, or an invalid sequence is a URIError,
    // mapped here to a failure.
    private static UrlCodecResult Decode(string input)
    {
        var sb = new StringBuilder(input.Length);
        Span<byte> octets = stackalloc byte[4];
        int k = 0;
        while (k < input.Length)
        {
            char c = input[k];
            if (c != '%')
            {
                sb.Append(c);
                k++;
                continue;
            }

            if (!TryReadEscapedByte(input, k, out byte lead))
            {
                return UrlCodecResult.Failed();
            }

            k += 3;

            if ((lead & 0x80) == 0)
            {
                sb.Append((char)lead);
                continue;
            }

            int continuationCount = LeadingOneBits(lead) - 1;
            if (continuationCount < 1 || continuationCount > 3)
            {
                return UrlCodecResult.Failed();
            }

            octets[0] = lead;
            for (int j = 1; j <= continuationCount; j++)
            {
                if (k >= input.Length || input[k] != '%' || !TryReadEscapedByte(input, k, out byte continuation))
                {
                    return UrlCodecResult.Failed();
                }

                if ((continuation & 0xC0) != 0x80)
                {
                    return UrlCodecResult.Failed();
                }

                octets[j] = continuation;
                k += 3;
            }

            if (!TryDecodeUtf8(octets[..(continuationCount + 1)], out string decoded))
            {
                return UrlCodecResult.Failed();
            }

            sb.Append(decoded);
        }

        return UrlCodecResult.Succeeded(sb.ToString());
    }

    private static bool IsUnreserved(char c) =>
        (c >= 'A' && c <= 'Z') ||
        (c >= 'a' && c <= 'z') ||
        (c >= '0' && c <= '9') ||
        Unreserved.Contains(c);

    // Reads the byte described by the "%XX" escape that begins at percentIndex; false when the escape is
    // truncated or either nibble is not a hex digit (the decodeURIComponent malformed-escape fault).
    private static bool TryReadEscapedByte(string s, int percentIndex, out byte value)
    {
        value = 0;
        if (percentIndex + 2 >= s.Length || s[percentIndex] != '%')
        {
            return false;
        }

        int high = HexValue(s[percentIndex + 1]);
        int low = HexValue(s[percentIndex + 2]);
        if (high < 0 || low < 0)
        {
            return false;
        }

        value = (byte)((high << 4) | low);
        return true;
    }

    private static int HexValue(char c) => c switch
    {
        >= '0' and <= '9' => c - '0',
        >= 'a' and <= 'f' => c - 'a' + 10,
        >= 'A' and <= 'F' => c - 'A' + 10,
        _ => -1,
    };

    private static int LeadingOneBits(byte b)
    {
        int count = 0;
        for (int mask = 0x80; mask != 0 && (b & mask) != 0; mask >>= 1)
        {
            count++;
        }

        return count;
    }

    private static bool TryDecodeUtf8(ReadOnlySpan<byte> octets, out string result)
    {
        try
        {
            result = StrictUtf8.GetString(octets);
            return true;
        }
        catch (DecoderFallbackException)
        {
            result = string.Empty;
            return false;
        }
    }
}

/// <summary>
/// Canonical identity + presentation metadata for the URL-encoder surface — the native mirror of the web
/// tool's registry entry (color 'cyan', icon <c>Link</c>, titles <c>Url Encoder</c> / <c>Url Encoder Desc</c>;
/// see <c>ClientUtilityToolSource</c>'s <c>"url"</c> row). Surfaced as constants so the values are asserted
/// in unit tests and consumed token-first by the view.
/// </summary>
public static class UrlEncoderRegistration
{
    /// <summary>Stable surface id (the web tool <c>id</c>).</summary>
    public const string Id = "url";

    /// <summary>Surface category (the web devtools "client utilities" group).</summary>
    public const string Category = "devtools";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "UrlEncoder";

    /// <summary>Segoe Fluent "Link" glyph — the native stand-in for the web Lucide <c>Link</c> icon.</summary>
    public const string IconGlyph = "\uE71B";

    /// <summary>Accent colour token key (cyan) backing the icon chip tint — the web 'cyan' <c>ICON_COLOR_MAP</c> entry.</summary>
    public const string AccentColorKey = "TsColorInfoColor";

    /// <summary>Accent brush token key (cyan) for the icon glyph foreground.</summary>
    public const string AccentBrushKey = "TsColorInfoBrush";

    /// <summary>Localized title (web <c>t('Url Encoder')</c>; the key is its own English fallback).</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("Url Encoder", "Url Encoder");
    }

    /// <summary>Localized description (web <c>t('Url Encoder Desc')</c>; the key is its own English fallback).</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("Url Encoder Desc", "Url Encoder Desc");
    }
}
