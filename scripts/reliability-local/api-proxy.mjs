import http from 'node:http';
import fs from 'node:fs';
const root=process.env.NIBIE_LOCAL_QA_DIRECTORY;
if(!root)throw new Error('Isolated QA directory required.');
const credentials=JSON.parse(fs.readFileSync(root+'/credentials.json','utf8'));
const server=http.createServer((req,res)=>{
 if(![credentials.publicKey,credentials.serviceKey].includes(req.headers.apikey)&&req.url!='/auth/v1/health'){res.writeHead(401).end();return;}
 const auth=req.url?.startsWith('/auth/v1/'),rest=req.url?.startsWith('/rest/v1/');
 if(!auth&&!rest){res.writeHead(404).end();return;}
 const upstream=http.request({hostname:'127.0.0.1',port:auth?54626:54627,path:req.url.replace(auth?'/auth/v1':'/rest/v1','')||'/',method:req.method,headers:{...req.headers,host:'localhost'}},reply=>{
  res.writeHead(reply.statusCode,reply.headers);reply.pipe(res);
 });
 upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});
 req.pipe(upstream);req.on('aborted',()=>upstream.destroy());
});
server.listen(54621,'127.0.0.1',()=>console.log('Loopback-only local auth/REST gateway ready.'));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
