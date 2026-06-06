using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;

namespace TeslaSync.App.Components.DataDisplay;

/// <summary>
/// Small code-built visual primitives shared by the data-display controls (status
/// dots, captions, value text, pill surfaces). Keeps each control's
/// <c>BuildTree</c> terse while staying fully tokenized.
/// </summary>
internal static class DisplayPrimitives
{
    /// <summary>A circular status dot of the given diameter, filled with <paramref name="fill"/>.</summary>
    public static Ellipse Dot(Brush fill, double size = 8)
        => new() { Width = size, Height = size, Fill = fill, VerticalAlignment = VerticalAlignment.Center };

    /// <summary>A caption-weight text block (muted, small) for labels.</summary>
    public static TextBlock Caption(string text = "")
        => new()
        {
            Text = text,
            FontSize = 12,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        };

    /// <summary>A secondary-weight label text block.</summary>
    public static TextBlock Label(string text = "")
        => new()
        {
            Text = text,
            FontSize = 13,
            Foreground = DisplayTokens.TextSecondary,
            VerticalAlignment = VerticalAlignment.Center,
        };

    /// <summary>A primary value text block (larger, primary colour).</summary>
    public static TextBlock Value(string text = "", double fontSize = 20)
        => new()
        {
            Text = text,
            FontSize = fontSize,
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
        };

    /// <summary>A rounded pill surface hosting <paramref name="child"/>, tinted by tokens.</summary>
    public static Border Pill(UIElement child, Brush? border = null)
        => new()
        {
            Child = child,
            CornerRadius = DisplayTokens.Radius("TsRadiusPill", 999),
            BorderBrush = border ?? DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            Padding = new Thickness(8, 2, 8, 2),
            Background = DisplayTokens.Surface,
        };

    /// <summary>A horizontal stack with the given spacing and centred items.</summary>
    public static StackPanel Row(double spacing = 6)
        => new()
        {
            Orientation = Orientation.Horizontal,
            Spacing = spacing,
            VerticalAlignment = VerticalAlignment.Center,
        };

    /// <summary>A vertical stack with the given spacing.</summary>
    public static StackPanel Column(double spacing = 4)
        => new() { Orientation = Orientation.Vertical, Spacing = spacing };

    /// <summary>A tokenized card surface hosting <paramref name="child"/>.</summary>
    public static Border Card(UIElement child)
        => new()
        {
            Child = child,
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            Background = DisplayTokens.Surface,
            Padding = new Thickness(16),
        };

    /// <summary>
    /// Parse a "#RRGGBB" / "#AARRGGBB" hex string from a deterministic data palette
    /// (e.g. the Okabe-Ito avatar palette or the A–F score palette) into a brush.
    /// These palettes are semantic data attributes shared with the web, not ad-hoc
    /// theme colours — theming still flows through the token brushes. Falls back to
    /// the muted text brush for unparseable input.
    /// </summary>
    public static Brush HexBrush(string hex)
    {
        if (TryParseHex(hex, out Windows.UI.Color color))
        {
            return new SolidColorBrush(color);
        }

        return DisplayTokens.TextMuted;
    }

    private static bool TryParseHex(string? hex, out Windows.UI.Color color)
    {
        color = Microsoft.UI.Colors.Transparent;
        if (string.IsNullOrWhiteSpace(hex))
        {
            return false;
        }

        string s = hex.Trim().TrimStart('#');
        if (s.Length == 6)
        {
            s = "FF" + s;
        }

        if (s.Length != 8 ||
            !byte.TryParse(s.AsSpan(0, 2), System.Globalization.NumberStyles.HexNumber, null, out byte a) ||
            !byte.TryParse(s.AsSpan(2, 2), System.Globalization.NumberStyles.HexNumber, null, out byte r) ||
            !byte.TryParse(s.AsSpan(4, 2), System.Globalization.NumberStyles.HexNumber, null, out byte g) ||
            !byte.TryParse(s.AsSpan(6, 2), System.Globalization.NumberStyles.HexNumber, null, out byte b))
        {
            return false;
        }

        color = Windows.UI.Color.FromArgb(a, r, g, b);
        return true;
    }
}
