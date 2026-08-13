using TrophyCabinetDemo.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddRazorPages();
builder.Services.AddSingleton<TrophyMetadataLoader>();
builder.Services.AddSingleton<TrophyCabinetLayoutService>();

var app = builder.Build();

app.UseStaticFiles();
app.MapRazorPages();

app.Run();
