using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;

namespace TeslaSync.App.Components.UI;

/// <summary>
/// Tokenized tooltip wrapper (mirrors the web <c>Tooltip</c>). Wraps consumer
/// <c>Content</c> and attaches a WinUI <see cref="ToolTip"/> carrying the
/// localized <see cref="Hint"/>, which is surfaced to Narrator.
/// </summary>
public partial class TsTooltip : ContentControl
{
    public static readonly DependencyProperty HintProperty = DependencyProperty.Register(
        nameof(Hint), typeof(string), typeof(TsTooltip),
        new PropertyMetadata(null, OnHintChanged));

    public TsTooltip()
    {
        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
    }

    /// <summary>Localized tooltip text.</summary>
    public string? Hint
    {
        get => (string?)GetValue(HintProperty);
        set => SetValue(HintProperty, value);
    }

    private static void OnHintChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var control = (TsTooltip)d;
        var hint = control.Hint;
        if (string.IsNullOrEmpty(hint))
        {
            ToolTipService.SetToolTip(control, null);
        }
        else
        {
            ToolTipService.SetToolTip(control, new ToolTip { Content = hint });
            AutomationProperties.SetHelpText(control, hint);
        }
    }
}
