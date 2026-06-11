import { urlCleaner } from '../core/url';
import { user } from "../core/user";
import { objUrl } from "../utils/format/url";
import { xhrHook } from "../utils/hook/xhr";
import html from '../html/history.html';
import { Header } from "./header";
import { Page } from "./page";

export class PageHistory extends Page {
    constructor() {
        super(html);
        urlCleaner.updateLocation(location.origin + '/account/history');
        Header.primaryMenu();
        Header.banner();
        this.updateDom();
        this.archive();
    }
    /** 纯视频历史记录（仅在重写开关也开启时生效） */
    protected archive() {
        user.addCallback(status => {
            if (!status.history || !status.historyVideoOnly) return;
            xhrHook(["api.bilibili.com/x/web-interface/history/cursor", "business"], function (args) {
                let obj = new URL(args[1]), max = obj.searchParams.get("max") || "", view_at = obj.searchParams.get("view_at") || "";
                args[1] = objUrl("//api.bilibili.com/x/web-interface/history/cursor", { max: max, view_at: view_at, type: "archive", ps: "20" });
            }, undefined, false);
        });
    }
}