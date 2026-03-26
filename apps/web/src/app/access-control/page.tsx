import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Access Control Policy — 0ne Cloud",
  description: "Access control policy for 0ne Cloud services and data.",
};

export default function AccessControlPolicy() {
  return (
    <div className="min-h-screen flex flex-col bg-[#F6F5F3]">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-4 max-w-5xl mx-auto w-full">
        <Link
          href="/"
          className="text-lg font-heading font-bold tracking-tight"
        >
          0ne Cloud
        </Link>
      </nav>

      {/* Content */}
      <main className="flex-1 px-6 py-12 max-w-3xl mx-auto w-full font-body">
        <h1 className="text-4xl font-bold mb-2">Access Control Policy</h1>
        <p className="text-sm text-[#666] mb-10">Last updated: March 13, 2026</p>

        <div className="space-y-8 text-[#22201D] leading-relaxed">
          <section>
            <h2 className="text-xl font-semibold mb-3">1. Purpose</h2>
            <p>
              This Access Control Policy defines the principles, procedures, and
              controls governing access to 0ne Cloud (&quot;the
              application&quot;) systems and data. It is operated by Jimmy
              Fuentes as a sole proprietor under Designed With Pixels LLC. This
              policy ensures that access is granted based on the principle of
              least privilege and that all access is appropriately managed,
              monitored, and revoked when no longer needed.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">
              2. Principles of Least Privilege
            </h2>
            <p className="mb-3">
              All access to 0ne Cloud systems and data follows the principle of
              least privilege:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                Users are granted only the minimum level of access required to
                use the application.
              </li>
              <li>
                Each user can access only their own data — enforced at the
                database level through Row-Level Security (RLS) policies.
              </li>
              <li>
                Service accounts and API keys are scoped to the narrowest
                permissions necessary for their function.
              </li>
              <li>
                Administrative access to infrastructure is restricted to the sole
                operator.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">
              3. Role-Based Access Controls
            </h2>
            <p className="mb-3">
              Access is managed through the following roles and tiers:
            </p>

            <h3 className="text-lg font-medium mt-4 mb-2">
              3a. End Users (Application Users)
            </h3>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                Authenticated via Clerk with support for email/password and
                social login providers.
              </li>
              <li>
                Multi-factor authentication (MFA) is available and encouraged.
              </li>
              <li>
                Access is scoped to their own data only — users cannot view,
                modify, or delete other users&apos; data.
              </li>
              <li>
                Feature access (KPI Dashboard, Skool Sync, etc.) is controlled
                by a permissions system that maps users to authorized
                applications.
              </li>
            </ul>

            <h3 className="text-lg font-medium mt-4 mb-2">
              3b. System Operator (Administrator)
            </h3>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                A single administrator (the sole operator) has access to all
                infrastructure and production systems.
              </li>
              <li>
                MFA is enabled on all administrative accounts (Vercel, Neon,
                Clerk, Plaid, GitHub).
              </li>
              <li>
                Administrative actions are performed through each
                provider&apos;s authenticated dashboard — there is no shared
                admin panel within the application.
              </li>
            </ul>

            <h3 className="text-lg font-medium mt-4 mb-2">
              3c. Service Accounts and API Keys
            </h3>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong>Database Connection String:</strong> Used server-side only
                for database operations (e.g., cron jobs,
                webhook processing). Never exposed to the client.
              </li>
              <li>
                <strong>API Keys (External Endpoints):</strong> External and
                extension API endpoints require a dedicated API key passed in the
                Authorization header.
              </li>
              <li>
                <strong>CRON_SECRET:</strong> A dedicated token that
                authenticates scheduled cron job requests. Verified at the
                handler level.
              </li>
              <li>
                <strong>Plaid Credentials:</strong> Client ID and secret are
                stored as environment variables and used exclusively server-side.
                Plaid access tokens are encrypted (AES-256-CBC) before database
                storage.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">
              4. Authentication Controls
            </h2>
            <p className="mb-3">
              User authentication is managed entirely by Clerk, providing:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                Secure password hashing and storage (handled by Clerk — 0ne
                Cloud never stores passwords).
              </li>
              <li>
                Session token management with automatic expiration and refresh.
              </li>
              <li>
                Multi-factor authentication (MFA) support via authenticator apps
                and SMS.
              </li>
              <li>
                Bot detection and brute-force protection on sign-in flows.
              </li>
              <li>
                Middleware-level route protection — unauthenticated requests to
                protected routes are redirected to sign-in.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">
              5. Database Access Controls
            </h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong>Row-Level Security (RLS):</strong> Enabled on all
                database tables. Policies ensure users can only read, insert,
                update, or delete rows where the{" "}
                <code className="bg-[#e8e6e3] px-1.5 py-0.5 rounded text-sm">
                  user_id
                </code>{" "}
                matches their authenticated Clerk user ID.
              </li>
              <li>
                <strong>Server-Side Only:</strong> All database queries run
                server-side via Drizzle ORM. No database credentials or
                connection strings are exposed in client bundles.
              </li>
              <li>
                <strong>Direct Database Access:</strong> Direct SQL access to the
                production database is restricted to the sole operator via
                Neon&apos;s dashboard (MFA-protected) or authenticated
                connection strings.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">
              6. API Access Controls
            </h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong>Authenticated Routes:</strong> All application routes are
                protected by Clerk middleware. Requests without valid session
                tokens are redirected to sign-in.
              </li>
              <li>
                <strong>Public Routes:</strong> A limited set of routes are
                publicly accessible: sign-in/sign-up pages, OAuth callbacks,
                webhook endpoints, and policy pages.
              </li>
              <li>
                <strong>External API Endpoints:</strong> Endpoints used by the
                Chrome extension and external integrations require an API key
                in the Authorization header. Requests without valid keys receive
                a 401 response.
              </li>
              <li>
                <strong>Cron Job Endpoints:</strong> Protected by a dedicated
                CRON_SECRET token. The secret is verified in each handler before
                processing.
              </li>
              <li>
                <strong>Webhook Endpoints:</strong> Endpoints receiving data from
                external services validate the source through signature
                verification or shared secrets where supported.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">
              7. Third-Party Access
            </h2>
            <p className="mb-3">
              The following third parties have limited, scoped access to data as
              required for their services:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong>Plaid:</strong> Receives bank credentials directly from
                the user (via Plaid Link) and returns tokenized access. 0ne
                Cloud stores only the encrypted access token — never bank login
                credentials. Access tokens can be revoked at any time.
              </li>
              <li>
                <strong>Clerk:</strong> Manages user authentication data (email,
                name, session tokens). No access to financial data.
              </li>
              <li>
                <strong>Neon:</strong> Hosts the serverless PostgreSQL database.
                Neon staff may access infrastructure for support purposes
                under their SOC 2 obligations but do not have application-level
                access to user data.
              </li>
              <li>
                <strong>Vercel:</strong> Hosts the application and stores
                environment variables. Vercel staff may access infrastructure for
                support under their SOC 2 obligations.
              </li>
            </ul>
            <p className="mt-3">
              No third party has been granted standing access to user financial
              data. Data sharing is limited to the minimum required for service
              operation.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">
              8. Granting, Modifying, and Revoking Access
            </h2>

            <h3 className="text-lg font-medium mt-4 mb-2">
              Granting Access
            </h3>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong>End Users:</strong> Access is granted through Clerk
                sign-up. Users gain access to the application immediately upon
                account creation. Feature-specific access is granted by the
                administrator through the permissions system.
              </li>
              <li>
                <strong>Financial Account Access:</strong> Users connect bank
                accounts through Plaid Link at their own discretion. Each
                connection requires explicit user consent within the Plaid
                interface.
              </li>
              <li>
                <strong>Infrastructure Access:</strong> Only the sole operator
                has infrastructure access. No process exists for granting
                infrastructure access to others, as no employees or contractors
                are involved.
              </li>
            </ul>

            <h3 className="text-lg font-medium mt-4 mb-2">
              Modifying Access
            </h3>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                Feature access is modified by the administrator through the
                permissions system (database-level mapping of users to
                applications).
              </li>
              <li>
                Users can add or remove connected bank accounts at any time
                through the application.
              </li>
            </ul>

            <h3 className="text-lg font-medium mt-4 mb-2">
              Revoking Access
            </h3>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                User accounts can be disabled or deleted through the Clerk
                dashboard by the administrator.
              </li>
              <li>
                Plaid access tokens are revoked immediately upon user request or
                account deletion.
              </li>
              <li>
                API keys can be rotated or revoked through Vercel environment
                variable management.
              </li>
              <li>
                Upon account deletion, all associated data (financial records,
                access tokens, user profile) is deleted within 30 days.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">
              9. Access Review Schedule
            </h2>
            <p className="mb-3">
              Access controls are reviewed on the following schedule:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong>Monthly:</strong> Review active user accounts and
                connected financial institutions. Verify no unauthorized accounts
                exist.
              </li>
              <li>
                <strong>Quarterly:</strong> Review and rotate API keys,
                CRON_SECRET, and other service credentials. Verify MFA is
                enabled on all infrastructure accounts. Review third-party
                service access and permissions.
              </li>
              <li>
                <strong>Annually:</strong> Full review of this access control
                policy. Audit all database RLS policies for correctness. Review
                Plaid, Clerk, Neon, and Vercel access configurations.
              </li>
              <li>
                <strong>Event-Driven:</strong> Immediate review following any
                security incident, infrastructure change, or new third-party
                integration.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">
              10. Policy Approval
            </h2>
            <p className="mb-3">
              This policy is approved by Jimmy Fuentes, owner and sole operator
              of 0ne Cloud, operating under Designed With Pixels LLC.
            </p>
            <p>
              <strong>Approved by:</strong> Jimmy Fuentes, Owner — Designed With
              Pixels LLC
            </p>
            <p>
              <strong>Approval date:</strong> March 13, 2026
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">11. Contact</h2>
            <p>
              For questions about this access control policy, contact us at:{" "}
              <a
                href="mailto:designedwithpixels@gmail.com"
                className="text-[#FF692D] underline"
              >
                designedwithpixels@gmail.com
              </a>
            </p>
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="px-6 py-8 text-center text-sm text-[#666]">
        <p>0ne Cloud</p>
      </footer>
    </div>
  );
}
