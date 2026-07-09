import { urlCleaner } from '../core/url';
import { user } from "../core/user";
import { jsonCheck } from "../io/api";
import { xhrHook } from "../utils/hook/xhr";
import dynamicHtml from '../html/dynamic.html';
import { Header } from "./header";
import { Page } from "./page";

export class PageDynamic extends Page {
    constructor() {
        super(dynamicHtml);
        user.addCallback(status => {
            if (status.dynamic) {
                // 重写为旧版动态页
                this.rewrite();
            } else {
                // 在新版页面基础上应用各项修复
            }
        status.liveRecord || this.liveRecord();
        });
    }

    /** 重写为旧版动态页 */
    protected rewrite() {
        urlCleaner.updateLocation(location.href);
        Header.primaryMenu();
        Header.banner();
        this.updateDom();
    }

    /** 过滤直播录屏动态 */
    protected liveRecord() {
        xhrHook("api.bilibili.com/x/polymer/web-dynamic/v1/feed/all", undefined, r => {
            try {
                const response = jsonCheck(r.response);
                response.data.items = response.data.items.filter((d: any) => d.modules?.module_dynamic?.major?.archive?.badge?.text != "直播回放");
                r.responseType === "json" ? r.response = response : r.response = r.responseText = JSON.stringify(response);
            } catch (e) { }
        }, false);
    }
}