import { LegalLayout } from "@/components/LegalLayout";

export const metadata = { title: "Terms of Service — Taper" };

export default function TermsPage() {
  return (
    <LegalLayout
      title="Terms of Service"
      subtitle="Legal"
      updated="May 15, 2025"
      sections={[
        {
          heading: "Acceptance of Terms",
          body: "By creating an account or using Taper, you agree to be bound by these Terms of Service. If you do not agree, please do not use our platform. We may update these terms from time to time; continued use after changes constitutes acceptance.",
        },
        {
          heading: "Your Account",
          body: [
            "You must be at least 16 years old to create an account.",
            "You are responsible for maintaining the confidentiality of your login credentials.",
            "You agree to provide accurate, current, and complete information during registration.",
            "You are responsible for all activity that occurs under your account.",
          ],
        },
        {
          heading: "Acceptable Use",
          body: [
            "Use Taper only for lawful purposes and in accordance with these Terms.",
            "Do not attempt to reverse-engineer, scrape, or extract data from the platform.",
            "Do not upload content that is abusive, misleading, or infringes third-party rights.",
            "Do not share your account credentials with others.",
            "Do not use the platform to spam, harass, or harm other users.",
          ],
        },
        {
          heading: "Subscriptions & Payments",
          body: "Certain features require a paid subscription. Subscriptions renew automatically at the end of each billing period unless cancelled. You may cancel at any time through your account settings or by contacting support@trainready.app. Refunds are issued at our discretion in accordance with applicable consumer law.",
        },
        {
          heading: "Intellectual Property",
          body: "All content, branding, software, and training methodologies on Taper are owned by or licensed to us. You retain ownership of the training data you upload. By using the platform you grant us a limited, non-exclusive licence to process your data to provide the service.",
        },
        {
          heading: "Disclaimers",
          body: "Taper provides training guidance for informational purposes only. It is not a substitute for professional medical or coaching advice. Always consult a qualified professional before starting a new training programme. We are not liable for any injury or loss arising from your use of the platform.",
        },
        {
          heading: "Limitation of Liability",
          body: "To the maximum extent permitted by law, Taper shall not be liable for any indirect, incidental, special, or consequential damages arising from your use of the platform. Our total liability to you shall not exceed the amount you paid us in the 12 months preceding the claim.",
        },
        {
          heading: "Termination",
          body: "We reserve the right to suspend or terminate your account if you violate these Terms. You may delete your account at any time. Upon termination, your right to use the platform ceases immediately.",
        },
        {
          heading: "Governing Law",
          body: "These Terms are governed by the laws of the jurisdiction in which Taper is incorporated. Any disputes shall be subject to the exclusive jurisdiction of the courts in that jurisdiction.",
        },
        {
          heading: "Contact",
          body: "For questions about these Terms, contact us at legal@trainready.app.",
        },
      ]}
    />
  );
}
