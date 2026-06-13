using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.ModalsDialogs;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="PlaybackControls"/> view — the native port of the web
/// component body (web/src/components/data-display/PlaybackControls.tsx L83-L417). It mirrors the web source's
/// behaviour exactly:
/// <list type="bullet">
///   <item>the controlled <see cref="IsPlaying"/> / <see cref="Speed"/> / <see cref="Progress"/> /
///   <see cref="Elapsed"/> / <see cref="Total"/> / <see cref="DurationMs"/> "props" drive the projected
///   play/pause affordance, the <see cref="TimeText"/> read-out (web <c>{elapsed} / {total}</c>) and the seek
///   maths;</item>
///   <item><see cref="PlayPause"/> / <see cref="Reset"/> / <see cref="Stop"/> reproduce the button row (web
///   <c>onClick={isPlaying ? onPause : onPlay}</c> and the two <c>onStop</c> buttons) — they announce through the
///   transport seam and never toast, exactly like a web button click;</item>
///   <item><see cref="NotifySpeedChanged"/> / <see cref="NotifySeek"/> relay the embedded speed-menu and scrubber
///   changes up through the transport seam (web child <c>onChange</c> / <c>onSeek</c>);</item>
///   <item><see cref="HandleShortcut"/> reproduces the keyboard <c>keydown</c> switch (web L148-L238): the same
///   seek-by-seconds, frame-step, jump-to-start/end, jump-to-N\u00D710% and speed step/stepping branches, each setting
///   the inline <see cref="CurrentToast"/> feedback (web <c>showShortcutToast</c>);</item>
///   <item><see cref="RegisterShortcuts"/> / <see cref="UnregisterShortcuts"/> declare the route-scoped cheatsheet
///   into the registry for its lifetime (web <c>useShortcut(replayShortcutDefs)</c>).</item>
/// </list>
/// Every transport action is announced through the <see cref="IPlaybackTransportSink"/>; assigning the controlled
/// props (the parent's echo after a callback fires) re-renders without re-announcing. The view binds the projected
/// values and never performs I/O. Drive it from one confinement (the UI thread); it is not internally
/// synchronised.
/// </summary>
public sealed class PlaybackControlsViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IPlaybackTransportSink _transport;
    private readonly ILocalizer _localizer;
    private readonly IShortcutRegistry _shortcuts;
    private readonly List<string> _registeredIds = new();

    private bool _isPlaying;
    private int _speed;
    private double _progress;
    private string _elapsed = string.Empty;
    private string _total = string.Empty;
    private double? _durationMs;
    private bool _enableKeyboardShortcuts;
    private string? _toast;
    private long _toastSequence;
    private bool _disposed;

    /// <summary>Creates the holder over its transport seam, the i18n facade, the shortcut registry and an initial speed.</summary>
    /// <param name="transport">The transport seam (web callback props); pass <see cref="NoOpPlaybackTransportSink.Instance"/> when none is wired.</param>
    /// <param name="localizer">The i18n facade the accessible names + cheatsheet copy resolve through.</param>
    /// <param name="shortcuts">The keyboard-shortcut registry (web <c>useShortcut</c> store).</param>
    /// <param name="initialSpeed">The initial speed (web <c>speed</c> prop); stored as supplied.</param>
    public PlaybackControlsViewModel(
        IPlaybackTransportSink transport,
        ILocalizer localizer,
        IShortcutRegistry shortcuts,
        int initialSpeed = 1)
    {
        ArgumentNullException.ThrowIfNull(transport);
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(shortcuts);

        _transport = transport;
        _localizer = localizer;
        _shortcuts = shortcuts;
        _speed = initialSpeed;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    // ── controlled props (web props) ───────────────────────────────────────────────────────────────────────

    /// <summary>Whether playback is running (web <c>isPlaying</c> prop): toggles the Play/Pause affordance.</summary>
    public bool IsPlaying
    {
        get => _isPlaying;
        set
        {
            if (_isPlaying == value)
            {
                return;
            }

            _isPlaying = value;
            Raise(nameof(IsPlaying));
            Raise(nameof(PlayPauseAccessibleName));
        }
    }

    /// <summary>The current replay speed (web <c>speed</c> prop); echoed down to the embedded speed menu.</summary>
    public int Speed
    {
        get => _speed;
        set
        {
            if (_speed == value)
            {
                return;
            }

            _speed = value;
            Raise(nameof(Speed));
        }
    }

    /// <summary>The playhead position 0..1 (web <c>progress</c> prop); echoed down to the embedded scrubber.</summary>
    public double Progress
    {
        get => _progress;
        set
        {
            if (_progress.Equals(value))
            {
                return;
            }

            _progress = value;
            Raise(nameof(Progress));
        }
    }

    /// <summary>The pre-formatted elapsed time, e.g. <c>1:23</c> (web <c>elapsed</c> prop).</summary>
    public string Elapsed
    {
        get => _elapsed;
        set
        {
            string next = value ?? string.Empty;
            if (string.Equals(_elapsed, next, StringComparison.Ordinal))
            {
                return;
            }

            _elapsed = next;
            Raise(nameof(Elapsed));
            Raise(nameof(TimeText));
        }
    }

    /// <summary>The pre-formatted total time, e.g. <c>5:10</c> (web <c>total</c> prop).</summary>
    public string Total
    {
        get => _total;
        set
        {
            string next = value ?? string.Empty;
            if (string.Equals(_total, next, StringComparison.Ordinal))
            {
                return;
            }

            _total = next;
            Raise(nameof(Total));
            Raise(nameof(TimeText));
        }
    }

    /// <summary>The total duration in milliseconds, or null (web <c>durationMs</c> prop); drives the seek-by-seconds maths.</summary>
    public double? DurationMs
    {
        get => _durationMs;
        set
        {
            if (Nullable.Equals(_durationMs, value))
            {
                return;
            }

            _durationMs = value;
            Raise(nameof(DurationMs));
            Raise(nameof(DurationSeconds));
        }
    }

    /// <summary>
    /// Whether the page-scoped keyboard shortcuts + help affordance are active (web <c>enableKeyboardShortcuts</c>
    /// prop, off by default). Drives <see cref="ShowKeyboardHelp"/> and gates <see cref="HandleShortcut"/>.
    /// </summary>
    public bool EnableKeyboardShortcuts
    {
        get => _enableKeyboardShortcuts;
        set
        {
            if (_enableKeyboardShortcuts == value)
            {
                return;
            }

            _enableKeyboardShortcuts = value;
            Raise(nameof(EnableKeyboardShortcuts));
            Raise(nameof(ShowKeyboardHelp));
        }
    }

    // ── projections (web render) ───────────────────────────────────────────────────────────────────────────

    /// <summary>The combined time read-out (web <c>{elapsed} / {total}</c>).</summary>
    public string TimeText => $"{_elapsed} / {_total}";

    /// <summary>The drive duration in seconds the embedded scrubber consumes (web <c>durationMs ? durationMs / 1000 : 0</c>).</summary>
    public double DurationSeconds => _durationMs is { } ms && ms > 0 ? ms / 1000.0 : 0;

    /// <summary>Whether the keyboard-help affordance renders (web <c>{enableKeyboardShortcuts &amp;&amp; …}</c>).</summary>
    public bool ShowKeyboardHelp => _enableKeyboardShortcuts;

    /// <summary>The Reset button's accessible name (web <c>aria-label={t('replay.controls.reset', 'Reset')}</c>).</summary>
    public string ResetAccessibleName =>
        Localize(PlaybackControlsRegistration.ResetKey, PlaybackControlsRegistration.ResetFallback);

    /// <summary>The Play affordance's accessible name (web <c>t('replay.controls.play', 'Play')</c>).</summary>
    public string PlayAccessibleName =>
        Localize(PlaybackControlsRegistration.PlayKey, PlaybackControlsRegistration.PlayFallback);

    /// <summary>The Pause affordance's accessible name (web <c>t('replay.controls.pause', 'Pause')</c>).</summary>
    public string PauseAccessibleName =>
        Localize(PlaybackControlsRegistration.PauseKey, PlaybackControlsRegistration.PauseFallback);

    /// <summary>
    /// The Play/Pause button's current accessible name (web <c>aria-label={isPlaying ? t('…pause') : t('…play')}</c>).
    /// </summary>
    public string PlayPauseAccessibleName => _isPlaying ? PauseAccessibleName : PlayAccessibleName;

    /// <summary>The Stop button's accessible name (web <c>aria-label={t('replay.controls.stop', 'Stop')}</c>).</summary>
    public string StopAccessibleName =>
        Localize(PlaybackControlsRegistration.StopKey, PlaybackControlsRegistration.StopFallback);

    /// <summary>The keyboard-help trigger's accessible name (web <c>aria-label={t('replay.shortcuts.help', …)}</c>).</summary>
    public string HelpAccessibleName =>
        Localize(PlaybackControlsRegistration.HelpKey, PlaybackControlsRegistration.HelpFallback);

    /// <summary>The help body title (web <c>t('replay.shortcuts.title', 'Trip replay shortcuts')</c>).</summary>
    public string HelpTitle =>
        Localize(PlaybackControlsRegistration.HelpTitleKey, PlaybackControlsRegistration.HelpTitleFallback);

    /// <summary>The cheatsheet group label (web <c>t('shortcuts.groups.replay', 'Trip replay')</c>).</summary>
    public string GroupLabel =>
        Localize(PlaybackControlsRegistration.GroupKey, PlaybackControlsRegistration.GroupFallback);

    /// <summary>The seven help-body rows (web help grid L278-L293): kbd chip + localized description, in web order.</summary>
    public IReadOnlyList<PlaybackHelpEntry> HelpEntries => new[]
    {
        new PlaybackHelpEntry(PlaybackHelpKeyChips.PlayPause, Localize(PlaybackControlsRegistration.PlayPauseKey, PlaybackControlsRegistration.PlayPauseFallback)),
        new PlaybackHelpEntry(PlaybackHelpKeyChips.Skip, Localize(PlaybackControlsRegistration.Skip5Key, PlaybackControlsRegistration.Skip5Fallback)),
        new PlaybackHelpEntry(PlaybackHelpKeyChips.Skip10, Localize(PlaybackControlsRegistration.Skip10Key, PlaybackControlsRegistration.Skip10Fallback)),
        new PlaybackHelpEntry(PlaybackHelpKeyChips.Frame, Localize(PlaybackControlsRegistration.FrameKey, PlaybackControlsRegistration.FrameFallback)),
        new PlaybackHelpEntry(PlaybackHelpKeyChips.StartEnd, Localize(PlaybackControlsRegistration.StartEndKey, PlaybackControlsRegistration.StartEndFallback)),
        new PlaybackHelpEntry(PlaybackHelpKeyChips.Percent, Localize(PlaybackControlsRegistration.PercentKey, PlaybackControlsRegistration.PercentFallback)),
        new PlaybackHelpEntry(PlaybackHelpKeyChips.Speed, Localize(PlaybackControlsRegistration.SpeedKey, PlaybackControlsRegistration.SpeedFallback)),
    };

    /// <summary>The current inline shortcut-feedback toast label, or null when none is showing (web <c>shortcutToast</c>).</summary>
    public string? CurrentToast => _toast;

    /// <summary>
    /// A monotonically increasing counter bumped on every <see cref="SetToast"/> — the native analogue of the web
    /// <c>shortcutToast.id</c> (<c>Date.now()</c>). The view watches it so a repeated identical shortcut still
    /// restarts the display timer and re-announces, exactly as the web re-keys the toast on every keypress.
    /// </summary>
    public long ToastSequence => _toastSequence;

    // ── button commands (web onClick handlers — announce, never toast) ─────────────────────────────────────

    /// <summary>
    /// The Play/Pause button (web <c>onClick={isPlaying ? onPause : onPlay}</c>): announce pause when playing,
    /// otherwise play. Controlled — the parent echoes the new <see cref="IsPlaying"/> back; this never self-toggles.
    /// </summary>
    public void PlayPause()
    {
        if (_isPlaying)
        {
            _transport.Pause();
        }
        else
        {
            _transport.Play();
        }
    }

    /// <summary>The Reset button (web <c>onClick={onStop}</c> — rewind to the start).</summary>
    public void Reset() => _transport.StopPlayback();

    /// <summary>The Stop button (web <c>onClick={onStop}</c>).</summary>
    public void Stop() => _transport.StopPlayback();

    /// <summary>
    /// Relay an embedded speed-menu change up through the seam (web child <c>onChange={onSpeedChange}</c>). The
    /// embedded menu advances its own badge; the parent echoes <see cref="Speed"/> back.
    /// </summary>
    public void NotifySpeedChanged(int speed) => _transport.SpeedChange(speed);

    /// <summary>
    /// Relay an embedded scrubber seek up through the seam (web child <c>onSeek={onSeek}</c>). The parent echoes
    /// <see cref="Progress"/> back.
    /// </summary>
    public void NotifySeek(double progress) => _transport.Seek(progress);

    // ── keyboard shortcuts (web keydown switch) ────────────────────────────────────────────────────────────

    /// <summary>
    /// Interpret a recognized shortcut key (web <c>keydown</c> switch L148-L238) when shortcuts are enabled:
    /// perform the transport action, set the inline <see cref="CurrentToast"/> feedback and report whether the key
    /// was consumed (so the view sets <c>e.Handled</c>). Returns false — leaving the key unhandled — when shortcuts
    /// are disabled, the key is unrecognized, or a frame-step key is pressed with no frame-step capability wired
    /// (web <c>if (onStepFrame)</c>).
    /// </summary>
    /// <param name="key">The recognized shortcut key the view mapped from a platform key.</param>
    /// <param name="shift">Whether Shift was held (web <c>e.shiftKey</c>) — widens ±5s to ±30s.</param>
    public bool HandleShortcut(PlaybackShortcutKey key, bool shift)
    {
        if (!_enableKeyboardShortcuts || key == PlaybackShortcutKey.None)
        {
            return false;
        }

        switch (key)
        {
            case PlaybackShortcutKey.Space:
            case PlaybackShortcutKey.K:
                if (_isPlaying)
                {
                    _transport.Pause();
                }
                else
                {
                    _transport.Play();
                }

                SetToast(_isPlaying
                    ? Localize(PlaybackControlsRegistration.ToastPauseKey, PlaybackControlsRegistration.ToastPauseFallback)
                    : Localize(PlaybackControlsRegistration.ToastPlayKey, PlaybackControlsRegistration.ToastPlayFallback));
                return true;

            case PlaybackShortcutKey.ArrowLeft:
                SeekBySeconds(shift ? -30 : -5);
                return true;

            case PlaybackShortcutKey.ArrowRight:
                SeekBySeconds(shift ? 30 : 5);
                return true;

            case PlaybackShortcutKey.J:
                SeekBySeconds(-10);
                return true;

            case PlaybackShortcutKey.L:
                SeekBySeconds(10);
                return true;

            case PlaybackShortcutKey.Comma:
                if (!_transport.CanStepFrame)
                {
                    return false;
                }

                _transport.StepFrame(-1);
                SetToast(Localize(PlaybackControlsRegistration.ToastPrevFrameKey, PlaybackControlsRegistration.ToastPrevFrameFallback));
                return true;

            case PlaybackShortcutKey.Period:
                if (!_transport.CanStepFrame)
                {
                    return false;
                }

                _transport.StepFrame(1);
                SetToast(Localize(PlaybackControlsRegistration.ToastNextFrameKey, PlaybackControlsRegistration.ToastNextFrameFallback));
                return true;

            case PlaybackShortcutKey.Home:
                _transport.Seek(0);
                SetToast(Localize(PlaybackControlsRegistration.ToastStartKey, PlaybackControlsRegistration.ToastStartFallback));
                return true;

            case PlaybackShortcutKey.End:
                _transport.Seek(1);
                SetToast(Localize(PlaybackControlsRegistration.ToastEndKey, PlaybackControlsRegistration.ToastEndFallback));
                return true;

            case PlaybackShortcutKey.Plus:
                if (_transport.CanSpeedRelative)
                {
                    _transport.SpeedRelative(1);
                }
                else
                {
                    _transport.SpeedChange(PlaybackSpeeds.Shift(_speed, 1));
                }

                SetToast(Localize(PlaybackControlsRegistration.ToastSpeedUpKey, PlaybackControlsRegistration.ToastSpeedUpFallback));
                return true;

            case PlaybackShortcutKey.Minus:
                if (_transport.CanSpeedRelative)
                {
                    _transport.SpeedRelative(-1);
                }
                else
                {
                    _transport.SpeedChange(PlaybackSpeeds.Shift(_speed, -1));
                }

                SetToast(Localize(PlaybackControlsRegistration.ToastSpeedDownKey, PlaybackControlsRegistration.ToastSpeedDownFallback));
                return true;

            default:
                if (key >= PlaybackShortcutKey.Digit0 && key <= PlaybackShortcutKey.Digit9)
                {
                    int digit = key - PlaybackShortcutKey.Digit0;
                    double pct = digit / 10.0;
                    _transport.Seek(pct);
                    SetToast(PlaybackToastLabels.Percent(pct));
                    return true;
                }

                return false;
        }
    }

    /// <summary>Clear the inline toast (the view calls this when its display timer elapses; web <c>setShortcutToast(null)</c>).</summary>
    public void ClearToast()
    {
        if (_toast is null)
        {
            return;
        }

        _toast = null;
        Raise(nameof(CurrentToast));
    }

    // ── shortcut registry (web useShortcut) ────────────────────────────────────────────────────────────────

    /// <summary>
    /// Declare the route-scoped cheatsheet into the registry (web <c>useShortcut(replayShortcutDefs)</c> on mount).
    /// Idempotent: a second call while already registered is a no-op.
    /// </summary>
    public void RegisterShortcuts()
    {
        if (_registeredIds.Count > 0)
        {
            return;
        }

        foreach (ShortcutDefinition definition in ReplayShortcutCheatsheet.Build(_localizer))
        {
            _shortcuts.Register(definition);
            _registeredIds.Add(definition.Id);
        }
    }

    /// <summary>Remove this surface's cheatsheet entries from the registry (web <c>useShortcut</c> cleanup on unmount).</summary>
    public void UnregisterShortcuts()
    {
        if (_registeredIds.Count == 0)
        {
            return;
        }

        foreach (string id in _registeredIds)
        {
            _shortcuts.Unregister(id);
        }

        _registeredIds.Clear();
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        UnregisterShortcuts();
    }

    private void SeekBySeconds(int deltaSeconds)
    {
        // web seekBySeconds: prefer the explicit onSeekBy seam; otherwise translate to a normalized seek using the
        // duration; finally show the feedback toast regardless (the case is always consumed).
        if (_transport.CanSeekBy)
        {
            _transport.SeekBy(deltaSeconds);
        }
        else if (_durationMs is { } ms && ms > 0)
        {
            double next = Clamp01(_progress + (deltaSeconds * 1000.0) / ms);
            _transport.Seek(next);
        }

        SetToast(PlaybackToastLabels.SeekSeconds(deltaSeconds));
    }

    private void SetToast(string label)
    {
        // web setShortcutToast({ id: Date.now(), label }) — always a fresh toast, even when the label repeats, so
        // the display timer restarts and the live region re-announces. Bump the sequence + raise unconditionally.
        _toast = label;
        _toastSequence++;
        Raise(nameof(CurrentToast));
        Raise(nameof(ToastSequence));
    }

    private string Localize(string key, string fallback) => _localizer.GetString(key, fallback);

    private static double Clamp01(double value) => Math.Max(0, Math.Min(1, value));

    private void Raise([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
