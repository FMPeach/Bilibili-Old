import { jsonCheck } from "./api";
import { ApiSign } from "./api-sign";
import { URLS } from "./urls";

/**
 * 点赞
 * @param aid 视频aid
 * @param access_token 鉴权cookie键值
 * @param dislike 点踩/取消
 */
export async function apiDislike(aid: number, access_token: string, dislike = false) {
    const api = new ApiSign(URLS.DISLIKE, "bb3101000e232e27");
        const response = await GM.fetch(api.sign({
            aid: aid,
            dislike: dislike ? 0 : 1,
            access_key: access_token
        }).toJSON(), {
            method: 'POST'
        });

    const json = await response.json();
    return jsonCheck(json);
}