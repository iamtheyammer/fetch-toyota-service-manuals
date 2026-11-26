import { TreeNode } from "./tree";

/** Escape text for literal inclusion in HTML (used for titles rendered server-side). */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Embed arbitrary data as a JS literal without letting `</script>` break out. */
function embed(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

const STYLE = `
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body { font: 14px/1.4 -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color: #1a1a1a; }
  #app { display: flex; height: 100vh; }
  #sidebar { width: 380px; min-width: 260px; max-width: 60%; border-right: 1px solid #ddd;
    display: flex; flex-direction: column; background: #fafafa; }
  #sidebar header { padding: 10px 12px; border-bottom: 1px solid #e3e3e3; }
  #sidebar h1 { font-size: 14px; margin: 0 0 8px; font-weight: 600; word-break: break-word; }
  #search { width: 100%; padding: 6px 8px; border: 1px solid #ccc; border-radius: 4px; font: inherit; }
  #scroll { overflow: auto; padding: 6px 4px 24px; flex: 1; }
  #tree ul { list-style: none; margin: 0; padding-left: 14px; }
  #tree > ul { padding-left: 4px; }
  details > summary { cursor: pointer; padding: 2px 4px; border-radius: 4px; user-select: none;
    list-style-position: inside; }
  details > summary:hover { background: #eee; }
  a.leaf { display: block; padding: 2px 6px; border-radius: 4px; color: #0a58ca;
    text-decoration: none; cursor: pointer; word-break: break-word; }
  a.leaf:hover { background: #e9f0fe; }
  a.leaf.active, a.ritem.active { background: #0a58ca; color: #fff; }
  a.ritem.active .rsnip { color: #dce7fb; }
  .hidden { display: none !important; }
  .rcount { font-size: 12px; color: #777; padding: 2px 6px 8px; }
  a.ritem { display: block; padding: 6px; margin: 0 2px 4px; border-radius: 4px; text-decoration: none;
    color: #0a58ca; cursor: pointer; }
  a.ritem:hover { background: #e9f0fe; }
  .rtitle { font-size: 13px; word-break: break-word; }
  .rsnip { font-size: 12px; color: #555; margin-top: 2px; word-break: break-word; }
  #main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  #bar { padding: 6px 12px; border-bottom: 1px solid #e3e3e3; font-size: 13px; color: #555;
    display: flex; gap: 12px; align-items: center; }
  #bar #open { margin-left: auto; }
  #refs { border-bottom: 1px solid #e3e3e3; background: #fbfbfd; max-height: 150px;
    overflow: auto; padding: 6px 12px 8px; }
  #refs .rhdr { font-size: 11px; text-transform: uppercase; letter-spacing: .04em;
    color: #888; margin-bottom: 4px; }
  #refs a { display: block; padding: 3px 6px; border-radius: 4px; color: #0a58ca;
    text-decoration: none; font-size: 13px; word-break: break-word; }
  #refs a:hover { background: #e9f0fe; }
  #viewer { flex: 1; border: 0; width: 100%; background: #fff; }
`;

const SCRIPT = `
  var TREE = window.__TREE__ || [];
  var treeEl = document.getElementById('tree');
  var resultsEl = document.getElementById('results');
  var viewer = document.getElementById('viewer');
  var openLink = document.getElementById('open');
  var refsEl = document.getElementById('refs');
  var current = null;

  // Show the local pages this document cross-references (its "INFO" links),
  // from the prebuilt window.__REFS__. Browsers block the in-PDF links from
  // reaching local files, so this panel is the offline way to follow them.
  function renderRefs(href) {
    var map = window.__REFS__ || {};
    var list = map[href];
    refsEl.textContent = '';
    if (!list || !list.length) { refsEl.classList.add('hidden'); return; }
    var hdr = document.createElement('div');
    hdr.className = 'rhdr';
    hdr.textContent = 'Referenced in this page (' + list.length + ')';
    refsEl.appendChild(hdr);
    list.forEach(function (r) {
      var a = document.createElement('a');
      a.href = r.href;
      a.textContent = r.title;
      a.addEventListener('click', function (e) { e.preventDefault(); openDoc(r.href); });
      refsEl.appendChild(a);
    });
    refsEl.classList.remove('hidden');
  }

  function openDoc(href) {
    viewer.src = href;
    openLink.href = href;
    openLink.classList.remove('hidden');
    renderRefs(href);
  }
  function select(el, href) {
    if (current) current.classList.remove('active');
    current = el;
    el.classList.add('active');
    openDoc(href);
  }

  // ---- tree ----
  function build(nodes) {
    var ul = document.createElement('ul');
    nodes.forEach(function (n) {
      var li = document.createElement('li');
      if (n.children) {
        var det = document.createElement('details');
        var sum = document.createElement('summary');
        sum.textContent = n.label;
        det.appendChild(sum);
        det.appendChild(build(n.children));
        li.appendChild(det);
      } else {
        var a = document.createElement('a');
        a.className = 'leaf';
        a.textContent = n.label;
        a.setAttribute('data-href', n.href);
        a.href = n.href;
        a.addEventListener('click', function (e) { e.preventDefault(); select(a, n.href); });
        li.appendChild(a);
      }
      ul.appendChild(li);
    });
    return ul;
  }
  treeEl.appendChild(build(TREE));

  // Fallback used only when there is no search index: filter the tree by title.
  function filterTree(q) {
    treeEl.querySelectorAll('a.leaf').forEach(function (a) {
      var match = !q || a.textContent.toLowerCase().indexOf(q) !== -1;
      a.parentNode.classList.toggle('hidden', !match);
    });
    treeEl.querySelectorAll('li').forEach(function (li) {
      var det = li.querySelector(':scope > details');
      if (!det) return;
      var anyVisible = det.querySelectorAll('a.leaf:not(.hidden)').length > 0;
      li.classList.toggle('hidden', !!q && !anyVisible);
      det.open = !!q && anyVisible;
    });
  }

  // ---- content search (uses the prebuilt index) ----
  function snippet(text, q) {
    var i = text.toLowerCase().indexOf(q);
    if (i === -1) return '';
    var start = Math.max(0, i - 30);
    var end = Math.min(text.length, i + q.length + 60);
    return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
  }
  function showResults(list, q) {
    treeEl.classList.add('hidden');
    resultsEl.classList.remove('hidden');
    resultsEl.textContent = '';
    var matches = [];
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e._h === undefined) e._h = (e.title + '\\n' + e.text).toLowerCase();
      if (e._h.indexOf(q) === -1) continue;
      matches.push({ e: e, titleMatch: e.title.toLowerCase().indexOf(q) !== -1 });
    }
    matches.sort(function (a, b) { return (b.titleMatch ? 1 : 0) - (a.titleMatch ? 1 : 0); });

    var count = document.createElement('div');
    count.className = 'rcount';
    count.textContent = matches.length + ' result' + (matches.length === 1 ? '' : 's') +
      (matches.length > 300 ? ' (showing first 300)' : '');
    resultsEl.appendChild(count);

    matches.slice(0, 300).forEach(function (m) {
      var e = m.e;
      var item = document.createElement('a');
      item.className = 'ritem';
      item.href = e.href;
      item.setAttribute('data-href', e.href);
      var t = document.createElement('div');
      t.className = 'rtitle';
      t.textContent = e.title;
      item.appendChild(t);
      var snip = snippet(e.text, q);
      if (snip) {
        var s = document.createElement('div');
        s.className = 'rsnip';
        s.textContent = snip;
        item.appendChild(s);
      }
      item.addEventListener('click', function (ev) {
        ev.preventDefault();
        select(this, this.getAttribute('data-href'));
      });
      resultsEl.appendChild(item);
    });
  }

  function onSearch() {
    var q = searchBox.value.trim().toLowerCase();
    var list = window.__SEARCH__;
    if (list && list.length && q) {
      showResults(list, q);
    } else {
      resultsEl.classList.add('hidden');
      resultsEl.textContent = '';
      treeEl.classList.remove('hidden');
      filterTree(q);
    }
  }

  var searchBox = document.getElementById('search');
  var timer = null;
  searchBox.addEventListener('input', function () {
    clearTimeout(timer);
    timer = setTimeout(onSearch, 180);
  });
`;

function page(title: string, head: string, body: string, script: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${STYLE}</style>
${head}
</head>
<body>
${body}
<script>${script}</script>
</body>
</html>
`;
}

/** A self-contained two-pane offline browser for one manual. Tree data is embedded;
 *  the full-text search index is loaded from the sibling `search-index.js`. */
export function renderManualPage(title: string, tree: TreeNode[]): string {
  const placeholder = "Search this manual…";
  const body = `<div id="app">
  <aside id="sidebar">
    <header>
      <h1>${esc(title)}</h1>
      <input id="search" type="search" placeholder="${placeholder}" autocomplete="off">
    </header>
    <div id="scroll">
      <nav id="tree"></nav>
      <div id="results" class="hidden"></div>
    </div>
  </aside>
  <section id="main">
    <div id="bar"><span>Select a page to view it here.</span>
      <a id="open" class="hidden" target="_blank" rel="noopener">open in new tab ↗</a></div>
    <div id="refs" class="hidden"></div>
    <iframe id="viewer" title="document"></iframe>
  </section>
</div>
<script>window.__TREE__ = ${embed(tree)};</script>
<script src="search-index.js"></script>
<script src="refs-index.js"></script>`;
  return page(title, "", body, SCRIPT);
}

/** A simple index page linking every downloaded manual's own browser. */
export function renderMasterPage(manuals: { label: string; href: string }[]): string {
  const items = manuals
    .map((m) => `  <li><a href="${m.href}">${esc(m.label)}</a></li>`)
    .join("\n");
  const body = `<main style="max-width:680px;margin:40px auto;padding:0 16px;font:15px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <h1>Downloaded manuals</h1>
  <ul style="line-height:2">
${items || "  <li>(none)</li>"}
  </ul>
</main>`;
  return page("Downloaded manuals", "", body, "");
}
