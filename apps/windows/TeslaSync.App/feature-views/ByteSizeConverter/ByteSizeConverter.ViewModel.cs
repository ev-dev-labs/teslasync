using System.ComponentModel;
using System.Globalization;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="ByteSizeConverter"/> view — the native port of
/// the web <c>ByteSizeConverterTool</c>'s hook composition
/// (web/src/features/admin/components/devtools/tools/ByteSizeConverter.tsx). It owns the two pieces of local
/// state the web component keeps with <c>useState</c> (<see cref="Value"/> ← <c>value</c>,
/// <see cref="Unit"/> ← <c>unit</c>), recomputes the conversion ladder through the pure
/// <see cref="ByteSizeProjection"/> adapter on every edit (web <c>useMemo([value, unit])</c>), and exposes
/// the mutually-exclusive <see cref="State"/> (empty ↔ populated) the view renders. Every one of the
/// component's strings resolves through the i18n facade (web <c>t(...)</c>): the card title / description
/// (web <c>t('Byte Size')</c> / <c>t('Byte Size Desc')</c>) and the two field labels
/// (web <c>t('Value')</c> / <c>t('Unit')</c>), plus the native-only empty-state and screen-reader summary
/// strings the platform's "never a blank box" + accessibility contract requires. The view is a thin
/// renderer over these properties; it raises <see cref="PropertyChanged"/> synchronously from the edit that
/// triggered it.
/// </summary>
public sealed class ByteSizeConverterViewModel : INotifyPropertyChanged
{
    private readonly ILocalizer _localizer;

    private string _value;
    private string _unit;
    private IReadOnlyList<ByteConversion>? _conversions;

    /// <summary>Creates the holder over its localizer, seeded with an empty value and the default unit ("B").</summary>
    /// <param name="localizer">The i18n facade resolving every label (web <c>useTranslation</c>).</param>
    public ByteSizeConverterViewModel(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        _localizer = localizer;
        _value = string.Empty;
        _unit = ByteSizeUnits.Default;
        Recompute();
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The typed value (web <c>value</c> state). Setting it recomputes the conversion ladder.</summary>
    public string Value
    {
        get => _value;
        set
        {
            string next = value ?? string.Empty;
            if (string.Equals(_value, next, StringComparison.Ordinal))
            {
                return;
            }

            _value = next;
            Raise();
            Recompute();
        }
    }

    /// <summary>The chosen unit (web <c>unit</c> state, default "B"). Setting it recomputes the ladder.</summary>
    public string Unit
    {
        get => _unit;
        set
        {
            string next = string.IsNullOrEmpty(value) ? ByteSizeUnits.Default : value;
            if (string.Equals(_unit, next, StringComparison.Ordinal))
            {
                return;
            }

            _unit = next;
            Raise();
            Recompute();
        }
    }

    /// <summary>The byte units offered by the unit picker (web <c>BYTE_UNITS.map(...)</c> options).</summary>
    public IReadOnlyList<string> UnitOptions { get; } = ByteSizeUnits.All;

    /// <summary>The five-cell conversion ladder, or <c>null</c> when the input is empty / invalid (web <c>conversions</c>).</summary>
    public IReadOnlyList<ByteConversion>? Conversions => _conversions;

    /// <summary>The current mutually-exclusive surface state (empty ↔ populated).</summary>
    public ByteSizeConverterState State =>
        _conversions is null ? ByteSizeConverterState.Empty : ByteSizeConverterState.Populated;

    /// <summary>True once a valid number has produced a conversion ladder (the grid is shown).</summary>
    public bool HasConversions => _conversions is not null;

    /// <summary>True when there is no valid input yet (the friendly empty hint is shown instead of the grid).</summary>
    public bool IsEmpty => _conversions is null;

    /// <summary>
    /// True when the field holds text that is not a number — a non-blocking validity affordance the view
    /// surfaces to Narrator (via the input's error state). The web folds empty and non-numeric input into
    /// the same "no grid" branch; this only distinguishes them for assistive tech and never blocks input.
    /// </summary>
    public bool IsInvalidInput => _conversions is null && _value.Trim().Length > 0;

    /// <summary>Localized card title (web <c>t('Byte Size')</c>).</summary>
    public string Title => _localizer.GetString("translation.Byte Size", "Byte Size");

    /// <summary>Localized card description (web <c>t('Byte Size Desc')</c>).</summary>
    public string Description => _localizer.GetString("translation.Byte Size Desc", "Byte Size Desc");

    /// <summary>Localized value-field label (web <c>t('Value')</c>).</summary>
    public string ValueLabel => _localizer.GetString("translation.Value", "Value");

    /// <summary>Localized unit-field label (web <c>t('Unit')</c>).</summary>
    public string UnitLabel => _localizer.GetString("translation.Unit", "Unit");

    /// <summary>The value field's example text — a dimensionless sample, not localized (the web field's example <c>1024</c>).</summary>
    public string ValueHint { get; } = "1024";

    /// <summary>Localized empty-state heading shown in place of the grid before a valid number is entered.</summary>
    public string EmptyTitle => _localizer.GetString("byteSize.empty.title", "Enter a value");

    /// <summary>Localized empty-state message shown in place of the grid (never a blank box).</summary>
    public string EmptyMessage =>
        _localizer.GetString("byteSize.empty.message", "Type a number and pick a unit to see size conversions.");

    /// <summary>
    /// A concise, localized live-region summary announced when the grid populates (and cleared when empty),
    /// so a Narrator user hears the result of an edit without scrubbing every cell. Built from the total
    /// byte count (the index-0 cell). Null while <see cref="IsEmpty"/>.
    /// </summary>
    public string? ResultAnnouncement
    {
        get
        {
            var conversions = _conversions;
            if (conversions is null || conversions.Count == 0)
            {
                return null;
            }

            return string.Format(
                CultureInfo.CurrentCulture,
                _localizer.GetString("byteSize.summary", "{0} {1} = {2} bytes"),
                _value.Trim(),
                _unit,
                conversions[0].Value);
        }
    }

    private void Recompute()
    {
        _conversions = ByteSizeProjection.Project(_value, _unit);
        Raise(nameof(Conversions));
        Raise(nameof(State));
        Raise(nameof(HasConversions));
        Raise(nameof(IsEmpty));
        Raise(nameof(IsInvalidInput));
        Raise(nameof(ResultAnnouncement));
    }

    private void Raise([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
