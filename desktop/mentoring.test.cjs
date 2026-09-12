const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMentorNotifications } = require('./mentoring.cjs');
test('notifies only for new useful advice, suppresses backlog/duplicates and honors pause', async () => {
  let data = { recent: [{ id:1,status:'companion',reminders:['old'] }] }, now=100000; const messages=[];
  const notifier=createMentorNotifications({request:async()=>data,supported:()=>true,notify:message=>messages.push(message),now:()=>now});
  await notifier.poll(); assert.equal(messages.length,0);
  data={recent:[{id:2,status:'companion',memories:[{content:'Private remembered rule'}]}]}; await notifier.poll();assert.equal(messages.length,1);assert.doesNotMatch(messages[0],/Private/);
  await notifier.poll();assert.equal(messages.length,1);
  now+=31000;data={paused:true,recent:[{id:3,status:'companion',reminders:['must not show']}]};await notifier.poll();assert.equal(messages.length,1);
  data={recent:[{id:4,candidateId:12}]};await notifier.poll();assert.equal(messages.length,2);
});
