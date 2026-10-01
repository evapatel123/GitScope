# GitScope — Honest GitHub Profile Audit

GitScope analyzes a public GitHub profile as a **developer portfolio**, not as a measure of programming ability.
**NOTE: THE GITHUB API MAY EXCEED ITS LIMIT AFTER A CERTAIN NUMBER OF TRIES, THIS ISSUE IS STILL CURRENTLY BEING WORKED ON**

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

## Architecture

- `lib/github.ts` — GitHub API retrieval and evidence collection
- `app/api/analyze/route.ts` — validated API endpoint
- `components/Analyzer.tsx` — scoring, personalized insights, recommendations and UI
- `app/globals.css` — responsive visual system
