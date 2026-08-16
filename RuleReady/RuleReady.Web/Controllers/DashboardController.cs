using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using RuleReady.Web.Models;
using RuleReady.Web.Services;

namespace RuleReady.Web.Controllers;

[Authorize]
public sealed class DashboardController(
    UserManager<ApplicationUser> userManager,
    QuizService quizService,
    OrganisationService organisationService) : Controller
{
    [HttpGet("/dashboard")]
    public async Task<IActionResult> Index(CancellationToken cancellationToken)
    {
        var user = await userManager.GetUserAsync(User);
        if (user is null)
        {
            return Challenge();
        }

        ViewData["Attempts"] = await quizService.ListForUserAsync(user.Id, cancellationToken);
        ViewData["Organisations"] = await organisationService.ListForUserAsync(user.Id, cancellationToken);
        return View(user);
    }
}
