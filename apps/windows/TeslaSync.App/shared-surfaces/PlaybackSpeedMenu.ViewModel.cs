using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="PlaybackSpeedMenu"/> view — the native port of the
/// web component body (web/src/components/data-display/PlaybackSpeedMenu.tsx L41-L59). It mirrors the web
/// source's behaviour: the current <see cref="Speed"/> (web <c>speed</c> prop) drives the <see cref="SpeedLabel"/>
/// badge (web <c>{speed}x</c>); the single <see cref="AccessibleName"/> resolves the web <c>aria-label</c>
/// (<c>t('replay.controls.speed', 'Playback speed')</c>); <see cref="Cycle"/> picks the next-fastest speed
/// (web click <c>onChange(nextSpeed(speed))</c>); <see cref="StepBackward"/> steps one slot slower (web
/// right-click <c>onContextMenu</c> → <c>onChange(shiftSpeed(speed, -1))</c>); and <see cref="Shift"/> exposes
/// the signed slot step the keyboard speed shortcuts use (web <c>shiftSpeed(speed, delta)</c>). Every user step
/// announces the chosen speed through the change seam unconditionally — matching the web source, whose
/// <c>onChange</c> fires even when a clamped step lands on the same speed. Assigning <see cref="Speed"/>
/// programmatically (the controlled-prop echo the parent performs after <c>onChange</c>) re-renders the badge
/// but never re-announces. The view binds the projected label + accessible name and never performs I/O. Drive
/// it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class PlaybackSpeedMenuViewModel : INotifyPropertyChanged
{
    private readonly IPlaybackSpeedSink _sink;
    private readonly ILocalizer _localizer;

    private int _speed;

    /// <summary>Creates the holder over its change seam (P1/S8), the i18n facade and the initial speed.</summary>
    /// <param name="sink">The change seam (web <c>onChange</c>); pass <see cref="NoOpPlaybackSpeedSink.Instance"/> when none is wired.</param>
    /// <param name="localizer">The i18n facade the accessible name resolves through.</param>
    /// <param name="initialSpeed">The initial speed (web <c>speed</c> prop); stored as supplied, like the uncontrolled web prop.</param>
    public PlaybackSpeedMenuViewModel(IPlaybackSpeedSink sink, ILocalizer localizer, int initialSpeed = 1)
    {
        ArgumentNullException.ThrowIfNull(sink);
        ArgumentNullException.ThrowIfNull(localizer);

        _sink = sink;
        _localizer = localizer;
        _speed = initialSpeed;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>
    /// The current speed (web <c>speed</c> prop). Assigning it is the controlled-prop echo a parent performs
    /// after <see cref="Cycle"/> / <see cref="StepBackward"/> announce a change: it re-renders the badge but
    /// never re-announces through the change seam.
    /// </summary>
    public int Speed
    {
        get => _speed;
        set => SetSpeedField(value);
    }

    /// <summary>The badge text for the current speed (web <c>{speed}x</c>).</summary>
    public string SpeedLabel => PlaybackSpeeds.Format(_speed);

    /// <summary>
    /// The control's accessible name (web <c>aria-label={t('replay.controls.speed', 'Playback speed')}</c>).
    /// Constant for the control's lifetime, so it is resolved on demand rather than raised as a change.
    /// </summary>
    public string AccessibleName =>
        _localizer.GetString(PlaybackSpeedMenuRegistration.SpeedKey, PlaybackSpeedMenuRegistration.SpeedFallback);

    /// <summary>
    /// Pick the next-fastest speed, wrapping past the top (web click handler
    /// <c>onChange(nextSpeed(speed))</c>): advance the badge and announce the new speed through the seam.
    /// </summary>
    public void Cycle() => ApplyUserChange(PlaybackSpeeds.Next(_speed));

    /// <summary>
    /// Step one slot slower, clamped at the slowest (web right-click handler
    /// <c>onChange(shiftSpeed(speed, -1))</c>): move the badge and announce the new speed through the seam.
    /// </summary>
    public void StepBackward() => Shift(-1);

    /// <summary>
    /// Step <paramref name="delta"/> slots (signed, clamped) and announce the result (web
    /// <c>onChange(shiftSpeed(speed, delta))</c> — the +/- keyboard speed shortcuts). +1 = next-fastest,
    /// -1 = next-slowest.
    /// </summary>
    public void Shift(int delta) => ApplyUserChange(PlaybackSpeeds.Shift(_speed, delta));

    private void ApplyUserChange(int speed)
    {
        // Advance the displayed badge, then announce through the seam unconditionally — the web onChange fires
        // for every user step, even when a clamped shift lands on the same speed.
        SetSpeedField(speed);
        _sink.OnSpeedChanged(speed);
    }

    private void SetSpeedField(int speed)
    {
        if (_speed == speed)
        {
            return;
        }

        _speed = speed;
        Raise(nameof(Speed));
        Raise(nameof(SpeedLabel));
    }

    private void Raise([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
