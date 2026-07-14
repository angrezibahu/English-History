/* ---------------------------------------------------------------------------
   A History of England — app shell.
   Hash-routed SPA: #/ syllabus, #/w/<term>/<week> a week page.
   No framework, no backend. Reads course/index.json (generated at build time),
   renders markdown, plays audio, tracks "listened" ticks in localStorage, and
   registers the service worker for offline use.
--------------------------------------------------------------------------- */
(function () {
  "use strict";

  var BASE = location.pathname.replace(/[^/]*$/, ""); // dir the app is served from
  var INDEX_URL = "./course/index.json";
  var LS_PREFIX = "eh:listened:";

  var main = document.getElementById("main");
  var loadingEl = document.querySelector("[data-app-loading]");
  var courseTitleEls = document.querySelectorAll("[data-course-title]");

  var course = null; // loaded index
  var weekIndex = {}; // "term/week" -> { week, term, prev, next }

  // --- small helpers -------------------------------------------------------
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === "text") node.textContent = attrs[k];
        else if (k === "html") node.innerHTML = attrs[k];
        else if (k === "class") node.className = attrs[k];
        else if (attrs[k] != null && attrs[k] !== false) node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function (c) {
      if (c == null) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

  function setMain(node) {
    main.innerHTML = "";
    main.appendChild(node);
    main.focus();
    window.scrollTo(0, 0);
  }

  function listenedKey(id) {
    return LS_PREFIX + id;
  }
  function isListened(id) {
    try {
      return localStorage.getItem(listenedKey(id)) === "1";
    } catch (e) {
      return false;
    }
  }
  function setListened(id, val) {
    try {
      if (val) localStorage.setItem(listenedKey(id), "1");
      else localStorage.removeItem(listenedKey(id));
    } catch (e) {
      /* storage may be blocked; ticks simply won't persist */
    }
  }

  function allWeeks() {
    var out = [];
    (course.terms || []).forEach(function (t) {
      (t.weeks || []).forEach(function (w) {
        out.push(w);
      });
    });
    return out;
  }

  function buildWeekIndex() {
    weekIndex = {};
    var flat = allWeeks();
    flat.forEach(function (w, i) {
      weekIndex[w.id] = { week: w, prev: flat[i - 1] || null, next: flat[i + 1] || null };
    });
  }

  // --- data ---------------------------------------------------------------
  function loadCourse() {
    return fetch(INDEX_URL, { cache: "no-cache" })
      .then(function (r) {
        if (!r.ok) throw new Error("index " + r.status);
        return r.json();
      })
      .then(function (data) {
        course = data;
        buildWeekIndex();
        if (course.title) {
          document.title = course.title;
          courseTitleEls.forEach(function (n) {
            n.textContent = course.title;
          });
        }
        return course;
      });
  }

  // --- views: syllabus ----------------------------------------------------
  function renderHome() {
    var weeks = allWeeks();
    var done = weeks.filter(function (w) {
      return isListened(w.id);
    }).length;
    var pct = weeks.length ? Math.round((done / weeks.length) * 100) : 0;

    var frag = el("div", null, [
      el("section", { class: "hero" }, [
        el("h1", { text: course.title || "History Course" }),
        course.description ? el("p", { text: course.description }) : null,
        el("div", { class: "progress-summary" }, [
          el("div", { class: "progress-track" }, [
            el("div", { class: "progress-fill", style: "width:" + pct + "%" }),
          ]),
          el("span", { text: done + " / " + weeks.length + " listened" }),
        ]),
      ]),
    ]);

    if (!weeks.length) {
      frag.appendChild(
        el("div", { class: "empty" }, [
          "No weeks found yet. Add content under ",
          el("code", { text: "course/term-N/week-NN/" }),
          " and rebuild the index.",
        ])
      );
    }

    (course.terms || []).forEach(function (term) {
      var list = el("ul", { class: "week-list" });
      (term.weeks || []).forEach(function (w) {
        list.appendChild(weekCard(w));
      });
      frag.appendChild(
        el("section", { class: "term" }, [
          el("div", { class: "term__head" }, [
            el("h2", { text: term.title || "Term " + term.number }),
            el("span", { class: "term__count", text: term.weeks.length + " weeks" }),
          ]),
          list,
        ])
      );
    });

    setMain(frag);
  }

  function weekCard(w) {
    var listened = isListened(w.id);
    var meta = [];
    if (w.audio) meta.push("Audio");
    meta.push((w.docs ? w.docs.length : 0) + (w.docs && w.docs.length === 1 ? " note" : " notes"));

    return el(
      "li",
      null,
      [
        el(
          "a",
          {
            class: "week-card",
            href: "#/w/" + w.id,
            "data-listened": listened ? "true" : "false",
          },
          [
            el("span", { class: "week-num", "aria-hidden": "true", text: String(w.number) }),
            el("span", { class: "week-card__body" }, [
              el("span", { class: "week-card__title", text: w.title }),
              el("span", { class: "week-card__meta", text: "Week " + w.number + " · " + meta.join(" · ") }),
            ]),
            el("span", {
              class: "tick",
              "aria-hidden": "true",
              html: "&#10003;",
              title: listened ? "Listened" : "Not listened",
            }),
          ]
        ),
      ]
    );
  }

  // --- views: week --------------------------------------------------------
  function renderWeek(id) {
    var entry = weekIndex[id];
    if (!entry) {
      setMain(
        el("div", { class: "empty" }, [
          el("p", { text: "That week could not be found." }),
          el("p", null, [el("a", { href: "#/", text: "← Back to the syllabus" })]),
        ])
      );
      return;
    }
    var w = entry.week;
    document.title = w.title + " · " + (course.title || "History");

    var container = el("div");

    container.appendChild(
      el("nav", { class: "crumbs" }, [
        el("a", { href: "#/", text: course.title || "Syllabus" }),
        " / Term " + w.term,
      ])
    );

    container.appendChild(
      el("header", { class: "week-header" }, [
        el("p", { class: "eyebrow", text: "Term " + w.term + " · Week " + w.number }),
        el("h1", { text: w.title }),
      ])
    );

    // Audio player.
    if (w.audio) {
      container.appendChild(buildPlayer(w));
    } else {
      container.appendChild(el("div", { class: "notice", text: "No audio for this week yet." }));
    }

    // Docs.
    var docsWrap = el("div", { class: "docs" }, [
      el("div", { class: "loading", text: "Loading notes…" }),
    ]);
    container.appendChild(docsWrap);

    // Prev / next.
    container.appendChild(
      el("nav", { class: "week-nav" }, [
        navLink(entry.prev, "prev"),
        navLink(entry.next, "next"),
      ])
    );

    setMain(container);
    loadDocs(w, docsWrap);
  }

  function navLink(w, dir) {
    if (!w) return el("a", { class: "btn", "aria-disabled": "true", href: "#/" });
    return el("a", { class: "btn", href: "#/w/" + w.id }, [
      dir === "prev" ? "← " + shorten(w.title) : shorten(w.title) + " →",
    ]);
  }
  function shorten(s) {
    return s.length > 28 ? s.slice(0, 27).trim() + "…" : s;
  }

  function loadDocs(w, wrap) {
    var docs = w.docs || [];
    if (!docs.length) {
      wrap.innerHTML = "";
      wrap.appendChild(el("div", { class: "notice", text: "No notes for this week yet." }));
      return;
    }
    Promise.all(
      docs.map(function (name) {
        return fetch(w.path + "/" + name)
          .then(function (r) {
            if (!r.ok) throw new Error(name + " " + r.status);
            return r.text();
          })
          .then(function (md) {
            return { name: name, md: md };
          })
          .catch(function () {
            return { name: name, md: "*Could not load " + name + ".*" };
          });
      })
    ).then(function (results) {
      wrap.innerHTML = "";
      results.forEach(function (d, i) {
        var md = d.md;
        // The page header already shows the week title (taken from the primary
        // doc's first heading); drop that duplicate leading heading here.
        if (i === 0) md = stripLeadingHeading(md, w.title);
        wrap.appendChild(el("article", { class: "doc", html: window.renderMarkdown(md) }));
      });
    });
  }

  function stripLeadingHeading(md, title) {
    var lines = md.replace(/\r\n?/g, "\n").split("\n");
    var k = 0;
    while (k < lines.length && lines[k].trim() === "") k++;
    var m = lines[k] && lines[k].match(/^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/);
    if (m && m[1].trim() === String(title).trim()) {
      lines.splice(0, k + 1);
      return lines.join("\n");
    }
    return md;
  }

  // --- audio player -------------------------------------------------------
  function buildPlayer(w) {
    var listened = isListened(w.id);
    var audioUrl = w.path + "/" + w.audio;

    var audio = el("audio", { controls: "", preload: "metadata", src: audioUrl });

    var tickBtn = el("button", {
      type: "button",
      class: "btn" + (listened ? " btn--primary" : ""),
      "data-tick": "",
    });
    function paintTick() {
      var on = isListened(w.id);
      tickBtn.className = "btn" + (on ? " btn--primary" : "");
      tickBtn.innerHTML = (on ? "&#10003; Listened" : "Mark as listened");
    }
    paintTick();
    tickBtn.addEventListener("click", function () {
      setListened(w.id, !isListened(w.id));
      paintTick();
    });

    // Auto-mark when the lecture finishes.
    audio.addEventListener("ended", function () {
      if (!isListened(w.id)) {
        setListened(w.id, true);
        paintTick();
      }
    });

    var saveState = el("span", { class: "save-state", "data-saved": "false" });
    var saveBtn = el("button", { type: "button", class: "btn btn--ghost", text: "Save for offline" });

    // Reflect whether the audio is already in the cache.
    refreshSaved(audioUrl, saveState, saveBtn);

    saveBtn.addEventListener("click", function () {
      saveBtn.disabled = true;
      saveState.textContent = "Saving…";
      cacheAudio(audioUrl)
        .then(function () {
          saveState.textContent = "Saved for offline";
          saveState.setAttribute("data-saved", "true");
          saveBtn.textContent = "Saved";
        })
        .catch(function () {
          saveState.textContent = "Could not save";
          saveBtn.disabled = false;
        });
    });

    return el("section", { class: "player", "aria-label": "Lecture audio" }, [
      el("div", { class: "player__label" }, [
        el("span", { text: "Lecture" }),
        tickBtn,
      ]),
      audio,
      el("div", { class: "player__actions" }, [saveBtn, saveState]),
    ]);
  }

  function refreshSaved(url, stateEl, btn) {
    if (!("caches" in window)) {
      btn.hidden = true;
      return;
    }
    caches.match(url).then(function (hit) {
      if (hit) {
        stateEl.textContent = "Available offline";
        stateEl.setAttribute("data-saved", "true");
        btn.textContent = "Saved";
        btn.disabled = true;
      }
    });
  }

  // Prefetch + cache the audio so it plays with no network.
  function cacheAudio(url) {
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      // Let the SW own the write so its runtime cache is authoritative.
      return new Promise(function (resolve, reject) {
        var ch = new MessageChannel();
        var timer = setTimeout(function () {
          reject(new Error("timeout"));
        }, 30000);
        ch.port1.onmessage = function (e) {
          clearTimeout(timer);
          e.data && e.data.ok ? resolve() : reject(new Error("cache failed"));
        };
        navigator.serviceWorker.controller.postMessage({ type: "cache-audio", url: url }, [ch.port2]);
      });
    }
    // Fallback: fetch (the SW's fetch handler will cache it) or write directly.
    if ("caches" in window) {
      return fetch(url).then(function (r) {
        if (!r.ok) throw new Error("fetch " + r.status);
        return caches.open("eh-audio").then(function (c) {
          return c.put(url, r.clone());
        });
      });
    }
    return Promise.reject(new Error("no cache api"));
  }

  // --- router -------------------------------------------------------------
  function route() {
    var hash = location.hash.replace(/^#/, "") || "/";
    var m = hash.match(/^\/w\/([^/]+)\/([^/]+)\/?$/);
    if (m) {
      renderWeek(m[1] + "/" + m[2]);
    } else {
      renderHome();
    }
  }

  // --- PWA plumbing -------------------------------------------------------
  function registerSW() {
    if (!("serviceWorker" in navigator)) return;
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("./sw.js").catch(function (e) {
        console.warn("SW registration failed:", e);
      });
    });
  }

  function setupInstall() {
    var btn = document.querySelector("[data-install]");
    if (!btn) return;
    var deferred = null;
    window.addEventListener("beforeinstallprompt", function (e) {
      e.preventDefault();
      deferred = e;
      btn.hidden = false;
    });
    btn.addEventListener("click", function () {
      if (!deferred) return;
      deferred.prompt();
      deferred.userChoice.finally(function () {
        deferred = null;
        btn.hidden = true;
      });
    });
    window.addEventListener("appinstalled", function () {
      btn.hidden = true;
    });
  }

  function setupOfflineBadge() {
    var badge = document.querySelector("[data-offline-badge]");
    if (!badge) return;
    function update() {
      badge.hidden = navigator.onLine;
    }
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    update();
  }

  // --- boot ---------------------------------------------------------------
  function boot() {
    registerSW();
    setupInstall();
    setupOfflineBadge();

    loadCourse()
      .then(function () {
        if (loadingEl) loadingEl.remove();
        window.addEventListener("hashchange", route);
        route();
      })
      .catch(function (err) {
        console.error(err);
        setMain(
          el("div", { class: "empty" }, [
            el("p", { text: "Could not load the course." }),
            el("p", { class: "week-card__meta", text: String(err.message || err) }),
          ])
        );
      });
  }

  boot();
})();
