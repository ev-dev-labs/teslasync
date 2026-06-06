using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace TeslaSync.App.Components.UI;

/// <summary>
/// Tokenized disclosure section (mirrors the web <c>Accordion</c>). Subclasses
/// the WinUI <see cref="Expander"/> so it inherits the expand/collapse
/// animation, keyboard toggling and Narrator expanded-state reporting, while
/// applying TeslaSync corner and surface tokens.
/// </summary>
public partial class TsAccordion : Expander
{
    public TsAccordion()
    {
        HorizontalAlignment = HorizontalAlignment.Stretch;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        if (Application.Current.Resources.TryGetValue("TsRadiusMd", out var radius) &&
            radius is CornerRadius corner)
        {
            CornerRadius = corner;
        }
    }
}
