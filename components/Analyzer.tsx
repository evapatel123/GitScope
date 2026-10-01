"use client";

import { type ChangeEvent, type FormEvent, useMemo, useState } from "react";
import {
  ArrowUpRight, BarChart3, BookOpen, CheckCircle2, ChevronRight, CircleAlert,
  Code2, ExternalLink, FileText, GitFork, Github, Globe2, Layers3, MapPin,
  Moon, Search, ShieldCheck, Sparkles, Star, Target, TrendingUp, Users, XCircle,
  Zap, Sun, Wrench
} from "lucide-react";

type Language = { name: string; value: number };
type Readme = { exists: boolean; text: string };
type Repo = {
  id: number; name: string; url: string; description: string | null; stars: number; forks: number;
  watchers: number; language: string | null; size: number; updatedAt: string; pushedAt: string | null;
  topics: string[]; license: string | null; homepage: string | null; hasIssues: boolean; hasWiki: boolean;
  hasPages: boolean; openIssues: number; readme: Readme; languages: Record<string, number>;
};
type EvidenceRepo = Repo & { createdAt: string; archived: boolean; defaultBranch: string };
type Analysis = {
  user: {
    login:string; avatar:string; url:string; name:string|null; bio:string|null; location:string|null;
    blog:string|null; twitter:string|null; company:string|null; createdAt:string;
  };
  stats: {
    repositories:number; originalRepositories:number; forkRepositories:number; archivedRepositories:number;
    stars:number; forks:number; followers:number; following:number; activeRepositories:number;
    updated30:number; updated90:number; stale180:number; described:number; topicTagged:number;
    licensed:number; homepageLinked:number; readmeCount:number; strongReadmeCount:number;
    profileReadme:boolean; accountAgeYears:number; publicEvents90:number; publicEvents30:number; activeEventRepos90:number;
  };
  languages: Language[];
  repositories: Repo[];
  evidence: EvidenceRepo[];
  activity: {
    eventTypes: Record<string,number>; recent90:number; recent30:number; pushEvents90:number;
    pullRequests90:number; issues90:number; publicEventLimit:string;
  };
  documentation: { inspectedRepos:number; readmesFound:number; strongReadmes:number; quality: Array<{
    wordCount:number; hasInstall:boolean; hasUsage:boolean; hasFeatures:boolean; hasArchitecture:boolean;
    hasDemo:boolean; hasContributing:boolean; hasTests:boolean; hasLicense:boolean;
  }> };
  recent: Array<{name:string;url:string;language:string|null;stars:number;pushedAt:string}>;
  meta: { totalReposFetched:number; inspectedRepos:number; dataNote:string };
};

type ScoreCategory = {
  key: string; label: string; score: number; max: number; summary: string; evidence: string[];
};
type Insight = { type: "strength" | "gap" | "warning"; title: string; body: string; evidence: string };
type Recommendation = { title: string; why: string; build: string; stack: string[] };

const palette = ["#8b5cf6", "#06b6d4", "#f59e0b", "#22c55e", "#ec4899", "#3b82f6", "#ef4444", "#14b8a6"];

function formatNumber(n: number) {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}
function pct(part: number, whole: number) { return whole ? Math.round((part / whole) * 100) : 0; }
function clamp(n: number, min = 0, max = 100) { return Math.max(min, Math.min(max, n)); }
function timeAgo(date: string) {
  const days = Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
  if (days < 1) return "today";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}
function repoReadmeQuality(repo: Repo) {
  if (!repo.readme.exists) return 0;
  const text = repo.readme.text;
  let points = text.length >= 700 ? 2 : 1;
  if (/install|setup|getting started|quick start/i.test(text)) points += 1;
  if (/usage|example|how to use/i.test(text)) points += 1;
  if (/features|tech stack|architecture|built with/i.test(text)) points += 1;
  if (/demo|live|deployment|screenshots/i.test(text)) points += 1;
  return clamp(points * 16.66, 0, 100);
}

function analyzeProfile(data: Analysis) {
  const active = data.evidence;
  const n = Math.max(1, active.length);
  const describedRatio = pct(data.stats.described, Math.max(1, data.stats.activeRepositories));
  const topicRatio = pct(data.stats.topicTagged, Math.max(1, data.stats.activeRepositories));
  const licenseRatio = pct(data.stats.licensed, Math.max(1, data.stats.activeRepositories));
  const readmeRatio = pct(data.stats.readmeCount, n);
  const strongReadmeRatio = pct(data.stats.strongReadmeCount, n);
  const freshRatio = pct(data.stats.updated90, Math.max(1, data.stats.activeRepositories));
  const staleRatio = pct(data.stats.stale180, Math.max(1, data.stats.activeRepositories));
  const activeRatio = pct(data.stats.updated30, Math.max(1, data.stats.activeRepositories));
  const meaningfulRepos = active.filter(r => r.size >= 20 || r.stars > 0 || r.forks > 0 || r.description || r.readme.exists);
  const meaningfulRatio = pct(meaningfulRepos.length, n);
  const languages = data.languages.length;
  const primaryShare = data.languages.length ? pct(data.languages[0].value, data.languages.reduce((a,b) => a+b.value, 0)) : 0;
  const issueEnabledRatio = pct(active.filter(r => r.hasIssues).length, n);
  const homepageRatio = pct(active.filter(r => !!r.homepage?.trim()).length, n);
  const projectSignals = active.filter(r => r.description && (r.readme.exists || r.topics.length >= 2 || r.homepage || r.license)).length;
  const projectSignalRatio = pct(projectSignals, n);
  const impactBase = Math.log10(data.stats.stars + 1) * 25 + Math.log10(data.stats.forks + 1) * 18 + Math.log10(data.stats.followers + 1) * 12;
  const impact = clamp(impactBase, 0, 100);

  const categories: ScoreCategory[] = [
    {
      key: "presentation", label: "Profile presentation", max: 12,
      score: Math.round(clamp((data.user.name ? 25 : 0) + (data.user.bio && data.user.bio.length >= 45 ? 30 : data.user.bio ? 16 : 0) + (data.stats.profileReadme ? 25 : 0) + (data.user.blog ? 10 : 0) + (data.user.twitter ? 5 : 0) + (data.user.company ? 5 : 0))),
      summary: "How clearly the profile explains who the developer is and what they build.",
      evidence: [data.user.name ? "Display name is present." : "No display name is set.", data.user.bio ? `Bio length: ${data.user.bio.length} characters.` : "No public bio.", data.stats.profileReadme ? "Profile README detected." : "No profile README detected."]
    },
    {
      key: "documentation", label: "Documentation", max: 18,
      score: Math.round(clamp(readmeRatio * .25 + strongReadmeRatio * .35 + describedRatio * .2 + topicRatio * .1 + licenseRatio * .1)),
      summary: "Whether projects are understandable, discoverable, and usable by someone who did not build them.",
      evidence: [`${data.stats.readmeCount}/${n} inspected repositories have a README.`, `${data.stats.strongReadmeCount}/${n} inspected READMEs are at least ~700 characters.`, `${describedRatio}% of active repositories have descriptions.`]
    },
    {
      key: "projectQuality", label: "Project quality & depth", max: 18,
      score: Math.round(clamp(projectSignalRatio * .42 + meaningfulRatio * .22 + Math.min(100, Math.log10(data.stats.originalRepositories + 1) * 60) * .16 + (primaryShare < 90 ? 20 : 5))),
      summary: "Evidence that the public portfolio contains substantive, intentionally presented work rather than only repository volume.",
      evidence: [`${projectSignals} inspected projects show at least two quality signals (description plus README/topics/demo/license).`, `${meaningfulRatio}% of inspected active repositories have substantive public signals.`, `${data.stats.originalRepositories} original repositories are visible.`]
    },
    {
      key: "maintenance", label: "Maintenance & activity", max: 12,
      score: Math.round(clamp(freshRatio * .5 + activeRatio * .35 + (data.activity.recent90 > 0 ? 15 : 0) - staleRatio * .25)),
      summary: "Whether the public portfolio shows recent, sustained maintenance rather than only historical activity.",
      evidence: [`${data.stats.updated90}/${data.stats.activeRepositories} active repositories were pushed in the last 90 days.`, `${data.stats.updated30} active repositories were pushed in the last 30 days.`, `${data.stats.stale180} active repositories have had no push in 180+ days.`]
    },
    {
      key: "technical", label: "Technical breadth", max: 10,
      score: Math.round(clamp(Math.min(languages / 6, 1) * 65 + (languages >= 2 ? 20 : 0) + (primaryShare < 80 ? 15 : 0))),
      summary: "Breadth and variety visible across the public codebase, without treating more languages as automatically better.",
      evidence: [`${languages} languages are represented in inspected code.`, data.languages[0] ? `${data.languages[0].name} accounts for about ${primaryShare}% of detected language bytes.` : "No language data was available."]
    },
    {
      key: "engineering", label: "Engineering hygiene", max: 10,
      score: Math.round(clamp(licenseRatio * .45 + issueEnabledRatio * .25 + topicRatio * .15 + (staleRatio < 50 ? 15 : 5))),
      summary: "Repository-level signals such as licensing, issue tracking, topics, and maintenance hygiene.",
      evidence: [`${licenseRatio}% of active repositories have a detected license.`, `${issueEnabledRatio}% of inspected repositories have GitHub Issues enabled.`, `${topicRatio}% of active repositories have at least one topic.`]
    },
    {
      key: "impact", label: "Community & impact", max: 10,
      score: Math.round(impact),
      summary: "Public evidence of people discovering, using, or engaging with the work. Popularity is treated as evidence—not as developer ability.",
      evidence: [`${formatNumber(data.stats.stars)} total stars across public repositories.`, `${formatNumber(data.stats.forks)} total forks and ${formatNumber(data.stats.followers)} followers.`, `${data.activity.pullRequests90} public pull-request events were visible in the last 90 days.`]
    },
    {
      key: "discoverability", label: "Discoverability", max: 10,
      score: Math.round(clamp(describedRatio * .35 + topicRatio * .2 + homepageRatio * .15 + readmeRatio * .2 + (data.stats.profileReadme ? 10 : 0))),
      summary: "How quickly a visitor can understand and find the important work.",
      evidence: [`${describedRatio}% of active repositories have descriptions.`, `${topicRatio}% have topics.`, `${homepageRatio}% have a homepage/demo URL.`, `${data.stats.profileReadme ? "Profile README exists." : "Profile README is missing."}`]
    }
  ];

  const rawTotal = categories.reduce((sum, c) => sum + c.score * c.max / 100, 0);
  const score = Math.round(clamp(rawTotal));

  const strengths: Insight[] = [];
  const gaps: Insight[] = [];
  const add = (list: Insight[], insight: Insight) => list.push(insight);
  if (data.stats.profileReadme) add(strengths, { type: "strength", title: "Your profile has a narrative layer", body: "A profile README gives visitors a place to understand the person behind the repositories, not just the repository list.", evidence: "Profile README detected" });
  if (describedRatio >= 75) add(strengths, { type: "strength", title: "Projects are generally explainable", body: `${describedRatio}% of your active repositories have descriptions. That reduces the amount of guesswork required from a visitor.`, evidence: `${data.stats.described}/${data.stats.activeRepositories} active repos described` });
  if (strongReadmeRatio >= 60) add(strengths, { type: "strength", title: "Documentation is a real asset", body: `${strongReadmeRatio}% of inspected repositories have substantial READMEs.`, evidence: `${data.stats.strongReadmeCount}/${n} strong READMEs` });
  if (freshRatio >= 60) add(strengths, { type: "strength", title: "The portfolio is visibly maintained", body: `${freshRatio}% of active repositories show a push within 90 days.`, evidence: `${data.stats.updated90}/${data.stats.activeRepositories} updated in 90d` });
  if (data.stats.stars + data.stats.forks > 0) add(strengths, { type: "strength", title: "There is measurable external interest", body: `Your public work has ${formatNumber(data.stats.stars)} stars and ${formatNumber(data.stats.forks)} forks. Those are concrete signals that other developers have interacted with the work.`, evidence: "Stars + forks" });
  if (languages >= 4) add(strengths, { type: "strength", title: "Your public stack is broad", body: `${languages} languages appear in the analyzed codebase. The breadth is useful when it supports different kinds of projects rather than being breadth for its own sake.`, evidence: `${languages} detected languages` });

  if (!data.stats.profileReadme) add(gaps, { type: "gap", title: "There is no profile README", body: "A visitor currently has to infer your direction from the repository list. A concise profile README could connect your strongest projects, interests, skills, and links.", evidence: "No username/username profile README" });
  if (describedRatio < 60) add(gaps, { type: "gap", title: "Too many projects require guesswork", body: `${100 - describedRatio}% of active repositories have no description. Empty descriptions make even good code look unfinished from the outside.`, evidence: `${data.stats.activeRepositories - data.stats.described} active repos without descriptions` });
  if (readmeRatio < 60) add(gaps, { type: "gap", title: "Documentation coverage is inconsistent", body: `Only ${readmeRatio}% of inspected repositories have READMEs. The biggest projects should be documented first, with purpose, setup, usage, screenshots/demo, and technical decisions.`, evidence: `${data.stats.readmeCount}/${n} inspected repos with READMEs` });
  if (licenseRatio < 50 && data.stats.originalRepositories > 0) add(gaps, { type: "gap", title: "Licensing is unclear on much of the portfolio", body: `${licenseRatio}% of active repositories have a detected license. If you intend others to reuse your code, make the licensing decision explicit.`, evidence: `${data.stats.licensed}/${data.stats.activeRepositories} licensed` });
  if (topicRatio < 50) add(gaps, { type: "gap", title: "Repository discovery could be stronger", body: `${topicRatio}% of active repositories have topics. Consistent topics make related projects easier to scan and categorize.`, evidence: `${data.stats.topicTagged}/${data.stats.activeRepositories} tagged` });
  if (staleRatio >= 50 && data.stats.activeRepositories > 0) add(gaps, { type: "warning", title: "A large part of the public portfolio looks dormant", body: `${staleRatio}% of active repositories have not been pushed in 180+ days. That is not inherently bad, but it makes the portfolio look less maintained unless those projects are clearly marked as completed or archived.`, evidence: `${data.stats.stale180}/${data.stats.activeRepositories} stale 180d+` });
  if (data.activity.recent90 === 0) add(gaps, { type: "warning", title: "Recent public activity is not visible", body: "The public events API shows no events in the last 90 days. This does not prove you have not been coding because private work and GitHub's contribution graph are not exposed here.", evidence: "0 public events visible in 90d" });
  if (data.stats.activeRepositories > 12 && projectSignalRatio < 55) add(gaps, { type: "gap", title: "Portfolio quantity may be diluting the signal", body: "You have many public repositories, but relatively few of the inspected projects have multiple presentation/quality signals. Pinning and polishing a smaller set of flagship projects would make the portfolio easier to evaluate.", evidence: `${projectSignals}/${n} inspected projects show multiple quality signals` });

  const recommendations = recommendProjects(data);
  return { categories, score, strengths: strengths.slice(0, 5), gaps: gaps.slice(0, 7), recommendations };
}

function corpus(data: Analysis) {
  return [
    data.user.bio || "", ...data.evidence.flatMap(r => [r.name, r.description || "", ...r.topics, Object.keys(r.languages).join(" ")])
  ].join(" ").toLowerCase();
}

function recommendProjects(data: Analysis): Recommendation[] {
  const text = corpus(data);
  const langs = new Set(data.languages.map(l => l.name.toLowerCase()));
  const has = (...terms: string[]) => terms.some(t => text.includes(t));
  const recs: Recommendation[] = [];

  if (has("ai", "machine learning", "ml", "llm", "nlp", "computer vision", "tensorflow", "pytorch", "openai", "gemini")) {
    recs.push({ title: "Evidence-first AI project evaluator", why: "Your public work already signals AI/ML interest. Instead of another generic chatbot, build something that measures whether an AI system is actually improving a defined task.", build: "Create an evaluation dashboard that runs a fixed benchmark, stores model outputs, scores accuracy/consistency/cost/latency, and explains regressions. Publish the dataset, methodology, and failure cases.", stack: ["Python", "FastAPI", "Gradio", "SQLite/PostgreSQL"] });
  }
  if (has("web", "frontend", "full stack", "full-stack", "next.js", "react", "javascript", "typescript", "html", "css")) {
    recs.push({ title: "Production-grade full-stack tool", why: "Your repository history contains web-development signals. A focused tool with authentication, persistence, analytics, and a real workflow would demonstrate more depth than another static site.", build: "Pick a recurring problem from school, developer tooling, or a community and build the complete workflow: auth, database, validation, role-aware UI, logging, deployment, and documentation.", stack: ["Next.js", "TypeScript", "PostgreSQL", "API"] });
  }
  if (has("data", "analytics", "pandas", "numpy", "matplotlib", "visualization", "statistics")) {
    recs.push({ title: "Reproducible data research app", why: "Your projects show data-oriented signals. Turn that into a portfolio piece where the methodology is as important as the interface.", build: "Use a public dataset, formulate one narrow research question, build a reproducible analysis pipeline, expose interactive exploration, and publish limitations plus the full methodology.", stack: ["Python", "Pandas", "Plotly", "Gradio"] });
  }
  if (has("education", "tutor", "school", "student", "learning", "math", "teacher")) {
    recs.push({ title: "Adaptive learning analytics engine", why: "Your project history contains education-related signals. A system that measures learning progress would create a clearer technical through-line.", build: "Build a practice engine that records attempts, identifies recurring error types, selects the next problem using transparent rules, and visualizes progress over time.", stack: ["Python", "FastAPI", "PostgreSQL", "React/Next.js"] });
  }
  if (has("api", "backend", "fastapi", "node", "express", "rest", "graphql")) {
    recs.push({ title: "Developer API + observability project", why: "Your repositories indicate backend/API work. Show production engineering by making reliability measurable rather than only exposing endpoints.", build: "Build a public API with authentication, rate limiting, request validation, structured logs, health checks, API docs, tests, and a small observability dashboard.", stack: ["FastAPI", "PostgreSQL", "Docker", "OpenAPI"] });
  }
  if (has("automation", "script", "bot", "workflow", "scraping", "automation")) {
    recs.push({ title: "Automation platform with audit trail", why: "Your past projects suggest automation. A reusable workflow system would demonstrate architecture, reliability, and product thinking.", build: "Let users define scheduled tasks, run them safely, inspect logs, retry failures, and see an execution history instead of building a one-off script.", stack: ["Python", "FastAPI", "SQLite", "Cron/worker"] });
  }
  if (recs.length < 4) {
    recs.push({ title: "Flagship project with a measurable outcome", why: "Your existing portfolio should be turned into a stronger story by taking one recurring theme and pushing it to a measurable outcome.", build: "Choose a problem you already care about, define one metric before coding, build a real end-to-end solution, collect results, and publish the methodology, screenshots, architecture, and limitations.", stack: [langs.has("python") ? "Python" : "JavaScript", "API/backend", "Database", "Interactive UI"] });
  }
  if (data.stats.readmeCount < Math.max(1, data.evidence.length * .7)) {
    recs.push({ title: "Documentation-first open-source project", why: "Because documentation is currently a visible gap, choose a project where excellent documentation is part of the deliverable—not an afterthought.", build: "Build a small but useful developer tool and ship a README with installation, examples, screenshots, architecture, testing, contribution guidance, and release notes.", stack: [langs.has("python") ? "Python" : "JavaScript", "CLI or web", "Tests", "GitHub Actions"] });
  }
  const seen = new Set<string>();
  return recs.filter(r => !seen.has(r.title) && seen.add(r.title)).slice(0, 5);
}

function LanguageDonut({ languages }: { languages: Language[] }) {
  const total = languages.reduce((sum, item) => sum + item.value, 0);
  let cursor = 0;
  const stops = languages.slice(0, 8).map((item, i) => {
    const start = cursor; cursor += (item.value / total) * 100;
    return `${palette[i % palette.length]} ${start}% ${cursor}%`;
  }).join(", ");
  return <div className="donut-wrap"><div className="donut" style={{ background: total ? `conic-gradient(${stops})` : "var(--soft)" }}><div className="donut-hole"><strong>{languages.length}</strong><span>languages</span></div></div></div>;
}

function ScoreRing({ score }: { score: number }) {
  const deg = score * 3.6;
  return <div className="score-ring" style={{ background: `conic-gradient(#8b5cf6 ${deg}deg, var(--soft) ${deg}deg)` }}><div><b>{score}</b><span>/100</span></div></div>;
}

function ScoreBar({ category }: { category: ScoreCategory }) {
  const pctScore = Math.round((category.score / 100) * 100);
  return <div className="score-row"><div className="score-row-top"><span>{category.label}</span><b>{Math.round(category.score)} / 100</b></div><div className="score-track"><div className="score-fill" style={{ width: `${pctScore}%` }} /></div><p>{category.summary}</p></div>;
}

function RepoBars({ repositories }: { repositories: Repo[] }) {
  const rows = repositories.slice(0, 7); const max = Math.max(1, ...rows.map(r => r.stars + r.forks));
  return <div className="repo-bars">{rows.map(repo => { const total = repo.stars + repo.forks; return <div className="bar-row" key={repo.id}><span title={repo.name}>{repo.name.length > 17 ? `${repo.name.slice(0,17)}…` : repo.name}</span><div className="bar-track"><div className="bar-fill" style={{width:`${Math.max(4,(total/max)*100)}%`}} /></div><b>{formatNumber(total)}</b></div>; })}</div>;
}

export default function Analyzer() {
  const [username, setUsername] = useState("");
  const [data, setData] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [dark, setDark] = useState(true);
  const [tab, setTab] = useState<"overview" | "audit" | "projects">("overview");

  async function analyze(e?: FormEvent) {
    e?.preventDefault(); const value = username.trim().replace(/^@/, ""); if (!value) return;
    setLoading(true); setError("");
    try {
      const res = await fetch(`/api/analyze?username=${encodeURIComponent(value)}`, { cache: "no-store" });
      const json = await res.json(); if (!res.ok) throw new Error(json.error || "Analysis failed.");
      setData(json); setTab("overview");
    } catch (err) { setError(err instanceof Error ? err.message : "Analysis failed."); }
    finally { setLoading(false); }
  }

  const audit = useMemo(() => data ? analyzeProfile(data) : null, [data]);

  return <main className={dark ? "app dark" : "app"}>
    <div className="ambient ambient-a" /><div className="ambient ambient-b" />
    <nav className="nav"><div className="brand"><span className="brand-mark"><Github size={18}/></span><span>GitScope</span><em>PROFILE AUDIT</em></div><div className="nav-right"><a href="https://github.com" target="_blank" rel="noreferrer">GitHub <ExternalLink size={13}/></a><button className="icon-btn" onClick={() => setDark(!dark)} aria-label="Toggle theme">{dark ? <Sun size={17}/> : <Moon size={17}/>}</button></div></nav>

    <section className="hero"><div className="eyebrow"><Sparkles size={14}/> HONEST DEVELOPER INTELLIGENCE</div><h1>Audit any<br/><span>GitHub profile.</span></h1><p className="hero-copy">A public-data audit that tells you what your GitHub actually communicates—what is strong, what looks weak, and what to build next.</p><form className="searchbar" onSubmit={analyze}><Github size={20}/><span className="prefix">github.com/</span><input value={username} onChange={(e:ChangeEvent<HTMLInputElement>)=>setUsername(e.target.value)} placeholder="username" aria-label="GitHub username" autoCapitalize="none" autoCorrect="off"/><button disabled={loading || !username.trim()}>{loading?<span className="spinner"/>:<><Search size={17}/>Audit profile</>}</button></form>{error&&<div className="error" role="alert">{error}</div>}<div className="hero-hint"><ShieldCheck size={13}/> Evidence-based scoring · public GitHub data only</div></section>

    {!data && !loading && <section className="preview-grid">{[[Target,"Personalized score","A weighted 100-point score across eight profile-quality categories."],[CircleAlert,"Honest weaknesses","Specific gaps tied to observable repository and profile evidence."],[Wrench,"Build next","Project ideas derived from the profile bio, languages, topics, and past projects."]].map(([Icon,title,copy],i)=>{const I=Icon as typeof Target;return <div className="preview-card" key={String(title)}><div className="preview-icon"><I size={18}/></div><span className="mini-num">0{i+1}</span><h3>{String(title)}</h3><p>{String(copy)}</p><ChevronRight size={16}/></div>})}</section>}
    {loading && <div className="loading-card"><div className="loader-ring"/><h3>Auditing @{username.replace(/^@/,"")}</h3><p>Inspecting public repositories, documentation, metadata, languages, and recent activity…</p></div>}

    {data && audit && !loading && <section className="dashboard">
      <div className="profile-card"><div className="profile-main"><img className="avatar" src={data.user.avatar} alt={`${data.user.login} avatar`}/><div><div className="handle">@{data.user.login}</div><h2>{data.user.name || data.user.login}</h2><p>{data.user.bio || "No public bio."}</p><div className="meta">{data.user.location&&<span><MapPin size={14}/>{data.user.location}</span>}<span><BookOpen size={14}/>Joined {new Date(data.user.createdAt).getFullYear()}</span>{data.user.blog&&<a href={data.user.blog.startsWith("http")?data.user.blog:`https://${data.user.blog}`} target="_blank" rel="noreferrer"><Globe2 size={14}/>Website</a>}</div></div></div><a className="profile-link" href={data.user.url} target="_blank" rel="noreferrer">Open profile <ArrowUpRight size={15}/></a></div>

      <div className="score-hero"><div><span className="section-kicker">PERSONALIZED PROFILE SCORE</span><h2>{audit.score}<small>/100</small></h2><p>This score measures the quality of the <strong>public GitHub profile as a portfolio</strong>. It is not a score of programming ability, and popularity is only one small category.</p></div><ScoreRing score={audit.score}/></div>

      <div className="stats-grid">{[["Original repos",data.stats.originalRepositories,BookOpen],["Stars",data.stats.stars,Star],["Forks",data.stats.forks,GitFork],["Followers",data.stats.followers,Users],["Updated 90d",data.stats.updated90,TrendingUp],["READMEs",data.stats.readmeCount,FileText],["Licensed",data.stats.licensed,ShieldCheck],["Languages",data.languages.length,Code2]].map(([label,value,Icon])=>{const I=Icon as typeof Star;return <div className="stat" key={String(label)}><div className="stat-top"><span>{String(label)}</span><I size={15}/></div><strong>{formatNumber(Number(value))}</strong><small>public evidence</small></div>})}</div>

      <div className="tabs"><button className={tab==="overview"?"active":""} onClick={()=>setTab("overview")}>Overview</button><button className={tab==="audit"?"active":""} onClick={()=>setTab("audit")}>Full audit</button><button className={tab==="projects"?"active":""} onClick={()=>setTab("projects")}>What to build</button></div>

      {tab==="overview" && <>
        <div className="section-head"><div><span className="section-kicker">SIGNALS</span><h2>What stands out</h2></div></div>
        <div className="insight-grid"><div className="insight-column"><div className="column-title"><CheckCircle2 size={17}/> Strengths</div>{audit.strengths.length?audit.strengths.map(x=><div className="insight strength" key={x.title}><div><h3>{x.title}</h3><p>{x.body}</p><small>{x.evidence}</small></div></div>):<div className="empty-card">No strong signal crossed the current evidence threshold. That does not mean the work is weak—it means the public profile is not proving it yet.</div>}</div><div className="insight-column"><div className="column-title"><CircleAlert size={17}/> Fix these</div>{audit.gaps.map(x=><div className={`insight ${x.type}`} key={x.title}><div><h3>{x.title}</h3><p>{x.body}</p><small>{x.evidence}</small></div></div>)}</div></div>
        <div className="section-head"><div><span className="section-kicker">BREAKDOWN</span><h2>Where the score comes from</h2></div></div>
        <div className="score-panel">{audit.categories.map(c=><ScoreBar category={c} key={c.key}/>)}</div>
        <div className="charts-grid"><div className="panel"><div className="panel-head"><div><h3>Language fingerprint</h3><p>Measured from repository language data, not repository count alone.</p></div><Code2 size={17}/></div>{data.languages.length?<div className="chart-row"><LanguageDonut languages={data.languages}/><div className="legend">{data.languages.slice(0,8).map((l,i)=><div className="legend-item" key={l.name}><i style={{background:palette[i%palette.length]}}/><span>{l.name}</span><b>{pct(l.value,data.languages.reduce((a,x)=>a+x.value,0))}%</b></div>)}</div></div>:<div className="empty">No language data available.</div>}</div><div className="panel"><div className="panel-head"><div><h3>Project impact</h3><p>Stars + forks, shown without pretending they equal code quality.</p></div><BarChart3 size={17}/></div><RepoBars repositories={data.repositories}/></div></div>
      </>}

      {tab==="audit" && <>
        <div className="section-head"><div><span className="section-kicker">DETAILED AUDIT</span><h2>Evidence behind every category</h2></div></div>
        <div className="audit-list">{audit.categories.map(c=><div className="audit-card" key={c.key}><div className="audit-card-head"><div><span>{c.label}</span><h3>{c.score}<small>/100</small></h3></div><div className="audit-weight">{c.max} pts of final score</div></div><p>{c.summary}</p><ul>{c.evidence.map(e=><li key={e}>{e}</li>)}</ul></div>)}</div>
        <div className="data-note"><ShieldCheck size={17}/><div><strong>What this analyzer cannot know</strong><p>{data.meta.dataNote} Public GitHub events also do not equal the contribution graph.</p></div></div>
      </>}

      {tab==="projects" && <>
        <div className="section-head"><div><span className="section-kicker">PERSONALIZED IDEAS</span><h2>What you should build next</h2></div><span className="muted">Derived from your public project history</span></div>
        <div className="recommend-grid">{audit.recommendations.map((r,i)=><div className="recommend-card" key={r.title}><div className="recommend-number">0{i+1}</div><h3>{r.title}</h3><p className="why"><strong>Why this fits:</strong> {r.why}</p><p>{r.build}</p><div className="stack">{r.stack.map(s=><span key={s}>{s}</span>)}</div></div>)}</div>
        <div className="section-head repo-head"><div><span className="section-kicker">PAST PROJECTS</span><h2>Projects the analyzer used</h2></div></div>
        <div className="repo-grid">{data.repositories.map(r=><a className="repo-card" href={r.url} target="_blank" rel="noreferrer" key={r.id}><div className="repo-title"><Code2 size={16}/><h3>{r.name}</h3><ArrowUpRight size={14}/></div><p>{r.description||"No description provided."}</p><div className="topic-row">{r.topics.slice(0,4).map(t=><span key={t}>{t}</span>)}</div><div className="repo-bottom"><span>{r.language||"Other"}</span><span><Star size={13}/>{formatNumber(r.stars)}</span><span><GitFork size={13}/>{formatNumber(r.forks)}</span><span>{r.readme.exists?"README":"No README"}</span></div></a>)}</div>
      </>}

      <div className="section-head repo-head"><div><span className="section-kicker">RECENT ACTIVITY</span><h2>What GitHub publicly shows</h2></div><span className="muted">Last 90 days: {data.activity.recent90} public events</span></div><div className="activity-list">{data.recent.map(r=><a href={r.url} target="_blank" rel="noreferrer" className="activity" key={r.name}><span className="activity-dot"/><div><b>{r.name}</b><small>{r.language||"Repository"} · {timeAgo(r.pushedAt)}</small></div><ArrowUpRight size={15}/></a>)}</div>
    </section>}
    <footer><span>GitScope</span><span>Public-data audit · Scores are evidence-based, not a measure of developer worth</span></footer>
  </main>;
}
