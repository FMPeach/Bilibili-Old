import sortJson from "../json/sort.txt";
import { objUrl } from "../utils/format/url";
import { IAidDatail, jsonCheck } from "./api";
import { URLS } from "./urls";

/** 新版分区feed返回的稿件结构 */
interface IRegionFeedArchive {
    aid: number;
    bvid: string;
    cid: number;
    title: string;
    cover: string;
    /** 时长（秒） */
    duration: number;
    /** 投稿时间戳（秒） */
    pubdate: number;
    stat: { view: number; like: number; danmaku: number };
    author: { mid: number; name: string };
    goto: 'av' | string;
    rec_reason: string;
}

/**
 * 旧版一级分区 tid → 新版(v2)主分区 tid 对照。
 * v2 尚未启用子分区，且番剧/国创/纪录片/电影/电视剧等 OGV 分区无对应项，只能就近映射。
 * 参考 <https://github.com/wuziqian211/bilibili-API-collect/blob/master/docs/video/video_zone_v2.md>
 */
const V2_MAIN: Record<number, number> = {
    1: 1005, // 动画
    13: 1005, // 番剧 -> 动画
    167: 1005, // 国创 -> 动画
    3: 1003, // 音乐
    129: 1004, // 舞蹈
    4: 1008, // 游戏
    36: 1010, // 知识
    188: 1012, // 科技 -> 科技数码
    234: 1018, // 运动 -> 体育运动
    223: 1013, // 汽车
    160: 1030, // 生活 -> 生活兴趣
    211: 1020, // 美食
    217: 1024, // 动物圈 -> 动物
    119: 1007, // 鬼畜
    155: 1014, // 时尚 -> 时尚美妆
    202: 1009, // 资讯
    5: 1002, // 娱乐
    181: 1001, // 影视
    177: 1001, // 纪录片 -> 影视
    23: 1001, // 电影 -> 影视
    11: 1001, // 电视剧 -> 影视
};
/** 旧版分区 tid（含二级）→ 新版主分区 tid，二级按其所属一级归并 */
let lookup: Record<number, number> | undefined;
function fromRegion(rid: number) {
    if (!lookup) {
        lookup = { ...V2_MAIN };
        const tree = <{ tid?: number; sub?: { tid?: number }[] }[]>JSON.parse(sortJson);
        tree.forEach(d => {
            const v2 = d.tid && V2_MAIN[d.tid];
            v2 && d.sub?.forEach(s => { s.tid && (lookup![s.tid] ??= v2); });
        });
    }
    return lookup[rid];
}

/**
 * 新版分区feed接口，旧版分区最新视频接口（`dynamic/region`/二级分区`newlist`）下线后的替代。
 * 返回的是推荐流而非严格按时间的最新投稿，且只有新版主分区粒度，
 * 旧版分区 tid 将按上述对照就近映射，无对应项时抛出异常。
 * 该接口偶发返回空推荐（code 62013），故空结果时自动重试。
 */
export async function apiRegionFeedRcmd(rid: number, pn = 1, ps = 10) {
    const from_region = fromRegion(rid);
    if (!from_region) throw new Error(`旧版分区${rid}没有对应的新版分区！`);
    let archives: IRegionFeedArchive[] = [];
    for (let i = 0; i < 3; i++) {
        const response = await fetch(objUrl(URLS.REGION_FEED_RCMD, {
            display_id: pn,
            request_cnt: ps,
            from_region,
            device: 'web',
            plat: 30,
        }), { credentials: 'include' });
        const json = await response.json();
        // 62013：暂时没有更多内容了，换一次通常即有数据
        if (json.code === 62013) continue;
        archives = <IRegionFeedArchive[]>(jsonCheck(json).data.archives || []);
        if (archives.length) break;
    }
    return archives.filter(d => !d.goto || d.goto === 'av').map(d => (<IAidDatail><unknown>{
        aid: d.aid,
        bvid: d.bvid,
        cid: d.cid,
        title: d.title,
        pic: d.cover,
        desc: '',
        duration: d.duration,
        pubdate: d.pubdate,
        tid: rid,
        tname: '',
        owner: { mid: d.author?.mid || 0, name: d.author?.name || '', face: '' },
        stat: {
            aid: d.aid,
            view: d.stat?.view || 0,
            danmaku: d.stat?.danmaku || 0,
            like: d.stat?.like || 0,
        },
    }));
}
