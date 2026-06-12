using System.Text.RegularExpressions;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// A per-tag validator — the native port of the web <c>TagInput</c>'s <c>validateTag</c> prop
/// (web/src/components/forms/TagInput.tsx L99). Called AFTER trimming / optional lower-casing but BEFORE the
/// duplicate check; return <see langword="null"/> to accept the candidate, or a localized error message to
/// reject it and surface that message under the field (web <c>&lt;ErrorText&gt;</c>) until the user edits or
/// clears the pending text.
/// </summary>
/// <param name="tag">The normalised candidate tag.</param>
/// <returns><see langword="null"/> to accept, or the rejection message to block the commit.</returns>
public delegate string? TagValidator(string tag);

/// <summary>
/// The tag-list value seam the <see cref="TagInputViewModel"/> binds to (P1/S8 state-holder seam) — the
/// native analogue of the controlled <c>value</c> / <c>onChange</c> pair the web <c>TagInput</c> receives
/// (web/src/components/forms/TagInput.tsx L81-L83). The web component never owns the list itself; it renders
/// the parent's <c>value</c> and asks the parent to store the next list. Likewise this seam holds the current
/// <see cref="Tags"/> and raises <see cref="Changed"/> when the parent reassigns them — the analogue of the
/// parent re-rendering with a new <c>value</c> after handling <c>onChange</c>. The view never mutates this
/// seam directly; it forwards edits to the view-model, which commits them through <see cref="Changed"/>.
/// </summary>
public interface ITagInputSource
{
    /// <summary>The current committed tag list (web <c>value</c>); never null.</summary>
    IReadOnlyList<string> Tags { get; }

    /// <summary>
    /// Replace the whole committed list — the controlled value commit the view-model performs when it
    /// accepts an edit (web <c>onChange(next)</c> applied to <c>value</c>). A null falls back to empty.
    /// Implementations raise <see cref="Changed"/> so the bound view-model re-projects.
    /// </summary>
    /// <param name="tags">The new tag list.</param>
    void SetTags(IEnumerable<string>? tags);

    /// <summary>Raised whenever the tag list is reassigned (a parent re-render after <c>onChange</c>).</summary>
    event EventHandler? Changed;
}

/// <summary>
/// The in-memory <see cref="ITagInputSource"/> — the canonical holder a page (or a test) pushes the tag list
/// into. It mirrors a parent passing a fresh <c>value</c> array to the web <c>TagInput</c>:
/// <see cref="SetTags"/> replaces the whole list (the analogue of the parent re-rendering after handling the
/// field's <c>onChange</c>) and raises <see cref="Changed"/> so the bound view-model re-projects. A null
/// assignment falls back to an empty list so the view-model never dereferences null.
/// </summary>
public sealed class TagInputSource : ITagInputSource
{
    private IReadOnlyList<string> _tags;

    /// <summary>Creates an empty source (no tags).</summary>
    public TagInputSource()
        : this(Array.Empty<string>())
    {
    }

    /// <summary>Creates a source seeded with an initial list (a null falls back to empty).</summary>
    /// <param name="tags">The initial tag list.</param>
    public TagInputSource(IEnumerable<string>? tags) => _tags = Materialize(tags);

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public IReadOnlyList<string> Tags => _tags;

    /// <summary>Replace the whole tag list (a null falls back to empty) and notify the bound view-model.</summary>
    /// <param name="tags">The new tag list.</param>
    public void SetTags(IEnumerable<string>? tags)
    {
        _tags = Materialize(tags);
        Changed?.Invoke(this, EventArgs.Empty);
    }

    private static string[] Materialize(IEnumerable<string>? tags) =>
        tags is null ? Array.Empty<string>() : tags.ToArray();
}

/// <summary>
/// The configured commit separators — the native port of the web <c>TagInput</c>'s <c>separators</c> prop and
/// its <c>buildSplitRegex</c> helper (web/src/components/forms/TagInput.tsx L77 + L138-L143). Like the web
/// <c>TagSeparator = ',' | ';' | ' '</c> union it is constrained to a fixed, safe set so the split regex can
/// never be a user-controlled injection, and like the web default it falls back to a single comma when no
/// separators are supplied. Enter is always an implicit separator regardless of this set (handled by the
/// view-model); this set controls the additional in-text separators that commit while typing OR pasting, and
/// CR / LF are always added so a multi-line paste splits per row.
/// </summary>
public static class TagInputSeparators
{
    /// <summary>The fixed, safe separator set the web union permits (<c>,</c> / <c>;</c> / space).</summary>
    public static IReadOnlyList<char> Allowed { get; } = new[] { ',', ';', ' ' };

    /// <summary>The default separator set when none is supplied (web <c>separators ?? [',']</c>).</summary>
    public static IReadOnlyList<char> Default { get; } = new[] { ',' };

    /// <summary>
    /// Reduce a requested separator set to the allowed, de-duplicated subset, falling back to
    /// <see cref="Default"/> when the request is null / empty / entirely out-of-set — the native analogue of
    /// the web type constraint that keeps the split regex safe.
    /// </summary>
    /// <param name="separators">The requested separators.</param>
    public static IReadOnlyList<char> Sanitize(IReadOnlyList<char>? separators)
    {
        if (separators is null || separators.Count == 0)
        {
            return Default;
        }

        var seen = new List<char>(separators.Count);
        foreach (char c in separators)
        {
            if (Allowed.Contains(c) && !seen.Contains(c))
            {
                seen.Add(c);
            }
        }

        return seen.Count == 0 ? Default : seen;
    }

    /// <summary>
    /// Build the split pattern for the configured separators PLUS CR / LF — the native port of the web
    /// <c>buildSplitRegex</c> (each character hard-escaped, joined into a character class, with <c>\r\n</c>
    /// always appended so multi-line pastes split per row).
    /// </summary>
    /// <param name="separators">The (already sanitized) separators.</param>
    public static Regex BuildSplitRegex(IReadOnlyList<char> separators)
    {
        ArgumentNullException.ThrowIfNull(separators);

        var sb = new System.Text.StringBuilder("[");
        foreach (char c in separators)
        {
            sb.Append(Regex.Escape(c.ToString()));
        }

        // web: the pattern always includes CR / LF so a paste-from-spreadsheet splits per row.
        sb.Append("\\r\\n]+");
        return new Regex(sb.ToString(), RegexOptions.CultureInvariant);
    }
}

/// <summary>
/// The immutable inputs a single commit is evaluated against — the native bundle of the web
/// <c>TagInput</c>'s closure variables that <c>tryAddOne</c> reads (web/src/components/forms/TagInput.tsx
/// L215-L239): whether tags are lower-cased before storage, the optional <c>maxTags</c> cap, the optional
/// per-tag <see cref="TagValidator"/>, and the split <see cref="Separators"/>. Carried as one record so the
/// pure <see cref="TagListEditor"/> stays a static, headlessly-tested function of (current list, raw text,
/// context).
/// </summary>
public sealed record TagCommitContext
{
    /// <summary>Lower-case each tag before storage (web <c>lowercase</c>, default false).</summary>
    public bool Lowercase { get; init; }

    /// <summary>The maximum number of tags, or null for unlimited (web <c>maxTags</c>).</summary>
    public int? MaxTags { get; init; }

    /// <summary>The optional per-tag validator (web <c>validateTag</c>).</summary>
    public TagValidator? Validator { get; init; }

    /// <summary>The configured commit separators (web <c>separators</c>); defaults to a single comma.</summary>
    public IReadOnlyList<char> Separators { get; init; } = TagInputSeparators.Default;
}

/// <summary>
/// The outcome of attempting to add a single normalised candidate — the native port of the web
/// <c>tryAddOne</c> return shape (web/src/components/forms/TagInput.tsx L208-L236). Carries the classification
/// (<see cref="Outcome"/>), the normalised <see cref="Tag"/>, the validator <see cref="Error"/> when the
/// outcome is <see cref="TagAddOutcome.Invalid"/>, and the resulting list (<see cref="Next"/> — unchanged
/// unless the outcome is <see cref="TagAddOutcome.Added"/>).
/// </summary>
public readonly record struct TagAddResult(TagAddOutcome Outcome, string Tag, string? Error, IReadOnlyList<string> Next);

/// <summary>
/// The outcome of committing a raw input string — the native port of the web <c>commitText</c> return + side
/// effects (web/src/components/forms/TagInput.tsx L248-L304). <see cref="Tags"/> is the resulting list (web
/// <c>acc</c>), <see cref="Remainder"/> is the preserved trailing fragment the caller keeps as pending text,
/// and the remaining fields carry the data the view-model needs to fire the correct single announcement:
/// how many were added (web <c>added</c>), the first validator error encountered (web <c>firstError</c>), the
/// last duplicate rejected (web <c>lastDuplicate</c>), and whether the cap was hit (web <c>hitMax</c>).
/// </summary>
public sealed record TagCommitResult(
    IReadOnlyList<string> Tags,
    string Remainder,
    int AddedCount,
    string? FirstError,
    string? LastDuplicate,
    bool HitMax)
{
    /// <summary>Whether the committed list differs from the input list (web <c>acc !== value</c>).</summary>
    public bool Changed => AddedCount > 0;
}

/// <summary>
/// The pure, UI-thread-free tag-list editor (P1/S8 adapter) — the native port of the web <c>TagInput</c>'s
/// <c>normaliseTag</c> / <c>tryAddOne</c> / <c>commitText</c> functions (web/src/components/forms/TagInput.tsx
/// L127-L304). It contains no view-framework dependency and holds no state: every method is a deterministic
/// function of its arguments, so the add / dedupe / validate / split / cap behaviour is verified row-for-row
/// against the web spec without a XAML host. The <see cref="TagInputViewModel"/> composes these to reproduce
/// the web component's keyboard / paste / blur handlers.
/// </summary>
public static class TagListEditor
{
    /// <summary>
    /// Normalise a raw candidate prior to validation / dedupe — the native port of the web
    /// <c>normaliseTag</c> (trim, then optionally lower-case).
    /// </summary>
    /// <param name="raw">The raw candidate text.</param>
    /// <param name="lowercase">Whether to lower-case after trimming (web <c>lowercase</c>).</param>
    public static string Normalize(string? raw, bool lowercase)
    {
        string trimmed = (raw ?? string.Empty).Trim();
        return lowercase ? trimmed.ToLowerInvariant() : trimmed;
    }

    /// <summary>
    /// Try to add one normalised candidate to <paramref name="accumulated"/> — the native port of the web
    /// <c>tryAddOne</c>. Empty (after trim), over-cap, validator-rejected and case-insensitive duplicate
    /// candidates leave the list unchanged; an accepted candidate returns a new list with it appended.
    /// </summary>
    /// <param name="accumulated">The list so far (the originals plus any added in this commit).</param>
    /// <param name="raw">The raw candidate text.</param>
    /// <param name="context">The commit inputs (lowercase, cap, validator).</param>
    public static TagAddResult TryAdd(IReadOnlyList<string> accumulated, string? raw, TagCommitContext context)
    {
        ArgumentNullException.ThrowIfNull(accumulated);
        ArgumentNullException.ThrowIfNull(context);

        string tag = Normalize(raw, context.Lowercase);
        if (tag.Length == 0)
        {
            return new TagAddResult(TagAddOutcome.Empty, tag, null, accumulated);
        }

        if (context.MaxTags is { } max && accumulated.Count >= max)
        {
            return new TagAddResult(TagAddOutcome.Full, tag, null, accumulated);
        }

        if (context.Validator is { } validate && validate(tag) is { } error)
        {
            return new TagAddResult(TagAddOutcome.Invalid, tag, error, accumulated);
        }

        // web: case-insensitive dedupe regardless of the `lowercase` storage flag — "FOO" and "foo" cannot coexist.
        foreach (string existing in accumulated)
        {
            if (string.Equals(existing, tag, StringComparison.OrdinalIgnoreCase))
            {
                return new TagAddResult(TagAddOutcome.Duplicate, tag, null, accumulated);
            }
        }

        var next = new List<string>(accumulated.Count + 1);
        next.AddRange(accumulated);
        next.Add(tag);
        return new TagAddResult(TagAddOutcome.Added, tag, null, next);
    }

    /// <summary>
    /// Process one raw commit string — the native port of the web <c>commitText</c>. Splits the text on the
    /// configured separators (plus CR / LF), runs each fragment EXCEPT the trailing one through
    /// <see cref="TryAdd"/>, and returns the surviving list, the preserved trailing fragment and the data
    /// needed for the single end-of-commit announcement. The trailing fragment is never consumed here; the
    /// caller appends a synthetic separator first when it wants the whole string committed (Enter / blur /
    /// paste, web <c>commitAll</c>).
    /// </summary>
    /// <param name="value">The current committed list (web <c>value</c>).</param>
    /// <param name="raw">The raw input string to commit.</param>
    /// <param name="context">The commit inputs (lowercase, cap, validator, separators).</param>
    public static TagCommitResult Commit(IReadOnlyList<string> value, string? raw, TagCommitContext context)
    {
        ArgumentNullException.ThrowIfNull(value);
        ArgumentNullException.ThrowIfNull(context);

        IReadOnlyList<char> separators = TagInputSeparators.Sanitize(context.Separators);
        string[] parts = TagInputSeparators.BuildSplitRegex(separators).Split(raw ?? string.Empty);

        IReadOnlyList<string> acc = value;
        string? firstError = null;
        int added = 0;
        string? lastDuplicate = null;
        bool hitMax = false;
        string lastFragment = string.Empty;

        for (int i = 0; i < parts.Length; i++)
        {
            // The trailing fragment (after the last separator) stays in the field — do NOT consume it.
            if (i == parts.Length - 1)
            {
                lastFragment = parts[i];
                continue;
            }

            TagAddResult result = TryAdd(acc, parts[i], context);
            switch (result.Outcome)
            {
                case TagAddOutcome.Added:
                    acc = result.Next;
                    added++;
                    break;
                case TagAddOutcome.Invalid when firstError is null:
                    firstError = result.Error;
                    break;
                case TagAddOutcome.Duplicate:
                    lastDuplicate = result.Tag;
                    break;
                case TagAddOutcome.Full:
                    hitMax = true;
                    break;
                default:
                    break;
            }

            if (hitMax)
            {
                break;
            }
        }

        return new TagCommitResult(acc, lastFragment, added, firstError, lastDuplicate, hitMax);
    }

    /// <summary>
    /// Whether the raw text contains a configured separator (or CR / LF) — the native port of the web
    /// <c>splitRegex.test(raw)</c> guard in <c>handleInputChange</c>.
    /// </summary>
    /// <param name="raw">The raw input text.</param>
    /// <param name="context">The commit inputs (only the separators are read).</param>
    public static bool ContainsSeparator(string? raw, TagCommitContext context)
    {
        ArgumentNullException.ThrowIfNull(context);

        if (string.IsNullOrEmpty(raw))
        {
            return false;
        }

        IReadOnlyList<char> separators = TagInputSeparators.Sanitize(context.Separators);
        return TagInputSeparators.BuildSplitRegex(separators).IsMatch(raw);
    }
}
