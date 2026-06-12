using System.ComponentModel;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The UI-thread-free state holder backing the WinUI <see cref="RangeSlider"/> view — the native port of the web
/// <c>&lt;RangeSlider&gt;</c> component body (web/src/components/ui/RangeSlider.tsx). The web component is fully
/// controlled: it renders the caller's <c>value</c> / <c>min</c> / <c>max</c> / <c>step</c> / <c>label</c> props
/// and pushes the user's edits back through <c>onChange</c>. This holder mirrors that split: the host pushes the
/// current <see cref="Value"/> (and the bounds / label / formatter / per-thumb overrides) which re-project the
/// readout, while a user dragging a thumb calls <see cref="RequestLow"/> / <see cref="RequestHigh"/>, which apply
/// the web thumb-swap through <see cref="RangeSliderMath"/>, update the value optimistically and raise
/// <see cref="ValueChanged"/> (the web <c>onChange</c>) with the sorted tuple. It re-projects through
/// <see cref="RangeSliderProjection"/> on every change, raising <see cref="PropertyChanged"/> only for the
/// projected properties that actually changed, so the view performs no I/O and re-renders minimally. Drive it from
/// one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class RangeSliderViewModel : INotifyPropertyChanged
{
    private readonly ILocalizer _localizer;
    private RangeSliderValue _value;
    private double _min;
    private double _max;
    private double _step;
    private string _label;
    private Func<double, string>? _formatValue;
    private string? _minThumbLabel;
    private string? _maxThumbLabel;
    private bool _showLabel;
    private bool _disabled;
    private RangeSliderProjection _projection;

    /// <summary>Creates the holder over the i18n facade plus the web prop defaults / initial values.</summary>
    /// <param name="localizer">The i18n facade every thumb name resolves through (P1/S10).</param>
    /// <param name="value">The initial selected <c>[low, high]</c> pair (web <c>value</c>).</param>
    /// <param name="min">The inclusive lower bound (web <c>min</c>).</param>
    /// <param name="max">The inclusive upper bound (web <c>max</c>).</param>
    /// <param name="step">The step increment (web <c>step = 1</c>).</param>
    /// <param name="label">The visible label and accessible-name base (web <c>label</c>).</param>
    /// <param name="formatValue">Formats displayed values + aria text (web <c>formatValue</c>); null uses <c>String(n)</c>.</param>
    /// <param name="minThumbLabel">Explicit lower-thumb accessible name (web <c>minThumbLabel</c>); null resolves the i18n key.</param>
    /// <param name="maxThumbLabel">Explicit upper-thumb accessible name (web <c>maxThumbLabel</c>); null resolves the i18n key.</param>
    /// <param name="showLabel">Whether the label/value row renders (web <c>showLabel = true</c>).</param>
    /// <param name="disabled">Whether both thumbs are non-interactive (web <c>disabled</c>).</param>
    public RangeSliderViewModel(
        ILocalizer localizer,
        RangeSliderValue value = default,
        double min = 0.0,
        double max = 100.0,
        double step = RangeSliderRegistration.DefaultStep,
        string label = "",
        Func<double, string>? formatValue = null,
        string? minThumbLabel = null,
        string? maxThumbLabel = null,
        bool showLabel = RangeSliderRegistration.ShowLabelDefault,
        bool disabled = false)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _value = value;
        _min = min;
        _max = max;
        _step = step;
        _label = label ?? string.Empty;
        _formatValue = formatValue;
        _minThumbLabel = minThumbLabel;
        _maxThumbLabel = maxThumbLabel;
        _showLabel = showLabel;
        _disabled = disabled;
        _projection = Project();
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>
    /// Raised when the user moves a thumb — the native port of the web <c>onChange</c>. Carries the sorted
    /// <c>[low, high]</c> tuple after the thumb-swap. NOT raised when the host pushes a new <see cref="Value"/>
    /// (the controlled echo), so a parent that updates its state in response will not re-enter.
    /// </summary>
    public event EventHandler<RangeSliderValue>? ValueChanged;

    /// <summary>The canonical surface slug (<c>RangeSlider</c>).</summary>
    public static string Slug => RangeSliderRegistration.Slug;

    /// <summary>The current render projection (display text + accessible names + fill percentages + z-order).</summary>
    public RangeSliderProjection Projection => _projection;

    /// <summary>The lower bound formatted for display (web <c>displayLow</c>).</summary>
    public string DisplayLow => _projection.DisplayLow;

    /// <summary>The upper bound formatted for display (web <c>displayHigh</c>).</summary>
    public string DisplayHigh => _projection.DisplayHigh;

    /// <summary>The visible "low – high" readout (web caption).</summary>
    public string RangeText => _projection.RangeText;

    /// <summary>The lower thumb's accessible name (web <c>aria-label</c>).</summary>
    public string AriaLow => _projection.AriaLow;

    /// <summary>The upper thumb's accessible name (web <c>aria-label</c>).</summary>
    public string AriaHigh => _projection.AriaHigh;

    /// <summary>The lower thumb's fill position 0..100 (web <c>lowPct</c>).</summary>
    public double LowPercent => _projection.LowPercent;

    /// <summary>The upper thumb's fill position 0..100 (web <c>highPct</c>).</summary>
    public double HighPercent => _projection.HighPercent;

    /// <summary>True when the low thumb sits above the high thumb in z-order (web <c>lowPct &gt; 50</c>).</summary>
    public bool LowOnTop => _projection.LowOnTop;

    /// <summary>Whether both thumbs accept input (web <c>!disabled</c>).</summary>
    public bool IsEnabled => !_disabled;

    /// <summary>
    /// The selected <c>[low, high]</c> pair (web <c>value</c>). Assigning a new pair is the controlled echo: it
    /// re-projects but does NOT raise <see cref="ValueChanged"/>. A no-op when the pair is unchanged.
    /// </summary>
    public RangeSliderValue Value
    {
        get => _value;
        set => SetValueInternal(value, raiseChange: false);
    }

    /// <summary>The inclusive lower bound (web <c>min</c>). Reassigning re-projects.</summary>
    public double Min
    {
        get => _min;
        set
        {
            if (_min.Equals(value))
            {
                return;
            }

            _min = value;
            Raise(nameof(Min));
            Reproject();
        }
    }

    /// <summary>The inclusive upper bound (web <c>max</c>). Reassigning re-projects.</summary>
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

    /// <summary>The step increment (web <c>step</c>). Reassigning re-projects.</summary>
    public double Step
    {
        get => _step;
        set
        {
            if (_step.Equals(value))
            {
                return;
            }

            _step = value;
            Raise(nameof(Step));
            Reproject();
        }
    }

    /// <summary>The visible label and accessible-name base (web <c>label</c>). Reassigning re-projects.</summary>
    public string Label
    {
        get => _label;
        set
        {
            string next = value ?? string.Empty;
            if (string.Equals(_label, next, StringComparison.Ordinal))
            {
                return;
            }

            _label = next;
            Raise(nameof(Label));
            Reproject();
        }
    }

    /// <summary>The display / aria-text formatter (web <c>formatValue</c>). Reassigning re-projects.</summary>
    public Func<double, string>? FormatValue
    {
        get => _formatValue;
        set
        {
            if (ReferenceEquals(_formatValue, value))
            {
                return;
            }

            _formatValue = value;
            Raise(nameof(FormatValue));
            Reproject();
        }
    }

    /// <summary>Explicit lower-thumb accessible name (web <c>minThumbLabel</c>). Null resolves the i18n key.</summary>
    public string? MinThumbLabel
    {
        get => _minThumbLabel;
        set
        {
            if (string.Equals(_minThumbLabel, value, StringComparison.Ordinal))
            {
                return;
            }

            _minThumbLabel = value;
            Raise(nameof(MinThumbLabel));
            Reproject();
        }
    }

    /// <summary>Explicit upper-thumb accessible name (web <c>maxThumbLabel</c>). Null resolves the i18n key.</summary>
    public string? MaxThumbLabel
    {
        get => _maxThumbLabel;
        set
        {
            if (string.Equals(_maxThumbLabel, value, StringComparison.Ordinal))
            {
                return;
            }

            _maxThumbLabel = value;
            Raise(nameof(MaxThumbLabel));
            Reproject();
        }
    }

    /// <summary>Whether the visible label/value row renders (web <c>showLabel</c>). Reassigning re-projects.</summary>
    public bool ShowLabel
    {
        get => _showLabel;
        set
        {
            if (_showLabel == value)
            {
                return;
            }

            _showLabel = value;
            Raise(nameof(ShowLabel));
            Reproject();
        }
    }

    /// <summary>Whether both thumbs are non-interactive (web <c>disabled</c>). Reassigning re-projects.</summary>
    public bool Disabled
    {
        get => _disabled;
        set
        {
            if (_disabled == value)
            {
                return;
            }

            _disabled = value;
            Raise(nameof(Disabled));
            Raise(nameof(IsEnabled));
            Reproject();
        }
    }

    /// <summary>
    /// Request a new value for the LOW thumb (a user drag / keypress). Applies the web thumb-swap, updates the
    /// value optimistically and raises <see cref="ValueChanged"/> with the sorted tuple.
    /// </summary>
    /// <param name="next">The raw value the low thumb moved to.</param>
    public void RequestLow(double next)
    {
        if (double.IsNaN(next))
        {
            return;
        }

        SetValueInternal(RangeSliderMath.ApplyLowChange(_value, next), raiseChange: true);
    }

    /// <summary>
    /// Request a new value for the HIGH thumb (a user drag / keypress). Applies the web thumb-swap, updates the
    /// value optimistically and raises <see cref="ValueChanged"/> with the sorted tuple.
    /// </summary>
    /// <param name="next">The raw value the high thumb moved to.</param>
    public void RequestHigh(double next)
    {
        if (double.IsNaN(next))
        {
            return;
        }

        SetValueInternal(RangeSliderMath.ApplyHighChange(_value, next), raiseChange: true);
    }

    private void SetValueInternal(RangeSliderValue next, bool raiseChange)
    {
        if (_value.Equals(next))
        {
            return;
        }

        _value = next;
        Reproject();

        if (raiseChange)
        {
            ValueChanged?.Invoke(this, _value);
        }
    }

    private RangeSliderProjection Project() =>
        RangeSliderProjection.Project(
            _value,
            _min,
            _max,
            _label,
            _formatValue,
            _minThumbLabel,
            _maxThumbLabel,
            _showLabel,
            _disabled,
            _localizer);

    private void Reproject()
    {
        RangeSliderProjection next = Project();
        if (next == _projection)
        {
            return;
        }

        RangeSliderProjection previous = _projection;
        _projection = next;

        Raise(nameof(Projection));
        RaiseIfChanged(nameof(DisplayLow), !string.Equals(previous.DisplayLow, next.DisplayLow, StringComparison.Ordinal));
        RaiseIfChanged(nameof(DisplayHigh), !string.Equals(previous.DisplayHigh, next.DisplayHigh, StringComparison.Ordinal));
        RaiseIfChanged(nameof(RangeText), !string.Equals(previous.RangeText, next.RangeText, StringComparison.Ordinal));
        RaiseIfChanged(nameof(AriaLow), !string.Equals(previous.AriaLow, next.AriaLow, StringComparison.Ordinal));
        RaiseIfChanged(nameof(AriaHigh), !string.Equals(previous.AriaHigh, next.AriaHigh, StringComparison.Ordinal));
        RaiseIfChanged(nameof(LowPercent), !previous.LowPercent.Equals(next.LowPercent));
        RaiseIfChanged(nameof(HighPercent), !previous.HighPercent.Equals(next.HighPercent));
        RaiseIfChanged(nameof(LowOnTop), previous.LowOnTop != next.LowOnTop);
    }

    private void RaiseIfChanged(string propertyName, bool changed)
    {
        if (changed)
        {
            Raise(propertyName);
        }
    }

    private void Raise(string propertyName) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
}
