using System.Net;
using System.Reflection;
using BOTGC.EventPlaybook.API.Options;
using Microsoft.Extensions.Options;
using RedLockNet.SERedis;
using RedLockNet.SERedis.Configuration;
using StackExchange.Redis;

namespace BOTGC.EventPlaybook.API.Infrastructure.IntelligentGolf;

public static class IntelligentGolfServiceCollectionExtensions
{
    public const string HttpClientName = "IntelligentGolf";
    public const string NoRedirectHttpClientName = "IntelligentGolfNoRedirect";

    public static IServiceCollection AddIntelligentGolf(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        services
            .AddOptions<IntelligentGolfOptions>()
            .Bind(configuration.GetSection(IntelligentGolfOptions.SectionName))
            .Validate(
                settings => Uri.TryCreate(settings.BaseUrl, UriKind.Absolute, out _),
                "IntelligentGolf:BaseUrl must be an absolute URL.")
            .Validate(
                settings => settings.LoginRefreshMinutes > 0,
                "IntelligentGolf:LoginRefreshMinutes must be greater than zero.")
            .ValidateOnStart();

        services
            .AddOptions<CacheOptions>()
            .Bind(configuration.GetSection(CacheOptions.SectionName))
            .Validate(
                settings => string.Equals(settings.Provider, "Memory", StringComparison.OrdinalIgnoreCase) ||
                            string.Equals(settings.Provider, "Redis", StringComparison.OrdinalIgnoreCase),
                "Cache:Provider must be either Memory or Redis.")
            .Validate(
                settings => settings.DefaultTtlMinutes > 0 &&
                            settings.MemberTtlMinutes > 0 &&
                            settings.CompetitionTtlMinutes > 0 &&
                            settings.WorkspaceTtlMinutes > 0,
                "Cache TTLs must be positive.")
            .ValidateOnStart();

        var cacheOptions = configuration
            .GetSection(CacheOptions.SectionName)
            .Get<CacheOptions>() ?? new CacheOptions();

        if (string.Equals(cacheOptions.Provider, "Redis", StringComparison.OrdinalIgnoreCase))
        {
            if (string.IsNullOrWhiteSpace(cacheOptions.Redis.ConnectionString))
            {
                throw new InvalidOperationException(
                    "Cache:Redis:ConnectionString is required when Cache:Provider is Redis.");
            }

            services.AddStackExchangeRedisCache(options =>
            {
                options.Configuration = cacheOptions.Redis.ConnectionString;
                options.InstanceName = $"{cacheOptions.Redis.InstanceName}:";
            });

            services.AddSingleton<IConnectionMultiplexer>(_ =>
                ConnectionMultiplexer.Connect(cacheOptions.Redis.ConnectionString));
            services.AddSingleton(provider =>
                RedLockFactory.Create(
                    new[]
                    {
                        new RedLockMultiplexer(provider.GetRequiredService<IConnectionMultiplexer>())
                    }));
            services.AddSingleton<IDistributedLockManager, RedisDistributedLockManager>();
        }
        else
        {
            services.AddDistributedMemoryCache();
            services.AddSingleton<IDistributedLockManager, LocalDistributedLockManager>();
        }

        services.AddSingleton<ICacheService, DistributedCacheService>();
        services.AddSingleton(new CookieContainer());

        services
            .AddHttpClient(HttpClientName, (provider, client) =>
            {
                ConfigureClient(provider, client);
            })
            .ConfigurePrimaryHttpMessageHandler(provider => new HttpClientHandler
            {
                CookieContainer = provider.GetRequiredService<CookieContainer>(),
                UseCookies = true,
                AllowAutoRedirect = true
            })
            .SetHandlerLifetime(Timeout.InfiniteTimeSpan);

        services
            .AddHttpClient(NoRedirectHttpClientName, (provider, client) =>
            {
                ConfigureClient(provider, client);
            })
            .ConfigurePrimaryHttpMessageHandler(provider => new HttpClientHandler
            {
                CookieContainer = provider.GetRequiredService<CookieContainer>(),
                UseCookies = true,
                AllowAutoRedirect = false
            })
            .SetHandlerLifetime(Timeout.InfiniteTimeSpan);

        services.AddSingleton<IntelligentGolfLoginService>();
        services.AddSingleton<IntelligentGolfSession>();
        services.AddSingleton<IIntelligentGolfSession>(provider =>
            provider.GetRequiredService<IntelligentGolfSession>());
        services.AddHostedService(provider =>
            provider.GetRequiredService<IntelligentGolfSession>());

        services.AddSingleton<IIntelligentGolfTransport, IntelligentGolfTransport>();
        services.AddSingleton<IIntelligentGolfReportClient, IntelligentGolfReportClient>();

        services.AddIntelligentGolfReportParsers(typeof(Program).Assembly);
        return services;
    }

    private static void ConfigureClient(IServiceProvider provider, HttpClient client)
    {
        var settings = provider.GetRequiredService<IOptions<IntelligentGolfOptions>>().Value;
        client.BaseAddress = new Uri(settings.BaseUrl.TrimEnd('/') + "/");
        client.DefaultRequestHeaders.Add(
            "Accept",
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
        client.DefaultRequestHeaders.Add("Accept-Language", "en-GB,en;q=0.9");
        client.DefaultRequestHeaders.Add(
            "User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/121 Safari/537.36");
    }

    public static IServiceCollection AddIntelligentGolfReportParsers(
        this IServiceCollection services,
        params Assembly[] assemblies)
    {
        foreach (var implementation in assemblies
                     .SelectMany(assembly => assembly.DefinedTypes)
                     .Where(type => type is { IsAbstract: false, IsInterface: false }))
        {
            foreach (var parserInterface in implementation.ImplementedInterfaces.Where(
                         contract => contract.IsGenericType &&
                                     contract.GetGenericTypeDefinition() == typeof(IIntelligentGolfReportParser<>)))
            {
                services.AddSingleton(parserInterface, implementation.AsType());
            }
        }

        return services;
    }
}
