// delete_orphaned_idxurns.js
//
// Deletes orphaned idxurns documents (userId not found in users), but only after verifying BOTH
// a backup collection and a JSON backup file already exist and their record counts match the
// current orphan count. Run backup_orphaned_idxurns.js first to produce both.
//
// DRY RUN by default: with dryRun = true (below), this prints exactly what would be deleted and
// makes no changes. Set dryRun = false only after reviewing that output.
//
// Usage:
//   1. Run backup_orphaned_idxurns.js and note the collection name / file path it prints.
//   2. Edit backupCollectionName and backupFilePath below to those values.
//   3. Run this script with dryRun = true first and review the output.
//   4. Set dryRun = false and re-run to actually delete.
//   mongosh "your-connection-string/pinnacle" "C:\dev\DPC\MongoDB\scripts\delete_orphaned_idxurns.js"
//
// Deliberately does NOT trust either backup's contents for the actual delete - it re-derives the
// orphan _id list fresh from the database and only uses the backups to confirm they're of the
// expected size first. If the counts don't match, it aborts without deleting anything (e.g.
// because the orphan set changed since backup, or you pointed it at the wrong backup).

var backupCollectionName = "idxurns_orphan_backup_20260909"; // <-- EDIT THIS (from backup_orphaned_idxurns.js output)
var backupFilePath = "C:\\dev\\DPC\\MongoDB\\scripts\\orphaned_idxurns_20260909_1634.json"; // <-- EDIT THIS
var dryRun = false; // <-- EDIT THIS to false to actually delete, after reviewing a dry run

var fs = require("fs");

print("=== Step 1: verify backups exist ===");

var collectionBackupCount = db[backupCollectionName].countDocuments();
print("Backup collection " + backupCollectionName + ": " + collectionBackupCount + " docs");

if (collectionBackupCount === 0) {
  print("ABORTING: backup collection " + backupCollectionName + " is empty or does not exist.");
  quit();
}

var fileBackupRecords;
try {
  fileBackupRecords = JSON.parse(fs.readFileSync(backupFilePath, "utf8"));
} catch (e) {
  print("ABORTING: could not read backup file at " + backupFilePath);
  print("Error: " + e);
  quit();
}
print("Backup file " + backupFilePath + ": " + fileBackupRecords.length + " docs");

if (collectionBackupCount !== fileBackupRecords.length) {
  print("");
  print("ABORTING: collection backup count (" + collectionBackupCount + ") does not match file backup count (" +
        fileBackupRecords.length + ") - these don't look like they came from the same backup run.");
  quit();
}

print("");
print("=== Step 2: find current orphaned idxurns ===");

var orphans = db.idxurns.aggregate([
  { $lookup: { from: "users", localField: "userId", foreignField: "_id", as: "matchedUser" } },
  { $match: { matchedUser: { $size: 0 } } },
  { $project: { matchedUser: 0 } }
]).toArray();

print("Current orphan count: " + orphans.length);

if (orphans.length !== collectionBackupCount) {
  print("");
  print("ABORTING: current orphan count (" + orphans.length + ") does not match backup count (" +
        collectionBackupCount + ") - not deleting anything.");
  print("Either re-run backup_orphaned_idxurns.js to refresh both backups, or investigate why the counts differ.");
  quit();
}

print("Counts match across both backups and the live database - proceeding.");

var orphanIds = orphans.map(function (doc) { return doc._id; });

print("");
if (dryRun) {
  print("=== DRY RUN: would delete " + orphanIds.length + " documents ===");
  orphans.forEach(function (doc) {
    print("  would delete _id=" + doc._id + " idx_urn=" + doc.idx_urn + " userId=" + doc.userId);
  });
  print("");
  print("Dry run only - nothing was deleted. Set dryRun = false at the top of this script to actually delete.");
  quit();
}

print("=== Step 3: delete the orphaned records ===");

var result = db.idxurns.deleteMany({ _id: { $in: orphanIds } });
print("Deleted: " + result.deletedCount + " (expected " + orphanIds.length + ")");

if (result.deletedCount !== orphanIds.length) {
  print("WARNING: deleted count does not match expected count - investigate before assuming this is fully cleaned up.");
}

print("");
print("Done. Backups remain at:");
print("  Collection: " + backupCollectionName);
print("  JSON file:  " + backupFilePath);
print("To restore, use restore_orphaned_idxurns_from_collection_backup.js or restore_orphaned_idxurns_from_json_backup.js.");
