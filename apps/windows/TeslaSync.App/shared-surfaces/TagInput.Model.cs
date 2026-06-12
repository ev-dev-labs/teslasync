using System.Globalization;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata + i18n keys for the tag-input surface — the native mirror of the web
/// <c>TagInput</c> (web/src/components/forms/TagInput.tsx). The web component is the shared free-text tag
/// chip primitive: Enter or a configured separator commits the pending text as a chip, a paste of
/// "foo, bar; baz" splits into several chips at once, Backspace at an empty field removes the trailing chip,
/// whitespace-trimmed empty / duplicate candidates are rejected silently with an <c>aria-live</c>
/// announcement, an optional <c>validateTag</c> surfaces a blocking error under the field, and a
/// <c>maxTags</c> cap disables the field once reached. This metadata carries the diagnostics slug the surface
/// registers under and every render-contract i18n key/fallback the web source passes to <c>t()</c>, so the
/// native surface reproduces the web copy verbatim. Every key carries the <c>translation.</c> catalog prefix
/// the WinUI resource bridge expects and resolves against the English fallback headlessly. UI-free so it is
/// asserted without a XAML host.
/// </summary>
public static class TagInputRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "TagInput";

    /// <summary>The default commit separator while typing / pasting (web <c>separators ?? [',']</c>).</summary>
    public const char DefaultSeparator = ',';

    /// <summary>i18n key for the single-tag-added announcement (web <c>tagInput.addedOne</c>).</summary>
    public const string AddedOneKey = "translation.tagInput.addedOne";

    /// <summary>English fallback for <see cref="AddedOneKey"/> (web second arg, verbatim).</summary>
    public const string AddedOneFallback = "Tag added";

    /// <summary>i18n key for the multi-tag-added announcement (web <c>tagInput.added</c>).</summary>
    public const string AddedKey = "translation.tagInput.added";

    /// <summary>
    /// English fallback for <see cref="AddedKey"/> (web second arg, verbatim — the <c>{{count}}</c> token is
    /// interpolated by <see cref="FormatAdded"/>).
    /// </summary>
    public const string AddedFallback = "{{count}} tags added";

    /// <summary>i18n key for the duplicate-rejected announcement (web <c>tagInput.duplicate</c>).</summary>
    public const string DuplicateKey = "translation.tagInput.duplicate";

    /// <summary>
    /// English fallback for <see cref="DuplicateKey"/> (web second arg, verbatim — the <c>{{tag}}</c> token is
    /// interpolated by <see cref="FormatTag"/>).
    /// </summary>
    public const string DuplicateFallback = "{{tag}} is already added";

    /// <summary>i18n key for the limit-reached announcement (web <c>tagInput.maxReachedAnnounce</c>).</summary>
    public const string MaxReachedAnnounceKey = "translation.tagInput.maxReachedAnnounce";

    /// <summary>English fallback for <see cref="MaxReachedAnnounceKey"/> (web second arg, verbatim).</summary>
    public const string MaxReachedAnnounceFallback = "Tag limit reached";

    /// <summary>i18n key for the tag-removed announcement (web <c>tagInput.removed</c>).</summary>
    public const string RemovedKey = "translation.tagInput.removed";

    /// <summary>
    /// English fallback for <see cref="RemovedKey"/> (web second arg, verbatim — the <c>{{tag}}</c> token is
    /// interpolated by <see cref="FormatTag"/>).
    /// </summary>
    public const string RemovedFallback = "Removed {{tag}}";

    /// <summary>i18n key for a chip's remove-button accessible name (web <c>tagInput.removeTag</c>).</summary>
    public const string RemoveTagKey = "translation.tagInput.removeTag";

    /// <summary>
    /// English fallback for <see cref="RemoveTagKey"/> (web second arg, verbatim — the <c>{{tag}}</c> token is
    /// interpolated by <see cref="FormatTag"/>).
    /// </summary>
    public const string RemoveTagFallback = "Remove {{tag}}";

    /// <summary>i18n key for the at-capacity input prompt (web <c>tagInput.maxReached</c>).</summary>
    public const string MaxReachedKey = "translation.tagInput.maxReached";

    /// <summary>English fallback for <see cref="MaxReachedKey"/> (web second arg, verbatim).</summary>
    public const string MaxReachedFallback = "Tag limit reached";

    /// <summary>i18n key for the field's default editing prompt (web <c>tagInput.placeholder</c>).</summary>
    public const string PlaceholderKey = "translation.tagInput.placeholder";

    /// <summary>English fallback for <see cref="PlaceholderKey"/> (web second arg, verbatim — U+2026 ellipsis).</summary>
    public const string PlaceholderFallback = "Add a tag\u2026";

    /// <summary>i18n key for the screen-reader empty enumeration (web <c>tagInput.tagsNone</c>).</summary>
    public const string TagsNoneKey = "translation.tagInput.tagsNone";

    /// <summary>English fallback for <see cref="TagsNoneKey"/> (web second arg, verbatim).</summary>
    public const string TagsNoneFallback = "No tags yet";

    /// <summary>i18n key for the screen-reader tag enumeration (web <c>tagInput.tagsList</c>).</summary>
    public const string TagsListKey = "translation.tagInput.tagsList";

    /// <summary>
    /// English fallback for <see cref="TagsListKey"/> (web second arg, verbatim — the <c>{{tags}}</c> token is
    /// interpolated by <see cref="FormatTagsList"/>).
    /// </summary>
    public const string TagsListFallback = "Tags: {{tags}}";

    /// <summary>i18n key for the at-capacity helper line (web <c>tagInput.maxReachedHint</c>).</summary>
    public const string MaxReachedHintKey = "translation.tagInput.maxReachedHint";

    /// <summary>
    /// English fallback for <see cref="MaxReachedHintKey"/> (web second arg, verbatim — the <c>{{count}}</c>
    /// token is interpolated by <see cref="FormatMaxReachedHint"/>).
    /// </summary>
    public const string MaxReachedHintFallback = "Maximum {{count}} tags";

    /// <summary>Interpolate the added count into the localized "{{count}} tags added" template (web i18next <c>{{count}}</c>).</summary>
    public static string FormatAdded(string template, int count) => InterpolateCount(template, count);

    /// <summary>Interpolate the cap into the localized "Maximum {{count}} tags" helper template (web i18next <c>{{count}}</c>).</summary>
    public static string FormatMaxReachedHint(string template, int count) => InterpolateCount(template, count);

    /// <summary>Interpolate a single tag into a localized <c>{{tag}}</c> template (web i18next <c>{{tag}}</c>).</summary>
    public static string FormatTag(string template, string tag) => InterpolateToken(template, "tag", tag);

    /// <summary>Interpolate the joined tag enumeration into the localized "Tags: {{tags}}" template (web i18next <c>{{tags}}</c>).</summary>
    public static string FormatTagsList(string template, string tags) => InterpolateToken(template, "tags", tags);

    private static string InterpolateCount(string template, int count)
    {
        ArgumentNullException.ThrowIfNull(template);
        string rendered = count.ToString(CultureInfo.CurrentCulture);

        // Substitute both the web i18next token ({{count}}) and the native positional token ({0}) so the same
        // projection works whether the string came from the resw catalog (which uses {0}) or the English
        // fallback (which uses {{count}}). A literal replace (never string.Format) means a localized value
        // carrying a stray brace can never throw a FormatException.
        return template
            .Replace("{{count}}", rendered, StringComparison.Ordinal)
            .Replace("{0}", rendered, StringComparison.Ordinal);
    }

    private static string InterpolateToken(string template, string token, string value)
    {
        ArgumentNullException.ThrowIfNull(template);
        string rendered = value ?? string.Empty;

        // As above: substitute the web i18next named token ({{tag}} / {{tags}}) and the native positional
        // token ({0}) via literal replace so neither catalog form nor a stray brace can throw.
        return template
            .Replace("{{" + token + "}}", rendered, StringComparison.Ordinal)
            .Replace("{0}", rendered, StringComparison.Ordinal);
    }
}

/// <summary>
/// The mutually-exclusive content state the chip strip renders — the native projection of the web source's
/// tag-list branches (web/src/components/forms/TagInput.tsx). The web component shows either the screen-reader
/// "No tags yet" enumeration when the controlled value is empty (<see cref="Empty"/>, web L545) or the chip
/// row plus the "Tags: …" enumeration when one or more tags are present (<see cref="Populated"/>, web L491 +
/// L547). The primitive is a controlled presentational input with no query-freshness or connectivity concept,
/// so — exactly like the shipped Combobox / CurrencyInput controlled primitives — it has no loading / async
/// error / stale / offline chrome to reproduce; the two branches below are the complete content set, with the
/// blocking validation error and the at-capacity helper layered on top as independent flags.
/// </summary>
public enum TagInputContentState
{
    /// <summary>No tags are present — the screen-reader "No tags yet" enumeration (web <c>value.length === 0</c>).</summary>
    Empty,

    /// <summary>One or more tags are present — the chip row + "Tags: …" enumeration (web <c>value.map(...)</c>).</summary>
    Populated,
}

/// <summary>
/// The result of attempting to add a single candidate tag — the native port of the web <c>tryAddOne</c>
/// status union (web/src/components/forms/TagInput.tsx L208-L236). A candidate is normalised (trimmed, and
/// optionally lower-cased) and then either accepted (<see cref="Added"/>), rejected because it duplicates an
/// existing tag case-insensitively (<see cref="Duplicate"/>), rejected by the consumer's validator
/// (<see cref="Invalid"/>), dropped because it was empty after trimming (<see cref="Empty"/>), or refused
/// because the <c>maxTags</c> cap is already reached (<see cref="Full"/>).
/// </summary>
public enum TagAddOutcome
{
    /// <summary>The candidate was accepted and appended (web <c>'added'</c>).</summary>
    Added,

    /// <summary>The candidate already exists (case-insensitive) and was rejected (web <c>'duplicate'</c>).</summary>
    Duplicate,

    /// <summary>The consumer's validator rejected the candidate with a message (web <c>'invalid'</c>).</summary>
    Invalid,

    /// <summary>The candidate was empty after trimming and was dropped silently (web <c>'empty'</c>).</summary>
    Empty,

    /// <summary>The <c>maxTags</c> cap is already reached, so the candidate was refused (web <c>'full'</c>).</summary>
    Full,
}

/// <summary>
/// PII-safe diagnostics for the tag-input surface (P1/S11 diagnostics contract). Tag text is arbitrary
/// user-facing content (vehicle nicknames, custom labels, vehicle-ID lists), so the collector records ONLY
/// the operational <see cref="RecordViewOpened"/> signal with the surface slug — never the tags, the pending
/// text, or the validation message. Thread-safe; mirrors the shipped surfaces' collectors.
/// </summary>
public sealed class TagInputDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public TagInputDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=TagInput</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(
            string.Create(
                CultureInfo.InvariantCulture,
                $"view.opened slug={TagInputRegistration.Slug}"));
    }
}
