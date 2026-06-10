import { BLOD } from "../core/bilibili-old";
import { toast } from "../core/toast";
import { user } from "../core/user";
import type { userStatus } from "../core/userstatus";
import htmlSpace from "../html/space.html";
import { accountGetCardByMid } from "../io/account-getcardbymid";
import { jsonCheck } from "../io/api";
import json from '../json/mid.json';
import { debug } from "../utils/debug";
import { loadScript } from "../utils/element";
import { timeFormat } from "../utils/format/time";
import { FetchHook } from "../utils/hook/fetch";
import { xhrHook } from "../utils/hook/xhr";
import { poll } from "../utils/poll";
import { VdomTool } from "../utils/vdomtool";
import { Page } from "./page";

const Mid = {
    11783021: '哔哩哔哩番剧出差',
    1988098633: 'b站_戲劇咖',
    2042149112: 'b站_綜藝咖'
}

const SPACE_HASH = 'd525618dfa1c1daa27addac6609189fa610fec82';
const SPACE_CDN = '//s1.hdslb.com/bfs/static/jinkela/space/';
const SPACE_ENTRY_CHUNK = `${SPACE_CDN}9.space.${SPACE_HASH}.js`;
const SPACE_MAIN = `${SPACE_CDN}space.${SPACE_HASH}.js`;
const LEGACY_SPACE_SCRIPTS = {
    jquery: '//s1.hdslb.com/bfs/static/jinkela/long/js/jquery/jquery1.7.2.min.js',
    config: '//s1.hdslb.com/bfs/seed/jinkela/short/config/biliconfig.js',
    header: '//s1.hdslb.com/bfs/seed/jinkela/header/header.js',
    footer: '//static.hdslb.com/common/js/footer.js',
};

const LEGACY_SPACE_HARD_RELOAD = 'if(!i||0===i.length)if(e){var n="/".concat(e);window.location.href="".concat(location.protocol,"//").concat(location.host).concat(n).concat(location.search)}else window.location.href="//www.bilibili.com/404.html";';
const LEGACY_SPACE_HARD_RELOAD_PATCH = 'if(!i||0===i.length){if(e){var n="/".concat(e);history.replaceState(history.state,"",n+location.search+location.hash);i=Uo.getMatchedComponents()||[]}else i=[]};';

function patchLegacySpaceMain(code: string) {
    if (!code.includes(LEGACY_SPACE_HARD_RELOAD)) {
        throw new Error('旧版个人空间主包重定向片段匹配失败，已停止执行以避免重复刷新');
    }
    return code.replace(LEGACY_SPACE_HARD_RELOAD, LEGACY_SPACE_HARD_RELOAD_PATCH);
}

function injectScriptText(code: string, sourceUrl: string) {
    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.appendChild(document.createTextNode(`${code}\n//# sourceURL=${new URL(sourceUrl, location.href).href}`));
    (document.body || document.head || document.documentElement).appendChild(script);
    script.remove();
}

function getSpaceMid() {
    return Number(location.pathname.match(/^\/(?:v\/)?(\d+)/)?.[1] || BLOD.path[3]?.split("?")[0]) || 0;
}

function normalizeLegacySpaceLocation(mid: number) {
    if (!mid) return;
    const routePrefix = new RegExp(`^/${mid}(?:/|$)`);
    let pathname = location.pathname.replace(/^\/v\/(\d+)(?=\/|$)/, '/$1');
    if (!routePrefix.test(pathname)) {
        pathname = `/${mid}`;
    } else if (pathname.length > 1) {
        pathname = pathname.replace(/\/+$/, '');
    }
    const next = `${pathname}${location.search}${location.hash}`;
    if (next !== `${location.pathname}${location.search}${location.hash}`) {
        history.replaceState(history.state, '', next);
    }
}

export class PageSpace {

    protected mid: number;

    /** 失效视频aid */
    protected aids: number[] = [];

    protected aidInfo: Record<'cover' | 'title', string>[] = [];

    constructor(status?: typeof userStatus) {
        this.mid = getSpaceMid();
        this.midInfo();
        const init = (status: typeof userStatus) => {
            status.album && this.album();
            status.jointime && this.jointime();
            status.lostVideo && this.lostVideo();
            // 复活旧版个人空间页（屏蔽新版 + 载入旧版资源）；置于最后，确保上面的 hook 先于旧版 SPA 请求注册
            status.space && this.mid && new PageSpaceLegacy(this.mid);
        };
        status ? init(status) : user.addCallback(init);
    }

    /** 修复限制访问up空间 */
    protected midInfo() {
        switch (this.mid) {
            case 11783021:
            case 1988098633:
            case 2042149112:
                json.data.mid = this.mid;
                json.data.name = json.data.official.desc = (Mid[this.mid] || Mid[11783021]) + ' 官方帐号';
                xhrHook("acc/info?", undefined, obj => {
                    if (obj.responseText && obj.responseText.includes("-404")) {
                        obj.response = obj.responseText = JSON.stringify(json);
                        toast.warning("该用户被404，已使用缓存数据恢复访问！");
                    } else if (obj.responseType === 'blob' && obj.response.size === 46) {
                        obj.response = new Blob([JSON.stringify(json)], { type: 'application/json' });
                        toast.warning("该用户被404，已使用缓存数据恢复访问！");
                    }
                }, false);
                // #494 空间ajax似乎已改用fetch
                new FetchHook('acc/info?').response(async res => {
                    const text = await res.text();
                    if (text.includes('-404')) {
                        return JSON.stringify(json)
                    }
                })
                break;
            default:
                break;
        }
    }

    /** 还原相簿 */
    protected album() {
        xhrHook("api.bilibili.com/x/dynamic/feed/draw/doc_list", undefined, obj => {
            const response = JSON.parse(<string>obj.responseText);
            let data = response.data.items.reduce((s: number[], d: Record<string, any>) => {
                s.push(d.doc_id);
                return s;
            }, []);
            setTimeout(() => {
                document.querySelectorAll(".album-card").forEach((d, i) => {
                    (<HTMLAnchorElement>d.firstChild).href = `//h.bilibili.com/${data[i]}`;
                    (<HTMLAnchorElement>d.children[1]).href = `//h.bilibili.com/${data[i]}`;
                })
            }, 1000)
        }, false);
    }

    /** 动态重定向回相簿 */
    static album() {
        xhrHook(['x/polymer/web-dynamic', 'detail?'], undefined, res => {
            const result = res.responseType === "json" ? res.response : JSON.parse(res.response);
            if (result.code === 0) {
                if (result.data?.item.type === 'DYNAMIC_TYPE_DRAW') location.replace(`https://h.bilibili.com/${result.data.item.basic.rid_str}`)
            }
        }, false);
    }

    /** 注册时间 */
    protected jointime() {
        poll(() => document.querySelector(".section.user-info"), t => {
            accountGetCardByMid(this.mid)
                .then(d => {
                    const jointime = timeFormat(d.regtime * 1000, true);
                    const node = <HTMLDivElement>t.lastChild;
                    new VdomTool(`<div class="info-regtime" style="display: inline-block;word-break: break-all;">
                    <span class="info-command" style="display: inline-block;font-size: 12px;font-family: Microsoft YaHei;line-height: 16px;color: #9499a0;margin-right: 16px;">注册</span>
                    <span class="info-value" style="color: #6d757a;font-family: Microsoft YaHei;font-size: 12px;line-height: 16px;padding-right: 15px;">${jointime}</span>
                </div>`).appendTo(node);
                })
        })
    }

    /** 失效视频 */
    protected lostVideo() {
        // 收藏
        xhrHook('x/v3/fav/resource/list', undefined, async res => {
            try {
                const data = jsonCheck(res.response);
                delete data.data?.ttl; // 修复收藏时间
                if (data.data.medias) {
                    data.data.medias.forEach((d: any) => {
                        d.attr % 2 && this.aids.push(d.id);
                    });
                }
                if (this.aids.length) {
                    const msg = toast.list('失效视频 >>>', '> ' + this.aids.join(' '));
                    this.lostVideoView().then(() => {
                        setTimeout(() => {
                            msg.push('> 数据返回，正在修复~');
                            let resolve = 0, reject = 0;
                            msg.type = 'success';
                            const ele = document.querySelector("#page-fav");
                            if (ele) {
                                const medias = (<any>ele).__vue__.favListDetails.medias;
                                medias?.forEach((d: any) => {
                                    if (d.attr % 2) {
                                        msg.push(`> av${d.id}`);
                                        if (this.aidInfo[d.id].title) {
                                            resolve++;
                                            d.title = this.aidInfo[d.id].title;
                                            msg.push('>' + this.aidInfo[d.id].title);
                                        } else {
                                            reject++;
                                            d.title = `av${d.id}`;
                                            msg.push('> 未能获取到有效信息！');
                                        }
                                        this.aidInfo[d.id].cover && (d.cover = this.aidInfo[d.id].cover);
                                        d.attr = 0;
                                        ele.querySelector(`[data-aid=${d.bvid}]`)?.children[1]?.setAttribute("style", "text-decoration : line-through;color : #ff0000;");
                                    }
                                })
                            }
                            msg.push('> ', `> 修复结束：成功 ${resolve} 失败 ${reject}`);
                            msg.delay = 4;
                        }, 100);
                    });
                }
            } catch { }
        }, false);
    }

    protected lostVideoView() {
        const arr: Promise<void>[] = [];
        while (this.aids.length) {
            arr.push((async () => {
                const d = this.aids.shift()!;
                if (this.aidInfo[d]) return;
                let title!: string, cover!: string;
                await GM.fetch(`//www.biliplus.com/video/av${d}`)
                    .then(d => d.text())
                    .then(d => {
                        if (d.match(/\<title\>.+?\ \-\ AV/)) {
                            title = d.match(/\<title\>.+?\ \-\ AV/)![0].replace(/<title>/, "").replace(/ - AV/, "");
                            cover = d.match(/\<img style=\"display:none\"\ src=\".+?\"\ alt/)![0].replace(/<img style="display:none" src="/, "").replace(/" alt/, "");
                        }
                    })
                    .catch(e => {
                        debug.error(`获取失效视频av${d}信息错误`, 'BILIPLUS', e);
                    });
                if (!title || !cover) {
                    await GM.fetch(`//www.biliplus.com/all/video/av${d}`)
                        .then(d => d.text())
                        .then(d => {
                            if (d.match('/api/view_all?')) {
                                const url = d.match(/\/api\/view_all\?.+?\',cloudmoe/)![0].replace(/\',cloudmoe/, "");
                                return GM.fetch(`//www.biliplus.com${url}`)
                            }
                            throw new Error('无cid缓存');
                        })
                        .then(d => d.json())
                        .then(d => {
                            d = jsonCheck(d);
                            title = title || d.data.info.title
                            cover = cover || d.data.info.pic
                        })
                        .catch(e => {
                            debug.error(`获取失效视频av${d}信息错误`, 'BILIPLUSALL', e);
                        });
                }
                if (!title || !cover) {
                    await GM.fetch(`//www.jijidown.com/video/av${d}`)
                        .then(d => d.text())
                        .then(d => {
                            if (d.match('window._INIT')) {
                                title = title || d.match(/\<title\>.+?\-哔哩哔哩唧唧/)![0].replace(/<title>/, "").replace(/-哔哩哔哩唧唧/, "");
                                cover = cover || d.match(/\"img\":\ \".+?\",/)![0].match(/http.+?\",/)![0].replace(/",/, "");
                            }
                        })
                        .catch(e => {
                            debug.error(`获取失效视频av${d}信息错误`, 'JIJIDOWN', e);
                        });
                }
                cover = cover && cover.replace("http:", "")
                this.aidInfo[d] = { title, cover };
            })());
        }
        return Promise.all(arr);
    }
}

/**
 * 新版个人空间 SPA 脚本特征（屏蔽用，避免与旧版资源抢占 DOM 运行时）。
 * 新版是 Vite 构建的 `fresh-space` 应用 + laputa 新版顶栏；
 * 与旧版资源路径 `//s1.hdslb.com/bfs/static/jinkela/space/` 完全不同，不会误伤旧版 chunk。
 */
const modernSpaceScriptPatterns = [
    /\/bfs\/static\/shanks\/fresh-space\//,
    /\/bfs\/seed\/laputa-header\//,
];

/**
 * 复活旧版个人空间页。
 * B 站已把个人空间改为全新版式并移除「回到旧版」入口，但旧版静态资源仍存活于 CDN。
 * 本类屏蔽新版脚本，用旧版骨架整页接管，并加载旧版 `space.js`（webpack publicPath 已硬编码，
 * 会自行拉取其余 chunk）+ 旧版 CSS，由旧版 Vue 应用自行拉取数据并渲染全部 Tab。
 */
export class PageSpaceLegacy extends Page {
    protected neutralizeScriptPatterns = modernSpaceScriptPatterns;
    constructor(mid: number) {
        super(htmlSpace);
        const win = <any>window;
        normalizeLegacySpaceLocation(mid);
        // 旧版空间 SPA 启动所需的全局变量（替换 document 不会清除 window 上的属性）
        win._bili_space_mid = mid;
        win._bili_space_mymid = Number(document.cookie.match(/DedeUserID=(\d+)/)?.[1]) || 0;
        win.abtest = win.abtest || { in_new_ab: true, ab_version: { can_go_old: 'ENABLED' }, ab_split_num: {} };
        // 旧版顶栏（slim 全局顶栏，无分区菜单）由模板自带的 header.js 渲染；
        // 个人空间没有分区菜单/Banner，故不调用 Header.primaryMenu()/banner()（同 search/read 页做法）
        this.updateDom();
        this.loadLegacySpaceScripts();
    }

    protected async loadLegacySpaceScripts() {
        try {
            await loadScript(LEGACY_SPACE_SCRIPTS.jquery);
            await loadScript(LEGACY_SPACE_SCRIPTS.config);
            await loadScript(LEGACY_SPACE_SCRIPTS.header);
            await loadScript(SPACE_ENTRY_CHUNK);
            const mainUrl = new URL(SPACE_MAIN, location.href).href;
            const response = await GM.fetch(mainUrl);
            const code = patchLegacySpaceMain(await response.text());
            injectScriptText(code, mainUrl);
            loadScript(LEGACY_SPACE_SCRIPTS.footer).catch(e => debug.error('旧版个人空间页脚脚本加载失败', e));
        } catch (e) {
            debug.error('旧版个人空间脚本加载失败', e);
            toast.error('旧版个人空间脚本加载失败', e)();
        }
    }
}
