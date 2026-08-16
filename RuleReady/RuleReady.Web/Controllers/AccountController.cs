using System.Text;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.WebUtilities;
using RuleReady.Web.Models;
using RuleReady.Web.Services;
using RuleReady.Web.ViewModels;

namespace RuleReady.Web.Controllers;

[Route("account")]
public sealed class AccountController(
    UserManager<ApplicationUser> userManager,
    SignInManager<ApplicationUser> signInManager,
    IAppEmailSender emailSender,
    IConfiguration configuration) : Controller
{
    [AllowAnonymous]
    [HttpGet("register")]
    public IActionResult Register([FromQuery] string intent = "player") =>
        View(new RegisterViewModel { Intent = intent });

    [AllowAnonymous]
    [ValidateAntiForgeryToken]
    [HttpPost("register")]
    public async Task<IActionResult> Register(RegisterViewModel model, CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid)
        {
            return View(model);
        }

        var user = new ApplicationUser
        {
            UserName = model.Email.Trim(),
            Email = model.Email.Trim(),
            DisplayName = string.IsNullOrWhiteSpace(model.DisplayName) ? null : model.DisplayName.Trim(),
            EnglandGolfMembershipNumber = string.IsNullOrWhiteSpace(model.EnglandGolfMembershipNumber)
                ? null
                : model.EnglandGolfMembershipNumber.Trim()
        };

        var result = await userManager.CreateAsync(user, model.Password);

        if (!result.Succeeded)
        {
            foreach (var error in result.Errors)
            {
                ModelState.AddModelError(string.Empty, error.Description);
            }

            return View(model);
        }

        await signInManager.SignInAsync(user, false);

        return model.Intent.ToLowerInvariant() switch
        {
            "club" => Redirect("/organisations/create?type=Club"),
            "organisation" => Redirect("/organisations/create?type=GoverningBody"),
            "platform" => Redirect("/organisations/create?type=SoftwarePartner"),
            _ => Redirect("/dashboard")
        };
    }

    [AllowAnonymous]
    [HttpGet("login")]
    public IActionResult Login() => View(new LoginViewModel());

    [AllowAnonymous]
    [ValidateAntiForgeryToken]
    [HttpPost("login")]
    public async Task<IActionResult> Login(LoginViewModel model)
    {
        if (!ModelState.IsValid)
        {
            return View(model);
        }

        var result = await signInManager.PasswordSignInAsync(
            model.Email.Trim(),
            model.Password,
            model.RememberMe,
            lockoutOnFailure: true);

        if (!result.Succeeded)
        {
            ModelState.AddModelError(string.Empty, "The email address or password was not recognised.");
            return View(model);
        }

        return Redirect("/dashboard");
    }

    [Authorize]
    [ValidateAntiForgeryToken]
    [HttpPost("logout")]
    public async Task<IActionResult> Logout()
    {
        await signInManager.SignOutAsync();
        return Redirect("/");
    }

    [AllowAnonymous]
    [HttpGet("forgot-password")]
    public IActionResult ForgotPassword() => View(new ForgotPasswordViewModel());

    [AllowAnonymous]
    [ValidateAntiForgeryToken]
    [HttpPost("forgot-password")]
    public async Task<IActionResult> ForgotPassword(ForgotPasswordViewModel model, CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid)
        {
            return View(model);
        }

        var user = await userManager.FindByEmailAsync(model.Email.Trim());

        if (user is not null)
        {
            var token = await userManager.GeneratePasswordResetTokenAsync(user);
            var encoded = WebEncoders.Base64UrlEncode(Encoding.UTF8.GetBytes(token));
            var baseUrl = configuration["RuleReady:PublicBaseUrl"]?.TrimEnd('/') ?? $"{Request.Scheme}://{Request.Host}";
            var url = $"{baseUrl}/account/reset-password?email={Uri.EscapeDataString(user.Email!)}&token={Uri.EscapeDataString(encoded)}";

            await emailSender.SendAsync(
                user.Email!,
                "Reset your RuleReady password",
                $"Reset your RuleReady password using this link:{Environment.NewLine}{url}",
                cancellationToken);
        }

        return View("ForgotPasswordSent");
    }

    [AllowAnonymous]
    [HttpGet("reset-password")]
    public IActionResult ResetPassword(string email, string token) =>
        View(new ResetPasswordViewModel { Email = email, Token = token });

    [AllowAnonymous]
    [ValidateAntiForgeryToken]
    [HttpPost("reset-password")]
    public async Task<IActionResult> ResetPassword(ResetPasswordViewModel model)
    {
        if (!ModelState.IsValid)
        {
            return View(model);
        }

        var user = await userManager.FindByEmailAsync(model.Email.Trim());

        if (user is null)
        {
            return Redirect("/account/login");
        }

        var token = Encoding.UTF8.GetString(WebEncoders.Base64UrlDecode(model.Token));
        var result = await userManager.ResetPasswordAsync(user, token, model.Password);

        if (!result.Succeeded)
        {
            foreach (var error in result.Errors)
            {
                ModelState.AddModelError(string.Empty, error.Description);
            }

            return View(model);
        }

        return Redirect("/account/login");
    }

    [AllowAnonymous]
    [HttpGet("access-denied")]
    public IActionResult AccessDenied() => View();
}
