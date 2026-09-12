import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MemoryService, memoryDbPath, createGreybeardMemoryMcpServer, type RememberInput } from "./public.js";

const now=Date.UTC(2026,8,11);
async function fixture() {
  const appDataPath=await mkdtemp(join(tmpdir(),"greybeard-mentor-"));
  return {appDataPath,service:new MemoryService({appDataPath,tenantId:"lab",profileId:"work",now:()=>now})};
}
async function confirmed(service:MemoryService,input:RememberInput) {
  const result=await service.remember(input);
  const node=(await service.list()).results.find(node=>node.id===result.id)!;
  await service.confirm({id:node.id,expectedRevision:node.revision});
  return result;
}

describe("mentor experience",()=>{
  it("migrates schema 3 without inventing observation dates or losing confirmations",async()=>{
    const {service,appDataPath}=await fixture();
    const record=await confirmed(service,{type:"fact",content:"Windows inventory observation"});
    const original=(await service.list()).results[0]!;
    service.close();
    const db=new Database(memoryDbPath(appDataPath));
    db.exec("ALTER TABLE nodes DROP COLUMN evidence_kind; ALTER TABLE nodes DROP COLUMN observed_at; ALTER TABLE nodes DROP COLUMN outcome; DROP TABLE advice_events; PRAGMA user_version=3;");
    db.close();
    const migrated=new MemoryService({appDataPath,tenantId:"lab",profileId:"work",now:()=>now});
    try {
      expect((await migrated.list()).results[0]).toMatchObject({id:record.id,revision:original.revision,status:"confirmed",evidenceKind:"observation",observedAt:null});
      expect((await migrated.recall({query:"Windows inventory"})).results[0]).toMatchObject({verificationRequired:true,evidenceAgeSeconds:null});
      expect((await migrated.adviceMetrics()).guidanceRecalls).toBe(1);
    } finally {migrated.close();}
  });

  it("retrieves bounded vocabulary paraphrases and suppresses generic mentoring instructions",async()=>{
    const {service}=await fixture();
    try {
      const generic=await confirmed(service,{type:"preference",content:"During Microsoft 365, Intune, and Entra admin tasks, proactively provide relevant recommendations informed by confirmed Greybeard memories."});
      const rule=await confirmed(service,{type:"decision",content:"Compliance pilot needs helpdesk review before rollout."});
      const result=await service.recall({query:"Assess a compliant endpoint deployment ring with support"});
      expect(result.results.map(n=>n.id)).toContain(rule.id);
      expect(result.results.map(n=>n.id)).not.toContain(generic.id);
      expect((await service.recall({query:"Intune compliance Windows devices change"})).results.map(n=>n.id)).not.toContain(generic.id);
      expect((await service.recall({query:"orchid watering schedule"})).results).toEqual([]);
      expect((await service.recall({query:"mentor advice preferences"})).results.map(n=>n.id)).not.toContain(rule.id);
    } finally {service.close();}
  });

  it("preserves dated observations and inferred reasons across recall without upgrading their truth",async()=>{
    const {service}=await fixture();
    try {
      const observedAt=now/1000-180*86400;
      const fact=await confirmed(service,{type:"fact",content:"Windows device inventory was stale.",observedAt,source:"admin-reviewed-snapshot"});
      const record=(await service.recall({query:"Windows device inventory"})).results.find(n=>n.id===fact.id)!;
      expect(record).toMatchObject({observedAt,evidenceKind:"observation",verificationRequired:true,evidenceAgeSeconds:180*86400});
      expect((await service.list()).results[0]?.observedAt).toBe(observedAt);
      const inferred=await confirmed(service,{type:"decision",content:"Stale inventory may explain missing device evaluations.",evidenceKind:"inference"});
      expect((await service.recall({query:"missing device evaluations"})).results.find(n=>n.id===inferred.id)).toMatchObject({evidenceKind:"inference",verificationRequired:true,observedAt:null});
      await expect(service.remember({type:"fact",content:"Device observation",observedAt:now/1000+1})).rejects.toMatchObject({code:"invalid-input"});
    } finally {service.close();}
  });

  it("discovers scopes through MCP without applying them or leaking another profile",async()=>{
    const {service,appDataPath}=await fixture();
    const other=new MemoryService({appDataPath,tenantId:"lab",profileId:"personal",now:()=>now});
    const server=createGreybeardMemoryMcpServer(service);
    const client=new Client({name:"scope-discovery",version:"0.1"});
    const [host,transport]=InMemoryTransport.createLinkedPair();
    try {
      await confirmed(service,{type:"decision",content:"Windows compliance pilot requires helpdesk review.",scope:"devices"});
      await confirmed(service,{type:"decision",content:"Accounting exception must be reviewed.",scope:"finance"});
      await service.remember({type:"decision",content:"Secret unconfirmed scope",scope:"candidate-only"});
      await confirmed(other,{type:"decision",content:"Private device rule",scope:"personal-private"});
      await server.connect(transport);await client.connect(host);
      const result=await client.callTool({name:"discover_scopes",arguments:{limit:1}});
      expect(result.structuredContent).toMatchObject({scopes:[{scope:"devices",confirmedCount:1}],nextCursor:"devices"});
      expect((await service.discoverScopes({cursor:"devices",limit:1})).scopes.map(s=>s.scope)).toEqual(["finance"]);
      expect((await service.discoverScopes({query:"Plan a compliant endpoint deployment ring"})).scopes.map(s=>s.scope)).toEqual(["devices"]);
      expect((await service.recall({query:"Windows compliance pilot"})).results).toHaveLength(0);
      expect((await service.recall({query:"Windows compliance pilot",scope:"devices"})).results).toHaveLength(1);
      await writeFile(join(appDataPath,"config.json"),JSON.stringify({learningEnabled:false}));
      expect(await service.discoverScopes()).toMatchObject({scopes:[],paused:true});
    } finally {await client.close();await server.close();service.close();other.close();}
  });

  it("proposes outcome lessons through MCP and requires exact local review before later recall",async()=>{
    const {service}=await fixture();
    const server=createGreybeardMemoryMcpServer(service);
    const client=new Client({name:"outcome-learning",version:"0.1"});
    const [host,transport]=InMemoryTransport.createLinkedPair();
    try {
      await server.connect(transport);await client.connect(host);
      const result=await client.callTool({name:"propose_outcome",arguments:{lesson:"Compliance pilot needs 72 hours of observation.",outcome:"Late device evaluations arrived after 48 hours.",source:"admin-reported-outcome",observedAt:now/1000,status:"confirmed"}});
      expect(result.structuredContent).toMatchObject({status:"candidate"});
      expect((await service.recall({query:"Compliance pilot"})).results).toHaveLength(0);
      const node=(await service.list()).results[0]!;
      expect(node.outcome).toBe("Late device evaluations arrived after 48 hours.");
      await service.confirm({id:node.id,expectedRevision:node.revision,confirmationChannel:"local-ui"});
      expect((await service.recall({query:"Compliance pilot"})).results[0]?.content).toContain("72 hours");
      expect((await client.listTools()).tools.some(t=>/confirm|feedback/u.test(t.name))).toBe(false);
      await expect(service.proposeOutcome({lesson:"Store a lesson",outcome:"client_secret=forbidden",source:"admin"})).rejects.toMatchObject({code:"privacy-rejected"});
    } finally {await client.close();await server.close();service.close();}
  });

  it("records bounded local retrieval bytes and explicit editable feedback without billing or cross-profile access",async()=>{
    const {service,appDataPath}=await fixture();
    const other=new MemoryService({appDataPath,tenantId:"other",profileId:"work"});
    try {
      await confirmed(service,{type:"preference",content:"Review compliance pilots with the helpdesk."});
      const recall=await service.recall({query:"compliance pilots"});
      await service.recordAdviceFeedback({recallId:recall.recallId!,feedback:"irrelevant"});
      expect(await service.adviceMetrics()).toMatchObject({recalls:1,guidanceRecalls:1,irrelevant:1,irrelevantRate:1,billing:"not-measured",recalledBytes:recall.serializedBytes});
      await expect(other.recordAdviceFeedback({recallId:recall.recallId!,feedback:"accepted"})).rejects.toMatchObject({code:"invalid-input"});
      await service.recordAdviceFeedback({recallId:recall.recallId!,feedback:"accepted"});
      expect(await service.adviceMetrics()).toMatchObject({rated:1,accepted:1,irrelevant:0});
      expect((await service.adviceHistory())[0]).toMatchObject({recallId:recall.recallId,feedback:"accepted",memories:[{content:"Review compliance pilots with the helpdesk."}]});
      await service.forget({id:recall.results[0]!.id});
      await confirmed(service,{type:"preference",content:"A completely different rule under a reused ID."});
      expect((await service.adviceHistory())[0]?.memories[0]?.content).toBeNull();
      await service.recall({query:"unrelated orchids"});
      expect(await service.adviceMetrics()).toMatchObject({recalls:2,guidanceRecalls:1});
      await writeFile(join(appDataPath,"config.json"),JSON.stringify({learningEnabled:false}));
      expect((await service.recall({query:"compliance"})).recallId).toBeUndefined();
      expect((await service.adviceMetrics()).recalls).toBe(2);
      await service.clearAdviceMetrics();
      expect(await service.adviceMetrics()).toMatchObject({recalls:0,rated:0,irrelevantRate:null});
    } finally {service.close();other.close();}
  });

  it("filters large local collections before pagination while preserving exact scope and status",async()=>{
    const {service}=await fixture();
    try {
      for (let i=0;i<55;i++) await service.remember({type:"fact",content:`Compliance observation ${i}`,scope:"devices"});
      await service.remember({type:"fact",content:"Compliance observation outside",scope:"global"});
      const first=await service.list({query:"Compliance",scope:"devices",status:"candidate",limit:50});
      const second=await service.list({query:"Compliance",scope:"devices",status:"candidate",limit:50,cursor:first.nextCursor});
      expect(first.results.length+second.results.length).toBe(55);
      expect((await service.list({query:"observation outside",scope:"devices"})).results).toEqual([]);
      expect((await service.list({query:"Compliance",status:"confirmed"})).results).toEqual([]);
    } finally {service.close();}
  });
});
