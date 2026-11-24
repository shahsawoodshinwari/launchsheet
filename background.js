// Launchsheet only works on App Store Connect, so the toolbar button and the side panel
// are enabled for that site's tabs only. Everywhere else they stay switched off.
const ASC_ORIGIN = 'https://appstoreconnect.apple.com';
const PANEL_PATH = 'panel/panel.html';

const isAsc = (url) => {
  try { return !!url && new URL(url).origin === ASC_ORIGIN; } catch { return false; }
};

async function setup() {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  await chrome.sidePanel.setOptions({ enabled: false }); // off by default for every tab
  await chrome.action.disable(); // greyed out by default
  await chrome.action.setTitle({ title: 'Launchsheet (open App Store Connect to use it)' });

  const tabs = await chrome.tabs.query({ url: `${ASC_ORIGIN}/*` });
  for (const tab of tabs) await applyToTab(tab.id, tab.url);
}

async function applyToTab(tabId, url) {
  const ok = isAsc(url);
  await chrome.sidePanel.setOptions({ tabId, path: PANEL_PATH, enabled: ok });
  if (ok) {
    await chrome.action.enable(tabId);
    await chrome.action.setTitle({ tabId, title: 'Launchsheet' });
  } else {
    await chrome.action.disable(tabId);
  }
}

chrome.runtime.onInstalled.addListener(() => setup().catch(console.error));
chrome.runtime.onStartup.addListener(() => setup().catch(console.error));

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.url || info.status === 'complete') applyToTab(tabId, tab.url).catch(() => {});
});
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (tab) applyToTab(tabId, tab.url).catch(() => {});
});
