# GitScope — Honest GitHub Profile Audit

GitScope analyzes a public GitHub profile as a **developer portfolio**, not as a measure of programming ability.
**GitHub API limits:** GitScope reduces redundant requests, but rate limits can still prevent an audit. If necessary evidence cannot be retrieved, it reports the failure instead of calculating a misleading score.

This is also an open-source project so if you'd like to contribute, read the CONTRIBUTING.md :)

## What it analyzes

- Profile presentation: name, bio, profile README, website and public links
- Repository quality: descriptions, READMEs, topics, licenses, demos/homepages
- Project depth: original repositories, substantive project signals and documentation
- Maintenance: recent pushes, stale repositories and recent public activity
- Technical breadth: detected language distribution across inspected repositories
- Engineering hygiene: licenses, issues, topics and maintenance signals
- Community impact: stars, forks, followers and public collaboration signals
- Discoverability: descriptions, topics, READMEs, demos and profile-level context
- Past-project themes: repository names, descriptions, topics, languages and bio

The final score is a weighted score out of 100. It is explicitly **not** a score of intelligence, programming ability, employability, or personal worth.

## Honest-data design

GitHub's public API cannot see private repositories, private contributions, local work, or every detail of the contribution graph. GitScope does not invent those facts. Where evidence is missing, it says so.

Public event data is also limited by GitHub and should not be treated as an exact contribution count.

### Request efficiency and incomplete evidence

- The inspected profile README is reused instead of being fetched twice. Repository inspection runs in batches of at most four concurrent requests per audit. Already-started requests settle before a failed audit is released; each request has a 15-second timeout. No further batch is started after failure.
- Anonymous, successful analyses are reused for 120 seconds within one server process (up to 32 cached profiles). Identical in-flight requests for the same username are coalesced, subject to the 32-entry pending-map limit. Token-backed requests bypass this cache. HTTP responses use `Cache-Control: no-store` to avoid stacking cache lifetimes or sharing token-backed results.
- Rate-limit responses return HTTP 429 with a Retry-After header. Within one server process, new GitHub requests pause until the later applicable Retry-After or primary reset deadline (60 seconds if neither provides a future deadline). Already cached successful anonymous reports can still be served. The cooldown is conservative across credential modes; it is not distributed and does not retry automatically. Other retrieval failures (including malformed evidence and timeouts) return HTTP 502, without producing a score. A profile lookup returning 404 remains a not-found error; a README 404 for a listed public repository is marked unavailable (absence unconfirmed). GitHub can use the same response for a missing or inaccessible README; without additional API calls these cases cannot be distinguished. A missing public profile README repository in the fetched list is reported separately; an incomplete list is not proof of absence.
- A repository outside the inspection sample is labeled as not inspected, not as having no README. Existing score formulas, pagination limits, sampling rules, and successful language-map fallback are unchanged. Unavailable READMEs earn no README credit, so the score may understate documentation, profile presentation, project signals and discoverability. The UI reports the uncertainty and asks users to verify access or existence before treating it as a documentation gap. Other retrieval failures still fail closed.
- The cache is process-local, not a distributed quota manager. Cold requests for different profiles may still reach the API limit. Batching may increase cold-audit latency, and no requests are retried automatically.

## Setup

1. Install Node.js 20.9+.
2. Run `npm install`.
3. Copy `.env.example` to `.env.local`.
4. Add a GitHub personal access token as `GITHUB_TOKEN` if desired. A token gives the app substantially more API headroom.
5. Run `npm run dev`.

Then open the local Next.js URL and enter a GitHub username.

## Quality checks

- `npm run typecheck`
- `npm run build`
- `npm test` — deterministic synthetic responses; no live GitHub requests or real credentials.
- `npm run test:http` — after a production build, exercise the actual HTTP endpoint on localhost with mocked GitHub responses.
- Optional upstream comparison: `GITSCOPE_BASELINE_REF=242f1096c2a4642ab343562541aef2c3cc31245f npm test` (requires the base commit in local Git history). This compares actual request counts, response data excluding README status fields, and numeric scores. For the README follow-up comparison, set GITSCOPE_FOLLOWUP_BASELINE_REF to the pre-follow-up main commit (d133c1b62f04e1cd425f4e0e527135fb5805e3cf) when running npm test; it checks unchanged API paths, concurrency and numeric scores.

## Architecture

- `lib/github.ts` — GitHub API retrieval and evidence collection
- `app/api/analyze/route.ts` — validated API endpoint
- `components/Analyzer.tsx` — scoring, personalized insights, recommendations and UI
- `app/globals.css` — responsive visual system
