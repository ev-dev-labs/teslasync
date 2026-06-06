using System.ComponentModel;

namespace TeslaSync.App.Core;

/// <summary>
/// Two-thumb numeric range backing <c>TsRangeSlider</c>. Enforces
/// <c>min ≤ low ≤ high ≤ max</c> and optional step snapping so the WinUI
/// control never has to police its own invariants.
/// </summary>
public sealed class RangeValue : INotifyPropertyChanged
{
    private double _minimum;
    private double _maximum = 100;
    private double _low;
    private double _high = 100;
    private double _step = 1;

    public event PropertyChangedEventHandler? PropertyChanged;

    public double Minimum
    {
        get => _minimum;
        set
        {
            _minimum = Math.Min(value, _maximum);
            Raise(nameof(Minimum));
            Reclamp();
        }
    }

    public double Maximum
    {
        get => _maximum;
        set
        {
            _maximum = Math.Max(value, _minimum);
            Raise(nameof(Maximum));
            Reclamp();
        }
    }

    /// <summary>Snap increment; values ≤ 0 disable snapping.</summary>
    public double Step
    {
        get => _step;
        set
        {
            _step = value;
            Raise(nameof(Step));
            Reclamp();
        }
    }

    /// <summary>Lower thumb. Clamped to [Minimum, High].</summary>
    public double Low
    {
        get => _low;
        set
        {
            var next = Snap(Math.Clamp(value, _minimum, _high));
            if (Math.Abs(next - _low) < double.Epsilon)
            {
                return;
            }

            _low = next;
            Raise(nameof(Low));
            Raise(nameof(Span));
        }
    }

    /// <summary>Upper thumb. Clamped to [Low, Maximum].</summary>
    public double High
    {
        get => _high;
        set
        {
            var next = Snap(Math.Clamp(value, _low, _maximum));
            if (Math.Abs(next - _high) < double.Epsilon)
            {
                return;
            }

            _high = next;
            Raise(nameof(High));
            Raise(nameof(Span));
        }
    }

    /// <summary>Width of the selected range.</summary>
    public double Span => _high - _low;

    private double Snap(double value)
    {
        if (_step <= 0)
        {
            return value;
        }

        var steps = Math.Round((value - _minimum) / _step, MidpointRounding.AwayFromZero);
        return Math.Clamp(_minimum + (steps * _step), _minimum, _maximum);
    }

    private void Reclamp()
    {
        _low = Snap(Math.Clamp(_low, _minimum, _maximum));
        _high = Snap(Math.Clamp(_high, _low, _maximum));
        Raise(nameof(Low));
        Raise(nameof(High));
        Raise(nameof(Span));
    }

    private void Raise(string name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
