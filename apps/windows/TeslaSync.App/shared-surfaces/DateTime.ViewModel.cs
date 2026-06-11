using System.ComponentModel;
using System.Globalization;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.SharedSurfaces.DateTimeSurface;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="DateTime"/> view — the native port of the
/// web <c>format/DateTime</c> component's render composition (web/src/components/data-display/format/DateTime.tsx).
/// It mirrors the web prop set (<see cref="Value"/>, <see cref="Variant"/>, <see cref="Mode"/> ≙ the
/// <c>in</c> prop, <see cref="ShowTz"/>) and reproduces the component's two-path behaviour: with no zone
/// prop it stays on the PURE path (system zone + en-US, identical to <c>TsDateTime</c>); when
/// <see cref="Mode"/> or <see cref="ShowTz"/> is set it takes the zone-aware path, resolving the IANA zone
/// and locale from the bound <see cref="IDateTimeContext"/> (web <c>useTimezone()</c> + <c>useSettings()</c>)
/// and re-rendering whenever that context changes. Every projection is computed through the pure
/// <see cref="DateTimeSurfaceFormatting"/>; the view performs no I/O. Drive it from one confinement (the UI
/// thread); it is not internally synchronised.
/// </summary>
public sealed class DateTimeViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IDateTimeContext _context;
    private readonly TimeZoneInfo _systemZone;
    private readonly Func<DateTimeOffset> _clock;

    private DateTimeOffset? _value;
    private DateTimeVariant _variant = DateTimeVariant.Full;
    private DateTimeTzMode? _mode;
    private bool _showTz;

    private string _display = DateTimeSurfaceFormatting.EmptyDisplay;
    private string? _title;
    private string _abbreviation = string.Empty;
    private DateTimeRenderState _state = DateTimeRenderState.Empty;
    private DateTimeTzMode _effectiveMode = DateTimeTzMode.Vehicle;
    private string _resolvedZoneId = DateTimeSurfaceFormatting.UtcZoneId;
    private bool _disposed;

    /// <summary>Creates the holder over its context seam, the system zone fallback and an injectable clock.</summary>
    /// <param name="context">The zone/locale source (P1/S8). Defaults to the no-override system context (PURE path).</param>
    /// <param name="systemZone">The system zone used as the "user/browser" zone and the resolution fallback. Defaults to <see cref="TimeZoneInfo.Local"/>.</param>
    /// <param name="clock">Supplies "now" for the relative variant. Defaults to <see cref="DateTimeOffset.Now"/>; pinned in tests.</param>
    public DateTimeViewModel(
        IDateTimeContext? context = null,
        TimeZoneInfo? systemZone = null,
        Func<DateTimeOffset>? clock = null)
    {
        _context = context ?? SystemDateTimeContext.Instance;
        _systemZone = systemZone ?? TimeZoneInfo.Local;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _context.Changed += OnContextChanged;
        Recompute();
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The timestamp to render (web <c>value</c>); <see langword="null"/> shows the em-dash sentinel.</summary>
    public DateTimeOffset? Value
    {
        get => _value;
        set
        {
            if (Nullable.Equals(_value, value))
            {
                return;
            }

            _value = value;
            Raise(nameof(Value));
            Recompute();
        }
    }

    /// <summary>The render variant (web <c>variant</c>, default <see cref="DateTimeVariant.Full"/>).</summary>
    public DateTimeVariant Variant
    {
        get => _variant;
        set
        {
            if (_variant == value)
            {
                return;
            }

            _variant = value;
            Raise(nameof(Variant));
            Recompute();
        }
    }

    /// <summary>
    /// The explicit zone mode (web <c>in</c> prop). <see langword="null"/> leaves the component on the PURE
    /// path unless <see cref="ShowTz"/> is set; a value (or <see cref="ShowTz"/>) selects the zone-aware path.
    /// </summary>
    public DateTimeTzMode? Mode
    {
        get => _mode;
        set
        {
            if (_mode == value)
            {
                return;
            }

            _mode = value;
            Raise(nameof(Mode));
            Raise(nameof(IsTzAware));
            Recompute();
        }
    }

    /// <summary>Whether to append the short zone designator (web <c>showTz</c>); also forces the zone-aware path.</summary>
    public bool ShowTz
    {
        get => _showTz;
        set
        {
            if (_showTz == value)
            {
                return;
            }

            _showTz = value;
            Raise(nameof(ShowTz));
            Raise(nameof(IsTzAware));
            Recompute();
        }
    }

    /// <summary>True when the zone-aware path is active (web <c>props.in !== undefined || props.showTz</c>).</summary>
    public bool IsTzAware => _mode.HasValue || _showTz;

    /// <summary>The rendered timestamp string (or the em-dash sentinel when <see cref="Value"/> is null).</summary>
    public string Display => _display;

    /// <summary>The hover/title string (web <c>title</c>) — the UTC ISO instant, suffixed <c>(zone)</c> on the zone-aware path; null when there is no value.</summary>
    public string? Title => _title;

    /// <summary>The short zone designator shown when <see cref="ShowTz"/> is set (empty otherwise).</summary>
    public string Abbreviation => _abbreviation;

    /// <summary>True when a non-empty <see cref="Abbreviation"/> should be rendered.</summary>
    public bool HasAbbreviation => _abbreviation.Length > 0;

    /// <summary>Which branch is rendered (empty / rendered) — the surface's honest state union.</summary>
    public DateTimeRenderState State => _state;

    /// <summary>The mode actually applied after the default fallback (web <c>mode ?? tz_display_default ?? 'vehicle'</c>).</summary>
    public DateTimeTzMode EffectiveMode => _effectiveMode;

    /// <summary>The resolved zone id used by the zone-aware path (web <c>useTimezone()</c> result).</summary>
    public string ResolvedZoneId => _resolvedZoneId;

    /// <summary>The Narrator name for the surface — the visible text (value plus any zone designator).</summary>
    public string AccessibleName => HasAbbreviation ? $"{_display} {_abbreviation}" : _display;

    /// <summary>Re-sample the clock and recompute every projection (the analogue of a web re-render / <c>TsDateTime.Refresh</c>).</summary>
    public void Refresh() => Recompute();

    /// <summary>Detach from the context seam (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _context.Changed -= OnContextChanged;
        GC.SuppressFinalize(this);
    }

    private void OnContextChanged(object? sender, EventArgs e) => Recompute();

    private void Recompute()
    {
        DateTimeOffset now = _clock();

        DateTimeRenderState state = _value.HasValue ? DateTimeRenderState.Rendered : DateTimeRenderState.Empty;
        DateTimeTzMode effectiveMode = _mode ?? _context.DefaultMode;

        string display;
        string? title;
        string abbreviation;
        string resolvedZoneId;

        if (IsTzAware)
        {
            resolvedZoneId = DateTimeSurfaceFormatting.ResolveZoneId(
                effectiveMode,
                _context.VehicleTimezone,
                _context.UserTimezone,
                _systemZone.Id);
            TimeZoneInfo zone = DateTimeSurfaceFormatting.ResolveZone(resolvedZoneId, _systemZone);
            CultureInfo culture = DateTimeSurfaceFormatting.ResolveLocale(_context.Locale);

            display = DateTimeSurfaceFormatting.Format(_value, _variant, now, zone, culture);
            title = DateTimeSurfaceFormatting.IsoTitle(_value, resolvedZoneId);
            abbreviation = _showTz ? DateTimeSurfaceFormatting.TzAbbreviation(_value, zone) : string.Empty;
        }
        else
        {
            // PURE path — system zone + en-US, identical to TsDateTime; no zone suffix on the title.
            resolvedZoneId = _systemZone.Id;
            display = DateTimeSurfaceFormatting.Format(_value, _variant, now);
            title = DateTimeSurfaceFormatting.IsoTitle(_value);
            abbreviation = string.Empty;
        }

        bool hadAbbrev = HasAbbreviation;

        SetField(ref _display, display, nameof(Display), nameof(AccessibleName));
        SetTitle(title);
        SetField(ref _abbreviation, abbreviation, nameof(Abbreviation), nameof(AccessibleName));
        if (hadAbbrev != HasAbbreviation)
        {
            Raise(nameof(HasAbbreviation));
        }

        if (_state != state)
        {
            _state = state;
            Raise(nameof(State));
        }

        if (_effectiveMode != effectiveMode)
        {
            _effectiveMode = effectiveMode;
            Raise(nameof(EffectiveMode));
        }

        if (!string.Equals(_resolvedZoneId, resolvedZoneId, StringComparison.Ordinal))
        {
            _resolvedZoneId = resolvedZoneId;
            Raise(nameof(ResolvedZoneId));
        }
    }

    private void SetTitle(string? value)
    {
        if (string.Equals(_title, value, StringComparison.Ordinal))
        {
            return;
        }

        _title = value;
        Raise(nameof(Title));
    }

    private void SetField(ref string field, string value, string propertyName, string? alsoRaise = null)
    {
        if (string.Equals(field, value, StringComparison.Ordinal))
        {
            return;
        }

        field = value;
        Raise(propertyName);
        if (alsoRaise is not null)
        {
            Raise(alsoRaise);
        }
    }

    private void Raise(string propertyName) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
}
