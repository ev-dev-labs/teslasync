using System.Text;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// Encode / decode direction of the <see cref="Base64ToolViewModel"/> — the native union of the web
/// <c>mode</c> state ('encode' | 'decode') in
/// web/src/features/admin/components/devtools/tools/Base64Tool.tsx.
/// </summary>
public enum Base64ToolMode
{
    /// <summary>Plain text → Base64 (the web <c>btoa</c> branch).</summary>
    Encode,

    /// <summary>Base64 → plain text (the web <c>atob</c> branch).</summary>
    Decode,
}

/// <summary>
/// The display state the Base64 surface can be in — the honest union of the branches the web source
/// actually renders. The tool is a pure client-side codec (its only hook is <c>useTranslation</c>; it
/// performs no I/O), so there is no loading / error / stale / offline branch to reproduce: the web's
/// <c>output</c> memo collapses to exactly these three outcomes, gated by <c>{output &amp;&amp; (…)}</c>.
/// </summary>
public enum Base64ToolState
{
    /// <summary>No input yet — the output panel is not rendered (web falsy <c>output</c>); the input affordance is always visible.</summary>
    Empty,

    /// <summary>The codec succeeded — the output panel shows the converted value.</summary>
    Success,

    /// <summary>The codec threw (malformed input) — the output panel shows the localized "Invalid Input" message.</summary>
    Invalid,
}

/// <summary>
/// The outcome of a single <see cref="Base64Codec"/> conversion: whether it succeeded and, when it
/// did, the converted value. Localization-free so the conversion contract is unit-tested without a
/// resource host; the localized "Invalid Input" copy is applied by the view-model.
/// </summary>
public readonly record struct Base64CodecResult(bool Ok, string Value)
{
    /// <summary>A successful conversion carrying <paramref name="value"/>.</summary>
    public static Base64CodecResult Succeeded(string value) => new(true, value);

    /// <summary>A failed conversion (malformed input).</summary>
    public static Base64CodecResult Failed() => new(false, string.Empty);
}

/// <summary>
/// Pure Base64 codec — the native port of the web source's <c>btoa</c> / <c>atob</c> memo. It
/// reproduces the browser semantics the web relies on: <c>btoa</c> encodes a "binary string" whose
/// every code unit must be a single byte (0–255) and throws otherwise; <c>atob</c> decodes Base64 and
/// throws on malformed input. Both failures surface as <see cref="Base64CodecResult.Failed"/>, which
/// the view-model maps to the localized "Invalid Input" message — matching the web <c>try/catch</c>.
/// UI-free and deterministic so it is fully unit-testable.
/// </summary>
public static class Base64Codec
{
    /// <summary>
    /// Convert <paramref name="input"/> in the given <paramref name="mode"/>. Empty input yields an
    /// empty success (the web early-returns <c>''</c>), so the surface shows no output panel.
    /// </summary>
    public static Base64CodecResult Transform(Base64ToolMode mode, string? input)
    {
        if (string.IsNullOrEmpty(input))
        {
            return Base64CodecResult.Succeeded(string.Empty);
        }

        return mode == Base64ToolMode.Encode ? Encode(input) : Decode(input);
    }

    // btoa: every UTF-16 code unit must fit in one byte; a code unit > 0xFF is a DOMException in the
    // browser, which the web catch turns into "Invalid Input".
    private static Base64CodecResult Encode(string input)
    {
        foreach (char c in input)
        {
            if (c > 0xFF)
            {
                return Base64CodecResult.Failed();
            }
        }

        byte[] bytes = Encoding.Latin1.GetBytes(input);
        return Base64CodecResult.Succeeded(Convert.ToBase64String(bytes));
    }

    // atob: decode Base64 to a binary string (one char per byte). Malformed Base64 throws in the
    // browser; FromBase64String throws the analogous FormatException, which we map to a failure.
    private static Base64CodecResult Decode(string input)
    {
        try
        {
            byte[] bytes = Convert.FromBase64String(input);
            return Base64CodecResult.Succeeded(Encoding.Latin1.GetString(bytes));
        }
        catch (FormatException)
        {
            return Base64CodecResult.Failed();
        }
    }
}

/// <summary>
/// Canonical identity + presentation metadata for the Base64 surface — the native mirror of the web
/// tool's registry entry (color 'amber', icon <c>Braces</c>, titles
/// <c>devtools.utils.base64</c> / <c>devtools.utils.base64Desc</c>). Surfaced as constants so the
/// values are asserted in unit tests and consumed token-first by the view.
/// </summary>
public static class Base64ToolRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "base64";

    /// <summary>Surface category (the web devtools "client utilities" group).</summary>
    public const string Category = "devtools";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "Base64Tool";

    /// <summary>Segoe Fluent "Code" glyph — the native stand-in for the web Lucide <c>Braces</c> icon.</summary>
    public const string IconGlyph = "\uE943";

    /// <summary>Accent colour token key (amber) backing the icon chip — the web 'amber' <c>ICON_COLOR_MAP</c> entry.</summary>
    public const string AccentColorKey = "TsColorWarningColor";

    /// <summary>Accent brush token key (amber) for the icon glyph foreground.</summary>
    public const string AccentBrushKey = "TsColorWarningBrush";

    /// <summary>Localized title (web <c>devtools.utils.base64</c> → "Base64").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("devtools.utils.base64", "Base64");
    }

    /// <summary>Localized description (web <c>devtools.utils.base64Desc</c> → "Base64Desc").</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("devtools.utils.base64Desc", "Base64Desc");
    }
}
