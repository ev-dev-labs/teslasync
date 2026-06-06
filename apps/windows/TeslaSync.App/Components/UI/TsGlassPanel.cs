using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

namespace TeslaSync.App.Components.UI;

/// <summary>Optional accent glow applied to a <see cref="TsGlassPanel"/> border.</summary>
public enum GlassGlow
{
    None,
    Cyan,
    Green,
    Purple,
}

/// <summary>
/// Tokenized translucent surface (mirrors the web <c>GlassPanel</c>). Maps to a
/// Fluent glass/acrylic-style card built from the W1 surface, border and corner
/// tokens, with an optional accent <see cref="Glow"/>. High-contrast safe: the
/// border uses the themed border token which the high-contrast dictionary makes
/// fully opaque.
/// </summary>
public partial class TsGlassPanel : ContentControl
{
    public static readonly DependencyProperty GlowProperty = DependencyProperty.Register(
        nameof(Glow), typeof(GlassGlow), typeof(TsGlassPanel),
        new PropertyMetadata(GlassGlow.None, OnGlowChanged));

    public TsGlassPanel()
    {
        DefaultStyleKey = typeof(TsGlassPanel);
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        IsTabStop = false;
    }

    /// <summary>Accent glow applied to the panel border.</summary>
    public GlassGlow Glow
    {
        get => (GlassGlow)GetValue(GlowProperty);
        set => SetValue(GlowProperty, value);
    }

    private static void OnGlowChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var panel = (TsGlassPanel)d;
        var key = panel.Glow switch
        {
            GlassGlow.Cyan => "TsChartSpeedBrush",
            GlassGlow.Green => "TsChartBatteryBrush",
            GlassGlow.Purple => "TsChartPowerBrush",
            _ => "TsColorBorderBrush",
        };

        if (Application.Current.Resources.TryGetValue(key, out var brush) && brush is Brush b)
        {
            panel.BorderBrush = b;
        }
    }
}
