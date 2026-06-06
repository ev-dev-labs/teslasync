using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.Core.Data.Repositories;

/// <summary>Cache-then-network reads for data-export jobs and the export column catalog.</summary>
public interface IExportRepository
{
    /// <summary>The export-job list.</summary>
    IAsyncEnumerable<RepositoryResult<JsonElement>> GetJobsAsync(CancellationToken cancellationToken = default);

    /// <summary>A single export job's detail.</summary>
    IAsyncEnumerable<RepositoryResult<JsonElement>> GetJobAsync(string jobId, CancellationToken cancellationToken = default);

    /// <summary>The catalog of exportable columns.</summary>
    IAsyncEnumerable<RepositoryResult<JsonElement>> GetColumnsAsync(CancellationToken cancellationToken = default);
}

/// <summary>Default <see cref="IExportRepository"/>.</summary>
public sealed class ExportRepository : RepositoryBase, IExportRepository
{
    /// <summary>Creates the repository.</summary>
    public ExportRepository(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
        : base(api, engine, options)
    {
    }

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<JsonElement>> GetJobsAsync(CancellationToken cancellationToken = default) =>
        Stream<JsonElement>("exports:jobs", new ApiRequest(Operations.Exports.Jobs), cancellationToken: cancellationToken);

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<JsonElement>> GetJobAsync(string jobId, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrEmpty(jobId);
        return Stream<JsonElement>(
            $"exports:jobs:{jobId}",
            ApiRequest.WithPath(Operations.Exports.JobDetail, "jobID", jobId),
            cancellationToken: cancellationToken);
    }

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<JsonElement>> GetColumnsAsync(CancellationToken cancellationToken = default) =>
        Stream<JsonElement>("exports:columns", new ApiRequest(Operations.Exports.Columns), cancellationToken: cancellationToken);
}
