using System.ComponentModel;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The UI-thread-free state holder backing the WinUI <see cref="TagInput"/> view — the native port of the web
/// <c>TagInput</c> component body (web/src/components/forms/TagInput.tsx). Over the injected
/// <see cref="ITagInputSource"/> (the controlled <c>value</c> seam, P1/S8), the i18n facade
/// (<see cref="ILocalizer"/>, P1/S10) and the screen-reader announcer (<see cref="IAnnouncerBus"/>, web
/// <c>useAnnouncer()</c>) it reproduces every behaviour of the web source through the shared, unit-tested
/// <see cref="TagListEditor"/>: a pending typing buffer (<see cref="Pending"/>) that commits on a separator
/// keystroke, paste or blur; Enter / blur / paste committing the whole buffer (web <c>commitAll</c>);
/// Backspace at an empty buffer removing the trailing chip; whitespace-trimmed empty / case-insensitive
/// duplicate candidates rejected silently with an announcement; a blocking validator error
/// (<see cref="ErrorMessage"/>); a <c>maxTags</c> cap that disables the field (<see cref="AtMax"/>); and the
/// screen-reader tag enumeration (<see cref="HiddenTagsText"/>). The view binds the projected state and never
/// performs the list math itself. Drive it from one confinement (the UI thread); the WinUI view marshals its
/// notifications onto the dispatcher.
/// </summary>
public sealed class TagInputViewModel : INotifyPropertyChanged, IDisposable
{
    private static readonly PropertyChangedEventArgs AllProperties = new(string.Empty);

    private readonly ITagInputSource _source;
    private readonly ILocalizer _localizer;
    private readonly IAnnouncerBus _announcer;
    private readonly TagCommitContext _context;
    private readonly IReadOnlyList<char> _separators;
    private readonly string? _placeholderOverride;
    private readonly string? _hint;

    private string _label;
    private bool _hideLabel;
    private bool _disabled;
    private string _pending = string.Empty;
    private string? _error;
    private bool _muteSource;
    private bool _disposed;

    /// <summary>Creates the holder over its value seam, the i18n facade, the announcer bus and the web props.</summary>
    /// <param name="source">The controlled tag-list seam (web <c>value</c> / <c>onChange</c>); the P1/S8 seam.</param>
    /// <param name="localizer">The i18n facade every label resolves through (P1/S10).</param>
    /// <param name="label">The consumer-supplied, already-localized field accessible name (web <c>label</c>).</param>
    /// <param name="announcer">The screen-reader announcer bus (web <c>useAnnouncer()</c>); defaults to the shared bus.</param>
    /// <param name="hideLabel">When true, the label is visually hidden but still announced (web <c>hideLabel</c>).</param>
    /// <param name="placeholder">Optional editing-prompt override (web <c>placeholder</c>); null uses the i18n default.</param>
    /// <param name="maxTags">Optional cap; once reached the field is disabled (web <c>maxTags</c>).</param>
    /// <param name="validator">Optional per-tag validator (web <c>validateTag</c>).</param>
    /// <param name="separators">Additional commit separators while typing / pasting (web <c>separators</c>); defaults to comma.</param>
    /// <param name="lowercase">Lower-case all tags before commit (web <c>lowercase</c>, default false).</param>
    /// <param name="disabled">Disable the field and chip removal (web <c>disabled</c>).</param>
    /// <param name="hint">Optional helper hint shown below the field when there is no error (web <c>hint</c>).</param>
    public TagInputViewModel(
        ITagInputSource source,
        ILocalizer localizer,
        string label,
        IAnnouncerBus? announcer = null,
        bool hideLabel = false,
        string? placeholder = null,
        int? maxTags = null,
        TagValidator? validator = null,
        IReadOnlyList<char>? separators = null,
        bool lowercase = false,
        bool disabled = false,
        string? hint = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(label);

        _source = source;
        _localizer = localizer;
        _announcer = announcer ?? AnnouncerBus.Shared;
        _label = label;
        _hideLabel = hideLabel;
        _placeholderOverride = placeholder;
        _hint = hint;
        _disabled = disabled;
        _separators = TagInputSeparators.Sanitize(separators);
        _context = new TagCommitContext
        {
            Lowercase = lowercase,
            MaxTags = maxTags,
            Validator = validator,
            Separators = _separators,
        };

        _source.Changed += OnSourceChanged;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised whenever the committed tag list changes (web <c>onChange(next)</c>).</summary>
    public event EventHandler<IReadOnlyList<string>>? TagsChanged;

    /// <summary>The diagnostics slug this surface registers under (<c>TagInput</c>).</summary>
    public static string Slug => TagInputRegistration.Slug;

    /// <summary>The current committed tags (web <c>value</c>).</summary>
    public IReadOnlyList<string> Tags => _source.Tags;

    /// <summary>The number of committed tags (web <c>value.length</c>).</summary>
    public int TagCount => _source.Tags.Count;

    /// <summary>The consumer-supplied field accessible name (web <c>label</c>).</summary>
    public string Label
    {
        get => _label;
        set
        {
            string next = value ?? string.Empty;
            if (_label == next)
            {
                return;
            }

            _label = next;
            RaiseAll();
        }
    }

    /// <summary>Whether the label is rendered visually hidden but still announced (web <c>hideLabel</c>).</summary>
    public bool HideLabel
    {
        get => _hideLabel;
        set
        {
            if (_hideLabel == value)
            {
                return;
            }

            _hideLabel = value;
            RaiseAll();
        }
    }

    /// <summary>The optional cap on the number of tags (web <c>maxTags</c>).</summary>
    public int? MaxTags => _context.MaxTags;

    /// <summary>Whether a cap is configured (drives the "(n/max)" count chrome; web <c>maxTags !== undefined</c>).</summary>
    public bool HasMaxTags => _context.MaxTags is not null;

    /// <summary>The pending typing buffer not yet committed (web <c>pending</c>).</summary>
    public string Pending => _pending;

    /// <summary>The blocking validator message, or null (web <c>error</c>).</summary>
    public string? ErrorMessage => _error;

    /// <summary>Whether a blocking validator error is showing (web <c>error</c> truthy).</summary>
    public bool HasError => _error is not null;

    /// <summary>Whether the cap is reached (web <c>atMax = maxTags !== undefined &amp;&amp; value.length &gt;= maxTags</c>).</summary>
    public bool AtMax => _context.MaxTags is { } max && _source.Tags.Count >= max;

    /// <summary>Whether the whole field is disabled (web <c>disabled</c>).</summary>
    public bool IsDisabled
    {
        get => _disabled;
        set
        {
            if (_disabled == value)
            {
                return;
            }

            _disabled = value;
            RaiseAll();
        }
    }

    /// <summary>Whether the typing field is inert — disabled OR at capacity (web <c>inputDisabled = disabled || atMax</c>).</summary>
    public bool InputDisabled => _disabled || AtMax;

    /// <summary>The chip-strip content state — empty vs populated (web tag-list branches).</summary>
    public TagInputContentState ContentState =>
        _source.Tags.Count == 0 ? TagInputContentState.Empty : TagInputContentState.Populated;

    /// <summary>The "(n/max)" count suffix shown beside the label, or empty when uncapped (web <c>({value.length}/{maxTags})</c>).</summary>
    public string CountText => _context.MaxTags is { } max
        ? string.Create(System.Globalization.CultureInfo.CurrentCulture, $"({_source.Tags.Count}/{max})")
        : string.Empty;

    /// <summary>The field's Narrator name — the label plus the count suffix when capped (web label + count span).</summary>
    public string AccessibleName => HasMaxTags
        ? string.Concat(_label, " ", CountText)
        : _label;

    /// <summary>
    /// The editing prompt shown in the empty field — the at-capacity copy when full, otherwise the consumer
    /// override or the i18n default (web <c>atMax ? t('tagInput.maxReached') : placeholder ?? t('tagInput.placeholder')</c>).
    /// </summary>
    public string PromptText => AtMax
        ? L(TagInputRegistration.MaxReachedKey, TagInputRegistration.MaxReachedFallback)
        : _placeholderOverride ?? L(TagInputRegistration.PlaceholderKey, TagInputRegistration.PlaceholderFallback);

    /// <summary>
    /// The screen-reader enumeration of the current tags — "No tags yet" when empty, otherwise the joined list
    /// (web <c>tagsNone</c> / <c>tagsList</c>). Referenced by the field's accessibility description so AT users
    /// can hear the active selection at any time.
    /// </summary>
    public string HiddenTagsText => _source.Tags.Count == 0
        ? L(TagInputRegistration.TagsNoneKey, TagInputRegistration.TagsNoneFallback)
        : TagInputRegistration.FormatTagsList(
            L(TagInputRegistration.TagsListKey, TagInputRegistration.TagsListFallback),
            string.Join(", ", _source.Tags));

    /// <summary>Whether the helper line is shown below the field (web <c>!error &amp;&amp; (hint || atMax)</c>).</summary>
    public bool ShowHelper => !HasError && (_hint is not null || AtMax);

    /// <summary>
    /// The helper line text — the at-capacity hint when full, otherwise the consumer hint (web
    /// <c>atMax ? t('tagInput.maxReachedHint', {count}) : hint</c>). Empty when <see cref="ShowHelper"/> is false.
    /// </summary>
    public string HelperText
    {
        get
        {
            if (HasError)
            {
                return string.Empty;
            }

            if (AtMax)
            {
                return TagInputRegistration.FormatMaxReachedHint(
                    L(TagInputRegistration.MaxReachedHintKey, TagInputRegistration.MaxReachedHintFallback),
                    _context.MaxTags ?? 0);
            }

            return _hint ?? string.Empty;
        }
    }

    /// <summary>The accessible name for a chip's remove button (web <c>aria-label="Remove {{tag}}"</c>).</summary>
    /// <param name="tag">The tag the button removes.</param>
    public string RemoveLabelFor(string tag) =>
        TagInputRegistration.FormatTag(L(TagInputRegistration.RemoveTagKey, TagInputRegistration.RemoveTagFallback), tag ?? string.Empty);

    /// <summary>
    /// Update the pending typing buffer — the native port of the web <c>handleInputChange</c>. When the text
    /// contains a configured separator it commits everything up to and including the last separator and keeps
    /// the trailing remainder as the new pending text; otherwise it stores the text and clears any stale error.
    /// </summary>
    /// <param name="text">The raw text now in the field.</param>
    public void SetPendingText(string? text)
    {
        string raw = text ?? string.Empty;

        if (TagListEditor.ContainsSeparator(raw, _context))
        {
            TagCommitResult result = TagListEditor.Commit(_source.Tags, raw, _context);
            ApplyCommit(result);
            _pending = result.Remainder;
            RaiseAll();
            return;
        }

        bool changed = !string.Equals(_pending, raw, StringComparison.Ordinal) || _error is not null;
        _pending = raw;

        // web: clear any stale validation error as soon as the user edits.
        _error = null;

        if (changed)
        {
            RaiseAll();
        }
    }

    /// <summary>
    /// Force-commit the whole pending buffer as one or more tags — the native port of the web Enter handler
    /// (<c>commitAll(pending)</c>). A blank buffer just clears any stale error.
    /// </summary>
    public void Commit() => CommitAll(_pending);

    /// <summary>
    /// Commit the pending buffer on blur — the native port of the web <c>handleBlur</c>, which only commits
    /// when the buffer holds non-whitespace so a half-typed tag is not silently dropped on focus loss.
    /// </summary>
    public void CommitOnBlur()
    {
        if (_pending.Trim().Length > 0)
        {
            CommitAll(_pending);
        }
    }

    /// <summary>
    /// Force-commit the pending buffer if it holds non-whitespace — the native port of the imperative web
    /// handle's <c>commitPending()</c>.
    /// </summary>
    public void CommitPendingIfAny() => CommitOnBlur();

    /// <summary>
    /// Commit pasted text — the native port of the web <c>handlePaste</c>. The pasted text is appended to the
    /// pending buffer, a synthetic separator forces the whole paste to be consumed (so a trailing fragment is
    /// not left half-committed) and the surviving remainder becomes the new pending text.
    /// </summary>
    /// <param name="text">The pasted text.</param>
    public void Paste(string? text)
    {
        if (_disabled || string.IsNullOrEmpty(text))
        {
            return;
        }

        char separator = _separators[0];
        TagCommitResult result = TagListEditor.Commit(_source.Tags, _pending + text + separator, _context);
        ApplyCommit(result);
        _pending = result.Remainder;
        RaiseAll();
    }

    /// <summary>
    /// Handle a Backspace keystroke — the native port of the web Backspace branch: when the buffer is empty and
    /// at least one tag exists, remove the trailing chip and report that the key was handled.
    /// </summary>
    /// <returns>True when the trailing chip was removed (the caller should mark the key handled).</returns>
    public bool HandleBackspace()
    {
        if (_disabled)
        {
            return false;
        }

        if (_pending.Length == 0 && _source.Tags.Count > 0)
        {
            RemoveAt(_source.Tags.Count - 1);
            return true;
        }

        return false;
    }

    /// <summary>
    /// Remove the tag at <paramref name="index"/> — the native port of the web <c>removeAt</c>: it publishes the
    /// shortened list, clears any stale error and announces the removal. A no-op while disabled or out of range.
    /// </summary>
    /// <param name="index">The index of the tag to remove.</param>
    public void RemoveAt(int index)
    {
        if (_disabled)
        {
            return;
        }

        IReadOnlyList<string> current = _source.Tags;
        if (index < 0 || index >= current.Count)
        {
            return;
        }

        string removed = current[index];
        var next = new List<string>(current);
        next.RemoveAt(index);

        PublishTags(next);
        _error = null;
        Announce(TagInputRegistration.FormatTag(L(TagInputRegistration.RemovedKey, TagInputRegistration.RemovedFallback), removed));
        RaiseAll();
    }

    /// <summary>Detach from the value seam (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _source.Changed -= OnSourceChanged;
        GC.SuppressFinalize(this);
    }

    private void CommitAll(string text)
    {
        if (string.IsNullOrEmpty(text))
        {
            // web commitAll: an empty buffer just clears a stale error (the user emptied the field by other means).
            if (_error is not null)
            {
                _error = null;
                RaiseAll();
            }

            return;
        }

        // web: append the primary separator so commitText consumes the trailing fragment as a finished tag.
        char separator = _separators[0];
        TagCommitResult result = TagListEditor.Commit(_source.Tags, text + separator, _context);
        ApplyCommit(result);
        _pending = result.Remainder;
        RaiseAll();
    }

    private void ApplyCommit(TagCommitResult result)
    {
        // web: onChange first, then setError, then the single announcement.
        if (result.Changed)
        {
            PublishTags(result.Tags);
        }

        _error = result.FirstError;

        if (result.FirstError is not null)
        {
            return;
        }

        if (result.AddedCount > 0)
        {
            Announce(result.AddedCount == 1
                ? L(TagInputRegistration.AddedOneKey, TagInputRegistration.AddedOneFallback)
                : TagInputRegistration.FormatAdded(L(TagInputRegistration.AddedKey, TagInputRegistration.AddedFallback), result.AddedCount));
        }
        else if (result.LastDuplicate is { } duplicate)
        {
            Announce(TagInputRegistration.FormatTag(L(TagInputRegistration.DuplicateKey, TagInputRegistration.DuplicateFallback), duplicate));
        }
        else if (result.HitMax)
        {
            Announce(L(TagInputRegistration.MaxReachedAnnounceKey, TagInputRegistration.MaxReachedAnnounceFallback));
        }
    }

    private void PublishTags(IReadOnlyList<string> next)
    {
        // Push the new list through the controlled seam without re-projecting twice; the caller raises once.
        _muteSource = true;
        _source.SetTags(next);
        _muteSource = false;
        TagsChanged?.Invoke(this, next);
    }

    private void OnSourceChanged(object? sender, EventArgs e)
    {
        if (_muteSource)
        {
            return;
        }

        // An external value reassignment can settle the field below the cap, so a stale error is dropped.
        if (_error is not null && !AtMax)
        {
            _error = null;
        }

        RaiseAll();
    }

    private void Announce(string message) => _announcer.Announce(message);

    private string L(string key, string fallback) => _localizer.GetString(key, fallback);

    private void RaiseAll() => PropertyChanged?.Invoke(this, AllProperties);
}
