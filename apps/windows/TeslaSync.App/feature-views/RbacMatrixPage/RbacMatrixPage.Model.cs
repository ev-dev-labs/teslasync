using System.Globalization;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// The top-level data state the <c>RbacMatrixPage</c> surfaces for its single (matrix) query — the native
/// discriminator for the branches the web page renders
/// (web/src/features/admin/pages/RbacMatrixPage.tsx). The web page selects, in order: a loading spinner, the
/// forward-auth notice (<c>mode === 'open'</c>), the load-failure banner, the "no roles configured" empty surface
/// (<c>roles.length === 0</c>) and finally the summary + matrix. The four declared parity data states map to
/// <see cref="Loading"/> / <see cref="Empty"/> / <see cref="Error"/> / <see cref="Ready"/>; <see cref="OpenMode"/>
/// is the faithful fifth branch the web page also renders for an open-auth install.
/// </summary>
public enum RbacMatrixState
{
    /// <summary>The matrix query is in flight with no data yet (web <c>matrixQuery.isLoading</c>).</summary>
    Loading,

    /// <summary>The backend reported <c>AUTH_MODE_OPEN</c> (web <c>isRbacOpenMode(data)</c>) — the forward-auth notice shows.</summary>
    OpenMode,

    /// <summary>The matrix query failed (web <c>matrixQuery.isError || !data</c>) — the failure banner + Retry shows.</summary>
    Error,

    /// <summary>The query resolved but no roles were forwarded (web <c>roles.length === 0</c>) — the empty surface shows.</summary>
    Empty,

    /// <summary>The query resolved with roles (web <c>payload</c>) — the summary pills + edit controls + matrix render.</summary>
    Ready,
}

/// <summary>
/// RBAC role identity — the native mirror of the web <c>RbacRole</c> (web/src/api/types.ts). <see cref="Id"/> is the
/// upstream proxy group name verbatim (or the implicit <c>user</c> default); <see cref="Name"/> is the matrix-column
/// label (currently identical to the id but split out so a future display-label pass keeps the API contract).
/// </summary>
public sealed record RbacRole(string Id, string Name);

/// <summary>
/// A single permission row — the native mirror of the web <c>RbacPermission</c> (web/src/api/types.ts). Permissions
/// are grouped by <see cref="Category"/> into the matrix's category bands.
/// </summary>
public sealed record RbacPermissionEntry(string Id, string Name, string Category);

/// <summary>
/// One changed (role, permission, allowed) cell in a PUT batch — the native mirror of the web <c>RbacUpsertCell</c>
/// (web/src/api/types.ts). The page sends only the cells the operator actually toggled (web <c>diffMatrices</c>).
/// </summary>
public sealed record RbacUpsertCell(string RoleId, string PermissionId, bool Allowed);

/// <summary>
/// One resolved matrix payload — the native mirror of the web <c>RbacMatrixResponse</c> discriminated union
/// (web/src/api/types.ts). <see cref="IsOpenMode"/> distinguishes the synthetic <c>{ mode: 'open' }</c> envelope the
/// web <c>useRbacMatrix</c> hook returns for an open-auth install (backend <c>AUTH_MODE_OPEN</c>) from a real
/// session payload. <c>Matrix[roleId][permId]</c> is true when the role grants the permission; a missing row or cell
/// both mean "deny". <see cref="EffectiveForMe"/> is the merged grant map for the calling subject across
/// <see cref="MyRoles"/>.
/// </summary>
public sealed record RbacMatrixSnapshot(
    bool IsOpenMode,
    IReadOnlyList<RbacRole> Roles,
    IReadOnlyList<RbacPermissionEntry> Permissions,
    IReadOnlyList<string> Categories,
    IReadOnlyDictionary<string, IReadOnlyDictionary<string, bool>> Matrix,
    IReadOnlyDictionary<string, bool> EffectiveForMe,
    IReadOnlyList<string> MyRoles,
    string? GroupsHeaderName)
{
    /// <summary>The synthetic open-auth envelope (web <c>{ mode: 'open' }</c>) — the forward-auth notice renders.</summary>
    public static RbacMatrixSnapshot Open { get; } = new(
        true,
        Array.Empty<RbacRole>(),
        Array.Empty<RbacPermissionEntry>(),
        Array.Empty<string>(),
        new Dictionary<string, IReadOnlyDictionary<string, bool>>(StringComparer.Ordinal),
        new Dictionary<string, bool>(StringComparer.Ordinal),
        Array.Empty<string>(),
        null);

    /// <summary>An empty, resolved session payload (no roles) — drives the "no roles configured" empty surface.</summary>
    public static RbacMatrixSnapshot Empty { get; } = new(
        false,
        Array.Empty<RbacRole>(),
        Array.Empty<RbacPermissionEntry>(),
        Array.Empty<string>(),
        new Dictionary<string, IReadOnlyDictionary<string, bool>>(StringComparer.Ordinal),
        new Dictionary<string, bool>(StringComparer.Ordinal),
        Array.Empty<string>(),
        null);
}

/// <summary>
/// The data port the <see cref="RbacMatrixPageViewModel"/> reads the matrix through — the native analogue of the web
/// <c>useRbacMatrix</c> hook (<c>GET /admin/rbac/matrix</c>). The default <see cref="OpenModeRbacMatrixFeed"/>
/// resolves to the open-auth notice (the truthful local-state result); the generated-client-backed
/// <c>RbacMatrixClientFeed</c> (RbacMatrixPage.Source.cs) binds the OpenAPI contract client (ADR-004).
/// </summary>
public interface IRbacMatrixFeed
{
    /// <summary>Resolve the current matrix snapshot (or the open-auth notice).</summary>
    Task<RbacMatrixSnapshot> FetchAsync(CancellationToken cancellationToken);
}

/// <summary>
/// The write port the <see cref="RbacMatrixPageViewModel"/> persists cell edits through — the native analogue of the
/// web <c>useUpsertRbacCells</c> mutation (<c>PUT /admin/rbac/matrix</c>). The route is RequireSudo-gated upstream;
/// the reauth challenge fires transparently on save. The default <see cref="NoopRbacWriteService"/> is a no-op for the
/// local-state page; the generated-client-backed <c>RbacUpsertClientService</c> (RbacMatrixPage.Source.cs) binds the
/// OpenAPI contract client (ADR-004).
/// </summary>
public interface IRbacWriteService
{
    /// <summary>Persist the changed <paramref name="cells"/> (an empty batch is a no-op, matching the backend).</summary>
    Task UpsertAsync(IReadOnlyList<RbacUpsertCell> cells, CancellationToken cancellationToken);
}

/// <summary>The default matrix feed — resolves every query to the open-auth notice (web <c>{ mode: 'open' }</c>).</summary>
public sealed class OpenModeRbacMatrixFeed : IRbacMatrixFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static OpenModeRbacMatrixFeed Instance { get; } = new();

    private OpenModeRbacMatrixFeed()
    {
    }

    /// <inheritdoc />
    public Task<RbacMatrixSnapshot> FetchAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(RbacMatrixSnapshot.Open);
    }
}

/// <summary>The default write service — a no-op for the local-state page (no backend mutation).</summary>
public sealed class NoopRbacWriteService : IRbacWriteService
{
    /// <summary>The shared singleton instance.</summary>
    public static NoopRbacWriteService Instance { get; } = new();

    private NoopRbacWriteService()
    {
    }

    /// <inheritdoc />
    public Task UpsertAsync(IReadOnlyList<RbacUpsertCell> cells, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.CompletedTask;
    }
}

/// <summary>
/// The pure matrix helpers ported from the web hook (web/src/api/hooks/useRbacMatrix.ts), kept at their web names so
/// the call sites read identically: <see cref="IsRbacOpenMode"/> narrows the synthetic open-auth envelope and
/// <see cref="DiffMatrices"/> returns the cells whose allowed value changed between two snapshots. UI-free so the
/// behaviour is asserted without a XAML host.
/// </summary>
public static class RbacMatrix
{
    private static readonly IReadOnlyDictionary<string, bool> EmptyRow =
        new Dictionary<string, bool>(StringComparer.Ordinal);

    /// <summary>Narrows the synthetic open-auth snapshot (web <c>isRbacOpenMode(data)</c>).</summary>
    public static bool IsRbacOpenMode(RbacMatrixSnapshot? data) => data?.IsOpenMode ?? false;

    /// <summary>Returns the cells whose allowed value changed between two matrix snapshots (web <c>diffMatrices</c>).</summary>
    public static IReadOnlyList<RbacUpsertCell> DiffMatrices(
        IReadOnlyDictionary<string, IReadOnlyDictionary<string, bool>> baseMatrix,
        IReadOnlyDictionary<string, IReadOnlyDictionary<string, bool>> draft)
    {
        ArgumentNullException.ThrowIfNull(baseMatrix);
        ArgumentNullException.ThrowIfNull(draft);

        var cells = new List<RbacUpsertCell>();
        var roleIDs = new HashSet<string>(baseMatrix.Keys, StringComparer.Ordinal);
        roleIDs.UnionWith(draft.Keys);

        foreach (string roleID in roleIDs)
        {
            IReadOnlyDictionary<string, bool> baseRow = baseMatrix.TryGetValue(roleID, out var b) ? b : EmptyRow;
            IReadOnlyDictionary<string, bool> draftRow = draft.TryGetValue(roleID, out var d) ? d : EmptyRow;

            var permIDs = new HashSet<string>(baseRow.Keys, StringComparer.Ordinal);
            permIDs.UnionWith(draftRow.Keys);

            foreach (string permID in permIDs)
            {
                bool baseAllowed = baseRow.TryGetValue(permID, out bool ba) && ba;
                bool draftAllowed = draftRow.TryGetValue(permID, out bool da) && da;
                if (baseAllowed != draftAllowed)
                {
                    cells.Add(new RbacUpsertCell(roleID, permID, draftAllowed));
                }
            }
        }

        return cells;
    }
}

/// <summary>
/// Canonical metadata + localized literals for the <c>RbacMatrixPage</c> feature surface — the native mirror of the
/// web page at <c>web/src/features/admin/pages/RbacMatrixPage.tsx</c> (nav name <c>RbacMatrix</c>). Every visible
/// literal resolves through the i18n facade using the same catalog keys the web source feeds into <c>t()</c> (the
/// <c>Strings/{lang}/Resources.resw</c> catalog stores them under the <c>translation.rbac.</c> prefix); the English
/// fallback is the web default verbatim (parameterized values use the catalog's positional <c>{0}</c> form). UI-free
/// so the mapping is asserted without a XAML host.
/// </summary>
public static class RbacMatrixRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "RbacMatrixPage";

    /// <summary>The navigation route name this page registers under (RouteTable <c>RbacMatrix</c> → <c>admin/rbac</c>).</summary>
    public const string RouteName = "RbacMatrix";

    /// <summary>The generated OpenAPI operation id for the matrix query (web <c>useRbacMatrix</c>, <c>GET /admin/rbac/matrix</c>).</summary>
    public const string MatrixOperation = "get_api_v1_admin_rbac_matrix";

    /// <summary>The generated OpenAPI operation id for the upsert mutation (web <c>useUpsertRbacCells</c>, <c>PUT /admin/rbac/matrix</c>).</summary>
    public const string UpsertOperation = "put_api_v1_admin_rbac_matrix";

    /// <summary>The backend sentinel for "feature unavailable" in open-auth mode (web <c>AUTH_MODE_OPEN</c>).</summary>
    public const string AuthModeOpenCode = "AUTH_MODE_OPEN";

    /// <summary>The page title (web key <c>rbac.title</c>).</summary>
    public static string Title(ILocalizer localizer) =>
        Get(localizer, "translation.rbac.title", "RBAC matrix");

    /// <summary>The page subtitle (web key <c>rbac.subtitle</c>).</summary>
    public static string Subtitle(ILocalizer localizer) =>
        Get(localizer, "translation.rbac.subtitle", "Provider-agnostic role-permission bindings");

    /// <summary>The matrix permission-column header (web key <c>rbac.permissionColumn</c>).</summary>
    public static string PermissionColumn(ILocalizer localizer) =>
        Get(localizer, "translation.rbac.permissionColumn", "Permission");

    /// <summary>The open-auth notice title (web key <c>rbac.openMode.title</c>).</summary>
    public static string OpenModeTitle(ILocalizer localizer) =>
        Get(localizer, "translation.rbac.openMode.title", "RBAC requires forward-auth mode");

    /// <summary>The open-auth notice body (web key <c>rbac.openMode.message</c>).</summary>
    public static string OpenModeMessage(ILocalizer localizer) =>
        Get(localizer, "translation.rbac.openMode.message",
            "The RBAC matrix is meaningful only when an upstream proxy (Authentik, Authelia, oauth2-proxy, Keycloak, etc.) injects an authenticated subject header. Configure FORWARD_AUTH_HEADER and TESLASYNC_RBAC_GROUPS_HEADER on the API service then reload.");

    /// <summary>The "Edit" action label (web key <c>rbac.actions.edit</c>).</summary>
    public static string EditLabel(ILocalizer localizer) =>
        Get(localizer, "translation.rbac.actions.edit", "Edit");

    /// <summary>The "Save (n)" action label with the dirty-cell count interpolated (web key <c>rbac.actions.save</c>).</summary>
    public static string SaveLabel(ILocalizer localizer, int count) =>
        string.Format(
            CultureInfo.CurrentCulture,
            Get(localizer, "translation.rbac.actions.save", "Save ({0})"),
            count);

    /// <summary>The in-flight "Saving…" action label (web key <c>rbac.actions.saving</c>).</summary>
    public static string SavingLabel(ILocalizer localizer) =>
        Get(localizer, "translation.rbac.actions.saving", "Saving\u2026");

    /// <summary>The "Cancel" action label (web key <c>rbac.actions.cancel</c>).</summary>
    public static string CancelLabel(ILocalizer localizer) =>
        Get(localizer, "translation.rbac.actions.cancel", "Cancel");

    /// <summary>The "Retry" action label (web key <c>rbac.actions.retry</c>).</summary>
    public static string RetryLabel(ILocalizer localizer) =>
        Get(localizer, "translation.rbac.actions.retry", "Retry");

    /// <summary>The accessible "allowed" cell label (web key <c>rbac.cell.allowed</c>).</summary>
    public static string CellAllowed(ILocalizer localizer) =>
        Get(localizer, "translation.rbac.cell.allowed", "Allowed");

    /// <summary>The accessible "denied" cell label (web key <c>rbac.cell.denied</c>).</summary>
    public static string CellDenied(ILocalizer localizer) =>
        Get(localizer, "translation.rbac.cell.denied", "Denied");

    /// <summary>The accessible edit-cell toggle label with role + permission interpolated (web key <c>rbac.cell.toggle</c>).</summary>
    public static string CellToggle(ILocalizer localizer, string role, string perm) =>
        string.Format(
            CultureInfo.CurrentCulture,
            Get(localizer, "translation.rbac.cell.toggle", "Toggle {0} / {1}"),
            role ?? string.Empty,
            perm ?? string.Empty);

    /// <summary>The effective-permissions pill text with allowed + total interpolated (web key <c>rbac.effective.count</c>).</summary>
    public static string EffectiveCount(ILocalizer localizer, int count, int total) =>
        string.Format(
            CultureInfo.CurrentCulture,
            Get(localizer, "translation.rbac.effective.count", "{0} / {1} effective"),
            count,
            total);

    /// <summary>The effective-permissions pill tooltip (web key <c>rbac.effective.tooltip</c>).</summary>
    public static string EffectiveTooltip(ILocalizer localizer) =>
        Get(localizer, "translation.rbac.effective.tooltip", "Permissions effective for your current roles");

    /// <summary>The my-roles pill text with the role list interpolated (web key <c>rbac.myRoles.label</c>).</summary>
    public static string MyRolesLabel(ILocalizer localizer, string roles) =>
        string.Format(
            CultureInfo.CurrentCulture,
            Get(localizer, "translation.rbac.myRoles.label", "My roles: {0}"),
            roles ?? string.Empty);

    /// <summary>The my-roles pill text when the subject claims no roles (web key <c>rbac.myRoles.none</c>).</summary>
    public static string MyRolesNone(ILocalizer localizer) =>
        Get(localizer, "translation.rbac.myRoles.none", "No roles claimed");

    /// <summary>The groups-header caption with the header name interpolated (web key <c>rbac.groupsHeader.label</c>).</summary>
    public static string GroupsHeaderLabel(ILocalizer localizer, string name) =>
        string.Format(
            CultureInfo.CurrentCulture,
            Get(localizer, "translation.rbac.groupsHeader.label", "Groups header: {0}"),
            name ?? string.Empty);

    /// <summary>The empty-surface title (web key <c>rbac.empty.title</c>).</summary>
    public static string EmptyTitle(ILocalizer localizer) =>
        Get(localizer, "translation.rbac.empty.title", "No roles configured");

    /// <summary>The empty-surface message (web key <c>rbac.empty.message</c>).</summary>
    public static string EmptyMessage(ILocalizer localizer) =>
        Get(localizer, "translation.rbac.empty.message",
            "No roles have been forwarded by the upstream proxy and no bindings exist in the database. Configure TESLASYNC_RBAC_GROUPS_HEADER on the API service and reload.");

    /// <summary>The load-failure banner title (web key <c>rbac.errors.loadTitle</c>).</summary>
    public static string ErrorLoadTitle(ILocalizer localizer) =>
        Get(localizer, "translation.rbac.errors.loadTitle", "Failed to load RBAC matrix");

    /// <summary>The generic load-failure message (web key <c>rbac.errors.loadGeneric</c>).</summary>
    public static string ErrorLoadGeneric(ILocalizer localizer) =>
        Get(localizer, "translation.rbac.errors.loadGeneric", "The matrix endpoint returned an error.");

    /// <summary>The generic save-failure message (web key <c>rbac.errors.saveGeneric</c>).</summary>
    public static string ErrorSaveGeneric(ILocalizer localizer) =>
        Get(localizer, "translation.rbac.errors.saveGeneric", "The matrix endpoint rejected the update.");

    /// <summary>
    /// The localized label for a permission category band (web <c>t(`rbac.category.${cat}`, cat)</c>) — falls back to
    /// the raw category id when the catalog has no entry, matching the web default.
    /// </summary>
    public static string CategoryLabel(ILocalizer localizer, string category)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        string key = string.Create(CultureInfo.InvariantCulture, $"translation.rbac.category.{category}");
        return localizer.GetString(key, category ?? string.Empty);
    }

    private static string Get(ILocalizer localizer, string key, string fallback)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(key, fallback);
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>RbacMatrixPage</c> surface (P1/S11 diagnostics contract). The page edits
/// privileged role-permission bindings, so the collector records only the operational <c>view.opened</c> event with
/// the surface slug — never a role id, permission id, or subject. Thread-safe.
/// </summary>
public sealed class RbacMatrixPageDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public RbacMatrixPageDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=RbacMatrixPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(string.Create(CultureInfo.InvariantCulture, $"view.opened slug={RbacMatrixRegistration.Slug}"));
    }
}
