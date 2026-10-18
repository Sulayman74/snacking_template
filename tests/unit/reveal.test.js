// @vitest-environment jsdom
// ✨ Tests unitaires — révélation au défilement (src/core/reveal.js) : un observateur
// partagé, one-shot, idempotent ; repli immédiat sans IntersectionObserver ou sous
// prefers-reduced-motion ; rien n'est masqué sans la classe html.js-reveal.
import { describe, it, expect, beforeEach, vi } from "vitest";

let instances;
class FakeIO {
  constructor(cb, options) { this.cb = cb; this.options = options; this.observed = new Set(); instances.push(this); }
  observe(el) { this.observed.add(el); }
  unobserve(el) { this.observed.delete(el); }
  disconnect() { this.observed.clear(); }
  trigger(targets) { this.cb(targets.map((target) => ({ target, isIntersecting: true })), this); }
}

async function load({ reduced = false, io = true } = {}) {
  vi.resetModules();
  instances = [];
  window.matchMedia = vi.fn().mockReturnValue({ matches: reduced, addEventListener() {}, removeEventListener() {} });
  if (io) globalThis.IntersectionObserver = FakeIO; else delete globalThis.IntersectionObserver;
  return import("../../src/core/reveal.js");
}

beforeEach(() => {
  document.documentElement.className = "";
  document.body.innerHTML = `<section><div class="reveal" id="a"></div><div class="reveal" id="b"></div><div id="c"></div></section>`;
});

describe("initReveal / observeReveal", () => {
  it("pose html.js-reveal, observe chaque .reveal une seule fois avec UN observateur partagé", async () => {
    const { initReveal, observeReveal } = await load();
    expect(initReveal()).toBe(2);
    expect(document.documentElement.classList.contains("js-reveal")).toBe(true);
    expect(instances).toHaveLength(1);
    expect(instances[0].observed.size).toBe(2);
    expect(instances[0].options).toEqual({ threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
    expect(observeReveal()).toBe(0); // idempotent : rien de nouveau
  });

  it("révèle à l'intersection puis cesse d'observer (one-shot)", async () => {
    const { initReveal } = await load();
    initReveal();
    const a = document.getElementById("a");
    instances[0].trigger([a]);
    expect(a.classList.contains("is-visible")).toBe(true);
    expect(instances[0].observed.has(a)).toBe(false);
    expect(document.getElementById("b").classList.contains("is-visible")).toBe(false);
  });

  it("prend en charge les éléments ajoutés plus tard (menu arrivé) sans doublon", async () => {
    const { initReveal, observeReveal } = await load();
    initReveal();
    document.body.insertAdjacentHTML("beforeend", '<div class="reveal" id="late"></div>');
    expect(observeReveal()).toBe(1);
    expect(observeReveal()).toBe(0);
    expect(instances).toHaveLength(1);
  });

  it("reduced-motion : tout visible immédiatement, aucune classe js-reveal, aucun observateur", async () => {
    const { initReveal } = await load({ reduced: true });
    expect(initReveal()).toBe(2);
    expect(document.documentElement.classList.contains("js-reveal")).toBe(false);
    expect(instances).toHaveLength(0);
    expect(document.querySelectorAll(".reveal.is-visible")).toHaveLength(2);
  });

  it("sans IntersectionObserver : repli visible immédiat", async () => {
    const { initReveal } = await load({ io: false });
    expect(initReveal()).toBe(2);
    expect(document.documentElement.classList.contains("js-reveal")).toBe(false);
    expect(document.querySelectorAll(".reveal.is-visible")).toHaveLength(2);
  });

  it("fonctionne sur un shadowRoot", async () => {
    const { observeReveal } = await load();
    const host = document.createElement("div");
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = '<section class="reveal"></section>';
    document.body.append(host);
    expect(observeReveal(root)).toBe(1);
    instances[0].trigger([root.querySelector(".reveal")]);
    expect(root.querySelector(".reveal.is-visible")).not.toBeNull();
  });
});

describe("watchInView", () => {
  it("pose puis retire la classe selon l'intersection, sans jamais désobserver", async () => {
    const { watchInView } = await load();
    const el = document.getElementById("a");
    const io = watchInView(el, "in-view");
    expect(instances).toHaveLength(1);
    expect(instances[0].options).toEqual({ threshold: 0 });
    instances[0].cb([{ target: el, isIntersecting: true }], instances[0]);
    expect(el.classList.contains("in-view")).toBe(true);
    instances[0].cb([{ target: el, isIntersecting: false }], instances[0]);
    expect(el.classList.contains("in-view")).toBe(false);
    expect(instances[0].observed.has(el)).toBe(true);
    expect(io).toBe(instances[0]);
  });
  it("sans IntersectionObserver : classe posée d'emblée ; élément absent : null", async () => {
    const { watchInView } = await load({ io: false });
    const el = document.getElementById("a");
    expect(watchInView(el)).toBeNull();
    expect(el.classList.contains("in-view")).toBe(true);
    expect(watchInView(null)).toBeNull();
  });
});
