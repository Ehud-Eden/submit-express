/* Submit Express — client-side progress tracking. */
(function () {
  "use strict";

  var CFG = window.SE_CONFIG || {
    baseUrl: "",
    dataUrl: "assets/data/app-data.json"
  };

  var TASK_PREFIX = "ck_";
  var STATUS_KEY = "app_status_";

  /* ---------- hashing & normalization (mirror hooks/progress.py) ---------- */

  function normalizeText(text) {
    return (text.normalize ? text.normalize("NFKC") : text)
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function fnv1aHex(str) {
    var bytes = new TextEncoder().encode(str);
    var h = 2166136261n;
    for (var i = 0; i < bytes.length; i++) {
      h = (h ^ BigInt(bytes[i])) * 16777619n & 0xffffffffn;
    }
    return h.toString(16).padStart(8, "0");
  }

  function taskKey(page, labelText, occurrence) {
    var norm = normalizeText(labelText);
    var slug = norm.replace(/ /g, "-");
    var base = fnv1aHex(slug);
    var key = TASK_PREFIX + page + "::" + base;
    if (occurrence > 0) key += "#" + (occurrence + 1);
    return key;
  }

  /* ---------- storage ---------- */

  function storeSupported() {
    try {
      var k = "_se_test_";
      localStorage.setItem(k, "1");
      localStorage.removeItem(k);
      return true;
    } catch (e) {
      return false;
    }
  }

  var hasStorage = storeSupported();

  function getStored(key) {
    return hasStorage ? localStorage.getItem(key) : null;
  }
  function setStored(key, value) {
    if (hasStorage) localStorage.setItem(key, value);
  }
  function removeStored(key) {
    if (hasStorage) localStorage.removeItem(key);
  }

  function emitChanged() {
    try {
      window.dispatchEvent(new CustomEvent("se:progress"));
    } catch (e) {
      /* no-op */
    }
  }

  /* ---------- per-page helpers ---------- */

  function pageSlug() {
    var path = location.pathname.replace(/\/+$/, "");
    var idx = path.lastIndexOf("/");
    var slug = idx >= 0 ? path.slice(idx + 1) : path;
    return slug.replace(/\.html$/, "");
  }

  function findContentRoot() {
    return (
      document.querySelector("article .md-content__inner") ||
      document.querySelector("article") ||
      document.body
    );
  }

  function insertProgressHeader() {
    var title = document.querySelector("article h1, .md-content article h1");
    if (!title) return null;
    var header = document.createElement("div");
    header.className = "se-progress";
    header.setAttribute("data-se-header", "");
    header.innerHTML =
      '<div class="se-progress-info">' +
      '<span class="se-progress-label">Progression de la candidature</span>' +
      '<div class="se-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-label="Progression">' +
      '<span class="se-progress-count" data-se-count>0/0</span>' +
      '<span class="se-progress-bar"><span class="se-progress-fill"></span></span>' +
      "</div></div>" +
      '<div class="se-progress-actions">' +
      '<div class="se-status-group">' +
      '<label class="se-status">Statut' +
      '<select data-se-status aria-label="Statut de cette page">' +
      '<option value="">— Sélectionner —</option>' +
      '<option value="not-started">À faire</option>' +
      '<option value="in-progress">En cours</option>' +
      '<option value="ready">Prêt</option>' +
      '<option value="submitted">Déposé</option>' +
      "</select></label></div>" +
      '<button type="button" class="se-reset" data-se-reset aria-label="Réinitialiser la progression">Réinitialiser</button>' +
      "</div>";
    title.parentNode.insertBefore(header, title.nextSibling);
    return header;
  }

  /* ---------- task list wiring ---------- */

  function wireTaskLists(page, header) {
    var root = findContentRoot();
    var items = root.querySelectorAll(
      ".task-list-item .task-list-control"
    );
    var counts = {};
    var headerCount = header
      ? header.querySelector("[data-se-count]")
      : null;
    var headerFill = header ? header.querySelector(".se-progress-fill") : null;
    var headerTrack = header ? header.querySelector(".se-progress-track") : null;

    function updateHeader() {
      var done = root.querySelectorAll(
        ".task-list-item input[type='checkbox']:checked"
      ).length;
      var total = items.length;
      if (headerCount) headerCount.textContent = done + "/" + total;
      var pct = total ? Math.round((done / total) * 100) : 0;
      if (headerTrack) {
        headerTrack.setAttribute("aria-valuenow", String(pct));
        headerTrack.setAttribute("aria-valuetext", done + " sur " + total);
      }
      if (headerFill) headerFill.style.width = pct + "%";
    }

    updateHeader();

    items.forEach(function (label) {
      var input = label.querySelector('input[type="checkbox"]');
      if (!input) return;

      var row = label.parentElement;
      var contentEl = row.querySelector(".task-list-content, p");
      var text = label.textContent || input.getAttribute("title") || "";
      if (!contentEl && row) text = row.textContent.replace(/\s+/g, " ");

      var norm = normalizeText(text);
      var occ = counts[norm] || 0;
      counts[norm] = occ + 1;
      var key = taskKey(page, text, occ);

      input.dataset.seKey = key;
      if (getStored(key) === "1") input.checked = true;

      input.addEventListener("change", function () {
        setStored(key, input.checked ? "1" : "0");
        updateHeader();
        emitChanged();
      });

      if (contentEl) {
        contentEl.addEventListener("click", function (e) {
          if (e.target && e.target.closest && e.target.closest("a")) return;
          input.click();
        });
      }
    });
    updateHeader();

    var statusEl = header ? header.querySelector("[data-se-status]") : null;
    var storedStatus = getStored(STATUS_KEY + page);
    if (statusEl) {
      statusEl.value = storedStatus || "";
      statusEl.addEventListener("change", function () {
        if (statusEl.value) setStored(STATUS_KEY + page, statusEl.value);
        else removeStored(STATUS_KEY + page);
        emitChanged();
      });
    }

    var resetBtn = header ? header.querySelector("[data-se-reset]") : null;
    if (resetBtn) {
      resetBtn.addEventListener("click", function () {
        if (
          !window.confirm("Réinitialiser la progression de cette page ?")
        ) {
          return;
        }
        var stored = [];
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (k && k.indexOf(TASK_PREFIX + page + "::") === 0) stored.push(k);
        }
        stored.forEach(removeStored);
        removeStored(STATUS_KEY + page);
        root.querySelectorAll(
          ".task-list-item input[type='checkbox']"
        ).forEach(function (inp) {
          inp.checked = false;
        });
        updateHeader();
        emitChanged();
      });
    }

    return updateHeader;
  }

  /* ---------- dashboard ---------- */

  function fetchData() {
    var url = CFG.dataUrl || "assets/data/app-data.json";
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  function doneCountFor(tasks) {
    var done = 0;
    tasks.forEach(function (task) {
      if (getStored(TASK_PREFIX + task.key) === "1") done += 1;
    });
    return done;
  }

  function pageStatus(stem) {
    return getStored(STATUS_KEY + stem) || "";
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      }[c];
    });
  }

  function statusLabel(code) {
    return (
      {
        "not-started": "À faire",
        "in-progress": "En cours",
        ready: "Prêt",
        submitted: "Déposé"
      }[code] || ""
    );
  }

  function stemFromUrl(url) {
    return String(url || "").replace(/\/+$/, "").split("/").pop();
  }

  function renderDashboard() {
    var mount = document.querySelector("[data-se-dashboard]");
    if (!mount) return;
    mount.innerHTML = '<div class="se-loader">Chargement de votre tableau de bord…</div>';

    fetchData()
      .then(function (data) {
        var html = "";
        var stats = { done: 0, total: 0 };

        // Prepare stats first
        data.categories.forEach(function (cat) {
          (cat.pages || []).forEach(function (p) {
            stats.total += (p.tasks || []).length;
            stats.done += doneCountFor(p.tasks || []);
          });
        });

        var overall = stats.total ? Math.round((stats.done / stats.total) * 100) : 0;

        // Overall progress hero
        html +=
          '<div class="se-dash-overall" role="progressbar" aria-valuemin="0"' +
          ' aria-valuemax="100" aria-valuenow="' +
          overall +
          '" aria-label="Progression globale">' +
          '<div class="se-dash-overall-content">' +
          '<span class="se-dash-overall-label">Progression globale</span>' +
          '<span class="se-dash-count">' + stats.done + ' <span class="se-dash-count-sep">/</span> ' + stats.total + ' <small>tâches</small></span>' +
          '</div>' +
          '<div class="se-dash-bar se-dash-bar-lg">' +
          '<span class="se-dash-fill" style="width:' + overall + '%"></span>' +
          '</div>' +
          '<div class="se-dash-pct">' + overall + '%</div>' +
          '</div>';

        data.categories.forEach(function (cat) {
          var rows = (cat.pages || []).map(function (p) {
            var total = (p.tasks || []).length;
            var done = doneCountFor(p.tasks || []);
            var pct = total ? Math.round((done / total) * 100) : 0;
            var st = pageStatus(stemFromUrl(p.url));
            var status = st || (pct === 100 && total > 0 ? "submitted" : "");

            var pill = status
              ? '<span class="se-pill se-pill-' + esc(status) + '">' +
                esc(statusLabel(status)) +
                "</span>"
              : '<span class="se-pill se-pill-none">Aucun statut</span>';

            return (
              '<li class="se-dash-page">' +
              '<div class="se-dash-page-header">' +
              pill +
              '</div>' +
              '<a class="se-dash-link" href="' + CFG.baseUrl + "/" + esc(p.url) + '">' +
              esc(p.title) +
              "</a>" +
              '<div class="se-dash-page-footer">' +
              '<div class="se-dash-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '">' +
              '<span class="se-dash-fill" style="width:' + pct + '%"></span>' +
              '</div>' +
              '<span class="se-dash-meta">' + done + ' / ' + total + '</span>' +
              '</div>' +
              '</li>'
            );
          }).join("");

          html +=
            '<section class="se-dash-cat">' +
            "<h2>" + esc(cat.name) + "</h2>" +
            '<ul class="se-dash-pages">' + rows + "</ul>" +
            "</section>";
        });

        mount.innerHTML = html;
      })
      .catch(function () {
        mount.innerHTML =
          '<p class="se-dash-error">Impossible de charger les données ' +
          "(" +
          esc(CFG.dataUrl) +
          "). Ce tableau de bord nécessite un déploiement servi via HTTP.</p>";
      });
  }

  /* ---------- external links ---------- */

  function tagExternalLinks() {
    document.querySelectorAll('a[href^="http://"], a[href^="https://"]').forEach(
      function (a) {
        try {
          var u = new URL(a.href);
          if (u.hostname !== location.hostname) {
            a.setAttribute("target", "_blank");
            a.setAttribute("rel", "noopener noreferrer");
            a.classList.add("se-ext");
          }
        } catch (e) {
          /* ignore malformed URLs */
        }
      }
    );
  }

  /* ---------- init ---------- */

  function init() {
    tagExternalLinks();

    var header = insertProgressHeader();
    if (
      header &&
      document.querySelector(".task-list-item input[type='checkbox']")
    ) {
      wireTaskLists(pageSlug(), header);
    } else if (header) {
      header.setAttribute("hidden", "");
    }

    if (document.querySelector("[data-se-dashboard]")) {
      renderDashboard();
      window.addEventListener("storage", renderDashboard);
      window.addEventListener("focus", renderDashboard);
      window.addEventListener("se:progress", renderDashboard);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();