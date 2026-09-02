// What a partner is told their business check means — in their language, not the enum's. One map,
// read by the dashboard's next-step card and by /business, so the two can never drift apart (they
// had: the dashboard said "Business details with us" where /business said "With us now").
export const KYB_COPY: Record<string, { title: string; body: string }> = {
  pending: { title: 'Tell us about yourself', body: 'We need this before you can take orders.' },
  submitted: { title: 'With us now', body: 'Someone will look at this shortly. Nothing for you to do.' },
  under_review: { title: 'Being reviewed', body: 'A person is going through it now.' },
  more_info: { title: 'We need one more thing', body: 'Update what we’ve asked for below and send it again.' },
  approved: { title: 'Approved', body: 'You’re verified. You can go online whenever you like.' },
  rejected: { title: 'Not approved', body: 'We couldn’t verify your details.' },
};
