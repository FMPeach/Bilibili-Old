import { apiDislike } from "../../io/api-dislike";
import svgDislike from "../../svg/dislike.svg";
import svgDisliked from "../../svg/disliked.svg";
import { uid } from "../../utils/conf/uid";
import { CustomElementsInterface } from "../../utils/customelement";
import { addCss } from "../../utils/element";
import { BLOD } from "../bilibili-old";
import { biliQuickLogin } from "../quickLogin";
import { toast } from "../toast";
import { user } from "../user";

export class Dislike extends HTMLSpanElement implements CustomElementsInterface {
    private disliked = false;
    constructor() {
        super();
        this.classList.add('ulike');
        this.update();
        this.addEventListener('click', ev => {
            ev.stopPropagation();
            if (uid) {
                if (!user.userStatus!.accessKey.token) {
                    toast.error("请先启用【账户授权】功能！")();
                    return;
                }
                apiDislike(BLOD.aid, user.userStatus!.accessKey.token, !this.disliked)
                    .then(() => {
                        this.toggle();
                    })
                    .catch(e => {
                        if (e.cause == 65007)
                        {
                            this.toggle();
                            toast.info('已点过踩！')();
                        }
                        else
                        {
                        toast.error('点踩出错！', e)();
                        }
                    })
            } else {
                biliQuickLogin();
            }
        });
    }
    /** 初始化节点 */
    init() {
        if (uid) {
            // TODO 有获取点踩状态的 api 吗?
        }
        addCss('.ulike {cursor: pointer;}.ulike svg{vertical-align: middle;margin-right: 10px;transform: translateY(-1px);}', `ulike${_MUTEX_}`);
    }
    protected toggle() {
        this.disliked = !this.disliked;
        this.update();
    }
    protected update() {
        this.innerHTML = (this.disliked ? svgDisliked : svgDislike) + '点踩';
    }
}
customElements.get(`dislike-${_MUTEX_}`) || customElements.define(`dislike-${_MUTEX_}`, Dislike, { extends: 'span' });