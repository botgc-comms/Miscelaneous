using Microsoft.AspNetCore.Http.Features;
using System.Text;
using Trophy.Catalogue.Domain;
using Trophy.Catalogue.Services;

namespace Trophy.Catalogue;

public static class EntryPoint
{
    private static readonly HashSet<string> AcceptedImageTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "image/jpeg", "image/png", "image/webp"
    };

    public static async Task Main(string[] args)
    {
        var builder = WebApplication.CreateBuilder(args);
        builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 15 * 1024 * 1024);
        builder.Services.Configure<FormOptions>(options => options.MultipartBodyLengthLimit = 15 * 1024 * 1024);
        builder.Services.AddSingleton<CatalogueStore>();
        builder.Services.AddSingleton<PasswordGate>();
        builder.Services.AddSingleton<OpenAiEngravingReader>();
        builder.Services.AddHttpClient(nameof(OpenAiEngravingReader), client => client.Timeout = TimeSpan.FromMinutes(4));

        var app = builder.Build();
        await app.Services.GetRequiredService<CatalogueStore>().InitializeAsync();

        app.Use(async (context, next) =>
        {
            context.Response.Headers["X-Content-Type-Options"] = "nosniff";
            context.Response.Headers["Referrer-Policy"] = "same-origin";
            context.Response.Headers["Permissions-Policy"] = "camera=(self), microphone=()";
            context.Response.Headers["Content-Security-Policy"] =
                "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
            await next();
        });

        app.UseDefaultFiles();
        app.UseStaticFiles(new StaticFileOptions
        {
            OnPrepareResponse = context =>
            {
                context.Context.Response.Headers.CacheControl = context.File.Name is "index.html" or "app.js" or "styles.css"
                    ? "no-cache"
                    : "public,max-age=604800";
            }
        });

        app.Use(async (context, next) =>
        {
            if (!context.Request.Path.StartsWithSegments("/api") ||
                context.Request.Path.StartsWithSegments("/api/auth") ||
                context.Request.Path == "/health")
            {
                await next();
                return;
            }

            var gate = context.RequestServices.GetRequiredService<PasswordGate>();
            if (gate.RequiresSetup)
            {
                context.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
                await context.Response.WriteAsJsonAsync(new { error = "setup_required", message = "Set APP_PASSWORD before using the archive." });
                return;
            }
            if (!gate.IsAuthenticated(context))
            {
                context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                await context.Response.WriteAsJsonAsync(new { error = "unauthorized" });
                return;
            }
            await next();
        });

        MapHealth(app);
        MapAuthentication(app);
        MapCatalogue(app);
        MapEvidence(app);
        MapWinners(app);
        MapExports(app);

        app.MapFallbackToFile("index.html");
        await app.RunAsync();
    }

    private static void MapHealth(WebApplication app)
    {
        app.MapGet("/health", (OpenAiEngravingReader reader) => Results.Ok(new
        {
            status = "healthy",
            aiConfigured = reader.IsAvailable
        }));
    }

    private static void MapAuthentication(WebApplication app)
    {
        app.MapGet("/api/auth/status", (HttpContext context, PasswordGate gate, OpenAiEngravingReader reader) => Results.Ok(new
        {
            authenticated = gate.IsAuthenticated(context),
            requiresSetup = gate.RequiresSetup,
            passwordRequired = gate.IsConfigured,
            aiConfigured = reader.IsAvailable,
            model = reader.Model
        }));

        app.MapPost("/api/auth/login", async (HttpContext context, LoginInput input, PasswordGate gate) =>
        {
            if (gate.RequiresSetup)
                return Results.Json(new { error = "setup_required", message = "Set APP_PASSWORD in Render first." }, statusCode: 503);
            if (gate.IsOpenForLocalDevelopment || gate.PasswordMatches(input.Password))
            {
                if (gate.IsConfigured) gate.SignIn(context);
                return Results.Ok(new { authenticated = true });
            }
            await Task.Delay(Random.Shared.Next(350, 750));
            return Results.Json(new { error = "incorrect_password" }, statusCode: 401);
        });

        app.MapPost("/api/auth/logout", (HttpContext context) =>
        {
            PasswordGate.SignOut(context);
            return Results.Ok(new { authenticated = false });
        });
    }

    private static void MapCatalogue(WebApplication app)
    {
        app.MapGet("/api/trophies", async (CatalogueStore store, OpenAiEngravingReader reader, CancellationToken cancellationToken) =>
        {
            var items = await store.GetSummariesAsync(cancellationToken);
            return Results.Ok(new
            {
                items,
                totals = new
                {
                    all = items.Count,
                    notStarted = items.Count(item => item.Status == TrophyStatuses.NotStarted),
                    inProgress = items.Count(item => item.Status == TrophyStatuses.InProgress),
                    complete = items.Count(item => item.Status == TrophyStatuses.Complete),
                    needsReview = items.Count(item => item.NeedsReviewCount > 0)
                },
                aiConfigured = reader.IsAvailable
            });
        });

        app.MapGet("/api/trophies/{id}", async (string id, CatalogueStore store, CancellationToken cancellationToken) =>
        {
            var trophy = await store.GetTrophyAsync(id, cancellationToken);
            return trophy is null
                ? Results.NotFound()
                : Results.Ok(new { trophy, missingYears = CatalogueStore.MissingYears(trophy) });
        });

        app.MapPut("/api/trophies/{id}/timeline", async (string id, TimelineInput input, CatalogueStore store, CancellationToken cancellationToken) =>
        {
            if (!ValidTimeline(input)) return Results.BadRequest(new { error = "Choose years from 1800 to 2200, with the first year before the last." });
            var trophy = await store.UpdateTimelineAsync(id, input, cancellationToken);
            return trophy is null ? Results.NotFound() : Results.Ok(new { trophy, missingYears = CatalogueStore.MissingYears(trophy) });
        });

        app.MapPost("/api/trophies/{id}/complete", async (string id, CatalogueStore store, CancellationToken cancellationToken) =>
        {
            var trophy = await store.MarkCompleteAsync(id, cancellationToken);
            return trophy is null ? Results.NotFound() : Results.Ok(new { trophy, missingYears = CatalogueStore.MissingYears(trophy) });
        });
    }

    private static void MapEvidence(WebApplication app)
    {
        app.MapPost("/api/trophies/{id}/images", async (
            string id,
            HttpRequest request,
            CatalogueStore store,
            OpenAiEngravingReader reader,
            CancellationToken cancellationToken) =>
        {
            if (!request.HasFormContentType) return Results.BadRequest(new { error = "An image upload is required." });
            var form = await request.ReadFormAsync(cancellationToken);
            var file = form.Files.GetFile("file");
            var kind = form["kind"].ToString() == EvidenceKinds.Rubbing ? EvidenceKinds.Rubbing : EvidenceKinds.Photo;
            if (file is null || file.Length == 0) return Results.BadRequest(new { error = "Choose a photo or rubbing first." });
            if (file.Length > 12 * 1024 * 1024) return Results.BadRequest(new { error = "That image is larger than 12 MB. Try a smaller photo." });
            if (!AcceptedImageTypes.Contains(file.ContentType))
                return Results.BadRequest(new { error = "Use a JPEG, PNG or WebP image." });

            await using var stream = file.OpenReadStream();
            var evidence = await store.AddEvidenceAsync(id, file.FileName, file.ContentType, kind, stream, cancellationToken);
            if (evidence is null) return Results.NotFound();

            string? analysisError = null;
            List<string> observations = [];
            try
            {
                var trophy = await store.GetTrophyAsync(id, cancellationToken) ?? throw new InvalidOperationException("Trophy disappeared during analysis.");
                var evidenceFiles = await store.GetEvidenceFilesAsync(id, cancellationToken);
                var extraction = await reader.ReadAsync(trophy, evidenceFiles, cancellationToken);
                observations = extraction.Observations;
                await store.MergeAiExtractionAsync(id, extraction, evidenceFiles.Select(item => item.Evidence.Id).ToList(), cancellationToken);
                await store.SetEvidenceProcessingAsync(id, evidence.Id, ProcessingStates.Complete,
                    extraction.Entries.Count == 1 ? "1 winner reading found" : $"{extraction.Entries.Count} winner readings found", cancellationToken);
            }
            catch (OpenAiUnavailableException exception)
            {
                analysisError = exception.Message;
                await store.SetEvidenceProcessingAsync(id, evidence.Id, ProcessingStates.Failed, exception.Message, cancellationToken);
            }

            var updated = await store.GetTrophyAsync(id, cancellationToken);
            return Results.Ok(new
            {
                trophy = updated,
                missingYears = updated is null ? [] : CatalogueStore.MissingYears(updated),
                observations,
                analysisError
            });
        }).DisableAntiforgery();

        app.MapPost("/api/trophies/{id}/analyse", async (
            string id,
            CatalogueStore store,
            OpenAiEngravingReader reader,
            CancellationToken cancellationToken) =>
        {
            var trophy = await store.GetTrophyAsync(id, cancellationToken);
            if (trophy is null) return Results.NotFound();
            var evidenceFiles = await store.GetEvidenceFilesAsync(id, cancellationToken);
            if (evidenceFiles.Count == 0) return Results.BadRequest(new { error = "Add at least one image first." });
            try
            {
                var extraction = await reader.ReadAsync(trophy, evidenceFiles, cancellationToken);
                var updated = await store.MergeAiExtractionAsync(id, extraction, evidenceFiles.Select(item => item.Evidence.Id).ToList(), cancellationToken);
                return Results.Ok(new
                {
                    trophy = updated,
                    missingYears = updated is null ? [] : CatalogueStore.MissingYears(updated),
                    observations = extraction.Observations
                });
            }
            catch (OpenAiUnavailableException exception)
            {
                return Results.Json(new { error = "analysis_failed", message = exception.Message }, statusCode: 503);
            }
        });

        app.MapGet("/api/trophies/{id}/images/{imageId}", async (
            string id,
            string imageId,
            CatalogueStore store,
            CancellationToken cancellationToken) =>
        {
            var trophy = await store.GetTrophyAsync(id, cancellationToken);
            var evidence = trophy?.Evidence.FirstOrDefault(item => item.Id == imageId);
            var path = await store.GetEvidencePathAsync(id, imageId, cancellationToken);
            return evidence is null || path is null ? Results.NotFound() : Results.File(path, evidence.ContentType, enableRangeProcessing: true);
        });

        app.MapDelete("/api/trophies/{id}/images/{imageId}", async (
            string id,
            string imageId,
            CatalogueStore store,
            CancellationToken cancellationToken) =>
            await store.DeleteEvidenceAsync(id, imageId, cancellationToken) ? Results.NoContent() : Results.NotFound());
    }

    private static void MapWinners(WebApplication app)
    {
        app.MapPost("/api/trophies/{id}/winners", async (string id, WinnerInput input, CatalogueStore store, CancellationToken cancellationToken) =>
        {
            var error = ValidateWinner(input);
            if (error is not null) return Results.BadRequest(new { error });
            var winner = await store.AddWinnerAsync(id, input, cancellationToken);
            return winner is null ? Results.NotFound() : Results.Created($"/api/trophies/{id}/winners/{winner.Id}", winner);
        });

        app.MapPut("/api/trophies/{id}/winners/{winnerId}", async (
            string id,
            string winnerId,
            WinnerInput input,
            CatalogueStore store,
            CancellationToken cancellationToken) =>
        {
            var error = ValidateWinner(input);
            if (error is not null) return Results.BadRequest(new { error });
            var winner = await store.UpdateWinnerAsync(id, winnerId, input, cancellationToken);
            return winner is null ? Results.NotFound() : Results.Ok(winner);
        });

        app.MapDelete("/api/trophies/{id}/winners/{winnerId}", async (
            string id,
            string winnerId,
            CatalogueStore store,
            CancellationToken cancellationToken) =>
            await store.DeleteWinnerAsync(id, winnerId, cancellationToken) ? Results.NoContent() : Results.NotFound());
    }

    private static void MapExports(WebApplication app)
    {
        app.MapGet("/api/export.csv", async (CatalogueStore store, CancellationToken cancellationToken) =>
        {
            var summaries = await store.GetSummariesAsync(cancellationToken);
            var csv = new StringBuilder("Trophy code,Trophy name,Year,Winner,Review status,Source,Notes\r\n");
            foreach (var summary in summaries)
            {
                var trophy = await store.GetTrophyAsync(summary.Id, cancellationToken);
                if (trophy is null) continue;
                foreach (var winner in trophy.Winners.OrderBy(item => item.Year).ThenBy(item => item.Name))
                {
                    csv.AppendLine(string.Join(',', new[]
                    {
                        Csv(trophy.Id), Csv(trophy.Name), winner.Year.ToString(), Csv(winner.Name),
                        Csv(winner.ReviewState), Csv(winner.Source), Csv(winner.Notes ?? string.Empty)
                    }));
                }
            }
            return Results.File(Encoding.UTF8.GetBytes(csv.ToString()), "text/csv; charset=utf-8", $"botgc-trophy-winners-{DateTime.UtcNow:yyyy-MM-dd}.csv");
        });
    }

    private static string? ValidateWinner(WinnerInput input)
    {
        if (input.Year is < 1800 or > 2200) return "Enter a year from 1800 to 2200.";
        if (string.IsNullOrWhiteSpace(input.Name)) return "Enter the winner's name.";
        if (input.Name.Trim().Length > 200) return "Keep the winner's name under 200 characters.";
        return null;
    }

    private static bool ValidTimeline(TimelineInput input)
    {
        if (input.StartYear is < 1800 or > 2200 || input.EndYear is < 1800 or > 2200) return false;
        return !input.StartYear.HasValue || !input.EndYear.HasValue ||
               (input.StartYear <= input.EndYear && input.EndYear - input.StartYear <= 250);
    }

    private static string Csv(string value) => $"\"{value.Replace("\"", "\"\"")}\"";
}
