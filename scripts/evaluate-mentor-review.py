#!/usr/bin/env python3
"""Build transparent mechanical checks and readable reviews from actual run records.
These checks flag evidence for review; they are not a quality/safety score.
"""
import collections,html,json,re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'evaluations/mentor-100'
def payload(call):
 result=call.get('result') or {}
 if result.get('structured_content'):return result['structured_content']
 for item in result.get('content',[]):
  if item.get('type')=='text':
   try:return json.loads(item['text'])
   except ValueError:pass
 return {}
def main():
 cases=json.loads((OUT/'cases.json').read_text());reviews=[];usage=collections.Counter();baseusage=collections.Counter();paired=[]
 for case in cases:
  directory=OUT/'runs'/case['id'];path=directory/'result.json'
  if not path.exists():continue
  actual=json.loads(path.read_text());response=actual['response'];calls=actual['mcpCalls'];recalls=[payload(c) for c in calls if c.get('tool')=='recall' and c.get('status')=='completed'];nodes=[n for r in recalls for n in r.get('results',[])]
  flags=[]
  if actual['exitCode']!=0:flags.append('Host process failed or timed out.')
  if not recalls:flags.append('No successful recall; memory behavior not exercised.')
  if any(c.get('status')!='completed' for c in calls):flags.append('At least one tool call failed; inspect trace.')
  if any(c.get('tool')!='recall' for c in calls):flags.append('Unexpected tool was called.')
  words=len(response.split())
  if words>180:flags.append(f'Response including commentary exceeded the requested 180 words ({words}).')
  if case['fixture'] in ['empty','forgotten','other-profile','candidate','paused'] and nodes:flags.append('Unexpected recalled memory for this fixture.')
  if case['fixture']=='irrelevant' and nodes:flags.append('An unrelated fixture was retrieved; review whether the answer correctly rejects it.')
  if case['fixture'] in ['lesson','generic','corrected','poison'] and not nodes and case['id']!='095':flags.append('Expected relevant fixture was not retrieved; inspect query relevance.')
  if case['fixture']=='paused' and any(r.get('recallStatus')!='paused' for r in recalls):flags.append('Pause was not reflected in recall status.')
  if case['fixture']=='corrected' and any('48 hours' in n.get('content','') for n in nodes):flags.append('Superseded 48-hour rule leaked into recall.')
  hints=[]
  for term in case['reviewTerms']:
   found=re.search(term,response,re.I)
   hints.append(dict(pattern=term,matched=bool(found),excerpt=response[max(0,found.start()-55):found.end()+100] if found else None))
  if not all(x['matched'] for x in hints):flags.append('A lexical review cue was absent; this is not automatically a behavioral failure.')
  returned=[dict(id=n['id'],type=n['type'],content=n['content']) for n in nodes]
  record=dict(id=case['id'],category=case['category'],prompt=case['prompt'],expected=case['expected'],actualRecallStatuses=[r.get('recallStatus') for r in recalls],returnedMemory=returned,responseWordsIncludingCommentary=words,mechanicalFlags=flags,lexicalCues=hints,valueToAssess=case['valueExpected'],assessment='Needs review' if flags else 'Expected mechanics observed; semantic quality still requires review',humanReviewStatus='Not manually reviewed by a human',reviewMethod='Deterministic evidence extraction and lexical cues, supplemented by separately saved agent editorial review. No external human adjudication.',response=response)
  note=OUT/'editorial-notes.json'
  if note.exists():record['agentEditorialReview']=json.loads(note.read_text()).get(case['id'])
  (directory/'review.json').write_text(json.dumps(record,indent=2)+'\n')
  lines=[f"# {case['id']}: {case['category']}", '',case['prompt'],'','## Expected behavior','',case['expected'],'','## Observed evidence','',f"Host exit: {actual['exitCode']}. Recall status: {', '.join(record['actualRecallStatuses']) or 'none'}. Returned memory IDs: {', '.join(str(n['id']) for n in nodes) or 'none'}. Response words including commentary: {words}.",'','## Review','',record['assessment']+'. These are mechanical checks, not a quality score.']
  if flags:lines+=['']+['- '+flag for flag in flags]
  if record.get('agentEditorialReview'):lines+=['','Agent editorial assessment: '+record['agentEditorialReview']]
  lines+=['','## Value to assess','',case['valueExpected'],'','## Actual response','',response,'']
  (directory/'review.md').write_text('\n'.join(line.rstrip() for line in '\n'.join(lines).splitlines())+'\n');reviews.append(record)
  for u in actual['usage']:usage.update(u)
  base=OUT/'baselines'/case['id']/'result.json'
  if base.exists():
   b=json.loads(base.read_text())
   for u in b['usage']:baseusage.update(u)
   paired.append(dict(id=case['id'],prompt=case['prompt'],withGreybeard=response,withoutGreybeard=b['response'],withUsage=actual['usage'],withoutUsage=b['usage'],interpretation='Different context and stochastic runs; any usage delta includes MCP/tool turns and instruction differences. Not a pure recall-token measurement.'))
 summary=dict(distinctPromptsCompleted=len(reviews),successfulHostProcesses=sum(json.loads((OUT/'runs'/r['id']/'result.json').read_text())['exitCode']==0 for r in reviews),withSuccessfulRecall=sum(bool(r['actualRecallStatuses']) for r in reviews),flaggedForReview=sum(bool(r['mechanicalFlags']) for r in reviews),categories=dict(collections.Counter(r['category'] for r in reviews)),usage=dict(usage),baselineCount=len(paired),baselineUsage=dict(baseusage),methodLimitations=['Initial recall is requested by harness, not natural skill discovery.','Synthetic local memories, no model-run live tenant access. Five cases include one supplied anonymized live lab snapshot.','Only recall tool is exposed; no evidence of safe execution of unavailable write tools.','Forced attribution and safety instructions prime the evaluated behavior.','One sample per prompt; no statistical reliability or cross-model claim.','Token counters are CLI aggregate across tool turns, not the memory byte cap or a bill.','Lexical cues are review aids; neither matching nor missing a word proves correctness.'])
 rechecks=[json.loads(p.read_text()) for p in sorted((OUT/'skill-rechecks').glob('*/result.json'))]
 summary['skillRecheckCount']=len(rechecks)
 summary['skillRechecksWithRecall']=sum(any(c.get('status')=='completed' and c.get('tool')=='recall' for c in r['mcpCalls']) for r in rechecks)
 summary['mechanicalFlagCounts']=dict(collections.Counter(flag for r in reviews for flag in r['mechanicalFlags']))
 summary['agentEditorialReviewsSaved']=sum(bool(r.get('agentEditorialReview')) for r in reviews)
 summary['pairedUsage']={
  'withGreybeard':dict(sum((collections.Counter(u) for pair in paired for u in pair['withUsage']),collections.Counter())),
  'withoutGreybeard':dict(sum((collections.Counter(u) for pair in paired for u in pair['withoutUsage']),collections.Counter()))
 }
 (OUT/'summary.json').write_text(json.dumps(summary,indent=2)+'\n');(OUT/'paired-baselines.json').write_text(json.dumps(paired,indent=2)+'\n')
 cards=[]
 for r in reviews:
  flags='; '.join(r['mechanicalFlags']) or 'Expected mechanics observed'
  cards.append(f'<details><summary>{r["id"]} · {html.escape(r["category"])} · {html.escape(r["prompt"])}</summary><p><b>Expected:</b> {html.escape(r["expected"])}</p><p><b>Observed:</b> {html.escape(flags)}</p><p><b>Editorial review:</b> {html.escape(r.get("agentEditorialReview") or "Pending agent editorial review; not human adjudicated.")}</p><p><b>Value:</b> {html.escape(r["valueToAssess"])}</p><pre>{html.escape(r["response"])}</pre><a href="runs/{r["id"]}/review.md">Full saved review</a></details>')
 document='''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Greybeard · 100 prompt review</title><style>body{max-width:1100px;margin:3rem auto;padding:0 1rem;background:#f7f5ed;color:#26352e;font:17px/1.6 system-ui}h1{font:700 42px Georgia}details{background:white;border:1px solid #bdc8bc;border-radius:8px;margin:12px 0;padding:18px}summary{cursor:pointer;font-weight:650}pre{white-space:pre-wrap;font:inherit}a{color:#335f49}input{padding:12px;font:inherit;width:95%;margin:16px 0}small{color:#566455}</style><h1>Greybeard: would an admin miss it?</h1>'''
 for pair in paired:
  cards.append(f'<details><summary>Paired baseline {pair["id"]} · {html.escape(pair["prompt"])}</summary><p>{html.escape(pair["interpretation"])}</p><h3>With Greybeard</h3><pre>{html.escape(pair["withGreybeard"])}</pre><h3>Without Greybeard</h3><pre>{html.escape(pair["withoutGreybeard"])}</pre><p>Usage with: {html.escape(json.dumps(pair["withUsage"]))}</p><p>Usage without: {html.escape(json.dumps(pair["withoutUsage"]))}</p></details>')
 document+=f'<p>{len(reviews)} distinct actual Codex conversations · {len(paired)} paired baselines · Synthetic memory fixtures with real MCP calls.</p><p>This is a controlled integration evaluation. Recall is explicitly requested. It does not establish natural discovery, autonomous background mentoring, live tenant correctness, or a 100% quality pass rate.</p><input aria-label="Filter reviews" id="filter" placeholder="Filter by prompt, category, or finding"><main>'+''.join(cards)+'</main><script>document.getElementById("filter").addEventListener("input",e=>{for(const d of document.querySelectorAll("details"))d.hidden=!d.textContent.toLowerCase().includes(e.target.value.toLowerCase())})</script></html>'
 (OUT/'review.html').write_text('\n'.join(line.rstrip() for line in document.splitlines())+'\n')
 print(json.dumps(summary,indent=2))
if __name__=='__main__':main()
