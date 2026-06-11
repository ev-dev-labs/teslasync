using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the SavedViewMenu surface's UI-thread-free logic — the registration slug + i18n
/// keys (<see cref="SavedViewMenuRegistration"/>), the data adapter (<see cref="SavedViewsStore"/> /
/// <see cref="ISavedViewMutations"/> / <see cref="ISavedViewApplier"/> seams with their canonical,
/// delegate-backed and inert implementations), the per-state projection + command routing
/// (<see cref="SavedViewMenuViewModel"/>) and the PII-safe diagnostics. Mirrors the web spec one-for-one
/// (web/src/components/data-display/SavedViewMenu.tsx, web/src/api/hooks/useSavedViews.ts). The WinUI view
/// (SavedViewMenu.cs, which composes a TsButton trigger + Flyout popover + TsModal / TsConfirmDialog dialogs)
/// is exercised by the app build.
/// </summary>
public sealed class SavedViewMenuTests
{
    private const string Route = "/drives";

    // ── recording doubles ────────────────────────────────────────────────────────────────────────────────

    private sealed class RecordingApplier : ISavedViewApplier
    {
        public List<string> Applied { get; } = [];

        public void Apply(string query) => Applied.Add(query);
    }

    private sealed class RecordingAnnouncer : IAnnouncerBus
    {
        public List<(string Message, AnnouncerPriority Priority)> Announcements { get; } = [];

        public void Announce(string message, AnnouncerPriority priority = AnnouncerPriority.Polite) =>
            Announcements.Add((message, priority));

        public IDisposable Subscribe(AnnouncerListener listener) => new Noop();

        private sealed class Noop : IDisposable
        {
            public void Dispose()
            {
            }
        }
    }

    private sealed class RecordingMutations : ISavedViewMutations
    {
        public List<SavedViewCreateInput> Creates { get; } = [];

        public List<(long Id, string Route, SavedViewUpdateInput Patch)> Updates { get; } = [];

        public List<(long Id, string Route)> Deletes { get; } = [];

        public List<(long Id, string Route, bool IsDefault)> SetDefaults { get; } = [];

        public Func<Task>? Gate { get; set; }

        private Task Run() => Gate?.Invoke() ?? Task.CompletedTask;

        public async Task CreateAsync(SavedViewCreateInput input, CancellationToken cancellationToken = default)
        {
            Creates.Add(input);
            await Run().ConfigureAwait(false);
        }

        public async Task UpdateAsync(long id, string route, SavedViewUpdateInput patch, CancellationToken cancellationToken = default)
        {
            Updates.Add((id, route, patch));
            await Run().ConfigureAwait(false);
        }

        public async Task DeleteAsync(long id, string route, CancellationToken cancellationToken = default)
        {
            Deletes.Add((id, route));
            await Run().ConfigureAwait(false);
        }

        public async Task SetDefaultAsync(long id, string route, bool isDefault, CancellationToken cancellationToken = default)
        {
            SetDefaults.Add((id, route, isDefault));
            await Run().ConfigureAwait(false);
        }
    }

    private static SavedView MakeView(
        long id,
        string name,
        string query,
        bool isDefault = false,
        bool isPinned = false) =>
        new(id, name, Route, query, isDefault, isPinned);

    private static (SavedViewMenuViewModel Vm, SavedViewsStore Store, RecordingMutations Mut, RecordingApplier Applier, RecordingAnnouncer Ann, int[] RefreshCount) BuildVm(
        RepositoryResult<IReadOnlyList<SavedView>>? initial = null,
        string currentQuery = "",
        List<string>? diagnosticsSink = null)
    {
        int[] refreshCount = [0];
        var store = new SavedViewsStore(initial, onRefresh: () => refreshCount[0]++);
        var mut = new RecordingMutations();
        var applier = new RecordingApplier();
        var ann = new RecordingAnnouncer();
        SavedViewMenuDiagnostics diagnostics = diagnosticsSink is null
            ? new SavedViewMenuDiagnostics()
            : new SavedViewMenuDiagnostics(diagnosticsSink.Add);
        var vm = new SavedViewMenuViewModel(store, mut, applier, ann, PassthroughLocalizer.Instance, Route, currentQuery, diagnostics);
        return (vm, store, mut, applier, ann, refreshCount);
    }

    private static RepositoryResult<IReadOnlyList<SavedView>> Loaded(params SavedView[] views) =>
        RepositoryResult<IReadOnlyList<SavedView>>.Loaded(views, DateTimeOffset.UtcNow);

    // ── registration / i18n (a11y label coverage) ───────────────────────────────────────────────────────

    [Fact]
    public void Registration_Slug_IsSavedViewMenu() =>
        Assert.Equal("SavedViewMenu", SavedViewMenuRegistration.Slug);

    [Theory]
    [InlineData(SavedViewMenuRegistration.TitleKey)]
    [InlineData(SavedViewMenuRegistration.ManageKey)]
    [InlineData(SavedViewMenuRegistration.EmptyKey)]
    [InlineData(SavedViewMenuRegistration.SaveCurrentKey)]
    [InlineData(SavedViewMenuRegistration.DefaultBadgeKey)]
    [InlineData(SavedViewMenuRegistration.UnsetDefaultKey)]
    [InlineData(SavedViewMenuRegistration.SetDefaultKey)]
    [InlineData(SavedViewMenuRegistration.UnpinKey)]
    [InlineData(SavedViewMenuRegistration.PinKey)]
    [InlineData(SavedViewMenuRegistration.RenamePromptKey)]
    [InlineData(SavedViewMenuRegistration.AnnounceAppliedKey)]
    [InlineData(SavedViewMenuRegistration.AnnounceClearedKey)]
    [InlineData(SavedViewMenuRegistration.AppliedBadgeKey)]
    [InlineData(SavedViewMenuRegistration.ClearAppliedKey)]
    [InlineData(SavedViewMenuRegistration.EmptyQueryKey)]
    [InlineData(SavedViewMenuRegistration.DeleteTitleKey)]
    [InlineData(SavedViewMenuRegistration.DeleteConfirmKey)]
    [InlineData(SavedViewMenuRegistration.NameHintKey)]
    [InlineData(SavedViewMenuRegistration.NameKey)]
    [InlineData(SavedViewMenuRegistration.MakeDefaultKey)]
    [InlineData(SavedViewMenuRegistration.DeleteKey)]
    [InlineData(SavedViewMenuRegistration.CancelKey)]
    [InlineData(SavedViewMenuRegistration.SavingKey)]
    [InlineData(SavedViewMenuRegistration.SaveKey)]
    [InlineData(SavedViewMenuRegistration.CloseKey)]
    [InlineData(SavedViewMenuRegistration.LoadingKey)]
    [InlineData(SavedViewMenuRegistration.LoadErrorKey)]
    [InlineData(SavedViewMenuRegistration.RetryKey)]
    [InlineData(SavedViewMenuRegistration.StaleKey)]
    [InlineData(SavedViewMenuRegistration.OfflineKey)]
    public void Registration_Keys_CarryTranslationPrefix(string key) =>
        Assert.StartsWith("translation.", key, StringComparison.Ordinal);

    [Fact]
    public void Registration_Fallbacks_MatchWebVerbatim()
    {
        Assert.Equal("Saved views", SavedViewMenuRegistration.TitleFallback);
        Assert.Equal("Manage views", SavedViewMenuRegistration.ManageFallback);
        Assert.Equal("No saved views yet", SavedViewMenuRegistration.EmptyFallback);
        Assert.Equal("Save current view\u2026", SavedViewMenuRegistration.SaveCurrentFallback);
        Assert.Equal("Set as default", SavedViewMenuRegistration.SetDefaultFallback);
        Assert.Equal("Clear default", SavedViewMenuRegistration.UnsetDefaultFallback);
        Assert.Equal("View {{name}} applied", SavedViewMenuRegistration.AnnounceAppliedFallback);
        Assert.Equal("Saved view cleared", SavedViewMenuRegistration.AnnounceClearedFallback);
        Assert.Equal("Apply automatically when I open this page", SavedViewMenuRegistration.MakeDefaultFallback);
        Assert.Equal("Delete saved view \"{{name}}\"?", SavedViewMenuRegistration.DeleteConfirmFallback);
        Assert.Equal("Saving\u2026", SavedViewMenuRegistration.SavingFallback);
        Assert.Equal("No filters", SavedViewMenuRegistration.EmptyQueryFallback);
    }

    [Fact]
    public void FormatName_InterpolatesNameToken()
    {
        Assert.Equal("View Daily commute applied",
            SavedViewMenuRegistration.FormatName("View {{name}} applied", "Daily commute"));
        Assert.Equal("Delete saved view \"Trips\"?",
            SavedViewMenuRegistration.FormatName("Delete saved view \"{{name}}\"?", "Trips"));
    }

    // ── diagnostics ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void NotifyOpened_RecordsViewOpenedOnce()
    {
        var sink = new List<string>();
        (SavedViewMenuViewModel vm, _, _, _, _, _) = BuildVm(diagnosticsSink: sink);

        vm.NotifyOpened();
        vm.NotifyOpened();

        Assert.Single(sink);
        Assert.Equal("view.opened slug=SavedViewMenu", sink[0]);
    }

    // ── data adapter (Source seams) ──────────────────────────────────────────────────────────────────────

    [Fact]
    public void Store_SetViews_ProjectsEmptyVsLoaded()
    {
        var store = new SavedViewsStore();
        Assert.Equal(LoadStatus.Loading, store.Current.Status);

        store.SetViews([]);
        Assert.Equal(LoadStatus.Empty, store.Current.Status);

        store.SetViews([MakeView(1, "A", "a=1")]);
        Assert.Equal(LoadStatus.Loaded, store.Current.Status);
        Assert.Single(store.Current.Value!);
    }

    [Fact]
    public void Store_Refresh_InvokesCallback()
    {
        int count = 0;
        var store = new SavedViewsStore(onRefresh: () => count++);
        store.Refresh();
        store.Refresh();
        Assert.Equal(2, count);
    }

    [Fact]
    public async Task Mutations_DelegateBacked_AreInvoked()
    {
        var created = new List<SavedViewCreateInput>();
        var mut = new SavedViewMutations(create: (input, _) =>
        {
            created.Add(input);
            return Task.CompletedTask;
        });

        await mut.CreateAsync(new SavedViewCreateInput("N", Route, "q=1"));

        Assert.Single(created);
        Assert.Equal("N", created[0].Name);
    }

    [Fact]
    public async Task Mutations_Inert_DoNotThrow()
    {
        ISavedViewMutations mut = InertSavedViewMutations.Instance;
        await mut.CreateAsync(new SavedViewCreateInput("N", Route, "q"));
        await mut.UpdateAsync(1, Route, new SavedViewUpdateInput(Name: "x"));
        await mut.DeleteAsync(1, Route);
        await mut.SetDefaultAsync(1, Route, true);
    }

    [Fact]
    public void Applier_DelegateBacked_ForwardsQuery_AndInertIsSafe()
    {
        var seen = new List<string>();
        ISavedViewApplier applier = new SavedViewApplier(seen.Add);
        applier.Apply("vehicle_id=3");
        Assert.Equal("vehicle_id=3", Assert.Single(seen));

        InertSavedViewApplier.Instance.Apply("ignored");
    }

    // ── per-state projection ─────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void ContentState_Loading_WhenStoreLoading()
    {
        (SavedViewMenuViewModel vm, _, _, _, _, _) = BuildVm(RepositoryResult<IReadOnlyList<SavedView>>.Loading());
        Assert.Equal(SavedViewMenuContentState.Loading, vm.ContentState);
        Assert.Equal(SavedViewFreshness.Fresh, vm.Freshness);
        Assert.Empty(vm.Views);
    }

    [Fact]
    public void ContentState_Empty_WhenResolvedWithNoRows()
    {
        (SavedViewMenuViewModel vm, SavedViewsStore store, _, _, _, _) = BuildVm();
        store.SetViews([]);
        Assert.Equal(SavedViewMenuContentState.Empty, vm.ContentState);
        Assert.False(vm.HasViews);
    }

    [Fact]
    public void ContentState_Error_WhenFailure()
    {
        var err = new RepositoryError(RepositoryErrorKind.Server, "boom", 500);
        (SavedViewMenuViewModel vm, _, _, _, _, _) = BuildVm(RepositoryResult<IReadOnlyList<SavedView>>.Failure(err));
        Assert.Equal(SavedViewMenuContentState.Error, vm.ContentState);
    }

    [Fact]
    public void ContentState_List_WhenHasViews()
    {
        (SavedViewMenuViewModel vm, _, _, _, _, _) = BuildVm(Loaded(MakeView(1, "A", "a=1")));
        Assert.Equal(SavedViewMenuContentState.List, vm.ContentState);
        Assert.True(vm.HasViews);
    }

    [Fact]
    public void Freshness_Offline_KeepsCachedViewsVisible()
    {
        var err = new RepositoryError(RepositoryErrorKind.Offline, "offline");
        IReadOnlyList<SavedView> views = [MakeView(1, "A", "a=1")];
        var snap = RepositoryResult<IReadOnlyList<SavedView>>.OfflineCached(views, DateTimeOffset.UtcNow, err);
        (SavedViewMenuViewModel vm, _, _, _, _, _) = BuildVm(snap);

        Assert.Equal(SavedViewFreshness.Offline, vm.Freshness);
        Assert.Equal(SavedViewMenuContentState.List, vm.ContentState);
        Assert.Single(vm.Views);
    }

    [Fact]
    public void Freshness_Stale_WhenCachedStale()
    {
        IReadOnlyList<SavedView> views = [MakeView(1, "A", "a=1")];
        var snap = RepositoryResult<IReadOnlyList<SavedView>>.Cached(views, DateTimeOffset.UtcNow, stale: true);
        (SavedViewMenuViewModel vm, _, _, _, _, _) = BuildVm(snap);

        Assert.Equal(SavedViewFreshness.Stale, vm.Freshness);
        Assert.Equal(SavedViewMenuContentState.List, vm.ContentState);
    }

    [Fact]
    public void Freshness_Fresh_WhenLoaded()
    {
        (SavedViewMenuViewModel vm, _, _, _, _, _) = BuildVm(Loaded(MakeView(1, "A", "a=1")));
        Assert.Equal(SavedViewFreshness.Fresh, vm.Freshness);
    }

    // ── trigger / active view / applied badge ────────────────────────────────────────────────────────────

    [Fact]
    public void TriggerLabel_IsTitle_WhenNoActiveView()
    {
        (SavedViewMenuViewModel vm, _, _, _, _, _) = BuildVm(Loaded(MakeView(1, "Daily", "a=1")), currentQuery: "other=2");
        Assert.False(vm.TriggerIsActive);
        Assert.Equal("Saved views", vm.TriggerLabel);
        Assert.Equal(string.Empty, vm.AppliedBadgeText);
    }

    [Fact]
    public void TriggerLabel_IsActiveName_WhenQueryMatches()
    {
        (SavedViewMenuViewModel vm, _, _, _, _, _) = BuildVm(Loaded(MakeView(1, "Daily commute", "vehicle_id=1")), currentQuery: "vehicle_id=1");
        Assert.True(vm.TriggerIsActive);
        Assert.Equal("Daily commute", vm.TriggerLabel);
        Assert.Equal("Daily commute", vm.AppliedBadgeText);
        Assert.NotNull(vm.ActiveView);
    }

    [Fact]
    public void CurrentQuery_Change_RecomputesActiveView_AndNotifies()
    {
        (SavedViewMenuViewModel vm, _, _, _, _, _) = BuildVm(Loaded(MakeView(1, "Daily", "vehicle_id=1")));
        var changed = new List<string>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName ?? string.Empty);

        Assert.Null(vm.ActiveView);
        vm.CurrentQuery = "vehicle_id=1";

        Assert.NotNull(vm.ActiveView);
        Assert.Contains(nameof(vm.TriggerLabel), changed);
        Assert.Contains(nameof(vm.ActiveView), changed);
    }

    // ── auto-apply default (the autoAppliedRef effect) ───────────────────────────────────────────────────

    [Fact]
    public void AutoApply_AppliesDefaultOnce_WhenQueryEmpty()
    {
        (SavedViewMenuViewModel vm, SavedViewsStore store, _, RecordingApplier applier, _, _) =
            BuildVm(Loaded(MakeView(1, "Default view", "preset=1", isDefault: true)), currentQuery: string.Empty);

        vm.NotifyOpened();
        Assert.Equal(["preset=1"], applier.Applied);

        // A second mount signal / store emission must not re-apply (web autoAppliedRef guard).
        vm.NotifyOpened();
        store.Set(Loaded(MakeView(1, "Default view", "preset=1", isDefault: true)));
        Assert.Single(applier.Applied);
    }

    [Fact]
    public void AutoApply_SkipsAndLocks_WhenDeepLinkPresent()
    {
        (SavedViewMenuViewModel vm, _, _, RecordingApplier applier, _, _) =
            BuildVm(Loaded(MakeView(1, "Default view", "preset=1", isDefault: true)), currentQuery: "vehicle_id=9");

        vm.NotifyOpened();
        Assert.Empty(applier.Applied);

        // Even if the user later clears the query, the guard is set so we never auto-apply over their intent.
        vm.CurrentQuery = string.Empty;
        Assert.Empty(applier.Applied);
    }

    [Fact]
    public void AutoApply_WaitsForDefault_ThenAppliesWhenItArrives()
    {
        (SavedViewMenuViewModel vm, SavedViewsStore store, _, RecordingApplier applier, _, _) =
            BuildVm(RepositoryResult<IReadOnlyList<SavedView>>.Loading(), currentQuery: string.Empty);

        vm.NotifyOpened();
        Assert.Empty(applier.Applied); // no default yet -> guard stays unset

        store.Set(Loaded(MakeView(2, "Pinned default", "preset=7", isDefault: true)));
        Assert.Equal(["preset=7"], applier.Applied);
    }

    [Fact]
    public void AutoApply_NeverApplies_WhenNoDefaultExists()
    {
        (SavedViewMenuViewModel vm, _, _, RecordingApplier applier, _, _) =
            BuildVm(Loaded(MakeView(1, "Plain", "a=1")), currentQuery: string.Empty);

        vm.NotifyOpened();
        Assert.Empty(applier.Applied);
    }

    // ── commands ─────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Apply_RoutesQuery_ClosesMenu_Announces()
    {
        (SavedViewMenuViewModel vm, _, _, RecordingApplier applier, RecordingAnnouncer ann, _) =
            BuildVm(Loaded(MakeView(1, "Daily", "vehicle_id=1")));
        vm.OpenMenu();

        vm.Apply(MakeView(1, "Daily", "vehicle_id=1"));

        Assert.Equal("vehicle_id=1", Assert.Single(applier.Applied));
        Assert.False(vm.IsMenuOpen);
        Assert.Equal("View Daily applied", Assert.Single(ann.Announcements).Message);
    }

    [Fact]
    public void Clear_RoutesEmpty_Announces_KeepsMenuState()
    {
        (SavedViewMenuViewModel vm, _, _, RecordingApplier applier, RecordingAnnouncer ann, _) =
            BuildVm(Loaded(MakeView(1, "Daily", "vehicle_id=1")), currentQuery: "vehicle_id=1");

        vm.Clear();

        Assert.Equal(string.Empty, Assert.Single(applier.Applied));
        Assert.Equal("Saved view cleared", Assert.Single(ann.Announcements).Message);
    }

    [Fact]
    public async Task TogglePin_PatchesIsPinned_AndRefreshes()
    {
        (SavedViewMenuViewModel vm, _, RecordingMutations mut, _, _, int[] refresh) =
            BuildVm(Loaded(MakeView(1, "A", "a=1", isPinned: false)));

        await vm.TogglePinAsync(MakeView(1, "A", "a=1", isPinned: false));

        (long id, string route, SavedViewUpdateInput patch) = Assert.Single(mut.Updates);
        Assert.Equal(1, id);
        Assert.Equal(Route, route);
        Assert.True(patch.IsPinned);
        Assert.Equal(1, refresh[0]);
    }

    [Fact]
    public async Task ToggleDefault_SetsDefault_AndRefreshes()
    {
        (SavedViewMenuViewModel vm, _, RecordingMutations mut, _, _, int[] refresh) =
            BuildVm(Loaded(MakeView(1, "A", "a=1", isDefault: false)));

        await vm.ToggleDefaultAsync(MakeView(1, "A", "a=1", isDefault: false));

        (long id, string route, bool isDefault) = Assert.Single(mut.SetDefaults);
        Assert.Equal(1, id);
        Assert.Equal(Route, route);
        Assert.True(isDefault);
        Assert.Equal(1, refresh[0]);
    }

    [Fact]
    public async Task SaveAsync_BlankName_ReturnsFalse_NoCreate()
    {
        (SavedViewMenuViewModel vm, _, RecordingMutations mut, _, _, _) = BuildVm();
        bool ok = await vm.SaveAsync("   ", makeDefault: false);
        Assert.False(ok);
        Assert.Empty(mut.Creates);
    }

    [Fact]
    public async Task SaveAsync_ValidName_Creates_TogglesPending_Refreshes()
    {
        (SavedViewMenuViewModel vm, _, RecordingMutations mut, _, _, int[] refresh) = BuildVm(currentQuery: "vehicle_id=2");
        var gate = new TaskCompletionSource();
        mut.Gate = () => gate.Task;

        Task<bool> save = vm.SaveAsync("  Weekend  ", makeDefault: true);
        Assert.True(vm.IsSaving);
        Assert.Equal("Saving\u2026", vm.SaveButtonLabel);

        gate.SetResult();
        bool ok = await save;

        Assert.True(ok);
        Assert.False(vm.IsSaving);
        SavedViewCreateInput created = Assert.Single(mut.Creates);
        Assert.Equal("Weekend", created.Name);          // trimmed
        Assert.Equal(Route, created.Route);
        Assert.Equal("vehicle_id=2", created.Query);     // current querystring captured
        Assert.True(created.IsDefault);
        Assert.Equal(1, refresh[0]);
    }

    [Fact]
    public async Task RenameAsync_Unchanged_ClosesWithoutUpdate()
    {
        (SavedViewMenuViewModel vm, _, RecordingMutations mut, _, _, _) = BuildVm(Loaded(MakeView(1, "Same", "a=1")));
        bool ok = await vm.RenameAsync(MakeView(1, "Same", "a=1"), "  Same  ");
        Assert.True(ok);
        Assert.Empty(mut.Updates);
    }

    [Fact]
    public async Task RenameAsync_Changed_PatchesName()
    {
        (SavedViewMenuViewModel vm, _, RecordingMutations mut, _, _, int[] refresh) = BuildVm(Loaded(MakeView(1, "Old", "a=1")));
        bool ok = await vm.RenameAsync(MakeView(1, "Old", "a=1"), "New name");
        Assert.True(ok);
        (long id, _, SavedViewUpdateInput patch) = Assert.Single(mut.Updates);
        Assert.Equal(1, id);
        Assert.Equal("New name", patch.Name);
        Assert.Equal(1, refresh[0]);
    }

    [Fact]
    public async Task RenameAsync_Blank_ReturnsFalse()
    {
        (SavedViewMenuViewModel vm, _, RecordingMutations mut, _, _, _) = BuildVm(Loaded(MakeView(1, "Old", "a=1")));
        bool ok = await vm.RenameAsync(MakeView(1, "Old", "a=1"), "   ");
        Assert.False(ok);
        Assert.Empty(mut.Updates);
    }

    [Fact]
    public async Task DeleteAsync_Deletes_TogglesPending_Refreshes()
    {
        (SavedViewMenuViewModel vm, _, RecordingMutations mut, _, _, int[] refresh) = BuildVm(Loaded(MakeView(5, "X", "a=1")));
        var gate = new TaskCompletionSource();
        mut.Gate = () => gate.Task;

        Task del = vm.DeleteAsync(MakeView(5, "X", "a=1"));
        Assert.True(vm.IsDeleting);

        gate.SetResult();
        await del;

        Assert.False(vm.IsDeleting);
        (long id, string route) = Assert.Single(mut.Deletes);
        Assert.Equal(5, id);
        Assert.Equal(Route, route);
        Assert.Equal(1, refresh[0]);
    }

    [Fact]
    public void Refresh_InvokesStoreRefresh()
    {
        (SavedViewMenuViewModel vm, _, _, _, _, int[] refresh) = BuildVm();
        vm.Refresh();
        Assert.Equal(1, refresh[0]);
    }

    // ── pure helpers / per-row labels ────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(null, false)]
    [InlineData("", false)]
    [InlineData("   ", false)]
    [InlineData("ok", true)]
    public void CanSave_RejectsBlank(string? name, bool expected)
    {
        (SavedViewMenuViewModel vm, _, _, _, _, _) = BuildVm();
        Assert.Equal(expected, vm.CanSave(name));
    }

    [Fact]
    public void PinAndDefaultLabels_FlipWithState()
    {
        (SavedViewMenuViewModel vm, _, _, _, _, _) = BuildVm();

        Assert.Equal("Pin", vm.PinLabelFor(MakeView(1, "A", "a=1", isPinned: false)));
        Assert.Equal("Unpin", vm.PinLabelFor(MakeView(1, "A", "a=1", isPinned: true)));
        Assert.Equal("Set as default", vm.DefaultLabelFor(MakeView(1, "A", "a=1", isDefault: false)));
        Assert.Equal("Clear default", vm.DefaultLabelFor(MakeView(1, "A", "a=1", isDefault: true)));
    }

    [Fact]
    public void DeleteConfirmMessage_InterpolatesName()
    {
        (SavedViewMenuViewModel vm, _, _, _, _, _) = BuildVm();
        Assert.Equal("Delete saved view \"Trips\"?", vm.DeleteConfirmMessageFor(MakeView(1, "Trips", "a=1")));
    }

    [Fact]
    public void QueryTooltip_FallsBackToNoFilters_WhenQueryEmpty()
    {
        (SavedViewMenuViewModel vm, _, _, _, _, _) = BuildVm();
        Assert.Equal("No filters", vm.QueryTooltipFor(MakeView(1, "All", string.Empty)));
        Assert.Equal("vehicle_id=1", vm.QueryTooltipFor(MakeView(1, "One", "vehicle_id=1")));
    }

    [Fact]
    public void ToggleMenu_OpensAndCloses()
    {
        (SavedViewMenuViewModel vm, _, _, _, _, _) = BuildVm();
        Assert.False(vm.IsMenuOpen);
        vm.ToggleMenu();
        Assert.True(vm.IsMenuOpen);
        vm.ToggleMenu();
        Assert.False(vm.IsMenuOpen);
    }
}
