using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace TeslaSync.App.Components.UI;

/// <summary>
/// Tokenized modal surface (mirrors the web <c>Modal</c>). Wraps the WinUI
/// <see cref="ContentDialog"/>, which already provides a focus trap, light
/// dismiss handling and — crucially — restores focus to the invoking element on
/// close. Consumers set <c>Title</c>, <c>Content</c> and the button text
/// (localized) and call <c>ShowAsync</c>.
/// </summary>
public partial class TsModal : ContentDialog
{
    public TsModal()
    {
        DefaultButton = ContentDialogButton.Primary;
        if (Application.Current.Resources.TryGetValue("TsRadiusLg", out var radius) &&
            radius is CornerRadius corner)
        {
            CornerRadius = corner;
        }
    }
}
