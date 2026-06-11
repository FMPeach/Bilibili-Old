import { objUrl } from "../utils/format/url";
import { jsonCheck } from "./api";

/**
 * B 站历史记录相关接口封装。
 *
 * 旧版历史记录页（`account/history`）已被 B 站下线并重定向至新版 `/history`，
 * 旧页面本体及其存档均不可考，故本模块直接调用现行历史记录接口，由
 * {@link ../page/history.PageHistory} 自行渲染旧版风格页面。
 *
 * 所有写操作（删除/清空/暂停）均需登录态（`SESSDATA` cookie）并附带 `csrf`（即 `bili_jct`）。
 */

/** 历史记录业务类型 */
export type HistoryBusiness = 'archive' | 'pgc' | 'live' | 'article' | 'article-list';

/** 历史记录分类筛选 */
export type HistoryType = 'all' | 'archive' | 'live' | 'article';

/** 单条历史记录的来源信息 */
export interface IHistoryRecord {
    /** 目标 id：稿件 avid / 直播间 id / 文集 rlid 等 */
    oid: number;
    /** 剧集 epid（仅 pgc） */
    epid: number;
    /** 稿件 bvid（仅 archive） */
    bvid: string;
    /** 观看至分 P */
    page: number;
    /** 观看至分 P 的 cid */
    cid: number;
    /** 分 P 标题 */
    part: string;
    /** 业务类型 */
    business: HistoryBusiness;
    /** 记录方式：1/3/5/7=手机端 2=网页端 4/6=电视端 */
    dt: number;
}

/** 单条历史记录 */
export interface IHistoryItem {
    /** 条目标题 */
    title: string;
    /** 剧集完整标题（仅 pgc） */
    long_title: string;
    /** 封面（部分业务为空，转用 covers） */
    cover: string;
    /** 多封面（无 cover 时取首张） */
    covers: string[] | null;
    /** 重定向跳转地址（部分业务提供） */
    uri: string;
    /** 来源信息 */
    history: IHistoryRecord;
    /** 视频分 P 总数 */
    videos: number;
    /** UP 主昵称 / 番剧出品方 */
    author_name: string;
    /** UP 主头像 */
    author_face: string;
    /** UP 主 mid */
    author_mid: number;
    /** 观看时间戳（秒） */
    view_at: number;
    /** 观看进度（秒），-1 表示已看完 */
    progress: number;
    /** 角标文案 */
    badge: string;
    /** 分 P 标题或剧集分集名 */
    show_title: string;
    /** 总时长（秒） */
    duration: number;
    /** 总计分集（仅 pgc） */
    total: number;
    /** 最新一话提示（仅 pgc） */
    new_desc: string;
    /** 是否完结（仅 pgc） */
    is_finish: number;
    /** 直播状态：0=未开播 1=直播中（仅 live） */
    live_status: number;
    /** 标签名（分类） */
    tag_name: string;
}

/** 历史记录翻页游标 */
export interface IHistoryCursor {
    /** 下一页截止 id */
    max: number;
    /** 下一页截止时间戳 */
    view_at: number;
    /** 下一页截止业务类型 */
    business: string;
    /** 每页项数 */
    ps: number;
}

/** 历史记录列表返回数据 */
export interface IHistoryCursorData {
    /** 翻页游标 */
    cursor: IHistoryCursor;
    /** 分类 tab */
    tab: { type: string; name: string }[];
    /** 记录列表 */
    list: IHistoryItem[];
}

/** 历史记录列表请求参数 */
export interface IHistoryCursorParams {
    /** 截止目标 id（首页传 0） */
    max?: number;
    /** 截止时间戳（首页传 0） */
    view_at?: number;
    /** 截止业务类型（首页留空） */
    business?: string;
    /** 分类筛选 */
    type?: HistoryType;
    /** 每页项数，最大 30 */
    ps?: number;
}

/**
 * 分页拉取历史记录
 * @param params 游标及筛选参数
 */
export async function apiHistoryCursor(params: IHistoryCursorParams = {}) {
    const { max = 0, view_at = 0, business = '', type = 'all', ps = 20 } = params;
    const url = objUrl('//api.bilibili.com/x/web-interface/history/cursor', {
        max, view_at, business, type, ps
    });
    const response = await fetch(url, { credentials: 'include' });
    const json = await response.json();
    return <IHistoryCursorData>jsonCheck(json).data;
}

/**
 * 搜索历史记录
 * @param keyword 关键词
 * @param pn 页码（从 1 起）
 * @param business 业务类型筛选，留空为全部
 */
export async function apiHistorySearch(keyword: string, pn = 1, business = '') {
    const url = objUrl('//api.bilibili.com/x/web-interface/history/search', {
        keyword, pn, business
    });
    const response = await fetch(url, { credentials: 'include' });
    const json = await response.json();
    return <{ list: IHistoryItem[]; page: { num: number; size: number; total: number } }>jsonCheck(json).data;
}

/**
 * 删除单条历史记录
 * @param kid 目标记录：`${business}_${oid}`，如 `archive_810872`
 * @param csrf 鉴权 cookie `bili_jct`
 */
export async function apiHistoryDelete(kid: string, csrf: string) {
    const response = await fetch('//api.bilibili.com/x/v2/history/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `kid=${encodeURIComponent(kid)}&csrf=${csrf}`,
        credentials: 'include'
    });
    const json = await response.json();
    return jsonCheck(json);
}

/**
 * 清空全部历史记录
 * @param csrf 鉴权 cookie `bili_jct`
 */
export async function apiHistoryClear(csrf: string) {
    const response = await fetch('//api.bilibili.com/x/v2/history/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `csrf=${csrf}`,
        credentials: 'include'
    });
    const json = await response.json();
    return jsonCheck(json);
}

/**
 * 查询历史记录暂停状态
 * @returns true 表示已暂停记录
 */
export async function apiHistoryShadow() {
    const response = await fetch('//api.bilibili.com/x/v2/history/shadow', { credentials: 'include' });
    const json = await response.json();
    return <boolean>jsonCheck(json).data;
}

/**
 * 设置历史记录暂停状态
 * @param pause true=暂停记录，false=恢复记录
 * @param csrf 鉴权 cookie `bili_jct`
 */
export async function apiHistoryShadowSet(pause: boolean, csrf: string) {
    const response = await fetch('//api.bilibili.com/x/v2/history/shadow/set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `switch=${pause}&csrf=${csrf}`,
        credentials: 'include'
    });
    const json = await response.json();
    return jsonCheck(json);
}
