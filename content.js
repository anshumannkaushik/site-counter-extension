// Site Counter - page-side counting logic (content script copy).
// Counts, on a hotel search results page:
//   - the main  property row (radio button + numeric record ID), and
//   - every mapped site row below it (checkbox + a Source value such as
//     BOOKING, BOOKING APP, XP, AGODA...). Duplicates are counted separately.
// Owner / user-name cells are ignored: a source is only taken from the
// cells BEFORE the Hotel Name column, and must look like a source code
// (short, uppercase, no commas).
function ql2CountSitesInPage() {
  function isSourceLike(text) {
    return /^[A-Z][A-Z0-9_& ]{1,24}$/.test(text) && !/\d{3,}/.test(text);
  }

  var groups = [];
  var total = 0;
  var tables = document.querySelectorAll("table");

  tables.forEach(function (table) {
    var rows = Array.prototype.slice.call(table.querySelectorAll("tr"));
    if (!rows.length) return;

    // Locate the header row of a results table (must mention Hotel Name).
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
    if (headerIdx < 0) return; // not a results table

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

  return {
    url: location.href,
    totalSites: total,
    groups: groups
  };
}

// Fallback path: answer popup messages (works on tabs opened after install).
var ql2Api = typeof browser !== "undefined" ? browser : chrome;
if (ql2Api && ql2Api.runtime && ql2Api.runtime.onMessage) {
  ql2Api.runtime.onMessage.addListener(function (msg) {
    if (msg && msg.type === "COUNT_SITES") {
      return Promise.resolve(ql2CountSitesInPage());
    }
  });
}
