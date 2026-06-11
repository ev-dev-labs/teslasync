// Per-surface sub-namespace isolation (the same pattern VisuallyHidden uses): the chart-sync
// primitive introduces general names (CursorSyncValue, ChartSyncMethod, CursorSyncStore, ...) that
// must not collide with the flat TeslaSync.App.SharedSurfaces namespace shared by sibling surfaces.
namespace TeslaSync.App.SharedSurfaces.ChartTimeRangeContextSurface;

/// <summary>
/// Canonical metadata for the ChartTimeRangeContext shared surface — the native analogue of the
/// module-level identifiers in web/src/components/charts/ChartTimeRangeContext.tsx and its companion
/// external store web/src/components/charts/cursorSync.ts. The web surface is anonymous (it renders no
/// titles or labels of its own — it is a context provider that returns its children unchanged), so this
/// carries only the diagnostics slug the surface registers under (P1/S11).
/// </summary>
public static class ChartTimeRangeContextRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "ChartTimeRangeContext";
}

/// <summary>
/// Recharts cursor/brush sync strategy — the native analogue of the web
/// <c>ChartSyncContextValue.syncMethod</c> union <c>'index' | 'value'</c>
/// (web/src/components/charts/ChartTimeRangeContext.tsx). <see cref="Index"/> matches participating
/// charts by row index (fast, correct when every chart shares the same dataset); <see cref="Value"/>
/// matches by X-axis value (required when datasets differ in length).
/// </summary>
public enum ChartSyncMethod
{
    /// <summary>web <c>'index'</c> — the default; matches by row index across charts sharing a dataset.</summary>
    Index,

    /// <summary>web <c>'value'</c> — matches by X-axis value; required when datasets differ in length.</summary>
    Value,
}

/// <summary>
/// Wire helpers for <see cref="ChartSyncMethod"/> so the enum round-trips through the exact web string
/// literals (<c>'index'</c> / <c>'value'</c>) recharts expects on its <c>syncMethod</c> prop. Kept static
/// and side-effect-free so the mapping is unit-testable without a provider instance.
/// </summary>
public static class ChartSyncMethods
{
    /// <summary>web <c>'index'</c> literal.</summary>
    public const string IndexWire = "index";

    /// <summary>web <c>'value'</c> literal.</summary>
    public const string ValueWire = "value";

    /// <summary>Render the recharts wire string for <paramref name="method"/>.</summary>
    public static string ToWire(ChartSyncMethod method) =>
        method == ChartSyncMethod.Value ? ValueWire : IndexWire;

    /// <summary>
    /// Parse a recharts wire string into a <see cref="ChartSyncMethod"/>. Accepts <c>'index'</c> / <c>'value'</c>
    /// case-insensitively (returning <c>true</c>); any other input yields <c>false</c> and leaves
    /// <paramref name="method"/> at the <see cref="ChartSyncMethod.Index"/> default — mirroring the web prop
    /// default <c>syncMethod = 'index'</c>.
    /// </summary>
    public static bool TryParse(string? wire, out ChartSyncMethod method)
    {
        if (string.Equals(wire, ValueWire, StringComparison.OrdinalIgnoreCase))
        {
            method = ChartSyncMethod.Value;
            return true;
        }

        method = ChartSyncMethod.Index;
        return string.Equals(wire, IndexWire, StringComparison.OrdinalIgnoreCase);
    }
}

/// <summary>The discriminant of a <see cref="CursorSyncValue"/> (the web union arm).</summary>
public enum CursorSyncValueKind
{
    /// <summary>web <c>null</c> — no chart in the synced group has been hovered yet.</summary>
    None,

    /// <summary>web <c>string</c> — a formatted X-axis label (e.g. <c>'12:34'</c>).</summary>
    Text,

    /// <summary>web <c>number</c> — a raw X-axis value (e.g. an epoch timestamp).</summary>
    Number,
}

/// <summary>
/// The persistent cursor X value shared across synced charts — the native port of the web
/// <c>CursorSyncValue = string | number | null</c> union (web/src/components/charts/cursorSync.ts).
/// Recharts' active hover label is either a formatted string or a raw number, and is cleared to "none"
/// when the cursor leaves every participating chart, so this discriminated value models all three arms
/// with value equality (so the store's "no-op when unchanged" guard mirrors the web <c>current === value</c>
/// comparison exactly).
/// </summary>
public readonly record struct CursorSyncValue
{
    private readonly string? _text;
    private readonly double _number;

    private CursorSyncValue(CursorSyncValueKind kind, string? text, double number)
    {
        Kind = kind;
        _text = text;
        _number = number;
    }

    /// <summary>web <c>null</c> — the absent value (also the <c>default</c> of this struct).</summary>
    public static CursorSyncValue None => default;

    /// <summary>The arm this value carries.</summary>
    public CursorSyncValueKind Kind { get; }

    /// <summary><c>true</c> when this is the web <c>null</c> arm.</summary>
    public bool IsNone => Kind == CursorSyncValueKind.None;

    /// <summary>The string label when <see cref="Kind"/> is <see cref="CursorSyncValueKind.Text"/>; otherwise <c>null</c>.</summary>
    public string? Text => Kind == CursorSyncValueKind.Text ? _text : null;

    /// <summary>The numeric value when <see cref="Kind"/> is <see cref="CursorSyncValueKind.Number"/>; otherwise <c>null</c>.</summary>
    public double? Number => Kind == CursorSyncValueKind.Number ? _number : null;

    /// <summary>Wrap a string X-axis label (the web <c>string</c> arm).</summary>
    public static CursorSyncValue OfText(string value)
    {
        ArgumentNullException.ThrowIfNull(value);
        return new CursorSyncValue(CursorSyncValueKind.Text, value, 0d);
    }

    /// <summary>Wrap a numeric X-axis value (the web <c>number</c> arm).</summary>
    public static CursorSyncValue OfNumber(double value) =>
        new(CursorSyncValueKind.Number, null, value);

    /// <summary>The human-readable form (the label text, the number, or an em dash for the none arm).</summary>
    public override string ToString() => Kind switch
    {
        CursorSyncValueKind.Text => _text ?? string.Empty,
        CursorSyncValueKind.Number => _number.ToString(System.Globalization.CultureInfo.InvariantCulture),
        _ => "\u2014",
    };
}

/// <summary>
/// A recharts mouse-move state — the native port of the web <c>RechartsMouseState</c> interface
/// (web/src/components/charts/ChartTimeRangeContext.tsx), whose only field of interest is the optional
/// <c>activeLabel</c>. An <see cref="Empty"/> state (no active label) clears the synced cursor, mirroring
/// the web <c>state?.activeLabel ?? null</c> coalesce.
/// </summary>
public readonly record struct ChartMouseState
{
    /// <summary>Creates a mouse state carrying <paramref name="activeLabel"/> as the active X-axis label.</summary>
    public ChartMouseState(CursorSyncValue activeLabel) => ActiveLabel = activeLabel;

    /// <summary>The active X-axis label under the cursor (web <c>activeLabel</c>); <see cref="CursorSyncValue.None"/> when absent.</summary>
    public CursorSyncValue ActiveLabel { get; }

    /// <summary>A mouse state with no active label (web <c>activeLabel === undefined</c>).</summary>
    public static ChartMouseState Empty => default;

    /// <summary>A mouse state carrying <paramref name="activeLabel"/>.</summary>
    public static ChartMouseState WithActiveLabel(CursorSyncValue activeLabel) => new(activeLabel);
}

/// <summary>
/// The recharts sync context value — the native port of the web <c>ChartSyncContextValue</c>
/// (web/src/components/charts/ChartTimeRangeContext.tsx): the stable <see cref="SyncId"/> passed to every
/// descendant chart's <c>syncId</c> prop plus the <see cref="SyncMethod"/>. Value-equatable so consumers can
/// cheaply detect when the context they read has actually changed.
/// </summary>
public readonly record struct ChartSyncContextValue(string SyncId, ChartSyncMethod SyncMethod);

/// <summary>
/// The props ready to spread onto a recharts chart — the native port of the web <c>SyncedCursorProps</c>
/// returned by <c>useSyncedCursor</c> (web/src/components/charts/ChartTimeRangeContext.tsx). Inside a
/// provider it carries the <see cref="SyncId"/>, <see cref="SyncMethod"/> and an <see cref="OnMouseMove"/>
/// handler that feeds the active X-axis label into the cursor-sync store; outside a provider it is
/// <see cref="Empty"/> (the web empty object <c>{}</c>), so a chart can opt in unconditionally without
/// crashing on standalone use.
/// </summary>
public sealed class SyncedCursorProps
{
    private SyncedCursorProps()
    {
    }

    /// <summary>Creates the populated props (inside a provider).</summary>
    public SyncedCursorProps(string syncId, ChartSyncMethod syncMethod, Action<ChartMouseState?> onMouseMove)
    {
        ArgumentException.ThrowIfNullOrEmpty(syncId);
        ArgumentNullException.ThrowIfNull(onMouseMove);
        SyncId = syncId;
        SyncMethod = syncMethod;
        OnMouseMove = onMouseMove;
    }

    /// <summary>The empty props returned outside a provider (the web <c>{}</c>).</summary>
    public static SyncedCursorProps Empty { get; } = new();

    /// <summary>The recharts <c>syncId</c>; <c>null</c> outside a provider.</summary>
    public string? SyncId { get; }

    /// <summary>The recharts <c>syncMethod</c>; <c>null</c> outside a provider.</summary>
    public ChartSyncMethod? SyncMethod { get; }

    /// <summary>The recharts <c>onMouseMove</c> handler; <c>null</c> outside a provider.</summary>
    public Action<ChartMouseState?>? OnMouseMove { get; }

    /// <summary><c>true</c> when these are the empty props returned outside a provider.</summary>
    public bool IsEmpty => SyncId is null;
}

/// <summary>
/// PII-safe diagnostics for the ChartTimeRangeContext surface (P1/S11 diagnostics contract). The synced
/// cursor value can carry user-facing X-axis labels, so the collector records only the operational
/// <c>view.opened</c> event with the surface slug — never the cursor position itself. Thread-safe.
/// </summary>
public sealed class ChartTimeRangeContextDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public ChartTimeRangeContextDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ChartTimeRangeContext</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={ChartTimeRangeContextRegistration.Slug}");
    }
}
