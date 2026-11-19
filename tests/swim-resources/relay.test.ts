import { describe, expect, it } from 'vitest';
import { canonicalRelayResult, validateLeadOff, validateRaceSplits } from '@/features/swim-resources/lib/domain/relay';

const relay = () => ({ id: 'relay-1', teamId: 'club', relayName: 'Club A', eventCode: '200_MED-R_SCY', distance: 200, stroke: 'IM', course: 'SCY', gender: 'X', ageGroup: '10&U', round: 'F', status: 'OK', timeMs: 140000, timeDisplay: '2:20.00', isOfficial: true, meet: { id: 'meet', name: 'Championship', date: '2026-07-10' }, members: [{ leg: 2, athleteId: 'b', name: 'Swimmer B' }, { leg: 1, athleteId: 'a', name: 'Swimmer A' }], splits: [{ distance: 50, cumulativeMs: 30000, lapMs: 30000 }, { distance: 200, cumulativeMs: 140000, lapMs: 110000 }], splitCoverage: 'partial' });
const leadOff = () => ({ id: 'lead-1', athleteId: 'a', isRelay: false, isOfficial: true, status: 'OK', resultOrigin: 'relay_leadoff', parentRelayResultId: 'relay-1', leadOffVerification: { verified: true, flatStart: true, timingVerified: true, leadOffStatus: 'OK', sourceUrl: 'https://example.test/results' } });

describe('relay result integrity', () => {
  it('stores a team total without an athlete and sorts the observed legs', () => {
    const result = canonicalRelayResult(relay());
    expect(result.members.map(member => member.leg)).toEqual([1, 2]);
    expect(result).not.toHaveProperty('athleteId');
    expect(result.ageGroup).toBe('10&U');
  });
  it('retains totals with missing members and unavailable splits', () => {
    expect(canonicalRelayResult({ ...relay(), members: [], splits: [], splitCoverage: 'unavailable' }).timeMs).toBe(140000);
  });
  it('retains reviewed competition ages without accepting birth dates or invalid ages', () => {
    const result = { ...relay(), recordAgeGroup: '9-10', members: [{ leg: 1, name: 'A', ageAtSwim: 10 }] };
    expect(canonicalRelayResult(result).members[0].ageAtSwim).toBe(10);
    expect(canonicalRelayResult(result).recordAgeGroup).toBe('9-10');
    for (const ageAtSwim of [-1, 121, 9.5, '10']) {
      expect(() => canonicalRelayResult({ ...result, members: [{ leg: 1, name: 'A', ageAtSwim }] })).toThrow();
    }
  });
  it('rejects repeated legs or swimmer identities and wrong event codes', () => {
    for (const patch of [{ members: [{ leg: 1, name: 'A' }, { leg: 1, name: 'B' }] }, { members: [{ leg: 1, athleteId: 'a', name: 'A' }, { leg: 2, athleteId: 'a', name: 'A' }] }, { eventCode: '200_FR-R_SCY' }]) expect(() => canonicalRelayResult({ ...relay(), ...patch })).toThrow();
  });
  it('rejects private information inside public member objects', () => {
    expect(() => canonicalRelayResult({ ...relay(), members: [{ leg: 1, name: 'A', dob: '2015-01-01' }] })).toThrow('Unsupported');
  });
  it('requires monotonic verified distances and exact cumulative arithmetic', () => {
    for (const splits of [[{ distance: 250, cumulativeMs: 30000 }], [{ distance: 50, cumulativeMs: 30000 }, { distance: 100, cumulativeMs: 29000 }], [{ distance: 50, cumulativeMs: 30000, lapMs: 31000 }], [{ distance: 50, cumulativeMs: 150000 }]]) expect(() => validateRaceSplits({ ...relay(), splits })).toThrow();
    expect(() => validateRaceSplits({ ...relay(), splitCoverage: 'complete', splits: [{ distance: 200, cumulativeMs: 139999 }] })).toThrow();
  });
  it('requires separate start and timing evidence for a lead-off', () => {
    expect(() => validateLeadOff(leadOff())).not.toThrow();
    for (const patch of [{ isRelay: true }, { status: 'DQ' }, { leadOffVerification: { ...leadOff().leadOffVerification, timingVerified: false } }, { parentRelayResultId: undefined }]) expect(() => validateLeadOff({ ...leadOff(), ...patch })).toThrow();
    // Parent status is deliberately not consulted: a later teammate DQ does not invalidate a verified first leg.
    expect(() => validateLeadOff({ ...leadOff(), parentRelayStatus: 'DQ' })).not.toThrow();
  });
});
