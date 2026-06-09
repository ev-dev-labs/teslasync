using System.Globalization;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive surface state for the <see cref="ColorConverterViewModel"/> — the native union of
/// the surfaces the web <c>ColorConverterTool</c> renders
/// (web/src/features/admin/components/devtools/tools/ColorConverter.tsx). The web tool is a purely
/// client-side surface: it derives its result synchronously from the hex text the user types
/// (<c>parsed = useMemo(...)</c>), with no network read, so it has only two states — the conversion result
/// (<see cref="Ready"/>, the web <c>{parsed &amp;&amp; ...}</c> grid of RGB / HSL / HEX cells) and the
/// no-result surface (<see cref="Empty"/>, when the hex is not a complete six-digit value, where the web
/// renders nothing). There is deliberately no loading / error / stale / offline state because the web source
/// has none (the projection resolves synchronously and cannot fault), exactly as the sibling
/// <c>ClientUtilitiesSection</c> surface documents.
/// </summary>
public enum ColorConverterState
{
    /// <summary>The hex parsed to a colour — render the RGB / HSL / HEX result cells (web <c>{parsed}</c>).</summary>
    Ready,

    /// <summary>The hex is incomplete or invalid — render the friendly empty surface, never a blank box.</summary>
    Empty,
}

/// <summary>
/// A parsed 24-bit RGB colour — the native analogue of the web <c>parsed</c> memo's <c>{ r, g, b }</c>
/// channels (web/src/features/admin/components/devtools/tools/ColorConverter.tsx). Pure data (no WinUI
/// types) so the conversion is unit-tested without a UI host; the WinUI view maps it onto a
/// <c>Windows.UI.Color</c> brush at the render boundary.
/// </summary>
/// <param name="R">Red channel, 0-255.</param>
/// <param name="G">Green channel, 0-255.</param>
/// <param name="B">Blue channel, 0-255.</param>
public readonly record struct RgbColor(int R, int G, int B);

/// <summary>
/// A colour expressed in HSL — the native analogue of the web <c>rgbToHsl</c> result's <c>[h, s, l]</c>
/// (web/src/features/admin/components/devtools/helpers.ts). Hue is in degrees (0-360); saturation and
/// lightness are percentages (0-100). Pure data so the conversion is asserted without a UI host.
/// </summary>
/// <param name="H">Hue in degrees, 0-360.</param>
/// <param name="S">Saturation percentage, 0-100.</param>
/// <param name="L">Lightness percentage, 0-100.</param>
public readonly record struct HslColor(int H, int S, int L);

/// <summary>
/// One projected, render-ready result cell — the native analogue of one of the web tool's three result tiles
/// (web/src/features/admin/components/devtools/tools/ColorConverter.tsx): a short format label (<c>RGB</c>,
/// <c>HSL</c>, <c>HEX</c>) over a monospace value string that the cell both displays and copies (the web
/// <c>&lt;CopyButton text={value} /&gt;</c> copies the same string it shows). Pure data so the projection is
/// unit-tested without a UI host.
/// </summary>
/// <param name="Label">The short format label (web tile heading; an untranslated format acronym).</param>
/// <param name="Value">The formatted value shown in monospace and placed on the clipboard.</param>
public sealed record ColorConverterCell(string Label, string Value);

/// <summary>
/// The fully projected, render-ready view for one hex input — the native analogue of the web tool's render:
/// the live colour swatch (the web <c>&lt;div style={{ backgroundColor: hex }} /&gt;</c>, here the parsed
/// channels the WinUI view tints a brush from, or <c>null</c> when the hex does not parse) plus the ordered
/// RGB / HSL / HEX result cells (the web <c>{parsed &amp;&amp; ...}</c> grid, empty when the hex does not
/// parse). Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Swatch">The parsed colour for the preview swatch, or <c>null</c> when the hex is invalid.</param>
/// <param name="Cells">The ordered RGB / HSL / HEX result cells (empty when the hex is invalid).</param>
public sealed record ColorConverterDisplay(RgbColor? Swatch, IReadOnlyList<ColorConverterCell> Cells)
{
    /// <summary>The empty projection — no swatch and no cells (the hex is incomplete or invalid).</summary>
    public static ColorConverterDisplay Empty { get; } =
        new(null, Array.Empty<ColorConverterCell>());

    /// <summary>True when the hex parsed to a colour (the web <c>parsed != null</c>) and cells were produced.</summary>
    public bool HasResult => Cells.Count > 0;
}

/// <summary>
/// Pure colour maths — the native port of the web tool's parsing and the <c>rgbToHsl</c> helper
/// (web/src/features/admin/components/devtools/tools/ColorConverter.tsx and
/// web/src/features/admin/components/devtools/helpers.ts). Kept UI-free so the algorithm is verified
/// row-for-row against the web behaviour without a XAML host. The two JavaScript semantics the web relies on
/// are reproduced exactly: <c>String.prototype.replace('#', '')</c> removes only the first <c>#</c>, and
/// <c>parseInt(slice, 16)</c> skips leading whitespace, honours an optional sign and <c>0x</c> prefix, then
/// consumes hex digits greedily — returning <c>NaN</c> (here <c>null</c>) only when no digit is consumed.
/// <c>Math.round</c> is reproduced as round-half-towards-positive-infinity so the HSL integers match the web
/// to the unit.
/// </summary>
public static class ColorMath
{
    /// <summary>
    /// Convert an RGB colour to HSL — the exact port of the web <c>rgbToHsl(r, g, b)</c> helper. Returns hue
    /// in degrees and saturation / lightness as percentages, each rounded the way JavaScript
    /// <c>Math.round</c> rounds (half toward positive infinity).
    /// </summary>
    /// <param name="r">Red channel, 0-255.</param>
    /// <param name="g">Green channel, 0-255.</param>
    /// <param name="b">Blue channel, 0-255.</param>
    public static HslColor RgbToHsl(int r, int g, int b)
    {
        double r1 = r / 255.0;
        double g1 = g / 255.0;
        double b1 = b / 255.0;
        double max = Math.Max(r1, Math.Max(g1, b1));
        double min = Math.Min(r1, Math.Min(g1, b1));
        double l = (max + min) / 2.0;

        if (max == min)
        {
            return new HslColor(0, 0, JsRound(l * 100));
        }

        double d = max - min;
        double s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

        double h;
        if (max == r1)
        {
            h = ((g1 - b1) / d + (g1 < b1 ? 6 : 0)) / 6;
        }
        else if (max == g1)
        {
            h = ((b1 - r1) / d + 2) / 6;
        }
        else
        {
            h = ((r1 - g1) / d + 4) / 6;
        }

        return new HslColor(JsRound(h * 360), JsRound(s * 100), JsRound(l * 100));
    }

    /// <summary>
    /// Parse a hex colour string into RGB channels exactly as the web tool does: drop the first <c>#</c>,
    /// require exactly six remaining characters, then parse three two-character pairs with JavaScript
    /// <c>parseInt(_, 16)</c> semantics. Returns <c>null</c> (the web <c>parsed = null</c>) when the length is
    /// wrong or any pair fails to parse.
    /// </summary>
    /// <param name="hex">The raw hex text the user typed (with or without a leading <c>#</c>).</param>
    public static RgbColor? TryParseHex(string? hex)
    {
        if (hex is null)
        {
            return null;
        }

        // Web parity: hex.replace('#', '') removes only the FIRST '#'.
        int hashIndex = hex.IndexOf('#');
        string clean = hashIndex >= 0 ? hex.Remove(hashIndex, 1) : hex;

        if (clean.Length != 6)
        {
            return null;
        }

        int? r = ParseHexPair(clean, 0);
        int? g = ParseHexPair(clean, 2);
        int? b = ParseHexPair(clean, 4);

        if (r is null || g is null || b is null)
        {
            return null;
        }

        return new RgbColor(r.Value, g.Value, b.Value);
    }

    // JavaScript Math.round: round half toward positive infinity (Math.round(x) === Math.floor(x + 0.5)).
    private static int JsRound(double value) => (int)Math.Floor(value + 0.5);

    private static int? ParseHexPair(string clean, int start) =>
        JsParseIntHex(clean.AsSpan(start, 2));

    // Faithful port of JavaScript parseInt(text, 16): skip leading whitespace, honour an optional sign and an
    // optional 0x/0X prefix, then consume hex digits greedily. Returns null for NaN (no digit consumed).
    private static int? JsParseIntHex(ReadOnlySpan<char> text)
    {
        int i = 0;
        int n = text.Length;

        while (i < n && char.IsWhiteSpace(text[i]))
        {
            i++;
        }

        int sign = 1;
        if (i < n && (text[i] == '+' || text[i] == '-'))
        {
            if (text[i] == '-')
            {
                sign = -1;
            }

            i++;
        }

        if (i + 1 < n && text[i] == '0' && (text[i + 1] == 'x' || text[i + 1] == 'X'))
        {
            i += 2;
        }

        int digitStart = i;
        long value = 0;
        while (i < n)
        {
            int digit = HexDigit(text[i]);
            if (digit < 0)
            {
                break;
            }

            value = (value * 16) + digit;
            i++;
        }

        if (i == digitStart)
        {
            return null;
        }

        return (int)(sign * value);
    }

    private static int HexDigit(char c) => c switch
    {
        >= '0' and <= '9' => c - '0',
        >= 'a' and <= 'f' => c - 'a' + 10,
        >= 'A' and <= 'F' => c - 'A' + 10,
        _ => -1,
    };
}

/// <summary>
/// Pure projection from a raw hex string to the render-ready <see cref="ColorConverterDisplay"/> — the native
/// port of the web tool's <c>parsed</c> memo plus its result-tile render
/// (web/src/features/admin/components/devtools/tools/ColorConverter.tsx). When the hex parses it emits the
/// swatch colour and the three result cells in the web's order (RGB, HSL, HEX), each value formatted exactly
/// as the web template strings produce (<c>rgb(r, g, b)</c>, <c>hsl(h, s%, l%)</c>, and the echoed hex text);
/// otherwise it returns <see cref="ColorConverterDisplay.Empty"/>. The format labels are the web's own
/// untranslated acronyms, so they are constants rather than i18n keys. Numeric formatting is invariant so the
/// emitted strings are deterministic and locale-independent (the web emits ASCII digits).
/// </summary>
public static class ColorConverterProjection
{
    /// <summary>The RGB result tile's format label (web <c>&lt;span&gt;RGB&lt;/span&gt;</c>).</summary>
    public const string RgbLabel = "RGB";

    /// <summary>The HSL result tile's format label (web <c>&lt;span&gt;HSL&lt;/span&gt;</c>).</summary>
    public const string HslLabel = "HSL";

    /// <summary>The HEX result tile's format label (web <c>&lt;span&gt;HEX&lt;/span&gt;</c>).</summary>
    public const string HexLabel = "HEX";

    /// <summary>
    /// Project <paramref name="hex"/> into the render-ready display: the swatch colour and the ordered RGB /
    /// HSL / HEX cells when the hex parses (web <c>parsed</c>), or the empty projection when it does not.
    /// </summary>
    /// <param name="hex">The raw hex text the user typed.</param>
    public static ColorConverterDisplay Project(string? hex)
    {
        RgbColor? parsed = ColorMath.TryParseHex(hex);
        if (parsed is not { } rgb)
        {
            return ColorConverterDisplay.Empty;
        }

        HslColor hsl = ColorMath.RgbToHsl(rgb.R, rgb.G, rgb.B);

        var cells = new ColorConverterCell[]
        {
            new(RgbLabel, FormatRgb(rgb)),
            new(HslLabel, FormatHsl(hsl)),
            new(HexLabel, hex ?? string.Empty),
        };

        return new ColorConverterDisplay(rgb, cells);
    }

    /// <summary>Format an RGB colour as the web <c>rgb(r, g, b)</c> string.</summary>
    /// <param name="rgb">The colour to format.</param>
    public static string FormatRgb(RgbColor rgb) =>
        string.Create(CultureInfo.InvariantCulture, $"rgb({rgb.R}, {rgb.G}, {rgb.B})");

    /// <summary>Format an HSL colour as the web <c>hsl(h, s%, l%)</c> string.</summary>
    /// <param name="hsl">The colour to format.</param>
    public static string FormatHsl(HslColor hsl) =>
        string.Create(CultureInfo.InvariantCulture, $"hsl({hsl.H}, {hsl.S}%, {hsl.L}%)");
}

/// <summary>
/// Canonical registry metadata for the ColorConverter surface — the native anchor for the web tool at
/// web/src/features/admin/components/devtools/tools/ColorConverter.tsx. The diagnostics <see cref="Slug"/> is
/// the stable surface identifier emitted with the <c>view.opened</c> event (P1/S11 diagnostics contract).
/// <see cref="Glyph"/> is the Segoe Fluent code point standing in for the web Lucide <c>Palette</c> icon and
/// <see cref="AccentBrushKey"/> is the semantic design token standing in for the web Tailwind neon-purple
/// colour (web <c>ICON_COLOR_MAP</c>), matching the entry the sibling <c>ClientUtilitiesSection</c> catalog
/// already registers for the <c>color</c> tool. <see cref="DefaultHex"/> is the web tool's initial state
/// value, reused as the field's sample hint.
/// </summary>
public static class ColorConverterRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "ColorConverter";

    /// <summary>Segoe Fluent header glyph — Palette (web Lucide <c>Palette</c>).</summary>
    public const string Glyph = "\uE790";

    /// <summary>Semantic accent token key for the header glyph tint (web Tailwind neon-purple).</summary>
    public const string AccentBrushKey = "TsColorAccentBrush";

    /// <summary>The web tool's initial hex (<c>#3b82f6</c>), reused as the field's sample hint.</summary>
    public const string DefaultHex = "#3b82f6";
}

/// <summary>
/// PII-safe diagnostics for the ColorConverter surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never the hex the operator typed or any
/// derived colour — so a diagnostics line can never leak user input. Thread-safe.
/// </summary>
public sealed class ColorConverterDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional operational-only line sink (no user data is ever passed).</param>
    public ColorConverterDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ColorConverter</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={ColorConverterRegistration.Slug}");
    }
}
