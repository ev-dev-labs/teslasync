using System.ComponentModel;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="FormatterPrefsBridge"/> view — the native port of
/// the web <c>FormatterPrefsBridge</c> component body (web/src/components/FormatterPrefsBridge.tsx). The web
/// component renders <see langword="null"/>; its entire job is two effects, reproduced here one-for-one:
/// <list type="number">
///   <item><b>Apply on resolve.</b> When the settings query resolves (<see cref="IFormatterPrefsSource.Changed"/>),
///     it pushes the resolved locale + precision into the formatter globals
///     (<see cref="IFormatterPrefsStore"/>) with the web effect's exact de-dupe: write a value only when it
///     differs from both the last value this bridge applied and the current global, otherwise just record the
///     first observed value without a redundant write (web <c>lastLocale</c> / <c>lastDecimals</c> refs +
///     <c>getGlobalLocale()</c> / <c>getGlobalPrecision()</c> guards). A null source <c>Current</c> applies
///     nothing — the web <c>if (!settings) return</c>.</item>
///   <item><b>Refetch on broadcast.</b> When a settings-changed broadcast arrives
///     (<see cref="ISettingsChangeSignal.SettingsChanged"/>), it forces a settings refetch
///     (<see cref="IFormatterPrefsSource.Refresh"/>) so effect 1 re-runs against fresh data — the web
///     <c>subscribe(TOPICS.SETTINGS_CHANGED) → queryClient.invalidateQueries(['settings'])</c>.</item>
/// </list>
/// The store defaults to the process-wide <see cref="FormatterPrefsStore.Shared"/> (the web <c>numberFormat</c>
/// module singleton); an injected store isolates the bridge under test. The bridge has no visible output, no
/// titles/labels/i18n keys and no loading / empty / error / stale / offline chrome — exactly like the web source,
/// which is a side-effect-only mount returning <see langword="null"/>; its only branches are the resolved /
/// unresolved settings states the web effects key on. Drive it from one confinement (the UI thread); the view
/// marshals source callbacks. <see cref="Dispose"/> unsubscribes (the web effect cleanups).
/// </summary>
public sealed class FormatterPrefsBridgeViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IFormatterPrefsSource _source;
    private readonly IFormatterPrefsStore _store;
    private readonly ISettingsChangeSignal? _signal;
    private string? _lastLocale;
    private int? _lastPrecision;
    private bool _disposed;

    /// <summary>Creates the bridge over its settings seam, the formatter globals and an optional broadcast seam.</summary>
    /// <param name="source">The settings state-holder seam (web <c>useSettings</c> query); supplies the resolved snapshot.</param>
    /// <param name="store">The formatter globals to keep in sync; defaults to <see cref="FormatterPrefsStore.Shared"/>.</param>
    /// <param name="signal">
    /// The optional settings-changed broadcast seam (web <c>subscribe(TOPICS.SETTINGS_CHANGED)</c>); when present,
    /// a raised signal forces a refetch. A bridge wired without one simply omits the defense-in-depth path.
    /// </param>
    /// <exception cref="ArgumentNullException">The source is null.</exception>
    public FormatterPrefsBridgeViewModel(
        IFormatterPrefsSource source,
        IFormatterPrefsStore? store = null,
        ISettingsChangeSignal? signal = null)
    {
        ArgumentNullException.ThrowIfNull(source);

        _source = source;
        _store = store ?? FormatterPrefsStore.Shared;
        _signal = signal;

        _source.Changed += OnSourceChanged;
        if (_signal is not null)
        {
            _signal.SettingsChanged += OnSettingsChanged;
        }

        // Apply whatever has already resolved (the web effect running on mount with the current query data).
        ApplyFromSource();
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The canonical surface slug (<c>FormatterPrefsBridge</c>).</summary>
    public static string Slug => FormatterPrefsBridgeRegistration.Slug;

    /// <summary>The formatter globals this bridge keeps in sync (exposed for hosting / diagnostics / tests).</summary>
    public IFormatterPrefsStore Store => _store;

    /// <summary>The current global locale the bridge has applied (web <c>getGlobalLocale()</c>).</summary>
    public string CurrentLocale => _store.Locale;

    /// <summary>The current global precision the bridge has applied (web <c>getGlobalPrecision()</c>).</summary>
    public int CurrentPrecision => _store.Precision;

    /// <summary>
    /// Force a settings refetch — the native analogue of the web broadcast handler calling
    /// <c>queryClient.invalidateQueries(['settings'])</c>. Invoked by the broadcast seam, and callable directly
    /// by a host that wants to trigger the defense-in-depth path. A no-op once disposed.
    /// </summary>
    public void NotifySettingsChanged()
    {
        if (_disposed)
        {
            return;
        }

        _source.Refresh();
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _source.Changed -= OnSourceChanged;
        if (_signal is not null)
        {
            _signal.SettingsChanged -= OnSettingsChanged;
        }

        GC.SuppressFinalize(this);
    }

    private void OnSourceChanged(object? sender, EventArgs e) => ApplyFromSource();

    private void OnSettingsChanged(object? sender, EventArgs e) => NotifySettingsChanged();

    private void ApplyFromSource()
    {
        if (_disposed)
        {
            return;
        }

        // web: `if (!settings) return` — nothing resolved yet, so apply nothing.
        if (_source.Current is { } snapshot)
        {
            Apply(snapshot);
        }
    }

    private void Apply(FormatterPrefsSnapshot snapshot)
    {
        // web locale branch: write only when the resolved locale differs from both the last applied value and
        // the current global; otherwise record the first observed value without a redundant write.
        var locale = snapshot.Locale;
        if (!string.Equals(locale, _lastLocale, StringComparison.Ordinal)
            && !string.Equals(locale, _store.Locale, StringComparison.Ordinal))
        {
            _store.Locale = locale;
            _lastLocale = locale;
            PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(CurrentLocale)));
        }
        else if (_lastLocale is null)
        {
            _lastLocale = locale;
        }

        // web precision branch: the requested value is compared (and recorded) verbatim, while the store clamps
        // it to 0..20 on write — exactly as the web compares `decimals` but clamps inside setGlobalPrecision.
        var precision = snapshot.Precision;
        if (precision != _lastPrecision && precision != _store.Precision)
        {
            _store.Precision = precision;
            _lastPrecision = precision;
            PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(CurrentPrecision)));
        }
        else if (_lastPrecision is null)
        {
            _lastPrecision = precision;
        }
    }
}
