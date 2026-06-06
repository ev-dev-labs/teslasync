using Microsoft.UI.Xaml.Controls;

namespace TeslaSync.App.Components.UI;

/// <summary>
/// Header region for a <see cref="TsCard"/> (mirrors the web <c>CardHeader</c>).
/// Provides the tokenized top padding and a bottom hairline separating it from
/// the card body.
/// </summary>
public partial class TsCardHeader : ContentControl
{
    public TsCardHeader()
    {
        DefaultStyleKey = typeof(TsCardHeader);
        HorizontalContentAlignment = Microsoft.UI.Xaml.HorizontalAlignment.Stretch;
        IsTabStop = false;
    }
}
