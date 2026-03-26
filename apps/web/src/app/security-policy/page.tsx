import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Information Security Policy — 0ne Cloud",
  description:
    "Information security policy for 0ne Cloud services and Plaid integration.",
};

export default function InformationSecurityPolicy() {
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
        <h1 className="text-4xl font-bold mb-2">Information Security Policy</h1>
        <p className="text-sm text-[#666] mb-10">Last updated: March 13, 2026</p>

        <div className="space-y-8 text-[#22201D] leading-relaxed">
          <section>
            <h2 className="text-xl font-semibold mb-3">1. Policy Objectives</h2>
            <p className="mb-3">
              This Information Security Policy defines the security objectives,
              accountability, and scope for 0ne Cloud (&quot;the
              application&quot;), operated by Jimmy Fuentes as a sole proprietor
              under Designed With Pixels LLC. The purpose of this policy is to:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                Protect the confidentiality, integrity, and availability of user
                data, including financial information obtained through Plaid.
              </li>
              <li>
                Establish clear security responsibilities and accountability.
              </li>
              <li>
                Define the controls and practices used to safeguard systems and
                data.
              </li>
              <li>
                Ensure compliance with third-party requirements, including
                Plaid&apos;s security standards.
              </li>
              <li>
                Provide a framework for continuous improvement of security
                practices.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">
              2. Scope and Accountability
            </h2>
            <p className="mb-3">
              This policy applies to all systems, data, and processes associated
              with 0ne Cloud, including:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                The 0ne Cloud web application hosted on Vercel
                (app.0neos.com).
              </li>
              <li>The Neon PostgreSQL database and all stored data.</li>
              <li>
                All third-party integrations (Plaid, Clerk, Neon, Vercel).
              </li>
              <li>
                All API endpoints, cron jobs, and external-facing services.
              </li>
              <li>Development environments and source code repositories.</li>
            </ul>
            <p className="mt-3">
              As a sole-proprietor operation, Jimmy Fuentes serves as the
              owner, developer, and administrator responsible for all security
              decisions, implementation, and incident response. All security
              accountability rests with the sole operator.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">
              3. Data Protection and Encryption
            </h2>
            <p className="mb-3">
              We employ multiple layers of encryption and data protection:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong>Encryption at Rest:</strong> Plaid access tokens are
                encrypted using AES-256-CBC with a dedicated encryption key
                before storage. The Neon PostgreSQL database encrypts all
                data at rest.
              </li>
              <li>
                <strong>Encryption in Transit:</strong> All communications use
                TLS 1.2 or higher. Vercel enforces HTTPS on all endpoints.
              </li>
              <li>
                <strong>Secret Management:</strong> All API keys, database
                credentials, and encryption keys are stored as environment
                variables in Vercel&apos;s encrypted secrets store. Secrets are
                never committed to source code or exposed client-side.
              </li>
              <li>
                <strong>Sensitive Token Handling:</strong> Financial API calls
                (Plaid) are handled exclusively server-side. Plaid access tokens
                are never sent to the browser.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">4. Access Controls</h2>
            <p className="mb-3">
              Access to systems and data is controlled through multiple
              mechanisms:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong>User Authentication:</strong> All user authentication is
                handled by Clerk, which supports multi-factor authentication
                (MFA), session management, and secure password policies.
              </li>
              <li>
                <strong>Database Security:</strong> Row-Level Security (RLS) is
                enforced on all database tables, ensuring users can only access
                their own data. The database service role key is restricted to
                server-side operations only.
              </li>
              <li>
                <strong>API Authentication:</strong> External API endpoints use
                API key authentication. Cron job endpoints require a dedicated
                CRON_SECRET token. All authentication checks occur at the
                middleware level.
              </li>
              <li>
                <strong>Infrastructure Access:</strong> Access to Vercel,
                Neon, and GitHub is restricted to the sole operator with MFA
                enabled on all accounts.
              </li>
            </ul>
            <p className="mt-3">
              For full details, see our{" "}
              <Link
                href="/access-control"
                className="text-[#FF692D] underline"
              >
                Access Control Policy
              </Link>
              .
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">
              5. Third-Party Services
            </h2>
            <p className="mb-3">
              0ne Cloud relies on the following third-party services, each
              selected for their security posture and compliance certifications:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong>Plaid:</strong> Financial data aggregation. SOC 2 Type
                II certified. Handles bank credential exchange directly — 0ne
                Cloud never receives or stores bank login credentials. Usage
                governed by the{" "}
                <a
                  href="https://plaid.com/legal/#end-user-privacy-policy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#FF692D] underline"
                >
                  Plaid End User Privacy Policy
                </a>
                .
              </li>
              <li>
                <strong>Clerk:</strong> Authentication and user management. SOC
                2 Type II certified. Handles password hashing, session tokens,
                and MFA.
              </li>
              <li>
                <strong>Neon:</strong> Serverless PostgreSQL database. SOC 2
                Type II certified. Provides encryption at rest, automated
                backups, and branching for safe migrations.
              </li>
              <li>
                <strong>Vercel:</strong> Application hosting and deployment. SOC
                2 Type II certified. Provides edge network, TLS termination, and
                environment variable encryption.
              </li>
              <li>
                <strong>GitHub:</strong> Source code management. SOC 2 certified.
                Private repositories with branch protection enabled.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">
              6. Incident Response
            </h2>
            <p className="mb-3">
              In the event of a security incident (unauthorized access, data
              breach, or system compromise), the following steps will be taken:
            </p>
            <ol className="list-decimal pl-6 space-y-2">
              <li>
                <strong>Identify and Contain:</strong> Immediately investigate
                the scope of the incident. Revoke compromised credentials, API
                keys, or access tokens. Disable affected services if necessary.
              </li>
              <li>
                <strong>Assess Impact:</strong> Determine what data was affected,
                how many users are impacted, and the root cause of the incident.
              </li>
              <li>
                <strong>Notify:</strong> Notify affected users within 72 hours of
                confirmed breach. Notify Plaid and other relevant third parties
                as required by their agreements.
              </li>
              <li>
                <strong>Remediate:</strong> Patch the vulnerability, rotate all
                potentially compromised secrets, and restore services from
                backups if needed.
              </li>
              <li>
                <strong>Document and Review:</strong> Document the incident,
                timeline, and remediation steps. Update security controls to
                prevent recurrence.
              </li>
            </ol>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">
              7. Operator Security (Sole Proprietor)
            </h2>
            <p className="mb-3">
              As a sole-operator application, the following personal security
              practices are maintained:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                Multi-factor authentication (MFA) is enabled on all
                infrastructure accounts (GitHub, Vercel, Neon, Clerk
                dashboard, Plaid dashboard).
              </li>
              <li>
                Unique, strong passwords are used for each service, managed
                through a password manager.
              </li>
              <li>
                Development is performed on encrypted devices with screen lock
                enabled.
              </li>
              <li>
                Source code is stored in private GitHub repositories with no
                public access.
              </li>
              <li>
                No additional employees, contractors, or third parties have
                access to production systems or data.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">8. Data Retention</h2>
            <p className="mb-3">
              We retain data according to the following guidelines:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong>User Financial Data:</strong> Retained for as long as the
                user&apos;s account is active and their bank accounts are
                connected.
              </li>
              <li>
                <strong>Plaid Access Tokens:</strong> Stored encrypted and
                revoked immediately upon user request or account deletion.
              </li>
              <li>
                <strong>Account Data:</strong> Deleted within 30 days of a
                deletion request, including all associated financial data.
              </li>
              <li>
                <strong>Logs and Analytics:</strong> Application logs are
                retained for up to 90 days for debugging and security monitoring.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">
              9. Policy Review and Approval
            </h2>
            <p className="mb-3">
              This policy is approved by Jimmy Fuentes, owner and sole operator
              of 0ne Cloud, operating under Designed With Pixels LLC.
            </p>
            <p className="mb-3">
              This policy is reviewed and updated:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>At least annually, or more frequently as needed.</li>
              <li>
                Whenever there is a significant change to the application
                architecture, third-party services, or security practices.
              </li>
              <li>
                Following any security incident, to incorporate lessons learned.
              </li>
            </ul>
            <p className="mt-3">
              <strong>Approved by:</strong> Jimmy Fuentes, Owner — Designed With
              Pixels LLC
            </p>
            <p>
              <strong>Approval date:</strong> March 13, 2026
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">10. Contact</h2>
            <p>
              For questions about this security policy, contact us at:{" "}
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
