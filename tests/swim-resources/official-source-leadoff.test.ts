import { describe, expect, it } from 'vitest';
import { validateLeadOff } from '@/features/swim-resources/lib/domain/relay';
import { canonicalSwim } from '@/features/swim-resources/lib/domain/swim';
import { validateRecord } from '@/lib/results/validate';
import type { OfficialGoMotionLeadOffVerification } from '@/features/swim-resources/types/schema';

const proof = (): OfficialGoMotionLeadOffVerification => ({
  method: 'Official GoMotion lead-off',
  observationId: '11111111-1111-4111-8111-111111111111',
  decisionId: '22222222-2222-4222-8222-222222222222',
  verified: true, flatStart: true, timingVerified: true, leadOffStatus: 'OK',
  sourceUrl: 'https://www.gomotionapp.com/team/ievs/controller/cms/admin/index',
  sourceMeetId: '653726', workbookSha256: 'a'.repeat(64), sourceRow: 23, memberIdHash: 'b'.repeat(24),
});
const swim = () => ({
  id: 'official-source-leadoff', teamId: 'velocity-swimming', athleteId: 'verified-swimmer',
  athleteName: { first: 'Source', last: 'Swimmer' }, gender: 'M' as const,
  ageAtSwim: 16, ageGroup: '15-16' as const, distance: 50 as const, stroke: 'BK' as const,
  eventCode: '50_BK_SCY', course: 'SCY' as const, round: 'P' as const, status: 'OK' as const,
  isRelay: false, isOfficial: true, timeMs: 25330, resultOrigin: 'relay_leadoff' as const,
  leadOffVerification: proof(), meet: { id: 'official-meet', name: 'Official meet', date: '2026-02-28' },
});

describe('versioned official source lead-off validation', () => {
  it('accepts original meet attestations and requires their reference and first-leg facts', () => {
    const source = { ...swim(), leadOffVerification: {
      method: 'Official meet result', attestationId: '33333333-3333-4333-8333-333333333333',
      verified: true, flatStart: true, timingVerified: true, leadOffStatus: 'OK',
      sourceUrl: 'https://example.test/original-results.pdf',
    } };
    expect(() => validateLeadOff(source)).not.toThrow();
    expect(() => validateRecord('swim', source)).not.toThrow();
    for (const patch of [{ attestationId: undefined }, { attestationId: 'unreviewed' }, { flatStart: false }, { sourceUrl: 'javascript:bad' }]) {
      expect(() => validateLeadOff({ ...source, leadOffVerification: { ...source.leadOffVerification, ...patch } })).toThrow();
    }
    expect(() => validateLeadOff({ ...source, isSplit: true })).toThrow();
    expect(() => validateLeadOff({ ...source, parentRelayResultId: 'invented-parent' })).toThrow();
  });
  it('preserves the complete private proof through both canonical write validators', () => {
    const source = swim();
    expect(() => validateLeadOff(source)).not.toThrow();
    expect(() => validateRecord('swim', source)).not.toThrow();
    expect(canonicalSwim(source).leadOffVerification).toEqual(source.leadOffVerification);
    expect(canonicalSwim(source)).not.toHaveProperty('parentRelayResultId');
  });

  it('accepts a cited review version without assuming it is the latest or approving its source facts', () => {
    for (const decisionId of [proof().decisionId, '33333333-3333-4333-8333-333333333333']) {
      expect(() => validateLeadOff({ ...swim(), leadOffVerification: { ...proof(), decisionId } })).not.toThrow();
    }
  });

  it('uses the existing HTTP and HTTPS source URL policy', () => {
    for (const sourceUrl of ['http://example.test/official-result', 'https://example.test/official-result']) {
      const source = { ...swim(), leadOffVerification: { ...proof(), sourceUrl } };
      expect(() => validateLeadOff(source)).not.toThrow();
      expect(() => validateRecord('swim', source)).not.toThrow();
      expect(canonicalSwim(source).leadOffVerification?.sourceUrl).toBe(sourceUrl);
    }
  });

  it('rejects absent, malformed and unsupported proof fields', () => {
    const invalid = [
      { method: undefined }, { method: 'Unreviewed source' }, { observationId: undefined },
      { observationId: 'not-a-uuid' }, { decisionId: null }, { decisionId: 'latest' },
      { sourceMeetId: 'meet-name' }, { sourceMeetId: '1'.repeat(21) },
      { workbookSha256: 'a'.repeat(63) }, { memberIdHash: 'raw-member-id' },
      { sourceRow: 0 }, { sourceRow: 1.5 }, { sourceRow: '23' }, { sourceRow: 2_147_483_648 },
      { verified: 'true' }, { flatStart: false }, { timingVerified: false }, { leadOffStatus: 'DQ' },
      { sourceUrl: null }, { sourceUrl: undefined }, { sourceUrl: '' },
      { sourceUrl: 'https://user:password@example.test/result' },
      { sourceUrl: 'javascript:alert(1)' }, { dob: '2010-01-01' },
    ];
    for (const patch of invalid) {
      expect(() => validateLeadOff({ ...swim(), leadOffVerification: { ...proof(), ...patch } })).toThrow();
    }
  });

  it('rejects ordinary, unofficial, flying-start and inconsistent race facts', () => {
    const invalid = [
      { resultOrigin: undefined }, { resultOrigin: 'individual' }, { isOfficial: false },
      { status: 'DQ' }, { isRelay: true }, { isSplit: true }, { isRelaySplit: true },
      { relay: { leg: 2, isLeadOffFlatStart: false } },
      { teamId: 'other-team' }, { athleteId: '' }, { gender: null }, { round: 'none' },
      { timeMs: 0 }, { meet: { ...swim().meet, date: '2026-02-30' } },
      { eventCode: '50_FL_SCY', stroke: 'FL' }, { eventCode: '100_BK_SCY' },
      { distance: '50' }, { course: 'LCM' }, { parentRelayResultId: '' }, { parentRelayResultId: 'missing-parent' },
    ];
    for (const patch of invalid) expect(() => validateLeadOff({ ...swim(), ...patch })).toThrow();
  });

  it('keeps the existing linked-parent proof and its source URL behavior', () => {
    const linked = { ...swim(), parentRelayResultId: 'relay-parent',
      leadOffVerification: { verified: true, flatStart: true, timingVerified: true,
        leadOffStatus: 'OK', sourceUrl: 'http://example.test/official-result' } };
    expect(() => validateLeadOff(linked)).not.toThrow();
    expect(() => validateRecord('swim', linked)).not.toThrow();
    expect(() => validateLeadOff({ ...linked, parentRelayStatus: 'DQ' })).not.toThrow();
    expect(() => validateLeadOff({ ...linked, parentRelayResultId: undefined })).toThrow();
  });
});
