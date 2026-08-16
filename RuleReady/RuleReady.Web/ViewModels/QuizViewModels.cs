using RuleReady.Web.Models;

namespace RuleReady.Web.ViewModels;

public sealed class StartPersonalQuizViewModel
{
    public QuizMode Mode { get; set; } = QuizMode.OwnTime;
    public QuizDifficulty Difficulty { get; set; } = QuizDifficulty.Medium;
    public string Audience { get; set; } = "junior-friendly";
    public string LearningLevel { get; set; } = "foundation";
    public int QuestionCount { get; set; } = 10;
    public int PassMark { get; set; } = 7;
    public int TotalTimeMinutes { get; set; } = 15;
    public int SecondsPerQuestion { get; set; } = 45;
}

public sealed class AnswerQuestionViewModel
{
    public string QuestionId { get; set; } = string.Empty;
    public List<string> SelectedAnswerIds { get; set; } = [];
}

public sealed class CampaignCreateViewModel
{
    public Guid OrganisationId { get; set; }
    public string Name { get; set; } = string.Empty;
    public QuizMode Mode { get; set; } = QuizMode.OwnTime;
    public QuizDifficulty Difficulty { get; set; } = QuizDifficulty.Medium;
    public string Audience { get; set; } = "junior-friendly";
    public string LearningLevel { get; set; } = "foundation";
    public int QuestionCount { get; set; } = 10;
    public int PassMark { get; set; } = 7;
    public int TotalTimeMinutes { get; set; } = 15;
    public int SecondsPerQuestion { get; set; } = 45;
    public DateTimeOffset? OpensAtUtc { get; set; }
    public DateTimeOffset? ClosesAtUtc { get; set; }
    public bool AllowMultipleAttempts { get; set; } = true;
}
