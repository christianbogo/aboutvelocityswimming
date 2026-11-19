import type { Metadata } from "next";
import Link from "next/link";
import Footer from "@/components/Footer";
import styles from "./privacy.module.css";
import { scopedClasses } from "@/lib/styles";

export const metadata: Metadata = {
  title: "Privacy Policy | Velocity Swimming",
  description:
    "How Velocity Swimming collects, uses, stores, and shares personal information, including Google sign-in data, and how to request deletion.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPolicy() {
  return (
    <>
      <main className={scopedClasses(styles, "legal-page")}>
        <div className={scopedClasses(styles, "container")}>
          <div className={scopedClasses(styles, "legal-header")}>
            <Link href="/" className={scopedClasses(styles, "back-link")}>
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <line x1="19" y1="12" x2="5" y2="12"></line>
                <polyline points="12 19 5 12 12 5"></polyline>
              </svg>
              <span>Back to Home</span>
            </Link>
            <div className={scopedClasses(styles, "legal-title-block")}>
              <span className={scopedClasses(styles, "section-badge")}>
                Legal &amp; Transparency
              </span>
              <h1>Privacy Policy</h1>
              <p className={scopedClasses(styles, "last-updated")}>
                Last Updated: November 19, 2026
              </p>
            </div>
          </div>

          <div className={scopedClasses(styles, "legal-content glass-panel")}>
            <section className={scopedClasses(styles, "legal-section")}>
              <h2>1. Introduction</h2>
              <p>
                Velocity Swimming (&ldquo;Velocity,&rdquo; &ldquo;we,&rdquo;
                &ldquo;our,&rdquo; or &ldquo;us&rdquo;) is a nonprofit youth and
                adult aquatics organization serving the Wenatchee Valley and
                North Central Washington. This policy describes information
                handled through our website, accounts, team tools, and online
                store at aboutvelocityswimming.com. Velocity Swimming operates
                these services and is responsible for the information described
                in this policy.
              </p>
            </section>
            <section className={scopedClasses(styles, "legal-section")}>
              <h2>2. Information We Collect</h2>
              <ul>
                <li>
                  <strong>Accounts and inquiries:</strong> Email address,
                  account identifiers, profile and contact details you save,
                  sign-in and verification information, and information you
                  provide when contacting us. If you choose Google sign-in, we
                  receive the information described in the Google sign-in
                  section below.
                </li>
                <li>
                  <strong>Team and household records:</strong> Names, contact
                  details, household and athlete associations, team membership,
                  volunteer shift signups, workshare hours, and related
                  administrative records supplied by families or authorized
                  staff. We also store the primary and favorite athletes you
                  choose to follow in your account.
                </li>
                <li>
                  <strong>Swimming records:</strong> Athlete names, age or age
                  group, competition category, team, events, times, and meet
                  results received from team records, staff imports, and
                  published competition sources.
                </li>
                <li>
                  <strong>Store orders:</strong> Product selections, order and
                  payment status, customer contact details, and billing and
                  shipping information provided during checkout. Stripe
                  processes card details; our website does not receive or store
                  full payment card numbers.
                </li>
                <li>
                  <strong>Technical data:</strong> Our hosting and service
                  providers may record IP addresses, browser and device
                  information, requested pages, timestamps, and error or
                  security logs.
                </li>
              </ul>
            </section>
            <section
              id="google-user-data"
              className={scopedClasses(styles, "legal-section")}
            >
              <h2>3. Google Sign-In and Google User Data</h2>
              <p>
                Google sign-in is optional. You can use an email code instead.
                When you choose to sign in with Google or link Google to an
                existing account, we request basic identity permissions (openid,
                email, and profile). Google supplies a unique account
                identifier, email address and verification status, and basic
                profile information such as your name and profile picture, when
                available. We do not receive your Google password or request
                access to your Gmail messages, Google Drive files, contacts, or
                private calendars. The public team calendar does not require
                access to your personal Google Calendar.
              </p>
              <p>
                <strong>Use:</strong> We use Google identity data to create or
                identify your website account, verify your email, link your
                sign-in method, maintain secure access, and connect you to
                account features and household records you are authorized to
                use. Google sign-in does not grant staff permissions or team
                membership.
              </p>
              <p>
                <strong>Storage and security:</strong> Supabase processes and
                stores Google identity and profile data with your authentication
                record. Authentication tokens are handled by Supabase and your
                browser as part of sign-in and session management. We do not use
                Google access tokens to retrieve data from other Google
                services. Our website uses HTTPS, authenticated sessions, and
                access controls to protect account information. Google identity
                data is retained while needed to provide your account and is
                subject to the retention and deletion process below.
              </p>
              <p>
                <strong>Sharing and Limited Use:</strong> Velocity Swimming
                follows the{" "}
                <a
                  href="https://developers.google.com/terms/api-services-user-data-policy"
                  className={scopedClasses(styles, "legal-link")}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Google API Services User Data Policy
                </a>
                , including its Limited Use requirements, when using or
                transferring information received from Google APIs. We share
                Google identity data with Supabase to provide the account
                features you choose. Other disclosures are limited to security
                needs or legal obligations. We do not sell Google user data, use
                it for advertising, credit or lending decisions, or use it to
                train generalized artificial intelligence or machine learning
                models. Human access is limited to your consent, security
                investigations, or legal obligations. The registration, store,
                and social-media services described below do not receive your
                Google identity record from us; they handle information you
                separately provide when using those services.
              </p>
              <p>
                <strong>Revoke access or request deletion:</strong> You can
                remove Velocity Swimming&rsquo;s access from your{" "}
                <a
                  href="https://myaccount.google.com/connections"
                  className={scopedClasses(styles, "legal-link")}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Google Account connections
                </a>
                . Revocation prevents future Google authorization until you
                reconnect; it does not automatically delete your website
                account, previously stored information, or an existing website
                session. Sign out to end your current website session. To delete
                your website account and stored Google identity data, email{" "}
                <a
                  href="mailto:execboard@velocity-swimming.com?subject=Account%20and%20Google%20data%20deletion%20request"
                  className={scopedClasses(styles, "legal-link")}
                >
                  execboard@velocity-swimming.com
                </a>{" "}
                with the subject &ldquo;Account and Google data deletion
                request.&rdquo; Include the email address associated with your
                account, but do not send passwords or sign-in codes. We verify
                your identity before processing the request. See the retention
                section for records we may need to keep independently of your
                Google connection.
              </p>
            </section>
            <section className={scopedClasses(styles, "legal-section")}>
              <h2>4. How We Use Information</h2>
              <p>
                We use information to provide and secure accounts, connect users
                with their household and authorized tools, administer team and
                volunteer activities, display swimming results, process and
                fulfill orders, respond to inquiries, correct records, and
                maintain the website. Access to restricted tools depends on
                account permissions and verified team or household associations.
              </p>
            </section>
            <section className={scopedClasses(styles, "legal-section")}>
              <h2>5. Service Providers and Information Sharing</h2>
              <p>
                We use service providers to operate the site and deliver the
                services you request:
              </p>
              <ul>
                <li>
                  <strong>Account and data services:</strong> Supabase supports
                  authentication and storage of website and team-tool records.
                  Google supports optional Google sign-in.
                </li>
                <li>
                  <strong>Hosting and email delivery:</strong> Vercel hosts the
                  website, and Resend delivers account emails through our
                  authentication service. These providers process the technical
                  or contact information needed to deliver those services.
                </li>
                <li>
                  <strong>Registration:</strong> SportsEngine handles official
                  team registration and related agreements and billing. Website
                  accounts and team-tool records are also maintained separately
                  from SportsEngine.
                </li>
                <li>
                  <strong>Store payments and fulfillment:</strong> Stripe
                  handles checkout. We send Printful the purchased items and
                  recipient name, shipping address, email, and phone number when
                  available to fulfill paid orders.
                </li>
                <li>
                  <strong>Social media:</strong> Instagram embeds connect your
                  browser to Meta services after you select “Load Instagram
                  posts.” Those services may receive technical information and
                  use cookies when embedded posts load, even if you do not click
                  a post.
                </li>
              </ul>
              <p>
                Provider practices are described in their own policies,
                including the{" "}
                <a
                  href="https://supabase.com/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={scopedClasses(styles, "legal-link")}
                >
                  Supabase Privacy Policy
                </a>
                ,{" "}
                <a
                  href="https://policies.google.com/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={scopedClasses(styles, "legal-link")}
                >
                  Google Privacy Policy
                </a>
                ,{" "}
                <a
                  href="https://www.sportsengine.com/privacy-policy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={scopedClasses(styles, "legal-link")}
                >
                  SportsEngine Privacy Policy
                </a>
                , and{" "}
                <a
                  href="https://stripe.com/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={scopedClasses(styles, "legal-link")}
                >
                  Stripe Privacy Policy
                </a>
                .
              </p>
              <p>
                We do not sell or rent team or account records. Information may
                also be shared with authorized team personnel, governing bodies
                for athletic administration, or when needed to comply with law
                or protect safety. Public result pages and published team
                photographs can be viewed by visitors without an account.
              </p>
            </section>
            <section className={scopedClasses(styles, "legal-section")}>
              <h2>6. Cookies, Browser Storage, and Your Choices</h2>
              <p>
                Sign-in uses cookies to maintain your session. Browser storage
                remembers preferences such as your theme and tool layout. You
                can sign out and clear cookies or site storage in your browser;
                doing so may reset preferences or prevent account features from
                working. Third-party checkout and embedded content may use their
                own cookies and similar technologies under their policies.
              </p>
            </section>
            <section className={scopedClasses(styles, "legal-section")}>
              <h2>7. Young Athletes and Team Media</h2>
              <p>
                Parents or guardians should manage registration and household
                information for children. We handle information about young
                athletes supplied by families, authorized staff, and competition
                sources as described above. If you believe a child has submitted
                personal information without appropriate parent or guardian
                involvement, contact the Executive Board so we can review and
                address it.
              </p>
              <p>
                Team photographs and videos highlight athletic achievements and
                community events. Parents and guardians may request
                non-publication or removal of their child&rsquo;s media by
                contacting the Board. For a privacy concern involving a
                published result, identify the athlete, page, and information at
                issue. Removing information from this website does not remove
                copies held by competition organizers or other websites.
              </p>
              <p>
                Electronic communications with minor athletes must follow the
                team&rsquo;s applicable SafeSport and Minor Athlete Abuse
                Prevention Policy requirements, including parent or guardian
                involvement where required.
              </p>
            </section>
            <section className={scopedClasses(styles, "legal-section")}>
              <h2>8. Retention, Security, and Requests</h2>
              <p>
                Records are retained for team operations, account
                administration, order support, recordkeeping, and applicable
                legal obligations. Retention depends on the type of record and
                its purpose; signing out does not delete records. Access
                controls help protect restricted information, but no website or
                transmission method can guarantee complete security.
              </p>
              <p>
                You may contact the Board to request access to, correction of,
                or deletion of personal information, or to raise a concern about
                its use. We may need to verify your identity or authority to act
                for an athlete or household. Some records may need to be
                retained for legal, financial, safety, or recordkeeping reasons.
                Account deletion removes the authentication record and linked
                Google identity data from the active account system. Separate
                order, volunteer, and historical competition records may remain
                where needed for the purposes above. Any residual backup copies
                remain subject to the service provider&rsquo;s backup retention
                cycle and are not used to restore a deleted account to ordinary
                use. Requests concerning another provider&rsquo;s independent
                records should also be directed to that provider.
              </p>
            </section>
            <section className={scopedClasses(styles, "legal-section")}>
              <h2>9. Updates and Contact</h2>
              <p>
                We may update this policy as our services or practices change.
                The date above identifies the latest revision. Before accessing
                additional Google data or using Google data for a new purpose,
                we will update these disclosures and obtain your consent. For
                privacy questions, record requests, or photo removal requests,
                contact:
              </p>
              <div className={scopedClasses(styles, "contact-card")}>
                <p>
                  <strong>Velocity Swimming Executive Board</strong>
                </p>
                <p>PO Box 2791, Wenatchee, WA 98807</p>
                <p>
                  Email:{" "}
                  <a
                    href="mailto:execboard@velocity-swimming.com"
                    className={scopedClasses(styles, "legal-link")}
                  >
                    execboard@velocity-swimming.com
                  </a>
                </p>
              </div>
            </section>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
