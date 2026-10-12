import fs from 'node:fs';
import https from 'node:https';
import { randomUUID } from 'node:crypto';
const root=process.env.NIBIE_LOCAL_QA_DIRECTORY;
if(!root)throw new Error('Isolated QA directory required.');
const calls=[];const attempts=new Map();
const server=https.createServer({key:fs.readFileSync(root+'/gateway-key.pem'),cert:fs.readFileSync(root+'/gateway-cert.pem')},async(req,res)=>{
 if(req.url==='/health'){res.writeHead(200).end('local QA gateway');return;}
 if(req.url==='/events'){res.setHeader('content-type','application/json');res.end(JSON.stringify(calls));return;}
 if(req.method!=='POST'||req.url!=='/v1/chat/completions'){res.writeHead(404).end();return;}
 if(req.headers.authorization!=='Bearer nibie-local-qa-only'){res.writeHead(401).end();return;}
 let body='';for await(const chunk of req){body+=chunk;if(body.length>256000){res.writeHead(413).end();return;}}
 let input;try{input=JSON.parse(body);}catch{res.writeHead(400).end();return;}
 const text=input.messages?.filter(m=>m.role==='user').at(-1)?.content??'';
 const match=/qa104:(hold|complete|length|disconnect|provider-error):([a-f0-9-]+)/.exec(text);
 const kind=match?.[1]??'complete';const job=match?.[2]??randomUUID();
 const attempt=(attempts.get(job)??0)+1;attempts.set(job,attempt);
 const call={id:randomUUID(),job,kind,model:input.model,attempt,aborted:false,finished:false};
 calls.push(call);if(calls.length>100)calls.shift();
 if(kind==='provider-error'&&attempt===1){call.finished=true;res.writeHead(503).end('Synthetic gateway failure');return;}
 res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});
 const frame=(data)=>res.write('data: '+JSON.stringify(data)+'\n\n');
 const delta=(content)=>frame({choices:[{delta:{content},finish_reason:null}]});
 let timer;
 res.on('close',()=>{if(!call.finished)call.aborted=true;clearInterval(timer);});
 delta('QA partial '+job+'. ');
 const finish=(reason='stop')=>{
  if(res.destroyed)return;
  delta('QA completed '+job+'.');
  frame({choices:[{delta:{},finish_reason:reason}]});
  frame({choices:[],usage:{prompt_tokens:40,completion_tokens:20,total_tokens:60}});
  call.finished=true;res.write('data: [DONE]\n\n');res.end();
 };
 if(kind==='hold'&&attempt===1){timer=setInterval(()=>delta('kept '),120);return;}
 if(kind==='disconnect'&&attempt===1){setTimeout(()=>res.destroy(),350);return;}
 setTimeout(()=>finish(kind==='length'&&attempt===1?'length':'stop'),450);
});
server.listen(54625,'127.0.0.1',()=>console.log('Loopback-only simulated provider ready; no upstream requests.'));
const stop=()=>server.close(()=>process.exit(0));
process.on('SIGTERM',stop);process.on('SIGINT',stop);
