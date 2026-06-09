using System.ComponentModel;
using System.Globalization;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="VinDecoder"/> view — the native port of the web
/// <c>VinDecoderTool</c>'s hook composition
/// (web/src/features/admin/components/devtools/tools/VinDecoder.tsx). It owns the <see cref="Vin"/> text (the
/// web <c>useState('')</c>), redecodes it through <see cref="VinDecoding"/> and reprojects the result into
/// localized cells on every change (the web <c>decoded = useMemo(...)</c> plus its render), and exposes the
/// resulting <see cref="Cells"/> plus the mutually-exclusive <see cref="State"/> so the view is a thin
/// renderer. Every one of the component's own labels (web <c>t('Vin Decoder')</c>, <c>t('Vin Decoder Desc')</c>,
/// <c>t('Vin')</c>, the per-segment <c>t(`devtools.utils.vin_${k}`)</c> labels and the <c>t('Unknown')</c>
/// fallback) resolves through the i18n facade; the result is synchronous and cannot fault, so there is no
/// asynchronous machinery. Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class VinDecoderViewModel : INotifyPropertyChanged
{
    private readonly ILocalizer _localizer;

    private string _vin;
    private VinDecodeResult? _decoded;
    private IReadOnlyList<VinDecoderCell> _cells;
    private string? _lastAnnouncement;

    /// <summary>Creates the holder over its localizer, seeding the web tool's initial empty VIN.</summary>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    public VinDecoderViewModel(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        _localizer = localizer;
        _vin = string.Empty;
        _decoded = VinDecoding.Decode(_vin);
        _cells = BuildCells(_decoded);
        _lastAnnouncement = BuildAnnouncement(_decoded, _cells);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>
    /// The current VIN text (the web <c>vin</c> state). Reassigning redecodes the VIN and, when the result
    /// changes shape, flips <see cref="State"/> between the decoded grid and the empty surface.
    /// </summary>
    public string Vin
    {
        get => _vin;
        set
        {
            string next = value ?? string.Empty;
            if (string.Equals(_vin, next, StringComparison.Ordinal))
            {
                return;
            }

            _vin = next;
            Raise(nameof(Vin));
            Redecode();
        }
    }

    /// <summary>The decoded segments for the current VIN, or <c>null</c> below the decode threshold.</summary>
    public VinDecodeResult? Decoded => _decoded;

    /// <summary>The ordered, localized segment cells for the current VIN (empty below the decode threshold).</summary>
    public IReadOnlyList<VinDecoderCell> Cells => _cells;

    /// <summary>The current mutually-exclusive surface state (decoded grid vs friendly empty surface).</summary>
    public VinDecoderState State => _decoded is null ? VinDecoderState.Empty : VinDecoderState.Ready;

    /// <summary>True when the VIN decoded and the segment cells are shown (the web <c>decoded != null</c>).</summary>
    public bool HasResult => _decoded is not null;

    /// <summary>The last result surfaced to the accessibility live region (the joined cells, or the empty message).</summary>
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

    /// <summary>Localized card title (web <c>t('Vin Decoder')</c>).</summary>
    public string Title => _localizer.GetString("Vin Decoder", "Vin Decoder");

    /// <summary>Localized card description (web <c>t('Vin Decoder Desc')</c>).</summary>
    public string Description => _localizer.GetString("Vin Decoder Desc", "Vin Decoder Desc");

    /// <summary>Localized VIN field label (web <c>t('Vin')</c>).</summary>
    public string VinLabel => _localizer.GetString("Vin", "Vin");

    /// <summary>Localized fallback for an unmatched lookup segment (web <c>t('Unknown')</c>).</summary>
    public string UnknownValue => _localizer.GetString("Unknown", "Unknown");

    /// <summary>Localized empty-surface message shown while the VIN is below the decode threshold.</summary>
    public string EmptyMessage => string.Format(
        CultureInfo.CurrentCulture,
        _localizer.GetString("devtools.vinDecoder.empty", "Enter at least {0} VIN characters to decode it"),
        VinDecoding.MinLength);

    /// <summary>Localized Narrator name for the VIN field, naming the sample VIN it accepts.</summary>
    public string VinFieldName => string.Format(
        CultureInfo.CurrentCulture,
        _localizer.GetString("devtools.vinDecoder.fieldName", "{0}, for example {1}"),
        VinLabel,
        VinDecoderRegistration.SampleVin);

    /// <summary>Localized Narrator name for one decoded cell, pairing its label with its value.</summary>
    /// <param name="cell">The decoded cell whose Narrator name is being composed.</param>
    public string CellName(VinDecoderCell cell)
    {
        ArgumentNullException.ThrowIfNull(cell);
        return string.Format(
            CultureInfo.CurrentCulture,
            _localizer.GetString("devtools.vinDecoder.cellName", "{0}: {1}"),
            cell.Label,
            cell.Value);
    }

    private void Redecode()
    {
        _decoded = VinDecoding.Decode(_vin);
        _cells = BuildCells(_decoded);

        Raise(nameof(Decoded));
        Raise(nameof(Cells));
        Raise(nameof(State));
        Raise(nameof(HasResult));

        LastAnnouncement = BuildAnnouncement(_decoded, _cells);
    }

    private VinDecoderCell[] BuildCells(VinDecodeResult? decoded)
    {
        if (decoded is null)
        {
            return Array.Empty<VinDecoderCell>();
        }

        string unknown = UnknownValue;
        var fields = VinDecoderField.All;
        var cells = new VinDecoderCell[fields.Count];
        for (int i = 0; i < fields.Count; i++)
        {
            var field = fields[i];
            string label = _localizer.GetString(field.LabelKey, field.LabelFallback);
            string value = field.Selector(decoded) ?? unknown;
            cells[i] = new VinDecoderCell(label, value);
        }

        return cells;
    }

    private string BuildAnnouncement(VinDecodeResult? decoded, IReadOnlyList<VinDecoderCell> cells) =>
        decoded is null
            ? EmptyMessage
            : string.Join(", ", cells.Select(cell => $"{cell.Label}: {cell.Value}"));

    private void Raise([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
