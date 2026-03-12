import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — 0ne Cloud",
  description: "Privacy policy for 0ne Cloud services.",
};

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen flex flex-col bg-[#F6F5F3]">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-4 max-w-5xl mx-auto w-full">
        <Link href="/" className="text-lg font-heading font-bold tracking-tight">
          0ne Cloud
        </Link>
      </nav>

      {/* Content */}
      <main className="flex-1 px-6 py-12 max-w-3xl mx-auto w-full font-body">
        <h1 className="text-4xl font-bold mb-2">Privacy Policy</h1>
        <p className="text-sm text-[#666] mb-10">Last updated: March 11, 2026</p>

        <div className="space-y-8 text-[#22201D] leading-relaxed">
          <section>
            <h2 className="text-xl font-semibold mb-3">1. Introduction</h2>
            <p>
              PROJECT1.ai and 0ne Cloud (&quot;we,&quot; &quot;our,&quot; or
              &quot;us&quot;) are operated by Designed With Pixels LLC. This Privacy Policy
              explains how we collect, use, and protect your information when you
              use our websites (project1.ai and project0ne.ai) and related
              services.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">
              2. Information We Collect
            </h2>
            <p className="mb-3">
              We collect the following types of information:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong>Account Information:</strong> Name, email address, and
                authentication credentials when you create an account via Clerk.
              </li>
              <li>
                <strong>Financial Data (via Plaid):</strong> When you connect
                your bank accounts through Plaid, we receive transaction history,
                account balances, and account metadata (account type, institution
                name, masked account numbers). We never receive your bank login
                credentials.
              </li>
              <li>
                <strong>Usage Data:</strong> Basic analytics about how you
                interact with our services.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">
              3. How We Use Your Information
            </h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                Display your financial data in a personal dashboard for expense
                tracking and budgeting purposes.
              </li>
              <li>
                Categorize and organize transactions to provide financial
                insights.
              </li>
              <li>Authenticate your identity and secure your account.</li>
              <li>Improve and maintain our services.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">
              4. How We Protect Your Information
            </h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                All Plaid access tokens are encrypted at rest using AES-256-CBC
                with a dedicated encryption key.
              </li>
              <li>
                All data in transit is encrypted using TLS 1.2 or higher.
              </li>
              <li>
                Financial API calls are handled server-side only — sensitive
                tokens are never exposed to the browser.
              </li>
              <li>
                Our database (Supabase PostgreSQL) enforces row-level security
                policies and encrypts data at rest.
              </li>
              <li>
                API credentials are stored in environment variables, never in
                source code.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">
              5. Third-Party Services
            </h2>
            <p className="mb-3">We use the following third-party services:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong>Plaid:</strong> To securely connect to your financial
                institutions and retrieve transaction data. Plaid&apos;s use of
                your data is governed by the{" "}
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
                <strong>Clerk:</strong> For authentication and user management.
              </li>
              <li>
                <strong>Supabase:</strong> For secure database hosting.
              </li>
              <li>
                <strong>Vercel:</strong> For application hosting and deployment.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">6. Data Sharing</h2>
            <p>
              We do not sell, rent, or share your personal or financial data with
              third parties for marketing purposes. Data is only shared with the
              third-party service providers listed above, solely for the purpose
              of operating our services.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">
              7. Data Retention and Deletion
            </h2>
            <p>
              We retain your financial data for as long as your account is
              active. You may request deletion of your account and all associated
              data at any time by contacting us. Upon receiving a deletion
              request, we will delete your data within 30 days and revoke all
              connected Plaid access tokens immediately.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">8. Your Rights</h2>
            <p className="mb-3">You have the right to:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Access the personal data we hold about you.</li>
              <li>Request correction of inaccurate data.</li>
              <li>Request deletion of your data.</li>
              <li>
                Disconnect your financial accounts at any time through the
                application.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">9. Contact</h2>
            <p>
              For questions about this privacy policy or to exercise your data
              rights, contact us at:{" "}
              <a
                href="mailto:designedwithpixels@gmail.com"
                className="text-[#FF692D] underline"
              >
                designedwithpixels@gmail.com
              </a>
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">
              10. Changes to This Policy
            </h2>
            <p>
              We may update this privacy policy from time to time. Changes will
              be posted on this page with an updated revision date.
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
