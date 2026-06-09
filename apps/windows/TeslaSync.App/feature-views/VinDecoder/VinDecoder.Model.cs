using System.Globalization;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive surface state for the <see cref="VinDecoderViewModel"/> — the native union of the
/// surfaces the web <c>VinDecoderTool</c> renders
/// (web/src/features/admin/components/devtools/tools/VinDecoder.tsx). The web tool is a purely client-side
/// surface: it derives its result synchronously from the VIN the user types
/// (<c>decoded = useMemo(...)</c>), with no network read, so it has only two states — the decoded grid
/// (<see cref="Ready"/>, the web <c>{decoded &amp;&amp; ...}</c> grid of segment cells, shown once the VIN
/// reaches the decode threshold) and the no-result surface (<see cref="Empty"/>, when the VIN is shorter than
/// the threshold, where the web renders nothing below the field). There is deliberately no
/// loading / error / stale / offline state because the web source has none (the projection resolves
/// synchronously and cannot fault), exactly as the sibling <c>ColorConverter</c> surface documents.
/// </summary>
public enum VinDecoderState
{
    /// <summary>The VIN reached the decode threshold — render the decoded segment cells (web <c>{decoded}</c>).</summary>
    Ready,

    /// <summary>The VIN is shorter than the threshold — render the friendly empty surface, never a blank box.</summary>
    Empty,
}

/// <summary>
/// The decoded VIN segments — the native analogue of the web <c>decoded</c> memo's
/// <c>{ mfr, model, drive, year, plant, serial }</c> object
/// (web/src/features/admin/components/devtools/tools/VinDecoder.tsx). The five lookup segments hold the
/// matched dictionary value, or <c>null</c> when the corresponding VIN character is not in its table (the web
/// <c>VIN_X[...] ?? t('Unknown')</c> nullish fallback, here deferred so the localized "Unknown" is injected at
/// the display boundary rather than baked into the pure decode). <see cref="Serial"/> is the remaining VIN
/// tail and is always a string (possibly empty), exactly as the web <c>upper.slice(11)</c> produces. Pure data
/// (no WinUI types) so the decode is unit-tested without a UI host.
/// </summary>
/// <param name="Manufacturer">The world-manufacturer-identifier match, or <c>null</c> when unknown.</param>
/// <param name="Model">The model-code match, or <c>null</c> when unknown.</param>
/// <param name="Drive">The drive-unit match, or <c>null</c> when unknown.</param>
/// <param name="Year">The model-year match, or <c>null</c> when unknown.</param>
/// <param name="Plant">The assembly-plant match, or <c>null</c> when unknown.</param>
/// <param name="Serial">The serial tail (web <c>upper.slice(11)</c>); always present, possibly empty.</param>
public sealed record VinDecodeResult(
    string? Manufacturer,
    string? Model,
    string? Drive,
    string? Year,
    string? Plant,
    string Serial);

/// <summary>
/// One projected, render-ready segment cell — the native analogue of one tile in the web tool's decoded grid
/// (web/src/features/admin/components/devtools/tools/VinDecoder.tsx): a localized segment label over the
/// decoded value. Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Label">The localized segment label (web <c>t(`devtools.utils.vin_${k}`)</c>).</param>
/// <param name="Value">The decoded value, or the localized "Unknown" for an unmatched lookup segment.</param>
public sealed record VinDecoderCell(string Label, string Value);

/// <summary>
/// The static VIN reference tables — a verbatim native port of the web decoder maps
/// (web/src/features/admin/components/devtools/constants.ts: <c>VIN_MANUFACTURERS</c>, <c>VIN_MODELS</c>,
/// <c>VIN_DRIVE</c>, <c>VIN_YEAR</c>, <c>VIN_PLANT</c>). The decoded values are the web's own literal English
/// strings (Tesla does not translate them — only the field labels and the "Unknown" fallback are localized),
/// so they live as constants here. Keys are upper-case because the decoder upper-cases the VIN before lookup,
/// matching the web <c>upper = vin.toUpperCase()</c>.
/// </summary>
public static class VinDictionaries
{
    /// <summary>World-manufacturer-identifier (first three VIN characters) → maker (web <c>VIN_MANUFACTURERS</c>).</summary>
    public static IReadOnlyDictionary<string, string> Manufacturers { get; } =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["5YJ"] = "Tesla (USA)",
            ["LRW"] = "Tesla (China)",
            ["7SA"] = "Tesla (EU/Berlin)",
            ["XP7"] = "Tesla (USA)",
        };

    /// <summary>Model code (VIN character 4) → model name (web <c>VIN_MODELS</c>).</summary>
    public static IReadOnlyDictionary<string, string> Models { get; } =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["S"] = "Model S",
            ["3"] = "Model 3",
            ["X"] = "Model X",
            ["Y"] = "Model Y",
        };

    /// <summary>Drive unit (VIN character 8) → drivetrain (web <c>VIN_DRIVE</c>).</summary>
    public static IReadOnlyDictionary<string, string> Drive { get; } =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["1"] = "Single Motor RWD",
            ["2"] = "Dual Motor AWD",
            ["3"] = "Performance AWD",
            ["4"] = "Single Motor RWD (LFP)",
            ["A"] = "Dual Motor AWD",
            ["B"] = "Dual Motor AWD",
            ["F"] = "Performance AWD",
            ["P"] = "Performance",
            ["E"] = "Dual Motor",
            ["N"] = "Dual Motor",
        };

    /// <summary>Model year (VIN character 10) → calendar year (web <c>VIN_YEAR</c>).</summary>
    public static IReadOnlyDictionary<string, string> Year { get; } =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["H"] = "2017",
            ["J"] = "2018",
            ["K"] = "2019",
            ["L"] = "2020",
            ["M"] = "2021",
            ["N"] = "2022",
            ["P"] = "2023",
            ["R"] = "2024",
            ["S"] = "2025",
            ["T"] = "2026",
        };

    /// <summary>Assembly plant (VIN character 11) → factory (web <c>VIN_PLANT</c>).</summary>
    public static IReadOnlyDictionary<string, string> Plant { get; } =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["F"] = "Fremont, CA",
            ["A"] = "Austin, TX",
            ["B"] = "Berlin, Germany",
            ["C"] = "Shanghai, China",
            ["G"] = "Gigafactory",
            ["E"] = "Palo Alto, CA",
        };
}

/// <summary>
/// Pure VIN decoding — the native port of the web tool's <c>decoded</c> memo
/// (web/src/features/admin/components/devtools/tools/VinDecoder.tsx). Kept UI-free and localizer-free so the
/// algorithm is verified character-for-character against the web behaviour without a XAML host: the web
/// returns <c>null</c> below the eleven-character threshold, upper-cases the VIN, indexes fixed positions into
/// the five reference tables, and takes the remainder as the serial. The JavaScript semantics the web relies
/// on are reproduced exactly — <c>slice</c> clamps to the available length, out-of-range index access yields
/// an empty key, and an unmatched lookup yields <c>null</c> (the web <c>?? t('Unknown')</c> substitution is
/// applied later, at the display boundary, so the pure decode stays locale-independent).
/// </summary>
public static class VinDecoding
{
    /// <summary>The minimum VIN length the web tool requires before it decodes (web <c>vin.length &lt; 11</c>).</summary>
    public const int MinLength = 11;

    /// <summary>
    /// Decode <paramref name="vin"/> into its segments, or return <c>null</c> when the VIN is shorter than
    /// <see cref="MinLength"/> (the web <c>if (vin.length &lt; 11) return null</c>). The VIN is not trimmed —
    /// length is measured exactly as typed, matching the web's raw <c>vin.length</c> check — and is
    /// upper-cased before every table lookup (web <c>upper = vin.toUpperCase()</c>).
    /// </summary>
    /// <param name="vin">The raw VIN text the user typed (with or without surrounding whitespace).</param>
    public static VinDecodeResult? Decode(string? vin)
    {
        if (vin is null || vin.Length < MinLength)
        {
            return null;
        }

        string upper = vin.ToUpperInvariant();

        string? manufacturer = Lookup(VinDictionaries.Manufacturers, Slice(upper, 0, 3));
        string? model = Lookup(VinDictionaries.Models, CharAt(upper, 3));
        string? drive = Lookup(VinDictionaries.Drive, CharAt(upper, 7));
        string? year = Lookup(VinDictionaries.Year, CharAt(upper, 9));
        string? plant = Lookup(VinDictionaries.Plant, CharAt(upper, 10));
        string serial = upper.Length > 11 ? upper[11..] : string.Empty;

        return new VinDecodeResult(manufacturer, model, drive, year, plant, serial);
    }

    private static string? Lookup(IReadOnlyDictionary<string, string> table, string key) =>
        table.TryGetValue(key, out string? value) ? value : null;

    // JavaScript String.prototype.slice(start, end) clamps to the available length rather than throwing.
    private static string Slice(string text, int start, int end)
    {
        if (start >= text.Length)
        {
            return string.Empty;
        }

        int stop = Math.Min(end, text.Length);
        return text[start..stop];
    }

    // JavaScript string index access returns undefined past the end; the web coalesces that to '' (upper[i] ?? '').
    private static string CharAt(string text, int index) =>
        index >= 0 && index < text.Length ? text[index].ToString(CultureInfo.InvariantCulture) : string.Empty;
}

/// <summary>
/// The ordered field descriptors for the decoded grid — the native anchor for the web tool's
/// <c>Object.entries(decoded).map(([k, v]) =&gt; ...)</c> render
/// (web/src/features/admin/components/devtools/tools/VinDecoder.tsx). Each descriptor pairs the web i18n key
/// (<c>devtools.utils.vin_${k}</c>) and its English fallback with the segment selector, in the web's insertion
/// order (manufacturer, model, drive, year, plant, serial). Headless so the catalog is asserted in unit tests.
/// </summary>
/// <param name="LabelKey">The web i18n key for the field label (<c>devtools.utils.vin_*</c>).</param>
/// <param name="LabelFallback">The English fallback the localizer returns when the key is unresolved.</param>
/// <param name="Selector">Selects this field's value from a decode result (<c>null</c> ⇒ localized "Unknown").</param>
public sealed record VinDecoderField(
    string LabelKey,
    string LabelFallback,
    Func<VinDecodeResult, string?> Selector)
{
    /// <summary>The six fields, in the web's <c>Object.entries</c> order.</summary>
    public static IReadOnlyList<VinDecoderField> All { get; } = new[]
    {
        new VinDecoderField("devtools.utils.vin_mfr", "Manufacturer", static r => r.Manufacturer),
        new VinDecoderField("devtools.utils.vin_model", "Model", static r => r.Model),
        new VinDecoderField("devtools.utils.vin_drive", "Drive", static r => r.Drive),
        new VinDecoderField("devtools.utils.vin_year", "Year", static r => r.Year),
        new VinDecoderField("devtools.utils.vin_plant", "Plant", static r => r.Plant),
        new VinDecoderField("devtools.utils.vin_serial", "Serial", static r => r.Serial),
    };
}

/// <summary>
/// Canonical registry metadata for the VinDecoder surface — the native anchor for the web tool at
/// web/src/features/admin/components/devtools/tools/VinDecoder.tsx. The diagnostics <see cref="Slug"/> is the
/// stable surface identifier emitted with the <c>view.opened</c> event (P1/S11 diagnostics contract).
/// <see cref="Glyph"/> is the Segoe Fluent code point standing in for the web Lucide <c>Car</c> icon and
/// <see cref="Accent"/> is the web <c>color="cyan"</c> passed to the card; <see cref="AccentBrushKey"/> defers
/// to the shared <see cref="ToolCardAccent"/> resolver the card itself uses, so the registry and the rendered
/// badge can never disagree. <see cref="SampleVin"/> is the web field's sample VIN, reused as the field hint.
/// </summary>
public static class VinDecoderRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "VinDecoder";

    /// <summary>Segoe Fluent header glyph — Car (web Lucide <c>Car</c>); matches the client-utilities catalog.</summary>
    public const string Glyph = "\uE804";

    /// <summary>The web card accent name (<c>color="cyan"</c>) resolved through the shared accent map.</summary>
    public const string Accent = "cyan";

    /// <summary>The web field's sample VIN (<c>5YJ3E1EA1NF000001</c>), reused as the field's sample hint.</summary>
    public const string SampleVin = "5YJ3E1EA1NF000001";

    /// <summary>The theme-aware token brush key backing the accent (resolved via <see cref="ToolCardAccent"/>).</summary>
    public static string AccentBrushKey => ToolCardAccent.BrushKey(Accent);
}

/// <summary>
/// PII-safe diagnostics for the VinDecoder surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never the VIN the operator typed or any
/// decoded segment — so a diagnostics line can never leak user input or vehicle identity. Thread-safe.
/// </summary>
public sealed class VinDecoderDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional operational-only line sink (no user data is ever passed).</param>
    public VinDecoderDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=VinDecoder</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={VinDecoderRegistration.Slug}");
    }
}
