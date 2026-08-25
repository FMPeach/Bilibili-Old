import { Android, buvid } from "./android";
import { jsonCheck } from "./api";
import { ApiSign } from "./api-sign";
import { IApiWebshowLocsResponse } from "./api-webshow-locs";
import { URLS } from "./urls";

export class ApiFeedIndex extends ApiSign {
    constructor() {
        super(URLS.FEED_INDEX, '1d8b6e7d45233436');
        this.data = {
            build: Android.build,
            mobi_app: Android.mobi_app,
            platform: Android.platform,
            c_locale: Android.c_locale,
            s_locale: Android.s_locale,
            idx: 0,
            pull: true,
            login_event: 0,
            open_event: '',
            qn: 32,
            fnval: 4048,
            fnver: 0,
            fourk: 0
        };
    }

    async getData() {
        const response = await GM.fetch(this.sign().toJSON(), {
            headers: {
                'user-agent': Android["user-agent"],
                'buvid': buvid()
            }
        });
        const json = await response.json();
        return <IApiFeedIndexResponse>jsonCheck(json);
    }

    /**
     * 将 APP Feed 推荐/推广数据转换为旧版推广位 locsData 格式
     */
    static toLocsData(data: IApiFeedIndexResponse): IApiWebshowLocsResponse[] {
        if (!data?.data?.items) return [];
        return data.data.items
            .filter(item => item && (item.cover || item.title))
            .map((item, index) => {
                const aid = item.param || item.args?.aid || item.player_args?.aid || item.id;
                let url = item.uri || '';
                if (url.startsWith('bilibili://video/')) {
                    const vid = url.replace('bilibili://video/', '').split('?')[0];
                    url = vid.startsWith('BV') ? `//www.bilibili.com/video/${vid}` : `//www.bilibili.com/video/av${vid}`;
                } else if (!url.startsWith('http') && !url.startsWith('//')) {
                    url = aid ? `//www.bilibili.com/video/av${aid}` : url;
                }
                return <IApiWebshowLocsResponse><unknown>{
                    id: Number(aid) || index + 1,
                    name: item.title || '',
                    title: item.title || '',
                    pic: item.cover || '',
                    litpic: item.cover || '',
                    url: url,
                    is_ad: false,
                    is_ad_loc: false,
                    pos_num: index + 1,
                    creative_type: 0,
                    null_frame: false
                };
            });
    }
}

export interface IApiFeedIndexResponse {
    code: number;
    message: string;
    ttl: number;
    data: {
        items: Array<{
            card_type?: string;
            card_goto?: string;
            goto?: string;
            param?: string;
            cover?: string;
            title?: string;
            uri?: string;
            args?: {
                up_name?: string;
                aid?: number;
                v_id?: string;
            };
            player_args?: {
                aid?: number;
                cid?: number;
            };
            id?: number;
        }>;
    };
}
