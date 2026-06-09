using System.ComponentModel;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="JsonFormatter"/> view — the native port of the
/// web <c>JsonFormatterTool</c> hook composition
/// (web/src/features/admin/components/devtools/tools/JsonFormatter.tsx). It holds the current editor value
/// (web <c>inputVal</c>), projects it through <see cref="JsonFormatterProjection"/> into the render-ready
/// <see cref="Display"/> on every change (the web <c>useMemo</c> recompute), and resolves every owned label —
/// the card title and description, the editor label, the formatted-block label, and the copy affordance —
/// through the i18n facade (web <c>t(...)</c>). The transform is synchronous, so there is no asynchronous load;
/// <see cref="SetText(string?)"/> re-projects for a new editor value (the web <c>onChange</c>) and
/// <see cref="Refresh"/> re-pulls the seed seam. Drive it from one confinement (the UI thread); it is not
/// internally synchronised.
/// </summary>
public sealed class JsonFormatterViewModel : INotifyPropertyChanged
{
    private readonly IJsonFormatterSource _source;
    private readonly ILocalizer _localizer;

    private JsonFormatterInput _input;
    private JsonFormatterDisplay _display;

    /// <summary>Creates the holder over its seed seam and the i18n facade.</summary>
    /// <param name="source">The seed seam (the initial editor value).</param>
    /// <param name="localizer">The i18n facade resolving every owned label.</param>
    public JsonFormatterViewModel(IJsonFormatterSource source, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _source = source;
        _localizer = localizer;
        _input = source.GetInput();
        _display = JsonFormatterProjection.Project(_input, localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The projected, render-ready display for the current editor value.</summary>
    public JsonFormatterDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(State));
        }
    }

    /// <summary>The current mutually-exclusive surface state.</summary>
    public JsonFormatterState State => _display.State;

    /// <summary>The current editor value (so the view can seed the editor from the seam).</summary>
    public string Text => _input.Text;

    /// <summary>Localized card title (web <c>t('Json Formatter')</c>).</summary>
    public string Title => _localizer.GetString("Json Formatter", "Json Formatter");

    /// <summary>Localized card description (web <c>t('Json Formatter Desc')</c>).</summary>
    public string Description => _localizer.GetString("Json Formatter Desc", "Json Formatter Desc");

    /// <summary>Localized editor label (web <c>t('Json Input')</c>).</summary>
    public string InputLabel => _localizer.GetString("Json Input", "Json Input");

    /// <summary>Localized formatted-block label (web <c>t('Formatted')</c>).</summary>
    public string FormattedLabel => _localizer.GetString("Formatted", "Formatted");

    /// <summary>Localized copy affordance idle label (web shared <c>CopyButton</c>).</summary>
    public string CopyLabel => _localizer.GetString("common.copyButton.copy", "Copy");

    /// <summary>Localized copy affordance confirmation label (web shared <c>CopyButton</c>).</summary>
    public string CopiedLabel => _localizer.GetString("common.copyButton.copied", "Copied");

    /// <summary>Re-project for a new editor value (the web <c>onChange</c> → <c>setInputVal</c> → <c>useMemo</c>).</summary>
    /// <param name="text">The new editor value (coalesced to empty when null).</param>
    public void SetText(string? text)
    {
        _input = JsonFormatterInput.From(text);
        Display = JsonFormatterProjection.Project(_input, _localizer);
    }

    /// <summary>Re-pull the seed from the seam and re-project (e.g. after the host swaps the seeded value).</summary>
    public void Refresh()
    {
        _input = _source.GetInput();
        Display = JsonFormatterProjection.Project(_input, _localizer);
    }

    private void Raise(string name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
