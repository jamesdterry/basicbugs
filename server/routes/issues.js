import express from 'express';
import { createRequireProjectRole } from '../middleware/requireProjectRole.js';
import * as issues from '../services/issues.js';

export function createIssuesRouter({ db }) {
  const router = express.Router({ mergeParams: true });
  const requireProjectViewer = createRequireProjectRole({ db, minimum: 'viewer' });

  router.use(requireProjectViewer);

  router.get('/', (req, res, next) => {
    try {
      const result = issues.listIssues(db, req.project.id, req.query);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  router.post('/', (req, res, next) => {
    try {
      const issue = issues.createIssue(
        db,
        req.project.id,
        req.user.id,
        req.projectRole,
        req.body ?? {},
      );
      res.status(201).json({ issue });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:number', (req, res, next) => {
    try {
      const number = parseNumber(req, res);
      if (number == null) return;
      const result = issues.getIssue(db, req.project.id, number);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  router.patch('/:number', (req, res, next) => {
    try {
      const number = parseNumber(req, res);
      if (number == null) return;
      const body = req.body ?? {};
      const issue = issues.updateIssue(
        db,
        req.project.id,
        number,
        req.user.id,
        req.projectRole,
        body.patch ?? {},
        body.note ?? null,
      );
      res.json({ issue });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:number/comments', (req, res, next) => {
    try {
      const number = parseNumber(req, res);
      if (number == null) return;
      const issue = issues.commentIssue(
        db,
        req.project.id,
        number,
        req.user.id,
        req.projectRole,
        req.body?.body,
      );
      res.status(201).json({ issue });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:number/archive', (req, res, next) => {
    try {
      const number = parseNumber(req, res);
      if (number == null) return;
      const issue = issues.archiveIssue(
        db,
        req.project.id,
        number,
        req.user.id,
        req.projectRole,
      );
      res.json({ issue });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:number/unarchive', (req, res, next) => {
    try {
      const number = parseNumber(req, res);
      if (number == null) return;
      const issue = issues.unarchiveIssue(
        db,
        req.project.id,
        number,
        req.user.id,
        req.projectRole,
      );
      res.json({ issue });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

function parseNumber(req, res) {
  const n = Number.parseInt(req.params.number, 10);
  if (!Number.isInteger(n) || n <= 0) {
    res.status(404).json({ error: 'not_found' });
    return null;
  }
  return n;
}
