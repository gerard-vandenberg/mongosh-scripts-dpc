// fix_unspecified_error.js
//
// Daily "unspecified error" data fix. An investigator is given a user's email
// address and/or mobile number, and this script carries out the standard
// remediation:
//
//   1. Find the user in `users` by email and/or mobile.
//   2. Read the user's idx_urns (array) and/or idx_urn (single value) field(s).
//   3. Look up the corresponding record(s) in `idxurns` by _id or idx_urn,
//      reporting every value as either found or not found - a complete
//      picture of what exists before anything is touched.
//   4. Delete those idxurns record(s).
//   5. Back up the user document to `archived_users`.
//   6. Delete the user document from `users`.
//
// Field names assumed on `users` (email, mobile, idx_urns, idx_urn) - verify
// against a real document (db.users.findOne({})) before first use and adjust
// USER_EMAIL_FIELD / USER_MOBILE_FIELD below if this environment differs.
//
// Usage - pass email/mobile via --eval (either or both, at least one
// required), no file editing needed:
//   mongosh "your-connection-string/pinnacle" --eval "var searchEmail='someone@example.com'; var searchMobile='';" fix_unspecified_error.js
//
// Safety: the script ALWAYS investigates and reports first - nothing is
// deleted or archived until you review the report and type YES at the final
// confirmation prompt. mongosh has no plain (unmasked) interactive prompt,
// only passwordPrompt() - so that confirmation input is masked as you type
// it; that's a mongosh limitation, not a secrecy requirement (it also always
// prints its own "Enter password" label, which is why email/mobile are
// passed via --eval instead of prompted - that label would be actively
// misleading for those fields). Typing anything other than exactly YES
// aborts with no changes made.

var USER_EMAIL_FIELD = 'email';
var USER_MOBILE_FIELD = 'mobile';

(function () {
  var searchEmail = (typeof searchEmail !== 'undefined' ? searchEmail : '').trim();
  var searchMobile = (typeof searchMobile !== 'undefined' ? searchMobile : '').trim();

  if (!searchEmail && !searchMobile) {
    print('No searchEmail/searchMobile passed via --eval - nothing to search for, exiting.');
    print('Usage: mongosh "conn-string" --eval "var searchEmail=\'x@x.com\'; var searchMobile=\'\';" fix_unspecified_error.js');
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

  // Step 3: for EVERY value, look it up in idxurns by _id or idx_urn and
  // report found-or-not-found - a complete picture, not just the hits.
  function toObjectIdIfValid(value) {
    try {
      return new ObjectId(value);
    } catch (e) {
      return null;
    }
  }

  var matchedIdxurns = [];
  var seenIds = new Set();

  print('');
  print('idxurns lookup results:');

  urnValues.forEach(function (value) {
    var oid = toObjectIdIfValid(value);
    var orClauses = [{ idx_urn: value }, { _id: value }];
    if (oid) orClauses.push({ _id: oid });

    var foundForThisValue = db.idxurns.find({ $or: orClauses }).toArray();

    if (foundForThisValue.length === 0) {
      print('  value=' + value + ' -> NOT FOUND in idxurns');
      return;
    }

    foundForThisValue.forEach(function (doc) {
      var backRefOk = String(doc.userId) === String(user._id);
      print('  value=' + value + ' -> FOUND _id=' + doc._id + ' idx_urn=' + doc.idx_urn +
        ' userId=' + doc.userId + (backRefOk ? ' [back-reference matches user]' : ' [WARNING: userId does not match matched user]'));

      var idStr = String(doc._id);
      if (!seenIds.has(idStr)) {
        seenIds.add(idStr);
        matchedIdxurns.push(doc);
      }
    });
  });

  print('');

  if (matchedIdxurns.length === 0) {
    print('No corresponding idxurns records found for any value - nothing to delete, stopping.');
    return;
  }

  print('Summary: ' + matchedIdxurns.length + ' idxurns record(s) would be deleted, out of ' + urnValues.length + ' value(s) checked.');
  print('If you continue, this will also archive the user to archived_users and delete the user from users.');
  print('');
  print('Type YES to continue, or anything else to abort.');
  print('(mongosh will label the next line "Enter password" - that\'s just its only prompt, type YES there.)');

  var confirmation = passwordPrompt();

  if (confirmation !== 'YES') {
    print('Aborted - no changes made.');
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
