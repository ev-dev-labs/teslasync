using System.Globalization;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.WidgetPrimitives.WidgetDetailCardSurface;

/// <summary>
/// Canonical metadata for the <c>WidgetDetailCard</c> widget primitive — the native mirror of the web
/// component at <c>web/src/features/dashboard/widgets/shared/WidgetDetailCard.tsx</c>: the stable
/// diagnostics slug. UI-free so the metadata is asserted in tests.
/// </summary>
public static class WidgetDetailCardRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "WidgetDetailCard";
}

/// <summary>
/// The semantic badge tone — the native mirror of the web <c>DetailEntry.badge.variant</c> union
/// (<c>'success' | 'warning' | 'error' | 'neutral'</c> in the web source). The web maps these to the shared
/// <c>Badge</c> variants via its <c>badgeVariantMap</c> (success → success, warning → warning, error →
/// danger, neutral → neutral); <see cref="WidgetDetailCardProjection.StatusFor"/> reproduces that mapping onto
/// the native <see cref="StatusKind"/>.
/// </summary>
public enum WidgetDetailBadgeVariant
{
    /// <summary>web <c>'success'</c> — maps to <see cref="StatusKind.Success"/>.</summary>
    Success,

    /// <summary>web <c>'warning'</c> — maps to <see cref="StatusKind.Warning"/>.</summary>
    Warning,

    /// <summary>web <c>'error'</c> — maps to the danger tone (<see cref="StatusKind.Danger"/>).</summary>
    Error,

    /// <summary>web <c>'neutral'</c> — maps to <see cref="StatusKind.Neutral"/>.</summary>
    Neutral,
}

/// <summary>
/// A trailing chip on a detail row — the native analogue of the web <c>DetailEntry.badge</c>
/// (<c>{ text, variant }</c>): the short <see cref="Text"/> and its semantic <see cref="Variant"/>.
/// </summary>
/// <param name="Text">The chip label (web <c>badge.text</c>).</param>
/// <param name="Variant">The semantic tone (web <c>badge.variant</c>).</param>
public sealed record WidgetDetailBadge(string Text, WidgetDetailBadgeVariant Variant);

/// <summary>
/// One label / value row — the native analogue of the web <c>DetailEntry</c> interface
/// (<c>label</c>, <c>value: string | number | null</c>, optional <c>badge</c>, optional <c>mono</c>). The web
/// renders <c>value ?? '—'</c>, so a null value (or a null number) becomes the muted em dash at projection
/// time. The two web value styles are reproduced by the <see cref="Text"/> and <see cref="Number"/> factories;
/// pure data (no WinUI types) so it is exercised headlessly.
/// </summary>
public sealed record WidgetDetailEntry
{
    private WidgetDetailEntry(string label, string? value, WidgetDetailBadge? badge, bool mono)
    {
        Label = label;
        Value = value;
        Badge = badge;
        Mono = mono;
    }

    /// <summary>The row label (web <c>label</c>) — shown left, uppercased, muted.</summary>
    public string Label { get; }

    /// <summary>The already-resolved display value (web <c>value</c>); null renders the muted em dash.</summary>
    public string? Value { get; }

    /// <summary>Optional trailing chip (web <c>badge</c>); null renders no chip.</summary>
    public WidgetDetailBadge? Badge { get; }

    /// <summary>When true the value uses the monospace family (web <c>mono</c> → <c>font-mono</c>).</summary>
    public bool Mono { get; }

    /// <summary>
    /// A string-valued row (web <c>value: string | null</c>): the value is shown verbatim, or the muted em
    /// dash when <paramref name="value"/> is null.
    /// </summary>
    /// <param name="label">The row label (web <c>label</c>).</param>
    /// <param name="value">The display value (web <c>value</c>); null renders the muted em dash.</param>
    /// <param name="badge">Optional trailing chip (web <c>badge</c>).</param>
    /// <param name="mono">When true the value uses the monospace family (web <c>mono</c>).</param>
    public static WidgetDetailEntry Text(
        string label,
        string? value,
        WidgetDetailBadge? badge = null,
        bool mono = false) =>
        new(label, value, badge, mono);

    /// <summary>
    /// A number-valued row (web <c>value: number | null</c>): a non-null number is rendered with the invariant
    /// culture (matching the web's <c>String(number)</c>); a null renders the muted em dash.
    /// </summary>
    /// <param name="label">The row label (web <c>label</c>).</param>
    /// <param name="value">The numeric value (web <c>value</c>); null renders the muted em dash.</param>
    /// <param name="badge">Optional trailing chip (web <c>badge</c>).</param>
    /// <param name="mono">When true the value uses the monospace family (web <c>mono</c>).</param>
    public static WidgetDetailEntry Number(
        string label,
        double? value,
        WidgetDetailBadge? badge = null,
        bool mono = false) =>
        new(label, value?.ToString(CultureInfo.InvariantCulture), badge, mono);
}

/// <summary>
/// The render-time data model the <c>WidgetDetailCard</c> view binds to — the native analogue of the web
/// <c>WidgetDetailCardProps</c> (<c>entries</c>, <c>compact</c>, <c>emptyMessage</c>, <c>emptyIcon</c>). The web
/// component is purely presentational: its parent widget owns any data fetching and feeds an already-resolved
/// list of rows, so — exactly like React re-rendering with resolved props — there is no fetch-driven loading /
/// error / stale / offline branch to reproduce here; the only branches are "empty" (no rows → the friendly
/// empty surface) and "populated" (the rows, sliced to the first four in <see cref="Compact"/> mode). Pure data
/// (no WinUI types) so the projection is unit-tested without a UI host.
/// </summary>
public sealed record WidgetDetailCardModel
{
    private WidgetDetailCardModel(
        IReadOnlyList<WidgetDetailEntry> entries,
        bool compact,
        string? emptyMessage,
        string? emptyIconGlyph)
    {
        Entries = entries;
        Compact = compact;
        EmptyMessage = emptyMessage;
        EmptyIconGlyph = emptyIconGlyph;
    }

    /// <summary>The rows to render (web <c>entries</c>); an empty list renders the empty surface.</summary>
    public IReadOnlyList<WidgetDetailEntry> Entries { get; }

    /// <summary>When true only the first four rows are shown (web <c>compact</c> → <c>entries.slice(0, 4)</c>).</summary>
    public bool Compact { get; }

    /// <summary>Optional caller override for the empty message (web <c>emptyMessage</c>); null uses the localized default.</summary>
    public string? EmptyMessage { get; }

    /// <summary>Optional Segoe Fluent glyph for the empty surface (web <c>emptyIcon</c>); null shows no glyph.</summary>
    public string? EmptyIconGlyph { get; }

    /// <summary>The initial / no-data model — an empty row list, rendering the empty surface.</summary>
    public static WidgetDetailCardModel Empty { get; } = Create(Array.Empty<WidgetDetailEntry>());

    /// <summary>Build a model over a row list and the optional web props.</summary>
    /// <param name="entries">The rows to render (web <c>entries</c>).</param>
    /// <param name="compact">When true only the first four rows are shown (web <c>compact</c>).</param>
    /// <param name="emptyMessage">Optional empty-message override (web <c>emptyMessage</c>).</param>
    /// <param name="emptyIconGlyph">Optional empty-surface glyph (web <c>emptyIcon</c>).</param>
    public static WidgetDetailCardModel Create(
        IReadOnlyList<WidgetDetailEntry> entries,
        bool compact = false,
        string? emptyMessage = null,
        string? emptyIconGlyph = null)
    {
        ArgumentNullException.ThrowIfNull(entries);
        return new WidgetDetailCardModel(entries, compact, emptyMessage, emptyIconGlyph);
    }
}

/// <summary>
/// A fully projected, render-ready row — the native analogue of one mapped <c>&lt;div&gt;</c> in the web
/// source: the original <see cref="Label"/> (kept for the accessible name; the view uppercases the glyph), the
/// resolved <see cref="DisplayValue"/> (web <c>value ?? '—'</c>), the <see cref="Mono"/> flag, the resolved
/// badge (<see cref="HasBadge"/> / <see cref="BadgeText"/> / <see cref="BadgeStatus"/>), the
/// <see cref="ShowDivider"/> hairline guard (web <c>i &lt; visible.length - 1</c>) and the composed
/// <see cref="AutomationName"/> Narrator reads.
/// </summary>
/// <param name="Label">The original row label (web <c>label</c>).</param>
/// <param name="DisplayValue">The resolved value, or the muted em dash (web <c>value ?? '—'</c>).</param>
/// <param name="Mono">True when the value uses the monospace family (web <c>mono</c>).</param>
/// <param name="HasBadge">True when a trailing chip is shown (web <c>entry.badge</c> present).</param>
/// <param name="BadgeText">The chip label (web <c>badge.text</c>); empty when <see cref="HasBadge"/> is false.</param>
/// <param name="BadgeStatus">The chip tone mapped onto <see cref="StatusKind"/> (web <c>badgeVariantMap</c>).</param>
/// <param name="ShowDivider">True for every row but the last (web bottom-border guard).</param>
/// <param name="AutomationName">The composed accessible name Narrator reads for the row.</param>
public sealed record WidgetDetailRowDisplay(
    string Label,
    string DisplayValue,
    bool Mono,
    bool HasBadge,
    string BadgeText,
    StatusKind BadgeStatus,
    bool ShowDivider,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of a <see cref="WidgetDetailCardModel"/> — everything the web source
/// derives before returning JSX: the <see cref="IsEmpty"/> branch guard (web <c>entries.length === 0</c>), the
/// resolved <see cref="EmptyMessage"/> and optional <see cref="EmptyIconGlyph"/>, and the visible
/// <see cref="Rows"/> (sliced to four in compact mode). Pure data so every value is asserted headlessly.
/// </summary>
/// <param name="IsEmpty">True when there are no rows — the friendly empty surface renders (web empty branch).</param>
/// <param name="EmptyMessage">The resolved empty message (web <c>emptyMessage ?? 'No details available'</c>).</param>
/// <param name="EmptyIconGlyph">Optional empty-surface glyph (web <c>emptyIcon</c>); null shows no glyph.</param>
/// <param name="Rows">The visible rows; empty when <see cref="IsEmpty"/> is true.</param>
public sealed record WidgetDetailCardDisplay(
    bool IsEmpty,
    string EmptyMessage,
    string? EmptyIconGlyph,
    IReadOnlyList<WidgetDetailRowDisplay> Rows);

/// <summary>
/// Pure projection from a <see cref="WidgetDetailCardModel"/> to its <see cref="WidgetDetailCardDisplay"/> — the
/// native port of <c>web/src/features/dashboard/widgets/shared/WidgetDetailCard.tsx</c>. Reproduces the web
/// derivations exactly:
/// <list type="bullet">
///   <item><description>an empty row list yields the empty surface (web <c>entries.length === 0</c>), whose
///   message is the caller override or the localized <c>widget.detail.empty</c> default (web
///   <c>emptyMessage ?? 'No details available'</c>) — the surface always renders rather than collapsing.</description></item>
///   <item><description>compact mode shows only the first <see cref="CompactLimit"/> rows (web
///   <c>entries.slice(0, 4)</c>).</description></item>
///   <item><description>each row resolves <c>value ?? '—'</c>, maps the badge variant through
///   <see cref="StatusFor"/> (web <c>badgeVariantMap</c>), and carries a bottom-hairline guard for every row but
///   the last (web <c>i &lt; visible.length - 1</c>).</description></item>
/// </list>
/// No WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
public static class WidgetDetailCardProjection
{
    /// <summary>The compact-mode row cap (web <c>entries.slice(0, 4)</c>).</summary>
    public const int CompactLimit = 4;

    /// <summary>The muted no-data glyph (web <c>'—'</c>).</summary>
    public const string EmDash = "\u2014";

    /// <summary>i18n key for the default empty message (the web literal is keyed for translation here).</summary>
    public const string EmptyMessageKey = "widget.detail.empty";

    /// <summary>English fallback for <see cref="EmptyMessageKey"/> (the web default literal).</summary>
    public const string EmptyMessageFallback = "No details available";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web props).</param>
    /// <param name="localizer">The i18n facade the empty message resolves through (P1/S10).</param>
    /// <returns>The render-ready display model.</returns>
    public static WidgetDetailCardDisplay Project(WidgetDetailCardModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        // web: if (entries.length === 0) return <EmptyState ... />
        if (model.Entries.Count == 0)
        {
            string message = model.EmptyMessage ?? localizer.GetString(EmptyMessageKey, EmptyMessageFallback);
            return new WidgetDetailCardDisplay(
                IsEmpty: true,
                EmptyMessage: message,
                EmptyIconGlyph: model.EmptyIconGlyph,
                Rows: Array.Empty<WidgetDetailRowDisplay>());
        }

        // web: const visible = compact ? entries.slice(0, 4) : entries
        IReadOnlyList<WidgetDetailEntry> visible;
        if (model.Compact && model.Entries.Count > CompactLimit)
        {
            visible = model.Entries.Take(CompactLimit).ToList();
        }
        else
        {
            visible = model.Entries;
        }

        var rows = new List<WidgetDetailRowDisplay>(visible.Count);
        for (int i = 0; i < visible.Count; i++)
        {
            WidgetDetailEntry entry = visible[i];
            string displayValue = entry.Value ?? EmDash;
            bool hasBadge = entry.Badge is not null;
            string badgeText = entry.Badge?.Text ?? string.Empty;
            StatusKind badgeStatus = entry.Badge is { } badge ? StatusFor(badge.Variant) : StatusKind.Neutral;

            rows.Add(new WidgetDetailRowDisplay(
                Label: entry.Label,
                DisplayValue: displayValue,
                Mono: entry.Mono,
                HasBadge: hasBadge,
                BadgeText: badgeText,
                BadgeStatus: badgeStatus,
                ShowDivider: i < visible.Count - 1,
                AutomationName: ComposeName(entry.Label, displayValue, hasBadge ? badgeText : null)));
        }

        return new WidgetDetailCardDisplay(
            IsEmpty: false,
            EmptyMessage: string.Empty,
            EmptyIconGlyph: null,
            Rows: rows);
    }

    /// <summary>Map a web badge variant onto the native status tone (the web <c>badgeVariantMap</c>).</summary>
    /// <param name="variant">The web badge variant.</param>
    public static StatusKind StatusFor(WidgetDetailBadgeVariant variant) => variant switch
    {
        WidgetDetailBadgeVariant.Success => StatusKind.Success,
        WidgetDetailBadgeVariant.Warning => StatusKind.Warning,
        WidgetDetailBadgeVariant.Error => StatusKind.Danger,
        _ => StatusKind.Neutral,
    };

    // Narrator reads each (non-interactive) row as "label: value[, badge]" so the paired label/value/chip are
    // announced together; the web rows have no explicit aria, so this is a native accessibility aid built from
    // the same data, using the original (non-uppercased) label.
    private static string ComposeName(string label, string value, string? badge) =>
        badge is null
            ? $"{label}: {value}"
            : $"{label}: {value}, {badge}";
}

/// <summary>
/// PII-safe diagnostics for the <c>WidgetDetailCard</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never the row labels or values — so a
/// diagnostics line can never leak fleet state. Thread-safe.
/// </summary>
public sealed class WidgetDetailCardDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional sink the operational event line is written to.</param>
    public WidgetDetailCardDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=WidgetDetailCard</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={WidgetDetailCardRegistration.Slug}");
    }
}
