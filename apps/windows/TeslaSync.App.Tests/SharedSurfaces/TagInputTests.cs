using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the TagInput shared surface's UI-thread-free logic — the registration slug + i18n
/// keys/fallbacks (<see cref="TagInputRegistration"/>), the count / tag interpolation, the separator sanitiser
/// + split regex (<see cref="TagInputSeparators"/>), the pure normalise / try-add / commit adapter
/// (<see cref="TagListEditor"/>), the controlled value seam (<see cref="TagInputSource"/>) and the per-state
/// view-model: empty vs populated, commit on Enter / separator / paste, case-insensitive de-duplication, the
/// blocking validator error, the at-capacity disable + helper, chip removal + Backspace, lower-casing, the
/// live add / duplicate / removal announcements and the PII-safe diagnostics (<see cref="TagInputViewModel"/>,
/// <see cref="TagInputDiagnostics"/>). Mirrors the web spec one-for-one
/// (web/src/components/forms/TagInput.tsx). The WinUI view (TagInput.cs, which composes the chip strip + the
/// editing TextBox + the hidden enumeration + the error / helper text) is exercised by the app build.
/// </summary>
public sealed class TagInputTests
{
    private const char Zwsp = AnnouncerText.ZeroWidthSpace;

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> RequestedKeys { get; } = new();

        public string GetString(string key, string fallback)
        {
            RequestedKeys.Add(key);
            return fallback;
        }
    }

    private static TagCommitContext Ctx(
        bool lowercase = false,
        int? maxTags = null,
        TagValidator? validator = null,
        IReadOnlyList<char>? separators = null) =>
        new()
        {
            Lowercase = lowercase,
            MaxTags = maxTags,
            Validator = validator,
            Separators = separators ?? TagInputSeparators.Default,
        };

    private static TagInputViewModel Vm(
        TagInputSource source,
        ILocalizer? localizer = null,
        IAnnouncerBus? announcer = null,
        int? maxTags = null,
        TagValidator? validator = null,
        IReadOnlyList<char>? separators = null,
        bool lowercase = false,
        bool disabled = false,
        string? hint = null,
        string? placeholder = null) =>
        new(
            source,
            localizer ?? PassthroughLocalizer.Instance,
            "Tags",
            announcer,
            hideLabel: false,
            placeholder,
            maxTags,
            validator,
            separators,
            lowercase,
            disabled,
            hint);

    private static List<string> CaptureAnnouncements(AnnouncerBus bus)
    {
        var captured = new List<string>();
        bus.Subscribe((msg, _) => captured.Add(msg.TrimEnd(Zwsp)));
        return captured;
    }

    // ── registration: diagnostics slug + i18n keys/fallbacks (web verbatim) ───────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("TagInput", TagInputRegistration.Slug);

    [Theory]
    [InlineData(TagInputRegistration.AddedOneKey, "translation.tagInput.addedOne")]
    [InlineData(TagInputRegistration.AddedKey, "translation.tagInput.added")]
    [InlineData(TagInputRegistration.DuplicateKey, "translation.tagInput.duplicate")]
    [InlineData(TagInputRegistration.MaxReachedAnnounceKey, "translation.tagInput.maxReachedAnnounce")]
    [InlineData(TagInputRegistration.RemovedKey, "translation.tagInput.removed")]
    [InlineData(TagInputRegistration.RemoveTagKey, "translation.tagInput.removeTag")]
    [InlineData(TagInputRegistration.MaxReachedKey, "translation.tagInput.maxReached")]
    [InlineData(TagInputRegistration.PlaceholderKey, "translation.tagInput.placeholder")]
    [InlineData(TagInputRegistration.TagsNoneKey, "translation.tagInput.tagsNone")]
    [InlineData(TagInputRegistration.TagsListKey, "translation.tagInput.tagsList")]
    [InlineData(TagInputRegistration.MaxReachedHintKey, "translation.tagInput.maxReachedHint")]
    public void I18n_keys_carry_the_translation_prefixed_web_key(string actual, string expected) =>
        Assert.Equal(expected, actual);

    [Theory]
    [InlineData(TagInputRegistration.AddedOneFallback, "Tag added")]
    [InlineData(TagInputRegistration.AddedFallback, "{{count}} tags added")]
    [InlineData(TagInputRegistration.DuplicateFallback, "{{tag}} is already added")]
    [InlineData(TagInputRegistration.RemovedFallback, "Removed {{tag}}")]
    [InlineData(TagInputRegistration.RemoveTagFallback, "Remove {{tag}}")]
    [InlineData(TagInputRegistration.TagsNoneFallback, "No tags yet")]
    [InlineData(TagInputRegistration.TagsListFallback, "Tags: {{tags}}")]
    [InlineData(TagInputRegistration.MaxReachedHintFallback, "Maximum {{count}} tags")]
    public void I18n_fallbacks_match_the_web_english_copy(string actual, string expected) =>
        Assert.Equal(expected, actual);

    [Fact]
    public void Limit_reached_copy_is_shared_by_the_announcement_and_the_prompt()
    {
        // Both fallbacks are the same web string ("Tag limit reached"), so they are asserted together rather
        // than as identical Theory rows.
        Assert.Equal("Tag limit reached", TagInputRegistration.MaxReachedAnnounceFallback);
        Assert.Equal("Tag limit reached", TagInputRegistration.MaxReachedFallback);
    }

    [Fact]
    public void Placeholder_fallback_keeps_the_web_ellipsis_copy() =>
        Assert.Equal("Add a tag\u2026", TagInputRegistration.PlaceholderFallback);

    [Fact]
    public void Format_helpers_interpolate_both_token_styles()
    {
        Assert.Equal("3 tags added", TagInputRegistration.FormatAdded("{{count}} tags added", 3));
        Assert.Equal("3 tags added", TagInputRegistration.FormatAdded("{0} tags added", 3));
        Assert.Equal("Maximum 5 tags", TagInputRegistration.FormatMaxReachedHint("Maximum {{count}} tags", 5));
        Assert.Equal("Remove ev", TagInputRegistration.FormatTag("Remove {{tag}}", "ev"));
        Assert.Equal("Tags: a, b", TagInputRegistration.FormatTagsList("Tags: {{tags}}", "a, b"));
    }

    // ── adapter: separators (web TagSeparator union + buildSplitRegex) ─────────────────────────────────────

    [Fact]
    public void Sanitize_defaults_filters_and_dedupes()
    {
        Assert.Equal(new[] { ',' }, TagInputSeparators.Sanitize(null));
        Assert.Equal(new[] { ',' }, TagInputSeparators.Sanitize(Array.Empty<char>()));
        Assert.Equal(new[] { ';', ' ' }, TagInputSeparators.Sanitize(new[] { ';', ' ' }));
        Assert.Equal(new[] { ',' }, TagInputSeparators.Sanitize(new[] { ',', ',' }));
        Assert.Equal(new[] { ',' }, TagInputSeparators.Sanitize(new[] { 'x', '!' }));
    }

    [Theory]
    [InlineData("abc", false)]
    [InlineData("a,b", true)]
    [InlineData("a b", false)]
    [InlineData("a\nb", true)]
    public void ContainsSeparator_matches_the_default_comma_class(string raw, bool expected) =>
        Assert.Equal(expected, TagListEditor.ContainsSeparator(raw, Ctx()));

    // ── adapter: normalise + try-add (web normaliseTag / tryAddOne) ───────────────────────────────────────

    [Fact]
    public void Normalize_trims_and_optionally_lowercases()
    {
        Assert.Equal("Foo", TagListEditor.Normalize("  Foo  ", lowercase: false));
        Assert.Equal("foo", TagListEditor.Normalize("  Foo  ", lowercase: true));
    }

    [Fact]
    public void TryAdd_classifies_every_outcome()
    {
        Assert.Equal(TagAddOutcome.Added, TagListEditor.TryAdd(Array.Empty<string>(), "foo", Ctx()).Outcome);
        Assert.Equal(TagAddOutcome.Empty, TagListEditor.TryAdd(Array.Empty<string>(), "  ", Ctx()).Outcome);
        Assert.Equal(TagAddOutcome.Duplicate, TagListEditor.TryAdd(new[] { "foo" }, "FOO", Ctx()).Outcome);
        Assert.Equal(TagAddOutcome.Full, TagListEditor.TryAdd(new[] { "a" }, "b", Ctx(maxTags: 1)).Outcome);

        TagAddResult invalid = TagListEditor.TryAdd(Array.Empty<string>(), "x", Ctx(validator: _ => "Too short"));
        Assert.Equal(TagAddOutcome.Invalid, invalid.Outcome);
        Assert.Equal("Too short", invalid.Error);
    }

    // ── adapter: commit (web commitText) ──────────────────────────────────────────────────────────────────

    [Fact]
    public void Commit_preserves_a_separatorless_remainder()
    {
        TagCommitResult result = TagListEditor.Commit(Array.Empty<string>(), "foo", Ctx());

        Assert.Equal(0, result.AddedCount);
        Assert.Equal("foo", result.Remainder);
        Assert.False(result.Changed);
    }

    [Fact]
    public void Commit_consumes_fragments_before_the_last_separator()
    {
        TagCommitResult result = TagListEditor.Commit(Array.Empty<string>(), "a,b,c", Ctx());

        Assert.Equal(2, result.AddedCount);
        Assert.Equal(new[] { "a", "b" }, result.Tags);
        Assert.Equal("c", result.Remainder);
    }

    [Fact]
    public void Commit_records_the_last_duplicate_and_first_error()
    {
        TagCommitResult duplicate = TagListEditor.Commit(Array.Empty<string>(), "a,A,", Ctx());
        Assert.Equal(1, duplicate.AddedCount);
        Assert.Equal("A", duplicate.LastDuplicate);

        TagCommitResult invalid = TagListEditor.Commit(Array.Empty<string>(), "ok,bad,", Ctx(validator: t => t == "bad" ? "nope" : null));
        Assert.Equal(1, invalid.AddedCount);
        Assert.Equal(new[] { "ok" }, invalid.Tags);
        Assert.Equal("nope", invalid.FirstError);
    }

    [Fact]
    public void Commit_stops_at_the_cap_and_splits_multiline_pastes()
    {
        TagCommitResult capped = TagListEditor.Commit(new[] { "a", "b" }, "c,", Ctx(maxTags: 2));
        Assert.Equal(0, capped.AddedCount);
        Assert.True(capped.HitMax);

        TagCommitResult pasted = TagListEditor.Commit(Array.Empty<string>(), "a\nb\n", Ctx());
        Assert.Equal(2, pasted.AddedCount);
        Assert.Equal(new[] { "a", "b" }, pasted.Tags);
    }

    // ── seam: controlled value source (web value / onChange) ──────────────────────────────────────────────

    [Fact]
    public void Source_treats_null_as_empty_and_notifies_on_set()
    {
        var source = new TagInputSource(null);
        int changes = 0;
        source.Changed += (_, _) => changes++;

        Assert.Empty(source.Tags);
        source.SetTags(new[] { "a" });

        Assert.Equal(new[] { "a" }, source.Tags);
        Assert.Equal(1, changes);
    }

    // ── view-model: empty vs populated (web tag-list branches) ────────────────────────────────────────────

    [Fact]
    public void Empty_field_reports_the_empty_state()
    {
        TagInputViewModel vm = Vm(new TagInputSource());

        Assert.Equal(0, vm.TagCount);
        Assert.Equal(TagInputContentState.Empty, vm.ContentState);
        Assert.Equal("No tags yet", vm.HiddenTagsText);
        Assert.False(vm.HasError);
    }

    [Fact]
    public void Populated_field_enumerates_its_tags_for_screen_readers()
    {
        TagInputViewModel vm = Vm(new TagInputSource(new[] { "a", "b" }));

        Assert.Equal(TagInputContentState.Populated, vm.ContentState);
        Assert.Equal("Tags: a, b", vm.HiddenTagsText);
    }

    // ── view-model: commit on Enter / separator (web commitAll / handleInputChange) ───────────────────────

    [Fact]
    public void Enter_commits_the_pending_buffer_and_clears_it()
    {
        var source = new TagInputSource();
        TagInputViewModel vm = Vm(source);
        IReadOnlyList<string>? changed = null;
        vm.TagsChanged += (_, next) => changed = next;

        vm.SetPendingText("foo");
        vm.Commit();

        Assert.Equal(new[] { "foo" }, vm.Tags);
        Assert.Equal(string.Empty, vm.Pending);
        Assert.Equal(new[] { "foo" }, changed);
    }

    [Fact]
    public void Typing_a_separator_commits_and_keeps_the_remainder()
    {
        TagInputViewModel vm = Vm(new TagInputSource());

        vm.SetPendingText("a,b");

        Assert.Equal(new[] { "a" }, vm.Tags);
        Assert.Equal("b", vm.Pending);
    }

    [Fact]
    public void A_trailing_separator_commits_everything()
    {
        TagInputViewModel vm = Vm(new TagInputSource());

        vm.SetPendingText("a,b,");

        Assert.Equal(new[] { "a", "b" }, vm.Tags);
        Assert.Equal(string.Empty, vm.Pending);
    }

    // ── view-model: duplicate / validator / cap (web tryAddOne branches) ──────────────────────────────────

    [Fact]
    public void A_duplicate_is_rejected_without_changing_the_list_or_error()
    {
        TagInputViewModel vm = Vm(new TagInputSource(new[] { "foo" }));

        vm.SetPendingText("foo,");

        Assert.Equal(new[] { "foo" }, vm.Tags);
        Assert.False(vm.HasError);
    }

    [Fact]
    public void A_validator_rejection_blocks_the_commit_and_shows_the_error()
    {
        TagInputViewModel vm = Vm(new TagInputSource(), validator: t => t.Length < 2 ? "Too short" : null);

        vm.SetPendingText("a,");

        Assert.Empty(vm.Tags);
        Assert.True(vm.HasError);
        Assert.Equal("Too short", vm.ErrorMessage);
    }

    [Fact]
    public void Editing_clears_a_stale_validator_error()
    {
        TagInputViewModel vm = Vm(new TagInputSource(), validator: t => t.Length < 2 ? "Too short" : null);
        vm.SetPendingText("a,");
        Assert.True(vm.HasError);

        vm.SetPendingText("ab");

        Assert.False(vm.HasError);
    }

    [Fact]
    public void At_capacity_disables_the_input_and_shows_the_helper()
    {
        TagInputViewModel vm = Vm(new TagInputSource(new[] { "a", "b" }), maxTags: 2);

        Assert.True(vm.AtMax);
        Assert.True(vm.InputDisabled);
        Assert.Equal("Tag limit reached", vm.PromptText);
        Assert.True(vm.ShowHelper);
        Assert.Equal("Maximum 2 tags", vm.HelperText);
    }

    // ── view-model: remove / Backspace (web removeAt / Backspace) ─────────────────────────────────────────

    [Fact]
    public void Remove_at_drops_the_tag()
    {
        TagInputViewModel vm = Vm(new TagInputSource(new[] { "a", "b" }));

        vm.RemoveAt(0);

        Assert.Equal(new[] { "b" }, vm.Tags);
    }

    [Fact]
    public void Backspace_on_an_empty_buffer_removes_the_trailing_chip()
    {
        TagInputViewModel vm = Vm(new TagInputSource(new[] { "a", "b" }));

        Assert.True(vm.HandleBackspace());
        Assert.Equal(new[] { "a" }, vm.Tags);
    }

    [Fact]
    public void Backspace_is_a_no_op_while_typing()
    {
        TagInputViewModel vm = Vm(new TagInputSource(new[] { "a" }));
        vm.SetPendingText("x");

        Assert.False(vm.HandleBackspace());
        Assert.Equal(new[] { "a" }, vm.Tags);
    }

    [Fact]
    public void A_disabled_field_ignores_removal_and_backspace()
    {
        TagInputViewModel vm = Vm(new TagInputSource(new[] { "a" }), disabled: true);

        vm.RemoveAt(0);
        bool handled = vm.HandleBackspace();

        Assert.False(handled);
        Assert.Equal(new[] { "a" }, vm.Tags);
    }

    // ── view-model: lowercase + paste (web lowercase / handlePaste) ───────────────────────────────────────

    [Fact]
    public void Lowercase_normalises_tags_before_commit()
    {
        TagInputViewModel vm = Vm(new TagInputSource(), lowercase: true);

        vm.SetPendingText("FOO,");

        Assert.Equal(new[] { "foo" }, vm.Tags);
    }

    [Fact]
    public void Paste_commits_the_whole_clipboard_string()
    {
        TagInputViewModel vm = Vm(new TagInputSource());

        vm.Paste("a,b,c");

        Assert.Equal(new[] { "a", "b", "c" }, vm.Tags);
        Assert.Equal(string.Empty, vm.Pending);
    }

    // ── view-model: label count + prompt override (web label count span / placeholder) ───────────────────

    [Fact]
    public void Count_suffix_and_accessible_name_track_the_cap()
    {
        TagInputViewModel capped = Vm(new TagInputSource(new[] { "a" }), maxTags: 3);
        Assert.Equal("(1/3)", capped.CountText);
        Assert.Equal("Tags (1/3)", capped.AccessibleName);

        TagInputViewModel uncapped = Vm(new TagInputSource(new[] { "a" }));
        Assert.Equal(string.Empty, uncapped.CountText);
        Assert.Equal("Tags", uncapped.AccessibleName);
    }

    [Fact]
    public void Prompt_uses_the_override_until_capacity_is_reached()
    {
        TagInputViewModel open = Vm(new TagInputSource(), placeholder: "Type here");
        Assert.Equal("Type here", open.PromptText);

        TagInputViewModel full = Vm(new TagInputSource(new[] { "a" }), maxTags: 1, placeholder: "Type here");
        Assert.Equal("Tag limit reached", full.PromptText);
    }

    [Fact]
    public void Hint_drives_the_helper_line_when_there_is_no_error()
    {
        TagInputViewModel vm = Vm(new TagInputSource(), hint: "Add labels");

        Assert.True(vm.ShowHelper);
        Assert.Equal("Add labels", vm.HelperText);
    }

    [Fact]
    public void An_external_value_change_reprojects_the_surface()
    {
        var source = new TagInputSource();
        TagInputViewModel vm = Vm(source);

        source.SetTags(new[] { "x", "y" });

        Assert.Equal(new[] { "x", "y" }, vm.Tags);
        Assert.Equal(TagInputContentState.Populated, vm.ContentState);
    }

    // ── announcements (web announce(...)) ─────────────────────────────────────────────────────────────────

    [Fact]
    public void Adding_one_tag_announces_the_singular_copy()
    {
        var bus = new AnnouncerBus();
        List<string> announced = CaptureAnnouncements(bus);
        TagInputViewModel vm = Vm(new TagInputSource(), announcer: bus);

        vm.SetPendingText("foo");
        vm.Commit();

        Assert.Equal("Tag added", Assert.Single(announced));
    }

    [Fact]
    public void Adding_several_tags_announces_the_count()
    {
        var bus = new AnnouncerBus();
        List<string> announced = CaptureAnnouncements(bus);
        TagInputViewModel vm = Vm(new TagInputSource(), announcer: bus);

        vm.SetPendingText("a,b,");

        Assert.Equal("2 tags added", Assert.Single(announced));
    }

    [Fact]
    public void A_duplicate_announces_the_already_added_copy()
    {
        var bus = new AnnouncerBus();
        List<string> announced = CaptureAnnouncements(bus);
        TagInputViewModel vm = Vm(new TagInputSource(new[] { "foo" }), announcer: bus);

        vm.SetPendingText("foo,");

        Assert.Equal("foo is already added", announced[^1]);
    }

    [Fact]
    public void Hitting_the_cap_announces_the_limit()
    {
        var bus = new AnnouncerBus();
        List<string> announced = CaptureAnnouncements(bus);
        TagInputViewModel vm = Vm(new TagInputSource(new[] { "a", "b" }), maxTags: 2, announcer: bus);

        vm.SetPendingText("c,");

        Assert.Equal("Tag limit reached", announced[^1]);
    }

    [Fact]
    public void Removing_a_tag_announces_the_removal()
    {
        var bus = new AnnouncerBus();
        List<string> announced = CaptureAnnouncements(bus);
        TagInputViewModel vm = Vm(new TagInputSource(new[] { "alpha", "beta" }), announcer: bus);

        vm.RemoveAt(0);

        Assert.Equal("Removed alpha", announced[^1]);
    }

    // ── accessibility: every label resolves through the i18n facade (P1/S10) ──────────────────────────────

    [Fact]
    public void Accessible_labels_resolve_through_the_localizer_keys()
    {
        var localizer = new RecordingLocalizer();
        TagInputViewModel empty = Vm(new TagInputSource(), localizer: localizer);

        Assert.Equal("Add a tag\u2026", empty.PromptText);
        Assert.Equal("No tags yet", empty.HiddenTagsText);
        Assert.Equal("Remove ev", empty.RemoveLabelFor("ev"));

        TagInputViewModel full = Vm(new TagInputSource(new[] { "a", "b" }), localizer: localizer, maxTags: 2);
        Assert.Equal("Tag limit reached", full.PromptText);
        Assert.Equal("Tags: a, b", full.HiddenTagsText);
        Assert.Equal("Maximum 2 tags", full.HelperText);

        Assert.Contains(TagInputRegistration.PlaceholderKey, localizer.RequestedKeys);
        Assert.Contains(TagInputRegistration.TagsNoneKey, localizer.RequestedKeys);
        Assert.Contains(TagInputRegistration.RemoveTagKey, localizer.RequestedKeys);
        Assert.Contains(TagInputRegistration.MaxReachedKey, localizer.RequestedKeys);
        Assert.Contains(TagInputRegistration.TagsListKey, localizer.RequestedKeys);
        Assert.Contains(TagInputRegistration.MaxReachedHintKey, localizer.RequestedKeys);
    }

    // ── diagnostics (P1/S11): view.opened with the surface slug ───────────────────────────────────────────

    [Fact]
    public void Diagnostics_emits_view_opened_with_the_surface_slug()
    {
        var emitted = new List<string>();
        var diagnostics = new TagInputDiagnostics(emitted.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal("view.opened slug=TagInput", Assert.Single(emitted));
        Assert.Equal(1, diagnostics.ViewsOpened);
    }
}
