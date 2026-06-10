using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Chatbot;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>MarkdownRenderer</c> feature surface's UI-thread-free logic — the markdown
/// parser data adapter (block + inline construction), the per-state branch projection
/// (loading / ready / empty / error / stale / offline), the freshness chip copy, the localized chrome, the
/// accessible names, and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/system/components/chatbot/MarkdownRenderer.tsx + remark-gfm). The WinUI view itself
/// (MarkdownRenderer.cs) is exercised by the app build.
/// </summary>
public sealed class MarkdownRendererTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static MarkdownRendererDisplay Project(MarkdownRendererModel model) =>
        MarkdownRendererProjection.Project(model, Localizer);

    private static T Single<T>(MarkdownDocument document)
        where T : MarkdownBlock
    {
        MarkdownBlock block = Assert.Single(document.Blocks);
        return Assert.IsType<T>(block);
    }

    private static string Flatten(IReadOnlyList<MarkdownInline> inlines) =>
        MarkdownRendererProjection.FlattenText(new MarkdownDocument(new MarkdownBlock[] { new MarkdownParagraph(inlines) }));

    // ── Parser: block structure ──────────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("\n\n  \n")]
    public void Parse_blank_source_yields_an_empty_document(string? source) =>
        Assert.True(MarkdownParser.Parse(source).IsEmpty);

    [Fact]
    public void Parse_plain_text_yields_a_single_paragraph()
    {
        var paragraph = Single<MarkdownParagraph>(MarkdownParser.Parse("Hello world"));
        Assert.Equal("Hello world", Flatten(paragraph.Inlines));
    }

    [Fact]
    public void Parse_soft_wrapped_lines_collapse_into_one_paragraph()
    {
        var paragraph = Single<MarkdownParagraph>(MarkdownParser.Parse("line one\nline two"));
        Assert.Equal("line one line two", Flatten(paragraph.Inlines));
    }

    [Theory]
    [InlineData("# Title", 1)]
    [InlineData("## Section", 2)]
    [InlineData("### Subsection", 3)]
    [InlineData("###### Deep", 6)]
    public void Parse_atx_headings_capture_their_level(string source, int expectedLevel)
    {
        var heading = Single<MarkdownHeading>(MarkdownParser.Parse(source));
        Assert.Equal(expectedLevel, heading.Level);
    }

    [Fact]
    public void Parse_heading_strips_trailing_hashes()
    {
        var heading = Single<MarkdownHeading>(MarkdownParser.Parse("## Section ##"));
        Assert.Equal("Section", Flatten(heading.Inlines));
    }

    [Fact]
    public void Parse_seven_hashes_is_not_a_heading() =>
        Assert.IsType<MarkdownParagraph>(Assert.Single(MarkdownParser.Parse("####### nope").Blocks));

    [Fact]
    public void Parse_unordered_list_collects_items()
    {
        var list = Single<MarkdownList>(MarkdownParser.Parse("- first\n- second\n- third"));
        Assert.False(list.Ordered);
        Assert.Equal(3, list.Items.Count);
        Assert.Equal("first", Flatten(list.Items[0].Inlines));
        Assert.Equal("third", Flatten(list.Items[2].Inlines));
    }

    [Theory]
    [InlineData("* a\n* b")]
    [InlineData("+ a\n+ b")]
    [InlineData("- a\n- b")]
    public void Parse_recognizes_every_bullet_marker(string source)
    {
        var list = Single<MarkdownList>(MarkdownParser.Parse(source));
        Assert.False(list.Ordered);
        Assert.Equal(2, list.Items.Count);
    }

    [Fact]
    public void Parse_ordered_list_preserves_the_author_start_number()
    {
        var list = Single<MarkdownList>(MarkdownParser.Parse("3. third\n4. fourth"));
        Assert.True(list.Ordered);
        Assert.Equal(3, list.Start);
        Assert.Equal(2, list.Items.Count);
    }

    [Fact]
    public void Parse_fenced_code_block_captures_language_and_body()
    {
        var code = Single<MarkdownCodeBlock>(MarkdownParser.Parse("```ts\nconst x = 1;\nconst y = 2;\n```"));
        Assert.Equal("ts", code.Language);
        Assert.Equal("const x = 1;\nconst y = 2;", code.Code);
    }

    [Fact]
    public void Parse_fenced_code_block_without_language_has_null_language()
    {
        var code = Single<MarkdownCodeBlock>(MarkdownParser.Parse("```\nplain\n```"));
        Assert.Null(code.Language);
        Assert.Equal("plain", code.Code);
    }

    [Fact]
    public void Parse_fenced_code_block_does_not_parse_inner_markdown()
    {
        var code = Single<MarkdownCodeBlock>(MarkdownParser.Parse("```\n**not bold** and `not code`\n```"));
        Assert.Equal("**not bold** and `not code`", code.Code);
    }

    [Fact]
    public void Parse_unterminated_fence_still_yields_a_code_block()
    {
        var code = Single<MarkdownCodeBlock>(MarkdownParser.Parse("```py\nx = 1"));
        Assert.Equal("py", code.Language);
        Assert.Equal("x = 1", code.Code);
    }

    [Theory]
    [InlineData("---")]
    [InlineData("***")]
    [InlineData("___")]
    [InlineData("- - -")]
    public void Parse_thematic_break(string source) =>
        Assert.IsType<MarkdownThematicBreak>(Assert.Single(MarkdownParser.Parse(source).Blocks));

    [Fact]
    public void Parse_block_quote()
    {
        var quote = Single<MarkdownBlockQuote>(MarkdownParser.Parse("> a quoted line"));
        Assert.Equal("a quoted line", Flatten(quote.Inlines));
    }

    [Fact]
    public void Parse_gfm_table_captures_header_rows_and_alignment()
    {
        var table = Single<MarkdownTable>(MarkdownParser.Parse(
            "| Name | Value |\n| :--- | ---: |\n| speed | 60 |\n| range | 300 |"));

        Assert.Equal(2, table.Header.Count);
        Assert.Equal("Name", Flatten(table.Header[0].Inlines));
        Assert.Equal("Value", Flatten(table.Header[1].Inlines));
        Assert.Equal(MarkdownColumnAlignment.Left, table.Header[0].Alignment);
        Assert.Equal(MarkdownColumnAlignment.Right, table.Header[1].Alignment);

        Assert.Equal(2, table.Rows.Count);
        Assert.Equal("speed", Flatten(table.Rows[0].Cells[0].Inlines));
        Assert.Equal("300", Flatten(table.Rows[1].Cells[1].Inlines));
    }

    [Fact]
    public void Parse_table_centre_alignment()
    {
        var table = Single<MarkdownTable>(MarkdownParser.Parse("| A |\n| :---: |\n| x |"));
        Assert.Equal(MarkdownColumnAlignment.Center, table.Header[0].Alignment);
    }

    [Fact]
    public void Parse_multiple_blocks_in_order()
    {
        MarkdownDocument document = MarkdownParser.Parse("# Title\n\nA paragraph.\n\n- one\n- two");
        Assert.Collection(
            document.Blocks,
            b => Assert.IsType<MarkdownHeading>(b),
            b => Assert.IsType<MarkdownParagraph>(b),
            b => Assert.IsType<MarkdownList>(b));
    }

    // ── Parser: inline structure ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Parse_strong()
    {
        var inline = Assert.Single(MarkdownParser.ParseInlines("**bold**"));
        Assert.Equal(MarkdownInlineKind.Strong, inline.Kind);
        Assert.Equal("bold", Flatten(inline.Children));
    }

    [Theory]
    [InlineData("*italic*")]
    [InlineData("_italic_")]
    public void Parse_emphasis(string source)
    {
        var inline = Assert.Single(MarkdownParser.ParseInlines(source));
        Assert.Equal(MarkdownInlineKind.Emphasis, inline.Kind);
        Assert.Equal("italic", Flatten(inline.Children));
    }

    [Fact]
    public void Parse_strikethrough()
    {
        var inline = Assert.Single(MarkdownParser.ParseInlines("~~gone~~"));
        Assert.Equal(MarkdownInlineKind.Strikethrough, inline.Kind);
        Assert.Equal("gone", Flatten(inline.Children));
    }

    [Fact]
    public void Parse_inline_code_span_is_not_reparsed()
    {
        var inline = Assert.Single(MarkdownParser.ParseInlines("`**raw**`"));
        Assert.Equal(MarkdownInlineKind.CodeSpan, inline.Kind);
        Assert.Equal("**raw**", inline.Text);
    }

    [Fact]
    public void Parse_link_captures_label_and_href()
    {
        var inline = Assert.Single(MarkdownParser.ParseInlines("[Tesla](https://tesla.com)"));
        Assert.Equal(MarkdownInlineKind.Link, inline.Kind);
        Assert.Equal("https://tesla.com", inline.Href);
        Assert.Equal("Tesla", Flatten(inline.Children));
    }

    [Fact]
    public void Parse_intraword_underscore_stays_literal()
    {
        // snake_case identifiers are pervasive in this domain; react-markdown does not italicize them.
        IReadOnlyList<MarkdownInline> inlines = MarkdownParser.ParseInlines("charge_state_battery_level");
        var inline = Assert.Single(inlines);
        Assert.Equal(MarkdownInlineKind.Text, inline.Kind);
        Assert.Equal("charge_state_battery_level", inline.Text);
    }

    [Fact]
    public void Parse_backslash_escape_keeps_the_literal_character()
    {
        IReadOnlyList<MarkdownInline> inlines = MarkdownParser.ParseInlines("\\*not italic\\*");
        var inline = Assert.Single(inlines);
        Assert.Equal(MarkdownInlineKind.Text, inline.Kind);
        Assert.Equal("*not italic*", inline.Text);
    }

    [Fact]
    public void Parse_hard_line_break_emits_a_break_inline()
    {
        IReadOnlyList<MarkdownInline> inlines = MarkdownParser.ParseInlines("first  \nsecond");
        Assert.Collection(
            inlines,
            i => Assert.Equal(MarkdownInlineKind.Text, i.Kind),
            i => Assert.Equal(MarkdownInlineKind.LineBreak, i.Kind),
            i => Assert.Equal(MarkdownInlineKind.Text, i.Kind));
    }

    [Fact]
    public void Parse_mixed_inline_run()
    {
        IReadOnlyList<MarkdownInline> inlines = MarkdownParser.ParseInlines("Say **hi** to `code` and *me*");
        Assert.Collection(
            inlines,
            i => Assert.Equal(MarkdownInlineKind.Text, i.Kind),
            i => Assert.Equal(MarkdownInlineKind.Strong, i.Kind),
            i => Assert.Equal(MarkdownInlineKind.Text, i.Kind),
            i => Assert.Equal(MarkdownInlineKind.CodeSpan, i.Kind),
            i => Assert.Equal(MarkdownInlineKind.Text, i.Kind),
            i => Assert.Equal(MarkdownInlineKind.Emphasis, i.Kind));
    }

    // ── Sanitization parity: raw HTML is literal text, never executed ─────────────────────────────────────

    [Fact]
    public void Parse_raw_html_is_treated_as_literal_text()
    {
        // react-markdown is safe-by-default (rehype-raw is NOT enabled): a <script> renders escaped, never runs.
        var paragraph = Single<MarkdownParagraph>(MarkdownParser.Parse("<script>alert(1)</script>"));
        Assert.Equal("<script>alert(1)</script>", Flatten(paragraph.Inlines));
        Assert.All(paragraph.Inlines, i => Assert.Equal(MarkdownInlineKind.Text, i.Kind));
    }

    // ── Projection: per-state branches (every state renders) ──────────────────────────────────────────────

    [Fact]
    public void Project_loading_keeps_the_raw_fallback_text()
    {
        MarkdownRendererDisplay display = Project(MarkdownRendererModel.Loading("partial **reply**"));
        Assert.Equal(MarkdownRendererState.Loading, display.State);
        Assert.Equal("partial **reply**", display.FallbackText);
        Assert.True(display.Document.IsEmpty);
    }

    [Fact]
    public void Project_ready_parses_the_document()
    {
        MarkdownRendererDisplay display = Project(MarkdownRendererModel.Ready("# Hi\n\nbody"));
        Assert.Equal(MarkdownRendererState.Ready, display.State);
        Assert.Equal(2, display.Document.Blocks.Count);
        Assert.False(display.ShowFreshnessChip);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void Project_ready_with_no_content_collapses_to_empty(string markdown)
    {
        MarkdownRendererDisplay display = Project(MarkdownRendererModel.Ready(markdown));
        Assert.Equal(MarkdownRendererState.Empty, display.State);
    }

    [Fact]
    public void Project_empty_carries_localized_copy_and_no_blank_box()
    {
        MarkdownRendererDisplay display = Project(MarkdownRendererModel.Empty());
        Assert.Equal(MarkdownRendererState.Empty, display.State);
        Assert.Equal(MarkdownRendererRegistration.EmptyTitleFallback, display.EmptyTitle);
        Assert.Equal(MarkdownRendererRegistration.EmptyMessageFallback, display.EmptyMessage);
    }

    [Fact]
    public void Project_error_carries_default_copy_and_retry()
    {
        MarkdownRendererDisplay display = Project(MarkdownRendererModel.Failed());
        Assert.Equal(MarkdownRendererState.Error, display.State);
        Assert.Equal(MarkdownRendererRegistration.ErrorTitleFallback, display.ErrorTitle);
        Assert.Equal(MarkdownRendererRegistration.ErrorMessageFallback, display.ErrorMessage);
        Assert.Equal(MarkdownRendererRegistration.RetryFallback, display.RetryLabel);
    }

    [Fact]
    public void Project_error_prefers_the_supplied_message()
    {
        MarkdownRendererDisplay display = Project(MarkdownRendererModel.Failed("Specific failure"));
        Assert.Equal("Specific failure", display.ErrorMessage);
    }

    [Fact]
    public void Project_stale_renders_content_with_a_stale_chip()
    {
        MarkdownRendererDisplay display = Project(MarkdownRendererModel.Stale("cached **reply**"));
        Assert.Equal(MarkdownRendererState.Stale, display.State);
        Assert.True(display.ShowFreshnessChip);
        Assert.False(display.IsOffline);
        Assert.Equal(MarkdownRendererRegistration.StaleFallback, display.FreshnessChipText);
        Assert.Single(display.Document.Blocks);
    }

    [Fact]
    public void Project_offline_renders_content_with_an_offline_chip()
    {
        MarkdownRendererDisplay display = Project(MarkdownRendererModel.Offline("cached reply"));
        Assert.Equal(MarkdownRendererState.Offline, display.State);
        Assert.True(display.ShowFreshnessChip);
        Assert.True(display.IsOffline);
        Assert.Equal(MarkdownRendererRegistration.OfflineFallback, display.FreshnessChipText);
    }

    [Fact]
    public void Project_carries_localized_code_copy_labels()
    {
        MarkdownRendererDisplay display = Project(MarkdownRendererModel.Ready("```\nx\n```"));
        Assert.Equal(MarkdownRendererRegistration.CopyFallback, display.CopyLabel);
        Assert.Equal(MarkdownRendererRegistration.CopiedFallback, display.CopiedLabel);
    }

    // ── Accessibility: every state announces a non-empty Narrator name ────────────────────────────────────

    [Theory]
    [InlineData(MarkdownRendererState.Loading)]
    [InlineData(MarkdownRendererState.Ready)]
    [InlineData(MarkdownRendererState.Empty)]
    [InlineData(MarkdownRendererState.Error)]
    [InlineData(MarkdownRendererState.Stale)]
    [InlineData(MarkdownRendererState.Offline)]
    public void Project_every_state_has_an_automation_name(MarkdownRendererState state)
    {
        MarkdownRendererModel model = state switch
        {
            MarkdownRendererState.Loading => MarkdownRendererModel.Loading("partial"),
            MarkdownRendererState.Ready => MarkdownRendererModel.Ready("hello"),
            MarkdownRendererState.Empty => MarkdownRendererModel.Empty(),
            MarkdownRendererState.Error => MarkdownRendererModel.Failed(),
            MarkdownRendererState.Stale => MarkdownRendererModel.Stale("hello"),
            _ => MarkdownRendererModel.Offline("hello"),
        };

        Assert.False(string.IsNullOrWhiteSpace(Project(model).AutomationName));
    }

    [Fact]
    public void Project_automation_name_carries_the_surface_name_and_content()
    {
        MarkdownRendererDisplay display = Project(MarkdownRendererModel.Ready("Hello world"));
        Assert.Contains(MarkdownRendererRegistration.SurfaceNameFallback, display.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Hello world", display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_stale_automation_name_includes_the_chip()
    {
        MarkdownRendererDisplay display = Project(MarkdownRendererModel.Stale("Hello"));
        Assert.Contains(MarkdownRendererRegistration.StaleFallback, display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_error_automation_name_carries_the_error_title()
    {
        MarkdownRendererDisplay display = Project(MarkdownRendererModel.Failed());
        Assert.Contains(MarkdownRendererRegistration.ErrorTitleFallback, display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Flatten_text_reads_every_block_in_order()
    {
        MarkdownDocument document = MarkdownParser.Parse("# Heading\n\nbody text\n\n- item one\n- item two");
        string text = MarkdownRendererProjection.FlattenText(document);
        Assert.Contains("Heading", text, StringComparison.Ordinal);
        Assert.Contains("body text", text, StringComparison.Ordinal);
        Assert.Contains("item one", text, StringComparison.Ordinal);
        Assert.Contains("item two", text, StringComparison.Ordinal);
    }

    // ── Diagnostics (P1/S11): view.opened slug=MarkdownRenderer, PII-safe ─────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new MarkdownRendererDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=MarkdownRenderer", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_message_content()
    {
        var captured = new List<string>();
        var diagnostics = new MarkdownRendererDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        string line = Assert.Single(captured);
        Assert.Equal("view.opened slug=MarkdownRenderer", line);
        Assert.DoesNotContain("http", line, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Registration_slug_is_stable() =>
        Assert.Equal("MarkdownRenderer", MarkdownRendererRegistration.Slug);

    [Fact]
    public void Registration_glyphs_match_the_established_segoe_fluent_mappings()
    {
        Assert.Equal("\uE8C8", MarkdownRendererRegistration.CopyGlyph);
        Assert.Equal("\uE8BD", MarkdownRendererRegistration.EmptyGlyph);
    }

    // ── Argument validation ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<ArgumentNullException>(() => MarkdownRendererProjection.Project(null!, Localizer));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() => MarkdownRendererProjection.Project(MarkdownRendererModel.Empty(), null!));

    [Fact]
    public void Ready_rejects_a_null_markdown() =>
        Assert.Throws<ArgumentNullException>(() => MarkdownRendererModel.Ready(null!));

    [Fact]
    public void FlattenText_rejects_a_null_document() =>
        Assert.Throws<ArgumentNullException>(() => MarkdownRendererProjection.FlattenText(null!));
}
