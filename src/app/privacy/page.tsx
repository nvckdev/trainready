import { LegalLayout } from "@/components/LegalLayout";

export const metadata = { title: "Privacy Policy — TRAINREADY" };

export default function PrivacyPage() {
  return (
    <LegalLayout
      title="Privacy Policy"
      subtitle="Legal"
      updated="May 15, 2025"
      sections={[
        {
          heading: "Overview",
          body: "TRAINREADY ('we', 'our', or 'us') is committed to protecting your personal information. This Privacy Policy explains how we collect, use, disclose, and safeguard your data when you use our mobile application and website. By using TRAINREADY, you agree to the practices described here.",
        },
        {
          heading: "Information We Collect",
          body: [
            "Account information: name, email address, and password when you register.",
            "Athletic data: workout logs, GPS routes, heart rate, pace, power output, and other training metrics you record.",
            "Device information: device type, operating system, and unique device identifiers.",
            "Usage data: features you access, session duration, and in-app interactions.",
            "Payment information: processed securely through our payment provider — we do not store card details.",
          ],
        },
        {
          heading: "How We Use Your Information",
          body: [
            "To provide, personalise, and improve the TRAINREADY platform and your training experience.",
            "To generate performance insights, training recommendations, and race-day strategy.",
            "To send transactional emails and, where you have opted in, product updates and coaching tips.",
            "To detect and prevent fraud, abuse, and security incidents.",
            "To comply with legal obligations.",
          ],
        },
        {
          heading: "Sharing Your Information",
          body: "We do not sell your personal data. We may share data with trusted service providers who assist in operating our platform (e.g. cloud hosting, analytics, payment processing), all bound by confidentiality agreements. We may also disclose information where required by law or to protect the rights and safety of our users.",
        },
        {
          heading: "Data Retention",
          body: "We retain your account and training data for as long as your account is active. You may request deletion of your account and associated data at any time by contacting us at privacy@trainready.app. Certain records may be retained for legal compliance purposes.",
        },
        {
          heading: "Your Rights",
          body: [
            "Access: request a copy of the personal data we hold about you.",
            "Correction: ask us to correct inaccurate or incomplete data.",
            "Deletion: request that we delete your personal data, subject to legal obligations.",
            "Portability: receive your training data in a machine-readable format.",
            "Opt-out: unsubscribe from marketing communications at any time.",
          ],
        },
        {
          heading: "Security",
          body: "We use industry-standard encryption (TLS in transit, AES-256 at rest) and access controls to protect your data. No method of transmission over the internet is 100% secure; we encourage you to use a strong, unique password and enable two-factor authentication.",
        },
        {
          heading: "Contact",
          body: "If you have questions about this Privacy Policy or wish to exercise your rights, please contact us at privacy@trainready.app.",
        },
      ]}
    />
  );
}
