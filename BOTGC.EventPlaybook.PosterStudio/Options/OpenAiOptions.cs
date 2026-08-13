namespace BOTGC.EventPlaybook.PosterStudio.Options;

public sealed class OpenAiOptions
{
    public string ApiKey { get; set; } = string.Empty;

    public string ImageModel { get; set; } = "gpt-image-2";

    public string ImageQuality { get; set; } = "high";

    public string PromptModel { get; set; } = "gpt-5.6";
}
