using System.Text.Json;
using System.Text.Json.Serialization;
using Botgc.KpiReport.Models;

namespace Botgc.KpiReport.Services;

public sealed class FileSystemKpiReportStore : IKpiReportStore
{
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly string _reportsDirectory;
    private readonly KpiReportPresentationData _presentationTemplate;
    private readonly JsonSerializerOptions _serializerOptions;

    public FileSystemKpiReportStore(IWebHostEnvironment environment)
    {
        ArgumentNullException.ThrowIfNull(environment);

        var dataDirectory = Path.Combine(environment.ContentRootPath, "Data");
        _reportsDirectory = Path.Combine(dataDirectory, "KpiReports");
        Directory.CreateDirectory(_reportsDirectory);

        _serializerOptions = new JsonSerializerOptions(JsonSerializerDefaults.Web)
        {
            PropertyNameCaseInsensitive = true,
            WriteIndented = true,
            Converters =
            {
                new JsonStringEnumConverter()
            }
        };

        var templatePath = Path.Combine(dataDirectory, "kpi-report.sample.json");
        var templateJson = File.ReadAllText(templatePath);
        var template = JsonSerializer.Deserialize<KpiReportDocument>(templateJson, _serializerOptions)
            ?? throw new InvalidDataException($"The KPI report template at '{templatePath}' could not be deserialised.");

        _presentationTemplate = new KpiReportPresentationData
        {
            Summary = template.Header.Summary,
            FinancialCommentary = template.FinancialCommentary,
            Outgoings = new DonutMetric
            {
                Title = template.Outgoings.Title,
                Description = template.Outgoings.Description,
                Items = template.Outgoings.Items
            },
            Membership = template.Membership,
            TeeTimeUtilisation = template.TeeTimeUtilisation,
            MemberRetention = template.MemberRetention,
            Gauges = template.Gauges,
            Movement = template.Movement,
            Feedback = template.Feedback
        };
    }

    public async Task<IReadOnlyList<KpiReportSummary>> ListAsync(
        CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken);

        try
        {
            var reports = new List<KpiReportSummary>();

            foreach (var path in Directory.EnumerateFiles(_reportsDirectory, "*.json"))
            {
                cancellationToken.ThrowIfCancellationRequested();
                var report = await ReadAsync(path, cancellationToken);
                reports.Add(ToSummary(report));
            }

            return reports
                .OrderByDescending(report => report.ReportingPeriodEnd)
                .ThenByDescending(report => report.UpdatedAtUtc)
                .ToList();
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<KpiReportData?> GetAsync(
        Guid reportId,
        CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken);

        try
        {
            var path = GetReportPath(reportId);
            return File.Exists(path)
                ? await ReadAsync(path, cancellationToken)
                : null;
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<KpiReportData?> GetLatestAsync(
        CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken);

        try
        {
            KpiReportData? latest = null;

            foreach (var path in Directory.EnumerateFiles(_reportsDirectory, "*.json"))
            {
                cancellationToken.ThrowIfCancellationRequested();
                var report = await ReadAsync(path, cancellationToken);

                if (latest is null ||
                    report.ReportingPeriodEnd > latest.ReportingPeriodEnd ||
                    report.ReportingPeriodEnd == latest.ReportingPeriodEnd && report.UpdatedAtUtc > latest.UpdatedAtUtc)
                {
                    latest = report;
                }
            }

            return latest;
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<KpiReportData> CreateAsync(
        CreateKpiReportRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        var errors = KpiReportDataValidator.ValidateCreate(request);
        if (errors.Count > 0)
        {
            throw new KpiReportValidationException(FlattenErrors(errors));
        }

        var now = DateTimeOffset.UtcNow;
        var report = new KpiReportData
        {
            Id = Guid.NewGuid(),
            Version = 1,
            Title = request.Title.Trim(),
            FinancialYearStart = request.FinancialYearStart,
            FinancialYearEnd = request.FinancialYearStart.AddYears(1).AddDays(-1),
            ReportingPeriodStart = request.ReportingPeriodStart,
            ReportingPeriodEnd = request.ReportingPeriodEnd,
            FiguresCorrectAsAt = request.FiguresCorrectAsAt,
            FinancialLines = request.FinancialLines
                .OrderBy(line => line.DisplayOrder)
                .Select(line => new KpiFinancialLineData
                {
                    Key = line.Key.Trim(),
                    Label = line.Label.Trim(),
                    Type = line.Type,
                    DisplayOrder = line.DisplayOrder,
                    Months = line.Months
                        .OrderBy(month => GetMonthOffset(
                            request.FinancialYearStart,
                            month.Year,
                            month.Month))
                        .Select(month => new KpiMonthlyFinancialData
                        {
                            Year = month.Year,
                            Month = month.Month,
                            Budget = month.Budget,
                            Actual = null
                        })
                        .ToList()
                })
                .ToList(),
            Presentation = Clone(_presentationTemplate),
            CreatedAtUtc = now,
            UpdatedAtUtc = now
        };

        await _gate.WaitAsync(cancellationToken);

        try
        {
            var path = GetReportPath(report.Id);
            await WriteAtomicallyAsync(path, report, cancellationToken);
            return report;
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<KpiReportData> SaveAsync(
        KpiReportData report,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(report);

        var errors = KpiReportDataValidator.Validate(report);
        if (errors.Count > 0)
        {
            throw new KpiReportValidationException(FlattenErrors(errors));
        }

        await _gate.WaitAsync(cancellationToken);

        try
        {
            var path = GetReportPath(report.Id);
            if (!File.Exists(path))
            {
                throw new KpiReportNotFoundException(report.Id);
            }

            var existing = await ReadAsync(path, cancellationToken);
            if (existing.Version != report.Version)
            {
                throw new KpiReportConcurrencyException(report.Id, report.Version, existing.Version);
            }

            var saved = Clone(report);
            saved.Version++;
            saved.CreatedAtUtc = existing.CreatedAtUtc;
            saved.UpdatedAtUtc = DateTimeOffset.UtcNow;
            saved.FinancialYearEnd = saved.FinancialYearStart.AddYears(1).AddDays(-1);

            await WriteAtomicallyAsync(path, saved, cancellationToken);
            return saved;
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task DeleteAsync(
        Guid reportId,
        int expectedVersion,
        CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken);

        try
        {
            var path = GetReportPath(reportId);
            if (!File.Exists(path))
            {
                throw new KpiReportNotFoundException(reportId);
            }

            var report = await ReadAsync(path, cancellationToken);
            if (report.Version != expectedVersion)
            {
                throw new KpiReportConcurrencyException(reportId, expectedVersion, report.Version);
            }

            File.Delete(path);
        }
        finally
        {
            _gate.Release();
        }
    }

    private static int GetMonthOffset(
        DateOnly financialYearStart,
        int year,
        int month)
    {
        return (year - financialYearStart.Year) * 12
               + month
               - financialYearStart.Month;
    }

    private string GetReportPath(Guid reportId)
    {
        return Path.Combine(_reportsDirectory, $"{reportId:N}.json");
    }

    private async Task<KpiReportData> ReadAsync(
        string path,
        CancellationToken cancellationToken)
    {
        await using var stream = new FileStream(
            path,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read,
            65536,
            FileOptions.Asynchronous | FileOptions.SequentialScan);

        return await JsonSerializer.DeserializeAsync<KpiReportData>(
                   stream,
                   _serializerOptions,
                   cancellationToken)
               ?? throw new InvalidDataException(
                   $"The KPI report at '{path}' could not be deserialised.");
    }

    private async Task WriteAtomicallyAsync(
        string path,
        KpiReportData report,
        CancellationToken cancellationToken)
    {
        var temporaryPath = $"{path}.{Guid.NewGuid():N}.tmp";

        try
        {
            await using (var stream = new FileStream(
                temporaryPath,
                FileMode.CreateNew,
                FileAccess.Write,
                FileShare.None,
                65536,
                FileOptions.Asynchronous))
            {
                await JsonSerializer.SerializeAsync(
                    stream,
                    report,
                    _serializerOptions,
                    cancellationToken);

                await stream.FlushAsync(cancellationToken);
            }

            File.Move(temporaryPath, path, true);
        }
        finally
        {
            if (File.Exists(temporaryPath))
            {
                File.Delete(temporaryPath);
            }
        }
    }

    private T Clone<T>(T value)
        where T : class
    {
        var json = JsonSerializer.Serialize(value, _serializerOptions);
        return JsonSerializer.Deserialize<T>(json, _serializerOptions)
            ?? throw new InvalidOperationException("The KPI report data could not be cloned.");
    }

    private static KpiReportSummary ToSummary(KpiReportData report)
    {
        return new KpiReportSummary(
            report.Id,
            report.Title,
            report.FinancialYearStart,
            report.ReportingPeriodStart,
            report.ReportingPeriodEnd,
            report.UpdatedAtUtc,
            report.Version);
    }

    private static string FlattenErrors(Dictionary<string, string[]> errors)
    {
        return string.Join(
            " ",
            errors.SelectMany(error => error.Value.Select(message => $"{error.Key}: {message}")));
    }
}
