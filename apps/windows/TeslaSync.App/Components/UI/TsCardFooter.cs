using Microsoft.UI.Xaml.Controls;

namespace TeslaSync.App.Components.UI;

/// <summary>
/// Footer region for a <see cref="TsCard"/> (mirrors the web <c>CardFooter</c>).
/// Provides the tokenized bottom padding and a top hairline separating it from
/// the card body.
/// </summary>
public partial class TsCardFooter : ContentControl
{
    public TsCardFooter()
    {
        DefaultStyleKey = typeof(TsCardFooter);
        HorizontalContentAlignment = Microsoft.UI.Xaml.HorizontalAlignment.Stretch;
        IsTabStop = false;
    }
}
