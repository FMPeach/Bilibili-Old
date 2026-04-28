import { BLOD } from "../core/bilibili-old";
import { Comment } from "../core/comment";
import { switchVideo } from "../core/observer";
import { player } from "../core/player";
import { toast } from "../core/toast";
import { Like } from "../core/ui/like";
import { urlCleaner } from "../core/url";
import { user } from "../core/user";
import { videoInfo } from "../core/video-info";
import cssUplist from '../css/uplist.css';
import html from '../html/list.html';
import { IAidInfo, IStaf, jsonCheck } from "../io/api";
import { apiArticleCards } from "../io/api-article-cards";
import { apiBiliplusView } from "../io/api-biliplus-view";
import { apiRelation } from "../io/api-relation";
import { apiViewDetail, ApiViewDetail } from "../io/api-view-detail";
import menuConfig from '../json/sort.txt';
import toview from '../json/toview.json';
import { AV } from "../utils/av";
import { addCss } from "../utils/element";
import { objUrl, urlObj } from "../utils/format/url";
import { propertyHook } from "../utils/hook/method";
import { jsonpHook } from "../utils/hook/node";
import { webpackHook } from "../utils/hook/webpack";
import { xhrHook } from "../utils/hook/xhr";
import { poll } from "../utils/poll";
import { Scrollbar } from "../utils/scrollbar";
import { PageBangumi } from "./bangumi";
import { Header } from "./header";
import { Page } from "./page";

/**
 * /list/ 页面处理器
 *
 * 将 /list/{uid}（UP主投稿列表"播放全部"）和 /list/ml{id}（收藏夹"播放全部"）
 * 重写为旧版AV页，并通过播单数据注入实现列表连续播放。
 *
 * 参照 av.ts 的 ugcSection() 方法，将列表数据以 toview 格式注入播放器启动参数，
 * 从而在播放器右侧面板中显示播放列表，支持列表内切换视频。
 *
 * 相比原 PagePlaylist 的播单模拟方案，此方案不依赖旧版播单页面的 JSONP 初始化流程，
 * 避免了"当前视频不在此播单"等错误。
 */
export class PageList extends Page {

    /** 销毁标记 */
    protected destroy = false;

    protected like: Like;

    protected webpackJsonp = true;

    /** 原始URL查询参数 */
    protected route: Record<string, string | number>;

    /** 是否来自列表页面 */
    protected isFromList = false;

    /** UP主uid（用于构建URL） */
    protected upUid: number = 0;

    /** Series/Collection ID（sid） */
    protected seriesId: number = 0;

    /** 列表ID（uid 或 medialist 数字id） */
    protected listId: number = 0;

    /** 列表播放器类型（对应 medialist resource API 的 type 参数） */
    protected listType: number = 1;

    /** 是否ml类型（收藏夹） */
    protected isMl = false;

    /** 列表数据是否已就绪 */
    protected listDataReady = false;

    /** URL是否已修改为列表格式 */
    protected urlUpdated = false;

    /** 合作UP主模式 */
    protected _isStaffMode = false;

    /** 合作UP主卡片容器 */
    protected _staffContainer: HTMLElement | null = null;

    protected get aid() {
        return BLOD.aid;
    }

    protected set aid(v) {
        BLOD.aid = v;
    }

    constructor() {
        super(html);

        this.route = urlObj(location.href);
        this.isFromList = /\/list\//.test(location.pathname); 
        
        // 防止热刷新死循环
        if (/\/video\/av\d+(\?.*)?$/.test(location.pathname)) {
            const match = location.pathname.match(/\/video\/av(\d+)/);
            if (match) {
                this.aid = Number(match[1]);
            }
            const params = new URLSearchParams(location.search);
            if (params.get('sid')) this.route.sid = params.get('sid') || '';
            if (params.get('business')) this.route.business = params.get('business') || '';
            if (params.get('business_id')) this.route.business_id = params.get('business_id') || '';
            if (params.get('tid')) this.route.tid = params.get('tid') || '';
            if (params.get('p')) this.route.p = params.get('p') || '1';
            this.parseListInfo();
            if (this.route.sid || this.route.business || this.listId) {
                this.isFromList = true;
            }
        } else {
            const params = new URLSearchParams(location.search);
            if (params.get('p')) {
                this.route.p = params.get('p') || '1';
            }
            this.parseListInfo();
            this.extractAid();
        }
        
        this.like = new Like();

        new Comment();
        propertyHook(window, '__INITIAL_STATE__', undefined);
        propertyHook(window, '__playinfo__', undefined);

        // ======== AV页基础功能 ========
        this.enLike();
        this.aidLostCheck();
        this.favCode();
        this.tagTopic();
        this.menuConfig();
        this.ancientHeader();
        this.hyperLink();
        this.embedPlayer();
        this.elecShow();
        this.biliUIcomponents();
        this.crumbFirstLink();
        this.exp();
        Header.primaryMenu();
        Header.banner();

        // ======== 列表播放初始化（异步） ========
        this.initList();
    }

    // ===================================================================
    //  列表相关方法
    // ===================================================================

    /** 解析列表URL，确定listId和listType */
    protected parseListInfo() {
        const href = BLOD.path.join('/');

        // /list/ml{id} — 收藏夹
        const mlMatch = href.match(/\/list\/ml(\d+)/);
        if (mlMatch) {
            this.isMl = true;
            this.listId = Number(mlMatch[1]);
            this.listType = 3; // 收藏夹/播单默认type
        } else {
            // /list/{uid} — UP主投稿列表或其他列表
            const uidMatch = href.match(/\/list\/(\d+)/);
            if (uidMatch) {
                this.upUid = Number(uidMatch[1]); // 保存UP主uid
                this.listId = Number(uidMatch[1]);
                this.listType = 1; // 默认为space类型
            }
        }

        // 检测 sid 参数（UP主自建视频列表/合集）
        // 对于series，biz_id应该是uid，sid作为额外参数
        if (this.route.sid) {
            this.listType = 5; // space_series
            this.seriesId = Number(this.route.sid);
            // listId 保持为 uid（如果已解析）或用upUid
            if (!this.listId) {
                this.listId = this.upUid;
            }
        }

        // 如果有business参数则按business覆盖
        if (this.route.business) {
            switch (this.route.business) {
                case "space":
                    this.listType = 1;
                    break;
                case "space_series":
                    this.listType = 5;
                    this.listId = Number(this.route.business_id) || this.listId;
                    break;
                case "space_channel":
                    this.listType = 6;
                    break;
                case "space_collection":
                    this.listType = 8;
                    this.listId = Number(this.route.business_id) || this.listId;
                    break;
            }
        }
    }

    protected extractAid() {    
        if (this.route.aid && Number(this.route.aid)) {
            this.aid = Number(this.route.aid);
        } else if (this.route.bvid) {
            this.aid = Number(AV.fromBV(String(this.route.bvid)));
        } else if (this.route.oid && Number(this.route.oid)) {
            this.aid = Number(this.route.oid);
        }


        if (this.aid) {
            const params: Record<string, string | number> = {};
            if (this.route.sid) params.sid = this.route.sid;
            if (this.route.business) params.business = this.route.business;
            if (this.route.business_id) params.business_id = this.route.business_id;
            if (this.route.tid) params.tid = this.route.tid;
            if (this.route.p && this.route.p !== '1') {
                params.p = this.route.p;
            }
            const queryString = Object.keys(params).length > 0
                ? '?' + Object.entries(params).map(([k, v]) => `${k}=${v}`).join('&')
                : '';
            history.replaceState(history.state, '', `https://www.bilibili.com/video/av${this.aid}${queryString}`);
        }
    }

    /**
     * 列表播放初始化（异步）
     *
     * 流程：
     * 1. 注册播单数据注入回调（同步，在播放器启动前完成）
     * 2. 注册切P回调
     * 3. 获取列表数据（异步）
     * 4. 替换DOM（等待数据获取完成，确保播放器启动时数据已就绪）
     */
    protected async initList() {
        // 注册播单数据注入回调
        // 当播放器启动（EmbedPlayer）时，此回调将 toview 数据以 playlist 参数注入启动命令
        player.addModifyArgument(args => {
            if (this.destroy) return;
            if (!this.listDataReady) return;

            console.log('player.addModifyArgument: before updateListUrl', { 
                urlUpdated: this.urlUpdated, 
                isFromList: this.isFromList, 
                aid: this.aid,
                isMl: this.isMl,
                listType: this.listType,
                listId: this.listId,
                upUid: this.upUid,
                seriesId: this.seriesId
            });

            // 播放器第一次初始化时，修改URL为列表格式
            if (!this.urlUpdated && this.isFromList) {
                this.updateListUrl(this.aid);
                this.urlUpdated = true;
            }

            // 将分P信息注入URL，确保刷新后仍能定位到正确的分P
            const obj = urlObj(`?${args[2]}`);
            if (this.route.p && this.route.p !== '1') {
                obj.p = this.route.p;
            }
            obj.playlist = <any>encodeURIComponent(JSON.stringify({ code: 0, data: toview, message: "0", ttl: 1 }));
            args[2] = objUrl('', obj);
        });

        // 注册切P回调（播单面板点击切换视频时触发）
        propertyHook(window, 'callAppointPart', this.callAppointPart);

        // 获取列表数据
        try {
            await this.fetchListData();
        } catch (e) {
            console.error('fetchListData error:', e);
            toast.warning('获取列表数据失败，仅播放当前视频')();
        }

        // 如果URL没有提供aid但成功拿到了列表，则用第一个视频
        if (!this.aid && this.listDataReady && toview.list.length > 0) {
            this.aid = (<any>toview.list[0]).aid;
            if (this.aid) {
                urlCleaner.updateLocation(`https://www.bilibili.com/video/av${this.aid}`);
            }
        }

        if (!this.aid) {
            toast.error('无法获取视频信息，页面可能无法正常显示')();
        }

        // 替换DOM（此时列表数据已就绪，旧版页面脚本加载后播放器将读取到完整的播单数据）
        this.updateDom();

        // 播单面板样式（延迟到DOM加载完成后注入，避免被播放器脚本覆盖）
        addCss(
            '.bilibili-player .bilibili-player-auxiliary-area .bilibili-player-playlist .bilibili-player-playlist-playlist {height: calc(100% - 45px);}' +
            '.bilibili-player-playlist-nav-title,.bilibili-player-playlist-nav-ownername{display: none;}' +
            '#v_multipage{display:none!important;}',
            'list-playlist'
        );
    }

    /** 通过 medialist resource API 获取列表数据 */
    protected async fetchListData() {
        const baseParams: Record<string, any> = {
            type: this.listType,
            biz_id: this.listId,
            otype: 2,
            ps: 100,
            direction: false,
            sort_field: 1,
            tid: this.route.tid || 0,
        };

        // 对于series (type=5)，使用 sid 作为 biz_id
        if (this.listType === 5 && this.seriesId) {
            baseParams.biz_id = this.seriesId;
        }

        let allMediaList: IAidInfo[] = [];
        let pn = 1;
        let hasMore = true;
        let lastItemId = 0;

        while (hasMore) {
            const params: Record<string, any> = { ...baseParams, pn };
            
            if (pn === 1) {
                // 仅当 URL 没有指定 oid 时，使用 with_current 定位当前视频
                // 如果指定了 oid，应该从列表开头开始获取完整数据
                if (!this.route.oid && !this.route.bvid) {
                    params.with_current = true;
                    if (this.aid) params.oid = this.aid;
                }
            } else {
                // 后续页使用上一页最后一个项目的 id 作为游标
                params.oid = lastItemId;
            }

            const url = objUrl('https://api.bilibili.com/x/v2/medialist/resource/list', params);
            const response = await fetch(url, { credentials: 'include' });
            const json = await response.json();
            const data = jsonCheck(json);

            if (data.data?.media_list?.length) {
                // 游标分页时，第一项会与上一页最后一项重复，跳过它
                const itemsToAdd = pn === 1 ? data.data.media_list : data.data.media_list.slice(1);
                
                allMediaList.push(...itemsToAdd);
                
                // 记录视频信息（用于播放器元数据展示）
                itemsToAdd.forEach((d: IAidInfo) => {
                    videoInfo.aidInfo(d);
                });
                
                // 保存最后一项的 id 用于下一页请求（游标分页）
                lastItemId = data.data.media_list[data.data.media_list.length - 1].id;
                
                // 使用 API 返回的 has_more 字段判断是否有下一页
                hasMore = data.data?.has_more === true;
                pn++;
            } else {
                hasMore = false;
            }
        }

        if (allMediaList.length > 0) {
            this.populateToview(allMediaList);
            this.listDataReady = true;
        }
    }

    /** 将 medialist API 返回的 IAidInfo[] 转换为 toview（旧版播单）格式 */
    protected populateToview(mediaList: IAidInfo[]) {
        const firstItem = mediaList[0];

        toview.cover = firstItem?.cover || '';
        toview.count = mediaList.length;
        toview.id = this.listId;
        toview.description = '';
        toview.mid = firstItem?.upper?.mid || this.listId;
        toview.type = this.listType;
        toview.state = 0;
        toview.pid = -1; // 隐藏播单号
        toview.stat.favorite = 0;
        toview.stat.reply = 0;
        toview.stat.share = 0;
        toview.stat.view = 0;

        // 播单标题
        (<any>toview).name = this.isMl
            ? '收藏夹播放列表'
            : (firstItem?.upper?.name ? `${firstItem.upper.name} 的投稿` : '播放列表');

        // 将 IAidInfo 转为旧版 toview.list 条目格式
        toview.list = <any>mediaList.map((item: IAidInfo) => {
            const pages = (item.pages || []).map(p => ({
                cid: p.id,
                dimension: p.dimension || { width: 1920, height: 1080, rotate: 0 },
                duration: p.duration || 0,
                from: p.from || 'vupload',
                page: p.page || 1,
                part: p.title || '',
                vid: '',
                weblink: p.link || ''
            }));

            return {
                aid: item.id,
                attribute: item.attr || 0,
                cid: item.pages?.[0]?.id || 0,
                copyright: item.copy_right || 1,
                ctime: item.pubtime || 0,
                desc: item.intro || '',
                dimension: item.pages?.[0]?.dimension || { width: 1920, height: 1080, rotate: 0 },
                duration: item.duration || 0,
                dynamic: '',
                owner: {
                    face: item.upper?.face || '',
                    mid: item.upper?.mid || 0,
                    name: item.upper?.name || ''
                },
                pages,
                pic: item.cover || '',
                pubdate: item.pubtime || 0,
                rights: item.rights || {},
                stat: {
                    view: item.cnt_info?.play || 0,
                    danmaku: item.cnt_info?.danmaku || 0,
                    reply: item.cnt_info?.reply || 0,
                    favorite: item.cnt_info?.collect || 0,
                    coin: item.cnt_info?.coin || 0,
                    share: item.cnt_info?.share || 0,
                    like: item.cnt_info?.thumb_up || 0,
                    now_rank: 0,
                    his_rank: 0,
                    evaluation: '',
                    aid: item.id,
                    dislike: 0,
                    follow: 0,
                    series_follow: 0
                },
                state: 0,
                tid: item.tid || 0,
                title: item.title || '',
                tname: '',
                videos: pages.length || 1,
            };
        });

        videoInfo.toview(toview);
    }

    /**
     * 构建列表格式的URL并修改地址栏
     * 格式：
     * - 收藏夹：/list/ml{id}?oid={aid}
     * - UP主投稿：/list/{uid}?oid={aid}
     * - UP主播放列表：/list/{uid}?sid={sid}&oid={aid}
     */
    protected updateListUrl(aid: number) {
        if (!this.isFromList || !aid) return;

        let baseUrl: string;
        let params: Record<string, string | number> = { oid: aid };

        if (this.isMl) {
            // 收藏夹：/list/ml{id}
            baseUrl = `/list/ml${this.listId}`;
        } else if (this.listType === 5 && this.seriesId) {
            // UP主series/合集：/list/{uid}?sid={sid}&oid={aid}
            baseUrl = `/list/${this.upUid}`;
            params.sid = this.seriesId;
        } else {
            // UP主投稿：/list/{uid}
            baseUrl = `/list/${this.upUid || this.listId}`;
        }

        // 保留 p 参数（分P信息）
        if (this.route.p && this.route.p !== '1') {
            params.p = this.route.p;
        }

        const newUrl = objUrl(baseUrl, params);
        history.replaceState(history.state, '', newUrl);
    }

    /** 播单内切换视频回调（由播放器播单面板触发） */
    protected callAppointPart = (p: number, state: Record<'aid' | 'cid', number>) => {
        if (this.destroy) return Reflect.deleteProperty(window, 'callAppointPart');

        const vue = document.querySelector<any>("#app")?.__vue__;
        if (vue) {
            // 通过修改Vue组件的aid来刷新评论和标签
            vue.$store.state.aid = state.aid;

            // 获取新视频的详情并更新页面各个组件
            apiViewDetail(state.aid)
                .then(d => {
                    // 简介、标题、视频统计
                    vue.setVideoData(d.View);
                    // 下方视频推荐
                    document.querySelector<any>('#recommend_report')?.__vue__?.init(d.Related);
                    // 标签
                    try {
                        document.querySelector<any>('#v_tag').__vue__.$data.tags = d.Tags;
                    } catch { }
                    // 记录视频数据
                    videoInfo.aidDatail(d.View);
                    // 更新UP主信息
                    if (user.userStatus?.staff && d.View.staff) {
                        this.updateStaff(d.View.staff as unknown as IStaf[]);
                    } else {
                        const newMid = d.Card.card?.mid;
                        if (newMid) {
                            vue.mid = String(newMid);
                        }
                        vue.$store.commit('setUpData', { ...d.Card.card, archiveCount: d.Card.archive_count });
                        // 刷新充电按钮状态（异步，等回调完成后再强制更新UI）
                        vue.getElecState();
                        vue.$nextTick(() => vue.$forceUpdate());
                    }
                })
                .catch(e => {
                    toast.error('更新视频信息失败', e)();
                })
                .finally(() => {
                    if (this.isFromList) {
                        // 保存当前分P到route，供updateListUrl使用
                        this.route.p = p > 1 ? String(p) : '1';
                        // 来自列表页面：修改为列表格式的URL，保留当前分P
                        this.updateListUrl(state.aid);
                    } else {
                        // 普通播放：使用标准AV页URL
                        const pParam = p && p > 1 ? `/?p=${p}` : '';
                        history.pushState(history.state, '', `/video/av${state.aid}${pParam}`);
                    }
                });
        }
    }

    /** 合作UP切单UP主 */
    protected _switchToSingleUp(up: any) {
        const upinfo = document.querySelector<HTMLDivElement>('#v_upinfo');
        const staffContainer = document.querySelector<HTMLElement>('#v_upinfo_staff');

        if (staffContainer) {
            staffContainer.style.display = 'none';
        }

        if (upinfo) {
            upinfo.style.display = '';
        }
    }

    /** 合作UP主卡片 */
    protected updateStaff(staff: IStaf[]) {
        const upinfo = document.querySelector<HTMLDivElement>('#v_upinfo');
        if (!upinfo) return;
        this._isStaffMode = true;
        // 隐藏原始 UpInfo Vue 组件（实例保留）
        upinfo.style.display = 'none';
        // 创建或显示合作UP卡片容器
        let container = document.querySelector<HTMLElement>('#v_upinfo_staff');
        if (!container) {
            container = document.createElement('div');
            container.id = 'v_upinfo_staff';
            container.className = 'up-info-m report-wrap-module report-scroll-module';
            upinfo.parentNode?.insertBefore(container, upinfo.nextSibling);
            addCss(cssUplist, "up-list");
        }

        let html = '<span class="title">UP主列表</span><div class="up-card-box">';
        html = staff.reduce((s, d) => {
            return s + `<div class="up-card">
                <a href="//space.bilibili.com/${d.mid}" data-usercard-mid="${d.mid}" target="_blank" class="avatar">
                <img src="${d.face}@48w_48h.webp" /><!---->
                <span class="info-tag">${d.title}</span><!----></a>
                <div class="avatar">
                <a href="//space.bilibili.com/${d.mid}" data-usercard-mid="${d.mid}" target="_blank" class="${(d.vip && d.vip.status) ? 'name-text is-vip' : 'name-text'}">${d.name}</a>
                </div></div>`;
        }, html) + `</div>`;
        container.innerHTML = html;
        container.style.display = '';

        const box = container.querySelector<HTMLElement>('.up-card-box');
        box && new Scrollbar(box, true, false);
    }

    /** 单UP主模式 */
    protected updateUpInfo(card: any, view?: any) {
        if (!card?.card) return;

        const upinfo = document.querySelector<HTMLDivElement>('#v_upinfo');
        if (!upinfo) return;

        // 合作UP主切单UP
        if (this._isStaffMode) {
            this._switchToSingleUp(card.card);
            this._isStaffMode = false;
        }

        // 面包屑UP主链接更新
        try {
            const crumbEl = document.querySelector<HTMLAnchorElement>('.crumb .a-crumbs a[href*="space.bilibili.com"], .video-info-m .a-crumbs a[href*="space.bilibili.com"]');
            if (crumbEl && card.card.mid) {
                crumbEl.href = `//space.bilibili.com/${card.card.mid}`;
                crumbEl.textContent = card.card.name;
            }
        } catch { }
    }

    // ===================================================================
    //  AV页基础功能（复制自 PageAV，保证旧版视频页正常工作）
    // ===================================================================

    /**
     * 暴露UI组件
     * 717 -> video.b1b7706abd590dd295794f540f7669a5d8d978b3.js
     */
    protected biliUIcomponents() {
        webpackHook(717, 274, (code: string) => code
            .replace("this.getAdData()", "this.getAdData")
            .replace('ut.MenuConfig[e].name', 'ut.MenuConfig[e].name,url:ut.MenuConfig[e].url,subUrl: ut.MenuConfig[e].sub[a].url')
        );
    }

    /** 修复分区列表 */
    protected crumbFirstLink() {
        webpackHook(717, 271, (code: string) => code
            .replace(/breadCrumbFirstLink:[\S\s]+?breadCrumbSecondName:/, 'breadCrumbFirstLink:function() {return this.breadcrumb.url},breadCrumbSecondName:')
            .replace(/breadCrumbSecondLink:[\S\s]+?coined:/, 'breadCrumbSecondLink:function() {return this.breadcrumb.subUrl},coined:')
        );
    }

    /** 修复收藏夹弹窗bug */
    protected favCode() {
        webpackHook(717, 251, (code: string) => code.replace("e[0].code", "e.code").replace("i[0].code", "i.code"));
    }

    /** 修复视频标签链接 */
    protected tagTopic() {
        webpackHook(717, 660, code => code.replace('tag/"+t.info.tag_id+"/?pagetype=videopage', 'topic/"+t.info.tag_id+"/?pagetype=videopage'));
    }

    /** 修复视频分区 */
    protected menuConfig() {
        webpackHook(717, 100, code => code.replace(/MenuConfig[\S\s]+?LiveMenuConfig/, `MenuConfig=${menuConfig},e.LiveMenuConfig`));
    }

    /** 移除上古顶栏 */
    protected ancientHeader() {
        webpackHook(717, 609, () => `()=>{}`);
    }

    /** 修复超链接跳转 */
    protected hyperLink() {
        webpackHook(717, 2, code => code.replace("av$1</a>')", `av$1</a>').replace(/(?!<a[^>]*>)cv([0-9]+)(?![^<]*<\\/a>)/ig, '<a href="//www.bilibili.com/read/cv$1/" target="_blank" data-view="$1">cv$1</a>').replace(/(?!<a[^>]*>)(bv1)(\\w{9})(?![^<]*<\\/a>)/ig, '<a href="//www.bilibili.com/video/bv1$2/" target="_blank">$1$2</a>')`).replace("http://acg.tv/sm", "https://www.nicovideo.jp/watch/sm"));
    }

    /** 添加播放器启动代码 */
    protected embedPlayer() {
        webpackHook(717, 286, code => code.replace('e("setVideoData",t)', `e("setVideoData",t);$("#bofqi").attr("id","__bofqi").html('<div class="bili-wrapper" id="bofqi"><div id="player_placeholder"></div></div>');new Function('EmbedPlayer',t.embedPlayer)(window.EmbedPlayer);`));
    }

    /** 跳过充电鸣谢 */
    protected elecShow() {
        if (user.userStatus!.elecShow) {
            jsonpHook("api.bilibili.com/x/web-interface/elec/show", undefined, res => {
                try {
                    res.data.av_list = [];
                } catch { }
                return res;
            }, false)
        } else {
            jsonpHook.async("api.bilibili.com/x/web-interface/elec/show", undefined, async () => { return { code: -404 } }, false)
        }
    }

    /**
     * 检查页面是否失效及bangumi跳转
     * 注意：与 PageAV 不同，此处不触发 ugcSection（合集播单由本类自行管理）
     */
    protected aidLostCheck() {
        jsonpHook("api.bilibili.com/x/web-interface/view/detail", undefined, (res, r, call) => {
            if (0 !== res.code) {
                const obj = urlObj(r);
                if (obj.aid) {
                    this.aid = <number>obj.aid;
                    this.getVideoInfo().then(d => call(d)).catch(() => call(res));
                    return true
                }
            } else {
                if (res.data) {
                    if (res.data.View) {
                        const response = `{ "code": 0, "message": "0", "ttl": 1, "data": ${JSON.stringify(res.data.View.stat)} }`;
                        xhrHook.async('/x/web-interface/archive/stat?', undefined, async () => {
                            return { response, responseText: response, responseType: 'json' };
                        });
                        Promise.resolve().then(() => {
                            user.userStatus!.staff && res.data.View.staff && this.staff(res.data.View.staff);
                        });
                        // 不触发 ugcSection —— 列表播放由 initList 管理
                        // 记录视频数据
                        videoInfo.aidDatail(res.data.View);
                    }
                    if (res.data.Related) {
                        const response = JSON.stringify(res.data.Related.map((d: any) => {
                            return [d.pic, d.aid, d.title, d.stat.view, d.stat.danmaku, , d.stat.favorite]
                        }));
                        xhrHook.async('comment.bilibili.com/playtag', undefined, async () => {
                            return { response, responseText: response, responseType: 'json' }
                        }, false);
                    }
                }
            }
        }, false);
    }

    /** 通过其他接口获取aid数据（视频失效时的兜底） */
    protected async getVideoInfo() {
        const msg = toast.list(`av${this.aid}可能无效，尝试其他接口 >>>`);
        try {
            const card = await apiArticleCards({ av: this.aid });
            if (card[`av${this.aid}`]) {
                if (card[`av${this.aid}`].redirect_url) {
                    msg.push(`> bangumi重定向：${card[`av${this.aid}`].redirect_url}`);
                    msg.type = 'warning';
                    setTimeout(() => {
                        urlCleaner.updateLocation(card[`av${this.aid}`].redirect_url!);
                        new PageBangumi();
                        BLOD.flushToast();
                        this.destroy = true;
                        msg.delay = 4;
                    }, 100);
                    return new ApiViewDetail();
                }
            }
            const view = await new apiBiliplusView(this.aid).toDetail();
            if (view?.data.View.season) {
                msg.push(`> bangumi重定向：${(<any>view).data.View.season.ogv_play_url}`);
                msg.type = 'warning';
                view.data.View.season = undefined;
                setTimeout(() => {
                    urlCleaner.updateLocation(card[`av${this.aid}`].redirect_url!);
                    new PageBangumi();
                    BLOD.flushToast();
                    this.destroy = true;
                    msg.delay = 4;
                }, 100);
                return new ApiViewDetail();
            }
            setTimeout(() => {
                videoInfo.aidDatail(view.data.View);
                msg.push('> 获取缓存数据成功！但这可能是个失效视频！');
                msg.type = 'success';
                msg.delay = 4;
            }, 100);
            return view;
        } catch (e) {
            msg.push('> 获取数据出错！', <any>e);
            msg.type = 'error';
            msg.delay = 4;
            throw e;
        }
    }

    /** 合作UP主列表 */
    protected staff(staff: IStaf[]) {
        const upinfo = document.querySelector<HTMLDivElement>('#v_upinfo');
        if (!upinfo) return;

        this._isStaffMode = true;

        // 隐藏原始 UpInfo Vue 组件
        upinfo.style.display = 'none';

        // 创建或显示合作UP卡片容器
        let container = document.querySelector<HTMLElement>('#v_upinfo_staff');
        if (!container) {
            container = document.createElement('div');
            container.id = 'v_upinfo_staff';
            container.className = 'up-info-m report-wrap-module report-scroll-module';
            upinfo.parentNode?.insertBefore(container, upinfo.nextSibling);
            addCss(cssUplist, "up-list");
        }

        let fl = '<span class="title">UP主列表</span><div class="up-card-box">';
        fl = staff.reduce((s, d) => {
            s = s + `<div class="up-card">
                <a href="//space.bilibili.com/${d.mid}" data-usercard-mid="${d.mid}" target="_blank" class="avatar">
                <img src="${d.face}@48w_48h.webp" /><!---->
                <span class="info-tag">${d.title}</span><!----></a>
                <div class="avatar">
                <a href="//space.bilibili.com/${d.mid}" data-usercard-mid="${d.mid}" target="_blank" class="${(d.vip && d.vip.status) ? 'name-text is-vip' : 'name-text'}">${d.name}</a>
                </div></div>`
            return s;
        }, fl) + `</div>`;
        container.innerHTML = fl;
        container.style.display = '';

        const box = container.querySelector<HTMLElement>('.up-card-box');
        box && new Scrollbar(box, true, false);
    }

    /** 点赞功能 */
    protected enLike() {
        if (user.userStatus!.like) {
            poll(() => document.querySelector<HTMLSpanElement>('#viewbox_report > div.number > span.u.coin'), d => {
                if (this.destroy) return this.like.remove();
                d.parentElement?.insertBefore(this.like, d);
                addCss('.video-info-m .number .ulike {margin-left: 15px;margin-right: 5px;}', 'ulike-list');
            });
            const destroy = videoInfo.bindChange(v => {
                if (this.destroy) {
                    destroy();
                    return this.like.remove();
                }
                this.like.likes = v.stat?.like!;
                this.like.init();
            })
        }
    }

    /** 经验值接口 */
    protected exp() {
        xhrHook.async('plus/account/exp.php', undefined, async () => {
            const res = await fetch('https://api.bilibili.com/x/web-interface/coin/today/exp', { credentials: 'include' });
            const json = await res.json();
            json.number = json.data;
            const response = JSON.stringify(json)
            return { response, responseText: response, responseType: 'json' }
        })
    }
}
