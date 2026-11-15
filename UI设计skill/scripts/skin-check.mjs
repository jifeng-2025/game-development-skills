/**
 * 实机页面检查：在 Playwright / `project play` 脚本里调用。
 *   import { skinCheck, watchFsRequests } from './skin-check.mjs';
 *   const fs = watchFsRequests(page);          // page.goto 之前调用
 *   const report = await skinCheck(page);      // 标题和首场战斗各调一次
 * 通过条件：report.failed 为空、report.fsRequests === 0、fs.responses 为空。
 * 要求皮肤写成 :root 上的 CSS 变量，prefix 默认 --skin-。
 */
export const skinCheck = (page, prefix = '--skin-') => page.evaluate(async (varPrefix) => {
  const style = getComputedStyle(document.documentElement);
  const names = [...document.styleSheets].flatMap((sheet) => { try { return [...sheet.cssRules]; } catch { return []; } })
    .flatMap((rule) => (rule.style ? [...rule.style] : [])).filter((name) => name.startsWith(varPrefix));
  const unique = [...new Set(names)];
  const results = await Promise.all(unique.map(async (name) => {
    const url = /url\("?(data:[^")]+)"?\)/.exec(style.getPropertyValue(name))?.[1];
    if (!url) return { name, ok: false };
    const image = new Image();
    image.src = url;
    try { await image.decode(); return { name, ok: image.naturalWidth > 0 }; } catch { return { name, ok: false }; }
  }));
  const fsRequests = performance.getEntriesByType('resource').filter((entry) => entry.name.includes('/@fs/')).length;
  return { count: results.length, failed: results.filter((r) => !r.ok).map((r) => r.name), fsRequests };
}, prefix);

export function watchFsRequests(page) {
  const record = { responses: [] };
  page.on('response', (r) => { if (r.url().includes('/@fs/')) record.responses.push(`${r.status()} ${r.url()}`); });
  return record;
}
