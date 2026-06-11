using System.Globalization;
using System.Text.RegularExpressions;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// Annotation category — the native mirror of the web <c>AnnotationCategory</c> union
/// (<c>'milestone' | 'maintenance' | 'trip' | 'issue' | 'upgrade' | 'custom'</c>,
/// web/src/types/annotations.ts). The wire form is the lower-case token the Go API stores
/// (<c>models.ChartAnnotation.Category</c>).
/// </summary>
public enum AnnotationCategory
{
    /// <summary>A notable lifetime event (web <c>milestone</c>) — the form default.</summary>
    Milestone,

    /// <summary>A service / maintenance event (web <c>maintenance</c>).</summary>
    Maintenance,

    /// <summary>A trip / journey marker (web <c>trip</c>).</summary>
    Trip,

    /// <summary>A problem / fault marker (web <c>issue</c>).</summary>
    Issue,

    /// <summary>A hardware / software upgrade (web <c>upgrade</c>).</summary>
    Upgrade,

    /// <summary>A free-form, user-defined marker (web <c>custom</c>).</summary>
    Custom,
}

/// <summary>Wire mapping for <see cref="AnnotationCategory"/> — UI-free so it is asserted headlessly.</summary>
public static class AnnotationCategories
{
    /// <summary>The lower-case API token for <paramref name="category"/> (web union member).</summary>
    public static string ToWire(AnnotationCategory category) => category switch
    {
        AnnotationCategory.Milestone => "milestone",
        AnnotationCategory.Maintenance => "maintenance",
        AnnotationCategory.Trip => "trip",
        AnnotationCategory.Issue => "issue",
        AnnotationCategory.Upgrade => "upgrade",
        AnnotationCategory.Custom => "custom",
        _ => "milestone",
    };

    /// <summary>Parse an API token back to a <see cref="AnnotationCategory"/>; false for an unknown token.</summary>
    public static bool TryFromWire(string? wire, out AnnotationCategory category)
    {
        switch (wire)
        {
            case "milestone":
                category = AnnotationCategory.Milestone;
                return true;
            case "maintenance":
                category = AnnotationCategory.Maintenance;
                return true;
            case "trip":
                category = AnnotationCategory.Trip;
                return true;
            case "issue":
                category = AnnotationCategory.Issue;
                return true;
            case "upgrade":
                category = AnnotationCategory.Upgrade;
                return true;
            case "custom":
                category = AnnotationCategory.Custom;
                return true;
            default:
                category = AnnotationCategory.Milestone;
                return false;
        }
    }
}

/// <summary>
/// One category choice for the category pill row (value + localized label + Segoe Fluent glyph + accent
/// hex). The native analogue of one web <c>CATEGORY_OPTIONS</c> entry combined with the matching
/// <c>ANNOTATION_COLORS</c> value. <see cref="Color"/> is a <c>#rrggbb</c> string so this projection stays
/// WinUI-free; the view parses it into a brush at the display boundary.
/// </summary>
public sealed record AnnotationCategoryOption(
    AnnotationCategory Value,
    string Label,
    string Glyph,
    string Color);

/// <summary>
/// The annotation the form emits — the native analogue of the web <c>onAdd(label, category, description?,
/// occurredAt?)</c> arguments. <see cref="Label"/> is trimmed and non-empty, <see cref="Description"/> is the
/// trimmed description or null (web <c>description.trim() || undefined</c>), and <see cref="OccurredAt"/> is a
/// non-empty ISO-8601 UTC instant.
/// </summary>
public sealed record AnnotationDraft(
    string Label,
    AnnotationCategory Category,
    string? Description,
    string OccurredAt);

/// <summary>
/// Canonical metadata, validation bounds, accent hexes, Segoe Fluent glyphs and i18n keys for the
/// <c>AddAnnotationPopover</c> surface — the native mirror of
/// <c>web/src/components/charts/AddAnnotationPopover.tsx</c> (+ <c>web/src/types/annotations.ts</c>). The web
/// component ships literal copy and a lucide icon per category; every literal is keyed here (with that literal
/// as the English fallback) so the native view and view-model stay free of inline strings and resolve through
/// the i18n facade, and every web lucide icon maps to a documented Segoe Fluent glyph. UI-free so every key +
/// bound + mapping is asserted in tests.
/// </summary>
public static class AddAnnotationRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "AddAnnotationPopover";

    /// <summary>Maximum label length (web <c>maxLength={50}</c> on the label input).</summary>
    public const int LabelMaxLength = 50;

    /// <summary>Maximum description length (web <c>maxLength={200}</c> on the description input).</summary>
    public const int DescriptionMaxLength = 200;

    /// <summary>The categories in web render order (web <c>CATEGORY_OPTIONS</c>).</summary>
    public static IReadOnlyList<AnnotationCategory> CategoryOrder { get; } =
    [
        AnnotationCategory.Milestone,
        AnnotationCategory.Maintenance,
        AnnotationCategory.Trip,
        AnnotationCategory.Issue,
        AnnotationCategory.Upgrade,
        AnnotationCategory.Custom,
    ];

    /// <summary>Modal title (web <c>t('annotation.addTitle', 'Add Annotation')</c>).</summary>
    public static string AddTitle(ILocalizer localizer) =>
        Require(localizer).GetString("annotation.addTitle", "Add Annotation");

    /// <summary>Date field label (web <c>t('annotation.date', 'Date')</c>).</summary>
    public static string DateLabel(ILocalizer localizer) =>
        Require(localizer).GetString("annotation.date", "Date");

    /// <summary>Label field label (web <c>t('annotation.label', 'Label')</c>).</summary>
    public static string LabelLabel(ILocalizer localizer) =>
        Require(localizer).GetString("annotation.label", "Label");

    /// <summary>Label field input hint (mirrors the web label input hint "e.g., Battery replaced").</summary>
    public static string LabelPrompt(ILocalizer localizer) =>
        Require(localizer).GetString("annotation.labelPlaceholder", "e.g., Battery replaced"); // parity:allow web i18n key (input hint text), not a stub

    /// <summary>Category group label (web <c>t('annotation.category', 'Category')</c>).</summary>
    public static string CategoryLabel(ILocalizer localizer) =>
        Require(localizer).GetString("annotation.category", "Category");

    /// <summary>Description field label (web <c>t('annotation.description', 'Description')</c>).</summary>
    public static string DescriptionLabel(ILocalizer localizer) =>
        Require(localizer).GetString("annotation.description", "Description");

    /// <summary>Description field input hint (mirrors the web description input hint "Optional description...").</summary>
    public static string DescriptionPrompt(ILocalizer localizer) =>
        Require(localizer).GetString("annotation.descPlaceholder", "Optional description..."); // parity:allow web i18n key (input hint text), not a stub

    /// <summary>Submit button label (web <c>t('annotation.add', 'Add Annotation')</c>).</summary>
    public static string AddLabel(ILocalizer localizer) =>
        Require(localizer).GetString("annotation.add", "Add Annotation");

    /// <summary>Cancel button label (web <c>t('common.cancel', 'Cancel')</c>).</summary>
    public static string CancelLabel(ILocalizer localizer) =>
        Require(localizer).GetString("common.cancel", "Cancel");

    /// <summary>The localized label for a category (web <c>t(`annotation.cat.${value}`, opt.label)</c>).</summary>
    public static string CategoryLabelFor(AnnotationCategory category, ILocalizer localizer) => category switch
    {
        AnnotationCategory.Milestone => Require(localizer).GetString("annotation.cat.milestone", "Milestone"),
        AnnotationCategory.Maintenance => Require(localizer).GetString("annotation.cat.maintenance", "Maintenance"),
        AnnotationCategory.Trip => Require(localizer).GetString("annotation.cat.trip", "Trip"),
        AnnotationCategory.Issue => Require(localizer).GetString("annotation.cat.issue", "Issue"),
        AnnotationCategory.Upgrade => Require(localizer).GetString("annotation.cat.upgrade", "Upgrade"),
        AnnotationCategory.Custom => Require(localizer).GetString("annotation.cat.custom", "Custom"),
        _ => Require(localizer).GetString("annotation.cat.milestone", "Milestone"),
    };

    /// <summary>
    /// The accent <c>#rrggbb</c> for a category — the native mirror of the web <c>ANNOTATION_COLORS</c> map
    /// (web/src/types/annotations.ts). Used for the selected pill's icon / text / border accent.
    /// </summary>
    public static string ColorFor(AnnotationCategory category) => category switch
    {
        AnnotationCategory.Milestone => "#3b82f6",
        AnnotationCategory.Maintenance => "#f59e0b",
        AnnotationCategory.Trip => "#22c55e",
        AnnotationCategory.Issue => "#ef4444",
        AnnotationCategory.Upgrade => "#a855f7",
        AnnotationCategory.Custom => "#94a3b8",
        _ => "#94a3b8",
    };

    /// <summary>
    /// The Segoe Fluent glyph standing in for a category's web lucide icon:
    /// milestone→Flag (E7C1), maintenance→Repair/Wrench (E90F), trip→MapPin (E707),
    /// issue→Warning/AlertTriangle (E7BA), upgrade→Up/ArrowUpCircle (E74A), custom→Tag (E8EC).
    /// </summary>
    public static string GlyphFor(AnnotationCategory category) => category switch
    {
        AnnotationCategory.Milestone => "\uE7C1",
        AnnotationCategory.Maintenance => "\uE90F",
        AnnotationCategory.Trip => "\uE707",
        AnnotationCategory.Issue => "\uE7BA",
        AnnotationCategory.Upgrade => "\uE74A",
        AnnotationCategory.Custom => "\uE8EC",
        _ => "\uE8EC",
    };

    private static ILocalizer Require(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer;
    }
}

/// <summary>
/// Pure projections for the <c>AddAnnotationPopover</c> surface — the native analogue of the web component's
/// category-option list, the <c>toDateInputValue</c> / <c>toIsoTimestamp</c> date normalisers, the
/// <c>label.trim()</c> submit gate, the <c>occurredAt</c> resolution and the <c>onAdd</c> argument assembly.
/// Every user-visible string flows through the i18n facade so the projection is unit-tested headlessly and the
/// view-model never resolves a literal.
/// </summary>
public static partial class AddAnnotationProjection
{
    /// <summary>The category pill options in web render order with localized labels, glyphs and accents.</summary>
    public static IReadOnlyList<AnnotationCategoryOption> CategoryOptions(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        var options = new List<AnnotationCategoryOption>(AddAnnotationRegistration.CategoryOrder.Count);
        foreach (var value in AddAnnotationRegistration.CategoryOrder)
        {
            options.Add(new AnnotationCategoryOption(
                value,
                AddAnnotationRegistration.CategoryLabelFor(value, localizer),
                AddAnnotationRegistration.GlyphFor(value),
                AddAnnotationRegistration.ColorFor(value)));
        }

        return options;
    }

    /// <summary>The trimmed label (web <c>label.trim()</c>).</summary>
    public static string NormalizeLabel(string? label) => (label ?? string.Empty).Trim();

    /// <summary>True once the trimmed label is non-empty (web <c>disabled={!label.trim()}</c>).</summary>
    public static bool IsLabelValid(string? label) => NormalizeLabel(label).Length > 0;

    /// <summary>True when <paramref name="date"/> is a <c>YYYY-MM-DD</c> value (web date-input regex).</summary>
    public static bool IsDateInputValue(string? date) =>
        !string.IsNullOrEmpty(date) && DateInputRegex().IsMatch(date);

    /// <summary>
    /// Normalise any ISO-ish timestamp into the <c>YYYY-MM-DD</c> value the date field edits — the native
    /// analogue of the web <c>toDateInputValue</c>. Returns an empty string when parsing fails (and the input
    /// is not already <c>YYYY-MM-DD</c>) so the field renders empty rather than an invalid date.
    /// </summary>
    public static string ToDateInputValue(string? timestamp)
    {
        if (string.IsNullOrEmpty(timestamp))
        {
            return string.Empty;
        }

        if (DateTimeOffset.TryParse(
                timestamp,
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
                out var parsed))
        {
            return parsed.UtcDateTime.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        }

        // Already in YYYY-MM-DD shape — accept verbatim (web parity).
        return DateInputRegex().IsMatch(timestamp) ? timestamp : string.Empty;
    }

    /// <summary>
    /// Inverse of <see cref="ToDateInputValue"/> — pin a <c>YYYY-MM-DD</c> value to UTC midnight (the native
    /// analogue of the web <c>toIsoTimestamp</c>). Returns an empty string for a missing / malformed date.
    /// </summary>
    public static string ToIsoTimestamp(string? date)
    {
        if (string.IsNullOrEmpty(date) || !DateInputRegex().IsMatch(date))
        {
            return string.Empty;
        }

        return $"{date}T00:00:00Z";
    }

    /// <summary>
    /// Resolve the annotation's instant — the native analogue of the web
    /// <c>const occurredAt = editableDate ? toIsoTimestamp(editedDate) : timestamp</c>. When the date is
    /// editable the picked day is pinned to UTC midnight; otherwise the supplied timestamp is used verbatim.
    /// Returns an empty string when the result is missing / malformed (the web <c>if (!occurredAt) return</c>).
    /// </summary>
    public static string ResolveOccurredAt(bool editableDate, string? editedDate, string? timestamp) =>
        editableDate ? ToIsoTimestamp(editedDate) : (timestamp ?? string.Empty);

    /// <summary>
    /// Assemble the <c>onAdd</c> arguments from the current field values — the native analogue of
    /// <c>onAdd(label.trim(), category, description.trim() || undefined, occurredAt)</c>. The label is trimmed,
    /// the description is trimmed-or-null and the instant is the resolved <paramref name="occurredAt"/>.
    /// </summary>
    public static AnnotationDraft BuildDraft(
        string? label,
        AnnotationCategory category,
        string? description,
        string occurredAt)
    {
        string trimmedDescription = (description ?? string.Empty).Trim();
        return new AnnotationDraft(
            NormalizeLabel(label),
            category,
            trimmedDescription.Length > 0 ? trimmedDescription : null,
            occurredAt);
    }

    [GeneratedRegex(@"^\d{4}-\d{2}-\d{2}$")]
    private static partial Regex DateInputRegex();
}

/// <summary>
/// PII-safe diagnostics for the <c>AddAnnotationPopover</c> surface (P1/S11 diagnostics contract). Records only
/// operational counters with the surface slug — never the annotation label, description or instant — so a
/// diagnostics line can never leak annotation content. Thread-safe.
/// </summary>
public sealed class AddAnnotationDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;
    private long _annotationsAdded;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public AddAnnotationDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Number of annotations added from this surface.</summary>
    public long AnnotationsAdded => Interlocked.Read(ref _annotationsAdded);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=AddAnnotationPopover</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(string.Create(
            CultureInfo.InvariantCulture, $"view.opened slug={AddAnnotationRegistration.Slug}"));
    }

    /// <summary>Record that an annotation was added (the label / description are never logged).</summary>
    public void RecordAnnotationAdded()
    {
        Interlocked.Increment(ref _annotationsAdded);
        _sink?.Invoke(string.Create(
            CultureInfo.InvariantCulture, $"annotation.added slug={AddAnnotationRegistration.Slug}"));
    }
}
