using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.WidgetPrimitives;

/// <summary>
/// The status a single <see cref="WidgetStatusCell"/> encodes — the native analogue of the web
/// <c>StatusCell['status']</c> union (<c>'ok' | 'warning' | 'error' | 'inactive' | 'unknown'</c>,
/// web/src/features/dashboard/widgets/shared/WidgetStatusGrid.tsx L8). Each value maps to a tinted chip
/// treatment + a corner dot colour resolved by <see cref="WidgetStatusPalette.For"/>.
/// </summary>
public enum WidgetStatusKind
{
    /// <summary>Healthy / nominal (web <c>ok</c> → emerald).</summary>
    Ok,

    /// <summary>Needs attention but functional (web <c>warning</c> → amber).</summary>
    Warning,

    /// <summary>Faulted / failed (web <c>error</c> → red).</summary>
    Error,

    /// <summary>Present but switched off / idle (web <c>inactive</c> → muted surface).</summary>
    Inactive,

    /// <summary>No reading available (web <c>unknown</c> → muted surface).</summary>
    Unknown,
}

/// <summary>
/// Which render branch the grid projection represents — the two branches the web
/// <c>WidgetStatusGrid</c> exposes (web L59-L61 empty-state early return vs. L65-L101 populated grid).
/// </summary>
public enum WidgetStatusGridState
{
    /// <summary>No cells were supplied; the friendly empty surface is shown (web <c>EmptyState</c>).</summary>
    Empty,

    /// <summary>One or more cells were supplied; the responsive status grid is shown.</summary>
    Populated,
}

/// <summary>
/// One status item rendered by the grid — the native port of the web <c>StatusCell</c> interface
/// (web L5-L11): a stable <see cref="Id"/>, a <see cref="Label"/>, a <see cref="Status"/>, an optional
/// <see cref="Value"/> and an optional leading <see cref="IconGlyph"/> (the web <c>icon</c> ReactNode,
/// expressed natively as a Segoe Fluent Icons glyph).
/// </summary>
/// <param name="Id">Stable identity for the cell (web <c>id</c>; used as the list key).</param>
/// <param name="Label">Localized caption shown under any value (web <c>label</c>).</param>
/// <param name="Status">The status colour treatment (web <c>status</c>).</param>
/// <param name="Value">Optional localized value shown below the label (web <c>value</c>); hidden when compact.</param>
/// <param name="IconGlyph">Optional leading Segoe Fluent Icons glyph (web <c>icon</c>).</param>
public sealed record WidgetStatusCell(
    string Id,
    string Label,
    WidgetStatusKind Status,
    string? Value = null,
    string? IconGlyph = null);

/// <summary>
/// The inputs the grid renders — the native analogue of the props the web <c>WidgetStatusGrid</c>
/// receives from its parent widget (web L13-L19). The component is purely presentational and never
/// fetches; the consuming widget builds the <see cref="Cells"/> from its own data hook and pushes them in
/// through the <see cref="IWidgetStatusGridSource"/> seam.
/// </summary>
public sealed record WidgetStatusGridInput
{
    /// <summary>The status cells to render; an empty list selects the empty state (web <c>cells</c>).</summary>
    public IReadOnlyList<WidgetStatusCell> Cells { get; init; } = [];

    /// <summary>Requested column count — clamped to 2, 3 or 4 (web <c>cols</c>, default 2).</summary>
    public int Cols { get; init; } = 2;

    /// <summary>When true the grid forces two columns and hides per-cell values (web <c>compact</c>).</summary>
    public bool Compact { get; init; }

    /// <summary>
    /// Optional consumer-supplied, already-localized empty message (web <c>emptyMessage</c>). When null or
    /// empty the grid falls back to the shared catalog message resolved by
    /// <see cref="WidgetStatusGridRegistration.EmptyMessage"/>.
    /// </summary>
    public string? EmptyMessage { get; init; }

    /// <summary>Optional Segoe Fluent Icons glyph for the empty surface (web <c>emptyIcon</c>).</summary>
    public string? EmptyIconGlyph { get; init; }
}

/// <summary>
/// The themed brush keys for one <see cref="WidgetStatusKind"/> — the native port of the web
/// <c>statusStyles</c> table (web L21-L42). The keys resolve against the generated token dictionary
/// (<c>Themes/Tokens.xaml</c>, P1/S9) at render time so the surface tracks the active theme; the view tints
/// the accent background/border (web <c>/10</c> + <c>/20</c> alpha) when <see cref="Tinted"/> is set.
/// </summary>
/// <param name="DotBrushKey">Token key for the corner status dot (web <c>dot</c>).</param>
/// <param name="BackgroundBrushKey">Token key for the chip background (web <c>bg</c>; tinted when accent).</param>
/// <param name="BorderBrushKey">Token key for the chip border (web border colour; tinted when accent).</param>
/// <param name="Tinted">True for the semantic accents (ok/warning/error) whose bg+border are alpha tints of the accent.</param>
public readonly record struct WidgetStatusPalette(
    string DotBrushKey,
    string BackgroundBrushKey,
    string BorderBrushKey,
    bool Tinted)
{
    /// <summary>Token key for the emerald success accent (web <c>emerald-500</c>).</summary>
    public const string SuccessBrushKey = "TsColorSuccessBrush";

    /// <summary>Token key for the amber warning accent (web <c>amber-500</c>).</summary>
    public const string WarningBrushKey = "TsColorWarningBrush";

    /// <summary>Token key for the red danger accent (web <c>red-500</c>).</summary>
    public const string DangerBrushKey = "TsColorDangerBrush";

    /// <summary>Token key for the muted dot of the neutral states (web <c>--surface-2</c>).</summary>
    public const string MutedBrushKey = "TsColorTextMutedBrush";

    /// <summary>Token key for the faint neutral chip background (web <c>white/[0.03]</c>).</summary>
    public const string NeutralBackgroundBrushKey = "TsColorSurfaceGlassBrush";

    /// <summary>Token key for the faint neutral chip border (web <c>white/[0.06]</c>).</summary>
    public const string NeutralBorderBrushKey = "TsColorBorderBrush";

    /// <summary>
    /// Resolve the palette for <paramref name="status"/> — reproduces the web <c>statusStyles</c> map
    /// (web L21-L42): ok/warning/error are tinted semantic accents, inactive/unknown share the neutral
    /// muted-surface treatment.
    /// </summary>
    public static WidgetStatusPalette For(WidgetStatusKind status) => status switch
    {
        WidgetStatusKind.Ok => new WidgetStatusPalette(SuccessBrushKey, SuccessBrushKey, SuccessBrushKey, Tinted: true),
        WidgetStatusKind.Warning => new WidgetStatusPalette(WarningBrushKey, WarningBrushKey, WarningBrushKey, Tinted: true),
        WidgetStatusKind.Error => new WidgetStatusPalette(DangerBrushKey, DangerBrushKey, DangerBrushKey, Tinted: true),
        _ => new WidgetStatusPalette(MutedBrushKey, NeutralBackgroundBrushKey, NeutralBorderBrushKey, Tinted: false),
    };
}

/// <summary>
/// The render-ready projection of one <see cref="WidgetStatusCell"/> — every value the WinUI view needs to
/// draw a chip without re-deriving anything: the resolved text, the palette keys, whether the value/icon are
/// shown and the composed Narrator name.
/// </summary>
public sealed class WidgetStatusCellDisplay
{
    internal WidgetStatusCellDisplay(
        string id,
        string label,
        string value,
        bool hasValue,
        string iconGlyph,
        bool hasIcon,
        WidgetStatusKind status,
        WidgetStatusPalette palette,
        string accessibleName)
    {
        Id = id;
        Label = label;
        Value = value;
        HasValue = hasValue;
        IconGlyph = iconGlyph;
        HasIcon = hasIcon;
        Status = status;
        Palette = palette;
        AccessibleName = accessibleName;
    }

    /// <summary>Stable identity (web <c>id</c>).</summary>
    public string Id { get; }

    /// <summary>Localized caption (web <c>label</c>).</summary>
    public string Label { get; }

    /// <summary>Localized value text; empty when none or when the grid is compact.</summary>
    public string Value { get; }

    /// <summary>True when <see cref="Value"/> should be drawn (web <c>!compact &amp;&amp; cell.value</c>).</summary>
    public bool HasValue { get; }

    /// <summary>Leading Segoe Fluent Icons glyph; empty when none.</summary>
    public string IconGlyph { get; }

    /// <summary>True when <see cref="IconGlyph"/> should be drawn (web <c>cell.icon</c>).</summary>
    public bool HasIcon { get; }

    /// <summary>The status colour treatment (web <c>status</c>).</summary>
    public WidgetStatusKind Status { get; }

    /// <summary>The resolved palette keys for the chip (web <c>statusStyles[status]</c>).</summary>
    public WidgetStatusPalette Palette { get; }

    /// <summary>The composed Narrator name (label, plus the value when it is shown).</summary>
    public string AccessibleName { get; }
}

/// <summary>
/// The render-ready projection of the whole grid — which branch to draw, the projected cells, the resolved
/// column request + compact flag (the view collapses these against its measured width via
/// <see cref="WidgetStatusGridLayout"/>) and the empty-surface copy.
/// </summary>
public sealed class WidgetStatusGridDisplay
{
    internal WidgetStatusGridDisplay(
        WidgetStatusGridState state,
        IReadOnlyList<WidgetStatusCellDisplay> cells,
        int requestedColumns,
        bool compact,
        string emptyMessage,
        string emptyIconGlyph)
    {
        State = state;
        Cells = cells;
        RequestedColumns = requestedColumns;
        Compact = compact;
        EmptyMessage = emptyMessage;
        EmptyIconGlyph = emptyIconGlyph;
    }

    /// <summary>Which render branch this projection represents.</summary>
    public WidgetStatusGridState State { get; }

    /// <summary>The projected cells (empty in the <see cref="WidgetStatusGridState.Empty"/> branch).</summary>
    public IReadOnlyList<WidgetStatusCellDisplay> Cells { get; }

    /// <summary>The clamped requested column count (2, 3 or 4) before any width-based collapse.</summary>
    public int RequestedColumns { get; }

    /// <summary>True when the grid is compact (forces two columns, hides values).</summary>
    public bool Compact { get; }

    /// <summary>The localized empty-surface message (web <c>emptyMessage</c>).</summary>
    public string EmptyMessage { get; }

    /// <summary>The empty-surface glyph; empty when none (web <c>emptyIcon</c>).</summary>
    public string EmptyIconGlyph { get; }

    /// <summary>True while the empty surface is showing.</summary>
    public bool IsEmpty => State == WidgetStatusGridState.Empty;

    /// <summary>True while the populated grid is showing.</summary>
    public bool IsPopulated => State == WidgetStatusGridState.Populated;

    /// <summary>True when an empty-surface glyph should be drawn.</summary>
    public bool HasEmptyIcon => !string.IsNullOrEmpty(EmptyIconGlyph);

    /// <summary>The number of projected cells.</summary>
    public int Count => Cells.Count;

    /// <summary>The base column count after applying compact (web <c>compact ? 2 : cols</c>).</summary>
    public int BaseColumns => WidgetStatusGridLayout.ResolveBaseColumns(RequestedColumns, Compact);
}

/// <summary>
/// The responsive column maths — the native port of the web container-query class table (web L44-L50).
/// The web grid collapses on its own rendered width via <c>@xs</c> / <c>@sm</c> container queries; WinUI has
/// no container queries, so the view measures its width and asks <see cref="ResolveColumns"/> for the column
/// count, reproducing the exact breakpoints. Kept here (UI-thread-free) so the breakpoints are unit-tested.
/// </summary>
public static class WidgetStatusGridLayout
{
    /// <summary>Tailwind container <c>@xs</c> breakpoint (20rem) in effective pixels.</summary>
    public const double XsWidthPx = 320;

    /// <summary>Tailwind container <c>@sm</c> breakpoint (24rem) in effective pixels.</summary>
    public const double SmWidthPx = 384;

    /// <summary>Clamp an arbitrary requested column count to the web-supported 2 / 3 / 4 (web type <c>2 | 3 | 4</c>).</summary>
    public static int ClampColumns(int cols) => cols <= 2 ? 2 : cols >= 4 ? 4 : 3;

    /// <summary>The base column count after applying compact (web <c>resolvedCols = compact ? 2 : cols</c>, L63).</summary>
    public static int ResolveBaseColumns(int requestedColumns, bool compact) =>
        compact ? 2 : ClampColumns(requestedColumns);

    /// <summary>
    /// The effective column count for a measured <paramref name="availableWidth"/>, reproducing the web
    /// container-query table (web L46-L50):
    /// base 2 → always 2; base 3 → 1 below <see cref="XsWidthPx"/>, 2 below <see cref="SmWidthPx"/>, else 3;
    /// base 4 → 2 below <see cref="SmWidthPx"/>, else 4. An unmeasured width (≤ 0) yields the base count so
    /// the first frame never flashes a single collapsed column.
    /// </summary>
    public static int ResolveColumns(int requestedColumns, bool compact, double availableWidth)
    {
        int baseColumns = ResolveBaseColumns(requestedColumns, compact);
        if (availableWidth <= 0)
        {
            return baseColumns;
        }

        return baseColumns switch
        {
            3 => availableWidth >= SmWidthPx ? 3 : availableWidth >= XsWidthPx ? 2 : 1,
            4 => availableWidth >= SmWidthPx ? 4 : 2,
            _ => 2,
        };
    }
}

/// <summary>
/// Canonical metadata + localized copy for the grid primitive — the native analogue of the module-level
/// identity and the single default string in the web <c>WidgetStatusGrid</c> (web L56,
/// <c>emptyMessage = 'No status data available'</c>). The web default is a hard-coded prop default with no
/// dedicated i18n key, so the primitive resolves its fallback through the shared generic
/// <c>common.noData</c> catalog key (P1/S10); consuming widgets pass a specific localized message via
/// <see cref="WidgetStatusGridInput.EmptyMessage"/>.
/// </summary>
public static class WidgetStatusGridRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "WidgetStatusGrid";

    /// <summary>i18n key for the default empty message (shared generic <c>common.noData</c>).</summary>
    public const string EmptyMessageKey = "translation.common.noData";

    /// <summary>English fallback for <see cref="EmptyMessageKey"/> — matches the en catalog value.</summary>
    public const string EmptyMessageFallback = "No data available";

    /// <summary>Resolve the default empty message through the localizer (web <c>emptyMessage</c> default).</summary>
    public static string EmptyMessage(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(EmptyMessageKey, EmptyMessageFallback);
    }
}

/// <summary>
/// Pure, UI-thread-free projection of a <see cref="WidgetStatusGridInput"/> into a render-ready
/// <see cref="WidgetStatusGridDisplay"/> — the native port of the web <c>WidgetStatusGrid</c> body
/// (web L52-L102). It reproduces the branch order exactly: an empty <c>cells</c> array yields the empty
/// surface (web L59-L61), otherwise each cell is projected with its palette, the compact value-suppression
/// (web L92) and a composed Narrator name. It touches no view framework.
/// </summary>
public static class WidgetStatusGridProjection
{
    /// <summary>
    /// Project <paramref name="input"/>, resolving the default empty message through
    /// <paramref name="localizer"/>. Null/blank cell fields are coalesced so the view never dereferences null.
    /// </summary>
    public static WidgetStatusGridDisplay Project(WidgetStatusGridInput input, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(input);
        ArgumentNullException.ThrowIfNull(localizer);

        int requestedColumns = WidgetStatusGridLayout.ClampColumns(input.Cols);
        IReadOnlyList<WidgetStatusCell> cells = input.Cells ?? [];

        // web L59-L61: cells.length === 0 → <EmptyState message={emptyMessage} icon={emptyIcon} />.
        if (cells.Count == 0)
        {
            string emptyMessage = string.IsNullOrEmpty(input.EmptyMessage)
                ? WidgetStatusGridRegistration.EmptyMessage(localizer)
                : input.EmptyMessage;

            return new WidgetStatusGridDisplay(
                WidgetStatusGridState.Empty,
                [],
                requestedColumns,
                input.Compact,
                emptyMessage,
                input.EmptyIconGlyph ?? string.Empty);
        }

        var projected = new List<WidgetStatusCellDisplay>(cells.Count);
        foreach (WidgetStatusCell cell in cells)
        {
            projected.Add(ProjectCell(cell, input.Compact));
        }

        return new WidgetStatusGridDisplay(
            WidgetStatusGridState.Populated,
            projected,
            requestedColumns,
            input.Compact,
            string.Empty,
            string.Empty);
    }

    private static WidgetStatusCellDisplay ProjectCell(WidgetStatusCell cell, bool compact)
    {
        string label = cell.Label ?? string.Empty;
        string iconGlyph = cell.IconGlyph ?? string.Empty;

        // web L92: value only renders when !compact && cell.value.
        bool hasValue = !compact && !string.IsNullOrEmpty(cell.Value);
        string value = hasValue ? cell.Value! : string.Empty;

        // The dot encodes status by colour only (web has no text alternative), so the visible label + the
        // shown value compose the Narrator name; the dot is marked decorative by the view.
        string accessibleName = hasValue ? $"{label}: {value}" : label;

        return new WidgetStatusCellDisplay(
            cell.Id ?? string.Empty,
            label,
            value,
            hasValue,
            iconGlyph,
            !string.IsNullOrEmpty(iconGlyph),
            cell.Status,
            WidgetStatusPalette.For(cell.Status),
            accessibleName);
    }
}

/// <summary>
/// PII-safe diagnostics collector for the grid primitive (P1/S11). Counts opens and emits the
/// <c>view.opened slug=WidgetStatusGrid</c> event through an optional sink; carries no payload beyond the slug.
/// </summary>
public sealed class WidgetStatusGridDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public WidgetStatusGridDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=WidgetStatusGrid</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={WidgetStatusGridRegistration.Slug}");
    }
}
