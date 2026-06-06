using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;

namespace TeslaSync.App.Components.UI;

/// <summary>
/// Tokenized inline help affordance (mirrors the web <c>HelpTooltip</c>). Shows
/// a small "?" glyph that reveals a localized <see cref="Hint"/> on hover/focus
/// and exposes it to Narrator as help text.
/// </summary>
public partial class TsHelpTooltip : ContentControl
{
    private readonly FontIcon _glyph = new() { Glyph = "\uE897", FontSize = 14 };

    public static readonly DependencyProperty HintProperty = DependencyProperty.Register(
        nameof(Hint), typeof(string), typeof(TsHelpTooltip),
        new PropertyMetadata(null, OnHintChanged));

    public TsHelpTooltip()
    {
        Content = _glyph;
        IsTabStop = true;
        UseSystemFocusVisuals = true;
    }

    /// <summary>Localized help text shown in the tooltip.</summary>
    public string? Hint
    {
        get => (string?)GetValue(HintProperty);
        set => SetValue(HintProperty, value);
    }

    private static void OnHintChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var control = (TsHelpTooltip)d;
        var hint = control.Hint;
        if (string.IsNullOrEmpty(hint))
        {
            ToolTipService.SetToolTip(control, null);
        }
        else
        {
            ToolTipService.SetToolTip(control, new ToolTip { Content = hint });
            AutomationProperties.SetName(control, hint);
        }
    }
}
