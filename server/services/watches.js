import * as watchersDb from '../db/watchers.js';
import * as issuesDb from '../db/issues.js';
import * as projectMembersDb from '../db/projectMembers.js';

export class WatchError extends Error {
  constructor(code) {
    super(code);
    this.name = 'WatchError';
    this.code = code;
  }
}

function loadIssue(db, projectId, number) {
  const issue = issuesDb.getByNumber(db, projectId, number);
  if (!issue) throw new WatchError('not_found');
  return issue;
}

function ensureMember(db, projectId, userId) {
  const role = projectMembersDb.getRole(db, projectId, userId);
  if (!role) throw new WatchError('forbidden');
}

export function watch(db, projectId, number, userId) {
  ensureMember(db, projectId, userId);
  const issue = loadIssue(db, projectId, number);
  watchersDb.add(db, issue.id, userId);
  return { issueId: issue.id, isWatching: true };
}

export function unwatch(db, projectId, number, userId) {
  ensureMember(db, projectId, userId);
  const issue = loadIssue(db, projectId, number);
  watchersDb.remove(db, issue.id, userId);
  return { issueId: issue.id, isWatching: false };
}

export function isWatching(db, issueId, userId) {
  return watchersDb.isWatching(db, issueId, userId);
}
