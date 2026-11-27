const {test}=require("node:test");
const assert=require("node:assert/strict");
const {spawn}=require("node:child_process");
const {once}=require("node:events");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const net=require("node:net");
const http=require("node:http");
const root=path.resolve(__dirname,"..");

async function unusedPort(){
  const server=net.createServer();
  server.listen(0,"127.0.0.1");
  await once(server,"listening");
  const {port}=server.address();
  await new Promise(resolve=>server.close(resolve));
  return port;
}
function get(port,query){
  return new Promise((resolve,reject)=>{
    const req=http.get({hostname:"127.0.0.1",port,path:"/api/analyze?username="+encodeURIComponent(query),timeout:3000},res=>{
      let body="";
      res.setEncoding("utf8");
      res.on("data",chunk=>body+=chunk);
      res.on("end",()=>{
        try{resolve({status:res.statusCode,headers:res.headers,body:JSON.parse(body)});}
        catch(error){reject(error);}
      });
      res.on("error",reject);
    });
    req.on("timeout",()=>req.destroy(new Error("HTTP timeout")));
    req.on("error",reject);
  });
}

test("compiled Next.js HTTP route: validation, failure handling, cache, no stale score", {timeout:30000}, async ()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"gitscope-smoke-"));
  const calls=path.join(dir,"calls.txt");
  fs.writeFileSync(calls,"");
  const port=await unusedPort();
  const env={PATH:process.env.PATH,HOME:dir,TMPDIR:dir,NODE_ENV:"production",NEXT_TELEMETRY_DISABLED:"1",
    NODE_OPTIONS:"--require="+path.join(__dirname,"mock-github.cjs"),GITSCOPE_TEST_CALLS:calls};
  const child=spawn(process.execPath,[path.join(root,"node_modules/next/dist/bin/next"),"start","--hostname","127.0.0.1","--port",String(port)],{cwd:root,env});
  let output="";
  child.stdout.on("data",b=>output+=b);
  child.stderr.on("data",b=>output+=b);
  const exited=once(child,"exit");
  const count=()=>fs.readFileSync(calls,"utf8").trim().split("\n").filter(Boolean).length;
  try{
    let ready=false;
    for(let i=0;i<100;i++){
      if(child.exitCode!==null)throw new Error(output);
      try{if((await get(port,"")).status===400){ready=true;break;}}catch{}
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.ok(ready,output);
    assert.equal(count(),0);
    const [a,b]=await Promise.all([get(port,"normal"),get(port,"NORMAL")]);
    assert.equal(a.status,200);
    assert.equal(b.status,200);
    assert.equal(a.headers["cache-control"],"no-store");
    assert.deepEqual(a.body,b.body);
    assert.equal(a.body.stats.readmeCount,1);
    assert.equal(count(),5);
    assert.deepEqual((await get(port,"normal")).body,a.body);
    assert.equal(count(),5);
    const missing=await get(port,"missing");
    assert.equal(missing.status,200);
    assert.equal(missing.body.evidence[0].readme.status,"unavailable");
    assert.equal(missing.body.stats.profileReadmeStatus,"unavailable");
    const notFound=await get(port,"unknown");
    assert.equal(notFound.status,404);
    for(const [name,expected] of [["partial",502],["malformed",502]]){
      const res=await get(port,name);
      assert.equal(res.status,expected);
      assert.match(res.body.error,/No score was calculated/);
      assert.equal(res.headers["cache-control"],"no-store");
      assert.equal(Object.hasOwn(res.body,"stats"),false);
    }
    const before=count();
    assert.equal((await get(port,"partial")).status,502);
    assert.ok(count()>before,"failure must not be cached");
    assert.equal((await get(port,"normal")).status,200);
    const limited=await get(port,"limited");
    assert.equal(limited.status,429);
    assert.equal(limited.headers["retry-after"],"60");
    const blocked=count();
    assert.equal((await get(port,"unseen")).status,429);
    assert.equal(count(),blocked);
    assert.equal((await get(port,"normal")).status,200);
    assert.equal(count(),blocked);
    console.log("HTTP smoke: real production route, mocked GitHub, no live audit traffic");
  }finally{
    if(child.exitCode===null)child.kill("SIGTERM");
    await exited;
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
