using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="SavedViewMenu"/> view — the native port of the
/// web component body (web/src/components/data-display/SavedViewMenu.tsx). It binds the
/// <see cref="ISavedViewsStore"/> query snapshot (web <c>useSavedViews(route)</c>) and projects the three
/// coordinated pieces the web component renders: the trigger label (the active view's name when the current
/// querystring matches a saved view, otherwise "Saved views"), the popover body (its
/// <see cref="SavedViewMenuContentState"/> + <see cref="SavedViewFreshness"/> chrome and the
/// <see cref="Views"/> list), and the applied badge (shown while a saved view is active). It owns the
/// open-once auto-apply-default behaviour (web <c>autoAppliedRef</c> effect), routes apply / clear / pin /
/// default / save / rename / delete through the injected seams (web <c>onApply</c>, the mutation hooks), and
/// announces apply / clear through the shared announcer bus (web <c>useAnnouncer</c>). It performs no I/O and
/// references no view framework, so every transition is asserted headlessly. Drive it from one confinement
/// (the UI thread); change notifications may originate from the store's emission, and marshalling onto the UI
/// thread is the mounted view's responsibility (mirroring how React reconciles the hook's state).
/// </summary>
public sealed class SavedViewMenuViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ISavedViewsStore _store;
    private readonly ISavedViewMutations _mutations;
    private readonly ISavedViewApplier _applier;
    private readonly IAnnouncerBus _announcer;
    private readonly ILocalizer _localizer;
    private readonly SavedViewMenuDiagnostics _diagnostics;
    private readonly string _route;

    private string _currentQuery;
    private bool _isMenuOpen;
    private bool _isSaving;
    private bool _isRenaming;
    private bool _isDeleting;
    private bool _autoApplied;
    private bool _opened;
    private bool _disposed;

    /// <summary>Creates the holder over its read / write / apply / announcer / i18n seams, the route and the current querystring.</summary>
    /// <param name="store">The saved-views read seam (web <c>useSavedViews(route)</c>).</param>
    /// <param name="mutations">The create / update / delete / set-default seam (web mutation hooks).</param>
    /// <param name="applier">The URL-apply seam (web <c>onApply</c> prop).</param>
    /// <param name="announcer">The screen-reader announcer bus (web <c>useAnnouncer</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="route">The SPA route this menu manages views for (web <c>route</c> prop), e.g. <c>/drives</c>.</param>
    /// <param name="currentQuery">The page's current canonical querystring (web <c>currentQuery</c> prop; no leading <c>?</c>).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public SavedViewMenuViewModel(
        ISavedViewsStore store,
        ISavedViewMutations mutations,
        ISavedViewApplier applier,
        IAnnouncerBus announcer,
        ILocalizer localizer,
        string route,
        string currentQuery = "",
        SavedViewMenuDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(store);
        ArgumentNullException.ThrowIfNull(mutations);
        ArgumentNullException.ThrowIfNull(applier);
        ArgumentNullException.ThrowIfNull(announcer);
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(route);

        _store = store;
        _mutations = mutations;
        _applier = applier;
        _announcer = announcer;
        _localizer = localizer;
        _diagnostics = diagnostics ?? new SavedViewMenuDiagnostics();
        _route = route;
        _currentQuery = currentQuery ?? string.Empty;

        _store.Changed += OnStoreChanged;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    // ── Identity / props ─────────────────────────────────────────────────────────────────────────────────

    /// <summary>The route this menu manages views for (web <c>route</c> prop).</summary>
    public string Route => _route;

    /// <summary>
    /// The page's current canonical querystring (web <c>currentQuery</c> prop). Setting it re-derives the
    /// active view + trigger label and re-evaluates the auto-apply-default guard, mirroring the controlled
    /// prop updating after <c>onApply</c> changes the URL.
    /// </summary>
    public string CurrentQuery
    {
        get => _currentQuery;
        set
        {
            string next = value ?? string.Empty;
            if (string.Equals(_currentQuery, next, StringComparison.Ordinal))
            {
                return;
            }

            _currentQuery = next;
            Raise(nameof(CurrentQuery));
            Raise(nameof(ActiveView));
            Raise(nameof(HasActiveView));
            Raise(nameof(TriggerIsActive));
            Raise(nameof(TriggerLabel));
            Raise(nameof(AppliedBadgeText));
            EvaluateAutoApply();
        }
    }

    // ── Query projection ─────────────────────────────────────────────────────────────────────────────────

    /// <summary>The route's saved views in server render order (web <c>views = viewsRaw ?? []</c>).</summary>
    public IReadOnlyList<SavedView> Views => _store.Current.Value ?? [];

    /// <summary>True when there is at least one saved view (gates the "Manage views" link, web <c>views.length &gt; 0</c>).</summary>
    public bool HasViews => Views.Count > 0;

    /// <summary>
    /// The popover body layout — loading / list / empty / error, projected from the query lifecycle. The web
    /// component only renders empty-vs-list (it collapses an undefined query to an empty array); the native
    /// surface additionally renders the loading + error branches the query actually has.
    /// </summary>
    public SavedViewMenuContentState ContentState
    {
        get
        {
            RepositoryResult<IReadOnlyList<SavedView>> snapshot = _store.Current;
            if (snapshot.Status == LoadStatus.Loading)
            {
                return SavedViewMenuContentState.Loading;
            }

            if (snapshot.Status == LoadStatus.Error)
            {
                return SavedViewMenuContentState.Error;
            }

            return Views.Count == 0
                ? SavedViewMenuContentState.Empty
                : SavedViewMenuContentState.List;
        }
    }

    /// <summary>
    /// The freshness chip overlaid on the list / empty body — fresh / stale / offline, so a cached value is
    /// never hidden behind a refresh.
    /// </summary>
    public SavedViewFreshness Freshness
    {
        get
        {
            RepositoryResult<IReadOnlyList<SavedView>> snapshot = _store.Current;
            if (snapshot.Status == LoadStatus.Offline)
            {
                return SavedViewFreshness.Offline;
            }

            return snapshot.IsStale ? SavedViewFreshness.Stale : SavedViewFreshness.Fresh;
        }
    }

    /// <summary>The saved view whose query matches <see cref="CurrentQuery"/>, or null (web <c>activeView</c>).</summary>
    public SavedView? ActiveView
    {
        get
        {
            foreach (SavedView view in Views)
            {
                if (string.Equals(view.Query, _currentQuery, StringComparison.Ordinal))
                {
                    return view;
                }
            }

            return null;
        }
    }

    /// <summary>The default saved view for this route, or null (web <c>defaultView</c>).</summary>
    public SavedView? DefaultView
    {
        get
        {
            foreach (SavedView view in Views)
            {
                if (view.IsDefault)
                {
                    return view;
                }
            }

            return null;
        }
    }

    /// <summary>True when a saved view is currently applied (web <c>activeView != null</c>).</summary>
    public bool HasActiveView => ActiveView is not null;

    /// <summary>True when the trigger should use the primary/checked treatment (web <c>variant={activeView ? 'primary' : 'secondary'}</c>).</summary>
    public bool TriggerIsActive => HasActiveView;

    // ── Menu open state ──────────────────────────────────────────────────────────────────────────────────

    /// <summary>Whether the popover is open (web <c>open</c> state); the view keeps this in sync with the native flyout.</summary>
    public bool IsMenuOpen
    {
        get => _isMenuOpen;
        private set => Set(ref _isMenuOpen, value);
    }

    /// <summary>Open the popover (web <c>setOpen(true)</c>).</summary>
    public void OpenMenu() => IsMenuOpen = true;

    /// <summary>Close the popover (web <c>setOpen(false)</c> / outside-click / Escape).</summary>
    public void CloseMenu() => IsMenuOpen = false;

    /// <summary>Toggle the popover (web trigger <c>onClick={() =&gt; setOpen(v =&gt; !v)}</c>).</summary>
    public void ToggleMenu() => IsMenuOpen = !_isMenuOpen;

    // ── Dialog pending flags (web mutation isPending) ────────────────────────────────────────────────────

    /// <summary>True while a create is in flight (web <c>createMut.isPending</c>); the Save button shows "Saving…".</summary>
    public bool IsSaving
    {
        get => _isSaving;
        private set => Set(ref _isSaving, value);
    }

    /// <summary>True while a rename update is in flight (web <c>updateMut.isPending</c>).</summary>
    public bool IsRenaming
    {
        get => _isRenaming;
        private set => Set(ref _isRenaming, value);
    }

    /// <summary>True while a delete is in flight (web <c>deleteMut.isPending</c>); the confirm dialog shows its loading state.</summary>
    public bool IsDeleting
    {
        get => _isDeleting;
        private set => Set(ref _isDeleting, value);
    }

    // ── Localized labels ─────────────────────────────────────────────────────────────────────────────────

    /// <summary>The trigger / menu title (web <c>savedViews.title</c>).</summary>
    public string Title => L(SavedViewMenuRegistration.TitleKey, SavedViewMenuRegistration.TitleFallback);

    /// <summary>The trigger label — the active view name when applied, else the menu title (web <c>triggerLabel</c>).</summary>
    public string TriggerLabel => ActiveView?.Name ?? Title;

    /// <summary>The "Manage views" link label (web <c>savedViews.manage</c>).</summary>
    public string ManageLabel => L(SavedViewMenuRegistration.ManageKey, SavedViewMenuRegistration.ManageFallback);

    /// <summary>The empty-state message (web <c>savedViews.empty</c>).</summary>
    public string EmptyLabel => L(SavedViewMenuRegistration.EmptyKey, SavedViewMenuRegistration.EmptyFallback);

    /// <summary>The "Save current view…" action label (web <c>savedViews.saveCurrent</c>).</summary>
    public string SaveCurrentLabel => L(SavedViewMenuRegistration.SaveCurrentKey, SavedViewMenuRegistration.SaveCurrentFallback);

    /// <summary>The default-marker label (web <c>savedViews.defaultBadge</c>).</summary>
    public string DefaultBadgeLabel => L(SavedViewMenuRegistration.DefaultBadgeKey, SavedViewMenuRegistration.DefaultBadgeFallback);

    /// <summary>The applied-badge prefix (web <c>savedViews.appliedBadge</c>).</summary>
    public string AppliedBadgeLabel => L(SavedViewMenuRegistration.AppliedBadgeKey, SavedViewMenuRegistration.AppliedBadgeFallback);

    /// <summary>The active view's name shown in the applied badge, or empty when none is applied (web <c>activeView.name</c>).</summary>
    public string AppliedBadgeText => ActiveView?.Name ?? string.Empty;

    /// <summary>The clear-applied-view action label (web <c>savedViews.clearApplied</c>).</summary>
    public string ClearAppliedLabel => L(SavedViewMenuRegistration.ClearAppliedKey, SavedViewMenuRegistration.ClearAppliedFallback);

    /// <summary>The name-field label (web <c>savedViews.name</c>).</summary>
    public string NameLabel => L(SavedViewMenuRegistration.NameKey, SavedViewMenuRegistration.NameFallback);

    /// <summary>The name-field hint (web saved-view name-field hint).</summary>
    public string NameHint => L(SavedViewMenuRegistration.NameHintKey, SavedViewMenuRegistration.NameHintFallback);

    /// <summary>The "apply automatically" toggle label (web <c>savedViews.makeDefault</c>).</summary>
    public string MakeDefaultLabel => L(SavedViewMenuRegistration.MakeDefaultKey, SavedViewMenuRegistration.MakeDefaultFallback);

    /// <summary>The rename-dialog title (web <c>savedViews.renamePrompt</c>).</summary>
    public string RenameTitle => L(SavedViewMenuRegistration.RenamePromptKey, SavedViewMenuRegistration.RenamePromptFallback);

    /// <summary>The delete-dialog title (web <c>savedViews.deleteTitle</c>).</summary>
    public string DeleteTitle => L(SavedViewMenuRegistration.DeleteTitleKey, SavedViewMenuRegistration.DeleteTitleFallback);

    /// <summary>The empty-query manage-row tooltip (web <c>savedViews.emptyQuery</c>).</summary>
    public string EmptyQueryLabel => L(SavedViewMenuRegistration.EmptyQueryKey, SavedViewMenuRegistration.EmptyQueryFallback);

    /// <summary>The delete action label (web <c>common.delete</c>).</summary>
    public string DeleteLabel => L(SavedViewMenuRegistration.DeleteKey, SavedViewMenuRegistration.DeleteFallback);

    /// <summary>The cancel action label (web <c>common.cancel</c>).</summary>
    public string CancelLabel => L(SavedViewMenuRegistration.CancelKey, SavedViewMenuRegistration.CancelFallback);

    /// <summary>The save action label (web <c>common.save</c>).</summary>
    public string SaveLabel => L(SavedViewMenuRegistration.SaveKey, SavedViewMenuRegistration.SaveFallback);

    /// <summary>The saving label (web <c>common.saving</c>).</summary>
    public string SavingLabel => L(SavedViewMenuRegistration.SavingKey, SavedViewMenuRegistration.SavingFallback);

    /// <summary>The Save button label — "Saving…" while a create is in flight, else "Save" (web <c>{saving ? saving : save}</c>).</summary>
    public string SaveButtonLabel => IsSaving ? SavingLabel : SaveLabel;

    /// <summary>The close action label (web <c>common.close</c>).</summary>
    public string CloseLabel => L(SavedViewMenuRegistration.CloseKey, SavedViewMenuRegistration.CloseFallback);

    /// <summary>The loading chrome's accessible name (native loading branch).</summary>
    public string LoadingLabel => L(SavedViewMenuRegistration.LoadingKey, SavedViewMenuRegistration.LoadingFallback);

    /// <summary>The load-error title (native error branch).</summary>
    public string LoadErrorLabel => L(SavedViewMenuRegistration.LoadErrorKey, SavedViewMenuRegistration.LoadErrorFallback);

    /// <summary>The retry affordance label (native error branch, canonical <c>common.retry</c>).</summary>
    public string RetryLabel => L(SavedViewMenuRegistration.RetryKey, SavedViewMenuRegistration.RetryFallback);

    /// <summary>The stale chip label (native stale branch).</summary>
    public string StaleLabel => L(SavedViewMenuRegistration.StaleKey, SavedViewMenuRegistration.StaleFallback);

    /// <summary>The offline chip label (native offline branch).</summary>
    public string OfflineLabel => L(SavedViewMenuRegistration.OfflineKey, SavedViewMenuRegistration.OfflineFallback);

    /// <summary>The pin / unpin action label for a row (web <c>v.is_pinned ? unpin : pin</c>).</summary>
    public string PinLabelFor(SavedView view)
    {
        ArgumentNullException.ThrowIfNull(view);
        return view.IsPinned
            ? L(SavedViewMenuRegistration.UnpinKey, SavedViewMenuRegistration.UnpinFallback)
            : L(SavedViewMenuRegistration.PinKey, SavedViewMenuRegistration.PinFallback);
    }

    /// <summary>The set-default / clear-default action label for a row (web <c>v.is_default ? unsetDefault : setDefault</c>).</summary>
    public string DefaultLabelFor(SavedView view)
    {
        ArgumentNullException.ThrowIfNull(view);
        return view.IsDefault
            ? L(SavedViewMenuRegistration.UnsetDefaultKey, SavedViewMenuRegistration.UnsetDefaultFallback)
            : L(SavedViewMenuRegistration.SetDefaultKey, SavedViewMenuRegistration.SetDefaultFallback);
    }

    /// <summary>The rename action label for a row (web <c>savedViews.renamePrompt</c>).</summary>
    public string RenameLabel => RenameTitle;

    /// <summary>The delete-confirm body for a row, with the name interpolated (web <c>savedViews.deleteConfirm</c>).</summary>
    public string DeleteConfirmMessageFor(SavedView view)
    {
        ArgumentNullException.ThrowIfNull(view);
        return SavedViewMenuRegistration.FormatName(
            L(SavedViewMenuRegistration.DeleteConfirmKey, SavedViewMenuRegistration.DeleteConfirmFallback),
            view.Name);
    }

    /// <summary>The manage-row tooltip for a view — its querystring, or "No filters" when empty (web <c>v.query || emptyQuery</c>).</summary>
    public string QueryTooltipFor(SavedView view)
    {
        ArgumentNullException.ThrowIfNull(view);
        return string.IsNullOrEmpty(view.Query) ? EmptyQueryLabel : view.Query;
    }

    // ── Validation (pure, headless-testable) ─────────────────────────────────────────────────────────────

    /// <summary>Whether the Save action can fire (web <c>disabled={!trimmed || saving}</c>, inverted).</summary>
    public bool CanSave(string? name) => !IsSaving && !string.IsNullOrWhiteSpace(name);

    /// <summary>Whether the Rename action can fire — non-empty (web <c>disabled={!trimmed || saving}</c>, inverted).</summary>
    public bool CanRename(string? name) => !IsRenaming && !string.IsNullOrWhiteSpace(name);

    // ── Commands ─────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Apply a saved view (web <c>handleApply</c>): re-apply its querystring, close the popover, and announce
    /// "View {name} applied". The host feeds the new URL back through <see cref="CurrentQuery"/>, mirroring
    /// the controlled prop round-trip.
    /// </summary>
    public void Apply(SavedView view)
    {
        ArgumentNullException.ThrowIfNull(view);
        _applier.Apply(view.Query);
        CloseMenu();
        _announcer.Announce(
            SavedViewMenuRegistration.FormatName(
                L(SavedViewMenuRegistration.AnnounceAppliedKey, SavedViewMenuRegistration.AnnounceAppliedFallback),
                view.Name));
    }

    /// <summary>
    /// Clear the applied view (web <c>handleClear</c>): reset the URL to the unfiltered route and announce
    /// "Saved view cleared". Does not close the popover (the clear affordance lives on the badge, outside it).
    /// </summary>
    public void Clear()
    {
        _applier.Apply(string.Empty);
        _announcer.Announce(L(SavedViewMenuRegistration.AnnounceClearedKey, SavedViewMenuRegistration.AnnounceClearedFallback));
    }

    /// <summary>Toggle a view's pinned flag (web <c>handleTogglePin</c>): patch <c>is_pinned</c>, then refresh the list.</summary>
    public async Task TogglePinAsync(SavedView view)
    {
        ArgumentNullException.ThrowIfNull(view);
        await _mutations.UpdateAsync(view.Id, view.Route, new SavedViewUpdateInput(IsPinned: !view.IsPinned)).ConfigureAwait(false);
        _store.Refresh();
    }

    /// <summary>Toggle a view's default flag (web <c>handleToggleDefault</c>): set <c>is_default</c>, then refresh the list.</summary>
    public async Task ToggleDefaultAsync(SavedView view)
    {
        ArgumentNullException.ThrowIfNull(view);
        await _mutations.SetDefaultAsync(view.Id, view.Route, !view.IsDefault).ConfigureAwait(false);
        _store.Refresh();
    }

    /// <summary>
    /// Create a saved view from the current querystring (web Save dialog <c>onSave</c> → <c>createMut.mutate</c>).
    /// Returns <see langword="true"/> when the create ran (the view then closes the dialog, web <c>onSuccess</c>),
    /// <see langword="false"/> when the name was blank. Refreshes the list on success (web <c>invalidate</c>).
    /// </summary>
    public async Task<bool> SaveAsync(string name, bool makeDefault)
    {
        string trimmed = (name ?? string.Empty).Trim();
        if (trimmed.Length == 0)
        {
            return false;
        }

        IsSaving = true;
        try
        {
            await _mutations.CreateAsync(new SavedViewCreateInput(trimmed, _route, _currentQuery, makeDefault)).ConfigureAwait(false);
            _store.Refresh();
            return true;
        }
        finally
        {
            IsSaving = false;
        }
    }

    /// <summary>
    /// Rename a saved view (web Rename dialog <c>onRename</c>). A blank name is rejected
    /// (<see langword="false"/>); an unchanged name closes without a mutation (web <c>onClose</c>,
    /// <see langword="true"/>); otherwise it patches <c>name</c>, refreshes and returns <see langword="true"/>.
    /// </summary>
    public async Task<bool> RenameAsync(SavedView view, string name)
    {
        ArgumentNullException.ThrowIfNull(view);
        string trimmed = (name ?? string.Empty).Trim();
        if (trimmed.Length == 0)
        {
            return false;
        }

        if (string.Equals(trimmed, view.Name, StringComparison.Ordinal))
        {
            return true;
        }

        IsRenaming = true;
        try
        {
            await _mutations.UpdateAsync(view.Id, view.Route, new SavedViewUpdateInput(Name: trimmed)).ConfigureAwait(false);
            _store.Refresh();
            return true;
        }
        finally
        {
            IsRenaming = false;
        }
    }

    /// <summary>
    /// Delete a saved view (web delete <c>ConfirmDialog</c> <c>onConfirm</c> → <c>deleteMut.mutate</c>).
    /// Tracks <see cref="IsDeleting"/> for the confirm dialog's loading state and refreshes on success.
    /// </summary>
    public async Task DeleteAsync(SavedView view)
    {
        ArgumentNullException.ThrowIfNull(view);
        IsDeleting = true;
        try
        {
            await _mutations.DeleteAsync(view.Id, view.Route).ConfigureAwait(false);
            _store.Refresh();
        }
        finally
        {
            IsDeleting = false;
        }
    }

    /// <summary>Request a list refresh (the error-retry button and the stale auto-refresh) — web <c>refetch</c>.</summary>
    public void Refresh() => _store.Refresh();

    /// <summary>
    /// Record that the surface mounted (web mount): emit the <c>view.opened</c> diagnostic exactly once and
    /// evaluate the auto-apply-default guard (the web mount effect). Idempotent.
    /// </summary>
    public void NotifyOpened()
    {
        if (!_opened && !_disposed)
        {
            _opened = true;
            _diagnostics.RecordViewOpened();
        }

        EvaluateAutoApply();
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _store.Changed -= OnStoreChanged;
        GC.SuppressFinalize(this);
    }

    private void OnStoreChanged(object? sender, EventArgs e)
    {
        Raise(nameof(Views));
        Raise(nameof(HasViews));
        Raise(nameof(ContentState));
        Raise(nameof(Freshness));
        Raise(nameof(ActiveView));
        Raise(nameof(DefaultView));
        Raise(nameof(HasActiveView));
        Raise(nameof(TriggerIsActive));
        Raise(nameof(TriggerLabel));
        Raise(nameof(AppliedBadgeText));
        EvaluateAutoApply();
    }

    /// <summary>
    /// Auto-apply the route's default view exactly once on first mount when the URL has no querystring — the
    /// native port of the web <c>autoAppliedRef</c> effect (web/src/components/data-display/SavedViewMenu.tsx
    /// L93-L105). When no default exists yet the guard stays unset so a later emission can apply it; when the
    /// URL already carries filters the guard is set without applying (never overwrite a deep-link).
    /// </summary>
    private void EvaluateAutoApply()
    {
        if (_autoApplied)
        {
            return;
        }

        SavedView? defaultView = DefaultView;
        if (defaultView is null)
        {
            return;
        }

        if (!string.IsNullOrEmpty(_currentQuery))
        {
            _autoApplied = true;
            return;
        }

        _autoApplied = true;
        _applier.Apply(defaultView.Query);
    }

    private string L(string key, string fallback) => _localizer.GetString(key, fallback);

    private void Set<T>(ref T field, T value, [CallerMemberName] string? propertyName = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return;
        }

        field = value;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));

        if (string.Equals(propertyName, nameof(IsSaving), StringComparison.Ordinal))
        {
            PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(SaveButtonLabel)));
        }
    }

    private void Raise([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
