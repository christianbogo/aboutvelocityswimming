import type { RelayResult } from '../../types/schema';
import { heldUuid } from '../../../../lib/collection/held-observations.ts';
import { isCalendarDate } from './date.ts';
import { VELOCITY_TEAM_ID } from './entities.ts';
import { formatSwimTime, parseSwimTime } from './swim-time.ts';

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown): value is number => Number.isSafeInteger(value);
const identity = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Unsupported race detail fields.');
}
export function validateRaceSplits(data: Record<string, unknown>): void {
  if (data.splitCoverage !== undefined && !['complete', 'partial', 'unavailable'].includes(String(data.splitCoverage))) throw new Error('Invalid split coverage.');
  if (data.splits === undefined) {
    if (data.splitCoverage === 'complete') throw new Error('Complete splits require reported split times.');
    return;
  }
  if (!Array.isArray(data.splits) || data.splits.length > 1000) throw new Error('Race splits must be a bounded list.');
  let distance = 0, time = 0;
  for (const split of data.splits) {
    if (!object(split)) throw new Error('Invalid race split.');
    keys(split, ['distance', 'cumulativeMs', 'lapMs', 'strokeCount', 'tempoSeconds']);
    if (!integer(split.distance) || split.distance <= distance || Number(split.distance) > Number(data.distance) || !integer(split.cumulativeMs) || split.cumulativeMs <= time) throw new Error('Split distances and cumulative times must increase within the event.');
    if (Number(data.timeMs) > 0 && split.cumulativeMs > Number(data.timeMs)) throw new Error('A split exceeds the race total.');
    if (split.lapMs !== undefined && (!integer(split.lapMs) || split.lapMs !== split.cumulativeMs - time)) throw new Error('Split elapsed time differs from the cumulative times.');
    if (split.strokeCount !== undefined && (!integer(split.strokeCount) || split.strokeCount < 0)) throw new Error('Invalid stroke count.');
    if (split.tempoSeconds !== undefined && (typeof split.tempoSeconds !== 'number' || !Number.isFinite(split.tempoSeconds) || split.tempoSeconds <= 0)) throw new Error('Invalid stroke tempo.');
    distance = split.distance;
    time = split.cumulativeMs;
  }
  if (data.splitCoverage === 'unavailable' && data.splits.length) throw new Error('Unavailable splits cannot include verified timings.');
  if (data.splitCoverage === 'complete' && (!data.splits.length || distance !== data.distance || time !== data.timeMs)) throw new Error('Complete splits must finish at the exact race distance and time.');
}
export function validateLeadOff(data: Record<string, unknown>): void {
  if (data.resultOrigin === undefined) {
    if (data.parentRelayResultId !== undefined || data.leadOffVerification !== undefined) throw new Error('Lead-off provenance requires its result origin.');
    return;
  }
  const verification = data.leadOffVerification;
  if (data.resultOrigin !== 'relay_leadoff' || data.isRelay !== false || data.status !== 'OK' || data.isOfficial !== true || !object(verification)) throw new Error('A lead-off result requires a verified official individual time.');
  if (verification.verified !== true || verification.flatStart !== true || verification.timingVerified !== true || verification.leadOffStatus !== 'OK') throw new Error('A lead-off needs separate valid-start and official-timing evidence.');
  let url: URL;
  try { url = new URL(String(verification.sourceUrl)); } catch { throw new Error('Lead-off verification requires a source URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid lead-off verification source URL.');
  const commonKeys = ['verified', 'flatStart', 'timingVerified', 'leadOffStatus', 'sourceUrl'];
  if (data.parentRelayResultId == null && verification.method === 'Official GoMotion lead-off') {
    keys(verification, [...commonKeys, 'method', 'observationId', 'decisionId', 'sourceMeetId', 'workbookSha256', 'sourceRow', 'memberIdHash']);
    if (typeof verification.observationId !== 'string' || !heldUuid.test(verification.observationId) ||
        typeof verification.decisionId !== 'string' || !heldUuid.test(verification.decisionId) ||
        typeof verification.sourceMeetId !== 'string' || !/^[0-9]{1,20}$/.test(verification.sourceMeetId) ||
        typeof verification.workbookSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(verification.workbookSha256) ||
        typeof verification.memberIdHash !== 'string' || !/^[a-f0-9]{24}$/.test(verification.memberIdHash) ||
        !integer(verification.sourceRow) || verification.sourceRow <= 0 || verification.sourceRow > 2_147_483_647 ||
        typeof verification.sourceUrl !== 'string') {
      throw new Error('An official source lead-off requires a versioned observation and review reference.');
    }
    if (data.teamId !== VELOCITY_TEAM_ID || !identity(data.athleteId) ||
        !object(data.meet) || !identity(data.meet.id) || typeof data.meet.date !== 'string' || !isCalendarDate(data.meet.date) ||
        !['F', 'P', 'S', 'TT'].includes(String(data.round)) || !['F', 'M', 'X'].includes(String(data.gender)) ||
        !integer(data.timeMs) || data.timeMs <= 0 ||
        !integer(data.distance) || typeof data.stroke !== 'string' || typeof data.course !== 'string' ||
        !/^(25|50|100|200)_(FR|BK)_(SCY|SCM|LCM)$/.test(String(data.eventCode)) ||
        data.eventCode !== `${data.distance}_${data.stroke}_${data.course}` ||
        (data.isSplit != null && data.isSplit !== false) || (data.isRelaySplit != null && data.isRelaySplit !== false) ||
        data.relay !== undefined) throw new Error('An official source lead-off requires coherent first-leg race facts.');
    // The database binds this shape to the immutable accepted source, cited
    // review version and canonical swimmer. Client validation cannot approve it.
    return;
  }
  if (!identity(data.parentRelayResultId)) throw new Error('A lead-off result requires a parent relay or reviewed official source.');
  keys(verification, commonKeys);
}
export function canonicalRelayResult(data: Record<string, unknown>): RelayResult {
  if (!identity(data.id) || !identity(data.teamId) || !object(data.meet) || !identity(data.meet.id) || typeof data.meet.name !== 'string' || !data.meet.name.trim() || !isCalendarDate(String(data.meet.date))) throw new Error('A relay needs stable team, meet and result identities.');
  if (!['SCY', 'LCM', 'SCM'].includes(String(data.course)) || !['F', 'M', 'X'].includes(String(data.gender)) || !['FR', 'IM'].includes(String(data.stroke)) || ![100, 200, 400, 800].includes(Number(data.distance))) throw new Error('Invalid relay event.');
  if (data.eventCode !== `${data.distance}_${data.stroke === 'IM' ? 'MED' : 'FR'}-R_${data.course}`) throw new Error('Relay event code differs from its event.');
  if (typeof data.relayName !== 'string' || !data.relayName.trim() || data.relayName.length > 160 || typeof data.ageGroup !== 'string' || data.ageGroup.length > 30 || !['F', 'P', 'S', 'TT'].includes(String(data.round)) || !['OK', 'DQ', 'DFS', 'NS'].includes(String(data.status)) || typeof data.isOfficial !== 'boolean' || !integer(data.timeMs) || data.timeMs < 0 || (data.status === 'OK' && data.timeMs <= 0)) throw new Error('Invalid observed relay result.');
  if (typeof data.timeDisplay !== 'string' || (data.status === 'OK' && parseSwimTime(data.timeDisplay) !== data.timeMs)) throw new Error('Relay display time differs from its total.');
  if (!Array.isArray(data.members) || data.members.length > 4) throw new Error('A relay needs a bounded observed lineup.');
  const legs = new Set(), athletes = new Set();
  for (const member of data.members) {
    if (!object(member)) throw new Error('Invalid relay member.');
    keys(member, ['leg', 'athleteId', 'name', 'gender', 'stroke', 'timeMs', 'leadOffEligible']);
    if (![1, 2, 3, 4].includes(Number(member.leg)) || !integer(member.leg) || legs.has(member.leg) || typeof member.name !== 'string' || !member.name.trim() || member.name.length > 160) throw new Error('A relay member needs a unique observed leg and name.');
    if (member.athleteId !== undefined && (!identity(member.athleteId) || athletes.has(member.athleteId))) throw new Error('Relay athletes must have distinct stable links.');
    if (member.gender !== undefined && !['F', 'M', 'X'].includes(String(member.gender))) throw new Error('Invalid member gender.');
    if (member.stroke !== undefined && !['FR', 'BK', 'BR', 'FL'].includes(String(member.stroke))) throw new Error('Invalid member stroke.');
    if (member.timeMs !== undefined && (!integer(member.timeMs) || member.timeMs <= 0 || (data.timeMs > 0 && member.timeMs > data.timeMs))) throw new Error('Invalid relay leg time.');
    if (member.leadOffEligible !== undefined && (typeof member.leadOffEligible !== 'boolean' || (member.leadOffEligible && (member.leg !== 1 || !member.athleteId)))) throw new Error('Only a linked first swimmer can have a verified lead-off.');
    legs.add(member.leg); if (member.athleteId) athletes.add(member.athleteId);
  }
  validateRaceSplits(data);
  return { ...data, members: [...data.members].sort((a, b) => a.leg - b.leg), timeDisplay: data.status === 'OK' ? formatSwimTime(data.timeMs) : String(data.status) } as unknown as RelayResult;
}
