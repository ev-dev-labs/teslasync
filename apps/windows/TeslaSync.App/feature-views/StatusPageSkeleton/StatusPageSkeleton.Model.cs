using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.SystemStatus;

/// <summary>
/// The hero region of the status loading scaffold — the web
/// <c>&lt;GlassPanel className="p-5"&gt;</c> with a <c>flex items-start gap-4</c> row
/// (web/src/features/system/components/status/StatusPageSkeleton.tsx): a rounded avatar block, a middle
/// column holding a title and subtitle block, and a right-aligned action block. Pure data so the geometry
/// is asserted headlessly, block for block, against the web source.
/// </summary>
/// <param name="Avatar">The rounded avatar block (web <c>Skeleton width="56px" height={56} rounded</c>).</param>
/// <param name="Title">The title block (web <c>Skeleton height={24} width="60%"</c>).</param>
/// <param name="Subtitle">The subtitle block (web <c>Skeleton height={14} width="40%"</c>).</param>
/// <param name="LineGap">The gap between title and subtitle (web column <c>space-y-2</c>, 8px).</param>
/// <param name="Action">The action block (web <c>Skeleton width="120px" height={36}</c>).</param>
/// <param name="ColumnGap">The gap between the avatar, the column and the action (web <c>gap-4</c>, 16px).</param>
/// <param name="Padding">The panel padding (web <c>p-5</c>, 20px).</param>
public sealed record HeroSpec(
    SkeletonBlock Avatar,
    SkeletonBlock Title,
    SkeletonBlock Subtitle,
    double LineGap,
    SkeletonBlock Action,
    double ColumnGap,
    double Padding);

/// <summary>
/// The horizontal chip bar of the status loading scaffold — the web
/// <c>&lt;div className="flex gap-2 overflow-hidden"&gt;</c> of eight pill blocks
/// (web/src/features/system/components/status/StatusPageSkeleton.tsx). The chips overflow their row and the
/// surplus is clipped (web <c>overflow-hidden</c>), so the bar never wraps or scrolls.
/// </summary>
/// <param name="Count">Number of chips (web <c>Array.from({ length: 8 })</c>).</param>
/// <param name="Chip">A single chip block (web <c>Skeleton width="92px" height={32}</c>, <c>rounded-full</c>).</param>
/// <param name="Gap">The gap between chips (web <c>gap-2</c>, 8px).</param>
public sealed record ChipBarSpec(int Count, SkeletonBlock Chip, double Gap);

/// <summary>
/// A titled list region of the status loading scaffold — the shared shape of the web health-rows, action-items
/// and resources glass panels (web/src/features/system/components/status/StatusPageSkeleton.tsx): a small title
/// block above a stack of equal full-width row blocks. Captures the panel padding, the gap below the title and
/// the inter-row gap so each panel's vertical rhythm is verified headlessly.
/// </summary>
/// <param name="Title">The title block (web <c>Skeleton height={18} width="…"</c>).</param>
/// <param name="HeaderGap">The gap between the title and the first row (web <c>mb-2</c> / <c>space-y-*</c>).</param>
/// <param name="RowCount">Number of full-width row blocks.</param>
/// <param name="Row">The row block (web <c>SkeletonRow</c>, a full-width <c>Skeleton</c>).</param>
/// <param name="RowGap">The gap between rows (web <c>space-y-1</c> / <c>space-y-2</c> / <c>space-y-3</c>).</param>
/// <param name="Padding">The panel padding (web <c>p-3</c> / <c>p-4</c>).</param>
public sealed record TitledRowsSpec(
    SkeletonBlock Title,
    double HeaderGap,
    int RowCount,
    SkeletonBlock Row,
    double RowGap,
    double Padding);

/// <summary>
/// One accordion summary row of the status loading scaffold — the web
/// <c>&lt;GlassPanel className="p-5"&gt;</c> with a <c>flex items-center gap-3</c> row, repeated four times
/// (web/src/features/system/components/status/StatusPageSkeleton.tsx): a small icon block, a middle column with
/// a title and a wider sub-line block, and a trailing block.
/// </summary>
/// <param name="Count">Number of accordion panels (web <c>Array.from({ length: 4 })</c>).</param>
/// <param name="Icon">The leading icon block (web <c>Skeleton width="20px" height={20}</c>).</param>
/// <param name="Title">The title block (web <c>Skeleton height={16} width="40%"</c>).</param>
/// <param name="Subtitle">The sub-line block (web <c>Skeleton height={12} width="60%"</c>).</param>
/// <param name="SubtitleGap">The gap above the sub-line (web <c>mt-1</c>, 4px).</param>
/// <param name="Trailing">The trailing block (web <c>Skeleton width="60px" height={24}</c>).</param>
/// <param name="ColumnGap">The gap between the icon, the column and the trailing block (web <c>gap-3</c>, 12px).</param>
/// <param name="Padding">The panel padding (web <c>p-5</c>, 20px).</param>
public sealed record AccordionSpec(
    int Count,
    SkeletonBlock Icon,
    SkeletonBlock Title,
    SkeletonBlock Subtitle,
    double SubtitleGap,
    SkeletonBlock Trailing,
    double ColumnGap,
    double Padding);

/// <summary>
/// The complete, WinUI-free layout specification for the <c>StatusPageSkeleton</c> surface — the native parity
/// projection of <c>web/src/features/system/components/status/StatusPageSkeleton.tsx</c>. The web source is a
/// pure presentational scaffold (no props, no data, no conditional branches): it renders exactly one thing, the
/// System Status page's loading chrome, so the native port has a single render path described entirely by this
/// immutable spec — a hero panel, an eight-chip bar, three titled list panels (health rows, action items,
/// resources) and four accordion summary panels, stacked with the page's <see cref="RegionSpacing"/>
/// (web <c>space-y-5</c>) inside a centred <see cref="MaxWidth"/> column (web <c>max-w-3xl mx-auto</c>). Holding
/// the geometry as data keeps the view declarative and lets the parity tests assert every dimension and count,
/// region for region, against the web source without a UI host.
/// </summary>
/// <param name="Hero">The hero panel (avatar, title/subtitle column, action).</param>
/// <param name="Chips">The eight-chip overflow-clipped bar.</param>
/// <param name="Health">The health-rows panel (title over six full-width rows).</param>
/// <param name="ActionItems">The action-items panel (title over two full-width rows).</param>
/// <param name="Resources">The resources panel (title over five full-width rows).</param>
/// <param name="Accordion">The repeated accordion summary panel (four instances).</param>
/// <param name="RegionSpacing">The gap between the stacked regions (web <c>space-y-5</c>, 20px).</param>
/// <param name="MaxWidth">The maximum content width, centred horizontally (web <c>max-w-3xl mx-auto</c>, 768px).</param>
/// <param name="OuterPadding">The padding around the whole scaffold (web outer div has none, 0px).</param>
public sealed record StatusPageSkeletonSpec(
    HeroSpec Hero,
    ChipBarSpec Chips,
    TitledRowsSpec Health,
    TitledRowsSpec ActionItems,
    TitledRowsSpec Resources,
    AccordionSpec Accordion,
    double RegionSpacing,
    double MaxWidth,
    double OuterPadding)
{
    /// <summary>
    /// The canonical scaffold geometry, transcribed field-for-field from the web source. Every literal below is
    /// the value of the corresponding web <c>Skeleton</c> prop or Tailwind spacing token, so a drift in either
    /// the web source or this port is caught by the parity tests.
    /// </summary>
    public static StatusPageSkeletonSpec Default { get; } = new(
        Hero: new HeroSpec(
            Avatar: SkeletonBlock.Fixed(56, 56, pill: true),
            Title: SkeletonBlock.Fraction(24, 0.60),
            Subtitle: SkeletonBlock.Fraction(14, 0.40),
            LineGap: 8,
            Action: SkeletonBlock.Fixed(36, 120),
            ColumnGap: 16,
            Padding: 20),
        Chips: new ChipBarSpec(
            Count: 8,
            Chip: SkeletonBlock.Fixed(32, 92, pill: true),
            Gap: 8),
        Health: new TitledRowsSpec(
            Title: SkeletonBlock.Fixed(18, 80),
            HeaderGap: 8,
            RowCount: 6,
            Row: SkeletonBlock.Stretch(44),
            RowGap: 4,
            Padding: 12),
        ActionItems: new TitledRowsSpec(
            Title: SkeletonBlock.Fixed(18, 180),
            HeaderGap: 8,
            RowCount: 2,
            Row: SkeletonBlock.Stretch(32),
            RowGap: 8,
            Padding: 16),
        Resources: new TitledRowsSpec(
            Title: SkeletonBlock.Fixed(18, 120),
            HeaderGap: 12,
            RowCount: 5,
            Row: SkeletonBlock.Stretch(28),
            RowGap: 12,
            Padding: 16),
        Accordion: new AccordionSpec(
            Count: 4,
            Icon: SkeletonBlock.Fixed(20, 20),
            Title: SkeletonBlock.Fraction(16, 0.40),
            Subtitle: SkeletonBlock.Fraction(12, 0.60),
            SubtitleGap: 4,
            Trailing: SkeletonBlock.Fixed(24, 60),
            ColumnGap: 12,
            Padding: 20),
        RegionSpacing: 20,
        MaxWidth: 768,
        OuterPadding: 0);
}

/// <summary>
/// Canonical metadata for the <c>StatusPageSkeleton</c> feature surface — the native mirror of the web component
/// at <c>web/src/features/system/components/status/StatusPageSkeleton.tsx</c>. The surface renders no text on the
/// web (its only string is the <c>aria-label="Loading system status"</c> on the <c>role="status"</c> container),
/// so the only string the native port resolves is its accessible name: the shared <c>common.loading</c> catalog
/// entry, used as the Narrator name and the live-region announcement so the page is never a silent shimmer to
/// assistive technology. UI-free so the slug and the i18n binding are asserted in tests.
/// </summary>
public static class StatusPageSkeletonRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "StatusPageSkeleton";

    /// <summary>i18n key for the surface's accessible name (the shared <c>common.loading</c> string).</summary>
    public const string LoadingKey = "common.loading";

    /// <summary>English fallback for <see cref="LoadingKey"/>.</summary>
    public const string LoadingFallback = "Loading";

    /// <summary>Resolve the surface's accessible "Loading" name through the i18n facade.</summary>
    /// <param name="localizer">The i18n facade the accessible name resolves through.</param>
    /// <returns>The localized loading name, or the English fallback when the key is unresolved.</returns>
    public static string LoadingLabel(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(LoadingKey, LoadingFallback);
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>StatusPageSkeleton</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — the scaffold carries no fleet data, so a
/// diagnostics line can never leak anything. Thread-safe.
/// </summary>
public sealed class StatusPageSkeletonDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public StatusPageSkeletonDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=StatusPageSkeleton</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={StatusPageSkeletonRegistration.Slug}");
    }
}
