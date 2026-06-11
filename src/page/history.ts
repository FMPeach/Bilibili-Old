import html from "../html/history.html";
import {
    apiHistoryClear,
    apiHistoryCursor,
    apiHistoryDelete,
    apiHistorySearch,
    apiHistoryShadow,
    apiHistoryShadowSet,
    type HistoryType,
    type IHistoryItem,
} from "../io/api-history";
import { toast } from "../core/toast";
import { user } from "../core/user";
import { getCookies } from "../utils/cookie";
import { s2hms } from "../utils/format/time";
import { Header } from "./header";
import { Page } from "./page";

/**
 * 旧版历史记录页（`/history`、`/account/history`）。
 *
 * B 站撤掉了旧版历史记录页的官方入口，`account/history` 现已 302 重定向至新版 `/history`，
 * 旧页面本体及存档均不可考。本类按项目惯用的 {@link Page} 重写模式，用旧版风格模板整页接管，
 * 再调用现行历史记录接口（见 {@link ../io/api-history}）自行渲染列表，支持：
 * 日期分组、无限滚动、类型筛选、搜索、单条删除、暂停记录、清空。
 */
export class PageHistory extends Page {
    /** 鉴权 cookie */
    private csrf = getCookies()['bili_jct'] || '';
    /** 列表容器 */
    private listEl?: HTMLElement;
    /** 加载提示 */
    private loadingEl?: HTMLElement;
    /** 翻页游标 */
    private cursor = { max: 0, view_at: 0, business: '' };
    /** 当前类型筛选 */
    private type: HistoryType = 'all';
    /** 当前搜索关键词，空串为浏览模式 */
    private keyword = '';
    /** 搜索模式页码 */
    private searchPn = 1;
    /** 是否正在加载 */
    private busy = false;
    /** 是否已加载完毕 */
    private finished = false;
    /** 日期分组：上一条记录的日期标签 */
    private lastDate = '';
    /** 当前日期分组的条目容器 */
    private groupEl?: HTMLElement;

    constructor() {
        super(html);
        Header.primaryMenu();
        Header.banner();
        this.updateDom();
    }

    /** DOM 接管完成后初始化交互与首屏数据 */
    protected loadedCallback() {
        super.loadedCallback();
        this.listEl = document.getElementById('history-list') || undefined;
        this.loadingEl = document.getElementById('history-loading') || undefined;
        if (!this.listEl) return;
        // 启用【纯视频历史】时默认进入「视频」tab
        if (user.userStatus?.history) {
            this.type = 'archive';
            this.activateTab('archive');
        }
        this.bindEvents();
        this.initShadow();
        this.reload();
    }

    /** 绑定控制条与滚动事件 */
    private bindEvents() {
        // 类型 tab
        document.getElementById('history-tabs')?.addEventListener('click', e => {
            const tab = (e.target as HTMLElement).closest<HTMLElement>('.history-tab');
            if (!tab) return;
            const type = (tab.dataset.type || 'all') as HistoryType;
            if (type === this.type) return;
            this.type = type;
            this.activateTab(type);
            this.reload();
        });
        // 搜索
        const input = document.getElementById('history-search-input') as HTMLInputElement | null;
        const search = () => {
            this.keyword = input?.value.trim() || '';
            this.reload();
        };
        document.getElementById('history-search-btn')?.addEventListener('click', search);
        input?.addEventListener('keydown', e => {
            if (e.key === 'Enter') search();
        });
        // 暂停记录
        document.getElementById('history-shadow-toggle')?.addEventListener('change', e => {
            this.toggleShadow((e.target as HTMLInputElement).checked);
        });
        // 清空
        document.getElementById('history-clear-btn')?.addEventListener('click', () => this.clearAll());
        // 无限滚动
        window.addEventListener('scroll', () => {
            if (this.busy || this.finished) return;
            const scrollBottom = window.scrollY + window.innerHeight;
            if (scrollBottom > document.body.offsetHeight - 400) this.loadMore();
        });
    }

    /** 高亮指定 tab */
    private activateTab(type: string) {
        document.querySelectorAll<HTMLElement>('.history-tab').forEach(d => {
            d.classList.toggle('active', d.dataset.type === type);
        });
    }

    /** 重置状态并重新加载（切换 tab、搜索、清空后调用） */
    private reload() {
        this.cursor = { max: 0, view_at: 0, business: '' };
        this.searchPn = 1;
        this.finished = false;
        this.lastDate = '';
        this.groupEl = undefined;
        this.listEl && (this.listEl.innerHTML = '');
        this.loadMore();
    }

    /** 加载下一页 */
    private async loadMore() {
        if (this.busy || this.finished) return;
        this.busy = true;
        this.setLoading(this.searchPn === 1 && this.cursor.max === 0 ? '加载中...' : '加载更多...');
        try {
            const list = this.keyword ? await this.fetchSearch() : await this.fetchCursor();
            if (!list.length) {
                this.finished = true;
                this.setLoading(this.isEmpty() ? '暂无历史记录' : '没有更多了');
            } else {
                this.renderItems(list);
                this.setLoading(this.finished ? '没有更多了' : '');
            }
        } catch (e: any) {
            // -101 未登录
            if (String(e?.cause) === '-101' || String(e?.message).includes('-101')) {
                this.setLoading('请先登录后查看历史记录');
            } else {
                this.setLoading('加载失败，请刷新重试');
                toast.error('历史记录加载失败', String(e?.message || e));
            }
            this.finished = true;
        } finally {
            this.busy = false;
        }
    }

    /** 浏览模式拉取一页，更新游标 */
    private async fetchCursor() {
        const data = await apiHistoryCursor({
            max: this.cursor.max,
            view_at: this.cursor.view_at,
            business: this.cursor.business,
            type: this.type,
        });
        const c = data.cursor;
        // max 归零或无游标说明到底了
        if (!c || !c.max) this.finished = true;
        else this.cursor = { max: c.max, view_at: c.view_at, business: c.business };
        return data.list || [];
    }

    /** 搜索模式拉取一页 */
    private async fetchSearch() {
        const business = this.type === 'all' ? '' : this.type;
        const data = await apiHistorySearch(this.keyword, this.searchPn, business);
        const list = data.list || [];
        const { num, size, total } = data.page || { num: this.searchPn, size: 20, total: list.length };
        if (num * size >= total || !list.length) this.finished = true;
        this.searchPn = num + 1;
        return list;
    }

    /** 渲染一批记录（按日期分组追加） */
    private renderItems(list: IHistoryItem[]) {
        list.forEach(item => {
            const label = this.dateLabel(item.view_at);
            if (label !== this.lastDate || !this.groupEl) {
                this.lastDate = label;
                const group = document.createElement('div');
                group.className = 'history-group';
                group.innerHTML = `<div class="history-date">${label}</div>`;
                const items = document.createElement('div');
                items.className = 'history-items';
                group.appendChild(items);
                this.listEl!.appendChild(group);
                this.groupEl = items;
            }
            this.groupEl.insertAdjacentHTML('beforeend', this.renderItem(item));
        });
        this.bindDelete();
    }

    /** 生成单条记录的 HTML */
    private renderItem(item: IHistoryItem) {
        const h = item.history;
        const kid = `${h.business}_${h.oid}`;
        const link = this.resolveLink(item);
        const title = this.escape(item.title || item.show_title || '未知标题');
        const isLive = h.business === 'live';
        const cover = item.cover || item.covers?.[0] || '';

        // 封面角标
        let coverExtra = '';
        if (isLive) {
            coverExtra = item.live_status === 1 ? `<span class="item-live">直播中</span>` : '';
        } else if (item.duration > 0) {
            coverExtra += `<span class="item-duration">${s2hms(item.duration)}</span>`;
            if (item.progress !== 0 && item.duration > 0) {
                const pct = item.progress < 0 ? 100 : Math.min(100, Math.round(item.progress / item.duration * 100));
                coverExtra += `<div class="item-progress"><span style="width:${pct}%"></span></div>`;
            }
        }
        const coverImg = cover
            ? `<img src="${this.cover(cover)}" loading="lazy" />`
            : '';

        // 副信息
        const badge = item.badge ? `<span class="item-badge">${this.escape(item.badge)}</span>` : '';
        const up = item.author_mid
            ? `<a class="item-up" href="//space.bilibili.com/${item.author_mid}" target="_blank">${this.escape(item.author_name)}</a>`
            : `<span class="item-up">${this.escape(item.author_name)}</span>`;
        const sub = this.subText(item);

        return `<div class="history-item" data-kid="${kid}">
            <a class="item-cover" href="${link}" target="_blank">${coverImg}${coverExtra}</a>
            <div class="item-info">
                <a class="item-title" href="${link}" target="_blank" title="${title}">${badge}${title}</a>
                <div class="item-meta">${up}</div>
                ${sub ? `<div class="item-sub">${sub}</div>` : ''}
            </div>
            <span class="item-time">${this.hhmm(item.view_at)}</span>
            <span class="item-delete" data-kid="${kid}" title="删除">×</span>
        </div>`;
    }

    /** 观看进度 / 剧集信息文案 */
    private subText(item: IHistoryItem) {
        const h = item.history;
        if (h.business === 'live') {
            return item.live_status === 1 ? '正在直播' : '已下播';
        }
        if (h.business === 'pgc') {
            return this.escape(item.new_desc || item.show_title || '');
        }
        if (h.business === 'article' || h.business === 'article-list') {
            return '专栏';
        }
        // archive
        const parts: string[] = [];
        if (item.videos > 1 && h.page) parts.push(`第${h.page}P`);
        if (item.progress < 0) parts.push('已看完');
        else if (item.progress > 0 && item.duration > 0) parts.push(`看到 ${s2hms(item.progress)} / ${s2hms(item.duration)}`);
        return this.escape(parts.join(' · '));
    }

    /** 业务类型 → 跳转地址 */
    private resolveLink(item: IHistoryItem) {
        const h = item.history;
        switch (h.business) {
            case 'archive': {
                const base = h.bvid
                    ? `//www.bilibili.com/video/${h.bvid}`
                    : `//www.bilibili.com/video/av${h.oid}`;
                return h.page > 1 ? `${base}?p=${h.page}` : base;
            }
            case 'pgc':
                return `//www.bilibili.com/bangumi/play/ep${h.epid}`;
            case 'live':
                return `//live.bilibili.com/${h.oid}`;
            case 'article':
                return `//www.bilibili.com/read/cv${h.oid}`;
            case 'article-list':
                return `//www.bilibili.com/read/readlist/rl${h.oid}`;
            default:
                return item.uri || 'javascript:void(0)';
        }
    }

    /** 绑定删除按钮（每次追加后重绑新节点） */
    private bindDelete() {
        this.listEl?.querySelectorAll<HTMLElement>('.item-delete:not([data-bound])').forEach(btn => {
            btn.setAttribute('data-bound', '1');
            btn.addEventListener('click', e => {
                e.preventDefault();
                e.stopPropagation();
                const kid = btn.dataset.kid;
                const item = btn.closest<HTMLElement>('.history-item');
                kid && item && this.deleteItem(kid, item);
            });
        });
    }

    /** 删除单条记录 */
    private async deleteItem(kid: string, el: HTMLElement) {
        if (!this.csrf) {
            toast.warning('请先登录');
            return;
        }
        try {
            await apiHistoryDelete(kid, this.csrf);
            const group = el.closest<HTMLElement>('.history-group');
            el.remove();
            // 组内已空则移除整组（含日期标题）
            if (group && !group.querySelector('.history-item')) group.remove();
        } catch (e: any) {
            toast.error('删除失败', String(e?.message || e));
        }
    }

    /** 清空全部历史 */
    private async clearAll() {
        if (!this.csrf) {
            toast.warning('请先登录');
            return;
        }
        if (!confirm('确定要清空全部历史记录吗？此操作不可恢复！')) return;
        try {
            await apiHistoryClear(this.csrf);
            this.listEl && (this.listEl.innerHTML = '');
            this.finished = true;
            this.setLoading('暂无历史记录');
            toast.success('已清空历史记录');
        } catch (e: any) {
            toast.error('清空失败', String(e?.message || e));
        }
    }

    /** 初始化暂停记录开关状态 */
    private async initShadow() {
        try {
            const paused = await apiHistoryShadow();
            const toggle = document.getElementById('history-shadow-toggle') as HTMLInputElement | null;
            toggle && (toggle.checked = !!paused);
        } catch (e) { /* 未登录等，忽略 */ }
    }

    /** 切换暂停记录 */
    private async toggleShadow(pause: boolean) {
        if (!this.csrf) {
            toast.warning('请先登录');
            return;
        }
        try {
            await apiHistoryShadowSet(pause, this.csrf);
            toast.success(pause ? '已暂停记录观看历史' : '已恢复记录观看历史');
        } catch (e: any) {
            toast.error('设置失败', String(e?.message || e));
            const toggle = document.getElementById('history-shadow-toggle') as HTMLInputElement | null;
            toggle && (toggle.checked = !pause);
        }
    }

    /** 列表是否为空 */
    private isEmpty() {
        return !this.listEl?.querySelector('.history-item');
    }

    /** 设置加载提示文案，空串则隐藏 */
    private setLoading(text: string) {
        if (!this.loadingEl) return;
        this.loadingEl.textContent = text;
        this.loadingEl.style.display = text ? '' : 'none';
    }

    /** 处理封面地址：转 https 并附缩略图尺寸后缀 */
    private cover(url: string) {
        url = url.replace(/^https?:/, '');
        return url.includes('@') ? url : `${url}@320w_200h_1c.jpg`;
    }

    /** 观看时间戳（秒）→ 日期分组标签 */
    private dateLabel(viewAt: number) {
        const d = new Date(viewAt * 1000);
        const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
        const today = startOfDay(new Date());
        const day = startOfDay(d);
        if (day === today) return '今天';
        if (day === today - 86400000) return '昨天';
        return `${d.getFullYear()}-${this.pad(d.getMonth() + 1)}-${this.pad(d.getDate())}`;
    }

    /** 观看时间戳（秒）→ HH:MM */
    private hhmm(viewAt: number) {
        const d = new Date(viewAt * 1000);
        return `${this.pad(d.getHours())}:${this.pad(d.getMinutes())}`;
    }

    private pad(n: number) {
        return n < 10 ? `0${n}` : `${n}`;
    }

    private escape(s: string) {
        return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
}
