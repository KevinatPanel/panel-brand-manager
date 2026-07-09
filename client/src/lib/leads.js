// ---------------------------------------------------------------------------
// Lead Intelligence client helpers — short chip labels + relative time.
// ---------------------------------------------------------------------------

// Compact labels for the card signal chips (the full config labels are long).
export const SHORT_LABELS = {
  mmp: 'MMP',
  payable_event_clarity: 'Payable Clarity',
  payable_event_label: 'Payable Event',
  affiliate_department: 'Affiliate Dept',
  creator_campaigns: 'Creator',
  tracked_performance: 'Tracked Perf',
  meta_ads: 'Meta Ads',
  youtube_integrations: 'YouTube',
  paid_social_activity: 'Paid Social',
  revenue: 'Revenue',
  recent_funding: 'Funding',
  hiring_growth: 'Hiring',
  warm_contact: 'Warm Contact',
  decision_maker: 'Decision Maker',
  prior_engagement: 'Prior Engagement',
  key_contacts: 'Contacts',
};

export const shortLabel = (key, fallback) => SHORT_LABELS[key] ?? fallback ?? key;

// "Updated 2 days ago" style relative time.
export function relativeTime(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const day = 86400000;
  const days = Math.floor(diff / day);
  if (days <= 0) {
    const hrs = Math.floor(diff / 3600000);
    if (hrs <= 0) {
      const mins = Math.floor(diff / 60000);
      return mins <= 0 ? 'just now' : `${mins}m ago`;
    }
    return `${hrs}h ago`;
  }
  if (days === 1) return '1 day ago';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return months === 1 ? '1 month ago' : `${months} months ago`;
  const years = Math.floor(days / 365);
  return years === 1 ? '1 year ago' : `${years} years ago`;
}
