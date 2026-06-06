using System.ComponentModel;
using System.Globalization;

namespace TeslaSync.App.Core.Forms;

/// <summary>
/// A linear unit conversion (display = si * Factor + Offset) used by
/// <c>TsUnitInput</c>. The canonical value is always SI (per the frontend SI
/// cutover); the conversion is applied only at the display boundary.
/// </summary>
public readonly record struct UnitConversion(double Factor, double Offset = 0)
{
    /// <summary>Identity conversion (display == SI).</summary>
    public static UnitConversion Identity => new(1, 0);

    /// <summary>Convert an SI value to the display unit.</summary>
    public double ToDisplay(double si) => (si * Factor) + Offset;

    /// <summary>Convert a display value back to SI.</summary>
    public double ToSi(double display) => Factor == 0 ? 0 : (display - Offset) / Factor;
}

/// <summary>
/// UI-thread-free model for a unit-aware numeric input (<c>TsUnitInput</c>).
/// Stores the canonical SI value and exposes a formatted display string in the
/// active unit; parsing display text writes back the SI value without precision
/// drift in storage.
/// </summary>
public sealed class UnitInputModel : INotifyPropertyChanged
{
    private UnitConversion _conversion;
    private int _precision;
    private double? _siValue;

    public UnitInputModel(UnitConversion conversion, int precision = 1)
    {
        _conversion = conversion;
        _precision = Math.Max(0, precision);
    }

    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Canonical SI value (null when empty).</summary>
    public double? SiValue
    {
        get => _siValue;
        set
        {
            if (Nullable.Equals(_siValue, value))
            {
                return;
            }

            _siValue = value;
            RaiseValue();
        }
    }

    /// <summary>The active display-unit conversion.</summary>
    public UnitConversion Conversion
    {
        get => _conversion;
        set
        {
            _conversion = value;
            RaiseValue();
        }
    }

    /// <summary>Display-unit precision (fractional digits).</summary>
    public int Precision
    {
        get => _precision;
        set
        {
            var next = Math.Max(0, value);
            if (_precision == next)
            {
                return;
            }

            _precision = next;
            RaiseValue();
        }
    }

    /// <summary>The SI value rendered in the display unit at <see cref="Precision"/>.</summary>
    public string Display
    {
        get
        {
            if (_siValue is null)
            {
                return string.Empty;
            }

            var display = _conversion.ToDisplay(_siValue.Value);
            return display.ToString("N" + _precision.ToString(CultureInfo.InvariantCulture), CultureInfo.CurrentCulture);
        }
    }

    /// <summary>
    /// Parse display-unit text and write back the SI value. Blank clears the
    /// value (returns true); unparseable input is rejected (returns false).
    /// </summary>
    public bool TrySetFromDisplay(string? text)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            SiValue = null;
            return true;
        }

        if (!double.TryParse(
                text.Trim(),
                NumberStyles.Float | NumberStyles.AllowThousands,
                CultureInfo.CurrentCulture,
                out var display))
        {
            return false;
        }

        SiValue = _conversion.ToSi(display);
        return true;
    }

    private void RaiseValue()
    {
        Raise(nameof(SiValue));
        Raise(nameof(Display));
    }

    private void Raise(string name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
