using System.Globalization;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// One date bucket the list renders — the native mirror of the web
/// <c>DateGroupedListGroup&lt;T&gt;</c> interface (web/src/components/data-display/DateGroupedList.tsx L4-L21).
/// It carries the sortable <see cref="DateKey"/> (the web React key / <c>data-date-key</c>), the
/// caller-formatted <see cref="DateLabel"/> (e.g. "May 9, 2026"), an optional <see cref="RelativeLabel"/>
/// ("3 days ago"), an optional right-aligned <see cref="Summary"/> ("2 drives · 6.2 mi") and the
/// <see cref="Items"/> belonging to the bucket. The web <c>summary</c> is typed <c>ReactNode</c> for
/// flexibility, but every caller (web/src/features/driving/pages/DrivesListPage.tsx,
/// web/src/features/charging/pages/ChargingListPage.tsx) and the web spec supply a pre-formatted string,
/// so the native shape models it as text — keeping the bucket fully data (no view types) so the projection
/// is unit-tested headlessly. Domain-specific aggregation (the "2 drives · 6.2 mi" wording, unit
/// formatting) stays on the caller exactly as the web component is free of unit/format logic.
/// </summary>
/// <typeparam name="T">The item type each bucket holds (the web generic parameter).</typeparam>
public sealed record DateGroupedListGroup<T>
{
    /// <summary>Sortable key, typically <c>YYYY-MM-DD</c> (web <c>dateKey</c>); the section identity.</summary>
    public required string DateKey { get; init; }

    /// <summary>Visible date label, pre-formatted by the caller (web <c>dateLabel</c>, e.g. "May 9, 2026").</summary>
    public required string DateLabel { get; init; }

    /// <summary>Optional muted relative-time text rendered after the label (web <c>relativeLabel</c>, "3 days ago").</summary>
    public string? RelativeLabel { get; init; }

    /// <summary>Optional right-aligned per-group summary (web <c>summary</c>, "2 drives · 6.2 mi").</summary>
    public string? Summary { get; init; }

    /// <summary>The items in this bucket (web <c>items</c>); defaults to empty so iteration is always null-safe.</summary>
    public IReadOnlyList<T> Items { get; init; } = [];
}

/// <summary>
/// The display-ready projection of one bucket's divider row — the native analogue of the web
/// <c>&lt;header&gt;</c> composed for each section (web/src/components/data-display/DateGroupedList.tsx
/// L78-L101). It exposes the bold primary <see cref="DateLabel"/>, the muted <see cref="RelativeDisplay"/>
/// (the web "· {relativeLabel}" with its leading middle-dot separator), the muted right-aligned
/// <see cref="Summary"/>, the presence flags that drive the optional spans, the stable
/// <see cref="SectionId"/> (web <c>id={`date-group-${dateKey}`}</c> / <c>aria-labelledby</c> target) and the
/// composed <see cref="AccessibleName"/> a screen reader announces for the section the header labels. Pure
/// data — no view types — so each derived string is asserted without a UI host.
/// </summary>
public sealed record DateGroupedListHeader
{
    /// <summary>Sortable bucket key (web <c>group.dateKey</c>).</summary>
    public required string DateKey { get; init; }

    /// <summary>Bold primary label text (web <c>group.dateLabel</c>).</summary>
    public required string DateLabel { get; init; }

    /// <summary>Raw relative-time text without the separator (web <c>group.relativeLabel</c>); null/empty hides the span.</summary>
    public string? RelativeLabel { get; init; }

    /// <summary>Right-aligned summary text (web <c>group.summary</c>); null/empty hides the span.</summary>
    public string? Summary { get; init; }

    /// <summary>True when a relative-time span should render (web <c>{group.relativeLabel &amp;&amp; …}</c>).</summary>
    public bool HasRelativeLabel => !string.IsNullOrEmpty(RelativeLabel);

    /// <summary>True when a summary span should render (web <c>{group.summary &amp;&amp; …}</c>).</summary>
    public bool HasSummary => !string.IsNullOrEmpty(Summary);

    /// <summary>
    /// The relative-time text with its leading middle-dot separator (web <c>· {group.relativeLabel}</c>),
    /// or null when there is no relative label.
    /// </summary>
    public string? RelativeDisplay =>
        HasRelativeLabel ? $"{DateGroupedListLayout.RelativeSeparator} {RelativeLabel}" : null;

    /// <summary>
    /// The section's stable id (web <c>id={`date-group-${dateKey}`}</c>) — the <c>aria-labelledby</c> target
    /// and the automation id the native section carries.
    /// </summary>
    public string SectionId =>
        string.Concat(DateGroupedListLayout.SectionIdPrefix, DateKey);

    /// <summary>
    /// The accessible name a screen reader announces for the section this header labels — the native
    /// analogue of the web <c>aria-labelledby</c> pointing at the header element, whose accessible name is
    /// its visible text content. Concatenates the label, the relative-time text (with separator) and the
    /// summary, skipping the spans that are not rendered.
    /// </summary>
    public string AccessibleName
    {
        get
        {
            var parts = new List<string>(3) { DateLabel };
            if (RelativeDisplay is { Length: > 0 } relative)
            {
                parts.Add(relative);
            }

            if (HasSummary)
            {
                parts.Add(Summary!);
            }

            return string.Join(' ', parts);
        }
    }
}

/// <summary>
/// Pure projection of a bucket into its display-ready <see cref="DateGroupedListHeader"/> — the native port
/// of the per-section header composition in the web <c>DateGroupedList</c> map body
/// (web/src/components/data-display/DateGroupedList.tsx L72-L101). No view types, so the derived divider
/// strings (relative-time separator, section id, accessible name) are unit-tested headlessly.
/// </summary>
public static class DateGroupedListProjection
{
    /// <summary>Project one bucket into its header row (web one section's <c>&lt;header&gt;</c>).</summary>
    /// <typeparam name="T">The bucket item type (ignored by the header — only the metadata is read).</typeparam>
    /// <param name="group">The bucket to project.</param>
    public static DateGroupedListHeader Header<T>(DateGroupedListGroup<T> group)
    {
        ArgumentNullException.ThrowIfNull(group);
        return new DateGroupedListHeader
        {
            DateKey = group.DateKey,
            DateLabel = group.DateLabel,
            RelativeLabel = group.RelativeLabel,
            Summary = group.Summary,
        };
    }
}

/// <summary>
/// The pixel metrics + tokens of the date-divider layout — the native translation of the web
/// <c>DateGroupedList</c> Tailwind utilities (web/src/components/data-display/DateGroupedList.tsx) into
/// platform values, kept in one place so the view carries no magic numbers. Each constant pins the rem→px
/// value of the web class so the native rhythm matches the web source; theme colours still flow through the
/// generated token brushes at the view, never hard-coded here.
/// </summary>
public static class DateGroupedListLayout
{
    /// <summary>Vertical gap between successive groups (web <c>space-y-6</c> = 1.5rem).</summary>
    public const double GroupSpacing = 24;

    /// <summary>Vertical gap between successive items inside a group (web <c>space-y-3</c> = 0.75rem).</summary>
    public const double ItemSpacing = 12;

    /// <summary>Horizontal gap between the header's label / divider / summary cells (web <c>gap-3</c> = 0.75rem).</summary>
    public const double HeaderColumnSpacing = 12;

    /// <summary>Horizontal gap between the date label and the relative-time text (web <c>gap-2</c> = 0.5rem).</summary>
    public const double LabelGroupSpacing = 8;

    /// <summary>Gap below the header before the items (web header <c>mb-3</c> = 0.75rem).</summary>
    public const double HeaderBottomMargin = 12;

    /// <summary>Divider rule thickness (web <c>h-px</c>).</summary>
    public const double DividerThickness = 1;

    /// <summary>Divider rule opacity (web <c>opacity-50</c>).</summary>
    public const double DividerOpacity = 0.5;

    /// <summary>Header text size (web <c>text-xs</c> = 0.75rem).</summary>
    public const double HeaderFontSize = 12;

    /// <summary>The middle-dot separator before the relative-time text (web <c>· {relativeLabel}</c>).</summary>
    public const string RelativeSeparator = "\u00B7";

    /// <summary>Prefix of the per-section id (web <c>id={`date-group-${dateKey}`}</c>).</summary>
    public const string SectionIdPrefix = "date-group-";
}

/// <summary>
/// Canonical metadata for the <c>DateGroupedList</c> shared surface — the native mirror of the web component
/// at <c>web/src/components/data-display/DateGroupedList.tsx</c>. The web surface is anonymous: it renders no
/// titles or labels of its own (every visible string — the date label, relative-time text and summary — is
/// pre-formatted by the caller), so it makes zero <c>t()</c> calls and this registration carries no i18n
/// keys, only the diagnostics slug and the root automation id. Pure data so the metadata is asserted without
/// a resource host.
/// </summary>
public static class DateGroupedListRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "DateGroupedList";

    /// <summary>
    /// Root automation id set on the surface — the native analogue of the web <c>data-testid</c> handle a
    /// tooling / UI-automation test uses to find the list container (present even when the list is empty).
    /// </summary>
    public const string RootAutomationId = "date-grouped-list-root";
}

/// <summary>
/// PII-safe diagnostics for the <c>DateGroupedList</c> surface (P1/S11 diagnostics contract). Group labels,
/// relative-time text and summaries are arbitrary caller-authored content that can carry fleet context, so
/// the collector records ONLY the operational <see cref="RecordViewOpened"/> signal with the surface slug —
/// never a label, summary or item. Thread-safe; mirrors the sibling shared surfaces' collectors.
/// </summary>
public sealed class DateGroupedListDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public DateGroupedListDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=DateGroupedList</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(string.Create(
            CultureInfo.InvariantCulture, $"view.opened slug={DateGroupedListRegistration.Slug}"));
    }
}
