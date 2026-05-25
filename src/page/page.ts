import { toast } from "../core/toast";
import { poll } from "../utils/poll";
import { VdomTool } from "../utils/vdomtool";

/** 重写页面基类 */
export abstract class Page {
    /** 页面框架vdom */
    protected vdom!: VdomTool;
    /** 初始化完成 */
    protected initilized = false;
    /** 禁止清除webpackJsonp */
    protected webpackJsonp = false;
    /** 保留__INITIAL_STATE__（仅特定页面需要） */
    protected keepInitialState = false;
    /** 保留新版next-head-count */
    protected keepNextHeadMarker = false;
    /**
     * @param html 页面框架
     */
    constructor(html: string) {
        this.updateHtml(html);
        Reflect.defineProperty(window, '_babelPolyfill', {
            configurable: true,
            set: () => true,
            get: () => undefined
        });
    }
    protected updateHtml(html: string) {
        this.vdom = new VdomTool(html);
    }
    /** 重写页面 */
    protected updateDom() {
        // 备份标题
        const title = document.title;
        // 保留新版next-head-count标记，避免新版样式被清理掉导致爆死循环
        const keepNextHeadMarker = this.keepNextHeadMarker || !!document.head?.querySelector('meta[name="next-head-count"]');
        // 清理新版页面注入的 INITIAL_STATE，避免旧版脚本读取到新版结构
        try {
            if (!this.keepInitialState) {
                Reflect.deleteProperty(window, '__INITIAL_STATE__');
            }
        } catch (e) { }
        // 删除webpackJsonp残留
        this.webpackJsonp || Reflect.deleteProperty(window, 'webpackJsonp');
        // 刷新DOM
        this.vdom.replace(document.documentElement);
        keepNextHeadMarker && this.restoreNextHeadMarker();
        // 还原标题
        title && !title.includes("404") && (document.title = title);
        setTimeout(() => this.loadedCallback());
    }
    // 恢复新版next-head-count标记，避免新版页面注入的样式被清理掉爆死循环
    protected restoreNextHeadMarker() {
        const head = document.head;
        if (!head) return;
        let marker = head.querySelector<HTMLMetaElement>('meta[name="next-head-count"]');
        if (!marker) {
            marker = document.createElement('meta');
            marker.name = 'next-head-count';
        }
        marker.content = '0';
        head.appendChild(marker);
    }
    /** 重写完成回调 */
    protected loadedCallback() {
        this.initilized = true;
        poll(() => document.readyState === "complete", () => {
            document.querySelector("#jvs-cert") || window.dispatchEvent(new ProgressEvent("load"));
        });
    }
}
