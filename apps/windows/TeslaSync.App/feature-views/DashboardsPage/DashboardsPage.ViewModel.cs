using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.PowerUser;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>DashboardsPage</c> view — the native port of the web
/// component's hook composition (web/src/features/power-user/pages/DashboardsPage.tsx). It seeds the editor from
/// the draft seam (web <c>loadPersistedJson</c>), holds the current editor value (web <c>dashboardJson</c>) and
/// the transient copy status line (web <c>statusMessage</c>), projects the value through
/// <see cref="DashboardComposerProjection"/> into the render-ready <see cref="Display"/> on every change (so
/// <see cref="CanCopy"/> tracks the editor), and persists every change back through the seam (web
/// <c>persistJson</c>). The copy flow reproduces the web <c>handleCopy</c> precedence
/// (blank → <c>copyEmpty</c>; no clipboard → <c>copyUnavailable</c>; write resolves → <c>copySuccess</c>; write
/// throws → <c>copyFailed</c>). Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class DashboardsPageViewModel : INotifyPropertyChanged
{
    private readonly IDashboardDraftStore _store;
    private readonly IDashboardClipboard _clipboard;
    private readonly ILocalizer _localizer;
    private readonly DashboardsDiagnostics _diagnostics;

    private DashboardComposerInput _input;
    private DashboardComposerDisplay _display;
    private string _statusMessage = string.Empty;

    /// <summary>Creates the holder over its draft seam, clipboard seam, localizer and optional diagnostics sink.</summary>
    /// <param name="store">The draft persistence seam (web <c>localStorage</c>).</param>
    /// <param name="clipboard">The clipboard seam (web <c>navigator.clipboard</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public DashboardsPageViewModel(
        IDashboardDraftStore store,
        IDashboardClipboard clipboard,
        ILocalizer localizer,
        DashboardsDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(store);
        ArgumentNullException.ThrowIfNull(clipboard);
        ArgumentNullException.ThrowIfNull(localizer);

        _store = store;
        _clipboard = clipboard;
        _localizer = localizer;
        _diagnostics = diagnostics ?? new DashboardsDiagnostics();

        // Seed the editor from the persisted draft (web initial useState(loadPersistedJson())).
        _input = DashboardComposerInput.From(store.Load());
        _display = DashboardComposerProjection.Project(_input, localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public DashboardComposerDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>The current editor value (so the view can seed the editor from the seam — web <c>dashboardJson</c>).</summary>
    public string Json => _input.Json;

    /// <summary>True when the copy / clear affordances are enabled (web <c>canCopy</c>).</summary>
    public bool CanCopy => _input.CanCopy;

    /// <summary>The transient copy status line, or empty when none (web <c>statusMessage</c>).</summary>
    public string StatusMessage
    {
        get => _statusMessage;
        private set => Set(ref _statusMessage, value);
    }

    /// <summary>The outcome of the most recent <see cref="CopyAsync"/>, or <see langword="null"/> before any copy.</summary>
    public DashboardCopyOutcome? LastCopyOutcome { get; private set; }

    /// <summary>The localized page title (web <c>powerDashboards.title</c>).</summary>
    public string Title => _display.Title;

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>
    /// Re-project for a new editor value and persist it — the native port of the web <c>onChange</c> →
    /// <c>setDashboardJson</c> plus the <c>persistJson</c> effect. The status line is left untouched, exactly as
    /// the web keeps the last status visible while the user keeps typing.
    /// </summary>
    /// <param name="text">The new editor value (coalesced to empty when null).</param>
    public void SetText(string? text)
    {
        _input = DashboardComposerInput.From(text);
        Reproject();
        _store.Save(_input.Json);
    }

    /// <summary>Clear the editor and the status line (the web <c>handleClear</c>), persisting the empty draft.</summary>
    public void Clear()
    {
        _input = DashboardComposerInput.Blank;
        Reproject();
        _store.Save(_input.Json);
        StatusMessage = string.Empty;
    }

    /// <summary>
    /// Copy the trimmed editor value to the clipboard and surface the resulting status — the native port of the
    /// web <c>handleCopy</c>. A blank editor yields <see cref="DashboardCopyOutcome.Empty"/>; an unavailable
    /// clipboard yields <see cref="DashboardCopyOutcome.Unavailable"/>; a write resolves to
    /// <see cref="DashboardCopyOutcome.Success"/> or, on failure, <see cref="DashboardCopyOutcome.Failed"/>.
    /// </summary>
    /// <returns>The branch the copy flow took.</returns>
    public async Task<DashboardCopyOutcome> CopyAsync()
    {
        string trimmed = _input.Json.Trim();

        DashboardCopyOutcome outcome;
        if (trimmed.Length == 0)
        {
            outcome = DashboardCopyOutcome.Empty;
        }
        else if (!_clipboard.IsAvailable)
        {
            outcome = DashboardCopyOutcome.Unavailable;
        }
        else
        {
            try
            {
                await _clipboard.WriteTextAsync(trimmed).ConfigureAwait(true);
                outcome = DashboardCopyOutcome.Success;
            }
            catch (Exception)
            {
                // Web parity: any clipboard write failure surfaces the copyFailed guidance, never a crash.
                outcome = DashboardCopyOutcome.Failed;
            }
        }

        LastCopyOutcome = outcome;
        StatusMessage = _display.StatusFor(outcome);
        return outcome;
    }

    private void Reproject()
    {
        Display = DashboardComposerProjection.Project(_input, _localizer);
        Raise(nameof(Json));
        Raise(nameof(CanCopy));
    }

    private void Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return;
        }

        field = value;
        Raise(name);
    }

    private void Raise(string? name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
