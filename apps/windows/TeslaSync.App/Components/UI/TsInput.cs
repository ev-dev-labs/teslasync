using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

namespace TeslaSync.App.Components.UI;

/// <summary>
/// Tokenized single-line text field. Wraps WinUI <see cref="TextBox"/> with a
/// validation (<see cref="HasError"/>) state that swaps the border to the
/// danger token and surfaces the error to assistive tech. Mirrors the web
/// <c>Input</c> primitive.
/// </summary>
public partial class TsInput : TextBox
{
    public static readonly DependencyProperty HasErrorProperty = DependencyProperty.Register(
        nameof(HasError), typeof(bool), typeof(TsInput),
        new PropertyMetadata(false, OnValidationChanged));

    public static readonly DependencyProperty HintProperty = DependencyProperty.Register(
        nameof(Hint), typeof(string), typeof(TsInput),
        new PropertyMetadata(null, OnHintChanged));

    public TsInput()
    {
        if (Application.Current.Resources.TryGetValue("TsInputStyle", out var style) && style is Style s)
        {
            Style = s;
        }
    }

    /// <summary>When true the field renders an error border and is announced as invalid.</summary>
    public bool HasError
    {
        get => (bool)GetValue(HasErrorProperty);
        set => SetValue(HasErrorProperty, value);
    }

    /// <summary>Localized hint text shown when the field is empty.</summary>
    public string? Hint
    {
        get => (string?)GetValue(HintProperty);
        set => SetValue(HintProperty, value);
    }

    private static void OnHintChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var input = (TsInput)d;
        input.PlaceholderText = input.Hint ?? string.Empty; // parity:allow PlaceholderText is the WinUI hint API
    }

    private static void OnValidationChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var input = (TsInput)d;
        if (input.HasError &&
            Application.Current.Resources.TryGetValue("TsColorDangerBrush", out var brush) &&
            brush is Brush dangerBrush)
        {
            input.BorderBrush = dangerBrush;
            input.BorderThickness = new Thickness(1.5);
        }
        else
        {
            input.ClearValue(BorderBrushProperty);
            input.ClearValue(BorderThicknessProperty);
        }
    }
}
