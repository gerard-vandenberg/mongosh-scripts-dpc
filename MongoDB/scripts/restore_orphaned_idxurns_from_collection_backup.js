// restore_orphaned_idxurns_from_collection_backup.js
//
// Restores idxurns documents from a same-database backup collection produced by
// backup_orphaned_idxurns.js (e.g. idxurns_orphan_backup_20260907).
//
// Unlike restoring from a JSON backup, no ObjectId/Date re-wrapping is needed here - the backup
// collection already stores documents as native BSON, so they round-trip exactly as inserted.
//
// Skips any record whose _id already exists in idxurns (e.g. a partial restore run twice, or a
// ticket that only needed some of the batch restored) rather than erroring out the whole batch -
// reports what it skipped and why.
//
// Usage:
//   Edit backupCollectionName below, then:
//   mongosh "your-connection-string/pinnacle" "C:\dev\DPC\MongoDB\scripts\restore_orphaned_idxurns_from_collection_backup.js"

var backupCollectionName = "idxurns_orphan_backup_20260909"; // <-- EDIT THIS

print("=== Step 1: read backup collection ===");

var backedUpRecords = db[backupCollectionName].find().toArray();
print("Backup collection " + backupCollectionName + " contains " + backedUpRecords.length + " records");

if (backedUpRecords.length === 0) {
  print("Nothing to restore.");
  quit();
}

print("");
print("=== Step 2: check which _ids already exist ===");

var candidateIds = backedUpRecords.map(function (doc) { return doc._id; });
var alreadyExistingIds = db.idxurns.find({ _id: { $in: candidateIds } }, { _id: 1 })
  .toArray()
  .map(function (doc) { return doc._id.toString(); });

var toInsert = backedUpRecords.filter(function (doc) {
  return alreadyExistingIds.indexOf(doc._id.toString()) === -1;
});

print("Already present in idxurns (will be skipped): " + alreadyExistingIds.length);
print("To be inserted: " + toInsert.length);

if (toInsert.length === 0) {
  print("Nothing left to restore - all backed-up records are already present.");
  quit();
}

print("");
print("=== Step 3: restore ===");

var result = db.idxurns.insertMany(toInsert);
print("Restored: " + Object.keys(result.insertedIds).length + " (expected " + toInsert.length + ")");

print("");
print("Done. Recommended next step: re-run get_orphaned_idxurns_count.js to confirm the orphan count reflects the restore.");
