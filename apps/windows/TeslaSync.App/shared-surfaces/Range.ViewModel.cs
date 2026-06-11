using System.ComponentModel;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="Range"/> view — the native port of the web component
/// body (web/src/components/data-display/format/Range.tsx). The web component derives its output from the
/// <c>state</c> prop plus three settings reads (<c>useUnits</c>, <c>usePreferredRange</c>, <c>useRangeLabel</c>);
/// this holder mirrors that by tracking the current <see cref="State"/> snapshot and the host-pushed
/// <see cref="Units"/> / <see cref="PreferredRange"/> / <see cref="Precision"/> preferences, re-projecting through
/// <see cref="RangeProjection"/> on every change. It raises <see cref="PropertyChanged"/> only for the projected
/// properties that actually changed, so the view performs no I/O and re-renders minimally. The preferences are
/// pushed by the host (the same seam the BatteryRangePanel uses for <c>useUnits().unitPrefs</c>); the view binds
/// to this holder rather than reaching for HTTP. Drive it from one confinement (the UI thread); it is not
/// internally synchronised.
/// </summary>
public sealed class RangeViewModel : INotifyPropertyChanged
{
    private readonly ILocalizer _localizer;
    private RangeState? _state;
    private RangeType _preferredRange;
    private UnitPref _units;
    private int _precision;
    private RangeProjection _projection;

    /// <summary>Creates the holder over the i18n facade plus the optional initial snapshot and preferences.</summary>
    /// <param name="localizer">The i18n facade every label resolves through (P1/S10).</param>
    /// <param name="state">The initial vehicle/charge snapshot (web <c>state</c> prop); null while loading/absent.</param>
    /// <param name="preferredRange">The initial preferred-range preference (web <c>useSettings().rangeType</c>).</param>
    /// <param name="units">The initial display-unit preference (web <c>useUnits().unitPrefs</c>); null = metric.</param>
    /// <param name="precision">The decimal precision (web <c>precision = 0</c>); negative uses the default.</param>
    public RangeViewModel(
        ILocalizer localizer,
        RangeState? state = null,
        RangeType preferredRange = RangeType.Rated,
        UnitPref? units = null,
        int precision = RangeRegistration.DefaultPrecision)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        _localizer = localizer;
        _state = state;
        _preferredRange = preferredRange;
        _units = units ?? UnitPref.Metric;
        _precision = precision < 0 ? RangeRegistration.DefaultPrecision : precision;
        _projection = RangeProjection.Project(_state, _preferredRange, _units, _precision, _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The canonical surface slug (<c>Range</c>).</summary>
    public static string Slug => RangeRegistration.Slug;

    /// <summary>The current render projection (selected metres + formatted value + label + accessible name).</summary>
    public RangeProjection Projection => _projection;

    /// <summary>The visible readout — the formatted distance, or the em-dash empty display.</summary>
    public string Value => _projection.Value;

    /// <summary>The localized rated/ideal range label (web <c>useRangeLabel</c>).</summary>
    public string Label => _projection.Label;

    /// <summary>The surface's accessible name (Narrator) — label plus value or "no value".</summary>
    public string AccessibleName => _projection.AccessibleName;

    /// <summary>True when a finite range value is present (false renders the em-dash empty display).</summary>
    public bool HasValue => _projection.HasValue;

    /// <summary>Which range field is currently selected (rated vs ideal).</summary>
    public RangeType Source => _projection.Source;

    /// <summary>
    /// The vehicle/charge snapshot (web <c>state</c> prop). Assigning a new snapshot re-projects and raises the
    /// changed projection properties.
    /// </summary>
    public RangeState? State
    {
        get => _state;
        set
        {
            if (Nullable.Equals(_state, value))
            {
                return;
            }

            _state = value;
            Reproject();
        }
    }

    /// <summary>
    /// The preferred-range preference (web <c>useSettings().rangeType</c>). Reassigning flips rated/ideal and
    /// re-projects the current snapshot.
    /// </summary>
    public RangeType PreferredRange
    {
        get => _preferredRange;
        set
        {
            if (_preferredRange == value)
            {
                return;
            }

            _preferredRange = value;
            Reproject();
        }
    }

    /// <summary>
    /// The display-unit preference (web <c>useUnits().unitPrefs</c>). Reassigning re-projects the current snapshot
    /// in the new units.
    /// </summary>
    public UnitPref Units
    {
        get => _units;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            if (_units == value)
            {
                return;
            }

            _units = value;
            Reproject();
        }
    }

    /// <summary>
    /// The decimal precision (web <c>precision</c>). A negative value is normalised to
    /// <see cref="RangeRegistration.DefaultPrecision"/>. Reassigning re-projects the current snapshot.
    /// </summary>
    public int Precision
    {
        get => _precision;
        set
        {
            int safe = value < 0 ? RangeRegistration.DefaultPrecision : value;
            if (_precision == safe)
            {
                return;
            }

            _precision = safe;
            Reproject();
        }
    }

    /// <summary>Push a new vehicle/charge snapshot (web <c>state</c> prop change). Equivalent to setting <see cref="State"/>.</summary>
    /// <param name="state">The new snapshot, or null when the data is loading/absent.</param>
    public void SetState(RangeState? state) => State = state;

    private void Reproject()
    {
        var next = RangeProjection.Project(_state, _preferredRange, _units, _precision, _localizer);
        if (next == _projection)
        {
            return;
        }

        bool valueChanged = !string.Equals(next.Value, _projection.Value, StringComparison.Ordinal);
        bool labelChanged = !string.Equals(next.Label, _projection.Label, StringComparison.Ordinal);
        bool nameChanged = !string.Equals(next.AccessibleName, _projection.AccessibleName, StringComparison.Ordinal);
        bool hasValueChanged = next.HasValue != _projection.HasValue;
        bool sourceChanged = next.Source != _projection.Source;

        _projection = next;

        Raise(nameof(Projection));
        if (valueChanged)
        {
            Raise(nameof(Value));
        }

        if (labelChanged)
        {
            Raise(nameof(Label));
        }

        if (nameChanged)
        {
            Raise(nameof(AccessibleName));
        }

        if (hasValueChanged)
        {
            Raise(nameof(HasValue));
        }

        if (sourceChanged)
        {
            Raise(nameof(Source));
        }
    }

    private void Raise(string propertyName) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
}
