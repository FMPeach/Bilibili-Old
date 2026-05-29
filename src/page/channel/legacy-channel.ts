import { Page } from "../page";

const modernChannelScriptPatterns = [
    /\/bfs\/static\/home(?:-v3)?\//,
    /\/bfs\/static\/player\/main\//,
    /\/bfs\/seed\/laputa-(?:header|footer)\//,
];

/**
 * 频道首页会先加载新版 home-v3 运行时。
 * 旧版频道模板接管页面时，需要阻止这些新版 chunk 继续写入同一个 DOM/webpackJsonp。
 */
export abstract class PageLegacyChannel extends Page {
    protected neutralizeScriptPatterns = modernChannelScriptPatterns;
}
