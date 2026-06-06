using Microsoft.UI.Xaml.Controls;

namespace TeslaSync.App.Components.UI;

/// <summary>
/// Tokenized content card surface (mirrors the web <c>Card</c>). A solid Fluent
/// surface with tokenized corner, border and elevation. Compose with
/// <see cref="TsCardHeader"/> and <see cref="TsCardFooter"/> for the standard
/// header/body/footer layout.
/// </summary>
public partial class TsCard : ContentControl
{
    public TsCard()
    {
        DefaultStyleKey = typeof(TsCard);
        HorizontalContentAlignment = Microsoft.UI.Xaml.HorizontalAlignment.Stretch;
        IsTabStop = false;
    }
}
