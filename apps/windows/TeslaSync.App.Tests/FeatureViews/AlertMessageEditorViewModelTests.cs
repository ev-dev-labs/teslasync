using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the AlertMessageEditor view-model — the per-state transitions for the two
/// catalogs (loading / loaded / empty / error / stale / offline), the autocomplete trigger + insert flow,
/// the preset gallery filtering + apply flow, the debounced preview's rendered / empty / error states, and
/// the include-title coupling. Mirrors the web spec
/// (web/src/features/notifications/components/AlertMessageEditor.tsx).
/// </summary>
public sealed class AlertMessageEditorViewModelTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // ---- Token catalog state matrix -------------------------------------------------

    [Fact]
    public async Task Tokens_loading_only_stays_loading()
    {
        using var vm = NewViewModel(tokens: new[] { RepositoryResult<IReadOnlyList<MessageToken>>.Loading() });
        await vm.LoadAsync();

        Assert.Equal(AlertMessageCatalogState.Loading, vm.TokensState);
        Assert.True(vm.TokensLoading);
    }

    [Fact]
    public async Task Tokens_loaded_exposes_catalog()
    {
        using var vm = NewViewModel(tokens: new[] { Loaded(Token("BatteryLevel", "Battery")) });
        await vm.LoadAsync();

        Assert.Equal(AlertMessageCatalogState.Loaded, vm.TokensState);
        Assert.False(vm.TokensLoading);
    }

    [Fact]
    public async Task Tokens_empty_renders_empty()
    {
        using var vm = NewViewModel(tokens: new[] { RepositoryResult<IReadOnlyList<MessageToken>>.Empty() });
        await vm.LoadAsync();

        Assert.Equal(AlertMessageCatalogState.Empty, vm.TokensState);
    }

    [Fact]
    public async Task Tokens_failure_renders_error_with_message()
    {
        using var vm = NewViewModel(tokens: new[]
        {
            RepositoryResult<IReadOnlyList<MessageToken>>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")),
        });
        await vm.LoadAsync();

        Assert.Equal(AlertMessageCatalogState.Error, vm.TokensState);
        Assert.False(string.IsNullOrWhiteSpace(vm.TokensError));
    }

    [Fact]
    public async Task Tokens_stale_cache_renders_stale()
    {
        using var vm = NewViewModel(tokens: new[]
        {
            RepositoryResult<IReadOnlyList<MessageToken>>.Cached(new[] { Token("BatteryLevel", "Battery") }, Now, stale: true),
        });
        await vm.LoadAsync();

        Assert.Equal(AlertMessageCatalogState.Stale, vm.TokensState);
    }

    [Fact]
    public async Task Tokens_offline_renders_offline()
    {
        using var vm = NewViewModel(tokens: new[]
        {
            RepositoryResult<IReadOnlyList<MessageToken>>.OfflineCached(
                new[] { Token("BatteryLevel", "Battery") }, Now, new RepositoryError(RepositoryErrorKind.Network, "off")),
        });
        await vm.LoadAsync();

        Assert.Equal(AlertMessageCatalogState.Offline, vm.TokensState);
        Assert.False(string.IsNullOrWhiteSpace(vm.TokensError));
    }

    // ---- Preset catalog state matrix ------------------------------------------------

    [Fact]
    public async Task Presets_state_matrix()
    {
        using (var loading = NewViewModel(presets: new[] { RepositoryResult<IReadOnlyList<MessagePreset>>.Loading() }))
        {
            await loading.LoadAsync();
            Assert.Equal(AlertMessageCatalogState.Loading, loading.PresetsState);
        }

        using (var empty = NewViewModel(presets: new[] { RepositoryResult<IReadOnlyList<MessagePreset>>.Empty() }))
        {
            await empty.LoadAsync();
            Assert.Equal(AlertMessageCatalogState.Empty, empty.PresetsState);
        }

        using (var error = NewViewModel(presets: new[]
        {
            RepositoryResult<IReadOnlyList<MessagePreset>>.Failure(new RepositoryError(RepositoryErrorKind.Server, "x")),
        }))
        {
            await error.LoadAsync();
            Assert.Equal(AlertMessageCatalogState.Error, error.PresetsState);
            Assert.False(string.IsNullOrWhiteSpace(error.PresetsError));
        }

        using var loaded = NewViewModel(presets: new[] { Loaded(Preset("a", "A", "{{X}}")) });
        await loaded.LoadAsync();
        Assert.Equal(AlertMessageCatalogState.Loaded, loaded.PresetsState);
        Assert.True(loaded.HasPresets);
    }

    // ---- Autocomplete ---------------------------------------------------------------

    [Fact]
    public async Task Typing_double_brace_opens_filtered_autocomplete()
    {
        using var vm = NewViewModel(tokens: new[] { Loaded(Token("BatteryLevel", "Battery level"), Token("Speed", "Vehicle speed")) });
        await vm.LoadAsync();

        vm.OnTemplateChanged("Battery {{Bat", "Battery {{Bat".Length);

        Assert.True(vm.AutocompleteOpen);
        Assert.True(vm.HasFilteredTokens);
        Assert.Single(vm.FilteredTokens);
        Assert.Equal("BatteryLevel", vm.FilteredTokens[0].Key);
    }

    [Fact]
    public async Task Typing_outside_brace_closes_autocomplete()
    {
        using var vm = NewViewModel(tokens: new[] { Loaded(Token("BatteryLevel", "Battery level")) });
        await vm.LoadAsync();
        vm.OnTemplateChanged("{{Bat", "{{Bat".Length);
        Assert.True(vm.AutocompleteOpen);

        vm.OnTemplateChanged("plain text", "plain text".Length);

        Assert.False(vm.AutocompleteOpen);
    }

    [Fact]
    public async Task Cursor_navigation_wraps()
    {
        using var vm = NewViewModel(tokens: new[] { Loaded(Token("A", "a"), Token("B", "b")) });
        await vm.LoadAsync();
        vm.OnTemplateChanged("{{", "{{".Length);

        Assert.Equal(0, vm.Cursor);
        vm.MoveCursorDown();
        Assert.Equal(1, vm.Cursor);
        vm.MoveCursorDown();
        Assert.Equal(0, vm.Cursor); // wraps
        vm.MoveCursorUp();
        Assert.Equal(1, vm.Cursor); // wraps backwards
    }

    [Fact]
    public async Task Accept_highlighted_inserts_token_and_closes()
    {
        using var vm = NewViewModel(tokens: new[] { Loaded(Token("BatteryLevel", "Battery level")) });
        await vm.LoadAsync();
        TemplateEdit? edit = null;
        vm.TemplateEdited += (_, e) => edit = e;

        vm.OnTemplateChanged("Hi {{Bat", "Hi {{Bat".Length);
        vm.AcceptHighlighted();

        Assert.Equal("Hi {{BatteryLevel}}", vm.MsgTemplate);
        Assert.False(vm.AutocompleteOpen);
        Assert.NotNull(edit);
        Assert.Equal("Hi {{BatteryLevel}}", edit!.Value.Text);
    }

    // ---- Preset gallery -------------------------------------------------------------

    [Fact]
    public async Task Open_and_apply_preset_sets_template_and_closes()
    {
        using var vm = NewViewModel(presets: new[] { Loaded(Preset("a", "Low battery", "Battery at {{BatteryLevel}}%")) });
        await vm.LoadAsync();
        TemplateEdit? edit = null;
        vm.TemplateEdited += (_, e) => edit = e;

        vm.OpenPresetGallery();
        Assert.True(vm.PresetGalleryOpen);

        vm.ApplyPreset(vm.FilteredPresets[0]);

        Assert.Equal("Battery at {{BatteryLevel}}%", vm.MsgTemplate);
        Assert.False(vm.PresetGalleryOpen);
        Assert.NotNull(edit);
    }

    [Fact]
    public async Task Op_validity_filters_gallery_and_tag_resets_when_absent()
    {
        var tokens = Loaded(Token("BatteryLevel", "Battery level"));
        var presets = Loaded(
            Preset("a", "Battery", "{{BatteryLevel}}", "battery"),
            Preset("b", "Range", "{{Min}}-{{Max}}", "range"));
        using var vm = NewViewModel(
            tokens: new[] { tokens },
            presets: new[] { presets },
            draft: new AlertRuleDraft { Op = "<" });
        await vm.LoadAsync();

        // The "range" preset references unavailable {{Min}}/{{Max}} → filtered out under op "<".
        Assert.Single(vm.FilteredPresets);
        Assert.Equal("a", vm.FilteredPresets[0].Id);

        // Selecting a tag that survives.
        vm.SetActiveTag("battery");
        Assert.Single(vm.FilteredPresets);

        // A tag that no longer exists resets to "All".
        vm.SetActiveTag("range");
        Assert.Null(vm.ActiveTag);
    }

    [Fact]
    public async Task Tag_filter_narrows_presets()
    {
        using var vm = NewViewModel(presets: new[]
        {
            Loaded(
                Preset("a", "A", "{{X}}", "battery"),
                Preset("b", "B", "{{Y}}", "charging")),
        });
        await vm.LoadAsync();

        Assert.Equal(2, vm.FilteredPresets.Count);
        vm.SetActiveTag("charging");
        Assert.Single(vm.FilteredPresets);
        Assert.Equal("b", vm.FilteredPresets[0].Id);
    }

    // ---- Live preview ---------------------------------------------------------------

    [Fact]
    public async Task Preview_renders_title_and_body()
    {
        var preview = new FakePreviewSource(MessagePreviewOutcome.Ok(new MessagePreviewResult("Battery low", "Battery at 10%")));
        using var vm = NewViewModel(preview: preview, includeTitle: true);

        await vm.RefreshPreviewNowAsync();

        Assert.Equal(AlertMessagePreviewState.Rendered, vm.PreviewState);
        Assert.Equal("Battery low", vm.PreviewTitle);
        Assert.Equal("Battery at 10%", vm.PreviewBody);
        Assert.True(vm.ShowPreviewTitle);
        Assert.False(vm.PreviewBodyIsEmptyNote);
    }

    [Fact]
    public async Task Preview_empty_body_shows_localized_note()
    {
        var preview = new FakePreviewSource(MessagePreviewOutcome.Ok(new MessagePreviewResult("Title", "")));
        using var vm = NewViewModel(preview: preview, includeTitle: true);

        await vm.RefreshPreviewNowAsync();

        Assert.True(vm.PreviewBodyIsEmptyNote);
        Assert.Equal(AlertMessageEditorText.PreviewEmptyBody(Localizer), vm.PreviewBody);
    }

    [Fact]
    public async Task Preview_hides_title_when_include_title_off()
    {
        var preview = new FakePreviewSource(MessagePreviewOutcome.Ok(new MessagePreviewResult("Title", "Body")));
        using var vm = NewViewModel(preview: preview, includeTitle: false);

        await vm.RefreshPreviewNowAsync();

        Assert.False(vm.ShowPreviewTitle);
    }

    [Fact]
    public async Task Preview_failure_renders_error()
    {
        var preview = new FakePreviewSource(MessagePreviewOutcome.Fail(new RepositoryError(RepositoryErrorKind.Server, "render failed")));
        using var vm = NewViewModel(preview: preview);

        await vm.RefreshPreviewNowAsync();

        Assert.Equal(AlertMessagePreviewState.Error, vm.PreviewState);
        Assert.False(string.IsNullOrWhiteSpace(vm.PreviewError));
    }

    [Fact]
    public async Task Preview_loading_state_visible_until_render_completes()
    {
        var gate = new TaskCompletionSource<MessagePreviewOutcome>();
        var preview = new GatedPreviewSource(gate.Task);
        using var vm = NewViewModel(preview: preview);

        var pending = vm.RefreshPreviewNowAsync();
        Assert.Equal(AlertMessagePreviewState.Loading, vm.PreviewState);

        gate.SetResult(MessagePreviewOutcome.Ok(new MessagePreviewResult("T", "B")));
        await pending;
        Assert.Equal(AlertMessagePreviewState.Rendered, vm.PreviewState);
    }

    [Fact]
    public async Task Set_include_title_updates_show_title()
    {
        var preview = new FakePreviewSource(MessagePreviewOutcome.Ok(new MessagePreviewResult("Title", "Body")));
        using var vm = NewViewModel(preview: preview, includeTitle: true);
        await vm.RefreshPreviewNowAsync();
        Assert.True(vm.ShowPreviewTitle);

        vm.SetIncludeTitle(false);

        Assert.False(vm.IncludeTitle);
        Assert.False(vm.ShowPreviewTitle);
    }

    // ---- Property change notifications ----------------------------------------------

    [Fact]
    public async Task Raises_property_changed_for_state()
    {
        using var vm = NewViewModel(tokens: new[] { Loaded(Token("A", "a")) });
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(AlertMessageEditorViewModel.TokensState), changed);
    }

    // ---- Fakes / helpers ------------------------------------------------------------

    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    private static MessageToken Token(string key, string label) => new(key, label, null, "Battery", null);

    private static MessagePreset Preset(string id, string name, string template, params string[] tags) =>
        new(id, name, "desc", template, "signal", tags);

    private static RepositoryResult<IReadOnlyList<MessageToken>> Loaded(params MessageToken[] tokens) =>
        RepositoryResult<IReadOnlyList<MessageToken>>.Loaded(tokens, Now);

    private static RepositoryResult<IReadOnlyList<MessagePreset>> Loaded(params MessagePreset[] presets) =>
        RepositoryResult<IReadOnlyList<MessagePreset>>.Loaded(presets, Now);

    private static AlertMessageEditorViewModel NewViewModel(
        RepositoryResult<IReadOnlyList<MessageToken>>[]? tokens = null,
        RepositoryResult<IReadOnlyList<MessagePreset>>[]? presets = null,
        IMessagePreviewSource? preview = null,
        AlertRuleDraft? draft = null,
        bool includeTitle = true) =>
        new(
            new FakeTokenSource(tokens ?? new[] { Loaded(Token("BatteryLevel", "Battery level")) }),
            new FakePresetSource(presets ?? new[] { Loaded(Preset("a", "A", "{{BatteryLevel}}")) }),
            preview ?? new FakePreviewSource(MessagePreviewOutcome.Ok(new MessagePreviewResult("T", "B"))),
            Localizer,
            draft ?? new AlertRuleDraft(),
            msgTemplate: string.Empty,
            includeTitle: includeTitle,
            previewDelay: _ => Task.CompletedTask);

    private sealed class FakeTokenSource(RepositoryResult<IReadOnlyList<MessageToken>>[] emissions) : IMessageTokenSource
    {
        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<MessageToken>>> StreamAsync(
            MessageTokenQuery query,
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            foreach (var emission in emissions)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return emission;
                await Task.Yield();
            }
        }
    }

    private sealed class FakePresetSource(RepositoryResult<IReadOnlyList<MessagePreset>>[] emissions) : IMessagePresetSource
    {
        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<MessagePreset>>> StreamAsync(
            string? kind,
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            foreach (var emission in emissions)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return emission;
                await Task.Yield();
            }
        }
    }

    private sealed class FakePreviewSource(MessagePreviewOutcome outcome) : IMessagePreviewSource
    {
        public Task<MessagePreviewOutcome> PreviewAsync(MessagePreviewRequest request, CancellationToken cancellationToken = default) =>
            Task.FromResult(outcome);
    }

    private sealed class GatedPreviewSource(Task<MessagePreviewOutcome> gate) : IMessagePreviewSource
    {
        public Task<MessagePreviewOutcome> PreviewAsync(MessagePreviewRequest request, CancellationToken cancellationToken = default) => gate;
    }
}
