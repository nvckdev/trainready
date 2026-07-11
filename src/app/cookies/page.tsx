import { LegalLayout } from "@/components/LegalLayout";

export const metadata = { title: "Cookie Policy — Taper" };

export default function CookiesPage() {
  return (
    <LegalLayout
      title="Cookie Policy"
      subtitle="Legal"
      updated="May 15, 2025"
      sections={[
        {
          heading: "What Are Cookies",
          body: "Cookies are small text files placed on your device when you visit our website. They help us recognise you, remember your preferences, and understand how you interact with Taper so we can improve your experience.",
        },
        {
          heading: "Cookies We Use",
          body: [
            "Essential cookies: required for the platform to function — session management, authentication, and security tokens. These cannot be disabled.",
            "Preference cookies: remember your settings such as language, units (km/miles), and display preferences.",
            "Analytics cookies: help us understand how users navigate the site (e.g. pages visited, time spent) so we can improve the product. Data is aggregated and anonymised.",
            "Performance cookies: monitor load times and errors to help us maintain platform stability.",
          ],
        },
        {
          heading: "Third-Party Cookies",
          body: "We may use trusted third-party services that set their own cookies, including analytics providers (e.g. Vercel Analytics) and payment processors. These third parties have their own privacy policies governing how they use the data collected.",
        },
        {
          heading: "We Do Not Use",
          body: [
            "Advertising or tracking cookies that follow you across other websites.",
            "Cookies that sell or share your data with advertisers.",
            "Fingerprinting or other persistent cross-site tracking technologies.",
          ],
        },
        {
          heading: "Managing Cookies",
          body: "You can control cookies through your browser settings — most browsers allow you to block or delete cookies. Note that disabling essential cookies may prevent parts of Taper from working correctly. You can also opt out of analytics cookies by enabling 'Do Not Track' in your browser.",
        },
        {
          heading: "Cookie Retention",
          body: "Session cookies expire when you close your browser. Persistent cookies remain on your device for a set period (typically 30–365 days) or until you delete them. You can view and clear stored cookies at any time through your browser's developer tools.",
        },
        {
          heading: "Updates to This Policy",
          body: "We may update this Cookie Policy as our platform evolves or regulations change. We will notify you of material changes via email or an in-app notice.",
        },
        {
          heading: "Contact",
          body: "Questions about our use of cookies? Reach us at privacy@trainready.app.",
        },
      ]}
    />
  );
}
