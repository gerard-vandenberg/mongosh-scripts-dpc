// get_orphaned_idxurns_count.js
//
// Read-only check: counts idxurns documents whose userId doesn't match any users._id.
// Safe to run any time, against any environment - makes no changes.
//
// Usage:
//   mongosh "your-connection-string/pinnacle" get_orphaned_idxurns_count.js

function formatDuration(ms) {
  var totalSeconds = Math.floor(ms / 1000);
  var hours = Math.floor(totalSeconds / 3600);
  var minutes = Math.floor((totalSeconds % 3600) / 60);
  var seconds = totalSeconds % 60;
  return hours + "h " + minutes + "m " + seconds + "s";
}

var scriptStart = Date.now();

var totalCount = db.idxurns.countDocuments();

var searchStart = Date.now();

// $lookup effectively did one join per idxurns document - over 1.13M documents that took
// ~2.5 minutes to find 2 orphans. Tried fetching every users._id and filtering idxurns with
// $nin against that array server-side, but users turned out to be large enough that the
// array itself blew past MongoDB's ~16MB BSON document limit trying to serialize it back
// into a query (RangeError on a 17MB offset). Keeping the id set entirely client-side (a JS
// Set, never sent back to MongoDB as a query) and streaming idxurns with a minimal userId-only
// projection avoids both problems - no per-document server-side join, and no oversized query.
var userIdSet = new Set();
db.users.find({}, { _id: 1 }).forEach(function (u) { userIdSet.add(u._id.toString()); });

var count = 0;
db.idxurns.find({}, { userId: 1 }).forEach(function (doc) {
  if (!userIdSet.has(String(doc.userId))) count++;
});

var searchDurationMs = Date.now() - searchStart;
var pct = totalCount > 0 ? ((count / totalCount) * 100).toFixed(2) : "0.00";
var totalDurationMs = Date.now() - scriptStart;
const now = new Date();
print("Total idxurns documents: " + totalCount);
print("Orphaned idxurns documents: " + count + " (" + pct + "%)");
print("Search duration: " + formatDuration(searchDurationMs));
print("Total script duration: " + formatDuration(totalDurationMs));
print("Script completed at: " + now.toLocaleString());
