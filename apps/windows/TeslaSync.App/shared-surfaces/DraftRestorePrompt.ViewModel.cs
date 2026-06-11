using System.Collections.Generic;
using System.ComponentModel;
using System.Globalization;
using System.Linq;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="DraftRestorePrompt"/> view — the native port of the
/// web component body (web/src/components/feedback/DraftRestorePrompt.tsx). It reproduces the web source exactly:
/// <list type="number">
/// <item>A one-shot, per-session mount evaluation (web <c>evaluatedRef</c> + the <c>sessionStorage</c> guard):
/// <see cref="BeginEvaluation"/> opens the cross-window presence subscription and collects the keys peers are
/// editing right now during a grace window, then <see cref="CompleteEvaluation"/> reads the draft index, filters
/// out the peer-held keys, and surfaces the bottom-left card only if anything remains (web L88-L118).</item>
/// <item>The compact prompt card (<see cref="DraftRestoreState.Prompt"/>) with its pluralized count body (web
/// L189-L241).</item>
/// <item>The review modal (<see cref="DraftRestoreState.Review"/>) listing every draft with per-row Resume /
/// Discard, kept in sync with the index so a sibling-window discard prunes the row here too (web L122-L140,
/// L243-L317).</item>
/// </list>
/// Resume marks the session guard and asks the bound navigator to open the route (web L152-L169); Dismiss marks
/// the guard and closes (web L142-L146); Discard removes the envelope and prunes, closing when the last draft
/// goes (web L171-L181). The view binds the projected labels + rows and never performs I/O. Because the web
/// source reads a synchronous client store (no network), there is no loading / error / stale / offline branch —
/// see <see cref="DraftRestoreState"/>. Drive it from one confinement (the UI thread); it is not internally
/// synchronised. Dispose it to detach from the bound seams.
/// </summary>
public sealed class DraftRestorePromptViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IDraftStore _store;
    private readonly IDraftPresenceSource _presence;
    private readonly IDraftPromptSessionGuard _guard;
    private readonly IDraftRestoreNavigator _navigator;
    private readonly ILocalizer _localizer;
    private readonly DraftRestorePromptDiagnostics _diagnostics;
    private readonly Func<DateTimeOffset> _clock;
    private readonly bool _skipSessionGuard;
    private readonly HashSet<string> _activeKeys = new(StringComparer.Ordinal);

    private IReadOnlyList<DraftEntry> _drafts = Array.Empty<DraftEntry>();
    private DraftRestoreState _state = DraftRestoreState.Idle;
    private bool _evaluated;
    private bool _collecting;
    private bool _presenceSubscribed;
    private bool _storeSubscribed;
    private bool _disposed;

    /// <summary>Creates the holder over the draft seams (P1/S8), the navigator, the i18n facade and diagnostics.</summary>
    /// <param name="store">The draft-index seam (web <c>getDrafts</c> / <c>discardDraftEnvelope</c> / <c>subscribeDraftIndex</c>).</param>
    /// <param name="presence">The cross-window presence seam (web <c>formDraft.acquired</c> / <c>released</c> broadcasts).</param>
    /// <param name="guard">The one-shot session guard (web <c>sessionStorage</c> flag).</param>
    /// <param name="navigator">The Resume navigation seam (web <c>useNavigate</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through (web <c>useTranslation</c>).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    /// <param name="clock">Test seam for "now" used by the relative-time captions — defaults to <see cref="DateTimeOffset.Now"/>.</param>
    /// <param name="skipSessionGuard">Test seam mirroring the web <c>skipSessionGuard</c> prop; production callers leave it false.</param>
    public DraftRestorePromptViewModel(
        IDraftStore store,
        IDraftPresenceSource presence,
        IDraftPromptSessionGuard guard,
        IDraftRestoreNavigator navigator,
        ILocalizer localizer,
        DraftRestorePromptDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null,
        bool skipSessionGuard = false)
    {
        ArgumentNullException.ThrowIfNull(store);
        ArgumentNullException.ThrowIfNull(presence);
        ArgumentNullException.ThrowIfNull(guard);
        ArgumentNullException.ThrowIfNull(navigator);
        ArgumentNullException.ThrowIfNull(localizer);

        _store = store;
        _presence = presence;
        _guard = guard;
        _navigator = navigator;
        _localizer = localizer;
        _diagnostics = diagnostics ?? new DraftRestorePromptDiagnostics();
        _clock = clock ?? (() => DateTimeOffset.Now);
        _skipSessionGuard = skipSessionGuard;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current, mutually-exclusive surface state (web <c>showPrompt</c> / <c>reviewOpen</c> gate).</summary>
    public DraftRestoreState State => _state;

    /// <summary>True while the compact recovery card is shown (web <c>showPrompt &amp;&amp; !reviewOpen</c>).</summary>
    public bool IsPromptVisible => _state == DraftRestoreState.Prompt;

    /// <summary>True while the review modal is open (web <c>reviewOpen</c>).</summary>
    public bool IsReviewOpen => _state == DraftRestoreState.Review;

    /// <summary>The surfaced drafts (web <c>drafts</c>), newest-first.</summary>
    public IReadOnlyList<DraftEntry> Drafts => _drafts;

    /// <summary>The number of surfaced drafts (web <c>count = drafts.length</c>).</summary>
    public int Count => _drafts.Count;

    /// <summary>True when at least one draft is surfaced (web <c>drafts.length &gt; 0</c>).</summary>
    public bool HasDrafts => _drafts.Count > 0;

    /// <summary>The render-ready review rows projected against the clock (web <c>drafts.map</c>).</summary>
    public IReadOnlyList<DraftRestoreRow> Rows =>
        DraftRestoreProjection.Project(_drafts, _clock(), CultureInfo.CurrentCulture, _localizer);

    /// <summary>The prompt card title (web <c>t('draft.recovery.promptTitle')</c>).</summary>
    public string PromptTitle =>
        _localizer.GetString(DraftRestorePromptRegistration.PromptTitleKey, DraftRestorePromptRegistration.PromptTitleFallback);

    /// <summary>The pluralized prompt card body (web <c>t('draft.recovery.promptBody', { count })</c>).</summary>
    public string PromptBody => DraftRestorePromptRegistration.FormatPromptBody(_localizer, Count);

    /// <summary>The "Review" affordance label (web <c>t('draft.recovery.review')</c>).</summary>
    public string ReviewLabel =>
        _localizer.GetString(DraftRestorePromptRegistration.ReviewKey, DraftRestorePromptRegistration.ReviewFallback);

    /// <summary>The "Dismiss" affordance label (web <c>t('draft.recovery.dismiss')</c>).</summary>
    public string DismissLabel =>
        _localizer.GetString(DraftRestorePromptRegistration.DismissKey, DraftRestorePromptRegistration.DismissFallback);

    /// <summary>The close-button accessible name (web <c>aria-label={t('draft.recovery.close')}</c>).</summary>
    public string CloseLabel =>
        _localizer.GetString(DraftRestorePromptRegistration.CloseKey, DraftRestorePromptRegistration.CloseFallback);

    /// <summary>The review modal title (web <c>t('draft.recovery.modalTitle')</c>).</summary>
    public string ModalTitle =>
        _localizer.GetString(DraftRestorePromptRegistration.ModalTitleKey, DraftRestorePromptRegistration.ModalTitleFallback);

    /// <summary>The review modal body paragraph (web <c>t('draft.recovery.modalBody')</c>).</summary>
    public string ModalBody =>
        _localizer.GetString(DraftRestorePromptRegistration.ModalBodyKey, DraftRestorePromptRegistration.ModalBodyFallback);

    /// <summary>The empty review-state message (web <c>t('draft.recovery.empty')</c>).</summary>
    public string EmptyMessage =>
        _localizer.GetString(DraftRestorePromptRegistration.EmptyKey, DraftRestorePromptRegistration.EmptyFallback);

    /// <summary>The per-row "Resume" action label (web <c>t('draft.recovery.resume')</c>).</summary>
    public string ResumeLabel =>
        _localizer.GetString(DraftRestorePromptRegistration.ResumeKey, DraftRestorePromptRegistration.ResumeFallback);

    /// <summary>The per-row "Discard" action label (web <c>t('draft.recovery.discard')</c>).</summary>
    public string DiscardLabel =>
        _localizer.GetString(DraftRestorePromptRegistration.DiscardKey, DraftRestorePromptRegistration.DiscardFallback);

    /// <summary>The prompt card's polite Narrator name (web role=status) — the title and body read together.</summary>
    public string PromptAutomationName => string.Create(CultureInfo.CurrentCulture, $"{PromptTitle}. {PromptBody}");

    /// <summary>
    /// Begin the one-shot mount evaluation (web mount effect L88-L102): open the cross-window presence
    /// subscription and start collecting the keys peers are editing now. A no-op on a second call (web
    /// <c>evaluatedRef</c>), and — unless the test seam <c>skipSessionGuard</c> is set — a no-op when the session
    /// guard is already dismissed (web <c>readDismissed()</c>), so the prompt never re-fires within a session.
    /// The view starts the grace timer and calls <see cref="CompleteEvaluation"/> when it elapses.
    /// </summary>
    public void BeginEvaluation()
    {
        if (_disposed || _evaluated)
        {
            return;
        }

        _evaluated = true;

        if (!_skipSessionGuard && _guard.IsDismissed)
        {
            return;
        }

        _collecting = true;
        _activeKeys.Clear();
        _presence.PresenceChanged += OnPresenceChanged;
        _presenceSubscribed = true;
    }

    /// <summary>
    /// Complete the mount evaluation once the grace window has elapsed (web <c>setTimeout</c> callback L104-L112):
    /// read the draft index, drop any draft a peer window is editing right now, and surface the prompt card only
    /// when something remains. Closes the presence subscription. A no-op unless <see cref="BeginEvaluation"/>
    /// armed a collection pass (e.g. it returned early because the session was already dismissed).
    /// </summary>
    public void CompleteEvaluation()
    {
        if (_disposed || !_collecting)
        {
            return;
        }

        _collecting = false;
        UnsubscribePresence();

        var surfaced = _store.GetDrafts()
            .Where(d => !_activeKeys.Contains(d.StorageKey))
            .ToArray();

        if (surfaced.Length == 0)
        {
            // web: nothing left after filtering — the prompt stays hidden.
            return;
        }

        SetDrafts(surfaced);
        SetState(DraftRestoreState.Prompt);
        _diagnostics.RecordViewOpened();
    }

    /// <summary>Open the review modal (web <c>handleReview</c> → <c>setReviewOpen(true)</c>), subscribing to live index changes.</summary>
    public void Review()
    {
        if (_disposed || _state == DraftRestoreState.Idle)
        {
            return;
        }

        SetState(DraftRestoreState.Review);
    }

    /// <summary>
    /// Dismiss the prompt (web <c>handleDismiss</c>): mark the session guard so it does not re-show this session,
    /// and close both the card and the modal.
    /// </summary>
    public void Dismiss()
    {
        if (_disposed)
        {
            return;
        }

        _guard.MarkDismissed();
        SetState(DraftRestoreState.Idle);
    }

    /// <summary>
    /// Resume editing a draft (web <c>handleResume</c>): mark the session guard, close, and ask the navigator to
    /// open the draft's in-app route. A throwing navigator is swallowed (the host owns route validity), mirroring
    /// the web component's defensive fallback around <c>navigate</c>.
    /// </summary>
    public void Resume(DraftEntry entry)
    {
        ArgumentNullException.ThrowIfNull(entry);
        if (_disposed)
        {
            return;
        }

        _guard.MarkDismissed();
        SetState(DraftRestoreState.Idle);

        try
        {
            _navigator.Navigate(entry.Route);
        }
        catch (Exception)
        {
            // Defensive parity with the web try/catch around navigate(): the host owns route validity, so a
            // bad route must never crash the surface.
        }
    }

    /// <summary>
    /// Discard a draft (web <c>handleDiscard</c>): remove the envelope + index entry through the store, prune the
    /// row, and close when the last draft is gone. Does not mark the session guard (web parity — only Dismiss /
    /// Resume do).
    /// </summary>
    public void Discard(DraftEntry entry)
    {
        ArgumentNullException.ThrowIfNull(entry);
        if (_disposed)
        {
            return;
        }

        _store.DiscardDraft(entry.StorageKey);

        var next = _drafts.Where(d => !string.Equals(d.StorageKey, entry.StorageKey, StringComparison.Ordinal)).ToArray();
        SetDrafts(next);
        if (next.Length == 0)
        {
            SetState(DraftRestoreState.Idle);
        }
    }

    /// <summary>
    /// Re-raise every projected label (the native analogue of react-i18next re-rendering after the active
    /// language changes). The resolved <see cref="State"/> and surfaced drafts are unaffected.
    /// </summary>
    public void Reload() => RaiseAll();

    /// <summary>Detach from the bound seams and stop responding (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        UnsubscribePresence();
        UnsubscribeStore();
        GC.SuppressFinalize(this);
    }

    private void OnPresenceChanged(object? sender, DraftPresenceEventArgs e)
    {
        // web: collect `formDraft.acquired` keys from peers, cancel on `released` / `committed`.
        if (e.Kind == DraftPresenceKind.Acquired)
        {
            _activeKeys.Add(e.StorageKey);
        }
        else
        {
            _activeKeys.Remove(e.StorageKey);
        }
    }

    private void OnStoreChanged(object? sender, EventArgs e)
    {
        // web second effect handler (L124-L138): keep only the drafts still present in the fresh index, in the
        // same order, refreshing each from the fresh entry; close when none remain.
        if (_state != DraftRestoreState.Review || _drafts.Count == 0)
        {
            return;
        }

        var freshByKey = _store.GetDrafts().ToDictionary(d => d.StorageKey, StringComparer.Ordinal);
        var next = new List<DraftEntry>(_drafts.Count);
        foreach (DraftEntry prev in _drafts)
        {
            if (freshByKey.TryGetValue(prev.StorageKey, out DraftEntry? fresh))
            {
                next.Add(fresh);
            }
        }

        SetDrafts(next);
        if (next.Count == 0)
        {
            SetState(DraftRestoreState.Idle);
        }
    }

    private void SetState(DraftRestoreState value)
    {
        if (_state == value)
        {
            return;
        }

        _state = value;

        // web second effect: the index subscription is live only while the modal is open.
        if (value == DraftRestoreState.Review)
        {
            SubscribeStore();
        }
        else
        {
            UnsubscribeStore();
        }

        RaiseAll();
    }

    private void SetDrafts(IReadOnlyList<DraftEntry> drafts)
    {
        _drafts = drafts;
        RaiseAll();
    }

    private void SubscribeStore()
    {
        if (_storeSubscribed)
        {
            return;
        }

        _store.Changed += OnStoreChanged;
        _storeSubscribed = true;
    }

    private void UnsubscribeStore()
    {
        if (!_storeSubscribed)
        {
            return;
        }

        _store.Changed -= OnStoreChanged;
        _storeSubscribed = false;
    }

    private void UnsubscribePresence()
    {
        if (!_presenceSubscribed)
        {
            return;
        }

        _presence.PresenceChanged -= OnPresenceChanged;
        _presenceSubscribed = false;
    }

    private void RaiseAll() => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(string.Empty));
}
