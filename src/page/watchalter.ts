import { BLOD } from "../core/bilibili-old";
import { Comment } from "../core/comment";
import { Like } from "../core/ui/like";
import { user } from "../core/user";
import { videoInfo } from "../core/video-info";
import cssUplist from '../css/uplist.css';
import html from '../html/watchlater.html';
import { IAidDatail, IStaf, jsonCheck } from "../io/api";
import { addCss } from "../utils/element";
import { urlObj } from "../utils/format/url";
import { jsonpHook } from "../utils/hook/node";
import { xhrHook } from "../utils/hook/xhr";
import { poll } from "../utils/poll";
import { Scrollbar } from "../utils/scrollbar";
import { Header } from "./header";
import { Page } from "./page";

export class PageWatchlater extends Page {
    protected like: Like;
    /** 合作UP主模式 */
    protected _isStaffMode = false;
    constructor() {
        super(html);
        this.like = new Like();
        new Comment();
        this.toAv();
        this.enLike();
        this.staffHook();
        this.toview();
        this.living();
        this.commentAgent();
        this.exp();
        Header.primaryMenu();
        Header.banner();
        this.updateDom();
    }
    /** 记录视频数据 */
    protected toview() {
        jsonpHook('history/toview/web?', undefined, d => {
            setTimeout(() => {
                d.data.list.forEach((d: IAidDatail) => videoInfo.aidDatail(d));
            });
            return d;
        })
    }
    /** 点赞功能 */
    protected enLike() {
        if (user.userStatus!.like) {
            poll(() => document.querySelector<HTMLSpanElement>('#viewlater-app > div > div > div > div.video-top-info.clearfix.bili-wrapper.bili-wrapper > div.video-info-module > div.number > span.u.coin.on'), d => {
                d.parentElement?.insertBefore(this.like, d);
                addCss('.video-info-module .number .ulike {margin-left: 15px;margin-right: 5px;}', 'ulike-watchlater');
            }, undefined, 0);
            jsonpHook('x/web-interface/view?', undefined, d => {
                setTimeout(() => {
                    const data: IAidDatail = jsonCheck(d).data;
                    BLOD.aid = data.aid;
                    this.like.likes = data.stat.like;
                    this.like.init();
                });
                return d;
            }, false);
        }
    }
    /** 修正直播错误 */
    protected living() {
        xhrHook("api.live.bilibili.com/bili/living_v2/", undefined, r => { r.response = r.responseText = ` ${r.response}` }, false);
    }
    /** 修复评论播放跳转 */
    protected commentAgent() {
        (<any>window).commentAgent = { seek: (t: number) => (<any>window).player && (<any>window).player.seek(t) };
    }

    /** 重定向回av页 */
    private toAv() {
        if (user.userStatus?.watchlater2Av) {
            jsonpHook(['web-interface/view?', 'cb_view'], url => {
                const obj = urlObj(url);
                if (obj.aid) {
                    location.replace(`/video/av${obj.aid}`);
                }
                return url;
            });
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

    /** 合作UP主 */
    protected staffHook() {
        jsonpHook('x/web-interface/view?', undefined, d => {
            setTimeout(() => {
                const data: any = jsonCheck(d).data;
                if (user.userStatus!.staff && Array.isArray(data.staff) && data.staff.length) {
                    this.staff(<IStaf[]>data.staff);
                } else if (this._isStaffMode) {
                    this.restoreSingleUp(data.owner);
                }
            });
            return d;
        }, false);
    }

    /** 合作UP主卡片 */
    protected staff(staff: IStaf[]) {
        poll(() => document.querySelector<HTMLElement>('.up-info-module'), upinfo => {
            this._isStaffMode = true;
            // 在隐藏前读取单UP宽度，用于约束多UP容器横向宽度
            const width = upinfo.offsetWidth;
            upinfo.style.display = 'none';
            let container = document.querySelector<HTMLElement>('#v_upinfo_staff');
            if (!container) {
                container = document.createElement('div');
                container.id = 'v_upinfo_staff';
                container.className = 'up-info-m report-wrap-module report-scroll-module';
                upinfo.parentNode?.insertBefore(container, upinfo.nextSibling);
                addCss(cssUplist, "up-list");
            }
            // 用单UP宽度限制多UP宽度，并跟随单UP浮动到右侧
            if (width) {
                container.style.width = width + 'px';
            }
            container.style.float = 'right';
            container.style.flex = '0 0 auto';
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
        });
    }

    /** 合作UP切单UP */
    protected restoreSingleUp(up: any) {
        this._isStaffMode = false;
        const upinfo = document.querySelector<HTMLElement>('.up-info-module');
        const staffContainer = document.querySelector<HTMLElement>('#v_upinfo_staff');
        if (staffContainer) {
            staffContainer.style.display = 'none';
        }
        if (upinfo) {
            upinfo.style.display = '';
        }
    }
}