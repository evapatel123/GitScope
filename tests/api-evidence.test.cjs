const { test, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { execFileSync } = require("node:child_process");
const ts = require("typescript");

// Compile the actual TypeScript in memory, without a network or new dependencies.
const root = path.resolve(__dirname, "..");
function load(file, source, overrides = {}) {
  const filename = path.join(root, file);
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(root);
  const original = mod.require.bind(mod);
  mod.require = name => Object.hasOwn(overrides, name) ? overrides[name] : original(name);
  mod._compile(ts.transpileModule(source ?? fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }
  }).outputText, filename);
  return mod.exports;
}

const baselineRef = process.env.GITSCOPE_BASELINE_REF;
const oldSource = file => execFileSync("git", ["show", baselineRef + ":" + file], { cwd: root, encoding: "utf8" });
const scoreModule = source => load("components/Analyzer.tsx", source + "\nexport { analyzeProfile };");
const candidateUI = load("components/Analyzer.tsx", fs.readFileSync(path.join(root, "components/Analyzer.tsx"), "utf8") + "\nexport { analyzeProfile, readmeLabel, readmeLimitations };");
const candidateScore = candidateUI.analyzeProfile;
const numericScores = audit => ({score:audit.score, categories:audit.categories.map(({key,score,max})=>({key,score,max}))});
let current, route;
const originalFetch = global.fetch;
const realNow = Date.now;
const priorToken = process.env.GITHUB_TOKEN;
delete process.env.GITHUB_TOKEN;
const fixedTime = Date.parse("2026-11-27T00:00:00Z");
let now = fixedTime;
Date.now = () => now;
beforeEach(() => {
  now = fixedTime;
  delete process.env.GITHUB_TOKEN;
  global.fetch = async () => { throw new Error("No fixture installed"); };
  current = load("lib/github.ts");
  route = load("app/api/analyze/route.ts", undefined, { "@/lib/github": current });
});
after(() => {
  global.fetch = originalFetch;
  Date.now = realNow;
  if (priorToken !== undefined) process.env.GITHUB_TOKEN = priorToken;
  else delete process.env.GITHUB_TOKEN;
});

function fixture(username, { count = 24, profile = true, profileLast = false, missing = [], fail, events = 1, emptyLanguages = false, archivedTop = false, transformRepo = r => r, transformUser = u => u, readmeContent } = {}) {
  const calls = [];
  let active = 0, peak = 0;
  const date = "2026-11-01T00:00:00Z";
  const repos = Array.from({ length: count }, (_, i) => {
    const name = profile && i === (profileLast ? count - 1 : 0) ? username : "repo-" + i;
    return transformRepo({ id: i + 1, name, full_name: username + "/" + name, html_url: "https://github.com/" + username + "/" + name,
      description: "Synthetic Python and TypeScript project", stargazers_count: archivedTop && i === count - 1 ? 5000 : profileLast && i === count - 1 ? 0 : i >= 18 && i < 24 ? 1000 + i : count - i,
      watchers_count: 1, forks_count: 1, language: "Python", languages_url: "https://api.github.com/repos/" + username + "/" + name + "/languages",
      size: 100, created_at: date, updated_at: date, pushed_at: date, fork: false, archived: archivedTop && i === count - 1, disabled: false,
      topics: ["python", "ai"], license: { spdx_id: "MIT" }, homepage: null, default_branch: "main",
      has_issues: true, has_projects: false, has_wiki: false, has_pages: false, open_issues_count: 0 }, i);
  });
  const response = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers });
  global.fetch = async (input, init) => {
    const url = new URL(input);
    assert.equal(url.origin, "https://api.github.com", "unexpected network target");
    calls.push(url.pathname + url.search);
    active++; peak = Math.max(peak, active);
    try {
      await Promise.resolve();
      const problem = fail?.(url, calls.length);
      if (problem) {
        if (problem === "network") throw new Error("synthetic network failure");
        if (problem === "invalid-json") return new Response("{");
        return response(Object.hasOwn(problem, "body") ? problem.body : { message: "synthetic failure" }, problem.status, problem.headers);
      }
      if (url.pathname.toLowerCase() === "/users/" + username.toLowerCase()) {
        return response(transformUser({ login: username, id: 101, avatar_url: "https://example.org/avatar", html_url: "https://github.com/" + username,
          name: "Synthetic User", bio: "Synthetic public developer profile for deterministic tests.", company: null,
          location: null, blog: null, twitter_username: null, public_repos: count, public_gists: 0, followers: 2, following: 3,
          created_at: date, updated_at: date }));
      }
      if (url.pathname.endsWith("/repos")) {
        const page = Number(url.searchParams.get("page"));
        return response(repos.slice((page - 1) * 100, page * 100));
      }
      if (url.pathname.endsWith("/events/public")) {
        const page = Number(url.searchParams.get("page"));
        return response(Array.from({length: Math.max(0, Math.min(100, events - (page - 1) * 100))},
          () => ({ type: "PushEvent", created_at: date, repo: {name: username + "/repo-1"} })));
      }
      const name = decodeURIComponent(url.pathname.split("/")[3]);
      if (url.pathname.endsWith("/readme")) {
        if (missing.includes(name)) return response({ message: "Not Found" }, 404);
        return response({ encoding: "base64", content: readmeContent ?? Buffer.from("# Setup Usage Tests License\n".repeat(32)).toString("base64") });
      }
      if (url.pathname.endsWith("/languages")) return response(emptyLanguages ? {} : { Python: 700, TypeScript: 300 });
      throw new Error("unexpected fixture URL " + url);
    } finally { active--; }
  };
  return { calls, peak: () => peak };
}

const { NextRequest } = require("next/server");
const request = username => new NextRequest("http://localhost/api/analyze?username=" + encodeURIComponent(username));
const normalize = x => JSON.parse(JSON.stringify(x, (key, value) => ["status","profileReadmeStatus"].includes(key) ? undefined : value));

test("complete audit: reuse inspected profile README, bounded request concurrency", async () => {
  const f = fixture("complete");
  const data = await current.analyzeGithubUser("complete");
  assert.equal(f.calls.length, 51);
  assert.equal(f.calls.filter(p => p.endsWith("/complete/complete/readme")).length, 1);
  assert.ok(f.peak() <= 4);
  assert.equal(data.stats.readmeCount, 24);
  assert.equal(data.stats.profileReadme, true);
  assert.equal(data.evidence[0].readme.status, "present");
});

test("ambiguous README 404 is unavailable, not confirmed missing", async () => {
  fixture("missing", { count: 2, missing: ["missing", "repo-1"] });
  const data = await current.analyzeGithubUser("missing");
  assert.equal(data.stats.readmeCount, 0);
  assert.equal(data.stats.profileReadme, false);
  assert.ok(data.evidence.every(r => r.readme.status === "unavailable"));
  assert.equal(data.stats.profileReadmeStatus,"unavailable");
  assert.ok(data.repositories.every(r => r.readme.status === "unavailable"));
  const audit = candidateScore(data);
  assert.ok(audit.gaps.some(g=>g.title==="Profile README evidence is uncertain"));
  assert.ok(!audit.gaps.some(g=>g.title==="No public profile README repository found"));
  assert.ok(audit.gaps.some(g=>g.title==="Documentation coverage could not be established"));
  assert.match(candidateUI.readmeLabel("unavailable"),/absence unconfirmed/);
  assert.match(candidateUI.readmeLimitations(data),/unchanged formulas/);
  assert.match(audit.recommendations.find(r=>r.title==="Documentation-first open-source project").why,/Verify whether unavailable/);
  assert.ok(Number.isFinite(candidateScore(data).score));
});

test("profile outside inspection still fetched exactly once", async () => {
  const f = fixture("outside", { count: 40, profileLast: true });
  const data = await current.analyzeGithubUser("outside");
  assert.equal(data.stats.profileReadme, true);
  assert.equal(f.calls.filter(p => p.endsWith("/outside/outside/readme")).length, 1);
  assert.equal(data.evidence.some(r => r.name === "outside"), false);
});

test("anonymous repeat and case-insensitive concurrent requests share successful result", async () => {
  const f = fixture("cachecase", { count: 24 });
  const [a,b] = await Promise.all([current.analyzeCachedGithubUser("cachecase"), current.analyzeCachedGithubUser("CACHECASE")]);
  assert.deepEqual(a,b);
  assert.equal(f.calls.length, 51);
  assert.deepEqual(await current.analyzeCachedGithubUser("cachecase"), a);
  assert.equal(f.calls.length, 51);
  now += 120001;
  await current.analyzeCachedGithubUser("cachecase");
  assert.equal(f.calls.length, 102);
  now = fixedTime;
});

test("token-backed requests bypass the anonymous cache", async () => {
  const f = fixture("token", { count: 2 });
  await current.analyzeCachedGithubUser("token");
  const one = f.calls.length;
  process.env.GITHUB_TOKEN = "synthetic-not-a-real-token";
  try {
    await current.analyzeCachedGithubUser("token");
    await current.analyzeCachedGithubUser("token");
    assert.equal(f.calls.length, 3 * one);
  } finally { delete process.env.GITHUB_TOKEN; }
});

for (const [label, problem, expected] of [
  ["primary-limit", {status:403,headers:{"x-ratelimit-remaining":"0"}}, 429],
  ["secondary-limit", {status:403,body:{message:"You have exceeded a secondary rate limit."}}, 429],
  ["429", {status:429}, 429],
  ["forbidden", {status:403}, 502],
  ["retry-after", {status:403,headers:{"retry-after":"60"}}, 429],
  ["unsupported-readme", {status:200,body:{content:"",encoding:"none"}}, 502],
  ["server", {status:503}, 502],
  ["network", "network", 502],
  ["invalid-json", "invalid-json", 502],
  ["null-json", {status:200,body:null}, 502]
]) {
  test(label + ": unavailable README never yields score or cached failure", async () => {
    const f = fixture(label, { count:24, fail: u => u.pathname.endsWith("/" + label + "/readme") ? problem : null });
    const res = await route.GET(request(label));
    assert.equal(res.status, expected);
    assert.match((await res.json()).error, /No score was calculated/);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.ok(f.calls.length <= 7);
    assert.ok(!f.calls.some(p => p.endsWith("/languages")));
    const healthy = fixture(label, {count:24});
    if (expected === 429) {
      assert.equal((await route.GET(request(label))).status, 429);
      assert.equal(healthy.calls.length, 0);
      now += 60_000;
    }
    const retry = await route.GET(request(label));
    assert.equal(retry.status, 200);
    assert.equal(healthy.calls.length, 51);
  });
}

test("failure during language retrieval is not treated as zero languages", async () => {
  fixture("languagesfail", { count: 4, fail: u => u.pathname.endsWith("/languages") ? {status:404} : null });
  const res = await route.GET(request("languagesfail"));
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /languages for/);
});

test("failure after partial events aborts evaluation", async () => {
  fixture("eventsfail", { events: 101, fail: u => u.pathname.endsWith("/events/public") && u.searchParams.get("page") === "2" ? {status:503} : null });
  const res = await route.GET(request("eventsfail"));
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /public events/);
});

test("unknown profile is 404, not rate limit or successful empty result", async () => {
  fixture("unknown", {fail: u => u.pathname === "/users/unknown" ? {status:404} : null});
  const res = await route.GET(request("unknown"));
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, "GitHub user not found.");
});

test("successful empty language map and empty repository list remain valid", async () => {
  fixture("empty", {count:0, profile:false, events:0});
  const data = await current.analyzeGithubUser("empty");
  assert.equal(data.stats.activeRepositories, 0);
  assert.deepEqual(data.languages, []);
  fixture("emptylanguages", {count:2, emptyLanguages:true});
  const fallback = await current.analyzeGithubUser("emptylanguages");
  assert.deepEqual(fallback.languages,[{name:"Python",value:200}]);
});

test("original scoring and successful response equivalence", { skip: !baselineRef }, async () => {
  const old = load("lib/github.ts", oldSource("lib/github.ts"));
  const originalScore = scoreModule(oldSource("components/Analyzer.tsx")).analyzeProfile;
  for (const [name, opts] of [
    ["full", {}],
    ["noprofile", {profile:false}],
    ["partialmissing", {count:3, missing:["partialmissing","repo-1"]}],
    ["small", {count:2}],
    ["outside", {count:40,profileLast:true}],
    ["empty", {count:0,profile:false,events:0}],
    ["multipage", {count:101,events:101}],
    ["emptylanguages", {count:3,emptyLanguages:true}]
  ]) {
    const f = fixture(name,opts);
    const base = await old.analyzeGithubUser(name);
    const c = fixture(name,opts);
    const result = await current.analyzeGithubUser(name);
    assert.deepEqual(normalize(result),base);
    assert.deepEqual(numericScores(candidateScore(result)),numericScores(originalScore(base)));
    console.log(JSON.stringify({fixture:name,baselineRequests:f.calls.length,candidateRequests:c.calls.length,score:candidateScore(result).score,baselinePeak:f.peak(),candidatePeak:c.peak()}));
  }
});

test("rate-limited first README: compare baseline request waste", { skip: !baselineRef }, async () => {
  const old = load("lib/github.ts", oldSource("lib/github.ts"));
  const opts = { fail: u => u.pathname.endsWith("/readme") || u.pathname.endsWith("/languages")
    ? {status:403,headers:{"x-ratelimit-remaining":"0"}} : null };
  const a = fixture("limited", opts);
  const misleading = await old.analyzeGithubUser("limited");
  assert.equal(misleading.stats.readmeCount,0);
  const b = fixture("limited",opts);
  await assert.rejects(current.analyzeGithubUser("limited"), e => e.status===429);
  assert.equal(a.calls.length,52);
  assert.equal(b.calls.length,7);
  console.log(JSON.stringify({fixture:"rate-limited",baselineRequests:a.calls.length,candidateRequests:b.calls.length,baselineMisleadingScore: scoreModule(oldSource("components/Analyzer.tsx")).analyzeProfile(misleading).score,candidateScore:null}));
});

test("repeat audit comparison: same data and fewer actual requests", { skip: !baselineRef }, async () => {
  const old = load("lib/github.ts",oldSource("lib/github.ts"));
  const a = fixture("repeat-compare");
  const before = await old.analyzeGithubUser("repeat-compare");
  await old.analyzeGithubUser("repeat-compare");
  const b = fixture("repeat-compare");
  const after = await current.analyzeCachedGithubUser("repeat-compare");
  assert.deepEqual(await current.analyzeCachedGithubUser("repeat-compare"),after);
  assert.deepEqual(normalize(after),before);
  assert.equal(a.calls.length,104);
  assert.equal(b.calls.length,51);
  console.log(JSON.stringify({fixture:"repeat-audit",baselineRequests:a.calls.length,candidateRequests:b.calls.length}));
});

test("successful cache is bounded and evicts oldest entries", async () => {
  for (let i=0;i<33;i++) {
    fixture("bounded-"+i,{count:0,profile:false,events:0});
    await current.analyzeCachedGithubUser("bounded-"+i);
  }
  const old = fixture("bounded-0",{count:0,profile:false,events:0});
  await current.analyzeCachedGithubUser("bounded-0");
  assert.equal(old.calls.length,3);
});

test("malformed language map does not yield a score", async () => {
  fixture("badlanguages", {count:2,fail:u=>u.pathname.endsWith("/languages") ? {status:200,body:{Python:"700"}} : null});
  const res=await route.GET(request("badlanguages"));
  assert.equal(res.status,502);
  assert.match((await res.json()).error,/languages for/);
});

test("repository pagination failure is not a truncated successful audit", async () => {
  const f=fixture("reposfail",{count:101,fail:u=>u.pathname.endsWith("/repos") && u.searchParams.get("page")==="2" ? {status:429} : null});
  const res=await route.GET(request("reposfail"));
  assert.equal(res.status,429);
  assert.equal(f.calls.length,3);
  assert.match((await res.json()).error,/repository list/);
});

test("uninspected top repository is not described as missing a README", async () => {
  const f=fixture("uninspected",{count:25,archivedTop:true});
  const data=await current.analyzeGithubUser("uninspected");
  assert.equal(data.repositories[0].name,"repo-24");
  assert.equal(data.repositories[0].readme.status,"not_inspected");
  assert.ok(!f.calls.some(p=>p.endsWith("/repo-24/readme")));
});

test("invalid usernames never make a GitHub request", async () => {
  const f = fixture("validation");
  for (const input of ["", "@", "-abc", "abc-", "a/b", "a b", "x".repeat(40), "https://github.com/user"]) {
    const res = await route.GET(request(input));
    assert.equal(res.status, 400, input);
  }
  assert.equal(f.calls.length, 0);
});

test("malformed HTTP 200 profile cannot produce an audit", async () => {
  fixture("badprofile", {fail: u => u.pathname === "/users/badprofile" ? {status:200,body:{}} : null});
  const res = await route.GET(request("badprofile"));
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /No score was calculated/);
});

test("malformed repository record cannot be counted as a real project", async () => {
  fixture("badrepo", {fail: u => u.pathname.endsWith("/repos") ? {status:200,body:[{id:1,name:"phantom"}]} : null});
  const res = await route.GET(request("badrepo"));
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /repository list/);
});

test("malformed public event cannot be mistaken for no recent activity", async () => {
  fixture("badevent", {fail: u => u.pathname.endsWith("/events/public") ? {status:200,body:[{type:"PushEvent",created_at:"not-a-date"}]} : null});
  const res = await route.GET(request("badevent"));
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /public events/);
});

test("invalid base64 README is unavailable, not empty documentation", async () => {
  fixture("badbase64", {count:2,fail:u=>u.pathname.endsWith("/readme") ? {status:200,body:{encoding:"base64",content:"!!!!"}} : null});
  const res=await route.GET(request("badbase64"));
  assert.equal(res.status,502);
  assert.match((await res.json()).error,/README/);
});

test("failed coalesced request waits for already-started siblings before allowing retry", async () => {
  const f=fixture("drain", {count:4});
  const mock=global.fetch;
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  let started=0, settled=false;
  global.fetch=async (url,init)=>{
    const pathname=new URL(url).pathname;
    if(pathname.endsWith("/readme")){
      started++;
      if(pathname.endsWith("/drain/readme"))return new Response("{}",{status:429});
      await gate;
    }
    return mock(url,init);
  };
  const p=current.analyzeCachedGithubUser("drain").then(()=>null,e=>e).finally(()=>{settled=true;});
  try{
    for(let i=0;i<20 && started<4;i++)await new Promise(setImmediate);
    assert.equal(started,4);
    await new Promise(setImmediate);
    assert.equal(settled,false,"in-flight batch must drain before releasing cache entry");
    const q=current.analyzeCachedGithubUser("DRAIN").then(()=>null,e=>e);
    release();
    assert.equal((await p).status,429);
    assert.equal((await q).status,429);
    assert.equal(started,4);
    assert.ok(!f.calls.some(x=>x.endsWith("/languages")));
  }finally{release();await p;}
  const healthy=fixture("drain",{count:4});
  now += 60_000;
  assert.equal((await route.GET(request("drain"))).status,200);
  assert.equal(healthy.calls.length,11);
});

test("mixed forbidden and rate-limit failures in same batch report rate limit", async () => {
  fixture("mixed", {count:4,fail:u=>u.pathname.endsWith("/mixed/readme") ? {status:403} : u.pathname.endsWith("/repo-1/readme") ? {status:429} : null});
  const mock=global.fetch;
  global.fetch=async (url,init)=>{
    if(String(url).endsWith("/repo-1/readme")) await new Promise(setImmediate);
    return mock(url,init);
  };
  const res=await route.GET(request("mixed"));
  assert.equal(res.status,429);
});

test("each GitHub request receives a finite abort signal", async () => {
  fixture("deadline",{count:2});
  const mock=global.fetch;
  const observed=[];
  global.fetch=(url,init)=>{
    observed.push(init?.signal);
    return mock(url,init);
  };
  await current.analyzeGithubUser("deadline");
  assert.equal(observed.length,7);
  assert.ok(observed.every(signal=>signal instanceof AbortSignal));
});

test("timeout aborts evidence retrieval, never returns a score, and permits recovery", async () => {
  const f=fixture("timeout",{count:2});
  const mock=global.fetch;
  const originalTimeout=AbortSignal.timeout;
  let observedTimeout, aborted=false;
  AbortSignal.timeout = ms => { observedTimeout=ms; return originalTimeout(10); };
  global.fetch=async (url,init)=>{
    if(!String(url).endsWith("/timeout/readme")) return mock(url,init);
    return new Promise((resolve,reject)=>{
      const keepAlive=setTimeout(()=>reject(new Error("abort not delivered")),1000);
      init.signal.addEventListener("abort",()=>{
        aborted=true;clearTimeout(keepAlive);reject(init.signal.reason);
      },{once:true});
    });
  };
  try{
    const response=await route.GET(request("timeout"));
    assert.equal(response.status,502);
    assert.equal(observedTimeout,15000);
    assert.equal(aborted,true);
    assert.match((await response.json()).error,/No score was calculated/);
    assert.ok(!f.calls.some(x=>x.endsWith("/languages")));
  }finally{AbortSignal.timeout=originalTimeout;}
  fixture("timeout",{count:2});
  assert.equal((await route.GET(request("timeout"))).status,200);
});

test("wrapped and empty Base64 are valid; null optional metadata remains valid", async () => {
  const text="# Valid documentation";
  fixture("wrapped",{count:2,readmeContent:Buffer.from(text).toString("base64").replace(/(.{4})/g,"$1\n"),
    transformRepo:r=>({...r,pushed_at:null,description:null,language:null,homepage:null,license:null,topics:undefined}),
    transformUser:u=>({...u,name:null,bio:null,company:null,location:null,blog:null,twitter_username:undefined})});
  const wrapped=await current.analyzeGithubUser("wrapped");
  assert.equal(wrapped.evidence[0].readme.text,text);
  assert.equal(wrapped.evidence[0].readme.status,"present");
  fixture("emptyreadme",{count:1,readmeContent:""});
  const empty=await current.analyzeGithubUser("emptyreadme");
  assert.deepEqual(empty.evidence[0].readme,{exists:true,text:"",status:"present"});
});

test("omitted required nullable score fields fail closed rather than count as missing", async () => {
  fixture("incompleteprofile",{transformUser:u=>({...u,bio:undefined})});
  assert.equal((await route.GET(request("incompleteprofile"))).status,502);
  fixture("incompleterepo",{count:1,transformRepo:r=>({...r,description:undefined})});
  assert.equal((await route.GET(request("incompleterepo"))).status,502);
});

test("token header and anonymous cache isolation are observable", async () => {
  const f=fixture("headeriso",{count:1});
  const mock=global.fetch;
  const headers=[];
  global.fetch=(url,init)=>{headers.push(new Headers(init.headers).get("authorization"));return mock(url,init);};
  await current.analyzeCachedGithubUser("headeriso");
  const n=f.calls.length;
  assert.ok(headers.every(x=>x===null));
  process.env.GITHUB_TOKEN="synthetic-only";
  try{
    const response=await route.GET(request("headeriso"));
    assert.equal(response.status,200);
    assert.equal(response.headers.get("cache-control"),"no-store");
    assert.ok(headers.slice(n).every(x=>x==="Bearer synthetic-only"));
  }finally{delete process.env.GITHUB_TOKEN;}
  await current.analyzeCachedGithubUser("headeriso");
  assert.equal(f.calls.length,n*2);
});

test("no cross-profile cache reuse; exact TTL boundary and fresh result", async () => {
  fixture("ttl-a",{count:1});
  const a=await current.analyzeCachedGithubUser("ttl-a");
  const f=fixture("ttl-b",{count:2});
  const b=await current.analyzeCachedGithubUser("ttl-b");
  assert.notEqual(a.user.login,b.user.login);
  assert.equal(f.calls.length,7);
  now=fixedTime+119999;
  assert.deepEqual(await current.analyzeCachedGithubUser("ttl-b"),b);
  assert.equal(f.calls.length,7);
  now=fixedTime+120000;
  try{
    const fresh=fixture("ttl-b",{count:3});
    const refreshed=await current.analyzeCachedGithubUser("ttl-b");
    assert.equal(refreshed.stats.activeRepositories,3);
    assert.equal(fresh.calls.length,9);
  }finally{now=fixedTime;}
});

test("differential pagination and sampling boundaries retain scoring and report parity", {skip:!baselineRef}, async () => {
  const old=load("lib/github.ts",oldSource("lib/github.ts"));
  const oldScore=scoreModule(oldSource("components/Analyzer.tsx")).analyzeProfile;
  let cases=0;
  for(const count of [0,1,17,18,19,24,25,99,100,101,999,1000,1001]){
    const name="boundary-"+count;
    const opts={count,profile:count>0,profileLast:count>24,events:count%2?101:300,
      transformRepo:(r,i)=>({...r,description:i%3?r.description:null,topics:i%5?r.topics:[],
        fork:i%7===1,archived:i%11===2,disabled:i%13===3,license:i%4?r.license:null,
        pushed_at:i%2?r.pushed_at:"2025-01-01T00:00:00Z",stargazers_count:r.stargazers_count+(i%9)}),
      missing:["repo-5","repo-8"]};
    const a=fixture(name,opts);
    const original=await old.analyzeGithubUser(name);
    const b=fixture(name,opts);
    const candidate=await current.analyzeGithubUser(name);
    assert.deepEqual(normalize(candidate),original,name);
    assert.deepEqual(numericScores(candidateScore(candidate)),numericScores(oldScore(original)),name);
    assert.ok(b.calls.length<=a.calls.length,name);
    assert.ok(b.peak()<=4,name);
    assert.ok(candidate.evidence.length<=24,name);
    cases++;
  }
  console.log("Differential sampling/pagination cases:",cases);
});

test("rate-limit cooldown blocks new profiles until Retry-After has elapsed", async () => {
  const f=fixture("cooldown-a",{fail:u=>u.pathname==="/users/cooldown-a"?{status:429,headers:{"retry-after":"90"}}:null});
  const a=await route.GET(request("cooldown-a"));
  assert.equal(a.status,429);
  assert.equal(f.calls.length,1);
  const b=fixture("cooldown-b",{count:0,profile:false,events:0});
  const blocked=await route.GET(request("cooldown-b"));
  assert.equal(blocked.status,429);
  assert.equal(b.calls.length,0);
  assert.equal(blocked.headers.get("retry-after"),"90");
  now=fixedTime+89999;
  try{
    assert.equal((await route.GET(request("cooldown-b"))).status,429);
    assert.equal(b.calls.length,0);
    now=fixedTime+90000;
    assert.equal((await route.GET(request("cooldown-b"))).status,200);
    assert.equal(b.calls.length,3);
  }finally{now=fixedTime;}
});

test("primary rate-limit reset wins over shorter Retry-After", async () => {
  fixture("primaryreset",{fail:u=>u.pathname==="/users/primaryreset"?{status:403,headers:{"x-ratelimit-remaining":"0","x-ratelimit-reset":String(fixedTime/1000+180),"retry-after":"5"}}:null});
  const res=await route.GET(request("primaryreset"));
  assert.equal(res.status,429);
  assert.equal(res.headers.get("retry-after"),"180");
  const f=fixture("newprofile",{count:0,profile:false,events:0});
  now=fixedTime+179999;
  try{
    assert.equal((await route.GET(request("newprofile"))).status,429);
    assert.equal(f.calls.length,0);
    now=fixedTime+180000;
    assert.equal((await route.GET(request("newprofile"))).status,200);
    assert.equal(f.calls.length,3);
  }finally{now=fixedTime;}
});

test("successful last available request must not start further calls", async () => {
  const f=fixture("lastrequest",{count:0,profile:false,events:0});
  const mock=global.fetch;
  global.fetch=async (url,init)=>{
    const response=await mock(url,init);
    if(new URL(url).pathname==="/users/lastrequest"){
      response.headers.set("x-ratelimit-remaining","0");
      response.headers.set("x-ratelimit-reset",String(fixedTime/1000+120));
    }
    return response;
  };
  const res=await route.GET(request("lastrequest"));
  assert.equal(res.status,429);
  assert.equal(f.calls.length,1);
  assert.equal(res.headers.get("retry-after"),"120");
});

test("cooldown never shortens when a later sibling supplies a longer reset", async () => {
  fixture("longest",{count:4,fail:u=>u.pathname.endsWith("/longest/readme")
    ? {status:429,headers:{"retry-after":"10"}} : null});
  const mock=global.fetch;
  global.fetch=async (url,init)=>{
    if(String(url).endsWith("/repo-1/readme")){
      await new Promise(setImmediate);
      const response=await mock(url,init);
      response.headers.set("x-ratelimit-remaining","0");
      response.headers.set("x-ratelimit-reset",String(fixedTime/1000+180));
      return response;
    }
    return mock(url,init);
  };
  const result=await route.GET(request("longest"));
  assert.equal(result.status,429);
  assert.equal(result.headers.get("retry-after"),"180");
});

test("invalid or absent rate-limit deadlines use conservative 60-second fallback", async () => {
  fixture("badheaders",{fail:u=>u.pathname==="/users/badheaders"?
    {status:429,headers:{"retry-after":"invalid","x-ratelimit-remaining":"0","x-ratelimit-reset":"0"}}:null});
  const result=await route.GET(request("badheaders"));
  assert.equal(result.status,429);
  assert.equal(result.headers.get("retry-after"),"60");
  const f=fixture("healthy",{count:0,profile:false,events:0});
  for(let i=0;i<5;i++)assert.equal((await route.GET(request("healthy"))).status,429);
  assert.equal(f.calls.length,0);
  now=fixedTime+60000;
  assert.equal((await route.GET(request("healthy"))).status,200);
  assert.equal(f.calls.length,3);
});

test("cached anonymous report remains usable while new authenticated and anonymous calls are blocked", async () => {
  fixture("cached",{count:0,profile:false,events:0});
  const previous=await route.GET(request("cached"));
  const original=await previous.json();
  fixture("limited",{fail:u=>u.pathname==="/users/limited"?{status:429}:null});
  assert.equal((await route.GET(request("limited"))).status,429);
  const f=fixture("cached",{count:0,profile:false,events:0});
  assert.deepEqual(await (await route.GET(request("cached"))).json(),original);
  assert.equal(f.calls.length,0);
  process.env.GITHUB_TOKEN="synthetic-only";
  try {
    assert.equal((await route.GET(request("cached"))).status,429);
    assert.equal(f.calls.length,0);
  } finally {delete process.env.GITHUB_TOKEN;}
});

test("missing visible profile repository is separate from ambiguous README 404", async () => {
  const f=fixture("noprofile-visible",{count:2,profile:false});
  const data=await current.analyzeGithubUser("noprofile-visible");
  assert.equal(data.stats.profileReadmeStatus,"missing");
  assert.equal(data.stats.profileReadme,false);
  assert.ok(data.evidence.every(r=>r.readme.status==="present"));
  assert.ok(candidateScore(data).gaps.some(g=>g.title==="No public profile README repository found"));
  assert.equal(candidateUI.readmeLimitations(data),"");
  assert.equal(f.calls.length,7);
});

test("incomplete repository list cannot establish profile README absence", async () => {
  fixture("incomplete",{count:2,profile:false,transformUser:u=>({...u,public_repos:3})});
  const data=await current.analyzeGithubUser("incomplete");
  assert.equal(data.stats.profileReadmeStatus,"not_inspected");
  assert.ok(candidateScore(data).gaps.some(g=>g.title==="Profile README evidence is uncertain"));
  assert.match(candidateUI.readmeLimitations(data),/incomplete repository list/);
});

test("same 404 for genuinely absent and concealed README yields identical uncertainty", async () => {
  for(const cause of ["absent","concealed"]){
    const f=fixture("ambiguous-"+cause,{count:2,fail:u=>u.pathname.endsWith("/readme")?{status:404,body:{message:"Not Found"}}:null});
    const data=await current.analyzeGithubUser("ambiguous-"+cause);
    assert.equal(data.stats.profileReadmeStatus,"unavailable");
    assert.ok(data.evidence.every(r=>r.readme.status==="unavailable"));
    assert.match(candidateUI.readmeLimitations(data),/A 404 cannot establish absence/);
    assert.equal(f.calls.length,7);
  }
});

test("follow-up preserves exact main scores and API paths", {skip:!process.env.GITSCOPE_FOLLOWUP_BASELINE_REF}, async () => {
  const baseRef=process.env.GITSCOPE_FOLLOWUP_BASELINE_REF;
  const source=file=>execFileSync("git",["show",baseRef+":"+file],{cwd:root,encoding:"utf8"});
  const prior=load("lib/github.ts",source("lib/github.ts"));
  const priorScore=scoreModule(source("components/Analyzer.tsx")).analyzeProfile;
  for(const [name,opts] of [
    ["parity-all",{}],["parity-404",{count:3,missing:["parity-404","repo-1"]}],
    ["parity-no-profile",{count:2,profile:false}],["parity-outside",{count:40,profileLast:true,missing:["parity-outside"]}],
    ["parity-empty",{count:0,profile:false}],["parity-cap",{count:1001,profileLast:true}]
  ]){
    const a=fixture(name,opts), baseline=await prior.analyzeGithubUser(name);
    const b=fixture(name,opts), result=await current.analyzeGithubUser(name);
    assert.deepEqual([...a.calls].sort(),[...b.calls].sort(),name);
    assert.equal(a.peak(),b.peak(),name);
    assert.deepEqual(normalize(result),normalize(baseline),name);
    assert.deepEqual(numericScores(candidateScore(result)),numericScores(priorScore(baseline)),name);
    console.log(JSON.stringify({fixture:name,requests:b.calls.length,score:candidateScore(result).score}));
  }
});

test("rendered dashboard distinguishes unavailable README from missing public profile repository", async () => {
  const react = require("react");
  const {renderToStaticMarkup} = require("react-dom/server");
  function render(data, tab) {
    const states = [data.user.login,data,false,"",true,tab];
    let index = 0;
    const Analyzer = load("components/Analyzer.tsx",undefined,{react:{...react,useState:()=>[states[index++],()=>{}],useMemo:fn=>fn()}}).default;
    return renderToStaticMarkup(react.createElement(Analyzer));
  }
  fixture("render-404",{count:2,missing:["render-404","repo-1"]});
  const unavailable = await current.analyzeGithubUser("render-404");
  for(const tab of ["overview","audit","projects"]){
    const html=render(unavailable,tab);
    assert.match(html,/README evidence and score limitations/);
    assert.match(html,/A 404 cannot establish absence/);
    assert.doesNotMatch(html,/No public profile README repository found/);
    if(tab==="projects"){
      assert.match(html,/README unavailable \(404; absence unconfirmed\)/);
      assert.match(html,/Verify whether unavailable READMEs/);
    }
    if(tab==="overview") assert.match(html,/Profile README evidence is uncertain/);
    if(tab==="audit") assert.match(html,/Profile README unavailable \(404; absence unconfirmed\)/);
  }
  fixture("render-missing",{count:2,profile:false});
  const missing=await current.analyzeGithubUser("render-missing");
  const html=render(missing,"overview");
  assert.match(html,/No public profile README repository found/);
  assert.doesNotMatch(html,/README evidence and score limitations/);
});
