/**
 * Content Script — 页面注入脚本
 *
 * 职责:
 *   1. 选中文本时通知侧边栏
 *   2. 提供快捷键快速打开侧边栏
 */

// 监听来自 background 的消息
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'get-selection') {
    return Promise.resolve({ text: window.getSelection()?.toString() || '' });
  }
  return false;
});
