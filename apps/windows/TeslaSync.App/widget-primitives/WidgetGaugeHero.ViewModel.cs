using System.ComponentModel;

namespace TeslaSync.App.WidgetPrimitives;

/// <summary>
/// PII-safe diagnostics for the WidgetGaugeHero surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a gauge value, label or unit — so a
/// diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class WidgetGaugeHeroDiagnostics
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "WidgetGaugeHero";

    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public WidgetGaugeHeroDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=WidgetGaugeHero</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={Slug}");
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>WidgetGaugeHero</c> view (P1/S8 state-holder seam) — the
/// native presenter for the pure-presentational web primitive. It holds the gauge config, the supporting stats
/// and the compact flag, and exposes the projected <see cref="GaugeHeroDisplay"/> recomputed through
/// <see cref="WidgetGaugeHeroProjection"/> on every change so the view stays a thin renderer. The primitive has
/// no data source (the web source consumes no hooks), so this performs no I/O; assigning a property re-projects
/// and raises <see cref="INotifyPropertyChanged"/> for <see cref="Display"/>. Drive it from one confinement (the
/// UI thread); it is not internally synchronised.
/// </summary>
public sealed class WidgetGaugeHeroViewModel : INotifyPropertyChanged
{
    private GaugeHeroConfig _gauge;
    private IReadOnlyList<GaugeHeroStat> _stats;
    private bool _compact;
    private GaugeHeroDisplay _display;

    /// <summary>Creates the holder over its gauge config, optional stats and footprint.</summary>
    public WidgetGaugeHeroViewModel(GaugeHeroConfig gauge, IReadOnlyList<GaugeHeroStat>? stats = null, bool compact = false)
    {
        ArgumentNullException.ThrowIfNull(gauge);
        _gauge = gauge;
        _stats = stats ?? Array.Empty<GaugeHeroStat>();
        _compact = compact;
        _display = WidgetGaugeHeroProjection.Project(_gauge, _stats, _compact);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The gauge configuration; reassigning re-projects the display.</summary>
    public GaugeHeroConfig Gauge
    {
        get => _gauge;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _gauge = value;
            Raise(nameof(Gauge));
            Reproject();
        }
    }

    /// <summary>The supporting stats; null collapses to an empty list. Reassigning re-projects the display.</summary>
    public IReadOnlyList<GaugeHeroStat> Stats
    {
        get => _stats;
        set
        {
            _stats = value ?? Array.Empty<GaugeHeroStat>();
            Raise(nameof(Stats));
            Reproject();
        }
    }

    /// <summary>The compact footprint flag; reassigning re-projects the display.</summary>
    public bool Compact
    {
        get => _compact;
        set
        {
            if (_compact == value)
            {
                return;
            }

            _compact = value;
            Raise(nameof(Compact));
            Reproject();
        }
    }

    /// <summary>The projected, render-ready model the view binds to.</summary>
    public GaugeHeroDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
        }
    }

    private void Reproject() => Display = WidgetGaugeHeroProjection.Project(_gauge, _stats, _compact);

    private void Raise(string name) => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
