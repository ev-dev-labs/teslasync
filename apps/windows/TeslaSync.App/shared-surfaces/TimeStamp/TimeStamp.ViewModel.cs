using System.ComponentModel;
using System.Globalization;

namespace TeslaSync.App.SharedSurfaces.TimeStampSurface;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="TimeStamp"/> view — the native port of the web
/// <c>TimeStamp</c> component's render composition (web/src/components/data-display/TimeStamp.tsx). It
/// mirrors the web prop set (<see cref="Value"/>, <see cref="Format"/>, <see cref="Mode"/> ≙ the <c>in</c>
/// prop) and reproduces the component's body/tooltip split: the visible body shows the primary format
/// (relative or absolute, chosen by <see cref="Format"/> defaulting to the user's preference) and the
/// hover tooltip always shows the OTHER format, so power users can flip perspective without leaving the
/// page. The zone is always resolved (web <c>useDateFormat</c> always derives a zone from
/// <c>in ?? tz_display_default ?? 'vehicle'</c>) and re-renders whenever the bound
/// <see cref="ITimeStampContext"/> (locale / zones / mode / preference) changes. A null value renders the
/// em-dash sentinel with no tooltip. Every projection is computed through the pure
/// <see cref="TimeStampFormatting"/>; the view performs no I/O. Drive it from one confinement (the UI
/// thread); it is not internally synchronised.
/// </summary>
public sealed class TimeStampViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ITimeStampContext _context;
    private readonly TimeZoneInfo _systemZone;
    private readonly Func<DateTimeOffset> _clock;

    private DateTimeOffset? _value;
    private TimeStampFormat _format = TimeStampFormat.Auto;
    private TimeStampTzMode? _mode;

    private string _display = TimeStampFormatting.EmptyDisplay;
    private string? _tooltip;
    private TimeStampRenderState _state = TimeStampRenderState.Empty;
    private TimeStampTzMode _effectiveMode = TimeStampTzMode.Vehicle;
    private TimeStampFormat _effectiveFormat = TimeStampFormat.Relative;
    private string _resolvedZoneId = TimeStampFormatting.UtcZoneId;
    private bool _disposed;

    /// <summary>Creates the holder over its context seam, the system zone fallback and an injectable clock.</summary>
    /// <param name="context">The locale / zone / preference source (P1/S8). Defaults to the system default context.</param>
    /// <param name="systemZone">The zone used as the "user/browser" zone and the resolution fallback. Defaults to <see cref="TimeZoneInfo.Local"/>.</param>
    /// <param name="clock">Supplies "now" for the relative tiers. Defaults to <see cref="DateTimeOffset.Now"/>; pinned in tests.</param>
    public TimeStampViewModel(
        ITimeStampContext? context = null,
        TimeZoneInfo? systemZone = null,
        Func<DateTimeOffset>? clock = null)
    {
        _context = context ?? SystemTimeStampContext.Instance;
        _systemZone = systemZone ?? TimeZoneInfo.Local;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _context.Changed += OnContextChanged;
        Recompute();
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The timestamp to render (web <c>value</c>); <see langword="null"/> shows the em-dash sentinel with no tooltip.</summary>
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

    /// <summary>The visible format selector (web <c>format</c>, default <see cref="TimeStampFormat.Auto"/>).</summary>
    public TimeStampFormat Format
    {
        get => _format;
        set
        {
            if (_format == value)
            {
                return;
            }

            _format = value;
            Raise(nameof(Format));
            Recompute();
        }
    }

    /// <summary>
    /// The explicit zone mode (web <c>in</c> prop). <see langword="null"/> defers to the context's
    /// <see cref="ITimeStampContext.DefaultMode"/> (web <c>tz_display_default</c>).
    /// </summary>
    public TimeStampTzMode? Mode
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
            Recompute();
        }
    }

    /// <summary>The rendered primary string (or the em-dash sentinel when <see cref="Value"/> is null).</summary>
    public string Display => _display;

    /// <summary>
    /// The hover tooltip — always the alternate format (web <c>Tooltip content={secondary}</c>);
    /// <see langword="null"/> when there is no value (web renders a bare span with no tooltip wrapper).
    /// </summary>
    public string? Tooltip => _tooltip;

    /// <summary>True when a non-null <see cref="Tooltip"/> (the alternate format) should be attached.</summary>
    public bool HasTooltip => _tooltip is not null;

    /// <summary>Which branch is rendered (empty / rendered) — the surface's honest state union.</summary>
    public TimeStampRenderState State => _state;

    /// <summary>The mode actually applied after the default fallback (web <c>in ?? tz_display_default ?? 'vehicle'</c>).</summary>
    public TimeStampTzMode EffectiveMode => _effectiveMode;

    /// <summary>The concrete tier actually shown in the body after resolving <c>auto</c> against the preference (web <c>effective</c>).</summary>
    public TimeStampFormat EffectiveFormat => _effectiveFormat;

    /// <summary>The resolved zone id the formatters render in (web <c>useDateFormat().tz</c>).</summary>
    public string ResolvedZoneId => _resolvedZoneId;

    /// <summary>The Narrator name for the surface — the visible primary text (web <c>&lt;span&gt;</c> body).</summary>
    public string AccessibleName => _display;

    /// <summary>Re-sample the clock and recompute every projection (the analogue of a web re-render so "Nm ago" advances).</summary>
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

        TimeStampRenderState state = _value.HasValue ? TimeStampRenderState.Rendered : TimeStampRenderState.Empty;
        TimeStampTzMode effectiveMode = _mode ?? _context.DefaultMode;
        TimeStampFormat effectiveFormat = TimeStampFormatting.ResolveEffectiveFormat(_format, _context.FormatPreference);

        string resolvedZoneId = TimeStampFormatting.ResolveZoneId(
            effectiveMode,
            _context.VehicleTimezone,
            _context.UserTimezone,
            _systemZone.Id);
        TimeZoneInfo zone = TimeStampFormatting.ResolveZone(resolvedZoneId, _systemZone);
        CultureInfo culture = TimeStampFormatting.ResolveLocale(_context.Locale);

        string display;
        string? tooltip;

        if (_value is { } instant)
        {
            string absolute = TimeStampFormatting.FormatAbsolute(instant, zone, culture);
            string relative = TimeStampFormatting.FormatRelative(instant, now, zone, culture);

            // Body shows the primary; the tooltip always shows the OTHER format (web primary / secondary).
            if (effectiveFormat == TimeStampFormat.Relative)
            {
                display = relative;
                tooltip = absolute;
            }
            else
            {
                display = absolute;
                tooltip = relative;
            }
        }
        else
        {
            display = TimeStampFormatting.EmptyDisplay;
            tooltip = null;
        }

        bool hadTooltip = HasTooltip;

        SetField(ref _display, display, nameof(Display), nameof(AccessibleName));
        SetTooltip(tooltip);
        if (hadTooltip != HasTooltip)
        {
            Raise(nameof(HasTooltip));
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

        if (_effectiveFormat != effectiveFormat)
        {
            _effectiveFormat = effectiveFormat;
            Raise(nameof(EffectiveFormat));
        }

        if (!string.Equals(_resolvedZoneId, resolvedZoneId, StringComparison.Ordinal))
        {
            _resolvedZoneId = resolvedZoneId;
            Raise(nameof(ResolvedZoneId));
        }
    }

    private void SetTooltip(string? value)
    {
        if (string.Equals(_tooltip, value, StringComparison.Ordinal))
        {
            return;
        }

        _tooltip = value;
        Raise(nameof(Tooltip));
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
