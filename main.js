// @ts-check
// The extension of this plugin: plain JavaScript, no build step, types through JSDoc
// (questkeep-plugin.d.ts next to this file is the API reference). Questkeep imports this module
// and calls `activate(api)`. Everything registered through `api` is removed again when the plugin
// is disabled, removed or reloaded, so there is nothing to clean up by hand.
//
// Extensions are trusted code: they can do everything the app's own interface can. Keep yours to
// what the plugin's description promises.

/** @typedef {import("./questkeep-plugin").QuestkeepApi} QuestkeepApi */

// Icons are SVG markup. Use `currentColor` so they follow the theme's text color.
const ICON_HELLO =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 14a4.5 4.5 0 0 0 8 0"/><path d="M9 9.5h.01M15 9.5h.01"/></svg>';

/**
 * A small DOM helper: `h("button", { class: "btn", onclick: fn }, "Label")`.
 * @param {string} tag
 * @param {Record<string, unknown>} [props]
 * @param {...(Node | string)} children
 */
function h(tag, props = {}, ...children) {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) {
    if (name.startsWith("on") && typeof value === "function") {
      element.addEventListener(name.slice(2), /** @type {EventListener} */ (value));
    } else if (value !== undefined && value !== null && value !== false) {
      element.setAttribute(name, value === true ? "" : String(value));
    }
  }
  element.append(...children);
  return element;
}

/**
 * The dialog the title bar button opens: how many games the library has.
 * @param {QuestkeepApi} api
 */
function showHello(api) {
  api.ui.showDialog({
    title: api.plugin.name,
    width: "small",
    render(container, close) {
      const text = h("p", { class: "my-plugin__text" }, "Counting your games…");
      const done = h("button", { type: "button", class: "btn btn--primary" }, "Close");
      done.addEventListener("click", close);
      container.append(h("div", { class: "my-plugin" }, text, h("div", { class: "my-plugin__actions" }, done)));

      let closed = false;
      void api.games.list().then((games) => {
        if (closed) return;
        const real = games.filter((game) => game.kind === "game");
        text.textContent = `Your library has ${real.length.toLocaleString()} games.`;
      });
      // The function returned from `render` runs when the dialog goes away.
      return () => {
        closed = true;
      };
    },
  });
}

/** @type {import("./questkeep-plugin").ExtensionModule["activate"]} */
export function activate(api) {
  // One button in the title bar (left of Settings).
  api.ui.addTitleBarButton({
    id: "hello",
    label: "Say hello",
    icon: ICON_HELLO,
    onClick: () => showHello(api),
  });

  // "greet" is declared under extension.settings in plugin.json: Questkeep draws the control in
  // Settings, in a section named after the plugin, and api.settings reads and watches it.
  if (api.settings.get("greet", true)) {
    api.ui.toast(`${api.plugin.name} ${api.plugin.version} is running.`);
  }
  api.log.info("activated");
}

export function deactivate() {
  // Nothing to do: everything above was registered through `api` and is removed by the app.
}
