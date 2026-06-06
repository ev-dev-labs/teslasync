namespace TeslaSync.App.Core.DataDisplay;

/// <summary>
/// Deterministic avatar helpers (port of the web <c>Avatar</c> primitive):
/// stable colour-index hashing and initials extraction. The palette is the
/// Okabe-Ito colour-blind-safe palette so colour-attribution stays
/// distinguishable for the three common CVD types.
/// </summary>
public static class AvatarLogic
{
    /// <summary>
    /// Okabe-Ito colour-blind-safe palette (Wong, Nature Methods 2011), mirrored
    /// from web <c>CHART_COLORS_CB_SAFE</c>. The hash index selects from here.
    /// </summary>
    public static IReadOnlyList<string> ColorPalette { get; } = new[]
    {
        "#0072B2", // blue
        "#E69F00", // orange
        "#009E73", // bluish green
        "#F0E442", // yellow
        "#56B4E9", // sky blue
        "#D55E00", // vermillion
        "#CC79A7", // reddish purple
        "#4B4B4B", // neutral grey
    };

    /// <summary>
    /// djb2 hash — small, deterministic, non-cryptographic. Matches the web
    /// implementation (hash * 33 XOR char, forced unsigned).
    /// </summary>
    public static uint Djb2(string input)
    {
        uint hash = 5381;
        foreach (char c in input)
        {
            hash = (hash * 33) ^ c;
        }

        return hash;
    }

    /// <summary>Pick a palette index from a stable seed (userId or name).</summary>
    public static int ColorIndex(string seed) => (int)(Djb2(seed) % (uint)ColorPalette.Count);

    /// <summary>Hex palette colour for a seed.</summary>
    public static string ColorFor(string seed) => ColorPalette[ColorIndex(seed)];

    /// <summary>
    /// Compute the visible initials for a name. Splits on whitespace and uses the
    /// first character of the first two words; single-word names take up to two
    /// characters. Empty / whitespace-only input returns "?" so the avatar never
    /// renders blank.
    /// </summary>
    public static string Initials(string? name)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            return "?";
        }

        string[] parts = name.Trim().Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length >= 2)
        {
            return (parts[0][..1] + parts[1][..1]).ToUpperInvariant();
        }

        string first = parts[0];
        return first[..Math.Min(2, first.Length)].ToUpperInvariant();
    }
}
