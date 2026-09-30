const fs = require("node:fs");
const path = require("node:path");

// Keep collecting across webview reloads, but bound memory during long benchmark runs.
module.exports = function diagnostics({ artifacts, connections, graph, runtime }) {
  const events = [];
  let scenario = "suite setup";
  let captured = false;
  let sequence = 0;
  const write = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
  write(path.join(artifacts, "run.json"), runtime);
  return {
    start(title) {
      scenario = title;
      captured = false;
    },
    record(target, message) {
      if (
        !["Runtime.consoleAPICalled", "Runtime.exceptionThrown", "Log.entryAdded"].includes(
          message.method
        )
      ) {
        return;
      }
      events.push({
        time: new Date().toISOString(),
        scenario,
        target,
        method: message.method,
        params: message.params
      });
      if (events.length > 500) {
        events.shift();
      }
    },
    async capture(error, phase) {
      if (captured) {
        return;
      }
      captured = true;
      const name = scenario.replace(/[^a-z0-9]+/gi, "-").slice(0, 100);
      const directory = path.join(artifacts, `failure-${Date.now()}-${++sequence}-${name}`);
      const report = {
        ...runtime,
        scenario,
        phase,
        error: error?.stack || String(error),
        captureErrors: []
      };
      // A dead renderer must not prevent logs/metadata from being saved or mask the test error.
      try {
        fs.mkdirSync(directory, { recursive: true });
        const attempts = await Promise.allSettled([
          (async () => {
            const page = connections.find((c) => c.type === "page" && c.ws.readyState === 1);
            if (!page) {
              throw new Error("No live workbench target for screenshot");
            }
            const { data } = await page.call("Page.captureScreenshot", { format: "png" });
            fs.writeFileSync(path.join(directory, "workbench.png"), Buffer.from(data, "base64"));
          })(),
          (async () => {
            // Stylesheets show whether the page's CSS arrived, which its DOM alone does not.
            const document = await graph()?.evaluate(`({
              text: document.body.innerText,
              html: document.documentElement.outerHTML,
              styleSheets: [...document.styleSheets].map((sheet) => {
                let rules = null;
                try { rules = sheet.cssRules.length; } catch {}
                return { href: sheet.href, rules, disabled: sheet.disabled };
              })
            })`);
            if (!document) {
              throw new Error("No graph context for DOM capture");
            }
            fs.writeFileSync(path.join(directory, "webview.txt"), document.text);
            fs.writeFileSync(path.join(directory, "webview.html"), document.html);
            write(path.join(directory, "webview-styles.json"), document.styleSheets);
          })()
        ]);
        attempts.forEach((result, index) => {
          if (result.status === "rejected") {
            report.captureErrors.push({
              artifact: index === 0 ? "screenshot" : "DOM",
              error: String(result.reason)
            });
          }
        });
        fs.writeFileSync(
          path.join(directory, "browser.jsonl"),
          events.map((event) => JSON.stringify(event)).join("\n") + "\n"
        );
        write(path.join(directory, "failure.json"), report);
        process.stderr.write(`UI failure diagnostics: ${directory}\n`);
      } catch (captureError) {
        process.stderr.write(`Could not save UI diagnostics: ${captureError}\n`);
      }
    }
  };
};
