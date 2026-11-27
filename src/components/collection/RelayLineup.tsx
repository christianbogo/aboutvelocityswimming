import Link from "next/link";
import { athleteTimesHref } from "./times-url-state";
import { relayMemberName, type Race } from "@/features/swimming/domain/times";
import s from "./RelayLineup.module.css";

export default function RelayLineup({
  race,
  linkProfiles = false,
}: {
  race: Race;
  linkProfiles?: boolean;
}) {
  return (
    <ul className={s.lineup} aria-label="Relay swimmers">
      {[1, 2, 3, 4].map((leg) => {
        const member = race.members?.find((member) => member.leg === leg);
        return (
          <li key={leg} title={member?.name || `Leg ${leg} unreported`}>
            {linkProfiles && member?.athleteId ? (
              <Link
                href={athleteTimesHref(member.athleteId, race.course)}
                aria-label={`View Times profile for ${member.name}`}
              >
                {relayMemberName(member.name)}
              </Link>
            ) : (
              relayMemberName(member?.name || "")
            )}
          </li>
        );
      })}
    </ul>
  );
}
