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

async function githubFetch<T>(path: string, init?: RequestInit, notFoundMessage = "GitHub user not found."): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": USER_AGENT
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`${API}${path}`, { ...init, headers, cache: "no-store" });
  if (!res.ok) {
    const message = res.status === 404 ? notFoundMessage :
      res.status === 403 ? "GitHub API rate limit reached. Add GITHUB_TOKEN to your environment." :
      `GitHub API error (${res.status}).`;
    throw new Error(message);
  }
  return res.json();
}

async function fetchAllRepos(username: string) {
  const all: GithubRepo[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const batch = await githubFetch<GithubRepo[]>(
      `/users/${encodeURIComponent(username)}/repos?per_page=100&page=${page}&sort=updated`
    );
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

async function fetchReadme(owner: string, repo: string): Promise<{ exists: boolean; text: string }> {
  try {
    const data = await githubFetch<GithubReadme>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/readme`, undefined, "Resource not found.");
    if (!data.content || data.encoding !== "base64") return { exists: true, text: "" };
    const text = Buffer.from(data.content, "base64").toString("utf8");
    return { exists: true, text: text.slice(0, 12000) };
  } catch (error) {
    return { exists: false, text: "" };
  }
}

async function fetchRepoLanguages(url: string): Promise<GithubLanguages> {
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": USER_AGENT,
        ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {})
      },
      cache: "no-store"
    });
    if (!res.ok) return {};
    return res.json();
  } catch {
    return {};
  }
}

async function fetchPublicEvents(username: string) {
  const events: GithubEvent[] = [];
  for (let page = 1; page <= 3; page += 1) {
    try {
      const batch = await githubFetch<GithubEvent[]>(`/users/${encodeURIComponent(username)}/events/public?per_page=100&page=${page}`);
      events.push(...batch);
      if (batch.length < 100) break;
    } catch {
      break;
    }
  }
  return events;
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
  const user = await githubFetch<GithubUser>(`/users/${encodeURIComponent(username)}`);
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

  const readmes = await Promise.all(inspectionRepos.map(r => fetchReadme(username, r.name)));
  const languageMaps = await Promise.all(inspectionRepos.map(r => fetchRepoLanguages(r.languages_url)));
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
  const profileReadme = profileReadmeRepo ? await fetchReadme(username, profileReadmeRepo.name) : { exists: false, text: "" };

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
      openIssues: r.open_issues_count, readme: repoEvidence.find(x => x.id === r.id)?.readme || { exists: false, text: "" },
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
