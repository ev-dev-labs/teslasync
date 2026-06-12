using System.ComponentModel;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The UI-thread-free state holder backing the WinUI <see cref="DatePresetChips"/> view — the native port of
/// the web <c>DatePresetChips</c> component body (web/src/components/forms/DatePresetChips.tsx). It observes the
/// bound <see cref="IDatePresetChipsSource"/> (the P1/S8 seam carrying the chip inputs), projects each change
/// through <see cref="DatePresetChipsProjection"/> into a render-ready <see cref="Display"/>, and raises
/// <see cref="INotifyPropertyChanged"/> so the view re-renders. Picking a chip is the native analogue of the web
/// <c>onSelect(selection)</c> callback: <see cref="Select"/> resolves the preset's range against the source's
/// clock and raises <see cref="Selected"/>. It carries no view-framework dependency so it is verified
/// headlessly; the WinUI view marshals its notifications onto the dispatcher.
/// </summary>
public sealed class DatePresetChipsViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IDatePresetChipsSource _source;
    private readonly ILocalizer _localizer;
    private DatePresetChipsDisplay _display;
    private bool _disposed;

    /// <summary>Creates the holder over its data seam and localizer, projecting the initial frame.</summary>
    public DatePresetChipsViewModel(IDatePresetChipsSource source, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _display = Project();
        _source.Changed += OnSourceChanged;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>
    /// Raised when a chip is picked, carrying the resolved <see cref="DatePresetSelection"/> — the native
    /// analogue of the web <c>onSelect({ id, start, end })</c> callback. The host applies the range (updates its
    /// date filter); the surface itself does not mutate the active id.
    /// </summary>
    public event EventHandler<DatePresetSelection>? Selected;

    /// <summary>The diagnostics slug this surface registers under (<c>DatePresetChips</c>).</summary>
    public static string Slug => DatePresetChipsRegistration.Slug;

    /// <summary>The render-ready projection of the current inputs.</summary>
    public DatePresetChipsDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            PropertyChanged?.Invoke(this, DisplayChangedArgs);
            PropertyChanged?.Invoke(this, StateChangedArgs);
            PropertyChanged?.Invoke(this, IsEmptyChangedArgs);
            PropertyChanged?.Invoke(this, ItemsChangedArgs);
        }
    }

    /// <summary>Which render branch is showing (populated / empty).</summary>
    public DatePresetChipsState State => _display.State;

    /// <summary>True while the friendly empty surface is showing.</summary>
    public bool IsEmpty => _display.State == DatePresetChipsState.Empty;

    /// <summary>The projected, localized, render-ready chips (empty in the empty state).</summary>
    public IReadOnlyList<DatePresetChipItem> Items => _display.Items;

    /// <summary>
    /// Resolve the preset identified by <paramref name="id"/> against the source's current local day and raise
    /// <see cref="Selected"/> with the inclusive ISO range — the native analogue of the web chip onClick
    /// (<c>const r = p.resolve(); onSelect({ id, start, end })</c>). Returns <see langword="true"/> when the id
    /// is a known preset (and the event fired), <see langword="false"/> for an unknown id.
    /// </summary>
    public bool Select(string id)
    {
        if (DatePresetChipsProjection.Resolve(id, _source.Today) is not { } selection)
        {
            return false;
        }

        Selected?.Invoke(this, selection);
        return true;
    }

    /// <summary>
    /// Re-resolve every label from the localizer and re-render — call after the active language changes so the
    /// chips and the group name update without reconstructing the surface (web react-i18next parity).
    /// </summary>
    public void Reload() => Display = Project();

    /// <summary>Detach from the data seam (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _source.Changed -= OnSourceChanged;
        GC.SuppressFinalize(this);
    }

    private void OnSourceChanged(object? sender, EventArgs e) => Display = Project();

    private DatePresetChipsDisplay Project() => DatePresetChipsProjection.Project(_source, _localizer);

    private static readonly PropertyChangedEventArgs DisplayChangedArgs = new(nameof(Display));
    private static readonly PropertyChangedEventArgs StateChangedArgs = new(nameof(State));
    private static readonly PropertyChangedEventArgs IsEmptyChangedArgs = new(nameof(IsEmpty));
    private static readonly PropertyChangedEventArgs ItemsChangedArgs = new(nameof(Items));
}
