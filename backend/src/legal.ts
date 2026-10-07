/**
 * Legal text: ONE source for the app (bundled copy in mobile/src/legal/content.ts,
 * kept identical by scripts/sync-legal.mjs) and the website.
 *
 * Written from what the code does (BRD §13). It is a careful DRAFT, not legal
 * advice: a qualified person must review it before the store release.
 * `version` must equal config.termsVersion: changing it asks every account to
 * agree again (409 TERMS_OUTDATED → the in-app agree screen).
 */

export interface LegalDoc {
  title: string;
  version: string;
  updated: string;
  draft: boolean;
  summary: string[];
  sections: Array<{ heading: string; body: string[] }>;
}

export const CONTACT_EMAIL = 'support@houseplan.xenition.com';
export const LEGAL_VERSION = '2026-10-07';
const UPDATED = '7 October 2026';

export const PRIVACY: LegalDoc = {
  title: 'Privacy Policy',
  version: LEGAL_VERSION,
  updated: UPDATED,
  draft: true,
  summary: [
    'HousePlan stores the house projects you create: rooms and measurements, estimates, rates, quotes, invoices, payments, progress and the files you attach.',
    'Your projects are private to your account. Our staff do not open them, and they are never shared with other users.',
    'We do not sell your data. Advertising measurement runs only if you allow it, and AI help runs only after you opt in.',
    'You can export your data and delete your account in the app at any time, with or without a subscription.',
  ],
  sections: [
    {
      heading: 'Who we are',
      body: [
        `HousePlan ("we") provides the HousePlan app and website. Contact us at ${CONTACT_EMAIL} or through the support form in the app or at houseplan.xenition.com/support.`,
        'This policy explains what the app collects, why, who processes it, how long it is kept and the choices you have.',
      ],
    },
    {
      heading: 'What we collect',
      body: [
        'Account details: your email address, the name you give when you register or that Apple or Google shares when you sign in, and which sign-in methods you use. Passwords are handled by our authentication provider and are never stored by HousePlan in readable form.',
        'Your preferences: units, currency, country, time zone, how you enter prices, and the tap-only answers you give during setup (the kind of build and what matters most to you).',
        'Project information you enter: project names, build type, country and optional region, optional postcode and optional street address, floor area, storeys, budget target, dates, rooms and their dimensions, doors and windows, finish choices and the scope checklist.',
        'Financial records you enter: estimate lines, your own rates and their sources, supplier names and optional contact details, quotes, commitments, invoices, credits, payments and refunds, and forecasts. These are your planning records; we do not connect to your bank.',
        'Files you attach: photos and PDFs of receipts, quotes, progress and documents. Photos are re-encoded on your phone before upload, which removes location (GPS) data.',
        'Purchase metadata: which plan you bought, the store transaction identifiers needed to confirm it with Apple or Google, its status and its renewal date. We never receive your card details.',
        'Diagnostics: technical logs of requests (a request id, the time, the route and the result) so we can fix problems. Support requests include diagnostic details only if you tick the box allowing it.',
        'Records of your choices: when and which version of the Terms and this policy you agreed to, and your consent choices for AI help, advertising measurement and notifications.',
      ],
    },
    {
      heading: 'Why we use it',
      body: [
        'To run the service you subscribe to: calculating quantities and costs, keeping estimate revisions, tracking spending and forecasting the money still needed.',
        'To confirm your subscription with the App Store or Google Play and to restore it.',
        'To send the emails the service needs: the code that confirms your email address, password reset codes and confirmation that your account was deleted.',
        'To send notifications you switch on (for example a quote nearing expiry or an export being ready). Notification text leaves out your address and money amounts by default.',
        'To answer support requests, keep the service secure and fix faults.',
      ],
    },
    {
      heading: 'AI help (optional)',
      body: [
        'The Advisor is off until you opt in on its own consent screen. You can withdraw consent at any time in Settings, and every calculation and comparison keeps working without it.',
        'When you ask a question, we send a minimised summary of the project to an AI model through our platform provider: the project type and coarse region, relevant dimensions and specifications, calculated totals, line and rate identifiers, rate source details, which categories are included, and your question. We do not send your street address, postcode, supplier contact details or the contents of your attachments.',
        'AI answers are checked by our servers. The AI cannot change your estimate, approve structural changes or certify compliance, and any savings figure it mentions must match a figure our own calculator produced. You can delete your advice history at any time.',
      ],
    },
    {
      heading: 'Advertising measurement (optional)',
      body: [
        'If you allow it in Settings, the app uses the Meta SDK to measure whether our ads led to installs and subscriptions. Nothing is sent before you allow it. On iPhone, Apple asks for tracking permission separately. We never send addresses, quotes, photos, supplier names or financial amounts to analytics or advertising partners.',
      ],
    },
    {
      heading: 'Who processes your data',
      body: [
        'Xenition, our platform provider, hosts the app servers, database, file storage, authentication, email, push notifications and the AI gateway, under our instructions.',
        'Apple and Google process sign-in (if you use them), payments and push notification delivery under their own policies.',
        'Meta receives advertising measurement events only if you allow them.',
        'The AI model provider reached through Xenition receives the minimised Advisor context described above, only after you opt in. We do not currently have a contractual zero-retention guarantee from that provider, so it may keep the request for its own operational and abuse-monitoring purposes under its terms. That is why the context leaves out your address, contacts, notes and files.',
        'We do not sell personal data or share it for others to use for their own purposes. Data may be processed in countries other than yours; our providers use recognised safeguards for international transfers.',
      ],
    },
    {
      heading: 'How long we keep it',
      body: [
        'Projects and their records are kept until you delete them or your account. A deleted project can be recovered for 7 days, then it is purged.',
        'If your subscription ends, your projects are kept (without access to product features) until you delete them, so resubscribing restores them. The data export is always available.',
        'Export files are kept for 7 days. Job records and diagnostic logs are kept for about 30 days. AI advice results are kept for 90 days unless you delete them sooner; the raw context sent to the AI is not stored after the answer.',
        'Audit records of financial, revision, billing and administrative actions are kept for up to 12 months with personal details minimised.',
        'When you delete your account, live personal and project data is removed within 7 days and backup copies expire within 30 days. Records we must keep by law (such as minimal purchase evidence) are kept separately and only for as long as required.',
      ],
    },
    {
      heading: 'Your rights and choices',
      body: [
        'Export: Settings → Export my data gives you a machine-readable copy of your records, whether or not you subscribe.',
        'Delete: Settings → Delete account erases your account and projects after you confirm it is you. Deleting your account does not cancel an App Store or Google Play subscription; cancel that in your store settings.',
        'You can correct your details in the app, withdraw AI or advertising consent in Settings, and turn notifications off per category. Depending on where you live, you may also have rights to object, restrict processing or complain to a data protection authority.',
      ],
    },
    {
      heading: 'Children',
      body: ['HousePlan is meant for adults planning a building project. It is not directed at children under 16, and we do not knowingly collect their data.'],
    },
    {
      heading: 'How agreement is recorded, and changes',
      body: [
        'When you tick "I agree to the Terms and the Privacy Policy", we record the date and the version you agreed to. When we change these documents in a way that matters, the version changes and the app asks you to read and agree again before continuing.',
        'This policy is a draft pending review by a qualified legal professional.',
      ],
    },
  ],
};

export const TERMS: LegalDoc = {
  title: 'Terms of Use',
  version: LEGAL_VERSION,
  updated: UPDATED,
  draft: true,
  summary: [
    'HousePlan is a paid planning tool. There is no free trial: payment starts when you subscribe, and the plan renews until you cancel in your store settings.',
    'Estimates are planning figures based on what you enter. They are not quotes, professional advice or a guarantee of cost or savings.',
    'Structural, site and regulatory questions belong with qualified professionals. HousePlan never certifies compliance.',
    'Your data stays yours: export or delete it at any time, with or without a subscription.',
  ],
  sections: [
    {
      heading: 'The service',
      body: [
        'HousePlan helps you budget a new house, extension or renovation: a whole-house category checklist, room measurements, quantity calculators, your own rate book, estimate revisions with a fixed baseline, scenario comparisons, quotes, commitments, invoices, payments, forecasts, purchase lists, exports and optional AI explanations.',
        'By creating an account and ticking the agreement box you accept these Terms and confirm you have read the Privacy Policy.',
      ],
    },
    {
      heading: 'Subscription, renewal and cancellation',
      body: [
        'Product features require the HousePlan Pro subscription, monthly or yearly, bought through the App Store or Google Play at the price and in the currency the store shows you. There is no free trial and no free tier: payment starts immediately when you confirm the purchase.',
        'Subscriptions renew automatically at the end of each period unless you turn off auto-renewal in your store account settings at least 24 hours before the period ends. Cancelling stops the next renewal; you keep access until the end of the period you paid for.',
        'Refunds are handled by Apple or Google under their policies. Nothing in these Terms limits rights you have under consumer law where you live.',
        'Without an active subscription you can still sign in, restore purchases, read these documents, contact support, export your data and delete your account.',
        'Current plan limits: 5 active projects, 100 rooms per project, 2,000 lines per estimate revision, 5 GB of attachments, 30 AI requests in any rolling 30 days and 10 exports per day. Limits may change; the app shows the current ones before you buy and in Settings.',
      ],
    },
    {
      heading: 'Estimates are planning figures',
      body: [
        'Quantities and costs are calculated from the dimensions, products, waste allowances, rates and quotes you enter, using fixed published formulas. If an input is wrong or missing, the result will be too. Missing prices are shown as missing, never as zero, and totals say how complete they are.',
        'HousePlan does not provide engineering drawings, structural design, load calculations, or electrical, plumbing or foundation design. Quantities you enter from a builder or engineer are used for money only, not to judge whether a design is adequate.',
        'An estimate, comparison or forecast is not a quotation, valuation, professional advice or a guarantee of final cost or savings.',
      ],
    },
    {
      heading: 'Rates and sources',
      body: [
        'Your own rates work everywhere. Published benchmark rates appear only where we hold a sourced, dated price for that exact region and specification. Benchmarks older than 90 days are marked for review, expired ones are not used automatically, and you remain responsible for checking any price before relying on it. We never invent local prices, and currency conversion is not used as a local price.',
      ],
    },
    {
      heading: 'Your responsibilities',
      body: [
        'Enter information honestly and keep your sign-in details secure. Get structural, site, safety and regulatory decisions checked by qualified professionals. Do not use HousePlan to break the law, to upload unlawful or malicious files, or to try to reach other people’s data.',
        'Shared exports are copies you choose to send; once shared, they cannot be recalled.',
      ],
    },
    {
      heading: 'AI help',
      body: [
        'The Advisor is optional and explains and compares what HousePlan has already calculated. It may be wrong or incomplete. It never edits your estimate, approves structural changes or certifies compliance, and you should not rely on it as professional advice.',
      ],
    },
    {
      heading: 'Your content',
      body: [
        'You own the projects, records and files you add. You give us permission to store and process them only to provide the service to you. You can export or delete them at any time.',
      ],
    },
    {
      heading: 'Availability and changes',
      body: [
        'We work to keep HousePlan available and your data backed up, but we cannot promise uninterrupted service. We may update the app and these Terms; when a change matters, the app asks you to agree to the new version before you continue.',
      ],
    },
    {
      heading: 'Liability',
      body: [
        'To the extent the law allows, HousePlan is not liable for decisions you make based on estimates, comparisons, forecasts or AI explanations, or for indirect losses. Nothing in these Terms excludes liability that cannot be excluded by law.',
      ],
    },
    {
      heading: 'Ending your account',
      body: [
        'You can delete your account at any time in Settings. We may suspend an account that breaks these Terms, after telling you why where we can. Deleting your account does not cancel a store subscription.',
        'These Terms are a draft pending review by a qualified legal professional.',
      ],
    },
  ],
};
