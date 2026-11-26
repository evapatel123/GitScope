// Preloaded only by the local HTTP smoke test. No real network requests.
const fs = require("node:fs");
const date = "2026-11-01T00:00:00Z";
global.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (url.origin !== "https://api.github.com") throw new Error("Unexpected external fetch in smoke test");
  if (new Headers(init?.headers).has("authorization")) throw new Error("Unexpected authorization in smoke test");
  fs.appendFileSync(process.env.GITSCOPE_TEST_CALLS, url.pathname + url.search + "\n");
  const json = (data,status=200,headers={}) => new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json",...headers}});
  const parts = url.pathname.split("/");
  const username = parts[2].toLowerCase();
  if (parts[1] === "users" && parts.length === 3) {
    if (username === "unknown") return json({},404);
    if (username === "limited") return json({},403,{"x-ratelimit-remaining":"0"});
    if (username === "malformed") return json({});
    return json({login:username,id:101,avatar_url:"https://example.org/avatar",html_url:"https://github.com/"+username,
      name:"Synthetic User",bio:null,company:null,location:null,blog:null,twitter_username:null,
      public_repos:1,public_gists:0,followers:0,following:0,created_at:date,updated_at:date});
  }
  if (url.pathname.endsWith("/repos")) return json([{id:1,name:username,full_name:username+"/"+username,
    html_url:"https://github.com/"+username+"/"+username,description:"Synthetic public repo",stargazers_count:0,
    watchers_count:0,forks_count:0,language:"Python",size:10,created_at:date,updated_at:date,pushed_at:date,
    fork:false,archived:false,disabled:false,topics:[],license:null,homepage:null,default_branch:"main",
    has_issues:true,has_wiki:false,has_pages:false,open_issues_count:0}]);
  if (url.pathname.endsWith("/events/public")) return json([]);
  if (url.pathname.endsWith("/readme")) {
    if (username === "partial") return json({},503);
    if (username === "missing") return json({},404);
    return json({content:Buffer.from("# Documentation").toString("base64"),encoding:"base64"});
  }
  if (url.pathname.endsWith("/languages")) return json({Python:100});
  throw new Error("Unexpected fixture path");
};
