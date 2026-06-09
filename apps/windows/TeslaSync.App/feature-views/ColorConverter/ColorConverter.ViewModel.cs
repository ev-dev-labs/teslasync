using System.ComponentModel;
using System.Globalization;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="ColorConverter"/> view — the native port of the
/// web <c>ColorConverterTool</c>'s hook composition
/// (web/src/features/admin/components/devtools/tools/ColorConverter.tsx). It owns the <see cref="Hex"/> text
/// (the web <c>useState('#3b82f6')</c>), reprojects it through <see cref="ColorConverterProjection"/> on
/// every change (the web <c>parsed = useMemo(...)</c>), and exposes the resulting <see cref="Display"/> plus
/// the mutually-exclusive <see cref="State"/> so the view is a thin renderer. Every one of the component's
/// own labels (web <c>t('Color Converter')</c>, <c>t('Color Converter Desc')</c>, <c>t('Hex Color')</c> and
/// the shared <c>CopyButton</c> labels) resolves through the i18n facade; the result is synchronous and
/// cannot fault, so there is no asynchronous machinery. Drive it from one confinement (the UI thread); it is
/// not internally synchronised.
/// </summary>
public sealed class ColorConverterViewModel : INotifyPropertyChanged
{
    private readonly ILocalizer _localizer;

    private string _hex;
    private ColorConverterDisplay _display;
    private string? _lastAnnouncement;

    /// <summary>Creates the holder over its localizer, seeding the web tool's initial hex.</summary>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    public ColorConverterViewModel(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        _localizer = localizer;
        _hex = ColorConverterRegistration.DefaultHex;
        _display = ColorConverterProjection.Project(_hex);
        _lastAnnouncement = BuildAnnouncement(_display);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>
    /// The current hex text (the web <c>hex</c> state). Reassigning reprojects the colour and, when the
    /// result changes shape, flips <see cref="State"/> between the result grid and the empty surface.
    /// </summary>
    public string Hex
    {
        get => _hex;
        set
        {
            string next = value ?? string.Empty;
            if (string.Equals(_hex, next, StringComparison.Ordinal))
            {
                return;
            }

            _hex = next;
            Raise(nameof(Hex));
            Raise(nameof(SwatchName));
            Reproject();
        }
    }

    /// <summary>The projected, render-ready swatch + result cells for the current hex (web <c>parsed</c>).</summary>
    public ColorConverterDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(State));
            Raise(nameof(HasResult));
            Raise(nameof(Cells));
            Raise(nameof(Swatch));
        }
    }

    /// <summary>The current mutually-exclusive surface state (result grid vs friendly empty surface).</summary>
    public ColorConverterState State =>
        _display.HasResult ? ColorConverterState.Ready : ColorConverterState.Empty;

    /// <summary>True when the hex parsed to a colour and the result cells are shown (web <c>parsed != null</c>).</summary>
    public bool HasResult => _display.HasResult;

    /// <summary>The ordered RGB / HSL / HEX result cells for the current hex (empty when invalid).</summary>
    public IReadOnlyList<ColorConverterCell> Cells => _display.Cells;

    /// <summary>The parsed colour the view tints the preview swatch from, or <c>null</c> when the hex is invalid.</summary>
    public RgbColor? Swatch => _display.Swatch;

    /// <summary>The last result surfaced to the accessibility live region (the joined cell values, or the empty message).</summary>
    public string? LastAnnouncement
    {
        get => _lastAnnouncement;
        private set
        {
            if (string.Equals(_lastAnnouncement, value, StringComparison.Ordinal))
            {
                return;
            }

            _lastAnnouncement = value;
            Raise(nameof(LastAnnouncement));
        }
    }

    /// <summary>Localized card title (web <c>t('Color Converter')</c>).</summary>
    public string Title => _localizer.GetString("Color Converter", "Color Converter");

    /// <summary>Localized card description (web <c>t('Color Converter Desc')</c>).</summary>
    public string Description => _localizer.GetString("Color Converter Desc", "Color Converter Desc");

    /// <summary>Localized hex field label (web <c>t('Hex Color')</c>).</summary>
    public string HexLabel => _localizer.GetString("Hex Color", "Hex Color");

    /// <summary>Localized empty-surface message shown when the hex is not a complete six-digit value.</summary>
    public string EmptyMessage =>
        _localizer.GetString("devtools.colorConverter.empty", "Enter a six-digit hex colour, e.g. #3b82f6");

    /// <summary>Localized copy affordance idle label (web shared <c>CopyButton</c>).</summary>
    public string CopyLabel => _localizer.GetString("common.copyButton.copy", "Copy");

    /// <summary>Localized copy affordance confirmation label (web shared <c>CopyButton</c>).</summary>
    public string CopiedLabel => _localizer.GetString("common.copyButton.copied", "Copied");

    /// <summary>Localized Narrator name for the colour preview swatch, naming the current hex.</summary>
    public string SwatchName => string.Format(
        CultureInfo.CurrentCulture,
        _localizer.GetString("devtools.colorConverter.swatchName", "Colour preview {0}"),
        Hex);

    /// <summary>Localized Narrator name for a result cell's copy button, scoped to the cell's format.</summary>
    /// <param name="cell">The result cell whose copy affordance is being named.</param>
    public string CopyName(ColorConverterCell cell)
    {
        ArgumentNullException.ThrowIfNull(cell);
        return string.Format(
            CultureInfo.CurrentCulture,
            _localizer.GetString("devtools.colorConverter.copyName", "Copy {0} value"),
            cell.Label);
    }

    private void Reproject()
    {
        Display = ColorConverterProjection.Project(_hex);
        LastAnnouncement = BuildAnnouncement(_display);
    }

    private string BuildAnnouncement(ColorConverterDisplay display) =>
        display.HasResult
            ? string.Join(", ", display.Cells.Select(cell => cell.Value))
            : EmptyMessage;

    private void Raise([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
