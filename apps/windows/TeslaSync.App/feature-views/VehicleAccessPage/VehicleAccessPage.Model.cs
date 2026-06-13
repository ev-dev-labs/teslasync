using System.Collections.Generic;
using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Vehicles;

/// <summary>
/// The mutually-exclusive lifecycle state of one <c>VehicleAccessPage</c> section — the native mirror of the
/// per-list branch the web page renders for the drivers panel and the invitations panel
/// (web/src/features/vehicles/pages/VehicleAccessPage.tsx). The web page runs the
/// <c>useVehicleDrivers</c> / <c>useVehicleInvitations</c> queries and, in precedence order, shows the page-level
/// loading scaffold (web <c>isLoading</c>), then per panel either the rows table (web <c>list.length &gt; 0</c>)
/// or the <c>EmptyState</c>. The native port adds an explicit <see cref="Error"/> surface so a failed query is
/// never rendered as a blank region (ADR-011); per-region visibility is driven by the projected flags.
/// </summary>
public enum VehicleAccessSectionState
{
    /// <summary>The list query is in flight (web <c>isLoading</c>) — the panel shows its skeletons.</summary>
    Loading,

    /// <summary>The list query resolved with no rows (web <c>list.length === 0</c>) — the panel shows its empty state.</summary>
    Empty,

    /// <summary>The list query failed — the panel shows the error surface with a retry affordance.</summary>
    Error,

    /// <summary>The list query produced rows (web <c>list.length &gt; 0</c>) — the panel shows its table.</summary>
    Success,
}

/// <summary>
/// One authorized-driver row — the native mirror of the slice of the web <c>VehicleDriver</c>
/// (web/src/api/types.ts) the page reads: the id, the optional <see cref="ShareUserId"/> that gates the remove
/// affordance (web <c>row.share_user_id != null</c>), the driver name + email, and the optional role chip.
/// Parsing is null-tolerant so a partial row never throws. Pure data — no WinUI types — so the projection is
/// unit-tested without a UI host.
/// </summary>
/// <param name="Id">The driver row id (web <c>id</c>).</param>
/// <param name="ShareUserId">The Tesla share-user id (web <c>share_user_id</c>); null hides the remove action.</param>
/// <param name="DriverEmail">The driver email (web <c>driver_email</c>); null shown as an em-dash.</param>
/// <param name="DriverName">The driver display name (web <c>driver_name</c>); null shown as an em-dash.</param>
/// <param name="Role">The driver role (web <c>role</c>); null shown as an em-dash, otherwise a chip.</param>
public sealed record VehicleDriver(
    long Id,
    long? ShareUserId,
    string? DriverEmail,
    string? DriverName,
    string? Role)
{
    /// <summary>Parse a drivers JSON array into a tolerant list of rows, preserving order.</summary>
    public static IReadOnlyList<VehicleDriver> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<VehicleDriver>();
        }

        var list = new List<VehicleDriver>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Read one driver from a JSON object, tolerating missing / null fields.</summary>
    public static VehicleDriver FromJson(JsonElement o) => new(
        Id: VehicleAccessJson.ReadLong(o, "id") ?? 0,
        ShareUserId: VehicleAccessJson.ReadLong(o, "share_user_id"),
        DriverEmail: VehicleAccessJson.ReadString(o, "driver_email"),
        DriverName: VehicleAccessJson.ReadString(o, "driver_name"),
        Role: VehicleAccessJson.ReadString(o, "role"));
}

/// <summary>
/// One share-invitation row — the native mirror of the slice of the web <c>VehicleInvitation</c>
/// (web/src/api/types.ts) the page reads: the id, the wire <see cref="InvitationId"/> the revoke call targets,
/// the optional <see cref="InviteUrl"/> that gates the copy affordance, the wire <see cref="Status"/> feeding the
/// status badge, the optional <see cref="ExpiresAt"/> timestamp and the optional creator. Parsing is
/// null-tolerant so a partial row never throws. Pure data — no WinUI types — so the projection is unit-tested
/// without a UI host.
/// </summary>
/// <param name="Id">The invitation row id (web <c>id</c>).</param>
/// <param name="InvitationId">The Tesla invitation id the revoke endpoint targets (web <c>invitation_id</c>).</param>
/// <param name="InviteUrl">The shareable invite link (web <c>invite_url</c>); null hides the copy action.</param>
/// <param name="Status">The wire status (web <c>status</c>: <c>pending | revoked | …</c>) feeding the badge.</param>
/// <param name="ExpiresAt">The expiry timestamp (web <c>expires_at</c>); null shown as an em-dash.</param>
/// <param name="CreatedBy">The invitation creator (web <c>created_by</c>); null shown as an em-dash.</param>
public sealed record VehicleInvitation(
    long Id,
    string InvitationId,
    string? InviteUrl,
    string Status,
    DateTimeOffset? ExpiresAt,
    string? CreatedBy)
{
    /// <summary>Parse an invitations JSON array into a tolerant list of rows, preserving order.</summary>
    public static IReadOnlyList<VehicleInvitation> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<VehicleInvitation>();
        }

        var list = new List<VehicleInvitation>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Read one invitation from a JSON object, tolerating missing / null fields.</summary>
    public static VehicleInvitation FromJson(JsonElement o) => new(
        Id: VehicleAccessJson.ReadLong(o, "id") ?? 0,
        InvitationId: VehicleAccessJson.ReadString(o, "invitation_id") ?? string.Empty,
        InviteUrl: VehicleAccessJson.ReadString(o, "invite_url"),
        Status: VehicleAccessJson.ReadString(o, "status") ?? string.Empty,
        ExpiresAt: VehicleAccessJson.ReadDate(o, "expires_at"),
        CreatedBy: VehicleAccessJson.ReadString(o, "created_by"));
}

/// <summary>Tolerant JSON readers shared by the vehicle-access models (null-safe, culture-invariant).</summary>
internal static class VehicleAccessJson
{
    /// <summary>Read a string property, or null when missing / not a string.</summary>
    public static string? ReadString(JsonElement o, string name) =>
        o.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    /// <summary>Read an int64 property (number or numeric string), or null when missing / unparseable.</summary>
    public static long? ReadLong(JsonElement o, string name)
    {
        if (!o.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetInt64(out var n) => n,
            JsonValueKind.String when long.TryParse(v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var s) => s,
            _ => null,
        };
    }

    /// <summary>Read an ISO-8601 timestamp property, or null when missing / unparseable.</summary>
    public static DateTimeOffset? ReadDate(JsonElement o, string name)
    {
        if (!o.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            v.GetString(),
            CultureInfo.InvariantCulture,
            DateTimeStyles.RoundtripKind,
            out var parsed)
            ? parsed
            : null;
    }
}

/// <summary>
/// Canonical metadata + i18n keys for the <c>VehicleAccessPage</c> feature surface — the native mirror of the
/// web page at <c>web/src/features/vehicles/pages/VehicleAccessPage.tsx</c> (route <c>/vehicles/:id/access</c>,
/// nav name <c>VehicleAccess</c>). Carries the diagnostics slug, the nav route name, and the page title +
/// subtitle keys with their verbatim English fallbacks the web <c>t()</c> calls render. Every label flows
/// through one keyed <see cref="ILocalizer.GetString"/> call site so the resource keys are asserted in tests and
/// resolved through the WinUI resource bridge in the app. UI-free so it is asserted headlessly.
/// </summary>
public static class VehicleAccessRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "VehicleAccessPage";

    /// <summary>The navigation route name this page registers under (see RouteTable <c>VehicleAccess</c>).</summary>
    public const string RouteName = "VehicleAccess";

    /// <summary>The localized page title (web <c>vehicleAccess.title</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("vehicleAccess.title", "Vehicle Access");
    }

    /// <summary>The localized page subtitle (web <c>vehicleAccess.subtitle</c>).</summary>
    public static string Subtitle(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("vehicleAccess.subtitle", "Manage drivers and share invitations");
    }
}

/// <summary>The three localized drivers-table column headers (web <c>vehicleAccess.drivers.*</c>).</summary>
/// <param name="Name">Header for the name column (web <c>vehicleAccess.drivers.name</c>).</param>
/// <param name="Email">Header for the email column (web <c>vehicleAccess.drivers.email</c>).</param>
/// <param name="Role">Header for the role column (web <c>vehicleAccess.drivers.role</c>).</param>
public sealed record DriversColumnLabels(string Name, string Email, string Role);

/// <summary>The four localized invitations-table column headers (web <c>vehicleAccess.invitations.*</c>).</summary>
/// <param name="Status">Header for the status column (web <c>vehicleAccess.invitations.status</c>).</param>
/// <param name="CreatedBy">Header for the creator column (web <c>vehicleAccess.invitations.createdBy</c>).</param>
/// <param name="Expires">Header for the expiry column (web <c>vehicleAccess.invitations.expires</c>).</param>
/// <param name="Link">Header for the copy-link column (web <c>vehicleAccess.invitations.link</c>).</param>
public sealed record InvitationsColumnLabels(string Status, string CreatedBy, string Expires, string Link);

/// <summary>
/// One projected, render-ready drivers row — the native mirror of one web drivers <c>&lt;tr&gt;</c>
/// (web/src/features/vehicles/pages/VehicleAccessPage.tsx). Carries the id, the em-dashed name / email, the
/// role chip text (with a flag for whether to show the chip vs an em-dash), the remove affordance gate + its
/// share-user id and accessible name, and the composed Narrator name. Pure data so each field is asserted
/// headlessly.
/// </summary>
/// <param name="Id">The driver row id.</param>
/// <param name="Name">The display name (em-dash when blank, web <c>{driver_name ?? '—'}</c>).</param>
/// <param name="Email">The display email (em-dash when blank, web <c>{driver_email ?? '—'}</c>).</param>
/// <param name="Role">The role text (raw; only shown when <see cref="HasRole"/>).</param>
/// <param name="HasRole">Whether a role chip is shown (web <c>row.role ? Badge : '—'</c>).</param>
/// <param name="CanRemove">Whether the remove affordance is shown (web <c>row.share_user_id != null</c>).</param>
/// <param name="ShareUserId">The Tesla share-user id the remove call targets (0 when absent).</param>
/// <param name="RemoveLabel">The accessible name for the remove button (web <c>vehicleAccess.drivers.remove</c>).</param>
/// <param name="AutomationName">The composed Narrator name for the row.</param>
public sealed record DriverRow(
    long Id,
    string Name,
    string Email,
    string Role,
    bool HasRole,
    bool CanRemove,
    long ShareUserId,
    string RemoveLabel,
    string AutomationName);

/// <summary>
/// One projected, render-ready invitations row — the native mirror of one web invitations <c>&lt;tr&gt;</c>
/// (web/src/features/vehicles/pages/VehicleAccessPage.tsx). Carries the id, the wire invitation id the revoke
/// call targets, the status badge word + accent (web reuses the vehicle <c>StatusBadge</c> with a
/// pending→online / revoked→offline / else→asleep map), the em-dashed creator, the expiry timestamp, the
/// copy-link gate + raw url + accessible name, the revoke gate + accessible name, and the composed Narrator
/// name. Pure data so each field is asserted headlessly.
/// </summary>
/// <param name="Id">The invitation row id.</param>
/// <param name="InvitationId">The wire invitation id the revoke endpoint targets.</param>
/// <param name="StatusWord">The status badge word (web <c>online | offline | asleep</c> mapping).</param>
/// <param name="StatusAccentBrushKey">The token brush key tinting the status dot.</param>
/// <param name="CreatedBy">The creator text (em-dash when blank, web <c>{created_by ?? '—'}</c>).</param>
/// <param name="ExpiresAt">The expiry timestamp (null → em-dash at the display boundary).</param>
/// <param name="InviteUrl">The raw invite link the copy button places on the clipboard (empty when absent).</param>
/// <param name="HasLink">Whether the copy-link affordance is shown (web <c>row.invite_url ? Copy : '—'</c>).</param>
/// <param name="CanRevoke">Whether the revoke affordance is shown (web <c>row.status === 'pending'</c>).</param>
/// <param name="CopyLinkLabel">The accessible name for the copy button (web <c>vehicleAccess.invitations.copyLink</c>).</param>
/// <param name="RevokeLabel">The accessible name for the revoke button (web <c>vehicleAccess.invitations.revoke</c>).</param>
/// <param name="AutomationName">The composed Narrator name for the row.</param>
public sealed record InvitationRow(
    long Id,
    string InvitationId,
    string StatusWord,
    string StatusAccentBrushKey,
    string CreatedBy,
    DateTimeOffset? ExpiresAt,
    string InviteUrl,
    bool HasLink,
    bool CanRevoke,
    string CopyLinkLabel,
    string RevokeLabel,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the drivers panel (web GlassPanel #1). Carries the top-level
/// <see cref="State"/>, the per-region visibility flags, the panel title + count, the refresh affordance copy +
/// pending flag, the column headers, the projected rows, the empty-state copy, the error copy + retry label, and
/// the remove-confirmation dialog copy. Pure value so every field is asserted without a UI host.
/// </summary>
public sealed record DriversSectionDisplay(
    VehicleAccessSectionState State,
    bool ShowLoading,
    bool ShowError,
    bool ShowEmpty,
    bool ShowRows,
    string Title,
    int Count,
    bool ShowCount,
    string RefreshLabel,
    string RefreshAriaLabel,
    bool Refreshing,
    DriversColumnLabels Columns,
    IReadOnlyList<DriverRow> Rows,
    string EmptyMessage,
    string ErrorText,
    string RetryLabel,
    string RemoveTitle,
    string RemoveMessage,
    string RemoveConfirm,
    string CancelLabel);

/// <summary>
/// The fully projected, render-ready view of the invitations panel (web GlassPanel #2). Carries the top-level
/// <see cref="State"/>, the per-region visibility flags, the panel title + count, the refresh + create affordance
/// copy + pending flags, the column headers, the projected rows, the empty-state copy, the error copy + retry
/// label, the copy-link button labels, and the revoke-confirmation dialog copy. Pure value so every field is
/// asserted without a UI host.
/// </summary>
public sealed record InvitationsSectionDisplay(
    VehicleAccessSectionState State,
    bool ShowLoading,
    bool ShowError,
    bool ShowEmpty,
    bool ShowRows,
    string Title,
    int Count,
    bool ShowCount,
    string RefreshLabel,
    string RefreshAriaLabel,
    bool Refreshing,
    string CreateLabel,
    string CreateAriaLabel,
    bool Creating,
    InvitationsColumnLabels Columns,
    IReadOnlyList<InvitationRow> Rows,
    string EmptyMessage,
    string ErrorText,
    string RetryLabel,
    string CopyLinkLabel,
    string CopiedLabel,
    string RevokeTitle,
    string RevokeMessage,
    string RevokeConfirm,
    string CancelLabel);

/// <summary>
/// Everything the WinUI <c>VehicleAccessPage</c> view needs to draw every region with no further logic
/// (web/src/features/vehicles/pages/VehicleAccessPage.tsx): the page title + subtitle and the two fully
/// projected section displays. Pure value so every field is asserted without a UI host.
/// </summary>
public sealed record VehicleAccessDisplay(
    string Title,
    string Subtitle,
    DriversSectionDisplay Drivers,
    InvitationsSectionDisplay Invitations);

/// <summary>
/// The render-time data model the <c>VehicleAccessPage</c> projects from — the native analogue of the web page's
/// two resolved queries + their mutation pending flags
/// (web/src/features/vehicles/pages/VehicleAccessPage.tsx). Pure data so the projection is unit-tested without a
/// UI host.
/// </summary>
/// <param name="Drivers">The current drivers (web <c>drivers</c>).</param>
/// <param name="DriversLoading">Whether the drivers query is in flight (web <c>driversLoading</c>).</param>
/// <param name="DriversError">Whether the drivers query failed.</param>
/// <param name="DriversErrorDetail">Optional drivers failure detail appended to the error surface.</param>
/// <param name="DriversRefreshing">Whether the drivers refresh mutation is pending (web <c>refreshDrivers.isPending</c>).</param>
/// <param name="Invitations">The current invitations (web <c>invitations</c>).</param>
/// <param name="InvitationsLoading">Whether the invitations query is in flight (web <c>invitationsLoading</c>).</param>
/// <param name="InvitationsError">Whether the invitations query failed.</param>
/// <param name="InvitationsErrorDetail">Optional invitations failure detail appended to the error surface.</param>
/// <param name="InvitationsRefreshing">Whether the invitations refresh mutation is pending (web <c>refreshInvitations.isPending</c>).</param>
/// <param name="Creating">Whether the create-invitation mutation is pending (web <c>createInvitation.isPending</c>).</param>
public sealed record VehicleAccessModel(
    IReadOnlyList<VehicleDriver> Drivers,
    bool DriversLoading,
    bool DriversError,
    string? DriversErrorDetail,
    bool DriversRefreshing,
    IReadOnlyList<VehicleInvitation> Invitations,
    bool InvitationsLoading,
    bool InvitationsError,
    string? InvitationsErrorDetail,
    bool InvitationsRefreshing,
    bool Creating)
{
    /// <summary>The initial pre-fetch model — both lists loading, nothing pending (web first render).</summary>
    public static VehicleAccessModel Initial { get; } = new(
        Drivers: Array.Empty<VehicleDriver>(),
        DriversLoading: true,
        DriversError: false,
        DriversErrorDetail: null,
        DriversRefreshing: false,
        Invitations: Array.Empty<VehicleInvitation>(),
        InvitationsLoading: true,
        InvitationsError: false,
        InvitationsErrorDetail: null,
        InvitationsRefreshing: false,
        Creating: false);
}

/// <summary>
/// Pure projection from the two resolved queries + mutation flags to the render-ready
/// <see cref="VehicleAccessDisplay"/> — the native port of the web page body
/// (web/src/features/vehicles/pages/VehicleAccessPage.tsx). Selects each section's state in the web precedence
/// order (loading → error → empty → table), resolves every visible string through the localizer, projects each
/// driver / invitation row (including the status-badge map and the accessible names), and gates the remove /
/// copy / revoke affordances exactly as the web does. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class VehicleAccessProjection
{
    /// <summary>The em-dash shown for a blank value (web <c>{value ?? '—'}</c> idiom).</summary>
    public const string EmDash = "\u2014";

    /// <summary>Project the model into the render-ready display, resolving every visible string through <paramref name="localizer"/>.</summary>
    /// <param name="model">The two resolved queries + mutation flags.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static VehicleAccessDisplay Project(VehicleAccessModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        return new VehicleAccessDisplay(
            Title: VehicleAccessRegistration.Title(localizer),
            Subtitle: VehicleAccessRegistration.Subtitle(localizer),
            Drivers: ProjectDrivers(model, localizer),
            Invitations: ProjectInvitations(model, localizer));
    }

    /// <summary>Project the drivers panel (web GlassPanel #1) from the model.</summary>
    /// <param name="model">The resolved queries + mutation flags.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static DriversSectionDisplay ProjectDrivers(VehicleAccessModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        var drivers = model.Drivers ?? Array.Empty<VehicleDriver>();
        var state = SelectState(model.DriversLoading, model.DriversError, drivers.Count);

        var rows = new List<DriverRow>(drivers.Count);
        foreach (var driver in drivers)
        {
            rows.Add(ProjectDriverRow(driver, localizer));
        }

        return new DriversSectionDisplay(
            State: state,
            ShowLoading: state == VehicleAccessSectionState.Loading,
            ShowError: state == VehicleAccessSectionState.Error,
            ShowEmpty: state == VehicleAccessSectionState.Empty,
            ShowRows: state == VehicleAccessSectionState.Success,
            Title: localizer.GetString("vehicleAccess.drivers.title", "Drivers"),
            Count: drivers.Count,
            ShowCount: drivers.Count > 0,
            RefreshLabel: localizer.GetString("vehicleAccess.refresh", "Refresh"),
            RefreshAriaLabel: localizer.GetString("vehicleAccess.drivers.refresh", "Refresh drivers"),
            Refreshing: model.DriversRefreshing,
            Columns: new DriversColumnLabels(
                Name: localizer.GetString("vehicleAccess.drivers.name", "Name"),
                Email: localizer.GetString("vehicleAccess.drivers.email", "Email"),
                Role: localizer.GetString("vehicleAccess.drivers.role", "Role")),
            Rows: rows,
            EmptyMessage: localizer.GetString("vehicleAccess.drivers.empty", "No drivers found. Refresh to sync from Tesla."),
            ErrorText: ErrorText(model.DriversErrorDetail, localizer),
            RetryLabel: localizer.GetString("common.retry", "Retry"),
            RemoveTitle: localizer.GetString("vehicleAccess.drivers.removeTitle", "Remove Driver"),
            RemoveMessage: localizer.GetString(
                "vehicleAccess.drivers.removeMessage",
                "Are you sure you want to remove this driver's access? This action cannot be undone."),
            RemoveConfirm: localizer.GetString("vehicleAccess.drivers.removeConfirm", "Remove"),
            CancelLabel: localizer.GetString("common.cancel", "Cancel"));
    }

    /// <summary>Project the invitations panel (web GlassPanel #2) from the model.</summary>
    /// <param name="model">The resolved queries + mutation flags.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static InvitationsSectionDisplay ProjectInvitations(VehicleAccessModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        var invitations = model.Invitations ?? Array.Empty<VehicleInvitation>();
        var state = SelectState(model.InvitationsLoading, model.InvitationsError, invitations.Count);

        var rows = new List<InvitationRow>(invitations.Count);
        foreach (var invitation in invitations)
        {
            rows.Add(ProjectInvitationRow(invitation, localizer));
        }

        return new InvitationsSectionDisplay(
            State: state,
            ShowLoading: state == VehicleAccessSectionState.Loading,
            ShowError: state == VehicleAccessSectionState.Error,
            ShowEmpty: state == VehicleAccessSectionState.Empty,
            ShowRows: state == VehicleAccessSectionState.Success,
            Title: localizer.GetString("vehicleAccess.invitations.title", "Share Invitations"),
            Count: invitations.Count,
            ShowCount: invitations.Count > 0,
            RefreshLabel: localizer.GetString("vehicleAccess.refresh", "Refresh"),
            RefreshAriaLabel: localizer.GetString("vehicleAccess.invitations.refresh", "Refresh invitations"),
            Refreshing: model.InvitationsRefreshing,
            CreateLabel: localizer.GetString("vehicleAccess.invitations.createBtn", "Invite Driver"),
            CreateAriaLabel: localizer.GetString("vehicleAccess.invitations.create", "Create invitation"),
            Creating: model.Creating,
            Columns: new InvitationsColumnLabels(
                Status: localizer.GetString("vehicleAccess.invitations.status", "Status"),
                CreatedBy: localizer.GetString("vehicleAccess.invitations.createdBy", "Created By"),
                Expires: localizer.GetString("vehicleAccess.invitations.expires", "Expires"),
                Link: localizer.GetString("vehicleAccess.invitations.link", "Link")),
            Rows: rows,
            EmptyMessage: localizer.GetString("vehicleAccess.invitations.empty", "No invitations yet. Create one to share vehicle access."),
            ErrorText: ErrorText(model.InvitationsErrorDetail, localizer),
            RetryLabel: localizer.GetString("common.retry", "Retry"),
            CopyLinkLabel: localizer.GetString("vehicleAccess.invitations.copyLink", "Copy invite link"),
            CopiedLabel: localizer.GetString("common.copied", "Copied"),
            RevokeTitle: localizer.GetString("vehicleAccess.invitations.revokeTitle", "Revoke Invitation"),
            RevokeMessage: localizer.GetString(
                "vehicleAccess.invitations.revokeMessage",
                "Are you sure you want to revoke this invitation? The invite link will no longer work."),
            RevokeConfirm: localizer.GetString("vehicleAccess.invitations.revokeConfirm", "Revoke"),
            CancelLabel: localizer.GetString("common.cancel", "Cancel"));
    }

    /// <summary>Project one driver into its render-ready row, resolving the interpolated remove label.</summary>
    /// <param name="driver">The source driver.</param>
    /// <param name="localizer">The i18n facade the row labels resolve through.</param>
    public static DriverRow ProjectDriverRow(VehicleDriver driver, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(driver);
        ArgumentNullException.ThrowIfNull(localizer);

        string name = string.IsNullOrEmpty(driver.DriverName) ? EmDash : driver.DriverName!;
        string email = string.IsNullOrEmpty(driver.DriverEmail) ? EmDash : driver.DriverEmail!;
        bool hasRole = !string.IsNullOrEmpty(driver.Role);
        string role = hasRole ? driver.Role! : EmDash;
        string removeLabel = localizer.GetString("vehicleAccess.drivers.remove", "Remove driver");

        return new DriverRow(
            Id: driver.Id,
            Name: name,
            Email: email,
            Role: role,
            HasRole: hasRole,
            CanRemove: driver.ShareUserId is not null,
            ShareUserId: driver.ShareUserId ?? 0,
            RemoveLabel: removeLabel,
            AutomationName: string.Join(". ", name, email));
    }

    /// <summary>Project one invitation into its render-ready row, resolving the status badge + accessible names.</summary>
    /// <param name="invitation">The source invitation.</param>
    /// <param name="localizer">The i18n facade the row labels resolve through.</param>
    public static InvitationRow ProjectInvitationRow(VehicleInvitation invitation, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(invitation);
        ArgumentNullException.ThrowIfNull(localizer);

        var (word, accentKey) = StatusBadge(invitation.Status);
        bool hasLink = !string.IsNullOrEmpty(invitation.InviteUrl);
        string createdBy = string.IsNullOrEmpty(invitation.CreatedBy) ? EmDash : invitation.CreatedBy!;

        return new InvitationRow(
            Id: invitation.Id,
            InvitationId: invitation.InvitationId,
            StatusWord: word,
            StatusAccentBrushKey: accentKey,
            CreatedBy: createdBy,
            ExpiresAt: invitation.ExpiresAt,
            InviteUrl: invitation.InviteUrl ?? string.Empty,
            HasLink: hasLink,
            CanRevoke: string.Equals(invitation.Status, "pending", StringComparison.Ordinal),
            CopyLinkLabel: localizer.GetString("vehicleAccess.invitations.copyLink", "Copy invite link"),
            RevokeLabel: localizer.GetString("vehicleAccess.invitations.revoke", "Revoke invitation"),
            AutomationName: string.Join(". ", createdBy, word));
    }

    /// <summary>
    /// The status badge word + accent the invitations panel renders — the native mirror of the web map
    /// <c>status === 'pending' ? 'online' : status === 'revoked' ? 'offline' : 'asleep'</c> fed into the reused
    /// vehicle <c>StatusBadge</c> (green / red / purple dot). The word is the raw state name the web badge shows.
    /// </summary>
    /// <param name="status">The wire invitation status.</param>
    public static (string Word, string AccentBrushKey) StatusBadge(string? status) => status switch
    {
        "pending" => ("online", "TsColorSuccessBrush"),
        "revoked" => ("offline", "TsColorDangerBrush"),
        _ => ("asleep", "TsChartPowerBrush"),
    };

    // web order: isLoading dominates, then the failure surface, then the panel's own empty / rows branch.
    private static VehicleAccessSectionState SelectState(bool loading, bool hasError, int count)
    {
        if (loading)
        {
            return VehicleAccessSectionState.Loading;
        }

        if (hasError)
        {
            return VehicleAccessSectionState.Error;
        }

        return count == 0 ? VehicleAccessSectionState.Empty : VehicleAccessSectionState.Success;
    }

    private static string ErrorText(string? detail, ILocalizer localizer)
    {
        string baseText = localizer.GetString("common.errorLoad", "Failed to load data");
        return string.IsNullOrEmpty(detail) ? baseText : string.Create(CultureInfo.CurrentCulture, $"{baseText}: {detail}");
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>VehicleAccessPage</c> surface (P1/S11 diagnostics contract). Driver / invite
/// rows carry user-identifying emails and share links, so the collector records ONLY the operational
/// <c>view.opened</c> event with the surface slug — never a driver email, name, invite url or invitation id.
/// Thread-safe; mirrors the sibling feature-view pages' collectors.
/// </summary>
public sealed class VehicleAccessDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public VehicleAccessDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=VehicleAccessPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(string.Create(CultureInfo.InvariantCulture, $"view.opened slug={VehicleAccessRegistration.Slug}"));
    }
}
