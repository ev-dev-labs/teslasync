using System.ComponentModel;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="NavigationGuardProvider"/> view, and the navigation
/// guard context value itself (<see cref="INavigationGuardController"/>) — the native port of the web component
/// body (web/src/components/feedback/NavigationGuardProvider.tsx). It reproduces the web source exactly:
/// <list type="number">
/// <item><see cref="RegisterGuard"/> adds a dirty-state guard and returns its unregister token (web
/// <c>register</c>, L98-L103).</item>
/// <item><see cref="ConfirmIfDirtyAsync"/> reuses an in-flight confirm, resolves immediately when no guard is
/// dirty, auto-resolves when the action was silenced, else opens the warning confirm dialog and resolves to the
/// user's choice (web <c>confirmIfDirty</c>, L112-L121, plus the <c>ConfirmDialog</c> silence auto-resolve).</item>
/// <item>An intercepted back navigation (web <c>popstate</c>, L142-L178) cancels the back while a guard is
/// dirty, shows the same dialog, and — on Discard — replays the back through the navigator (web
/// <c>navigate(-1)</c>).</item>
/// <item><see cref="Confirm"/> / <see cref="Cancel"/> resolve the awaited result, persist the "Don't ask again"
/// choice on Discard, and return to <see cref="NavigationGuardState.Inert"/> (web <c>handleConfirm</c> /
/// <c>handleCancel</c> + the <c>ConfirmDialog</c> silence write, L197-L211 / ConfirmDialog.tsx L139-L144).</item>
/// </list>
/// Because the web source holds its state in-process and reads it synchronously (no network), there is no
/// loading / error / stale / offline branch — see <see cref="NavigationGuardState"/>. Drive it from one
/// confinement (the UI thread); it is not internally synchronised. Dispose it to detach from the back source.
/// </summary>
public sealed class NavigationGuardProviderViewModel : INotifyPropertyChanged, INavigationGuardController, IDisposable
{
    private readonly INavigationGuardRegistry _registry;
    private readonly IConfirmSilenceStore _silence;
    private readonly INavigationGuardNavigator _navigator;
    private readonly INavigationBackSource _backSource;
    private readonly ILocalizer _localizer;
    private readonly NavigationGuardProviderDiagnostics _diagnostics;
    private readonly bool _silenceHonored;

    private Pending? _pending;
    private NavigationGuardState _state = NavigationGuardState.Inert;
    private bool _skipNextBack;
    private bool _backSubscribed;
    private bool _disposed;

    /// <summary>Creates the holder over the guard registry, silence store, i18n facade, navigator, back source and diagnostics (P1/S8).</summary>
    /// <param name="registry">The guard-registry seam (web <c>guards</c> map + <c>findDirty</c>).</param>
    /// <param name="silence">The "Don't ask again" persistence seam (web <c>lib/confirmSilence</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through (web <c>useTranslation</c>).</param>
    /// <param name="navigator">The back-navigation replay seam (web <c>navigate(-1)</c>); when null the deferred back is a no-op.</param>
    /// <param name="backSource">The intercepted back-navigation source (web <c>popstate</c>); when null no back is intercepted.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> / confirm lifecycle events.</param>
    public NavigationGuardProviderViewModel(
        INavigationGuardRegistry registry,
        IConfirmSilenceStore silence,
        ILocalizer localizer,
        INavigationGuardNavigator? navigator = null,
        INavigationBackSource? backSource = null,
        NavigationGuardProviderDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(registry);
        ArgumentNullException.ThrowIfNull(silence);
        ArgumentNullException.ThrowIfNull(localizer);

        _registry = registry;
        _silence = silence;
        _localizer = localizer;
        _navigator = navigator ?? NullNavigationGuardNavigator.Instance;
        _backSource = backSource ?? NullNavigationBackSource.Instance;
        _diagnostics = diagnostics ?? new NavigationGuardProviderDiagnostics();

        // web ConfirmDialog silenceHonored = Boolean(silenceKey && variant !== 'danger' && !requireTypedConfirmation)
        // (ConfirmDialog.tsx L89-L91): this surface always passes a silenceKey to a warning (non-destructive)
        // dialog with no typed-confirmation gate, so the "Don't ask again" option is always offered.
        _silenceHonored = true;

        // web: window.addEventListener('popstate', handler) for the provider's lifetime.
        _backSource.BackRequested += OnBackRequested;
        _backSubscribed = true;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current, mutually-exclusive surface state (web <c>pending == null</c> gate).</summary>
    public NavigationGuardState State => _state;

    /// <summary>True while the confirm dialog is shown (web <c>pending != null</c>).</summary>
    public bool IsConfirming => _state == NavigationGuardState.Confirming;

    /// <summary>The confirm-dialog title (web <c>t('forms.unsavedTitle')</c>).</summary>
    public string Title =>
        _localizer.GetString(NavigationGuardProviderRegistration.TitleKey, NavigationGuardProviderRegistration.TitleFallback);

    /// <summary>
    /// The confirm-dialog message: the blocking guard's caller-localized message when it supplied one, else the
    /// generic warning (web <c>pending?.message ?? t('forms.unsavedWarning')</c>, L219).
    /// </summary>
    public string Message => _pending?.Message ?? DefaultMessage;

    /// <summary>The confirm (discard) button label (web <c>t('forms.discard')</c>).</summary>
    public string ConfirmLabel =>
        _localizer.GetString(NavigationGuardProviderRegistration.DiscardKey, NavigationGuardProviderRegistration.DiscardFallback);

    /// <summary>The cancel (keep editing) button label (web <c>t('forms.keepEditing')</c>).</summary>
    public string CancelLabel =>
        _localizer.GetString(NavigationGuardProviderRegistration.KeepEditingKey, NavigationGuardProviderRegistration.KeepEditingFallback);

    /// <summary>The "Don't ask again" checkbox label (web <c>t('confirm.silence.checkbox')</c>).</summary>
    public string SilenceCheckboxLabel =>
        _localizer.GetString(NavigationGuardProviderRegistration.SilenceCheckboxKey, NavigationGuardProviderRegistration.SilenceCheckboxFallback);

    /// <summary>
    /// Whether the "Don't ask again" checkbox is offered. <c>true</c> for this surface: the web source passes a
    /// <c>silenceKey</c> to a <c>warning</c> (non-destructive) <c>ConfirmDialog</c> with no typed confirmation,
    /// which is exactly the web <c>silenceHonored</c> condition (ConfirmDialog.tsx L89-L91), evaluated once in
    /// the constructor.
    /// </summary>
    public bool ShowSilenceOption => _silenceHonored;

    /// <summary>The Narrator name for the confirm dialog (web <c>Modal</c> title) — the dialog title.</summary>
    public string DialogAutomationName => Title;

    private string DefaultMessage =>
        _localizer.GetString(NavigationGuardProviderRegistration.MessageKey, NavigationGuardProviderRegistration.MessageFallback);

    /// <inheritdoc />
    public IDisposable RegisterGuard(NavigationGuardEntry entry)
    {
        ArgumentNullException.ThrowIfNull(entry);
        if (_disposed)
        {
            // A torn-down provider must never block navigation; hand back an inert token (web NOOP behaviour).
            return NoOpDisposable.Instance;
        }

        return _registry.Register(entry);
    }

    /// <inheritdoc />
    public Task<bool> ConfirmIfDirtyAsync()
    {
        if (_disposed)
        {
            return Task.FromResult(true);
        }

        // web: if (pendingPromiseRef.current) return pendingPromiseRef.current
        if (_pending is { } inFlight)
        {
            return inFlight.Completion.Task;
        }

        // web: const dirty = findDirty(); if (!dirty) return Promise.resolve(true)
        NavigationGuardEntry? dirty = _registry.FindDirty();
        if (dirty is null)
        {
            return Task.FromResult(true);
        }

        // web ConfirmDialog auto-resolve: when the action was silenced, onConfirm fires immediately and the
        // dialog never renders — i.e. confirmIfDirty resolves true without entering the Confirming state.
        if (_silence.IsSilenced(NavigationGuardProviderRegistration.SilenceActionKey))
        {
            _diagnostics.RecordSilencedAutoConfirm();
            return Task.FromResult(true);
        }

        // web: setPending({ resolve, message: dirty.getMessage() }); pendingPromiseRef.current = promise
        return BeginPending(dirty.GetMessage(), replayBack: false).Completion.Task;
    }

    /// <summary>
    /// Resolve the in-flight confirm as Discard (web <c>handleConfirm</c>): when <paramref name="dontAskAgain"/>
    /// is set persist the silence choice (web ConfirmDialog <c>handleConfirmClick</c>), return to
    /// <see cref="NavigationGuardState.Inert"/>, replay the deferred back navigation when this confirm was
    /// initiated by an intercepted back (web popstate resolve → <c>navigate(-1)</c>), and complete the awaited
    /// result with <c>true</c>. A no-op when nothing is pending.
    /// </summary>
    /// <param name="dontAskAgain">Whether the user ticked "Don't ask again" (web silence checkbox).</param>
    public void Confirm(bool dontAskAgain)
    {
        Pending? pending = _pending;
        if (pending is null)
        {
            return;
        }

        if (dontAskAgain)
        {
            // web: if (silenceHonored && silenceKey && dontAskAgain) silence(silenceKey)
            _silence.Silence(NavigationGuardProviderRegistration.SilenceActionKey);
        }

        ClearPending();
        _diagnostics.RecordDiscarded();

        // web popstate resolve wrapper: if (ok) { skipNextPopstateRef = true; navigate(-1) }
        if (pending.ReplayBack)
        {
            _skipNextBack = true;
            _navigator.GoBack();
        }

        pending.Completion.TrySetResult(true);
    }

    /// <summary>
    /// Resolve the in-flight confirm as Keep editing (web <c>handleCancel</c>): return to
    /// <see cref="NavigationGuardState.Inert"/> and complete the awaited result with <c>false</c> (no navigation,
    /// no silence write). A no-op when nothing is pending.
    /// </summary>
    public void Cancel()
    {
        Pending? pending = _pending;
        if (pending is null)
        {
            return;
        }

        ClearPending();
        _diagnostics.RecordKept();
        pending.Completion.TrySetResult(false);
    }

    /// <summary>
    /// Re-raise every projected label (the native analogue of react-i18next re-rendering after the active
    /// language changes). The resolved <see cref="State"/> and any pending confirm are unaffected.
    /// </summary>
    public void Reload() => RaiseAll();

    /// <summary>Detach from the back source and release any awaiting caller (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;

        if (_backSubscribed)
        {
            _backSource.BackRequested -= OnBackRequested;
            _backSubscribed = false;
        }

        // Release an awaiting caller rather than leave it hanging on teardown; tearing the provider down maps to
        // "keep editing" (navigation is not completed by a disposed guard).
        Pending? pending = _pending;
        _pending = null;
        pending?.Completion.TrySetResult(false);

        GC.SuppressFinalize(this);
    }

    private void OnBackRequested(object? sender, NavigationBackRequestedEventArgs e)
    {
        ArgumentNullException.ThrowIfNull(e);

        // web: if (skipNextPopstateRef.current) { skipNextPopstateRef.current = false; return }
        if (_skipNextBack)
        {
            _skipNextBack = false;
            return;
        }

        // web: const dirty = findDirty(); if (!dirty) return — clean, so the back navigation proceeds.
        NavigationGuardEntry? dirty = _registry.FindDirty();
        if (dirty is null)
        {
            return;
        }

        // web ConfirmDialog auto-resolve when silenced: navigate(-1) immediately, no dialog. The native back
        // request is raised pre-navigation, so allowing it to proceed (Handled stays false) is the same result.
        if (_silence.IsSilenced(NavigationGuardProviderRegistration.SilenceActionKey))
        {
            _diagnostics.RecordSilencedAutoConfirm();
            return;
        }

        // web rolls the URL back with history.pushState so the user stays put; the native back request is
        // cancelable pre-navigation, so cancel it instead (same user-visible result, without a rollback).
        e.Handled = true;

        // web: if (pendingPromiseRef.current) return — a dialog is already up; it answers both call sites.
        if (_pending is not null)
        {
            return;
        }

        // web: create the pending confirm whose resolve replays navigate(-1) on Discard.
        BeginPending(dirty.GetMessage(), replayBack: true);
    }

    private Pending BeginPending(string? message, bool replayBack)
    {
        var pending = new Pending(
            new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously),
            message,
            replayBack);
        _pending = pending;
        SetState(NavigationGuardState.Confirming);
        _diagnostics.RecordConfirmShown();
        return pending;
    }

    private void ClearPending()
    {
        _pending = null;
        SetState(NavigationGuardState.Inert);
    }

    private void SetState(NavigationGuardState value)
    {
        if (_state == value)
        {
            // The message can still have changed (a new guard's message) — re-raise so the view rebinds it.
            RaiseAll();
            return;
        }

        _state = value;
        RaiseAll();
    }

    private void RaiseAll() => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(string.Empty));

    private sealed class Pending(TaskCompletionSource<bool> completion, string? message, bool replayBack)
    {
        public TaskCompletionSource<bool> Completion { get; } = completion;

        public string? Message { get; } = message;

        public bool ReplayBack { get; } = replayBack;
    }
}
