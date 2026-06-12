using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata for the <c>Toast</c> shared surface — the native analogue of the literals and helpers in
/// web/src/components/feedback/Toast.tsx (and its companion web/src/api/hooks/_toastHelpers.ts). It carries the
/// diagnostics slug, the overlay automation id, the queue policy (the web <c>setToasts(prev =&gt; [...prev.slice(-4),
/// next])</c> five-toast cap and the <c>opts.duration ?? 4000</c> default), the per-variant ARIA role contract
/// (web <c>ariaRole</c>: <c>error</c> → <c>alert</c>/assertive, the rest → <c>status</c>/polite), the i18n keys
/// (each with the English fallback the web renders verbatim — the dismiss button's <c>aria-label</c> and the
/// <c>useMutationToast</c> default error message), and the variant → web <c>ToastType</c> slug map used for
/// PII-safe diagnostics. The glyph, accent brush and assertiveness are reused from the shared
/// <see cref="CalloutVariants"/> family so the toast tones stay aligned with the rest of the callout surfaces.
/// UI-free so it is asserted headlessly.
/// </summary>
public static class ToastRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "Toast";

    /// <summary>The automation id Narrator and UI-automation resolve the toast overlay region by.</summary>
    public const string RegionAutomationId = "toast-region";

    /// <summary>
    /// Maximum number of toasts shown at once. The web provider keeps <c>[...prev.slice(-4), next]</c> — the last
    /// four previous toasts plus the new one — so at most five are ever visible and the oldest is dropped first.
    /// </summary>
    public const int MaxVisible = 5;

    /// <summary>Default auto-dismiss lifetime in milliseconds (web <c>const duration = opts.duration ?? 4000</c>).</summary>
    public const int DefaultDurationMs = 4000;

    /// <summary>Id prefix for queued toasts (web <c>`toast-${++toastCounter}`</c>).</summary>
    public const string IdPrefix = "toast-";

    /// <summary>ARIA role for an assertive (interrupting) toast — the web <c>error</c> variant's <c>role="alert"</c>.</summary>
    public const string AlertRole = "alert";

    /// <summary>ARIA role for a polite toast — the web <c>success</c>/<c>info</c>/<c>warning</c> <c>role="status"</c>.</summary>
    public const string StatusRole = "status";

    /// <summary>Trailing affordance the web navigation action appends to its label (<c>{label} →</c>).</summary>
    public const string NavigationActionSuffix = " \u2192";

    /// <summary>Segoe Fluent "Cancel" glyph — the native stand-in for the web Lucide <c>X</c> dismiss icon.</summary>
    public const string DismissGlyph = "\uE711";

    /// <summary>i18n key for the dismiss button's accessible name (web <c>aria-label="Dismiss notification"</c>).</summary>
    public const string DismissLabelKey = "translation.toast.dismiss";

    /// <summary>English fallback for <see cref="DismissLabelKey"/> — the web <c>aria-label</c>, verbatim.</summary>
    public const string DismissLabelFallback = "Dismiss notification";

    /// <summary>
    /// i18n key for the default <c>useMutationToast().error()</c> title (web <c>_toastHelpers.ts</c>
    /// <c>key = 'toast.common.error'</c>).
    /// </summary>
    public const string MutationErrorKey = "translation.toast.common.error";

    /// <summary>English fallback for <see cref="MutationErrorKey"/> — the web default, verbatim.</summary>
    public const string MutationErrorFallback = "Something went wrong";

    /// <summary>
    /// The web <c>ToastType</c> string for a variant (PII-free, used by diagnostics): the toast tone, never its
    /// user-supplied title/message. The web <c>error</c> tone is the native <see cref="CalloutVariant.Danger"/>.
    /// </summary>
    /// <param name="variant">The toast tone.</param>
    public static string VariantSlug(CalloutVariant variant) => variant switch
    {
        CalloutVariant.Success => "success",
        CalloutVariant.Danger => "error",
        CalloutVariant.Warning => "warning",
        _ => "info",
    };

    /// <summary>
    /// The ARIA role a toast of the given variant exposes, reproducing the web <c>ariaRole</c> map: the assertive
    /// <c>error</c> variant announces as <see cref="AlertRole"/>, every other (polite) variant as
    /// <see cref="StatusRole"/>. Derived from <see cref="CalloutVariants.IsAssertive"/> so the toast urgency stays
    /// aligned with the shared callout family.
    /// </summary>
    /// <param name="variant">The toast tone.</param>
    public static string Role(CalloutVariant variant) =>
        CalloutVariants.IsAssertive(variant) ? AlertRole : StatusRole;

    /// <summary>Resolve the localized dismiss-button accessible name (web <c>aria-label="Dismiss notification"</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string ResolveDismissLabel(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(DismissLabelKey, DismissLabelFallback);
    }

    /// <summary>Resolve the localized default mutation-error title (web <c>t('toast.common.error', …)</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string ResolveMutationErrorTitle(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(MutationErrorKey, MutationErrorFallback);
    }
}

/// <summary>
/// An optional action rendered in a toast body — the native analogue of the web <c>ToastAction</c>
/// (web/src/components/feedback/Toast.tsx L52-63). Two flavours, discriminated by which field is set: a
/// <em>navigation</em> action (<see cref="Route"/> set → the web <c>{ label, to }</c> <c>&lt;Link&gt;</c>) or a
/// <em>callback</em> action (<see cref="OnClick"/> set → the web <c>{ label, onClick }</c> <c>&lt;button&gt;</c>).
/// Exactly as in the web source, the navigation form wins when both are supplied so existing call-sites stay
/// intact. WinUI-free (the route is a plain string and the callback a plain delegate) so it is unit-tested without
/// a UI host; the view turns it into a hyperlink or a button.
/// </summary>
public sealed record ToastActionModel
{
    /// <summary>Visible label, e.g. "View" or "Undo" (web <c>ToastAction.label</c>).</summary>
    public required string Label { get; init; }

    /// <summary>
    /// In-app navigation target (path + query) — the web <c>ToastAction.to</c>. When set, the action is a
    /// navigation hyperlink; the view raises its navigation request rather than hard-wiring a navigation service.
    /// Mutually exclusive with <see cref="OnClick"/>; the navigation form wins when both are present.
    /// </summary>
    public string? Route { get; init; }

    /// <summary>Callback invoked when a callback action is clicked (web <c>ToastAction.onClick</c>).</summary>
    public Action? OnClick { get; init; }

    /// <summary>True when this is the navigation flavour (web <c>t.action.to</c> wins over <c>onClick</c>).</summary>
    public bool IsNavigation => Route is not null;

    /// <summary>True when the action renders at all (web renders nothing when neither <c>to</c> nor <c>onClick</c> is set).</summary>
    public bool IsRenderable => Route is not null || OnClick is not null;

    /// <summary>
    /// The label as shown: the navigation flavour appends the web "→" affordance (<c>{label} →</c>); the callback
    /// flavour shows the bare label.
    /// </summary>
    public string DisplayLabel => IsNavigation ? Label + ToastRegistration.NavigationActionSuffix : Label;
}

/// <summary>
/// The inputs for enqueuing a toast — the native analogue of the web <c>Omit&lt;Toast, 'id'&gt;</c> the
/// <c>toast(opts)</c> entry point accepts (web/src/components/feedback/Toast.tsx L75, L138-145). The controller
/// assigns the id and resolves <see cref="Duration"/> (a null duration becomes the web 4000 ms default). Pure
/// data so the queue policy is unit-tested headlessly.
/// </summary>
public sealed record ToastRequest
{
    /// <summary>The toast tone (web <c>ToastType</c>; <c>error</c> ↔ <see cref="CalloutVariant.Danger"/>).</summary>
    public required CalloutVariant Variant { get; init; }

    /// <summary>The bold primary line (web <c>Toast.title</c>). Already localized by the caller, as on the web.</summary>
    public required string Title { get; init; }

    /// <summary>The optional secondary line (web <c>Toast.message</c>).</summary>
    public string? Message { get; init; }

    /// <summary>
    /// The auto-dismiss lifetime. <see langword="null"/> resolves to the web 4000 ms default; a non-positive value
    /// means the toast is persistent (web <c>if (duration &gt; 0) setTimeout(...)</c>).
    /// </summary>
    public TimeSpan? Duration { get; init; }

    /// <summary>The optional action (web <c>Toast.action</c>).</summary>
    public ToastActionModel? Action { get; init; }
}

/// <summary>
/// One queued toast — the native analogue of the web <c>Toast</c> interface
/// (web/src/components/feedback/Toast.tsx L65-72) after the provider has assigned the id and resolved the
/// duration. Pure data so the queue is reasoned about without a UI host.
/// </summary>
public sealed record ToastItem
{
    /// <summary>The queue id (web <c>`toast-${++toastCounter}`</c>).</summary>
    public required string Id { get; init; }

    /// <summary>The toast tone.</summary>
    public required CalloutVariant Variant { get; init; }

    /// <summary>The bold primary line.</summary>
    public required string Title { get; init; }

    /// <summary>The optional secondary line.</summary>
    public string? Message { get; init; }

    /// <summary>The resolved auto-dismiss lifetime (the web 4000 ms default already applied).</summary>
    public required TimeSpan Duration { get; init; }

    /// <summary>The optional action.</summary>
    public ToastActionModel? Action { get; init; }

    /// <summary>
    /// Whether the toast auto-dismisses (web <c>if (duration &gt; 0)</c>): a positive duration arms the one-shot
    /// dismiss timer, a non-positive one leaves the toast persistent.
    /// </summary>
    public bool AutoDismisses => Duration > TimeSpan.Zero;
}

/// <summary>
/// The fully projected, render-ready view of a single <see cref="ToastItem"/> — everything the web component
/// derives per toast before returning JSX (web/src/components/feedback/Toast.tsx L161-231): the tone's leading
/// <see cref="Glyph"/>, the <see cref="AccentBrushKey"/>/<see cref="AccentColorKey"/> the icon, action and border
/// tint from, the ARIA <see cref="Role"/> + <see cref="IsAssertive"/> live urgency, the optional
/// <see cref="ToastActionModel"/>, and the <see cref="AccessibleName"/> a screen reader announces (the web toast
/// div is <c>aria-atomic</c>, so title + message are announced as one). Pure value so every field is asserted
/// headlessly.
/// </summary>
public sealed record ToastItemProjection
{
    private ToastItemProjection(
        string id,
        CalloutVariant variant,
        string title,
        string? message,
        TimeSpan duration,
        ToastActionModel? action,
        string accessibleName)
    {
        Id = id;
        Variant = variant;
        Title = title;
        Message = message;
        Duration = duration;
        Action = action;
        AccessibleName = accessibleName;
    }

    /// <summary>The queue id.</summary>
    public string Id { get; }

    /// <summary>The toast tone.</summary>
    public CalloutVariant Variant { get; }

    /// <summary>The bold primary line (web <c>t.title</c>).</summary>
    public string Title { get; }

    /// <summary>The optional secondary line (web <c>t.message</c>).</summary>
    public string? Message { get; }

    /// <summary>The resolved auto-dismiss lifetime.</summary>
    public TimeSpan Duration { get; }

    /// <summary>The optional action.</summary>
    public ToastActionModel? Action { get; }

    /// <summary>The accessible name a screen reader announces (title, then ". " + message when present).</summary>
    public string AccessibleName { get; }

    /// <summary>True when a secondary message line is shown (web <c>{t.message &amp;&amp; …}</c>).</summary>
    public bool HasMessage => !string.IsNullOrEmpty(Message);

    /// <summary>True when a renderable action is shown (web <c>{t.action &amp;&amp; (… ? Link : … ? button : null)}</c>).</summary>
    public bool HasAction => Action is { IsRenderable: true };

    /// <summary>Whether the toast auto-dismisses (web <c>duration &gt; 0</c>).</summary>
    public bool AutoDismisses => Duration > TimeSpan.Zero;

    /// <summary>The leading Segoe Fluent glyph for the tone (web per-type Lucide icon).</summary>
    public string Glyph => CalloutVariants.Glyph(Variant);

    /// <summary>The theme-aware accent brush key the icon, action and border tint from.</summary>
    public string AccentBrushKey => CalloutVariants.AccentBrushKey(Variant);

    /// <summary>The accent <em>colour</em> token key (for the alpha-tinted border/background), paired with <see cref="AccentBrushKey"/>.</summary>
    public string AccentColorKey => ToastColors.AccentColorKey(Variant);

    /// <summary>The ARIA role the toast exposes (web <c>error</c> → alert, else status).</summary>
    public string Role => ToastRegistration.Role(Variant);

    /// <summary>Whether the toast announces assertively (web <c>error</c> → <c>aria-live="assertive"</c>).</summary>
    public bool IsAssertive => CalloutVariants.IsAssertive(Variant);

    /// <summary>
    /// Project one queued toast into a render-ready value, reproducing the web per-toast derivation
    /// (web/src/components/feedback/Toast.tsx L161-231). The accessible name folds the title and the optional
    /// message into a single atomic announcement (the web toast div is <c>aria-atomic="true"</c>).
    /// </summary>
    /// <param name="item">The queued toast.</param>
    public static ToastItemProjection Project(ToastItem item)
    {
        ArgumentNullException.ThrowIfNull(item);

        var accessibleName = string.IsNullOrEmpty(item.Message)
            ? item.Title
            : $"{item.Title}. {item.Message}";

        return new ToastItemProjection(
            id: item.Id,
            variant: item.Variant,
            title: item.Title,
            message: item.Message,
            duration: item.Duration,
            action: item.Action,
            accessibleName: accessibleName);
    }
}

/// <summary>
/// The fully projected, render-ready view of the whole toast queue — everything the web
/// <c>&lt;ToastProvider&gt;</c> overlay needs (web/src/components/feedback/Toast.tsx L156-235): the ordered
/// <see cref="Items"/> (oldest first, newest last, capped at <see cref="ToastRegistration.MaxVisible"/>), whether
/// the overlay currently shows anything (<see cref="HasToasts"/> — the web <c>{toasts.map(...)}</c> is empty when
/// the queue is), and the localized <see cref="DismissLabel"/> shared by every card's dismiss button. Pure value
/// so the projection is asserted headlessly.
/// </summary>
public sealed record ToastProjection
{
    private ToastProjection(IReadOnlyList<ToastItemProjection> items, string dismissLabel)
    {
        Items = items;
        DismissLabel = dismissLabel;
    }

    /// <summary>The ordered render-ready toasts (oldest first; the newest is appended last, as on the web).</summary>
    public IReadOnlyList<ToastItemProjection> Items { get; }

    /// <summary>The localized dismiss-button accessible name shared by every card.</summary>
    public string DismissLabel { get; }

    /// <summary>True while the overlay shows at least one toast (web <c>toasts.length &gt; 0</c>).</summary>
    public bool HasToasts => Items.Count > 0;

    /// <summary>The number of toasts currently shown.</summary>
    public int Count => Items.Count;

    /// <summary>The empty overlay — no toasts, only the localized dismiss label resolved and ready.</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static ToastProjection Empty(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return new ToastProjection(Array.Empty<ToastItemProjection>(), ToastRegistration.ResolveDismissLabel(localizer));
    }

    /// <summary>
    /// Project the current queue into a render-ready overlay value, reproducing the web overlay
    /// (web/src/components/feedback/Toast.tsx L156-235): each queued toast becomes a
    /// <see cref="ToastItemProjection"/> in order, and the shared dismiss label is resolved once.
    /// </summary>
    /// <param name="items">The current queue (oldest first).</param>
    /// <param name="localizer">The i18n facade the dismiss label resolves through.</param>
    public static ToastProjection Project(IReadOnlyList<ToastItem> items, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(items);
        ArgumentNullException.ThrowIfNull(localizer);

        var projected = new ToastItemProjection[items.Count];
        for (var i = 0; i < items.Count; i++)
        {
            projected[i] = ToastItemProjection.Project(items[i]);
        }

        return new ToastProjection(projected, ToastRegistration.ResolveDismissLabel(localizer));
    }
}

/// <summary>
/// Pairs a <see cref="CalloutVariant"/> with its accent <em>colour</em> token key, the companion of
/// <see cref="CalloutVariants.AccentBrushKey"/>. The toast border and glow are alpha-tinted over the accent colour
/// (the web <c>border-emerald-500/30</c> / <c>shadow-[…/0.15]</c>), which needs a raw <c>Color</c> token rather
/// than a fully-opaque brush. Kept UI-free so the mapping is unit-tested without a XAML runtime.
/// </summary>
public static class ToastColors
{
    /// <summary>The generated accent colour token key for the variant (paired with the brush key).</summary>
    /// <param name="variant">The toast tone.</param>
    public static string AccentColorKey(CalloutVariant variant) => variant switch
    {
        CalloutVariant.Success => "TsColorSuccessColor",
        CalloutVariant.Warning => "TsColorWarningColor",
        CalloutVariant.Danger => "TsColorDangerColor",
        _ => "TsColorInfoColor",
    };
}

/// <summary>
/// PII-safe diagnostics for the Toast surface (P1/S11 diagnostics contract). Toast titles and messages are
/// user/operation content, so the collector NEVER records them — it records only the operational
/// <c>view.opened</c> event (when the overlay mounts) and PII-free <c>toast.shown</c>/<c>toast.dismissed</c>
/// counters tagged with the variant <em>slug</em> (the tone, e.g. <c>success</c>/<c>error</c>) and never the
/// content. Thread-safe; mirrors the peer surfaces' diagnostics collectors.
/// </summary>
public sealed class ToastDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;
    private long _toastsShown;
    private long _toastsDismissed;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink each diagnostic line is written to, or null.</param>
    public ToastDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the overlay surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Number of toasts shown (enqueued) since construction.</summary>
    public long ToastsShown => Interlocked.Read(ref _toastsShown);

    /// <summary>Number of toasts dismissed (auto or manual) since construction.</summary>
    public long ToastsDismissed => Interlocked.Read(ref _toastsDismissed);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=Toast</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={ToastRegistration.Slug}");
    }

    /// <summary>Record that a toast was shown, emitting <c>toast.shown slug=Toast variant=&lt;tone&gt;</c> (no content).</summary>
    /// <param name="variant">The toast tone (never the title/message).</param>
    public void RecordToastShown(CalloutVariant variant)
    {
        Interlocked.Increment(ref _toastsShown);
        _sink?.Invoke($"toast.shown slug={ToastRegistration.Slug} variant={ToastRegistration.VariantSlug(variant)}");
    }

    /// <summary>Record that a toast was dismissed, emitting <c>toast.dismissed slug=Toast</c> (no content).</summary>
    public void RecordToastDismissed()
    {
        Interlocked.Increment(ref _toastsDismissed);
        _sink?.Invoke($"toast.dismissed slug={ToastRegistration.Slug}");
    }
}
