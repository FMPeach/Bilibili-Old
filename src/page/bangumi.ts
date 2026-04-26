import { BLOD } from "../core/bilibili-old";
import { Comment } from "../core/comment";
import { networkMock } from "../core/network-mock";
import { switchVideo } from "../core/observer";
import { toast } from "../core/toast";
import { alert } from "../core/ui/alert";
import { Like } from "../core/ui/like";
import { user } from "../core/user";
import { videoInfo } from "../core/video-info";
import html from '../html/bangumi.html';
import { jsonCheck } from "../io/api";
import { apiBangumiSeason, IBangumiEpisode, IBangumiSeasonResponse } from "../io/api-bangumi-season";
import { ApiGlobalOgvView } from "../io/api-global-view";
import { apiPgcSeason } from "../io/api-pgc-season";
import { ISubtitle, PlayerResponse } from "../io/api-player";
import { ApiSeasonSection } from "../io/api-season-section";
import { apiSeasonStatus, ISeasonStatusResponse } from "../io/api-season-status";
import { apiTagInfo } from "../io/api-tag-info";
import { apiTagTop } from "../io/api-tag-top";
import { apiViewDetail } from "../io/api-view-detail";
import { debug } from "../utils/debug";
import { addCss } from "../utils/element";
import { unitFormat } from "../utils/format/unit";
import { urlObj } from "../utils/format/url";
import { FetchHook } from "../utils/hook/fetch";
import { propertyHook } from "../utils/hook/method";
import { xhrHook } from "../utils/hook/xhr";
import { poll } from "../utils/poll";
import { Header } from "./header";
import { Page } from "./page";

export class PageBangumi extends Page {
    protected like: Like;
    protected get ssid() {
        return BLOD.ssid;
    }
    protected set ssid(v) {
        BLOD.ssid = v;
    }
    protected get epid() {
        return BLOD.epid;
    }
    protected set epid(v) {
        BLOD.epid = v;
    }
    protected get th() {
        return BLOD.th;
    }
    protected set th(v) {
        BLOD.th = v;
    }
    protected get limit() {
        return BLOD.limit;
    }
    protected set limit(v) {
        BLOD.limit = v;
    }
    protected get pgc() {
        return BLOD.pgc;
    }
    protected set pgc(v) {
        BLOD.pgc = v;
    }
    /** 播放额外参数 */
    protected playerExtraParams: any;
    /** 字幕暂存 */
    protected subtitles: ISubtitle[][] = [];
    constructor() {
        super(html);
        Reflect.deleteProperty(window, '__INITIAL_STATE__');
        // 爆破next.js
        Reflect.defineProperty(window, '__NEXT_DATA__', { value: true });
        this.like = new Like();
        new Comment();
        // 精确爆破新版番剧脚本
        (<any>window).__Iris__ = true;
        this.pgc = true;
        location.href.replace(/[sS][sS]\d+/, d => this.ssid = <any>Number(d.substring(2)));
        location.href.replace(/[eE][pP]\d+/, d => this.epid = <any>Number(d.substring(2)));
        this.recommend();
        this.seasonCount();
        this.followAction();
        this.season();
        this.review();
        this.sponsorRank();
        user.userStatus!.videoLimit?.status && this.videoLimit();
        this.related();
        this.initialState();
        this.enLike();
        this.episodeData();
        Header.prid = 1612;
        Header.primaryMenu();
        Header.banner();
        this.updateDom();
    }

    /** 修复：末尾番剧推荐 */
    protected recommend() {
        xhrHook("api.bilibili.com/pgc/web/recommend/related/recommend", args => {
            // 原接口不返回针对ssid/epid的数据
            args[1] = args[1].replace("web/recommend", "season/web");
        }, r => {
            try {
                const result = jsonCheck(r.response);
                result.result = result.data.season;
                r.responseType === "json" ? r.response = result : r.response = r.responseText = JSON.stringify(result);
                // 补全播放器获取到的数据
                propertyHook.modify<Function>(window, 'getPlayerExtraParams', d => {
                    return () => {
                        this.playerExtraParams = d();
                        this.playerExtraParams.recommend = result.result;
                        return this.playerExtraParams;
                    };
                })
            } catch (e) { }
        });
    }
    /** 修复追番数据 */
    protected seasonCount() {
        xhrHook("bangumi.bilibili.com/ext/web_api/season_count", args => {
            args[1] = args[1].replace("bangumi.bilibili.com/ext/web_api/season_count", "api.bilibili.com/pgc/web/season/stat");
        }, r => {
            try {
                const result = jsonCheck(r.response);
                result.result.favorites = result.result.follow;
                r.responseType === "json" ? r.response = result : r.response = r.responseText = JSON.stringify(result);
            } catch (e) { }
        }, true);
    }

    /** 拦截旧版追番接口，重定向到新版 PGC 接口 */
    protected followAction() {
        // XHR 拦截（旧版页面脚本使用 XMLHttpRequest）
        xhrHook("bangumi.bilibili.com/follow/web_api/season/follow", args => {
            const url = new URL(args[1], location.origin);
            const seasonId = url.searchParams.get('season_id') || String(this.ssid);
            const csrf = document.cookie.match(/bili_jct=([^;]+)/)?.[1] || '';
            args[1] = `//api.bilibili.com/pgc/web/follow/add?season_id=${seasonId}&csrf=${csrf}`;
            args[0] = 'POST';
        }, undefined, false);
        xhrHook(["bangumi.bilibili.com/follow/web_api/season/unfollow", "bangumi.bilibili.com/follow/web_api/season/cancel"], args => {
            const url = new URL(args[1], location.origin);
            const seasonId = url.searchParams.get('season_id') || String(this.ssid);
            const csrf = document.cookie.match(/bili_jct=([^;]+)/)?.[1] || '';
            args[1] = `//api.bilibili.com/pgc/web/follow/del?season_id=${seasonId}&csrf=${csrf}`;
            args[0] = 'POST';
        }, undefined, false);

        // Fetch 拦截（新版残留脚本使用 fetch）
        // 注意：FetchHook 的 urls 使用 every() 匹配，每个实例只能有一个 URL 模式
        const followFetchHook = new FetchHook('bangumi.bilibili.com/follow/web_api/season/follow');
        followFetchHook.request((req) => {
            const url = req.input.toString();
            const urlObj = new URL(url, location.origin);
            const seasonId = urlObj.searchParams.get('season_id') || String(this.ssid);
            const csrf = document.cookie.match(/bili_jct=([^;]+)/)?.[1] || '';
            req.input = `//api.bilibili.com/pgc/web/follow/add?season_id=${seasonId}&csrf=${csrf}`;
            req.init = {
                ...req.init,
                method: 'POST',
                credentials: 'include'
            };
        });
        followFetchHook.response(async (res) => {
            return res.text();
        });

        const unfollowFetchHook = new FetchHook('bangumi.bilibili.com/follow/web_api/season/unfollow');
        unfollowFetchHook.request((req) => {
            const url = req.input.toString();
            const urlObj = new URL(url, location.origin);
            const seasonId = urlObj.searchParams.get('season_id') || String(this.ssid);
            const csrf = document.cookie.match(/bili_jct=([^;]+)/)?.[1] || '';
            req.input = `//api.bilibili.com/pgc/web/follow/del?season_id=${seasonId}&csrf=${csrf}`;
            req.init = {
                ...req.init,
                method: 'POST',
                credentials: 'include'
            };
        });
        unfollowFetchHook.response(async (res) => {
            return res.text();
        });

        const cancelFetchHook = new FetchHook('bangumi.bilibili.com/follow/web_api/season/cancel');
        cancelFetchHook.request((req) => {
            const url = req.input.toString();
            const urlObj = new URL(url, location.origin);
            const seasonId = urlObj.searchParams.get('season_id') || String(this.ssid);
            const csrf = document.cookie.match(/bili_jct=([^;]+)/)?.[1] || '';
            req.input = `//api.bilibili.com/pgc/web/follow/del?season_id=${seasonId}&csrf=${csrf}`;
            req.init = {
                ...req.init,
                method: 'POST',
                credentials: 'include'
            };
        });
        cancelFetchHook.response(async (res) => {
            return res.text();
        });
    }

    /** 修复换季时请求 502 */ 
    protected season() {
        xhrHook("bangumi.bilibili.com/view/web_api/season", args => {
            args[1] = args[1].replace("bangumi.bilibili.com/view/web_api/season", "api.bilibili.com/pgc/view/web/season");
        }, r => {
            const bangumiResult = jsonCheck(r.response);
            if (bangumiResult.result.season_id) {
                this.ssid = bangumiResult.result.season_id;
            }
            bangumiResult.result.episodes.forEach((e: any) => {
                e.index_title = e.long_title;
                e.index = e.title;
            });
            return r.responseType === "json" ? r.response = bangumiResult : r.response = r.responseText = JSON.stringify(bangumiResult);
        }, false);
    }
    /** 修复点评数据，使用自 hmjz100 的commit 310cdae **/
    protected review() {
        xhrHook.async('bangumi.bilibili.com/review/web_api/media/play?media_id', undefined, async (args) => {
            const url = new URL(args[1], location.origin);
            const mediaId = url.searchParams.get('media_id');
            const info_f = await fetch(`https://api.bilibili.com/pgc/review/user?media_id=${mediaId}`, { credentials: `include` });
            const info = await info_f.json();
            const short_f = await fetch(`https://api.bilibili.com/pgc/review/short/list?media_id=${mediaId}&ps=3&sort=0`, { credentials: `include` });
            const short = await short_f.json();
            const long_f = await fetch(`https://api.bilibili.com/pgc/review/long/list?media_id=${mediaId}&ps=3&sort=0`, { credentials: `include` });
            const long = await long_f.json();
            const feed_f = await fetch(`https://api.bilibili.com/pgc/review/long/feed/pull?ps=5`, { credentials: `include` });
            const feed = await feed_f.json();
            const feedList = (feed.data?.list ?? [])
                .slice(0, 3)
                .map((item: any) => ({
                    article_id: item.article_id,
                    author: {
                        avatar: item.author.avatar,
                        mid: item.author.mid,
                        uname: item.author.uname,
                        vip: {
                            themeType: item.author.vip?.themeType ?? 0,
                            vipStatus: item.author.vip?.vipStatus ?? 0,
                            vipType: item.author.vip?.vipType ?? 0
                        }
                    },
                    content: item.content,
                    media: {
                        cover: item.media?.cover ?? '',
                        media_id: item.media?.media_id,
                        title: item.media?.title
                    },
                    review_id: item.review_id,
                    title: item.title,
                    user_rating: {
                        score: item.score ?? 0
                    }
                }));
            const longList = (long.data?.list ?? [])
                .slice(0, 3)
                .map((item: any) => ({
                    article_id: item.article_id,
                    author: {
                        avatar: item.author.avatar,
                        mid: item.author.mid,
                        uname: item.author.uname,
                        vip: {
                            themeType: item.author.vip?.themeType ?? 0,
                            vipStatus: item.author.vip?.vipStatus ?? 0,
                            vipType: item.author.vip?.vipType ?? 0
                        }
                    },
                    content: item.content,
                    ctime: item.ctime,
                    mtime: item.mtime,
                    review_id: item.review_id,
                    title: item.title,
                    user_rating: {
                        score: item.score ?? 0
                    }
                }));
            const shortList = (short.data?.list ?? [])
                .slice(0, 3)
                .map((item: any) => ({
                    author: {
                        avatar: item.author.avatar,
                        mid: item.author.mid,
                        uname: item.author.uname,
                        vip: {
                            themeType: item.author.vip?.themeType ?? 0,
                            vipStatus: item.author.vip?.vipStatus ?? 0,
                            vipType: item.author.vip?.vipType ?? 0
                        }
                    },
                    content: item.content,
                    ctime: item.ctime,
                    mtime: item.mtime,
                    review_id: item.review_id,
                    user_rating: {
                        score: item.score ?? item.score
                    }
                }));
            const response = {
                code: 0,
                message: 'success',
                result: {
                    feed: feedList,
                    long_review: {
                        list: longList,
                        total: long.data?.count ?? 0
                    },
                    rating: {
                        count: info.result?.media?.rating?.count ?? 0,
                        score: info.result?.media?.rating?.score ?? 0
                    },
                    short_review: {
                        list: shortList,
                        total: short.data?.total ?? 0
                    }
                }
            };
            let res = JSON.stringify(response);
            return { response: res, responseText: res, responseType: 'json' }
        }, false)
    }
    /** 修复承包榜跨季报错问题 */
    protected sponsorRank() {
        xhrHook('bangumi.bilibili.com/sponsor/web_api/v2/rank/', args => {
            const url = new URL(args[1]);
            if (!url.searchParams.has('season_type')) {
                url.searchParams.set('season_type', '1');
                args[1] = url.toString();
            }
        }, undefined, false);
    }
    /** 解除区域限制（重定向模式） */
    protected videoLimit() {
        xhrHook("bangumi.bilibili.com/view/web_api/season/user/status", undefined, res => {
            try {
                const data = res.responseType === "json" ? res.response : JSON.parse(res.response);
                data.result.area_limit = 0;
                data.result.ban_area_show = 0;
                res.responseType === "json" || (res.response = res.responseText = JSON.stringify(data));
            } catch (e) { }
        }, false);
    }
    /** 修复相关视频推荐 接口来自md页面 */
    protected related() {
        const related: Record<string, any> = {};
        xhrHook.async("x/web-interface/archive/related", () => ((<any>window).__INITIAL_STATE__)?.mediaInfo?.title, async () => {
            let response = { code: 0, data: <any>[], message: "0" };
            if (related[((<any>window).__INITIAL_STATE__)?.mediaInfo?.title]) {
                response.data = related[((<any>window).__INITIAL_STATE__).mediaInfo.title];
            } else {
                await apiTagInfo((<any>window).__INITIAL_STATE__.mediaInfo.title)
                    .then(d => {
                        return apiTagTop(d.tag_id)
                    })
                    .then(d => {
                        response.data = related[(<any>window).__INITIAL_STATE__.mediaInfo.title] = d;
                    })
                    .catch(e => {
                        debug.error("相关视频推荐", e);
                    })
            }
            return { response, responseType: 'json', responseText: JSON.stringify(response) }
        }, false);
    }
    /** 初始化`__INITIAL_STATE__` */
    protected initialState() {
        const data = this.epid ? { ep_id: this.epid } : { season_id: this.ssid };
        Promise.allSettled([apiSeasonStatus(data), new Promise(r => poll(() => this.initilized, r))])
            .then(d => <[ISeasonStatusResponse?]>d.map(d => d.status === 'fulfilled' && d.value))
            .then(async d => {
                const t = (<any>window).__INITIAL_STATE__;
                const status = d[0];
                if (status) {
                    const i = status.progress ? status.progress.last_ep_id : -1
                        , n = status.progress ? status.progress.last_ep_index : ""
                        , s = status.progress ? status.progress.last_time : 0
                        , o = status.vip_info || {};
                    !this.epid && i > 0 && (this.epid = i); // 正常启动必须
                    t.userStat = {
                        loaded: !0,
                        error: void 0 === status.pay,
                        follow: status.follow || 0,
                        pay: status.pay || 0,
                        payPackPaid: status.pay_pack_paid || 0,
                        sponsor: status.sponsor || 0,
                        watchProgress: {
                            lastEpId: 0 === i ? -1 : i,
                            lastEpIndex: n,
                            lastTime: s
                        },
                        vipInfo: {
                            due_date: o.due_date || 0,
                            status: o.status || 0,
                            type: o.type || 0
                        }
                    };
                    status.paster && (t.paster = status.paster || {});
                    this.limit = status.area_limit || 0;
                    user.userStatus!.videoLimit.status || (t.area = this.limit);
                    t.seasonFollowed = 1 === status.follow;
                }

                // bangumui 接口寄了, 永远使用 pgc
                {
                    apiPgcSeason(data)
                        .then(bangumi => {
                            const t = (<any>window).__INITIAL_STATE__;
                            const status = bangumi.user_status;
                            if (status) {
                                const i = status.progress ? status.progress.last_ep_id : -1
                                    , n = status.progress ? status.progress.last_ep_index : ""
                                    , s = status.progress ? status.progress.last_time : 0
                                    , o = status.vip_info || <any>{};
                                !this.epid && i > 0 && (this.epid = i); // 正常启动必须
                                t.userStat = {
                                    loaded: !0,
                                    error: void 0 === status.pay,
                                    follow: status.follow || 0,
                                    pay: status.pay || 0,
                                    payPackPaid: status.pay_pack_paid || 0,
                                    sponsor: status.sponsor || 0,
                                    watchProgress: {
                                        lastEpId: 0 === i ? -1 : i,
                                        lastEpIndex: n,
                                        lastTime: s
                                    },
                                    vipInfo: {
                                        due_date: o.due_date || 0,
                                        status: o.status || 0,
                                        type: o.type || 0
                                    }
                                };
                                this.limit = status.area_limit || 0;
                                user.userStatus!.videoLimit.status || (t.area = this.limit);
                                t.seasonFollowed = 1 === status.follow;
                            }
                            const i = JSON.parse(JSON.stringify(bangumi));
                            delete i.episodes;
                            delete i.seasons;
                            delete i.up_info;
                            delete i.rights;
                            delete i.publish;
                            delete i.newest_ep;
                            delete i.rating;
                            delete i.pay_pack;
                            delete i.payment;
                            delete i.activity;
                            i.paster_text = i.record;
                            i.season_status = i.status;
                            i.season_type = i.type;
                            i.series_title = i.series.series_title;
                            i.total_ep = i.total !== -1 ? i.total : bangumi.episodes.length;
                            if (user.userStatus!.bangumiEplist) delete i.bkg_cover;
                            user.userStatus!.videoLimit.status && bangumi.rights && (bangumi.rights.watch_platform = 0);
                            t.mediaInfo = i;
                            t.mediaInfo.bkg_cover && (t.special = !0);
                            t.ssId = bangumi.season_id || -1;
                            t.mdId = bangumi.media_id;
                            bangumi.episodes.forEach((d: any) => {
                                // 修正分p数据差异
                                d.episode_status = d.status;
                                d.index = d.title;
                                d.index_title = d.long_title;
                                d.page = 1;
                                d.premiere = false;
                            });
                            t.epInfo = (this.epid && bangumi.episodes.find(d => d.ep_id == this.epid)) || bangumi.episodes[0] || {};
                            t.epList = bangumi.episodes || [];
                            t.seasonList = bangumi.seasons || [];
                            t.upInfo = bangumi.up_info || {};
                            t.rightsInfo = bangumi.rights || {};
                            t.app = 1 === t.rightsInfo.watch_platform;
                            t.pubInfo = bangumi.publish || {};
                            t.newestEp = bangumi.new_ep || {};
                            t.mediaRating = bangumi.rating || {};
                            t.payMent = bangumi.payment || {};
                            t.activity = bangumi.activity || {};
                            t.epStat = this.setEpStat(t.epInfo.episode_status || t.mediaInfo.season_status, t.userStat.pay, t.userStat.payPackPaid, t.loginInfo);
                            t.epId = Number(this.epid || t.epInfo.ep_id);
                            this.ssid = t.ssId;
                            this.epid = t.epId;

                            if (t.upInfo.mid == /** Classic_Anime */677043260 || t.upInfo.mid == /** Anime_Ongoing */688418886) {
                                this.th = true;
                            }
                            const title = this.setTitle(t.epInfo.index, t.mediaInfo.title, this.Q(t.mediaInfo.season_type), !0);
                            function loopTitle() {
                                poll(() => document.title != title, () => {
                                    document.title = title;
                                    if (document.title != title) loopTitle();
                                })
                            }
                            loopTitle();
                            // 记录视频数据
                            videoInfo.bangumiSeason(<any>bangumi);
                        })
                        .catch(() => {
                            return this.initGlobal();
                        });
                }
            })
            .catch(e => {
                toast.error('初始化bangumi数据出错！', e)();
            })
            .finally(() => {
                if ((<any>window).__INITIAL_STATE__.special) {
                    // 带海报的bangumi隐藏顶栏banner和wrapper
                    addCss("#bili-header-m > #banner_link,#bili-header-m > .bili-wrapper{ display: none; }");
                }
                // 修复怪异模式下人类所不能理解的样式问题 ಥ_ಥ
                if (document.compatMode === "BackCompat") addCss(".header-info > .count-wrapper {height: 18px !important;}");
                // 禁止新版页面残留破坏样式
                window.addEventListener('resize', e => {
                    const container = document.querySelector(".main-container");
                    if (container) {
                        setTimeout(() => {
                            container.removeAttribute('style');
                        })
                    }
                });
            });
    }
    /** epStat，用于判定ep状态。同样由于原生缺陷，ep_id初始化时不会更新本信息，需要主动更新 */
    protected setEpStat(status: number, pay: number, payPackPaid: number, loginInfo: Record<string, any>) {
        var s = 0
            , o = !1
            , a = (1 === loginInfo.vipType || 2 === loginInfo.vipType) && 1 === loginInfo.vipStatus
            , r = "number" == typeof payPackPaid ? payPackPaid : -1;
        return 1 === pay ? s = 0 : 6 === status || 7 === status ? s = loginInfo.isLogin ? a ? 0 : 1 : 2 : 8 === status || 9 === status ? (s = loginInfo.isLogin ? 1 : 2,
            o = !0) : 12 === status ? s = loginInfo.isLogin ? 1 === r ? 0 : 1 : 2 : 13 === status && (s = loginInfo.isLogin ? a ? 0 : 1 : 2),
        {
            status: s,
            isPay: 6 === status || 7 === status || 8 === status || 9 === status || 12 === status || 13 === status,
            isVip: a,
            vipNeedPay: o,
            payPack: r
        }
    }
    /** 更新标题 */
    protected setTitle(t: any, e: any, i: any, n: any) {
        var s = !(arguments.length > 4 && void 0 !== arguments[4]) || arguments[4]
            , o: any = "";
        if (i = void 0 === i ? "番剧" : i,
            e && i)
            if (s && t) {
                var a = this.V(t, i);
                o = "".concat(e, "：").concat(a, "_").concat(i).concat(n ? "_bilibili" : "", "_哔哩哔哩")
            } else
                o = "".concat(e, "_").concat(i).concat(n ? "_bilibili" : "", "_哔哩哔哩");
        else
            o = "番剧".concat(n ? "_bilibili" : "", "_哔哩哔哩");
        if ("undefined" != typeof window) {
            var r: any = window.document.createElement("div");
            r.innerHTML = o,
                o = r.innerText || r.textContent,
                r = null
        }
        return o
    }
    protected Q(t: any, e?: any) {
        var i: any = {
            1: "番剧",
            2: "电影",
            3: "纪录片",
            4: "国创",
            5: "电视剧",
            7: "综艺",
            music: "音乐"
        };
        return [26484, 26481].indexOf(e) > -1 ? i.music : i[t] || "番剧"
    }
    protected V(t: any, e: any) {
        var i: any = Number(t)
            , n = 1 === e || 4 === e || "番剧" === e || "国创" === e ? "话" : "集";
        return isNaN(i) ? t : "第".concat(i).concat(n)
    }
    /** 尝试东南亚接口 */
    protected async initGlobal() {
        const data = this.epid ? { ep_id: this.epid } : { season_id: this.ssid };
        Object.assign(data, { access_key: user.userStatus!.accessKey.token });
        const d = await new ApiGlobalOgvView(<any>data, user.userStatus!.videoLimit.th)
            .getDate();
        networkMock();
        await new Promise(r => poll(() => (<any>window).__INITIAL_STATE__, r));
        const t = (<any>window).__INITIAL_STATE__;
        const i: typeof d = JSON.parse(JSON.stringify(d));
        const episodes: IBangumiEpisode[] = d.modules.reduce((s, d_1) => {
            d_1.data.episodes.forEach(d_2 => {
                s.push({
                    aid: d_2.aid,
                    cid: d_2.id,
                    cover: d_2.cover,
                    ep_id: d_2.id,
                    episode_status: d_2.status,
                    from: d_2.from,
                    index: <any>d_2.title,
                    index_title: <any>d_2.title_display,
                    subtitles: d_2.subtitles
                });
                if (d_2.subtitles) {
                    this.subtitles[d_2.id] = [];
                    d_2.subtitles.forEach(d => {
                        this.subtitles[d_2.id].push({
                            ai_status: 2,
                            ai_type: Number(d.is_machine),
                            id: d.id,
                            id_str: String(d.id),
                            is_lock: false,
                            lan: d.key,
                            lan_doc: d.title,
                            subtitle_url: d.url,
                            type: 1,
                        })
                    })
                }
            });
            return s;
        }, <any[]>[]);
        t.mediaInfo = {
            actors: i.actor?.info,
            alias: i.alias,
            areas: i.areas,
            cover: i.cover,
            evaluate: i.evaluate,
            is_paster_ads: 0,
            jp_title: i.origin_name,
            link: i.link,
            media_id: -1,
            mode: i.mode,
            paster_text: "",
            season_id: i.season_id,
            season_status: i.status,
            season_title: i.season_title,
            season_type: i.type,
            series_title: i.title,
            square_cover: i.square_cover,
            staff: i.actor?.info,
            stat: i.stat,
            style: i.styles?.map(d_3 => d_3.name),
            title: i.title,
            total_ep: i.total,
        };
        t.mediaInfo.bkg_cover && (t.special = !0);
        t.ssId = i.season_id || -1;
        t.epInfo = (this.epid && episodes.find((d_4: any) => d_4.ep_id == this.epid)) || episodes[0] || {};
        t.epList = episodes;
        t.seasonList = d.series?.seasons?.map(d_5 => {
            return {
                badge: "独家",
                badge_type: 1,
                cover: "",
                media_id: -1,
                new_ep: {},
                season_id: d_5.season_id,
                season_title: d_5.quarter_title,
                season_type: 1,
                stat: {},
                title: d_5.quarter_title
            };
        }) || [];
        t.upInfo = d.up_info || {};
        t.rightsInfo = d.rights || {};
        t.app = 1 === t.rightsInfo.watch_platform;
        d.publish.is_started = 1;
        d.publish?.time_length_show === "已完结" && (d.publish.is_finish = 1);
        t.pubInfo = d.publish || {};
        if (d.new_ep) {
            (<any>d).new_ep.desc = d.new_ep.new_ep_display;
            (<any>d).new_ep.index = d.new_ep.title;
        }
        t.newestEp = d.new_ep || {};
        t.mediaRating = d.rating || {};
        t.payPack = d.pay_pack || {};
        t.payMent = d.payment || {};
        t.activity = d.activity_dialog || {};
        t.epStat = this.setEpStat(t.epInfo.episode_status || t.mediaInfo.season_status, t.userStat.pay, t.userStat.payPackPaid, t.loginInfo);
        t.epId = Number(this.epid || t.epInfo.ep_id);
        this.ssid = t.ssId;
        this.epid = t.epId;
        this.th = true;
        xhrHook("api.bilibili.com/pgc/web/season/stat", undefined, (res) => {
            const t_1 = `{"code": 0,"message":"0","ttl":1,"result":${JSON.stringify(d.stat)}}`;
            res.responseType === "json" ? res.response = JSON.parse(t_1) : res.response = res.responseText = t_1;
        }, false);
        this.player();
        toast.warning("这大概是一个泰区专属Bangumi，可能没有弹幕和评论区，可以使用【在线弹幕】【播放本地文件】等功能载入弹幕~", "另外：播放泰区番剧还可能导致历史记录错乱，请多担待🤣");
        const title = this.setTitle(t.epInfo.index, t.mediaInfo.title, this.Q(t.mediaInfo.season_type), !0);
        function loopTitle() {
            poll(() => document.title != title, () => {
                document.title = title;
                if (document.title != title)
                    loopTitle();
            });
        }
        loopTitle();
        // 记录视频数据
        videoInfo.bangumiEpisode(episodes, i.title, i.actor?.info, i.cover, t.mediaInfo.bkg_cover);
    }
    /** 修复泰区player接口 */
    protected player() {
        xhrHook.async('api.bilibili.com/x/player/v2?', undefined, async (args) => {
            const obj = urlObj(args[1]);
            const aid = <number>obj.aid;
            const cid = <number>obj.cid;
            const response = { code: 0, message: "0", data: new PlayerResponse(aid, cid) };
            if (this.subtitles[cid]) {
                response.data.subtitle.subtitles = this.subtitles[cid]
            }
            return { response, responseType: 'json', responseText: JSON.stringify(response) }
        }, false);
    }
    /** 点赞功能 */
    protected enLike() {
        if (user.userStatus!.like) {
            poll(() => document.querySelector<HTMLSpanElement>('#bangumi_header > div.header-info > div.count-wrapper.clearfix > div.bangumi-coin-wrap'), d => {
                d.parentElement?.insertBefore(this.like, d);
                addCss('.ulike {margin-left: 15px;position: relative;float: left;height: 100%;line-height: 18px;font-size: 12px;color: #222;}', 'ulike-bangumi');
            });
            xhrHook('pgc/web/season/stat?', undefined, async res => {
                try {
                    const result = typeof res.response === 'string' ? jsonCheck(res.response) : res.response;
                    this.like.likes = result.result.likes;
                } catch { }
            });
            switchVideo(() => {
                this.like.init();
            })
        }
    }
    private episodeIndex = 0;
    /** 分集数据 */
    protected episodeData() {
        if (user.userStatus!.episodeData) {
            switchVideo(() => {
                this.episodeIndex++;
                const views = document.querySelector<HTMLSpanElement>(".view-count > span");
                const danmakus = document.querySelector<HTMLSpanElement>(".danmu-count > span");
                if (views && danmakus) {
                    if (this.episodeIndex === 1) {
                        const [view, danmaku] = [
                            unitFormat((<any>window).__INITIAL_STATE__.mediaInfo.stat.views),
                            unitFormat((<any>window).__INITIAL_STATE__.mediaInfo.stat.danmakus)
                        ];
                        // 首p时辈分总播放数和总弹幕数
                        views.setAttribute("title", "总播放数 " + view);
                        danmakus.setAttribute("title", "总弹幕数 " + danmaku);
                        debug.log("总播放数：", view, "总弹幕数", danmaku);
                    }
                    apiViewDetail(BLOD.aid)
                        .then(({ View }) => {
                            views.textContent = unitFormat(View.stat.view);
                            danmakus.textContent = unitFormat(View.stat.danmaku);
                            debug.log("播放数：", View.stat.view, "弹幕数", View.stat.danmaku);
                        })
                        .catch(e => {
                            debug.error('分集数据', e)
                        })
                }
            });
        }
    }
    /** 页面死循环检查 */
    protected reloadCheck() {
        function reload() {
            if (document.title === 'Application error: a client-side exception has occurred') {
                alert('新版页面出现死循环，CPU占用飙升，尝试刷新页面解决？', '死循环', [
                    {
                        text: '刷新',
                        callback: () => {
                            location.reload();
                        }
                    }
                ])
            }
        }
        if (document.readyState === 'complete') {
            reload();
        } else {
            window.addEventListener('load', reload, { once: true });
        }
    }
    protected loadedCallback() {
        super.loadedCallback();
        this.reloadCheck();
    }
}

interface EPINFO {
    aid: number;
    cid: number;
    cover: string;
    duration: number;
    ep_id: number;
    episode_status: number;
    from: string;
    index: string;
    index_title: string;
    mid: number;
    page: number;
    pub_real_time: string;
    section_id: number;
    section_type: number;
    vid: string;
}
interface MEDIAINFO {
    actors: string;
    alias: string;
    areas: MEDIAINFO_CORE['areas'];
    bkg_cover?: string;
    cover: string;
    evaluate: string;
    is_paster_ads: number;
    jp_title: string;
    link: string;
    media_id: number
    mode: number
    paster_text: string;
    season_id: number
    season_status: number
    season_title: string;
    season_type: number
    series_title: string;
    square_cover: string;
    staff: string;
    stat: EPINFO_CORE['stat']
    style: string[];
    title: string;
    total_ep: number
}
interface INITIAL_STATE {
    activity: {}
    app: boolean;
    area: number;
    canReview: boolean;
    epId: number;
    epInfo: EPINFO;
    epList: EPINFO[];
    isPlayerTrigger: boolean;
    loginInfo: { isLogin: boolean; };
    mdId: number;
    mediaInfo: MEDIAINFO;
    mediaRating: { count: number; score: number; };
    miniOn: boolean;
    newestEp: { desc: string; id: number; index: string; is_new: number; pub_real_time?: string; };
    paster: {};
    payMent: {};
    payPack: {};
    playerRecomList: [];
    pubInfo: { is_finish: number; is_started: number; pub_time: string; pub_time_show: string; weekday: number; };
    recomList: [];
    rightsInfo: {
        allow_bp: number;
        allow_download: number;
        allow_review: number;
        copyright: string;
        is_preview: number;
        watch_platform: number;
    };
    seasonFollowed: boolean;
    seasonList: (INITIAL_STATE_CORE['ssList'][0] & { season_title: string; title: string })[];
    seasonStat: { views: number; danmakus: number; coins: number; favorites: number; };
    special: boolean;
    spending: number;
    sponsorTotal: {
        code: number;
        result: {
            ep_bp: number;
            list: [];
            mine: {};
            users: number;
        }
    };
    sponsorTotalCount: number;
    sponsorWeek: INITIAL_STATE['sponsorTotal'];
    ssId: number;
    upInfo: MEDIAINFO_CORE['up_info'];
    userCoined: boolean;
    userLongReview: {};
    userScore: number;
    userShortReview: {};
    userStat: {
        error: boolean;
        follow: number;
        loaded: boolean;
        pay: number;
        payPackPaid: number;
        sponsor: number;
        vipInfo: { due_date: number; status: number; type: number; };
        watchProgress: { lastEpId: string; lastEpIndex: string; lastTime: number; };
    };
    ver: {};
}

interface EPINFO_CORE {
    aid: number;
    badge: string;
    badgeColor: string;
    badgeType: number;
    badge_info: { bg_color: string; bg_color_night: string; text: string; };
    badge_type: number;
    bvid: string;
    cid: number;
    cover: string;
    dimension: { height: number; rotate: number; width: number; };
    duration: number;
    epStatus: number;
    from: string;
    hasNext: boolean;
    hasSkip: boolean;
    i: number;
    id: number;
    is_view_hide: boolean;
    link: string;
    loaded: boolean;
    longTitle: string;
    long_title: string;
    orderSectionIds: [];
    pub_time: number;
    pv: number;
    releaseDate: string;
    release_date: string;
    rights: { allow_demand: number; allow_dm: number; allow_download: number; area_limit: number; };
    sectionType: number;
    share_copy: string;
    share_url: string;
    short_link: string;
    skip: Record<'op' | 'ed', { end: number, start: number }>;
    stat: {};
    status: number;
    subtitle: string;
    title: string;
    titleFormat: string;
    vid: string;
}
interface MEDIAINFO_CORE {
    activity: { id: number; title: string; pendantOpsImg: string; pendantOpsLink: string; };
    alias: string;
    areas: { id: number; name: string }[];
    bkg_cover: string;
    count: { coins: number; danmus: number; follows: number; views: number; likes: number; };
    cover: string;
    epSpMode: boolean;
    episodes: EPINFO_CORE[];
    evaluate: string;
    forceWide: boolean;
    freya: { bubble_desc: string; bubble_show_cnt: number; icon_show: number; };
    id: number;
    jpTitle: string;
    jp_title: string;
    link: string;
    mainSecTitle: string;
    media_id: number;
    mode: number;
    multiMode: boolean;
    newEpSpMode: boolean;
    new_ep: { desc: string; id: number; is_new: number; title: string; };
    newestEp: { id: string; desc: string; isNew: boolean; };
    payMent: {
        discount: number;
        price: string;
        promotion: string;
        sixType: { allowTicket: boolean; allowTimeLimit: boolean; allowDiscount: boolean; allowVipDiscount: boolean; };
        tip: string;
        vipDiscount: number;
        vipFirstProm: string;
        vipProm: string;
    };
    payPack: { title: string; appNoPayText: string; appPayText: string; url: string; };
    payment: {
        discount: number;
        pay_type: {
            allow_discount: number;
            allow_pack: number;
            allow_ticket: number;
            allow_time_limit: number;
            allow_vip_discount: number;
            forbid_bb: number;
        };
        price: string;
        promotion: string;
        tip: string;
        view_start_time: number;
        vip_discount: number;
        vip_first_promotion: string;
        vip_promotion: string;
    };
    pgcType: string;
    playerRecord: string;
    positive: { id: number; title: string; };
    premiereInfo: {};
    pub: { time: string; timeShow: string; isStart: true, isFinish: boolean; unknow: boolean; };
    publish: {
        is_finish: number;
        is_started: number;
        pub_time: string;
        pub_time_show: string;
        unknow_pub_date: number;
        weekday: number;
    };
    rating: { score: number; count: number; };
    record: string;
    rights: {
        allowBp: boolean;
        allowBpRank: boolean;
        allowReview: boolean;
        appOnly: boolean;
        area_limit: number;
        canWatch: boolean;
        copyright: string;
        isCoverShow: boolean;
        isPreview: boolean;
        limitNotFound: boolean;
    };
    season_id: number;
    season_title: string;
    seasons: {
        badge: string;
        badge_info: { bg_color: string; bg_color_night: string; text: string; };
        badge_type: number;
        cover: string;
        horizontal_cover_169: string;
        horizontal_cover_1610: string;
        media_id: number;
        new_ep: { cover: string; id: number; index_show: string; };
        season_id: number;
        season_title: string;
        season_type: number;
        stat: { favorites: number; series_follow: number; views: number; };
    }[];
    section: {
        attr: number;
        episode_id: number;
        episode_ids: number[]
        episodes: EPINFO_CORE[];
        id: number;
        title: string;
        type: number;
    }[];
    sectionBottomDesc: string;
    series: string;
    share_copy: string;
    share_sub_title: string;
    share_url: string;
    show: { wide_screen: number; };
    show_season_type: number;
    specialCover: string;
    squareCover: string;
    square_cover: string;
    ssId: number;
    ssType: number;
    ssTypeFormat: { name: number; homeLink: number; };
    stat: {
        coins: number;
        danmakus: number;
        favorite: number;
        favorites: number;
        likes: number;
        reply: number;
        share: number;
        views: number;
    };
    status: number;
    subtitle: string;
    title: string;
    total: number;
    type: number;
    upInfo: {
        avatar: string;
        isAnnualVip: boolean;
        mid: number;
        name: string;
        nickname_color: string;
        pendantId: number;
        pendantImage: string;
        pendantName: string;
        vip_status: number;
        vip_type: number;
    };
    up_info: {
        avatar: string;
        avatar_subscript_url: string;
        follower: number;
        is_follow: number;
        mid: number;
        nickname_color: string;
        pendant: { image: string; name: string; pid: number; };
        theme_type: number;
        uname: string;
        verify_type: number;
        vip_label: { bg_color: string; bg_style: number; border_color: string; text: string; text_color: string; };
        vip_status: number;
        vip_type: number;
    };
    user_status: {
        area_limit: number;
        ban_area_show: number;
        follow: number;
        follow_status: number;
        login: number;
        pay: number;
        pay_pack_paid: number;
        sponsor: number;
        vip_info: { due_date: number; status: number; type: number; };
    };
}
interface INITIAL_STATE_CORE {
    angleAnimationShow: boolean;
    couponSelected: unknown;
    epCoupon: unknown;
    epInfo: EPINFO_CORE;
    epList: EPINFO_CORE[];
    epMap: Record<EPINFO_CORE['id'], EPINFO_CORE>;
    epPayMent: unknown;
    fromSpmId: string;
    h1Title: string;
    hasPlayableEp: boolean;
    initEpList: EPINFO_CORE[];
    insertScripts: string[];
    interact: { shown: false, btnText: '', callback: null };
    isLogin: boolean;
    isOriginal: boolean;
    lastVideoTime: number;
    likeMap: unknown;
    loaded: boolean;
    loginInfo: unknown;
    mediaInfo: MEDIAINFO_CORE;
    nextEp: unknown;
    orderSectionIds: number[];
    payGlobal: unknown;
    player: { loaded: boolean; miniOn: boolean; limitType: number; };
    playerEpList: {
        code: number;
        message: string;
        result: {
            main_section: {
                episodes: EPINFO_CORE
            }
        }
    };
    premiereCountDown: string;
    premiereEp: unknown;
    premiereStatus: unknown;
    sections: {
        epList: EPINFO_CORE[];
        episodeIds: number[];
        id: number;
        title: string;
        type: number;
    }[];
    sectionsMap: Record<number, INITIAL_STATE_CORE['sections'][0]>;
    showBv: boolean;
    sponsor: {
        allCount: number;
        allMine: unknown;
        allRank: [];
        allReady: boolean;
        allState: number;
        weekCount: number;
        weekMine: unknown;
        weekRank: [];
        weekReady: boolean;
        weekState: number;
    };
    ssList: {
        badge: string;
        badgeColor: string;
        badgeType: number;
        cover: string;
        desc: string;
        epCover: string;
        follows: number;
        id: number;
        pgcType: string;
        title: string;
        type: number;
        views: number;
    }[];
    ssPayMent: unknown;
    ssRecom: { status: string; data: [] };
    ssr: unknown;
    updateSectionList: boolean;
    uperMap: unknown;
    userState: {
        loaded: boolean;
        vipInfo: {};
        history: {};
    };
    ver: unknown;
    videoStatus: string;
    viewAngle: string;
    webPlayer: unknown;
}
interface PGC_USERSTATE {
    area_limit: number;
    ban_area_show: number;
    dialog: { btn_right: { title: string; type: string; }; desc: string; title: string; };
    follow: number;
    follow_status: number;
    login: number;
    paster: {
        aid: number;
        allow_jump: number;
        cid: number;
        duration: number;
        type: number;
        url: string;
    };
    pay: number;
    pay_pack_paid: number;
    progress?: {
        last_ep_id: number;
        last_ep_index: string;
        last_time: number;
    }
    real_price: string;
    sponsor: number;
    vip_info: { due_date: number; status: number; type: number; };
}