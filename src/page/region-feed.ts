import { apiNewlist } from "../io/api-newlist";
import { apiRegionFeedRcmd } from "../io/api-region-feed-rcmd";
import { IAidDatail } from "../io/api";
import { urlObj } from "../utils/format/url";
import { jsonpHook } from "../utils/hook/node";
import { xhrHook, XMLHttpRequestOpenParams } from "../utils/hook/xhr";

/** 将稿件列表按原接口格式拼装为响应体 */
function response(archives: IAidDatail[], pn: number, ps: number) {
    return { code: 0, message: "", ttl: 1, data: { archives, page: { count: archives.length, num: pn, size: ps } } };
}

/** “有新动态”：接口已下线，改用新版分区feed，feed无数据时退回原最新投稿接口 */
async function resolveDynamic(url: string) {
    const obj = urlObj(url);
    const rid = Number(obj.rid);
    const pn = Number(obj.pn) || 1;
    const ps = Number(obj.ps) || 10;
    let archives = await apiRegionFeedRcmd(rid, pn, ps).catch(() => <IAidDatail[]>[]);
    archives.length || (archives = await apiNewlist(rid, ps, pn));
    return response(archives, pn, ps);
}

/** “最新投稿”：一级分区原接口仍在服务，仅在其失效（二级分区恒返回空）时换新版分区feed */
async function resolveNewlist(url: string) {
    const obj = urlObj(url);
    const rid = Number(obj.rid);
    const pn = Number(obj.pn) || 1;
    const ps = Number(obj.ps) || 10;
    let archives = await apiNewlist(rid, ps, pn).catch(() => <IAidDatail[]>[]);
    archives.length || (archives = await apiRegionFeedRcmd(rid, pn, ps));
    return response(archives, pn, ps);
}

/**
 * 分区“有新动态/最新投稿”栏目数据修复。
 * 2025年起`dynamic/region`接口下线、`newlist`不再支持二级分区，统一代理这两个接口，
 * 失效部分改由新版分区feed（`region/feed/rcmd`，旧分区tid就近映射）提供数据。
 * 请求形态两者兼容：旧版主页、频道页（channel.js）经由 jsonp 请求；
 * 旧版番剧/国创页（bangumi-home.js）、影视页（cinema-*.js）经由 XHR（axios）请求。
 */
export function regionFeedHook() {
    const xhr = (resolve: (url: string) => Promise<object>) => async (args: XMLHttpRequestOpenParams) => {
        const responseText = JSON.stringify(await resolve(args[1]));
        return { response: responseText, responseText };
    };
    jsonpHook.async("x/web-interface/dynamic/region", undefined, resolveDynamic, false);
    jsonpHook.async("x/web-interface/newlist?", undefined, resolveNewlist, false);
    xhrHook.async("x/web-interface/dynamic/region", undefined, xhr(resolveDynamic), false);
    xhrHook.async("x/web-interface/newlist?", undefined, xhr(resolveNewlist), false);
}
