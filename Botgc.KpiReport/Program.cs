using System.Text.Json;
using System.Text.Json.Serialization;
using System.Net.Http.Headers;
using Microsoft.Extensions.Options;

using Botgc.KpiReport.Models;
using Botgc.KpiReport.Services;
using Botgc.KpiReport.Configuration;

var builder = WebApplication.CreateBuilder(args);

builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
    options.SerializerOptions.PropertyNameCaseInsensitive = true;
    options.SerializerOptions.WriteIndented = true;
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter());
});

builder.Services.AddSingleton<IKpiReportStore, FileSystemKpiReportStore>();
builder.Services.AddSingleton<IKpiReportBuilder, KpiReportBuilder>();

builder.Services.Configure<AppSettings>(
    builder.Configuration);

builder.Services.AddHttpClient<
    ITeeTimeUsageClient,
    TeeTimeUsageClient>((serviceProvider, client) =>
{
    var settings = serviceProvider
        .GetRequiredService<IOptions<AppSettings>>()
        .Value;

    if (string.IsNullOrWhiteSpace(settings.API.Url))
    {
        throw new InvalidOperationException(
            "API:Url has not been configured.");
    }

    client.BaseAddress = new Uri(
        settings.API.Url,
        UriKind.Absolute);

    client.DefaultRequestHeaders.Accept.Add(
        new MediaTypeWithQualityHeaderValue(
            "application/json"));

    if (!string.IsNullOrWhiteSpace(settings.API.XApiKey))
    {
        client.DefaultRequestHeaders.Add(
            "X-API-KEY",
            settings.API.XApiKey);
    }

    client.Timeout = TimeSpan.FromMinutes(5);
});

builder.Services.AddHttpClient<
    IMembershipReportClient,
    MembershipReportClient>((serviceProvider, client) =>
{
    var settings = serviceProvider
        .GetRequiredService<IOptions<AppSettings>>()
        .Value;

    if (string.IsNullOrWhiteSpace(settings.API.Url))
    {
        throw new InvalidOperationException(
            "API:Url has not been configured.");
    }

    client.BaseAddress = new Uri(
        settings.API.Url,
        UriKind.Absolute);

    client.DefaultRequestHeaders.Accept.Add(
        new MediaTypeWithQualityHeaderValue(
            "application/json"));

    if (!string.IsNullOrWhiteSpace(settings.API.XApiKey))
    {
        client.DefaultRequestHeaders.Add(
            "X-API-KEY",
            settings.API.XApiKey);
    }

    client.Timeout = TimeSpan.FromMinutes(5);
});

builder.Services.AddScoped<
    IMembershipSnapshotImporter,
    MembershipSnapshotImporter>();

builder.Services.AddScoped<
    ITeeTimeSnapshotImporter,
    TeeTimeSnapshotImporter>();

var app = builder.Build();

app.UseDefaultFiles();
app.UseStaticFiles();

app.MapGet("/api/report", async (
    Guid? id,
    IKpiReportStore store,
    IKpiReportBuilder reportBuilder,
    CancellationToken cancellationToken) =>
{
    var source = id.HasValue
        ? await store.GetAsync(id.Value, cancellationToken)
        : await store.GetLatestAsync(cancellationToken);

    return source is null
        ? Results.NotFound()
        : Results.Ok(reportBuilder.Build(source));
});

app.MapGet("/api/kpi-reports", async (
    IKpiReportStore store,
    CancellationToken cancellationToken) =>
{
    var reports = await store.ListAsync(cancellationToken);
    return Results.Ok(reports);
});

app.MapGet("/api/kpi-reports/{reportId:guid}", async (
    Guid reportId,
    IKpiReportStore store,
    CancellationToken cancellationToken) =>
{
    var report = await store.GetAsync(reportId, cancellationToken);
    return report is null ? Results.NotFound() : Results.Ok(report);
});

app.MapGet("/api/kpi-reports/{reportId:guid}/rendered", async (
    Guid reportId,
    IKpiReportStore store,
    IKpiReportBuilder reportBuilder,
    CancellationToken cancellationToken) =>
{
    var report = await store.GetAsync(reportId, cancellationToken);
    return report is null
        ? Results.NotFound()
        : Results.Ok(reportBuilder.Build(report));
});

app.MapPost("/api/kpi-reports", async (
    CreateKpiReportRequest request,
    IKpiReportStore store,
    CancellationToken cancellationToken) =>
{
    var errors = KpiReportDataValidator.ValidateCreate(request);
    if (errors.Count > 0)
    {
        return Results.ValidationProblem(errors);
    }

    var report = await store.CreateAsync(request, cancellationToken);
    return Results.Created($"/api/kpi-reports/{report.Id}", report);
});

app.MapPost(
    "/api/kpi-reports/{reportId:guid}/membership-snapshot",
    async (
        Guid reportId,
        ImportMembershipSnapshotRequest request,
        IKpiReportStore store,
        IMembershipSnapshotImporter importer,
        CancellationToken cancellationToken) =>
    {
        var report = await store.GetAsync(
            reportId,
            cancellationToken);

        if (report is null)
        {
            return Results.NotFound();
        }

        if (request.Version != report.Version)
        {
            return Results.Conflict(new
            {
                message =
                    "The report has been changed since it was loaded.",
                expectedVersion = request.Version,
                actualVersion = report.Version
            });
        }

        try
        {
            report.MembershipSnapshot =
                await importer.ImportAsync(
                    report,
                    cancellationToken);

            var saved = await store.SaveAsync(
                report,
                cancellationToken);

            return Results.Ok(saved);
        }
        catch (MembershipReportImportException exception)
        {
            return Results.Problem(
                title: "Membership data could not be imported",
                detail: exception.Message,
                statusCode: StatusCodes.Status502BadGateway);
        }
    });

app.MapPut("/api/kpi-reports/{reportId:guid}", async (
    Guid reportId,
    KpiReportData report,
    IKpiReportStore store,
    CancellationToken cancellationToken) =>
{
    if (reportId != report.Id)
    {
        return Results.ValidationProblem(new Dictionary<string, string[]>
        {
            ["id"] = ["The route report ID must match the report document ID."]
        });
    }

    var errors = KpiReportDataValidator.Validate(report);
    if (errors.Count > 0)
    {
        return Results.ValidationProblem(errors);
    }

    try
    {
        var saved = await store.SaveAsync(report, cancellationToken);
        return Results.Ok(saved);
    }
    catch (KpiReportNotFoundException)
    {
        return Results.NotFound();
    }
    catch (KpiReportConcurrencyException exception)
    {
        return Results.Conflict(new
        {
            message = exception.Message,
            expectedVersion = exception.ExpectedVersion,
            actualVersion = exception.ActualVersion
        });
    }
});

app.MapDelete("/api/kpi-reports/{reportId:guid}", async (
    Guid reportId,
    int version,
    IKpiReportStore store,
    CancellationToken cancellationToken) =>
{
    try
    {
        await store.DeleteAsync(reportId, version, cancellationToken);
        return Results.NoContent();
    }
    catch (KpiReportNotFoundException)
    {
        return Results.NotFound();
    }
    catch (KpiReportConcurrencyException exception)
    {
        return Results.Conflict(new
        {
            message = exception.Message,
            expectedVersion = exception.ExpectedVersion,
            actualVersion = exception.ActualVersion
        });
    }
});

app.MapPost(
    "/api/kpi-reports/{reportId:guid}/tee-time-snapshot",
    async (
        Guid reportId,
        ImportTeeTimeSnapshotRequest request,
        IKpiReportStore store,
        ITeeTimeSnapshotImporter importer,
        CancellationToken cancellationToken) =>
    {
        var report = await store.GetAsync(
            reportId,
            cancellationToken);

        if (report is null)
        {
            return Results.NotFound();
        }

        if (request.Version != report.Version)
        {
            return Results.Conflict(new
            {
                message =
                    "The report has been changed since it was loaded.",
                expectedVersion = request.Version,
                actualVersion = report.Version
            });
        }

        if (request.StartDate == default)
        {
            return Results.ValidationProblem(
                new Dictionary<string, string[]>
                {
                    ["startDate"] =
                    [
                        "A start date is required."
                    ]
                });
        }

        if (request.EndDate < request.StartDate)
        {
            return Results.ValidationProblem(
                new Dictionary<string, string[]>
                {
                    ["endDate"] =
                    [
                        "The end date must not be before the start date."
                    ]
                });
        }

        if (request.EndDate >= report.FiguresCorrectAsAt)
        {
            return Results.ValidationProblem(
                new Dictionary<string, string[]>
                {
                    ["endDate"] =
                    [
                        "The tee-time period must end before " +
                        "the figures-correct-as-at date."
                    ]
                });
        }

        try
        {
            report.TeeTimeSnapshot =
                await importer.ImportAsync(
                    request.StartDate,
                    request.EndDate,
                    cancellationToken);

            var saved = await store.SaveAsync(
                report,
                cancellationToken);

            return Results.Ok(saved);
        }
        catch (TeeTimeUsageImportException exception)
        {
            return Results.Problem(
                title:
                    "Tee-time utilisation could not be imported",
                detail: exception.Message,
                statusCode:
                    StatusCodes.Status502BadGateway);
        }
    });
    
app.MapFallbackToFile("index.html");

app.Run();
