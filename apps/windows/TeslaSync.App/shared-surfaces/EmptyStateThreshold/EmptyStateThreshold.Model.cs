using System.Globalization;
using System.Threading;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The inputs the <c>EmptyStateThreshold</c> surface renders from — the native analogue of the props the web
/// <c>&lt;EmptyStateThreshold&gt;</c> receives from its parent (web/src/components/feedback/EmptyStateThreshold.tsx
/// L6-L33). The web component is presentational: its only data source is <c>useTranslation</c> and it performs no
/// fetch, so this record simply carries the resolved props — the current vs required counts, the optional item
/// noun, the gated section's label, an optional description, an optional message override and whether a
/// call-to-action slot is supplied. Pure data (no WinUI types) so the projection and view-model are unit-tested
/// without a UI host.
/// </summary>
public sealed record EmptyStateThresholdInput
{
    /// <summary>How many items the user currently has (web <c>currentCount</c>).</summary>
    public int CurrentCount { get; init; }

    /// <summary>The minimum items required for the section to become useful (web <c>threshold</c>).</summary>
    public int Threshold { get; init; }

    /// <summary>
    /// Short noun for the items being counted, e.g. "sessions" / "drives" / "trips" (web <c>itemNoun</c>). When
    /// null or empty the default localized noun is used (web <c>itemNoun ?? t('emptyState.threshold.defaultItem')</c>).
    /// </summary>
    public string? ItemNoun { get; init; }

    /// <summary>The label of the section being gated, rendered as the title (web <c>sectionLabel</c>).</summary>
    public string SectionLabel { get; init; } = string.Empty;

    /// <summary>An optional one-line description below the title (web <c>description</c>); hidden when empty.</summary>
    public string? Description { get; init; }

    /// <summary>
    /// An optional override for the auto-generated count message (web <c>message</c>). When non-null it replaces
    /// the default phrasing, mirroring the web <c>message ?? defaultMessage</c> (a null — not an empty string —
    /// falls back to the default).
    /// </summary>
    public string? Message { get; init; }

    /// <summary>
    /// Whether a call-to-action slot is supplied below the message (web <c>action</c>, e.g. "Adjust filters").
    /// The action element itself is hosted by the view; this flag drives the action region's visibility, mirroring
    /// the web <c>{action &amp;&amp; …}</c> guard.
    /// </summary>
    public bool HasAction { get; init; }
}

/// <summary>
/// The render-ready projection of one <see cref="EmptyStateThresholdInput"/> — everything the WinUI view needs to
/// draw a frame without recomputing anything, so the view stays a thin renderer and the composition is verified
/// headlessly. It is the native analogue of the values the web <c>EmptyStateThreshold</c> derives in its body
/// (web/src/components/feedback/EmptyStateThreshold.tsx L58-L102): the section <see cref="Title"/>, the resolved
/// <see cref="Message"/> (custom override or the default count phrasing), the optional <see cref="Description"/>,
/// whether the description / action regions are shown, the resolved item <see cref="Noun"/> and the composed
/// status <see cref="AccessibleName"/> the live region announces.
/// </summary>
public sealed record EmptyStateThresholdDisplay
{
    internal EmptyStateThresholdDisplay(
        string title,
        string message,
        string description,
        bool hasDescription,
        bool hasAction,
        string noun,
        string accessibleName)
    {
        Title = title;
        Message = message;
        Description = description;
        HasDescription = hasDescription;
        HasAction = hasAction;
        Noun = noun;
        AccessibleName = accessibleName;
    }

    /// <summary>The section label rendered as the title (web <c>sectionLabel</c>).</summary>
    public string Title { get; }

    /// <summary>The resolved message — the custom override or the default count phrasing (web <c>message ?? defaultMessage</c>).</summary>
    public string Message { get; }

    /// <summary>The optional description (web <c>description</c>); empty when none was supplied.</summary>
    public string Description { get; }

    /// <summary>Whether the description paragraph should be drawn (web <c>description &amp;&amp; …</c>).</summary>
    public bool HasDescription { get; }

    /// <summary>Whether the call-to-action region should be drawn (web <c>action &amp;&amp; …</c>).</summary>
    public bool HasAction { get; }

    /// <summary>The resolved item noun used in the default message (web <c>itemNoun ?? t(defaultItem)</c>).</summary>
    public string Noun { get; }

    /// <summary>The composed status text the live region announces (the visible title + description + message).</summary>
    public string AccessibleName { get; }
}

/// <summary>
/// Canonical metadata + localized strings for the EmptyStateThreshold surface — the native analogue of the module
/// identity and the two <c>t()</c> calls in the web component
/// (web/src/components/feedback/EmptyStateThreshold.tsx L59, L61-L65). Carries the diagnostics slug, the root
/// automation id, the status role (the web <c>role="status"</c>), the leading check / info glyphs and their sizes
/// (the web <c>CheckCircle2</c> and <c>Info</c> lucide icons), and the i18n keys with the verbatim English
/// fallbacks the web source renders inline. The keys resolve through the shared facade (P1/S10); they live in the
/// <c>Strings/{lang}/Resources.resw</c> catalog as <c>translation.emptyState.threshold.*</c>, and the facade
/// returns the English fallback when a locale lacks the key (exactly as react-i18next's inline default does).
/// UI-free so it is asserted in tests.
/// </summary>
public static class EmptyStateThresholdRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "EmptyStateThreshold";

    /// <summary>The root automation id Narrator / UI-automation resolve the surface by (web <c>data-testid</c> hook).</summary>
    public const string RootAutomationId = "empty-state-threshold";

    /// <summary>The accessibility role the surface exposes — a polite status region (web <c>role="status"</c>).</summary>
    public const string StatusRole = "status";

    /// <summary>Segoe Fluent glyph for the leading check-circle (web lucide <c>CheckCircle2</c>): the section is healthy, just waiting for scale.</summary>
    public const string CheckGlyph = "\uE930"; // Completed (circled check)

    /// <summary>Segoe Fluent glyph for the trailing info hint beside the title (web lucide <c>Info</c>).</summary>
    public const string InfoGlyph = "\uE946"; // Info

    /// <summary>The check-circle icon size in DIPs (web <c>h-5 w-5</c>).</summary>
    public const double CheckIconSize = 20;

    /// <summary>The info icon size in DIPs (web <c>h-3 w-3</c>).</summary>
    public const double InfoIconSize = 12;

    /// <summary>i18n key for the default item noun (web <c>t('emptyState.threshold.defaultItem', 'items')</c>).</summary>
    public const string DefaultItemKey = "translation.emptyState.threshold.defaultItem";

    /// <summary>English fallback for <see cref="DefaultItemKey"/> — the web literal.</summary>
    public const string DefaultItemFallback = "items";

    /// <summary>i18n key for the default count message template (web <c>t('emptyState.threshold.message', …)</c>).</summary>
    public const string MessageKey = "translation.emptyState.threshold.message";

    /// <summary>English fallback for <see cref="MessageKey"/> — the web template with the <c>{{threshold}}</c> / <c>{{noun}}</c> / <c>{{current}}</c> tokens.</summary>
    public const string MessageFallback =
        "Need at least {{threshold}} {{noun}} to show meaningful patterns. You have {{current}} so far.";

    /// <summary>
    /// Resolve the item noun — the supplied <paramref name="itemNoun"/> when non-empty, otherwise the localized
    /// default (web <c>itemNoun ?? t('emptyState.threshold.defaultItem', 'items')</c>).
    /// </summary>
    /// <param name="localizer">The i18n facade the default noun resolves through.</param>
    /// <param name="itemNoun">The caller-supplied noun (web <c>itemNoun</c>), or null/empty for the default.</param>
    public static string ResolveNoun(ILocalizer localizer, string? itemNoun)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return string.IsNullOrEmpty(itemNoun)
            ? localizer.GetString(DefaultItemKey, DefaultItemFallback)
            : itemNoun;
    }

    /// <summary>
    /// Compose the default count message with the three figures substituted — the native port of
    /// <c>t('emptyState.threshold.message', '…{{threshold}} {{noun}}…{{current}}…', { threshold, noun, current })</c>
    /// (web L61-L65). The token replacement mirrors the i18next interpolation the web relies on; counts use the
    /// invariant decimal form, matching i18next's default (unformatted) number interpolation.
    /// </summary>
    /// <param name="localizer">The i18n facade the template resolves through.</param>
    /// <param name="threshold">The minimum items required (web <c>threshold</c>).</param>
    /// <param name="noun">The resolved item noun (web <c>noun</c>).</param>
    /// <param name="current">How many items the user currently has (web <c>current</c>).</param>
    public static string ComposeMessage(ILocalizer localizer, int threshold, string noun, int current)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(MessageKey, MessageFallback)
            .Replace("{{threshold}}", threshold.ToString(CultureInfo.InvariantCulture), StringComparison.Ordinal)
            .Replace("{{noun}}", noun ?? string.Empty, StringComparison.Ordinal)
            .Replace("{{current}}", current.ToString(CultureInfo.InvariantCulture), StringComparison.Ordinal);
    }
}

/// <summary>
/// Pure, UI-thread-free projection of one <see cref="EmptyStateThresholdInput"/> into a render-ready
/// <see cref="EmptyStateThresholdDisplay"/> — the native port of the web <c>EmptyStateThreshold</c> component body
/// (web/src/components/feedback/EmptyStateThreshold.tsx L47-L102). It resolves the item noun, composes the default
/// count message (or honours a caller override), surfaces the optional description, and builds the composed status
/// text the live region announces. It touches no view framework, so the WinUI view and the unit tests share one
/// source of truth.
/// </summary>
public static class EmptyStateThresholdProjection
{
    /// <summary>
    /// Project <paramref name="input"/>, resolving every string through <paramref name="localizer"/>. Reproduces
    /// the web body: <c>noun = itemNoun ?? t(defaultItem)</c>, <c>message ?? defaultMessage</c>, the
    /// <c>description &amp;&amp;</c> guard and the <c>action &amp;&amp;</c> guard.
    /// </summary>
    /// <param name="input">The resolved props (web component props); never null.</param>
    /// <param name="localizer">The i18n facade every string resolves through; never null.</param>
    public static EmptyStateThresholdDisplay Project(EmptyStateThresholdInput input, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(input);
        ArgumentNullException.ThrowIfNull(localizer);

        string title = input.SectionLabel ?? string.Empty;
        string noun = EmptyStateThresholdRegistration.ResolveNoun(localizer, input.ItemNoun);

        // web L99: message ?? defaultMessage — only a null (not an empty string) falls back to the default.
        string message = input.Message is { } custom
            ? custom
            : EmptyStateThresholdRegistration.ComposeMessage(localizer, input.Threshold, noun, input.CurrentCount);

        // web L93: {description && …} — an empty/absent description hides the paragraph.
        string description = input.Description ?? string.Empty;
        bool hasDescription = !string.IsNullOrEmpty(description);

        string accessibleName = ComposeStatusText(title, hasDescription ? description : null, message);

        return new EmptyStateThresholdDisplay(
            title: title,
            message: message,
            description: description,
            hasDescription: hasDescription,
            hasAction: input.HasAction,
            noun: noun,
            accessibleName: accessibleName);
    }

    // The web outer div carries role="status"; its accessible text is the visible title + description + message.
    private static string ComposeStatusText(string title, string? description, string message)
    {
        var parts = new List<string>(3);
        if (!string.IsNullOrEmpty(title))
        {
            parts.Add(title);
        }

        if (!string.IsNullOrEmpty(description))
        {
            parts.Add(description);
        }

        if (!string.IsNullOrEmpty(message))
        {
            parts.Add(message);
        }

        return string.Join(" ", parts);
    }
}

/// <summary>
/// PII-safe diagnostics for the EmptyStateThreshold surface (P1/S11 diagnostics contract). The surface renders
/// only a localized section label and a count message, but to stay consistent with the peer surfaces the
/// collector records ONLY the operational <c>view.opened</c> event with the surface slug — never the label, the
/// message or the counts. Thread-safe; mirrors the other shared-surface diagnostics collectors.
/// </summary>
public sealed class EmptyStateThresholdDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public EmptyStateThresholdDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=EmptyStateThreshold</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={EmptyStateThresholdRegistration.Slug}");
    }
}
