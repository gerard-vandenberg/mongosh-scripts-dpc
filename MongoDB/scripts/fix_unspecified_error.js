// fix_unspecified_error.js
//
// Daily "unspecified error" data fix. An investigator is given a user's email
// address and/or mobile number, and this script carries out the standard
// remediation:
//
//   1. Find the user in `users` by email and/or mobile.
//   2. Read the user's idx_urns (array) and/or idx_urn (single value) field(s).
//   3. Look up the corresponding record(s) in `idxurns` by _id or idx_urn.
//   4. Delete those idxurns record(s).
//   5. Back up the user document to `archived_users`.
//   6. Delete the user document from `users`.
//
// Field names assumed on `users` (email, mobile, idx_urns, idx_urn) - verify
// against a real document (db.users.findOne({})) before first use and adjust
// USER_EMAIL_FIELD / USER_MOBILE_FIELD below if this environment differs.
//
// Usage:
//   1. Set searchEmail / searchMobile below (either or both).
//   2. Leave performDelete = false and run once to see what would happen:
//        mongosh "your-connection-string/pinnacle" fix_unspecified_error.js
//   3. Review the report. If it looks right, set performDelete = true and
//      run again to actually delete the idxurns records, archive the user,
//      and delete the user record.
//
// Safety: performDelete defaults to false - a dry run only ever reports what
// it found and what it would do. Nothing is modified until you explicitly
// set performDelete = true and rerun.

var searchEmail = ''; // e.g. 'someone@example.com' - leave blank to skip
var searchMobile = ''; // e.g. '0412345678' - leave blank to skip
var performDelete = false; // set true to actually delete/archive

var USER_EMAIL_FIELD = 'email';
var USER_MOBILE_FIELD = 'mobile';

(function () {
  if (!searchEmail && !searchMobile) {
    print('Set searchEmail and/or searchMobile before running this script.');
    return;
  }

  // Step 1: find the user
  var userOrClauses = [];
  if (searchEmail) {
    var emailClause = {};
    emailClause[USER_EMAIL_FIELD] = searchEmail;
    userOrClauses.push(emailClause);
  }
  if (searchMobile) {
    var mobileClause = {};
    mobileClause[USER_MOBILE_FIELD] = searchMobile;
    userOrClauses.push(mobileClause);
  }

  var user = db.users.findOne({ $or: userOrClauses });

  if (!user) {
    print('No matching user found for the given email/mobile - investigation cannot proceed.');
    return;
  }

  print('Matched user _id: ' + user._id);
  print('  ' + USER_EMAIL_FIELD + ': ' + user[USER_EMAIL_FIELD]);
  print('  ' + USER_MOBILE_FIELD + ': ' + user[USER_MOBILE_FIELD]);

  // Step 2: gather idx_urns / idx_urn values off the user document
  var urnValues = [];
  if (Array.isArray(user.idx_urns)) {
    user.idx_urns.forEach(function (v) { if (v) urnValues.push(v); });
  } else if (user.idx_urns) {
    urnValues.push(user.idx_urns);
  }
  if (user.idx_urn) urnValues.push(user.idx_urn);

  if (urnValues.length === 0) {
    print('User has no idx_urns/idx_urn values - nothing to investigate in idxurns, stopping.');
    return;
  }

  print('idx_urns/idx_urn values found on user: ' + urnValues.join(', '));

  // Step 3: find the corresponding idxurns record(s) by _id or idx_urn.
  // Tries the raw value against both fields, plus an ObjectId-cast attempt
  // against _id in case this environment's idxurns._id is an ObjectId rather
  // than the urn string itself.
  function toObjectIdIfValid(value) {
    try {
      return new ObjectId(value);
    } catch (e) {
      return null;
    }
  }

  var matchedIdxurns = [];
  var seenIds = new Set();

  urnValues.forEach(function (value) {
    var oid = toObjectIdIfValid(value);
    var orClauses = [{ idx_urn: value }, { _id: value }];
    if (oid) orClauses.push({ _id: oid });

    db.idxurns.find({ $or: orClauses }).forEach(function (doc) {
      var idStr = String(doc._id);
      if (!seenIds.has(idStr)) {
        seenIds.add(idStr);
        matchedIdxurns.push(doc);
      }
    });
  });

  if (matchedIdxurns.length === 0) {
    print('No corresponding idxurns records found for these values - nothing to delete, stopping.');
    return;
  }

  print('Matched idxurns record(s): ' + matchedIdxurns.length);
  matchedIdxurns.forEach(function (doc) {
    var backRefOk = String(doc.userId) === String(user._id);
    print('  _id=' + doc._id + ' idx_urn=' + doc.idx_urn + ' userId=' + doc.userId +
      (backRefOk ? ' [back-reference matches user]' : ' [WARNING: userId does not match matched user]'));
  });

  if (!performDelete) {
    print('');
    print('DRY RUN - no changes made. Set performDelete = true and rerun to:');
    print('  1. Delete the ' + matchedIdxurns.length + ' idxurns record(s) above');
    print('  2. Archive the user document to archived_users');
    print('  3. Delete the user document from users');
    return;
  }

  // Step 4: delete the matched idxurns records
  var idxurnsIds = matchedIdxurns.map(function (doc) { return doc._id; });
  var deleteIdxurnsResult = db.idxurns.deleteMany({ _id: { $in: idxurnsIds } });
  print('Deleted idxurns records: ' + deleteIdxurnsResult.deletedCount);

  // Step 5: back up the user document to archived_users before removing it
  var archivedDoc = Object.assign({}, user);
  archivedDoc.archivedAt = new Date();
  archivedDoc.archivedReason = 'unspecified error data fix';
  db.archived_users.insertOne(archivedDoc);
  print('User archived to archived_users (_id: ' + user._id + ')');

  // Step 6: delete the user document from users
  var deleteUserResult = db.users.deleteOne({ _id: user._id });
  print('Deleted user record: ' + deleteUserResult.deletedCount);

  print('');
  print('Data fix complete for user ' + user._id + '.');
})();
