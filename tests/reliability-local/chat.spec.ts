import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { test, expect, type Page } from "@playwright/test";

const directory=process.env.NIBIE_LOCAL_QA_DIRECTORY!;
const credentials=JSON.parse(fs.readFileSync(path.join(directory,"credentials.json"),"utf8")) as {
 api:string;db:string;publicKey:string;serviceKey:string;email:string;password:string;userId:string;
};
const sql=postgres(credentials.db,{max:1});
test.afterAll(async()=>{await sql.end();});
async function login(page:Page) {
 await page.goto("/login");
 await page.getByLabel("Email",{exact:true}).fill(credentials.email);
 await page.getByLabel("Password",{exact:true}).fill(credentials.password);
 await page.getByRole("button",{name:"Sign in",exact:true}).click();
 await expect(page).toHaveURL(u=>u.pathname==="/chat",{timeout:20000});
}
async function fresh(page:Page,mode:"Fast"|"Balanced"|"High"="Fast") {
 await page.getByRole("button",{name:"New chat",exact:true}).first().click();
 await expect(page.getByTestId("welcome-greeting")).toBeVisible();
 const picker=page.getByRole("button",{name:/^Model:/});
 await picker.click();await page.getByRole("menuitemradio",{name:new RegExp("^"+mode)}).click();
 await expect(picker).toBeEnabled();
}
async function rows(page:Page) {
 const id=new URL(page.url()).searchParams.get("conversation");
 return sql`select id,role,content,status,position from public.messages where conversation_id=${id} order by position`;
}
async function credits() {
 const result=await sql`select coalesce(sum(credits_used),0)::int as credits from public.weekly_ai_usage where user_id=${credentials.userId}`;
 return result[0].credits as number;
}
test("authenticated completion persists without network/persistence mocks",async({page})=>{
 await login(page);await fresh(page);
 const job=randomUUID();
 await page.getByRole("textbox",{name:"Message Nibie"}).fill("qa104:complete:"+job);
 await page.getByRole("button",{name:"Send message",exact:true}).click();
 await expect(page.getByRole("button",{name:"Regenerate",exact:true})).toBeEnabled({timeout:20000});
 const reply=page.locator(".message-row.assistant .markdown");
 await expect(reply).toContainText("QA completed "+job);
 await expect.poll(async()=>(await rows(page)).map(r=>r.status)).toEqual(["complete","complete"]);
 const before=await reply.textContent();await page.reload();
 await expect(reply).toHaveText(before!);
 expect((await rows(page)).filter(r=>r.role==="user")).toHaveLength(1);
 expect((await rows(page)).filter(r=>r.role==="assistant")).toHaveLength(1);
 const conversation=new URL(page.url()).searchParams.get("conversation");
 const anonymous=await fetch(credentials.api+"/rest/v1/messages?select=id&conversation_id=eq."+conversation,{
  headers:{apikey:credentials.publicKey,authorization:"Bearer "+credentials.publicKey},
 });
 expect(anonymous.status).toBe(200);
 expect(await anonymous.json()).toEqual([]);
});

for (const mode of ["Fast","Balanced","High"] as const) {
 for (const width of [1440,390]) {
  test(mode+" at "+width+"px: authenticated Stop persists partial, cancels transport and permits Retry",async({page})=>{
   await page.setViewportSize({width,height:900});await login(page);await fresh(page,mode);
   const beforeCredits=await credits();
   const job=randomUUID();
   await page.getByRole("textbox",{name:"Message Nibie"}).fill("qa104:hold:"+job);
   await page.getByRole("button",{name:"Send message",exact:true}).click();
   const reply=page.locator(".message-row.assistant .markdown");
   await expect(reply).toContainText("QA partial "+job,{timeout:20000});
   const acknowledgement=page.waitForResponse(response=>
    new URL(response.url()).pathname==="/api/chat/stop"&&response.request().method()==="POST");
   await page.getByRole("button",{name:"Stop response",exact:true}).click();
   await expect(page.getByRole("button",{name:"Retry",exact:true})).toBeEnabled();
   const acknowledged=await acknowledgement;
   expect(acknowledged.status()).toBe(200);
   const visibleAtStop=acknowledged.request().postDataJSON().content as string;
   await expect.poll(async()=>(await rows(page)).map(r=>r.status)).toEqual(["complete","interrupted"]);
   const saved=(await rows(page))[1].content;
   expect(saved).toBe(visibleAtStop);
   if(mode==="Fast"&&width===1440) {
    const stopped=await rows(page);
    const repeated=await page.request.post("/api/chat/stop",{data:{
     conversationId:new URL(page.url()).searchParams.get("conversation"),
     userMessageId:stopped[0].id,assistantId:stopped[1].id,content:saved,
    }});
    expect(repeated.status()).toBe(200);
    expect((await rows(page)).map(r=>({id:r.id,content:r.content,status:r.status})))
     .toEqual(stopped.map(r=>({id:r.id,content:r.content,status:r.status})));
   }
   await expect.poll(async()=>{
    const events=await (await fetch("https://localhost:54625/events")).json() as {job:string;attempt:number;aborted:boolean}[];
    return events.find(e=>e.job===job&&e.attempt===1)?.aborted;
   }).toBe(true);
   await page.reload();
   await expect(reply).toHaveText(saved);
   await expect(page.locator(".message-row.assistant")).toContainText("Stopped");
   await page.getByRole("button",{name:"Retry",exact:true}).click();
   await expect(page.getByRole("button",{name:"Regenerate",exact:true})).toBeEnabled({timeout:20000});
   await expect(reply).toContainText("QA completed "+job);
   await expect(page.locator(".local-notice")).toHaveCount(0);
   await expect.poll(async()=>(await rows(page)).map(r=>r.status)).toEqual(["complete","complete"]);
   expect((await rows(page)).filter(r=>r.role==="user")).toHaveLength(1);
   expect((await rows(page)).filter(r=>r.role==="assistant")).toHaveLength(1);
   const cost={Fast:1,Balanced:3,High:6}[mode];
   await expect.poll(credits).toBe(beforeCredits+cost*2);
  });
 }
}
for(const width of [1440,390]) {
 test("authenticated native navigation to empty chat at "+width+"px releases the previous generation",async({page})=>{
  await page.setViewportSize({width,height:900});await login(page);await fresh(page);
  const oldJob=randomUUID(),newJob=randomUUID();
  await page.getByRole("textbox",{name:"Message Nibie"}).fill("qa104:hold:"+oldJob);
  await page.getByRole("button",{name:"Send message",exact:true}).click();
  await expect(page.locator(".message-row.assistant .markdown")).toContainText("QA partial "+oldJob);
  const oldConversation=new URL(page.url()).searchParams.get("conversation");
  await page.evaluate(()=>{const url=new URL(location.href);url.searchParams.delete("conversation");history.pushState(null,"",url);});
  await expect(page.getByTestId("welcome-greeting")).toBeVisible();
  await expect(page.getByRole("button",{name:"Stop response",exact:true})).toHaveCount(0);
  await page.getByRole("textbox",{name:"Message Nibie"}).fill("qa104:complete:"+newJob);
  await expect(page.getByRole("button",{name:"Send message",exact:true})).toBeEnabled();
  await page.getByRole("button",{name:"Send message",exact:true}).click();
  await expect(page.getByRole("button",{name:"Regenerate",exact:true})).toBeEnabled();
  await expect(page.locator(".message-row.assistant .markdown")).toContainText("QA completed "+newJob);
  await expect(page.locator(".message-row.assistant .markdown")).not.toContainText(oldJob);
  await expect.poll(async()=>{
   const result=await sql`select status from public.messages where conversation_id=${oldConversation} and role='assistant'`;
   return result[0]?.status;
  }).toBe("interrupted");
 });
}
test("authenticated second tab observes Stop and retries the persisted turn without duplicate generations",async({page,context})=>{
 await login(page);await fresh(page);
 const job=randomUUID();
 await page.getByRole("textbox",{name:"Message Nibie"}).fill("qa104:hold:"+job);
 await page.getByRole("button",{name:"Send message",exact:true}).click();
 await expect(page.locator(".message-row.assistant .markdown")).toContainText("QA partial "+job);
 const other=await context.newPage();await other.goto(page.url());
 await expect(other.getByRole("button",{name:"Stop response",exact:true})).toHaveCount(0);
 await page.getByRole("button",{name:"Stop response",exact:true}).click();
 await expect(other.getByRole("button",{name:"Retry",exact:true})).toBeEnabled();
 await expect(other.locator(".message-row.assistant")).toContainText("Stopped");
 await other.getByRole("button",{name:"Retry",exact:true}).click();
 await expect(other.getByRole("button",{name:"Regenerate",exact:true})).toBeEnabled();
 await expect(other.locator(".message-row.assistant .markdown")).toContainText("QA completed "+job);
 await page.reload();
 await expect(page.locator(".message-row.assistant .markdown")).toContainText("QA completed "+job);
 expect((await rows(page)).map(r=>r.status)).toEqual(["complete","complete"]);
 const events=await (await fetch("https://localhost:54625/events")).json() as {job:string}[];
 expect(events.filter(event=>event.job===job)).toHaveLength(2);
});
test("authenticated immediate Retry after Stop settles before a consecutive Send",async({page})=>{
 await login(page);await fresh(page);
 const job=randomUUID();
 await page.getByRole("textbox",{name:"Message Nibie"}).fill("qa104:hold:"+job);
 await page.getByRole("button",{name:"Send message",exact:true}).click();
 await expect(page.locator(".message-row.assistant .markdown")).toContainText("QA partial "+job);
 await page.getByRole("button",{name:"Stop response",exact:true}).click();
 await page.getByRole("button",{name:"Retry",exact:true}).click();
 await expect(page.getByRole("button",{name:"Regenerate",exact:true})).toBeEnabled();
 await expect(page.locator(".local-notice")).toHaveCount(0);
 await page.getByRole("textbox",{name:"Message Nibie"}).fill("qa104:complete:"+randomUUID());
 await page.getByRole("button",{name:"Send message",exact:true}).click();
 await expect(page.getByRole("button",{name:"Regenerate",exact:true})).toBeEnabled();
 await expect.poll(async()=>(await rows(page)).map(r=>r.status)).toEqual(["complete","complete","complete","complete"]);
});
for (const failure of ["length","disconnect","provider-error"] as const) {
 test("authenticated "+failure+" persists honest failure and Retry replaces only its reply",async({page})=>{
  await login(page);await fresh(page);
  const job=randomUUID();
  await page.getByRole("textbox",{name:"Message Nibie"}).fill("qa104:"+failure+":"+job);
  await page.getByRole("button",{name:"Send message",exact:true}).click();
  await expect(page.getByRole("button",{name:"Retry",exact:true})).toBeEnabled({timeout:20000});
  await expect.poll(async()=>(await rows(page))[1]?.status).toBe("error");
  await page.reload();
  await expect(page.getByRole("button",{name:"Retry",exact:true})).toBeEnabled();
  await page.getByRole("button",{name:"Retry",exact:true}).click();
  await expect(page.getByRole("button",{name:"Regenerate",exact:true})).toBeEnabled({timeout:20000});
  await expect(page.locator(".message-row.assistant .markdown")).toContainText("QA completed "+job);
  expect((await rows(page)).map(r=>r.status)).toEqual(["complete","complete"]);
 });
}
