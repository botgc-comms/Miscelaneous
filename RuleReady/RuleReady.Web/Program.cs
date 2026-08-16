using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using RuleReady.Web.Data;
using RuleReady.Web.Models;
using RuleReady.Web.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllersWithViews();
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlite(builder.Configuration.GetConnectionString("RuleReady") ?? "Data Source=ruleready.db"));

builder.Services
    .AddIdentity<ApplicationUser, IdentityRole>(options =>
    {
        options.User.RequireUniqueEmail = true;
        options.Password.RequiredLength = 10;
        options.Password.RequireDigit = true;
        options.Password.RequireLowercase = true;
        options.Password.RequireUppercase = true;
        options.Password.RequireNonAlphanumeric = false;
        options.Lockout.MaxFailedAccessAttempts = 5;
        options.SignIn.RequireConfirmedEmail = false;
    })
    .AddEntityFrameworkStores<AppDbContext>()
    .AddDefaultTokenProviders();

builder.Services.ConfigureApplicationCookie(options =>
{
    options.LoginPath = "/account/login";
    options.AccessDeniedPath = "/account/access-denied";
    options.Cookie.Name = "RuleReady.Auth";
    options.Cookie.HttpOnly = true;
    options.Cookie.SameSite = SameSiteMode.Lax;
    options.SlidingExpiration = true;
    options.ExpireTimeSpan = TimeSpan.FromDays(14);
});

builder.Services.AddMemoryCache();
builder.Services.AddScoped<IQuizContentSource, FileQuizContentSource>();
builder.Services.AddScoped<IQuizQuestionProvider, CachedQuizQuestionProvider>();
builder.Services.AddScoped<QuizSelectionEngine>();
builder.Services.AddScoped<QuizService>();
builder.Services.AddScoped<EntitlementService>();
builder.Services.AddScoped<OrganisationService>();
builder.Services.AddScoped<CampaignService>();
builder.Services.AddScoped<IAppEmailSender, FileEmailSender>();
builder.Services.AddHostedService<DatabaseInitialiserHostedService>();

var app = builder.Build();

if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/home/error");
    app.UseHsts();
}

app.UseHttpsRedirection();
app.UseStaticFiles();
app.UseRouting();
app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();

app.Run();
