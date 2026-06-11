using System.Globalization;
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// One peer that holds the edit lease for a resource — the native analogue of the web
/// <c>OtherTabInfo</c> (web/src/hooks/useEditLease.ts L58-63). Identifies the peer tab/window that announced
/// ownership and the wall-clock instant it claimed the lease, which the deterministic tiebreaker compares.
/// Pure value — no WinUI types — so the projection and the election tiebreaker are asserted headlessly.
/// </summary>
/// <param name="TabId">The stable per-tab/window identifier of the peer that holds the lease (web <c>tabId</c>).</param>
/// <param name="ClaimedAt">The wall-clock time (Unix ms) at which the peer claimed the lease (web <c>claimedAt</c>).</param>
public sealed record EditLeasePeer(string TabId, long ClaimedAt);

/// <summary>
/// One immutable edit-lease snapshot — the input the web <c>EditConflictBanner</c> reads from
/// <c>useEditLease(resourceKey)</c> (web/src/hooks/useEditLease.ts L65-73, consumed at
/// web/src/components/feedback/EditConflictBanner.tsx L47-51). <see cref="OtherTab"/> is null when this
/// tab/window owns the lease OR when no peer has announced ownership yet — both the web "not a conflict"
/// cases. Exposed by the P1/S8 <see cref="IEditLeaseSource"/> and consumed by
/// <see cref="EditConflictBannerProjection.Project"/>. Pure data — no WinUI types.
/// </summary>
/// <param name="IsOwner">Whether this tab/window currently owns the edit lease (web <c>isOwner</c>).</param>
/// <param name="OtherTab">The peer holding the lease, or null when this tab owns it / no peer announced (web <c>otherTab</c>).</param>
public sealed record EditLeaseSnapshot(bool IsOwner, EditLeasePeer? OtherTab)
{
    /// <summary>The neutral snapshot — this tab is not the owner and no peer has announced (no conflict).</summary>
    public static EditLeaseSnapshot None { get; } = new(false, null);

    /// <summary>The owner snapshot — this tab holds the lease (the banner is collapsed).</summary>
    public static EditLeaseSnapshot Owner { get; } = new(true, null);

    /// <summary>
    /// True only when a peer holds the lease and this tab does not — the web banner's render gate
    /// (<c>if (isOwner || otherTab === null) return null</c>, EditConflictBanner.tsx L51).
    /// </summary>
    public bool IsConflict => !IsOwner && OtherTab is not null;
}

/// <summary>
/// Canonical metadata for the <c>EditConflictBanner</c> shared surface — the native analogue of the literals in
/// web/src/components/feedback/EditConflictBanner.tsx. Carries the diagnostics slug, the automation ids (mirroring
/// the web <c>data-testid</c>s), the ARIA role/live contract the wrapping <c>role="status" aria-live="polite"</c>
/// div declares, the semantic <see cref="CalloutVariant"/> (the web <c>variant="warning"</c>), and the five i18n
/// keys with the verbatim English fallbacks the web <c>t()</c> calls render. It also pins the election timeout the
/// <see cref="EditLeaseCoordinator"/> waits before self-granting (the web <c>ELECTION_TIMEOUT_MS</c>). UI-free so
/// it is asserted headlessly.
/// </summary>
public static class EditConflictBannerRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "EditConflictBanner";

    /// <summary>Automation id of the banner root (web <c>data-testid="edit-conflict-banner"</c>).</summary>
    public const string BannerAutomationId = "edit-conflict-banner";

    /// <summary>Automation id of the take-over action (web <c>data-testid="edit-conflict-take-over"</c>).</summary>
    public const string TakeOverAutomationId = "edit-conflict-take-over";

    /// <summary>Automation id of the switch-hint caption (web <c>data-testid="edit-conflict-switch-hint"</c>).</summary>
    public const string SwitchHintAutomationId = "edit-conflict-switch-hint";

    /// <summary>ARIA role the wrapping div exposes — a read-only status region (web <c>role="status"</c>).</summary>
    public const string StatusRole = "status";

    /// <summary>ARIA live urgency the banner declares — a polite, non-interrupting announcement (web <c>aria-live="polite"</c>).</summary>
    public const string LiveSetting = "polite";

    /// <summary>The semantic emphasis the banner renders with — the web <c>&lt;AlertBanner variant="warning"&gt;</c>.</summary>
    public const CalloutVariant Variant = CalloutVariant.Warning;

    /// <summary>i18n key for the banner heading (web <c>t('editConflict.banner.title', …)</c>).</summary>
    public const string TitleKey = "translation.editConflict.banner.title";

    /// <summary>English fallback for <see cref="TitleKey"/> — the web literal, verbatim.</summary>
    public const string TitleFallback = "Another browser tab is editing this";

    /// <summary>i18n key for the generic body copy (web <c>t('editConflict.banner.body', …)</c>).</summary>
    public const string BodyKey = "translation.editConflict.banner.body";

    /// <summary>English fallback for <see cref="BodyKey"/> — the web literal, verbatim.</summary>
    public const string BodyFallback =
        "This resource is open in another tab of this browser. Saving here will overwrite changes made there.";

    /// <summary>i18n key for the labelled body copy (web <c>t('editConflict.banner.bodyWithLabel', …, { resource })</c>).</summary>
    public const string BodyWithLabelKey = "translation.editConflict.banner.bodyWithLabel";

    /// <summary>English fallback for <see cref="BodyWithLabelKey"/> — the web literal with the .NET positional argument (<c>{0}</c>=resource).</summary>
    public const string BodyWithLabelFallback =
        "{0} is open in another tab of this browser. Saving here will overwrite changes made there.";

    /// <summary>i18n key for the take-over action label (web <c>t('editConflict.banner.takeOver', …)</c>).</summary>
    public const string TakeOverKey = "translation.editConflict.banner.takeOver";

    /// <summary>English fallback for <see cref="TakeOverKey"/> — the web literal, verbatim.</summary>
    public const string TakeOverFallback = "Take over editing";

    /// <summary>i18n key for the switch-hint caption (web <c>t('editConflict.banner.switchHint', …)</c>).</summary>
    public const string SwitchHintKey = "translation.editConflict.banner.switchHint";

    /// <summary>English fallback for <see cref="SwitchHintKey"/> — the web literal, verbatim.</summary>
    public const string SwitchHintFallback = "Or switch to your other tab to keep editing there.";

    /// <summary>
    /// The election window the coordinator waits for an active owner to respond to its <c>lease.request</c> before
    /// it self-grants — the native analogue of the web <c>ELECTION_TIMEOUT_MS = 250</c> (useEditLease.ts L112).
    /// </summary>
    public static TimeSpan ElectionTimeout { get; } = TimeSpan.FromMilliseconds(250);

    /// <summary>The Segoe Fluent "Warning" glyph the banner leads with (the native stand-in for the web Lucide <c>AlertTriangle</c>).</summary>
    public static string Glyph => CalloutVariants.Glyph(Variant);

    /// <summary>The generated design-token accent brush key the warning chrome tints from.</summary>
    public static string AccentBrushKey => CalloutVariants.AccentBrushKey(Variant);
}

/// <summary>
/// The fully projected, render-ready view of an <see cref="EditLeaseSnapshot"/> — everything the web
/// <c>EditConflictBanner</c> derives before returning JSX (web/src/components/feedback/EditConflictBanner.tsx
/// L47-101): whether the banner is shown (<see cref="IsVisible"/> — the web <c>!isOwner &amp;&amp; otherTab</c>
/// gate), the localized <see cref="Title"/>, the localized <see cref="Body"/> (the labelled variant when a
/// <c>resourceLabel</c> is supplied, the generic copy otherwise), the localized <see cref="TakeOverLabel"/> and
/// <see cref="SwitchHint"/>, the <see cref="AccessibleName"/> the status region announces, the ARIA
/// <see cref="LiveSetting"/>, and the <see cref="OtherTabId"/> the view stamps for diagnostics/automation (web
/// <c>data-other-tab-id</c>). Pure value type so every field is asserted headlessly.
/// </summary>
public readonly record struct EditConflictBannerProjection
{
    private EditConflictBannerProjection(
        bool isVisible,
        string title,
        string body,
        string takeOverLabel,
        string switchHint,
        string accessibleName,
        string liveSetting,
        string otherTabId)
    {
        IsVisible = isVisible;
        Title = title;
        Body = body;
        TakeOverLabel = takeOverLabel;
        SwitchHint = switchHint;
        AccessibleName = accessibleName;
        LiveSetting = liveSetting;
        OtherTabId = otherTabId;
    }

    /// <summary>Whether the banner is shown — the web <c>if (isOwner || otherTab === null) return null</c> gate, inverted.</summary>
    public bool IsVisible { get; }

    /// <summary>The localized banner heading (web <c>title</c>).</summary>
    public string Title { get; }

    /// <summary>The localized body copy — the labelled or generic variant (web <c>body</c>).</summary>
    public string Body { get; }

    /// <summary>The localized take-over action label (web <c>takeOver</c>).</summary>
    public string TakeOverLabel { get; }

    /// <summary>The localized switch-to-other-tab hint (web <c>switchHint</c>).</summary>
    public string SwitchHint { get; }

    /// <summary>The accessible name the status region announces — the heading and body, read as one status.</summary>
    public string AccessibleName { get; }

    /// <summary>The ARIA live urgency the banner declares (polite).</summary>
    public string LiveSetting { get; }

    /// <summary>The peer's tab id (web <c>data-other-tab-id</c>); empty when there is no conflict.</summary>
    public string OtherTabId { get; }

    /// <summary>
    /// Project a lease snapshot into a render-ready banner value, reproducing the web component
    /// (web/src/components/feedback/EditConflictBanner.tsx L47-101): the banner is visible only while a peer holds
    /// the lease and this tab does not; the body is the labelled variant when <paramref name="resourceLabel"/> is
    /// supplied (web <c>bodyWithLabel</c>) and the generic copy otherwise (web <c>body</c>); every string is
    /// resolved through the localizer.
    /// </summary>
    /// <param name="snapshot">The lease inputs (web <c>useEditLease</c> result).</param>
    /// <param name="resourceLabel">Optional already-localized resource noun (web <c>resourceLabel</c> prop); null/empty uses the generic copy.</param>
    /// <param name="localizer">The i18n facade every string resolves through.</param>
    public static EditConflictBannerProjection Project(
        EditLeaseSnapshot snapshot,
        string? resourceLabel,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentNullException.ThrowIfNull(localizer);

        var title = localizer.GetString(EditConflictBannerRegistration.TitleKey, EditConflictBannerRegistration.TitleFallback);

        string body;
        if (string.IsNullOrEmpty(resourceLabel))
        {
            body = localizer.GetString(EditConflictBannerRegistration.BodyKey, EditConflictBannerRegistration.BodyFallback);
        }
        else
        {
            body = string.Format(
                CultureInfo.CurrentCulture,
                localizer.GetString(EditConflictBannerRegistration.BodyWithLabelKey, EditConflictBannerRegistration.BodyWithLabelFallback),
                resourceLabel);
        }

        var takeOver = localizer.GetString(EditConflictBannerRegistration.TakeOverKey, EditConflictBannerRegistration.TakeOverFallback);
        var switchHint = localizer.GetString(EditConflictBannerRegistration.SwitchHintKey, EditConflictBannerRegistration.SwitchHintFallback);

        return new EditConflictBannerProjection(
            isVisible: snapshot.IsConflict,
            title: title,
            body: body,
            takeOverLabel: takeOver,
            switchHint: switchHint,
            accessibleName: $"{title}. {body}",
            liveSetting: EditConflictBannerRegistration.LiveSetting,
            otherTabId: snapshot.OtherTab?.TabId ?? string.Empty);
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>EditConflictBanner</c> surface (P1/S11 diagnostics contract). The banner's
/// inputs include a <c>resourceKey</c> that follows the <c>&lt;feature&gt;/&lt;scope&gt;/&lt;id&gt;</c> convention
/// and can therefore carry a fleet identifier, so the collector records ONLY operational counters with the surface
/// slug — never the resource key, the peer tab id, or any copy. Thread-safe; mirrors the peer surfaces'
/// diagnostics collectors.
/// </summary>
public sealed class EditConflictBannerDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;
    private long _takeOvers;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the operational lines are written to, or null.</param>
    public EditConflictBannerDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Number of times the user took over editing from this surface.</summary>
    public long TakeOvers => Interlocked.Read(ref _takeOvers);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=EditConflictBanner</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={EditConflictBannerRegistration.Slug}");
    }

    /// <summary>Record a take-over, emitting <c>edit-conflict.take-over slug=EditConflictBanner</c> (no resource key).</summary>
    public void RecordTakeOver()
    {
        Interlocked.Increment(ref _takeOvers);
        _sink?.Invoke($"edit-conflict.take-over slug={EditConflictBannerRegistration.Slug}");
    }
}
