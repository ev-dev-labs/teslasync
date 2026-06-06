using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace TeslaSync.App.Components.UI;

/// <summary>
/// Tokenized drop-down selector (mirrors the web <c>Select</c>). Wraps the
/// WinUI <see cref="ComboBox"/> and exposes a <see cref="Hint"/> shown when no
/// item is chosen, keeping full keyboard and Narrator support.
/// </summary>
public partial class TsSelect : ComboBox
{
    public static readonly DependencyProperty HintProperty = DependencyProperty.Register(
        nameof(Hint), typeof(string), typeof(TsSelect),
        new PropertyMetadata(null, OnHintChanged));

    public TsSelect()
    {
        if (Application.Current.Resources.TryGetValue("TsSelectStyle", out var style) && style is Style s)
        {
            Style = s;
        }
    }

    /// <summary>Localized prompt shown when no item is selected.</summary>
    public string? Hint
    {
        get => (string?)GetValue(HintProperty);
        set => SetValue(HintProperty, value);
    }

    private static void OnHintChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var select = (TsSelect)d;
        select.PlaceholderText = select.Hint ?? string.Empty; // parity:allow PlaceholderText is the WinUI prompt API
    }
}
