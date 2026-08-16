using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Caching.Memory;
using RuleReady.Web.Models;

namespace RuleReady.Web.Services;

public interface IQuizContentSource
{
    Task<QuizContentSnapshot> LoadAsync(CancellationToken cancellationToken = default);
}

public interface IQuizQuestionProvider
{
    Task<QuizContentSnapshot> GetSnapshotAsync(CancellationToken cancellationToken = default);
}

public sealed class FileQuizContentSource(IWebHostEnvironment environment, IConfiguration configuration) : IQuizContentSource
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true
    };

    public async Task<QuizContentSnapshot> LoadAsync(CancellationToken cancellationToken = default)
    {
        var configuredRoot = configuration["Quiz:ContentRoot"] ?? "Content/questions";
        var root = Path.Combine(environment.ContentRootPath, configuredRoot);

        if (!Directory.Exists(root))
        {
            return new QuizContentSnapshot(DateTimeOffset.UtcNow, []);
        }

        var questions = new List<QuizQuestion>();

        foreach (var directory in Directory.EnumerateDirectories(root))
        {
            cancellationToken.ThrowIfCancellationRequested();

            var metadataPath = new[] { "metadata.json", "meta.json" }
                .Select(name => Path.Combine(directory, name))
                .FirstOrDefault(File.Exists);

            if (metadataPath is null)
            {
                continue;
            }

            var json = await File.ReadAllTextAsync(metadataPath, cancellationToken);
            var metadata = JsonSerializer.Deserialize<QuizMetadata>(json, JsonOptions)
                ?? throw new InvalidOperationException($"Unable to parse {metadataPath}.");

            var questionId = Path.GetFileName(directory);
            var variants = metadata.Questions.Select(ToVariant).ToArray();

            if (variants.Length == 0)
            {
                continue;
            }

            var fallback = variants.FirstOrDefault(x => x.Audience.Equals("junior-friendly", StringComparison.OrdinalIgnoreCase))
                ?? variants[0];

            var imagePath = FindImage(directory);
            var imageUrl = imagePath is null
                ? null
                : $"/quiz-content/{Uri.EscapeDataString(questionId)}/{Uri.EscapeDataString(Path.GetFileName(imagePath))}";

            questions.Add(new QuizQuestion(
                questionId,
                metadata.RuleNumber ?? string.Empty,
                metadata.RuleName ?? string.Empty,
                Slugify(metadata.Group ?? metadata.RuleName ?? "general"),
                ParseDifficulty(metadata.Difficulty),
                fallback.Question,
                fallback.Type,
                fallback.Choices,
                fallback.CorrectAnswers,
                fallback.Explanation,
                imageUrl,
                metadata.ImageAlt,
                variants,
                fallback.Vocabulary,
                fallback.TeachingTip,
                fallback.LikelyMisconceptions));
        }

        return new QuizContentSnapshot(DateTimeOffset.UtcNow, questions);
    }

    public static string GetContentVersion(QuizContentSnapshot snapshot)
    {
        var payload = string.Join("|", snapshot.Questions
            .OrderBy(x => x.Id, StringComparer.Ordinal)
            .Select(x => $"{x.Id}:{x.RuleNumber}:{x.Question}:{string.Join(",", x.CorrectAnswers)}"));

        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(payload))).ToLowerInvariant();
    }

    private static QuizQuestionVariant ToVariant(QuizMetadataQuestion source)
    {
        return new QuizQuestionVariant(
            source.Audience ?? "standard",
            source.LearningLevel ?? InferLearningLevel(source.Audience),
            source.Question,
            source.Type,
            source.Choices.Select(x => new QuizChoice(x.Id, x.Text)).ToArray(),
            GetCorrectAnswers(source),
            source.Explanation,
            source.Vocabulary.Select(x => new VocabularyItem(x.Term, x.SimpleMeaning)).ToArray(),
            source.TeachingTip ?? string.Empty,
            source.LikelyMisconceptions ?? []);
    }

    private static IReadOnlyList<string> GetCorrectAnswers(QuizMetadataQuestion source)
    {
        if (source.CorrectAnswers is { Count: > 0 })
        {
            return source.CorrectAnswers.Distinct(StringComparer.Ordinal).ToArray();
        }

        if (source.CorrectAnswer.ValueKind == JsonValueKind.String)
        {
            var value = source.CorrectAnswer.GetString();
            return string.IsNullOrWhiteSpace(value) ? [] : [value];
        }

        if (source.CorrectAnswer.ValueKind == JsonValueKind.Array)
        {
            return source.CorrectAnswer.EnumerateArray()
                .Where(x => x.ValueKind == JsonValueKind.String)
                .Select(x => x.GetString())
                .Where(x => !string.IsNullOrWhiteSpace(x))
                .Select(x => x!)
                .Distinct(StringComparer.Ordinal)
                .ToArray();
        }

        return [];
    }

    private static QuizDifficulty ParseDifficulty(string? value) =>
        Enum.TryParse<QuizDifficulty>(value, true, out var result) ? result : QuizDifficulty.Easy;

    private static string InferLearningLevel(string? audience) =>
        audience?.Equals("junior-friendly", StringComparison.OrdinalIgnoreCase) == true ? "foundation" : "standard";

    private static string? FindImage(string directory)
    {
        var names = new[] { "illustration.png", "image.png", "illustration.jpg", "image.jpg", "illustration.webp", "image.webp" };
        return names.Select(name => Path.Combine(directory, name)).FirstOrDefault(File.Exists);
    }

    private static string Slugify(string value)
    {
        var chars = value.ToLowerInvariant().Select(ch => char.IsLetterOrDigit(ch) ? ch : '-').ToArray();
        return string.Join("-", new string(chars).Split('-', StringSplitOptions.RemoveEmptyEntries));
    }

    private sealed class QuizMetadata
    {
        [JsonPropertyName("difficulty")]
        public string? Difficulty { get; set; }

        [JsonPropertyName("ruleNumber")]
        public string? RuleNumber { get; set; }

        [JsonPropertyName("ruleName")]
        public string? RuleName { get; set; }

        [JsonPropertyName("group")]
        public string? Group { get; set; }

        [JsonPropertyName("imageAlt")]
        public string? ImageAlt { get; set; }

        [JsonPropertyName("questions")]
        public List<QuizMetadataQuestion> Questions { get; set; } = [];
    }

    private sealed class QuizMetadataQuestion
    {
        [JsonPropertyName("audience")]
        public string? Audience { get; set; }

        [JsonPropertyName("learningLevel")]
        public string? LearningLevel { get; set; }

        [JsonPropertyName("question")]
        public required string Question { get; set; }

        [JsonPropertyName("type")]
        public required string Type { get; set; }

        [JsonPropertyName("choices")]
        public List<QuizMetadataChoice> Choices { get; set; } = [];

        [JsonPropertyName("correctAnswer")]
        public JsonElement CorrectAnswer { get; set; }

        [JsonPropertyName("correctAnswers")]
        public List<string>? CorrectAnswers { get; set; }

        [JsonPropertyName("explanation")]
        public required string Explanation { get; set; }

        [JsonPropertyName("vocabulary")]
        public List<QuizMetadataVocabulary> Vocabulary { get; set; } = [];

        [JsonPropertyName("teachingTip")]
        public string? TeachingTip { get; set; }

        [JsonPropertyName("likelyMisconceptions")]
        public List<string>? LikelyMisconceptions { get; set; }
    }

    private sealed class QuizMetadataChoice
    {
        public required string Id { get; set; }
        public required string Text { get; set; }
    }

    private sealed class QuizMetadataVocabulary
    {
        public required string Term { get; set; }
        public required string SimpleMeaning { get; set; }
    }
}

public sealed class CachedQuizQuestionProvider(
    IMemoryCache cache,
    IQuizContentSource source,
    IConfiguration configuration) : IQuizQuestionProvider
{
    private const string CacheKey = "ruleready:quiz-content";

    public async Task<QuizContentSnapshot> GetSnapshotAsync(CancellationToken cancellationToken = default)
    {
        if (cache.TryGetValue<QuizContentSnapshot>(CacheKey, out var existing) && existing is not null)
        {
            return existing;
        }

        var snapshot = await source.LoadAsync(cancellationToken);
        var minutes = configuration.GetValue("Quiz:CacheMinutes", 30);
        cache.Set(CacheKey, snapshot, TimeSpan.FromMinutes(minutes));
        return snapshot;
    }
}
