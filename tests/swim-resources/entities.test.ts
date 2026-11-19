import { describe, expect, it } from 'vitest';
import { canonicalEntity, entityReferences, owningTeam, relationshipPath, VELOCITY_TEAM_ID } from '@/features/swim-resources/lib/domain/entities';

describe('entity relationships', () => {
  it('defaults only team-specific ownership and keeps explicit teams and host identities', () => {
    expect(owningTeam('athletes', {})).toEqual({ id: VELOCITY_TEAM_ID, assumed: true });
    expect(owningTeam('meets', { hostTeamId: 'host', teamId: 'other' })).toEqual({ id: 'other', assumed: false });
    expect(owningTeam('standards', {})).toBeNull();
    expect(owningTeam('public_athletes', {})).toBeNull();
    expect(canonicalEntity('person', null, { name: 'Synthetic Coach' }, 'p1').teamId).toBe(VELOCITY_TEAM_ID);
  });
  it('links explicit IDs, supports encoded legacy IDs, and never turns arbitrary paths into links', () => {
    expect(relationshipPath('venueId', 'pool 1')).toBe('venues/pool 1');
    expect(relationshipPath('hostTeamId', 'host')).toBe('teams/host');
    expect(relationshipPath('personId', '../secret')).toBeNull();
    expect(relationshipPath('name', 'p1')).toBeNull();
    expect(entityReferences({ teamId: VELOCITY_TEAM_ID, venueId: 'v1', documentIds: ['d1', 'd1'], host: 'Host snapshot' })).toEqual(['teams/velocity-swimming', 'venues/v1', 'documents/d1']);
  });
});
