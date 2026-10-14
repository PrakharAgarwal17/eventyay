import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import test from "node:test"

const script = readFileSync(new URL("../../eventyay/static/common/js/base.js", import.meta.url), "utf8")

function createPage(storage = new Map()) {
    const listeners = {}
    let reloads = 0

    class Form {}
    class Element {
        constructor(link) {
            this.link = link
        }

        closest(selector) {
            assert.equal(selector, "a[href]")
            return this.link
        }
    }

    runInNewContext(script, {
        document: {
            readyState: "loading",
            addEventListener: (name, callback) => { listeners[`document:${name}`] = callback },
        },
        window: {
            location: {
                href: "https://example.test/event/",
                origin: "https://example.test",
                reload: () => { reloads++ },
            },
            addEventListener: (name, callback) => { listeners[`window:${name}`] = callback },
        },
        sessionStorage: {
            getItem: (key) => storage.get(key) ?? null,
            setItem: (key, value) => storage.set(key, value),
        },
        URL,
        HTMLFormElement: Form,
        Element,
        console,
    })

    return {
        click(href) {
            listeners["document:click"]({ target: new Element({ href }) })
        },
        submit(action) {
            const form = new Form()
            form.action = action
            listeners["document:submit"]({ target: form })
        },
        pageshow(persisted) {
            listeners["window:pageshow"]({ persisted })
        },
        get reloads() { return reloads },
        storage,
    }
}

test("reloads a BFCache-restored page after logout, including multiple Back restores", () => {
    const storage = new Map()
    const firstBackPage = createPage(storage)
    const secondBackPage = createPage(storage)
    firstBackPage.click("https://example.test/common/logout/")
    firstBackPage.pageshow(true)
    secondBackPage.pageshow(true)
    assert.equal(firstBackPage.reloads, 1)
    assert.equal(secondBackPage.reloads, 1)
})

test("marks logout forms and ignores non-logout navigation", () => {
    const page = createPage()
    page.submit("https://example.test/orga/logout/")
    assert.equal(page.storage.get("eventyay.logout-version"), "1")

    const otherPage = createPage()
    otherPage.click("https://example.test/event/")
    otherPage.pageshow(true)
    assert.equal(otherPage.reloads, 0)
})

test("does not reload a fresh page restored from BFCache without a later logout", () => {
    const storage = new Map()
    const logoutPage = createPage(storage)
    logoutPage.submit("https://example.test/logout/")
    const freshPage = createPage(storage)
    freshPage.pageshow(true)
    assert.equal(freshPage.reloads, 0)
})
