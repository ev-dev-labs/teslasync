using Microsoft.UI.Xaml;

namespace TeslaSync.App.Components.UI;

/// <summary>
/// Tokenized print button (mirrors the web <c>PrintButton</c>). Carries the
/// print glyph and raises <see cref="PrintRequested"/> on click; the host page
/// owns the actual print job (page content is page-specific).
/// </summary>
public partial class TsPrintButton : TsButton
{
    public TsPrintButton()
    {
        Variant = Core.ButtonVariant.Subtle;
        IconGlyph = "\uE749";
        Click += (s, e) => PrintRequested?.Invoke(this, EventArgs.Empty);
    }

    /// <summary>Raised when the user asks to print.</summary>
    public event EventHandler? PrintRequested;
}
