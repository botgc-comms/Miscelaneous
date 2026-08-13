# BOTGC Event Playbook – Poster Studio

A .NET 8 ASP.NET Core prototype for creating event artwork inside the Burton-on-Trent Golf Club Event Playbook.

## Technology

- .NET 8 / ASP.NET Core
- C# backend
- Static HTML, CSS and JavaScript frontend served by ASP.NET Core
- OpenAI GPT-5.6 creative-director prompt generation
- GPT Image 2 image generation and editing
- JSON-driven event scene recipes, style presets and output composition rules
- Mock generation when no OpenAI API key is available

## OpenAI configuration

The server uses environment variables and never exposes the API key to browser code.

```text
OPENAI_API_KEY
OPENAI_IMAGE_MODEL
OPENAI_IMAGE_QUALITY
OPENAI_PROMPT_MODEL
```

Defaults:

```text
OPENAI_IMAGE_MODEL=gpt-image-2
OPENAI_IMAGE_QUALITY=high
OPENAI_PROMPT_MODEL=gpt-5.6
```

The existing `OPENAI_API_KEY` environment variable is used for both the creative-director call and the image-generation calls.

## Prompt architecture

The image prompt is no longer a short concatenation of the event description and style name.

For every primary generation the application sends structured information to the prompt model:

1. global image-generation rules;
2. event description and event-specific scene recipe;
3. selected style direction, visual language, mood and exclusions;
4. output-format composition and protected overlay zones;
5. organiser-specific instructions;
6. optional regeneration/refinement feedback.

GPT-5.6 acts as a creative director and turns those layers into the final detailed GPT Image 2 prompt.

If prompt generation fails, the application uses a detailed deterministic fallback prompt rather than stopping the campaign.

The style preset name is metadata only. It is explicitly prohibited from appearing as visible text in the generated artwork or in the application's final poster overlay.

## Poster composition

The AI creates the campaign illustration only. The browser then applies controlled Club typography for:

- Burton-on-Trent Golf Club;
- event title;
- optional event date;
- optional price;
- footer treatment.

The selected style name is not rendered into the finished poster.

## Running locally

```powershell
dotnet run
```

Open the URL shown by ASP.NET Core.

## Verify the configured models

At startup the application logs the key source and effective models without logging the secret key.

The `/api/poster/config` endpoint also returns:

- `generationMode`
- `imageModel`
- `imageQuality`
- `promptModel`
- `apiKeySource`

The page displays the effective configuration, for example:

```text
OpenAI live generation · gpt-image-2 · high · creative director gpt-5.6
```

## Poster outputs

- Clubhouse display: 2160 × 3840
- Email / social: 1080 × 1080
- A4 print: 2480 × 3508

The clubhouse display is the primary generation. Selected derivative outputs are created from the approved primary artwork so they retain the same campaign concept while being deliberately recomposed for their target aspect ratios.
