import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../../../eventyay/static/pretixcontrol/js/ui/admin-users.js', import.meta.url), 'utf8');

function setup({ width = 1280, height = 800 } = {}) {
    const documentEvents = {};
    const windowEvents = {};
    const groups = [];
    class Element {
        matches(selector) { return selector === '.user-action-form button' && this.actionButton === true; }
        click() { this.clickCount = (this.clickCount || 0) + 1; }
    }
    const document = {
        readyState: 'complete',
        activeElement: null,
        getElementById: () => null,
        querySelector: () => groups.find(group => group.classList.contains('open')) || null,
        addEventListener: (name, handler) => { documentEvents[name] = handler; },
    };
    const window = {
        innerWidth: width,
        innerHeight: height,
        addEventListener: (name, handler) => { windowEvents[name] = handler; },
    };
    const context = vm.createContext({ document, window, Node: Element, queueMicrotask: callback => callback() });
    vm.runInContext(source, context);

    function createGroup(rect = { left: 100, right: 140, top: 100, bottom: 130 }) {
        const menu = new Element();
        menu.offsetWidth = 220;
        menu.offsetHeight = 66;
        menu.style = { removeProperty(name) { delete this[name]; } };
        const backdrop = new Element();
        backdrop.removed = false;
        backdrop.remove = () => { backdrop.removed = true; };
        const toggle = new Element();
        toggle.attributes = { 'aria-expanded': 'true' };
        toggle.getBoundingClientRect = () => rect;
        toggle.setAttribute = (name, value) => { toggle.attributes[name] = value; };
        toggle.focus = () => { document.activeElement = toggle; };
        const buttons = [new Element(), new Element()];
        buttons.forEach(button => {
            button.actionButton = true;
            button.focus = () => { document.activeElement = button; };
        });
        menu.contains = target => target === menu || buttons.includes(target);
        const classes = new Set(['open']);
        const group = {
            classList: { contains: name => classes.has(name), remove: name => classes.delete(name) },
            contains: target => target === toggle || menu.contains(target),
            querySelector: selector => {
                if (selector === '.dropdown-menu') return menu;
                if (selector === '.dropdown-backdrop') return backdrop.removed ? null : backdrop;
                return toggle;
            },
            querySelectorAll: () => buttons,
        };
        toggle.closest = selector => selector === '.admin-users-table .btn-group' ? group : null;
        buttons.forEach(button => { button.closest = toggle.closest; });
        groups.push(group);
        return { group, menu, backdrop, toggle, buttons };
    }

    return { context, document, documentEvents, windowEvents, createGroup, Element };
}

test('menu opens below its toggle without losing its row/forms', () => {
    const env = setup();
    const { group, menu } = env.createGroup({ left: 400, right: 440, top: 100, bottom: 130 });
    env.context.positionActionsMenu();
    assert.equal(menu.style.position, 'fixed');
    assert.equal(menu.style.left, '220px');
    assert.equal(menu.style.top, '130px');
    assert.equal(group.querySelector('.dropdown-menu'), menu);
});

test('menu opens above near the viewport bottom', () => {
    const env = setup({ height: 400 });
    const { menu } = env.createGroup({ right: 440, top: 350, bottom: 380 });
    env.context.positionActionsMenu();
    assert.equal(menu.style.top, '284px');
});

for (const [right, expected] of [[20, '8px'], [500, '162px']]) {
    test(`mobile menu stays within viewport when toggle right is ${right}`, () => {
        const env = setup({ width: 390 });
        const { menu } = env.createGroup({ right, top: 100, bottom: 130 });
        env.context.positionActionsMenu();
        assert.equal(menu.style.left, expected);
    });
}

test('switching rows resets the previous menu position', () => {
    const env = setup();
    const first = env.createGroup();
    env.context.positionActionsMenu();
    first.group.classList.remove('open');
    const second = env.createGroup();
    env.context.positionActionsMenu();
    assert.equal(first.menu.style.position, undefined);
    assert.equal(second.menu.style.position, 'fixed');
});

for (const reason of ['Escape', 'focus', 'page scroll', 'table scroll', 'resize']) {
    test(`${reason} closes menu, removes touch backdrop and resets styles/aria`, () => {
        const env = setup();
        const { group, menu, toggle, backdrop } = env.createGroup();
        env.context.positionActionsMenu();
        if (reason === 'Escape') {
            env.documentEvents.keydown({ target: toggle, key: 'Escape', preventDefault() {}, stopPropagation() {} });
            assert.equal(env.document.activeElement, toggle);
        } else if (reason === 'focus') {
            env.documentEvents.focusin({ target: new env.Element() });
        } else if (reason === 'resize') {
            env.windowEvents.resize();
        } else {
            env.windowEvents.scroll({ target: reason === 'table scroll' ? new env.Element() : env.document });
        }
        assert.equal(group.classList.contains('open'), false);
        assert.equal(backdrop.removed, true);
        assert.equal(toggle.attributes['aria-expanded'], 'false');
        for (const name of ['position', 'left', 'right', 'top']) assert.equal(menu.style[name], undefined);
    });
}

test('scrolling inside the menu does not dismiss it', () => {
    const env = setup();
    const { group, menu, backdrop } = env.createGroup();
    env.context.positionActionsMenu();
    env.windowEvents.scroll({ target: menu });
    assert.equal(group.classList.contains('open'), true);
    assert.equal(backdrop.removed, false);
});

test('closing one menu preserves another dropdown backdrop', () => {
    const env = setup();
    const first = env.createGroup();
    env.context.positionActionsMenu();
    const second = env.createGroup();
    env.context.closeActionsMenu();
    assert.equal(first.backdrop.removed, true);
    assert.equal(second.backdrop.removed, false);
});

for (const index of [0, 1]) {
    test(`Space activates action ${index + 1} after arrow-key navigation`, () => {
        const env = setup();
        const { toggle, buttons } = env.createGroup();
        toggle.focus();
        for (let step = 0; step <= index; step++) {
            env.documentEvents.keydown({
                target: env.document.activeElement, key: 'ArrowDown', preventDefault() {}, stopPropagation() {},
            });
        }
        assert.equal(env.document.activeElement, buttons[index]);
        let prevented = false;
        let stopped = false;
        env.documentEvents.keydown({
            target: env.document.activeElement, key: ' ',
            preventDefault() { prevented = true; },
            stopPropagation() { stopped = true; },
        });
        assert.equal(buttons[index].clickCount, 1);
        assert.equal(prevented, true);
        assert.equal(stopped, true);
    });
}
