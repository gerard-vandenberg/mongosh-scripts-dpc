// restore_orphaned_idxurns_from_json_backup.js
//
// Restores idxurns documents from a JSON backup file produced by export_orphaned_idxurns_to_file.js
// (or the JSON export step implied by delete_orphaned_idxurns_using_json_backup.js).
//
// JSON.stringify flattens ObjectId/Date fields to plain strings, so this script re-wraps them
// (_id, userId -> ObjectId; createdAt, updatedAt -> Date) before inserting - a plain insertMany of
// the raw parsed JSON would silently store _id/userId as strings instead of ObjectIds, which
// would break every future $lookup/reference to these documents.
//
// Skips any record whose _id already exists in idxurns (e.g. a partial restore run twice, or a
// ticket that only needed some of the batch restored) rather than erroring out the whole batch -
// reports what it skipped and why.
//
// Usage:
//   Edit backupFilePath below, then:
//   mongosh "your-connection-string/pinnacle" "C:\dev\DPC\MongoDB\scripts\restore_orphaned_idxurns_from_json_backup.js"

var backupFilePath = "C:\\dev\\DPC\\MongoDB\\exports\\orphaned_idxurns_20260902.json"; // <-- EDIT THIS

print("=== Step 1: read backup file ===");

var backupJson;
try {
  backupJson = cat(backupFilePath);
} catch (e) {
  print("ABORTING: could not read backup file at " + backupFilePath);
  print("Error: " + e);
  quit();
}

var rawRecords = JSON.parse(backupJson);
print("Backup file contains " + rawRecords.length + " records: " + backupFilePath);

if (rawRecords.length === 0) {
  print("Nothing to restore.");
  quit();
}

print("");
print("=== Step 2: check which _ids already exist ===");

var recordsToRestore = rawRecords.map(function (doc) {
  return {
    _id: ObjectId(doc._id),
    idx_urn: doc.idx_urn,
    userId: ObjectId(doc.userId),
    createdAt: new Date(doc.createdAt),
    updatedAt: new Date(doc.updatedAt),
    __v: doc.__v,
  };
});

var candidateIds = recordsToRestore.map(function (doc) { return doc._id; });
var alreadyExistingIds = db.idxurns.find({ _id: { $in: candidateIds } }, { _id: 1 })
  .toArray()
  .map(function (doc) { return doc._id.toString(); });

var toInsert = recordsToRestore.filter(function (doc) {
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
