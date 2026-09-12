// Native notifications contain no prompt or memory text. The companion shows
// current advice after opening, respecting later forgetting and pause changes.
function createMentorNotifications({ request, supported, notify, now = Date.now }) {
  let latest = null, lastNotification = 0, busy = false, timer, memoryBinding;
  async function poll() {
    if (busy) return;
    busy = true;
    try {
      const data = await request('/mentoring');
      const binding = data.memoryBinding ?? 'local';
      if (binding !== memoryBinding) { latest = null; memoryBinding = binding; }
      const events = Array.isArray(data.recent) ? data.recent : [];
      const newest = Math.max(0, ...events.map(event => event.id));
      const fresh = latest === null ? [] : events.filter(event => event.id > latest);
      latest = newest;
      if (data.paused || !supported() || now() - lastNotification < 30_000) return;
      const advice = fresh.find(event => event.status === 'companion' && (event.reminders?.length || event.memories?.length));
      const proposal = fresh.find(event => event.candidateId);
      if (!advice && !proposal) return;
      lastNotification = now();
      notify(advice ? 'Greybeard has advice for your current task.' : 'Greybeard proposed a lesson for your review.');
    } catch { /* The service's existing exit handler reports persistent failure. */ }
    finally { busy = false; }
  }
  return { poll, start() { void poll(); timer = setInterval(() => void poll(), 2000); timer.unref?.(); }, stop() { clearInterval(timer); } };
}
module.exports = { createMentorNotifications };
