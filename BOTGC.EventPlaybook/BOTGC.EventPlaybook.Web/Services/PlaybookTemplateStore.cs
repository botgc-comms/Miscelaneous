using System.Text.Json;
using System.Text.Json.Nodes;
using BOTGC.EventPlaybook.Models;

namespace BOTGC.EventPlaybook.Services;

public interface IPlaybookTemplateStore
{
    Task<PlaybookTemplateDocument> GetAsync(CancellationToken cancellationToken);

    Task<PlaybookTemplateDocument> SaveAsync(SavePlaybookTemplateRequest request, CancellationToken cancellationToken);

    Task<PlaybookTemplateDocument> ResetAsync(long expectedRevision, CancellationToken cancellationToken);

    JsonElement ValidateAndClone(JsonElement template);

    IReadOnlySet<string> ProtectedQuestionIds { get; }
}

public sealed class PlaybookTemplateStore : IPlaybookTemplateStore
{
    private readonly string _documentPath;
    private readonly JsonObject _coreTemplate;
    private readonly Dictionary<string, JsonObject> _protectedQuestions;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly ILogger<PlaybookTemplateStore> _logger;
    private readonly JsonSerializerOptions _jsonOptions = new(JsonSerializerDefaults.Web) { WriteIndented = true };

    public PlaybookTemplateStore(IWebHostEnvironment environment, ILogger<PlaybookTemplateStore> logger)
    {
        _logger = logger;
        var dataDirectory = Path.Combine(environment.ContentRootPath, "App_Data");
        Directory.CreateDirectory(dataDirectory);
        _documentPath = Path.Combine(dataDirectory, "playbook-template.json");

        var corePath = Path.Combine(environment.ContentRootPath, "Data", "event-playbook.json");
        _coreTemplate = JsonNode.Parse(File.ReadAllText(corePath))?.AsObject()
            ?? throw new InvalidDataException("The bundled Event Playbook is not valid JSON.");
        _protectedQuestions = FindProtectedQuestions(_coreTemplate);
        ValidateTemplate(_coreTemplate, requireProtectedQuestions: true);
    }

    public IReadOnlySet<string> ProtectedQuestionIds => _protectedQuestions.Keys.ToHashSet(StringComparer.Ordinal);

    public async Task<PlaybookTemplateDocument> GetAsync(CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            return await LoadDocumentAsync(cancellationToken);
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<PlaybookTemplateDocument> SaveAsync(
        SavePlaybookTemplateRequest request,
        CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var current = await LoadDocumentAsync(cancellationToken);
            if (request.ExpectedRevision != current.Revision)
            {
                throw new PlaybookTemplateConflictException(current);
            }

            var validated = ValidateNode(request.Template);
            var next = CreateDocument(
                current.Revision + 1,
                NormaliseSource(request.Source),
                validated);
            await WriteAtomicallyAsync(next, cancellationToken);
            return next;
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<PlaybookTemplateDocument> ResetAsync(long expectedRevision, CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var current = await LoadDocumentAsync(cancellationToken);
            if (expectedRevision != current.Revision)
            {
                throw new PlaybookTemplateConflictException(current);
            }

            var next = CreateDocument(current.Revision + 1, "bundled-core-reset", _coreTemplate.DeepClone().AsObject());
            await WriteAtomicallyAsync(next, cancellationToken);
            return next;
        }
        finally
        {
            _gate.Release();
        }
    }

    public JsonElement ValidateAndClone(JsonElement template) =>
        JsonSerializer.SerializeToElement(ValidateNode(template), _jsonOptions);

    private JsonObject ValidateNode(JsonElement template)
    {
        if (template.ValueKind != JsonValueKind.Object)
        {
            throw new ArgumentException("The Playbook template must be a JSON object.");
        }

        var candidate = JsonNode.Parse(template.GetRawText())?.AsObject()
            ?? throw new ArgumentException("The Playbook template could not be read.");
        ValidateTemplate(candidate, requireProtectedQuestions: true);
        return candidate;
    }

    private void ValidateTemplate(JsonObject candidate, bool requireProtectedQuestions)
    {
        var modules = candidate["modules"] as JsonArray
            ?? throw new ArgumentException("The Playbook must contain a modules array.");
        if (modules.Count == 0) throw new ArgumentException("The Playbook must contain at least one module.");

        var deadlineDefinitions = candidate["deadlineCodes"] as JsonArray
            ?? throw new ArgumentException("The Playbook must contain a deadlineCodes array.");
        var roleDefinitions = candidate["responsibilityRoles"] as JsonArray
            ?? throw new ArgumentException("The Playbook must contain a responsibilityRoles array.");
        var deadlineCodes = ReadIds(deadlineDefinitions, "code", "deadline code");
        var roleIds = ReadIds(roleDefinitions, "id", "responsibility role");
        var moduleIds = new HashSet<string>(StringComparer.Ordinal);
        var sectionIds = new HashSet<string>(StringComparer.Ordinal);
        var itemIds = new HashSet<string>(StringComparer.Ordinal);
        var itemTypes = new Dictionary<string, string>(StringComparer.Ordinal);
        var questions = new Dictionary<string, JsonObject>(StringComparer.Ordinal);
        var tasks = new List<JsonObject>();
        var itemRecords = new List<JsonObject>();

        foreach (var moduleNode in modules)
        {
            var module = moduleNode as JsonObject ?? throw new ArgumentException("Every module must be an object.");
            var moduleId = RequiredString(module, "id", "Every module must have an id.");
            RequiredString(module, "title", $"Module {moduleId} must have a title.");
            if (!moduleIds.Add(moduleId)) throw new ArgumentException($"Duplicate module id: {moduleId}.");
            var sections = module["sections"] as JsonArray
                ?? throw new ArgumentException($"Module {moduleId} must contain a sections array.");

            foreach (var sectionNode in sections)
            {
                var section = sectionNode as JsonObject ?? throw new ArgumentException($"Module {moduleId} contains an invalid section.");
                var sectionId = RequiredString(section, "id", $"A section in {moduleId} has no id.");
                if (!sectionIds.Add(sectionId)) throw new ArgumentException($"Duplicate section id: {sectionId}.");
                var items = section["items"] as JsonArray
                    ?? throw new ArgumentException($"Section {sectionId} must contain an items array.");
                foreach (var itemNode in items)
                {
                    var item = itemNode as JsonObject ?? throw new ArgumentException($"Section {sectionId} contains an invalid item.");
                    var id = RequiredString(item, "id", $"An item in {sectionId} has no id.");
                    var type = RequiredString(item, "type", $"Item {id} has no type.");
                    if (!itemIds.Add(id)) throw new ArgumentException($"Duplicate item id: {id}.");
                    itemTypes[id] = type;
                    if (type == "question")
                    {
                        RequiredString(item, "label", $"Question {id} has no wording.");
                        questions[id] = item;
                    }
                    else if (type == "task")
                    {
                        RequiredString(item, "title", $"Task {id} has no wording.");
                        tasks.Add(item);
                    }
                    else if (type == "note")
                    {
                        RequiredString(item, "title", $"Note {id} has no title.");
                    }
                    else
                    {
                        throw new ArgumentException($"Item {id} uses unsupported type {type}.");
                    }
                    itemRecords.Add(item);
                }
            }
        }

        foreach (var (questionId, question) in questions)
        {
            if (!IsTrue(question["allowDontKnow"])) continue;
            if (question["dontKnowTask"] is not JsonObject decisionTaskDefinition)
                throw new ArgumentException($"{questionId} allows Don't know but does not define a decision task.");

            var decisionTask = decisionTaskDefinition.DeepClone().AsObject();
            var decisionTaskId = OptionalString(decisionTask, "id");
            if (decisionTaskId.Length == 0) decisionTaskId = $"{questionId}-decision-task";
            decisionTask["id"] = decisionTaskId;
            decisionTask["type"] = "task";
            RequiredString(decisionTask, "title", $"Task {decisionTaskId} has no wording.");
            if (!itemIds.Add(decisionTaskId)) throw new ArgumentException($"Duplicate item id: {decisionTaskId}.");
            itemTypes[decisionTaskId] = "task";
            tasks.Add(decisionTask);
        }

        foreach (var item in itemRecords)
        {
            var id = item["id"]!.GetValue<string>();
            foreach (var questionId in ReferencedQuestions(item["showWhen"]))
            {
                if (!questions.ContainsKey(questionId)) throw new ArgumentException($"{id} references missing question {questionId}.");
            }
        }

        foreach (var task in tasks)
        {
            var id = task["id"]!.GetValue<string>();
            var deadlineCode = OptionalString(task, "deadlineCode");
            if (deadlineCode.Length > 0 && !deadlineCodes.Contains(deadlineCode))
                throw new ArgumentException($"{id} uses unknown deadline code {deadlineCode}.");
            var expiryDeadlineCode = OptionalString(task, "expiresAfterDeadlineCode");
            if (expiryDeadlineCode.Length > 0 && !deadlineCodes.Contains(expiryDeadlineCode))
                throw new ArgumentException($"{id} uses unknown expiry deadline code {expiryDeadlineCode}.");
            var ownerRoleId = OptionalString(task, "defaultOwnerRoleId");
            if (ownerRoleId.Length > 0 && !roleIds.Contains(ownerRoleId))
                throw new ArgumentException($"{id} uses unknown owner role {ownerRoleId}.");
            var ownerQuestionId = OptionalString(task, "ownerFromQuestionId");
            if (ownerQuestionId.Length > 0 &&
                (!questions.TryGetValue(ownerQuestionId, out var ownerQuestion) ||
                 OptionalString(ownerQuestion, "answerType") != "assignment"))
                throw new ArgumentException($"{id} owner source must reference an assignment question.");

            ValidateReviewSummary(task, id, questions);
            ValidateStaffBriefing(task, id);
        }

        foreach (var moduleNode in modules.OfType<JsonObject>())
        {
            var moduleId = moduleNode["id"]!.GetValue<string>();
            foreach (var questionId in ReferencedQuestions(moduleNode["activation"]))
            {
                if (!questions.ContainsKey(questionId)) throw new ArgumentException($"Module {moduleId} references missing question {questionId}.");
            }
        }

        foreach (var (questionId, question) in questions)
            ValidatePlanningContext(question, questionId, questions);

        if (candidate["advisoryRules"] is JsonNode advisoryRulesNode && advisoryRulesNode is not JsonArray)
            throw new ArgumentException("The Playbook advisoryRules value must be an array.");
        foreach (var advisoryNode in (candidate["advisoryRules"] as JsonArray) ?? [])
        {
            var advisory = advisoryNode as JsonObject
                ?? throw new ArgumentException("Every advisory rule must be an object.");
            var advisoryId = OptionalString(advisory, "id");
            var targetQuestionId = OptionalString(advisory, "targetQuestionId");
            if (targetQuestionId.Length == 0 ||
                !itemTypes.TryGetValue(targetQuestionId, out var targetType) ||
                targetType != "question")
                throw new ArgumentException($"Advisory {advisoryId} targets missing question {(targetQuestionId.Length > 0 ? targetQuestionId : "(unknown)")}.");
        }

        ValidateQuestionVisibilityGraph(questions);

        if (!requireProtectedQuestions) return;
        foreach (var (id, protectedQuestion) in _protectedQuestions)
        {
            var candidateQuestion = itemRecords.FirstOrDefault(item => item["id"]?.GetValue<string>() == id);
            if (candidateQuestion is null)
                throw new ArgumentException($"The protected primary question {id} cannot be removed.");
            if (!JsonNode.DeepEquals(protectedQuestion, candidateQuestion))
                throw new ArgumentException($"The protected primary question {id} cannot be changed.");
        }
    }

    private static void ValidateReviewSummary(
        JsonObject task,
        string taskId,
        IReadOnlyDictionary<string, JsonObject> questions)
    {
        if (task["reviewSummary"] is null) return;
        if (task["reviewSummary"] is not JsonObject reviewSummary ||
            reviewSummary["fields"] is not JsonArray fields ||
            fields.Count == 0)
            throw new ArgumentException($"{taskId} must define at least one review summary field.");

        var referencedQuestions = new HashSet<string>(StringComparer.Ordinal);
        foreach (var fieldNode in fields)
        {
            var field = fieldNode as JsonObject;
            var questionId = field is null ? string.Empty : OptionalString(field, "questionId");
            if (questionId.Length == 0 || !questions.ContainsKey(questionId))
                throw new ArgumentException($"{taskId} review summary references missing question {(questionId.Length > 0 ? questionId : "(unknown)")}.");
            if (!referencedQuestions.Add(questionId))
                throw new ArgumentException($"{taskId} review summary repeats question {questionId}.");
        }
    }

    private static void ValidateStaffBriefing(JsonObject task, string taskId)
    {
        if (task["staffBriefing"] is null) return;
        if (task["staffBriefing"] is not JsonObject staffBriefing)
            throw new ArgumentException($"{taskId} has an invalid staff briefing.");

        var phase = OptionalString(staffBriefing, "phase");
        if (phase is not ("before-event" or "event-day" or "after-event"))
            throw new ArgumentException($"{taskId} uses unknown staff briefing phase {phase}.");
        if (OptionalString(staffBriefing, "audience").Length == 0)
            throw new ArgumentException($"{taskId} must name the staff audience for its briefing instruction.");
        if (OptionalString(staffBriefing, "instruction").Length == 0)
            throw new ArgumentException($"{taskId} must provide a practical staff briefing instruction.");
    }

    private static void ValidatePlanningContext(
        JsonObject question,
        string questionId,
        IReadOnlyDictionary<string, JsonObject> questions)
    {
        if (question["planningContext"] is null) return;
        if (question["planningContext"] is not JsonObject planningContext ||
            planningContext["fields"] is not JsonArray fields ||
            fields.Count == 0)
            throw new ArgumentException($"{questionId} planning context must define at least one field.");

        foreach (var fieldNode in fields)
        {
            var field = fieldNode as JsonObject;
            var referencedQuestionId = field is null ? string.Empty : OptionalString(field, "questionId");
            if (referencedQuestionId.Length == 0 || !questions.ContainsKey(referencedQuestionId))
                throw new ArgumentException($"{questionId} planning context references missing question {(referencedQuestionId.Length > 0 ? referencedQuestionId : "(unknown)")}.");
            foreach (var conditionalQuestionId in ReferencedQuestions(field!["showWhen"]))
            {
                if (!questions.ContainsKey(conditionalQuestionId))
                    throw new ArgumentException($"{questionId} planning context references missing question {conditionalQuestionId}.");
            }
        }
    }

    private static void ValidateQuestionVisibilityGraph(IReadOnlyDictionary<string, JsonObject> questions)
    {
        var graph = questions.ToDictionary(
            entry => entry.Key,
            entry => ReferencedQuestions(entry.Value["showWhen"])
                .Where(questions.ContainsKey)
                .Distinct(StringComparer.Ordinal)
                .ToArray(),
            StringComparer.Ordinal);
        var visiting = new HashSet<string>(StringComparer.Ordinal);
        var visited = new HashSet<string>(StringComparer.Ordinal);

        void Visit(string questionId)
        {
            if (visiting.Contains(questionId))
                throw new ArgumentException($"Circular question visibility rule detected at {questionId}.");
            if (!visited.Add(questionId)) return;
            visiting.Add(questionId);
            foreach (var dependency in graph[questionId]) Visit(dependency);
            visiting.Remove(questionId);
        }

        foreach (var questionId in graph.Keys) Visit(questionId);
    }

    private async Task<PlaybookTemplateDocument> LoadDocumentAsync(CancellationToken cancellationToken)
    {
        if (!File.Exists(_documentPath)) return CreateDocument(0, "bundled-core", _coreTemplate.DeepClone().AsObject());
        try
        {
            PersistedPlaybookTemplateDocument? persisted;
            await using (var stream = File.OpenRead(_documentPath))
            {
                persisted = await JsonSerializer.DeserializeAsync<PersistedPlaybookTemplateDocument>(stream, _jsonOptions, cancellationToken);
            }
            if (persisted is null || persisted.Template.ValueKind != JsonValueKind.Object)
                throw new InvalidDataException("The saved Playbook template is empty.");
            var configured = JsonNode.Parse(persisted.Template.GetRawText())?.AsObject()
                ?? throw new InvalidDataException("The saved Playbook template is empty.");
            var basedOnCore = persisted.BaseTemplate.ValueKind == JsonValueKind.Object
                ? JsonNode.Parse(persisted.BaseTemplate.GetRawText())?.AsObject()
                : null;
            var rebased = basedOnCore is not null && !JsonNode.DeepEquals(basedOnCore, _coreTemplate);
            var candidate = rebased
                ? RebaseClubCustomisations(basedOnCore!, configured)
                : configured;
            ValidateTemplate(candidate, requireProtectedQuestions: true);
            var document = CreateDocument(
                persisted.Revision,
                rebased ? $"{persisted.Source}-rebased" : persisted.Source,
                candidate,
                persisted.UpdatedAtUtc);
            if (rebased) await WriteAtomicallyAsync(document, cancellationToken);
            return document;
        }
        catch (Exception exception) when (exception is JsonException or InvalidDataException or ArgumentException)
        {
            _logger.LogError(exception, "The saved Playbook template is invalid. Falling back to the bundled core template.");
            return CreateDocument(0, "bundled-core-recovery", _coreTemplate.DeepClone().AsObject());
        }
    }

    private PlaybookTemplateDocument CreateDocument(
        long revision,
        string source,
        JsonObject template,
        DateTimeOffset? updatedAtUtc = null) => new()
    {
        Revision = revision,
        UpdatedAtUtc = updatedAtUtc ?? DateTimeOffset.UtcNow,
        Source = source,
        BaseSchemaVersion = OptionalString(_coreTemplate, "schemaVersion"),
        Template = JsonSerializer.SerializeToElement(template, _jsonOptions),
        ProtectedQuestionIds = _protectedQuestions.Keys.Order(StringComparer.Ordinal).ToArray()
    };

    private async Task WriteAtomicallyAsync(PlaybookTemplateDocument document, CancellationToken cancellationToken)
    {
        var persisted = new PersistedPlaybookTemplateDocument
        {
            Revision = document.Revision,
            UpdatedAtUtc = document.UpdatedAtUtc,
            Source = document.Source,
            Template = document.Template.Clone(),
            BaseTemplate = JsonSerializer.SerializeToElement(_coreTemplate, _jsonOptions)
        };
        var temporaryPath = $"{_documentPath}.{Guid.NewGuid():N}.tmp";
        try
        {
            await using (var stream = new FileStream(temporaryPath, FileMode.CreateNew, FileAccess.Write, FileShare.None, 65536, FileOptions.Asynchronous | FileOptions.WriteThrough))
            {
                await JsonSerializer.SerializeAsync(stream, persisted, _jsonOptions, cancellationToken);
                await stream.FlushAsync(cancellationToken);
            }
            File.Move(temporaryPath, _documentPath, true);
        }
        finally
        {
            if (File.Exists(temporaryPath)) File.Delete(temporaryPath);
        }
    }

    private static Dictionary<string, JsonObject> FindProtectedQuestions(JsonObject core)
    {
        var result = new Dictionary<string, JsonObject>(StringComparer.Ordinal);
        var start = (core["modules"] as JsonArray)?.OfType<JsonObject>()
            .FirstOrDefault(module => OptionalString(module, "id") == "start")
            ?? throw new InvalidDataException("The bundled Playbook has no start module.");
        foreach (var section in (start["sections"] as JsonArray)?.OfType<JsonObject>() ?? [])
        foreach (var item in (section["items"] as JsonArray)?.OfType<JsonObject>() ?? [])
        {
            if (OptionalString(item, "type") != "question") continue;
            var id = RequiredString(item, "id", "A primary question has no id.");
            result[id] = item.DeepClone().AsObject();
        }
        return result;
    }

    private JsonObject RebaseClubCustomisations(JsonObject previousCore, JsonObject configured)
    {
        var rebased = _coreTemplate.DeepClone().AsObject();
        var previousItems = IndexItems(previousCore);
        var configuredItems = IndexItems(configured);
        var rebasedItems = IndexItems(rebased);

        foreach (var (id, configuredLocation) in configuredItems)
        {
            if (_protectedQuestions.ContainsKey(id)) continue;
            var isAddedByClub = !previousItems.TryGetValue(id, out var previousLocation);
            var wasChangedByClub = !isAddedByClub && !JsonNode.DeepEquals(previousLocation!.Item, configuredLocation.Item);
            if (!isAddedByClub && !wasChangedByClub) continue;

            var configuredItem = configuredLocation.Item.DeepClone().AsObject();
            if (rebasedItems.TryGetValue(id, out var currentLocation))
            {
                if (isAddedByClub)
                {
                    currentLocation.Items[currentLocation.Index] = configuredItem;
                }
                else
                {
                    ApplyChangedProperties(previousLocation!.Item, configuredLocation.Item, currentLocation.Item);
                }
                continue;
            }

            var targetSection = FindSection(rebased, configuredLocation.ModuleId, configuredLocation.SectionId);
            if (targetSection is null)
            {
                _logger.LogWarning(
                    "Could not rebase club Playbook item {ItemId}; target {ModuleId}/{SectionId} no longer exists.",
                    id,
                    configuredLocation.ModuleId,
                    configuredLocation.SectionId);
                continue;
            }
            ((JsonArray)targetSection["items"]!).Add(configuredItem);
        }

        RebaseNamedArray(previousCore, configured, rebased, "responsibilityRoles", "id");
        RebaseNamedArray(previousCore, configured, rebased, "deadlineCodes", "code");
        RebaseNamedArray(previousCore, configured, rebased, "advisoryRules", "id");
        return rebased;
    }

    private static void ApplyChangedProperties(JsonObject previousCore, JsonObject configured, JsonObject currentCore)
    {
        foreach (var property in previousCore)
        {
            var configuredHasProperty = configured.TryGetPropertyValue(property.Key, out var configuredValue);
            if (configuredHasProperty && JsonNode.DeepEquals(property.Value, configuredValue)) continue;
            if (configuredHasProperty) currentCore[property.Key] = configuredValue?.DeepClone();
            else currentCore.Remove(property.Key);
        }

        foreach (var property in configured)
        {
            if (previousCore.ContainsKey(property.Key)) continue;
            currentCore[property.Key] = property.Value?.DeepClone();
        }
    }

    private static void RebaseNamedArray(
        JsonObject previousCore,
        JsonObject configured,
        JsonObject rebased,
        string propertyName,
        string keyName)
    {
        var previous = IndexNamedArray(previousCore[propertyName] as JsonArray, keyName);
        var configuredValues = IndexNamedArray(configured[propertyName] as JsonArray, keyName);
        var rebasedArray = rebased[propertyName] as JsonArray ?? new JsonArray();
        rebased[propertyName] = rebasedArray;

        foreach (var (id, configuredValue) in configuredValues)
        {
            var added = !previous.TryGetValue(id, out var previousValue);
            var changed = !added && !JsonNode.DeepEquals(previousValue, configuredValue);
            if (!added && !changed) continue;

            var index = rebasedArray
                .Select((node, index) => new { node, index })
                .FirstOrDefault(entry => entry.node is JsonObject value && OptionalString(value, keyName) == id)
                ?.index;
            if (index is int existingIndex) rebasedArray[existingIndex] = configuredValue.DeepClone();
            else rebasedArray.Add(configuredValue.DeepClone());
        }
    }

    private static Dictionary<string, JsonObject> IndexNamedArray(JsonArray? array, string keyName) =>
        (array?.OfType<JsonObject>() ?? [])
            .Where(value => OptionalString(value, keyName).Length > 0)
            .ToDictionary(value => OptionalString(value, keyName), value => value, StringComparer.Ordinal);

    private static Dictionary<string, ItemLocation> IndexItems(JsonObject template)
    {
        var result = new Dictionary<string, ItemLocation>(StringComparer.Ordinal);
        foreach (var module in (template["modules"] as JsonArray)?.OfType<JsonObject>() ?? [])
        {
            var moduleId = OptionalString(module, "id");
            foreach (var section in (module["sections"] as JsonArray)?.OfType<JsonObject>() ?? [])
            {
                var sectionId = OptionalString(section, "id");
                if (section["items"] is not JsonArray items) continue;
                for (var index = 0; index < items.Count; index++)
                {
                    if (items[index] is not JsonObject item) continue;
                    var id = OptionalString(item, "id");
                    if (id.Length > 0) result[id] = new ItemLocation(moduleId, sectionId, items, index, item);
                }
            }
        }
        return result;
    }

    private static JsonObject? FindSection(JsonObject template, string moduleId, string sectionId) =>
        (template["modules"] as JsonArray)?.OfType<JsonObject>()
            .FirstOrDefault(module => OptionalString(module, "id") == moduleId)?["sections"]
            ?.AsArray()
            .OfType<JsonObject>()
            .FirstOrDefault(section => OptionalString(section, "id") == sectionId);

    private static HashSet<string> ReadIds(JsonArray? array, string propertyName, string description)
    {
        var result = new HashSet<string>(StringComparer.Ordinal);
        foreach (var item in array?.OfType<JsonObject>() ?? [])
        {
            var id = RequiredString(item, propertyName, $"A {description} has no {propertyName}.");
            if (!result.Add(id)) throw new ArgumentException($"Duplicate {description}: {id}.");
        }
        return result;
    }

    private static IEnumerable<string> ReferencedQuestions(JsonNode? condition)
    {
        if (condition is not JsonObject rule) yield break;
        var direct = OptionalString(rule, "questionId");
        if (direct.Length > 0) yield return direct;
        foreach (var key in new[] { "all", "any" })
        foreach (var child in (rule[key] as JsonArray) ?? [])
        foreach (var id in ReferencedQuestions(child)) yield return id;
        foreach (var id in ReferencedQuestions(rule["not"])) yield return id;
    }

    private static string RequiredString(JsonObject value, string propertyName, string message)
    {
        var result = OptionalString(value, propertyName);
        return result.Length > 0 ? result : throw new ArgumentException(message);
    }

    internal static string OptionalString(JsonObject value, string propertyName) =>
        value[propertyName] is JsonValue node && node.TryGetValue<string>(out var result)
            ? result?.Trim() ?? string.Empty
            : string.Empty;

    private static bool IsTrue(JsonNode? value) =>
        value is JsonValue node && node.TryGetValue<bool>(out var result) && result;

    private static string NormaliseSource(string source) => string.IsNullOrWhiteSpace(source)
        ? "administrator"
        : source.Trim()[..Math.Min(source.Trim().Length, 80)];

    private sealed class PersistedPlaybookTemplateDocument
    {
        public long Revision { get; init; }
        public DateTimeOffset UpdatedAtUtc { get; init; }
        public string Source { get; init; } = string.Empty;
        public JsonElement Template { get; init; }
        public JsonElement BaseTemplate { get; init; }
    }

    private sealed record ItemLocation(
        string ModuleId,
        string SectionId,
        JsonArray Items,
        int Index,
        JsonObject Item);
}
