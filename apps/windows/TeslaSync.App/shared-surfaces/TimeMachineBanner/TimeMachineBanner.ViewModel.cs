using System.ComponentModel;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="TimeMachineBanner"/> view — the native port of the web
/// component body (web/src/components/feedback/TimeMachineBanner.tsx L63-126). It binds the i18n facade, the P1/S8
/// <see cref="IAsOfDateSource"/> (the web <c>useAsOfDate()</c>) and the P1/S8 <see cref="ITimeMachinePickerTrigger"/>
/// (the web <c>TIME_MACHINE_OPEN_PICKER_EVENT</c> window event), owns the inline picker's open/draft state (the web
/// <c>pickerOpen</c> / <c>draft</c> React state), recomputes the pure <see cref="TimeMachineBannerProjection"/>
/// whenever any of those move, and raises <see cref="PropertyChanged"/> so the view shows/hides and re-renders.
/// <list type="bullet">
/// <item><see cref="TogglePicker"/> flips the picker (web pick button <c>onClick={() => setPickerOpen(p => !p)}</c>).</item>
/// <item><see cref="SetDraftDate"/> / <see cref="SetDraftTime"/> stage the inline draft (web <c>setDraft</c>).</item>
/// <item><see cref="Submit"/> applies a complete draft as the anchor and closes the picker (web <c>handleSubmit</c>).</item>
/// <item><see cref="ReturnToLive"/> clears the anchor and closes the picker (web <c>handleReturnToLive</c>).</item>
/// </list>
/// The trigger's <c>OpenRequested</c> seeds the draft (the current anchor, else yesterday at noon) and opens the
/// picker — the web command-palette reveal path. <see cref="Dispose"/> unsubscribes from both seams (the web effect
/// cleanup). Drive it from one confinement (the UI thread); it is not internally synchronized.
/// </summary>
public sealed class TimeMachineBannerViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ILocalizer _localizer;
    private readonly IAsOfDateSource _asOf;
    private readonly ITimeMachinePickerTrigger _trigger;
    private readonly Func<DateTimeOffset> _clock;

    private bool _pickerOpen;
    private DateTimeOffset? _draftDate;
    private TimeSpan? _draftTime;
    private TimeMachineBannerProjection _projection;
    private bool _disposed;

    /// <summary>Creates the holder over its i18n facade and the two bound P1/S8 seams.</summary>
    /// <param name="localizer">The i18n facade every string resolves through (web <c>useTranslation</c>).</param>
    /// <param name="asOf">The as-of anchor seam (web <c>useAsOfDate()</c>).</param>
    /// <param name="trigger">The command-palette picker-open seam (web <c>TIME_MACHINE_OPEN_PICKER_EVENT</c>).</param>
    /// <param name="pickerOpen">The initial picker-open state (defaults to closed; the web initial <c>useState</c>).</param>
    /// <param name="clock">The current-instant provider (defaults to <see cref="DateTimeOffset.Now"/>); injected for tests.</param>
    public TimeMachineBannerViewModel(
        ILocalizer localizer,
        IAsOfDateSource asOf,
        ITimeMachinePickerTrigger trigger,
        bool pickerOpen = false,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(asOf);
        ArgumentNullException.ThrowIfNull(trigger);

        _localizer = localizer;
        _asOf = asOf;
        _trigger = trigger;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _pickerOpen = pickerOpen;

        _projection = Compute();
        _asOf.Changed += OnAsOfChanged;
        _trigger.OpenRequested += OnOpenRequested;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The canonical surface slug (<c>TimeMachineBanner</c>).</summary>
    public static string Slug => TimeMachineBannerRegistration.Slug;

    /// <summary>The current render projection (mode + visibility + localized copy + draft enablement + accessible name).</summary>
    public TimeMachineBannerProjection Projection => _projection;

    /// <summary>Whether the banner is shown (web <c>asOf != null || pickerOpen</c>).</summary>
    public bool IsVisible => _projection.IsVisible;

    /// <summary>The render branch (hidden / live prompt / historical).</summary>
    public TimeMachineBannerMode Mode => _projection.Mode;

    /// <summary>Whether an anchor is set (web <c>effective != null</c>).</summary>
    public bool HasAsOf => _projection.HasAsOf;

    /// <summary>Whether the inline date/time picker is open (web <c>pickerOpen</c>).</summary>
    public bool PickerOpen => _projection.PickerOpen;

    /// <summary>The localized banner title (web <c>title</c>).</summary>
    public string Title => _projection.Title;

    /// <summary>The localized body copy (web <c>body</c>).</summary>
    public string Body => _projection.Body;

    /// <summary>The localized "Pick a date" toggle label (web <c>pickLabel</c>).</summary>
    public string PickLabel => _projection.PickLabel;

    /// <summary>The localized "Return to live" action label (web <c>returnLabel</c>).</summary>
    public string ReturnLabel => _projection.ReturnLabel;

    /// <summary>The localized "View as of date" submit label (web <c>submitLabel</c>).</summary>
    public string SubmitLabel => _projection.SubmitLabel;

    /// <summary>The localized "Cancel" action label (web <c>cancelLabel</c>).</summary>
    public string CancelLabel => _projection.CancelLabel;

    /// <summary>The localized date/time input label (web <c>inputLabel</c>).</summary>
    public string InputLabel => _projection.InputLabel;

    /// <summary>Whether the "Return to live" action is shown (web <c>effective != null</c>).</summary>
    public bool ShowReturnToLive => _projection.ShowReturnToLive;

    /// <summary>Whether "View as of date" is enabled — a complete draft is staged (web <c>!!draft</c>).</summary>
    public bool SubmitEnabled => _projection.SubmitEnabled;

    /// <summary>The accessible name the polite status region announces.</summary>
    public string AccessibleName => _projection.AccessibleName;

    /// <summary>The staged draft calendar date (web <c>draft</c> date part), or null when unset.</summary>
    public DateTimeOffset? DraftDate => _draftDate;

    /// <summary>The staged draft time-of-day (web <c>draft</c> time part), or null when unset.</summary>
    public TimeSpan? DraftTime => _draftTime;

    /// <summary>True once both a draft date and time are staged (web <c>!!draft</c>).</summary>
    public bool DraftReady => _draftDate.HasValue && _draftTime.HasValue;

    /// <summary>
    /// Toggle the inline picker (web pick button <c>onClick={() => setPickerOpen(prev => !prev)}</c>). Opening via
    /// the toggle does not seed the draft — only the command-palette reveal does (web parity).
    /// </summary>
    public void TogglePicker()
    {
        if (_disposed)
        {
            return;
        }

        _pickerOpen = !_pickerOpen;
        Reproject();
    }

    /// <summary>Close the inline picker (web cancel button <c>onClick={() => setPickerOpen(false)}</c>).</summary>
    public void ClosePicker()
    {
        if (_disposed || !_pickerOpen)
        {
            return;
        }

        _pickerOpen = false;
        Reproject();
    }

    /// <summary>Stage the draft calendar date (web <c>setDraft</c> date part); reprojects so submit enablement follows.</summary>
    /// <param name="date">The picked calendar date, or null to clear it.</param>
    public void SetDraftDate(DateTimeOffset? date)
    {
        if (_disposed || _draftDate == date)
        {
            return;
        }

        _draftDate = date;
        Reproject();
    }

    /// <summary>Stage the draft time-of-day (web <c>setDraft</c> time part); reprojects so submit enablement follows.</summary>
    /// <param name="time">The picked time-of-day, or null to clear it.</param>
    public void SetDraftTime(TimeSpan? time)
    {
        if (_disposed || _draftTime == time)
        {
            return;
        }

        _draftTime = time;
        Reproject();
    }

    /// <summary>
    /// Apply the staged draft as the anchor and close the picker — the native port of the web <c>handleSubmit</c>
    /// (TimeMachineBanner.tsx L95-100): a no-op when the draft is incomplete (web <c>if (!iso) return</c>);
    /// otherwise the local draft is converted to a UTC RFC 3339 anchor, forwarded to the seam, and the picker
    /// closes. Returns true when an anchor was applied.
    /// </summary>
    public bool Submit()
    {
        if (_disposed || _draftDate is not { } date || _draftTime is not { } time)
        {
            return false;
        }

        string iso = TimeMachineBannerRegistration.LocalToRfc3339(
            TimeMachineBannerRegistration.CombineDraft(date, time));

        _asOf.SetAsOf(iso);
        _pickerOpen = false;
        Reproject();
        return true;
    }

    /// <summary>
    /// Return to live and close the picker — the native port of the web <c>handleReturnToLive</c>
    /// (TimeMachineBanner.tsx L102-105): clears the anchor through the seam and collapses the picker.
    /// </summary>
    public void ReturnToLive()
    {
        if (_disposed)
        {
            return;
        }

        _asOf.Clear();
        _pickerOpen = false;
        Reproject();
    }

    /// <summary>
    /// Reveal and seed the picker — the native port of the web command-palette reveal
    /// (TimeMachineBanner.tsx L74-93): the draft is seeded from the current anchor when set, otherwise from the
    /// default seed (yesterday at local noon), and the picker opens.
    /// </summary>
    public void OpenPickerFromCommand()
    {
        if (_disposed)
        {
            return;
        }

        DateTimeOffset seed = TimeMachineBannerRegistration.TryParseAsOf(_asOf.AsOf, out DateTimeOffset anchor)
            ? anchor
            : TimeMachineBannerRegistration.DefaultPickerSeed(_clock());

        DateTimeOffset local = seed.ToLocalTime();
        _draftDate = local;
        _draftTime = local.TimeOfDay;
        _pickerOpen = true;
        Reproject();
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _asOf.Changed -= OnAsOfChanged;
        _trigger.OpenRequested -= OnOpenRequested;
        GC.SuppressFinalize(this);
    }

    private TimeMachineBannerProjection Compute() =>
        TimeMachineBannerProjection.Project(_asOf.AsOf, _pickerOpen, DraftReady, _clock(), _localizer);

    private void OnAsOfChanged(object? sender, EventArgs e) => Reproject();

    private void OnOpenRequested(object? sender, EventArgs e) => OpenPickerFromCommand();

    private void Reproject()
    {
        if (_disposed)
        {
            return;
        }

        TimeMachineBannerProjection next = Compute();
        if (next == _projection)
        {
            return;
        }

        _projection = next;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Projection)));
    }
}
