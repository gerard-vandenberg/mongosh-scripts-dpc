// delete_orphaned_idxurns_using_json_backup.js
//
// Deletes orphaned idxurns documents (userId not found in users), but only after verifying a
// JSON backup file already exists and its record count matches the current orphan count.
//
// REQUIRED FIRST STEP - run this before using this script, to produce the backup file:
//   mongosh --quiet "your-connection-string/pinnacle" "C:\dev\DPC\MongoDB\scripts\export_orphaned_idxurns_to_file.js" > orphaned_idxurns_20260902.json
//
// Then edit backupFilePath below to point at that file, and run:
//   mongosh "your-connection-string/pinnacle" "C:\dev\DPC\MongoDB\scripts\delete_orphaned_idxurns_using_json_backup.js"
//
// Deliberately does NOT trust the file's contents for the actual delete - it re-derives the
// orphan _id list fresh from the database (same as the other scripts) and only uses the file to
// confirm a backup of the expected size exists first. If the counts don't match, it aborts
// without deleting anything (e.g. because the orphan set changed since you ran the export, or
// you pointed it at the wrong file).

var backupFilePath = "C:\\dev\\DPC\\MongoDB\\exports\\orphaned_idxurns_20260902.json"; // <-- EDIT THIS

print("=== Step 1: verify backup file ===");

var backupJson;
try {
  backupJson = cat(backupFilePath);
} catch (e) {
  print("ABORTING: could not read backup file at " + backupFilePath);
  print("Error: " + e);
  quit();
}

var backedUpRecords = JSON.parse(backupJson);
print("Backup file contains " + backedUpRecords.length + " records: " + backupFilePath);

print("");
print("=== Step 2: find current orphaned idxurns ===");

var orphans = db.idxurns.aggregate([
  { $lookup: { from: "users", localField: "userId", foreignField: "_id", as: "matchedUser" } },
  { $match: { matchedUser: { $size: 0 } } },
  { $project: { matchedUser: 0 } }
]).toArray();

print("Current orphan count: " + orphans.length);

if (orphans.length !== backedUpRecords.length) {
  print("");
  print("ABORTING: current orphan count (" + orphans.length + ") does not match backup file count (" +
        backedUpRecords.length + ") - not deleting anything.");
  print("Either re-run the export script to refresh the backup, or investigate why the counts differ.");
  quit();
}

print("Counts match - proceeding.");

print("");
print("=== Step 3: delete the orphaned records ===");

var orphanIds = orphans.map(function (doc) { return doc._id; });
var result = db.idxurns.deleteMany({ _id: { $in: orphanIds } });

print("Deleted: " + result.deletedCount + " (expected " + orphanIds.length + ")");

if (result.deletedCount !== orphanIds.length) {
  print("WARNING: deleted count does not match expected count - investigate before assuming this is fully cleaned up.");
}

print("");
print("Done. Backup file remains at: " + backupFilePath);
print("To restore from it, re-wrap ObjectId/Date fields and insertMany - see the comment in export_orphaned_idxurns_to_file.js.");
