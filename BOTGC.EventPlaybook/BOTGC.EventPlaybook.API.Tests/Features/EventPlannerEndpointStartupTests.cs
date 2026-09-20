using BOTGC.EventPlaybook.API.Features;
using MediatR;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Xunit;

namespace BOTGC.EventPlaybook.API.Tests.Features;

public sealed class EventPlannerEndpointStartupTests
{
    [Fact]
    public async Task EventPlannerEndpoints_CanMaterialiseEveryRequestDelegate()
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions
        {
            EnvironmentName = Environments.Development
        });
        // Endpoint materialisation only needs IMediator to be recognised as a service;
        // no request is executed by this startup regression test.
        builder.Services.AddSingleton<IMediator>(_ => null!);

        await using var application = builder.Build();
        application.MapEventPlannerEndpoints();

        var routeBuilder = (IEndpointRouteBuilder)application;
        var exception = Record.Exception(() =>
            routeBuilder.DataSources.SelectMany(source => source.Endpoints).ToArray());

        Assert.Null(exception);
    }
}
