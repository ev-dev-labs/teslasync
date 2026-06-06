using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;

namespace TeslaSync.App.Components.Charts;

/// <summary>
/// Resolves <see cref="ChartPalette"/> resource keys into live WinUI brushes from
/// the merged design-token dictionaries, so every chart colour flows from the W1
/// brand palette / semantic status tokens and stays theme-aware. Falls back to the
/// muted text brush when a key is missing rather than throwing.
/// </summary>
internal static class ChartBrushes
{
    /// <summary>Resolves a design-token brush key to a live brush.</summary>
    public static Brush Resolve(string key)
    {
        if (Application.Current.Resources.TryGetValue(key, out var value) && value is Brush brush)
        {
            return brush;
        }

        return TypographyTokens.Brush("TsColorTextMutedBrush") ?? new SolidColorBrush();
    }

    /// <summary>Brush for a series via its palette index / semantic role.</summary>
    public static Brush ForSeries(ChartSeries series) => Resolve(ChartPalette.KeyForSeries(series));

    /// <summary>Brush for a categorical palette index (cycled across the eight).</summary>
    public static Brush ForIndex(int index) => Resolve(ChartPalette.KeyForIndex(index));

    /// <summary>Brush for a semantic status severity.</summary>
    public static Brush ForStatus(StatusKind status) => Resolve(ChartPalette.StatusKey(status));

    /// <summary>Themed primary text brush.</summary>
    public static Brush TextPrimary => Resolve("TsColorTextPrimaryBrush");

    /// <summary>Themed muted text brush (axes, gridlines, captions).</summary>
    public static Brush TextMuted => Resolve("TsColorTextMutedBrush");

    /// <summary>Themed hairline border brush.</summary>
    public static Brush Border => Resolve("TsColorBorderBrush");

    /// <summary>Themed surface brush for tooltip / overlay backgrounds.</summary>
    public static Brush Surface => Resolve("TsColorSurfaceBrush");
}
