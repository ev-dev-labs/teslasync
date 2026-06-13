using System.ComponentModel;
using TeslaSync.App.Core.Charts;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="TsProgressRing"/> view (P1/S8 state-holder seam) — the
/// native presenter for the pure-presentational web gauge (web/src/components/data-display/ProgressRing.tsx).
/// The web component is fully controlled by its props; this holder mirrors that by tracking each prop
/// (<see cref="Value"/>, <see cref="Max"/>, <see cref="Size"/>, <see cref="StrokeWidth"/>, the centred readouts,
/// the caption and the token-driven arc colour) and exposing the projected <see cref="ProgressRingProjection"/>
/// recomputed through <see cref="ProgressRingProjection.Project"/> on every change, so the view stays a thin
/// renderer. The surface has no data source (the web source consumes no hooks), so this performs no I/O;
/// assigning a property re-projects and, when the projection actually changes, raises
/// <see cref="INotifyPropertyChanged"/> for <see cref="Projection"/>. Drive it from one confinement (the UI
/// thread); it is not internally synchronised.
/// </summary>
public sealed class ProgressRingViewModel : INotifyPropertyChanged
{
    private double _value;
    private double _max;
    private double _size;
    private double _strokeWidth;
    private string? _centerLabel;
    private string? _centerSubLabel;
    private string? _label;
    private ChartRole _role;
    private int _colorIndex;
    private ProgressRingProjection _projection;

    /// <summary>
    /// Creates the holder over the full set of web props. Every parameter mirrors a <c>ProgressRing</c> prop and
    /// defaults to the value the web source declares; the arc colour is expressed as a token-driven
    /// <paramref name="role"/> / <paramref name="colorIndex"/> rather than the web <c>color</c> hex.
    /// </summary>
    /// <param name="value">The value the arc represents (web <c>value</c>).</param>
    /// <param name="max">The full-sweep maximum (web <c>max</c>).</param>
    /// <param name="size">The ring diameter in pixels (web <c>size</c>).</param>
    /// <param name="strokeWidth">The arc stroke width in pixels (web <c>strokeWidth</c>).</param>
    /// <param name="centerLabel">The centred primary readout (web <c>centerLabel</c>), or null for none.</param>
    /// <param name="centerSubLabel">The centred secondary readout (web <c>centerSubLabel</c>), or null for none.</param>
    /// <param name="label">The caption rendered beneath the ring (web <c>label</c>), or null for none.</param>
    /// <param name="role">The semantic role tinting the value arc (token-driven).</param>
    /// <param name="colorIndex">The categorical palette index tinting the arc when <paramref name="role"/> is None.</param>
    public ProgressRingViewModel(
        double value,
        double max = ProgressRingRegistration.DefaultMax,
        double size = ProgressRingRegistration.DefaultSize,
        double strokeWidth = ProgressRingRegistration.DefaultStrokeWidth,
        string? centerLabel = null,
        string? centerSubLabel = null,
        string? label = null,
        ChartRole role = ChartRole.None,
        int colorIndex = ProgressRingRegistration.DefaultColorIndex)
    {
        _value = value;
        _max = max;
        _size = size;
        _strokeWidth = strokeWidth;
        _centerLabel = centerLabel;
        _centerSubLabel = centerSubLabel;
        _label = label;
        _role = role;
        _colorIndex = colorIndex;
        _projection = Project();
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The canonical surface slug (<c>ProgressRing</c>).</summary>
    public static string Slug => ProgressRingRegistration.Slug;

    /// <summary>The current render projection (sanitised geometry + render branches + accessible name).</summary>
    public ProgressRingProjection Projection => _projection;

    /// <summary>The value the arc represents (web <c>value</c>); reassigning re-projects the display.</summary>
    public double Value
    {
        get => _value;
        set
        {
            if (_value.Equals(value))
            {
                return;
            }

            _value = value;
            Raise(nameof(Value));
            Reproject();
        }
    }

    /// <summary>The full-sweep maximum (web <c>max</c>); reassigning re-projects the display.</summary>
    public double Max
    {
        get => _max;
        set
        {
            if (_max.Equals(value))
            {
                return;
            }

            _max = value;
            Raise(nameof(Max));
            Reproject();
        }
    }

    /// <summary>The ring diameter in pixels (web <c>size</c>); reassigning re-projects the display.</summary>
    public double Size
    {
        get => _size;
        set
        {
            if (_size.Equals(value))
            {
                return;
            }

            _size = value;
            Raise(nameof(Size));
            Reproject();
        }
    }

    /// <summary>The arc stroke width in pixels (web <c>strokeWidth</c>); reassigning re-projects the display.</summary>
    public double StrokeWidth
    {
        get => _strokeWidth;
        set
        {
            if (_strokeWidth.Equals(value))
            {
                return;
            }

            _strokeWidth = value;
            Raise(nameof(StrokeWidth));
            Reproject();
        }
    }

    /// <summary>The centred primary readout (web <c>centerLabel</c>); reassigning re-projects the display.</summary>
    public string? CenterLabel
    {
        get => _centerLabel;
        set
        {
            if (string.Equals(_centerLabel, value, StringComparison.Ordinal))
            {
                return;
            }

            _centerLabel = value;
            Raise(nameof(CenterLabel));
            Reproject();
        }
    }

    /// <summary>The centred secondary readout (web <c>centerSubLabel</c>); reassigning re-projects the display.</summary>
    public string? CenterSubLabel
    {
        get => _centerSubLabel;
        set
        {
            if (string.Equals(_centerSubLabel, value, StringComparison.Ordinal))
            {
                return;
            }

            _centerSubLabel = value;
            Raise(nameof(CenterSubLabel));
            Reproject();
        }
    }

    /// <summary>The caption rendered beneath the ring (web <c>label</c>); reassigning re-projects the display.</summary>
    public string? Label
    {
        get => _label;
        set
        {
            if (string.Equals(_label, value, StringComparison.Ordinal))
            {
                return;
            }

            _label = value;
            Raise(nameof(Label));
            Reproject();
        }
    }

    /// <summary>The semantic role tinting the value arc; reassigning re-projects the display.</summary>
    public ChartRole Role
    {
        get => _role;
        set
        {
            if (_role == value)
            {
                return;
            }

            _role = value;
            Raise(nameof(Role));
            Reproject();
        }
    }

    /// <summary>The categorical palette index tinting the arc when <see cref="Role"/> is None; re-projects on change.</summary>
    public int ColorIndex
    {
        get => _colorIndex;
        set
        {
            if (_colorIndex == value)
            {
                return;
            }

            _colorIndex = value;
            Raise(nameof(ColorIndex));
            Reproject();
        }
    }

    private ProgressRingProjection Project() =>
        ProgressRingProjection.Project(
            _value,
            _max,
            _size,
            _strokeWidth,
            _centerLabel,
            _centerSubLabel,
            _label,
            _role,
            _colorIndex);

    private void Reproject()
    {
        var next = Project();
        if (next == _projection)
        {
            return;
        }

        _projection = next;
        Raise(nameof(Projection));
    }

    private void Raise(string propertyName) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
}
