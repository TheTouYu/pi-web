// 轻量代码高亮：直接使用 refractor（react-syntax-highlighter 的底层引擎），
// 跳过 react-syntax-highlighter 的 React 元素树包装和行号 DOM，并把结果缓存。
// 实测（220 个代码块）：react-syntax-highlighter + 行号 ≈ 760ms，本模块 ≈ 100ms 内。
import { refractor } from "refractor/all";

type HastNode =
  | { type: "text"; value: string }
  | { type: "element"; tagName: string; properties?: { className?: string[] }; children?: HastNode[] }
  | { type: "root"; children?: HastNode[] };

const cache = new Map<string, string>();
// ponytail: 简单上限，超了整体清空；如果将来需要更精细的淘汰再加 LRU
const MAX_CACHE_ENTRIES = 1000;

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function hastToHtml(node: HastNode): string {
  if (node.type === "text") return escapeHtml(node.value);
  // root 节点没有 tagName，只拼接子节点
  if (node.type === "root") return (node.children ?? []).map(hastToHtml).join("");
  const className = node.properties?.className?.length ? ` class="${node.properties.className.join(" ")}"` : "";
  const children = (node.children ?? []).map(hastToHtml).join("");
  return `<${node.tagName}${className}>${children}</${node.tagName}>`;
}

/** 高亮代码为 HTML 字符串（token 带 class，样式见 globals.css 的 .token 规则）。 */
export function highlightCode(code: string, lang: string): string {
  const normalizedLang = (lang || "text").toLowerCase();
  const key = `${normalizedLang}\u0000${code}`;
  const cached = cache.get(key);
  if (cached) return cached;
  let html: string;
  try {
    html = hastToHtml(refractor.highlight(code, normalizedLang) as unknown as HastNode);
  } catch {
    // 未注册的语言或非法输入：退化为纯文本
    html = escapeHtml(code);
  }
  if (cache.size >= MAX_CACHE_ENTRIES) cache.clear();
  cache.set(key, html);
  return html;
}
