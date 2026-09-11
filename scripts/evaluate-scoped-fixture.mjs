import { MemoryService } from '../memory/dist/service.js';
const [appDataPath, scope = 'devices'] = process.argv.slice(2);
if (!appDataPath?.startsWith('/tmp/greybeard-evaluation-')) throw Error('Use an isolated evaluation path.');
const service = new MemoryService({appDataPath, tenantId:'synthetic-lab', profileId:'profile-a'});
const item = await service.remember({content: 'For Windows compliance rollouts, keep the pilot for 48 hours and require helpdesk review before expanding.',type:'decision',source:'evaluation-fixture',scope});
const node=(await service.list()).results.find(x=>x.id===item.id);
await service.confirm({id:item.id,expectedRevision:node.revision});
service.close();
