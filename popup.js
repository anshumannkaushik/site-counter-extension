const api = typeof browser !== "undefined" ? browser : chrome;
const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");
let lastText = "";
let lastExcel = "";

/* This function is injected into the hotel tab itself, so it must be
   fully self-contained (no references to popup variables). It is the
   same logic as content.js. Tabs opened BEFORE the extension was
   installed are handled by this injection, so they do not need a
   reload. */
function countSitesInPage() {
  function isSourceLike(text) {
    return /^[A-Z][A-Z0-9_& ]{1,24}$/.test(text) && !/\d{3,}/.test(text);
  }

  var groups = [];
  var total = 0;
  var tables = document.querySelectorAll("table");

  tables.forEach(function (table) {
    var rows = Array.prototype.slice.call(table.querySelectorAll("tr"));
    if (!rows.length) return;

    var headerIdx = -1;
    var hotelIdx = -1;
    rows.forEach(function (row, i) {
      if (headerIdx >= 0) return;
      var texts = Array.prototype.map.call(
        row.querySelectorAll("th,td"),
        function (c) { return c.textContent.trim().toLowerCase(); }
      );
      var h = texts.indexOf("hotel name");
      if (h >= 0) { headerIdx = i; hotelIdx = h; }
    });
    if (headerIdx < 0) return;

    var current = null;
    for (var i = headerIdx + 1; i < rows.length; i++) {
      var row = rows[i];
      var cells = Array.prototype.slice.call(row.querySelectorAll("td"));
      if (!cells.length) continue;

      var hasRadio = !!row.querySelector('input[type="radio"]');
      var hasCheckbox = !!row.querySelector('input[type="checkbox"]');
      var texts = cells.map(function (c) { return c.textContent.trim(); });

      // Scan only the first few cells ([select] [record ID / owner] [Source]).
      // A whole cell like "BOOKING APP" wins; a combined cell like
      // "120931880 XP" gives up its source token. Owner/user-name cells
      // (lowercase) never match. Stop at the first long cell (hotel name).
      var source = "";
      var limit = Math.min(4, texts.length);
      if (hotelIdx > 0) {
        // Stop at the Hotel Name column (include it only if the cell
        // sitting there is itself a source value, a merged-column case).
        limit = Math.min(texts.length, isSourceLike(texts[hotelIdx] || "") ? hotelIdx + 1 : hotelIdx);
      }
      for (var j = 0; j < limit; j++) {
        var cellText = texts[j];
        if (cellText.length > 25) break; // hotel/address text - stop before it
        if (isSourceLike(cellText)) {
          source = cellText;
        } else {
          cellText.split(/\s+/).forEach(function (tok) {
            if (isSourceLike(tok)) source = tok;
          });
        }
      }

      var hotel = "";
      if (hotelIdx >= 0 && texts[hotelIdx] && !isSourceLike(texts[hotelIdx]) && texts[hotelIdx].length > 3) {
        hotel = texts[hotelIdx];
      }
      if (!hotel) {
        for (var h2 = 0; h2 < texts.length; h2++) {
          if (texts[h2].length > 12 && /\s/.test(texts[h2])) { hotel = texts[h2]; break; }
        }
      }

      if (hasRadio) {
        var id = "";
        texts.forEach(function (t) {
          var m = t.match(/\b\d{5,}\b/);
          if (!id && m) id = m[0];
        });
        current = { ql2Id: id, hotel: hotel, sites: 0, sources: [] };
        groups.push(current);
      } else if (hasCheckbox && source) {
        if (!current) {
          current = { ql2Id: "", hotel: hotel, sites: 0, sources: [] };
          groups.push(current);
        }
        current.sites += 1;
        current.sources.push(source);
        total += 1;
      }
    }
  });

  return { url: location.href, totalSites: total, groups: groups };
}

async function countTab(tab) {
  // Path 1: direct injection (works even on tabs opened before install).
  try {
    const res = await api.scripting.executeScript({
      target: { tabId: tab.id },
      func: countSitesInPage
    });
    if (res && res[0] && res[0].result) return res[0].result;
  } catch (e) { /* fall through to message path */ }

  // Path 2: ask the content script (tabs opened after install).
  try {
    const res = await api.tabs.sendMessage(tab.id, { type: "COUNT_SITES" });
    if (res) return res;
  } catch (e) { /* fall through */ }

  return null;
}

// Merge duplicate groups for the same record ID. The hotel page nests its
// results table, so one property can be reported twice (once as a
// 0-site group, once with the real rows). Groups with identical source
// lists are the same rows seen twice - counted once. An empty group
// adds nothing. Genuinely separate rows are added together.
function mergeGroups(groups) {
  const byId = new Map();
  const order = [];
  groups.forEach(function (g, gi) {
    const key = g.ql2Id ? "id:" + g.ql2Id : "anon:" + gi;
    if (!byId.has(key)) {
      byId.set(key, { ql2Id: g.ql2Id || "", sources: (g.sources || []).slice() });
      order.push(key);
      return;
    }
    const cur = byId.get(key);
    const incoming = (g.sources || []).slice();
    if (incoming.join("|") === cur.sources.join("|")) return; // same rows twice
    if (!cur.sources.length) { cur.sources = incoming; return; }
    if (!incoming.length) return;
    cur.sources = cur.sources.concat(incoming);
  });
  return order.map(function (k) {
    const p = byId.get(k);
    return { ql2Id: p.ql2Id, sources: p.sources, count: p.sources.length };
  });
}

// Marks for one property: every site that appears multiple times
// ("BOOKING x3"), plus a star mark when BOTH booking sites are present.
function marksFor(sources) {
  const counts = {};
  sources.forEach(function (s) { counts[s] = (counts[s] || 0) + 1; });
  const marks = [];
  Object.keys(counts).forEach(function (s) {
    if (counts[s] > 1) marks.push(s + " x" + counts[s]);
  });
  if (counts["BOOKING"] && counts["BOOKING APP"]) marks.push("★ BOOKING + BOOKING APP");
  return marks.join(", ");
}

// One output row per property, in tab order. A tab with no result
// table still gets a 0 row so pasted rows stay aligned with the tabs.
function buildProperties(perTab) {
  const props = [];
  perTab.forEach(function (entry) {
    const data = entry.data;
    if (!data || !data.groups || !data.groups.length) {
      props.push({ ql2Id: "", sources: [], count: 0, noResult: true });
      return;
    }
    mergeGroups(data.groups).forEach(function (p) { props.push(p); });
  });
  return props;
}

function formatResults(perTab) {
  const props = buildProperties(perTab);
  let grand = 0;

  const lines = props.map(function (p, i) {
    grand += p.count;
    if (p.noResult) return (i + 1) + ". (tab) - no hotel result table found - 0 site(s)";
    const mark = marksFor(p.sources);
    return (i + 1) + ". " + (p.ql2Id || "?") + " - " + p.count + " site(s)" +
      (p.sources.length ? ": " + p.sources.join(", ") : "") +
      (mark ? "   [" + mark + "]" : "");
  });
  lines.push("");
  lines.push("TOTAL SITES (all tabs): " + grand + "  |  properties: " + props.length);

  // CSV format - exactly 2 columns, one row per property:
  //   site count,sites
  // The sites field is quoted because the list itself contains
  // commas ("BOOKING, BOOKING APP, XP"). Repeated sites stay visible
  // in the list itself (BOOKING, BOOKING, ...).
  const excelRows = ["site count,sites"];
  props.forEach(function (p) {
    const sites = p.sources.join(", ");
    excelRows.push(sites ? p.count + ',"' + sites + '"' : p.count + ",");
  });

  return { text: lines.join("\n"), excel: excelRows.join("\n"), grand: grand };
}

async function run(tabs, label) {
  statusEl.textContent = "Checking " + tabs.length + " tab(s)...";
  resultEl.textContent = "";

  const perTab = [];
  for (const tab of tabs) {
    let data = null;
    try { data = await countTab(tab); } catch (e) { data = null; }
    perTab.push({ tab: tab, data: data });
  }

  const out = formatResults(perTab);
  lastText = out.excel;
  lastExcel = out.excel;
  // The result box shows ONLY the 2-column CSV, so copying works the
  // same whether the Copy button is used or the text in the box is
  // selected and copied by hand. "Download CSV" saves the same data
  // as a .csv file that opens in WPS/Excel already split into the
  // 2 columns.
  resultEl.textContent = out.excel;
  statusEl.textContent = "Done - " + out.grand + " site(s) across " + tabs.length + " tab(s). Use Copy, or Download CSV and open the file in Excel/WPS.";
}

document.getElementById("checkAll").addEventListener("click", async () => {
  const tabs = await api.tabs.query({
    url: ["https://live.ql2.com/*", "http://live.ql2.com/*"]
  });
  if (!tabs.length) {
    statusEl.textContent = "No hotel tabs are open.";
    resultEl.textContent = "";
    return;
  }
  run(tabs, "all");
});

document.getElementById("checkCurrent").addEventListener("click", async () => {
  const tabs = await api.tabs.query({ active: true, currentWindow: true });
  if (!tabs.length || !/live\.ql2\.com/.test(tabs[0].url || "")) {
    statusEl.textContent = "The current tab is not a hotel tab.";
    return;
  }
  run(tabs, "current");
});

document.getElementById("copyBtn").addEventListener("click", async () => {
  if (!lastExcel) { statusEl.textContent = "Nothing to copy yet - run a check first."; return; }
  try {
    // CSV, 2 columns: site count,sites - one row per property.
    await navigator.clipboard.writeText(lastExcel);
    statusEl.textContent = "Copied CSV (2 columns). For a guaranteed split into columns, use Download CSV and open the file.";
  } catch (e) {
    statusEl.textContent = "Copy failed - select the text manually.";
  }
});

document.getElementById("downloadBtn").addEventListener("click", () => {
  if (!lastExcel) { statusEl.textContent = "Nothing to download yet - run a check first."; return; }
  const blob = new Blob([lastExcel], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "ql2-site-count.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  statusEl.textContent = "CSV downloaded - open ql2-site-count.csv in Excel/WPS. It has 2 columns: site count, sites.";
});
