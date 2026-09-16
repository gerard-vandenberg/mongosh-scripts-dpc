// backup_orphaned_idxurns.js
//
// Finds idxurns documents whose userId doesn't match any users._id, and backs them up TWO ways
// before anything is deleted:
//   1. Same-database collection: idxurns_orphan_backup_<YYYYMMDD>
//   2. JSON file, written next to this script: orphaned_idxurns_<YYYYMMDD>_<HHMM>.json
//
// Both backups are verified to contain exactly the orphan count found - if either one doesn't
// match, nothing further happens (the mismatched artifact is left in place for inspection, but
// this script won't tell you it's safe to proceed).
//
// This script only reads and backs up - it never deletes anything. Run delete_orphaned_idxurns.js
// afterwards (in dry-run mode first) to actually remove the orphaned records.
//
// Usage:
//   mongosh "your-connection-string/pinnacle" "C:\dev\DPC\MongoDB\scripts\backup_orphaned_idxurns.js"
//
// Safe to re-run: if there are zero orphans, it reports 0 and does nothing further. Re-runs later
// the same day will insertMany into the same collection name (duplicate _ids there will error) -
// if you need to re-back-up the same day, drop the earlier backup collection first or just rely
// on the JSON file from the first run.

var fs = require("fs");

var now = new Date();
var dateStamp = now.toISOString().slice(0, 10).replace(/-/g, "");
var timeStamp = now.toTimeString().slice(0, 5).replace(":", "");

var backupCollectionName = "idxurns_orphan_backup_" + dateStamp;
var backupFilePath = "C:\\dev\\DPC\\MongoDB\\scripts\\orphaned_idxurns_" + dateStamp + "_" + timeStamp + ".json";

print("=== Step 1: find orphaned idxurns ===");

var orphans = db.idxurns.aggregate([
  { $lookup: { from: "users", localField: "userId", foreignField: "_id", as: "matchedUser" } },
  { $match: { matchedUser: { $size: 0 } } },
  { $project: { matchedUser: 0 } }
]).toArray();

print("Orphan count: " + orphans.length);

if (orphans.length === 0) {
  print("No orphaned records found - nothing to back up.");
  quit();
}

print("");
print("=== Step 2: back up to collection " + backupCollectionName + " ===");

db[backupCollectionName].insertMany(orphans);
var backedUpCount = db[backupCollectionName].countDocuments();
print("Backed up " + backedUpCount + " docs to " + backupCollectionName);

var collectionBackupOk = backedUpCount === orphans.length;
if (!collectionBackupOk) {
  print("WARNING: collection backup count (" + backedUpCount + ") does not match orphan count (" +
        orphans.length + ").");
}

print("");
print("=== Step 3: write JSON backup to " + backupFilePath + " ===");

fs.writeFileSync(backupFilePath, JSON.stringify(orphans, null, 2));

var writtenRecords = JSON.parse(fs.readFileSync(backupFilePath, "utf8"));
print("Wrote " + writtenRecords.length + " docs to " + backupFilePath);

var fileBackupOk = writtenRecords.length === orphans.length;
if (!fileBackupOk) {
  print("WARNING: JSON file record count (" + writtenRecords.length + ") does not match orphan count (" +
        orphans.length + ").");
}

print("");
print("=== Summary ===");
print("Orphans found:        " + orphans.length);
print("Collection backup:    " + backupCollectionName + " (" + backedUpCount + " docs)" + (collectionBackupOk ? "" : " - MISMATCH"));
print("JSON file backup:     " + backupFilePath + " (" + writtenRecords.length + " docs)" + (fileBackupOk ? "" : " - MISMATCH"));

if (!collectionBackupOk || !fileBackupOk) {
  print("");
  print("ABORTING guidance: do not proceed to delete_orphaned_idxurns.js until both backups are verified.");
  quit();
}

print("");
print("Both backups verified. Next step: run delete_orphaned_idxurns.js");
print("  (edit backupCollectionName/backupFilePath at the top of that script to the values above,");
print("   and leave dryRun = true for the first pass).");
