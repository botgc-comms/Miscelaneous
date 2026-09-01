using System.Text.Json;
using System.Text.Json.Serialization;
using Trophy.Catalogue.Domain;

namespace Trophy.Catalogue.Services;

public sealed class CatalogueStore(IWebHostEnvironment environment, IConfiguration configuration)
{
    private readonly SemaphoreSlim gate = new(1, 1);
    private readonly JsonSerializerOptions jsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = true,
        WriteIndented = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };
    private readonly string dataRoot = ResolveDataRoot(environment, configuration);
    private readonly string seedPath = Path.Combine(environment.ContentRootPath, "Data", "trophies.json");
    private readonly bool skipSeedCatalogue = configuration.GetValue("SKIP_SEED_CATALOGUE", false);
    private CatalogueState state = new();

    private string StatePath => Path.Combine(dataRoot, "catalogue-state.json");
    private string UploadRoot => Path.Combine(dataRoot, "uploads");
    private string IllustrationRoot => Path.Combine(dataRoot, "illustrations");

    public async Task InitializeAsync(CancellationToken cancellationToken = default)
    {
        Directory.CreateDirectory(dataRoot);
        Directory.CreateDirectory(UploadRoot);
        Directory.CreateDirectory(IllustrationRoot);

        await gate.WaitAsync(cancellationToken);
        try
        {
            var seeds = await ReadSeedsAsync(cancellationToken);
            if (File.Exists(StatePath))
            {
                await using var stream = File.OpenRead(StatePath);
                state = await JsonSerializer.DeserializeAsync<CatalogueState>(stream, jsonOptions, cancellationToken) ?? new CatalogueState();
            }

            var existingIds = state.Trophies.Select(trophy => trophy.Id).ToHashSet(StringComparer.OrdinalIgnoreCase);
            foreach (var seed in seeds.Where(seed => !existingIds.Contains(seed.Id))) state.Trophies.Add(FromSeed(seed));

            foreach (var trophy in state.Trophies)
            {
                var seed = seeds.FirstOrDefault(item => item.Id.Equals(trophy.Id, StringComparison.OrdinalIgnoreCase));
                if (seed is not null)
                {
                    trophy.Name = seed.Name;
                    trophy.SecondaryName = seed.SecondaryName;
                    trophy.Category = seed.Category;
                    if (trophy.IllustrationState != IllustrationStates.Complete) trophy.ReferenceImage = seed.ReferenceImage;
                }
                NormalizeEvidenceUrls(trophy);
                if (trophy.IllustrationState == IllustrationStates.Complete)
                    trophy.ReferenceImage = $"/api/trophies/{Uri.EscapeDataString(trophy.Id)}/illustration";
            }

            state.Version = 2;
            state.Trophies = state.Trophies.OrderBy(trophy => trophy.Id, StringComparer.OrdinalIgnoreCase).ToList();
            await SaveUnsafeAsync(cancellationToken);
        }
        finally
        {
            gate.Release();
        }
    }

    public async Task<IReadOnlyList<TrophySummary>> GetSummariesAsync(CancellationToken cancellationToken = default)
    {
        await gate.WaitAsync(cancellationToken);
        try { return state.Trophies.Select(ToSummary).ToList(); }
        finally { gate.Release(); }
    }

    public async Task<TrophyRecord?> GetTrophyAsync(string id, CancellationToken cancellationToken = default)
    {
        await gate.WaitAsync(cancellationToken);
        try
        {
            var trophy = Find(id);
            return trophy is null ? null : Clone(trophy);
        }
        finally { gate.Release(); }
    }

    public async Task<TrophyRecord> CreateTrophyAsync(TrophyCreateInput input, CancellationToken cancellationToken = default)
    {
        await gate.WaitAsync(cancellationToken);
        try
        {
            var requestedCode = SafeSegment(input.Code ?? string.Empty).ToUpperInvariant();
            var id = string.IsNullOrWhiteSpace(requestedCode) ? NextTrophyId() : requestedCode;
            if (id.Length > 24) id = id[..24];
            if (Find(id) is not null) throw new InvalidOperationException("That trophy code is already in use.");
            var trophy = new TrophyRecord
            {
                Id = id,
                Name = input.Name.Trim(),
                SecondaryName = NullIfEmpty(input.SecondaryName),
                Category = string.IsNullOrWhiteSpace(input.Category) ? "Other" : input.Category.Trim(),
                ReferenceImage = "/catalogue/fallback.svg"
            };
            state.Trophies.Add(trophy);
            state.Trophies = state.Trophies.OrderBy(item => item.Id, StringComparer.OrdinalIgnoreCase).ToList();
            await SaveUnsafeAsync(cancellationToken);
            return Clone(trophy);
        }
        finally { gate.Release(); }
    }

    public async Task<EvidenceImage?> AddEvidenceAsync(
        string trophyId,
        string originalName,
        string contentType,
        string kind,
        Stream content,
        CancellationToken cancellationToken = default)
    {
        await gate.WaitAsync(cancellationToken);
        try
        {
            var trophy = Find(trophyId);
            if (trophy is null) return null;
            var evidence = new EvidenceImage
            {
                OriginalName = Path.GetFileName(originalName),
                ContentType = contentType,
                Kind = kind,
                ProcessingState = ProcessingStates.Pending
            };
            evidence.StoredName = $"{evidence.Id}{ExtensionFor(contentType)}";
            evidence.Url = $"/api/trophies/{Uri.EscapeDataString(trophy.Id)}/images/{evidence.Id}";
            var directory = Path.Combine(UploadRoot, SafeSegment(trophy.Id));
            Directory.CreateDirectory(directory);
            var path = Path.Combine(directory, evidence.StoredName);
            await using (var output = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None, 81920, true))
                await content.CopyToAsync(output, cancellationToken);
            trophy.Evidence.Add(evidence);
            trophy.Status = TrophyStatuses.InProgress;
            await SaveUnsafeAsync(cancellationToken);
            return Clone(evidence);
        }
        finally { gate.Release(); }
    }

    public async Task<string?> GetEvidencePathAsync(string trophyId, string evidenceId, CancellationToken cancellationToken = default)
    {
        await gate.WaitAsync(cancellationToken);
        try
        {
            var trophy = Find(trophyId);
            var evidence = trophy?.Evidence.FirstOrDefault(item => item.Id == evidenceId);
            if (evidence is null) return null;
            var directory = Path.Combine(UploadRoot, SafeSegment(trophy!.Id));
            var exact = string.IsNullOrWhiteSpace(evidence.StoredName) ? null : Path.Combine(directory, evidence.StoredName);
            if (exact is not null && File.Exists(exact)) return exact;
            return Directory.Exists(directory) ? Directory.EnumerateFiles(directory, $"{evidence.Id}.*").FirstOrDefault() : null;
        }
        finally { gate.Release(); }
    }

    public async Task<IReadOnlyList<(EvidenceImage Evidence, string Path)>> GetEvidenceFilesAsync(string trophyId, CancellationToken cancellationToken = default)
    {
        await gate.WaitAsync(cancellationToken);
        try
        {
            var trophy = Find(trophyId);
            if (trophy is null) return [];
            var directory = Path.Combine(UploadRoot, SafeSegment(trophy.Id));
            var files = new List<(EvidenceImage, string)>();
            foreach (var evidence in trophy.Evidence.OrderBy(item => item.UploadedAt))
            {
                var exact = string.IsNullOrWhiteSpace(evidence.StoredName) ? null : Path.Combine(directory, evidence.StoredName);
                var path = exact is not null && File.Exists(exact)
                    ? exact
                    : Directory.Exists(directory) ? Directory.EnumerateFiles(directory, $"{evidence.Id}.*").FirstOrDefault() : null;
                if (path is not null) files.Add((Clone(evidence), path));
            }
            return files;
        }
        finally { gate.Release(); }
    }

    public async Task<bool> DeleteEvidenceAsync(string trophyId, string evidenceId, CancellationToken cancellationToken = default)
    {
        await gate.WaitAsync(cancellationToken);
        try
        {
            var trophy = Find(trophyId);
            var evidence = trophy?.Evidence.FirstOrDefault(item => item.Id == evidenceId);
            if (trophy is null || evidence is null) return false;
            trophy.Evidence.Remove(evidence);
            foreach (var winner in trophy.Winners) winner.EvidenceImageIds.Remove(evidenceId);
            var directory = Path.Combine(UploadRoot, SafeSegment(trophy.Id));
            if (Directory.Exists(directory))
                foreach (var path in Directory.EnumerateFiles(directory, $"{evidence.Id}.*")) File.Delete(path);
            trophy.Status = TrophyStatuses.InProgress;
            await SaveUnsafeAsync(cancellationToken);
            return true;
        }
        finally { gate.Release(); }
    }

    public async Task SetEvidenceProcessingAsync(
        string trophyId,
        string evidenceId,
        string processingState,
        string? message,
        CancellationToken cancellationToken = default)
    {
        await gate.WaitAsync(cancellationToken);
        try
        {
            var evidence = Find(trophyId)?.Evidence.FirstOrDefault(item => item.Id == evidenceId);
            if (evidence is null) return;
            evidence.ProcessingState = processingState;
            evidence.ProcessingMessage = message;
            await SaveUnsafeAsync(cancellationToken);
        }
        finally { gate.Release(); }
    }

    public async Task<TrophyRecord?> MergeAiExtractionAsync(
        string trophyId,
        AiExtraction extraction,
        IReadOnlyCollection<string> evidenceIds,
        CancellationToken cancellationToken = default)
    {
        await gate.WaitAsync(cancellationToken);
        try
        {
            var trophy = Find(trophyId);
            if (trophy is null) return null;
            trophy.Winners.RemoveAll(winner => winner.Source == WinnerSources.Ai && winner.ReviewState != ReviewStates.Confirmed);
            var protectedYears = trophy.Winners.Select(winner => winner.Year).ToHashSet();
            foreach (var entry in extraction.Entries
                         .Where(entry => entry.Year is >= 1800 and <= 2200 && !string.IsNullOrWhiteSpace(entry.Winner))
                         .GroupBy(entry => entry.Year)
                         .Select(group => group.OrderByDescending(entry => entry.Confidence).First())
                         .Where(entry => !protectedYears.Contains(entry.Year)))
            {
                trophy.Winners.Add(new WinnerRecord
                {
                    Year = entry.Year,
                    Name = entry.Winner.Trim(),
                    Confidence = Math.Clamp(entry.Confidence, 0, 1),
                    ReviewState = ReviewStates.NeedsReview,
                    Source = WinnerSources.Ai,
                    Notes = NullIfEmpty(entry.Notes),
                    EvidenceImageIds = evidenceIds.ToList()
                });
            }
            trophy.Winners = trophy.Winners.OrderBy(winner => winner.Year).ThenBy(winner => winner.Name).ToList();
            trophy.Status = TrophyStatuses.InProgress;
            await SaveUnsafeAsync(cancellationToken);
            return Clone(trophy);
        }
        finally { gate.Release(); }
    }

    public async Task<WinnerRecord?> AddWinnerAsync(string trophyId, WinnerInput input, CancellationToken cancellationToken = default)
    {
        await gate.WaitAsync(cancellationToken);
        try
        {
            var trophy = Find(trophyId);
            if (trophy is null) return null;
            var winner = new WinnerRecord
            {
                Year = input.Year,
                Name = input.Name.Trim(),
                Notes = NullIfEmpty(input.Notes),
                ReviewState = NormalizeReviewState(input.ReviewState),
                Source = WinnerSources.Manual,
                Confidence = 1
            };
            trophy.Winners.Add(winner);
            trophy.Winners = trophy.Winners.OrderBy(item => item.Year).ThenBy(item => item.Name).ToList();
            trophy.Status = TrophyStatuses.InProgress;
            await SaveUnsafeAsync(cancellationToken);
            return Clone(winner);
        }
        finally { gate.Release(); }
    }

    public async Task<WinnerRecord?> UpdateWinnerAsync(string trophyId, string winnerId, WinnerInput input, CancellationToken cancellationToken = default)
    {
        await gate.WaitAsync(cancellationToken);
        try
        {
            var trophy = Find(trophyId);
            var winner = trophy?.Winners.FirstOrDefault(item => item.Id == winnerId);
            if (trophy is null || winner is null) return null;
            winner.Year = input.Year;
            winner.Name = input.Name.Trim();
            winner.Notes = NullIfEmpty(input.Notes);
            winner.ReviewState = NormalizeReviewState(input.ReviewState);
            winner.Source = WinnerSources.Manual;
            winner.MemberMatch = null;
            if (winner.ReviewState == ReviewStates.Confirmed) winner.Confidence = 1;
            winner.UpdatedAt = DateTimeOffset.UtcNow;
            trophy.Winners = trophy.Winners.OrderBy(item => item.Year).ThenBy(item => item.Name).ToList();
            trophy.Status = TrophyStatuses.InProgress;
            await SaveUnsafeAsync(cancellationToken);
            return Clone(winner);
        }
        finally { gate.Release(); }
    }

    public async Task<bool> DeleteWinnerAsync(string trophyId, string winnerId, CancellationToken cancellationToken = default)
    {
        await gate.WaitAsync(cancellationToken);
        try
        {
            var trophy = Find(trophyId);
            var winner = trophy?.Winners.FirstOrDefault(item => item.Id == winnerId);
            if (trophy is null || winner is null) return false;
            trophy.Winners.Remove(winner);
            trophy.Status = TrophyStatuses.InProgress;
            await SaveUnsafeAsync(cancellationToken);
            return true;
        }
        finally { gate.Release(); }
    }

    public async Task<TrophyRecord?> UpdateTimelineAsync(string trophyId, TimelineInput input, CancellationToken cancellationToken = default)
    {
        await gate.WaitAsync(cancellationToken);
        try
        {
            var trophy = Find(trophyId);
            if (trophy is null) return null;
            trophy.TimelineStartYear = input.StartYear;
            trophy.TimelineEndYear = input.EndYear;
            trophy.Status = TrophyStatuses.InProgress;
            await SaveUnsafeAsync(cancellationToken);
            return Clone(trophy);
        }
        finally { gate.Release(); }
    }

    public async Task<TrophyRecord?> MarkCompleteAsync(string trophyId, CancellationToken cancellationToken = default)
    {
        await gate.WaitAsync(cancellationToken);
        try
        {
            var trophy = Find(trophyId);
            if (trophy is null) return null;
            trophy.Status = TrophyStatuses.Complete;
            trophy.LastSavedAt = DateTimeOffset.UtcNow;
            await SaveUnsafeAsync(cancellationToken);
            return Clone(trophy);
        }
        finally { gate.Release(); }
    }

    public async Task SetIllustrationStatusAsync(string trophyId, string status, string? message, CancellationToken cancellationToken = default)
    {
        await gate.WaitAsync(cancellationToken);
        try
        {
            var trophy = Find(trophyId);
            if (trophy is null) return;
            trophy.IllustrationState = status;
            trophy.IllustrationMessage = message;
            await SaveUnsafeAsync(cancellationToken);
        }
        finally { gate.Release(); }
    }

    public async Task<TrophyRecord?> SaveIllustrationAsync(string trophyId, byte[] image, CancellationToken cancellationToken = default)
    {
        await gate.WaitAsync(cancellationToken);
        try
        {
            var trophy = Find(trophyId);
            if (trophy is null) return null;
            var path = Path.Combine(IllustrationRoot, $"{SafeSegment(trophy.Id)}.png");
            var tempPath = $"{path}.{Guid.NewGuid():N}.tmp";
            await File.WriteAllBytesAsync(tempPath, image, cancellationToken);
            File.Move(tempPath, path, true);
            trophy.ReferenceImage = $"/api/trophies/{Uri.EscapeDataString(trophy.Id)}/illustration";
            trophy.IllustrationState = IllustrationStates.Complete;
            trophy.IllustrationMessage = "Illustration generated from the saved trophy photographs.";
            trophy.IllustrationGenerationCount++;
            trophy.IllustrationGeneratedAt = DateTimeOffset.UtcNow;
            await SaveUnsafeAsync(cancellationToken);
            return Clone(trophy);
        }
        finally { gate.Release(); }
    }

    public async Task<string?> GetIllustrationPathAsync(string trophyId, CancellationToken cancellationToken = default)
    {
        await gate.WaitAsync(cancellationToken);
        try
        {
            var trophy = Find(trophyId);
            if (trophy?.IllustrationState != IllustrationStates.Complete) return null;
            var path = Path.Combine(IllustrationRoot, $"{SafeSegment(trophy.Id)}.png");
            return File.Exists(path) ? path : null;
        }
        finally { gate.Release(); }
    }

    public async Task<TrophyRecord?> ApplyMemberMatchesAsync(
        string trophyId,
        IReadOnlyDictionary<string, MemberMatchRecord?> matches,
        CancellationToken cancellationToken = default)
    {
        await gate.WaitAsync(cancellationToken);
        try
        {
            var trophy = Find(trophyId);
            if (trophy is null) return null;
            foreach (var winner in trophy.Winners)
                if (matches.TryGetValue(winner.Id, out var match)) winner.MemberMatch = match;
            await SaveUnsafeAsync(cancellationToken);
            return Clone(trophy);
        }
        finally { gate.Release(); }
    }

    public async Task ClearMemberMatchesAsync(CancellationToken cancellationToken = default)
    {
        await gate.WaitAsync(cancellationToken);
        try
        {
            foreach (var winner in state.Trophies.SelectMany(trophy => trophy.Winners)) winner.MemberMatch = null;
            await SaveUnsafeAsync(cancellationToken);
        }
        finally { gate.Release(); }
    }

    public static IReadOnlyList<int> MissingYears(TrophyRecord trophy)
    {
        if (trophy.Winners.Count < 2 && (!trophy.TimelineStartYear.HasValue || !trophy.TimelineEndYear.HasValue)) return [];
        var years = trophy.Winners.Select(winner => winner.Year).ToHashSet();
        var start = trophy.TimelineStartYear ?? years.Min();
        var end = trophy.TimelineEndYear ?? years.Max();
        if (start > end || end - start > 250) return [];
        return Enumerable.Range(start, end - start + 1).Where(year => !years.Contains(year)).ToList();
    }

    private async Task<List<TrophySeed>> ReadSeedsAsync(CancellationToken cancellationToken)
    {
        if (skipSeedCatalogue) return [];
        if (!File.Exists(seedPath)) throw new FileNotFoundException("The trophy seed catalogue is missing.", seedPath);
        await using var stream = File.OpenRead(seedPath);
        return await JsonSerializer.DeserializeAsync<List<TrophySeed>>(stream, jsonOptions, cancellationToken) ?? [];
    }

    private static TrophyRecord FromSeed(TrophySeed seed) => new()
    {
        Id = seed.Id,
        Name = seed.Name,
        SecondaryName = seed.SecondaryName,
        Category = seed.Category,
        ReferenceImage = seed.ReferenceImage
    };

    private TrophyRecord? Find(string id) => state.Trophies.FirstOrDefault(trophy => trophy.Id.Equals(id, StringComparison.OrdinalIgnoreCase));
    private string NextTrophyId()
    {
        for (var number = 1; number <= 99999; number++)
        {
            var candidate = $"T{number:000}";
            if (Find(candidate) is null) return candidate;
        }
        return $"T{Guid.NewGuid():N}"[..12].ToUpperInvariant();
    }

    private TrophySummary ToSummary(TrophyRecord trophy) => new(
        trophy.Id,
        trophy.Name,
        trophy.SecondaryName,
        trophy.Category,
        trophy.ReferenceImage,
        trophy.Status,
        trophy.Winners.Count,
        trophy.Evidence.Count,
        trophy.Winners.Count(winner => winner.ReviewState != ReviewStates.Confirmed),
        MissingYears(trophy).Count,
        trophy.LastSavedAt);

    private async Task SaveUnsafeAsync(CancellationToken cancellationToken)
    {
        state.UpdatedAt = DateTimeOffset.UtcNow;
        var tempPath = $"{StatePath}.{Guid.NewGuid():N}.tmp";
        await using (var stream = new FileStream(tempPath, FileMode.CreateNew, FileAccess.Write, FileShare.None, 81920, true))
            await JsonSerializer.SerializeAsync(stream, state, jsonOptions, cancellationToken);
        File.Move(tempPath, StatePath, true);
    }

    private T Clone<T>(T value) => JsonSerializer.Deserialize<T>(JsonSerializer.Serialize(value, jsonOptions), jsonOptions)!;
    private static string ResolveDataRoot(IWebHostEnvironment environment, IConfiguration configuration)
    {
        var configured = configuration["DATA_PATH"];
        return string.IsNullOrWhiteSpace(configured) ? Path.Combine(environment.ContentRootPath, "data-store") : Path.GetFullPath(configured);
    }

    private static string ExtensionFor(string contentType) => contentType.ToLowerInvariant() switch
    {
        "image/png" => ".png",
        "image/webp" => ".webp",
        _ => ".jpg"
    };

    private static string SafeSegment(string value) => string.Concat(value.Where(character => char.IsLetterOrDigit(character) || character is '-' or '_'));
    private static string NormalizeReviewState(string value) => value == ReviewStates.Confirmed ? ReviewStates.Confirmed : ReviewStates.NeedsReview;
    private static string? NullIfEmpty(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    private static void NormalizeEvidenceUrls(TrophyRecord trophy)
    {
        foreach (var evidence in trophy.Evidence)
            evidence.Url = $"/api/trophies/{Uri.EscapeDataString(trophy.Id)}/images/{evidence.Id}";
    }
}
