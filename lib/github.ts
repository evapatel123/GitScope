const API = "https://api.github.com";

const USER_AGENT = "GitScope-GitHub-Profile-Analyzer/2.0";

type GithubUser = {
  login: string; id: number; avatar_url: string; html_url: string;
  name: string | null; bio: string | null; company: string | null;
  location: string | null; blog: string | null; twitter_username: string | null;
  public_repos: number; public_gists: number; followers: number; following: number;
  created_at: string; updated_at: string;
};

type GithubLicense = { spdx_id: string | null; name: string | null } | null;

type GithubRepo = {
  id: number; name: string; full_name: string; html_url: string; description: string | null;
  stargazers_count: number; watchers_count: number; forks_count: number;
  language: string | null; languages_url: string; size: number; created_at: string;
  updated_at: string; pushed_at: string | null; fork: boolean; archived: boolean;
  disabled: boolean; topics?: string[]; license: GithubLicense; homepage: string | null;
  default_branch: string; has_issues: boolean; has_projects: boolean; has_wiki: boolean;
  has_pages: boolean; open_issues_count: number;
};

type GithubEvent = {
  type: string; created_at: string; repo?: { name: string };
  payload?: { size?: number; commits?: unknown[]; action?: string; pull_request?: unknown; issue?: unknown };
};

type GithubReadme = { content?: string; encoding?: string };

type GithubLanguages = Record<string, number>;

export class GithubEvidenceError extends Error {
  constructor(readonly status: 404 | 429 | 502, message: string, readonly retryAt?: number) {
    super(message);
    this.name = "GithubEvidenceError";
  }
}

type Readme = { exists: boolean; text: string; status: "present" | "missing" | "not_inspected" };

function unavailable(context: string) {
  return new GithubEvidenceError(502, `GitHub evidence unavailable (${context}). No score was calculated. Please try again later.`);
}

// Validate fields consumed by scoring. A syntactically valid JSON response is
// not necessarily usable evidence; do not turn missing fields into zeroes.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isNullableString(value: unknown): boolean {
  return value === null || typeof value === "string";
}

function validProfile(value: unknown): boolean {
  return isRecord(value) &&
    ["login", "avatar_url", "html_url"].every(key => typeof value[key] === "string" && value[key] !== "") &&
    ["id", "public_repos", "public_gists", "followers", "following"].every(key => isCount(value[key])) &&
    ["created_at", "updated_at"].every(key => isDate(value[key])) &&
    ["name", "bio", "company", "location", "blog"].every(key => isNullableString(value[key])) &&
    (value.twitter_username === undefined || isNullableString(value.twitter_username));
}

function validRepo(value: unknown): boolean {
  return isRecord(value) &&
    ["name", "full_name", "html_url", "default_branch"].every(key => typeof value[key] === "string" && value[key] !== "") &&
    ["id", "stargazers_count", "watchers_count", "forks_count", "size", "open_issues_count"].every(key => isCount(value[key])) &&
    ["created_at", "updated_at"].every(key => isDate(value[key])) &&
    (value.pushed_at === null || isDate(value.pushed_at)) &&
    ["fork", "archived", "disabled", "has_issues", "has_wiki", "has_pages"].every(key => typeof value[key] === "boolean") &&
    ["description", "language", "homepage"].every(key => isNullableString(value[key])) &&
    (value.topics === undefined || (Array.isArray(value.topics) && value.topics.every(topic => typeof topic === "string"))) &&
    (value.license === null || (isRecord(value.license) && (value.license.spdx_id === undefined || isNullableString(value.license.spdx_id))));
}

function validEvent(value: unknown): boolean {
  return isRecord(value) && typeof value.type === "string" && value.type !== "" &&
    isDate(value.created_at) && (value.repo === undefined ||
      (isRecord(value.repo) && typeof value.repo.name === "string"));
}

// Shared conservatively within this process: anonymous and token-backed
// calls can share a secondary limit. Do not retain credentials as cache keys.
let blockedUntil = 0;

function secondsHeader(value: string | null): number | undefined {
  if (value === null || !/^\d+$/.test(value)) return undefined;
  const seconds = Number(value);
  return Number.isSafeInteger(seconds * 1000) ? seconds : undefined;
}

function noteRateLimit(headers: Headers, now: number) {
  const retryAfter = secondsHeader(headers.get("retry-after"));
  const reset = headers.get("x-ratelimit-remaining") === "0"
    ? secondsHeader(headers.get("x-ratelimit-reset")) : undefined;
  const deadlines = [
    retryAfter === undefined ? 0 : now + retryAfter * 1000,
    reset === undefined ? 0 : reset * 1000
  ].filter(deadline => Number.isSafeInteger(deadline) && deadline > now);
  blockedUntil = Math.max(blockedUntil, deadlines.length ? Math.max(...deadlines) : now + 60_000);
}

function rateLimited(context: string) {
  return new GithubEvidenceError(429,
    `GitHub API rate limit reached (${context}). No score was calculated. Please try again later.`, blockedUntil);
}

async function githubFetch<T>(path: string, context: string, allowMissing = false): Promise<T | undefined> {
  if (Date.now() < blockedUntil) throw rateLimited(context);
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": USER_AGENT
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, { headers, cache: "no-store", signal: AbortSignal.timeout(15_000) });
  } catch {
    throw unavailable(context);
  }
  // A successful request can consume the final available primary quota.
  // Keep its evidence, but stop subsequent network requests until reset.
  if (res.headers.get("x-ratelimit-remaining") === "0") noteRateLimit(res.headers, Date.now());
  if (res.status === 404 && allowMissing) return undefined;
  if (!res.ok) {
    if (res.status === 404 && context === "profile") {
      throw new GithubEvidenceError(404, "GitHub user not found.");
    }
    // A generic 403 can also indicate forbidden access, not a rate limit.
    if (res.status === 429 || (res.status === 403 &&
      (res.headers.get("x-ratelimit-remaining") === "0" || res.headers.has("retry-after")))) {
      noteRateLimit(res.headers, Date.now());
      throw rateLimited(context);
    }
    const detail = res.status === 403 ? await res.json().catch(() => null) : null;
    if (res.status === 403 && typeof detail?.message === "string" && /rate limit/i.test(detail.message)) {
      noteRateLimit(res.headers, Date.now());
      throw rateLimited(context);
    }
    throw unavailable(context);
  }
  try {
    const data: T = await res.json();
    if (data === null || data === undefined) throw unavailable(context);
    return data;
  } catch {
    throw unavailable(context);
  }
}

async function required<T>(path: string, context: string): Promise<T> {
  const data = await githubFetch<T>(path, context);
  if (data === undefined) throw unavailable(context);
  return data;
}

async function fetchAllRepos(username: string) {
  const all: GithubRepo[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const batch = await required<GithubRepo[]>(
      `/users/${encodeURIComponent(username)}/repos?per_page=100&page=${page}&sort=updated`, "repository list"
    );
    if (!Array.isArray(batch) || !batch.every(validRepo)) throw unavailable("repository list");
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

async function fetchReadme(owner: string, repo: string): Promise<Readme> {
  const context = `README for ${repo}`;
  const data = await githubFetch<GithubReadme>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/readme`, context, true);
  if (data === undefined) return { exists: false, text: "", status: "missing" };
  if (typeof data.content !== "string" || data.encoding !== "base64") throw unavailable(context);
  // GitHub wraps Base64 over multiple lines. Buffer's decoder alone silently
  // accepts invalid characters, so verify the canonical round trip.
  const encoded = data.content.replace(/\s/g, "");
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.toString("base64") !== encoded) throw unavailable(context);
  const text = bytes.toString("utf8");
  return { exists: true, text: text.slice(0, 12000), status: "present" };
}

async function fetchRepoLanguages(owner: string, repo: string): Promise<GithubLanguages> {
  const context = `languages for ${repo}`;
  const data = await required<GithubLanguages>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/languages`, context);
  if (typeof data !== "object" || Array.isArray(data) ||
    Object.values(data).some(value => !Number.isSafeInteger(value) || value < 0)) throw unavailable(context);
  return data;
}

async function fetchPublicEvents(username: string) {
  const events: GithubEvent[] = [];
  for (let page = 1; page <= 3; page += 1) {
    const batch = await required<GithubEvent[]>(`/users/${encodeURIComponent(username)}/events/public?per_page=100&page=${page}`, "public events");
    if (!Array.isArray(batch) || !batch.every(validEvent)) throw unavailable("public events");
    events.push(...batch);
    if (batch.length < 100) break;
  }
  return events;
}

// Bound the burst of requests. If a batch fails, do not start any further batches.
async function inspectInBatches<T, R>(items: T[], inspect: (item: T) => Promise<R>): Promise<R[]> {
  const result: R[] = [];
  for (let i = 0; i < items.length; i += 4) {
    const batch = await Promise.allSettled(items.slice(i, i + 4).map(inspect));
    const failures = batch.filter((item): item is PromiseRejectedResult => item.status === "rejected");
    if (failures.length) {
      // Drain the batch before releasing a coalesced request; preserve rate
      // limit information even if a different request failed first.
      const rateLimit = failures.filter(item => item.reason instanceof GithubEvidenceError && item.reason.status === 429)
        .sort((a, b) => (b.reason.retryAt ?? 0) - (a.reason.retryAt ?? 0))[0];
      if (rateLimit) {
        throw new GithubEvidenceError(429, rateLimit.reason.message, blockedUntil);
      }
      throw failures[0].reason;
    }
    for (const item of batch) {
      if (item.status === "fulfilled") result.push(item.value);
    }
  }
  return result;
}

function decodeRepoReadme(text: string) {
  const normalized = text.toLowerCase();
  return {
    wordCount: normalized.replace(/[`*_#\[\]()]/g, " ").trim().split(/\s+/).filter(Boolean).length,
    hasInstall: /install|setup|getting started|quick start/.test(normalized),
    hasUsage: /usage|how to use|example|examples/.test(normalized),
    hasFeatures: /features|what it does/.test(normalized),
    hasArchitecture: /architecture|tech stack|built with|structure/.test(normalized),
    hasDemo: /demo|live|deployment|deployed|screenshots/.test(normalized),
    hasContributing: /contribut/.test(normalized),
    hasTests: /test|testing|coverage/.test(normalized),
    hasLicense: /license/.test(normalized)
  };
}

export async function analyzeGithubUser(username: string) {
  const user = await required<GithubUser>(`/users/${encodeURIComponent(username)}`, "profile");
  if (!validProfile(user)) throw unavailable("profile");
  const repos = await fetchAllRepos(username);
  const events = await fetchPublicEvents(username);

  const activeRepos = repos.filter(r => !r.fork && !r.archived && !r.disabled);
  const originalRepos = repos.filter(r => !r.fork);
  const now = Date.now();
  const dayMs = 86400000;
  const daysSince = (date: string | null) => date ? Math.max(0, (now - new Date(date).getTime()) / dayMs) : Infinity;

  const sortedByImportance = [...activeRepos].sort((a, b) =>
    (b.stargazers_count * 3 + b.forks_count * 2 + Math.log10(b.size + 10)) -
    (a.stargazers_count * 3 + a.forks_count * 2 + Math.log10(a.size + 10))
  );
  const inspectionRepos = [...new Set([...activeRepos.slice(0, 18), ...sortedByImportance.slice(0, 12)].map(r => r.id))]
    .map(id => activeRepos.find(r => r.id === id)!)
    .filter(Boolean)
    .slice(0, 24);

  const readmes = await inspectInBatches(inspectionRepos, r => fetchReadme(username, r.name));
  const languageMaps = await inspectInBatches(inspectionRepos, r => fetchRepoLanguages(username, r.name));
  const repoEvidence = inspectionRepos.map((repo, i) => ({
    id: repo.id,
    name: repo.name,
    url: repo.html_url,
    description: repo.description,
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    watchers: repo.watchers_count,
    language: repo.language,
    size: repo.size,
    createdAt: repo.created_at,
    updatedAt: repo.updated_at,
    pushedAt: repo.pushed_at,
    topics: repo.topics || [],
    license: repo.license?.spdx_id || null,
    homepage: repo.homepage,
    defaultBranch: repo.default_branch,
    hasIssues: repo.has_issues,
    hasWiki: repo.has_wiki,
    hasPages: repo.has_pages,
    openIssues: repo.open_issues_count,
    archived: repo.archived,
    readme: readmes[i],
    languages: languageMaps[i]
  }));

  const profileReadmeRepo = repos.find(r => r.name.toLowerCase() === username.toLowerCase() && r.full_name.toLowerCase() === `${username.toLowerCase()}/${username.toLowerCase()}`);
  const profileReadme = profileReadmeRepo
    ? repoEvidence.find(r => r.id === profileReadmeRepo.id)?.readme ?? await fetchReadme(username, profileReadmeRepo.name)
    : { exists: false, text: "", status: "missing" as const };

  const languageBytes: Record<string, number> = {};
  for (const repo of repoEvidence) {
    const map = Object.keys(repo.languages).length ? repo.languages : (repo.language ? { [repo.language]: Math.max(repo.size, 1) } : {});
    for (const [name, value] of Object.entries(map)) languageBytes[name] = (languageBytes[name] || 0) + value;
  }
  const languages = Object.entries(languageBytes).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value }));

  const totalStars = repos.reduce((n, r) => n + r.stargazers_count, 0);
  const totalForks = repos.reduce((n, r) => n + r.forks_count, 0);
  const recentlyUpdated = [...activeRepos].sort((a, b) =>
    new Date(b.pushed_at || b.updated_at).getTime() - new Date(a.pushed_at || a.updated_at).getTime()
  );
  const topRepos = [...originalRepos].sort((a, b) =>
    (b.stargazers_count * 3 + b.forks_count * 2 + Math.log10(b.size + 10)) -
    (a.stargazers_count * 3 + a.forks_count * 2 + Math.log10(a.size + 10))
  ).slice(0, 10);

  const eventsByType = events.reduce<Record<string, number>>((acc, event) => {
    acc[event.type] = (acc[event.type] || 0) + 1;
    return acc;
  }, {});
  const pushEvents = events.filter(e => e.type === "PushEvent");
  const recent90 = events.filter(e => daysSince(e.created_at) <= 90);
  const recent30 = events.filter(e => daysSince(e.created_at) <= 30);
  const publicEventRepos = new Set(recent90.map(e => e.repo?.name).filter(Boolean));

  const accountAgeYears = Math.max(0.1, (now - new Date(user.created_at).getTime()) / (365.25 * dayMs));
  const stale180 = activeRepos.filter(r => daysSince(r.pushed_at || r.updated_at) > 180).length;
  const updated90 = activeRepos.filter(r => daysSince(r.pushed_at || r.updated_at) <= 90).length;
  const updated30 = activeRepos.filter(r => daysSince(r.pushed_at || r.updated_at) <= 30).length;
  const described = activeRepos.filter(r => Boolean(r.description?.trim())).length;
  const topicTagged = activeRepos.filter(r => (r.topics || []).length > 0).length;
  const licensed = activeRepos.filter(r => Boolean(r.license?.spdx_id)).length;
  const homepageLinked = activeRepos.filter(r => Boolean(r.homepage?.trim())).length;
  const readmeCount = repoEvidence.filter(r => r.readme.exists).length;
  const strongReadmeCount = repoEvidence.filter(r => r.readme.exists && r.readme.text.length >= 700).length;
  const documentationQuality = repoEvidence.filter(r => r.readme.exists).map(r => decodeRepoReadme(r.readme.text));

  return {
    user: {
      login: user.login, id: user.id, avatar: user.avatar_url, url: user.html_url,
      name: user.name, bio: user.bio, company: user.company, location: user.location,
      blog: user.blog, twitter: user.twitter_username, followers: user.followers,
      following: user.following, publicRepos: user.public_repos, publicGists: user.public_gists,
      createdAt: user.created_at, updatedAt: user.updated_at
    },
    stats: {
      repositories: user.public_repos,
      originalRepositories: originalRepos.length,
      forkRepositories: repos.filter(r => r.fork).length,
      archivedRepositories: repos.filter(r => r.archived).length,
      stars: totalStars,
      forks: totalForks,
      followers: user.followers,
      following: user.following,
      activeRepositories: activeRepos.length,
      updated30,
      updated90,
      stale180,
      described,
      topicTagged,
      licensed,
      homepageLinked,
      readmeCount,
      strongReadmeCount,
      profileReadme: profileReadme.exists,
      accountAgeYears: Number(accountAgeYears.toFixed(1)),
      publicEvents90: recent90.length,
      publicEvents30: recent30.length,
      activeEventRepos90: publicEventRepos.size
    },
    languages,
    repositories: topRepos.map(r => ({
      id: r.id, name: r.name, url: r.html_url, description: r.description,
      stars: r.stargazers_count, forks: r.forks_count, watchers: r.watchers_count,
      language: r.language, size: r.size, updatedAt: r.updated_at, pushedAt: r.pushed_at,
      topics: r.topics || [], license: r.license?.spdx_id || null, homepage: r.homepage,
      hasIssues: r.has_issues, hasWiki: r.has_wiki, hasPages: r.has_pages,
      openIssues: r.open_issues_count, readme: repoEvidence.find(x => x.id === r.id)?.readme || { exists: false, text: "", status: "not_inspected" as const },
      languages: repoEvidence.find(x => x.id === r.id)?.languages || {}
    })),
    evidence: repoEvidence,
    activity: {
      eventTypes: eventsByType,
      recent90: recent90.length,
      recent30: recent30.length,
      pushEvents90: pushEvents.filter(e => daysSince(e.created_at) <= 90).length,
      pullRequests90: events.filter(e => e.type === "PullRequestEvent" && daysSince(e.created_at) <= 90).length,
      issues90: events.filter(e => (e.type === "IssuesEvent" || e.type === "IssueCommentEvent") && daysSince(e.created_at) <= 90).length,
      publicEventLimit: "GitHub's public events API is limited and does not equal the contribution graph."
    },
    documentation: {
      inspectedRepos: inspectionRepos.length,
      readmesFound: readmeCount,
      strongReadmes: strongReadmeCount,
      quality: documentationQuality
    },
    recent: recentlyUpdated.slice(0, 10).map(r => ({
      name: r.name, url: r.html_url, language: r.language,
      stars: r.stargazers_count, pushedAt: r.pushed_at || r.updated_at
    })),
    meta: {
      totalReposFetched: repos.length,
      inspectedRepos: inspectionRepos.length,
      dataNote: "Scores use public GitHub evidence only. Private repositories, private contributions, local work, and contribution-graph details are not visible to this analyzer."
    }
  };
}

// Reuse only successful, anonymous analyses for the existing 120-second freshness
// window. Token-backed requests bypass shared state; failed requests are never cached.
// The cache and pending map are bounded and local to this server process.
const CACHE_TTL_MS = 120_000;
const CACHE_LIMIT = 32;
type Analysis = Awaited<ReturnType<typeof analyzeGithubUser>>;
const completed = new Map<string, { data: Analysis; expiresAt: number }>();
const pending = new Map<string, Promise<Analysis>>();

export async function analyzeCachedGithubUser(username: string): Promise<Analysis> {
  if (process.env.GITHUB_TOKEN) return analyzeGithubUser(username);
  const key = username.toLowerCase();
  const now = Date.now();
  for (const [name, entry] of completed) {
    if (entry.expiresAt <= now) completed.delete(name);
  }
  const hit = completed.get(key);
  if (hit) return hit.data;
  const running = pending.get(key);
  if (running) return running;
  if (pending.size >= CACHE_LIMIT) return analyzeGithubUser(username);
  const work = analyzeGithubUser(username).then(data => {
    if (completed.size >= CACHE_LIMIT) {
      const oldest = completed.keys().next().value;
      if (oldest !== undefined) completed.delete(oldest);
    }
    completed.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
    return data;
  }).finally(() => {
    pending.delete(key);
  });
  pending.set(key, work);
  return work;
}
