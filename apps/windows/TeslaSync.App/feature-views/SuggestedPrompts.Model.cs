using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// One suggestion-chip definition backing the surface — the native analogue of an entry in the web
/// <c>getChatSuggestions()</c> array (web/src/features/system/components/chatbot/SuggestedPrompts.tsx). It keeps
/// the suggestion's i18n key <see cref="I18nKey"/> (resolved at the display boundary, never a baked English
/// literal) and its English <see cref="DefaultValue"/> — the web <c>defaultValue</c> returned when the key is
/// absent (the localizer contract). Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="I18nKey">The i18n key resolved through the localizer (web <c>s.i18nKey</c>).</param>
/// <param name="DefaultValue">The English fallback returned when the key is absent (web <c>s.defaultValue</c>).</param>
public sealed record ChatSuggestion(string I18nKey, string DefaultValue);

/// <summary>
/// The mutually-exclusive surface state of <see cref="SuggestedPromptsViewModel"/>. The web
/// <c>SuggestedPrompts</c> consumes no asynchronous data — it only calls <c>useTranslation</c> and maps the
/// static in-process <c>getChatSuggestions()</c> list — so it has no fetch / loading / error / offline / stale
/// branches to mirror. The honest native union is therefore the two states the catalog can yield: a populated
/// chip strip (<see cref="Ready"/>) or, defensively, no suggestions at all (<see cref="Empty"/>) — which renders
/// a friendly empty surface rather than a blank box (the web simply renders an empty list; the native polish
/// always fills the region).
/// </summary>
public enum SuggestedPromptState
{
    /// <summary>The catalog yielded at least one suggestion — render the chip strip.</summary>
    Ready,

    /// <summary>The catalog yielded no suggestions — render the friendly empty surface (never a blank box).</summary>
    Empty,
}

/// <summary>
/// A projected, render-ready suggestion chip — the output of <see cref="SuggestedPromptsProjection"/>. Carries
/// the localized <see cref="Text"/> (the chip label and the value handed to the host when the chip is picked —
/// the web <c>onPick(text)</c> argument), the resolved Segoe Fluent <see cref="Glyph"/> (the web Lucide
/// <c>Sparkles</c> icon), and the <see cref="AutomationName"/> a screen reader announces for the chip.
/// Immutable so the view is a thin renderer.
/// </summary>
/// <param name="Text">The localized prompt text (web <c>t(s.i18nKey, s.defaultValue)</c>); also the pick value.</param>
/// <param name="Glyph">The Segoe Fluent glyph standing in for the web Lucide <c>Sparkles</c> icon.</param>
/// <param name="AutomationName">The Narrator name for the chip (its localized prompt text).</param>
public sealed record SuggestedPromptItem(string Text, string Glyph, string AutomationName);

/// <summary>
/// The static suggestion catalog — the native source-of-truth mirror of the web <c>getChatSuggestions()</c>
/// constant (web/src/features/system/components/chatbot/SuggestedPrompts.tsx). The i18n keys are reproduced
/// verbatim and the English defaults byte-for-byte; defined as a constant today (exactly as the web component
/// notes) so it can be swapped for a backend-fed source later without touching the surface shape.
/// </summary>
public static class ChatSuggestionCatalog
{
    private static readonly ChatSuggestion[] Entries =
    [
        new("chatbot.suggestion.fleetYesterday", "What did my fleet do yesterday?"),
        new("chatbot.suggestion.chargingCost30d", "Charging cost last 30 days"),
        new("chatbot.suggestion.socDropping", "Why is my SoC dropping faster this week?"),
        new("chatbot.suggestion.efficientDrive", "Show me the most efficient drive this month"),
    ];

    /// <summary>The four canonical chat suggestions, in web order.</summary>
    public static IReadOnlyList<ChatSuggestion> Default => Entries;
}

/// <summary>
/// Canonical metadata for the Suggested Prompts surface — the native mirror of the web <c>SuggestedPrompts</c>.
/// The web surface renders no visible heading (it is an empty-state chip strip), so the only keyed chrome here
/// is the accessibility region label (the web <c>&lt;ul aria-label&gt;</c>) and the defensive empty-state
/// message; both resolve through the localizer at the display boundary.
/// </summary>
public static class SuggestedPromptsRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "SuggestedPrompts";

    /// <summary>
    /// Segoe Fluent Icons code point standing in for the web Lucide <c>Sparkles</c> icon — the same glyph the
    /// AIRestorePanel / MiniGridPreview surfaces use for their Sparkles mapping (platform-idiomatic, never a
    /// ported web SVG asset).
    /// </summary>
    public const string SparkleGlyph = "\uE734";

    /// <summary>The i18n key for the accessibility region label (web <c>chatbot.aria.suggestions</c>).</summary>
    public const string AriaLabelKey = "chatbot.aria.suggestions";

    /// <summary>The i18n key for the defensive empty-state message (the shared generic "no data" copy).</summary>
    public const string EmptyKey = "common.noData";

    /// <summary>The localized Narrator landmark name for the chip strip (web <c>aria-label</c>).</summary>
    public static string RegionName(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(AriaLabelKey, "Suggested prompts");
    }

    /// <summary>The localized friendly empty-state message (no suggestions available).</summary>
    public static string EmptyMessage(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(EmptyKey, "No data available");
    }
}

/// <summary>
/// Pure projection from the static <see cref="ChatSuggestion"/> catalog to the render-ready
/// <see cref="SuggestedPromptItem"/> list — the native port of the web component's per-suggestion map
/// (web/src/features/system/components/chatbot/SuggestedPrompts.tsx). Resolves each prompt through the
/// localizer, attaches the Sparkles glyph, and composes the chip's Narrator name. WinUI-free so it is
/// unit-tested without a UI host.
/// </summary>
public static class SuggestedPromptsProjection
{
    /// <summary>The Segoe Fluent glyph every chip renders with (web Lucide <c>Sparkles</c> analogue).</summary>
    public static string Glyph() => SuggestedPromptsRegistration.SparkleGlyph;

    /// <summary>
    /// The Narrator name for a chip: its localized prompt text. The Sparkles icon is decorative, so the chip's
    /// accessible name is exactly the text — the web parity (the <c>Button</c>'s accessible name is its label).
    /// </summary>
    public static string AutomationName(string text) => text;

    /// <summary>
    /// Project <paramref name="catalog"/> into the localized, render-ready chip list. A <see langword="null"/>
    /// or empty catalog yields an empty list (the defensive empty state); each entry's prompt is resolved
    /// through <paramref name="localizer"/> exactly once.
    /// </summary>
    public static IReadOnlyList<SuggestedPromptItem> Project(
        IReadOnlyList<ChatSuggestion>? catalog,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        if (catalog is null || catalog.Count == 0)
        {
            return Array.Empty<SuggestedPromptItem>();
        }

        var items = new List<SuggestedPromptItem>(catalog.Count);
        foreach (var suggestion in catalog)
        {
            string text = localizer.GetString(suggestion.I18nKey, suggestion.DefaultValue);
            items.Add(new SuggestedPromptItem(
                Text: text,
                Glyph: Glyph(),
                AutomationName: AutomationName(text)));
        }

        return items;
    }
}

/// <summary>
/// PII-safe diagnostics for the Suggested Prompts surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a prompt's text — so a diagnostics line
/// can never leak anything user-specific. Thread-safe.
/// </summary>
public sealed class SuggestedPromptsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public SuggestedPromptsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=SuggestedPrompts</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={SuggestedPromptsRegistration.Slug}");
    }
}
