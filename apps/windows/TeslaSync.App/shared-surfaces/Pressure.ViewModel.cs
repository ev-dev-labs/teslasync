using System.ComponentModel;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="Pressure"/> view — the native port of the web
/// component body (<c>web/src/components/data-display/format/Pressure.tsx</c>). The web component's inputs are
/// its <c>bar</c>/<c>psi</c>/<c>precision</c> props plus the <c>useUnits()</c> preference; this holder tracks
/// the caller-supplied inputs and the current <see cref="UnitPref"/> from the shared
/// <see cref="IPressureUnitSource"/> (P1/S8 seam) and exposes the projected <see cref="PressureProjection"/>
/// the view renders. It raises <see cref="PropertyChanged"/> when the host pushes new inputs (a web prop
/// change) or when the user changes the measurement system at runtime (the web <c>useSettings</c>
/// re-render), so the view stays in sync without performing any I/O itself. <see cref="Dispose"/>
/// unsubscribes from the unit source (the web effect cleanup).
/// </summary>
public sealed class PressureViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IDisposable _unitSubscription;
    private double? _bar;
    private double? _psi;
    private int? _precision;
    private UnitPref _pref;
    private PressureProjection _projection;
    private bool _disposed;

    /// <summary>Creates the holder over the web inputs and the unit-preference source (P1/S8 seam).</summary>
    /// <param name="bar">The canonical input in bar (web <c>bar</c>), or null.</param>
    /// <param name="psi">The alternative input in psi (web <c>psi</c>), or null.</param>
    /// <param name="precision">The per-call fraction-digit override (web <c>precision</c>), or null.</param>
    /// <param name="unitSource">The unit-preference source.</param>
    public PressureViewModel(double? bar, double? psi, int? precision, IPressureUnitSource unitSource)
    {
        ArgumentNullException.ThrowIfNull(unitSource);

        _bar = bar;
        _psi = psi;
        _precision = precision;
        _pref = unitSource.Current;
        _projection = PressureProjection.Project(_bar, _psi, _precision, _pref);
        _unitSubscription = unitSource.Observe(OnUnitsChanged);
    }

    /// <summary>Creates the holder for the common bar-only call with the default precision.</summary>
    /// <param name="bar">The canonical input in bar (web <c>bar</c>), or null.</param>
    /// <param name="unitSource">The unit-preference source.</param>
    public PressureViewModel(double? bar, IPressureUnitSource unitSource)
        : this(bar, psi: null, precision: null, unitSource)
    {
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The canonical surface slug (<c>Pressure</c>).</summary>
    public static string Slug => PressureRegistration.Slug;

    /// <summary>The current render projection (resolved source, converted value, formatting, tooltip).</summary>
    public PressureProjection Projection => _projection;

    /// <summary>The readout's text content (value + unit, or the em dash).</summary>
    public string Text => _projection.Text;

    /// <summary>The hover tooltip echoing the raw source value, or null in the empty state.</summary>
    public string? Tooltip => _projection.Tooltip;

    /// <summary>Whether a finite pressure value resolved.</summary>
    public bool HasValue => _projection.HasValue;

    /// <summary>The accessible name (the readout's text content).</summary>
    public string AccessibleName => _projection.AccessibleName;

    /// <summary>The current canonical input in bar (web <c>bar</c>).</summary>
    public double? Bar => _bar;

    /// <summary>The current alternative input in psi (web <c>psi</c>).</summary>
    public double? Psi => _psi;

    /// <summary>The current per-call fraction-digit override (web <c>precision</c>).</summary>
    public int? Precision => _precision;

    /// <summary>The current unit preference bag.</summary>
    public UnitPref Pref => _pref;

    /// <summary>
    /// Push a new set of inputs (a web prop change). Re-projects and raises <see cref="PropertyChanged"/> when
    /// anything changed. A no-op when all three inputs are unchanged.
    /// </summary>
    /// <param name="bar">The new canonical input in bar.</param>
    /// <param name="psi">The new alternative input in psi.</param>
    /// <param name="precision">The new per-call fraction-digit override.</param>
    public void SetInputs(double? bar, double? psi, int? precision)
    {
        if (NullableEquals(_bar, bar) && NullableEquals(_psi, psi) && _precision == precision)
        {
            return;
        }

        _bar = bar;
        _psi = psi;
        _precision = precision;
        Reproject(inputsChanged: true);
    }

    /// <summary>Stop listening to the unit source (the web effect cleanup); idempotent.</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _unitSubscription.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnUnitsChanged(UnitPref pref)
    {
        if (pref is null || pref == _pref)
        {
            return;
        }

        _pref = pref;
        Reproject(inputsChanged: false);
    }

    private void Reproject(bool inputsChanged)
    {
        PressureProjection next = PressureProjection.Project(_bar, _psi, _precision, _pref);
        if (next == _projection)
        {
            return;
        }

        bool textChanged = !string.Equals(next.Text, _projection.Text, StringComparison.Ordinal);
        bool tooltipChanged = !string.Equals(next.Tooltip, _projection.Tooltip, StringComparison.Ordinal);
        bool hasValueChanged = next.HasValue != _projection.HasValue;
        _projection = next;

        Raise(nameof(Projection));
        if (inputsChanged)
        {
            Raise(nameof(Bar));
            Raise(nameof(Psi));
            Raise(nameof(Precision));
        }

        if (textChanged)
        {
            Raise(nameof(Text));
            Raise(nameof(AccessibleName));
        }

        if (tooltipChanged)
        {
            Raise(nameof(Tooltip));
        }

        if (hasValueChanged)
        {
            Raise(nameof(HasValue));
        }
    }

    private static bool NullableEquals(double? a, double? b) =>
        a.HasValue == b.HasValue && (!a.HasValue || a.Value.Equals(b!.Value));

    private void Raise(string propertyName) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
}
