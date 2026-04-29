import { describe, it, expect } from 'vitest';
import { createTestDb } from './db.js';
import { createProject } from '../server/services/projects.js';
import * as historyDb from '../server/db/history.js';
import * as projectMembersDb from '../server/db/projectMembers.js';
import {
  parseCsv,
  parseExportDate,
  emailSlug,
  importIssues,
} from '../scripts/import-issues.js';

const HEADER =
  'Number,Subject,Status,Priority,Category,Milestone,Assignee,Created,Opener,Last Updated,Last Updated By,Description';

function bootstrap() {
  const db = createTestDb();
  const project = createProject(db, { name: 'Imported' });
  return { db, project };
}

describe('parseCsv', () => {
  it('handles quoted fields with embedded commas, newlines, and escaped quotes', () => {
    const text =
      'a,b,c\r\n' +
      '"hello, world","line1\nline2","he said ""hi"""\n' +
      '1,2,3\n';
    const rows = parseCsv(text);
    expect(rows).toEqual([
      ['a', 'b', 'c'],
      ['hello, world', 'line1\nline2', 'he said "hi"'],
      ['1', '2', '3'],
    ]);
  });

  it('keeps an empty trailing field', () => {
    expect(parseCsv('a,b,\n')).toEqual([['a', 'b', '']]);
  });
});

describe('parseExportDate', () => {
  it('converts a tracker timestamp with offset to UTC SQLite format', () => {
    expect(parseExportDate('2025-05-20 15:08:52 -0400')).toBe('2025-05-20 19:08:52');
  });

  it('accepts ISO 8601 with Z', () => {
    expect(parseExportDate('2025-05-20T19:08:52Z')).toBe('2025-05-20 19:08:52');
  });

  it('accepts no-offset (treated as UTC)', () => {
    expect(parseExportDate('2025-05-20 19:08:52')).toBe('2025-05-20 19:08:52');
  });

  it('throws on garbage', () => {
    expect(() => parseExportDate('not a date')).toThrow(/unparseable/);
  });
});

describe('emailSlug', () => {
  it('lowercases and dasherizes a personal name', () => {
    expect(emailSlug('James D. Terry')).toBe('james-d-terry');
  });

  it('falls back to "imported" for an empty input', () => {
    expect(emailSlug('')).toBe('imported');
  });
});

describe('importIssues', () => {
  it('imports rows with preserved timestamps and synthesized creation history', () => {
    const { db, project } = bootstrap();
    const csv =
      `${HEADER}\n` +
      `263,Scheduled Task EQ not found,Resolved,High,Bug,Production,James D. Terry,` +
      `2025-05-20 15:08:52 -0400,James D. Terry,2025-05-20 21:34:53 -0400,James D. Terry,` +
      `Scheduled Task Equipment Group not found\n` +
      `261,"Quoted ""subject"" with comma, ok",Closed,Normal,Feature Request,Beta,Andrew Robbins,` +
      `2025-05-20 15:07:35 -0400,Andrew Robbins,2025-05-23 12:26:47 -0400,James D. Terry,""\n`;

    const summary = importIssues(db, project.id, csv);
    expect(summary.imported).toBe(2);
    expect(summary.skipped).toEqual([]);

    const issues = db.prepare('SELECT * FROM issues WHERE project_id = ? ORDER BY number').all(project.id);
    expect(issues).toHaveLength(2);

    const [first, second] = issues;
    expect(first.name).toBe('Scheduled Task EQ not found');
    expect(first.created_at).toBe('2025-05-20 19:08:52');
    expect(first.updated_at).toBe('2025-05-21 01:34:53');
    expect(first.description).toBe('Scheduled Task Equipment Group not found');

    // status / priority / category are looked up by name; "Resolved", "High", "Bug" all
    // exist in the project's seeded defaults.
    const status = db.prepare('SELECT name FROM issue_statuses WHERE id = ?').get(first.status_id);
    const priority = db.prepare('SELECT name FROM issue_priorities WHERE id = ?').get(first.priority_id);
    const category = db.prepare('SELECT name FROM issue_categories WHERE id = ?').get(first.category_id);
    expect(status.name).toBe('Resolved');
    expect(priority.name).toBe('High');
    expect(category.name).toBe('Bug');

    // "Normal" is not in the seeded priorities, so it should have been auto-created.
    const allPriorities = db
      .prepare('SELECT name FROM issue_priorities WHERE project_id = ? ORDER BY sort_order')
      .all(project.id)
      .map((r) => r.name);
    expect(allPriorities).toContain('Normal');

    // "Feature Request" should have been auto-created in categories.
    const allCategories = db
      .prepare('SELECT name FROM issue_categories WHERE project_id = ? ORDER BY sort_order')
      .all(project.id)
      .map((r) => r.name);
    expect(allCategories).toContain('Feature Request');

    // Placeholder users were created and added as members.
    const opener = db.prepare('SELECT * FROM users WHERE id = ?').get(first.created_by);
    expect(opener.email).toBe('james-d-terry@imported.local');
    expect(opener.is_disabled).toBe(1);
    expect(projectMembersDb.getRole(db, project.id, opener.id)).toBe('user');

    const second_opener = db.prepare('SELECT * FROM users WHERE id = ?').get(second.created_by);
    expect(second_opener.email).toBe('andrew-robbins@imported.local');
    expect(second_opener.is_disabled).toBe(1);

    // Synthetic creation event uses the original timestamp + opener as actor.
    const events = historyDb.listForIssue(db, first.id);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('creation');
    expect(events[0].user.id).toBe(opener.id);
    expect(events[0].changed_at).toBe('2025-05-20 19:08:52');

    // Quoted subject with embedded comma and "" should round-trip correctly.
    expect(second.name).toBe('Quoted "subject" with comma, ok');
    expect(second.description).toBeNull();
  });

  it('falls back to project defaults when metadata cells are blank', () => {
    const { db, project } = bootstrap();
    const csv =
      `${HEADER}\n` +
      `1,No-metadata issue,,,,,,2025-05-22 09:55:00 -0400,Andrew Robbins,,,Body text\n`;
    const summary = importIssues(db, project.id, csv);
    expect(summary.imported).toBe(1);

    const issue = db.prepare('SELECT * FROM issues WHERE project_id = ?').get(project.id);
    const defaults = {
      status: db.prepare('SELECT id FROM issue_statuses WHERE project_id = ? AND is_default = 1').get(project.id).id,
      priority: db.prepare('SELECT id FROM issue_priorities WHERE project_id = ? AND is_default = 1').get(project.id).id,
      category: db.prepare('SELECT id FROM issue_categories WHERE project_id = ? AND is_default = 1').get(project.id).id,
    };
    expect(issue.status_id).toBe(defaults.status);
    expect(issue.priority_id).toBe(defaults.priority);
    expect(issue.category_id).toBe(defaults.category);

    // Blank "Last Updated" → falls back to created.
    expect(issue.updated_at).toBe(issue.created_at);
  });

  it('reuses an existing user with a matching name instead of creating a placeholder', () => {
    const { db, project } = bootstrap();
    db.prepare('INSERT INTO users (email, name) VALUES (?, ?)').run('real@example.com', 'James D. Terry');
    const realUser = db
      .prepare('SELECT * FROM users WHERE email = ?')
      .get('real@example.com');

    const csv =
      `${HEADER}\n` +
      `1,Subject,Open,Medium,Bug,,,2025-05-20 15:08:52 -0400,James D. Terry,,,desc\n`;
    importIssues(db, project.id, csv);

    const issue = db.prepare('SELECT * FROM issues WHERE project_id = ?').get(project.id);
    expect(issue.created_by).toBe(realUser.id);
    // The real user (not disabled) should now also be a project member.
    expect(projectMembersDb.getRole(db, project.id, realUser.id)).toBe('user');
    // No placeholder email was created.
    const placeholder = db
      .prepare('SELECT id FROM users WHERE email = ?')
      .get('james-d-terry@imported.local');
    expect(placeholder).toBeUndefined();
  });

  it('skips rows missing required columns, with reasons', () => {
    const { db, project } = bootstrap();
    const csv =
      `${HEADER}\n` +
      `,,,,,,,,,,,\n` + // no subject
      `1,Has subject,,,,,,,Andrew Robbins,,,desc\n` + // no created
      `2,Good row,,,,,,2025-05-20 15:08:52 -0400,Andrew Robbins,,,desc\n`;
    const summary = importIssues(db, project.id, csv);
    expect(summary.imported).toBe(1);
    expect(summary.skipped).toEqual([
      { line: 2, reason: 'missing subject' },
      expect.objectContaining({ line: 3, reason: expect.stringContaining('invalid created date') }),
    ]);
  });
});
