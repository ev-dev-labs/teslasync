using System.Globalization;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.ModalsDialogs;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The chart-render shape of a single user annotation — the native mirror of the web <c>DataAnnotation</c>
/// (web/src/types/annotations.ts) that the web <c>AnnotationList</c> (web/src/components/charts/AnnotationList.tsx)
/// renders. The web list reads <see cref="Id"/>, <see cref="Label"/>, <see cref="Description"/>,
/// <see cref="Timestamp"/> and <see cref="Category"/>; the remaining identity fields
/// (<see cref="Context"/>, <see cref="VehicleId"/>, <see cref="CreatedAt"/>) are carried verbatim so this type is a
/// faithful, reusable port of the shared annotation shape rather than a list-only subset. The
/// <see cref="AnnotationCategory"/> is reused from the annotation-modal domain (the canonical native home of the
/// category union + its colours) instead of being redeclared. UI-free so it is asserted without a XAML host.
/// </summary>
public sealed record DataAnnotation
{
    /// <summary>Stable identifier (web <c>id</c>); the value passed to <c>onRemove</c>.</summary>
    public required string Id { get; init; }

    /// <summary>The annotated point's display timestamp (web <c>timestamp</c>), shown right-aligned on the row.</summary>
    public required string Timestamp { get; init; }

    /// <summary>The short label shown on the row (web <c>label</c>).</summary>
    public required string Label { get; init; }

    /// <summary>The optional longer description (web <c>description?</c>); shown after an em dash when present.</summary>
    public string? Description { get; init; }

    /// <summary>The category that selects the row's colour dot (web <c>category</c>); defaults to milestone.</summary>
    public AnnotationCategory Category { get; init; } = AnnotationCategory.Milestone;

    /// <summary>The chart/page bucket the annotation belongs to (web <c>context</c>).</summary>
    public string Context { get; init; } = string.Empty;

    /// <summary>The optional owning vehicle id (web <c>vehicleId?</c>).</summary>
    public long? VehicleId { get; init; }

    /// <summary>The created instant (web <c>createdAt</c>).</summary>
    public string CreatedAt { get; init; } = string.Empty;
}

/// <summary>
/// One projected annotation row ready for display — the native analogue of one rendered <c>&lt;div&gt;</c> in the
/// web <c>AnnotationList</c> map. <see cref="ColorHex"/> is the category accent as a <c>#rrggbb</c> string (the web
/// <c>ANNOTATION_COLORS[category]</c> inline <c>backgroundColor</c>) so this projection stays WinUI-free; the view
/// parses it into a brush at the display boundary. UI-free so the projection is unit-tested headlessly.
/// </summary>
/// <param name="Id">The annotation id passed back to the remove handler (web <c>ann.id</c>).</param>
/// <param name="Label">The row label (web <c>ann.label</c>).</param>
/// <param name="Description">The optional description (web <c>ann.description</c>); null/empty hides the segment.</param>
/// <param name="Timestamp">The right-aligned timestamp text (web <c>ann.timestamp</c>).</param>
/// <param name="ColorHex">The category accent as <c>#rrggbb</c> (web <c>ANNOTATION_COLORS[ann.category]</c>).</param>
public sealed record AnnotationRow(
    string Id,
    string Label,
    string? Description,
    string Timestamp,
    string ColorHex)
{
    /// <summary>True when a non-empty description should render (web <c>{ann.description &amp;&amp; …}</c>).</summary>
    public bool HasDescription => !string.IsNullOrEmpty(Description);
}

/// <summary>
/// Pure projection of the annotation collection into display rows — the native port of the web
/// <c>AnnotationList</c> map body (web/src/components/charts/AnnotationList.tsx L22-L51). Each annotation becomes an
/// <see cref="AnnotationRow"/> whose colour is resolved from the shared annotation colour map
/// (<see cref="AddAnnotationRegistration.ColorFor"/>, the native <c>ANNOTATION_COLORS</c>), preserving input order.
/// No WinUI types — unit-tested without a UI host.
/// </summary>
public static class AnnotationListProjection
{
    /// <summary>Project a single annotation into its display row (web one map iteration).</summary>
    public static AnnotationRow ToRow(DataAnnotation annotation)
    {
        ArgumentNullException.ThrowIfNull(annotation);
        return new AnnotationRow(
            annotation.Id,
            annotation.Label,
            annotation.Description,
            annotation.Timestamp,
            AddAnnotationRegistration.ColorFor(annotation.Category));
    }

    /// <summary>Project the whole collection into display rows, preserving order (web <c>annotations.map</c>).</summary>
    public static IReadOnlyList<AnnotationRow> Project(IEnumerable<DataAnnotation> annotations)
    {
        ArgumentNullException.ThrowIfNull(annotations);
        var rows = new List<AnnotationRow>();
        foreach (var annotation in annotations)
        {
            rows.Add(ToRow(annotation));
        }

        return rows;
    }
}

/// <summary>
/// Canonical metadata + i18n keys for the <c>AnnotationList</c> shared surface — the native mirror of the web
/// component at <c>web/src/components/charts/AnnotationList.tsx</c>. The web surface ships exactly two literal
/// strings, the list title (<c>t('annotation.listTitle', 'Annotations')</c>) and the per-row remove action's
/// accessible name (<c>t('annotation.remove', 'Remove annotation')</c>); both are keyed here with that literal as
/// the English fallback so the native view and view-model resolve every string through the i18n facade and carry
/// no inline copy. The keys match the web catalogue (web/src/i18n/en.json) and the sibling annotation surface
/// verbatim. UI-free so every key is asserted without a resource host.
/// </summary>
public static class AnnotationListRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "AnnotationList";

    /// <summary>
    /// Root automation id set on the surface while it has rows — the stable handle a UI-automation test uses to
    /// find the list. Cleared while the surface is empty (the web component renders nothing when empty).
    /// </summary>
    public const string RootAutomationId = "annotation-list-root";

    /// <summary>i18n key for the list title (web <c>annotation.listTitle</c>).</summary>
    public const string ListTitleKey = "annotation.listTitle";

    /// <summary>English fallback for <see cref="ListTitleKey"/> (web second arg).</summary>
    public const string ListTitleFallback = "Annotations";

    /// <summary>i18n key for the per-row remove action's accessible name (web <c>annotation.remove</c>).</summary>
    public const string RemoveKey = "annotation.remove";

    /// <summary>English fallback for <see cref="RemoveKey"/> (web second arg).</summary>
    public const string RemoveFallback = "Remove annotation";

    /// <summary>The localized list title (web <c>t('annotation.listTitle', 'Annotations')</c>).</summary>
    public static string ListTitle(ILocalizer localizer) =>
        Require(localizer).GetString(ListTitleKey, ListTitleFallback);

    /// <summary>The localized remove-action accessible name (web <c>t('annotation.remove', 'Remove annotation')</c>).</summary>
    public static string RemoveLabel(ILocalizer localizer) =>
        Require(localizer).GetString(RemoveKey, RemoveFallback);

    private static ILocalizer Require(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer;
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>AnnotationList</c> surface (P1/S11 diagnostics contract). Annotation labels,
/// descriptions and timestamps are arbitrary user-authored content that can carry fleet context, so the collector
/// records ONLY the operational <see cref="RecordViewOpened"/> signal with the surface slug — never a label,
/// description, timestamp or id. Thread-safe; mirrors the sibling annotation surface's collector.
/// </summary>
public sealed class AnnotationListDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public AnnotationListDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=AnnotationList</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(string.Create(
            CultureInfo.InvariantCulture, $"view.opened slug={AnnotationListRegistration.Slug}"));
    }
}
