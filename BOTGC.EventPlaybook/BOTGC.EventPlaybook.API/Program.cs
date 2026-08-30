using System.Text.Json.Serialization;
using BOTGC.EventPlaybook.API.Features;
using BOTGC.EventPlaybook.API.Features.Competitions;
using BOTGC.EventPlaybook.API.Features.MemberEmail;
using BOTGC.EventPlaybook.API.Features.Members;
using BOTGC.EventPlaybook.API.Features.MemberWorkspace;
using BOTGC.EventPlaybook.API.Infrastructure;
using BOTGC.EventPlaybook.API.Infrastructure.IntelligentGolf;
using BOTGC.EventPlaybook.API.Options;
using Microsoft.OpenApi.Models;

var builder = WebApplication.CreateBuilder(args);

builder.Logging.ClearProviders();
builder.Logging.AddJsonConsole();

builder.Services.ConfigureHttpJsonOptions(options =>
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(options =>
{
    options.AddSecurityDefinition(ApiKeyMiddleware.HeaderName, new OpenApiSecurityScheme
    {
        Name = ApiKeyMiddleware.HeaderName,
        In = ParameterLocation.Header,
        Type = SecuritySchemeType.ApiKey,
        Description = "The API key issued to the event-planner service."
    });
    options.AddSecurityRequirement(new OpenApiSecurityRequirement
    {
        [new OpenApiSecurityScheme
        {
            Reference = new OpenApiReference
            {
                Type = ReferenceType.SecurityScheme,
                Id = ApiKeyMiddleware.HeaderName
            }
        }] = []
    });
});
builder.Services.AddProblemDetails();
builder.Services.AddMediatR(configuration =>
    configuration.RegisterServicesFromAssemblyContaining<Program>());

builder.Services
    .AddOptions<EventPlaybookApiOptions>()
    .Bind(builder.Configuration.GetSection(EventPlaybookApiOptions.SectionName));

builder.Services.AddIntelligentGolf(builder.Configuration);
builder.Services.AddEventPlannerFeatures();

var app = builder.Build();

app.UseExceptionHandler(exceptionApplication =>
    exceptionApplication.Run(ApiExceptionResponse.WriteAsync));

app.UseSwagger();
app.UseSwaggerUI();

app.UseMiddleware<ApiKeyMiddleware>();
app.UseMiddleware<IntelligentGolfSessionTokenMiddleware>();

app.MapGet("/health", () => Results.Ok(new { status = "healthy" }))
    .AllowAnonymous()
    .ExcludeFromDescription();

app.MapGet("/health/intelligent-golf", (IIntelligentGolfSession session) =>
        Results.Ok(session.Status))
    .AllowAnonymous()
    .ExcludeFromDescription();

app.MapPost("/v1/auth/intelligent-golf/session", async (
    IntelligentGolfCredentials credentials,
    IIntelligentGolfSession session,
    CancellationToken cancellationToken) =>
{
    try
    {
        return Results.Ok(await session.AuthenticateAsync(credentials, cancellationToken));
    }
    catch (ArgumentException exception)
    {
        return Results.BadRequest(new { error = exception.Message });
    }
    catch (IntelligentGolfAuthenticationException exception)
    {
        return Results.Json(
            new { error = exception.Message },
            statusCode: StatusCodes.Status401Unauthorized);
    }
})
    .WithTags("Authentication")
    .WithSummary("Validate Intelligent Golf credentials and establish an API session");

app.MapMemberEndpoints();
app.MapMemberEmailEndpoints();
app.MapMemberWorkspaceEndpoints();
app.MapCompetitionEndpoints();

app.Run();

public partial class Program;
