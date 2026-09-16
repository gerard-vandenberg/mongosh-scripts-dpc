// export_orphaned_idxurns_to_file.js
//
// Read-only: finds orphaned idxurns documents (userId not found in users) and prints them as
// JSON to stdout. Writes NOTHING else to stdout, so this is safe to redirect straight to a file -
// combine with mongosh's --quiet flag to also suppress the connection banner.
//
// Usage:
//   mongosh --quiet "your-connection-string/pinnacle" export_orphaned_idxurns_to_file.js > orphaned_idxurns_20260902.json
//
// The output file is a plain JSON array - open it in any editor, or reload it later with:
//   var restored = JSON.parse(cat("orphaned_idxurns_20260902.json"));
//   db.idxurns.insertMany(restored.map(d => ({ ...d, _id: ObjectId(d._id), userId: ObjectId(d.userId) })));
// (ObjectId/Date fields round-trip as plain strings through JSON, so they need re-wrapping on
// the way back in - ISODate strings are accepted directly by insertMany without extra wrapping.)

var orphans = db.idxurns.aggregate([
  { $lookup: { from: "users", localField: "userId", foreignField: "_id", as: "matchedUser" } },
  { $match: { matchedUser: { $size: 0 } } },
  { $project: { matchedUser: 0 } }
]).toArray();

print(JSON.stringify(orphans, null, 2));
