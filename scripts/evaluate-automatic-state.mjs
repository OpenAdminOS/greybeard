import { AutomaticMentorStore, MemoryService } from '../memory/dist/public.js';
const [appDataPath] = process.argv.slice(2);
if (!appDataPath?.startsWith('/tmp/greybeard-evaluation-')) throw Error('Isolated fixture required.');
const store = new AutomaticMentorStore(appDataPath,'profile-a','synthetic-lab');
const service = new MemoryService({appDataPath,profileId:'profile-a',tenantId:'synthetic-lab',db:store.db});
console.log(JSON.stringify({activity:store.summary(),memories:(await service.export()).nodes}));
service.close(); store.close();
