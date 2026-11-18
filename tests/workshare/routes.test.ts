import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN_PATH, isWorkshareRoute, worksharePath } from '../../src/features/workshare/lib/routes.ts';

test('Admin is standalone and legacy Workshare bookmarks remain recognized', () => {
  assert.equal(ADMIN_PATH, '/tools/admin');
  for (const path of ['', 'overview', 'login', 'guest', 'logs', 'jobs', 'admin/families', 'admin/families/family-123', 'admin/roster', 'admin/settings']) {
    assert.equal(isWorkshareRoute(path ? path.split('/') : []), true, path);
  }
  for (const path of ['missing', 'admin', 'swim-resources', 'admin/families/id/extra']) {
    assert.equal(isWorkshareRoute(path.split('/')), false, path);
  }
  assert.equal(worksharePath(), '/tools/workshare');
  assert.equal(worksharePath('/guest'), '/tools/workshare/guest');
});
