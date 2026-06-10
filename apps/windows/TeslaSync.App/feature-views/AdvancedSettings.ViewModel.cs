using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="AdvancedSettings"/> view — the native port of the
/// web <c>AdvancedSettings</c> component (web/src/features/settings/components/AdvancedSettings.tsx). It binds
/// the synchronous <see cref="ISilencedPromptsStore"/> (the web <c>confirmSilence</c> localStorage helpers),
/// projects the current silenced ids through <see cref="AdvancedSettingsProjection"/>, and exposes the
/// mutually-exclusive <see cref="State"/> plus the render-ready <see cref="Display"/> so the view is a thin
/// renderer. Restoring one prompt (<see cref="Restore"/>, web <c>handleRestore</c>) or all of them
/// (<see cref="RestoreAll"/>, web <c>handleRestoreAll</c>) mutates the store and re-reads it — the native
/// analogue of the web <c>setTick</c> bumper that re-reads localStorage after each write. The read is
/// synchronous and runs entirely on this device, so the only async-free seam is the i18n facade (the web
/// <c>useTranslation</c>); <see cref="Reload"/> re-reads the store and re-resolves every label after the
/// active language changes. Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class AdvancedSettingsViewModel : INotifyPropertyChanged
{
    private readonly ISilencedPromptsStore _store;
    private readonly ILocalizer _localizer;

    private AdvancedSettingsDisplay _display;

    /// <summary>Creates the holder over its silenced-prompts store and the i18n facade.</summary>
    /// <param name="store">The synchronous, per-device silenced-prompts store (list / restore / restore-all).</param>
    /// <param name="localizer">The i18n facade resolving every owned string.</param>
    public AdvancedSettingsViewModel(ISilencedPromptsStore store, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(store);
        ArgumentNullException.ThrowIfNull(localizer);

        _store = store;
        _localizer = localizer;
        _display = Project();
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The projected, render-ready display for the current silenced ids.</summary>
    public AdvancedSettingsDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(State));
            Raise(nameof(IsEmpty));
            Raise(nameof(ShowRestoreAll));
            Raise(nameof(Rows));
            Raise(nameof(Count));
            Raise(nameof(Title));
        }
    }

    /// <summary>The current mutually-exclusive surface state.</summary>
    public AdvancedSettingsState State => _display.State;

    /// <summary>True when no prompts are silenced (the empty state is shown).</summary>
    public bool IsEmpty => _display.IsEmpty;

    /// <summary>True when the header "Restore all" action is shown (web <c>silenced.length &gt; 0</c>).</summary>
    public bool ShowRestoreAll => _display.ShowRestoreAll;

    /// <summary>The projected restore rows, ordinal-sorted by id.</summary>
    public IReadOnlyList<AdvancedSettingsRow> Rows => _display.Rows;

    /// <summary>The number of silenced prompts currently shown.</summary>
    public int Count => _display.Count;

    /// <summary>The localized panel title (also the surface Narrator name).</summary>
    public string Title => _display.Title;

    /// <summary>
    /// Re-enable a single silenced prompt and re-read the store — the native analogue of the web
    /// <c>handleRestore</c> (<c>unsilence(key)</c> then <c>setTick</c>). An empty id is ignored (the web
    /// <c>unsilence</c> guard); restoring an id that is already absent re-projects harmlessly, exactly as the
    /// web re-renders on every tick.
    /// </summary>
    /// <param name="key">The silenced action id to restore.</param>
    public void Restore(string key)
    {
        if (string.IsNullOrEmpty(key))
        {
            return;
        }

        _store.Restore(key);
        Display = Project();
    }

    /// <summary>
    /// Re-enable every silenced prompt and re-read the store — the native analogue of the web
    /// <c>handleRestoreAll</c> (<c>clearAllSilenced()</c> then <c>setTick</c>).
    /// </summary>
    public void RestoreAll()
    {
        _store.RestoreAll();
        Display = Project();
    }

    /// <summary>
    /// Re-read the store and re-resolve every label — the native analogue of react-i18next re-rendering the
    /// panel after the active language changes, and of the web re-reading localStorage on mount.
    /// </summary>
    public void Reload() => Display = Project();

    private AdvancedSettingsDisplay Project() =>
        AdvancedSettingsProjection.Project(_store.List(), _localizer);

    private void Raise([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
