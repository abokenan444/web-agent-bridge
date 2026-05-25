const $ = (id) => document.getElementById(id);
chrome.storage.sync.get({ autoTrack: true }, (cfg) => { $('autoTrack').checked = !!cfg.autoTrack; });
$('autoTrack').addEventListener('change', (e) => {
  chrome.storage.sync.set({ autoTrack: !!e.target.checked });
});
