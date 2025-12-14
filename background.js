// Background service worker for 2048 game extension

// Handle extension icon click - open game in new tab
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({
    url: chrome.runtime.getURL('game.html')
  });
});

// Initialize storage on installation
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['gameState', 'bestScore', 'history'], (result) => {
    if (!result.gameState) {
      chrome.storage.local.set({
        gameState: null,
        bestScore: 0,
        history: []
      });
    }
  });
});
