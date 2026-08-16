using Microsoft.AspNetCore.Mvc;

namespace RuleReady.Web.Controllers;

public sealed class QuizContentController(IWebHostEnvironment environment, IConfiguration configuration) : Controller
{
    [HttpGet("/quiz-content/{questionId}/{fileName}")]
    public IActionResult Get(string questionId, string fileName)
    {
        if (questionId.Contains("..", StringComparison.Ordinal) || fileName.Contains("..", StringComparison.Ordinal))
        {
            return BadRequest();
        }

        var root = configuration["Quiz:ContentRoot"] ?? "Content/questions";
        var path = Path.Combine(environment.ContentRootPath, root, questionId, fileName);

        if (!System.IO.File.Exists(path))
        {
            return NotFound();
        }

        var extension = Path.GetExtension(path).ToLowerInvariant();
        var contentType = extension switch
        {
            ".png" => "image/png",
            ".jpg" or ".jpeg" => "image/jpeg",
            ".webp" => "image/webp",
            _ => "application/octet-stream"
        };

        return PhysicalFile(path, contentType);
    }
}
