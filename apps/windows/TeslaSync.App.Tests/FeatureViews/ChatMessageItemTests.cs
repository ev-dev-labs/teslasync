using System.Globalization;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>ChatMessageItem</c> feature surface's UI-thread-free logic — the per-state
/// branch projection (loading / error / empty / stale / offline / ready), the web visibility gates
/// (<c>showAvatar</c> / <c>showTimestamp</c> / <c>showActions</c>), the per-action gating (copy / regenerate /
/// edit), the <c>streamedText ?? content</c> visible text, the markdown adapter that stands in for the web
/// <c>MarkdownRenderer</c>, the no-op edit guard, the freshness chip, the lifecycle copy, the accessible names, and
/// the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/system/components/chatbot/ChatMessageItem.tsx). The WinUI view itself (ChatMessageItem.cs) is
/// exercised by the app build.
/// </summary>
public sealed class ChatMessageItemTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset At = new(2026, 4, 4, 14, 30, 0, TimeSpan.Zero);

    private static ChatMessageData Msg(
        ChatRole role = ChatRole.Assistant,
        string content = "Hello there",
        string id = "m-1",
        bool isStreaming = false,
        string? streamedText = null,
        DateTimeOffset? createdAt = null) =>
        new(id, role, content, createdAt ?? At, isStreaming, streamedText);

    private static ChatMessageItemDisplay Project(ChatMessageItemModel model) =>
        ChatMessageItemProjection.Project(model, Localizer);

    // ── Branch precedence: loading → error → empty → freshness → ready ─────────────────────────────────────

    [Fact]
    public void Loading_when_model_is_loading() =>
        Assert.Equal(ChatMessageItemState.Loading, Project(ChatMessageItemModel.Loading()).State);

    [Fact]
    public void Error_when_model_failed() =>
        Assert.Equal(ChatMessageItemState.Error, Project(ChatMessageItemModel.Failed()).State);

    [Fact]
    public void Empty_when_model_is_empty() =>
        Assert.Equal(ChatMessageItemState.Empty, Project(ChatMessageItemModel.Empty()).State);

    [Fact]
    public void Ready_when_message_present() =>
        Assert.Equal(ChatMessageItemState.Ready, Project(ChatMessageItemModel.Ready(Msg())).State);

    [Fact]
    public void Fresh_snapshot_with_no_message_collapses_to_empty() =>
        Assert.Equal(
            ChatMessageItemState.Empty,
            Project(new ChatMessageItemModel(ChatMessageItemState.Ready, null)).State);

    [Fact]
    public void Ready_with_blank_non_streaming_content_collapses_to_empty() =>
        Assert.Equal(
            ChatMessageItemState.Empty,
            Project(ChatMessageItemModel.Ready(Msg(content: "   "))).State);

    [Fact]
    public void Streaming_message_with_no_text_yet_stays_ready() =>
        Assert.Equal(
            ChatMessageItemState.Ready,
            Project(ChatMessageItemModel.Ready(Msg(content: string.Empty, isStreaming: true))).State);

    [Fact]
    public void Stale_keeps_its_branch_with_a_message() =>
        Assert.Equal(ChatMessageItemState.Stale, Project(ChatMessageItemModel.Stale(Msg())).State);

    [Fact]
    public void Offline_keeps_its_branch_with_a_message() =>
        Assert.Equal(ChatMessageItemState.Offline, Project(ChatMessageItemModel.Offline(Msg())).State);

    [Fact]
    public void Stale_with_no_message_collapses_to_empty() =>
        Assert.Equal(
            ChatMessageItemState.Empty,
            Project(new ChatMessageItemModel(ChatMessageItemState.Stale, null)).State);

    [Fact]
    public void Offline_with_no_message_collapses_to_empty() =>
        Assert.Equal(
            ChatMessageItemState.Empty,
            Project(new ChatMessageItemModel(ChatMessageItemState.Offline, null)).State);

    // ── Role / visible text ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void User_message_is_flagged_as_user() =>
        Assert.True(Project(ChatMessageItemModel.Ready(Msg(role: ChatRole.User))).IsUser);

    [Fact]
    public void Assistant_message_is_not_flagged_as_user() =>
        Assert.False(Project(ChatMessageItemModel.Ready(Msg(role: ChatRole.Assistant))).IsUser);

    [Fact]
    public void Visible_text_prefers_streamed_text_over_content() =>
        Assert.Equal(
            "partial",
            Project(ChatMessageItemModel.Ready(Msg(content: "full", isStreaming: true, streamedText: "partial"))).VisibleText);

    [Fact]
    public void Visible_text_falls_back_to_content() =>
        Assert.Equal("full", Project(ChatMessageItemModel.Ready(Msg(content: "full"))).VisibleText);

    [Fact]
    public void Content_is_passed_through_for_copy_and_edit() =>
        Assert.Equal("full", Project(ChatMessageItemModel.Ready(Msg(content: "full", streamedText: "partial"))).Content);

    // ── Visibility gates: web showAvatar / showTimestamp / showActions ────────────────────────────────────

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void Show_avatar_follows_is_first_in_group(bool first) =>
        Assert.Equal(
            first,
            Project(ChatMessageItemModel.Ready(Msg(), isFirstInGroup: first)).ShowAvatar);

    [Fact]
    public void Show_timestamp_when_last_in_group_and_not_streaming() =>
        Assert.True(Project(ChatMessageItemModel.Ready(Msg(), isLastInGroup: true)).ShowTimestamp);

    [Fact]
    public void Hide_timestamp_when_not_last_in_group() =>
        Assert.False(Project(ChatMessageItemModel.Ready(Msg(), isLastInGroup: false)).ShowTimestamp);

    [Fact]
    public void Hide_timestamp_while_streaming() =>
        Assert.False(
            Project(ChatMessageItemModel.Ready(Msg(content: "x", isStreaming: true), isLastInGroup: true)).ShowTimestamp);

    [Fact]
    public void Hide_timestamp_when_created_at_is_null() =>
        Assert.False(
            Project(ChatMessageItemModel.Ready(Msg(createdAt: null) with { CreatedAt = null }, isLastInGroup: true)).ShowTimestamp);

    [Fact]
    public void Show_actions_when_not_streaming_and_not_disabled() =>
        Assert.True(Project(ChatMessageItemModel.Ready(Msg())).ShowActions);

    [Fact]
    public void Hide_actions_while_streaming() =>
        Assert.False(Project(ChatMessageItemModel.Ready(Msg(content: "x", isStreaming: true))).ShowActions);

    [Fact]
    public void Hide_actions_when_actions_disabled() =>
        Assert.False(
            Project(new ChatMessageItemModel(ChatMessageItemState.Ready, Msg(), ActionsDisabled: true)).ShowActions);

    // ── Per-action gating: copy always; regenerate last-assistant; edit last-user ─────────────────────────

    [Fact]
    public void Copy_is_shown_on_every_content_row() =>
        Assert.True(Project(ChatMessageItemModel.Ready(Msg())).ShowCopy);

    [Fact]
    public void Regenerate_shown_for_last_assistant_when_handler_wired() =>
        Assert.True(
            Project(ChatMessageItemModel.Ready(
                Msg(role: ChatRole.Assistant), isLastAssistant: true, canRegenerate: true)).ShowRegenerate);

    [Fact]
    public void Regenerate_hidden_when_not_last_assistant() =>
        Assert.False(
            Project(ChatMessageItemModel.Ready(
                Msg(role: ChatRole.Assistant), isLastAssistant: false, canRegenerate: true)).ShowRegenerate);

    [Fact]
    public void Regenerate_hidden_when_no_handler() =>
        Assert.False(
            Project(ChatMessageItemModel.Ready(
                Msg(role: ChatRole.Assistant), isLastAssistant: true, canRegenerate: false)).ShowRegenerate);

    [Fact]
    public void Regenerate_hidden_for_user_message() =>
        Assert.False(
            Project(ChatMessageItemModel.Ready(
                Msg(role: ChatRole.User), isLastAssistant: true, canRegenerate: true)).ShowRegenerate);

    [Fact]
    public void Edit_shown_for_last_user_when_handler_wired() =>
        Assert.True(
            Project(ChatMessageItemModel.Ready(
                Msg(role: ChatRole.User), isLastUser: true, canEditAndResend: true)).ShowEdit);

    [Fact]
    public void Edit_hidden_when_not_last_user() =>
        Assert.False(
            Project(ChatMessageItemModel.Ready(
                Msg(role: ChatRole.User), isLastUser: false, canEditAndResend: true)).ShowEdit);

    [Fact]
    public void Edit_hidden_when_no_handler() =>
        Assert.False(
            Project(ChatMessageItemModel.Ready(
                Msg(role: ChatRole.User), isLastUser: true, canEditAndResend: false)).ShowEdit);

    [Fact]
    public void Edit_hidden_for_assistant_message() =>
        Assert.False(
            Project(ChatMessageItemModel.Ready(
                Msg(role: ChatRole.Assistant), isLastUser: true, canEditAndResend: true)).ShowEdit);

    // ── Markdown: assistant replies parse; user messages stay literal ─────────────────────────────────────

    [Fact]
    public void Assistant_reply_is_parsed_to_markdown_blocks() =>
        Assert.NotEmpty(Project(ChatMessageItemModel.Ready(Msg(role: ChatRole.Assistant, content: "**hi**"))).MarkdownBlocks);

    [Fact]
    public void User_message_is_not_markdown_rendered() =>
        Assert.Empty(Project(ChatMessageItemModel.Ready(Msg(role: ChatRole.User, content: "**hi**"))).MarkdownBlocks);

    // ── Markdown adapter (the web MarkdownRenderer element map) ───────────────────────────────────────────

    [Fact]
    public void Markdown_empty_for_null_or_blank()
    {
        Assert.Empty(ChatMarkdown.Parse(null));
        Assert.Empty(ChatMarkdown.Parse(string.Empty));
    }

    [Fact]
    public void Markdown_paragraph_of_plain_text()
    {
        var blocks = ChatMarkdown.Parse("just text");

        var block = Assert.Single(blocks);
        Assert.Equal(ChatMarkdownBlockKind.Paragraph, block.Kind);
        var span = Assert.Single(block.Inlines);
        Assert.Equal(ChatMarkdownInlineKind.Text, span.Kind);
        Assert.Equal("just text", span.Text);
    }

    [Theory]
    [InlineData("# H1", 1)]
    [InlineData("## H2", 2)]
    [InlineData("### H3", 3)]
    [InlineData("##### H5 clamps", 3)]
    public void Markdown_headings_map_levels(string source, int level)
    {
        var block = Assert.Single(ChatMarkdown.Parse(source));

        Assert.Equal(ChatMarkdownBlockKind.Heading, block.Kind);
        Assert.Equal(level, block.HeadingLevel);
    }

    [Fact]
    public void Markdown_seven_hashes_is_not_a_heading() =>
        Assert.Equal(ChatMarkdownBlockKind.Paragraph, Assert.Single(ChatMarkdown.Parse("####### not")).Kind);

    [Fact]
    public void Markdown_bullet_list_groups_items()
    {
        var block = Assert.Single(ChatMarkdown.Parse("- one\n- two\n- three"));

        Assert.Equal(ChatMarkdownBlockKind.BulletList, block.Kind);
        Assert.Equal(3, block.Items.Count);
    }

    [Fact]
    public void Markdown_ordered_list_keeps_start_ordinal()
    {
        var block = Assert.Single(ChatMarkdown.Parse("3. third\n4. fourth"));

        Assert.Equal(ChatMarkdownBlockKind.OrderedList, block.Kind);
        Assert.Equal(3, block.OrderedStart);
        Assert.Equal(2, block.Items.Count);
    }

    [Fact]
    public void Markdown_fenced_code_keeps_language_and_text()
    {
        var block = Assert.Single(ChatMarkdown.Parse("```go\nfmt.Println(\"hi\")\n```"));

        Assert.Equal(ChatMarkdownBlockKind.CodeBlock, block.Kind);
        Assert.Equal("go", block.CodeLanguage);
        Assert.Equal("fmt.Println(\"hi\")", block.CodeText);
    }

    [Fact]
    public void Markdown_fenced_code_without_language()
    {
        var block = Assert.Single(ChatMarkdown.Parse("```\nplain\n```"));

        Assert.Equal(ChatMarkdownBlockKind.CodeBlock, block.Kind);
        Assert.Null(block.CodeLanguage);
        Assert.Equal("plain", block.CodeText);
    }

    [Fact]
    public void Markdown_soft_line_breaks_within_a_paragraph()
    {
        var block = Assert.Single(ChatMarkdown.Parse("line one\nline two"));

        Assert.Equal(ChatMarkdownBlockKind.Paragraph, block.Kind);
        Assert.Collection(
            block.Inlines,
            s => Assert.Equal("line one", s.Text),
            s => Assert.Equal("\n", s.Text),
            s => Assert.Equal("line two", s.Text));
    }

    [Fact]
    public void Markdown_inline_bold()
    {
        var spans = ChatMarkdown.ParseInlines("**strong**");

        var span = Assert.Single(spans);
        Assert.Equal(ChatMarkdownInlineKind.Bold, span.Kind);
        Assert.Equal("strong", span.Text);
    }

    [Theory]
    [InlineData("*em*")]
    [InlineData("_em_")]
    public void Markdown_inline_italic(string source)
    {
        var span = Assert.Single(ChatMarkdown.ParseInlines(source));

        Assert.Equal(ChatMarkdownInlineKind.Italic, span.Kind);
        Assert.Equal("em", span.Text);
    }

    [Fact]
    public void Markdown_inline_code_is_literal()
    {
        var span = Assert.Single(ChatMarkdown.ParseInlines("`a*b`"));

        Assert.Equal(ChatMarkdownInlineKind.Code, span.Kind);
        Assert.Equal("a*b", span.Text);
    }

    [Fact]
    public void Markdown_inline_link_captures_label_and_href()
    {
        var span = Assert.Single(ChatMarkdown.ParseInlines("[docs](https://example.com)"));

        Assert.Equal(ChatMarkdownInlineKind.Link, span.Kind);
        Assert.Equal("docs", span.Text);
        Assert.Equal("https://example.com", span.Href);
    }

    [Fact]
    public void Markdown_mixed_inline_runs()
    {
        var spans = ChatMarkdown.ParseInlines("a **b** c");

        Assert.Collection(
            spans,
            s => { Assert.Equal(ChatMarkdownInlineKind.Text, s.Kind); Assert.Equal("a ", s.Text); },
            s => { Assert.Equal(ChatMarkdownInlineKind.Bold, s.Kind); Assert.Equal("b", s.Text); },
            s => { Assert.Equal(ChatMarkdownInlineKind.Text, s.Kind); Assert.Equal(" c", s.Text); });
    }

    [Fact]
    public void Markdown_does_not_interpret_raw_html()
    {
        // Safe-by-default, exactly like the web renderer: raw HTML is emitted as literal text, never executed.
        var block = Assert.Single(ChatMarkdown.Parse("<script>alert(1)</script>"));

        var span = Assert.Single(block.Inlines);
        Assert.Equal(ChatMarkdownInlineKind.Text, span.Kind);
        Assert.Equal("<script>alert(1)</script>", span.Text);
    }

    // ── No-op edit guard: web !trimmed || trimmed === content.trim() ──────────────────────────────────────

    [Theory]
    [InlineData("", "original")]
    [InlineData("   ", "original")]
    [InlineData("original", "original")]
    [InlineData("  original  ", "original")]
    public void Edit_is_a_no_op(string draft, string original) =>
        Assert.True(ChatMessageItemProjection.IsNoOpEdit(draft, original));

    [Fact]
    public void Edit_with_a_real_change_is_not_a_no_op() =>
        Assert.False(ChatMessageItemProjection.IsNoOpEdit("revised", "original"));

    // ── Freshness chip ────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Ready_has_no_freshness_chip() =>
        Assert.False(Project(ChatMessageItemModel.Ready(Msg())).ShowFreshnessChip);

    [Fact]
    public void Stale_shows_a_warning_stale_chip()
    {
        var display = Project(ChatMessageItemModel.Stale(Msg()));

        Assert.True(display.ShowFreshnessChip);
        Assert.Equal("Stale", display.FreshnessChipText);
        Assert.Equal(StatusKind.Warning, display.FreshnessChipStatus);
    }

    [Fact]
    public void Offline_shows_a_danger_offline_chip()
    {
        var display = Project(ChatMessageItemModel.Offline(Msg()));

        Assert.True(display.ShowFreshnessChip);
        Assert.Equal("Offline", display.FreshnessChipText);
        Assert.Equal(StatusKind.Danger, display.FreshnessChipStatus);
    }

    [Fact]
    public void Offline_keeps_the_cached_message()
    {
        var display = Project(ChatMessageItemModel.Offline(Msg(role: ChatRole.User, content: "cached question")));

        Assert.Equal("cached question", display.VisibleText);
    }

    // ── Fixed copy (loading / empty / error / retry) ──────────────────────────────────────────────────────

    [Fact]
    public void Loading_label_uses_the_shared_common_loading_string() =>
        Assert.Equal("Loading...", Project(ChatMessageItemModel.Loading()).LoadingLabel);

    [Fact]
    public void Empty_message_uses_the_shared_no_data_string() =>
        Assert.Equal("No data available", Project(ChatMessageItemModel.Empty()).EmptyMessage);

    [Fact]
    public void Error_title_is_resolved() =>
        Assert.Equal("Failed to load data", Project(ChatMessageItemModel.Failed()).ErrorTitle);

    [Fact]
    public void Error_message_falls_back_to_the_default_when_none_supplied() =>
        Assert.Equal(
            "Check your internet connection and try again.",
            Project(ChatMessageItemModel.Failed()).ErrorMessage);

    [Fact]
    public void Error_message_uses_the_supplied_message() =>
        Assert.Equal("Service unavailable", Project(ChatMessageItemModel.Failed("Service unavailable")).ErrorMessage);

    [Fact]
    public void Retry_label_uses_the_shared_common_retry_string() =>
        Assert.Equal("Retry", Project(ChatMessageItemModel.Failed()).RetryLabel);

    // ── Localized action labels resolve through the i18n facade ───────────────────────────────────────────

    [Fact]
    public void Action_labels_resolve_to_the_web_strings()
    {
        var display = Project(ChatMessageItemModel.Ready(Msg()));

        Assert.Equal("Copy message", display.CopyAriaLabel);
        Assert.Equal("Regenerate", display.RegenerateLabel);
        Assert.Equal("Regenerate response", display.RegenerateAriaLabel);
        Assert.Equal("Edit", display.EditLabel);
        Assert.Equal("Edit and resend", display.EditAriaLabel);
        Assert.Equal("Cancel", display.CancelLabel);
        Assert.Equal("Save & resend", display.SaveLabel);
        Assert.Equal("Edit message", display.EditMessageAriaLabel);
    }

    // ── i18n keys match the web source verbatim ───────────────────────────────────────────────────────────

    [Fact]
    public void I18n_keys_match_the_web_source()
    {
        Assert.Equal("chatbot.aria.editMessage", ChatMessageItemProjection.EditMessageAriaKey);
        Assert.Equal("chatbot.actions.cancel", ChatMessageItemProjection.CancelKey);
        Assert.Equal("chatbot.actions.saveAndResend", ChatMessageItemProjection.SaveKey);
        Assert.Equal("chatbot.aria.copyMessage", ChatMessageItemProjection.CopyAriaKey);
        Assert.Equal("chatbot.aria.regenerate", ChatMessageItemProjection.RegenerateAriaKey);
        Assert.Equal("chatbot.actions.regenerate", ChatMessageItemProjection.RegenerateKey);
        Assert.Equal("chatbot.aria.edit", ChatMessageItemProjection.EditAriaKey);
        Assert.Equal("chatbot.actions.edit", ChatMessageItemProjection.EditKey);
    }

    // ── Accessibility: every state exposes a meaningful Narrator name ─────────────────────────────────────

    [Fact]
    public void Every_state_exposes_a_non_empty_automation_name() =>
        Assert.All(
            new[]
            {
                Project(ChatMessageItemModel.Loading()),
                Project(ChatMessageItemModel.Empty()),
                Project(ChatMessageItemModel.Failed()),
                Project(ChatMessageItemModel.Stale(Msg())),
                Project(ChatMessageItemModel.Offline(Msg())),
                Project(ChatMessageItemModel.Ready(Msg())),
            },
            display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));

    [Fact]
    public void Loading_automation_name_is_the_loading_label() =>
        Assert.Equal("Loading...", Project(ChatMessageItemModel.Loading()).AutomationName);

    [Fact]
    public void Empty_automation_name_is_the_empty_message() =>
        Assert.Equal("No data available", Project(ChatMessageItemModel.Empty()).AutomationName);

    [Fact]
    public void Error_automation_name_is_the_error_title() =>
        Assert.Equal("Failed to load data", Project(ChatMessageItemModel.Failed()).AutomationName);

    [Fact]
    public void Ready_automation_name_carries_the_message_text() =>
        Assert.Equal(
            "How many miles today?",
            Project(ChatMessageItemModel.Ready(Msg(role: ChatRole.User, content: "How many miles today?"))).AutomationName);

    [Fact]
    public void Stale_automation_name_includes_the_chip() =>
        Assert.StartsWith("Stale", Project(ChatMessageItemModel.Stale(Msg())).AutomationName, StringComparison.Ordinal);

    [Fact]
    public void Offline_automation_name_includes_the_chip() =>
        Assert.StartsWith("Offline", Project(ChatMessageItemModel.Offline(Msg())).AutomationName, StringComparison.Ordinal);

    // ── Timestamp ─────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Timestamp_is_an_em_dash_when_created_at_is_null() =>
        Assert.Equal(
            "\u2014",
            Project(ChatMessageItemModel.Ready(Msg() with { CreatedAt = null })).TimestampText);

    [Fact]
    public void Timestamp_is_rendered_when_created_at_is_present() =>
        Assert.False(
            string.IsNullOrWhiteSpace(Project(ChatMessageItemModel.Ready(Msg(createdAt: At))).TimestampText));

    // ── Diagnostics (P1/S11): view.opened slug=ChatMessageItem, PII-safe ──────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new ChatMessageItemDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=ChatMessageItem", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_the_message_content()
    {
        var captured = new List<string>();
        var diagnostics = new ChatMessageItemDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(captured);
        Assert.Equal("view.opened slug=ChatMessageItem", line);
        Assert.DoesNotContain("Hello", line, StringComparison.Ordinal);
    }

    [Fact]
    public void Diagnostics_line_is_culture_invariant()
    {
        var original = CultureInfo.CurrentCulture;
        try
        {
            CultureInfo.CurrentCulture = new CultureInfo("tr-TR");
            var captured = new List<string>();
            new ChatMessageItemDiagnostics(captured.Add).RecordViewOpened();
            Assert.Equal("view.opened slug=ChatMessageItem", Assert.Single(captured));
        }
        finally
        {
            CultureInfo.CurrentCulture = original;
        }
    }

    [Fact]
    public void Registration_slug_is_stable() =>
        Assert.Equal("ChatMessageItem", ChatMessageItemRegistration.Slug);

    // ── Argument validation ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<ArgumentNullException>(() => ChatMessageItemProjection.Project(null!, Localizer));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(
            () => ChatMessageItemProjection.Project(ChatMessageItemModel.Loading(), null!));

    [Fact]
    public void Ready_rejects_a_null_message() =>
        Assert.Throws<ArgumentNullException>(() => ChatMessageItemModel.Ready(null!));

    [Fact]
    public void Stale_rejects_a_null_message() =>
        Assert.Throws<ArgumentNullException>(() => ChatMessageItemModel.Stale(null!));

    [Fact]
    public void Offline_rejects_a_null_message() =>
        Assert.Throws<ArgumentNullException>(() => ChatMessageItemModel.Offline(null!));
}
