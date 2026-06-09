using System.ComponentModel;
using System.Globalization;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// PII-safe diagnostics for the timestamp surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never the user's input or any converted
/// value, which can carry arbitrary user-supplied data. Thread-safe.
/// </summary>
public sealed class TimestampToolDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public TimestampToolDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=TimestampTool</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={TimestampToolRegistration.Slug}");
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="TimestampTool"/> view — the native port of the
/// web component's <c>useState</c> (<c>unix</c>, <c>iso</c>, <c>now</c>) + <c>useMemo</c> (<c>fromUnix</c>,
/// <c>fromIso</c>) composition in web/src/features/admin/components/devtools/tools/TimestampTool.tsx.
/// Setting <see cref="Unix"/> / <see cref="Iso"/> recomputes that field's projection through the pure
/// <see cref="TimestampConverter"/>; advancing <see cref="Now"/> (driven by the view's one-second timer, the
/// analogue of the web <c>setInterval</c>) refreshes the live row and the relative-time labels. Every
/// user-facing string and Narrator name resolves through the injected <see cref="ILocalizer"/>. The
/// month-name / AM-PM rendering and the local-zone conversion use the injected
/// <see cref="CultureInfo"/> / <see cref="TimeZoneInfo"/> (the app passes the user's current culture and
/// local zone; tests pin both for determinism). Drive it from one confinement (the UI thread); it is not
/// internally synchronised.
/// </summary>
public sealed class TimestampToolViewModel : INotifyPropertyChanged
{
    private readonly ILocalizer _localizer;
    private readonly CultureInfo _culture;
    private readonly TimeZoneInfo _zone;

    private DateTimeOffset _now;
    private string _unix = string.Empty;
    private string _iso = string.Empty;

    private TimestampFieldState _unixState = TimestampFieldState.Empty;
    private string _unixIso = string.Empty;
    private string _unixLocal = string.Empty;
    private string _unixRelative = string.Empty;

    private TimestampFieldState _isoState = TimestampFieldState.Empty;
    private string _isoUnix = string.Empty;
    private string _isoLocal = string.Empty;
    private string _isoRelative = string.Empty;

    /// <summary>Creates the holder over its localizer and the (optional) culture + zone the display strings render in.</summary>
    public TimestampToolViewModel(ILocalizer localizer, CultureInfo? culture = null, TimeZoneInfo? zone = null)
    {
        _localizer = localizer ?? throw new ArgumentNullException(nameof(localizer));
        _culture = culture ?? CultureInfo.CurrentCulture;
        _zone = zone ?? TimeZoneInfo.Local;
        _now = DateTimeOffset.UtcNow;

        RecomputeUnix();
        RecomputeIso();
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The reference instant for the live row + relative labels (web <c>now</c> state, ticked every second).</summary>
    public DateTimeOffset Now
    {
        get => _now;
        set
        {
            if (_now == value)
            {
                return;
            }

            _now = value;
            Raise(nameof(Now));
            Raise(nameof(NowUnixText));
            Raise(nameof(NowIsoText));

            // The relative-time labels are computed against `now`, so they refresh on each tick.
            RecomputeUnix();
            RecomputeIso();
        }
    }

    /// <summary>The raw Unix-timestamp input text; reassigning re-runs that field's conversion.</summary>
    public string Unix
    {
        get => _unix;
        set
        {
            string next = value ?? string.Empty;
            if (string.Equals(_unix, next, StringComparison.Ordinal))
            {
                return;
            }

            _unix = next;
            Raise(nameof(Unix));
            RecomputeUnix();
        }
    }

    /// <summary>The raw ISO-timestamp input text; reassigning re-runs that field's conversion.</summary>
    public string Iso
    {
        get => _iso;
        set
        {
            string next = value ?? string.Empty;
            if (string.Equals(_iso, next, StringComparison.Ordinal))
            {
                return;
            }

            _iso = next;
            Raise(nameof(Iso));
            RecomputeIso();
        }
    }

    /// <summary>The live Unix-seconds reading (web <c>Math.floor(now.getTime() / 1000)</c>).</summary>
    public string NowUnixText => TimestampConverter.ToUnixSeconds(_now).ToString(CultureInfo.InvariantCulture);

    /// <summary>The live ISO reading (web <c>now.toISOString()</c>).</summary>
    public string NowIsoText => TimestampConverter.ToIsoString(_now);

    /// <summary>The Unix field's current state (empty / valid / invalid).</summary>
    public TimestampFieldState UnixState => _unixState;

    /// <summary>True when the Unix conversion block should render (web truthy <c>fromUnix</c>).</summary>
    public bool HasUnixResult => _unixState == TimestampFieldState.Valid;

    /// <summary>The Unix field's derived ISO value (web <c>fromUnix.toISOString()</c>).</summary>
    public string UnixIsoText => _unixIso;

    /// <summary>The Unix field's derived local value (web <c>formatDateTime(fromUnix)</c>).</summary>
    public string UnixLocalText => _unixLocal;

    /// <summary>The Unix field's derived relative value (web <c>getRelativeTime(fromUnix)</c>).</summary>
    public string UnixRelativeText => _unixRelative;

    /// <summary>The ISO field's current state (empty / valid / invalid).</summary>
    public TimestampFieldState IsoState => _isoState;

    /// <summary>True when the ISO conversion block should render (web truthy <c>fromIso</c>).</summary>
    public bool HasIsoResult => _isoState == TimestampFieldState.Valid;

    /// <summary>The ISO field's derived Unix value (web <c>Math.floor(fromIso.getTime() / 1000)</c>).</summary>
    public string IsoUnixText => _isoUnix;

    /// <summary>The ISO field's derived local value (web <c>formatDateTime(fromIso)</c>).</summary>
    public string IsoLocalText => _isoLocal;

    /// <summary>The ISO field's derived relative value (web <c>getRelativeTime(fromIso)</c>).</summary>
    public string IsoRelativeText => _isoRelative;

    /// <summary>Localized card title (web <c>t('Timestamp')</c>).</summary>
    public string Title => TimestampToolRegistration.Name(_localizer);

    /// <summary>Localized card description (web <c>t('Timestamp Desc')</c>).</summary>
    public string Description => TimestampToolRegistration.Description(_localizer);

    /// <summary>Localized "Now" button label (web <c>t('Now')</c>).</summary>
    public string NowLabel => _localizer.GetString("Now", "Now");

    /// <summary>Localized Unix input label (web <c>t('Unix Timestamp')</c>).</summary>
    public string UnixInputLabel => _localizer.GetString("Unix Timestamp", "Unix Timestamp");

    /// <summary>Localized ISO input label (web <c>t('Iso Timestamp')</c>).</summary>
    public string IsoInputLabel => _localizer.GetString("Iso Timestamp", "Iso Timestamp");

    /// <summary>Localized "Iso" row label in the Unix block (web <c>t('Iso')</c>).</summary>
    public string IsoLabel => _localizer.GetString("Iso", "Iso");

    /// <summary>Localized "Local" row label in both blocks (web <c>t('Local')</c>).</summary>
    public string LocalLabel => _localizer.GetString("Local", "Local");

    /// <summary>Localized "Relative" row label in both blocks (web <c>t('Relative')</c>).</summary>
    public string RelativeLabel => _localizer.GetString("Relative", "Relative");

    /// <summary>Localized "Unix" row label in the ISO block (web <c>t('Unix')</c>).</summary>
    public string UnixLabel => _localizer.GetString("Unix", "Unix");

    /// <summary>Narrator name for the "Now" button.</summary>
    public string NowAccessibleName => NowLabel;

    /// <summary>Narrator name for the Unix input field.</summary>
    public string UnixInputAccessibleName => UnixInputLabel;

    /// <summary>Narrator name for the ISO input field.</summary>
    public string IsoInputAccessibleName => IsoInputLabel;

    private void RecomputeUnix()
    {
        TimestampFieldState state;
        string iso = string.Empty;
        string local = string.Empty;
        string relative = string.Empty;

        if (string.IsNullOrEmpty(_unix))
        {
            state = TimestampFieldState.Empty;
        }
        else if (TimestampConverter.ParseUnix(_unix) is { } instant)
        {
            state = TimestampFieldState.Valid;
            iso = TimestampConverter.ToIsoString(instant);
            local = TimestampConverter.FormatLocal(instant, _zone, _culture);
            relative = TimestampConverter.GetRelativeTime(instant, _now);
        }
        else
        {
            state = TimestampFieldState.Invalid;
        }

        bool hadResult = HasUnixResult;
        bool stateChanged = _unixState != state;
        _unixState = state;

        if (stateChanged)
        {
            Raise(nameof(UnixState));
        }

        if (hadResult != HasUnixResult)
        {
            Raise(nameof(HasUnixResult));
        }

        SetField(ref _unixIso, iso, nameof(UnixIsoText));
        SetField(ref _unixLocal, local, nameof(UnixLocalText));
        SetField(ref _unixRelative, relative, nameof(UnixRelativeText));
    }

    private void RecomputeIso()
    {
        TimestampFieldState state;
        string unix = string.Empty;
        string local = string.Empty;
        string relative = string.Empty;

        if (string.IsNullOrEmpty(_iso))
        {
            state = TimestampFieldState.Empty;
        }
        else if (TimestampConverter.ParseIso(_iso) is { } instant)
        {
            state = TimestampFieldState.Valid;
            unix = TimestampConverter.ToUnixSeconds(instant).ToString(CultureInfo.InvariantCulture);
            local = TimestampConverter.FormatLocal(instant, _zone, _culture);
            relative = TimestampConverter.GetRelativeTime(instant, _now);
        }
        else
        {
            state = TimestampFieldState.Invalid;
        }

        bool hadResult = HasIsoResult;
        bool stateChanged = _isoState != state;
        _isoState = state;

        if (stateChanged)
        {
            Raise(nameof(IsoState));
        }

        if (hadResult != HasIsoResult)
        {
            Raise(nameof(HasIsoResult));
        }

        SetField(ref _isoUnix, unix, nameof(IsoUnixText));
        SetField(ref _isoLocal, local, nameof(IsoLocalText));
        SetField(ref _isoRelative, relative, nameof(IsoRelativeText));
    }

    private void SetField(ref string field, string value, string propertyName)
    {
        if (string.Equals(field, value, StringComparison.Ordinal))
        {
            return;
        }

        field = value;
        Raise(propertyName);
    }

    private void Raise(string propertyName) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
}
