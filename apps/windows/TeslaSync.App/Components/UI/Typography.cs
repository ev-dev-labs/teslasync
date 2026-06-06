using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Windows.UI.Text;

namespace TeslaSync.App.Components.UI;

/// <summary>Shared token lookups for the typography primitives.</summary>
internal static class TypographyTokens
{
    public static double Size(string key, double fallback) =>
        Application.Current.Resources.TryGetValue(key, out var v) && v is double d ? d : fallback;

    public static FontWeight Weight(double value) => new() { Weight = (ushort)value };

    public static Brush? Brush(string key) =>
        Application.Current.Resources.TryGetValue(key, out var v) && v is Brush b ? b : null;

    public static FontFamily? Sans =>
        Application.Current.Resources.TryGetValue("TsTypeFontFamilySans", out var v) && v is FontFamily f ? f : null;

    public static FontFamily? Mono =>
        Application.Current.Resources.TryGetValue("TsTypeFontFamilyMono", out var v) && v is FontFamily f ? f : null;
}

/// <summary>
/// Base for the tokenized typography roles. Hosts a wrapping
/// <see cref="TextBlock"/> (which is sealed in WinUI and cannot be subclassed)
/// and exposes its text via <see cref="Value"/>. Derived roles set the
/// token-driven font metrics in their constructor.
/// </summary>
public abstract partial class TsTypography : ContentControl
{
    private readonly TextBlock _text = new() { TextWrapping = TextWrapping.Wrap };

    public static readonly DependencyProperty ValueProperty = DependencyProperty.Register(
        nameof(Value), typeof(string), typeof(TsTypography),
        new PropertyMetadata(string.Empty, OnValueChanged));

    protected TsTypography()
    {
        Content = _text;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        IsTabStop = false;
    }

    /// <summary>The displayed text (consumer-supplied, localized).</summary>
    public string Value
    {
        get => (string)GetValue(ValueProperty);
        set => SetValue(ValueProperty, value);
    }

    private protected TextBlock TextBlock => _text;

    /// <summary>Applies font metrics to the hosted text block.</summary>
    protected void Configure(double fontSize, double fontWeight, FontFamily? family = null, Brush? foreground = null)
    {
        _text.FontFamily = family ?? TypographyTokens.Sans;
        _text.FontSize = fontSize;
        _text.FontWeight = TypographyTokens.Weight(fontWeight);
        if (foreground is not null)
        {
            _text.Foreground = foreground;
        }
    }

    private static void OnValueChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var typography = (TsTypography)d;
        typography._text.Text = (string)e.NewValue;
    }
}

/// <summary>Largest page-level heading (mirrors web <c>PageTitle</c>).</summary>
public partial class PageTitle : TsTypography
{
    public PageTitle() => Configure(
        TypographyTokens.Size("TsTypeDisplayFontSize", 30),
        TypographyTokens.Size("TsTypeDisplayFontWeight", 700));
}

/// <summary>Section heading (mirrors web <c>Heading</c>).</summary>
public partial class Heading : TsTypography
{
    public Heading() => Configure(
        TypographyTokens.Size("TsTypeTitleFontSize", 24),
        TypographyTokens.Size("TsTypeTitleFontWeight", 700));
}

/// <summary>Section title above a group of panels (mirrors web <c>SectionTitle</c>).</summary>
public partial class SectionTitle : TsTypography
{
    public SectionTitle() => Configure(
        TypographyTokens.Size("TsTypeSectionFontSize", 18),
        TypographyTokens.Size("TsTypeSectionFontWeight", 600));
}

/// <summary>Title inside a panel/card header (mirrors web <c>PanelTitle</c>).</summary>
public partial class PanelTitle : TsTypography
{
    public PanelTitle() => Configure(
        TypographyTokens.Size("TsTypePanelFontSize", 16),
        TypographyTokens.Size("TsTypePanelFontWeight", 600));
}

/// <summary>Secondary sub-head (mirrors web <c>Subhead</c>).</summary>
public partial class Subhead : TsTypography
{
    public Subhead() => Configure(
        TypographyTokens.Size("TsTypePanelFontSize", 16),
        TypographyTokens.Size("TsTypeWeightMedium", 500),
        foreground: TypographyTokens.Brush("TsColorTextSecondaryBrush"));
}

/// <summary>Default body text (mirrors web <c>Text</c>).</summary>
public partial class Text : TsTypography
{
    public Text() => Configure(
        TypographyTokens.Size("TsTypeBodyFontSize", 14),
        TypographyTokens.Size("TsTypeBodyFontWeight", 400));
}

/// <summary>Small muted caption (mirrors web <c>Caption</c>).</summary>
public partial class Caption : TsTypography
{
    public Caption() => Configure(
        TypographyTokens.Size("TsTypeCaptionFontSize", 12),
        TypographyTokens.Size("TsTypeCaptionFontWeight", 400),
        foreground: TypographyTokens.Brush("TsColorTextMutedBrush"));
}

/// <summary>Form helper text under an input (mirrors web <c>HelperText</c>).</summary>
public partial class HelperText : TsTypography
{
    public HelperText() => Configure(
        TypographyTokens.Size("TsTypeBodySmFontSize", 12),
        TypographyTokens.Size("TsTypeBodyFontWeight", 400),
        foreground: TypographyTokens.Brush("TsColorTextMutedBrush"));
}

/// <summary>Validation error text (mirrors web <c>ErrorText</c>).</summary>
public partial class ErrorText : TsTypography
{
    public ErrorText() => Configure(
        TypographyTokens.Size("TsTypeBodySmFontSize", 12),
        TypographyTokens.Size("TsTypeBodyFontWeight", 400),
        foreground: TypographyTokens.Brush("TsColorDangerBrush"));
}

/// <summary>Uppercase field label (mirrors web <c>Label</c>).</summary>
public partial class Label : TsTypography
{
    public Label()
    {
        Configure(
            TypographyTokens.Size("TsTypeLabelFontSize", 12),
            TypographyTokens.Size("TsTypeLabelFontWeight", 500),
            foreground: TypographyTokens.Brush("TsColorTextSecondaryBrush"));
        TextBlock.CharacterSpacing = 60;
    }
}

/// <summary>Large numeric metric value (mirrors web <c>MetricValue</c>).</summary>
public partial class MetricValue : TsTypography
{
    public MetricValue() => Configure(
        TypographyTokens.Size("TsTypeTitleFontSize", 24),
        TypographyTokens.Size("TsTypeWeightBold", 700));
}

/// <summary>Caption beneath a metric value (mirrors web <c>MetricLabel</c>).</summary>
public partial class MetricLabel : TsTypography
{
    public MetricLabel() => Configure(
        TypographyTokens.Size("TsTypeCaptionFontSize", 12),
        TypographyTokens.Size("TsTypeCaptionFontWeight", 400),
        foreground: TypographyTokens.Brush("TsColorTextMutedBrush"));
}

/// <summary>Inline monospace code text (mirrors web <c>Code</c>).</summary>
public partial class Code : TsTypography
{
    public Code()
    {
        Configure(
            TypographyTokens.Size("TsTypeBodySmFontSize", 12),
            TypographyTokens.Size("TsTypeBodyFontWeight", 400),
            family: TypographyTokens.Mono);
        TextBlock.IsTextSelectionEnabled = true;
    }
}
