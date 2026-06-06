using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.Core.Data.Repositories;

/// <summary>Cache-then-network reads for system status/health/version and audit/admin logs.</summary>
public interface ISystemAdminRepository
{
    /// <summary>Overall system status.</summary>
    IAsyncEnumerable<RepositoryResult<JsonElement>> GetStatusAsync(CancellationToken cancellationToken = default);

    /// <summary>Dependency readiness/health.</summary>
    IAsyncEnumerable<RepositoryResult<JsonElement>> GetHealthAsync(CancellationToken cancellationToken = default);

    /// <summary>Build/version information.</summary>
    IAsyncEnumerable<RepositoryResult<JsonElement>> GetVersionAsync(CancellationToken cancellationToken = default);

    /// <summary>The system audit feed.</summary>
    IAsyncEnumerable<RepositoryResult<JsonElement>> GetAuditAsync(CancellationToken cancellationToken = default);

    /// <summary>The admin audit log.</summary>
    IAsyncEnumerable<RepositoryResult<JsonElement>> GetAdminAuditLogAsync(CancellationToken cancellationToken = default);
}

/// <summary>Default <see cref="ISystemAdminRepository"/>.</summary>
public sealed class SystemAdminRepository : RepositoryBase, ISystemAdminRepository
{
    /// <summary>Creates the repository.</summary>
    public SystemAdminRepository(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
        : base(api, engine, options)
    {
    }

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<JsonElement>> GetStatusAsync(CancellationToken cancellationToken = default) =>
        Stream<JsonElement>("system:status", new ApiRequest(Operations.SystemAdmin.Status), cancellationToken: cancellationToken);

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<JsonElement>> GetHealthAsync(CancellationToken cancellationToken = default) =>
        Stream<JsonElement>("system:health", new ApiRequest(Operations.SystemAdmin.Health), cancellationToken: cancellationToken);

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<JsonElement>> GetVersionAsync(CancellationToken cancellationToken = default) =>
        Stream<JsonElement>("system:version", new ApiRequest(Operations.SystemAdmin.Version), cancellationToken: cancellationToken);

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<JsonElement>> GetAuditAsync(CancellationToken cancellationToken = default) =>
        Stream<JsonElement>("system:audit", new ApiRequest(Operations.SystemAdmin.Audit), cancellationToken: cancellationToken);

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<JsonElement>> GetAdminAuditLogAsync(CancellationToken cancellationToken = default) =>
        Stream<JsonElement>("admin:audit-log", new ApiRequest(Operations.SystemAdmin.AdminAuditLog), cancellationToken: cancellationToken);
}
