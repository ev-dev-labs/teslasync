using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>LiveLogsPage</c> view — the native port of the web page's
/// data flow (web/src/features/admin/pages/LiveLogsPage.tsx + web/src/api/hooks/useLogStream.ts). It owns the
/// URL/local-state equivalent (minimum level, applied grep + grep draft, client-side vehicle filter, paused /
/// auto-scroll / enabled flags) and the rolling client-side buffer (capped at
/// <see cref="LiveLogsProjection.LogStreamMaxEvents"/>, web <c>LOG_STREAM_MAX_EVENTS</c>), the connection state,
/// the dropped/received counters, and projects the result through <see cref="LiveLogsProjection"/> so the view
/// is a thin renderer. The view subscribes to the <see cref="ILiveLogFeed"/>, marshals each event onto the UI
/// thread and feeds it here (<see cref="AppendEvent"/> / <see cref="SetConnected"/> / <see cref="RecordDrops"/>
/// / <see cref="SetError"/>); a server-side filter change raises <see cref="StreamRequestChanged"/> so the view
/// restarts the subscription (web effect re-run). Drive it from one confinement (the UI thread) — it is not
/// internally synchronised. Observable via <see cref="PropertyChanged"/>.
/// </summary>
public sealed class LiveLogsPageViewModel : INotifyPropertyChanged
{
    private readonly ILocalizer _localizer;
    private readonly LiveLogsDiagnostics _diagnostics;
    private readonly int _bufferMax;
    private readonly List<LogStreamEvent> _events = [];

    private LogStreamLevel _level = LogStreamLevel.Info;
    private string _grep = string.Empty;
    private string _grepDraft = string.Empty;
    private string _vehicleFilter = string.Empty;
    private bool _paused;
    private bool _autoscroll = true;
    private bool _enabled = true;
    private bool _connected;
    private string? _errorDetail;
    private int _drops;
    private long _totalReceived;

    private LiveLogsDisplay _display;

    /// <summary>Creates the holder over its localizer and (optional) diagnostics / buffer cap.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    /// <param name="bufferMax">The rolling-buffer cap (web <c>LOG_STREAM_MAX_EVENTS</c>); defaults to 1000.</param>
    public LiveLogsPageViewModel(
        ILocalizer localizer,
        LiveLogsDiagnostics? diagnostics = null,
        int bufferMax = LiveLogsProjection.LogStreamMaxEvents)
    {
        System.ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new LiveLogsDiagnostics();
        _bufferMax = bufferMax > 0 ? bufferMax : LiveLogsProjection.LogStreamMaxEvents;
        _display = LiveLogsProjection.Project(BuildModel(), _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised when the server-side filter (level / grep / enabled / reconnect) changes so the view re-subscribes.</summary>
    public event System.Action? StreamRequestChanged;

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public LiveLogsDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>The localized page title (web <c>liveLogs.title</c>).</summary>
    public string Title => LiveLogsRegistration.Title(_localizer);

    /// <summary>The localized page subtitle (web <c>liveLogs.subtitle</c>).</summary>
    public string Subtitle => LiveLogsRegistration.Subtitle(_localizer);

    /// <summary>Whether the stream is enabled (web <c>enabled</c>); false tears the subscription down.</summary>
    public bool Enabled => _enabled;

    /// <summary>Whether auto-scroll keeps the newest row in view (web local <c>autoscroll</c>).</summary>
    public bool IsAutoscroll => _autoscroll;

    /// <summary>The current server-side subscription request (web <c>level</c> + applied <c>grep</c>).</summary>
    public LogStreamRequest CurrentRequest => new(_level, _grep);

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    // ---- feed -> view-model (marshalled onto the UI thread by the view) ----------------------------------

    /// <summary>
    /// Append one decoded <c>log</c> event (web feed <c>case 'log'</c> + <c>flushPending</c>): when not paused,
    /// add it to the rolling buffer, evict oldest beyond the cap, and bump the received counter. A paused tail
    /// drops the event entirely (web <c>if (pausedRef.current) break</c>) — neither buffered nor counted.
    /// </summary>
    public void AppendEvent(LogStreamEvent ev)
    {
        System.ArgumentNullException.ThrowIfNull(ev);

        if (_paused)
        {
            return;
        }

        _events.Add(ev);
        if (_events.Count > _bufferMax)
        {
            _events.RemoveRange(0, _events.Count - _bufferMax);
        }

        _totalReceived++;
        Reproject();
    }

    /// <summary>Mark the SSE connection state (web <c>setIsConnected</c>).</summary>
    public void SetConnected(bool connected)
    {
        if (_connected == connected)
        {
            return;
        }

        _connected = connected;
        Reproject();
    }

    /// <summary>Add to the server-drop counter (web feed <c>case 'drop'</c> -> <c>setDrops</c>).</summary>
    public void RecordDrops(int count)
    {
        if (count <= 0)
        {
            return;
        }

        _drops += count;
        Reproject();
    }

    /// <summary>Set or clear the connection error (web <c>setError</c>); a non-empty message shows the error panel.</summary>
    public void SetError(string? detail)
    {
        string? normalized = string.IsNullOrEmpty(detail) ? null : detail;
        if (string.Equals(_errorDetail, normalized, System.StringComparison.Ordinal))
        {
            return;
        }

        _errorDetail = normalized;
        Reproject();
    }

    // ---- user controls -> view-model ---------------------------------------------------------------------

    /// <summary>Set the minimum-level filter (web <c>setLevel</c>); restarts the server-side subscription.</summary>
    public void SetLevel(LogStreamLevel level)
    {
        if (_level == level)
        {
            return;
        }

        _level = level;
        Reproject();
        StreamRequestChanged?.Invoke();
    }

    /// <summary>Update the grep draft text as the operator types (web <c>setGrepDraft</c>); no reconnect yet.</summary>
    public void SetGrepDraft(string? grep)
    {
        string next = grep ?? string.Empty;
        if (string.Equals(_grepDraft, next, System.StringComparison.Ordinal))
        {
            return;
        }

        _grepDraft = next;
        Reproject();
    }

    /// <summary>Commit the grep draft (web <c>applyGrep</c> on Enter/blur); restarts the server-side subscription.</summary>
    public void ApplyGrep()
    {
        if (string.Equals(_grep, _grepDraft, System.StringComparison.Ordinal))
        {
            return;
        }

        _grep = _grepDraft;
        Reproject();
        StreamRequestChanged?.Invoke();
    }

    /// <summary>Set the client-side vehicle-id filter (web <c>setVehicleFilter</c>); applied to the current buffer.</summary>
    public void SetVehicleFilter(string? vehicleId)
    {
        string next = (vehicleId ?? string.Empty).Trim();
        if (string.Equals(_vehicleFilter, next, System.StringComparison.Ordinal))
        {
            return;
        }

        _vehicleFilter = next;
        Reproject();
    }

    /// <summary>Toggle the buffer pause state (web pause button).</summary>
    public void TogglePaused() => SetPaused(!_paused);

    /// <summary>Set the buffer pause state (web <c>setPaused</c>): the stream stays open, appending stops.</summary>
    public void SetPaused(bool paused)
    {
        if (_paused == paused)
        {
            return;
        }

        _paused = paused;
        Reproject();
    }

    /// <summary>Toggle auto-scroll (web auto-scroll toggle).</summary>
    public void ToggleAutoscroll() => SetAutoscroll(!_autoscroll);

    /// <summary>Set auto-scroll (web local <c>setAutoscroll</c>).</summary>
    public void SetAutoscroll(bool autoscroll)
    {
        if (_autoscroll == autoscroll)
        {
            return;
        }

        _autoscroll = autoscroll;
        Reproject();
    }

    /// <summary>Drop the in-memory buffer and reset the dropped/received counters (web <c>clear</c>).</summary>
    public void Clear()
    {
        if (_events.Count == 0 && _drops == 0 && _totalReceived == 0)
        {
            return;
        }

        _events.Clear();
        _drops = 0;
        _totalReceived = 0;
        Reproject();
    }

    /// <summary>
    /// Force a fresh connection (web <c>handleReconnect</c>: enabled false → true): clears any prior error,
    /// re-enables the stream and raises <see cref="StreamRequestChanged"/> so the view restarts the subscription.
    /// </summary>
    public void Reconnect()
    {
        _errorDetail = null;
        _enabled = true;
        Reproject();
        StreamRequestChanged?.Invoke();
    }

    /// <summary>Enable or disable the stream (web <c>setEnabled</c>); disabling tears the subscription down.</summary>
    public void SetEnabled(bool enabled)
    {
        if (_enabled == enabled)
        {
            return;
        }

        _enabled = enabled;
        if (!enabled)
        {
            _connected = false;
        }

        Reproject();
        StreamRequestChanged?.Invoke();
    }

    // ---- download (web handleDownload) -------------------------------------------------------------------

    /// <summary>The current vehicle-filtered buffer the download / table render from (web <c>filteredEvents</c>).</summary>
    public IReadOnlyList<LogStreamEvent> FilteredEvents() => LiveLogsFilter.Apply(_events, _vehicleFilter);

    /// <summary>The newline-joined download body for the visible buffer (web <c>handleDownload</c> blob).</summary>
    public string BuildDownloadText() => LiveLogsExport.BuildText(FilteredEvents());

    /// <summary>The suggested download file name from the localized template (web <c>downloadFilename</c>).</summary>
    public string DownloadFileName(System.DateTimeOffset now) => LiveLogsExport.FileName(_display.FileNameTemplate, now);

    /// <summary>Re-resolve every localized label after a runtime language change (web i18n re-render).</summary>
    public void Refresh()
    {
        Reproject();
        OnPropertyChanged(nameof(Title));
        OnPropertyChanged(nameof(Subtitle));
    }

    private LiveLogsModel BuildModel() => new(
        Level: _level,
        Grep: _grep,
        GrepDraft: _grepDraft,
        VehicleFilter: _vehicleFilter,
        Paused: _paused,
        Autoscroll: _autoscroll,
        Enabled: _enabled,
        Events: _events,
        Connected: _connected,
        ErrorDetail: _errorDetail,
        Drops: _drops,
        TotalReceived: _totalReceived);

    private void Reproject() => Display = LiveLogsProjection.Project(BuildModel(), _localizer);

    private void OnPropertyChanged(string name) => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));

    private void Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return;
        }

        field = value;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
    }
}
