const WEBPACK_GUARD_FLAG = '__BLOD_WEBPACK_GUARD__';

const shouldBlockCurrentScript = patterns => {
    const currentScript = document.currentScript;
    const src = currentScript instanceof HTMLScriptElement ? currentScript.src : '';
    return !!src && patterns.some(pattern => pattern.test(src));
};

export function neutralizeOriginalScripts(patterns) {
    if (!patterns?.length) return;
    Array.from(document.scripts).forEach(script => {
        if (script === document.currentScript) return;
        const src = script.src || script.getAttribute('src') || '';
        if (src && patterns.some(pattern => pattern.test(src))) {
            script.type = 'javascript/blocked';
            script.removeAttribute('src');
            script.textContent = '';
            script.remove();
        }
    });
}

export function guardWebpackJsonp(patterns) {
    const win = window;
    let value = win.webpackJsonp;
    const shouldBlock = () => shouldBlockCurrentScript(patterns);
    const wrapPush = () => {
        const target = value;
        if (!target || typeof target.push !== 'function' || target.push[WEBPACK_GUARD_FLAG]) return;
        const originalPush = target.push;
        const guardedPush = function (...args) {
            return shouldBlock() ? this.length : originalPush.apply(this, args);
        };
        Object.defineProperty(guardedPush, WEBPACK_GUARD_FLAG, { value: true });
        target.push = guardedPush;
    };
    Reflect.defineProperty(window, 'webpackJsonp', {
        configurable: true,
        get: () => value,
        set: next => {
            value = next;
            if (shouldBlock() && Array.isArray(value)) {
                value.length = 0;
            }
            wrapPush();
        }
    });
    wrapPush();
    const timer = setInterval(wrapPush, 50);
    const release = () => {
        clearInterval(timer);
        try {
            const current = win.webpackJsonp;
            Reflect.deleteProperty(window, 'webpackJsonp');
            win.webpackJsonp = current;
        } catch (e) { }
    };
    setTimeout(release, 10000);
    return release;
}
