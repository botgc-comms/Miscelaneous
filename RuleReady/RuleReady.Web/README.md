# RuleReady V1

RuleReady is a standalone ASP.NET Core Rules of Golf learning and assessment service.

## What is included

- ASP.NET Core Identity with email/password authentication.
- Opaque `RuleReadyUserId` independent of email address, club and England Golf Membership Number.
- Optional England Golf Membership Number.
- Many-to-many user/organisation associations.
- Organisation types for clubs, academies, counties, governing bodies, sponsors and software partners.
- Licence model covering Individual, Club, Enterprise and Platform products.
- Self-directed personal quizzes.
- Club/organisation-issued quiz campaigns using an eight-character access code.
- Three quiz formats:
  - Own time.
  - Fixed overall time.
  - Per-question countdown.
- Difficulty and learning-level selection.
- Persisted quiz attempts and answers.
- Immutable content snapshots for each attempt.
- Learner history.
- Organisation-level attempt count and average-score reporting.
- REST API for authenticated quiz delivery.
- Password reset flow.
- Local development email delivery to `App_Data/emails`.
- File-based structured quiz content compatible with the existing RuleReady/BOTGC JSON shape.
- A sample Rules question and illustration.

## Run

Install the .NET 10 SDK, then from `RuleReady.Web` run:

```text
dotnet restore
dotnet run
```

The SQLite database is created automatically on first run.

Development password-reset messages are written to:

```text
RuleReady.Web/App_Data/emails
```

## Content

Quiz content is loaded from:

```text
RuleReady.Web/Content/questions
```

Each question is a directory containing `metadata.json` or `meta.json`, plus an optional `illustration.png`, `image.png`, JPG or WebP.

## API

Authenticated users can use:

```text
POST /api/v1/quiz-sessions
GET  /api/v1/quiz-sessions/{sessionId}
POST /api/v1/quiz-sessions/{sessionId}/answers
GET  /api/v1/quiz-sessions/{sessionId}/result
```

The web application uses the same quiz engine as the API.

## Commercial model

The solution models four RuleReady products without hard-coding pricing:

- Individual.
- Club.
- Enterprise.
- Platform.

Licences are deliberately separated from user identity so access can later come from an individual subscription, a club licence, a governing-body programme, sponsorship or an API/platform agreement.

## Production work still requiring a commercial decision

The application contains the data model for licences and subscriptions, but does not connect to a payment provider because the RuleReady plan features and prices have not yet been agreed.

The development email sender should be replaced by the chosen production email provider before public launch.

External partner/API authentication should be added when the first embedded RuleReady integration is defined.
