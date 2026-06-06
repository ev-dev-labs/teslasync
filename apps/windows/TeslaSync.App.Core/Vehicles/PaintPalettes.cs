namespace TeslaSync.App.Core.Vehicles;

/// <summary>Stable id for a Tesla paint palette (port of the web <c>PaintPaletteId</c>).</summary>
public enum PaintPaletteId
{
    /// <summary>Pearl White Multi-Coat.</summary>
    PearlWhite,

    /// <summary>Midnight Silver Metallic.</summary>
    MidnightSilver,

    /// <summary>Deep Blue Metallic.</summary>
    DeepBlue,

    /// <summary>Solid Black.</summary>
    SolidBlack,

    /// <summary>Red Multi-Coat.</summary>
    RedMulticoat,
}

/// <summary>
/// A Tesla paint palette for the digital twin (port of the web <c>PaintPalette</c>).
/// The body gradient stops + accents drive <c>TsVehicleTwin</c>'s tokenized body fill.
/// </summary>
/// <param name="Id">Stable palette id.</param>
/// <param name="DefaultLabel">Fallback English label for the picker.</param>
/// <param name="Swatch">Opaque hex for the picker dot.</param>
/// <param name="BodyTop">Brightest body gradient stop (top).</param>
/// <param name="BodyBottom">Darkest body gradient stop (bottom).</param>
/// <param name="Stroke">Body stroke / trim outline (hex/argb).</param>
/// <param name="Highlight">Bright top-edge highlight.</param>
/// <param name="IsDark">True when the body is dark enough to need brighter headlights.</param>
public sealed record PaintPalette(
    PaintPaletteId Id,
    string DefaultLabel,
    string Swatch,
    string BodyTop,
    string BodyBottom,
    string Stroke,
    string Highlight,
    bool IsDark);

/// <summary>
/// The five stock Tesla paints + inference rules (port of the web
/// <c>vehicleColors.ts</c>: <c>PAINT_PALETTES</c>, <c>inferPaintFromTesla</c>,
/// <c>FALLBACK_PAINT</c>). Pure + headless.
/// </summary>
public static class PaintPalettes
{
    /// <summary>Pearl White Multi-Coat.</summary>
    public static PaintPalette PearlWhite { get; } = new(
        PaintPaletteId.PearlWhite, "Pearl White Multi-Coat", "#E9ECF2",
        "#FFFFFF", "#475569", "#3A4659", "#FFFFFF", IsDark: false);

    /// <summary>Midnight Silver Metallic.</summary>
    public static PaintPalette MidnightSilver { get; } = new(
        PaintPaletteId.MidnightSilver, "Midnight Silver Metallic", "#5B6675",
        "#CBD5E1", "#0F172A", "#334155", "#FFFFFF", IsDark: false);

    /// <summary>Deep Blue Metallic.</summary>
    public static PaintPalette DeepBlue { get; } = new(
        PaintPaletteId.DeepBlue, "Deep Blue Metallic", "#1F3A72",
        "#60A5FA", "#0F172A", "#1D347C", "#BFDBFE", IsDark: false);

    /// <summary>Solid Black.</summary>
    public static PaintPalette SolidBlack { get; } = new(
        PaintPaletteId.SolidBlack, "Solid Black", "#0D1117",
        "#78869C", "#000000", "#94A3B8", "#E2E8F0", IsDark: true);

    /// <summary>Red Multi-Coat.</summary>
    public static PaintPalette RedMulticoat { get; } = new(
        PaintPaletteId.RedMulticoat, "Red Multi-Coat", "#A3001A",
        "#F87171", "#280505", "#7F1111", "#FFE4E4", IsDark: false);

    /// <summary>All palettes in picker display order.</summary>
    public static IReadOnlyList<PaintPalette> All { get; } =
    [
        PearlWhite, MidnightSilver, DeepBlue, SolidBlack, RedMulticoat,
    ];

    /// <summary>High-contrast default when no exterior color metadata exists.</summary>
    public static PaintPalette Fallback => PearlWhite;

    /// <summary>Look up a palette by its id.</summary>
    public static PaintPalette ById(PaintPaletteId id) => id switch
    {
        PaintPaletteId.MidnightSilver => MidnightSilver,
        PaintPaletteId.DeepBlue => DeepBlue,
        PaintPaletteId.SolidBlack => SolidBlack,
        PaintPaletteId.RedMulticoat => RedMulticoat,
        _ => PearlWhite,
    };

    /// <summary>
    /// Map a Tesla <c>exterior_color</c> code to a palette (port of
    /// <c>inferPaintFromTesla</c>): case-insensitive, ignores spaces/dashes/
    /// underscores, accepts the bare name and the Metallic / MultiCoat suffix
    /// variants. Unknown codes fall back to <see cref="Fallback"/>.
    /// </summary>
    public static PaintPalette InferFromTesla(string? code)
    {
        if (string.IsNullOrWhiteSpace(code))
        {
            return Fallback;
        }

        string n = new string([.. code.ToLowerInvariant().Where(ch => ch is not (' ' or '_' or '-'))]);

        if (n.StartsWith("pearl", StringComparison.Ordinal) || n == "white")
        {
            return PearlWhite;
        }

        if (n.StartsWith("midnightsilver", StringComparison.Ordinal) || n == "silver")
        {
            return MidnightSilver;
        }

        if (n.StartsWith("deepblue", StringComparison.Ordinal) || n == "blue" || n == "darkblue")
        {
            return DeepBlue;
        }

        if (n.StartsWith("solidblack", StringComparison.Ordinal) || n == "black" || n == "obsidianblack")
        {
            return SolidBlack;
        }

        if (n.StartsWith("red", StringComparison.Ordinal) || n == "multicoatred")
        {
            return RedMulticoat;
        }

        return Fallback;
    }
}
