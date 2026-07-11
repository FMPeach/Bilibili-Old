import { Page } from "../page";
import { regionFeedHook } from "../region-feed";

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

    constructor(html: string) {
        super(html);
        // 各频道页均有“有新动态/最新投稿”栏目，其接口已下线，统一代理
        regionFeedHook();
    }
}
