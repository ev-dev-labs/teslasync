using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace TeslaSync.App.Components.UI;

/// <summary>
/// Tokenized multi-line text field (mirrors the web <c>Textarea</c>). Wraps
/// WinUI <see cref="TextBox"/> configured for wrapping multi-line entry with an
/// optional <see cref="Hint"/> and a configurable minimum row height.
/// </summary>
public partial class TsTextarea : TextBox
{
    public static readonly DependencyProperty HintProperty = DependencyProperty.Register(
        nameof(Hint), typeof(string), typeof(TsTextarea),
        new PropertyMetadata(null, OnHintChanged));

    public TsTextarea()
    {
        if (Application.Current.Resources.TryGetValue("TsTextareaStyle", out var style) && style is Style s)
        {
            Style = s;
        }

        AcceptsReturn = true;
        TextWrapping = TextWrapping.Wrap;
    }

    /// <summary>Localized hint text shown when the field is empty.</summary>
    public string? Hint
    {
        get => (string?)GetValue(HintProperty);
        set => SetValue(HintProperty, value);
    }

    private static void OnHintChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var area = (TsTextarea)d;
        area.PlaceholderText = area.Hint ?? string.Empty; // parity:allow PlaceholderText is the WinUI hint API
    }
}
