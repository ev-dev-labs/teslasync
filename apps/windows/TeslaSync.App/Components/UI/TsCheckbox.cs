using Microsoft.UI.Xaml.Controls;

namespace TeslaSync.App.Components.UI;

/// <summary>
/// Tokenized check box (mirrors the web <c>Checkbox</c>). Inherits the WinUI
/// <see cref="CheckBox"/> tri-state, keyboard and Narrator behaviour; exists as
/// a distinct type so pages consume the TeslaSync component vocabulary and pick
/// up future tokenized styling centrally.
/// </summary>
public partial class TsCheckbox : CheckBox
{
}
