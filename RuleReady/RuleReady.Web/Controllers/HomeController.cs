using Microsoft.AspNetCore.Mvc;

namespace RuleReady.Web.Controllers;

public sealed class HomeController : Controller
{
    [HttpGet("/")]
    public IActionResult Index() => View();

    [HttpGet("/pricing")]
    public IActionResult Pricing() => View();

    [HttpGet("/home/error")]
    public IActionResult Error() => View();
}
